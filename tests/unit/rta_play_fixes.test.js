// v0.1.4.9 after the first play of the owner (engineer E1): F18 a way between two floors of one area (the home
// area of the owner holds the house and the basement), F19 the place at the end of a remembered way, F21 the
// door service closes only an openable the bot passed itself (the trapdoor the owner opened and went down
// stays open; the one the bot went down through is closed behind it), F22 a column of ladders that ends more
// than 1 block above the floor.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeFakeBot, addPlayer, v } from './home_fake_bot.test.js';
import * as MF from './mining_fake_bot.test.js';

const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
const P = await loadSrc('src/agent/packs/routes/index.js');
const L = await loadSrc('src/agent/packs/home/door_logic.js');
const D = await loadSrc('src/agent/packs/home/doors.js');
const LAD = await loadSrc('src/agent/packs/mining/ladder.js');

let warn;
let log;
before(() => {
    warn = console.warn;
    log = console.log;
    console.warn = () => {};
    console.log = () => {};
});
after(() => {
    console.warn = warn;
    console.log = log;
});

// ------------------------------------------------------------------ F18, F19: the owner's house

// The home area of the owner: one box over both floors, y 55 to 71. The house floor at feet 67, a trapdoor at
// (13, 66, 51) over ladders facing south at (13, 57..65, 51), the basement at feet 57.
const HOME = { name: 'home', type: 'home', dimension: 'overworld', min: { x: 5, y: 55, z: 45 }, max: { x: 20, y: 71, z: 58 } };
const T = { kind: 'trapdoor', name: 'oak_trapdoor', x: 13, y: 66, z: 51 };
const st = (x, y, z, extra = {}) => ({ x, y, z, on: 'oak_planks', at: 'air', sky: false, t: 0, via: null, ...extra });

function downTrail() {
    const steps = [st(10, 67, 54), st(11, 67, 53), st(12, 67, 52), st(13, 67, 52)];
    steps.push(st(13, 66, 51, { at: 'oak_trapdoor', via: { ...T } }));
    for (let y = 65; y >= 57; y--) steps.push(st(13, y, 51, { at: 'ladder', on: y === 57 ? 'stone' : 'ladder', via: y === 65 ? { ...T } : null }));
    steps.push(st(13, 57, 52), st(14, 57, 53), st(15, 57, 54));
    return steps;
}

function memoryBank(places = {}) {
    const saved = { ...places };
    return {
        saved,
        getJson: () => Object.fromEntries(Object.entries(saved).map(([n, p]) => [n, [p.x, p.y, p.z]])),
        recallPlaceInfo: n => (saved[n] ? { ...saved[n], dimension: 'overworld' } : undefined),
        rememberPlace(name, x, y, z, dimension) {
            saved[name] = { x, y, z, dimension };
            return true;
        },
    };
}

function remembering(steps, known = {}) {
    const last = steps[steps.length - 1];
    const bot = {
        entity: { position: new Vec3(last.x + 0.5, last.y, last.z + 0.5), onGround: true },
        game: { dimension: 'overworld' },
        blockAt: p => (p.x === 13 && p.z === 51 && p.y >= 57 && p.y <= 65
            ? { name: 'ladder', boundingBox: 'block', getProperties: () => ({ facing: 'south' }) } : { name: 'air', boundingBox: 'empty' }),
    };
    const store = new P.RouteStore(null, { now: () => new Date('2026-10-01T10:00:00Z') });
    const places = memoryBank(known);
    const ctx = { places, areas: [HOME], routes: { store, trail: { list: () => steps.map(s => ({ ...s })), tick() {} } } };
    return { bot, store, places, ctx };
}

