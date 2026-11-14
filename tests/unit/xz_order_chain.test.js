// FX1, review of v0.1.4.16, findings 1 and 5 (the lead's decision): the order behind the model's commands is a chain that
// handleMessage carries, not a look at the last turn of the history. handleMessage sets agent.order_chain to { by, at }: by the
// source for a player's message (not the bot itself, not 'system') and for a quiet message of the watch (the supervisor), by
// 'model' for an AUTO MESSAGE of a mode, a self prompt and any other system message; the model's commands of that loop read it.
// A work command (WORK_COMMANDS) is refused with `I do not start work without an order from the player or the supervisor.` only
// when the chain is the model's own; a model !stop or !setMode while a player's or the supervisor's command runs is refused
// with `That is the player's order; I do not stop it.` only when the chain is the model's own, so the owner's spoken "stop"
// works. A pack's own line (sayText) and a refusal change nothing of the chain. Cases A to D are the review's (orders.test.mjs
// of review-16): each failed on the one-turn look. The modules are imported with an empty temp directory as working directory
// (nothing may read a keys.json).
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
        const settingsModule = await loadSrc('src/agent/settings.js');
        const C = await loadSrc('src/agent/commands/index.js');
        const agentModule = await loadSrc('src/agent/agent.js');
        return { settingsModule, C, agentModule };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const { settingsModule, C, agentModule } = await importQuietly();

const AUTO = "(AUTO MESSAGE)Your previous action 'action:collectBlocks' was interrupted by unstuck.\n        Your behavior log: \nRespond accordingly.";
const CHOP = '!chopTrees(8, "")';
const WOOD_OFF = 'The wood pack is off.';
const STOPPED = 'Agent stopped.';
const KILL_FARM = () => [{ name: '!killFarm', args: [''], text: '!killFarm("")', typed: true, by: 'Owner' }];
const BASE = { language: 'en', max_commands: -1, show_command_syntax: 'full', only_chat_with: [], max_command_result_chars: 0, say_results: false,
    wood_pack: false };

let cap;
beforeEach(() => {
    cap = captureConsole();
    settingsModule.setSettings({ ...BASE });
});
afterEach(() => cap.restore());

// The fake agent of the review's orders.test.mjs: a history, the little !stop and !setMode touch, and the chain.
function makeAgent(turns, running = [], chain = undefined) {
    const agent = {
        name: 'andy', history: { turns }, running_commands: running, last_order: null, job: null, repeat_guard: null, stopped: [],
        actions: { stop: async (by) => { agent.stopped.push(by); }, cancelResume() {}, executing: false, currentActionLabel: '' },
        clearBotLogs() {}, self_prompter: { isActive: () => false },
        bot: { emit() {}, modes: { exists: () => true, isOn: () => true, setOn() {}, getDocs: () => '' } },
    };
    if (chain !== undefined)
        agent.order_chain = chain;
    return agent;
}

// the owner's words that asked for a stop (G-2: the model's !stop of a typed command needs them, STOP_WORDS)
const player = (by = 'Owner') => ({ by, at: 1000, stop: true });
const model = () => ({ by: 'model', at: 1000 });

