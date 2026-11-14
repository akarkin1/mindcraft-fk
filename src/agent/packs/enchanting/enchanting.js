// The work of the enchanting pack (spec v0.1.4.16 section 8.3, E7): !enchant(item, choice) at an enchanting table within 32
// blocks with the bot's lapis, and !enchantTake(n), the owner's answer to the question of the offers. The bot never crafts
// or places a table or a bookshelf, and never chooses an offer by itself (DECISIONS O-3): `choice` '' says the offers and
// waits up to 60 s for !enchantTake; a number or a name in the order (the code's choice) takes that offer without asking.
//
// The window as the probe of 2026-11-13 found it on 26.1 (DECISIONS, E7's four facts): the items are moved by their slot
// in the OPEN window (window.items()), not by bot.inventory's; the 'ready' event fires already at the open (costs 0, 0, 0),
// so the offers are polled; "no offer" is cost 0 with the enchantment -1; and when no offer came the item is taken out and
// put back once before the pack says the table offers nothing. The enchantments of the result are read through the F7
// reader enchantsOf of the patched digging plugin, and the enchanted line names every one of them (the lead's rule).
//
// The lapis: 3 in the bag, else ctx.stock.takeOrAsk (8.1, exposed while the breeding pack is loaded), else this pack's own
// copy of the asking rule with ctx.permits and the texts of 8.1. Before window.enchant the lapis slot holds the offer's lapis
// (v0.1.4.16 fix round, V-12: more stacks of the bag put on it; never an enchant with too little). Zero model calls. Every
// refusal, question and stop writes one ctx.log line with the reason, the position, the step and the text (SPEC rule 8).
//
// ctx (every field optional): { log, say, now, areas, chests, storage: { fetchItem }, permits, stock: { takeOrAsk } }.
import diggingPlugin from 'mineflayer/lib/plugins/digging.js';
import { botPos, clockOf, dimensionOf, listAreas, logTo, sayTo } from '../home/context.js';
import { walkNear } from '../home/motion.js';
import {
    ENCHANT_RULES, chooseItem, cleanItemRequest, enchantmentWords, enchantsOfItem, levelShort, matchOffer, offersFrom, parseChoice, parseTake,
    windowSlotOf,
} from './enchant_logic.js';
import {
    LAPIS, PURPOSE, TEXTS, askLowText, askText, badChoiceText, enchantedText, failedText, lapisShortText, levelText, logLine, noItemText, noOfferText,
    noPermitText, noStockText, offersText, takeText, tookBackText, tookText, unreachableText,
} from './texts.js';

// The question that waits for !enchantTake, per bot: { offers, answer: null | 0..3, itemName, at }.
const PENDING = new WeakMap();

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function errorText(err) {
    return err?.message ?? String(err);
}

function outcome(ok, reason, text, extra = {}) {
    return { ok, reason, text, ...extra };
}

// The F7 reader: bot.digging.enchantsOf when a plugin puts it there, else the export of the patched digging plugin; null
// without the patch (enchantsOfItem then reads the item itself).
function reader(bot) {
    if (typeof bot?.digging?.enchantsOf === 'function') {
        return bot.digging.enchantsOf;
    }
    return typeof diggingPlugin?.enchantsOf === 'function' ? diggingPlugin.enchantsOf : null;
}

function isEnchanted(bot, item) {
    return enchantsOfItem(item, bot?.registry ?? null, reader(bot)).length > 0;
}

