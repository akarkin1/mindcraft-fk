// E3, spec v0.1.4.16 F12 (P-21 of 0.1.4.14): History.add is serialised on one promise chain, so that no add pushes a turn
// while an earlier add awaits the memory summary; the turns stay in the order the adds came and the last turn is the
// user's; the summary's chunk is the first five turns. appendFullHistory stays; the closedByUser guard of the model class
// stays. Every test runs with the process working directory set to its own empty temp directory.
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

const tick = () => new Promise(resolve => setImmediate(resolve));

describe('F12: History.add is serialised', () => {
    test('an add that awaits the summary holds the next adds back; the order stays, the last turn is the user\'s, the chunk is the first five', async () => {
        const { agent, history } = newHistory(6);
        for (let i = 1; i <= 5; i++) {
            await history.add(i % 2 ? USER : NAME, `t${i}`);
        }
        assert.equal(history.turns.length, 5);
        const gate = deferredSummary(agent);
        const p1 = history.add(USER, 't6'); // the sixth turn: the summary starts and waits on the gate
        const p2 = history.add(NAME, 'the bot\'s own line'); // a concurrent add while the summary runs
        const p3 = history.add(USER, 't8');
        await tick();
        await tick();
        assert.equal(agent.prompter.calls.length, 1, 'the summary was asked once');
        assert.deepEqual(agent.prompter.calls[0].map(t => t.content), [`${USER}: t1`, 't2', `${USER}: t3`, 't4', `${USER}: t5`], 'the chunk is the first five turns');
        assert.deepEqual(history.turns.map(t => t.content), [`${USER}: t6`], 'no other add pushed while the summary waits');
        gate.resolve('summary of the conversation');
        await Promise.all([p1, p2, p3]);
        assert.deepEqual(history.turns.map(t => [t.role, t.content]), [['user', `${USER}: t6`], ['assistant', 'the bot\'s own line'], ['user', `${USER}: t8`]], 'in the order the adds came');
        assert.equal(history.turns.at(-1).role, 'user', 'the last turn is the user\'s');
        assert.equal(history.memory, 'summary of the conversation');
    });

    test('a summary that fails or throws does not break the chain: the next adds still land, the chunk comes back in front', async () => {
        const { agent, history } = newHistory(4);
        for (let i = 1; i <= 3; i++) {
            await history.add(i % 2 ? USER : NAME, `t${i}`);
        }
        const gate = deferredSummary(agent);
        const p1 = history.add(NAME, 't4');
        const p2 = history.add(USER, 't5');
        await tick();
        gate.reject(new Error('the model is down'));
        await Promise.all([p1, p2]);
        assert.deepEqual(history.turns.map(t => t.content), [`${USER}: t1`, 't2', `${USER}: t3`, 't4', `${USER}: t5`], 'the chunk back in front, then the held add');
        setMemSaving(agent, () => 'later summary');
        await history.add(USER, 't6');
        assert.equal(history.memory, 'later summary', 'the chain goes on after a failure');
        assert.equal(history.turns.at(-1).content, `${USER}: t6`);
    });

    test('add returns a promise the callers can await, as before; add is no longer an async function but its result is', async () => {
        const { history } = newHistory(20);
        const p = history.add(USER, 'hello');
        assert.ok(p instanceof Promise);
        assert.equal(await p, undefined);
        assert.deepEqual(history.turns, [{ role: 'user', content: `${USER}: hello` }]);
        assert.equal(typeof history._add, 'function', 'the body of the add');
    });
});
