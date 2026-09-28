// What the mining pack does with single blocks and items: read a block for the logic, dig it and
// wait for falling blocks, close a hole with a block, place a torch, equip the pickaxe, pick up
// what dropped. Executing: it gets the bot. Every function ends when bot.interrupt_code is set
// and never throws; results are { ok, reason }.
import { Vec3 } from 'vec3';
import { botPos, clockOf } from '../home/context.js';
import { goals, gotoGoal, makeMovements } from '../home/motion.js';
import { AIR_NAMES, OPEN_NAMES, WATER_NAMES, faceNeighbours, isFalling, posKey } from './mine_logic.js';
import { PICKAXE_LEVELS, PICKAXE_USES, pickaxeMaterial } from './ore_table.js';

/** Blocks used to close a hole, the first the bot carries wins. */
export const FILLERS = Object.freeze(['cobblestone', 'cobbled_deepslate', 'stone', 'deepslate', 'andesite', 'diorite', 'granite',
    'tuff', 'dirt', 'netherrack', 'blackstone', 'sandstone']);
/** How far the bot reaches from its eyes (the server allows a little more). */
export const REACH = 4.5;
/** Tries to dig one place free of falling gravel or sand (spec: up to 16). */
export const FALL_TRIES = 16;

const EYE = 1.62;
// blocks that open or react when clicked: never used as the block to place against
const CLICKABLE = /chest|barrel|furnace|smoker|crafting_table|door|gate|bed$|button|lever|anvil|table|shulker_box|hopper|dispenser|dropper|brewing_stand|loom|grindstone|stonecutter|bell|note_block|repeater|comparator|beacon|lectern|composter|cauldron|campfire|sign|jukebox/;

function vec(p) {
    return new Vec3(p.x, p.y, p.z);
}

/**
 * The block at a position, or null when it is not loaded. Never throws.
 * @param {object} bot
 * @param {{x,y,z}} p
 * @returns {object|null}
 */
export function blockAt(bot, p) {
    try {
        return bot.blockAt(vec(p)) ?? null;
    } catch {
        return null;
    }
}

function waterlogged(block) {
    try {
        const props = typeof block.getProperties === 'function' ? block.getProperties() : block._properties;
        return props?.waterlogged === true || props?.waterlogged === 'true';
    } catch {
        return false;
    }
}

/**
 * The name the logic of mine_logic.js gets for a block: null when not loaded; `water` for a
 * waterlogged block; the name of air and of the blocks of OPEN_NAMES; `air` for other blocks
 * without a collision box (grass, flowers, rails), which are no wall and no floor.
 * @param {object} block
 * @returns {string|null}
 */
export function logicName(block) {
    if (!block || typeof block.name !== 'string') {
        return null;
    }
    const name = block.name;
    if (name === 'lava' || WATER_NAMES.includes(name) || waterlogged(block)) {
        return name === 'lava' ? 'lava' : 'water';
    }
    if (block.boundingBox === 'empty' && !AIR_NAMES.includes(name) && !OPEN_NAMES.includes(name)) {
        return 'air';
    }
    return name;
}

/**
 * A reader of logic names for the functions of mine_logic.js.
 * @param {object} bot
 * @returns {(x: number, y: number, z: number) => string|null}
 */
export function nameReader(bot) {
    return (x, y, z) => logicName(blockAt(bot, { x, y, z }));
}

/**
 * True when the block is a full block the bot can stand on or place against.
 * @param {object} block
 * @returns {boolean}
 */
export function isSolid(block) {
    return Boolean(block) && block.boundingBox === 'block' && block.name !== 'ladder' && logicName(block) !== 'water';
}

/**
 * True when nothing is in the way at the position: air or a block without a collision box, no liquid.
 * @param {object} block
 * @returns {boolean}
 */
export function isFree(block) {
    const n = logicName(block);
    return n !== null && (AIR_NAMES.includes(n) || OPEN_NAMES.includes(n) || n === 'air') && n !== 'water' && n !== 'lava';
}

