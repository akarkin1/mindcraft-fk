// E3, spec v0.1.4.16 F8 ("orders stay orders", the play of 2026-11-11: the model started !collectBlocks by itself and stopped the
// supervisor's commands): executeCommand refuses a work command (WORK_COMMANDS) the model picks on its own, when the message
// it answered is the bot's own line or an AUTO MESSAGE of a mode, with `I do not start work without an order from the player
// or the supervisor.` (returned, not said); a !stop or !setMode of the model while a command the player or the supervisor
// typed runs is refused with `That is the player's order; I do not stop it.`; the player's typed commands, the system orders
// (a job's resume, a routine's round), the model's commands in answer to a player and the supervisor's quiet commands (F9)
// pass. The commands module is imported with an empty temp directory as working directory (nothing may read a keys.json).
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

register('../helpers/mcdata_hooks.js', import.meta.url);

async function importQuietly() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        return await loadSrc('src/agent/commands/index.js');
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const C = await importQuietly();

const AUTO = '(AUTO MESSAGE)Your previous action \'action:collectBlocks\' was interrupted by unstuck.\n        Your behavior log: \nRespond accordingly.';
const WOOD_OFF = 'The wood pack is off.';
const CHOP = 'I will get some logs. !chopTrees(8, "")';

// An agent with a history and the little that !stop and !setMode touch.
function makeAgent(turns, running = []) {
    const agent = {
        name: 'andy',
        history: { turns },
        running_commands: running,
        last_order: null,
        job: null,
        repeat_guard: null,
        stopped: [],
        actions: { stop: async (by) => { agent.stopped.push(by); }, cancelResume() {}, executing: false, currentActionLabel: '' },
        clearBotLogs() {},
        self_prompter: { isActive: () => false },
        bot: { emit() {}, modes: { exists: () => true, isOn: () => true, setOn() {}, getDocs: () => '' } },
    };
    return agent;
}

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

describe('F8: the lists and the texts', () => {
    test('WORK_COMMANDS and the two answers, word for word', () => {
        assert.deepEqual([...C.WORK_COMMANDS], ['!collectBlocks', '!mineOre', '!chopTrees', '!farmCycle', '!harvest', '!plant', '!newAction', '!digDown', '!smeltItem', '!craftSupplies']);
        assert.deepEqual([...C.STOP_COMMANDS], ['!stop', '!setMode']);
        assert.equal(C.ORDER_TEXTS.noOrder, 'I do not start work without an order from the player or the supervisor.');
        assert.equal(C.ORDER_TEXTS.playersOrder, "That is the player's order; I do not stop it.");
        // Every name is a command (the spec's !digTunnel was none and is gone: DECISIONS B-4)
        for (const name of C.WORK_COMMANDS) {
            assert.ok(C.commandExists(name), `${name} is a command`);
        }
    });
});

