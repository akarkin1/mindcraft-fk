// The way into and out of a mine along its route (spec v0.1.4.9, B4), and the switches of v0.1.4.9
// that the mining pack reads. With mine_routes the route of a mine of the player (or a route with a
// door) is walked with walkRoute of the routes pack, reached through ctx.routes (I3, I4); the routes
// pack is never imported. Executing: every function returns { ok, reason, text } and never throws.
// v0.1.4.11 (I4, mine_from_inside): a mine of a second level (`parent`) is entered through its parent
// and left through it: wayIn goes into the parent, then down the shaft; wayOut climbs the shaft, then
// takes the parent's way out. chooseMine prefers, in a family of mines, the level that fits the ore.
// v0.1.4.11 (I7, routes_by_search): with the setting on, wayIn, wayOut and walkBack walk waypoints with the
// path search of the routes pack (ctx.routes.walkWaypoints, after ctx.routes.dryScan before the first step):
// the waypoints of the route of the mine and its room; a mine of a second level adds them to its parent's.
// Off, the legs as before.
import { containsPos } from '../home/box_math.js';
import { botPos, clockOf, dimensionOf, listAreas, logTo } from '../home/context.js';
import { walkNear } from '../home/motion.js';
import { blockAt, digClear, isFree, logicName, walkTo } from './dig.js';
import { followDown, followUp } from './ladder.js';
import { classify, faceNeighbours, isNaturalBlock, knownCells, legEnd, mineAt, nearestLeg, posKey, tunnelFor, tunnelsOf, wayBack } from './mine_logic.js';
import { mineId } from './mine_store.js';
import { TEXTS, mineLabel, posText, wayBlockedText } from './texts.js';

/** How far the choice of a mine for mineOre looks (spec B4). */
export const MINE_RANGE = 64;

function feetOf(bot) {
    const p = botPos(bot);
    return p ? { x: Math.floor(p.x), y: Math.floor(p.y + 0.01), z: Math.floor(p.z) } : null;
}

function errText(err) {
    return err?.message ?? String(err);
}

/**
 * True with the setting mine_routes and the routes of the glue on the context (spec B4:
 * `ctx.settings.mine_routes` and `ctx.routes` present). Never throws.
 * @param {object} ctx
 * @returns {boolean}
 */
export function mineRoutesOn(ctx) {
    try {
        return ctx?.settings?.mine_routes === true && Boolean(ctx.routes) && typeof ctx.routes === 'object';
    } catch {
        return false;
    }
}

/**
 * True with the setting mine_from_inside (v0.1.4.11, section 2): a new shaft may start from the room or
 * a tunnel of a known mine. Never throws.
 * @param {object} ctx
 * @returns {boolean}
 */
export function fromInsideOn(ctx) {
    try {
        return ctx?.settings?.mine_from_inside === true;
    } catch {
        return false;
    }
}

/**
 * The mine a mine of a second level was dug from (v0.1.4.11, I4), from the store of the context
 * (MineStore.parentOf); null for a mine without a parent, without a store, or when the parent is gone.
 * Never throws.
 * @param {object} ctx
 * @param {object} mine
 * @returns {object|null}
 */
export function parentMine(ctx, mine) {
    try {
        if (typeof mine?.parent !== 'string' || mine.parent.length === 0) {
            return null;
        }
        const store = ctx?.mines;
        return typeof store?.parentOf === 'function' ? store.parentOf(mine) ?? null : null;
    } catch {
        return null;
    }
}

/**
 * True with the setting routes_by_search (v0.1.4.11, I7) and the waypoint walk of the routes pack on the context
 * (ctx.routes.waypointsOf and ctx.routes.walkWaypoints). Never throws.
 * @param {object} ctx
 * @returns {boolean}
 */
export function bySearchOn(ctx) {
    try {
        return ctx?.settings?.routes_by_search === true && typeof ctx.routes?.waypointsOf === 'function'
            && typeof ctx.routes?.walkWaypoints === 'function';
    } catch {
        return false;
    }
}

function isOpenableKind(kind) {
    return kind === 'door' || kind === 'gate' || kind === 'trapdoor';
}

/**
 * The goal of the way into a mine (F10): its room when it has one (the waypoint of kind room), else the last waypoint.
 * @param {object[]} waypoints of mineWaypoints
 * @param {object} mine
 * @returns {{x: number, y: number, z: number}|null}
 */
function wayInGoal(waypoints, mine) {
    const room = typeof mine?.parent === 'string' && mine.parent.length > 0 ? null : waypoints.find(w => w.kind === 'room');
    const goal = room ?? waypoints[waypoints.length - 1];
    return goal ? { x: goal.x, y: goal.y, z: goal.z } : null;
}

