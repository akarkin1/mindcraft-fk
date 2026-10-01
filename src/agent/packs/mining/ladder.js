// Ladders and the way of a mine (spec v0.1.4.7 M0, M4): placing a ladder on the wall of a shaft,
// sliding down a column of ladders, climbing up it, and following the legs of a mine down or up.
//
// Found on the real server (M0): the pathfinder climbs a column of ladders (20 blocks in 22 s) but
// does not go down one (it stuck 2 blocks above the bottom after 90 s). With control states the
// bot slides down 20 blocks in 7 s (the physics caps the fall at 0.15 blocks a tick) and climbs up
// in 9 s looking at the wall and walking forward. Jumping alone does not climb. So: down and up
// with control states, the pathfinder as the second way up.
import { Vec3 } from 'vec3';
import { botPos, clockOf } from '../home/context.js';
import { stopMoving } from '../home/motion.js';
import { blockAt, isFree, isSolid, race, stepInto, walkTo } from './dig.js';
import { backOf, dirVector, offset } from './mine_logic.js';

/** Yaw of mineflayer for a direction (the way pathfinder computes it: atan2(-dx, -dz)). */
export function yawOf(dir) {
    const v = dirVector(dir);
    return Math.atan2(-v.x, -v.z);
}

async function look(bot, dir) {
    try {
        await bot.look(yawOf(dir), 0, true);
    } catch {
        // looking is best effort
    }
}

function release(bot) {
    try {
        bot.clearControlStates();
    } catch {
        // nothing to release
    }
}

/**
 * F36 of the journeys (the hand-over): an order that interrupts a climb released the controls, and the bot slid
 * 0.3 blocks before the next order took the ladder. A bot in the air on a ladder holds on with sneak (the physics
 * stops a sneaking bot on a ladder); the next pass or walk clears the controls as it starts. True when it holds.
 * @param {object} bot
 * @returns {boolean}
 */
export function holdOnLadder(bot) {
    try {
        const c = feetCell(bot);
        if (!c || bot.entity?.onGround === true || blockAt(bot, c)?.name !== 'ladder') {
            return false;
        }
        bot.setControlState('sneak', true);
        return true;
    } catch {
        return false;
    }
}

// releases the controls and stops the bot on the spot
function stopFlat(bot) {
    release(bot);
    try {
        bot.entity.velocity.x = 0;
        bot.entity.velocity.z = 0;
    } catch {
        // no velocity to stop
    }
}

function feetCell(bot) {
    const p = botPos(bot);
    return p ? { x: Math.floor(p.x), y: Math.floor(p.y + 0.01), z: Math.floor(p.z) } : null;
}

/**
 * Moves the bot in short sneaking pushes to a point of the floor (x, z), at most 16 pushes.
 * @param {object} bot
 * @param {{x: number, z: number}} target
 * @param {object} clock
 * @param {number} [within]
 * @returns {Promise<boolean>} true when the bot is within `within` of the point
 */
export async function nudgeTo(bot, target, clock, within = 0.08) {
    for (let push = 0; push < 16; push++) {
        if (bot.interrupt_code) {
            break;
        }
        const q = botPos(bot);
        if (!q) {
            return false;
        }
        if (Math.hypot(target.x - q.x, target.z - q.z) < within) {
            return true;
        }
        try {
            await bot.lookAt(new Vec3(target.x, q.y + 1.6, target.z), true);
        } catch {
            // best effort
        }
        bot.setControlState('sneak', true);
        bot.setControlState('forward', true);
        await clock.wait(60);
        stopFlat(bot);
        await clock.wait(60);
    }
    const q = botPos(bot);
    return Boolean(q) && Math.hypot(target.x - q.x, target.z - q.z) < within;
}

/**
 * Places a ladder in the cell `feet` on the wall behind it: the ladder faces `face`, the wall is
 * the block on the other side. The wall must be solid. When the bot stands too near the wall (the
 * ladder would touch it and the server refuses it), it moves to the middle first.
 * @param {object} bot
 * @param {{x,y,z}} feet
 * @param {string} face
 * @param {{clock?: object}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, placed: number}>} reasons: no_item, no_wall, placed_before, protected, interrupted, failed
 */
