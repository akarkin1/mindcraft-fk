// The way and the safety of the skills (v0.1.4.13, part Q, SPEC 4.6): the shaft rule of goToPosition (Q7), the kit rule
// of giveToPlayer (Q5), the routes to the surface of goToSurface (Q2), and their texts word for word. skills.js exports
// only functions with their docs (the code model reads them), so the rules live here. Pure: no imports.
//
// The correction of 2026-10-04 (the owner, no switch): down is fine by a safe way, never by a bare shaft. A walk that
// would be a shaft, and !digDown deeper than 3 blocks, dig a shaft with a ladder on every block when the bag holds at
// least the depth + 2 ladders (ladder_shaft.js digs it, shaftStep below decides each block); else they refuse with
// noLaddersText and do not move.

/** Q7: a target more than this many blocks below the feet is checked for a shaft; within 1 block of the line. */
export const SHAFT_RULES = Object.freeze({ maxDrop: 3, near: 1 });

/** Q5: more than this many of one kind, or more than this many kinds, is a kit. */
export const KIT_RULES = Object.freeze({ maxCount: 8, maxKinds: 3, windowMs: 60000 });

/** Q2: a route to the surface starts within this many blocks of the bot. */
export const SURFACE_ROUTE_RANGE = 8;

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

/** The ladder shaft: the ladders the bag must hold for a shaft of `depth` blocks is depth + `spare`. */
export const LADDER_SHAFT_RULES = Object.freeze({ spare: 2, maxFall: 2 });

/** The ladders a shaft of `depth` blocks needs in the bag: one per block and 2 more. */
export function laddersNeeded(depth) {
    return Math.max(0, Math.floor(Number(depth) || 0)) + LADDER_SHAFT_RULES.spare;
}

/** Said before the ladder shaft is dug, word for word: `I dig down 20 blocks with ladders.` */
export function ladderShaftText(blocks) {
    return `I dig down ${blocks} blocks with ladders.`;
}

/** The refusal without enough ladders, word for word. */
export function noLaddersText(blocks, have, need) {
    return `I do not dig a shaft ${blocks} blocks down without ladders: I have ${have} and need ${need}. Bring me ladders or show me stairs.`;
}

/** Why a ladder shaft stopped, in words. */
export const SHAFT_STOP_WORDS = Object.freeze({
    lava: 'lava is next to the shaft',
    water: 'water is next to the shaft',
    drop: 'a drop is below',
    end: 'the world ends below',
    no_wall: 'there is no wall for a ladder',
    blocked: 'I could not break the block below',
    stuck: 'I did not fall into the hole',
    ladder: 'I could not place a ladder',
    protected: 'the place is protected',
    interrupted: 'I was stopped',
});

/** The text of a ladder shaft that stopped: `I stopped the shaft after 7 of 20 blocks at (3, 56, -2): lava is next to the shaft.` */
export function shaftStoppedText(dug, depth, at, reason) {
    const where = isPoint(at) ? ` at (${Math.floor(at.x)}, ${Math.floor(at.y + 0.01)}, ${Math.floor(at.z)})` : '';
    return `I stopped the shaft after ${dug} of ${depth} blocks${where}: ${SHAFT_STOP_WORDS[reason] ?? reason}.`;
}

/** The four sides of a cell, as the wall of a ladder: the direction from the cell to its wall block. */
export const WALL_SIDES = Object.freeze({ north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] });

const LIQUIDS = new Set(['lava', 'water', 'flowing_lava', 'flowing_water', 'bubble_column']);
const EMPTY = new Set(['air', 'cave_air', 'void_air']);

/**
 * The wall of a cell a ladder can hold on: `prefer` when that side is solid, else north, south, west, east; null when
 * no side is a solid block.
 * @param {(x: number, y: number, z: number) => ({name: string, solid: boolean}|null)} read
 * @param {{x, y, z}} c
 * @param {string|null} [prefer]
 * @returns {string|null}
 */
export function ladderWall(read, c, prefer = null) {
    const order = [prefer, ...Object.keys(WALL_SIDES)].filter((w, i, all) => typeof w === 'string' && WALL_SIDES[w] && all.indexOf(w) === i);
    for (const w of order) {
        const [dx, dz] = WALL_SIDES[w];
        let b = null;
        try {
            b = read(c.x + dx, c.y, c.z + dz);
        } catch {
            b = null;
        }
        if (b && b.solid === true) {
            return w;
        }
    }
    return null;
}

/**
 * One step of the ladder shaft, from the feet down (pure): the cell below the feet (`target`) is dug next; when 1 or 2
 * free cells lie below it the bot falls into the lowest, and each of these cells gets a ladder too. `read(x, y, z)` gives
 * `{ name, solid }` (solid: a full block a ladder holds on) or null for a block that is not loaded. The shaft stops at
 * lava or water in the target, below it or beside it, at a drop of more than 2 free blocks below the target (as
 * digDown), at the end of the world, and when a cell of the step has no solid wall for its ladder. The wall is the one
 * of the ladder above when it is solid, else north, south, west, east.
 * @param {(x: number, y: number, z: number) => ({name: string, solid: boolean}|null)} read
 * @param {{x, y, z}} feet the cell of the feet
 * @param {string|null} [wall] the wall of the ladder above
 * @returns {{action: 'dig'|'stop', reason: string|null, target: {x, y, z}|null, dig: boolean,
 *   cells: {x: number, y: number, z: number, wall: string}[]}} cells: from the target down, each with its wall
 */
export function shaftStep(read, feet, wall = null) {
    const stop = (reason) => ({ action: 'stop', reason, target: null, dig: false, cells: [] });
    if (typeof read !== 'function' || !isPoint(feet)) {
        return stop('end');
    }
    const at = (x, y, z) => {
        try {
            const b = read(x, y, z);
            return b && typeof b.name === 'string' ? b : null;
        } catch {
            return null;
        }
    };
    const f = cell(feet);
    const target = { x: f.x, y: f.y - 1, z: f.z };
    const here = at(target.x, target.y, target.z);
    const below = at(target.x, target.y - 1, target.z);
    if (!here || !below) {
        return stop('end');
    }
    const around = (c) => Object.values(WALL_SIDES).map(([dx, dz]) => at(c.x + dx, c.y, c.z + dz));
    for (const b of [here, below, ...around(target)]) {
        if (b && LIQUIDS.has(b.name)) {
            return stop(b.name.includes('lava') ? 'lava' : 'water');
        }
    }
    const cells = [target];
    for (let y = target.y - 1; cells.length <= LADDER_SHAFT_RULES.maxFall + 1; y--) {
        const b = at(target.x, y, target.z);
        if (!b || !(EMPTY.has(b.name) || b.name === 'ladder')) {
            break;
        }
        cells.push({ x: target.x, y, z: target.z });
    }
    if (cells.length - 1 > LADDER_SHAFT_RULES.maxFall) {
        return stop('drop');
    }
    const out = [];
    let prefer = wall;
    for (const c of cells) {
        if (c !== target && around(c).some(b => b && LIQUIDS.has(b.name))) {
            return stop(around(c).some(b => b && b.name.includes('lava')) ? 'lava' : 'water');
        }
        const w = ladderWall(read, c, prefer);
        if (!w) {
            return stop('no_wall');
        }
        out.push({ ...c, wall: w });
        prefer = w;
    }
    return { action: 'dig', reason: null, target, dig: !(EMPTY.has(here.name) || here.name === 'ladder'), cells: out };
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
