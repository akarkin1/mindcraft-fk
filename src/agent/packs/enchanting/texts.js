// Texts of the enchanting pack (spec v0.1.4.16 section 8.3, and the asking texts of 8.1 for the lapis). The spec
// gives them word for word, tests compare them. Pure.

/**
 * Fixed texts.
 */
export const TEXTS = Object.freeze({
    noTable: 'No enchanting table within 32 blocks.',
    noQuestion: 'There is no enchanting question to answer.',
    offersTail: 'Say "take 1", "take 2", "take 3" or "none".',
});

/** The item of the lapis and the purpose slot of the asking texts (8.1) as the enchanting pack fills them. */
export const LAPIS = 'lapis_lazuli';
export const PURPOSE = 'the enchanting';

/**
 * `(-14, 63, 28)`: block coordinates of a position.
 * @param {{x: number, y: number, z: number}} pos
 * @returns {string}
 */
export function whereText(pos) {
    return `(${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`;
}

/**
 * The words of an item for "say "enchant my pickaxe" again": the kind of a tool or a piece of armour (`diamond_pickaxe` ->
 * `pickaxe`), else the name with spaces (`fishing_rod` -> `fishing rod`).
 * @param {string} itemName
 * @returns {string}
 */
export function itemWords(itemName) {
    const name = typeof itemName === 'string' ? itemName : '';
    const m = /_(pickaxe|axe|shovel|hoe|sword|helmet|chestplate|leggings|boots)$/.exec(name);
    return m ? m[1] : name.replace(/_/g, ' ');
}

/**
 * `I have no diamond_pickaxe.` (the item as the player named it: `I have no pickaxe.` for a kind)
 * @param {string} request
 * @returns {string}
 */
export function noItemText(request) {
    return `I have no ${request}.`;
}

/**
 * `The table offers nothing for this diamond_pickaxe.`
 * @param {string} itemName
 * @returns {string}
 */
export function noOfferText(itemName) {
    return `The table offers nothing for this ${itemName}.`;
}

/**
 * One offer of the line: `Efficiency IV (30 levels, 3 lapis)`.
 * @param {{displayName: string, numeral: string, cost: number, lapis: number}} offer the enchantment's level as a roman numeral
 * @returns {string}
 */
export function offerWords(offer) {
    return `${offer.displayName} ${offer.numeral} (${offer.cost} levels, ${offer.lapis} lapis)`;
}

/**
 * The offers line: `The table offers for your diamond_pickaxe: 1) Efficiency IV (30 levels, 3 lapis), 2) Unbreaking II
 * (20 levels, 2 lapis), 3) Fortune I (12 levels, 1 lapis). Say "take 1", "take 2", "take 3" or "none".`; with a name the
 * table does not offer, `; none of them is sharpness.` replaces the "Say ..." tail. An offer is numbered by its slot of
 * the table (`index` 0..2) when it has one, else by its place in the list.
 * @param {string} itemName
 * @param {{displayName: string, numeral: string, cost: number, lapis: number, index?: number}[]} offers in the order of the table
 * @param {{notOffered?: string}} [options]
 * @returns {string}
 */
export function offersText(itemName, offers, options = {}) {
    const list = (Array.isArray(offers) ? offers : []).map((o, i) => `${(Number.isInteger(o.index) ? o.index : i) + 1}) ${offerWords(o)}`).join(', ');
    const head = `The table offers for your ${itemName}: ${list}`;
    if (typeof options?.notOffered === 'string' && options.notOffered !== '') {
        return `${head}; none of them is ${options.notOffered}.`;
    }
    return `${head}. ${TEXTS.offersTail}`;
}

/**
 * `I took the diamond_pickaxe back; say "enchant my pickaxe" again when you have chosen.`
 * @param {string} itemName
 * @returns {string}
 */
export function tookBackText(itemName) {
    return `I took the ${itemName} back; say "enchant my ${itemWords(itemName)}" again when you have chosen.`;
}

/**
 * `Level 12, offer 1 needs 30.`
 * @param {number} level the bot's level
 * @param {number} index the offer, 0..2
 * @param {number} cost the levels the offer needs
 * @returns {string}
 */
export function levelText(level, index, cost) {
    return `Level ${level}, offer ${index + 1} needs ${cost}.`;
}

/**
 * `I enchanted your diamond_pickaxe: Efficiency IV (30 levels, 3 lapis).`; every enchantment the result carries, in the
 * order the item has them (`Efficiency I, Unbreaking I`), the chosen offer's requirement and lapis in the parentheses.
 * @param {string} itemName
 * @param {string[]} enchantments `Efficiency IV` each
 * @param {number} cost
 * @param {number} lapis
 * @returns {string}
 */
export function enchantedText(itemName, enchantments, cost, lapis) {
    return `I enchanted your ${itemName}: ${(Array.isArray(enchantments) ? enchantments : []).join(', ')} (${cost} levels, ${lapis} lapis).`;
}

/**
 * `I cannot reach the enchanting table at (x, y, z).`
 * @param {{x: number, y: number, z: number}} pos
 * @returns {string}
 */
export function unreachableText(pos) {
    return `I cannot reach the enchanting table at ${whereText(pos)}.`;
}

/**
 * `I could not enchant the diamond_pickaxe: <error>.`
 * @param {string} itemName
 * @param {string} error
 * @returns {string}
 */
export function failedText(itemName, error) {
    return `I could not enchant the ${itemName}: ${error}.`;
}

/**
 * The answer of !enchantTake: `I take offer 2.`, `I take the item back.`
 * @param {number} n 0..3
 * @returns {string}
 */
export function takeText(n) {
    return n === 0 ? 'I take the item back.' : `I take offer ${n}.`;
}

// --- the asking texts of 8.1, the enchanting pack's copy for when the breeding pack (ctx.stock) is not loaded ---

/**
 * `May I take 3 lapis_lazuli from the chest at (x, y, z) for the enchanting? Say yes or no.`
 * @param {string} item
 * @param {number} count
 * @param {{x: number, y: number, z: number}} pos
 * @param {string} purpose
 * @returns {string}
 */
export function askText(item, count, pos, purpose) {
    return `May I take ${count} ${item} from the chest at ${whereText(pos)} for ${purpose}? Say yes or no.`;
}

/**
 * `Only 6 lapis_lazuli are left in the chests; may I take 3 for the enchanting? Say yes or no.`
 * @param {string} item
 * @param {number} left
 * @param {number} count
 * @param {string} purpose
 * @returns {string}
 */
export function askLowText(item, left, count, purpose) {
    return `Only ${left} ${item} are left in the chests; may I take ${count} for ${purpose}? Say yes or no.`;
}

/**
 * `I took 3 lapis_lazuli from the chest at (x, y, z).`
 * @param {string} item
 * @param {number} count
 * @param {{x: number, y: number, z: number}} pos
 * @returns {string}
 */
export function tookText(item, count, pos) {
    return `I took ${count} ${item} from the chest at ${whereText(pos)}.`;
}

/**
 * `I take no lapis_lazuli without your word; say "you may take lapis_lazuli" when you want.`
 * @param {string} item
 * @returns {string}
 */
export function noPermitText(item) {
    return `I take no ${item} without your word; say "you may take ${item}" when you want.`;
}

/**
 * `I have no lapis_lazuli and the chests have none.`
 * @param {string} item
 * @returns {string}
 */
export function noStockText(item) {
    return `I have no ${item} and the chests have none.`;
}
