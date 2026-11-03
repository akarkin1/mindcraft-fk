// v0.1.4.13 fix 2: the hang of the play of 2026-10-06. Mining iron in the deep mine, the bot carried a worn iron
// pickaxe (9 uses) and a fresh stone one; the next block needed iron (deepslate diamond ore). The dig answered worn,
// the replacement put the worn iron one back in hand ("I take my spare one."), and that repeated 55 times a second.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeMiningBot, makeClock, makeCtx, give } from './mining_fake_bot.test.js';

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

// iron (used 241: 9 uses left) in hand, a fresh stone pickaxe in the bag; the block at (2, 63, 0) needs iron
async function scene({ ironUsed = 241 } = {}) {
    const world = makeWorld();
    world.set(2, 63, 0, 'deepslate_diamond_ore');
    const bot = makeMiningBot({ world, pos: [0.5, 64, 0.5] });
    const clock = makeClock(bot);
    const ctx = await makeCtx(clock);
    const said = [];
    ctx.say = t => said.push(t);
    const iron = give(bot, 'iron_pickaxe', 1, { used: ironUsed });
    const stone = give(bot, 'stone_pickaxe', 1, { used: 0 });
    const plain = bot.blockAt;
    bot.blockAt = (p) => {
        const b = plain(p);
        if (b && b.name === 'deepslate_diamond_ore')
            b.harvestTools = { [iron.type]: true };
        return b;
    };
    await bot.equip(iron, 'hand');
    return { world, bot, clock, ctx, said, iron, stone };
}

describe('fix 2: a block only the worn pickaxe breaks', () => {
    test('the worn iron one digs it while it has more than 1 use; the stone one stays fresh', async () => {
        const s = await scene();
        const r = await D.digBlock(s.bot, { x: 2, y: 63, z: 0 }, { clock: s.clock });
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.equal(s.iron.durabilityUsed, 242, 'one use of the iron pickaxe');
        assert.equal(s.world.nameAt(2, 63, 0), 'air');
    });

    test('with 1 use left it answers worn: one dig would break it', async () => {
        const s = await scene({ ironUsed: 249 });
        const r = await D.digBlock(s.bot, { x: 2, y: 63, z: 0 }, { clock: s.clock });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'worn');
        assert.equal(s.world.nameAt(2, 63, 0), 'deepslate_diamond_ore');
    });

    test('a stone block: the fresh stone pickaxe digs it, not the worn iron one', async () => {
        const s = await scene();
        s.world.set(3, 63, 0, 'stone');
        const r = await D.digBlock(s.bot, { x: 3, y: 63, z: 0 }, { clock: s.clock });
        assert.equal(r.ok, true);
        assert.equal(s.bot.heldItem, s.stone);
        assert.equal(s.iron.durabilityUsed, 241);
    });
});

describe('fix 2: the replacement puts a fresh pickaxe in hand or says it failed', () => {
    test('equipPickaxe: a fresh stone pickaxe before a worn iron one', async () => {
        const s = await scene();
        const held = await D.equipPickaxe(s.bot, 'stone');
        assert.equal(held, s.stone);
        assert.equal(s.bot.heldItem, s.stone);
    });

    test('replaceWornPickaxe for iron ore: the stone one in hand, with the spare text', async () => {
        const s = await scene();
        const r = await M.replaceWornPickaxe(s.bot, s.ctx, P.oreOf('iron'), { name: 'iron_pickaxe', uses: 9 }, { mined: 0, wanted: 4 });
        assert.equal(r.ok, true);
        assert.equal(r.text, 'My iron_pickaxe is nearly worn: 9 uses left. I take my spare one.');
        assert.equal(s.bot.heldItem, s.stone);
        assert.equal(D.wornTool(s.bot.heldItem), null);
    });

    test('the loop text', () => {
        assert.equal(T.wornLoopText('iron_pickaxe', 2, 4, 'iron'),
            'I cannot go on: my iron_pickaxe is nearly worn and no other pickaxe breaks the next block. I stop the mining at 2 of 4 iron.');
    });
});
