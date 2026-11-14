// The pure logic of the base survey (v0.1.4.15 "The base survey and Routines", PLAN section 4, SPEC 2.1 and 2.2; engineer
// E1): the seed names the survey reads with bot.findBlocks, the ore-blind reader of its scans (the one exception to the
// no-x-ray rule of v0.1.4.13, with the ore guard of PLAN 4, decision 1), the seeds from the blocks and the entities, and the
// places from the seeds through the scans of v0.1.4.14 (findOpenFarm, scanPenBehindGate, scanEnclosure) and the kinds of
// area_kind.js. Pure: the world is read through a getBlockName(x, y, z) => string|null, nothing here throws, and the module
// imports only area_scan.js, area_kind.js, open_farm.js and the box math of the home pack. Every read of findPlaces goes
// through oreBlind, whatever reader it is given, so no scan of the survey can name an ore.
//
// The two shapes E4 (survey.js, underground_logic.js) builds on:
//
//   seedsOf(blocksByCategory, entities) → {
//       farmland: [pos], gates: [pos], doors: [pos], rooms: [pos], jobs: [pos], cane: [pos], portals: [pos], down: [pos],
//       villagers: [{ pos, profession }], animals: [{ pos, name }], tied: [{ pos, name, knot: pos }] }
//     blocksByCategory: { <category of SEED_NAMES>: [{ x, y, z }] }, the positions bot.findBlocks gives per category (the
//       portal blocks under `portal` or `portals`); entities: bot.entities (an object by id) or an array of entities
//       ({ name, type, position, metadata?, profession?, leashHolder? }). pos is always a plain { x, y, z } of whole numbers
//       (floored); each list has no duplicates and is sorted by x, z, y. A villager's profession: `entity.profession` when
//       the caller set it (getVillagerProfession of world.js), else the villagerProfession of its metadata, else 'unknown',
//       in lower case without a level ('farmer'). An animal: an entity named in ANIMAL_NAMES or of the type 'animal' (pets
//       among them; the kinds exclude them where a pen is concerned). tied: an entity whose leashHolder is a `leash_knot`
//       entity, or, when no entity names the knot, the animal or mob nearest to the knot within LEASH_RANGE blocks; `knot` is
//       the knot's pos. A knot with nothing near it gives no tied entry.
//
//   findPlaces(read, seeds, saved, options) → { places: [place], kept: [kept], skipped: [skipped] }
//     read: getBlockName(x, y, z) => string|null (wrapped in oreBlind again here); seeds: the result of seedsOf;
//     saved: { areas: [area], places: [point] } of the stores (area: { name, type, kind?, min, max, source?, dimension? } as
//       AreaStore.list() gives it; point: { name, x, y, z, source? } as PlaceStore.list() gives it); a plain array counts as
//       the areas. options: { dimension?: string (saved areas of another dimension are ignored), now?: () => number }.
//     place = { kind, name, type, box: { min, max } | null, at: { x, y, z } | null, entrances: [{ x, y, z, kind }],
//              contents: { animals: {}, crops: {}, beds, chests, furnaces, tables, ladders, water }, border: string | null,
//              source: 'survey', detail: object }
//       an area (E4 saves it through ctx.areas.set): kind pen | farm | home | storage | building | yard, type typeOfKind(kind),
//         its box, at null, border fence | wall | glass | hedge | water | mixed | open; detail: a farm { field: { min, max },
//         farmland, crop: 'potatoes' | null, fenced }; a pen { species: 'cow', roof }; a yard (a fence ring with a gate and no
//         animal: the lead's correction of 2.2, never a keep-out pen) { roof }; a building { villagers, professions, floor,
//         roof }; the cane { what: 'cane', count }; a find that replaces a saved survey area of the same kind:
//         detail.replaces = <that name>, and its name is that name.
//       a point (E4 saves it through ctx.places.rememberPlace): kind trading_hall | tied | portal, type 'place', box null,
//         at the point, entrances [], border null; detail: a hall { villagers, professions }; a tied animal { animal:
//         'happy_ghast', animalAt: pos }; a portal { blocks }.
//     kept = { name, inside: <the owner's area name>, kind, at: { x, y, z }, place }: a find whose footprint (its columns in x
//       and z; the boxes must overlap in y at all) lies inside, or overlaps by half or more of itself, an area whose source is
//       not 'survey' (a point: inside it); not among places. The replace of a survey area compares footprints the same way.
//     skipped = { reason: 'no_pen' | 'no_building' | 'other_kind', at: { x, y, z }, name?, over? }: a gate with no pen behind
//       it, a door with no building around it, a find over a saved survey area of another kind (over: that area's name).
//     Names: a found name that collides with a found or a saved name (areas and points) takes `_2`, `_3`, ... A seed inside
//     an owner's area (source other than survey) is never scanned (farmland: inside an owner's farm); a seed inside a saved
//     survey area is scanned again, and the find replaces that area (the box and the contents are updated, the name stays),
//     so a later survey sees every place of its own again and can compare them (2.4).

import { COPPER_CHESTS, scanEnclosure, scanPenBehindGate } from '../../areas/area_scan.js';
import { PETS, kindOf, typeOfKind } from '../../areas/area_kind.js';
import { findOpenFarm } from '../../areas/open_farm.js';
import { boxCenter, containsPos, isBox } from '../home/box_math.js';

// --- the seed names (2.1) -----------------------------------------------------------------------------------------------

const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'cherry', 'dark_oak', 'pale_oak', 'mangrove', 'bamboo', 'crimson', 'warped'];
const COPPERS = ['copper', 'exposed_copper', 'oxidized_copper', 'weathered_copper', 'waxed_copper', 'waxed_exposed_copper',
    'waxed_oxidized_copper', 'waxed_weathered_copper'];
const COLOURS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue',
    'brown', 'green', 'red', 'black'];

