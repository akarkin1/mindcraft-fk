// Spec v0.1.4.11, part N (engineer E4), I7, I8 and N1: walkWaypoints and dryScan on the fake bot of the mining pack
// with a fake path search. The fake goto puts the bot on the cell of the goal (or fails for the goals in `blocked`);
// the fake getPathFromTo answers a status per hop and never moves the bot. The shaft of rta_replay: the room at y 41,
// ladders facing south from y 41 to 59 at (2, -2), an oak trapdoor at (2, 60, -2) in the grass, the bed at (-3, 61, 2).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { give, makeWorld, makeMiningBot, makeClock, v } from './mining_fake_bot.test.js';

const P = await loadSrc('src/agent/packs/routes/index.js');
const H = await loadSrc('src/agent/packs/home/doors.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

const SHAFT = {
    name: 'bed', from: { name: 'storage', kind: 'place', x: 2, y: 41, z: 1 }, to: { name: 'bed', x: -3, y: 61, z: 2 },
    legs: [
        { kind: 'walk', from: { x: 2, y: 41, z: 1 }, to: { x: 2, y: 41, z: -1 } },
        { kind: 'ladder', x: 2, z: -2, top: 59, bottom: 41, face: 'south', entry: { x: 2, y: 61, z: -3 }, foot: { x: 2, y: 41, z: -1 } },
        { kind: 'door', kind2: 'trapdoor', name: 'oak_trapdoor', x: 2, y: 60, z: -2, from: { x: 2, y: 59, z: -2 }, to: { x: 2, y: 61, z: -3 } },
        { kind: 'walk', from: { x: 2, y: 61, z: -3 }, to: { x: -3, y: 61, z: 2 } },
    ],
};

const key = (x, y, z) => `${x},${y},${z}`;

function scene({ pos = [2.5, 41, 1.5], ladders = true, lowest = 41 } = {}) {
    const world = makeWorld({ groundY: 60 });
    world.fill(0, 41, -2, 4, 43, 2, 'air');
    world.fill(2, 44, -2, 2, 59, -2, 'air');
    if (ladders) world.fill(2, lowest, -2, 2, 59, -2, 'ladder', { facing: 'south' });
    world.set(2, 60, -2, 'oak_trapdoor', { facing: 'south', half: 'top', open: false });
    const solid = world.solid;
    world.solid = (x, y, z) => (world.nameAt(x, y, z).endsWith('_trapdoor') && world.propsAt(x, y, z).open === true ? false : solid(x, y, z));
    const bot = makeMiningBot({ world, pos });
    bot.activateBlock = async (block) => {
        const p = block.position;
        bot.calls.push(['activate', p.x, p.y, p.z]);
        if (bot.stuckTrapdoor) return;
        world.set(p.x, p.y, p.z, world.nameAt(p.x, p.y, p.z), { ...world.propsAt(p.x, p.y, p.z), open: world.propsAt(p.x, p.y, p.z).open !== true });
    };
    const clock = makeClock(bot);
    const progress = [];
    bot.modes = { noteProgress: reason => progress.push(reason) };
    const gotos = [];
    const blocked = new Set();
    bot.pathfinder.goto = async (goal) => {
        gotos.push([goal.x, goal.y, goal.z]);
        if (bot.stopOnGoto) bot.interrupt_code = true;
        if (blocked.has(key(goal.x, goal.y, goal.z))) {
            const err = new Error('No path to the goal!');
            err.name = 'NoPath';
            throw err;
        }
        bot.entity.position = v(goal.x + 0.5, goal.y, goal.z + 0.5);
    };
    const searches = [];
    const noPath = new Set();
    bot.pathfinder.getPathFromTo = function* (movements, start, goal, options) {
        searches.push({ from: [Math.floor(start.x), Math.floor(start.y), Math.floor(start.z)], to: [goal.x, goal.y, goal.z], radius: options?.searchRadius });
        yield { result: { status: 'partial', path: [] } };
        yield { result: { status: noPath.has(key(goal.x, goal.y, goal.z)) ? 'noPath' : (bot.searchStatus ?? 'success'), path: [] } };
    };
    const reserved = [];
    const released = [];
    const ctx = { now: clock.now, log: () => {}, doors: { reserve: (door, ms) => { reserved.push([door.x, door.y, door.z, ms]); return true; },
        release: door => released.push([door.x, door.y, door.z]) } };
    const feet = () => [Math.floor(bot.entity.position.x), Math.floor(bot.entity.position.y + 0.01), Math.floor(bot.entity.position.z)];
    return { world, bot, clock, ctx, gotos, blocked, searches, noPath, reserved, released, progress, feet, waypoints: P.waypointsOf(SHAFT) };
}

const TO_BED = { x: -3, y: 61, z: 2 };
const TO_ROOM = { x: 2, y: 41, z: 1 };

describe('walkWaypoints (I7)', () => {
    test('from the room to the bed: the path search to the foot, the climb by the ladder leg, the trapdoor reserved and released', async () => {
        const s = scene();
        const r = await P.walkWaypoints(s.bot, s.ctx, s.waypoints, { to: TO_BED, clock: s.clock });
        assert.deepEqual({ ok: r.ok, reason: r.reason, text: r.text, step: r.step, total: r.total, cause: r.cause },
            { ok: true, reason: null, text: 'I followed the route "bed", 5 steps.', step: null, total: 5, cause: null });
        assert.deepEqual(s.gotos[0], [2, 41, -1]);
        assert.ok(!s.gotos.some(g => g[0] === 2 && g[2] === -2), `F1: no goal of the path search in the column: ${JSON.stringify(s.gotos)}`);
        assert.deepEqual(s.gotos.at(-1), [-3, 61, 2]);
        assert.deepEqual(s.feet(), [-3, 61, 2]);
        assert.deepEqual(s.bot.calls.filter(c => c[0] === 'activate'), [['activate', 2, 60, -2], ['activate', 2, 60, -2]], 'opened from the ladder, closed after');
        assert.equal(s.world.propsAt(2, 60, -2).open, false);
        assert.deepEqual(s.reserved, [[2, 60, -2, 20000]], 'I8: the trapdoor, before the climb that passes it');
        assert.deepEqual(s.released, [[2, 60, -2]], 'the reservation ends with the walk');
        assert.deepEqual(s.progress, ['route', 'route', 'route', 'route', 'route']);
        assert.equal(s.bot.calls.filter(c => c[0] === 'dig').length, 0);
    });

    test('the reserve happens before the walk of its hop', async () => {
        const s = scene({ pos: [2.5, 59, -1.5] });
        const order = [];
        s.ctx.doors.reserve = () => { order.push('reserve'); return true; };
        const goto = s.bot.pathfinder.goto;
        s.bot.pathfinder.goto = async (goal) => { order.push(`goto ${goal.x},${goal.y},${goal.z}`); return goto(goal); };
        await P.walkWaypoints(s.bot, s.ctx, s.waypoints, { to: TO_BED, clock: s.clock });
        assert.deepEqual(order, ['reserve', 'goto 2,61,-3', 'goto -3,61,2']);
    });

    test('the other way, from the bed: toward the end nearer to the goal, down the ladder by sliding', async () => {
        const s = scene({ pos: [-2.5, 61, 2.5] });
        const r = await P.walkWaypoints(s.bot, s.ctx, s.waypoints, { to: TO_ROOM, clock: s.clock });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(s.gotos[0], [2, 61, -3]);
        assert.ok(!s.gotos.some(g => g[0] === 2 && g[2] === -2), JSON.stringify(s.gotos));
        assert.deepEqual(s.feet(), [2, 41, 1]);
        assert.equal(s.world.propsAt(2, 60, -2).open, false, 'the trapdoor closed behind the bot');
    });

    test('joined half way up the ladder: up from there, never down to the foot first (W95)', async () => {
        const s = scene({ pos: [2.5, 50, -1.5] });
        let low = Infinity;
        s.clock.onTick = () => { low = Math.min(low, s.bot.entity.position.y); };
        const r = await P.walkWaypoints(s.bot, s.ctx, s.waypoints, { to: TO_BED, clock: s.clock });
        assert.equal(r.ok, true, r.text);
        assert.equal(r.total, 3);
        assert.ok(low >= 49.5, `the bot went down to y ${low}`);
        assert.deepEqual(s.feet(), [-3, 61, 2]);
    });

    test('joined half way down the ladder toward the room: down from there, the trapdoor above left alone', async () => {
        const s = scene({ pos: [2.5, 50, -1.5] });
        let high = -Infinity;
        s.clock.onTick = () => { high = Math.max(high, s.bot.entity.position.y); };
        const r = await P.walkWaypoints(s.bot, s.ctx, s.waypoints, { to: TO_ROOM, clock: s.clock });
        assert.equal(r.ok, true, r.text);
        assert.ok(high <= 50.5, `the bot went up to y ${high}`);
        assert.deepEqual(s.bot.calls.filter(c => c[0] === 'activate'), [], 'no click on the trapdoor');
        assert.deepEqual(s.feet(), [2, 41, 1]);
    });

    test('a trapdoor that does not open on the climb: the cause door and the text of W1', async () => {
        const s = scene();
        s.bot.stuckTrapdoor = true;
        const r = await P.walkWaypoints(s.bot, s.ctx, s.waypoints, { to: TO_BED, clock: s.clock });
        assert.deepEqual({ ok: r.ok, reason: r.reason, step: r.step, total: r.total }, { ok: false, reason: 'blocked_door', step: 3, total: 5 });
        assert.deepEqual(r.cause, { kind: 'door', name: 'trapdoor', x: 2, y: 60, z: -2, state: 'closed' });
        assert.equal(r.text, 'I could not follow the route "bed" at step 3 of 5: the trapdoor at (2, 60, -2) is closed and I could not open it.');
        assert.deepEqual(s.released, [[2, 60, -2]], 'released also after a failure');
    });

    test('a hop up a column with missing ladders: the cause ladder', async () => {
        const s = scene();
        s.world.fill(2, 45, -2, 2, 50, -2, 'air');
        s.blocked.add(key(2, 59, -2));
        const r = await P.walkWaypoints(s.bot, s.ctx, s.waypoints, { to: TO_BED, clock: s.clock });
        assert.equal(r.step, 3);
        assert.deepEqual(r.cause, { kind: 'ladder', x: 2, z: -2, y: 45, gap: 6 });
        assert.equal(r.text, 'I could not follow the route "bed" at step 3 of 5: the ladder at (2, -2) has a gap of 6 at y 45. I need 6 ladders to go on.');
    });

    test('a walk hop without a way: no_path from the feet to the waypoint', async () => {
        const s = scene();
        s.blocked.add(key(-3, 61, 2));
        const r = await P.walkWaypoints(s.bot, s.ctx, s.waypoints, { to: TO_BED, clock: s.clock });
        assert.deepEqual(r.cause, { kind: 'no_path', from: { x: 2, y: 61, z: -3 }, to: { x: -3, y: 61, z: 2 } });
        assert.equal(r.text, 'I could not follow the route "bed" at step 5 of 5: I found no way from (2, 61, -3) to (-3, 61, 2).');
        assert.equal(r.reason, 'no_path');
    });

    test('stopped: interrupted with the text of the step', async () => {
        const s = scene();
        s.bot.stopOnGoto = true;
        const r = await P.walkWaypoints(s.bot, s.ctx, s.waypoints, { to: TO_BED, clock: s.clock });
        assert.deepEqual({ ok: r.ok, reason: r.reason, text: r.text, cause: r.cause },
            { ok: false, reason: 'interrupted', text: 'I was stopped on the route "bed" at step 1 of 5.', cause: { kind: 'interrupted' } });
    });

    test('the name of the texts comes from the options before the waypoints', async () => {
        const s = scene({ pos: [-2.5, 61, 2.5] });
        const r = await P.walkWaypoints(s.bot, s.ctx, s.waypoints, { to: TO_BED, clock: s.clock, name: 'mine' });
        assert.equal(r.text, 'I followed the route "mine", 1 step.');
    });

    test('without ctx.doors the running door service of the bot takes the reservation (I8)', async () => {
        const s = scene({ pos: [2.5, 59, -1.5] });
        delete s.ctx.doors;
        const service = H.createDoorService(s.bot, { settings: {} });
        const calls = [];
        service.reserve = (door, ms) => { calls.push(['reserve', door.x, door.y, door.z, ms]); return true; };
        service.release = door => calls.push(['release', door.x, door.y, door.z]);
        try {
            const r = await P.walkWaypoints(s.bot, s.ctx, s.waypoints, { to: TO_BED, clock: s.clock });
            assert.equal(r.ok, true, r.text);
            assert.deepEqual(calls, [['reserve', 2, 60, -2, 20000], ['release', 2, 60, -2]]);
        } finally {
            service.stop();
        }
    });

    test('no waypoints, no bot: a failure, never a throw', async () => {
        const s = scene();
        const r = await P.walkWaypoints(s.bot, s.ctx, [], { clock: s.clock });
        assert.equal(r.ok, false);
        assert.equal(r.text, 'The route has no steps.');
        const none = await P.walkWaypoints(null, s.ctx, s.waypoints, {});
        assert.equal(none.ok, false);
        assert.equal(none.reason, 'error');
    });
});

describe('dryScan (I7, N1)', () => {
    test('every hop has a path: ok, nothing moved; the foot is searched as its floor cell, the climb is no search', async () => {
        const s = scene();
        const r = await P.dryScan(s.bot, s.waypoints, { to: TO_BED });
        assert.deepEqual(r, { ok: true, step: null, total: 5, from: null, to: null, cause: null, text: '' });
        assert.deepEqual(s.gotos, [], 'the bot does not move');
        assert.deepEqual(s.searches.map(x => [x.from, x.to]), [
            [[2, 41, 1], [2, 41, -1]], [[2, 61, -3], [-3, 61, 2]]], 'F10: the closed trapdoor the bot can open is passable, no search; a hop to the same cell is none');
        assert.ok(s.searches.every(x => Number.isFinite(x.radius) && x.radius >= 24), 'a bounded search');
    });

    test('from the bed, the first hop has none: the first form of N1', async () => {
        const s = scene({ pos: [-2.5, 61, 2.5] });
        s.noPath.add(key(2, 61, -3));
        const r = await P.dryScan(s.bot, s.waypoints, { to: TO_ROOM });
        assert.equal(r.ok, false);
        assert.equal(r.step, 1);
        assert.equal(r.text, 'I find no way from (-3, 61, 2) to (2, 61, -3).');
        assert.deepEqual(s.gotos, []);
    });

    test('a closed trapdoor with a block on it over the column (canOpen says no): the second form of N1, the cause door', async () => {
        const s = scene();
        s.world.set(2, 61, -2, 'stone');
        const r = await P.dryScan(s.bot, s.waypoints, { to: TO_BED });
        assert.equal(r.text, 'I find no way from (2, 41, -1) to the trapdoor at (2, 60, -2): it is closed and I cannot open it.');
        assert.deepEqual(r.cause, { kind: 'door', name: 'trapdoor', x: 2, y: 60, z: -2, state: 'closed' });
        assert.equal(r.step, 3, 'the climb');
    });

    test('the door of the spec: closed, a block behind it', async () => {
        const world = makeWorld();
        world.set(9, 64, 43, 'oak_door', { facing: 'south', half: 'lower', open: false, powered: false });
        world.set(9, 65, 43, 'oak_door', { facing: 'south', half: 'upper', open: false, powered: false });
        world.set(9, 64, 44, 'stone');
        const bot = makeMiningBot({ world, pos: [9.5, 64, 40.5] });
        const noPath = new Set([key(9, 64, 44)]);
        bot.pathfinder.getPathFromTo = function* (m, start, goal) {
            yield { result: { status: start.z < 43 && noPath.has(key(goal.x, goal.y, goal.z)) ? 'noPath' : 'success' } };
        };
        const route = { name: 'mine', legs: [
            { kind: 'walk', from: { x: 9, y: 64, z: 40 }, to: { x: 9, y: 64, z: 42 } },
            { kind: 'door', kind2: 'door', name: 'oak_door', x: 9, y: 64, z: 43, from: { x: 9, y: 64, z: 42 }, to: { x: 9, y: 64, z: 44 } },
            { kind: 'walk', from: { x: 9, y: 64, z: 44 }, to: { x: 9, y: 64, z: 48 } },
        ] };
        const r = await P.dryScan(bot, P.waypointsOf(route), { to: { x: 9, y: 64, z: 48 } });
        assert.equal(r.text, 'I find no way from (9, 64, 42) to the door at (9, 64, 43): it is closed and I cannot open it.');
        world.set(9, 64, 44, 'air');
        assert.equal(H.canOpen(bot, { x: 9, y: 64, z: 43 }), true, 'without the block the door can be opened');
        // F10: a closed door the bot can open is passable: the scan searches on from the cell behind it
        const open = await P.dryScan(bot, P.waypointsOf(route), { to: { x: 9, y: 64, z: 48 } });
        assert.equal(open.ok, true, open.text);
    });

    test('a hop without an openable names its waypoint', async () => {
        const first = scene();
        first.noPath.add(key(2, 41, -1));
        assert.equal((await P.dryScan(first.bot, first.waypoints, { to: TO_BED })).text, 'I find no way from (2, 41, 1) to (2, 41, -1).');
    });

    test('a search that runs out of time proves nothing: the hop counts as open', async () => {
        const s = scene();
        s.bot.searchStatus = 'timeout';
        assert.equal((await P.dryScan(s.bot, s.waypoints, { to: TO_BED })).ok, true);
    });

    test('without getPathFromTo the first hop is asked with getPathTo, the others count as open', async () => {
        const s = scene();
        delete s.bot.pathfinder.getPathFromTo;
        s.bot.pathfinder.getPathTo = () => ({ status: 'noPath' });
        const r = await P.dryScan(s.bot, s.waypoints, { to: TO_BED });
        assert.equal(r.text, 'I find no way from (2, 41, 1) to (2, 41, -1).');
    });

    test('the labels of the waypoints', () => {
        assert.equal(P.waypointLabel({ kind: 'gate', x: -6, y: 63, z: 28 }), 'the gate at (-6, 63, 28)');
        assert.equal(P.waypointLabel({ kind: 'ladder_foot', x: 1, y: 2, z: 3 }), 'the foot of the ladder at (1, 2, 3)');
        assert.equal(P.waypointLabel({ kind: 'room', x: 1, y: 2, z: 3 }), 'the room at (1, 2, 3)');
        assert.equal(P.waypointLabel({ kind: 'end', name: 'mine', x: 1, y: 2, z: 3 }), 'the end of the route "mine" at (1, 2, 3)');
        assert.equal(P.noWayText({ x: 11, y: 67, z: 52 }, { kind: 'trapdoor', x: 13, y: 67, z: 51 }), 'I find no way from (11, 67, 52) to the trapdoor at (13, 67, 51).');
    });
});

describe('ctx.routes.walkTo with routes_by_search (the walks of !goToBed, !goToShelter, !goToPlace)', () => {
    function bound(s, on) {
        const store = { list: () => [SHAFT] };
        return P.bindRoutes(s.bot, { ...s.ctx, settings: { routes_by_search: on } }, store, null);
    }

    test('on: the dry scan before the first step; a hop without a way: the text of N1 and the bot does not move', async () => {
        const s = scene();
        s.noPath.add(key(-3, 61, 2));
        const r = await bound(s, true).walkTo(s.bot, TO_BED, { clock: s.clock });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'no_path');
        assert.equal(r.text, 'I find no way from (2, 61, -3) to the end of the route "bed" at (-3, 61, 2).');
        assert.equal(r.route, 'bed');
        assert.deepEqual(s.gotos, []);
        assert.deepEqual(s.feet(), [2, 41, 1]);
    });

    test('on: the scan finds every hop, then the waypoints are walked', async () => {
        const s = scene({ pos: [2.5, 50, -1.5] });
        const r = await bound(s, true).walkTo(s.bot, TO_BED, { clock: s.clock });
        assert.equal(r.ok, true, r.text);
        assert.equal(r.text, 'I followed the route "bed", 3 steps.');
        assert.deepEqual(s.feet(), [-3, 61, 2]);
    });

    test('routeFor: by the waypoints with the switch on, by the ends of the legs with it off', () => {
        const s = scene({ pos: [2.5, 50, -1.5] });
        assert.ok(Array.isArray(bound(s, true).routeFor(TO_BED).waypoints));
        assert.equal(bound(s, false).routeFor(TO_BED).waypoints, undefined);
    });

    test('off: no dry scan, the legs of v0.1.4.10', async () => {
        const s = scene({ pos: [-2.5, 61, 2.5] });
        s.bot.interrupt_code = true; // the legs stop at once; only who walks matters here
        const r = await bound(s, false).walkTo(s.bot, TO_ROOM, { clock: s.clock });
        assert.equal(s.searches.length, 0);
        assert.match(r.text, /^I was stopped on the route "bed" at step 1 of 4\.$/, 'the 4 legs, not the hops');
    });
});

