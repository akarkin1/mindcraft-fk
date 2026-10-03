// A route as waypoints, walked by the path search (spec v0.1.4.11, I7 and N; behind the setting
// routes_by_search). The route is a memory of where; the path search finds how: from waypoint to waypoint
// with GoalNear 1 and the movements of the walks of v0.1.4.10 (the patched mineflayer-pathfinder climbs and
// descends ladders and opens doors, gates and trapdoors itself; no digging). The walk joins the route at the
// nearest waypoint and goes toward the end that is nearer to the goal. A door, gate or trapdoor is no goal of
// its own (the end beyond a trapdoor over a ladder is no cell to stand on while it is open): the hop that
// passes it reserves it with the door service first (I8), so the service does not close it in the bot's face.
//
// Pure helpers: waypointsOf, nearestWaypoint, planHops. Executing: walkWaypoints, walkByWaypoints, pickRoute.
// Every executing function never throws.
import { distanceToBox, isBox } from '../home/box_math.js';
import { botPos, clockOf, logTo, noteProgress } from '../home/context.js';
import { closeDoor, doorState, openDoor, releaseDoor, reserveDoor } from '../home/doors.js';
import { goals, gotoGoal, isNear, makeMovements, walkNear } from '../home/motion.js';
import { OPENABLE_KINDS, nearCell, routeEnds, trapdoorOverLadder } from './route_logic.js';
import { footOf, placeLadder } from '../mining/ladder.js';
import { REPLAY_RULES, besideLadder, ladderGap, ladderIntact, ladderLeg, legCause } from './replay.js';
import { readBlock } from './trail.js';
import { TEXTS, emptyRouteText, routeDoneText, routeFailedText, routeLabel, routeStoppedText, routeTimeText } from './texts.js';

/** The numbers of the waypoint walk. */
export const WAYPOINT_RULES = Object.freeze({
    hopMs: 60000,       // one hop of the path search at most
    timeoutMs: 300000,  // the whole walk
    near: 1,            // GoalNear of a hop; the bot is at a waypoint when its feet are within 1 block of it (per axis)
    reserveMs: 20000,   // an openable a hop passes is reserved this long (I8, at most 20 s)
    range: 4,           // a route serves a target when one of its ends is this near to it ...
    reach: 32,          // ... and one of its waypoints this near to the bot
});

/** The kinds of waypoints (I7); `walk` is the end of a walk or stairs leg between the others. */
export const WAYPOINT_KINDS = Object.freeze(['start', 'door', 'gate', 'trapdoor', 'ladder_top', 'ladder_foot', 'room', 'tunnel', 'walk', 'end']);

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
}

function cell(p) {
    return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
}

function sameCell(a, b) {
    return isPoint(a) && isPoint(b) && Math.floor(a.x) === Math.floor(b.x) && Math.floor(a.y) === Math.floor(b.y) && Math.floor(a.z) === Math.floor(b.z);
}

function feetOf(bot) {
    const p = botPos(bot);
    return p ? { x: Math.floor(p.x), y: Math.floor(p.y + 0.01), z: Math.floor(p.z) } : null;
}

// the distance from a position to the middle of the floor of a waypoint cell
function distTo(wp, p) {
    return Math.hypot(wp.x + 0.5 - p.x, wp.y - p.y, wp.z + 0.5 - p.z);
}

function distToTarget(target, wp) {
    if (isBox(target)) {
        return distanceToBox(target, { x: wp.x + 0.5, y: wp.y, z: wp.z + 0.5 });
    }
    return isPoint(target) ? Math.hypot(wp.x - Math.floor(target.x), wp.y - Math.floor(target.y), wp.z - Math.floor(target.z)) : Infinity;
}

/**
 * True for a waypoint of a door, gate or trapdoor: the walk reserves it and passes it, it is no goal.
 * @param {object} wp
 * @returns {boolean}
 */
export function isOpenableWaypoint(wp) {
    return Boolean(wp) && OPENABLE_KINDS.includes(wp.kind);
}

const GENERIC = new Set(['walk']);

/**
 * The waypoints of a route of legs (I7): its start, the ends of every leg, the openable of a door leg (kind door,
 * gate or trapdoor by its kind2), the top and the foot of a ladder leg (the top is its `entry` beside the column
 * when it has one, else the cell above the column; under a trapdoor of the route the highest ladder; the foot is
 * the lowest cell of the column), its end. In the
 * order of the legs; a cell given twice in a row is one waypoint (an openable, a ladder end, the start or the end
 * wins over the end of a walk). A ladder leg gives its top first when the way so far comes from above, else its foot.
 * Every waypoint: { x, y, z, kind, name } (name: the name of the route, null without one), and `leg` (the index of
 * its leg), `block` (the name of the openable) and `column` ({ x, z, top, bottom } of a ladder) where they apply.
 * Pure; [] for a route without legs.
 * @param {{name?: string, from?: object, to?: object, legs: object[]}} route
 * @returns {{x: number, y: number, z: number, kind: string, name: string|null}[]}
 */
