// Spec v0.1.4.10 part J (engineer E1): the texts of the job, src/agent/job/job_texts.js (I3), word for word.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const X = await loadSrc('src/agent/job/job_texts.js');
const L = await loadSrc('src/agent/job/job_logic.js');
const P = await loadSrc('src/agent/job/plan_logic.js');

const mining = (got = 6) => ({ ...L.jobOf('!mineOre', ['iron', 16]), got });
const farming = () => L.jobOf('!farmCycle', ['farm']);
const STEPS = P.parsePlan('!chopTrees(4)\n!craftSupplies("planks", 8)\n!craftSupplies("stick", 16)\n!craftSupplies("torch", 16)');

describe('the texts of I3', () => {
    test('resumeText', () => {
        assert.equal(X.resumeText(mining()), 'I go back to the mining, 6 of 16 iron.');
        assert.equal(X.resumeText(farming()), 'I go back to the farming.');
    });

    test('leaveText', () => {
        assert.equal(X.leaveText(mining()), 'I leave the mining at 6 of 16 iron.');
        assert.equal(X.leaveText(farming()), 'I leave the farming.');
    });

    test('restartText', () => {
        assert.equal(X.restartText(mining()), 'I was mining iron, 6 of 16. I go on.');
        assert.equal(X.restartText(farming()), 'I was farming. I go on.');
    });

    test('doneText', () => {
        assert.equal(X.doneText(mining(16)), 'The mining is done: 16 iron.');
        assert.equal(X.doneText(farming()), 'The farming is done.');
    });

    test('planText', () => {
        assert.equal(X.planText({ kind: 'no_torches', item: 'torch' }, STEPS), 'I have no torches. I get wood, planks, sticks and torches, then I go on.');
    });

    test('stepText', () => {
        assert.equal(X.stepText(2, 4, STEPS[2]), 'Step 2 of 4 done: 16 sticks.');
    });

    test('noPlanText', () => {
        assert.equal(X.noPlanText({ kind: 'no_torches', item: 'torch' }), 'I could not plan the steps for the torches. Tell me what to do.');
    });

    test('noJobText', () => {
        assert.equal(X.noJobText(), 'I have no job.');
    });

    test('idleStartText: the command of the standing list as configured (T3-8)', () => {
        assert.equal(X.idleStartText('!farmCycle("farm")'), 'I take the next of my list: !farmCycle("farm").');
        assert.equal(X.idleStartText(' !harvest '), 'I take the next of my list: !harvest.');
        assert.equal(X.idleStartText(null), 'I take the next of my list: nothing.');
    });
});

describe('the verbs of the restart text', () => {
    const cases = [
        ['!farmCycle', ['farm'], 'I was farming. I go on.'],
        ['!chopTrees', [8, ''], 'I was cutting wood, 0 of 8. I go on.'],
        ['!getTool', ['pickaxe', ''], 'I was making tools. I go on.'],
        ['!craftSupplies', ['torch', 32], 'I was making torch, 0 of 32. I go on.'],
        ['!collectBlocks', ['stone', 10], 'I was collecting stone, 0 of 10. I go on.'],
        ['!collectPassedOre', ['coal', 8], 'I was collecting coal, 0 of 8. I go on.'],
        ['!harvest', [''], 'I was harvesting. I go on.'],
        ['!plant', ['wheat_seeds', ''], 'I was planting. I go on.'],
    ];
    for (const [name, args, text] of cases) {
        test(name, () => assert.equal(X.restartText(L.jobOf(name, args)), text));
    }
});

describe('the texts beyond I3', () => {
    test('the done text counts what the skill said done', () => {
        assert.equal(X.doneText({ ...mining(5), skillDone: true }), 'The mining is done: 16 iron.');
        assert.equal(X.doneText({ ...mining(18) }), 'The mining is done: 18 iron.');
        assert.equal(X.doneText({ ...L.jobOf('!chopTrees', [8]), got: 8 }), 'The wood cutting is done: 8 logs.');
    });

    test('stopText for the same failure three times', () => {
        assert.equal(X.stopText(mining(), 'I found no way there.'), 'I stop the mining: I found no way there.');
        assert.equal(X.stopText(farming(), 'the farm is gone'), 'I stop the farming: the farm is gone.');
    });

    test('the plan text and the step text of other blockers', () => {
        const steps = P.parsePlan('!getTool("pickaxe", "stone")');
        assert.equal(X.planText({ kind: 'no_pickaxe', item: 'stone_pickaxe' }, steps), 'I have no stone pickaxe. I get a stone pickaxe, then I go on.');
        assert.equal(X.stepText(1, 1, steps[0]), 'Step 1 of 1 done: a stone pickaxe.');
        assert.equal(X.noPlanText({ kind: 'no_item', item: 'food' }), 'I could not plan the steps for the food. Tell me what to do.');
        assert.equal(X.noPlanText({ kind: 'no_wood', item: 'stick' }), 'I could not plan the steps for the wood. Tell me what to do.');
        assert.equal(X.stepText(1, 3, STEPS[0]), 'Step 1 of 3 done: 4 logs.');
    });

    test('statusText, the line of the knowledge block', () => {
        const job = { ...mining(), steps: STEPS.map((s, i) => ({ ...s, state: i === 0 ? 'done' : 'todo' })) };
        assert.equal(X.statusText(job), 'Job: the mining, 6 of 16 iron, step 2 of 4.');
        assert.equal(X.statusText(mining()), 'Job: the mining, 6 of 16 iron.');
        assert.equal(X.statusText(farming()), 'Job: the farming.');
        assert.equal(X.statusText({ ...farming(), state: 'paused' }), 'Job: the farming, paused.');
        assert.equal(X.statusText({ ...farming(), state: 'done' }), '');
        assert.equal(X.statusText(null), '');
    });
});