/**
 * The waypoints of the way into a mine (v0.1.4.11, I7), from the surface to its deepest point: the waypoints of
 * its route (ctx.routes.waypointsOf) and the middle of its room (kind room) when it has one; a mine of a second
 * level: those of its parent (and of the parent's parent), then those of its shaft. Every waypoint carries the
 * name of the mine. [] without the routes pack on the context. Never throws.
 * @param {object} ctx
 * @param {object} mine
 * @returns {object[]}
 */
export function mineWaypoints(ctx, mine, depth = 0) {
    try {
        const name = routeName(mine);
        const own = ctx.routes.waypointsOf({ name, legs: Array.isArray(mine?.route) ? mine.route : [] }) ?? [];
        const parent = typeof mine?.parent === 'string' && mine.parent.length > 0 && depth < 4 ? parentMine(ctx, mine) : null;
        // F7: the shaft of a second level was dug from a floor cell of its parent; a waypoint of the parent in that cell
        // (or just above it) is the open top of the shaft now, no place to walk to
        const shaft = (Array.isArray(mine?.route) ? mine.route : []).filter(l => l?.kind === 'ladder' && [l.x, l.z, l.top].every(Number.isFinite));
        const inHole = w => !['door', 'gate', 'trapdoor'].includes(w.kind)
            && shaft.some(l => w.x === Math.floor(l.x) && w.z === Math.floor(l.z) && w.y > l.top && w.y <= l.top + 2);
        const near = (list, p) => list.reduce((best, w, i) => {
            const d = Math.hypot(w.x - p.x, w.y - p.y, w.z - p.z);
            return d < best.d ? { i, d } : best;
        }, { i: -1, d: Infinity }).i;
        let out = [...own];
        if (parent) {
            // F10: the parent's way up to its waypoint nearest to the top of this shaft (a parent's way that goes on past
            // the room, into its tunnel, is not walked), then this shaft
            const above = mineWaypoints(ctx, parent, depth + 1).filter(w => !inHole(w));
            const cut = own.length > 0 ? near(above, own[0]) : above.length - 1;
            out = [...above.slice(0, cut + 1), ...own];
        } else {
            const c = mine?.room?.center;
            if (c && [c.x, c.y, c.z].every(Number.isFinite)) {
                // F10: the room in the order of the way, after the waypoint of the way nearest to it (a way remembered in
                // the tunnel passes the room and goes on)
                const room = { x: Math.floor(c.x), y: Math.floor(c.y), z: Math.floor(c.z) };
                const i = near(out, room);
                const at = out[i];
                if (!at || at.x !== room.x || at.y !== room.y || at.z !== room.z) {
                    out.splice(i + 1, 0, { ...room, kind: 'room', name });
                } else {
                    at.kind = isOpenableKind(at.kind) ? at.kind : 'room';
                }
            }
        }
        return out.map(w => ({ ...w, name }));
    } catch (err) {
        console.warn('Mining pack: no waypoints for the mine:', errText(err));
        return [];
    }
}

// v0.1.4.11 (I7): the dry scan of ctx.routes (when it has one), then the walk of the waypoints toward `to`. A hop
// without a way ends before the first step with the text of N1, reason no_path; a failed walk gives the text of
// its step (W1). Returns { ok, reason, text } plus `scanned` (false when the scan stopped it).
async function searchWalk(bot, ctx, mine, waypoints, to, options) {
    const from = botPos(bot);
    if (typeof ctx.routes.dryScan === 'function') {
        let scan = null;
        try {
            scan = await ctx.routes.dryScan(bot, waypoints, { from, to });
        } catch (err) {
            console.warn('Mining pack: the dry scan failed:', errText(err));
        }
        if (bot.interrupt_code || scan?.cause?.kind === 'interrupted') {
            return { ok: false, reason: 'interrupted', text: `I was stopped before I walked to ${mineLabel(mine)}.`, scanned: false };
        }
        if (scan && scan.ok === false) {
            return { ok: false, reason: 'no_path', text: typeof scan.text === 'string' && scan.text ? scan.text : 'I find no way along the mine.', scanned: false };
        }
    }
    let r;
    try {
        r = await ctx.routes.walkWaypoints(bot, waypoints, { from, to, clock: options.clock, deadline: options.deadline, name: routeName(mine), ctx });
    } catch (err) {
        console.warn('Mining pack: walking the waypoints failed:', errText(err));
        r = { ok: false, reason: 'error', text: `I could not walk the way of the mine: ${errText(err)}` };
    }
    if (!r || typeof r !== 'object') {
        return { ok: false, reason: 'error', text: TEXTS.noRouteWalk, scanned: true };
    }
    return r.ok ? { ok: true, reason: null, text: '', scanned: true } : { ...routeFailed(r), scanned: true };
}

