// Validity rules for the settings of the fork's settings.js that the owner edits for play tests
// (world_memory, skill_learning, blocked_actions, ...). settings.js is the owner's live
// configuration, so unit tests must not assert its VALUES: they check that each key exists and
// holds a valid value of the right type, whatever the owner chose.
//
// The settings test files (settings_persistence, settings_skills, settings_spec) and
// settings_owner_values.test.js share these rules. The latter runs them on copies of the settings
// with every toggle flipped and other valid values, so what it proves holds for the former too.
//
//   OWNER_SETTING_RULES                        key -> { type, text, valid(value) }
//   settingProblems(settings, keys?)           [] or one text per missing or invalid key
//   assertValidSetting(settings, key)          assert form of settingProblems for one key
//   skillFlagsProblems(skillFlags, settings)   the result of skillFlags(settings) is consistent
//   skillLimitsProblems(skillLimits, settings) the result of skillLimits(settings) is valid
import assert from 'node:assert/strict';

export const RESUME_GOAL_VALUES = Object.freeze(['always', 'after_crash', 'never']);
const COMMAND_NAME = /^!\w+$/;

const isBoolean = (value) => typeof value === 'boolean';
const isString = (value) => typeof value === 'string';
// Number.isInteger is false for NaN, Infinity, fractions and anything that is not a number.
const isWholeNumber = (value) => Number.isInteger(value) && value >= 0;
const isCommandList = (value) => Array.isArray(value) && value.every((name) => typeof name === 'string' && COMMAND_NAME.test(name));

const BOOLEAN = Object.freeze({ type: 'boolean', text: 'a boolean', valid: isBoolean });
const STRING = Object.freeze({ type: 'string', text: 'a string', valid: isString });
const WHOLE_NUMBER = Object.freeze({ type: 'number', text: 'a whole number of 0 or more', valid: isWholeNumber });

// v0.1.4.6: numbers that may have a fraction (dollars, minutes) and the two object settings.
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNumberZeroOrMore = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const PRICE_KEYS = ['input', 'output', 'cache_read', 'cache_write'];
// { "<model id>": { input, output, cache_read?, cache_write? } }, dollars per million tokens
const isPriceTable = (value) => isPlainObject(value) && Object.values(value).every((price) => isPlainObject(price)
    && Object.keys(price).length > 0 && Object.entries(price).every(([key, dollars]) => PRICE_KEYS.includes(key) && isNumberZeroOrMore(dollars)));
// v0.1.4.8 (spec section 2): home_reflexes.hunger
export const HOME_REFLEXES = Object.freeze(['door_closing', 'night_shelter', 'creeper_safety', 'hunger']);
// a missing reflex counts as true
const isReflexTable = (value) => isPlainObject(value) && Object.entries(value).every(([key, on]) => HOME_REFLEXES.includes(key) && isBoolean(on));

const NUMBER = Object.freeze({ type: 'number', text: 'a finite number of 0 or more', valid: isNumberZeroOrMore });

// v0.1.4.7: minutes that must be more than 0, and { "<item name>": <whole number of 0 or more, or -1 for all> }
const isNumberAboveZero = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const isKeepTable = (value) => isPlainObject(value) && Object.entries(value).every(([name, count]) => name.trim() !== '' && Number.isInteger(count) && count >= -1);

// `type` is the type of the key's entry in src/mindcraft/public/settings_spec.json.
export const OWNER_SETTING_RULES = Object.freeze({
    // v0.1.4.3, persistence
    load_memory: BOOLEAN,
    world_memory: BOOLEAN,
    world_id: STRING,
    resume_goal: Object.freeze({ type: 'string', text: `one of ${RESUME_GOAL_VALUES.map((v) => `"${v}"`).join(', ')}`, valid: (value) => RESUME_GOAL_VALUES.includes(value) }),
    goal_resume_limit: WHOLE_NUMBER,
    init_message: STRING,
    // v0.1.4.2, sandbox
    allow_insecure_coding: BOOLEAN,
    sandbox_lockdown: BOOLEAN,
    // v0.1.4.4, skills
    skill_learning: BOOLEAN,
    skill_capture: BOOLEAN,
    skill_reuse: BOOLEAN,
    skill_command: BOOLEAN,
    // v0.1.4.5, guardrails
    skill_max_count: WHOLE_NUMBER,
    skill_disable_after_errors: WHOLE_NUMBER,
    // v0.1.4.6, cost control, home and safety
    cost_meter: BOOLEAN,
    cost_report_minutes: NUMBER,
    cost_warn_per_hour: NUMBER,
    cost_limit_per_hour: NUMBER,
    cost_limit_per_session: NUMBER,
    model_prices: Object.freeze({ type: 'object', text: 'an object of model ids, each with dollars per million tokens as { "input": 1, "output": 5 }', valid: isPriceTable }),
    max_command_result_chars: WHOLE_NUMBER,
    protected_areas: BOOLEAN,
    player_rules: BOOLEAN,
    rules_max: WHOLE_NUMBER,
    home_pack: BOOLEAN,
    home_reflexes: Object.freeze({ type: 'object', text: `an object with the booleans ${HOME_REFLEXES.join(', ')}`, valid: isReflexTable }),
    creeper_fighting: BOOLEAN,
    // v0.1.4.7, work skills
    storage_pack: BOOLEAN,
    farming_pack: BOOLEAN,
    wood_pack: BOOLEAN,
    mining_pack: BOOLEAN,
    mining_max_minutes: Object.freeze({ type: 'number', text: 'a finite number greater than 0', valid: isNumberAboveZero }),
    keep_items: Object.freeze({ type: 'object', text: 'an object of item names, each with a whole number to keep or -1 for all, as { "wheat_seeds": 32 }', valid: isKeepTable }),
    // commands the owner blocks, for example "!restart"
    blocked_actions: Object.freeze({ type: 'array', text: 'an array of command names that each start with "!", like "!restart"', valid: isCommandList }),
});