export async function placeLadder(bot, feet, face, options = {}) {
    const clock = options.clock ?? clockOf(null);
    const here = blockAt(bot, feet);
    if (here?.name === 'ladder') {
        return { ok: true, reason: 'placed_before', placed: 0 };
    }
    const wall = blockAt(bot, offset(feet, backOf(face)));
    if (!isSolid(wall)) {
        return { ok: false, reason: 'no_wall', placed: 0 };
    }
    try {
        if (bot.areaGuard && bot.areaGuard.canPlace(feet, 'ladder') === false) {
            return { ok: false, reason: 'protected', placed: 0 };
        }
    } catch {
        // the guard decides elsewhere
    }
    const item = bot.inventory?.items?.().find(i => i.name === 'ladder');
    if (!item) {
        return { ok: false, reason: 'no_item', placed: 0 };
    }
    const f = dirVector(face);
    const me = botPos(bot);
    if (me && Math.floor(me.x) === feet.x && Math.floor(me.z) === feet.z) {
        // the ladder takes the 3/16 of the cell at the wall; the box of the bot is 0.3 from its middle
        const fromWall = (me.x - (feet.x + 0.5)) * f.x + (me.z - (feet.z + 0.5)) * f.z;
        if (fromWall < -0.005) {
            await nudgeTo(bot, { x: feet.x + 0.5 + f.x * 0.1, z: feet.z + 0.5 + f.z * 0.1 }, clock, 0.06);
        }
    }
    try {
        if (bot.heldItem?.name !== 'ladder') {
            await bot.equip(item, 'hand');
        }
    } catch {
        return { ok: false, reason: 'no_item', placed: 0 };
    }
    const v = dirVector(face);
    const res = await race(bot, bot.placeBlock(wall, new Vec3(v.x, 0, v.z)), 5000, clock);
    if (res.interrupted) {
        return { ok: false, reason: 'interrupted', placed: 0 };
    }
    if (blockAt(bot, feet)?.name === 'ladder') {
        return { ok: true, reason: null, placed: 1 };
    }
    await clock.wait(150);
    return blockAt(bot, feet)?.name === 'ladder' ? { ok: true, reason: null, placed: 1 } : { ok: false, reason: 'failed', placed: 0 };
}

/**
 * Waits until the bot stands still on the ground (not falling, not climbing).
 * @param {object} bot
 * @param {object} clock
 * @param {number} [ms]
 * @returns {Promise<boolean>}
 */
export async function waitStanding(bot, clock, ms = 3000) {
    const start = clock.now();
    while (clock.now() - start < ms) {
        if (bot.interrupt_code) {
            return false;
        }
        if (bot.entity?.onGround && Math.abs(bot.entity?.velocity?.y ?? 0) < 0.1) {
            return true;
        }
        await clock.wait(25);
    }
    return Boolean(bot.entity?.onGround);
}

/**
 * Slides down a column of ladders: from its entry (a place beside the top of the column) the bot
 * steps over the column and lets itself fall; the ladders slow the fall. Ends when it stands at
 * the bottom of the leg.
 * @param {object} bot
 * @param {{x: number, z: number, top: number, bottom: number, face: string, entry: {x,y,z}}} leg
 * @param {{clock?: object, timeoutMs?: number}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, ms: number}>}
 */
