// The decisions of the enchanting pack (spec v0.1.4.16 section 8.3, E7): which item of the bag, what the choice of the order
// means, which offers the table's window shows, which offer a name means, whether the level is enough, and the words of the
// enchantments an item carries. Pure: no mineflayer, no src/agent/library, no other pack.
//
// The window of 26.1 (probed on the test server, 2026-11-13): `window.enchantments` holds three { level, expected: { enchant,
// level } }; -1 everywhere means "no data yet"; at the open the server sends the costs 0, 0, 0 with the enchantments -1, and
// about 50 ms after the item is in slot 0 the three real offers (cost >= 1, an enchantment id >= 0). An item the table cannot
// enchant (a stick, an item enchanted already) keeps cost 0 with id -1: that is "no offer", not -1.

/** The rules of the pack: ranges, waits, the lapis. */
export const ENCHANT_RULES = Object.freeze({
    tableRange: 32, // the table within this many blocks (bot.findBlock)
    reach: 3, // the bot walks to within this many blocks of the table
    offersMs: 2000, // the wait for the offers after the item is put
    offersRetryMs: 3000, // after one re-put of the item (5 s in all, the spec's wait for 'ready')
    askMs: 60000, // the wait for !enchantTake
    pollMs: 250,
    enchantMs: 5000, // the wait for the enchanted item in slot 0
    walkMs: 60000,
    lapis: 3, // lapis in the bag before the window opens (every offer can be taken)
    lapisLow: 6, // the low mark of the stock (two uses)
    chestRange: 48, // the asking rule of 8.1: the chests within this range
});

/** The kinds of an item a request may name: "pickaxe" takes the best pickaxe of the bag. */
export const ITEM_KINDS = Object.freeze(['pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'spear', 'mace', 'helmet', 'chestplate', 'leggings', 'boots',
    'bow', 'crossbow', 'trident', 'fishing_rod', 'book']);

/** The materials, the best first. */
export const MATERIAL_ORDER = Object.freeze(['netherite', 'diamond', 'iron', 'chainmail', 'copper', 'turtle', 'stone', 'golden', 'leather', 'wooden']);

const NUMERALS = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'],
    [4, 'IV'], [1, 'I']];

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The roman numeral of an enchantment's level: 1 -> `I`, 4 -> `IV`, 10 -> `X`. A level that is not a whole number from 1 to
 * 3999 is written in digits.
 * @param {number} n
 * @returns {string}
 */
export function roman(n) {
    if (!Number.isInteger(n) || n < 1 || n > 3999) {
        return String(n);
    }
    let rest = n;
    let out = '';
    for (const [value, letters] of NUMERALS) {
        while (rest >= value) {
            out += letters;
            rest -= value;
        }
    }
    return out;
}

/**
 * An item as a request names it, as mineflayer names items: lower case, without `minecraft:`, without a leading `my`,
 * `the`, `a` or `your`, spaces as `_`. `My Diamond Pickaxe` -> `diamond_pickaxe`. null for an empty request.
 * @param {*} request
 * @returns {string|null}
 */
export function cleanItemRequest(request) {
    if (typeof request !== 'string') {
        return null;
    }
    const clean = request.trim().toLowerCase().replace(/^minecraft:/, '').replace(/^(?:my|the|a|your)\s+/, '').trim().replace(/[\s-]+/g, '_');
    return clean.length > 0 ? clean : null;
}

/**
 * The kind a request names (`pickaxe`), or null when it names an item (`diamond_pickaxe`).
 * @param {string} request a clean request
 * @returns {string|null}
 */
export function kindOf(request) {
    return ITEM_KINDS.includes(request) ? request : null;
}

/**
 * Whether an item name is of a kind: `diamond_pickaxe` is a pickaxe, `diamond_pickaxe` is no axe, `bow` is a bow.
 * @param {string} name
 * @param {string} kind
 * @returns {boolean}
 */
export function isOfKind(name, kind) {
    return typeof name === 'string' && (name === kind || name.endsWith(`_${kind}`));
}

/**
 * The rank of an item's material, 0 the best; the items without a known material after every material.
 * @param {string} name
 * @returns {number}
 */
export function materialRank(name) {
    const i = MATERIAL_ORDER.findIndex((m) => typeof name === 'string' && name.startsWith(`${m}_`));
    return i >= 0 ? i : MATERIAL_ORDER.length;
}