function bagItems(bot) {
    try {
        const list = bot?.inventory?.items?.();
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

function bagCount(bot, name) {
    return bagItems(bot).filter((i) => i?.name === name).reduce((sum, i) => sum + (isFiniteNumber(i.count) ? i.count : 0), 0);
}

// The nearest enchanting table within range, as a block, or null. Never throws.
function findTable(bot, range) {
    const matching = (b) => b?.name === 'enchanting_table';
    try {
        let pos = null;
        if (typeof bot?.findBlocks === 'function') {
            pos = bot.findBlocks({ matching, maxDistance: range, count: 1 })?.[0] ?? null;
        } else if (typeof bot?.findBlock === 'function') {
            pos = bot.findBlock({ matching, maxDistance: range })?.position ?? null;
        }
        if (!pos) {
            return null;
        }
        const block = bot.blockAt(pos);
        return block?.name === 'enchanting_table' ? block : null;
    } catch {
        return null;
    }
}

// --- the lapis (8.1) ---

// The permit of an item: { allowed, at } through entry() (E6's StockPermits), else may() and allowedAt() of the spec.
function permitOf(permits, item) {
    try {
        if (typeof permits?.entry === 'function') {
            return permits.entry(item);
        }
        if (typeof permits?.allowedAt === 'function') {
            const at = permits.allowedAt(item);
            return at > 0 ? { allowed: true, at } : null;
        }
    } catch {
        // no permit
    }
    return null;
}

function canRemember(permits) {
    return typeof permits?.entry === 'function' || typeof permits?.allowedAt === 'function';
}

// The chests of the index with lapis within range, the nearest first: [{ x, y, z, count }].
function chestsWith(ctx, item, me, dimension, range) {
    try {
        const found = typeof ctx?.chests?.find === 'function' ? ctx.chests.find(item, dimension ?? undefined) : [];
        return (Array.isArray(found) ? found : [])
            .map((c) => ({ x: c.x, y: c.y, z: c.z, count: isFiniteNumber(c.items?.[item]) ? c.items[item] : 0,
                distance: me ? Math.hypot(c.x + 0.5 - me.x, c.y + 0.5 - me.y, c.z + 0.5 - me.z) : 0 }))
            .filter((c) => c.count > 0 && c.distance <= range)
            .sort((a, b) => a.distance - b.distance);
    } catch {
        return [];
    }
}

/**
 * The pack's own copy of the asking rule of 8.1 for the lapis, for when ctx.stock.takeOrAsk is not there (the breeding pack
 * is not loaded): the chests the bot knows within 48 blocks; with the owner's permit and a stock that stays above the low
 * mark the shortfall is taken and the took-line said; else the question is said and the bot waits up to 60 s for a permit
 * newer than the question. Never throws.
 * @returns {Promise<{ok: boolean, reason: string|null, taken: number, text: string}>}
 */
async function askForLapis(bot, ctx, clock, rules, need) {
    const item = LAPIS;
    const me = botPos(bot);
    const chests = chestsWith(ctx, item, me, dimensionOf(bot), rules.chestRange);
    if (chests.length === 0 || typeof ctx?.storage?.fetchItem !== 'function') {
        return { ok: false, reason: 'none', taken: 0, text: noStockText(item) };
    }
    const stock = chests.reduce((sum, c) => sum + c.count, 0);
    const chest = chests[0];
    const permits = ctx?.permits ?? null;
    const allowed = typeof permits?.may === 'function' && permits.may(item) === true;
    const isLow = stock - need <= rules.lapisLow;
    if (!allowed || isLow) {
        if (!canRemember(permits)) {
            return { ok: false, reason: 'no_permit', taken: 0, text: noPermitText(item) };
        }
        const askedAt = clock.now();
        const question = isLow ? askLowText(stock, need, item, PURPOSE) : askText(need, item, chest, PURPOSE);
        sayTo(bot, ctx, question);
        logTo(ctx, logLine('question', me, 'lapis', question));
        let yes = false;
        for (;;) {
            const entry = permitOf(permits, item);
            if (entry && isFiniteNumber(entry.at) && entry.at > askedAt) {
                yes = entry.allowed === true;
                break;
            }
            if (bot?.interrupt_code) {
                return { ok: false, reason: 'interrupted', taken: 0, text: '' };
            }
            if (clock.now() - askedAt >= rules.askMs) {
                break;
            }
            await clock.wait(rules.pollMs * 2);
        }
        if (!yes) {
            return { ok: false, reason: 'no_permit', taken: 0, text: noPermitText(item) };
        }
    }
    let res;
    try {
        res = await ctx.storage.fetchItem(item, need, {});
    } catch (err) {
        res = { ok: false, reason: 'error', taken: 0, text: errorText(err) };
    }
    const taken = isFiniteNumber(res?.taken) ? res.taken : 0;
    if (taken <= 0) {
        return { ok: false, reason: res?.reason ?? 'error', taken: 0, text: typeof res?.text === 'string' && res.text !== '' ? res.text : noStockText(item) };
    }
    const from = Array.isArray(res.chests) && res.chests[0] && isFiniteNumber(res.chests[0].x) ? res.chests[0] : chest;
    const text = tookText(taken, item, from);
    sayTo(bot, ctx, text);
    return { ok: taken >= need, reason: taken >= need ? null : (res?.reason ?? 'no_more'), taken, text };
}

// 3 lapis in the bag: from the bag, else takeOrAsk of the breeding pack, else the own copy. { ok, reason, text }.
async function ensureLapis(bot, ctx, clock, rules, options) {
    const have = bagCount(bot, LAPIS);
    if (have >= rules.lapis) {
        return { ok: true, reason: null, text: '' };
    }
    let res;
    try {
        const takeOrAsk = ctx?.stock?.takeOrAsk;
        if (typeof takeOrAsk === 'function') {
            const opts = { low: rules.lapisLow, purpose: PURPOSE, askMs: rules.askMs };
            if (typeof options?.now === 'function') opts.now = options.now;
            if (typeof options?.wait === 'function') opts.wait = options.wait;
            res = await takeOrAsk(bot, ctx, LAPIS, rules.lapis, opts);
        } else {
            res = await askForLapis(bot, ctx, clock, rules, rules.lapis - have);
        }
    } catch (err) {
        res = { ok: false, reason: 'error', text: errorText(err) };
    }
    if (bagCount(bot, LAPIS) >= rules.lapis) {
        return { ok: true, reason: null, text: '' };
    }
    const reason = res?.reason === 'interrupted' || bot?.interrupt_code ? 'interrupted' : (res?.reason ?? 'no_lapis');
    return { ok: false, reason, text: typeof res?.text === 'string' && res.text !== '' ? res.text : (reason === 'interrupted' ? '' : noStockText(LAPIS)) };
}

// --- the window ---

function windowItems(win) {
    try {
        const list = win?.items?.();
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

// The item to put, as the open window holds it: the bag item's slot in the window (probe fact 1), else the same choice
// among the window's items.
function windowItemOf(bot, win, target) {
    const slot = windowSlotOf(target?.slot, win?.inventoryStart);
    const there = slot !== null ? win?.slots?.[slot] : null;
    if (there && there.name === target.name) {
        return there;
    }
    return chooseItem(windowItems(win), target.name, (i) => isEnchanted(bot, i));
}

function windowGone(bot, win) {
    return Object.prototype.hasOwnProperty.call(bot ?? {}, 'currentWindow') && bot.currentWindow !== win;
}

// The offers after the item was put: polled (probe fact 2) until an offer is there, then once more so all three are in;
// [] when none came within `ms`; null when the bot was stopped.
async function waitOffers(s, win, ms) {
    const t0 = s.clock.now();
    for (;;) {
        if (s.bot?.interrupt_code) {
            return null;
        }
        const offers = offersFrom(win.enchantments, s.bot?.registry ?? null);
        if (offers.length > 0) {
            await s.clock.wait(s.rules.pollMs);
            const all = offersFrom(win.enchantments, s.bot?.registry ?? null);
            return all.length >= offers.length ? all : offers;
        }
        if (s.clock.now() - t0 >= ms) {
            return [];
        }
        await s.clock.wait(s.rules.pollMs);
    }
}

// Puts the item and the lapis and reads the offers; one re-put of the item when none came (probe fact 4).
async function putAndRead(s, win, target) {
    const item = windowItemOf(s.bot, win, target);
    if (!item) {
        throw new Error(`the ${target.name} is not in the window`);
    }
    await win.putTargetItem(item);
    // the largest stack of lapis (putLapis moves one stack; fillLapis puts more before the enchant when the offer needs them)
    const lapis = windowItems(win).filter((i) => i?.name === LAPIS).sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0] ?? null;
    if (lapis) {
        await win.putLapis(lapis);
    }
    let offers = await waitOffers(s, win, s.rules.offersMs);
    if (Array.isArray(offers) && offers.length === 0) {
        try {
            if (win.slots?.[0]) {
                await win.takeTargetItem();
            }
            const again = chooseItem(windowItems(win), target.name, (i) => isEnchanted(s.bot, i));
            if (again) {
                await win.putTargetItem(again);
                offers = await waitOffers(s, win, s.rules.offersRetryMs);
            }
        } catch (err) {
            logTo(s.ctx, logLine('retry', botPos(s.bot), 'offers', `the re-put of the ${target.name} failed: ${errorText(err)}`));
        }
    }
    return offers;
}

// The lapis in the lapis slot (slot 1) of the open window.
function lapisOnTable(win) {
    const there = win?.slots?.[1];
    return there && there.name === LAPIS && isFiniteNumber(there.count) ? there.count : 0;
}

// v0.1.4.16 fix round (V-12): the lapis slot holds at least `need` lapis: while it holds fewer, the next stack of lapis of the
// window's bag part (the largest first) is put on it (the game's click joins a stack to the lapis in the slot); a stack is
// tried once, so a click the server does not take ends it. Returns the lapis in the slot after the puts. Never throws.
async function fillLapis(s, win, need) {
    const tried = new Set();
    let have = lapisOnTable(win);
    while (have < need && !s.bot?.interrupt_code) {
        const stack = windowItems(win).filter((i) => i?.name === LAPIS && (i.count ?? 0) > 0 && !tried.has(i.slot))
            .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0] ?? null;
        if (!stack) {
            break;
        }
        tried.add(stack.slot);
        try {
            await win.putLapis(stack);
        } catch (err) {
            logTo(s.ctx, logLine('retry', botPos(s.bot), 'lapis', `the lapis of slot ${stack.slot} did not go on the table: ${errorText(err)}`));
        }
        have = lapisOnTable(win);
    }
    return have;
}

// The item and the lapis back into the bag. Never throws (closing the window gives them back as well).
async function takeBack(bot, win) {
    try {
        if (win?.slots?.[0]) {
            await win.takeTargetItem();
        }
    } catch {
        // the close gives it back
    }
    try {
        if (win?.slots?.[1] && typeof bot?.putAway === 'function') {
            await bot.putAway(1);
        }
    } catch {
        // the close gives it back
    }
}

function closeWindow(bot, win) {
    try {
        if (typeof bot?.closeWindow === 'function') {
            bot.closeWindow(win);
        } else if (typeof win?.close === 'function') {
            win.close();
        }
    } catch {
        // gone already
    }
}

// Says the offers line and waits for !enchantTake: { n } | { timeout } | { interrupted } | { closed }.
async function askOwner(s, win, offers, itemName) {
    const q = { offers, answer: null, itemName, at: s.clock.now() };
    PENDING.set(s.bot, q);
    const line = offersText(itemName, offers);
    sayTo(s.bot, s.ctx, line);
    logTo(s.ctx, logLine('question', botPos(s.bot), 'offers', line));
    try {
        for (;;) {
            if (q.answer !== null) {
                return { n: q.answer };
            }
            if (s.bot?.interrupt_code) {
                return { interrupted: true };
            }
            if (windowGone(s.bot, win)) {
                return { closed: true };
            }
            if (s.clock.now() - q.at >= s.rules.askMs) {
                return { timeout: true };
            }
            await s.clock.wait(s.rules.pollMs);
        }
    } finally {
        if (PENDING.get(s.bot) === q) {
            PENDING.delete(s.bot);
        }
    }
}

// window.enchant(index), waited for at most enchantMs: the enchanted item, or throws.
async function enchantOffer(s, win, offer) {
    let res = null;
    Promise.resolve()
        .then(() => win.enchant(offer.index))
        .then((item) => { res = { item }; }, (error) => { res = { error }; });
    const t0 = s.clock.now();
    while (res === null && s.clock.now() - t0 < s.rules.enchantMs) {
        await s.clock.wait(s.rules.pollMs);
    }
    if (res === null) {
        throw new Error('the table did not answer');
    }
    if (res.error) {
        throw res.error;
    }
    return res.item ?? win.slots?.[0] ?? null;
}

/**
 * !enchant(item, choice) (8.3): the item of the bag at the enchanting table within 32 blocks. Texts: `No enchanting table
 * within 32 blocks.`, `I have no diamond_pickaxe.`, `The table offers nothing for this diamond_pickaxe.`, the offers line
 * and its question, `I took the diamond_pickaxe back; say "enchant my pickaxe" again when you have chosen.`, the offers line
 * with `; none of them is <name>.`, `Level 12, offer 1 needs 30.`, `Only 2 lapis are on the table; offer 3 needs 3.`,
 * `I enchanted your diamond_pickaxe: Efficiency I, Unbreaking I (8 levels, 1 lapis).`, and the lapis texts of 8.1. Never throws.
 * @param {object} bot
 * @param {object} [ctx]
 * @param {string} item the exact item name or a kind (`pickaxe` takes the best pickaxe of the bag)
 * @param {string|number} [choice] '' asks the owner; 1 to 3 or an enchantment's name takes that offer
 * @param {{now?: Function, wait?: Function, rules?: object}} [options] for tests: the clock, shorter waits
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, offer?: object, enchantments?: string[]}>}
 *   reasons: null, bad_choice, no_item, no_table, no_lapis (or the reason of the lapis: none, no_permit, ...), unreachable,
 *   no_offer, none (the owner said none), no_answer, not_offered, low_level, closed, interrupted, error
 */
export async function enchant(bot, ctx = {}, item = '', choice = '', options = {}) {
    const clock = clockOf(ctx, options);
    const rules = { ...ENCHANT_RULES, ...(options?.rules ?? {}) };
    const s = { bot, ctx, clock, rules };
    const stop = (reason, step, text, extra = {}) => {
        logTo(ctx, logLine(reason, botPos(bot), step, text));
        return outcome(false, reason, text, extra);
    };
    let itemName = cleanItemRequest(item) ?? 'item';
    try {
        const parsed = parseChoice(choice);
        if (parsed.kind === 'bad') {
            return stop('bad_choice', 'choice', badChoiceText(parsed.choice));
        }
        const wanted = cleanItemRequest(item);
        const table = findTable(bot, rules.tableRange);
        if (!table) {
            return stop('no_table', 'table', TEXTS.noTable);
        }
        const isEnch = (i) => isEnchanted(bot, i);
        let target = wanted ? chooseItem(bagItems(bot), wanted, isEnch) : null;
        if (!target) {
            return stop('no_item', 'item', noItemText(wanted ?? 'item to enchant'));
        }
        itemName = target.name;
        const lapis = await ensureLapis(bot, ctx, clock, rules, options);
        if (!lapis.ok) {
            return lapis.reason === 'interrupted' ? outcome(false, 'interrupted', lapis.text) : stop(lapis.reason, 'lapis', lapis.text);
        }
        target = chooseItem(bagItems(bot), itemName, isEnch) ?? target; // the walk to the chest may have moved it
        const walk = await walkNear(bot, table.position, rules.reach, { clock, timeoutMs: rules.walkMs, allowDoors: true, areas: listAreas(ctx, dimensionOf(bot)) });
        if (bot?.interrupt_code || walk?.reason === 'interrupted') {
            return outcome(false, 'interrupted', '');
        }
        if (!walk?.ok) {
            return stop('unreachable', 'walk', unreachableText(table.position));
        }
        let win;
        try {
            win = await bot.openEnchantmentTable(table);
        } catch (err) {
            return stop('error', 'open', failedText(itemName, `the table did not open (${errorText(err)})`));
        }
        try {
            const offers = await putAndRead(s, win, target);
            if (offers === null) {
                await takeBack(bot, win);
                return outcome(false, 'interrupted', tookBackText(itemName));
            }
            if (offers.length === 0) {
                await takeBack(bot, win);
                return stop('no_offer', 'offers', noOfferText(itemName));
            }
            let offer = null;
            if (parsed.kind === 'ask') {
                const answer = await askOwner(s, win, offers, itemName);
                if (answer.interrupted) {
                    await takeBack(bot, win);
                    return outcome(false, 'interrupted', tookBackText(itemName));
                }
                if (answer.closed) {
                    return stop('closed', 'question', tookBackText(itemName));
                }
                if (answer.timeout || answer.n === 0) {
                    await takeBack(bot, win);
                    const text = tookBackText(itemName);
                    logTo(ctx, logLine(answer.timeout ? 'no_answer' : 'none', botPos(bot), 'question', text));
                    return outcome(answer.n === 0, answer.timeout ? 'no_answer' : 'none', text);
                }
                offer = offers.find((o) => o.index === answer.n - 1) ?? null;
            } else {
                offer = parsed.kind === 'index' ? (offers.find((o) => o.index === parsed.index) ?? null) : matchOffer(offers, parsed.name);
                if (!offer) {
                    await takeBack(bot, win);
                    const name = parsed.kind === 'index' ? `offer ${parsed.index + 1}` : parsed.name;
                    return stop('not_offered', 'choice', offersText(itemName, offers, { notOffered: name }));
                }
            }
            const short = bot?.game?.gameMode === 'creative' ? null : levelShort(bot?.experience?.level, offer);
            if (short) {
                await takeBack(bot, win);
                return stop('low_level', 'level', levelText(short.level, short.index, short.cost));
            }
            // v0.1.4.16 fix round (V-12): the lapis slot holds the offer's lapis (index + 1) before the enchant, a second stack
            // (or more) of the bag put on it; the server ignores an enchant with too little, so it is never asked for one (the
            // bag holds the 3 of the dearest offer since ensureLapis, before the window opened)
            const onTable = await fillLapis(s, win, offer.lapis);
            if (bot?.interrupt_code) {
                await takeBack(bot, win);
                return outcome(false, 'interrupted', tookBackText(itemName));
            }
            if (onTable < offer.lapis) {
                await takeBack(bot, win);
                return stop('no_lapis', 'lapis', lapisShortText(onTable, offer.index));
            }
            let enchanted;
            try {
                enchanted = await enchantOffer(s, win, offer);
            } catch (err) {
                await takeBack(bot, win);
                return stop('error', 'enchant', failedText(itemName, errorText(err)));
            }
            const words = enchantmentWords(enchantsOfItem(enchanted, bot?.registry ?? null, reader(bot)), bot?.registry ?? null);
            await takeBack(bot, win);
            if (words.length === 0) {
                return stop('error', 'enchant', failedText(itemName, 'the item came back without an enchantment'));
            }
            const text = enchantedText(itemName, words, offer.cost, offer.lapis);
            logTo(ctx, text);
            return outcome(true, null, text, { offer, enchantments: words });
        } finally {
            closeWindow(bot, win);
        }
    } catch (err) {
        console.warn('Enchanting pack: the enchanting failed:', errorText(err));
        return stop('error', 'enchant', failedText(itemName, errorText(err)));
    }
}

/**
 * !enchantTake(n) (8.3): the owner's answer to the question of a running !enchant: 1, 2 or 3 take that offer, 0 takes the
 * item back. The running !enchant does the work and says what came of it; this answers `I take offer 2.` or `I take the
 * item back.`; without a question `There is no enchanting question to answer.`; an answer that is no offer of the table
 * `Say 1, 2 or 3 to take an offer of the table, or 0 to take the item back.` and the question still waits. Never throws.
 * @param {object} bot
 * @param {object} [ctx]
 * @param {number} n
 * @returns {{ok: boolean, reason: string|null, text: string}}
 */
export function enchantTake(bot, ctx = {}, n = 0) {
    const q = bot ? PENDING.get(bot) ?? null : null;
    if (!q || q.answer !== null) {
        logTo(ctx, logLine('no_question', botPos(bot), 'answer', TEXTS.noQuestion));
        return outcome(false, 'no_question', TEXTS.noQuestion);
    }
    const v = parseTake(n);
    if (v === null || (v > 0 && !q.offers.some((o) => o.index === v - 1))) {
        logTo(ctx, logLine('bad_answer', botPos(bot), 'answer', TEXTS.badTake));
        return outcome(false, 'bad_answer', TEXTS.badTake);
    }
    q.answer = v;
    return outcome(true, null, takeText(v));
}

/**
 * Whether an enchanting question waits for the bot's owner (for the glue and the tests).
 * @param {object} bot
 * @returns {boolean}
 */
export function questionWaits(bot) {
    const q = bot ? PENDING.get(bot) ?? null : null;
    return q !== null && q.answer === null;
}
