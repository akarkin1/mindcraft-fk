// The mines of one world (spec v0.1.4.7 M3), persisted as { version: 1, mines: { "<level>": mine } }
// in <worldDir>/mines.json. One mine per level: two ores with the same level share a mine.
//
// A mine is { ore, entrance, level, base, chest, direction, length, shaft, created, updated } and,
// beyond the spec, { dimension, ores, end, tunnel, route }: the other ores that use the mine, the feet
// of the bot at the end of the tunnel, the corners of the tunnel (feet cells, from the room to the
// end, where it went to the side), and the way from the entrance to the bottom as a list of legs
// ({ kind: 'ladder', x, z, top, bottom, face, entry } | { kind: 'walk', from, to } | { kind: 'stairs', from, to, dir }).
//
// v0.1.4.9 (spec I6, B1): a mine may also have `name` (the name the player gave; null for a mine of
// the bot), `source` ('bot' or 'player'), `room` ({ center, chest, table, furnace } of the player),
// `tunnels` ([{ start, dir, end, level, length, branches }]), `passed` (the ore left behind, at most
// 200) and `area` (the name of the area of type mine that held the bot, beyond the spec). A route may
// have door legs ({ kind: 'door', kind2, name, x, y, z, from, to }). A mine of v0.1.4.7 loads with
// name null, source 'bot', room null, tunnels [], passed []. The key of a mine is its name when it
// has one, else its level (mineKey). get and atLevel see the mines of the bot only.
//
// v0.1.4.10 (spec I6, R4): the file is { version: 2, mines: { "bot:<level>": mine, "<name>": mine } }. A
// mine without a name has the key bot:<level>, so a mine of the player named "16" no longer meets the
// mine of the bot at level 16. A file of version 1 is read as before and written again as version 2 at
// load, every mine kept (the key of a level becomes bot:<level>).
//
// v0.1.4.11 (I4): a mine of the bot dug from inside a known mine (a second level, mine_from_inside) has
// `parent`, the id of that mine (mineId: its name, else bot:<level>); every other mine has no `parent`
// field, so the records of v0.1.4.10 stay as they were. `children(mine)` lists the mines of a parent.
import { readJsonSafe, writeJsonAtomic } from '../../../utils/safe_json.js';
import { MAX_PASSED, addPassedEntry, cleanPassedEntry, isDirection, mineDistance, removePassedAt } from './mine_logic.js';
import { oreOf, targetLevel } from './ore_table.js';

/** The name of the file in the world folder. */
export const MINE_FILE = 'mines.json';
/** The kinds of shafts. */
export const SHAFT_KINDS = Object.freeze(['ladder', 'stairs']);
/** The kinds of openables of a door leg (spec I2). */
export const DOOR_KINDS = Object.freeze(['door', 'gate', 'trapdoor']);
/** How far `nearest` looks for a mine (spec I6). */
export const NEAREST_RANGE = 64;

const FILE_VERSION = 2;
/** The front of the key of a mine without a name (R4). */
export const BOT_KEY_PREFIX = 'bot:';

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function point(p) {
    if (!isPlainObject(p) || !isFiniteNumber(p.x) || !isFiniteNumber(p.y) || !isFiniteNumber(p.z)) {
        return null;
    }
    return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
}

function normalizeDimension(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim().replace(/^minecraft:/, '') : 'overworld';
}

