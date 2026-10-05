// The supply step of a trip (spec v0.1.4.13, P1), pure: in which order the bot gets what tripNeeds says it
// lacks (the chests within 16 blocks of the bot first, then the chests it knows, nearest first, then crafting
// from what it carries, the surface last), and when a trip wants a spare pickaxe. The executing part is
// prepareMiningTrip of mining.js. Nothing here throws.
import { isEdibleFood } from '../home/food_logic.js';
import { pickaxeIsEnough, pickaxeMaterial } from './ore_table.js';

/** A chest within this many blocks of the bot is read before every other chest. */
export const SUPPLY_NEAR_RANGE = 16;
/** A trip wants a spare pickaxe when the one in hand has fewer uses left than this. */
export const SPARE_PICKAXE_USES = 50;

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
}

function distance(from, chest) {
    return Math.hypot(chest.x + 0.5 - (from.x + 0.5), chest.y + 0.5 - (from.y + 0.5), chest.z + 0.5 - (from.z + 0.5));
}

function isFood(name, foods) {
    if (foods && typeof foods === 'object' && !Array.isArray(foods)) {
        return isEdibleFood(name, foods);
    }
    if (Array.isArray(foods)) {
        return foods.includes(name);
    }
    return false;
}

// True when an item of a chest serves a missing supply: food by the food table, a pickaxe by its material, else
// the same name.
function serves(itemName, missing, foods) {
    if (missing.name === 'food') {
        return isFood(itemName, foods);
    }
    if (missing.name === 'pickaxe') {
        const m = pickaxeMaterial(itemName);
        return m !== null && pickaxeIsEnough(m, missing.material ?? 'wooden');
    }
    return itemName === missing.name;
}

/**
 * The missing list of tripNeeds with the spare pickaxe of P1: the trip wants a spare only when it carries one
 * usable pickaxe with fewer than 50 uses left (SPARE_PICKAXE_USES); the rule of tripNeeds (the blocks of the
 * trip against the uses) is dropped. Without a pickaxe at all the first pickaxe stays missing, no spare.
 * @param {object[]} missing the missing list of tripNeeds
 * @param {{name: string, material: string, uses: number}[]} pickaxes usablePickaxes of the inventory, the best first
 * @param {string} material the material of the trip
 * @returns {object[]} a new list
 */
export function applySpareRule(missing, pickaxes, material) {
    const list = (Array.isArray(missing) ? missing : []).filter(m => m && !(m.name === 'pickaxe' && m.spare === true));
    const have = Array.isArray(pickaxes) ? pickaxes.filter(p => p && isFiniteNumber(p.uses)) : [];
    if (have.length === 1 && have[0].uses < SPARE_PICKAXE_USES) {
        list.push({ name: 'pickaxe', material: material ?? have[0].material, count: 1, spare: true });
    }
    return list;
}

/** The items a stone pickaxe is crafted from (the `accepts` of the wood pack's stone material). */
export const STONE_TOOL_ITEMS = Object.freeze(['cobblestone', 'cobbled_deepslate', 'blackstone']);
/** An ore that needs only stone gets an iron pickaxe only when the bag holds more iron ingots than this. */
export const IRON_STASH = 20;
/** Of the head material, a pickaxe takes 3. */
const PICKAXE_HEAD = 3;

function countIn(inventory, names) {
    let n = 0;
    for (const item of Array.isArray(inventory) ? inventory : []) {
        if (item && names.includes(item.name) && isFiniteNumber(item.count)) {
            n += Math.max(0, Math.floor(item.count));
        }
    }
    return n;
}

/**
 * The material of a pickaxe to craft from what the bag holds (the correction of 2026-10-04, no switch): the cheapest
 * that mines the ore of the trip. `need` is the trip's material (tripPickaxe: stone for stone, coal, copper, iron and
 * lapis; iron for gold, redstone and diamond). Stone from 3 cobblestone (or cobbled_deepslate, blackstone); iron from 3
 * iron ingots when the ore needs iron, and for an ore that needs only stone only when the bag holds more than 20 iron
 * ingots and too little cobblestone for a stone one; diamond only for an ore that needs diamond, never for one that
 * needs less. null when the bag holds nothing to craft one from. Sticks and the crafting table are the business of
 * ensureTool.
 * @param {string} need wooden, stone, iron or diamond
 * @param {{name: string, count: number}[]} inventory
 * @returns {'stone'|'iron'|'diamond'|null}
 */
