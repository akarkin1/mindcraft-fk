// Texts of the farming pack that the player or the model reads (spec v0.1.4.7 F2). The spec gives
// most of them word for word, tests compare them. Pure.
import { CROPS } from './crop_logic.js';

/** Fixed texts. */
export const TEXTS = Object.freeze({
    noFarm: 'I know no farm here. Stand in the farm and tell me that this is the farm.',
    noComposter: 'I found no composter within 32 blocks.',
    nothingToCompost: 'I found nothing to compost. I do not use seeds for that.',
    noBoneMeal: 'I have no bone_meal.',
    noHoe: 'I have no hoe, so I planted only where the ground was farmland.',
    gateClosed: 'The gate is closed.',
    stopped: 'I was stopped before the end.',
    outOfTime: 'I ran out of time before the end.',
    noShears: 'I have no shears, so I can only collect flowers and saplings.',
});

const MAX_KINDS = 6;

function count(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * `9 wheat, 3 carrots`: sorted by count, highest first, then by name; at most 6 entries, then
 * ` and <n> more kinds`. Zero counts are left out.
 * @param {Object<string, number>} counts
 * @returns {string}
 */
export function countList(counts) {
    const entries = Object.entries(counts ?? {}).filter(([, n]) => count(n) > 0)
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const shown = entries.slice(0, MAX_KINDS).map(([name, n]) => `${n} ${name}`).join(', ');
    return entries.length > MAX_KINDS ? `${shown} and ${entries.length - MAX_KINDS} more kinds` : shown;
}

/**
 * `(-14, 63, 28)`: block coordinates of a position.
 * @param {{x: number, y: number, z: number}} pos
 * @returns {string}
 */
export function whereText(pos) {
    return `(${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`;
}

function plantsAre(n) {
    return n === 1 ? '1 plant is' : `${n} plants are`;
}

function placesStay(n) {
    return n === 1 ? '1 place stays' : `${n} places stay`;
}

function farmWords(name) {
    return typeof name === 'string' && name.length > 0 ? `the farm "${name}"` : 'this farm';
}

/**
 * `I harvested 9 wheat and planted 9 again. 6 plants are not ripe yet.` Plants are counted, not
 * items. Optional sentences: places left empty for want of seeds, unripe plants, and ripe plants
 * left because of the limit.
 * @param {{byCrop: Object<string, number>, replanted: number, unripe: number, unplanted?: number, ripeLeft?: number}} r
 * @returns {string}
 */
export function harvestText(r) {
    const parts = [`I harvested ${countList(r.byCrop)} and planted ${count(r.replanted)} again.`];
    if (count(r.unplanted) > 0) {
        parts.push(`${placesStay(r.unplanted)} empty, I have no more seeds.`);
    }
    if (count(r.unripe) > 0) {
        parts.push(`${plantsAre(r.unripe)} not ripe yet.`);
    }
    if (count(r.ripeLeft) > 0) {
        parts.push(r.ripeLeft === 1 ? '1 ripe plant is left.' : `${r.ripeLeft} ripe plants are left.`);
    }
    return parts.join(' ');
}

/**
 * `I could not reach 3 ripe plants.`
 * @param {number} n
 * @returns {string}
 */
export function unreachedText(n) {
    return n === 1 ? 'I could not reach 1 ripe plant.' : `I could not reach ${count(n)} ripe plants.`;
}

/**
 * `The gate at (0, 64, 5) is open.`
 * @param {{x: number, y: number, z: number}} gate
 * @returns {string}
 */
export function gateOpenText(gate) {
    return `The gate at ${whereText(gate)} is open.`;
}

/**
 * `Nothing is ripe yet. 15 plants are growing.`
 * @param {number} growing
 * @returns {string}
 */
export function nothingRipeText(growing) {
    return `Nothing is ripe yet. ${plantsAre(count(growing))} growing.`;
}

/**
 * `Nothing grows in the farm "wheat_farm". I can plant if I get seeds.` (`this farm` without a name)
 * @param {string|null} name
 * @returns {string}
 */
export function nothingGrowsText(name) {
    return `Nothing grows in ${farmWords(name)}. I can plant if I get seeds.`;
}

/**
 * `I planted 12 wheat_seeds. 3 places stay empty, I have no more seeds.`, with places out of reach
 * and the sentence about the hoe when they apply.
 * @param {{planted: number, seed: string, emptyNoSeeds?: number, emptyUnreached?: number, noHoe?: boolean}} r
 * @returns {string}
 */
export function plantText(r) {
    const parts = [`I planted ${count(r.planted)} ${r.seed}.`];
    if (count(r.emptyNoSeeds) > 0) {
        parts.push(`${placesStay(r.emptyNoSeeds)} empty, I have no more seeds.`);
    }
    if (count(r.emptyUnreached) > 0) {
        parts.push(`${placesStay(r.emptyUnreached)} empty, I could not reach them.`);
    }
    if (r.noHoe) {
        parts.push(TEXTS.noHoe);
    }
    return parts.join(' ');
}

/**
 * `I have no wheat_seeds and know no chest with them.`
 * @param {string} seed
 * @returns {string}
 */
export function noSeedsText(seed) {
    return `I have no ${seed} and know no chest with them.`;
}

/**
 * `Every place in the farm "wheat_farm" is planted already.`
 * @param {string|null} name
 * @returns {string}
 */
export function nothingToPlantText(name) {
    return `Every place in ${farmWords(name)} is planted already.`;
}

/**
 * `I cannot plant melon_seeds. I can plant wheat_seeds, carrot, potato and beetroot_seeds.`
 * @param {string} seed
 * @returns {string}
 */
export function unknownSeedText(seed) {
    const seeds = CROPS.map(r => r.seed);
    return `I cannot plant ${seed}. I can plant ${seeds.slice(0, -1).join(', ')} and ${seeds[seeds.length - 1]}.`;
}

/**
 * `I made 2 bone_meal from 15 items.` When it made less than wished: why (`limit`: 64 items were
 * used; `no_items`: nothing more to compost, with the level of the composter when known).
 * @param {number} made
 * @param {number} used
 * @param {'limit'|'no_items'|string|null} [short]
 * @param {number|null} [level]
 * @returns {string}
 */
export function boneMealText(made, used, short = null, level = null) {
    const base = `I made ${count(made)} bone_meal from ${count(used)} items.`;
    if (short === 'limit') {
        return `${base} I stop after 64 items.`;
    }
    if (short === 'no_items') {
        const at = typeof level === 'number' && Number.isFinite(level) ? `The composter is at level ${level} of 7, ` : '';
        return `${base} ${at}I have nothing more to compost.`;
    }
    return base;
}

/**
 * `I used 6 bone_meal. 4 plants are ripe now.`
 * @param {number} used
 * @param {number} ripe ripe plants in the farm after the work
 * @returns {string}
 */
export function fertilizeText(used, ripe) {
    const r = count(ripe);
    return `I used ${count(used)} bone_meal. ${r === 0 ? 'No plant is ripe yet.' : `${plantsAre(r)} ripe now.`}`;
}

/**
 * `No plant needs bone_meal. 5 plants are ripe.`
 * @param {number} ripe
 * @returns {string}
 */
export function noPlantsToFertilizeText(ripe) {
    const r = count(ripe);
    return r > 0 ? `No plant needs bone_meal. ${plantsAre(r)} ripe.` : 'No plant needs bone_meal.';
}

/**
 * `Farm "wheat_farm": ` and the texts of the parts, joined by spaces; empty parts are left out.
 * @param {string|null} name
 * @param {(string|null)[]} parts
 * @returns {string}
 */
export function cycleText(name, parts) {
    const head = typeof name === 'string' && name.length > 0 ? `Farm "${name}":` : 'Farm:';
    return [head, ...(parts ?? []).filter(p => typeof p === 'string' && p.length > 0)].join(' ');
}

/**
 * `I know no farm "wheat". I know the farms "farm_a", "farm_b".` (at most 6 names), or with no farm
 * at all the text TEXTS.noFarm behind it.
 * @param {string} name
 * @param {string[]} known
 * @returns {string}
 */
export function unknownFarmText(name, known) {
    const names = Array.isArray(known) ? known : [];
    if (names.length === 0) {
        return `I know no farm "${name}". ${TEXTS.noFarm}`;
    }
    const shown = names.slice(0, MAX_KINDS).map(n => `"${n}"`).join(', ');
    const more = names.length > MAX_KINDS ? ` and ${names.length - MAX_KINDS} more` : '';
    return `I know no farm "${name}". I know the farms ${shown}${more}.`;
}
