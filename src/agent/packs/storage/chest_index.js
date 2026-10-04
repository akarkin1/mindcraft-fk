// The chests of one world and what they hold (spec v0.1.4.7 S1), persisted as
// { version: 1, chests: { "<x>,<y>,<z>": chest } } in <worldDir>/chests.json. The index is updated
// from what the bot sees in an open container, never from what it assumes.
import { readJsonSafe, writeJsonAtomic } from '../../../utils/safe_json.js';
import { CONTAINER_KINDS, chestKey, cleanName, comparePositions, distanceTo, normalizeDimension } from './storage_logic.js';

export { chestKey };

/** The name of the file in the world folder. */
export const CHEST_FILE = 'chests.json';

const FILE_VERSION = 1;

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function cleanItems(items) {
    const out = {};
    if (!isPlainObject(items)) {
        return out;
    }
    for (const [name, count] of Object.entries(items)) {
        const clean = cleanName(name);
        if (clean !== null && isFiniteNumber(count) && count >= 1) {
            out[clean] = (out[clean] ?? 0) + Math.floor(count);
        }
    }
    return out;
}

function copyChest(chest) {
    return { ...chest, items: { ...chest.items } };
}

/**
 * Checks a chest and returns the clean entry to store. Throws TypeError for a bad position or kind.
 * @param {object} chest
 * @param {string|null} seen the time to use when the chest has none
 * @returns {object}
 */
function validateChest(chest, seen) {
    if (!isPlainObject(chest) || !isFiniteNumber(chest.x) || !isFiniteNumber(chest.y) || !isFiniteNumber(chest.z)) {
        throw new TypeError('A chest needs finite x, y and z');
    }
    if (!CONTAINER_KINDS.includes(chest.kind)) {
        throw new TypeError(`The kind of a chest must be one of ${CONTAINER_KINDS.join(', ')}`);
    }
    return {
        x: Math.floor(chest.x),
        y: Math.floor(chest.y),
        z: Math.floor(chest.z),
        dimension: normalizeDimension(chest.dimension),
        kind: chest.kind,
        items: cleanItems(chest.items),
        free_slots: isFiniteNumber(chest.free_slots) && chest.free_slots > 0 ? Math.floor(chest.free_slots) : 0,
        seen: typeof chest.seen === 'string' ? chest.seen : seen,
    };
}

export class ChestIndex {
    /**
     * @param {string|null} filePath usually <worldDir>/chests.json; without it the index lives in memory only
     * @param {{now?: () => Date, shared?: {changed: (fresh?: boolean) => boolean, mark: (stamp?: string|null) => void, stamp?: () => string|null}|null}} [options]
     *   shared (v0.1.4.13, M1): a SharedFile of memory_paths.js when another bot writes the same file: the index
     *   re-reads the file before a read or a write when it changed; without it the file is read once, as before
     */
    constructor(filePath, options = {}) {
        this.filePath = typeof filePath === 'string' && filePath.length > 0 ? filePath : null;
        const now = options?.now;
        this.now = typeof now === 'function' ? now : () => new Date();
        const shared = options?.shared;
        this._shared = this.filePath !== null && shared && typeof shared.changed === 'function' && typeof shared.mark === 'function' ? shared : null;
        this._chests = new Map();
    }

    // v0.1.4.13 (M1): the file as another bot left it; `fresh` before a write (a read looks at most once a second).
    // Never throws.
    _refresh(fresh = false) {
        try {
            if (this._shared !== null && this._shared.changed(fresh)) {
                this.load();
            }
        } catch (err) {
            console.warn(`Could not re-read the chest file ${this.filePath}:`, err?.message ?? err);
        }
    }

    _nowIso() {
        const value = this.now();
        return (value instanceof Date ? value : new Date(value)).toISOString();
    }

    /**
     * Reads the file. Missing: empty. Corrupt: set aside by readJsonSafe, empty. Invalid entries are
     * skipped; the key is made from the coordinates of an entry. Never throws.
     * @returns {number} number of chests
     */
    load() {
        const seen = this._shared?.stamp?.(); // v0.1.4.13 (M1): the file as it was before the read
        this._chests = new Map();
        if (this.filePath === null) {
            return 0;
        }
        try {
            const result = readJsonSafe(this.filePath, { expect: 'object', now: this.now });
            if (result.status === 'ok') {
                const chests = result.data.chests;
                if (isPlainObject(chests)) {
                    for (const entry of Object.values(chests)) {
                        try {
                            const clean = validateChest(entry, null);
                            this._chests.set(chestKey(clean), clean);
                        } catch {
                            // an invalid entry is left out
                        }
                    }
                }
            } else if (result.status !== 'missing') {
                let warning = `Chest file ${this.filePath} could not be read (${result.status}: ${result.error?.message}).`;
                if (result.quarantinedTo) {
                    warning += ` Corrupt file moved to ${result.quarantinedTo}.`;
                }
                console.warn(`${warning} Starting with no known chests.`);
            }
        } catch (err) {
            console.warn(`Chest file ${this.filePath} could not be read:`, err?.message ?? err);
            this._chests = new Map();
        }
        this._shared?.mark(seen);
        return this._chests.size;
    }

