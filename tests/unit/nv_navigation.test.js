// Tester T1 of v0.1.4.11 "Navigation and words", from the spec: part N. I7 the waypoints (waypointsOf for each leg kind,
// nearestWaypoint, the direction toward the end nearer to the goal, walkWaypoints with GoalNear 1 and at most 60 s a
// hop, no digging, the cause of I1; dryScan without moving, stopping at the first hop with no path, the texts of N1),
// I8 the reservation of a door, N2 the walk toward the player (the text, no digging, no destructive fallback, the
// cave). Part N is being built while this file is written: every export of it is reached with optional chaining, so
// a missing export is a failing test, not a crash of the file.
//
// The world (the fake bot of the mining pack, ground at y 60): a house door (oak) at (0, 61, -3), an oak trapdoor at
// (2, 60, -2) in the ground over a ladder column at (2, 41..59, -2), the room of the mine at y 41 (x 0..4, z -2..2).
// The route "mine" goes from the area "home" at (-3, 61, 2) through the door, down the trapdoor and the ladder, into
// the room at (2, 41, 1).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { REGISTRY, makeWorld, makeMiningBot, makeClock, give, v } from './mining_fake_bot.test.js';

register('../helpers/mcdata_hooks.js', import.meta.url);

const R = await loadSrc('src/agent/packs/routes/index.js');
const DL = await loadSrc('src/agent/packs/home/door_logic.js');
const DS = await loadSrc('src/agent/packs/home/doors.js');
const mcdata = await loadSrc('src/utils/mcdata.js');
mcdata.__setMcdataForTests(REGISTRY);
const skills = await loadSrc('src/agent/library/skills.js');

let quiet;
before(() => {
    quiet = { log: console.log, warn: console.warn };
    console.log = () => {};
    console.warn = () => {};
});
after(() => {
    console.log = quiet.log;
    console.warn = quiet.warn;
    mcdata.__setMcdataForTests(null);
});

// the lead, round 3: the spec (I7) asked for the ends of every leg as waypoints without a kind for them; the kind
// `walk` is added to the spec for the end of a walk or stairs leg in the middle of a route (DECISIONS T1-1)
const SPEC_KINDS = ['start', 'walk', 'door', 'gate', 'trapdoor', 'ladder_top', 'ladder_foot', 'room', 'tunnel', 'end'];

const MINE = {
    name: 'mine',
    from: { name: 'home', kind: 'area', x: -3, y: 61, z: 2 },
    to: { x: 2, y: 41, z: 1 },
    legs: [
        { kind: 'walk', from: { x: -3, y: 61, z: 2 }, to: { x: -1, y: 61, z: -3 } },
        { kind: 'door', kind2: 'door', name: 'oak_door', x: 0, y: 61, z: -3, from: { x: -1, y: 61, z: -3 }, to: { x: 1, y: 61, z: -3 } },
        { kind: 'walk', from: { x: 1, y: 61, z: -3 }, to: { x: 2, y: 61, z: -3 } },
        { kind: 'door', kind2: 'trapdoor', name: 'oak_trapdoor', x: 2, y: 60, z: -2, from: { x: 2, y: 61, z: -3 }, to: { x: 2, y: 59, z: -2 } },
        { kind: 'ladder', x: 2, z: -2, top: 59, bottom: 41, face: 'south', entry: { x: 2, y: 61, z: -3 }, foot: { x: 2, y: 41, z: -1 } },
        { kind: 'walk', from: { x: 2, y: 41, z: -1 }, to: { x: 2, y: 41, z: 1 } },
    ],
};
const HOUSE = { x: -3, y: 61, z: 2 };
const ROOM = { x: 2, y: 41, z: 1 };
const key = (x, y, z) => `${x},${y},${z}`;
const cellOf = (p) => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });

