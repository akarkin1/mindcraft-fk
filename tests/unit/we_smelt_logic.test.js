// Spec v0.1.4.12, 4.2 (part E): the pure decisions of smelting in src/agent/packs/storage/smelt_logic.js:
// the fuel choice, the products, the furnace choice from a fixture of areas, the batches and the time limit;
// and the texts of storage/texts.js word for word.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { importsOf } from '../helpers/hygiene.js';
import { assertCleanImport } from '../helpers/module_rules.js';

const L = await loadSrc('src/agent/packs/storage/smelt_logic.js');
const T = await loadSrc('src/agent/packs/storage/texts.js');
const P = await loadSrc('src/agent/packs/storage/index.js');

describe('smelt_logic.js is pure', () => {
    test('no imports, no side effects', () => {
        const { static: specs, require, dynamic } = importsOf('src/agent/packs/storage/smelt_logic.js');
        assert.deepEqual([specs, require, dynamic], [[], 0, 0]);
        assertCleanImport('src/agent/packs/storage/smelt_logic.js');
    });
});

describe('chooseFuel: coal or charcoal (8), then planks (1.5), then logs (1.5), the fewest units', () => {
    test('coal first, the fewest units that cover the count', () => {
        assert.deepEqual(L.chooseFuel({ coal: 5, oak_planks: 20 }, 8), { name: 'coal', count: 1, per: 8, covers: 8 });
        assert.deepEqual(L.chooseFuel({ coal: 5 }, 9), { name: 'coal', count: 2, per: 8, covers: 9 });
        assert.deepEqual(L.chooseFuel({ coal: 9 }, 64), { name: 'coal', count: 8, per: 8, covers: 64 });
        assert.deepEqual(L.chooseFuel({ coal: 1 }, 1), { name: 'coal', count: 1, per: 8, covers: 1 });
    });

    test('charcoal when there is no coal or too little', () => {
        assert.deepEqual(L.chooseFuel({ charcoal: 3 }, 3), { name: 'charcoal', count: 1, per: 8, covers: 3 });
        assert.deepEqual(L.chooseFuel({ coal: 1, charcoal: 5 }, 16), { name: 'charcoal', count: 2, per: 8, covers: 16 });
    });

    test('planks, then logs, 1.5 items each', () => {
        assert.deepEqual(L.chooseFuel({ oak_planks: 4, birch_log: 9 }, 3), { name: 'oak_planks', count: 2, per: 1.5, covers: 3 });
        assert.deepEqual(L.chooseFuel({ oak_planks: 1, birch_log: 9 }, 3), { name: 'birch_log', count: 2, per: 1.5, covers: 3 });
        assert.deepEqual(L.chooseFuel([{ name: 'spruce_log', count: 3 }, { name: 'spruce_log', count: 3 }], 8),
            { name: 'spruce_log', count: 6, per: 1.5, covers: 8 }, 'a list of stacks adds up');
        assert.deepEqual(L.chooseFuel({ oak_planks: 2, birch_planks: 10 }, 6), { name: 'birch_planks', count: 4, per: 1.5, covers: 6 },
            'the planks the bot has most of');
    });

    test('when nothing covers the count: the fuel that covers the most, all of it', () => {
        assert.deepEqual(L.chooseFuel({ coal: 1, oak_planks: 12 }, 30), { name: 'oak_planks', count: 12, per: 1.5, covers: 18 });
        assert.deepEqual(L.chooseFuel({ coal: 1, oak_planks: 2 }, 30), { name: 'coal', count: 1, per: 8, covers: 8 });
    });

    test('never lava buckets or blaze rods, never nether wood; null without fuel', () => {
        assert.equal(L.chooseFuel({ lava_bucket: 3, blaze_rod: 10, crimson_planks: 10, warped_stem: 5, crimson_hyphae: 4 }, 4), null);
        assert.equal(L.chooseFuel({}, 4), null);
        assert.equal(L.chooseFuel(null, 4), null);
        assert.equal(L.chooseFuel({ lava_bucket: 1, coal: 1 }, 4).name, 'coal');
        assert.equal(L.fuelKindOf('lava_bucket'), null);
        assert.equal(L.fuelKindOf('blaze_rod'), null);
        assert.equal(L.fuelKindOf('stripped_oak_log'), 'logs');
        assert.equal(L.fuelKindOf('minecraft:Bamboo_Planks'), 'planks');
        assert.equal(L.fuelPer('charcoal'), 8);
        assert.equal(L.fuelPer('dirt'), 0);
    });

    test('unitsFor rounds up without float noise', () => {
        assert.equal(L.unitsFor(1.5, 3), 2);
        assert.equal(L.unitsFor(1.5, 4), 3);
        assert.equal(L.unitsFor(1.5, 9), 6);
        assert.equal(L.unitsFor(8, 64), 8);
        assert.equal(L.unitsFor(8, 65), 9);
        assert.equal(L.unitsFor(0, 5), 0);
    });
});

