// Getting out of bed (v0.1.4.8, fix round X5; v0.1.4.12, G1). mineflayer 4.33 left the bed with the
// packet entity_action and the action id 2. Since Minecraft 1.21.6 that id means "stop sprinting" (leave_bed
// is 0 now, the ids are names in minecraft-data: feature entityActionUsesStringMapper). The patch of
// mineflayer (patches/mineflayer+4.33.0.patch) makes bot.wake() send 'leave_bed' there, so wakeUp calls
// bot.wake() only and waits until bot.isSleeping is false. Imports only the clock of context.js.
import { clockOf } from './context.js';

/** How long one try waits for the server to take the bot out of the bed. */
export const WAKE_WAIT_MS = 3000;
/** Tries in all: the first and one more. */
export const WAKE_TRIES = 2;

// Sends "leave bed" through bot.wake() of mineflayer (patched for 1.21.6 and later, G1).
async function sendLeaveBed(bot) {
    if (typeof bot.wake === 'function') {
        await bot.wake();
    }
}

/**
 * Gets the bot out of its bed (X5). Sends "leave bed", then waits until bot.isSleeping is false, at
 * most 3 s, and tries once more. It says that the bot got up only when bot.isSleeping is false. Also
 * works while bot.interrupt_code is set. Never throws.
 * Results: `{ ok: true, woke: false, reason: 'awake', text: 'I am not in bed.' }` for a bot that does not
 * sleep, `{ ok: true, woke: true, reason: null, text: 'I got up.' }`, `{ ok: false, woke: false, reason:
 * 'still_sleeping', text: 'I could not get up. I still lie in the bed.' }`, or reason 'error'.
 * @param {object} bot
 * @param {object} [ctx] { now } of the pack context
 * @param {{now?: Function, wait?: Function, waitMs?: number, tries?: number}} [options] for tests
 * @returns {Promise<{ok: boolean, woke: boolean, reason: string|null, text: string}>}
 */
export async function wakeUp(bot, ctx = {}, options = {}) {
    try {
        if (!bot || typeof bot !== 'object') {
            return { ok: false, woke: false, reason: 'error', text: 'I could not get up: I have no body.' };
        }
        if (bot.isSleeping !== true) {
            return { ok: true, woke: false, reason: 'awake', text: 'I am not in bed.' };
        }
        const o = options && typeof options === 'object' ? options : {};
        const clock = clockOf(ctx, o);
        const waitMs = typeof o.waitMs === 'number' && Number.isFinite(o.waitMs) ? o.waitMs : WAKE_WAIT_MS;
        const tries = typeof o.tries === 'number' && Number.isFinite(o.tries) ? Math.max(1, o.tries) : WAKE_TRIES;
        let lastError = null;
        for (let i = 0; i < tries && bot.isSleeping === true; i++) {
            try {
                await sendLeaveBed(bot);
            } catch (err) {
                lastError = err; // mineflayer: "already awake"; the state decides below
            }
            const start = clock.now();
            // also bounded by the number of looks, so a clock that does not advance cannot keep it waiting
            for (let looks = 0; bot.isSleeping === true && clock.now() - start < waitMs && looks < Math.ceil(waitMs / 50) + 1; looks++) {
                await clock.wait(50);
            }
        }
        if (bot.isSleeping !== true) {
            return { ok: true, woke: true, reason: null, text: 'I got up.' };
        }
        if (lastError) {
            console.warn('Home pack: getting up failed:', lastError?.message ?? lastError);
        }
        return { ok: false, woke: false, reason: 'still_sleeping', text: 'I could not get up. I still lie in the bed.' };
    } catch (err) {
        console.warn('Home pack: getting up failed:', err?.message ?? err);
        return { ok: false, woke: false, reason: 'error', text: `I could not get up: ${err?.message ?? err}` };
    }
}
