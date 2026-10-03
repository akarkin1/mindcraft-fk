// The decisions of smelting (spec v0.1.4.12, 4.2), pure: what a furnace makes of an item, which fuel
// and how much of it, which furnace the bot uses and where it places one, and the time limit.
//
// The products: minecraft-data 1.21.8 has no smelting recipes (its `recipes` hold the crafting table
// only), so the common ones are in the table below. No imports.

/** What the furnace makes of an item, for the items that are no log or wood. */
export const SMELT_PRODUCTS = Object.freeze({
    raw_iron: 'iron_ingot',
    raw_copper: 'copper_ingot',
    raw_gold: 'gold_ingot',
    iron_ore: 'iron_ingot',
    deepslate_iron_ore: 'iron_ingot',
    copper_ore: 'copper_ingot',
    deepslate_copper_ore: 'copper_ingot',
    gold_ore: 'gold_ingot',
    deepslate_gold_ore: 'gold_ingot',
    sand: 'glass',
    red_sand: 'glass',
    cobblestone: 'stone',
    clay_ball: 'brick',
    beef: 'cooked_beef',
    porkchop: 'cooked_porkchop',
    chicken: 'cooked_chicken',
    mutton: 'cooked_mutton',
    rabbit: 'cooked_rabbit',
    cod: 'cooked_cod',
    salmon: 'cooked_salmon',
    potato: 'baked_potato',
    kelp: 'dried_kelp',
    netherrack: 'nether_brick',
    cactus: 'green_dye',
});

/** Fuel by kind, in the order the bot uses it, with the items one unit smelts. */
export const FUELS = Object.freeze([
    Object.freeze({ kind: 'coal', per: 8 }),
    Object.freeze({ kind: 'charcoal', per: 8 }),
    Object.freeze({ kind: 'planks', per: 1.5 }),
    Object.freeze({ kind: 'logs', per: 1.5 }),
]);

/** At most this many items go into the furnace at once. */
export const BATCH_MAX = 64;
/** A furnace within this distance is used. */
export const FURNACE_RANGE = 16;
/** A furnace from the inventory is placed within this distance. */
export const PLACE_RANGE = 8;
/** The furnace is read this often, in ms. */
export const POLL_MS = 2000;
/** The time limit: this much per item ... */
export const PER_ITEM_MS = 12000;
/** ... plus this much. */
export const EXTRA_MS = 10000;
/** The kinds of saved areas in which the bot may place a furnace. */
export const FURNACE_AREA_KINDS = Object.freeze(['storage', 'building', 'home', 'mine']);
/** The kinds of saved areas in which it never places one. */
export const NO_FURNACE_KINDS = Object.freeze(['pen', 'farm', 'yard']);

// Planks and logs of the nether do not burn.
const NETHER_WOOD = /^(stripped_)?(crimson|warped)_/;

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
}

// A saved area's box, both ends included, as box_math of the home pack reads it.
function isBox(box) {
    return box !== null && typeof box === 'object' && isPoint(box.min) && isPoint(box.max)
        && box.min.x <= box.max.x && box.min.y <= box.max.y && box.min.z <= box.max.z;
}

function containsPos(box, pos) {
    if (!isPoint(pos) || !isBox(box)) {
        return false;
    }
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    const z = Math.floor(pos.z);
    return x >= box.min.x && x <= box.max.x && y >= box.min.y && y <= box.max.y && z >= box.min.z && z <= box.max.z;
}

function clean(name) {
    if (typeof name !== 'string') {
        return null;
    }
    const n = name.trim().toLowerCase().replace(/^minecraft:/, '');
    return n.length > 0 ? n : null;
}

/**
 * True for a log or a wood block that burns (`oak_log`, `stripped_birch_wood`); never the stems of the nether.
 * @param {string} name
 * @returns {boolean}
 */
export function isBurningLog(name) {
    const n = clean(name);
    return n !== null && /^[a-z_]+_(log|wood)$/.test(n) && !NETHER_WOOD.test(n);
}

/**
 * True for planks that burn (`oak_planks`, `bamboo_planks`); never crimson or warped planks.
 * @param {string} name
 * @returns {boolean}
 */
export function isBurningPlanks(name) {
    const n = clean(name);
    return n !== null && /^[a-z_]+_planks$/.test(n) && !NETHER_WOOD.test(n);
}