export async function slideDown(bot, leg, options = {}) {
    const clock = options.clock ?? clockOf(null);
    const t0 = clock.now();
    const at = feetCell(bot);
    if (at && at.x === leg.x && at.z === leg.z && at.y === leg.bottom) {
        return { ok: true, reason: null, ms: 0 };
    }
    const inColumn = at && at.x === leg.x && at.z === leg.z && at.y <= leg.top + 1 && at.y > leg.bottom;
    if (!inColumn) {
        if (leg.entry) {
            const w = await walkTo(bot, leg.entry, { clock, timeoutMs: options.walkMs ?? 30000 });
            if (!w.ok) {
                return { ok: false, reason: w.reason === 'interrupted' ? 'interrupted' : 'no_path', ms: clock.now() - t0 };
            }
        }
        // step over the column. The bot falls only when its box (0.6 wide) is inside the column
        // and off the top of the ladder at the wall side: a window of 0.2 blocks around a point a
        // little away from the wall (found on the real server). So: walk close, then sneak in
        // short pushes to that point.
        const f = dirVector(leg.face);
        const target = { x: leg.x + 0.5 + f.x * 0.1, z: leg.z + 0.5 + f.z * 0.1 };
        const p = botPos(bot);
        const len = p ? Math.hypot(target.x - p.x, target.z - p.z) : 0;
        if (len > 0.5) {
            const u = { x: (target.x - p.x) / len, z: (target.z - p.z) / len };
            try {
                await bot.lookAt(new Vec3(target.x, p.y + 1.6, target.z), true);
            } catch {
                // best effort
            }
            bot.setControlState('forward', true);
            const start = clock.now();
            while (clock.now() - start < 3000) {
                const q = botPos(bot);
                if (bot.interrupt_code) {
                    release(bot);
                    return { ok: false, reason: 'interrupted', ms: clock.now() - t0 };
                }
                if (!q || (target.x - q.x) * u.x + (target.z - q.z) * u.z <= 0.45) {
                    break;
                }
                await clock.wait(10);
            }
            stopFlat(bot);
        }
        const y0 = botPos(bot)?.y ?? 0;
        for (let push = 0; push < 16; push++) {
            if (bot.interrupt_code) {
                release(bot);
                return { ok: false, reason: 'interrupted', ms: clock.now() - t0 };
            }
            const q = botPos(bot);
            if (!q || q.y < y0 - 0.2) {
                break;
            }
            if (Math.hypot(target.x - q.x, target.z - q.z) < 0.06) {
                await clock.wait(100);
                continue;
            }
            try {
                await bot.lookAt(new Vec3(target.x, q.y + 1.6, target.z), true);
            } catch {
                // best effort
            }
            bot.setControlState('sneak', true);
            bot.setControlState('forward', true);
            await clock.wait(60);
            stopFlat(bot);
            await clock.wait(60);
        }
    }
    const depth = Math.max(1, leg.top + 1 - leg.bottom);
    const limit = options.timeoutMs ?? depth * 800 + 5000;
    const start = clock.now();
    let lastY = botPos(bot)?.y ?? 0;
    let still = clock.now();
    while (clock.now() - start < limit) {
        if (bot.interrupt_code) {
            release(bot);
            return { ok: false, reason: 'interrupted', ms: clock.now() - t0 };
        }
        const c = feetCell(bot);
        if (c && c.y <= leg.bottom && bot.entity?.onGround) {
            break;
        }
        const y = botPos(bot)?.y ?? lastY;
        if (Math.abs(y - lastY) > 0.05) {
            lastY = y;
            still = clock.now();
        } else if (clock.now() - still > 2500) {
            break;
        }
        await clock.wait(50);
    }
    release(bot);
    // v0.1.4.9, F22: a column that ends above the floor ends with a drop: the feet on the ground at most 2 blocks
    // below the bottom count as arrived
    let end = feetCell(bot);
    if (end && end.y < leg.bottom) {
        await waitStanding(bot, clock, 2000);
        end = feetCell(bot);
    }
    const ok = Boolean(end) && end.x === leg.x && end.z === leg.z && end.y <= leg.bottom && end.y >= leg.bottom - 2
        && (end.y === leg.bottom || bot.entity?.onGround === true);
    return { ok, reason: ok ? null : 'stuck', ms: clock.now() - t0 };
}

function isCell(p) {
    return p !== null && typeof p === 'object' && [p.x, p.y, p.z].every(Number.isFinite);
}

// The bot can stand in the cell: feet and head free, a solid block under it.
function standable(bot, p) {
    return isFree(blockAt(bot, p)) && isFree(blockAt(bot, { x: p.x, y: p.y + 1, z: p.z })) && isSolid(blockAt(bot, { x: p.x, y: p.y - 1, z: p.z }));
}

