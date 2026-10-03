// T1, spec v0.1.4.9 part A: !rememberRoute (A2), !routes and !forgetRoute (A3), the RouteStore (I2), walking a
// route (I3, A5), the routes on the context (I4) and the hook of the home pack (I5), tested from the spec and the
// handoff (rememberRoute is synchronous, routesText returns a string, forgetRoute returns { ok, reason, text },
// a route stores from.kind). The fake bot and world of the mining pack (tests/unit/mining_fake_bot.test.js); the
// base of the world tests: a room at y 41 (x 0..4, z -2..2), ladders facing south at (2, 41..59, -2), an oak
// trapdoor at (2, 60, -2), the grass at y 60.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { makeWorld, makeMiningBot, makeClock } from './mining_fake_bot.test.js';
import { makeWorld as makeHomeWorld, makeFakeBot as makeHomeBot, v as hv } from './home_fake_bot.test.js';

const P = await loadSrc('src/agent/packs/routes/index.js');
const Z = await loadSrc('src/agent/packs/home/sleep.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

const T = Object.freeze({ kind: 'trapdoor', name: 'oak_trapdoor', x: 2, y: 60, z: -2 });
const st = (x, y, z, extra = {}) => ({ x, y, z, on: 'stone', at: 'air', sky: false, t: 0, via: null, ...extra });
const NOW = () => new Date('2026-09-30T10:00:00Z');

// The way from the room up the ladder through the trapdoor and 10 blocks west on the grass. The trail holds a
// step in the cell of the open trapdoor (y 60), as a trail read every 250 ms on a climb of 4 blocks a second does.
function shaftTrail() {
    const steps = [st(2, 41, 2), st(2, 41, 1), st(2, 41, 0), st(2, 41, -1)];
    for (let y = 41; y <= 59; y++) steps.push(st(2, y, -2, { at: 'ladder', on: y === 41 ? 'stone' : 'air', via: y === 59 ? { ...T } : null }));
    steps.push(st(2, 60, -2, { at: 'oak_trapdoor', on: 'air', via: { ...T } }));
    for (let x = 2; x >= -8; x--) steps.push(st(x, 61, -3, { on: 'grass_block', sky: true }));
    return steps;
}

function baseWorld({ ladders = true, trapdoorOpen = false } = {}) {
    const world = makeWorld({ groundY: 60 });
    world.fill(0, 41, -2, 4, 43, 2, 'air');
    world.fill(2, 44, -2, 2, 59, -2, 'air');
    if (ladders) world.fill(2, 41, -2, 2, 59, -2, 'ladder', { facing: 'south' });
    world.set(2, 60, -2, 'oak_trapdoor', { facing: 'south', half: 'top', open: trapdoorOpen });
    const solid = world.solid;
    world.solid = (x, y, z) => {
        if (world.nameAt(x, y, z).endsWith('_trapdoor') && world.propsAt(x, y, z).open === true) return false;
        return solid(x, y, z);
    };
    return world;
}

function memoryBank(places) {
    return {
        getJson: () => Object.fromEntries(Object.entries(places).map(([n, p]) => [n, [p.x, p.y, p.z]])),
        recallPlaceInfo: (n) => (places[n] ? { ...places[n], dimension: 'overworld' } : undefined),
    };
}

function remembering({ steps = shaftTrail(), places = { storage: { x: 2, y: 41, z: 1 } }, areas = [], mines = null, world = baseWorld() } = {}) {
    const last = steps.at(-1);
    const bot = makeMiningBot({ world, pos: [last.x + 0.5, last.y, last.z + 0.5] });
    const store = new P.RouteStore(null, { now: NOW });
    const trail = { list: () => steps.map((s) => ({ ...s })), tick() {} };
    const ctx = { places: memoryBank(places), areas, routes: { store, trail } };
    if (mines) ctx.mines = { list: () => mines };
    return { bot, store, ctx, steps };
}

const count = (legs, pred) => legs.filter(pred).length;

// --------------------------------------------------------------------------------------- A2

describe('A2: rememberRoute', () => {
    test('from the place "storage": the text of A2 with the number of legs, 1 ladder, 1 trapdoor', () => {
        const s = remembering();
        const r = P.rememberRoute(s.bot, s.ctx, 'bed');
        assert.equal(r.ok, true, r.text);
        assert.equal(r.reason ?? null, null);
        const legs = r.route.legs;
        assert.equal(count(legs, (l) => l.kind === 'ladder'), 1);
        assert.equal(count(legs, (l) => l.kind === 'door' && l.kind2 === 'trapdoor'), 1);
        assert.equal(r.text, `I remember the way "bed": from the place "storage" to here, ${legs.length} steps, 1 ladder, 1 trapdoor. I walk it in both directions.`);
    });

    test('the saved route: name, dimension, from the place, to the bot, source trail, steps of the trail, in the store', () => {
        const s = remembering();
        const r = P.rememberRoute(s.bot, s.ctx, 'bed');
        const saved = s.store.get('bed', 'overworld');
        assert.ok(saved, 'in the store');
        assert.equal(saved.name, 'bed');
        assert.equal(saved.dimension, 'overworld');
        assert.equal(saved.source, 'trail');
        assert.equal(saved.from.name, 'storage');
        assert.ok(Math.hypot(saved.from.x - 2, saved.from.y - 41, saved.from.z - 1) <= 2, `from ${JSON.stringify(saved.from)} is at the place`);
        assert.deepEqual({ name: saved.to.name, x: saved.to.x, y: saved.to.y, z: saved.to.z }, { name: 'bed', x: -8, y: 61, z: -3 }, '`to` is the bot');
        assert.ok(Number.isInteger(saved.steps) && saved.steps >= 20 && saved.steps <= s.steps.length, `steps ${saved.steps}`);
        assert.deepEqual(r.route.legs, saved.legs);
    });

    test('two ladders, a door and a gate: listed in the order ladders, door, gate, trapdoor', () => {
        const D = { kind: 'door', name: 'oak_door', x: 5, y: 46, z: -3 };
        const G = { kind: 'gate', name: 'oak_fence_gate', x: 7, y: 51, z: -6 };
        const steps = [st(2, 41, 1), st(2, 41, 0), st(2, 41, -1)];
        for (let y = 41; y <= 45; y++) steps.push(st(2, y, -2, { at: 'ladder' }));
        for (let x = 2; x <= 8; x++) steps.push(st(x, 46, -3, x === 5 ? { at: 'oak_door', via: { ...D } } : {}));
        for (let y = 46; y <= 50; y++) steps.push(st(9, y, -3, { at: 'ladder' }));
        for (let z = -4; z >= -9; z--) steps.push(st(7, 51, z, z === -6 ? { at: 'oak_fence_gate', via: { ...G } } : {}));
        const world = makeWorld({ groundY: 70 });
        world.fill(2, 41, -2, 2, 45, -2, 'ladder', { facing: 'south' });
        world.fill(9, 46, -3, 9, 50, -3, 'ladder', { facing: 'west' });
        const s = remembering({ steps, world });
        const r = P.rememberRoute(s.bot, s.ctx, 'up');
        assert.equal(r.ok, true, r.text);
        const legs = r.route.legs;
        assert.equal(count(legs, (l) => l.kind === 'ladder'), 2, JSON.stringify(legs.map((l) => l.kind)));
        assert.equal(r.text, `I remember the way "up": from the place "storage" to here, ${legs.length} steps, 2 ladders, 1 door, 1 gate. I walk it in both directions.`);
    });

    test('from an area: `from the area "home"`', () => {
        const home = { name: 'home', type: 'home', min: { x: 0, y: 40, z: -2 }, max: { x: 4, y: 43, z: 2 }, dimension: 'overworld' };
        const steps = [st(2, 41, 2), st(2, 41, 1), st(2, 41, 0), st(3, 41, -1)];
        for (let x = 5; x <= 30; x++) steps.push(st(x, 41, -1));
        const world = makeWorld({ groundY: 30 });
        const s = remembering({ steps, places: {}, areas: [home], world });
        const r = P.rememberRoute(s.bot, s.ctx, 'bed');
        assert.equal(r.ok, true, r.text);
        // v0.1.4.9, decision F18 (E1): an area start names its level (was `from the area "home" to here`)
        assert.equal(r.text, `I remember the way "bed": from the area "home", level 41 to here, ${r.route.legs.length} steps. I walk it in both directions.`);
    });

    test('from a mine (its room): `from the mine "mine"`', () => {
        const mine = { name: 'mine', source: 'player', ore: 'iron', entrance: { x: 30, y: 60, z: 4 }, level: 41, dimension: 'overworld',
            room: { center: { x: 2, y: 41, z: 1 }, chest: { x: 3, y: 41, z: 2 }, table: null, furnace: null }, tunnels: [], passed: [], route: [] };
        const steps = [st(2, 41, 1), st(2, 41, 0), st(3, 41, -1)];
        for (let x = 5; x <= 30; x++) steps.push(st(x, 41, -1));
        const s = remembering({ steps, places: {}, mines: [mine], world: makeWorld({ groundY: 30 }) });
        const r = P.rememberRoute(s.bot, s.ctx, 'bed');
        assert.equal(r.ok, true, r.text);
        assert.match(r.text, /^I remember the way "bed": from the mine "mine" to here, \d+ steps\. I walk it in both directions\.$/);
    });

    test('the name existed: `I know a way "bed" already. I replace it.` in front; one route in the store', () => {
        const s = remembering();
        const first = P.rememberRoute(s.bot, s.ctx, 'bed');
        const r = P.rememberRoute(s.bot, s.ctx, 'bed');
        assert.equal(r.text, `I know a way "bed" already. I replace it. ${first.text}`);
        assert.equal(s.store.size, 1);
    });

    test('no known thing on the trail: reason no_start and its text; nothing saved', () => {
        const s = remembering({ places: {} });
        const r = P.rememberRoute(s.bot, s.ctx, 'bed');
        assert.deepEqual({ ok: r.ok, reason: r.reason, text: r.text },
            { ok: false, reason: 'no_start', text: 'I do not know where this way starts. Stand at a place I know first, then walk with me and tell me again.' });
        assert.equal(s.store.size, 0);
    });

    test('fewer than 2 steps of the trail: reason too_short and its text', () => {
        // FINDING T1-2 (A2, low): a trail of one step at the place "storage" gives no_start, not too_short: the
        // known thing at the last step never counts, so `The way "bed" is too short: I stand where it starts.`
        // can only come when the bot stands at two known things at once.
        const s = remembering({ steps: [st(2, 41, 1)] });
        const r = P.rememberRoute(s.bot, s.ctx, 'bed');
        assert.deepEqual({ ok: r.ok, reason: r.reason, text: r.text }, { ok: false, reason: 'too_short', text: 'The way "bed" is too short: I stand where it starts.' });
        assert.equal(s.store.size, 0);
    });

    test('synchronous, as the handoff says', () => {
        const s = remembering();
        const r = P.rememberRoute(s.bot, s.ctx, 'bed');
        assert.equal(typeof r?.then, 'undefined');
    });
});

// --------------------------------------------------------------------------------------- A3, I2 store

function walkLegs(n, x0 = 0) {
    const legs = [];
    for (let i = 0; i < n; i++) legs.push({ kind: 'walk', from: { x: x0 + i, y: 64, z: 0 }, to: { x: x0 + i + 1, y: 64, z: 0 } });
    return legs;
}
const BED = () => ({ name: 'bed', dimension: 'overworld', from: { name: 'storage', kind: 'place', x: 2, y: 41, z: 1 }, to: { name: 'bed', x: 12, y: 45, z: 8 },
    legs: walkLegs(7), steps: 30, source: 'trail' });
const MINE = () => ({ name: 'mine', dimension: 'overworld', from: { name: 'home', kind: 'area', x: 0, y: 64, z: 0 }, to: { name: 'mine', x: 30, y: 41, z: 4 },
    legs: walkLegs(12), steps: 40, source: 'trail' });

describe('A3: routesText and forgetRoute', () => {
    test('two routes: the text of A3 (the steps are the legs)', () => {
        const store = new P.RouteStore(null, { now: NOW });
        store.set(BED());
        store.set(MINE());
        assert.equal(P.routesText({ routes: { store } }, 'overworld'),
            'I know 2 routes: "bed" from the place "storage" to (12, 45, 8), 7 steps; "mine" from the area "home" to (30, 41, 4), 12 steps.');
    });

    test('no routes: `I know no routes.`', () => {
        assert.equal(P.routesText({ routes: { store: new P.RouteStore(null, { now: NOW }) } }, 'overworld'), 'I know no routes.');
    });

    test('forgetRoute: `Forgot the route "bed".`, then `I know no route "bed".`', () => {
        const store = new P.RouteStore(null, { now: NOW });
        store.set(BED());
        const ctx = { routes: { store } };
        const first = P.forgetRoute(ctx, 'bed', 'overworld');
        assert.equal(first.ok, true);
        assert.equal(first.text, 'Forgot the route "bed".');
        assert.equal(store.get('bed', 'overworld') ?? null, null);
        const again = P.forgetRoute(ctx, 'bed', 'overworld');
        assert.equal(again.ok, false);
        assert.equal(again.text, 'I know no route "bed".');
    });

    test('forgetRoute normalises the name like the areas', () => {
        const store = new P.RouteStore(null, { now: NOW });
        store.set({ ...BED(), name: 'my bed' });
        assert.equal(P.forgetRoute({ routes: { store } }, '  My Bed ', 'overworld').text, 'Forgot the route "my_bed".');
    });
});

describe('I2: RouteStore', () => {
    let dir;
    before(() => {
        dir = makeTmpDir();
    });
    after(() => removeTmpDir(dir));

    test('the file: { version: 1, routes: { "<name>" | "<dim>:<name>": route } }, names normalised; read back by a new store', () => {
        const file = path.join(dir, 'routes.json');
        const store = new P.RouteStore(file, { now: NOW });
        store.set({ ...BED(), name: '  My Bed ' });
        store.set({ ...MINE(), dimension: 'the_nether' });
        assert.equal(store.size, 2);
        const json = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.equal(json.version, 1);
        assert.deepEqual(Object.keys(json.routes).sort(), ['my_bed', 'the_nether:mine']);
        const again = new P.RouteStore(file, { now: NOW });
        again.load();
        assert.equal(again.size, 2);
        assert.equal(again.get('My Bed', 'overworld')?.name, 'my_bed');
        assert.equal(again.get('mine', 'the_nether')?.name, 'mine');
        assert.equal(again.get('mine', 'overworld') ?? null, null, 'by dimension');
        assert.deepEqual(again.list('overworld').map((r) => r.name), ['my_bed']);
        assert.equal(again.get('my_bed', 'overworld').from.kind, 'place', 'handoff: routes store from.kind');
        assert.equal(again.get('my_bed', 'overworld').legs.length, 7);
    });

    test('invalid entries are skipped; a broken file gives an empty store; nothing throws', () => {
        const file = path.join(dir, 'broken.json');
        fs.writeFileSync(file, JSON.stringify({ version: 1, routes: { bed: BED(), odd: { name: 'odd' }, n: 7 } }));
        const store = new P.RouteStore(file, { now: NOW });
        assert.doesNotThrow(() => store.load());
        assert.equal(store.size, 1);
        fs.writeFileSync(file, '{ not json');
        const broken = new P.RouteStore(file, { now: NOW });
        assert.doesNotThrow(() => broken.load());
        assert.equal(broken.size, 0);
        assert.doesNotThrow(() => broken.set({ name: 'x' }));
    });

    test('remove: gone from the store and from the file', () => {
        const file = path.join(dir, 'remove.json');
        const store = new P.RouteStore(file, { now: NOW });
        store.set(BED());
        assert.ok(store.remove('bed', 'overworld'));
        assert.equal(store.size, 0);
        const json = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.deepEqual(json.routes, {});
    });

    test('source is trail or mine', () => {
        const store = new P.RouteStore(null, { now: NOW });
        store.set({ ...BED(), source: 'mine' });
        assert.equal(store.get('bed', 'overworld')?.source, 'mine');
    });
});

// --------------------------------------------------------------------------------------- I3, A5

const feet = (bot) => ({ x: Math.floor(bot.entity.position.x), y: Math.floor(bot.entity.position.y + 0.01), z: Math.floor(bot.entity.position.z) });
const digs = (bot) => bot.calls.filter((c) => c[0] === 'dig').length;

describe('I3: walkRoute on flat ground, 7 walk legs of 4 blocks', () => {
    function flat() {
        const bot = makeMiningBot({ world: makeWorld({ groundY: 63 }), pos: [0.5, 64, 0.5] });
        const clock = makeClock(bot);
        const progress = [];
        bot.modes = { noteProgress: (why) => progress.push(why) };
        const legs = [];
        for (let i = 0; i < 7; i++) legs.push({ kind: 'walk', from: { x: 4 * i, y: 64, z: 0 }, to: { x: 4 * i + 4, y: 64, z: 0 } });
        const route = { name: 'bed', dimension: 'overworld', from: { name: 'storage', kind: 'place', x: 0, y: 64, z: 0 }, to: { name: 'bed', x: 28, y: 64, z: 0 },
            legs, steps: 29, source: 'trail' };
        return { bot, clock, progress, route, ctx: { now: clock.now, log() {} } };
    }

    test('the route is walked; noteProgress("route") after every leg (A5)', async () => {
        const s = flat();
        const r = await P.walkRoute(s.bot, s.ctx, s.route, { clock: s.clock });
        assert.equal(r.ok, true, r.text);
        assert.equal(r.reason, null);
        assert.deepEqual(feet(s.bot), { x: 28, y: 64, z: 0 });
        assert.deepEqual(s.progress, Array(7).fill('route'));
        assert.equal(digs(s.bot), 0);
    });

    test('no way at the third leg: the text of I3 with the step and the position, reason no_path, leg 2, nothing dug', async () => {
        const s = flat();
        s.bot.noPath = new Set(['12,64,0']);
        const r = await P.walkRoute(s.bot, s.ctx, s.route, { clock: s.clock });
        assert.deepEqual({ ok: r.ok, reason: r.reason, leg: r.leg }, { ok: false, reason: 'no_path', leg: 2 });
        // v0.1.4.11, W1: the cause instead of "Show me the way again."
        assert.equal(r.text, 'I could not follow the route "bed" at step 3 of 7: I found no way from (8, 64, 0) to (12, 64, 0).');
        assert.deepEqual(r.at, { x: 8, y: 64, z: 0 });
        assert.equal(digs(s.bot), 0);
    });

    test('stopped after the second leg: `I was stopped on the route "bed" at step 3 of 7.`, reason interrupted', async () => {
        const s = flat();
        s.bot.modes.noteProgress = (why) => {
            s.progress.push(why);
            if (s.progress.length === 2) s.bot.interrupt_code = true;
        };
        const r = await P.walkRoute(s.bot, s.ctx, s.route, { clock: s.clock });
        assert.deepEqual({ ok: r.ok, reason: r.reason, text: r.text }, { ok: false, reason: 'interrupted', text: 'I was stopped on the route "bed" at step 3 of 7.' });
        assert.deepEqual(feet(s.bot), { x: 8, y: 64, z: 0 });
    });

    test('reverse: from the end back to the start', async () => {
        const s = flat();
        s.bot.entity.position = s.bot.entity.position.offset(28, 0, 0);
        const r = await P.walkRoute(s.bot, s.ctx, s.route, { clock: s.clock, reverse: true });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(feet(s.bot), { x: 0, y: 64, z: 0 });
    });

    test('a deadline that has passed: reason time, nothing walked', async () => {
        const s = flat();
        const r = await P.walkRoute(s.bot, s.ctx, s.route, { clock: s.clock, deadline: s.clock.now() - 1 });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'time');
        assert.deepEqual(feet(s.bot), { x: 0, y: 64, z: 0 });
    });
});

