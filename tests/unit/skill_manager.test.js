// Spec v0.1.4.4 K7: src/agent/skills/skill_manager.js -- SkillManager and skillFlags.
//
// Uses the real makeCompartment of src/agent/library/lockdown.js WITHOUT calling the lockdown,
// the fake endowments of spec K9 (tests/helpers/skill_env.js), a temp directory as botsDir and a
// fake prompter whose promptSkillReview returns canned text. Skills are seeded with the real
// SkillStore in <botsDir>/andy/skills. init() is awaited: awaiting a plain number changes nothing.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir, listDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { makeEndowments, makeBot, inventoryOf, fnSource } from '../helpers/skill_env.js';
import { assertSkillModuleImports } from '../helpers/source_ast.js';
import { assertCleanImport } from '../helpers/module_rules.js';

const MODULE = 'src/agent/skills/skill_manager.js';
const M = await loadSrc(MODULE);
const SRC = await loadSrc('src/agent/skills/skill_source.js');
const STORE = await loadSrc('src/agent/skills/skill_store.js');
const PROMPT = await loadSrc('src/agent/skills/skill_prompt.js');
const REVIEW = await loadSrc('src/agent/skills/skill_review.js');
const LOCK = await loadSrc('src/agent/library/lockdown.js');

const T0 = Date.UTC(2026, 8, 28, 12, 0, 0);
const iso = (ms) => new Date(ms).toISOString();
const lines = (...l) => l.join('\n');
const ON = Object.freeze({ allow_insecure_coding: true, skill_learning: true });
const TEMPLATE = 'NAME=<$NAME>\nTASK=<$TASK>\nCODE=<$CODE>\nOUTPUT=<$OUTPUT>\nSTATE=<$STATE_CHANGE>\nLIST=<$SKILL_LIST>';
const REVIEW_DESC = 'Builds a dirt wall of the given length.';
const reviewReply = (overrides = {}) => '```json\n' + JSON.stringify({ achieved: true, reusable: true, description: REVIEW_DESC, reason: 'It has a length parameter.', ...overrides }) + '\n```';

const GOOD_FN = lines(
    'async function buildDirtWall(bot, length) {',
    '    /**',
    '     * Builds a wall of dirt of the given length.',
    '     * @param {MinecraftBot} bot, reference to the minecraft bot.',
    '     * @param {number} length, how many blocks.',
    '     **/',
    '    for (let i = 0; i < length; i++) {',
    '        await skills.wait(bot, 1);',
    '    }',
    '    return true;',
    '}',
);
const GOOD_CODE = GOOD_FN + '\nawait buildDirtWall(bot, 3);';
const NO_DOC_FN = lines(
    'async function buildDirtWall(bot, length) {',
    '    for (let i = 0; i < length; i++) {',
    '        await skills.wait(bot, 1);',
    '    }',
    '    return true;',
    '}',
);
// A doc block whose first doc line is an @ line: it gives no description (Amendment 1, A4).
const AT_ONLY_FN = lines(
    'async function buildDirtWall(bot, length) {',
    '    /**',
    '     * @param {MinecraftBot} bot, reference to the minecraft bot.',
    '     * @param {number} length, how many blocks.',
    '     **/',
    '    for (let i = 0; i < length; i++) {',
    '        await skills.wait(bot, 1);',
    '    }',
    '    return true;',
    '}',
);
const V2_FN = GOOD_FN.replace('return true;', 'return "v2";');
const CREATED_MSG = 'Saved this code as the skill customSkills.buildDirtWall. You can call it in later code.';
const UPDATED_MSG = 'Updated the saved skill customSkills.buildDirtWall.';
// Amendment 1, A3: without reuse the skill cannot be called, so the message does not say so.
const CREATED_MSG_NO_REUSE = 'Saved this code as the skill buildDirtWall.';
const UPDATED_MSG_NO_REUSE = 'Updated the saved skill buildDirtWall.';

const ADD_UP = fnSource('addUp', ['/**', ' * Adds two numbers.', ' **/', 'return a + b;'], 'bot, a, b');
const DIG_HOLE = fnSource('digHole', ['/**', ' * Digs a hole.', ' **/', 'return depth > 0;'], 'bot, depth');
const FAILING = fnSource('failingSkill', ['/**', ' * Always fails.', ' **/', 'throw new Error("boom");']);
const PROBE = fnSource('probeSkill', ['/**', ' * Probes the sandbox.', ' **/', 'return [typeof process, typeof require, typeof globalThis.process].join(",");']);
const INNER = fnSource('innerSkill', ['/**', ' * Inner.', ' **/', 'return 41;']);
const OUTER = fnSource('outerSkill', ['/**', ' * Outer.', ' **/', 'return (await customSkills.innerSkill(bot)) + 1;']);
const BROKEN = 'async function brokenSkill(bot) {\n    /** Broken. */\n    return (;\n}\n';

let root;
let cap;
let clock;
beforeEach(() => {
    root = makeTmpDir();
    cap = captureConsole();
    clock = T0;
});
afterEach(() => {
    cap.restore();
    removeTmpDir(root);
});

const storeDir = () => path.join(root, 'andy', 'skills');

function makePrompter(replies = [reviewReply()]) {
    const prompter = {
        calls: [],
        async promptSkillReview(text, ...rest) {
            prompter.calls.push({ text, rest });
            const reply = replies[Math.min(prompter.calls.length - 1, replies.length - 1)];
            if (reply instanceof Error) throw reply;
            return reply;
        },
    };
    return prompter;
}

function newManager({ settings = ON, prompter = makePrompter(), builtinNames = [], reviewTemplate = TEMPLATE, makeCompartment = LOCK.makeCompartment, botsDir = root } = {}) {
    assert.equal(typeof M.SkillManager, 'function', 'SkillManager must be an exported class');
    const manager = new M.SkillManager({
        name: 'andy', botsDir, settings, prompter, makeCompartment, endowments: makeEndowments(),
        getInventoryCounts: inventoryOf, builtinNames, reviewTemplate, now: () => new Date(clock),
    });
    return { manager, prompter };
}
async function ready(options) {
    const made = newManager(options);
    made.initResult = await made.manager.init();
    return made;
}

// Saves skills with the real store, like an earlier session would have.
function seed(skills) {
    const store = new STORE.SkillStore(storeDir(), { now: () => new Date(clock) });
    store.load();
    for (const { source, description, status } of skills) {
        const fn = SRC.parseGeneratedCode(source).functions[0];
        store.save({ name: fn.name, source, description, signature: SRC.signatureOf(fn), sourceTask: 'seeded' });
        if (status) store.setStatus(fn.name, status);
    }
    return store;
}
const SEED_TWO = [{ source: ADD_UP, description: 'Adds two numbers.' }, { source: DIG_HOLE, description: 'Digs a hole.' }];

// brokenSkill is active in the store, but its file on disk has a syntax error, so the loader skips it.
function seedBroken(others = []) {
    seed([...others, { source: BROKEN.replace('return (;', 'return true;'), description: 'Broken.' }]);
    fs.writeFileSync(path.join(storeDir(), 'brokenSkill.js'), BROKEN);
}

function makeRun(overrides = {}) {
    return {
        code: GOOD_CODE,
        output: 'Wall built.',
        task: 'build a dirt wall of length 3',
        before: { inventory: {}, position: { x: 0, y: 64, z: 0 }, health: 20, food: 20 },
        after: { inventory: { dirt: 3 }, position: { x: 0, y: 64, z: 0 }, health: 20, food: 20 },
        interrupted: false,
        threw: false,
        ...overrides,
    };
}

function assertStopped(result, reason) {
    assert.equal(result.saved, false, JSON.stringify(result));
    assert.equal(result.reason, reason, JSON.stringify(result));
    assert.equal(result.message, '');
}

const isFrozenEmpty = (obj) => obj !== null && typeof obj === 'object' && Object.isFrozen(obj) && Object.keys(obj).length === 0;

describe('flags and construction', () => {
    test('flags is skillFlags(settings)', () => {
        for (const settings of [{}, ON, { ...ON, skill_capture: false }, { ...ON, skill_reuse: false, skill_command: true }, { ...ON, skill_command: true }, { skill_learning: true }]) {
            const { manager } = newManager({ settings });
            assert.deepEqual(manager.flags, M.skillFlags(settings), JSON.stringify(settings));
        }
        assert.deepEqual(newManager({ settings: ON }).manager.flags, { capture: true, reuse: true, command: false });
    });

    test('customSkills before init is a frozen empty object', () => {
        const { manager } = newManager();
        assert.ok(isFrozenEmpty(manager.customSkills));
        assert.deepEqual(manager.knownNames(), []);
    });

    test('the store directory is <botsDir>/<name>/skills', async () => {
        seed(SEED_TWO);
        const { initResult, manager } = await ready();
        assert.equal(initResult, 2);
        assert.equal(typeof manager.customSkills.addUp, 'function');
    });
});

