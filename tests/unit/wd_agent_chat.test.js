// Spec v0.1.4.12, 4.6 (part D, engineer E6), D2: the chat and whisper handlers of src/agent/agent.js ask shouldAnswer
// first; conversation.js isOtherAgent is true for other_bots too.
//   - the handlers of _setupEventHandlers on a fake agent (Object.create(Agent.prototype)): a line of the owner is handed
//     to handleMessage; a line of the bot itself, of another bot, a command echo, a result of a bot, a name outside
//     only_chat_with are not; a dropped line gets one console line only with verbose_commands; open chat only while
//     the mindserver knows no other agent (as before);
//   - isOtherAgent: the agents of the mindserver (exact) and the names of other_bots (case-insensitive).
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import '../helpers/st_glue_env.js'; // registers the mcdata hook (once per process)

async function importQuietly() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        const agent = await loadSrc('src/agent/agent.js');
        const convo = await loadSrc('src/agent/conversation.js');
        const proxy = await loadSrc('src/agent/mindserver_proxy.js');
        return { settingsModule, agent, convo, proxy };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const M = await importQuietly();
const convoManager = M.convo.default;
const OWNER = 'MartyByrde2';
const BASE = { language: 'en', only_chat_with: [OWNER], other_bots: ['W_Miner'], verbose_commands: false, home_pack: false };

let cap;
let savedAgents;
beforeEach(() => {
    cap = captureConsole();
    savedAgents = M.proxy.serverProxy.agents;
    M.proxy.serverProxy.agents = [];
    convoManager.updateAgents([]);
});
afterEach(() => {
    cap.restore();
    M.proxy.serverProxy.agents = savedAgents;
    convoManager.updateAgents([]);
});

