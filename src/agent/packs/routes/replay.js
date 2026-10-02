// Walking a route (spec v0.1.4.9 I3, I4, A5): leg by leg, walk legs with the path search, ladders with the
// control states of the mining pack, doors, gates and trapdoors with the door helpers of the home pack.
// Nothing is dug and nothing is closed (the door service closes doors behind the bot). A leg that fails
// ends the walk with the step and the position.
//
// Found while building it: a trapdoor over a column of ladders is closed behind the bot by the door
// service, so the way up finds it closed. The ladder leg therefore opens a closed trapdoor at the top of
// its column itself: from above before it slides down, from the ladder below it before it climbs out.
// A column with a missing ladder is never entered: the bot would fall.
import { botPos, clockOf, logTo, noteProgress } from '../home/context.js';
import { sideOf } from '../home/door_logic.js';
import { closeDoor, doorState, openDoor } from '../home/doors.js';
import { goals, gotoGoal, isNear, makeMovements, walkNear } from '../home/motion.js';
import { climbUp, enterColumn, footOf, slideDown, waitStanding, walkStairs, yawOf, holdOnLadder } from '../mining/ladder.js';
import { backOf, nearCell, nearestRoute, reverseRoute, routeEnds, trapdoorOverLadder } from './route_logic.js';
import { TEXTS, emptyRouteText, noWayToStartText, routeDoneText, routeErrorText, routeFailedText, routeLabel, routeStoppedText,
    routeTimeText, stoppedBeforeRouteText } from './texts.js';
import { readBlock } from './trail.js';

/** The numbers of the walk. */
export const REPLAY_RULES = Object.freeze({
    timeoutMs: 120000,   // the whole route
    walkMs: 20000,       // one try of a walk leg
    startMs: 30000,      // the walk to the start of a route
    reach: 4.5,          // a hand reaches an openable this far from the eyes
    holdReach: 2.5,      // on the way up, the bot stops this near below a closed trapdoor to open it
    fallGap: 2,          // on the way down, at most this many ladders may be missing in a row
});

const OK = Object.freeze({ ok: true, reason: null });
const INTERRUPTED = Object.freeze({ ok: false, reason: 'interrupted' });

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
}

function feetOf(bot) {
    const p = botPos(bot);
    return p ? { x: Math.floor(p.x), y: Math.floor(p.y + 0.01), z: Math.floor(p.z) } : null;
}

function release(bot) {
    try {
        bot.clearControlStates();
    } catch {
        // nothing to release
    }
}

function eyeDistance(bot, block) {
    const p = botPos(bot);
    return p ? Math.hypot(block.x + 0.5 - p.x, block.y + 0.5 - (p.y + 1.62), block.z + 0.5 - p.z) : Infinity;
}

function doorOptions(ctx, clock) {
    return { ctx, now: clock.now, wait: clock.wait };
}

// ---- the legs ----

// Walks to a cell (the bot is there when its feet are within 1 block): walkNear with doors allowed and no
// digging, then once more with a goal GoalNear of 1.
// Fix round 2 (F3): the cell to walk to instead of a cell with a ladder, where the path search would climb: the
// free cell beside it with solid ground, nearest to the bot; null when there is none.
function besideLadder(bot, target) {
    const free = (x, y, z) => {
        const b = readBlock(bot, x, y, z);
        return Boolean(b) && b.solid === false && b.name !== 'water' && b.name !== 'lava';
    };
    const ground = (x, y, z) => {
        const b = readBlock(bot, x, y, z);
        return Boolean(b) && b.solid === true && b.name !== 'ladder';
    };
    const me = botPos(bot);
    const cells = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ x: target.x + dx, y: target.y, z: target.z + dz }))
        .filter(c => free(c.x, c.y, c.z) && free(c.x, c.y + 1, c.z) && ground(c.x, c.y - 1, c.z));
    if (me) {
        cells.sort((a, b) => Math.hypot(a.x + 0.5 - me.x, a.z + 0.5 - me.z) - Math.hypot(b.x + 0.5 - me.x, b.z + 0.5 - me.z));
    }
    return cells[0] ?? null;
}

