// Finds the building or the fenced field around a position (spec v0.1.4.6, A3).
// Pure: the world is read through getBlockName(x, y, z), which returns the name of a block
// or null for a block that is not loaded. Nothing is imported (v0.1.4.12: the measure of a tunnel of the mining pack is
// given, see useTunnelMeasure).

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
    'iron_bars', 'hay_block', 'scaffolding',
    // v0.1.4.8 (D3)
    'composter', 'rail', 'powered_rail', 'detector_rail', 'activator_rail', 'lever', 'flower_pot', 'hopper', 'bell',
    'lectern', 'loom']);

// v0.1.4.8 (D3): endings of built names: signs and hanging signs, banners, pressure plates, buttons,
// beds, campfires, anvils (chipped and damaged too), cauldrons with or without content, shulker boxes.
// Stairs and slabs of every material are the parts "stairs" and "slab" above.
const BUILT_ENDINGS = ['_bed', '_sign', '_banner', '_pressure_plate', '_button', 'campfire', 'anvil', 'cauldron',
    'shulker_box'];

// A flower pot with a plant in it is a block of its own: potted_poppy, potted_oak_sapling ...
const BUILT_START = 'potted_';

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
 * v0.1.4.8 (D3): also signs, banners, composter, pressure plates, buttons, rails, lever, flower_pot
 * and potted plants, campfires, anvils, cauldrons, hopper, bell, lectern, loom and shulker boxes.
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
    if (BUILT_NAMES.has(n) || BUILT_ENDINGS.some(ending => n.endsWith(ending)) || n.startsWith(BUILT_START)) {
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
 * v0.1.4.10 (R3): with `floors: true` (the setting area_floors) the scan is first that of the floor the
 * origin stands on (scanFloor): the box of the room or rooms of that floor, which never takes in the floor
 * above or below through a trapdoor or a ladder. When the floor scan finds no floor (the origin is not
 * under a roof, or the floor is open to the limits), the scan of the building runs as without it.
 *
 * @param {(x: number, y: number, z: number) => string|null} getBlockName
 * @param {{x: number, y: number, z: number}} origin usually the position of the bot
 * @param {{radius?: number, height?: number, gap?: number, minBlocks?: number, startRadius?: number, floors?: boolean}} [options]
 *   defaults: radius 24, height 16, gap 2, minBlocks 12, startRadius 6, floors false
 * @returns {{found: boolean, reason: null|'no_built_blocks'|'too_few_blocks', text: string,
 *   min: {x: number, y: number, z: number}|null, max: {x: number, y: number, z: number}|null,
 *   blocks: number, entrances: {x: number, y: number, z: number, kind: 'door'|'gate'|'trapdoor'}[], clipped: boolean,
 *   floor?: boolean}}
 *   reason and text (v0.1.4.8, D5): why nothing was found and what to do; null and '' when found.
 *   min and max: the bounding box of the blocks found, grown by 1 on every side (null when not found).
 *   blocks: the number of blocks of the building. entrances: doors (lower block) and fence gates, sorted
 *   by x, z, y. clipped: the search hit its limit. floor: only with `floors: true`, true when the box is
 *   that of the floor (blocks is then the number of floor cells, and the entrances include trapdoors).
 * @throws {TypeError} when getBlockName is not a function or the origin has no finite x, y, z
 */
export function scanBuilding(getBlockName, origin, options = {}) {
    // v0.1.4.11 (I5): the building case of the one scan; the result is that of v0.1.4.10
    return scanEnclosure(getBlockName, origin, { ...(options ?? {}), mode: 'building', fn: 'scanBuilding' }).scan;
}

// The scan of a building of v0.1.4.10 (scanBuilding before v0.1.4.11), after checkArgs.
function findBuilding(getBlockName, origin, options = {}) {
    const opts = options ?? {};
    if (opts.floors === true) {
        const floor = scanFloor(getBlockName, origin, opts);
        if (floor.found) {
            return floor;
        }
        return { ...findBuilding(getBlockName, origin, { ...opts, floors: false }), floor: false };
    }
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
        const reason = largest === 0 ? 'no_built_blocks' : 'too_few_blocks';
        return { found: false, reason, text: scanText(reason, { range: startRadius, count: largest, minBlocks }),
            min: null, max: null, blocks: largest, entrances: [], clipped: false };
    }
    return {
        found: true,
        reason: null,
        text: '',
        min: { x: best.minX - 1, y: best.minY - 1, z: best.minZ - 1 },
        max: { x: best.maxX + 1, y: best.maxY + 1, z: best.maxZ + 1 },
        blocks: best.count,
        entrances: best.entrances.sort(compareEntrances),
        clipped: best.clipped,
    };
}

// --- the floor of a building (v0.1.4.10, R3) -------------------------------------------------

/** A floor has at least this many cells. */
const FLOOR_MIN_CELLS = 4;
/** The most cells of one floor (64 x 64 at three heights). */
const FLOOR_MAX_CELLS = 64 * 64 * 3;
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function isClimbable(name) {
    return name === 'ladder' || name.includes('vine');
}

function isTrapdoorName(name) {
    return name.endsWith('_trapdoor');
}

// A cell the flood may stand in: a block a player walks through, not a ladder or a vine.
function isOpenCell(name) {
    return name !== null && isPassable(name) && !isClimbable(name);
}

/**
 * The floor the origin stands on (v0.1.4.10, R3). A flood fill of the cells a player stands in: open
 * (air and the passable blocks), on ground that is no trapdoor, ladder, vine or hole, and under a roof
 * within `height` blocks. It moves to the four sides, up or down 1 block at most for a step, and never
 * more than 1 block above or below the level of the first cell; a ladder or a trapdoor cell is a wall,
 * so it never passes to the floor above or below. Doors, fence gates and trapdoors next to the floor,
 * in its ground, in its ceiling or at the top of a ladder beside it are its entrances.
 * The box: the cells grown by 1 to the sides (the walls), from the ground under the lowest cell to the
 * highest ceiling.
 * @returns {object} like scanBuilding with floor: true; found false (reason null) when there is no floor
 */
