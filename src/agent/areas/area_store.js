// Protected areas of one world (spec v0.1.4.6, A2), persisted as
// { version: 1, migrated: 1, areas: { <name>: area } } in <worldDir>/areas.json.
// v0.1.4.8 (D1): five types, names normalised, doubles merged on load, and the one-time changes
// of an old file (a building named "mine" becomes a mine, a box thinner than 2 blocks is dropped).
import { readJsonSafe, writeJsonAtomic } from '../../utils/safe_json.js';
import { normalizeBox, boxSize, contains, distanceToBox, horizontalDistanceToBox } from './area_geometry.js';
import { PLACE_KINDS, KIND_TYPES, CONTENT_KEYS } from './area_kind.js';

const FILE_VERSION = 1;
const NAME_MAX = 64;
// The one-time changes of v0.1.4.8 ran on the file. A file without it gets them on load; every write
// sets it, so an area that the player saves later is never changed by them.
const MIGRATION = 1;

/**
 * Types of an area (v0.1.4.8, I4). A home, a building and a pen allow nothing, a farm planting and
 * harvesting, a mine breaking natural blocks and placing.
 */
export const AREA_TYPES = Object.freeze(['home', 'building', 'farm', 'pen', 'mine']);

/**
 * The rules per type (v0.1.4.8, D2). break: 'none', 'crops' or 'natural'; place: 'none', 'seeds' or
 * 'all'; pathDig: what the path search may dig ('none' or 'natural'); shelter: the home pack may use
 * it as a shelter; defended: the creeper reflex defends it.
 */
export const AREA_RULES = Object.freeze({
    home: Object.freeze({ break: 'none', place: 'none', pathDig: 'none', shelter: true, defended: true }),
    building: Object.freeze({ break: 'none', place: 'none', pathDig: 'none', shelter: false, defended: true }),
    pen: Object.freeze({ break: 'none', place: 'none', pathDig: 'none', shelter: false, defended: true }),
    farm: Object.freeze({ break: 'crops', place: 'seeds', pathDig: 'none', shelter: false, defended: true }),
    mine: Object.freeze({ break: 'natural', place: 'all', pathDig: 'natural', shelter: false, defended: false }),
});

/** Where an area came from: a scan, !setArea, a box around the bot, or autoHome. */
export const AREA_SOURCES = Object.freeze(['scan', 'manual', 'radius', 'auto']);

/** Smallest side of an area in x and z (v0.1.4.8, D1 and D7). */
export const MIN_AREA_SIDE = 2;

/** Kinds of an entrance: the lower block of a door, a fence gate, or (v0.1.4.10, R3) a trapdoor. */
export const ENTRANCE_KINDS = Object.freeze(['door', 'gate', 'trapdoor']);

/**
 * Flags of an area (v0.1.4.10, R2). no_enter: a rule of the player says the bot never enters it; the
 * reflexes treat it like a pen.
 */
export const AREA_FLAG_NAMES = Object.freeze(['no_enter']);

/**
 * The kinds of the border of an area (v0.1.4.11, I5), as scanEnclosure of area_scan.js gives them.
 */
export const AREA_BORDERS = Object.freeze(['fence', 'wall', 'glass', 'hedge', 'water', 'mixed']);

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

/**
 * The name of an area as it is saved and looked up (v0.1.4.8, D1): trimmed, lower case, every run
 * of spaces one "_". "Mining Area" and "mining_area" are the same area.
 * @param {*} name
 * @returns {string|null} null for anything that is not a string
 */
export function normalizeAreaName(name) {
    return typeof name === 'string' ? name.trim().toLowerCase().replace(/\s+/g, '_') : null;
}

function lookupName(name) {
    return normalizeAreaName(name);
}

/**
 * True for the type of an area in which the home pack may shelter (D2): only home.
 * @param {string} type
 * @returns {boolean}
 */
export function isShelterType(type) {
    return AREA_RULES[type]?.shelter === true;
}

/**
 * True for the type of an area that the creeper reflex defends (D2): all but mine.
 * @param {string} type
 * @returns {boolean}
 */