describe('the review\'s cases on executeCommand (the chain as handleMessage leaves it in agent.order_chain)', () => {
    test('A: the owner typed !killFarm, then SAID "stop": the model\'s !stop answers the owner and stops', async () => {
        const turns = [{ role: 'user', content: 'Owner: stop' }, { role: 'assistant', content: 'Stopping. !stop' }];
        const agent = makeAgent(turns, KILL_FARM(), player());
        // exactly the options handleMessage passed the model's command before the fix: { typed: false, quiet: false }
        const res = await C.executeCommand(agent, 'Stopping. !stop', { typed: false, quiet: false });
        assert.equal(res, STOPPED);
        assert.deepEqual(agent.stopped, ['!stop']);
        // the same !stop of the model on its own (an AUTO MESSAGE behind it) stays refused
        const own = makeAgent([{ role: 'system', content: AUTO }], KILL_FARM(), model());
        assert.equal(await C.executeCommand(own, '!stop', { typed: false, quiet: false }), C.ORDER_TEXTS.playersOrder);
        assert.deepEqual(own.stopped, []);
        assert.equal(await C.executeCommand(own, '!setMode("unstuck", false)', { typed: false }), C.ORDER_TEXTS.playersOrder);
    });

    test('B: a work command after an AUTO MESSAGE is refused, and so is the retry after the refusal\'s system line', async () => {
        const turns = [{ role: 'system', content: AUTO }, { role: 'assistant', content: CHOP }];
        const agent = makeAgent(turns, [], model());
        const first = await C.executeCommand(agent, CHOP, { typed: false, quiet: false });
        turns.push({ role: 'system', content: first }); // handleMessage: history.add('system', execute_res)
        turns.push({ role: 'assistant', content: CHOP }); // the model tries again
        const second = await C.executeCommand(agent, CHOP, { typed: false, quiet: false });
        assert.equal(first, C.ORDER_TEXTS.noOrder);
        assert.equal(second, C.ORDER_TEXTS.noOrder);
    });

    test('C: AUTO MESSAGE, then a free command, then work: still refused', async () => {
        const turns = [{ role: 'system', content: AUTO }, { role: 'assistant', content: '!stats' }, { role: 'system', content: 'STATS ...' },
            { role: 'assistant', content: CHOP }];
        assert.equal(await C.executeCommand(makeAgent(turns, [], model()), CHOP, { typed: false, quiet: false }), C.ORDER_TEXTS.noOrder);
    });

    test('D: the player ordered work and a reflex line of the bot landed before the model answered: the work runs', async () => {
        const turns = [{ role: 'user', content: 'Owner: get 8 logs' }, { role: 'assistant', content: 'I ate a bread.' }, { role: 'assistant', content: CHOP }];
        assert.equal(await C.executeCommand(makeAgent(turns, [], player()), CHOP, { typed: false, quiet: false }), WOOD_OFF);
    });

    test('the chain handed in the options wins over agent.order_chain (a loop reads its own chain)', async () => {
        const agent = makeAgent([], KILL_FARM(), model());
        assert.equal(await C.executeCommand(agent, '!stop', { typed: false, chain: player() }), STOPPED);
        const other = makeAgent([], [], player());
        assert.equal(await C.executeCommand(other, CHOP, { typed: false, chain: model() }), C.ORDER_TEXTS.noOrder);
        assert.equal(C.orderRefusal(makeAgent([], [], player()), '!chopTrees', 'model', model()), C.ORDER_TEXTS.noOrder);
        assert.equal(C.orderRefusal(makeAgent([], [], model()), '!chopTrees', 'model', player()), null);
    });
});

describe('orderChainOf: who stands behind a message', () => {
    test('a player, another bot and the supervisor\'s quiet message give their source; an AUTO MESSAGE, a self prompt and a system line the model', () => {
        const at = 5;
        assert.deepEqual(C.orderChainOf('Owner', 'get 8 logs', { self: 'andy', at }), { by: 'Owner', at, stop: false });
        assert.deepEqual(C.orderChainOf('bob_bot', 'can you get wood?', { self: 'andy', at }), { by: 'bob_bot', at, stop: false }, 'another bot, as before: its line was a user turn');
        assert.deepEqual(C.orderChainOf('Owner', 'mine iron', { quiet: true, self: 'andy', at }), { by: 'Owner', at, stop: false });
        assert.deepEqual(C.orderChainOf('system', '!collectBlocks("stone", 4)', { quiet: true, self: 'andy', at }), { by: 'supervisor', at, stop: false });
        assert.deepEqual(C.orderChainOf('system', AUTO, { self: 'andy', at }), { by: 'model', at });
        assert.deepEqual(C.orderChainOf('steve', AUTO, { self: 'andy', at }), { by: 'model', at }, 'a mode\'s line in the last sender\'s name');
        assert.deepEqual(C.orderChainOf('andy', 'I should get wood.', { self: 'andy', at }), { by: 'model', at });
        assert.deepEqual(C.orderChainOf('system', "You are self-prompting with the goal: 'get wood'. Respond:", { self: 'andy', at }), { by: 'model', at });
        assert.deepEqual(C.orderChainOf('system', 'You died at position x: 1 ...', { self: 'andy', at }), { by: 'model', at });
        assert.equal(typeof C.orderChainOf('Owner', 'hi').at, 'number');
        assert.deepEqual(C.orderChainOf(null, null, { at }), { by: 'model', at }, 'nothing readable: the model\'s');
    });
});

