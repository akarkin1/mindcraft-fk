// Natural trees and the order to cut them (spec v0.1.4.7 T1). Pure: the world is read through
// getBlockName(x, y, z), which returns the name of a block or null for a block that is not loaded.
//
// A tree is a trunk with leaves. The trunk is a column of logs of one kind that stands on natural
// ground; logs that touch it (corners included) are its branches. No block of the tree touches a
// built block with a face: that test is what keeps the logs of the owner's house safe when no
// area was saved.
import { isBuiltBlock } from '../../areas/area_scan.js';
import { containsPos, expandBox, isBox } from '../home/box_math.js';

/** Options of findTrees when absent. */
export const TREE_DEFAULTS = Object.freeze({ range: 48, height: 32, max: 8 });
/** A pillar under the bot has at most this many blocks. */
export const MAX_PILLAR = 12;
/** A tree has at least this many leaves within 2 blocks of its highest log. */
export const MIN_LEAVES = 4;
/** Reach of the bot from its eyes to the centre of a block. */
export const DEFAULT_REACH = 4.5;
/** Height of the eyes above the feet. */
export const EYE_HEIGHT = 1.62;
/** Kinds of wood whose trees grow in the game. */
export const WOOD_KINDS = Object.freeze(['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry',
    'pale_oak', 'crimson', 'warped']);

// The ground of the spec, plus the roots a mangrove trunk stands on and the nylium of the fungi
// (their stems and wart blocks are named in the spec, their ground is not).
/** Blocks the lowest log of a trunk may stand on. */
export const GROUND_NAMES = Object.freeze(['dirt', 'grass_block', 'podzol', 'coarse_dirt', 'rooted_dirt', 'mud', 'moss_block',
    'mycelium', 'mangrove_roots', 'muddy_mangrove_roots', 'crimson_nylium', 'warped_nylium']);
const GROUND = new Set(GROUND_NAMES);

// Stems that are no trunks.
const NOT_TRUNK = new Set(['mushroom_stem', 'melon_stem', 'pumpkin_stem', 'attached_melon_stem', 'attached_pumpkin_stem',
    'big_dripleaf_stem']);

// Blocks a player walks through: a place to stand needs them at the feet and the head.
const PASSABLE = new Set(['air', 'cave_air', 'void_air', 'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush',
    'snow', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley',
    'torchflower', 'pink_petals', 'wildflowers', 'leaf_litter', 'bush', 'firefly_bush', 'short_dry_grass', 'tall_dry_grass',
    'brown_mushroom', 'red_mushroom', 'sunflower', 'lilac', 'rose_bush', 'peony', 'vine', 'glow_lichen', 'moss_carpet',
    'pale_moss_carpet', 'pale_hanging_moss', 'mangrove_propagule']);
const PASSABLE_ENDINGS = ['_sapling', '_tulip'];
const NOT_SOLID = new Set(['water', 'lava', 'bubble_column']);

// A cluster of logs larger than this is no tree: the search stops.
const MAX_CLUSTER = 512;
// Branches reach at most this far from the base, sideways.
const SPREAD = 12;
// Blocks around the highest log where leaves are counted.
const LEAF_RADIUS = 2;

const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const AROUND = [];
for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
            if (dx !== 0 || dy !== 0 || dz !== 0) {
                AROUND.push([dx, dy, dz]);
            }
        }
    }
}

function baseName(name) {
    if (typeof name !== 'string' || name === '') {
        return null;
    }
    return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
}

function blockOf(p) {
    return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
}

function posKey(x, y, z) {
    return `${x},${y},${z}`;
}

