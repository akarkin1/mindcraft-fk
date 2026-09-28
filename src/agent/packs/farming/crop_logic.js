// The logic of the farming pack (spec v0.1.4.7 F1), pure: the crops, what may go into a
// composter, the jobs of one cell of a field and the order in which the bot visits the cells.

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * A name without the `minecraft:` prefix, trimmed and in lower case, or null.
 * @param {*} name
 * @returns {string|null}
 */
function baseName(name) {
    if (typeof name !== 'string') {
        return null;
    }
    const clean = name.trim().toLowerCase().replace(/^minecraft:/, '');
    return clean.length > 0 ? clean : null;
}

/**
 * The crops the pack knows: the crop block, the item that plants it, the age at which it is ripe
 * and the item it gives.
 * @type {ReadonlyArray<Readonly<{block: string, seed: string, ripeAge: number, harvest: string}>>}
 */
export const CROPS = Object.freeze([
    Object.freeze({ block: 'wheat', seed: 'wheat_seeds', ripeAge: 7, harvest: 'wheat' }),
    Object.freeze({ block: 'carrots', seed: 'carrot', ripeAge: 7, harvest: 'carrot' }),
    Object.freeze({ block: 'potatoes', seed: 'potato', ripeAge: 7, harvest: 'potato' }),
    Object.freeze({ block: 'beetroots', seed: 'beetroot_seeds', ripeAge: 3, harvest: 'beetroot' }),
]);

const BY_BLOCK = new Map(CROPS.map(row => [row.block, row]));
const ALIASES = new Map([
    ['wheat', 'wheat'], ['wheat_seeds', 'wheat'], ['seeds', 'wheat'],
    ['carrot', 'carrots'], ['carrots', 'carrots'],
    ['potato', 'potatoes'], ['potatoes', 'potatoes'],
    ['beetroot', 'beetroots'], ['beetroots', 'beetroots'], ['beetroot_seeds', 'beetroots'],
]);

/**
 * The row of CROPS for a crop block, a seed or a harvest item: `wheat`, `wheat_seeds`, `seeds`,
 * `carrot`, `carrots`, `potato`, `potatoes`, `beetroot`, `beetroots`, `beetroot_seeds`.
 * @param {string} name with or without `minecraft:`
 * @returns {Readonly<{block: string, seed: string, ripeAge: number, harvest: string}>|null}
 */
export function cropOf(name) {
    const block = ALIASES.get(baseName(name));
    return block ? BY_BLOCK.get(block) : null;
}

/**
 * True for the block of a crop of the table (`wheat`, `carrots`, `potatoes`, `beetroots`).
 * @param {string} name
 * @returns {boolean}
 */
export function isCropBlock(name) {
    return BY_BLOCK.has(baseName(name));
}

/**
 * The row for a crop block or a harvest item, null for a seed or anything else. For the old
 * command `!collectBlocks` (F3): `wheat`, `carrot` and `potatoes` mean a harvest, `wheat_seeds` does not.
 * @param {string} name
 * @returns {Readonly<{block: string, seed: string, ripeAge: number, harvest: string}>|null}
 */
export function harvestTarget(name) {
    const n = baseName(name);
    return CROPS.find(row => row.block === n || row.harvest === n) ?? null;
}

/**
 * The seed item for any name that cropOf accepts, null otherwise.
 * @param {string} name
 * @returns {string|null}
 */
export function seedFor(name) {
    return cropOf(name)?.seed ?? null;
}

function ageOf(age) {
    if (isFiniteNumber(age)) {
        return age;
    }
    if (typeof age === 'string' && /^\s*\d+\s*$/.test(age)) {
        return Number(age);
    }
    return NaN;
}

/**
 * True when a crop block has reached the ripe age of the table.
 * @param {string} blockName a crop block, for example `wheat`
 * @param {number|string} age the block property `age`
 * @returns {boolean}
 */
export function isRipe(blockName, age) {
    const row = BY_BLOCK.get(baseName(blockName));
    const a = ageOf(age);
    return Boolean(row) && Number.isFinite(a) && a >= row.ripeAge;
}

const LEAVES = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'azalea', 'flowering_azalea',
    'pale_oak'].map(w => `${w}_leaves`);
const SAPLINGS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'cherry', 'pale_oak'].map(w => `${w}_sapling`)
    .concat(['mangrove_propagule']);

/** Flowers the bot may compost and pick for that. The wither rose is not one of them. */
export const FLOWERS = Object.freeze(['dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip',
    'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'torchflower', 'open_eyeblossom',
    'closed_eyeblossom', 'sunflower', 'lilac', 'rose_bush', 'peony']);

const TALL_FLOWERS = new Set(['sunflower', 'lilac', 'rose_bush', 'peony']);