export function waypointsOf(route) {
    const legs = Array.isArray(route?.legs) ? route.legs : [];
    if (legs.length === 0) {
        return [];
    }
    const name = typeof route?.name === 'string' && route.name.length > 0 ? route.name : null;
    const out = [];
    const push = (p, kind, extra = {}) => {
        if (!isPoint(p)) {
            return;
        }
        const c = cell(p);
        const same = out[out.length - 1];
        if (same && sameCell(same, c)) {
            // the same cell again: the more telling kind stays (an openable before everything)
            if (!isOpenableWaypoint(same) && (isOpenableWaypoint({ kind }) || GENERIC.has(same.kind))) {
                same.kind = kind;
            }
            for (const [k, value] of Object.entries(extra)) {
                if (same[k] === undefined) {
                    same[k] = value; // a ladder end that is the start keeps its column
                }
            }
            return;
        }
        out.push({ ...c, kind, name, ...extra });
    };
    const ends = routeEnds(route);
    push(ends.from, 'start');
    legs.forEach((leg, i) => {
        switch (leg?.kind) {
            case 'walk':
            case 'stairs':
                push(leg.from, 'walk', { leg: i });
                push(leg.to, 'walk', { leg: i });
                break;
            case 'door':
                if (OPENABLE_KINDS.includes(leg.kind2) && isPoint(leg)) {
                    push(leg.from, 'walk', { leg: i });
                    push(leg, leg.kind2, { leg: i, block: typeof leg.name === 'string' ? leg.name : null });
                    push(leg.to, 'walk', { leg: i });
                }
                break;
            case 'ladder': {
                if (![leg.x, leg.z, leg.top, leg.bottom].every(isFiniteNumber)) {
                    break;
                }
                const column = { x: Math.floor(leg.x), z: Math.floor(leg.z), top: Math.floor(leg.top), bottom: Math.floor(leg.bottom) };
                // under a trapdoor (the door leg before or after it) the top is the highest ladder: the door leg
                // leads through the trapdoor to the entry
                const trap = trapdoorOverLadder(legs[i - 1], leg) || trapdoorOverLadder(legs[i + 1], leg);
                const top = trap ? { x: column.x, y: column.top, z: column.z }
                    : (isPoint(leg.entry) ? cell(leg.entry) : { x: column.x, y: column.top + 1, z: column.z });
                const foot = { x: column.x, y: column.bottom, z: column.z };
                const last = out[out.length - 1];
                const fromAbove = last ? last.y > (column.top + column.bottom) / 2 : true;
                const pair = fromAbove ? [[top, 'ladder_top'], [foot, 'ladder_foot']] : [[foot, 'ladder_foot'], [top, 'ladder_top']];
                // F1: the whole leg goes with its ends, for the climb (ladderLeg of replay.js)
                const ladder = { kind: 'ladder', x: column.x, z: column.z, top: column.top, bottom: column.bottom, face: leg.face ?? 'north' };
                if (isPoint(leg.entry)) {
                    ladder.entry = cell(leg.entry);
                }
                if (isPoint(leg.foot)) {
                    ladder.foot = cell(leg.foot);
                }
                for (const [p, kind] of pair) {
                    push(p, kind, { leg: i, column, ladder });
                }
                break;
            }
            default:
                break;
        }
    });
    if (isPoint(ends.to)) {
        const last = out[out.length - 1];
        if (last && sameCell(last, ends.to)) {
            if (GENERIC.has(last.kind)) {
                last.kind = 'end';
            }
        } else {
            push(ends.to, 'end');
        }
    }
    return out;
}

/**
 * The index of the waypoint nearest to a position (the middle of the floor of its cell), -1 without waypoints.
 * Of equals the first. Pure.
 * @param {object[]} waypoints
 * @param {{x,y,z}} pos
 * @returns {number}
 */
export function nearestWaypoint(waypoints, pos) {
    const list = Array.isArray(waypoints) ? waypoints : [];
    if (!isPoint(pos)) {
        return list.length > 0 ? 0 : -1;
    }
    let best = -1;
    let bestD = Infinity;
    list.forEach((wp, i) => {
        if (!isPoint(wp)) {
            return;
        }
        const d = distTo(wp, pos);
        if (d < bestD) {
            best = i;
            bestD = d;
        }
    });
    return best;
}

/**
 * The hops of a walk over waypoints (I7), pure: from the nearest waypoint to the bot to the waypoint nearest to the
 * goal `to` (a point or a box; F10: never a hop beyond it; without a goal, the last waypoint), in that direction. A bot
 * that is already past the nearest waypoint toward the next one (nearer to the next than the nearest is) starts at
 * the next one: a bot half way down a ladder does not climb back to its top first. Each hop is { index, goal,
 * passes }: goal the index of the waypoint walked to, passes the openable waypoints between it and the hop before
 * (none of them is a goal). `forward` is true when the walk follows the order of the waypoints.
 * @param {object[]} waypoints
 * @param {{x,y,z}|null} from where the bot stands
 * @param {{x,y,z}|{min, max}|null} [to] the goal
 * @returns {{forward: boolean, start: number, hops: {goal: number, passes: number[]}[]}}
 */
