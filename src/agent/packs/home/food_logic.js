// Food choices of the home pack (spec v0.1.4.6 H4, v0.1.4.8 C1 and C2), pure.
import { TEXTS, hungryText } from './texts.js';

/** Food the bot never eats by itself. */
export const BANNED_FOOD = Object.freeze(['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'chicken',
    'golden_apple', 'enchanted_golden_apple', 'chorus_fruit', 'suspicious_stew']);

/**
 * v0.1.4.14 (part D, SPEC 4.3): the fish buckets that minecraft-data 26.1 lists as foods. A bucket is never food; the
 * auto-eat plugin chooses from bot.registry.foodsByName, so autoEatOptions bans them too.
 */
export const FISH_BUCKETS = Object.freeze(['cod_bucket', 'salmon_bucket', 'pufferfish_bucket', 'tropical_fish_bucket']);

/** The food level of a full bot. */
export const FULL_FOOD = 20;
/** The bot eats until the food level is at least this. */
export const EAT_UNTIL = 18;
/** The health of an unhurt bot. A hurt bot eats until the food level is FULL_FOOD (v0.1.4.8, C1). */
export const FULL_HEALTH = 20;

/**
 * The defaults of mineflayer-auto-eat 3.3.6, used when the bot has no options object. `offhand` is
 * false since v0.1.4.8 (C1): the plugin moved the whole stack into the off-hand (slot 45), where
 * bot.inventory.items() does not see it.
 */
export const AUTO_EAT_DEFAULTS = Object.freeze({
    priority: 'saturation',
    startAt: 16,
    eatingTimeout: 3000,
    bannedFood: Object.freeze(['pufferfish', 'spider_eye', 'poisonous_potato', 'rotten_flesh', 'chorus_fruit', 'chicken',
        'suspicious_stew', 'golden_apple']),
    ignoreInventoryCheck: false,
    checkOnItemPickup: true,
    offhand: false,
    equipOldItem: true,
});

/**
 * The foods of Minecraft 26.1 (minecraft-data 3.119.0, pc/26.1/foods.json) with their food points and saturation,
 * in the shape of bot.registry.foodsByName. For callers without a bot, such as knownFood(ctx). v0.1.4.14 (part D):
 * the saturation column holds the game's values (an apple 2.4, bread 6; the table of 1.21.8 held 19.2 and 60, twice
 * the points times the game's value), so the order of foods of the same points is the same, and every caller compares
 * saturations, none reads one as a number of its own. The four fish buckets are listed as foods by 26.1 and are no food
 * (isEdibleFood).
 */
export const VANILLA_FOODS = Object.freeze(Object.fromEntries([
    ['apple', 4, 2.4], ['mushroom_stew', 6, 7.2000003], ['bread', 5, 6], ['porkchop', 3, 1.8000001],
    ['cooked_porkchop', 8, 12.8], ['golden_apple', 4, 9.6], ['enchanted_golden_apple', 4, 9.6],
    ['pufferfish_bucket', 1, 0.2], ['salmon_bucket', 2, 0.4], ['cod_bucket', 2, 0.4], ['tropical_fish_bucket', 1, 0.2],
    ['cod', 2, 0.4], ['salmon', 2, 0.4], ['tropical_fish', 1, 0.2], ['pufferfish', 1, 0.2], ['cooked_cod', 5, 6],
    ['cooked_salmon', 6, 9.6], ['cookie', 2, 0.4], ['melon_slice', 2, 1.2], ['dried_kelp', 1, 0.6],
    ['beef', 3, 1.8000001], ['cooked_beef', 8, 12.8], ['chicken', 2, 1.2], ['cooked_chicken', 6, 7.2000003],
    ['rotten_flesh', 4, 0.8], ['spider_eye', 2, 3.2], ['carrot', 3, 3.6000001], ['potato', 1, 0.6],
    ['baked_potato', 5, 6], ['poisonous_potato', 2, 1.2], ['golden_carrot', 6, 14.400001], ['pumpkin_pie', 8, 4.8],
    ['rabbit', 3, 1.8000001], ['cooked_rabbit', 5, 6], ['rabbit_stew', 10, 12], ['mutton', 2, 1.2],
    ['cooked_mutton', 6, 9.6], ['chorus_fruit', 4, 2.4], ['beetroot', 1, 1.2], ['beetroot_soup', 6, 7.2000003],
    ['suspicious_stew', 6, 7.2000003], ['sweet_berries', 2, 0.4], ['glow_berries', 2, 0.4], ['honey_bottle', 6, 1.2],
].map(([name, foodPoints, saturation]) => [name, Object.freeze({ name, foodPoints, saturation })])));