async function walkToCell(bot, target, clock, ms) {
    if (nearCell(botPos(bot), target)) {
        return OK;
    }
    if (readBlock(bot, target.x, target.y, target.z)?.name === 'ladder') {
        const beside = besideLadder(bot, target);
        return beside ? await walkToCell(bot, beside, clock, ms) : { ok: false, reason: 'no_path' };
    }
    const first = await walkNear(bot, target, 0, { clock, timeoutMs: ms, allowDoors: true, allowDig: false });
    if (first.reason === 'interrupted' || bot.interrupt_code) {
        return INTERRUPTED;
    }
    if (!nearCell(botPos(bot), target)) {
        let movements;
        try {
            movements = makeMovements(bot, { dig: false, doors: true });
        } catch {
            return { ok: false, reason: 'error' };
        }
        const second = await gotoGoal(bot, new goals.GoalNear(target.x, target.y, target.z, 1), { movements, timeoutMs: ms, clock });
        if (second.reason === 'interrupted' || bot.interrupt_code) {
            return INTERRUPTED;
        }
    }
    return nearCell(botPos(bot), target) ? OK : { ok: false, reason: 'no_path' };
}

/**
 * True when the cells of the column of a ladder leg above its bottom hold ladders (the bottom may be the
 * floor under the column), with at most `maxGap` missing ones in a row: on the way down a gap of 2 is a
 * fall of 3 blocks, which does no harm; the way up needs every ladder. Never throws.
 * @param {object} bot
 * @param {{x: number, z: number, top: number, bottom: number}} leg
 * @param {number} [maxGap]
 * @returns {boolean}
 */
export function ladderIntact(bot, leg, maxGap = 0) {
    try {
        let gap = 0;
        for (let y = leg.top; y > leg.bottom; y--) {
            gap = readBlock(bot, leg.x, y, leg.z)?.name === 'ladder' ? 0 : gap + 1;
            if (gap > maxGap) {
                return false;
            }
        }
        return leg.top > leg.bottom;
    } catch {
        return false;
    }
}

// A trapdoor in the column right above the ladders (1 or 2 blocks above the top), as doorState reads it.
function trapdoorAbove(bot, leg) {
    for (const y of [leg.top + 1, leg.top + 2]) {
        const state = doorState(bot, { x: leg.x, y, z: leg.z });
        if (state && state.kind === 'trapdoor') {
            return state;
        }
    }
    return null;
}

// On the way up: climbs until the closed trapdoor is within reach, holds on the ladder by pressing forward against it and opens it.
async function climbToOpen(bot, ctx, leg, trap, clock) {
    const limit = Math.max(1, trap.y - leg.bottom) * 700 + 6000;
    try {
        await bot.look(yawOf(backOf(leg.face)), 0, true);
    } catch {
        // looking is best effort
    }
    bot.setControlState('forward', true);
    const start = clock.now();
    let lastY = botPos(bot)?.y ?? 0;
    let still = clock.now();
    while (clock.now() - start < limit) {
        if (bot.interrupt_code) {
            release(bot);
            return INTERRUPTED;
        }
        const p = botPos(bot);
        if (!p || eyeDistance(bot, trap) <= REPLAY_RULES.holdReach) {
            break;
        }
        const c = feetOf(bot);
        const onLadder = readBlock(bot, c.x, c.y, c.z)?.name === 'ladder';
        bot.setControlState('jump', !onLadder && c.x === leg.x && c.z === leg.z && bot.entity?.onGround === true);
        if (Math.abs(p.y - lastY) > 0.05) {
            lastY = p.y;
            still = clock.now();
        } else if (clock.now() - still > 1500) {
            break;
        }
        await clock.wait(50);
    }
    // F11 of the real server: a sneaking click with an item in the hand uses the item, not the block, so the
    // trapdoor never opened while the bot held a pickaxe. The bot holds itself on the ladder by pressing
    // forward against the closed trapdoor instead of sneaking, and clicks without sneak.
    // F34 of the journeys: the click turns the look to the trapdoor; with forward pressed the bot walked out of
    // the column and fell 0.3 blocks. Only jump is held during the click (a jump climbs a ladder in 1.21 without
    // a step aside), the look goes back to the wall at once, then forward for the climb that follows.
    bot.setControlState('sneak', false);
    bot.setControlState('forward', false); // forward with the look turned walks the bot out of the column: it fell
    bot.setControlState('jump', true);
    await clock.wait(400); // F39: the state of a click just before this leg reaches the bot a moment later
    const now = doorState(bot, trap);
    const opened = now?.open === true || (eyeDistance(bot, trap) <= REPLAY_RULES.reach && (await openDoor(bot, trap, doorOptions(ctx, clock))));
    try {
        await bot.look(yawOf(backOf(leg.face)), 0, true);
    } catch {
        // looking is best effort
    }
    bot.setControlState('forward', true);
    bot.setControlState('jump', false);
    if (bot.interrupt_code) {
        release(bot);
        return INTERRUPTED;
    }
    if (!opened) {
        release(bot);
        return { ok: false, reason: 'blocked_door', door: trap };
    }
    return OK;
}

