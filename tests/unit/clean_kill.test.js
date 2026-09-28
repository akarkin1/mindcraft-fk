// Play test fix F3: Agent.cleanKill(msg, code) ended the process without saying why.
//
// The reason went into the chat history only; the console and the log showed nothing. cleanKill
// must print one line "Agent process ends with exit code <code>: <msg>" before it exits, and it
// must reach process.exit(code) also when the history or the bot does not exist yet.
//
// agent.js is imported with an empty temp directory as working directory (so no keys.json or
// ./bots path of the repository is touched). Agent.prototype.cleanKill is called on a fake agent;
// process.exit is replaced by a recorder, so the test process does not end.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

async function importAgent() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        return await loadSrc('src/agent/agent.js');
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const { Agent } = await importAgent();

let cap;
let exits;
let realExit;
beforeEach(() => {
    cap = captureConsole();
    exits = [];
    realExit = process.exit;
    // Records the code and what the console showed up to the exit.
    process.exit = (code) => {
        exits.push({ code, consoleBefore: cap.allText() });
    };
});
afterEach(() => {
    process.exit = realExit;
    cap.restore();
});

function makeAgent({ history = true, bot = true } = {}) {
    const events = [];
    const agent = { name: 'andy', events };
    if (history) {
        agent.history = {
            add(name, content) {
                events.push(['history.add', name, content]);
            },
            save() {
                events.push(['history.save']);
            },
        };
    }
    if (bot) {
        agent.bot = {
            chat(message) {
                events.push(['chat', message]);
            },
        };
    }
    return agent;
}

const cleanKill = (agent, ...args) => Agent.prototype.cleanKill.call(agent, ...args);
const exitLines = () => cap.records.filter((r) => r.text.startsWith('Agent process ends'));

describe('Agent.cleanKill(msg, code)', () => {
    test('prints "Agent process ends with exit code 1: <msg>" once, before process.exit(1)', () => {
        const agent = makeAgent();
        cleanKill(agent, "Got stuck and couldn't get unstuck");
        const line = "Agent process ends with exit code 1: Got stuck and couldn't get unstuck";
        assert.deepEqual(exitLines().map((r) => r.text), [line]);
        assert.equal(exits.length, 1);
        assert.equal(exits[0].code, 1);
        assert.ok(exits[0].consoleBefore.includes(line), 'printed before the exit');
    });

    test('the history and the chat get what they got before', () => {
        const agent = makeAgent();
        cleanKill(agent, 'Infinite action loop detected, shutting down.');
        assert.deepEqual(agent.events, [
            ['history.add', 'system', 'Infinite action loop detected, shutting down.'],
            ['chat', 'Exiting.'],
            ['history.save'],
        ]);
    });

    test('exit code 4: the code is in the line, the chat says "Restarting."', () => {
        const agent = makeAgent();
        cleanKill(agent, 'Not all required players/bots are present in the world. Exiting.', 4);
        assert.deepEqual(exitLines().map((r) => r.text),
            ['Agent process ends with exit code 4: Not all required players/bots are present in the world. Exiting.']);
        assert.deepEqual(agent.events[1], ['chat', 'Restarting.']);
        assert.deepEqual(exits.map((e) => e.code), [4]);
    });

    test('no arguments: the defaults are printed', () => {
        cleanKill(makeAgent());
        assert.deepEqual(exitLines().map((r) => r.text), ['Agent process ends with exit code 1: Killing agent process...']);
        assert.deepEqual(exits.map((e) => e.code), [1]);
    });

    test('no history and no bot yet: no throw, the line is printed, process.exit(code) is called', () => {
        const agent = makeAgent({ history: false, bot: false });
        assert.doesNotThrow(() => cleanKill(agent, 'Disconnected early', 2));
        assert.deepEqual(exitLines().map((r) => r.text), ['Agent process ends with exit code 2: Disconnected early']);
        assert.deepEqual(exits.map((e) => e.code), [2]);
    });

    test('no bot yet: the reason still goes into the history and the history is saved', () => {
        const agent = makeAgent({ bot: false });
        assert.doesNotThrow(() => cleanKill(agent, '[LoginGuard] Disconnected: socketClosed'));
        assert.deepEqual(agent.events, [
            ['history.add', 'system', '[LoginGuard] Disconnected: socketClosed'],
            ['history.save'],
        ]);
        assert.deepEqual(exits.map((e) => e.code), [1]);
    });

    for (const failing of ['add', 'chat', 'save']) {
        test(`${failing}() throws: no throw, process.exit(code) is still called`, () => {
            const agent = makeAgent();
            const target = failing === 'chat' ? agent.bot : agent.history;
            target[failing] = () => {
                throw new Error(`${failing} failed`);
            };
            assert.doesNotThrow(() => cleanKill(agent, 'reason', 3));
            assert.deepEqual(exits.map((e) => e.code), [3]);
            assert.equal(exitLines().length, 1);
            if (failing !== 'save') assert.ok(agent.events.some((e) => e[0] === 'history.save'), 'the history is still saved');
        });
    }
});
