// Tester T1 of v0.1.4.10 "Goals", from the spec: the texts of the job (I3), word for word, and the line of
// status() (I4). The job records are made by jobOf (I2), as the agent makes them.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const T = await loadSrc('src/agent/job/job_texts.js');
const J = await loadSrc('src/agent/job/job_logic.js');

function job(name, args, got = null, extra = {}) {
    const j = J.jobOf(name, args);
    assert.ok(j, `${name} is a job`);
    if (got !== null) j.got = got;
    return { ...j, ...extra };
}

const mining = () => job('mineOre', ['iron', 16], 6);
const farming = () => job('farmCycle', ['farm']);

describe('I3: the texts of the job, word for word', () => {
    test('resumeText', () => {
        assert.equal(T.resumeText(mining()), 'I go back to the mining, 6 of 16 iron.');
        assert.equal(T.resumeText(farming()), 'I go back to the farming.');
    });

    test('leaveText', () => {
        assert.equal(T.leaveText(mining()), 'I leave the mining at 6 of 16 iron.');
        assert.equal(T.leaveText(farming()), 'I leave the farming.');
    });

    test('restartText', () => {
        assert.equal(T.restartText(mining()), 'I was mining iron, 6 of 16. I go on.');
    });

    test('restartText: the verbs of the jobs', () => {
        const cases = [
            [job('mineOre', ['iron', 16], 6), 'I was mining iron'],
            [job('farmCycle', ['farm']), 'I was farming'],
            [job('chopTrees', [8], 2), 'I was cutting wood'],
            [job('getTool', ['pickaxe', 'stone']), 'I was making tools'],
            [job('craftSupplies', ['torch', 32], 8), 'I was making torch'],
            [job('collectBlocks', ['stone', 10], 4), 'I was collecting stone'],
            [job('harvest', ['farm']), 'I was harvesting'],
            [job('plant', ['wheat_seeds', 'farm']), 'I was planting'],
        ];
        for (const [j, start] of cases) {
            const text = T.restartText(j);
            assert.ok(text.startsWith(start), `${j.kind}: ${text}`);
            assert.ok(text.endsWith('. I go on.'), `${j.kind}: ${text}`);
        }
        assert.equal(T.restartText(job('craftSupplies', ['torch', 32], 8)), 'I was making torch, 8 of 32. I go on.');
    });

    test('doneText', () => {
        assert.equal(T.doneText(job('mineOre', ['iron', 16], 16)), 'The mining is done: 16 iron.');
        assert.equal(T.doneText(farming()), 'The farming is done.');
    });

    test('planText: the steps as the items of their checks', () => {
        const steps = [
            { command: '!chopTrees(2)', check: { item: 'log', count: 2 }, state: 'todo' },
            { command: '!craftSupplies("planks", 8)', check: { item: 'planks', count: 8 }, state: 'todo' },
            { command: '!craftSupplies("stick", 16)', check: { item: 'stick', count: 16 }, state: 'todo' },
            { command: '!craftSupplies("torch", 16)', check: { item: 'torch', count: 16 }, state: 'todo' },
        ];
        assert.equal(T.planText({ kind: 'no_torches', item: 'torch' }, steps),
            'I have no torches. I get wood, planks, sticks and torches, then I go on.');
    });

    test('planText with the steps that parsePlan gives', async () => {
        const P = await loadSrc('src/agent/job/plan_logic.js');
        const steps = P.parsePlan('!chopTrees(2)\n!craftSupplies("planks", 8)\n!craftSupplies("stick", 16)\n!craftSupplies("torch", 16)');
        assert.ok(steps);
        assert.equal(T.planText({ kind: 'no_torches', item: 'torch' }, steps),
            'I have no torches. I get wood, planks, sticks and torches, then I go on.');
    });

    test('stepText', () => {
        assert.equal(T.stepText(2, 4, { command: '!craftSupplies("stick", 16)', check: { item: 'stick', count: 16 } }), 'Step 2 of 4 done: 16 sticks.');
    });

    test('noPlanText', () => {
        assert.equal(T.noPlanText({ kind: 'no_torches', item: 'torch' }), 'I could not plan the steps for the torches. Tell me what to do.');
    });

    test('noJobText', () => {
        assert.equal(T.noJobText(), 'I have no job.');
    });
});

describe('I4: the line of the knowledge block', () => {
    test('Job: the mining, 6 of 16 iron, step 2 of 4.', () => {
        const j = mining();
        j.steps = [
            { command: '!chopTrees(2)', check: { item: 'log', count: 2 }, state: 'done' },
            { command: '!craftSupplies("planks", 8)', check: { item: 'planks', count: 8 }, state: 'todo' },
            { command: '!craftSupplies("stick", 16)', check: { item: 'stick', count: 16 }, state: 'todo' },
            { command: '!craftSupplies("torch", 16)', check: { item: 'torch', count: 16 }, state: 'todo' },
        ];
        assert.equal(T.statusText(j), 'Job: the mining, 6 of 16 iron, step 2 of 4.');
    });

    test('without steps and without a job', () => {
        assert.equal(T.statusText(mining()), 'Job: the mining, 6 of 16 iron.');
        assert.equal(T.statusText(null), '');
    });
});
