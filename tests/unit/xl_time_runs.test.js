// v0.1.4.14, part L (engineer E1), fix round part 8 (P-17, spec 8.1): the clock of 26.1 runs between packets. The
// integrated server of 26.1 sends update_time rarely (on login, on sleep, on a time change; the dedicated server still
// every second); mineflayer 4.39.0 advanced bot.time.clocks[*].totalTicks on physicsTick, which it stops while the bot
// rides, is dead or stands in an unloaded chunk, and recomputed bot.time.time, timeOfDay, isDay and day only in the
// update_time handler, so the bot's clock stood still for minutes during a boat ride (the owner's play of 2026-11-09).
// patches/mineflayer+4.39.0.patch, lib/plugins/time.js: the clocks advance on a steady timer of 50 ms (a game tick) from
// the first clock packet to the end of the bot, and the fields of bot.time follow the clock of the current dimension
// (rate 0: they stand still; a packet sets them); the time event fires on every packet and, between packets, at most once
// per 20 ticks and only when the fields changed. The old packet shape (1.21.8) sets no clock and nothing changes.
//
// The fake bot below has the real time plugin of mineflayer: a client that emits update_time, a registry with the
// dimensions by id and the game's dimension. The timer is the real setInterval of the plugin; the time it reads
// (performance.now) is a fake clock of the test that the test moves, so 2 s pass in a few milliseconds: `ticks(n)`
// moves it n game ticks and waits for one step of the timer. One test runs on the real clock.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { repoPath } from '../helpers/paths.js';

const require = createRequire(import.meta.url);
const injectTime = require('mineflayer/lib/plugins/time.js');