function scanFloor(getBlockName, origin, opts) {
    const read = reader(getBlockName);
    const radius = Math.min(positiveInt(opts.radius, BUILDING_DEFAULTS.radius), 64);
    const height = Math.min(positiveInt(opts.height, BUILDING_DEFAULTS.height), 64);
    const ox = Math.floor(origin.x);
    const oy = Math.floor(origin.y);
    const oz = Math.floor(origin.z);
    const entrances = new Map();
    const none = { found: false, reason: null, text: '', min: null, max: null, blocks: 0, entrances: [], clipped: false, floor: true };

    const addEntrance = (x, y, z, kind) => {
        entrances.set(`${x},${y},${z}`, { x, y, z, kind });
    };
    // the first block above that is not open: the ceiling, or null without one within height
    const ceilingOf = (x, y, z) => {
        for (let dy = 1; dy <= height; dy++) {
            const name = read(x, y + dy, z);
            if (name === null) {
                return null;
            }
            if (!isPassable(name)) {
                if (isTrapdoorName(name)) {
                    addEntrance(x, y + dy, z, 'trapdoor');
                }
                return y + dy;
            }
        }
        return null;
    };
    // the ceiling when a player can stand in the cell under a roof, else null; notes a trapdoor in its ground
    const standCeiling = (x, y, z) => {
        if (!isOpenCell(read(x, y, z))) {
            return null;
        }
        const ground = read(x, y - 1, z);
        if (ground === null || isPassable(ground) || isClimbable(ground)) {
            return null;
        }
        if (isTrapdoorName(ground)) {
            addEntrance(x, y - 1, z, 'trapdoor');
            return null;
        }
        return ceilingOf(x, y, z);
    };
    // a ladder beside the floor: the trapdoor at the top of its column is an entrance
    const ladderTop = (x, y, z) => {
        for (let dy = 1; dy <= height; dy++) {
            const name = read(x, y + dy, z);
            if (name === null || (!isClimbable(name) && !isOpenCell(name))) {
                if (name !== null && isTrapdoorName(name)) {
                    addEntrance(x, y + dy, z, 'trapdoor');
                }
                return;
            }
        }
    };
    const sideBlock = (x, y, z) => {
        const name = read(x, y, z);
        if (name === null) {
            return;
        }
        if (name.endsWith('_fence_gate')) {
            addEntrance(x, y, z, 'gate');
        } else if (name.endsWith('_door')) {
            const lower = read(x, y - 1, z) === name ? y - 1 : y;
            addEntrance(x, lower, z, 'door');
        } else if (isClimbable(name)) {
            ladderTop(x, y, z);
        }
    };

    let start = null;
    for (const [dx, dz] of [[0, 0], ...SIDES]) {
        for (const dy of [0, 1, -1]) {
            if (!start && standCeiling(ox + dx, oy + dy, oz + dz) !== null) {
                start = { x: ox + dx, y: oy + dy, z: oz + dz };
            }
        }
    }
    if (!start) {
        return none;
    }
    const level = start.y;
    const seen = new Set([`${start.x},${start.y},${start.z}`]);
    const columns = new Set([`${start.x},${start.z}`]);
    const queue = [[start.x, start.y, start.z, standCeiling(start.x, start.y, start.z)]];
    const box = { minX: start.x, maxX: start.x, minY: start.y, minZ: start.z, maxZ: start.z, top: -Infinity };
    for (let head = 0; head < queue.length; head++) {
        const [x, y, z, ceiling] = queue[head];
        if (x < box.minX) box.minX = x;
        if (x > box.maxX) box.maxX = x;
        if (z < box.minZ) box.minZ = z;
        if (z > box.maxZ) box.maxZ = z;
        if (y < box.minY) box.minY = y;
        if (ceiling > box.top) box.top = ceiling;
        if (queue.length > FLOOR_MAX_CELLS) {
            return none;
        }
        for (const [dx, dz] of SIDES) {
            const nx = x + dx;
            const nz = z + dz;
            if (columns.has(`${nx},${nz}`)) {
                continue;
            }
            sideBlock(nx, y, nz);
            sideBlock(nx, y + 1, nz);
            for (const dy of [0, 1, -1]) {
                const ny = y + dy;
                if (Math.abs(ny - level) > 1 || seen.has(`${nx},${ny},${nz}`)) {
                    continue;
                }
                const top = standCeiling(nx, ny, nz);
                if (top === null) {
                    continue;
                }
                if (Math.abs(nx - ox) > radius || Math.abs(nz - oz) > radius) {
                    return none; // open to the limits: no floor of a building
                }
                seen.add(`${nx},${ny},${nz}`);
                columns.add(`${nx},${nz}`);
                queue.push([nx, ny, nz, top]);
                break;
            }
        }
    }
    if (queue.length < FLOOR_MIN_CELLS) {
        return none;
    }
    return {
        found: true,
        reason: null,
        text: '',
        min: { x: box.minX - 1, y: box.minY - 1, z: box.minZ - 1 },
        max: { x: box.maxX + 1, y: box.top, z: box.maxZ + 1 },
        blocks: queue.length,
        entrances: [...entrances.values()].sort(compareEntrances),
        clipped: false,
        floor: true,
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

// --- fenced ground: scanFarm, scanPen, findFencedGroundNear ------------------------------

const FARM_DEFAULTS = Object.freeze({ radius: 24 });

// v0.1.4.8 (D5): plants that stand only where someone planted them. One of them, or one block of
// farmland, makes fenced ground a farm.
const CROP_NAMES = new Set(['wheat', 'carrots', 'potatoes', 'beetroots', 'melon_stem', 'pumpkin_stem',
    'attached_melon_stem', 'attached_pumpkin_stem', 'sweet_berry_bush', 'nether_wart', 'torchflower_crop',
    'pitcher_crop']);

// A cell has a roof when a block that is not passable lies 1 to 4 blocks above its ground.
const ROOF_HEIGHT = 4;

// The widest ground of an area: 64 blocks with the fence on both sides.
const MAX_SPAN = 62;

// findFencedGroundNear: how far from the position the ground behind a fence may start, and how much
// further the search goes to tell a fence that is too big for an area from one that is open.
const NEAR_DEFAULT = 6;
const NEAR_MAX = 16;
const EXTENDED_SPAN = 3 * MAX_SPAN;
const EXTENDED_CHECKS = 2;

// The text of every reason of a scan: what went wrong and what to do.
const SCAN_TEXTS = Object.freeze({
    no_built_blocks: (i) => `I find no built blocks within ${i.range} blocks of me. Stand inside the building and try again.`,
    too_few_blocks: (i) => `I find only ${i.count} built blocks here, and a building has at least ${i.minBlocks}. `
        + 'Stand inside the building and try again.',
    not_loaded: () => 'Part of the ground around me is not loaded yet. Wait a moment and try again.',
    no_ground: () => 'I find no ground under me. Stand on the ground inside the fence and try again.',
    not_enclosed: (i) => `I find no closed fence around me within ${i.radius} blocks. `
        + 'Stand inside the fence, or close the gap in it, and try again.',
    no_fence: (i) => `The ground around me is closed by walls, not by a fence. This is a room, not ${i.what}.`,
    no_crops: () => 'The fenced ground has no farmland and no crop, so it is no farm. Till one block of it, or save it as a pen.',
    roofed: () => 'Half or more of the fenced ground has a roof over it. This is a room, not a farm.',
    farmland: () => 'The fenced ground has farmland, so it is a farm, not a pen. Save it as a farm.',
    no_fence_near: (i) => `I see no fence within ${i.range} blocks of me. Stand inside the fence or next to its gate and try again.`,
    not_closed: () => 'The fence near me is not closed. Close the gap in it and try again.',
    too_big: () => 'The fenced ground is too big for one area. An area has at most 64 x 48 x 64 blocks. '
        + 'Use !setArea to save a part of it.',
    // v0.1.4.11 (P1): scanEnclosure found nothing that bounds the place
    no_border: (i) => `I find no border around me: no fence, wall, hedge or water within ${i.radius} blocks. `
        + 'Stand inside the place and say it again.',
    // v0.1.4.12 (F1): a border of rock is a tunnel or a cave, never an area of !rememberArea without a type
    tunnel: () => 'I am in a tunnel; a tunnel is saved with "this is the mine" or "dig here".',
    cave: () => 'I am in a cave; a cave is nothing I save.',
});

/**
 * The text for the reason of a failed scan (v0.1.4.8, D5): what went wrong and what to do.
 * Reasons: no_built_blocks, too_few_blocks (scanBuilding); not_loaded, no_ground, not_enclosed,
 * no_fence, no_crops, roofed, farmland (scanFarm, scanPen); no_fence_near, not_closed, too_big
 * (findFencedGroundNear); no_border (scanEnclosure, v0.1.4.11); tunnel, cave (scanEnclosure, v0.1.4.12, F1: the
 * answer of !rememberArea without a type in rock). An unknown reason gives ''.
 * @param {string} reason
 * @param {{range?: number, radius?: number, count?: number, minBlocks?: number, what?: string}} [info]
 *   range: the reach of findFencedGroundNear (6) or the start radius of scanBuilding; radius: of
 *   scanFarm (24); count and minBlocks: built blocks found and needed; what: 'a farm', 'a pen' ...
 * @returns {string}
 */
export function scanText(reason, info = {}) {
    const make = Object.hasOwn(SCAN_TEXTS, reason) ? SCAN_TEXTS[reason] : null;
    if (!make) {
        return '';
    }
    return make({ range: NEAR_DEFAULT, radius: FARM_DEFAULTS.radius, count: 0, minBlocks: BUILDING_DEFAULTS.minBlocks,
        what: 'a farm', ...(info ?? {}) });
}

// The flood of the fenced scans from the column of the origin. Returns the ground cells
// [x, z, surface], the gates, how many columns bound the ground and how many of them are a fence, a
// fence gate or a wall block, every column it looked at, and a reason when it stopped: not_loaded,
// no_ground or not_enclosed (more than `radius` blocks from the origin, or wider than `maxSpan` in x or z).
// v0.1.4.11 (I5): also the columns that bound the ground, as [x, z, surface of the cell beside it] in
// `bounds`; with `water: true` a cell whose ground is water bounds the ground too (a pond, a moat).
function floodFenced(read, origin, radius, maxSpan, options = {}) {
    const water = options?.water === true;
    const ox = Math.floor(origin.x);
    const oz = Math.floor(origin.z);
    const feetY = Math.floor(origin.y);
    const feet = read(ox, feetY, oz);
    const groundY = feet !== null && !isPassable(feet) ? feetY : feetY - 1;
    const levelY = groundY + 1;
    const flood = { reason: null, cells: [], gates: new Map(), fences: 0, barriers: 0, visited: new Set([`${ox},${oz}`]),
        barrier: null, minX: ox, maxX: ox, minZ: oz, maxZ: oz, bounds: [] };

    function column(x, z) {
        for (const y of [levelY, levelY - 1]) {
            const name = read(x, y, z);
            if (name === null) {
                return { kind: 'unloaded' };
            }
            if (isFenceLike(name)) {
                return { kind: 'barrier', fence: true, gate: name.endsWith('_fence_gate') ? { x, y, z, kind: 'gate' } : null };
            }
        }
        let above = read(x, groundY + 2, z);
        for (let y = groundY + 1; y >= groundY - 1; y--) {
            const name = read(x, y, z);
            if (name === null || above === null) {
                return { kind: 'unloaded' };
            }
            if (!isPassable(name) && isPassable(above)) {
                if (water && name === 'water') {
                    return { kind: 'barrier', fence: false, gate: null };
                }
                return { kind: 'cell', surface: y };
            }
            above = name;
        }
        return { kind: 'barrier', fence: false, gate: null };
    }

    const start = column(ox, oz);
    if (start.kind !== 'cell') {
        flood.reason = start.kind === 'unloaded' ? 'not_loaded' : 'no_ground';
        flood.barrier = start.kind === 'barrier' ? start : null;
        return flood;
    }
    const queue = flood.cells;
    queue.push([ox, oz, start.surface]);
    for (let head = 0; head < queue.length; head++) {
        const [x, z, surface] = queue[head];
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx;
            const nz = z + dz;
            const key = `${nx},${nz}`;
            if (flood.visited.has(key)) {
                continue;
            }
            flood.visited.add(key);
            const state = column(nx, nz);
            if (state.kind === 'unloaded') {
                flood.reason = 'not_loaded';
                return flood;
            }
            if (state.kind === 'barrier') {
                flood.bounds.push([nx, nz, surface]);
                flood.barriers++;
                if (state.fence) {
                    flood.fences++;
                }
                if (state.gate) {
                    flood.gates.set(key, state.gate);
                }
                continue;
            }
            if (Math.max(Math.abs(nx - ox), Math.abs(nz - oz)) > radius) {
                flood.reason = 'not_enclosed';
                return flood;
            }
            if (nx < flood.minX) flood.minX = nx;
            if (nx > flood.maxX) flood.maxX = nx;
            if (nz < flood.minZ) flood.minZ = nz;
            if (nz > flood.maxZ) flood.maxZ = nz;
            if (flood.maxX - flood.minX + 1 > maxSpan || flood.maxZ - flood.minZ + 1 > maxSpan) {
                flood.reason = 'not_enclosed';
                return flood;
            }
            queue.push([nx, nz, state.surface]);
        }
    }
    return flood;
}

// Farmland cells, crop cells and cells with a roof (a solid block 1 to 4 above the ground).
function groundStats(read, cells) {
    let farmland = 0;
    let crops = 0;
    let roofed = 0;
    for (const [x, z, surface] of cells) {
        if (read(x, surface, z) === 'farmland') {
            farmland++;
        }
        if (CROP_NAMES.has(read(x, surface + 1, z))) {
            crops++;
        }
        for (let y = surface + 1; y <= surface + ROOF_HEIGHT; y++) {
            const name = read(x, y, z);
            if (name !== null && !isPassable(name)) {
                roofed++;
                break;
            }
        }
    }
    return { farmland, crops, roofed };
}

// Why enclosed ground is not of the type (null: it is). Ground closed only by walls is a room, not
// fenced ground. A farm needs farmland or a crop and fewer than half of its cells under a roof (a
// field on the edge of a cliff is still a farm). A pen has no farmland, and at least half of what
// bounds it is a fence, a gate or a wall block: a room with a fence post in it is no pen.
function typeFailure(flood, stats, type) {
    if (flood.fences === 0 || (type === 'pen' && flood.fences * 2 < flood.barriers)) {
        return 'no_fence';
    }
    if (type === 'farm') {
        if (stats.farmland + stats.crops === 0) {
            return 'no_crops';
        }
        if (stats.roofed * 2 >= flood.cells.length) {
            return 'roofed';
        }
    } else if (type === 'pen' && stats.farmland > 0) {
        return 'farmland';
    }
    return null;
}

function whatOf(type) {
    return type ? `a ${type}` : 'fenced ground';
}

function fencedFound(flood, stats) {
    let minSurface = Infinity;
    let maxSurface = -Infinity;
    for (const [, , surface] of flood.cells) {
        if (surface < minSurface) minSurface = surface;
        if (surface > maxSurface) maxSurface = surface;
    }
    return {
        found: true,
        reason: null,
        text: '',
        min: { x: flood.minX - 1, y: minSurface - 1, z: flood.minZ - 1 },
        max: { x: flood.maxX + 1, y: maxSurface + 3, z: flood.maxZ + 1 },
        cells: flood.cells.length,
        entrances: [...flood.gates.values()].sort(compareEntrances),
        farmland: stats.farmland,
        crops: stats.crops,
        roofed: stats.roofed,
    };
}

function fencedNotFound(reason, cells, info) {
    return { found: false, reason, text: scanText(reason, info), min: null, max: null, cells, entrances: [] };
}

// The scan of fenced ground of v0.1.4.10 (scanFarm, scanPen), after checkArgs: the result of v0.1.4.10 as
// `scan`, and the flood when it closed.
function fencedScan(read, origin, options, type) {
    const radius = positiveInt((options ?? {}).radius, FARM_DEFAULTS.radius);
    const info = { radius, what: whatOf(type) };
    const flood = floodFenced(read, origin, radius, Infinity);
    if (flood.reason) {
        return { scan: fencedNotFound(flood.reason, flood.cells.length, info), flood: null };
    }
    const stats = groundStats(read, flood.cells);
    const failure = typeFailure(flood, stats, type);
    if (failure) {
        return { scan: fencedNotFound(failure, flood.cells.length, info), flood: null };
    }
    return { scan: fencedFound(flood, stats), flood };
}

/**
 * Finds the farm inside a fence around a position.
 *
 * The ground height is the block under the origin (the block the origin is in when that is
 * not passable, for example farmland). Ground cells are columns x, z whose ground lies at that
 * height, one below or one above: a block that is not passable with a passable block above it.
 * The search starts at the origin and spreads to the four neighbours. A cell stops the search
 * if it holds a fence, a fence gate or a wall block at the height of the origin or one below,
 * or if it has no ground within one block of the height (a house wall, a hole). Reaching more
 * than `radius` blocks from the origin means the ground is not enclosed.
 *
 * v0.1.4.8 (D5): the ground is a farm only when a fence, gate or wall block bounds it (not only the
 * walls of a room), it holds at least one block of farmland or one crop, and fewer than half of its
 * cells have a solid block 1 to 4 blocks above the ground. Every failure has a reason and a text.
 *
 * @param {(x: number, y: number, z: number) => string|null} getBlockName
 * @param {{x: number, y: number, z: number}} origin usually the position of the bot
 * @param {{radius?: number}} [options] default radius 24
 * @returns {{found: boolean, reason: null|'not_enclosed'|'no_ground'|'not_loaded'|'no_fence'|'no_crops'|'roofed',
 *   text: string, min: {x: number, y: number, z: number}|null, max: {x: number, y: number, z: number}|null,
 *   cells: number, entrances: {x: number, y: number, z: number, kind: 'gate'}[],
 *   farmland?: number, crops?: number, roofed?: number}}
 *   text: what to do (scanText), '' when found. min and max cover the cells and the fence around
 *   them, from one block below the ground to 3 blocks above (null when not found). cells: the number
 *   of ground cells. entrances: the fence gates of the fence, sorted by x, z, y. farmland, crops,
 *   roofed: numbers of cells, when found.
 * @throws {TypeError} when getBlockName is not a function or the origin has no finite x, y, z
 */
export function scanFarm(getBlockName, origin, options = {}) {
    // v0.1.4.11 (I5): the fenced case of the one scan; the result is that of v0.1.4.10
    return scanEnclosure(getBlockName, origin, { ...(options ?? {}), mode: 'ground', type: 'farm', fn: 'scanFarm' }).scan;
}

/**
 * Finds the pen inside a fence around a position (v0.1.4.8, D5): the ground as scanFarm finds it,
 * without farmland, and at least half of the columns that bound it are fences, gates or wall blocks
 * (a room with a fence post in it is no pen). A roof does not matter (a barn is a pen).
 * @param {(x: number, y: number, z: number) => string|null} getBlockName
 * @param {{x: number, y: number, z: number}} origin
 * @param {{radius?: number}} [options] default radius 24
 * @returns {object} as scanFarm; reasons not_loaded, no_ground, not_enclosed, no_fence, farmland
 * @throws {TypeError} when getBlockName is not a function or the origin has no finite x, y, z
 */
export function scanPen(getBlockName, origin, options = {}) {
    // v0.1.4.11 (I5): the fenced case of the one scan; the result is that of v0.1.4.10
    return scanEnclosure(getBlockName, origin, { ...(options ?? {}), mode: 'ground', type: 'pen', fn: 'scanPen' }).scan;
}

/**
 * The scan of an area without a type (v0.1.4.10, T3-6): `!rememberArea("chicken pen")` typed inside a pen saved the
 * house beyond its fence, because the fence is built blocks too. When the position stands inside a fenced
 * enclosure (scanPen finds one around it) the result is that pen; otherwise it is the scan of the building
 * (scanBuilding with `options`), as before.
 * @param {(x: number, y: number, z: number) => string|null} getBlockName
 * @param {{x: number, y: number, z: number}} origin
 * @param {object} [options] as scanBuilding
 * @returns {object} the result of scanPen or of scanBuilding, plus `kind`: 'pen' or 'building'
 * @throws {TypeError} when getBlockName is not a function or the origin has no finite x, y, z
 */
export function scanWithoutType(getBlockName, origin, options = {}) {
    checkArgs(getBlockName, origin, 'scanWithoutType');
    const pen = scanPen(getBlockName, origin);
    if (pen.found) {
        return { ...pen, kind: 'pen' };
    }
    return { ...scanBuilding(getBlockName, origin, options ?? {}), kind: 'building' };
}

// --- the enclosure: one scan for every place (v0.1.4.11, I5) --------------------------------

/**
 * The kinds of the border of an enclosure; null when nothing made bounds it. v0.1.4.12 (F1): 'rock', the border of a
 * tunnel or a cave (a place that scanEnclosure gives with found false, see there).
 */
export const ENCLOSURE_BORDERS = Object.freeze(['fence', 'wall', 'glass', 'hedge', 'water', 'mixed', 'rock']);

/** The kinds of an opening of an enclosure. A gap is a doorway without a door in the wall of a building. */
export const OPENING_KINDS = Object.freeze(['door', 'gate', 'trapdoor', 'gap']);

/** The kinds of the floor of an enclosure. */
export const FLOOR_KINDS = Object.freeze(['tilled', 'built', 'ground', 'mixed']);

// The kinds that a player builds a border of. 'natural' (rock, dirt of a hill) and 'drop' (a hole, a cliff)
// bound ground too, but they make no enclosure on their own.
const MADE_BORDERS = ['fence', 'wall', 'glass', 'hedge', 'water'];

// A cell has a roof when a block that is not passable lies 1 to this many blocks above its ground.
const ENCLOSURE_ROOF = 8;

// The border is of one kind when that kind holds at least 2 of 3 of the made border columns.
const BORDER_SHARE = 2 / 3;

// The floor is tilled when at least 1 of 3 of its cells is farmland (paths and water between the rows).
const TILLED_SHARE = 1 / 3;

function isLeaves(name) {
    return name.endsWith('_leaves');
}

function isGlass(name) {
    return name.includes('glass');
}

function isDoorName(name) {
    return name.endsWith('_door');
}

// What bounds the ground at the column x, z beside a cell whose feet are at `feet`: { kind, opening }.
// kind: fence, wall, glass, hedge, water, natural or drop; opening: a gate, a door or a trapdoor, else null.
function boundOf(read, x, z, feet) {
    const below = read(x, feet - 1, z);
    const at = read(x, feet, z);
    const head = read(x, feet + 1, z);
    for (const [name, y] of [[at, feet], [below, feet - 1]]) {
        if (name !== null && name.endsWith('_fence_gate')) {
            return { kind: 'fence', opening: { x, y, z, kind: 'gate' } };
        }
    }
    if ((at !== null && isFenceLike(at)) || (below !== null && isFenceLike(below))) {
        return { kind: 'fence', opening: null };
    }
    if (at !== null && isDoorName(at)) {
        return { kind: 'wall', opening: { x, y: below === at ? feet - 1 : feet, z, kind: 'door' } };
    }
    if (head !== null && isDoorName(head)) {
        return { kind: 'wall', opening: { x, y: feet + 1, z, kind: 'door' } };
    }
    for (const [name, y] of [[at, feet], [head, feet + 1]]) {
        if (name !== null && isTrapdoorName(name)) {
            return { kind: 'wall', opening: { x, y, z, kind: 'trapdoor' } };
        }
    }
    // the block at the feet decides; the block at the head when the feet are open (a window over a wall counts as wall)
    const main = at !== null && !isPassable(at) ? at : head;
    if (main !== null && isLeaves(main)) {
        return { kind: 'hedge', opening: null };
    }
    if (main !== null && isGlass(main)) {
        return { kind: 'glass', opening: null };
    }
    if (at === 'water' || below === 'water') {
        return { kind: 'water', opening: null };
    }
    const solid = [at, head].find(name => name === null || !isPassable(name));
    if (solid !== undefined) {
        return { kind: solid !== null && (isBuiltBlock(solid) || isLogBlock(solid)) ? 'wall' : 'natural', opening: null };
    }
    return { kind: 'drop', opening: null };
}

// The border of the counts of bounding columns: the made kind of 2 of 3 of the made columns, else 'mixed';
// null when no made column bounds the ground or the made ones are fewer than half of all.
function borderOf(counts) {
    let made = 0;
    let total = 0;
    let best = null;
    for (const [kind, n] of Object.entries(counts)) {
        total += n;
        if (MADE_BORDERS.includes(kind)) {
            made += n;
            if (best === null || n > counts[best]) {
                best = kind;
            }
        }
    }
    if (made === 0 || made * 2 < total) {
        return null;
    }
    return counts[best] >= made * BORDER_SHARE ? best : 'mixed';
}

function floorOf(tilled, built, cells) {
    if (cells <= 0) {
        return 'mixed';
    }
    if (tilled >= cells * TILLED_SHARE) {
        return 'tilled';
    }
    if (built * 2 > cells) {
        return 'built';
    }
    return (cells - tilled - built) * 2 > cells ? 'ground' : 'mixed';
}

// The class of the block a cell stands on, for floorOf.
function floorClass(name) {
    if (name === 'farmland') {
        return 'tilled';
    }
    return name !== null && isBuiltBlock(name) ? 'built' : 'ground';
}

function hasRoof(read, x, ground, z) {
    for (let y = ground + 1; y <= ground + ENCLOSURE_ROOF; y++) {
        const name = read(x, y, z);
        if (name !== null && !isPassable(name)) {
            return true;
        }
    }
    return false;
}

function openingKey(o) {
    return `${o.x},${o.y},${o.z}`;
}

// The openings sorted by x, z, y, each once.
function sortedOpenings(list) {
    const seen = new Map();
    for (const o of list) {
        if (!seen.has(openingKey(o))) {
            seen.set(openingKey(o), { x: o.x, y: o.y, z: o.z, kind: o.kind });
        }
    }
    return [...seen.values()].sort(compareEntrances);
}

// The facts of ground that a flood closed: the border, the openings, the roof, the floor.
function groundFacts(read, flood) {
    const counts = {};
    const openings = [];
    for (const [x, z, surface] of flood.bounds) {
        const bound = boundOf(read, x, z, surface + 1);
        counts[bound.kind] = (counts[bound.kind] ?? 0) + 1;
        if (bound.opening) {
            openings.push(bound.opening);
        }
    }
    let tilled = 0;
    let built = 0;
    let roofed = 0;
    for (const [x, z, surface] of flood.cells) {
        const kind = floorClass(read(x, surface, z));
        if (kind === 'tilled') tilled++;
        else if (kind === 'built') built++;
        if (hasRoof(read, x, surface, z)) roofed++;
    }
    const cells = flood.cells.length;
    return { border: borderOf(counts), openings: sortedOpenings(openings), roof: cells > 0 && roofed * 2 >= cells,
        floor: floorOf(tilled, built, cells), fences: counts.fence ?? 0 };
}

// The cells of the ring of a box at `offset` blocks inside its sides, as [x, z].
function ringOf(box, offset) {
    const x0 = box.min.x + offset;
    const x1 = box.max.x - offset;
    const z0 = box.min.z + offset;
    const z1 = box.max.z - offset;
    const ring = [];
    if (x1 < x0 || z1 < z0) {
        return ring;
    }
    for (let x = x0; x <= x1; x++) {
        ring.push([x, z0]);
        if (z1 !== z0) ring.push([x, z1]);
    }
    for (let z = z0 + 1; z <= z1 - 1; z++) {
        ring.push([x0, z]);
        if (x1 !== x0) ring.push([x1, z]);
    }
    return ring;
}

// The facts of a building that the scan of a building found: its walls are the ring of its box (the box of the
// building is grown by 1, that of a floor holds the walls) that has more solid blocks at the feet of the origin.
// An open cell of the walls, feet and head, is a gap; open cells side by side are one gap.
function buildingFacts(read, scan, origin) {
    const feet = Math.floor(origin.y);
    const box = { min: scan.min, max: scan.max };
    const solidAt = ([x, z]) => {
        const name = read(x, feet, z);
        return name === null || !isPassable(name);
    };
    const rings = [ringOf(box, 0), ringOf(box, 1)];
    const ring = rings[1].filter(solidAt).length > rings[0].filter(solidAt).length ? rings[1] : rings[0];
    const counts = {};
    const gapCells = new Set();
    for (const [x, z] of ring) {
        const bound = boundOf(read, x, z, feet);
        if (bound.kind === 'drop') {
            const at = read(x, feet, z);
            const head = read(x, feet + 1, z);
            if (at !== null && head !== null && isOpenCell(at) && isOpenCell(head)) {
                gapCells.add(`${x},${z}`);
            }
            continue;
        }
        // a building of dirt or stone is walled too
        const kind = bound.kind === 'natural' ? 'wall' : bound.kind;
        counts[kind] = (counts[kind] ?? 0) + 1;
    }
    const gaps = [];
    const done = new Set();
    for (const [x, z] of ring) {
        const start = `${x},${z}`;
        if (!gapCells.has(start) || done.has(start)) {
            continue;
        }
        gaps.push({ x, y: feet, z, kind: 'gap' });
        const stack = [[x, z]];
        done.add(start);
        while (stack.length > 0) {
            const [cx, cz] = stack.pop();
            for (const [dx, dz] of SIDES) {
                const k = `${cx + dx},${cz + dz}`;
                if (gapCells.has(k) && !done.has(k)) {
                    done.add(k);
                    stack.push([cx + dx, cz + dz]);
                }
            }
        }
    }
    let cells = 0;
    let tilled = 0;
    let built = 0;
    let roofed = 0;
    for (let x = box.min.x + 1; x <= box.max.x - 1; x++) {
        for (let z = box.min.z + 1; z <= box.max.z - 1; z++) {
            const at = read(x, feet, z);
            if (at === null || !isPassable(at)) {
                continue;
            }
            cells++;
            const kind = floorClass(read(x, feet - 1, z));
            if (kind === 'tilled') tilled++;
            else if (kind === 'built') built++;
            if (hasRoof(read, x, feet - 1, z)) roofed++;
        }
    }
    return {
        border: borderOf(counts) ?? 'wall',
        openings: sortedOpenings([...(scan.entrances ?? []), ...gaps]),
        roof: cells > 0 ? roofed * 2 >= cells : hasRoof(read, Math.floor(origin.x), feet - 1, Math.floor(origin.z)),
        floor: floorOf(tilled, built, cells),
    };
}

function enclosureFound(min, max, facts, source, scan) {
    const openings = facts.openings;
    return {
        found: true,
        box: { min: { ...min }, max: { ...max } },
        border: facts.border,
        openings,
        roof: facts.roof,
        floor: facts.floor,
        reason: null,
        text: '',
        min: { ...min },
        max: { ...max },
        entrances: openings.filter(o => o.kind !== 'gap').map(o => ({ ...o })),
        source,
        scan,
    };
}

function enclosureNotFound(reason, text, scan) {
    return { found: false, box: null, border: null, openings: [], roof: false, floor: 'mixed', reason, text,
        min: null, max: null, entrances: [], source: null, scan };
}

// The ground of a flood that closed, as an enclosure, or null when nothing made bounds it.
function groundEnclosure(read, flood) {
    const facts = groundFacts(read, flood);
    if (facts.border === null) {
        return null;
    }
    const scan = fencedFound(flood, groundStats(read, flood.cells));
    return enclosureFound(scan.min, scan.max, facts, 'ground', scan);
}

function buildingEnclosure(getBlockName, read, origin, opts) {
    const scan = findBuilding(getBlockName, origin, opts);
    if (!scan.found) {
        return enclosureNotFound(scan.reason, scan.text, scan);
    }
    return enclosureFound(scan.min, scan.max, buildingFacts(read, scan, origin), 'building', scan);
}

// --- rock: a tunnel or a cave (v0.1.4.12, F1, F4) ---------------------------------------------

/** The border is rock when this share of the columns that bound the place, or more, is natural (F1). */
export const ROCK_SHARE = 2 / 3;

/** A tunnel is 1 or 2 wide and at least this many cells long (F1). */
export const TUNNEL_MIN_LENGTH = 4;

/** A scan that takes longer than this many milliseconds says how long it took (F4). */
export const SCAN_SLOW_MS = 2000;

// Under rock: the block over the head is natural and this many blocks above it are solid too (a roof is thinner).
const ROCK_ABOVE = 3;

// How far the measure of a cave looks from the feet to each side.
const CAVE_REACH = 16;

const DIR_STEPS = Object.freeze({ north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] });

