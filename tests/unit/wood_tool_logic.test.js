// Spec v0.1.4.7 T3: src/agent/packs/wood/tool_logic.js (pure) and the texts of the wood pack.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const L = await loadSrc('src/agent/packs/wood/tool_logic.js');
const X = await loadSrc('src/agent/packs/wood/texts.js');

const inv = (...pairs) => {
    const out = [];
    for (let i = 0; i < pairs.length; i += 2) out.push({ name: pairs[i], count: pairs[i + 1], slot: 9 + i / 2 });
    return out;
};
const crafts = (plan) => plan.steps.filter(s => s.action === 'craft').map(s => [s.item, s.times]);
const gets = (plan) => plan.steps.filter(s => s.action === 'get').map(s => [s.item, s.count]);

describe('tables', () => {
    test('MATERIALS weakest first, each with the item to craft from; golden is known but not in the list', () => {
        assert.deepEqual(L.MATERIALS.map(m => [m.name, m.item]), [
            ['wooden', 'planks'], ['stone', 'cobblestone'], ['iron', 'iron_ingot'], ['diamond', 'diamond'], ['netherite', 'netherite_ingot'],
        ]);
        assert.equal(L.MATERIALS.find(m => m.name === 'netherite').craftable, false);
        assert.ok(L.MATERIALS.filter(m => m.name !== 'netherite').every(m => m.craftable));
        assert.equal(L.GOLDEN.name, 'golden');
        assert.equal(L.GOLDEN.craftable, false);
        assert.ok(Object.isFrozen(L.MATERIALS));
    });

    test('TOOL_USES and RECIPES', () => {
        assert.deepEqual({ ...L.TOOL_USES }, { wooden: 59, stone: 131, iron: 250, golden: 32, diamond: 1561, netherite: 2031 });
        assert.deepEqual(JSON.parse(JSON.stringify(L.RECIPES)), {
            pickaxe: { material: 3, sticks: 2 }, axe: { material: 3, sticks: 2 }, shovel: { material: 1, sticks: 2 },
            hoe: { material: 2, sticks: 2 }, sword: { material: 2, sticks: 1 },
        });
        assert.deepEqual(L.TOOL_KINDS, ['pickaxe', 'axe', 'shovel', 'hoe', 'sword']);
    });
});

describe('parseTool, usesLeft, bestTool', () => {
    test('parseTool', () => {
        assert.deepEqual(L.parseTool('stone_pickaxe'), { kind: 'pickaxe', material: 'stone' });
        assert.deepEqual(L.parseTool('minecraft:golden_axe'), { kind: 'axe', material: 'golden' });
        assert.deepEqual(L.parseTool('netherite_sword'), { kind: 'sword', material: 'netherite' });
        assert.deepEqual(L.parseTool('wooden_hoe'), { kind: 'hoe', material: 'wooden' });
        for (const n of ['pickaxe', 'stone', 'oak_log', 'wooden_bow', 'mithril_pickaxe', 'stone_pickaxe_x', '', null, 3]) {
            assert.equal(L.parseTool(n), null, String(n));
        }
        assert.equal(L.toolName('pickaxe', 'iron'), 'iron_pickaxe');
    });

    test('usesLeft: from uses_left, a tool without it is new, anything else null', () => {
        assert.equal(L.usesLeft({ name: 'stone_pickaxe', uses_left: 40 }), 40);
        assert.equal(L.usesLeft({ name: 'stone_pickaxe', uses_left: -3 }), 0);
        assert.equal(L.usesLeft({ name: 'iron_axe' }), 250);
        assert.equal(L.usesLeft({ name: 'bread', uses_left: null }), null);
        assert.equal(L.usesLeft(null), null);
    });

    test('bestTool: best material first, then more uses; at least the material; broken tools do not count', () => {
        const items = [
            { name: 'wooden_pickaxe', count: 1, uses_left: 59 },
            { name: 'stone_pickaxe', count: 1, uses_left: 3 },
            { name: 'stone_pickaxe', count: 1, uses_left: 100 },
            { name: 'golden_pickaxe', count: 1, uses_left: 30 },
            { name: 'iron_axe', count: 1, uses_left: 0 },
            { name: 'stone_axe', count: 1 },
        ];
        assert.deepEqual(L.bestTool(items, 'pickaxe'), items[2]);
        assert.deepEqual(L.bestTool(items, 'pickaxe', 'stone'), items[2]);
        assert.equal(L.bestTool(items, 'pickaxe', 'iron'), null);
        assert.deepEqual(L.bestTool(items, 'axe', 'wooden'), items[5], 'the broken iron axe does not count');
        assert.equal(L.bestTool(items, 'shovel'), null);
        assert.deepEqual(L.bestTool([items[0], items[3]], 'pickaxe', ''), items[3], 'golden ranks above wooden');
        assert.deepEqual(L.bestTool([items[3]], 'pickaxe', 'golden'), items[3]);
        assert.equal(L.bestTool([items[3]], 'pickaxe', 'stone'), null, 'golden mines like wood');
        assert.equal(L.bestTool(items, 'pickaxe', 'mithril'), null);
        assert.equal(L.bestTool(null, 'pickaxe'), null);
        assert.deepEqual(L.toolsOf(items, 'pickaxe', 'stone').map(i => i.uses_left), [100, 3]);
    });

    test('materialLevel', () => {
        assert.equal(L.materialLevel('wooden'), 0);
        assert.equal(L.materialLevel('golden'), 0);
        assert.equal(L.materialLevel('stone'), 1);
        assert.equal(L.materialLevel('netherite'), 4);
        assert.equal(L.materialLevel(''), 0);
        assert.equal(L.materialLevel('mithril'), null);
    });
});