describe('init()', () => {
    test('loads the store and, with reuse, the active skills into the sandbox; returns the number loaded', async () => {
        seed([...SEED_TWO, { source: INNER, description: 'Inner.', status: 'disabled' }]);
        const { manager, initResult } = await ready();
        assert.equal(initResult, 2);
        assert.deepEqual(manager.knownNames(), ['customSkills.addUp', 'customSkills.digHole']);
        assert.equal(Object.isFrozen(manager.customSkills), true);
        assert.deepEqual(Object.keys(manager.customSkills).sort(), ['addUp', 'digHole']);
    });

    test('a broken skill on disk is skipped, the others load', async () => {
        // the store saves a valid skill, then the file on disk is replaced by one with a syntax error
        seed([...SEED_TWO, { source: BROKEN.replace('return (;', 'return true;'), description: 'Broken.' }]);
        fs.writeFileSync(path.join(storeDir(), 'brokenSkill.js'), BROKEN);
        const { manager, initResult } = await ready();
        assert.equal(initResult, 2);
        assert.deepEqual(manager.knownNames(), ['customSkills.addUp', 'customSkills.digHole']);
    });

    test('a skill file put into the folder by hand that runs code at load time is skipped, the others load (Amendment 2, B2)', async () => {
        seed([...SEED_TWO, { source: fnSource('aaaSkill', ['/**', ' * Harmless.', ' **/', 'return 1;']), description: 'Harmless.' }]);
        const hostile = 'async function aaaSkill(bot) { return 1; }) && (customSkills.digHole = async function digHole() { return "replaced"; }, customSkills.extra = async function extra() { return "extra"; }, true) && (async function aaaSkill(bot) { return 1; }';
        fs.writeFileSync(path.join(storeDir(), 'aaaSkill.js'), hostile);
        const { manager, initResult } = await ready();
        assert.equal(initResult, 2);
        assert.deepEqual(manager.knownNames(), ['customSkills.addUp', 'customSkills.digHole']);
        assert.equal(manager.customSkills.extra, undefined);
        assert.equal((await manager.run('digHole', [2], makeBot())).result, true, 'the real digHole');
        assert.ok(manager.listText().includes('- aaaSkill(bot): Harmless. (used 0 times, 0 failed) [broken]'), manager.listText());
        assert.ok(cap.of('warn').some((r) => r.text.includes('aaaSkill') && r.text.includes('not a single function')));
    });

    test('reuse off: nothing is loaded into a sandbox, customSkills stays frozen and empty, returns 0', async () => {
        seed(SEED_TWO);
        let compartments = 0;
        const makeCompartment = (e) => {
            compartments++;
            return LOCK.makeCompartment(e);
        };
        const { manager, initResult } = await ready({ settings: { ...ON, skill_reuse: false }, makeCompartment });
        assert.equal(initResult, 0);
        assert.equal(compartments, 0);
        assert.ok(isFrozenEmpty(manager.customSkills));
        assert.deepEqual(manager.knownNames(), []);
        assert.equal(manager.listText().startsWith('Saved skills:'), true, 'the store is loaded');
    });

    test('never throws: botsDir is a file', async () => {
        const blocker = path.join(root, 'blocker');
        fs.writeFileSync(blocker, 'x');
        const { manager } = newManager({ botsDir: blocker });
        let count;
        await assert.doesNotReject(async () => {
            count = await manager.init();
        });
        assert.equal(count, 0);
    });

    test('never throws: makeCompartment throws', async () => {
        seed(SEED_TWO);
        const makeCompartment = () => {
            throw new Error('no sandbox');
        };
        const { manager } = newManager({ makeCompartment });
        let count;
        await assert.doesNotReject(async () => {
            count = await manager.init();
        });
        assert.equal(count, 0);
        assert.equal(typeof manager.customSkills, 'object');
    });
});

describe('run(name, args, bot)', () => {
    test('calls the loaded skill with bot and the arguments: { ok: true, result }', async () => {
        seed(SEED_TWO);
        const { manager } = await ready();
        const result = await manager.run('addUp', [2, 3], makeBot());
        assert.equal(result.ok, true);
        assert.equal(result.result, 5);
    });

    test("unknown skill: ok false, error 'unknown_skill'", async () => {
        seed(SEED_TWO);
        const { manager } = await ready();
        for (const name of ['nothingHere', 'toString', 'constructor', 'hasOwnProperty', '__proto__', '../evil', '']) {
            const result = await manager.run(name, [], makeBot());
            assert.equal(result.ok, false, name);
            assert.equal(result.error, 'unknown_skill', name);
        }
    });

    test("disabled skill: ok false, error 'unknown_skill'", async () => {
        seed([...SEED_TWO, { source: INNER, description: 'Inner.', status: 'disabled' }]);
        const { manager } = await ready();
        const result = await manager.run('innerSkill', [], makeBot());
        assert.equal(result.ok, false);
        assert.equal(result.error, 'unknown_skill');
    });

    test('a throw of the skill: ok false, error is the text', async () => {
        seed([{ source: FAILING, description: 'Always fails.' }]);
        const { manager } = await ready();
        const result = await manager.run('failingSkill', [], makeBot());
        assert.equal(result.ok, false);
        assert.equal(typeof result.error, 'string');
        assert.ok(result.error.includes('boom'), result.error);
    });

    test('skills can call each other; a skill cannot reach process, require or globalThis.process', async () => {
        seed([{ source: INNER, description: 'Inner.' }, { source: OUTER, description: 'Outer.' }, { source: PROBE, description: 'Probes.' }]);
        const { manager } = await ready();
        assert.equal((await manager.run('outerSkill', [], makeBot())).result, 42);
        assert.equal((await manager.run('probeSkill', [], makeBot())).result, 'undefined,undefined,undefined');
    });

    test('never throws', async () => {
        seed(SEED_TWO);
        const { manager } = await ready();
        await assert.doesNotReject(async () => {
            const r1 = await manager.run(undefined, undefined, undefined);
            assert.equal(r1.ok, false);
            await manager.run('addUp', 'not an array', makeBot());
            await manager.run('addUp', null, null);
            await manager.run({}, {}, {});
        });
        const { manager: empty } = newManager();
        await assert.doesNotReject(async () => {
            assert.equal((await empty.run('addUp', [1, 2], makeBot())).error, 'unknown_skill');
        });
    });
});

describe('listText()', () => {
    test("no skills: 'No skills are saved yet.'", async () => {
        const { manager } = await ready();
        assert.equal(manager.listText(), 'No skills are saved yet.');
    });

    test('one line per skill with counters; [disabled] for a disabled skill', async () => {
        seed([...SEED_TWO, { source: INNER, description: 'Inner.', status: 'disabled' }]);
        const { manager } = await ready();
        assert.equal(manager.listText(), [
            'Saved skills:',
            '- addUp(bot, a, b): Adds two numbers. (used 0 times, 0 failed)',
            '- digHole(bot, depth): Digs a hole. (used 0 times, 0 failed)',
            '- innerSkill(bot): Inner. (used 0 times, 0 failed) [disabled]',
        ].join('\n'));
    });

    test('runs of a skill are counted (the usage wrapper records into the store)', async () => {
        seed(SEED_TWO);
        const { manager } = await ready();
        const bot = makeBot();
        await manager.run('addUp', [1, 2], bot);
        await manager.run('addUp', [3, 4], bot);
        await manager.run('digHole', [0], bot); // returns false: a failure
        assert.equal(manager.listText(), [
            'Saved skills:',
            '- addUp(bot, a, b): Adds two numbers. (used 2 times, 0 failed)',
            '- digHole(bot, depth): Digs a hole. (used 1 times, 1 failed)',
        ].join('\n'));
    });
});