/** The crop blocks of crop_logic.js (a copy: this module may not import the farming pack), with the word of their farm. */
export const CROP_FARMS = Object.freeze({ wheat: 'wheat_farm', carrots: 'carrot_farm', potatoes: 'potato_farm', beetroots: 'beetroot_farm' });

/**
 * The names the survey reads with bot.findBlocks, by category (SPEC 2.1): block names only, never an ore.
 * `farmland` the farmland and the crop blocks; `gates` every fence gate; `doors` every door that is a block (no trapdoor);
 * `rooms` the beds, the chests (the 8 copper chests among them), barrel, the furnaces and the crafting table; `jobs` the job
 * sites of villagers; `cane` the sugar cane; `portal` the portal block; `down` every trapdoor and the ladder.
 */
export const SEED_NAMES = Object.freeze({
    farmland: Object.freeze(['farmland', ...Object.keys(CROP_FARMS)]),
    gates: Object.freeze(WOODS.map(w => `${w}_fence_gate`)),
    doors: Object.freeze([...WOODS.map(w => `${w}_door`), 'iron_door', ...COPPERS.map(c => `${c}_door`)]),
    rooms: Object.freeze([...COLOURS.map(c => `${c}_bed`), 'chest', ...COPPER_CHESTS, 'barrel', 'furnace', 'blast_furnace', 'smoker',
        'crafting_table']),
    jobs: Object.freeze(['lectern', 'composter', 'smithing_table', 'fletching_table', 'cartography_table', 'loom', 'stonecutter', 'grindstone',
        'brewing_stand', 'barrel', 'cauldron', 'blast_furnace', 'smoker']),
    cane: Object.freeze(['sugar_cane']),
    portal: Object.freeze(['nether_portal']),
    down: Object.freeze([...WOODS.map(w => `${w}_trapdoor`), 'iron_trapdoor', ...COPPERS.map(c => `${c}_trapdoor`), 'ladder']),
});

/** The categories of SEED_NAMES, in the order the survey reads them. */
export const SEED_CATEGORIES = Object.freeze(Object.keys(SEED_NAMES));

/** The animals of a base (the list of countContents of area_sense.js, a copy); any entity of the type 'animal' counts too. */
export const ANIMAL_NAMES = Object.freeze(['chicken', 'cow', 'pig', 'sheep', 'rabbit', 'horse', 'donkey', 'mule', 'llama', 'trader_llama',
    'goat', 'mooshroom', 'turtle', 'cat', 'wolf', 'fox', 'bee', 'camel', 'armadillo', 'sniffer', 'frog', 'axolotl', 'panda', 'polar_bear',
    'ocelot', 'parrot', 'strider', 'hoglin', 'happy_ghast']);

/** How far from its knot a leashed entity stands at most (a leash holds 10 blocks; the knot is read with a margin). */
export const LEASH_RANGE = 12;

/** Villagers at job sites make a trading hall when 2 or more stand within this many blocks of each other and of a job site (2.2). */
export const HALL_REACH = 6;

/** A group of sugar cane by the water is the cane place from this many plants (2.2). */
export const CANE_MIN = 3;

/** A point find (a portal, a tied animal, a hall) within this many blocks of a saved survey point of its kind keeps that name. */
export const POINT_REACH = 4;

// The largest box whose blocks are counted (the largest area, 64 x 48 x 64, as countContents).
const MAX_COUNT_VOLUME = 64 * 48 * 64;

// A farmland seed within this many blocks of one where the scans found no farm is not scanned again (the same unloaded ground).
const FAILED_REACH = 16;

// The professions of a villager by the id of its metadata (the table of getVillagerProfession of world.js, in lower case).
const PROFESSIONS = Object.freeze(['unemployed', 'armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman', 'fletcher',
    'leatherworker', 'librarian', 'mason', 'nitwit', 'shepherd', 'toolsmith', 'weaponsmith']);

const AIR = new Set(['air', 'cave_air', 'void_air']);
// Blocks a player stands in: the cell beside a door that is one of these is a side of the door.
const OPEN_NAMES = new Set([...AIR, 'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'snow', 'torch', 'wall_torch',
    'redstone_wire', 'lever', 'tripwire', 'rail', 'powered_rail', 'detector_rail', 'activator_rail', 'cobweb', 'light']);
const OPEN_ENDINGS = ['_carpet', '_button', '_pressure_plate', '_sign', '_banner', '_torch', '_sapling', '_tulip'];
const FLOWERS = new Set(['dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley',
    'wither_rose', 'torchflower', 'pink_petals']);

// The crop blocks by name (an attached stem is its stem), the chests and the furnaces, as countContents counts them.
const CROP_BLOCKS = new Map([['wheat', 'wheat'], ['carrots', 'carrots'], ['potatoes', 'potatoes'], ['beetroots', 'beetroots'],
    ['melon_stem', 'melon_stem'], ['attached_melon_stem', 'melon_stem'], ['pumpkin_stem', 'pumpkin_stem'],
    ['attached_pumpkin_stem', 'pumpkin_stem'], ['sweet_berry_bush', 'sweet_berry_bush'], ['nether_wart', 'nether_wart'],
    ['torchflower_crop', 'torchflower_crop'], ['pitcher_crop', 'pitcher_crop']]);
const CHESTS = new Set(['chest', 'trapped_chest', 'barrel', ...COPPER_CHESTS]);
const FURNACES = new Set(['furnace', 'blast_furnace', 'smoker']);

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const ROUND = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

// --- small helpers -----------------------------------------------------------------------------------------------------

function plain(name) {
    return typeof name === 'string' ? name.replace(/^minecraft:/, '') : null;
}

function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

// The block of a position-like object ({x, y, z} or a Vec3), or null.
function posOf(p) {
    if (p === null || typeof p !== 'object' || !isFiniteNumber(p.x) || !isFiniteNumber(p.y) || !isFiniteNumber(p.z)) {
        return null;
    }
    return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
}

