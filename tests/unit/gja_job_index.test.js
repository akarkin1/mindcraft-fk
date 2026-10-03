// Spec v0.1.4.10 part J (engineer E1): the job on the agent, createJob of src/agent/job/index.js (I4), driven
// as the glue (part G) will drive it: onCommand before and onResult after every command, tick, onRestart,
// status. A fake agent, a fake clock, a fake model and a fake executeCommand that plays the glue.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const J = await loadSrc('src/agent/job/index.js');

const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);

let log;
let warn;
before(() => {
    log = console.log;
    warn = console.warn;
    console.log = () => {};
    console.warn = () => {};
});
after(() => {
    console.log = log;
    console.warn = warn;
});

// The name and the args of a command text, enough for the commands of these tests.
function parse(text) {
    const m = text.match(/^!(\w+)(?:\((.*)\))?$/);
    const args = m[2] ? m[2].split(/\s*,\s*/).map(a => (/^-?\d+$/.test(a) ? Number(a) : a === 'true' || a === 'false' ? a === 'true' : a.replace(/^"|"$/g, ''))) : [];
    return { name: `!${m[1]}`, args };
}

/**
 * A world: a fake agent and clock, the job, and the glue. handlers: command name -> (args, world) ->
 * { result, gain } (gain { name: n } is added to the inventory). hooks: false plays a glue that does not
 * call onCommand and onResult for a system order.
 */
function makeWorld({ handlers = {}, answers = [], settings = {}, hooks = true, store } = {}) {
    const w = {
        t: T0,
        said: [],
        ran: [],
        handlers,
        prompts: [],
        inventory: {},
        agent: null,
        job: null,
        where: { underground: false },
        chests: null,
    };
    w.agent = {
        sayText: (text) => w.said.push(text),
        actions: { executing: false, currentActionLabel: '' },
        bot: { inventory: { items: () => Object.entries(w.inventory).map(([name, count]) => ({ name, count })) }, time: { timeOfDay: 1000 }, isSleeping: false },
        whereAmI: () => w.where,
        _workStores: () => ({ chests: w.chests === null ? null : { list: () => w.chests }, mines: null }),
    };
    w.store = store ?? new J.JobStore(null, { now: () => new Date(w.t) });
    w.run = async (text, by) => {
        const { name, args } = parse(text);
        w.ran.push({ text, by });
        if (hooks || by !== 'system') {
            w.job.onCommand(name, args, by, text);
        }
        const handler = w.handlers[name];
        const out = handler ? handler(args, w) : { result: { ok: true, reason: null, text: 'Done.' }, gain: {} };
        for (const [item, n] of Object.entries(out.gain ?? {})) {
            w.inventory[item] = (w.inventory[item] ?? 0) + n;
        }
        if (hooks || by !== 'system') {
            await w.job.onResult(name, out.result, out.gain ?? {});
        }
        return typeof out.result === 'object' && out.result !== null ? out.result.text : out.result;
    };
    w.job = J.createJob(w.agent, w.store, {
        settings: { job_resume_seconds: 60, idle_jobs: [], idle_jobs_minutes: 15, ...settings },
        now: () => w.t,
        executeCommand: (text, options) => w.run(text, options?.by),
        askModel: async (prompt) => {
            w.prompts.push(prompt);
            const answer = answers.shift();
            if (answer instanceof Error) {
                throw answer;
            }
            return answer ?? 'NONE';
        },
    });
    w.wait = (seconds) => {
        w.t += seconds * 1000;
    };
    return w;
}

const mineHandler = (perRun, final = null) => (args) => {
    const n = Math.min(perRun, args[1]);
    const ok = n >= args[1];
    return { result: { ok, reason: ok ? null : 'time', text: final ?? `I mined ${n} iron.` }, gain: { raw_iron: n } };
};