describe('F8: a work command of the model', () => {
    test('after an AUTO MESSAGE of a mode: refused with the text, nothing runs', async () => {
        const agent = makeAgent([{ role: 'user', content: 'steve: hello' }, { role: 'system', content: AUTO }]);
        assert.equal(await C.executeCommand(agent, CHOP, { typed: false }), C.ORDER_TEXTS.noOrder);
        assert.equal(C.orderRefusal(agent, '!chopTrees', 'model', CHOP), C.ORDER_TEXTS.noOrder);
    });

    test('the model\'s own line already in the history (handleMessage adds it before the command runs): still judged by the message before it', async () => {
        const agent = makeAgent([{ role: 'system', content: AUTO }, { role: 'assistant', content: CHOP }]);
        assert.equal(await C.executeCommand(agent, CHOP, { typed: false }), C.ORDER_TEXTS.noOrder);
    });

    test('an AUTO MESSAGE that came as the last sender\'s line (in a conversation): refused too', async () => {
        const agent = makeAgent([{ role: 'user', content: `steve: ${AUTO}` }]);
        assert.equal(await C.executeCommand(agent, CHOP, { typed: false }), C.ORDER_TEXTS.noOrder);
    });

    test('the bot\'s own message (a self prompt in its own name): refused', async () => {
        const agent = makeAgent([{ role: 'user', content: 'steve: hi' }, { role: 'assistant', content: 'I should get wood.' }]);
        assert.equal(await C.executeCommand(agent, CHOP, { typed: false }), C.ORDER_TEXTS.noOrder);
    });

    test('after a player\'s message: the command runs (the wood pack is off in the tests, so its own answer comes)', async () => {
        const agent = makeAgent([{ role: 'user', content: 'steve: get some logs' }]);
        assert.equal(await C.executeCommand(agent, CHOP, { typed: false }), WOOD_OFF);
        const pushed = makeAgent([{ role: 'user', content: 'steve: get some logs' }, { role: 'assistant', content: CHOP }]);
        assert.equal(await C.executeCommand(pushed, CHOP, { typed: false }), WOOD_OFF, 'with the model\'s line pushed already');
    });

    test('a follow-up to the player\'s order (the last message is an Action output or another system line): runs', async () => {
        const agent = makeAgent([{ role: 'user', content: 'steve: mine iron' }, { role: 'assistant', content: '!mineOre("iron", 8)' },
            { role: 'system', content: 'Action output:\nI mined 8 raw_iron.' }]);
        assert.equal(await C.executeCommand(agent, CHOP, { typed: false }), WOOD_OFF);
        const init = makeAgent([{ role: 'system', content: 'Respond with hello world and your name' }]);
        assert.equal(await C.executeCommand(init, CHOP, { typed: false }), WOOD_OFF);
        assert.equal(await C.executeCommand(makeAgent([]), CHOP, { typed: false }), WOOD_OFF, 'no history: nothing to judge by');
    });

    test('the player\'s typed command, a system order (the job\'s resume) and the supervisor\'s quiet command pass after an AUTO MESSAGE', async () => {
        const turns = [{ role: 'system', content: AUTO }];
        assert.equal(await C.executeCommand(makeAgent(turns), '!chopTrees(8, "")', { typed: true, by: 'steve' }), WOOD_OFF);
        assert.equal(await C.executeCommand(makeAgent(turns), '!chopTrees(8, "")', { by: 'system' }), WOOD_OFF);
        assert.equal(await C.executeCommand(makeAgent(turns), CHOP, { typed: false, quiet: true }), WOOD_OFF, 'F9: the watch\'s quiet message is the supervisor\'s order');
        assert.equal(await C.executeCommand(makeAgent(turns), CHOP, { typed: false, by: 'supervisor' }), WOOD_OFF);
        assert.equal(C.orderRefusal(makeAgent(turns), '!chopTrees', 'system', CHOP), null);
        assert.equal(C.orderRefusal(makeAgent(turns), '!chopTrees', 'steve', CHOP), null);
    });

    test('a command that is no work is not refused after an AUTO MESSAGE', async () => {
        const agent = makeAgent([{ role: 'system', content: AUTO }]);
        assert.equal(C.orderRefusal(agent, '!stats', 'model', '!stats'), null);
        assert.equal(C.orderRefusal(agent, '!goToPlayer', 'model', '!goToPlayer("steve", 3)'), null);
        assert.equal(await C.executeCommand(agent, '!stop', { typed: false }), 'Agent stopped.', 'nothing of the player runs: !stop is free');
        assert.deepEqual(agent.stopped, ['!stop']);
    });
});

describe('F8: the supervisor\'s and the player\'s orders the model cannot stop', () => {
    const typedRunning = () => [{ name: '!collectBlocks', args: ['stone', 2], text: '!collectBlocks("stone", 2)', typed: true, by: 'MartyByrde2' }];

    test('!stop by the model while a typed command runs: refused, nothing stopped', async () => {
        const agent = makeAgent([{ role: 'user', content: 'MartyByrde2: how is it going?' }], typedRunning());
        assert.equal(await C.executeCommand(agent, '!stop', { typed: false }), C.ORDER_TEXTS.playersOrder);
        assert.deepEqual(agent.stopped, []);
        assert.equal(C.orderRefusal(agent, '!stop', 'model'), C.ORDER_TEXTS.playersOrder);
    });

    test('!setMode by the model while a typed command runs: refused', async () => {
        const agent = makeAgent([{ role: 'system', content: AUTO }], typedRunning());
        assert.equal(await C.executeCommand(agent, '!setMode("unstuck", false)', { typed: false }), C.ORDER_TEXTS.playersOrder);
    });

    test('the owner\'s own !stop and the supervisor\'s (quiet) !stop work as before', async () => {
        const owner = makeAgent([], typedRunning());
        assert.equal(await C.executeCommand(owner, '!stop', { typed: true, by: 'MartyByrde2' }), 'Agent stopped.');
        assert.deepEqual(owner.stopped, ['!stop']);
        const watch = makeAgent([], typedRunning());
        assert.equal(await C.executeCommand(watch, '!stop', { typed: false, quiet: true }), 'Agent stopped.');
    });

    test('!stop by the model while only its own command runs (typed false): allowed', async () => {
        const agent = makeAgent([{ role: 'user', content: 'steve: ok' }], [{ name: '!collectBlocks', args: [], text: '!collectBlocks("stone", 2)', typed: false }]);
        assert.equal(await C.executeCommand(agent, '!stop', { typed: false }), 'Agent stopped.');
    });
});
