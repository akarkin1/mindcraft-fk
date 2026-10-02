// Tester T1 of v0.1.4.10 "Goals", from the spec (I1, I2, I4, section 5) and the handoff of part J: which command is
// a job, when the bot goes back to it (with a fake clock), the remaining count, the blockers, the standing list, and
// the job on the agent (createJob with a store in memory, a fake clock and fake readers: no timer, no model).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';

const J = await loadSrc('src/agent/job/job_logic.js');
const IDX = await loadSrc('src/agent/job/index.js');

const KINDS = ['mineOre', 'farmCycle', 'chopTrees', 'getTool', 'craftSupplies', 'collectBlocks', 'collectPassedOre', 'harvest', 'plant'];
const ERRANDS = ['!followPlayer', '!goToPlayer', '!goToCoordinates', '!goToRememberedPlace', '!goToShelter', '!goToBed', '!viewChest', '!chests',
    '!inventory', '!stats', '!stay', '!eat', '!closeDoor', '!pickUpItems', '!rememberHere', '!rememberArea', '!rememberRoute', '!rememberMine',
    '!rememberTunnel', '!rememberRule', '!routes', '!mines', '!cost', '!help', '!nearbyBlocks', '!craftable', '!savedPlaces', '!areas', '!rules',
    '!lookAtPlayer', '!useOn'];
// Args per kind and the count they give (null: no count).
const ARGS = {
    mineOre: [['iron', 16], 16],
    farmCycle: [['farm'], null],
    chopTrees: [[8], 8],
    getTool: [['pickaxe', 'stone'], null],
    craftSupplies: [['torch', 32], 32],
    collectBlocks: [['stone', 10], 10],
    collectPassedOre: [['iron', 8], 8],
    harvest: [['farm'], null],
    plant: [['wheat_seeds', 'farm'], null],
};
const WORDS = { mineOre: 'the mining', farmCycle: 'the farming' };

// ------------------------------------------------------------------------------------------------ I1 and I2

describe('I2: jobOf for every job command, null for every errand', () => {
    test('the job commands are the nine kinds of I1', () => {
        assert.deepEqual(Object.keys(J.JOB_COMMANDS).sort(), [...KINDS].sort());
    });

    for (const kind of KINDS) {
        test(`${kind} is a job, state running, with the record of I1`, () => {
            const [args, wanted] = ARGS[kind];
            for (const name of [kind, `!${kind}`]) {
                const job = J.jobOf(name, args);
                assert.ok(job, name);
                assert.equal(job.version, 1);
                assert.equal(job.kind, kind);
                assert.equal(job.state, 'running');
                assert.equal(typeof job.command, 'string');
                assert.ok(job.command.startsWith(`!${kind}`), job.command);
                assert.ok(Array.isArray(job.args));
                assert.equal(job.wanted, wanted, 'wanted');
                assert.equal(job.got, wanted === null ? null : 0, 'got');
                assert.equal(job.words, J.JOB_COMMANDS[kind].words);
                if (WORDS[kind]) assert.equal(job.words, WORDS[kind]);
                assert.deepEqual(job.steps, []);
                assert.equal(job.plans, 0);
                assert.ok(['player', 'model'].includes(job.by));
            }
        });
    }

    test('the order as typed is the command; by model is kept', () => {
        const job = J.jobOf('!mineOre', ['iron', 16], { by: 'model', text: '!mineOre("iron", 16)' });
        assert.equal(job.command, '!mineOre("iron", 16)');
        assert.equal(job.by, 'model');
        assert.equal(J.jobOf('!mineOre', ['iron', 16]).command, '!mineOre("iron", 16)', 'built when not given');
    });

    test('the errands of I2, each no job', () => {
        assert.deepEqual([...J.ERRAND_COMMANDS].sort(), [...ERRANDS].sort());
        for (const name of ERRANDS) {
            assert.equal(J.jobOf(name, []), null, name);
            assert.equal(J.jobOf(name.slice(1), ['player', 3]), null, name);
        }
    });

    test('!stop and !endGoal end the job and are no job', () => {
        assert.equal(J.endsJob('!stop'), true);
        assert.equal(J.endsJob('!endGoal'), true);
        assert.equal(J.endsJob('!followPlayer'), false);
        assert.equal(J.endsJob('!mineOre'), false);
        assert.equal(J.jobOf('!stop', []), null);
        assert.equal(J.jobOf('!newAction', ['build a house']), null);
    });
});

