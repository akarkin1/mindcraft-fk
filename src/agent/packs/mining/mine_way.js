// The way into and out of a mine along its route (spec v0.1.4.9, B4), and the switches of v0.1.4.9
// that the mining pack reads. With mine_routes the route of a mine of the player (or a route with a
// door) is walked with walkRoute of the routes pack, reached through ctx.routes (I3, I4); the routes
// pack is never imported. Executing: every function returns { ok, reason, text } and never throws.
import { containsPos } from '../home/box_math.js';
import { botPos, clockOf, dimensionOf, listAreas, logTo } from '../home/context.js';
import { walkNear } from '../home/motion.js';
import { blockAt, digClear, isFree, logicName, walkTo } from './dig.js';
import { classify, faceNeighbours, isNaturalBlock, knownCells, legEnd, mineAt, nearestLeg, posKey, tunnelFor, wayBack } from './mine_logic.js';
import { TEXTS, posText, wayBlockedText } from './texts.js';

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
                return { mine, tunnel, player: null };
            }
        }
        return { mine: null, tunnel: null, player: near.find(m => m.source === 'player') ?? null };
    } catch (err) {
        console.warn('Mining pack: could not choose a mine:', errText(err));
        return { mine: null, tunnel: null, player: null };
    }
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
        const { hops, leg } = wayBack(mine, feet);
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
 * @param {object} bot
 * @param {object} ctx
 * @param {object} mine
 * @param {{clock?: object, deadline?: number, now?: Function, wait?: Function}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, text: string}>}
 */
export async function wayOut(bot, ctx, mine, options = {}) {
    const clock = options.clock ?? clockOf(ctx, options);
    try {
        const feet = feetOf(bot);
        if (!feet || !mine) {
            return { ok: false, reason: 'error', text: 'I do not know where I am.' };
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
