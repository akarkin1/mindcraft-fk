// T1 round 2, spec v0.1.4.8 section 2 (the settings) and the handoff (part F for part G, item 1: the
// file of the spec is src/mindcraft/public/settings_spec.json). Every key of the table exists in
// settings.js and in settings_spec.json, with the default and the type of the table.
// settings.js is the live configuration of the owner: its VALUES are never asserted, only that each key
// is there with a valid value of its type (tests/helpers/owner_settings.js). The defaults are asserted in
// settings_spec.json, which the owner does not edit.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';

const settings = (await loadSrc('settings.js')).default;
const SPEC = JSON.parse(fs.readFileSync(repoPath('src/mindcraft/public/settings_spec.json'), 'utf8'));

const isInt = (v) => Number.isInteger(v);
const isBool = (v) => typeof v === 'boolean';

// The table of section 2: key, default, type in settings_spec.json, the values a setting may hold.
const TABLE = [
    ['stuck_restart_after', 1, 'number', (v) => isInt(v) && v >= 0],
    ['protect_built_blocks', false, 'boolean', isBool],
    ['knowledge_in_prompt', false, 'boolean', isBool],
    ['knowledge_max_chars', 600, 'number', (v) => isInt(v) && v > 0],
    ['repeat_guard', 0, 'number', (v) => isInt(v) && v >= 0],
    ['restart_context', false, 'boolean', isBool],
    ['say_results', false, 'boolean', isBool],
    ['flee_below_health', 0, 'number', (v) => isInt(v) && v >= 0 && v <= 20],
    ['log_timestamps', false, 'boolean', isBool],
];

describe('section 2: the new keys in settings_spec.json', () => {
    for (const [key, def, type] of TABLE) {
        test(`${key}: type ${type}, default ${JSON.stringify(def)}, with a description`, () => {
            const entry = SPEC[key];
            assert.ok(entry, `${key} is in settings_spec.json`);
            assert.equal(entry.type, type);
            assert.deepEqual(entry.default, def);
            assert.equal(typeof entry.description, 'string');
            assert.ok(entry.description.trim().length > 10);
        });
    }

    test('home_reflexes.hunger: part of home_reflexes, default true', () => {
        assert.equal(SPEC.home_reflexes.type, 'object');
        assert.equal(SPEC.home_reflexes.default.hunger, true);
        for (const name of ['door_closing', 'night_shelter', 'creeper_safety']) assert.equal(SPEC.home_reflexes.default[name], true, name);
        assert.match(SPEC.home_reflexes.description, /hunger/);
    });

    // v0.1.4.9 brought ore_sense_range (section 2 of its spec; tests/unit/rtg_settings.test.js)
    test('ore_sense_range is not part of this release: it came with v0.1.4.9, 0 by default', () => {
        assert.equal(SPEC.ore_sense_range.type, 'number');
        assert.equal(SPEC.ore_sense_range.default, 0);
    });

    test('the defaults of the spec file are valid values of the table', () => {
        for (const [key, , , valid] of TABLE) assert.ok(valid(SPEC[key].default), key);
    });
});

describe('section 2: the new keys in settings.js (the values of the owner are not asserted)', () => {
    for (const [key, , , valid] of TABLE) {
        test(`${key} exists and holds a valid value`, () => {
            assert.ok(Object.hasOwn(settings, key), `${key} is in settings.js`);
            assert.ok(valid(settings[key]), `${key}: ${JSON.stringify(settings[key])}`);
        });
    }

    test('home_reflexes holds hunger as a boolean (a missing reflex counts as on)', () => {
        assert.ok(settings.home_reflexes && typeof settings.home_reflexes === 'object');
        assert.equal(typeof settings.home_reflexes.hunger, 'boolean');
    });

    // v0.1.4.9 brought ore_sense_range: a valid value of the owner, 0 or 3
    test('ore_sense_range is not part of this release: it came with v0.1.4.9, 0 or 3', () => {
        assert.ok([0, 3].includes(settings.ore_sense_range), `ore_sense_range: ${settings.ore_sense_range}`);
    });

    test('the comment of each new key in settings.js says what it does', () => {
        const text = fs.readFileSync(repoPath('settings.js'), 'utf8');
        for (const [key] of TABLE) {
            const line = text.split(/\r?\n/).find((l) => l.includes(`"${key}"`));
            assert.ok(line, key);
            assert.match(line, /\/\/ \S.{10,}/, `${key}: ${line}`);
        }
    });
});