/**
 * The foot of a column of ladders (fix round 2 of v0.1.4.9, F3): the cell beside the column at its bottom
 * from which the bot steps into it. `leg.foot` when the leg has one (a route of the routes pack), else the
 * cell on the side the ladders face at the height of the bottom, when the bot can stand there; else null.
 * @param {object} bot
 * @param {{x: number, z: number, bottom: number, face: string, foot?: {x,y,z}}} leg
 * @returns {{x: number, y: number, z: number}|null}
 */
export function footOf(bot, leg) {
    if (isCell(leg?.foot)) {
        return { x: Math.floor(leg.foot.x), y: Math.floor(leg.foot.y), z: Math.floor(leg.foot.z) };
    }
    const cell = offset({ x: leg.x, y: leg.bottom, z: leg.z }, leg.face);
    return standable(bot, cell) ? cell : null;
}

/**
 * Into a column of ladders from its foot (fix round 2 of v0.1.4.9, F3): walks to the foot (footOf) and steps
 * into the bottom of the column with stepInto. No goal of the path search lies in the column: the path search
 * would climb the ladders on its own. A bot in the column already stays.
 * @param {object} bot
 * @param {{x: number, z: number, top: number, bottom: number, face: string, foot?: {x,y,z}}} leg
 * @param {{clock?: object, walkMs?: number}} [options]
 * F22b: with 2 or more free cells between the floor and the lowest ladder, the missing ladders are placed on the
 * wall from the floor up (placeLadder) when the bot carries them; `leg.bottom` becomes the new lowest ladder and
 * the result has `placed` and `bottom`. Without enough ladders: reason no_ladder with `missing`, the cells from
 * the lowest.
 * @returns {Promise<{ok: boolean, reason: string|null, placed?: object[], bottom?: number, missing?: object[]}>}
 *   reasons: no_foot, no_path, no_ladder, interrupted
 */
export async function enterColumn(bot, leg, options = {}) {
    const clock = options.clock ?? clockOf(null);
    const inColumn = () => {
        const c = feetCell(bot);
        return Boolean(c) && c.x === leg.x && c.z === leg.z && c.y >= leg.bottom - 1 && c.y <= leg.top + 1;
    };
    if (inColumn()) {
        return { ok: true, reason: null };
    }
    const foot = footOf(bot, leg);
    if (!foot) {
        return { ok: false, reason: 'no_foot' };
    }
    const w = await walkTo(bot, foot, { clock, timeoutMs: options.walkMs ?? 30000 });
    if (!w.ok) {
        return { ok: false, reason: w.reason === 'interrupted' ? 'interrupted' : 'no_path' };
    }
    if (foot.y < leg.bottom - 1) {
        // v0.1.4.9, F22: the column ends more than 1 block above the floor: under it (a step in when the foot is
        // beside it), then jump at the wall until the feet are in a ladder cell, at most 5 s
        const under = { x: leg.x, y: foot.y, z: leg.z };
        if (foot.x !== leg.x || foot.z !== leg.z) {
            await stepInto(bot, under, clock);
        }
        // F22b: 2 or more free cells between the floor and the lowest ladder: no jump grabs it; the missing
        // ladders are placed on the wall from the floor up when the bot carries them
        const lowest = lowestLadder(bot, leg, foot.y);
        const missing = [];
        for (let y = foot.y + 1; y < lowest; y++) {
            missing.push({ x: leg.x, y, z: leg.z });
        }
        if (lowest - foot.y >= 2) {
            const carried = (bot.inventory?.items?.() ?? []).filter(i => i.name === 'ladder').reduce((n, i) => n + i.count, 0);
            if (carried < missing.length) {
                return { ok: false, reason: 'no_ladder', missing };
            }
            for (const cell of missing) {
                const placed = await placeLadder(bot, cell, leg.face, { clock });
                if (!placed.ok) {
                    const rest = missing.filter(c => c.y >= cell.y);
                    return placed.reason === 'interrupted' ? { ok: false, reason: 'interrupted' } : { ok: false, reason: 'no_ladder', missing: rest };
                }
            }
            leg.bottom = foot.y + 1; // the new lowest ladder
            const r = await jumpOnto(bot, leg, clock, inColumn);
            return { ...r, placed: missing, bottom: leg.bottom };
        }
        return await jumpOnto(bot, leg, clock, inColumn);
    }
    await stepInto(bot, { x: leg.x, y: leg.bottom, z: leg.z }, clock);
    if (bot.interrupt_code) {
        return { ok: false, reason: 'interrupted' };
    }
    return inColumn() ? { ok: true, reason: null } : { ok: false, reason: 'no_path' };
}

