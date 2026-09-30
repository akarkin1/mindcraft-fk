// T1, spec v0.1.4.9 sections I2, A2 (routeStart), A4 (nearestRoute) and the handoff of part A: the pure
// functions of src/agent/packs/routes/route_logic.js, tested from the spec. The steps are those of I1:
// { x, y, z, on, at, sky, t, via }. The trail of the base of the world tests: a storage room at y 41, a
// ladder column at (2, 41..59, -2) whose ladders face south, a trapdoor at (2, 60, -2), the grass at y 60.
// Handoff: the `face` of a ladder leg is the ladder's own `facing` (routeFromSteps reads it with `faceAt`).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const R = await loadSrc('src/agent/packs/routes/route_logic.js');

const T = Object.freeze({ kind: 'trapdoor', name: 'oak_trapdoor', x: 2, y: 60, z: -2 });
const st = (x, y, z, extra = {}) => ({ x, y, z, on: 'stone', at: 'air', sky: false, t: 0, via: null, ...extra });
const cell = (p) => ({ x: p.x, y: p.y, z: p.z });
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
const isCell = (p) => !!p && [p.x, p.y, p.z].every(Number.isFinite);
const faceAt = (x, y, z) => (x === 2 && z === -2 && y >= 41 && y <= 59 ? 'south' : null);

// From the storage room (feet y 41) north to the ladder, up the ladder, through the trapdoor, then 20
// blocks west on the grass (feet y 61) under the open sky.
function shaftTrail() {
    const steps = [st(2, 41, 3), st(2, 41, 2), st(2, 41, 1), st(2, 41, 0), st(2, 41, -1)];
    for (let y = 41; y <= 59; y++) steps.push(st(2, y, -2, { at: 'ladder', on: y === 41 ? 'stone' : 'air', via: y === 59 ? { ...T } : null }));
    steps.push(st(2, 60, -2, { at: 'oak_trapdoor', on: 'air', via: { ...T } }));
    for (let x = 2; x >= -18; x--) steps.push(st(x, 61, -3, { on: 'grass_block', sky: true }));
    return steps;
}

// 11 blocks east at y 64 through an oak door at (5, 64, 0).
const DOOR = Object.freeze({ kind: 'door', name: 'oak_door', x: 5, y: 64, z: 0 });
function doorTrail(via = DOOR, at = 'oak_door') {
    const steps = [];
    for (let x = 0; x <= 10; x++) steps.push(st(x, 64, 0, x === via.x ? { at, via: { ...via } } : { on: 'grass_block' }));
    return steps;
}

const kindsOf = (legs) => legs.map((l) => l.kind);

// ------------------------------------------------------------------------------------ routeFromSteps

