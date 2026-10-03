// v0.1.4.8, fix round, X5 part 1 (DEFECTS_WORLD_0148.md): the bot stays asleep. After "I got up before the
// morning." the bot still lay in the bed. mineflayer 4.33 leaves the bed with entity_action and the action
// id 2, which since Minecraft 1.21.6 means "stop sprinting" (leave_bed is the name of id 0 now). wakeUp of
// the home pack sends the right action, waits until bot.isSleeping is false (at most 3 s, then one more
// try) and says that the bot got up only then. It never throws. sleepInBed and skills.goToBed use it.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { makeWorld, makeFakeBot } from './home_fake_bot.test.js';
import { makeBot as makeLibraryBot, registry } from './stb_fake_bot.test.js';

register('../helpers/mcdata_hooks.js', import.meta.url);
const mcdata = await loadSrc('src/utils/mcdata.js');
const skills = await loadSrc('src/agent/library/skills.js');
const W = await loadSrc('src/agent/packs/home/wake.js');
const H = await loadSrc('src/agent/packs/home/index.js');
const Z = await loadSrc('src/agent/packs/home/sleep.js');
mcdata.__setMcdataForTests(registry);

// A clock that moves only when the code waits, for waits of seconds without real time.
function fakeClock() {
    const c = { t: 1_000_000 };
    c.now = () => c.t;
    c.wait = async (ms) => { c.t += ms; await new Promise((r) => setTimeout(r, 1)); }; // real timers of the fakes run too
    return c;
}

// A sleeping bot of 1.21.8: the client writes packets; the server takes the bot out of the bed after
// `afterMs` for the right packet (leave_bed), or never (`answer` false), or from the given try on.
function sleeper({ answerFrom = 1, afterMs = 10, stringMapper = true } = {}) {
    const bot = makeFakeBot();
    bot.isSleeping = true;
    bot.writes = [];
    bot.supportFeature = (name) => stringMapper && name === 'entityActionUsesStringMapper';
    bot._client = {
        write(name, params) {
            bot.writes.push([name, { ...params }]);
            if (name === 'entity_action' && params.actionId === 'leave_bed' && bot.writes.length >= answerFrom) {
                setTimeout(() => { bot.isSleeping = false; bot.emit('wake'); }, afterMs);
                clearTimeout(bot.sleepTimer); // the fake night of makeFakeBot does not run on
            }
        },
    };
    // v0.1.4.12 (G1): bot.wake() of the patched mineflayer sends leave_bed by name on 1.21.6 and later; wakeUp calls it
    bot.wake = async () => { bot.calls.push(['wake']); bot._client.write('entity_action', { entityId: 1, actionId: bot.supportFeature('entityActionUsesStringMapper') ? 'leave_bed' : 2, jumpBoost: 0 }); };
    return bot;
}

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

describe('X5: wakeUp of the home pack', () => {
    test('sends entity_action leave_bed (1.21.6 and later) and says "I got up." only when bot.isSleeping is false', async () => {
        const bot = sleeper();
        const res = await W.wakeUp(bot, {});
        assert.deepEqual(res, { ok: true, woke: true, reason: null, text: 'I got up.' });
        assert.equal(bot.isSleeping, false);
        assert.deepEqual(bot.writes, [['entity_action', { entityId: 1, actionId: 'leave_bed', jumpBoost: 0 }]]);
        assert.equal(bot.calls.filter((c) => c[0] === 'wake').length, 1, 'through bot.wake() of the patched mineflayer (G1)');
    });

    test('a bot that stays in bed: 3 s, one more try, then the text says so', async () => {
        const bot = sleeper({ answerFrom: 99 });
        const clock = fakeClock();
        const t0 = clock.now();
        const res = await W.wakeUp(bot, {}, clock);
        assert.deepEqual(res, { ok: false, woke: false, reason: 'still_sleeping', text: 'I could not get up. I still lie in the bed.' });
        assert.equal(bot.writes.length, 2, 'the first try and one more');
        const waited = clock.now() - t0;
        assert.ok(waited >= 6000 && waited <= 6200, `waited ${waited} ms`);
        assert.equal(W.WAKE_WAIT_MS, 3000);
        assert.equal(W.WAKE_TRIES, 2);
    });

    test('the second try gets the bot up', async () => {
        const bot = sleeper({ answerFrom: 2, afterMs: 0 });
        const res = await W.wakeUp(bot, {}, { waitMs: 60 });
        assert.equal(res.ok, true);
        assert.equal(bot.writes.length, 2);
    });

    test('before 1.21.6 (no string mapper): bot.wake() of mineflayer', async () => {
        const bot = sleeper({ stringMapper: false });
        bot.wake = async () => { bot.calls.push(['wake']); bot.isSleeping = false; };
        const res = await W.wakeUp(bot, {});
        assert.equal(res.ok, true);
        assert.deepEqual(bot.writes, []);
        assert.equal(bot.calls.filter((c) => c[0] === 'wake').length, 1);
    });

    test('a bot that does not sleep: nothing is sent', async () => {
        const bot = sleeper();
        bot.isSleeping = false;
        assert.deepEqual(await W.wakeUp(bot, {}), { ok: true, woke: false, reason: 'awake', text: 'I am not in bed.' });
        assert.deepEqual(bot.writes, []);
    });

    test('it also gets up while bot.interrupt_code is set (it is called when a command stops the sleep)', async () => {
        const bot = sleeper();
        bot.interrupt_code = true;
        assert.equal((await W.wakeUp(bot, {})).ok, true);
    });

    test('never throws: no bot, a client that throws, a clock that does not move', async () => {
        assert.equal((await W.wakeUp(null)).ok, false);
        const bot = sleeper();
        bot._client.write = () => { throw new Error('socket closed'); };
        const res = await W.wakeUp(bot, {}, { now: () => 5, wait: async () => {} });
        assert.equal(res.ok, false);
        assert.equal(res.text, 'I could not get up. I still lie in the bed.');
    });

    test('exported by the home pack (the glue calls it before a command that moves the bot)', () => {
        assert.equal(H.wakeUp, W.wakeUp);
    });
});