// The measure of a tunnel when the options of scanEnclosure give none (useTunnelMeasure).
let tunnelMeasure = null;

/**
 * The measure of a tunnel that scanEnclosure uses when its options give none (v0.1.4.12, F1): tunnelAt of the mining
 * pack (src/agent/packs/mining/mine_logic.js). area_sense.js registers it when it is loaded, so this module keeps
 * importing nothing. Without a measure a place in rock is a cave.
 * @param {Function|null} fn tunnelAt(getName, feet, options) => { ok: true, tunnel } | { ok: false, cause }; null
 *   removes it
 */
export function useTunnelMeasure(fn) {
    tunnelMeasure = typeof fn === 'function' ? fn : null;
}

/**
 * The text of a scan that took longer than 2 s (F4): `The scan took 3 s.`; '' for 2 s or less.
 * @param {number} ms
 * @returns {string}
 */
export function tookText(ms) {
    return Number.isFinite(ms) && ms > SCAN_SLOW_MS ? `The scan took ${Math.round(ms / 1000)} s.` : '';
}

// F4: one pass, every cell read once per scan: the names of getBlockName kept by x, y, z. A read that throws is null.
function cachedNames(getBlockName) {
    const cache = new Map();
    return (x, y, z) => {
        const key = `${x},${y},${z}`;
        if (cache.has(key)) {
            return cache.get(key);
        }
        let name = null;
        try {
            name = getBlockName(x, y, z);
        } catch {
            name = null;
        }
        cache.set(key, name);
        return name;
    };
}

