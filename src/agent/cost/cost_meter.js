// Cost meter of one bot process: counts every model call in tokens and dollars, keeps the
// budget state (normal, warned, saving) and writes the session to bots/<name>/usage.json.
// Pure: time, settings, file path and the ways to speak are passed in.
//
// Money is summed as whole picodollars (1e-12 dollars), so totals show no rounding noise.
import { readJsonSafe, writeJsonAtomic } from '../../utils/safe_json.js';
import { priceFor, costOf } from './price_table.js';

const FILE_VERSION = 1;
const MAX_SESSIONS = 200;
const PICO_PER_DOLLAR = 1e12;
const PICO_PER_CENT = 1e10;
const MINUTE_MS = 60 * 1000;
const RATE_WINDOW_MS = 15 * MINUTE_MS;
const RATE_WINDOW_PER_HOUR = 4;
const RATE_MIN_AGE_MS = 5 * MINUTE_MS;
const WRITE_INTERVAL_MS = MINUTE_MS;
// Dropped window entries are compacted once this many have piled up at the front.
const WINDOW_COMPACT_AT = 1024;
// Dates beyond this are invalid for Date (ECMAScript time value range).
const MAX_TIME_MS = 8.64e15;

const NORMAL = 'normal';
const WARNED = 'warned';
const SAVING = 'saving';
const BY_HOUR = 'hour';
const BY_SESSION = 'session';
const RESTRICTED = new Set(['coding', 'skill_review', 'self_prompt']);

