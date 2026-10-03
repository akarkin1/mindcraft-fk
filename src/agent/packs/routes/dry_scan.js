// The dry scan of a walk over waypoints (spec v0.1.4.11, I7 and N1; behind routes_by_search): before the first
// step the path search computes the path of every hop, from where the bot stands to the first waypoint and from
// waypoint to waypoint, without moving (bot.pathfinder.getPathFromTo, else getPathTo for the first hop, with the
// movements of the walk). It stops at the first hop without a path and names what blocks it:
//   I find no way from (11, 67, 52) to the trapdoor at (13, 67, 51).
//   I find no way from (9, 41, 42) to the door at (9, 41, 43): it is closed and I cannot open it.
//   I find no way from (403, 41, -2) to the foot of the ladder at (403, 43, -2): the ladder has a gap of 2 at y 42 and I have no ladders.
// A search that runs out of time proves nothing: that hop counts as open, the walk itself finds out. Fix round F1: a
// hop onto a ladder is searched to the cell where the bot stands to climb it (never a cell in the air); a climb is no
// search: it is open when the column holds its ladders for the way (ladderCheck) or the bot carries the missing ones.
// Never throws.
import { Vec3 } from 'vec3';
import { botPos } from '../home/context.js';
import { doorSides } from '../home/door_logic.js';
import { canOpen, doorState } from '../home/doors.js';
import { goals, makeMovements } from '../home/motion.js';
import { isOpenableWaypoint, ladderCheck, ladderHop, ladderStand, planHops, standCell } from './waypoints.js';
import { posText, routeLabel } from './texts.js';

/** The numbers of the dry scan. */
export const DRY_SCAN_RULES = Object.freeze({
    hopMs: 2000,     // the search of one hop at most
    totalMs: 10000,  // F10: the whole scan at most; what is left unsearched counts as open
    radius: 24,      // the search reaches this far beyond the straight way of a hop ...
    radiusPerBlock: 2, // ... plus this much per block of that way
});

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
}

function cell(p) {
    return { x: Math.floor(p.x), y: Math.floor(p.y + 0.01), z: Math.floor(p.z) };
}

function nextTurn() {
    return new Promise(resolve => setImmediate(resolve));
}

/**
 * What a waypoint is called in the text of N1: `the door at (9, 41, 43)` (door, gate, trapdoor), `the top of the
 * ladder at ...`, `the foot of the ladder at ...`, `the room at ...`, `the tunnel at ...`, `the start of the route
 * "mine" at ...`, `the end of the route "mine" at ...`, else the position alone. Pure.
 * @param {object} wp
 * @returns {string}
 */
export function waypointLabel(wp) {
    const at = posText(wp);
    switch (wp?.kind) {
        case 'door':
        case 'gate':
        case 'trapdoor':
            return `the ${wp.kind} at ${at}`;
        case 'ladder_top':
            return `the top of the ladder at ${at}`;
        case 'ladder_foot':
            return `the foot of the ladder at ${at}`;
        case 'room':
            return `the room at ${at}`;
        case 'tunnel':
            return `the tunnel at ${at}`;
        case 'start':
            return `the start of ${routeLabel({ name: wp.name })} at ${at}`;
        case 'end':
            return `the end of ${routeLabel({ name: wp.name })} at ${at}`;
        default:
            return at;
    }
}

/**
 * The text of N1 for a hop without a path: `I find no way from (11, 67, 52) to the trapdoor at (13, 67, 51).`, and
 * with `locked` (a closed openable that canOpen says no to) `I find no way from (9, 41, 42) to the door at (9, 41, 43):
 * it is closed and I cannot open it.` Pure.
 * @param {{x,y,z}} from
 * @param {object} wp the waypoint the hop could not reach (the openable it passes, else its goal)
 * @param {boolean} [locked]
 * @returns {string}
 */
export function noWayText(from, wp, locked = false) {
    const head = `I find no way from ${posText(from)} to ${waypointLabel(wp)}`;
    return locked ? `${head}: it is closed and I cannot open it.` : `${head}.`;
}

/**
 * The text of N1 for a climb whose column misses ladders (fix round F1): `I find no way from (403, 41, -2) to the foot
 * of the ladder at (403, 43, -2): the ladder has a gap of 2 at y 42 and I have no ladders.`; with some ladders, too
 * few: `... and I have only 1 ladder.` Pure.
 * @param {{x,y,z}} from
 * @param {object} wp the ladder waypoint where the climb starts
 * @param {{gap: number, y: number|null, carried: number}} check of ladderCheck
 * @returns {string}
 */
export function noLaddersText(from, wp, check) {
    const carried = Number.isFinite(check?.carried) && check.carried > 0 ? `only ${check.carried} ladder${check.carried === 1 ? '' : 's'}` : 'no ladders';
    const at = Number.isFinite(check?.y) ? ` at y ${Math.floor(check.y)}` : '';
    return `I find no way from ${posText(from)} to ${waypointLabel(wp)}: the ladder has a gap of ${check?.gap ?? 1}${at} and I have ${carried}.`;
}

