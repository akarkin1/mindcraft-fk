// Spec v0.1.4.13, 4.4 P5 (part P, engineer E3): the job's got is set from the skill's own count each time the
// skill reports progress (the pack calls ctx.job?.progress?.(got)), and the stop text and the job line say the
// same number. A fake pack that reports 7 asserts both texts; the gain of the inventory is not added on top.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeJobWorld } from '../helpers/xp_job_world.js';

const T = await loadSrc('src/agent/packs/mining/texts.js');

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

// The fake mining pack: it reports `got` through the job as the real pack does through ctx.job.progress, picks up
// `gain` diamonds (the inventory gain the glue sees), and stops for its pickaxe with the text of the pack.
function fakeMining({ got = 7, gain = 7, reason = 'pickaxe' } = {}) {
    return (args, w) => {
        const wanted = args[1];
        w.job.progress(Math.min(3, got));
        w.job.progress(got);
        const text = T.mineOreText({ item: 'diamond', mined: got, wanted, reason });
        return { result: { ok: got >= wanted, reason: got >= wanted ? null : reason, text }, gain: { diamond: gain } };
    };
}

describe('P5: the counter of the job is the count of the skill', () => {
    test('a fake pack that reports 7: the stop text says 7 of 28 and the job line says 7 of 28', async () => {
        const w = makeJobWorld({ handlers: { '!mineOre': fakeMining({ got: 7, gain: 7 }) } });
        const text = await w.run('!mineOre("diamond", 28)', 'Steve');
        assert.equal(text, 'I mined 7 diamond of 28. I stopped because my pickaxe is nearly broken.');
        assert.equal(w.job.get().got, 7);
        // the pickaxe is a blocker: the job planned (no answer here) and paused; the number is the one of the skill
        assert.match(w.job.status(), /^Job: the mining, 7 of 28 diamond(, paused)?\.$/);
        assert.equal(w.job.progress(5).reason, 'no_job', 'a report to a paused job is refused');
    });

    test('the gain of the inventory is not added on top of what the skill reported', async () => {
        const w = makeJobWorld({ handlers: { '!mineOre': fakeMining({ got: 7, gain: 7 }) } });
        await w.run('!mineOre("diamond", 28)', 'Steve');
        assert.equal(w.job.get().got, 7, 'not 14');
    });

    test('a gain of 0 (the ore stored at the base) still counts what the skill said: never 0 of 28 beside 7 of 28', async () => {
        const w = makeJobWorld({ handlers: { '!mineOre': fakeMining({ got: 7, gain: 0 }) } });
        const text = await w.run('!mineOre("diamond", 28)', 'Steve');
        assert.match(text, /^I mined 7 diamond of 28\./);
        assert.match(w.job.status(), /^Job: the mining, 7 of 28 diamond(, paused)?\.$/);
    });

    test('a pack that does not report: the gain of the inventory counts as before', async () => {
        const w = makeJobWorld({
            handlers: { '!mineOre': () => ({ result: { ok: false, reason: 'time', text: 'I mined 5 diamond of 28. I stopped because the time for one trip is over.' }, gain: { diamond: 5 } }) },
        });
        await w.run('!mineOre("diamond", 28)', 'Steve');
        assert.equal(w.job.status(), 'Job: the mining, 5 of 28 diamond.');
        assert.equal(w.job.progress(5).reason, 'not_running', 'a report after the skill ended is refused');
        assert.equal(w.job.get().got, 5);
    });

    test('a resumed command counts from what the job had: 7, then the skill reports 4 of its 21: 11 of 28', async () => {
        const w = makeJobWorld({ handlers: { '!mineOre': fakeMining({ got: 7, gain: 7, reason: 'interrupted' }) } });
        await w.run('!mineOre("diamond", 28)', 'Steve');
        assert.equal(w.job.get().got, 7);
        w.handlers['!mineOre'] = fakeMining({ got: 4, gain: 4, reason: 'time' });
        w.wait(60);
        await w.job.tick();
        assert.equal(w.ran.at(-1).text, '!mineOre("diamond", 21)');
        assert.equal(w.job.get().got, 11);
        assert.equal(w.job.status(), 'Job: the mining, 11 of 28 diamond.');
    });

    test('a glue without hooks for the system order: the report still reaches the job', async () => {
        const w = makeJobWorld({ hooks: false, handlers: { '!mineOre': fakeMining({ got: 7, gain: 7, reason: 'interrupted' }) } });
        await w.run('!mineOre("diamond", 28)', 'Steve');
        w.handlers['!mineOre'] = fakeMining({ got: 4, gain: 4, reason: 'time' });
        w.wait(60);
        await w.job.tick();
        assert.equal(w.job.get().got, 11);
    });

    test('a step of a plan never changes the count of the job; a report without a running job is refused', async () => {
        const w = makeJobWorld({
            answers: ['!mineOre("iron", 3)'],
            handlers: {
                '!getTool': () => ({ result: { ok: false, reason: 'no_iron', text: 'I have no iron for an iron_pickaxe.' } }),
                '!mineOre': (args, world) => {
                    world.job.progress(3);
                    return { result: { ok: true, reason: null, text: 'I mined 3 raw_iron.' }, gain: { raw_iron: 3 } };
                },
            },
        });
        await w.run('!getTool("iron_pickaxe")', 'Steve');
        assert.equal(w.job.get().got, null, 'a job without a count');
        assert.equal(w.job.get().steps[0].state, 'done');
        assert.equal(w.job.progress(5).reason, 'no_job', 'a job without a count takes no report');
        assert.equal(w.job.progress(-1).reason, 'bad_count');
        assert.equal(w.job.progress('x').reason, 'bad_count');
    });

    test('W109: the owner\'s !stop while the skill runs: the leave text waits for the last report and says the skill\'s count', async () => {
        let release;
        const w = makeJobWorld({
            handlers: {
                '!mineOre': async (args, world) => {
                    world.job.progress(0);
                    await new Promise((resolve) => { release = resolve; });
                    world.job.progress(2); // the last report of the skill, when the stop reached it
                    return { result: { ok: false, reason: 'interrupted', text: 'I mined 2 raw_iron of 6. I am still in the mine.' }, gain: { raw_iron: 2 } };
                },
            },
        });
        const run = w.run('!mineOre("iron", 6)', 'Steve');
        for (let i = 0; i < 10 && !release; i++) {
            await new Promise((resolve) => setImmediate(resolve));
        }
        const stop = w.job.onCommand('!stop', [], 'Steve', '!stop');
        assert.deepEqual(stop, { ok: true, reason: 'ended', text: '' }, 'no leave text yet: the skill counts itself');
        assert.equal(w.job.get().state, 'left');
        assert.ok(!w.said.some(t => t.startsWith('I leave')), w.said.join(' | '));
        release();
        await run;
        assert.equal(w.said.at(-1), 'I leave the mining at 2 of 6 iron.');
        assert.equal(w.said.filter(t => t.startsWith('I leave')).length, 1);
        assert.equal(w.job.get().got, 2);
        assert.equal(w.job.status(), 'Last job: the mining, left.');
        assert.equal(w.job.progress(9).reason, 'no_job', 'no report after the result');
    });

    test('!stop while a skill runs that did not report: the leave text at once, as before', async () => {
        let release;
        const w = makeJobWorld({ handlers: { '!mineOre': async () => { await new Promise((resolve) => { release = resolve; }); return { result: { ok: false, reason: 'interrupted', text: '' }, gain: { raw_iron: 1 } }; } } });
        const run = w.run('!mineOre("iron", 6)', 'Steve');
        for (let i = 0; i < 10 && !release; i++) {
            await new Promise((resolve) => setImmediate(resolve));
        }
        assert.equal(w.job.onCommand('!stop', [], 'Steve', '!stop').text, 'I leave the mining at 0 of 6 iron.');
        release();
        await run;
        assert.equal(w.said.filter(t => t.startsWith('I leave')).length, 1, 'said once');
    });

    test('the done text comes from the count of the skill too', async () => {
        const w = makeJobWorld({ handlers: { '!mineOre': fakeMining({ got: 28, gain: 28 }) } });
        await w.run('!mineOre("diamond", 28)', 'Steve');
        assert.equal(w.said.at(-1), 'The mining is done: 28 diamond.');
        assert.equal(w.job.status(), 'Last job: the mining, done, 28 diamond.');
    });
});
