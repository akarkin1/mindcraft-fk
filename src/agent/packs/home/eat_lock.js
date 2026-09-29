// One lock for eating per bot (v0.1.4.8, fix round X10). Three eaters call bot.consume() or use an item:
// the commands (!eat, !consume), the hunger reflex of the pack and the plugin auto-eat. mineflayer
// cancels a running bot.consume() when it is called again ("Consuming cancelled due to calling
// bot.consume() again"), so only one of them may eat at a time.
// - A command takes the lock with acquireEatLock: it waits while the reflex holds the lock or auto-eat
//   eats, at most 4 s, then it takes the lock anyway (the reflex stops before its next bite). While a
//   command holds the lock, auto-eat is paused.
// - The reflex takes the lock with tryEatLock only when nobody holds it, and eats only while its
//   lease is held.
// Imports only the clock of context.js. Nothing here throws.
import { clockOf } from './context.js';

/** A command waits at most this long for the reflex and auto-eat. */
export const EAT_LOCK_WAIT_MS = 4000;

const states = new WeakMap();

function isObject(value) {
    return value !== null && typeof value === 'object';
}

function stateOf(bot) {
    let s = states.get(bot);
    if (!s) {
        s = { owner: null, token: 0, pauses: 0, autoEatWasDisabled: false };
        states.set(bot, s);
    }
    return s;
}

const NO_LEASE = Object.freeze({ who: null, held: () => false, release: () => {} });

/**
 * Who holds the lock for eating: 'command', 'reflex' or null. Never throws.
 * @param {object} bot
 * @returns {string|null}
 */
export function eatLockOwner(bot) {
    try {
        return isObject(bot) ? (states.get(bot)?.owner ?? null) : null;
    } catch {
        return null;
    }
}

/**
 * Pauses the plugin auto-eat (bot.autoEat.disabled = true) until the returned function is called.
 * Pauses nest; the plugin comes back only when the last one ends, and only when it was on before the
 * first one (a plugin that the owner switched off stays off). Never throws.
 * @param {object} bot
 * @returns {() => void} resume
 */
export function pauseAutoEat(bot) {
    try {
        const autoEat = bot?.autoEat;
        if (!isObject(bot) || !isObject(autoEat)) {
            return () => {};
        }
        const s = stateOf(bot);
        if (s.pauses === 0) {
            s.autoEatWasDisabled = autoEat.disabled === true;
        }
        s.pauses += 1;
        autoEat.disabled = true;
        let done = false;
        return () => {
            if (done) {
                return;
            }
            done = true;
            try {
                s.pauses = Math.max(0, s.pauses - 1);
                if (s.pauses === 0 && !s.autoEatWasDisabled) {
                    autoEat.disabled = false;
                }
            } catch {
                // nothing to resume
            }
        };
    } catch {
        return () => {};
    }
}

function take(bot, s, who, resume = () => {}) {
    s.token += 1;
    const token = s.token;
    s.owner = who;
    let released = false;
    return {
        who,
        held: () => !released && s.token === token,
        release: () => {
            if (released) {
                return;
            }
            released = true;
            if (s.token === token) {
                s.owner = null;
            }
            resume();
        },
    };
}

/**
 * For the hunger reflex: takes the lock only when nobody holds it and auto-eat does not eat. Returns
 * the lease, or null. The reflex eats only while lease.held() is true and calls lease.release() at
 * the end. Never throws.
 * @param {object} bot
 * @param {string} [who]
 * @returns {{who: string, held: () => boolean, release: () => void}|null}
 */
export function tryEatLock(bot, who = 'reflex') {
    try {
        if (!isObject(bot)) {
            return null;
        }
        const s = stateOf(bot);
        if (s.owner !== null || bot.autoEat?.isEating === true) {
            return null;
        }
        return take(bot, s, who);
    } catch {
        return null;
    }
}

/**
 * For a command (!eat, !consume): pauses auto-eat, waits while another eater holds the lock or
 * auto-eat eats, at most options.waitMs (4 s), then takes the lock; an eater that still holds it loses
 * it (its lease.held() turns false). Auto-eat stays paused until lease.release(). Never throws.
 * @param {object} bot
 * @param {string} [who]
 * @param {{waitMs?: number, ctx?: object, now?: Function, wait?: Function}} [options]
 * @returns {Promise<{who: string, held: () => boolean, release: () => void, waitedMs: number}>}
 */
export async function acquireEatLock(bot, who = 'command', options = {}) {
    try {
        if (!isObject(bot)) {
            return { ...NO_LEASE, waitedMs: 0 };
        }
        const o = isObject(options) ? options : {};
        const clock = clockOf(o.ctx, o);
        const waitMs = typeof o.waitMs === 'number' && Number.isFinite(o.waitMs) ? Math.max(0, o.waitMs) : EAT_LOCK_WAIT_MS;
        const s = stateOf(bot);
        const resume = pauseAutoEat(bot);
        const start = clock.now();
        const busy = () => s.owner !== null || bot.autoEat?.isEating === true;
        // also bounded by the number of looks, so a clock that does not advance cannot keep it waiting
        for (let looks = 0; busy() && clock.now() - start < waitMs && looks < Math.ceil(waitMs / 50) + 1; looks++) {
            await clock.wait(50);
        }
        const lease = take(bot, s, who, resume);
        return { ...lease, waitedMs: Math.max(0, clock.now() - start) };
    } catch {
        return { ...NO_LEASE, waitedMs: 0 };
    }
}