describe('W85: the job comes back after an errand', () => {
    test('the mining, an errand, 60 s quiet, the resumed command with the rest, done', async () => {
        const w = makeWorld({ handlers: { '!mineOre': mineHandler(6), '!followPlayer': () => ({ result: undefined }) } });
        w.job.onCommand('!mineOre', ['iron', 16, false], 'Steve', '!mineOre("iron", 16)');
        await w.job.onResult('!mineOre', { ok: false, reason: 'interrupted', text: 'I am still in the mine.' }, { raw_iron: 6 });
        assert.equal(w.job.get().got, 6);
        assert.equal(w.job.onCommand('!followPlayer', ['Steve', 4], 'model').reason, 'errand');
        w.agent.actions = { executing: true, currentActionLabel: 'action:followPlayer' };
        w.wait(30);
        assert.equal((await w.job.tick()).reason, 'wait');
        assert.equal(w.ran.length, 0);
        w.wait(30);
        w.agent.actions = { executing: true, currentActionLabel: 'action:followPlayer' }; // the endless follow does not keep the job
        w.handlers = { '!mineOre': mineHandler(10) };
        await w.job.tick();
        assert.deepEqual(w.ran, [{ text: '!mineOre("iron", 10)', by: 'system' }]);
        assert.ok(w.said.includes('I go back to the mining, 6 of 16 iron.'), w.said.join(' | '));
        assert.equal(w.said.at(-1), 'The mining is done: 16 iron.');
        assert.equal(w.job.get().state, 'done');
        assert.equal(w.job.status(), 'Last job: the mining, done, 16 iron.'); // F27 (v0.1.4.11)
        assert.equal(w.prompts.length, 0, 'no call of the model');
    });

    test('no resume while another action runs, the bot sleeps, or at night with the shelter reflex', async () => {
        const w = makeWorld({ settings: { home_pack: true } });
        w.job.onCommand('!farmCycle', ['farm'], 'Steve', '!farmCycle("farm")');
        await w.job.onResult('!farmCycle', { ok: false, reason: 'interrupted', text: '' }, {});
        w.wait(61);
        w.agent.actions = { executing: true, currentActionLabel: 'action:goToBed' };
        assert.equal((await w.job.tick()).reason, 'wait');
        w.agent.actions = { executing: false, currentActionLabel: '' };
        w.agent.bot.isSleeping = true;
        assert.equal((await w.job.tick()).reason, 'wait');
        w.agent.bot.isSleeping = false;
        w.agent.bot.time.timeOfDay = 15000;
        assert.equal((await w.job.tick()).reason, 'wait');
        w.agent.bot.time.timeOfDay = 1000;
        await w.job.tick();
        assert.deepEqual(w.ran.map(r => r.text), ['!farmCycle("farm")']);
        assert.equal(w.said.at(-1), 'The farming is done.');
    });

    test('a glue without the hooks for system orders: tick gives the result itself', async () => {
        const w = makeWorld({ hooks: false, handlers: { '!farmCycle': () => ({ result: { ok: true, reason: null, text: 'Farm "farm": done.' } }) } });
        w.job.onCommand('!farmCycle', ['farm'], 'Steve', '!farmCycle("farm")');
        await w.job.onResult('!farmCycle', { ok: false, reason: 'interrupted', text: '' }, {});
        w.wait(60);
        await w.job.tick();
        assert.equal(w.job.get().state, 'done');
        assert.equal(w.said.at(-1), 'The farming is done.');
    });
});

describe('the end and the replacement of a job', () => {
    test('!stop ends the job with the leave text', () => {
        const w = makeWorld();
        w.job.onCommand('!mineOre', ['iron', 16], 'Steve');
        const out = w.job.onCommand('!stop', [], 'Steve');
        assert.deepEqual(out, { ok: true, reason: 'ended', text: 'I leave the mining at 0 of 16 iron.' });
        assert.equal(w.job.get().state, 'left');
        assert.equal(w.job.onCommand('!endGoal', [], 'model').reason, 'no_job');
    });

    test('a new job replaces the old one with the leave text; the same work without', () => {
        const w = makeWorld();
        w.job.onCommand('!mineOre', ['iron', 16], 'Steve');
        assert.equal(w.job.onCommand('!mineOre', ['iron', 10], 'model').text, '');
        assert.equal(w.job.get().wanted, 10);
        assert.equal(w.job.get().by, 'model');
        const out = w.job.onCommand('!farmCycle', ['farm'], 'Steve');
        assert.equal(out.text, 'I leave the mining at 0 of 10 iron.');
        assert.equal(w.job.get().kind, 'farmCycle');
    });

    test('errands and other commands change nothing', () => {
        const w = makeWorld();
        w.job.onCommand('!mineOre', ['iron', 16], 'Steve');
        for (const name of ['!goToPlayer', '!inventory', '!eat', '!goToMine', '!storeItems']) {
            assert.equal(w.job.onCommand(name, [], 'model').reason, 'errand', name);
        }
        assert.equal(w.job.get().kind, 'mineOre');
        assert.equal(w.said.length, 0);
    });
});

