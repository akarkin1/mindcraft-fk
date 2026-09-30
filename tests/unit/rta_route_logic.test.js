// Spec v0.1.4.9, part A (engineer E1): the legs of a way from the steps of the trail, where a way starts,
// the way back, the cells of a leg and the choice of a route (I2, A2, A4). Pure, plain objects. The trails
// follow the base of the world tests: the house floor at y 60 (feet 61), an oak trapdoor at (2, 60, -2) over
// a column of ladders facing south from y 59 down to the room at y 41.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const R = await loadSrc('src/agent/packs/routes/route_logic.js');

const T = { kind: 'trapdoor', name: 'oak_trapdoor', x: 2, y: 60, z: -2 };
const st = (x, y, z, extra = {}) => ({ x, y, z, on: 'stone', at: 'air', sky: false, t: 0, via: null, ...extra });
const ladder = (y, extra = {}) => st(2, y, -2, { at: 'ladder', ...extra });
const column = (from, to) => {
    const out = [];
    const d = from <= to ? 1 : -1;
    for (let y = from; y !== to + d; y += d) out.push(ladder(y, y === 59 ? { via: T } : {}));
    return out;
};
const faceSouth = (x, y, z) => (x === 2 && z === -2 && y >= 41 && y <= 59 ? 'south' : null);

// W62: from the place "storage" in the room up the ladder, through the trapdoor, to the bed
const UP = [st(2, 41, 1), st(2, 41, 0), st(2, 41, -1), ...column(41, 59), st(2, 61, -3), st(1, 61, -2), st(0, 61, -1), st(-1, 61, 0),
    st(-2, 61, 1), st(-3, 61, 2)];
// W65: from the floor of the house down: to the hole from the west, a fall onto the ladder, to the room
const DOWN = [st(0, 61, 0), st(1, 61, -1), st(1, 61, -2), ...column(59, 41), st(2, 41, -1), st(3, 41, 0)];

