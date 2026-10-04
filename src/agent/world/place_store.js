// Saved places of one world, persisted as { version, places: { <name>: entry } }.
import { readJsonSafe, writeJsonAtomic } from '../../utils/safe_json.js';

const FILE_VERSION = 1;
const NAME_MAX = 64;

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function normaliseDimension(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

// Same order as Array.prototype.sort without a comparator.
function compareNames(a, b) {
    if (a < b) {
        return -1;
    }
    return a > b ? 1 : 0;
}

function lookupName(name) {
    return typeof name === 'string' ? name.trim() : null;
}

export class PlaceStore {
    /**
     * @param {string} filePath
     * @param {{now?: () => Date, shared?: {changed: (fresh?: boolean) => boolean, mark: (stamp?: string|null) => void, stamp?: () => string|null}|null}} options
     *   shared (v0.1.4.13, M1): a SharedFile of memory_paths.js when another bot writes the same file: the store
     *   re-reads the file before a read or a write when it changed; without it the file is read once, as before
     */
    constructor(filePath, options = {}) {
        this.filePath = filePath;
        const now = options?.now;
        this.now = typeof now === 'function' ? now : () => new Date();
        const shared = options?.shared;
        this._shared = shared && typeof shared.changed === 'function' && typeof shared.mark === 'function' ? shared : null;
        this._places = new Map();
    }

    // v0.1.4.13 (M1): the file as another bot left it; `fresh` before a write (a read looks at most once a second).
    // Never throws.
    _refresh(fresh = false) {
        try {
            if (this._shared !== null && this._shared.changed(fresh)) {
                this.load();
            }
        } catch (err) {
            console.warn(`Could not re-read the place file ${this.filePath}:`, err?.message ?? err);
        }
    }

    /**
     * Reads the file. Missing: empty. Corrupt: quarantined by readJsonSafe, empty.
     * Entries without finite x, y, z are skipped. Never throws.
     * @returns {number} number of places
     */
    load() {
        const seen = this._shared?.stamp?.(); // v0.1.4.13 (M1): the file as it was before the read
        this._places = new Map();
        try {
            const result = readJsonSafe(this.filePath, { expect: 'object', now: this.now });
            if (result.status === 'ok') {
                const places = result.data.places;
                if (isPlainObject(places)) {
                    for (const [name, entry] of Object.entries(places)) {
                        if (name === '' || !isPlainObject(entry)
                            || !isFiniteNumber(entry.x) || !isFiniteNumber(entry.y) || !isFiniteNumber(entry.z)) {
                            continue;
                        }
                        this._places.set(name, {
                            x: entry.x,
                            y: entry.y,
                            z: entry.z,
                            dimension: normaliseDimension(entry.dimension),
                            saved_at: typeof entry.saved_at === 'string' ? entry.saved_at : null,
                        });
                    }
                } else if (places !== undefined) {
                    console.warn(`Place file ${this.filePath} has no "places" object, starting empty.`);
                }
            } else if (result.status !== 'missing') {
                let warning = `Place file ${this.filePath} could not be read (${result.status}: ${result.error?.message}).`;
                if (result.quarantinedTo) {
                    warning += ` Corrupt file moved to ${result.quarantinedTo}.`;
                }
                console.warn(`${warning} Starting with no saved places.`);
            }
        } catch (err) {
            console.warn(`Place file ${this.filePath} could not be read:`, err?.message ?? err);
            this._places = new Map();
        }
        this._shared?.mark(seen);
        return this._places.size;
    }

    /**
     * Saves or overwrites a place and writes the file.
     * @returns {{x: number, y: number, z: number, dimension: string|null, saved_at: string}}
     */
    remember(name, x, y, z, dimension = null) {
        if (typeof name !== 'string') {
            throw new TypeError('Place name must be a string');
        }
        const clean = name.trim();
        if (clean.length < 1 || clean.length > NAME_MAX) {
            throw new TypeError(`Place name must have 1 to ${NAME_MAX} characters`);
        }
        if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) {
            throw new TypeError('Place coordinates must be finite numbers');
        }
        const entry = {
            x,
            y,
            z,
            dimension: normaliseDimension(dimension),
            saved_at: this.now().toISOString(),
        };
        this._refresh(true);
        this._places.set(clean, entry);
        this._save();
        return { ...entry };
    }

    /** @returns {object|undefined} a copy of the entry */
    recall(name) {
        this._refresh();
        const entry = this._places.get(lookupName(name));
        return entry === undefined ? undefined : { ...entry };
    }

    /** Removes a place and writes the file. @returns {boolean} true if it existed */
    forget(name) {
        const key = lookupName(name);
        this._refresh(true);
        if (!this._places.has(key)) {
            return false;
        }
        this._places.delete(key);
        this._save();
        return true;
    }

    /** @returns {{name: string, x: number, y: number, z: number, dimension: string|null, saved_at: string|null}[]} */
    list() {
        this._refresh();
        return this._sortedNames().map(name => ({ name, ...this._places.get(name) }));
    }

    /** @returns {string[]} sorted names */
    names() {
        this._refresh();
        return this._sortedNames();
    }

    // the names in the order of names(); no re-read (a save uses it)
    _sortedNames() {
        return [...this._places.keys()].sort(compareNames);
    }

    get size() {
        this._refresh();
        return this._places.size;
    }

    _toJson() {
        const places = Object.fromEntries(this._sortedNames().map(name => [name, this._places.get(name)]));
        return { version: FILE_VERSION, places };
    }

    _save() {
        try {
            writeJsonAtomic(this.filePath, this._toJson(), { indent: 2 });
            this._shared?.mark();
            return true;
        } catch (err) {
            console.warn(`Could not write the place file ${this.filePath}:`, err?.message ?? err);
            return false;
        }
    }
}