function keyOf(p) {
    return `${p.x},${p.y},${p.z}`;
}

function byXZY(a, b) {
    return a.x - b.x || a.z - b.z || a.y - b.y;
}

// Distinct floored positions of a list, sorted by x, z, y.
function positions(list) {
    const seen = new Map();
    for (const item of Array.isArray(list) ? list : []) {
        const p = posOf(item?.position ?? item);
        if (p && !seen.has(keyOf(p))) {
            seen.set(keyOf(p), p);
        }
    }
    return [...seen.values()].sort(byXZY);
}

function listOf(value) {
    return Array.isArray(value) ? value : [];
}

function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function boxOf(min, max) {
    const a = posOf(min);
    const b = posOf(max);
    if (!a || !b) {
        return null;
    }
    return {
        min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) },
        max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) },
    };
}

function volume(box) {
    return (box.max.x - box.min.x + 1) * (box.max.y - box.min.y + 1) * (box.max.z - box.min.z + 1);
}

// The footprint of a box: its columns in x and z (the lead's decision after W126 part C, 2026-11-10: the owner's box of
// 6 x 2 x 7 over 6 of the 9 columns of the potato field covers half of the find, whatever its height).
function footprint(box) {
    return (box.max.x - box.min.x + 1) * (box.max.z - box.min.z + 1);
}

// The columns two boxes share, 0 when they do not overlap in y at all.
function sharedColumns(a, b) {
    const dx = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x) + 1;
    const dy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y) + 1;
    const dz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z) + 1;
    return dx > 0 && dy > 0 && dz > 0 ? dx * dz : 0;
}

// The footprint of `inner` lies in that of `outer`, and the boxes overlap in y.
function footprintInside(inner, outer) {
    return inner.min.x >= outer.min.x && inner.min.z >= outer.min.z && inner.max.x <= outer.max.x && inner.max.z <= outer.max.z
        && inner.min.y <= outer.max.y && inner.max.y >= outer.min.y;
}

// The block in the middle of a box, for the texts.
function centreOf(box) {
    return posOf(boxCenter(box));
}

function emptyContents() {
    return { animals: {}, crops: {}, beds: 0, chests: 0, furnaces: 0, tables: 0, ladders: 0, water: 0 };
}

// --- the ore-blind reader (2.1) ------------------------------------------------------------------------------------------

/**
 * True for the name of an ore: a name that ends in `_ore`, and `ancient_debris`.
 * @param {string|null} name with or without `minecraft:`
 * @returns {boolean}
 */
export function isOreName(name) {
    const n = plain(name);
    return n !== null && (n.endsWith('_ore') || n === 'ancient_debris');
}

/**
 * The reader of the survey's scans (SPEC 2.1, PLAN 4 decision 1 and the risk of section 9): a getBlockName that reads every
 * ore as the rock around it. A name that ends in `_ore` reads as `stone` (`deepslate` when it starts with `deepslate_`),
 * `ancient_debris` as `netherrack`; everything else unchanged (null for a block that is not loaded, or when the reader fails).
 * @param {(x: number, y: number, z: number) => string|null} getBlockName
 * @returns {(x: number, y: number, z: number) => string|null}
 */
export function oreBlind(getBlockName) {
    if (typeof getBlockName !== 'function') {
        return () => null;
    }
    return (x, y, z) => {
        let name;
        try {
            name = getBlockName(x, y, z);
        } catch {
            return null;
        }
        if (typeof name !== 'string') {
            return null;
        }
        const base = plain(name);
        if (base === 'ancient_debris') {
            return 'netherrack';
        }
        if (base.endsWith('_ore')) {
            return base.startsWith('deepslate_') ? 'deepslate' : 'stone';
        }
        return name;
    };
}

// --- the seeds (2.1) ---------------------------------------------------------------------------------------------------

function entitiesOf(entities) {
    const list = Array.isArray(entities) ? entities : Object.values(entities && typeof entities === 'object' ? entities : {});
    return list.filter(e => e !== null && typeof e === 'object' && posOf(e.position) !== null);
}

function nameOf(entity) {
    const name = plain(entity.name);
    return name !== null && name !== '' ? name : null;
}

function isAnimal(entity) {
    const name = nameOf(entity);
    return name !== null && (ANIMAL_NAMES.includes(name) || entity.type === 'animal');
}

function professionOf(entity) {
    let value = entity.profession;
    if (typeof value !== 'string' || value.trim() === '') {
        const meta = Array.isArray(entity.metadata) ? entity.metadata.find(m => m && typeof m === 'object' && 'villagerProfession' in m) : null;
        value = meta?.villagerProfession;
    }
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < PROFESSIONS.length) {
        return PROFESSIONS[value];
    }
    if (typeof value === 'string' && value.trim() !== '') {
        return value.trim().replace(/\s+L\d+$/i, '').toLowerCase();
    }
    return 'unknown';
}

// The entity the leash holder of an entity points at (an id or an entity), or null.
function holderOf(entity, byId) {
    const holder = entity.leashHolder;
    if (holder === null || holder === undefined) {
        return null;
    }
    if (typeof holder === 'object') {
        return holder;
    }
    return byId.get(holder) ?? null;
}

/**
 * The seeds of a survey (SPEC 2.1): the positions of the blocks per category as plain blocks, and the villagers, the
 * animals and the tied entities among the entities. See the header for the shape.
 * @param {Object<string, object[]>} blocksByCategory the positions bot.findBlocks gave per category of SEED_NAMES
 * @param {object|object[]} entities bot.entities (by id) or a list
 * @returns {{farmland: object[], gates: object[], doors: object[], rooms: object[], jobs: object[], cane: object[], portals: object[],
 *   down: object[], villagers: {pos: object, profession: string}[], animals: {pos: object, name: string}[],
 *   tied: {pos: object, name: string, knot: object}[]}}
 */