function scene({ pos = [-2.5, 61, 2.5], iron = false, lowest = 41 } = {}) {
    const world = makeWorld({ groundY: 60 });
    world.fill(0, 41, -2, 4, 43, 2, 'air');
    world.fill(2, 44, -2, 2, 59, -2, 'air');
    world.fill(2, lowest, -2, 2, 59, -2, 'ladder', { facing: 'south' });
    world.set(2, 60, -2, 'oak_trapdoor', { facing: 'south', half: 'top', open: false });
    const doorName = iron ? 'iron_door' : 'oak_door';
    world.set(0, 61, -3, doorName, { half: 'lower', facing: 'east', open: false, hinge: 'left', powered: false });
    world.set(0, 62, -3, doorName, { half: 'upper', facing: 'east', open: false, hinge: 'left', powered: false });
    // F1 (DECISIONS.md): the climb is the ladder leg of replay.js, which clicks the trapdoor; as in rta_replay.test.js an
    // open trapdoor is no solid block and activateBlock toggles an openable
    const solid = world.solid;
    world.solid = (x, y, z) => {
        if (world.nameAt(x, y, z).endsWith('_trapdoor') && world.propsAt(x, y, z).open === true) return false;
        return solid(x, y, z);
    };
    const bot = makeMiningBot({ world, pos });
    const clock = makeClock(bot);
    bot.modes = { noteProgress: () => {} };
    bot.activateBlock = async (block) => {
        const p = block.position;
        bot.calls.push(['activate', p.x, p.y, p.z]);
        world.set(p.x, p.y, p.z, world.nameAt(p.x, p.y, p.z), { ...world.propsAt(p.x, p.y, p.z), open: world.propsAt(p.x, p.y, p.z).open !== true });
    };
    const events = [];
    const blocked = new Set();
    bot.hang = false;
    bot.pathfinder.goto = async (goal) => {
        events.push({ goto: [goal.x, goal.y, goal.z], rangeSq: goal.rangeSq, canDig: bot.pathfinder.movements?.canDig });
        if (bot.hang) return new Promise(() => {});
        if (blocked.has(key(goal.x, goal.y, goal.z))) {
            const err = new Error('No path to the goal!');
            err.name = 'NoPath';
            throw err;
        }
        bot.entity.position = v(goal.x + 0.5, goal.y, goal.z + 0.5);
    };
    const noPath = new Set();
    const searches = [];
    bot.pathfinder.getPathFromTo = function* (movements, start, goal) {
        searches.push({ to: [goal.x, goal.y, goal.z], canDig: movements?.canDig });
        yield { result: { status: 'partial', path: [] } };
        yield { result: { status: noPath.has(key(goal.x, goal.y, goal.z)) ? 'noPath' : 'success', path: [] } };
    };
    bot.pathfinder.getPathTo = async (movements, goal) => {
        searches.push({ to: [goal.x, goal.y, goal.z], canDig: movements?.canDig });
        return { status: noPath.has(key(goal.x, goal.y, goal.z)) ? 'noPath' : 'success', path: [] };
    };
    const ctx = {
        now: clock.now,
        log: () => {},
        doors: {
            reserve: (door, ms) => { events.push({ reserve: [door.x, door.y, door.z], ms }); return true; },
            release: (door) => { events.push({ release: door ? [door.x, door.y, door.z] : null }); },
        },
    };
    const feet = () => cellOf({ x: bot.entity.position.x, y: bot.entity.position.y + 0.01, z: bot.entity.position.z });
    return { world, bot, clock, ctx, events, blocked, noPath, searches, feet, waypoints: R.waypointsOf?.(MINE) ?? [] };
}

// ------------------------------------------------------------------------------------------------ waypointsOf

