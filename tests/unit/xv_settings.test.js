// Spec v0.1.4.13 section 2 (part N2): supervisor_name, supervisor_voice and supervisor_updates in settings.js and in
// src/mindcraft/public/settings_spec.json, after watch_report_seconds. settings.js is the owner's live configuration
// (CLAUDE.md): its values are not asserted, only that each key exists with a valid value. The spec holds the
// defaults: off.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';

const settings = (await loadSrc('settings.js')).default;
const spec = JSON.parse(fs.readFileSync(repoPath('src/mindcraft/public/settings_spec.json'), 'utf8'));
const VOICE = /^(supertonic|kokoro):\S+$/;

// key, default, type in settings_spec.json, the check of a value in settings.js
const ROWS = [
    ['supervisor_name', '', 'string', (v) => typeof v === 'string'],
    ['supervisor_voice', 'supertonic:M1', 'string', (v) => typeof v === 'string' && VOICE.test(v)],
    ['supervisor_updates', false, 'boolean', (v) => typeof v === 'boolean'],
];

describe('the supervisor in settings.js', () => {
    for (const [key, , type, valid] of ROWS) {
        test(`${key} exists with a valid ${type} value`, () => {
            assert.ok(Object.hasOwn(settings, key), `settings.js has no ${key}`);
            assert.ok(valid(settings[key]), `${key}: ${JSON.stringify(settings[key])}`);
        });
    }

    test('each key in the style of the others: a quoted key, a value, a comment', () => {
        const source = fs.readFileSync(repoPath('settings.js'), 'utf8');
        assert.match(source, /^\s*"supervisor_name":\s*"[^"\n]*",\s*\/\/ \S/m);
        assert.match(source, /^\s*"supervisor_voice":\s*"[^"\n]*",\s*\/\/ \S/m);
        assert.match(source, /^\s*"supervisor_updates":\s*(true|false),\s*\/\/ \S/m);
    });

    test('after watch_report_seconds, in this order', () => {
        const keys = Object.keys(settings);
        assert.ok(keys.indexOf('supervisor_name') > keys.indexOf('watch_report_seconds'));
        assert.ok(keys.indexOf('supervisor_voice') > keys.indexOf('supervisor_name'));
        assert.ok(keys.indexOf('supervisor_updates') > keys.indexOf('supervisor_voice'));
    });
});

describe('the supervisor in settings_spec.json', () => {
    for (const [key, def, type] of ROWS) {
        test(`${key}: type ${type}, default ${JSON.stringify(def)}, a description`, () => {
            const entry = spec[key];
            assert.ok(entry, `settings_spec.json has no ${key}`);
            assert.equal(entry.type, type);
            assert.deepEqual(entry.default, def);
            assert.equal(typeof entry.description, 'string');
            assert.ok(entry.description.length > 20);
        });
    }

    test('after watch_report_seconds, in this order', () => {
        const keys = Object.keys(spec);
        assert.ok(keys.indexOf('supervisor_name') > keys.indexOf('watch_report_seconds'));
        assert.ok(keys.indexOf('supervisor_voice') > keys.indexOf('supervisor_name'));
        assert.ok(keys.indexOf('supervisor_updates') > keys.indexOf('supervisor_voice'));
    });
});
