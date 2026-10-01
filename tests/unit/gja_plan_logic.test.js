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

describe('T3-1: every missing supply, where the bot is, the chests', () => {
    const job = L.jobOf('!mineOre', ['iron', 4]);

    test('missingSupplies: the blocker first, then for a mining job the pickaxe and the torches the bot lacks', () => {
        assert.deepEqual(P.missingSupplies(job, { kind: 'no_pickaxe', item: 'stone_pickaxe' }, { ladder: 8 }),
            [{ kind: 'no_pickaxe', item: 'stone_pickaxe' }, { kind: 'no_torches', item: 'torch' }]);
        assert.deepEqual(P.missingSupplies(job, { kind: 'no_torches', item: 'torch' }, { stone_pickaxe: 1 }), [{ kind: 'no_torches', item: 'torch' }]);
        assert.deepEqual(P.missingSupplies(job, { kind: 'no_item', item: 'torch' }, { iron_pickaxe: 1 }), [{ kind: 'no_item', item: 'torch' }], 'the same item once');
        assert.deepEqual(P.missingSupplies(L.jobOf('!farmCycle', ['farm']), { kind: 'no_tool', item: 'hoe' }, {}), [{ kind: 'no_tool', item: 'hoe' }], 'other jobs: the blocker');
        assert.deepEqual(P.missingSupplies(null, null, null), [{ kind: 'unknown', item: null }]);
    });

    test('the prompt: the first line stays, the missing line, the where line, the chests nearest first', () => {
        const chests = [
            { x: 100, y: 64, z: 100, items: { cobblestone: 64 } },
            { x: 1803, y: 61, z: 4, items: { oak_log: 20, coal: 9, empty: 0 } },
            { x: 5, y: 5, z: 5, items: {} },
            { y: 1 },
        ];
        const text = P.planPrompt(job, { kind: 'no_pickaxe', item: 'stone_pickaxe', text: 'I need a stone pickaxe.' }, { ladder: 8 }, P.PLAN_COMMANDS,
            { where: { underground: true, mine: { name: 'mine' } }, chests, pos: { x: 1800, y: 25, z: 4 } });
        const lines = text.split('\n');
        assert.equal(lines[0], 'You plan the steps of a Minecraft bot. Its job stopped because something is missing.');
        assert.equal(lines[2], 'What is missing: no_pickaxe (stone_pickaxe), no_torches (torch), the skill said: "I need a stone pickaxe.".');
        assert.match(lines[3], /^Where the bot is: underground in the mine "mine"\./);
        assert.equal(lines[4], 'What the bot carries: 8 ladder.');
        assert.deepEqual(lines.slice(5, 8), ['The chests the bot knows and what they hold:', 'the chest at (1803, 61, 4): 20 oak_log, 9 coal', 'the chest at (100, 64, 100): 64 cobblestone']);
        assert.equal(lines[8], 'The commands you may use:');
    });

    test('on the surface, no chest with items, nothing given', () => {
        const surface = P.planPrompt(job, { kind: 'no_torches', item: 'torch' }, { stone_pickaxe: 1 }, P.PLAN_COMMANDS, { where: { underground: false, area: { name: 'home' } }, chests: [] });
        assert.match(surface, /\nWhere the bot is: on the surface, in "home"\.\n/);
        assert.match(surface, /\nThe chests the bot knows: none with items\.\n/);
        const bare = P.planPrompt(job, { kind: 'no_torches', item: 'torch' }, {}, P.PLAN_COMMANDS);
        assert.ok(!/Where the bot is|chests the bot knows/.test(bare));
    });

    test('at most 8 chests and 12 kinds per chest', () => {
        const items = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`item_${String(i).padStart(2, '0')}`, 20 - i]));
        const chests = Array.from({ length: 12 }, (_, i) => ({ x: i, y: 64, z: 0, items }));
        const lines = P.planPrompt(job, { kind: 'no_torches', item: 'torch' }, {}, P.PLAN_COMMANDS, { chests }).split('\n').filter(l => l.startsWith('the chest at'));
        assert.equal(lines.length, P.PROMPT_CHESTS);
        assert.equal(lines[0].split(': ')[1].split(', ').length, P.PROMPT_CHEST_KINDS);
    });

    test('needsSurface: the wood, chest and crafting commands', () => {
        for (const c of ['!chopTrees(4)', '!fetchItem("oak_log", 8)', '!craftSupplies("torch", 16)', '!craftRecipe("stick", 2)', '!getTool("pickaxe", "stone")', '!collectBlocks("stone", 3)']) {
            assert.equal(P.needsSurface(c), true, c);
        }
        for (const c of ['!smeltItem("raw_iron", 1)', '!mineOre("iron", 4)', '', null]) {
            assert.equal(P.needsSurface(c), false, String(c));
        }
        assert.equal(P.WAY_OUT_COMMAND, '!leaveMine');
    });
});
