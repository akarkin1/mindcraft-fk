// Shared code of the end-to-end tests: fake server control, settings, bot creation,
// fake agent construction, checks, phases and cleanup.
//
// Every scenario process runs with its working directory set to a fresh temp directory
// (created by run.js), so every relative path of the project ('./bots/...') lands there.
// Project modules are imported by absolute file URL.
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(E2E_DIR, '..', '..');
export const MODEL = 'claude-haiku-4-5-20251001';

export const projectUrl = (rel) => pathToFileURL(path.join(ROOT, rel)).href;
export const importProject = (rel) => import(projectUrl(rel));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function withTimeout(promise, ms, label) {
    let t;
    const timer = new Promise((_, reject) => {
        t = setTimeout(() => reject(new Error(`timeout after ${ms} ms: ${label}`)), ms);
    });
    return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

export const errText = (e) => {
    try { return (e && e.stack) ? String(e.stack) : String(e); } catch { return '[unprintable]'; }
};

// ---------------------------------------------------------------- temp directory

export function makeTempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-e2e-'));
    fs.mkdirSync(path.join(dir, 'bots'));
    for (const f of ['execTemplate.js', 'lintTemplate.js']) {
        fs.copyFileSync(path.join(ROOT, 'bots', f), path.join(dir, 'bots', f));
    }
    // The coder lints with `new ESLint()`, which looks for the flat config upwards from the
    // working directory. The bot always runs from the repository root; here the working
    // directory is the temp dir, so it gets a config that re-exports the repository's one
    // (its imports then resolve against the repository's node_modules).
    fs.writeFileSync(path.join(dir, 'eslint.config.mjs'),
        `export { default } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'eslint.config.js')).href)};\n`);
    return dir;
}

export function removeDir(dir) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    return !fs.existsSync(dir);
}

// All files (not directories) below dir, as paths relative to dir with forward slashes.
export function listFiles(dir) {
    const found = [];
    const walk = (d, rel) => {
        let entries;
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) walk(path.join(d, e.name), r);
            else found.push(r);
        }
    };
    walk(dir, '');
    return found.sort();
}

export function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ---------------------------------------------------------------- checks

const results = [];

// A label that starts with [M1], [M2] or [M3] marks an expectation of spec amendment 1.
export function check(ok, label, details = '') {
    const pass = Boolean(ok);
    results.push({ pass, label });
    console.log(`CHECK ${pass ? 'PASS' : 'FAIL'} ${label}${details ? ' :: ' + details : ''}`);
    return pass;
}

export function note(text) {
    console.log(`NOTE ${text}`);
}

export const failedChecks = () => results.filter((r) => !r.pass);

// ---------------------------------------------------------------- fake server

export async function startServer({ seedHigh = 0, seedLow = 0, motd = 'e2e fake server', age = 1000,
    hardcore = false, dimension = 'overworld', pos = '0.5,64,0.5', commands = false } = {}) {
    const args = [path.join(E2E_DIR, 'fake_server.js'),
        `--seed-high=${seedHigh}`, `--seed-low=${seedLow}`, `--motd=${motd}`, `--age=${age}`,
        `--hardcore=${hardcore}`, `--dimension=${dimension}`, `--pos=${pos}`, `--commands=${commands}`];
    const child = spawn(process.execPath, args, {
        cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    const exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })));
    const waiters = [];
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
        if (!line.startsWith('CHAT ')) console.log('    ' + line);
        for (const w of waiters.slice()) {
            if (w.re.test(line)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(line); }
        }
    });
    readline.createInterface({ input: child.stderr }).on('line', (line) => console.log('    [srv-stderr] ' + line));
    const waitLine = (re, ms, label) => withTimeout(new Promise((resolve) => waiters.push({ re, resolve })), ms, label);
    const portLine = await Promise.race([
        waitLine(/^PORT=\d+$/, 15000, 'fake server port'),
        exited.then((x) => { throw new Error(`fake server exited early: ${JSON.stringify(x)}`); }),
    ]);
    const port = Number(portLine.slice(5));
    return {
        port,
        async chats() {
            const p = waitLine(/^CHAT /, 5000, 'fake server chat list');
            child.stdin.write('chat\n');
            return JSON.parse((await p).slice(5));
        },
        async stop() {
            try { child.stdin.write('quit\n'); child.stdin.end(); } catch { /* gone */ }
            try {
                return await withTimeout(exited, 8000, 'fake server exit');
            } catch (e) {
                child.kill();
                throw e;
            }
        },
    };
}

