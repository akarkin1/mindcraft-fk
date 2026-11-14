// Texts of the enchanting pack (spec v0.1.4.16 section 8.3, and the asking texts of 8.1 for the lapis). The spec gives
// most of them word for word, tests compare them. The few the spec leaves open (an answer without a question, a choice
// that is no offer, a table out of reach, a window that fails) are the pack's own and say so in their comment. Pure.

/**
 * Fixed texts. `noQuestion`, `badTake`: the pack's own (the spec gives no text for an answer without a question).
 */
export const TEXTS = Object.freeze({
    noTable: 'No enchanting table within 32 blocks.',
    offersTail: 'Say "take 1", "take 2", "take 3" or "none".',
    noQuestion: 'There is no enchanting question to answer.',
    badTake: 'Say 1, 2 or 3 to take an offer of the table, or 0 to take the item back.',
});

/** The item of the lapis and the purpose slot of the asking texts (8.1) as the enchanting pack fills them. */
export const LAPIS = 'lapis_lazuli';
export const PURPOSE = 'the enchanting';

function count(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * `(-14, 63, 28)`: block coordinates of a position.
 * @param {{x: number, y: number, z: number}} pos
 * @returns {string}
 */
export function whereText(pos) {
    return `(${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`;
}

/**
 * The words of an item in `say "enchant my pickaxe" again`: the kind of a tool, a weapon or a piece of armour
 * (`diamond_pickaxe` -> `pickaxe`), else the name with spaces (`fishing_rod` -> `fishing rod`).
 * @param {string} itemName
 * @returns {string}
 */
export function itemWords(itemName) {
    const name = typeof itemName === 'string' ? itemName : '';
    const m = /_(pickaxe|axe|shovel|hoe|sword|spear|helmet|chestplate|leggings|boots)$/.exec(name);
    return m ? m[1] : name.replace(/_/g, ' ');
}

/**
 * `I have no diamond_pickaxe.` (the item as it was asked for: `I have no pickaxe.` for a kind)
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
    return `${offer.displayName} ${offer.numeral} (${count(offer.cost)} levels, ${count(offer.lapis)} lapis)`;
}

/**
 * The offers line: `The table offers for your diamond_pickaxe: 1) Efficiency IV (30 levels, 3 lapis), 2) Unbreaking II
 * (20 levels, 2 lapis), 3) Fortune I (12 levels, 1 lapis). Say "take 1", "take 2", "take 3" or "none".`; with a name the
 * table does not offer, `; none of them is mending.` replaces the "Say ..." tail. An offer is numbered by its slot of the
 * table (`index` 0..2) when it has one, else by its place in the list.
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
    return `Level ${count(level)}, offer ${count(index) + 1} needs ${count(cost)}.`;
}

/**
 * `I enchanted your diamond_pickaxe: Efficiency I, Unbreaking I (8 levels, 1 lapis).`: every enchantment the result carries,
 * in the order the item has them (the lead's rule of 2026-11-13: the game adds enchantments beside the offered one), the
 * chosen offer's requirement and lapis in the parentheses.
 * @param {string} itemName
 * @param {string[]} enchantments `Efficiency I` each
 * @param {number} cost the levels the offer required
 * @param {number} lapis
 * @returns {string}
 */
export function enchantedText(itemName, enchantments, cost, lapis) {
    return `I enchanted your ${itemName}: ${(Array.isArray(enchantments) ? enchantments : []).join(', ')} (${count(cost)} levels, ${count(lapis)} lapis).`;
}

/**
 * The pack's own: a choice in the order that is neither 1 to 3 nor a name: `I take offer 1, 2 or 3, or an enchantment by its
 * name, not "5".`
 * @param {*} choice
 * @returns {string}
 */
export function badChoiceText(choice) {
    return `I take offer 1, 2 or 3, or an enchantment by its name, not "${String(choice)}".`;
}

/**
 * The pack's own: `I cannot reach the enchanting table at (x, y, z).`
 * @param {{x: number, y: number, z: number}} pos
 * @returns {string}
 */
export function unreachableText(pos) {
    return `I cannot reach the enchanting table at ${whereText(pos)}.`;
}

/**
 * The pack's own: the window failed or the table did not enchant: `I could not enchant the diamond_pickaxe: <why>.`
 * @param {string} itemName
 * @param {string} why
 * @returns {string}
 */
export function failedText(itemName, why) {
    return `I could not enchant the ${itemName}: ${String(why).replace(/[\s.]+$/, '')}.`;
}

/**
 * The pack's own: the answer of !enchantTake while the question waits: `I take offer 2.`, `I take the item back.` (the
 * running !enchant says what came of it).
 * @param {number} n 0..3
 * @returns {string}
 */
export function takeText(n) {
    return n === 0 ? 'I take the item back.' : `I take offer ${n}.`;
}

/**
 * The log line of a stop, a refusal or a question (SPEC rule 8): `Enchanting no_table at (1, 64, 2), step table: No
 * enchanting table within 32 blocks.`
 * @param {string} reason
 * @param {{x: number, y: number, z: number}|null} pos
 * @param {string} step
 * @param {string} text
 * @returns {string}
 */
export function logLine(reason, pos, step, text) {
    const at = pos ? ` at ${whereText(pos)}` : '';
    return `Enchanting ${reason ?? 'stop'}${at}, step ${step}: ${text}`;
}

// --- the asking texts of 8.1, the enchanting pack's copy for when the breeding pack (ctx.stock) is not loaded; word for
// word and argument for argument as the breeding pack's texts.js has them ---

/**
 * `I took 3 lapis_lazuli from the chest at (x, y, z).`
 * @param {number} n
 * @param {string} item
 * @param {{x: number, y: number, z: number}} pos
 * @returns {string}
 */
export function tookText(n, item, pos) {
    return `I took ${count(n)} ${item} from the chest at ${whereText(pos)}.`;
}

/**
 * `May I take 3 lapis_lazuli from the chest at (x, y, z) for the enchanting? Say yes or no.`
 * @param {number} n
 * @param {string} item
 * @param {{x: number, y: number, z: number}} pos
 * @param {string} purpose
 * @returns {string}
 */
export function askText(n, item, pos, purpose) {
    return `May I take ${count(n)} ${item} from the chest at ${whereText(pos)} for ${purpose}? Say yes or no.`;
}

/**
 * `Only 6 lapis_lazuli are left in the chests; may I take 3 for the enchanting? Say yes or no.`
 * @param {number} left
 * @param {number} n
 * @param {string} item
 * @param {string} purpose
 * @returns {string}
 */
export function askLowText(left, n, item, purpose) {
    return `Only ${count(left)} ${item} ${count(left) === 1 ? 'is' : 'are'} left in the chests; may I take ${count(n)} for ${purpose}? Say yes or no.`;
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
