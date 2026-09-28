// Protected areas of one world (spec v0.1.4.6, A2), persisted as
// { version: 1, areas: { <name>: area } } in <worldDir>/areas.json.
import { readJsonSafe, writeJsonAtomic } from '../../utils/safe_json.js';
import { normalizeBox, boxSize, contains, distanceToBox, horizontalDistanceToBox } from './area_geometry.js';

const FILE_VERSION = 1;
const NAME_MAX = 64;

/** Types of an area. A farm allows planting and harvesting, a building nothing. */
export const AREA_TYPES = Object.freeze(['building', 'farm']);

/** Where an area came from: a scan, !setArea, or a box around the bot. */
export const AREA_SOURCES = Object.freeze(['scan', 'manual', 'radius']);

/** Kinds of an entrance: the lower block of a door, or a fence gate. */
export const ENTRANCE_KINDS = Object.freeze(['door', 'gate']);

/** Largest box of an area, in blocks. */
export const MAX_AREA_SIZE = Object.freeze({ x: 64, y: 48, z: 64 });

/** Dimension of an area or a query that names none. */
export const DEFAULT_DIMENSION = 'overworld';

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

function lookupName(name) {
    return typeof name === 'string' ? name.trim() : null;
}

/**
 * Dimension name without the "minecraft:" prefix; empty or not a string means the overworld.
 * @param {*} value
 * @returns {string}
 */
export function normalizeDimension(value) {
    if (typeof value !== 'string') {
        return DEFAULT_DIMENSION;
    }
    const name = value.startsWith('minecraft:') ? value.slice('minecraft:'.length) : value;
    return name.length > 0 ? name : DEFAULT_DIMENSION;
}

function cleanEntrances(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const result = [];
    for (const entry of value) {
        if (!isPlainObject(entry) || !ENTRANCE_KINDS.includes(entry.kind)
            || !isFiniteNumber(entry.x) || !isFiniteNumber(entry.y) || !isFiniteNumber(entry.z)) {
            continue;
        }
        result.push({ x: Math.floor(entry.x), y: Math.floor(entry.y), z: Math.floor(entry.z), kind: entry.kind });
    }
    return result;
}

function copyArea(area) {
    return {
        ...area,
        min: { ...area.min },
        max: { ...area.max },
        entrances: area.entrances.map(entry => ({ ...entry })),
    };
}

function tooBigMessage(name, size) {
    return `Area "${name}" is ${size.x} x ${size.y} x ${size.z} blocks. `
        + `An area has at most ${MAX_AREA_SIZE.x} x ${MAX_AREA_SIZE.y} x ${MAX_AREA_SIZE.z} blocks.`;
}

/**
 * Checks an area and returns the clean entry to store. Throws like set().
 * @param {object} area always an object (the callers make sure)
 * @param {string} nowIso time for "created" and "updated" when the area has none
 * @returns {object}
 */
function validateArea(area, nowIso) {
    if (typeof area.name !== 'string') {
        throw new TypeError('Area name must be a string');
    }
    const name = area.name.trim();
    if (name.length < 1 || name.length > NAME_MAX) {
        throw new TypeError(`Area name must have 1 to ${NAME_MAX} characters`);
    }
    if (!AREA_TYPES.includes(area.type)) {
        throw new TypeError(`Area type must be one of ${AREA_TYPES.join(', ')}`);
    }
    const box = normalizeBox(area.min, area.max);
    const size = boxSize(box);
    if (size.x > MAX_AREA_SIZE.x || size.y > MAX_AREA_SIZE.y || size.z > MAX_AREA_SIZE.z) {
        throw new RangeError(tooBigMessage(name, size));
    }
    return {
        name,
        type: area.type,
        min: box.min,
        max: box.max,
        dimension: normalizeDimension(area.dimension),
        entrances: cleanEntrances(area.entrances),
        source: AREA_SOURCES.includes(area.source) ? area.source : 'manual',
        created: typeof area.created === 'string' ? area.created : nowIso,
        updated: typeof area.updated === 'string' ? area.updated : nowIso,
    };
}

// A farm before a building, then by name.
function compareAreas(a, b) {
    if (a.type !== b.type) {
        return a.type === 'farm' ? -1 : 1;
    }
    return compareNames(a.name, b.name);
}

export class AreaStore {
    /**
     * @param {string} filePath usually <worldDir>/areas.json
     * @param {{now?: () => Date}} options
     */
    constructor(filePath, options = {}) {
        this.filePath = filePath;
        const now = options?.now;
        this.now = typeof now === 'function' ? now : () => new Date();
        this._areas = new Map();
        this._revision = 0;
    }

    _nowIso() {
        const value = this.now();
        return (value instanceof Date ? value : new Date(value)).toISOString();
    }

    /**
     * Reads the file. Missing: empty. Corrupt: set aside by readJsonSafe, empty.
     * Invalid entries are skipped with one warning. Never throws.
     * @returns {number} number of areas
     */
    load() {
        this._areas = new Map();
        this._revision++;
        try {
            const result = readJsonSafe(this.filePath, { expect: 'object', now: this.now });
            if (result.status === 'ok') {
                this._loadAreas(result.data.areas);
            } else if (result.status !== 'missing') {
                let warning = `Area file ${this.filePath} could not be read (${result.status}: ${result.error?.message}).`;
                if (result.quarantinedTo) {
                    warning += ` Corrupt file moved to ${result.quarantinedTo}.`;
                }
                console.warn(`${warning} Starting with no protected areas.`);
            }
        } catch (err) {
            console.warn(`Area file ${this.filePath} could not be read:`, err?.message ?? err);
            this._areas = new Map();
        }
        return this._areas.size;
    }

