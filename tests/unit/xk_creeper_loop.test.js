// Spec v0.1.4.13, 4.3 (part K, engineer E2): the keep-away loop of runCreeperProcedure (src/agent/packs/home/creeper.js)
// is bounded, also for a bot at health 1 whose creeper never leaves its sight and who cannot get away:
//   - the loop ends by itself within the time limit of the procedure (90 s of H6), after fewer than 1,000 iterations;
//   - every iteration waits one tick (the hypothesis of a re-planned goal without a wait, 4.3);
//   - no listener is added by an iteration (the second hypothesis);
//   - creeperMemory does not grow with the iterations (the third hypothesis);
//   - the goal of the path search is set only when it changes, not every tick.
// The cause of F10 was none of these; it is in xk_explosion_packet.test.js. These guard the loop.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeFakeBot, addMob, makeSim } from './home_fake_bot.test.js';

const K = await loadSrc('src/agent/packs/home/creeper.js');

// A bot in the open, no area near, at health 1; a creeper 8 blocks away that stands (frozen) and so never leaves
// sight. With walk and sprint at 0 the bot cannot move, as a bot that is boxed in: every retreat goal stays unreached.
function hurtScene({ health = 1, creeperAt = [50.5, 64, 58.5], frozen = true, speed = 0 } = {}) {
    const world = makeWorld();
    const bot = makeFakeBot({ world, pos: [50.5, 64, 50.5] });
    bot.health = health;
    const creeper = addMob(bot, 'creeper', creeperAt);
    creeper.frozen = frozen;
    const waits = [];
    const sim = makeSim(bot, { walk: speed, sprint: speed, onStep: (s) => waits.push(s.t) });
    const ctx = { areas: [], places: null, settings: {}, log: () => {}, now: sim.now };
    return { bot, creeper, sim, ctx, waits, opts: { now: sim.now, wait: sim.wait } };
}

function listenerCounts(bot) {
    const counts = {};
    for (const name of bot.eventNames()) counts[String(name)] = bot.listenerCount(name);
    return counts;
}

describe('K: the keep-away loop is bounded at health 1 with a creeper that never leaves sight', () => {
    test('ends by itself within the limit of the procedure, fewer than 1,000 iterations, every iteration waits a tick', async () => {
        const s = hurtScene();
        const before = listenerCounts(s.bot);
        const t0 = s.sim.t;
        const res = await K.runCreeperProcedure(s.bot, s.ctx, s.opts);
        const elapsed = s.sim.t - t0;
        assert.equal(res.reason, 'timeout', JSON.stringify(res));
        assert.equal(res.ok, false);
        assert.equal(res.text, 'A creeper is still near me after 90 seconds. I keep away from it and from the buildings.');
        assert.ok(elapsed <= 90_400, `ends at the limit of 90 s: ${elapsed} ms`);
        assert.ok(s.sim.steps < 1000, `fewer than 1,000 iterations: ${s.sim.steps}`);
        assert.ok(s.sim.steps >= 200, `one iteration per 400 ms tick: ${s.sim.steps}`);
        assert.ok(s.waits.every((t, i) => i === 0 || t - s.waits[i - 1] >= 100), 'no iteration without a wait');
        assert.deepEqual(listenerCounts(s.bot), before, 'no listener added by the loop');
        assert.equal(s.bot.pathfinder.goal, null, 'the goal is cleared at the end');
        assert.ok(s.creeper.position.distanceTo(s.bot.entity.position) <= 8.01, 'the creeper never left sight');
    });

    test('the goal is set only when it changes, not every tick; the memory of the watch stays small', async () => {
        const s = hurtScene();
        await K.runCreeperProcedure(s.bot, s.ctx, s.opts);
        const goals = s.bot.calls.filter((c) => c[0] === 'setGoal' && c[1] !== null).length;
        assert.ok(goals < s.sim.steps / 4, `goals set ${goals} in ${s.sim.steps} iterations`);
        const memory = K.creeperMemory(s.bot);
        const samples = [...memory.watch.seen.values()].reduce((n, list) => n + list.length, 0);
        assert.ok(samples <= 12, `the positions kept per creeper are those of the last 4 s: ${samples}`);
        assert.ok(memory.watch.standingUntil.size <= 1);
        assert.equal(memory.tries, 0, 'no lure without an area');
    });

    test('a creeper that comes close to a bot that cannot move: back off every tick, still bounded', async () => {
        const s = hurtScene({ frozen: false, creeperAt: [50.5, 64, 54.5] });
        const t0 = s.sim.t;
        const res = await K.runCreeperProcedure(s.bot, s.ctx, s.opts);
        assert.equal(res.reason, 'timeout');
        assert.ok(res.steps.includes('back_off'), res.steps.join());
        assert.ok(s.sim.t - t0 <= 90_400);
        assert.ok(s.sim.steps < 1000, `iterations ${s.sim.steps}`);
    });

    test('a shorter limit holds too: 30 s of simulated time', async () => {
        const s = hurtScene();
        const t0 = s.sim.t;
        const res = await K.runCreeperProcedure(s.bot, s.ctx, { ...s.opts, maxMs: 30_000 });
        assert.equal(res.reason, 'timeout');
        assert.ok(s.sim.t - t0 <= 30_400, `${s.sim.t - t0} ms`);
        assert.ok(s.sim.steps < 1000 && s.sim.steps >= 70, `iterations ${s.sim.steps}`);
    });

    test('an interrupt ends the loop within one tick, also at health 1', async () => {
        const s = hurtScene();
        const inner = s.sim.wait;
        let n = 0;
        const wait = async (ms) => { if (++n === 5) s.bot.interrupt_code = true; await inner(ms); };
        const res = await K.runCreeperProcedure(s.bot, s.ctx, { now: s.sim.now, wait });
        assert.equal(res.reason, 'interrupted');
        assert.equal(n, 5, 'no further iteration after the interrupt');
    });

    test('a bot whose velocity an explosion made absurd is not the business of the loop: it still ends', async () => {
        // the defect of F10 was outside this loop (xk_explosion_packet.test.js); the loop itself reads positions only
        const s = hurtScene();
        s.bot.entity.velocity.y = 520958225940479.94;
        const t0 = s.sim.t;
        const res = await K.runCreeperProcedure(s.bot, s.ctx, s.opts);
        assert.equal(res.reason, 'timeout');
        assert.ok(s.sim.t - t0 <= 90_400 && s.sim.steps < 1000);
    });
});