describe('productOf: the table of the common smelting recipes', () => {
    const TABLE = {
        raw_iron: 'iron_ingot', raw_copper: 'copper_ingot', raw_gold: 'gold_ingot', iron_ore: 'iron_ingot', deepslate_iron_ore: 'iron_ingot',
        sand: 'glass', red_sand: 'glass', cobblestone: 'stone', oak_log: 'charcoal', stripped_birch_log: 'charcoal', cherry_wood: 'charcoal',
        clay_ball: 'brick', beef: 'cooked_beef', porkchop: 'cooked_porkchop', chicken: 'cooked_chicken', mutton: 'cooked_mutton',
        cod: 'cooked_cod', salmon: 'cooked_salmon', potato: 'baked_potato', kelp: 'dried_kelp', netherrack: 'nether_brick', cactus: 'green_dye',
    };
    for (const [item, product] of Object.entries(TABLE)) {
        test(`${item} -> ${product}`, () => assert.equal(L.productOf(item), product));
    }

    test('names with minecraft: and capitals; things a furnace does not change', () => {
        assert.equal(L.productOf('minecraft:Raw_Iron'), 'iron_ingot');
        for (const item of ['raw_cobblestone', 'dirt', 'crimson_stem', 'warped_hyphae', 'iron_ingot', '', null, 42]) {
            assert.equal(L.productOf(item), null, String(item));
        }
    });

    test('the products are items of 1.21.8', async () => {
        const { createRequire } = await import('node:module');
        const reg = createRequire(import.meta.url)('prismarine-registry')('1.21.8');
        for (const [item, product] of Object.entries(L.SMELT_PRODUCTS)) {
            assert.ok(reg.itemsByName[item], item);
            assert.ok(reg.itemsByName[product], product);
        }
    });
});

describe('batches and the time limit', () => {
    test('at most 64 at once', () => {
        assert.equal(L.BATCH_MAX, 64);
        assert.deepEqual(L.batchesOf(8), [8]);
        assert.deepEqual(L.batchesOf(64), [64]);
        assert.deepEqual(L.batchesOf(130), [64, 64, 2]);
        assert.deepEqual(L.batchesOf(0), []);
    });

    test('12 s per item plus 10 s; the furnace is read every 2 s', () => {
        assert.equal(L.timeLimitMs(1), 22000);
        assert.equal(L.timeLimitMs(8), 106000);
        assert.equal(L.POLL_MS, 2000);
    });
});