describe('forget(name) and setStatus(name, status)', () => {
    test('forget: removes through the store and reloads; true if it existed', async () => {
        seed(SEED_TWO);
        const { manager } = await ready();
        assert.equal(manager.forget('addUp'), true);
        assert.deepEqual(manager.knownNames(), ['customSkills.digHole']);
        assert.equal(manager.customSkills.addUp, undefined);
        assert.equal((await manager.run('addUp', [1, 2], makeBot())).error, 'unknown_skill');
        assert.equal(fs.existsSync(path.join(storeDir(), 'addUp.js')), false);
        assert.deepEqual(listDir(path.join(storeDir(), '.history')), ['addUp.removed-20260928-120000.js']);
        assert.equal(manager.forget('addUp'), false);
        assert.equal(manager.forget('../evil'), false);
        assert.equal(manager.forget(undefined), false);
    });

    test('setStatus: through the store, then reloads; true on success', async () => {
        seed(SEED_TWO);
        const { manager } = await ready();
        assert.equal(manager.setStatus('addUp', 'disabled'), true);
        assert.deepEqual(manager.knownNames(), ['customSkills.digHole']);
        assert.equal((await manager.run('addUp', [1, 2], makeBot())).error, 'unknown_skill');
        assert.ok(manager.listText().includes('- addUp(bot, a, b): Adds two numbers. (used 0 times, 0 failed) [disabled]'));

        assert.equal(manager.setStatus('addUp', 'active'), true);
        assert.deepEqual(manager.knownNames(), ['customSkills.addUp', 'customSkills.digHole']);
        assert.equal((await manager.run('addUp', [1, 2], makeBot())).result, 3);
    });

    test('setStatus: false for an unknown skill or status', async () => {
        seed(SEED_TWO);
        const { manager } = await ready();
        assert.equal(manager.setStatus('nothingHere', 'disabled'), false);
        assert.equal(manager.setStatus('addUp', 'deleted'), false);
        assert.equal(manager.setStatus('../evil', 'active'), false);
        assert.deepEqual(manager.knownNames(), ['customSkills.addUp', 'customSkills.digHole']);
    });
});

describe('skillInfos, codingSection, conversingSection, snapshot', () => {
    test('skillInfos: the entries of the store with doc, the doc text of the source', async () => {
        seed([...SEED_TWO, { source: INNER, description: 'Inner.', status: 'disabled' }]);
        const { manager } = await ready();
        const infos = manager.skillInfos();
        assert.deepEqual(infos.map((i) => i.name).sort(), ['addUp', 'digHole', 'innerSkill']);
        const add = infos.find((i) => i.name === 'addUp');
        assert.equal(add.doc, SRC.getDocBlock(ADD_UP).text);
        assert.equal(add.signature, 'addUp(bot, a, b)');
        assert.equal(add.status, 'active');
        assert.equal(infos.find((i) => i.name === 'innerSkill').status, 'disabled');
    });

    test('codingSection(task) and conversingSection() use the prompt builders with the flags and the skills', async () => {
        seed(SEED_TWO);
        for (const settings of [ON, { ...ON, skill_command: true }, { ...ON, skill_capture: false }, { ...ON, skill_reuse: false }]) {
            const { manager } = await ready({ settings });
            const task = 'add two numbers';
            assert.equal(manager.codingSection(task), PROMPT.buildCodingSection({ flags: manager.flags, skills: manager.skillInfos(), task }), JSON.stringify(settings));
            assert.equal(manager.conversingSection(), PROMPT.buildConversingSection({ flags: manager.flags, skills: manager.skillInfos() }), JSON.stringify(settings));
        }
        const { manager } = await ready({ settings: { ...ON, skill_command: true } });
        assert.ok(manager.codingSection('add two numbers').includes('### customSkills.addUp'));
        assert.ok(manager.conversingSection().includes('!useSkill'));
    });

    test('skillInfos still returns every entry of the store, also one that did not load', async () => {
        seedBroken([...SEED_TWO, { source: INNER, description: 'Inner.', status: 'disabled' }]);
        const { manager } = await ready();
        assert.deepEqual(manager.skillInfos().map((i) => i.name), ['addUp', 'brokenSkill', 'digHole', 'innerSkill']);
    });

    test('snapshot(bot) is snapshotState(bot, getInventoryCounts)', async () => {
        const { manager } = await ready();
        const bot = makeBot({ inv: { dirt: 4 }, health: 15, food: 9 });
        assert.deepEqual(manager.snapshot(bot), REVIEW.snapshotState(bot, inventoryOf));
        assert.deepEqual(manager.snapshot(bot), { inventory: { dirt: 4 }, position: { x: 0, y: 64, z: 0 }, health: 15, food: 9 });
    });
});

describe('only skills that can be called are offered (Amendment 1, A2)', () => {
    const TASK = 'use a broken skill';

    test('codingSection and conversingSection leave out an active skill that the loader skipped', async () => {
        seedBroken(SEED_TWO);
        const { manager } = await ready({ settings: { ...ON, skill_command: true } });
        assert.deepEqual(manager.knownNames(), ['customSkills.addUp', 'customSkills.digHole'], 'precondition: brokenSkill did not load');
        const callable = manager.skillInfos().filter((i) => i.name !== 'brokenSkill');

        const coding = manager.codingSection(TASK);
        assert.ok(!coding.includes('brokenSkill'), coding);
        assert.ok(coding.includes('### customSkills.addUp'), coding);
        assert.equal(coding, PROMPT.buildCodingSection({ flags: manager.flags, skills: callable, task: TASK }));

        const conversing = manager.conversingSection();
        assert.ok(!conversing.includes('brokenSkill'), conversing);
        assert.ok(conversing.includes('- addUp(bot, a, b): Adds two numbers.'), conversing);
        assert.equal(conversing, PROMPT.buildConversingSection({ flags: manager.flags, skills: callable }));
    });

    test('no skill loaded: the coding section says "No skills are saved yet.", the conversing section is empty', async () => {
        seedBroken();
        const { manager } = await ready();
        assert.equal(manager.codingSection(TASK), PROMPT.buildCodingSection({ flags: manager.flags, skills: [], task: TASK }));
        assert.ok(manager.codingSection(TASK).includes('No skills are saved yet.'));
        assert.equal(manager.conversingSection(), '');
    });

    test('a skill disabled after loading is left out too', async () => {
        seed(SEED_TWO);
        const { manager } = await ready();
        manager.setStatus('addUp', 'disabled');
        assert.ok(!manager.codingSection('add two numbers').includes('addUp'));
        assert.ok(!manager.conversingSection().includes('addUp'));
    });

    test('listText shows every skill of the store and marks an active skill that did not load with [broken]', async () => {
        seedBroken([...SEED_TWO, { source: INNER, description: 'Inner.', status: 'disabled' }]);
        const { manager } = await ready();
        assert.equal(manager.listText(), [
            'Saved skills:',
            '- addUp(bot, a, b): Adds two numbers. (used 0 times, 0 failed)',
            '- brokenSkill(bot): Broken. (used 0 times, 0 failed) [broken]',
            '- digHole(bot, depth): Digs a hole. (used 0 times, 0 failed)',
            '- innerSkill(bot): Inner. (used 0 times, 0 failed) [disabled]',
        ].join('\n'));
    });

    test('reuse off: nothing is loaded by design, so no skill is marked [broken]', async () => {
        seedBroken(SEED_TWO);
        const { manager } = await ready({ settings: { ...ON, skill_reuse: false } });
        assert.ok(!manager.listText().includes('[broken]'), manager.listText());
        assert.ok(manager.listText().includes('- brokenSkill(bot): Broken. (used 0 times, 0 failed)'));
    });
});

describe('has(name) (Amendment 1, A5)', () => {
    test('true for a loaded skill; false for an unknown, disabled or skipped skill and for names of Object.prototype', async () => {
        seedBroken([...SEED_TWO, { source: INNER, description: 'Inner.', status: 'disabled' }]);
        const { manager } = await ready();
        assert.equal(manager.has('addUp'), true);
        assert.equal(manager.has('digHole'), true);
        for (const name of ['innerSkill', 'brokenSkill', 'nothingHere', 'toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf', 'customSkills.addUp', '', '../evil', undefined, null, 42, {}, ['addUp']]) {
            assert.equal(manager.has(name), false, String(name));
        }
    });

    test('follows setStatus and forget', async () => {
        seed(SEED_TWO);
        const { manager } = await ready();
        manager.setStatus('addUp', 'disabled');
        assert.equal(manager.has('addUp'), false);
        manager.setStatus('addUp', 'active');
        assert.equal(manager.has('addUp'), true);
        manager.forget('addUp');
        assert.equal(manager.has('addUp'), false);
    });

    test('a newly captured skill is known at once', async () => {
        const { manager } = await ready();
        assert.equal(manager.has('buildDirtWall'), false);
        assert.equal((await manager.captureFromRun(makeRun())).saved, true);
        assert.equal(manager.has('buildDirtWall'), true);
    });

    test('before init and with reuse off: false', async () => {
        seed(SEED_TWO);
        assert.equal(newManager().manager.has('addUp'), false);
        const { manager } = await ready({ settings: { ...ON, skill_reuse: false } });
        assert.equal(manager.has('addUp'), false);
    });
});