// ---------------------------------------------------------------- settings, sandbox

// Loads the fork's settings.js, points it at the fake server and applies the overrides.
export async function setupSettings(name, port, overrides = {}) {
    const fileSettings = (await importProject('settings.js')).default;
    const mod = await importProject('src/agent/settings.js');
    mod.setSettings({
        ...JSON.parse(JSON.stringify(fileSettings)),
        profile: { name, model: MODEL },
        host: '127.0.0.1',
        port,
        auth: 'offline',
        minecraft_version: '1.21.8',
        ...overrides,
    });
    return mod.default;
}

// Same order as Agent.start: the whole module graph of agent.js first, then the lockdown,
// then the bot.
export async function lockdown(settings) {
    await importProject('src/agent/agent.js');
    const lk = await importProject('src/agent/library/lockdown.js');
    const ret = lk.initSandbox(settings);
    return { ret, locked: lk.isLockedDown() };
}

// ---------------------------------------------------------------- bot and agent

export async function connectBot(name) {
    const { initBot } = await importProject('src/utils/mcdata.js');
    const bot = initBot(name);
    bot.on('error', (err) => console.log('  [bot error] ' + errText(err)));
    bot.on('kicked', (reason) => console.log('  [bot kicked] ' + JSON.stringify(reason)));
    return bot;
}

export async function waitSpawn(bot, ms = 20000) {
    const loginP = new Promise((r) => bot.once('login', r));
    const spawnP = new Promise((r) => bot.once('spawn', r));
    await withTimeout(Promise.all([loginP, spawnP]), ms, 'login and spawn');
}

export async function quitBot(bot) {
    if (!bot) return;
    const endP = new Promise((r) => bot.once('end', r));
    try { bot.quit(); } catch { /* already gone */ }
    await withTimeout(endP, 5000, 'bot end').catch((e) => note(e.message));
}

// Agent object with the real History, MemoryBank, SelfPrompter and ActionManager,
// built in the order of Agent.start. worldMemory: History with defer_storage, as
// agent.js constructs it when settings.world_memory is on; otherwise new History(agent).
export async function createAgent(name, { worldMemory }) {
    const { History } = await importProject('src/agent/history.js');
    const { MemoryBank } = await importProject('src/agent/memory_bank.js');
    const { SelfPrompter } = await importProject('src/agent/self_prompter.js');
    const { ActionManager } = await importProject('src/agent/action_manager.js');
    const agent = {
        name,
        last_sender: null,
        shut_up: false,
        count_id: 0,
        chats: [],
        bot: null,
    };
    agent.openChat = async (message) => { agent.chats.push(message); };
    agent.clearBotLogs = () => { if (agent.bot) { agent.bot.output = ''; agent.bot.interrupt_code = false; } };
    agent.requestInterrupt = () => { if (agent.bot) agent.bot.interrupt_code = true; };
    agent.isIdle = () => !agent.actions.executing;
    agent.cleanKill = (msg) => { throw new Error('cleanKill called: ' + msg); };
    agent.actions = new ActionManager(agent);
    agent.history = worldMemory ? new History(agent, { defer_storage: true }) : new History(agent);
    agent.memory_bank = new MemoryBank();
    agent.self_prompter = new SelfPrompter(agent);
    agent.task = { taskStartTime: Date.now(), blocked_actions: [] };
    return agent;
}