export function isDefendedType(type) {
    return AREA_RULES[type]?.defended === true;
}

// Rank of a type where areas overlap: the first area decides. A farm first (as in v0.1.4.6), then a
// mine, then the types that allow nothing. So the work that the player saved an area for can be done
// where it lies inside another area.
const TYPE_RANK = Object.freeze({ farm: 0, mine: 1 });

/**
 * Rank of a type where areas overlap: 0 farm, 1 mine, 2 every other type. Lower decides first.
 * @param {string} type
 * @returns {number}
 */
export function typeRank(type) {
    return TYPE_RANK[type] ?? 2;
}

function volumeOf(box) {
    const size = boxSize(box);
    return size.x * size.y * size.z;
}

/**
 * Why a new box may not replace an area (v0.1.4.8, D7), or null when it may. Only a command that the
 * player typed may save a box with a side (x or z) of less than 2 blocks, or replace an area by a box
 * of less than half its volume.
 * @param {{name: string, min: object, max: object}|null|undefined} old the area of that name, if any
 * @param {{min: object, max: object}} box the new box, both corners whole or not
 * @param {boolean} byPlayer the player typed the command
 * @returns {null|{reason: 'too_thin'|'too_small', text: string}}
 */
export function replaceRefusal(old, box, byPlayer) {
    if (byPlayer === true || box === null || typeof box !== 'object') {
        return null;
    }
    let clean;
    try {
        clean = normalizeBox(box.min, box.max);
    } catch {
        return null; // the store refuses bad corners with its own error
    }
    const size = boxSize(clean);
    if (size.x < MIN_AREA_SIDE || size.z < MIN_AREA_SIDE) {
        const thin = Math.min(size.x, size.z);
        return {
            reason: 'too_thin',
            text: `The new box is only ${thin} block${thin === 1 ? '' : 's'} wide. An area needs at least `
                + `${MIN_AREA_SIDE} blocks in x and z. The player can type !setArea in the chat to do it.`,
        };
    }
    if (old && typeof old === 'object' && old.min && old.max) {
        let oldVolume;
        try {
            oldVolume = volumeOf(normalizeBox(old.min, old.max));
        } catch {
            return null;
        }
        if (volumeOf(clean) * 2 < oldVolume) {
            return {
                reason: 'too_small',
                text: `The new box is much smaller than the area "${old.name}" that I know. `
                    + 'The player can type !setArea in the chat to do it.',
            };
        }
    }
    return null;
}

/**
 * False when the model wants a box with a side (x or z) of less than 2 blocks, or replaces an area by
 * a box of less than half its volume (v0.1.4.8, D7). The player may, by typing the command.
 * @param {object|null|undefined} old the area of that name, if any
 * @param {{min: object, max: object}} box
 * @param {boolean} byPlayer
 * @returns {boolean}
 */
