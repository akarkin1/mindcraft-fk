// Spec v0.1.4.16, F3 (engineer E2): the cane. On the farming fake bot with a cane area (the survey's `cane`: an open farm
// area with sugar cane on sand by the water): !harvest("sugar_cane"), "cane" or the area's name cuts every cane column
// from its second block up (the block above the bottom one is dug, the rest falls), picks up the drops, plants nothing
// and says `I cut <n> sugar cane at "<area>" and picked them up.`; a cane area with nothing above the bottom row says
// `The cane at "<area>" has not grown yet.`; !farmCycle on a cane area cuts and stores the cane.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeBot, makeSim, makeWorld } from './home_fake_bot.test.js';
import { farmCycle, findFarm, harvestCrops } from '../../src/agent/packs/farming/farming.js';
import { caneColumns, isCaneArea, isCaneName } from '../../src/agent/packs/farming/field_logic.js';
import { caneCutText, caneNotGrownText } from '../../src/agent/packs/farming/texts.js';

function countOf(bot, name) {
    return bot.inventory.list.filter(i => i.name === name).reduce((s, i) => s + i.count, 0);
}

function add(bot, name, n) {
    const it = bot.inventory.list.find(i => i.name === name);
    if (it) it.count += n;
    else bot.inventory.list.push({ name, count: n, type: 1 });
}

// Three cane columns on sand at z 0, water behind them at z -1, the canes `heights` blocks tall; the bot stands south.
function caneFarm({ heights = [3, 3, 3], name = 'cane', ages = null } = {}) {
    const world = makeWorld();
    heights.forEach((h, x) => {
        world.set(x, 63, 0, 'sand');
        world.set(x, 63, -1, 'water');
        for (let y = 64; y < 64 + h; y++) world.set(x, y, 0, 'sugar_cane', { age: 0 });
    });
    void ages;
    const bot = makeFakeBot({ world, pos: [1.5, 64, 4.5] });
    // the game: a cut cane column drops every block above the cut, picked up at once
    const baseDig = bot.dig;
    bot.dig = async (block) => {
        const p = block.position;
        const wasCane = world.nameAt(p.x, p.y, p.z) === 'sugar_cane';
        await baseDig(block);
        if (wasCane) {
            let n = 1;
            for (let y = p.y + 1; world.nameAt(p.x, y, p.z) === 'sugar_cane'; y++) {
                world.set(p.x, y, p.z, 'air');
                n++;
            }
            add(bot, 'sugar_cane', n);
        }
    };
    const area = { name, type: 'farm', kind: 'farm', border: 'open', dimension: 'overworld', source: 'survey', entrances: [],
        min: { x: -1, y: 62, z: -1 }, max: { x: 3, y: 68, z: 1 } };
    return { world, bot, area, ctx: { areas: [area] } };
}

const canesAt = (world, x) => {
    let n = 0;
    for (let y = 64; world.nameAt(x, y, 0) === 'sugar_cane'; y++) n++;
    return n;
};

describe('the pure part: the names, the columns, a cane area', () => {
    test('isCaneName, caneColumns, isCaneArea', () => {
        for (const n of ['sugar_cane', 'Sugar Cane', 'sugarcane', 'cane', 'minecraft:sugar_cane']) assert.equal(isCaneName(n), true, n);
        for (const n of ['wheat', 'cane_farm', '', null]) assert.equal(isCaneName(n), false, String(n));
        const { world, area } = caneFarm({ heights: [3, 1, 2] });
        const get = (x, y, z) => ({ name: world.nameAt(x, y, z) });
        assert.deepEqual(caneColumns(get, area), [{ x: 0, y: 64, z: 0, height: 3 }, { x: 1, y: 64, z: 0, height: 1 }, { x: 2, y: 64, z: 0, height: 2 }]);
        assert.deepEqual(caneColumns(get, { min: { x: 10, y: 60, z: 10 }, max: { x: 12, y: 70, z: 12 } }), []);
        assert.deepEqual(caneColumns(null, area), []);
        assert.equal(isCaneArea(get, area), true);
        assert.equal(isCaneArea(get, { ...area, name: 'reeds' }), true, 'by the cane in the box');
        assert.equal(isCaneArea(get, { name: 'cane_2', type: 'farm' }), true, 'by the name');
        assert.equal(isCaneArea(get, { name: 'wheat_farm', type: 'farm', detail: { what: 'cane' } }), true, 'by the detail');
        assert.equal(isCaneArea(get, { name: 'wheat_farm', type: 'farm', min: { x: 10, y: 60, z: 10 }, max: { x: 12, y: 70, z: 12 } }), false);
        assert.equal(caneCutText(6, 'cane'), 'I cut 6 sugar cane at "cane" and picked them up.');
        assert.equal(caneNotGrownText('cane'), 'The cane at "cane" has not grown yet.');
    });

    test('findFarm: "sugar_cane" and "cane" name the cane area, which is marked cane; an unknown name as before', () => {
        const { bot, ctx, area } = caneFarm({ name: 'reeds' });
        for (const name of ['sugar_cane', 'cane', 'reeds']) {
            const found = findFarm(bot, ctx, name);
            assert.equal(found.ok, true, name);
            assert.equal(found.farm.name, 'reeds', name);
            assert.equal(found.farm.cane, true, name);
        }
        assert.equal(findFarm(bot, ctx, '').farm.name, 'reeds', 'the nearest farm');
        const wheat = { ...area, name: 'wheat_farm', min: { x: 20, y: 62, z: 20 }, max: { x: 24, y: 68, z: 24 } };
        assert.equal(findFarm(bot, { areas: [wheat] }, 'sugar_cane').text, 'I know no farm "sugar_cane". I know the farms "wheat_farm".');
        assert.equal(findFarm(bot, { areas: [wheat, area] }, 'sugar_cane').farm.name, 'reeds', 'the cane area among others');
        assert.equal(findFarm(bot, { areas: [wheat] }, 'wheat_farm').farm.cane, false);
    });
});