describe('craftSteps', () => {
    test('from nothing: a wooden pickaxe needs 3 logs; the order is planks, sticks, table, tool', () => {
        const plan = L.craftSteps('pickaxe', 'wooden', []);
        assert.deepEqual(plan.missing, [{ name: 'oak_log', count: 3 }]);
        assert.deepEqual(gets(plan), [['oak_log', 3]]);
        assert.deepEqual(crafts(plan), [['oak_planks', 3], ['stick', 1], ['crafting_table', 1], ['wooden_pickaxe', 1]]);
        assert.equal(plan.steps.find(s => s.item === 'oak_planks').makes, 12);
        assert.equal(plan.steps.find(s => s.item === 'stick').makes, 4);
        assert.equal(plan.steps[0].action, 'get', 'things to get come first');
    });

    test('with logs: nothing missing, the planks follow the logs the bot has', () => {
        const plan = L.craftSteps('pickaxe', 'wooden', inv('birch_log', 5));
        assert.deepEqual(plan.missing, []);
        assert.deepEqual(crafts(plan), [['birch_planks', 3], ['stick', 1], ['crafting_table', 1], ['wooden_pickaxe', 1]]);
    });

    test('a table in the inventory or nearby, sticks and planks in the inventory are used', () => {
        assert.deepEqual(crafts(L.craftSteps('pickaxe', 'wooden', inv('oak_log', 1, 'crafting_table', 1))), [['oak_planks', 2], ['stick', 1], ['wooden_pickaxe', 1]]);
        assert.deepEqual(crafts(L.craftSteps('pickaxe', 'wooden', inv('oak_planks', 3, 'stick', 2), { table: true })), [['wooden_pickaxe', 1]]);
        assert.deepEqual(L.craftSteps('sword', 'wooden', inv('spruce_planks', 1, 'stick', 1), { table: true }).missing, [{ name: 'spruce_log', count: 1 }]);
    });

    test('planks of one kind only: the kind with most wood is used, other kinds do not add up', () => {
        const plan = L.craftSteps('pickaxe', 'wooden', inv('oak_planks', 2, 'birch_log', 3, 'crimson_stem', 1));
        assert.deepEqual(crafts(plan)[0], ['birch_planks', 3]);
        assert.deepEqual(plan.missing, []);
        const short = L.craftSteps('pickaxe', 'wooden', inv('oak_planks', 2, 'birch_planks', 2));
        assert.deepEqual(short.missing, [{ name: 'oak_log', count: 2 }], 'a tie goes to the first kind in the list; 2 + 2 planks of two kinds are no 4');
    });

    test('stone: cobblestone is missing and wood too', () => {
        const plan = L.craftSteps('pickaxe', 'stone', []);
        assert.deepEqual(plan.missing, [{ name: 'cobblestone', count: 3 }, { name: 'oak_log', count: 2 }]);
        assert.deepEqual(crafts(plan), [['oak_planks', 2], ['stick', 1], ['crafting_table', 1], ['stone_pickaxe', 1]]);
    });

    test('stone: cobbled_deepslate or blackstone do, but only three of one kind', () => {
        assert.deepEqual(L.craftSteps('pickaxe', 'stone', inv('cobbled_deepslate', 3, 'stick', 2, 'crafting_table', 1)).missing, []);
        assert.deepEqual(L.craftSteps('pickaxe', 'stone', inv('cobblestone', 1, 'blackstone', 2, 'stick', 2, 'crafting_table', 1)).missing,
            [{ name: 'cobblestone', count: 2 }]);
    });

    test('iron, diamond: the text numbers come from missing', () => {
        const iron = L.craftSteps('pickaxe', 'iron', inv('iron_ingot', 1, 'stick', 2), { table: true });
        assert.deepEqual(iron.missing, [{ name: 'iron_ingot', count: 2 }]);
        assert.deepEqual(L.craftSteps('shovel', 'diamond', inv('diamond', 1, 'stick', 2), { table: true }).missing, []);
        assert.deepEqual(crafts(L.craftSteps('hoe', 'iron', inv('iron_ingot', 2, 'oak_log', 1), { table: true })), [['oak_planks', 1], ['stick', 1], ['iron_hoe', 1]]);
    });

    test('golden and netherite are never crafted; unknown kinds', () => {
        assert.deepEqual(L.craftSteps('pickaxe', 'golden', inv('gold_ingot', 9)), { steps: [], missing: [{ name: 'golden_pickaxe', count: 1 }] });
        assert.deepEqual(L.craftSteps('pickaxe', 'netherite', []), { steps: [], missing: [{ name: 'netherite_pickaxe', count: 1 }] });
        assert.deepEqual(L.craftSteps('spoon', 'stone', []).steps, []);
        assert.equal(L.craftSteps('spoon', 'stone', []).missing.length, 1);
    });

    test('bad inventories are empty inventories', () => {
        assert.deepEqual(L.craftSteps('axe', 'wooden', null).missing, [{ name: 'oak_log', count: 3 }]);
        assert.deepEqual(L.craftSteps('axe', 'wooden', [null, { name: 5 }, { name: 'oak_log', count: 'x' }]).missing, [{ name: 'oak_log', count: 3 }]);
    });
});