describe('I7: waypointsOf(route)', () => {
    test('the shape { x, y, z, kind, name } and the name of the route', () => {
        const wps = R.waypointsOf?.(MINE);
        assert.ok(Array.isArray(wps) && wps.length > 0, 'waypoints');
        for (const w of wps) {
            for (const k of ['x', 'y', 'z']) assert.ok(Number.isInteger(w[k]), `${k} of ${JSON.stringify(w)}`);
            assert.equal(typeof w.kind, 'string');
            assert.equal(w.name, 'mine');
        }
    });

    test('the kinds are those of I7', () => {
        // Was finding T1-1 (the kind 'walk' was not in the list of I7); the lead added 'walk' to the spec (DECISIONS T1-1),
        // so SPEC_KINDS above holds it.
        const kinds = (R.waypointsOf?.(MINE) ?? []).map((w) => w.kind);
        const unknown = kinds.filter((k) => !SPEC_KINDS.includes(k));
        assert.deepEqual([...new Set(unknown)], []);
    });

    test('the start first, the end last', () => {
        const wps = R.waypointsOf?.(MINE) ?? [];
        assert.deepEqual({ ...cellOf(wps[0] ?? {}), kind: wps[0]?.kind }, { ...HOUSE, kind: 'start' });
        const last = wps[wps.length - 1] ?? {};
        assert.deepEqual({ ...cellOf(last), kind: last.kind }, { ...ROOM, kind: 'end' });
    });

    test('a door leg gives its openable, with the kind of the openable', () => {
        const wps = R.waypointsOf?.(MINE) ?? [];
        assert.ok(wps.some((w) => w.kind === 'door' && w.x === 0 && w.y === 61 && w.z === -3), 'the door');
        assert.ok(wps.some((w) => w.kind === 'trapdoor' && w.x === 2 && w.y === 60 && w.z === -2), 'the trapdoor');
        const gate = R.waypointsOf?.({ name: 'pen', legs: [
            { kind: 'walk', from: { x: 0, y: 64, z: 0 }, to: { x: 0, y: 64, z: 3 } },
            { kind: 'door', kind2: 'gate', name: 'oak_fence_gate', x: 0, y: 64, z: 4, from: { x: 0, y: 64, z: 3 }, to: { x: 0, y: 64, z: 5 } },
            { kind: 'walk', from: { x: 0, y: 64, z: 5 }, to: { x: 0, y: 64, z: 9 } },
        ] }) ?? [];
        assert.ok(gate.some((w) => w.kind === 'gate' && w.x === 0 && w.y === 64 && w.z === 4), JSON.stringify(gate));
    });

    test('a ladder leg gives its top and its foot, in the column, the top above the foot', () => {
        const wps = R.waypointsOf?.(MINE) ?? [];
        const top = wps.find((w) => w.kind === 'ladder_top');
        const foot = wps.find((w) => w.kind === 'ladder_foot');
        assert.ok(top && foot, JSON.stringify(wps));
        assert.ok(Math.abs(top.x - 2) <= 1 && Math.abs(top.z + 2) <= 1 && top.y >= 59, `top ${JSON.stringify(top)}`);
        assert.ok(Math.abs(foot.x - 2) <= 1 && Math.abs(foot.z + 2) <= 1 && foot.y === 41, `foot ${JSON.stringify(foot)}`);
        const i = wps.indexOf(top);
        const j = wps.indexOf(foot);
        assert.ok(i < j, 'the way down: the top first');
    });

    test('the ends of every leg are waypoints', () => {
        const wps = R.waypointsOf?.(MINE) ?? [];
        const has = (p) => wps.some((w) => w.x === p.x && w.y === p.y && w.z === p.z);
        for (const leg of MINE.legs) {
            if (leg.kind === 'ladder') continue; // the top and the foot, above
            assert.ok(has(leg.from), `from ${JSON.stringify(leg.from)}`);
            assert.ok(has(leg.to), `to ${JSON.stringify(leg.to)}`);
        }
    });

    test('a route without legs gives no waypoints', () => {
        assert.deepEqual(R.waypointsOf?.({ name: 'x', legs: [] }), []);
    });
});

describe('I7: nearestWaypoint(waypoints, pos) -> index', () => {
    test('the index of the nearest', () => {
        const wps = R.waypointsOf?.(MINE) ?? [];
        const door = wps.findIndex((w) => w.kind === 'door');
        assert.equal(R.nearestWaypoint?.(wps, { x: 0.5, y: 61, z: -2.4 }), door);
        assert.equal(R.nearestWaypoint?.(wps, { x: -3.4, y: 61, z: 2.6 }), 0);
        assert.equal(R.nearestWaypoint?.(wps, { x: 2.5, y: 41, z: 1.5 }), wps.length - 1);
    });

    test('a list of plain points works (the interface takes waypoints)', () => {
        const wps = [{ x: 0, y: 64, z: 0, kind: 'start', name: null }, { x: 10, y: 64, z: 0, kind: 'end', name: null }];
        assert.equal(R.nearestWaypoint?.(wps, { x: 8, y: 64, z: 0 }), 1);
    });
});

// ------------------------------------------------------------------------------------------------ walkWaypoints

