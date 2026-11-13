// E3 and E5, spec v0.1.4.16 F12 (P-21 of 0.1.4.14), the lead's rule after T4's W129 check 2c: History.add pushes the turn
// synchronously at call time (several callers of agent.js do not await it, so a deferred push made every command result
// reach the model one prompt late) and splices the summary's chunk in the same tick when the length reaches max_messages;
// only the summarising of the chunk runs afterwards, one chunk at a time, so two summaries never run at once and a
// concurrent add during a slow summary never reorders the turns. add returns a promise that resolves when the summary it
// started, or found running, is done. appendFullHistory stays; the closedByUser guard of the model class stays. Every test
// runs with the process working directory set to its own empty temp directory.
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { makeFakeAgent, setMemSaving } from '../helpers/fake_agent.js';

const H = await loadSrc('src/agent/history.js');
const agentSettings = await loadSrc('src/agent/settings.js');

const NAME = 'zz_test_andy';
const USER = 'steve';

let originalCwd;
let fakeCwd;
let botsDir;
let cap;
let maxBefore;

before(() => {
    originalCwd = process.cwd();
    maxBefore = { ...agentSettings.default };
});
after(() => {
    agentSettings.setSettings(maxBefore);
    process.chdir(originalCwd);
});
beforeEach(() => {
    fakeCwd = makeTmpDir();
    process.chdir(fakeCwd);
    botsDir = makeTmpDir();
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
    process.chdir(originalCwd);
    removeTmpDir(botsDir);
    removeTmpDir(fakeCwd);
});

// A summary whose promise the test resolves itself.
function deferredSummary(agent) {
    const gate = {};
    gate.promise = new Promise((resolve, reject) => { gate.resolve = resolve; gate.reject = reject; });
    setMemSaving(agent, () => gate.promise);
    return gate;
}

function newHistory(max) {
    agentSettings.setSettings({ ...maxBefore, max_messages: max }); // as history.test.js sets it
    const agent = makeFakeAgent(NAME);
    const history = new H.History(agent, { bots_dir: botsDir });
    return { agent, history };
}

const contents = (history) => history.turns.map(t => t.content);
const tick = () => new Promise(resolve => setImmediate(resolve));

describe('F12: the push is synchronous', () => {
    test('a turn stands in the turns when add returns, awaited or not: the command result is in the very next prompt', async () => {
        const { history } = newHistory(20);
        history.add(USER, 'mine 4 iron'); // not awaited, as handleMessage does for the bot\'s line and the command result
        history.add(NAME, 'On it. !mineOre("iron", 4, false)');
        history.add('system', 'Command result: I mined 4 raw_iron of 4.');
        assert.deepEqual(history.turns.map(t => [t.role, t.content]), [
            ['user', `${USER}: mine 4 iron`], ['assistant', 'On it. !mineOre("iron", 4, false)'], ['system', 'Command result: I mined 4 raw_iron of 4.'],
        ], 'all three turns present before any await, in order');
        assert.equal(history.turns.at(-1).role, 'system', 'the result turn is the last one, never the bot\'s own line');
    });

    test('add returns a promise the callers can await, as before; the body of the summary is _summarizeChunk', async () => {
        const { history } = newHistory(20);
        const p = history.add(USER, 'hello');
        assert.ok(p instanceof Promise);
        assert.equal(await p, undefined);
        assert.deepEqual(history.turns, [{ role: 'user', content: `${USER}: hello` }]);
        assert.equal(typeof history._summarizeChunk, 'function');
        assert.equal(history._add, undefined, 'the deferred body of the first round is gone');
    });
});

