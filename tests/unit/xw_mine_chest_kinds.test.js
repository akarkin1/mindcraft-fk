// E3, spec v0.1.4.16 F11 (the play of 2026-11-10: the mine chest filled with 33 kinds): the chest of the mine takes only the
// mining's kinds. isMineChestKind of bag_logic.js (every ore and raw metal, coal, redstone, lapis, diamond, emerald,
// amethyst shards, the stone kinds and the fillers, gravel, flint, dirt, sand, clay); depositAtBase stores those only
// (storeItems with `only`), the kept kinds excluded as before; storeFullBag stores the mine-chest kinds first and the rest
// only when the bag is still full after them.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeMiningBot, makeClock, makeCtx, give } from './mining_fake_bot.test.js';

const L = await loadSrc('src/agent/packs/mining/bag_logic.js');
const D = await loadSrc('src/agent/packs/mining/dig.js');
const B = await loadSrc('src/agent/packs/mining/bag.js');
const M = await loadSrc('src/agent/packs/mining/mining.js');

const FOODS = { bread: true, cooked_beef: true, apple: true };

describe('F11: isMineChestKind', () => {
    test('the kinds of the mining', () => {
        for (const name of ['iron_ore', 'deepslate_iron_ore', 'coal_ore', 'nether_quartz_ore', 'ancient_debris', 'raw_iron', 'raw_copper', 'raw_gold',
            'coal', 'redstone', 'lapis_lazuli', 'diamond', 'emerald', 'amethyst_shard', 'quartz', 'cobblestone', 'cobbled_deepslate', 'stone', 'deepslate',
            'andesite', 'diorite', 'granite', 'tuff', 'calcite', 'blackstone', 'netherrack', 'sandstone', 'gravel', 'flint', 'dirt', 'sand', 'red_sand',
            'clay_ball', 'clay', 'minecraft:cobblestone']) {
            assert.equal(L.isMineChestKind(name), true, name);
        }
    });

    test('not the kinds of the bag: saplings, seeds, the bed, the table, wood, food, tools, torches, ladders', () => {
        for (const name of ['oak_sapling', 'wheat_seeds', 'red_bed', 'crafting_table', 'oak_log', 'oak_planks', 'stick', 'bread', 'cooked_beef',
            'iron_pickaxe', 'iron_axe', 'shears', 'torch', 'ladder', 'chest', 'string', 'bone', 'rotten_flesh', 'charcoal', 'iron_ingot', '', null]) {
            assert.equal(L.isMineChestKind(name), false, String(name));
        }
    });

    test('the fillers are the copy of FILLERS of dig.js; mineChestKinds lists the bag\'s kinds once, by name', () => {
        assert.deepEqual([...L.MINE_CHEST_FILLERS], [...D.FILLERS]);
        const bag = [{ name: 'oak_sapling', count: 3 }, { name: 'red_bed', count: 1 }, { name: 'raw_iron', count: 5 }, { name: 'cobblestone', count: 40 },
            { name: 'cobblestone', count: 24 }, { name: 'gravel', count: 0 }, { name: 'minecraft:flint', count: 2 }, { name: 'bread', count: 4 }];
        assert.deepEqual(L.mineChestKinds(bag), ['cobblestone', 'flint', 'raw_iron']);
        assert.deepEqual(L.mineChestKinds([]), []);
        assert.deepEqual(L.mineChestKinds(null), []);
    });

    test('bag_logic.js stays pure', async () => {
        const { assertImportRules } = await import('../helpers/module_rules.js');
        assertImportRules('src/agent/packs/mining/bag_logic.js', { allowBuiltins: [], allowedRelative: [] });
    });
});

