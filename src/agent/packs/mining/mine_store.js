// The mines of one world (spec v0.1.4.7 M3), persisted as { version: 1, mines: { "<level>": mine } }
// in <worldDir>/mines.json. One mine per level: two ores with the same level share a mine.
//
// A mine is { ore, entrance, level, base, chest, direction, length, shaft, created, updated } and,
// beyond the spec, { dimension, ores, end, tunnel, route }: the other ores that use the mine, the feet
// of the bot at the end of the tunnel, the corners of the tunnel (feet cells, from the room to the
// end, where it went to the side), and the way from the entrance to the bottom as a list of legs
// ({ kind: 'ladder', x, z, top, bottom, face, entry } | { kind: 'walk', from, to } | { kind: 'stairs', from, to, dir }).
import { readJsonSafe, writeJsonAtomic } from '../../../utils/safe_json.js';
import { isDirection } from './mine_logic.js';
import { oreOf, targetLevel } from './ore_table.js';

/** The name of the file in the world folder. */
export const MINE_FILE = 'mines.json';
/** The kinds of shafts. */
export const SHAFT_KINDS = Object.freeze(['ladder', 'stairs']);

const FILE_VERSION = 1;

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

function cleanLeg(leg) {
    if (!isPlainObject(leg)) {
        return null;
    }
    if (leg.kind === 'ladder' && isFiniteNumber(leg.x) && isFiniteNumber(leg.z) && isFiniteNumber(leg.top) && isFiniteNumber(leg.bottom)) {
        const entry = point(leg.entry);
        return {
            kind: 'ladder', x: Math.floor(leg.x), z: Math.floor(leg.z), top: Math.floor(leg.top), bottom: Math.floor(leg.bottom),
            face: isDirection(leg.face) ? leg.face : 'north', entry,
        };
    }
    if ((leg.kind === 'walk' || leg.kind === 'stairs') && point(leg.from) && point(leg.to)) {
        const out = { kind: leg.kind, from: point(leg.from), to: point(leg.to) };
        if (leg.kind === 'stairs') {
            out.dir = isDirection(leg.dir) ? leg.dir : 'north';
        }
        return out;
    }
    return null;
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
    };
}

function levelKey(mine) {
    return mine.dimension === 'overworld' ? String(mine.level) : `${mine.dimension}:${mine.level}`;
}

export class MineStore {
    /**
     * @param {string|null} filePath usually <worldDir>/mines.json; without it the store lives in memory only
     * @param {{now?: () => Date}} [options]
     */
    constructor(filePath, options = {}) {
        this.filePath = typeof filePath === 'string' && filePath.length > 0 ? filePath : null;
        const now = options?.now;
        this.now = typeof now === 'function' ? now : () => new Date();
        this._mines = new Map();
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
        this._mines = new Map();
        if (this.filePath === null) {
            return 0;
        }
        try {
            const result = readJsonSafe(this.filePath, { expect: 'object', now: this.now });
            if (result.status === 'ok') {
                const mines = result.data.mines;
                if (isPlainObject(mines)) {
                    for (const entry of Object.values(mines)) {
                        try {
                            const clean = validateMine(entry, null);
                            clean.created = typeof entry.created === 'string' ? entry.created : null;
                            clean.updated = typeof entry.updated === 'string' ? entry.updated : null;
                            this._mines.set(levelKey(clean), clean);
                        } catch {
                            // an invalid entry is left out
                        }
                    }
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
        return this._mines.size;
    }

    /**
     * Creates or replaces the mine of its level and writes the file. A mine that exists at that
     * level keeps its `created` time and the other ores it serves.
     * @param {object} mine
     * @returns {object} a copy of the saved mine
     * @throws {TypeError} for an unknown ore, a bad entrance or a missing level
     */
    set(mine) {
        const clean = validateMine(mine, this._nowIso());
        const old = this._mines.get(levelKey(clean));
        if (old) {
            clean.created = typeof mine.created === 'string' ? mine.created : old.created ?? clean.created;
            clean.ores = [...new Set([...clean.ores, ...old.ores])];
        }
        this._mines.set(levelKey(clean), clean);
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
        const mines = this.list(dimension);
        const own = mines.find(m => m.ore === row.ore) ?? mines.find(m => m.ores.includes(row.ore));
        if (own) {
            return own;
        }
        return mines.find(m => targetLevel(row, m.entrance.y) === m.level) ?? null;
    }

    /**
     * The mine at a level, or null.
     * @param {number} level
     * @param {string} [dimension]
     * @returns {object|null} a copy
     */
    atLevel(level, dimension) {
        return this.list(dimension).find(m => m.level === Math.floor(level)) ?? null;
    }

    /**
     * The mines of a dimension (all without one), the highest level first.
     * @param {string} [dimension]
     * @returns {object[]} copies
     */
    list(dimension) {
        const wanted = dimension === undefined || dimension === null ? null : normalizeDimension(dimension);
        return [...this._mines.values()].filter(m => wanted === null || m.dimension === wanted)
            .sort((a, b) => b.level - a.level || a.ore.localeCompare(b.ore)).map(copyMine);
    }

    /**
     * Removes the mine of an ore (as get finds it) or of a level, and writes the file.
     * @param {string|number} oreOrLevel
     * @param {string} [dimension]
     * @returns {boolean} true if it existed
     */
    remove(oreOrLevel, dimension) {
        const mine = typeof oreOrLevel === 'number' ? this.atLevel(oreOrLevel, dimension) : this.get(oreOrLevel, dimension);
        if (!mine) {
            return false;
        }
        this._mines.delete(levelKey(mine));
        this._save();
        return true;
    }

    /** Number of mines. */
    get size() {
        return this._mines.size;
    }

    _toJson() {
        const mines = {};
        for (const mine of this.list()) {
            mines[levelKey(mine)] = mine;
        }
        return { version: FILE_VERSION, mines };
    }

    _save() {
        if (this.filePath === null) {
            return true;
        }
        try {
            writeJsonAtomic(this.filePath, this._toJson(), { indent: 2 });
            return true;
        } catch (err) {
            console.warn(`Could not write the mine file ${this.filePath}:`, err?.message ?? err);
            return false;
        }
    }
}
