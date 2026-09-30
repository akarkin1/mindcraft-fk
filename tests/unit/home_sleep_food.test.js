// Spec v0.1.4.6 H4: src/agent/packs/home/sleep.js (sleepInBed) and food.js (eatBestFood).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeFakeBot, buildHouse, addMob, removeEntity, give } from './home_fake_bot.test.js';

const Z = await loadSrc('src/agent/packs/home/sleep.js');
const F = await loadSrc('src/agent/packs/home/food.js');

// Real time, short waits: the fake bot wakes up with a timer.
const QUICK = { checkMs: 40, wait: () => new Promise(r => setTimeout(r, 2)) };

function scene({ botAt = [5.5, 64, 10.5], time = 13000, house = false } = {}) {
    const world = makeWorld();
    const area = house ? buildHouse(world) : null;
    const bot = makeFakeBot({ world, pos: botAt });
    bot.time.timeOfDay = time;
    bot.sleepMs = 0;
    const ctx = { areas: area ? [area] : [], places: null, settings: {}, log: () => {}, now: () => Date.now() };
    return { world, area, bot, ctx };
}
const sleeps = bot => bot.calls.filter(c => c[0] === 'sleep');

describe('sleepInBed', () => {
    test('at night with a bed: sleeps until the morning', async () => {
        const { bot, ctx, world } = scene();
        world.bed(10, 64, 10, { facing: 'east' });
        const res = await Z.sleepInBed(bot, ctx, QUICK);
        assert.deepEqual({ ok: res.ok, text: res.text }, { ok: true, text: 'I slept. It is morning.' });
        assert.equal(sleeps(bot).length, 1);
        assert.ok(bot.modes.paused.includes('unstuck'));
    });

    test('the morning time arrives after the wake up (found on the real server)', async () => {
        const { bot, ctx, world } = scene();
        world.bed(10, 64, 10, { facing: 'east' });
        bot.timeLagMs = 60;
        const res = await Z.sleepInBed(bot, ctx, QUICK);
        assert.equal(res.text, 'I slept. It is morning.');
    });

    test('by day: the text for day with the time until the night (v0.1.4.8, C6), no walking', async () => {
        const { bot, ctx, world } = scene({ time: 6000 });
        world.bed(10, 64, 10);
        const res = await Z.sleepInBed(bot, ctx, QUICK);
        assert.equal(res.text, 'I cannot sleep now, it is day. The night starts in about 5 minutes.');
        assert.equal(bot.calls.filter(c => c[0] === 'goto').length, 0);
    });

    test('a thunderstorm by day is fine', async () => {
        const { bot, ctx, world } = scene({ time: 6000 });
        bot.isRaining = true;
        bot.thunderState = 1;
        bot.nightPasses = false;
        world.bed(10, 64, 10);
        const res = await Z.sleepInBed(bot, ctx, QUICK);
        assert.equal(sleeps(bot).length, 1);
        assert.equal(res.text, 'I slept. It is morning.', 'by day the bot wakes up in the day');
    });

    test('no bed within 32 blocks; bedrock is no bed', async () => {
        const { bot, ctx, world } = scene();
        world.set(6, 63, 10, 'bedrock');
        world.bed(50, 64, 10);
        const res = await Z.sleepInBed(bot, ctx, QUICK);
        assert.equal(res.text, 'I found no bed nearby.');
        assert.deepEqual(Z.findBeds(bot, 32), []);
    });

    test('a taken bed: the next one; all taken: the text', async () => {
        const { bot, ctx, world } = scene();
        world.bed(8, 64, 10, { occupied: true });
        world.bed(12, 64, 14);
        const res = await Z.sleepInBed(bot, ctx, QUICK);
        assert.equal(res.ok, true);
        assert.deepEqual(sleeps(bot)[0].slice(1), [13, 64, 14], 'the head of the free bed');
        const s2 = scene();
        s2.world.bed(8, 64, 10, { occupied: true });
        s2.world.bed(12, 64, 14, { occupied: true });
        assert.equal((await Z.sleepInBed(s2.bot, s2.ctx, QUICK)).text, 'All beds nearby are taken.');
    });

    test('a bed that the server reports taken counts as taken', async () => {
        const { bot, ctx, world } = scene();
        world.bed(8, 64, 10);
        bot.sleepError = 'the bed is occupied';
        assert.equal((await Z.sleepInBed(bot, ctx, QUICK)).text, 'All beds nearby are taken.');
    });

    test('monsters near the bed, other errors', async () => {
        const { bot, ctx, world } = scene();
        world.bed(8, 64, 10);
        bot.sleepError = 'there are monsters nearby';
        assert.equal((await Z.sleepInBed(bot, ctx, QUICK)).text, 'I cannot sleep, monsters are nearby.');
        bot.sleepError = 'cant click the bed';
        assert.equal((await Z.sleepInBed(bot, ctx, QUICK)).text, 'I could not sleep: cant click the bed');
    });

    test('a bed inside the house and the bot outside: in through the door first', async () => {
        const { bot, ctx, world } = scene({ house: true, botAt: [4.5, 64, 20.5] });
        world.bed(2, 64, 2, { facing: 'east' });
        const res = await Z.sleepInBed(bot, ctx, QUICK);
        assert.equal(res.ok, true, JSON.stringify(res));
        const acts = bot.calls.filter(c => c[0] === 'activate');
        assert.equal(acts.length, 2, 'opened and closed the door');
        assert.equal(world.propsAt(4, 64, 7).open, false);
    });

    test('after sunset but before 12541: waits at the bed', async () => {
        const { bot, ctx, world } = scene({ time: 12200 });
        world.bed(8, 64, 10);
        let t = 0;
        const res = await Z.sleepInBed(bot, ctx, {
            now: () => t,
            wait: async (ms) => { t += ms; bot.time.timeOfDay += ms / 50; await new Promise(r => setTimeout(r, 1)); },
        });
        assert.equal(res.text, 'I slept. It is morning.');
        assert.ok(t >= 6000, 'waited for the time');
    });

    test('the night does not pass: gets up after the upper limit', async () => {
        const { bot, ctx, world } = scene();
        world.bed(8, 64, 10);
        bot.sleepMs = 60000;
        const res = await Z.sleepInBed(bot, ctx, { ...QUICK, maxSleepMs: 30 });
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'timeout');
        assert.ok(bot.calls.some(c => c[0] === 'wake'));
    });

    test('woken before the morning, interrupted in bed', async () => {
        const { bot, ctx, world } = scene();
        world.bed(8, 64, 10);
        bot.nightPasses = false;
        assert.equal((await Z.sleepInBed(bot, ctx, QUICK)).text, 'I woke up before the morning.');
        const s2 = scene();
        s2.world.bed(8, 64, 10);
        s2.bot.sleepMs = 60000;
        let n = 0;
        const res = await Z.sleepInBed(s2.bot, s2.ctx, { wait: async () => { if (++n > 3) s2.bot.interrupt_code = true; await new Promise(r => setTimeout(r, 1)); } });
        assert.equal(res.reason, 'interrupted');
        assert.ok(s2.bot.calls.some(c => c[0] === 'wake'));
    });

    test('never throws', async () => {
        const res = await Z.sleepInBed(null, {}, QUICK);
        assert.equal(res.ok, false);
        assert.match(res.text, /^I could not sleep: /);
    });
});

