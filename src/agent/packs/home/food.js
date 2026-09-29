// Eating (spec v0.1.4.6 H4), the food of the off-hand and of the known chests, and the hunger reflex
// (spec v0.1.4.8 C1, C2, I7). One lock for eating (eat_lock.js, fix round X10): !eat and the reflex
// never call bot.consume() at the same time, and auto-eat is paused while a command eats.
import { botPos, clockOf, dimensionOf, entitiesWhere, logTo, sayTo } from './context.js';
import { acquireEatLock, eatLockOwner, pauseAutoEat, tryEatLock } from './eat_lock.js';
import { BANNED_FOOD, HUNGER_RULES, VANILLA_FOODS, autoEatOptions, chooseFood, chooseKnownFood, hungerDecision, isEdibleFood,
    listKnownFood, wantsFood } from './food_logic.js';
import { reflexOn } from './home_settings.js';
import { goals, gotoGoal, makeMovements } from './motion.js';
import { ateStatusText, noFoodText, notHungryText } from './texts.js';

export { autoEatOptions };

/** The inventory slot of the off-hand. bot.inventory.items() does not list it. */
export const OFFHAND_SLOT = 45;

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// bot.registry.foodsByName, or the foods of 1.21.8 for a bot without a registry.
function foodsOf(bot) {
    const foods = bot?.registry?.foodsByName;
    return isPlainObject(foods) && Object.keys(foods).length > 0 ? foods : VANILLA_FOODS;
}

