// The asking rule of the stock permits (spec v0.1.4.16, 8.1, E6): takeOrAsk, one function for every pack that takes from the
// chests for its work. The breeding pack calls it; the enchanting and kill packs reach it as ctx.stock.takeOrAsk, which the
// pack context exposes while the breeding pack is loaded. With enough of the item in the bag nothing is taken; else the
// chests the bot knows that hold it (ctx.chests, within 48 blocks, the nearest first): when the owner allowed the item
// (ctx.permits) and the stock after taking stays above the low mark, the shortfall is taken with ctx.storage.fetchItem and
// the took-line is said; when not allowed yet, or the stock is low, the question is said and the bot waits up to 60 s for a
// permit newer than the question (!allowTaking): yes takes, no or silence ends with the no-permit line and the reason
// no_permit. Every question and refusal writes one log line (rule 8). Never throws.
import { botPos, clockOf, dimensionOf, logTo, sayTo } from '../home/context.js';
import { PURPOSES, askLowText, askText, noPermitText, noStockText, tookText } from './texts.js';

/** The rules of the taking: the chests within this range count, the question waits this long, checked this often. */
export const STOCK_RULES = Object.freeze({ chestRange: 48, askMs: 60000, pollMs: 500 });

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function cleanName(name) {
    if (typeof name !== 'string') {
        return null;
    }
    const clean = name.trim().toLowerCase().replace(/^minecraft:/, '');
    return clean.length > 0 ? clean : null;
}

/**
 * How many of an item the bag holds. Never throws.
 * @param {object} bot
 * @param {string} item
 * @returns {number}
 */
export function bagCount(bot, item) {
    try {
        const list = bot?.inventory?.items?.();
        return (Array.isArray(list) ? list : []).filter(i => i?.name === item).reduce((sum, i) => sum + (isFiniteNumber(i.count) ? i.count : 0), 0);
    } catch {
        return 0;
    }
}

/**
 * The chests of the index that hold the item, within range of the bot (every one without a position), the nearest first:
 * `{ x, y, z, count }`. Never throws.
 * @param {object} ctx { chests }
 * @param {string} item
 * @param {{x, y, z}|null} me
 * @param {string|null} dimension
 * @param {number} range
 * @returns {{x: number, y: number, z: number, count: number, distance: number}[]}
 */
export function chestsWith(ctx, item, me, dimension, range = STOCK_RULES.chestRange) {
    try {
        if (typeof ctx?.chests?.find !== 'function') {
            return [];
        }
        const found = ctx.chests.find(item, dimension ?? undefined);
        return (Array.isArray(found) ? found : [])
            .map(c => ({
                x: c.x, y: c.y, z: c.z, count: isFiniteNumber(c.items?.[item]) ? c.items[item] : 0,
                distance: me ? Math.hypot(c.x + 0.5 - me.x, c.y + 0.5 - me.y, c.z + 0.5 - me.z) : 0,
            }))
            .filter(c => c.count > 0 && c.distance <= range)
            .sort((a, b) => a.distance - b.distance);
    } catch {
        return [];
    }
}

/**
 * Takes an item from the chests the bot knows, or asks the owner first (8.1).
 * @param {object} bot
 * @param {object} ctx { chests, storage, permits, say, log, now }
 * @param {string} item the item name
 * @param {number} count how many the work needs in the bag; the shortfall is taken
 * @param {{low?: number, purpose?: string, now?: Function, wait?: Function, askMs?: number}} [options]
 *   low: the stock after taking must stay above it, else the bot asks (the count of one more use); purpose: the slot of
 *   the question (`the feeding`, `the enchanting`, `the kill room`); now, wait, askMs: for tests
 * @returns {Promise<{ok: boolean, reason: string|null, taken: number, text: string, asked: boolean, chest?: {x, y, z}}>}
 *   reasons: null, bad_name, none (no chest with the item, or no storage pack), no_permit, interrupted, or the reason of
 *   fetchItem; text: the line that ended it (the took-line, said; a refusal, for the caller to answer with)
 */
