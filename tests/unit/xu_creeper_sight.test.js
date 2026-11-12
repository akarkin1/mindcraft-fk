// Spec v0.1.4.16 (part A, engineer E1), F1 the creeper reflex: a creeper counts only in sight, within 16 blocks and within 3
// blocks of the bot's level (the 6-block bypass of the sight check is gone: R-1 and Q-2, creepers 12 blocks below through
// rock); the flee points keep to ground within 1 block of the bot's y and out of the no_enter areas (never into a hole or a
// cave); the walk goes to the ground of the point and drops at most one block a step; the help line is logged on every run
// that reaches 3 tries and said once in 120 s.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeFakeBot, buildHouse, addMob, makeSim } from './home_fake_bot.test.js';

const C = await loadSrc('src/agent/packs/home/creeper_logic.js');
const K = await loadSrc('src/agent/packs/home/creeper.js');

const HELP = 'A creeper keeps following me near the base. I stay away from the buildings. Can you help?';
const p = (x, z, y = 64) => ({ x, y, z });
const box = (name, type, x1, y1, z1, x2, y2, z2, extra = {}) => ({ name, type, min: { x: x1, y: y1, z: z1 }, max: { x: x2, y: y2, z: z2 }, ...extra });
const creeper = (pos, extra = {}) => ({ id: extra.id ?? 7, pos, fuse: false, ...extra });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function state(over = {}) {
    return { botPos: p(50, 50), creepers: [], areas: [], fighting: false, canFight: false, tries: 0, fuseBurning: false, now: 1000, ...over };
}

describe('F1: which creepers count', () => {
    test('a creeper 12 below through rock, 5 blocks sideways, with sight false does not count', () => {
        const dBot = Math.hypot(5, 12);
        assert.equal(C.countsForBot({ dBot, dy: -12, sight: false }), false);
        assert.equal(C.countsForBot({ dBot, dy: -12, sight: true }), false, '12 below is beyond 3 blocks of height, seen or not');
        const d = C.decide(state({ botPos: p(50, 50, 64), creepers: [creeper(p(55, 50, 52), { sight: false })] }));
        assert.equal(d.step, 'none');
        assert.equal(d.reason, 'no_creeper');
    });

    test('the same creeper at |dy| 3 in sight counts', () => {
        assert.equal(C.countsForBot({ dBot: Math.hypot(5, 3), dy: -3, sight: true }), true);
        assert.equal(C.countsForBot({ dBot: Math.hypot(5, 3), dy: 3, sight: true }), true);
        const d = C.decide(state({ botPos: p(50, 50, 64), creepers: [creeper(p(55, 50, 61), { sight: true })] }));
        assert.equal(d.step, 'run');
        assert.equal(C.decide(state({ botPos: p(50, 50, 64), creepers: [creeper(p(55, 50, 61), { sight: false })] })).step, 'none', 'at |dy| 3 behind rock: no');
    });

    test('a creeper at 5 blocks with sight false (behind a wall) does not count: the bypass is gone', () => {
        assert.equal(C.countsForBot({ dBot: 5, dy: 0, sight: false }), false);
        assert.equal(C.countsForBot({ dBot: 2, dy: 0, sight: false }), false, 'however close');
        assert.equal(C.countsForBot({ dBot: 5, dy: 0, sight: true }), true);
        assert.equal(C.countsForBot({ dBot: 5, dy: 0 }), true, 'sight not measured counts as seen');
        const d = C.decide(state({ creepers: [creeper(p(50, 55), { sight: false })] }));
        assert.equal(d.step, 'none');
        assert.equal(C.CREEPER_RULES.botHeight, 3);
        assert.equal(C.CREEPER_RULES.noticeDistance, 16);
        assert.equal('botClose' in C.CREEPER_RULES, false);
    });

    test('an area creeper needs sight too: a creeper under the floor of the base through rock is no area creeper', () => {
        const home = box('home', 'home', 0, 63, 0, 8, 69, 8);
        assert.equal(C.countsForArea(home, p(4, 12, 61), false), false, 'sight false');
        assert.equal(C.countsForArea(home, p(4, 12, 61), true), true, 'min.y - 2, in sight');
        assert.equal(C.countsForArea(home, p(4, 12, 61)), true, 'sight not measured');
        const d = C.decide(state({ botPos: p(4.5, 20), areas: [home], creepers: [creeper(p(4.5, 12, 61), { sight: false })] }));
        assert.equal(d.step, 'none');
        assert.equal(C.CREEPER_RULES.areaHeight, 3);
    });
});