/**
 * The item of the bag to enchant: the exact name, else the best item of the kind (`pickaxe`). An unenchanted item comes
 * before an enchanted one (the table offers nothing for an enchanted item), then the best material, then the lower slot.
 * @param {{name: string, slot?: number}[]} items the bag
 * @param {string} request a clean request
 * @param {(item: object) => boolean} [isEnchanted]
 * @returns {object|null}
 */
export function chooseItem(items, request, isEnchanted = () => false) {
    const list = (Array.isArray(items) ? items : []).filter((i) => i && typeof i.name === 'string' && (i.count ?? 1) > 0);
    if (typeof request !== 'string' || request === '') {
        return null;
    }
    const kind = kindOf(request);
    const found = list.filter((i) => (kind ? isOfKind(i.name, kind) : i.name === request));
    const enchanted = (i) => {
        try {
            return isEnchanted(i) === true;
        } catch {
            return false;
        }
    };
    found.sort((a, b) => Number(enchanted(a)) - Number(enchanted(b)) || materialRank(a.name) - materialRank(b.name)
        || (a.slot ?? 0) - (b.slot ?? 0));
    return found[0] ?? null;
}

/**
 * What the choice of `!enchant(item, choice)` means: `''` asks the owner (`ask`); 1, 2 or 3 (a number or its text, also
 * `offer 2`, `take 2`) takes that offer (`index` 0..2); any other number is `bad`; any other text is an enchantment's name.
 * @param {*} choice
 * @returns {{kind: 'ask'}|{kind: 'index', index: number}|{kind: 'name', name: string}|{kind: 'bad', choice: string}}
 */
export function parseChoice(choice) {
    if (choice === undefined || choice === null) {
        return { kind: 'ask' };
    }
    if (typeof choice === 'number') {
        return Number.isInteger(choice) && choice >= 1 && choice <= 3 ? { kind: 'index', index: choice - 1 } : { kind: 'bad', choice: String(choice) };
    }
    const text = String(choice).trim();
    if (text === '') {
        return { kind: 'ask' };
    }
    const m = /^(?:offer\s*|take\s*)?(-?\d+)$/i.exec(text);
    if (m) {
        const n = Number(m[1]);
        return n >= 1 && n <= 3 ? { kind: 'index', index: n - 1 } : { kind: 'bad', choice: text };
    }
    return { kind: 'name', name: text };
}

/**
 * The answer of `!enchantTake(n)`: 1, 2 or 3 an offer, 0 the item back; null for anything else.
 * @param {*} n
 * @returns {number|null}
 */
export function parseTake(n) {
    const v = typeof n === 'string' && /^\s*\d+\s*$/.test(n) ? Number(n) : n;
    return Number.isInteger(v) && v >= 0 && v <= 3 ? v : null;
}

/**
 * Whether the window has sent anything for the item: a value that is not -1. (At the open every cost is 0, so this is
 * true then too; the pack reads the offers after the item is put.)
 * @param {object[]} raw window.enchantments
 * @returns {boolean}
 */
export function hasData(raw) {
    return (Array.isArray(raw) ? raw : []).some((o) => isFiniteNumber(o?.level) && o.level !== -1);
}

/**
 * The offers of the window that the table really offers: a cost of 1 or more and an enchantment id of 0 or more, with the
 * name from the registry (`registry.enchantments[id]`), the level as a roman numeral, the cost and the lapis (`index + 1`).
 * @param {object[]} raw window.enchantments
 * @param {object} [registry] bot.registry
 * @returns {{index: number, cost: number, lapis: number, id: number, enchantLevel: number, name: string|null, displayName: string, numeral: string}[]}
 */
export function offersFrom(raw, registry = null) {
    const table = registry?.enchantments ?? {};
    const out = [];
    (Array.isArray(raw) ? raw : []).slice(0, 3).forEach((o, index) => {
        const cost = o?.level;
        const id = o?.expected?.enchant;
        const lvl = o?.expected?.level;
        if (!isFiniteNumber(cost) || cost < 1 || !Number.isInteger(id) || id < 0) {
            return;
        }
        const e = table[id] ?? null;
        out.push({
            index, cost, lapis: index + 1, id, enchantLevel: isFiniteNumber(lvl) ? lvl : 0,
            name: typeof e?.name === 'string' ? e.name : null,
            displayName: typeof e?.displayName === 'string' ? e.displayName : `Enchantment ${id}`,
            numeral: roman(isFiniteNumber(lvl) ? lvl : 0),
        });
    });
    return out;
}