export function pickaxeToCraft(need, inventory) {
    const level = { wooden: 0, golden: 0, stone: 1, iron: 2, diamond: 3 }[need];
    if (level === undefined) {
        return null;
    }
    const stone = countIn(inventory, STONE_TOOL_ITEMS) >= PICKAXE_HEAD;
    const ingots = countIn(inventory, ['iron_ingot']);
    if (level <= 1) {
        if (stone) {
            return 'stone';
        }
        return ingots > IRON_STASH ? 'iron' : null;
    }
    if (level === 2) {
        return ingots >= PICKAXE_HEAD ? 'iron' : null;
    }
    return countIn(inventory, ['diamond']) >= PICKAXE_HEAD ? 'diamond' : null;
}

/**
 * Where the missing supplies come from (P1): the chests within 16 blocks of the bot (SUPPLY_NEAR_RANGE) first,
 * then the other chests, each group nearest first; from each chest what it holds of the supplies still missing.
 * Food is any edible item (`foods`: the food table of the registry, or a list of names), a pickaxe any pickaxe
 * that breaks what the trip needs, everything else its own name. What no chest gives is `rest`.
 * @param {{missing: object[], from: {x,y,z}, chests: object[], foods?: object|string[]}} input missing: the list of
 *   tripNeeds (with the spare rule applied); from: the feet of the bot; chests: the chests of the index of this
 *   dimension, { x, y, z, items: { name: count } }
 * @returns {{takes: {chest: {x: number, y: number, z: number}, near: boolean, items: Object<string, number>}[], rest: object[]}}
 */
export function supplyPlan({ missing, from, chests, foods } = {}) {
    const wanted = (Array.isArray(missing) ? missing : []).filter(m => m && typeof m.name === 'string' && m.name !== 'cobblestone')
        .map(m => ({ ...m, left: isFiniteNumber(m.count) && m.count > 0 ? Math.ceil(m.count) : 1 }));
    const takes = [];
    if (!isPoint(from) || !Array.isArray(chests)) {
        return { takes, rest: wanted.filter(m => m.left > 0).map(({ left, ...m }) => ({ ...m, count: left })) };
    }
    const seen = new Set();
    const sorted = chests.filter(c => isPoint(c) && c.items && typeof c.items === 'object')
        .map(c => ({ chest: c, d: distance(from, c) }))
        .filter(({ chest }) => {
            const k = `${chest.x},${chest.y},${chest.z}`;
            if (seen.has(k)) {
                return false;
            }
            seen.add(k);
            return true;
        })
        .sort((a, b) => Number(b.d <= SUPPLY_NEAR_RANGE) - Number(a.d <= SUPPLY_NEAR_RANGE) || a.d - b.d);
    for (const { chest, d } of sorted) {
        const items = {};
        for (const m of wanted) {
            if (m.left <= 0) {
                continue;
            }
            const names = Object.keys(chest.items).filter(name => isFiniteNumber(chest.items[name]) && chest.items[name] > 0 && serves(name, m, foods))
                .sort((a, b) => chest.items[b] - chest.items[a] || (a < b ? -1 : a > b ? 1 : 0));
            for (const name of names) {
                if (m.left <= 0) {
                    break;
                }
                const n = Math.min(chest.items[name], m.left);
                items[name] = (items[name] ?? 0) + n;
                m.left -= n;
            }
        }
        if (Object.keys(items).length > 0) {
            takes.push({ chest: { x: chest.x, y: chest.y, z: chest.z }, near: d <= SUPPLY_NEAR_RANGE, items });
        }
    }
    return { takes, rest: wanted.filter(m => m.left > 0).map(({ left, ...m }) => ({ ...m, count: left })) };
}