// Rock, dirt, ore and the like: solid and not built, no log, no leaves, no glass, no liquid.
function isNaturalSolid(name) {
    return name !== null && !isPassable(name) && !isBuiltBlock(name) && !isLogBlock(name) && !isLeaves(name)
        && !isGlass(name) && name !== 'water' && name !== 'lava';
}

// True when the feet lie under rock: the first block that is not passable over the feet, within ENCLOSURE_ROOF, is
// natural and the ROCK_ABOVE blocks above it are solid. The roof of a house is built or thin; the sky is no roof.
function underRock(read, x, feet, z) {
    for (let y = feet + 1; y <= feet + ENCLOSURE_ROOF; y++) {
        const name = read(x, y, z);
        if (name === null) {
            return false;
        }
        if (isPassable(name)) {
            continue;
        }
        if (!isNaturalSolid(name)) {
            return false;
        }
        for (let k = 1; k <= ROCK_ABOVE; k++) {
            const above = read(x, y + k, z);
            if (above === null || isPassable(above)) {
                return false;
            }
        }
        return true;
    }
    return false;
}

// F1: natural for 2 of 3 of the columns or more.
function rockShare(counts) {
    let total = 0;
    for (const n of Object.values(counts)) {
        total += n;
    }
    return total >= 3 && (counts.natural ?? 0) >= total * ROCK_SHARE;
}

