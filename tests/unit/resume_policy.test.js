// Spec v0.1.4.3 W6: src/agent/world/resume_policy.js -- RESUME_POLICIES, normalizePolicy,
// shouldResumeGoal, ResumeGuard (injected clock).
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir, listDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const MODULE = 'src/agent/world/resume_policy.js';
const RP = await loadSrc(MODULE);

function api(name) {
    const fn = RP[name];
    assert.equal(typeof fn, 'function', `${name} must be an exported function`);
    return fn;
}

const T0 = Date.UTC(2026, 8, 27, 10, 0, 0);
const WINDOW = 900_000;

let dir;
let file;
let cap;
let clock;
beforeEach(() => {
    dir = makeTmpDir();
    file = path.join(dir, 'resume_guard.json');
    cap = captureConsole();
    clock = T0;
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

function guard(options = {}, fp = file) {
    assert.equal(typeof RP.ResumeGuard, 'function', 'ResumeGuard must be an exported class');
    const g = new RP.ResumeGuard(fp, { now: () => new Date(clock), ...options });
    g.load();
    return g;
}
const readFile = () => JSON.parse(fs.readFileSync(file, 'utf8'));

describe('RESUME_POLICIES', () => {
    test('is the frozen array [always, after_crash, never]', () => {
        assert.deepEqual(RP.RESUME_POLICIES, ['always', 'after_crash', 'never']);
        assert.ok(Array.isArray(RP.RESUME_POLICIES));
        assert.ok(Object.isFrozen(RP.RESUME_POLICIES));
    });
});

describe('normalizePolicy(value)', () => {
    const CASES = [
        ['always', 'always'], ['after_crash', 'after_crash'], ['never', 'never'],
        [' Never ', 'never'], ['AFTER_CRASH', 'after_crash'], ['\tAlways\n', 'always'],
        ['after-crash', 'always'], ['aftercrash', 'always'], ['', 'always'], ['sometimes', 'always'],
        [undefined, 'always'], [null, 'always'], [0, 'always'], [true, 'always'], [['never'], 'always'], [{ policy: 'never' }, 'always'],
    ];
    for (const [value, expected] of CASES) {
        test(`${JSON.stringify(value) ?? 'undefined'} -> ${expected}`, () => {
            assert.equal(api('normalizePolicy')(value), expected);
        });
    }
});

describe('shouldResumeGoal(policy, isRestart)', () => {
    const CASES = [
        ['always', false, true], ['always', true, true],
        ['never', false, false], ['never', true, false],
        ['after_crash', true, true], ['after_crash', false, false],
        ['after_crash', 'true', false], ['after_crash', 1, false], ['after_crash', undefined, false],
        [' AFTER_CRASH ', true, true], [' NEVER', true, false],
        ['bogus', false, true], [undefined, false, true], [null, true, true],
    ];
    for (const [policy, isRestart, expected] of CASES) {
        test(`(${JSON.stringify(policy) ?? 'undefined'}, ${JSON.stringify(isRestart) ?? 'undefined'}) -> ${expected}`, () => {
            assert.equal(api('shouldResumeGoal')(policy, isRestart), expected);
        });
    }
});

describe('ResumeGuard with limit <= 0 (default)', () => {
    for (const [label, options] of [['default limit', {}], ['limit 0', { limit: 0 }], ['limit -1', { limit: -1 }]]) {
        test(`${label}: check is always { allowed: true, count: 0 }, record and clear write nothing`, () => {
            const g = guard(options);
            for (let i = 0; i < 5; i++) {
                g.record('build a house');
                assert.deepEqual(g.check('build a house'), { allowed: true, count: 0 });
            }
            g.clear();
            assert.deepEqual(listDir(dir), []);
        });
    }
});

describe('ResumeGuard with limit > 0', () => {
    test('counts resumes of exactly this prompt; allowed is count < limit', () => {
        const g = guard({ limit: 2 });
        assert.deepEqual(g.check('p'), { allowed: true, count: 0 });
        g.record('p');
        assert.deepEqual(g.check('p'), { allowed: true, count: 1 });
        clock += 1000;
        g.record('p');
        assert.deepEqual(g.check('p'), { allowed: false, count: 2 });
        assert.deepEqual(g.check('other prompt'), { allowed: true, count: 0 });
        assert.deepEqual(g.check('p '), { allowed: true, count: 0 }, 'exactly this prompt');
    });

    test('record writes { version: 1, prompt, resumes: [epoch ms] }', () => {
        const g = guard({ limit: 3 });
        g.record('build a house');
        clock += 2500;
        g.record('build a house');
        assert.deepEqual(readFile(), { version: 1, prompt: 'build a house', resumes: [T0, T0 + 2500] });
        assert.deepEqual(listDir(dir), ['resume_guard.json'], 'no temp file left');
    });

    test('window edge (default 15 minutes): a resume just inside counts, just outside does not', () => {
        const g = guard({ limit: 5 });
        g.record('p');
        clock = T0 + WINDOW - 1;
        assert.equal(g.check('p').count, 1);
        clock = T0 + WINDOW + 1;
        assert.deepEqual(g.check('p'), { allowed: true, count: 0 });
    });

    test('an entry exactly windowMs old still counts; older it drops out (Amendment 1, M6)', () => {
        const g = guard({ limit: 5 });
        g.record('p');
        clock = T0 + WINDOW;
        assert.equal(g.check('p').count, 1);
        clock = T0 + WINDOW + 1;
        assert.equal(g.check('p').count, 0);
    });

    test('record keeps an entry exactly windowMs old and drops an older one (M6)', () => {
        const g = guard({ limit: 5, windowMs: 1000 });
        g.record('p');
        clock = T0 + 1000;
        g.record('p');
        assert.deepEqual(readFile().resumes, [T0, T0 + 1000]);
        clock = T0 + 2001;
        g.record('p');
        assert.deepEqual(readFile().resumes, [T0 + 2001]);
    });

    test('check reads the file by itself when load() was not called (M6)', () => {
        const first = guard({ limit: 3 });
        first.record('p');
        first.record('p');
        const fresh = new RP.ResumeGuard(file, { limit: 3, now: () => new Date(clock) });
        assert.deepEqual(fresh.check('p'), { allowed: true, count: 2 });
    });

    test('record reads the file by itself when load() was not called: earlier resumes are kept (M6)', () => {
        const first = guard({ limit: 3 });
        first.record('p');
        clock += 10;
        const fresh = new RP.ResumeGuard(file, { limit: 3, now: () => new Date(clock) });
        fresh.record('p');
        assert.deepEqual(readFile(), { version: 1, prompt: 'p', resumes: [T0, T0 + 10] });
    });

    test('custom windowMs: old entries are not counted and are dropped by the next record', () => {
        const g = guard({ limit: 5, windowMs: 1000 });
        g.record('p');
        clock += 400;
        g.record('p');
        assert.equal(g.check('p').count, 2);
        clock = T0 + 1200;
        assert.equal(g.check('p').count, 1);
        clock = T0 + 3000;
        g.record('p');
        assert.deepEqual(readFile().resumes, [T0 + 3000]);
    });

    test('a different prompt resets the list', () => {
        const g = guard({ limit: 5 });
        g.record('a');
        g.record('a');
        clock += 10;
        g.record('b');
        assert.deepEqual(readFile(), { version: 1, prompt: 'b', resumes: [T0 + 10] });
        assert.equal(g.check('a').count, 0);
        assert.equal(g.check('b').count, 1);
    });

    test('persistence: a new guard on the same file sees the recorded resumes', () => {
        const first = guard({ limit: 3 });
        first.record('p');
        first.record('p');
        const second = guard({ limit: 3 });
        assert.deepEqual(second.check('p'), { allowed: true, count: 2 });
        second.record('p');
        const third = guard({ limit: 3 });
        assert.deepEqual(third.check('p'), { allowed: false, count: 3 });
    });

    test('clear() empties the state and writes the file', () => {
        const g = guard({ limit: 2 });
        g.record('p');
        g.record('p');
        g.clear();
        assert.deepEqual(g.check('p'), { allowed: true, count: 0 });
        assert.deepEqual(readFile().resumes, []);
        assert.deepEqual(guard({ limit: 2 }).check('p'), { allowed: true, count: 0 });
    });

    for (const [label, content] of [['invalid JSON', '{"version": 1, "resumes": ['], ['an empty file', ''], ['an array', '[1]']]) {
        test(`corrupt file (${label}): load does not throw, empty state`, () => {
            fs.writeFileSync(file, content);
            const g = new RP.ResumeGuard(file, { limit: 2, now: () => new Date(clock) });
            assert.doesNotThrow(() => g.load());
            assert.deepEqual(g.check('p'), { allowed: true, count: 0 });
            g.record('p');
            assert.deepEqual(readFile(), { version: 1, prompt: 'p', resumes: [T0] });
        });
    }

    test('write failure (parent path is a file): record does not throw, console.warn', () => {
        const blocker = path.join(dir, 'blocker');
        fs.writeFileSync(blocker, 'file');
        const g = guard({ limit: 2 }, path.join(blocker, 'resume_guard.json'));
        assert.doesNotThrow(() => g.record('p'));
        assert.ok(cap.of('warn').length >= 1, 'a console.warn is logged');
        assert.equal(fs.readFileSync(blocker, 'utf8'), 'file');
    });
});

describe('module rules', () => {
    test('imports only node built-ins and project files, nothing from mineflayer or src/models', () => {
        assertImportRules(MODULE);
    });

    test('importing the module prints nothing and creates no files', () => {
        assertCleanImport(MODULE);
    });
});