    /**
     * Creates or replaces the chest at its position and writes the file. Coordinates are floored,
     * a missing dimension is the overworld, invalid item counts are left out, `seen` is now unless
     * the chest has a time.
     * @param {{x: number, y: number, z: number, dimension?: string, kind: string, items?: object, free_slots?: number, seen?: string}} chest
     * @returns {object} a copy of the saved chest
     * @throws {TypeError} for a bad position or a kind that is not chest, trapped_chest or barrel
     */
    update(chest) {
        const clean = validateChest(chest, this._nowIso());
        this._refresh(true);
        this._chests.set(chestKey(clean), clean);
        this._save();
        return copyChest(clean);
    }

    /**
     * The chest at a position, or null.
     * @param {{x,y,z}} pos
     * @returns {object|null} a copy
     */
    get(pos) {
        this._refresh();
        const chest = this._chests.get(chestKey(pos));
        return chest === undefined ? null : copyChest(chest);
    }

    /**
     * Removes the chest at a position and writes the file.
     * @param {{x,y,z}} pos
     * @returns {boolean} true if it existed
     */
    remove(pos) {
        const key = chestKey(pos);
        this._refresh(true);
        if (!this._chests.has(key)) {
            return false;
        }
        this._chests.delete(key);
        this._save();
        return true;
    }

    /**
     * The chests of a dimension (all without one), sorted by x, y, z.
     * @param {string} [dimension]
     * @returns {object[]} copies
     */
    list(dimension) {
        this._refresh();
        return this._sorted(dimension);
    }

    // the chests of a dimension (all without one) in the order of list, as copies; no re-read (a save uses it)
    _sorted(dimension) {
        const all = [...this._chests.values()];
        const wanted = dimension === undefined || dimension === null ? null : normalizeDimension(dimension);
        return all.filter(c => wanted === null || c.dimension === wanted).sort(comparePositions).map(copyChest);
    }

    /**
     * The chests of a dimension that hold the item, the most first, then by position.
     * @param {string} itemName
     * @param {string} [dimension]
     * @returns {object[]} copies
     */
    find(itemName, dimension) {
        const name = cleanName(itemName);
        if (name === null) {
            return [];
        }
        return this.list(dimension).filter(c => (c.items[name] ?? 0) > 0).sort((a, b) => b.items[name] - a.items[name] || comparePositions(a, b));
    }

    /**
     * The chests of a dimension with at least one free slot, sorted by x, y, z.
     * @param {string} [dimension]
     * @returns {object[]} copies
     */
    withSpace(dimension) {
        return this.list(dimension).filter(c => c.free_slots >= 1);
    }

    /**
     * The chest of a dimension nearest to a position that passes the test (any chest without a
     * test), measured to the centre of its block; ties by position. A test that throws fails.
     * @param {{x,y,z}} pos
     * @param {string} [dimension]
     * @param {(chest: object) => boolean} [test]
     * @returns {object|null} a copy
     */
    nearest(pos, dimension, test) {
        let best = null;
        let bestDistance = Infinity;
        for (const chest of this.list(dimension)) {
            let pass = true;
            if (typeof test === 'function') {
                try {
                    pass = test(chest) === true;
                } catch {
                    pass = false;
                }
            }
            const d = distanceTo(pos, chest);
            if (pass && d < bestDistance) {
                best = chest;
                bestDistance = d;
            }
        }
        return best;
    }

    /** Number of chests. */
    get size() {
        this._refresh();
        return this._chests.size;
    }

    _toJson() {
        const chests = {};
        for (const chest of this._sorted()) {
            chests[chestKey(chest)] = chest;
        }
        return { version: FILE_VERSION, chests };
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
            console.warn(`Could not write the chest file ${this.filePath}:`, err?.message ?? err);
            return false;
        }
    }
}
