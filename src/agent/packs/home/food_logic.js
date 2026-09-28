// Food choices of the home pack (spec v0.1.4.6 H4), pure.

/** Food the bot never eats by itself. */
export const BANNED_FOOD = Object.freeze(['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'chicken',
    'golden_apple', 'enchanted_golden_apple', 'chorus_fruit', 'suspicious_stew']);

/** The food level of a full bot. */
export const FULL_FOOD = 20;
/** The bot eats until the food level is at least this. */
export const EAT_UNTIL = 18;

/** The defaults of mineflayer-auto-eat 3.3.6, used when the bot has no options object. */
export const AUTO_EAT_DEFAULTS = Object.freeze({
    priority: 'saturation',
    startAt: 16,
    eatingTimeout: 3000,
    bannedFood: Object.freeze(['pufferfish', 'spider_eye', 'poisonous_potato', 'rotten_flesh', 'chorus_fruit', 'chicken',
        'suspicious_stew', 'golden_apple']),
    ignoreInventoryCheck: false,
    checkOnItemPickup: true,
    offhand: true,
    equipOldItem: true,
});

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function foodEntry(foods, name) {
    if (!isPlainObject(foods) || typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(foods, name)) {
        return null;
    }
    const entry = foods[name];
    return isPlainObject(entry) && typeof entry.foodPoints === 'number' ? entry : null;
}

/**
 * True for food that the bot may eat.
 * @param {string} name item name
 * @param {object} foods bot.registry.foodsByName
 * @param {string[]} [banned]
 * @returns {boolean}
 */
export function isEdibleFood(name, foods, banned = BANNED_FOOD) {
    return foodEntry(foods, name) !== null && !banned.includes(name);
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
 * `priority: 'foodPoints'`, `startAt: 14` and the banned list of the home pack. Missing or
 * invalid defaults are filled in, so `eatingTimeout` is never lost. The input is not changed.
 * @param {object} current bot.autoEat.options
 * @returns {object} a new options object
 */
export function autoEatOptions(current) {
    const base = isPlainObject(current) ? current : {};
    const out = { ...AUTO_EAT_DEFAULTS, ...base };
    if (typeof out.eatingTimeout !== 'number' || !Number.isFinite(out.eatingTimeout) || out.eatingTimeout <= 0) {
        out.eatingTimeout = AUTO_EAT_DEFAULTS.eatingTimeout;
    }
    for (const key of ['ignoreInventoryCheck', 'checkOnItemPickup', 'offhand', 'equipOldItem']) {
        if (typeof out[key] !== 'boolean') {
            out[key] = AUTO_EAT_DEFAULTS[key];
        }
    }
    const extra = Array.isArray(base.bannedFood) ? base.bannedFood.filter(n => typeof n === 'string') : [];
    out.bannedFood = [...new Set([...BANNED_FOOD, ...extra])];
    out.priority = 'foodPoints';
    out.startAt = 14;
    return out;
}
