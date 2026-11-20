// Spec v0.1.4.16, F2 (engineer E2): the centre and the door of the base, and `home` once. The door is the door of the house
// that holds the place `my_bed` (F6, read through ctx.places with optional chaining), else of the home nearest the start,
// else of the building with a door nearest the start; the house with `my_bed` keeps the kind home, else the home nearest
// the start, and every other home becomes a building (type building, no shelter), its name as uniqueName gave it; the
// report says them as `house (1 bed)` as today.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { createBlockWorld, vec } from '../helpers/block_world.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

const S = await loadSrc('src/agent/packs/survey/survey.js');
const L = await loadSrc('src/agent/packs/survey/survey_logic.js');
const AS = await loadSrc('src/agent/areas/area_store.js');
const PS = await loadSrc('src/agent/world/place_store.js');
const MB = await loadSrc('src/agent/memory_bank.js');
const BS = await loadSrc('src/agent/world/base_store.js');

const NAMES = [...new Set([...Object.values(L.SEED_NAMES).flat(), 'air', 'stone', 'dirt', 'grass_block', 'oak_planks', 'oak_log', 'glass_pane'])];
const registry = { blocksByName: Object.fromEntries(NAMES.map((name, i) => [name, { id: i + 1, name }])) };
const idOf = (name) => registry.blocksByName[name]?.id ?? null;

// Two houses of the block world (7 x 7, the door in the south wall, a bed in the north-west corner), 20 blocks apart:
// A at x 0, B at x 20; `beds: false` makes them buildings without a bed.
function world(options = {}) {
    const w = createBlockWorld();
    w.fill(-40, 20, -40, 80, 57, 80, 'stone');
    w.fill(-40, 58, -40, 80, 58, 80, 'grass_block');
    const bed = options.beds === false ? null : 'red_bed';
    const a = w.house({ x: 0, y: 59, z: 0, bed, chest: null });
    const b = w.house({ x: 20, y: 59, z: 0, bed, chest: null });
    return { w, a, b };
}

function fakeBot(w, at) {
    const bot = {
        registry, entity: { position: vec(at.x, at.y, at.z) }, entities: {}, game: { dimension: 'overworld' }, interrupt_code: false,
        blockAt: (pos) => w.blockAt(pos),
        findBlocks({ matching, maxDistance, count }) {
            const ids = new Set(matching);
            const me = bot.entity.position;
            return w.positionsOf((name) => ids.has(idOf(name))).map((p) => ({ p, d: Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z) }))
                .filter(({ d }) => d <= maxDistance).sort((a, b) => a.d - b.d).slice(0, count).map(({ p }) => vec(p.x, p.y, p.z));
        },
    };
    return bot;
}