describe('I2: routeFromSteps', () => {
    test('a ladder run and a trapdoor: walk legs, one ladder leg, one trapdoor door leg, in the order walked', () => {
        const steps = shaftTrail();
        const r = R.routeFromSteps(steps, { faceAt });
        assert.ok(Array.isArray(r.legs), 'legs');
        assert.deepEqual(kindsOf(r.legs).filter((k) => k !== 'walk'), ['ladder', 'door'], JSON.stringify(kindsOf(r.legs)));
        assert.equal(r.legs[0].kind, 'walk', 'the way through the room comes first');
        assert.equal(r.legs.at(-1).kind, 'walk', 'the way on the grass comes last');
        assert.deepEqual(cell(r.from), cell(steps[0]), 'from: the first step');
        assert.deepEqual(cell(r.to), cell(steps.at(-1)), 'to: the last step');
    });

    test('the ladder leg: x, z of the column, bottom at the foot, top at the top of the run, face the facing of the ladders, an entry cell', () => {
        const ladder = R.routeFromSteps(shaftTrail(), { faceAt }).legs.find((l) => l.kind === 'ladder');
        assert.equal(ladder.x, 2);
        assert.equal(ladder.z, -2);
        assert.equal(ladder.bottom, 41);
        assert.ok(ladder.top >= 59 && ladder.top <= 61, `top ${ladder.top}`);
        assert.equal(ladder.face, 'south', 'handoff: the face of a ladder leg is the ladder block\'s own facing');
        assert.ok(isCell(ladder.entry), `entry ${JSON.stringify(ladder.entry)}`);
    });

    test('the trapdoor door leg: kind2 trapdoor, the name and cell of the trapdoor, from below it to above it', () => {
        // FINDING T1-1 (I2, low): with a step of the trail in the cell of the open trapdoor (y 60, as a trail read
        // every 250 ms on a climb records it), the door leg goes from (2, 59, -2) to (2, 60, -2): its `to` is the
        // trapdoor's own cell, not a cell past it ("pass from `from` to `to`"). The fake bot of the mining pack
        // walks such a route up and down (rt_routes_pack.test.js); whether the real server does is for W62/W63.
        const doors = R.routeFromSteps(shaftTrail(), { faceAt }).legs.filter((l) => l.kind === 'door');
        assert.equal(doors.length, 1, 'one trapdoor, one door leg');
        const d = doors[0];
        assert.deepEqual({ kind2: d.kind2, name: d.name, x: d.x, y: d.y, z: d.z }, { kind2: 'trapdoor', name: 'oak_trapdoor', x: 2, y: 60, z: -2 });
        assert.ok(isCell(d.from) && isCell(d.to));
        assert.ok(d.from.y < 60 && d.to.y > 60, `from ${JSON.stringify(d.from)} to ${JSON.stringify(d.to)}`);
    });

    // A trail recorded going DOWN (the way into a mine, B2, is always recorded so): 4 steps on the grass to the
    // trapdoor at (2, 60, -2), then down the ladders at (2, 59..41, -2) into the room.
    function downTrail({ over = false, cell60 = true } = {}) {
        const steps = [];
        for (const z of [2, 1, 0, -1]) steps.push(st(2, 61, z, { on: 'grass_block', sky: true }));
        if (over) steps.push(st(2, 61, -2, { on: 'oak_trapdoor', sky: true, via: { ...T } }));
        if (cell60) steps.push(st(2, 60, -2, { at: 'oak_trapdoor', on: 'ladder', via: { ...T } }));
        for (let y = 59; y >= 41; y--) steps.push(st(2, y, -2, { at: 'ladder', via: y === 59 ? { ...T } : null }));
        for (const z of [-1, 0, 1]) steps.push(st(2, 41, z));
        return steps;
    }
    const doorBeforeLadder = (legs) => legs.findIndex((l) => l.kind === 'door') < legs.findIndex((l) => l.kind === 'ladder');

    test('a trail recorded going down through a trapdoor: the trapdoor leg comes before the ladder leg (the order walked)', () => {
        // FINDING T1-5 (I2, high): recorded going down with a step in the cell of the trapdoor (or over it), the
        // ladder leg comes first and the trapdoor leg after it: [walk, ladder, door, walk]. walkRoute slides down
        // the ladder, then must go back up to the trapdoor and fails ("at step 3 of 4", at the foot of the ladder).
        // Only a trail that jumps from the grass straight onto the ladder at y 59 gives the right order. A way
        // recorded going up (W62) is fine both ways; the way into a mine (B2) is always recorded going down.
        for (const options of [{}, { over: true }, { over: true, cell60: false }]) {
            const { legs } = R.routeFromSteps(downTrail(options), { faceAt });
            assert.ok(doorBeforeLadder(legs), `${JSON.stringify(options)}: ${JSON.stringify(legs.map((l) => l.kind))}`);
        }
    });

    test('a trail going down straight from the grass onto the ladder: the trapdoor leg first', () => {
        const { legs } = R.routeFromSteps(downTrail({ cell60: false }), { faceAt });
        assert.ok(doorBeforeLadder(legs), JSON.stringify(legs.map((l) => l.kind)));
    });

    test('the entry of a ladder leg is a cell where the bot can stand at the top, not inside the ground', () => {
        // FINDING T1-4 (I2, medium): when the route starts in the column above the ladder (B2 slices the trail at
        // the last step under the sky, and that is the step on the closed trapdoor), no step beside the column is
        // found and the entry falls back to (x, top + 1, the wall side) = (2, 60, -3): inside the grass. The mining
        // pack's own ladder legs have the entry at top + 2 ((2, 61, -3) in rta_replay). walkRoute then fails at the
        // ladder leg (rt_mine_player, "W67 as recorded on the trapdoor").
        const steps = downTrail({ over: true }).slice(4); // the route of B2: from the last step under the sky
        const ladder = R.routeFromSteps(steps, { faceAt }).legs.find((l) => l.kind === 'ladder');
        assert.ok(ladder.entry.y >= 61, `entry ${JSON.stringify(ladder.entry)}, the grass is at y 60`);
    });

    test('the walk legs: each at most 12 blocks apart (maxHop), chained, from the first step to the last', () => {
        const steps = [];
        for (let x = 0; x <= 30; x++) steps.push(st(x, 64, 0, { on: 'grass_block', sky: true }));
        const { legs } = R.routeFromSteps(steps);
        assert.ok(legs.length >= 3, `${legs.length} legs for 30 blocks`);
        for (const leg of legs) {
            assert.equal(leg.kind, 'walk');
            assert.ok(isCell(leg.from) && isCell(leg.to));
            assert.ok(cheb(leg.from, leg.to) <= 12, JSON.stringify(leg));
        }
        for (let i = 1; i < legs.length; i++) assert.deepEqual(cell(legs[i].from), cell(legs[i - 1].to), `leg ${i} starts where leg ${i - 1} ends`);
        assert.deepEqual(cell(legs[0].from), { x: 0, y: 64, z: 0 });
        assert.deepEqual(cell(legs.at(-1).to), { x: 30, y: 64, z: 0 });
    });

    test('the option maxHop: walk legs at most maxHop apart', () => {
        const steps = [];
        for (let x = 0; x <= 20; x++) steps.push(st(x, 64, 0));
        const { legs } = R.routeFromSteps(steps, { maxHop: 5 });
        assert.ok(legs.length >= 4, `${legs.length} legs`);
        for (const leg of legs) assert.ok(cheb(leg.from, leg.to) <= 5, JSON.stringify(leg));
    });

    test('a door: a door leg with kind2 door, the name and the cell of the door, from one side to the other', () => {
        const { legs } = R.routeFromSteps(doorTrail());
        const doors = legs.filter((l) => l.kind === 'door');
        assert.equal(doors.length, 1, JSON.stringify(legs));
        const d = doors[0];
        assert.deepEqual({ kind2: d.kind2, name: d.name, x: d.x, y: d.y, z: d.z }, { kind2: 'door', name: 'oak_door', x: 5, y: 64, z: 0 });
        assert.ok(d.from.x < 5 && d.to.x > 5, `from ${JSON.stringify(d.from)} to ${JSON.stringify(d.to)}`);
    });

    test('a fence gate: a door leg with kind2 gate', () => {
        const gate = { kind: 'gate', name: 'oak_fence_gate', x: 5, y: 64, z: 0 };
        const doors = R.routeFromSteps(doorTrail(gate, 'oak_fence_gate')).legs.filter((l) => l.kind === 'door');
        assert.equal(doors.length, 1);
        assert.equal(doors[0].kind2, 'gate');
        assert.equal(doors[0].name, 'oak_fence_gate');
    });

    test('the fields of every leg kind (the table of I2)', () => {
        const legs = [...R.routeFromSteps(shaftTrail(), { faceAt }).legs, ...R.routeFromSteps(doorTrail()).legs];
        for (const leg of legs) {
            if (leg.kind === 'walk') assert.ok(isCell(leg.from) && isCell(leg.to), JSON.stringify(leg));
            else if (leg.kind === 'ladder') {
                for (const k of ['x', 'z', 'top', 'bottom']) assert.ok(Number.isFinite(leg[k]), `${k}: ${JSON.stringify(leg)}`);
                assert.ok(['north', 'east', 'south', 'west'].includes(leg.face), JSON.stringify(leg));
                assert.ok(isCell(leg.entry), JSON.stringify(leg));
            } else if (leg.kind === 'door') {
                assert.ok(['door', 'gate', 'trapdoor'].includes(leg.kind2), JSON.stringify(leg));
                assert.equal(typeof leg.name, 'string');
                assert.ok(isCell(leg) && isCell(leg.from) && isCell(leg.to), JSON.stringify(leg));
            } else assert.fail(`a leg of the kind ${leg.kind} from a trail: ${JSON.stringify(leg)}`);
        }
    });

    test('stairs are made only by the mining pack: a trail down a staircase gives no stairs leg', () => {
        const steps = [];
        for (let i = 0; i <= 12; i++) steps.push(st(0, 64 - i, -i));
        const { legs } = R.routeFromSteps(steps);
        assert.ok(legs.length > 0);
        assert.ok(legs.every((l) => l.kind !== 'stairs'), JSON.stringify(kindsOf(legs)));
    });

    test('pure: the steps are not changed', () => {
        const steps = shaftTrail();
        const copy = JSON.parse(JSON.stringify(steps));
        R.routeFromSteps(steps, { faceAt });
        assert.deepEqual(steps, copy);
    });
});

