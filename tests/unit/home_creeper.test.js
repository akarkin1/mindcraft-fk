// Spec v0.1.4.6 H6: src/agent/packs/home/creeper.js -- runCreeperProcedure moves the bot by decide().
// A small simulation moves the bot towards its pathfinder goal and the creeper towards the bot.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeFakeBot, buildHouse, addMob, removeEntity, give, makeSim } from './home_fake_bot.test.js';

const K = await loadSrc('src/agent/packs/home/creeper.js');
const G = await loadSrc('src/agent/packs/home/box_math.js');

const HELP = 'A creeper keeps following me near the base. I stay away from the buildings. Can you help?';

function scene({ botAt = [4.5, 64, 9.5], creeperAt = [4.5, 64, 19], house = true, settings = {} } = {}) {
    const world = makeWorld();
    const area = house ? buildHouse(world) : null;
    const bot = makeFakeBot({ world, pos: botAt });
    const creeper = creeperAt ? addMob(bot, 'creeper', creeperAt) : null;
    const logs = [];
    const track = [];
    const sim = makeSim(bot, { onStep: () => track.push(bot.entity.position.clone()) });
    const ctx = { areas: area ? [area] : [], places: null, settings, log: t => logs.push(t), now: sim.now };
    return { world, area, bot, creeper, logs, sim, ctx, track, opts: { now: sim.now, wait: sim.wait } };
}

describe('readCreepers', () => {
    test('creepers within range, nearest first, with the fuse from metadata[16]', () => {
        const { bot } = scene({ creeperAt: null });
        const far = addMob(bot, 'creeper', [4.5, 64, 40]);
        const near = addMob(bot, 'creeper', [4.5, 64, 14], { metadata: { 16: 1 } });
        const idle = addMob(bot, 'creeper', [8.5, 64, 20], { metadata: { 16: -1 } });
        addMob(bot, 'zombie', [4.5, 64, 12]);
        const list = K.readCreepers(bot, 24);
        assert.deepEqual(list.map(c => c.id), [near.id, idle.id]);
        assert.equal(list[0].fuse, true);
        assert.equal(list[1].fuse, false);
        assert.deepEqual(list[0].pos, { x: 4.5, y: 64, z: 14 });
        assert.equal(K.readCreepers(bot, 24).some(c => c.id === far.id), false);
        assert.deepEqual(K.readCreepers(null), []);
    });
});

describe('canFightCreeper', () => {
    function fighter(over = {}) {
        const s = scene({ house: false, botAt: [50.5, 64, 50.5], creeperAt: [50.5, 64, 58] });
        give(s.bot, over.sword ?? 'stone_sword');
        s.bot.health = over.health ?? 20;
        return s;
    }

    test('a sword of stone or better, health 15, nothing else hostile, no area near', () => {
        const s = fighter();
        assert.equal(K.canFightCreeper(s.bot, s.ctx), true);
        for (const sword of ['iron_sword', 'diamond_sword', 'netherite_sword']) {
            const t = fighter({ sword });
            assert.equal(K.canFightCreeper(t.bot, t.ctx), true, sword);
        }
    });

    test('each missing condition says no', () => {
        for (const sword of ['wooden_sword', 'golden_sword', 'stick']) {
            const t = fighter({ sword });
            assert.equal(K.canFightCreeper(t.bot, t.ctx), false, sword);
        }
        const hurt = fighter({ health: 14 });
        assert.equal(K.canFightCreeper(hurt.bot, hurt.ctx), false, 'health 14');
        const other = fighter();
        addMob(other.bot, 'skeleton', [50.5, 64, 40]);
        assert.equal(K.canFightCreeper(other.bot, other.ctx), false, 'a skeleton within 16');
        const home = fighter();
        home.ctx.areas = [{ name: 'shed', type: 'building', min: { x: 60, y: 63, z: 50 }, max: { x: 64, y: 67, z: 54 } }];
        assert.equal(K.canFightCreeper(home.bot, home.ctx), false, 'an area within 16');
        assert.equal(K.canFightCreeper(null, {}), false);
    });
});

describe('creeperCheck', () => {
    test('decide on the real surroundings', () => {
        const s = scene();
        const d = K.creeperCheck(s.bot, s.ctx);
        assert.equal(d.step, 'lure');
        const none = scene({ creeperAt: null });
        assert.equal(K.creeperCheck(none.bot, none.ctx).step, 'none');
        assert.equal(K.creeperCheck(null, {}).step, 'none');
    });

    test('fighting comes from the setting creeper_fighting', () => {
        const s = scene({ house: false, botAt: [50.5, 64, 50.5], creeperAt: [50.5, 64, 58], settings: { creeper_fighting: true } });
        give(s.bot, 'iron_sword');
        assert.equal(K.creeperCheck(s.bot, s.ctx).step, 'fight');
        s.ctx.settings = { creeper_fighting: false };
        assert.equal(K.creeperCheck(s.bot, s.ctx).step, 'run');
    });
});

