// Spec v0.1.4.11, part N (engineer E4), I7 and HANDOFF "For part N": wayIn, wayOut and walkBack of mine_way.js walk
// the waypoints of the mine with the path search of the routes pack (ctx.routes.walkWaypoints, after ctx.routes.dryScan)
// when routes_by_search is on; off, the legs as before (ctx.routes.walkRoute). A mine of a second level: the parent's
// waypoints plus its shaft. The routes pack is a spy on the context here; its own walk has tests in nn_walk.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { give, makeWorld, makeMiningBot, makeClock, v } from './mining_fake_bot.test.js';

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

describe('F7: out of a shaft dug from the floor of the room', () => {
    // the room of the parent at y 41 (floor y 40), x 0..6, z -2..2, its shaft at (2, -2) from the grass; the child's shaft
    // dug from the floor cell (5, 41, 0) where the parent's way ended: ladders facing north from y 40 (the floor) down to
    // y 20, the exit cell (5, 41, 1) beside its top. The path search of the fake: a walk that aims at the open top of the
    // shaft falls into it (as the real one did, stuck two rungs under the top).
    function shaftScene() {
        const world = makeWorld({ groundY: 60 });
        world.fill(0, 41, -2, 6, 43, 2, 'air');
        world.fill(2, 44, -2, 2, 60, -2, 'air');
        world.fill(2, 41, -2, 2, 59, -2, 'ladder', { facing: 'south' });
        world.fill(5, 20, 0, 5, 40, 0, 'ladder', { facing: 'north' });
        const bot = makeMiningBot({ world, pos: [5.5, 20, 0.5] });
        const clock = makeClock(bot);
        const parent = {
            name: 'mine', source: 'player', dimension: 'overworld', entrance: { x: 2, y: 61, z: -3 }, level: 41, tunnels: [],
            room: { center: { x: 3, y: 41, z: 0 }, chest: null, table: null, furnace: null },
            route: [
                { kind: 'walk', from: { x: -3, y: 61, z: 2 }, to: { x: 2, y: 61, z: -3 } },
                { kind: 'ladder', x: 2, z: -2, top: 59, bottom: 41, face: 'south', entry: { x: 2, y: 61, z: -3 } },
                { kind: 'walk', from: { x: 2, y: 41, z: -1 }, to: { x: 5, y: 41, z: 0 } },
            ],
        };
        // the record of part M (W92): top the highest rung at the floor, entry the floor cell beside it
        const child = { name: null, source: 'bot', parent: 'mine', entrance: { x: 5, y: 41, z: 0 }, level: 20, base: { x: 5, y: 20, z: 0 },
            direction: 'north', end: { x: 5, y: 20, z: -2 }, tunnel: [{ x: 5, y: 20, z: -2 }], tunnels: [], dimension: 'overworld',
            route: [{ kind: 'ladder', x: 5, z: 0, top: 40, bottom: 20, face: 'north', entry: { x: 5, y: 41, z: 1 } }] };
        const ctx = { settings: { routes_by_search: true, mine_routes: true }, now: clock.now, log: () => {}, areas: [],
            mines: { parentOf: m => (m.parent === 'mine' ? parent : null) } };
        ctx.routes = R.bindRoutes(bot, ctx, { list: () => [] }, null);
        const gotos = [];
        const goto = bot.pathfinder.goto.bind(bot.pathfinder);
        bot.pathfinder.goto = async (g) => {
            gotos.push([g.x, g.y, g.z]);
            if (g.x === 5 && g.z === 0 && g.y >= 40) {
                bot.entity.position = v(5.5, 39, 0.5); // into the hole
                const err = new Error('Took too long');
                err.name = 'Timeout';
                throw err;
            }
            return goto(g);
        };
        const feet = () => [Math.floor(bot.entity.position.x), Math.floor(bot.entity.position.y + 0.01), Math.floor(bot.entity.position.z)];
        return { world, bot, clock, ctx, child, parent, gotos, feet };
    }

    test('the parent\'s waypoint in the open top of the shaft is dropped; the climb ends on the exit cell', () => {
        const s = shaftScene();
        const list = W.mineWaypoints(s.ctx, s.child).map(w => [w.kind, w.x, w.y, w.z]);
        assert.ok(!list.some(w => w[1] === 5 && w[3] === 0 && w[2] === 41), JSON.stringify(list));
        assert.deepEqual(list.slice(-2), [['start', 5, 41, 1], ['ladder_foot', 5, 20, 0]]);
    });

    test('from the bottom with toParent: up the ladders, standing in the room', async () => {
        const s = shaftScene();
        const r = await W.wayOut(s.bot, s.ctx, s.child, { clock: s.clock, toParent: true });
        assert.equal(r.ok, true, r.text);
        assert.equal(r.text, 'I am back in the mine "mine" at (5, 41, 1).');
        assert.deepEqual(s.feet(), [5, 41, 1], 'on the floor of the room beside the shaft, not in it');
        assert.equal(s.bot.entity.onGround, true);
    });

    test('from the bottom to the surface: never a walk into the open top of the shaft', async () => {
        const s = shaftScene();
        const r = await W.wayOut(s.bot, s.ctx, s.child, { clock: s.clock });
        assert.equal(r.ok, true, r.text);
        assert.ok(!s.gotos.some(g => g[0] === 5 && g[2] === 0 && g[1] >= 40), JSON.stringify(s.gotos));
        assert.deepEqual(s.feet(), [-3, 61, 2]);
    });

    test('standCell: a waypoint in the open top of a column is moved beside it', () => {
        const s = shaftScene();
        const c = R.standCell(s.bot, { x: 5, y: 41, z: 0, kind: 'end' });
        assert.ok(!(c.x === 5 && c.z === 0), JSON.stringify(c));
        assert.equal(c.y, 41);
        assert.deepEqual(R.standCell(s.bot, { x: 3, y: 41, z: 0, kind: 'room' }), { x: 3, y: 41, z: 0 });
    });
});

