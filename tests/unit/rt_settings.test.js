// T1, spec v0.1.4.9 section 2 (the settings, part G): every key of the table in settings.js and in
// src/mindcraft/public/settings_spec.json with its default and its type. settings.js is the live configuration of
// the owner: its VALUES are never asserted, only that each key is there with a valid value (CLAUDE.md); the
// defaults are asserted in settings_spec.json. The warning of mine_routes without routes_pack, word for word.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';

const settings = (await loadSrc('settings.js')).default;
const SPEC = JSON.parse(fs.readFileSync(repoPath('src/mindcraft/public/settings_spec.json'), 'utf8'));

const isBool = (v) => typeof v === 'boolean';
// key, default, type in settings_spec.json, the values the setting may hold
const TABLE = [
    ['routes_pack', false, 'boolean', isBool],
    ['trail_max_steps', 500, 'number', (v) => Number.isInteger(v) && v >= 50],
    ['mine_routes', false, 'boolean', isBool],
    ['ore_sense_range', 0, 'number', (v) => v === 0 || v === 3],
    ['skills_over_code', false, 'boolean', isBool],
];
const WARNING = 'mine_routes needs routes_pack. The mine routes are off.';

describe('section 2: the new keys in settings_spec.json', () => {
    for (const [key, def, type] of TABLE) {
        test(`${key}: type ${type}, default ${JSON.stringify(def)}, with a description`, () => {
            const entry = SPEC[key];
            assert.ok(entry, `${key} is in settings_spec.json`);
            assert.equal(entry.type, type);
            assert.deepEqual(entry.default, def);
            assert.equal(typeof entry.description, 'string');
            assert.ok(entry.description.trim().length > 10, entry.description);
        });
    }

    test('every new switch is off by default (rule 6)', () => {
        for (const key of ['routes_pack', 'mine_routes', 'skills_over_code']) assert.equal(SPEC[key].default, false, key);
        assert.equal(SPEC.ore_sense_range.default, 0);
    });

    test('the defaults are valid values of the table', () => {
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

    test('the comment of each new key in settings.js says what it does', () => {
        const text = fs.readFileSync(repoPath('settings.js'), 'utf8');
        for (const [key] of TABLE) {
            const line = text.split(/\r?\n/).find((l) => l.includes(`"${key}"`));
            assert.ok(line, key);
            assert.match(line, /\/\/ \S.{10,}/, `${key}: ${line}`);
        }
    });

    test('the switches of the owner of v0.1.4.8 are still there', () => {
        for (const key of ['mining_pack', 'home_pack', 'storage_pack', 'farming_pack', 'wood_pack', 'knowledge_in_prompt']) {
            assert.ok(Object.hasOwn(settings, key), key);
        }
    });
});

describe('section 2: mine_routes without routes_pack', () => {
    test('the warning, word for word, in the agent', () => {
        const source = fs.readFileSync(repoPath('src/agent/agent.js'), 'utf8');
        assert.ok(source.includes(`'${WARNING}'`) || source.includes(`"${WARNING}"`), 'the text of the warning');
    });
});