function dist(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function positiveInt(value, fallback) {
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

function positiveNumber(value, fallback) {
    return isFiniteNumber(value) && value > 0 ? value : fallback;
}

/**
 * True for a block of a trunk: a name that ends with _log or _stem, not stripped, and not the
 * stem of a mushroom, melon, pumpkin or dripleaf.
 * @param {string|null} name
 * @returns {boolean}
 */
export function isTrunkLog(name) {
    const n = baseName(name);
    return n !== null && (n.endsWith('_log') || n.endsWith('_stem')) && !n.startsWith('stripped_') && !NOT_TRUNK.has(n);
}

/**
 * True for wood a player made: stripped logs and stems, and wood and hyphae blocks (bark on all
 * sides). They do not grow in a natural tree.
 * @param {string|null} name
 * @returns {boolean}
 */
export function isWorkedWood(name) {
    const n = baseName(name);
    if (n === null) {
        return false;
    }
    if (n.endsWith('_wood') || n.endsWith('_hyphae')) {
        return true;
    }
    return n.startsWith('stripped_') && (n.endsWith('_log') || n.endsWith('_stem'));
}

/**
 * The kind of wood of a trunk log: `oak` for oak_log, `crimson` for crimson_stem, else null.
 * @param {string|null} name
 * @returns {string|null}
 */
export function woodKind(name) {
    if (!isTrunkLog(name)) {
        return null;
    }
    return baseName(name).replace(/_(log|stem)$/, '');
}

/**
 * True for leaves: names that end with _leaves or _wart_block.
 * @param {string|null} name
 * @returns {boolean}
 */
export function isLeaves(name) {
    const n = baseName(name);
    return n !== null && (n.endsWith('_leaves') || n.endsWith('_wart_block'));
}

/**
 * True for a block the lowest log of a trunk may stand on (GROUND_NAMES).
 * @param {string|null} name
 * @returns {boolean}
 */
export function isGround(name) {
    const n = baseName(name);
    return n !== null && GROUND.has(n);
}

/**
 * The log item of a kind of wood: `oak_log`, `crimson_stem`.
 * @param {string} kind
 * @returns {string}
 */
export function logItemOf(kind) {
    return kind === 'crimson' || kind === 'warped' ? `${kind}_stem` : `${kind}_log`;
}

/**
 * The planks of a kind of wood: `oak_planks`.
 * @param {string} kind
 * @returns {string}
 */
export function planksOf(kind) {
    return `${kind}_planks`;
}

/**
 * What grows a tree of the kind again: `oak_sapling`, `mangrove_propagule`, `crimson_fungus`.
 * null for a kind that is not a tree.
 * @param {string|null} kind
 * @returns {string|null}
 */
export function saplingOf(kind) {
    if (kind === 'mangrove') {
        return 'mangrove_propagule';
    }
    if (kind === 'crimson' || kind === 'warped') {
        return `${kind}_fungus`;
    }
    return WOOD_KINDS.includes(kind) ? `${kind}_sapling` : null;
}

/**
 * The kind of wood a player or the model asks for. Empty, `any`, `wood` or `logs`: any kind
 * (kind null). Names of logs, planks, wood and trees are understood: `oak_log`, `Oak Logs`,
 * `dark oak`, `crimson_stem`. `known` is false for a word that is no kind of wood.
 * @param {*} value
 * @returns {{kind: string|null, known: boolean}}
 */
export function normaliseWoodKind(value) {
    if (value === undefined || value === null) {
        return { kind: null, known: true };
    }
    if (typeof value !== 'string') {
        return { kind: null, known: false };
    }
    let v = value.trim().toLowerCase().replace(/^minecraft:/, '').replace(/[\s-]+/g, '_');
    if (v === '' || v === 'any' || v === 'wood' || v === 'log' || v === 'logs' || v === 'tree' || v === 'trees') {
        return { kind: null, known: true };
    }
    v = v.replace(/_(logs?|stems?|woods?|planks|trees?|hyphae)$/, '');
    return WOOD_KINDS.includes(v) ? { kind: v, known: true } : { kind: null, known: false };
}

function isPassable(name) {
    const n = baseName(name);
    return n !== null && (PASSABLE.has(n) || PASSABLE_ENDINGS.some(e => n.endsWith(e)));
}

function isSolid(name) {
    const n = baseName(name);
    return n !== null && !isPassable(n) && !NOT_SOLID.has(n);
}

// A reader that never throws and reads every block once.
function reader(getBlockName) {
    const cache = new Map();
    return (x, y, z) => {
        const k = posKey(x, y, z);
        if (cache.has(k)) {
            return cache.get(k);
        }
        let name = null;
        try {
            const n = getBlockName(x, y, z);
            name = typeof n === 'string' ? baseName(n) : null;
        } catch {
            name = null;
        }
        cache.set(k, name);
        return name;
    };
}

function normaliseOptions(options) {
    const o = options !== null && typeof options === 'object' ? options : {};
    let exclude = new Set();
    if (o.exclude instanceof Set) {
        exclude = o.exclude;
    } else if (Array.isArray(o.exclude)) {
        exclude = new Set(o.exclude);
    }
    const kind = typeof o.kind === 'string' && o.kind !== '' ? normaliseWoodKind(o.kind).kind : null;
    return {
        range: positiveNumber(o.range, TREE_DEFAULTS.range),
        height: positiveInt(o.height, TREE_DEFAULTS.height),
        max: positiveInt(o.max, TREE_DEFAULTS.max),
        candidates: Array.isArray(o.candidates) ? o.candidates.filter(isPoint).map(blockOf) : null,
        kind,
        exclude,
    };
}

function withinSearch(origin, p, o) {
    return Math.abs(p.y - origin.y) <= o.height && dist(origin, p) <= o.range;
}

// Lowest logs of trunks: a trunk log whose block below is ground.
function collectBases(read, origin, o) {
    const bases = new Map();
    const add = (x, y, z) => {
        const p = { x, y, z };
        if (withinSearch(origin, p, o)) {
            bases.set(posKey(x, y, z), p);
        }
    };
    if (o.candidates) {
        for (const c of o.candidates) {
            const name = read(c.x, c.y, c.z);
            if (!isTrunkLog(name)) {
                continue;
            }
            let y = c.y;
            for (let i = 0; i < o.height && read(c.x, y - 1, c.z) === name; i++) {
                y--;
            }
            if (isGround(read(c.x, y - 1, c.z))) {
                add(c.x, y, c.z);
            }
        }
    } else {
        const r = Math.floor(o.range);
        const dy = Math.min(o.height, r);
        for (let x = origin.x - r; x <= origin.x + r; x++) {
            for (let z = origin.z - r; z <= origin.z + r; z++) {
                if ((x - origin.x) ** 2 + (z - origin.z) ** 2 > o.range * o.range) {
                    continue;
                }
                let below = read(x, origin.y - dy - 1, z);
                for (let y = origin.y - dy; y <= origin.y + dy; y++) {
                    const name = read(x, y, z);
                    if (isTrunkLog(name) && isGround(below)) {
                        add(x, y, z);
                    }
                    below = name;
                }
            }
        }
    }
    return [...bases.values()].sort((a, b) => dist(origin, a) - dist(origin, b) || a.x - b.x || a.y - b.y || a.z - b.z);
}

// All wood (trunk logs and worked wood) connected to the start, corners included.
function growCluster(read, start, height) {
    const seen = new Set([posKey(start.x, start.y, start.z)]);
    const logs = [start];
    const queue = [start];
    let overflow = false;
    while (queue.length > 0) {
        const p = queue.shift();
        for (const [dx, dy, dz] of AROUND) {
            const q = { x: p.x + dx, y: p.y + dy, z: p.z + dz };
            const k = posKey(q.x, q.y, q.z);
            if (seen.has(k)) {
                continue;
            }
            seen.add(k);
            const name = read(q.x, q.y, q.z);
            if (!isTrunkLog(name) && !isWorkedWood(name)) {
                continue;
            }
            if (Math.abs(q.x - start.x) > SPREAD || Math.abs(q.z - start.z) > SPREAD || q.y < start.y - 2
                || q.y > start.y + height + SPREAD || logs.length >= MAX_CLUSTER) {
                overflow = true;
                continue;
            }
            logs.push(q);
            queue.push(q);
        }
    }
    return { logs, overflow };
}

// The trunk: a square of 2 by 2 bases around the start, or the start alone. Other bases may only
// touch the trunk (roots of a thick tree); anything else is a second trunk.
function findTrunk(read, logs, start) {
    const bases = logs.filter(p => isTrunkLog(read(p.x, p.y, p.z)) && isGround(read(p.x, p.y - 1, p.z)));
    const isBase = new Set(bases.map(p => posKey(p.x, p.y, p.z)));
    let footprint = [{ x: start.x, z: start.z }];
    let base = start;
    for (const [ox, oz] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
        const cx = start.x + ox;
        const cz = start.z + oz;
        const square = [[cx, cz], [cx + 1, cz], [cx, cz + 1], [cx + 1, cz + 1]];
        if (square.every(([x, z]) => isBase.has(posKey(x, start.y, z)))) {
            footprint = square.map(([x, z]) => ({ x, z }));
            base = { x: cx, y: start.y, z: cz };
            break;
        }
    }
    const touches = p => Math.abs(p.y - start.y) <= 1 && footprint.some(f => Math.abs(f.x - p.x) <= 1 && Math.abs(f.z - p.z) <= 1);
    const several = bases.some(p => !touches(p));
    return { base, thick: footprint.length === 4, footprint, several };
}

function countLeaves(read, logs) {
    const topY = Math.max(...logs.map(p => p.y));
    const tops = logs.filter(p => p.y === topY);
    const leaves = new Map();
    for (const t of tops) {
        for (let dx = -LEAF_RADIUS; dx <= LEAF_RADIUS; dx++) {
            for (let dy = -LEAF_RADIUS; dy <= LEAF_RADIUS; dy++) {
                for (let dz = -LEAF_RADIUS; dz <= LEAF_RADIUS; dz++) {
                    const q = { x: t.x + dx, y: t.y + dy, z: t.z + dz };
                    if (isLeaves(read(q.x, q.y, q.z))) {
                        leaves.set(posKey(q.x, q.y, q.z), q);
                    }
                }
            }
        }
    }
    const touching = tops.some(t => FACES.some(([dx, dy, dz]) => leaves.has(posKey(t.x + dx, t.y + dy, t.z + dz))));
    return { topY, leaves: [...leaves.values()], touching };
}

// 'unloaded' or 'built' when a block of the tree touches such a block with a face, else null.
function contactProblem(read, blocks) {
    let built = false;
    for (const p of blocks) {
        for (const [dx, dy, dz] of FACES) {
            const name = read(p.x + dx, p.y + dy, p.z + dz);
            if (name === null) {
                return 'unloaded';
            }
            if (isBuiltBlock(name)) {
                built = true;
            }
        }
    }
    return built ? 'built' : null;
}

function findStand(read, footprint, y0, origin) {
    const inFootprint = (x, z) => footprint.some(f => f.x === x && f.z === z);
    const cells = new Map();
    for (const f of footprint) {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const x = f.x + dx;
                const z = f.z + dz;
                if (!inFootprint(x, z)) {
                    cells.set(`${x},${z}`, { x, z });
                }
            }
        }
    }
    let best = null;
    let bestDistance = Infinity;
    for (const c of [...cells.values()].sort((a, b) => a.x - b.x || a.z - b.z)) {
        for (const y of [y0, y0 + 1, y0 - 1]) {
            if (isPassable(read(c.x, y, c.z)) && isPassable(read(c.x, y + 1, c.z)) && isSolid(read(c.x, y - 1, c.z))) {
                const p = { x: c.x, y, z: c.z };
                const d = dist(p, origin);
                if (d < bestDistance) {
                    best = p;
                    bestDistance = d;
                }
                break;
            }
        }
    }
    return best;
}