/**
 * What a furnace makes of an item: `raw_iron` -> `iron_ingot`, `oak_log` -> `charcoal`; null for an item
 * the furnace does not change. `minecraft:` and case do not matter.
 * @param {string} item
 * @returns {string|null}
 */
export function productOf(item) {
    const n = clean(item);
    if (n === null) {
        return null;
    }
    if (Object.hasOwn(SMELT_PRODUCTS, n)) {
        return SMELT_PRODUCTS[n];
    }
    return isBurningLog(n) ? 'charcoal' : null;
}

/**
 * The fuel kind of an item: `coal`, `charcoal`, `planks`, `logs`; null for anything else (lava buckets
 * and blaze rods are never fuel here).
 * @param {string} name
 * @returns {string|null}
 */
export function fuelKindOf(name) {
    const n = clean(name);
    if (n === 'coal' || n === 'charcoal') {
        return n;
    }
    if (isBurningPlanks(n)) {
        return 'planks';
    }
    return isBurningLog(n) ? 'logs' : null;
}

/**
 * The items one unit of a fuel smelts: coal and charcoal 8, planks and logs 1.5; 0 for no fuel.
 * @param {string} name
 * @returns {number}
 */
export function fuelPer(name) {
    const kind = fuelKindOf(name);
    return kind ? FUELS.find(f => f.kind === kind).per : 0;
}

/**
 * The units of a fuel that smelt `count` items.
 * @param {number} per
 * @param {number} count
 * @returns {number}
 */
export function unitsFor(per, count) {
    if (!(per > 0) || !(count > 0)) {
        return 0;
    }
    return Math.ceil(count / per - 1e-9);
}

function countsOf(inventory) {
    const out = {};
    if (Array.isArray(inventory)) {
        for (const e of inventory) {
            const n = clean(e?.name);
            if (n !== null && isFiniteNumber(e.count) && e.count > 0) {
                out[n] = (out[n] ?? 0) + e.count;
            }
        }
    } else if (inventory && typeof inventory === 'object') {
        for (const [name, count] of Object.entries(inventory)) {
            const n = clean(name);
            if (n !== null && isFiniteNumber(count) && count > 0) {
                out[n] = (out[n] ?? 0) + count;
            }
        }
    }
    return out;
}

/**
 * The fuel for `count` items (spec 4.2, 2): coal or charcoal (8 items each), then planks (1.5), then logs
 * (1.5), one name, since the fuel slot of a furnace holds one kind. The first fuel in that order that
 * covers the count gives the fewest units that cover it. When none covers it, the fuel that covers the
 * most, all of it (`covers` below `count`). Within planks and logs the name the bot has most of. Lava
 * buckets and blaze rods are never used. null without any fuel.
 * @param {Object<string, number>|{name: string, count: number}[]} inventory
 * @param {number} count
 * @returns {{name: string, count: number, per: number, covers: number}|null} count: the units to put in;
 *   covers: the items they smelt (at most `count` when they cover it)
 */
export function chooseFuel(inventory, count) {
    const n = isFiniteNumber(count) && count > 0 ? Math.ceil(count) : 0;
    const have = countsOf(inventory);
    const options = [];
    for (const fuel of FUELS) {
        const names = Object.keys(have).filter(name => fuelKindOf(name) === fuel.kind)
            .sort((a, b) => have[b] - have[a] || (a < b ? -1 : a > b ? 1 : 0));
        for (const name of names) {
            options.push({ name, have: have[name], per: fuel.per });
        }
    }
    if (options.length === 0) {
        return null;
    }
    if (n === 0) {
        const first = options[0];
        return { name: first.name, count: 0, per: first.per, covers: 0 };
    }
    for (const o of options) {
        const units = unitsFor(o.per, n);
        if (o.have >= units) {
            return { name: o.name, count: units, per: o.per, covers: n };
        }
    }
    let best = options[0];
    for (const o of options) {
        if (Math.floor(o.have * o.per) > Math.floor(best.have * best.per)) {
            best = o;
        }
    }
    return { name: best.name, count: best.have, per: best.per, covers: Math.floor(best.have * best.per) };
}

/**
 * The time limit of a smelt of `count` items: 12 s per item plus 10 s.
 * @param {number} count
 * @returns {number} ms
 */
export function timeLimitMs(count) {
    const n = isFiniteNumber(count) && count > 0 ? count : 0;
    return n * PER_ITEM_MS + EXTRA_MS;
}

/**
 * The batches of a smelt: at most 64 each. `[64, 64, 2]` for 130.
 * @param {number} count
 * @returns {number[]}
 */