/**
 * Races a promise against the time limit and bot.interrupt_code.
 * @param {object} bot
 * @param {Promise} promise
 * @param {number} ms
 * @param {object} clock
 * @returns {Promise<{ok: boolean, value?: *, error?: Error, interrupted?: boolean, timeout?: boolean}>}
 */
export async function race(bot, promise, ms, clock) {
    let settled = null;
    Promise.resolve(promise).then(value => { settled = { ok: true, value }; }, error => { settled = { ok: false, error }; });
    const start = clock.now();
    while (settled === null) {
        if (bot?.interrupt_code) {
            return { ok: false, interrupted: true };
        }
        if (clock.now() - start >= ms) {
            return { ok: false, timeout: true };
        }
        await clock.wait(20);
    }
    return settled;
}

// ------------------------------------------------------------------ inventory

/**
 * Uses left of a tool item, from its durability; null for an item without one.
 * @param {object} item
 * @returns {number|null}
 */
export function usesLeftOf(item) {
    const max = item?.maxDurability;
    if (typeof max !== 'number' || !Number.isFinite(max) || max <= 0) {
        const m = pickaxeMaterial(item?.name);
        return m ? PICKAXE_USES[m] : null;
    }
    let used = 0;
    try {
        used = item.durabilityUsed;
    } catch {
        used = 0;
    }
    return Math.max(0, max - (typeof used === 'number' && Number.isFinite(used) ? used : 0));
}

/**
 * The inventory as a list of { name, count, slot, uses_left }. Never throws.
 * @param {object} bot
 * @returns {object[]}
 */
export function inventoryList(bot) {
    try {
        return bot.inventory.items().map(item => ({ name: item.name, count: item.count, slot: item.slot, uses_left: usesLeftOf(item) }));
    } catch {
        return [];
    }
}

/**
 * How many of an item the bot carries.
 * @param {object} bot
 * @param {string} name
 * @returns {number}
 */
export function countOf(bot, name) {
    return inventoryList(bot).filter(i => i.name === name).reduce((sum, i) => sum + i.count, 0);
}

/**
 * Empty slots of the inventory (36 slots).
 * @param {object} bot
 * @returns {number}
 */
export function freeSlots(bot) {
    try {
        if (typeof bot.inventory.emptySlotCount === 'function') {
            return bot.inventory.emptySlotCount();
        }
    } catch {
        // counted below
    }
    return Math.max(0, 36 - inventoryList(bot).length);
}

/**
 * The first filler block the bot carries, or null.
 * @param {object} bot
 * @returns {string|null}
 */
export function fillerOf(bot) {
    const names = new Set(inventoryList(bot).map(i => i.name));
    return FILLERS.find(n => names.has(n)) ?? null;
}

/**
 * How many filler blocks the bot carries.
 * @param {object} bot
 * @returns {number}
 */
export function fillerCount(bot) {
    return inventoryList(bot).filter(i => FILLERS.includes(i.name)).reduce((sum, i) => sum + i.count, 0);
}

