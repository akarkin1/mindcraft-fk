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

/**
 * Q5: more than this many of one kind, or more than this many kinds, is a kit. Since v0.1.4.14 (the owner's play of
 * 2026-11-07) a kit is no refusal: the bot gives what is asked, and more than 3 kinds within a minute with a chest within
 * 16 blocks only adds KIT_HINT to the answer.
 */
export const KIT_RULES = Object.freeze({ maxCount: 8, maxKinds: 3, windowMs: 60000 });

/** Q2: a route to the surface starts within this many blocks of the bot. */
export const SURFACE_ROUTE_RANGE = 8;

/** v0.1.4.14: the hint after a give of more than 3 kinds within a minute, with a chest within 16 blocks, word for word. */
export const KIT_HINT = 'If you want it all, say "put my stuff in the chest".';
/** v0.1.4.14: a chest within this many blocks of the bot makes the hint. */
export const KIT_HINT_RANGE = 16;

/**
 * v0.1.4.14: true when the answer of a give ends with KIT_HINT: more than 3 kinds within a minute (kindsGiven) and a
 * chest within 16 blocks.
 * @param {number} kinds
 * @param {boolean} chestNear
 * @returns {boolean}
 */
export function wantsKitHint(kinds, chestNear) {
    return chestNear === true && isKit(1, kinds);
}

/**
 * v0.1.4.14: the answer of a give that gave nothing, plainly: `I could not give you oak_log: I have none.`
 * @param {string} item
 * @param {string} reason
 * @returns {string}
 */
export function giveFailedText(item, reason) {
    return `I could not give you ${item}: ${reason}.`;
}

function cellWords(p) {
    return `(${Math.floor(p?.x)}, ${Math.floor(p?.y)}, ${Math.floor(p?.z)})`;
}

/**
 * v0.1.4.14: a give the player picked up nothing of, plainly:
 * `I could not give you 8 wheat: MartyByrde2 picked up none; 8 lie on the ground at (6, 64, 1).`
 * @returns {string}
 */
export function givenNoneText(username, count, item, at) {
    return giveFailedText(`${count} ${item}`, `${username} picked up none; ${count} ${count === 1 ? 'lies' : 'lie'} on the ground at ${cellWords(at)}`);
}

/** v0.1.4.14: the containers !collectBlocks may break when the bot placed them and they are empty. */
export const COLLECT_CONTAINERS = Object.freeze(['chest', 'trapped_chest', 'barrel', 'copper_chest', 'exposed_copper_chest',
    'weathered_copper_chest', 'oxidized_copper_chest', 'waxed_copper_chest', 'waxed_exposed_copper_chest', 'waxed_weathered_copper_chest',
    'waxed_oxidized_copper_chest']);

/** v0.1.4.14: true for a container block (COLLECT_CONTAINERS). */
export function isContainerName(name) {
    return typeof name === 'string' && COLLECT_CONTAINERS.includes(name);
}

// `chest` for every kind of chest, `barrel` for a barrel
function containerWord(name) {
    return typeof name === 'string' && name.endsWith('chest') ? 'chest' : 'barrel';
}

/** v0.1.4.14, word for word: a container the bot did not place is never broken. */
export function notMineText(name = 'chest') {
    return `I do not break a ${containerWord(name)} that is not mine.`;
}

/** v0.1.4.14, word for word: `The chest at (x, y, z) holds N things; say "empty the chest" first.` */
export function containerFullText(name, pos, count) {
    const word = containerWord(name);
    return `The ${word} at ${cellWords(pos)} holds ${count} ${count === 1 ? 'thing' : 'things'}; say "empty the ${word}" first.`;
}

/**
 * v0.1.4.14: the answer when every block of the kind nearby is refused by the safety of the path search, naming one:
 * `I do not break the chest at (3, 64, 0): it is on the list of blocks I never break.`
 * @param {string} name
 * @param {{x, y, z}} pos
 * @param {'never'|'liquid'|'unsafe'} why
 * @returns {string}
 */