describe('the furnace choice from a fixture of areas', () => {
    const box = (name, kind, min, max, type = undefined) => ({ name, kind, type: type ?? kind, min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] } });
    const AREAS = [
        box('storage', 'storage', [0, 60, 0], [6, 70, 6], 'building'),
        box('pen', 'pen', [-8, 60, -2], [-2, 70, 4]),
        box('farm', 'farm', [-2, 60, -8], [4, 70, -3]),
        box('yard', 'yard', [8, 60, -4], [14, 70, 4], 'building'),
        box('mine', undefined, [-4, 30, 8], [4, 70, 14], 'mine'),
        box('coop', 'pen', [4, 60, 4], [6, 70, 6]), // a pen inside the storage
    ];
    const me = { x: 0.5, y: 64, z: 0.5 };

    test('a cell in a storage, building, home or mine; never a pen, a farm or a yard; never outside when areas exist', () => {
        assert.equal(L.cellAllowsFurnace({ x: 1, y: 64, z: 1 }, AREAS), true, 'storage');
        assert.equal(L.cellAllowsFurnace({ x: 0, y: 64, z: 10 }, AREAS), true, 'mine (type only)');
        assert.equal(L.cellAllowsFurnace({ x: -4, y: 64, z: 0 }, AREAS), false, 'pen');
        assert.equal(L.cellAllowsFurnace({ x: 0, y: 64, z: -5 }, AREAS), false, 'farm');
        assert.equal(L.cellAllowsFurnace({ x: 10, y: 64, z: 0 }, AREAS), false, 'yard, saved as a building');
        assert.equal(L.cellAllowsFurnace({ x: 5, y: 64, z: 5 }, AREAS), false, 'a pen inside the storage');
        assert.equal(L.cellAllowsFurnace({ x: 20, y: 64, z: 20 }, AREAS), false, 'outside every area');
        assert.equal(L.cellAllowsFurnace({ x: 20, y: 64, z: 20 }, []), true, 'without any area');
        assert.equal(L.cellAllowsFurnace({ x: 1, y: 64, z: 1 }, [box('home', 'home', [0, 60, 0], [3, 70, 3])]), true, 'home');
        assert.equal(L.cellAllowsFurnace({ x: 1, y: 64, z: 1 }, [box('hall', undefined, [0, 60, 0], [3, 70, 3], 'building')]), true, 'building');
        assert.equal(L.areaKindOf({ type: 'building', kind: 'yard' }), 'yard');
    });

    test('the nearest allowed cell within 8 blocks that canPlace allows', () => {
        const cells = [{ x: -3, y: 64, z: 0 }, { x: 0, y: 64, z: -4 }, { x: 3, y: 64, z: 2 }, { x: 2, y: 64, z: 2 }, { x: 11, y: 64, z: 0 }];
        assert.deepEqual(L.chooseFurnaceSpot(cells, AREAS, me), { x: 2, y: 64, z: 2 }, 'the pen and the farm are nearer');
        const refused = [];
        const canPlace = (c, item) => { refused.push([c.x, item]); return c.x !== 2; };
        assert.deepEqual(L.chooseFurnaceSpot(cells, AREAS, me, canPlace), { x: 3, y: 64, z: 2 }, 'the guard refuses the nearest');
        assert.deepEqual(refused[0], [2, 'furnace']);
        assert.equal(L.chooseFurnaceSpot(cells, AREAS, me, () => false), null);
        assert.equal(L.chooseFurnaceSpot(cells, AREAS, me, () => { throw new Error('x'); }), null, 'a guard that throws refuses');
        assert.equal(L.chooseFurnaceSpot([{ x: -3, y: 64, z: 0 }, { x: 11, y: 64, z: 0 }], AREAS, me), null, 'only a pen and a yard');
        assert.deepEqual(L.chooseFurnaceSpot([{ x: 20, y: 64, z: 0 }, { x: 5, y: 64, z: -1 }], [], me), { x: 5, y: 64, z: -1 },
            'without areas the nearest cell within 8');
        assert.equal(L.chooseFurnaceSpot(cells, AREAS, null), null);
    });

    test('a furnace within 16 blocks that canUse allows, the nearest first', () => {
        const furnaces = [{ x: 10, y: 64, z: 0 }, { x: 3, y: 64, z: 0 }, { x: 20, y: 64, z: 0 }];
        assert.deepEqual(L.chooseFurnace(furnaces, me), { x: 3, y: 64, z: 0 });
        assert.deepEqual(L.usableFurnaces(furnaces, me), [{ x: 3, y: 64, z: 0 }, { x: 10, y: 64, z: 0 }], 'not the one 20 away');
        assert.deepEqual(L.chooseFurnace(furnaces, me, f => f.x !== 3), { x: 10, y: 64, z: 0 });
        assert.equal(L.chooseFurnace(furnaces, me, () => false), null);
        assert.equal(L.chooseFurnace([], me), null);
    });
});

describe('the texts of smelting, word for word (storage/texts.js)', () => {
    test('the six texts of the spec', () => {
        assert.equal(T.TEXTS.smelted(8, 'raw_iron', 'iron_ingot', { x: 12, y: 64.5, z: -3.2 }, 1, 'coal'),
            'I smelted 8 raw_iron into 8 iron_ingot in the furnace at (12, 64, -4) with 1 coal.');
        assert.equal(T.TEXTS.noFuel, 'I have no fuel: no coal, charcoal, planks or logs.');
        assert.equal(T.TEXTS.noFurnace, 'I know no furnace within 16 blocks and carry none.');
        assert.equal(T.TEXTS.noItem('raw_iron'), 'I carry no raw_iron.');
        assert.equal(T.TEXTS.stopped(3, 8, 'raw_iron'), 'I stopped after 3 of 8 raw_iron.');
        assert.equal(T.TEXTS.notSmeltable('raw_cobblestone'), 'raw_cobblestone is not something a furnace changes.');
    });

    test('the index exports the skill, the logic and the binding', () => {
        for (const name of ['smeltItem', 'chooseFuel', 'productOf', 'chooseFurnace', 'chooseFurnaceSpot', 'cellAllowsFurnace', 'timeLimitMs',
            'BATCH_MAX', 'SMELT_PRODUCTS']) {
            assert.ok(P[name] !== undefined, name);
        }
        assert.equal(typeof P.bindStorage({}, {}).smeltItem, 'function');
    });
});