function addBound(counts, read, x, z, feet) {
    const kind = boundOf(read, x, z, feet).kind;
    counts[kind] = (counts[kind] ?? 0) + 1;
}

// A cell a player stands in: feet and head passable.
function standCell(read, x, y, z) {
    const feet = read(x, y, z);
    const head = read(x, y + 1, z);
    return feet !== null && head !== null && isPassable(feet) && isPassable(head);
}

function cellOfPoint(p) {
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)
        ? { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) } : null;
}

// The tunnel at the origin (F1): the measure (tunnelAt of the mining pack) asked for TUNNEL_MIN_LENGTH cells; when the
// corridor ahead opens wider than 2 (a room), it is measured again away from that cell. null without a tunnel 1 or 2
// wide and 4 long or more.
function tunnelHere(read, origin, measure) {
    if (typeof measure !== 'function') {
        return null;
    }
    const feet = cellOfPoint(origin);
    const ask = (more) => {
        try {
            const r = measure(read, feet, { minCells: TUNNEL_MIN_LENGTH, ...more });
            return r && typeof r === 'object' ? r : null;
        } catch {
            return null;
        }
    };
    let r = ask({});
    if (r && r.ok !== true && r.cause?.kind === 'wide' && cellOfPoint(r.cause.at)) {
        r = ask({ anchor: cellOfPoint(r.cause.at) });
    }
    const t = r?.ok === true ? r.tunnel : null;
    const start = cellOfPoint(t?.start);
    const end = cellOfPoint(t?.end);
    if (!t || !start || !end || !Object.hasOwn(DIR_STEPS, t.dir) || !Number.isInteger(t.length) || t.length < TUNNEL_MIN_LENGTH
        || !(t.width === 1 || t.width === 2)) {
        return null;
    }
    return { start, end, dir: t.dir, length: t.length, width: t.width, level: Number.isFinite(t.level) ? Math.floor(t.level) : feet.y };
}

