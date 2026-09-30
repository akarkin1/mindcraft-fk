// The way into and out of a mine along its route (spec v0.1.4.9, B4), and the switches of v0.1.4.9
// that the mining pack reads. With mine_routes the route of a mine of the player (or a route with a
// door) is walked with walkRoute of the routes pack, reached through ctx.routes (I3, I4); the routes
// pack is never imported. Executing: every function returns { ok, reason, text } and never throws.
import { botPos, clockOf, dimensionOf, logTo } from '../home/context.js';
import { walkNear } from '../home/motion.js';
import { walkTo } from './dig.js';
import { legEnd, mineAt, nearestLeg, tunnelFor } from './mine_logic.js';
import { TEXTS, posText } from './texts.js';

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

/**
 * Walks out of a mine along its route (spec B4): from the room or a tunnel to the end of the way
 * in with the path search, then the legs backwards with ctx.routes.walkRoute (reverse). On the
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
        } else {
            const end = routeEndOf(mine);
            if (end) {
                const w = await walkTo(bot, end, { clock, timeoutMs: 120000, range: 1 });
                if (!w.ok) {
                    return { ok: false, reason: w.reason === 'interrupted' ? 'interrupted' : 'no_path', text: `I could not get to the way out at ${posText(end)}.` };
                }
            }
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