export async function takeOrAsk(bot, ctx, item, count, options = {}) {
    const clock = clockOf(ctx, options);
    const opts = options && typeof options === 'object' ? options : {};
    const name = cleanName(item);
    const result = (ok, reason, taken, text, extra = {}) => ({ ok, reason, taken, text, asked: false, ...extra });
    if (name === null) {
        return result(false, 'bad_name', 0, '');
    }
    const wanted = isFiniteNumber(count) && count >= 1 ? Math.floor(count) : 1;
    const have = bagCount(bot, name);
    if (have >= wanted) {
        return result(true, null, 0, '');
    }
    const need = wanted - have;
    const low = isFiniteNumber(opts.low) && opts.low >= 0 ? opts.low : 0;
    const purpose = typeof opts.purpose === 'string' && opts.purpose.length > 0 ? opts.purpose : PURPOSES.feeding;
    const chests = chestsWith(ctx, name, botPos(bot), dimensionOf(bot), STOCK_RULES.chestRange);
    if (chests.length === 0 || typeof ctx?.storage?.fetchItem !== 'function') {
        const text = noStockText(name);
        logTo(ctx, text);
        return result(false, 'none', 0, text);
    }
    const stock = chests.reduce((sum, c) => sum + c.count, 0);
    const chest = chests[0];
    const permits = ctx?.permits ?? null;
    const allowed = permits !== null && typeof permits.may === 'function' && permits.may(name) === true;
    const isLow = stock - need <= low;
    let asked = false;
    if (!allowed || isLow) {
        if (permits === null || typeof permits.entry !== 'function') {
            // nothing can remember a yes: the question would wait for nothing
            const text = noPermitText(name);
            logTo(ctx, text);
            return result(false, 'no_permit', 0, text);
        }
        const askedAt = clock.now();
        const question = isLow ? askLowText(stock, need, name, purpose) : askText(need, name, chest, purpose);
        sayTo(bot, ctx, question);
        logTo(ctx, question);
        asked = true;
        const askMs = isFiniteNumber(opts.askMs) && opts.askMs >= 0 ? opts.askMs : STOCK_RULES.askMs;
        let answer = null;
        for (;;) {
            let entry = null;
            try {
                entry = permits.entry(name);
            } catch {
                entry = null;
            }
            if (entry && entry.at > askedAt) {
                answer = entry.allowed === true;
                break;
            }
            if (bot?.interrupt_code) {
                return result(false, 'interrupted', 0, '', { asked });
            }
            if (clock.now() - askedAt >= askMs) {
                break;
            }
            await clock.wait(Math.min(STOCK_RULES.pollMs, Math.max(1, askMs)));
        }
        if (answer !== true) {
            const text = noPermitText(name);
            logTo(ctx, text);
            return result(false, 'no_permit', 0, text, { asked });
        }
    }
    let res;
    try {
        const fetchOptions = {};
        if (typeof opts.now === 'function') fetchOptions.now = opts.now;
        if (typeof opts.wait === 'function') fetchOptions.wait = opts.wait;
        res = await ctx.storage.fetchItem(name, need, fetchOptions);
    } catch (err) {
        res = { ok: false, reason: 'error', taken: 0, text: err?.message ?? String(err) };
    }
    const taken = isFiniteNumber(res?.taken) ? res.taken : 0;
    if (taken <= 0) {
        const text = typeof res?.text === 'string' && res.text.length > 0 ? res.text : noStockText(name);
        logTo(ctx, text);
        return result(false, res?.reason ?? 'error', 0, text, { asked });
    }
    const from = Array.isArray(res.chests) && res.chests[0] && isFiniteNumber(res.chests[0].x) ? res.chests[0] : chest;
    const text = tookText(taken, name, from);
    sayTo(bot, ctx, text);
    return result(taken >= need, taken >= need ? null : (res?.reason ?? 'no_more'), taken, text, { asked, chest: { x: from.x, y: from.y, z: from.z } });
}