function sortLogs(logs) {
    return logs.map(p => ({ x: p.x, y: p.y, z: p.z })).sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z);
}

// The verdict on one cluster: a tree, or the reason why not.
function judge(read, cluster, start, origin) {
    if (cluster.overflow) {
        return { reason: 'too_big' };
    }
    const names = cluster.logs.map(p => read(p.x, p.y, p.z));
    if (names.some(isWorkedWood)) {
        return { reason: 'worked_wood' };
    }
    const kinds = new Set(names.map(woodKind));
    if (kinds.size > 1) {
        return { reason: 'mixed_wood' };
    }
    const trunk = findTrunk(read, cluster.logs, start);
    if (trunk.several) {
        return { reason: 'several_trunks' };
    }
    const crown = countLeaves(read, cluster.logs);
    const contact = contactProblem(read, [...cluster.logs, ...crown.leaves]);
    if (contact) {
        return { reason: contact };
    }
    if (crown.leaves.length < MIN_LEAVES || !crown.touching) {
        return { reason: 'no_leaves' };
    }
    const base = trunk.base;
    return {
        tree: {
            base: { x: base.x, y: base.y, z: base.z },
            kind: woodKind(names[0]),
            logs: sortLogs(cluster.logs),
            height: crown.topY - base.y + 1,
            leaves: crown.leaves.length,
            thick: trunk.thick,
            ground: read(base.x, base.y - 1, base.z),
            stand: findStand(read, trunk.footprint, base.y, origin),
            distance: dist(origin, base),
        },
    };
}