// v0.1.4.11 (I7): wayIn by waypoints. A bot in the room or a tunnel of the mine stays; else the waypoints from the
// nearest one to the deepest (a mine of a second level through its parent).
async function wayInBySearch(bot, ctx, mine, options) {
    const feet = feetOf(bot);
    if (insideOf(mine, feet)) {
        return { ok: true, reason: null, text: '', walked: false };
    }
    const waypoints = mineWaypoints(ctx, mine);
    if (waypoints.length === 0) {
        return null; // the legs as before
    }
    if (!mineAt([mine], feet) && !(parentMine(ctx, mine) && mineAt([parentMine(ctx, mine)], feet))) {
        logTo(ctx, `I go to ${mine.name ? `the mine "${mine.name}"` : 'the mine'} at ${posText(mine.entrance)}.`);
    }
    const r = await searchWalk(bot, ctx, mine, waypoints, wayInGoal(waypoints, mine), options);
    return { ok: r.ok, reason: r.reason, text: r.text, walked: r.ok };
}

// v0.1.4.11 (I7): wayOut by waypoints. From a tunnel back to the way in first (walkBack); then the waypoints from
// the nearest one to the start of the way. A mine of a second level with `toParent`: up its shaft only.
async function wayOutBySearch(bot, ctx, mine, options) {
    const feet = feetOf(bot);
    const child = typeof mine.parent === 'string' && mine.parent.length > 0;
    const family = [mine, ...(child && parentMine(ctx, mine) ? [parentMine(ctx, mine)] : [])];
    if (!child && !mineAt([mine], feet) && feet.y >= (mine.entrance?.y ?? -Infinity) - 1) {
        return { ok: true, reason: null, text: TEXTS.onSurface };
    }
    const own = child && options.toParent === true ? ctx.routes.waypointsOf({ name: routeName(mine), legs: mine.route ?? [] }) ?? [] : null;
    const waypoints = own ? own.map(w => ({ ...w, name: routeName(mine) })) : mineWaypoints(ctx, mine);
    if (waypoints.length === 0) {
        return null; // the legs as before
    }
    const at = family.map(m => mineAt([m], feet)).find(Boolean) ?? null;
    if (at && at.tunnel !== null) {
        const back = await walkBack(bot, ctx, at.mine, { clock: options.clock });
        if (!back.ok) {
            return { ok: false, reason: back.reason, text: back.text };
        }
    }
    const first = waypoints[0];
    const r = await searchWalk(bot, ctx, mine, waypoints, { x: first.x, y: first.y, z: first.z }, options);
    if (!r.ok) {
        return { ok: false, reason: r.reason, text: r.text };
    }
    if (own) {
        const parent = parentMine(ctx, mine);
        const text = `I am back in ${parent ? mineLabel(parent) : 'the mine above'} at ${posText(feetOf(bot) ?? mine.entrance)}.`;
        logTo(ctx, text);
        return { ok: true, reason: null, text };
    }
    const top = child ? (topMine(ctx, mine) ?? mine) : mine;
    const text = `I am on the surface at ${posText(feetOf(bot) ?? top.entrance)}.`;
    logTo(ctx, text);
    return { ok: true, reason: null, text };
}

// The mine at the top of a family (the parent of the parent ...), or null.
function topMine(ctx, mine) {
    let m = mine;
    for (let depth = 0; depth < 4; depth++) {
        const parent = parentMine(ctx, m);
        if (!parent) {
            return m;
        }
        m = parent;
    }
    return m;
}

/**
 * The setting ore_sense_range (spec B7) as a number from 0 to 3; 0 when it is missing. Never throws.
 * @param {object} ctx
 * @returns {number}
 */
export function senseRangeOf(ctx) {
    try {
        const v = ctx?.settings?.ore_sense_range;
        return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(3, Math.floor(v))) : 0;
    } catch {
        return 0;
    }
}

/**
 * True when a leg of the route of the mine is a door, gate or trapdoor.
 * @param {object} mine
 * @returns {boolean}
 */
export function hasDoorLeg(mine) {
    return (Array.isArray(mine?.route) ? mine.route : []).some(leg => leg?.kind === 'door');
}

/**
 * True when the way of the mine is walked with walkRoute (spec B4): a mine of the player, or a route
 * with a door.
 * @param {object} mine
 * @returns {boolean}
 */
export function walksRoute(mine) {
    return mine?.source === 'player' || hasDoorLeg(mine);
}

/**
 * The end of the way in of a mine (the end of its last leg), or null.
 * @param {object} mine
 * @returns {{x: number, y: number, z: number}|null}
 */
export function routeEndOf(mine) {
    const legs = Array.isArray(mine?.route) ? mine.route : [];
    return legs.length > 0 ? legEnd(legs[legs.length - 1]) : null;
}

