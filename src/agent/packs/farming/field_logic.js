// The geometry of a farm for the farming pack (spec v0.1.4.7 F2), pure: which farm area, the
// cells of a field, its gates, whether the bot stands in it, and where the bot may not step.
// Since v0.1.4.8 (X1) also where the bot may not stand at all (in or on a composter, a chest, a
// fence or a closed gate), the free places beside a block and where to go for an item.
import { boxCenter, distanceToBox, expandBox, isBox } from '../home/box_math.js';
import { FLOWERS, TILLABLE, isAirName, isCropBlock } from './crop_logic.js';

/** A farm area counts when it is at most this far from the bot (spec F2). */
export const FARM_RANGE = 64;
/** The composter of a farm stands in its area or at most this far from it (v0.1.4.8, E2). */
export const COMPOSTER_NEAR_FARM = 8;
/** Without one, the nearest composter within this distance of the bot. */
export const COMPOSTER_RANGE = 32;
/** Compost plants are picked within this distance of the middle of the farm (of the bot without a farm). */
export const PICK_RANGE = 32;

function centreOf(p) {
    return { x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5, z: Math.floor(p.z) + 0.5 };
}

function isPos(p) {
    return p !== null && typeof p === 'object' && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
}

/**
 * The composter to use (spec v0.1.4.8 E2): the one inside the farm area or within 8 blocks of it,
 * the nearest to the farm first; else the nearest within 32 blocks of the bot. Ties by position.
 * @param {{x: number, y: number, z: number}[]} composters block positions
 * @param {{min: object, max: object}|null} farmBox the box of the farm area, null without a farm
 * @param {{x: number, y: number, z: number}|null} botPos
 * @returns {{x: number, y: number, z: number}|null}
 */
export function chooseComposter(composters, farmBox, botPos) {
    const list = (Array.isArray(composters) ? composters : []).filter(isPos).map(p => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }));
    const order = (a, b) => a.d - b.d || a.p.x - b.p.x || a.p.y - b.p.y || a.p.z - b.p.z;
    if (isBox(farmBox)) {
        const near = list.map(p => ({ p, d: distanceToBox(farmBox, centreOf(p)) })).filter(e => e.d <= COMPOSTER_NEAR_FARM).sort(order);
        if (near.length > 0) {
            return near[0].p;
        }
    }
    if (!isPos(botPos)) {
        return null;
    }
    const d = p => Math.hypot(botPos.x - (p.x + 0.5), botPos.y - (p.y + 0.5), botPos.z - (p.z + 0.5));
    const near = list.map(p => ({ p, d: d(p) })).filter(e => e.d <= COMPOSTER_RANGE + 1).sort(order);
    return near[0]?.p ?? null;
}

/**
 * The middle of a farm box, one block above its lowest ground, where the picking of compost plants
 * is measured from; null without a box.
 * @param {{min: object, max: object}|null} farmBox
 * @returns {{x: number, y: number, z: number}|null}
 */
export function farmMiddle(farmBox) {
    const c = boxCenter(farmBox);
    return c ? { x: c.x, y: farmBox.min.y + 1, z: c.z } : null;
}

// The largest box the pack reads: an area is at most 64 by 48 by 64, a scan a little more.
const MAX_SIDE = 128;
const MAX_HEIGHT = 64;
/** The pathfinder refuses a step whose cost reaches this. */
const REFUSED = 100;

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function stripDimension(value) {
    return typeof value === 'string' && value.length > 0 ? value.replace(/^minecraft:/, '') : 'overworld';
}

