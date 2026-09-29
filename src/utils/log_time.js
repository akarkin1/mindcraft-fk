// v0.1.4.8, F4: the time of day, [HH:MM:SS] in local time, before every line that console.log,
// console.warn and console.error print. Setting log_timestamps.
//
// The three methods are wrapped once per console object. A later call only switches the stamps on
// or off and sets the clock, so it is safe to call twice. While the stamps are off, or before the
// first call with enabled true, the output is exactly that of the original method.

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
 * Puts the time before each line of console.log, console.warn and console.error.
 * The stamp goes into the first argument when that is a string, so format strings such as
 * '%s: %d' keep working; otherwise it is an argument of its own. Never throws.
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
                    if (typeof args[0] === 'string')
                        return original.call(this, `${stamp} ${args[0]}`, ...args.slice(1));
                    return original.call(this, stamp, ...args);
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