// F22b: the lowest ladder of the column, down from the bottom of the leg to the cell above the floor.
function lowestLadder(bot, leg, floorY) {
    let y = leg.bottom;
    while (y - 1 > floorY && blockAt(bot, { x: leg.x, y: y - 1, z: leg.z })?.name === 'ladder') {
        y--;
    }
    return y;
}

// F22: from the floor under a column that ends above it, jump at the wall (the physics of 1.21 climbs a ladder
// while jump is held, patches/prismarine-physics) until the feet are in a ladder cell; at most 5 s.
async function jumpOnto(bot, leg, clock, inColumn) {
    const onLadder = () => {
        const c = feetCell(bot);
        return Boolean(c) && c.x === leg.x && c.z === leg.z && blockAt(bot, c)?.name === 'ladder';
    };
    const c = feetCell(bot);
    if (!c || c.x !== leg.x || c.z !== leg.z) {
        return { ok: false, reason: bot.interrupt_code ? 'interrupted' : 'no_path' };
    }
    await look(bot, backOf(leg.face));
    bot.setControlState('forward', true);
    bot.setControlState('jump', true);
    const start = clock.now();
    while (clock.now() - start < 5000 && !onLadder()) {
        if (bot.interrupt_code) {
            release(bot);
            return { ok: false, reason: 'interrupted' };
        }
        await clock.wait(50);
    }
    const ok = onLadder();
    if (!ok) {
        release(bot);
    } else {
        bot.setControlState('jump', false); // forward stays: climbUp goes on climbing
    }
    return ok && inColumn() ? { ok: true, reason: null } : { ok: false, reason: 'no_path' };
}

// At the top of the column with a way out above it (fix round 2, F1): the feet at the top ladder or in the
// cell above it, and that cell an open trapdoor, or free with the entry beside it.
function wayOutAbove(bot, leg, entry) {
    const c = feetCell(bot);
    if (!c || c.x !== leg.x || c.z !== leg.z || c.y < leg.top) {
        return false;
    }
    const above = blockAt(bot, { x: leg.x, y: leg.top + 1, z: leg.z });
    const props = (typeof above?.getProperties === 'function' ? above.getProperties() : above?._properties) ?? {};
    if (typeof above?.name === 'string' && above.name.endsWith('_trapdoor')) {
        return props.open === true;
    }
    return isFree(above) && Math.max(Math.abs(entry.x - leg.x), Math.abs(entry.z - leg.z)) === 1 && entry.y >= leg.top + 1 && entry.y <= leg.top + 2;
}

// The second way out at the top (F1): jump and hold forward towards the entry for 1 s. True when arrived.
async function jumpOut(bot, entry, clock, arrived) {
    const p = botPos(bot);
    try {
        await bot.lookAt(new Vec3(entry.x + 0.5, (p?.y ?? entry.y) + 1.6, entry.z + 0.5), true);
    } catch {
        // best effort
    }
    bot.setControlState('forward', true);
    bot.setControlState('jump', true);
    const start = clock.now();
    while (clock.now() - start < 1000 && !bot.interrupt_code && !arrived()) {
        await clock.wait(50);
    }
    release(bot);
    await waitStanding(bot, clock, 600);
    return arrived();
}

/**
 * Climbs up a column of ladders: looks at the wall with the ladders and walks forward; at the top
 * the bot steps onto the wall, which is its entry. When the climb gets stuck the pathfinder tries
 * (it climbs ladders).
 * Fix round 2 of v0.1.4.9: a bot outside the column walks to its foot (footOf) and steps in with
 * stepInto; no goal of the path search lies in the column (F3). At the top, when the bot does not rise
 * for 1.5 s and above it is an open trapdoor or a free cell beside the entry, it jumps and walks towards
 * the entry for 1 s, up to 3 times, before the pathfinder tries (F1). "Not rising" is measured by the
 * highest point, so that bobbing at the top counts.
 * @param {object} bot
 * @param {{x: number, z: number, top: number, bottom: number, face: string, entry: {x,y,z}, foot?: {x,y,z}}} leg
 * @param {{clock?: object, timeoutMs?: number, walkMs?: number}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, ms: number}>}
 */