// ------------------------------------------------------------------------------------ routeStart

describe('A2: routeStart, a trail that passes two known things', () => {
    const STORAGE = { x: 2, y: 41, z: 10 };
    const HOME = { min: { x: -5, y: 60, z: -5 }, max: { x: 5, y: 66, z: 5 } };
    const inBox = (s, b) => s.x >= b.min.x && s.x <= b.max.x && s.y >= b.min.y && s.y <= b.max.y && s.z >= b.min.z && s.z <= b.max.z;
    const known = [
        { name: 'storage', kind: 'place', test: (s) => Math.hypot(s.x - STORAGE.x, s.y - STORAGE.y, s.z - STORAGE.z) <= 2 },
        { name: 'home', kind: 'area', test: (s) => inBox(s, HOME) },
    ];
    const nameOf = (r) => r?.known?.name ?? r?.known;

    // 0..2 at the storage, 3..9 between, 10..12 inside home, 13..20 outside both
    function passBoth() {
        const steps = [st(2, 41, 11), st(2, 41, 10), st(2, 41, 9)];
        for (let x = 14; x <= 20; x++) steps.push(st(x, 50, 20));
        steps.push(st(0, 61, 0), st(1, 61, 0), st(2, 61, 0));
        for (let x = 6; x <= 13; x++) steps.push(st(x, 61, 0));
        return steps;
    }

    test('the trail ends outside both: the last step at a known thing is the start (the area "home")', () => {
        const steps = passBoth();
        assert.equal(steps.length, 21);
        const r = R.routeStart(steps, known);
        assert.equal(r?.index, 12, JSON.stringify(r));
        assert.equal(nameOf(r), 'home');
    });

    test('the trail ends inside home: the thing of the last step does not count, the start is at the storage', () => {
        const steps = passBoth().slice(0, 13); // ends at (2, 61, 0), inside home
        const r = R.routeStart(steps, known);
        assert.equal(r?.index, 2, JSON.stringify(r));
        assert.equal(nameOf(r), 'storage');
    });

    test('no known thing on the trail: null', () => {
        assert.equal(R.routeStart([st(100, 64, 100), st(101, 64, 100), st(102, 64, 100)], known), null);
    });

    test('only the known thing of the last step: null', () => {
        assert.equal(R.routeStart([st(20, 64, 20), st(1, 61, 1), st(2, 61, 1)], known), null);
    });

    test('an empty trail or no known things: null', () => {
        assert.equal(R.routeStart([], known), null);
        assert.equal(R.routeStart(passBoth(), []), null);
    });
});