/**
 * The mine for an ore with mine_routes (spec B4): of the mines within 64 blocks (store.within, by
 * the entrance and every cell of the mine), the nearest one that has a tunnel for the ore
 * (tunnelFor). Without one, `player` is the nearest mine of the player in reach (its tunnels do not
 * fit the ore). Never throws.
 * v0.1.4.11 (I4): of the family of that mine in reach (its parent, its children, their parents and
 * children: the mines dug from inside one another), the one whose tunnel lies nearest to the best level
 * of the ore; of equals the deeper level, so a mine of a second level is preferred.
 * @param {object} store the MineStore
 * @param {{x,y,z}} feet
 * @param {string|null} dimension
 * @param {object} row the row of the ore
 * @returns {{mine: object|null, tunnel: number|null, player: object|null}}
 */
export function chooseMine(store, feet, dimension, row) {
    try {
        const near = typeof store?.within === 'function' ? store.within(feet, dimension ?? undefined, MINE_RANGE) : [];
        for (const mine of near) {
            const tunnel = tunnelFor(mine, row);
            if (tunnel !== null) {
                return bestOfFamily(near, mine, tunnel, row);
            }
        }
        return { mine: null, tunnel: null, player: near.find(m => m.source === 'player') ?? null };
    } catch (err) {
        console.warn('Mining pack: could not choose a mine:', errText(err));
        return { mine: null, tunnel: null, player: null };
    }
}

// The mines of `near` related to `mine` by parent and child (I4), the mine itself first.
function familyOf(near, mine) {
    const family = [mine];
    for (let grew = true; grew && family.length < 16;) {
        grew = false;
        for (const m of near) {
            if (family.includes(m) || m.dimension !== mine.dimension) {
                continue;
            }
            if (family.some(f => m.parent === mineId(f) || f.parent === mineId(m))) {
                family.push(m);
                grew = true;
            }
        }
    }
    return family;
}

// chooseMine in a family of mines (I4): the tunnel nearest to the best level of the ore, of equals the deeper.
function bestOfFamily(near, mine, tunnel, row) {
    let best = { mine, tunnel, player: null };
    const gapOf = (m, t) => Math.abs((tunnelsOf(m)[t]?.level ?? m.level) - row.level);
    let bestGap = gapOf(mine, tunnel);
    for (const m of familyOf(near, mine).slice(1)) {
        const t = tunnelFor(m, row);
        if (t === null) {
            continue;
        }
        const gap = gapOf(m, t);
        const level = tunnelsOf(m)[t]?.level ?? m.level;
        const bestLevel = tunnelsOf(best.mine)[best.tunnel]?.level ?? best.mine.level;
        if (gap < bestGap || (gap === bestGap && level < bestLevel)) {
            best = { mine: m, tunnel: t, player: null };
            bestGap = gap;
        }
    }
    return best;
}

// The name of the route of a mine for the texts of walkRoute.
function routeName(mine) {
    return typeof mine?.name === 'string' && mine.name.length > 0 ? mine.name : 'mine';
}

async function walkRouteVia(bot, ctx, route, options) {
    const fn = ctx?.routes?.walkRoute;
    if (typeof fn !== 'function') {
        return { ok: false, reason: 'no_path', text: TEXTS.noRouteWalk, leg: null, at: null };
    }
    try {
        const r = await fn(bot, route, options);
        return r && typeof r === 'object' ? r : { ok: false, reason: 'error', text: TEXTS.noRouteWalk, leg: null, at: null };
    } catch (err) {
        console.warn('Mining pack: walking the route failed:', errText(err));
        return { ok: false, reason: 'error', text: `I could not walk the way of the mine: ${errText(err)}`, leg: null, at: null };
    }
}

// A failed walkRoute as a result of the mining pack: its text (I3), reason no_path or interrupted.
function routeFailed(r) {
    const reason = r.reason === 'interrupted' ? 'interrupted' : 'no_path';
    return { ok: false, reason, text: typeof r.text === 'string' && r.text.length > 0 ? r.text : 'I could not follow the way of the mine.' };
}

/**
 * Walks into a mine along its route (spec B4): from outside the mine to its entrance with the path
 * search (doors allowed, no digging), then the legs with ctx.routes.walkRoute; on its route the
 * rest of the legs from the nearest one; in the room or a tunnel nothing. The bot ends at the end
 * of the way in. A failed route: the text of walkRoute and reason no_path; nothing is dug.
 * v0.1.4.11 (I4): a mine of a second level: wayIn to its parent, then down its shaft (childIn).
 * v0.1.4.11 (I7): with routes_by_search the waypoints of mineWaypoints from the nearest one, by the path search of
 * the routes pack, after its dry scan (a hop without a way: the text of N1 before the first step, reason no_path).
 * @param {object} bot
 * @param {object} ctx
 * @param {object} mine
 * @param {{clock?: object, deadline?: number, now?: Function, wait?: Function}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, walked: boolean}>}
 */
