// Spec v0.1.4.7 F1: the pure logic of the farming pack (crop_logic.js).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    COMPOSTABLE, CROPS, FLOWERS, TILLABLE, bestHoe, cellPlan, chooseCompostItem, compostSource, cropOf, harvestTarget,
    isAirName, isCompostable, isCropBlock, isRipe, plantTargets, seedFor, seedsToKeep, visitOrder,
} from '../../src/agent/packs/farming/crop_logic.js';

describe('CROPS and cropOf', () => {
    test('the table of the spec', () => {
        assert.deepEqual(CROPS.map(r => ({ ...r })), [
            { block: 'wheat', seed: 'wheat_seeds', ripeAge: 7, harvest: 'wheat' },
            { block: 'carrots', seed: 'carrot', ripeAge: 7, harvest: 'carrot' },
            { block: 'potatoes', seed: 'potato', ripeAge: 7, harvest: 'potato' },
            { block: 'beetroots', seed: 'beetroot_seeds', ripeAge: 3, harvest: 'beetroot' },
        ]);
        assert.ok(Object.isFrozen(CROPS));
        assert.ok(CROPS.every(Object.isFrozen));
    });

    test('accepts every name of the spec', () => {
        const expect = {
            wheat: 'wheat', wheat_seeds: 'wheat', seeds: 'wheat', carrot: 'carrots', carrots: 'carrots',
            potato: 'potatoes', potatoes: 'potatoes', beetroot: 'beetroots', beetroots: 'beetroots', beetroot_seeds: 'beetroots',
        };
        for (const [name, block] of Object.entries(expect)) {
            assert.equal(cropOf(name)?.block, block, name);
        }
        assert.equal(cropOf('minecraft:wheat_seeds').block, 'wheat');
        assert.equal(cropOf(' Carrots ').block, 'carrots');
    });

    test('null for anything else', () => {
        for (const name of ['melon', 'pumpkin_seeds', 'farmland', 'bread', '', null, undefined, 7, {}]) {
            assert.equal(cropOf(name), null, String(name));
        }
    });

    test('isCropBlock knows the blocks only', () => {
        assert.equal(isCropBlock('wheat'), true);
        assert.equal(isCropBlock('minecraft:beetroots'), true);
        assert.equal(isCropBlock('carrot'), false);
        assert.equal(isCropBlock('wheat_seeds'), false);
        assert.equal(isCropBlock(null), false);
    });

    test('harvestTarget: a crop block or a harvest item, not a seed', () => {
        assert.equal(harvestTarget('wheat').block, 'wheat');
        assert.equal(harvestTarget('carrot').block, 'carrots');
        assert.equal(harvestTarget('potatoes').block, 'potatoes');
        assert.equal(harvestTarget('beetroot').block, 'beetroots');
        assert.equal(harvestTarget('wheat_seeds'), null);
        assert.equal(harvestTarget('beetroot_seeds'), null);
        assert.equal(harvestTarget('seeds'), null);
        assert.equal(harvestTarget('farmland'), null);
    });

    test('seedFor gives the seed item of a name, or null', () => {
        assert.equal(seedFor('wheat'), 'wheat_seeds');
        assert.equal(seedFor('seeds'), 'wheat_seeds');
        assert.equal(seedFor('carrots'), 'carrot');
        assert.equal(seedFor('beetroot'), 'beetroot_seeds');
        assert.equal(seedFor('melon_seeds'), null);
    });
});

describe('isRipe', () => {
    test('ripe at the age of the table', () => {
        assert.equal(isRipe('wheat', 7), true);
        assert.equal(isRipe('wheat', 6), false);
        assert.equal(isRipe('carrots', 7), true);
        assert.equal(isRipe('potatoes', 0), false);
        assert.equal(isRipe('beetroots', 3), true);
        assert.equal(isRipe('beetroots', 2), false);
        assert.equal(isRipe('minecraft:wheat', '7'), true);
    });

    test('false for unknown blocks and bad ages', () => {
        assert.equal(isRipe('wheat_seeds', 7), false);
        assert.equal(isRipe('melon_stem', 7), false);
        assert.equal(isRipe('wheat', undefined), false);
        assert.equal(isRipe('wheat', NaN), false);
        assert.equal(isRipe('wheat', 'ripe'), false);
        assert.equal(isRipe(null, 7), false);
    });
});

