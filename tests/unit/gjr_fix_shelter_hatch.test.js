// Release v0.1.4.10, fix round, T3-4 (engineer E3): "let's sleep" with the bed in the basement answered
// `I cannot get into the shelter "basement". I cannot walk through the trapdoor at (598, 60, -3).` The walk into a
// shelter through a trapdoor takes the ladder column under it (ladderStepTowards of library/ladder_pass.js), as
// every other walk does. The fake bot of the mining pack: its physics slides down ladders and climbs them; its
// path search finds no way down or up the shaft (the defect of the journey), so only the ladder step gets there.
// The shaft: ladders facing south at (2, 41..59, -2), an oak trapdoor at (2, 60, -2), grass at y 60, the
// basement at y 41..43.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeMiningBot, makeClock } from './mining_fake_bot.test.js';

const S = await loadSrc('src/agent/packs/home/shelter.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

const HATCH = Object.freeze({ x: 2, y: 60, z: -2, kind: 'trapdoor' });
const basement = (extra = {}) => ({
    name: 'basement', type: 'home', dimension: 'overworld', source: 'scan',
    min: { x: -1, y: 40, z: -3 }, max: { x: 5, y: 44, z: 3 }, entrances: [{ ...HATCH }], ...extra,
});
// the floor above: the room of the house over the trapdoor, y 61 to 63
const upstairs = () => ({
    name: 'house', type: 'home', dimension: 'overworld', source: 'scan',
    min: { x: -2, y: 60, z: -4 }, max: { x: 6, y: 64, z: 4 }, entrances: [{ ...HATCH }],
});

function noPath() {
    const err = new Error('No path to the goal!');
    err.name = 'NoPath';
    return err;
}

function scene(pos, { open = false, opens = true } = {}) {
    const world = makeWorld({ groundY: 60 });
    world.fill(0, 41, -2, 4, 43, 2, 'air');
    world.fill(2, 44, -2, 2, 59, -2, 'air');
    world.fill(2, 41, -2, 2, 59, -2, 'ladder', { facing: 'south' });
    world.set(2, 60, -2, 'oak_trapdoor', { facing: 'south', half: 'top', open });
    const solid = world.solid;
    world.solid = (x, y, z) => (world.nameAt(x, y, z).endsWith('_trapdoor') && world.propsAt(x, y, z).open === true ? false : solid(x, y, z));
    const bot = makeMiningBot({ world, pos });
    const clock = makeClock(bot);
    bot.findBlocks = () => [];
    bot.time = { timeOfDay: 18000 };
    bot.clicks = [];
    bot.activateBlock = async (block) => {
        const p = block.position;
        bot.clicks.push({ x: p.x, y: p.y, z: p.z });
        if (opens) world.set(p.x, p.y, p.z, world.nameAt(p.x, p.y, p.z), { ...world.propsAt(p.x, p.y, p.z), open: world.propsAt(p.x, p.y, p.z).open !== true });
    };
    // the path search of the journey: no way between the floors through the shaft
    const goto = bot.pathfinder.goto.bind(bot.pathfinder);
    bot.pathfinder.goto = async (goal) => {
        const here = bot.entity.position.y;
        if (Number.isFinite(goal?.y) && Math.abs(goal.y - here) >= 3) {
            bot.calls.push(['goto', goal.x, goal.y, goal.z]);
            throw noPath();
        }
        return goto(goal);
    };
    const logs = [];
    const ctx = { areas: [], places: null, settings: {}, log: t => logs.push(t), now: clock.now };
    const feet = () => ({ x: Math.floor(bot.entity.position.x), y: Math.floor(bot.entity.position.y + 0.01), z: Math.floor(bot.entity.position.z) });
    return { world, bot, clock, ctx, logs, feet };
}

const opts = (s, extra = {}) => ({ now: s.clock.now, wait: s.clock.wait, checkMs: 60, timeoutMs: 20000, ...extra });

describe('T3-4: into the shelter through a trapdoor', () => {
    test('the basement below the closed trapdoor: down the ladder, inside, the trapdoor closed and read back', async () => {
        const s = scene([2.5, 61, -0.5]);
        s.ctx.areas = [basement()];
        const r = await S.goToShelter(s.bot, s.ctx, opts(s));
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.equal(r.where, 'basement');
        assert.equal(r.text, 'I went down the ladder at (2, 60, -2). I am in the shelter "basement". The door is closed.');
        assert.ok(s.feet().y >= 41 && s.feet().y <= 43, JSON.stringify(s.feet()));
        assert.equal(s.world.propsAt(2, 60, -2).open, false, 'the trapdoor is closed again');
        assert.ok(s.logs.includes('I go down the ladder at (2, 60, -2) to (2, 41, 0).') || s.logs.some(l => l.startsWith('I go down the ladder at (2, 60, -2) to ')),
            JSON.stringify(s.logs));
        assert.ok(!r.text.includes('I cannot walk through the trapdoor'));
    });

    test('the bot 4 blocks from the trapdoor: it walks to it first, then the ladder', async () => {
        const s = scene([6.5, 61, 3.5]);
        s.ctx.areas = [basement()];
        const r = await S.goToShelter(s.bot, s.ctx, opts(s));
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.match(r.text, /^I went down the ladder at \(2, 60, -2\)\. I am in the shelter "basement"\./);
    });

    test('the floor above, from the basement: up the ladder, the trapdoor opened from below', async () => {
        const s = scene([2.5, 41, 0.5]);
        s.ctx.areas = [upstairs()];
        const r = await S.goToShelter(s.bot, s.ctx, opts(s));
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.match(r.text, /^I climbed up the ladder at \(2, 60, -2\)\. I am in the shelter "house"\./);
        assert.ok(s.feet().y >= 61, JSON.stringify(s.feet()));
        assert.deepEqual(s.bot.clicks[0], { x: 2, y: 60, z: -2 });
    });

    test('a trapdoor that does not open: no_path with the text of the pass; nothing claims the bot is inside', async () => {
        const s = scene([2.5, 61, -0.5], { opens: false });
        s.ctx.areas = [basement()];
        const r = await S.goToShelter(s.bot, s.ctx, opts(s));
        assert.deepEqual({ ok: r.ok, reason: r.reason }, { ok: false, reason: 'no_path' });
        assert.equal(r.text, 'I cannot get into the shelter "basement". I could not go down the ladder at (2, 60, -2): the trapdoor did not open.');
        assert.equal(s.feet().y, 61);
    });

    test('no ladder under the trapdoor: no_path, and a learned route is asked (the route hook of goToShelter)', async () => {
        const s = scene([2.5, 61, -0.5]);
        s.world.fill(2, 41, -2, 2, 59, -2, 'stone');
        const asked = [];
        s.ctx.areas = [basement()];
        s.ctx.routes = { walkTo: async (_bot, target) => { asked.push(target.name); return { ok: false, reason: 'no_route', text: '' }; } };
        const r = await S.goToShelter(s.bot, s.ctx, opts(s));
        assert.deepEqual({ ok: r.ok, reason: r.reason }, { ok: false, reason: 'no_path' });
        assert.equal(r.text, 'I cannot get into the shelter "basement". I found no way through the trapdoor at (2, 60, -2).');
        assert.deepEqual(asked, ['basement']);
    });

    test('stopped on the ladder: interrupted, the controls released', async () => {
        const s = scene([2.5, 61, -0.5]);
        s.ctx.areas = [basement()];
        s.clock.onTick = () => {
            if (s.bot.entity.position.y < 52) s.bot.interrupt_code = true;
        };
        const r = await S.goToShelter(s.bot, s.ctx, opts(s));
        assert.deepEqual({ ok: r.ok, reason: r.reason }, { ok: false, reason: 'interrupted' });
        assert.equal(r.text, 'I stopped on my way to the shelter.');
        assert.ok(Object.values(s.bot.controls).every(on => on === false), JSON.stringify(s.bot.controls));
    });

    test('a door entrance is still passed with passThrough (no ladder step)', async () => {
        const s = scene([2.5, 61, -0.5]);
        s.ctx.areas = [basement({ entrances: [{ x: 9, y: 61, z: 9, kind: 'door' }] })];
        const r = await S.goToShelter(s.bot, s.ctx, opts(s));
        assert.equal(r.ok, false);
        assert.ok(!/ladder/.test(r.text), r.text);
    });
});