/**
 * Items the bot may put into a composter, with the chance in percent that one item raises the
 * level. Seeds, crops, food and bone meal are not in it: seeds are for planting. Nor is the hay
 * block: it is 9 wheat (Amendment 2, I3).
 * @type {Readonly<Object<string, number>>}
 */
export const COMPOSTABLE = Object.freeze(Object.assign(Object.create(null), {
    ...Object.fromEntries(LEAVES.map(n => [n, 30])),
    ...Object.fromEntries(SAPLINGS.map(n => [n, 30])),
    ...Object.fromEntries(FLOWERS.map(n => [n, 65])),
    short_grass: 30,
    fern: 65,
    leaf_litter: 30,
    moss_carpet: 30,
    vine: 50,
    cactus: 50,
    sugar_cane: 50,
    melon_slice: 50,
    pumpkin: 65,
}));

/**
 * True for an item of COMPOSTABLE.
 * @param {string} name
 * @returns {boolean}
 */
export function isCompostable(name) {
    const n = baseName(name);
    return n !== null && Object.prototype.hasOwnProperty.call(COMPOSTABLE, n);
}

// Weeds first, then saplings, then things a farm grows.
function compostRank(name) {
    if (SAPLINGS.includes(name)) {
        return 1;
    }
    return ['cactus', 'sugar_cane', 'melon_slice', 'pumpkin'].includes(name) ? 2 : 0;
}

/**
 * The item of the inventory that goes into the composter next: weeds, leaves and flowers first,
 * then saplings, then cactus, sugar cane, melon and pumpkin; ties by name.
 * @param {{name: string, count: number}[]} items
 * @returns {string|null} null when nothing in the list may be composted
 */
export function chooseCompostItem(items) {
    if (!Array.isArray(items)) {
        return null;
    }
    const names = [...new Set(items.filter(i => i && isFiniteNumber(i.count) && i.count > 0 && isCompostable(i.name))
        .map(i => baseName(i.name)))];
    names.sort((a, b) => compostRank(a) - compostRank(b) || (a < b ? -1 : a > b ? 1 : 0));
    return names[0] ?? null;
}

/**
 * True for a block the bot may break to get something to compost: a flower (of a tall flower
 * the lower half) always; `short_grass`, `fern` and leaves only with shears, because without
 * them they do not drop themselves. Leaves placed by a player (`persistent`) stay.
 * @param {string} blockName
 * @param {object} [properties] the block state
 * @param {boolean} [hasShears]
 * @returns {boolean}
 */
export function compostSource(blockName, properties = {}, hasShears = false) {
    const n = baseName(blockName);
    const props = properties && typeof properties === 'object' ? properties : {};
    if (n === null) {
        return false;
    }
    if (FLOWERS.includes(n)) {
        return !TALL_FLOWERS.has(n) || props.half !== 'upper';
    }
    if (!hasShears) {
        return false;
    }
    if (n === 'short_grass' || n === 'fern') {
        return true;
    }
    return LEAVES.includes(n) && props.persistent !== true && props.persistent !== 'true';
}

/** Ground that a hoe turns into farmland (coarse dirt first into dirt). */
export const TILLABLE = Object.freeze(['dirt', 'grass_block', 'coarse_dirt', 'dirt_path']);

const AIR = new Set(['air', 'cave_air', 'void_air']);

/**
 * True for `air`, `cave_air` and `void_air`.
 * @param {string} name
 * @returns {boolean}
 */
export function isAirName(name) {
    return AIR.has(baseName(name));
}

const HOES = ['netherite_hoe', 'diamond_hoe', 'iron_hoe', 'stone_hoe', 'golden_hoe', 'wooden_hoe'];

/**
 * The best hoe of a list of items, by material: netherite, diamond, iron, stone, golden, wooden.
 * @param {{name: string, count: number}[]} items
 * @returns {string|null}
 */
export function bestHoe(items) {
    if (!Array.isArray(items)) {
        return null;
    }
    const names = new Set(items.filter(i => i && (!isFiniteNumber(i.count) || i.count > 0)).map(i => baseName(i.name)));
    return HOES.find(h => names.has(h)) ?? null;
}

function amount(value) {
    if (value === true) {
        return 1;
    }
    return isFiniteNumber(value) && value > 0 ? value : 0;
}

// Seeds of the crop (a row), or of any crop when the row is null.
function seedCount(have, row) {
    const seeds = have?.seeds;
    if (seeds !== null && typeof seeds === 'object') {
        if (row) {
            return amount(seeds[row.seed]);
        }
        return Object.values(seeds).reduce((sum, v) => sum + amount(v), 0);
    }
    return amount(seeds);
}

