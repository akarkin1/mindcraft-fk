// Spec v0.1.4.11, part N (engineer E4), I7 and HANDOFF "For part N": wayIn, wayOut and walkBack of mine_way.js walk
// the waypoints of the mine with the path search of the routes pack (ctx.routes.walkWaypoints, after ctx.routes.dryScan)
// when routes_by_search is on; off, the legs as before (ctx.routes.walkRoute). A mine of a second level: the parent's
// waypoints plus its shaft. The routes pack is a spy on the context here; its own walk has tests in nn_walk.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeMiningBot, makeClock, v } from './mining_fake_bot.test.js';

const W = await loadSrc('src/agent/packs/mining/mine_way.js');
const R = await loadSrc('src/agent/packs/routes/index.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

// the way of the player from the yard down the shaft into the room at y 41
const MINE = {
    name: 'mine', source: 'player', dimension: 'overworld', entrance: { x: 2, y: 61, z: -3 }, level: 41, tunnels: [],
    room: { center: { x: 3, y: 41, z: 1 }, chest: null, table: null, furnace: null },
    route: [
        { kind: 'walk', from: { x: -3, y: 61, z: 2 }, to: { x: 2, y: 61, z: -3 } },
        { kind: 'door', kind2: 'trapdoor', name: 'oak_trapdoor', x: 2, y: 60, z: -2, from: { x: 2, y: 61, z: -3 }, to: { x: 2, y: 59, z: -2 } },
        { kind: 'ladder', x: 2, z: -2, top: 59, bottom: 41, face: 'south', entry: { x: 2, y: 61, z: -3 } },
        { kind: 'walk', from: { x: 2, y: 41, z: -1 }, to: { x: 2, y: 41, z: 1 } },
    ],
};
const CHILD = {
    name: 'bot:20', source: 'bot', dimension: 'overworld', parent: 'mine', entrance: { x: 4, y: 41, z: 1 }, level: 20, tunnel: [], tunnels: [],
    route: [{ kind: 'ladder', x: 4, z: 0, top: 40, bottom: 20, face: 'north', entry: { x: 4, y: 41, z: 1 } }],
};

function scene({ on = true, pos = [-3.5, 61, 2.5], scan = null } = {}) {
    const world = makeWorld({ groundY: 60 });
    const bot = makeMiningBot({ world, pos });
    const clock = makeClock(bot);
    const calls = { scan: [], walk: [], walkRoute: [] };
    const ctx = {
        settings: { routes_by_search: on, mine_routes: true },
        now: clock.now,
        log: () => {},
        mines: { parentOf: m => (m.parent === 'mine' ? MINE : null) },
        areas: [],
        routes: {
            waypointsOf: R.waypointsOf,
            dryScan: async (b, waypoints, options) => {
                calls.scan.push({ waypoints, options });
                return scan ?? { ok: true, step: null, total: 0, from: null, to: null, cause: null, text: '' };
            },
            walkWaypoints: async (b, waypoints, options) => {
                calls.walk.push({ waypoints, options });
                b.entity.position = v(options.to.x + 0.5, options.to.y, options.to.z + 0.5);
                return { ok: true, reason: null, text: 'I followed the route.', step: null, total: 1, at: options.to, cause: null };
            },
            walkRoute: async (b, route, options) => {
                calls.walkRoute.push({ route, options });
                return { ok: true, reason: null, text: '' };
            },
        },
    };
    return { bot, clock, ctx, calls };
}

const at = w => [w.kind, w.x, w.y, w.z];

describe('mineWaypoints (I7)', () => {
    test('the route of the mine and the middle of its room', () => {
        const s = scene();
        assert.deepEqual(W.mineWaypoints(s.ctx, MINE).map(at), [['start', -3, 61, 2], ['walk', 2, 61, -3], ['trapdoor', 2, 60, -2],
            ['ladder_top', 2, 59, -2], ['ladder_foot', 2, 41, -2], ['walk', 2, 41, -1], ['end', 2, 41, 1], ['room', 3, 41, 1]]);
    });

    test('a mine of a second level: the parent\'s waypoints, then its shaft, all with its name', () => {
        const s = scene();
        const list = W.mineWaypoints(s.ctx, CHILD);
        assert.deepEqual(list.slice(-3).map(at), [['room', 3, 41, 1], ['start', 4, 41, 1], ['ladder_foot', 4, 20, 0]]);
        assert.equal(list.length, 10);
        assert.ok(list.every(w => w.name === 'bot:20'));
    });

    test('bySearchOn: the setting and the waypoint walk on the context', () => {
        assert.equal(W.bySearchOn(scene().ctx), true);
        assert.equal(W.bySearchOn(scene({ on: false }).ctx), false);
        assert.equal(W.bySearchOn({ settings: { routes_by_search: true }, routes: {} }), false);
    });
});

describe('wayIn and wayOut with routes_by_search on', () => {
    test('wayIn: the dry scan, then the waypoints to the room; no leg is walked', async () => {
        const s = scene();
        const r = await W.wayIn(s.bot, s.ctx, MINE, { clock: s.clock });
        assert.deepEqual(r, { ok: true, reason: null, text: '', walked: true });
        assert.equal(s.calls.scan.length, 1);
        assert.equal(s.calls.walk.length, 1);
        assert.deepEqual(s.calls.walk[0].options.to, { x: 3, y: 41, z: 1 });
        assert.equal(s.calls.walk[0].options.name, 'mine');
        assert.equal(s.calls.walk[0].options.ctx, s.ctx, 'the context of the pack, for its doors');
        assert.deepEqual(s.calls.scan[0].options.to, { x: 3, y: 41, z: 1 });
        assert.equal(s.calls.walkRoute.length, 0);
    });

    test('wayIn: a hop without a way stops before the first step with the text of the scan', async () => {
        const text = 'I find no way from (2, 61, -3) to the trapdoor at (2, 60, -2): it is closed and I cannot open it.';
        const s = scene({ scan: { ok: false, step: 2, total: 6, from: { x: 2, y: 61, z: -3 }, to: { x: 2, y: 60, z: -2 },
            cause: { kind: 'door', name: 'trapdoor', x: 2, y: 60, z: -2, state: 'closed' }, text } });
        const r = await W.wayIn(s.bot, s.ctx, MINE, { clock: s.clock });
        assert.deepEqual(r, { ok: false, reason: 'no_path', text, walked: false });
        assert.equal(s.calls.walk.length, 0);
        assert.deepEqual([s.bot.entity.position.x, s.bot.entity.position.z], [-3.5, 2.5], 'the bot did not move');
    });

    test('wayIn: a failed walk gives the text of its step', async () => {
        const s = scene();
        s.ctx.routes.walkWaypoints = async () => ({ ok: false, reason: 'no_path', text: 'I could not follow the route "mine" at step 3 of 6: I got stuck at (2, 50, -2).' });
        const r = await W.wayIn(s.bot, s.ctx, MINE, { clock: s.clock });
        assert.deepEqual(r, { ok: false, reason: 'no_path', text: 'I could not follow the route "mine" at step 3 of 6: I got stuck at (2, 50, -2).', walked: false });
    });

    test('wayIn: a bot in the room stays', async () => {
        const s = scene({ pos: [3.5, 41, 1.5] });
        const r = await W.wayIn(s.bot, s.ctx, MINE, { clock: s.clock });
        assert.deepEqual(r, { ok: true, reason: null, text: '', walked: false });
        assert.equal(s.calls.walk.length, 0);
    });

    test('wayOut from the room: the waypoints back to the start, the surface text', async () => {
        const s = scene({ pos: [3.5, 41, 1.5] });
        const r = await W.wayOut(s.bot, s.ctx, MINE, { clock: s.clock });
        assert.equal(r.ok, true, r.text);
        assert.equal(r.text, 'I am on the surface at (-3, 61, 2).');
        assert.deepEqual(s.calls.walk[0].options.to, { x: -3, y: 61, z: 2 });
        assert.equal(s.calls.scan.length, 1, 'a dry scan before the first step of !leaveMine');
    });

    test('wayOut on the surface: nothing to walk', async () => {
        const s = scene({ pos: [-10.5, 61, 10.5] });
        const r = await W.wayOut(s.bot, s.ctx, MINE, { clock: s.clock });
        assert.deepEqual(r, { ok: true, reason: null, text: 'I am on the surface already.' });
        assert.equal(s.calls.walk.length, 0);
    });

    test('a mine of a second level: in through the parent\'s waypoints to the foot of its shaft; out to the parent with toParent', async () => {
        const s = scene();
        const into = await W.wayIn(s.bot, s.ctx, CHILD, { clock: s.clock });
        assert.equal(into.ok, true);
        assert.deepEqual(s.calls.walk[0].options.to, { x: 4, y: 20, z: 0 });
        const back = await W.wayOut(s.bot, s.ctx, CHILD, { clock: s.clock, toParent: true });
        assert.equal(back.ok, true, back.text);
        assert.equal(back.text, 'I am back in the mine "mine" at (4, 41, 1).');
        assert.deepEqual(s.calls.walk[1].waypoints.map(at), [['start', 4, 41, 1], ['ladder_foot', 4, 20, 0]], 'its shaft only');
        const out = await W.wayOut(s.bot, s.ctx, CHILD, { clock: s.clock });
        assert.equal(out.text, 'I am on the surface at (-3, 61, 2).');
    });
});

describe('walkBack with routes_by_search on', () => {
    const TUNNELED = { ...MINE, tunnels: [{ start: { x: 3, y: 41, z: 2 }, dir: 'south', end: { x: 3, y: 41, z: 20 }, level: 41, length: 18, branches: [] }] };

    test('in a tunnel: the hops of the way back as waypoints of kind tunnel, by the path search', async () => {
        const world = makeWorld({ groundY: 60 });
        world.fill(3, 41, 1, 3, 42, 20, 'air');
        const s = scene({ pos: [3.5, 41, 15.5] });
        s.bot.world = world;
        s.bot.blockAt = p => world.block(p.x, p.y, p.z);
        const r = await W.walkBack(s.bot, s.ctx, TUNNELED, { clock: s.clock });
        assert.equal(r.ok, true, r.text);
        assert.equal(s.calls.walk.length, 1);
        assert.ok(s.calls.walk[0].waypoints.length > 0);
        assert.ok(s.calls.walk[0].waypoints.every(w => w.kind === 'tunnel'));
        assert.equal(s.bot.calls.filter(c => c[0] === 'dig').length, 0);
    });

    test('off: the legs of before (walkRoute), no waypoints', async () => {
        const s = scene({ on: false, pos: [3.5, 41, 1.5] });
        const r = await W.wayOut(s.bot, s.ctx, MINE, { clock: s.clock });
        assert.equal(r.ok, true, r.text);
        assert.equal(s.calls.walk.length, 0);
        assert.equal(s.calls.scan.length, 0);
        assert.equal(s.calls.walkRoute.length, 1);
        assert.equal(s.calls.walkRoute[0].options.reverse, true);
    });
});
