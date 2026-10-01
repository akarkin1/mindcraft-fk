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
/** The entrance of a new mine keeps this far from the place `home` and the areas of ENTRANCE_AREA_TYPES (v0.1.4.8, E4). */
export const ENTRANCE_DISTANCE = 16;
/** The types of areas a new entrance keeps ENTRANCE_DISTANCE from. */
export const ENTRANCE_AREA_TYPES = Object.freeze(['home', 'building', 'pen', 'farm']);
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
 * (beyond). `step` is the number of the step in the tunnel, from 1. With a `senseRange` of 2 or 3
 * (the setting ore_sense_range, v0.1.4.9 B7) the view also has `sensed`: the ore blocks deeper in
 * the walls, the ceiling and the floor of the column ahead (senseOres); with 0 it is the view of
 * v0.1.4.7.
 * @param {(x: number, y: number, z: number) => string|null} getBlockName
 * @param {{x,y,z}} feet
 * @param {string} dir
 * @param {number} [step]
 * @param {number} [senseRange]
 * @returns {object}
 */
export function tunnelView(getBlockName, feet, dir, step = 1, senseRange = 0) {
    const slots = tunnelSlots(feet, dir);
    const name = key => readName(getBlockName, slots[key]);
    const view = {
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
    if (isFiniteNumber(senseRange) && senseRange >= 2) {
        view.sensed = senseOres(getBlockName, feet, dir, senseRange);
    }
    return view;
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
    return veinParts(start, getBlockName, limit).take;
}

/**
 * The parts of one vein (v0.1.4.9, B6): `take` is veinOrder, `lava` the ore blocks of the vein that
 * were left out for lava beside them, `beyond` the blocks of the vein past the limit (nearest
 * first). All empty when `start` is no ore.
 * @param {{x,y,z}} start
 * @param {(x: number, y: number, z: number) => string|null} getBlockName
 * @param {number} [limit]
 * @returns {{take: object[], lava: object[], beyond: object[]}} each `{ x, y, z, name }`
 */
export function veinParts(start, getBlockName, limit = 12) {
    const first = cellOf(start);
    if (!first || typeof getBlockName !== 'function') {
        return { take: [], lava: [], beyond: [] };
    }
    const firstName = readName(getBlockName, first);
    const row = isOreBlock(firstName) ? oreOf(firstName) : null;
    if (!row) {
        return { take: [], lava: [], beyond: [] };
    }
    const max = isFiniteNumber(limit) && limit > 0 ? Math.floor(limit) : 12;
    const sameOre = name => isOreBlock(name) && oreOf(name) === row;
    const lavaBeside = p => faceNeighbours(p).some(n => readName(getBlockName, n) === 'lava');
    const found = [];
    const lava = [];
    const seen = new Set([posKey(first)]);
    const queue = [{ ...first, name: firstName }];
    let order = 0;
    while (queue.length > 0 && seen.size < 256) {
        const p = queue.shift();
        if (lavaBeside(p)) {
            lava.push({ x: p.x, y: p.y, z: p.z, name: p.name });
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
    const sorted = found.sort((a, b) => dist(a) - dist(b) || a.order - b.order).map(({ x, y, z, name }) => ({ x, y, z, name }));
    return { take: sorted.slice(0, max), lava, beyond: sorted.slice(max) };
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
 * `options.shaftExists` the way down of the mine is there (its route has a leg): ladders only for
 * the part below `options.wayDownTo` (the feet at the end of the way, spec v0.1.4.8 E4), plus 10
 * percent, and no chest and no room while `options.hasBase` is not false. Without `wayDownTo` the
 * way reaches the level.
 * @param {string|object} ore
 * @param {number} fromY feet at the entrance
 * @param {number} toY the level
 * @param {object[]} inventory `{ name, count, uses_left }`
 * @param {{foods?: object|string[], tunnelLength?: number, shaftExists?: boolean, wayDownTo?: number, hasBase?: boolean}} [options]
 * @returns {{needs: object[], missing: object[], blocks: number, depth: number, rest: number, pickaxe: string|null}}
 *   rest: the blocks of the way down that are still to dig
 */
export function tripNeeds(ore, fromY, toY, inventory, options = {}) {
    const row = oreOf(ore);
    const opts = options && typeof options === 'object' ? options : {};
    const depth = isFiniteNumber(fromY) && isFiniteNumber(toY) ? Math.max(0, Math.floor(fromY) - Math.floor(toY)) : 0;
    const exists = opts.shaftExists === true;
    const rest = !exists ? depth : (isFiniteNumber(opts.wayDownTo) && isFiniteNumber(toY) ? Math.max(0, Math.floor(opts.wayDownTo) - Math.floor(toY)) : 0);
    const base = exists && opts.hasBase !== false;
    const tunnel = isFiniteNumber(opts.tunnelLength) && opts.tunnelLength >= 0 ? Math.floor(opts.tunnelLength) : DEFAULT_TUNNEL_LENGTH;
    const blocks = rest + (base ? 0 : ROOM_BLOCKS) + 2 * tunnel;
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
    // a new shaft takes at least MIN_LADDERS; the rest of a shaft that is there takes what it lacks
    const ladders = !exists ? Math.max(MIN_LADDERS, Math.ceil(depth * 1.1)) : (rest > 0 ? Math.ceil(rest * 1.1) : 0);
    const food = [...have.entries()].filter(([name]) => isFood(name, opts.foods)).reduce((sum, [, n]) => sum + n, 0);
    const wanted = [
        ['ladder', ladders, have.get('ladder') ?? 0],
        ['torch', TRIP_SUPPLIES.torch, have.get('torch') ?? 0],
        ['cobblestone', TRIP_SUPPLIES.cobblestone, have.get('cobblestone') ?? 0],
        ['food', TRIP_SUPPLIES.food, food],
        ['chest', base ? 0 : TRIP_SUPPLIES.chest, have.get('chest') ?? 0],
    ];
    for (const [name, count, got] of wanted) {
        if (count > 0) {
            needs.push({ name, count });
            if (got < count) {
                missing.push({ name, count: count - got });
            }
        }
    }
    return { needs, missing, blocks, depth, rest, pickaxe: pickaxes.length > 0 ? pickaxes[0].name : null };
}

/**
 * How a trip for an ore starts (spec v0.1.4.8 E4): `use` the known mine; without one, `underground`
 * when the bot is under the ground (a new mine starts only from the surface), `ask` when the player
 * did not order a new mine, else `new`.
 * @param {{mine?: object|null, newMine?: boolean, underground?: boolean}} input
 * @returns {'use'|'underground'|'ask'|'new'}
 */
export function tripStart(input) {
    if (input?.mine) {
        return 'use';
    }
    if (input?.underground === true) {
        return 'underground';
    }
    return input?.newMine === true ? 'new' : 'ask';
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
 * True when the entrance of a new mine may be at (x, z) (spec v0.1.4.8 E4): shaftAllowed, and at
 * least ENTRANCE_DISTANCE (16) blocks, horizontally from the centre of the block, from every area
 * of the types home, building, pen and farm (an area without a type is a building) and from every
 * point of `homes` (the place `home`).
 * @param {{x: number, z: number}} p
 * @param {object[]} areas
 * @param {{x: number, z: number}[]} [homes]
 * @returns {boolean}
 */
export function entranceAllowed(p, areas, homes = []) {
    if (!shaftAllowed(p, areas)) {
        return false;
    }
    const c = center({ ...p, y: 0 });
    const kept = boxes(areas).filter(a => ENTRANCE_AREA_TYPES.includes(typeof a.type === 'string' && a.type.length > 0 ? a.type : 'building'));
    if (kept.some(a => horizontalDistanceToBox(a, c) < ENTRANCE_DISTANCE)) {
        return false;
    }
    const points = (Array.isArray(homes) ? homes : []).filter(h => h && isFiniteNumber(h.x) && isFiniteNumber(h.z));
    return points.every(h => Math.hypot(h.x - c.x, h.z - c.z) >= ENTRANCE_DISTANCE);
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
 * protected area and at most 48 blocks from the bot, the nearest first; since v0.1.4.8 (E4) at
 * least 16 blocks from the areas of the types home, building, pen and farm and from the place
 * `home` (entranceAllowed). The bot stands on the ground at the column behind the shaft (the
 * ladders hang on that wall) and at the column of the shaft itself: both are free for feet and
 * head, on solid ground of the same height. The direction comes from chooseDirection.
 * @param {{bot: {x,y,z}, level: number, areas?: object[], ground: (x: number, z: number) => {y: number, name: string}|null,
 *   free?: (x: number, y: number, z: number) => boolean, range?: number, length?: number, avoid?: {x: number, z: number}[],
 *   homes?: {x: number, z: number}[]}} input
 *   ground(x, z): the top solid block of the column near the bot (its y and name), null when unknown;
 *   avoid: columns of other mines, kept AVOID_DISTANCE (4) away from; homes: the place `home`
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
    const homes = Array.isArray(input.homes) ? input.homes : [];
    for (const c of candidates) {
        if (!entranceAllowed(c, areas, homes) || !clear(c)) {
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
            if (gb && gb.y === g.y && entranceAllowed(back, areas, homes) && clear(back) && free(back.x, back.y, back.z) && free(back.x, back.y + 1, back.z)) {
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

// ------------------------------------------------------------------ the mine of the player (v0.1.4.9)
//
// A mine of v0.1.4.9 (spec I6) may also have a name, a source ('bot' or 'player'), a room of the
// player ({ center, chest, table, furnace }), tunnels ([{ start, dir, end, level, length, branches }])
// and the ore list `passed`. The functions here read such a mine; they never change it.

/** A tunnel gets side branches from this length on (spec B5). */
export const BRANCH_FROM = 32;
/** A side branch every this many blocks of the main tunnel, from its start. */
export const BRANCH_EVERY = 4;
/** The length of a side branch. */
export const BRANCH_LENGTH = 8;
/** The reasons of the ore list (spec B6), in the order the texts name them. */
export const PASSED_REASONS = Object.freeze(['pickaxe', 'lava', 'inventory', 'vein', 'stopped']);
/** The most entries of the ore list of one mine; the oldest leave. */
export const MAX_PASSED = 200;
/** How far corridorDirections and measureTunnel look along a corridor. */
export const CORRIDOR_LIMIT = 64;
/** The deepest sense range of the setting ore_sense_range (spec B7). */
export const MAX_SENSE_RANGE = 3;

// a cell without -0 in it (Math.round(-0.4) is -0)
function round0(v) {
    return Math.round(v) + 0;
}

function uniqueCells(list) {
    const seen = new Set();
    return list.filter(p => {
        const k = posKey(p);
        if (seen.has(k)) {
            return false;
        }
        seen.add(k);
        return true;
    });
}

// the cells of a straight or slanted line from a to b, both ends included
function lineCells(a, b) {
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), Math.abs(b.z - a.z));
    const out = [];
    for (let k = 0; k <= n; k++) {
        const t = n === 0 ? 0 : k / n;
        out.push({ x: round0(a.x + (b.x - a.x) * t), y: round0(a.y + (b.y - a.y) * t), z: round0(a.z + (b.z - a.z) * t) });
    }
    return out;
}

/**
 * The cells a leg of a route covers (spec I2, B8; the routes pack has the same rule and is not
 * imported): a ladder its column from bottom to top and the cell of its entry; a walk and a
 * staircase the straight line of cells from `from` to `to`; a door `from`, the openable and `to`.
 * @param {object} leg
 * @returns {{x: number, y: number, z: number}[]}
 */
export function legCells(leg) {
    if (!leg || typeof leg !== 'object') {
        return [];
    }
    if (leg.kind === 'ladder') {
        if (![leg.x, leg.z, leg.top, leg.bottom].every(isFiniteNumber)) {
            return [];
        }
        const out = [];
        for (let y = Math.floor(Math.min(leg.top, leg.bottom)); y <= Math.floor(Math.max(leg.top, leg.bottom)); y++) {
            out.push({ x: Math.floor(leg.x), y, z: Math.floor(leg.z) });
        }
        const entry = cellOf(leg.entry);
        return uniqueCells(entry ? [...out, entry] : out);
    }
    if (leg.kind === 'door') {
        return uniqueCells([cellOf(leg.from), cellOf(leg), cellOf(leg.to)].filter(Boolean));
    }
    if (leg.kind === 'walk' || leg.kind === 'stairs') {
        const a = cellOf(leg.from);
        const b = cellOf(leg.to);
        return a && b ? uniqueCells(lineCells(a, b)) : [];
    }
    return [];
}

/**
 * The end of a leg: where the bot stands after it (a ladder: the bottom of its column).
 * @param {object} leg
 * @returns {{x: number, y: number, z: number}|null}
 */
export function legEnd(leg) {
    if (leg?.kind === 'ladder') {
        return isFiniteNumber(leg.x) && isFiniteNumber(leg.bottom) && isFiniteNumber(leg.z)
            ? { x: Math.floor(leg.x), y: Math.floor(leg.bottom), z: Math.floor(leg.z) } : null;
    }
    return cellOf(leg?.to);
}

// The tunnel of a mine of the bot (v0.1.4.7): from the first corner of mine.tunnel (or the end) to
// mine.end, in mine.direction, at the level of the mine. The branches are those kept in tunnels[0].
function ownTunnel(mine, first) {
    if (!mine || mine.source === 'player' || !isDirection(mine.direction)) {
        return null;
    }
    const end = cellOf(mine.end);
    if (!end) {
        return null;
    }
    const corners = (Array.isArray(mine.tunnel) ? mine.tunnel : []).map(cellOf).filter(Boolean);
    const tunnel = {
        start: corners[0] ?? end,
        dir: mine.direction,
        end,
        level: isFiniteNumber(mine.level) ? Math.floor(mine.level) : end.y,
        length: isFiniteNumber(mine.length) && mine.length > 0 ? Math.floor(mine.length) : 0,
        branches: Array.isArray(first?.branches) ? first.branches : [],
    };
    if (corners.length > 0) {
        tunnel.corners = corners;
    }
    return tunnel;
}

/**
 * The tunnels of a mine in one shape (spec B1): `mine.tunnels`, and for a mine of the bot with a
 * direction and an end its own tunnel of v0.1.4.7 as the first one (with the branches kept in the
 * first entry of `tunnels`). Empty for a mine without a tunnel.
 * @param {object} mine
 * @returns {{start: object, dir: string, end: object, level: number, length: number, branches: object[], corners?: object[]}[]}
 */
export function tunnelsOf(mine) {
    const stored = (Array.isArray(mine?.tunnels) ? mine.tunnels : [])
        .filter(t => t && typeof t === 'object' && cellOf(t.start) && cellOf(t.end) && isDirection(t.dir));
    const own = ownTunnel(mine, stored[0]);
    return own ? [own, ...stored.slice(1)] : stored.slice();
}

/**
 * The feet cells of a tunnel: along its corners when it has them, else from start to end.
 * @param {object} tunnel
 * @returns {{x: number, y: number, z: number}[]}
 */
export function tunnelCells(tunnel) {
    const corners = (Array.isArray(tunnel?.corners) && tunnel.corners.length >= 2 ? tunnel.corners : [tunnel?.start, tunnel?.end])
        .map(cellOf).filter(Boolean);
    if (corners.length === 0) {
        return [];
    }
    const out = [corners[0]];
    for (let i = 1; i < corners.length; i++) {
        out.push(...lineCells(corners[i - 1], corners[i]).slice(1));
    }
    return uniqueCells(out);
}

/**
 * The feet cells of a side branch that were dug: from its start to its end; none while its length is 0.
 * @param {object} branch
 * @returns {{x: number, y: number, z: number}[]}
 */
export function branchCells(branch) {
    const a = cellOf(branch?.start);
    const b = cellOf(branch?.end);
    if (!a || !b || !isFiniteNumber(branch.length) || branch.length <= 0) {
        return [];
    }
    return uniqueCells(lineCells(a, b));
}

/**
 * The box of the room of a mine: for a room of the player the box around its center, chest, table
 * and furnace, 3 high; for a mine of the bot the room of roomPlan. null without a room.
 * @param {object} mine
 * @returns {{min: object, max: object}|null}
 */
export function roomBox(mine) {
    let points = [];
    let height = 0;
    if (mine?.room && cellOf(mine.room.center)) {
        points = [mine.room.center, mine.room.chest, mine.room.table, mine.room.furnace].map(cellOf).filter(Boolean);
        height = 2;
    } else if (cellOf(mine?.base) && isDirection(mine?.direction)) {
        points = roomPlan(cellOf(mine.base), mine.direction).all;
    }
    if (points.length === 0) {
        return null;
    }
    const min = { x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)), z: Math.min(...points.map(p => p.z)) };
    const max = { x: Math.max(...points.map(p => p.x)), y: Math.max(...points.map(p => p.y)) + height, z: Math.max(...points.map(p => p.z)) };
    return { min, max };
}

function nearCell(a, b, range = 1) {
    return Math.abs(a.x - b.x) <= range && Math.abs(a.y - b.y) <= range && Math.abs(a.z - b.z) <= range;
}

function nearBox(box, p, range = 1) {
    return p.x >= box.min.x - range && p.x <= box.max.x + range && p.y >= box.min.y - range && p.y <= box.max.y + range
        && p.z >= box.min.z - range && p.z <= box.max.z + range;
}

// a feet cell of a tunnel is 2 high: the feet and the head
function nearTunnelCell(cell, p) {
    return nearCell(cell, p) || nearCell({ x: cell.x, y: cell.y + 1, z: cell.z }, p);
}

function tunnelHit(tunnel, p) {
    if (tunnelCells(tunnel).some(c => nearTunnelCell(c, p))) {
        return true;
    }
    return (Array.isArray(tunnel.branches) ? tunnel.branches : []).some(b => branchCells(b).some(c => nearTunnelCell(c, p)));
}

/**
 * The mine at a position (spec I6, B8): the position is within 1 block of a cell of a tunnel (start
 * to end, 2 high, with its branches), of the room, or of a leg of the route (legCells). A tunnel
 * wins over a room, a room over a route. `tunnel` is the index of the tunnel in tunnelsOf(mine).
 * @param {object[]} mines
 * @param {{x,y,z}} pos
 * @returns {{mine: object, tunnel: number|null, onRoute: boolean}|null}
 */
export function mineAt(mines, pos) {
    const p = cellOf(pos);
    if (!p || !Array.isArray(mines)) {
        return null;
    }
    let room = null;
    let route = null;
    for (const mine of mines) {
        if (!mine || typeof mine !== 'object') {
            continue;
        }
        const tunnels = tunnelsOf(mine);
        for (let i = 0; i < tunnels.length; i++) {
            if (tunnelHit(tunnels[i], p)) {
                return { mine, tunnel: i, onRoute: false };
            }
        }
        const box = room ? null : roomBox(mine);
        if (box && nearBox(box, p)) {
            room = mine;
        }
        if (!route && (Array.isArray(mine.route) ? mine.route : []).some(leg => legCells(leg).some(c => nearCell(c, p)))) {
            route = mine;
        }
    }
    if (room) {
        return { mine: room, tunnel: null, onRoute: false };
    }
    return route ? { mine: route, tunnel: null, onRoute: true } : null;
}

/**
 * The index of the leg of a route nearest to a position (by its cells), or -1 for an empty route.
 * @param {object[]} legs
 * @param {{x,y,z}} pos
 * @returns {number}
 */
export function nearestLeg(legs, pos) {
    const p = cellOf(pos);
    let best = -1;
    let bestD = Infinity;
    (Array.isArray(legs) ? legs : []).forEach((leg, i) => {
        for (const c of legCells(leg)) {
            const d = p ? Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z) : 0;
            if (d < bestD) {
                best = i;
                bestD = d;
            }
        }
    });
    return best;
}

function boxDistance(box, p) {
    const gap = (v, lo, hi) => (v < lo ? lo - v : v > hi ? v - hi : 0);
    return Math.hypot(gap(p.x, box.min.x, box.max.x), gap(p.y, box.min.y, box.max.y), gap(p.z, box.min.z, box.max.z));
}

/**
 * The distance from a position to a mine (spec I6, `nearest`): to its entrance and to the nearest
 * cell of its route, its room and its tunnels with their branches. Infinity for a mine without any.
 * @param {object} mine
 * @param {{x,y,z}} pos
 * @returns {number}
 */
export function mineDistance(mine, pos) {
    const p = cellOf(pos);
    if (!p || !mine) {
        return Infinity;
    }
    const cells = [];
    const entrance = cellOf(mine.entrance);
    if (entrance) {
        cells.push(entrance);
    }
    for (const leg of Array.isArray(mine.route) ? mine.route : []) {
        cells.push(...legCells(leg));
    }
    for (const t of tunnelsOf(mine)) {
        cells.push(...tunnelCells(t));
        for (const b of Array.isArray(t.branches) ? t.branches : []) {
            cells.push(...branchCells(b));
        }
    }
    let best = cells.reduce((d, c) => Math.min(d, Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z)), Infinity);
    const box = roomBox(mine);
    if (box) {
        best = Math.min(best, boxDistance(box, p));
    }
    return best;
}

/**
 * The tunnel of a mine for an ore (spec I6, B4): the tunnel whose level lies in the range of the
 * ore (min to max of the ore table), the one nearest to the best level of the ore; the first of
 * equals. null when no tunnel fits or the ore is unknown.
 * @param {object} mine
 * @param {string|object} ore
 * @returns {number|null} the index in tunnelsOf(mine)
 */
export function tunnelFor(mine, ore) {
    const row = oreOf(ore);
    if (!row || !mine) {
        return null;
    }
    let best = null;
    let bestD = Infinity;
    tunnelsOf(mine).forEach((t, i) => {
        const level = isFiniteNumber(t.level) ? t.level : cellOf(t.start)?.y;
        if (!isFiniteNumber(level) || level < row.min || level > row.max) {
            return;
        }
        const d = Math.abs(level - row.level);
        if (d < bestD) {
            best = i;
            bestD = d;
        }
    });
    return best;
}

/**
 * The next side branch of a tunnel (spec B5): none while the tunnel is shorter than 32. Branches
 * leave the tunnel at 4, 8, 12, ... blocks from its start (while that cell is in the tunnel), at
 * each first to the left, then to the right, 8 blocks long; the first one that is not done, the
 * nearest to the start first. null when every branch of its length is done: the main tunnel goes on.
 * @param {object} tunnel
 * @returns {{at: number, side: 'left'|'right', dir: string, junction: object, start: object, end: object,
 *   length: number, done: false, index: number|null}|null} end: where the digging goes on (the
 *   junction in the tunnel while nothing is dug); index: the index in tunnel.branches, null for a new one
 */
export function branchPlan(tunnel) {
    const start = cellOf(tunnel?.start);
    const length = isFiniteNumber(tunnel?.length) ? Math.floor(tunnel.length) : 0;
    if (!start || !isDirection(tunnel.dir) || length < BRANCH_FROM) {
        return null;
    }
    const branches = Array.isArray(tunnel.branches) ? tunnel.branches : [];
    for (let at = BRANCH_EVERY; at < length; at += BRANCH_EVERY) {
        for (const side of ['left', 'right']) {
            const index = branches.findIndex(b => b && b.at === at && b.side === side);
            const old = index >= 0 ? branches[index] : null;
            if (old?.done === true) {
                continue;
            }
            const dir = side === 'left' ? leftOf(tunnel.dir) : rightOf(tunnel.dir);
            const junction = offset(start, tunnel.dir, at);
            const dug = isFiniteNumber(old?.length) && old.length > 0 ? Math.floor(old.length) : 0;
            return {
                at, side, dir, junction,
                start: cellOf(old?.start) ?? offset(junction, dir, 1),
                end: dug > 0 ? cellOf(old?.end) ?? offset(junction, dir, dug) : junction,
                length: dug,
                done: false,
                index: index >= 0 ? index : null,
            };
        }
    }
    return null;
}

// a cell the bot can stand in: feet and head open
function openCell(getName, p) {
    return classify(readName(getName, p)) === 'air' && classify(readName(getName, { x: p.x, y: p.y + 1, z: p.z })) === 'air';
}

function openNeighbours(getName, p) {
    return DIRECTIONS.filter(d => openCell(getName, offset(p, d))).length;
}

/**
 * The directions of the corridors at the feet (spec I6, B3): for each direction the open cells
 * ahead (feet and head open) in a row, the directions with 2 or more, the longest first.
 * @param {(x: number, y: number, z: number) => string|null} getName
 * @param {{x,y,z}} feet
 * @returns {{dir: string, length: number}[]}
 */
export function corridorDirections(getName, feet) {
    const f = cellOf(feet);
    if (!f || typeof getName !== 'function') {
        return [];
    }
    const out = [];
    for (const dir of DIRECTIONS) {
        let n = 0;
        while (n < CORRIDOR_LIMIT && openCell(getName, offset(f, dir, n + 1))) {
            n++;
        }
        if (n >= 2) {
            out.push({ dir, length: n });
        }
    }
    return out.sort((a, b) => b.length - a.length || DIRECTIONS.indexOf(a.dir) - DIRECTIONS.indexOf(b.dir));
}

/**
 * The tunnel the bot stands in, measured in `dir` (spec I6, B3): `end` the last open cell ahead
 * before rock, `start` the last open cell behind the bot before the corridor opens into a room (a
 * cell with 3 or more open neighbours at the feet level) or ends, `level` the feet, `length` the
 * cells from start to end. null when the feet are not open or `dir` is no direction.
 * @param {(x: number, y: number, z: number) => string|null} getName
 * @param {{x,y,z}} feet
 * @param {string} dir
 * @returns {{start: object, end: object, length: number, level: number, dir: string}|null}
 */
export function measureTunnel(getName, feet, dir) {
    const f = cellOf(feet);
    if (!f || typeof getName !== 'function' || !isDirection(dir) || !openCell(getName, f)) {
        return null;
    }
    let end = f;
    for (let k = 1; k <= CORRIDOR_LIMIT; k++) {
        const p = offset(f, dir, k);
        if (!openCell(getName, p)) {
            break;
        }
        end = p;
    }
    let start = f;
    for (let k = 1; k <= CORRIDOR_LIMIT; k++) {
        const p = offset(f, backOf(dir), k);
        if (!openCell(getName, p) || openNeighbours(getName, p) >= 3) {
            break;
        }
        start = p;
    }
    return { start, end, length: Math.abs(end.x - start.x) + Math.abs(end.z - start.z) + 1, level: f.y, dir };
}

/**
 * True when every cell of a measured tunnel, from its start to its end, has at most 2 open
 * neighbours at the feet level: a corridor, not the floor of a room.
 * @param {(x: number, y: number, z: number) => string|null} getName
 * @param {{start: object, end: object}} tunnel
 * @returns {boolean}
 */
export function isCorridor(getName, tunnel) {
    const cells = tunnelCells(tunnel);
    return cells.length > 0 && typeof getName === 'function' && cells.every(c => openNeighbours(getName, c) <= 2);
}

// > 0: the direction points away from the anchor, as seen from the feet; < 0: towards it; 0: across.
function awayFromAnchor(dir, feet, anchor) {
    const v = dirVector(dir);
    return v.x * (feet.x - anchor.x) + v.z * (feet.z - anchor.z);
}

/**
 * The direction of a tunnel (spec B3): with the yaw of the player (mineflayer: 0 is north, pi/2
 * west) the direction of the corridors, or its opposite, nearest to where the player looks (when it
 * is within 60 degrees); else the longest corridor, turned to point away from `anchor` (the room or
 * the way in of the mine: a tunnel goes on away from it). Fix round F6: the yaw is ignored when the
 * direction it chooses points towards the anchor (a stale yaw of a player who did not turn); without
 * an anchor the yaw decides as before. null without a corridor.
 * @param {{dir: string, length: number}[]} dirs corridorDirections
 * @param {{x,y,z}} feet
 * @param {{yaw?: number, anchor?: {x,y,z}}} [options]
 * @returns {string|null}
 */
export function tunnelDirection(dirs, feet, options = {}) {
    const list = (Array.isArray(dirs) ? dirs : []).filter(d => isDirection(d?.dir))
        .sort((a, b) => (b.length ?? 0) - (a.length ?? 0));
    if (list.length === 0) {
        return null;
    }
    const a = cellOf(options?.anchor);
    const f = cellOf(feet);
    if (isFiniteNumber(options?.yaw)) {
        const look = { x: -Math.sin(options.yaw), z: -Math.cos(options.yaw) };
        const axis = [...new Set(list.flatMap(d => [d.dir, backOf(d.dir)]))];
        const scored = axis.map(d => ({ d, dot: dirVector(d).x * look.x + dirVector(d).z * look.z })).sort((x, y) => y.dot - x.dot);
        if (scored[0].dot >= 0.5 && !(a && f && awayFromAnchor(scored[0].d, f, a) < 0)) {
            return scored[0].d;
        }
    }
    const longest = list[0].dir;
    if (a && f && awayFromAnchor(longest, f, a) < 0) {
        return backOf(longest);
    }
    return longest;
}

// ------------------------------------------------------------------ the ore list (v0.1.4.9, B6)

/**
 * A clean entry of the ore list: `{ ore, x, y, z, reason, seen }` with the name of the ore of the
 * table (`gold` for `deepslate_gold_ore`), a cell, a reason of PASSED_REASONS and the time it was
 * seen (an ISO string, else `seen`). null for anything else.
 * @param {object} entry
 * @param {string|null} [seen]
 * @returns {{ore: string, x: number, y: number, z: number, reason: string, seen: string|null}|null}
 */
export function cleanPassedEntry(entry, seen = null) {
    const row = oreOf(entry?.ore);
    const p = cellOf(entry);
    if (!row || !p || !PASSED_REASONS.includes(entry.reason)) {
        return null;
    }
    return { ore: row.ore, ...p, reason: entry.reason, seen: typeof entry.seen === 'string' ? entry.seen : seen };
}

/**
 * The ore list with an entry added: an entry at the same cell is replaced, the new one is the
 * newest, and the oldest leave beyond `max` (200).
 * @param {object[]} list
 * @param {object} entry
 * @param {number} [max]
 * @returns {object[]} a new list
 */
export function addPassedEntry(list, entry, max = MAX_PASSED) {
    const old = (Array.isArray(list) ? list : []).map(e => cleanPassedEntry(e)).filter(Boolean);
    const clean = cleanPassedEntry(entry);
    if (!clean) {
        return old;
    }
    const out = old.filter(e => !samePos(e, clean));
    out.push(clean);
    const limit = isFiniteNumber(max) && max > 0 ? Math.floor(max) : MAX_PASSED;
    return out.slice(-limit);
}

/**
 * The ore list without the entry at a cell.
 * @param {object[]} list
 * @param {{x,y,z}} pos
 * @returns {object[]} a new list
 */
export function removePassedAt(list, pos) {
    const p = cellOf(pos);
    const old = (Array.isArray(list) ? list : []).map(e => cleanPassedEntry(e)).filter(Boolean);
    return p ? old.filter(e => !samePos(e, p)) : old;
}

// ------------------------------------------------------------------ the sense range (v0.1.4.9, B7)

/**
 * The ore blocks deeper in the walls, the ceiling and the floor of the column ahead of a tunnel
 * step (spec B7): left and right at the feet and the head, 2 to `range` blocks from the column;
 * above the ceiling and below the floor, 2 to `range` blocks from the head or the feet. The first
 * block around the column is the business of tunnelStep. Nearest first.
 * @param {(x: number, y: number, z: number) => string|null} getBlockName
 * @param {{x,y,z}} feet
 * @param {string} dir
 * @param {number} range 2 or 3
 * @returns {{x: number, y: number, z: number, name: string, side: 'left'|'right'|'above'|'below', depth: number, up: number}[]}
 *   up: 0 at the feet, 1 at the head (walls)
 */
export function senseOres(getBlockName, feet, dir, range) {
    const f = cellOf(feet);
    if (!f || typeof getBlockName !== 'function') {
        return [];
    }
    const d = isDirection(dir) ? dir : 'north';
    const max = Math.min(MAX_SENSE_RANGE, isFiniteNumber(range) ? Math.floor(range) : 0);
    const lower = offset(f, d);
    const out = [];
    for (let depth = 2; depth <= max; depth++) {
        for (const [side, sideDir] of [['left', leftOf(d)], ['right', rightOf(d)]]) {
            for (const up of [0, 1]) {
                out.push({ ...offset(lower, sideDir, depth, up), side, depth, up });
            }
        }
        out.push({ ...offset(lower, d, 0, 1 + depth), side: 'above', depth, up: 1 });
        out.push({ ...offset(lower, d, 0, -depth), side: 'below', depth, up: 0 });
    }
    return out.map(p => ({ ...p, name: readName(getBlockName, p) })).filter(p => isOreBlock(p.name));
}

/**
 * The side cut to an ore that senseOres found (spec B7), for a bot whose feet are in the column of
 * that step: the cells to dig, 1 wide and 2 high towards a wall, 1 wide upwards to the ceiling,
 * and down through the floor from the cell behind (`stand`, the bot must not stand on the cut);
 * `refill` is the floor cell to close again after a cut down.
 * @param {{x,y,z}} feet
 * @param {string} dir the direction of the tunnel
 * @param {{side: string, depth: number, up: number}} ore
 * @returns {{cells: object[], stand: object|null, refill: object[]}}
 */
export function senseCut(feet, dir, ore) {
    const f = cellOf(feet);
    const d = isDirection(dir) ? dir : 'north';
    const depth = isFiniteNumber(ore?.depth) ? Math.floor(ore.depth) : 0;
    if (!f || depth < 1) {
        return { cells: [], stand: null, refill: [] };
    }
    const cells = [];
    if (ore.side === 'left' || ore.side === 'right') {
        const sideDir = ore.side === 'left' ? leftOf(d) : rightOf(d);
        for (let k = 1; k < depth; k++) {
            cells.push(offset(f, sideDir, k, 1), offset(f, sideDir, k));
        }
        return { cells, stand: null, refill: [] };
    }
    if (ore.side === 'above') {
        for (let k = 1; k < depth; k++) {
            cells.push(offset(f, d, 0, 1 + k));
        }
        return { cells, stand: null, refill: [] };
    }
    for (let k = 1; k < depth; k++) {
        cells.push(offset(f, d, 0, -k));
    }
    return { cells, stand: offset(f, backOf(d)), refill: [offset(f, d, 0, -1)] };
}

// ------------------------------------------------------------------ the way back (fix round F24)

/** The longest hop of the way back along a tunnel, in blocks. */
export const WAY_BACK_HOP = 8;
/** How far a bot outside the cells of a mine (a side cut, a vein hole) looks for a tunnel cell. */
export const WAY_BACK_REACH = 4;
/** Blocks of the rock that the bot may dig through on its way back (no block a player places). */
export const NATURAL_NAMES = Object.freeze(['stone', 'deepslate', 'cobblestone', 'cobbled_deepslate', 'tuff', 'granite', 'diorite', 'andesite',
    'calcite', 'dirt', 'coarse_dirt', 'rooted_dirt', 'gravel', 'sand', 'red_sand', 'clay', 'netherrack', 'blackstone', 'basalt', 'smooth_basalt',
    'dripstone_block', 'mud', 'infested_stone', 'infested_deepslate']);

/**
 * True for a block of the rock (NATURAL_NAMES, the ores of the table, falling blocks): the way back
 * may dig through it.
 * @param {string} name
 * @returns {boolean}
 */
export function isNaturalBlock(name) {
    return known(name) && (NATURAL_NAMES.includes(name) || isOreBlock(name) || isFalling(name));
}

/**
 * The cells a mine has opened, 2 high: the legs of its route, its tunnels with their corners and
 * branches, its room. A Set of posKey.
 * @param {object} mine
 * @returns {Set<string>}
 */
export function knownCells(mine) {
    const out = new Set();
    const add2 = c => {
        out.add(posKey(c));
        out.add(posKey({ x: c.x, y: c.y + 1, z: c.z }));
    };
    for (const leg of Array.isArray(mine?.route) ? mine.route : []) {
        legCells(leg).forEach(add2);
    }
    for (const t of tunnelsOf(mine)) {
        tunnelCells(t).forEach(add2);
        for (const b of Array.isArray(t.branches) ? t.branches : []) {
            branchCells(b).forEach(add2);
        }
    }
    const box = roomBox(mine);
    if (box) {
        for (let x = box.min.x; x <= box.max.x; x++) {
            for (let y = box.min.y; y <= box.max.y; y++) {
                for (let z = box.min.z; z <= box.max.z; z++) {
                    out.add(posKey({ x, y, z }));
                }
            }
        }
    }
    return out;
}

// the cells of a line from a (left out) to b, every `step` blocks, b always last
function hopsAlong(a, b, step) {
    const cells = lineCells(a, b).slice(1);
    return cells.filter((c, i) => (i + 1) % step === 0 || i === cells.length - 1);
}

function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * The way back from the feet to the way in of a mine (fix round F24): the cells the bot knows, as
 * hops of at most 8 blocks, and the leg of the route where they reach it. From a branch back to its
 * junction; then the tunnel back along its corners to its start; then the end of the route. A bot
 * beside the cells of the mine (within 4 blocks, not in the room or on the route) first goes to the
 * nearest cell of a tunnel or branch. The hops end at the first one within 1 block of a leg of the
 * route (also the feet themselves): the route is walked back from that leg. In the room the hop is
 * the end of the nearest leg. `leg` is -1 without a route.
 * @param {object} mine
 * @param {{x,y,z}} feet
 * @param {number} [step]
 * @returns {{hops: {x: number, y: number, z: number}[], leg: number}}
 */
export function wayBack(mine, feet, step = WAY_BACK_HOP) {
    const f = cellOf(feet);
    const legs = Array.isArray(mine?.route) ? mine.route : [];
    if (!f || !mine) {
        return { hops: [], leg: -1 };
    }
    const legAt = p => legs.findIndex(l => legCells(l).some(c => nearCell(c, p)));
    const here = legAt(f);
    if (here >= 0) {
        return { hops: [], leg: Math.max(here, nearestLeg(legs, f)) };
    }
    const at = mineAt([mine], f);
    if (at && at.tunnel === null && !at.onRoute && legs.length > 0) {
        // the room: the way in passes by it. Fix of the fresh-checkout run of the v0.1.4.9 fix (mine_known,
        // passed_ore, ore_sense, branches): the end of the nearest leg lay at the foot of the descent below the
        // room, so the walk back went down and was blocked; the hop is the cell of that leg nearest to the feet
        const leg = nearestLeg(legs, f);
        const cells = [cellOf(legs[leg]?.from), ...legCells(legs[leg])].filter(Boolean);
        const near = cells.reduce((best, c) => {
            const d = Math.hypot(c.x - f.x, c.y - f.y, c.z - f.z);
            return !best || d < best.d ? { c, d } : best;
        }, null)?.c ?? legEnd(legs[leg]);
        return { hops: near && !samePos(near, f) ? [near] : [], leg };
    }
    const all = wayBackHops(mine, f, step);
    for (let i = 0; i < all.length; i++) {
        const leg = legAt(all[i]);
        if (leg >= 0) {
            return { hops: all.slice(0, i + 1), leg };
        }
    }
    return { hops: all, leg: legs.length - 1 };
}

/**
 * The hops of the way back from the feet to the end of the way in, whole (see wayBack): from a
 * branch to its junction, the tunnel along its corners to its start, the end of the route; a bot
 * beside the cells of the mine (within 4 blocks, not in the room or on the route) first goes to the
 * nearest cell of a tunnel or branch. Without a tunnel near the feet only the end of the route.
 * @param {object} mine
 * @param {{x,y,z}} feet
 * @param {number} [step]
 * @returns {{x: number, y: number, z: number}[]}
 */
export function wayBackHops(mine, feet, step = WAY_BACK_HOP) {
    const f = cellOf(feet);
    if (!f || !mine) {
        return [];
    }
    const n = isFiniteNumber(step) && step >= 1 ? Math.floor(step) : WAY_BACK_HOP;
    const tunnels = tunnelsOf(mine);
    const hops = [];
    let from = f;
    let index = null;
    // in a branch: back to its junction
    tunnels.forEach((t, i) => {
        for (const b of Array.isArray(t.branches) ? t.branches : []) {
            const cells = branchCells(b);
            if (index === null && cells.some(c => nearTunnelCell(c, f))) {
                const sideDir = b.side === 'left' ? leftOf(t.dir) : rightOf(t.dir);
                const junction = offset(cellOf(b.start), sideDir, -1);
                const here = cells.reduce((m, c) => (distance(c, f) < distance(m, f) ? c : m), cells[0]);
                hops.push(...(samePos(here, f) ? [] : [here]), ...hopsAlong(here, junction, n));
                from = junction;
                index = i;
            }
        }
    });
    const inRoomOrRoute = index === null && mineAt([mine], f)?.tunnel === null;
    if (index === null && !inRoomOrRoute) {
        index = tunnels.findIndex(t => tunnelCells(t).some(c => nearTunnelCell(c, f)));
        if (index < 0) {
            // a side cut or a hole beside the mine: the nearest cell of a tunnel or branch
            let best = null;
            tunnels.forEach((t, i) => {
                for (const c of [...tunnelCells(t), ...(Array.isArray(t.branches) ? t.branches : []).flatMap(branchCells)]) {
                    if (distance(c, f) <= WAY_BACK_REACH && (!best || distance(c, f) < distance(best.c, f))) {
                        best = { c, i };
                    }
                }
            });
            index = best ? best.i : null;
            if (best) {
                hops.push(best.c);
                from = best.c;
            }
        }
    }
    if (index !== null) {
        const t = tunnels[index];
        const corners = (Array.isArray(t.corners) && t.corners.length >= 2 ? t.corners : [t.start, t.end]).map(cellOf).filter(Boolean);
        // the piece of the tunnel the bot is on: the corner before it is the next hop
        let k = 0;
        let bestD = Infinity;
        for (let i = 0; i + 1 < corners.length; i++) {
            const d = lineCells(corners[i], corners[i + 1]).reduce((m, c) => Math.min(m, distance(c, from)), Infinity);
            if (d < bestD) {
                bestD = d;
                k = i;
            }
        }
        let at = from;
        for (let i = k; i >= 0; i--) {
            if (!samePos(at, corners[i])) {
                hops.push(...hopsAlong(at, corners[i], n));
                at = corners[i];
            }
        }
        from = at;
    }
    const legs = Array.isArray(mine.route) ? mine.route : [];
    const end = legs.length > 0 ? legEnd(legs[legs.length - 1]) : null;
    if (end && !samePos(end, from)) {
        hops.push(...(distance(end, from) <= n || index === null ? [end] : hopsAlong(from, end, n)));
    }
    return hops.filter((c, i) => !samePos(c, f) && (i === 0 || !samePos(c, hops[i - 1])));
}

// ------------------------------------------------------------------ torches (fix round F31)

/** Light blocks that count as a torch of a tunnel. */
export const TORCH_NAMES = Object.freeze(['torch', 'wall_torch', 'soul_torch', 'soul_wall_torch', 'lantern', 'soul_lantern']);

/**
 * True when a torch is due at the feet in a tunnel going `dir` (fix round F31): no torch (TORCH_NAMES,
 * at the feet or the head) in this cell and the cells behind it, `every` (8) cells in all. The count
 * goes on from the tunnel that is there, so a new dig places its first torch at most 8 cells after
 * the last one.
 * @param {(x: number, y: number, z: number) => string|null} getName
 * @param {{x,y,z}} feet
 * @param {string} dir
 * @param {number} [every]
 * @returns {boolean}
 */
export function torchDue(getName, feet, dir, every = TORCH_EVERY) {
    const f = cellOf(feet);
    if (!f || typeof getName !== 'function') {
        return false;
    }
    const n = isFiniteNumber(every) && every >= 1 ? Math.floor(every) : TORCH_EVERY;
    for (let k = 0; k < n; k++) {
        const c = offset(f, backOf(dir), k);
        if ([c, { x: c.x, y: c.y + 1, z: c.z }].some(p => TORCH_NAMES.includes(readName(getName, p)))) {
            return false;
        }
    }
    return true;
}