// --- handleMessage carries the chain -------------------------------------------------------------------------------------------

// A fake agent on Agent.prototype (as xv_quiet_run): the history keeps { role, content } as History does (the bot's own name is
// the assistant, 'system' the system, any other name a user line "name: text"); the prompter answers from `replies`, and
// `during(agent, i)` runs inside the i-th prompt (a pack's line, another message's chain).
function makeHandler(replies = [], { running = [], during = null } = {}) {
    const { Agent } = agentModule;
    const agent = Object.create(Agent.prototype);
    const turns = [];
    Object.assign(agent, {
        name: 'andy', shut_up: false, last_sender: null, last_order: null, task: { data: null }, running_commands: running,
        job: null, repeat_guard: null, stopped: [],
        bot: { time: { timeOfDay: 1000 }, emit() {}, modes: { flushBehaviorLog: () => '', exists: () => true, isOn: () => true, setOn() {}, getDocs: () => '' } },
        history: {
            turns,
            async add(name, content) {
                const role = name === 'andy' ? 'assistant' : name === 'system' ? 'system' : 'user';
                turns.push({ role, content: role === 'user' ? `${name}: ${content}` : content });
            },
            save() {},
            getHistory: () => turns.slice(),
        },
        self_prompter: { shouldInterrupt: () => false, isActive: () => false, handleUserPromptedCmd() {} },
        actions: { stop: async (by) => { agent.stopped.push(by); }, cancelResume() {}, executing: false, currentActionLabel: '' },
        clearBotLogs() {},
        prompter: {
            calls: 0,
            async promptConvo() {
                const i = this.calls++;
                if (during)
                    await during(agent, i);
                return replies.length ? replies.shift() : '';
            },
        },
        opened: [],
    });
    agent.openChat = async (message) => { agent.opened.push(message); };
    return agent;
}

const systemLines = (agent) => agent.history.turns.filter(t => t.role === 'system').map(t => t.content);

// !modes answers a fixed text: a free command of the model (no work, no stop)
let modes;
let original;
beforeEach(() => {
    modes = C.getCommand('!modes');
    original = modes.perform;
    modes.perform = () => 'MODES';
});
afterEach(() => {
    modes.perform = original;
});