export function planHops(waypoints, from, to = null) {
    const list = (Array.isArray(waypoints) ? waypoints : []).filter(isPoint);
    const n = list.length;
    if (n === 0) {
        return { forward: true, start: -1, hops: [] };
    }
    let start = nearestWaypoint(list, from);
    // F10 of the fix round: the walk ends at the waypoint nearest to the goal (of equals the one nearest to the start
    // in the list), never beyond it; without a goal at the last waypoint
    let goal = n - 1;
    if (isPoint(to) || isBox(to)) {
        let best = Infinity;
        list.forEach((wp, i) => {
            const d = distToTarget(to, wp);
            if (d < best - 1e-9 || (Math.abs(d - best) <= 1e-9 && Math.abs(i - start) < Math.abs(goal - start))) {
                best = d;
                goal = i;
            }
        });
    }
    const forward = goal >= start;
    const step = forward ? 1 : -1;
    const last = goal;
    const next = start + step;
    if (isPoint(from) && start !== last && next >= 0 && next < n
        && distTo(list[next], from) <= Math.hypot(list[next].x - list[start].x, list[next].y - list[start].y, list[next].z - list[start].z)) {
        start = next;
    }
    const hops = [];
    let passes = [];
    for (let i = start; forward ? i <= last : i >= last; i += step) {
        if (isOpenableWaypoint(list[i])) {
            passes.push(i);
            continue;
        }
        hops.push({ goal: i, passes });
        passes = [];
    }
    if (passes.length > 0) {
        // the route ends at an openable: its cell is the goal of the last hop
        hops.push({ goal: passes[passes.length - 1], passes: passes.slice(0, -1) });
    }
    return { forward, start, hops };
}

// ---- F1 of the fix round: a ladder is climbed with the ladder leg of replay.js, not with the path search ----

/**
 * The climb of a hop (fix round F1): the hop goes from one end of a column of ladders to its other end (the goal of
 * the hop before, or the bot itself standing in the column at the first hop, is of the same column). Then the hop is
 * the ladder leg of replay.js (enterColumn, the missing ladders placed under the column, climbUp, slideDown, the
 * trapdoor), never the path search. `way` is up when the goal is the upper end. null for any other hop. Pure.
 * @param {object[]} list the waypoints
 * @param {{goal: number}} hop
 * @param {object|null} prev the goal of the hop before
 * @param {{x,y,z}|null} feet the feet cell of the bot, for the first hop
 * @returns {{leg: object, way: 'up'|'down', start: object|null}|null} start: the waypoint where the climb starts
 */
export function ladderHop(list, hop, prev, feet = null) {
    const goal = list?.[hop?.goal];
    if (!goal?.ladder || !goal.column) {
        return null;
    }
    const col = goal.column;
    const same = c => Boolean(c) && c.x === col.x && c.z === col.z;
    let start = null;
    if (prev) {
        // F13: two columns in one line (a shaft dug under the bottom of another) are two climbs, not one
        if (!same(prev.column) || prev.column.top !== col.top || prev.column.bottom !== col.bottom) {
            return null;
        }
        start = prev;
    } else if (!(isPoint(feet) && same(feet) && feet.y >= col.bottom - 3 && feet.y <= col.top + 1)) {
        return null;
    }
    return { leg: { ...goal.ladder }, way: goal.y > (col.top + col.bottom) / 2 ? 'up' : 'down', start };
}

/**
 * Where the bot stands to go onto a ladder of a waypoint (fix round F1): at the upper end its entry (the cell above
 * the column without one); at the lower end the foot of the leg (footOf of the mining pack: `foot`, the cell beside
 * the bottom, or the floor under a column that ends above it), never a cell in the air. Never throws.
 * @param {object} bot
 * @param {object} wp a ladder waypoint
 * @returns {{x: number, y: number, z: number}}
 */
export function ladderStand(bot, wp) {
    const leg = wp.ladder;
    if (wp.y > (leg.top + leg.bottom) / 2) {
        return isPoint(leg.entry) ? cell(leg.entry) : { x: leg.x, y: leg.top + 1, z: leg.z };
    }
    let foot = null;
    try {
        foot = footOf(bot, leg);
    } catch {
        foot = null;
    }
    return isPoint(foot) ? cell(foot) : { x: leg.x, y: leg.bottom, z: leg.z };
}

/**
 * F13 of the fix round: the free cells under the bottom of a column of ladders that end on the top ladder of another
 * column in the same line (a shaft dug from the floor cell under the column: its foot is a hole now). From the bottom
 * down, the lowest last; [] when the cells under the column end on a floor, or more than 3 are free. Never throws.
 * @param {object} bot
 * @param {{x: number, z: number, bottom: number}} leg
 * @returns {{x: number, y: number, z: number}[]}
 */
export function holeUnder(bot, leg) {
    try {
        const cells = [];
        for (let y = leg.bottom - 1; y >= leg.bottom - 3; y--) {
            const b = readBlock(bot, leg.x, y, leg.z);
            if (b?.name === 'ladder') {
                return cells;
            }
            if (!b || b.solid !== false) {
                return [];
            }
            cells.push({ x: leg.x, y, z: leg.z });
        }
        return [];
    } catch {
        return [];
    }
}