/**
 * The walk of a ladder leg (exported for the waypoint walk of v0.1.4.11, F1): down (slideDown, a closed trapdoor
 * over the column opened from above and closed 2 blocks below it) or up (to the foot, enterColumn with the missing
 * ladders placed under the column, a closed trapdoor opened from the ladder, climbUp, the trapdoor closed). The way
 * is where the bot stands (above the bottom: down), unless `way` says it ('up' or 'down').
 * @returns {Promise<{ok: boolean, reason: string|null, door?: object, missing?: object[]}>}
 */
export async function ladderLeg(bot, ctx, leg, clock, ms, way = null) {
    const c = feetOf(bot);
    const down = way === 'down' || way === 'up' ? way === 'down' && Boolean(c) : Boolean(c) && c.y > leg.bottom;
    if (!c || !ladderIntact(bot, leg, down ? REPLAY_RULES.fallGap : 0)) {
        return { ok: false, reason: 'no_path' };
    }
    // v0.1.4.11 (F1): a waypoint walk that joins the column below its top on the way down leaves the trapdoor over it alone
    const below = way === 'down' && c.x === leg.x && c.z === leg.z && c.y <= leg.top;
    const trap = below ? null : trapdoorAbove(bot, leg);
    if (down) {
        // down: a closed trapdoor over the column is opened from above first
        if (trap && !trap.open) {
            if (eyeDistance(bot, trap) > REPLAY_RULES.reach && isPoint(leg.entry)) {
                const w = await walkToCell(bot, leg.entry, clock, ms);
                if (!w.ok) {
                    return w;
                }
            }
            if (!(await openDoor(bot, trap, doorOptions(ctx, clock)))) {
                return bot.interrupt_code ? INTERRUPTED : { ok: false, reason: 'blocked_door', door: trap };
            }
        }
        // the trapdoor the bot came through is closed by the leg itself, 2 blocks below it (as the ladder pass does)
        const closing = trap ? closeWhenBelow(bot, leg, trap, clock) : Promise.resolve();
        const r = await slideDown(bot, leg, { clock });
        await closing;
        if (!r.ok) {
            return r.reason === 'interrupted' || bot.interrupt_code ? INTERRUPTED : { ok: false, reason: 'no_path' };
        }
    } else {
        // fix round 2 (F3): outside the column the bot goes to the foot and steps in (climbUp); no goal of the
        // path search in the column, where the path search would climb on its own
        const inColumn = c.x === leg.x && c.z === leg.z && c.y >= leg.bottom - 1 && c.y <= leg.top + 1;
        const foot = inColumn ? null : footOf(bot, leg);
        if (!inColumn && !foot) {
            return { ok: false, reason: 'no_path' };
        }
        if (foot) {
            const w = await walkToCell(bot, foot, clock, ms);
            if (!w.ok) {
                return w;
            }
            const into = await enterColumn(bot, { ...leg, foot }, { clock });
            if (Number.isFinite(into.bottom)) {
                leg.bottom = into.bottom; // F22b: the ladders placed under the column
            }
            if (!into.ok) {
                if (into.reason === 'interrupted' || bot.interrupt_code) {
                    return INTERRUPTED;
                }
                return { ok: false, reason: 'no_path', missing: into.missing ?? null };
            }
        }
        if (trap && !trap.open) {
            const o = await climbToOpen(bot, ctx, leg, trap, clock);
            if (!o.ok) {
                return o;
            }
        }
        const r = await climbUp(bot, leg, { clock });
        if (!r.ok) {
            if (r.reason === 'interrupted' || bot.interrupt_code) {
                return INTERRUPTED;
            }
            return { ok: false, reason: 'no_path', missing: r.missing ?? null };
        }
        // F35: the trapdoor the bot climbed out of is closed at once (the next leg would walk over the hole)
        if (trap) {
            const now = doorState(bot, trap);
            const f = feetOf(bot);
            if (now?.open === true && !(f && f.x === leg.x && f.z === leg.z) && !bot.interrupt_code) {
                await closeDoor(bot, now, doorOptions(ctx, clock));
            }
        }
    }
    await waitStanding(bot, clock, 2000);
    return bot.interrupt_code ? INTERRUPTED : OK;
}