/**
 * Natural trees and why the other log clusters are no trees. See findTrees for the rules and
 * the options. Rejected clusters have a reason: `too_big`, `worked_wood` (stripped logs or wood
 * blocks), `mixed_wood`, `several_trunks`, `unloaded` (a block beside the tree is not loaded),
 * `built` (a block of the tree touches a built block with a face) or `no_leaves`.
 * Never throws.
 * @param {(x: number, y: number, z: number) => string|null} getBlockName
 * @param {{x: number, y: number, z: number}} origin
 * @param {object} [options] as findTrees
 * @returns {{trees: object[], rejected: {base: {x,y,z}, reason: string, logs: number}[]}}
 */
export function inspectTrees(getBlockName, origin, options = {}) {
    const trees = [];
    const rejected = [];
    if (typeof getBlockName !== 'function' || !isPoint(origin)) {
        return { trees, rejected };
    }
    try {
        const o = normaliseOptions(options);
        const from = blockOf(origin);
        const read = reader(getBlockName);
        const claimed = new Set();
        for (const start of collectBases(read, from, o)) {
            if (trees.length >= o.max) {
                break;
            }
            if (claimed.has(posKey(start.x, start.y, start.z))) {
                continue;
            }
            const cluster = growCluster(read, start, o.height);
            for (const p of cluster.logs) {
                claimed.add(posKey(p.x, p.y, p.z));
            }
            const verdict = judge(read, cluster, start, from);
            if (!verdict.tree) {
                rejected.push({ base: start, reason: verdict.reason, logs: cluster.logs.length });
                continue;
            }
            const t = verdict.tree;
            if ((o.kind && t.kind !== o.kind) || o.exclude.has(treeKey(t))) {
                continue;
            }
            trees.push(t);
        }
        trees.sort((a, b) => a.distance - b.distance);
    } catch (err) {
        console.warn('Wood pack: the search for trees failed:', err?.message ?? err);
    }
    return { trees, rejected };
}