describe('W86: a blocker becomes steps', () => {
    const ANSWER = '!chopTrees(4)\n!craftSupplies("planks", 8)\n!craftSupplies("stick", 16)\n!craftSupplies("torch", 16)';
    const handlers = {
        '!chopTrees': (args) => ({ result: { ok: true, reason: null, text: `I cut ${args[0]} logs.` }, gain: { oak_log: args[0] } }),
        '!craftSupplies': (args) => ({ result: { ok: true, reason: null, text: `I crafted ${args[1]} ${args[0]}.` }, gain: { [args[0] === 'planks' ? 'oak_planks' : args[0]]: args[1] } }),
    };

    test('the plan text, the steps one after the other, then the job again', async () => {
        let torches = false;
        const w = makeWorld({
            answers: [ANSWER],
            handlers: {
                ...handlers,
                '!mineOre': (args) => (torches
                    ? { result: { ok: true, reason: null, text: `I mined ${args[1]} iron.` }, gain: { raw_iron: args[1] } }
                    : { result: { ok: false, reason: 'no_supplies', text: 'I have no torches.' } }),
            },
        });
        await w.run('!mineOre("iron", 4)', 'Steve');
        assert.equal(w.prompts.length, 1);
        assert.match(w.prompts[0], /!mineOre\("iron", 4\)/);
        assert.equal(w.said.at(-1), 'I have no torches. I get wood, planks, sticks and torches, then I go on.');
        assert.equal(w.job.status(), 'Job: the mining, 0 of 4 iron, step 1 of 4.');
        for (let i = 0; i < 4; i++) {
            w.wait(5);
            await w.job.tick(); // no wait of job_resume_seconds: the bot goes on by itself
        }
        assert.deepEqual(w.ran.slice(1).map(r => r.text), ['!chopTrees(4)', '!craftSupplies("planks", 8)', '!craftSupplies("stick", 16)', '!craftSupplies("torch", 16)']);
        assert.ok(w.said.includes('Step 3 of 4 done: 16 sticks.'), w.said.join(' | '));
        assert.equal(w.said.at(-1), 'Step 4 of 4 done: 16 torches.');
        torches = true;
        w.wait(5);
        await w.job.tick();
        assert.equal(w.ran.at(-1).text, '!mineOre("iron", 4)');
        assert.ok(w.said.includes('I go back to the mining, 0 of 4 iron.'));
        assert.equal(w.said.at(-1), 'The mining is done: 4 iron.');
        assert.equal(w.prompts.length, 1, 'the model once');
    });

    test('an order between the steps brings back the wait', async () => {
        const w = makeWorld({ answers: [ANSWER], handlers: { ...handlers, '!mineOre': () => ({ result: { ok: false, reason: 'no_supplies', text: 'I have no torches.' } }) } });
        await w.run('!mineOre("iron", 4)', 'Steve');
        w.wait(5);
        await w.job.tick();
        assert.equal(w.ran.length, 2);
        w.wait(1);
        w.job.onCommand('!goToPlayer', ['Steve'], 'model');
        w.wait(5);
        assert.equal((await w.job.tick()).reason, 'wait');
        w.wait(60);
        await w.job.tick();
        assert.equal(w.ran.at(-1).text, '!craftSupplies("planks", 8)');
    });

    test('no plan from the model: the no-plan text and the job pauses', async () => {
        const w = makeWorld({ answers: ['!mineOre("iron", 4)'], handlers: { '!mineOre': () => ({ result: { ok: false, reason: 'no_supplies', text: 'I have no torches.' } }) } });
        await w.run('!mineOre("iron", 4)', 'Steve');
        assert.equal(w.said.at(-1), 'I could not plan the steps for the torches. Tell me what to do.');
        assert.equal(w.job.get().state, 'paused');
        assert.equal(w.job.status(), 'Job: the mining, 0 of 4 iron, paused.');
        w.wait(120);
        assert.equal((await w.job.tick()).reason, 'wait');
    });

    test('a model that fails: the no-plan text', async () => {
        const w = makeWorld({ answers: [new Error('no key')], handlers: { '!mineOre': () => ({ result: { ok: false, reason: 'no_supplies', text: 'I have no torches.' } }) } });
        await w.run('!mineOre("iron", 4)', 'Steve');
        assert.equal(w.said.at(-1), 'I could not plan the steps for the torches. Tell me what to do.');
    });

    test('a failed step is tried once more, then plans again, at most 3 plans per job', async () => {
        const w = makeWorld({
            answers: ['!chopTrees(4)', '!chopTrees(4)', '!chopTrees(4)', '!chopTrees(4)'],
            handlers: {
                '!mineOre': () => ({ result: { ok: false, reason: 'no_supplies', text: 'I have no torches.' } }),
                '!chopTrees': () => ({ result: { ok: false, reason: 'no_path', text: 'I found no trees.' } }),
            },
        });
        await w.run('!mineOre("iron", 4)', 'Steve');
        w.wait(5);
        await w.job.tick();
        assert.equal(w.prompts.length, 1, 'the first failure of the step plans nothing');
        assert.equal(w.job.get().steps[0].state, 'todo');
        assert.equal(w.job.get().steps[0].fails, 1);
        w.wait(5);
        await w.job.tick(); // no wait of job_resume_seconds for the second run
        await w.job.settled();
        assert.deepEqual(w.ran.slice(1).map(r => r.text), ['!chopTrees(4)', '!chopTrees(4)']);
        assert.equal(w.prompts.length, 2, 'the second failure plans again');
        for (let i = 0; i < 6; i++) {
            w.wait(5);
            await w.job.tick();
            await w.job.settled();
        }
        assert.equal(w.prompts.length, 3);
        assert.equal(w.job.get().plans, 3);
        assert.equal(w.job.get().state, 'paused');
        assert.equal(w.said.at(-1), 'I could not plan the steps for the torches. Tell me what to do.');
    });

    test('tick never waits for the model: a blocker of a resumed command is planned on its own', async () => {
        let release;
        const w = makeWorld({ handlers: { '!mineOre': () => ({ result: { ok: false, reason: 'no_supplies', text: 'I have no torches.' } }) } });
        w.job.onCommand('!mineOre', ['iron', 4], 'Steve');
        await w.job.onResult('!mineOre', { ok: false, reason: 'interrupted', text: '' }, {});
        const asked = [];
        const job = J.createJob(w.agent, w.store, {
            settings: {}, now: () => w.t, executeCommand: (text, options) => w.run(text, options?.by),
            askModel: (prompt) => {
                asked.push(prompt);
                return new Promise((resolve) => { release = resolve; });
            },
        });
        w.job = job;
        w.wait(60);
        const out = await job.tick();
        assert.equal(out.ok, true);
        assert.equal(asked.length, 1, 'the plan started');
        assert.equal(w.said.at(-1), 'I go back to the mining, 0 of 4 iron.', 'tick returned before the answer');
        w.wait(60);
        assert.equal((await job.tick()).reason, 'busy', 'no resume while the model plans');
        release('!craftSupplies("torch", 16)');
        await job.settled();
        assert.equal(w.said.at(-1), 'I have no torches. I get torches, then I go on.');
        assert.equal(job.get().steps.length, 1);
    });

    test('while a plan runs, a plan command of the model is no new job', async () => {
        const w = makeWorld({ answers: [ANSWER], handlers: { '!mineOre': () => ({ result: { ok: false, reason: 'no_supplies', text: 'I have no torches.' } }) } });
        await w.run('!mineOre("iron", 4)', 'Steve');
        assert.equal(w.job.onCommand('!craftSupplies', ['torch', 16], 'model').reason, 'errand');
        assert.equal(w.job.get().kind, 'mineOre');
        assert.equal(w.job.onCommand('!craftSupplies', ['torch', 16], 'Steve').reason, 'job');
    });
});

