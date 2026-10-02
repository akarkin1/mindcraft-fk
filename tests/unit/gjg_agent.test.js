// Part G of v0.1.4.10 (E5): the job on the agent (I4) in src/agent/agent.js and the call of the model for a plan
// in src/models/prompter.js.
//   - source: createJob of src/agent/job/index.js only with job_memory, inside try, else agent.job is null; the
//     file bots/<name>/job.json; executeCommand of the job is a system order; askModel is promptPlan; at spawn
//     onRestart after the restart note, the timer after the events; !mines and !forgetMine hidden without the
//     mining pack;
//   - withJobLine and knowledgeBlock(): the line of status() right after the where line, within
//     knowledge_max_chars; nothing without a job;
//   - _startJobTimer: tick() every 5 s, not awaited, once, never without a job; cleared at the exit;
//   - _jobAtSpawn: onRestart; _runJobOrder: executeCommand with by 'system' and typed false, the result into
//     the history;
//   - promptPlan: one call of the chat model under the purpose 'plan' of the cost meter;
//   - the whole way with the real createJob, JobStore and executeCommand on a fake agent: a typed !mineOre
//     starts the job, a stopped one keeps the progress, the tick resumes it with the rest as a system order,
//     the done text; job_memory off: no hook.
// Agent.prototype methods are called on fake agents made with Object.create(Agent.prototype).
import { describe, test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { blockedPushes } from '../helpers/st_glue_env.js'; // registers the mcdata hook (once per process)

async function importQuietly() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        const index = await loadSrc('src/agent/commands/index.js');
        const agent = await loadSrc('src/agent/agent.js');
        const prompter = await loadSrc('src/models/prompter.js');
        return { settingsModule, index, agent, prompter };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const M = await importQuietly();
const { Agent } = M.agent;
const JOB = await loadSrc('src/agent/job/index.js');
const KT = await loadSrc('src/agent/knowledge/knowledge_text.js');
const USAGE = await loadSrc('src/agent/cost/usage_context.js');
const SOURCE = fs.readFileSync(repoPath('src/agent/agent.js'), 'utf8').replace(/\r\n/g, '\n');

const OFF = { language: 'en', world_memory: true, mining_pack: false, knowledge_in_prompt: false, job_memory: false, restart_context: false,
    home_pack: false, blocked_actions: [] };

let cap;
let dir;
beforeEach(() => {
    cap = captureConsole();
    dir = makeTmpDir();
    M.settingsModule.setSettings({ ...OFF });
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

const fakeAgent = (fields = {}) => Object.assign(Object.create(Agent.prototype), { name: 'andy', bot: { username: 'andy' }, ...fields });
const flush = async (n = 5) => {
    for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve));
};

describe('source: the job is made only with job_memory', () => {
    test('a static import of the job module (no pack), and createJob only behind job_memory, inside try', () => {
        assert.ok(SOURCE.includes("import { createJob, JobStore, JOB_FILE } from './job/index.js';"));
        const at = SOURCE.indexOf('this.job = createJob(');
        assert.ok(at > 0);
        assert.equal(SOURCE.indexOf('createJob(', at + 'this.job = createJob('.length), -1, 'one call');
        const before = SOURCE.slice(SOURCE.lastIndexOf('this.job = null;', at), at);
        assert.match(before, /^this\.job = null;\n\s+if \(settings\.job_memory === true\) \{\n\s+try \{\n\s+$/);
        const call = SOURCE.slice(at, SOURCE.indexOf('});', at) + 3);
        assert.ok(call.includes('new JobStore(`./bots/${this.name}/${JOB_FILE}`)'), call);
        assert.ok(call.includes('executeCommand: (text, options) => this._runJobOrder(text, options)'), call);
        assert.ok(call.includes('askModel: (prompt) => this.prompter.promptPlan(prompt)'), call);
        assert.ok(call.includes('settings,'), call);
    });

    test('the job module imports no pack of a switch and nothing of the models', () => {
        for (const file of fs.readdirSync(repoPath('src/agent/job'))) {
            const text = fs.readFileSync(repoPath(`src/agent/job/${file}`), 'utf8');
            for (const m of text.matchAll(/^import .* from '([^']+)';$/gm)) {
                assert.ok(!/packs\/(storage|farming|wood|mining|routes)\//.test(m[1]) && !/models\//.test(m[1]), `${file}: ${m[1]}`);
            }
        }
    });

    test('at spawn: onRestart after the restart note, before the first message; the timer after the events', () => {
        const spawn = SOURCE.slice(SOURCE.indexOf("this.bot.once('spawn'"));
        const order = ['const restart_note = await this._atSpawn();', 'this._jobAtSpawn();', 'this._setupEventHandlers(', 'this.startEvents();', 'this._startJobTimer();'];
        const at = order.map((s) => spawn.indexOf(s));
        assert.ok(at.every((i) => i > 0), JSON.stringify(at));
        assert.deepEqual([...at].sort((a, b) => a - b), at);
    });

    test('!mines and !forgetMine are hidden without the mining pack', () => {
        const pushes = blockedPushes();
        for (const name of ['!mines', '!forgetMine']) {
            const tests = pushes.filter((p) => p.names.includes(name)).map((p) => p.test);
            assert.deepEqual(tests, ['!settings.mining_pack || !this.work_packs?.mining'], name);
        }
    });
});

describe('withJobLine and knowledgeBlock: the line of the job after the where line', () => {
    const WHERE = { area: null, depth: 0, underground: false };

    test('withJobLine: after the where line; after the header without one; the header and the line without a block; nothing without a line', () => {
        const H = KT.KNOWLEDGE_HEADER;
        assert.equal(M.agent.withJobLine(`${H}\nYou are here.\nChests: none.`, 'You are here.', 'Job: the farming.'), `${H}\nYou are here.\nJob: the farming.\nChests: none.`);
        assert.equal(M.agent.withJobLine(`${H}\nChests: none.`, 'You are here.', 'Job: the farming.'), `${H}\nJob: the farming.\nChests: none.`);
        assert.equal(M.agent.withJobLine('', '', 'Job: the farming.'), `${H}\nJob: the farming.`);
        assert.equal(M.agent.withJobLine(`${H}\nYou are here.`, 'You are here.', ''), `${H}\nYou are here.`);
        assert.equal(M.agent.withJobLine('', '', null), '');
    });

    function knowingAgent(status) {
        return fakeAgent({
            bot: { username: 'andy', entity: { position: { x: 1.5, y: 64, z: 2.5 } }, game: { dimension: 'overworld' } },
            whereAmI: () => WHERE,
            memory_bank: null,
            job: status === null ? null : { status: () => status },
        });
    }

    test('a job: its line right after the where line, word for word', () => {
        M.settingsModule.setSettings({ ...OFF, knowledge_in_prompt: true, knowledge_max_chars: 600 });
        const block = knowingAgent('Job: the mining, 6 of 16 iron, step 2 of 4.').knowledgeBlock();
        const where = KT.whereLine({ ...WHERE, pos: { x: 1.5, y: 64, z: 2.5 } });
        assert.ok(where.length > 0);
        assert.equal(block, `${KT.KNOWLEDGE_HEADER}\n${where}\nJob: the mining, 6 of 16 iron, step 2 of 4.`);
    });

    test('no job, an empty status, or job_memory off: the block as before', () => {
        M.settingsModule.setSettings({ ...OFF, knowledge_in_prompt: true, knowledge_max_chars: 600 });
        const plain = knowingAgent(null).knowledgeBlock();
        assert.equal(plain, KT.knowledgeText({ chests: [], areas: [], mines: [], places: null, where: { ...WHERE, pos: { x: 1.5, y: 64, z: 2.5 } } }, 600));
        assert.equal(knowingAgent('').knowledgeBlock(), plain);
        const broken = knowingAgent('x');
        broken.job = { status() { throw new Error('broken'); } };
        assert.equal(broken.knowledgeBlock(), plain);
    });

    test('the block with the line stays within knowledge_max_chars; knowledge_in_prompt off: nothing', () => {
        M.settingsModule.setSettings({ ...OFF, knowledge_in_prompt: true, knowledge_max_chars: 120 });
        const block = knowingAgent('Job: the mining, 6 of 16 iron.').knowledgeBlock();
        assert.ok(block.length <= 120, `${block.length}: ${block}`);
        assert.ok(block.includes('\nJob: the mining, 6 of 16 iron.'));
        M.settingsModule.setSettings({ ...OFF, knowledge_in_prompt: false });
        assert.equal(knowingAgent('Job: the mining, 6 of 16 iron.').knowledgeBlock(), '');
    });
});

describe('the timer, the spawn and the system orders', () => {
    test('_startJobTimer: tick every 5 s, not awaited, once; nothing without a job; cleared at the exit', () => {
        mock.timers.enable({ apis: ['setInterval'] });
        try {
            assert.equal(M.agent.JOB_TICK_MS, 5000);
            let ticks = 0;
            const agent = fakeAgent({ job: { tick: () => { ticks++; return new Promise(() => {}); } } });
            agent._startJobTimer();
            agent._startJobTimer();
            mock.timers.tick(4999);
            assert.equal(ticks, 0);
            mock.timers.tick(1);
            assert.equal(ticks, 1, 'a tick that never ends does not stop the next one');
            mock.timers.tick(10000);
            assert.equal(ticks, 3, 'one timer');
            agent._atExit('test');
            mock.timers.tick(10000);
            assert.equal(ticks, 3);
            const none = fakeAgent({ job: null });
            none._startJobTimer();
            assert.equal(none._job_timer, undefined);
        } finally {
            mock.timers.reset();
        }
    });

    test('a tick that throws or rejects breaks nothing', async () => {
        mock.timers.enable({ apis: ['setInterval'] });
        try {
            const agent = fakeAgent({ job: { tick() { throw new Error('broken'); } } });
            agent._startJobTimer();
            mock.timers.tick(5000);
            agent.job = { tick: () => Promise.reject(new Error('rejected')) };
            mock.timers.tick(5000);
            await flush();
            assert.equal(cap.of('warn').filter((r) => r.text.startsWith('The job failed:')).length, 2);
            agent._atExit('test');
        } finally {
            mock.timers.reset();
        }
    });

    test('_jobAtSpawn: onRestart once; nothing without a job; a throw breaks nothing', () => {
        let restarts = 0;
        fakeAgent({ job: { onRestart: () => { restarts++; return { ok: true, reason: 'running', text: '' }; } } })._jobAtSpawn();
        assert.equal(restarts, 1);
        fakeAgent({ job: null })._jobAtSpawn();
        fakeAgent({ job: { onRestart() { throw new Error('broken'); } } })._jobAtSpawn();
        assert.equal(restarts, 1);
    });

    test('_runJobOrder: executeCommand as a system order; the result into the history; a bad command gives its text', async () => {
        const turns = [];
        const agent = fakeAgent({ running_commands: [], history: { add: async (name, text) => turns.push([name, text]) }, job: null });
        // !stats is a query that needs no pack; a bot without stats gives a text all the same
        agent.bot = { username: 'andy', entity: { position: { x: 0, y: 64, z: 0 } }, game: { dimension: 'overworld', gameMode: 'survival' },
            health: 20, food: 20, players: {}, time: { timeOfDay: 1000 }, isRaining: false, blockAt: () => null, modes: { getMiniDocs: () => '' } };
        const result = await agent._runJobOrder('!nothingLikeThis(1)', { by: 'system', typed: false });
        assert.equal(result, '!nothingLikeThis is not a command.');
        assert.deepEqual(turns, [['system', '!nothingLikeThis is not a command.']]);
    });

    test('_runJobOrder passes by "system" and typed false to the hooks', async () => {
        M.settingsModule.setSettings({ ...OFF, mining_pack: true });
        const calls = [];
        const agent = fakeAgent({
            running_commands: [], last_order: { typed: true, command: '!mines', by: 'steve' }, history: { add: async () => {} },
            bot: { username: 'andy', game: { dimension: 'overworld' }, inventory: { items: () => [] } },
            work_packs: { mining: { minesText: () => 'I know no mines.' } }, packContext: () => ({}),
            job: { onCommand: (...a) => calls.push(['onCommand', ...a]), onResult: async (...a) => calls.push(['onResult', ...a]) },
        });
        assert.equal(await agent._runJobOrder('!mines', { by: 'system', typed: false }), 'I know no mines.');
        assert.deepEqual(calls[0], ['onCommand', '!mines', [], 'system', '!mines']);
        assert.equal(agent.running_commands.length, 0);
    });
});

describe('promptPlan: one call of the chat model under the purpose "plan"', () => {
    test('the prompt as the system message, the purpose plan, the answer without the thinking', async () => {
        M.settingsModule.setSettings({ ...OFF, log_all_prompts: false });
        const seen = [];
        const fake = {
            agent: { cost_meter: {}, task: {} }, cooldown: 0, last_prompt_time: 0,
            chat_model: { async sendRequest(turns, system) { seen.push({ turns, system, purpose: USAGE.currentPurpose() }); return '<think>hm</think>!chopTrees(4)'; } },
        };
        Object.setPrototypeOf(fake, M.prompter.Prompter.prototype);
        assert.equal(await fake.promptPlan('THE PLAN PROMPT'), '!chopTrees(4)');
        assert.deepEqual(seen, [{ turns: [], system: 'THE PLAN PROMPT', purpose: 'plan' }]);
        fake.chat_model.sendRequest = async () => undefined;
        assert.equal(await fake.promptPlan('x'), '');
    });
});

describe('the whole way: the real job, its store and executeCommand on a fake agent', () => {
    // A fake agent on the real prototype with the mining switch on and a mining pack whose mineOre adds raw_iron:
    // `mined` per call (taken from the front), stopped when the call says so.
    function setup({ mined, stopped = [] }) {
        M.settingsModule.setSettings({ ...OFF, mining_pack: true, job_memory: true, job_resume_seconds: 60, home_reflexes: { night_shelter: false } });
        const items = {};
        const said = [];
        const turns = [];
        const orders = [];
        let clock = Date.parse('2026-10-01T10:00:00Z');
        const agent = fakeAgent({
            running_commands: [], last_order: null, repeat_guard: null, last_pack_text: null, shut_up: true,
            history: { add: async (name, text) => turns.push([name, text]) },
            bot: {
                username: 'andy', game: { dimension: 'overworld' }, output: '', isSleeping: false, time: { timeOfDay: 1000 },
                modes: { pause() {} }, inventory: { items: () => Object.entries(items).map(([name, count]) => ({ name, count })) },
            },
            actions: { executing: false, async runAction(label, fn) { await fn(); return { success: true, interrupted: false, timedout: false, message: '' }; } },
            self_prompter: { isActive: () => false },
            whereAmI: () => ({ underground: false }),
            packContext: () => ({}),
            work_packs: {
                mining: {
                    mineOre(bot, ctx, ore, num, options) {
                        orders.push([ore, num, options]);
                        const n = mined.shift() ?? 0;
                        items.raw_iron = (items.raw_iron ?? 0) + n;
                        if (stopped.shift())
                            return { ok: false, reason: 'interrupted', text: `I mined ${n} iron, then I was stopped.` };
                        return { ok: true, reason: null, text: `I mined ${n} iron.` };
                    },
                },
            },
        });
        agent.sayText = (text) => said.push(text);
        const store = new JOB.JobStore(path.join(dir, 'andy', JOB.JOB_FILE));
        // the options of agent.js, with the clock of the test
        agent.job = JOB.createJob(agent, store, {
            settings: M.settingsModule.default, now: () => clock,
            executeCommand: (text, options) => agent._runJobOrder(text, options),
            askModel: async () => { throw new Error('no model in this test'); },
        });
        return { agent, said, turns, orders, store, advance: (ms) => { clock += ms; } };
    }

    test('a typed !mineOre that ends with the count: the job is done, the done text is said', async () => {
        const { agent, said, store } = setup({ mined: [4] });
        assert.equal(await M.index.executeCommand(agent, '!mineOre("iron", 4)', { typed: true, by: 'steve' }), 'I mined 4 iron.');
        await flush();
        assert.equal(store.get().state, 'done');
        assert.equal(store.get().got, 4);
        assert.deepEqual(said, ['The mining is done: 4 iron.']);
        assert.ok(fs.existsSync(path.join(dir, 'andy', 'job.json')), 'bots/<name>/job.json');
    });

    test('stopped after 1 of 4: the job keeps 1; after 60 s without an order the tick resumes with the rest as a system order, then done', async () => {
        const { agent, said, turns, orders, store, advance } = setup({ mined: [1, 3], stopped: [true, false] });
        assert.equal(await M.index.executeCommand(agent, '!mineOre("iron", 4)', { typed: false }), undefined, 'stopped');
        await flush();
        assert.equal(store.get().state, 'running');
        assert.equal(store.get().got, 1);
        assert.equal(store.get().by, 'model');
        advance(30 * 1000);
        assert.equal((await agent.job.tick()).reason, 'wait', 'not before 60 s');
        advance(31 * 1000);
        await agent.job.tick();
        await flush();
        assert.deepEqual(orders, [['iron', 4, { newMine: false }], ['iron', 3, { newMine: false }]]);
        assert.deepEqual(said, ['I go back to the mining, 1 of 4 iron.', 'The mining is done: 4 iron.']);
        assert.equal(store.get().state, 'done');
        assert.ok(turns.some(([name, text]) => name === 'system' && text === 'I mined 3 iron.'), 'the result of the system order is in the history');
    });

    test('an errand in between changes nothing; !stop ends the job with the leave text', async () => {
        const { agent, said, store } = setup({ mined: [1], stopped: [true] });
        await M.index.executeCommand(agent, '!mineOre("iron", 4)', { typed: true, by: 'steve' });
        await flush();
        M.settingsModule.default.mining_pack = true;
        await M.index.executeCommand(agent, '!mines', { typed: true, by: 'steve' }).catch(() => {});
        await flush();
        assert.equal(store.get().state, 'running');
        agent.actions.stop = async () => {};
        agent.requestInterrupt = () => {};
        agent.clearBotLogs = () => {};
        agent.shutUp = () => {};
        await M.index.executeCommand(agent, '!stop', { typed: true, by: 'steve' }).catch(() => {});
        await flush();
        assert.equal(store.get().state, 'left');
        assert.deepEqual(said, ['I leave the mining at 1 of 4 iron.']);
    });

    test('job_memory off: agent.job is null and executeCommand touches no job', async () => {
        const { agent } = setup({ mined: [4] });
        agent.job = null;
        assert.equal(await M.index.executeCommand(agent, '!mineOre("iron", 4)', { typed: true, by: 'steve' }), 'I mined 4 iron.');
        assert.ok(!fs.existsSync(path.join(dir, 'andy', 'job.json')));
    });
});