/**
 * Finds natural trees around the origin, nearest first (spec T1).
 *
 * A tree is a trunk with leaves: the trunk is a column of logs of one kind (`_log` or `_stem`,
 * not stripped) whose lowest log stands on dirt, grass_block, podzol, coarse_dirt, rooted_dirt,
 * mud, moss_block or mycelium (also mangrove roots and nylium). Logs that touch the trunk or a
 * branch, corners included, are branches. At least 4 leaves (`_leaves`, `_wart_block`) lie within
 * 2 blocks of the highest log, and one of them touches it. No log of the tree and none of these
 * leaves touches a built block (isBuiltBlock) with a face, so the post of a house is no tree, also
 * when leaves hang over the roof, and a tree whose crown lies on a roof is left alone. A trunk of
 * 2 by 2 logs is one tree (`thick`); two trunks joined by logs are none.
 * @param {(x: number, y: number, z: number) => string|null} getBlockName
 * @param {{x: number, y: number, z: number}} origin
 * @param {{range?: number, height?: number, max?: number, kind?: string, candidates?: {x,y,z}[],
 *   exclude?: string[]|Set<string>}} [options]
 *   range 48 (straight distance to the base), height 32 (up and down from the origin), max 8
 *   trees; kind: only trees of that wood; candidates: positions of logs to start from instead of
 *   a scan of the whole range (for example from bot.findBlocks); exclude: treeKey of trees to skip
 * @returns {{base: {x,y,z}, kind: string, logs: {x,y,z}[], height: number, leaves: number, thick: boolean,
 *   ground: string, stand: {x,y,z}|null, distance: number}[]}
 *   logs lowest first; height from the base to the highest log; leaves: the number counted near
 *   the top; stand: a free place on the ground beside the trunk, nearest to the origin
 */