describe('fix round F1: a ladder is climbed by the ladder leg, its foot on the floor', () => {
    // the second shaft of the owner: the lowest ladder at y 44, the floor of the room at y 41 (feet), 2 cells without
    // ladders between them; the route of the legs without a `foot`, so the foot is the floor under the column
    const SHAFT2 = {
        name: 'mine', from: { x: 2, y: 41, z: 1 }, to: { x: -3, y: 61, z: 2 },
        legs: [
            { kind: 'walk', from: { x: 2, y: 41, z: 1 }, to: { x: 2, y: 41, z: -1 } },
            { kind: 'ladder', x: 2, z: -2, top: 59, bottom: 44, face: 'south', entry: { x: 2, y: 61, z: -3 } },
            { kind: 'door', kind2: 'trapdoor', name: 'oak_trapdoor', x: 2, y: 60, z: -2, from: { x: 2, y: 59, z: -2 }, to: { x: 2, y: 61, z: -3 } },
            { kind: 'walk', from: { x: 2, y: 61, z: -3 }, to: { x: -3, y: 61, z: 2 } },
        ],
    };

    test('without ladders in the bag: the cause ladder and the third form of N1, nothing moved', async () => {
        const s = scene({ lowest: 44 });
        const list = P.waypointsOf(SHAFT2);
        const r = await P.dryScan(s.bot, list, { to: TO_BED });
        assert.equal(r.ok, false);
        assert.equal(r.text, 'I find no way from (2, 41, -2) to the foot of the ladder at (2, 44, -2): the ladder has a gap of 2 at y 42 and I have no ladders.');
        assert.deepEqual(r.cause, { kind: 'ladder', x: 2, z: -2, y: 42, gap: 2 });
        assert.equal(r.step, 3);
        assert.deepEqual(s.searches.map(x => x.to), [[2, 41, -1], [2, 41, -2]], 'the foot is searched as the floor under the column, never the air');
        assert.deepEqual(s.gotos, []);
        give(s.bot, 'ladder', 1);
        assert.equal((await P.dryScan(s.bot, list, { to: TO_BED })).text,
            'I find no way from (2, 41, -2) to the foot of the ladder at (2, 44, -2): the ladder has a gap of 2 at y 42 and I have only 1 ladder.');
    });

    test('with ladders in the bag: the scan is open, the walk places them and climbs', async () => {
        const s = scene({ lowest: 44 });
        give(s.bot, 'ladder', 4);
        const list = P.waypointsOf(SHAFT2);
        const scan = await P.dryScan(s.bot, list, { to: TO_BED });
        assert.equal(scan.ok, true, scan.text);
        const r = await P.walkWaypoints(s.bot, s.ctx, list, { to: TO_BED, clock: s.clock });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(s.bot.calls.filter(c => c[0] === 'place').map(c => [c[1], c[2], c[3], c[4]]), [[2, 42, -2, 'ladder'], [2, 43, -2, 'ladder']]);
        assert.deepEqual(s.feet(), [-3, 61, 2]);
        assert.equal(s.bot.calls.filter(c => c[0] === 'dig').length, 0);
    });

    test('a column with every ladder: the climb is open without ladders in the bag', async () => {
        const s = scene();
        const leg = SHAFT.legs[1];
        assert.deepEqual(P.ladderCheck(s.bot, leg, 'up'), { ok: true, gap: 0, y: null, carried: 0 });
        assert.equal(P.ladderCheck(s.bot, leg, 'down').ok, true);
        s.world.set(2, 50, -2, 'air');
        s.world.set(2, 51, -2, 'air');
        assert.equal(P.ladderCheck(s.bot, leg, 'down').ok, true, 'down, a gap of 2 is a fall of 3 blocks');
        assert.deepEqual(P.ladderCheck(s.bot, leg, 'up'), { ok: false, gap: 2, y: 50, carried: 0 });
    });

    test('ladderStand: the entry at the top, the floor under a column that ends above it', () => {
        const s = scene({ lowest: 44 });
        const list = P.waypointsOf(SHAFT2);
        const foot = list.find(w => w.kind === 'ladder_foot');
        const top = list.find(w => w.kind === 'ladder_top');
        assert.deepEqual(P.ladderStand(s.bot, foot), { x: 2, y: 41, z: -2 });
        assert.deepEqual(P.ladderStand(s.bot, top), { x: 2, y: 61, z: -3 });
    });
});