describe('handleMessage sets agent.order_chain and hands it to the model\'s commands of its loop', () => {
    test('A: the owner says "stop" while his typed !killFarm runs: the model\'s !stop stops it', async () => {
        const agent = makeHandler(['Stopping. !stop', ''], { running: KILL_FARM() });
        await agent.handleMessage('Owner', 'stop');
        assert.deepEqual(agent.stopped, ['!stop']);
        assert.deepEqual(systemLines(agent), [STOPPED]);
        assert.equal(agent.order_chain.by, 'Owner');
        assert.equal(typeof agent.order_chain.at, 'number');
    });

    test('B: after an AUTO MESSAGE the work is refused, and the retry after the refusal too', async () => {
        const agent = makeHandler([CHOP, CHOP, '']);
        await agent.handleMessage('system', AUTO);
        assert.deepEqual(systemLines(agent).slice(-2), [C.ORDER_TEXTS.noOrder, C.ORDER_TEXTS.noOrder]);
        assert.equal(agent.order_chain.by, 'model', 'the refusal changed nothing');
    });

    test('C: after an AUTO MESSAGE a free command does not launder the next work command', async () => {
        const agent = makeHandler(['!modes', CHOP, '']);
        await agent.handleMessage('system', AUTO);
        assert.deepEqual(systemLines(agent).slice(-2), ['MODES', C.ORDER_TEXTS.noOrder]);
    });

    test('D: a pack\'s line (sayText) lands between the player\'s order and the model\'s answer: the order runs', async () => {
        const agent = makeHandler([CHOP, ''], { during: (a, i) => { if (i === 0) a.sayText('I ate a bread.'); } });
        await agent.handleMessage('Owner', 'get 8 logs');
        assert.ok(agent.history.turns.some(t => t.role === 'assistant' && t.content === 'I ate a bread.'));
        assert.deepEqual(systemLines(agent), [WOOD_OFF]);
        assert.equal(agent.order_chain.by, 'Owner', 'the pack\'s line changed nothing');
    });

    test('a loop keeps its own chain when another message sets agent.order_chain meanwhile', async () => {
        const agent = makeHandler([CHOP, ''], { during: (a) => { a.order_chain = { by: 'model', at: 1 }; } });
        await agent.handleMessage('Owner', 'get 8 logs');
        assert.deepEqual(systemLines(agent), [WOOD_OFF]);
        const own = makeHandler(['!stop', ''], { running: KILL_FARM(), during: (a) => { a.order_chain = { by: 'Owner', at: 1 }; } });
        await own.handleMessage('system', AUTO);
        assert.deepEqual(own.stopped, []);
        assert.deepEqual(systemLines(own).slice(-1), [C.ORDER_TEXTS.playersOrder]);
    });

    test('the supervisor\'s quiet message is an order; a self prompt, the bot\'s own line, a mode\'s line in a sender\'s name and a system line are not', async () => {
        const quiet = makeHandler([CHOP, '']);
        await quiet.handleMessage('Owner', 'get 8 logs', { quiet: true });
        assert.deepEqual(systemLines(quiet), [WOOD_OFF]);
        const quietStop = makeHandler(['!stop', ''], { running: KILL_FARM() });
        await quietStop.handleMessage('Owner', 'stop the farm', { quiet: true });
        assert.deepEqual(quietStop.stopped, ['!stop']);
        for (const [source, message] of [['system', "You are self-prompting with the goal: 'get wood'. Your next response MUST contain a command with this syntax: !commandName. Respond:"],
            ['andy', 'I should get wood.'], ['steve', AUTO], ['system', 'You died at position x: 1, y: 64, z: 2 in the overworld dimension.']]) {
            const agent = makeHandler([CHOP, '']);
            await agent.handleMessage(source, message);
            assert.deepEqual(systemLines(agent).slice(-1), [C.ORDER_TEXTS.noOrder], `${source}: ${message}`);
            assert.equal(agent.order_chain.by, 'model');
        }
    });

    test('a typed command of the player runs as before and sets the chain to the player', async () => {
        const agent = makeHandler();
        agent.order_chain = { by: 'model', at: 1 };
        await agent.handleMessage('Owner', CHOP);
        assert.ok(agent.opened.includes(WOOD_OFF), agent.opened.join(' | '));
        assert.equal(agent.order_chain.by, 'Owner');
    });
});