// Connects the agent's bot; with worldMemory a real WorldMemory is attached right after initBot.
export async function connectAgent(agent, settings, { worldMemory }) {
    let WorldMemory = null;
    if (worldMemory) ({ WorldMemory } = await importProject('src/agent/world/world_memory.js'));
    const bot = await connectBot(agent.name);
    agent.bot = bot;
    if (worldMemory) {
        agent.world_memory = new WorldMemory({ name: agent.name, settings, history: agent.history, memoryBank: agent.memory_bank });
        agent.world_memory.attach(bot);
    }
    bot.output = '';
    bot.interrupt_code = false;
    // modes are not started; 'cheat' makes goToPosition teleport with a /tp chat command,
    // which the fake server records, instead of path finding through unloaded chunks
    bot.modes = { isOn: (m) => m === 'cheat', pause() {}, unpause() {}, flushBehaviorLog: () => '', getMiniDocs: () => 'MODES: (stub)' };
    await waitSpawn(bot);
    return bot;
}

// Resolves the world through the real glue of the spawn handler, Agent.prototype._resolveWorld
// (calls WorldMemory.resolve with getDimension, adds the note as a system turn, sets
// task.taskStartTime). Returns the resolve result (WorldMemory.world) and checks that the glue
// returned its saveData.
export async function resolveWorld(agent, loadMemory) {
    const { Agent } = await importProject('src/agent/agent.js');
    if (typeof Agent.prototype._resolveWorld !== 'function') throw new Error('Agent.prototype._resolveWorld not found');
    const saveData = await Agent.prototype._resolveWorld.call(agent, loadMemory);
    const result = agent.world_memory.world;
    if (!result) throw new Error('WorldMemory.world is null after _resolveWorld');
    if ((result.saveData ?? null) !== (saveData ?? null)) check(false, '_resolveWorld returns the saveData of the resolve result');
    return result;
}

// Runs a command line through the real command parser. commands/index.js is imported
// first (spec amendment M8).
export async function runCommand(agent, text) {
    const cmds = await importProject('src/agent/commands/index.js');
    const out = await cmds.executeCommand(agent, text);
    return out === undefined || out === null ? '' : String(out);
}

// ---------------------------------------------------------------- phases

// A scenario may need several processes (a new process per world visit). The scenario
// file runs "main" in the process started by run.js and starts itself again with
// --phase=<name> for each visit. The phase inherits the working directory (temp dir).
export async function runPhase(file, phase, env = {}, ms = 40000) {
    const child = spawn(process.execPath, [file, `--phase=${phase}`], {
        cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
        env: { ...process.env, ...env },
    });
    const lines = [];
    const onLine = (line) => { lines.push(line); console.log(`  [${phase}] ${line}`); };
    readline.createInterface({ input: child.stdout }).on('line', onLine);
    readline.createInterface({ input: child.stderr }).on('line', (l) => onLine('[stderr] ' + l));
    const exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })));
    let ex;
    try {
        ex = await withTimeout(exited, ms, `phase ${phase}`);
    } catch {
        child.kill();
        ex = { code: null, signal: 'timeout' };
    }
    await sleep(50); // let readline flush
    const failed = lines.filter((l) => l.startsWith('CHECK FAIL'));
    const data = {};
    for (const l of lines) {
        const m = /^DATA (\w+) (.*)$/.exec(l);
        if (m) data[m[1]] = JSON.parse(m[2]);
    }
    check(ex.code === 0 && failed.length === 0, `phase ${phase} finished`,
        `exit code ${ex.code}${ex.signal ? ' signal ' + ex.signal : ''}, ${failed.length} failed check(s)`);
    return { code: ex.code, lines, failed, data };
}

export function emitData(key, value) {
    console.log(`DATA ${key} ${JSON.stringify(value)}`);
}