describe('F8: out through the double door, one block above the first step of the descent', () => {
    // the room at y 41 (floor 40), x 0..4, z -2..2, closed to the east by a stone wall at x 4 with a closed oak door at
    // (4, 41, 0) facing west; the descent: step 1 at (5, 40, 0), step 2 at (6, 39, 0), cut 3 high. The path search of the
    // fake has no move for the jump up into the closed door: a goal in the room fails while the door is closed.
    function doorScene() {
        const world = makeWorld();
        world.fill(0, 41, -2, 4, 43, 2, 'air');
        world.fill(4, 41, -2, 4, 43, 2, 'stone');
        world.set(4, 41, 0, 'oak_door', { facing: 'west', half: 'lower', hinge: 'left', open: false, powered: false });
        world.set(4, 42, 0, 'oak_door', { facing: 'west', half: 'upper', hinge: 'left', open: false, powered: false });
        world.fill(5, 40, 0, 5, 42, 0, 'air');
        world.fill(6, 39, 0, 6, 41, 0, 'air');
        const bot = makeMiningBot({ world, pos: [6.5, 39, 0.5] });
        const clock = makeClock(bot);
        const clicks = [];
        bot.activateBlock = async (block) => {
            const p = block.position;
            clicks.push([p.x, p.y, p.z]);
            for (const y of [p.y, p.y + 1]) {
                if (world.nameAt(p.x, y, p.z) === 'oak_door') world.set(p.x, y, p.z, 'oak_door', { ...world.propsAt(p.x, y, p.z), open: world.propsAt(p.x, y, p.z).open !== true });
            }
        };
        const gotos = [];
        bot.pathfinder.goto = async (goal) => {
            gotos.push([goal.x, goal.y, goal.z]);
            if (bot.entity.position.x >= 4 && goal.x <= 3 && world.propsAt(4, 41, 0).open !== true) {
                const err = new Error('No path to the goal!');
                err.name = 'NoPath';
                throw err;
            }
            bot.entity.position = v(goal.x + 0.5, goal.y, goal.z + 0.5);
        };
        bot.pathfinder.getPathFromTo = function* (m, start, goal) {
            yield { result: { status: start.x >= 4 && goal.x <= 3 && world.propsAt(4, 41, 0).open !== true ? 'noPath' : 'success', path: [] } };
        };
        const route = { name: 'mine', legs: [
            { kind: 'walk', from: { x: 6, y: 39, z: 0 }, to: { x: 5, y: 40, z: 0 } },
            { kind: 'door', kind2: 'door', name: 'oak_door', x: 4, y: 41, z: 0, from: { x: 5, y: 40, z: 0 }, to: { x: 3, y: 41, z: 0 } },
            { kind: 'walk', from: { x: 3, y: 41, z: 0 }, to: { x: 1, y: 41, z: 0 } },
        ] };
        const ctx = { now: clock.now, log: () => {}, doors: { reserve: () => true, release: () => {} } };
        return { world, bot, clock, ctx, clicks, gotos, waypoints: P.waypointsOf(route) };
    }

    test('the dry scan: a door blocked behind is named with the second form', async () => {
        const s = doorScene();
        s.world.set(3, 41, 0, 'stone'); // blocked behind: it cannot be passed
        assert.equal((await P.dryScan(s.bot, s.waypoints, { to: { x: 1, y: 41, z: 0 } })).text,
            'I find no way from (5, 40, 0) to the door at (4, 41, 0): it is closed and I cannot open it.');
    });

    test('the walk opens the door before the hop through it and reaches the room', async () => {
        const s = doorScene();
        const r = await P.walkWaypoints(s.bot, s.ctx, s.waypoints, { to: { x: 1, y: 41, z: 0 }, clock: s.clock });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(s.clicks, [[4, 41, 0], [4, 41, 0]], 'opened, and closed behind the bot (F12)');
        assert.equal(s.world.propsAt(4, 41, 0).open, false);
        assert.deepEqual([Math.floor(s.bot.entity.position.x), Math.floor(s.bot.entity.position.y), Math.floor(s.bot.entity.position.z)], [1, 41, 0]);
    });

    test('a door out of reach when the hop fails: to the door, open it, the hop once more', async () => {
        const s = doorScene();
        s.bot.entity.position = v(12.5, 39, 0.5);
        s.world.fill(7, 39, 0, 12, 41, 0, 'air');
        const list = [{ x: 12, y: 39, z: 0, kind: 'start', name: 'mine' }, ...s.waypoints.slice(2)];
        const r = await P.walkWaypoints(s.bot, s.ctx, list, { to: { x: 1, y: 41, z: 0 }, clock: s.clock });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(s.clicks[0], [4, 41, 0]);
    });
});

