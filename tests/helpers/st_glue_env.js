// Test environment of the tester T1 for part G of v0.1.4.8 (the glue): the real Agent prototype, the real
// commands, executeCommand and ActionManager, on the fake bot of tests/helpers/st_modes_env.js.
//
// loadGlue() imports the modules in an empty working folder, quietly, so no keys.json and no bots/
// folder of the work folder is read or written. The mcdata hook is registered by st_modes_env.js
// (once per process; a second registration would add its export twice).
//
// makeGlueAgent() gives an object made with Object.create(Agent.prototype): the methods of the agent are
// the real ones (handleMessage, requestInterrupt, _atSpawn, cleanKill, ...), the fields are fakes:
// - history: records the turns ([name, text]) and gives them to the model as messages;
// - prompter.promptConvo: answers with the next text of `replies` ('' when none is left) and counts calls;
// - openChat: records what the bot says in the chat (routeResponse ends there);
// - bot.modes: a small stand-in with the names of `modes` (on/off), pauses and the behaviour log.
import fs from 'node:fs';
import * as espree from 'espree';
import { loadSrc } from './load.js';
import { repoPath } from './paths.js';
import { makeTmpDir, removeTmpDir } from './tmp.js';
import { captureConsole } from './console_capture.js';
import { makeFakeBot, REGISTRY } from './st_modes_env.js';

export { makeFakeBot, REGISTRY };

/**
 * Imports the glue: settings, mcdata (with the data of 1.21.8), commands, agent, action manager.
 * @returns {Promise<object>}
 */
export async function loadGlue() {
    const cwd = process.cwd();
    const empty = makeTmpDir();
    const cap = captureConsole();
    process.chdir(empty);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        const mcdata = await loadSrc('src/utils/mcdata.js');
        mcdata.__setMcdataForTests(REGISTRY);
        const index = await loadSrc('src/agent/commands/index.js');
        const actions = await loadSrc('src/agent/commands/actions.js');
        const queries = await loadSrc('src/agent/commands/queries.js');
        const agentModule = await loadSrc('src/agent/agent.js');
        const am = await loadSrc('src/agent/action_manager.js');
        const repeat = await loadSrc('src/agent/repeat_guard.js');
        return { settingsModule, settings: settingsModule.default, mcdata, index, actions, queries, agentModule, Agent: agentModule.Agent, am, repeat };
    } finally {
        process.chdir(cwd);
        cap.restore();
        removeTmpDir(empty);
    }
}

/** The stand-in of bot.modes. */
export function fakeModes(modes = {}) {
    const on = { ...modes };
    const m = {
        on,
        paused: [],
        progress: [],
        behavior_log: '',
        exists: (name) => Object.hasOwn(on, name),
        isOn: (name) => on[name],
        setOn: (name, value) => { on[name] = value; },
        getDocs: () => 'Agent Modes:' + Object.entries(on).map(([n, v]) => `\n- ${n}(${v ? 'ON' : 'OFF'})`).join(''),
        getMiniDocs: () => 'Agent Modes:',
        pause: (name) => m.paused.push(name),
        unpause() {},
        unPauseAll() {},
        noteProgress: (reason) => m.progress.push(reason),
        flushBehaviorLog() {
            const log = m.behavior_log;
            m.behavior_log = '';
            return log;
        },
    };
    return m;
}

/**
 * A fake agent on the real Agent prototype.
 * @param {object} G the result of loadGlue()
 * @param {{bot?: object, replies?: string[], modes?: object, fields?: object}} [options]
 */
export function makeGlueAgent(G, options = {}) {
    const bot = options.bot ?? makeFakeBot();
    bot.modes = fakeModes(options.modes ?? {});
    const replies = [...(options.replies ?? [])];
    const turns = [];
    const agent = Object.create(G.Agent.prototype);
    Object.assign(agent, {
        name: 'andy',
        bot,
        shut_up: false,
        task: { data: null },
        blocked_actions: [],
        last_order: null,
        last_sender: null,
        running_commands: [],
        last_pack_text: null,
        repeat_guard: null,
        memory_bank: { recall: () => null, getJson: () => ({}) },
        turns,
        chats: [],
        kills: [],
        history: {
            memory: '',
            add: async (name, content) => { turns.push([name, content]); },
            getHistory: () => turns.map(([name, content]) => ({ role: name === 'system' ? 'system' : 'user', content: `${name}: ${content}` })),
            save: async () => {},
        },
        prompter: {
            calls: 0,
            async promptConvo() {
                this.calls++;
                return replies.length > 0 ? replies.shift() : '';
            },
        },
        self_prompter: {
            shouldInterrupt: () => false, isActive: () => false, isStopped: () => true, isPaused: () => false,
            handleUserPromptedCmd() {}, stopLoop() {},
        },
        async openChat(message) { agent.chats.push(message); },
        cleanKill(msg) { agent.kills.push(msg); },
        ...(options.fields ?? {}),
    });
    agent.actions = new G.am.ActionManager(agent);
    return agent;
}

/**
 * The statements `if (<test>) this.blocked_actions.push(...names)` of src/agent/agent.js, read from the
 * syntax tree: which commands the agent hides while a switch is off.
 * @returns {{test: string, names: string[]}[]}
 */
export function blockedPushes() {
    const source = fs.readFileSync(repoPath('src/agent/agent.js'), 'utf8');
    const tree = espree.parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true });
    const pushes = [];
    const visit = (node) => {
        if (!node || typeof node.type !== 'string') return;
        if (node.type === 'IfStatement') {
            const body = node.consequent.type === 'BlockStatement' && node.consequent.body.length === 1 ? node.consequent.body[0] : node.consequent;
            const call = body?.type === 'ExpressionStatement' ? body.expression : null;
            const callee = call?.type === 'CallExpression' ? source.slice(...call.callee.range) : '';
            if (callee === 'this.blocked_actions.push')
                pushes.push({ test: source.slice(...node.test.range), names: call.arguments.map((a) => a.value) });
        }
        for (const [key, value] of Object.entries(node)) {
            if (key === 'range' || key === 'loc') continue;
            if (Array.isArray(value)) value.forEach(visit);
            else if (value && typeof value.type === 'string') visit(value);
        }
    };
    visit(tree);
    return pushes;
}

/** Waits until no action runs (a new action waits up to 300 ms for the one before). */
export async function settle(agent, ms = 5000) {
    const sleep = (t) => new Promise((resolve) => setTimeout(resolve, t));
    await sleep(50);
    const end = Date.now() + ms;
    while (agent.actions.executing && Date.now() < end) await sleep(10);
    await sleep(20);
}