describe('section 5: shouldResume with a fake clock', () => {
    const now = 10_000_000;
    const running = () => J.jobOf('!farmCycle', ['farm']);
    const base = (over = {}) => ({ job: running(), now, lastOrderAt: now - 60_000, actionRunning: false, sleeping: false, night: false,
        resumeSeconds: 60, ...over });

    test('true after resumeSeconds without an order, false a millisecond before', () => {
        assert.equal(J.shouldResume(base()), true);
        assert.equal(J.shouldResume(base({ lastOrderAt: now - 59_999 })), false);
        assert.equal(J.shouldResume(base({ resumeSeconds: 10, lastOrderAt: now - 10_000 })), true);
        assert.equal(J.shouldResume(base({ resumeSeconds: 10, lastOrderAt: now - 9_000 })), false);
    });

    test('false without a running job', () => {
        assert.equal(J.shouldResume(base({ job: null })), false);
        assert.equal(J.shouldResume(base({ job: { ...running(), state: 'paused' } })), false);
        assert.equal(J.shouldResume(base({ job: { ...running(), state: 'done' } })), false);
        assert.equal(J.shouldResume(base({ job: { ...running(), state: 'left' } })), false);
    });

    test('false while an action runs or the bot sleeps', () => {
        assert.equal(J.shouldResume(base({ actionRunning: true })), false);
        assert.equal(J.shouldResume(base({ sleeping: true })), false);
    });

    test('at night with night_shelter on the shelter reflex wins; with it off the job goes on', () => {
        assert.equal(J.shouldResume(base({ night: true, nightShelter: true })), false);
        assert.equal(J.shouldResume(base({ night: true })), false, 'night_shelter on when not given');
        assert.equal(J.shouldResume(base({ night: true, nightShelter: false })), true);
    });

    test('the mining job waits at night while the bot is not underground', () => {
        const mining = J.jobOf('!mineOre', ['iron', 16]);
        assert.equal(J.shouldResume(base({ job: mining, night: true, nightShelter: false, underground: false })), false);
        assert.equal(J.shouldResume(base({ job: mining, night: true, nightShelter: false, underground: true })), true);
        assert.equal(J.shouldResume(base({ job: mining, night: false, underground: false })), true, 'by day');
    });
});

describe('section 5: resumeCommand with the remaining count', () => {
    test('!mineOre("iron", 16) with 6 got gives !mineOre("iron", 10)', () => {
        const job = J.jobOf('!mineOre', ['iron', 16], { text: '!mineOre("iron", 16)' });
        job.got = 6;
        assert.equal(J.resumeCommand(job), '!mineOre("iron", 10)');
    });

    test('the other jobs with a count', () => {
        const craft = J.jobOf('!craftSupplies', ['torch', 32]);
        craft.got = 8;
        assert.equal(J.resumeCommand(craft), '!craftSupplies("torch", 24)');
        const collect = J.jobOf('!collectBlocks', ['stone', 10]);
        collect.got = 4;
        assert.equal(J.resumeCommand(collect), '!collectBlocks("stone", 6)');
        const chop = J.jobOf('!chopTrees', [8]);
        chop.got = 3;
        assert.equal(J.resumeCommand(chop), '!chopTrees(5)');
    });

    test('a job without a count runs its command again', () => {
        const farm = J.jobOf('!farmCycle', ['farm'], { text: '!farmCycle("farm")' });
        assert.equal(J.resumeCommand(farm), '!farmCycle("farm")');
        const harvest = J.jobOf('!harvest', ['farm']);
        assert.equal(J.resumeCommand(harvest), harvest.command);
    });

    test('progress counts the item of the job; isDone at the wanted count', () => {
        let job = J.jobOf('!mineOre', ['iron', 16]);
        job = J.progress(job, { raw_iron: 6, cobblestone: 20 });
        assert.equal(job.got, 6);
        assert.equal(J.isDone(job), false);
        job = J.progress(job, { raw_iron: 10 });
        assert.equal(job.got, 16);
        assert.equal(J.isDone(job), true);
    });
});

