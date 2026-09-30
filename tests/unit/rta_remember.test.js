// Spec v0.1.4.9, part A (engineer E1): !rememberRoute (A2), !routes and !forgetRoute (A3), and the routes on
// the context (I4, bindRoutes). A fake bot that stands where the trail ends, a fake trail, the RouteStore in
// memory, the places as the MemoryBank gives them.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadSrc } from '../helpers/load.js';

const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
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

// the ladders of the base face south; the bot stands at the end of the trail
function fakeBot(pos = [-2.5, 61, 2.5]) {
    return {
        entity: { position: new Vec3(...pos), onGround: true },
        game: { dimension: 'overworld' },
        blockAt: p => (p.x === 2 && p.z === -2 && p.y >= 41 && p.y <= 59
            ? { name: 'ladder', boundingBox: 'block', getProperties: () => ({ facing: 'south' }) } : { name: 'air', boundingBox: 'empty' }),
    };
}

function memoryBank(places) {
    return {
        getJson: () => Object.fromEntries(Object.entries(places).map(([n, p]) => [n, [p.x, p.y, p.z]])),
        recallPlaceInfo: n => (places[n] ? { ...places[n], dimension: places[n].dimension ?? null } : undefined),
    };
}

function scene({ steps = UP, places = { storage: { x: 2, y: 41, z: 1 } }, areas = [], mines = null } = {}) {
    const store = new P.RouteStore(null, { now: () => new Date('2026-09-30T10:00:00Z') });
    let ticks = 0;
    const trail = { list: () => steps.map(s => ({ ...s })), tick: () => { ticks++; }, get ticks() { return ticks; } };
    const ctx = { places: memoryBank(places), areas, routes: { store, trail } };
    if (mines) ctx.mines = { list: () => mines };
    return { bot: fakeBot(), store, trail, ctx };
}

describe('rememberRoute (A2)', () => {
    test('W62: from the place "storage" to here, with the ladder and the trapdoor', () => {
        const s = scene();
        const r = P.rememberRoute(s.bot, s.ctx, 'Bed');
        assert.equal(r.ok, true);
        assert.equal(r.text, 'I remember the way "bed": from the place "storage" to here, 4 steps, 1 ladder, 1 trapdoor. I walk it in both directions.');
        assert.equal(s.trail.ticks, 1, 'the cell of the bot is read first');
        const saved = s.store.get('bed');
        assert.deepEqual(saved.from, { name: 'storage', kind: 'place', x: 2, y: 41, z: -1 });
        assert.deepEqual(saved.to, { name: 'bed', x: -3, y: 61, z: 2 });
        assert.deepEqual({ steps: saved.steps, source: saved.source, dimension: saved.dimension }, { steps: 26, source: 'trail', dimension: 'overworld' });
        assert.equal(saved.legs[1].face, 'south', 'the facing of the ladder, read from the world');
        assert.deepEqual(r.route, saved);
    });

    test('the name existed: the text of the replacement comes first', () => {
        const s = scene();
        P.rememberRoute(s.bot, s.ctx, 'bed');
        const r = P.rememberRoute(s.bot, s.ctx, 'bed');
        assert.equal(r.text, 'I know a way "bed" already. I replace it. I remember the way "bed": from the place "storage" to here, 4 steps, 1 ladder, 1 trapdoor. I walk it in both directions.');
        assert.equal(s.store.size, 1);
    });

    test('the area of the last step does not count; the area passed before does; never a start half way up the ladder', () => {
        const house = { name: 'home', type: 'home', min: { x: -4, y: 60, z: -5 }, max: { x: 4, y: 65, z: 5 } };
        const room = { name: 'room', type: 'mine', min: { x: 0, y: 40, z: -2 }, max: { x: 4, y: 43, z: 2 } };
        const s = scene({ places: {}, areas: [house, room] });
        const r = P.rememberRoute(s.bot, s.ctx, 'bed');
        assert.equal(r.text, 'I remember the way "bed": from the area "room" to here, 3 steps, 1 ladder, 1 trapdoor. I walk it in both directions.');
        // the last step inside the room is the ladder at y 43; the way starts at the foot of the ladder
        assert.deepEqual(r.route.from, { name: 'room', kind: 'area', x: 2, y: 41, z: -2 });
        assert.equal(r.route.legs[0].bottom, 41);
    });

    test('a mine as the start: on its route', () => {
        const mine = { name: 'mine', level: 25, room: null, route: [{ kind: 'walk', from: { x: 2, y: 41, z: 1 }, to: { x: 2, y: 41, z: 0 } }] };
        const s = scene({ places: {}, mines: [mine] });
        assert.match(P.rememberRoute(s.bot, s.ctx, 'bed').text, /^I remember the way "bed": from the mine "mine" to here, /);
    });

    test('no known thing on the way: no_start', () => {
        const s = scene({ places: {} });
        assert.deepEqual(P.rememberRoute(s.bot, s.ctx, 'bed'), {
            ok: false, reason: 'no_start', text: 'I do not know where this way starts. Stand at a place I know first, then walk with me and tell me again.', route: null,
        });
        assert.equal(s.store.size, 0);
    });

    test('a place of another dimension does not count', () => {
        const s = scene({ places: { storage: { x: 2, y: 41, z: 1, dimension: 'the_nether' } } });
        assert.equal(P.rememberRoute(s.bot, s.ctx, 'bed').reason, 'no_start');
    });

    test('without the routes pack, without a name', () => {
        const s = scene();
        assert.deepEqual(P.rememberRoute(s.bot, {}, 'bed'), { ok: false, reason: 'no_trail', text: 'I have no trail. The routes pack is off.', route: null });
        assert.equal(P.rememberRoute(s.bot, s.ctx, '   ').reason, 'no_name');
        assert.equal(P.rememberRoute(s.bot, s.ctx, 'bed', { trail: { list: () => { throw new Error('x'); } } }).reason, 'error');
    });
});