export async function wayIn(bot, ctx, mine, options = {}) {
    const clock = options.clock ?? clockOf(ctx, options);
    try {
        const feet = feetOf(bot);
        if (!feet || !mine) {
            return { ok: false, reason: 'error', text: 'I do not know where I am.', walked: false };
        }
        if (bySearchOn(ctx)) {
            // v0.1.4.11 (I7): the waypoints with the path search, a dry scan first
            const r = await wayInBySearch(bot, ctx, mine, { ...options, clock });
            if (r) {
                return r;
            }
        }
        if (typeof mine.parent === 'string' && mine.parent.length > 0) {
            return await childIn(bot, ctx, mine, { ...options, clock });
        }
        const here = mineAt([mine], feet);
        if (here && !here.onRoute) {
            return { ok: true, reason: null, text: '', walked: false };
        }
        const legs = Array.isArray(mine.route) ? mine.route : [];
        let from = 0;
        if (here?.onRoute) {
            from = Math.max(0, nearestLeg(legs, feet));
        } else {
            logTo(ctx, `I go to ${mine.name ? `the mine "${mine.name}"` : 'the mine'} at ${posText(mine.entrance)}.`);
            const w = await walkNear(bot, mine.entrance, 1, { clock, timeoutMs: 90000, allowDoors: true, allowDig: false });
            if (!w.ok) {
                return {
                    ok: false, reason: w.reason === 'interrupted' ? 'interrupted' : 'no_path',
                    text: `I could not get to the entrance of ${mine.name ? `the mine "${mine.name}"` : 'the mine'} at ${posText(mine.entrance)}.`, walked: false,
                };
            }
        }
        if (from >= legs.length) {
            return { ok: true, reason: null, text: '', walked: false };
        }
        const r = await walkRouteVia(bot, ctx, { name: routeName(mine), legs: legs.slice(from) }, { clock, deadline: options.deadline });
        return r.ok ? { ok: true, reason: null, text: '', walked: true } : { ...routeFailed(r), walked: false };
    } catch (err) {
        console.warn('Mining pack: the way into the mine failed:', err?.stack ?? err);
        return { ok: false, reason: 'error', text: `I could not walk into the mine: ${errText(err)}`, walked: false };
    }
}

// The bot stands in the room or a tunnel of the mine (not on its way in).
function insideOf(mine, feet) {
    const at = mineAt([mine], feet);
    return Boolean(at) && !at.onRoute;
}

// Into a mine of the bot that is no child, as descendToLevel does it (v0.1.4.7): on its way in the rest
// of the legs from the nearest one, else to the entry of its first leg (the path search, then with
// digging as descendToLevel) and down its legs.
async function downInto(bot, ctx, mine, options) {
    const { clock } = options;
    const feet = feetOf(bot);
    const legs = Array.isArray(mine.route) ? mine.route : [];
    const here = mineAt([mine], feet);
    if (here && !here.onRoute) {
        return { ok: true, reason: null, text: '', walked: false };
    }
    let from = 0;
    if (here?.onRoute) {
        from = Math.max(0, nearestLeg(legs, feet));
    } else if (legs[0]?.entry) {
        logTo(ctx, `I go to the mine at ${posText(mine.entrance)}.`);
        const w = await walkTo(bot, legs[0].entry, { clock, timeoutMs: 90000 });
        if (!w.ok) {
            const areas = listAreas(ctx, dimensionOf(bot));
            const n = await walkNear(bot, legs[0].entry, 0, { clock, timeoutMs: 90000, allowDig: true, areas });
            if (!n.ok) {
                return { ok: false, reason: n.reason === 'interrupted' ? 'interrupted' : 'no_path', text: `I could not get to the mine at ${posText(mine.entrance)}.`, walked: false };
            }
        }
    }
    const down = await followDown(bot, legs.slice(from), { clock, deadline: options.deadline });
    if (!down.ok) {
        return { ok: false, reason: down.reason === 'interrupted' ? 'interrupted' : 'no_path', text: `I could not climb down into the mine at ${posText(mine.entrance)}.`, walked: false };
    }
    return { ok: true, reason: null, text: '', walked: true };
}

