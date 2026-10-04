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