export function unsafeBlockText(name, pos, why) {
    const reason = why === 'never' ? 'it is on the list of blocks I never break'
        : why === 'liquid' ? 'water or lava would flow in' : 'breaking it is not safe where it stands';
    return `I do not break the ${name} at ${cellWords(pos)}: ${reason}.`;
}

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

// ------------------------------------------------------------------ v0.1.4.14, the play of 2026-11-09 (SPEC 8.3.1, 8.4)

/**
 * P-19 (SPEC 8.3.1): the destructive fallback of goToGoal ("Path not found, but attempting to navigate anyway") runs only
 * for a way of at most `maxWay` blocks; it never digs a block below the bot's start level minus `digBelowStart`, and
 * never one touching water or lava.
 */
export const FALLBACK_RULES = Object.freeze({ maxWay: 32, digBelowStart: 1 });

// Water, lava and the plants that stand in water (a kelp or seagrass cell is water).
const WET = new Set([...LIQUIDS, 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass']);

function cellOf(p) {
    return { x: Math.floor(p.x), y: Math.floor(p.y + 0.01), z: Math.floor(p.z) };
}

/**
 * The cell a goal of the path finder aims at, or null when the goal has no one cell that can be read: GoalBlock,
 * GoalNear, GoalGetToBlock and GoalFollow carry x, y, z; GoalXZ and GoalNearXZ x and z (the y is the feet's);
 * GoalLookAtBlock and GoalPlaceBlock carry pos. A composite or inverted goal has none.
 * @param {object} goal
 * @param {{x, y, z}|null} [feet]
 * @returns {{x: number, y: number, z: number}|null}
 */
export function goalPoint(goal, feet = null) {
    if (goal === null || typeof goal !== 'object') {
        return null;
    }
    const p = isPoint(goal.pos) ? goal.pos : goal;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) {
        return null;
    }
    if (Number.isFinite(p.y)) {
        return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
    }
    return isPoint(feet) ? { x: Math.floor(p.x), y: cellOf(feet).y, z: Math.floor(p.z) } : null;
}

/**
 * P-19: whether the destructive fallback may run: the way from the feet to the goal's cell, as the crow flies, is at most
 * 32 blocks. A goal without a cell is allowed, as before. `blocks` is the way, rounded; `point` the goal's cell.
 * @param {{x, y, z}} feet
 * @param {object} goal
 * @returns {{allowed: boolean, blocks: number|null, point: {x, y, z}|null}}
 */
export function fallbackAllowed(feet, goal) {
    const point = goalPoint(goal, feet);
    if (!point || !isPoint(feet)) {
        return { allowed: true, blocks: null, point };
    }
    const blocks = Math.hypot(point.x + 0.5 - feet.x, point.y - feet.y, point.z + 0.5 - feet.z);
    return { allowed: blocks <= FALLBACK_RULES.maxWay, blocks: Math.round(blocks), point };
}

/**
 * P-19: true when the fallback may dig the block at `pos`: not below the start level minus 1, and none of its 6
 * neighbours is water or lava. read(x, y, z) gives the name of a block, or null for one that is not loaded (rock).
 * @param {(x: number, y: number, z: number) => string|null} read
 * @param {{x, y, z}} pos the block
 * @param {number} startY the y of the bot's feet when the walk began
 * @returns {boolean}
 */
export function mayDigOnFallback(read, pos, startY) {
    if (typeof read !== 'function' || !isPoint(pos)) {
        return false;
    }
    const p = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
    if (Number.isFinite(startY) && p.y < Math.floor(startY + 0.01) - FALLBACK_RULES.digBelowStart) {
        return false;
    }
    for (const [dx, dy, dz] of [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
        let name = null;
        try {
            name = read(p.x + dx, p.y + dy, p.z + dz);
        } catch {
            name = null;
        }
        if (typeof name === 'string' && WET.has(name)) {
            return false;
        }
    }
    return true;
}

/** P-19, word for word: `I found no way to (10, 64, -20) without digging; I stopped at (3, 64, -2), 19 blocks away.` */
export function noWayText(goal, at, blocks) {
    return `I found no way to ${cellWords(goal)} without digging; I stopped at ${cellWords(at)}, ${Math.round(blocks)} blocks away.`;
}

/** P-20, word for word: `I do not break a black_bed that I did not place; type the order yourself if you want it gone.` */
export function notPlacedText(name) {
    return `I do not break a ${name} that I did not place; type the order yourself if you want it gone.`;
}

/** P-20, word for word: `I broke 0 black_bed: the black_bed at (3, 64, 0) did not break.` (the reason without a final period). */
export function brokeNoneText(name, reason) {
    return `I broke 0 ${name}: ${String(reason ?? '').replace(/[\s.]+$/, '')}.`;
}

/** P-20: the reason of brokeNoneText for a block that stood after the dig (the server kept it). */
export function stoodReason(name, pos) {
    return `the ${name} at ${cellWords(pos)} did not break`;
}

/**
 * P-25: the give looks at the line to the player at ground level and `behind` blocks past him; it tries up to `sides`
 * sides of the player and tosses from `tossFrom` block there.
 */
export const GIVE_WATER_RULES = Object.freeze({ behind: 2, sides: 3, tossFrom: 1 });

// The cells the bot stands in freely (air and the low plants); everything else that is not wet is ground.
const FREE = new Set([...EMPTY, 'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'snow', 'dandelion',
    'poppy', 'short_dry_grass', 'tall_dry_grass', 'leaf_litter', 'pink_petals', 'wildflowers']);

function nameAt(read, x, y, z) {
    try {
        const n = read(x, y, z);
        return typeof n === 'string' ? n : null;
    } catch {
        return null;
    }
}

function isWet(read, x, y, z) {
    const n = nameAt(read, x, y, z);
    return n !== null && WET.has(n);
}

// The cells of the line from `from` to `to` (x and z) and `behind` more blocks past `to`, sampled every half block.
function lineCells(from, to, behind) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dz);
    const ux = len < 1e-6 ? 1 : dx / len;
    const uz = len < 1e-6 ? 0 : dz / len;
    const cells = new Map();
    for (let d = 0; d <= len + behind + 1e-6; d += 0.5) {
        const x = Math.floor(from.x + ux * d);
        const z = Math.floor(from.z + uz * d);
        cells.set(`${x},${z}`, { x, z });
    }
    return [...cells.values()];
}