// Entry point of a scenario file: runs handlers[phase] (or handlers.main) and exits with
// 0 only if no check failed. If the event loop does not end by itself, the leftover
// handles are reported and the process exits anyway.
export async function scenarioMain(handlers) {
    const arg = process.argv.slice(2).find((a) => a.startsWith('--phase='));
    const phase = arg ? arg.slice('--phase='.length) : 'main';
    try {
        const fn = handlers[phase];
        if (typeof fn !== 'function') throw new Error(`unknown phase ${phase}`);
        await fn();
    } catch (e) {
        check(false, `${phase} ran without exception`, errText(e));
    }
    const failed = failedChecks();
    console.log(`END ${phase} ${failed.length === 0 ? 'PASS' : 'FAIL'} (${results.length} checks, ${failed.length} failed)`);
    process.exitCode = failed.length === 0 ? 0 : 1;
    setTimeout(() => {
        const handles = process._getActiveHandles().map((h) => h && h.constructor && h.constructor.name);
        note(`event loop of ${phase} still alive 5 s after the end; active handles ${JSON.stringify(handles)}; exiting`);
        process.exit(process.exitCode);
    }, 5000).unref();
}

// The hashed seed key expected from the two 32-bit words, computed with BigInt.
export function expectedSeedKey(high, low) {
    const value = (BigInt.asUintN(32, BigInt(high)) << 32n) | BigInt.asUintN(32, BigInt(low));
    return 'seed-' + value.toString(16).padStart(16, '0');
}

// ---------------------------------------------------------------- real agent (v0.1.4.4)

// All modes of the profile off: the bot does nothing by itself, only the tested code acts.
export const MODES_OFF = {
    self_preservation: false, unstuck: false, cowardice: false, self_defense: false, hunting: false,
    item_collecting: false, torch_placing: false, elbow_room: false, idle_staring: false, cheat: false,
};

// The Prompter reads ./profiles/defaults/*.json from the working directory (the temp dir).
export function copyProfiles() {
    const from = path.join(ROOT, 'profiles', 'defaults');
    const to = path.join(process.cwd(), 'profiles', 'defaults');
    fs.mkdirSync(to, { recursive: true });
    for (const f of fs.readdirSync(from)) {
        if (f.endsWith('.json')) fs.copyFileSync(path.join(from, f), path.join(to, f));
    }
}

// Stand-in for a language model: records every request and answers from two queues. Nothing
// leaves the process. `replies` answers coding prompts (code model) or conversation prompts
// (chat model); `reviews` answers skill review prompts, recognised by the first words of the
// skill_review template. An answer that is a function is called with the request (it may throw).
export function fakeModel(label) {
    const model = {
        label,
        requests: [],
        replies: [],
        reviews: [],
        async sendRequest(turns, systemMessage) {
            const prompt = String(systemMessage ?? '');
            const kind = prompt.startsWith('You are reviewing code that the Minecraft bot') ? 'review' : label;
            const request = { kind, prompt, turns: JSON.parse(JSON.stringify(turns ?? [])) };
            model.requests.push(request);
            const next = (kind === 'review' ? model.reviews : model.replies).shift();
            if (typeof next === 'function') return next(request);
            if (next !== undefined) return next;
            return label === 'chat' ? '' : 'e2e stub: no more canned replies';
        },
        async sendVisionRequest() { throw new Error('e2e: no vision model'); },
        async embed() { throw new Error('e2e: no embedding model'); },
        of(kind) { return model.requests.filter((r) => r.kind === kind); },
        reset() { model.requests.length = 0; model.replies.length = 0; model.reviews.length = 0; },
    };
    return model;
}