function lower(name) {
    return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

function byName(a, b) {
    const x = lower(a);
    const y = lower(b);
    return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * The farm area to work in. With a name: the farm area of that name in the dimension, without
 * regard to case and distance. Without a name: the nearest farm area within FARM_RANGE blocks.
 * Buildings never count. A missing dimension is the overworld.
 * @param {object[]} areas areas as the AreaStore lists them
 * @param {{name?: string, pos?: {x: number, y: number, z: number}, dimension?: string, range?: number}} [query]
 * @returns {{area: object|null, reason: 'named'|'nearest'|'unknown_name'|'none', known: string[]}}
 *   known: the names of the farm areas in the dimension, sorted
 */
export function chooseFarmArea(areas, query = {}) {
    const q = query && typeof query === 'object' ? query : {};
    const dimension = stripDimension(q.dimension);
    const farms = (Array.isArray(areas) ? areas : [])
        .filter(a => a && a.type === 'farm' && isBox(a) && stripDimension(a.dimension) === dimension);
    const known = farms.map(a => a.name).filter(n => typeof n === 'string').sort(byName);
    const name = lower(q.name);
    if (name.length > 0) {
        const area = farms.find(a => lower(a.name) === name) ?? null;
        return { area, reason: area ? 'named' : 'unknown_name', known };
    }
    const pos = q.pos;
    if (!pos || !isFiniteNumber(pos.x) || !isFiniteNumber(pos.y) || !isFiniteNumber(pos.z)) {
        return { area: null, reason: 'none', known };
    }
    const range = isFiniteNumber(q.range) ? q.range : FARM_RANGE;
    let best = null;
    for (const area of farms) {
        const d = distanceToBox(area, pos);
        if (d <= range && (!best || d < best.d || (d === best.d && byName(area.name, best.area.name) < 0))) {
            best = { area, d };
        }
    }
    return best ? { area: best.area, reason: 'nearest', known } : { area: null, reason: 'none', known };
}

/**
 * Reads the cells of a field: for every column x, z of the box the topmost block that is not air,
 * looking from 2 blocks above the box to 1 below it. A crop there gives a cell on the block
 * under it; any other block is the ground of the cell. Columns that are not loaded or hold only
 * air are left out. Never throws.
 * @param {(x: number, y: number, z: number) => ({name: string, age?: number}|null)} getBlock null: not loaded
 * @param {{min: {x,y,z}, max: {x,y,z}}} box
 * @returns {{x: number, y: number, z: number, ground: string|null, above: string, age: number|null}[]}
 *   y is the height of the ground; sorted by x, then z; empty for a box larger than 128 by 64 by 128
 */
export function fieldCells(getBlock, box) {
    if (typeof getBlock !== 'function' || !isBox(box)) {
        return [];
    }
    const min = { x: Math.floor(box.min.x), y: Math.floor(box.min.y), z: Math.floor(box.min.z) };
    const max = { x: Math.floor(box.max.x), y: Math.floor(box.max.y), z: Math.floor(box.max.z) };
    if (max.x - min.x >= MAX_SIDE || max.z - min.z >= MAX_SIDE || max.y - min.y >= MAX_HEIGHT) {
        return [];
    }
    const cells = [];
    try {
        for (let x = min.x; x <= max.x; x++) {
            for (let z = min.z; z <= max.z; z++) {
                const cell = readColumn(getBlock, x, z, max.y + 2, min.y - 1);
                if (cell) {
                    cells.push(cell);
                }
            }
        }
    } catch {
        return [];
    }
    return cells;
}

function readColumn(getBlock, x, z, top, bottom) {
    let above = null;
    for (let y = top; y >= bottom; y--) {
        const block = getBlock(x, y, z);
        if (!block) {
            return null;
        }
        if (isAirName(block.name)) {
            above = block;
            continue;
        }
        if (isCropBlock(block.name)) {
            const ground = getBlock(x, y - 1, z);
            const age = block.age === null || block.age === undefined ? NaN : Number(block.age);
            return { x, y: y - 1, z, ground: ground ? ground.name : null, above: block.name, age: Number.isFinite(age) ? age : null };
        }
        if (!above) {
            const up = getBlock(x, y + 1, z);
            above = up ?? { name: 'air' };
        }
        return { x, y, z, ground: block.name, above: above.name, age: null };
    }
    return null;
}

function isFieldGround(cell) {
    return cell.ground === 'farmland' || isCropBlock(cell.above);
}

function isWorkCell(cell) {
    return isFieldGround(cell) || TILLABLE.includes(cell.ground);
}

function boxOf(cells) {
    if (cells.length === 0) {
        return null;
    }
    const xs = cells.map(c => c.x);
    const ys = cells.map(c => c.y);
    const zs = cells.map(c => c.z);
    return {
        min: { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) },
        max: { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) },
    };
}