describe('I3: a walk leg tried twice, a door leg, A5 no pause', () => {
    function flatDoor({ open = false, opens = true } = {}) {
        const world = makeWorld({ groundY: 63 });
        world.set(5, 64, 0, 'oak_door', { half: 'lower', open, facing: 'east', hinge: 'left' });
        world.set(5, 65, 0, 'oak_door', { half: 'upper', open, facing: 'east', hinge: 'left' });
        const bot = makeMiningBot({ world, pos: [0.5, 64, 0.5] });
        const clock = makeClock(bot);
        const paused = [];
        bot.modes = { noteProgress() {}, pause: (m) => paused.push(m), unpause() {} };
        bot.activateBlock = async (block) => {
            const p = block.position;
            bot.calls.push(['activate', p.x, p.y, p.z]);
            if (!opens) return;
            for (const y of [64, 65]) world.set(p.x, y, p.z, 'oak_door', { ...world.propsAt(p.x, y, p.z), open: !world.propsAt(p.x, y, p.z).open });
        };
        const route = { name: 'house', dimension: 'overworld', from: { name: 'yard', kind: 'place', x: 0, y: 64, z: 0 }, to: { name: 'house', x: 10, y: 64, z: 0 },
            legs: [
                { kind: 'walk', from: { x: 0, y: 64, z: 0 }, to: { x: 4, y: 64, z: 0 } },
                { kind: 'door', kind2: 'door', name: 'oak_door', x: 5, y: 64, z: 0, from: { x: 4, y: 64, z: 0 }, to: { x: 6, y: 64, z: 0 } },
                { kind: 'walk', from: { x: 6, y: 64, z: 0 }, to: { x: 10, y: 64, z: 0 } },
            ], steps: 11, source: 'trail' };
        return { world, bot, clock, paused, route, ctx: { now: clock.now, log() {} } };
    }
    const activations = (bot) => bot.calls.filter((c) => c[0] === 'activate').map((c) => c.slice(1));

    test('a walk leg whose first path search fails: the second try arrives, the route goes on', async () => {
        const s = flatDoor({ open: true });
        const goto = s.bot.pathfinder.goto.bind(s.bot.pathfinder);
        let failed = 0;
        s.bot.pathfinder.goto = async (goal) => {
            if (goal?.x === 10 && failed === 0) {
                failed++;
                const err = new Error('No path to the goal!');
                err.name = 'NoPath';
                throw err;
            }
            return goal ? goto(goal) : undefined;
        };
        const r = await P.walkRoute(s.bot, s.ctx, s.route, { clock: s.clock });
        assert.equal(r.ok, true, r.text);
        assert.equal(failed, 1);
        assert.deepEqual(feet(s.bot), { x: 10, y: 64, z: 0 });
    });

    test('a closed door: opened once with activateBlock; walkRoute closes nothing', async () => {
        const s = flatDoor({ open: false });
        const r = await P.walkRoute(s.bot, s.ctx, s.route, { clock: s.clock });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(activations(s.bot).map((a) => a.join(',')).filter((a) => a.startsWith('5,')).length, 1, JSON.stringify(activations(s.bot)));
        assert.equal(s.world.propsAt(5, 64, 0).open, true, 'the door stays open');
    });

    test('an open door: not touched', async () => {
        const s = flatDoor({ open: true });
        const r = await P.walkRoute(s.bot, s.ctx, s.route, { clock: s.clock });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(activations(s.bot), []);
    });

    test('a door that does not open: reason blocked_door, the failure text of I3 at step 2 of 3, nothing dug', async () => {
        const s = flatDoor({ open: false, opens: false });
        const r = await P.walkRoute(s.bot, s.ctx, s.route, { clock: s.clock });
        assert.deepEqual({ ok: r.ok, reason: r.reason, leg: r.leg }, { ok: false, reason: 'blocked_door', leg: 1 });
        // v0.1.4.11, W1: the door that did not open instead of "Show me the way again."
        assert.match(r.text, /^I could not follow the route "house" at step 2 of 3: the door at \(-?\d+, -?\d+, -?\d+\) is closed and I could not open it\.$/);
        assert.equal(digs(s.bot), 0);
    });

    test('A5: walkRoute pauses no mode', async () => {
        const s = flatDoor({ open: false });
        await P.walkRoute(s.bot, s.ctx, s.route, { clock: s.clock });
        assert.deepEqual(s.paused, []);
    });
});