describe('F1: the flee candidates keep to the ground and out of the no_enter areas', () => {
    // the ground: 64 everywhere but in the hole (z 26 and beyond: 4 blocks lower)
    const holeBeyond = (z0) => (x, z) => (z >= z0 ? 60 : 64);

    test('clearGroundY: within 1 block of the bot y, never a keep-out area, every candidate without a reader', () => {
        const bot = p(20, 20);
        assert.equal(C.clearGroundY(bot, { x: 20, z: 30 }, () => 64, []), 64);
        assert.equal(C.clearGroundY(bot, { x: 20, z: 30 }, () => 63, []), 63, 'a step down');
        assert.equal(C.clearGroundY(bot, { x: 20, z: 30 }, () => 65, []), 65, 'a step up');
        assert.equal(C.clearGroundY(bot, { x: 20, z: 30 }, () => 60, []), null, '4 blocks lower: a hole');
        assert.equal(C.clearGroundY(bot, { x: 20, z: 30 }, () => 62, []), null, '2 blocks lower');
        assert.equal(C.clearGroundY(bot, { x: 20, z: 30 }, () => null, []), null, 'no ground within 3 blocks down');
        assert.equal(C.clearGroundY(bot, { x: 20, z: 30 }, () => { throw new Error('x'); }, []), null, 'a failing reader: not clear');
        assert.equal(C.clearGroundY(bot, { x: 20, z: 30 }, null, []), 64, 'without a reader: the bot y');
        const cave = box('cave_mouth', 'building', 18, 60, 28, 22, 68, 32, { flags: { no_enter: true } });
        assert.equal(C.clearGroundY(bot, { x: 20, z: 30 }, () => 64, [cave]), null, 'in a no_enter area');
        assert.equal(C.clearGroundY(bot, { x: 20, z: 25 }, () => 64, [cave]), 64, 'beside it');
        const pen = box('pen', 'pen', 18, 60, 28, 22, 68, 32);
        assert.equal(C.clearGroundY(bot, { x: 20, z: 30 }, null, [pen]), null, 'a pen is kept out of too (isKeepOutArea)');
        assert.equal(C.clearGroundY(null, { x: 20, z: 30 }, null, []), null);
    });

    test('back_off skips a point whose ground is 4 blocks lower: the flee point lies on the ground of the bot', () => {
        const bot = p(20, 20);
        const c = creeper(p(20, 16));
        const plain = C.decide(state({ botPos: bot, creepers: [c] }));
        assert.equal(plain.step, 'back_off');
        assert.ok(Math.abs(plain.moveTo.z - 32) < 1e-9, 'without a reader: 12 blocks straight away');
        const d = C.decide(state({ botPos: bot, creepers: [c], groundYAt: holeBeyond(26) }));
        assert.equal(d.step, 'back_off');
        assert.ok(d.moveTo.z < 26, `not into the hole: ${JSON.stringify(d.moveTo)}`);
        assert.equal(d.moveTo.y, 64, 'the y of the ground of the point');
        assert.ok(dist(d.moveTo, c.pos) > dist(bot, c.pos), 'still away from the creeper');
        const stepDown = C.decide(state({ botPos: bot, creepers: [c], groundYAt: (x, z) => (z >= 26 ? 63 : 64) }));
        assert.ok(Math.abs(stepDown.moveTo.z - 32) < 1e-9, 'one block down is fine');
        assert.equal(stepDown.moveTo.y, 63, 'moveTo carries the ground y');
    });

    test('run and help skip a point whose ground is lower and a point in a no_enter area', () => {
        const bot = p(20, 20);
        const c = creeper(p(20, 12));
        const run = C.decide(state({ botPos: bot, creepers: [c], groundYAt: holeBeyond(30) }));
        assert.equal(run.step, 'run');
        assert.ok(run.moveTo.z < 30, `not into the hole: ${JSON.stringify(run.moveTo)}`);
        assert.equal(run.moveTo.y, 64);
        const cave = box('cave_mouth', 'building', 10, 60, 28, 30, 68, 60, { flags: { no_enter: true } });
        const help = C.decide(state({ botPos: bot, creepers: [c], tries: 3, areas: [cave] }));
        assert.equal(help.step, 'help');
        assert.equal(help.text, HELP);
        assert.ok(help.moveTo.z < 28 || help.moveTo.x < 10 || help.moveTo.x > 30, `not into the cave mouth: ${JSON.stringify(help.moveTo)}`);
        assert.ok(dist(help.moveTo, c.pos) > dist(bot, c.pos));
    });

    test('lure and the attention walk keep to the ground too', () => {
        const home = box('home', 'home', 0, 63, 0, 8, 69, 8);
        const bot = p(4.5, 9.5);
        const c = creeper(p(12.5, 13.5));
        const lure = C.decide(state({ botPos: bot, areas: [home], creepers: [c], groundYAt: (x, z) => (x < 4 ? 58 : 64) }));
        assert.equal(lure.step, 'lure');
        assert.ok(lure.moveTo.x >= 4, `not into the drop west of the house: ${JSON.stringify(lure.moveTo)}`);
        assert.equal(lure.moveTo.y, 64);
        const far = C.decide(state({ botPos: p(4.5, 30), areas: [home], creepers: [creeper(p(4.5, 18))], groundYAt: (x, z) => (x > 6 ? null : 64) }));
        assert.equal(far.reason, 'attention');
        assert.ok(far.moveTo.x <= 6, `the attention point avoids the drop: ${JSON.stringify(far.moveTo)}`);
        const nowhere = C.decide(state({ botPos: p(4.5, 30), areas: [home], creepers: [creeper(p(4.5, 18))], groundYAt: () => null }));
        assert.equal(nowhere.step, 'leave_it', 'no clear attention point: the creeper is left alone');
    });
});