function mainItems(bot) {
    try {
        const list = bot.inventory.items();
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

function offhandItem(bot) {
    const item = bot?.inventory?.slots?.[OFFHAND_SLOT];
    return item && typeof item.name === 'string' ? item : null;
}

/**
 * All food the bot carries, the off-hand (slot 45) included (v0.1.4.8, I7): the item stacks of
 * bot.inventory.items() and of slot 45 that are food by bot.registry.foodsByName. Banned food
 * (BANNED_FOOD: rotten flesh, spider eyes ...) is left out, because the bot never eats it; with
 * `{ all: true }` it is in the list too. Never throws.
 * @param {object} bot
 * @param {{all?: boolean}} [options]
 * @returns {object[]} the item stacks
 */
export function foodItems(bot, options = {}) {
    try {
        const foods = foodsOf(bot);
        const banned = options?.all === true ? [] : BANNED_FOOD;
        const list = mainItems(bot).filter(item => item && item.slot !== OFFHAND_SLOT);
        const off = offhandItem(bot);
        if (off) {
            list.push(off);
        }
        return list.filter(item => item && (typeof item.count !== 'number' || item.count > 0) && isEdibleFood(item.name, foods, banned));
    } catch {
        return [];
    }
}

/**
 * Moves a food item of the off-hand (slot 45) into a free slot of the inventory (v0.1.4.8, I7), so
 * that every command sees it. Anything that is no food stays in the off-hand; with a full inventory
 * the food stays too (nothing is dropped). The move is checked by reading slot 45 again. Never throws.
 * @param {object} bot
 * @returns {Promise<{ok: boolean, moved: number, text: string}>}
 */
export async function moveOffhandBack(bot) {
    try {
        const item = offhandItem(bot);
        if (!item) {
            return { ok: true, moved: 0, text: 'My off-hand is empty.' };
        }
        if (!isEdibleFood(item.name, foodsOf(bot), [])) {
            return { ok: true, moved: 0, text: `My off-hand holds ${item.name}. That is no food, I leave it there.` };
        }
        const count = isFiniteNumber(item.count) ? item.count : 1;
        const dest = typeof bot.inventory.firstEmptyInventorySlot === 'function' ? bot.inventory.firstEmptyInventorySlot() : null;
        if (!isFiniteNumber(dest) || dest === OFFHAND_SLOT) {
            return { ok: false, moved: 0, text: `My inventory is full. The ${item.name} stays in my off-hand.` };
        }
        await bot.moveSlotItem(OFFHAND_SLOT, dest);
        const left = offhandItem(bot);
        const moved = left && left.name === item.name ? Math.max(0, count - (left.count ?? 0)) : count;
        if (moved === 0) {
            return { ok: false, moved: 0, text: `I could not move the ${item.name} out of my off-hand.` };
        }
        const text = `I moved ${moved} ${item.name} from my off-hand into my inventory.`;
        console.log(`Home pack: ${text}`);
        return { ok: true, moved, text };
    } catch (err) {
        console.warn('Home pack: could not move the off-hand:', err?.message ?? err);
        return { ok: false, moved: 0, text: `I could not move the food out of my off-hand: ${err?.message ?? err}` };
    }
}

/**
 * The food of the chests that the chest index (ctx.chests, storage pack) knows (v0.1.4.8, I7), banned
 * food left out: [{ name, count, chest: {x, y, z} }]. With `from` the nearest chest first. Without an
 * index: []. Never throws.
 * @param {object} ctx
 * @param {{foods?: object, from?: {x,y,z}, dimension?: string}} [options] foods: bot.registry.foodsByName
 * @returns {{name: string, count: number, chest: {x: number, y: number, z: number}}[]}
 */
export function knownFood(ctx, options = {}) {
    try {
        const index = ctx?.chests;
        if (!index || typeof index.list !== 'function') {
            return [];
        }
        const o = isPlainObject(options) ? options : {};
        const chests = index.list(typeof o.dimension === 'string' ? o.dimension : undefined);
        return listKnownFood(chests, { foods: o.foods, from: o.from });
    } catch (err) {
        console.warn('Home pack: could not read the known chests:', err?.message ?? err);
        return [];
    }
}

function droppedName(entity) {
    try {
        return entity.getDroppedItem?.()?.name ?? entity.itemName ?? null;
    } catch {
        return null;
    }
}

async function waitFor(clock, test, ms) {
    const start = clock.now();
    while (!test() && clock.now() - start < ms) {
        await clock.wait(50);
    }
}

// Picks up food items that lie within 8 blocks, nearest first, without digging or placing.
async function pickUpFood(bot, foods, clock) {
    const lying = entitiesWhere(bot, 8, e => e.name === 'item' && isEdibleFood(droppedName(e), foods));
    for (const entity of lying.slice(0, 5)) {
        if (bot.interrupt_code) {
            return;
        }
        await gotoGoal(bot, new goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, 0.5), {
            movements: makeMovements(bot, { dig: false }), timeoutMs: 8000, clock,
        });
        await clock.wait(300);
    }
}

async function consumeWithin(bot, clock, ms) {
    let settled = null;
    Promise.resolve().then(() => bot.consume()).then(() => { settled = { ok: true }; }, err => { settled = { ok: false, err }; });
    const start = clock.now();
    while (settled === null && clock.now() - start < ms) {
        await clock.wait(50);
    }
    return settled ?? { ok: false, err: new Error('eating took too long') };
}

// Puts the item that was in the hand before back into the hand (like equipOldItem of auto-eat).
async function restoreHand(bot, before) {
    try {
        if (!before?.name || bot.heldItem?.name === before.name) {
            return;
        }
        const item = mainItems(bot).find(i => i && i.name === before.name);
        if (item) {
            await bot.equip(item, 'hand');
        }
    } catch {
        // the next action equips what it needs
    }
}

// The food the bot carries by name, the off-hand and banned food included: { bread: 5 }. Never throws.
function foodCounts(bot) {
    const out = {};
    for (const item of foodItems(bot, { all: true })) {
        out[item.name] = (out[item.name] ?? 0) + (isFiniteNumber(item.count) ? item.count : 1);
    }
    return out;
}

// What went from the food counts `before` to `after`, by name: { bread: 2 }.
function foodGone(before, after) {
    const out = {};
    for (const [name, n] of Object.entries(before ?? {})) {
        const d = n - (after?.[name] ?? 0);
        if (d > 0) {
            out[name] = d;
        }
    }
    return out;
}

/**
 * Eats the food with the most food points that is not banned, the off-hand included, until the food
 * level is eatTarget(health): 18, and 20 while health is below 20 (v0.1.4.8, C1). Returns also a
 * `reason`: null, not_hungry, no_food, interrupted, busy, error, and `eaten` (by name). Never throws.
 * @param {object} bot
 * @param {object} ctx
 * @param {{now?: Function, wait?: Function}} options
 * @param {{pickUp: boolean, restoreHand: boolean, log: boolean, lease?: object}} how pickUp: first pick up
 *   food within 8 blocks (walks); restoreHand: the item held before goes back into the hand; log: the
 *   text to ctx.log; lease: the lease of the lock for eating (eat_lock.js), the bot eats only while it is held
 * @returns {Promise<{ok: boolean, ate: number, reason: string|null, text: string, eaten: Object<string, number>}>}
 */
async function eatFood(bot, ctx, options, how) {
    const autoEat = bot?.autoEat;
    let resume = null;
    const held = how.restoreHand ? (bot?.heldItem ?? null) : null;
    const lease = how.lease ?? null;
    let ate = 0;
    const eaten = {};
    try {
        const clock = clockOf(ctx, options);
        if (!wantsFood(bot.food, bot.health)) {
            return { ok: true, ate: 0, reason: 'not_hungry', text: notHungryText(bot.food, bot.health), eaten };
        }
        const foods = foodsOf(bot);
        if (!chooseFood(foodItems(bot), foods) && how.pickUp) {
            const had = foodCounts(bot);
            await pickUpFood(bot, foods, clock);
            how.picked = foodGone(foodCounts(bot), had); // X10: what it picked up counts as carried from the start
        }
        const noFood = () => noFoodText(knownFood(ctx, { foods, from: botPos(bot), dimension: dimensionOf(bot) }));
        if (!chooseFood(foodItems(bot), foods)) {
            return { ok: false, ate: 0, reason: 'no_food', text: noFood(), eaten };
        }
        if (autoEat) {
            // nested pauses: the plugin comes back after the last one, and stays off when the owner switched it off
            resume = pauseAutoEat(bot);
            if (!lease) {
                await waitFor(clock, () => autoEat.isEating !== true, 4000); // with a lease the lock waited already
            }
        }
        let lastError = null;
        let lost = false;
        let cancelled = 0;
        const startCounts = foodCounts(bot);
        const start = clock.now();
        while (!bot.interrupt_code && clock.now() - start < 60000 && wantsFood(bot.food, bot.health)) {
            if (lease && !lease.held()) {
                lost = true; // X10: a command took the lock; it eats now
                break;
            }
            const items = foodItems(bot);
            const name = chooseFood(items, foods);
            if (!name) {
                break;
            }
            try {
                await bot.equip(items.find(i => i.name === name), 'hand');
            } catch (err) {
                lastError = err;
                break;
            }
            if (lease && !lease.held()) {
                lost = true; // taken while the food went into the hand
                break;
            }
            const before = bot.food;
            const res = await consumeWithin(bot, clock, 5000);
            if (!res.ok) {
                // X10: a bite that another eater cancelled is tried once more while the lock is still ours
                if (/cancelled/i.test(`${res.err?.message ?? res.err}`) && cancelled === 0 && (!lease || lease.held())) {
                    cancelled++;
                    continue;
                }
                lastError = res.err;
                break;
            }
            eaten[name] = (eaten[name] ?? 0) + 1;
            ate++;
            // the new food level comes with a packet of the server after the eating
            await waitFor(clock, () => bot.food !== before, 500);
        }
        if (ate === 0) {
            if (lastError) {
                return { ok: false, ate: 0, reason: 'error', text: `I could not eat: ${lastError?.message ?? lastError}`, eaten };
            }
            if (bot.interrupt_code) {
                return { ok: false, ate: 0, reason: 'interrupted', text: 'I stopped eating.', eaten };
            }
            if (lost) {
                return { ok: true, ate: 0, reason: 'busy', text: '', eaten };
            }
            return { ok: false, ate: 0, reason: 'no_food', text: noFood(), eaten };
        }
        // X10: the bites read from the inventory (a bite can end early without eating), at most the own bites
        const counted = await countEaten(bot, startCounts, eaten, clock, true);
        const n = countSum(counted);
        // I6: stopped before the bot had enough: the text still names what it ate
        const stopped = Boolean(bot.interrupt_code) && wantsFood(bot.food, bot.health);
        const status = ateStatusText(counted, bot.food, bot.health);
        const text = stopped ? `${status} ${STOPPED_EATING}` : status;
        if (how.log) {
            logTo(ctx, text);
        }
        return stopped ? { ok: false, ate: n, reason: 'interrupted', text, eaten: counted } : { ok: true, ate: n, reason: null, text, eaten: counted };
    } catch (err) {
        console.warn('Home pack: eating failed:', err?.message ?? err);
        return { ok: false, ate, reason: 'error', text: `I could not eat: ${err?.message ?? err}`, eaten };
    } finally {
        // X10: a reflex that lost the lock leaves the hand alone; a new item in the hand would end the
        // bite of the command that eats now
        if (held && (!lease || lease.held())) {
            await restoreHand(bot, held);
        }
        if (resume) {
            resume();
        }
    }
}

const STOPPED_EATING = 'I was stopped before I had eaten enough.';
const SLOT_SETTLE_MS = 600; // the slot of the last bite can come a moment after the new food level

function countSum(counts) {
    return Object.values(counts ?? {}).reduce((sum, n) => sum + n, 0);
}

// X10: the food that went from the inventory since `base`, by name in the order of the own bites
// `own`, once the slot of the last bite arrived (at most 600 ms). On the real server the slot update
// of one bite ended the next bite early (mineflayer ends a bite when the item in the hand changes), and
// "I ate 5 bread" was said for 3: the bites alone count too many. With `cap` a name counts at most its own
// bites (another eater may have eaten beside); the own bites count alone when the inventory shows nothing.
async function countEaten(bot, base, own, clock, cap) {
    let gone = foodGone(base, foodCounts(bot));
    for (let waited = 0; countSum(gone) < countSum(own) && waited < SLOT_SETTLE_MS; waited += 50) {
        await clock.wait(50);
        gone = foodGone(base, foodCounts(bot));
    }
    const counted = countSum(gone) > 0 ? gone : own;
    const out = {};
    for (const name of [...Object.keys(own), ...Object.keys(counted)]) {
        const n = cap ? Math.min(counted[name] ?? 0, own[name] ?? 0) : (counted[name] ?? 0);
        if (n > 0) {
            out[name] = n;
        }
    }
    return countSum(out) > 0 ? out : { ...own };
}

// X10: the text of !eat counts what the bot ate in all since the command started, read from the
// inventory before and after: also what the reflex or auto-eat ate while the command waited for them.
// Food that the command picked up counts as carried from the start.
async function withAllEaten(bot, res, before, picked, clock) {
    try {
        const base = { ...before };
        for (const [name, n] of Object.entries(picked ?? {})) {
            base[name] = (base[name] ?? 0) + n;
        }
        const all = await countEaten(bot, base, res.eaten ?? {}, clock, false);
        const total = countSum(all);
        if (total === 0) {
            return res; // nothing was eaten: the text of eatFood (not hungry, no food, an error)
        }
        const stopped = res.reason === 'interrupted' || (Boolean(bot.interrupt_code) && wantsFood(bot.food, bot.health));
        const status = ateStatusText(all, bot.food, bot.health);
        const text = stopped ? `${status} ${STOPPED_EATING}` : status;
        return stopped ? { ok: false, ate: total, reason: 'interrupted', text, eaten: all } : { ok: true, ate: total, reason: null, text, eaten: all };
    } catch {
        return res;
    }
}

/**
 * The command !eat (v0.1.4.8, C1). Eats the food in the inventory and the off-hand with the most food
 * points that is not banned, until the food level is 18 or more; while health is below 20 until 20, as
 * long as it has food. With no food it first picks up food items that lie within 8 blocks. Texts:
 * `I ate 2 bread. Food 19 of 20, health 12 of 20.`, `I am not hungry. Food 19 of 20, health 20 of 20.`,
 * `I carry no food. The chest at (11, 67, 53) has 5 apple.` or `I carry no food and know no chest with
 * food.` (the chests of ctx.chests). Fix round X10: it takes the lock for eating (eat_lock.js). While it
 * runs, the hunger reflex does not eat and auto-eat is paused; when the reflex or auto-eat is eating as
 * it starts, it waits for them, at most 4 s, and then goes on. Its text counts what the bot ate in all
 * since the command started (the inventory before and after). Never throws.
 * @param {object} bot
 * @param {object} ctx
 * @param {{now?: Function, wait?: Function, waitMs?: number}} [options] waitMs: the wait for the other eaters
 * When it is stopped: `{ ok: false, reason: 'interrupted', text }`, the text names what it ate (I6).
 * @returns {Promise<{ok: boolean, ate: number, reason: string|null, text: string}>}
 */
export async function eatBestFood(bot, ctx = {}, options = {}) {
    const c = ctx ?? {};
    const o = options ?? {};
    const before = foodCounts(bot);
    const lease = await acquireEatLock(bot, 'command', { ...o, ctx: c });
    try {
        const how = { pickUp: true, restoreHand: false, log: false, lease };
        const own = await eatFood(bot, c, o, how);
        const res = await withAllEaten(bot, own, before, how.picked, clockOf(c, o));
        if (res.ate > 0) {
            logTo(c, res.text);
        }
        return { ok: res.ok, ate: res.ate, reason: res.reason ?? null, text: res.text };
    } finally {
        lease.release();
    }
}

// The eating of the reflex runs beside the action: no walking, the item of the hand comes back, and
// nothing while the bot digs (unless it starves), sleeps, has a window open, auto-eat eats or a command
// holds the lock for eating (X10).
async function reflexEat(bot, ctx) {
    if (eatLockOwner(bot) !== null) {
        return { ok: true, ate: 0, reason: 'busy', text: '' };
    }
    if (bot.autoEat?.isEating === true) {
        return { ok: true, ate: 0, reason: 'auto_eat', text: '' };
    }
    if (bot.isSleeping === true || bot.currentWindow || (bot.targetDigBlock && bot.food > 6)) {
        return { ok: true, ate: 0, reason: 'busy', text: '' };
    }
    const lease = tryEatLock(bot, 'reflex');
    if (!lease) {
        return { ok: true, ate: 0, reason: 'busy', text: '' };
    }
    let res;
    try {
        res = await eatFood(bot, ctx, {}, { pickUp: false, restoreHand: true, log: false, lease });
    } finally {
        lease.release();
    }
    if (res.ate > 0) {
        console.log(`Hunger reflex: ${res.text}`);
    }
    return res;
}

// The fetch of the reflex: the best known food from the chests, then eating. Runs as a mode action.
async function fetchAndEat(bot, ctx, s, known, foods, now) {
    const name = chooseKnownFood(known, foods);
    if (!name) {
        return { ok: false, taken: 0, reason: 'no_food', text: '' };
    }
    const total = known.filter(k => k.name === name).reduce((sum, k) => sum + k.count, 0);
    const count = Math.max(1, Math.min(HUNGER_RULES.fetchCount, total));
    let res;
    try {
        res = await ctx.storage.fetchItem(name, count);
    } catch (err) {
        res = { ok: false, taken: 0, reason: 'error', text: `${err?.message ?? err}` };
    }
    const taken = isFiniteNumber(res?.taken) ? res.taken : 0;
    if (taken <= 0 && !chooseFood(foodItems(bot), foods)) {
        if (res?.reason !== 'interrupted') {
            s.fetchFailedAt = now;
        }
        console.log(`Hunger reflex: I got no ${name} from the chests. ${res?.text ?? ''}`.trim());
        return { ok: false, taken, reason: res?.reason ?? 'not_found', text: res?.text ?? '' };
    }
    s.fetchFailedAt = null;
    // X10: a command that eats now holds the lock; the reflex leaves the eating to it
    const lease = tryEatLock(bot, 'reflex');
    if (!lease) {
        console.log(`Hunger reflex: I took ${taken} ${name} from the chests. I do not eat now, a command eats.`);
        return { ok: true, taken, reason: 'busy', text: '' };
    }
    let eaten;
    try {
        eaten = await eatFood(bot, ctx, {}, { pickUp: false, restoreHand: false, log: true, lease });
    } finally {
        lease.release();
    }
    console.log(`Hunger reflex: I took ${taken} ${name} from the chests. ${eaten.text}`);
    return { ok: eaten.ok, taken, reason: eaten.reason, text: eaten.text };
}

/**
 * One step of the hunger reflex (v0.1.4.8, C2), for the mode `hunger` every 2 s: reads the bot,
 * asks hungerDecision and does what it says. `eat` runs beside the action (no walking). `fetch` takes
 * the best known food with ctx.storage.fetchItem and eats, only inside `state.walk(fn)` (the mode
 * action of part A; without it nothing is fetched). `say` goes to the chat and into the history through
 * ctx.say, without a call of the model (see sayTo). Does nothing while home_pack or
 * home_reflexes.hunger is off. `state` keeps the notes between the steps: lastSaid, fetchFailedAt.
 * Never throws.
 * @param {object} bot
 * @param {object} ctx the pack context: settings, chests, storage, say, now
 * @param {{now?: number, idle?: boolean, playerOrder?: boolean, walk?: (fn: Function) => Promise}} [state]
 * @returns {Promise<{action: string, reason: string, text: string|null, result?: object}>}
 */
export async function hungerStep(bot, ctx = {}, state = {}) {
    const s = isPlainObject(state) ? state : {};
    try {
        if (!reflexOn(ctx?.settings, 'hunger')) {
            return { action: 'none', reason: 'off', text: null };
        }
        if (!bot || !isFiniteNumber(bot.food)) {
            return { action: 'none', reason: 'no_food_level', text: null };
        }
        const now = isFiniteNumber(s.now) ? s.now : clockOf(ctx).now();
        const foods = foodsOf(bot);
        const carries = chooseFood(foodItems(bot), foods) !== null;
        const canFetch = typeof ctx?.storage?.fetchItem === 'function';
        const known = canFetch ? knownFood(ctx, { foods, from: botPos(bot), dimension: dimensionOf(bot) }) : [];
        const decision = hungerDecision({
            food: bot.food,
            health: bot.health,
            carries,
            known,
            idle: s.idle === true,
            playerOrder: s.playerOrder === true,
            lastSaid: s.lastSaid ?? null,
            now,
            fetchFailedAt: s.fetchFailedAt ?? null,
        });
        if (decision.action === 'say') {
            s.lastSaid = { ...(isPlainObject(s.lastSaid) ? s.lastSaid : {}), [decision.kind]: now };
            sayTo(bot, ctx, decision.text);
            return decision;
        }
        if (decision.action === 'eat') {
            return { ...decision, result: await reflexEat(bot, ctx) };
        }
        if (decision.action === 'fetch') {
            // the walk to a chest runs only as the mode action of part A; without state.walk nothing moves,
            // and state.walk resolves false without running the job while a mode of higher priority is active
            if (typeof s.walk !== 'function') {
                return { ...decision, result: { ok: false, taken: 0, reason: 'no_walk', text: '' } };
            }
            let result = null;
            const ran = await s.walk(async () => {
                result = await fetchAndEat(bot, ctx, s, known, foods, now);
            });
            return { ...decision, result: result ?? { ok: false, taken: 0, reason: ran === false ? 'busy' : 'interrupted', text: '' } };
        }
        return decision;
    } catch (err) {
        console.warn('Home pack: the hunger reflex failed:', err?.message ?? err);
        return { action: 'none', reason: 'error', text: null };
    }
}