// F13: the cells under a column whose foot is a hole over another column get ladders, placed from the floor cell beside
// the hole (the bot carries them); afterwards the column reaches down to the other one and leg.bottom and leg.foot say
// so. { ok, missing } with the cells still missing. Never throws.
async function bridgeHole(bot, leg, clock, limit) {
    const cells = holeUnder(bot, leg);
    if (cells.length === 0) {
        return { ok: true, missing: [] };
    }
    const lowest = cells[cells.length - 1];
    const beside = besideLadder(bot, lowest);
    if (!beside) {
        return { ok: false, missing: cells };
    }
    if (!nearCell(botPos(bot), beside, 0)) {
        let movements;
        try {
            movements = makeMovements(bot, { dig: false, doors: true });
        } catch {
            return { ok: false, missing: cells };
        }
        await gotoGoal(bot, new goals.GoalNear(beside.x, beside.y, beside.z, 0), { movements, timeoutMs: Math.max(1000, Math.min(20000, limit - clock.now())), clock });
    }
    for (const c of cells.slice().reverse()) {
        if (bot.interrupt_code) {
            return { ok: false, missing: cells };
        }
        const placed = await placeLadder(bot, c, leg.face, { clock });
        if (!placed.ok) {
            return { ok: false, missing: cells.filter(m => m.y >= c.y) };
        }
    }
    // one column now, down to the bottom of the shaft under it: a bot that steps in and slides a little still climbs
    let bottom = lowest.y;
    while (bottom > lowest.y - 400 && readBlock(bot, leg.x, bottom - 1, leg.z)?.name === 'ladder') {
        bottom--;
    }
    leg.bottom = bottom;
    leg.foot = beside;
    return { ok: true, missing: [] };
}

/**
 * The cell a hop of the path search aims at for a waypoint (fix rounds F1 and F7): for a ladder waypoint the cell
 * where the bot stands to climb it (ladderStand); for a waypoint in the open top of a column of ladders (no floor:
 * its cell is free and a ladder is under it, as the cell of the room floor a shaft was dug from) the free cell beside
 * it with ground, nearest to the bot (besideLadder of replay.js), so that no walk ends in the hole and falls down the
 * shaft; else the waypoint. Never throws.
 * @param {object} bot
 * @param {object} wp
 * @returns {{x: number, y: number, z: number}}
 */
export function standCell(bot, wp) {
    const cell = wp?.ladder ? ladderStand(bot, wp) : { x: wp.x, y: wp.y, z: wp.z };
    try {
        // F7, F13: a cell in the open top of a column (also the foot of a ladder whose floor was dug away)
        const here = readBlock(bot, cell.x, cell.y, cell.z);
        const under = readBlock(bot, cell.x, cell.y - 1, cell.z);
        if (here && here.name !== 'ladder' && here.solid === false && under?.name === 'ladder') {
            const beside = besideLadder(bot, cell);
            if (beside) {
                return beside;
            }
        }
    } catch {
        // the cell as it is
    }
    return cell;
}

/**
 * Whether a climb can be done (fix round F1, the dry scan): down, the column holds its ladders with at most
 * REPLAY_RULES.fallGap missing in a row (ladderIntact); up, every ladder of the column and, under a column that ends
 * 2 or more blocks above the floor, the cells between the floor and its lowest ladder, which enterColumn fills with
 * ladders. A gap is open when the bot carries as many ladders. `gap` and `y` (the lowest missing cell) describe what
 * is missing, `carried` the ladders in the inventory. Never throws.
 * @param {object} bot
 * @param {object} leg the ladder leg
 * @param {'up'|'down'} way
 * @returns {{ok: boolean, gap: number, y: number|null, carried: number}}
 */
export function ladderCheck(bot, leg, way) {
    let carried = 0;
    try {
        carried = (bot.inventory?.items?.() ?? []).filter(i => i?.name === 'ladder').reduce((n, i) => n + (i.count ?? 0), 0);
    } catch {
        carried = 0;
    }
    try {
        if (way === 'down') {
            if (ladderIntact(bot, leg, REPLAY_RULES.fallGap)) {
                return { ok: true, gap: 0, y: null, carried };
            }
            const g = ladderGap(bot, leg) ?? { y: leg.bottom + 1, gap: 1 };
            return { ok: carried >= g.gap, gap: g.gap, y: g.y, carried };
        }
        let gap = 0;
        let y = null;
        const inside = ladderIntact(bot, leg, 0) ? null : ladderGap(bot, leg);
        if (inside) {
            gap += inside.gap;
            y = inside.y;
        }
        const hole = holeUnder(bot, leg);
        const foot = hole.length > 0 ? null : footOf(bot, leg);
        if (hole.length > 0) {
            // F13: the foot is the hole of a shaft dug under the column: its cells get ladders (bridgeHole)
            gap += hole.length;
            y = hole[hole.length - 1].y;
        } else if (isPoint(foot) && foot.x === leg.x && foot.z === leg.z && foot.y < leg.bottom) {
            let lowest = leg.bottom;
            const isLadder = yy => {
                try {
                    return readBlock(bot, leg.x, yy, leg.z)?.name === 'ladder';
                } catch {
                    return false;
                }
            };
            while (lowest - 1 > foot.y && isLadder(lowest - 1)) {
                lowest--;
            }
            if (lowest - foot.y >= 2) {
                gap += lowest - foot.y - 1;
                y = foot.y + 1;
            }
        }
        return { ok: gap === 0 || carried >= gap, gap, y, carried };
    } catch {
        return { ok: true, gap: 0, y: null, carried };
    }
}

