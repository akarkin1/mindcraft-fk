// The inventory of the bot as the pure modules of the wood pack read it: a list of
// { name, count, slot, uses_left }. The one place that knows how mineflayer tells the wear of a
// tool (prismarine-item: maxDurability from the registry, durabilityUsed from the damage
// component). No imports; every function here never throws.

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function rawItems(bot) {
    try {
        const items = bot?.inventory?.items?.();
        return Array.isArray(items) ? items.filter(i => i && typeof i.name === 'string') : [];
    } catch {
        return [];
    }
}

/**
 * The uses left of an item of mineflayer: maxDurability minus durabilityUsed. null for an item
 * that does not wear out.
 * @param {object} item a prismarine-item Item
 * @returns {number|null}
 */
export function itemUsesLeft(item) {
    const max = item?.maxDurability;
    if (!isFiniteNumber(max) || max <= 0) {
        return null;
    }
    let used = 0;
    try {
        used = item.durabilityUsed;
    } catch {
        used = 0;
    }
    return Math.max(0, max - (isFiniteNumber(used) ? used : 0));
}

/**
 * The inventory of the bot as a list of { name, count, slot, uses_left }.
 * @param {object} bot
 * @returns {{name: string, count: number, slot: number|null, uses_left: number|null}[]}
 */
export function inventoryOf(bot) {
    return rawItems(bot).map(item => ({
        name: item.name,
        count: isFiniteNumber(item.count) ? item.count : 0,
        slot: isFiniteNumber(item.slot) ? item.slot : null,
        uses_left: itemUsesLeft(item),
    }));
}

/**
 * Counts of the items of the bot by name.
 * @param {object} bot
 * @returns {Object<string, number>}
 */
export function itemCounts(bot) {
    const counts = {};
    for (const item of rawItems(bot)) {
        if (isFiniteNumber(item.count)) {
            counts[item.name] = (counts[item.name] ?? 0) + item.count;
        }
    }
    return counts;
}

/**
 * How many items of the bot pass the test (a name or a function of the name).
 * @param {object} bot
 * @param {string|((name: string) => boolean)} test
 * @returns {number}
 */
export function countItems(bot, test) {
    const match = typeof test === 'function' ? test : name => name === test;
    let n = 0;
    for (const [name, count] of Object.entries(itemCounts(bot))) {
        let ok = false;
        try {
            ok = match(name) === true;
        } catch {
            ok = false;
        }
        if (ok) {
            n += count;
        }
    }
    return n;
}

/**
 * The item of mineflayer for an entry of inventoryOf, or the first item with that name.
 * @param {object} bot
 * @param {{name: string, slot?: number|null}|string} entry
 * @returns {object|null}
 */
export function findItem(bot, entry) {
    const name = typeof entry === 'string' ? entry : entry?.name;
    const slot = typeof entry === 'object' ? entry?.slot : null;
    const items = rawItems(bot).filter(i => i.name === name && i.count > 0);
    return items.find(i => isFiniteNumber(slot) && i.slot === slot) ?? items[0] ?? null;
}