// ------------------------------------------------------------------------------------ skyStart

describe('I2, B2: skyStart', () => {
    const sky = (flags) => flags.map((f, i) => st(i, 60, 0, { sky: f }));

    test('the index of the last step with sky true', () => {
        assert.equal(R.skyStart(sky([true, true, false, false, true, false, false])), 4);
        assert.equal(R.skyStart(sky([false, true, true])), 2);
        assert.equal(R.skyStart(sky([true, false])), 0);
    });

    test('no step under the open sky, or no steps: -1', () => {
        assert.equal(R.skyStart(sky([false, false, false])), -1);
        assert.equal(R.skyStart([]), -1);
    });
});

// ------------------------------------------------------------------------------------ reverseRoute, routeEnds, legCells

describe('I2: reverseRoute and routeEnds', () => {
    const route = () => {
        const { legs } = R.routeFromSteps(shaftTrail(), { faceAt });
        return {
            name: 'bed', dimension: 'overworld', from: { name: 'storage', kind: 'place', x: 2, y: 41, z: 3 }, to: { name: 'bed', x: -18, y: 61, z: -3 },
            legs, steps: shaftTrail().length, source: 'trail',
        };
    };

    test('the legs in the opposite order, each walked the other way; from and to swapped', () => {
        const r = route();
        const back = R.reverseRoute(r);
        assert.deepEqual(cell(back.from), cell(r.to));
        assert.deepEqual(cell(back.to), cell(r.from));
        assert.equal(back.legs.length, r.legs.length);
        assert.deepEqual(kindsOf(back.legs), kindsOf(r.legs).reverse());
        const n = r.legs.length;
        r.legs.forEach((leg, i) => {
            const other = back.legs[n - 1 - i];
            if (leg.kind === 'walk' || leg.kind === 'door') {
                assert.deepEqual(cell(other.from), cell(leg.to), `leg ${i}: ${JSON.stringify(other)}`);
                assert.deepEqual(cell(other.to), cell(leg.from), `leg ${i}: ${JSON.stringify(other)}`);
            }
            if (leg.kind === 'door') assert.deepEqual({ kind2: other.kind2, name: other.name, ...cell(other) }, { kind2: leg.kind2, name: leg.name, ...cell(leg) });
            if (leg.kind === 'ladder') {
                for (const k of ['x', 'z', 'top', 'bottom', 'face']) assert.equal(other[k], leg[k], k);
            }
        });
    });

    test('pure; twice reversed gives the legs and the ends of the route', () => {
        const r = route();
        const copy = JSON.parse(JSON.stringify(r));
        const twice = R.reverseRoute(R.reverseRoute(r));
        assert.deepEqual(r, copy, 'the route is not changed');
        assert.deepEqual(twice.legs, r.legs);
        assert.deepEqual(cell(twice.from), cell(r.from));
        assert.deepEqual(cell(twice.to), cell(r.to));
    });

    test('routeEnds: the start and the end; reversed, swapped', () => {
        const r = route();
        const ends = R.routeEnds(r);
        assert.deepEqual(cell(ends.from), { x: 2, y: 41, z: 3 });
        assert.deepEqual(cell(ends.to), { x: -18, y: 61, z: -3 });
        const back = R.routeEnds(R.reverseRoute(r));
        assert.deepEqual(cell(back.from), { x: -18, y: 61, z: -3 });
        assert.deepEqual(cell(back.to), { x: 2, y: 41, z: 3 });
    });
});