describe('I3: a route remembered from a trail with a step in the cell of the trapdoor', () => {
    function shaft(pos) {
        const world = baseWorld();
        const bot = makeMiningBot({ world, pos });
        const clock = makeClock(bot);
        bot.modes = { noteProgress() {} };
        bot.activateBlock = async (block) => {
            const p = block.position;
            bot.calls.push(['activate', p.x, p.y, p.z]);
            world.set(p.x, p.y, p.z, world.nameAt(p.x, p.y, p.z), { ...world.propsAt(p.x, p.y, p.z), open: world.propsAt(p.x, p.y, p.z).open !== true });
        };
        const faceAt = (x, y, z) => (world.nameAt(x, y, z) === 'ladder' ? world.propsAt(x, y, z).facing : null);
        const steps = shaftTrail();
        const route = { name: 'bed', dimension: 'overworld', from: { name: 'storage', kind: 'place', x: 2, y: 41, z: 1 }, to: { name: 'bed', x: -8, y: 61, z: -3 },
            legs: P.routeFromSteps(steps, { faceAt }).legs, steps: steps.length, source: 'trail' };
        return { world, bot, clock, route, ctx: { now: clock.now, log() {} } };
    }

    test('up: from the room through the trapdoor to the end', async () => {
        // T1-1 (see rt_route_logic.test.js): the door leg of the trapdoor ends in the trapdoor's own cell when the
        // trail holds a step there. The fake bot walks such a route both ways; the real server decides (W62, W63).
        const s = shaft([2.5, 41, 2.5]);
        const r = await P.walkRoute(s.bot, s.ctx, s.route, { clock: s.clock });
        assert.equal(r.ok, true, `${r.text} legs ${JSON.stringify(s.route.legs.map((l) => l.kind))}`);
        assert.deepEqual(feet(s.bot), { x: -8, y: 61, z: -3 });
        assert.equal(digs(s.bot), 0);
    });

    test('a way recorded going down (from the grass into the room): walked down, and back up', async () => {
        // FINDING T1-5 (see rt_route_logic.test.js): the legs of a trail recorded going down through a trapdoor come
        // as [walk, ladder, door, walk]; the walk down ends at the foot of the ladder, the walk up at the trapdoor leg.
        const s = shaft([-7.5, 61, -2.5]);
        const steps = [];
        for (let x = -8; x <= 2; x++) steps.push(st(x, 61, -3, { on: 'grass_block', sky: true }));
        steps.push(st(2, 60, -2, { at: 'oak_trapdoor', via: { ...T } }));
        for (let y = 59; y >= 41; y--) steps.push(st(2, y, -2, { at: 'ladder', via: y === 59 ? { ...T } : null }));
        for (const z of [-1, 0, 1]) steps.push(st(2, 41, z));
        const faceAt = (x, y, z) => (s.world.nameAt(x, y, z) === 'ladder' ? s.world.propsAt(x, y, z).facing : null);
        const route = { name: 'storage', dimension: 'overworld', from: { name: 'yard', kind: 'place', x: -8, y: 61, z: -3 }, to: { name: 'storage', x: 2, y: 41, z: 1 },
            legs: P.routeFromSteps(steps, { faceAt }).legs, steps: steps.length, source: 'trail' };
        const down = await P.walkRoute(s.bot, s.ctx, route, { clock: s.clock });
        assert.equal(down.ok, true, `${down.text} ${JSON.stringify(route.legs.map((l) => l.kind))}`);
        assert.deepEqual(feet(s.bot), { x: 2, y: 41, z: 1 });
        const up = await P.walkRoute(s.bot, s.ctx, route, { clock: s.clock, reverse: true });
        assert.equal(up.ok, true, up.text);
        assert.equal(digs(s.bot), 0);
    });

    test('down: from the end through the trapdoor into the room', async () => {
        const s = shaft([-7.5, 61, -2.5]);
        const r = await P.walkRoute(s.bot, s.ctx, s.route, { clock: s.clock, reverse: true });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(feet(s.bot), { x: 2, y: 41, z: 2 });
        assert.equal(digs(s.bot), 0);
    });
});

