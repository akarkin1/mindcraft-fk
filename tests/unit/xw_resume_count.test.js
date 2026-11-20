// E3, spec v0.1.4.16 F5 (the play of 2026-11-11: "0 of 32" with 22 raw iron in the bag): a !mineOre that goes on with a
// job counts the bag once. The job answers ctx.job.progress() without a count with its got (job/index.js); the trip counts
// startCount = bagCount - min(got, bagCount), so the ore of the earlier trips in the bag is in the count from the start, and
// its reports to the job leave that ore out (job.got = base + count of this run, as before). A fresh order counts from the
// bag as today.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeMiningBot, makeClock, makeCtx, give } from './mining_fake_bot.test.js';

const J = await loadSrc('src/agent/job/index.js');
const M = await loadSrc('src/agent/packs/mining/mining.js');

const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);

function jobWorld() {
    const w = { t: T0, said: [], inventory: {} };
    w.agent = {
        sayText: (text) => w.said.push(text),
        actions: { executing: false, currentActionLabel: '' },
        bot: { inventory: { items: () => Object.entries(w.inventory).map(([name, count]) => ({ name, count })) }, time: { timeOfDay: 1000 }, isSleeping: false },
        whereAmI: () => ({ underground: false }),
        _workStores: () => ({ chests: null, mines: null }),
    };
    w.store = new J.JobStore(null, { now: () => new Date(w.t) });
    w.job = J.createJob(w.agent, w.store, {
        settings: { job_resume_seconds: 60, idle_jobs: [], idle_jobs_minutes: 15 },
        now: () => w.t,
        executeCommand: async () => '',
        askModel: async () => 'NONE',
    });
    return w;
}

describe('F5: the question to the job, progress() without a count', () => {
    test('no job: no_job; a running job: ok, reason job, got and wanted; the question changes nothing', () => {
        const w = jobWorld();
        assert.deepEqual([w.job.progress().ok, w.job.progress().reason], [false, 'no_job']);
        w.job.onCommand('!mineOre', ['iron', 32, false], 'Steve', '!mineOre("iron", 32, false)');
        const asked = w.job.progress();
        assert.deepEqual([asked.ok, asked.reason, asked.got, asked.wanted], [true, 'job', 0, 32]);
        assert.ok('created' in asked);
        assert.equal(w.job.progress(22).ok, true, 'the count of the run');
        assert.equal(w.job.get().got, 22);
        assert.equal(w.job.progress().got, 22, 'the question after a report');
        assert.equal(w.job.get().got, 22, 'unchanged by the question');
        assert.deepEqual([w.job.progress(-1).ok, w.job.progress(-1).reason], [false, 'bad_count'], 'a bad count as before');
        assert.deepEqual([w.job.progress('x').ok, w.job.progress('x').reason], [false, 'bad_count']);
    });

    test('after the trip was interrupted the job keeps its got and answers it to the next trip', async () => {
        const w = jobWorld();
        w.job.onCommand('!mineOre', ['iron', 32, false], 'Steve', '!mineOre("iron", 32, false)');
        w.job.progress(22);
        await w.job.onResult('!mineOre', { ok: false, reason: 'interrupted', text: 'I am still in the mine.' }, { raw_iron: 22 });
        assert.equal(w.job.get().got, 22);
        const asked = w.job.progress();
        assert.deepEqual([asked.ok, asked.got, asked.wanted], [true, 22, 32]);
    });
});

async function scene({ world = makeWorld() } = {}) {
    const bot = makeMiningBot({ world, pos: [0.5, 64, 0.5] });
    const clock = makeClock(bot);
    const ctx = await makeCtx(clock);
    const said = [];
    ctx.say = t => said.push(t);
    ctx.storage = { async storeItems() { return { ok: true, reason: null, stored: {}, left: {}, text: 'I stored nothing.' }; } };
    return { world, bot, clock, ctx, said, opts: { now: clock.now, wait: clock.wait } };
}

function kit(bot) {
    give(bot, 'iron_pickaxe', 1);
    give(bot, 'ladder', 64);
    give(bot, 'cobblestone', 64);
    give(bot, 'torch', 16);
    give(bot, 'bread', 8);
    give(bot, 'chest', 2);
}

// A job of the glue as the trip sees it: the question answers `got`, the reports are kept.
function fakeJob(got, wanted) {
    const job = { calls: [] };
    job.progress = (n) => {
        if (n === undefined) {
            return { ok: true, reason: 'job', text: '', got, wanted };
        }
        job.calls.push(n);
        return { ok: true, reason: 'progress', text: '' };
    };
    return job;
}