function show(value) {
    if (value === undefined) {
        return 'undefined';
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
        return String(value);
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/**
 * The problems of the given keys of a settings object: '<key> is missing' or
 * '<key> must be <what>, found <value>'. [] when every key exists and is valid.
 * @param {object} settings
 * @param {string[]} keys keys of OWNER_SETTING_RULES, all of them when omitted
 * @returns {string[]}
 */
export function settingProblems(settings, keys = Object.keys(OWNER_SETTING_RULES)) {
    const problems = [];
    for (const key of keys) {
        const rule = OWNER_SETTING_RULES[key];
        if (!rule) {
            throw new Error(`no rule for the setting ${key} in tests/helpers/owner_settings.js`);
        }
        if (settings === null || typeof settings !== 'object' || !Object.hasOwn(settings, key)) {
            problems.push(`${key} is missing`);
        } else if (!rule.valid(settings[key])) {
            problems.push(`${key} must be ${rule.text}, found ${show(settings[key])}`);
        }
    }
    return problems;
}

/** Asserts that one key of the settings exists and holds a valid value. */
export function assertValidSetting(settings, key) {
    assert.deepEqual(settingProblems(settings, [key]), [], `${key} of settings.js`);
}

const FLAG_KEYS = ['capture', 'reuse', 'command'];

/**
 * What stays true of skillFlags(settings) whatever the owner chose: an object with the three
 * booleans capture, reuse and command; all false when skill_learning or allow_insecure_coding
 * is falsy; otherwise capture is skill_capture !== false, reuse is skill_reuse !== false and
 * command is reuse && skill_command === true (spec v0.1.4.4, "Settings").
 * @param {function(object): object} skillFlags
 * @param {object} settings
 * @returns {string[]} [] when consistent
 */
export function skillFlagsProblems(skillFlags, settings) {
    let flags;
    try {
        flags = skillFlags(settings);
    } catch (err) {
        return [`skillFlags(settings) threw: ${err}`];
    }
    if (flags === null || typeof flags !== 'object') {
        return [`skillFlags(settings) must return an object, found ${show(flags)}`];
    }
    const problems = [];
    if (JSON.stringify(Object.keys(flags).sort()) !== JSON.stringify([...FLAG_KEYS].sort())) {
        problems.push(`skillFlags(settings) must have exactly the keys ${FLAG_KEYS.join(', ')}, found ${show(Object.keys(flags))}`);
    }
    for (const key of FLAG_KEYS) {
        if (typeof flags[key] !== 'boolean') {
            problems.push(`skillFlags(settings).${key} must be a boolean, found ${show(flags[key])}`);
        }
    }
    const on = Boolean(settings?.skill_learning) && Boolean(settings?.allow_insecure_coding);
    const reuse = on && settings.skill_reuse !== false;
    const expected = on
        ? { capture: settings.skill_capture !== false, reuse, command: reuse && settings.skill_command === true }
        : { capture: false, reuse: false, command: false };
    for (const key of FLAG_KEYS) {
        if (typeof flags[key] === 'boolean' && flags[key] !== expected[key]) {
            problems.push(on
                ? `skillFlags(settings).${key} must be ${expected[key]} for the sub flags of settings.js, found ${flags[key]}`
                : `skillFlags(settings).${key} must be false when skill_learning or allow_insecure_coding is falsy, found ${flags[key]}`);
        }
    }
    return problems;
}

const LIMIT_KEYS = [['maxCount', 'skill_max_count'], ['disableAfterErrors', 'skill_disable_after_errors']];

/**
 * What stays true of skillLimits(settings) whatever the owner chose: an object with the two
 * whole numbers of 0 or more maxCount and disableAfterErrors; each equals its setting when the
 * setting is a whole number of 0 or more.
 * @param {function(object): object} skillLimits
 * @param {object} settings
 * @returns {string[]} [] when valid
 */
export function skillLimitsProblems(skillLimits, settings) {
    let limits;
    try {
        limits = skillLimits(settings);
    } catch (err) {
        return [`skillLimits(settings) threw: ${err}`];
    }
    if (limits === null || typeof limits !== 'object') {
        return [`skillLimits(settings) must return an object, found ${show(limits)}`];
    }
    const problems = [];
    const names = LIMIT_KEYS.map(([name]) => name);
    if (JSON.stringify(Object.keys(limits).sort()) !== JSON.stringify([...names].sort())) {
        problems.push(`skillLimits(settings) must have exactly the keys ${names.join(', ')}, found ${show(Object.keys(limits))}`);
    }
    for (const [name, key] of LIMIT_KEYS) {
        if (!isWholeNumber(limits[name])) {
            problems.push(`skillLimits(settings).${name} must be a whole number of 0 or more, found ${show(limits[name])}`);
        } else if (isWholeNumber(settings?.[key]) && limits[name] !== settings[key]) {
            problems.push(`skillLimits(settings).${name} must be ${settings[key]}, the value of ${key}, found ${limits[name]}`);
        }
    }
    return problems;
}

/** Asserts that skillFlags(settings) is consistent with the settings. */
export function assertValidSkillFlags(skillFlags, settings) {
    assert.deepEqual(skillFlagsProblems(skillFlags, settings), []);
}

/** Asserts that skillLimits(settings) gives two valid whole numbers. */
export function assertValidSkillLimits(skillLimits, settings) {
    assert.deepEqual(skillLimitsProblems(skillLimits, settings), []);
}
