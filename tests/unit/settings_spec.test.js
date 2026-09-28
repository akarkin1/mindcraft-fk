// Spec S7 (settings.js, settings_spec.json) and S8 (.gitattributes), as changed by
// Amendment 1, A6: the complete key lists of settings.js and settings_spec.json are NOT
// pinned (future releases add settings), and nothing fails when one of the known gaps
// below gets a spec entry.
//
// settings.js is the owner's live configuration, so the VALUES of sandbox_lockdown and
// blocked_actions are not asserted, only that they are valid (tests/helpers/owner_settings.js,
// proven for other valid values in settings_owner_values.test.js). The entries of
// settings_spec.json hold the defaults in code and are asserted exactly.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { assertValidSetting } from '../helpers/owner_settings.js';

const settingsModule = await loadSrc('settings.js');
const settings = settingsModule.default;
const settingsSource = fs.readFileSync(repoPath('settings.js'), 'utf8');
const spec = JSON.parse(fs.readFileSync(repoPath('src/mindcraft/public/settings_spec.json'), 'utf8'));

// Allow-list of known gaps: keys of settings.js that have NO entry in settings_spec.json.
// These gaps already existed at v0.1.4.1 and are out of scope for v0.1.4.2. A key may leave
// this list when it gets a spec entry; do not add keys without a decision of the tech lead.
const KNOWN_SPEC_GAPS = [
    'mindserver_port', // UI/server port, read by main.js
    'auto_open_ui', // opens the browser UI on start
    'block_place_delay', // read by skills.js
];

// The line of sandbox_lockdown as specified, with the value the owner chose (true or false).
const EXACT_LINE = /^"sandbox_lockdown": (true|false), \/\/ runs the SES lockdown that isolates code written by the model\. set false only if a library breaks$/;

describe('settings.js', () => {
    test('default export has sandbox_lockdown, a boolean', () => {
        assertValidSetting(settings, 'sandbox_lockdown');
    });

    test('sandbox_lockdown comes directly after allow_insecure_coding', () => {
        const keys = Object.keys(settings);
        assert.equal(keys.indexOf('sandbox_lockdown'), keys.indexOf('allow_insecure_coding') + 1);
    });

    test('the new line is exactly as specified, including the comment; the value is the one of the default export', () => {
        const lines = settingsSource.split(/\r?\n/).map((l) => l.trim());
        const matches = lines.map((l) => EXACT_LINE.exec(l)).filter(Boolean);
        assert.equal(matches.length, 1, `one line like ${EXACT_LINE}`);
        assert.equal(matches[0][1], String(settings.sandbox_lockdown));
    });

    test('every key other than profiles has a settings_spec.json entry (or is a documented known gap)', () => {
        const missing = Object.keys(settings)
            .filter((k) => k !== 'profiles')
            .filter((k) => !(k in spec))
            .filter((k) => !KNOWN_SPEC_GAPS.includes(k));
        assert.deepEqual(missing, []);
    });

    // Which commands are blocked is the owner's choice (v0.1.4.5 added "!restart" to the fork's
    // list); the test checks that the list is valid and that the line keeps its comment.
    test('blocked_actions is an array of command names that each start with "!"; the line keeps its comment', () => {
        assertValidSetting(settings, 'blocked_actions');
        const line = settingsSource.split(/\r?\n/).find((l) => l.includes('"blocked_actions"'));
        assert.ok(line, 'line of blocked_actions');
        assert.ok(line.includes('// commands to disable and remove from docs. Ex: ["!setMode"]'), line);
    });
});

describe('src/mindcraft/public/settings_spec.json', () => {
    test('has a sandbox_lockdown entry: type "boolean", default true, a non-empty description', () => {
        const entry = spec.sandbox_lockdown;
        assert.ok(entry, 'entry exists');
        assert.equal(entry.type, 'boolean');
        assert.equal(entry.default, true);
        assert.equal(typeof entry.description, 'string');
        assert.ok(entry.description.trim().length > 0);
    });

    test('sandbox_lockdown is placed after allow_insecure_coding', () => {
        const keys = Object.keys(spec);
        assert.ok(keys.includes('sandbox_lockdown'));
        assert.ok(keys.indexOf('sandbox_lockdown') > keys.indexOf('allow_insecure_coding'));
    });

    test('allow_insecure_coding entry is unchanged', () => {
        assert.equal(spec.allow_insecure_coding.type, 'boolean');
        assert.equal(spec.allow_insecure_coding.default, false);
    });
});