describe('F11: depositAtBase stores the mining\'s kinds only', () => {
    test('a bag with saplings, a bed and raw iron after a coal trip: raw iron and cobblestone go into the chest, the saplings and the bed stay', async () => {
        const world = makeWorld();
        const chest = { x: 0, y: 64, z: 2 };
        world.set(chest.x, chest.y, chest.z, 'chest');
        const bot = makeMiningBot({ world, pos: [0.5, 64, 1.5] });
        const clock = makeClock(bot);
        const ctx = await makeCtx(clock);
        give(bot, 'iron_pickaxe', 1);
        give(bot, 'raw_iron', 3);
        give(bot, 'cobblestone', 64);
        give(bot, 'coal', 7);
        give(bot, 'oak_sapling', 2);
        give(bot, 'red_bed', 1);
        give(bot, 'wheat_seeds', 5);
        give(bot, 'bread', 4);
        give(bot, 'torch', 10);
        const calls = [];
        ctx.storage = {
            async storeItems(b, c, options) {
                calls.push(options);
                return { ok: true, reason: null, stored: { raw_iron: 3, cobblestone: 32 }, left: {}, chests: [options.chest], text: 'I stored 3 raw_iron and 32 cobblestone.' };
            },
        };
        const mine = {
            name: 'mine', source: 'player', ore: 'coal', entrance: { x: 0, y: 66, z: 1 }, level: 64, base: null, chest: null, direction: null, length: 0,
            shaft: 'ladder', dimension: 'overworld', end: null, tunnel: [], route: [], room: { center: { x: 0, y: 64, z: 1 }, chest, table: null, furnace: null },
            tunnels: [], passed: [],
        };
        const r = await M.depositAtBase(bot, ctx, { now: clock.now, wait: clock.wait, mine, keep: { coal: -1 } });
        assert.equal(r.ok, true, r.text);
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0].only, ['coal', 'cobblestone', 'raw_iron'], 'only the kinds of the mining are offered');
        assert.equal(calls[0].keep.coal, -1, 'the ore of the trip is kept, as before');
        assert.ok(Number.isFinite(calls[0].keep.cobblestone), 'the cobblestone of the trip is kept up to its number, as before');
        for (const name of ['oak_sapling', 'red_bed', 'wheat_seeds', 'bread', 'torch', 'iron_pickaxe']) {
            assert.ok(!calls[0].only.includes(name), `${name} is not offered`);
        }
        assert.deepEqual(r.stored, { raw_iron: 3, cobblestone: 32 });
    });

    test('a bag with no kind of the mining (saplings, a bed, food, tools): nothing is offered to the chest, nothing is stored', async () => {
        // an empty `only` would let keepPlan of the storage pack store every kind that is not kept: depositAtBase stores nothing then
        const world = makeWorld();
        const chest = { x: 0, y: 64, z: 2 };
        world.set(chest.x, chest.y, chest.z, 'chest');
        const bot = makeMiningBot({ world, pos: [0.5, 64, 1.5] });
        const clock = makeClock(bot);
        const ctx = await makeCtx(clock);
        give(bot, 'iron_pickaxe', 1);
        give(bot, 'oak_sapling', 2);
        give(bot, 'red_bed', 1);
        give(bot, 'bread', 4);
        const calls = [];
        ctx.storage = {
            async storeItems(b, c, options) {
                calls.push(options);
                return { ok: true, reason: null, stored: { oak_sapling: 2, red_bed: 1 }, left: {}, chests: [options.chest], text: 'I stored 2 oak_sapling and 1 red_bed.' };
            },
        };
        const mine = {
            name: 'mine', source: 'player', ore: 'coal', entrance: { x: 0, y: 66, z: 1 }, level: 64, base: null, chest: null, direction: null, length: 0,
            shaft: 'ladder', dimension: 'overworld', end: null, tunnel: [], route: [], room: { center: { x: 0, y: 64, z: 1 }, chest, table: null, furnace: null },
            tunnels: [], passed: [],
        };
        const r = await M.depositAtBase(bot, ctx, { now: clock.now, wait: clock.wait, mine, keep: { coal: -1 } });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(calls, [], 'the storage is not asked');
        assert.deepEqual(r.stored, {});
        assert.equal(r.text, 'At the base of the mine: I stored nothing.');
    });
});

describe('F11: storeFullBag stores the mining\'s kinds first', () => {
    const CHEST = { x: 0, y: 41, z: 2 };
    function scene({ bag, freeAfterFirst = 0 }) {
        const said = [];
        const calls = [];
        let free = 0;
        const bot = {
            registry: { foodsByName: FOODS },
            entity: { position: { x: 0.5, y: 41, z: 0.5 } },
            inventory: { items: () => bag.filter(i => i.count > 0), emptySlotCount: () => free },
            blockAt: (p) => (p.x === CHEST.x && p.y === CHEST.y && p.z === CHEST.z ? { name: 'chest' } : { name: 'stone' }),
        };
        const storage = {
            storeItems: async (b, ctx, options) => {
                calls.push(options);
                const stored = {};
                for (const name of options.only) {
                    stored[name] = bag.filter(i => i.name === name).reduce((s, i) => s + i.count, 0);
                }
                free = freeAfterFirst; // after the first store the bag has this many free slots
                return { ok: true, reason: null, stored, left: {}, chests: [options.chest] };
            },
        };
        const ctx = { storage, say: (t) => said.push(t) };
        return { bot, ctx, said, calls };
    }
    const mine = { room: { center: { x: 2, y: 41, z: 0 }, chest: CHEST } };
    const row = { item: 'raw_iron', ore: 'iron' };
    const BAG = () => [{ name: 'iron_pickaxe', count: 1 }, { name: 'torch', count: 64 }, { name: 'raw_iron', count: 2 }, { name: 'gravel', count: 2 },
        { name: 'cobblestone', count: 4 }, { name: 'oak_sapling', count: 3 }, { name: 'red_bed', count: 1 }];

    test('still full after the mining\'s kinds: the rest goes in a second store', async () => {
        const s = scene({ bag: BAG(), freeAfterFirst: 0 });
        const r = await B.storeFullBag(s.bot, s.ctx, mine, row, { mined: 2, wanted: 6 });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(s.calls.map(c => c.only), [['gravel', 'cobblestone'], ['oak_sapling', 'red_bed']], 'the mining\'s kinds first, then the rest');
        assert.deepEqual(r.stored, { gravel: 2, cobblestone: 4, oak_sapling: 3, red_bed: 1 });
    });

    test('room again after the mining\'s kinds: the saplings and the bed stay in the bag', async () => {
        const s = scene({ bag: BAG(), freeAfterFirst: 2 });
        const r = await B.storeFullBag(s.bot, s.ctx, mine, row, { mined: 2, wanted: 6 });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(s.calls.map(c => c.only), [['gravel', 'cobblestone']]);
        assert.deepEqual(r.stored, { gravel: 2, cobblestone: 4 });
        assert.deepEqual(s.said, ['I stored 4 cobblestone and 2 gravel in the chest at (0, 41, 2) and go on.']);
    });

    test('only other kinds to store: one store of them, as before', async () => {
        const s = scene({ bag: [{ name: 'iron_pickaxe', count: 1 }, { name: 'raw_iron', count: 2 }, { name: 'oak_sapling', count: 3 }], freeAfterFirst: 0 });
        const r = await B.storeFullBag(s.bot, s.ctx, mine, row, { mined: 2, wanted: 6 });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(s.calls.map(c => c.only), [['oak_sapling']]);
    });
});