// The gate of a96685c (G-2, W132 C): the owner's question "how is it going?" answered by the model with !stop while the
// supervisor's run (a typed command) works: refused; the words that ask for a stop pass (STOP_WORDS).
describe('G-2: only words that ask for a stop let the model\'s !stop end a typed command', () => {
    const SUPERVISORS = () => [{ name: '!collectBlocks', args: ['stone', 2], text: '!collectBlocks("stone", 2)', typed: true, by: 'MartyByrde2' }];

    test('W132 C: "how is it going?" answered with !stop ends nothing; the refusal goes to the model', async () => {
        const chain = C.orderChainOf('MartyByrde2', 'how is it going?', { self: 'andy' });
        assert.equal(chain.stop, false);
        const agent = makeAgent([{ role: 'user', content: 'MartyByrde2: how is it going?' }], SUPERVISORS(), chain);
        assert.equal(await C.executeCommand(agent, '!stop', { typed: false, chain }), C.ORDER_TEXTS.playersOrder);
        assert.deepEqual(agent.stopped, []);
        // nothing typed runs: the model's !stop is free as before
        const free = makeAgent([], [], chain);
        assert.equal(await C.executeCommand(free, '!stop', { typed: false, chain }), STOPPED);
    });

    test('the words that ask for a stop pass, also from the supervisor\'s quiet message', async () => {
        for (const words of ['stop', 'Stop the farm please', 'ok that is enough', 'cancel that', 'hold on', 'never mind', 'wait']) {
            const chain = C.orderChainOf('MartyByrde2', words, { self: 'andy' });
            assert.equal(chain.stop, true, words);
            const agent = makeAgent([], SUPERVISORS(), chain);
            assert.equal(await C.executeCommand(agent, '!stop', { typed: false, chain }), STOPPED, words);
        }
        const quiet = C.orderChainOf('system', 'stop', { quiet: true, self: 'andy' });
        assert.deepEqual([quiet.by, quiet.stop], ['supervisor', true]);
        for (const words of ['how is it going?', 'get 8 logs', 'unstoppable', 'the bus stop']) {
            assert.equal(C.orderChainOf('MartyByrde2', words, { self: 'andy' }).stop, words === 'the bus stop', words);
        }
    });

    test('!setMode in a player\'s chain passes whatever the words (the mode command has its own guards)', () => {
        const chain = C.orderChainOf('MartyByrde2', 'turn off the creeper safety', { self: 'andy' });
        assert.equal(C.orderRefusal(makeAgent([], SUPERVISORS(), chain), '!setMode', 'model', chain), null);
    });
});

// Review 16c, finding 1: while the owner's typed job command runs, "come here" is answered by the model with !goToPlayer; the job
// refuses it ("... Say !stop first."), and the model's !stop of the same loop goes through though the words hold no stop word.
describe('16c: the job\'s "Say !stop first" lets the model\'s !stop of the same loop through', () => {
    const MINING = () => [{ name: '!mineOre', args: ['iron', 8], text: '!mineOre("iron", 8)', typed: true, by: 'MartyByrde2' }];
    const BUSY = 'The mining runs, 2 of 8 iron. Say !stop first.';
    const busyJob = () => ({ refusal: (name, by) => (by === 'model' && name !== '!stop' ? BUSY : null), onCommand() {}, onResult() {} });

    test('"come here": the job refuses !goToPlayer, then the !stop passes', async () => {
        const chain = C.orderChainOf('MartyByrde2', 'come here', { self: 'andy' });
        const agent = makeAgent([{ role: 'user', content: 'MartyByrde2: come here' }], MINING(), chain);
        agent.job = busyJob();
        assert.equal(await C.executeCommand(agent, '!goToPlayer("MartyByrde2", 3)', { typed: false, chain }), BUSY);
        assert.equal(chain.jobAsked, true);
        assert.equal(await C.executeCommand(agent, '!stop', { typed: false, chain }), STOPPED);
        assert.deepEqual(agent.stopped, ['!stop']);
    });

    test('without the job\'s refusal in the loop the question\'s !stop stays refused; the model\'s own chain stays refused', async () => {
        const chain = C.orderChainOf('MartyByrde2', 'how is it going?', { self: 'andy' });
        const agent = makeAgent([], MINING(), chain);
        agent.job = busyJob();
        assert.equal(await C.executeCommand(agent, '!stop', { typed: false, chain }), C.ORDER_TEXTS.playersOrder);
        const own = C.orderChainOf('system', AUTO, { self: 'andy' });
        const auto = makeAgent([], MINING(), own);
        auto.job = busyJob();
        assert.equal(await C.executeCommand(auto, '!goToPlayer("MartyByrde2", 3)', { typed: false, chain: own }), BUSY);
        assert.equal(await C.executeCommand(auto, '!stop', { typed: false, chain: own }), C.ORDER_TEXTS.playersOrder);
        assert.deepEqual(auto.stopped, []);
    });
});
