// Prices of language models in dollars per million tokens, and the cost of one usage report.
// Pure: imports nothing.

/**
 * Dollars per million tokens. Cache prices are derived from the input price (see priceFor).
 * Frozen, also its entries.
 */
export const DEFAULT_PRICES = Object.freeze({
    'claude-haiku-4-5': Object.freeze({ input: 1, output: 5 }),
    'claude-sonnet-5': Object.freeze({ input: 2, output: 10 }),
    'claude-opus-5': Object.freeze({ input: 5, output: 25 }),
    'claude-opus-5-5': Object.freeze({ input: 4, output: 20 }),
});

const CACHE_READ_FACTOR = 0.1;
const CACHE_WRITE_FACTOR = 1.25;
// Costs are summed as whole picodollars (1e-12 dollars) so that sums show no rounding noise.
const PICO_PER_DOLLAR = 1e12;
// A price per million tokens in dollars equals the price per token in picodollars times 1e-6.
const PICO_PER_TOKEN_PER_PRICE = 1e6;

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPrice(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function tokenCount(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

// 0.1 * 3 is 0.30000000000000004 in floating point; 12 significant digits drop the noise.
function clean(value) {
    return Number(value.toPrecision(12));
}

// An entry needs valid input and output prices. A missing or invalid cache price is derived.
function isValidEntry(entry) {
    return isPlainObject(entry) && isPrice(entry.input) && isPrice(entry.output);
}

// The valid entry whose key is the model id or the longest key the model id starts with.
function lookup(table, model) {
    if (!isPlainObject(table)) {
        return null;
    }
    let bestKey = null;
    for (const key of Object.keys(table)) {
        if (key.length === 0 || !model.startsWith(key)) {
            continue;
        }
        if (bestKey !== null && key.length <= bestKey.length) {
            continue;
        }
        if (isValidEntry(table[key])) {
            bestKey = key;
        }
    }
    return bestKey === null ? null : table[bestKey];
}

function completePrice(entry) {
    const input = isPrice(entry.input) ? entry.input : 0;
    return {
        input,
        output: isPrice(entry.output) ? entry.output : 0,
        cache_read: isPrice(entry.cache_read) ? entry.cache_read : clean(input * CACHE_READ_FACTOR),
        cache_write: isPrice(entry.cache_write) ? entry.cache_write : clean(input * CACHE_WRITE_FACTOR),
    };
}

/**
 * The price of a model: the entry whose key is the model id, or else the longest key that the
 * model id starts with, so 'claude-haiku-4-5-20251001' finds 'claude-haiku-4-5'. A match in
 * `overrides` (settings.model_prices) comes before any default entry. Invalid entries are
 * skipped. `cache_read` is 0.1 times input and `cache_write` 1.25 times input unless the entry
 * gives them.
 * @param {string} model
 * @param {Object<string, {input: number, output: number, cache_read?: number, cache_write?: number}>} overrides
 * @returns {{input: number, output: number, cache_read: number, cache_write: number}|null}
 *          a new object, or null for a model without a price
 */
export function priceFor(model, overrides = {}) {
    if (typeof model !== 'string' || model.length === 0) {
        return null;
    }
    const entry = lookup(overrides, model) ?? lookup(DEFAULT_PRICES, model);
    return entry === null ? null : completePrice(entry);
}

/**
 * Cost of one usage report in picodollars, a whole number when the token counts are whole.
 * @param {object} usage
 * @param {object} price a result of priceFor
 * @returns {number}
 */
function picoCostOf(usage, price) {
    const source = isPlainObject(usage) ? usage : {};
    const full = completePrice(price);
    const perToken = (dollarsPerMillion) => Math.round(dollarsPerMillion * PICO_PER_TOKEN_PER_PRICE);
    return Math.round(
        tokenCount(source.input_tokens) * perToken(full.input)
        + tokenCount(source.output_tokens) * perToken(full.output)
        + tokenCount(source.cache_read_tokens) * perToken(full.cache_read)
        + tokenCount(source.cache_write_tokens) * perToken(full.cache_write),
    );
}

/**
 * Dollars for one usage report `{ input_tokens, output_tokens, cache_read_tokens,
 * cache_write_tokens }`; missing or invalid counts are 0. Without rounding noise:
 * 5000 input tokens at 1 dollar per million are exactly 0.005.
 * @param {object} usage
 * @param {{input: number, output: number, cache_read?: number, cache_write?: number}|null} price
 * @returns {number|null} null when the price is null
 */
export function costOf(usage, price) {
    if (!isPlainObject(price)) {
        return null;
    }
    return picoCostOf(usage, price) / PICO_PER_DOLLAR;
}
