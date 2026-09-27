// Loads the active skills of a SkillStore into one sandbox compartment and
// returns them as the frozen object `customSkills`. What the loader needs from
// the sandbox and the store is passed in; no side effects at import.

function isObject(value) {
    return value !== null && typeof value === 'object';
}

// Same order as Array.prototype.sort without a comparator.
function compareNames(a, b) {
    if (a < b) {
        return -1;
    }
    return a > b ? 1 : 0;
}

function errorText(error) {
    try {
        return String(error);
    } catch {
        return '[unprintable error]';
    }
}

function warningText(error) {
    try {
        return error?.message ?? String(error);
    } catch {
        return '[unprintable error]';
    }
}

function isInterrupted(bot) {
    try {
        return Boolean(isObject(bot) && bot.interrupt_code);
    } catch {
        return false;
    }
}

// Calls onUse and swallows everything it throws, also a rejected promise.
function reportUse(onUse, name, outcome) {
    if (typeof onUse !== 'function') {
        return;
    }
    try {
        const result = onUse(name, outcome);
        if (result && typeof result.then === 'function') {
            result.then(undefined, () => {});
        }
    } catch {
        // an error inside onUse is swallowed
    }
}

// An async function with the name of the skill that calls fn and reports the use.
function wrapSkill(name, fn, onUse) {
    const holder = {
        async [name](...args) {
            let result;
            try {
                result = await fn(...args);
            } catch (error) {
                if (!isInterrupted(args[0])) {
                    reportUse(onUse, name, { ok: false, error: errorText(error) });
                }
                throw error;
            }
            if (!isInterrupted(args[0])) {
                reportUse(onUse, name, { ok: result !== false });
            }
            return result;
        },
    };
    return Object.freeze(holder[name]);
}

function emptyResult() {
    return { customSkills: Object.freeze({}), loaded: [], skipped: [] };
}

const NOT_A_SINGLE_FUNCTION = 'not a single function';
const LIBRARY_CHANGED = 'the skill library was changed while loading';

// Rejects a text before it is evaluated when the check says no, throws or answers anything but true.
function passesCheck(check, name, text) {
    if (typeof check !== 'function') {
        return true;
    }
    try {
        return check(name, text) === true;
    } catch {
        return false;
    }
}

// Whether code that ran while loading changed the library: an own member (also a symbol or a
// member that is not enumerable), not extensible any more, another prototype, or the binding
// `customSkills` of the compartment is no longer a plain value that is the library (replaced,
// deleted or turned into a getter). A compartment without globalThis is not checked for that.
function libraryChanged(lib, compartment) {
    try {
        if (Reflect.ownKeys(lib).length > 0 || !Object.isExtensible(lib) || Object.getPrototypeOf(lib) !== Object.prototype) {
            return true;
        }
        const global = compartment?.globalThis;
        if (!isObject(global)) {
            return false;
        }
        const binding = Object.getOwnPropertyDescriptor(global, 'customSkills');
        return !binding || !('value' in binding) || binding.value !== lib;
    } catch {
        return true;
    }
}

/**
 * Evaluates every active skill of the store in one compartment made with
 * makeCompartment({ ...endowments, customSkills }), so skills can call each
 * other through customSkills.<other>. Each skill is put into customSkills as a
 * wrapper with the name of the skill: it calls the skill, returns its result and
 * then calls onUse(name, { ok }) (ok is false when the result is exactly false)
 * or, when the skill throws, onUse(name, { ok: false, error: String(error) })
 * before the error is thrown on. Nothing is recorded when the first argument has
 * a truthy interrupt_code. Errors inside onUse are swallowed.
 * A skill that does not evaluate to a function with its own name is skipped.
 *
 * Loading runs no code (Amendment 2, B2): with the option `check`, a text that the
 * check does not accept (after instrument) is skipped with 'not a single function'
 * before it is evaluated. All skills are evaluated first and kept in a private map;
 * if code that ran meanwhile changed customSkills, the loader gives up with a warning:
 * a new frozen empty customSkills, loaded [], every active skill skipped with
 * 'the skill library was changed while loading'. Otherwise the wrappers are added
 * and customSkills is frozen. A name is in loaded or in skipped, never in both.
 * Never throws.
 * @param {{store: object, makeCompartment: function(object): object, endowments: object, instrument: function(string): string,
 *     onUse: function(string, {ok: boolean, error?: string}): void, check?: function(string, string): boolean}} options
 * @returns {{customSkills: Object<string, function>, loaded: string[], skipped: {name: string, error: string}[]}}
 *     loaded is the sorted list of names in customSkills, skipped the skills that could not be loaded.
 */
export function loadSkills(options) {
    let store, makeCompartment, endowments, instrument, onUse, check;
    let entries;
    try {
        ({ store, makeCompartment, endowments, instrument, onUse, check } = isObject(options) ? options : {});
        const list = store.list();
        entries = Array.isArray(list) ? list : [];
    } catch (err) {
        console.warn('Could not list the saved skills:', warningText(err));
        return emptyResult();
    }
    const lib = {};
    const skipped = [];
    const active = []; // names of the active skills, each once, in list order
    const functions = new Map();
    let compartment = null;
    let compartmentError = null;
    try {
        compartment = makeCompartment({ ...(isObject(endowments) ? endowments : {}), customSkills: lib });
    } catch (err) {
        compartmentError = err;
    }
    const prepare = typeof instrument === 'function' ? instrument : (source) => source;
    for (const entry of entries) {
        let name;
        try {
            if (!isObject(entry) || entry.status !== 'active') {
                continue;
            }
            name = entry.name;
            if (typeof name !== 'string' || name === '' || active.includes(name)) {
                continue; // a name listed twice is handled once
            }
            active.push(name);
            if (compartment === null) {
                throw compartmentError ?? new Error('no compartment');
            }
            const source = store.read(name);
            if (typeof source !== 'string') {
                throw new Error(`the source of the skill "${name}" is missing`);
            }
            const text = prepare(source);
            if (!passesCheck(check, name, text)) {
                skipped.push({ name, error: NOT_A_SINGLE_FUNCTION });
                continue;
            }
            const fn = compartment.evaluate('(' + text + ')');
            if (typeof fn !== 'function' || fn.name !== name) {
                throw new Error(`the source does not evaluate to a function named ${name}`);
            }
            functions.set(name, fn);
        } catch (err) {
            if (typeof name === 'string') {
                skipped.push({ name, error: errorText(err) });
            }
        }
    }
    if (libraryChanged(lib, compartment)) {
        console.warn(`Saved skills were not loaded: ${LIBRARY_CHANGED}.`);
        return { customSkills: Object.freeze({}), loaded: [], skipped: active.map(name => ({ name, error: LIBRARY_CHANGED })) };
    }
    for (const [name, fn] of functions) {
        Object.defineProperty(lib, name, {
            value: wrapSkill(name, fn, onUse),
            enumerable: true,
            writable: true,
            configurable: true,
        });
    }
    Object.freeze(lib);
    return { customSkills: lib, loaded: Object.keys(lib).sort(compareNames), skipped };
}