/**
 * P-25: true when water or lava lies on the line from the bot to the player at ground level (the player's feet level and
 * the block below it), or within `behind` blocks past the player on that line (a tossed stack flies past him).
 * @param {(x: number, y: number, z: number) => string|null} read
 * @param {{x, y, z}} from the bot
 * @param {{x, y, z}} to the player
 * @param {number} [behind]
 * @returns {boolean}
 */
export function wetLine(read, from, to, behind = GIVE_WATER_RULES.behind) {
    if (typeof read !== 'function' || !isPoint(from) || !isPoint(to)) {
        return false;
    }
    const y = cellOf(to).y;
    return lineCells(from, to, behind).some((c) => isWet(read, c.x, y, c.z) || isWet(read, c.x, y - 1, c.z));
}

// A cell the bot can stand in: feet and head free, ground below (neither free nor wet nor unknown).
function standable(read, c) {
    const feet = nameAt(read, c.x, c.y, c.z);
    const head = nameAt(read, c.x, c.y + 1, c.z);
    const below = nameAt(read, c.x, c.y - 1, c.z);
    return feet !== null && FREE.has(feet) && head !== null && FREE.has(head) && below !== null && !FREE.has(below) && !WET.has(below);
}

/**
 * P-25: the cells beside the player (the four neighbours of his cell) from which the line to him (where he stands, as the
 * toss flies) and 2 blocks past him is dry and the bot can stand, nearest to the bot first, at most 3; the side the bot
 * stands on is left out.
 * @param {(x: number, y: number, z: number) => string|null} read
 * @param {{x, y, z}} player the player's position
 * @param {{x, y, z}|null} from the bot
 * @returns {{x: number, y: number, z: number}[]}
 */
