// Spec v0.1.4.13, 4.4 P1 (part P, engineer E3): the supply step of a trip reads the chests within 16 blocks of the
// bot first, then the chests it knows, nearest first, then crafts from what it carries, the surface last; the
// text names the chest; a spare pickaxe is wanted only when the one in hand has fewer than 50 uses left, and it
// is crafted from carried material, never fetched from the surface.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeMiningBot, makeClock, makeCtx, give, count, REGISTRY } from './mining_fake_bot.test.js';

const S = await loadSrc('src/agent/packs/mining/supply_logic.js');
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

// The chests of the play of 2026-10-04: one 4 blocks from the tunnel, one in the basement far above.
const NEAR = { x: 15, y: -59, z: -99, dimension: 'overworld', kind: 'chest', items: { bread: 20, cobbled_deepslate: 64 }, free_slots: 20 };
const FAR = { x: 11, y: 7, z: -100, dimension: 'overworld', kind: 'chest', items: { bread: 40, ladder: 30, torch: 64 }, free_slots: 5 };
const BOT = { x: 31, y: -59, z: -99 };

describe('P1: supplyPlan, the order from a chest fixture', () => {
    test('the chest within 16 blocks first, then the known chest far away, nearest first; what no chest gives is the rest', () => {
        const missing = [{ name: 'food', count: 8 }, { name: 'ladder', count: 16 }, { name: 'torch', count: 16 }, { name: 'chest', count: 1 }];
        const r = S.supplyPlan({ missing, from: BOT, chests: [FAR, NEAR], foods: REGISTRY.foodsByName });
        assert.deepEqual(r.takes, [
            { chest: { x: 15, y: -59, z: -99 }, near: true, items: { bread: 8 } },
            { chest: { x: 11, y: 7, z: -100 }, near: false, items: { ladder: 16, torch: 16 } },
        ]);
        assert.deepEqual(r.rest, [{ name: 'chest', count: 1 }]);
    });

    test('a supply split over two chests; the near one gives what it has first', () => {
        const near = { ...NEAR, items: { bread: 3 } };
        const r = S.supplyPlan({ missing: [{ name: 'food', count: 8 }], from: BOT, chests: [FAR, near], foods: REGISTRY.foodsByName });
        assert.deepEqual(r.takes.map(t => [t.chest.x, t.items]), [[15, { bread: 3 }], [11, { bread: 5 }]]);
        assert.deepEqual(r.rest, []);
    });

    test('two near chests: the nearest first; the far ones by distance too', () => {
        const a = { x: 20, y: -59, z: -99, items: { torch: 4 } };
        const b = { x: 33, y: -59, z: -99, items: { torch: 4 } };
        const c = { x: 31, y: 60, z: -99, items: { torch: 4 } };
        const d = { x: 31, y: 7, z: -99, items: { torch: 4 } };
        const r = S.supplyPlan({ missing: [{ name: 'torch', count: 16 }], from: BOT, chests: [c, a, d, b] });
        assert.deepEqual(r.takes.map(t => [t.chest.x, t.chest.y, t.near]), [[33, -59, true], [20, -59, true], [31, 7, false], [31, 60, false]]);
        assert.deepEqual(r.rest, []);
    });

    test('food is any edible item, a pickaxe any pickaxe that breaks the ore; cobblestone is never fetched', () => {
        const chest = { x: 16, y: -59, z: -99, items: { cooked_beef: 2, rotten_flesh: 9, stone_pickaxe: 1, iron_pickaxe: 1, cobblestone: 64 } };
        const r = S.supplyPlan({
            missing: [{ name: 'food', count: 8 }, { name: 'pickaxe', material: 'iron', count: 1 }, { name: 'cobblestone', count: 32 }],
            from: BOT, chests: [chest], foods: REGISTRY.foodsByName,
        });
        assert.deepEqual(r.takes, [{ chest: { x: 16, y: -59, z: -99 }, near: true, items: { cooked_beef: 2, iron_pickaxe: 1 } }]);
        assert.deepEqual(r.rest, [{ name: 'food', count: 6 }]);
    });

    test('without chests, without a position, or with bad entries: everything is the rest', () => {
        const missing = [{ name: 'torch', count: 16 }];
        assert.deepEqual(S.supplyPlan({ missing, from: BOT, chests: null }), { takes: [], rest: [{ name: 'torch', count: 16 }] });
        assert.deepEqual(S.supplyPlan({ missing, from: null, chests: [FAR] }).rest, [{ name: 'torch', count: 16 }]);
        assert.deepEqual(S.supplyPlan({ missing, from: BOT, chests: [null, { x: 'a' }, { x: 1, y: 2, z: 3 }] }).takes, []);
        assert.deepEqual(S.supplyPlan(), { takes: [], rest: [] });
        assert.equal(S.SUPPLY_NEAR_RANGE, 16);
    });
});

