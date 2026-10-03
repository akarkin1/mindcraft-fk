// Spec v0.1.4.11, part N (engineer E4), I7: the waypoints of a route of legs (waypointsOf) for each leg kind, the
// nearest waypoint, the direction of a walk and where it joins the route (planHops), the route to a target by its
// waypoints (pickRoute), and what index.js exports. Pure; the shaft of the world tests as in rta_replay: the room at
// y 41, ladders facing south from y 41 to 59 at (2, -2), an oak trapdoor at (2, 60, -2) in the grass.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const P = await loadSrc('src/agent/packs/routes/index.js');

const kinds = list => list.map(w => [w.kind, w.x, w.y, w.z]);

const SHAFT = {
    name: 'bed', from: { name: 'storage', kind: 'place', x: 2, y: 41, z: 1 }, to: { name: 'bed', x: -3, y: 61, z: 2 },
    legs: [
        { kind: 'walk', from: { x: 2, y: 41, z: 1 }, to: { x: 2, y: 41, z: -1 } },
        { kind: 'ladder', x: 2, z: -2, top: 59, bottom: 41, face: 'south', entry: { x: 2, y: 61, z: -3 }, foot: { x: 2, y: 41, z: -1 } },
        { kind: 'door', kind2: 'trapdoor', name: 'oak_trapdoor', x: 2, y: 60, z: -2, from: { x: 2, y: 59, z: -2 }, to: { x: 2, y: 61, z: -3 } },
        { kind: 'walk', from: { x: 2, y: 61, z: -3 }, to: { x: -3, y: 61, z: 2 } },
    ],
};

describe('waypointsOf (I7)', () => {
    test('walk legs: the start, the ends of the legs, the end', () => {
        const route = { name: 'farm', legs: [
            { kind: 'walk', from: { x: 0, y: 64, z: 0 }, to: { x: 10, y: 64, z: 0 } },
            { kind: 'walk', from: { x: 10, y: 64, z: 0 }, to: { x: 10, y: 64, z: 9 } },
        ] };
        assert.deepEqual(kinds(P.waypointsOf(route)), [['start', 0, 64, 0], ['walk', 10, 64, 0], ['end', 10, 64, 9]]);
        assert.ok(P.waypointsOf(route).every(w => w.name === 'farm'), 'every waypoint names its route');
    });

    test('a stairs leg gives its two ends', () => {
        const route = { legs: [{ kind: 'stairs', from: { x: 0, y: 64, z: 0 }, to: { x: 0, y: 56, z: -8 }, dir: 'north' }] };
        assert.deepEqual(kinds(P.waypointsOf(route)), [['start', 0, 64, 0], ['end', 0, 56, -8]]);
        assert.equal(P.waypointsOf(route)[0].name, null, 'a route without a name');
    });

    for (const kind2 of ['door', 'gate', 'trapdoor']) {
        test(`a door leg of kind2 ${kind2}: its sides and the openable as kind ${kind2}`, () => {
            const route = { name: 'yard', legs: [
                { kind: 'walk', from: { x: 0, y: 64, z: 0 }, to: { x: 4, y: 64, z: 0 } },
                { kind: 'door', kind2, name: `oak_${kind2}`, x: 5, y: 64, z: 0, from: { x: 4, y: 64, z: 0 }, to: { x: 6, y: 64, z: 0 } },
                { kind: 'walk', from: { x: 6, y: 64, z: 0 }, to: { x: 9, y: 64, z: 0 } },
            ] };
            const list = P.waypointsOf(route);
            assert.deepEqual(kinds(list), [['start', 0, 64, 0], ['walk', 4, 64, 0], [kind2, 5, 64, 0], ['walk', 6, 64, 0], ['end', 9, 64, 0]]);
            assert.equal(list[2].block, `oak_${kind2}`);
            assert.equal(P.isOpenableWaypoint(list[2]), true);
            assert.equal(P.isOpenableWaypoint(list[1]), false);
        });
    }

    test('a ladder up under a trapdoor: the foot, the highest ladder, the trapdoor, the entry', () => {
        const list = P.waypointsOf(SHAFT);
        assert.deepEqual(kinds(list), [['start', 2, 41, 1], ['walk', 2, 41, -1], ['ladder_foot', 2, 41, -2], ['ladder_top', 2, 59, -2],
            ['trapdoor', 2, 60, -2], ['walk', 2, 61, -3], ['end', -3, 61, 2]]);
        assert.deepEqual(list[2].column, { x: 2, z: -2, top: 59, bottom: 41 });
        assert.deepEqual(list[3].column, { x: 2, z: -2, top: 59, bottom: 41 });
    });

    test('the same route the other way: the top before the foot', () => {
        const list = P.waypointsOf(P.reverseRoute(SHAFT));
        assert.deepEqual(kinds(list), [['start', -3, 61, 2], ['walk', 2, 61, -3], ['trapdoor', 2, 60, -2], ['ladder_top', 2, 59, -2],
            ['ladder_foot', 2, 41, -2], ['walk', 2, 41, -1], ['end', 2, 41, 1]]);
    });

    test('a ladder without a trapdoor: its entry is the top; a column of legs only (a mine) starts at the entry', () => {
        const mine = { name: 'mine', legs: [{ kind: 'ladder', x: 0, z: 0, top: 63, bottom: 40, face: 'north', entry: { x: 0, y: 64, z: 1 } },
            { kind: 'walk', from: { x: 0, y: 40, z: 0 }, to: { x: 5, y: 40, z: 0 } }] };
        assert.deepEqual(kinds(P.waypointsOf(mine)), [['start', 0, 64, 1], ['ladder_foot', 0, 40, 0], ['end', 5, 40, 0]]);
        assert.deepEqual(P.waypointsOf(mine)[0].column, { x: 0, z: 0, top: 63, bottom: 40 }, 'the start keeps the column of its ladder');
        const noEntry = { legs: [{ kind: 'ladder', x: 0, z: 0, top: 63, bottom: 40, face: 'north' }] };
        assert.deepEqual(kinds(P.waypointsOf(noEntry)), [['start', 0, 64, 0], ['ladder_foot', 0, 40, 0]]);
    });

    test('nothing for a route without legs or with broken legs', () => {
        assert.deepEqual(P.waypointsOf({ legs: [] }), []);
        assert.deepEqual(P.waypointsOf(null), []);
        assert.deepEqual(P.waypointsOf({ legs: [{ kind: 'ladder', x: 1 }] }), []);
    });
});