// F8: opens the closed doors and gates of a list that a hand reaches from where the bot stands (4.5 blocks from the
// eyes). True when one of them was opened, or none was closed. Never throws.
async function openInReach(bot, ctx, doors, clock) {
    let ok = true;
    for (const door of doors) {
        try {
            const state = doorState(bot, door);
            if (!state || state.open === true) {
                continue;
            }
            const p = botPos(bot);
            const eye = p ? Math.hypot(state.x + 0.5 - p.x, state.y + 0.5 - (p.y + 1.62), state.z + 0.5 - p.z) : Infinity;
            if (eye > REPLAY_RULES.reach) {
                ok = false;
                continue;
            }
            ok = (await openDoor(bot, state, { ctx, now: clock.now, wait: clock.wait })) || false;
        } catch {
            ok = false;
        }
    }
    return ok;
}

// I8: reserves an openable with ctx.doors.reserve, else with the running door service of the bot
function reserve(bot, ctx, door, ms) {
    try {
        if (typeof ctx?.doors?.reserve === 'function') {
            return ctx.doors.reserve(door, ms) !== false;
        }
    } catch {
        // the service of the bot below
    }
    return reserveDoor(bot, door, ms);
}

// F12: `passed` tells the service that the walk went through the openable, so that it closes it by its rules. The
// service of the bot hears it also when ctx.doors.release passes no options on.
function release(bot, ctx, door, passed = false) {
    const options = passed ? { passed: true } : {};
    try {
        if (typeof ctx?.doors?.release === 'function') {
            ctx.doors.release(door, options);
            if (!passed) {
                return;
            }
        }
    } catch {
        // the service of the bot below
    }
    releaseDoor(bot, door, options);
}

// True when the feet of the bot are in the cell of an openable (a door: its two blocks; a trapdoor: its column).
function inOpenableCell(bot, door) {
    const p = botPos(bot);
    if (!p || Math.floor(p.x) !== door.x || Math.floor(p.z) !== door.z) {
        return false;
    }
    const y = Math.floor(p.y + 0.01);
    return y >= door.y - (door.kind === 'trapdoor' ? 3 : 1) && y <= door.y + 1;
}

// F12 of the fix round: right after a hop through openables, each one that is open is closed by the walk when the bot
// is through (out of its cell, not in the column under a trapdoor) and a hand reaches it,
// with the other half of a double door; one out of reach is left to the door service. Never throws.
async function closeBehind(bot, ctx, doors, clock) {
    for (const door of doors) {
        try {
            const halves = [door, ...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ x: door.x + dx, y: door.y, z: door.z + dz }))];
            for (const cell of halves) {
                const state = doorState(bot, cell);
                if (!state || state.open !== true || (cell !== door && state.kind !== 'door')) {
                    continue;
                }
                const p = botPos(bot);
                if (!p) {
                    return;
                }
                const inCell = Math.floor(p.x) === state.x && Math.floor(p.z) === state.z
                    && Math.floor(p.y + 0.01) >= state.y - (state.kind === 'trapdoor' ? 3 : 1) && Math.floor(p.y + 0.01) <= state.y + 1;
                const eye = Math.hypot(state.x + 0.5 - p.x, state.y + 0.5 - (p.y + 1.62), state.z + 0.5 - p.z);
                // the bot is through: out of its cell (of a trapdoor: not in the column under it); a door is closed from
                // the next cell
                if (inCell || eye > REPLAY_RULES.reach || bot.interrupt_code) {
                    continue;
                }
                await closeDoor(bot, state, { ctx, now: clock.now, wait: clock.wait });
            }
        } catch {
            // the door service closes it later
        }
    }
}

// The cause of I1 of a hop that failed: an openable it passes (closed or blocked), the ladder of a hop between
// the two ends of one column (the missing ladders, else stuck), a time that ran out (stuck), else no_path.
function hopCause(bot, list, hop, prev, r, target = null) {
    const at = feetOf(bot);
    const goal = list[hop.goal];
    const to = target ?? goal;
    const door = hop.passes.length > 0 ? list[hop.passes[0]] : (isOpenableWaypoint(goal) ? goal : null);
    if (door) {
        return legCause(bot, { kind: 'door', kind2: door.kind, x: door.x, y: door.y, z: door.z }, {});
    }
    const inColumn = c => Boolean(c) && goal.column.x === c.x && goal.column.z === c.z;
    if (goal.column && (inColumn(prev?.column) || (!prev && inColumn(at)))) {
        return legCause(bot, { kind: 'ladder', ...goal.column }, {});
    }
    if (r?.reason === 'timeout') {
        return { kind: 'stuck', at };
    }
    return at ? { kind: 'no_path', from: at, to: { x: to.x, y: to.y, z: to.z } } : { kind: 'stuck', at: null };
}