// A fake agent with the handlers of _setupEventHandlers; returns the handlers and what reached handleMessage.
async function chatAgent(settings) {
    M.settingsModule.setSettings({ ...BASE, ...settings });
    const handlers = {};
    const handled = [];
    const agent = Object.create(M.agent.Agent.prototype);
    Object.assign(agent, {
        name: 'w_farmer',
        bot: { on: (event, fn) => { handlers[event] = fn; }, autoEat: {} },
        history: { add: () => {} },
        openChat: () => {},
        handleMessage: async (from, text) => { handled.push({ from, text }); return true; },
    });
    await agent._setupEventHandlers(null, null);
    return { agent, handlers, handled };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const dropLines = () => cap.of('log').map((r) => r.text).filter((l) => / does not answer /.test(l));
const warnings = () => cap.of('warn').map((r) => r.text);

describe('D2: the whisper handler asks shouldAnswer first', () => {
    test('the owner: handed to handleMessage', async () => {
        const { handlers, handled } = await chatAgent({});
        await handlers.whisper(OWNER, 'where are you?');
        assert.deepEqual(handled, [{ from: OWNER, text: 'where are you?' }]);
    });

    test('the bot itself, another bot (any case), a command echo, a result of a bot, a name outside only_chat_with: dropped', async () => {
        const { handlers, handled } = await chatAgent({});
        await handlers.whisper('w_farmer', 'I am at the farm.');
        await handlers.whisper('w_miner', 'I am in the mine.');
        await handlers.whisper('W_MINER', 'where are you?');
        await handlers.whisper(OWNER, '*MartyByrde2 used stop*');
        await handlers.whisper(OWNER, 'Action output: Collected 4 oak_log.');
        await handlers.whisper(OWNER, 'Found non-destructive path.');
        await handlers.whisper(OWNER, 'You have reached at 1, 2, 3.');
        await handlers.whisper('Steve', 'come here');
        assert.deepEqual(handled, []);
        assert.equal(dropLines().length, 0, 'no console line without verbose_commands');
        assert.ok(!warnings().some((l) => /other bot\?\?/.test(l)), 'no warning about a whisper from another bot');
    });

    test('verbose_commands: one console line per dropped line, none for the bot\'s own line', async () => {
        const { handlers, handled } = await chatAgent({ verbose_commands: true });
        await handlers.whisper('w_farmer', 'I am at the farm.');
        await handlers.whisper('w_miner', 'I am in the mine.');
        await handlers.whisper(OWNER, '*MartyByrde2 used stop*');
        await handlers.whisper('Steve', 'come here');
        assert.deepEqual(handled, []);
        assert.deepEqual(dropLines(), [
            'w_farmer does not answer w_miner (other_bot): I am in the mine.',
            `w_farmer does not answer ${OWNER} (command_echo): *MartyByrde2 used stop*`,
            'w_farmer does not answer Steve (not_listened): come here',
        ]);
    });

    test('only_chat_with empty: every player is answered, other_bots still not', async () => {
        const { handlers, handled } = await chatAgent({ only_chat_with: [] });
        await handlers.whisper('Steve', 'come here');
        await handlers.whisper('w_miner', 'come here');
        assert.deepEqual(handled, [{ from: 'Steve', text: 'come here' }]);
    });

    test('other_bots not set (an old settings file): the behaviour of v0.1.4.11', async () => {
        const { handlers, handled } = await chatAgent({ other_bots: undefined, only_chat_with: [] });
        await handlers.whisper('w_miner', 'where are you?');
        await handlers.whisper('w_farmer', 'where are you?');
        assert.deepEqual(handled, [{ from: 'w_miner', text: 'where are you?' }]);
    });

    test('an agent of the mindserver: dropped without the warning "received whisper from other bot??"', async () => {
        const { handlers, handled } = await chatAgent({ only_chat_with: [], other_bots: [] });
        convoManager.updateAgents([{ name: 'andy', in_game: true }, { name: 'w_farmer', in_game: true }]);
        await handlers.whisper('andy', 'hello');
        assert.deepEqual(handled, []);
        assert.ok(!warnings().some((l) => /other bot\?\?/.test(l)), JSON.stringify(warnings()));
    });
});

describe('D2: the chat handler', () => {
    test('open chat while the mindserver knows no other agent: through shouldAnswer as a whisper', async () => {
        const { handlers, handled } = await chatAgent({});
        M.proxy.serverProxy.agents = [{ name: 'w_farmer' }];
        handlers.chat(OWNER, 'where are you?');
        handlers.chat('w_miner', 'I am in the mine.');
        handlers.chat(OWNER, 'Action output: done');
        await settle();
        assert.deepEqual(handled, [{ from: OWNER, text: 'where are you?' }]);
    });

    test('open chat with another agent on the mindserver: not answered, as before', async () => {
        const { handlers, handled } = await chatAgent({});
        M.proxy.serverProxy.agents = [{ name: 'w_farmer' }, { name: 'andy' }];
        handlers.chat(OWNER, 'where are you?');
        await settle();
        assert.deepEqual(handled, []);
    });
});

describe('D2: isOtherAgent', () => {
    test('the agents of the mindserver, exact; the names of other_bots, case-insensitive; anyone else: false', () => {
        M.settingsModule.setSettings({ ...BASE, other_bots: ['W_Miner'] });
        convoManager.updateAgents([{ name: 'andy', in_game: true }]);
        assert.equal(convoManager.isOtherAgent('andy'), true);
        assert.equal(convoManager.isOtherAgent('Andy'), false, 'the mindserver names stay exact');
        assert.equal(convoManager.isOtherAgent('w_miner'), true);
        assert.equal(convoManager.isOtherAgent('W_MINER'), true);
        assert.equal(convoManager.isOtherAgent(OWNER), false);
    });

    test('other_bots empty or not set: only the agents of the mindserver', () => {
        convoManager.updateAgents([]);
        M.settingsModule.setSettings({ ...BASE, other_bots: [] });
        assert.equal(convoManager.isOtherAgent('w_miner'), false);
        M.settingsModule.setSettings({ ...BASE, other_bots: undefined });
        assert.equal(convoManager.isOtherAgent('w_miner'), false);
    });
});
