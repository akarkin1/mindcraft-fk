// Part G of v0.1.4.8 (E6): the settings of section 2 in the fork's settings.js and in
// src/mindcraft/public/settings_spec.json.
//
// settings.js is the owner's live configuration, so its VALUES are not asserted: each new key must
// exist and hold a valid value of its type. The entries of settings_spec.json hold the defaults in code
// and are asserted exactly.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { assertValidSetting, settingProblems } from '../helpers/owner_settings.js';

const settings = (await loadSrc('settings.js')).default;
const settingsSource = fs.readFileSync(repoPath('settings.js'), 'utf8');
const spec = JSON.parse(fs.readFileSync(repoPath('src/mindcraft/public/settings_spec.json'), 'utf8'));

const isBoolean = (v) => typeof v === 'boolean';
const isWhole = (v) => Number.isInteger(v) && v >= 0;
// key, type in settings_spec.json, default in code (section 2), the check of a valid value of the owner
const NEW_KEYS = [
    ['stuck_restart_after', 'number', 1, isWhole],
    ['protect_built_blocks', 'boolean', false, isBoolean],
    ['knowledge_in_prompt', 'boolean', false, isBoolean],
    ['knowledge_max_chars', 'number', 600, (v) => isWhole(v) && v > 0],
    ['repeat_guard', 'number', 0, isWhole],
    ['restart_context', 'boolean', false, isBoolean],
    ['say_results', 'boolean', false, isBoolean],
    ['flee_below_health', 'number', 0, (v) => typeof v === 'number' && v >= 0 && v <= 20],
    ['log_timestamps', 'boolean', false, isBoolean],
];
const KEYS = NEW_KEYS.map(([key]) => key);

describe('settings.js: the settings of v0.1.4.8', () => {
    for (const [key, , , valid] of NEW_KEYS) {
        test(`${key} exists and holds a valid value`, () => {
            assert.ok(Object.hasOwn(settings, key), `${key} is missing`);
            assert.ok(valid(settings[key]), `${key}: ${JSON.stringify(settings[key])}`);
        });
    }

    test('the keys form one block directly after keep_items, in the order of the spec', () => {
        const keys = Object.keys(settings);
        const at = keys.indexOf('keep_items');
        assert.ok(at >= 0);
        assert.deepEqual(keys.slice(at + 1, at + 1 + KEYS.length), KEYS);
    });

    test('each key has a short comment on its line; the numbers say what 0 does', () => {
        const lines = settingsSource.split(/\r?\n/);
        for (const key of KEYS) {
            const line = lines.find((l) => l.includes(`"${key}"`));
            assert.ok(line, `line of ${key}`);
            const comment = line.split('//')[1];
            assert.ok(comment && comment.trim().length > 0 && comment.trim().length <= 140, `comment of ${key}`);
        }
        for (const key of ['stuck_restart_after', 'repeat_guard', 'flee_below_health']) {
            assert.match(lines.find((l) => l.includes(`"${key}"`)).split('//')[1], /\b0\b/, key);
        }
    });

    test('home_reflexes: valid, and the hunger reflex is a key of it (spec section 2)', () => {
        assertValidSetting(settings, 'home_reflexes');
        assert.ok(Object.hasOwn(settings.home_reflexes, 'hunger'), 'home_reflexes.hunger');
        assert.equal(typeof settings.home_reflexes.hunger, 'boolean');
        assert.deepEqual(settingProblems({ home_reflexes: { hunger: false } }, ['home_reflexes']), []);
        assert.equal(settingProblems({ home_reflexes: { hunger: 'no' } }, ['home_reflexes']).length, 1);
    });

    test('the file keeps its CRLF line endings', () => {
        assert.equal(settingsSource.split('\r\n').length, settingsSource.split('\n').length);
    });
});

describe('settings_spec.json: the settings of v0.1.4.8', () => {
    for (const [key, type, codeDefault] of NEW_KEYS) {
        test(`${key}: type "${type}", default ${JSON.stringify(codeDefault)}, a description`, () => {
            const entry = spec[key];
            assert.ok(entry, `entry ${key} exists`);
            assert.equal(entry.type, type);
            assert.deepEqual(entry.default, codeDefault);
            assert.ok(typeof entry.description === 'string' && entry.description.trim().length > 0);
        });
    }

    test('the entries come directly after keep_items, in the order of the spec', () => {
        const keys = Object.keys(spec);
        const at = keys.indexOf('keep_items');
        assert.deepEqual(keys.slice(at + 1, at + 1 + KEYS.length), KEYS);
    });

    test('the numbers say what 0 does', () => {
        for (const key of ['stuck_restart_after', 'repeat_guard', 'flee_below_health']) assert.match(spec[key].description, /\b0\b/, key);
    });

    test('home_reflexes: hunger is on by default and named in the description', () => {
        assert.deepEqual(spec.home_reflexes.default, { door_closing: true, night_shelter: true, creeper_safety: true, hunger: true });
        assert.match(spec.home_reflexes.description, /hunger/);
    });

    test('ore_sense_range is not part of this release', () => {
        assert.equal(spec.ore_sense_range, undefined);
        assert.ok(!Object.hasOwn(settings, 'ore_sense_range'));
    });
});