describe('!harvest on the cane (F3)', () => {
    test('cuts every column from the second block up, picks the drops up, plants nothing, says the line', async () => {
        const { world, bot, ctx } = caneFarm({ heights: [3, 3, 3] });
        const s = makeSim(bot);
        const res = await harvestCrops(bot, ctx, 'sugar_cane', { now: s.now, wait: s.wait });
        assert.equal(res.ok, true, res.text);
        assert.equal(res.text, 'I cut 6 sugar cane at "cane" and picked them up.');
        assert.equal(res.harvested, 6);
        assert.equal(res.replanted, 0);
        assert.deepEqual(res.byCrop, { sugar_cane: 6 });
        for (const x of [0, 1, 2]) assert.equal(canesAt(world, x), 1, `the bottom cane at x ${x} stands`);
        const digs = bot.calls.filter(c => c[0] === 'dig').map(c => [c[1], c[2], c[3]]).sort((a, b) => a[0] - b[0]);
        assert.deepEqual(digs, [[0, 65, 0], [1, 65, 0], [2, 65, 0]], 'the block above the bottom one is dug, once per column');
        assert.equal(countOf(bot, 'sugar_cane'), 6, 'the cane is in the bag');
        assert.equal(bot.calls.filter(c => c[0] === 'activate').length, 0, 'nothing is planted');
        assert.ok(bot.modes.paused.includes('unstuck'));
    });

    test('the area by its own name and by "cane"; uneven columns count what stands above the bottom row', async () => {
        const { bot, ctx } = caneFarm({ heights: [2, 1, 3], name: 'reeds' });
        const s = makeSim(bot);
        const res = await harvestCrops(bot, ctx, 'cane', { now: s.now, wait: s.wait });
        assert.equal(res.text, 'I cut 3 sugar cane at "reeds" and picked them up.');
        assert.equal(res.harvested, 3);
    });

    test('nothing above the bottom row: the not-grown line, nothing dug', async () => {
        const { bot, ctx } = caneFarm({ heights: [1, 1, 1] });
        const s = makeSim(bot);
        const res = await harvestCrops(bot, ctx, 'sugar_cane', { now: s.now, wait: s.wait });
        assert.equal(res.ok, true);
        assert.equal(res.text, 'The cane at "cane" has not grown yet.');
        assert.equal(res.harvested, 0);
        assert.equal(bot.calls.filter(c => c[0] === 'dig').length, 0);
    });

    test('with bot.interrupt_code set it does nothing', async () => {
        const { bot, ctx } = caneFarm();
        bot.interrupt_code = true;
        const res = await harvestCrops(bot, ctx, 'sugar_cane');
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'interrupted');
    });
});

describe('!farmCycle on the cane (F3)', () => {
    test('cuts the cane and stores it; the cycle text; nothing to plant or fertilize', async () => {
        const { bot, ctx } = caneFarm({ heights: [3, 3, 3] });
        const stored = [];
        ctx.storage = { storeItems: async (plan) => { stored.push(plan); return { ok: true, reason: null, text: 'I put 6 sugar_cane into the chest at (10, 64, 10).' }; } };
        const s = makeSim(bot);
        const res = await farmCycle(bot, ctx, 'sugar_cane', { now: s.now, wait: s.wait });
        assert.equal(res.ok, true, res.text);
        assert.equal(res.text, 'Farm "cane": I cut 6 sugar cane at "cane" and picked them up. I put 6 sugar_cane into the chest at (10, 64, 10).');
        assert.deepEqual(stored, [{ only: ['sugar_cane'], keep: {} }]);
        assert.deepEqual({ harvested: res.harvested, planted: res.planted, fertilized: res.fertilized, madeBoneMeal: res.madeBoneMeal }, { harvested: 6, planted: 0, fertilized: 0, madeBoneMeal: 0 });
    });

    test('without storage the cane stays in the bag; not grown: the line, no store call', async () => {
        const { bot, ctx } = caneFarm({ heights: [2, 2, 2] });
        const s = makeSim(bot);
        const res = await farmCycle(bot, ctx, '', { now: s.now, wait: s.wait });
        assert.equal(res.text, 'Farm "cane": I cut 3 sugar cane at "cane" and picked them up.');
        assert.equal(countOf(bot, 'sugar_cane'), 3);
        const flat = caneFarm({ heights: [1, 1, 1] });
        const calls = [];
        flat.ctx.storage = { storeItems: async (plan) => { calls.push(plan); return { ok: true, text: 'stored' }; } };
        const s2 = makeSim(flat.bot);
        const r2 = await farmCycle(flat.bot, flat.ctx, 'cane', { now: s2.now, wait: s2.wait });
        assert.equal(r2.text, 'Farm "cane": The cane at "cane" has not grown yet.');
        assert.deepEqual(calls, []);
    });
});
