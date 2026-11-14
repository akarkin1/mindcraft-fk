// Texts of the AFK creeper kill pack that the player reads (spec v0.1.4.16, section 8.4). The spec gives them word
// for word, tests compare them. Pure.

/**
 * Fixed texts.
 */
export const TEXTS = Object.freeze({
    noSpot: 'I know no place "kill_spot". Stand at your spot and say "remember here as kill_spot".',
    noHopper: 'I see no hopper within 3 blocks of the kill spot; is this the right spot?',
    noSlab: 'The kill room has no slab over the hoppers; I do not farm there.',
    start: 'I farm creepers at the kill spot. Stay more than 128 blocks away or log out, so the farm\'s monsters get the cap. '
        + 'Leave a one-block gap above the first hopper row, or the XP stays behind the slab.',
    noKill: 'I cannot kill from this spot; check the slab and the hoppers.',
    noFood: 'I have no food left; I farm on until my health is low.',
    noBed: 'No bed within 16 blocks of the kill spot; I farm through the night.',
    noWay: 'I found no way to the kill spot.',
});

const MAX_KINDS = 6;

function count(value) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * `280 creepers`, `1 creeper`.
 * @param {number} n
 * @returns {string}
 */
export function creepersText(n) {
    const k = count(n);
    return k === 1 ? '1 creeper' : `${k} creepers`;
}

/**
 * `268 gunpowder stored`.
 * @param {number} n
 * @returns {string}
 */
export function storedText(n) {
    return `${count(n)} gunpowder stored`;
}

/**
 * `1 hour 10 minutes`, `2 hours`, `20 minutes`, `1 minute`, `0 minutes` (whole minutes, rounded).
 * @param {number} ms
 * @returns {string}
 */
export function durationText(ms) {
    const minutes = Math.round(count(ms) / 60000);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const parts = [];
    if (h > 0) {
        parts.push(h === 1 ? '1 hour' : `${h} hours`);
    }
    if (m > 0 || h === 0) {
        parts.push(m === 1 ? '1 minute' : `${m} minutes`);
    }
    return parts.join(' ');
}

/**
 * `64 gunpowder, 3 bone`: sorted by count, highest first, then by name; at most 6 kinds, then ` and N more kinds`.
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
 * The kill check's first verdict: `My hits do not kill from here: 24 hits, no XP. I step closer.`
 * @param {number} hits
 * @returns {string}
 */
export function stepCloserText(hits) {
    return `My hits do not kill from here: ${count(hits)} hits, no XP. I step closer.`;
}

/**
 * The quiet line of a store trip: `I stored 64 gunpowder.`
 * @param {Object<string, number>} stored
 * @returns {string}
 */
export function storedLineText(stored) {
    const list = countList(stored);
    return `I stored ${list === '' ? 'nothing' : list}.`;
}

/**
 * `I have no sword left and cannot make one; I stop the farming at level 14.`
 * @param {number} level
 * @returns {string}
 */
export function noWeaponText(level) {
    return `I have no sword left and cannot make one; I stop the farming at level ${count(level)}.`;
}

/**
 * `My stone_sword is worn; I take the iron_sword.`
 * @param {string} worn
 * @param {string} next
 * @returns {string}
 */
export function wornWeaponText(worn, next) {
    return `My ${worn} is worn; I take the ${next}.`;
}

/**
 * The progress line (8.4a, with the hits): `I killed 50 creepers with 61 hits; level 14; 62 gunpowder stored.`
 * @param {number} kills
 * @param {number} hits every hit of the run, also those on targets that are not dead yet
 * @param {number} level
 * @param {number} stored
 * @returns {string}
 */
export function progressText(kills, hits, level, stored) {
    const h = count(hits);
    return `I killed ${creepersText(kills)} with ${h === 1 ? '1 hit' : `${h} hits`}; level ${count(level)}; ${storedText(stored)}.`;
}

/**
 * `I stop the farming: level 30 reached; 280 creepers, 1 hour 10 minutes; 268 gunpowder stored.`
 * @param {number} level
 * @param {number} kills
 * @param {number} ms the time farmed
 * @param {number} stored
 * @returns {string}
 */
export function stopLevelText(level, kills, ms, stored) {
    return `I stop the farming: level ${count(level)} reached; ${creepersText(kills)}, ${durationText(ms)}; ${storedText(stored)}.`;
}

/**
 * `I stop the farming: 20 minutes are over; 70 creepers; 61 gunpowder stored.`
 * @param {number} minutes
 * @param {number} kills
 * @param {number} stored
 * @returns {string}
 */
export function stopMinutesText(minutes, kills, stored) {
    const m = count(minutes);
    return `I stop the farming: ${m === 1 ? '1 minute is' : `${m} minutes are`} over; ${creepersText(kills)}; ${storedText(stored)}.`;
}

/**
 * The owner's stop: `I leave the kill room: you said stop; 70 creepers, 61 gunpowder stored.`
 * @param {number} kills
 * @param {number} stored
 * @returns {string}
 */
export function stoppedText(kills, stored) {
    return `I leave the kill room: you said stop; ${creepersText(kills)}, ${storedText(stored)}.`;
}

/**
 * `I leave the kill room: health 9.`
 * @param {number} health
 * @returns {string}
 */
export function lowHealthText(health) {
    return `I leave the kill room: health ${count(health)}.`;
}

/**
 * `I do not understand "tomorrow": say "level 30" or "20 minutes", or nothing.`
 * @param {string} until
 * @returns {string}
 */
export function badUntilText(until) {
    return `I do not understand "${typeof until === 'string' ? until : String(until ?? '')}": say "level 30" or "20 minutes", or nothing.`;
}
