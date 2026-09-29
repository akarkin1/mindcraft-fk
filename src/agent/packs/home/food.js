// Eating (spec v0.1.4.6 H4), the food of the off-hand and of the known chests, and the hunger reflex
// (spec v0.1.4.8 C1, C2, I7).
import { botPos, clockOf, dimensionOf, entitiesWhere, logTo, sayTo } from './context.js';
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

/**
 * Eats the food with the most food points that is not banned, the off-hand included, until the food
 * level is eatTarget(health): 18, and 20 while health is below 20 (v0.1.4.8, C1). Returns also a
 * `reason`: null, not_hungry, no_food, interrupted, error. Never throws.
 * @param {object} bot
 * @param {object} ctx
 * @param {{now?: Function, wait?: Function}} options
 * @param {{pickUp: boolean, restoreHand: boolean, log: boolean}} how pickUp: first pick up food within
 *   8 blocks (walks); restoreHand: the item held before goes back into the hand; log: the text to ctx.log
 * @returns {Promise<{ok: boolean, ate: number, reason: string|null, text: string}>}
 */
async function eatFood(bot, ctx, options, how) {
    const autoEat = bot?.autoEat;
    const wasDisabled = autoEat?.disabled === true;
    let paused = false;
    const held = how.restoreHand ? (bot?.heldItem ?? null) : null;
    let ate = 0;
    try {
        const clock = clockOf(ctx, options);
        if (!wantsFood(bot.food, bot.health)) {
            return { ok: true, ate: 0, reason: 'not_hungry', text: notHungryText(bot.food, bot.health) };
        }
        const foods = foodsOf(bot);
        if (!chooseFood(foodItems(bot), foods) && how.pickUp) {
            await pickUpFood(bot, foods, clock);
        }
        const noFood = () => noFoodText(knownFood(ctx, { foods, from: botPos(bot), dimension: dimensionOf(bot) }));
        if (!chooseFood(foodItems(bot), foods)) {
            return { ok: false, ate: 0, reason: 'no_food', text: noFood() };
        }
        if (autoEat && !wasDisabled) {
            autoEat.disabled = true;
            paused = true;
            await waitFor(clock, () => autoEat.isEating !== true, 4000);
        }
        const eaten = {};
        let lastError = null;
        const start = clock.now();
        while (!bot.interrupt_code && clock.now() - start < 60000 && wantsFood(bot.food, bot.health)) {
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
            const before = bot.food;
            const res = await consumeWithin(bot, clock, 5000);
            if (!res.ok) {
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
                return { ok: false, ate: 0, reason: 'error', text: `I could not eat: ${lastError?.message ?? lastError}` };
            }
            if (bot.interrupt_code) {
                return { ok: false, ate: 0, reason: 'interrupted', text: 'I stopped eating.' };
            }
            return { ok: false, ate: 0, reason: 'no_food', text: noFood() };
        }
        // I6: stopped before the bot had enough: the text still names what it ate
        const stopped = Boolean(bot.interrupt_code) && wantsFood(bot.food, bot.health);
        const status = ateStatusText(eaten, bot.food, bot.health);
        const text = stopped ? `${status} I was stopped before I had eaten enough.` : status;
        if (how.log) {
            logTo(ctx, text);
        }
        return stopped ? { ok: false, ate, reason: 'interrupted', text } : { ok: true, ate, reason: null, text };
    } catch (err) {
        console.warn('Home pack: eating failed:', err?.message ?? err);
        return { ok: false, ate, reason: 'error', text: `I could not eat: ${err?.message ?? err}` };
    } finally {
        if (held) {
            await restoreHand(bot, held);
        }
        if (paused) {
            autoEat.disabled = false;
        }
    }
}

/**
 * The command !eat (v0.1.4.8, C1). Eats the food in the inventory and the off-hand with the most food
 * points that is not banned, until the food level is 18 or more; while health is below 20 until 20, as
 * long as it has food. With no food it first picks up food items that lie within 8 blocks. Texts:
 * `I ate 2 bread. Food 19 of 20, health 12 of 20.`, `I am not hungry. Food 19 of 20, health 20 of 20.`,
 * `I carry no food. The chest at (11, 67, 53) has 5 apple.` or `I carry no food and know no chest with
 * food.` (the chests of ctx.chests). The auto-eat plugin is paused meanwhile. Never throws.
 * @param {object} bot
 * @param {object} ctx
 * @param {{now?: Function, wait?: Function}} [options]
 * When it is stopped: `{ ok: false, reason: 'interrupted', text }`, the text names what it ate (I6).
 * @returns {Promise<{ok: boolean, ate: number, reason: string|null, text: string}>}
 */
export async function eatBestFood(bot, ctx = {}, options = {}) {
    const res = await eatFood(bot, ctx ?? {}, options ?? {}, { pickUp: true, restoreHand: false, log: true });
    return { ok: res.ok, ate: res.ate, reason: res.reason ?? null, text: res.text };
}

// The eating of the reflex runs beside the action: no walking, the item of the hand comes back, and
// nothing while the bot digs (unless it starves), sleeps, has a window open or auto-eat eats.
async function reflexEat(bot, ctx) {
    if (bot.autoEat?.isEating === true) {
        return { ok: true, ate: 0, reason: 'auto_eat', text: '' };
    }
    if (bot.isSleeping === true || bot.currentWindow || (bot.targetDigBlock && bot.food > 6)) {
        return { ok: true, ate: 0, reason: 'busy', text: '' };
    }
    const res = await eatFood(bot, ctx, {}, { pickUp: false, restoreHand: true, log: false });
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
    const eaten = await eatFood(bot, ctx, {}, { pickUp: false, restoreHand: false, log: true });
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