describe('section 5: blockerOf', () => {
    const KINDS_OF_BLOCKERS = ['no_torches', 'no_pickaxe', 'no_tool', 'no_wood', 'no_item'];
    const fail = (reason, text) => ({ ok: false, reason, text });

    test('the reasons no_pickaxe, no_tool, no_item, no_supplies', () => {
        assert.equal(J.blockerOf(fail('no_pickaxe', 'I cannot mine stone.'))?.kind, 'no_pickaxe');
        assert.equal(J.blockerOf(fail('no_tool', 'I cannot cut it.'))?.kind, 'no_tool');
        assert.equal(J.blockerOf(fail('no_item', 'I cannot do that.'))?.kind, 'no_item');
        const supplies = J.blockerOf(fail('no_supplies', 'I cannot do that.'));
        assert.ok(supplies && KINDS_OF_BLOCKERS.includes(supplies.kind), JSON.stringify(supplies));
    });

    test('the text I have no torches', () => {
        const b = J.blockerOf(fail(null, 'I have no torches. I stop the mining at 3 of 16.'));
        assert.equal(b?.kind, 'no_torches');
        assert.match(String(b.item), /torch/);
        assert.equal(J.blockerOf('Action output:\nI have no torches.')?.kind, 'no_torches', 'as the text of a command');
    });

    test('the text I need N <item> ... and have none', () => {
        const sticks = J.blockerOf(fail(null, 'I need 4 stick to craft torch and have none.'));
        assert.ok(sticks && KINDS_OF_BLOCKERS.includes(sticks.kind), JSON.stringify(sticks));
        assert.equal(sticks.item, 'stick');
        const iron = J.blockerOf(fail(null, 'I need 3 iron_ingot for the bucket and have none.'));
        assert.ok(iron && KINDS_OF_BLOCKERS.includes(iron.kind), JSON.stringify(iron));
        assert.equal(iron.item, 'iron_ingot');
    });

    test('the text I carry no food', () => {
        const b = J.blockerOf(fail(null, 'I carry no food.'));
        assert.ok(b && KINDS_OF_BLOCKERS.includes(b.kind), JSON.stringify(b));
    });

    test('no blocker for a success, a stop, another failure, nothing', () => {
        assert.equal(J.blockerOf({ ok: true, reason: null, text: 'Mined 16 iron.' }), null);
        assert.equal(J.blockerOf({ ok: false, reason: 'interrupted', text: 'I was stopped after 3 iron.' }), null);
        assert.equal(J.blockerOf(fail('no_path', 'I found no way there.')), null);
        assert.equal(J.blockerOf(undefined), null);
        assert.equal(J.blockerOf(null), null);
    });
});

describe('section 5: nextIdleJob', () => {
    const LIST = ['!farmCycle("farm")', '!craftSupplies("torch", 32)'];
    const now = 50_000_000;
    const min = 60_000;

    test('in order: the first that never ran or ran minutes ago or more', () => {
        assert.equal(J.nextIdleJob({ idleJobs: LIST, lastRun: {}, now, minutes: 15 }), LIST[0]);
        assert.equal(J.nextIdleJob({ idleJobs: LIST, lastRun: { [LIST[0]]: now - min }, now, minutes: 15 }), LIST[1]);
        assert.equal(J.nextIdleJob({ idleJobs: LIST, lastRun: { [LIST[0]]: now - min, [LIST[1]]: now - 2 * min }, now, minutes: 15 }), null);
        assert.equal(J.nextIdleJob({ idleJobs: LIST, lastRun: { [LIST[0]]: now - 15 * min, [LIST[1]]: now }, now, minutes: 15 }), LIST[0]);
        assert.equal(J.nextIdleJob({ idleJobs: LIST, lastRun: { [LIST[0]]: now - 15 * min + 1, [LIST[1]]: now }, now, minutes: 15 }), null);
    });

    test('an empty list: null', () => {
        assert.equal(J.nextIdleJob({ idleJobs: [], lastRun: {}, now, minutes: 15 }), null);
    });
});

// ----------------------------------------------------------------------------------------------- I4: createJob