describe('I2: legCells', () => {
    const has = (cells, x, y, z) => cells.some((c) => c.x === x && c.y === y && c.z === z);

    test('a walk leg: the straight line of cells from `from` to `to`', () => {
        const cells = R.legCells({ kind: 'walk', from: { x: 0, y: 64, z: 0 }, to: { x: 4, y: 64, z: 0 } });
        for (let x = 0; x <= 4; x++) assert.ok(has(cells, x, 64, 0), `(${x}, 64, 0)`);
        assert.ok(!has(cells, 2, 64, 3), 'not beside the line');
    });

    test('a ladder leg: the column from the top to the bottom', () => {
        const cells = R.legCells({ kind: 'ladder', x: 2, z: -2, top: 59, bottom: 41, face: 'south', entry: { x: 2, y: 61, z: -3 } });
        for (let y = 41; y <= 59; y++) assert.ok(has(cells, 2, y, -2), `(2, ${y}, -2)`);
        assert.ok(!has(cells, 2, 30, -2), 'not below the bottom');
    });

    test('a door leg: from, to and the openable', () => {
        const cells = R.legCells({ kind: 'door', kind2: 'door', name: 'oak_door', x: 5, y: 64, z: 0, from: { x: 4, y: 64, z: 0 }, to: { x: 6, y: 64, z: 0 } });
        for (const x of [4, 5, 6]) assert.ok(has(cells, x, 64, 0), `(${x}, 64, 0)`);
    });
});