describe('T3-1: the prompt names the chests, every missing supply and where the bot is; the way out first', () => {
    const CHEST = { x: 1803, y: 61, z: 4, dimension: 'overworld', kind: 'chest', items: { leaf_litter: 64, oak_log: 20, bread: 12, coal: 9 }, free_slots: 20 };
    const ROOM = { x: 1810, y: 41, z: 0, dimension: 'overworld', kind: 'chest', items: { cobblestone: 64 }, free_slots: 26 };
    const NO_PICK = { result: { ok: false, reason: 'pickaxe', text: 'I cannot mine iron. I need a stone pickaxe and have no pickaxe.' } };
    const STEPS = '!fetchItem("oak_log", 8)\n!fetchItem("coal", 4)\n!craftSupplies("torch", 16)\n!getTool("pickaxe", "stone")';

    function underground(answers = [STEPS], extra = {}) {
        const w = makeWorld({
            answers,
            handlers: {
                '!mineOre': () => NO_PICK,
                '!leaveMine': (args, world) => {
                    world.where = { underground: false, area: null };
                    return { result: { ok: true, reason: null, text: 'I am out of the mine.' } };
                },
                '!fetchItem': (args) => ({ result: { ok: true, reason: null, text: `I took ${args[1]} ${args[0]}.` }, gain: { [args[0]]: args[1] } }),
                '!craftSupplies': (args) => ({ result: { ok: true, reason: null, text: `I made ${args[1]} ${args[0]}.` }, gain: { [args[0]]: args[1] } }),
                '!getTool': () => ({ result: { ok: true, reason: null, text: 'I made a stone_pickaxe.' }, gain: { stone_pickaxe: 1 } }),
                ...extra,
            },
        });
        w.where = { underground: true, depth: 36, area: null, mine: { name: 'mine', tunnel: 0, level: 25 } };
        w.chests = [CHEST, ROOM];
        w.inventory = { ladder: 8 };
        return w;
    }

    test('the prompt: both missing supplies on one line, where the bot is, the chests and what they hold', async () => {
        const w = underground();
        await w.run('!mineOre("iron", 4)', 'Steve');
        assert.equal(w.prompts.length, 1);
        const lines = w.prompts[0].split('\n');
        assert.equal(lines[0], 'You plan the steps of a Minecraft bot. Its job stopped because something is missing.');
        assert.equal(lines[1], 'The job: !mineOre("iron", 4), 0 of 4 done.');
        assert.equal(lines[2], 'What is missing: no_pickaxe (stone_pickaxe), no_torches (torch), the skill said: "I cannot mine iron. I need a stone pickaxe and have no pickaxe.".');
        assert.equal(lines[3], 'Where the bot is: underground in the mine "mine". Before a step that needs a tree, a chest or a crafting table it leaves the mine by itself.');
        assert.equal(lines[4], 'What the bot carries: 8 ladder.');
        assert.equal(lines[5], 'The chests the bot knows and what they hold:');
        assert.ok(lines.includes('the chest at (1803, 61, 4): 64 leaf_litter, 20 oak_log, 12 bread, 9 coal'), w.prompts[0]);
        assert.ok(lines.includes('the chest at (1810, 41, 0): 64 cobblestone'), w.prompts[0]);
        assert.equal(lines[8], 'The commands you may use:');
        assert.equal(w.said.at(-1), 'I have no stone pickaxe. I get wood, coal, torches and a stone pickaxe, then I go on.');
    });

    test('underground, a surface step runs after !leaveMine as a system order; on the surface no way out', async () => {
        const w = underground();
        await w.run('!mineOre("iron", 4)', 'Steve');
        w.wait(5);
        await w.job.tick();
        assert.deepEqual(w.ran.slice(1), [{ text: '!leaveMine', by: 'system' }, { text: '!fetchItem("oak_log", 8)', by: 'system' }]);
        assert.equal(w.said.at(-1), 'Step 1 of 4 done: 8 oak_log.');
        for (let i = 0; i < 3; i++) {
            w.wait(5);
            await w.job.tick();
        }
        assert.deepEqual(w.ran.slice(3).map(r => r.text), ['!fetchItem("coal", 4)', '!craftSupplies("torch", 16)', '!getTool("pickaxe", "stone")']);
        assert.equal(w.ran.filter(r => r.text === '!leaveMine').length, 1, 'once: the bot is out');
        assert.equal(w.prompts.length, 1);
    });

    test('a step that does not need the surface runs underground without the way out', async () => {
        const w = underground(['!smeltItem("raw_iron", 1)'], { '!smeltItem': () => ({ result: { ok: true, reason: null, text: 'I smelted 1 raw_iron.' } }) });
        await w.run('!mineOre("iron", 4)', 'Steve');
        w.wait(5);
        await w.job.tick();
        assert.deepEqual(w.ran.slice(1).map(r => r.text), ['!smeltItem("raw_iron", 1)']);
    });

    test('a way out that is stopped, or an order of the player during it: the step waits', async () => {
        const w = underground([STEPS], { '!leaveMine': () => ({ result: undefined }) });
        await w.run('!mineOre("iron", 4)', 'Steve');
        w.wait(5);
        assert.equal((await w.job.tick()).reason, 'way_out');
        assert.deepEqual(w.ran.slice(1).map(r => r.text), ['!leaveMine']);
        assert.equal(w.job.get().steps[0].state, 'todo');
        w.handlers['!leaveMine'] = (args, world) => {
            world.job.onCommand('!goToPlayer', ['Steve'], 'Steve', '!goToPlayer("Steve")');
            return { result: { ok: true, reason: null, text: 'I am out of the mine.' } };
        };
        w.wait(5);
        assert.equal((await w.job.tick()).reason, 'way_out');
        assert.equal(w.ran.at(-1).text, '!leaveMine');
        assert.equal(w.job.get().steps[0].state, 'todo');
    });

    test('a way out that fails: the step still runs and is tried once more', async () => {
        const w = underground([STEPS], {
            '!leaveMine': () => ({ result: { ok: false, reason: 'no_path', text: 'I could not find the way up.' } }),
            '!fetchItem': () => ({ result: { ok: false, reason: 'no_path', text: 'I could not get to the chest with oak_log at (1803, 61, 4).' } }),
        });
        await w.run('!mineOre("iron", 4)', 'Steve');
        w.wait(5);
        await w.job.tick();
        w.wait(5);
        await w.job.tick();
        await w.job.settled();
        assert.deepEqual(w.ran.slice(1).map(r => r.text), ['!leaveMine', '!fetchItem("oak_log", 8)', '!leaveMine', '!fetchItem("oak_log", 8)']);
        assert.equal(w.prompts.length, 2);
        assert.match(w.prompts[1], /the skill said: "I could not get to the chest with oak_log at \(1803, 61, 4\)\."/);
    });

    test('without a chest index and without whereAmI the prompt leaves those lines out', async () => {
        const w = underground();
        w.chests = null;
        w.agent.whereAmI = undefined;
        await w.run('!mineOre("iron", 4)', 'Steve');
        assert.ok(!/Where the bot is|chests the bot knows/.test(w.prompts[0]), w.prompts[0]);
    });
});

