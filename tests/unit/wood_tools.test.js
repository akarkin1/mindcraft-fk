// Spec v0.1.4.7 T4: src/agent/packs/wood/tools.js (ensureTool, craftSupplies) on the fake bot, and
// inventory.js (the uses left of a tool).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { count, fakeCraftRecipe, give, makeClock, makeWoodBot, makeWorld, plantTree } from './wood_fake_bot.test.js';

const K = await loadSrc('src/agent/packs/wood/tools.js');
const I = await loadSrc('src/agent/packs/wood/inventory.js');

function scene({ pos = [0.5, 64, 0.5], areas = [], storage = null, chests = null, wood = undefined } = {}) {
    const world = makeWorld();
    const bot = makeWoodBot({ world, pos });
    const clock = makeClock();
    const lines = [];
    const ctx = { areas, log: (t) => lines.push(t), now: clock.now, skills: { craftRecipe: fakeCraftRecipe(bot) } };
    if (storage) ctx.storage = storage;
    if (chests) ctx.chests = chests;
    if (wood !== undefined) ctx.wood = wood;
    return { world, bot, ctx, clock, lines, opts: { now: clock.now, wait: clock.wait } };
}

// F32c: one craft per call, so the same item repeats; the steps are what the tests compare
const crafts = (bot) => bot.calls.filter(c => c[0] === 'craft').map(c => c[1]).filter((x, i, a) => i === 0 || a[i - 1] !== x);

/** A little rock of stone on the grass: 6 blocks with faces in the air. */
function rock(world, x, z) {
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 2; dy++) world.set(x + dx, 64 + dy, z, 'stone');
}

/** A storage of chests in memory: fetchItem gives what the chests hold. */
function fakeStorage(bot, holds) {
    const calls = [];
    return {
        calls,
        async fetchItem(b, ctx, name, n = 1) {
            calls.push([name, n]);
            const k = Math.min(holds[name] ?? 0, n);
            if (k > 0) {
                give(bot, name, k);
                holds[name] -= k;
            }
            return { ok: k > 0, taken: k, text: k > 0 ? `I took ${k} ${name}.` : `I know no chest with ${name}.` };
        },
    };
}

describe('inventory', () => {
    test('uses left from the durability of the item', () => {
        assert.equal(I.itemUsesLeft({ name: 'stone_pickaxe', maxDurability: 131, durabilityUsed: 31 }), 100);
        assert.equal(I.itemUsesLeft({ name: 'stone_pickaxe', maxDurability: 131, durabilityUsed: null }), 131);
        assert.equal(I.itemUsesLeft({ name: 'stone_pickaxe', maxDurability: 131, get durabilityUsed() { throw new Error('x'); } }), 131);
        assert.equal(I.itemUsesLeft({ name: 'dirt' }), null);
        const world = makeWorld();
        const bot = makeWoodBot({ world });
        give(bot, 'iron_pickaxe', 1, { used: 200 });
        give(bot, 'dirt', 5);
        assert.deepEqual(I.inventoryOf(bot).map(i => [i.name, i.count, i.uses_left]), [['iron_pickaxe', 1, 50], ['dirt', 5, null]]);
        assert.equal(I.countItems(bot, n => n.endsWith('_pickaxe')), 1);
        assert.equal(I.findItem(bot, 'dirt').count, 5);
        assert.equal(I.findItem(bot, { name: 'dirt', slot: 999 }).count, 5);
        assert.deepEqual(I.inventoryOf({ inventory: { items() { throw new Error('x'); } } }), []);
        assert.deepEqual(I.itemCounts(null), {});
    });
});