describe('COMPOSTABLE', () => {
    test('the chances of the spec', () => {
        const expect = {
            oak_leaves: 30, cherry_leaves: 30, pale_oak_leaves: 30, oak_sapling: 30, birch_sapling: 30, short_grass: 30,
            fern: 65, poppy: 65, dandelion: 65, cornflower: 65, sunflower: 65, leaf_litter: 30, moss_carpet: 30, vine: 50,
        };
        for (const [name, chance] of Object.entries(expect)) {
            assert.equal(COMPOSTABLE[name], chance, name);
        }
        assert.ok(Object.isFrozen(COMPOSTABLE));
        assert.ok(FLOWERS.includes('poppy') && FLOWERS.includes('lily_of_the_valley'));
        assert.ok(!FLOWERS.includes('wither_rose'));
    });

    test('never seeds, crops, food or bone meal', () => {
        for (const name of ['wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds', 'torchflower_seeds', 'wheat', 'carrot',
            'potato', 'beetroot', 'bread', 'apple', 'baked_potato', 'bone_meal', 'cookie', 'dried_kelp',
            // v0.1.4.8, E2: never crops, never food
            'melon_slice', 'pumpkin', 'sugar_cane', 'cactus',
            // Amendment 2, I3: a hay block is 9 wheat
            'hay_block']) {
            assert.equal(isCompostable(name), false, name);
            assert.equal(Object.prototype.hasOwnProperty.call(COMPOSTABLE, name), false, name);
        }
    });

    test('isCompostable accepts the prefix and rejects junk', () => {
        assert.equal(isCompostable('minecraft:oak_leaves'), true);
        assert.equal(isCompostable('toString'), false);
        assert.equal(isCompostable(null), false);
    });

    test('chooseCompostItem uses weeds first, then saplings; farm goods never (v0.1.4.8, E2)', () => {
        const inv = [
            { name: 'hay_block', count: 2 }, { name: 'pumpkin', count: 1 }, { name: 'oak_sapling', count: 3 },
            { name: 'wheat_seeds', count: 40 }, { name: 'oak_leaves', count: 5 }, { name: 'bone_meal', count: 1 },
        ];
        assert.equal(chooseCompostItem(inv), 'oak_leaves');
        assert.equal(chooseCompostItem(inv.filter(i => i.name !== 'oak_leaves')), 'oak_sapling');
        assert.equal(chooseCompostItem([{ name: 'hay_block', count: 1 }, { name: 'pumpkin', count: 1 }]), null);
        assert.equal(chooseCompostItem([{ name: 'hay_block', count: 1 }]), null, 'a hay block is 9 wheat (Amendment 2, I3)');
        assert.equal(chooseCompostItem([{ name: 'wheat_seeds', count: 64 }, { name: 'bone_meal', count: 3 }]), null);
        assert.equal(chooseCompostItem([{ name: 'oak_leaves', count: 0 }]), null);
        assert.equal(chooseCompostItem([{ name: 'poppy', count: 1 }, { name: 'dandelion', count: 1 }]), 'dandelion');
        assert.equal(chooseCompostItem(null), null);
    });

    test('compostSource: flowers always; grass, fern and natural leaves only with shears', () => {
        assert.equal(compostSource('poppy', {}, false), true);
        assert.equal(compostSource('sunflower', { half: 'lower' }, false), true);
        assert.equal(compostSource('sunflower', { half: 'upper' }, false), false);
        assert.equal(compostSource('short_grass', {}, false), false);
        assert.equal(compostSource('short_grass', {}, true), true);
        assert.equal(compostSource('fern', {}, true), true);
        assert.equal(compostSource('oak_leaves', { persistent: false }, true), true);
        assert.equal(compostSource('oak_leaves', { persistent: false }, false), false);
        assert.equal(compostSource('oak_leaves', { persistent: true }, true), false, 'leaves placed by a player stay');
        assert.equal(compostSource('wheat', { age: 7 }, true), false);
        assert.equal(compostSource('tall_grass', {}, true), false);
        assert.equal(compostSource(null, {}, true), false);
    });
});