describe('runCreeperProcedure', () => {
    test('the owner scenario: a creeper 10 blocks from the house, the bot at the door', async () => {
        const s = scene();
        let pvp = false;
        s.bot.pvp.attack = () => { pvp = true; };
        const res = await K.runCreeperProcedure(s.bot, s.ctx, s.opts);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(res.text, 'I led a creeper away from "home" and lost it.');
        assert.ok(res.steps.includes('lure'), res.steps.join());
        assert.ok(G.distanceToBox(s.area, s.creeper.position) >= 16, 'the creeper is 16 blocks from the house');
        assert.equal(s.track.some(p => G.containsPos(G.interiorBox(s.area), p)), false, 'never went into the house');
        assert.equal(s.bot.calls.some(c => c[0] === 'activate'), false, 'never touched the door');
        assert.equal(pvp, false, 'never bot.pvp');
        assert.ok(s.sim.t - 1_000_000 < 90_000, 'within 90 s');
    });

    test('a creeper within 5 blocks away from any base: back off', async () => {
        const s = scene({ house: false, botAt: [50.5, 64, 50.5], creeperAt: [50.5, 64, 53] });
        const res = await K.runCreeperProcedure(s.bot, s.ctx, s.opts);
        assert.equal(res.ok, true);
        assert.equal(res.steps[0], 'back_off');
        assert.equal(res.text, 'I backed off from a creeper.');
        assert.ok(s.bot.entity.position.distanceTo(s.creeper.position) > 16);
    });

    test('back off and run sprint, the lure walks', async () => {
        const s = scene();
        const seen = [];
        s.sim.wait = ((inner) => async (ms) => {
            seen.push(s.bot.pathfinder.movements?.allowSprinting);
            await inner(ms);
        })(s.sim.wait);
        await K.runCreeperProcedure(s.bot, s.ctx, { now: s.sim.now, wait: s.sim.wait });
        assert.ok(seen.includes(false), 'walked while luring');
        assert.ok(seen.includes(true), 'sprinted while running');
    });

    test('no creeper: ends at once', async () => {
        const s = scene({ creeperAt: null });
        const res = await K.runCreeperProcedure(s.bot, s.ctx, s.opts);
        assert.deepEqual({ ok: res.ok, steps: res.steps }, { ok: true, steps: [] });
        assert.equal(res.text, 'No creeper is near me.');
    });

    test('an interrupt ends it', async () => {
        const s = scene();
        const inner = s.sim.wait;
        let n = 0;
        const wait = async (ms) => { if (++n === 3) s.bot.interrupt_code = true; await inner(ms); };
        const res = await K.runCreeperProcedure(s.bot, s.ctx, { now: s.sim.now, wait });
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'interrupted');
        assert.equal(s.bot.pathfinder.goal, null, 'the goal is cleared');
    });

    test('an upper limit of time', async () => {
        const s = scene();
        const res = await K.runCreeperProcedure(s.bot, s.ctx, { ...s.opts, maxMs: 1500 });
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'timeout');
        assert.ok(s.sim.t - 1_000_000 <= 1900);
        assert.equal(typeof res.text, 'string');
        assert.ok(s.bot.modes.paused.includes('unstuck'), 'unstuck paused while waiting');
    });

    // Amendment 2, F3. Before, the bot waited 90 s for a creeper that did not come.
    test('F3: a creeper that stands near the house: 2 attention tries, then it is left alone', async () => {
        const s = scene({ botAt: [4.5, 64, 22], creeperAt: [4.5, 64, 10.5] });
        s.creeper.frozen = true;
        const res = await K.runCreeperProcedure(s.bot, s.ctx, s.opts);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(res.reason, 'leave_it');
        assert.equal(res.text, 'A creeper stands near "home" and does not follow me. I keep away from it.');
        assert.equal(res.steps[res.steps.length - 1], 'leave_it');
        assert.ok(s.sim.t - 1_000_000 < 45_000, `well within 90 s: ${s.sim.t - 1_000_000} ms`);
        assert.ok(s.track.every(p => p.distanceTo(s.creeper.position) >= 7.9), 'never closer than 8 blocks');
        assert.equal(s.track.some(p => G.containsPos(G.interiorBox(s.area), p)), false, 'never into the house');
        assert.equal(K.creeperMemory(s.bot).tries, 0, 'a creeper that stands is no lure try');
        assert.deepEqual(K.creeperMemory(s.bot).watch.standingIds(s.sim.t), [s.creeper.id]);
    });

    test('F3: a standing creeper does not start the procedure again for 60 s, unless it comes within 10 blocks', async () => {
        const s = scene({ botAt: [4.5, 64, 22], creeperAt: [4.5, 64, 10.5] });
        s.creeper.frozen = true;
        await K.runCreeperProcedure(s.bot, s.ctx, s.opts);
        s.bot.entity.position.z = 26;
        assert.equal(K.creeperCheck(s.bot, s.ctx).step, 'none', 'standing, 15.5 blocks away');
        s.sim.t += 30_000;
        assert.equal(K.creeperCheck(s.bot, s.ctx).step, 'none', 'still within 60 s');
        s.sim.t += 31_000;
        assert.notEqual(K.creeperCheck(s.bot, s.ctx).step, 'none', 'after 60 s it counts again');
        const t = scene({ botAt: [4.5, 64, 22], creeperAt: [4.5, 64, 10.5] });
        t.creeper.frozen = true;
        await K.runCreeperProcedure(t.bot, t.ctx, t.opts);
        t.creeper.position.z = t.bot.entity.position.z - 9;
        assert.notEqual(K.creeperCheck(t.bot, t.ctx).step, 'none', 'within 10 blocks of the bot');
    });

    test('lure attempts are counted; after 3 the bot asks for help, once', async () => {
        const s = scene();
        K.creeperMemory(s.bot).tries = 3;
        K.creeperMemory(s.bot).lastSeen = s.sim.t;
        const res = await K.runCreeperProcedure(s.bot, s.ctx, s.opts);
        assert.ok(res.steps.includes('help'), res.steps.join());
        assert.equal(res.text, HELP);
        assert.equal(s.logs.filter(t => t === HELP).length, 1);
    });

    test('tries grow with each run that had to lure and reset after 2 minutes without creepers', async () => {
        const s = scene();
        const res = await K.runCreeperProcedure(s.bot, s.ctx, s.opts);
        assert.ok(res.steps.includes('lure'));
        assert.equal(K.creeperMemory(s.bot).tries, 1);
        s.sim.t += 121_000;
        removeEntity(s.bot, s.creeper);
        await K.runCreeperProcedure(s.bot, s.ctx, s.opts);
        assert.equal(K.creeperMemory(s.bot).tries, 0);
    });

    test('fighting: one hit, then back beyond 6 blocks, until the creeper is gone', async () => {
        const s = scene({ house: false, botAt: [50.5, 64, 50.5], creeperAt: [50.5, 64, 58], settings: { creeper_fighting: true } });
        give(s.bot, 'stone_sword');
        let hp = 20;
        const distances = [];
        s.bot.onAttack = (e) => {
            distances.push(s.bot.entity.position.distanceTo(e.position));
            hp -= 5;
            if (hp <= 0) removeEntity(s.bot, e);
        };
        let pvp = false;
        s.bot.pvp.attack = () => { pvp = true; };
        const res = await K.runCreeperProcedure(s.bot, s.ctx, s.opts);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.ok(res.steps.includes('fight'));
        assert.equal(distances.length, 4, 'four hits of a stone sword');
        assert.ok(distances.every(d => d <= 3.5), 'hit within reach');
        assert.equal(pvp, false);
        assert.ok(s.bot.calls.some(c => c[0] === 'equip' && c[1] === 'stone_sword'));
        assert.equal(res.text, 'I fought a creeper and it is gone.');
    });

    test('a burning fuse during the fight: no hit, back off', async () => {
        const s = scene({ house: false, botAt: [50.5, 64, 50.5], creeperAt: [50.5, 64, 58], settings: { creeper_fighting: true } });
        give(s.bot, 'stone_sword');
        s.creeper.metadata[16] = 1;
        const res = await K.runCreeperProcedure(s.bot, s.ctx, { ...s.opts, maxMs: 4000 });
        assert.equal(s.bot.calls.some(c => c[0] === 'attack'), false);
        assert.equal(res.steps[0], 'back_off');
    });

    test('a broken bot never throws', async () => {
        const res = await K.runCreeperProcedure(null, {}, {});
        assert.equal(res.ok, false);
        const s = scene();
        s.bot.pathfinder.setGoal = () => { throw new Error('no pathfinder'); };
        const r2 = await K.runCreeperProcedure(s.bot, s.ctx, { ...s.opts, maxMs: 2000 });
        assert.equal(typeof r2.ok, 'boolean');
    });
});
