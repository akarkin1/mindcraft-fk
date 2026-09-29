// v0.1.4.8, F5: the guard against a command that fails the same way again and again. Setting
// repeat_guard: the Nth identical failure in a row is refused, 0 is off.
//
// Only failures count. When the same command with the same arguments failed with the same result
// text limit - 1 times in a row within the window, check() refuses the next try with a text for the
// model. A success ends the row, and so do a different command and an empty result (a stopped
// command). Commands that only read are never counted and do not end a row. The caller says
// whether a result is a failure; when it cannot (upstream commands return only a text),
// looksLikeFailure() decides, and in doubt it says no. Pure: the clock is passed in.

export const REPEAT_WINDOW_MS = 5 * 60 * 1000;
const MAX_RESULT = 200;

// Signs at the start of a sentence, built from the texts of skills.js, actions.js, the packs and
// the logs of the play test of v0.1.4.7. A sentence matches the first list that holds a sign.
const SUCCESS_SIGNS = [
    /^You have reached\b/,
    /^Successfully\b/,
    /^(Collected|Picked up|I picked up|I planted|I made|I took|I harvested|I stored|I mined|I ate|I cut|I crafted|I collected) [1-9]/,
    /^(Consumed|Equipped|Placed|Discarded|Moved away|Stayed for|Tilled|Planted|Teleported)\b/,
    /^I (slept|crafted|closed [a-z]|opened|went through)\b/,
    /^(Location|Area .*|Rule \d+) saved\b/,
    /^I (also )?saved\b/,
    /^\S+ received \S/,
    /^Agent stopped\b/,
];
const FAILURE_SIGNS = [
    /^(Could not|Couldn't|Cannot|Can't|Failed|Unable)\b/i,
    /^I (cannot|can't|could not|couldn't)\b/,
    /^I (have|carry|know|see|found) no\b/,
    /^I (have|found|ate|picked up) nothing\b/,
    /^(You do not have|You don't have|Don't have|You have no|You cannot)\b/,
    /^There is no\b/,
    /^It requires:/,
    /^(Error|The following error occurred|An error occurred)\b/,
    /^Invalid\b/,
    /^(Collected|Picked up|I took|I mined) 0\b/,
    /^I broke .* and got nothing\b/,
    /^(Pathfinding stopped|I stopped at \()/,
    /^No (more )?\S+ nearby to collect\b/,
    /^No \S+ to plant\b/,
    /^No (location|area|skill) named\b/,
    /^No (furnace nearby|villagers found)\b/,
    /^Crafting \S+ requires a crafting table\b/,
    /is either not an item/,
    /^Command .* (was given .* but requires|is incorrectly formatted)/,
    /^Command is incorrectly formatted\b/,
    /^\S+ is not a command\b/,
    /^Mode \S+ does not exist\b/,
    /^Only the player switches\b/,
    /^I reached my cost limit\b/,
];
// "I have no hoe, so I planted only where ..." explains a result; it is no failure.
const EXPLANATION = /, so (I|the)\b/;
// A label before the text of a pack: `Farm "farm": `.
const LABEL = /^\w+ "[^"]*":\s+/;

function verdictOf(sentence) {
    for (const text of LABEL.test(sentence) ? [sentence, sentence.replace(LABEL, '')] : [sentence]) {
        if (SUCCESS_SIGNS.some((sign) => sign.test(text)))
            return 'success';
        if (FAILURE_SIGNS.some((sign) => sign.test(text)))
            return EXPLANATION.test(text) ? null : 'failure';
    }
    return null;
}

/**
 * Whether a result text of a command reads as a failure. For the commands of upstream Mindcraft,
 * which return only a text. The text is cut into lines and sentences; the last sentence with a sign
 * of success or failure decides, as the output of an action ends with its outcome ("You have
 * reached X." and then "Failed to give bread to X, too close."). Without any sign: false.
 * @param {string} text
 * @returns {boolean} true only for a clear failure
 */
export function looksLikeFailure(text) {
    if (typeof text !== 'string')
        return false;
    let verdict = null;
    for (const line of text.split(/\r?\n/)) {
        for (const part of line.split(/(?<=[.!?])\s+/)) {
            const sentence = part.trim();
            if (sentence.length === 0)
                continue;
            verdict = verdictOf(sentence) ?? verdict;
        }
    }
    return verdict === 'failure';
}

/** Commands that only read: never counted, and they do not end a row. */
export const READ_ONLY_COMMANDS = Object.freeze([
    '!stats', '!inventory', '!chests', '!areas', '!rules', '!cost', '!nearbyBlocks', '!craftable',
    '!savedPlaces', '!skills', '!help',
]);
const READ_ONLY = new Set(READ_ONLY_COMMANDS);

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

function ordinal(n) {
    if (n >= 1 && n <= ORDINALS.length)
        return ORDINALS[n - 1];
    const tens = n % 100;
    const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] ?? 'th';
    return `${n}${suffix}`;
}

function commandName(name) {
    if (typeof name !== 'string')
        return null;
    const clean = name.trim();
    if (clean.length === 0)
        return null;
    return clean.startsWith('!') ? clean : `!${clean}`;
}

function argText(arg) {
    if (typeof arg === 'string')
        return JSON.stringify(arg);
    if (typeof arg === 'number' || typeof arg === 'boolean')
        return String(arg);
    if (arg === undefined)
        return 'undefined';
    try {
        return JSON.stringify(arg) ?? String(arg);
    } catch {
        return String(arg);
    }
}