describe('F10: a mine remembered in its tunnel: the way in ends in the room', () => {
    const TUNNELED_WAY = {
        ...MINE,
        route: [...MINE.route,
            { kind: 'walk', from: { x: 2, y: 41, z: 1 }, to: { x: 4, y: 41, z: 0 } },
            { kind: 'walk', from: { x: 4, y: 41, z: 0 }, to: { x: 12, y: 33, z: 0 } },
            { kind: 'walk', from: { x: 12, y: 33, z: 0 }, to: { x: 13, y: 25, z: 9 } }],
    };

    test('the room stands in the order of the way, after its nearest waypoint, not after the tunnel', () => {
        const s = scene();
        const list = W.mineWaypoints(s.ctx, TUNNELED_WAY).map(w => [w.kind, w.x, w.y, w.z]);
        const room = list.findIndex(w => w[0] === 'room');
        assert.deepEqual(list[room], ['room', 3, 41, 1]);
        assert.ok(room < list.length - 2, JSON.stringify(list));
    });

    test('wayIn: the scan and the walk go to the room', async () => {
        const s = scene();
        const r = await W.wayIn(s.bot, s.ctx, TUNNELED_WAY, { clock: s.clock });
        assert.equal(r.ok, true);
        assert.deepEqual(s.calls.scan[0].options.to, { x: 3, y: 41, z: 1 });
        assert.deepEqual(s.calls.walk[0].options.to, { x: 3, y: 41, z: 1 });
    });
});

describe('F13: the inner shaft dug from the floor cell under the second ladder of the parent', () => {
    // the room at y 41 (floor 40), x 0..6, z 0..4; the basement above at y 51 (floor 50), x 0..6, z -2..2; ladder 2 of the
    // parent at (5, 43..50, 0) facing south (on the rock at z -1), its lowest rung 2 above the room floor, the way up
    // ends at (5, 51, -1); the child's shaft dug from the floor cell (5, 41, 0) under it, ladders facing north from
    // y 40 down to y 20, its exit (5, 41, 1). The foot of ladder 2 is the hole of the child's shaft now.
    function scene13({ ladders = 4 } = {}) {
        const world = makeWorld({ groundY: 60 });
        world.fill(0, 41, 0, 6, 43, 4, 'air');
        world.fill(0, 51, -2, 6, 53, 2, 'air');
        world.fill(5, 43, 0, 5, 50, 0, 'ladder', { facing: 'south' });
        world.fill(5, 44, 0, 5, 50, 0, 'ladder', { facing: 'south' });
        world.fill(5, 20, 0, 5, 40, 0, 'ladder', { facing: 'north' });
        const bot = makeMiningBot({ world, pos: [5.5, 20, 0.5] });
        if (ladders > 0) give(bot, 'ladder', ladders);
        const clock = makeClock(bot);
        const parent = {
            name: 'mine', source: 'player', dimension: 'overworld', entrance: { x: 2, y: 51, z: -1 }, level: 41, tunnels: [],
            room: { center: { x: 3, y: 41, z: 2 }, chest: null, table: null, furnace: null },
            route: [
                { kind: 'walk', from: { x: 2, y: 51, z: -1 }, to: { x: 5, y: 51, z: -1 } },
                { kind: 'ladder', x: 5, z: 0, top: 50, bottom: 43, face: 'south', entry: { x: 5, y: 51, z: -1 }, foot: { x: 5, y: 41, z: 0 } },
                { kind: 'walk', from: { x: 5, y: 41, z: 0 }, to: { x: 3, y: 41, z: 2 } },
            ],
        };
        const child = { name: null, source: 'bot', parent: 'mine', entrance: { x: 5, y: 41, z: 0 }, level: 20, base: { x: 5, y: 20, z: 0 },
            direction: 'north', end: { x: 5, y: 20, z: -2 }, tunnel: [{ x: 5, y: 20, z: -2 }], tunnels: [], dimension: 'overworld',
            route: [{ kind: 'ladder', x: 5, z: 0, top: 40, bottom: 20, face: 'north', entry: { x: 5, y: 41, z: 1 } }] };
        const ctx = { settings: { routes_by_search: true, mine_routes: true }, now: clock.now, log: () => {}, areas: [],
            mines: { parentOf: m => (m.parent === 'mine' ? parent : null) } };
        ctx.routes = R.bindRoutes(bot, ctx, { list: () => [] }, null);
        const feet = () => [Math.floor(bot.entity.position.x), Math.floor(bot.entity.position.y + 0.01), Math.floor(bot.entity.position.z)];
        return { world, bot, clock, ctx, child, feet };
    }

    test('out from the bottom: up the inner shaft, ladders into the hole, up ladder 2, out of the mine', async () => {
        const s = scene13();
        const r = await W.wayOut(s.bot, s.ctx, s.child, { clock: s.clock });
        assert.equal(r.ok, true, r.text);
        assert.equal(s.world.nameAt(5, 41, 0), 'ladder');
        assert.equal(s.world.nameAt(5, 42, 0), 'ladder');
        assert.deepEqual(s.feet(), [2, 51, -1]);
    });

    test('without ladders: the scan names the gap and the bot does not climb', async () => {
        const s = scene13({ ladders: 0 });
        const r = await W.wayOut(s.bot, s.ctx, s.child, { clock: s.clock });
        assert.equal(r.ok, false);
        assert.match(r.text, /the ladder has a gap of 2 at y 41 and I have no ladders\.$/);
        assert.deepEqual(s.feet(), [5, 20, 0]);
    });
});
