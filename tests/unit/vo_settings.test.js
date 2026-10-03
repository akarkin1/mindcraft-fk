// v0.1.4.13, the live voice (docs/releases/0.1.4.13/HANDOFF-voice.md, 5): voice_ui, voice_voice and voice_language in
// settings.js and settings_spec.json, after bot_role. settings.js is the owner's live configuration (CLAUDE.md): its
// values are not asserted, only that each key exists with a valid value. settings_spec.json holds the defaults.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';

const settings = (await loadSrc('settings.js')).default;
const spec = JSON.parse(fs.readFileSync(repoPath('src/mindcraft/public/settings_spec.json'), 'utf8'));

// key, default, type in settings_spec.json, the check of a value in settings.js
const ROWS = [
    ['voice_ui', false, 'boolean', (v) => typeof v === 'boolean'],
    ['voice_voice', 'supertonic:F1', 'string', (v) => typeof v === 'string' && /^(supertonic|kokoro):\S+$/.test(v)],
    ['voice_language', 'en', 'string', (v) => typeof v === 'string' && v.trim() !== ''],
];

describe('the voice in settings.js', () => {
    for (const [key, , type, valid] of ROWS) {
        test(`${key} exists with a valid ${type} value`, () => {
            assert.ok(Object.hasOwn(settings, key), `settings.js has no ${key}`);
            assert.ok(valid(settings[key]), `${key}: ${JSON.stringify(settings[key])}`);
        });
    }

    test('each key is written in the style of the others: a quoted key, a value, a comment', () => {
        const source = fs.readFileSync(repoPath('settings.js'), 'utf8');
        assert.match(source, /^\s*"voice_ui":\s*(true|false),\s*\/\/ \S/m);
        assert.match(source, /^\s*"voice_voice":\s*"[^"\n]*",\s*\/\/ \S/m);
        assert.match(source, /^\s*"voice_language":\s*"[^"\n]*",\s*\/\/ \S/m);
    });

    test('the keys follow bot_role, in this order', () => {
        const keys = Object.keys(settings);
        assert.equal(keys.indexOf('voice_ui'), keys.indexOf('bot_role') + 1);
        assert.equal(keys.indexOf('voice_voice'), keys.indexOf('voice_ui') + 1);
        assert.equal(keys.indexOf('voice_language'), keys.indexOf('voice_voice') + 1);
    });
});

describe('the voice in settings_spec.json', () => {
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

    test('off by default, after bot_role', () => {
        assert.equal(spec.voice_ui.default, false);
        const keys = Object.keys(spec);
        assert.equal(keys.indexOf('voice_ui'), keys.indexOf('bot_role') + 1);
    });
});
