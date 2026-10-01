// v0.1.4.8, F4: the time of day, [HH:MM:SS] in local time, before every line that console.log,
// console.warn and console.error print. Setting log_timestamps.
//
// The three methods are wrapped once per console object. A later call only switches the stamps on
// or off and sets the clock, so it is safe to call twice. While the stamps are off, or before the
// first call with enabled true, the output is exactly that of the original method.
//
// v0.1.4.9 (the owner's Luna session): the arguments are formatted with util.format, as console does, and the
// stamp goes before the one line that results: an Error shows its message and stack, an object its fields.
// console.trace is wrapped as well: under the SES lockdown of the agent process its own message holder (a plain
// object) printed "[object Object]" 15,000 times for the deprecation warning of prismarine-entity; the wrapper makes
// the message with a real Error and prints its stack through the stamped console.error.
import { format } from 'node:util';

const METHODS = ['log', 'warn', 'error'];
const states = new WeakMap(); // console object -> { enabled, now }

function two(n) {
    return String(n).padStart(2, '0');
}

/**
 * @param {Date|number} value a Date or milliseconds
 * @returns {string} '[HH:MM:SS]' in local time, '[--:--:--]' for a value that is not a time
 */
export function timeStamp(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime()))
        return '[--:--:--]';
    return `[${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}]`;
}

function stampOf(state) {
    try {
        return timeStamp(state.now());
    } catch {
        return timeStamp(new Date());
    }
}

/**
 * Puts the time before each line of console.log, console.warn and console.error (and of console.trace, which
 * prints through console.error). The arguments are formatted with util.format as console does (format
 * strings such as '%s: %d' keep working, an Error shows its stack, an object its fields), and the stamp goes
 * before the one line. Never throws.
 * @param {boolean} enabled false: no stamps (a console that was never wrapped stays untouched)
 * @param {() => (Date|number)} now the clock, default the current time
 * @param {object} target the console object, for tests; default the global console
 * @returns {boolean} true when the stamps are on
 */
export function installLogTime(enabled, now = () => new Date(), target = console) {
    try {
        if (target === null || typeof target !== 'object')
            return false;
        const clock = typeof now === 'function' ? now : () => new Date();
        let state = states.get(target);
        if (!state) {
            if (!enabled)
                return false;
            state = { enabled: true, now: clock };
            states.set(target, state);
            for (const method of METHODS) {
                const original = target[method];
                if (typeof original !== 'function')
                    continue;
                target[method] = function stamped(...args) {
                    if (!state.enabled)
                        return original.apply(this, args);
                    const stamp = stampOf(state);
                    if (args.length === 0)
                        return original.call(this, stamp);
                    let line;
                    try {
                        line = format(...args);
                    } catch {
                        line = args.map(String).join(' ');
                    }
                    return original.call(this, `${stamp} ${line}`);
                };
            }
            const trace = target.trace;
            if (typeof trace === 'function') {
                target.trace = function stampedTrace(...args) {
                    if (!state.enabled || typeof target.error !== 'function')
                        return trace.apply(this, args);
                    try {
                        const err = new Error(format(...args));
                        err.name = 'Trace';
                        if (typeof Error.captureStackTrace === 'function')
                            Error.captureStackTrace(err, stampedTrace);
                        return target.error(typeof err.stack === 'string' ? err.stack : `Trace: ${err.message}`);
                    } catch {
                        return trace.apply(this, args);
                    }
                };
            }
            return true;
        }
        state.enabled = Boolean(enabled);
        state.now = clock;
        return state.enabled;
    } catch {
        return false;
    }
}