export function seedsOf(blocksByCategory, entities) {
    const blocks = blocksByCategory && typeof blocksByCategory === 'object' ? blocksByCategory : {};
    const seeds = {
        farmland: positions(blocks.farmland),
        gates: positions(blocks.gates),
        doors: positions(blocks.doors),
        rooms: positions(blocks.rooms),
        jobs: positions(blocks.jobs),
        cane: positions(blocks.cane),
        portals: positions([...listOf(blocks.portal), ...listOf(blocks.portals)]),
        down: positions(blocks.down),
        villagers: [],
        animals: [],
        tied: [],
    };
    try {
        const list = entitiesOf(entities);
        const byId = new Map(list.filter(e => e.id !== undefined && e.id !== null).map(e => [e.id, e]));
        const knots = list.filter(e => nameOf(e) === 'leash_knot');
        const tiedTo = new Map(); // knot -> entity
        for (const e of list) {
            const name = nameOf(e);
            if (name === null || e.type === 'player') {
                continue;
            }
            if (name === 'villager') {
                seeds.villagers.push({ pos: posOf(e.position), profession: professionOf(e) });
            } else if (isAnimal(e)) {
                seeds.animals.push({ pos: posOf(e.position), name });
            }
            const holder = holderOf(e, byId);
            if (holder && nameOf(holder) === 'leash_knot' && !tiedTo.has(holder)) {
                tiedTo.set(holder, e);
            }
        }
        for (const knot of knots) {
            let e = tiedTo.get(knot) ?? null;
            if (!e) {
                // no entity names the knot (mineflayer knows no leashes): the animal or mob nearest to it within the leash
                let best = Infinity;
                for (const other of list) {
                    const name = nameOf(other);
                    if (name === null || name === 'leash_knot' || name === 'villager' || name === 'item' || other.type === 'player'
                        || other.type === 'object' || other.type === 'other') {
                        continue;
                    }
                    const d = distance(posOf(other.position), posOf(knot.position));
                    if (d <= LEASH_RANGE && d < best) {
                        best = d;
                        e = other;
                    }
                }
            }
            if (e) {
                seeds.tied.push({ pos: posOf(e.position), name: nameOf(e), knot: posOf(knot.position) });
            }
        }
        const byPos = (a, b) => byXZY(a.pos, b.pos);
        seeds.villagers.sort(byPos);
        seeds.animals.sort(byPos);
        seeds.tied.sort((a, b) => byXZY(a.knot, b.knot));
    } catch {
        // the blocks stand; the entities are a help
    }
    return seeds;
}

// --- the places (2.2) --------------------------------------------------------------------------------------------------

// A reader for the scans: ore-blind, the names without `minecraft:`.
function surveyReader(read) {
    const blind = oreBlind(read);
    return (x, y, z) => plain(blind(x, y, z));
}

function tryScan(read, origin, options) {
    try {
        return scanEnclosure(read, origin, options);
    } catch {
        return null;
    }
}

// What a box holds, as countContents counts it, from the names of the blocks and the animals of the seeds: a bed is 2 blocks,
// a double chest 2 chests (the names tell no more). Beyond the largest area only the animals are counted.
function contentsOf(read, box, animals) {
    const c = emptyContents();
    for (const a of animals) {
        if (containsPos(box, a.pos)) {
            c.animals[a.name] = (c.animals[a.name] ?? 0) + 1;
        }
    }
    if (volume(box) > MAX_COUNT_VOLUME) {
        return c;
    }
    let bedBlocks = 0;
    for (let x = box.min.x; x <= box.max.x; x++) {
        for (let y = box.min.y; y <= box.max.y; y++) {
            for (let z = box.min.z; z <= box.max.z; z++) {
                const name = read(x, y, z);
                if (name === null || AIR.has(name)) {
                    continue;
                }
                if (CROP_BLOCKS.has(name)) {
                    const crop = CROP_BLOCKS.get(name);
                    c.crops[crop] = (c.crops[crop] ?? 0) + 1;
                } else if (name.endsWith('_bed')) {
                    bedBlocks++;
                } else if (CHESTS.has(name)) {
                    c.chests++;
                } else if (FURNACES.has(name)) {
                    c.furnaces++;
                } else if (name === 'crafting_table') {
                    c.tables++;
                } else if (name === 'ladder') {
                    c.ladders++;
                } else if (name === 'water') {
                    c.water++;
                }
            }
        }
    }
    c.beds = Math.ceil(bedBlocks / 2);
    return c;
}

// The most counted key of a map of counts (ties by name), or null when every count is 0.
function majority(counts, exclude = []) {
    let best = null;
    for (const [name, n] of Object.entries(counts ?? {})) {
        if (!isFiniteNumber(n) || n <= 0 || exclude.includes(name)) {
            continue;
        }
        if (!best || n > best.n || (n === best.n && name < best.name)) {
            best = { name, n };
        }
    }
    return best ? best.name : null;
}

/**
 * The name of a farm by its main crop (2.2): `potato_farm`, `carrot_farm`, `wheat_farm`, `beetroot_farm`; `farm` when it has
 * no crop of the table.
 * @param {{crops?: Object<string, number>}|null} contents
 * @returns {string}
 */
export function farmName(contents) {
    const crop = majority(Object.fromEntries(Object.entries(contents?.crops ?? {}).filter(([name]) => Object.hasOwn(CROP_FARMS, name))));
    return crop ? CROP_FARMS[crop] : 'farm';
}

/**
 * The name of a pen by the majority of its animals, pets excluded (2.2): `cow_pen`, `pig_pen`, `chicken_pen`, `sheep_pen`;
 * `pen` when no animal stands in it (findPlaces then saves no pen but a yard: the lead's correction of 2.2).
 * @param {{animals?: Object<string, number>}|null} contents
 * @returns {string}
 */
export function penName(contents) {
    const species = majority(contents?.animals, PETS);
    return species ? `${species}_pen` : 'pen';
}