describe('.gitattributes (S8)', () => {
    test('exists at the repository root and contains exactly one rule: *.patch text eol=lf', () => {
        const file = repoPath('.gitattributes');
        assert.ok(fs.existsSync(file), '.gitattributes exists');
        const rules = fs.readFileSync(file, 'utf8')
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l !== '' && !l.startsWith('#'))
            .map((l) => l.split(/\s+/).join(' '));
        assert.deepEqual(rules, ['*.patch text eol=lf']);
    });
});

// Spec v0.1.4.3, section "Settings": the four persistence settings get an entry with type,
// description and default, the default being the default in code (not the fork's value).
describe('settings_spec.json: persistence settings of v0.1.4.3', () => {
    const NEW_ENTRIES = [
        ['world_memory', 'boolean', false],
        ['world_id', 'string', ''],
        ['resume_goal', 'string', 'always'],
        ['goal_resume_limit', 'number', 0],
    ];
    for (const [key, type, codeDefault] of NEW_ENTRIES) {
        test(`${key}: type "${type}", default ${JSON.stringify(codeDefault)}, a non-empty description`, () => {
            const entry = spec[key];
            assert.ok(entry, `entry ${key} exists`);
            assert.equal(entry.type, type);
            assert.strictEqual(entry.default, codeDefault);
            assert.equal(typeof entry.description, 'string');
            assert.ok(entry.description.trim().length > 0);
        });
    }

    test('none of the four keys is in the list of known gaps', () => {
        for (const [key] of NEW_ENTRIES) assert.equal(KNOWN_SPEC_GAPS.includes(key), false, key);
    });
});

// Spec v0.1.4.4, section "Settings": the four skill settings get an entry with type,
// description and the default in code (not the fork's value).
describe('settings_spec.json: skill settings of v0.1.4.4', () => {
    const SKILL_ENTRIES = [
        ['skill_learning', 'boolean', false],
        ['skill_capture', 'boolean', true],
        ['skill_reuse', 'boolean', true],
        ['skill_command', 'boolean', false],
    ];
    for (const [key, type, codeDefault] of SKILL_ENTRIES) {
        test(`${key}: type "${type}", default ${JSON.stringify(codeDefault)}, a non-empty description`, () => {
            const entry = spec[key];
            assert.ok(entry, `entry ${key} exists`);
            assert.equal(entry.type, type);
            assert.strictEqual(entry.default, codeDefault);
            assert.equal(typeof entry.description, 'string');
            assert.ok(entry.description.trim().length > 0);
        });
    }

    test('none of the four keys is in the list of known gaps, and settings.js has all four', () => {
        for (const [key] of SKILL_ENTRIES) {
            assert.equal(KNOWN_SPEC_GAPS.includes(key), false, key);
            assert.ok(key in settings, `settings.js has ${key}`);
        }
    });
});

// Spec v0.1.4.5 "Guardrails", section "Settings": the two limits of the skill library get an
// entry with type, description and the default in code.
describe('settings_spec.json: skill guardrails of v0.1.4.5', () => {
    const LIMIT_ENTRIES = [
        ['skill_max_count', 'number', 100],
        ['skill_disable_after_errors', 'number', 3],
    ];
    for (const [key, type, codeDefault] of LIMIT_ENTRIES) {
        test(`${key}: type "${type}", default ${JSON.stringify(codeDefault)}, a description that says what 0 does`, () => {
            const entry = spec[key];
            assert.ok(entry, `entry ${key} exists`);
            assert.equal(entry.type, type);
            assert.strictEqual(entry.default, codeDefault);
            assert.equal(typeof entry.description, 'string');
            assert.ok(entry.description.trim().length > 0);
            assert.match(entry.description, /\b0\b/, 'the description names the value 0');
        });
    }

    test('both come after skill_command, are no known gaps, and settings.js has both', () => {
        const keys = Object.keys(spec);
        for (const [key] of LIMIT_ENTRIES) {
            assert.ok(keys.indexOf(key) > keys.indexOf('skill_command'), key);
            assert.equal(KNOWN_SPEC_GAPS.includes(key), false, key);
            assert.ok(key in settings, `settings.js has ${key}`);
        }
    });
});