let dir;
let cap;
beforeEach(() => {
    dir = makeTmpDir();
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

function stores() {
    const areas = new AS.AreaStore(path.join(dir, 'areas.json'));
    areas.load();
    const placeStore = new PS.PlaceStore(path.join(dir, 'places.json'));
    placeStore.load();
    const places = new MB.MemoryBank();
    places.attachStore(placeStore, () => 'overworld');
    const bases = new BS.BaseStore(path.join(dir, 'bases.json'));
    bases.load();
    const said = [];
    const ctx = { areas, places, bases, settings: { survey_radius: 128 }, now: () => 0, log: () => {}, say: (t) => said.push(t), routes: null };
    return { ctx, areas, places, bases, said };
}

const clock = { now: () => 0, wait: async () => {} };
// The bot stands east of house B: B is the nearest house, A the farther one.
const NEAR_B = { x: 30.5, y: 59, z: 3.5 };

describe('the door of the base and one home (F2)', () => {
    test('without my_bed: the home nearest the start keeps home and gives the door; the other house is a building', async () => {
        const { w, a, b } = world();
        const { ctx, areas, bases, said } = stores();
        const r = await S.surveyBase(fakeBot(w, NEAR_B), ctx, 'east', clock);
        assert.equal(r.ok, true, r.text);
        const base = bases.get('east');
        assert.deepEqual(base.door, b.door, 'the door of the nearest house');
        const kinds = Object.fromEntries(areas.list().map(x => [x.name, [x.kind, x.type]]));
        assert.deepEqual(kinds, { house: ['building', 'building'], house_2: ['home', 'home'] }, 'the first found house (A) is a building, B the home');
        assert.equal(AS.isShelterType(areas.get('house').type, areas.get('house')), false, 'a demoted house is no shelter');
        assert.equal(AS.isShelterType(areas.get('house_2').type, areas.get('house_2')), true);
        assert.ok(said[0].startsWith('I found 2 places: house 2 (1 bed), house (1 bed). All saved.'), `the home first, then the building, both as house (1 bed): ${said[0]}`);
        assert.ok(Math.abs(base.centre.x - 13) <= 1 && Math.abs(base.centre.z - 3) <= 1, `the centre between the two houses: ${JSON.stringify(base.centre)}`);
        void a;
    });

    test('with my_bed in the farther house: that house is the home and gives the door, even when another home is nearer', async () => {
        const { w, a, b } = world();
        const { ctx, areas, bases, places } = stores();
        places.rememberPlace('my_bed', a.bed[1].x, a.bed[1].y, a.bed[1].z, 'overworld'); // the foot of the bed of house A
        const r = await S.surveyBase(fakeBot(w, NEAR_B), ctx, 'east', clock);
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(bases.get('east').door, a.door);
        assert.deepEqual(Object.fromEntries(areas.list().map(x => [x.name, x.kind])), { house: 'home', house_2: 'building' });
        void b;
    });

    test('my_bed is read through ctx.places.get when the store has it (E1\'s PlaceStore API), with optional chaining', async () => {
        const { w, a } = world();
        const { ctx, bases } = stores();
        const bank = ctx.places;
        ctx.places = { get: (name) => (name === 'my_bed' ? { x: a.bed[1].x, y: a.bed[1].y, z: a.bed[1].z } : undefined),
            rememberPlace: (...args) => bank.rememberPlace(...args), list: () => bank.store.list(), recallPlaceInfo: (n) => bank.recallPlaceInfo(n) };
        const r = await S.surveyBase(fakeBot(w, NEAR_B), ctx, 'east', clock);
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(bases.get('east').door, a.door);
    });

    test('my_bed inside the owner\'s home area: the owner\'s door is the base\'s door and no house of the survey is a home', async () => {
        const { w, b } = world();
        const { ctx, areas, bases, places } = stores();
        const own = areas.set({ name: 'home', type: 'home', kind: 'home', min: { x: 40, y: 59, z: 0 }, max: { x: 48, y: 64, z: 8 }, dimension: 'overworld',
            entrances: [{ x: 44, y: 60, z: 8, kind: 'door' }], source: 'scan' });
        places.rememberPlace('my_bed', 42, 60, 2, 'overworld');
        const r = await S.surveyBase(fakeBot(w, NEAR_B), ctx, 'east', clock);
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(bases.get('east').door, { x: 44, y: 60, z: 8 });
        assert.deepEqual(areas.list().filter(x => x.source === 'survey').map(x => x.kind), ['building', 'building']);
        assert.deepEqual(bases.get('east').kept, ['home'], 'the owner\'s area in the base');
        assert.deepEqual(areas.get('home'), own, 'the owner\'s area is unchanged');
        void b;
    });

    test('no home: the door of the building with a door nearest the start', async () => {
        const { w, b } = world({ beds: false });
        const { ctx, areas, bases } = stores();
        const r = await S.surveyBase(fakeBot(w, NEAR_B), ctx, 'east', clock);
        assert.equal(r.ok, true, r.text);
        assert.ok(areas.list().every(x => x.kind !== 'home'));
        assert.deepEqual(bases.get('east').door, b.door);
    });

    test('a base of points only: the centre is their average, no door', async () => {
        const w = createBlockWorld().flatGround(58);
        w.set(30, 59, 30, 'nether_portal').set(30, 60, 30, 'nether_portal');
        const { ctx, bases } = stores();
        const r = await S.surveyBase(fakeBot(w, { x: 28.5, y: 59, z: 28.5 }), ctx, 'east', clock);
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(bases.get('east').centre, { x: 30, y: 59, z: 30 });
        assert.equal(bases.get('east').door, null);
    });
});