/** The job on a fake agent: a store in memory, a fake clock, recorded orders and texts. */
function makeJob({ settings = {}, answers = [], results = {}, inventory = {} } = {}) {
    const env = { t: 1_000_000, said: [], orders: [], prompts: [] };
    const store = new IDX.JobStore(null, { now: () => new Date(env.t) });
    env.job = IDX.createJob({}, store, {
        settings: { job_memory: true, job_resume_seconds: 60, idle_jobs: [], idle_jobs_minutes: 15, ...settings },
        now: () => env.t,
        say: (text) => env.said.push(text),
        executeCommand: async (text, opts) => {
            env.orders.push([text, opts]);
            const name = text.match(/^!(\w+)/)?.[1];
            return results[name] ?? { ok: false, reason: 'no_path', text: 'I found no way there.' };
        },
        askModel: async (prompt) => {
            env.prompts.push(prompt);
            return answers.shift() ?? 'NONE';
        },
        inventory: () => inventory,
        actionRunning: () => false,
        sleeping: () => false,
        night: () => false,
        nightShelter: () => true,
        underground: () => false,
    });
    env.store = store;
    return env;
}

describe('I4: the job on the agent', () => {
    test('a job command starts the job; an errand changes nothing; after 60 s the bot goes back with the rest', async () => {
        const cap = captureConsole();
        try {
            const env = makeJob();
            env.job.onCommand('!mineOre', ['iron', 16], 'player', '!mineOre("iron", 16)');
            assert.equal(env.job.get()?.state, 'running');
            await env.job.onResult('!mineOre', { ok: false, reason: 'interrupted', text: 'I was stopped after 6 iron.' }, { raw_iron: 6 });
            assert.equal(env.job.get().got, 6);
            const errand = env.job.onCommand('!followPlayer', ['player', 3], 'player', '!followPlayer("player", 3)');
            assert.equal(errand.text, '', 'no text for an errand');
            assert.equal(env.job.get().kind, 'mineOre');
            assert.equal(env.job.get().state, 'running');
            env.t += 59_000;
            await env.job.tick();
            assert.deepEqual(env.orders, [], 'not before 60 s');
            env.t += 1_000;
            await env.job.tick();
            assert.equal(env.orders.length, 1);
            assert.equal(env.orders[0][0], '!mineOre("iron", 10)');
            assert.equal(env.orders[0][1]?.by, 'system', 'a system order');
            assert.ok(env.said.includes('I go back to the mining, 6 of 16 iron.'), env.said.join(' | '));
            assert.deepEqual(env.prompts, [], 'the model is not asked to resume');
        } finally {
            cap.restore();
        }
    });

    test('!stop ends the job with the leave text, and the bot does not go back', async () => {
        const cap = captureConsole();
        try {
            const env = makeJob();
            env.job.onCommand('!mineOre', ['iron', 16], 'player', '!mineOre("iron", 16)');
            await env.job.onResult('!mineOre', { ok: false, reason: 'interrupted', text: '' }, { raw_iron: 6 });
            const r = env.job.onCommand('!stop', [], 'player', '!stop');
            assert.equal(r.text, 'I leave the mining at 6 of 16 iron.');
            assert.ok(env.said.includes('I leave the mining at 6 of 16 iron.'));
            env.t += 120_000;
            await env.job.tick();
            assert.deepEqual(env.orders, []);
        } finally {
            cap.restore();
        }
    });

    test('a new job of other work replaces the job with the leave text', () => {
        const cap = captureConsole();
        try {
            const env = makeJob();
            env.job.onCommand('!farmCycle', ['farm'], 'player', '!farmCycle("farm")');
            const r = env.job.onCommand('!mineOre', ['iron', 8], 'model', '!mineOre("iron", 8)');
            assert.equal(r.text, 'I leave the farming.');
            assert.equal(env.job.get().kind, 'mineOre');
            assert.equal(env.job.get().by, 'model', 'a job chosen by the model is a job');
        } finally {
            cap.restore();
        }
    });

    test('onRestart: a running job says the restart text and stays running; status gives the line', async () => {
        const cap = captureConsole();
        try {
            const env = makeJob();
            env.job.onCommand('!mineOre', ['iron', 16], 'player', '!mineOre("iron", 16)');
            await env.job.onResult('!mineOre', { ok: false, reason: 'interrupted', text: '' }, { raw_iron: 6 });
            const again = IDX.createJob({}, env.store, { settings: {}, now: () => env.t, say: (t) => env.said.push(t), actionRunning: () => false });
            const r = again.onRestart();
            assert.equal(r.text, 'I was mining iron, 6 of 16. I go on.');
            assert.equal(again.get().state, 'running');
            assert.equal(again.status(), 'Job: the mining, 6 of 16 iron.');
            env.job.onCommand('!stop', [], 'player', '!stop');
            assert.equal(env.job.status(), '', 'no line without a job');
        } finally {
            cap.restore();
        }
    });

    test('a blocker: the model is asked once, the steps are set, the plan text is said', async () => {
        const cap = captureConsole();
        try {
            const env = makeJob({ answers: ['!chopTrees(2)\n!craftSupplies("planks", 8)\n!craftSupplies("stick", 16)\n!craftSupplies("torch", 16)'] });
            env.job.onCommand('!mineOre', ['iron', 16], 'player', '!mineOre("iron", 16)');
            await env.job.onResult('!mineOre', { ok: false, reason: 'no_torches', text: 'I have no torches.' }, {});
            await env.job.settled();
            assert.equal(env.prompts.length, 1, 'one call of the model');
            assert.equal(env.job.get().steps.length, 4);
            assert.ok(env.said.includes('I have no torches. I get wood, planks, sticks and torches, then I go on.'), env.said.join(' | '));
            assert.equal(env.job.status(), 'Job: the mining, 0 of 16 iron, step 1 of 4.');
        } finally {
            cap.restore();
        }
    });

    test('no plan: the no-plan text and the job pauses', async () => {
        const cap = captureConsole();
        try {
            const env = makeJob({ answers: ['NONE'] });
            env.job.onCommand('!mineOre', ['iron', 16], 'player', '!mineOre("iron", 16)');
            await env.job.onResult('!mineOre', { ok: false, reason: null, text: 'I have no torches.' }, {});
            await env.job.settled();
            assert.ok(env.said.includes('I could not plan the steps for the torches. Tell me what to do.'), env.said.join(' | '));
            assert.equal(env.job.get().state, 'paused');
        } finally {
            cap.restore();
        }
    });

    test('a resumed command that fails with the same text 3 times in a row pauses the job', async () => {
        const cap = captureConsole();
        try {
            const env = makeJob();
            env.job.onCommand('!mineOre', ['iron', 16], 'player', '!mineOre("iron", 16)');
            for (let i = 0; i < 3; i++) {
                env.t += 60_000;
                await env.job.tick();
            }
            assert.equal(env.orders.length, 3, env.orders.map((o) => o[0]).join(' | '));
            assert.ok(env.said.includes('I stop the mining: I found no way there.'), env.said.join(' | '));
            assert.equal(env.job.get().state, 'paused');
            env.t += 60_000;
            await env.job.tick();
            assert.equal(env.orders.length, 3, 'a paused job is not resumed');
        } finally {
            cap.restore();
        }
    });

    test('the standing list: with no job, after 60 s without an order, each entry as a system order, never planned', async () => {
        const cap = captureConsole();
        try {
            const LIST = ['!farmCycle("farm")', '!craftSupplies("torch", 32)'];
            const env = makeJob({ settings: { idle_jobs: LIST }, results: { farmCycle: { ok: true, text: 'done' }, craftSupplies: { ok: true, text: 'done' } } });
            env.t += 30_000;
            await env.job.tick();
            assert.deepEqual(env.orders, [], 'not before 60 s');
            env.t += 30_000;
            await env.job.tick();
            env.t += 5_000;
            await env.job.tick();
            assert.deepEqual(env.orders.map((o) => o[0]), LIST);
            assert.ok(env.orders.every((o) => o[1]?.by === 'system'));
            env.t += 5_000;
            await env.job.tick();
            assert.equal(env.orders.length, 2, 'each at most once per 15 minutes');
            env.t += 15 * 60_000;
            await env.job.tick();
            assert.equal(env.orders.length, 3);
            assert.deepEqual(env.prompts, [], 'never planned by the model');
            assert.equal(env.job.get(), null, 'the list makes no job');
        } finally {
            cap.restore();
        }
    });
});