// --------------------------------------------------------------------------------------- I4

describe('I4: bindRoutes and walkTo', () => {
    function bound(pos = [0.5, 64, 0.5]) {
        const bot = makeMiningBot({ world: makeWorld({ groundY: 63 }), pos });
        const clock = makeClock(bot);
        bot.modes = { noteProgress() {} };
        const store = new P.RouteStore(null, { now: NOW });
        const legs = [];
        for (let i = 0; i < 5; i++) legs.push({ kind: 'walk', from: { x: 4 * i, y: 64, z: 0 }, to: { x: 4 * i + 4, y: 64, z: 0 } });
        store.set({ name: 'far', dimension: 'overworld', from: { name: 'storage', kind: 'place', x: 0, y: 64, z: 0 }, to: { name: 'far', x: 20, y: 64, z: 0 },
            legs, steps: 21, source: 'trail' });
        const trail = { list: () => [], tick() {} };
        const routes = P.bindRoutes(bot, { now: clock.now, log() {} }, store, trail);
        return { bot, clock, routes, store };
    }

    test('the object of I4: store, trail, walkRoute, walkTo, routeFor; the pure functions on logic (B2)', () => {
        const s = bound();
        assert.equal(s.routes.store, s.store);
        for (const k of ['walkRoute', 'walkTo', 'routeFor']) assert.equal(typeof s.routes[k], 'function', k);
        assert.equal(typeof s.routes.logic?.skyStart, 'function');
        assert.equal(typeof s.routes.logic?.routeFromSteps, 'function');
    });

    test('no route near the target: { ok: false, reason: no_route, text: "" }', async () => {
        const s = bound();
        const r = await s.routes.walkTo(s.bot, { x: 200, y: 64, z: 0 }, { clock: s.clock });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'no_route');
        assert.equal(r.text, '');
    });

    test('a route whose end is within 4 of the target and whose start is within 32 of the bot: walked, route named', async () => {
        const s = bound([3.5, 64, 2.5]);
        const r = await s.routes.walkTo(s.bot, { x: 22, y: 64, z: 0 }, { clock: s.clock });
        assert.equal(r.ok, true, r.text);
        assert.equal(r.route, 'far');
        const f = feet(s.bot);
        assert.ok(Math.abs(f.x - 22) <= 4 && Math.abs(f.z) <= 4, JSON.stringify(f));
    });

    test('routeFor: nearestRoute with the position of the bot', () => {
        const s = bound([19.5, 64, 0.5]);
        const r = s.routes.routeFor({ x: 1, y: 64, z: 0 });
        assert.equal(r?.route?.name, 'far');
        assert.equal(r.reverse, true);
    });
});

