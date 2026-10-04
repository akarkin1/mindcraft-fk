// Spec v0.1.4.13, 4.4 P3 (part P, engineer E3): a plan that a job made runs its first step at once, in the same
// call, and says the plan once, then the step text `Step 1 of 3: !mineOre("iron", 3).`; the steps after the first
// come through tick as before. A fake pack counts its calls.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeJobWorld } from '../helpers/xp_job_world.js';

const X = await loadSrc('src/agent/job/job_texts.js');

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

describe('P3: the text of a step that starts', () => {
    test('stepStartText, word for word', () => {
        assert.equal(X.stepStartText(1, 3, { command: '!mineOre("iron", 3)' }), 'Step 1 of 3: !mineOre("iron", 3).');
        assert.equal(X.stepStartText(2, 2, { command: '!smeltItem("raw_iron", 3)' }), 'Step 2 of 2: !smeltItem("raw_iron", 3).');
        assert.equal(X.stepStartText(1, 1, null), 'Step 1 of 1: nothing.');
    });
});

describe('P3: the plan of !getTool starts at once, in the same call', () => {
    const PLAN = '!mineOre("iron", 3)\n!smeltItem("raw_iron", 3)';

    function world(answers = [PLAN]) {
        const calls = { mineOre: 0, smeltItem: 0, getTool: 0 };
        const w = makeJobWorld({
            answers,
            handlers: {
                '!getTool': () => {
                    calls.getTool++;
                    return { result: { ok: false, reason: 'no_iron', text: 'I have no iron for an iron_pickaxe: 3 iron_ingot or 3 raw_iron are needed. Say "mine 3 iron" first.' } };
                },
                '!mineOre': (args) => {
                    calls.mineOre++;
                    return { result: { ok: true, reason: null, text: `I mined ${args[1]} raw_iron.` }, gain: { raw_iron: args[1] } };
                },
                '!smeltItem': (args) => {
                    calls.smeltItem++;
                    return { result: { ok: true, reason: null, text: `I smelted ${args[1]} raw_iron.` }, gain: { iron_ingot: args[1], raw_iron: -args[1] } };
                },
            },
        });
        w.where = { underground: true, depth: 40, area: null, mine: { name: 'deep', tunnel: 0, level: -59 } };
        return { w, calls };
    }

    test('the typed !getTool: the plan text, then the step text, then the first step ran, all in the one call', async () => {
        const { w, calls } = world();
        await w.run('!getTool("iron_pickaxe")', 'Steve');
        assert.equal(w.prompts.length, 1, 'the model once');
        assert.equal(calls.mineOre, 1, 'the first step ran without a tick and without a second order');
        assert.equal(calls.smeltItem, 0, 'the second step waits for tick');
        const plan = w.said.indexOf('I have no iron ingot. I get raw_iron and iron_ingot, then I go on.');
        assert.ok(plan >= 0, w.said.join(' | '));
        assert.equal(w.said[plan + 1], 'Step 1 of 2: !mineOre("iron", 3).');
        assert.equal(w.said[plan + 2], 'Step 1 of 2 done: 3 raw_iron.');
        assert.deepEqual(w.ran.map(r => [r.text, r.by]), [['!getTool("iron_pickaxe")', 'Steve'], ['!mineOre("iron", 3)', 'system']]);
        assert.equal(w.job.status(), 'Job: the tool making, step 2 of 2.');
    });

    test('the second step comes with tick, with its own step text; the plan is said once', async () => {
        const { w, calls } = world();
        await w.run('!getTool("iron_pickaxe")', 'Steve');
        w.wait(5);
        await w.job.tick();
        assert.equal(calls.smeltItem, 1);
        assert.equal(w.said.filter(t => t.startsWith('I have no iron ingot.')).length, 1, 'the plan once');
        assert.ok(w.said.includes('Step 2 of 2: !smeltItem("raw_iron", 3).'), w.said.join(' | '));
        assert.equal(w.said.at(-1), 'Step 2 of 2 done: 3 iron_ingot.');
        assert.equal(w.prompts.length, 1);
    });

    test('a plan of a resumed command (tick never waits for the model) starts its first step when the answer comes', async () => {
        let release;
        const { w, calls } = world([]);
        const J = await loadSrc('src/agent/job/index.js');
        w.job.onCommand('!getTool', ['iron_pickaxe', ''], 'Steve', '!getTool("iron_pickaxe")');
        await w.job.onResult('!getTool', { ok: false, reason: 'interrupted', text: '' }, {});
        w.job = J.createJob(w.agent, w.store, {
            settings: {}, now: () => w.t, executeCommand: (text, options) => w.run(text, options?.by),
            askModel: () => new Promise((resolve) => { release = resolve; }),
        });
        w.wait(60);
        await w.job.tick();
        assert.equal(calls.getTool, 1, 'the resumed command ran and failed');
        assert.equal(calls.mineOre, 0, 'no step before the model answers');
        release(PLAN);
        await w.job.settled();
        assert.equal(calls.mineOre, 1, 'the first step ran right after the plan');
        assert.ok(w.said.includes('Step 1 of 2: !mineOre("iron", 3).'), w.said.join(' | '));
    });

    test('no plan from the model: no step, the no-plan text as before', async () => {
        const { w, calls } = world(['NONE']);
        await w.run('!getTool("iron_pickaxe")', 'Steve');
        assert.equal(calls.mineOre, 0);
        assert.equal(w.said.at(-1), 'I could not plan the steps for the iron ingot. Tell me what to do.');
    });

    test('a first step that needs the surface, underground: the way out first, then the step, in the same call', async () => {
        const { w, calls } = world(['!fetchItem("coal", 4)']);
        let out = 0;
        w.handlers['!leaveMine'] = (args, world) => {
            out++;
            world.where = { underground: false, area: null };
            return { result: { ok: true, reason: null, text: 'I am out of the mine.' } };
        };
        w.handlers['!fetchItem'] = (args) => ({ result: { ok: true, reason: null, text: `I took ${args[1]} ${args[0]}.` }, gain: { [args[0]]: args[1] } });
        await w.run('!getTool("iron_pickaxe")', 'Steve');
        assert.equal(out, 1);
        assert.equal(calls.mineOre, 0);
        assert.deepEqual(w.ran.slice(1).map(r => r.text), ['!leaveMine', '!fetchItem("coal", 4)']);
        assert.equal(w.said.at(-1), 'Step 1 of 1 done: 4 coal.');
    });
});
