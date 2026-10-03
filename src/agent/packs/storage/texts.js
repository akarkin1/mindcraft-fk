// Texts of the storage pack that the player or the model reads. The spec v0.1.4.7 S3 gives most of
// them word for word, tests compare them. Pure.

/** Fixed texts. */
export const TEXTS = Object.freeze({
    nothingToStore: 'I have nothing to store. I keep my tools, food and torches.',
    noChest: 'I know no chest nearby. Place one or take me to one.',
    noChests: 'I know no chests in this world.',
    chestsHeader: 'Chests I know in this world:',
    noItemName: 'Tell me which item to fetch.',
    // v0.1.4.12 (4.2): smelting, word for word
    noFuel: 'I have no fuel: no coal, charcoal, planks or logs.',
    /** `I know no furnace within 64 blocks and carry none.` (v0.1.4.12, F1: the range searched) */
    noFurnace: (range = 16) => `I know no furnace within ${range} blocks and carry none.`,
    /** `I smelted 8 raw_iron into 8 iron_ingot in the furnace at (x, y, z) with 1 coal.` */
    smelted: (count, item, product, pos, fuelCount, fuelName) => `I smelted ${count} ${item} into ${count} ${product} in the furnace at ${posText(pos)} with ${fuelCount} ${fuelName}.`,
    /** `I carry no raw_iron.` */
    noItem: (item) => `I carry no ${item}.`,
    /** `I stopped after 3 of 8 raw_iron.` */
    stopped: (done, count, item) => `I stopped after ${done} of ${count} ${item}.`,
    /** `raw_cobblestone is not something a furnace changes.` */
    notSmeltable: (item) => `${item} is not something a furnace changes.`,
    // v0.1.4.12: smelting texts the spec does not give (decision of engineer E2)
    /** `I ran out of time after 3 of 8 raw_iron.` */
    smeltTimeout: (done, count, item) => `I ran out of time after ${done} of ${count} ${item}.`,
    /** `I carried only 3 raw_iron.` */
    smeltOnly: (have, item) => `I carried only ${have} ${item}.`,
    /** `I had fuel for 3 only.` */
    smeltLittleFuel: (covers) => `I had fuel for ${covers} only.`,
    /** `The furnace stopped after 3 of 8 raw_iron.` */
    smeltStalled: (done, count, item) => `The furnace stopped after ${done} of ${count} ${item}.`,
    /** `I could not smelt raw_iron: <error>` */
    smeltError: (item, message) => `I could not smelt ${item}: ${message}`,
});

/** Most kinds of items a list names before ` and <n> more kinds`. */
export const LIST_MAX = 6;
/** Most chests the list of chests names. */
export const CHESTS_MAX = 10;
/** Most kinds of items a line of the list of chests names (v0.1.4.8, E1: the wheat hid in "32 more kinds"). */
export const CHEST_KINDS_MAX = 10;

function blockCoord(value) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : value;
}

function errorText(err) {
    if (typeof err === 'string') {
        return err;
    }
    return typeof err?.message === 'string' ? err.message : 'unknown error';
}

/**
 * `(x, y, z)` with block coordinates.
 * @param {{x: number, y: number, z: number}} pos
 * @returns {string}
 */
export function posText(pos) {
    return `(${blockCoord(pos?.x)}, ${blockCoord(pos?.y)}, ${blockCoord(pos?.z)})`;
}

/**
 * `12 wheat, 3 wheat_seeds`: sorted by count, highest first, then by name; at most 6 kinds (or
 * `max`), followed by ` and <n> more kinds`. Counts of 0 or less are left out.
 * @param {Object<string, number>|{name: string, count: number}[]} counts
 * @param {number} [max] LIST_MAX
 * @returns {string}
 */
export function countsText(counts, max = LIST_MAX) {
    const limit = typeof max === 'number' && Number.isInteger(max) && max > 0 ? max : LIST_MAX;
    let list = [];
    if (Array.isArray(counts)) {
        list = counts.map(e => ({ name: e?.name, count: e?.count }));
    } else if (counts && typeof counts === 'object') {
        list = Object.entries(counts).map(([name, count]) => ({ name, count }));
    }
    list = list.filter(e => typeof e.name === 'string' && typeof e.count === 'number' && e.count > 0)
        .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const shown = list.slice(0, limit).map(e => `${e.count} ${e.name}`).join(', ');
    return list.length > limit ? `${shown} and ${list.length - limit} more kinds` : shown;
}

function hasCounts(counts) {
    return countsText(counts).length > 0;
}

function placeText(chests, preposition) {
    const list = Array.isArray(chests) ? chests : [];
    return list.length === 1 ? `${preposition} the chest at ${posText(list[0])}` : `${preposition} ${list.length} chests`;
}

/**
 * The text of storeItems. `reason` says why something is left: `no_chest`, `full`, `unreachable`,
 * `interrupted`, `timeout` or `error` (with `error`). `tried` is the number of chests the bot used when
 * there were more within the range (v0.1.4.8, X8): then `full` says `I tried the 27 nearest chests.`
 * and not that the chests are full.
 * @param {{stored?: object, left?: object, chests?: object[], reason?: string|null, error?: Error|string, tried?: number|null}} result
 * @returns {string}
 */