describe('the same failure three times', () => {
    test('pauses the job with the stop text', async () => {
        const w = makeWorld({ handlers: { '!mineOre': () => ({ result: { ok: false, reason: 'no_path', text: 'I found no way there.' } }) } });
        await w.run('!mineOre("iron", 8)', 'Steve');
        assert.equal(w.job.get().fails, 1);
        w.wait(60);
        await w.job.tick();
        assert.equal(w.job.get().state, 'running');
        w.wait(60);
        await w.job.tick();
        assert.equal(w.job.get().state, 'paused');
        assert.equal(w.said.at(-1), 'I stop the mining: I found no way there.');
        w.wait(60);
        assert.equal((await w.job.tick()).reason, 'wait');
    });

    test('a different text starts the count again', async () => {
        let n = 0;
        const w = makeWorld({ handlers: { '!mineOre': () => ({ result: { ok: false, reason: 'no_path', text: n++ % 2 ? 'A.' : 'B.' } }) } });
        await w.run('!mineOre("iron", 8)', 'Steve');
        for (let i = 0; i < 3; i++) {
            w.wait(60);
            await w.job.tick();
        }
        assert.equal(w.job.get().state, 'running');
    });
});

describe('W87: the standing list', () => {
    test('with no job, after 60 s without an order, the entries in order, once per idle_jobs_minutes', async () => {
        const w = makeWorld({ settings: { idle_jobs: ['!farmCycle("farm")', 'craftSupplies torch 8'], idle_jobs_minutes: 15 } });
        assert.equal((await w.job.tick()).reason, 'wait');
        w.wait(60);
        await w.job.tick();
        w.wait(5);
        await w.job.tick();
        w.wait(5);
        assert.equal((await w.job.tick()).reason, 'wait');
        assert.deepEqual(w.ran, [{ text: '!farmCycle("farm")', by: 'system' }, { text: '!craftSupplies("torch", 8)', by: 'system' }]);
        assert.equal(w.job.get(), null, 'an entry is no job');
        assert.deepEqual(w.said, ['I take the next of my list: !farmCycle("farm").', 'I take the next of my list: !craftSupplies("torch", 8).']);
        w.wait(15 * 60);
        await w.job.tick();
        assert.equal(w.ran.length, 3);
        assert.equal(w.prompts.length, 0);
    });

    test('not while a job runs; an order brings back the wait', async () => {
        const w = makeWorld({ settings: { idle_jobs: ['!harvest'] } });
        w.job.onCommand('!plant', ['wheat_seeds', ''], 'Steve');
        await w.job.onResult('!plant', { ok: true, reason: null, text: 'I planted 9 wheat_seeds.' }, {});
        assert.equal(w.job.get().state, 'done');
        w.job.onCommand('!inventory', [], 'model');
        w.wait(59);
        assert.equal((await w.job.tick()).reason, 'wait');
        w.wait(1);
        await w.job.tick();
        assert.deepEqual(w.ran.map(r => r.text), ['!harvest']);
    });
});

