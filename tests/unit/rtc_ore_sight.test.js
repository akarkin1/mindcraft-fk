// Spec v0.1.4.9 C1 (part C, engineer E3): the pure module src/agent/library/ore_sight_logic.js.
// oreInSight(getName, pos, range, dug): range 0 needs a face towards an open cell, range 3 an open cell
// within 3 blocks (Chebyshev). Open: air, cave air, water, torches, ladders, and the cells dug in this
// call. A cell that is not loaded is rock. The text when every candidate of collectBlock is out of sight.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { assertCleanImport } from '../helpers/module_rules.js';
import { importsOf } from '../helpers/hygiene.js';
import { createBlockWorld } from '../helpers/block_world.js';

const S = await loadSrc('src/agent/library/ore_sight_logic.js');

// Solid stone everywhere, air where the test says; null outside of the loaded box.
function rock(open = {}, loaded = null) {
    const world = createBlockWorld().flatGround(200, 'stone', 'stone');
    if (loaded) world.setLoaded(loaded);
    for (const [k, name] of Object.entries(open)) {
        const [x, y, z] = k.split(',').map(Number);
        world.set(x, y, z, name);
    }
    return world.getBlockName;
}

const ORE = { x: 10, y: 20, z: 10 };

describe('oreInSight, range 0: a face in the open', () => {
    test('each of the six faces towards air counts', () => {
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
            const getName = rock({ [`${10 + dx},${20 + dy},${10 + dz}`]: 'air' });
            assert.equal(S.oreInSight(getName, ORE, 0), true, `${dx},${dy},${dz}`);
        }
    });

    test('an edge or a corner in the open is not a face: out of sight', () => {
        assert.equal(S.oreInSight(rock({ '11,21,10': 'air' }), ORE, 0), false, 'edge');
        assert.equal(S.oreInSight(rock({ '11,21,11': 'air' }), ORE, 0), false, 'corner');
        assert.equal(S.oreInSight(rock({}), ORE, 0), false, 'all rock');
    });

    test('every open name of the spec, and nothing else', () => {
        for (const name of ['air', 'cave_air', 'void_air', 'water', 'flowing_water', 'torch', 'wall_torch', 'soul_torch', 'soul_wall_torch', 'ladder']) {
            assert.equal(S.oreInSight(rock({ '10,21,10': name }), ORE, 0), true, name);
        }
        assert.deepEqual([...S.OPEN_NAMES].sort(), ['air', 'cave_air', 'flowing_water', 'ladder', 'soul_torch', 'soul_wall_torch', 'torch', 'void_air', 'wall_torch', 'water']);
        for (const name of ['lava', 'dirt', 'iron_ore', 'glass', 'oak_planks', 'gravel']) {
            assert.equal(S.oreInSight(rock({ '10,21,10': name }), ORE, 0), false, name);
        }
    });

    test('a cell dug in this call is open (a Set of "x,y,z", or anything with has())', () => {
        const getName = rock({});
        assert.equal(S.oreInSight(getName, ORE, 0, new Set(['10,19,10'])), true);
        assert.equal(S.oreInSight(getName, ORE, 0, { has: (k) => k === '9,20,10' }), true);
        assert.equal(S.oreInSight(getName, ORE, 0, new Set(['10,18,10'])), false, 'not a face');
        assert.equal(S.oreInSight(getName, ORE, 0, { has() { throw new Error('x'); } }), false, 'a broken set: not dug');
    });

    test('a cell that is not loaded is rock', () => {
        const box = { min: { x: 10, y: 0, z: 0 }, max: { x: 20, y: 40, z: 20 } };
        assert.equal(S.oreInSight(rock({ '11,20,10': 'air' }, box), ORE, 0), true);
        const getName = (x, y, z) => (x === 9 ? null : 'stone');
        assert.equal(S.oreInSight(getName, ORE, 0), false, 'the face at x 9 is not loaded');
        assert.equal(S.oreInSight(() => { throw new Error('no world'); }, ORE, 0), false, 'a reader that throws');
    });

    test('the position is floored', () => {
        assert.equal(S.oreInSight(rock({ '10,21,10': 'air' }), { x: 10.7, y: 20.2, z: 10.9 }, 0), true);
    });
});

