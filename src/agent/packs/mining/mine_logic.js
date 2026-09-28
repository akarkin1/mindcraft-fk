// The decisions of the mining pack (spec v0.1.4.7 M2): what a trip needs, what to do with the next
// block of a shaft, a staircase and a tunnel, which blocks form a vein, when to go back, where the
// entrance of a mine may be. Pure: it imports only pure modules. The executing module mining.js
// reads the world into views and does what these functions say.
//
// Coordinates: a position is { x, y, z } of a block. The "feet" of the bot is the block its feet
// are in. A direction is 'north' (-z), 'east' (+x), 'south' (+z) or 'west' (-x).
import { horizontalDistanceToBox, isBox } from '../home/box_math.js';
import { isEdibleFood } from '../home/food_logic.js';
import { PICKAXE_LEVELS, PICKAXE_USES, isOreBlock, oreOf, pickaxeIsEnough, pickaxeMaterial, tripPickaxe } from './ore_table.js';

/** Names of air. */
export const AIR_NAMES = Object.freeze(['air', 'cave_air', 'void_air']);
/** Blocks the bot places itself and that are no wall and no floor: they count as air. */
export const OPEN_NAMES = Object.freeze(['ladder', 'torch', 'wall_torch', 'soul_torch', 'soul_wall_torch']);
/** Blocks that are always water. */
export const WATER_NAMES = Object.freeze(['water', 'bubble_column', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass']);
/** Blocks that fall when the block under them is dug. */
export const FALLING_NAMES = Object.freeze(['gravel', 'sand', 'red_sand', 'suspicious_sand', 'suspicious_gravel', 'anvil',
    'chipped_anvil', 'damaged_anvil']);
/** Blocks nobody can break: the bottom of the world. */
export const UNBREAKABLE_NAMES = Object.freeze(['bedrock', 'barrier', 'end_portal_frame', 'end_portal', 'reinforced_deepslate',
    'command_block', 'chain_command_block', 'repeating_command_block', 'structure_block', 'jigsaw']);

/** The four directions, clockwise from north. */
export const DIRECTIONS = Object.freeze(['north', 'east', 'south', 'west']);
const VECTORS = Object.freeze({
    north: Object.freeze({ x: 0, y: 0, z: -1 }),
    east: Object.freeze({ x: 1, y: 0, z: 0 }),
    south: Object.freeze({ x: 0, y: 0, z: 1 }),
    west: Object.freeze({ x: -1, y: 0, z: 0 }),
});

/** Ladders for the depth: the depth plus 10 percent, at least this many. */
export const MIN_LADDERS = 8;
/** What a trip takes besides ladders and the pickaxe (spec M2). */
export const TRIP_SUPPLIES = Object.freeze({ torch: 16, cobblestone: 32, food: 8, chest: 1 });
/** Blocks dug for the room at the bottom: 3 x 3 x 3 less the shaft. */
export const ROOM_BLOCKS = 24;
/** Tunnel steps a trip plans with when it computes the blocks it digs. */
export const DEFAULT_TUNNEL_LENGTH = 32;
/** A torch every this many steps of the tunnel. */
export const TORCH_EVERY = 8;
/** Distance of a shaft, a staircase and the entrance to every protected area (horizontal). */
export const AREA_DISTANCE = 8;
/** A tunnel may pass under an area this far below its lowest block. */
export const UNDER_AREA_DEPTH = 16;
/** The entrance is at most this far from the bot. */
export const ENTRANCE_RANGE = 48;
/** A new shaft keeps this far from the columns of other mines (horizontal). */
export const AVOID_DISTANCE = 4;
/** How far the shaft or the tunnel moves to the side. */
export const SIDE_STEP = 3;
/** The limits of shouldReturn (spec M2). */
export const RETURN_LIMITS = Object.freeze({ freeSlots: 3, pickaxeUses: 10, health: 10, food: 6 });

// Foods for tripNeeds when no food table is given.
const COMMON_FOODS = Object.freeze(['apple', 'baked_potato', 'beetroot', 'beetroot_soup', 'bread', 'carrot', 'cooked_beef',
    'cooked_chicken', 'cooked_cod', 'cooked_mutton', 'cooked_porkchop', 'cooked_rabbit', 'cooked_salmon', 'cookie',
    'dried_kelp', 'golden_apple', 'golden_carrot', 'melon_slice', 'mushroom_stew', 'potato', 'pumpkin_pie', 'rabbit_stew',
    'sweet_berries', 'glow_berries']);

// ------------------------------------------------------------------ names and positions

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function known(name) {
    return typeof name === 'string' && name.length > 0;
}

/**
 * What the logic makes of a block name: `unknown` (not loaded or no name), `air` (also the
 * blocks of OPEN_NAMES), `water`, `lava`, `unbreakable` or `solid`.
 * @param {string|null|undefined} name
 * @returns {'unknown'|'air'|'water'|'lava'|'unbreakable'|'solid'}
 */
export function classify(name) {
    if (!known(name)) {
        return 'unknown';
    }
    if (AIR_NAMES.includes(name) || OPEN_NAMES.includes(name)) {
        return 'air';
    }
    if (name === 'lava') {
        return 'lava';
    }
    if (WATER_NAMES.includes(name)) {
        return 'water';
    }
    if (UNBREAKABLE_NAMES.includes(name)) {
        return 'unbreakable';
    }
    return 'solid';
}

/**
 * True for gravel, sand and the other blocks that fall, also concrete powder.
 * @param {string} name
 * @returns {boolean}
 */
export function isFalling(name) {
    return known(name) && (FALLING_NAMES.includes(name) || name.endsWith('_concrete_powder'));
}

/**
 * True for a direction name.
 * @param {*} dir
 * @returns {boolean}
 */
export function isDirection(dir) {
    return typeof dir === 'string' && DIRECTIONS.includes(dir);
}

/**
 * The unit vector of a direction (north for anything else).
 * @param {string} dir
 * @returns {{x: number, y: number, z: number}}
 */
export function dirVector(dir) {
    return VECTORS[isDirection(dir) ? dir : 'north'];
}

/**
 * The direction to the right of `dir` (clockwise, seen from above).
 * @param {string} dir
 * @returns {string}
 */
export function rightOf(dir) {
    return DIRECTIONS[(DIRECTIONS.indexOf(isDirection(dir) ? dir : 'north') + 1) % 4];
}

/**
 * The direction to the left of `dir`.
 * @param {string} dir
 * @returns {string}
 */
export function leftOf(dir) {
    return DIRECTIONS[(DIRECTIONS.indexOf(isDirection(dir) ? dir : 'north') + 3) % 4];
}

/**
 * The opposite direction.
 * @param {string} dir
 * @returns {string}
 */
export function backOf(dir) {
    return DIRECTIONS[(DIRECTIONS.indexOf(isDirection(dir) ? dir : 'north') + 2) % 4];
}

/**
 * The direction of a horizontal vector, the larger axis wins; null for (0, 0).
 * @param {number} dx
 * @param {number} dz
 * @returns {string|null}
 */
export function directionOf(dx, dz) {
    if (!isFiniteNumber(dx) || !isFiniteNumber(dz) || (dx === 0 && dz === 0)) {
        return null;
    }
    if (Math.abs(dx) >= Math.abs(dz)) {
        return dx > 0 ? 'east' : 'west';
    }
    return dz > 0 ? 'south' : 'north';
}

/**
 * The block position `k` steps from `p` in a direction (a name or a vector), plus `up` blocks.
 * @param {{x,y,z}} p
 * @param {string|{x,y,z}} dir
 * @param {number} [k]
 * @param {number} [up]
 * @returns {{x: number, y: number, z: number}}
 */
export function offset(p, dir, k = 1, up = 0) {
    const v = typeof dir === 'string' ? dirVector(dir) : { x: dir?.x ?? 0, y: dir?.y ?? 0, z: dir?.z ?? 0 };
    return { x: p.x + v.x * k, y: p.y + (v.y ?? 0) * k + up, z: p.z + v.z * k };
}

/**
 * The block position of a point (floored).
 * @param {{x,y,z}} p
 * @returns {{x: number, y: number, z: number}|null}
 */
export function cellOf(p) {
    if (!p || !isFiniteNumber(p.x) || !isFiniteNumber(p.y) || !isFiniteNumber(p.z)) {
        return null;
    }
    return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
}

/**
 * `x,y,z` of a block position.
 * @param {{x,y,z}} p
 * @returns {string}
 */
export function posKey(p) {
    return `${p.x},${p.y},${p.z}`;
}

function samePos(a, b) {
    return a.x === b.x && a.y === b.y && a.z === b.z;
}

function readName(getBlockName, p) {
    try {
        const name = getBlockName(p.x, p.y, p.z);
        return known(name) ? name : null;
    } catch {
        return null;
    }
}

// ------------------------------------------------------------------ views

const SIDES = Object.freeze(['north', 'east', 'south', 'west']);

/**
 * The view of shaftStep for a bot whose feet are at `feet`: the block under the feet (to dig),
 * the block under that, and the four blocks beside each.
 * @param {(x: number, y: number, z: number) => string|null} getBlockName
 * @param {{x,y,z}} feet
 * @returns {object}
 */
export function shaftView(getBlockName, feet) {
    const dig = offset(feet, 'north', 0, -1);
    const below = offset(feet, 'north', 0, -2);
    const sides = p => Object.fromEntries(SIDES.map(s => [s, readName(getBlockName, offset(p, s))]));
    return {
        origin: { x: feet.x, y: feet.y, z: feet.z },
        dig: readName(getBlockName, dig),
        below: readName(getBlockName, below),
        digSides: sides(dig),
        belowSides: sides(below),
    };
}

/**
 * The view of tunnelStep for a bot whose feet are at `feet`, digging towards `dir`: the two
 * blocks ahead (upper, lower) and around them left, right, above, below and the two behind them
 * (beyond). `step` is the number of the step in the tunnel, from 1.
 * @param {(x: number, y: number, z: number) => string|null} getBlockName
 * @param {{x,y,z}} feet
 * @param {string} dir
 * @param {number} [step]
 * @returns {object}
 */
export function tunnelView(getBlockName, feet, dir, step = 1) {
    const slots = tunnelSlots(feet, dir);
    const name = key => readName(getBlockName, slots[key]);
    return {
        origin: { x: feet.x, y: feet.y, z: feet.z },
        dir: isDirection(dir) ? dir : 'north',
        step,
        ahead: { upper: name('ahead.upper'), lower: name('ahead.lower') },
        left: { upper: name('left.upper'), lower: name('left.lower') },
        right: { upper: name('right.upper'), lower: name('right.lower') },
        above: name('above'),
        below: name('below'),
        beyond: { upper: name('beyond.upper'), lower: name('beyond.lower') },
    };
}

/**
 * The positions of the slots of a tunnel view.
 * @param {{x,y,z}} feet
 * @param {string} dir
 * @returns {Object<string, {x: number, y: number, z: number}>}
 */
export function tunnelSlots(feet, dir) {
    const d = isDirection(dir) ? dir : 'north';
    const lower = offset(feet, d);
    const upper = offset(lower, d, 0, 1);
    const right = rightOf(d);
    const left = leftOf(d);
    return {
        'ahead.upper': upper,
        'ahead.lower': lower,
        'left.upper': offset(upper, left),
        'left.lower': offset(lower, left),
        'right.upper': offset(upper, right),
        'right.lower': offset(lower, right),
        'above': offset(upper, d, 0, 1),
        'below': offset(lower, d, 0, -1),
        'beyond.upper': offset(upper, d),
        'beyond.lower': offset(lower, d),
    };
}

/**
 * The positions of the slots of a staircase view: the four blocks of the column ahead to dig (top
 * over the head, upper at the head, middle at the feet, lower one below the feet, where the feet
 * go), the floor under them, the ceiling over them, and left, right and ahead of each of the five.
 * Four blocks and not three: in a column of three the ceiling cuts the jump of the way back up
 * so short that the bot got stuck on the real server.
 * @param {{x,y,z}} feet
 * @param {string} dir
 * @returns {Object<string, {x: number, y: number, z: number}>}
 */
export function staircaseSlots(feet, dir) {
    const d = isDirection(dir) ? dir : 'north';
    const column = offset(feet, d);
    const cells = {
        top: offset(column, d, 0, 2),
        upper: offset(column, d, 0, 1),
        middle: column,
        lower: offset(column, d, 0, -1),
        floor: offset(column, d, 0, -2),
    };
    const slots = { ...cells, ceiling: offset(column, d, 0, 3) };
    for (const [key, p] of Object.entries(cells)) {
        slots[`${key}.left`] = offset(p, leftOf(d));
        slots[`${key}.right`] = offset(p, rightOf(d));
        slots[`${key}.ahead`] = offset(p, d);
    }
    return slots;
}

/**
 * The view of staircaseStep for a bot whose feet are at `feet`, going down towards `dir`.
 * @param {(x: number, y: number, z: number) => string|null} getBlockName
 * @param {{x,y,z}} feet
 * @param {string} dir
 * @returns {object}
 */
export function staircaseView(getBlockName, feet, dir) {
    const slots = staircaseSlots(feet, dir);
    const names = {};
    for (const [key, p] of Object.entries(slots)) {
        names[key] = readName(getBlockName, p);
    }
    return { origin: { x: feet.x, y: feet.y, z: feet.z }, dir: isDirection(dir) ? dir : 'north', names };
}

// ------------------------------------------------------------------ steps

function sortPatches(list) {
    // higher first: a block to close is placed against a solid block above or beside it
    const seen = new Set();
    return list.filter(p => {
        const k = posKey(p);
        if (seen.has(k)) {
            return false;
        }
        seen.add(k);
        return true;
    }).sort((a, b) => b.y - a.y);
}

function patchable(kind) {
    return kind === 'air' || kind === 'water' || kind === 'lava';
}

/**
 * What to do with the next block down of a shaft (spec M2). Rules, the first that holds:
 * a block of the view is unknown: `unknown` (nothing is dug); the block to dig is bedrock or
 * another unbreakable block: `bottom`; the block to dig or the one under it is lava: `lava`
 * (never dig, move the shaft); the block to dig or the one under it is air: `cave`, `patch` has
 * the hole to close; lava, water or air beside either block, or water in them: `patch` with the
 * positions to close with cobblestone, then dig; otherwise `dig`. `falling` is true when the
 * block to dig is gravel or sand.
 * @param {{origin?: {x,y,z}, dig: string, below: string, digSides: object, belowSides: object}} view
 * @returns {{action: 'dig'|'patch'|'cave'|'lava'|'bottom'|'unknown', patch: {x: number, y: number, z: number, slot: string}[], falling: boolean}}
 */
export function shaftStep(view) {
    const origin = view?.origin ?? { x: 0, y: 0, z: 0 };
    const digPos = offset(origin, 'north', 0, -1);
    const belowPos = offset(origin, 'north', 0, -2);
    const entries = [{ slot: 'dig', name: view?.dig, pos: digPos }, { slot: 'below', name: view?.below, pos: belowPos }];
    for (const s of SIDES) {
        entries.push({ slot: `dig.${s}`, name: view?.digSides?.[s], pos: offset(digPos, s) });
        entries.push({ slot: `below.${s}`, name: view?.belowSides?.[s], pos: offset(belowPos, s) });
    }
    const result = (action, patch = []) => ({ action, patch, falling: isFalling(view?.dig) });
    if (entries.some(e => classify(e.name) === 'unknown')) {
        return result('unknown');
    }
    const digKind = classify(view.dig);
    const belowKind = classify(view.below);
    if (digKind === 'unbreakable') {
        return result('bottom');
    }
    if (digKind === 'lava' || belowKind === 'lava') {
        return result('lava');
    }
    if (digKind === 'air') {
        return result('cave', [{ ...digPos, slot: 'dig' }]);
    }
    if (belowKind === 'air') {
        return result('cave', [{ ...belowPos, slot: 'below' }]);
    }
    const patch = entries.filter(e => {
        const kind = classify(e.name);
        return e.slot === 'dig' || e.slot === 'below' ? kind === 'water' : patchable(kind);
    }).map(e => ({ ...e.pos, slot: e.slot }));
    return patch.length > 0 ? result('patch', sortPatches(patch)) : result('dig');
}

/**
 * The same as shaftStep for one step of a staircase that goes one forward and one down: the
 * blocks to dig are the four of the column ahead (top, upper, middle, lower), the block under them
 * is the new floor. Unbreakable among the blocks to dig: `bottom`; lava among them or as the
 * floor: `lava`; the floor air: `cave` with the floor to close; lava, water or air beside the five
 * or above them, water among them: `patch`; otherwise `dig`. `falling` when the top block or the
 * one over it falls.
 * @param {{origin?: {x,y,z}, dir?: string, names: Object<string, string>}} view
 * @returns {{action: string, patch: {x: number, y: number, z: number, slot: string}[], falling: boolean}}
 */
export function staircaseStep(view) {
    const origin = view?.origin ?? { x: 0, y: 0, z: 0 };
    const slots = staircaseSlots(origin, view?.dir);
    const names = view?.names ?? {};
    const falling = isFalling(names.top) || isFalling(names.ceiling);
    const result = (action, patch = []) => ({ action, patch, falling });
    if (Object.keys(slots).some(key => classify(names[key]) === 'unknown')) {
        return result('unknown');
    }
    const digKeys = ['top', 'upper', 'middle', 'lower'];
    if (digKeys.some(k => classify(names[k]) === 'unbreakable')) {
        return result('bottom');
    }
    if ([...digKeys, 'floor'].some(k => classify(names[k]) === 'lava')) {
        return result('lava');
    }
    if (classify(names.floor) === 'air') {
        return result('cave', [{ ...slots.floor, slot: 'floor' }]);
    }
    const patch = [];
    for (const [key, p] of Object.entries(slots)) {
        const kind = classify(names[key]);
        const inside = digKeys.includes(key) || key === 'floor';
        if (inside ? kind === 'water' : patchable(kind)) {
            patch.push({ ...p, slot: key });
        }
    }
    return patch.length > 0 ? result('patch', sortPatches(patch)) : result('dig');
}

const AROUND = Object.freeze(['left.upper', 'left.lower', 'right.upper', 'right.lower', 'above', 'below', 'beyond.upper', 'beyond.lower']);
// the neighbours of each block ahead that lie around it
const AROUND_OF = Object.freeze({
    'ahead.upper': Object.freeze(['left.upper', 'right.upper', 'above', 'beyond.upper']),
    'ahead.lower': Object.freeze(['left.lower', 'right.lower', 'below', 'beyond.lower']),
});

function tunnelName(view, slot) {
    const [a, b] = slot.split('.');
    return b === undefined ? view?.[a] : view?.[a]?.[b];
}

/**
 * What to do with the next step of a tunnel, 1 wide and 2 high (spec M2). Rules, the first that
 * holds: a block of the view is unknown: `unknown`; a block ahead is unbreakable: `turn`; a block
 * ahead is lava or water: `turn`, `patch` has it (close it, go on 3 blocks to the side); a block
 * ahead is air and the space behind it is a cave (air beyond, above, below or beside it): `turn`
 * with the opening in `patch`; air behind the blocks ahead (beyond): a cave starts there, `turn`
 * without digging, the blocks ahead stay as its wall; lava, water or air in the other blocks
 * around, lava or water beyond: `patch` with the positions, then dig; otherwise `dig`. Always:
 * `ores` has the ore blocks ahead and around,
 * `torch` is true every 8 steps (`view.step`), `falling` when the upper block ahead or the block
 * over it falls.
 * @param {{origin?: {x,y,z}, dir?: string, step?: number, ahead: object, left: object, right: object, above: string, below: string, beyond: object}} view
 * @returns {{action: 'dig'|'patch'|'turn'|'unknown', patch: object[], ores: object[], torch: boolean, falling: boolean}}
 */
export function tunnelStep(view) {
    const origin = view?.origin ?? { x: 0, y: 0, z: 0 };
    const slots = tunnelSlots(origin, view?.dir);
    const step = isFiniteNumber(view?.step) ? Math.floor(view.step) : 0;
    const torch = step > 0 && step % TORCH_EVERY === 0;
    const falling = isFalling(view?.ahead?.upper) || isFalling(view?.above);
    const all = ['ahead.upper', 'ahead.lower', ...AROUND];
    const at = slot => ({ ...slots[slot], slot });
    const ores = all.filter(slot => isOreBlock(tunnelName(view, slot))).map(at);
    const result = (action, patch = []) => ({ action, patch, ores, torch, falling });
    if (all.some(slot => classify(tunnelName(view, slot)) === 'unknown')) {
        return { ...result('unknown'), ores: [] };
    }
    const ahead = ['ahead.upper', 'ahead.lower'];
    const kindOf = slot => classify(tunnelName(view, slot));
    if (ahead.some(slot => kindOf(slot) === 'unbreakable')) {
        return result('turn');
    }
    const liquidAhead = ahead.filter(slot => kindOf(slot) === 'lava' || kindOf(slot) === 'water');
    if (liquidAhead.length > 0) {
        return result('turn', sortPatches(liquidAhead.map(at)));
    }
    const airAhead = ahead.filter(slot => kindOf(slot) === 'air');
    const cave = airAhead.some(slot => AROUND_OF[slot].some(n => kindOf(n) === 'air'));
    if (cave) {
        return result('turn', sortPatches(airAhead.map(at)));
    }
    // air right behind the blocks ahead: the space behind them is a cave, and the blocks ahead are
    // the wall between it and the tunnel. They stay; the tunnel goes to the side.
    if (['beyond.upper', 'beyond.lower'].some(slot => kindOf(slot) === 'air')) {
        return result('turn');
    }
    const patch = AROUND.filter(slot => patchable(kindOf(slot))).map(at);
    return patch.length > 0 ? result('patch', sortPatches(patch)) : result('dig');
}

// ------------------------------------------------------------------ veins

const NEIGHBOURS_26 = (() => {
    const out = [];
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (dx !== 0 || dy !== 0 || dz !== 0) {
                    out.push({ x: dx, y: dy, z: dz });
                }
            }
        }
    }
    return out;
})();
const FACES = Object.freeze([{ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
    { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }]);

/**
 * The six positions that touch a block with a face.
 * @param {{x,y,z}} p
 * @returns {{x: number, y: number, z: number}[]}
 */
export function faceNeighbours(p) {
    return FACES.map(f => ({ x: p.x + f.x, y: p.y + f.y, z: p.z + f.z }));
}

/**
 * The blocks of one vein, from the ore block at `start`: blocks of the same ore that touch with
 * faces or corners, nearest to the start first, at most `limit`. An ore block with lava beside it
 * (a face) is left out, and the vein is not followed through it. Empty when `start` is no ore.
 * @param {{x,y,z}} start
 * @param {(x: number, y: number, z: number) => string|null} getBlockName
 * @param {number} [limit]
 * @returns {{x: number, y: number, z: number, name: string}[]}
 */
export function veinOrder(start, getBlockName, limit = 12) {
    const first = cellOf(start);
    if (!first || typeof getBlockName !== 'function') {
        return [];
    }
    const firstName = readName(getBlockName, first);
    const row = isOreBlock(firstName) ? oreOf(firstName) : null;
    if (!row) {
        return [];
    }
    const max = isFiniteNumber(limit) && limit > 0 ? Math.floor(limit) : 12;
    const sameOre = name => isOreBlock(name) && oreOf(name) === row;
    const lavaBeside = p => faceNeighbours(p).some(n => readName(getBlockName, n) === 'lava');
    const found = [];
    const seen = new Set([posKey(first)]);
    const queue = [{ ...first, name: firstName }];
    let order = 0;
    while (queue.length > 0 && seen.size < 256) {
        const p = queue.shift();
        if (lavaBeside(p)) {
            continue;
        }
        found.push({ ...p, order: order++ });
        for (const n of NEIGHBOURS_26) {
            const q = { x: p.x + n.x, y: p.y + n.y, z: p.z + n.z };
            const k = posKey(q);
            if (seen.has(k)) {
                continue;
            }
            seen.add(k);
            const name = readName(getBlockName, q);
            if (sameOre(name)) {
                queue.push({ ...q, name });
            }
        }
    }
    const dist = p => Math.hypot(p.x - first.x, p.y - first.y, p.z - first.z);
    return found.sort((a, b) => dist(a) - dist(b) || a.order - b.order).slice(0, max)
        .map(({ x, y, z, name }) => ({ x, y, z, name }));
}

// ------------------------------------------------------------------ going back

/**
 * Whether the bot goes back now (spec M2). The first reason that holds: `done` (collected at
 * least wanted), `health` (below 10), `hungry` (food level below 6 and no food), `pickaxe` (less
 * than 10 uses left, or null for no pickaxe, and no second pickaxe), `time` (the time used plus
 * the time of the way back reaches the limit), `inventory_full` (3 free slots or less).
 * `inventory_full` means: store at the base and go on. A field that is not given is no reason.
 * @param {{collected?: number, wanted?: number, health?: number, food?: number, hasFood?: boolean,
 *   pickaxeUses?: number|null, spare?: boolean, elapsedMs?: number, returnMs?: number, maxMs?: number, freeSlots?: number}} state
 * @returns {{go: boolean, reason: 'done'|'health'|'hungry'|'pickaxe'|'time'|'inventory_full'|null}}
 */
export function shouldReturn(state) {
    const s = state && typeof state === 'object' ? state : {};
    const num = (v, fallback) => (isFiniteNumber(v) ? v : fallback);
    if (isFiniteNumber(s.wanted) && num(s.collected, 0) >= s.wanted) {
        return { go: true, reason: 'done' };
    }
    if (num(s.health, 20) < RETURN_LIMITS.health) {
        return { go: true, reason: 'health' };
    }
    if (num(s.food, 20) < RETURN_LIMITS.food && s.hasFood !== true) {
        return { go: true, reason: 'hungry' };
    }
    const noPickaxe = s.pickaxeUses === null || (isFiniteNumber(s.pickaxeUses) && s.pickaxeUses < RETURN_LIMITS.pickaxeUses);
    if (noPickaxe && s.spare !== true) {
        return { go: true, reason: 'pickaxe' };
    }
    if (isFiniteNumber(s.maxMs) && num(s.elapsedMs, 0) + num(s.returnMs, 0) >= s.maxMs) {
        return { go: true, reason: 'time' };
    }
    if (isFiniteNumber(s.freeSlots) && s.freeSlots <= RETURN_LIMITS.freeSlots) {
        return { go: true, reason: 'inventory_full' };
    }
    return { go: false, reason: null };
}

/**
 * The time the way from the end of the tunnel to the surface takes, with a margin: 15 s, 600 ms
 * per block of depth (the climb of M0 took 435 ms per block), 350 ms per block of tunnel.
 * @param {number} depth
 * @param {number} tunnelLength
 * @returns {number} milliseconds
 */
export function returnTimeMs(depth, tunnelLength) {
    const d = isFiniteNumber(depth) && depth > 0 ? depth : 0;
    const t = isFiniteNumber(tunnelLength) && tunnelLength > 0 ? tunnelLength : 0;
    return 15000 + Math.round(d * 600 + t * 350);
}

// ------------------------------------------------------------------ what a trip needs

function counts(inventory) {
    const map = new Map();
    for (const item of Array.isArray(inventory) ? inventory : []) {
        if (item && known(item.name) && isFiniteNumber(item.count) && item.count > 0) {
            map.set(item.name, (map.get(item.name) ?? 0) + item.count);
        }
    }
    return map;
}

function isFood(name, foods) {
    if (foods && typeof foods === 'object' && !Array.isArray(foods)) {
        return isEdibleFood(name, foods);
    }
    if (Array.isArray(foods)) {
        return foods.includes(name);
    }
    return COMMON_FOODS.includes(name);
}

/**
 * The uses left of a pickaxe item: `uses_left` when given, otherwise a new one of its material.
 * @param {{name: string, uses_left?: number}} item
 * @returns {number|null}
 */
export function pickaxeUses(item) {
    const material = pickaxeMaterial(item?.name);
    if (material === null) {
        return null;
    }
    return isFiniteNumber(item.uses_left) ? Math.max(0, item.uses_left) : PICKAXE_USES[material];
}

/**
 * The pickaxes of an inventory that break what `material` breaks, the best material first, then
 * the most uses left.
 * @param {object[]} inventory `{ name, count, uses_left }`
 * @param {string} material
 * @returns {{name: string, material: string, uses: number}[]}
 */
export function usablePickaxes(inventory, material) {
    const out = [];
    for (const item of Array.isArray(inventory) ? inventory : []) {
        const m = pickaxeMaterial(item?.name);
        if (m !== null && pickaxeIsEnough(m, material)) {
            const n = isFiniteNumber(item.count) && item.count > 1 ? Math.floor(item.count) : 1;
            for (let i = 0; i < n; i++) {
                out.push({ name: item.name, material: m, uses: pickaxeUses(item) });
            }
        }
    }
    return out.sort((a, b) => PICKAXE_LEVELS[b.material] - PICKAXE_LEVELS[a.material] || b.uses - a.uses);
}

// The material of a pickaxe as an item and what else it needs to be crafted.
const PICKAXE_MATERIAL_ITEMS = Object.freeze({ wooden: null, stone: 'cobblestone', iron: 'iron_ingot', diamond: 'diamond', golden: 'gold_ingot' });

function haveMaterialFor(material, have) {
    const item = PICKAXE_MATERIAL_ITEMS[material];
    if (!item) {
        return false;
    }
    const sticks = (have.get('stick') ?? 0) >= 2
        || [...have.entries()].some(([name, n]) => (name.endsWith('_planks') && n >= 2) || ((name.endsWith('_log') || name.endsWith('_stem')) && n >= 1));
    // cobblestone is collected on every trip: the shaft gives more than 3
    const enough = material === 'stone' ? true : (have.get(item) ?? 0) >= 3;
    return enough && sticks;
}

/**
 * What a trip for the ore from `fromY` down to `toY` needs, and what of it the inventory lacks
 * (spec M2). Ladders: the depth plus 10 percent, at least 8; torches 16; cobblestone 32; food 8
 * pieces; a chest; a pickaxe of the needed material (at least stone), and a second one or the
 * material for it when the blocks of the trip are more than 80 percent of the uses left. With
 * `options.shaftExists` the mine is there: no ladders, no chest, no shaft and room to dig.
 * @param {string|object} ore
 * @param {number} fromY feet at the entrance
 * @param {number} toY the level
 * @param {object[]} inventory `{ name, count, uses_left }`
 * @param {{foods?: object|string[], tunnelLength?: number, shaftExists?: boolean}} [options]
 * @returns {{needs: object[], missing: object[], blocks: number, depth: number, pickaxe: string|null}}
 */
export function tripNeeds(ore, fromY, toY, inventory, options = {}) {
    const row = oreOf(ore);
    const opts = options && typeof options === 'object' ? options : {};
    const depth = isFiniteNumber(fromY) && isFiniteNumber(toY) ? Math.max(0, Math.floor(fromY) - Math.floor(toY)) : 0;
    const exists = opts.shaftExists === true;
    const tunnel = isFiniteNumber(opts.tunnelLength) && opts.tunnelLength >= 0 ? Math.floor(opts.tunnelLength) : DEFAULT_TUNNEL_LENGTH;
    const blocks = (exists ? 0 : depth + ROOM_BLOCKS) + 2 * tunnel;
    const material = row ? tripPickaxe(row) : null;
    const have = counts(inventory);
    const pickaxes = material ? usablePickaxes(inventory, material) : [];
    const second = pickaxes.length > 0 && blocks > 0.8 * pickaxes[0].uses;
    const needs = [];
    const missing = [];
    if (material) {
        needs.push({ name: 'pickaxe', material, count: second ? 2 : 1 });
        if (pickaxes.length === 0) {
            missing.push({ name: 'pickaxe', material, count: 1 });
        } else if (second && pickaxes.length < 2 && !haveMaterialFor(material, have)) {
            missing.push({ name: 'pickaxe', material, count: 1, spare: true });
        }
    }
    const ladders = exists ? 0 : Math.max(MIN_LADDERS, Math.ceil(depth * 1.1));
    const food = [...have.entries()].filter(([name]) => isFood(name, opts.foods)).reduce((sum, [, n]) => sum + n, 0);
    const wanted = [
        ['ladder', ladders, have.get('ladder') ?? 0],
        ['torch', TRIP_SUPPLIES.torch, have.get('torch') ?? 0],
        ['cobblestone', TRIP_SUPPLIES.cobblestone, have.get('cobblestone') ?? 0],
        ['food', TRIP_SUPPLIES.food, food],
        ['chest', exists ? 0 : TRIP_SUPPLIES.chest, have.get('chest') ?? 0],
    ];
    for (const [name, count, got] of wanted) {
        if (count > 0) {
            needs.push({ name, count });
            if (got < count) {
                missing.push({ name, count: count - got });
            }
        }
    }
    return { needs, missing, blocks, depth, pickaxe: pickaxes.length > 0 ? pickaxes[0].name : null };
}

// ------------------------------------------------------------------ protected areas and the entrance

function center(p) {
    return { x: p.x + 0.5, y: p.y, z: p.z + 0.5 };
}

function boxes(areas) {
    return (Array.isArray(areas) ? areas : []).filter(a => isBox(a));
}

/**
 * True when a column of a shaft or a staircase at (x, z) keeps AREA_DISTANCE (8) blocks from
 * every protected area, measured horizontally from the centre of the block.
 * @param {{x: number, z: number}} p
 * @param {object[]} areas boxes { min, max }
 * @returns {boolean}
 */
export function shaftAllowed(p, areas) {
    return boxes(areas).every(a => horizontalDistanceToBox(a, center({ ...p, y: 0 })) >= AREA_DISTANCE);
}

/**
 * True when a block of a tunnel, a room or a vein may be dug: at least 16 blocks below the lowest
 * block of each area, or 8 blocks from it horizontally.
 * @param {{x,y,z}} p
 * @param {object[]} areas
 * @returns {boolean}
 */
export function tunnelAllowed(p, areas) {
    return boxes(areas).every(a => p.y <= a.min.y - UNDER_AREA_DEPTH || horizontalDistanceToBox(a, center(p)) >= AREA_DISTANCE);
}

/**
 * The cells of the room at the bottom of a shaft (spec M4: 3 x 3 and 3 high): the shaft is the
 * middle of the back row, the room reaches 2 blocks towards `dir` and 1 to each side. Returned
 * top layer first, near the shaft first; the shaft column itself is not in the list. Also the
 * places of the chest (beside the shaft, left), the torch (beside the shaft, right), the start of
 * the tunnel (the middle of the front row) and the second chest.
 * @param {{x,y,z}} base the feet of the bot at the bottom of the shaft
 * @param {string} dir
 * @returns {{cells: object[], chest: object, chest2: object, torch: object, front: object, all: object[]}}
 */
export function roomPlan(base, dir) {
    const d = isDirection(dir) ? dir : 'north';
    const r = rightOf(d);
    const all = [];
    for (let up = 2; up >= 0; up--) {
        for (let a = 0; a <= 2; a++) {
            for (const b of [0, -1, 1]) {
                all.push(offset(offset(base, d, a, up), r, b));
            }
        }
    }
    const cells = all.filter(p => !(p.x === base.x && p.z === base.z));
    return {
        cells,
        all,
        chest: offset(base, r, -1),
        chest2: offset(offset(base, r, -1), d, 1),
        torch: offset(base, r, 1),
        front: offset(base, d, 2),
    };
}

function lineClearance(start, dir, length, areas, level) {
    let min = Infinity;
    for (let k = 0; k <= length; k++) {
        const p = { ...offset(start, dir, k), y: level };
        for (const a of boxes(areas)) {
            if (p.y <= a.min.y - UNDER_AREA_DEPTH) {
                continue;
            }
            min = Math.min(min, horizontalDistanceToBox(a, center(p)));
        }
    }
    return min;
}

/**
 * The directions a new mine at a shaft column may take: the room and the tunnel from it keep to
 * tunnelAllowed for `length` blocks (64). First `prefer` (by default away from the nearest area),
 * then clockwise from it.
 * @param {{x: number, z: number}} shaft
 * @param {number} level
 * @param {object[]} areas
 * @param {{length?: number, prefer?: string}} [options]
 * @returns {string[]}
 */
export function mineDirections(shaft, level, areas, options = {}) {
    const length = isFiniteNumber(options?.length) ? options.length : 64;
    const list = boxes(areas);
    const prefer = isDirection(options?.prefer) ? options.prefer : (list.length > 0 ? awayFrom(shaft, list) : 'north');
    const start = DIRECTIONS.indexOf(prefer);
    const out = [];
    for (let i = 0; i < 4; i++) {
        const d = DIRECTIONS[(start + i) % 4];
        const base = { x: shaft.x, y: level, z: shaft.z };
        const room = roomPlan(base, d);
        const back = offset(base, backOf(d));
        if ([...room.all, back].every(p => tunnelAllowed(p, list)) && lineClearance(base, d, length + 3, list, level) >= AREA_DISTANCE) {
            out.push(d);
        }
    }
    return out;
}

/**
 * The direction of a new mine at a shaft column: the first of mineDirections, or null.
 * @param {{x: number, z: number}} shaft
 * @param {number} level
 * @param {object[]} areas
 * @param {{length?: number, prefer?: string}} [options]
 * @returns {string|null}
 */
export function chooseDirection(shaft, level, areas, options = {}) {
    return mineDirections(shaft, level, areas, options)[0] ?? null;
}

/**
 * The entrance of a new mine (spec M4): a place on the ground at least 8 blocks from every
 * protected area and at most 48 blocks from the bot, the nearest first. The bot stands on the
 * ground at the column behind the shaft (the ladders hang on that wall) and at the column of the
 * shaft itself: both are free for feet and head, on solid ground of the same height. The
 * direction comes from chooseDirection.
 * @param {{bot: {x,y,z}, level: number, areas?: object[], ground: (x: number, z: number) => {y: number, name: string}|null,
 *   free?: (x: number, y: number, z: number) => boolean, range?: number, length?: number, avoid?: {x: number, z: number}[]}} input
 *   ground(x, z): the top solid block of the column near the bot (its y and name), null when unknown;
 *   avoid: columns of other mines, kept AVOID_DISTANCE (4) away from
 * @returns {{x: number, y: number, z: number, dir: string}|null} x, y, z: the feet of the bot above the shaft
 */
export function chooseEntrance(input) {
    const start = cellOf(input?.bot);
    if (!start || typeof input.ground !== 'function' || !isFiniteNumber(input.level)) {
        return null;
    }
    const range = isFiniteNumber(input.range) ? Math.min(input.range, ENTRANCE_RANGE) : ENTRANCE_RANGE;
    const areas = boxes(input.areas);
    const free = typeof input.free === 'function' ? input.free : () => true;
    const groundAt = (x, z) => {
        try {
            const g = input.ground(x, z);
            return g && isFiniteNumber(g.y) && classify(g.name) === 'solid' && !isFalling(g.name) ? g : null;
        } catch {
            return null;
        }
    };
    const candidates = [];
    const r = Math.floor(range);
    for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
            const d = Math.hypot(dx, dz);
            if (d <= range) {
                candidates.push({ x: start.x + dx, z: start.z + dz, d });
            }
        }
    }
    candidates.sort((a, b) => a.d - b.d || a.x - b.x || a.z - b.z);
    const prefer = areas.length > 0 ? awayFrom(start, areas) : 'north';
    const avoid = (Array.isArray(input.avoid) ? input.avoid : []).filter(p => p && isFiniteNumber(p.x) && isFiniteNumber(p.z));
    const clear = p => avoid.every(a => Math.hypot(a.x - p.x, a.z - p.z) >= AVOID_DISTANCE);
    for (const c of candidates) {
        if (!shaftAllowed(c, areas) || !clear(c)) {
            continue;
        }
        const g = groundAt(c.x, c.z);
        if (!g) {
            continue;
        }
        const feet = { x: c.x, y: g.y + 1, z: c.z };
        if (!free(feet.x, feet.y, feet.z) || !free(feet.x, feet.y + 1, feet.z)) {
            continue;
        }
        for (const dir of mineDirections(c, input.level, areas, { length: input.length, prefer })) {
            const back = offset(feet, backOf(dir));
            const gb = groundAt(back.x, back.z);
            if (gb && gb.y === g.y && shaftAllowed(back, areas) && clear(back) && free(back.x, back.y, back.z) && free(back.x, back.y + 1, back.z)) {
                return { ...feet, dir };
            }
        }
    }
    return null;
}

function awayFrom(p, areas) {
    let nearest = null;
    let best = Infinity;
    for (const a of areas) {
        const d = horizontalDistanceToBox(a, center({ x: p.x, y: 0, z: p.z }));
        if (d < best) {
            best = d;
            nearest = a;
        }
    }
    if (!nearest) {
        return 'north';
    }
    const cx = (nearest.min.x + nearest.max.x + 1) / 2;
    const cz = (nearest.min.z + nearest.max.z + 1) / 2;
    return directionOf(p.x + 0.5 - cx, p.z + 0.5 - cz) ?? 'north';
}

/**
 * True when two positions are the same block.
 * @param {{x,y,z}} a
 * @param {{x,y,z}} b
 * @returns {boolean}
 */
export function sameCell(a, b) {
    const ca = cellOf(a);
    const cb = cellOf(b);
    return Boolean(ca && cb) && samePos(ca, cb);
}