describe('captureFromRun(run): the steps', () => {
    test("step 1: capture off -> 'capture_off'", async () => {
        for (const settings of [{ ...ON, skill_capture: false }, { ...ON, skill_learning: false }, { ...ON, allow_insecure_coding: false }]) {
            const { manager, prompter } = await ready({ settings });
            assertStopped(await manager.captureFromRun(makeRun()), 'capture_off');
            assert.equal(prompter.calls.length, 0);
        }
    });

    test("step 2: run.interrupted -> 'interrupted'", async () => {
        const { manager, prompter } = await ready();
        assertStopped(await manager.captureFromRun(makeRun({ interrupted: true, threw: true })), 'interrupted');
        assert.equal(prompter.calls.length, 0);
    });

    test("step 3: run.threw -> 'threw'", async () => {
        const { manager, prompter } = await ready();
        assertStopped(await manager.captureFromRun(makeRun({ threw: true, code: '' })), 'threw');
        assert.equal(prompter.calls.length, 0);
    });

    for (const [label, code] of [['empty', ''], ['//no response', '//no response'], ['missing', undefined]]) {
        test(`step 4: code ${label} -> 'no_code'`, async () => {
            const { manager, prompter } = await ready();
            assertStopped(await manager.captureFromRun(makeRun({ code })), 'no_code');
            assert.equal(prompter.calls.length, 0);
        });
    }

    const PICKER = [
        ['parse_error', 'async function buildDirtWall(bot) {'],
        ['no_function', 'await skills.wait(bot, 1);'],
        ['several_functions', GOOD_FN + '\nasync function other(bot) {}\nawait buildDirtWall(bot, 3);'],
        ['not_async', 'function buildDirtWall(bot) {\n    return true;\n}\nbuildDirtWall(bot);'],
        ['first_parameter_not_bot', 'async function buildDirtWall(b) {\n    return true;\n}\nawait buildDirtWall(bot);'],
        ['not_called', GOOD_FN],
    ];
    for (const [reason, code] of PICKER) {
        test(`step 5: no candidate -> the reason of the picker, '${reason}'`, async () => {
            const { manager, prompter } = await ready();
            assertStopped(await manager.captureFromRun(makeRun({ code })), reason);
            assert.equal(prompter.calls.length, 0);
        });
    }

    const REVIEW_FAILS = [
        ['the review call throws', () => ({ promptSkillReview() { throw new Error('model down'); } })],
        ['the review call rejects', () => makePrompter([new Error('model down')])],
        ['a model error text', () => makePrompter(['My brain disconnected, try again.'])],
        ['no JSON', () => makePrompter(['Looks good to me.'])],
        ['achieved not a boolean', () => makePrompter([reviewReply({ achieved: 'yes' })])],
        ['no prompter', () => null],
        ['a prompter without promptSkillReview', () => ({})],
    ];
    for (const [label, makeFake] of REVIEW_FAILS) {
        test(`step 6: ${label} -> 'review_failed'`, async () => {
            const { manager } = await ready({ prompter: makeFake() });
            assertStopped(await manager.captureFromRun(makeRun()), 'review_failed');
            assert.equal(fs.existsSync(path.join(storeDir(), 'buildDirtWall.js')), false);
        });
    }

    test("step 7: achieved false -> 'not_achieved'", async () => {
        const { manager } = await ready({ prompter: makePrompter([reviewReply({ achieved: false, reusable: true })]) });
        assertStopped(await manager.captureFromRun(makeRun()), 'not_achieved');
    });

    test("step 8: reusable false -> 'not_reusable'", async () => {
        const { manager } = await ready({ prompter: makePrompter([reviewReply({ reusable: false })]) });
        assertStopped(await manager.captureFromRun(makeRun()), 'not_reusable');
        assert.deepEqual(listDir(storeDir()).filter((f) => f.endsWith('.js')), []);
    });

    // Amendment 1, A4: new step between step 8 and step 9.
    const EMPTY_DESCRIPTIONS = [['an empty description', ''], ['only spaces', '   '], ['no description key', undefined]];
    for (const [label, description] of EMPTY_DESCRIPTIONS) {
        test(`step 8a: no own doc block and a review with ${label} -> 'no_description', nothing saved`, async () => {
            const { manager, prompter } = await ready({ prompter: makePrompter([reviewReply({ description })]) });
            const result = await manager.captureFromRun(makeRun({ code: NO_DOC_FN + '\nawait buildDirtWall(bot, 3);' }));
            assertStopped(result, 'no_description');
            assert.equal(result.action, null);
            assert.deepEqual(result.errors, []);
            assert.equal(result.name, 'buildDirtWall');
            assert.equal(prompter.calls.length, 1);
            assert.deepEqual(listDir(storeDir()).filter((f) => f.endsWith('.js')), []);
            assert.deepEqual(manager.skillInfos(), []);
        });
    }

    test("step 8a: an own doc block with only @ lines and an empty review description -> 'no_description'", async () => {
        const { manager } = await ready({ prompter: makePrompter([reviewReply({ description: '' })]) });
        const result = await manager.captureFromRun(makeRun({ code: AT_ONLY_FN + '\nawait buildDirtWall(bot, 3);' }));
        assertStopped(result, 'no_description');
        assert.equal(fs.existsSync(path.join(storeDir(), 'buildDirtWall.js')), false);
    });

    test("step 8a comes before step 9: an invalid skill without a description stops with 'no_description'", async () => {
        const { manager } = await ready({ builtinNames: ['buildDirtWall'], prompter: makePrompter([reviewReply({ description: '' })]) });
        const result = await manager.captureFromRun(makeRun({ code: NO_DOC_FN + '\nawait buildDirtWall(bot, 3);' }));
        assertStopped(result, 'no_description');
        assert.deepEqual(result.errors, []);
    });

    test("step 9: validateSkill fails (a builtin name) -> 'invalid' with errors", async () => {
        const { manager, prompter } = await ready({ builtinNames: ['placeBlock', 'buildDirtWall'] });
        const result = await manager.captureFromRun(makeRun());
        assertStopped(result, 'invalid');
        assert.ok(Array.isArray(result.errors));
        assert.ok(result.errors.some((e) => e.code === 'name_builtin'), JSON.stringify(result.errors));
        assert.equal(prompter.calls.length, 1, 'the review comes before the validation');
        assert.equal(fs.existsSync(path.join(storeDir(), 'buildDirtWall.js')), false);
    });

    test("step 9: validateSkill fails (hard coded coordinates) -> 'invalid' with errors", async () => {
        const code = GOOD_FN.replace('await skills.wait(bot, 1);', 'await skills.goToPosition(bot, 120, 64, -30);') + '\nawait buildDirtWall(bot, 3);';
        const { manager } = await ready();
        const result = await manager.captureFromRun(makeRun({ code }));
        assertStopped(result, 'invalid');
        assert.ok(result.errors.some((e) => e.code === 'hard_coded_coordinates'), JSON.stringify(result.errors));
    });

    test("step 9: the function reads a constant of the code around it -> 'invalid' with undefined_name (Amendment 2, B3)", async () => {
        // the case of the end-to-end tests: only the function is saved, so SIZE does not exist in later runs
        const code = 'const SIZE = 3;\n' + GOOD_FN.replace('i < length', 'i < SIZE') + '\nawait buildDirtWall(bot, 3);';
        const { manager } = await ready();
        const result = await manager.captureFromRun(makeRun({ code }));
        assertStopped(result, 'invalid');
        assert.deepEqual(result.errors.map((e) => e.code), ['undefined_name']);
        assert.ok(result.errors[0].message.includes('SIZE'), result.errors[0].message);
        assert.equal(fs.existsSync(path.join(storeDir(), 'buildDirtWall.js')), false);
    });

    test("the store refuses the name (it differs from a saved skill only in case) -> 'save_failed', the old skill stays", async () => {
        seed([{ source: GOOD_FN.replace('buildDirtWall', 'buildDirtwall'), description: 'The old one.' }]);
        const { manager } = await ready();
        const result = await manager.captureFromRun(makeRun());
        assertStopped(result, 'save_failed');
        assert.equal(result.action, null);
        assert.deepEqual(result.errors, []);
        assert.deepEqual(manager.skillInfos().map((i) => i.name), ['buildDirtwall']);
        assert.equal(manager.has('buildDirtwall'), true);
    });

    test("the history folder is a file: an update ends with 'save_failed', the old version stays loaded (Amendment 2, B1)", async () => {
        const { manager } = await ready();
        assert.equal((await manager.captureFromRun(makeRun())).saved, true);
        fs.writeFileSync(path.join(storeDir(), '.history'), 'a file where the history folder should be');
        const result = await manager.captureFromRun(makeRun({ code: V2_FN + '\nawait buildDirtWall(bot, 3);' }));
        assertStopped(result, 'save_failed');
        assert.equal(result.action, null);
        assert.equal(manager.skillInfos()[0].version, 1);
        assert.equal((await manager.run('buildDirtWall', [1], makeBot())).result, true, 'still the first version');
    });

    test("store.save gives no known action -> 'save_failed'", async () => {
        const { manager } = await ready();
        manager.store.save = () => ({ action: 'something else' });
        assertStopped(await manager.captureFromRun(makeRun()), 'save_failed');
    });

    test("step 10: store.save returns unchanged -> 'unchanged' (only the function is saved, not the call)", async () => {
        const { manager } = await ready();
        assert.equal((await manager.captureFromRun(makeRun())).saved, true);
        const again = await manager.captureFromRun(makeRun({ code: GOOD_FN + '\nawait buildDirtWall(bot, 7);' }));
        assertStopped(again, 'unchanged');
    });
});