const read = (rel) => fs.readFileSync(repoPath(rel), 'utf8').replace(/\r\n/g, '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the fake clock of the plugin: performance.now of the process answers with it while it is set
const realNow = performance.now.bind(performance);
let fakeNow = null;
before(() => { performance.now = () => (fakeNow === null ? realNow() : fakeNow); });
after(() => { performance.now = realNow; });

const bots = [];
after(() => { for (const bot of bots) bot.emit('end'); });

function timeBot(dimension = 'overworld') {
    fakeNow = 100000;
    const bot = new EventEmitter();
    bot._client = new EventEmitter();
    bot.registry = { dimensionsById: { 0: { name: 'overworld' }, 1: { name: 'the_end' } } };
    bot.game = { dimension };
    injectTime(bot);
    bots.push(bot);
    const events = { time: 0 };
    bot.on('time', () => { events.time++; });
    // n game ticks of the fake clock, then one step of the timer (50 ms real, with a margin)
    const ticks = async (n) => { fakeNow += n * 50; await sleep(80); };
    // 26.1: the clocks of clockUpdates (the index of the clock, its ticks, the partial tick and the rate)
    const clockPacket = (totalTicks, rate = 1, id = 0) => bot._client.emit('update_time', {
        age: [0, 1000], clockUpdates: [{ id, totalTicks, partialTick: 0, rate }],
    });
    // 1.21.8: the time of day as a long and the daylight cycle flag
    const oldPacket = (time, tickDayTime = true) => bot._client.emit('update_time', { age: [0, 1000], time: [0, time], tickDayTime });
    return { bot, events, ticks, clockPacket, oldPacket };
}

describe('L: the clock of 26.1 runs between packets (mineflayer time.js)', () => {
    test('the patch file and the patched time.js hold the hunk', () => {
        const patch = read('patches/mineflayer+4.39.0.patch');
        const src = read('node_modules/mineflayer/lib/plugins/time.js');
        assert.ok(patch.includes('diff --git a/node_modules/mineflayer/lib/plugins/time.js'), 'a hunk for time.js');
        for (const line of [
            'const TIME_EVENT_TICKS = 20',
            'const CLOCK_TICK_MS = 50',
            'function setTimeFields (time, doDaylightCycle) {',
            'clockTimer = setInterval(runClocks, CLOCK_TICK_MS)',
            'if (setTimeFields(clockTicks(clock), clock.rate > 0)) changedSinceTimeEvent = true',
            'if (changedSinceTimeEvent && ticksSinceTimeEvent >= TIME_EVENT_TICKS) {',
            'if (clockTimer.unref) clockTimer.unref()',
            'startClocks(ownClock)',
            "bot.on('kicked', stopClocks)",
            "bot.on('end', stopClocks)",
        ]) {
            assert.ok(src.includes(line), `time.js: ${line}`);
            assert.ok(patch.includes(`+${src.split('\n').find((l) => l.includes(line))}`), `patch: ${line}`);
        }
        assert.match(patch, /\+\/\/ v0\.1\.4\.14 \(Mindcraft fork, P-17\): the integrated server of 26\.1 sends update_time rarely/);
        assert.doesNotMatch(src, /bot\.on\('physicsTick'/, 'the clock no longer hangs on physicsTick');
        assert.doesNotMatch(patch, /\r/, 'LF line endings');
    });

    test('a packet with rate 1: 40 ticks later timeOfDay is 40 more and time fired twice (8.1.1, 8.1.2)', async () => {
        const { bot, events, ticks, clockPacket } = timeBot();
        clockPacket(12700, 1);
        assert.equal(events.time, 1, 'the packet fires the event');
        assert.equal(bot.time.timeOfDay, 12700);
        assert.equal(bot.time.isDay, true);
        events.time = 0;
        await ticks(19);
        assert.equal(bot.time.timeOfDay, 12719, 'the fields advance with the ticks');
        assert.equal(bot.time.time, 12719);
        assert.equal(bot.time.bigTime, 12719n);
        assert.equal(events.time, 0, 'no event before the 20th tick');
        await ticks(21);
        assert.equal(bot.time.timeOfDay, 12740, '40 more');
        assert.equal(events.time, 2, 'two events in 40 ticks');
        assert.equal(bot.time.doDaylightCycle, true);
        assert.equal(bot.time.clocks.overworld.totalTicks, 12740);
    });

    test('the riding case: no physicsTick for 2 s (bot.vehicle set), the clock still +40', async () => {
        const { bot, events, ticks, clockPacket } = timeBot();
        clockPacket(5685, 1);
        bot.vehicle = { name: 'oak_boat' };
        bot.emit('mount');
        events.time = 0;
        await ticks(40); // 2 s of the clock and not one physicsTick
        assert.equal(bot.time.timeOfDay, 5725);
        assert.equal(events.time, 2);
    });

    test('the night comes between packets: isDay turns false at 13000, the day and the moon phase follow', async () => {
        const { bot, ticks, clockPacket } = timeBot();
        clockPacket(12990, 1);
        await ticks(10);
        assert.equal(bot.time.timeOfDay, 13000);
        assert.equal(bot.time.isDay, false);
        clockPacket(24000 * 3 - 5, 1);
        assert.equal(bot.time.day, 2);
        await ticks(5);
        assert.equal(bot.time.time, 72000);
        assert.equal(bot.time.timeOfDay, 0);
        assert.equal(bot.time.day, 3);
        assert.equal(bot.time.moonPhase, 3);
        assert.equal(bot.time.isDay, true);
    });

    test('rate 0: the fields stand still and no event fires between packets', async () => {
        const { bot, events, ticks, clockPacket } = timeBot();
        clockPacket(6000, 0);
        assert.equal(bot.time.doDaylightCycle, false);
        events.time = 0;
        await ticks(100);
        assert.equal(bot.time.timeOfDay, 6000);
        assert.equal(bot.time.time, 6000);
        assert.equal(events.time, 0);
    });

    test('a second packet sets the value and fires the event; the tick count starts again', async () => {
        const { bot, events, ticks, clockPacket } = timeBot();
        clockPacket(12000, 1);
        await ticks(15);
        assert.equal(bot.time.timeOfDay, 12015);
        events.time = 0;
        clockPacket(1000, 1); // `time set 1000`
        assert.equal(events.time, 1);
        assert.equal(bot.time.timeOfDay, 1000);
        await ticks(19);
        assert.equal(events.time, 1, 'the 20 ticks count from the packet');
        await ticks(1);
        assert.equal(events.time, 2);
        assert.equal(bot.time.timeOfDay, 1020);
    });

    test('a rate below 1 advances slower; the event waits for a change (8.1.2)', async () => {
        const { bot, events, ticks, clockPacket } = timeBot();
        clockPacket(100, 0.5);
        events.time = 0;
        await ticks(40);
        assert.equal(bot.time.timeOfDay, 120);
        assert.equal(events.time, 2);
    });

    test('the clock of another dimension does not move the fields', async () => {
        const { bot, events, ticks, clockPacket } = timeBot('overworld');
        clockPacket(5000, 1, 1); // the clock of the End
        assert.equal(bot.time.time, 0, 'no clock of the overworld: time 0 as upstream reads it');
        events.time = 0;
        await ticks(40);
        assert.equal(bot.time.time, 0);
        assert.equal(events.time, 0);
        assert.equal(bot.time.clocks.the_end.totalTicks, 5040, 'the End clock still advances');
    });

    test('a stalled event loop: at most 400 ticks in one step', async () => {
        const { bot, ticks, clockPacket } = timeBot();
        clockPacket(0, 1);
        await ticks(1000); // 50 s at once
        assert.equal(bot.time.timeOfDay, 400);
    });

    test('the end of the bot stops the timer; a kick too; a packet after it starts nothing', async () => {
        const { bot, ticks, clockPacket } = timeBot();
        clockPacket(100, 1);
        bot.emit('end');
        await ticks(40);
        assert.equal(bot.time.timeOfDay, 100, 'no tick after the end');
        const kicked = timeBot();
        kicked.clockPacket(100, 1);
        kicked.bot.emit('kicked', 'bye', false);
        await kicked.ticks(40);
        assert.equal(kicked.bot.time.timeOfDay, 100, 'no tick after a kick');
    });

    test('the periodic packet of the dedicated server carries only the age: the step of the timer goes on unbroken', async () => {
        const { bot, events, clockPacket } = timeBot();
        clockPacket(12000, 1);
        events.time = 0;
        // 10 packets with an empty clockUpdates, one every 1030 ms of the clock, the timer stepping between them: the
        // 30 ms rests must add up (0.3 ticks each), so 10.3 s are 206 ticks (a step that started afresh on each packet
        // would make 200)
        for (let i = 0; i < 10; i++) {
            fakeNow += 1030;
            await sleep(80);
            bot._client.emit('update_time', { age: [0, 2000 + i], clockUpdates: [] });
        }
        assert.equal(bot.time.timeOfDay, 12206);
        assert.equal(events.time, 20, 'one event per packet and one at the 20th tick before it (at most once per 20 ticks)');
        assert.equal(bot.time.age, 2009);
    });

    test('a packet with this dimension\'s clock restarts the step: its value is the truth', async () => {
        const { bot, ticks, clockPacket } = timeBot();
        clockPacket(100, 1);
        fakeNow += 1045; // 20 ticks and a rest of 45 ms
        await sleep(80);
        assert.equal(bot.time.timeOfDay, 120);
        clockPacket(500, 1);
        await ticks(1); // 50 ms: one tick, the rest of 45 ms is forgotten
        assert.equal(bot.time.timeOfDay, 501);
    });

    test('a dimension change: the fields follow the clock of the new dimension at once (game event)', async () => {
        const { bot, events, ticks } = timeBot('overworld');
        bot._client.emit('update_time', { age: [0, 1000], clockUpdates: [{ id: 0, totalTicks: 6000, partialTick: 0, rate: 1 }, { id: 1, totalTicks: 18000, partialTick: 0, rate: 0 }] });
        await ticks(10);
        assert.equal(bot.time.timeOfDay, 6010);
        events.time = 0;
        bot.game.dimension = 'the_end'; // through a portal: game.js sets it and emits game
        bot.emit('game');
        assert.equal(bot.time.timeOfDay, 18000);
        assert.equal(bot.time.isDay, false);
        assert.equal(bot.time.doDaylightCycle, false);
        assert.equal(events.time, 1, 'the change fires the event');
        await ticks(40);
        assert.equal(bot.time.timeOfDay, 18000, 'the End clock stands (rate 0)');
        assert.equal(bot.time.clocks.overworld.totalTicks, 6050, 'the overworld clock runs on');
        bot.game.dimension = 'overworld';
        bot.emit('game');
        assert.equal(bot.time.timeOfDay, 6050);
        assert.equal(events.time, 2);
    });

    test('the old packet shape (1.21.8): unchanged, the ticks move nothing', async () => {
        const { bot, events, ticks, oldPacket } = timeBot();
        oldPacket(6000, true);
        assert.equal(events.time, 1);
        assert.equal(bot.time.timeOfDay, 6000);
        assert.equal(bot.time.doDaylightCycle, true);
        events.time = 0;
        await ticks(100);
        assert.equal(bot.time.timeOfDay, 6000);
        assert.equal(events.time, 0);
        oldPacket(18000, false);
        assert.equal(bot.time.timeOfDay, 18000);
        assert.equal(bot.time.doDaylightCycle, false);
        assert.equal(bot.time.isDay, false);
        assert.equal(bot.time.age, 1000);
    });

    test('on the real clock: one second of the timer is 20 ticks, give or take one', async () => {
        const { bot, clockPacket } = timeBot();
        fakeNow = null; // the real performance.now
        clockPacket(1000, 1);
        await sleep(1050);
        assert.ok(bot.time.timeOfDay >= 1019 && bot.time.timeOfDay <= 1022, `timeOfDay ${bot.time.timeOfDay} after 1.05 s`);
    });
});
