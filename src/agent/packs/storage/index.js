// The storage pack of v0.1.4.7 (spec section 3, part S): the chest index, the keep plan, storing and
// fetching. Everything the glue needs is exported here. Importing this file has no side effects.
//
// Pure modules (no mineflayer, no src/agent/library): storage_logic, texts.
// The store: chest_index (one file per world, <worldDir>/chests.json).
// Executing module (it moves the bot and gets `ctx` = { chests, settings, log, now }): storage.
// v0.1.4.12 (part E): smelt_logic (pure, no imports) and smelt (the executing module of smeltItem).
import { fetchItem, storeItems } from './storage.js';
import { smeltItem } from './smelt.js';

export { ARROW_KEEP, CONTAINER_KINDS, DIMENSIONS, FOOD_KEEP, KEEP_LIMITS, MATERIALS, TOOL_KINDS, chestKey, chooseChest, cleanName,
    comparePositions, countIn, distanceTo, isArmour, isBed, isContainerKind, isDimensionName, isSeed, keepPlan, keyHalf, materialOf,
    normalizeDimension, normalizeKeepCounts, otherHalfOf, roomFor, summarizeSlots, toolKindOf } from './storage_logic.js';
export { CHESTS_MAX, CHEST_KINDS_MAX, LIST_MAX, TEXTS, chestLine, chestListText, countsText, fetchText, itemChestsText, notFoundText,
    posText, storeText } from './texts.js';
export { CHEST_FILE, ChestIndex } from './chest_index.js';
export { FETCH_LOOK_LIMIT, FETCH_LOOK_RANGE, FETCH_TIMEOUT_MS, LOOK_LIMIT, LOOK_RANGE, LOOK_TIMEOUT_MS, OPEN_TIMEOUT_MS, REACH, STORE_LIMIT,
    STORE_RANGE, STORE_TIMEOUT_MS, chestsText, fetchItem, lookIntoChest, lookIntoChests, recordChest, recordContainer, storeItems } from './storage.js';
// v0.1.4.12 (part E): smelting
export { BATCH_MAX, EXTRA_MS, FUELS, FURNACE_AREA_KINDS, FURNACE_FAR_RANGE, FURNACE_RANGE, NO_FURNACE_KINDS, PER_ITEM_MS, PLACE_RANGE, POLL_MS, SMELT_PRODUCTS,
    areaKindOf, batchesOf, cellAllowsFurnace, chooseFuel, chooseFurnace, chooseFurnaceSpot, fuelKindOf, fuelPer, isBurningLog, isBurningPlanks,
    productOf, timeLimitMs, unitsFor, usableFurnaces, walkLimitMs } from './smelt_logic.js';
export { SMELT_OPEN_TIMEOUT_MS, SMELT_REACH, STALL_MS, smeltItem } from './smelt.js';

/**
 * `ctx.storage` of the pack context (spec section 2): storeItems and fetchItem bound to the bot, and
 * since v0.1.4.12 (part E) smeltItem(item, count, options).
 * The context is read when a function runs, so `ctx` may be a function that returns the current
 * context (a context that cannot be read counts as empty). Called with the bot in front, as
 * `storeItems(bot, ctx, options)`, the functions take the bot and ctx given there.
 * @param {object} bot
 * @param {object|(() => object)} ctx
 * @returns {{storeItems: (options?: object) => Promise<object>, fetchItem: (name: string, count?: number, options?: object) => Promise<object>,
 *   smeltItem: (item: string, count?: number, options?: object) => Promise<object>}}
 */
export function bindStorage(bot, ctx) {
    const current = () => {
        try {
            const value = typeof ctx === 'function' ? ctx() : ctx;
            return value && typeof value === 'object' ? value : {};
        } catch {
            return {};
        }
    };
    return {
        storeItems(...args) {
            if (args[0] === bot && bot) {
                return storeItems(bot, args[1] ?? current(), args[2]);
            }
            return storeItems(bot, current(), args[0]);
        },
        fetchItem(...args) {
            if (args[0] === bot && bot) {
                return fetchItem(bot, args[1] ?? current(), args[2], args[3], args[4]);
            }
            return fetchItem(bot, current(), args[0], args[1], args[2]);
        },
        smeltItem(...args) {
            if (args[0] === bot && bot) {
                return smeltItem(bot, args[1] ?? current(), args[2], args[3], args[4]);
            }
            return smeltItem(bot, current(), args[0], args[1], args[2]);
        },
    };
}