// Waits up to 4 s for the feet of the bot to be 2 or more blocks below the trapdoor over the column, then closes it
// once, unless the command was stopped. Never throws.
async function closeWhenBelow(bot, leg, trap, clock) {
    try {
        const start = clock.now();
        while (clock.now() - start < 4000) {
            if (bot.interrupt_code) {
                return false;
            }
            const c = feetOf(bot);
            if (c && c.x === leg.x && c.z === leg.z && c.y <= trap.y - 2) {
                const state = doorState(bot, trap);
                return Boolean(state && state.open === true) ? await closeDoor(bot, state, { now: clock.now, wait: clock.wait }) : false;
            }
            await clock.wait(50);
        }
        return false;
    } catch {
        return false;
    }
}

async function stairsLeg(bot, leg, clock) {
    const c = feetOf(bot);
    const bottom = Math.min(leg.from.y, leg.to.y);
    const r = await walkStairs(bot, leg, c && c.y > bottom ? 'down' : 'up', { clock });
    if (!r.ok) {
        return r.reason === 'interrupted' || bot.interrupt_code ? INTERRUPTED : { ok: false, reason: 'no_path' };
    }
    return OK;
}

// True when the bot stands on the side of `to` already (it went through, or was never before the openable).
function onFarSide(state, leg, pos) {
    if (!pos) {
        return false;
    }
    if (leg.kind2 === 'trapdoor') {
        const side = y => (y < leg.y ? -1 : 1);
        return side(leg.from.y) !== side(leg.to.y) && side(Math.floor(pos.y + 0.01)) === side(leg.to.y);
    }
    if (!state?.facing) {
        return false;
    }
    const far = sideOf(state, { x: leg.to.x + 0.5, y: leg.to.y, z: leg.to.z + 0.5 });
    return far !== 0 && sideOf(state, pos) === far;
}

async function doorLeg(bot, ctx, leg, next, clock, ms) {
    if (nearCell(botPos(bot), leg.to)) {
        return OK;
    }
    let state = doorState(bot, leg);
    if (state === null || onFarSide(state, leg, botPos(bot))) {
        // the openable is gone, or the bot is through already: the rest is a walk
        return await walkToCell(bot, leg.to, clock, ms());
    }
    const w = await walkToCell(bot, leg.from, clock, ms());
    if (!w.ok) {
        return w;
    }
    state = doorState(bot, leg);
    if (state && !state.open) {
        if (!(await openDoor(bot, state, doorOptions(ctx, clock)))) {
            return bot.interrupt_code ? INTERRUPTED : { ok: false, reason: 'blocked_door' };
        }
    }
    if (trapdoorOverLadder(leg, next) && leg.from?.y > leg.y) {
        // going down: the ladder leg steps onto the ladder (a bot that stood on the trapdoor is on it already)
        return OK;
    }
    return await walkToCell(bot, leg.to, clock, ms());
}

async function walkLeg(bot, ctx, legs, i, clock, limit) {
    const leg = legs[i];
    const ms = () => Math.max(1000, Math.min(REPLAY_RULES.walkMs, limit - clock.now()));
    switch (leg?.kind) {
        case 'walk':
            return isPoint(leg.to) ? await walkToCell(bot, leg.to, clock, ms()) : { ok: false, reason: 'error' };
        case 'ladder':
            return await ladderLeg(bot, ctx, leg, clock, ms());
        case 'stairs':
            return isPoint(leg.from) && isPoint(leg.to) ? await stairsLeg(bot, leg, clock) : { ok: false, reason: 'error' };
        case 'door':
            return isPoint(leg.from) && isPoint(leg.to) && isPoint(leg) ? await doorLeg(bot, ctx, leg, legs[i + 1], clock, ms) : { ok: false, reason: 'error' };
        default:
            return { ok: false, reason: 'error' };
    }
}