describe('F10: the dry scan covers the walk to the goal only, passes doors the bot can open, and answers within 10 s', () => {
    test('planHops: a goal in the middle of the way: the hops end there, never beyond', () => {
        const list = [0, 1, 2, 3, 4, 5].map(i => ({ x: i * 4, y: 64, z: 0, kind: i === 0 ? 'start' : (i === 5 ? 'end' : 'walk') }));
        list[3].kind = 'room';
        const plan = P.planHops(list, { x: 0.5, y: 64, z: 0.5 }, { x: 12, y: 64, z: 0 });
        assert.deepEqual(plan.hops.map(h => h.goal), [1, 2, 3]);
        const back = P.planHops(list, { x: 20.5, y: 64, z: 0.5 }, { x: 12, y: 64, z: 0 });
        assert.deepEqual(back.hops.map(h => h.goal), [4, 3]);
    });

    test('a search that never ends: the scan answers within 10 s in all (here 0.3 s for the test)', async () => {
        const s = scene();
        s.bot.pathfinder.getPathFromTo = function* () {
            for (;;) yield { result: { status: 'partial', path: [] } };
        };
        const t0 = Date.now();
        const r = await P.dryScan(s.bot, s.waypoints, { to: TO_BED, timeoutMs: 100, totalMs: 300 });
        assert.equal(r.ok, true, 'what is left unsearched counts as open');
        assert.ok(Date.now() - t0 < 2000, `${Date.now() - t0} ms`);
        assert.equal(P.DRY_SCAN_RULES.totalMs, 10000);
    });
});