describe('TILLABLE, isAirName, bestHoe', () => {
    test('the ground a hoe turns into farmland', () => {
        assert.deepEqual([...TILLABLE], ['dirt', 'grass_block', 'coarse_dirt', 'dirt_path']);
    });

    test('air names', () => {
        assert.equal(isAirName('air'), true);
        assert.equal(isAirName('cave_air'), true);
        assert.equal(isAirName('minecraft:void_air'), true);
        assert.equal(isAirName('short_grass'), false);
        assert.equal(isAirName(null), false);
    });

    test('bestHoe picks the best material', () => {
        assert.equal(bestHoe([{ name: 'wooden_hoe', count: 1 }, { name: 'iron_hoe', count: 1 }, { name: 'stone_hoe', count: 1 }]), 'iron_hoe');
        assert.equal(bestHoe([{ name: 'golden_hoe', count: 1 }, { name: 'netherite_hoe', count: 1 }]), 'netherite_hoe');
        assert.equal(bestHoe([{ name: 'iron_pickaxe', count: 1 }]), null);
        assert.equal(bestHoe(undefined), null);
    });
});

describe('cellPlan', () => {
    const all = { seeds: 10, hoe: true, bone_meal: 5 };
    const none = { seeds: 0, hoe: false, bone_meal: 0 };

    test('a ripe crop: harvest, then plant when a seed of that crop is there', () => {
        assert.deepEqual(cellPlan({ ground: 'farmland', above: 'wheat', age: 7 }, all), ['harvest', 'plant']);
        assert.deepEqual(cellPlan({ ground: 'farmland', above: 'wheat', age: 7 }, none), ['harvest']);
        assert.deepEqual(cellPlan({ ground: 'farmland', above: 'beetroots', age: 3 }, { seeds: { beetroot_seeds: 1 } }), ['harvest', 'plant']);
        assert.deepEqual(cellPlan({ ground: 'farmland', above: 'carrots', age: 7 }, { seeds: { wheat_seeds: 9 } }), ['harvest'],
            'a wheat seed does not replant a carrot');
        assert.deepEqual(cellPlan({ ground: 'farmland', above: 'potatoes', age: 7 }, { seeds: true }), ['harvest', 'plant']);
    });

    test('an unripe crop: fertilize with bone meal, otherwise nothing', () => {
        assert.deepEqual(cellPlan({ ground: 'farmland', above: 'wheat', age: 3 }, all), ['fertilize']);
        assert.deepEqual(cellPlan({ ground: 'farmland', above: 'wheat', age: 3 }, none), []);
        assert.deepEqual(cellPlan({ ground: 'farmland', above: 'wheat' }, { bone_meal: true }), ['fertilize'], 'no age: not ripe');
    });

    test('farmland with air above: plant when seeds are there', () => {
        assert.deepEqual(cellPlan({ ground: 'farmland', above: 'air' }, all), ['plant']);
        assert.deepEqual(cellPlan({ ground: 'farmland', above: 'cave_air' }, { seeds: { carrot: 2 } }), ['plant']);
        assert.deepEqual(cellPlan({ ground: 'farmland', above: 'air' }, none), []);
        assert.deepEqual(cellPlan({ ground: 'farmland', above: 'air' }, { seeds: {} }), []);
        assert.deepEqual(cellPlan({ ground: 'farmland', above: 'short_grass' }, all), []);
        assert.deepEqual(cellPlan({ ground: 'farmland', above: 'torch' }, all), []);
    });

    test('dirt, grass, coarse dirt and path in a farm: till with a hoe, then plant', () => {
        for (const ground of TILLABLE) {
            assert.deepEqual(cellPlan({ ground, above: 'air' }, all), ['till', 'plant'], ground);
            assert.deepEqual(cellPlan({ ground, above: 'air' }, { seeds: 0, hoe: true }), ['till'], ground);
            assert.deepEqual(cellPlan({ ground, above: 'air' }, { seeds: 5, hoe: false }), [], ground);
            assert.deepEqual(cellPlan({ ground, above: 'air', inFarm: false }, all), [], `${ground} outside a farm`);
        }
        assert.deepEqual(cellPlan({ ground: 'grass_block', above: 'short_grass' }, all), []);
        assert.deepEqual(cellPlan({ ground: 'minecraft:dirt', above: 'minecraft:air' }, { seeds: 1, hoe: 'iron_hoe' }), ['till', 'plant']);
    });

    test('anything else: nothing', () => {
        for (const cell of [{ ground: 'stone', above: 'air' }, { ground: 'water', above: 'air' }, { ground: 'oak_fence', above: 'air' },
            { ground: 'sand', above: 'air' }, { ground: 'farmland', above: null }, {}, null, 'farmland']) {
            assert.deepEqual(cellPlan(cell, all), [], JSON.stringify(cell));
        }
        assert.deepEqual(cellPlan({ ground: 'farmland', above: 'air' }, null), []);
    });
});

