// Where the ground is around the bot, and how deep the bot is under it (spec v0.1.4.8, A7 and I2).
// Pure: the world is read through getBlockName(x, y, z), which returns the name of a block, or null
// for a block that is not loaded. The column of the bot itself is not read: in a shaft it is air and
// ladders, which cannot be told from open sky. The 8 columns 4 blocks around it are the rock of the
// shaft, or the open ground next to the bot.
import { isBuiltBlock, isLogBlock } from '../areas/area_scan.js';

// The columns around the bot, as (x, z) offsets.
export const GROUND_OFFSETS = Object.freeze([[4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [3, -3], [-3, 3], [-3, -3]]
    .map(offset => Object.freeze(offset)));
export const MIN_COLUMNS = 3;       // with fewer known columns the ground is unknown
export const UNDERGROUND_DEPTH = 8; // deeper than this is underground
const WORLD_HEIGHT = 384;           // from the height limit down to the bottom of the overworld
export const FLOOR_OVER_SURFACE = 1; // v0.1.4.11 (F25): a built floor counts up to this far above the natural surface

const AIR = new Set(['air', 'cave_air', 'void_air']);

// Plants without collision: the ground is the block under them.
const PLANTS = new Set(['short_grass', 'grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'bush', 'firefly_bush',
    'short_dry_grass', 'tall_dry_grass', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'oxeye_daisy',
    'cornflower', 'lily_of_the_valley', 'wither_rose', 'torchflower', 'open_eyeblossom', 'closed_eyeblossom',
    'cactus_flower', 'sunflower', 'lilac', 'rose_bush', 'peony', 'pitcher_plant', 'pink_petals', 'wildflowers',
    'leaf_litter', 'wheat', 'carrots', 'potatoes', 'beetroots', 'melon_stem', 'pumpkin_stem', 'attached_melon_stem',
    'attached_pumpkin_stem', 'torchflower_crop', 'pitcher_crop', 'nether_wart', 'sweet_berry_bush', 'sugar_cane',
    'vine', 'cave_vines', 'cave_vines_plant', 'weeping_vines', 'weeping_vines_plant', 'twisting_vines',
    'twisting_vines_plant', 'glow_lichen', 'hanging_roots', 'pale_hanging_moss', 'seagrass', 'tall_seagrass', 'kelp',
    'kelp_plant', 'brown_mushroom', 'red_mushroom', 'crimson_fungus', 'warped_fungus', 'crimson_roots', 'warped_roots',
    'nether_sprouts', 'spore_blossom', 'small_dripleaf', 'big_dripleaf_stem', 'mangrove_propagule']);
const PLANT_ENDINGS = ['_sapling', '_tulip'];

// Grown like a tree, with a stem that stands in the air: counted like a log.
const TREE_LIKE = new Set(['bamboo', 'mangrove_roots', 'brown_mushroom_block', 'red_mushroom_block', 'mushroom_stem']);

function baseName(name) {
    return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

/**
 * True for a block that is ground: none of air, leaves, a log (or a stem like bamboo), a built block
 * (isBuiltBlock of area_scan.js), a plant without collision.
 * @param {string} name
 * @returns {boolean}
 */
export function isGroundName(name) {
    if (typeof name !== 'string' || name === '')
        return false;
    const n = baseName(name);
    if (AIR.has(n) || n.endsWith('_leaves') || isLogBlock(n) || TREE_LIKE.has(n) || isBuiltBlock(n))
        return false;
    return !PLANTS.has(n) && !PLANT_ENDINGS.some(ending => n.endsWith(ending));
}

// Built blocks that are no floor to stand under: thin ones, borders, things a player walks through.
const THIN_BUILT_PARTS = ['_door', 'fence', 'wall', 'pane', 'bars', 'ladder', 'torch', 'lantern', 'rail', 'carpet', 'sign',
    'banner', 'button', 'pressure_plate', 'lever', 'flower_pot', 'potted_', 'scaffolding', 'chain', 'campfire', 'bell', '_bed'];

/**
 * True for a built block that is a floor (v0.1.4.11, F25): a built block (isBuiltBlock of area_scan.js) that is not
 * thin: no door, fence, wall, pane, bars, ladder, torch, lantern, rail, carpet, sign, banner, button, pressure plate,
 * lever, flower pot, scaffolding, chain, campfire, bell or bed. Planks, cobblestone, bricks, slabs, stairs, glass and
 * trapdoors are.
 * @param {string} name
 * @returns {boolean}
 */
export function isBuiltFloorName(name) {
    if (typeof name !== 'string' || name === '')
        return false;
    const n = baseName(name);
    return isBuiltBlock(n) && !THIN_BUILT_PARTS.some(part => n.includes(part));
}

// One column, from top - 1 down to bottom: { ground, built } with the y of its natural ground (isGroundName) and the
// ys of the built floor blocks above it, highest first; null when a block of the column is not loaded before the
// ground or the column has no ground.
function columnGround(getBlockName, x, z, top, bottom) {
    const built = [];
    for (let y = top - 1; y >= bottom; y--) {
        let name;
        try {
            name = getBlockName(x, y, z);
        } catch {
            name = null;
        }
        if (typeof name !== 'string')
            return null;
        if (isGroundName(name))
            return { ground: y, built };
        if (isBuiltFloorName(name))
            built.push(y);
    }
    return null;
}

// The level of a column: its natural ground, or the highest built floor block of it at most FLOOR_OVER_SURFACE above
// the surface (v0.1.4.11, F25): a floor laid into or onto the ground over a cellar counts, a house or a roof on the
// ground does not.
function columnLevel(column, surface) {
    const floor = column.built.find(y => y <= surface + FLOOR_OVER_SURFACE);
    return floor !== undefined && floor > column.ground ? floor : column.ground;
}

// The median; with an even number of values the lower of the two middle ones (decision of the tech
// lead): at the foot of a cliff with 4 high and 4 low columns the bot is on the surface.
function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.ceil(sorted.length / 2) - 1];
}