describe('I7: walkWaypoints(bot, ctx, waypoints, { from, to, clock, deadline })', () => {
    test('from the house to the room: arrives, GoalNear 1 each hop, no digging, the result of I7', async () => {
        const s = scene();
        const r = await R.walkWaypoints?.(s.bot, s.ctx, s.waypoints, { to: ROOM, clock: s.clock });
        assert.ok(r, 'a result');
        for (const k of ['ok', 'reason', 'text', 'step', 'total', 'at', 'cause']) assert.ok(Object.hasOwn(r, k), k);
        assert.equal(r.ok, true, r.text);
        assert.equal(r.cause, null);
        assert.deepEqual(s.feet(), ROOM);
        const gotos = s.events.filter((e) => e.goto);
        assert.ok(gotos.length > 0);
        // F1 (DECISIONS.md): GoalNear 1 holds for the hops of the path search; the climb is the ladder leg of replay.js
        // with its own goals: the cells of the column at (2, -2), its entry (2, 61, -3) and its foot (2, 41, -1)
        const ladderLeg = ([x, y, z]) => (x === 2 && z === -2) || (x === 2 && y === 61 && z === -3) || (x === 2 && y === 41 && z === -1);
        const searchHops = gotos.filter((g) => !ladderLeg(g.goto));
        assert.ok(searchHops.length > 0, 'hops of the path search');
        for (const g of searchHops) {
            assert.equal(g.rangeSq, 1, `GoalNear 1: ${JSON.stringify(g)}`);
            assert.equal(g.canDig, false, `no digging: ${JSON.stringify(g)}`);
        }
        for (const g of gotos) assert.notEqual(g.canDig, true, `no digging: ${JSON.stringify(g)}`);
        assert.equal(s.bot.calls.filter((c) => c[0] === 'dig').length, 0);
    });

    test('I8: the openable of a hop is reserved before the hop, for at most 20 s', async () => {
        const s = scene();
        await R.walkWaypoints?.(s.bot, s.ctx, s.waypoints, { to: ROOM, clock: s.clock });
        const reserves = s.events.filter((e) => e.reserve);
        const at = (k) => s.events.findIndex((e) => e.reserve && key(...e.reserve) === k);
        assert.ok(at('0,61,-3') >= 0, 'the house door is reserved');
        assert.ok(at('2,60,-2') >= 0, 'the trapdoor is reserved');
        for (const e of reserves) assert.ok(e.ms > 0 && e.ms <= 20000, `ms ${e.ms}`);
        // the goto that passes the door (to the cell beyond it) comes after its reservation
        const beyond = s.events.findIndex((e) => e.goto && e.goto[0] >= 1 && e.goto[1] === 61 && e.goto[2] === -3);
        if (beyond >= 0) assert.ok(at('0,61,-3') < beyond, 'reserved before the hop');
        const down = s.events.findIndex((e) => e.goto && e.goto[1] < 60);
        assert.ok(down < 0 || at('2,60,-2') < down, 'the trapdoor reserved before the hop down');
    });

    test('the direction: from the room toward the house the walk goes the other way', async () => {
        // F1 (DECISIONS.md): the climb up is the ladder leg of replay.js; it opens the trapdoor with activateBlock (scene)
        const s = scene({ pos: [2.5, 41, 1.5] });
        const r = await R.walkWaypoints?.(s.bot, s.ctx, s.waypoints, { to: HOUSE, clock: s.clock });
        assert.equal(r?.ok, true, r?.text);
        assert.deepEqual(s.feet(), HOUSE);
        const ys = s.events.filter((e) => e.goto).map((e) => e.goto[1]);
        assert.ok(ys[0] <= 41 + 1 || ys[0] < ys[ys.length - 1], `up the shaft: ${ys}`);
    });

    test('joined half way down the ladder, toward the room: never up to the top first (W95)', async () => {
        const s = scene({ pos: [2.5, 50, -1.5] });
        const r = await R.walkWaypoints?.(s.bot, s.ctx, s.waypoints, { to: ROOM, clock: s.clock });
        assert.equal(r?.ok, true, r?.text);
        const ups = s.events.filter((e) => e.goto && e.goto[1] > 50);
        assert.deepEqual(ups, [], 'no goal above the bot');
        assert.deepEqual(s.feet(), ROOM);
    });

    test('joined in the room, toward the house: from the nearest waypoint, not from the start', async () => {
        // F1 (DECISIONS.md): the climb up is the ladder leg of replay.js; it opens the trapdoor with activateBlock (scene)
        const s = scene({ pos: [1.5, 41, -0.5] });
        const r = await R.walkWaypoints?.(s.bot, s.ctx, s.waypoints, { to: HOUSE, clock: s.clock });
        assert.equal(r?.ok, true, r?.text);
        const first = s.events.find((e) => e.goto)?.goto;
        assert.ok(first && !(first[0] === -3 && first[1] === 61), `the first hop is not the house: ${first}`);
        assert.deepEqual(s.feet(), HOUSE);
    });

    test('a walk hop with no path: cause no_path from where the bot stood to the waypoint, the W1 text', async () => {
        const s = scene();
        s.blocked.add(key(-1, 61, -3));
        const r = await R.walkWaypoints?.(s.bot, s.ctx, s.waypoints, { to: ROOM, clock: s.clock });
        assert.equal(r?.ok, false);
        assert.deepEqual(r?.cause, { kind: 'no_path', from: { x: -3, y: 61, z: 2 }, to: { x: -1, y: 61, z: -3 } });
        assert.match(r?.text ?? '', /^I could not follow the route "mine" at step \d+ of \d+: I found no way from \(-3, 61, 2\) to \(-1, 61, -3\)\.$/);
        assert.equal(r.step >= 1 && r.step <= r.total, true, `step ${r.step} of ${r.total}`);
    });

    test('a hop through a closed door that fails: cause door, blocked, and the W1 text', async () => {
        // F8 (the lead): the walk opens a closed door it can reach before the hop, so a door whose far side is
        // blocked fails as "blocked", not "closed"; the W1 text of a blocked openable
        const s = scene({ pos: [-0.5, 61, -2.5] });
        s.blocked.add(key(1, 61, -3));
        const r = await R.walkWaypoints?.(s.bot, s.ctx, s.waypoints, { to: ROOM, clock: s.clock });
        assert.equal(r?.ok, false);
        assert.deepEqual(r?.cause, { kind: 'door', name: 'door', x: 0, y: 61, z: -3, state: 'blocked' });
        assert.match(r?.text ?? '', /^I could not follow the route "mine" at step \d+ of \d+: the door at \(0, 61, -3\) is blocked\.$/);
    });

    test('each hop at most 60 s: a path search that never ends gives up after 60 s with the cause stuck', async () => {
        const s = scene();
        s.bot.hang = true;
        const t0 = s.clock.now();
        const r = await R.walkWaypoints?.(s.bot, s.ctx, s.waypoints, { to: ROOM, clock: s.clock });
        const spent = s.clock.now() - t0;
        assert.equal(r?.ok, false);
        assert.ok(spent >= 60000 && spent <= 61000, `spent ${spent} ms`);
        assert.equal(r?.cause?.kind, 'stuck');
        assert.match(r?.text ?? '', /\(-3, 61, 2\)/, 'names where the bot stands');
    });

    test('a stop: cause interrupted', async () => {
        const s = scene();
        s.bot.interrupt_code = true;
        const r = await R.walkWaypoints?.(s.bot, s.ctx, s.waypoints, { to: ROOM, clock: s.clock });
        assert.equal(r?.ok, false);
        assert.deepEqual(r?.cause, { kind: 'interrupted' });
    });

    test('every reservation ends with the walk', async () => {
        const s = scene();
        await R.walkWaypoints?.(s.bot, s.ctx, s.waypoints, { to: ROOM, clock: s.clock });
        const reserved = s.events.filter((e) => e.reserve).map((e) => key(...e.reserve)).sort();
        const released = s.events.filter((e) => e.release).map((e) => (e.release ? key(...e.release) : 'all'));
        assert.ok(released.includes('all') || reserved.every((k) => released.includes(k)), `${reserved} / ${released}`);
    });
});

