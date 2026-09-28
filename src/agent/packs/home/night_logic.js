// When the bot goes to its shelter by itself (spec v0.1.4.6 H5). Pure.

/** Sunset: the night starts here. Monsters come from about 13000, so the bot has about 50 s. */
export const NIGHT_START = 12000;
/** The night ends here (sunrise begins). */
export const NIGHT_END = 23000;
/** Ticks of one Minecraft day. */
export const DAY_TICKS = 24000;
/** A shelter attempt is not repeated within this time. */
export const SHELTER_COOLDOWN_MS = 60000;
/** Running actions that keep the bot busy with a player or with its safety. */
export const SHELTER_BUSY_ACTIONS = Object.freeze(['action:followPlayer', 'action:goToPlayer', 'action:goToShelter', 'action:goToBed']);
/** Mobs that isHostile of mcdata counts but that do not keep the bot out of its shelter. */
export const NOT_HOSTILE_FOR_SHELTER = Object.freeze(['iron_golem', 'snow_golem', 'allay', 'enderman', 'piglin', 'zombified_piglin']);

// An order older than one full day (20 minutes of real time) never belongs to this night.
const MAX_ORDER_AGE_MS = 20 * 60 * 1000;
const MS_PER_TICK = 50;

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The time of day in 0..23999.
 * @param {number} timeOfDay
 * @returns {number|null} null when not a finite number
 */
export function normalizeTimeOfDay(timeOfDay) {
    if (!isFiniteNumber(timeOfDay)) {
        return null;
    }
    return ((timeOfDay % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
}

/**
 * True from 12000 (sunset) up to 23000.
 * @param {number} timeOfDay bot.time.timeOfDay
 * @returns {boolean}
 */
export function isNight(timeOfDay) {
    const t = normalizeTimeOfDay(timeOfDay);
    return t !== null && t >= NIGHT_START && t < NIGHT_END;
}

/**
 * Like isHostile of src/utils/mcdata.js (type 'mob' or 'hostile', no golems), without allay,
 * enderman, piglin and zombified_piglin, which are peaceful until provoked.
 * @param {{name?: string, type?: string}} entity
 * @returns {boolean}
 */
export function isHostileForShelter(entity) {
    if (!entity || typeof entity.name !== 'string' || entity.name.length === 0) {
        return false;
    }
    if (entity.type !== 'mob' && entity.type !== 'hostile') {
        return false;
    }
    return !NOT_HOSTILE_FOR_SHELTER.includes(entity.name);
}

// Ticks since the last sunset, for a time at night.
function nightTicks(t) {
    return (t - NIGHT_START + DAY_TICKS) % DAY_TICKS;
}

/**
 * True when a player gave the order during the current night.
 * With the time of day of the order: it was night then, not later in the night than now, and
 * less than a day of real time ago. Without it: the order came after the night began, measured
 * in real time from how long the night has lasted.
 * @param {{at: number, atTimeOfDay?: number}|null} order
 * @param {number} timeOfDay the time of day now
 * @param {number} now milliseconds now
 * @returns {boolean}
 */
export function orderedThisNight(order, timeOfDay, now) {
    if (!order || typeof order !== 'object') {
        return false;
    }
    const t = normalizeTimeOfDay(timeOfDay);
    if (t === null || !isNight(t)) {
        return false;
    }
    const at = order.at;
    const orderTime = normalizeTimeOfDay(order.atTimeOfDay);
    if (orderTime !== null) {
        if (!isNight(orderTime) || nightTicks(orderTime) > nightTicks(t)) {
            return false;
        }
        return !(isFiniteNumber(at) && isFiniteNumber(now) && now - at > MAX_ORDER_AGE_MS);
    }
    if (!isFiniteNumber(at) || !isFiniteNumber(now)) {
        return false;
    }
    return now - at <= nightTicks(t) * MS_PER_TICK;
}

function isBusyAction(action) {
    return typeof action === 'string' && (SHELTER_BUSY_ACTIONS.includes(action) || action.startsWith('mode:'));
}

/**
 * Should the bot go to its shelter now? First match wins:
 * not night: no ('day'); in the shelter: no ('in_shelter'); last attempt less than 60 s ago: no
 * ('cooldown'); following a player, going to a player, to the shelter or to bed, or a mode
 * action: no ('busy_with_player_or_safety'); an action a player ordered during this night: no
 * ('ordered_at_night'); otherwise yes ('night'). `selfPrompting` does not change the answer.
 * @param {{timeOfDay: number, inShelter: boolean, action: string, order: object|null,
 *   selfPrompting: boolean, lastAttempt: number|null, now: number}} state
 * @returns {{go: boolean, reason: string}}
 */
export function shouldShelter(state) {
    const s = state && typeof state === 'object' ? state : {};
    if (!isNight(s.timeOfDay)) {
        return { go: false, reason: 'day' };
    }
    if (s.inShelter === true) {
        return { go: false, reason: 'in_shelter' };
    }
    if (isFiniteNumber(s.lastAttempt) && isFiniteNumber(s.now) && s.now - s.lastAttempt < SHELTER_COOLDOWN_MS) {
        return { go: false, reason: 'cooldown' };
    }
    if (isBusyAction(s.action)) {
        return { go: false, reason: 'busy_with_player_or_safety' };
    }
    if (orderedThisNight(s.order, s.timeOfDay, s.now)) {
        return { go: false, reason: 'ordered_at_night' };
    }
    return { go: true, reason: 'night' };
}
