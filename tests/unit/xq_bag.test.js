// v0.1.4.13 part Q (engineer E4), SPEC 4.6 Q4 and Q9: the store rule of the full bag from fixtures (what is stored,
// what the trip does, the texts word for word) in src/agent/packs/mining/bag_logic.js, storeFullBag of bag.js over a fake
// bot and a fake storage (the chest of the mine first, then the chests within 32 blocks), and the words of the other
// ores (mine_other_ores).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { assertImportRules } from '../helpers/module_rules.js';

const L = await loadSrc('src/agent/packs/mining/bag_logic.js');
const B = await loadSrc('src/agent/packs/mining/bag.js');

const FOODS = { bread: {}, cooked_beef: {} };
// the bag of a deep trip for diamond: tools, food, torches, ladders, the ore, and what the digging brought
const BAG = [
    { name: 'iron_pickaxe', count: 1 }, { name: 'stone_pickaxe', count: 1 }, { name: 'bread', count: 12 }, { name: 'torch', count: 40 },
    { name: 'ladder', count: 8 }, { name: 'diamond', count: 7 }, { name: 'cobbled_deepslate', count: 64 }, { name: 'cobbled_deepslate', count: 64 },
    { name: 'cobbled_deepslate', count: 64 }, { name: 'cobbled_deepslate', count: 11 }, { name: 'gravel', count: 65 }, { name: 'water_bucket', count: 1 },
];

describe('Q4: what the full bag stores', () => {
    test('not tools, food, torches, ladders or the ore mined; the most first', () => {
        assert.deepEqual(L.storeKinds(BAG, { ore: 'diamond', foods: FOODS }), [{ name: 'cobbled_deepslate', count: 203 }, { name: 'gravel', count: 65 }]);
    });

    test('the ore of another trip is stored', () => {
        assert.deepEqual(L.storeKinds([{ name: 'diamond', count: 3 }, { name: 'raw_iron', count: 5 }], { ore: 'raw_iron', foods: FOODS }), [{ name: 'diamond', count: 3 }]);
    });

    test('kept kinds by name: a sword, an axe, shears, a bucket; food by the food list', () => {
        for (const name of ['diamond_sword', 'iron_axe', 'shears', 'bucket', 'torch', 'ladder', 'bread']) {
            assert.equal(L.isKeptKind(name, { ore: 'raw_iron', foods: FOODS }), true, name);
        }
        for (const name of ['cobblestone', 'flint', 'iron_boots', 'raw_copper']) {
            assert.equal(L.isKeptKind(name, { ore: 'raw_iron', foods: FOODS }), false, name);
        }
        assert.equal(L.isKeptKind('apple', { foods: new Set(['apple']) }), true, 'a set of foods');
    });

    test('the step: store with something to store, dig on with a free slot, stop with none', () => {
        assert.equal(L.bagAction({ freeSlots: 0, storable: [{ name: 'gravel', count: 1 }] }), 'store');
        assert.equal(L.bagAction({ freeSlots: 2, storable: [] }), 'dig');
        assert.equal(L.bagAction({ freeSlots: 0, storable: [] }), 'stop');
    });

    test('the texts, word for word', () => {
        assert.equal(L.storedText({ cobbled_deepslate: 203, gravel: 65 }, { x: 16, y: -59, z: -98 }),
            'I stored 203 cobbled_deepslate and 65 gravel in the chest at (16, -59, -98) and go on.');
        assert.equal(L.storedText({ gravel: 2, cobblestone: 4, flint: 1 }, { x: 0, y: 41, z: 2 }),
            'I stored 4 cobblestone, 2 gravel and 1 flint in the chest at (0, 41, 2) and go on.');
        assert.equal(L.bagFullText(7, 28, 'diamond'), 'My bag is full and no chest within 32 blocks has room. I stop the mining at 7 of 28 diamond.');
        assert.equal(L.bagKeptText(7, 28, 'diamond'), 'My bag is full of things I keep for the mining. I stop the mining at 7 of 28 diamond.');
    });

    test('bag_logic.js is pure', () => {
        assertImportRules('src/agent/packs/mining/bag_logic.js', { allowBuiltins: [], allowedRelative: [] });
    });
});

describe('Q9: the other ores on the way', () => {
    test('the words of the texts, the ore asked for left out', () => {
        assert.equal(L.otherOresWords({ raw_iron: 6, redstone: 11, lapis_lazuli: 4 }, 'raw_iron'), ', and 11 redstone and 4 lapis_lazuli on the way');
        assert.equal(L.otherOresWords({ raw_iron: 6 }, 'raw_iron'), '');
        assert.equal(L.otherOresWords({ coal: 3, redstone: 11, lapis_lazuli: 4 }, 'diamond'), ', and 11 redstone, 4 lapis_lazuli and 3 coal on the way');
    });

    test('at the end of the first sentence of the done and the stop text', () => {
        const words = ', and 11 redstone and 4 lapis_lazuli on the way';
        assert.equal(L.withOtherOres('I mined 6 raw_iron. The mine is at (1, 2, 3).', words),
            'I mined 6 raw_iron, and 11 redstone and 4 lapis_lazuli on the way. The mine is at (1, 2, 3).');
        assert.equal(L.withOtherOres('I mined 2 raw_iron of 6. I stopped because you stopped me.', words),
            'I mined 2 raw_iron of 6, and 11 redstone and 4 lapis_lazuli on the way. I stopped because you stopped me.');
        assert.equal(L.withOtherOres('I mined 6 raw_iron.', ''), 'I mined 6 raw_iron.');
    });
});