export function findTrees(getBlockName, origin, options = {}) {
    return inspectTrees(getBlockName, origin, options).trees;
}

// Estimates for pickTree: walking speed in blocks per second, seconds to break a log (by hand 3,
// with a wooden axe 1.5), seconds for a block of the pillar (jump, place, dig again).
const WALK_SPEED = 4.3;
const SECONDS_PER_LOG = 2;
const SECONDS_PER_PILLAR_BLOCK = 2;

/**
 * The tree to cut next: the one that costs the least time for each log that is still wanted.
 * A tree that was started is finished, so a giant tree for 3 logs is a bad choice when a small
 * one stands a little further away; for many logs the big tree wins. The time is estimated from
 * the distance, the number of logs and the pillar. Ties go to the first (the nearest) tree.
 * @param {object[]} trees from findTrees
 * @param {number} need logs still wanted
 * @param {{x,y,z}} [from] position of the bot; without it the distance of the tree
 * @returns {object|null}
 */
export function pickTree(trees, need, from = null) {
    const n = isFiniteNumber(need) && need >= 1 ? need : 1;
    let best = null;
    let bestCost = Infinity;
    for (const t of Array.isArray(trees) ? trees : []) {
        if (!t || !isPoint(t.base) || !Array.isArray(t.logs) || t.logs.length === 0) {
            continue;
        }
        const d = isPoint(from) ? dist(from, t.base) : (isFiniteNumber(t.distance) ? t.distance : 0);
        const seconds = d / WALK_SPEED + t.logs.length * SECONDS_PER_LOG + chopPlan(t).pillar_blocks * SECONDS_PER_PILLAR_BLOCK;
        const cost = seconds / Math.min(t.logs.length, n);
        if (cost < bestCost - 1e-9) {
            best = t;
            bestCost = cost;
        }
    }
    return best;
}

/**
 * The key of a tree: `x,y,z` of its base.
 * @param {{base: {x,y,z}}} tree
 * @returns {string|null}
 */
export function treeKey(tree) {
    return isPoint(tree?.base) ? posKey(tree.base.x, tree.base.y, tree.base.z) : null;
}

/**
 * The eyes of a bot whose feet stand in the block `stand`.
 * @param {{x,y,z}} stand
 * @returns {{x: number, y: number, z: number}|null}
 */
export function eyeOf(stand) {
    return isPoint(stand) ? { x: stand.x + 0.5, y: stand.y + EYE_HEIGHT, z: stand.z + 0.5 } : null;
}

/**
 * True when the centre of the block is within reach of the eyes.
 * @param {{x,y,z}} eye
 * @param {{x,y,z}} block
 * @param {number} [reach]
 * @returns {boolean}
 */