describe('F1: the glue (creeper.js)', () => {
    function scene({ botAt = [4.5, 64, 9.5], creeperAt = [4.5, 64, 19], house = true } = {}) {
        const world = makeWorld();
        const area = house ? buildHouse(world) : null;
        const bot = makeFakeBot({ world, pos: botAt });
        const c = creeperAt ? addMob(bot, 'creeper', creeperAt) : null;
        const logs = [];
        const sim = makeSim(bot);
        const ctx = { areas: area ? [area] : [], places: null, settings: {}, log: t => logs.push(t), now: sim.now };
        return { world, area, bot, creeper: c, logs, sim, ctx, opts: { now: sim.now, wait: sim.wait } };
    }

    test('groundReader: the standing y over the highest solid block within 3 blocks down; a hole, water or an unloaded block give null', () => {
        const s = scene({ house: false, botAt: [50.5, 64, 50.5], creeperAt: null });
        const ground = K.groundReader(s.bot);
        assert.equal(ground(55, 50), 64, 'flat ground');
        s.world.set(56, 63, 50, 'air');
        assert.equal(ground(56, 50), 63, 'one step down');
        s.world.fill(57, 60, 50, 57, 63, 50, 'air');
        assert.equal(ground(57, 50), null, 'a hole 4 deep');
        s.world.set(58, 64, 50, 'stone');
        assert.equal(ground(58, 50), 65, 'a step up');
        s.world.set(59, 63, 50, 'water');
        assert.equal(ground(59, 50), null, 'water is no ground');
        s.world.unloaded = (x) => x === 60;
        assert.equal(ground(60, 50), null, 'not loaded');
        assert.equal(K.groundReader(null)(0, 0), null);
    });

    test('the walk: GoalNear with the y of the ground, the movements drop at most one block', async () => {
        const s = scene({ house: false, botAt: [50.5, 64, 50.5], creeperAt: [50.5, 64, 53] });
        const res = await K.runCreeperProcedure(s.bot, s.ctx, s.opts);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(res.steps[0], 'back_off');
        const goals = s.bot.calls.filter(c => c[0] === 'setGoal' && c[1] !== null).map(c => c[1]);
        assert.ok(goals.length > 0, 'a goal was set');
        for (const goal of goals) {
            assert.equal(goal.constructor.name, 'GoalNear', 'GoalNear, not GoalNearXZ');
            assert.equal(goal.y, 64, 'the y of the ground');
        }
        assert.equal(s.bot.pathfinder.movements.maxDropDown, 1);
        assert.equal(K.FLEE_MAX_DROP, 1);
        assert.equal(s.bot.entity.position.y, 64, 'the bot stayed on its level');
    });

    test('the flee of a creeper with a hole in the way: the goal never lies in the hole', async () => {
        const s = scene({ house: false, botAt: [50.5, 64, 50.5], creeperAt: [50.5, 64, 47] });
        s.world.fill(45, 58, 55, 55, 63, 70, 'air'); // a pit 6 deep from z 55 on, straight behind the bot
        await K.runCreeperProcedure(s.bot, s.ctx, { ...s.opts, maxMs: 3000 });
        const goals = s.bot.calls.filter(c => c[0] === 'setGoal' && c[1] !== null).map(c => c[1]);
        assert.ok(goals.length > 0);
        for (const goal of goals) {
            assert.ok(!(goal.x >= 45 && goal.x <= 55 && goal.z >= 55), `a goal in the pit: ${JSON.stringify({ x: goal.x, y: goal.y, z: goal.z })}`);
            assert.equal(goal.y, 64);
        }
    });

    test('the help line: logged on every run that reaches 3 tries, said once in 120 s over four runs', async () => {
        const s = scene();
        const start = s.sim.t;
        const results = [];
        for (const offset of [0, 30_000, 60_000, 125_000]) {
            s.sim.t = start + offset;
            s.bot.entity.position.set(4.5, 64, 9.5);
            s.creeper.position.set(4.5, 64, 19);
            K.creeperMemory(s.bot).tries = 3;
            K.creeperMemory(s.bot).lastSeen = s.sim.t;
            results.push(await K.runCreeperProcedure(s.bot, s.ctx, s.opts));
        }
        for (const res of results) {
            assert.ok(res.steps.includes('help'), res.steps.join());
            assert.equal(res.text, HELP, 'the text of every run is the help line');
        }
        assert.deepEqual(results.map(r => r.say), [true, false, false, true], 'the chat line once in 120 s');
        assert.equal(s.logs.filter(t => t === HELP).length, 4, 'the log line on every run');
        assert.equal(K.creeperMemory(s.bot).lastHelp, start + 125_000, 'lastHelp is set when the line is said');
        assert.equal(K.HELP_EVERY_MS, 120000);
    });

    test('a run without the help step says its text (say true)', async () => {
        const s = scene({ house: false, botAt: [50.5, 64, 50.5], creeperAt: [50.5, 64, 53] });
        const res = await K.runCreeperProcedure(s.bot, s.ctx, s.opts);
        assert.equal(res.say, true);
        const none = await K.runCreeperProcedure(scene({ creeperAt: null }).bot, {}, s.opts);
        assert.equal(none.say, true);
    });
});