function validCells(cells) {
    return Array.isArray(cells) ? cells.filter(c => c && isFiniteNumber(c.x) && isFiniteNumber(c.y) && isFiniteNumber(c.z)) : [];
}

/**
 * The box of the field: the ground of the cells with farmland or a crop, or when there are none,
 * of the cells with tillable ground. y spans the ground heights.
 * @param {object[]} cells as fieldCells gives them
 * @returns {{min: {x,y,z}, max: {x,y,z}}|null}
 */
export function fieldBox(cells) {
    const valid = validCells(cells);
    return boxOf(valid.filter(isFieldGround)) ?? boxOf(valid.filter(c => TILLABLE.includes(c.ground)));
}

/**
 * The box to hand to passThrough of the home pack as `inside`: its interior (2 blocks less on
 * every side in x and z) is the field box again, so the bot ends on the field side of a gate.
 * @param {{min: {x,y,z}, max: {x,y,z}}} box a field box
 * @returns {{min: {x,y,z}, max: {x,y,z}}|null}
 */
export function insideBox(box) {
    return expandBox(box, 2);
}

/**
 * True when the position stands on a cell of the field: its column is a cell with farmland, a
 * crop or tillable ground, and its height is at most 2 blocks above that ground.
 * @param {object[]} cells as fieldCells gives them
 * @param {{x: number, y: number, z: number}} pos
 * @returns {boolean}
 */
export function isInField(cells, pos) {
    if (!pos || !isFiniteNumber(pos.x) || !isFiniteNumber(pos.y) || !isFiniteNumber(pos.z)) {
        return false;
    }
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    const z = Math.floor(pos.z);
    return validCells(cells).some(c => c.x === x && c.z === z && isWorkCell(c) && y >= c.y && y <= c.y + 2);
}

/**
 * The fence gates around a field: blocks whose name ends with `_fence_gate` on the ring one block
 * outside the box, from the ground height to 2 blocks above the top of the box. Never throws.
 * @param {(x: number, y: number, z: number) => ({name: string}|null)} getBlock
 * @param {{min: {x,y,z}, max: {x,y,z}}} box a field box
 * @returns {{x: number, y: number, z: number, kind: 'gate'}[]} sorted by x, z, y
 */
export function findGates(getBlock, box) {
    if (typeof getBlock !== 'function' || !isBox(box)) {
        return [];
    }
    const gates = [];
    const x0 = box.min.x - 1;
    const x1 = box.max.x + 1;
    const z0 = box.min.z - 1;
    const z1 = box.max.z + 1;
    try {
        for (let x = x0; x <= x1; x++) {
            for (let z = z0; z <= z1; z++) {
                if (x !== x0 && x !== x1 && z !== z0 && z !== z1) {
                    continue;
                }
                for (let y = box.min.y; y <= box.max.y + 2; y++) {
                    const name = getBlock(x, y, z)?.name;
                    if (typeof name === 'string' && name.endsWith('_fence_gate')) {
                        gates.push({ x, y, z, kind: 'gate' });
                    }
                }
            }
        }
    } catch {
        return [];
    }
    return gates.sort((a, b) => a.x - b.x || a.z - b.z || a.y - b.y);
}