/**
 * A name that collides with none of the taken names (2.2): the name itself, else `name_2`, `name_3`, ...
 * @param {string} name
 * @param {Iterable<string>} taken
 * @returns {string}
 */
export function uniqueName(name, taken) {
    const set = taken instanceof Set ? taken : new Set(taken ?? []);
    if (!set.has(name)) {
        return name;
    }
    for (let n = 2; ; n++) {
        if (!set.has(`${name}_${n}`)) {
            return `${name}_${n}`;
        }
    }
}

function baseOfName(name) {
    return typeof name === 'string' ? name.replace(/_\d+$/, '') : '';
}

function makePlace(kind, name, type, box, at, entrances, contents, border, detail) {
    return {
        kind,
        name,
        type,
        box: box ? { min: { ...box.min }, max: { ...box.max } } : null,
        at: at ? { ...at } : null,
        entrances: listOf(entrances).map(e => ({ ...e })),
        contents,
        border,
        source: 'survey',
        detail,
    };
}

// The saved areas as { name, type, kind, box, source } of this dimension, with a valid box.
function savedAreasOf(saved, dimension) {
    const list = Array.isArray(saved) ? saved : listOf(saved?.areas);
    const out = [];
    for (const a of list) {
        if (!a || typeof a !== 'object' || typeof a.name !== 'string') {
            continue;
        }
        const box = a.box && isBox(a.box) ? boxOf(a.box.min, a.box.max) : boxOf(a.min, a.max);
        if (!box || (dimension && a.dimension && a.dimension !== dimension)) {
            continue;
        }
        out.push({ name: a.name, type: a.type ?? null, kind: a.kind ?? a.type ?? null, box, source: a.source ?? 'manual' });
    }
    return out;
}

function savedPointsOf(saved) {
    const out = [];
    for (const p of Array.isArray(saved) ? [] : listOf(saved?.places)) {
        if (!p || typeof p !== 'object' || typeof p.name !== 'string') {
            continue;
        }
        const at = posOf(p.at ?? p.pos ?? p);
        out.push({ name: p.name, at, source: p.source ?? 'manual' });
    }
    return out;
}

// The family of a kind for the replace of a survey find: a home and a building are one family (a house whose bed was taken
// away is the same place), a farm, a pen.
function familyOf(kind) {
    const type = typeOfKind(kind) ?? kind;
    return type === 'home' || type === 'building' ? 'building' : type;
}

// The cell beside a door a player stands in: not a wall.
function isOpenCell(name) {
    return name !== null && (OPEN_NAMES.has(name) || FLOWERS.has(name) || OPEN_ENDINGS.some(e => name.endsWith(e)));
}

// The upper half of a door stands on the same door.
function isUpperDoor(read, door) {
    const name = read(door.x, door.y, door.z);
    return name !== null && name.endsWith('_door') && read(door.x, door.y - 1, door.z) === name;
}

function doorSides(read, door) {
    const open = [];
    const all = [];
    for (const [dx, dz] of SIDES) {
        const side = { x: door.x + dx, y: door.y, z: door.z + dz };
        all.push(side);
        if (isOpenCell(read(side.x, side.y, side.z))) {
            open.push(side);
        }
    }
    return open.length > 0 ? open : all;
}

// A groups of positions by adjacency: `near(a, b)` says when two belong together.
function groupsOf(items, near) {
    const groups = [];
    const seen = new Set();
    for (let i = 0; i < items.length; i++) {
        if (seen.has(i)) {
            continue;
        }
        const group = [items[i]];
        seen.add(i);
        for (let g = 0; g < group.length; g++) {
            for (let j = 0; j < items.length; j++) {
                if (!seen.has(j) && near(group[g], items[j])) {
                    seen.add(j);
                    group.push(items[j]);
                }
            }
        }
        groups.push(group);
    }
    return groups;
}

// Water within 1 block of a cell, diagonals and one level up or down included (the water beside the sand of a cane).
function nearWater(read, p) {
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
                if ((dx !== 0 || dy !== 0 || dz !== 0) && read(p.x + dx, p.y + dy, p.z + dz) === 'water') {
                    return true;
                }
            }
        }
    }
    return false;
}

/**
 * The places of a base from the seeds (SPEC 2.2), through the ore-blind reader: the open and the fenced farms from the
 * farmland (findOpenFarm, the fenced farm of the ground scan when a fence ring holds it), the pens from the gates
 * (scanPenBehindGate), the buildings from the doors (scanEnclosure in building mode from the cell on each side of the door,
 * the side whose box holds the door wins), the trading hall where 2 villagers or more stand at job sites, the sugar cane by
 * the water, the tied animals at their knots and the portals; then the names, the owner's areas (`kept`) and the replace of a
 * former survey's find. See the header for the shapes. Never throws: what failed is left out.
 * @param {(x: number, y: number, z: number) => string|null} read
 * @param {object} seeds the result of seedsOf
 * @param {{areas?: object[], places?: object[]}|object[]} saved the areas and the places of the stores
 * @param {{dimension?: string, now?: () => number}} [options]
 * @returns {{places: object[], kept: object[], skipped: object[]}}
 */