// A field of cells: width x depth from (x0, z0), minus holes.
function field(width, depth, { x0 = 0, z0 = 0, holes = [] } = {}) {
    const cells = [];
    for (let x = x0; x < x0 + width; x++) {
        for (let z = z0; z < z0 + depth; z++) {
            if (!holes.some(h => h.x === x && h.z === z)) cells.push({ x, y: 63, z });
        }
    }
    return cells;
}

// Checks the rules of visitOrder and returns the rows in the order visited.
function checkOrder(cells, start) {
    const order = visitOrder(cells, start);
    assert.equal(order.length, cells.length, 'every cell once');
    assert.deepEqual(new Set(order), new Set(cells));
    const xs = cells.map(c => c.x);
    const zs = cells.map(c => c.z);
    const rowsAlongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs);
    const rowOf = c => (rowsAlongX ? c.z : c.x);
    const posOf = c => (rowsAlongX ? c.x : c.z);
    const rows = [];
    for (const c of order) {
        if (rows.length === 0 || rows[rows.length - 1].row !== rowOf(c)) rows.push({ row: rowOf(c), cells: [] });
        rows[rows.length - 1].cells.push(c);
    }
    assert.equal(new Set(rows.map(r => r.row)).size, rows.length, 'a row is visited in one go');
    let dir = 0;
    for (const r of rows) {
        const p = r.cells.map(posOf);
        if (p.length > 1) {
            const d = Math.sign(p[1] - p[0]);
            for (let i = 1; i < p.length; i++) assert.equal(Math.sign(p[i] - p[i - 1]), d, 'one direction in a row');
            if (dir !== 0) assert.equal(d, -dir, 'the direction turns at the end of each row');
            dir = d;
        } else if (dir !== 0) {
            dir = -dir;
        }
    }
    const nearest = Math.min(...cells.map(c => Math.abs(rowOf(c) - (rowsAlongX ? start.z : start.x))));
    assert.equal(Math.abs(rows[0].row - (rowsAlongX ? start.z : start.x)), nearest, 'the first row is the nearest');
    return { order, rows };
}

