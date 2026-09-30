// The decisions of the storage pack (spec v0.1.4.7 S2), pure: what the bot keeps and what it stores,
// which chest takes an item, the two halves of a double chest, and what the slots of a container hold.
import { BANNED_FOOD } from '../home/food_logic.js';

/** Blocks the storage pack opens. */
export const CONTAINER_KINDS = Object.freeze(['chest', 'trapped_chest', 'barrel']);

/** Kinds of tools of the keep plan. */
export const TOOL_KINDS = Object.freeze(['pickaxe', 'axe', 'shovel', 'hoe', 'sword']);
/** Materials of tools, from the best to the weakest. */
export const MATERIALS = Object.freeze(['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden']);

/** Items the bot keeps up to a count, by name. A bed is kept once, whatever its colour. */
export const KEEP_LIMITS = Object.freeze({ torch: 64, ladder: 64, cobblestone: 32, crafting_table: 1, water_bucket: 1, bucket: 1 });
/** Pieces of food the bot keeps, the best first. */
export const FOOD_KEEP = 16;
/** Arrows the bot keeps, all kinds together, `arrow` first. */
export const ARROW_KEEP = 64;

const ARROWS = ['arrow', 'spectral_arrow', 'tipped_arrow'];
const ARMOUR_SUFFIXES = ['_helmet', '_chestplate', '_leggings', '_boots'];
const KEEP_ALL = new Set(['elytra', 'shield', 'bow', 'crossbow']);

// Food points of common food, for a call without bot.registry.foodsByName.
const FOOD_POINTS = Object.freeze({
    apple: 4, baked_potato: 5, beef: 3, beetroot: 1, beetroot_soup: 6, bread: 5, carrot: 3, chicken: 2, cod: 2,
    cooked_beef: 8, cooked_chicken: 6, cooked_cod: 5, cooked_mutton: 6, cooked_porkchop: 8, cooked_rabbit: 5,
    cooked_salmon: 6, cookie: 2, dried_kelp: 1, glow_berries: 2, golden_apple: 4, golden_carrot: 6, honey_bottle: 6,
    melon_slice: 2, mushroom_stew: 6, mutton: 2, porkchop: 3, potato: 1, pumpkin_pie: 8, rabbit: 3, rabbit_stew: 10,
    rotten_flesh: 4, salmon: 2, spider_eye: 2, sweet_berries: 2,
});

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
}

// Same order as Array.prototype.sort without a comparator.
function compareNames(a, b) {
    if (a < b) {
        return -1;
    }
    return a > b ? 1 : 0;
}

/**
 * An item or block name without the `minecraft:` prefix, trimmed and in lower case; null for
 * anything that is not a non-empty string.
 * @param {*} name
 * @returns {string|null}
 */
export function cleanName(name) {
    if (typeof name !== 'string') {
        return null;
    }
    const clean = name.trim().toLowerCase().replace(/^minecraft:/, '');
    return clean.length > 0 ? clean : null;
}

/**
 * Dimension name without the `minecraft:` prefix; empty or not a string means the overworld.
 * @param {*} value
 * @returns {string}
 */
export function normalizeDimension(value) {
    const name = typeof value === 'string' ? value.replace(/^minecraft:/, '') : '';
    return name.length > 0 ? name : 'overworld';
}

/** The dimensions of the game, without the `minecraft:` prefix. */
export const DIMENSIONS = Object.freeze(['overworld', 'the_nether', 'the_end']);

/**
 * True for the name of a dimension, with or without `minecraft:` (v0.1.4.8, E1: chestsText takes
 * an item where v0.1.4.7 took the dimension, and tells the two apart).
 * @param {*} value
 * @returns {boolean}
 */
export function isDimensionName(value) {
    return typeof value === 'string' && DIMENSIONS.includes(value.trim().toLowerCase().replace(/^minecraft:/, ''));
}

/**
 * The key of a chest in the index: `"<x>,<y>,<z>"` of the floored coordinates.
 * @param {{x: number, y: number, z: number}} pos
 * @returns {string|null} null for a bad position
 */