export function findPlaces(read, seeds, saved, options = {}) {
    const finds = [];
    const skipped = [];
    const kept = [];
    const places = [];
    try {
        const r = surveyReader(read);
        const s = seeds && typeof seeds === 'object' ? seeds : {};
        const opts = options && typeof options === 'object' ? options : {};
        const scanOptions = typeof opts.now === 'function' ? { now: opts.now } : {};
        const animals = listOf(s.animals).filter(a => posOf(a?.pos) && typeof a.name === 'string').map(a => ({ pos: posOf(a.pos), name: plain(a.name) }));
        const villagers = listOf(s.villagers).filter(v => posOf(v?.pos)).map(v => ({ pos: posOf(v.pos), profession: v.profession ?? 'unknown' }));
        const savedAreas = savedAreasOf(saved, typeof opts.dimension === 'string' ? opts.dimension : null);
        const ownerAreas = savedAreas.filter(a => a.source !== 'survey');
        const surveyAreas = savedAreas.filter(a => a.source === 'survey');
        const savedPoints = savedPointsOf(saved);

        const insideFound = (pos, kinds = null) => finds.some(f => f.box && (kinds === null || kinds.includes(f.kind)) && containsPos(f.box, pos));
        const insideOwner = (pos, types = null) => ownerAreas.some(a => (types === null || types.includes(a.type)) && containsPos(a.box, pos));

        // farms (farmland and crops); a seed near one where both scans found nothing (the ground there is not loaded) is not
        // scanned again: the scans read the same ground
        const failed = [];
        for (const seed of positions(s.farmland)) {
            if (insideFound(seed, ['farm']) || insideOwner(seed, ['farm']) || failed.some(f => Math.hypot(f.x - seed.x, f.z - seed.z) <= FAILED_REACH)) {
                continue;
            }
            const feet = r(seed.x, seed.y, seed.z) === 'farmland' ? seed.y + 1 : seed.y;
            const origin = { x: seed.x + 0.5, y: feet, z: seed.z + 0.5 };
            const fenced = tryScan(r, origin, { ...scanOptions, mode: 'ground', type: 'farm' });
            let box = null;
            let field = null;
            let farmland = 0;
            let entrances = [];
            let border = 'open';
            if (fenced?.found && fenced.box) {
                box = boxOf(fenced.min, fenced.max);
                field = { min: { x: box.min.x + 1, y: box.min.y + 1, z: box.min.z + 1 }, max: { x: box.max.x - 1, y: box.min.y + 1, z: box.max.z - 1 } };
                farmland = isFiniteNumber(fenced.scan?.farmland) ? fenced.scan.farmland : 0;
                entrances = fenced.entrances;
                border = fenced.border ?? 'fence';
            } else {
                const open = findOpenFarm(r, origin);
                if (!open.found) {
                    failed.push(seed);
                    continue;
                }
                box = boxOf(open.min, open.max);
                field = boxOf(open.field.min, open.field.max);
                farmland = open.farmland;
            }
            if (!box) {
                continue;
            }
            const contents = contentsOf(r, box, animals);
            const name = farmName(contents);
            finds.push(makePlace('farm', name, 'farm', box, null, entrances, contents, border,
                { field, farmland, crop: name === 'farm' ? null : majority(contents.crops), fenced: border !== 'open' }));
        }

        // pens (gates)
        for (const gate of positions(s.gates)) {
            if (insideFound(gate) || insideOwner(gate)) {
                continue;
            }
            const pen = scanPenBehindGate(r, gate);
            if (!pen.found) {
                skipped.push({ reason: 'no_pen', at: { ...gate } });
                continue;
            }
            const box = boxOf(pen.min, pen.max);
            if (!box) {
                continue;
            }
            const side = pen.side ? { x: pen.side.x + 0.5, y: pen.side.y, z: pen.side.z + 0.5 } : null;
            const facts = side ? tryScan(r, side, { ...scanOptions, mode: 'ground', type: 'pen' }) : null;
            const contents = contentsOf(r, box, animals);
            const border = facts?.found ? facts.border ?? 'fence' : 'fence';
            const roof = facts?.roof === true;
            // the lead's correction of 2.2 (2026-11-10): the kind of the fenced ground is kindOf's, as for !rememberArea: animals
            // (not pets) make a pen, crops on tilled ground a farm, and an empty fence ring is a yard, never a keep-out pen
            const kind = kindOf({ border, roof, floor: facts?.found ? facts.floor : 'ground', openings: facts?.found ? facts.openings : pen.entrances }, contents);
            if (kind === 'pen') {
                const name = penName(contents);
                finds.push(makePlace('pen', name, 'pen', box, null, pen.entrances, contents, border, { species: name.slice(0, -'_pen'.length), roof }));
            } else if (kind === 'farm') {
                const name = farmName(contents);
                const field = { min: { x: box.min.x + 1, y: box.min.y + 1, z: box.min.z + 1 }, max: { x: box.max.x - 1, y: box.min.y + 1, z: box.max.z - 1 } };
                finds.push(makePlace('farm', name, 'farm', box, null, pen.entrances, contents, border,
                    { field, farmland: 0, crop: name === 'farm' ? null : majority(contents.crops), fenced: true }));
            } else {
                finds.push(makePlace('yard', 'yard', typeOfKind('yard'), box, null, pen.entrances, contents, border, { roof }));
            }
        }

        // buildings (doors)
        for (const door of positions(s.doors)) {
            if (isUpperDoor(r, door) || insideFound(door) || insideOwner(door)) {
                continue;
            }
            let best = null;
            for (const side of doorSides(r, door)) {
                const e = tryScan(r, { x: side.x + 0.5, y: side.y, z: side.z + 0.5 }, { ...scanOptions, mode: 'building', floors: true });
                if (!e?.found || !e.box || !containsPos(e.box, door)) {
                    continue;
                }
                const better = !best || (e.roof === true && best.roof !== true) || (e.roof === best.roof && volume(e.box) < volume(best.box));
                if (better) {
                    best = e;
                }
            }
            if (!best) {
                skipped.push({ reason: 'no_building', at: { ...door } });
                continue;
            }
            const box = boxOf(best.min, best.max);
            const contents = contentsOf(r, box, animals);
            const inside = villagers.filter(v => containsPos(box, v.pos));
            let kind = kindOf(best, contents);
            if (kind === 'tunnel' || kind === 'cave') {
                kind = 'building';
            }
            const type = typeOfKind(kind) ?? 'building';
            const name = kind === 'home' ? 'house' : kind === 'storage' ? 'storage' : kind === 'building' ? (inside.length >= 2 ? 'hall' : 'building') : kind;
            finds.push(makePlace(kind, name, type, box, null, best.entrances, contents, best.border ?? 'wall',
                { villagers: inside.length, professions: [...new Set(inside.map(v => v.profession))].sort(), floor: best.scan?.floor === true,
                    roof: best.roof === true }));
        }

        // the trading hall (villagers at job sites)
        const jobs = positions(s.jobs);
        const atJobs = villagers.filter(v => jobs.some(j => distance(v.pos, { x: j.x + 0.5, y: j.y, z: j.z + 0.5 }) <= HALL_REACH));
        for (const group of groupsOf(atJobs, (a, b) => distance(a.pos, b.pos) <= HALL_REACH)) {
            if (group.length < 2) {
                continue;
            }
            const professions = [...new Set(group.map(v => v.profession))].sort();
            const building = finds.find(f => f.box && typeOfKind(f.kind) !== 'farm' && typeOfKind(f.kind) !== 'pen' && group.some(v => containsPos(f.box, v.pos)));
            if (building) {
                building.name = 'trading_hall';
                building.kind = 'building';
                building.type = 'building';
                building.detail.villagers = group.length;
                building.detail.professions = professions;
                continue;
            }
            const at = {
                x: Math.floor(group.reduce((sum, v) => sum + v.pos.x, 0) / group.length),
                y: Math.min(...group.map(v => v.pos.y)),
                z: Math.floor(group.reduce((sum, v) => sum + v.pos.z, 0) / group.length),
            };
            finds.push(makePlace('trading_hall', 'trading_hall', 'place', null, at, [], emptyContents(), null, { villagers: group.length, professions }));
        }

        // the cane by the water
        const bases = positions(s.cane).filter(c => r(c.x, c.y, c.z) === 'sugar_cane' && nearWater(r, c));
        const touching = (a, b) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.z - b.z) <= 1 && Math.abs(a.y - b.y) <= 1;
        for (const group of groupsOf(bases, touching)) {
            if (group.length < CANE_MIN) {
                continue;
            }
            let top = -Infinity;
            for (const base of group) {
                let y = base.y;
                while (y - base.y < 4 && r(base.x, y + 1, base.z) === 'sugar_cane') {
                    y++;
                }
                top = Math.max(top, y);
            }
            const xs = group.map(c => c.x);
            const ys = group.map(c => c.y);
            const zs = group.map(c => c.z);
            const box = { min: { x: Math.min(...xs) - 1, y: Math.min(...ys) - 1, z: Math.min(...zs) - 1 }, max: { x: Math.max(...xs) + 1, y: top + 1, z: Math.max(...zs) + 1 } };
            finds.push(makePlace('farm', 'cane', 'farm', box, null, [], contentsOf(r, box, animals), 'open', { what: 'cane', count: group.length }));
        }

        // the tied animals
        for (const t of listOf(s.tied)) {
            const knot = posOf(t?.knot);
            const name = plain(t?.name);
            if (!knot || !name) {
                continue;
            }
            finds.push(makePlace('tied', `tied_${name}`, 'place', null, knot, [], emptyContents(), null, { animal: name, animalAt: posOf(t.pos) }));
        }

        // the portals
        const portalBlocks = positions(s.portals).filter(p => r(p.x, p.y, p.z) === 'nether_portal');
        const adjacent = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) === 1;
        for (const group of groupsOf(portalBlocks, adjacent)) {
            const lowest = [...group].sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z)[0];
            finds.push(makePlace('portal', 'portal', 'place', null, lowest, [], emptyContents(), null, { blocks: group.length }));
        }

        // the names, the owner's areas, the replace of a former survey's find
        const taken = new Set([...savedAreas.map(a => a.name), ...savedPoints.map(p => p.name)]);
        for (const find of finds) {
            if (find.box) {
                const owner = ownerAreas.find(a => footprintInside(find.box, a.box) || sharedColumns(find.box, a.box) * 2 >= footprint(find.box));
                if (owner) {
                    kept.push({ name: find.name, inside: owner.name, kind: find.kind, at: centreOf(find.box), place: find });
                    continue;
                }
                const former = surveyAreas.find(a => sharedColumns(find.box, a.box) * 2 >= Math.min(footprint(find.box), footprint(a.box)));
                if (former) {
                    if (familyOf(former.kind) !== familyOf(find.kind)) {
                        skipped.push({ reason: 'other_kind', at: centreOf(find.box), name: find.name, over: former.name });
                        continue;
                    }
                    find.detail.replaces = former.name;
                    find.name = former.name;
                    places.push(find);
                    continue;
                }
            } else {
                const owner = ownerAreas.find(a => containsPos(a.box, find.at));
                if (owner) {
                    kept.push({ name: find.name, inside: owner.name, kind: find.kind, at: { ...find.at }, place: find });
                    continue;
                }
                const former = savedPoints.find(p => p.source === 'survey' && p.at && baseOfName(p.name) === find.name && distance(p.at, find.at) <= POINT_REACH);
                if (former) {
                    find.detail.replaces = former.name;
                    find.name = former.name;
                    places.push(find);
                    continue;
                }
            }
            find.name = uniqueName(find.name, taken);
            taken.add(find.name);
            places.push(find);
        }
    } catch (error) {
        skipped.push({ reason: 'error', at: null, message: error instanceof Error ? error.message : String(error) });
    }
    return { places, kept, skipped };
}

