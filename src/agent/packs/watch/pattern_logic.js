// The pattern finder of the watching pack (v0.1.4.12, part B, SPEC 4.4). Pure: no mineflayer, no world access of its
// own; what it needs of the world comes in `world` as functions. Never throws.
//
// A record is a list of entries { kind: 'place'|'break', name, x, y, z, t, props }, oldest first (recorder.js).
// findPattern(record, size, world) -> one of
//   { kind: 'line', name, from, dir, length, placed, cells, missing }
//   { kind: 'fence', name, gate, gatePlaced, gateSide, corner, from, dirA, dirB, a, b, placed, cells, missing }
//   { kind: 'tunnel', from, dir, length, dug, cells, missing }
//   { kind: null, why: 'too_few'|'no_line'|'no_size', n }
// A direction is 'east' (+x), 'west' (-x), 'south' (+z) or 'north' (-z).
import { TEXTS } from './texts.js';

/** The four directions as steps in x and z. */
export const DIRS = Object.freeze({
    east: Object.freeze({ x: 1, z: 0 }),
    west: Object.freeze({ x: -1, z: 0 }),
    south: Object.freeze({ x: 0, z: 1 }),
    north: Object.freeze({ x: 0, z: -1 }),
});
/** Air of every kind. */
export const AIR_NAMES = Object.freeze(['air', 'cave_air', 'void_air']);
/** A cell a block may be placed into: air and the plants and snow a placed block replaces. */
export const FREE_NAMES = Object.freeze([...AIR_NAMES, 'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'snow']);
/** The ground that counts for the side of a fence without a gate: grass, dirt or sand. */
export const GROUND_NAMES = Object.freeze(['grass_block', 'dirt', 'sand']);
/** A line without a size runs to the next block that is not air, or to this length. */
export const LINE_MAX = 16;
/** A tunnel without a size is this long. */
export const TUNNEL_DEFAULT = 8;
/** The largest size the finder accepts (a length, a side of a fence). */
export const SIZE_MAX = 64;

const AIR = new Set(AIR_NAMES);
const FREE = new Set(FREE_NAMES);
const GROUND = new Set(GROUND_NAMES);

const isInt = (v) => Number.isInteger(v);
const keyOf = (p) => `${p.x},${p.y},${p.z}`;
const cell = (x, y, z) => ({ x, y, z });
export const isFenceName = (name) => typeof name === 'string' && name.endsWith('_fence');
export const isGateName = (name) => typeof name === 'string' && name.endsWith('_fence_gate');

/**
 * The size the owner said: `{ long: 12 }` for "12 long" (or a bare "12"), `{ a: 7, b: 10 }` for "7 by 10" or "7 x 10",
 * null for anything else (an empty size too). Numbers from 1 to SIZE_MAX.
 * @param {string} text
 * @returns {{long: number}|{a: number, b: number}|null}
 */
export function parseSize(text) {
    if (typeof text !== 'string')
        return null;
    const t = text.trim().toLowerCase();
    const ok = (n) => Number.isInteger(n) && n >= 1 && n <= SIZE_MAX;
    let m = t.match(/^(\d+)\s*(?:by|x|\*)\s*(\d+)(?:\s*blocks?)?$/);
    if (m) {
        const a = Number(m[1]);
        const b = Number(m[2]);
        return ok(a) && ok(b) && a >= 2 && b >= 2 ? { a, b } : null;
    }
    m = t.match(/^(\d+)(?:\s*blocks?)?(?:\s*long)?$/);
    if (m) {
        const n = Number(m[1]);
        return ok(n) ? { long: n } : null;
    }
    return null;
}

/**
 * The net record: per cell only what is left after all entries, oldest first by the time of the entry that stays. A
 * block placed and broken again is gone (the cell is as before); a block broken and then placed counts as placed.
 * Entries without whole coordinates, a kind or a name are left out.
 * @param {object[]} record
 * @returns {object[]}
 */
export function netEntries(record) {
    const byCell = new Map();
    for (const e of Array.isArray(record) ? record : []) {
        if (!e || (e.kind !== 'place' && e.kind !== 'break') || typeof e.name !== 'string' || !isInt(e.x) || !isInt(e.y) || !isInt(e.z))
            continue;
        const k = keyOf(e);
        const before = byCell.get(k);
        if (before && before.kind === 'place' && e.kind === 'break') {
            byCell.delete(k); // undone
            continue;
        }
        if (before)
            byCell.delete(k); // the newest entry of the cell, in its place in time
        byCell.set(k, e);
    }
    return [...byCell.values()];
}

/** The direction of a step along x or z: 'east', 'west', 'south', 'north'; null otherwise. */
export function dirOf(dx, dz) {
    if (dz === 0 && dx > 0) return 'east';
    if (dz === 0 && dx < 0) return 'west';
    if (dx === 0 && dz > 0) return 'south';
    if (dx === 0 && dz < 0) return 'north';
    return null;
}

/** The direction to the right of `dir` (facing east, the right hand is south). */
export function rightOf(dir) {
    return { east: 'south', south: 'west', west: 'north', north: 'east' }[dir] ?? null;
}

/** The opposite direction. */
export function oppositeOf(dir) {
    return { east: 'west', west: 'east', south: 'north', north: 'south' }[dir] ?? null;
}

const step = (p, dir, k = 1) => cell(p.x + DIRS[dir].x * k, p.y, p.z + DIRS[dir].z * k);

/**
 * The run of cells in one direction (x or z) at one y, each one cell after the other, or null. The direction goes
 * from the first entry in time to the last; `from` is the end of the run where it starts.
 * @param {object[]} entries at least 2, oldest first
 * @returns {{from: object, dir: string, count: number}|null}
 */
export function runOf(entries) {
    if (!Array.isArray(entries) || entries.length < 2)
        return null;
    const y = entries[0].y;
    if (entries.some(e => e.y !== y))
        return null;
    const sameX = entries.every(e => e.x === entries[0].x);
    const sameZ = entries.every(e => e.z === entries[0].z);
    if (sameX === sameZ)
        return null; // on no axis (or one cell)
    const axis = sameX ? 'z' : 'x';
    const values = entries.map(e => e[axis]).sort((p, q) => p - q);
    for (let i = 1; i < values.length; i++) {
        if (values[i] !== values[i - 1] + 1)
            return null; // a gap or the same cell twice
    }
    const first = entries[0];
    const last = entries[entries.length - 1];
    const sign = Math.sign(last[axis] - first[axis]);
    const dir = axis === 'x' ? dirOf(sign, 0) : dirOf(0, sign);
    const start = sign > 0 ? values[0] : values[values.length - 1];
    const from = axis === 'x' ? cell(start, y, first.z) : cell(first.x, y, start);
    return { from, dir, count: entries.length };
}

function readName(world, x, y, z) {
    try {
        if (typeof world?.blockAt !== 'function')
            return undefined; // the world is not known
        const name = world.blockAt(x, y, z);
        return typeof name === 'string' ? name : null; // null: not loaded
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------- line

function findLine(places, size, world) {
    const name = places[0].name;
    if (places.some(e => e.name !== name))
        return null;
    const run = runOf(places);
    if (!run)
        return null;
    let length;
    if (size && size.long) {
        length = Math.max(size.long, run.count);
    } else {
        length = run.count;
        for (let k = run.count; k < LINE_MAX; k++) {
            const c = step(run.from, run.dir, k);
            const there = readName(world, c.x, c.y, c.z);
            if (there === null || (there !== undefined && !FREE.has(there)))
                break;
            length = k + 1;
        }
    }
    const placedKeys = new Set(places.map(keyOf));
    const cells = [];
    for (let k = 0; k < length; k++)
        cells.push({ ...step(run.from, run.dir, k), name });
    const missing = cells.filter(c => !placedKeys.has(keyOf(c)) && readName(world, c.x, c.y, c.z) !== name);
    return { kind: 'line', name, from: run.from, dir: run.dir, length, placed: places.length, cells, missing };
}

// ---------------------------------------------------------------- fence

// the cells of the border of the rectangle, in the order of a walk around it: from the corner along dirA, then along
// dirB, back against dirA, back against dirB. Each with i (along dirA) and j (along dirB).
function borderWalk(corner, dirA, dirB, a, b) {
    const at = (i, j) => ({ ...cell(corner.x + DIRS[dirA].x * i + DIRS[dirB].x * j, corner.y, corner.z + DIRS[dirA].z * i + DIRS[dirB].z * j), i, j });
    const list = [];
    for (let i = 0; i < a; i++) list.push(at(i, 0));
    for (let j = 1; j < b; j++) list.push(at(a - 1, j));
    for (let i = a - 2; i >= 0; i--) list.push(at(i, b - 1));
    for (let j = b - 2; j >= 1; j--) list.push(at(0, j));
    return list;
}

// the ground cells inside the rectangle on the side `dirB` that are grass, dirt or sand with a free cell above
function freeGround(world, corner, dirA, dirB, a, b) {
    let n = 0;
    for (let i = 0; i < a; i++) {
        for (let j = 1; j < b; j++) {
            const x = corner.x + DIRS[dirA].x * i + DIRS[dirB].x * j;
            const z = corner.z + DIRS[dirA].z * i + DIRS[dirB].z * j;
            const ground = readName(world, x, corner.y - 1, z);
            const above = readName(world, x, corner.y, z);
            if (typeof ground === 'string' && GROUND.has(ground) && (typeof above !== 'string' || FREE.has(above)))
                n++;
        }
    }
    return n;
}

// the side of the border: which one, its outward direction, its cells without the corners
function sidesOf(dirA, dirB, a, b) {
    return [
        { side: 'a0', out: oppositeOf(dirB), test: (c) => c.j === 0 && c.i > 0 && c.i < a - 1, mid: { i: Math.floor((a - 1) / 2), j: 0 } },
        { side: 'a1', out: dirB, test: (c) => c.j === b - 1 && c.i > 0 && c.i < a - 1, mid: { i: Math.floor((a - 1) / 2), j: b - 1 } },
        { side: 'b0', out: oppositeOf(dirA), test: (c) => c.i === 0 && c.j > 0 && c.j < b - 1, mid: { i: 0, j: Math.floor((b - 1) / 2) } },
        { side: 'b1', out: dirA, test: (c) => c.i === a - 1 && c.j > 0 && c.j < b - 1, mid: { i: a - 1, j: Math.floor((b - 1) / 2) } },
    ];
}

function findFence(places, size, world) {
    const fences = places.filter(e => isFenceName(e.name));
    const gates = places.filter(e => isGateName(e.name));
    const name = fences[0].name;
    if (fences.some(e => e.name !== name))
        return { why: 'no_line' };
    const run = runOf(places);
    if (!run)
        return { why: 'no_line' };
    if (!size || !size.a)
        return { why: 'no_size' };
    const dirA = run.dir;
    const a = Math.max(size.a, run.count);
    const b = size.b;
    const gate = gates[0] ?? null; // the first gate placed
    const facing = gate?.props?.facing;
    let dirB = null;
    if (facing && DIRS[facing] && facing !== dirA && facing !== oppositeOf(dirA))
        dirB = facing; // the gate faces inward
    if (!dirB) {
        const right = rightOf(dirA);
        const left = oppositeOf(right);
        dirB = freeGround(world, run.from, dirA, left, a, b) > freeGround(world, run.from, dirA, right, a, b) ? left : right;
    }
    const gateName = gate ? gate.name : `${name}_gate`;
    const placedByKey = new Map(places.map(e => [keyOf(e), e]));
    const walk = borderWalk(run.from, dirA, dirB, a, b);
    let gateKey = gate ? keyOf(gate) : null;
    let gateSide = null;
    let gateFacing = gate ? facing ?? null : null;
    if (!gate) {
        // the middle of the side that faces the player when "continue" was said; without the player the side of the
        // placed fences, then the others; a cell the owner placed already is not taken
        const sides = sidesOf(dirA, dirB, a, b);
        const player = world?.player && Number.isFinite(world.player.x) && Number.isFinite(world.player.z) ? world.player : null;
        const midOf = (s) => walk.find(c => c.i === s.mid.i && c.j === s.mid.j);
        const order = player
            ? [...sides].sort((p, q) => {
                const mp = midOf(p);
                const mq = midOf(q);
                return Math.hypot(mp.x + 0.5 - player.x, mp.z + 0.5 - player.z) - Math.hypot(mq.x + 0.5 - player.x, mq.z + 0.5 - player.z);
            })
            : sides;
        for (const s of order) {
            const mid = midOf(s);
            const free = walk.filter(c => s.test(c) && !placedByKey.has(keyOf(c)))
                .sort((p, q) => (Math.abs(p.i - mid.i) + Math.abs(p.j - mid.j)) - (Math.abs(q.i - mid.i) + Math.abs(q.j - mid.j)));
            if (free.length > 0) {
                gateKey = keyOf(free[0]);
                gateSide = s.out;
                gateFacing = oppositeOf(s.out); // inward
                break;
            }
        }
    }
    const cells = walk.map(c => {
        const k = keyOf(c);
        const owned = placedByKey.get(k);
        const isGate = k === gateKey;
        const out = { x: c.x, y: c.y, z: c.z, name: owned ? owned.name : (isGate ? gateName : name) };
        if (isGate)
            out.facing = gateFacing;
        return out;
    });
    const missing = cells.filter(c => !placedByKey.has(keyOf(c)) && readName(world, c.x, c.y, c.z) !== c.name);
    return {
        kind: 'fence', name, gate: gateName, gatePlaced: Boolean(gate), gateSide, corner: run.from, from: run.from,
        dirA, dirB, a, b, placed: places.length, cells, missing,
    };
}

// ---------------------------------------------------------------- tunnel

function findTunnel(breaks, size, world) {
    // the columns: every break entry belongs to a column whose feet and head (y and y + 1) were both broken
    const columns = new Map();
    for (const e of breaks) {
        const k = `${e.x},${e.z}`;
        if (!columns.has(k))
            columns.set(k, { x: e.x, z: e.z, ys: new Set(), t: e.t ?? 0, first: e });
        columns.get(k).ys.add(e.y);
    }
    const list = [...columns.values()];
    let level = null;
    for (const c of list) {
        if (c.ys.size !== 2)
            return null;
        const low = Math.min(...c.ys);
        if (!c.ys.has(low + 1))
            return null;
        if (level === null)
            level = low;
        else if (level !== low)
            return null;
    }
    if (list.length < 2)
        return null;
    // oldest first by the first break of each column
    const firsts = list.map(c => ({ x: c.x, y: level, z: c.z, t: c.t, order: breaks.indexOf(c.first) }))
        .sort((p, q) => p.order - q.order);
    const run = runOf(firsts);
    if (!run)
        return null;
    const length = size && size.long ? Math.max(size.long, run.count) : Math.max(TUNNEL_DEFAULT, run.count);
    const dugKeys = new Set(firsts.map(keyOf));
    const cells = [];
    for (let k = 0; k < length; k++)
        cells.push(step(run.from, run.dir, k));
    const isOpen = (c) => {
        const feet = readName(world, c.x, c.y, c.z);
        const head = readName(world, c.x, c.y + 1, c.z);
        return typeof feet === 'string' && typeof head === 'string' && AIR.has(feet) && AIR.has(head);
    };
    const missing = cells.filter(c => !dugKeys.has(keyOf(c)) && !isOpen(c));
    return { kind: 'tunnel', from: run.from, dir: run.dir, length, dug: list.length, cells, missing };
}

// ---------------------------------------------------------------- the finder

/**
 * The pattern in what the owner did.
 *   - line: 2 or more place entries of the same block at the same y in one direction, one after the other; "N long"
 *     gives the length from the first block, without a size the line runs to the next block that is not air or to 16;
 *   - fence: place entries of a fence (and a gate) in one direction with "A by B": the rectangle A long in the direction of
 *     the placed fences and B wide, to the side the gate faces (inward), else to the side with more free ground; the gate
 *     where it was placed, else in the middle of the side nearest to the player;
 *   - tunnel: break entries that freed cells 2 high in one direction at one level, 2 or more deep; "N long" or 8;
 *   - null with why: too_few (fewer than 2 entries), no_line (on no line), no_size (a fence needs "A by B").
 * @param {object[]} record
 * @param {string} [size] the owner's words: "12 long", "7 by 10" or ""
 * @param {{blockAt?: (x: number, y: number, z: number) => string|null, player?: {x: number, y: number, z: number}}} [world]
 * @returns {object}
 */
export function findPattern(record, size = '', world = {}) {
    try {
        const entries = netEntries(record);
        if (entries.length < 2)
            return { kind: null, why: 'too_few', n: entries.length };
        const parsed = parseSize(size);
        const places = entries.filter(e => e.kind === 'place');
        const breaks = entries.filter(e => e.kind === 'break');
        const order = places.length >= breaks.length ? ['place', 'break'] : ['break', 'place'];
        for (const kind of order) {
            if (kind === 'place' && places.length >= 2) {
                const fenceLike = places.every(e => isFenceName(e.name) || isGateName(e.name)) && places.some(e => isFenceName(e.name));
                if (fenceLike) {
                    const fence = findFence(places, parsed, world);
                    if (fence.kind)
                        return fence;
                    if (fence.why === 'no_size')
                        return { kind: null, why: 'no_size', n: places.length };
                } else {
                    const line = findLine(places, parsed, world);
                    if (line)
                        return line;
                }
            }
            if (kind === 'break' && breaks.length >= 2) {
                const tunnel = findTunnel(breaks, parsed, world);
                if (tunnel)
                    return tunnel;
            }
        }
        return { kind: null, why: 'no_line', n: entries.length };
    } catch {
        return { kind: null, why: 'no_line', n: Array.isArray(record) ? record.length : 0 };
    }
}

/**
 * What the bot says it understood, with " Say yes to build it." or " Say yes to dig it.", or the text without a
 * pattern. `have(name)` is the number the bot carries of a block.
 * @param {object} pattern a result of findPattern
 * @param {(name: string) => number} [have]
 * @returns {string}
 */
export function describePattern(pattern, have = () => 0) {
    const count = (name) => {
        try {
            const n = have(name);
            return Number.isFinite(n) ? n : 0;
        } catch {
            return 0;
        }
    };
    if (!pattern || !pattern.kind)
        return TEXTS.noPattern(pattern?.n ?? 0, pattern?.why ?? 'too_few');
    if (pattern.kind === 'line')
        return TEXTS.understood.line(pattern.name, pattern.length, pattern.from, pattern.dir, pattern.missing.length, count(pattern.name)) + TEXTS.sayYesBuild;
    if (pattern.kind === 'fence') {
        const moreFence = pattern.missing.filter(c => c.name === pattern.name).length;
        const moreGate = pattern.missing.filter(c => isGateName(c.name)).length;
        const where = pattern.gatePlaced ? TEXTS.gatePlaced : TEXTS.gateMiddle(pattern.gateSide);
        return TEXTS.understood.fence(pattern.a, pattern.b, pattern.from, pattern.dirA, where, moreFence, moreGate, count(pattern.name),
            pattern.name, pattern.gate) + TEXTS.sayYesBuild;
    }
    return TEXTS.understood.tunnel(pattern.length, pattern.from, pattern.dir, pattern.missing.length) + TEXTS.sayYesDig;
}