/**
 * A step cost for the pathfinder (Movements.exclusionAreasStep) inside a field. It refuses the
 * blocks 3 to 5 above farmland and crops, which the bot only touches when it jumps in the field
 * or drops onto it from a higher block: a fall onto farmland turns it into dirt. Walking among
 * the plants (feet and head 1 and 2 above the ground) costs nothing. It also refuses water
 * cells of the field at the height of the water.
 * @param {object[]} cells as fieldCells gives them
 * @returns {(blockOrPos: object) => number} 0 or 100; takes a block with `position` or a position
 */
export function stepPenalty(cells) {
    const field = new Map();
    const water = new Map();
    for (const c of validCells(cells)) {
        const key = `${c.x},${c.z}`;
        if (isFieldGround(c)) {
            field.set(key, c.y);
        } else if (c.ground === 'water') {
            water.set(key, c.y);
        }
    }
    return (input) => {
        const p = input && typeof input === 'object' && input.position ? input.position : input;
        if (!p || !isFiniteNumber(p.x) || !isFiniteNumber(p.y) || !isFiniteNumber(p.z)) {
            return 0;
        }
        const key = `${Math.floor(p.x)},${Math.floor(p.z)}`;
        const y = Math.floor(p.y);
        const ground = field.get(key);
        if (ground !== undefined && y >= ground + 3 && y <= ground + 5) {
            return REFUSED;
        }
        return water.get(key) === y ? REFUSED : 0;
    };
}

// --- where the bot may stand (v0.1.4.8, X1) ---

/**
 * Hollow blocks: the bot can stand in them and must jump to get out, which the path search does not
 * know. In the long run of the world tests the bot fell into the composter of the farm and never came out.
 */
