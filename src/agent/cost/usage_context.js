// Purpose of the running model call and the hand-off of usage reports to one sink per process.
// Pure: the model adapters report here, the agent installs the sink (a CostMeter).
import { AsyncLocalStorage } from 'node:async_hooks';

/** The purposes the prompter uses. Any other non-empty string is kept as it is. */
export const PURPOSES = Object.freeze([
    'chat', 'coding', 'memory', 'skill_review', 'bot_responder', 'vision', 'goal_setting', 'other',
]);

const OTHER = 'other';
const UNKNOWN_MODEL = 'unknown';

const storage = new AsyncLocalStorage();
let sink = null;

function normalisePurpose(purpose) {
    if (typeof purpose !== 'string') {
        return OTHER;
    }
    const clean = purpose.trim();
    return clean.length > 0 ? clean : OTHER;
}

function tokenCount(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function warnSinkFailure(err) {
    try {
        console.warn(`Cost meter: the usage sink failed: ${err?.message ?? err}`);
    } catch {
        // nothing left to report to
    }
}

/**
 * Runs `fn` with the purpose set for everything it awaits, including timers and promise chains
 * it starts. A purpose that is not a non-empty string counts as 'other'.
 * @template T
 * @param {string} purpose one of PURPOSES
 * @param {() => T} fn
 * @returns {T} what fn returns; a throw of fn reaches the caller
 */
export function withPurpose(purpose, fn) {
    return storage.run(normalisePurpose(purpose), fn);
}

/** @returns {string} the purpose of the running withPurpose, or 'other' outside of one */
export function currentPurpose() {
    return storage.getStore() ?? OTHER;
}

/**
 * Sets the function that receives every report. One sink per process: a new one replaces the
 * old one. `null`, or any value that is not a function, removes it.
 * @param {((report: object) => void)|null} fn
 */
export function setUsageSink(fn) {
    sink = typeof fn === 'function' ? fn : null;
}

/**
 * Called by a model adapter after a successful request. Hands
 * `{ model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, purpose, time }`
 * to the sink. Missing or invalid counts are 0, a missing model is 'unknown', `time` is
 * Date.now(). Without a sink nothing happens. Never throws, also when the sink throws or
 * returns a rejected promise.
 * @param {{model?: string, input_tokens?: number, output_tokens?: number,
 *          cache_read_tokens?: number, cache_write_tokens?: number}} usage
 */
export function reportUsage(usage) {
    const target = sink;
    if (target === null) {
        return;
    }
    try {
        const source = usage !== null && typeof usage === 'object' ? usage : {};
        const model = typeof source.model === 'string' && source.model.length > 0 ? source.model : UNKNOWN_MODEL;
        const result = target({
            model,
            input_tokens: tokenCount(source.input_tokens),
            output_tokens: tokenCount(source.output_tokens),
            cache_read_tokens: tokenCount(source.cache_read_tokens),
            cache_write_tokens: tokenCount(source.cache_write_tokens),
            purpose: currentPurpose(),
            time: Date.now(),
        });
        if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
            result.then(undefined, warnSinkFailure);
        }
    } catch (err) {
        warnSinkFailure(err);
    }
}