const L = await loadSrc('src/agent/packs/mining/ladder.js');
const DOOR_LOGIC = await loadSrc('src/agent/packs/home/door_logic.js');
const WatchClass = () => DOOR_LOGIC.DoorWatch;

describe('F11: on the ladder between the floors when the order comes', () => {
    test('a bot that holds on (sneak, the hold of a stopped follow) slides down from the middle of the column', async () => {
        const s = scene({ pos: [2.5, 52, -1.5] });
        s.bot.entity.onGround = false;
        assert.equal(L.holdOnLadder(s.bot), true, 'it holds on, as after the stopped follow');
        assert.equal(s.bot.controls.sneak, true);
        const r = await L.slideDown(s.bot, SHAFT.legs[1], { clock: s.clock });
        assert.equal(r.ok, true, r.reason);
        assert.deepEqual(s.feet(), [2, 41, -2]);
        assert.equal(s.bot.calls.filter(c => c[0] === 'goto').length, 0, 'no walk to the entry from inside the column');
    });

    test('the waypoint walk from there into the room, the trapdoor above left alone', async () => {
        const s = scene({ pos: [2.5, 52, -1.5] });
        s.bot.entity.onGround = false;
        L.holdOnLadder(s.bot);
        const r = await P.walkWaypoints(s.bot, s.ctx, s.waypoints, { to: TO_ROOM, clock: s.clock });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(s.feet(), [2, 41, 1]);
        assert.deepEqual(s.bot.calls.filter(c => c[0] === 'activate'), []);
    });

    test('the way up from the middle while it holds on: it climbs', async () => {
        const s = scene({ pos: [2.5, 52, -1.5] });
        s.bot.entity.onGround = false;
        L.holdOnLadder(s.bot);
        const r = await P.walkWaypoints(s.bot, s.ctx, s.waypoints, { to: TO_BED, clock: s.clock });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(s.feet(), [-3, 61, 2]);
    });
});