function blockName(bot, p) {
    try {
        return bot.blockAt(new Vec3(p.x, p.y, p.z))?.name ?? '';
    } catch {
        return '';
    }
}

// True when the block of the cell lets a bot through (air, a torch, a plant ...)
function readFree(bot, p) {
    try {
        const b = bot.blockAt(new Vec3(p.x, p.y, p.z));
        return Boolean(b) && b.boundingBox === 'empty';
    } catch {
        return false;
    }
}

// True when a door, gate or trapdoor stands at the cell and is closed, read from the world; an iron one too
// (doorState knows only those a hand opens).
function isClosed(bot, wp) {
    const state = doorState(bot, wp);
    if (state) {
        return state.open !== true;
    }
    try {
        const b = bot.blockAt(new Vec3(wp.x, wp.y, wp.z));
        if (!b || typeof b.name !== 'string' || !/(_door|_trapdoor|_fence_gate)$/.test(b.name)) {
            return false;
        }
        const props = (typeof b.getProperties === 'function' ? b.getProperties() : b._properties) ?? {};
        return props.open !== true && props.open !== 'true';
    } catch {
        return false;
    }
}

// The status of the search of one hop: 'success', 'noPath', 'timeout' (or 'partial' left over), 'interrupted', or
// null when the bot has no path search to ask.
async function searchHop(bot, movements, start, goal, fromBot, timeout, radius) {
    const pf = bot?.pathfinder;
    if (typeof pf?.getPathFromTo === 'function') {
        // the first hop from the very position of the bot (on a slab its feet are half a block up), the others from the
        // middle of the floor of their waypoint
        const from = fromBot && isPoint(bot.entity?.position) ? new Vec3(bot.entity.position.x, bot.entity.position.y, bot.entity.position.z)
            : new Vec3(start.x + 0.5, start.y, start.z + 0.5);
        const gen = pf.getPathFromTo(movements, from, goal,
            { timeout, searchRadius: radius, optimizePath: false });
        let last = null;
        const end = Date.now() + timeout + 100; // F10: the hop is bounded here too, whatever the search does
        for (;;) {
            if (Date.now() > end) {
                return 'timeout';
            }
            const step = gen.next();
            if (step.done) {
                break;
            }
            last = step.value?.result ?? null;
            if (last?.status !== 'partial') {
                break;
            }
            await nextTurn();
            if (bot.interrupt_code) {
                return 'interrupted';
            }
        }
        return last?.status ?? null;
    }
    if (fromBot && typeof pf?.getPathTo === 'function') {
        const r = await pf.getPathTo(movements, goal, timeout);
        return r?.status ?? null;
    }
    return null;
}

/**
 * The dry scan (I7, N1): the hops of planHops (as walkWaypoints walks them) searched one after the other without
 * moving: the first from where the bot stands, each next from the goal of the hop before. Each hop with GoalNear 1
 * and the movements of the walk (doors allowed, no digging), at most 2 s, within 24 blocks plus 2 per block of the
 * hop. The first hop with no path ends the scan: `to` is the openable it passes (the first), else its goal; the
 * cause is `door` (state closed) when that openable is closed and canOpen of the home pack says no, else `no_path`
 * from `from` to `to`; `text` the text of N1. A hop whose search runs out of time counts as open.
 * @param {object} bot
 * @param {object[]} waypoints of waypointsOf
 * @param {{from?: {x,y,z}, to?: {x,y,z}|{min,max}, timeoutMs?: number}} [options] from: where the bot stands (default
 *   its position); to: the goal, as for walkWaypoints
 * @returns {Promise<{ok: boolean, step: number|null, total: number, from: {x,y,z}|null, to: {x,y,z}|null, cause: object|null,
 *   text: string}>}
 */