describe('Q4: storeFullBag over a fake bot and storage', () => {
    const CHEST = { x: 0, y: 41, z: 2 };
    function scene({ chestRoom = true, otherRoom = true, items = null, free = 0 } = {}) {
        const said = [];
        const calls = [];
        const bag = items ?? [{ name: 'iron_pickaxe', count: 1 }, { name: 'torch', count: 64 }, { name: 'raw_iron', count: 2 }, { name: 'gravel', count: 2 }, { name: 'cobblestone', count: 4 }];
        const bot = {
            registry: { foodsByName: FOODS },
            entity: { position: { x: 0.5, y: 41, z: 0.5 } },
            inventory: { items: () => bag.filter(i => i.count > 0), emptySlotCount: () => free },
            blockAt: (p) => (p.x === CHEST.x && p.y === CHEST.y && p.z === CHEST.z ? { name: 'chest' } : { name: 'stone' }),
        };
        const storage = {
            storeItems: async (b, ctx, options) => {
                calls.push(options);
                const room = options.chest ? chestRoom : otherRoom;
                const stored = {};
                const left = {};
                for (const name of options.only) {
                    const n = bag.filter(i => i.name === name).reduce((s, i) => s + i.count, 0);
                    if (room) stored[name] = n;
                    else left[name] = n;
                }
                return { ok: room, reason: room ? null : 'full', stored, left, chests: room ? [options.chest ?? { x: 9, y: 41, z: 9 }] : [] };
            },
        };
        const ctx = { storage, say: (t) => said.push(t) };
        return { bot, ctx, said, calls };
    }
    const mine = { room: { center: { x: 2, y: 41, z: 0 }, chest: CHEST } };
    const row = { item: 'raw_iron', ore: 'iron' };

    test('the chest of the mine has room: stored there, the text, go on', async () => {
        const s = scene();
        const r = await B.storeFullBag(s.bot, s.ctx, mine, row, { mined: 2, wanted: 6 });
        assert.deepEqual([r.ok, r.action, r.stored], [true, 'store', { cobblestone: 4, gravel: 2 }]);
        assert.deepEqual(s.calls.map(c => [c.chest ?? null, c.only]), [[CHEST, ['cobblestone', 'gravel']]]);
        assert.deepEqual(s.said, ['I stored 4 cobblestone and 2 gravel in the chest at (0, 41, 2) and go on.']);
    });

    test('the chest of the mine is full: the nearest chest within 32 blocks', async () => {
        const s = scene({ chestRoom: false });
        const r = await B.storeFullBag(s.bot, s.ctx, mine, row, { mined: 2, wanted: 6 });
        assert.equal(r.ok, true);
        assert.deepEqual(s.calls.map(c => [c.chest ?? null, c.range ?? null]), [[CHEST, null], [null, 32]]);
        assert.deepEqual(s.said, ['I stored 4 cobblestone and 2 gravel in the chest at (9, 41, 9) and go on.']);
    });

    test('no chest has room: the stop text, reason inventory_full', async () => {
        const s = scene({ chestRoom: false, otherRoom: false });
        const r = await B.storeFullBag(s.bot, s.ctx, mine, row, { mined: 2, wanted: 6 });
        assert.deepEqual([r.ok, r.reason, r.action], [false, 'inventory_full', 'stop']);
        assert.deepEqual(s.said, ['My bag is full and no chest within 32 blocks has room. I stop the mining at 2 of 6 iron.']);
    });

    test('nothing to store and a free slot: dig on, nothing said; no free slot: stop', async () => {
        const kept = [{ name: 'iron_pickaxe', count: 1 }, { name: 'torch', count: 64 }, { name: 'raw_iron', count: 2 }];
        const a = scene({ items: kept, free: 2 });
        assert.deepEqual([(await B.storeFullBag(a.bot, a.ctx, mine, row)).action, a.said, a.calls], ['dig', [], []]);
        const b = scene({ items: kept, free: 0 });
        const r = await B.storeFullBag(b.bot, b.ctx, mine, row, { mined: 2, wanted: 6 });
        assert.deepEqual([r.ok, r.action], [false, 'stop']);
        assert.deepEqual(b.said, ['My bag is full of things I keep for the mining. I stop the mining at 2 of 6 iron.']);
    });
});