const HOLLOW = new Set(['composter', 'cauldron', 'water_cauldron', 'lava_cauldron', 'powder_snow_cauldron', 'hopper']);
/** Containers the bot never stands on. */
const CONTAINERS = new Set(['chest', 'trapped_chest', 'ender_chest']);
/** Plants and thin blocks without collision that a bot stands in, besides air, crops, flowers and saplings. */
const THIN = new Set(['short_grass', 'grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'leaf_litter']);
/** Blocks that are no ground to stand on. */
const LIQUIDS = new Set(['water', 'lava', 'bubble_column']);
const SIDES = Object.freeze([[-1, 0], [1, 0], [0, -1], [0, 1]]);
const CORNERS = Object.freeze([[-1, -1], [-1, 1], [1, -1], [1, 1]]);

function plainName(name) {
    return typeof name === 'string' && name.length > 0 ? name.trim().toLowerCase().replace(/^minecraft:/, '') : '';
}

function isOpenProp(properties) {
    return Boolean(properties) && (properties.open === true || properties.open === 'true');
}

/**
 * True for a block the bot never stands in or on (v0.1.4.8, X1): a composter, a cauldron or a hopper
 * (hollow), a chest, a fence or a wall, and a fence gate that is closed.
 * @param {string} name
 * @param {object|null} [properties] the block properties; `open` of a gate
 * @returns {boolean}
 */
export function isNoStandBlock(name, properties = null) {
    const n = plainName(name);
    if (n.length === 0) {
        return false;
    }
    if (HOLLOW.has(n) || CONTAINERS.has(n)) {
        return true;
    }
    if (n.endsWith('_fence_gate')) {
        return !isOpenProp(properties);
    }
    return n.endsWith('_fence') || n.endsWith('_wall');
}

function blockOf(getBlock, x, y, z) {
    try {
        const b = getBlock(x, y, z);
        return b && typeof b === 'object' && typeof b.name === 'string' ? b : null;
    } catch {
        return null;
    }
}

function noStandAt(getBlock, x, y, z) {
    const b = blockOf(getBlock, x, y, z);
    return Boolean(b) && isNoStandBlock(b.name, b.properties ?? null);
}

/**
 * True when a place to stand (the block of the feet) is in or on a block of isNoStandBlock: the block
 * itself or the block under it is one. No walk of the farm skills ends there. Never throws.
 * @param {(x: number, y: number, z: number) => ({name: string, properties?: object}|null)} getBlock
 * @param {{x: number, y: number, z: number}} pos
 * @returns {boolean}
 */
export function isNoStandCell(getBlock, pos) {
    if (typeof getBlock !== 'function' || !isPos(pos)) {
        return false;
    }
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    const z = Math.floor(pos.z);
    return noStandAt(getBlock, x, y, z) || noStandAt(getBlock, x, y - 1, z);
}

/**
 * The blocks of a box that the bot never stands in or on (isNoStandBlock), sorted by x, z, y. Empty
 * for a box larger than 128 by 64 by 128. Never throws.
 * @param {(x: number, y: number, z: number) => ({name: string, properties?: object}|null)} getBlock
 * @param {{min: {x,y,z}, max: {x,y,z}}} box
 * @returns {{x: number, y: number, z: number, name: string}[]}
 */
export function noStandBlocks(getBlock, box) {
    if (typeof getBlock !== 'function' || !isBox(box)) {
        return [];
    }
    const min = { x: Math.floor(box.min.x), y: Math.floor(box.min.y), z: Math.floor(box.min.z) };
    const max = { x: Math.floor(box.max.x), y: Math.floor(box.max.y), z: Math.floor(box.max.z) };
    if (max.x - min.x >= MAX_SIDE || max.z - min.z >= MAX_SIDE || max.y - min.y >= MAX_HEIGHT) {
        return [];
    }
    const out = [];
    for (let x = min.x; x <= max.x; x++) {
        for (let z = min.z; z <= max.z; z++) {
            for (let y = min.y; y <= max.y; y++) {
                const b = blockOf(getBlock, x, y, z);
                if (b && isNoStandBlock(b.name, b.properties ?? null)) {
                    out.push({ x, y, z, name: plainName(b.name) });
                }
            }
        }
    }
    return out;
}

/**
 * A step cost for the pathfinder (Movements.exclusionAreasStep): 100 for the block of each position of
 * the list and for the block above it, so the path search never goes into or onto them (v0.1.4.8, X1).
 * @param {{x: number, y: number, z: number}[]} blocks
 * @returns {(blockOrPos: object) => number} 0 or 100; takes a block with `position` or a position
 */
export function noStandPenalty(blocks) {
    const cells = new Set();
    for (const b of validCells(blocks)) {
        const x = Math.floor(b.x);
        const y = Math.floor(b.y);
        const z = Math.floor(b.z);
        cells.add(`${x},${y},${z}`);
        cells.add(`${x},${y + 1},${z}`);
    }
    return (input) => {
        const p = input && typeof input === 'object' && input.position ? input.position : input;
        if (!isPos(p)) {
            return 0;
        }
        return cells.has(`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`) ? REFUSED : 0;
    };
}

function isPassableBlock(b) {
    const n = plainName(b?.name);
    return n.length > 0 && (isAirName(n) || isCropBlock(n) || THIN.has(n) || FLOWERS.includes(n) || n.endsWith('_sapling'));
}

function isGroundBlock(b) {
    const n = plainName(b?.name);
    return n.length > 0 && !isPassableBlock(b) && !LIQUIDS.has(n) && !isNoStandBlock(n, b.properties ?? null);
}

/**
 * The free places beside a block where the bot can stand to work at it or to pick up an item in or on
 * it (v0.1.4.8, X1: the place for the work at the composter is never the composter). The four sides
 * first, then the corners; in each column the height of the block, one above or one below. A place is
 * free when the feet and the head are air or a plant without collision and the block under the feet is
 * ground (not a liquid, not a block of isNoStandBlock). Sorted by the distance of the middle of the place
 * to `from` (the bot or an item), the sides before the corners, then by position. Never throws.
 * @param {(x: number, y: number, z: number) => ({name: string, properties?: object}|null)} getBlock
 * @param {{x: number, y: number, z: number}} target the block position
 * @param {{x: number, y: number, z: number}|null} [from]
 * @returns {{x: number, y: number, z: number, side: boolean}[]} feet positions
 */
export function standSpots(getBlock, target, from = null) {
    if (typeof getBlock !== 'function' || !isPos(target)) {
        return [];
    }
    const t = { x: Math.floor(target.x), y: Math.floor(target.y), z: Math.floor(target.z) };
    const spots = [];
    for (const [list, side] of [[SIDES, true], [CORNERS, false]]) {
        for (const [dx, dz] of list) {
            for (const dy of [0, 1, -1]) {
                const x = t.x + dx;
                const y = t.y + dy;
                const z = t.z + dz;
                const feet = blockOf(getBlock, x, y, z);
                const head = blockOf(getBlock, x, y + 1, z);
                const ground = blockOf(getBlock, x, y - 1, z);
                if (feet && head && ground && isPassableBlock(feet) && isPassableBlock(head) && isGroundBlock(ground)) {
                    spots.push({ x, y, z, side });
                    break;
                }
            }
        }
    }
    const d = s => (isPos(from) ? Math.hypot(from.x - (s.x + 0.5), from.y - s.y, from.z - (s.z + 0.5)) : 0);
    return spots.sort((a, b) => d(a) - d(b) || Number(b.side) - Number(a.side) || a.x - b.x || a.z - b.z || a.y - b.y);
}

/**
 * Where the bot goes for an item on the ground (v0.1.4.8, X1): an item in or on a block of
 * isNoStandBlock (in a composter, on its rim, on a chest or a fence post) is picked up from a free place
 * beside that block: `{ beside }` with the position of the block. Any other item from the block where
 * it lies: `{ at }`, the place of the feet. null for a position that is not one. Never throws.
 * @param {(x: number, y: number, z: number) => ({name: string, properties?: object}|null)} getBlock
 * @param {{x: number, y: number, z: number}} pos the position of the item
 * @returns {{beside: {x,y,z}}|{at: {x,y,z}}|null}
 */
export function itemPlace(getBlock, pos) {
    if (typeof getBlock !== 'function' || !isPos(pos)) {
        return null;
    }
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y + 0.3);
    const z = Math.floor(pos.z);
    if (noStandAt(getBlock, x, y, z)) {
        return { beside: { x, y, z } };
    }
    if (noStandAt(getBlock, x, y - 1, z)) {
        return { beside: { x, y: y - 1, z } };
    }
    return { at: { x, y, z } };
}

/**
 * A goal of mineflayer-pathfinder that is `goal` without the places that `forbidden(node)` refuses: the
 * path search never ends a walk there (v0.1.4.8, X1: a goal near the composter ended on it). It keeps
 * x, y, z and rangeSq of the goal; the goal itself is `inner`.
 * @param {{heuristic: Function, isEnd: Function, hasChanged?: Function, isValid?: Function}} goal
 * @param {(node: {x: number, y: number, z: number}) => boolean} forbidden
 * @returns {object} a goal
 */
export function goalAvoiding(goal, forbidden) {
    const refused = (node) => {
        try {
            return forbidden(node) === true;
        } catch {
            return false;
        }
    };
    const wrapped = {
        inner: goal,
        heuristic: node => goal.heuristic(node),
        isEnd: node => !refused(node) && goal.isEnd(node) === true,
        hasChanged: () => (typeof goal.hasChanged === 'function' ? goal.hasChanged() : false),
        isValid: () => (typeof goal.isValid === 'function' ? goal.isValid() : true),
    };
    for (const k of ['x', 'y', 'z', 'rangeSq']) {
        if (goal[k] !== undefined) {
            wrapped[k] = goal[k];
        }
    }
    return wrapped;
}