describe('routeFromSteps', () => {
    test('up a ladder run with a trapdoor: walk, ladder, trapdoor, walk', () => {
        const r = R.routeFromSteps(UP, { faceAt: faceSouth });
        assert.deepEqual(r.from, { x: 2, y: 41, z: 1 });
        assert.deepEqual(r.to, { x: -3, y: 61, z: 2 });
        assert.deepEqual(r.legs, [
            { kind: 'walk', from: { x: 2, y: 41, z: 1 }, to: { x: 2, y: 41, z: -2 } },
            { kind: 'ladder', x: 2, z: -2, top: 59, bottom: 41, face: 'south', entry: { x: 2, y: 61, z: -3 } },
            { kind: 'door', kind2: 'trapdoor', name: 'oak_trapdoor', x: 2, y: 60, z: -2, from: { x: 2, y: 59, z: -2 }, to: { x: 2, y: 61, z: -3 } },
            { kind: 'walk', from: { x: 2, y: 61, z: -3 }, to: { x: -3, y: 61, z: 2 } },
        ]);
        assert.deepEqual(R.legCounts(r.legs), { legs: 4, ladder: 1, door: 0, gate: 0, trapdoor: 1 });
    });

    test('down a ladder run with a trapdoor: the trapdoor before the ladder, the entry where the bot stepped in', () => {
        const r = R.routeFromSteps(DOWN, { faceAt: faceSouth });
        assert.deepEqual(r.legs, [
            { kind: 'walk', from: { x: 0, y: 61, z: 0 }, to: { x: 1, y: 61, z: -2 } },
            { kind: 'door', kind2: 'trapdoor', name: 'oak_trapdoor', x: 2, y: 60, z: -2, from: { x: 1, y: 61, z: -2 }, to: { x: 2, y: 59, z: -2 } },
            { kind: 'ladder', x: 2, z: -2, top: 59, bottom: 41, face: 'south', entry: { x: 1, y: 61, z: -2 } },
            { kind: 'walk', from: { x: 2, y: 41, z: -2 }, to: { x: 3, y: 41, z: 0 } },
        ]);
    });

    test('the face of a ladder without the world: from the step on top of the wall, else the step at the foot', () => {
        assert.equal(R.routeFromSteps(UP).legs[1].face, 'south', 'the bot climbed out onto the wall at the north');
        assert.equal(R.routeFromSteps(DOWN).legs[2].face, 'east', 'stepped in from the west: the steps alone cannot know better');
        const foot = [ladder(50), ladder(49), ladder(48), st(2, 48, -1)];
        assert.equal(R.routeFromSteps(foot).legs[0].face, 'south', 'left the ladder to the south at the foot');
    });

    test('a column that ends above the floor: the floor under it is the bottom', () => {
        const steps = [st(3, 61, -2), ladder(59), ladder(58), ladder(57), st(2, 54, -2), st(2, 54, -1)];
        const leg = R.routeFromSteps(steps).legs.find(l => l.kind === 'ladder');
        assert.deepEqual({ top: leg.top, bottom: leg.bottom, entry: leg.entry }, { top: 59, bottom: 54, entry: { x: 3, y: 61, z: -2 } });
        const up = R.routeFromSteps(steps.slice().reverse()).legs.find(l => l.kind === 'ladder');
        assert.deepEqual({ top: up.top, bottom: up.bottom }, { top: 59, bottom: 54 });
    });

    test('a door of the house: from the step before it to the step behind it', () => {
        const door = { kind: 'door', name: 'oak_door', x: 0, y: 61, z: -5 };
        const steps = [st(0, 61, -7), st(0, 61, -6), st(0, 61, -5, { via: door }), st(0, 61, -4, { via: door }), st(0, 61, -3)];
        assert.deepEqual(R.routeFromSteps(steps).legs, [
            { kind: 'walk', from: { x: 0, y: 61, z: -7 }, to: { x: 0, y: 61, z: -6 } },
            { kind: 'door', kind2: 'door', name: 'oak_door', x: 0, y: 61, z: -5, from: { x: 0, y: 61, z: -6 }, to: { x: 0, y: 61, z: -4 } },
            { kind: 'walk', from: { x: 0, y: 61, z: -4 }, to: { x: 0, y: 61, z: -3 } },
        ]);
    });

    test('a gate passed between two steps; a trapdoor walked over is no passage', () => {
        const gate = { kind: 'gate', name: 'oak_fence_gate', x: 5, y: 61, z: 0 };
        const legs = R.routeFromSteps([st(3, 61, 0), st(4, 61, 0), st(6, 61, 0, { via: gate }), st(7, 61, 0)]).legs;
        assert.deepEqual(legs.map(l => l.kind), ['walk', 'door', 'walk']);
        assert.deepEqual({ kind2: legs[1].kind2, from: legs[1].from, to: legs[1].to }, { kind2: 'gate', from: { x: 4, y: 61, z: 0 }, to: { x: 6, y: 61, z: 0 } });
        const over = [st(0, 61, -2), st(1, 61, -2), st(2, 61, -2, { via: T }), st(3, 61, -2, { via: T }), st(4, 61, -2)];
        assert.deepEqual(R.routeFromSteps(over).legs.map(l => l.kind), ['walk']);
    });

    test('walk legs are at most 12 blocks from their start', () => {
        const line = [];
        for (let x = 0; x < 30; x++) line.push(st(x, 64, 0));
        const legs = R.routeFromSteps(line).legs;
        assert.deepEqual(legs.map(l => [l.from.x, l.to.x]), [[0, 12], [12, 24], [24, 29]]);
        const hop = R.routeFromSteps(line, { maxHop: 5 }).legs;
        assert.ok(hop.every(l => Math.abs(l.to.x - l.from.x) <= 5), JSON.stringify(hop));
    });

    test('a way that turns back within 12 blocks still gets a leg per 24 blocks of trail', () => {
        const u = [];
        for (let x = 0; x <= 10; x++) u.push(st(x, 64, 0));
        for (let z = 1; z <= 5; z++) u.push(st(10, 64, z));
        for (let x = 9; x >= 0; x--) u.push(st(x, 64, 5));
        const legs = R.routeFromSteps(u).legs; // 25 blocks of trail, the end 5 blocks from the start
        assert.equal(legs.length, 2, JSON.stringify(legs));
        assert.deepEqual(legs[0].to, { x: 1, y: 64, z: 5 }, 'the first leg ends after 24 blocks of trail');
        assert.deepEqual(legs[legs.length - 1].to, { x: 0, y: 64, z: 5 });
    });

    test('a ladder cell passed on the floor is no climb; a trail of one step has no legs', () => {
        const legs = R.routeFromSteps([st(2, 41, 0), st(2, 41, -1), ladder(41), st(3, 41, -2)]).legs;
        assert.deepEqual(legs.map(l => l.kind), ['walk']);
        assert.deepEqual(R.routeFromSteps([st(0, 64, 0)]).legs, []);
        assert.deepEqual(R.routeFromSteps([]), { legs: [], from: null, to: null });
        assert.deepEqual(R.routeFromSteps(null), { legs: [], from: null, to: null });
    });
});

