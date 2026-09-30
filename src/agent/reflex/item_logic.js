// Which item on the ground the mode item_collecting may try to pick up (spec v0.1.4.8, A8). Pure: no imports.
//
// An item that a player throws cannot be picked up for 2 s. A pick-up that gained nothing is tried again
// after 3 s, at most 3 times. An item that the bot itself dropped in the last 10 s is left.

export const ITEM_RULES = Object.freeze({
    retryMs: 3000,    // the wait before the same item is tried again
    maxRetries: 3,    // tries after the first one
    ownDropMs: 10000, // an item that the bot dropped is left this long
});

/**
 * True when the item entity may be tried now: never tried, or tried without gain, fewer than
 * 1 + maxRetries times, and the retry time has come.
 * @param {{tries: number, nextAt: number, done: boolean}|undefined|null} record
 * @param {number} now
 * @returns {boolean}
 */
export function mayTryItem(record, now) {
    if (!record)
        return true;
    return !record.done && now >= record.nextAt;
}

/**
 * The record of an item after a pick-up: done when the inventory gained something or when the retries
 * are used up; else the next try after retryMs.
 * @param {{tries: number}|undefined|null} record before this try
 * @param {boolean} gained
 * @param {number} now
 * @returns {{tries: number, nextAt: number, done: boolean}}
 */
export function afterItemTry(record, gained, now) {
    const tries = (Number.isInteger(record?.tries) ? record.tries : 0) + 1;
    const done = Boolean(gained) || tries > ITEM_RULES.maxRetries;
    return { tries, nextAt: done ? Infinity : now + ITEM_RULES.retryMs, done };
}

/**
 * True when an item entity that just appeared was thrown by the bot: a thrown item starts at the x and z
 * of the thrower, 0.3 below its eyes (1.32 above the feet, 0.97 when it sneaks). A drop of a broken block
 * starts at the middle of the block, 0.55 or more away from the bot in x and z.
 * @param {{x,y,z}} itemPos the position of the item when it appeared
 * @param {{x,y,z}} botPos the position of the bot
 * @returns {boolean}
 */
export function isOwnDropSpawn(itemPos, botPos) {
    const ok = (p) => p !== null && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
    if (!ok(itemPos) || !ok(botPos))
        return false;
    const dy = itemPos.y - botPos.y;
    return Math.hypot(itemPos.x - botPos.x, itemPos.z - botPos.z) < 0.4 && dy >= 0.8 && dy <= 1.6;
}

/**
 * True while an item that the bot dropped at droppedAt is left alone.
 * @param {number|undefined} droppedAt
 * @param {number} now
 * @returns {boolean}
 */
export function isRecentOwnDrop(droppedAt, now) {
    return Number.isFinite(droppedAt) && now - droppedAt < ITEM_RULES.ownDropMs;
}