describe('F18: a way between two floors of one area', () => {
    test('from the house floor down the ladder to the basement: a route with a ladder leg from the area "home", level 67', () => {
        const s = remembering(downTrail(), { storage: { x: 90, y: 64, z: 90 } });
        const r = P.rememberRoute(s.bot, s.ctx, 'basement');
        assert.equal(r.ok, true, r.text);
        assert.equal(r.route.legs.filter(l => l.kind === 'ladder').length, 1, JSON.stringify(r.route.legs));
        assert.deepEqual(r.route.from, { name: 'home, level 67', kind: 'area', x: 13, y: 67, z: 52 }, 'the last step on the upper floor');
        assert.match(r.text, /^I remember the way "basement": from the area "home", level 67 to here, \d+ steps, 1 ladder, 1 trapdoor\. I walk it in both directions\./);
        assert.match(P.routesText(s.ctx, 'overworld'), /^I know 1 route: "basement" from the area "home", level 67 to \(15, 57, 54\), \d+ steps\.$/);
    });

    test('on one floor of the area: too short, as before', () => {
        const s = remembering([st(10, 67, 54), st(11, 67, 53), st(12, 67, 52)]);
        const r = P.rememberRoute(s.bot, s.ctx, 'kitchen');
        assert.deepEqual({ ok: r.ok, reason: r.reason, text: r.text }, { ok: false, reason: 'too_short', text: 'The way "kitchen" is too short: I stand where it starts.' });
        assert.deepEqual(Object.keys(s.places.saved), [], 'no place for a way that was not remembered');
    });

    test('a step 2 blocks higher (a step up, a slab) is the same floor; ladder and trapdoor steps are no floor', () => {
        const steps = [st(10, 67, 54), st(11, 68, 53), st(12, 69, 52)];
        assert.equal(P.routeStart(steps, P.knownThings({ areas: [HOME] })), null);
        const known = P.knownThings({ areas: [HOME] });
        const trail = downTrail();
        assert.equal(P.routeStart(trail, known).index, 3, 'past the ladder and the cell of the trapdoor, the last step on the floor');
    });
});

describe('F19: the place at the end of the way', () => {
    test('a new name: the place is saved where the way ends, and the text says so', () => {
        const s = remembering(downTrail());
        const r = P.rememberRoute(s.bot, s.ctx, 'basement');
        assert.ok(r.text.endsWith(' I walk it in both directions. I saved the place "basement" there too.'), r.text);
        assert.deepEqual(s.places.saved.basement, { x: 15, y: 57, z: 54, dimension: 'overworld' });
    });

    test('a place of that name exists: it stays, and the text says nothing of it', () => {
        const s = remembering(downTrail(), { basement: { x: 1, y: 2, z: 3 } });
        const r = P.rememberRoute(s.bot, s.ctx, 'basement');
        assert.equal(r.ok, true);
        assert.equal(r.text.includes('I saved the place'), false, r.text);
        assert.deepEqual(s.places.saved.basement, { x: 1, y: 2, z: 3 });
    });

    test('a bank that refuses the place: no claim in the text', () => {
        const s = remembering(downTrail());
        s.places.rememberPlace = () => false;
        assert.equal(P.rememberRoute(s.bot, s.ctx, 'basement').text.includes('I saved the place'), false);
    });
});

// ------------------------------------------------------------------ F21: the door service