describe('routeStart and skyStart', () => {
    const storage = { name: 'storage', kind: 'place', test: s => Math.hypot(s.x - 2, s.y - 41, s.z - 1) <= 2 };
    const home = { name: 'home', kind: 'area', test: s => s.x >= -4 && s.x <= 4 && s.z >= -5 && s.z <= 5 && s.y >= 60 && s.y <= 65 };

    test('a trail that passes two known things: the thing of the last step does not count, the first one back is the start', () => {
        const r = R.routeStart(UP, [home, storage]);
        assert.equal(r.known.name, 'storage');
        assert.equal(r.index, 2, 'the last step within 2 blocks of the place');
        assert.deepEqual([UP[r.index].x, UP[r.index].y, UP[r.index].z], [2, 41, -1]);
    });

    test('the nearer of two things passed is the start', () => {
        const a = { name: 'a', kind: 'place', test: s => s.x === 0 };
        const b = { name: 'b', kind: 'place', test: s => s.x === 5 };
        const steps = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(x => st(x, 64, 0));
        assert.deepEqual({ ...R.routeStart(steps, [a, b]), known: R.routeStart(steps, [a, b]).known.name }, { index: 5, known: 'b' });
        const atB = steps.slice(0, 6);
        assert.deepEqual({ ...R.routeStart(atB, [a, b]), known: R.routeStart(atB, [a, b]).known.name }, { index: 0, known: 'a' }, 'b is the thing of the last step');
    });

    test('no known thing: null; a thing that throws does not count', () => {
        assert.equal(R.routeStart(UP, []), null);
        assert.equal(R.routeStart([], [storage]), null);
        assert.equal(R.routeStart(UP, [{ name: 'x', kind: 'place', test: () => { throw new Error('x'); } }]), null);
        assert.equal(R.routeStart(UP, [home]), null, 'only the thing of the last step');
    });

    test('startOffLadder: a start on a ladder moves back to the foot of the column', () => {
        assert.equal(R.startOffLadder(UP, 5), 3, 'y 43 up the ladder: back to the ladder at the floor, y 41');
        assert.equal(R.startOffLadder(UP, 2), 2, 'not on a ladder');
        const floor = [st(2, 41, -1), st(2, 41, -2), ladder(42), ladder(43)];
        assert.equal(R.startOffLadder(floor, 3), 1, 'the floor under a column that ends above it');
        assert.equal(R.startOffLadder(DOWN, 10), 3, 'down: back to the top of the run');
        assert.equal(R.startOffLadder(null, 4), 4);
    });

    test('skyStart: the last step under open sky, or -1', () => {
        const steps = [st(0, 64, 0, { sky: true }), st(1, 64, 0, { sky: true }), st(2, 64, 0), st(3, 60, 0)];
        assert.equal(R.skyStart(steps), 1);
        assert.equal(R.skyStart(steps.slice(2)), -1);
        assert.equal(R.skyStart(null), -1);
    });
});

describe('knownThings', () => {
    test('a place within 2 blocks, inside an area, in the room or on the route of a mine', () => {
        const known = R.knownThings({
            places: [{ name: 'storage', x: 2.5, y: 41, z: 1.5 }],
            areas: [{ name: 'home', min: { x: -4, y: 60, z: -5 }, max: { x: 4, y: 65, z: 5 } }],
            mines: [{ name: 'mine', level: 25, room: { center: { x: 22, y: 25, z: 0 }, chest: null, table: null, furnace: null },
                route: [{ kind: 'ladder', x: 30, z: 4, top: 59, bottom: 40, face: 'north', entry: { x: 30, y: 60, z: 5 } }] },
            { name: null, level: 16, route: [] }],
        });
        assert.deepEqual(known.map(k => [k.kind, k.name]), [['place', 'storage'], ['area', 'home'], ['mine', 'mine'], ['mine', 'level 16']]);
        const [place, area, mine] = known;
        assert.equal(place.test(st(2, 41, -1)), true);
        assert.equal(place.test(st(2, 41, -2)), false);
        assert.equal(area.test(st(0, 61, 0)), true);
        assert.equal(area.test(st(0, 59, 0)), false);
        assert.equal(mine.test(st(24, 25, 2)), true, 'in the room');
        assert.equal(mine.test(st(31, 45, 4)), true, 'beside the ladder');
        assert.equal(mine.test(st(33, 45, 4)), false);
    });

    test('broken input gives no things', () => {
        assert.deepEqual(R.knownThings({ places: [{ name: 'x' }], areas: [{ name: 'y' }], mines: [null] }), []);
        assert.deepEqual(R.knownThings(), []);
    });
});

