// Spec v0.1.4.4, flag rule (section 0.1) as far as unit tests can prove it (K9):
//   - with settings.skill_learning falsy all flags are false and the prompt builders return '',
//   - insertSection with '' returns the identical string,
//   - the source text of coder.js, prompter.js, agent.js and actions.js (and queries.js, where
//     !skills lives) shows that every new call is guarded by the manager.
//
// The source checks work on the syntax tree (tests/helpers/source_ast.js). A use of the manager
// is `<x>.skill_manager.<member>` or `manager.<member>` (also through `const m = <x>.skill_manager`)
// or a call of a function imported from skills/skill_*.js. It counts as guarded when it sits in
// the branch of an if / ?: that runs when the manager is there (the else branch of
// `if (manager)` does not count), on the right of && / || / ?? whose condition mentions the
// manager, after an `if (!manager) return` in an enclosing block, or behind optional chaining (?.).
// In agent.js the guard of `new SkillManager` is the flags, so there a condition that mentions
// the flags or settings of the feature counts as well. In prompter.js a check for the
// placeholder $CUSTOM_SKILLS counts too: without a manager a prompt that contains it gets it
// removed, any other prompt is not touched (Amendment 1, A6).
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { listFiles } from '../helpers/tree.js';
import { captureConsole } from '../helpers/console_capture.js';
import { makeEndowments, inventoryOf } from '../helpers/skill_env.js';
import { analyseSkillGuards, analyseSkillGuardsInText, readRepoFile } from '../helpers/source_ast.js';

const MANAGER = await loadSrc('src/agent/skills/skill_manager.js');
const PROMPT = await loadSrc('src/agent/skills/skill_prompt.js');
const LOCK = await loadSrc('src/agent/library/lockdown.js');

const OFF_SETTINGS = [
    ['skill_learning false, everything else on', { skill_learning: false, allow_insecure_coding: true, skill_capture: true, skill_reuse: true, skill_command: true }],
    ['skill_learning missing', { allow_insecure_coding: true, skill_capture: true, skill_reuse: true, skill_command: true }],
    ['skill_learning 0', { skill_learning: 0, allow_insecure_coding: true }],
    ["skill_learning ''", { skill_learning: '', allow_insecure_coding: true }],
    ['skill_learning null', { skill_learning: null, allow_insecure_coding: true }],
];
const OFF_FLAGS = { capture: false, reuse: false, command: false };

const skill = (name, status = 'active') => ({
    name, signature: `${name}(bot)`, description: `Does ${name}.`, status, version: 1,
    created: null, updated: null, uses: 0, failures: 0, consecutive_failures: 0,
    last_used: null, last_error: null, source_task: 't', hash: 'h', doc: `Does ${name}.`,
});
const SKILLS = [skill('buildWall'), skill('digHole'), skill('oldSkill', 'disabled')];

describe('flags off: skillFlags and the prompt builders', () => {
    for (const [label, settings] of OFF_SETTINGS) {
        test(`${label}: skillFlags gives all false`, () => {
            assert.deepEqual(MANAGER.skillFlags(settings), OFF_FLAGS);
        });
    }

    test("buildCodingSection with all flags false: '' (also with skills and a task)", () => {
        assert.equal(PROMPT.buildCodingSection({ flags: OFF_FLAGS, skills: SKILLS, task: 'build a wall' }), '');
        assert.equal(PROMPT.buildCodingSection({ flags: OFF_FLAGS, skills: [], task: '' }), '');
    });

    test("buildConversingSection with all flags false: ''", () => {
        assert.equal(PROMPT.buildConversingSection({ flags: OFF_FLAGS, skills: SKILLS }), '');
        assert.equal(PROMPT.buildConversingSection({ flags: { ...OFF_FLAGS, command: true }, skills: SKILLS }), '');
    });

    test('insertSection(prompt, \'\') returns the identical string for a prompt without $CUSTOM_SKILLS, also for the prompts of the default profile', () => {
        const profile = JSON.parse(fs.readFileSync(repoPath('profiles/defaults/_default.json'), 'utf8'));
        const defaults = [profile.conversing, profile.coding, profile.saving_memory, profile.bot_responder];
        for (const prompt of defaults) {
            assert.equal(typeof prompt, 'string');
            assert.ok(!prompt.includes('$CUSTOM_SKILLS'), 'the default prompts have no placeholder, so they stay as in v0.1.4.3');
        }
        const prompts = [
            ...defaults,
            '', 'Plain.', 'Intro\nConversation Begin:', 'Intro\r\nConversation:\r\n', '$& $1 $$ $` $\'', 'x'.repeat(100000),
        ];
        for (const prompt of prompts) assert.equal(PROMPT.insertSection(prompt, ''), prompt);
    });

    test('insertSection(prompt, \'\') removes $CUSTOM_SKILLS (Amendment 1, A6)', () => {
        assert.equal(PROMPT.insertSection('A $CUSTOM_SKILLS B', ''), 'A  B');
    });
});