describe('F12: what the walk passed is closed behind it', () => {
    test('a trapdoor climbed through and the bed reached: the trapdoor closed', async () => {
        const s = scene();
        const r = await P.walkWaypoints(s.bot, s.ctx, s.waypoints, { to: TO_BED, clock: s.clock });
        assert.equal(r.ok, true, r.text);
        assert.equal(s.world.propsAt(2, 60, -2).open, false);
    });

    test('released as passed: the door service notes it and closes it by its rules', () => {
        const DL = { x: 0, y: 64, z: 0, kind: 'door', open: true, name: 'oak_door', facing: 'east' };
        const watch = new (WatchClass())();
        watch.reserve(DL, 0, 5000);
        watch.release(DL, { passed: true, now: 100 });
        const out = watch.observe({ now: 200, botPos: { x: 3.5, y: 64, z: 0.5 }, moving: true, doors: [{ ...DL }], players: [] });
        assert.equal(out.length, 1, 'closed 2 blocks past it, though the service never saw the pass');
        const near = new (WatchClass())();
        near.release(DL, { passed: true, now: 100 });
        assert.deepEqual(near.observe({ now: 200, botPos: { x: 1.2, y: 64, z: 0.5 }, moving: true, doors: [{ ...DL }], players: [] }), [], 'not while the bot is still in it');
    });
});