export function batchesOf(count) {
    const out = [];
    let left = isFiniteNumber(count) && count > 0 ? Math.floor(count) : 0;
    while (left > 0) {
        const b = Math.min(BATCH_MAX, left);
        out.push(b);
        left -= b;
    }
    return out;
}

function distance(a, b) {
    return Math.hypot(a.x + 0.5 - b.x, a.y + 0.5 - b.y, a.z + 0.5 - b.z);
}

function byDistance(from) {
    return (a, b) => distance(a, from) - distance(b, from) || a.x - b.x || a.y - b.y || a.z - b.z;
}

/**
 * The kind of a saved area: its `kind` (pen, farm, home, storage, building, yard), else its type.
 * @param {object} area
 * @returns {string|null}
 */
export function areaKindOf(area) {
    if (typeof area?.kind === 'string' && area.kind.length > 0) {
        return area.kind;
    }
    return typeof area?.type === 'string' ? area.type : null;
}

/**
 * True when a furnace may stand on the cell as far as the saved areas go (spec 4.2, 1): the cell lies in
 * an area of kind storage, building, home or mine and in no pen, farm or yard; without any area every
 * cell. `areas` are the areas of the dimension.
 * @param {{x,y,z}} cell
 * @param {object[]} areas
 * @returns {boolean}
 */
export function cellAllowsFurnace(cell, areas) {
    const list = (Array.isArray(areas) ? areas : []).filter(isBox);
    if (list.length === 0) {
        return isPoint(cell);
    }
    const holding = list.filter(a => containsPos(a, cell));
    if (holding.some(a => NO_FURNACE_KINDS.includes(areaKindOf(a)))) {
        return false;
    }
    return holding.some(a => FURNACE_AREA_KINDS.includes(areaKindOf(a)));
}

/**
 * The cell for a furnace from the inventory: the nearest free floor cell within 8 blocks of `from` that
 * cellAllowsFurnace and `canPlace(cell, 'furnace')` allow; null when there is none. `cells` are the free
 * floor cells (the caller reads the world). A canPlace that throws counts as a refusal.
 * @param {{x,y,z}[]} cells
 * @param {object[]} areas
 * @param {{x,y,z}} from the position of the bot
 * @param {(cell: object, item: string) => boolean} [canPlace]
 * @returns {{x: number, y: number, z: number}|null}
 */
export function chooseFurnaceSpot(cells, areas, from, canPlace = null) {
    if (!isPoint(from)) {
        return null;
    }
    const list = (Array.isArray(cells) ? cells : []).filter(isPoint).filter(c => distance(c, from) <= PLACE_RANGE)
        .sort(byDistance(from));
    for (const c of list) {
        if (!cellAllowsFurnace(c, areas)) {
            continue;
        }
        let allowed = true;
        if (typeof canPlace === 'function') {
            try {
                allowed = canPlace(c, 'furnace') !== false;
            } catch {
                allowed = false;
            }
        }
        if (allowed) {
            return { x: c.x, y: c.y, z: c.z };
        }
    }
    return null;
}

/**
 * The furnaces the bot may use, the nearest first: within 16 blocks of `from` and allowed by
 * `canUse(furnace)` (the area guard). A canUse that throws counts as a refusal.
 * @param {{x,y,z}[]} furnaces
 * @param {{x,y,z}} from
 * @param {(furnace: object) => boolean} [canUse]
 * @returns {{x: number, y: number, z: number}[]}
 */
export function usableFurnaces(furnaces, from, canUse = null) {
    if (!isPoint(from)) {
        return [];
    }
    return (Array.isArray(furnaces) ? furnaces : []).filter(isPoint).filter(f => distance(f, from) <= FURNACE_RANGE)
        .filter(f => {
            if (typeof canUse !== 'function') {
                return true;
            }
            try {
                return canUse(f) !== false;
            } catch {
                return false;
            }
        })
        .sort(byDistance(from))
        .map(f => ({ x: f.x, y: f.y, z: f.z }));
}

/**
 * The nearest furnace the bot may use (usableFurnaces), or null.
 * @param {{x,y,z}[]} furnaces
 * @param {{x,y,z}} from
 * @param {(furnace: object) => boolean} [canUse]
 * @returns {{x: number, y: number, z: number}|null}
 */
export function chooseFurnace(furnaces, from, canUse = null) {
    return usableFurnaces(furnaces, from, canUse)[0] ?? null;
}