describe('chooseMaterial and the request', () => {
    test('the best material the inventory allows, wood may be collected; at least the minimum', () => {
        assert.equal(L.chooseMaterial('pickaxe', '', []), 'wooden');
        assert.equal(L.chooseMaterial('pickaxe', 'wooden', inv('cobblestone', 3)), 'stone');
        // v0.1.4.8, E3: an empty material chooses the best up to stone; iron only when it is named
        assert.equal(L.chooseMaterial('pickaxe', '', inv('iron_ingot', 3, 'cobblestone', 3)), 'stone');
        assert.equal(L.chooseMaterial('pickaxe', 'stone', inv('iron_ingot', 3, 'cobblestone', 3)), 'iron');
        assert.equal(L.chooseMaterial('pickaxe', 'stone', []), 'stone');
        assert.equal(L.chooseMaterial('pickaxe', 'iron', inv('cobblestone', 64)), 'iron');
        assert.equal(L.chooseMaterial('pickaxe', 'golden', []), 'wooden');
        assert.equal(L.chooseMaterial('pickaxe', 'netherite', []), 'netherite');
    });

    test('normaliseToolRequest: kinds, full tool names, materials', () => {
        assert.deepEqual(L.normaliseToolRequest('pickaxe', ''), { kind: 'pickaxe', material: 'wooden' });
        assert.deepEqual(L.normaliseToolRequest(' Pickaxe ', 'Stone'), { kind: 'pickaxe', material: 'stone' });
        assert.deepEqual(L.normaliseToolRequest('iron_pickaxe'), { kind: 'pickaxe', material: 'iron' });
        assert.deepEqual(L.normaliseToolRequest('pickaxes', 'wood'), { kind: 'pickaxe', material: 'wooden' });
        assert.deepEqual(L.normaliseToolRequest('axe', 'gold'), { kind: 'axe', material: 'golden' });
        assert.deepEqual(L.normaliseToolRequest('spoon', ''), { error: 'kind' });
        assert.deepEqual(L.normaliseToolRequest('axe', 'mithril'), { error: 'material' });
        assert.deepEqual(L.normaliseToolRequest(undefined), { error: 'kind' });
    });
});