describe('visitOrder', () => {
    test('the field of the owner, 2 by 5, from the gate in the south', () => {
        const cells = field(2, 5, { x0: 10, z0: 20 });
        const { order, rows } = checkOrder(cells, { x: 10.5, y: 64, z: 25.5 });
        assert.equal(rows.length, 2, 'rows run along the long side');
        assert.deepEqual(order.slice(0, 5).map(c => [c.x, c.z]), [[10, 24], [10, 23], [10, 22], [10, 21], [10, 20]]);
        assert.deepEqual(order.slice(5).map(c => [c.x, c.z]), [[11, 20], [11, 21], [11, 22], [11, 23], [11, 24]]);
    });

    test('square fields up to 20 by 20 from every side', () => {
        for (const n of [1, 3, 8, 20]) {
            const cells = field(n, n);
            for (const start of [{ x: -1, z: -1 }, { x: n, z: n }, { x: n / 2, z: -3 }, { x: -2, z: n / 2 }, { x: n / 2, z: n / 2 }]) {
                const { order } = checkOrder(cells, start);
                assert.equal(order.length, n * n);
            }
        }
    });

    test('a start in the middle goes to the nearer edge first', () => {
        const cells = field(6, 5);
        const { rows } = checkOrder(cells, { x: 0, z: 1 });
        assert.deepEqual(rows.map(r => r.row), [1, 0, 2, 3, 4]);
        const { rows: rows2 } = checkOrder(cells, { x: 0, z: 3 });
        assert.deepEqual(rows2.map(r => r.row), [3, 4, 2, 1, 0]);
    });

    test('the first row starts at its end nearer to the start', () => {
        const cells = field(8, 2);
        assert.deepEqual(visitOrder(cells, { x: 9, z: 0 })[0], cells.find(c => c.x === 7 && c.z === 0));
        assert.deepEqual(visitOrder(cells, { x: -1, z: 0 })[0], cells.find(c => c.x === 0 && c.z === 0));
    });

    test('holes, water in the middle and a shape that is not a rectangle', () => {
        const holes = [{ x: 3, z: 3 }, { x: 0, z: 7 }, { x: 12, z: 12 }];
        checkOrder(field(15, 15, { holes }), { x: 7, z: 16 });
        const water = [];
        for (let x = 8; x <= 11; x++) for (let z = 8; z <= 11; z++) water.push({ x, z });
        checkOrder(field(20, 20, { holes: water }), { x: -1, z: 10 });
        // An L: 20 long in x at z 0..3, and 4 wide in x going to z 19.
        const l = field(20, 4).concat(field(4, 16, { z0: 4 }));
        checkOrder(l, { x: 25, z: 0 });
        checkOrder(l, { x: 2, z: 25 });
        // A row that is missing entirely.
        checkOrder(field(10, 6, { holes: field(10, 1, { z0: 2 }) }), { x: 0, z: 2 });
    });

    test('ties: rows along x, the lower row first', () => {
        const cells = field(3, 3);
        const order = visitOrder(cells, { x: 1, z: 1 });
        assert.deepEqual(order.slice(0, 3).map(c => c.z), [1, 1, 1]);
        assert.deepEqual(order.slice(3, 6).map(c => c.z), [0, 0, 0]);
    });

    test('does not change its input and drops invalid cells', () => {
        const cells = field(3, 2);
        const copy = cells.map(c => ({ ...c }));
        const order = visitOrder([...cells, null, { x: NaN, z: 1 }, 'x'], { x: 0, z: 0 });
        assert.equal(order.length, 6);
        assert.deepEqual(cells, copy);
        assert.deepEqual(visitOrder([], { x: 0, z: 0 }), []);
        assert.deepEqual(visitOrder(null, null), []);
        assert.equal(visitOrder(field(2, 2), null).length, 4, 'without a start: from the lowest corner');
        assert.deepEqual(visitOrder(field(2, 2), null)[0], { x: 0, y: 63, z: 0 });
    });
});

// F23 (v0.1.4.11): the store step of the farm cycle keeps the seeds that its planting needs.
describe('plantTargets and seedsToKeep', () => {
    const cells = [
        { x: 0, z: 0, ground: 'farmland', above: 'air' },
        { x: 1, z: 0, ground: 'grass_block', above: 'air' },
        { x: 2, z: 0, ground: 'farmland', above: 'wheat' },
        { x: 3, z: 0, ground: 'minecraft:farmland', above: 'cave_air' },
        { x: 4, z: 0, ground: 'stone', above: 'air' },
        { x: 5, z: 0, ground: 'dirt', above: 'tall_grass' },
    ];

    test('farmland with air above, then tillable ground with a hoe', () => {
        assert.deepEqual(plantTargets(cells, false).map(c => c.x), [0, 3]);
        assert.deepEqual(plantTargets(cells, true).map(c => c.x), [0, 3, 1]);
        assert.deepEqual(plantTargets(null, true), []);
        assert.deepEqual(plantTargets([null, 5, { ground: 'farmland' }], true), []);
    });

    test('33 seeds after the harvest and 6 empty cells: 38 are kept, none is stored', () => {
        assert.equal(seedsToKeep(32, 6), 38);
        assert.ok(33 <= seedsToKeep(32, 6));
        assert.equal(seedsToKeep(32, 0), 32);
        assert.equal(seedsToKeep(32, -3), 32);
        assert.equal(seedsToKeep(32, NaN), 32);
    });
});