describe('oreInSight, range 3: an open cell within 3 blocks (Chebyshev)', () => {
    test('3 blocks away on an axis, on a diagonal and in a corner: in sight; 4 blocks: out of sight', () => {
        assert.equal(S.oreInSight(rock({ '13,20,10': 'air' }), ORE, 3), true, 'axis');
        assert.equal(S.oreInSight(rock({ '13,23,10': 'air' }), ORE, 3), true, 'diagonal');
        assert.equal(S.oreInSight(rock({ '7,17,13': 'air' }), ORE, 3), true, 'corner');
        assert.equal(S.oreInSight(rock({ '14,20,10': 'air' }), ORE, 3), false, '4 on an axis');
        assert.equal(S.oreInSight(rock({ '14,23,13': 'air' }), ORE, 3), false, '4 on one axis, 3 on the others');
        assert.equal(S.oreInSight(rock({ '11,21,11': 'air' }), ORE, 3), true, 'the corner that range 0 does not see');
    });

    test('the ore 2 blocks inside the wall of a tunnel: out of sight with 0, in sight with 3 (W69)', () => {
        const tunnel = { '10,20,13': 'air', '10,21,13': 'air' };
        assert.equal(S.oreInSight(rock(tunnel), ORE, 0), false);
        assert.equal(S.oreInSight(rock(tunnel), ORE, 3), true);
    });

    test('the nearest cells are read first: an ore in the open needs few reads', () => {
        let reads = 0;
        const base = rock({ '10,21,10': 'air' });
        assert.equal(S.oreInSight((x, y, z) => { reads++; return base(x, y, z); }, ORE, 3), true);
        assert.ok(reads <= 26, `${reads} reads`);
        reads = 0;
        const all = rock({});
        assert.equal(S.oreInSight((x, y, z) => { reads++; return all(x, y, z); }, ORE, 3), false);
        assert.equal(reads, 7 * 7 * 7 - 1, 'out of sight: every cell of the cube once, not the ore');
    });
});

describe('sightRange, isOreName, oreKind', () => {
    test('sightRange: 0 or 3; 1 and 2 as they are; anything else 0, above 3 is 3', () => {
        assert.equal(S.sightRange(0), 0);
        assert.equal(S.sightRange(3), 3);
        assert.equal(S.sightRange(2), 2);
        assert.equal(S.sightRange(2.9), 2);
        assert.equal(S.sightRange(10), 3);
        for (const bad of [undefined, null, -1, NaN, Infinity, '3', true]) assert.equal(S.sightRange(bad), 0, String(bad));
        assert.equal(S.MAX_SIGHT_RANGE, 3);
        assert.equal(S.oreInSight(rock({ '14,20,10': 'air' }), ORE, 100), false, 'range above 3 is 3');
        assert.equal(S.oreInSight(rock({ '11,21,10': 'air' }), ORE, 'x'), false, 'a bad range is 0');
    });

    test('isOreName: ends with _ore, or ancient_debris', () => {
        for (const name of ['iron_ore', 'deepslate_iron_ore', 'nether_gold_ore', 'nether_quartz_ore', 'emerald_ore', 'ancient_debris', 'minecraft:coal_ore'])
            assert.equal(S.isOreName(name), true, name);
        for (const name of ['iron', 'raw_iron', 'iron_block', 'stone', 'ore', '_ore', '', null, 5])
            assert.equal(S.isOreName(name), false, String(name));
    });

    test('oreKind: the ore of the mining pack, else null', () => {
        assert.equal(S.oreKind('iron_ore'), 'iron');
        assert.equal(S.oreKind('deepslate_iron_ore'), 'iron');
        assert.equal(S.oreKind('lapis_ore'), 'lapis');
        assert.equal(S.oreKind('deepslate_diamond_ore'), 'diamond');
        for (const name of ['emerald_ore', 'nether_gold_ore', 'nether_quartz_ore', 'ancient_debris', 'iron', null])
            assert.equal(S.oreKind(name), null, String(name));
        assert.deepEqual([...S.MINING_ORES], ['coal', 'copper', 'iron', 'lapis', 'gold', 'redstone', 'diamond']);
    });
});

describe('outOfSightText: the texts of C1, word for word', () => {
    const LONG = 'I see no iron_ore. I know that there is some within 16 blocks, but it is inside the rock. Tell me to mine iron and I get it from a mine.';
    const SHORT = 'I see no iron_ore within 16 blocks.';

    test('with !mineOre on and an ore of the pack within 16 blocks: the long text', () => {
        assert.equal(S.outOfSightText('iron_ore', { ore: 'iron', near: true, mining: true }), LONG);
    });

    test('otherwise the short text', () => {
        assert.equal(S.outOfSightText('iron_ore', { ore: 'iron', near: true, mining: false }), SHORT, 'mining pack off');
        assert.equal(S.outOfSightText('iron_ore', { ore: 'iron', near: false, mining: true }), SHORT, 'only farther than 16 blocks');
        assert.equal(S.outOfSightText('iron_ore', { ore: null, near: true, mining: true }), SHORT, 'an ore the pack does not mine');
        assert.equal(S.outOfSightText('iron_ore'), SHORT);
        assert.equal(S.outOfSightText('emerald_ore', { ore: 'emerald', near: true, mining: true }), 'I see no emerald_ore within 16 blocks.');
    });
});

describe('the module', () => {
    test('is pure: no imports, no side effects', () => {
        assert.deepEqual(importsOf('src/agent/library/ore_sight_logic.js').static, []);
        assert.equal(importsOf('src/agent/library/ore_sight_logic.js').dynamic, 0);
        assertCleanImport('src/agent/library/ore_sight_logic.js');
    });
});
