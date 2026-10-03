// Spec v0.1.4.9, part A (engineer E1): the route store (I2: routes.json, names like areas, invalid
// entries skipped, never throws) and the texts of A2, A3 and I3 word for word.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';

const S = await loadSrc('src/agent/packs/routes/route_store.js');
const X = await loadSrc('src/agent/packs/routes/texts.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

let clock = Date.parse('2026-09-30T10:00:00Z');
const now = () => new Date(clock);

const walk = (a, b) => ({ kind: 'walk', from: a, to: b });
const LADDER = { kind: 'ladder', x: 2, z: -2, top: 59, bottom: 41, face: 'south', entry: { x: 2, y: 61, z: -3 } };
const TRAP = { kind: 'door', kind2: 'trapdoor', name: 'oak_trapdoor', x: 2, y: 60, z: -2, from: { x: 2, y: 59, z: -2 }, to: { x: 2, y: 61, z: -3 } };
const BED = {
    name: 'Bed', dimension: 'minecraft:overworld', from: { name: 'storage', kind: 'place', x: 2, y: 41, z: -1 }, to: { name: 'bed', x: 12, y: 45, z: 8 },
    legs: [walk({ x: 2, y: 41, z: -1 }, { x: 2, y: 41, z: -2 }), LADDER, TRAP, walk({ x: 2, y: 61, z: -3 }, { x: 5, y: 61, z: 0 }),
        walk({ x: 5, y: 61, z: 0 }, { x: 8, y: 61, z: 3 }), walk({ x: 8, y: 61, z: 3 }, { x: 10, y: 61, z: 5 }), walk({ x: 10, y: 61, z: 5 }, { x: 12, y: 45, z: 8 })],
    steps: 30, source: 'trail',
};

describe('RouteStore', () => {
    test('set, get, list, remove, size in memory; names like areas', () => {
        const s = new S.RouteStore(null, { now });
        assert.equal(s.load(), 0);
        const saved = s.set(BED);
        assert.equal(saved.name, 'bed');
        assert.equal(saved.dimension, 'overworld');
        assert.deepEqual(saved.from, { name: 'storage', x: 2, y: 41, z: -1, kind: 'place' });
        assert.equal(saved.legs.length, 7);
        assert.equal(saved.created, '2026-09-30T10:00:00.000Z');
        assert.equal(s.get(' BED ').name, 'bed');
        assert.equal(s.get('bed', 'the_nether'), null);
        assert.equal(s.size, 1);
        assert.equal(s.remove('Bed'), true);
        assert.equal(s.remove('bed'), false);
        assert.equal(s.size, 0);
    });

    test('a route of each dimension; the list of a dimension by name', () => {
        const s = new S.RouteStore(null, { now });
        s.set({ ...BED, name: 'my way' });
        s.set(BED);
        s.set({ ...BED, dimension: 'the_nether' });
        assert.deepEqual(s.list('overworld').map(r => r.name), ['bed', 'my_way']);
        assert.deepEqual(s.list('the_nether').map(r => r.name), ['bed']);
        assert.equal(s.list().length, 3);
        assert.equal(s.remove('bed', 'the_nether'), true);
        assert.equal(s.get('bed').name, 'bed');
    });

    test('a replaced route keeps its created time', () => {
        const s = new S.RouteStore(null, { now });
        s.set(BED);
        clock += 60000;
        const again = s.set({ ...BED, steps: 40 });
        assert.equal(again.created, '2026-09-30T10:00:00.000Z');
        assert.equal(again.updated, '2026-09-30T10:01:00.000Z');
        assert.equal(again.steps, 40);
    });

    test('invalid routes are refused without throwing; invalid legs are left out', () => {
        const s = new S.RouteStore(null, { now });
        assert.equal(s.set(null), null);
        assert.equal(s.set({ ...BED, name: '  ' }), null);
        assert.equal(s.set({ ...BED, to: { x: 'a' } }), null);
        assert.equal(s.set({ ...BED, legs: [{ kind: 'fly' }] }), null);
        assert.equal(s.set({ ...BED, legs: [...BED.legs, { kind: 'fly' }] }).legs.length, 7);
        assert.equal(s.size, 1);
    });

    test('the file: { version: 1, routes: { "<name>" | "<dim>:<name>": route } }, read back', () => {
        const dir = makeTmpDir();
        try {
            const file = path.join(dir, S.ROUTE_FILE);
            const s = new S.RouteStore(file, { now });
            s.set(BED);
            s.set({ ...BED, dimension: 'the_nether' });
            const json = JSON.parse(fs.readFileSync(file, 'utf8'));
            assert.equal(json.version, 1);
            assert.deepEqual(Object.keys(json.routes).sort(), ['bed', 'the_nether:bed']);
            const t = new S.RouteStore(file, { now });
            assert.equal(t.load(), 2);
            assert.deepEqual(t.get('bed'), s.get('bed'));
        } finally {
            removeTmpDir(dir);
        }
    });

    test('a file with a broken entry and a corrupt file: the valid routes, never a throw', () => {
        const dir = makeTmpDir();
        try {
            const file = path.join(dir, 'routes.json');
            fs.writeFileSync(file, JSON.stringify({ version: 1, routes: { bed: BED, bad: { name: 'bad', legs: [] }, junk: 7 } }));
            const s = new S.RouteStore(file, { now });
            assert.equal(s.load(), 1);
            fs.writeFileSync(file, '{ not json');
            assert.equal(s.load(), 0);
            assert.equal(new S.RouteStore(path.join(dir, 'missing.json')).load(), 0);
        } finally {
            removeTmpDir(dir);
        }
    });
});

describe('texts', () => {
    test('A2: the way remembered, with ladders, doors, gates and trapdoors in that order', () => {
        const route = { name: 'bed', from: { name: 'storage', kind: 'place' }, legs: BED.legs };
        assert.equal(X.rememberedText(route), 'I remember the way "bed": from the place "storage" to here, 7 steps, 1 ladder, 1 trapdoor. I walk it in both directions.');
        assert.equal(X.rememberedText(route, true),
            'I know a way "bed" already. I replace it. I remember the way "bed": from the place "storage" to here, 7 steps, 1 ladder, 1 trapdoor. I walk it in both directions.');
        const many = [LADDER, LADDER, TRAP, { ...TRAP, kind2: 'door' }, { ...TRAP, kind2: 'gate' }, { ...TRAP, kind2: 'gate' }];
        assert.equal(X.legsText(many), '6 steps, 2 ladders, 1 door, 2 gates, 1 trapdoor');
        assert.equal(X.legsText([walk({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })]), '1 step');
        assert.equal(X.startText({ name: 'home', kind: 'area' }), 'the area "home"');
        assert.equal(X.startText({ name: 'mine', kind: 'mine' }), 'the mine "mine"');
        assert.equal(X.startText({ name: null, kind: null, x: 30, y: 41, z: 4 }), '(30, 41, 4)');
    });

    test('A2: no start, too short', () => {
        assert.equal(X.TEXTS.noStart, 'I do not know where this way starts. Stand at a place I know first, then walk with me and tell me again.');
        assert.equal(X.tooShortText('bed'), 'The way "bed" is too short: I stand where it starts.');
        assert.equal(X.replacedText('bed'), 'I know a way "bed" already. I replace it.');
    });

    test('A3: the list of routes, forgot, no route', () => {
        const bed = { name: 'bed', from: { name: 'storage', kind: 'place' }, to: { x: 12, y: 45, z: 8 }, legs: BED.legs };
        const mine = { name: 'mine', from: { name: 'home', kind: 'area' }, to: { x: 30, y: 41, z: 4 }, legs: new Array(12).fill(LADDER) };
        assert.equal(X.routeListText([bed, mine]),
            'I know 2 routes: "bed" from the place "storage" to (12, 45, 8), 7 steps; "mine" from the area "home" to (30, 41, 4), 12 steps.');
        assert.equal(X.routeListText([{ ...bed, legs: [LADDER] }]), 'I know 1 route: "bed" from the place "storage" to (12, 45, 8), 1 step.');
        assert.equal(X.routeListText([]), 'I know no routes.');
        assert.equal(X.forgotText('bed'), 'Forgot the route "bed".');
        assert.equal(X.noRouteText('bed'), 'I know no route "bed".');
    });

    test('I3: a failure and a stop', () => {
        // v0.1.4.11, W1: "Show me the way again." is gone; without a cause the text ends with the position
        assert.equal(X.routeFailedText({ name: 'bed' }, 3, 7, { x: 12, y: 45, z: 8 }), 'I could not follow the route "bed" at step 3 of 7, at (12, 45, 8).');
        assert.equal(X.routeStoppedText({ name: 'bed' }, 3, 7), 'I was stopped on the route "bed" at step 3 of 7.');
        assert.equal(X.routeFailedText({ legs: [] }, 1, 2, { x: 1.7, y: 2, z: -3.2 }), 'I could not follow the route at step 1 of 2, at (1, 2, -4).');
        assert.equal(X.routeTimeText({ name: 'bed' }, 3, 7, { x: 1, y: 2, z: 3 }), 'The time for the route "bed" ran out at step 3 of 7, at (1, 2, 3).');
        assert.equal(X.routeDoneText({ name: 'bed' }, 7), 'I followed the route "bed", 7 steps.');
        assert.equal(X.emptyRouteText({ name: 'bed' }), 'The route "bed" has no steps.');
    });
});
