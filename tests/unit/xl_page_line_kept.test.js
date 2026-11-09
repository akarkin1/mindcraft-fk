// v0.1.4.14, part L (engineer E1), fix round part 8 (P-22, spec 8.8): a send-message from the page before the agent set
// respondFunc (right after a reconnect with the page's Connect button, before Agent.start reached agent.js:1328) was
// `TypeError: this.agent.respondFunc is not a function` at mindserver_proxy.js:66 and the line was lost. Now the line
// is kept (up to 20, the oldest dropped) and delivered in order as soon as respondFunc exists; the page gets
// `The bot is not ready yet; your line is kept.` down bot-output.
//
// The singleton serverProxy is used without a connection: its socket is a fake that records what it emits, its agent
// a plain object that gets respondFunc later; the watch timer of the proxy is the real one (200 ms).
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import '../helpers/st_glue_env.js'; // registers the mcdata hook (once per process)

async function importQuietly() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        return await loadSrc('src/agent/mindserver_proxy.js');
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const M = await importQuietly();
const { serverProxy, keepLine, PENDING_MAX, PENDING_POLL_MS, NOT_READY_TEXT } = M;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let emitted;
let cap;
beforeEach(() => {
    cap = captureConsole();
    emitted = [];
    serverProxy.name = 'Luna';
    serverProxy.socket = { emit: (...args) => { emitted.push(args); } };
    serverProxy.agent = {}; // the agent before Agent.start set respondFunc
    serverProxy.pending = [];
});
afterEach(() => {
    serverProxy.deliverPending(); // clears the watch timer whatever the state
    serverProxy.pending = [];
    serverProxy.agent = undefined;
    serverProxy.socket = null;
    cap.restore();
});

describe('L: a line of the page before the bot is ready is kept (mindserver_proxy.js)', () => {
    test('the texts and the limits, word for word', () => {
        assert.equal(NOT_READY_TEXT, 'The bot is not ready yet; your line is kept.');
        assert.equal(PENDING_MAX, 20);
        assert.equal(PENDING_POLL_MS, 200);
    });

    test('keepLine holds at most max lines, the oldest dropped', () => {
        const pending = [];
        for (let i = 1; i <= 23; i++)
            keepLine(pending, { from: 'Marty', message: `line ${i}` });
        assert.equal(pending.length, 20);
        assert.equal(pending[0].message, 'line 4');
        assert.equal(pending[19].message, 'line 23');
        assert.deepEqual(keepLine([], { from: 'a', message: 'b' }, 1), [{ from: 'a', message: 'b' }]);
    });

    test('before respondFunc: the line is kept, the page hears the text, nothing throws', () => {
        assert.equal(serverProxy.ready, false);
        const delivered = serverProxy.deliverOrKeep({ from: 'MartyByrde2', message: 'come here' });
        assert.equal(delivered, false);
        assert.deepEqual(serverProxy.pending, [{ from: 'MartyByrde2', message: 'come here' }]);
        assert.deepEqual(emitted, [['bot-output', 'Luna', 'The bot is not ready yet; your line is kept.']]);
        assert.ok(serverProxy.pendingTimer, 'the watch for respondFunc runs');
    });

    test('with respondFunc: the line goes to the agent at once and nothing is kept', () => {
        const calls = [];
        serverProxy.agent.respondFunc = (from, message) => { calls.push([from, message]); };
        assert.equal(serverProxy.ready, true);
        assert.equal(serverProxy.deliverOrKeep({ from: 'MartyByrde2', message: 'hi' }), true);
        assert.deepEqual(calls, [['MartyByrde2', 'hi']]);
        assert.deepEqual(serverProxy.pending, []);
        assert.deepEqual(emitted, []);
    });

    test('the kept lines are delivered in order when respondFunc appears, within the poll time', async () => {
        serverProxy.deliverOrKeep({ from: 'MartyByrde2', message: 'first' });
        serverProxy.deliverOrKeep({ from: 'MartyByrde2', message: 'second' });
        assert.equal(emitted.length, 2, 'the page hears the text for every kept line');
        const calls = [];
        await sleep(PENDING_POLL_MS + 50);
        assert.equal(calls.length, 0, 'nothing before respondFunc');
        serverProxy.agent.respondFunc = (from, message) => { calls.push([from, message]); };
        await sleep(PENDING_POLL_MS + 100);
        assert.deepEqual(calls, [['MartyByrde2', 'first'], ['MartyByrde2', 'second']]);
        assert.deepEqual(serverProxy.pending, []);
        assert.equal(serverProxy.pendingTimer, null, 'the watch stopped');
    });

    test('more than 20 lines kept: the 20 newest are delivered', () => {
        for (let i = 1; i <= 25; i++)
            serverProxy.deliverOrKeep({ from: 'MartyByrde2', message: `line ${i}` });
        assert.equal(serverProxy.pending.length, 20);
        const calls = [];
        serverProxy.agent.respondFunc = (from, message) => { calls.push(message); };
        assert.equal(serverProxy.deliverPending(), 20);
        assert.equal(calls[0], 'line 6');
        assert.equal(calls[19], 'line 25');
        assert.equal(serverProxy.pendingTimer, null);
    });

    test('a respondFunc that throws on one kept line does not lose the next', () => {
        serverProxy.deliverOrKeep({ from: 'MartyByrde2', message: 'bad' });
        serverProxy.deliverOrKeep({ from: 'MartyByrde2', message: 'good' });
        const calls = [];
        serverProxy.agent.respondFunc = (from, message) => { if (message === 'bad') throw new Error('boom'); calls.push(message); };
        assert.equal(serverProxy.deliverPending(), 2);
        assert.deepEqual(calls, ['good']);
    });

    test('the send-message handler of the socket goes through deliverOrKeep', () => {
        const src = fs.readFileSync(repoPath('src/agent/mindserver_proxy.js'), 'utf8');
        const at = src.indexOf("this.socket.on('send-message'");
        assert.ok(at > 0);
        const body = src.slice(at, src.indexOf('});', at));
        assert.match(body, /this\.deliverOrKeep\(data\)/);
        assert.doesNotMatch(body, /this\.agent\.respondFunc\(/, 'no bare call that could throw');
    });
});
