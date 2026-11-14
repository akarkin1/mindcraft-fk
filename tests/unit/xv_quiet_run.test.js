// Spec v0.1.4.16, F9 (engineer E2): the quiet flag through handleMessage. A command that comes from the watch queue carries
// { quiet: true } as the third argument of handleMessage: no echo `*<owner> used <command>*` reaches openChat and the model's
// command echo (show_command_syntax) is skipped; the command's own lines (its result) are unchanged; a typed command is
// echoed as before. The old third argument (a number, max_responses) still works. The flag goes on to executeCommand as
// `quiet` in its options and into agent.last_order, where F8 reads it.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

async function importQuietly() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        const index = await loadSrc('src/agent/commands/index.js');
        const agent = await loadSrc('src/agent/agent.js');
        return { settingsModule, index, agent };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const M = await importQuietly();
const BASE = { language: 'en', max_commands: -1, show_command_syntax: 'full', only_chat_with: [], max_command_result_chars: 0, say_results: false };

let cap;
beforeEach(() => {
    cap = captureConsole();
    M.settingsModule.setSettings({ ...BASE });
});
afterEach(() => cap.restore());

// A fake agent on Agent.prototype (as glue_agent): openChat records what reaches the game chat; routeResponse is the real one.
function makeAgent(replies = []) {
    const { Agent } = M.agent;
    const agent = Object.create(Agent.prototype);
    const turns = [];
    Object.assign(agent, {
        name: 'andy', shut_up: false, last_sender: null, last_order: null, task: { data: null },
        bot: { time: { timeOfDay: 1000 }, modes: { flushBehaviorLog: () => '' } },
        history: { turns, async add(name, content) { turns.push([name, content]); }, save() {}, getHistory: () => [] },
        self_prompter: { shouldInterrupt: () => false, isActive: () => false, handleUserPromptedCmd() {} },
        prompter: { calls: 0, async promptConvo() { this.calls++; return replies.length ? replies.shift() : ''; } },
        opened: [],
    });
    agent.openChat = async (message) => { agent.opened.push(message); };
    return agent;
}

// !modes answers a fixed text and records the options executeCommand got (through agent.last_order).
let modes;
let original;
let seen;
beforeEach(() => {
    seen = [];
    modes = M.index.getCommand('!modes');
    original = modes.perform;
    modes.perform = (agent) => {
        seen.push(agent.last_order ? { ...agent.last_order } : null);
        return 'MODES';
    };
});
afterEach(() => {
    modes.perform = original;
});

describe('the quiet flag of handleMessage (F9)', () => {
    test('a typed command is echoed, a quiet one is not; the result is routed in both cases', async () => {
        const loud = makeAgent();
        assert.equal(await loud.handleMessage('bob', '!modes'), true);
        assert.deepEqual(loud.opened, ['*bob used modes*', 'MODES']);
        const quiet = makeAgent();
        assert.equal(await quiet.handleMessage('bob', '!modes', { quiet: true }), true);
        assert.deepEqual(quiet.opened, ['MODES'], 'no *used* line; the command\'s own result as before');
        assert.equal(seen.length, 2);
        assert.equal(seen[0].quiet, false, 'the order of a typed command');
        assert.equal(seen[1].quiet, true, 'the order of a quiet command carries the flag (F8 reads it)');
        assert.deepEqual(Object.keys(seen[1]).sort(), ['at', 'atTimeOfDay', 'by', 'command', 'quiet', 'text', 'typed']);
    });

    test('the model\'s command echo is skipped for a quiet message; the words before the command are said; the flag reaches the model\'s command', async () => {
        // the result of the model's command goes into the history, not into the chat (as before, without say_results)
        const loud = makeAgent(['I look. !modes', '']);
        await loud.handleMessage('bob', 'modes?');
        assert.deepEqual(loud.opened, ['I look. !modes'], 'show_command_syntax full: the command is echoed');
        assert.deepEqual(loud.history.turns.at(-1), ['system', 'MODES'], 'the result in the history');
        const quiet = makeAgent(['I look. !modes', '']);
        await quiet.handleMessage('bob', 'modes?', { quiet: true });
        assert.deepEqual(quiet.opened, ['I look.'], 'the echo of the command is skipped, the words before it are said');
        assert.deepEqual(quiet.history.turns.at(-1), ['system', 'MODES'], 'the result is unchanged');
        assert.equal(seen[1].quiet, true);
        assert.equal(seen[1].typed, false);
        const bare = makeAgent(['!modes', '']);
        await bare.handleMessage('bob', 'modes?', { quiet: true });
        assert.deepEqual(bare.opened, [], 'nothing before the command: nothing echoed');
    });

    test('the old third argument (a number) is max_responses; an object may carry it too', async () => {
        const two = makeAgent(['!modes', '!modes', '!modes']);
        await two.handleMessage('bob', 'talk', 2);
        assert.equal(two.prompter.calls, 2, 'two answers at most');
        assert.equal(seen.length, 2);
        const one = makeAgent(['!modes', '!modes']);
        await one.handleMessage('bob', 'talk', { quiet: true, max_responses: 1 });
        assert.equal(one.prompter.calls, 1);
        assert.equal(seen.length, 3);
        assert.equal(seen[2].quiet, true);
        const none = makeAgent(['!modes', '']);
        await none.handleMessage('bob', 'talk');
        assert.equal(none.prompter.calls, 2, 'without a limit the loop ends with the empty answer');
    });

    test('an unknown command answers as before, quiet or not', async () => {
        const agent = makeAgent();
        assert.equal(await agent.handleMessage('bob', '!noSuchThing', { quiet: true }), false);
        assert.deepEqual(agent.opened, ["Command '!noSuchThing' does not exist."]);
    });
});
