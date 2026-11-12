// Spec v0.1.4.16, F3 (engineer E2): the idle test reads the watch queue. createJob takes an option isBusy() (agent.js gives
// the watch queue's isActive() or a size above 0): while it is true, tick() starts no round of a routine; false, the round
// runs; a running round is not interrupted by it (the queue's command interrupts it as any order would). Without the option
// the job is never busy.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const J = await loadSrc('src/agent/job/index.js');
const R = await loadSrc('src/agent/routines/routines.js');

const T0 = Date.UTC(2026, 11, 1, 12, 0, 0);
const TEXT = 'harvest the wheat farm every minute';
const PLAN = '!harvest("wheat_farm")\n!storeItems()';

let log;
before(() => {
    log = console.log;
    console.log = () => {};
});
after(() => {
    console.log = log;
});

function parse(text) {
    const m = text.match(/^!(\w+)(?:\((.*)\))?$/);
    return { name: `!${m[1]}`, args: m[2] ? m[2].split(/\s*,\s*/).map(a => a.replace(/^"|"$/g, '')) : [] };
}

// A fake queue as agent.watch.watch.queue of the watch server: isActive() and size().
function makeQueue() {
    return { active: false, pending: 0, isActive() { return this.active; }, size() { return this.pending; } };
}

function makeWorld({ queue = makeQueue(), isBusy, idleJobs = [] } = {}) {
    const w = { t: T0, said: [], ran: [], prompts: [], queue };
    const agent = {
        sayText: (text) => w.said.push(text), openChat: (text) => w.said.push(text),
        actions: { executing: false, currentActionLabel: '' },
        bot: { inventory: { items: () => [] }, time: { timeOfDay: 1000 }, isSleeping: false, registry: { itemsByName: {} } },
        whereAmI: () => ({ underground: false }), _workStores: () => ({ chests: null, mines: null }),
        area_store: { list: () => [{ name: 'wheat_farm', kind: 'farm' }] }, memory_bank: { store: { names: () => [] } }, rule_store: { list: () => [] }, blocked_actions: [],
        // as agent.js wires the watch server
        watch: { watch: { queue } },
    };
    w.agent = agent;
    const settings = { job_resume_seconds: 60, idle_jobs: idleJobs, idle_jobs_minutes: 1 };
    w.run = async (text, options) => {
        const { name, args } = parse(text);
        w.ran.push(text);
        w.job.onCommand(name, args, options?.by ?? 'system', text);
        await w.job.onResult(name, { ok: true, reason: null, text: 'Done.' }, {});
        return 'Done.';
    };
    // the option as agent.js gives it, unless the test gives its own
    const busy = isBusy ?? (() => agent.watch?.watch?.queue?.isActive?.() === true || (agent.watch?.watch?.queue?.size?.() ?? 0) > 0);
    w.job = J.createJob(agent, new J.JobStore(null, { now: () => new Date(w.t) }), {
        settings, now: () => w.t, executeCommand: (text, options) => w.run(text, options), askModel: async () => { throw new Error('never'); },
        routines: () => w.routines, isBusy: busy,
    });
    agent.job = w.job;
    w.routines = R.createRoutines(agent, new R.RoutineStore(null, { now: () => new Date(w.t) }), {
        settings, now: () => w.t, askModel: async (prompt) => { w.prompts.push(prompt); return PLAN; },
    });
    agent.routines = w.routines;
    w.routines.remember('the farm', TEXT);
    w.t += 61000;
    return w;
}

describe('the idle test and the watch queue (F3)', () => {
    test('isBusy true (a command runs): no round is due, no plan is asked; false: the round runs', async () => {
        const w = makeWorld();
        w.queue.active = true;
        assert.deepEqual(await w.job.tick(), { ok: true, reason: 'wait', text: '' });
        assert.deepEqual(await w.job.tick(), { ok: true, reason: 'wait', text: '' });
        assert.equal(w.prompts.length, 0, 'no plan while the supervisor works');
        assert.equal(w.job.get(), null, 'no round started');
        w.queue.active = false;
        w.queue.pending = 2;
        assert.deepEqual(await w.job.tick(), { ok: true, reason: 'wait', text: '' }, 'commands waiting in the queue count as busy');
        w.queue.pending = 0;
        await w.job.tick();
        assert.equal(w.prompts.length, 1, 'the plan once the queue is empty');
        assert.equal(w.said[1], 'I start the routine "the farm", round 1.');
        assert.equal(w.job.get()?.kind, 'routine');
    });

    test('a running round is not interrupted when the queue gets busy: its next step still runs', async () => {
        const w = makeWorld();
        await w.job.tick(); // the plan and the first step
        assert.equal(w.job.get()?.state, 'running');
        assert.deepEqual(w.ran, ['!harvest("wheat_farm")']);
        w.queue.active = true;
        await w.job.tick();
        assert.deepEqual(w.ran, ['!harvest("wheat_farm")', '!storeItems'], 'the second step ran while the queue was busy');
        assert.equal(w.said[w.said.length - 1], 'Round 1 of "the farm" is done.');
    });

    test('the standing list is not held by the queue (the spec names the rounds only); an isBusy that throws counts as not busy', async () => {
        const w = makeWorld({ idleJobs: ['!storeItems'], isBusy: () => { throw new Error('no queue'); } });
        w.queue.active = true;
        await w.job.tick();
        assert.equal(w.prompts.length, 1, 'a throwing isBusy is not busy');
        const idle = makeWorld({ idleJobs: ['!storeItems'] });
        idle.routines.forget('the farm');
        idle.queue.active = true;
        await idle.job.tick();
        assert.deepEqual(idle.ran, ['!storeItems'], 'the standing list runs as before');
    });

    test('without the option the job is never busy', async () => {
        const w = { t: T0 + 61000, prompts: [] };
        const agent = { sayText() {}, openChat() {}, actions: { executing: false }, bot: { inventory: { items: () => [] }, time: { timeOfDay: 1000 }, isSleeping: false, registry: { itemsByName: {} } },
            whereAmI: () => ({ underground: false }), _workStores: () => ({ chests: null, mines: null }), area_store: { list: () => [] }, memory_bank: { store: { names: () => [] } }, rule_store: { list: () => [] }, blocked_actions: [] };
        const settings = { job_resume_seconds: 60, idle_jobs: [] };
        const job = J.createJob(agent, new J.JobStore(null, { now: () => new Date(w.t) }), { settings, now: () => w.t, executeCommand: async () => 'Done.', routines: () => routines });
        const routines = R.createRoutines(agent, new R.RoutineStore(null, { now: () => new Date(w.t) }), { settings, now: () => w.t, askModel: async (p) => { w.prompts.push(p); return PLAN; }, job: () => job });
        routines.remember('the farm', TEXT);
        w.t += 61000; // the start counts as an order: the bot waits job_resume_seconds first
        await job.tick();
        assert.equal(w.prompts.length, 1);
    });
});