function count(value) {
    return isFiniteNumber(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * The name of a mine as the store keeps it, like the names of areas: trimmed, lower case, spaces as
 * underscores. null for no name.
 * @param {*} name
 * @returns {string|null}
 */
export function cleanMineName(name) {
    if (typeof name !== 'string') {
        return null;
    }
    const clean = name.trim().toLowerCase().replace(/\s+/g, '_');
    return clean.length > 0 ? clean : null;
}

/**
 * The key of a mine in the store and in the file (spec I6, v0.1.4.10 R4): its name when it has one,
 * else `bot:<level>`; with the dimension in front outside the overworld (`the_nether:bot:16`).
 * @param {object} mine
 * @returns {string}
 */
export function mineKey(mine) {
    const dimension = normalizeDimension(mine?.dimension);
    const id = cleanMineName(mine?.name) ?? `${BOT_KEY_PREFIX}${Math.floor(mine?.level)}`;
    return dimension === 'overworld' ? id : `${dimension}:${id}`;
}

/**
 * The id of a mine in its dimension (v0.1.4.11, I4): its name when it has one, else `bot:<level>`; the
 * key of mineKey without the dimension. The `parent` of a mine of a second level is this id.
 * @param {object} mine
 * @returns {string}
 */
export function mineId(mine) {
    return cleanMineName(mine?.name) ?? `${BOT_KEY_PREFIX}${Math.floor(mine?.level)}`;
}

function cleanParent(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const clean = value.trim().toLowerCase().replace(/\s+/g, '_');
    return clean.length > 0 ? clean : null;
}

function cleanLeg(leg) {
    if (!isPlainObject(leg)) {
        return null;
    }
    if (leg.kind === 'ladder' && isFiniteNumber(leg.x) && isFiniteNumber(leg.z) && isFiniteNumber(leg.top) && isFiniteNumber(leg.bottom)) {
        const entry = point(leg.entry);
        const foot = point(leg.foot); // v0.1.4.9 (F3): the cell beside the column at the bottom, from the routes pack
        return {
            kind: 'ladder', x: Math.floor(leg.x), z: Math.floor(leg.z), top: Math.floor(leg.top), bottom: Math.floor(leg.bottom),
            face: isDirection(leg.face) ? leg.face : 'north', entry, ...(foot ? { foot } : {}),
        };
    }
    if ((leg.kind === 'walk' || leg.kind === 'stairs') && point(leg.from) && point(leg.to)) {
        const out = { kind: leg.kind, from: point(leg.from), to: point(leg.to) };
        if (leg.kind === 'stairs') {
            out.dir = isDirection(leg.dir) ? leg.dir : 'north';
        }
        return out;
    }
    if (leg.kind === 'door' && point(leg) && point(leg.from) && point(leg.to)) {
        return {
            kind: 'door', kind2: DOOR_KINDS.includes(leg.kind2) ? leg.kind2 : 'door', name: typeof leg.name === 'string' ? leg.name : null,
            ...point(leg), from: point(leg.from), to: point(leg.to),
        };
    }
    return null;
}

function cleanRoom(room) {
    const center = point(room?.center);
    if (!center) {
        return null;
    }
    return { center, chest: point(room.chest), table: point(room.table), furnace: point(room.furnace) };
}

function cleanBranch(branch) {
    if (!isPlainObject(branch) || !isFiniteNumber(branch.at) || (branch.side !== 'left' && branch.side !== 'right')) {
        return null;
    }
    const start = point(branch.start);
    const end = point(branch.end);
    if (!start || !end) {
        return null;
    }
    return { at: Math.floor(branch.at), side: branch.side, start, end, length: count(branch.length), done: branch.done === true };
}

function cleanTunnel(tunnel) {
    if (!isPlainObject(tunnel) || !isDirection(tunnel.dir)) {
        return null;
    }
    const start = point(tunnel.start);
    const end = point(tunnel.end);
    if (!start || !end) {
        return null;
    }
    const out = {
        start, dir: tunnel.dir, end, level: isFiniteNumber(tunnel.level) ? Math.floor(tunnel.level) : start.y, length: count(tunnel.length),
        branches: (Array.isArray(tunnel.branches) ? tunnel.branches : []).map(cleanBranch).filter(Boolean),
    };
    const corners = (Array.isArray(tunnel.corners) ? tunnel.corners : []).map(point).filter(Boolean);
    if (corners.length > 0) {
        out.corners = corners;
    }
    return out;
}

function cleanPassed(list) {
    let out = [];
    for (const entry of Array.isArray(list) ? list : []) {
        if (cleanPassedEntry(entry)) {
            out = addPassedEntry(out, entry);
        }
    }
    return out;
}

function copyMine(mine) {
    return JSON.parse(JSON.stringify(mine));
}

/**
 * Checks a mine and returns the clean entry to store. Throws TypeError for an unknown ore, a bad
 * entrance or a level that is no number.
 * @param {object} mine
 * @param {string} now ISO time for created and updated
 * @returns {object}
 */
function validateMine(mine, now) {
    if (!isPlainObject(mine)) {
        throw new TypeError('A mine must be an object');
    }
    const row = oreOf(mine.ore);
    if (!row) {
        throw new TypeError(`Unknown ore ${JSON.stringify(mine.ore)}`);
    }
    const entrance = point(mine.entrance);
    if (!entrance) {
        throw new TypeError('A mine needs an entrance with finite x, y and z');
    }
    if (!isFiniteNumber(mine.level)) {
        throw new TypeError('A mine needs a level');
    }
    const ores = new Set([row.ore]);
    for (const o of Array.isArray(mine.ores) ? mine.ores : []) {
        const r = oreOf(o);
        if (r) {
            ores.add(r.ore);
        }
    }
    return {
        ore: row.ore,
        entrance,
        level: Math.floor(mine.level),
        base: point(mine.base),
        chest: point(mine.chest),
        direction: isDirection(mine.direction) ? mine.direction : null,
        length: isFiniteNumber(mine.length) && mine.length > 0 ? Math.floor(mine.length) : 0,
        shaft: SHAFT_KINDS.includes(mine.shaft) ? mine.shaft : 'ladder',
        created: typeof mine.created === 'string' ? mine.created : now,
        updated: now,
        dimension: normalizeDimension(mine.dimension),
        ores: [...ores],
        end: point(mine.end),
        tunnel: (Array.isArray(mine.tunnel) ? mine.tunnel : []).map(point).filter(Boolean),
        route: (Array.isArray(mine.route) ? mine.route : []).map(cleanLeg).filter(Boolean),
        name: cleanMineName(mine.name),
        source: mine.source === 'player' ? 'player' : 'bot',
        room: cleanRoom(mine.room),
        tunnels: (Array.isArray(mine.tunnels) ? mine.tunnels : []).map(cleanTunnel).filter(Boolean),
        passed: cleanPassed(mine.passed),
        area: typeof mine.area === 'string' && mine.area.trim().length > 0 ? mine.area.trim() : null,
        ...(cleanParent(mine.parent) ? { parent: cleanParent(mine.parent) } : {}),
    };
}

// the mines of the bot: those get and atLevel choose from (a mine of the player is chosen by nearest)
function ofBot(mine) {
    return mine.source !== 'player';
}

export class MineStore {
    /**
     * @param {string|null} filePath usually <worldDir>/mines.json; without it the store lives in memory only
     * @param {{now?: () => Date, shared?: {changed: (fresh?: boolean) => boolean, mark: (stamp?: string|null) => void, stamp?: () => string|null}|null}} [options]
     *   shared (v0.1.4.13, M1): a SharedFile of memory_paths.js when another bot writes the same file: the store
     *   re-reads the file before a read or a write when it changed; without it the file is read once, as before
     */
    constructor(filePath, options = {}) {
        this.filePath = typeof filePath === 'string' && filePath.length > 0 ? filePath : null;
        const now = options?.now;
        this.now = typeof now === 'function' ? now : () => new Date();
        const shared = options?.shared;
        this._shared = this.filePath !== null && shared && typeof shared.changed === 'function' && typeof shared.mark === 'function' ? shared : null;
        this._mines = new Map();
    }

    // v0.1.4.13 (M1): the file as another bot left it; `fresh` before a write (a read looks at most once a second).
    // Never throws.
    _refresh(fresh = false) {
        try {
            if (this._shared !== null && this._shared.changed(fresh)) {
                this.load();
            }
        } catch (err) {
            console.warn(`Could not re-read the mine file ${this.filePath}:`, err?.message ?? err);
        }
    }

    _nowIso() {
        const value = this.now();
        return (value instanceof Date ? value : new Date(value)).toISOString();
    }

    /**
     * Reads the file. Missing: empty. Corrupt: set aside by readJsonSafe, empty. Invalid entries are
     * skipped. Never throws.
     * @returns {number} number of mines
     */
    load() {
        const seen = this._shared?.stamp?.(); // v0.1.4.13 (M1): the file as it was before the read
        this._mines = new Map();
        if (this.filePath === null) {
            return 0;
        }
        try {
            const result = readJsonSafe(this.filePath, { expect: 'object', now: this.now });
            if (result.status === 'ok') {
                const mines = result.data.mines;
                if (isPlainObject(mines)) {
                    for (const [oldKey, entry] of Object.entries(mines)) {
                        try {
                            const clean = validateMine(entry, null);
                            clean.created = typeof entry.created === 'string' ? entry.created : null;
                            clean.updated = typeof entry.updated === 'string' ? entry.updated : null;
                            if (this._mines.has(mineKey(clean))) {
                                // R4: never two mines under one key; only a file written by hand gets here
                                console.warn(`Mine file ${this.filePath}: the mine "${oldKey}" has the key "${mineKey(clean)}" of another mine. I keep the first one.`);
                                continue;
                            }
                            this._mines.set(mineKey(clean), clean);
                        } catch {
                            // an invalid entry is left out
                        }
                    }
                }
                // R4: a file of version 1 is written again as version 2, its mines under the new keys
                if (result.data.version !== FILE_VERSION && this._mines.size > 0) {
                    console.log(`Mine file ${this.filePath}: version ${result.data.version} read, written as version ${FILE_VERSION} with ${this._mines.size} mine(s).`);
                    this._save();
                }
            } else if (result.status !== 'missing') {
                let warning = `Mine file ${this.filePath} could not be read (${result.status}: ${result.error?.message}).`;
                if (result.quarantinedTo) {
                    warning += ` Corrupt file moved to ${result.quarantinedTo}.`;
                }
                console.warn(`${warning} Starting with no known mines.`);
            }
        } catch (err) {
            console.warn(`Mine file ${this.filePath} could not be read:`, err?.message ?? err);
            this._mines = new Map();
        }
        this._shared?.mark(seen);
        return this._mines.size;
    }

    /**
     * Creates or replaces the mine of its key (its name, else its level) and writes the file. A mine
     * that exists with that key keeps its `created` time and the other ores it serves.
     * @param {object} mine
     * @returns {object} a copy of the saved mine
     * @throws {TypeError} for an unknown ore, a bad entrance or a missing level
     */
    set(mine) {
        this._refresh(true);
        const clean = validateMine(mine, this._nowIso());
        const old = this._mines.get(mineKey(clean));
        if (old) {
            clean.created = typeof mine.created === 'string' ? mine.created : old.created ?? clean.created;
            clean.ores = [...new Set([...clean.ores, ...old.ores])];
        }
        this._mines.set(mineKey(clean), clean);
        this._save();
        return copyMine(clean);
    }

    /**
     * The mine for an ore (or its block or item): the mine made for it, else the mine at the best
     * level of the ore (so redstone finds the mine of diamond). null when there is none.
     * @param {string} ore
     * @param {string} [dimension]
     * @returns {object|null} a copy
     */
    get(ore, dimension) {
        const row = oreOf(ore);
        if (!row) {
            return null;
        }
        const mines = this.list(dimension).filter(ofBot);
        const own = mines.find(m => m.ore === row.ore) ?? mines.find(m => m.ores.includes(row.ore));
        if (own) {
            return own;
        }
        return mines.find(m => targetLevel(row, m.entrance.y) === m.level) ?? null;
    }

    /**
     * The mine of the bot at a level, or null.
     * @param {number} level
     * @param {string} [dimension]
     * @returns {object|null} a copy
     */
    atLevel(level, dimension) {
        return this.list(dimension).filter(ofBot).find(m => m.level === Math.floor(level)) ?? null;
    }

    /**
     * The mine with a name (spec I6), or null.
     * @param {string} name
     * @param {string} [dimension]
     * @returns {object|null} a copy
     */
    byName(name, dimension) {
        const wanted = cleanMineName(name);
        return wanted === null ? null : this.list(dimension).find(m => m.name === wanted) ?? null;
    }

    /**
     * The mine a mine of a second level was dug from (v0.1.4.11, I4), by its `parent`: the mine of that
     * name, else for `bot:16` the mine of the bot at that level. null without a parent or when it is gone.
     * @param {object} mine
     * @param {string} [dimension] the dimension of the mine without one
     * @returns {object|null} a copy
     */
    parentOf(mine, dimension) {
        const id = cleanParent(mine?.parent);
        if (!id) {
            return null;
        }
        const dim = dimension ?? mine?.dimension;
        const level = /^bot:(-?\d+)$/.exec(id);
        const found = level ? this.atLevel(Number(level[1]), dim) : this.byName(id, dim);
        return found && mineKey(found) !== mineKey(mine) ? found : null;
    }

    /**
     * The mines dug from inside a mine (v0.1.4.11, I4): those whose `parent` is its id, in its dimension,
     * the highest level first.
     * @param {object} mine
     * @returns {object[]} copies
     */
    children(mine) {
        const id = mine ? mineId(mine) : null;
        return id ? this.list(normalizeDimension(mine.dimension)).filter(m => m.parent === id && mineKey(m) !== mineKey(mine)) : [];
    }

    /**
     * The mines within `range` of a position (by mineDistance: the entrance and every cell of the
     * route, the room and the tunnels), the nearest first.
     * @param {{x,y,z}} pos
     * @param {string} [dimension]
     * @param {number} [range]
     * @returns {object[]} copies
     */
    within(pos, dimension, range = NEAREST_RANGE) {
        const limit = isFiniteNumber(range) ? range : NEAREST_RANGE;
        return this.list(dimension).map(m => ({ m, d: mineDistance(m, pos) })).filter(e => e.d <= limit)
            .sort((a, b) => a.d - b.d).map(e => e.m);
    }

    /**
     * The nearest mine within `range` (64) of a position (spec I6), or null.
     * @param {{x,y,z}} pos
     * @param {string} [dimension]
     * @param {number} [range]
     * @returns {object|null} a copy
     */
    nearest(pos, dimension, range = NEAREST_RANGE) {
        return this.within(pos, dimension, range)[0] ?? null;
    }

    _byKey(key) {
        this._refresh(true); // addPassed and removePassed write after it
        if (typeof key !== 'string') {
            return this._mines.get(mineKey(key)) ?? null;
        }
        // v0.1.4.10 (R4): the key of a level of v0.1.4.9 ("16", "the_nether:16") is that of bot:<level>
        const old = /^(?:(.+):)?(-?\d+)$/.exec(key);
        return this._mines.get(key) ?? (old ? this._mines.get(`${old[1] ? `${old[1]}:` : ''}${BOT_KEY_PREFIX}${old[2]}`) : null) ?? null;
    }

    /**
     * Adds an entry to the ore list of a mine (spec I6, B6) and writes the file: an entry at the same
     * cell is replaced, the oldest leave beyond 200. `seen` is now when it is not given.
     * @param {string|object} key mineKey(mine), or the mine
     * @param {{ore: string, x: number, y: number, z: number, reason: string, seen?: string}} entry
     * @returns {object|null} a copy of the mine, null when there is no such mine or the entry is invalid
     */
    addPassed(key, entry) {
        const mine = this._byKey(key);
        const clean = cleanPassedEntry(entry, this._nowIso());
        if (!mine || !clean) {
            return null;
        }
        mine.passed = addPassedEntry(mine.passed, clean, MAX_PASSED);
        mine.updated = this._nowIso();
        this._save();
        return copyMine(mine);
    }

    /**
     * Removes the entry at a cell from the ore list of a mine and writes the file when it was there.
     * @param {string|object} key mineKey(mine), or the mine
     * @param {{x,y,z}} pos
     * @returns {object|null} a copy of the mine, null when there is no such mine
     */
    removePassed(key, pos) {
        const mine = this._byKey(key);
        if (!mine) {
            return null;
        }
        const left = removePassedAt(mine.passed, pos);
        if (left.length !== mine.passed.length) {
            mine.passed = left;
            mine.updated = this._nowIso();
            this._save();
        }
        return copyMine(mine);
    }

    /**
     * The mines of a dimension (all without one), the highest level first.
     * @param {string} [dimension]
     * @returns {object[]} copies
     */
    list(dimension) {
        this._refresh();
        return this._sorted(dimension);
    }

    // the mines of a dimension (all without one) in the order of list, as copies; no re-read (a save uses it)
    _sorted(dimension) {
        const wanted = dimension === undefined || dimension === null ? null : normalizeDimension(dimension);
        return [...this._mines.values()].filter(m => wanted === null || m.dimension === wanted)
            .sort((a, b) => b.level - a.level || a.ore.localeCompare(b.ore) || mineKey(a).localeCompare(mineKey(b))).map(copyMine);
    }

    /**
     * The mine that remove(name) removes (v0.1.4.10, R4), or null: the mine of that name first; else
     * for "bot:16", "16" or 16 the mine of the bot at that level; else the mine of an ore as get finds it.
     * @param {string|number} name
     * @param {string} [dimension]
     * @returns {object|null} a copy
     */
    find(name, dimension) {
        if (typeof name === 'number') {
            return Number.isFinite(name) ? this.atLevel(name, dimension) : null;
        }
        if (typeof name !== 'string') {
            return null;
        }
        const byName = this.byName(name, dimension);
        if (byName) {
            return byName;
        }
        const level = /^\s*(?:bot:)?(-?\d+)\s*$/i.exec(name);
        if (level) {
            return this.atLevel(Number(level[1]), dimension);
        }
        return this.get(name, dimension);
    }

    /**
     * Removes a mine and writes the file (v0.1.4.10, R4: by name first, see find). A number or "bot:16"
     * is the mine of the bot at that level, an ore the mine of the bot for it (v0.1.4.7).
     * @param {string|number} name
     * @param {string} [dimension]
     * @returns {boolean} true if it existed
     */
    remove(name, dimension) {
        this._refresh(true);
        const mine = this.find(name, dimension);
        if (!mine) {
            return false;
        }
        this._mines.delete(mineKey(mine));
        this._save();
        return true;
    }

    /** Number of mines. */
    get size() {
        this._refresh();
        return this._mines.size;
    }

    _toJson() {
        const mines = {};
        for (const mine of this._sorted()) {
            mines[mineKey(mine)] = mine;
        }
        return { version: FILE_VERSION, mines };
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
            console.warn(`Could not write the mine file ${this.filePath}:`, err?.message ?? err);
            return false;
        }
    }
}
