// Eating (spec v0.1.4.6 H4).
import { clockOf, entitiesWhere, logTo } from './context.js';
import { EAT_UNTIL, FULL_FOOD, autoEatOptions, chooseFood, isEdibleFood } from './food_logic.js';
import { goals, gotoGoal, makeMovements } from './motion.js';
import { TEXTS, ateText } from './texts.js';

export { autoEatOptions };

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function items(bot) {
    try {
        return bot.inventory.items();
    } catch {
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

/**
 * Eats the food in the inventory with the most food points that is not banned, until the food
 * level is at least 18 or the food is used up; at least one item unless the bot is full. With no
 * food it first picks up food items that lie within 8 blocks. Texts: `I ate 2 bread.`,
 * `I am not hungry.` (food level 20), `I have no food.`. The auto-eat plugin is paused meanwhile.
 * Never throws.
 * @param {object} bot
 * @param {object} ctx
 * @param {{now?: Function, wait?: Function}} [options]
 * @returns {Promise<{ok: boolean, ate: number, text: string}>}
 */
export async function eatBestFood(bot, ctx = {}, options = {}) {
    const autoEat = bot?.autoEat;
    const wasDisabled = autoEat?.disabled === true;
    try {
        const clock = clockOf(ctx, options);
        if (!(isFiniteNumber(bot.food) && bot.food < FULL_FOOD)) {
            return { ok: true, ate: 0, text: TEXTS.notHungry };
        }
        const foods = bot.registry?.foodsByName ?? {};
        if (!chooseFood(items(bot), foods)) {
            await pickUpFood(bot, foods, clock);
        }
        if (!chooseFood(items(bot), foods)) {
            return { ok: false, ate: 0, text: TEXTS.noFood };
        }
        if (autoEat && !wasDisabled) {
            autoEat.disabled = true;
            await waitFor(clock, () => autoEat.isEating !== true, 4000);
        }
        const eaten = {};
        let ate = 0;
        let lastError = null;
        const start = clock.now();
        while (!bot.interrupt_code && clock.now() - start < 60000 && bot.food < FULL_FOOD && (ate === 0 || bot.food < EAT_UNTIL)) {
            const name = chooseFood(items(bot), foods);
            if (!name) {
                break;
            }
            try {
                await bot.equip(items(bot).find(i => i.name === name), 'hand');
            } catch (err) {
                lastError = err;
                break;
            }
            const res = await consumeWithin(bot, clock, 5000);
            if (!res.ok) {
                lastError = res.err;
                break;
            }
            eaten[name] = (eaten[name] ?? 0) + 1;
            ate++;
        }
        if (ate === 0) {
            if (lastError) {
                return { ok: false, ate: 0, text: `I could not eat: ${lastError?.message ?? lastError}` };
            }
            return { ok: false, ate: 0, text: bot.interrupt_code ? 'I stopped eating.' : TEXTS.noFood };
        }
        const text = ateText(eaten);
        logTo(ctx, text);
        return { ok: true, ate, text };
    } catch (err) {
        console.warn('Home pack: eating failed:', err?.message ?? err);
        return { ok: false, ate: 0, text: `I could not eat: ${err?.message ?? err}` };
    } finally {
        if (autoEat && !wasDisabled) {
            autoEat.disabled = false;
        }
    }
}