describe('eatBestFood', () => {
    function eater(food, items) {
        const bot = makeFakeBot();
        bot.food = food;
        for (const [name, n] of items) give(bot, name, n);
        return bot;
    }

    // v0.1.4.8, C1: the texts name the food level and the health
    test('full: not hungry', async () => {
        const res = await F.eatBestFood(eater(20, [['bread', 3]]), {}, QUICK);
        assert.deepEqual(res, { ok: true, ate: 0, reason: 'not_hungry', text: 'I am not hungry. Food 20 of 20, health 20 of 20.' });
    });

    test('eats until the food level is at least 18', async () => {
        const bot = eater(10, [['bread', 5]]);
        const res = await F.eatBestFood(bot, {}, QUICK);
        assert.deepEqual(res, { ok: true, ate: 2, reason: null, text: 'I ate 2 bread. Food 20 of 20, health 20 of 20.' });
        assert.equal(bot.food, 20);
    });

    test('the most food points first, banned food never', async () => {
        const bot = eater(2, [['rotten_flesh', 9], ['bread', 5], ['cooked_beef', 1], ['golden_apple', 2]]);
        const res = await F.eatBestFood(bot, {}, QUICK);
        assert.equal(res.text, 'I ate 1 cooked_beef and 2 bread. Food 20 of 20, health 20 of 20.');
        assert.equal(bot.calls.some(c => c[0] === 'consume' && (c[1] === 'rotten_flesh' || c[1] === 'golden_apple')), false);
    });

    test('at 19 and unhurt it is not hungry; hurt it eats one (v0.1.4.8, C1; before it always ate one)', async () => {
        assert.equal((await F.eatBestFood(eater(19, [['apple', 1]]), {}, QUICK)).text, 'I am not hungry. Food 19 of 20, health 20 of 20.');
        const hurt = eater(19, [['apple', 1]]);
        hurt.health = 15;
        assert.equal((await F.eatBestFood(hurt, {}, QUICK)).text, 'I ate 1 apple. Food 20 of 20, health 15 of 20.');
    });

    test('no food, only banned food: the text', async () => {
        assert.deepEqual(await F.eatBestFood(eater(10, []), {}, QUICK), { ok: false, ate: 0, reason: 'no_food', text: 'I carry no food and know no chest with food.' });
        assert.equal((await F.eatBestFood(eater(10, [['spider_eye', 3], ['dirt', 5]]), {}, QUICK)).text, 'I carry no food and know no chest with food.');
    });

    test('picks up food that lies within 8 blocks first', async () => {
        const bot = eater(12, []);
        const loaf = addMob(bot, 'item', [3.5, 64, 0.5], { type: 'object' });
        loaf.getDroppedItem = () => ({ name: 'bread' });
        const far = addMob(bot, 'item', [30.5, 64, 0.5], { type: 'object' });
        far.getDroppedItem = () => ({ name: 'cooked_beef' });
        const inner = bot.gotoImpl;
        bot.gotoImpl = async (goal) => {
            await inner(goal);
            if (bot.entities[loaf.id]) {
                removeEntity(bot, loaf);
                give(bot, 'bread', 1);
            }
        };
        const res = await F.eatBestFood(bot, {}, QUICK);
        assert.equal(res.text, 'I ate 1 bread. Food 17 of 20, health 20 of 20.');
        assert.ok(bot.entities[far.id], 'the far item was left');
    });

    test('an error while eating', async () => {
        const bot = eater(10, [['bread', 2]]);
        bot.consume = async () => { throw new Error('Consuming cancelled'); };
        assert.deepEqual(await F.eatBestFood(bot, {}, QUICK), { ok: false, ate: 0, reason: 'error', text: 'I could not eat: Consuming cancelled' });
    });

    test('auto-eat is paused while eating and restored after', async () => {
        const bot = eater(10, [['bread', 2]]);
        bot.autoEat = { disabled: false, isEating: false };
        const seen = [];
        const inner = bot.consume;
        bot.consume = async () => { seen.push(bot.autoEat.disabled); await inner(); };
        await F.eatBestFood(bot, {}, QUICK);
        assert.deepEqual([...new Set(seen)], [true]);
        assert.equal(bot.autoEat.disabled, false);
        const off = eater(10, [['bread', 2]]);
        off.autoEat = { disabled: true, isEating: false };
        await F.eatBestFood(off, {}, QUICK);
        assert.equal(off.autoEat.disabled, true, 'the owner switched it off: it stays off');
    });

    test('never throws, and autoEatOptions is exported here too', async () => {
        const res = await F.eatBestFood(null, {}, QUICK);
        assert.equal(res.ok, false);
        assert.match(res.text, /^I could not eat: /);
        assert.equal(typeof F.autoEatOptions, 'function');
        assert.equal(F.autoEatOptions({}).startAt, 14);
    });
});