describe('reverseRoute, routeEnds, legCells', () => {
    const route = { name: 'bed', dimension: 'overworld', from: { name: 'storage', kind: 'place', x: 2, y: 41, z: -1 },
        to: { name: 'bed', x: -3, y: 61, z: 2 }, legs: R.routeFromSteps(UP.slice(2), { faceAt: faceSouth }).legs, steps: 28, source: 'trail' };

    test('the legs reversed, from and to swapped; the route itself unchanged', () => {
        const before = JSON.stringify(route);
        const back = R.reverseRoute(route);
        assert.equal(JSON.stringify(route), before);
        assert.deepEqual(back.from, route.to);
        assert.deepEqual(back.to, route.from);
        assert.deepEqual(back.legs.map(l => l.kind), ['walk', 'door', 'ladder', 'walk']);
        assert.deepEqual(back.legs[0], { kind: 'walk', from: { x: -3, y: 61, z: 2 }, to: { x: 2, y: 61, z: -3 } });
        assert.deepEqual([back.legs[1].from, back.legs[1].to], [{ x: 2, y: 61, z: -3 }, { x: 2, y: 59, z: -2 }]);
        assert.deepEqual(back.legs[2], route.legs[1], 'a ladder has no direction');
        assert.deepEqual(R.reverseRoute(back), route);
    });

    test('a staircase stays from its top to its bottom', () => {
        const stairs = { kind: 'stairs', from: { x: 0, y: 60, z: 0 }, to: { x: 0, y: 55, z: 5 }, dir: 'south' };
        assert.deepEqual(R.reverseRoute({ legs: [stairs] }).legs[0], stairs);
    });

    test('routeEnds: from and to of the route, or of the legs of a mine', () => {
        assert.deepEqual(R.routeEnds(route), { from: { x: 2, y: 41, z: -1 }, to: { x: -3, y: 61, z: 2 } });
        const mine = { legs: [{ kind: 'ladder', x: 9, z: 58, top: 66, bottom: 25, face: 'west', entry: { x: 10, y: 67, z: 58 } },
            { kind: 'walk', from: { x: 9, y: 25, z: 58 }, to: { x: 9, y: 25, z: 50 } }] };
        assert.deepEqual(R.routeEnds(mine), { from: { x: 10, y: 67, z: 58 }, to: { x: 9, y: 25, z: 50 } });
        assert.deepEqual(R.routeEnds({ legs: [] }), { from: null, to: null });
    });

    test('legCells: the column of a ladder from its top, the line of a walk, the steps of a staircase, a door', () => {
        const cells = R.legCells({ kind: 'ladder', x: 2, z: -2, top: 44, bottom: 41, face: 'south', entry: null });
        assert.deepEqual(cells.map(c => c.y), [44, 43, 42, 41]);
        assert.deepEqual(R.legCells({ kind: 'walk', from: { x: 0, y: 64, z: 0 }, to: { x: 3, y: 64, z: 0 } }).map(c => c.x), [0, 1, 2, 3]);
        assert.deepEqual(R.legCells({ kind: 'stairs', from: { x: 0, y: 60, z: 0 }, to: { x: 0, y: 58, z: 2 }, dir: 'south' }),
            [{ x: 0, y: 60, z: 0 }, { x: 0, y: 59, z: 1 }, { x: 0, y: 58, z: 2 }]);
        assert.deepEqual(R.legCells({ kind: 'door', kind2: 'door', x: 0, y: 61, z: -5, from: { x: 0, y: 61, z: -6 }, to: { x: 0, y: 61, z: -4 } }).map(c => c.z), [-6, -5, -4]);
        assert.deepEqual(R.legCells({ kind: 'teleport' }), []);
    });
});