const warnText = (rate, warn) => `I am costing about $${rate} per hour. That is above the warning level of $${warn}.`;
const limitText = (reason) => `I reached the cost limit (${reason}). I stop working on goals by myself and writing new code. Chat and commands still work.`;
const BACK_TEXT = 'My cost is back below the limit. I can write code and work on goals again.';

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function tokenCount(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function nameOf(value, fallback) {
    if (typeof value !== 'string') {
        return fallback;
    }
    const clean = value.trim();
    return clean.length > 0 ? clean : fallback;
}

// Same order as Array.prototype.sort without a comparator.
function compareNames(a, b) {
    if (a < b) {
        return -1;
    }
    return a > b ? 1 : 0;
}

function centsText(cents) {
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(cents);
    return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Dollars with two decimals, halves rounded up, without the dollar sign: 1.005 gives '1.01',
 * 0.005 gives '0.01'. A value that is not a finite number gives '0.00'.
 * @param {number} value dollars
 * @returns {string}
 */
export function formatDollars(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return '0.00';
    }
    // 1.005 * 100 is 100.49999999999999 in floating point; 12 significant digits give 100.5
    return centsText(Math.round(Number((value * 100).toPrecision(12))));
}

// Exact for whole picodollars: 1005000000000 / 1e10 is exactly 100.5.
function formatPico(pico) {
    return centsText(Math.round(pico / PICO_PER_CENT));
}

// A configured limit as in the spec's example: '$3', '$10', but '$2.50'.
function formatLimit(dollars) {
    return Number.isInteger(dollars) ? String(dollars) : formatDollars(dollars);
}

function minutesBetween(fromMs, toMs) {
    return Math.max(0, Math.round((toMs - fromMs) / (MINUTE_MS / 10)) / 10);
}

function newBucket() {
    return { calls: 0, pico: 0, input_tokens: 0, output_tokens: 0 };
}

function addToBucket(map, key, usage, pico) {
    let bucket = map.get(key);
    if (bucket === undefined) {
        bucket = newBucket();
        map.set(key, bucket);
    }
    bucket.calls += 1;
    bucket.pico += pico;
    bucket.input_tokens += usage.input_tokens;
    bucket.output_tokens += usage.output_tokens;
}

// Plain objects built with fromEntries, so a key such as '__proto__' stays an own property.
function bucketsOut(map) {
    return Object.fromEntries([...map].map(([key, bucket]) => [key, {
        calls: bucket.calls,
        dollars: bucket.pico / PICO_PER_DOLLAR,
        input_tokens: bucket.input_tokens,
        output_tokens: bucket.output_tokens,
    }]));
}

function warn(text, err) {
    try {
        console.warn(err === undefined ? text : `${text}: ${err?.message ?? err}`);
    } catch {
        // nothing left to report to
    }
}

/**
 * Cost of the model calls of one session (one bot process) and its budget state.
 * record() and check() run on every model call: they are cheap and write no file except the
 * write of check() at most once per minute. flush() writes the session at the end.
 */
export class CostMeter {
    /**
     * @param {{settings?: object, now?: () => (number|Date), filePath?: string|null,
     *          say?: (text: string) => void, log?: (text: string) => void}} options
     *        settings: the bot settings, read live (cost_warn_per_hour, cost_limit_per_hour,
     *        cost_limit_per_session, model_prices). now: milliseconds or a Date, default
     *        Date.now. filePath: bots/<name>/usage.json, without it nothing is written.
     *        say tells the player in chat, log prints to the console; both optional.
     */
    constructor(options = {}) {
        const opts = isPlainObject(options) ? options : {};
        this._settings = opts.settings !== null && typeof opts.settings === 'object' ? opts.settings : {};
        this._now = typeof opts.now === 'function' ? opts.now : Date.now;
        this._filePath = typeof opts.filePath === 'string' && opts.filePath.length > 0 ? opts.filePath : null;
        this._say = typeof opts.say === 'function' ? opts.say : null;
        this._log = typeof opts.log === 'function' ? opts.log : null;

        this._startedMs = this._nowMs();
        this._calls = 0;
        this._unpricedCalls = 0;
        this._pico = 0;
        this._tokens = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 };
        this._byPurpose = new Map();
        this._byModel = new Map();

        this._firstCallMs = null;
        this._window = [];
        this._windowHead = 0;
        this._windowPico = 0;

        this._state = NORMAL;
        this._savingBy = null;

        this._dirty = false;
        this._lastWriteMs = null;
        this._history = null;
    }

    /** @returns {'normal'|'warned'|'saving'} the budget state */
    get state() {
        return this._state;
    }

    /**
     * Adds one report of the usage sink and applies the budget rules. Never throws, writes no
     * file. A report that is not an object is ignored.
     * @param {{model?: string, purpose?: string, input_tokens?: number, output_tokens?: number,
     *          cache_read_tokens?: number, cache_write_tokens?: number}} report
     */
    record(report) {
        try {
            if (report === null || typeof report !== 'object') {
                return;
            }
            const t = this._nowMs();
            const model = nameOf(report.model, 'unknown');
            const purpose = nameOf(report.purpose, 'other');
            const usage = {
                input_tokens: tokenCount(report.input_tokens),
                output_tokens: tokenCount(report.output_tokens),
                cache_read_tokens: tokenCount(report.cache_read_tokens),
                cache_write_tokens: tokenCount(report.cache_write_tokens),
            };
            const price = priceFor(model, this._modelPrices());
            const pico = price === null ? 0 : Math.round(costOf(usage, price) * PICO_PER_DOLLAR);

            this._calls += 1;
            if (price === null) {
                this._unpricedCalls += 1;
            }
            this._pico += pico;
            for (const key of Object.keys(this._tokens)) {
                this._tokens[key] += usage[key];
            }
            addToBucket(this._byPurpose, purpose, usage, pico);
            addToBucket(this._byModel, model, usage, pico);
            if (this._firstCallMs === null) {
                this._firstCallMs = t;
            }
            if (pico > 0) {
                this._window.push({ t, pico });
                this._windowPico += pico;
            }
            this._dirty = true;
            this._evaluate(t);
        } catch (err) {
            warn('Cost meter: a usage report could not be counted', err);
        }
    }

    /**
     * `{ calls, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, dollars,
     * unpriced_calls, by_purpose, by_model, started, minutes }`. `calls` and the token counts
     * include calls of models without a price, `dollars` leaves them out and `unpriced_calls`
     * counts them. by_purpose and by_model map a name to `{ calls, dollars, input_tokens,
     * output_tokens }`. `started` is an ISO time, `minutes` has one decimal.
     * @returns {object} a new object
     */
    totals() {
        return this._totalsAt(this._nowMs());
    }

    /**
     * Dollars of the last 15 minutes times 4. A call exactly 15 minutes old is out of the window.
     * @returns {number|null} null without calls and during the first 5 minutes after the first call
     */
    ratePerHour() {
        const rate = this._ratePico(this._nowMs());
        return rate === null ? null : rate / PICO_PER_DOLLAR;
    }

    /**
     * Applies the budget rules (spec C3), tells the player about a change, and writes the file
     * when calls came in and the last write is at least a minute ago. Never throws.
     * @returns {'normal'|'warned'|'saving'} the state
     */
    check() {
        try {
            const t = this._nowMs();
            this._evaluate(t);
            if (this._filePath !== null && this._dirty
                && (this._lastWriteMs === null || t - this._lastWriteMs >= WRITE_INTERVAL_MS)) {
                this._lastWriteMs = t;
                this._write(t);
            }
        } catch (err) {
            warn('Cost meter: the budget check failed', err);
        }
        return this._state;
    }

    /**
     * @param {string} what 'coding', 'skill_review' or 'self_prompt'
     * @returns {boolean} false for those three in the state saving, otherwise true
     *          ('chat', 'memory' and anything else are always allowed)
     */
    allows(what) {
        return !(this._state === SAVING && RESTRICTED.has(what));
    }

    /**
     * `Cost: session $1.23 (chat $0.90, memory $0.20, coding $0.13), rate $1.60 per hour, 182 calls.`
     * Purposes ordered by dollars (then calls, then name). Without a rate the rate part is left
     * out, without calls the parentheses. Unpriced calls add
     * ` 12 calls of models without a price are not included.`
     * @returns {string}
     */
    reportLine() {
        const t = this._nowMs();
        const purposes = [...this._byPurpose]
            .filter(([, bucket]) => bucket.calls > 0)
            .sort(([nameA, a], [nameB, b]) => (b.pico - a.pico) || (b.calls - a.calls) || compareNames(nameA, nameB));
        let line = `Cost: session $${formatPico(this._pico)}`;
        if (purposes.length > 0) {
            line += ` (${purposes.map(([name, bucket]) => `${name} $${formatPico(bucket.pico)}`).join(', ')})`;
        }
        line += ',';
        const rate = this._ratePico(t);
        if (rate !== null) {
            line += ` rate $${formatPico(rate)} per hour,`;
        }
        line += ` ${this._calls} calls.`;
        if (this._unpricedCalls > 0) {
            line += ` ${this._unpricedCalls} calls of models without a price are not included.`;
        }
        return line;
    }

    /**
     * For the command !cost: the report line and
     * `Budget: warn at $3 per hour, limit $8 per hour, limit $10 per session. State: normal.`
     * Limits that are 0 are left out; without any: `Budget: no limits set. State: normal.`
     * @returns {string} two lines
     */
    summaryText() {
        const limits = [];
        const warnLevel = this._limitDollars('cost_warn_per_hour');
        const limitHour = this._limitDollars('cost_limit_per_hour');
        const limitSession = this._limitDollars('cost_limit_per_session');
        if (warnLevel > 0) {
            limits.push(`warn at $${formatLimit(warnLevel)} per hour`);
        }
        if (limitHour > 0) {
            limits.push(`limit $${formatLimit(limitHour)} per hour`);
        }
        if (limitSession > 0) {
            limits.push(`limit $${formatLimit(limitSession)} per session`);
        }
        const budget = limits.length > 0 ? `Budget: ${limits.join(', ')}.` : 'Budget: no limits set.';
        return `${this.reportLine()}\n${budget} State: ${this._state}.`;
    }

    /**
     * Writes the session to the file: `{ version: 1, sessions: [...] }`, newest last, at most 200.
     * Synchronous, so it can run right before the process exits. A second flush replaces the
     * session. Never throws.
     * @returns {boolean} true when the file was written
     */
    flush() {
        try {
            if (this._filePath === null) {
                return false;
            }
            const t = this._nowMs();
            this._lastWriteMs = t;
            return this._write(t);
        } catch (err) {
            warn('Cost meter: the usage file could not be written', err);
            return false;
        }
    }

    _nowMs() {
        try {
            const value = this._now();
            const ms = value instanceof Date ? value.getTime() : value;
            if (typeof ms === 'number' && Number.isFinite(ms) && Math.abs(ms) <= MAX_TIME_MS) {
                return ms;
            }
        } catch {
            // a broken clock falls back to the real one
        }
        return Date.now();
    }

    _setting(key) {
        try {
            return this._settings[key];
        } catch {
            return undefined;
        }
    }

    _modelPrices() {
        const prices = this._setting('model_prices');
        return isPlainObject(prices) ? prices : {};
    }

    // A number limit: 0 is off; a value that is not finite or below 0 counts as the default 0.
    _limitDollars(key) {
        const value = this._setting(key);
        return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
    }

    _limitPico(key) {
        return Math.round(this._limitDollars(key) * PICO_PER_DOLLAR);
    }

    _ratePico(t) {
        if (this._firstCallMs === null || t - this._firstCallMs < RATE_MIN_AGE_MS) {
            return null;
        }
        const cutoff = t - RATE_WINDOW_MS;
        let head = this._windowHead;
        while (head < this._window.length && this._window[head].t <= cutoff) {
            this._windowPico -= this._window[head].pico;
            head += 1;
        }
        if (head >= WINDOW_COMPACT_AT && head * 2 >= this._window.length) {
            this._window = this._window.slice(head);
            head = 0;
        }
        this._windowHead = head;
        return this._windowPico * RATE_WINDOW_PER_HOUR;
    }

    // The budget rules of spec C3. All comparisons in whole picodollars.
    _evaluate(t) {
        if (this._state === SAVING && this._savingBy === BY_SESSION) {
            return;
        }
        const limitSession = this._limitPico('cost_limit_per_session');
        if (limitSession > 0 && this._pico >= limitSession) {
            const announce = this._state !== SAVING;
            this._state = SAVING;
            this._savingBy = BY_SESSION;
            if (announce) {
                this._announce(limitText(`$${formatPico(this._pico)} in this session`));
            }
            return;
        }
        const rate = this._ratePico(t);
        if (rate === null) {
            return;
        }
        const warnLevel = this._limitPico('cost_warn_per_hour');
        const limitHour = this._limitPico('cost_limit_per_hour');
        if (limitHour > 0 && rate >= limitHour) {
            if (this._state !== SAVING) {
                this._state = SAVING;
                this._savingBy = BY_HOUR;
                this._announce(limitText(`$${formatPico(rate)} per hour`));
            }
            return;
        }
        if (this._state === SAVING) {
            const level = warnLevel > 0 ? warnLevel : limitHour;
            if (level <= 0 || rate < level) {
                this._state = NORMAL;
                this._savingBy = null;
                this._announce(BACK_TEXT);
            }
            return;
        }
        if (this._state === NORMAL) {
            if (warnLevel > 0 && rate >= warnLevel) {
                this._state = WARNED;
                this._announce(warnText(formatPico(rate), formatPico(warnLevel)));
            }
            return;
        }
        // warned: back to normal below 80 percent of the warning level, silently
        if (warnLevel <= 0 || rate * 5 < warnLevel * 4) {
            this._state = NORMAL;
        }
    }

    _announce(text) {
        for (const [name, fn] of [['log', this._log], ['say', this._say]]) {
            if (fn === null) {
                continue;
            }
            try {
                fn(text);
            } catch (err) {
                warn(`Cost meter: ${name} failed`, err);
            }
        }
    }

    _totalsAt(t) {
        return {
            calls: this._calls,
            ...this._tokens,
            dollars: this._pico / PICO_PER_DOLLAR,
            unpriced_calls: this._unpricedCalls,
            by_purpose: bucketsOut(this._byPurpose),
            by_model: bucketsOut(this._byModel),
            started: new Date(this._startedMs).toISOString(),
            minutes: minutesBetween(this._startedMs, t),
        };
    }

    // Earlier sessions of the file, read once at the first write. null when the file exists
    // but cannot be read: then it is not overwritten, and the next write tries again.
    _loadHistory() {
        if (this._history !== null) {
            return this._history;
        }
        const result = readJsonSafe(this._filePath, { expect: 'object', now: () => new Date(this._nowMs()) });
        let sessions = [];
        if (result.status === 'ok') {
            if (Array.isArray(result.data.sessions)) {
                sessions = result.data.sessions.filter(isPlainObject);
            } else {
                warn(`Usage file ${this._filePath} has no "sessions" list, starting a new one.`);
            }
        } else if (result.status === 'corrupt') {
            const moved = result.quarantinedTo ? ` Corrupt file moved to ${result.quarantinedTo}.` : '';
            warn(`Usage file ${this._filePath} is corrupt (${result.error?.message}).${moved} Starting a new one.`);
        } else if (result.status === 'error') {
            warn(`Usage file ${this._filePath} could not be read (${result.error?.message}), it is not overwritten.`);
            return null;
        }
        this._history = sessions.slice(-(MAX_SESSIONS - 1));
        return this._history;
    }

    _write(t) {
        const history = this._loadHistory();
        if (history === null) {
            return false;
        }
        const totals = this._totalsAt(t);
        const session = {
            started: totals.started,
            ended: new Date(t).toISOString(),
            minutes: totals.minutes,
            calls: totals.calls,
            dollars: totals.dollars,
            unpriced_calls: totals.unpriced_calls,
            by_purpose: totals.by_purpose,
            by_model: totals.by_model,
        };
        try {
            writeJsonAtomic(this._filePath, { version: FILE_VERSION, sessions: [...history, session] });
        } catch (err) {
            warn(`Cost meter: could not write ${this._filePath}`, err);
            return false;
        }
        this._dirty = false;
        return true;
    }
}