describe('F21: passSide and DoorWatch', () => {
    const HATCH = { x: 13, y: 66, z: 51, kind: 'trapdoor', name: 'oak_trapdoor', facing: 'south' };
    const look = (w, t, pos, over = {}) => w.observe({ now: t, botPos: pos, moving: true, players: over.players ?? [], doors: [{ ...HATCH, open: true, ...over.door }] });

    test('the side of the bot at a trapdoor: above beside it or over it, below it, in its cell', () => {
        assert.equal(L.passSide(HATCH, { x: 13.5, y: 67, z: 52.5 }), 1);
        assert.equal(L.passSide(HATCH, { x: 13.5, y: 66, z: 52.5 }), 1, 'beside it at its height');
        assert.equal(L.passSide(HATCH, { x: 13.5, y: 66.2, z: 51.5 }), 0, 'in its cell');
        assert.equal(L.passSide(HATCH, { x: 13.5, y: 64, z: 51.5 }), -1);
        assert.equal(L.passSide(HATCH, { x: 16.5, y: 67, z: 51.5 }), null, '3 blocks sideways');
    });

    test('the owner opened it and went down; the bot stands beside it above: it stays open', () => {
        const w = new L.DoorWatch();
        look(w, 0, { x: 20, y: 67, z: 52 }, { door: { open: false } });
        look(w, 300, { x: 20, y: 67, z: 52 }, { players: [{ x: 13.5, y: 66, z: 51.5 }] });
        for (let t = 600; t < 20000; t += 300) {
            assert.deepEqual(look(w, t, { x: 14.5, y: 67, z: 52.5 }), [], `t ${t}`);
        }
    });

    test('the bot went down through it: closed when it is 2 blocks below, whoever opened it', () => {
        const w = new L.DoorWatch();
        look(w, 6000, { x: 13.5, y: 67, z: 52.5 });
        look(w, 6300, { x: 13.5, y: 66.1, z: 51.5 });
        assert.deepEqual(look(w, 6600, { x: 13.5, y: 65, z: 51.5 }), [], '1 below');
        const out = look(w, 6900, { x: 13.5, y: 64, z: 51.5 });
        assert.deepEqual(out.map(d => [d.name, d.why]), [['oak_trapdoor', 'passed']]);
        assert.deepEqual(look(w, 7200, { x: 13.5, y: 63, z: 51.5 }, { door: { occupied: true } }), [], 'not with somebody within 1 block');
    });
});

describe('F21: the service on the fake bot of the home pack', () => {
    function scene(botAt) {
        const world = makeWorld();
        world.set(13, 63, 51, 'oak_trapdoor', { facing: 'south', half: 'top', open: false });
        const bot = makeFakeBot({ world, pos: botAt });
        let t = 1_000_000;
        const clock = { now: () => t, wait: async (ms) => { t += Math.max(ms, 1); await Promise.resolve(); } };
        const service = D.createDoorService(bot, { areas: [], settings: { home_pack: true }, now: clock.now, log: () => {} }, { now: clock.now, wait: clock.wait, checkMs: 40 });
        const step = async (pos, ms = 250) => {
            if (pos) bot.entity.position = v(...pos);
            t += ms;
            service.tick();
            await new Promise(r => setTimeout(r, 5));
        };
        return { world, bot, step, isOpen: () => world.propsAt(13, 63, 51).open === true, elapsed: () => t };
    }

    test('a trapdoor the owner opened and went down, the bot beside it: it stays open', async () => {
        const s = scene([15.5, 64, 52.5]);
        await s.step();
        s.world.toggle(13, 63, 51);
        const owner = addPlayer(s.bot, 'owner', [13.5, 62, 51.5]);
        await s.step();
        owner.position = v(13.5, 58, 51.5);
        for (let i = 0; i < 40; i++) await s.step([14.5, 64, 52.5]);
        assert.equal(s.isOpen(), true);
    });

    test('a trapdoor the bot went down through: closed within 3 s once the bot is 2 blocks below', async () => {
        const s = scene([15.5, 64, 52.5]);
        await s.step();
        s.world.toggle(13, 63, 51); // the owner opened it and went down long ago
        for (let i = 0; i < 30; i++) await s.step();
        await s.step([13.5, 64, 52.5]);
        await s.step([13.5, 63.2, 51.5]);
        await s.step([13.5, 62, 51.5]);
        await s.step([13.5, 61, 51.5]);
        const below = s.elapsed();
        while (s.isOpen() && s.elapsed() - below < 3000) await s.step([13.5, 60, 51.5]);
        assert.equal(s.isOpen(), false);
        assert.ok(s.elapsed() - below < 3000);
    });

    test('the owner within 1 block of it: not closed until he left', async () => {
        const s = scene([13.5, 64, 52.5]);
        await s.step();
        s.world.toggle(13, 63, 51);
        const owner = addPlayer(s.bot, 'owner', [14.5, 63, 51.5]);
        await s.step([13.5, 63.2, 51.5]);
        await s.step([13.5, 61, 51.5]);
        for (let i = 0; i < 6; i++) await s.step();
        assert.equal(s.isOpen(), true, 'the owner stands beside it');
        owner.position = v(25.5, 64, 51.5);
        for (let i = 0; i < 6 && s.isOpen(); i++) await s.step();
        assert.equal(s.isOpen(), false);
    });
});