const coalWorld = () => makeWorld().set(1, 56, -5, 'coal_ore').set(1, 57, -5, 'coal_ore').set(-1, 56, -8, 'coal_ore');

describe('F5: the count at the start of the trip', () => {
    test('a job with got 2 and 2 coal in the bag: the trip counts them once, mines 1 more for 3 and reports 0 then 1', async () => {
        const s = await scene({ world: coalWorld() });
        kit(s.bot);
        give(s.bot, 'coal', 2);
        s.ctx.job = fakeJob(2, 3);
        const r = await M.mineOre(s.bot, s.ctx, 'coal', 3, { ...s.opts, newMine: true });
        assert.equal(r.ok, true, r.text);
        // the vein of two coal ore is dug at once, so the trip may bring one more than asked
        assert.ok(r.mined >= 3 && r.mined <= 4, `the 2 of the bag and what was mined: ${r.mined}`);
        assert.match(r.text, /^I mined [34] coal\./);
        assert.equal(s.ctx.job.calls[0], 0, 'the first report leaves the bag\'s ore out');
        assert.equal(s.ctx.job.calls.at(-1), r.mined - 2, 'the last report is what this run mined');
        assert.ok(s.ctx.job.calls.every(n => n >= 0));
    });

    test('a fresh order (got 0) with 2 coal in the bag counts from the bag as today: 1 wanted, 1 mined', async () => {
        const s = await scene({ world: coalWorld() });
        kit(s.bot);
        give(s.bot, 'coal', 2);
        s.ctx.job = fakeJob(0, 1);
        const r = await M.mineOre(s.bot, s.ctx, 'coal', 1, { ...s.opts, newMine: true });
        assert.equal(r.ok, true, r.text);
        assert.ok(r.mined >= 1 && r.mined <= 2, `what was mined, the bag's 2 left out: ${r.mined}`);
        assert.equal(s.ctx.job.calls.at(-1), r.mined, 'the whole count is this run\'s');
    });

    test('a job with got 5 but an empty bag (the ore is in a chest): the count starts at 0 and the reports are this run\'s', async () => {
        const s = await scene({ world: coalWorld() });
        kit(s.bot);
        s.ctx.job = fakeJob(5, 6);
        const r = await M.mineOre(s.bot, s.ctx, 'coal', 1, { ...s.opts, newMine: true });
        assert.equal(r.ok, true, r.text);
        assert.ok(r.mined >= 1 && r.mined <= 2, `nothing of the job's 5 is in the bag: ${r.mined}`);
        assert.equal(s.ctx.job.calls[0], 0);
        assert.equal(s.ctx.job.calls.at(-1), r.mined);
    });

    // G-1 (the gate of 62bce43, W85 job_comes_back: 4 raw iron where 8 were ordered): the job's resume orders the remaining
    // count (wanted - got); the earlier trips' ore in the bag must not count against it again
    test('a resume of the job (got 2 of 3, the order for the remaining 1) with the 2 coal in the bag mines 1 more', async () => {
        const s = await scene({ world: coalWorld() });
        kit(s.bot);
        give(s.bot, 'coal', 2);
        s.ctx.job = fakeJob(2, 3);
        const r = await M.mineOre(s.bot, s.ctx, 'coal', 1, { ...s.opts, newMine: true });
        assert.equal(r.ok, true, r.text);
        assert.ok(r.mined >= 1 && r.mined <= 2, `the bag's 2 left out, 1 more mined: ${r.mined}`);
        assert.ok(s.bot.inventory.items().filter(i => i.name === 'coal').reduce((n, i) => n + i.count, 0) >= 3, 'the bag holds the job\'s 3');
        assert.equal(s.ctx.job.calls.at(-1), r.mined, 'the report is this run\'s count');
    });

    test('without a job (no ctx.job) everything is as before', async () => {
        const s = await scene({ world: coalWorld() });
        kit(s.bot);
        give(s.bot, 'coal', 2);
        const r = await M.mineOre(s.bot, s.ctx, 'coal', 1, { ...s.opts, newMine: true });
        assert.equal(r.ok, true, r.text);
        assert.ok(r.mined >= 1 && r.mined <= 2, `counted from the bag: ${r.mined}`);
    });
});