describe('nearestRoute (A4)', () => {
    const bed = { name: 'bed', from: { x: 2, y: 41, z: -1 }, to: { x: -3, y: 61, z: 2 }, legs: [{ kind: 'walk', from: { x: 2, y: 41, z: -1 }, to: { x: -3, y: 61, z: 2 } }] };
    const far = { name: 'far', from: { x: 2, y: 41, z: 20 }, to: { x: -3, y: 61, z: 3 }, legs: [{ kind: 'walk', from: { x: 0, y: 0, z: 0 }, to: { x: 1, y: 0, z: 0 } }] };

    test('to the bed from the room: forward; to the room from the bed: reverse', () => {
        const a = R.nearestRoute([bed], { x: -3, y: 61, z: 3 }, { x: 2.5, y: 41, z: 0.5 });
        assert.equal(a.route.name, 'bed');
        assert.equal(a.reverse, false);
        assert.ok(Math.abs(a.distance - Math.hypot(0.5, 0, 1.5)) < 1e-9);
        const b = R.nearestRoute([bed], { x: 2, y: 41, z: 1 }, { x: -3.5, y: 61, z: 2.5 });
        assert.equal(b.reverse, true);
    });

    test('an end beyond the range of the target, or a start beyond the reach of the bot: no route', () => {
        assert.equal(R.nearestRoute([bed], { x: -3, y: 61, z: 8 }, { x: 2, y: 41, z: 0 }), null, '6 from the target');
        assert.ok(R.nearestRoute([bed], { x: -3, y: 61, z: 8 }, { x: 2, y: 41, z: 0 }, { range: 6 }));
        assert.equal(R.nearestRoute([bed], { x: -3, y: 61, z: 3 }, { x: 40, y: 41, z: 0 }), null, '38 from the start');
        assert.ok(R.nearestRoute([bed], { x: -3, y: 61, z: 3 }, { x: 40, y: 41, z: 0 }, { reach: 40 }));
    });

    test('the route whose start is nearest to the bot wins; a box as the target', () => {
        assert.equal(R.nearestRoute([far, bed], { x: -3, y: 61, z: 3 }, { x: 2, y: 41, z: 0 }).route.name, 'bed');
        assert.equal(R.nearestRoute([bed, far], { x: -3, y: 61, z: 3 }, { x: 2, y: 41, z: 19 }).route.name, 'far');
        const house = { min: { x: -4, y: 60, z: -5 }, max: { x: 4, y: 65, z: 5 } };
        assert.equal(R.nearestRoute([bed], house, { x: 2, y: 41, z: 0 }).reverse, false);
        assert.equal(R.nearestRoute([], house, { x: 2, y: 41, z: 0 }), null);
        assert.equal(R.nearestRoute([bed], null, { x: 2, y: 41, z: 0 }), null);
    });
});

describe('helpers', () => {
    test('names like areas: trimmed, lower case, spaces to _', () => {
        assert.equal(R.normalizeRouteName('  My Bed  '), 'my_bed');
        assert.equal(R.normalizeRouteName(3), null);
    });

    test('nearCell: the feet within 1 block of a cell', () => {
        assert.equal(R.nearCell({ x: 3.5, y: 64, z: 1.5 }, { x: 2, y: 64, z: 0 }), true);
        assert.equal(R.nearCell({ x: 4.5, y: 64, z: 1.5 }, { x: 2, y: 64, z: 0 }), false);
        assert.equal(R.nearCell({ x: 2.5, y: 65.99, z: 0.5 }, { x: 2, y: 64, z: 0 }), false);
    });

    test('trapdoorOverLadder', () => {
        const lad = { kind: 'ladder', x: 2, z: -2, top: 59, bottom: 41 };
        const door = { kind: 'door', kind2: 'trapdoor', x: 2, y: 60, z: -2 };
        assert.equal(R.trapdoorOverLadder(door, lad), true);
        assert.equal(R.trapdoorOverLadder({ ...door, y: 62 }, lad), false);
        assert.equal(R.trapdoorOverLadder({ ...door, kind2: 'door' }, lad), false);
        assert.equal(R.trapdoorOverLadder(door, undefined), false);
    });

    test('cleanLeg keeps the four kinds and nothing else', () => {
        assert.deepEqual(R.cleanLeg({ kind: 'ladder', x: 2.2, z: -2, top: 59, bottom: 41, face: 'up', entry: null }),
            { kind: 'ladder', x: 2, z: -2, top: 59, bottom: 41, face: 'north', entry: null });
        assert.deepEqual(R.cleanLeg({ kind: 'door', kind2: 'gate', x: 1, y: 2, z: 3, from: { x: 0, y: 2, z: 3 }, to: { x: 2, y: 2, z: 3 } }).name, null);
        assert.equal(R.cleanLeg({ kind: 'door', kind2: 'window', x: 1, y: 2, z: 3, from: { x: 0, y: 2, z: 3 }, to: { x: 2, y: 2, z: 3 } }), null);
        assert.equal(R.cleanLeg({ kind: 'walk', from: { x: 0, y: 0, z: 0 } }), null);
        assert.equal(R.cleanLeg({ kind: 'stairs', from: { x: 0, y: 3, z: 0 }, to: { x: 0, y: 0, z: 3 } }).dir, 'north');
    });
});