// The way into a mine of a second level (I4): into its parent first (the parent's own way: walkRoute for a
// mine of the player with mine_routes, else its legs; a parent with a parent the same way), then down the
// shaft from its top in the parent. A bot in the child stays; a bot on the shaft goes on down from there.
async function childIn(bot, ctx, mine, options) {
    const depth = options.depth ?? 0;
    const feet = feetOf(bot);
    if (insideOf(mine, feet)) {
        return { ok: true, reason: null, text: '', walked: false };
    }
    const legs = Array.isArray(mine.route) ? mine.route : [];
    const onShaft = mineAt([mine], feet)?.onRoute === true;
    const parent = parentMine(ctx, mine);
    if (!onShaft && parent && !insideOf(parent, feet) && depth < 4) {
        const into = typeof parent.parent === 'string' && parent.parent.length > 0
            ? await childIn(bot, ctx, parent, { ...options, depth: depth + 1 })
            : mineRoutesOn(ctx) && walksRoute(parent) ? await wayIn(bot, ctx, parent, options) : await downInto(bot, ctx, parent, options);
        if (!into.ok) {
            return { ...into, walked: false };
        }
    }
    const from = onShaft ? Math.max(0, nearestLeg(legs, feet)) : 0;
    logTo(ctx, `I go down the shaft at ${posText(mine.entrance)}.`);
    const down = await followDown(bot, legs.slice(from), { clock: options.clock, deadline: options.deadline });
    if (!down.ok) {
        return { ok: false, reason: down.reason === 'interrupted' ? 'interrupted' : 'no_path', text: `I could not climb down the shaft at ${posText(mine.entrance)}.`, walked: false };
    }
    return { ok: true, reason: null, text: '', walked: true };
}

// Up the legs of a mine of the bot to its top, as climbToSurface does it (v0.1.4.7): inside a column of
// ladders that one first, else to the end of the legs and up. `ok` when the feet are at the top.
async function upLegs(bot, mine, clock) {
    const feet = feetOf(bot);
    const legs = Array.isArray(mine.route) ? mine.route : [];
    let index = legs.length - 1;
    for (let i = 0; i < legs.length; i++) {
        const leg = legs[i];
        if (leg.kind === 'ladder' && leg.x === feet.x && leg.z === feet.z && feet.y >= leg.bottom && feet.y <= leg.top + 1) {
            index = i;
            break;
        }
    }
    const route = legs.slice(0, index + 1);
    const end = route.length > 0 ? legEnd(route[route.length - 1]) : null;
    const inColumn = index < legs.length - 1 || (legs[index]?.kind === 'ladder' && legs[index].x === feet.x && legs[index].z === feet.z);
    if (!inColumn && end) {
        const w = await walkTo(bot, end, { clock, timeoutMs: 120000 });
        if (!w.ok) {
            return { ok: false, reason: w.reason === 'interrupted' ? 'interrupted' : 'stuck', text: `I could not get to the way up at ${posText(end)}.` };
        }
    }
    const up = await followUp(bot, route, { clock });
    const now = feetOf(bot);
    if (!up.ok || !now || now.y < mine.entrance.y - 1) {
        return { ok: false, reason: up.reason === 'interrupted' ? 'interrupted' : up.reason ?? 'stuck', text: `I could not climb up: I am at ${posText(now ?? feet)}.` };
    }
    return { ok: true, reason: null, text: '' };
}

// The way out of a mine of a second level (I4): up its shaft into the parent; with `toParent` the bot stays
// there (a trip that started in the parent ends where it started), else the parent's way out follows.
async function childOut(bot, ctx, mine, options) {
    const { clock } = options;
    const depth = options.depth ?? 0;
    const feet = feetOf(bot);
    if (feet.y < mine.entrance.y - 1) {
        const up = await upLegs(bot, mine, clock);
        if (!up.ok) {
            return up;
        }
    }
    const parent = parentMine(ctx, mine);
    if (options.toParent === true) {
        const text = `I am back in ${parent ? mineLabel(parent) : 'the mine above'} at ${posText(feetOf(bot) ?? mine.entrance)}.`;
        logTo(ctx, text);
        return { ok: true, reason: null, text };
    }
    if (!parent || depth >= 4) {
        return { ok: false, reason: 'no_mine', text: `I climbed the shaft to ${posText(feetOf(bot) ?? mine.entrance)}. I know no mine above it.` };
    }
    if (typeof parent.parent === 'string' && parent.parent.length > 0) {
        return childOut(bot, ctx, parent, { ...options, depth: depth + 1 });
    }
    if (mineRoutesOn(ctx) && walksRoute(parent)) {
        return wayOut(bot, ctx, parent, { ...options, toParent: false });
    }
    const out = await upLegs(bot, parent, clock);
    if (!out.ok) {
        return out;
    }
    const text = `I am on the surface at ${posText(feetOf(bot) ?? parent.entrance)}.`;
    logTo(ctx, text);
    return { ok: true, reason: null, text };
}

