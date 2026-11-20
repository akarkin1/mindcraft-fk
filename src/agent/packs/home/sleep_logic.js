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

/** The name of the saved place of the bot's own bed (v0.1.4.16, F6): the foot of the bed it slept in last. */
export const MY_BED = 'my_bed';

/** The numbers of F6: a bed within this many blocks of a villager's job site or of a villager is a villager's. */
export const BED_RULES = Object.freeze({ jobRange: 8, villagerRange: 8 });

/**
 * The job-site blocks of villagers (F6): a copy of SEED_NAMES.jobs of the survey pack (src/agent/packs/survey/
 * survey_logic.js), because a module of the home pack imports no other pack; xu_bed_order.test.js keeps the copy equal.
 */
export const JOB_SITE_NAMES = Object.freeze(['lectern', 'composter', 'smithing_table', 'fletching_table', 'cartography_table', 'loom',
    'stonecutter', 'grindstone', 'brewing_stand', 'barrel', 'cauldron', 'blast_furnace', 'smoker']);

/**
 * The foot of a bed (F6): for a head part the block one step against `facing` (the head lies one block in the
 * direction of `facing` from the foot), for a foot part or an entry without a part the entry itself.
 * @param {{x: number, y: number, z: number, part?: string, facing?: string}} bed
 * @returns {{x: number, y: number, z: number}|null}
 */
export function bedFoot(bed) {
    if (!isPoint(bed)) {
        return null;
    }
    const off = bed.part === 'head' ? FACING_OFFSET[bed.facing] : null;
    return off ? { x: bed.x - off.x, y: bed.y, z: bed.z - off.z } : { x: bed.x, y: bed.y, z: bed.z };
}

/**
 * True when the bed stands at the saved place `my_bed` (F6): its foot is that block, in the same dimension when both
 * name one.
 * @param {object} bed an entry of findBeds
 * @param {{x: number, y: number, z: number, dimension?: string|null}|null} myBed
 * @param {string|null} [dimension] the dimension of the bot
 * @returns {boolean}
 */
export function isMyBed(bed, myBed, dimension = null) {
    const foot = bedFoot(bed);
    if (!foot || !isPoint(myBed)) {
        return false;
    }
    const plain = d => (typeof d === 'string' && d.length > 0 ? d.replace(/^minecraft:/, '') : null);
    const mine = plain(myBed.dimension);
    const here = plain(dimension);
    if (mine && here && mine !== here) {
        return false;
    }
    return Math.floor(myBed.x) === foot.x && Math.floor(myBed.y) === foot.y && Math.floor(myBed.z) === foot.z;
}

/**
 * One entry per bed. The foot part of a bed is left out when its head part is in the list too (the head lies one
 * block in the direction of `facing`). The order (v0.1.4.16, F6): first the bot's own bed (`options.myBed`, the saved
 * place `my_bed`, when it stands), then the beds marked `home` (inside a home or a shelter the owner saved), then the
 * rest, each group nearest first. A bed marked `excluded` (a villager's: a trading hall, a job site or a villager
 * near it) is left out.
 * @param {{x,y,z,name,part?,facing?,occupied?,home?: boolean,excluded?: string|null}[]} beds
 * @param {{x,y,z}} botPos
 * @param {{myBed?: {x,y,z,dimension?}|null, dimension?: string|null}} [options]
 * @returns {object[]} copies
 */
export function orderBeds(beds, botPos, options = {}) {
    if (!Array.isArray(beds)) {
        return [];
    }
    const valid = beds.filter(isPoint).filter(b => !b.excluded);
    const heads = new Set(valid.filter(b => b.part === 'head').map(b => `${b.x},${b.y},${b.z}`));
    const kept = valid.filter(b => {
        if (b.part !== 'foot') {
            return true;
        }
        const off = FACING_OFFSET[b.facing];
        return !(off && heads.has(`${b.x + off.x},${b.y},${b.z + off.z}`));
    }).map(b => ({ ...b }));
    const myBed = options?.myBed ?? null;
    const rank = b => (isMyBed(b, myBed, options?.dimension ?? null) ? 0 : b.home === true ? 1 : 2);
    if (!isPoint(botPos)) {
        return kept.sort((a, b) => rank(a) - rank(b));
    }
    const d = b => Math.hypot(b.x + 0.5 - botPos.x, b.y - botPos.y, b.z + 0.5 - botPos.z);
    return kept.sort((a, b) => (rank(a) - rank(b)) || (d(a) - d(b)));
}
