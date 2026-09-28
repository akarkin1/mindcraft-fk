// Finds the building or the fenced field around a position (spec v0.1.4.6, A3).
// Pure: the world is read through getBlockName(x, y, z), which returns the name of a block
// or null for a block that is not loaded. Nothing is imported.

// --- block names --------------------------------------------------------------------------

// Parts of names that do not occur in a natural world the way they stand in a house.
// Only glazed terracotta counts: plain and coloured terracotta are the ground of badlands.
const BUILT_PARTS = ['planks', 'stairs', 'slab', 'door', 'trapdoor', 'glass', 'bricks', 'wool', 'concrete',
    'glazed_terracotta', 'carpet', 'fence', 'wall', 'quartz'];

// Worked stone: a player made it from the raw block.
const BUILT_PREFIXES = ['smooth_', 'polished_', 'cut_', 'chiseled_'];

// Whole names of the spec, plus variants of them that are just as clearly built.
const BUILT_NAMES = new Set(['cobblestone', 'bookshelf', 'crafting_table', 'furnace', 'chest', 'barrel', 'ladder',
    'torch', 'wall_torch', 'lantern',
    'mossy_cobblestone', 'trapped_chest', 'ender_chest', 'blast_furnace', 'smoker', 'soul_torch', 'soul_wall_torch',
    'redstone_torch', 'redstone_wall_torch', 'soul_lantern',
    'iron_bars', 'hay_block', 'scaffolding']);

// Matched by a part or a prefix above, but they occur in a natural world: moss carpets grow in
// lush caves and pale gardens, smooth basalt is the shell of a geode, quartz ore is nether ground.
const NATURAL_NAMES = new Set(['moss_carpet', 'pale_moss_carpet', 'smooth_basalt', 'nether_quartz_ore']);

// Blocks a mob or a player walks through: the ground is the block under them.
const PASSABLE_NAMES = new Set(['air', 'cave_air', 'void_air',
    'wheat', 'carrots', 'potatoes', 'beetroots', 'melon_stem', 'pumpkin_stem', 'attached_melon_stem',
    'attached_pumpkin_stem', 'sweet_berry_bush', 'nether_wart', 'torchflower_crop', 'pitcher_crop',
    'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'dandelion', 'poppy', 'blue_orchid',
    'allium', 'azure_bluet', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose', 'sunflower', 'lilac',
    'rose_bush', 'peony', 'torchflower', 'pitcher_plant', 'pink_petals', 'snow', 'torch', 'wall_torch',
    'redstone_wire', 'lever', 'tripwire', 'rail', 'powered_rail', 'detector_rail', 'activator_rail',
    'brown_mushroom', 'red_mushroom', 'sugar_cane', 'vine', 'cobweb', 'seagrass', 'tall_seagrass', 'lily_pad']);
const PASSABLE_ENDINGS = ['_sapling', '_carpet', '_button', '_pressure_plate', '_sign', '_banner', '_tulip', '_torch'];