/** Numbers of the hunger reflex (v0.1.4.8, C2). */
export const HUNGER_RULES = Object.freeze({
    eatAt: 14,                         // carries food: eats at this food level or lower ...
    eatHurtAt: 17,                     // ... or at this or lower while health is below 20
    fetchAt: 10,                       // carries none: fetches (idle) or says so at this or lower
    starvingAt: 3,                     // carries none: fetches even while busy, or says it starves
    hungryRepeatMs: 5 * 60 * 1000,     // the text of hunger at most once per 5 minutes
    starvingRepeatMs: 2 * 60 * 1000,   // the text of starving at most once per 2 minutes
    fetchRetryMs: 60 * 1000,           // after a fetch that brought no food, no fetch for this long
    fetchCount: 8,                     // how many of the chosen food a fetch takes
});

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
}

function foodEntry(foods, name) {
    if (!isPlainObject(foods) || typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(foods, name)) {
        return null;
    }
    const entry = foods[name];
    return isPlainObject(entry) && typeof entry.foodPoints === 'number' ? entry : null;
}

/**
 * True for a bucket (v0.1.4.14, part D): `cod_bucket`, `salmon_bucket`, `pufferfish_bucket` and `tropical_fish_bucket`
 * are listed as foods by minecraft-data 26.1, and none is food: a bucket is never eaten, whatever the banned list.
 * @param {string} name item name
 * @returns {boolean}
 */
export function isBucketName(name) {
    return typeof name === 'string' && name.endsWith('_bucket');
}

/**
 * True for food that the bot may eat. Never a bucket (v0.1.4.14, part D), also with an empty banned list.
 * @param {string} name item name
 * @param {object} foods bot.registry.foodsByName
 * @param {string[]} [banned]
 * @returns {boolean}
 */
export function isEdibleFood(name, foods, banned = BANNED_FOOD) {
    return foodEntry(foods, name) !== null && !isBucketName(name) && !(Array.isArray(banned) && banned.includes(name));
}

/**
 * The food in the inventory with the most food points that is not banned. Ties: more
 * saturation, then the name.
 * @param {{name: string, count?: number}[]} items bot.inventory.items()
 * @param {object} foods bot.registry.foodsByName
 * @param {string[]} [banned]
 * @returns {string|null} the item name
 */
export function chooseFood(items, foods, banned = BANNED_FOOD) {
    if (!Array.isArray(items)) {
        return null;
    }
    let best = null;
    for (const item of items) {
        if (!item || typeof item !== 'object' || (typeof item.count === 'number' && item.count <= 0)) {
            continue;
        }
        if (!isEdibleFood(item.name, foods, banned)) {
            continue;
        }
        const entry = foodEntry(foods, item.name);
        const saturation = typeof entry.saturation === 'number' ? entry.saturation : 0;
        if (!best || entry.foodPoints > best.points
            || (entry.foodPoints === best.points && (saturation > best.saturation
                || (saturation === best.saturation && item.name < best.name)))) {
            best = { name: item.name, points: entry.foodPoints, saturation };
        }
    }
    return best ? best.name : null;
}

/**
 * Options for the auto-eat plugin: the options it has now (its defaults), with
 * `priority: 'foodPoints'`, `startAt: 14`, `offhand: false` (v0.1.4.8, C1: the food stays in the main
 * hand) and the banned list of the home pack with the fish buckets (v0.1.4.14). Missing or invalid defaults are filled in, so
 * `eatingTimeout` is never lost. The input is not changed.
 * @param {object} current bot.autoEat.options
 * @returns {object} a new options object
 */