// ---- the cause of a failed leg (v0.1.4.11, I1): from what the replay knows, the walk itself is unchanged ----

/**
 * The largest run of missing ladders in the column of a ladder leg above its bottom, as { y, gap } with y the
 * lowest cell of the run (the lowest run of the largest); null when every ladder is there. Never throws.
 * Exported for the dry scan of v0.1.4.11 (F1).
 * @param {object} bot
 * @param {{x: number, z: number, top: number, bottom: number}} leg
 * @returns {{y: number, gap: number}|null}
 */
export function ladderGap(bot, leg) {
    try {
        let best = null;
        let run = 0;
        for (let y = leg.top; y > leg.bottom; y--) {
            run = readBlock(bot, leg.x, y, leg.z)?.name === 'ladder' ? 0 : run + 1;
            if (run > 0 && (best === null || run >= best.gap)) {
                best = { y, gap: run };
            }
        }
        return best;
    } catch {
        return null;
    }
}

// The cause of I1 of a ladder leg: the missing ladders (cells of climbUp or enterColumn, else read from the
// column), or stuck at the feet.
function ladderCause(bot, leg, missing) {
    const at = feetOf(bot);
    if (!leg || !isFiniteNumber(leg.x) || !isFiniteNumber(leg.z)) {
        return { kind: 'stuck', at };
    }
    const cells = (Array.isArray(missing) ? missing : []).filter(isPoint);
    if (cells.length > 0) {
        return { kind: 'ladder', x: leg.x, z: leg.z, y: Math.min(...cells.map(c => c.y)), gap: cells.length };
    }
    const gap = isFiniteNumber(leg.top) && isFiniteNumber(leg.bottom) ? ladderGap(bot, leg) : null;
    return gap ? { kind: 'ladder', x: leg.x, z: leg.z, y: gap.y, gap: gap.gap } : { kind: 'stuck', at };
}

// The cause of I1 of an openable: closed when it is closed now, else blocked.
function doorCause(bot, door, name) {
    const state = doorState(bot, door);
    const kind = typeof state?.kind === 'string' ? state.kind : name;
    return { kind: 'door', name: ['door', 'gate', 'trapdoor'].includes(kind) ? kind : 'door', x: door.x, y: door.y, z: door.z,
        state: state && state.open === false ? 'closed' : 'blocked' };
}

/**
 * The cause of I1 for a leg that failed (v0.1.4.11): a door leg gives `door`, a ladder leg `ladder` (or `door`
 * for its trapdoor, `stuck` when every ladder is there), a walk or stairs leg `no_path` from the feet to its end;
 * anything else `stuck` at the feet. Never throws.
 * @param {object} bot
 * @param {object} leg the leg as it was walked
 * @param {{reason?: string, door?: object, missing?: object[]}} r the result of the leg
 * @returns {object}
 */
export function legCause(bot, leg, r) {
    try {
        const at = feetOf(bot);
        if (r?.reason === 'blocked_door' && isPoint(r.door)) {
            return doorCause(bot, r.door, r.door.kind ?? 'trapdoor');
        }
        switch (leg?.kind) {
            case 'door':
                return isPoint(leg) ? doorCause(bot, leg, leg.kind2 ?? 'door') : { kind: 'stuck', at };
            case 'ladder':
                return ladderCause(bot, leg, r?.missing);
            case 'walk':
            case 'stairs':
                return isPoint(leg.to) && at ? { kind: 'no_path', from: at, to: { x: leg.to.x, y: leg.to.y, z: leg.to.z } } : { kind: 'stuck', at };
            default:
                return { kind: 'stuck', at };
        }
    } catch {
        return { kind: 'stuck', at: null };
    }
}

