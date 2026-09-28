// Spec v0.1.4.4, section "Settings": skillFlags(settings) of skill_manager.js and the four
// settings in the fork's settings.js.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';

const MANAGER = await loadSrc('src/agent/skills/skill_manager.js');
const settings = (await loadSrc('settings.js')).default;
const settingsSource = fs.readFileSync(repoPath('settings.js'), 'utf8');

const F = (capture, reuse, command) => ({ capture, reuse, command });
const ON = { skill_learning: true, allow_insecure_coding: true };

describe('skillFlags(settings)', () => {
    const TABLE = [
        ['nothing set', {}, F(false, false, false)],
        ['skill_learning only (allow_insecure_coding missing)', { skill_learning: true }, F(false, false, false)],
        ['allow_insecure_coding false', { skill_learning: true, allow_insecure_coding: false }, F(false, false, false)],
        ['allow_insecure_coding false, all sub flags on', { skill_learning: true, allow_insecure_coding: false, skill_capture: true, skill_reuse: true, skill_command: true }, F(false, false, false)],
        ['skill_learning false', { skill_learning: false, allow_insecure_coding: true, skill_capture: true, skill_reuse: true, skill_command: true }, F(false, false, false)],
        ['both on, sub flags missing: capture and reuse default true, command default false', ON, F(true, true, false)],
        ['truthy values count', { skill_learning: 1, allow_insecure_coding: 'yes' }, F(true, true, false)],
        ['skill_capture false', { ...ON, skill_capture: false }, F(false, true, false)],
        ['skill_reuse false', { ...ON, skill_reuse: false }, F(true, false, false)],
        ['skill_command true', { ...ON, skill_command: true }, F(true, true, true)],
        ['skill_command true but skill_reuse false', { ...ON, skill_reuse: false, skill_command: true }, F(true, false, false)],
        ["skill_command 'true' (not === true)", { ...ON, skill_command: 'true' }, F(true, true, false)],
        ['skill_command 1 (not === true)', { ...ON, skill_command: 1 }, F(true, true, false)],
        ['skill_capture and skill_reuse null or 0 (only false turns them off)', { ...ON, skill_capture: null, skill_reuse: 0 }, F(true, true, false)],
        ['everything on', { ...ON, skill_capture: true, skill_reuse: true, skill_command: true }, F(true, true, true)],
        ['everything off except the two main switches', { ...ON, skill_capture: false, skill_reuse: false, skill_command: false }, F(false, false, false)],
    ];
    for (const [label, input, expected] of TABLE) {
        test(`${label} -> ${JSON.stringify(expected)}`, () => {
            assert.deepEqual(MANAGER.skillFlags(input), expected);
        });
    }

    test('the settings object is not changed', () => {
        const input = { ...ON, skill_command: true };
        const copy = { ...input };
        MANAGER.skillFlags(input);
        assert.deepEqual(input, copy);
    });

    test("the fork's settings.js gives all false (skill_learning is false)", () => {
        assert.deepEqual(MANAGER.skillFlags(settings), F(false, false, false));
    });
});

describe('settings.js', () => {
    const FORK_VALUES = [['skill_learning', false], ['skill_capture', true], ['skill_reuse', true], ['skill_command', false]];

    for (const [key, value] of FORK_VALUES) {
        test(`${key} is ${value}`, () => {
            assert.strictEqual(settings[key], value);
        });
    }

    test('the four keys are one block directly after sandbox_lockdown', () => {
        const keys = Object.keys(settings);
        const at = keys.indexOf('sandbox_lockdown');
        assert.ok(at >= 0);
        assert.deepEqual(keys.slice(at + 1, at + 5).sort(), FORK_VALUES.map(([k]) => k).sort());
    });

    test('each of the four has a short comment on its line', () => {
        const lines = settingsSource.split(/\r?\n/);
        for (const [key] of FORK_VALUES) {
            const line = lines.find((l) => l.includes(`"${key}"`) || new RegExp(`\\b${key}\\s*:`).test(l));
            assert.ok(line, `line of ${key}`);
            const comment = line.split('//')[1];
            assert.ok(comment !== undefined && comment.trim().length > 0, `comment on the line of ${key}: ${line}`);
        }
    });
});

