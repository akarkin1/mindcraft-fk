// Spec v0.1.4.13, 4.4 P2 (part P, engineer E3): before each dig the pack reads the uses left of the tool in hand; at
// 10 or fewer a replacement from the bag is equipped, else crafted from carried material, with the texts of the
// spec; when nothing can be made the stop text of P2 comes first, then the old stop text; the old pickaxe stays.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeMiningBot, makeClock, makeCtx, give, count } from './mining_fake_bot.test.js';

const D = await loadSrc('src/agent/packs/mining/dig.js');
const T = await loadSrc('src/agent/packs/mining/texts.js');
const M = await loadSrc('src/agent/packs/mining/mining.js');
const P = await loadSrc('src/agent/packs/mining/index.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

async function scene({ world = makeWorld(), pos = [0.5, 64, 0.5] } = {}) {
    const bot = makeMiningBot({ world, pos });
    const clock = makeClock(bot);
    const ctx = await makeCtx(clock);
    const said = [];
    ctx.say = t => said.push(t);
    return { world, bot, clock, ctx, said, opts: { now: clock.now, wait: clock.wait } };
}

function kit(bot, { used = 0 } = {}) {
    give(bot, 'iron_pickaxe', 1, { used });
    give(bot, 'ladder', 64);
    give(bot, 'cobblestone', 64);
    give(bot, 'torch', 16);
    give(bot, 'bread', 8);
    give(bot, 'chest', 2);
}

describe('P2: the wear rule, pure', () => {
    test('wornTool at 11, 10 and 0 uses; other items', () => {
        const pick = (used) => ({ name: 'iron_pickaxe', maxDurability: 250, durabilityUsed: used });
        assert.equal(D.wornTool(pick(239)), null, '11 uses left');
        assert.deepEqual(D.wornTool(pick(240)), { name: 'iron_pickaxe', uses: 10 });
        assert.deepEqual(D.wornTool(pick(250)), { name: 'iron_pickaxe', uses: 0 });
        assert.deepEqual(D.wornTool(pick(242)), { name: 'iron_pickaxe', uses: 8 });
        assert.equal(D.wornTool({ name: 'iron_axe', maxDurability: 250, durabilityUsed: 249 }), null, 'an axe is no pickaxe');
        assert.equal(D.wornTool({ name: 'iron_pickaxe' }), null, 'a new one without durability');
        assert.equal(D.wornTool(null), null);
        assert.equal(D.WEAR_LIMIT, 10);
        assert.equal(P.WEAR_LIMIT, 10);
    });

    test('fitsBlock: the harvest tools of the block', () => {
        assert.equal(D.fitsBlock({ name: 'stone' }, { type: 1 }), true, 'no harvest tools: any tool');
        assert.equal(D.fitsBlock({ name: 'diamond_ore', harvestTools: { 721: true, 757: true } }, { type: 721 }), true);
        assert.equal(D.fitsBlock({ name: 'diamond_ore', harvestTools: { 721: true } }, { type: 3 }), false);
        assert.equal(D.fitsBlock({ name: 'diamond_ore', harvestTools: { 721: true } }, {}), false);
    });

    test('the two texts of the spec, word for word', () => {
        assert.equal(T.wornMadeText('iron_pickaxe', 8), 'My iron_pickaxe is nearly worn: 8 uses left. I made a new one.');
        assert.equal(T.wornStopText('iron_pickaxe', 8, 7, 28, 'diamond'),
            'My iron_pickaxe is nearly worn: 8 uses left. I have no iron for a new one. I stop the mining at 7 of 28 diamond.');
        assert.equal(T.wornStopText('stone_pickaxe', 3, 0, 6, 'iron'), 'My stone_pickaxe is nearly worn: 3 uses left. I have no stone for a new one. I stop the mining at 0 of 6 iron.');
        assert.equal(T.wornSpareText('iron_pickaxe', 10), 'My iron_pickaxe is nearly worn: 10 uses left. I take my spare one.');
        assert.equal(T.STOP_REASONS.worn, 'my pickaxe is nearly worn');
    });
});

describe('P2: digBlock reads the uses before the dig', () => {
    test('at 11 uses it digs; at 10 with no other pickaxe it does not dig and answers worn; the pickaxe stays in the bag', async () => {
        const { bot, clock } = await scene();
        const pick = give(bot, 'iron_pickaxe', 1, { used: 239 });
        let r = await D.digBlock(bot, { x: 2, y: 63, z: 0 }, { clock });
        assert.equal(r.ok, true);
        assert.equal(pick.durabilityUsed, 240, 'one use spent');
        r = await D.digBlock(bot, { x: 3, y: 63, z: 0 }, { clock });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'worn');
        assert.deepEqual(r.worn, { name: 'iron_pickaxe', uses: 10 });
        assert.equal(r.dug, 0);
        assert.equal(bot.world.nameAt(3, 63, 0), 'grass_block', 'not dug');
        assert.equal(count(bot, 'iron_pickaxe'), 1, 'kept');
        const c = await D.digClear(bot, { x: 3, y: 63, z: 0 }, { clock });
        assert.equal(c.reason, 'worn');
        assert.deepEqual(c.worn, { name: 'iron_pickaxe', uses: 10 });
    });

    test('at 10 uses with a spare that has more: the spare is equipped and digs; the worn one stays', async () => {
        const { bot, clock } = await scene();
        give(bot, 'iron_pickaxe', 1, { used: 240 });
        const spare = give(bot, 'stone_pickaxe', 1, { used: 20 });
        const r = await D.digBlock(bot, { x: 2, y: 63, z: 0 }, { clock });
        assert.equal(r.ok, true, r.reason);
        assert.equal(bot.heldItem, spare);
        assert.equal(spare.durabilityUsed, 21);
        assert.equal(count(bot, 'iron_pickaxe'), 1);
        assert.equal(count(bot, 'stone_pickaxe'), 1);
    });

    test('a spare that is nearly worn too does not count', async () => {
        const { bot, clock } = await scene();
        give(bot, 'iron_pickaxe', 1, { used: 245 });
        give(bot, 'stone_pickaxe', 1, { used: 125 }); // 6 left
        const r = await D.digBlock(bot, { x: 2, y: 63, z: 0 }, { clock });
        assert.equal(r.reason, 'worn');
    });
});