export async function climbUp(bot, leg, options = {}) {
    const clock = options.clock ?? clockOf(null);
    const t0 = clock.now();
    const entry = leg.entry ?? { ...offset({ x: leg.x, y: leg.top + 1, z: leg.z }, backOf(leg.face)) };
    const arrived = () => {
        const c = feetCell(bot);
        return Boolean(c) && c.y >= entry.y && bot.entity?.onGround && !(c.x === leg.x && c.z === leg.z);
    };
    if (arrived()) {
        return { ok: true, reason: null, ms: 0 };
    }
    const into = await enterColumn(bot, leg, { clock, walkMs: options.walkMs });
    if (!into.ok && into.reason !== 'no_foot') {
        return { ok: false, reason: into.reason, ms: clock.now() - t0, ...(into.missing ? { missing: into.missing } : {}) };
    }
    const depth = Math.max(1, leg.top + 1 - leg.bottom);
    const limit = options.timeoutMs ?? depth * 700 + 6000;
    await look(bot, backOf(leg.face));
    bot.setControlState('forward', true);
    const start = clock.now();
    let best = botPos(bot)?.y ?? 0;
    let still = clock.now();
    let stuck = false;
    let tries = 0;
    while (clock.now() - start < limit) {
        if (bot.interrupt_code) {
            release(bot);
            return { ok: false, reason: 'interrupted', ms: clock.now() - t0 };
        }
        if (arrived()) {
            break;
        }
        // under the lowest ladder (the column ends one block above the floor): a jump reaches it
        const c = feetCell(bot);
        const onLadder = c && blockAt(bot, c)?.name === 'ladder';
        bot.setControlState('jump', Boolean(c) && !onLadder && c.x === leg.x && c.z === leg.z && bot.entity?.onGround === true);
        const y = botPos(bot)?.y ?? best;
        if (y > best + 0.05) {
            best = y;
            still = clock.now();
        } else if (tries < 3 && clock.now() - still > 1500 && wayOutAbove(bot, leg, entry)) {
            tries++;
            if (await jumpOut(bot, entry, clock, arrived)) {
                break;
            }
            await look(bot, backOf(leg.face));
            bot.setControlState('forward', true);
            best = botPos(bot)?.y ?? best;
            still = clock.now();
        } else if (clock.now() - still > 3000) {
            stuck = true;
            break;
        }
        await clock.wait(50);
    }
    release(bot);
    if (!arrived() && !bot.interrupt_code) {
        // the second way: the pathfinder climbs ladders
        const w = await walkTo(bot, entry, { clock, timeoutMs: Math.max(10000, depth * 1500) });
        if (!w.ok && w.reason === 'interrupted') {
            return { ok: false, reason: 'interrupted', ms: clock.now() - t0 };
        }
    }
    stopMoving(bot);
    const ok = arrived() || (feetCell(bot)?.y ?? -Infinity) >= entry.y;
    return { ok, reason: ok ? null : (stuck ? 'stuck' : 'timeout'), ms: clock.now() - t0 };
}

/**
 * The cells of a staircase leg, from its top (`from`) to its bottom (`to`): one forward and one
 * down per step.
 * @param {{from: {x,y,z}, to: {x,y,z}, dir: string}} leg
 * @returns {{x: number, y: number, z: number}[]}
 */
export function stairCells(leg) {
    const v = dirVector(leg.dir);
    const n = Math.max(0, leg.from.y - leg.to.y);
    const out = [];
    for (let k = 0; k <= n; k++) {
        out.push({ x: leg.from.x + v.x * k, y: leg.from.y - k, z: leg.from.z + v.z * k });
    }
    return out;
}

/**
 * Walks a staircase step by step with the controls (down: forward and fall; up: forward and jump).
 * The pathfinder does not go down steps out of a ladder well. A step that fails is tried with the
 * pathfinder.
 * @param {object} bot
 * @param {{from: {x,y,z}, to: {x,y,z}, dir: string}} leg
 * @param {'down'|'up'} way
 * @param {{clock?: object}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null}>}
 */
