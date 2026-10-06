// The full bag during the mining (v0.1.4.13, part Q, SPEC 4.6 Q4) and the other ores on the way (Q9): what is stored,
// what the trip does next, and the texts word for word. Pure: no imports.

/** Q4: the chests of the index the full bag is stored in lie within this many blocks of the bot. */
export const BAG_RULES = Object.freeze({ chestRange: 32 });

// Q4: the kinds a trip keeps when its bag is full: tools, food, torches, ladders and the ore it mines.
const TOOL_ENDINGS = Object.freeze(['_pickaxe', '_axe', '_shovel', '_hoe', '_sword']);
const TOOL_NAMES = Object.freeze(['shears', 'flint_and_steel', 'fishing_rod', 'bucket', 'water_bucket', 'lava_bucket', 'milk_bucket',
    'bow', 'crossbow', 'trident', 'shield', 'compass', 'clock', 'spyglass', 'brush', 'mace']);
const KEPT_NAMES = Object.freeze(['torch', 'ladder']);

function plainName(name) {
    return typeof name === 'string' ? name.replace(/^minecraft:/, '') : '';
}

function isTool(name) {
    return TOOL_NAMES.includes(name) || TOOL_ENDINGS.some(ending => name.endsWith(ending));
}

function isFoodName(name, foods) {
    if (foods instanceof Set) {
        return foods.has(name);
    }
    if (Array.isArray(foods)) {
        return foods.includes(name);
    }
    if (typeof foods === 'function') {
        try {
            return foods(name) === true;
        } catch {
            return false;
        }
    }
    return foods !== null && typeof foods === 'object' && Object.hasOwn(foods, name);
}

/**
 * True for a kind the trip keeps when its bag is full (Q4): a tool, food, torches, ladders, the ore item it mines.
 * @param {string} name an item name
 * @param {{ore?: string, foods?: object|Set<string>|string[]|Function}} [keep] ore: the item of the ore mined
 *   (raw_iron); foods: the food names (bot.registry.foodsByName, a set, a list or a test)
 * @returns {boolean}
 */
export function isKeptKind(name, keep = {}) {
    const n = plainName(name);
    if (n === '') {
        return true;
    }
    return n === plainName(keep?.ore) || KEPT_NAMES.includes(n) || isTool(n) || isFoodName(n, keep?.foods);
}

/**
 * The kinds the bag stores (Q4): every kind of the items that is not kept (isKeptKind), with its count, the most
 * first, then by name.
 * @param {{name: string, count: number}[]} items the inventory
 * @param {{ore?: string, foods?: object}} [keep]
 * @returns {{name: string, count: number}[]}
 */