describe('flags off: a SkillManager', () => {
    let root;
    let cap;
    beforeEach(() => {
        root = makeTmpDir();
        cap = captureConsole();
    });
    afterEach(() => {
        cap.restore();
        removeTmpDir(root);
    });

    function offManager(settings) {
        return new MANAGER.SkillManager({
            name: 'andy', botsDir: root, settings, prompter: { promptSkillReview: async () => { throw new Error('must not be called'); } },
            makeCompartment: LOCK.makeCompartment, endowments: makeEndowments(), getInventoryCounts: inventoryOf,
            builtinNames: [], reviewTemplate: '$CODE', now: () => new Date(Date.UTC(2026, 8, 28)),
        });
    }

    for (const [label, settings] of OFF_SETTINGS) {
        test(`${label}: flags false, sections '', customSkills frozen and empty, capture_off, no file written`, async () => {
            const manager = offManager(settings);
            assert.deepEqual(manager.flags, OFF_FLAGS);
            assert.equal(manager.codingSection('build a wall'), '');
            assert.equal(manager.conversingSection(), '');
            assert.ok(Object.isFrozen(manager.customSkills));
            assert.deepEqual(Object.keys(manager.customSkills), []);
            assert.deepEqual(manager.knownNames(), []);
            const result = await manager.captureFromRun({ code: 'async function f(bot) {}\nawait f(bot);', output: '', task: 't', before: {}, after: {}, interrupted: false, threw: false });
            assert.equal(result.saved, false);
            assert.equal(result.reason, 'capture_off');
            assert.deepEqual(listFiles(root), []);
        });
    }
});

describe('the guard rule of the source checks: only the branch that runs with the manager is guarded', () => {
    const IMPORT = "import { insertSection } from '../agent/skills/skill_prompt.js';\n";
    const unguarded = (code) => analyseSkillGuardsInText(IMPORT + code).unguarded.map((u) => u.text);

    test('if (manager): the consequent is guarded, the else branch is not', () => {
        assert.deepEqual(unguarded("if (a.skill_manager) { a.skill_manager.one(); } else { a.skill_manager.two(); insertSection(p, ''); }"),
            ['a.skill_manager.two', "insertSection(p, '')"]);
    });

    test('if (!manager): the else branch is guarded, the consequent is not', () => {
        assert.deepEqual(unguarded('if (!a.skill_manager) { a.skill_manager.one(); } else { a.skill_manager.two(); }'), ['a.skill_manager.one']);
        assert.deepEqual(unguarded('if (a.skill_manager == null) { x(); } else { a.skill_manager.two(); }'), []);
        assert.deepEqual(unguarded("if (typeof manager === 'undefined') { x(); } else { manager.two(); }"), []);
    });

    test('?: works the same way; a positive test with != stays positive', () => {
        assert.deepEqual(unguarded('const v = a.skill_manager ? a.skill_manager.one() : a.skill_manager.two();'), ['a.skill_manager.two']);
        assert.deepEqual(unguarded('if (a.skill_manager != null && b) { a.skill_manager.one(); }'), []);
    });

    test('else if: a use in a nested if of the else branch needs its own guard', () => {
        assert.deepEqual(unguarded("if (a.skill_manager) { x(); } else if (p.includes('y')) { insertSection(p, ''); }"), ["insertSection(p, '')"]);
    });
});

