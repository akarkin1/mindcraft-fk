// The bases of one world (spec v0.1.4.15, S 2.4; v0.1.4.16, F2: `kept`), persisted as
// { version: 1, bases: { <name>: { name, centre: {x, y, z}, dimension, door: {x, y, z} | null, surveyed: ISO, places: [names], kept: [names] } } }
// in <worldDir>/bases.json. `places` are the names of the survey's places of the base, `kept` the names of the owner's areas
// in the base (never forgotten with the base). A pure file store like PlaceStore: it reads and writes its file and nothing
// else. A name is kept like the name of an area (trimmed, lower case, spaces to "_"), so "East Base" and "east_base" are one base.
import { readJsonSafe, writeJsonAtomic } from '../../utils/safe_json.js';

/** The name of the file in the world folder. */
export const BASE_FILE = 'bases.json';

const FILE_VERSION = 1;
const NAME_MAX = 64;

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

// Same order as Array.prototype.sort without a comparator.
function compareNames(a, b) {
    if (a < b) {
        return -1;
    }
    return a > b ? 1 : 0;
}

/**
 * The name of a base as it is saved and looked up: trimmed, lower case, every run of spaces one "_".
 * @param {*} name
 * @returns {string|null} null for anything that is not a string
 */
export function normalizeBaseName(name) {
    return typeof name === 'string' ? name.trim().toLowerCase().replace(/\s+/g, '_') : null;
}

function normalizeDimension(value) {
    if (typeof value !== 'string') {
        return 'overworld';
    }
    const name = value.startsWith('minecraft:') ? value.slice('minecraft:'.length) : value;
    return name.length > 0 ? name : 'overworld';
}

function point(p) {
    if (!isPlainObject(p) || !isFiniteNumber(p.x) || !isFiniteNumber(p.y) || !isFiniteNumber(p.z)) {
        return null;
    }
    return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
}

function cleanPlaces(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const out = [];
    for (const name of value) {
        if (typeof name === 'string' && name.trim() !== '' && !out.includes(name.trim())) {
            out.push(name.trim());
        }
    }
    return out;
}

function copyBase(base) {
    return {
        ...base,
        centre: { ...base.centre },
        door: base.door ? { ...base.door } : null,
        places: [...base.places],
        kept: [...(base.kept ?? [])],
    };
}

// The clean entry to store, or null when the base is not valid: a name of 1 to 64 characters and a centre. `kept` (v0.1.4.16,
// F2) is an optional list of names; it is stored as an empty list when the base gives none.
function validateBase(base, nowIso) {
    if (!isPlainObject(base)) {
        return null;
    }
    const name = normalizeBaseName(base.name);
    if (!name || name.length < 1 || name.length > NAME_MAX) {
        return null;
    }
    const centre = point(base.centre ?? base.center);
    if (!centre) {
        return null;
    }
    return {
        name,
        centre,
        dimension: normalizeDimension(base.dimension),
        door: point(base.door),
        surveyed: typeof base.surveyed === 'string' ? base.surveyed : nowIso,
        places: cleanPlaces(base.places),
        kept: cleanPlaces(base.kept),
    };
}

export class BaseStore {
    /**
     * @param {string|null} filePath usually <worldDir>/bases.json; without it the store lives in memory only
     * @param {{now?: () => Date, shared?: {changed: (fresh?: boolean) => boolean, mark: (stamp?: string|null) => void, stamp?: () => string|null}|null}} [options]
     *   shared (v0.1.4.13, M1): a SharedFile of memory_paths.js when another bot writes the same file: the store
     *   re-reads the file before a read or a write when it changed; without it the file is read once
     */
    constructor(filePath, options = {}) {
        this.filePath = typeof filePath === 'string' && filePath.length > 0 ? filePath : null;
        const now = options?.now;
        this.now = typeof now === 'function' ? now : () => new Date();
        const shared = options?.shared;
        this._shared = this.filePath !== null && shared && typeof shared.changed === 'function' && typeof shared.mark === 'function' ? shared : null;
        this._bases = new Map();
    }

    // The file as another bot left it; `fresh` before a write (a read looks at most once a second). Never throws.
    _refresh(fresh = false) {
        try {
            if (this._shared !== null && this._shared.changed(fresh)) {
                this.load();
            }
        } catch (err) {
            console.warn(`Could not re-read the base file ${this.filePath}:`, err?.message ?? err);
        }
    }

    _nowIso() {
        try {
            const value = this.now();
            return (value instanceof Date ? value : new Date(value)).toISOString();
        } catch {
            return new Date().toISOString();
        }
    }