export function storeKinds(items, keep = {}) {
    const counts = new Map();
    for (const item of Array.isArray(items) ? items : []) {
        const name = plainName(item?.name);
        const count = Number.isFinite(item?.count) ? item.count : 0;
        if (count > 0 && !isKeptKind(name, keep)) {
            counts.set(name, (counts.get(name) ?? 0) + count);
        }
    }
    // v0.1.4.13 fix 2: of each stone kind, enough for a stone pickaxe stays in the bag (the play of 2026-10-06: "I have
    // no stone for a new one" after the stone went into the chest); the mined stone stacks onto it, no slot is lost
    for (const name of PICKAXE_STONE) {
        if (counts.has(name)) {
            const left = counts.get(name) - STONE_KEPT;
            if (left > 0)
                counts.set(name, left);
            else
                counts.delete(name);
        }
    }
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** v0.1.4.13 fix 2: the stone a stone pickaxe is made of, and how much of it the full-bag store keeps. */
export const PICKAXE_STONE = Object.freeze(['cobblestone', 'cobbled_deepslate', 'blackstone']);
export const STONE_KEPT = 3;

/**
 * What the trip does when shouldReturn says the bag is full (Q4): `store` when a kind can be stored; `dig` when nothing
 * can be stored and a slot is still free (the trip digs on and stores when the dig fills the bag); `stop` when nothing
 * can be stored and no slot is free.
 * @param {{freeSlots: number, storable: object[]}} state
 * @returns {'store'|'dig'|'stop'}
 */
export function bagAction(state) {
    if (Array.isArray(state?.storable) && state.storable.length > 0) {
        return 'store';
    }
    return Number.isFinite(state?.freeSlots) && state.freeSlots > 0 ? 'dig' : 'stop';
}

function cellText(p) {
    return `(${Math.floor(p?.x)}, ${Math.floor(p?.y)}, ${Math.floor(p?.z)})`;
}

// `203 cobbled_deepslate`, `203 cobbled_deepslate and 65 gravel`, `4 cobblestone, 2 gravel and 1 flint`
function listWords(entries) {
    const parts = entries.map(([name, n]) => `${n} ${name}`);
    if (parts.length <= 1) {
        return parts.join('');
    }
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// The counts of an object as [name, n], the most first, then by name; only whole numbers above 0.
function countsOf(counts) {
    return Object.entries(counts && typeof counts === 'object' ? counts : {})
        .filter(([, n]) => Number.isFinite(n) && n > 0)
        .map(([name, n]) => [name, Math.floor(n)])
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * The text of Q4 when the bag was stored, word for word: `I stored 203 cobbled_deepslate and 65 gravel in the chest
 * at (16, -59, -98) and go on.`
 * @param {Object<string, number>} stored the counts stored
 * @param {{x: number, y: number, z: number}} chest
 * @returns {string}
 */
export function storedText(stored, chest) {
    const words = listWords(countsOf(stored));
    return `I stored ${words || 'nothing'} in the chest at ${cellText(chest)} and go on.`;
}

/**
 * The text of Q4 when no chest has room, word for word: `My bag is full and no chest within 32 blocks has room. I stop
 * the mining at 7 of 28 diamond.`
 * @param {number} mined
 * @param {number} wanted
 * @param {string} ore the ore as the player names it (diamond, iron)
 * @returns {string}
 */
export function bagFullText(mined, wanted, ore) {
    return `My bag is full and no chest within ${BAG_RULES.chestRange} blocks has room. `
        + `I stop the mining at ${Number.isFinite(mined) ? mined : 0} of ${Number.isFinite(wanted) ? wanted : 0} ${ore}.`;
}

/**
 * Q4, beyond the spec: the bag is full of things the trip keeps (tools, food, torches, ladders, the ore) and no slot
 * is free: `My bag is full of things I keep for the mining. I stop the mining at 7 of 28 diamond.`
 * @param {number} mined
 * @param {number} wanted
 * @param {string} ore
 * @returns {string}
 */
export function bagKeptText(mined, wanted, ore) {
    return 'My bag is full of things I keep for the mining. '
        + `I stop the mining at ${Number.isFinite(mined) ? mined : 0} of ${Number.isFinite(wanted) ? wanted : 0} ${ore}.`;
}

/**
 * Q9: the words the stop and done texts add for the other ores of the trip: `, and 11 redstone and 4 lapis_lazuli on
 * the way`; '' when there are none. The item of the ore asked for is left out.
 * @param {Object<string, number>} collected the ore items the trip collected, by item
 * @param {string} item the item of the ore asked for (raw_iron)
 * @returns {string}
 */
export function otherOresWords(collected, item) {
    const others = countsOf(collected).filter(([name]) => name !== plainName(item));
    return others.length > 0 ? `, and ${listWords(others)} on the way` : '';
}

/**
 * The text of the trip with the words of Q9 at the end of its first sentence (`I mined 6 raw_iron, and 11 redstone and
 * 4 lapis_lazuli on the way. The mine is at ...`). The text as it is without words or without a first sentence.
 * @param {string} text
 * @param {string} words otherOresWords
 * @returns {string}
 */
export function withOtherOres(text, words) {
    if (typeof text !== 'string' || typeof words !== 'string' || words === '') {
        return text;
    }
    const end = text.indexOf('.');
    return end < 0 ? text : `${text.slice(0, end)}${words}${text.slice(end)}`;
}