// True when the bot may dig the cell on its way back (fix round F24): a block of the rock, in the
// cells the mine has opened or in an area of type mine, with no lava or water beside it.
function mayDigBack(bot, ctx, ours, mineAreas, p) {
    const name = logicName(blockAt(bot, p));
    if (!isNaturalBlock(name)) {
        return false;
    }
    const c = { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 };
    if (!ours.has(posKey(p)) && !mineAreas.some(a => containsPos(a, c))) {
        return false;
    }
    return !faceNeighbours(p).some(n => {
        const kind = classify(logicName(blockAt(bot, n)));
        return kind === 'lava' || kind === 'water';
    });
}

// The cells between the feet and a hop (feet and head) that are not free, dug when the bot may
// dig them, walking up to each. Returns the cell that blocks, or null when the way is open.
async function digToward(bot, ctx, ours, mineAreas, hop, clock) {
    const feet = feetOf(bot);
    if (!feet) {
        return hop;
    }
    const n = Math.max(Math.abs(hop.x - feet.x), Math.abs(hop.y - feet.y), Math.abs(hop.z - feet.z));
    let last = feet;
    for (let k = 1; k <= n; k++) {
        const t = k / n;
        const c = { x: Math.round(feet.x + (hop.x - feet.x) * t) + 0, y: Math.round(feet.y + (hop.y - feet.y) * t) + 0, z: Math.round(feet.z + (hop.z - feet.z) * t) + 0 };
        for (const p of [{ ...c, y: c.y + 1 }, c]) {
            if (isFree(blockAt(bot, p))) {
                continue;
            }
            if (bot.interrupt_code || !mayDigBack(bot, ctx, ours, mineAreas, p)) {
                return p;
            }
            if (last !== feet) {
                await walkTo(bot, last, { clock, timeoutMs: 8000 });
            }
            const r = await digClear(bot, p, { clock });
            if (!r.ok) {
                return p;
            }
        }
        last = c;
    }
    return null;
}

/**
 * The walk back to the way in of a mine (fix round F24): hop by hop along the cells the bot knows
 * (wayBack: the branch to its junction, the tunnel along its corners to its start, the end of the
 * route; it ends where the hops reach a leg of the route, `leg` of the result), each with walkTo. A hop that fails is tried again after the blocks of the
 * rock between are dug (only in the cells of the mine or an area of type mine, never beside lava or
 * water); a block the bot may not dig is named:
 * `I could not get to the way out at (10, 30, 16): I was blocked at (12, 30, 9).`
 * The bot then stays where it is. `at` is the cell that blocked.
 * v0.1.4.11 (I7): with routes_by_search the hops are walked as waypoints by the path search first; when that fails,
 * the hops from where the bot stands as before.
 * @param {object} bot
 * @param {object} ctx
 * @param {object} mine
 * @param {{clock?: object}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, at: object|null, leg: number}>}
 */
export async function walkBack(bot, ctx, mine, options = {}) {
    const clock = options.clock ?? clockOf(ctx, options);
    const end = routeEndOf(mine);
    try {
        const feet = feetOf(bot);
        if (!feet) {
            return { ok: false, reason: 'error', text: 'I do not know where I am.', at: null, leg: -1 };
        }
        let { hops, leg } = wayBack(mine, feet);
        if (bySearchOn(ctx) && hops.length > 0) {
            // v0.1.4.11 (I7): the hops as waypoints with the path search; where that fails, the hops of the bot's
            // cell as before (with the digging of F24)
            const waypoints = hops.map(h => ({ x: h.x, y: h.y, z: h.z, kind: 'tunnel', name: routeName(mine) }));
            const last = hops[hops.length - 1];
            let r = null;
            try {
                r = await ctx.routes.walkWaypoints(bot, waypoints, { from: botPos(bot), to: last, clock, name: routeName(mine), ctx });
            } catch (err) {
                console.warn('Mining pack: walking back by waypoints failed:', errText(err));
            }
            if (r?.ok) {
                return { ok: true, reason: null, text: '', at: null, leg };
            }
            if (r?.reason === 'interrupted' || bot.interrupt_code) {
                return { ok: false, reason: 'interrupted', text: `I was stopped on my way out of the mine at ${posText(feetOf(bot) ?? feet)}.`, at: null };
            }
            ({ hops, leg } = wayBack(mine, feetOf(bot) ?? feet));
        }
        const ours = knownCells(mine);
        const mineAreas = listAreas(ctx, dimensionOf(bot)).filter(a => a.type === 'mine');
        const blocked = at => ({ ok: false, reason: 'blocked', text: wayBlockedText(end ?? at, at), at });
        for (const hop of hops) {
            if (bot.interrupt_code) {
                return { ok: false, reason: 'interrupted', text: `I was stopped on my way out of the mine at ${posText(feetOf(bot) ?? feet)}.`, at: null };
            }
            const w = await walkTo(bot, hop, { clock, timeoutMs: 30000 });
            if (w.ok) {
                continue;
            }
            if (w.reason === 'interrupted') {
                return { ok: false, reason: 'interrupted', text: `I was stopped on my way out of the mine at ${posText(feetOf(bot) ?? feet)}.`, at: null };
            }
            const stop = await digToward(bot, ctx, ours, mineAreas, hop, clock);
            if (stop) {
                return blocked(stop);
            }
            const again = await walkTo(bot, hop, { clock, timeoutMs: 30000 });
            if (!again.ok) {
                return again.reason === 'interrupted'
                    ? { ok: false, reason: 'interrupted', text: `I was stopped on my way out of the mine at ${posText(feetOf(bot) ?? feet)}.`, at: null }
                    : blocked(hop);
            }
        }
        return { ok: true, reason: null, text: '', at: null, leg };
    } catch (err) {
        console.warn('Mining pack: the walk back in the mine failed:', err?.stack ?? err);
        return { ok: false, reason: 'error', text: `I could not walk out of the mine: ${errText(err)}`, at: null };
    }
}