describe('F10 follow-up: a hop from a cell to the same cell is no hop', () => {
    test('after a passable door the scan goes on from the cell beyond it; a waypoint in that cell is no hop, the next hop is named', async () => {
        const world = makeWorld();
        world.set(9, 64, 43, 'oak_door', { facing: 'south', half: 'lower', open: false, powered: false });
        world.set(9, 65, 43, 'oak_door', { facing: 'south', half: 'upper', open: false, powered: false });
        const bot = makeMiningBot({ world, pos: [9.5, 64, 40.5] });
        const searches = [];
        bot.pathfinder.getPathFromTo = function* (m, start, goal) {
            searches.push([[Math.floor(start.x), Math.floor(start.y), Math.floor(start.z)], [goal.x, goal.y, goal.z]]);
            yield { result: { status: goal.z === 48 ? 'noPath' : 'success' } };
        };
        const route = { name: 'mine', legs: [
            { kind: 'walk', from: { x: 9, y: 64, z: 40 }, to: { x: 9, y: 64, z: 42 } },
            { kind: 'door', kind2: 'door', name: 'oak_door', x: 9, y: 64, z: 43, from: { x: 9, y: 64, z: 42 }, to: { x: 9, y: 64, z: 44 } },
            { kind: 'walk', from: { x: 9, y: 64, z: 44 }, to: { x: 9, y: 64, z: 48 } },
        ] };
        const r = await P.dryScan(bot, P.waypointsOf(route), { to: { x: 9, y: 64, z: 48 } });
        assert.equal(r.text, 'I find no way from (9, 64, 44) to the end of the route "mine" at (9, 64, 48).');
        assert.ok(!searches.some(([a, b]) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]), JSON.stringify(searches));
    });
});