    _loadAreas(areas) {
        if (!isPlainObject(areas)) {
            if (areas !== undefined) {
                console.warn(`Area file ${this.filePath} has no "areas" object, starting empty.`);
            }
            return;
        }
        const skipped = [];
        const nowIso = this._nowIso();
        for (const [name, entry] of Object.entries(areas)) {
            try {
                const clean = validateArea({ ...(isPlainObject(entry) ? entry : {}), name }, nowIso);
                if (clean.name !== name) {
                    throw new TypeError('name with spaces around it');
                }
                this._areas.set(clean.name, clean);
            } catch {
                skipped.push(name);
            }
        }
        if (skipped.length > 0) {
            console.warn(`Area file ${this.filePath}: skipped ${skipped.length} invalid area(s): ${skipped.join(', ')}`);
        }
    }

    /**
     * Creates or replaces an area and writes the file. Replacing keeps "created".
     * The box is normalised (floored, min <= max). A missing dimension is the overworld,
     * invalid entrances are left out, an unknown source becomes "manual".
     * @param {{name: string, type: 'building'|'farm', min: object, max: object, dimension?: string,
     *   entrances?: {x: number, y: number, z: number, kind: 'door'|'gate'}[], source?: string}} area
     * @returns {object} a copy of the saved area
     * @throws {TypeError} for a name that is not 1 to 64 characters after trim, an unknown type or bad corners
     * @throws {RangeError} for a box larger than 64 blocks in x or z, or 48 in y
     */
    set(area) {
        const nowIso = this._nowIso();
        const clean = validateArea({ ...(isPlainObject(area) ? area : null), created: undefined, updated: undefined }, nowIso);
        const previous = this._areas.get(clean.name);
        if (previous) {
            clean.created = previous.created;
        }
        this._areas.set(clean.name, clean);
        this._revision++;
        this._save();
        return copyArea(clean);
    }

    /** @returns {object|undefined} a copy of the area */
    get(name) {
        const area = this._areas.get(lookupName(name));
        return area === undefined ? undefined : copyArea(area);
    }

    /** Removes an area and writes the file. @returns {boolean} true if it existed */
    remove(name) {
        const key = lookupName(name);
        if (!this._areas.has(key)) {
            return false;
        }
        this._areas.delete(key);
        this._revision++;
        this._save();
        return true;
    }

    /** @returns {object[]} copies of all areas, sorted by name */
    list() {
        return [...this._areas.keys()].sort(compareNames).map(name => copyArea(this._areas.get(name)));
    }

    /** Number of areas. */
    get size() {
        return this._areas.size;
    }

    /** Changes on every load, set and remove. The guard refreshes its cache when it changes. */
    get revision() {
        return this._revision;
    }

    _inDimension(dimension) {
        const wanted = normalizeDimension(dimension);
        return [...this._areas.values()].filter(area => area.dimension === wanted);
    }

    /**
     * Areas whose box contains the position, in the dimension (default overworld).
     * A farm comes before a building, then by name.
     * @param {{x: number, y: number, z: number}} pos
     * @param {string} [dimension]
     * @returns {object[]} copies
     */
    areasAt(pos, dimension) {
        return this._inDimension(dimension)
            .filter(area => contains(area, pos))
            .sort(compareAreas)
            .map(copyArea);
    }

    /**
     * The nearest area, measured with distanceToBox; ties by name.
     * @param {{x: number, y: number, z: number}} pos
     * @param {string} [dimension]
     * @param {'building'|'farm'} [type] only areas of this type
     * @returns {{area: object, distance: number}|null} null without a matching area
     */
    nearest(pos, dimension, type) {
        let best = null;
        for (const area of this._inDimension(dimension)) {
            if (type && area.type !== type) {
                continue;
            }
            const distance = distanceToBox(area, pos);
            if (!Number.isFinite(distance)) {
                continue;
            }
            if (!best || distance < best.distance
                || (distance === best.distance && compareNames(area.name, best.area.name) < 0)) {
                best = { area, distance };
            }
        }
        return best ? { area: copyArea(best.area), distance: best.distance } : null;
    }

    /**
     * Areas with a horizontal distance of at most `range`, nearest first, ties by name.
     * @param {{x: number, z: number}} pos
     * @param {string} [dimension]
     * @param {number} range
     * @returns {object[]} copies
     */
    near(pos, dimension, range) {
        return this._inDimension(dimension)
            .map(area => ({ area, distance: horizontalDistanceToBox(area, pos) }))
            .filter(entry => entry.distance <= range)
            .sort((a, b) => a.distance - b.distance || compareNames(a.area.name, b.area.name))
            .map(entry => copyArea(entry.area));
    }

    _toJson() {
        const names = [...this._areas.keys()].sort(compareNames);
        return { version: FILE_VERSION, areas: Object.fromEntries(names.map(name => [name, this._areas.get(name)])) };
    }

    _save() {
        try {
            writeJsonAtomic(this.filePath, this._toJson(), { indent: 2 });
            return true;
        } catch (err) {
            console.warn(`Could not write the area file ${this.filePath}:`, err?.message ?? err);
            return false;
        }
    }
}
