// settings.js is the owner's live configuration: they switch world_memory, skill_learning and
// other toggles on for play tests and commit it. Unit tests must not assert those VALUES.
//
// The settings tests check the values of settings.js through tests/helpers/owner_settings.js.
// This file proves that those checks hold for any valid choice of the owner: it clones the
// settings of settings.js, flips every toggle, sets other valid values, and runs the same
// checks on each clone. It also proves that the checks are not empty: they refuse invalid values.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import {
    OWNER_SETTING_RULES,
    RESUME_GOAL_VALUES,
    settingProblems,
    skillFlagsProblems,
    skillLimitsProblems,
} from '../helpers/owner_settings.js';

const MANAGER = await loadSrc('src/agent/skills/skill_manager.js');
const settings = (await loadSrc('settings.js')).default;
const spec = JSON.parse(fs.readFileSync(repoPath('src/mindcraft/public/settings_spec.json'), 'utf8'));

const RULE_KEYS = Object.keys(OWNER_SETTING_RULES);
// The toggles the owner is known to switch for play tests; flipAll flips these and every other boolean.
const NAMED_TOGGLES = ['world_memory', 'skill_learning', 'skill_capture', 'skill_reuse', 'skill_command', 'sandbox_lockdown', 'allow_insecure_coding', 'load_memory'];

const clone = (overrides = {}) => ({ ...structuredClone(settings), ...overrides });

function flipAll(base = clone()) {
    const flipped = { ...base };
    for (const [key, value] of Object.entries(flipped)) {
        if (typeof value === 'boolean') flipped[key] = !value;
    }
    return flipped;
}

// Every check the settings test files make on the values of settings.js.
function allProblems(s) {
    return [
        ...settingProblems(s),
        ...skillFlagsProblems(MANAGER.skillFlags, s),
        ...skillLimitsProblems(MANAGER.skillLimits, s),
    ];
}

describe('the settings of settings.js as the owner has them', () => {
    test('every key of the rules exists and is valid; skillFlags and skillLimits are consistent', () => {
        assert.deepEqual(allProblems(settings), []);
    });

    test('the object can be cloned (only plain values), so the clones below are the same settings', () => {
        assert.deepEqual(clone(), settings);
    });
});

describe('other valid choices of the owner pass the same checks', () => {
    test('every boolean flipped', () => {
        const flipped = flipAll();
        for (const key of NAMED_TOGGLES) {
            assert.equal(typeof settings[key], 'boolean', `${key} is a toggle`);
            assert.equal(flipped[key], !settings[key], `${key} is flipped`);
        }
        assert.deepEqual(allProblems(flipped), []);
    });

    // All four combinations of the two main switches, with the sub flags as they are and flipped,
    // so skillFlags is checked on and off with every sub flag both ways.
    for (const learning of [false, true]) {
        for (const insecure of [false, true]) {
            for (const [label, base] of [['sub flags as they are', clone], ['sub flags flipped', () => flipAll()]]) {
                test(`skill_learning ${learning}, allow_insecure_coding ${insecure}, ${label}`, () => {
                    const s = { ...base(), skill_learning: learning, allow_insecure_coding: insecure };
                    assert.deepEqual(allProblems(s), []);
                    const flags = MANAGER.skillFlags(s);
                    if (!learning || !insecure) assert.deepEqual(flags, { capture: false, reuse: false, command: false });
                });
            }
        }
    }

    for (const value of RESUME_GOAL_VALUES) {
        test(`resume_goal "${value}"`, () => {
            assert.deepEqual(allProblems(clone({ resume_goal: value })), []);
        });
    }

    test('all limits 0 (the guardrails off, no resume limit)', () => {
        assert.deepEqual(allProblems(clone({ goal_resume_limit: 0, skill_max_count: 0, skill_disable_after_errors: 0 })), []);
    });

    test('large limits', () => {
        assert.deepEqual(allProblems(clone({ goal_resume_limit: 1000, skill_max_count: 100000, skill_disable_after_errors: 50 })), []);
    });

    for (const list of [[], ['!restart'], ['!newAction', '!restart', '!setMode'], [...settings.blocked_actions, '!useSkill']]) {
        test(`blocked_actions ${JSON.stringify(list)}`, () => {
            assert.deepEqual(allProblems(clone({ blocked_actions: list })), []);
        });
    }

    test('a fixed world_id and another init_message', () => {
        assert.deepEqual(allProblems(clone({ world_id: 'Survival World 2', init_message: '' })), []);
    });

    test('everything at once: flipped, other values, both main switches on', () => {
        const s = { ...flipAll(), skill_learning: true, allow_insecure_coding: true, resume_goal: 'never', world_id: 'x', goal_resume_limit: 0, skill_max_count: 0, skill_disable_after_errors: 0, blocked_actions: [] };
        assert.deepEqual(allProblems(s), []);
    });
});