describe('source text: every new call is guarded by the manager', () => {
    // prompter.js: without a manager, only a prompt with the placeholder is touched (A6). v0.1.4.6 puts
    // the rules of the players into the prompts with insertSection too, behind the rule store (R2):
    // that guard counts as well (tests/unit/glue_flags_off.test.js checks it on its own).
    const PROMPTER_OPTIONS = { tryRequired: ['codingSection', 'conversingSection'], guardPattern: /manager|\$CUSTOM_SKILLS|rule_store/ };
    const FILES = [
        ['src/agent/coder.js', {}],
        ['src/models/prompter.js', PROMPTER_OPTIONS],
        ['src/agent/commands/actions.js', { tryRequired: ['captureFromRun', 'takeNotices'] }],
        ['src/agent/commands/queries.js', {}],
    ];
    for (const [file, options] of FILES) {
        test(`${file}: uses the skill manager, and every use is guarded`, () => {
            const result = analyseSkillGuards(file, options);
            assert.ok(result.uses.length > 0, `${file} does not use the skill manager yet`);
            assert.deepEqual(result.unguarded, [], `unguarded uses in ${file}`);
        });
    }

    test('src/models/prompter.js: without a manager only insertSection(prompt, \'\') runs, and only behind a check for $CUSTOM_SKILLS (A6)', () => {
        // With the manager (and the rule store of v0.1.4.6) as the only guard, exactly the two removals
        // of the placeholder are left over.
        const managerOnly = analyseSkillGuards('src/models/prompter.js', { tryRequired: PROMPTER_OPTIONS.tryRequired, guardPattern: /manager|rule_store/ });
        assert.deepEqual(managerOnly.unguarded.map((u) => u.text), ["insertSection(prompt, '')", "insertSection(prompt, '')"]);
        const lines = readRepoFile('src/models/prompter.js').split(/\r?\n/);
        for (const use of managerOnly.unguarded) {
            assert.match(lines[use.line - 2], /else if \(.*\.includes\('\$CUSTOM_SKILLS'\)\)/, `line ${use.line - 1} checks the placeholder`);
        }
    });

    test('src/models/prompter.js: both prompt additions are wrapped in try', () => {
        const result = analyseSkillGuards('src/models/prompter.js', PROMPTER_OPTIONS);
        const names = result.uses.map((u) => u.name);
        assert.ok(names.includes('codingSection'), `uses: ${names}`);
        assert.ok(names.includes('conversingSection'), `uses: ${names}`);
        assert.ok(names.includes('insertSection'), `uses: ${names}`);
        assert.deepEqual(result.notInTry, []);
    });

    test('src/agent/commands/actions.js: captureFromRun of !newAction is wrapped in try', () => {
        const result = analyseSkillGuards('src/agent/commands/actions.js', { tryRequired: ['captureFromRun'] });
        assert.ok(result.uses.some((u) => u.name === 'captureFromRun'), 'captureFromRun is called');
        assert.deepEqual(result.notInTry, []);
    });

    test('src/agent/commands/actions.js: takeNotices() is called only behind the manager guard and inside try (v0.1.4.5, G1)', () => {
        const result = analyseSkillGuards('src/agent/commands/actions.js', { tryRequired: ['takeNotices'] });
        assert.ok(result.uses.some((u) => u.name === 'takeNotices'), 'takeNotices is called');
        assert.deepEqual(result.unguarded, []);
        assert.deepEqual(result.notInTry, []);
    });

    test('src/agent/coder.js: the snapshot is taken through the manager', () => {
        const result = analyseSkillGuards('src/agent/coder.js');
        assert.ok(result.uses.some((u) => u.name === 'snapshot'), `uses: ${result.uses.map((u) => u.name)}`);
        assert.ok(readRepoFile('src/agent/coder.js').includes('skill_manager'));
    });

    test('src/agent/agent.js: new SkillManager and init() only when a flag is on, inside try', () => {
        const options = { guardPattern: /manager|flag|capture|reuse|command|skill/i, exempt: ['skillFlags'], tryRequired: ['SkillManager', 'init'] };
        const result = analyseSkillGuards('src/agent/agent.js', options);
        const names = result.uses.map((u) => u.name);
        assert.ok(names.includes('SkillManager'), `uses: ${names}`);
        assert.ok(names.includes('init'), `uses: ${names}`);
        assert.deepEqual(result.unguarded, []);
        assert.deepEqual(result.notInTry, []);
    });

    test('src/agent/agent.js: the five skill commands are named for blocked_actions', () => {
        const text = readRepoFile('src/agent/agent.js');
        for (const name of ['!skills', '!forgetSkill', '!disableSkill', '!enableSkill', '!useSkill']) {
            assert.ok(text.includes(`'${name}'`) || text.includes(`"${name}"`), name);
        }
    });
});