describe('X5: sleepInBed gets up for real', () => {
    function bedScene(bot) {
        const world = bot.world;
        world.bed(8, 64, 10);
        bot.time.timeOfDay = 13000;
        bot.sleepMs = 10 * 60 * 1000; // the night does not pass by itself
        const ctx = { areas: [], places: null, settings: {}, log: () => {} };
        return ctx;
    }

    test('stopped in bed, the bot gets up: "I got up before the morning."', async () => {
        const bot = sleeper();
        const ctx = bedScene(bot);
        bot.isSleeping = false;
        const clock = fakeClock();
        let n = 0;
        const res = await Z.sleepInBed(bot, ctx, { now: clock.now, wait: async (ms) => { if (++n > 3) bot.interrupt_code = true; await clock.wait(ms); } });
        assert.equal(res.reason, 'interrupted');
        assert.equal(res.text, 'I got up before the morning.');
        assert.equal(bot.isSleeping, false);
        assert.ok(bot.writes.some((w) => w[1].actionId === 'leave_bed'));
    });

    test('stopped in bed and the server keeps the bot in it: the text does not say that it got up', async () => {
        const bot = sleeper({ answerFrom: 99 });
        const ctx = bedScene(bot);
        bot.isSleeping = false;
        const clock = fakeClock();
        let n = 0;
        const res = await Z.sleepInBed(bot, ctx, { now: clock.now, wait: async (ms) => { if (++n > 3) bot.interrupt_code = true; await clock.wait(ms); } });
        clearTimeout(bot.sleepTimer);
        assert.equal(bot.isSleeping, true);
        assert.equal(res.ok, false);
        assert.doesNotMatch(res.text, /got up/);
        assert.equal(res.text, 'I was stopped in bed. I could not get up. I still lie in the bed.');
    });

    test('the night does not pass: after the upper limit it gets up, and says so only when it did', async () => {
        const up = sleeper();
        const ctx = bedScene(up);
        up.isSleeping = false;
        const clock = fakeClock();
        const res = await Z.sleepInBed(up, ctx, { now: clock.now, wait: clock.wait, maxSleepMs: 2000 });
        assert.equal(res.reason, 'timeout');
        assert.equal(res.text, 'I lay in bed for a long time, but the night did not pass.');
        const stuck = sleeper({ answerFrom: 99 });
        const ctx2 = bedScene(stuck);
        stuck.isSleeping = false;
        const c2 = fakeClock();
        const res2 = await Z.sleepInBed(stuck, ctx2, { now: c2.now, wait: c2.wait, maxSleepMs: 2000 });
        clearTimeout(stuck.sleepTimer);
        assert.equal(res2.reason, 'still_sleeping');
        assert.equal(res2.text, 'I lay in bed for a long time, but the night did not pass. I could not get up. I still lie in the bed.');
    });
});

describe('X5: skills.goToBed (home_pack off) gets up when it is stopped', () => {
    test('a stopped sleep gets up with wakeUp: "You got up before the morning."', async () => {
        const bot = makeLibraryBot();
        bot.world.set(3, 64, 0, 'red_bed');
        bot.modes = { isOn: () => false, exists: () => false, pause() {}, unpause() {} };
        bot.writes = [];
        bot.supportFeature = (name) => name === 'entityActionUsesStringMapper';
        bot._client = { write(name, params) { bot.writes.push([name, params.actionId]); setTimeout(() => { bot.isSleeping = false; }, 10); } };
        bot.wake = async () => { bot._client.write('entity_action', { entityId: 1, actionId: 'leave_bed', jumpBoost: 0 }); }; // G1
        bot.sleep = async () => { bot.isSleeping = true; };
        setTimeout(() => { bot.interrupt_code = true; }, 100);
        assert.equal(await skills.goToBed(bot), true);
        assert.equal(bot.isSleeping, false);
        assert.deepEqual(bot.writes, [['entity_action', 'leave_bed']]);
        assert.ok(bot.output.includes('You got up before the morning.'), bot.output);
    });
});