/**
 * The ground level around pos: the median of the ground of the 8 columns at the offsets (4,0) (-4,0)
 * (0,4) (0,-4) (3,3) (3,-3) (-3,3) (-3,-3). The ground of a column is the y of the highest block, from
 * top - 1 down, that isGroundName; v0.1.4.11 (F25): or the y of a higher built floor block of the column
 * (isBuiltFloorName) at most 1 block above the surface, the highest natural ground of the known columns: the built
 * floor of a house over its cellar counts, a house or a roof standing on the ground does not. When every known
 * column lies inside the cellar (no natural surface among them), the floor is not seen. Columns that are
 * not loaded are left out. null with fewer than 3
 * known columns. With an even number of columns the median is the lower of the two middle ones, so with
 * 8 known columns the bot is more than 8 blocks deep only when 5 of them are.
 * @param {Function} getBlockName (x, y, z) => name | null
 * @param {{x,y,z}} pos the position of the bot
 * @param {number} top the height limit of the world (minY + height)
 * @param {number} [bottom] the lowest y that is read, by default top - 384
 * @returns {number|null}
 */
export function groundLevelAround(getBlockName, pos, top, bottom = top - WORLD_HEIGHT) {
    if (typeof getBlockName !== 'function' || !isPoint(pos) || !Number.isFinite(top))
        return null;
    const t = Math.floor(top);
    const b = Number.isFinite(bottom) ? Math.floor(bottom) : t - WORLD_HEIGHT;
    const bx = Math.floor(pos.x), bz = Math.floor(pos.z);
    const columns = [];
    for (const [dx, dz] of GROUND_OFFSETS) {
        const column = columnGround(getBlockName, bx + dx, bz + dz, t, b);
        if (column !== null)
            columns.push(column);
    }
    if (columns.length < MIN_COLUMNS)
        return null;
    const surface = Math.max(...columns.map(c => c.ground));
    return median(columns.map(c => columnLevel(c, surface)));
}

/**
 * How many blocks the feet of the bot are under the top of the ground around it: the ground level + 1
 * minus the floored y of the feet, 0 or more. A bot that stands on the ground has depth 0. 0 when the
 * ground is unknown.
 * @param {Function} getBlockName
 * @param {{x,y,z}} pos
 * @param {number} top
 * @param {number} [bottom]
 * @returns {number}
 */
export function depthUnderGround(getBlockName, pos, top, bottom = top - WORLD_HEIGHT) {
    const ground = groundLevelAround(getBlockName, pos, top, bottom);
    if (ground === null)
        return 0;
    return Math.max(0, ground + 1 - Math.floor(pos.y));
}

/**
 * Underground: deeper than 8 blocks.
 * @param {number} depth
 * @returns {boolean}
 */
export function isUnderground(depth) {
    return Number.isFinite(depth) && depth > UNDERGROUND_DEPTH;
}
