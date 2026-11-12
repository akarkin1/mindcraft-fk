// E3, spec v0.1.4.16 F8 (the play of 2026-11-11: the model said night by day): one clock. dayPhase of src/agent/clock_logic.js
// gives morning 0 to 5999, afternoon 6000 to 11999, evening 12000 to 12999, night 13000 to 22999, dawn 23000 to 23999;
// !stats, the full state and the watch's phaseOf say its labels Morning, Afternoon, Evening, Night, Dawn; isNight of
// night_logic.js is the phase night (the shelter reflex keeps its own start at sunset, isShelterNight). The labels are
// checked on the clock of the real time plugin of mineflayer fed with the update_time packets of 26.1 (as xl_time_runs
// records them: clockUpdates with the ticks of the clock).
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { phaseOf } from '../../src/agent/watch/tools.js';

const C = await loadSrc('src/agent/clock_logic.js');
const N = await loadSrc('src/agent/packs/home/night_logic.js');
const require = createRequire(import.meta.url);
const injectTime = require('mineflayer/lib/plugins/time.js');

const bots = [];
after(() => { for (const bot of bots) bot.emit('end'); });

// a bot with the real time plugin, as xl_time_runs builds it; `at(totalTicks)` sends the clock packet of 26.1
function timeBot() {
    const bot = new EventEmitter();
    bot._client = new EventEmitter();
    bot.registry = { dimensionsById: { 0: { name: 'overworld' }, 1: { name: 'the_end' } } };
    bot.game = { dimension: 'overworld' };
    injectTime(bot);
    bots.push(bot);
    bot.at = (totalTicks) => bot._client.emit('update_time', { age: [0, 1000], clockUpdates: [{ id: 0, totalTicks, partialTick: 0, rate: 1 }] });
    return bot;
}

const FIVE = [[1000, 'morning', 'Morning'], [7000, 'afternoon', 'Afternoon'], [12500, 'evening', 'Evening'], [18000, 'night', 'Night'], [23500, 'dawn', 'Dawn']];

describe('F8: dayPhase, the one clock', () => {
    test('the five parts of the day and their bounds', () => {
        for (const [t, phase] of FIVE) {
            assert.equal(C.dayPhase(t), phase, String(t));
        }
        assert.deepEqual([0, 5999, 6000, 11999, 12000, 12999, 13000, 22999, 23000, 23999].map(C.dayPhase),
            ['morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening', 'night', 'night', 'dawn', 'dawn']);
        assert.equal(C.dayPhase(24000 + 7000), 'afternoon', 'modulo one day');
        assert.equal(C.dayPhase(-1000), 'dawn', '-1000 is 23000');
        assert.equal(C.dayPhase(12999.9), 'evening', 'a fraction of a tick');
        assert.equal(C.dayPhase(NaN), null);
        assert.equal(C.dayPhase(undefined), null);
        assert.deepEqual(C.DAY_PHASES, { morning: 0, afternoon: 6000, evening: 12000, night: 13000, dawn: 23000 });
    });

    test('the labels, word for word', () => {
        assert.deepEqual(C.PHASE_LABELS, { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Night', dawn: 'Dawn' });
        for (const [t, , label] of FIVE) {
            assert.equal(C.dayPhaseLabel(t), label, String(t));
            assert.equal(phaseOf(t), label, `the watch at ${t}`);
        }
        assert.equal(C.dayPhaseLabel(NaN), 'Unknown');
        assert.equal(C.dayPhaseLabel(NaN, 'unknown'), 'unknown');
        assert.equal(phaseOf(undefined), 'unknown');
    });

    test('isNight is the phase night; the shelter reflex keeps its start at sunset', () => {
        assert.equal(N.PHASE_NIGHT_START, C.DAY_PHASES.night, 'one clock: night_logic.js (pure) holds the same start');
        for (let t = 0; t < 24000; t += 250) {
            assert.equal(N.isNight(t), C.dayPhase(t) === 'night', String(t));
        }
        assert.equal(N.isNight(12542), false, 'the game\'s sleep window begins at 12542, the evening of the clock');
        assert.equal(N.isShelterNight(12000), true);
        assert.equal(N.isShelterNight(12542), true);
        assert.equal(N.isShelterNight(13000), true);
        assert.equal(N.isShelterNight(23000), false);
        const base = { inShelter: false, action: '', order: null, selfPrompting: false, lastAttempt: null, now: 1000 };
        assert.deepEqual(N.shouldShelter({ ...base, timeOfDay: 12500 }), { go: true, reason: 'night' }, 'the reflex goes at sunset as before');
        assert.deepEqual(N.shouldShelter({ ...base, timeOfDay: 11000 }), { go: false, reason: 'day' });
        assert.equal(N.orderedThisNight({ at: 500, atTimeOfDay: 12200 }, 12500, 1000), true, 'an order at sunset belongs to this night');
    });

    test('on the clock of the time plugin with the update_time packets of 26.1 the label is right at five times', () => {
        const bot = timeBot();
        for (const [t, , label] of FIVE) {
            bot.at(t);
            assert.ok(Math.abs(bot.time.timeOfDay - t) <= 2, `the clock reads ${bot.time.timeOfDay} for ${t}`);
            assert.equal(C.dayPhaseLabel(bot.time.timeOfDay), label, String(t));
            assert.equal(phaseOf(bot.time.timeOfDay), label);
        }
        bot.at(24000 * 3 + 12500);
        assert.equal(C.dayPhaseLabel(bot.time.timeOfDay), 'Evening', 'the fourth day');
    });
});