export function chestKey(pos) {
    if (!isPoint(pos)) {
        return null;
    }
    return `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
}

/**
 * True for `chest`, `trapped_chest` and `barrel`.
 * @param {string} name
 * @returns {boolean}
 */
export function isContainerKind(name) {
    return CONTAINER_KINDS.includes(name);
}

/**
 * The half of a double chest that gives the key: the one with the smaller x, then the smaller z.
 * @param {{x,y,z}} a
 * @param {{x,y,z}|null} b the other half, or null for a single chest
 * @returns {{x: number, y: number, z: number}}
 */
export function keyHalf(a, b) {
    if (!isPoint(b)) {
        return { x: a.x, y: a.y, z: a.z };
    }
    const first = a.x < b.x || (a.x === b.x && a.z <= b.z) ? a : b;
    return { x: first.x, y: first.y, z: first.z };
}

const CLOCKWISE = { north: [1, 0], east: [0, 1], south: [-1, 0], west: [0, -1] };

/**
 * The position of the other half of a double chest, from the block properties `facing` and `type`
 * (`single`, `left`, `right`) as the game connects them: a left half has its partner clockwise of
 * its facing, a right half counter-clockwise. null for a single chest or unknown properties.
 * @param {{x,y,z}} pos
 * @param {{facing?: string, type?: string}} props
 * @returns {{x: number, y: number, z: number}|null}
 */
export function otherHalfOf(pos, props) {
    if (!isPoint(pos) || !isPlainObject(props) || !CLOCKWISE[props.facing] || (props.type !== 'left' && props.type !== 'right')) {
        return null;
    }
    const [dx, dz] = CLOCKWISE[props.facing];
    const sign = props.type === 'left' ? 1 : -1;
    return { x: pos.x + sign * dx, y: pos.y, z: pos.z + sign * dz };
}

/**
 * Straight distance from a point to the centre of the block of a chest; Infinity for bad input.
 * @param {{x,y,z}} from
 * @param {{x,y,z}} chest
 * @returns {number}
 */
export function distanceTo(from, chest) {
    if (!isPoint(from) || !isPoint(chest)) {
        return Infinity;
    }
    const cx = Math.floor(chest.x) + 0.5;
    const cy = Math.floor(chest.y) + 0.5;
    const cz = Math.floor(chest.z) + 0.5;
    return Math.sqrt((from.x - cx) ** 2 + (from.y - cy) ** 2 + (from.z - cz) ** 2);
}

/**
 * The kind of a tool of the table: pickaxe, axe, shovel, hoe, sword; null otherwise.
 * @param {string} name
 * @returns {string|null}
 */
export function toolKindOf(name) {
    if (typeof name !== 'string') {
        return null;
    }
    return TOOL_KINDS.find(kind => name.endsWith(`_${kind}`)) ?? null;
}

/**
 * The material of a tool name (`golden` for `golden_axe`), null when it is none of MATERIALS.
 * @param {string} name
 * @returns {string|null}
 */
export function materialOf(name) {
    if (typeof name !== 'string') {
        return null;
    }
    return MATERIALS.find(m => name.startsWith(`${m}_`)) ?? null;
}

/**
 * True for armour the bot wears: helmets, chestplates, leggings, boots and `elytra`. Horse and wolf
 * armour are not.
 * @param {string} name
 * @returns {boolean}
 */
export function isArmour(name) {
    return typeof name === 'string' && (name === 'elytra' || ARMOUR_SUFFIXES.some(s => name.endsWith(s)));
}

/**
 * True for seeds: names ending in `_seeds`, and `pitcher_pod`. Carrots and potatoes count as food.
 * @param {string} name
 * @returns {boolean}
 */
export function isSeed(name) {
    return typeof name === 'string' && (name.endsWith('_seeds') || name === 'pitcher_pod');
}

/**
 * True for beds of any colour.
 * @param {string} name
 * @returns {boolean}
 */
export function isBed(name) {
    return typeof name === 'string' && name.endsWith('_bed');
}

/**
 * Counts to keep by name, from `{ name: count }` (count -1 for all), a list of names or one name
 * (all of them). Invalid counts are left out.
 * @param {*} value
 * @returns {Map<string, number>} Infinity stands for all
 */
export function normalizeKeepCounts(value) {
    const out = new Map();
    const add = (name, count) => {
        const clean = cleanName(name);
        if (clean === null) {
            return;
        }
        if (count === -1) {
            out.set(clean, Infinity);
        } else if (isFiniteNumber(count) && count >= 0) {
            out.set(clean, Math.floor(count));
        }
    };
    if (typeof value === 'string') {
        add(value, -1);
    } else if (Array.isArray(value)) {
        value.forEach(name => add(name, -1));
    } else if (isPlainObject(value)) {
        Object.entries(value).forEach(([name, count]) => add(name, count));
    }
    return out;
}

function foodEntry(foods, name) {
    if (BANNED_FOOD.includes(name)) {
        return null;
    }
    if (isPlainObject(foods)) {
        const entry = Object.prototype.hasOwnProperty.call(foods, name) ? foods[name] : null;
        return isPlainObject(entry) && isFiniteNumber(entry.foodPoints)
            ? { points: entry.foodPoints, saturation: isFiniteNumber(entry.saturation) ? entry.saturation : 0 }
            : null;
    }
    return Object.prototype.hasOwnProperty.call(FOOD_POINTS, name) ? { points: FOOD_POINTS[name], saturation: 0 } : null;
}

function cleanInventory(inventory) {
    if (!Array.isArray(inventory)) {
        return [];
    }
    const out = [];
    inventory.forEach((item, index) => {
        if (!isPlainObject(item)) {
            return;
        }
        const name = cleanName(item.name);
        const count = isFiniteNumber(item.count) ? Math.floor(item.count) : 0;
        if (name === null || name === 'air' || count <= 0) {
            return;
        }
        out.push({
            name,
            count,
            slot: isFiniteNumber(item.slot) ? item.slot : null,
            uses_left: isFiniteNumber(item.uses_left) ? item.uses_left : null,
            index,
        });
    });
    return out;
}

// Better first: more uses left, an unknown number last, then the inventory order.
function byUsesLeft(a, b) {
    const ua = a.uses_left ?? -Infinity;
    const ub = b.uses_left ?? -Infinity;
    return ub - ua || a.index - b.index;
}

function materialRank(name) {
    const i = MATERIALS.indexOf(materialOf(name));
    return i < 0 ? MATERIALS.length : i;
}

function sortCounts(list) {
    return list.sort((a, b) => b.count - a.count || compareNames(a.name, b.name));
}

/**
 * Decides what stays with the bot and what goes into a chest. `inventory` is a list of
 * `{ name, count, slot, uses_left }` (several entries per name are fine). What the bot keeps:
 * the best pickaxe, axe, shovel, hoe and sword by material (netherite, diamond, iron, stone,
 * golden, wooden; among equal ones more uses left) and one more pickaxe; all armour, shields, bows
 * and crossbows; arrows up to 64; food up to 16 pieces, the best first (banned food of the home pack
 * is no food here); `torch` and `ladder` up to 64; `cobblestone` up to 32; one `crafting_table`,
 * `water_bucket`, `bucket` and bed; the counts of `options.keep` and `options.keepItems` (the
 * setting keep_items), -1 for all. Seeds and `bone_meal` are kept only when one of them names them.
 * When several rules name an item, the largest count wins. Everything else is stored.
 * With `options.only` (a name or a list of names) only those items are stored, less the counts of
 * `options.keep`, and everything else is kept.
 * @param {{name: string, count: number, slot?: number, uses_left?: number|null}[]} inventory
 * @param {{only?: string|string[], keep?: object|string[]|string, keepItems?: object, foods?: object}} [options]
 *   foods: bot.registry.foodsByName; without it a table of common food is used
 * @returns {{keep: {name: string, count: number}[], store: {name: string, count: number, slots?: number[]}[]}}
 *   sorted by count, highest first, then by name. A stored tool, or anything with uses left, names
 *   the inventory slots of the stored pieces in `slots`.
 */
export function keepPlan(inventory, options = {}) {
    const opts = isPlainObject(options) ? options : {};
    const entries = cleanInventory(inventory);
    const byName = new Map();
    for (const entry of entries) {
        if (!byName.has(entry.name)) {
            byName.set(entry.name, []);
        }
        byName.get(entry.name).push(entry);
    }
    const total = name => byName.get(name).reduce((sum, e) => sum + e.count, 0);
    const keepCount = new Map();
    const raise = (name, n) => keepCount.set(name, Math.max(keepCount.get(name) ?? 0, n));
    const marked = new Set();
    const explicit = normalizeKeepCounts(opts.keep);
    const onlyList = typeof opts.only === 'string' ? [opts.only] : (Array.isArray(opts.only) ? opts.only : []);
    const only = new Set(onlyList.map(cleanName).filter(Boolean));

    if (only.size > 0) {
        for (const name of byName.keys()) {
            if (!only.has(name)) {
                raise(name, Infinity);
            } else if (explicit.has(name)) {
                raise(name, explicit.get(name));
            }
        }
    } else {
        for (const kind of TOOL_KINDS) {
            const tools = entries.filter(e => toolKindOf(e.name) === kind)
                .sort((a, b) => materialRank(a.name) - materialRank(b.name) || byUsesLeft(a, b));
            for (const tool of tools.slice(0, kind === 'pickaxe' ? 2 : 1)) {
                marked.add(tool);
                raise(tool.name, [...marked].filter(e => e.name === tool.name).length);
            }
        }
        let arrows = ARROW_KEEP;
        for (const name of ARROWS.filter(n => byName.has(n))) {
            const n = Math.min(total(name), arrows);
            raise(name, n);
            arrows -= n;
        }
        const foods = [...byName.keys()].map(name => ({ name, food: foodEntry(opts.foods, name) })).filter(f => f.food)
            .sort((a, b) => b.food.points - a.food.points || b.food.saturation - a.food.saturation || compareNames(a.name, b.name));
        let food = FOOD_KEEP;
        for (const { name } of foods) {
            const n = Math.min(total(name), food);
            raise(name, n);
            food -= n;
        }
        const beds = [...byName.keys()].filter(isBed).sort(compareNames);
        if (beds.length > 0) {
            raise(beds[0], 1);
        }
        for (const name of byName.keys()) {
            if (isArmour(name) || KEEP_ALL.has(name)) {
                raise(name, Infinity);
            }
            if (Object.prototype.hasOwnProperty.call(KEEP_LIMITS, name)) {
                raise(name, KEEP_LIMITS[name]);
            }
        }
        for (const counts of [explicit, normalizeKeepCounts(opts.keepItems)]) {
            for (const [name, n] of counts) {
                if (byName.has(name)) {
                    raise(name, n);
                }
            }
        }
    }

    const keep = [];
    const store = [];
    for (const [name, list] of byName) {
        const ordered = [...list].sort((a, b) => Number(marked.has(b)) - Number(marked.has(a)) || byUsesLeft(a, b));
        let toKeep = keepCount.get(name) ?? 0;
        let kept = 0;
        let stored = 0;
        const slots = [];
        for (const entry of ordered) {
            const k = Math.min(entry.count, toKeep);
            toKeep -= k;
            kept += k;
            stored += entry.count - k;
            if (k === 0 && entry.slot !== null) {
                slots.push(entry.slot);
            }
        }
        if (kept > 0) {
            keep.push({ name, count: kept });
        }
        if (stored > 0) {
            const withSlots = toolKindOf(name) !== null || list.some(e => e.uses_left !== null);
            store.push(withSlots ? { name, count: stored, slots } : { name, count: stored });
        }
    }
    return { keep: sortCounts(keep), store: sortCounts(store) };
}

/**
 * The chest for an item: a chest that already holds it and has a free slot, the nearest first;
 * otherwise the nearest with a free slot. Ties by position. null when no chest has space.
 * @param {object[]} chests chests of the index ({ x, y, z, items, free_slots })
 * @param {{x,y,z}} botPos
 * @param {string} [item]
 * @returns {object|null} one of the given chests
 */
export function chooseChest(chests, botPos, item) {
    if (!Array.isArray(chests)) {
        return null;
    }
    const withSpace = chests.filter(c => isPoint(c) && isFiniteNumber(c.free_slots) && c.free_slots >= 1);
    const name = cleanName(item);
    const holding = name === null ? [] : withSpace.filter(c => isPlainObject(c.items) && c.items[name] > 0);
    const pool = holding.length > 0 ? holding : withSpace;
    let best = null;
    let bestDistance = Infinity;
    for (const chest of pool) {
        const d = distanceTo(botPos, chest);
        if (best === null || d < bestDistance || (d === bestDistance && comparePositions(chest, best) < 0)) {
            best = chest;
            bestDistance = d;
        }
    }
    return best;
}

/**
 * Order of positions by x, then y, then z.
 * @param {{x,y,z}} a
 * @param {{x,y,z}} b
 * @returns {number}
 */
export function comparePositions(a, b) {
    return a.x - b.x || a.y - b.y || a.z - b.z;
}

function slotList(slots) {
    return Array.isArray(slots) ? slots.filter(s => isPlainObject(s) && typeof s.name === 'string' && isFiniteNumber(s.count) && s.count > 0) : [];
}

/**
 * What the slots of a container hold: counts by name and the number of empty slots.
 * @param {({name: string, count: number}|null)[]} slots the container slots of a window
 * @returns {{items: Object<string, number>, free_slots: number}}
 */
export function summarizeSlots(slots) {
    if (!Array.isArray(slots)) {
        return { items: {}, free_slots: 0 };
    }
    const items = {};
    for (const s of slotList(slots)) {
        items[s.name] = (items[s.name] ?? 0) + s.count;
    }
    return { items, free_slots: slots.length - slotList(slots).length };
}

/**
 * How many of an item the slots hold.
 * @param {object[]} slots
 * @param {string} name
 * @returns {number}
 */
export function countIn(slots, name) {
    return slotList(slots).filter(s => s.name === name).reduce((sum, s) => sum + s.count, 0);
}

/**
 * How many of an item fit into the slots: the rest of the stacks of that item and the empty slots.
 * @param {object[]} slots
 * @param {string} name
 * @param {number} [stackSize] 64 when not given
 * @returns {number}
 */
export function roomFor(slots, name, stackSize = 64) {
    if (!Array.isArray(slots)) {
        return 0;
    }
    const size = isFiniteNumber(stackSize) && stackSize > 0 ? stackSize : 64;
    let room = 0;
    for (const s of slots) {
        if (!isPlainObject(s) || !(s.count > 0)) {
            room += size;
        } else if (s.name === name) {
            room += Math.max(0, size - s.count);
        }
    }
    return room;
}
