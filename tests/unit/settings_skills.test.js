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