describe('captureFromRun(run): saved', () => {
    test('created: result, message, file, index entry; the skills are loaded again', async () => {
        const { manager, prompter } = await ready();
        assert.equal(manager.customSkills.buildDirtWall, undefined);
        const result = await manager.captureFromRun(makeRun());
        assert.equal(result.saved, true);
        assert.equal(result.action, 'created');
        assert.equal(result.name, 'buildDirtWall');
        assert.equal(result.message, CREATED_MSG);
        assert.equal(prompter.calls.length, 1);
        assert.equal(prompter.calls[0].rest.length, 0, 'promptSkillReview(text): one argument');

        assert.equal(fs.readFileSync(path.join(storeDir(), 'buildDirtWall.js'), 'utf8'), GOOD_FN + '\n');
        const info = manager.skillInfos().find((i) => i.name === 'buildDirtWall');
        assert.ok(info, 'in the store');
        assert.equal(info.description, 'Builds a wall of dirt of the given length.', 'the first doc line of the function wins');
        assert.equal(info.signature, 'buildDirtWall(bot, length)');
        assert.equal(info.source_task, 'build a dirt wall of length 3');
        assert.equal(info.status, 'active');
        assert.equal(info.created, iso(T0));

        assert.equal(typeof manager.customSkills.buildDirtWall, 'function');
        assert.deepEqual(manager.knownNames(), ['customSkills.buildDirtWall']);
        const ran = await manager.run('buildDirtWall', [2], makeBot());
        assert.equal(ran.ok, true);
        assert.equal(ran.result, true);
    });

    test('the review prompt: bot name, task, code, output, diffState text, signatures of the saved skills joined with ", "', async () => {
        seed(SEED_TWO);
        const { manager, prompter } = await ready();
        await manager.captureFromRun(makeRun());
        const text = prompter.calls[0].text;
        assert.equal(typeof text, 'string');
        assert.ok(text.includes('NAME=<andy>'), text);
        assert.ok(text.includes('TASK=<build a dirt wall of length 3>'), text);
        assert.ok(text.includes('OUTPUT=<Wall built.>'), text);
        assert.ok(text.includes('STATE=<Inventory: +3 dirt. Did not move.>'), text);
        assert.ok(text.includes('LIST=<addUp(bot, a, b), digHole(bot, depth)>'), text);
        assert.match(text, /CODE=<[\s\S]*async function buildDirtWall\(bot, length\)[\s\S]*>/);
    });

    test('without an own doc block: the doc block is built from the review description, which is also the index description', async () => {
        const { manager } = await ready();
        const result = await manager.captureFromRun(makeRun({ code: NO_DOC_FN + '\nawait buildDirtWall(bot, 3);' }));
        assert.equal(result.saved, true, JSON.stringify(result));
        assert.equal(result.action, 'created');
        const saved = fs.readFileSync(path.join(storeDir(), 'buildDirtWall.js'), 'utf8');
        assert.ok(saved.includes(' * ' + REVIEW_DESC), saved);
        assert.ok(saved.includes(' * await customSkills.buildDirtWall(bot, length);'), saved);
        assert.equal(SRC.firstDocLine(SRC.getDocBlock(saved).text), REVIEW_DESC);
        assert.equal(manager.skillInfos().find((i) => i.name === 'buildDirtWall').description, REVIEW_DESC);
    });

    test('updated: message, history, the new version is loaded', async () => {
        const { manager } = await ready();
        await manager.captureFromRun(makeRun());
        clock += 60_000;
        const result = await manager.captureFromRun(makeRun({ code: V2_FN + '\nawait buildDirtWall(bot, 3);' }));
        assert.equal(result.saved, true);
        assert.equal(result.action, 'updated');
        assert.equal(result.name, 'buildDirtWall');
        assert.equal(result.message, UPDATED_MSG);
        assert.deepEqual(listDir(path.join(storeDir(), '.history')), ['buildDirtWall.v1.js']);
        assert.equal(fs.readFileSync(path.join(storeDir(), '.history', 'buildDirtWall.v1.js'), 'utf8'), GOOD_FN + '\n');
        assert.equal((await manager.run('buildDirtWall', [1], makeBot())).result, 'v2');
    });

    test('capture on, reuse off: saved, but nothing is loaded into the sandbox; the message does not offer the skill (A3)', async () => {
        const { manager } = await ready({ settings: { ...ON, skill_reuse: false } });
        const result = await manager.captureFromRun(makeRun());
        assert.equal(result.saved, true);
        assert.equal(result.action, 'created');
        assert.equal(result.message, CREATED_MSG_NO_REUSE);
        assert.ok(fs.existsSync(path.join(storeDir(), 'buildDirtWall.js')));
        assert.ok(isFrozenEmpty(manager.customSkills));
        assert.deepEqual(manager.knownNames(), []);
    });

    test('capture on, reuse off: an update says "Updated the saved skill <name>." (A3)', async () => {
        const { manager } = await ready({ settings: { ...ON, skill_reuse: false } });
        await manager.captureFromRun(makeRun());
        const result = await manager.captureFromRun(makeRun({ code: V2_FN + '\nawait buildDirtWall(bot, 3);' }));
        assert.equal(result.saved, true);
        assert.equal(result.action, 'updated');
        assert.equal(result.message, UPDATED_MSG_NO_REUSE);
    });

    // Amendment 2, B1: saved, but the reload with reuse did not load it.
    test('saved but not loaded after the reload: saved true, the message says it could not be loaded (created and updated)', async () => {
        let sandboxDown = false;
        const makeCompartment = (endowments) => {
            if (sandboxDown) throw new Error('sandbox down');
            return LOCK.makeCompartment(endowments);
        };
        const { manager } = await ready({ makeCompartment });
        sandboxDown = true;
        const created = await manager.captureFromRun(makeRun());
        assert.equal(created.saved, true);
        assert.equal(created.action, 'created');
        assert.equal(created.reason, null);
        assert.equal(created.message, 'Saved this code as the skill buildDirtWall, but it could not be loaded.');
        assert.equal(manager.has('buildDirtWall'), false);
        assert.ok(manager.listText().includes('[broken]'));

        const updated = await manager.captureFromRun(makeRun({ code: V2_FN + '\nawait buildDirtWall(bot, 3);' }));
        assert.equal(updated.saved, true);
        assert.equal(updated.action, 'updated');
        assert.equal(updated.message, 'Updated the saved skill buildDirtWall, but it could not be loaded.');

        sandboxDown = false;
        const again = await manager.captureFromRun(makeRun({ code: GOOD_FN + '\nawait buildDirtWall(bot, 3);' }));
        assert.equal(again.message, UPDATED_MSG, 'loaded again: the normal text');
    });

    test('with reuse the messages name customSkills.<name> (the texts of the spec, A3)', async () => {
        const { manager } = await ready({ settings: { ...ON, skill_command: true } });
        assert.equal((await manager.captureFromRun(makeRun())).message, CREATED_MSG);
        assert.equal((await manager.captureFromRun(makeRun({ code: V2_FN + '\nawait buildDirtWall(bot, 3);' }))).message, UPDATED_MSG);
    });

    test('an own doc block whose first doc line starts with @: the description of the review is used, the source is kept (A4)', async () => {
        const { manager } = await ready();
        const result = await manager.captureFromRun(makeRun({ code: AT_ONLY_FN + '\nawait buildDirtWall(bot, 3);' }));
        assert.equal(result.saved, true, JSON.stringify(result));
        assert.equal(fs.readFileSync(path.join(storeDir(), 'buildDirtWall.js'), 'utf8'), AT_ONLY_FN + '\n', 'no second doc block is added');
        assert.equal(manager.skillInfos().find((i) => i.name === 'buildDirtWall').description, REVIEW_DESC);
    });

    test('an own doc block with a real first line: saved with that line, even when the review has no description (A4)', async () => {
        const { manager } = await ready({ prompter: makePrompter([reviewReply({ description: '' })]) });
        const result = await manager.captureFromRun(makeRun());
        assert.equal(result.saved, true, JSON.stringify(result));
        assert.equal(manager.skillInfos().find((i) => i.name === 'buildDirtWall').description, 'Builds a wall of dirt of the given length.');
    });
});

