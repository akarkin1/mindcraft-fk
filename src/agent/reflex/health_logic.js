// Decisions of self_preservation and self_defense about hunger and low health (spec v0.1.4.8, A9 and A10).
// Pure: no imports.

export const STARVING_TEXT = 'I am starving.';
export const STARVING_LOG_MS = 60000; // the text goes into the behaviour log at most once per 60 s
export const HOSTILE_RANGE = 16;      // a hostile mob this near makes the damage no hunger damage
export const PLAYER_RANGE = 32;       // the retreat goes to a player this near

/**
 * True when the damage is hunger: the food level is 0, the bot is not in lava, not in fire, not burning,
 * has no water over its head, and no hostile mob is within 16 blocks. self_preservation then does not
 * run away.
 * @param {{food: number, inLava?: boolean, inFire?: boolean, burning?: boolean, waterOverHead?: boolean, hostileNear?: boolean}} input
 * @returns {boolean}
 */
export function isHungerDamage(input) {
    const i = input && typeof input === 'object' ? input : {};
    return i.food === 0 && !i.inLava && !i.inFire && !i.burning && !i.waterOverHead && !i.hostileNear;
}

/**
 * The setting flee_below_health: a number from 0 to 20; anything else is 0 (off).
 * @param {*} value
 * @returns {number}
 */
export function fleeBelow(value) {
    return Number.isFinite(value) && value > 0 ? Math.min(value, 20) : 0;
}

/**
 * True when self_defense retreats instead of attacking: flee_below_health is more than 0 and the health
 * is below it.
 * @param {number} health
 * @param {*} setting flee_below_health
 * @returns {boolean}
 */
export function shouldRetreat(health, setting) {
    const limit = fleeBelow(setting);
    return limit > 0 && Number.isFinite(health) && health < limit;
}

/**
 * The line of the behaviour log: `I am hurt (health N of 20). I retreat.` N as the game has it, with one
 * decimal when it is not whole.
 * @param {number} health
 * @returns {string}
 */
export function hurtText(health) {
    const n = Number.isFinite(health) ? (Number.isInteger(health) ? String(health) : health.toFixed(1)) : '?';
    return `I am hurt (health ${n} of 20). I retreat.`;
}

/**
 * Where the retreat goes: to the nearest player within 32 blocks, else into the shelter of the home
 * pack, else away.
 * @param {{player: boolean, shelter: boolean}} input
 * @returns {'player'|'shelter'|'away'}
 */
export function retreatTarget(input) {
    const i = input && typeof input === 'object' ? input : {};
    if (i.player)
        return 'player';
    if (i.shelter)
        return 'shelter';
    return 'away';
}