describe('the checks refuse invalid values (they are not empty)', () => {
    const INVALID = {
        load_memory: ['true', 1, null],
        world_memory: ['true', 0, null, undefined],
        world_id: [null, 42, false],
        resume_goal: ['sometimes', '', 'ALWAYS', null, true],
        goal_resume_limit: [-1, 2.5, '3', NaN, Infinity, null],
        init_message: [null, 7],
        allow_insecure_coding: ['yes', 1],
        sandbox_lockdown: ['false', 0],
        skill_learning: ['false', 1, null],
        skill_capture: [0, 'true'],
        skill_reuse: [null, 'no'],
        skill_command: [1, 'true'],
        skill_max_count: [-1, 0.5, '100', NaN, -Infinity],
        skill_disable_after_errors: [-3, 1.5, '3', Infinity],
        blocked_actions: ['!restart', null, {}, ['restart'], ['!'], ['!new Action'], [3], ['!restart', null]],
        // v0.1.4.6
        cost_meter: ['true', 1, null],
        cost_report_minutes: [-1, '10', NaN, Infinity, null],
        cost_warn_per_hour: [-0.5, '3', NaN, Infinity],
        cost_limit_per_hour: [-8, '8', NaN, null],
        cost_limit_per_session: [-1, '10', -Infinity, null],
        model_prices: [null, [], 'x', { m: null }, { m: 5 }, { m: {} }, { m: { input: -1 } }, { m: { input: '1' } }, { m: { price: 1 } }],
        max_command_result_chars: [-1, 2.5, '3000', NaN, null],
        protected_areas: ['false', 0, null],
        player_rules: ['true', 1],
        rules_max: [-1, 1.5, '20', Infinity],
        home_pack: ['true', 0, null],
        home_reflexes: [null, [], true, { door_closing: 'yes' }, { door_closing: 1 }, { doors: true }],
        creeper_fighting: [1, 'false'],
    };

    test('every rule has invalid examples here', () => {
        assert.deepEqual(Object.keys(INVALID).sort(), [...RULE_KEYS].sort());
    });

    for (const [key, values] of Object.entries(INVALID)) {
        for (const value of values) {
            test(`${key} ${Array.isArray(value) || (value && typeof value === 'object') ? JSON.stringify(value) : String(typeof value === 'string' ? `"${value}"` : value)} is refused`, () => {
                const problems = settingProblems(clone({ [key]: value }));
                assert.equal(problems.length, 1, JSON.stringify(problems));
                assert.ok(problems[0].startsWith(`${key} must be `), problems[0]);
            });
        }
    }

    test('a missing key is refused', () => {
        for (const key of RULE_KEYS) {
            const s = clone();
            delete s[key];
            assert.deepEqual(settingProblems(s), [`${key} is missing`]);
        }
        assert.deepEqual(settingProblems(null, ['world_memory']), ['world_memory is missing']);
    });

    test('an unknown key is an error of the test, not a pass', () => {
        assert.throws(() => settingProblems(settings, ['no_such_setting']), /no rule/);
    });

    test('skillFlags that does not follow the switches is refused', () => {
        const off = clone({ skill_learning: false });
        const on = clone({ skill_learning: true, allow_insecure_coding: true, skill_capture: true, skill_reuse: true, skill_command: true });
        const FAKES = [
            ['on while skill_learning is false', () => ({ capture: true, reuse: false, command: false }), off],
            ['a flag that is not a boolean', () => ({ capture: 0, reuse: false, command: false }), off],
            ['a missing flag', () => ({ capture: false, reuse: false }), off],
            ['an extra key', () => ({ capture: false, reuse: false, command: false, more: false }), off],
            ['off although everything is on', () => ({ capture: false, reuse: false, command: false }), on],
            ['command without the sub flag', (s) => ({ ...MANAGER.skillFlags(s), command: true }), clone({ skill_learning: true, allow_insecure_coding: true, skill_command: false })],
            ['not an object', () => null, off],
            ['throws', () => { throw new Error('broken'); }, off],
        ];
        for (const [label, fake, s] of FAKES) {
            assert.notDeepEqual(skillFlagsProblems(fake, s), [], label);
        }
    });

    test('skillLimits that gives invalid numbers or ignores a valid setting is refused', () => {
        const s = clone({ skill_max_count: 7, skill_disable_after_errors: 2 });
        const FAKES = [
            ['a negative number', () => ({ maxCount: -1, disableAfterErrors: 2 })],
            ['a fraction', () => ({ maxCount: 7, disableAfterErrors: 2.5 })],
            ['not the setting', () => ({ maxCount: 100, disableAfterErrors: 2 })],
            ['a missing key', () => ({ maxCount: 7 })],
            ['not an object', () => 7],
            ['throws', () => { throw new Error('broken'); }],
        ];
        for (const [label, fake] of FAKES) {
            assert.notDeepEqual(skillLimitsProblems(fake, s), [], label);
        }
    });
});

describe('the rules match settings_spec.json', () => {
    test('every key of the rules has a settings_spec.json entry of the same type, and its default in code is valid', () => {
        for (const key of RULE_KEYS) {
            const entry = spec[key];
            assert.ok(entry, `settings_spec.json has ${key}`);
            assert.equal(entry.type, OWNER_SETTING_RULES[key].type, `type of ${key}`);
            assert.deepEqual(settingProblems({ [key]: entry.default }, [key]), [], `the default of ${key} in settings_spec.json`);
        }
    });

    test('the default settings of settings_spec.json pass all checks', () => {
        const defaults = Object.fromEntries(RULE_KEYS.map((key) => [key, spec[key].default]));
        assert.deepEqual(allProblems(defaults), []);
    });
});

describe('the settings test files check the values of settings.js through this helper', () => {
    for (const file of ['settings_persistence.test.js', 'settings_skills.test.js', 'settings_spec.test.js']) {
        test(`${file} imports tests/helpers/owner_settings.js`, () => {
            const text = fs.readFileSync(repoPath(`tests/unit/${file}`), 'utf8');
            assert.match(text, /from '\.\.\/helpers\/owner_settings\.js'/);
        });
    }
});
