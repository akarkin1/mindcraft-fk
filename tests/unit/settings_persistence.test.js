// Spec v0.1.4.3, section "Settings": world_memory, world_id, resume_goal, goal_resume_limit in
// the fork's settings.js. The settings_spec.json entries are checked in settings_spec.test.js.
//
// settings.js is the owner's live configuration, so the VALUES are not asserted: each key must
// exist and hold a valid value (tests/helpers/owner_settings.js, proven for other valid values in
// settings_owner_values.test.js). The order of the keys, the comments and CRLF are structure.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { OWNER_SETTING_RULES, assertValidSetting } from '../helpers/owner_settings.js';

const settings = (await loadSrc('settings.js')).default;
const settingsSource = fs.readFileSync(repoPath('settings.js'), 'utf8');

const NEW_KEYS = ['world_memory', 'world_id', 'resume_goal', 'goal_resume_limit'];

describe('settings.js: persistence settings of v0.1.4.3', () => {
    for (const key of NEW_KEYS) {
        test(`${key} exists and is ${OWNER_SETTING_RULES[key].text}`, () => {
            assertValidSetting(settings, key);
        });
    }

    test('the four keys form one block directly after load_memory', () => {
        const keys = Object.keys(settings);
        const at = keys.indexOf('load_memory');
        assert.ok(at >= 0, 'load_memory exists');
        assert.deepEqual(keys.slice(at + 1, at + 1 + NEW_KEYS.length).sort(), [...NEW_KEYS].sort());
    });

    test('each of the four lines has a short comment', () => {
        const lines = settingsSource.split(/\r?\n/);
        for (const key of NEW_KEYS) {
            const line = lines.find((l) => new RegExp(`^\\s*"${key}"\\s*:`).test(l));
            assert.ok(line, `line for ${key}`);
            const comment = /\/\/(.*)$/.exec(line);
            assert.ok(comment && comment[1].trim().length > 0, `comment on the line of ${key}: ${line}`);
        }
    });

    test('settings.js keeps one kind of line ending', () => {
        // The repository stores LF; a Windows checkout with core.autocrlf=true turns every line
        // into CRLF. Either is fine, a mix of the two is not.
        const crlf = settingsSource.includes('\r\n');
        if (crlf) assert.equal(/[^\r]\n/.test(settingsSource), false, 'no bare LF line ending');
        else assert.equal(settingsSource.includes('\r'), false, 'no CR at all');
    });

    test('load_memory is a boolean and init_message a string', () => {
        assertValidSetting(settings, 'load_memory');
        assertValidSetting(settings, 'init_message');
    });

    test('load_memory and init_message stay directly around the four keys', () => {
        const keys = Object.keys(settings);
        assert.equal(keys.indexOf('init_message'), keys.indexOf('load_memory') + 1 + NEW_KEYS.length);
    });
});