export function storeText(result) {
    const r = result && typeof result === 'object' ? result : {};
    const did = hasCounts(r.stored) ? `I stored ${countsText(r.stored)} ${placeText(r.chests, 'in')}.` : '';
    const then = text => (did ? `${did} ${text}` : text);
    if (r.reason === 'error') {
        return then(`I could not store my things: ${errorText(r.error)}`);
    }
    if (!hasCounts(r.left)) {
        return did || TEXTS.nothingToStore;
    }
    const carry = countsText(r.left);
    switch (r.reason) {
    case 'no_chest':
        return then(TEXTS.noChest);
    case 'full':
        if (typeof r.tried === 'number' && Number.isInteger(r.tried) && r.tried > 0) {
            return then(`I tried the ${r.tried} nearest chests. I still carry ${carry}.`);
        }
        return did ? `${did} The chests are full now, I still carry ${carry}.` : `All chests nearby are full. I still carry ${carry}.`;
    case 'unreachable':
        return did ? `${did} I could not get to another chest, I still carry ${carry}.`
            : `I could not get to a chest nearby or open it. I still carry ${carry}.`;
    case 'interrupted':
        return did ? `${did} I was stopped, I still carry ${carry}.` : 'I was stopped before I stored anything.';
    case 'timeout':
        return did ? `${did} I ran out of time, I still carry ${carry}.` : `I ran out of time before I stored anything. I still carry ${carry}.`;
    default:
        return then(`I could not store my things: ${errorText(r.error)}`);
    }
}

/**
 * `I know no chest with <name>.`
 * @param {string} name
 * @returns {string}
 */
export function notFoundText(name) {
    return `I know no chest with ${name}.`;
}

/**
 * The text of fetchItem. `reason` says why less came: `not_found`, `no_more`, `inventory_full`,
 * `unreachable` (with `failedAt`, the first chest it could not get to), `interrupted`, `timeout`
 * or `error` (with `error`). Without a reason the bot took what was asked for.
 * @param {{name?: string, taken?: number, chests?: object[], reason?: string|null, failedAt?: object, error?: Error|string}} result
 * @returns {string}
 */
export function fetchText(result) {
    const r = result && typeof result === 'object' ? result : {};
    const name = typeof r.name === 'string' && r.name.length > 0 ? r.name : 'an item';
    const taken = typeof r.taken === 'number' && r.taken > 0 ? r.taken : 0;
    const did = taken > 0 ? `I took ${taken} ${name} ${placeText(r.chests, 'from')}.` : '';
    switch (r.reason) {
    case 'no_more':
        return did ? `${did} There was no more.` : `I found no ${name} in the chests I know.`;
    case 'inventory_full':
        return did ? `${did} My inventory is full.` : `My inventory is full, I took no ${name}.`;
    case 'unreachable':
        if (did) {
            return `${did} I could not get to the other chests with ${name}.`;
        }
        return r.failedAt ? `I could not get to the chest with ${name} at ${posText(r.failedAt)}.` : `I could not get to a chest with ${name}.`;
    case 'interrupted':
        return did ? `${did} I was stopped.` : `I was stopped before I took any ${name}.`;
    case 'timeout':
        return did ? `${did} I ran out of time.` : `I ran out of time before I took any ${name}.`;
    case 'error':
        return did ? `${did} I could not take more: ${errorText(r.error)}` : `I could not take ${name}: ${errorText(r.error)}`;
    default:
        return did || notFoundText(name);
    }
}

/**
 * One line of the list of chests: `- (-13, 63, 28): 12 wheat, 3 wheat_seeds, 4 free slots`, or
 * `- (x, y, z): empty, 27 free slots`. Since v0.1.4.8 (E1) up to 10 kinds, then `and <n> more kinds`.
 * @param {{x,y,z,items: object, free_slots: number}} chest
 * @returns {string}
 */
export function chestLine(chest) {
    const content = hasCounts(chest?.items) ? countsText(chest.items, CHEST_KINDS_MAX) : 'empty';
    const free = typeof chest?.free_slots === 'number' ? chest.free_slots : 0;
    return `- ${posText(chest)}: ${content}, ${free} free slots`;
}

/**
 * The answer of `!chests` for one item (spec v0.1.4.8 E1), from the chests that hold it in the
 * given order (the index gives the most first): `wheat: 28 in the chest at (11, 67, 53). Total 28.`,
 * with several `wheat: 28 in the chest at (11, 67, 53), 5 in the chest at (-13, 63, 28). Total 33.`,
 * after 10 chests ` and <n> more chests`. Without a chest `I know no chest with wheat.`
 * @param {string} name
 * @param {{x,y,z,items: object}[]} chests
 * @returns {string}
 */
export function itemChestsText(name, chests) {
    const list = (Array.isArray(chests) ? chests : []).filter(c => typeof c?.items?.[name] === 'number' && c.items[name] > 0);
    if (list.length === 0) {
        return notFoundText(name);
    }
    const total = list.reduce((sum, c) => sum + c.items[name], 0);
    const parts = list.slice(0, CHESTS_MAX).map(c => `${c.items[name]} in the chest at ${posText(c)}`);
    const more = list.length > CHESTS_MAX ? ` and ${list.length - CHESTS_MAX} more chests` : '';
    return `${name}: ${parts.join(', ')}${more}. Total ${total}.`;
}

/**
 * The text of the command !chests: `Chests I know in this world:` and one line per chest, at most
 * 10, then `And <n> more chests.`; without chests `I know no chests in this world.`
 * @param {object[]} chests in the order to list them
 * @returns {string}
 */
export function chestListText(chests) {
    const list = Array.isArray(chests) ? chests : [];
    if (list.length === 0) {
        return TEXTS.noChests;
    }
    const lines = [TEXTS.chestsHeader, ...list.slice(0, CHESTS_MAX).map(chestLine)];
    if (list.length > CHESTS_MAX) {
        lines.push(`And ${list.length - CHESTS_MAX} more chests.`);
    }
    return lines.join('\n');
}
