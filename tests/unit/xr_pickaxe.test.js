// The correction of 2026-10-04 (v0.1.4.13, the owner, no switch): the cheapest pickaxe that is enough. A worn
// pickaxe's replacement (replaceWornPickaxe) and the spare of the supply step (prepareMiningTrip) are crafted from
// the cheapest material that mines the ore of the trip (the `pickaxe` of its row of ore_table.js, at least stone):
// stone from carried cobblestone for stone, coal, copper, iron and lapis; iron for gold, redstone and diamond. Iron
// for an ore that needs only stone only when the bag holds more than 20 iron ingots and no cobblestone; never
// diamonds for an ore that needs less. Equipping a better pickaxe the bag already holds stays allowed. The texts
// stay those of P2. The fake ensureTool gives the pickaxe of the material it is asked for, so a test sees what
// was made.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeMiningBot, makeClock, makeCtx, give, count } from './mining_fake_bot.test.js';

const S = await loadSrc('src/agent/packs/mining/supply_logic.js');
const M = await loadSrc('src/agent/packs/mining/mining.js');
const P = await loadSrc('src/agent/packs/mining/index.js');
const D = await loadSrc('src/agent/packs/mining/dig.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

const inv = (pairs) => Object.entries(pairs).map(([name, n]) => ({ name, count: n }));

describe('pickaxeToCraft: the cheapest material that mines the ore, from what the bag holds', () => {
    test('stone ores (need stone): stone from 3 cobblestone, cobbled_deepslate or blackstone', () => {
        assert.equal(S.pickaxeToCraft('stone', inv({ cobblestone: 3, iron_ingot: 3 })), 'stone');
        assert.equal(S.pickaxeToCraft('stone', inv({ cobbled_deepslate: 5 })), 'stone');
        assert.equal(S.pickaxeToCraft('stone', inv({ blackstone: 1, cobblestone: 2 })), 'stone', 'the kinds add up');
        assert.equal(S.pickaxeToCraft('stone', inv({ cobblestone: 2, iron_ingot: 3 })), null, '2 cobblestone and 3 ingots: nothing');
    });

    test('a stone ore with a stash of iron: iron only above 20 ingots and without cobblestone', () => {
        assert.equal(S.pickaxeToCraft('stone', inv({ iron_ingot: 25 })), 'iron');
        assert.equal(S.pickaxeToCraft('stone', inv({ iron_ingot: 21 })), 'iron');
        assert.equal(S.pickaxeToCraft('stone', inv({ iron_ingot: 20 })), null, '20 is no stash');
        assert.equal(S.pickaxeToCraft('stone', inv({ iron_ingot: 25, cobblestone: 8 })), 'stone');
    });

    test('never diamonds for an ore that needs less', () => {
        assert.equal(S.pickaxeToCraft('stone', inv({ diamond: 30 })), null);
        assert.equal(S.pickaxeToCraft('iron', inv({ diamond: 30 })), null);
        assert.equal(S.pickaxeToCraft('iron', inv({ diamond: 30, iron_ingot: 3 })), 'iron');
        assert.equal(S.pickaxeToCraft('diamond', inv({ diamond: 3 })), 'diamond', 'only an ore that needs diamond');
    });

    test('ores that need iron: iron from 3 ingots, cobblestone does not help', () => {
        assert.equal(S.pickaxeToCraft('iron', inv({ iron_ingot: 3, cobblestone: 64 })), 'iron');
        assert.equal(S.pickaxeToCraft('iron', inv({ iron_ingot: 2, cobblestone: 64 })), null);
    });

    test('the trip material of each ore of the table', () => {
        const of = (ore, bag) => S.pickaxeToCraft(P.tripPickaxe(ore), bag);
        const bag = inv({ cobblestone: 8, iron_ingot: 3 });
        for (const ore of ['coal', 'copper', 'iron', 'lapis']) {
            assert.equal(of(ore, bag), 'stone', ore);
        }
        for (const ore of ['gold', 'redstone', 'diamond']) {
            assert.equal(of(ore, bag), 'iron', ore);
        }
    });

    test('no material, an unknown need, no inventory: null, no throw', () => {
        assert.equal(S.pickaxeToCraft('stone', []), null);
        assert.equal(S.pickaxeToCraft('netherite', inv({ cobblestone: 64 })), null);
        assert.equal(S.pickaxeToCraft('stone', null), null);
        assert.equal(S.pickaxeToCraft('stone', [null, { name: 'cobblestone' }, { name: 'cobblestone', count: 'x' }]), null);
    });
});

async function scene() {
    const world = makeWorld();
    const bot = makeMiningBot({ world, pos: [0.5, 64, 0.5] });
    const clock = makeClock(bot);
    const ctx = await makeCtx(clock);
    const said = [];
    ctx.say = t => said.push(t);
    const asked = [];
    ctx.tools = {
        async ensureTool(b, c, kind, material, options) {
            asked.push({ kind, material, options, storage: c.storage, chests: c.chests });
            const head = { stone: 'cobblestone', iron: 'iron_ingot', diamond: 'diamond' }[material];
            const item = b.inventory.list.find(i => i.name === head && i.count >= 3);
            if (!item) {
                return { ok: false, reason: 'missing', text: `I need 3 ${head}.` };
            }
            item.count -= 3;
            give(b, `${material}_pickaxe`, 1);
            return { ok: true, text: `I crafted a ${material}_pickaxe.` };
        },
        async craftSupplies() { return { ok: false, text: '' }; },
    };
    return { world, bot, clock, ctx, said, asked, opts: { now: clock.now, wait: clock.wait } };
}

const MADE = 'My iron_pickaxe is nearly worn: 8 uses left. I made a new one.';

describe('replaceWornPickaxe: the new one is the cheapest that mines the ore', () => {
    test('iron ore, cobblestone and 3 iron ingots in the bag: a stone pickaxe; the ingots and the worn iron one kept', async () => {
        const s = await scene();
        give(s.bot, 'iron_pickaxe', 1, { used: 242 });
        give(s.bot, 'cobblestone', 12);
        give(s.bot, 'iron_ingot', 3);
        give(s.bot, 'stick', 2);
        const r = await M.replaceWornPickaxe(s.bot, s.ctx, P.oreOf('iron'), { name: 'iron_pickaxe', uses: 8 }, { mined: 2, wanted: 6 });
        assert.equal(r.ok, true, r.text);
        assert.equal(r.text, MADE);
        assert.deepEqual(s.said, [MADE]);
        assert.equal(s.asked.length, 1);
        const a = s.asked[0];
        assert.deepEqual([a.kind, a.material, a.options.exact, a.options.collect, a.options.minUses, a.options.count], ['pickaxe', 'stone', true, false, 11, 1]);
        assert.equal(a.storage, null, 'no chest');
        assert.equal(a.chests, null);
        assert.equal(count(s.bot, 'stone_pickaxe'), 1, 'a new stone pickaxe');
        assert.equal(count(s.bot, 'iron_pickaxe'), 1, 'the worn iron one is kept');
        assert.equal(count(s.bot, 'iron_ingot'), 3, 'no ingot spent');
    });

    test('the dig after it uses the new stone pickaxe, not the worn iron one', async () => {
        const s = await scene();
        give(s.bot, 'iron_pickaxe', 1, { used: 242 });
        give(s.bot, 'cobblestone', 12);
        give(s.bot, 'stick', 2);
        await M.replaceWornPickaxe(s.bot, s.ctx, P.oreOf('iron'), { name: 'iron_pickaxe', uses: 8 }, { mined: 2, wanted: 6 });
        const r = await D.digBlock(s.bot, { x: 2, y: 63, z: 0 }, { clock: s.clock });
        assert.equal(r.ok, true, r.reason);
        assert.equal(s.bot.heldItem?.name, 'stone_pickaxe');
        assert.equal(D.usesLeftOf(s.bot.inventory.list.find(i => i.name === 'iron_pickaxe')), 8, 'the worn one is not used');
    });

    test('diamond with 3 iron ingots: an iron pickaxe', async () => {
        const s = await scene();
        give(s.bot, 'iron_pickaxe', 1, { used: 242 });
        give(s.bot, 'cobblestone', 12);
        give(s.bot, 'iron_ingot', 3);
        give(s.bot, 'stick', 2);
        const r = await M.replaceWornPickaxe(s.bot, s.ctx, P.oreOf('diamond'), { name: 'iron_pickaxe', uses: 8 }, { mined: 7, wanted: 28 });
        assert.equal(r.ok, true, r.text);
        assert.equal(r.text, MADE);
        assert.equal(s.asked[0].material, 'iron');
        assert.equal(s.asked[0].options.exact, true);
        assert.equal(count(s.bot, 'iron_pickaxe'), 2);
        assert.equal(count(s.bot, 'stone_pickaxe'), 0);
    });

    test('iron ore, 25 ingots and no cobblestone: an iron pickaxe', async () => {
        const s = await scene();
        give(s.bot, 'iron_pickaxe', 1, { used: 242 });
        give(s.bot, 'iron_ingot', 25);
        give(s.bot, 'stick', 2);
        const r = await M.replaceWornPickaxe(s.bot, s.ctx, P.oreOf('iron'), { name: 'iron_pickaxe', uses: 8 }, { mined: 2, wanted: 6 });
        assert.equal(r.ok, true, r.text);
        assert.equal(s.asked[0].material, 'iron');
        assert.equal(count(s.bot, 'iron_pickaxe'), 2);
        assert.equal(count(s.bot, 'iron_ingot'), 22);
    });

    test('iron ore, 25 ingots and cobblestone: a stone pickaxe', async () => {
        const s = await scene();
        give(s.bot, 'iron_pickaxe', 1, { used: 242 });
        give(s.bot, 'iron_ingot', 25);
        give(s.bot, 'cobblestone', 5);
        give(s.bot, 'stick', 2);
        const r = await M.replaceWornPickaxe(s.bot, s.ctx, P.oreOf('iron'), { name: 'iron_pickaxe', uses: 8 }, { mined: 2, wanted: 6 });
        assert.equal(r.ok, true, r.text);
        assert.equal(s.asked[0].material, 'stone');
        assert.equal(count(s.bot, 'stone_pickaxe'), 1);
        assert.equal(count(s.bot, 'iron_ingot'), 25);
    });

    test('nothing to craft from (5 ingots and 30 diamonds, no cobblestone, mining iron): the stop text, nothing crafted', async () => {
        const s = await scene();
        give(s.bot, 'iron_pickaxe', 1, { used: 242 });
        give(s.bot, 'iron_ingot', 5);
        give(s.bot, 'diamond', 30);
        give(s.bot, 'stick', 2);
        const r = await M.replaceWornPickaxe(s.bot, s.ctx, P.oreOf('iron'), { name: 'iron_pickaxe', uses: 8 }, { mined: 2, wanted: 6 });
        assert.equal(r.ok, false);
        assert.equal(r.text, 'My iron_pickaxe is nearly worn: 8 uses left. I have no stone for a new one. I stop the mining at 2 of 6 iron.');
        assert.deepEqual(s.said, [r.text]);
        assert.deepEqual(s.asked, [], 'ensureTool is not asked');
        assert.equal(count(s.bot, 'iron_ingot'), 5);
        assert.equal(count(s.bot, 'diamond'), 30);
    });

    test('nothing to craft from while mining diamond: the stop text of the spec', async () => {
        const s = await scene();
        give(s.bot, 'iron_pickaxe', 1, { used: 242 });
        give(s.bot, 'cobblestone', 64);
        give(s.bot, 'iron_ingot', 2);
        const r = await M.replaceWornPickaxe(s.bot, s.ctx, P.oreOf('diamond'), { name: 'iron_pickaxe', uses: 8 }, { mined: 7, wanted: 28 });
        assert.equal(r.ok, false);
        assert.equal(r.text, 'My iron_pickaxe is nearly worn: 8 uses left. I have no iron for a new one. I stop the mining at 7 of 28 diamond.');
        assert.deepEqual(s.asked, []);
    });

    test('a better pickaxe the bag holds is still equipped: a diamond pickaxe while mining iron, nothing crafted', async () => {
        const s = await scene();
        give(s.bot, 'iron_pickaxe', 1, { used: 242 });
        give(s.bot, 'diamond_pickaxe', 1);
        give(s.bot, 'cobblestone', 12);
        const r = await M.replaceWornPickaxe(s.bot, s.ctx, P.oreOf('iron'), { name: 'iron_pickaxe', uses: 8 }, { mined: 2, wanted: 6 });
        assert.equal(r.ok, true);
        assert.equal(r.text, 'My iron_pickaxe is nearly worn: 8 uses left. I take my spare one.');
        assert.equal(s.bot.heldItem?.name, 'diamond_pickaxe');
        assert.deepEqual(s.asked, []);
    });
});

describe('prepareMiningTrip: the spare is the cheapest that mines the ore', () => {
    const MINE = {
        ore: 'iron', entrance: { x: 0, y: 64, z: 0 }, level: 40, base: { x: 0, y: 40, z: -1 }, chest: null, direction: 'north', length: 2, shaft: 'ladder',
        dimension: 'overworld', end: { x: 0, y: 40, z: -3 }, tunnel: [{ x: 0, y: 40, z: -1 }, { x: 0, y: 40, z: -3 }],
        route: [{ kind: 'ladder', x: 0, z: 0, top: 63, bottom: 40, face: 'north', entry: { x: 0, y: 64, z: 1 } }],
    };

    async function trip(ore, extra) {
        const s = await scene();
        s.ctx.mines.set({ ...MINE, ore });
        give(s.bot, 'iron_pickaxe', 1, { used: 220 }); // 30 uses left: a spare is wanted
        give(s.bot, 'ladder', 64);
        give(s.bot, 'torch', 16);
        give(s.bot, 'chest', 2);
        give(s.bot, 'bread', 8);
        give(s.bot, 'stick', 4);
        for (const [name, n] of Object.entries(extra)) {
            give(s.bot, name, n);
        }
        const r = await M.prepareMiningTrip(s.bot, s.ctx, ore, { ...s.opts, mine: { ...MINE, ore }, level: 40, wayDownTo: 40, hasBase: true });
        return { s, r };
    }

    test('iron ore with cobblestone and 3 ingots: a stone spare, the text names no material', async () => {
        const { s, r } = await trip('iron', { cobblestone: 12, iron_ingot: 3 });
        assert.equal(r.ok, true, r.text);
        assert.equal(s.said[0], 'I get my supplies: a second pickaxe.');
        assert.equal(s.asked.length, 1);
        assert.deepEqual([s.asked[0].material, s.asked[0].options.count, s.asked[0].options.exact, s.asked[0].options.collect], ['stone', 2, true, false]);
        assert.equal(s.asked[0].storage, null);
        assert.equal(count(s.bot, 'stone_pickaxe'), 1);
        assert.equal(count(s.bot, 'iron_ingot'), 3);
    });

    test('diamond with 3 ingots: an iron spare', async () => {
        const { s, r } = await trip('diamond', { cobblestone: 12, iron_ingot: 3 });
        assert.equal(r.ok, true, r.text);
        assert.equal(s.asked[0].material, 'iron');
        assert.equal(count(s.bot, 'iron_pickaxe'), 2);
    });

    test('iron ore with 3 ingots and no cobblestone: no spare is crafted, the trip goes on', async () => {
        const { s, r } = await trip('iron', { iron_ingot: 3 });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(s.asked, []);
        assert.equal(count(s.bot, 'iron_ingot'), 3);
    });
});
