// Spec v0.1.4.13, 4.2 (part N1, engineer E2): the chat handler respondFunc of src/agent/agent.js hands the line
// without the address on; a line for another bot (other_bots or an agent of the mindserver) or for the supervisor
// never reaches handleMessage, so no model is called for the bot that is not meant.
//   - the handlers of _setupEventHandlers on a fake agent (as wd_agent_chat.test.js): "claude, come here" reaches
//     handleMessage as "come here"; "gpt, come here" and "Opus, where is it" do not; "come here" does, as before;
//   - the dropped line gets one console line only with verbose_commands, with its reason.
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
const BASE = { language: 'en', only_chat_with: [OWNER], other_bots: ['gpt'], verbose_commands: false, home_pack: false, supervisor_name: 'Opus' };

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
        name: 'claude',
        bot: { on: (event, fn) => { handlers[event] = fn; }, autoEat: {} },
        history: { add: () => {} },
        openChat: () => {},
        handleMessage: async (from, text) => { handled.push({ from, text }); return true; },
    });
    await agent._setupEventHandlers(null, null);
    return { agent, handlers, handled };
}

const dropLines = () => cap.of('log').map((r) => r.text).filter((l) => / does not answer /.test(l));

describe('N1: the whisper handler hands the rest on', () => {
    test('"claude, come here" reaches handleMessage as "come here"; "hey claude come" as "come"', async () => {
        const { handlers, handled } = await chatAgent({});
        await handlers.whisper(OWNER, 'claude, come here');
        await handlers.whisper(OWNER, 'hey Claude come');
        assert.deepEqual(handled, [{ from: OWNER, text: 'come here' }, { from: OWNER, text: 'come' }]);
    });

    test('a line for the other bot or for the supervisor never reaches handleMessage', async () => {
        const { handlers, handled } = await chatAgent({});
        await handlers.whisper(OWNER, 'gpt, come here');
        await handlers.whisper(OWNER, 'ok so gpt wait');
        await handlers.whisper(OWNER, 'Opus, where is it?');
        assert.deepEqual(handled, []);
        assert.equal(dropLines().length, 0, 'no console line without verbose_commands');
    });

    test('an agent of the mindserver is a name too, without other_bots', async () => {
        const { handlers, handled } = await chatAgent({ other_bots: [] });
        convoManager.updateAgents([{ name: 'andy', in_game: true }, { name: 'claude', in_game: true }]);
        await handlers.whisper(OWNER, 'andy, come here');
        await handlers.whisper(OWNER, 'claude, come here');
        assert.deepEqual(handled, [{ from: OWNER, text: 'come here' }]);
    });

    test('a line without a name, with the name inside, or with both names: handed on as it is', async () => {
        const { handlers, handled } = await chatAgent({});
        await handlers.whisper(OWNER, 'come here');
        await handlers.whisper(OWNER, 'tell gpt to wait');
        await handlers.whisper(OWNER, 'claude and gpt, come here');
        assert.deepEqual(handled, [
            { from: OWNER, text: 'come here' }, { from: OWNER, text: 'tell gpt to wait' }, { from: OWNER, text: 'claude and gpt, come here' },
        ]);
    });

    test('the own name alone is handed on as it is', async () => {
        const { handlers, handled } = await chatAgent({});
        await handlers.whisper(OWNER, 'claude?');
        assert.deepEqual(handled, [{ from: OWNER, text: 'claude?' }]);
    });

    test('verbose_commands: one console line per dropped line with its reason', async () => {
        const { handlers, handled } = await chatAgent({ verbose_commands: true });
        await handlers.whisper(OWNER, 'gpt, come here');
        await handlers.whisper(OWNER, 'Opus, where is it?');
        assert.deepEqual(handled, []);
        assert.deepEqual(dropLines(), [
            `claude does not answer ${OWNER} (addressed_other): gpt, come here`,
            `claude does not answer ${OWNER} (addressed_supervisor): Opus, where is it?`,
        ]);
    });

    test('supervisor_name not set (an old settings file): "Opus, ..." is a line like any other', async () => {
        const { handlers, handled } = await chatAgent({ supervisor_name: undefined });
        await handlers.whisper(OWNER, 'Opus, where is it?');
        assert.deepEqual(handled, [{ from: OWNER, text: 'Opus, where is it?' }]);
    });
});

describe('N1: the chat handler', () => {
    test('open chat while the mindserver knows no other agent: the address applies as in a whisper', async () => {
        const { handlers, handled } = await chatAgent({});
        M.proxy.serverProxy.agents = [{ name: 'claude' }];
        handlers.chat(OWNER, 'claude, come here');
        handlers.chat(OWNER, 'gpt, come here');
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(handled, [{ from: OWNER, text: 'come here' }]);
    });
});