describe('P1: the spare pickaxe rule', () => {
    test('a spare only with one pickaxe under 50 uses; the rule of tripNeeds (the blocks of the trip) is dropped', () => {
        const old = [{ name: 'pickaxe', material: 'iron', count: 1, spare: true }, { name: 'torch', count: 16 }];
        assert.deepEqual(S.applySpareRule(old, [{ name: 'iron_pickaxe', material: 'iron', uses: 200 }], 'iron'), [{ name: 'torch', count: 16 }]);
        assert.deepEqual(S.applySpareRule([], [{ name: 'iron_pickaxe', material: 'iron', uses: 49 }], 'iron'), [{ name: 'pickaxe', material: 'iron', count: 1, spare: true }]);
        assert.deepEqual(S.applySpareRule([], [{ name: 'iron_pickaxe', material: 'iron', uses: 50 }], 'iron'), [], 'at 50 no spare');
        assert.deepEqual(S.applySpareRule([], [{ name: 'iron_pickaxe', material: 'iron', uses: 5 }, { name: 'stone_pickaxe', material: 'stone', uses: 100 }], 'stone'), [], 'two pickaxes');
        assert.deepEqual(S.applySpareRule([{ name: 'pickaxe', material: 'stone', count: 1 }], [], 'stone'), [{ name: 'pickaxe', material: 'stone', count: 1 }], 'none: the first pickaxe, no spare');
        assert.equal(S.SPARE_PICKAXE_USES, 50);
        assert.ok(P.applySpareRule && P.supplyPlan && P.SPARE_PICKAXE_USES, 'index.js exports them');
    });
});

describe('P1: the text names the chest', () => {
    test('the example of the spec, and the rest after the chests', () => {
        const takes = [{ chest: { x: 15, y: -59, z: -99 }, near: true, items: { bread: 10 } }];
        assert.equal(T.suppliesText([{ name: 'food', count: 10 }], takes), 'I get my supplies: 10 bread from the chest at (15, -59, -99).');
        const two = [...takes, { chest: { x: 11, y: 7, z: -100 }, near: false, items: { ladder: 16, torch: 1 } }];
        assert.equal(T.suppliesText([{ name: 'ladder', count: 16 }, { name: 'torch', count: 8 }, { name: 'food', count: 10 }, { name: 'chest', count: 1 }], two),
            'I get my supplies: 10 bread from the chest at (15, -59, -99), 16 ladders and 1 torch from the chest at (11, 7, -100), 7 torches, a chest.');
        assert.equal(T.suppliesText([{ name: 'pickaxe', material: 'iron', count: 1 }], [{ chest: { x: 1, y: 2, z: 3 }, items: { iron_pickaxe: 1 } }]),
            'I get my supplies: an iron pickaxe from the chest at (1, 2, 3).');
        assert.equal(T.suppliesText([{ name: 'ladder', count: 16 }, { name: 'torch', count: 8 }, { name: 'chest', count: 1 }]), 'I get my supplies: 16 ladders, 8 torches, a chest.', 'as before without takes');
        assert.equal(T.suppliesText([], []), '');
    });
});

