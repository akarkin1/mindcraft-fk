// Spec v0.1.4.6, section 1: the new settings in the fork's settings.js and in settings_spec.json.
//
// settings.js is the owner's live configuration, so its VALUES are not asserted: each new key must
// exist and hold a valid value (tests/helpers/owner_settings.js). The entries of settings_spec.json
// hold the defaults in code and are asserted exactly.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { OWNER_SETTING_RULES, assertValidSetting, settingProblems } from '../helpers/owner_settings.js';

const settings = (await loadSrc('settings.js')).default;
const settingsSource = fs.readFileSync(repoPath('settings.js'), 'utf8');
const spec = JSON.parse(fs.readFileSync(repoPath('src/mindcraft/public/settings_spec.json'), 'utf8'));

// key, type in settings_spec.json, default in code (spec section 1)
const NEW_KEYS = [
    ['cost_meter', 'boolean', true],
    ['cost_report_minutes', 'number', 10],
    ['cost_warn_per_hour', 'number', 0],
    ['cost_limit_per_hour', 'number', 0],
    ['cost_limit_per_session', 'number', 0],
    ['model_prices', 'object', {}],
    ['max_command_result_chars', 'number', 0],
    ['protected_areas', 'boolean', false],
    ['player_rules', 'boolean', false],
    ['rules_max', 'number', 20],
    ['home_pack', 'boolean', false],
    ['home_reflexes', 'object', { door_closing: true, night_shelter: true, creeper_safety: true, hunger: true }], // hunger: v0.1.4.8
    ['creeper_fighting', 'boolean', false],
];
const KEYS = NEW_KEYS.map(([key]) => key);

describe('settings.js: the settings of v0.1.4.6', () => {
    for (const key of KEYS) {
        test(`${key} exists and is ${OWNER_SETTING_RULES[key]?.text}`, () => {
            assertValidSetting(settings, key);
        });
    }

    test('the keys form one block directly after skill_disable_after_errors, in the order of the spec', () => {
        const keys = Object.keys(settings);
        const at = keys.indexOf('skill_disable_after_errors');
        assert.ok(at >= 0);
        assert.deepEqual(keys.slice(at + 1, at + 1 + KEYS.length), KEYS);
    });

    test('each key has a short comment on its line', () => {
        const lines = settingsSource.split(/\r?\n/);
        for (const key of KEYS) {
            const line = lines.find((l) => l.includes(`"${key}"`));
            assert.ok(line, `line of ${key}`);
            const comment = line.split('//')[1];
            assert.ok(comment && comment.trim().length > 0, `comment of ${key}`);
            assert.ok(comment.trim().length <= 140, `short comment of ${key}`);
        }
    });

    test('the rules of the helper accept the defaults in code and refuse a wrong type', () => {
        for (const [key, , codeDefault] of NEW_KEYS) {
            assert.deepEqual(settingProblems({ [key]: codeDefault }, [key]), [], key);
            assert.equal(settingProblems({ [key]: 'x' }, [key]).length, 1, key);
        }
        // other valid values of the owner
        const others = {
            cost_meter: false, cost_report_minutes: 0.5, cost_warn_per_hour: 2.5, cost_limit_per_hour: 0, cost_limit_per_session: 100,
            model_prices: { 'my-model': { input: 1, output: 5 }, other: { input: 0.1, output: 0.4, cache_read: 0.01, cache_write: 0.12 } },
            max_command_result_chars: 0, protected_areas: true, player_rules: true, rules_max: 0, home_pack: true,
            home_reflexes: { door_closing: false }, creeper_fighting: true,
        };
        assert.deepEqual(settingProblems(others, KEYS), []);
        assert.deepEqual(settingProblems({ home_reflexes: {} }, ['home_reflexes']), [], 'a missing reflex counts as on');
    });
});

describe('settings_spec.json: the settings of v0.1.4.6', () => {
    for (const [key, type, codeDefault] of NEW_KEYS) {
        test(`${key}: type "${type}", default ${JSON.stringify(codeDefault)} (the default in code), a description`, () => {
            const entry = spec[key];
            assert.ok(entry, `entry ${key} exists`);
            assert.equal(entry.type, type);
            assert.equal(entry.type, OWNER_SETTING_RULES[key].type, 'the type of the rule');
            assert.deepEqual(entry.default, codeDefault);
            assert.equal(typeof entry.description, 'string');
            assert.ok(entry.description.trim().length > 0);
        });
    }

    test('the entries come after skill_disable_after_errors, in the order of the spec', () => {
        const keys = Object.keys(spec);
        const at = keys.indexOf('skill_disable_after_errors');
        assert.ok(at >= 0);
        assert.deepEqual(keys.slice(at + 1, at + 1 + KEYS.length), KEYS);
    });

    test('the number limits say what 0 does', () => {
        for (const key of ['cost_report_minutes', 'cost_warn_per_hour', 'cost_limit_per_hour', 'cost_limit_per_session', 'max_command_result_chars', 'rules_max']) {
            assert.match(spec[key].description, /\b0\b/, key);
        }
    });
});
