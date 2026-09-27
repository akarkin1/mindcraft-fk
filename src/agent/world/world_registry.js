// Registry of the worlds a bot has visited: <botDir>/worlds/index.json.
import { readJsonSafe, writeJsonAtomic } from '../../utils/safe_json.js';

const FILE_VERSION = 1;
const LABEL_MAX = 80;

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function cutText(text, max) {
    if (text.length <= max) {
        return text;
    }
    let cut = text.slice(0, max);
    const last = cut.charCodeAt(cut.length - 1);
    if (last >= 0xD800 && last <= 0xDBFF) {
        cut = cut.slice(0, -1);
    }
    return cut;
}

function timeOf(entry) {
    const time = typeof entry?.last_seen === 'string' ? Date.parse(entry.last_seen) : NaN;
    return Number.isNaN(time) ? -Infinity : time;
}

export class WorldRegistry {
    /**
     * @param {string} botDir directory of the bot, e.g. ./bots/<name>
     * @param {{now?: () => Date}} options
     */
    constructor(botDir, options = {}) {
        this.botDir = botDir;
        this.filePath = `${botDir}/worlds/index.json`;
        const now = options?.now;
        this.now = typeof now === 'function' ? now : () => new Date();
        this._lastKey = null;
        this._worlds = new Map();
    }

    /**
     * Reads the index. Missing, corrupt or wrongly shaped: starts empty. Never throws.
     * @returns {number} number of known worlds
     */
    load() {
        this._lastKey = null;
        this._worlds = new Map();
        try {
            const result = readJsonSafe(this.filePath, { expect: 'object', now: this.now });
            if (result.status === 'ok') {
                const data = result.data;
                if (isPlainObject(data.worlds)) {
                    for (const [key, entry] of Object.entries(data.worlds)) {
                        if (key !== '' && isPlainObject(entry)) {
                            this._worlds.set(key, { ...entry, key });
                        }
                    }
                    this._lastKey = typeof data.last_key === 'string' && data.last_key !== '' ? data.last_key : null;
                } else {
                    console.warn(`World registry ${this.filePath} has no "worlds" object, starting empty.`);
                }
            } else if (result.status !== 'missing') {
                let warning = `World registry ${this.filePath} could not be read (${result.status}: ${result.error?.message}).`;
                if (result.quarantinedTo) {
                    warning += ` Corrupt file moved to ${result.quarantinedTo}.`;
                }
                console.warn(`${warning} Starting empty.`);
            }
        } catch (err) {
            console.warn(`World registry ${this.filePath} could not be read, starting empty:`, err?.message ?? err);
            this._lastKey = null;
            this._worlds = new Map();
        }
        return this._worlds.size;
    }

    /**
     * Records a visit of a world resolved by resolveWorld and writes the index.
     * @param {{key: string, label?: string, source?: string, hashedSeedHex?: string|null,
     *   isHardcore?: boolean|null, isFlat?: boolean|null}} world
     * @param {{age?: number}} observed
     * @returns {{entry: object, isNew: boolean, changedWorld: boolean, warnings: string[]}}
     */
    visit(world, observed = {}) {
        const key = world?.key;
        if (typeof key !== 'string' || key === '') {
            throw new TypeError('WorldRegistry.visit needs a world with a non-empty key');
        }
        const nowIso = this.now().toISOString();
        const age = isFiniteNumber(observed?.age) ? observed.age : null;
        const label = typeof world.label === 'string' && world.label !== '' ? world.label : key;
        const hardcore = typeof world.isHardcore === 'boolean' ? world.isHardcore : null;
        const flat = typeof world.isFlat === 'boolean' ? world.isFlat : null;
        const source = typeof world.source === 'string' ? world.source : null;
        const hashedSeed = typeof world.hashedSeedHex === 'string' ? world.hashedSeedHex : null;

        const warnings = [];
        const changedWorld = this._lastKey !== key;
        const existing = this._worlds.get(key);
        const isNew = existing === undefined;

        let entry;
        if (isNew) {
            entry = {
                key,
                label,
                label_source: 'auto',
                source,
                hashed_seed: hashedSeed,
                first_seen: nowIso,
                last_seen: nowIso,
                visits: 1,
                is_hardcore: hardcore,
                is_flat: flat,
                last_age: age,
            };
        } else {
            entry = { ...existing, key };

            if (entry.label_source !== 'manual' && label !== key && label !== entry.label) {
                if (typeof entry.label === 'string' && entry.label !== '') {
                    warnings.push(`The name of this world changed from "${entry.label}" to "${label}".`);
                }
                entry.label = label;
            }

            if (age !== null && isFiniteNumber(entry.last_age) && age < entry.last_age) {
                warnings.push(`The age of this world went back from ${entry.last_age} to ${age} ticks: the world may have been reset or replaced.`);
            }
            if (age !== null) {
                entry.last_age = age;
            }

            if (hardcore !== null) {
                if (typeof entry.is_hardcore === 'boolean' && entry.is_hardcore !== hardcore) {
                    warnings.push(hardcore
                        ? 'This world is now hardcore, but it was not hardcore on your last visit.'
                        : 'This world is no longer hardcore, but it was hardcore on your last visit.');
                }
                entry.is_hardcore = hardcore;
            }
            if (flat !== null) {
                if (typeof entry.is_flat === 'boolean' && entry.is_flat !== flat) {
                    warnings.push(flat
                        ? 'This world is now a flat world, but it was not flat on your last visit.'
                        : 'This world is no longer a flat world, but it was flat on your last visit.');
                }
                entry.is_flat = flat;
            }

            if (source !== null) {
                entry.source = source;
            }
            if (hashedSeed !== null) {
                entry.hashed_seed = hashedSeed;
            }
            entry.last_seen = nowIso;
            entry.visits = (isFiniteNumber(entry.visits) ? entry.visits : 0) + 1;
        }

        this._worlds.set(key, entry);
        this._lastKey = key;
        this._save();
        return { entry: { ...entry }, isNew, changedWorld, warnings };
    }

    /**
     * Sets a manual label for a known world and writes the index.
     * @param {string} key
     * @param {string} label
     * @returns {boolean}
     */
    setLabel(key, label) {
        const entry = typeof key === 'string' ? this._worlds.get(key) : undefined;
        if (entry === undefined || typeof label !== 'string') {
            return false;
        }
        const clean = cutText(label.trim(), LABEL_MAX);
        if (clean === '') {
            return false;
        }
        entry.label = clean;
        entry.label_source = 'manual';
        this._save();
        return true;
    }

    /** @returns {object|undefined} a copy of the entry */
    get(key) {
        const entry = this._worlds.get(key);
        return entry === undefined ? undefined : { ...entry };
    }

    /** @returns {object[]} copies of all entries, most recently seen first */
    list() {
        return [...this._worlds.values()]
            .map(entry => ({ ...entry }))
            .sort((a, b) => timeOf(b) - timeOf(a));
    }

    get lastKey() {
        return this._lastKey;
    }

    worldDir(key) {
        return `${this.botDir}/worlds/${key}`;
    }

    _toJson() {
        // fromEntries defines own properties, also for a key such as "__proto__"
        const worlds = Object.fromEntries(this._worlds);
        return { version: FILE_VERSION, last_key: this._lastKey, worlds };
    }

    _save() {
        try {
            writeJsonAtomic(this.filePath, this._toJson(), { indent: 2 });
            return true;
        } catch (err) {
            console.warn(`Could not write the world registry ${this.filePath}:`, err?.message ?? err);
            return false;
        }
    }
}