export function autoEatOptions(current) {
    const base = isPlainObject(current) ? current : {};
    const out = { ...AUTO_EAT_DEFAULTS, ...base };
    if (typeof out.eatingTimeout !== 'number' || !Number.isFinite(out.eatingTimeout) || out.eatingTimeout <= 0) {
        out.eatingTimeout = AUTO_EAT_DEFAULTS.eatingTimeout;
    }
    for (const key of ['ignoreInventoryCheck', 'checkOnItemPickup', 'equipOldItem']) {
        if (typeof out[key] !== 'boolean') {
            out[key] = AUTO_EAT_DEFAULTS[key];
        }
    }
    const extra = Array.isArray(base.bannedFood) ? base.bannedFood.filter(n => typeof n === 'string') : [];
    out.bannedFood = [...new Set([...BANNED_FOOD, ...FISH_BUCKETS, ...extra])]; // v0.1.4.14 (part D): never a bucket
    out.priority = 'foodPoints';
    out.startAt = 14;
    out.offhand = false;
    return out;
}

/**
 * The food level the bot eats up to (v0.1.4.8, C1): 18, and 20 while its health is below 20.
 * @param {number} health
 * @returns {number}
 */
export function eatTarget(health) {
    return isFiniteNumber(health) && health < FULL_HEALTH ? FULL_FOOD : EAT_UNTIL;
}

/**
 * True while the bot should eat on: the food level is below eatTarget(health) (and below 20).
 * @param {number} food
 * @param {number} health
 * @returns {boolean}
 */
export function wantsFood(food, health) {
    return isFiniteNumber(food) && food < FULL_FOOD && food < eatTarget(health);
}

/**
 * The food of the known chests (v0.1.4.8, I7): one entry per chest and kind that the bot may eat,
 * banned food left out. With `from`: the nearest chest first, within a chest the most food points
 * first. Without it: the largest count first.
 * @param {object[]} chests entries of the chest index, { x, y, z, items: { name: count } }
 * @param {{foods?: object, banned?: string[], from?: {x,y,z}}} [options] foods: bot.registry.foodsByName
 *   (VANILLA_FOODS without it)
 * @returns {{name: string, count: number, chest: {x: number, y: number, z: number}}[]}
 */
export function listKnownFood(chests, options = {}) {
    const o = isPlainObject(options) ? options : {};
    const foods = isPlainObject(o.foods) ? o.foods : VANILLA_FOODS;
    const banned = Array.isArray(o.banned) ? o.banned : BANNED_FOOD;
    const out = [];
    for (const chest of Array.isArray(chests) ? chests : []) {
        if (!isPoint(chest) || !isPlainObject(chest.items)) {
            continue;
        }
        for (const [name, count] of Object.entries(chest.items)) {
            if (isFiniteNumber(count) && count >= 1 && isEdibleFood(name, foods, banned)) {
                out.push({ name, count: Math.floor(count), chest: { x: chest.x, y: chest.y, z: chest.z } });
            }
        }
    }
    const points = k => foodEntry(foods, k.name)?.foodPoints ?? 0;
    const from = isPoint(o.from) ? o.from : null;
    const d = k => Math.hypot(k.chest.x + 0.5 - from.x, k.chest.y + 0.5 - from.y, k.chest.z + 0.5 - from.z);
    return out.sort((a, b) => {
        if (from) {
            const byDistance = d(a) - d(b);
            if (Math.abs(byDistance) > 1e-9) {
                return byDistance;
            }
            if (a.chest.x !== b.chest.x || a.chest.y !== b.chest.y || a.chest.z !== b.chest.z) {
                return a.chest.x - b.chest.x || a.chest.y - b.chest.y || a.chest.z - b.chest.z;
            }
            return points(b) - points(a) || b.count - a.count || (a.name < b.name ? -1 : 1);
        }
        return b.count - a.count || points(b) - points(a) || (a.name < b.name ? -1 : 1);
    });
}

/**
 * The kind of food a fetch takes from the known food: the most food points, then the largest
 * count of all chests together, then the name.
 * @param {{name: string, count: number}[]} known
 * @param {object} [foods] bot.registry.foodsByName (VANILLA_FOODS without it)
 * @returns {string|null}
 */