describe('captureFromRun(run): never throws and never rejects', () => {
    const HOSTILE = [
        ['undefined', undefined], ['null', null], ['a number', 42], ['an empty object', {}], ['code a number', { code: 42 }],
        ['a throwing getter', { get code() { throw new Error('getter'); }, get interrupted() { throw new Error('getter'); } }],
        ['before and after missing', { code: GOOD_CODE, output: 'x', task: 't' }],
    ];
    for (const [label, run] of HOSTILE) {
        test(label, async () => {
            const { manager } = await ready();
            let result;
            await assert.doesNotReject(async () => {
                result = await manager.captureFromRun(run);
            });
            assert.equal(typeof result, 'object');
            assert.equal(typeof result.saved, 'boolean');
            assert.equal(typeof result.message, 'string');
        });
    }

    test("the store cannot write: 'save_failed', not saved, no message, nothing offered (Amendment 2, B1)", async () => {
        const blocker = path.join(root, 'blocker');
        fs.writeFileSync(blocker, 'x');
        const { manager } = newManager({ botsDir: blocker });
        await manager.init();
        let result;
        await assert.doesNotReject(async () => {
            result = await manager.captureFromRun(makeRun());
        });
        assertStopped(result, 'save_failed');
        assert.equal(result.action, null);
        assert.deepEqual(result.errors, []);
        assert.deepEqual(manager.skillInfos(), []);
        assert.equal(manager.has('buildDirtWall'), false);
        assert.equal(manager.listText(), 'No skills are saved yet.');
    });

    test('before init', async () => {
        const { manager } = newManager();
        await assert.doesNotReject(async () => {
            await manager.captureFromRun(makeRun());
        });
    });
});

