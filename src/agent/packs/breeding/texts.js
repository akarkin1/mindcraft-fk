// Texts of the breeding pack (spec v0.1.4.16, 8.2) and of the asking rule of the stock permits (8.1), word for word; tests
// compare them. Pure. The species and their young are named in words (`cows`, `calves`); a pen is named as the survey
// writes an area's name, with the underscores as spaces (`cow_pen` is `the cow pen`).

/** The purposes of the asking rule (8.1): the slot of `May I take 8 wheat ... for the feeding?`. */
export const PURPOSES = Object.freeze({ feeding: 'the feeding', enchanting: 'the enchanting', killRoom: 'the kill room' });

/** The species the pack breeds, in the order of the refusal line. */
export const BRED_SPECIES = Object.freeze(['cow', 'sheep', 'pig', 'chicken', 'rabbit']);

const SAME_PLURAL = new Set(['sheep']);

// The young of a species, one and many; a mooshroom's calves; `young` (invariant) for a species without a word.
const YOUNG = Object.freeze({
    cow: ['calf', 'calves'], mooshroom: ['calf', 'calves'], sheep: ['lamb', 'lambs'], pig: ['piglet', 'piglets'],
    chicken: ['chick', 'chicks'], rabbit: ['kit', 'kits'],
});

function count(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function word(name) {
    return String(name ?? '').replace(/^minecraft:/, '').replace(/_/g, ' ');
}

function plural(w) {
    if (SAME_PLURAL.has(w)) {
        return w;
    }
    return /(s|x|ch|sh)$/.test(w) ? `${w}es` : `${w}s`;
}

/**
 * `(-14, 63, 28)`: block coordinates of a position.
 * @param {{x: number, y: number, z: number}} pos
 * @returns {string}
 */
export function whereText(pos) {
    const c = v => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : v);
    return `(${c(pos?.x)}, ${c(pos?.y)}, ${c(pos?.z)})`;
}

/**
 * A species in words for a count: `cow`, `cows`, `sheep`, `mooshrooms`.
 * @param {string} species the entity name
 * @param {number} [n] 2 without one (the plural)
 * @returns {string}
 */
export function speciesWords(species, n = 2) {
    const w = word(species);
    return count(n) === 1 ? w : plural(w);
}

/**
 * The young of a species for a count: `calf`, `2 calves`, `lambs`, `piglets`, `chicks`, `kits`; `young` for any other.
 * @param {string} species
 * @param {number} n
 * @returns {string} the count and the word, `2 calves`
 */
export function youngWords(species, n) {
    const pair = YOUNG[word(species).replace(/ /g, '_')] ?? ['young', 'young'];
    return `${count(n)} ${count(n) === 1 ? pair[0] : pair[1]}`;
}

/**
 * The name of a pen in words: `cow_pen` is `the cow pen`.
 * @param {string} name the saved name of the pen
 * @returns {string}
 */
export function penWords(name) {
    return `the ${word(name)}`;
}

/**
 * `I know no pen "X".`
 * @param {string} name
 * @returns {string}
 */
export function unknownPenText(name) {
    return `I know no pen "${typeof name === 'string' ? name : ''}".`;
}

/**
 * `I do not know what the horses eat; I breed cows, sheep, pigs, chickens and rabbits.`
 * @param {string} species the entity name of the animals of the pen
 * @returns {string}
 */
export function unknownSpeciesText(species) {
    const bred = BRED_SPECIES.map(s => speciesWords(s));
    return `I do not know what the ${speciesWords(species)} eat; I breed ${bred.slice(0, -1).join(', ')} and ${bred[bred.length - 1]}.`;
}

/**
 * A pen without animals (not in the spec; the species cannot be read): `I see no animals in the cow pen.`
 * @param {string} penName
 * @returns {string}
 */
export function noAnimalsText(penName) {
    return `I see no animals in ${penWords(penName)}.`;
}