describe('restart, status and the knowledge line', () => {
    test('onRestart says the restart text for a running job', () => {
        const store = new J.JobStore(null);
        const w1 = makeWorld({ store });
        w1.job.onCommand('!mineOre', ['iron', 16], 'Steve');
        store.set({ ...store.get(), got: 6 });
        const w2 = makeWorld({ store });
        assert.deepEqual(w2.job.onRestart(), { ok: true, reason: 'running', text: 'I was mining iron, 6 of 16. I go on.' });
        assert.equal(w2.job.get().state, 'running');
        assert.equal(w2.job.status(), 'Job: the mining, 6 of 16 iron.');
    });

    test('without a job: no text, an empty status, the describe text', () => {
        const w = makeWorld();
        assert.equal(w.job.onRestart().text, '');
        assert.equal(w.job.status(), '');
        assert.equal(w.job.describe(), 'I have no job.');
    });
});

describe('never a throw', () => {
    test('a store that throws, an executeCommand that throws, odd input', async () => {
        const bad = { load() { throw new Error('x'); }, get() { throw new Error('x'); }, set() { throw new Error('x'); } };
        const job = J.createJob({}, bad, { executeCommand: async () => { throw new Error('boom'); } });
        assert.equal(typeof job.onCommand('!mineOre', ['iron', 8], 'Steve').ok, 'boolean');
        assert.equal(typeof (await job.onResult('!mineOre', null, null)).ok, 'boolean');
        assert.equal(typeof (await job.tick()).ok, 'boolean');
        assert.equal(typeof job.onRestart().ok, 'boolean');
        assert.equal(job.status(), '');
        assert.equal(typeof (await job.plan(null)).ok, 'boolean');
        assert.equal(job.onCommand(undefined, undefined, undefined).ok, false);
    });

    test('tick without executeCommand', async () => {
        const job = J.createJob({}, new J.JobStore(null), {});
        assert.deepEqual(await job.tick(), { ok: false, reason: 'no_executor', text: '' });
    });

    test('an executeCommand that throws on a resume counts as a failure', async () => {
        const store = new J.JobStore(null);
        let t = T0;
        const job = J.createJob({}, store, { now: () => t, executeCommand: async () => { throw new Error('boom'); }, settings: {} });
        job.onCommand('!mineOre', ['iron', 8], 'Steve');
        t += 60000;
        const out = await job.tick();
        assert.equal(out.ok, false);
        assert.equal(store.get().fails, 1);
    });
});