function plain(text) {
    return String(text ?? '').toLowerCase().replace(/^minecraft:/, '').replace(/[_\s]+/g, ' ').trim();
}

/**
 * The offer a name means, matched case-insensitive against the display name (`efficiency` matches `Efficiency IV`), the
 * display name with its numeral (`efficiency iv`) or the registry name (`silk_touch`, `silk touch`); a name of 4 letters or
 * more also matches the start of a display name (`unbreak`). Several offers of the name: the highest level of the
 * enchantment, on a tie the higher offer of the table.
 * @param {object[]} offers offersFrom
 * @param {string} name
 * @returns {object|null}
 */
export function matchOffer(offers, name) {
    const want = plain(name);
    if (want === '') {
        return null;
    }
    const hits = (Array.isArray(offers) ? offers : []).filter((o) => {
        const display = plain(o.displayName);
        return display === want || `${display} ${plain(o.numeral)}` === want || (o.name !== null && plain(o.name) === want)
            || (want.length >= 4 && display.startsWith(want));
    });
    hits.sort((a, b) => b.enchantLevel - a.enchantLevel || b.index - a.index);
    return hits[0] ?? null;
}

/**
 * Whether the bot's level pays for the offer: null when it does, else `{ level, index, cost }` for the level line. A level
 * that is not known counts as 0.
 * @param {number} level bot.experience.level
 * @param {{index: number, cost: number}} offer
 * @returns {{level: number, index: number, cost: number}|null}
 */
export function levelShort(level, offer) {
    const have = isFiniteNumber(level) ? level : 0;
    return have >= offer.cost ? null : { level: have, index: offer.index, cost: offer.cost };
}

/**
 * The enchantments of an item, `[{ name, lvl }]`: the F7 reader (`enchantsOf` of the patched digging plugin) when it is given,
 * else the same reading here: an array as it is (prismarine-item's old form), the 26.1 component `{ enchantments: [{ id, level
 * }] }` through the registry, anything else none. Never throws.
 * @param {object} item
 * @param {object} [registry]
 * @param {Function|null} [reader] enchantsOf(item, registry)
 * @returns {{name: string|null, lvl: number}[]}
 */
export function enchantsOfItem(item, registry = null, reader = null) {
    if (typeof reader === 'function') {
        try {
            const r = reader(item, registry);
            if (Array.isArray(r)) {
                return r;
            }
        } catch {
            // the reading below
        }
    }
    let raw;
    try {
        raw = item ? item.enchants : null;
    } catch {
        return [];
    }
    if (Array.isArray(raw)) {
        return raw;
    }
    if (raw && typeof raw === 'object' && Array.isArray(raw.enchantments)) {
        const table = registry?.enchantments ?? {};
        return raw.enchantments.map((e) => ({ name: table[e.id] ? table[e.id].name : null, lvl: e.level }));
    }
    return [];
}

/**
 * The words of an item's enchantments in the order the item has them: `['Efficiency I', 'Unbreaking I']`, through the
 * registry's display names (`registry.enchantmentsByName`); a name the registry does not know as it is.
 * @param {{name: string|null, lvl: number}[]} list
 * @param {object} [registry]
 * @returns {string[]}
 */
export function enchantmentWords(list, registry = null) {
    const byName = registry?.enchantmentsByName ?? {};
    return (Array.isArray(list) ? list : []).map((e) => {
        const name = typeof e?.name === 'string' ? e.name.replace(/^minecraft:/, '') : null;
        const display = name && typeof byName[name]?.displayName === 'string' ? byName[name].displayName : (name ?? 'an enchantment');
        return `${display} ${roman(e?.lvl)}`;
    });
}

/**
 * The slot of a bag item in an open window: bot.inventory's slots 9 to 44 (the main part, then the hot bar) are the window's
 * slots from `inventoryStart` on (2 to 37 in the enchanting window: the probe's pickaxe in bag slot 37 was window slot 30).
 * @param {number} bagSlot
 * @param {number} inventoryStart
 * @returns {number|null}
 */
export function windowSlotOf(bagSlot, inventoryStart) {
    return Number.isInteger(bagSlot) && bagSlot >= 9 && bagSlot <= 44 && Number.isInteger(inventoryStart) ? bagSlot - 9 + inventoryStart : null;
}