describe('nearestWaypoint (I7)', () => {
    const list = P.waypointsOf(SHAFT);
    test('the index of the waypoint nearest to a position', () => {
        assert.equal(P.nearestWaypoint(list, { x: 2.5, y: 41, z: 1.5 }), 0);
        assert.equal(P.nearestWaypoint(list, { x: -2.5, y: 61, z: 2.5 }), 6);
        assert.equal(P.nearestWaypoint(list, { x: 2.5, y: 57, z: -1.5 }), 3, 'high on the ladder: its top');
    });
    test('-1 without waypoints, 0 without a position', () => {
        assert.equal(P.nearestWaypoint([], { x: 0, y: 0, z: 0 }), -1);
        assert.equal(P.nearestWaypoint(list, null), 0);
    });
});

describe('planHops: the direction and where the walk joins (I7, plan 4.2)', () => {
    const list = P.waypointsOf(SHAFT);
    const goals = plan => plan.hops.map(h => list[h.goal].kind);

    test('from the room to the bed: forward, the trapdoor is passed, never a goal', () => {
        const plan = P.planHops(list, { x: 2.5, y: 41, z: 1.5 }, { x: -3, y: 61, z: 2 });
        assert.equal(plan.forward, true);
        assert.deepEqual(goals(plan), ['walk', 'ladder_foot', 'ladder_top', 'walk', 'end']);
        assert.deepEqual(plan.hops[3].passes, [4], 'the hop through the trapdoor passes it');
    });

    test('from the bed to the room: the end nearer to the goal is the start, so backward', () => {
        const plan = P.planHops(list, { x: -2.5, y: 61, z: 2.5 }, { x: 2, y: 41, z: 1 });
        assert.equal(plan.forward, false);
        assert.deepEqual(goals(plan), ['walk', 'ladder_top', 'ladder_foot', 'walk', 'start']);
        assert.deepEqual(plan.hops[1].passes, [4]);
    });

    test('a goal as a box: the end inside it wins', () => {
        const plan = P.planHops(list, { x: 2.5, y: 50, z: -1.5 }, { min: { x: 0, y: 40, z: 0 }, max: { x: 4, y: 43, z: 2 } });
        assert.equal(plan.forward, false);
    });

    test('a bot half way down the ladder going down joins at the foot, never at the top', () => {
        const plan = P.planHops(list, { x: 2.5, y: 52, z: -1.5 }, { x: 2, y: 41, z: 1 });
        assert.deepEqual(goals(plan), ['ladder_foot', 'walk', 'start']);
    });

    test('a bot half way up the ladder going up joins at the top, never at the foot', () => {
        const plan = P.planHops(list, { x: 2.5, y: 50, z: -1.5 }, { x: -3, y: 61, z: 2 });
        assert.deepEqual(goals(plan), ['ladder_top', 'walk', 'end']);
    });

    test('a bot in the room near the start, going to the room end: one hop', () => {
        const plan = P.planHops(list, { x: 2.5, y: 41, z: 1.5 }, { x: 2, y: 41, z: 1 });
        assert.deepEqual(goals(plan), ['start']);
    });

    test('without a goal: forward; without waypoints: no hops', () => {
        assert.equal(P.planHops(list, { x: -2.5, y: 61, z: 2.5 }).forward, true);
        assert.deepEqual(P.planHops([], { x: 0, y: 0, z: 0 }, null).hops, []);
    });

    test('a route that ends at an openable: its cell is the goal of the last hop', () => {
        const w = [{ x: 0, y: 64, z: 0, kind: 'start' }, { x: 3, y: 64, z: 0, kind: 'gate' }];
        assert.deepEqual(P.planHops(w, { x: 0.5, y: 64, z: 0.5 }, { x: 3, y: 64, z: 0 }).hops, [{ goal: 1, passes: [] }]);
    });
});