// --- the clusters of a base (v0.1.4.16, F2) -------------------------------------------------------------------------------
//
// A base is the finds within reach of each other from where the bot stands (PLAN 4, F2): two finds farther apart than the
// gap (`survey_cluster_gap`, 48) belong to different bases. The survey saves the cluster the bot stands in and reports the
// others ("another base or a village"). Everything here is pure and never throws.

/** The gap of the clusters without a setting (SPEC 0.1.4.16, section 1). */
export const CLUSTER_GAP = 48;

/** The eight directions of the left-out sentence, clockwise from north (north is -z, east is +x in Minecraft). */
export const DIRECTIONS = Object.freeze(['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']);

// The footprint of a find in x and z as { min: { x, z }, max: { x, z } }: a box (a place of findPlaces, a saved area, a kept
// entry's place), else its point (`at`, or the x/z of the object itself); null for nothing readable.
function footprintOf(find) {
    if (find === null || typeof find !== 'object') {
        return null;
    }
    const box = find.box && isBox(find.box) ? find.box : isBox(find) ? find : find.place?.box && isBox(find.place.box) ? find.place.box : null;
    if (box) {
        return { min: { x: Math.min(box.min.x, box.max.x), z: Math.min(box.min.z, box.max.z) }, max: { x: Math.max(box.min.x, box.max.x), z: Math.max(box.min.z, box.max.z) } };
    }
    const at = posOf(find.at) ?? posOf(find.place?.at) ?? posOf(find.position) ?? posOf(find);
    return at ? { min: { x: at.x, z: at.z }, max: { x: at.x, z: at.z } } : null;
}