export function chooseKnownFood(known, foods) {
    const table = isPlainObject(foods) ? foods : VANILLA_FOODS;
    const totals = new Map();
    for (const k of Array.isArray(known) ? known : []) {
        if (k && typeof k.name === 'string' && isFiniteNumber(k.count) && k.count > 0 && !BANNED_FOOD.includes(k.name) && !isBucketName(k.name)) {
            totals.set(k.name, (totals.get(k.name) ?? 0) + k.count);
        }
    }
    let best = null;
    for (const [name, count] of totals) {
        const pts = foodEntry(table, name)?.foodPoints ?? 0;
        if (!best || pts > best.pts || (pts === best.pts && (count > best.count || (count === best.count && name < best.name)))) {
            best = { name, pts, count };
        }
    }
    return best ? best.name : null;
}

function saidAt(lastSaid, kind) {
    if (isFiniteNumber(lastSaid)) {
        return lastSaid;
    }
    return isPlainObject(lastSaid) && isFiniteNumber(lastSaid[kind]) ? lastSaid[kind] : null;
}

/**
 * What the hunger reflex does now (v0.1.4.8, C2). Rows of the spec, first match wins:
 * - carries food, and food <= 14, or food <= 17 and health < 20: `eat`;
 * - carries none, food <= 3, `known` not empty, idle or no order of the player runs: `fetch` (also busy);
 * - carries none, food <= 3, nothing known: `say` `I am starving. I have no food and know no chest
 *   with food.` at most once per 2 minutes;
 * - carries none, food <= 10, idle, `known` not empty: `fetch`;
 * - carries none, food <= 10, not idle or nothing known: `say` `I am hungry and carry no food. Food N
 *   of 20.` at most once per 5 minutes.
 * Otherwise, and for a text said too recently: `none`. A fetch that brought no food during the last
 * 60 s (`fetchFailedAt`) counts as "cannot fetch now": the text of hunger is said instead.
 * @param {{food: number, health: number, carries: boolean, known: object[], idle: boolean,
 *   playerOrder: boolean, lastSaid: number|{hungry?: number, starving?: number}|null, now: number,
 *   fetchFailedAt?: number|null}} input lastSaid: when each text was said last (a number counts for both)
 * @returns {{action: 'none'|'eat'|'fetch'|'say', text: string|null, reason: string, kind: string|null}}
 *   kind: 'hungry' or 'starving' for a text
 */
export function hungerDecision(input) {
    const i = isPlainObject(input) ? input : {};
    const result = (action, reason, text = null, kind = null) => ({ action, text, reason, kind });
    if (!isFiniteNumber(i.food)) {
        return result('none', 'no_food_level');
    }
    const food = i.food;
    const now = isFiniteNumber(i.now) ? i.now : 0;
    const hurt = isFiniteNumber(i.health) && i.health < FULL_HEALTH;
    if (i.carries === true) {
        if (food <= HUNGER_RULES.eatAt) {
            return result('eat', 'hungry');
        }
        if (food <= HUNGER_RULES.eatHurtAt && hurt) {
            return result('eat', 'hurt');
        }
        return result('none', 'fed');
    }
    if (food > HUNGER_RULES.fetchAt) {
        return result('none', 'fed');
    }
    const say = (kind, text, repeatMs) => {
        const at = saidAt(i.lastSaid, kind);
        if (at !== null && now - at < repeatMs) {
            return result('none', 'said_recently', null, kind);
        }
        return result('say', kind, text, kind);
    };
    const known = Array.isArray(i.known) && i.known.length > 0;
    const fetchFailed = isFiniteNumber(i.fetchFailedAt) && now - i.fetchFailedAt < HUNGER_RULES.fetchRetryMs;
    const canFetch = known && !fetchFailed;
    if (food <= HUNGER_RULES.starvingAt) {
        if (canFetch && (i.idle === true || i.playerOrder !== true)) {
            return result('fetch', 'starving');
        }
        if (!known) {
            return say('starving', TEXTS.starving, HUNGER_RULES.starvingRepeatMs);
        }
    }
    if (canFetch && i.idle === true) {
        return result('fetch', 'hungry');
    }
    return say('hungry', hungryText(food), HUNGER_RULES.hungryRepeatMs);
}