    /**
     * Reads the file. Missing: empty. Corrupt: set aside by readJsonSafe, empty. Invalid entries are skipped.
     * Never throws.
     * @returns {number} number of bases
     */
    load() {
        const seen = this._shared?.stamp?.();
        this._bases = new Map();
        if (this.filePath === null) {
            return 0;
        }
        try {
            const result = readJsonSafe(this.filePath, { expect: 'object', now: this.now });
            if (result.status === 'ok') {
                const bases = result.data.bases;
                if (isPlainObject(bases)) {
                    for (const [name, entry] of Object.entries(bases)) {
                        const clean = validateBase({ ...(isPlainObject(entry) ? entry : {}), name }, null);
                        if (clean) {
                            this._bases.set(clean.name, clean);
                        }
                    }
                } else if (bases !== undefined) {
                    console.warn(`Base file ${this.filePath} has no "bases" object, starting empty.`);
                }
            } else if (result.status !== 'missing') {
                let warning = `Base file ${this.filePath} could not be read (${result.status}: ${result.error?.message}).`;
                if (result.quarantinedTo) {
                    warning += ` Corrupt file moved to ${result.quarantinedTo}.`;
                }
                console.warn(`${warning} Starting with no known bases.`);
            }
        } catch (err) {
            console.warn(`Base file ${this.filePath} could not be read:`, err?.message ?? err);
            this._bases = new Map();
        }
        this._shared?.mark(seen);
        return this._bases.size;
    }

    /**
     * Creates or replaces the base of its name and writes the file. `surveyed` is the time of the call unless the
     * base gives one. Never throws.
     * @param {{name: string, centre: {x: number, y: number, z: number}, dimension?: string, door?: {x: number, y: number, z: number}|null,
     *   surveyed?: string, places?: string[], kept?: string[]}} base
     * @returns {object|null} a copy of the saved base, null when the base is not valid (no name of 1 to 64 characters, no centre)
     */
    set(base) {
        try {
            this._refresh(true);
            const clean = validateBase({ ...(isPlainObject(base) ? base : {}), surveyed: base?.surveyed }, this._nowIso());
            if (!clean) {
                return null;
            }
            this._bases.set(clean.name, clean);
            this._save();
            return copyBase(clean);
        } catch (err) {
            console.warn('Could not save the base:', err?.message ?? err);
            return null;
        }
    }

    /**
     * The base of a name, or null; the name is normalised.
     * @param {string} name
     * @returns {object|null} a copy
     */
    get(name) {
        const clean = normalizeBaseName(name);
        if (!clean) {
            return null;
        }
        this._refresh();
        const base = this._bases.get(clean);
        return base ? copyBase(base) : null;
    }

    /**
     * The bases, by name.
     * @param {string} [dimension] only the bases of this dimension; all without one
     * @returns {object[]} copies
     */
    list(dimension) {
        this._refresh();
        const wanted = dimension === undefined || dimension === null ? null : normalizeDimension(dimension);
        return [...this._bases.keys()].sort(compareNames).map(name => this._bases.get(name))
            .filter(base => wanted === null || base.dimension === wanted).map(copyBase);
    }

    /**
     * Removes a base and writes the file. Never throws.
     * @param {string} name
     * @returns {boolean} true if it existed
     */
    remove(name) {
        try {
            const clean = normalizeBaseName(name);
            this._refresh(true);
            if (!clean || !this._bases.has(clean)) {
                return false;
            }
            this._bases.delete(clean);
            this._save();
            return true;
        } catch (err) {
            console.warn(`Could not forget the base "${name}":`, err?.message ?? err);
            return false;
        }
    }

    /**
     * Renames a base: the key in the file and `name` change, nothing else. Never throws.
     * @param {string} oldName
     * @param {string} newName
     * @returns {object|null} a copy of the renamed base; null when there is no base of the old name, the new name is not
     *   1 to 64 characters, or a base of the new name exists already
     */
    rename(oldName, newName) {
        try {
            const from = normalizeBaseName(oldName);
            const to = normalizeBaseName(newName);
            this._refresh(true);
            if (!from || !to || to.length < 1 || to.length > NAME_MAX || !this._bases.has(from) || this._bases.has(to)) {
                return null;
            }
            const base = this._bases.get(from);
            this._bases.delete(from);
            base.name = to;
            this._bases.set(to, base);
            this._save();
            return copyBase(base);
        } catch (err) {
            console.warn(`Could not rename the base "${oldName}":`, err?.message ?? err);
            return null;
        }
    }

    /** Number of bases. */
    get size() {
        this._refresh();
        return this._bases.size;
    }

    _toJson() {
        const names = [...this._bases.keys()].sort(compareNames);
        return { version: FILE_VERSION, bases: Object.fromEntries(names.map(name => [name, this._bases.get(name)])) };
    }

    _save() {
        if (this.filePath === null) {
            return true;
        }
        try {
            writeJsonAtomic(this.filePath, this._toJson(), { indent: 2 });
            this._shared?.mark();
            return true;
        } catch (err) {
            console.warn(`Could not write the base file ${this.filePath}:`, err?.message ?? err);
            return false;
        }
    }
}