// ------------------------------------------------------------------------------------ nearestRoute

describe('A4: nearestRoute(routes, target, botPos, { range = 4, reach = 32 })', () => {
    const P = (x, y = 64, z = 0) => ({ x, y, z });
    const mk = (name, from, to) => ({ name, dimension: 'overworld', from: { name: 'a', ...from }, to: { name, ...to },
        legs: [{ kind: 'walk', from, to }], steps: 2, source: 'trail' });
    const R1 = mk('r1', P(0), P(100));

    test('the end near the target, the start near the bot: the route, not reversed, the distance of the bot to the start', () => {
        const r = R.nearestRoute([R1], P(102), P(10));
        assert.equal(r?.route?.name, 'r1', JSON.stringify(r));
        assert.equal(r.reverse, false);
        assert.ok(Math.abs(r.distance - 10) < 1e-6, `distance ${r.distance}`);
    });

    test('the start near the target, the bot at the end: reverse true', () => {
        const r = R.nearestRoute([R1], P(1), P(95));
        assert.equal(r?.route?.name, 'r1');
        assert.equal(r.reverse, true);
        assert.ok(Math.abs(r.distance - 5) < 1e-6, `distance ${r.distance}`);
    });

    test('range: an end 4.5 from the target is too far by default, near enough with range 5', () => {
        assert.equal(R.nearestRoute([R1], P(104.5), P(10)), null);
        assert.equal(R.nearestRoute([R1], P(104.5), P(10), { range: 5 })?.route?.name, 'r1');
        assert.equal(R.nearestRoute([R1], P(103.5), P(10))?.route?.name, 'r1', '3.5 is within 4');
    });

    test('reach: the other end 33 from the bot is out of reach by default, within reach 40', () => {
        assert.equal(R.nearestRoute([R1], P(100), P(33)), null);
        assert.equal(R.nearestRoute([R1], P(100), P(33), { reach: 40 })?.route?.name, 'r1');
        assert.equal(R.nearestRoute([R1], P(100), P(31))?.route?.name, 'r1', '31 is within 32');
    });

    test('two routes qualify: the one whose other end is nearer to the bot wins', () => {
        const R2 = mk('r2', P(5), P(101));
        const r = R.nearestRoute([R1, R2], P(100, 64, 1), P(6));
        assert.equal(r?.route?.name, 'r2', JSON.stringify(r));
        assert.ok(Math.abs(r.distance - 1) < 1e-6);
        assert.equal(R.nearestRoute([R2, R1], P(100, 64, 1), P(6))?.route?.name, 'r2', 'the order of the list does not matter');
    });

    test('no route, or none that qualifies: null', () => {
        assert.equal(R.nearestRoute([], P(100), P(0)), null);
        assert.equal(R.nearestRoute([R1], P(50), P(0)), null, 'the target near neither end');
    });
});
