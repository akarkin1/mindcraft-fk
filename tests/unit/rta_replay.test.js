// Spec v0.1.4.9, part A (engineer E1): walking a route (I3) and walking to a target by a route (I4) on the
// fake bot of the mining pack, which slides down and climbs ladders with the control states. The shaft of
// the base of the world tests: the room at y 41 (floor 40), ladders facing south from y 41 to 59 on a stone
// wall at z -3, a closed oak trapdoor at (2, 60, -2) in the grass (feet 61 above it).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeMiningBot, makeClock } from './mining_fake_bot.test.js';

const P = await loadSrc('src/agent/packs/routes/index.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

const T = { kind: 'trapdoor', name: 'oak_trapdoor', x: 2, y: 60, z: -2 };
const st = (x, y, z, extra = {}) => ({ x, y, z, on: 'stone', at: 'air', sky: false, t: 0, via: null, ...extra });
const UP = [st(2, 41, 1), st(2, 41, 0), st(2, 41, -1)];
for (let y = 41; y <= 59; y++) UP.push(st(2, y, -2, { at: 'ladder', via: y === 59 ? T : null }));
UP.push(st(2, 61, -3), st(1, 61, -2), st(0, 61, -1), st(-1, 61, 0), st(-2, 61, 1), st(-3, 61, 2));

function baseWorld({ ladders = true } = {}) {
    const world = makeWorld({ groundY: 60 });
    world.fill(0, 41, -2, 4, 43, 2, 'air');
    world.fill(2, 44, -2, 2, 59, -2, 'air');
    if (ladders) world.fill(2, 41, -2, 2, 59, -2, 'ladder', { facing: 'south' });
    world.set(2, 60, -2, 'oak_trapdoor', { facing: 'south', half: 'top', open: false });
    const solid = world.solid;
    world.solid = (x, y, z) => {
        if (world.nameAt(x, y, z).endsWith('_trapdoor') && world.propsAt(x, y, z).open === true) return false;
        return solid(x, y, z);
    };
    return world;
}

function scene({ pos = [2.5, 41, 1.5], ladders = true } = {}) {
    const world = baseWorld({ ladders });
    const bot = makeMiningBot({ world, pos });
    const clock = makeClock(bot);
    const progress = [];
    bot.modes = { noteProgress: reason => progress.push(reason) };
    bot.failActivations = 0;
    bot.activateBlock = async (block) => {
        const p = block.position;
        bot.calls.push(['activate', p.x, p.y, p.z]);
        if (bot.failActivations > 0) {
            bot.failActivations--;
            return;
        }
        world.set(p.x, p.y, p.z, world.nameAt(p.x, p.y, p.z), { ...world.propsAt(p.x, p.y, p.z), open: world.propsAt(p.x, p.y, p.z).open !== true });
    };
    const logs = [];
    const ctx = { now: clock.now, log: t => logs.push(t) };
    const faceAt = (x, y, z) => (world.nameAt(x, y, z) === 'ladder' ? world.propsAt(x, y, z).facing : null);
    const route = {
        name: 'bed', dimension: 'overworld', from: { name: 'storage', kind: 'place', x: 2, y: 41, z: 1 }, to: { name: 'bed', x: -3, y: 61, z: 2 },
        legs: P.routeFromSteps(UP, { faceAt }).legs, steps: UP.length, source: 'trail',
    };
    return { world, bot, clock, ctx, route, progress, logs, opts: { clock } };
}

const feet = bot => [Math.floor(bot.entity.position.x), Math.floor(bot.entity.position.y + 0.01), Math.floor(bot.entity.position.z)];
const digs = bot => bot.calls.filter(c => c[0] === 'dig').length;

describe('walkRoute (I3)', () => {
    test('W62: from the room up the ladder, the closed trapdoor opened from below, to the bed', async () => {
        const s = scene();
        assert.deepEqual(s.route.legs.map(l => l.kind), ['walk', 'ladder', 'door', 'walk']);
        const r = await P.walkRoute(s.bot, s.ctx, s.route, s.opts);
        assert.deepEqual({ ok: r.ok, reason: r.reason, text: r.text, leg: r.leg }, { ok: true, reason: null, text: 'I followed the route "bed", 4 steps.', leg: null });
        assert.deepEqual(feet(s.bot), [-3, 61, 2]);
        assert.deepEqual(r.at, { x: -3, y: 61, z: 2 });
        assert.equal(s.world.propsAt(2, 60, -2).open, false, 'F35: closed again by walkRoute once the bot stands beside it');
        assert.deepEqual(s.bot.calls.filter(c => c[0] === 'activate'), [['activate', 2, 60, -2], ['activate', 2, 60, -2]], 'one click to open, one to close');
        assert.equal(digs(s.bot), 0);
        assert.deepEqual(s.progress, ['route', 'route', 'route', 'route'], 'noteProgress after every leg');
    });

    test('W63: the other way, the trapdoor opened from above, down the ladder, into the room', async () => {
        const s = scene({ pos: [-2.5, 61, 2.5] });
        const r = await P.walkRoute(s.bot, s.ctx, s.route, { ...s.opts, reverse: true });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(feet(s.bot), [2, 41, 1]);
        assert.equal(digs(s.bot), 0);
        assert.deepEqual(s.bot.calls.filter(c => c[0] === 'activate'), [['activate', 2, 60, -2], ['activate', 2, 60, -2]], 'opened from above, closed from 2 blocks below');
        assert.equal(s.world.propsAt(2, 60, -2).open, false, 'the trapdoor is closed behind the bot');
    });

    test('W64: the ladder removed: the text with the step and the position, the trapdoor stays closed, nothing is dug', async () => {
        const s = scene({ pos: [-2.5, 61, 2.5], ladders: false });
        const r = await P.walkRoute(s.bot, s.ctx, s.route, { ...s.opts, reverse: true });
        assert.deepEqual({ ok: r.ok, reason: r.reason, leg: r.leg }, { ok: false, reason: 'no_path', leg: 2 });
        assert.equal(r.text, 'I could not follow the route "bed" at step 3 of 4, at (2, 61, -3). Show me the way again.');
        assert.equal(s.world.propsAt(2, 60, -2).open, false);
        assert.equal(s.bot.entity.position.y, 61, 'the bot did not fall');
        assert.equal(digs(s.bot), 0);
    });

    test('a ladder removed on the way up: the leg of the ladder fails before the climb', async () => {
        const s = scene({ ladders: false });
        const r = await P.walkRoute(s.bot, s.ctx, s.route, s.opts);
        assert.equal(r.text, 'I could not follow the route "bed" at step 2 of 4, at (2, 41, -1). Show me the way again.');
    });

    test('one ladder missing: down the bot slides past the gap, up it does not start the climb', async () => {
        const s = scene({ pos: [-2.5, 61, 2.5] });
        s.world.set(2, 50, -2, 'air');
        const down = await P.walkRoute(s.bot, s.ctx, s.route, { ...s.opts, reverse: true });
        assert.equal(down.ok, true, down.text);
        assert.deepEqual(feet(s.bot), [2, 41, 1]);
        const up = await P.walkRoute(s.bot, s.ctx, s.route, s.opts);
        assert.equal(up.text, 'I could not follow the route "bed" at step 2 of 4, at (2, 41, -1). Show me the way again.');
        assert.equal(P.ladderIntact(s.bot, s.route.legs[1], 1), true);
        assert.equal(P.ladderIntact(s.bot, s.route.legs[1]), false);
    });

    test('a walk leg without a way: the failure at step 1, nothing dug', async () => {
        const s = scene();
        s.bot.noPath = true;
        const r = await P.walkRoute(s.bot, s.ctx, s.route, s.opts);
        assert.deepEqual({ ok: r.ok, reason: r.reason, leg: r.leg }, { ok: false, reason: 'no_path', leg: 0 });
        assert.equal(r.text, 'I could not follow the route "bed" at step 1 of 4, at (2, 41, 1). Show me the way again.');
        assert.equal(digs(s.bot), 0);
    });

    test('a trapdoor that does not open: blocked_door', async () => {
        const s = scene({ pos: [-2.5, 61, 2.5] });
        s.bot.failActivations = 99;
        const r = await P.walkRoute(s.bot, s.ctx, s.route, { ...s.opts, reverse: true });
        assert.deepEqual({ ok: r.ok, reason: r.reason, leg: r.leg }, { ok: false, reason: 'blocked_door', leg: 1 });
        assert.equal(r.text, 'I could not follow the route "bed" at step 2 of 4, at (2, 61, -3). Show me the way again.');
    });

    test('stopped on the ladder: interrupted, the text says the step', async () => {
        const s = scene({ pos: [-2.5, 61, 2.5] });
        s.clock.onTick = () => {
            if (s.bot.entity.position.y < 55) s.bot.interrupt_code = true;
        };
        const r = await P.walkRoute(s.bot, s.ctx, s.route, { ...s.opts, reverse: true });
        assert.deepEqual({ ok: r.ok, reason: r.reason, leg: r.leg }, { ok: false, reason: 'interrupted', leg: 2 });
        assert.equal(r.text, 'I was stopped on the route "bed" at step 3 of 4.');
    });

    test('the time: a deadline that has passed, and a route without legs', async () => {
        const s = scene();
        const r = await P.walkRoute(s.bot, s.ctx, s.route, { ...s.opts, deadline: s.clock.now() - 1 });
        assert.deepEqual({ reason: r.reason, text: r.text }, { reason: 'time', text: 'The time for the route "bed" ran out at step 1 of 4, at (2, 41, 1).' });
        const e = await P.walkRoute(s.bot, s.ctx, { name: 'x', legs: [] }, s.opts);
        assert.deepEqual({ ok: e.ok, reason: e.reason, text: e.text }, { ok: false, reason: 'no_path', text: 'The route "x" has no steps.' });
    });

    test('never throws: a bot without a body, a leg of an unknown kind', async () => {
        const s = scene();
        const r = await P.walkRoute(s.bot, s.ctx, { name: 'odd', legs: [{ kind: 'fly' }] }, s.opts);
        assert.deepEqual({ ok: r.ok, reason: r.reason, leg: r.leg }, { ok: false, reason: 'error', leg: 0 });
        const n = await P.walkRoute({ entity: null }, {}, s.route, s.opts);
        assert.equal(n.ok, false);
    });

    test('a route of legs only (a mine of v0.1.4.7): the walk from its entrance down', async () => {
        const s = scene({ pos: [2.5, 61, -2.5] });
        s.world.set(2, 60, -2, 'oak_trapdoor', { facing: 'south', half: 'top', open: true });
        const mine = { legs: [{ kind: 'ladder', x: 2, z: -2, top: 59, bottom: 41, face: 'south', entry: { x: 2, y: 61, z: -3 } },
            { kind: 'walk', from: { x: 2, y: 41, z: -2 }, to: { x: 3, y: 41, z: 0 } }] };
        const r = await P.walkRoute(s.bot, s.ctx, mine, s.opts);
        assert.equal(r.text, 'I followed the route, 2 steps.');
        assert.deepEqual(feet(s.bot), [3, 41, 0]);
        const back = await P.walkRoute(s.bot, s.ctx, mine, { ...s.opts, reverse: true });
        assert.equal(back.ok, true, back.text);
        assert.deepEqual(feet(s.bot), [2, 61, -3]);
    });
});

describe('walkByRoute (I4)', () => {
    test('no route: no_route and an empty text', async () => {
        const s = scene();
        const r = await P.walkByRoute(s.bot, s.ctx, [], { x: -3, y: 61, z: 3 }, s.opts);
        assert.deepEqual(r, { ok: false, reason: 'no_route', text: '', route: null });
        const far = await P.walkByRoute(s.bot, s.ctx, [s.route], { x: 60, y: 61, z: 3 }, s.opts);
        assert.equal(far.reason, 'no_route');
    });

    test('from the bed to the place "storage": the route backwards, to the target', async () => {
        const s = scene({ pos: [-4.5, 61, 4.5] });
        const r = await P.walkByRoute(s.bot, s.ctx, [s.route], { x: 2, y: 41, z: 1 }, s.opts);
        assert.deepEqual({ ok: r.ok, reason: r.reason, route: r.route }, { ok: true, reason: null, route: 'bed' });
        assert.deepEqual(feet(s.bot), [2, 41, 1]);
        assert.deepEqual(s.logs, ['I take the route "bed".']);
    });

    test('no way to the start of the route: its text', async () => {
        const s = scene({ pos: [-4.5, 61, 4.5] });
        s.bot.noPath = true;
        const r = await P.walkByRoute(s.bot, s.ctx, [s.route], { x: 2, y: 41, z: 1 }, s.opts);
        assert.deepEqual({ ok: r.ok, reason: r.reason, text: r.text }, { ok: false, reason: 'no_path', text: 'I found no way to the start of the route "bed" at (-3, 61, 2).' });
    });
});