/**
 * Walks waypoints with the path search (I7): the hops of planHops from where the bot stands, each with GoalNear
 * 1 and the movements of the walks (doors allowed, no digging), at most 60 s each (and the whole walk at most
 * 5 minutes, or to `deadline`). Before a hop the openables it passes are reserved with the door service (I8:
 * ctx.doors.reserve, else the service of the bot); every reservation ends with the walk. The bot is at a waypoint
 * when its feet are within 1 block of it. `bot.modes.noteProgress('route')` after every hop. Nothing is dug.
 * Fix round F1: a hop onto a ladder goes to the cell where the bot stands to climb it (ladderStand: the entry, or the
 * foot on the floor); a hop from one end of a column to the other is the ladder leg of replay.js (ladderLeg: the
 * missing ladders under the column placed, the climb, the slide, the trapdoor), never the path search.
 * The texts are those of W1 with the hops as steps: `I followed the route "mine", 6 steps.`, `I could not follow
 * the route "mine" at step 2 of 6: the door at (9, 41, 43) is closed and I could not open it.`, stopped, time.
 * @param {object} bot
 * @param {object} ctx { now, log, doors? }
 * @param {object[]} waypoints of waypointsOf
 * @param {{from?: {x,y,z}, to?: {x,y,z}|{min,max}, clock?: object, deadline?: number, timeoutMs?: number, name?: string,
 *   now?: Function, wait?: Function}} [options] from: where the bot stands (default its position); name: the route
 *   for the texts (default the name of the waypoints)
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, step: number|null, total: number, at: {x,y,z}|null,
 *   cause: object|null}>} reasons: no_path, blocked_door, interrupted, time, error
 */