describe('I1: the failed leg of the replay of v0.1.4.10 (routes_by_search off)', () => {
    test('walkRoute on failure returns { ok: false, reason, text, route, step, total, at, cause } with a cause of I1', async () => {
        const s = scene();
        s.blocked.add(key(-1, 61, -3));
        s.bot.noPath = true;
        const r = await R.walkRoute?.(s.bot, { ...s.ctx, settings: {} }, MINE, { clock: s.clock, now: s.clock.now, wait: s.clock.wait });
        assert.equal(r?.ok, false, r?.text);
        for (const k of ['reason', 'text', 'route', 'step', 'total', 'at', 'cause']) assert.ok(Object.hasOwn(r, k), k);
        assert.ok(['door', 'ladder', 'no_path', 'stuck', 'interrupted'].includes(r.cause?.kind), JSON.stringify(r.cause));
        assert.equal(r.total, MINE.legs.length);
        assert.ok(r.text.startsWith(`I could not follow the route "mine" at step ${r.step} of ${r.total}`), r.text);
        assert.ok(!/show me the way/i.test(r.text), r.text);
    });
});

// ------------------------------------------------------------------------------------------------ dryScan

describe('I7 and N1: dryScan(bot, waypoints, { from, to })', () => {
    test('a free way: ok, and the bot does not move', async () => {
        const s = scene();
        const before = s.feet();
        const r = await R.dryScan?.(s.bot, s.waypoints, { to: ROOM });
        assert.equal(r?.ok, true);
        assert.deepEqual(s.feet(), before);
        assert.equal(s.events.filter((e) => e.goto).length, 0, 'no step');
        assert.ok(s.searches.length > 0, 'the path of each hop is computed');
        for (const q of s.searches) assert.equal(q.canDig, false, 'with the movements of the walk: no digging');
    });

    test('the result of I7: { ok, step, from, to, cause }', async () => {
        const s = scene();
        s.noPath.add(key(-1, 61, -3));
        const r = await R.dryScan?.(s.bot, s.waypoints, { to: ROOM });
        assert.ok(r, 'a result');
        for (const k of ['ok', 'step', 'from', 'to', 'cause']) assert.ok(Object.hasOwn(r, k), k);
        assert.equal(r.ok, false);
        assert.deepEqual(cellOf(r.from), { x: -3, y: 61, z: 2 });
        assert.deepEqual(cellOf(r.to), { x: -1, y: 61, z: -3 });
        assert.equal(r.cause?.kind, 'no_path');
    });

    test('stops at the first hop with no path', async () => {
        const s = scene();
        s.noPath.add(key(-1, 61, -3));
        s.noPath.add(key(2, 41, 1));
        const r = await R.dryScan?.(s.bot, s.waypoints, { to: ROOM });
        assert.deepEqual(cellOf(r?.to ?? {}), { x: -1, y: 61, z: -3 });
        assert.ok(!s.searches.some((q) => q.to[1] === 41), 'no search after the first hop without a path');
    });

    test('N1: the climb up to a trapdoor that cannot be opened: the second form naming the trapdoor', async () => {
        // F1 (DECISIONS.md): a climb is checked (ladderCheck), not searched into the column; an intact column under an
        // openable trapdoor is open. So the trapdoor here is iron (canOpen says no) and the bot climbs up from the room.
        const s = scene({ pos: [2.5, 41, 0.5] });
        s.world.set(2, 60, -2, 'iron_trapdoor', { facing: 'south', half: 'top', open: false, powered: false });
        const before = s.feet();
        const r = await R.dryScan?.(s.bot, s.waypoints, { to: HOUSE });
        assert.equal(r?.ok, false);
        assert.equal(r?.text, 'I find no way from (2, 41, -1) to the trapdoor at (2, 60, -2): it is closed and I cannot open it.');
        assert.deepEqual(r?.cause, { kind: 'door', name: 'trapdoor', x: 2, y: 60, z: -2, state: 'closed' });
        assert.deepEqual(s.feet(), before, 'the bot did not move');
    });

    test('F1: a column with a gap and no ladders in the bag: the cause ladder and the gap text', async () => {
        // F1 (DECISIONS.md): the ladders start at y 44, 2 blocks above the floor of the room at y 41 (the cells 42 and 43
        // are missing); the bot carries no ladders
        const s = scene({ pos: [2.5, 41, 0.5], lowest: 44 });
        const before = s.feet();
        const r = await R.dryScan?.(s.bot, s.waypoints, { to: HOUSE });
        assert.equal(r?.ok, false);
        assert.deepEqual(r?.cause, { kind: 'ladder', x: 2, z: -2, y: 42, gap: 2 });
        assert.equal(r?.text, 'I find no way from (2, 41, -1) to the foot of the ladder at (2, 41, -2): the ladder has a gap of 2 at y 42 and I have no ladders.');
        assert.deepEqual(s.feet(), before, 'the bot did not move');
        assert.equal(s.events.filter((e) => e.goto).length, 0, 'no step');
    });

    test('F1: the same gap with 1 ladder in the bag: "and I have only 1 ladder."; with 2 the scan is open', async () => {
        const s = scene({ pos: [2.5, 41, 0.5], lowest: 44 });
        give(s.bot, 'ladder', 1);
        const r = await R.dryScan?.(s.bot, s.waypoints, { to: HOUSE });
        assert.equal(r?.text, 'I find no way from (2, 41, -1) to the foot of the ladder at (2, 41, -2): the ladder has a gap of 2 at y 42 and I have only 1 ladder.');
        give(s.bot, 'ladder', 1);
        const open = await R.dryScan?.(s.bot, s.waypoints, { to: HOUSE });
        assert.equal(open?.ok, true, open?.text);
    });

    test('N1: a closed iron door that the bot cannot open: the second form, cause door closed', async () => {
        const s = scene({ pos: [-0.5, 61, -2.5], iron: true });
        s.noPath.add(key(1, 61, -3));
        s.noPath.add(key(2, 61, -3));
        const r = await R.dryScan?.(s.bot, s.waypoints, { to: ROOM });
        assert.equal(r?.ok, false);
        assert.equal(r?.text, 'I find no way from (-1, 61, -3) to the door at (0, 61, -3): it is closed and I cannot open it.');
        assert.deepEqual(r?.cause, { kind: 'door', name: 'door', x: 0, y: 61, z: -3, state: 'closed' });
    });

    test('N1 (W96): a closed oak door with a block filling the cell behind it: the second form', async () => {
        const s = scene({ pos: [-0.5, 61, -2.5] });
        s.world.set(1, 61, -3, 'cobblestone').set(1, 62, -3, 'cobblestone');
        s.noPath.add(key(1, 61, -3));
        s.noPath.add(key(2, 61, -3));
        const before = s.feet();
        const r = await R.dryScan?.(s.bot, s.waypoints, { to: ROOM });
        assert.equal(r?.text, 'I find no way from (-1, 61, -3) to the door at (0, 61, -3): it is closed and I cannot open it.');
        assert.deepEqual(s.feet(), before, 'the bot did not move');
    });

    test('N1: a closed oak door that the bot can open is no lock: the first form', async () => {
        const s = scene({ pos: [-0.5, 61, -2.5] });
        s.noPath.add(key(1, 61, -3));
        s.noPath.add(key(2, 61, -3));
        const r = await R.dryScan?.(s.bot, s.waypoints, { to: ROOM });
        assert.equal(r?.text, 'I find no way from (-1, 61, -3) to the door at (0, 61, -3).');
    });
});