export function inReach(eye, block, reach = DEFAULT_REACH) {
    if (!isPoint(eye) || !isPoint(block)) {
        return false;
    }
    return dist(eye, { x: block.x + 0.5, y: block.y + 0.5, z: block.z + 0.5 }) <= positiveNumber(reach, DEFAULT_REACH);
}

/**
 * The order to break the logs of a tree, and where the bot stands for each (spec T1). The bot
 * breaks what it reaches from the ground beside the trunk (`tree.stand`; at least the two lowest
 * logs of the trunk, with stand null when there is no known place), steps into the place of the
 * trunk (`from: 'trunk'`), breaks upwards as far as it reaches, and builds a pillar under itself
 * for the rest (`from: 'pillar'`, `pillar` blocks high). Logs out of reach of a pillar of 12
 * blocks are left over. Never throws.
 * @param {{base: {x,y,z}, logs: {x,y,z}[], thick?: boolean, stand?: {x,y,z}|null}} tree
 * @param {number} [reach]
 * @returns {{steps: {log: {x,y,z}, stand: {x,y,z}|null, from: 'ground'|'trunk'|'pillar', pillar: number}[],
 *   pillar_blocks: number, leftover: {x,y,z}[]}}
 */
export function chopPlan(tree, reach = DEFAULT_REACH) {
    const empty = { steps: [], pillar_blocks: 0, leftover: [] };
    if (!tree || !isPoint(tree.base) || !Array.isArray(tree.logs)) {
        return empty;
    }
    const r = positiveNumber(reach, DEFAULT_REACH);
    const base = blockOf(tree.base);
    const footprint = tree.thick === true
        ? [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dz]) => ({ x: base.x + dx, z: base.z + dz }))
        : [{ x: base.x, z: base.z }];
    const inFootprint = p => footprint.some(f => f.x === p.x && f.z === p.z);
    let left = sortLogs(tree.logs.filter(isPoint).map(blockOf));
    const steps = [];
    const take = (test, from, stand, pillar) => {
        const keep = [];
        for (const log of left) {
            if (test(log)) {
                steps.push({ log, stand: stand ? { ...stand } : null, from, pillar });
            } else {
                keep.push(log);
            }
        }
        left = keep;
    };

    const stand = isPoint(tree.stand) ? blockOf(tree.stand) : null;
    const lowest = log => inFootprint(log) && log.y <= base.y + 1;
    if (stand) {
        const eye = eyeOf(stand);
        take(log => inReach(eye, log, r), 'ground', stand, 0);
    }
    take(lowest, 'ground', null, 0);
    let pillarBlocks = 0;
    for (let p = 0; p <= MAX_PILLAR && left.length > 0; p++) {
        const place = { x: base.x, y: base.y + p, z: base.z };
        const eye = eyeOf(place);
        const before = steps.length;
        take(log => inReach(eye, log, r), p === 0 ? 'trunk' : 'pillar', place, p);
        if (steps.length > before) {
            pillarBlocks = p;
        }
    }
    return { steps, pillar_blocks: pillarBlocks, leftover: left };
}

/**
 * True when a log or the base of the tree lies in a protected area or within `margin` blocks of
 * one (spec T2: such trees are left alone).
 * @param {{base: {x,y,z}, logs: {x,y,z}[]}} tree
 * @param {object[]} areas boxes with min and max
 * @param {number} [margin]
 * @returns {boolean}
 */
export function treeNearAreas(tree, areas, margin = 2) {
    if (!tree || !Array.isArray(areas)) {
        return false;
    }
    const blocks = [tree.base, ...(Array.isArray(tree.logs) ? tree.logs : [])].filter(isPoint);
    for (const area of areas) {
        if (!isBox(area)) {
            continue;
        }
        const box = expandBox(area, isFiniteNumber(margin) ? margin : 2);
        if (box && blocks.some(p => containsPos(box, p))) {
            return true;
        }
    }
    return false;
}
