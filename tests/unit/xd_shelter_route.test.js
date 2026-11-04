// v0.1.4.14, round 4 of the fix round (W110 `ten_minutes` part C on 26.1: "I could not sleep: I found no way to the
// bed."): the shelter walk of !goToBed from the door took the learned route "basement" (both ends inside the area
// "home") as its way into the house, ended in the basement, and the walk to the bed had to climb the ladder through
// the trapdoor again (where the bot stuck at (398.5, 60.0, -2.3)). A route with both ends inside the area is a way
// within the building, never a way into it: isRouteWithinArea of shelter_logic.js, used by goToShelter.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const L = await loadSrc('src/agent/packs/home/shelter_logic.js');
const W = await loadSrc('src/agent/packs/routes/waypoints.js');

// the area "home" of the run (rememberArea in the owner base) and the two learned routes, as routes.json and
// mines.json of the run hold them
const HOME = { name: 'home', type: 'home', dimension: 'overworld', min: { x: 395, y: 52, z: -6 }, max: { x: 405, y: 66, z: 6 },
    entrances: [{ x: 400, y: 61, z: -5, kind: 'door' }] };
const BASEMENT = {
    name: 'basement', dimension: 'overworld',
    from: { name: 'home, level 61', x: 398, y: 61, z: -3, kind: 'area' }, to: { name: 'basement', x: 398, y: 53, z: -2 },
    legs: [
        { kind: 'door', kind2: 'trapdoor', name: 'oak_trapdoor', x: 398, y: 60, z: -3, from: { x: 398, y: 61, z: -3 }, to: { x: 398, y: 59, z: -3 } },
        { kind: 'ladder', x: 398, z: -3, top: 59, bottom: 53, face: 'south', entry: { x: 398, y: 61, z: -2 }, foot: { x: 398, y: 53, z: -2 } },
    ],
};
const INTO = {
    name: 'into', dimension: 'overworld', from: { name: 'yard', x: 400, y: 61, z: -12 }, to: { name: 'home', x: 400, y: 61, z: -2 },
    legs: [
        { kind: 'walk', from: { x: 400, y: 61, z: -12 }, to: { x: 400, y: 61, z: -6 } },
        { kind: 'door', kind2: 'door', name: 'oak_door', x: 400, y: 61, z: -5, from: { x: 400, y: 61, z: -6 }, to: { x: 400, y: 61, z: -4 } },
        { kind: 'walk', from: { x: 400, y: 61, z: -4 }, to: { x: 400, y: 61, z: -2 } },
    ],
};
const DOOR_OUTSIDE = { x: 400.5, y: 61, z: -5.6 }; // where the bot stood after the mining trip

describe('isRouteWithinArea (round 4)', () => {
    test('the route "basement" is picked for the area from the door, and lies within the area at both ends', () => {
        const pick = W.pickRoute([BASEMENT], HOME, DOOR_OUTSIDE);
        assert.ok(pick && pick.route.name === 'basement', 'the routes pack offers it as a way to the area');
        assert.equal(L.isRouteWithinArea(pick, HOME), true);
    });

    test('a route from the yard through the door into the house is a way in', () => {
        const pick = W.pickRoute([INTO], HOME, { x: 400.5, y: 61, z: -11.5 });
        assert.ok(pick, 'picked');
        assert.equal(L.isRouteWithinArea(pick, HOME), false);
        assert.equal(L.isRouteWithinArea({ waypoints: W.waypointsOf(INTO) }, HOME), false);
    });

    test('nothing to judge: false', () => {
        for (const pick of [null, undefined, {}, { waypoints: [] }, { waypoints: 'x' }])
            assert.equal(L.isRouteWithinArea(pick, HOME), false);
        assert.equal(L.isRouteWithinArea({ waypoints: W.waypointsOf(BASEMENT) }, null), false);
    });
});

// goToShelter with the fake bot of home_fake_bot.test.js and a fake ctx.routes (as rta_hooks.test.js)
import { makeWorld, makeFakeBot, buildHouse, v } from './home_fake_bot.test.js';

const S = await loadSrc('src/agent/packs/home/shelter.js');
const QUICK = { checkMs: 40, wait: () => new Promise(r => setTimeout(r, 2)) };

function routesWith(pick, bot, moveTo = null) {
    const calls = [];
    return {
        calls,
        bySearch: () => true,
        routeFor: () => pick,
        waypointsOf: () => [],
        walkTo: async (b, target) => {
            calls.push(target);
            if (moveTo) bot.entity.position = v(...moveTo);
            return { ok: true, reason: null, text: 'x', route: pick?.route?.name ?? null };
        },
    };
}

describe('goToShelter and a learned route (round 4)', () => {
    let warn;
    test('a route within the area is not walked: the bot enters by the door', async () => {
        warn = console.warn;
        console.warn = () => {};
        try {
            const world = makeWorld();
            const house = buildHouse(world);
            const bot = makeFakeBot({ world, pos: [4.5, 64, 30.5] });
            const a = { x: house.min.x + 2, y: house.min.y + 1, z: house.min.z + 2 };
            const b = { x: house.max.x - 2, y: house.min.y + 1, z: house.max.z - 2 };
            const pick = { route: { name: 'basement' }, reverse: false, waypoints: [{ ...a, kind: 'start' }, { ...b, kind: 'end' }] };
            const ctx = { areas: [house], places: null, settings: {}, log: () => {}, now: () => Date.now() };
            ctx.routes = routesWith(pick, bot, [b.x + 0.5, b.y, b.z + 0.5]);
            const r = await S.goToShelter(bot, ctx, QUICK);
            assert.equal(r.ok, true, JSON.stringify(r));
            assert.deepEqual(ctx.routes.calls, [], 'the route within the area is never walked');
            assert.ok(L.isInsideArea(house, bot.entity.position), 'inside through the door');
        } finally {
            console.warn = warn;
        }
    });

    test('a route from outside into the area is still walked first', async () => {
        warn = console.warn;
        console.warn = () => {};
        try {
            const world = makeWorld();
            const house = buildHouse(world);
            const bot = makeFakeBot({ world, pos: [4.5, 64, 30.5] });
            const inside = { x: house.min.x + 2, y: house.min.y + 1, z: house.min.z + 2 };
            const pick = { route: { name: 'home' }, reverse: false, waypoints: [{ x: 4, y: 64, z: 30, kind: 'start' }, { ...inside, kind: 'end' }] };
            const ctx = { areas: [house], places: null, settings: {}, log: () => {}, now: () => Date.now() };
            ctx.routes = routesWith(pick, bot, [inside.x + 0.5, inside.y, inside.z + 0.5]);
            const r = await S.goToShelter(bot, ctx, QUICK);
            assert.equal(r.ok, true, JSON.stringify(r));
            assert.equal(ctx.routes.calls.length, 1, 'the route into the area is walked');
        } finally {
            console.warn = warn;
        }
    });
});
