// Spec v0.1.4.7, section 1: the new settings in the fork's settings.js and in settings_spec.json.
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
    ['storage_pack', 'boolean', false],
    ['farming_pack', 'boolean', false],
    ['wood_pack', 'boolean', false],
    ['mining_pack', 'boolean', false],
    ['mining_max_minutes', 'number', 30],
    ['keep_items', 'object', {}],
];
const KEYS = NEW_KEYS.map(([key]) => key);

describe('settings.js: the settings of v0.1.4.7', () => {
    for (const key of KEYS) {
        test(`${key} exists and is ${OWNER_SETTING_RULES[key]?.text}`, () => {
            assertValidSetting(settings, key);
        });
    }

    test('the keys form one block directly after creeper_fighting, in the order of the spec', () => {
        const keys = Object.keys(settings);
        const at = keys.indexOf('creeper_fighting');
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

    test('the rules of the helper accept the defaults in code and other valid values, and refuse a wrong type', () => {
        for (const [key, , codeDefault] of NEW_KEYS) {
            assert.deepEqual(settingProblems({ [key]: codeDefault }, [key]), [], key);
            assert.equal(settingProblems({ [key]: 'x' }, [key]).length, 1, key);
        }
        const others = { storage_pack: true, farming_pack: true, wood_pack: true, mining_pack: true, mining_max_minutes: 0.5,
            keep_items: { wheat_seeds: 32, iron_ingot: -1, bread: 0 } };
        assert.deepEqual(settingProblems(others, KEYS), []);
        assert.equal(settingProblems({ mining_max_minutes: 0 }, ['mining_max_minutes']).length, 1, 'a trip of 0 minutes');
        assert.equal(settingProblems({ keep_items: { wheat_seeds: -2 } }, ['keep_items']).length, 1, 'a count below -1');
    });
});

describe('settings_spec.json: the settings of v0.1.4.7', () => {
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

    test('the entries come directly after creeper_fighting, in the order of the spec', () => {
        const keys = Object.keys(spec);
        const at = keys.indexOf('creeper_fighting');
        assert.ok(at >= 0);
        assert.deepEqual(keys.slice(at + 1, at + 1 + KEYS.length), KEYS);
    });

    test('the switches name their commands', () => {
        assert.match(spec.storage_pack.description, /!storeItems, !fetchItem and !chests/);
        assert.match(spec.farming_pack.description, /!farmCycle, !harvest, !plant, !makeBoneMeal and !fertilize/);
        assert.match(spec.wood_pack.description, /!chopTrees, !getTool and !craftSupplies/);
        assert.match(spec.mining_pack.description, /!mineOre, !goToMine and !leaveMine/);
    });
});