// Spec v0.1.4.5, G1: a skill that keeps throwing is switched off. The loader's wrapper calls onUse,
// the manager records the run and may disable the skill, but does not reload while code is running:
// takeNotices() reloads first and then returns the queued notices once.
describe('G1: a skill that keeps throwing is switched off (v0.1.4.5)', () => {
    // maybeFails(bot, mode): throws for "throw", returns false for "false", true otherwise.
    const MAYBE = fnSource('maybeFails', ['/**', ' * Fails on request.', ' **/', 'if (mode === "throw") throw new Error("bad block");', 'return mode !== "false";'], 'bot, mode');
    const SEED = [{ source: MAYBE, description: 'Fails on request.' }, ...SEED_TWO];
    const NOTICE = (n = 3, name = 'maybeFails', error = 'Error: bad block') => `The skill customSkills.${name} was switched off after ${n} errors in a row. `
        + `Last error: ${error}. Write a corrected version of the function under the same name to switch it on again.`;
    const runs = async (manager, modes, bot = makeBot()) => {
        const results = [];
        for (const mode of modes) results.push(await manager.run('maybeFails', [mode], bot));
        return results;
    };
    const entry = (manager, name = 'maybeFails') => manager.store.get(name);

    test('three throws in a row: the skill is disabled and the exact notice is queued', async () => {
        seed(SEED);
        const { manager } = await ready();
        const results = await runs(manager, ['throw', 'throw', 'throw']);
        assert.deepEqual(results.map((r) => r.ok), [false, false, false]);
        assert.equal(entry(manager).status, 'disabled');
        assert.equal(entry(manager).consecutive_errors, 3);
        assert.equal(entry(manager).last_error, 'Error: bad block');
        assert.ok(manager.listText().includes('- maybeFails(bot, mode): Fails on request. (used 3 times, 3 failed) [disabled]'), manager.listText());
        assert.deepEqual(manager.takeNotices(), [NOTICE()]);
    });

    test('takeNotices() called twice returns the notices once; nothing queued: []', async () => {
        seed(SEED);
        const { manager } = await ready();
        assert.deepEqual(manager.takeNotices(), []);
        await runs(manager, ['throw', 'throw', 'throw']);
        assert.deepEqual(manager.takeNotices(), [NOTICE()]);
        assert.deepEqual(manager.takeNotices(), []);
    });

    test('no reload while code runs: until takeNotices() the library object stays, then the skill is gone', async () => {
        seed(SEED);
        const { manager } = await ready();
        const before = manager.customSkills;
        await runs(manager, ['throw', 'throw', 'throw']);
        assert.equal(manager.customSkills, before, 'the same object until takeNotices()');
        assert.ok(manager.knownNames().includes('customSkills.maybeFails'));
        assert.equal(manager.has('maybeFails'), true);

        manager.takeNotices();
        assert.notEqual(manager.customSkills, before, 'reloaded');
        assert.deepEqual(manager.knownNames(), ['customSkills.addUp', 'customSkills.digHole']);
        assert.equal(manager.has('maybeFails'), false);
        assert.equal(manager.customSkills.maybeFails, undefined);
        assert.equal(Object.isFrozen(manager.customSkills), true);
        // code that still holds the old object keeps working with it
        assert.equal(await before.addUp(makeBot(), 1, 2), 3);
    });

    test('a disabled skill is refused by run() at once, and is not offered in the prompts', async () => {
        seed(SEED);
        const { manager } = await ready({ settings: { ...ON, skill_command: true } });
        await runs(manager, ['throw', 'throw', 'throw']);
        assert.equal((await manager.run('maybeFails', ['ok'], makeBot())).error, 'unknown_skill');
        assert.ok(!manager.codingSection('fail on request').includes('maybeFails'));
        assert.ok(!manager.conversingSection().includes('maybeFails'));
    });

    test('the running code keeps working with the library object it has', async () => {
        const RETRY = fnSource('retrySkill', [
            '/**', ' * Calls maybeFails five times, then addUp.', ' **/',
            'let caught = 0;',
            'for (let i = 0; i < 5; i++) {',
            '    try {',
            '        await customSkills.maybeFails(bot, "throw");',
            '    } catch (e) {',
            '        caught++;',
            '    }',
            '}',
            'const sum = await customSkills.addUp(bot, 1, 2);',
            'return caught + ":" + sum + ":" + typeof customSkills.maybeFails;',
        ]);
        seed([...SEED, { source: RETRY, description: 'Calls maybeFails five times, then addUp.' }]);
        const { manager } = await ready();
        const result = await manager.run('retrySkill', [], makeBot());
        assert.deepEqual(result, { ok: true, result: '5:3:function', error: null });
        assert.equal(entry(manager).status, 'disabled');
        assert.equal(entry(manager).consecutive_errors, 5, 'further throws of the disabled skill are still counted');
        assert.equal(entry(manager, 'retrySkill').uses, 1);
        assert.deepEqual(manager.takeNotices(), [NOTICE()], 'one notice, not one per throw');
    });

    test('two throws, one success, two throws: not disabled', async () => {
        seed(SEED);
        const { manager } = await ready();
        await runs(manager, ['throw', 'throw', 'ok', 'throw', 'throw']);
        assert.equal(entry(manager).status, 'active');
        assert.equal(entry(manager).consecutive_errors, 2);
        assert.deepEqual(manager.takeNotices(), []);
        assert.equal(manager.has('maybeFails'), true);
    });

    test('a run that returns false neither counts nor resets', async () => {
        seed(SEED);
        const { manager } = await ready();
        await runs(manager, ['false', 'false', 'false', 'false']);
        assert.equal(entry(manager).consecutive_errors, 0, 'false does not count');
        assert.equal(entry(manager).failures, 4);
        await runs(manager, ['throw', 'false', 'throw', 'false']);
        assert.equal(entry(manager).status, 'active');
        assert.equal(entry(manager).consecutive_errors, 2, 'false does not reset');
        await runs(manager, ['throw']);
        assert.equal(entry(manager).status, 'disabled');
        assert.deepEqual(manager.takeNotices(), [NOTICE()]);
    });

    test('the limit 0 never disables', async () => {
        seed(SEED);
        const { manager } = await ready({ settings: { ...ON, skill_disable_after_errors: 0 } });
        await runs(manager, ['throw', 'throw', 'throw', 'throw', 'throw', 'throw']);
        assert.equal(entry(manager).status, 'active');
        assert.equal(entry(manager).consecutive_errors, 6);
        assert.deepEqual(manager.takeNotices(), []);
        assert.equal(manager.has('maybeFails'), true);
    });

    test('another limit: disabled when the count reaches it; the notice names the count', async () => {
        seed(SEED);
        const { manager } = await ready({ settings: { ...ON, skill_disable_after_errors: 1 } });
        await runs(manager, ['throw']);
        assert.equal(entry(manager).status, 'disabled');
        assert.deepEqual(manager.takeNotices(), [NOTICE(1)]);
    });

    test('a skill that is interrupted records nothing', async () => {
        seed(SEED);
        const { manager } = await ready();
        const bot = makeBot({ interrupt_code: true });
        const results = await runs(manager, ['throw', 'throw', 'throw', 'throw'], bot);
        assert.deepEqual(results.map((r) => r.ok), [false, false, false, false], 'the error still comes back');
        assert.equal(entry(manager).uses, 0);
        assert.equal(entry(manager).consecutive_errors, 0);
        assert.equal(entry(manager).status, 'active');
        assert.deepEqual(manager.takeNotices(), []);
    });

    test('a skill that was already disabled by hand is not disabled again and gives no notice', async () => {
        seed(SEED);
        const { manager } = await ready();
        const lib = manager.customSkills;
        manager.store.setStatus('maybeFails', 'disabled'); // disabled in the store while code holds the old object
        for (let i = 0; i < 3; i++) await assert.rejects(lib.maybeFails(makeBot(), 'throw'), /bad block/);
        assert.equal(entry(manager).consecutive_errors, 3);
        assert.deepEqual(manager.takeNotices(), []);
    });

    // Decision of the tech lead for v0.1.4.5: enabling resets consecutive_errors.
    test('!enableSkill (setStatus active) after the switch-off resets the count: one more throw does not switch it off again', async () => {
        seed(SEED);
        const { manager } = await ready();
        await runs(manager, ['throw', 'throw', 'throw']);
        manager.takeNotices();
        assert.equal(manager.setStatus('maybeFails', 'active'), true);
        assert.equal(entry(manager).consecutive_errors, 0);
        assert.equal(entry(manager).consecutive_failures, 3, 'the other counters stay');
        assert.equal(manager.has('maybeFails'), true);
        await runs(manager, ['throw', 'throw']);
        assert.equal(entry(manager).status, 'active');
        assert.deepEqual(manager.takeNotices(), []);
        await runs(manager, ['throw']);
        assert.equal(entry(manager).status, 'disabled', 'three new errors in a row switch it off again');
        assert.deepEqual(manager.takeNotices(), [NOTICE()]);
    });

    test('saving a new version under the same name switches the skill on again (a trivial new version too)', async () => {
        seed(SEED);
        const { manager } = await ready();
        await runs(manager, ['throw', 'throw', 'throw']);
        manager.takeNotices();
        const FIXED = fnSource('maybeFails', ['/**', ' * Fails on request, now without throwing.', ' **/', 'return mode !== "false";'], 'bot, mode');
        const result = await manager.captureFromRun(makeRun({ code: FIXED + 'await maybeFails(bot, "ok");' }));
        assert.equal(result.saved, true, JSON.stringify(result));
        assert.equal(result.action, 'updated');
        assert.equal(entry(manager).status, 'active');
        assert.equal(entry(manager).consecutive_errors, 0);
        assert.equal(manager.has('maybeFails'), true);
        assert.equal((await manager.run('maybeFails', ['throw'], makeBot())).result, true);
    });

    test('an error of the store while recording does not reach the skill or its caller', async () => {
        seed(SEED);
        const { manager } = await ready();
        manager.store.recordUse = () => {
            throw new Error('disk full');
        };
        const result = await manager.run('maybeFails', ['throw'], makeBot());
        assert.equal(result.ok, false);
        assert.equal(result.error, 'Error: bad block');
        assert.ok(cap.of('warn').some((r) => r.text.includes('disk full')));
    });

    test('the store refuses to disable: no notice, no reload due', async () => {
        seed(SEED);
        const { manager } = await ready();
        manager.store.setStatus = () => false;
        const before = manager.customSkills;
        await runs(manager, ['throw', 'throw', 'throw']);
        assert.deepEqual(manager.takeNotices(), []);
        assert.equal(manager.customSkills, before, 'no reload');
    });

    test('takeNotices() never throws: a reload that fails still returns the notices', async () => {
        seed(SEED);
        let sandboxDown = false;
        const makeCompartment = (endowments) => {
            if (sandboxDown) throw new Error('sandbox down');
            return LOCK.makeCompartment(endowments);
        };
        const { manager } = await ready({ makeCompartment });
        await runs(manager, ['throw', 'throw', 'throw']);
        sandboxDown = true;
        let notices;
        assert.doesNotThrow(() => {
            notices = manager.takeNotices();
        });
        assert.deepEqual(notices, [NOTICE()]);
        assert.deepEqual(manager.knownNames(), []);
        manager._reload = () => {
            throw new Error('reload broke');
        };
        manager._reloadDue = true;
        assert.deepEqual(manager.takeNotices(), []);
    });

    test('a reload for another reason (setStatus) does the due reload too; the notices stay queued', async () => {
        seed(SEED);
        const { manager } = await ready();
        await runs(manager, ['throw', 'throw', 'throw']);
        manager.setStatus('digHole', 'disabled');
        assert.deepEqual(manager.knownNames(), ['customSkills.addUp']);
        assert.deepEqual(manager.takeNotices(), [NOTICE()]);
    });

    test('before init and with reuse off: takeNotices() is []', async () => {
        seed(SEED);
        assert.deepEqual(newManager().manager.takeNotices(), []);
        const { manager } = await ready({ settings: { ...ON, skill_reuse: false } });
        assert.deepEqual(manager.takeNotices(), []);
    });

    test('limits is skillLimits(settings)', () => {
        for (const settings of [ON, { ...ON, skill_max_count: 5, skill_disable_after_errors: 0 }, {}]) {
            assert.deepEqual(newManager({ settings }).manager.limits, M.skillLimits(settings));
        }
    });
});