describe('P1: prepareMiningTrip gets the food from the chest beside the tunnel, not from the basement', () => {
    const MINE = {
        ore: 'coal', entrance: { x: 0, y: 64, z: 0 }, level: 40, base: { x: 0, y: 40, z: -1 }, chest: null, direction: 'north', length: 2, shaft: 'ladder',
        dimension: 'overworld', end: { x: 0, y: 40, z: -3 }, tunnel: [{ x: 0, y: 40, z: -1 }, { x: 0, y: 40, z: -3 }],
        route: [{ kind: 'ladder', x: 0, z: 0, top: 63, bottom: 40, face: 'north', entry: { x: 0, y: 64, z: 1 } }],
    };

    async function scene({ chests, gear = {}, pos = [0.5, 64, 0.5] } = {}) {
        const world = makeWorld();
        const bot = makeMiningBot({ world, pos });
        const clock = makeClock(bot);
        const ctx = await makeCtx(clock);
        ctx.mines.set(MINE);
        const index = [...chests];
        ctx.chests = { list: () => index.map(c => ({ ...c })), add: (c) => index.push(c) };
        give(bot, 'iron_pickaxe', 1, { used: gear.used ?? 0 });
        give(bot, 'ladder', 64);
        give(bot, 'cobblestone', 64);
        give(bot, 'torch', 16);
        give(bot, 'chest', 2);
        const fetched = [];
        ctx.storage = {
            async fetchItem(b, c, name, n) {
                fetched.push([name, n]);
                // the nearest chest that holds the item gives it, as the storage pack does
                const holder = index.filter(ch => (ch.items[name] ?? 0) > 0).sort((a, b2) => Math.hypot(a.x - b.entity.position.x, a.y - b.entity.position.y, a.z - b.entity.position.z)
                    - Math.hypot(b2.x - b.entity.position.x, b2.y - b.entity.position.y, b2.z - b.entity.position.z))[0];
                if (!holder) {
                    return { ok: false, reason: 'not_found', taken: 0 };
                }
                const k = Math.min(n, holder.items[name]);
                holder.items[name] -= k;
                give(b, name, k);
                return { ok: k >= n, reason: null, taken: k, chests: [holder] };
            },
        };
        const said = [];
        ctx.say = t => said.push(t);
        return { bot, ctx, clock, fetched, said, index, opts: { now: clock.now, wait: clock.wait } };
    }

    test('the near chest gives the bread; the text names it; the far chest is not walked to', async () => {
        const near = { x: 3, y: 64, z: 2, dimension: 'overworld', kind: 'chest', items: { bread: 20 }, free_slots: 20 };
        const far = { x: 90, y: 64, z: 0, dimension: 'overworld', kind: 'chest', items: { bread: 40 }, free_slots: 5 };
        const s = await scene({ chests: [far, near] });
        const r = await M.prepareMiningTrip(s.bot, s.ctx, 'coal', { ...s.opts, mine: MINE, level: 40, wayDownTo: 40, hasBase: true });
        assert.equal(r.ok, true, r.text);
        assert.equal(s.said[0], 'I get my supplies: 8 bread from the chest at (3, 64, 2).');
        assert.deepEqual(s.fetched, [['bread', 8]]);
        assert.equal(count(s.bot, 'bread'), 8);
        assert.equal(s.index.find(c => c.x === 3).items.bread, 12, 'the near chest gave');
        assert.equal(s.index.find(c => c.x === 90).items.bread, 40, 'the far chest did not');
    });

    test('an unknown chest within 16 blocks is looked into first, so that the plan can name it', async () => {
        const far = { x: 90, y: 64, z: 0, dimension: 'overworld', kind: 'chest', items: { bread: 40 }, free_slots: 5 };
        const s = await scene({ chests: [far] });
        s.bot.world.set(4, 64, 0, 'chest');
        s.bot.findBlocks = ({ matching, maxDistance }) => (matching({ name: 'chest' }) && maxDistance >= 4 ? [{ x: 4, y: 64, z: 0 }] : []);
        const looks = [];
        s.ctx.storage.lookIntoChests = async (b, c, range) => {
            looks.push(range);
            s.index.push({ x: 4, y: 64, z: 0, dimension: 'overworld', kind: 'chest', items: { bread: 6 }, free_slots: 26 });
            return [];
        };
        const r = await M.prepareMiningTrip(s.bot, s.ctx, 'coal', { ...s.opts, mine: MINE, level: 40, wayDownTo: 40, hasBase: true });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(looks, [16]);
        assert.equal(s.said[0], 'I get my supplies: 6 bread from the chest at (4, 64, 0), 2 bread from the chest at (90, 64, 0).');
        assert.deepEqual(s.fetched, [['bread', 6], ['bread', 2]]);
    });

    test('no unknown chest near, or no lookIntoChests in ctx.storage: no look', async () => {
        const near = { x: 3, y: 64, z: 2, dimension: 'overworld', kind: 'chest', items: { bread: 20 }, free_slots: 20 };
        const s = await scene({ chests: [near] });
        s.bot.world.set(3, 64, 2, 'chest');
        s.bot.findBlocks = () => [{ x: 3, y: 64, z: 2 }];
        let looks = 0;
        s.ctx.storage.lookIntoChests = async () => { looks++; return []; };
        await M.prepareMiningTrip(s.bot, s.ctx, 'coal', { ...s.opts, mine: MINE, level: 40, wayDownTo: 40, hasBase: true });
        assert.equal(looks, 0, 'the chest is known');
        const t = await scene({ chests: [] });
        t.bot.findBlocks = () => [{ x: 4, y: 64, z: 0 }];
        const r = await M.prepareMiningTrip(t.bot, t.ctx, 'coal', { ...t.opts, mine: MINE, level: 40, wayDownTo: 40, hasBase: true });
        assert.equal(r.ok, true, r.text);
        assert.match(r.text, /I have no food with me\./);
    });

    test('the spare pickaxe: under 50 uses it is crafted from carried material, with no chest and no surface; at 50 or more nothing', async () => {
        const asked = [];
        const tools = {
            async ensureTool(b, c, kind, material, options) {
                asked.push({ kind, material, options, storage: c.storage, chests: c.chests });
                give(b, `${material}_pickaxe`, 1);
                return { ok: true, text: 'I crafted an iron_pickaxe.' };
            },
            async craftSupplies() { return { ok: false, text: '' }; },
        };
        const worn = await scene({ chests: [], gear: { used: 210 } }); // 40 uses left
        give(worn.bot, 'bread', 8);
        worn.ctx.tools = tools;
        const r = await M.prepareMiningTrip(worn.bot, worn.ctx, 'coal', { ...worn.opts, mine: MINE, level: 40, wayDownTo: 40, hasBase: true });
        assert.equal(r.ok, true, r.text);
        assert.equal(worn.said[0], 'I get my supplies: a second pickaxe.');
        assert.equal(asked.length, 1);
        assert.deepEqual([asked[0].kind, asked[0].material, asked[0].options.count, asked[0].options.collect], ['pickaxe', 'stone', 2, false]);
        assert.equal(asked[0].storage, null, 'no chest for the spare');
        assert.equal(asked[0].chests, null);
        assert.deepEqual(worn.fetched, [], 'nothing fetched: the supplies are carried');
        const fine = await scene({ chests: [], gear: { used: 200 } }); // 50 uses left
        give(fine.bot, 'bread', 8);
        fine.ctx.tools = { ...tools };
        asked.length = 0;
        const r2 = await M.prepareMiningTrip(fine.bot, fine.ctx, 'coal', { ...fine.opts, mine: MINE, level: 40, wayDownTo: 40, hasBase: true });
        assert.equal(r2.ok, true, r2.text);
        assert.deepEqual(asked, [], 'no spare at 50 uses');
        assert.deepEqual(fine.said, []);
    });

    test('without any pickaxe the first one is got as before: the chests, then crafted with everything it needs', async () => {
        const asked = [];
        const s = await scene({ chests: [] });
        s.bot.inventory.list = s.bot.inventory.list.filter(i => i.name !== 'iron_pickaxe');
        give(s.bot, 'bread', 8);
        s.ctx.tools = {
            async ensureTool(b, c, kind, material, options) {
                asked.push({ material, options, storage: c.storage });
                give(b, `${material}_pickaxe`, 1);
                return { ok: true, text: 'I crafted a stone_pickaxe.' };
            },
            async craftSupplies() { return { ok: false, text: '' }; },
        };
        const r = await M.prepareMiningTrip(s.bot, s.ctx, 'coal', { ...s.opts, mine: MINE, level: 40, wayDownTo: 40, hasBase: true });
        assert.equal(r.ok, true, r.text);
        assert.equal(asked.length, 1);
        assert.equal(asked[0].options.count, 1);
        assert.notEqual(asked[0].storage, null, 'the chests may be asked for the first pickaxe');
        assert.equal(s.said[0], 'I get my supplies: a stone pickaxe.');
    });
});