// ------------------------------------------------------------------ F22: a column that ends above the floor

describe('F22: the foot of a column that ends more than 1 block above the floor', () => {
    const at = (x, y, z, a = 'air') => ({ x, y, z, on: 'stone', at: a, sky: false, t: 0, via: null });
    // the owner's mine: ladders facing east at (8, 43..58, 47), the floor of the room at feet 41
    const shaft = [at(8, 59, 48)];
    for (let y = 58; y >= 43; y--) shaft.push(at(8, y, 47, 'ladder'));
    const faceAt = () => 'east';

    test('down: the foot is the step on the floor under the column; the walk starts there, never at a ladder cell', () => {
        const legs = P.routeFromSteps([...shaft, at(8, 41, 47), at(9, 41, 46), at(9, 41, 44)], { faceAt }).legs;
        assert.deepEqual(legs.map(l => l.kind), ['ladder', 'walk']);
        assert.deepEqual({ bottom: legs[0].bottom, foot: legs[0].foot }, { bottom: 43, foot: { x: 8, y: 41, z: 47 } });
        assert.deepEqual(legs[1].from, { x: 8, y: 41, z: 47 });
        const back = P.reverseRoute({ legs }).legs;
        assert.deepEqual(back[0].to, { x: 8, y: 41, z: 47 }, 'up: the walk ends at the foot');
    });

    test('a floor step away from the column: the foot under the column and a walk between them, both ways', () => {
        const down = P.routeFromSteps([...shaft, at(9, 41, 44), at(9, 41, 43)], { faceAt }).legs;
        assert.deepEqual(down.map(l => l.kind), ['ladder', 'walk', 'walk']);
        assert.deepEqual(down[0].foot, { x: 8, y: 41, z: 47 });
        assert.deepEqual([down[1].from, down[1].to], [{ x: 8, y: 41, z: 47 }, { x: 9, y: 41, z: 44 }]);
        const up = P.routeFromSteps([at(9, 41, 43), at(9, 41, 44), ...shaft.slice().reverse()], { faceAt }).legs;
        assert.deepEqual(up.map(l => l.kind), ['walk', 'walk', 'ladder']);
        assert.deepEqual(up[1].to, { x: 8, y: 41, z: 47 });
    });

    test('a column that ends 1 block above the floor: the floor under it is the bottom, as before', () => {
        const legs = P.routeFromSteps([...shaft, at(8, 42, 47), at(9, 42, 47)], { faceAt }).legs;
        assert.equal(legs[0].bottom, 42);
    });
});