/**
 * The distance in x and z between two finds, edge to edge: 0 when the footprints overlap or touch, else the shortest
 * way between the two boxes (a point is a box of one cell). Infinity when one of them has no position.
 * @param {object} a a find: { box } | { at } | { x, y, z } | a kept entry { place }
 * @param {object} b
 * @returns {number}
 */
export function xzDistance(a, b) {
    const fa = footprintOf(a);
    const fb = footprintOf(b);
    if (!fa || !fb) {
        return Infinity;
    }
    const dx = Math.max(0, fa.min.x - fb.max.x, fb.min.x - fa.max.x);
    const dz = Math.max(0, fa.min.z - fb.max.z, fb.min.z - fa.max.z);
    return Math.hypot(dx, dz);
}

/**
 * The clusters of the finds (SPEC 0.1.4.16, F2): the finds grouped by connectivity, two finds connected when the x/z
 * distance between their boxes (edge to edge, 0 inside) or points is at most `gap`. The order of the clusters is the
 * order of their first find; a find without a position is a cluster of its own. Never throws.
 * @param {object[]} finds places of findPlaces (boxes and points), kept entries, saved areas or points
 * @param {number} [gap] the gap of the setting survey_cluster_gap; 48 without a finite number of 0 or more
 * @returns {object[][]} the clusters, each the finds themselves
 */
export function clustersOf(finds, gap = CLUSTER_GAP) {
    const list = listOf(finds).filter(f => f !== null && typeof f === 'object');
    const reach = isFiniteNumber(gap) && gap >= 0 ? gap : CLUSTER_GAP;
    try {
        return groupsOf(list, (a, b) => xzDistance(a, b) <= reach);
    } catch {
        return list.map(f => [f]);
    }
}

/**
 * The cluster the bot's start belongs to (F2): the one with the find whose box holds `botAt`, else the one with the find
 * nearest to it in x and z (ties: the first). -1 without clusters or a start.
 * @param {object[][]} clusters of clustersOf
 * @param {{x: number, y: number, z: number}|null} botAt
 * @returns {number} the index in `clusters`
 */
export function startClusterOf(clusters, botAt) {
    const list = listOf(clusters);
    const at = posOf(botAt);
    if (list.length === 0 || !at) {
        return list.length === 0 ? -1 : 0;
    }
    const boxOfFind = (f) => (f?.box && isBox(f.box) ? f.box : isBox(f) ? f : f?.place?.box && isBox(f.place.box) ? f.place.box : null);
    for (const [i, cluster] of list.entries()) {
        if (listOf(cluster).some(f => {
            const box = boxOfFind(f);
            return box && containsPos(box, at);
        })) {
            return i;
        }
    }
    let best = -1;
    let bestDistance = Infinity;
    for (const [i, cluster] of list.entries()) {
        const d = Math.min(...listOf(cluster).map(f => xzDistance(at, f)));
        if (d < bestDistance) {
            best = i;
            bestDistance = d;
        }
    }
    return best;
}

/**
 * The direction from one point to another as a word of DIRECTIONS (north is -z, south +z, east +x, west -x; eight sectors
 * of 45 degrees). 'north' when the points are the same.
 * @param {{x: number, z: number}} from
 * @param {{x: number, z: number}} to
 * @returns {string}
 */
export function directionOf(from, to) {
    const dx = (to?.x ?? 0) - (from?.x ?? 0);
    const dz = (to?.z ?? 0) - (from?.z ?? 0);
    if (!isFiniteNumber(dx) || !isFiniteNumber(dz) || (dx === 0 && dz === 0)) {
        return DIRECTIONS[0];
    }
    const bearing = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
    return DIRECTIONS[Math.round(bearing / 45) % 8];
}

/**
 * What the report says of a cluster the survey left out (F2): its count, the distance from the start to its nearest find
 * rounded to 10, and the direction from the start to that find.
 * @param {object[]} cluster a cluster of clustersOf
 * @param {{x: number, y: number, z: number}|null} botAt the start
 * @returns {{count: number, distance: number, dir: string, finds: object[]}}
 */
export function leftOutOf(cluster, botAt) {
    const finds = listOf(cluster);
    const at = posOf(botAt) ?? { x: 0, y: 0, z: 0 };
    let nearest = null;
    let best = Infinity;
    for (const f of finds) {
        const d = xzDistance(at, f);
        if (d < best) {
            best = d;
            nearest = f;
        }
    }
    const foot = footprintOf(nearest);
    const centre = foot ? { x: (foot.min.x + foot.max.x) / 2, z: (foot.min.z + foot.max.z) / 2 } : at;
    return { count: finds.length, distance: Number.isFinite(best) ? Math.round(best / 10) * 10 : 0, dir: directionOf(at, centre), finds };
}