// Every model class of src/models gets request methods that throw, so nothing can leave the
// process. Chat and vision requests that bypass the fake models are recorded in the returned
// array; embed is expected (the Prompter embeds its examples, and falls back to word overlap).
export async function blockRealModels() {
    const attempts = [];
    const dir = path.join(ROOT, 'src', 'models');
    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.js') || f === 'prompter.js' || f === '_model_map.js') continue;
        let mod;
        try { mod = await importProject(`src/models/${f}`); } catch { continue; }
        for (const cls of Object.values(mod)) {
            if (typeof cls !== 'function' || !cls.prototype || !Object.prototype.hasOwnProperty.call(cls, 'prefix')) continue;
            for (const method of ['sendRequest', 'sendVisionRequest', 'embed']) {
                cls.prototype[method] = async function blocked() {
                    if (method !== 'embed') attempts.push(`${cls.name}.${method}`);
                    throw new Error(`e2e: real model call blocked (${cls.name}.${method})`);
                };
            }
        }
    }
    return attempts;
}

// Runs the real Agent.start (with its lockdown, Prompter, Coder, SkillManager, command blacklist,
// initBot and spawn handler) against the fake server. Replaced are only the language model (two
// fakeModel objects, installed before the first request can be sent) and the MindServer
// connection (a socket stub). Returns when the spawn handler has set up the event handlers.
export async function startRealAgent(name, port, overrides = {}) {
    copyProfiles();
    const settings = await setupSettings(name, port, {
        world_memory: false, speak: false, render_bot_view: false, log_all_prompts: false,
        allow_vision: false, only_chat_with: [], code_timeout_mins: -1,
        ...overrides,
        profile: { name, model: MODEL, modes: { ...MODES_OFF }, cooldown: 0, ...(overrides.profile || {}) },
    });
    const realCalls = await blockRealModels();
    const { Agent } = await importProject('src/agent/agent.js');
    const { serverProxy } = await importProject('src/agent/mindserver_proxy.js');
    serverProxy.socket = { emit() {}, on() {} };
    const agent = new Agent();
    serverProxy.setAgent(agent);
    const chat = fakeModel('chat');
    const code = fakeModel('coding');
    const started = agent.start(false, null, 0, false);
    // start() ran synchronously up to its first await: the Prompter exists, no request was sent
    if (agent.prompter) {
        agent.prompter.chat_model = chat;
        agent.prompter.code_model = code;
        agent.prompter.vision_model = chat;
    }
    await withTimeout(started, 30000, 'Agent.start');
    await withTimeout(new Promise((r) => agent.bot.once('spawn', r)), 20000, 'agent spawn');
    const t0 = Date.now();
    while (typeof agent.respondFunc !== 'function') {
        if (Date.now() - t0 > 10000) throw new Error('spawn handler did not set up the event handlers within 10 s');
        await sleep(50);
    }
    return { agent, settings, chat, code, realCalls };
}

// Leaves the server without the process exit that the disconnect handlers of Agent.start do.
export async function stopRealAgent(agent) {
    if (!agent?.bot) return;
    agent._disconnectHandled = true;
    await quitBot(agent.bot);
}

// A started Agent keeps its update loop running; the process ends shortly after scenarioMain.
export function exitSoon(ms = 300) {
    setTimeout(() => process.exit(process.exitCode ?? 0), ms).unref();
}

// Contents of all files below dir, keyed by path relative to dir ({} when dir is missing).
export function snapshotDir(dir) {
    const snap = {};
    for (const f of listFiles(dir)) snap[f] = fs.readFileSync(path.join(dir, f), 'utf8');
    return snap;
}

export const sameSnapshot = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Records the text of every console.<method> call from now on; the output is still printed.
// Install it before startRealAgent: the lockdown then wraps this function like the original.
export function recordConsole(method) {
    const lines = [];
    const original = console[method];
    console[method] = function recorded(...args) {
        try {
            lines.push(args.map((a) => (a && typeof a.stack === 'string' ? a.stack : String(a))).join(' '));
        } catch { /* unprintable argument */ }
        return original.apply(this, args);
    };
    return lines;
}

// A model reply with one code block.
export const codeReply = (code) => 'Here is the code.\n' + '`'.repeat(3) + 'javascript\n' + code + '\n' + '`'.repeat(3);