// Spec v0.1.4.5 "Guardrails", section "Settings": skill_max_count (default 100) and
// skill_disable_after_errors (default 3). 0 switches a guardrail off. A value that is not a finite
// number of 0 or more counts as the default. A number with a fraction is rounded down.
describe('skillLimits(settings) (v0.1.4.5)', () => {
    const L = (maxCount, disableAfterErrors) => ({ maxCount, disableAfterErrors });
    const TABLE = [
        ['nothing set: the defaults 100 and 3', {}, L(100, 3)],
        ['both set', { skill_max_count: 20, skill_disable_after_errors: 5 }, L(20, 5)],
        ['0 switches both guardrails off', { skill_max_count: 0, skill_disable_after_errors: 0 }, L(0, 0)],
        ['-0 is 0', { skill_max_count: -0, skill_disable_after_errors: -0 }, L(0, 0)],
        ['a fraction is rounded down', { skill_max_count: 7.9, skill_disable_after_errors: 2.5 }, L(7, 2)],
        ['a fraction below 1 is rounded down to 0 (off)', { skill_max_count: 0.5, skill_disable_after_errors: 0.99 }, L(0, 0)],
        ['a large number is kept', { skill_max_count: 1e6, skill_disable_after_errors: 1000 }, L(1e6, 1000)],
        ['negative numbers count as the default', { skill_max_count: -1, skill_disable_after_errors: -0.5 }, L(100, 3)],
        ['NaN and Infinity count as the default', { skill_max_count: Infinity, skill_disable_after_errors: NaN }, L(100, 3)],
        ['-Infinity counts as the default', { skill_max_count: -Infinity, skill_disable_after_errors: -Infinity }, L(100, 3)],
        ['a number as text counts as the default', { skill_max_count: '5', skill_disable_after_errors: '0' }, L(100, 3)],
        ['null and booleans count as the default', { skill_max_count: null, skill_disable_after_errors: true }, L(100, 3)],
        ['a Number object and an array count as the default', { skill_max_count: new Number(5), skill_disable_after_errors: [2] }, L(100, 3)],
        ['one key set, the other absent', { skill_disable_after_errors: 1 }, L(100, 1)],
        ['independent of the flags', { skill_learning: false, allow_insecure_coding: false, skill_max_count: 4 }, L(4, 3)],
    ];
    for (const [label, input, expected] of TABLE) {
        test(`${label} -> ${JSON.stringify(expected)}`, () => {
            assert.deepStrictEqual(MANAGER.skillLimits(input), expected);
        });
    }

    test('settings that are not an object: the defaults', () => {
        for (const input of [undefined, null, 42, 'skill_max_count', true]) {
            assert.deepStrictEqual(MANAGER.skillLimits(input), L(100, 3), String(input));
        }
    });

    test('never throws: a getter that throws gives the default of that key', () => {
        const input = { get skill_max_count() { throw new Error('getter'); }, skill_disable_after_errors: 7 };
        let result;
        assert.doesNotThrow(() => {
            result = MANAGER.skillLimits(input);
        });
        assert.deepStrictEqual(result, L(100, 7));
        const proxy = new Proxy({}, { get() { throw new Error('trap'); } });
        assert.deepStrictEqual(MANAGER.skillLimits(proxy), L(100, 3));
    });

    test('the settings object is not changed', () => {
        const input = { skill_max_count: 7.5, skill_disable_after_errors: -1 };
        MANAGER.skillLimits(input);
        assert.deepStrictEqual(input, { skill_max_count: 7.5, skill_disable_after_errors: -1 });
    });

    test("the fork's settings.js gives 100 and 3", () => {
        assert.deepStrictEqual(MANAGER.skillLimits(settings), L(100, 3));
    });
});

describe('settings.js: the guardrails of v0.1.4.5', () => {
    const LIMIT_VALUES = [['skill_max_count', 100], ['skill_disable_after_errors', 3]];

    for (const [key, value] of LIMIT_VALUES) {
        test(`${key} is ${value}`, () => {
            assert.strictEqual(settings[key], value);
        });
    }

    test('the two keys come directly after skill_command, in this order', () => {
        const keys = Object.keys(settings);
        const at = keys.indexOf('skill_command');
        assert.ok(at >= 0);
        assert.deepEqual(keys.slice(at + 1, at + 3), LIMIT_VALUES.map(([k]) => k));
    });

    test('each of the two has a short comment on its line', () => {
        const lines = settingsSource.split(/\r?\n/);
        for (const [key] of LIMIT_VALUES) {
            const line = lines.find((l) => l.includes(`"${key}"`));
            assert.ok(line, `line of ${key}`);
            const comment = line.split('//')[1];
            assert.ok(comment !== undefined && comment.trim().length > 0, `comment on the line of ${key}: ${line}`);
        }
    });
});