// The walls of a measured tunnel (the first column beside each cell that is no cell to stand in, on both sides, and the
// rock face beyond its end) and its box: the cells and their twins grown by 1, from its floor to its ceiling.
function tunnelPlace(read, tunnel) {
    const [dx, dz] = DIR_STEPS[tunnel.dir];
    const [sx, sz] = [dz, -dx];
    const feet = tunnel.level;
    const counts = {};
    let minX = tunnel.start.x;
    let maxX = tunnel.start.x;
    let minZ = tunnel.start.z;
    let maxZ = tunnel.start.z;
    const take = (x, z) => {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
    };
    for (let k = 0; k < tunnel.length; k++) {
        const x = tunnel.start.x + dx * k;
        const z = tunnel.start.z + dz * k;
        take(x, z);
        for (const side of [1, -1]) {
            let n = 1;
            while (n <= 2 && standCell(read, x + side * sx * n, feet, z + side * sz * n)) {
                take(x + side * sx * n, z + side * sz * n);
                n++;
            }
            addBound(counts, read, x + side * sx * n, z + side * sz * n, feet);
        }
    }
    const last = { x: tunnel.start.x + dx * (tunnel.length - 1), z: tunnel.start.z + dz * (tunnel.length - 1) };
    addBound(counts, read, last.x + dx, last.z + dz, feet);
    return { counts, box: { min: { x: minX - 1, y: feet - 1, z: minZ - 1 }, max: { x: maxX + 1, y: feet + 2, z: maxZ + 1 } } };
}

// The measure of a cave at the feet (F2): the open cells in a row from the feet to each side, the width (the longer of
// the two rows), the sides of that rectangle beyond which a cell to stand in lies (one block up or down too), the box
// from the floor to the roof over the feet.
function cavePlace(read, origin) {
    const at = cellOfPoint(origin);
    const run = (dx, dz) => {
        let n = 0;
        while (n < CAVE_REACH && standCell(read, at.x + dx * (n + 1), at.y, at.z + dz * (n + 1))) {
            n++;
        }
        return n;
    };
    const x0 = at.x - run(-1, 0);
    const x1 = at.x + run(1, 0);
    const z0 = at.z - run(0, -1);
    const z1 = at.z + run(0, 1);
    const openAt = (x, z) => [at.y - 1, at.y, at.y + 1].some(y => standCell(read, x, y, z));
    const row = (z) => Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, z]);
    const column = (x) => Array.from({ length: z1 - z0 + 1 }, (_, i) => [x, z0 + i]);
    const sides = [row(z0 - 1), column(x1 + 1), row(z1 + 1), column(x0 - 1)]
        .filter(cells => cells.some(([x, z]) => openAt(x, z))).length;
    let top = at.y + 1;
    while (top < at.y + ENCLOSURE_ROOF) {
        const name = read(at.x, top + 1, at.z);
        if (name === null || !isPassable(name)) {
            break;
        }
        top++;
    }
    return {
        at,
        width: Math.max(x1 - x0 + 1, z1 - z0 + 1),
        sides,
        box: { min: { x: x0 - 1, y: at.y - 1, z: z0 - 1 }, max: { x: x1 + 1, y: top + 1, z: z1 + 1 } },
    };
}

// A place in rock (F1): found false (nothing of !rememberArea without a type), with its box, the border 'rock', the
// reason and the text of the refusal, and the facts of the tunnel or the cave.
function rockFound(kind, box, facts) {
    return {
        found: false,
        box: { min: { ...box.min }, max: { ...box.max } },
        border: 'rock',
        openings: [],
        roof: true,
        floor: 'ground',
        reason: kind,
        text: scanText(kind),
        min: { ...box.min },
        max: { ...box.max },
        entrances: [],
        source: 'rock',
        scan: null,
        tunnel: kind === 'tunnel' ? facts : null,
        cave: kind === 'cave' ? facts : null,
    };
}

