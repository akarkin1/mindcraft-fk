// Sleep choices of the home pack (spec v0.1.4.6 H4), pure.
import { DAY_TICKS, NIGHT_START, normalizeTimeOfDay } from './night_logic.js';

/** mineflayer's bot.sleep accepts these times of day (lib/plugins/bed.js). */
export const SLEEP_WINDOW = Object.freeze({ start: 12541, end: 23458 });

/** Ticks of one minute of real time (20 ticks per second). */
export const TICKS_PER_MINUTE = 1200;

/**
 * Minutes of real time until the night starts (sunset, 12000), for the text by day (v0.1.4.8, C6).
 * @param {number} timeOfDay bot.time.timeOfDay
 * @returns {number|null} null when the time is not a number
 */
export function minutesUntilNight(timeOfDay) {
    const t = normalizeTimeOfDay(timeOfDay);
    if (t === null) {
        return null;
    }
    return ((NIGHT_START - t + DAY_TICKS) % DAY_TICKS) / TICKS_PER_MINUTE;
}

const FACING_OFFSET = Object.freeze({
    north: { x: 0, z: -1 },
    south: { x: 0, z: 1 },
    west: { x: -1, z: 0 },
    east: { x: 1, z: 0 },
});

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
}

/**
 * A bed is a block whose name ends with `_bed`. `bedrock` is no bed.
 * @param {string} name
 * @returns {boolean}
 */
export function isBedName(name) {
    return typeof name === 'string' && name.endsWith('_bed');
}

/**
 * Can the bot sleep? 'now' within the window of mineflayer or in a thunderstorm, 'soon' after
 * sunset but before the window opens (about 27 s), 'no' otherwise.
 * @param {{timeOfDay: number, thunder?: boolean}} input
 * @returns {'now'|'soon'|'no'}
 */
export function sleepTimeState(input) {
    if (input?.thunder === true) {
        return 'now';
    }
    const t = normalizeTimeOfDay(input?.timeOfDay);
    if (t === null) {
        return 'no';
    }
    if (t >= SLEEP_WINDOW.start && t <= SLEEP_WINDOW.end) {
        return 'now';
    }
    return t >= NIGHT_START && t < SLEEP_WINDOW.start ? 'soon' : 'no';
}

/**
 * The kind of an error of bot.sleep.
 * @param {Error|string} err
 * @returns {'not_night'|'monsters'|'occupied'|'too_far'|'error'}
 */
export function sleepErrorKind(err) {
    const text = typeof err === 'string' ? err : (typeof err?.message === 'string' ? err.message : '');
    if (text.includes('not night')) {
        return 'not_night';
    }
    if (text.includes('monsters nearby')) {
        return 'monsters';
    }
    if (text.includes('occupied')) {
        return 'occupied';
    }
    if (text.includes('too far')) {
        return 'too_far';
    }
    return 'error';
}

/**
 * One entry per bed, nearest first. The foot part of a bed is left out when its head part is
 * in the list too (the head lies one block in the direction of `facing`).
 * @param {{x,y,z,name,part?,facing?,occupied?}[]} beds
 * @param {{x,y,z}} botPos
 * @returns {object[]} copies
 */
export function orderBeds(beds, botPos) {
    if (!Array.isArray(beds)) {
        return [];
    }
    const valid = beds.filter(isPoint);
    const heads = new Set(valid.filter(b => b.part === 'head').map(b => `${b.x},${b.y},${b.z}`));
    const kept = valid.filter(b => {
        if (b.part !== 'foot') {
            return true;
        }
        const off = FACING_OFFSET[b.facing];
        return !(off && heads.has(`${b.x + off.x},${b.y},${b.z + off.z}`));
    }).map(b => ({ ...b }));
    if (!isPoint(botPos)) {
        return kept;
    }
    const d = b => Math.hypot(b.x + 0.5 - botPos.x, b.y - botPos.y, b.z + 0.5 - botPos.z);
    return kept.sort((a, b) => d(a) - d(b));
}