async function equipNamed(bot, name) {
    try {
        const item = bot.inventory.items().find(i => i.name === name);
        if (!item) {
            return false;
        }
        if (bot.heldItem?.name !== name) {
            await bot.equip(item, 'hand');
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * Equips the best pickaxe that breaks what `material` breaks (the most uses left among equals).
 * @param {object} bot
 * @param {string} [material]
 * @returns {Promise<object|null>} the item, or null
 */
export async function equipPickaxe(bot, material = 'wooden') {
    try {
        const want = PICKAXE_LEVELS[material] ?? 0;
        const items = bot.inventory.items().filter(i => {
            const m = pickaxeMaterial(i.name);
            return m !== null && PICKAXE_LEVELS[m] >= want;
        }).sort((a, b) => PICKAXE_LEVELS[pickaxeMaterial(b.name)] - PICKAXE_LEVELS[pickaxeMaterial(a.name)]
            || (usesLeftOf(b) ?? 0) - (usesLeftOf(a) ?? 0));
        if (items.length === 0) {
            return null;
        }
        if (bot.heldItem !== items[0]) {
            await bot.equip(items[0], 'hand');
        }
        return items[0];
    } catch {
        return null;
    }
}

// ------------------------------------------------------------------ digging

function guardAllowsBreak(bot, block) {
    try {
        return !bot.areaGuard || bot.areaGuard.canBreak(block) !== false;
    } catch {
        return true;
    }
}

function guardAllowsPlace(bot, p, item) {
    try {
        return !bot.areaGuard || bot.areaGuard.canPlace(p, item) !== false;
    } catch {
        return true;
    }
}

async function equipFor(bot, block) {
    try {
        const tool = bot.pathfinder?.bestHarvestTool?.(block);
        if (tool) {
            if (bot.heldItem !== tool) {
                await bot.equip(tool, 'hand');
            }
            return;
        }
    } catch {
        // fall back to a pickaxe
    }
    await equipPickaxe(bot);
}

/**
 * Digs the block at a position with the best tool. Air and blocks without a collision box count
 * as dug. Liquids, unbreakable blocks and blocks the area guard refuses are not dug.
 * @param {object} bot
 * @param {{x,y,z}} p
 * @param {{clock?: object}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, name?: string, dug: number}>} reasons: unknown, liquid, protected, unbreakable, interrupted, timeout, failed
 */
export async function digBlock(bot, p, options = {}) {
    const clock = options.clock ?? clockOf(null);
    const block = blockAt(bot, p);
    const name = logicName(block);
    if (name === null) {
        return { ok: false, reason: 'unknown', dug: 0 };
    }
    if (name === 'water' || name === 'lava') {
        return { ok: false, reason: 'liquid', name, dug: 0 };
    }
    if (isFree(block)) {
        return { ok: true, reason: null, name, dug: 0 };
    }
    if (block.diggable === false || block.name === 'bedrock') {
        return { ok: false, reason: 'unbreakable', name, dug: 0 };
    }
    if (!guardAllowsBreak(bot, block)) {
        return { ok: false, reason: 'protected', name, dug: 0 };
    }
    if (bot.interrupt_code) {
        return { ok: false, reason: 'interrupted', name, dug: 0 };
    }
    await equipFor(bot, block);
    let expected = 1000;
    try {
        expected = bot.digTime(block);
    } catch {
        expected = 1000;
    }
    const limit = Math.max(3000, (Number.isFinite(expected) ? expected : 1000) * 2 + 2000);
    const res = await race(bot, bot.dig(block, true), limit, clock);
    if (!res.ok) {
        try {
            bot.stopDigging?.();
        } catch {
            // nothing to stop
        }
        if (res.interrupted) {
            return { ok: false, reason: 'interrupted', name, dug: 0 };
        }
        if (!isFree(blockAt(bot, p))) {
            return { ok: false, reason: res.timeout ? 'timeout' : 'failed', name, dug: 0, error: res.error };
        }
    }
    // the dig is done; gravel that falls into the place is the business of digClear
    return { ok: true, reason: null, name, dug: 1 };
}

function fallingNear(bot, p) {
    try {
        return Object.values(bot.entities ?? {}).some(e => e?.name === 'falling_block' && e.position
            && Math.abs(e.position.x - (p.x + 0.5)) < 1 && Math.abs(e.position.z - (p.z + 0.5)) < 1 && e.position.y >= p.y - 0.5 && e.position.y < p.y + 12);
    } catch {
        return false;
    }
}

/**
 * Digs a position until it stays free: gravel or sand that falls into it is dug again, up to 16
 * times. Before every new try `recheck()` may say no (a new view shows danger).
 * @param {object} bot
 * @param {{x,y,z}} p
 * @param {{clock?: object, recheck?: () => boolean}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, dug: number}>}
 */
export async function digClear(bot, p, options = {}) {
    const clock = options.clock ?? clockOf(null);
    let dug = 0;
    for (let i = 0; i < FALL_TRIES; i++) {
        // read before digging: right after it the block above may be a falling entity already
        const aboveBefore = logicName(blockAt(bot, { x: p.x, y: p.y + 1, z: p.z }));
        const r = await digBlock(bot, p, { clock });
        dug += r.dug;
        if (!r.ok) {
            return { ok: false, reason: r.reason, dug };
        }
        const above = logicName(blockAt(bot, { x: p.x, y: p.y + 1, z: p.z }));
        if (!isFalling(aboveBefore) && !isFalling(above) && !fallingNear(bot, p)) {
            return { ok: true, reason: null, dug };
        }
        // something falls: wait until it appears, lands or is gone
        await clock.wait(300);
        const start = clock.now();
        while (clock.now() - start < 2500 && fallingNear(bot, p)) {
            await clock.wait(50);
        }
        await clock.wait(150);
        if (isFree(blockAt(bot, p)) && !isFalling(logicName(blockAt(bot, { x: p.x, y: p.y + 1, z: p.z })))) {
            return { ok: true, reason: null, dug };
        }
        if (typeof options.recheck === 'function' && options.recheck() === false) {
            return { ok: false, reason: 'unsafe', dug };
        }
    }
    return { ok: false, reason: 'falling', dug };
}

// ------------------------------------------------------------------ placing

function eyeOf(bot) {
    const p = botPos(bot);
    return p ? { x: p.x, y: p.y + EYE, z: p.z } : null;
}

function botCells(bot) {
    const p = botPos(bot);
    if (!p) {
        return [];
    }
    const out = [];
    for (const dx of [-0.3, 0.3]) {
        for (const dz of [-0.3, 0.3]) {
            for (const dy of [0, 1, 1.79]) {
                out.push(posKey({ x: Math.floor(p.x + dx), y: Math.floor(p.y + dy), z: Math.floor(p.z + dz) }));
            }
        }
    }
    return [...new Set(out)];
}

/**
 * The block and face to click to put a block into position p: a solid, not clickable neighbour of
 * p within reach, the nearest to the eyes of the bot first. null when there is none.
 * @param {object} bot
 * @param {{x,y,z}} p
 * @returns {{block: object, face: Vec3}|null}
 */
export function referenceFor(bot, p) {
    const eye = eyeOf(bot);
    if (!eye) {
        return null;
    }
    const options = [];
    for (const n of faceNeighbours(p)) {
        const block = blockAt(bot, n);
        if (!isSolid(block) || CLICKABLE.test(block.name)) {
            continue;
        }
        const face = { x: p.x - n.x, y: p.y - n.y, z: p.z - n.z };
        const point = { x: n.x + 0.5 + face.x * 0.5, y: n.y + 0.5 + face.y * 0.5, z: n.z + 0.5 + face.z * 0.5 };
        const d = Math.hypot(point.x - eye.x, point.y - eye.y, point.z - eye.z);
        if (d <= REACH + 0.5) {
            options.push({ block, face: new Vec3(face.x, face.y, face.z), d });
        }
    }
    options.sort((a, b) => a.d - b.d);
    return options[0] ?? null;
}

/**
 * Puts a block of `item` into position p (air, water, lava or a block without a collision box),
 * against a solid neighbour. A position that holds a solid block already counts as done. Not into
 * the space of the bot itself (for a full block).
 * @param {object} bot
 * @param {{x,y,z}} p
 * @param {string} item
 * @param {{clock?: object, check?: (block: object) => boolean}} [options] check: when the result counts (default: solid)
 * @returns {Promise<{ok: boolean, reason: string|null, placed: number}>} reasons: unknown, no_item, protected, in_the_way, no_reference, interrupted, failed
 */
export async function placeInto(bot, p, item, options = {}) {
    const clock = options.clock ?? clockOf(null);
    const check = typeof options.check === 'function' ? options.check : isSolid;
    const before = blockAt(bot, p);
    if (!before) {
        return { ok: false, reason: 'unknown', placed: 0 };
    }
    if (check(before)) {
        return { ok: true, reason: null, placed: 0 };
    }
    if (isSolid(before)) {
        return { ok: false, reason: 'occupied', placed: 0 };
    }
    if (bot.interrupt_code) {
        return { ok: false, reason: 'interrupted', placed: 0 };
    }
    if (!guardAllowsPlace(bot, p, item)) {
        return { ok: false, reason: 'protected', placed: 0 };
    }
    if (options.full !== false && botCells(bot).includes(posKey(p))) {
        return { ok: false, reason: 'in_the_way', placed: 0 };
    }
    const ref = referenceFor(bot, p);
    if (!ref) {
        return { ok: false, reason: 'no_reference', placed: 0 };
    }
    if (!(await equipNamed(bot, item))) {
        return { ok: false, reason: 'no_item', placed: 0 };
    }
    const res = await race(bot, bot.placeBlock(ref.block, ref.face), 6000, clock);
    if (res.interrupted) {
        return { ok: false, reason: 'interrupted', placed: 0 };
    }
    const after = blockAt(bot, p);
    if (after && check(after)) {
        return { ok: true, reason: null, placed: 1 };
    }
    // the block update may come a little later
    await clock.wait(150);
    const later = blockAt(bot, p);
    return later && check(later) ? { ok: true, reason: null, placed: 1 } : { ok: false, reason: 'failed', placed: 0, error: res.error };
}

/**
 * Closes positions with filler blocks (cobblestone first), in the given order, in up to 3 rounds
 * (a block placed in one round is the reference of the next).
 * @param {object} bot
 * @param {{x,y,z}[]} positions
 * @param {{clock?: object}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, placed: number, open: object[]}>}
 */
export async function patchAll(bot, positions, options = {}) {
    let open = (Array.isArray(positions) ? positions : []).map(p => ({ x: p.x, y: p.y, z: p.z }));
    let placed = 0;
    let reason = null;
    for (let round = 0; round < 3 && open.length > 0; round++) {
        const next = [];
        for (const p of open) {
            if (bot.interrupt_code) {
                return { ok: false, reason: 'interrupted', placed, open };
            }
            const item = fillerOf(bot);
            if (!item) {
                return { ok: false, reason: 'no_block', placed, open: [p, ...next, ...open.slice(open.indexOf(p) + 1)] };
            }
            const r = await placeInto(bot, p, item, options);
            placed += r.placed;
            if (!r.ok) {
                reason = r.reason;
                if (r.reason === 'interrupted' || r.reason === 'protected') {
                    return { ok: false, reason: r.reason, placed, open: [p, ...next] };
                }
                next.push(p);
            }
        }
        open = next;
    }
    return { ok: open.length === 0, reason: open.length === 0 ? null : reason, placed, open };
}

/**
 * Places a torch on the floor at position p (the block under it must be solid).
 * @param {object} bot
 * @param {{x,y,z}} p
 * @param {{clock?: object}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, placed: number}>}
 */
export async function placeTorch(bot, p, options = {}) {
    if (countOf(bot, 'torch') < 1) {
        return { ok: false, reason: 'no_item', placed: 0 };
    }
    const floor = blockAt(bot, { x: p.x, y: p.y - 1, z: p.z });
    const here = blockAt(bot, p);
    if (!isSolid(floor) || !isFree(here) || (here && here.name !== 'air' && here.name !== 'cave_air')) {
        return { ok: false, reason: 'no_place', placed: 0 };
    }
    const clock = options.clock ?? clockOf(null);
    if (!guardAllowsPlace(bot, p, 'torch')) {
        return { ok: false, reason: 'protected', placed: 0 };
    }
    if (!(await equipNamed(bot, 'torch'))) {
        return { ok: false, reason: 'no_item', placed: 0 };
    }
    const res = await race(bot, bot.placeBlock(floor, new Vec3(0, 1, 0)), 5000, clock);
    if (res.interrupted) {
        return { ok: false, reason: 'interrupted', placed: 0 };
    }
    const after = blockAt(bot, p);
    return after?.name === 'torch' ? { ok: true, reason: null, placed: 1 } : { ok: false, reason: 'failed', placed: 0 };
}

// ------------------------------------------------------------------ moving a little and picking up

function standable(bot, p) {
    return isFree(blockAt(bot, p)) && isFree(blockAt(bot, { x: p.x, y: p.y + 1, z: p.z })) && isSolid(blockAt(bot, { x: p.x, y: p.y - 1, z: p.z }));
}

/**
 * Steps from a neighbour into the cell p with the controls and stops in its middle: one block
 * forward on the same level, one down (it falls) or one up (it jumps). For a cell with a ladder
 * walking into it towards the wall would climb the ladder, and the pathfinder does not go down
 * steps out of a ladder well (both found on the real server).
 * @param {object} bot
 * @param {{x,y,z}} p
 * @param {object} clock
 * @returns {Promise<boolean>} true when the bot stands in p
 */
export async function stepInto(bot, p, clock) {
    const cx = p.x + 0.5;
    const cz = p.z + 0.5;
    const from = botPos(bot);
    if (!from) {
        return false;
    }
    const up = p.y > Math.floor(from.y + 0.01);
    const dx = cx - from.x;
    const dz = cz - from.z;
    try {
        await bot.lookAt(new Vec3(cx, from.y + EYE, cz), true);
    } catch {
        // best effort
    }
    try {
        bot.setControlState('forward', true);
        if (up) {
            bot.setControlState('jump', true);
        }
        const start = clock.now();
        while (clock.now() - start < 2500) {
            if (bot.interrupt_code) {
                break;
            }
            const q = botPos(bot);
            if (!q || (cx - q.x) * dx + (cz - q.z) * dz <= 0.02) {
                break;
            }
            if (up && q.y >= p.y - 0.05) {
                bot.setControlState('jump', false);
            }
            await clock.wait(10);
        }
    } finally {
        try {
            bot.clearControlStates();
            bot.entity.velocity.x = 0;
            bot.entity.velocity.z = 0;
        } catch {
            // nothing to stop
        }
    }
    const start = clock.now();
    await clock.wait(150);
    while (clock.now() - start < 1500 && !(bot.entity?.onGround && Math.abs(bot.entity?.velocity?.y ?? 0) < 0.1)) {
        await clock.wait(25);
    }
    const b = botPos(bot);
    return Boolean(b) && Math.floor(b.x) === p.x && Math.floor(b.z) === p.z && Math.floor(b.y + 0.01) === p.y;
}

/**
 * Walks to a block position (the feet there) with movements that neither dig nor place. A cell
 * with a ladder is entered from a free neighbour with stepInto.
 * @param {object} bot
 * @param {{x,y,z}} p
 * @param {{clock?: object, timeoutMs?: number, range?: number}} [options] range 0: exactly there
 * @returns {Promise<{ok: boolean, reason: string|null}>}
 */
export async function walkTo(bot, p, options = {}) {
    const clock = options.clock ?? clockOf(null);
    const range = Number.isFinite(options.range) ? options.range : 0;
    const at = () => {
        const b = botPos(bot);
        if (!b) {
            return false;
        }
        if (range === 0) {
            return Math.floor(b.x) === p.x && Math.floor(b.z) === p.z && Math.abs(b.y - p.y) < 0.6;
        }
        return Math.hypot(b.x - p.x - 0.5, b.y - p.y, b.z - p.z - 0.5) <= range + 0.5;
    };
    if (at()) {
        return { ok: true, reason: null };
    }
    if (range === 0 && blockAt(bot, p)?.name === 'ladder') {
        const here = botPos(bot);
        const near = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }]
            .flatMap(v => [{ x: p.x + v.x, y: p.y, z: p.z + v.z }, { x: p.x + v.x, y: p.y - 1, z: p.z + v.z }])
            .filter(q => standable(bot, q) && (q.y === p.y || isFree(blockAt(bot, { x: q.x, y: q.y + 2, z: q.z }))))
            .sort((a, b) => (here ? Math.hypot(a.x + 0.5 - here.x, a.y - here.y, a.z + 0.5 - here.z) - Math.hypot(b.x + 0.5 - here.x, b.y - here.y, b.z + 0.5 - here.z) : 0));
        for (const q of near) {
            const w = await walkTo(bot, q, { ...options, clock });
            if (w.reason === 'interrupted') {
                return w;
            }
            if (w.ok && (await stepInto(bot, p, clock)) && at()) {
                return { ok: true, reason: null };
            }
        }
    }
    let movements;
    try {
        movements = makeMovements(bot, { dig: false, doors: false });
        movements.allowParkour = false;
    } catch (err) {
        return { ok: false, reason: 'error', error: err };
    }
    const goal = range === 0 ? new goals.GoalBlock(p.x, p.y, p.z) : new goals.GoalNear(p.x, p.y, p.z, range);
    const r = await gotoGoal(bot, goal, { movements, timeoutMs: options.timeoutMs ?? 30000, clock });
    if (at()) {
        return { ok: true, reason: null };
    }
    return { ok: false, reason: r.reason ?? 'no_path' };
}

function droppedItems(bot, center, radius) {
    try {
        return Object.values(bot.entities ?? {}).filter(e => e && e !== bot.entity && e.position
            && (e.name === 'item' || e.displayName === 'Item' || e.objectType === 'Item')
            && Math.hypot(e.position.x - center.x, e.position.y - center.y, e.position.z - center.z) <= radius);
    } catch {
        return [];
    }
}

/**
 * Picks up items that lie within `radius` of a point by walking to them without digging or
 * placing. With `options.dig` an item that cannot be reached so (in a hole of a vein) is fetched
 * with movements that may dig a block or two, outside the protected areas (`options.areas`), and
 * never next to a liquid (the pathfinder does not dig there).
 * @param {object} bot
 * @param {{x,y,z}} center
 * @param {{radius?: number, clock?: object, timeoutMs?: number, dig?: boolean, areas?: object[]}} [options]
 * @returns {Promise<{ok: boolean, visited: number}>}
 */
export async function collectDrops(bot, center, options = {}) {
    const clock = options.clock ?? clockOf(null);
    const radius = options.radius ?? 5;
    const start = clock.now();
    const limit = options.timeoutMs ?? 15000;
    const given = new Set();
    let visited = 0;
    await clock.wait(400);
    for (let i = 0; i < 16 && !bot.interrupt_code && clock.now() - start < limit; i++) {
        const items = droppedItems(bot, center, radius).filter(e => !given.has(e.id));
        if (items.length === 0) {
            break;
        }
        const me = botPos(bot);
        items.sort((a, b) => Math.hypot(a.position.x - me.x, a.position.z - me.z) - Math.hypot(b.position.x - me.x, b.position.z - me.z));
        const target = items[0];
        const cell = { x: Math.floor(target.position.x), y: Math.floor(target.position.y + 0.1), z: Math.floor(target.position.z) };
        await walkTo(bot, cell, { clock, timeoutMs: 4000, range: 0 });
        visited++;
        await clock.wait(300);
        if (!droppedItems(bot, center, radius).includes(target)) {
            continue;
        }
        if (options.dig === true) {
            try {
                const movements = makeMovements(bot, { dig: true, doors: false, areas: options.areas ?? [] });
                movements.allowParkour = false;
                await gotoGoal(bot, new goals.GoalBlock(cell.x, cell.y, cell.z), { movements, timeoutMs: 8000, clock });
            } catch {
                // leave it
            }
            await clock.wait(300);
        }
        if (droppedItems(bot, center, radius).includes(target)) {
            given.add(target.id);
        }
    }
    return { ok: droppedItems(bot, center, radius).length === 0, visited };
}