/**
 * `The cow pen is full: 12 animals; I breed no more there.`
 * @param {string} penName
 * @param {number} n adults and babies in the box
 * @returns {string}
 */
export function penFullText(penName, n) {
    return `The ${word(penName)} is full: ${count(n)} animals; I breed no more there.`;
}

/**
 * `I have no wheat for the cows.`
 * @param {string} feed the item
 * @param {string} species
 * @returns {string}
 */
export function noFeedText(feed, species) {
    return `I have no ${feed} for the ${speciesWords(species)}.`;
}

/**
 * The line of a pair: `I fed 2 cows in the cow pen.`
 * @param {number} n the animals fed
 * @param {string} species
 * @param {string} penName
 * @returns {string}
 */
export function fedText(n, species, penName) {
    return `I fed ${count(n)} ${speciesWords(species, n)} in ${penWords(penName)}.`;
}

/**
 * The end line: `I fed 4 cows in the cow pen; 2 calves.`
 * @param {number} fed the animals fed
 * @param {string} species
 * @param {string} penName
 * @param {number} babies the new young
 * @returns {string}
 */
export function endText(fed, species, penName, babies) {
    return `I fed ${count(fed)} ${speciesWords(species, fed)} in ${penWords(penName)}; ${youngWords(species, babies)}.`;
}

/**
 * The line of a stop: `I stopped the feeding at the cow pen: 2 cows fed, 1 calf.`
 * @param {string} penName
 * @param {number} fed
 * @param {string} species
 * @param {number} babies
 * @returns {string}
 */
export function stoppedText(penName, fed, species, babies) {
    return `I stopped the feeding at ${penWords(penName)}: ${count(fed)} ${speciesWords(species, fed)} fed, ${youngWords(species, babies)}.`;
}

/**
 * The walk found no stand cell outside the fence (not in the spec): `I found no way around the cow pen.`
 * @param {string} penName
 * @returns {string}
 */
export function noWayText(penName) {
    return `I found no way around ${penWords(penName)}.`;
}

// --- the asking rule of the stock permits (8.1) ---

/**
 * `I took 8 wheat from the chest at (x, y, z).`
 * @param {number} n
 * @param {string} item
 * @param {{x: number, y: number, z: number}} pos the chest
 * @returns {string}
 */
export function tookText(n, item, pos) {
    return `I took ${count(n)} ${item} from the chest at ${whereText(pos)}.`;
}

/**
 * `May I take 8 wheat from the chest at (x, y, z) for the feeding? Say yes or no.`
 * @param {number} n
 * @param {string} item
 * @param {{x: number, y: number, z: number}} pos the chest
 * @param {string} purpose `the feeding`, `the enchanting`, `the kill room`
 * @returns {string}
 */
export function askText(n, item, pos, purpose) {
    return `May I take ${count(n)} ${item} from the chest at ${whereText(pos)} for ${purpose}? Say yes or no.`;
}

/**
 * The stock is low: `Only 6 wheat are left in the chests; may I take 8 for the feeding? Say yes or no.` (`is` for 1)
 * @param {number} left the item in the chests the bot knows
 * @param {number} n the count to take
 * @param {string} item
 * @param {string} purpose
 * @returns {string}
 */
export function askLowText(left, n, item, purpose) {
    return `Only ${count(left)} ${item} ${count(left) === 1 ? 'is' : 'are'} left in the chests; may I take ${count(n)} for ${purpose}? Say yes or no.`;
}

/**
 * No or silence: `I take no wheat without your word; say "you may take wheat" when you want.`
 * @param {string} item
 * @returns {string}
 */
export function noPermitText(item) {
    return `I take no ${item} without your word; say "you may take ${item}" when you want.`;
}

/**
 * No chest with the item: `I have no wheat and the chests have none.`
 * @param {string} item
 * @returns {string}
 */
export function noStockText(item) {
    return `I have no ${item} and the chests have none.`;
}
