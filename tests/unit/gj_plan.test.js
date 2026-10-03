// Tester T1 of v0.1.4.10 "Goals", from the spec: the plan against a blocker (I2 plan_logic.js, section 5). The
// plan may use only the commands of the wood, storage and crafting kind; parsePlan refuses any other command and
// more than 6 steps; a step's check is the item and count its command names.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const P = await loadSrc('src/agent/job/plan_logic.js');
const J = await loadSrc('src/agent/job/job_logic.js');

const ALLOWED = ['!chopTrees', '!craftSupplies', '!craftRecipe', '!getTool', '!fetchItem', '!collectBlocks', '!smeltItem', '!mineOre']; // v0.1.4.12 (E): !mineOre is a step of a plan

describe('section 5: the commands of a plan', () => {
    test('exactly the eight commands of the wood, storage, crafting and mining kind', () => {
        assert.deepEqual([...P.PLAN_COMMAND_NAMES].sort(), [...ALLOWED].sort());
    });
});

describe('I2: parsePlan', () => {
    test('a plan of four steps with their checks', () => {
        const steps = P.parsePlan('!chopTrees(2)\n!craftSupplies("planks", 8)\n!craftSupplies("stick", 16)\n!craftSupplies("torch", 16)');
        assert.ok(Array.isArray(steps));
        assert.equal(steps.length, 4);
        assert.deepEqual(steps.map((s) => s.command), ['!chopTrees(2)', '!craftSupplies("planks", 8)', '!craftSupplies("stick", 16)', '!craftSupplies("torch", 16)']);
        assert.deepEqual(steps[3].check, { item: 'torch', count: 16 }, 'craftSupplies torch 16');
        assert.deepEqual(steps[2].check, { item: 'stick', count: 16 });
        assert.equal(steps[0].check.count, 2);
    });

    test('every command of the list is accepted', () => {
        const answer = ['!chopTrees(4)', '!craftSupplies("torch", 8)', '!craftRecipe("stone_pickaxe", 1)', '!getTool("pickaxe", "stone")',
            '!fetchItem("coal", 4)', '!collectBlocks("cobblestone", 3)'].join('\n');
        const steps = P.parsePlan(answer);
        assert.ok(steps, 'six steps');
        assert.equal(steps.length, 6);
        assert.ok(P.parsePlan('!smeltItem("raw_iron", 3)'), 'smeltItem');
    });

    test('a command outside the list: no plan', () => {
        for (const other of ['!goToPlayer("player", 3)', '!newAction("make torches")', '!farmCycle("farm")', '!followPlayer("player", 3)']) {
            assert.equal(P.parsePlan(`!chopTrees(2)\n${other}\n!craftSupplies("torch", 16)`), null, other);
        }
    });

    test('more than 6 steps: no plan; 6 steps: a plan', () => {
        const six = Array.from({ length: 6 }, () => '!craftSupplies("stick", 4)').join('\n');
        assert.equal(P.parsePlan(six)?.length, 6);
        assert.equal(P.parsePlan(`${six}\n!craftSupplies("torch", 4)`), null);
    });

    test('no command, NONE, nothing: no plan', () => {
        assert.equal(P.parsePlan('NONE'), null);
        assert.equal(P.parsePlan(''), null);
        assert.equal(P.parsePlan(null), null);
        assert.equal(P.parsePlan('I would chop some trees.'), null);
    });

    test('a list of commands narrows what the plan may use', () => {
        assert.equal(P.parsePlan('!chopTrees(2)', ['!craftSupplies']), null);
        assert.ok(P.parsePlan('!craftSupplies("torch", 4)', ['!craftSupplies']));
    });
});

describe('I2: stepDone', () => {
    test('a step with a count: the inventory holds that many', () => {
        const step = { command: '!craftSupplies("torch", 16)', check: { item: 'torch', count: 16 }, state: 'todo' };
        assert.equal(P.stepDone(step, { torch: 15 }), false);
        assert.equal(P.stepDone(step, { torch: 16 }), true);
        assert.equal(P.stepDone(step, [{ name: 'torch', count: 20 }]), true);
    });

    test('a step without a count is done when its command returns ok', () => {
        const step = { command: '!getTool("pickaxe", "stone")', check: { item: 'stone_pickaxe', count: null }, state: 'todo' };
        assert.equal(P.stepDone(step, {}), false);
        assert.equal(P.stepDone(step, {}, true), true);
    });
});

describe('I2: planPrompt', () => {
    test('the job, the blocker, the inventory, only the commands of the list, and the format', () => {
        const job = J.jobOf('mineOre', ['iron', 16], { text: '!mineOre("iron", 16)' });
        const text = P.planPrompt(job, { kind: 'no_torches', item: 'torch' }, { coal: 3, oak_log: 2 }, P.PLAN_COMMANDS);
        assert.equal(typeof text, 'string');
        assert.ok(text.includes('!mineOre("iron", 16)'), 'the job');
        assert.ok(text.includes('no_torches') || text.includes('torch'), 'the blocker');
        assert.ok(text.includes('coal') && text.includes('oak_log'), 'the inventory');
        for (const name of ALLOWED) assert.ok(text.includes(name), name);
        for (const other of ['!goToPlayer', '!newAction', '!followPlayer', '!farmCycle']) assert.ok(!text.includes(other), other);
    });
});
