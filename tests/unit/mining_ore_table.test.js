// Spec v0.1.4.7 M1: src/agent/packs/mining/ore_table.js -- the ores, their levels and pickaxes.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const T = await loadSrc('src/agent/packs/mining/ore_table.js');

describe('the table of M1', () => {
    test('seven ores in the order of the spec with blocks, item, level and pickaxe', () => {
        assert.deepEqual(T.ORE_NAMES, ['coal', 'copper', 'iron', 'lapis', 'gold', 'redstone', 'diamond']);
        const row = name => T.ORES.find(r => r.ore === name);
        assert.deepEqual({ ...row('coal'), blocks: [...row('coal').blocks] },
            { ore: 'coal', blocks: ['coal_ore', 'deepslate_coal_ore'], item: 'coal', level: 96, pickaxe: 'wooden', min: 0, max: 192 });
        assert.deepEqual([row('copper').item, row('copper').level, row('copper').pickaxe], ['raw_copper', 48, 'stone']);
        assert.deepEqual([row('iron').item, row('iron').level, row('iron').pickaxe], ['raw_iron', 16, 'stone']);
        assert.deepEqual([row('lapis').item, row('lapis').level, row('lapis').pickaxe], ['lapis_lazuli', 0, 'stone']);
        assert.deepEqual([row('gold').item, row('gold').level, row('gold').pickaxe], ['raw_gold', -16, 'iron']);
        assert.deepEqual([row('redstone').item, row('redstone').level, row('redstone').pickaxe], ['redstone', -59, 'iron']);
        assert.deepEqual([row('diamond').item, row('diamond').level, row('diamond').pickaxe], ['diamond', -59, 'iron']);
        for (const r of T.ORES) {
            assert.deepEqual([...r.blocks], [`${r.ore}_ore`, `deepslate_${r.ore}_ore`]);
        }
        assert.ok(Object.isFrozen(T.ORES) && Object.isFrozen(T.ORES[0]));
    });
});

describe('oreOf', () => {
    test('the ore, a block, the item and the extra names lead to the row', () => {
        for (const name of ['iron', 'iron_ore', 'deepslate_iron_ore', 'raw_iron', 'iron_ingot', 'IRON', ' minecraft:iron_ore ', 'iron ore']) {
            assert.equal(T.oreOf(name)?.ore, 'iron', name);
        }
        assert.equal(T.oreOf('lapis_lazuli').ore, 'lapis');
        assert.equal(T.oreOf('lapis').ore, 'lapis');
        assert.equal(T.oreOf('diamonds').ore, 'diamond');
        assert.equal(T.oreOf('redstone').ore, 'redstone');
        assert.equal(T.oreOf('gold_ingot').ore, 'gold');
        assert.equal(T.oreOf('copper_ingot').ore, 'copper');
        assert.equal(T.oreOf('coal').ore, 'coal');
        assert.equal(T.oreOf('iron_ores').ore, 'iron');
        const row = T.oreOf('gold');
        assert.equal(T.oreOf(row), row, 'a row is taken as it is');
    });

    test('null for anything else', () => {
        for (const name of ['mithril', 'emerald_ore', 'stone', '', '   ', null, undefined, 42, {}, 'nether_gold_ore']) {
            assert.equal(T.oreOf(name), null, String(name));
        }
    });
});

describe('isOreBlock', () => {
    test('true for every block of the table, false for items and other blocks', () => {
        for (const r of T.ORES) {
            for (const b of r.blocks) {
                assert.equal(T.isOreBlock(b), true, b);
            }
        }
        for (const name of ['raw_iron', 'iron', 'stone', 'emerald_ore', null, 7]) {
            assert.equal(T.isOreBlock(name), false, String(name));
        }
        assert.equal(T.isOreBlock('minecraft:coal_ore'), true);
    });
});

describe('targetLevel', () => {
    test('the best level when the surface is high enough', () => {
        assert.equal(T.targetLevel('iron', 64), 16);
        assert.equal(T.targetLevel('lapis', 64), 0);
        assert.equal(T.targetLevel('gold', 70), -16);
    });

    test('at least 8 below the surface', () => {
        assert.equal(T.targetLevel('coal', 64), 56);
        assert.equal(T.targetLevel('coal', 61), 53);
        assert.equal(T.targetLevel('copper', 50), 42);
        assert.equal(T.targetLevel('iron', 20.7), 12, 'the surface is floored');
    });

    test('at least 5 above minY, which wins over the surface', () => {
        assert.equal(T.targetLevel('diamond', 64), -59);
        assert.equal(T.targetLevel('redstone', 64, -64), -59);
        assert.equal(T.targetLevel('diamond', 64, -50), -45);
        assert.equal(T.targetLevel('diamond', -55, -64), -59, 'a surface too low: the floor wins');
        assert.equal(T.targetLevel('iron', 64, 'x'), 16, 'a bad minY is -64');
    });

    test('null for an unknown ore or a bad surface', () => {
        assert.equal(T.targetLevel('mithril', 64), null);
        assert.equal(T.targetLevel('iron', null), null);
        assert.equal(T.targetLevel('iron', NaN), null);
    });
});

describe('pickaxes', () => {
    test('pickaxeFor is the weakest material of the table', () => {
        assert.equal(T.pickaxeFor('coal'), 'wooden');
        assert.equal(T.pickaxeFor('raw_iron'), 'stone');
        assert.equal(T.pickaxeFor('diamond_ore'), 'iron');
        assert.equal(T.pickaxeFor('mithril'), null);
    });

    test('tripPickaxe is at least stone', () => {
        assert.equal(T.tripPickaxe('coal'), 'stone');
        assert.equal(T.tripPickaxe('lapis'), 'stone');
        assert.equal(T.tripPickaxe('gold'), 'iron');
        assert.equal(T.tripPickaxe('x'), null);
    });

    test('pickaxeMaterial and pickaxeIsEnough', () => {
        assert.equal(T.pickaxeMaterial('iron_pickaxe'), 'iron');
        assert.equal(T.pickaxeMaterial('minecraft:netherite_pickaxe'), 'netherite');
        assert.equal(T.pickaxeMaterial('iron_axe'), null);
        assert.equal(T.pickaxeMaterial('copper_pickaxe'), null);
        assert.equal(T.pickaxeMaterial(null), null);
        assert.equal(T.pickaxeIsEnough('diamond', 'iron'), true);
        assert.equal(T.pickaxeIsEnough('iron', 'iron'), true);
        assert.equal(T.pickaxeIsEnough('stone', 'iron'), false);
        assert.equal(T.pickaxeIsEnough('golden', 'wooden'), true);
        assert.equal(T.pickaxeIsEnough('golden', 'stone'), false);
        assert.equal(T.pickaxeIsEnough('mithril', 'stone'), false);
        assert.equal(T.PICKAXE_USES.stone, 131);
        assert.equal(T.cleanOreName('  '), null);
    });
});
