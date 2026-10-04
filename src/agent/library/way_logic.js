// The way and the safety of the skills (v0.1.4.13, part Q, SPEC 4.6): the shaft rule of goToPosition (Q7), the kit rule
// of giveToPlayer (Q5), the routes to the surface of goToSurface (Q2), and their texts word for word. skills.js exports
// only functions with their docs (the code model reads them), so the rules live here. Pure: no imports.

/** Q7: a target more than this many blocks below the feet is checked for a shaft; within 1 block of the line. */
export const SHAFT_RULES = Object.freeze({ maxDrop: 3, near: 1 });

/** Q5: more than this many of one kind, or more than this many kinds, is a kit. */
export const KIT_RULES = Object.freeze({ maxCount: 8, maxKinds: 3, windowMs: 60000 });

/** Q2: a route to the surface starts within this many blocks of the bot. */
export const SURFACE_ROUTE_RANGE = 8;

/** Q7, word for word. */
export function shaftText(blocks) {
    return `I do not dig a shaft ${blocks} blocks down. Say "dig down" if you mean it, or show me stairs.`;
}

/** Q5, word for word. */
export const KIT_TEXT = 'That is a lot. Say "put my stuff in the chest" and I put it in the nearest chest.';

/** Q2: the text that names the route walked, word for word: `I take the route "basement_to_surface".` */
export function routeText(name) {
    return `I take the route "${name}".`;
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

function cell(p) {
    return { x: Math.floor(p.x), y: Math.floor(p.y + 0.01), z: Math.floor(p.z) };
}

/**
 * How many whole blocks the target lies below the feet (0 when it is not below).
 * @param {{x, y, z}} feet
 * @param {{x, y, z}} target
 * @returns {number}
 */
export function dropOf(feet, target) {
    if (!isPoint(feet) || !isPoint(target)) {
        return 0;
    }
    return Math.max(0, cell(feet).y - Math.floor(target.y));
}

/**
 * Q7: true when a walk would dig a shaft: the target lies more than 3 blocks below the feet, and the path found is
 * destructive (a step of it breaks a block) and straight down (every step within 1 block of the vertical line through
 * the feet, in x and in z). A path of stairs, a ladder (nothing broken) or a slope (steps away from the line) is no
 * shaft; neither is an empty path.
 * @param {{x, y, z}} feet the position of the bot
 * @param {{x, y, z}} target
 * @param {{x, y, z, toBreak?: object[]}[]} path the steps of the path search
 * @returns {boolean}
 */
export function isShaftPath(feet, target, path) {
    if (dropOf(feet, target) <= SHAFT_RULES.maxDrop || !Array.isArray(path) || path.length === 0) {
        return false;
    }
    const f = cell(feet);
    const near = (p) => isPoint(p) && Math.abs(Math.floor(p.x) - f.x) <= SHAFT_RULES.near && Math.abs(Math.floor(p.z) - f.z) <= SHAFT_RULES.near;
    const breaks = path.some((p) => Array.isArray(p?.toBreak) && p.toBreak.length > 0);
    return breaks && path.every(near) && path.some((p) => isPoint(p) && Math.floor(p.y) < f.y);
}

/**
 * Q5: true when a give is a kit: `num` more than 8 of one kind, or more than 3 kinds (the kinds given in the last minute
 * and this one).
 * @param {number} num
 * @param {number} [kinds]
 * @returns {boolean}
 */
export function isKit(num, kinds = 1) {
    return (Number.isFinite(num) && num > KIT_RULES.maxCount) || (Number.isFinite(kinds) && kinds > KIT_RULES.maxKinds);
}

/**
 * Q5: the kinds given within the last minute, with this one: the given list `[{ item, at }]` is cut to the window.
 * @param {{item: string, at: number}[]} given
 * @param {string} item
 * @param {number} now
 * @returns {number}
 */
export function kindsGiven(given, item, now) {
    const kinds = new Set([item]);
    for (const g of Array.isArray(given) ? given : []) {
        if (g && typeof g.item === 'string' && Number.isFinite(g.at) && now - g.at < KIT_RULES.windowMs) {
            kinds.add(g.item);
        }
    }
    return kinds.size;
}

/**
 * Q2: the routes that lead to the surface from near the bot, nearest start first: for every route and both ways of it,
 * the end must be at the surface (`atSurface(end)`, the open sky or a building's floor under a roof, never rock) and
 * higher than the feet, and the start within 8 blocks of the feet.
 * @param {{name?: string, from?: object, to?: object, legs?: object[]}[]} routes the routes of the routes pack
 * @param {{x, y, z}} feet
 * @param {(p: {x, y, z}) => boolean} atSurface
 * @returns {{route: object, reverse: boolean, start: object, end: object, d: number}[]}
 */
export function surfaceRoutes(routes, feet, atSurface) {
    const out = [];
    if (!isPoint(feet) || typeof atSurface !== 'function') {
        return out;
    }
    const f = cell(feet);
    for (const route of Array.isArray(routes) ? routes : []) {
        if (!route || !isPoint(route.from) || !isPoint(route.to) || !Array.isArray(route.legs) || route.legs.length === 0) {
            continue;
        }
        for (const reverse of [false, true]) {
            const start = reverse ? route.to : route.from;
            const end = reverse ? route.from : route.to;
            const d = Math.hypot(start.x - f.x, start.y - f.y, start.z - f.z);
            if (d > SURFACE_ROUTE_RANGE || Math.floor(end.y) <= f.y) {
                continue;
            }
            let surface = false;
            try {
                surface = atSurface(end) === true;
            } catch {
                surface = false;
            }
            if (surface) {
                out.push({ route, reverse, start, end, d });
            }
        }
    }
    return out.sort((a, b) => a.d - b.d);
}
