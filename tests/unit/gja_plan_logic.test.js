// Spec v0.1.4.10 part J (engineer E1): the steps against a blocker, src/agent/job/plan_logic.js (I2).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const P = await loadSrc('src/agent/job/plan_logic.js');
const L = await loadSrc('src/agent/job/job_logic.js');

const ANSWER = '!chopTrees(4)\n!craftSupplies("planks", 8)\n!craftSupplies("stick", 16)\n!craftSupplies("torch", 16)';

describe('planPrompt', () => {
    test('the job, the blocker, what the bot carries, the commands and the format', () => {
        const job = { ...L.jobOf('!mineOre', ['iron', 16]), got: 6 };
        const text = P.planPrompt(job, { kind: 'no_torches', item: 'torch', text: 'I have no torches.' }, { stone_pickaxe: 1, coal: 5 }, P.PLAN_COMMANDS);
        assert.match(text, /The job: !mineOre\("iron", 16\), 6 of 16 done\./);
        assert.match(text, /no_torches \(torch\)/);
        assert.match(text, /I have no torches\./);
        assert.match(text, /What the bot carries: 5 coal, 1 stone_pickaxe\./);
        for (const name of P.PLAN_COMMAND_NAMES) {
            assert.ok(text.includes(name), name);
        }
        assert.match(text, /at most 6 lines/);
        assert.match(text, /NONE/);
        assert.ok(!text.includes('!mineOre('.concat('"iron", 10')), 'no resume command in the list');
    });

    test('the commands of the wood, storage and crafting kind only', () => {
        assert.deepEqual([...P.PLAN_COMMAND_NAMES], ['!chopTrees', '!craftSupplies', '!craftRecipe', '!getTool', '!fetchItem', '!collectBlocks', '!smeltItem']);
    });

    test('an empty inventory and a list of names', () => {
        const text = P.planPrompt(L.jobOf('!farmCycle', ['']), { kind: 'no_tool', item: 'hoe' }, [], ['!getTool']);
        assert.match(text, /What the bot carries: nothing\./);
        assert.match(text, /!getTool\(kind, material\)/);
        assert.ok(!text.includes('!chopTrees'));
    });
});

describe('parsePlan', () => {
    test('the steps with a check from each command', () => {
        assert.deepEqual(P.parsePlan(ANSWER, P.PLAN_COMMAND_NAMES), [
            { command: '!chopTrees(4)', check: { item: 'log', count: 4 }, state: 'todo' },
            { command: '!craftSupplies("planks", 8)', check: { item: 'planks', count: 8 }, state: 'todo' },
            { command: '!craftSupplies("stick", 16)', check: { item: 'stick', count: 16 }, state: 'todo' },
            { command: '!craftSupplies("torch", 16)', check: { item: 'torch', count: 16 }, state: 'todo' },
        ]);
    });

    test('numbered lines, single quotes and a kind of wood', () => {
        const steps = P.parsePlan("1. !chopTrees('oak', 3)\n2. !getTool(\"pickaxe\", \"stone\")\n3. !fetchItem(\"coal\", 4)", P.PLAN_COMMAND_NAMES);
        assert.deepEqual(steps.map(s => s.command), ['!chopTrees(3, "oak")', '!getTool("pickaxe", "stone")', '!fetchItem("coal", 4)']);
        assert.deepEqual(steps.map(s => s.check), [{ item: 'oak_log', count: 3 }, { item: 'stone_pickaxe', count: null }, { item: 'coal', count: 4 }]);
    });

    test('the checks of the other commands', () => {
        const steps = P.parsePlan('!craftRecipe("furnace")\n!collectBlocks("stone", 8)\n!smeltItem("raw_iron", 3)\n!getTool("axe")', P.PLAN_COMMAND_NAMES);
        assert.deepEqual(steps.map(s => s.check), [
            { item: 'furnace', count: null }, { item: 'cobblestone', count: 8 }, { item: 'raw_iron', count: null }, { item: 'axe', count: null },
        ]);
    });

    test('a command outside the list refuses the plan', () => {
        assert.equal(P.parsePlan('!chopTrees(4)\n!mineOre("iron", 8)', P.PLAN_COMMAND_NAMES), null);
        assert.equal(P.parsePlan('!craftSupplies("torch", 16)\n!goToPlayer("Steve")', P.PLAN_COMMAND_NAMES), null);
        assert.equal(P.parsePlan('!chopTrees(4)', ['!craftSupplies']), null);
    });

    test('more than 6 steps refuse the plan; 6 are fine', () => {
        const six = Array.from({ length: 6 }, () => '!chopTrees(1)').join('\n');
        assert.equal(P.parsePlan(six, P.PLAN_COMMAND_NAMES).length, 6);
        assert.equal(P.parsePlan(`${six}\n!chopTrees(1)`, P.PLAN_COMMAND_NAMES), null);
    });

    test('no plan: NONE, no command, args that do not fit, no text', () => {
        assert.equal(P.parsePlan('NONE', P.PLAN_COMMAND_NAMES), null);
        assert.equal(P.parsePlan('I would chop some trees first.', P.PLAN_COMMAND_NAMES), null);
        assert.equal(P.parsePlan('!smeltItem("raw_iron")', P.PLAN_COMMAND_NAMES), null, 'smeltItem needs its count');
        assert.equal(P.parsePlan('!craftSupplies("torch", -2)', P.PLAN_COMMAND_NAMES), null);
        assert.equal(P.parsePlan('!craftSupplies(torch, 2)', P.PLAN_COMMAND_NAMES), null);
        assert.equal(P.parsePlan('!craftSupplies("torch", 2, 3)', P.PLAN_COMMAND_NAMES), null);
        assert.equal(P.parsePlan(null, P.PLAN_COMMAND_NAMES), null);
    });

    test('the default list without commands', () => {
        assert.equal(P.parsePlan(ANSWER).length, 4);
    });
});

describe('stepDone', () => {
    const steps = P.parsePlan(`${ANSWER}\n!getTool("pickaxe", "stone")`);

    test('a step with a count: the inventory holds that many', () => {
        assert.equal(P.stepDone(steps[0], { oak_log: 2, birch_log: 2 }), true);
        assert.equal(P.stepDone(steps[0], { oak_log: 3 }), false);
        assert.equal(P.stepDone(steps[1], [{ name: 'spruce_planks', count: 8 }]), true);
        assert.equal(P.stepDone(steps[2], { stick: 15 }), false);
        assert.equal(P.stepDone(steps[3], { torch: 16 }, false), true, 'the inventory decides');
    });

    test('a step without a count: done when its command returned ok', () => {
        assert.equal(P.stepDone(steps[4], {}, true), true);
        assert.equal(P.stepDone(steps[4], { stone_pickaxe: 1 }), false);
        assert.equal(P.stepDone({ ...steps[4], state: 'done' }, {}), true);
        assert.equal(P.stepDone(null, {}), false);
    });
});