describe('ensureTool', () => {
    test('a tool of the kind that is good enough: I have it', async () => {
        const { bot, ctx, opts } = scene();
        give(bot, 'stone_pickaxe', 1);
        assert.deepEqual(await K.ensureTool(bot, ctx, 'pickaxe', '', opts),
            { ok: true, reason: null, tool: 'stone_pickaxe', crafted: [], text: 'I have a stone_pickaxe.' });
        assert.equal((await K.ensureTool(bot, ctx, 'pickaxe', 'stone', opts)).text, 'I have a stone_pickaxe.');
        assert.deepEqual(crafts(bot), []);
    });

    test('logs in the inventory: planks, sticks, a table, the tool', async () => {
        const { bot, ctx, opts, lines } = scene();
        give(bot, 'birch_log', 3);
        const res = await K.ensureTool(bot, ctx, 'pickaxe', '', opts);
        assert.deepEqual({ ok: res.ok, tool: res.tool, crafted: res.crafted, text: res.text },
            { ok: true, tool: 'wooden_pickaxe', crafted: ['wooden_pickaxe'], text: 'I crafted a wooden_pickaxe.' });
        assert.deepEqual(crafts(bot), ['birch_planks', 'stick', 'crafting_table', 'wooden_pickaxe']);
        assert.equal(count(bot, 'wooden_pickaxe'), 1);
        assert.equal(lines[lines.length - 1], res.text);
    });

    test('the best tool the inventory allows: cobblestone and logs make a stone pickaxe', async () => {
        const { bot, ctx, opts } = scene();
        give(bot, 'oak_log', 3);
        give(bot, 'cobblestone', 3);
        const res = await K.ensureTool(bot, ctx, 'pickaxe', '', opts);
        assert.equal(res.text, 'I crafted a stone_pickaxe.');
    });

    test('a bot with nothing asked for stone: cuts a tree, a wooden pickaxe, breaks stone, a stone pickaxe', async () => {
        const { world, bot, ctx, opts } = scene();
        plantTree(world, { x: 8, z: 0 });
        rock(world, -6, 4);
        give(bot, 'oak_sapling', 1);
        const res = await K.ensureTool(bot, ctx, 'pickaxe', 'stone', opts);
        assert.equal(res.text, 'I crafted a wooden_pickaxe and a stone_pickaxe.');
        assert.deepEqual(res.crafted, ['wooden_pickaxe', 'stone_pickaxe']);
        assert.equal(res.tool, 'stone_pickaxe');
        assert.equal(count(bot, 'stone_pickaxe'), 1);
        const stoneDug = bot.calls.filter(c => c[0] === 'dig' && c[2] >= 64 && c[1] >= -6 && c[1] <= -4 && c[3] === 4).length;
        assert.equal(stoneDug, 3);
    });

    test('logs come from ctx.wood.chopTrees', async () => {
        const calls = [];
        const s = scene({
            wood: {
                chopTrees: async (b, c, n) => {
                    calls.push(n);
                    give(b, 'spruce_log', 5);
                    return { ok: true, text: 'I cut 1 spruce tree and got 5 spruce_log.' };
                },
            },
        });
        const res = await K.ensureTool(s.bot, s.ctx, 'axe', '', s.opts);
        assert.deepEqual(calls, [3]);
        assert.equal(res.text, 'I crafted a wooden_axe.');
        assert.ok(crafts(s.bot).includes('spruce_planks'));
    });

    test('no tree: the text says what is missing and why', async () => {
        const { bot, ctx, opts } = scene();
        const res = await K.ensureTool(bot, ctx, 'sword', '', opts);
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'missing');
        assert.equal(res.text, 'I need 2 oak_log for a wooden_sword and have none. I found no tree within 48 blocks. Logs of buildings are not mine to take.');
    });

    test('no stone nearby: the wooden pickaxe was made, the stone one not', async () => {
        const { world, bot, ctx, opts } = scene();
        plantTree(world, { x: 8, z: 0 });
        const res = await K.ensureTool(bot, ctx, 'pickaxe', 'stone', opts);
        assert.equal(res.ok, false);
        assert.deepEqual(res.crafted, ['wooden_pickaxe']);
        assert.equal(res.text, 'I crafted a wooden_pickaxe. I need 3 cobblestone for a stone_pickaxe and have none. I found no stone within 16 blocks that I may break.');
    });

    test('stone in a protected area is not broken', async () => {
        const { world, bot, ctx, opts } = scene({ areas: [{ name: 'home', min: { x: -10, y: 60, z: 2 }, max: { x: -2, y: 70, z: 8 } }] });
        rock(world, -6, 4);
        give(bot, 'wooden_pickaxe', 1);
        give(bot, 'oak_log', 1);
        const res = await K.ensureTool(bot, ctx, 'pickaxe', 'stone', opts);
        assert.match(res.text, /I found no stone within 16 blocks that I may break\.$/);
        assert.equal(bot.calls.filter(c => c[0] === 'dig').length, 0);
    });

    test('iron: it does not smelt or mine; it looks into chests first', async () => {
        const storage = fakeStorage(null, {});
        const s = scene({ storage });
        give(s.bot, 'iron_ingot', 1);
        give(s.bot, 'oak_log', 2);
        const res = await K.ensureTool(s.bot, s.ctx, 'pickaxe', 'iron', s.opts);
        assert.equal(res.text, 'I need 3 iron_ingot for an iron_pickaxe and have 1.');
        assert.deepEqual(storage.calls, [['iron_ingot', 2]]);
    });

    test('what the chests hold is taken instead of collected', async () => {
        const s = scene();
        const storage = fakeStorage(s.bot, { iron_ingot: 5, birch_log: 4 });
        s.ctx.storage = storage;
        s.ctx.chests = { list: () => [{ x: 1, y: 64, z: 1, items: { birch_log: 4, cobblestone: 9 } }] };
        s.ctx.wood = { chopTrees: async () => { throw new Error('must not cut trees'); } };
        const res = await K.ensureTool(s.bot, s.ctx, 'pickaxe', 'iron', s.opts);
        assert.equal(res.text, 'I crafted an iron_pickaxe.');
        assert.deepEqual(storage.calls.map(c => c[0]), ['iron_ingot', 'birch_log']);
    });

    test('the kind and the material are understood or refused', async () => {
        const { bot, ctx, opts } = scene();
        give(bot, 'iron_axe', 1);
        assert.equal((await K.ensureTool(bot, ctx, 'iron_axe', '', opts)).text, 'I have an iron_axe.');
        assert.equal((await K.ensureTool(bot, ctx, 'axe', 'gold', opts)).text, 'I have an iron_axe.', 'golden means at least wood');
        const spoon = await K.ensureTool(bot, ctx, 'spoon', '', opts);
        assert.deepEqual([spoon.ok, spoon.reason, spoon.text], [false, 'unknown_kind', 'I do not know the tool "spoon". I know pickaxe, axe, shovel, hoe and sword.']);
        assert.equal((await K.ensureTool(bot, ctx, 'axe', 'mithril', opts)).reason, 'unknown_material');
        const nether = await K.ensureTool(bot, ctx, 'pickaxe', 'netherite', opts);
        assert.deepEqual([nether.reason, nether.text], ['not_craftable', 'I cannot craft a netherite_pickaxe. It is made at a smithing table, which I do not use.']);
    });

    test('a nearly broken tool and a second tool (options minUses and count, for mining)', async () => {
        const { bot, ctx, opts } = scene();
        give(bot, 'stone_pickaxe', 1, { used: 126 });
        give(bot, 'oak_log', 2);
        give(bot, 'cobblestone', 3);
        const res = await K.ensureTool(bot, ctx, 'pickaxe', 'stone', { ...opts, minUses: 10 });
        assert.equal(res.text, 'I crafted a stone_pickaxe.');
        assert.equal(count(bot, 'stone_pickaxe'), 2);
        give(bot, 'cobblestone', 3);
        const second = await K.ensureTool(bot, ctx, 'pickaxe', 'stone', { ...opts, count: 3 });
        assert.equal(second.text, 'I crafted a stone_pickaxe.');
        assert.equal((await K.ensureTool(bot, ctx, 'pickaxe', 'stone', { ...opts, count: 3 })).text, 'I have a stone_pickaxe.');
    });

    test('crafting fails or is missing', async () => {
        const a = scene();
        give(a.bot, 'oak_log', 3);
        a.ctx.skills = {};
        assert.deepEqual([(await K.ensureTool(a.bot, a.ctx, 'hoe', '', a.opts)).text], ['I cannot craft: the crafting skill is missing.']);
        const b = scene();
        give(b.bot, 'oak_log', 3);
        b.ctx.skills.craftRecipe = async () => false;
        const res = await K.ensureTool(b.bot, b.ctx, 'hoe', '', b.opts);
        assert.deepEqual([res.ok, res.reason, res.text], [false, 'craft_failed', 'I could not craft oak_planks.']);
        const c = scene();
        give(c.bot, 'oak_log', 3);
        c.ctx.skills.craftRecipe = async () => { throw new Error('boom'); };
        assert.equal((await K.ensureTool(c.bot, c.ctx, 'hoe', '', c.opts)).text, 'I could not craft oak_planks.');
    });

    test('an interrupt stops it; a broken bot gives a text', async () => {
        const { bot, ctx, opts } = scene();
        give(bot, 'oak_log', 3);
        bot.interrupt_code = true;
        const res = await K.ensureTool(bot, ctx, 'pickaxe', '', opts);
        assert.deepEqual([res.ok, res.reason], [false, 'interrupted']);
        const broken = await K.ensureTool({ get inventory() { throw new Error('gone'); }, get entity() { throw new Error('gone'); } }, ctx, 'pickaxe', '', opts);
        assert.equal(broken.ok, false);
    });
});