export async function walkWaypoints(bot, ctx, waypoints, options = {}) {
    const clock = options?.clock ?? clockOf(ctx, options);
    const list = (Array.isArray(waypoints) ? waypoints : []).filter(isPoint);
    const name = typeof options?.name === 'string' ? options.name : (list.find(w => typeof w.name === 'string')?.name ?? null);
    const route = { name };
    const reserved = [];
    const passedDoors = []; // F12: the openables the walk went through
    // F12 (W95): an openable the hop went through is released as passed right away, while the door service still sees it
    const releasePassed = (doors) => {
        for (const door of doors) {
            const i = reserved.findIndex(d => sameCell(d, door));
            if (i >= 0) {
                release(bot, ctx, reserved[i], true);
                reserved.splice(i, 1);
            }
        }
    };
    let total = 0;
    let k = 0;
    const result = (ok, reason, text, step, cause) => ({ ok, reason, text, step, total, at: feetOf(bot), cause: ok ? null : cause, route: name });
    try {
        if (!bot || !botPos(bot)) {
            return { ok: false, reason: 'error', text: TEXTS.noBody, step: null, total: 0, at: null, cause: { kind: 'stuck', at: null }, route: name };
        }
        const plan = planHops(list, isPoint(options?.from) ? options.from : botPos(bot), options?.to ?? null);
        total = plan.hops.length;
        if (total === 0) {
            return result(false, 'no_path', emptyRouteText(route), null, { kind: 'stuck', at: feetOf(bot) });
        }
        const timeoutMs = isFiniteNumber(options?.timeoutMs) ? options.timeoutMs : WAYPOINT_RULES.timeoutMs;
        const limit = Math.min(clock.now() + timeoutMs, isFiniteNumber(options?.deadline) ? options.deadline : Infinity);
        const stopped = i => result(false, 'interrupted', routeStoppedText(route, i + 1, total), i + 1, { kind: 'interrupted' });
        const late = i => result(false, 'time', routeTimeText(route, i + 1, total, feetOf(bot)), i + 1, { kind: 'stuck', at: feetOf(bot) });
        for (k = 0; k < total; k++) {
            if (bot.interrupt_code) {
                return stopped(k);
            }
            if (clock.now() > limit) {
                return late(k);
            }
            const hop = plan.hops[k];
            const goal = list[hop.goal];
            const prev = k > 0 ? list[plan.hops[k - 1].goal] : null;
            const climb = ladderHop(list, hop, prev, k === 0 ? feetOf(bot) : null);
            // a climb also reserves the openables of the hop after it (the trapdoor over the column)
            const next = climb && plan.hops[k + 1] ? plan.hops[k + 1].passes : [];
            for (const i of [...hop.passes, ...(isOpenableWaypoint(goal) ? [hop.goal] : []), ...next]) {
                const door = { x: list[i].x, y: list[i].y, z: list[i].z };
                if (reserved.some(d => sameCell(d, door))) {
                    continue; // reserved by the climb before
                }
                if (reserve(bot, ctx, door, WAYPOINT_RULES.reserveMs)) {
                    reserved.push(door);
                }
            }
            if (climb) {
                // F1: from one end of a column of ladders to the other: the ladder leg of replay.js
                await closeBehind(bot, ctx, passedDoors.slice(-4), clock); // F12: before the climb takes the bot out of reach
                if (climb.way === 'up') {
                    // F13: the foot of the column is the hole of a shaft dug under it: ladders into the hole first
                    const bridge = await bridgeHole(bot, climb.leg, clock, limit);
                    if (bot.interrupt_code) {
                        return stopped(k);
                    }
                    if (!bridge.ok) {
                        const lowest = bridge.missing[bridge.missing.length - 1];
                        const cause = lowest ? { kind: 'ladder', x: climb.leg.x, z: climb.leg.z, y: lowest.y, gap: bridge.missing.length }
                            : { kind: 'stuck', at: feetOf(bot) };
                        return result(false, 'no_path', routeFailedText(route, k + 1, total, feetOf(bot), cause), k + 1, cause);
                    }
                }
                const ms = Math.max(1000, Math.min(WAYPOINT_RULES.hopMs, limit - clock.now()));
                const lr = await ladderLeg(bot, ctx, climb.leg, clock, ms, climb.way);
                if (lr.reason === 'interrupted' || bot.interrupt_code) {
                    return stopped(k);
                }
                if (!lr.ok) {
                    if (clock.now() > limit && lr.reason !== 'blocked_door') {
                        return late(k);
                    }
                    const cause = legCause(bot, climb.leg, lr);
                    const reason = cause.kind === 'door' ? 'blocked_door' : 'no_path';
                    return result(false, reason, routeFailedText(route, k + 1, total, feetOf(bot), cause), k + 1, cause);
                }
                passedDoors.push(...hop.passes.map(i => list[i]));
                await closeBehind(bot, ctx, passedDoors.slice(-4), clock);
                releasePassed(hop.passes.map(i => list[i]));
                noteProgress(bot, 'route');
                continue;
            }
            // F1: onto a ladder from where the bot stands to climb it (its entry, or its foot on the floor)
            const target = standCell(bot, goal);
            // F8: the doors and gates the hop passes; the path search opens a closed one only on a level step, never
            // the double door of the room that stands one block above the first step of the descent
            const doors = hop.passes.map(i => list[i]).filter(d => d.kind === 'door' || d.kind === 'gate');
            let r = { ok: true, reason: null };
            for (let attempt = 0; attempt < 2 && !nearCell(botPos(bot), target, WAYPOINT_RULES.near); attempt++) {
                let movements;
                try {
                    movements = makeMovements(bot, { dig: false, doors: true });
                } catch (err) {
                    return result(false, 'error', routeFailedText(route, k + 1, total, feetOf(bot), { kind: 'stuck', at: feetOf(bot) }), k + 1,
                        { kind: 'stuck', at: feetOf(bot) });
                }
                if (attempt === 0) {
                    await openInReach(bot, ctx, doors, clock);
                } else {
                    // the hop failed with a closed door or gate on it: to the door, open it, the hop once more
                    const shut = doors.find(d => doorState(bot, d)?.open === false);
                    if (!shut || clock.now() > limit) {
                        break;
                    }
                    const p = botPos(bot);
                    const eye = p ? Math.hypot(shut.x + 0.5 - p.x, shut.y + 0.5 - (p.y + 1.62), shut.z + 0.5 - p.z) : Infinity;
                    if (eye > REPLAY_RULES.reach) {
                        await gotoGoal(bot, new goals.GoalNear(shut.x, shut.y, shut.z, 2), { movements, timeoutMs: Math.max(1000, Math.min(20000, limit - clock.now())), clock });
                        if (bot.interrupt_code) {
                            return stopped(k);
                        }
                    }
                    if (!(await openInReach(bot, ctx, [shut], clock))) {
                        break;
                    }
                }
                const ms = Math.max(1000, Math.min(WAYPOINT_RULES.hopMs, limit - clock.now()));
                r = await gotoGoal(bot, new goals.GoalNear(target.x, target.y, target.z, WAYPOINT_RULES.near), { movements, timeoutMs: ms, clock });
                if (r.reason === 'interrupted' || bot.interrupt_code) {
                    return stopped(k);
                }
                if (doors.length === 0) {
                    break;
                }
            }
            if (!nearCell(botPos(bot), target, WAYPOINT_RULES.near)) {
                if (clock.now() > limit) {
                    return late(k);
                }
                const cause = hopCause(bot, list, hop, prev, r, target);
                const reason = cause.kind === 'door' ? 'blocked_door' : 'no_path';
                return result(false, reason, routeFailedText(route, k + 1, total, feetOf(bot), cause), k + 1, cause);
            }
            // F12: through the openables of the hop: closed behind the bot
            // F12 (W95): a hop whose goal is the cell beside a door ends with GoalNear 1 in the doorway; out of it first
            const doorway = hop.passes.map(i => list[i]).find(d => inOpenableCell(bot, d));
            if (doorway && !(doorway.x === target.x && doorway.z === target.z)) {
                try {
                    await gotoGoal(bot, new goals.GoalNear(target.x, target.y, target.z, 0),
                        { movements: makeMovements(bot, { dig: false, doors: true }), timeoutMs: 5000, clock });
                } catch {
                    // it stays in the doorway: the door service closes the door later
                }
                if (bot.interrupt_code) {
                    return stopped(k);
                }
            }
            passedDoors.push(...hop.passes.map(i => list[i]));
            await closeBehind(bot, ctx, passedDoors.slice(-4), clock); // also one the bot was still in before
            releasePassed(hop.passes.map(i => list[i]));
            noteProgress(bot, 'route');
        }
        await closeBehind(bot, ctx, passedDoors, clock); // F12: the last ones, at the end of the walk
        return result(true, null, routeDoneText(route, total), null, null);
    } catch (err) {
        console.warn('Routes pack: walking the waypoints failed:', err?.message ?? err);
        return result(false, 'error', `I could not follow ${routeLabel(route)} at step ${k + 1} of ${total}: ${err?.message ?? err}`, k + 1,
            { kind: 'stuck', at: feetOf(bot) });
    } finally {
        for (const door of reserved) {
            release(bot, ctx, door, passedDoors.some(d => sameCell(d, door)));
        }
    }
}