/**
 * Walks out of a mine along its route (spec B4): from the room or a tunnel to the end of the way
 * in by walkBack (fix round F24: hop by hop along the tunnel and its corners; when it is blocked
 * the bot stays and the text names the cell, and !leaveMine tries the same walk again), then the legs backwards with ctx.routes.walkRoute (reverse). On the
 * route it walks back from the nearest leg. Ends at the entrance.
 * v0.1.4.11 (I4): a mine of a second level: up its shaft, then the parent's way out (childOut); with
 * `options.toParent` the bot stays in the parent at the top of the shaft.
 * v0.1.4.11 (I7): with routes_by_search from a tunnel walkBack first, then the waypoints of mineWaypoints from the
 * nearest one to the start of the way, by the path search after its dry scan (with `toParent` the shaft's only).
 * @param {object} bot
 * @param {object} ctx
 * @param {object} mine
 * @param {{clock?: object, deadline?: number, now?: Function, wait?: Function, toParent?: boolean}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, text: string}>}
 */
export async function wayOut(bot, ctx, mine, options = {}) {
    const clock = options.clock ?? clockOf(ctx, options);
    try {
        const feet = feetOf(bot);
        if (!feet || !mine) {
            return { ok: false, reason: 'error', text: 'I do not know where I am.' };
        }
        if (bySearchOn(ctx)) {
            // v0.1.4.11 (I7): the waypoints with the path search, a dry scan first
            const r = await wayOutBySearch(bot, ctx, mine, { ...options, clock });
            if (r) {
                return r;
            }
        }
        if (typeof mine.parent === 'string' && mine.parent.length > 0) {
            return await childOut(bot, ctx, mine, { ...options, clock });
        }
        const legs = Array.isArray(mine.route) ? mine.route : [];
        const here = mineAt([mine], feet);
        let upTo = legs.length;
        if (here?.onRoute) {
            upTo = Math.max(0, nearestLeg(legs, feet)) + 1;
        } else if (!here && feet.y >= (mine.entrance?.y ?? -Infinity) - 1) {
            return { ok: true, reason: null, text: TEXTS.onSurface };
        } else if (routeEndOf(mine)) {
            // fix round F24: back along the cells the bot knows to the way in, not one long walk of the
            // path search; the route is walked back from the leg the walk reached
            const back = await walkBack(bot, ctx, mine, { clock });
            if (!back.ok) {
                return { ok: false, reason: back.reason, text: back.text };
            }
            upTo = back.leg >= 0 ? back.leg + 1 : legs.length;
        }
        if (upTo > 0) {
            const r = await walkRouteVia(bot, ctx, { name: routeName(mine), legs: legs.slice(0, upTo) }, { clock, deadline: options.deadline, reverse: true });
            if (!r.ok) {
                return routeFailed(r);
            }
        }
        const text = `I am on the surface at ${posText(feetOf(bot) ?? mine.entrance)}.`;
        logTo(ctx, text);
        return { ok: true, reason: null, text };
    } catch (err) {
        console.warn('Mining pack: the way out of the mine failed:', err?.stack ?? err);
        return { ok: false, reason: 'error', text: `I could not walk out of the mine: ${errText(err)}` };
    }
}

/**
 * The mines of the dimension of the bot from ctx.mines, [] without a store. Never throws.
 * @param {object} bot
 * @param {object} ctx
 * @returns {object[]}
 */
export function minesOf(bot, ctx) {
    try {
        const store = ctx?.mines;
        return typeof store?.list === 'function' ? store.list(dimensionOf(bot) ?? undefined) : [];
    } catch {
        return [];
    }
}