describe('routesText and forgetRoute (A3)', () => {
    test('the list, forgot, no route', () => {
        const s = scene();
        assert.equal(P.routesText(s.ctx, 'overworld'), 'I know no routes.');
        P.rememberRoute(s.bot, s.ctx, 'bed');
        assert.equal(P.routesText(s.ctx, 'overworld'), 'I know 1 route: "bed" from the place "storage" to (-3, 61, 2), 4 steps.');
        assert.equal(P.routesText(s.ctx, 'the_nether'), 'I know no routes.');
        assert.equal(P.routesText(s.store), 'I know 1 route: "bed" from the place "storage" to (-3, 61, 2), 4 steps.', 'the store itself');
        assert.deepEqual(P.forgetRoute(s.ctx, 'Bed', 'overworld'), { ok: true, reason: null, text: 'Forgot the route "bed".' });
        assert.deepEqual(P.forgetRoute(s.ctx, 'bed', 'overworld'), { ok: false, reason: 'unknown', text: 'I know no route "bed".' });
        assert.equal(P.routesText({}, 'overworld'), 'I know no routes.');
        assert.equal(P.forgetRoute(null, 'bed').text, 'I know no route "bed".');
    });
});

describe('bindRoutes (I4)', () => {
    test('the object on the context: store, trail, walkRoute, walkTo, routeFor, logic', async () => {
        const s = scene();
        P.rememberRoute(s.bot, s.ctx, 'bed');
        const routes = P.bindRoutes(s.bot, { now: () => 0 }, s.store, s.trail);
        assert.equal(routes.store, s.store);
        assert.equal(routes.trail, s.trail);
        for (const name of ['walkRoute', 'walkTo', 'routeFor']) assert.equal(typeof routes[name], 'function', name);
        assert.equal(typeof routes.logic.skyStart, 'function');
        assert.equal(routes.logic.skyStart([st(0, 64, 0, { sky: true }), st(0, 50, 0)]), 0);
        const pick = routes.routeFor({ x: 2, y: 41, z: 1 });
        assert.deepEqual({ name: pick.route.name, reverse: pick.reverse }, { name: 'bed', reverse: true });
        assert.equal(routes.routeFor({ x: 90, y: 41, z: 1 }), null);
        const none = await routes.walkTo(s.bot, { x: 90, y: 41, z: 1 });
        assert.deepEqual(none, { ok: false, reason: 'no_route', text: '', route: null });
    });

    test('logic.routeFromSteps reads the facing of the ladders from the world of the bot', () => {
        const s = scene();
        const routes = P.bindRoutes(s.bot, {}, s.store, s.trail);
        const down = [st(1, 61, -2)];
        for (let y = 59; y >= 41; y--) down.push(st(2, y, -2, { at: 'ladder' }));
        assert.equal(routes.logic.routeFromSteps(down).legs.find(l => l.kind === 'ladder').face, 'south');
        assert.equal(P.routeFromSteps(down).legs.find(l => l.kind === 'ladder').face, 'east', 'the steps alone');
    });

    test('a store that fails gives no routes, never a throw', async () => {
        const s = scene();
        const routes = P.bindRoutes(s.bot, {}, { list: () => { throw new Error('x'); } }, s.trail);
        assert.equal(routes.routeFor({ x: 2, y: 41, z: 1 }), null);
        assert.equal((await routes.walkTo(s.bot, { x: 2, y: 41, z: 1 })).reason, 'no_route');
    });
});
