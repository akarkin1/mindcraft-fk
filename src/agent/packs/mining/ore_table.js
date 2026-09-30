// The ores the mining pack knows (spec v0.1.4.7 M1): their blocks, the item they drop, the best
// level to dig for them and the weakest pickaxe that breaks them. Since v0.1.4.9 (B4) also the range
// of levels where the ore is found (min, max: the y of the ore block). Pure: no imports.

/** The table of M1, in the order of the spec, with the ranges of v0.1.4.9 (B4). */
export const ORES = Object.freeze([
    Object.freeze({ ore: 'coal', blocks: Object.freeze(['coal_ore', 'deepslate_coal_ore']), item: 'coal', level: 96, pickaxe: 'wooden', min: 0, max: 192 }),
    Object.freeze({ ore: 'copper', blocks: Object.freeze(['copper_ore', 'deepslate_copper_ore']), item: 'raw_copper', level: 48, pickaxe: 'stone', min: -16, max: 112 }),
    Object.freeze({ ore: 'iron', blocks: Object.freeze(['iron_ore', 'deepslate_iron_ore']), item: 'raw_iron', level: 16, pickaxe: 'stone', min: -64, max: 72 }),
    Object.freeze({ ore: 'lapis', blocks: Object.freeze(['lapis_ore', 'deepslate_lapis_ore']), item: 'lapis_lazuli', level: 0, pickaxe: 'stone', min: -64, max: 64 }),
    Object.freeze({ ore: 'gold', blocks: Object.freeze(['gold_ore', 'deepslate_gold_ore']), item: 'raw_gold', level: -16, pickaxe: 'iron', min: -64, max: 32 }),
    Object.freeze({ ore: 'redstone', blocks: Object.freeze(['redstone_ore', 'deepslate_redstone_ore']), item: 'redstone', level: -59, pickaxe: 'iron', min: -64, max: 15 }),
    Object.freeze({ ore: 'diamond', blocks: Object.freeze(['diamond_ore', 'deepslate_diamond_ore']), item: 'diamond', level: -59, pickaxe: 'iron', min: -64, max: 16 }),
]);

/** The names of the ores, in the order of the table. */
export const ORE_NAMES = Object.freeze(ORES.map(row => row.ore));

/** Pickaxe materials from the weakest, with the level of blocks they break. Golden breaks what wooden breaks. */
export const PICKAXE_LEVELS = Object.freeze({ wooden: 0, golden: 0, stone: 1, iron: 2, diamond: 3, netherite: 4 });

/** Uses of a new pickaxe until it breaks, by material. */
export const PICKAXE_USES = Object.freeze({ wooden: 59, stone: 131, iron: 250, golden: 32, diamond: 1561, netherite: 2031 });

/** The weakest pickaxe the bot takes on any trip (spec M1: "for any trip at least stone"). */
export const TRIP_MIN_PICKAXE = 'stone';

// Other names of the items that lead to an ore: smelted metal and the plural a player types.
const EXTRA_NAMES = Object.freeze({
    iron_ingot: 'iron',
    copper_ingot: 'copper',
    gold_ingot: 'gold',
    lapis: 'lapis',
    lapis_lazuli: 'lapis',
    diamonds: 'diamond',
    raw_iron: 'iron',
    raw_copper: 'copper',
    raw_gold: 'gold',
    redstone_dust: 'redstone',
});

const BY_NAME = (() => {
    const map = new Map();
    for (const row of ORES) {
        map.set(row.ore, row);
        map.set(row.item, row);
        for (const block of row.blocks) {
            map.set(block, row);
        }
    }
    for (const [name, ore] of Object.entries(EXTRA_NAMES)) {
        map.set(name, ORES.find(row => row.ore === ore));
    }
    return map;
})();

/**
 * A name as the table spells it: lower case, without `minecraft:`, spaces as underscores.
 * @param {*} name
 * @returns {string|null}
 */
export function cleanOreName(name) {
    if (typeof name !== 'string') {
        return null;
    }
    const clean = name.trim().toLowerCase().replace(/^minecraft:/, '').replace(/[\s-]+/g, '_');
    return clean.length > 0 ? clean : null;
}

/**
 * The row of the table for the name of an ore, of one of its blocks or of its item, also
 * `raw_iron`, `iron_ingot` and `lapis_lazuli`; a row given as it is. null for anything else.
 * @param {string|object} name
 * @returns {{ore: string, blocks: string[], item: string, level: number, pickaxe: string, min: number, max: number}|null}
 */
export function oreOf(name) {
    if (name && typeof name === 'object' && ORES.includes(name)) {
        return name;
    }
    const clean = cleanOreName(name);
    if (clean === null) {
        return null;
    }
    return BY_NAME.get(clean) ?? BY_NAME.get(clean.replace(/_ores?$/, '')) ?? null;
}

/**
 * True for every block of the table (both stone and deepslate variants).
 * @param {string} name
 * @returns {boolean}
 */
export function isOreBlock(name) {
    const clean = cleanOreName(name);
    return clean !== null && ORES.some(row => row.blocks.includes(clean));
}

/**
 * The level to dig the tunnel at (the y of the feet of the bot in the tunnel): the best level of
 * the ore, but at least 8 below the surface and at least 5 above `minY`. When both cannot hold,
 * the distance to `minY` wins (bedrock). null for an unknown ore or a surface that is no number.
 * @param {string|object} ore
 * @param {number} surfaceY the y of the feet of the bot on the ground at the entrance
 * @param {number} [minY] the lowest y of the world
 * @returns {number|null}
 */
export function targetLevel(ore, surfaceY, minY = -64) {
    const row = oreOf(ore);
    if (!row || typeof surfaceY !== 'number' || !Number.isFinite(surfaceY)) {
        return null;
    }
    const floor = (typeof minY === 'number' && Number.isFinite(minY) ? Math.floor(minY) : -64) + 5;
    return Math.max(Math.min(row.level, Math.floor(surfaceY) - 8), floor);
}

/**
 * The weakest pickaxe material that breaks the ore, or null for an unknown ore.
 * @param {string|object} ore
 * @returns {'wooden'|'stone'|'iron'|null}
 */
export function pickaxeFor(ore) {
    const row = oreOf(ore);
    return row ? row.pickaxe : null;
}

/**
 * The weakest pickaxe the bot takes on a trip for the ore: pickaxeFor, but at least stone.
 * @param {string|object} ore
 * @returns {string|null}
 */
export function tripPickaxe(ore) {
    const need = pickaxeFor(ore);
    if (need === null) {
        return null;
    }
    return PICKAXE_LEVELS[need] >= PICKAXE_LEVELS[TRIP_MIN_PICKAXE] ? need : TRIP_MIN_PICKAXE;
}

/**
 * The material of a pickaxe item name (`iron_pickaxe` -> `iron`), or null for anything else.
 * @param {string} name
 * @returns {string|null}
 */
export function pickaxeMaterial(name) {
    const clean = cleanOreName(name);
    const m = clean === null ? null : /^([a-z]+)_pickaxe$/.exec(clean);
    return m && Object.prototype.hasOwnProperty.call(PICKAXE_LEVELS, m[1]) ? m[1] : null;
}

/**
 * True when a pickaxe of `material` breaks what `needed` breaks.
 * @param {string} material
 * @param {string} needed
 * @returns {boolean}
 */
export function pickaxeIsEnough(material, needed) {
    const have = PICKAXE_LEVELS[material];
    const want = PICKAXE_LEVELS[needed];
    return typeof have === 'number' && typeof want === 'number' && have >= want;
}
