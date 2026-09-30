// Spec v0.1.4.8, part A, A2 and A6: withTimeLimit(ms, fn, options) of src/utils/kill_timer.js. It never
// rejects and never kills: { done, value, error }, { done: false } when the time is over, and
// { done: false, stopped: true } when options.until() becomes true (the interrupt of the bot). The
// escape of unstuck and the wait for the code model use it. withKillTimer stays unchanged.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const K = await loadSrc('src/utils/kill_timer.js');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('withTimeLimit(ms, fn): settled in time', () => {
    test('fn resolves: { done: true, value }', async () => {
        assert.deepEqual(await K.withTimeLimit(1000, async () => 'moved'), { done: true, value: 'moved' });
        assert.deepEqual(await K.withTimeLimit(1000, () => 7), { done: true, value: 7 });
    });

    test('fn rejects or throws: { done: true, error }, nothing is thrown', async () => {
        const error = new Error('No path to the goal!');
        assert.deepEqual(await K.withTimeLimit(1000, async () => { throw error; }), { done: true, error });
        const sync = new TypeError('boom');
        assert.deepEqual(await K.withTimeLimit(1000, () => { throw sync; }), { done: true, error: sync });
    });
});

describe('withTimeLimit: the time is over', () => {
    test('{ done: false } after ms, the late value is dropped, nothing is killed', async () => {
        let finish;
        const started = Date.now();
        const result = await K.withTimeLimit(60, () => new Promise((resolve) => { finish = resolve; }));
        assert.deepEqual(result, { done: false });
        assert.ok(Date.now() - started >= 50, 'not before the time');
        finish('late');
        await sleep(10);
    });

    test('a late rejection is no unhandled rejection', async () => {
        let fail;
        const unhandled = [];
        const onUnhandled = (reason) => unhandled.push(reason);
        process.on('unhandledRejection', onUnhandled);
        try {
            assert.deepEqual(await K.withTimeLimit(20, () => new Promise((_, reject) => { fail = reject; })), { done: false });
            fail(new Error('late'));
            await sleep(20);
            assert.deepEqual(unhandled, []);
        } finally {
            process.off('unhandledRejection', onUnhandled);
        }
    });

    test('0, a negative or no number: no time limit', async () => {
        for (const ms of [0, -5, Infinity, undefined]) {
            const result = await K.withTimeLimit(ms, () => sleep(30).then(() => 'done'));
            assert.deepEqual(result, { done: true, value: 'done' }, String(ms));
        }
    });
});

describe('withTimeLimit: options.until', () => {
    test('true at the start: fn is not called', async () => {
        let called = false;
        const result = await K.withTimeLimit(1000, () => { called = true; }, { until: () => true });
        assert.deepEqual(result, { done: false, stopped: true });
        assert.equal(called, false);
    });

    test('true later: { done: false, stopped: true } within the poll time', async () => {
        let stop = false;
        setTimeout(() => { stop = true; }, 30);
        const started = Date.now();
        const result = await K.withTimeLimit(0, () => new Promise(() => {}), { until: () => stop, pollMs: 20 });
        assert.deepEqual(result, { done: false, stopped: true });
        assert.ok(Date.now() - started < 500, `${Date.now() - started} ms`);
    });

    test('fn first: its result; the poll ends (the process can end)', async () => {
        let polls = 0;
        const result = await K.withTimeLimit(1000, () => sleep(50).then(() => 'x'), { until: () => { polls++; return false; }, pollMs: 10 });
        assert.deepEqual(result, { done: true, value: 'x' });
        const after = polls;
        await sleep(50);
        assert.equal(polls, after, 'no poll after the result');
    });

    test('an error of until counts as false', async () => {
        const result = await K.withTimeLimit(1000, () => sleep(20).then(() => 1), { until: () => { throw new Error('x'); }, pollMs: 5 });
        assert.deepEqual(result, { done: true, value: 1 });
    });

    test('the default poll is 200 ms', async () => {
        let stop = false;
        setTimeout(() => { stop = true; }, 10);
        const started = Date.now();
        await K.withTimeLimit(0, () => new Promise(() => {}), { until: () => stop });
        const took = Date.now() - started;
        assert.ok(took >= 150 && took < 700, `${took} ms`);
    });
});

describe('withKillTimer stays for other callers', () => {
    test('it is still exported and kills after ms', async () => {
        let killed = 0;
        await K.withKillTimer(() => { killed++; }, 10, () => sleep(40));
        assert.equal(killed, 1);
    });
});

describe('module rules', () => {
    test('kill_timer.js imports nothing and is importable without output or files', () => {
        assertImportRules('src/utils/kill_timer.js', { allowBuiltins: [], allowedRelative: [] });
        assertCleanImport('src/utils/kill_timer.js');
    });
});