describe('pickRoute: the route to a target by its waypoints', () => {
    test('one end near the target, a waypoint within 32 of the bot (the bot on the ladder)', () => {
        const pick = P.pickRoute([SHAFT], { x: -3, y: 61, z: 2 }, { x: 2.5, y: 50, z: -1.5 });
        assert.equal(pick.route, SHAFT);
        assert.equal(pick.reverse, false);
        assert.deepEqual(pick.end, { x: -3, y: 61, z: 2 });
        assert.equal(pick.waypoints.length, 7);
    });

    test('the target at the start: reverse', () => {
        assert.equal(P.pickRoute([SHAFT], { x: 2, y: 41, z: 1 }, { x: -2.5, y: 61, z: 2.5 }).reverse, true);
    });

    test('no route: the target far from both ends, or the bot far from every waypoint', () => {
        assert.equal(P.pickRoute([SHAFT], { x: 40, y: 64, z: 40 }, { x: 2.5, y: 41, z: 1.5 }), null);
        assert.equal(P.pickRoute([SHAFT], { x: -3, y: 61, z: 2 }, { x: 100, y: 64, z: 100 }), null);
        assert.equal(P.pickRoute([], { x: -3, y: 61, z: 2 }, { x: 0, y: 64, z: 0 }), null);
    });
});

describe('index.js exports of part N (I7, I1)', () => {
    test('the waypoint functions, the dry scan, and causeText and legCause of part W', () => {
        for (const name of ['waypointsOf', 'nearestWaypoint', 'walkWaypoints', 'dryScan', 'planHops', 'pickRoute', 'walkByWaypoints',
            'isOpenableWaypoint', 'noWayText', 'waypointLabel', 'bySearch', 'causeText', 'legCause', 'WAYPOINT_RULES', 'DRY_SCAN_RULES']) {
            assert.ok(P[name] !== undefined, `index.js must export ${name}`);
        }
        assert.equal(P.WAYPOINT_RULES.hopMs, 60000, 'each hop at most 60 s');
        assert.equal(P.WAYPOINT_RULES.near, 1, 'GoalNear 1');
        assert.ok(P.WAYPOINT_RULES.reserveMs <= 20000);
    });

    test('bindRoutes gives the waypoint walk to the packs; bySearch reads routes_by_search', () => {
        const routes = P.bindRoutes({ entity: null }, { settings: { routes_by_search: true } }, null, null);
        for (const name of ['waypointsOf', 'nearestWaypoint', 'walkWaypoints', 'dryScan', 'bySearch', 'walkTo', 'routeFor']) {
            assert.equal(typeof routes[name], 'function', name);
        }
        assert.equal(routes.bySearch(), true);
        assert.equal(P.bindRoutes({ entity: null }, { settings: {} }, null, null).bySearch(), false);
        assert.equal(P.bySearch({ settings: { routes_by_search: 'yes' } }), false);
    });
});

describe('the setting routes_by_search (section 2)', () => {
    test('in settings_spec.json: a boolean, off by default; in settings.js: a boolean', async () => {
        const { readFileSync } = await import('node:fs');
        const spec = JSON.parse(readFileSync(new URL('../../src/mindcraft/public/settings_spec.json', import.meta.url), 'utf8'));
        assert.equal(spec.routes_by_search.type, 'boolean');
        assert.equal(spec.routes_by_search.default, false);
        const settings = (await loadSrc('settings.js')).default;
        assert.equal(typeof settings.routes_by_search, 'boolean');
    });
});