export function canReplace(old, box, byPlayer) {
    return replaceRefusal(old, box, byPlayer) === null;
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

// v0.1.4.10 (R2): only known flags with the value true are kept; no flag at all: no field.
function cleanFlags(value) {
    if (!isPlainObject(value)) {
        return null;
    }
    const flags = {};
    for (const name of AREA_FLAG_NAMES) {
        if (value[name] === true) {
            flags[name] = true;
        }
    }
    return Object.keys(flags).length > 0 ? flags : null;
}

// v0.1.4.11 (I5): the counts of countContents as scanned: animals and crops by name (whole numbers above 0), the
// other keys of CONTENT_KEYS as whole numbers of 0 or more. null for anything that is not an object.
function cleanContents(value) {
    if (!isPlainObject(value)) {
        return null;
    }
    const byName = (map) => {
        const out = {};
        if (isPlainObject(map)) {
            for (const [name, n] of Object.entries(map)) {
                if (name !== '' && isFiniteNumber(n) && Math.floor(n) > 0) {
                    out[name] = Math.floor(n);
                }
            }
        }
        return out;
    };
    const contents = { animals: byName(value.animals), crops: byName(value.crops) };
    for (const key of CONTENT_KEYS) {
        contents[key] = isFiniteNumber(value[key]) && value[key] > 0 ? Math.floor(value[key]) : 0;
    }
    return contents;
}

function copyContents(contents) {
    return { ...contents, animals: { ...contents.animals }, crops: { ...contents.crops } };
}

function copyArea(area) {
    const copy = {
        ...area,
        min: { ...area.min },
        max: { ...area.max },
        entrances: area.entrances.map(entry => ({ ...entry })),
    };
    if (area.flags) {
        copy.flags = { ...area.flags };
    }
    if (area.contents) {
        copy.contents = copyContents(area.contents);
    }
    return copy;
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
    const name = normalizeAreaName(area.name);
    if (name.length < 1 || name.length > NAME_MAX) {
        throw new TypeError(`Area name must have 1 to ${NAME_MAX} characters`);
    }
    // v0.1.4.11 (I5): an area with a kind has the type of its kind
    const kind = PLACE_KINDS.includes(area.kind) ? area.kind : null;
    const type = kind ? KIND_TYPES[kind] : area.type;
    if (!AREA_TYPES.includes(type)) {
        throw new TypeError(`Area type must be one of ${AREA_TYPES.join(', ')}`);
    }
    const box = normalizeBox(area.min, area.max);
    const size = boxSize(box);
    if (size.x > MAX_AREA_SIZE.x || size.y > MAX_AREA_SIZE.y || size.z > MAX_AREA_SIZE.z) {
        throw new RangeError(tooBigMessage(name, size));
    }
    const clean = {
        name,
        type,
        min: box.min,
        max: box.max,
        dimension: normalizeDimension(area.dimension),
        entrances: cleanEntrances(area.entrances),
        source: AREA_SOURCES.includes(area.source) ? area.source : 'manual',
        created: typeof area.created === 'string' ? area.created : nowIso,
        updated: typeof area.updated === 'string' ? area.updated : nowIso,
    };
    const flags = cleanFlags(area.flags);
    if (flags) {
        clean.flags = flags; // v0.1.4.10 (R2); an area without flags has no field, as before
    }
    // v0.1.4.11 (I5): what the bot concluded and found; an area without them has no fields, as before
    if (kind) {
        clean.kind = kind;
    }
    const contents = cleanContents(area.contents);
    if (contents) {
        clean.contents = contents;
    }
    if (AREA_BORDERS.includes(area.border)) {
        clean.border = area.border;
    }
    return clean;
}

/**
 * True when two boxes are the same blocks (corners whole and ordered), in the same dimension.
 * @param {{min: object, max: object, dimension?: string}} a
 * @param {{min: object, max: object, dimension?: string}} b
 * @returns {boolean}
 */
function boxesEqual(a, b) {
    let x;
    let y;
    try {
        x = normalizeBox(a.min, a.max);
        y = normalizeBox(b.min, b.max);
    } catch {
        return false;
    }
    return normalizeDimension(a.dimension) === normalizeDimension(b.dimension)
        && x.min.x === y.min.x && x.min.y === y.min.y && x.min.z === y.min.z
        && x.max.x === y.max.x && x.max.y === y.max.y && x.max.z === y.max.z;
}

/**
 * The saved area whose box is the given box (v0.1.4.10, R3), in the dimension of the box (default the
 * overworld); the first by name when several are. For !rememberArea: a scan that gives the box of an
 * existing area answers sameBoxText. Never throws.
 * @param {{list: function}|null} store an AreaStore
 * @param {{min: object, max: object, dimension?: string}} box
 * @returns {object|null} a copy of the area, null when no area has that box
 */
export function sameBox(store, box) {
    try {
        if (!isPlainObject(box) || typeof store?.list !== 'function') {
            return null;
        }
        return store.list().find(area => boxesEqual(area, box)) ?? null;
    } catch {
        return null;
    }
}

/**
 * The answer of !rememberArea when the box is that of an existing area (R3):
 * `That is the area "home" already.`
 * @param {string} name
 * @returns {string}
 */
export function sameBoxText(name) {
    return `That is the area "${name}" already.`;
}

// A farm first, then a mine, then the other types; then by name.
function compareAreas(a, b) {
    return typeRank(a.type) - typeRank(b.type) || compareNames(a.name, b.name);
}

// Time of the last change of an area in ms, NaN when it has none.
function changedAt(area) {
    const updated = Date.parse(area.updated);
    return Number.isNaN(updated) ? Date.parse(area.created) : updated;
}

// The one-time change of the type (D1): null when the area keeps its type. "mine" or "mining" at the
// start of a word of the name ("mining_area", "iron_mine", "mineshaft"), not inside one ("jasmine").
function migratedType(area) {
    if (area.type === 'building' && /(^|_)min(e|ing)/.test(area.name)) {
        return 'mine';
    }
    return null;
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
     * v0.1.4.8 (D1): names are normalised; two areas of the same normalised name become one, the newer
     * wins. A file that has not had them yet gets the one-time changes: a building whose name holds
     * "mine" or "mining" becomes a mine, an area thinner than 2 blocks in x or z is dropped. Each change
     * is written to the console, and the file is written again when something changed.
     * @returns {number} number of areas
     */
    load() {
        this._areas = new Map();
        this._revision++;
        try {
            const result = readJsonSafe(this.filePath, { expect: 'object', now: this.now });
            if (result.status === 'ok') {
                this._loadAreas(result.data.areas, result.data.migrated);
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

    _loadAreas(areas, migrated) {
        if (!isPlainObject(areas)) {
            if (areas !== undefined) {
                console.warn(`Area file ${this.filePath} has no "areas" object, starting empty.`);
            }
            return;
        }
        const skipped = [];
        const nowIso = this._nowIso();
        const keys = new Map(); // normalised name -> key in the file
        let changed = false;
        for (const [name, entry] of Object.entries(areas)) {
            let clean;
            try {
                clean = validateArea({ ...(isPlainObject(entry) ? entry : {}), name }, nowIso);
            } catch {
                skipped.push(name);
                continue;
            }
            if (clean.name !== name) {
                changed = true;
            }
            const previous = this._areas.get(clean.name);
            if (previous) {
                // D1: two areas whose normalised names are equal become one, the newer wins
                changed = true;
                const newer = !(changedAt(previous) > changedAt(clean));
                const kept = newer ? name : keys.get(clean.name);
                console.log(`Area file ${this.filePath}: "${keys.get(clean.name)}" and "${name}" are the same `
                    + `area "${clean.name}". I keep the newer one, "${kept}".`);
                if (!newer) {
                    continue;
                }
            }
            keys.set(clean.name, name);
            this._areas.set(clean.name, clean);
        }
        if (skipped.length > 0) {
            console.warn(`Area file ${this.filePath}: skipped ${skipped.length} invalid area(s): ${skipped.join(', ')}`);
        }
        if (migrated !== MIGRATION && this._migrate()) {
            changed = true;
        }
        if (changed) {
            this._save();
        }
    }

    // The one-time changes of v0.1.4.8 (D1), each written to the console. True when one was made.
    _migrate() {
        let changed = false;
        for (const [name, area] of [...this._areas]) {
            const size = boxSize(area);
            if (size.x < MIN_AREA_SIDE || size.z < MIN_AREA_SIDE) {
                this._areas.delete(name);
                changed = true;
                console.log(`Area "${name}" is ${size.x} x ${size.y} x ${size.z} blocks. An area needs at least `
                    + `${MIN_AREA_SIDE} blocks in x and z, so I dropped it.`);
                continue;
            }
            const type = migratedType(area);
            if (type) {
                area.type = type;
                changed = true;
                console.log(`Area "${name}" was of type building. Its name says it is a mine, so it is of type ${type} now.`);
            }
        }
        return changed;
    }

    /**
     * Creates or replaces an area and writes the file. Replacing keeps "created".
     * The box is normalised (floored, min <= max). A missing dimension is the overworld,
     * invalid entrances are left out, an unknown source becomes "manual". The name is normalised
     * (normalizeAreaName), so "Mining Area" replaces "mining_area". The store takes any box up to the
     * size limit; canReplace decides what the model may save.
     * @param {{name: string, type: 'home'|'building'|'farm'|'pen'|'mine', min: object, max: object, dimension?: string,
     *   entrances?: {x: number, y: number, z: number, kind: 'door'|'gate'|'trapdoor'}[], source?: string,
     *   flags?: {no_enter?: boolean}, kind?: string, contents?: object, border?: string}} area
     *   v0.1.4.11 (I5): kind (pen, farm, home, storage, building, yard; the type is then that of the kind: storage and
     *   yard are a building), contents (the counts of countContents), border (of scanEnclosure). A new box of the same
     *   type keeps them when the call gives no kind.
     * @returns {object} a copy of the saved area
     * @throws {TypeError} for a name that is not 1 to 64 characters after normalising, an unknown type or bad corners
     * @throws {RangeError} for a box larger than 64 blocks in x or z, or 48 in y
     */
    set(area) {
        const nowIso = this._nowIso();
        const clean = validateArea({ ...(isPlainObject(area) ? area : null), created: undefined, updated: undefined }, nowIso);
        const previous = this._areas.get(clean.name);
        if (previous) {
            clean.created = previous.created;
            // v0.1.4.10 (R2): a new box for the area keeps its flags unless the call gives flags
            if (!isPlainObject(area.flags) && previous.flags) {
                clean.flags = { ...previous.flags };
            }
            // v0.1.4.11 (I5): a new box of the same type keeps what the bot concluded unless the call gives a kind
            if (!clean.kind && previous.kind && clean.type === previous.type) {
                clean.kind = previous.kind;
                if (previous.contents && !clean.contents) {
                    clean.contents = copyContents(previous.contents);
                }
                if (previous.border && !clean.border) {
                    clean.border = previous.border;
                }
            }
        }
        this._areas.set(clean.name, clean);
        this._revision++;
        this._save();
        return copyArea(clean);
    }

    /**
     * Sets or clears a flag of an area (v0.1.4.10, R2) and writes the file. Never throws.
     * @param {string} name the name of the area (normalised)
     * @param {'no_enter'} flag
     * @param {boolean} value true sets it, false clears it
     * @returns {object|null} a copy of the area, null when there is no such area or the flag is unknown
     */
    setFlag(name, flag, value) {
        try {
            const area = this._areas.get(lookupName(name));
            if (!area || !AREA_FLAG_NAMES.includes(flag)) {
                return null;
            }
            const flags = { ...(area.flags ?? {}) };
            if (value === true) {
                flags[flag] = true;
            } else {
                delete flags[flag];
            }
            if (Object.keys(flags).length > 0) {
                area.flags = flags;
            } else {
                delete area.flags;
            }
            area.updated = this._nowIso();
            this._revision++;
            this._save();
            return copyArea(area);
        } catch (err) {
            console.warn(`Could not set the flag ${flag} of the area "${name}":`, err?.message ?? err);
            return null;
        }
    }

    /** @returns {object|undefined} a copy of the area; the name is normalised */
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
     * A farm first, then a mine, then the other types (the first one decides); then by name.
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
     * The smallest area whose box contains the position (v0.1.4.8, I3); ties by name.
     * @param {{x: number, y: number, z: number}} pos
     * @param {string} [dimension]
     * @returns {object|null} a copy, null outside of every area
     */
    areaAt(pos, dimension) {
        let best = null;
        let bestVolume = Infinity;
        for (const area of this._inDimension(dimension)) {
            if (!contains(area, pos)) {
                continue;
            }
            const volume = volumeOf(area);
            if (volume < bestVolume || (volume === bestVolume && compareNames(area.name, best.name) < 0)) {
                best = area;
                bestVolume = volume;
            }
        }
        return best ? copyArea(best) : null;
    }

    /**
     * The nearest area, measured with distanceToBox; ties by name.
     * @param {{x: number, y: number, z: number}} pos
     * @param {string} [dimension]
     * @param {'home'|'building'|'farm'|'pen'|'mine'} [type] only areas of this type
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
        return { version: FILE_VERSION, migrated: MIGRATION,
            areas: Object.fromEntries(names.map(name => [name, this._areas.get(name)])) };
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