describe('P2: replaceWornPickaxe and the trip', () => {
    test('crafted from carried material: ensureTool with no chest and no surface, the made text said, the old one kept', async () => {
        const s = await scene();
        give(s.bot, 'iron_pickaxe', 1, { used: 242 });
        give(s.bot, 'iron_ingot', 3);
        give(s.bot, 'stick', 2);
        const asked = [];
        s.ctx.tools = {
            async ensureTool(b, c, kind, material, options) {
                asked.push({ kind, material, options, storage: c.storage, chests: c.chests });
                give(b, 'iron_pickaxe', 1);
                return { ok: true, text: 'I crafted an iron_pickaxe.' };
            },
        };
        const r = await M.replaceWornPickaxe(s.bot, s.ctx, P.oreOf('diamond'), { name: 'iron_pickaxe', uses: 8 }, { mined: 7, wanted: 28 });
        assert.equal(r.ok, true);
        assert.equal(r.text, 'My iron_pickaxe is nearly worn: 8 uses left. I made a new one.');
        assert.deepEqual(s.said, ['My iron_pickaxe is nearly worn: 8 uses left. I made a new one.']);
        assert.equal(asked.length, 1);
        assert.deepEqual([asked[0].kind, asked[0].material, asked[0].options.minUses, asked[0].options.collect], ['pickaxe', 'iron', 11, false]);
        assert.equal(asked[0].storage, null);
        assert.equal(asked[0].chests, null);
        assert.equal(count(s.bot, 'iron_pickaxe'), 2, 'the old one is kept');
        assert.equal(D.usesLeftOf(s.bot.heldItem), 250, 'the new one in hand');
    });

    test('nothing can be made: the stop text of the spec, said and returned; without the tools pack the same', async () => {
        const s = await scene();
        give(s.bot, 'iron_pickaxe', 1, { used: 242 });
        s.ctx.tools = { async ensureTool() { return { ok: false, reason: 'missing', text: 'I need 3 iron_ingot for an iron_pickaxe and have 0.' }; } };
        const r = await M.replaceWornPickaxe(s.bot, s.ctx, P.oreOf('diamond'), { name: 'iron_pickaxe', uses: 8 }, { mined: 7, wanted: 28 });
        assert.equal(r.ok, false);
        assert.equal(r.text, 'My iron_pickaxe is nearly worn: 8 uses left. I have no iron for a new one. I stop the mining at 7 of 28 diamond.');
        assert.deepEqual(s.said, [r.text]);
        delete s.ctx.tools;
        const r2 = await M.replaceWornPickaxe(s.bot, s.ctx, P.oreOf('diamond'), { name: 'iron_pickaxe', uses: 8 }, { mined: 7, wanted: 28 });
        assert.equal(r2.ok, false);
    });

    test('a spare in the bag: taken, with its text', async () => {
        const s = await scene();
        give(s.bot, 'iron_pickaxe', 1, { used: 240 });
        const spare = give(s.bot, 'iron_pickaxe', 1, { used: 0 });
        const r = await M.replaceWornPickaxe(s.bot, s.ctx, P.oreOf('iron'), { name: 'iron_pickaxe', uses: 10 }, { mined: 0, wanted: 6 });
        assert.equal(r.ok, true);
        assert.equal(r.text, 'My iron_pickaxe is nearly worn: 10 uses left. I take my spare one.');
        assert.equal(s.bot.heldItem, spare);
    });

    test('the trip: the pickaxe at 55 uses (no spare wanted), 3 iron ingots and 2 sticks in the bag: at 10 uses a new one is made, the mining goes on, no "nearly broken"', async () => {
        const world = makeWorld();
        world.set(1, 56, -5, 'coal_ore').set(1, 57, -5, 'coal_ore').set(-1, 56, -8, 'coal_ore');
        const s = await scene({ world });
        kit(s.bot, { used: 195 }); // 55 uses left: the trip digs more than that
        give(s.bot, 'iron_ingot', 3);
        give(s.bot, 'stick', 2);
        const asked = [];
        s.ctx.tools = {
            async ensureTool(b, c, kind, material, options) {
                asked.push({ kind, material, options });
                b.take = null;
                b.inventory.list.find(i => i.name === 'iron_ingot').count -= 3;
                b.inventory.list.find(i => i.name === 'stick').count -= 2;
                give(b, 'iron_pickaxe', 1);
                return { ok: true, text: 'I crafted an iron_pickaxe.' };
            },
            async craftSupplies() { return { ok: false, text: '' }; },
        };
        s.ctx.storage = { async storeItems() { return { ok: true, reason: null, stored: {}, left: {}, text: 'I stored nothing.' }; } };
        const r = await M.mineOre(s.bot, s.ctx, 'coal', 3, { ...s.opts, newMine: true });
        assert.equal(r.ok, true, r.text);
        assert.equal(r.mined, 3);
        assert.equal(asked.length, 1, 'one craft');
        assert.equal(asked[0].options.collect, false);
        assert.ok(s.said.some(t => /^My iron_pickaxe is nearly worn: (10|9|8|7|6|5|4|3|2|1|0) uses left\. I made a new one\.$/.test(t)), s.said.join(' | '));
        assert.equal(count(s.bot, 'iron_pickaxe'), 2, 'the old one and the new one');
        assert.doesNotMatch(r.text, /nearly broken/);
    });

    test('the trip: nothing to make a pickaxe from: the stop text of P2 first, then the old stop text with the count', async () => {
        const world = makeWorld();
        const s = await scene({ world });
        kit(s.bot, { used: 238 });
        s.ctx.tools = {
            async ensureTool() { return { ok: false, reason: 'missing', text: 'I need 3 iron_ingot for an iron_pickaxe and have 0.' }; },
            async craftSupplies() { return { ok: false, text: '' }; },
        };
        const r = await M.mineOre(s.bot, s.ctx, 'coal', 3, { ...s.opts, newMine: true });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'pickaxe');
        const stop = s.said.findIndex(t => t === 'My iron_pickaxe is nearly worn: 10 uses left. I have no iron for a new one. I stop the mining at 0 of 3 coal.');
        assert.ok(stop >= 0, s.said.join(' | '));
        assert.match(r.text, /^I mined 0 coal of 3\. I stopped because my pickaxe is nearly broken\./);
        assert.equal(count(s.bot, 'iron_pickaxe'), 1, 'not thrown');
        assert.equal(D.usesLeftOf(s.bot.inventory.list.find(i => i.name === 'iron_pickaxe')), 10, 'not used below the limit');
    });
});