/**
 * Walks a route leg by leg (I3). A walk leg: walkNear to `to` with doors allowed and no digging, 20 s, then
 * a second try with a goal GoalNear of 1. A ladder leg: slideDown or climbUp of the mining pack by where
 * the bot is (above `bottom`: down; else up); a closed trapdoor on top of the column is opened, and a
 * column with a missing ladder is not entered. A door leg: to `from`, open the openable when it is closed,
 * to `to` (a trapdoor above a ladder: the ladder leg steps in). The bot is at a leg's end when its feet
 * are within 1 block of it. `bot.modes.noteProgress('route')` after every leg. Nothing is dug, nothing is
 * closed, nothing is paused. Never throws.
 * @param {object} bot
 * @param {object} ctx { now, log }
 * @param {{name?: string, legs: object[]}} route
 * @param {{reverse?: boolean, clock?: object, deadline?: number, timeoutMs?: number, now?: Function, wait?: Function}} [options]
 *   deadline: a time of the clock; timeoutMs (120000): the whole route
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, leg: number|null, at: {x,y,z}|null, route: string|null,
 *   step: number|null, total: number, cause: object|null}>}
 *   reasons: no_path, blocked_door, interrupted, time, error; `leg` is the index (in the order walked) of the
 *   leg that failed, `step` the same from 1. F22b: `changed` lists { leg, bottom } of the ladder legs (index in
 *   route.legs) whose bottom moved down because ladders were placed under the column; route.legs gets the new
 *   bottom. v0.1.4.11 (I1): on failure `cause` (door, ladder, no_path, stuck, interrupted) and the text of W1
 *   that names it; null on success.
 */
export async function walkRoute(bot, ctx, route, options = {}) {
    const clock = options?.clock ?? clockOf(ctx, options);
    const walked = options?.reverse === true ? reverseRoute(route) : route;
    const legs = Array.isArray(walked?.legs) ? walked.legs : [];
    const total = legs.length;
    // F22b: ladder legs whose bottom moved down (ladders placed under the column), as indexes of route.legs
    const changed = [];
    const name = typeof route?.name === 'string' ? route.name : null;
    const result = (ok, reason, text, leg, cause = null) => ({ ok, reason, text, leg, at: feetOf(bot), changed, route: name,
        step: Number.isInteger(leg) ? leg + 1 : null, total, cause: ok ? null : cause });
    const failed = (i, reason, cause) => result(false, reason, routeFailedText(route, i + 1, total, feetOf(bot), cause), i, cause);
    const stopped = i => result(false, 'interrupted', routeStoppedText(route, i + 1, total), i, { kind: 'interrupted' });
    const late = i => result(false, 'time', routeTimeText(route, i + 1, total, feetOf(bot)), i, { kind: 'stuck', at: feetOf(bot) });
    let i = 0;
    try {
        if (!bot || !botPos(bot)) {
            return { ok: false, reason: 'error', text: TEXTS.noBody, leg: null, at: null, route: name, step: null, total, cause: { kind: 'stuck', at: null } };
        }
        if (total === 0) {
            return result(false, 'no_path', emptyRouteText(route), null, { kind: 'stuck', at: feetOf(bot) });
        }
        const timeoutMs = isFiniteNumber(options?.timeoutMs) ? options.timeoutMs : REPLAY_RULES.timeoutMs;
        const limit = Math.min(clock.now() + timeoutMs, isFiniteNumber(options?.deadline) ? options.deadline : Infinity);
        for (i = 0; i < total; i++) {
            if (bot.interrupt_code) {
                return stopped(i);
            }
            if (clock.now() > limit) {
                return late(i);
            }
            const leg = legs[i];
            const next = legs[i + 1];
            // the ladder under a trapdoor is looked at before the trapdoor is opened over it
            if (trapdoorOverLadder(leg, next) && leg.from?.y > leg.y && !ladderIntact(bot, next, REPLAY_RULES.fallGap)) {
                return failed(i + 1, 'no_path', ladderCause(bot, next, null));
            }
            const bottom = leg?.kind === 'ladder' ? leg.bottom : null;
            const r = await walkLeg(bot, ctx, legs, i, clock, limit);
            if (bottom !== null && leg.bottom !== bottom) {
                // F22b: the leg of the caller gets the new bottom too (a reversed route walks copies)
                const index = options?.reverse === true ? total - 1 - i : i;
                const own = Array.isArray(route?.legs) ? route.legs[index] : null;
                if (own && typeof own === 'object') {
                    own.bottom = leg.bottom;
                }
                changed.push({ leg: index, bottom: leg.bottom });
            }
            if (r.reason === 'interrupted' || bot.interrupt_code) {
                holdOnLadder(bot); // F36: a bot stopped on a ladder holds on
                return stopped(i);
            }
            if (!r.ok) {
                if (clock.now() > limit && r.reason !== 'blocked_door') {
                    return late(i);
                }
                return failed(i, r.reason === 'blocked_door' || r.reason === 'error' ? r.reason : 'no_path', legCause(bot, leg, r));
            }
            noteProgress(bot, 'route');
        }
        return result(true, null, routeDoneText(route, total), null);
    } catch (err) {
        console.warn('Routes pack: walking the route failed:', err?.message ?? err);
        return result(false, 'error', routeErrorText(route, i + 1, total, err), i, { kind: 'stuck', at: feetOf(bot) });
    }
}