describe('F22 on the fake bot: down with the drop, up with a jump onto the ladder', () => {
    // ladders facing south on a stone wall at z -3 from `lowest` to 58, the floor at feet 41, open above y 59
    function shaft(lowest, pos) {
        const world = MF.makeWorld({ groundY: 60 });
        world.fill(0, 41, -2, 4, 43, 2, 'air');
        world.fill(2, 41, -2, 2, 59, -2, 'air');
        world.fill(2, lowest, -2, 2, 58, -2, 'ladder', { facing: 'south' });
        world.set(2, 59, -2, 'ladder', { facing: 'south' });
        const bot = MF.makeMiningBot({ world, pos });
        return { world, bot, clock: MF.makeClock(bot) };
    }

    test('down a column that ends 2 above the floor: the bot drops and stands on the floor, ok', async () => {
        const s = shaft(43, [2.5, 59, -2.5]);
        const leg = { kind: 'ladder', x: 2, z: -2, top: 59, bottom: 43, face: 'south', entry: null, foot: { x: 2, y: 41, z: -2 } };
        s.bot.entity.position = MF.v(2.5, 59.2, -1.5);
        const r = await LAD.slideDown(s.bot, leg, { clock: s.clock });
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.equal(Math.floor(s.bot.entity.position.y), 41);
    });

    test('up from the foot under the column: jump until the feet are on a ladder, then climb', async () => {
        // the leg says bottom 43 (the lowest step on a ladder in the trail); the ladder starts at 42
        const s = shaft(42, [3.5, 41, 0.5]);
        const leg = { kind: 'ladder', x: 2, z: -2, top: 59, bottom: 43, face: 'south', entry: { x: 2, y: 61, z: -1 }, foot: { x: 2, y: 41, z: -2 } };
        const into = await LAD.enterColumn(s.bot, leg, { clock: s.clock });
        assert.deepEqual(into, { ok: true, reason: null });
        assert.equal(s.world.nameAt(2, Math.floor(s.bot.entity.position.y), -2), 'ladder');
    });

    test('F22b: ladders 3 cells above the floor, 2 ladders carried: the bot places them from the floor up and climbs out', async () => {
        const s = shaft(44, [3.5, 41, 0.5]);
        s.world.set(2, 60, -2, 'air'); // open above the top ladder
        MF.give(s.bot, 'ladder', 2);
        const leg = { kind: 'ladder', x: 2, z: -2, top: 59, bottom: 44, face: 'south', entry: { x: 2, y: 61, z: -1 }, foot: { x: 2, y: 41, z: -2 } };
        const route = { name: 'mine', legs: [leg] };
        const r = await P.walkRoute(s.bot, {}, route, { clock: s.clock });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual([s.world.nameAt(2, 42, -2), s.world.nameAt(2, 43, -2)], ['ladder', 'ladder']);
        assert.deepEqual(s.bot.calls.filter(c => c[0] === 'place').map(c => c[2]), [42, 43], 'from the floor up');
        assert.equal(Math.floor(s.bot.entity.position.y), 61, 'out at the top');
        assert.deepEqual(r.changed, [{ leg: 0, bottom: 42 }]);
        assert.equal(route.legs[0].bottom, 42, 'the leg of the caller has the new bottom');
        assert.equal(s.bot.calls.filter(c => c[0] === 'dig').length, 0);
    });

    test('F22b: no ladder carried: no_path within 5 s, the failure text says which ladders it needs, nothing dug', async () => {
        const s = shaft(43, [3.5, 41, 0.5]);
        const leg = { kind: 'ladder', x: 2, z: -2, top: 59, bottom: 43, face: 'south', entry: { x: 2, y: 61, z: -1 }, foot: { x: 2, y: 41, z: -2 } };
        const t0 = s.clock.now();
        const into = await LAD.enterColumn(s.bot, { ...leg }, { clock: s.clock });
        assert.deepEqual(into, { ok: false, reason: 'no_ladder', missing: [{ x: 2, y: 42, z: -2 }] });
        assert.ok(s.clock.now() - t0 < 8000, `${s.clock.now() - t0} ms`);
        const r = await P.walkRoute(s.bot, {}, { name: 'mine', legs: [leg] }, { clock: s.clock });
        assert.equal(r.text, 'I could not follow the route "mine" at step 1 of 1, at (2, 41, -2). Show me the way again. I need 1 ladder at (2, 42, -2) to climb out.');
        const two = shaft(44, [3.5, 41, 0.5]);
        const r2 = await P.walkRoute(two.bot, {}, { name: 'mine', legs: [{ ...leg, bottom: 44 }] }, { clock: two.clock });
        assert.ok(r2.text.endsWith(' I need 2 ladders at (2, 42, -2) and (2, 43, -2) to climb out.'), r2.text);
        assert.equal(s.bot.calls.filter(c => c[0] === 'dig').length, 0);
    });
});