/**
 * The command as the model writes it: `!consume("bread")`, `!mineOre("iron", 8)`, `!stop`.
 * @param {string} name with or without '!'
 * @param {Array|undefined} args
 * @returns {string}
 */
export function commandText(name, args) {
    const clean = commandName(name) ?? '!';
    const list = Array.isArray(args) ? args : (args === undefined || args === null ? [] : [args]);
    return list.length === 0 ? clean : `${clean}(${list.map(argText).join(', ')})`;
}

// The text of a result: a string, or the message of { message } / { text }. Whitespace is one space.
function resultText(result) {
    let text = result;
    if (result !== null && typeof result === 'object')
        text = typeof result.message === 'string' ? result.message : result.text;
    if (typeof text !== 'string')
        return null;
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > 0 ? clean : null;
}

// The decision of the caller, else the ok or success of an object result, else the text.
function isFailure(result, failed) {
    if (typeof failed === 'boolean')
        return failed;
    if (result !== null && typeof result === 'object') {
        for (const key of ['ok', 'success']) {
            if (typeof result[key] === 'boolean')
                return !result[key];
        }
        return looksLikeFailure(typeof result.message === 'string' ? result.message : result.text);
    }
    return looksLikeFailure(result);
}

function shortResult(text) {
    const short = text.length > MAX_RESULT ? `${text.slice(0, MAX_RESULT - 3).trimEnd()}...` : text;
    return /[.!?]$/.test(short) ? short : `${short}.`;
}

export class RepeatGuard {
    /**
     * @param {{limit?: number, windowMs?: number, now?: () => (number|Date)}} options
     *        limit: the setting repeat_guard; below 2 the guard is off (0 is off, and 1 would
     *        refuse every first try). windowMs: default 5 minutes. now: default Date.now.
     */
    constructor({ limit = 0, windowMs = REPEAT_WINDOW_MS, now = Date.now } = {}) {
        this.limit = typeof limit === 'number' && Number.isFinite(limit) && limit >= 2 ? Math.floor(limit) : 0;
        this.windowMs = typeof windowMs === 'number' && Number.isFinite(windowMs) && windowMs > 0 ? windowMs : REPEAT_WINDOW_MS;
        this._now = typeof now === 'function' ? now : Date.now;
        this._row = null; // { key, command, text, times: [ms] }
        this._refused = null; // { key, text } of the last refusal
    }

    /** @returns {boolean} false while the limit is below 2 */
    get enabled() {
        return this.limit >= 2;
    }

    _nowMs() {
        try {
            const value = this._now();
            const ms = value instanceof Date ? value.getTime() : value;
            if (typeof ms === 'number' && Number.isFinite(ms))
                return ms;
        } catch {
            // a broken clock falls back to the real one
        }
        return Date.now();
    }

    // The times of the row that are still within the window.
    _timesInWindow(t) {
        if (this._row === null)
            return 0;
        this._row.times = this._row.times.filter((at) => t - at < this.windowMs);
        return this._row.times.length;
    }

    /**
     * Before a command runs. Never throws.
     * @param {string} name the command, with or without '!'
     * @param {Array} args the arguments
     * @returns {string|null} the refusal text, or null when the command may run
     */
    check(name, args) {
        try {
            const clean = commandName(name);
            if (!this.enabled || clean === null || READ_ONLY.has(clean) || this._row === null)
                return null;
            const command = commandText(clean, args);
            if (this._row.key !== command)
                return null;
            const times = this._timesInWindow(this._nowMs());
            if (times < this.limit - 1)
                return null;
            const refusal = `I tried ${command} ${times} time${times === 1 ? '' : 's'} with the same result: ${shortResult(this._row.text)} `
                + `I do not try a ${ordinal(times + 1)} time. Ask the player what to do.`;
            this._refused = { key: command, text: refusal };
            return refusal;
        } catch {
            return null;
        }
    }

    /**
     * After a command ran. Never throws. A refused command need not be recorded; when its refusal
     * text is recorded, it is ignored.
     * @param {string} name the command, with or without '!'
     * @param {Array} args the arguments
     * @param {string|{message?: string, text?: string, ok?: boolean, success?: boolean}|undefined} result
     *        what the command returned
     * @param {boolean} [failed] true: a failure, false: a success, which ends the row. Not a
     *        boolean: the ok or success of an object result, else looksLikeFailure(text).
     */
    record(name, args, result, failed) {
        try {
            const clean = commandName(name);
            if (clean === null || READ_ONLY.has(clean))
                return;
            const command = commandText(clean, args);
            const text = resultText(result);
            if (this._refused !== null && this._refused.key === command && this._refused.text === text)
                return;
            this._refused = null;
            if (text === null || !isFailure(result, failed)) {
                this._row = null;
                return;
            }
            const t = this._nowMs();
            if (this._row !== null && this._row.key === command && this._row.text === text) {
                this._timesInWindow(t);
                this._row.times.push(t);
                return;
            }
            this._row = { key: command, text, times: [t] };
        } catch {
            // the guard must never break a command
        }
    }

    /** Forgets the row, for example when the player gives a new order. */
    reset() {
        this._row = null;
        this._refused = null;
    }
}