// The place in rock at the origin, or null (F1): a tunnel that the measure accepts and whose walls are natural for 2
// of 3 or more; else, when the columns that bound the ground of the flood are natural for 2 of 3 or more and the box of
// the cave shows no use (F7: no door, trapdoor, bed, chest, barrel, furnace, crafting table or ladder), a cave. A
// corridor whose walls a player built is no tunnel and no cave.
function rockPlace(read, origin, bounds, measure) {
    const tunnel = tunnelHere(read, origin, measure);
    if (tunnel) {
        const place = tunnelPlace(read, tunnel);
        return rockShare(place.counts) ? rockFound('tunnel', place.box, tunnel) : null;
    }
    const counts = {};
    for (const [x, z, surface] of bounds) {
        addBound(counts, read, x, z, surface + 1);
    }
    if (!rockShare(counts)) {
        return null;
    }
    const cave = cavePlace(read, origin);
    if (showsUse(read, cave.box)) {
        return null; // v0.1.4.12 (F7): a dug room that is lived in (a basement, the room of a mine) goes the old way
    }
    return rockFound('cave', cave.box, { at: cave.at, width: cave.width, sides: cave.sides });
}

// v0.1.4.12 (F7): the blocks that show that a place in rock is used: a door or a trapdoor in its border or roof, a
// bed, a chest or a barrel, a furnace (blast furnace, smoker), a crafting table, a ladder. Torches do not count.
const USE_NAMES = new Set(['chest', 'trapped_chest', 'barrel', 'furnace', 'blast_furnace', 'smoker', 'crafting_table', 'ladder']);

function isUseName(name) {
    return name !== null && (USE_NAMES.has(name) || name.endsWith('_bed') || isDoorName(name) || isTrapdoorName(name));
}

// True when a block of use lies in the box of a cave (its walls, floor and roof included).
function showsUse(read, box) {
    for (let x = box.min.x; x <= box.max.x; x++) {
        for (let y = box.min.y; y <= box.max.y; y++) {
            for (let z = box.min.z; z <= box.max.z; z++) {
                if (isUseName(read(x, y, z))) {
                    return true;
                }
            }
        }
    }
    return false;
}

/**
 * The enclosure around a position (v0.1.4.11, I5): the one scan of a place, whatever bounds it: a fence, a wall,
 * glass, a hedge, water, or a mix of them. Pure, like the other scans.
 *
 * Mode 'auto' (the default): first the ground around the origin as scanPen floods it (the ground at the height of the
 * origin, one block up or down, to the four sides). When that ground is closed, made blocks bound at least half of
 * it (fences, gates and walls, built blocks, glass, leaves, water; not rock or dirt of a hill, not a hole), and fewer
 * than half of its cells have a roof, it is the enclosure (source 'ground', the box of scanPen). When it leaks, it is
 * flooded again with water as a border (a pond, a moat). Ground with a roof over half of it, or an origin under a
 * roof when the ground leaks, is a building: the scan of scanBuilding (with `floors`, the floor of the origin), its
 * walls classified (source 'building'). Mode 'ground': the scan of scanPen or scanFarm (`type` 'pen', 'farm' or
 * none); mode 'building': the scan of scanBuilding. In these two modes `scan` is the result of v0.1.4.10.
 *
 * The border: the kind of 2 of 3 of the made columns that bound the ground (a wall of a building of dirt or stone is
 * a wall too), else 'mixed'. The openings: fence gates, doors (the lower block) and trapdoors in the border, and for
 * a building the trapdoors of its floor scan and its gaps (open doorways). The roof: half or more of the cells have a
 * block 1 to 8 above their ground. The floor: 'tilled' when 1 of 3 of the cells or more is farmland, else 'built' or
 * 'ground' for more than half, else 'mixed'.
 *
 * v0.1.4.12 (F1): in mode 'auto', when the origin lies under rock (a natural block over the head with 3 solid blocks
 * above it) and no made border closes the ground, the place is rock: a tunnel when the measure of a tunnel (tunnelAt of
 * the mining pack, `options.tunnelAt` or useTunnelMeasure) accepts the origin, 1 or 2 wide and 4 long or more, and its
 * walls are natural for 2 of 3 or more; else a cave when the columns that bound the ground of the flood are natural for
 * 2 of 3 or more and its box holds no door, trapdoor, bed, chest, barrel, furnace, crafting table or ladder (F7: a
 * basement or the room of a mine goes the old way). Such a place has `found: false`, `border: 'rock'`, `reason` 'tunnel' or 'cave', `source` 'rock', the
 * text of the refusal of !rememberArea without a type, its box (the tunnel or the cave, from the floor to the roof),
 * and `tunnel` ({ start, end, dir, length, width, level }) or `cave` ({ at, width, sides }).
 * F4: every cell is read once per scan; a scan over 2 s gets `ms`, `took` (`The scan took 3 s.`) and the took text
 * appended to a text that is not empty.
 *
 * @param {(x: number, y: number, z: number) => string|null} getBlockName
 * @param {{x: number, y: number, z: number}} origin usually the position of the bot
 * @param {{mode?: 'auto'|'ground'|'building', radius?: number, floors?: boolean, type?: 'pen'|'farm',
 *   tunnelAt?: Function|null, now?: () => number}} [options]
 *   radius 24 for the ground; floors and the other options of scanBuilding for a building; tunnelAt: the measure of a
 *   tunnel (null: none); now: the clock of the time a scan takes (Date.now)
 * @returns {{found: boolean, box: {min: object, max: object}|null, border: string|null,
 *   openings: {x: number, y: number, z: number, kind: 'door'|'gate'|'trapdoor'|'gap'}[], roof: boolean,
 *   floor: 'tilled'|'built'|'ground'|'mixed', reason: string|null, text: string, min: object|null, max: object|null,
 *   entrances: object[], source: 'ground'|'building'|null, scan: object|null}}
 *   reason when not found: not_loaded, no_ground, not_enclosed (a fence that does not close), no_border (nothing made
 *   bounds the place), or a reason of scanBuilding, scanPen, scanFarm in their modes; text: scanText of it. min, max:
 *   the box again; entrances: the openings without the gaps, for the area store; scan: the result of the scan below.
 * @throws {TypeError} when getBlockName is not a function or the origin has no finite x, y, z
 */
export function scanEnclosure(getBlockName, origin, options = {}) {
    const opts = options ?? {};
    checkArgs(getBlockName, origin, typeof opts.fn === 'string' ? opts.fn : 'scanEnclosure');
    // v0.1.4.12 (F4): one pass, each cell read once; a scan over 2 s says how long it took
    const clock = typeof opts.now === 'function' ? opts.now : Date.now;
    const started = clock();
    const result = enclosureOf(cachedNames(getBlockName), origin, opts);
    const ms = clock() - started;
    const took = tookText(ms);
    if (took) {
        result.ms = ms;
        result.took = took;
        result.text = result.text ? `${result.text} ${took}` : result.text;
    }
    return result;
}