describe('craftSupplies', () => {
    test('ladders: the count is rounded up to what the recipe gives', async () => {
        const { bot, ctx, opts } = scene();
        give(bot, 'oak_log', 4);
        const res = await K.craftSupplies(bot, ctx, 'ladder', 8, opts);
        assert.deepEqual({ ok: res.ok, item: res.item, count: res.count, text: res.text }, { ok: true, item: 'ladder', count: 9, text: 'I made 9 ladders.' });
    });

    test('torches need coal or charcoal; the chests are asked first', async () => {
        const s = scene();
        s.ctx.storage = fakeStorage(s.bot, {});
        give(s.bot, 'oak_log', 1);
        const res = await K.craftSupplies(s.bot, s.ctx, 'torch', 8, s.opts);
        assert.deepEqual([res.ok, res.text], [false, 'I made 0 torches of 8. I need 2 coal more and know no chest with coal.']);
        assert.deepEqual(s.ctx.storage.calls, [['coal', 2]]);
        give(s.bot, 'coal', 1);
        give(s.bot, 'charcoal', 1);
        assert.equal((await K.craftSupplies(s.bot, s.ctx, 'torches', 8, s.opts)).text, 'I made 8 torches.');
    });

    test('wood is collected when it is missing', async () => {
        const { world, bot, ctx, opts } = scene();
        plantTree(world, { x: 8, z: 0 });
        const res = await K.craftSupplies(bot, ctx, 'chest', 1, opts);
        assert.equal(res.text, 'I made 1 chest.');
    });

    test('planks, sticks, a crafting table; unknown supplies', async () => {
        const { bot, ctx, opts } = scene();
        give(bot, 'birch_log', 3);
        assert.equal((await K.craftSupplies(bot, ctx, 'planks', 6, opts)).text, 'I made 8 birch_planks.');
        assert.equal((await K.craftSupplies(bot, ctx, 'sticks', 4, opts)).text, 'I made 4 sticks.');
        assert.equal((await K.craftSupplies(bot, ctx, 'crafting table', 1, opts)).text, 'I made 1 crafting_table.');
        const bad = await K.craftSupplies(bot, ctx, 'diamond_block', 1, opts);
        assert.deepEqual([bad.ok, bad.reason, bad.text], [false, 'unknown_item',
            'I cannot craft "diamond_block" with this command. I craft torch, ladder, chest, crafting_table, stick and planks.']);
        const none = await K.craftSupplies(bot, ctx, 'chest', 1, opts);
        assert.match(none.text, /^I made 0 chests of 1\. I need 1 birch_log more and know no chest with birch_log\. I found no tree/, 'fix round F32');
    });
});