// --------------------------------------------------------------------------------------- I5

describe('I5: the hook in sleepInBed', () => {
    const QUICK = { checkMs: 40, wait: () => new Promise((r) => setTimeout(r, 2)) };
    function scene(routes) {
        const world = makeHomeWorld();
        world.bed(20, 64, 10, { facing: 'east' });
        const bot = makeHomeBot({ world, pos: [5.5, 64, 10.5] });
        bot.time.timeOfDay = 13000;
        bot.sleepMs = 0;
        bot.blocked.add('12,64,10'); // the path search finds no way to the bed
        const ctx = { areas: [], places: null, settings: {}, log: () => {}, now: () => Date.now() };
        if (routes) ctx.routes = routes;
        return { bot, ctx };
    }
    const OLD = 'I could not sleep: I found no way to the bed.';

    test('without ctx.routes: the text of v0.1.4.8', async () => {
        const s = scene(null);
        const r = await Z.sleepInBed(s.bot, s.ctx, QUICK);
        assert.equal(r.text, OLD);
    });

    test('walkTo answers no_route: the text of v0.1.4.8', async () => {
        const s = scene({ walkTo: async () => ({ ok: false, reason: 'no_route', text: '', route: null }) });
        const r = await Z.sleepInBed(s.bot, s.ctx, QUICK);
        assert.equal(r.text, OLD);
    });

    test('walkTo fails with another reason: its text replaces the text of the failure', async () => {
        const BROKEN = 'I could not follow the route "bed" at step 2 of 3, at (9, 64, 10). Show me the way again.';
        const s = scene({ walkTo: async () => ({ ok: false, reason: 'no_path', text: BROKEN, route: 'bed' }) });
        const r = await Z.sleepInBed(s.bot, s.ctx, QUICK);
        assert.equal(r.text, BROKEN);
    });

    test('walkTo arrives: the walk goes on as if the path search had arrived; the bot sleeps', async () => {
        const s = scene(null);
        s.ctx.routes = {
            walkTo: async () => {
                s.bot.entity.position = hv(19.5, 64, 10.5);
                return { ok: true, reason: null, text: 'I followed the route "bed", 3 steps.', route: 'bed' };
            },
        };
        const r = await Z.sleepInBed(s.bot, s.ctx, QUICK);
        assert.equal(r.ok, true, r.text);
    });
});