describe('F12: the chunk leaves in the same tick, the summary runs afterwards, one at a time', () => {
    test('at max_messages the chunk is spliced and the summary asked before add returns; a concurrent add during the slow summary lands behind, in order', async () => {
        const { agent, history } = newHistory(6);
        for (let i = 1; i <= 5; i++) {
            await history.add(i % 2 ? USER : NAME, `t${i}`);
        }
        assert.equal(history.turns.length, 5);
        const gate = deferredSummary(agent);
        const p1 = history.add(USER, 't6'); // the sixth turn: the chunk leaves now, the summary waits on the gate
        assert.equal(agent.prompter.calls.length, 1, 'the summary was asked in the same tick');
        assert.deepEqual(agent.prompter.calls[0].map(t => t.content), [`${USER}: t1`, 't2', `${USER}: t3`, 't4', `${USER}: t5`], 'the chunk is the first five turns');
        assert.deepEqual(contents(history), [`${USER}: t6`], 'the chunk is out before add returns');
        const p2 = history.add(NAME, 'the bot\'s own line'); // concurrent adds while the summary runs
        const p3 = history.add('system', 'Command result: done.');
        const p4 = history.add(USER, 't9');
        assert.deepEqual(contents(history), [`${USER}: t6`, 'the bot\'s own line', 'Command result: done.', `${USER}: t9`], 'pushed at once, in the order the adds came');
        await tick();
        await tick();
        assert.equal(agent.prompter.calls.length, 1, 'no second summary while the first runs');
        assert.deepEqual(contents(history), [`${USER}: t6`, 'the bot\'s own line', 'Command result: done.', `${USER}: t9`], 'nothing moved while the summary waits');
        gate.resolve('summary of the conversation');
        await Promise.all([p1, p2, p3, p4]);
        assert.deepEqual(history.turns.map(t => [t.role, t.content]), [['user', `${USER}: t6`], ['assistant', 'the bot\'s own line'], ['system', 'Command result: done.'], ['user', `${USER}: t9`]], 'in the order the adds came, nothing reordered by the summary');
        assert.equal(history.turns.at(-1).role, 'user', 'the last turn is the user\'s');
        assert.equal(history.memory, 'summary of the conversation');
    });

    test('the turns grow past max_messages while a summary runs; the first add after it takes the next chunk, so two summaries never run at once', async () => {
        const { agent, history } = newHistory(6);
        for (let i = 1; i <= 5; i++) {
            await history.add(USER, `t${i}`);
        }
        const gate = deferredSummary(agent);
        const p1 = history.add(USER, 't6'); // the chunk t1..t5 leaves, the summary waits
        const held = [];
        for (let i = 7; i <= 11; i++) {
            held.push(history.add(USER, `t${i}`)); // six turns again: no second chunk while the first summary runs
        }
        assert.equal(agent.prompter.calls.length, 1, 'one summary at a time');
        assert.deepEqual(contents(history), ['t6', 't7', 't8', 't9', 't10', 't11'].map(t => `${USER}: ${t}`), 'the turns grow in order');
        gate.resolve('first summary');
        await Promise.all([p1, ...held]);
        assert.equal(history.memory, 'first summary');
        assert.equal(agent.prompter.calls.length, 1, 'the held adds started no summary of their own');
        setMemSaving(agent, () => 'second summary');
        await history.add(USER, 't12'); // seven turns: the next chunk t6..t10 leaves now
        assert.equal(agent.prompter.calls.length, 1, 'setMemSaving reset the calls: one call since');
        assert.deepEqual(agent.prompter.calls[0].map(t => t.content), ['t6', 't7', 't8', 't9', 't10'].map(t => `${USER}: ${t}`), 'the second chunk is the next five turns');
        assert.deepEqual(contents(history), [`${USER}: t11`, `${USER}: t12`]);
        assert.equal(history.memory, 'second summary');
    });

    test('a summary that fails or throws: the chunk comes back in front of the turns that came while it ran, and the next add tries again', async () => {
        const { agent, history } = newHistory(4);
        for (let i = 1; i <= 3; i++) {
            await history.add(i % 2 ? USER : NAME, `t${i}`);
        }
        const gate = deferredSummary(agent);
        const p1 = history.add(NAME, 't4'); // four turns: the chunk is all of them (the first five), the summary waits
        assert.deepEqual(contents(history), [], 'the chunk is out at once');
        const p2 = history.add(USER, 't5'); // lands while the summary runs
        assert.deepEqual(contents(history), [`${USER}: t5`]);
        await tick();
        gate.reject(new Error('the model is down'));
        await Promise.all([p1, p2]);
        assert.deepEqual(contents(history), [`${USER}: t1`, 't2', `${USER}: t3`, 't4', `${USER}: t5`], 'the chunk back in front, the concurrent turn behind it');
        assert.equal(history.memory, '');
        setMemSaving(agent, () => 'later summary');
        await history.add(USER, 't6');
        assert.equal(history.memory, 'later summary', 'the next add tries again');
        assert.deepEqual(contents(history), [`${USER}: t6`]);
    });

    test('an add while a summary runs resolves when that summary is done', async () => {
        const { agent, history } = newHistory(6);
        for (let i = 1; i <= 5; i++) {
            await history.add(USER, `t${i}`);
        }
        const gate = deferredSummary(agent);
        history.add(USER, 't6');
        let settled = false;
        const p = history.add(USER, 't7').then(() => { settled = true; });
        await tick();
        await tick();
        assert.equal(settled, false, 'the promise waits for the running summary');
        gate.resolve('summary');
        await p;
        assert.equal(settled, true);
        assert.equal(history.memory, 'summary');
    });
});