export async function dryScan(bot, waypoints, options = {}) {
    const list = (Array.isArray(waypoints) ? waypoints : []).filter(isPoint);
    const open = (total) => ({ ok: true, step: null, total, from: null, to: null, cause: null, text: '' });
    let total = 0;
    try {
        const here = botPos(bot);
        const me = isPoint(options?.from) ? options.from : here;
        // the scan starts where the bot stands (the first hop is searched from its very position)
        const atBot = Boolean(here) && Math.hypot(me.x - here.x, me.y - here.y, me.z - here.z) < 0.5;
        if (!me || !bot?.pathfinder) {
            return open(0);
        }
        const plan = planHops(list, me, options?.to ?? null);
        total = plan.hops.length;
        let movements;
        try {
            movements = makeMovements(bot, { dig: false, doors: true });
        } catch (err) {
            console.warn('Routes pack: no movements for the dry scan:', err?.message ?? err);
            return open(total);
        }
        const timeout = isFiniteNumber(options?.timeoutMs) ? options.timeoutMs : DRY_SCAN_RULES.hopMs;
        const until = Date.now() + (isFiniteNumber(options?.totalMs) ? options.totalMs : DRY_SCAN_RULES.totalMs);
        let start = cell(me);
        for (let k = 0; k < total; k++) {
            if (Date.now() >= until) {
                return open(total); // F10: a scan answers within 10 s
            }
            if (bot.interrupt_code) {
                return { ok: false, step: k + 1, total, from: start, to: null, cause: { kind: 'interrupted' }, text: '' };
            }
            const hop = plan.hops[k];
            const goalWp = list[hop.goal];
            const prevWp = k > 0 ? list[plan.hops[k - 1].goal] : null;
            const climb = ladderHop(list, hop, prevWp, k === 0 && atBot ? cell(me) : null);
            if (climb) {
                // F1: a climb is no search: the column holds its ladders, or the bot carries the missing ones
                const check = ladderCheck(bot, climb.leg, climb.way);
                if (!check.ok) {
                    const named = climb.start ?? goalWp;
                    const to = { x: named.x, y: named.y, z: named.z };
                    const cause = { kind: 'ladder', x: climb.leg.x, z: climb.leg.z, y: check.y, gap: check.gap };
                    return { ok: false, step: k + 1, total, from: { ...start }, to, cause, text: noLaddersText(start, named, check) };
                }
                // the trapdoor over the column: up the climb opens it from the ladder (the openable of the hop after it),
                // down from above before the slide (F6: in both ways, unless the climb starts below it)
                const over = climb.way === 'up' && plan.hops[k + 1] ? plan.hops[k + 1].passes.map(i => list[i]) : [];
                const col = climb.leg;
                if (climb.way === 'up' || start.y > col.top) {
                    for (const y of [col.top + 1, col.top + 2]) {
                        over.push({ x: col.x, y, z: col.z, kind: 'trapdoor' });
                    }
                }
                const locked = over.find(d => isClosed(bot, d) && !canOpen(bot, d) && /_trapdoor$|_door$|_fence_gate$/.test(blockName(bot, d)));
                if (locked) {
                    const to = { x: locked.x, y: locked.y, z: locked.z };
                    return { ok: false, step: k + 1, total, from: { ...start }, to, cause: { kind: 'door', name: locked.kind, ...to, state: 'closed' },
                        text: noWayText(start, locked, true) };
                }
                start = ladderStand(bot, goalWp);
                continue;
            }
            // F1: onto a ladder: the cell where the bot stands to climb it, never a cell in the air
            const target = standCell(bot, goalWp);
            // F10: a closed door, gate or trapdoor of the hop that the bot can open is passable (the walk opens it, F8):
            // the hop is searched from the cell after it (the side of a door or gate away from the start; after a
            // trapdoor nothing is searched)
            const passable = hop.passes.map(i => list[i]).find(d => isClosed(bot, d) && canOpen(bot, d));
            if (passable) {
                const state = doorState(bot, passable);
                const sides = state ? doorSides(state) : null;
                if (!sides) {
                    start = { x: target.x, y: target.y, z: target.z };
                    continue;
                }
                const far = sides.reduce((a, b) => (Math.hypot(b.x - start.x, b.z - start.z) > Math.hypot(a.x - start.x, a.z - start.z) ? b : a));
                // the cell beyond it may be a step lower (the descent of the base)
                start = { x: far.x, y: readFree(bot, far) ? (readFree(bot, { ...far, y: far.y - 1 }) ? far.y - 1 : far.y) : far.y, z: far.z };
            }
            if (start.x === target.x && start.y === target.y && start.z === target.z) {
                continue; // a hop from a cell to the same cell is no hop: the next real hop is searched (and named)
            }
            const length = Math.hypot(target.x - start.x, target.y - start.y, target.z - start.z);
            const radius = Math.ceil(DRY_SCAN_RULES.radius + DRY_SCAN_RULES.radiusPerBlock * length);
            const goal = new goals.GoalNear(target.x, target.y, target.z, 1);
            let status;
            try {
                const left = until - Date.now();
                status = left <= 0 ? null : await searchHop(bot, movements, start, goal, k === 0 && atBot && !passable, Math.min(timeout, left), radius);
            } catch (err) {
                console.warn('Routes pack: the dry scan of a hop failed:', err?.message ?? err);
                status = null;
            }
            if (status === 'interrupted') {
                return { ok: false, step: k + 1, total, from: start, to: null, cause: { kind: 'interrupted' }, text: '' };
            }
            if (status === 'noPath') {
                const named = !passable && hop.passes.length > 0 ? list[hop.passes[0]] : goalWp;
                const to = { x: named.x, y: named.y, z: named.z };
                const locked = isOpenableWaypoint(named) && isClosed(bot, named) && !canOpen(bot, named);
                const cause = locked ? { kind: 'door', name: named.kind, x: to.x, y: to.y, z: to.z, state: 'closed' }
                    : { kind: 'no_path', from: { ...start }, to };
                return { ok: false, step: k + 1, total, from: { ...start }, to, cause, text: noWayText(start, named, locked) };
            }
            start = { x: target.x, y: target.y, z: target.z };
            await nextTurn();
        }
        return open(total);
    } catch (err) {
        console.warn('Routes pack: the dry scan failed:', err?.message ?? err);
        return open(total);
    }
}