// Spec v0.1.4.5, G2: after a candidate was found, after the trivial check of G3 (decision of the tech
// lead) and BEFORE the review call, a new skill is refused when the store has maxCount entries
// (active and disabled). A new version of a saved skill is never refused.
describe('G2: the library has a size limit (v0.1.4.5)', () => {
    const FULL = (count) => `The skill library is full (${count} skills), so this code was not saved as a skill. `
        + 'Use !forgetSkill to remove a skill that is no longer needed.';
    const LIMIT = (n) => ({ settings: { ...ON, skill_max_count: n } });

    test('full: a new skill is not reviewed and not saved; reason library_full with the exact message', async () => {
        seed(SEED_TWO);
        const { manager, prompter } = await ready(LIMIT(2));
        const result = await manager.captureFromRun(makeRun());
        assert.deepEqual(result, { saved: false, action: null, name: 'buildDirtWall', reason: 'library_full', errors: [], message: FULL(2) });
        assert.equal(prompter.calls.length, 0, 'no review call');
        assert.equal(fs.existsSync(path.join(storeDir(), 'buildDirtWall.js')), false);
        assert.equal(manager.has('buildDirtWall'), false);
    });

    test('disabled skills count', async () => {
        seed([{ source: ADD_UP, description: 'Adds two numbers.' }, { source: DIG_HOLE, description: 'Digs a hole.', status: 'disabled' }]);
        const { manager } = await ready(LIMIT(2));
        assert.equal((await manager.captureFromRun(makeRun())).reason, 'library_full');
    });

    test('over the limit (the limit was lowered): the count in the message is the real count', async () => {
        seed(SEED_TWO);
        const { manager } = await ready(LIMIT(1));
        assert.equal((await manager.captureFromRun(makeRun())).message, FULL(2));
    });

    test('below the limit: saved', async () => {
        seed(SEED_TWO);
        const { manager } = await ready(LIMIT(3));
        const result = await manager.captureFromRun(makeRun());
        assert.equal(result.saved, true, JSON.stringify(result));
        assert.equal(result.action, 'created');
    });

    test('a new version of a saved skill is never refused, also above the limit', async () => {
        seed([{ source: GOOD_FN, description: 'Builds a wall of dirt of the given length.' }, ...SEED_TWO]);
        const { manager, prompter } = await ready(LIMIT(1));
        const result = await manager.captureFromRun(makeRun({ code: V2_FN + '\nawait buildDirtWall(bot, 3);' }));
        assert.equal(result.saved, true, JSON.stringify(result));
        assert.equal(result.action, 'updated');
        assert.equal(prompter.calls.length, 1);
    });

    test('the same source of a saved skill in a full library: unchanged, not library_full', async () => {
        seed([{ source: GOOD_FN, description: 'Builds a wall of dirt of the given length.' }]);
        const { manager } = await ready(LIMIT(1));
        assert.equal((await manager.captureFromRun(makeRun())).reason, 'unchanged');
    });

    test('0 means no limit', async () => {
        seed(SEED_TWO);
        const { manager } = await ready(LIMIT(0));
        assert.equal((await manager.captureFromRun(makeRun())).saved, true);
    });

    test('the default limit is 100', async () => {
        seed(SEED_TWO);
        const { manager } = await ready();
        assert.equal(manager.limits.maxCount, 100);
        Object.defineProperty(manager.store, 'size', { get: () => 99, configurable: true });
        const below = await manager.captureFromRun(makeRun());
        assert.equal(below.saved, true, JSON.stringify(below));
        manager.forget('buildDirtWall');
        Object.defineProperty(manager.store, 'size', { get: () => 100, configurable: true });
        assert.equal((await manager.captureFromRun(makeRun())).message, FULL(100));
    });

    test('after forget there is room again', async () => {
        seed(SEED_TWO);
        const { manager } = await ready(LIMIT(2));
        assert.equal((await manager.captureFromRun(makeRun())).reason, 'library_full');
        assert.equal(manager.forget('addUp'), true);
        assert.equal((await manager.captureFromRun(makeRun())).saved, true);
    });

    test('the check comes after step 5: code without a candidate stops with the reason of the picker', async () => {
        seed(SEED_TWO);
        const { manager } = await ready(LIMIT(2));
        assertStopped(await manager.captureFromRun(makeRun({ code: 'await skills.wait(bot, 1);' })), 'no_function');
    });

    // Decision of the tech lead for v0.1.4.5: the trivial check (G3) comes first, the size limit second.
    test('the check comes after the rule of G3: a trivial function in a full library is trivial, with an empty message', async () => {
        seed(SEED_TWO);
        const { manager, prompter } = await ready(LIMIT(2));
        const result = await manager.captureFromRun(makeRun({ code: TRIVIAL_FN + '\nawait collectLogs(bot, 3);' }));
        assert.deepEqual(result, { saved: false, action: null, name: 'collectLogs', reason: 'trivial', errors: [], message: '' });
        assert.equal(prompter.calls.length, 0);
    });

    test('capture on, reuse off: the limit holds as well', async () => {
        seed(SEED_TWO);
        const { manager } = await ready({ settings: { ...ON, skill_reuse: false, skill_max_count: 2 } });
        assert.equal((await manager.captureFromRun(makeRun())).reason, 'library_full');
    });
});

// Spec v0.1.4.5, G3: before the review call, a trivial candidate (isTrivialFunction) is not reviewed
// and not saved. By decision of the tech lead this comes BEFORE the check of G2. A new version of a
// saved skill is never refused.
const TRIVIAL_FN = lines(
    'async function collectLogs(bot, count) {',
    '    /**',
    '     * Collects the given number of oak logs.',
    '     **/',
    "    await skills.collectBlock(bot, 'oak_log', count);",
    '    return true;',
    '}',
);
describe('G3: no review call for trivial functions (v0.1.4.5)', () => {
    test('a trivial function is not reviewed and not saved: reason trivial, message empty', async () => {
        const { manager, prompter } = await ready();
        const result = await manager.captureFromRun(makeRun({ code: TRIVIAL_FN + '\nawait collectLogs(bot, 3);' }));
        assert.deepEqual(result, { saved: false, action: null, name: 'collectLogs', reason: 'trivial', errors: [], message: '' });
        assert.equal(prompter.calls.length, 0, 'no review call');
        assert.equal(fs.existsSync(path.join(storeDir(), 'collectLogs.js')), false);
    });

    test('a function without any sandbox call and without a loop is trivial', async () => {
        const { manager, prompter } = await ready();
        const code = 'async function addUp(bot, a, b) {\n    /** Adds. */\n    return a + b;\n}\nawait addUp(bot, 1, 2);';
        assertStopped(await manager.captureFromRun(makeRun({ code })), 'trivial');
        assert.equal(prompter.calls.length, 0);
    });

    test('two sandbox calls: reviewed and saved', async () => {
        const code = TRIVIAL_FN.replace('    return true;', "    await skills.craftRecipe(bot, 'oak_planks', count);\n    return true;") + '\nawait collectLogs(bot, 3);';
        const { manager, prompter } = await ready();
        const result = await manager.captureFromRun(makeRun({ code }));
        assert.equal(result.saved, true, JSON.stringify(result));
        assert.equal(prompter.calls.length, 1);
    });

    test('a loop: reviewed and saved (the good example of the step tests)', async () => {
        const { manager, prompter } = await ready();
        assert.equal(SRC.isTrivialFunction(GOOD_FN), false, 'precondition: GOOD_FN has a loop');
        assert.equal((await manager.captureFromRun(makeRun())).saved, true);
        assert.equal(prompter.calls.length, 1);
    });

    test('a trivial new version of a saved skill is reviewed and saved', async () => {
        seed([{ source: GOOD_FN, description: 'Builds a wall of dirt of the given length.' }]);
        const { manager, prompter } = await ready();
        const code = TRIVIAL_FN.replace('collectLogs(bot, count)', 'buildDirtWall(bot, length)').replace('count);', 'length);') + '\nawait buildDirtWall(bot, 3);';
        assert.equal(SRC.isTrivialFunction(SRC.parseGeneratedCode(code).functions[0].source), true, 'precondition: trivial');
        const result = await manager.captureFromRun(makeRun({ code }));
        assert.equal(result.saved, true, JSON.stringify(result));
        assert.equal(result.action, 'updated');
        assert.equal(prompter.calls.length, 1);
    });

    test('a trivial function whose name is saved only in other case is still trivial (not the same skill)', async () => {
        seed([{ source: TRIVIAL_FN.replace('collectLogs', 'collectlogs'), description: 'Old.' }]);
        const { manager } = await ready();
        assert.equal((await manager.captureFromRun(makeRun({ code: TRIVIAL_FN + '\nawait collectLogs(bot, 3);' }))).reason, 'trivial');
    });
});

// Spec v0.1.4.5, G4: the loader protects the name customSkills in the compartment of the skills.
describe('G4: the skills compartment of the manager (v0.1.4.5)', () => {
    test('the name customSkills is a constant with the loaded library; skills still call each other', async () => {
        seed([{ source: INNER, description: 'Inner.' }, { source: OUTER, description: 'Outer.' }]);
        const made = [];
        const makeCompartment = (e) => {
            const c = LOCK.makeCompartment(e);
            made.push(c);
            return c;
        };
        const { manager } = await ready({ makeCompartment });
        const binding = Object.getOwnPropertyDescriptor(made[0].globalThis, 'customSkills');
        assert.equal(binding.value, manager.customSkills);
        assert.equal(binding.writable, false);
        assert.equal(binding.configurable, false);
        assert.throws(() => made[0].evaluate('customSkills = {}'), TypeError);
        assert.equal((await manager.run('outerSkill', [], makeBot())).result, 42);
    });
});

describe('module rules', () => {
    test('no mineflayer, no model SDK, not skills.js or world.js, no require()', () => {
        assertSkillModuleImports(MODULE);
    });

    test('importing the module prints nothing and creates no files', () => {
        assertCleanImport(MODULE);
    });
});