// The body of scanEnclosure, after checkArgs, with the reads of one scan kept (cachedNames).
function enclosureOf(getBlockName, origin, opts) {
    const read = reader(getBlockName);
    if (opts.mode === 'building') {
        return buildingEnclosure(getBlockName, read, origin, opts);
    }
    if (opts.mode === 'ground') {
        const type = opts.type === 'pen' || opts.type === 'farm' ? opts.type : null;
        const { scan, flood } = fencedScan(read, origin, opts, type);
        if (!flood) {
            return enclosureNotFound(scan.reason, scan.text, scan);
        }
        const facts = groundFacts(read, flood);
        return enclosureFound(scan.min, scan.max, { ...facts, border: facts.border ?? 'mixed' }, 'ground', scan);
    }
    const radius = positiveInt(opts.radius, FARM_DEFAULTS.radius);
    const info = { radius };
    let fences = 0;
    let unloaded = false;
    let roofed = null;
    let made = false; // the first flood closed and made blocks bound it
    const first = floodFenced(read, origin, radius, Infinity);
    if (first.reason === null) {
        const ground = groundEnclosure(read, first);
        if (ground && !ground.roof) {
            return ground;
        }
        roofed = ground;
        made = ground !== null;
    } else if (first.reason === 'not_enclosed') {
        fences = first.fences;
        const second = floodFenced(read, origin, radius, Infinity, { water: true });
        if (second.reason === null) {
            const ground = groundEnclosure(read, second);
            if (ground && !ground.roof) {
                return ground;
            }
            roofed = ground;
        }
        unloaded = second.reason === 'not_loaded';
    } else if (first.reason === 'no_ground') {
        return enclosureNotFound('no_ground', scanText('no_ground', info), null);
    } else {
        unloaded = true;
    }
    const ox = Math.floor(origin.x);
    const oz = Math.floor(origin.z);
    const feet = Math.floor(origin.y);
    // v0.1.4.12 (F1): under rock, ground bounded by natural rock is a tunnel or a cave, never a building
    if (!made && (first.reason === null || first.reason === 'not_enclosed') && underRock(read, ox, feet, oz)) {
        const rock = rockPlace(read, origin, first.bounds, Object.hasOwn(opts, 'tunnelAt') ? opts.tunnelAt : tunnelMeasure);
        if (rock) {
            return rock;
        }
    }
    if (roofed || hasRoof(read, ox, feet - 1, oz)) {
        const building = buildingEnclosure(getBlockName, read, origin, opts);
        if (building.found) {
            return building;
        }
    }
    if (roofed) {
        return roofed; // a roof over most of it, but no building: the ground all the same
    }
    const reason = unloaded ? 'not_loaded' : (fences > 0 ? 'not_enclosed' : 'no_border');
    return enclosureNotFound(reason, scanText(reason, info), null);
}

// A fence, fence gate or wall block within `reach` blocks in x and z, 2 below the feet to 1 above.
function fenceWithin(read, px, py, pz, reach) {
    for (let dx = -reach; dx <= reach; dx++) {
        for (let dz = -reach; dz <= reach; dz++) {
            for (let y = py - 2; y <= py + 1; y++) {
                const name = read(px + dx, y, pz + dz);
                if (name !== null && isFenceLike(name)) {
                    return true;
                }
            }
        }
    }
    return false;
}

function nearestGate(entrances, pos) {
    let best = null;
    let bestDistance = Infinity;
    for (const gate of entrances) {
        const d = (gate.x + 0.5 - pos.x) ** 2 + (gate.y - pos.y) ** 2 + (gate.z + 0.5 - pos.z) ** 2;
        if (d < bestDistance) {
            best = gate;
            bestDistance = d;
        }
    }
    return best ? { x: best.x, y: best.y, z: best.z } : null;
}

const pointText = (p) => `(${p.x}, ${p.y}, ${p.z})`;

/**
 * The fenced ground at or near a position (v0.1.4.8, D5). First the ground at the position itself.
 * When the position is outside, on the fence or in the gate, the walkable cells within `range` are
 * tried, nearest first, and the first ground that is enclosed (and of the type, when one is given)
 * is returned, with the gate nearest to the position. Ground wider than an area (62 blocks inside
 * the fence) does not count.
 *
 * Reasons when nothing is found: the reason of the ground at the position when it is enclosed but of
 * another type (no_fence, no_crops, roofed, farmland); no_fence_near (no fence, gate or wall block
 * within range); the reason of the nearest enclosed ground of another type; too_big (a fence that
 * closes, but farther than an area reaches); not_closed; not_loaded; no_ground.
 *
 * @param {(x: number, y: number, z: number) => string|null} getBlockName
 * @param {{x: number, y: number, z: number}} pos usually the position of the bot
 * @param {number} [range] default 6, at most 16
 * @param {{type?: 'farm'|'pen'}} [options] type: the rules of scanFarm or scanPen; none: any fenced ground
 * @returns {{found: boolean, reason: string|null, text: string, min: object|null, max: object|null, cells: number,
 *   entrances: object[], gate: {x: number, y: number, z: number}|null, start: {x: number, y: number, z: number}|null,
 *   inside: boolean}}
 *   inside: the position is on the ground found. start: a block to stand in on the ground found.
 *   gate: the gate nearest to the position. text: '' when inside, else
 *   `I stand outside the fence. The gate is at (x, y, z). I can save the ground behind it.`;
 *   for a failure, what to do (scanText).
 * @throws {TypeError} when getBlockName is not a function or the position has no finite x, y, z
 */
export function findFencedGroundNear(getBlockName, pos, range = NEAR_DEFAULT, options = {}) {
    checkArgs(getBlockName, pos, 'findFencedGroundNear');
    const reach = Number.isFinite(range) && range >= 0 ? Math.min(Math.floor(range), NEAR_MAX) : NEAR_DEFAULT;
    const type = options?.type === 'farm' || options?.type === 'pen' ? options.type : null;
    const read = reader(getBlockName);
    const px = Math.floor(pos.x);
    const py = Math.floor(pos.y);
    const pz = Math.floor(pos.z);
    const seen = new Set();
    const leaked = [];
    let otherType = null;
    let unloaded = false;

    const fail = (reason) => ({ found: false, reason, text: scanText(reason, { range: reach, what: whatOf(type) }),
        min: null, max: null, cells: 0, entrances: [], gate: null, start: null, inside: false });

    // null, or the result when the ground from x, z is enclosed and of the type
    const attempt = (x, z) => {
        const flood = floodFenced(read, { x, y: pos.y, z }, MAX_SPAN, MAX_SPAN);
        for (const key of flood.visited) {
            seen.add(key);
        }
        if (flood.reason === 'not_enclosed') {
            leaked.push({ x, y: pos.y, z });
        } else if (flood.reason === 'not_loaded') {
            unloaded = true;
        }
        if (flood.reason) {
            return { flood, result: null };
        }
        const stats = groundStats(read, flood.cells);
        const failure = typeFailure(flood, stats, type);
        if (failure) {
            otherType ??= failure;
            return { flood, result: null };
        }
        const result = fencedFound(flood, stats);
        const [cx, cz, surface] = flood.cells[0];
        result.gate = nearestGate(result.entrances, pos);
        result.start = { x: cx, y: surface + 1, z: cz };
        return { flood, result };
    };

    const own = attempt(px, pz);
    if (own.result) {
        own.result.inside = true;
        return own.result;
    }
    const ownFailure = otherType;
    if (!fenceWithin(read, px, py, pz, reach)) {
        return fail(ownFailure ?? 'no_fence_near');
    }
    const candidates = [];
    for (let dx = -reach; dx <= reach; dx++) {
        for (let dz = -reach; dz <= reach; dz++) {
            const d = Math.hypot(dx, dz);
            if (d > 0 && d <= reach) {
                candidates.push({ x: px + dx, z: pz + dz, d });
            }
        }
    }
    candidates.sort((a, b) => a.d - b.d || a.x - b.x || a.z - b.z);
    for (const c of candidates) {
        if (seen.has(`${c.x},${c.z}`)) {
            continue;
        }
        const { result } = attempt(c.x, c.z);
        if (result) {
            result.inside = false;
            const gateOfBot = own.flood.barrier?.gate ?? null;
            if (gateOfBot) {
                result.text = `I stand in the gate at ${pointText(gateOfBot)}. I can save the ground behind it.`;
            } else if (result.gate) {
                result.text = `I stand outside the fence. The gate is at ${pointText(result.gate)}. I can save the ground behind it.`;
            } else {
                result.text = 'I stand outside the fence, and it has no gate. I can save the ground behind it.';
            }
            return result;
        }
    }
    if (ownFailure) {
        return fail(ownFailure);
    }
    if (otherType) {
        return fail(otherType);
    }
    if (leaked.length > 0) {
        const closes = leaked.slice(0, EXTENDED_CHECKS)
            .some(start => floodFenced(read, start, EXTENDED_SPAN, EXTENDED_SPAN).reason === null);
        return fail(closes ? 'too_big' : 'not_closed');
    }
    return fail(unloaded ? 'not_loaded' : 'no_ground');
}