/**
 * Walks to a target by a learned route (I4): a route with one end within `range` of the target (a point,
 * or a box such as an area) and the other end within `reach` of the bot. The bot walks with the path
 * search to that end (doors allowed, no digging), then the route; at a point it walks the last blocks to
 * within `near` of it. Without such a route: `{ ok: false, reason: 'no_route', text: '' }`. Never throws.
 * @param {object} bot
 * @param {object} ctx
 * @param {object[]} routes the routes of the dimension of the bot
 * @param {{x,y,z}|{min, max}} target
 * @param {{range?: number, reach?: number, near?: number, clock?: object, deadline?: number, timeoutMs?: number}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, route: string|null}>}
 */
export async function walkByRoute(bot, ctx, routes, target, options = {}) {
    let route = null;
    try {
        const clock = options?.clock ?? clockOf(ctx, options);
        const pos = botPos(bot);
        const pick = pos ? nearestRoute(routes, target, pos, { range: options?.range, reach: options?.reach }) : null;
        if (!pick) {
            return { ok: false, reason: 'no_route', text: '', route: null };
        }
        route = pick.route;
        const ends = routeEnds(route);
        const start = pick.reverse ? ends.to : ends.from;
        logTo(ctx, `I take ${routeLabel(route)}.`);
        if (!nearCell(botPos(bot), start)) {
            const w = await walkToCell(bot, start, clock, REPLAY_RULES.startMs);
            if (w.reason === 'interrupted' || bot.interrupt_code) {
                return { ok: false, reason: 'interrupted', text: stoppedBeforeRouteText(route), route: route.name ?? null, step: null, total: route.legs?.length ?? 0,
                    at: feetOf(bot), cause: { kind: 'interrupted' } };
            }
            if (!w.ok) {
                const from = feetOf(bot);
                return { ok: false, reason: 'no_path', text: noWayToStartText(route, start, from), route: route.name ?? null, step: null,
                    total: route.legs?.length ?? 0, at: from, cause: { kind: 'no_path', from, to: { x: start.x, y: start.y, z: start.z } } };
            }
        }
        const r = await walkRoute(bot, ctx, route, { reverse: pick.reverse, clock, deadline: options?.deadline, timeoutMs: options?.timeoutMs });
        if (r.ok && isPoint(target) && !bot.interrupt_code) {
            const near = isFiniteNumber(options?.near) ? options.near : 1;
            const cell = { x: Math.floor(target.x), y: Math.floor(target.y), z: Math.floor(target.z) };
            if (!isNear(bot, { x: cell.x + 0.5, y: cell.y, z: cell.z + 0.5 }, near + 1)) {
                await walkNear(bot, cell, near, { clock, timeoutMs: 10000, allowDoors: true, allowDig: false });
            }
        }
        return { ...r, route: route.name ?? null };
    } catch (err) {
        console.warn('Routes pack: the walk by a route failed:', err?.message ?? err);
        return { ok: false, reason: 'error', text: `I could not walk ${route ? routeLabel(route) : 'a route'}: ${err?.message ?? err}`, route: route?.name ?? null,
            step: null, total: route?.legs?.length ?? 0, at: null, cause: { kind: 'stuck', at: null } };
    }
}