// ------------------------------------------------------------------------------------------------ I8

describe('I8: a door a walk is about to pass', () => {
    // A door at (0, 64, 0), its axis along z (facing south). The bot comes from the north, opens it, passes it and
    // stands 3 blocks south of it: the door service of v0.1.4.9 closes such a door.
    const DOOR = { x: 0, y: 64, z: 0 };
    const door = (open) => ({ ...DOOR, kind: 'door', open, name: 'oak_door', facing: 'south', inArea: false, gated: false, occupied: false });
    function passed(watch, t0) {
        watch.observe({ now: t0, botPos: { x: 0.5, y: 64, z: -1.5 }, moving: true, doors: [door(false)], players: [] });
        watch.observe({ now: t0 + 100, botPos: { x: 0.5, y: 64, z: -1.2 }, moving: true, doors: [door(true)], players: [] });
        watch.observe({ now: t0 + 200, botPos: { x: 0.5, y: 64, z: 1.5 }, moving: true, doors: [door(true)], players: [] });
    }
    const close = (watch, now, z) => watch.observe({ now, botPos: { x: 0.5, y: 64, z }, moving: true, doors: [door(true)], players: [] })
        .some((d) => d.x === 0 && d.y === 64 && d.z === 0);

    test('without a reservation the service closes the passed door (the control)', () => {
        const w = new DL.DoorWatch();
        passed(w, 0);
        assert.equal(close(w, 300, 3.5), true);
    });

    test('a reserved door is not closed for ms', () => {
        const w = new DL.DoorWatch();
        assert.equal(typeof w.reserve, 'function', 'DoorWatch.reserve');
        w.reserve?.(DOOR, 0, 10000);
        passed(w, 0);
        assert.equal(close(w, 300, 3.5), false, 'at 0.3 s');
        assert.equal(close(w, 9900, 3.5), false, 'at 9.9 s');
    });

    test('at most 20 s, whatever ms says', () => {
        const w = new DL.DoorWatch();
        w.reserve?.(DOOR, 0, 60000);
        passed(w, 0);
        assert.equal(close(w, 19000, 3.5), false, 'at 19 s');
        assert.equal(close(w, 21000, 3.5), true, 'at 21 s the 20 s are over');
    });

    test('never while the bot is within 1.5 blocks of it', () => {
        const w = new DL.DoorWatch();
        w.reserve?.(DOOR, 0, 1000);
        passed(w, 0);
        assert.equal(close(w, 5000, 1.2), false, 'the bot 0.7 from its centre after the reservation');
    });

    test('the door service of the home pack offers reserve, and the agent gives it to the packs as ctx.doors.reserve', () => {
        const service = DS.createDoorService?.({ entity: { position: { x: 0, y: 64, z: 0 } } }, { settings: {} }, { now: () => 0 });
        try {
            assert.equal(typeof service?.reserve, 'function');
            assert.equal(service.reserve({ x: 1, y: 64, z: 1 }, 5000), true);
        } finally {
            service?.stop?.();
        }
        const agent = fs.readFileSync(repoPath('src/agent/agent.js'), 'utf8');
        assert.match(agent, /doors\s*:\s*\{[\s\S]{0,200}reserve\s*:/, 'ctx.doors.reserve in the pack context');
    });
});

// ------------------------------------------------------------------------------------------------ N2

const PLAYER = 'MartyByrde2';
const NO_WAY = 'I find no way to you from here without digging. Come closer or tell me to dig.';
const DESTRUCTIVE = 'Path not found, but attempting to navigate anyway using destructive movements.';

function playerScene({ world = makeWorld(), pos = [0.5, 64, 0.5], player = [4.5, 64, 0.5], status = 'noPath' } = {}) {
    const bot = makeMiningBot({ world, pos });
    bot.output = '';
    bot.modes = { exists: () => false, isOn: () => false, pause() {}, unpause() {}, noteProgress() {} };
    bot.players = { [PLAYER]: { username: PLAYER, entity: { position: v(...player), height: 1.8, id: 7, type: 'player', username: PLAYER } } };
    bot.entities[7] = bot.players[PLAYER].entity;
    bot.gotos = [];
    bot.digSettings = [];
    const setMovements = bot.pathfinder.setMovements.bind(bot.pathfinder);
    bot.pathfinder.setMovements = (m) => { bot.digSettings.push(m?.canDig); return setMovements(m); };
    bot.pathfinder.getPathFromTo = function* () {
        yield { result: { status: 'partial', path: [] } };
        yield { result: { status, path: [] } };
    };
    bot.pathfinder.getPathTo = async () => ({ status, path: [] });
    bot.pathfinder.goto = async (goal) => { bot.gotos.push(goal); };
    bot.pathfinder.isMoving = () => false;
    return bot;
}

describe('N2: goToPlayer and followPlayer never dig toward the player', () => {
    test('goToPlayer with no way within the search range: the text, it stops, no destructive line, nothing dug', async () => {
        const bot = playerScene();
        const r = await skills.goToPlayer(bot, PLAYER, 3);
        assert.equal(r, false);
        assert.ok(bot.output.includes(NO_WAY), bot.output);
        assert.ok(!bot.output.includes(DESTRUCTIVE), bot.output);
        assert.ok(!/destructive/i.test(bot.output), bot.output);
        assert.equal(bot.calls.filter((c) => c[0] === 'dig').length, 0);
        assert.ok(bot.digSettings.every((d) => d === false), `no movements with digging: ${bot.digSettings}`);
    });

    test('goToPlayer: a walk that fails on the way says the text, never the destructive fallback', async () => {
        const bot = playerScene({ status: 'timeout' });
        bot.pathfinder.goto = async () => {
            const err = new Error('No path to the goal!');
            err.name = 'NoPath';
            throw err;
        };
        let r;
        try {
            r = await skills.goToPlayer(bot, PLAYER, 3);
        } catch (err) {
            r = err;
        }
        assert.ok(!/destructive/i.test(bot.output), bot.output);
        assert.ok(bot.output.includes(NO_WAY), bot.output);
        assert.equal(r, false);
        assert.ok(bot.digSettings.every((d) => d === false), `no movements with digging: ${bot.digSettings}`);
    });

    test('followPlayer with no way: the text, it stops, no destructive line', async () => {
        const bot = playerScene();
        const r = await skills.followPlayer(bot, PLAYER, 4);
        assert.equal(r, false);
        assert.ok(bot.output.includes(NO_WAY), bot.output);
        assert.ok(!/destructive/i.test(bot.output), bot.output);
        assert.equal(bot.calls.filter((c) => c[0] === 'dig').length, 0);
    });

    test('the signatures of goToPlayer and followPlayer are kept (rule 16)', () => {
        assert.match(String(skills.goToPlayer).split('{')[0], /\(\s*bot\s*,\s*username\s*,\s*distance\s*=\s*3\s*\)/);
        assert.match(String(skills.followPlayer).split('{')[0], /\(\s*bot\s*,\s*username\s*,\s*distance\s*=\s*4\s*\)/);
    });

    test('other walks keep the destructive fallback', () => {
        const source = fs.readFileSync(repoPath('src/agent/library/skills.js'), 'utf8');
        assert.ok(source.includes(DESTRUCTIVE), 'the fallback line is still in skills.js for the other walks');
    });

    test('goToPlayer: a walk that enters a cave stops once and says it', async () => {
        const world = makeWorld();
        world.fill(-1, 40, -1, 1, 42, 1, 'air'); // a cave 3 x 3 x 3 under rock
        const bot = playerScene({ world, pos: [0.5, 64, 0.5], player: [10.5, 64, 0.5], status: 'success' });
        bot.pathfinder.goto = async (goal) => {
            bot.gotos.push(goal);
            bot.entity.position = v(0.5, 40, 0.5);
            await new Promise((resolve) => setTimeout(resolve, 1200));
        };
        const r = await skills.goToPlayer(bot, PLAYER, 3);
        assert.equal(r, false);
        assert.ok(bot.output.includes('I stopped at (0, 40, 0): ahead is a cave. Tell me to go on if you want.'), bot.output);
        assert.equal(bot.output.split('ahead is a cave').length - 1, 1, 'once');
    });
});