export function drySides(read, player, from = null) {
    if (typeof read !== 'function' || !isPoint(player)) {
        return [];
    }
    const p = cellOf(player);
    const out = [];
    for (const [dx, dz] of Object.values(WALL_SIDES)) {
        const c = { x: p.x + dx, y: p.y, z: p.z + dz };
        if (isPoint(from) && Math.floor(from.x) === c.x && Math.floor(from.z) === c.z) {
            continue;
        }
        if (!standable(read, c) || wetLine(read, { x: c.x + 0.5, y: c.y, z: c.z + 0.5 }, player)) {
            continue;
        }
        out.push(c);
    }
    const d = (c) => (isPoint(from) ? Math.hypot(c.x + 0.5 - from.x, c.z + 0.5 - from.z) : 0);
    return out.sort((a, b) => d(a) - d(b) || a.x - b.x || a.z - b.z).slice(0, GIVE_WATER_RULES.sides);
}

/** P-25, word for word: `I could not give you 1 black_bed: water all around you; come to dry ground.` */
export function wetGiveText(count, item) {
    return giveFailedText(`${count} ${item}`, 'water all around you; come to dry ground');
}

/** P-26: the drops of a kill are taken for up to 3 s after the death, within 4 blocks of where the mob died. */
export const KILL_DROP_RULES = Object.freeze({ windowMs: 3000, range: 4 });

/**
 * P-29: a walk of more than 200 blocks with 10 food points or fewer is announced first (longWayText) and walked without
 * sprinting. The sprint rule itself (no sprint below 7 food points) is maySprint of the home pack's food_logic.js, which
 * every Movements of the skills and of the home pack reads: one home (packs never import the library).
 */
export const LONG_WAY_RULES = Object.freeze({ blocks: 200, food: 10 });

/** P-29: true for a walk of more than 200 blocks with 10 food points or fewer. */
export function isLongWay(blocks, food) {
    return Number.isFinite(blocks) && blocks > LONG_WAY_RULES.blocks && Number.isFinite(food) && food <= LONG_WAY_RULES.food;
}

/** P-29, word for word: `A long way: 320 blocks with 8 food points; I do not run.` */
export function longWayText(blocks, food) {
    return `A long way: ${Math.round(blocks)} blocks with ${Math.round(food)} food points; I do not run.`;
}

/** P-28: a boat within this many blocks of the bot is boarded. */
export const BOAT_RANGE = 6;

/** P-28: true for the name of a boat or raft entity (oak_boat, oak_chest_boat, bamboo_raft, bamboo_chest_raft). */
export function isBoatName(name) {
    return typeof name === 'string' && (name.endsWith('_boat') || name.endsWith('_raft'));
}

/**
 * P-28: the nearest boat among `entities` within `range` blocks of `from`, or null.
 * @param {object[]} entities the entities of the bot (bot.entities as a list)
 * @param {{x, y, z}} from
 * @param {number} [range]
 * @returns {object|null}
 */
export function nearestBoat(entities, from, range = BOAT_RANGE) {
    if (!Array.isArray(entities) || !isPoint(from)) {
        return null;
    }
    let best = null;
    let bestD = Infinity;
    for (const e of entities) {
        if (!e || !isBoatName(e.name) || !isPoint(e.position)) {
            continue;
        }
        const d = Math.hypot(e.position.x - from.x, e.position.y - from.y, e.position.z - from.z);
        if (d <= range && d < bestD) {
            best = e;
            bestD = d;
        }
    }
    return best;
}