describe('supplySteps', () => {
    test('ladders: rounded up to what the recipe gives, 7 sticks each craft, a table', () => {
        const plan = L.supplySteps('ladder', 8, inv('oak_log', 10));
        assert.equal(plan.item, 'ladder');
        assert.equal(plan.makes, 9);
        assert.deepEqual(plan.missing, []);
        assert.deepEqual(crafts(plan), [['oak_planks', 4], ['stick', 6], ['crafting_table', 1], ['ladder', 3]]);
    });

    test('torches need coal or charcoal', () => {
        const none = L.supplySteps('torch', 8, inv('stick', 10));
        assert.equal(none.makes, 8);
        assert.deepEqual(none.missing, [{ name: 'coal', count: 2 }]);
        assert.deepEqual(L.supplySteps('torches', 8, inv('coal', 1, 'charcoal', 1, 'stick', 2)).missing, []);
        assert.deepEqual(crafts(L.supplySteps('torch', 1, inv('coal', 1, 'oak_planks', 2))), [['stick', 1], ['torch', 1]]);
    });

    test('chest, crafting_table, stick and planks', () => {
        assert.deepEqual(crafts(L.supplySteps('chest', 1, inv('oak_log', 3))), [['oak_planks', 3], ['crafting_table', 1], ['chest', 1]]);
        assert.deepEqual(crafts(L.supplySteps('chest', 2, inv('oak_planks', 16), { table: true })), [['chest', 2]]);
        assert.deepEqual(crafts(L.supplySteps('crafting_table', 1, inv('oak_log', 1))), [['oak_planks', 1], ['crafting_table', 1]]);
        const sticks = L.supplySteps('stick', 5, inv('stick', 64, 'oak_planks', 4));
        assert.equal(sticks.makes, 8);
        assert.deepEqual(crafts(sticks), [['stick', 2]], 'sticks are crafted even when the bot carries some');
        const planks = L.supplySteps('planks', 6, inv('jungle_log', 1));
        assert.deepEqual([planks.item, planks.makes, planks.missing], ['jungle_planks', 8, [{ name: 'jungle_log', count: 1 }]]);
        assert.deepEqual(crafts(planks), [['jungle_planks', 2]]);
        assert.equal(L.supplySteps('spruce planks', 4, []).item, 'spruce_planks');
        assert.equal(L.supplySteps('oak_planks', 4, inv('birch_log', 5)).missing[0].name, 'oak_log', 'oak planks need oak logs');
    });

    test('unknown supplies and counts', () => {
        assert.equal(L.supplySteps('diamond_block', 1, []), null);
        assert.equal(L.supplySteps(null, 1, []), null);
        assert.equal(L.supplySteps('ladder', 0, inv('stick', 7), { table: true }).makes, 3, 'a bad count is 1');
        assert.equal(L.supplySteps('ladder', 'x', inv('stick', 7), { table: true }).makes, 3);
        assert.equal(L.normaliseSupply('Crafting Table'), 'crafting_table');
        assert.equal(L.normaliseSupply('ladders'), 'ladder');
        assert.equal(L.normaliseSupply('planks'), 'planks');
        assert.equal(L.normaliseSupply('birch_planks'), 'birch_planks');
        assert.equal(L.normaliseSupply('lava'), null);
        assert.deepEqual(L.SUPPLY_NAMES, ['torch', 'ladder', 'chest', 'crafting_table', 'stick', 'planks']);
    });

    test('woodOfInventory', () => {
        assert.deepEqual(L.woodOfInventory(inv('oak_planks', 2, 'birch_log', 1, 'stripped_birch_log', 9)), { kind: 'birch', planks: 0, logs: 1 });
        assert.deepEqual(L.woodOfInventory([]), { kind: 'oak', planks: 0, logs: 0 });
        assert.deepEqual(L.woodOfInventory([], 'spruce'), { kind: 'spruce', planks: 0, logs: 0 });
        assert.equal(L.isWoodItem('oak_log'), true);
        assert.equal(L.isWoodItem('crimson_stem'), true);
        assert.equal(L.isWoodItem('cobblestone'), false);
    });
});