/**
 * The jobs for one cell of a field, in the order to do them, out of `harvest`, `plant`, `till`
 * and `fertilize`:
 * - a ripe crop: `harvest`, then `plant` if a seed of that crop is there;
 * - an unripe crop: `fertilize` if bone meal is there, otherwise nothing;
 * - `farmland` with air above: `plant` if seeds are there;
 * - `dirt`, `grass_block`, `coarse_dirt` or `dirt_path` with air above, inside a farm area:
 *   `till` if a hoe is there, then `plant` if seeds are there;
 * - anything else: nothing.
 * @param {{ground: string, above: string, age?: number, inFarm?: boolean}} cell block names;
 *   inFarm (default true) false for a cell outside of a farm area
 * @param {{seeds?: number|boolean|Object<string, number>, hoe?: boolean|string|number, bone_meal?: number|boolean}} have
 *   seeds: a count, true, or counts by seed item (then a ripe crop needs its own seed)
 * @returns {string[]}
 */
export function cellPlan(cell, have) {
    if (!cell || typeof cell !== 'object') {
        return [];
    }
    const h = have && typeof have === 'object' ? have : {};
    const ground = baseName(cell.ground);
    const above = baseName(cell.above);
    const row = BY_BLOCK.get(above);
    if (row) {
        if (isRipe(above, cell.age)) {
            return seedCount(h, row) > 0 ? ['harvest', 'plant'] : ['harvest'];
        }
        return amount(h.bone_meal) > 0 ? ['fertilize'] : [];
    }
    if (!isAirName(above)) {
        return [];
    }
    const seeds = seedCount(h, null) > 0;
    if (ground === 'farmland') {
        return seeds ? ['plant'] : [];
    }
    const hoe = h.hoe === true || (typeof h.hoe === 'string' && h.hoe.length > 0) || amount(h.hoe) > 0;
    if (TILLABLE.includes(ground) && cell.inFarm !== false && hoe) {
        return seeds ? ['till', 'plant'] : ['till'];
    }
    return [];
}

function compare(a, b) {
    return a - b;
}

/**
 * The order in which the bot visits the cells: row by row, turning at the end of each row, like
 * a plough. Rows run along the longer side of the field (along x when both are equal). The first
 * row is the row nearest to the start (the lower one on a tie), and it begins at its end nearer
 * to the start. From there the bot works towards the nearer edge of the field first, then goes
 * on with the rows on the other side. Holes, water and odd shapes only leave cells out.
 * @param {{x: number, z: number}[]} cells any objects with block coordinates x and z
 * @param {{x: number, z: number}|null} start the position of the bot; null: the lowest corner
 * @returns {object[]} the same cell objects in a new array; invalid cells are left out
 */
export function visitOrder(cells, start) {
    const valid = Array.isArray(cells)
        ? cells.filter(c => c !== null && typeof c === 'object' && isFiniteNumber(c.x) && isFiniteNumber(c.z))
        : [];
    if (valid.length === 0) {
        return [];
    }
    const xs = valid.map(c => c.x);
    const zs = valid.map(c => c.z);
    const minX = Math.min(...xs);
    const minZ = Math.min(...zs);
    const alongX = Math.max(...xs) - minX >= Math.max(...zs) - minZ;
    const rowOf = c => (alongX ? c.z : c.x);
    const posOf = c => (alongX ? c.x : c.z);
    const s = start && isFiniteNumber(start.x) && isFiniteNumber(start.z)
        ? { x: Math.floor(start.x), z: Math.floor(start.z) }
        : { x: minX, z: minZ };
    const sRow = alongX ? s.z : s.x;
    const sPos = alongX ? s.x : s.z;

    const rows = new Map();
    for (const c of valid) {
        const r = rowOf(c);
        if (!rows.has(r)) {
            rows.set(r, []);
        }
        rows.get(r).push(c);
    }
    const keys = [...rows.keys()].sort(compare);
    let first = 0;
    for (let i = 1; i < keys.length; i++) {
        if (Math.abs(keys[i] - sRow) < Math.abs(keys[first] - sRow)) {
            first = i;
        }
    }
    const lower = keys.slice(0, first).reverse();
    const upper = keys.slice(first + 1);
    const sequence = [keys[first], ...(lower.length <= upper.length ? [...lower, ...upper] : [...upper, ...lower])];

    const firstRow = rows.get(keys[first]).map(posOf);
    let ascending = Math.abs(Math.min(...firstRow) - sPos) <= Math.abs(Math.max(...firstRow) - sPos);
    const out = [];
    for (const key of sequence) {
        const row = [...rows.get(key)].sort((a, b) => (ascending ? posOf(a) - posOf(b) : posOf(b) - posOf(a)));
        out.push(...row);
        ascending = !ascending;
    }
    return out;
}