export async function walkStairs(bot, leg, way, options = {}) {
    const clock = options.clock ?? clockOf(null);
    const cells = stairCells(leg);
    if (way === 'up') {
        cells.reverse();
    }
    const first = cells[0];
    const at = feetCell(bot);
    if (!at || at.x !== first.x || at.y !== first.y || at.z !== first.z) {
        const w = await walkTo(bot, first, { clock, timeoutMs: 30000 });
        if (!w.ok) {
            return { ok: false, reason: w.reason };
        }
    }
    for (const cell of cells.slice(1)) {
        if (bot.interrupt_code) {
            return { ok: false, reason: 'interrupted' };
        }
        if (!(await stepInto(bot, cell, clock))) {
            const w = await walkTo(bot, cell, { clock, timeoutMs: 8000 });
            if (!w.ok) {
                return { ok: false, reason: w.reason === 'interrupted' ? 'interrupted' : 'stuck' };
            }
        }
    }
    return { ok: true, reason: null };
}

/**
 * Follows the legs of a mine down: ladders by sliding, staircases step by step, walks with the
 * pathfinder (a walk to the top of a column is left to the slide, which walks to its entry).
 * @param {object} bot
 * @param {object[]} route the legs, from the entrance down
 * @param {{clock?: object, deadline?: number}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, legs: number}>}
 */
export async function followDown(bot, route, options = {}) {
    const clock = options.clock ?? clockOf(null);
    const list = Array.isArray(route) ? route : [];
    let legs = 0;
    for (let i = 0; i < list.length; i++) {
        const leg = list[i];
        if (bot.interrupt_code) {
            return { ok: false, reason: 'interrupted', legs };
        }
        if (Number.isFinite(options.deadline) && clock.now() > options.deadline) {
            return { ok: false, reason: 'timeout', legs };
        }
        let r = { ok: true, reason: null };
        if (leg.kind === 'ladder') {
            r = await slideDown(bot, leg, { clock });
        } else if (leg.kind === 'stairs') {
            r = await walkStairs(bot, leg, 'down', { clock });
        } else if (list[i + 1]?.kind !== 'ladder') {
            r = await walkTo(bot, leg.to, { clock, timeoutMs: 60000 });
        }
        if (!r.ok) {
            return { ok: false, reason: r.reason, legs };
        }
        legs++;
    }
    return { ok: true, reason: null, legs };
}

/**
 * Follows the legs of a mine up, from the last to the first: ladders by climbing, walks and
 * staircases with the pathfinder. The bot starts at the end of the last leg.
 * @param {object} bot
 * @param {object[]} route
 * @param {{clock?: object}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, legs: number}>}
 */
export async function followUp(bot, route, options = {}) {
    const clock = options.clock ?? clockOf(null);
    const list = (Array.isArray(route) ? route : []).slice().reverse();
    let legs = 0;
    for (const leg of list) {
        if (bot.interrupt_code) {
            return { ok: false, reason: 'interrupted', legs };
        }
        let r;
        if (leg.kind === 'ladder') {
            const bottom = { x: leg.x, y: leg.bottom, z: leg.z };
            const c = feetCell(bot);
            // a leg with a foot (v0.1.4.9, F3): climbUp walks to the foot and steps in, no goal in the column
            if (!isCell(leg.foot) && !(c && c.x === leg.x && c.z === leg.z && c.y >= leg.bottom - 1 && c.y <= leg.top + 1)) {
                const w = await walkTo(bot, bottom, { clock, timeoutMs: 60000 });
                if (!w.ok) {
                    return { ok: false, reason: w.reason, legs };
                }
            }
            r = await climbUp(bot, leg, { clock });
        } else if (leg.kind === 'stairs') {
            r = await walkStairs(bot, leg, 'up', { clock });
        } else {
            r = await walkTo(bot, leg.from, { clock, timeoutMs: 60000 });
        }
        if (!r.ok) {
            return { ok: false, reason: r.reason, legs };
        }
        legs++;
    }
    return { ok: true, reason: null, legs };
}