describe('texts', () => {
    test('countList: by count, then name, at most 6, then "and n more kinds"', () => {
        assert.equal(X.countList({ oak_log: 11 }), '11 oak_log');
        assert.equal(X.countList({ birch_log: 4, oak_log: 11, acacia_log: 4 }), '11 oak_log, 4 acacia_log, 4 birch_log');
        const many = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
        assert.equal(X.countList(many), '8 h, 7 g, 6 f, 5 e, 4 d, 3 c and 2 more kinds');
        assert.equal(X.countList({ a: 0 }), '');
        assert.equal(X.countList(null), '');
    });

    test('texts of chopTrees', () => {
        assert.equal(X.chopText({ trees: ['oak', 'oak'], logs: { oak_log: 11 }, planted: 2 }), 'I cut 2 oak trees and got 11 oak_log. I planted 2 saplings.');
        assert.equal(X.chopText({ trees: ['oak'], logs: { oak_log: 5 }, planted: 1, leftover: 3 }),
            'I cut 1 oak tree and got 5 oak_log. I planted 1 sapling. 3 logs were too high for me.');
        assert.equal(X.chopText({ trees: ['oak'], logs: { oak_log: 5 }, planted: 0, leftover: 1 }),
            'I cut 1 oak tree and got 5 oak_log. I had no sapling to plant. 1 log was too high for me.');
        assert.equal(X.chopText({ trees: ['oak', 'birch'], logs: { oak_log: 5, birch_log: 6 }, planted: 2, noMore: true }),
            'I cut 2 trees and got 6 birch_log, 5 oak_log. I planted 2 saplings. I found no more trees within 48 blocks.');
        assert.equal(X.chopText({ trees: ['oak'], logs: {}, planted: 0, stopped: 'interrupted' }),
            'I cut 1 oak tree and got no logs. I had no sapling to plant. I was interrupted.');
        assert.equal(X.chopText({ trees: ['oak'], logs: { oak_log: 4 }, planted: 1, stopped: 'time' }),
            'I cut 1 oak tree and got 4 oak_log. I planted 1 sapling. The time for cutting trees was over.');
        assert.equal(X.chopText({ trees: [], found: 0 }), 'I found no tree within 48 blocks. Logs of buildings are not mine to take.');
        assert.equal(X.chopText({ trees: [], found: 0, kind: 'birch' }), 'I found no birch tree within 48 blocks. Logs of buildings are not mine to take.');
        assert.equal(X.chopText({ trees: [], found: 2 }), 'I could not reach the trees I found.');
        assert.equal(X.chopText({ trees: [], found: 2, stopped: 'interrupted' }), 'I stopped before I cut a tree.');
        assert.equal(X.noTreeText(), 'I found no tree within 48 blocks. Logs of buildings are not mine to take.');
        assert.equal(X.unknownWoodText('mithril'), 'I do not know the wood "mithril". I know oak, spruce, birch, jungle, acacia, dark_oak, mangrove, cherry, pale_oak, crimson and warped.');
    });

    test('texts of the tools', () => {
        assert.equal(X.haveToolText('stone_pickaxe'), 'I have a stone_pickaxe.');
        assert.equal(X.haveToolText('iron_axe'), 'I have an iron_axe.');
        assert.equal(X.craftedToolsText(['stone_pickaxe']), 'I crafted a stone_pickaxe.');
        assert.equal(X.craftedToolsText(['wooden_pickaxe', 'stone_pickaxe']), 'I crafted a wooden_pickaxe and a stone_pickaxe.');
        assert.equal(X.craftedToolsText(['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe']), 'I crafted a wooden_pickaxe, a stone_pickaxe and an iron_pickaxe.');
        assert.equal(X.needText('iron_ingot', 3, 1, 'an iron_pickaxe'), 'I need 3 iron_ingot for an iron_pickaxe and have 1.');
        assert.equal(X.needText('coal', 2, 0, '8 torch'), 'I need 2 coal for 8 torch and have none.');
        assert.equal(X.craftedSupplyText(9, 'ladder'), 'I crafted 9 ladder.');
        assert.equal(X.withArticle('iron_pickaxe'), 'an iron_pickaxe');
        assert.equal(X.unknownToolText('spoon'), 'I do not know the tool "spoon". I know pickaxe, axe, shovel, hoe and sword.');
        assert.equal(X.unknownMaterialText('mithril'), 'I do not know the material "mithril". I know wooden, stone, iron, diamond and netherite.');
        assert.equal(X.unknownSupplyText('lava'), 'I cannot craft "lava" with this command. I craft torch, ladder, chest, crafting_table, stick and planks.');
        assert.equal(X.notCraftableText('netherite_pickaxe'), 'I cannot craft a netherite_pickaxe. It is made at a smithing table, which I do not use.');
    });
});