/**
 * The route to a target by its waypoints (routes_by_search): one end within `range` (4) of the target (a point, or
 * a box such as an area), and one of its waypoints within `reach` (32) of the bot; the one whose nearest waypoint is
 * nearest to the bot wins. `reverse` is true when the end near the target is the start of the route. Pure.
 * @param {object[]} routes
 * @param {{x,y,z}|{min, max}} target
 * @param {{x,y,z}} pos where the bot stands
 * @param {{range?: number, reach?: number}} [options]
 * @returns {{route: object, reverse: boolean, distance: number, waypoints: object[], end: {x,y,z}}|null}
 */
export function pickRoute(routes, target, pos, options = {}) {
    if (!isPoint(pos) || !(isPoint(target) || isBox(target))) {
        return null;
    }
    const range = isFiniteNumber(options?.range) ? options.range : WAYPOINT_RULES.range;
    const reach = isFiniteNumber(options?.reach) ? options.reach : WAYPOINT_RULES.reach;
    let best = null;
    for (const route of Array.isArray(routes) ? routes : []) {
        if (!route || typeof route !== 'object' || !Array.isArray(route.legs) || route.legs.length === 0) {
            continue;
        }
        const waypoints = waypointsOf(route);
        if (waypoints.length === 0) {
            continue;
        }
        const i = nearestWaypoint(waypoints, pos);
        const distance = i >= 0 ? distTo(waypoints[i], pos) : Infinity;
        if (distance > reach) {
            continue;
        }
        const first = waypoints[0];
        const last = waypoints[waypoints.length - 1];
        for (const [end, reverse] of [[last, false], [first, true]]) {
            if (distToTarget(target, end) <= range && (!best || distance < best.distance)) {
                best = { route, reverse, distance, waypoints, end: { x: end.x, y: end.y, z: end.z } };
            }
        }
    }
    return best;
}

/**
 * Walks to a target by a learned route, by its waypoints (routes_by_search; the walkTo of ctx.routes then): the
 * route of pickRoute, a dry scan of its hops first (scan(bot, waypoints, { from, to }) of dry_scan.js, given by the
 * caller; a hop without a way ends the walk before the first step with the text of N1), then walkWaypoints toward
 * the end near the target; at a point the last blocks to within `near` of it. Without such a route
 * `{ ok: false, reason: 'no_route', text: '' }`. Never throws.
 * @param {object} bot
 * @param {object} ctx
 * @param {object[]} routes the routes of the dimension of the bot
 * @param {{x,y,z}|{min, max}} target
 * @param {{range?: number, reach?: number, near?: number, clock?: object, deadline?: number, timeoutMs?: number,
 *   scan?: Function}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, route: string|null, step?: number|null, total?: number,
 *   at?: object|null, cause?: object|null}>}
 */
export async function walkByWaypoints(bot, ctx, routes, target, options = {}) {
    let route = null;
    try {
        const clock = options?.clock ?? clockOf(ctx, options);
        const pos = botPos(bot);
        const pick = pos ? pickRoute(routes, target, pos, { range: options?.range, reach: options?.reach }) : null;
        if (!pick) {
            return { ok: false, reason: 'no_route', text: '', route: null };
        }
        route = pick.route;
        const name = typeof route.name === 'string' ? route.name : null;
        logTo(ctx, `I take ${routeLabel(route)}.`);
        if (typeof options?.scan === 'function') {
            const scan = await options.scan(bot, pick.waypoints, { from: pos, to: pick.end });
            if (bot.interrupt_code) {
                return { ok: false, reason: 'interrupted', text: routeStoppedText(route, 1, 1), route: name, step: null, total: 0, at: feetOf(bot),
                    cause: { kind: 'interrupted' } };
            }
            if (scan && scan.ok === false) {
                return { ok: false, reason: 'no_path', text: scan.text, route: name, step: scan.step ?? null, total: scan.total ?? 0, at: feetOf(bot),
                    cause: scan.cause ?? null };
            }
        }
        const r = await walkWaypoints(bot, ctx, pick.waypoints, { from: pos, to: pick.end, clock, deadline: options?.deadline,
            timeoutMs: options?.timeoutMs, name: name ?? undefined });
        if (r.ok && isPoint(target) && !bot.interrupt_code) {
            const near = isFiniteNumber(options?.near) ? options.near : 1;
            const c = cell(target);
            if (!isNear(bot, { x: c.x + 0.5, y: c.y, z: c.z + 0.5 }, near + 1)) {
                await walkNear(bot, c, near, { clock, timeoutMs: 10000, allowDoors: true, allowDig: false });
            }
        }
        return { ...r, route: name };
    } catch (err) {
        console.warn('Routes pack: the walk by waypoints failed:', err?.message ?? err);
        return { ok: false, reason: 'error', text: `I could not walk ${route ? routeLabel(route) : 'a route'}: ${err?.message ?? err}`, route: route?.name ?? null,
            step: null, total: 0, at: null, cause: { kind: 'stuck', at: null } };
    }
}