describe('F6: a closed iron trapdoor over the column on the way down', () => {
    test('the bot by the trapdoor going down: the second form of N1 naming the trapdoor, nothing moved', async () => {
        const s = scene({ pos: [-2.5, 61, 2.5] });
        s.world.set(2, 60, -2, 'iron_trapdoor', { facing: 'south', half: 'top', open: false });
        const r = await P.dryScan(s.bot, s.waypoints, { to: TO_ROOM });
        assert.equal(r.ok, false);
        assert.equal(r.text, 'I find no way from (2, 61, -3) to the trapdoor at (2, 60, -2): it is closed and I cannot open it.');
        assert.deepEqual(r.cause, { kind: 'door', name: 'trapdoor', x: 2, y: 60, z: -2, state: 'closed' });
        assert.deepEqual(s.gotos, []);
        assert.deepEqual(s.feet(), [-3, 61, 2]);
    });

    test('a bot already below it in the column: the trapdoor does not matter on the way down', async () => {
        const s = scene({ pos: [2.5, 52, -1.5] });
        s.world.set(2, 60, -2, 'iron_trapdoor', { facing: 'south', half: 'top', open: false });
        assert.equal((await P.dryScan(s.bot, s.waypoints, { to: TO_ROOM })).ok, true);
    });
});