function baseName(name) {
    if (typeof name !== 'string' || name === '') {
        return null;
    }
    return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

/**
 * True for a block that does not occur in a natural world the way it stands in a house:
 * names that contain planks, stairs, slab, door, trapdoor, glass, bricks, wool, concrete,
 * glazed_terracotta, carpet, fence, wall or quartz; names that start with smooth_, polished_,
 * cut_ or chiseled_; cobblestone, bookshelf, crafting_table, furnace, chest, barrel, ladder,
 * torch, wall_torch, lantern and their variants (soul and redstone torches, soul_lantern,
 * trapped and ender chest, blast_furnace, smoker, mossy_cobblestone); iron_bars, hay_block,
 * scaffolding; names that end with _bed.
 * Natural and not counted: plain and coloured terracotta (badlands), moss_carpet and
 * pale_moss_carpet, smooth_basalt (geodes), nether_quartz_ore.
 * @param {string|null} name a block name, with or without "minecraft:"
 * @returns {boolean}
 */
export function isBuiltBlock(name) {
    const n = baseName(name);
    if (n === null || NATURAL_NAMES.has(n)) {
        return false;
    }
    if (BUILT_NAMES.has(n) || n.endsWith('_bed')) {
        return true;
    }
    return BUILT_PARTS.some(part => n.includes(part)) || BUILT_PREFIXES.some(prefix => n.startsWith(prefix));
}

/**
 * True for a log: a name that ends with _log or _wood, stripped ones too.
 * @param {string|null} name
 * @returns {boolean}
 */
export function isLogBlock(name) {
    const n = baseName(name);
    return n !== null && (n.endsWith('_log') || n.endsWith('_wood'));
}

// Fences, fence gates and wall blocks: they bound a field, and in a building they only join
// when they touch it, without spreading the search (so a fence row does not pull in a village).
function isFenceLike(name) {
    return name.includes('fence') || name.endsWith('_wall');
}

function isPassable(name) {
    return PASSABLE_NAMES.has(name) || PASSABLE_ENDINGS.some(ending => name.endsWith(ending));
}

// --- shared helpers -----------------------------------------------------------------------

function positiveInt(value, fallback) {
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

function checkArgs(getBlockName, origin, fn) {
    if (typeof getBlockName !== 'function') {
        throw new TypeError(`${fn} needs a function getBlockName(x, y, z)`);
    }
    if (origin === null || typeof origin !== 'object' || !Number.isFinite(origin.x)
        || !Number.isFinite(origin.y) || !Number.isFinite(origin.z)) {
        throw new TypeError(`${fn} needs an origin with finite x, y and z`);
    }
}

// Reads one block; errors and anything that is not a name count as not loaded.
function reader(getBlockName) {
    return (x, y, z) => {
        try {
            return baseName(getBlockName(x, y, z));
        } catch {
            return null;
        }
    };
}

function compareEntrances(a, b) {
    return a.x - b.x || a.z - b.z || a.y - b.y;
}

// --- scanBuilding -------------------------------------------------------------------------

const KIND_UNKNOWN = 0;
const KIND_BUILT = 1;   // a built block that spreads the search
const KIND_FENCE = 2;   // fence, fence gate, wall: joins when it touches, does not spread
const KIND_LOG = 3;
const KIND_OTHER = 4;   // natural, air or not loaded

const LOG_UNKNOWN = 0;
const LOG_COUNTS = 1;
const LOG_ALONE = 2;
const LOG_VISITING = 3;

const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

const BUILDING_DEFAULTS = Object.freeze({ radius: 24, height: 16, gap: 2, minBlocks: 12, startRadius: 6 });

/**
 * Finds the building around a position.
 *
 * Built blocks (isBuiltBlock) within `startRadius` blocks of the origin start the search, which
 * spreads to built blocks and counting logs at most `gap` blocks away from a block already found,
 * within `radius` blocks of the origin horizontally and `height` vertically. A log counts when a
 * built block or a counting log touches one of its faces. Fences, fence gates and walls join
 * when such a block touches them, but the search does not spread from them. Blocks that are not
 * connected this way form separate groups: the group whose box contains the origin wins (the
 * smallest one if several do), otherwise the nearest; a group needs `minBlocks` blocks.
 *
 * @param {(x: number, y: number, z: number) => string|null} getBlockName
 * @param {{x: number, y: number, z: number}} origin usually the position of the bot
 * @param {{radius?: number, height?: number, gap?: number, minBlocks?: number, startRadius?: number}} [options]
 *   defaults: radius 24, height 16, gap 2, minBlocks 12, startRadius 6
 * @returns {{found: boolean, min: {x: number, y: number, z: number}|null, max: {x: number, y: number, z: number}|null,
 *   blocks: number, entrances: {x: number, y: number, z: number, kind: 'door'|'gate'}[], clipped: boolean}}
 *   min and max: the bounding box of the blocks found, grown by 1 on every side (null when not found).
 *   blocks: the number of blocks of the building. entrances: doors (lower block) and fence gates, sorted
 *   by x, z, y. clipped: the search hit its limit.
 * @throws {TypeError} when getBlockName is not a function or the origin has no finite x, y, z
 */
export function scanBuilding(getBlockName, origin, options = {}) {
    checkArgs(getBlockName, origin, 'scanBuilding');
    const opts = options ?? {};
    const radius = Math.min(positiveInt(opts.radius, BUILDING_DEFAULTS.radius), 64);
    const height = Math.min(positiveInt(opts.height, BUILDING_DEFAULTS.height), 64);
    const gap = Math.min(positiveInt(opts.gap, BUILDING_DEFAULTS.gap), 8);
    const minBlocks = positiveInt(opts.minBlocks, BUILDING_DEFAULTS.minBlocks);
    const startRadius = Math.min(positiveInt(opts.startRadius, BUILDING_DEFAULTS.startRadius), radius);
    const read = reader(getBlockName);

    const ox = Math.floor(origin.x);
    const oy = Math.floor(origin.y);
    const oz = Math.floor(origin.z);

    // Everything is looked up in a region that reaches `gap + 1` beyond the limits, so blocks
    // just beyond them can still be judged (clipped) and faces at the edge can be checked.
    const margin = gap + 1;
    const rx = radius + margin;
    const ry = height + margin;
    const sx = 2 * rx + 1;
    const sy = 2 * ry + 1;
    const volume = sx * sy * sx;
    const kinds = new Uint8Array(volume);
    const logState = new Uint8Array(volume);
    const owner = new Int32Array(volume);
    const names = new Map(); // index to name, for doors and gates only

    const inRegion = (x, y, z) => Math.abs(x - ox) <= rx && Math.abs(y - oy) <= ry && Math.abs(z - oz) <= rx;
    const inLimits = (x, y, z) => Math.abs(x - ox) <= radius && Math.abs(y - oy) <= height && Math.abs(z - oz) <= radius;
    const indexOf = (x, y, z) => ((x - ox + rx) * sy + (y - oy + ry)) * sx + (z - oz + rx);

    function kindAt(x, y, z) {
        if (!inRegion(x, y, z)) {
            return KIND_OTHER;
        }
        const i = indexOf(x, y, z);
        let kind = kinds[i];
        if (kind !== KIND_UNKNOWN) {
            return kind;
        }
        const name = read(x, y, z);
        if (name === null) {
            kind = KIND_OTHER;
        } else if (isBuiltBlock(name)) {
            kind = isFenceLike(name) ? KIND_FENCE : KIND_BUILT;
            if (name.endsWith('_door') || name.endsWith('_fence_gate')) {
                names.set(i, name);
            }
        } else {
            kind = isLogBlock(name) ? KIND_LOG : KIND_OTHER;
        }
        kinds[i] = kind;
        return kind;
    }

    // A log counts when its group of face-connected logs touches a built block.
    function logCounts(x, y, z) {
        const start = indexOf(x, y, z);
        if (logState[start] !== LOG_UNKNOWN) {
            return logState[start] === LOG_COUNTS;
        }
        const members = [start];
        const stack = [x, y, z];
        logState[start] = LOG_VISITING;
        let counts = false;
        while (stack.length > 0) {
            const cz = stack.pop();
            const cy = stack.pop();
            const cx = stack.pop();
            for (const [fx, fy, fz] of FACES) {
                const nx = cx + fx;
                const ny = cy + fy;
                const nz = cz + fz;
                const kind = kindAt(nx, ny, nz);
                if (kind === KIND_BUILT) {
                    counts = true;
                } else if (kind === KIND_LOG) {
                    const j = indexOf(nx, ny, nz);
                    if (logState[j] === LOG_UNKNOWN) {
                        logState[j] = LOG_VISITING;
                        members.push(j);
                        stack.push(nx, ny, nz);
                    }
                }
            }
        }
        const state = counts ? LOG_COUNTS : LOG_ALONE;
        for (const j of members) {
            logState[j] = state;
        }
        return counts;
    }

    function fenceCounts(x, y, z) {
        for (const [fx, fy, fz] of FACES) {
            const kind = kindAt(x + fx, y + fy, z + fz);
            if (kind === KIND_BUILT || (kind === KIND_LOG && logCounts(x + fx, y + fy, z + fz))) {
                return true;
            }
        }
        return false;
    }

    function isMember(x, y, z) {
        const kind = kindAt(x, y, z);
        if (kind === KIND_BUILT) {
            return true;
        }
        if (kind === KIND_LOG) {
            return logCounts(x, y, z);
        }
        return kind === KIND_FENCE && fenceCounts(x, y, z);
    }

    function isLowerDoor(x, y, z, name) {
        let below = 0;
        while (kindAt(x, y - below - 1, z) === KIND_BUILT && names.get(indexOf(x, y - below - 1, z)) === name) {
            below++;
        }
        return below % 2 === 0;
    }

    function collect(seedX, seedY, seedZ, id) {
        const group = {
            count: 0, clipped: false, entrances: [],
            minX: seedX, minY: seedY, minZ: seedZ, maxX: seedX, maxY: seedY, maxZ: seedZ,
        };
        owner[indexOf(seedX, seedY, seedZ)] = id;
        const queue = [seedX, seedY, seedZ];
        for (let head = 0; head < queue.length; head += 3) {
            const x = queue[head];
            const y = queue[head + 1];
            const z = queue[head + 2];
            group.count++;
            if (x < group.minX) group.minX = x;
            if (y < group.minY) group.minY = y;
            if (z < group.minZ) group.minZ = z;
            if (x > group.maxX) group.maxX = x;
            if (y > group.maxY) group.maxY = y;
            if (z > group.maxZ) group.maxZ = z;
            const kind = kindAt(x, y, z);
            const name = names.get(indexOf(x, y, z));
            if (name !== undefined) {
                if (name.endsWith('_fence_gate')) {
                    group.entrances.push({ x, y, z, kind: 'gate' });
                } else if (isLowerDoor(x, y, z, name)) {
                    group.entrances.push({ x, y, z, kind: 'door' });
                }
            }
            if (kind === KIND_FENCE) {
                continue; // joins, but does not spread
            }
            for (let dx = -gap; dx <= gap; dx++) {
                for (let dy = -gap; dy <= gap; dy++) {
                    for (let dz = -gap; dz <= gap; dz++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        const nz = z + dz;
                        if (!inLimits(nx, ny, nz)) {
                            if (!group.clipped && isMember(nx, ny, nz)) {
                                group.clipped = true;
                            }
                            continue;
                        }
                        const j = indexOf(nx, ny, nz);
                        if (owner[j] !== 0 || !isMember(nx, ny, nz)) {
                            continue;
                        }
                        owner[j] = id;
                        queue.push(nx, ny, nz);
                    }
                }
            }
        }
        return group;
    }

    const groups = [];
    for (let dx = -startRadius; dx <= startRadius; dx++) {
        for (let dy = -startRadius; dy <= startRadius; dy++) {
            for (let dz = -startRadius; dz <= startRadius; dz++) {
                const x = ox + dx;
                const y = oy + dy;
                const z = oz + dz;
                if (!inLimits(x, y, z) || kindAt(x, y, z) !== KIND_BUILT || owner[indexOf(x, y, z)] !== 0) {
                    continue;
                }
                groups.push(collect(x, y, z, groups.length + 1));
            }
        }
    }

    const best = pickGroup(groups, origin, minBlocks);
    if (!best) {
        const largest = groups.reduce((n, g) => Math.max(n, g.count), 0);
        return { found: false, min: null, max: null, blocks: largest, entrances: [], clipped: false };
    }
    return {
        found: true,
        min: { x: best.minX - 1, y: best.minY - 1, z: best.minZ - 1 },
        max: { x: best.maxX + 1, y: best.maxY + 1, z: best.maxZ + 1 },
        blocks: best.count,
        entrances: best.entrances.sort(compareEntrances),
        clipped: best.clipped,
    };
}

// The group whose grown box contains the origin (the smallest such box), else the nearest
// (ties: more blocks). Only groups with at least minBlocks blocks.
function pickGroup(groups, origin, minBlocks) {
    let best = null;
    let bestKey = null;
    for (const group of groups) {
        if (group.count < minBlocks) {
            continue;
        }
        const dx = gapTo(group.minX - 1, group.maxX + 1, origin.x);
        const dy = gapTo(group.minY - 1, group.maxY + 1, origin.y);
        const dz = gapTo(group.minZ - 1, group.maxZ + 1, origin.z);
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const volume = (group.maxX - group.minX + 3) * (group.maxY - group.minY + 3) * (group.maxZ - group.minZ + 3);
        const key = [distance, distance === 0 ? volume : -group.count];
        if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
            best = group;
            bestKey = key;
        }
    }
    return best;
}

// Distance from a coordinate to the space [lo, hi + 1] of one axis.
function gapTo(lo, hi, value) {
    if (value < lo) {
        return lo - value;
    }
    return value >= hi + 1 ? value - (hi + 1) : 0;
}

// --- scanFarm -----------------------------------------------------------------------------

const FARM_DEFAULTS = Object.freeze({ radius: 24 });

/**
 * Finds the ground inside a fence around a position.
 *
 * The ground height is the block under the origin (the block the origin is in when that is
 * not passable, for example farmland). Ground cells are columns x, z whose ground lies at that
 * height, one below or one above: a block that is not passable with a passable block above it.
 * The search starts at the origin and spreads to the four neighbours. A cell stops the search
 * if it holds a fence, a fence gate or a wall block at the height of the origin or one below,
 * or if it has no ground within one block of the height (a house wall, a hole). Reaching more
 * than `radius` blocks from the origin means the ground is not enclosed.
 *
 * @param {(x: number, y: number, z: number) => string|null} getBlockName
 * @param {{x: number, y: number, z: number}} origin usually the position of the bot
 * @param {{radius?: number}} [options] default radius 24
 * @returns {{found: boolean, reason: null|'not_enclosed'|'no_ground'|'not_loaded',
 *   min: {x: number, y: number, z: number}|null, max: {x: number, y: number, z: number}|null,
 *   cells: number, entrances: {x: number, y: number, z: number, kind: 'gate'}[]}}
 *   min and max cover the cells and the fence around them, from one block below the ground to
 *   3 blocks above (null when not found). cells: the number of ground cells. entrances: the fence
 *   gates of the fence, sorted by x, z, y.
 * @throws {TypeError} when getBlockName is not a function or the origin has no finite x, y, z
 */
export function scanFarm(getBlockName, origin, options = {}) {
    checkArgs(getBlockName, origin, 'scanFarm');
    const radius = positiveInt((options ?? {}).radius, FARM_DEFAULTS.radius);
    const read = reader(getBlockName);

    const ox = Math.floor(origin.x);
    const oz = Math.floor(origin.z);
    const feetY = Math.floor(origin.y);
    const feet = read(ox, feetY, oz);
    const groundY = feet !== null && !isPassable(feet) ? feetY : feetY - 1;
    const levelY = groundY + 1;

    const notFound = (reason, cells = 0) => ({ found: false, reason, min: null, max: null, cells, entrances: [] });

    function column(x, z) {
        for (const y of [levelY, levelY - 1]) {
            const name = read(x, y, z);
            if (name === null) {
                return { kind: 'unloaded' };
            }
            if (isFenceLike(name)) {
                return { kind: 'barrier', gate: name.endsWith('_fence_gate') ? { x, y, z, kind: 'gate' } : null };
            }
        }
        let above = read(x, groundY + 2, z);
        for (let y = groundY + 1; y >= groundY - 1; y--) {
            const name = read(x, y, z);
            if (name === null || above === null) {
                return { kind: 'unloaded' };
            }
            if (!isPassable(name) && isPassable(above)) {
                return { kind: 'cell', surface: y };
            }
            above = name;
        }
        return { kind: 'barrier', gate: null };
    }

    const start = column(ox, oz);
    if (start.kind === 'unloaded') {
        return notFound('not_loaded');
    }
    if (start.kind !== 'cell') {
        return notFound('no_ground');
    }

    const visited = new Set([`${ox},${oz}`]);
    const gates = new Map();
    const queue = [[ox, oz, start.surface]];
    let minX = ox;
    let maxX = ox;
    let minZ = oz;
    let maxZ = oz;
    let minSurface = start.surface;
    let maxSurface = start.surface;
    for (let head = 0; head < queue.length; head++) {
        const [x, z, surface] = queue[head];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
        if (surface < minSurface) minSurface = surface;
        if (surface > maxSurface) maxSurface = surface;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx;
            const nz = z + dz;
            const key = `${nx},${nz}`;
            if (visited.has(key)) {
                continue;
            }
            visited.add(key);
            const state = column(nx, nz);
            if (state.kind === 'unloaded') {
                return notFound('not_loaded', queue.length);
            }
            if (state.kind === 'barrier') {
                if (state.gate) {
                    gates.set(key, state.gate);
                }
                continue;
            }
            if (Math.max(Math.abs(nx - ox), Math.abs(nz - oz)) > radius) {
                return notFound('not_enclosed', queue.length);
            }
            queue.push([nx, nz, state.surface]);
        }
    }
    return {
        found: true,
        reason: null,
        min: { x: minX - 1, y: minSurface - 1, z: minZ - 1 },
        max: { x: maxX + 1, y: maxSurface + 3, z: maxZ + 1 },
        cells: queue.length,
        entrances: [...gates.values()].sort(compareEntrances),
    };
}
