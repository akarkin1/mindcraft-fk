// Spec v0.1.4.12, section 2 (part D, engineer E6): other_bots and bot_role in settings.js and settings_spec.json.
// settings.js is the owner's live configuration (CLAUDE.md): its values are not asserted, only that each key exists
// with a valid value of its type. settings_spec.json holds the defaults: they are asserted exactly.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';

const settings = (await loadSrc('settings.js')).default;
const spec = JSON.parse(fs.readFileSync(repoPath('src/mindcraft/public/settings_spec.json'), 'utf8'));

// key, default, type in settings_spec.json, the check of a value in settings.js
const ROWS = [
    ['other_bots', [], 'array', (v) => Array.isArray(v) && v.every((n) => typeof n === 'string')],
    ['bot_role', '', 'string', (v) => typeof v === 'string'],
];

describe('section 2: other_bots and bot_role in settings.js', () => {
    for (const [key, , type, valid] of ROWS) {
        test(`${key} exists with a valid ${type} value`, () => {
            assert.ok(Object.hasOwn(settings, key), `settings.js has no ${key}`);
            assert.ok(valid(settings[key]), `${key}: ${JSON.stringify(settings[key])}`);
        });
    }

    test('each key is written in the style of only_chat_with: a quoted key, a value, a comment', () => {
        const source = fs.readFileSync(repoPath('settings.js'), 'utf8');
        assert.match(source, /^\s*"other_bots":\s*\[[^\]]*\],\s*\/\/ \S/m);
        assert.match(source, /^\s*"bot_role":\s*"[^"\n]*",\s*\/\/ \S/m);
    });

    test('the keys follow the switches of the release: watch_and_learn (or watch_port), other_bots, bot_role', () => {
        const keys = Object.keys(settings);
        const anchor = keys.includes('watch_and_learn') ? 'watch_and_learn' : 'watch_port';
        assert.equal(keys.indexOf('other_bots'), keys.indexOf(anchor) + 1);
        assert.equal(keys.indexOf('bot_role'), keys.indexOf('other_bots') + 1);
    });
});

describe('section 2: other_bots and bot_role in settings_spec.json', () => {
    for (const [key, def, type] of ROWS) {
        test(`${key}: type ${type}, default ${JSON.stringify(def)}, a description`, () => {
            const entry = spec[key];
            assert.ok(entry, `settings_spec.json has no ${key}`);
            assert.equal(entry.type, type);
            assert.deepEqual(entry.default, def);
            assert.equal(typeof entry.description, 'string');
            assert.ok(entry.description.length > 0);
        });
    }

    test('both off by default: no name, no role', () => {
        assert.deepEqual(spec.other_bots.default, []);
        assert.equal(spec.bot_role.default, '');
    });
});
