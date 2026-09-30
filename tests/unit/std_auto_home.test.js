// Spec v0.1.4.8, part D: D6 (the house, M5 and R2) -- autoHome of src/agent/areas/auto_home.js.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';
import { createBlockWorld } from '../helpers/block_world.js';

const MODULE = 'src/agent/areas/auto_home.js';
const H = await loadSrc(MODULE);
const S = await loadSrc('src/agent/areas/area_store.js');

const SAVED_TEXT = 'I saved your house as the area "home": 9 x 6 x 11 blocks, 2 doors. Tell me if that is wrong.';
const NO_WALLS_TEXT = 'I know the place "home" but I find no walls there. Stand in your house and tell me that this is home.';

let dir;
let cap;
let store;
beforeEach(() => {
    dir = makeTmpDir();
    cap = captureConsole();
    store = new S.AreaStore(path.join(dir, 'areas.json'));
    store.load();
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

// A house of 7 x 9 blocks with walls 2 high and a door on the north and the south side: the scan
// gives a box of 9 x 6 x 11 blocks (the blocks grown by 1), the example of the spec.
function houseWorld() {
    const world = createBlockWorld().flatGround(63);
    const house = world.house({ x: 0, y: 63, z: 0, width: 7, depth: 9, wallHeight: 2 });
    world.set(3, 64, 0, 'spruce_door', { half: 'lower' }).set(3, 65, 0, 'spruce_door', { half: 'upper' });
    let reads = 0;
    const getBlock = (x, y, z) => {
        reads++;
        return world.getBlockName(x, y, z);
    };
    return { world, house, getBlock, reads: () => reads };
}

// Places as the MemoryBank of the agent gives them.
const bank = (places) => ({
    recallPlaceInfo: (name) => (Object.hasOwn(places, name) ? { ...places[name] } : undefined),
    recallPlace: (name) => (Object.hasOwn(places, name) ? [places[name].x, places[name].y, places[name].z] : undefined),
});

const HOME = { x: 3.5, y: 64, z: 4.5, dimension: 'overworld' };
const BOT = { x: 10.5, y: 64, z: 10.5 };

describe('autoHome(getBlock, places, store, botPos)', () => {
    test('no area of type home, the place home in the house: the house is saved as "home", type home, source auto', () => {
        const { getBlock } = houseWorld();
        const result = H.autoHome(getBlock, bank({ home: HOME }), store, BOT);
        assert.deepEqual(result, { saved: true, reason: 'saved', text: SAVED_TEXT });
        const area = store.get('home');
        assert.equal(area.type, 'home');
        assert.equal(area.source, 'auto');
        assert.equal(area.dimension, 'overworld');
        assert.deepEqual(area.min, { x: -1, y: 62, z: -1 });
        assert.deepEqual(area.max, { x: 7, y: 67, z: 9 });
        assert.deepEqual(area.entrances.map(e => e.kind), ['door', 'door']);
    });

    test('the places may come as a PlaceStore, as positions only, as an object or a Map', () => {
        const forms = [
            { recall: (name) => (name === 'home' ? { ...HOME, saved_at: 'x' } : undefined) },
            { recallPlace: (name) => (name === 'home' ? [3.5, 64, 4.5] : undefined) },
            { home: { x: 3.5, y: 64, z: 4.5 } },
            { home: [3.5, 64, 4.5] },
            new Map([['home', { x: 3.5, y: 64, z: 4.5 }]]),
        ];
        for (const places of forms) {
            const own = new S.AreaStore(path.join(dir, `areas_${Math.random()}.json`));
            own.load();
            const result = H.autoHome(houseWorld().getBlock, places, own, BOT);
            assert.equal(result.saved, true, JSON.stringify(places));
            assert.equal(own.get('home').type, 'home');
        }
    });

    test('an area of type home exists already: nothing happens', () => {
        const { getBlock, reads } = houseWorld();
        store.set({ name: 'base', type: 'home', min: { x: 100, y: 60, z: 100 }, max: { x: 110, y: 70, z: 110 } });
        assert.deepEqual(H.autoHome(getBlock, bank({ home: HOME }), store, BOT), { saved: false, reason: 'has_home', text: '' });
        assert.equal(store.get('home'), undefined);
        assert.equal(reads(), 0);
    });

    test('an area "home" of type building (v0.1.4.7) becomes of type home, with its own box, without a scan', () => {
        const { getBlock, reads } = houseWorld();
        store.set({ name: 'home', type: 'building', min: { x: -1, y: 62, z: -1 }, max: { x: 7, y: 67, z: 9 },
            entrances: [{ x: 3, y: 64, z: 8, kind: 'door' }, { x: 3, y: 64, z: 0, kind: 'door' }], source: 'manual' });
        const result = H.autoHome(getBlock, null, store, BOT);
        assert.deepEqual(result, { saved: true, reason: 'saved', text: SAVED_TEXT });
        assert.equal(store.get('home').type, 'home');
        assert.equal(store.get('home').source, 'manual');
        assert.equal(reads(), 0);
    });

    test('an area "home" of another type is left alone', () => {
        store.set({ name: 'home', type: 'farm', min: { x: 0, y: 60, z: 0 }, max: { x: 5, y: 65, z: 5 } });
        assert.equal(H.autoHome(houseWorld().getBlock, bank({ home: HOME }), store, BOT).reason, 'name_taken');
        assert.equal(store.get('home').type, 'farm');
    });

    test('no place "home": nothing happens', () => {
        assert.deepEqual(H.autoHome(houseWorld().getBlock, bank({ mine: HOME }), store, BOT), { saved: false, reason: 'no_place', text: '' });
        assert.equal(H.autoHome(houseWorld().getBlock, null, store, BOT).reason, 'no_place');
        assert.equal(store.size, 0);
    });

    test('within 48 blocks only', () => {
        const { getBlock } = houseWorld();
        assert.equal(H.AUTO_HOME_RANGE, 48);
        const far = { x: HOME.x + 48.1, y: HOME.y, z: HOME.z };
        assert.equal(H.autoHome(getBlock, bank({ home: HOME }), store, far).reason, 'too_far');
        assert.equal(store.size, 0);
        const edge = { x: HOME.x + 48, y: HOME.y, z: HOME.z };
        assert.equal(H.autoHome(getBlock, bank({ home: HOME }), store, edge).saved, true);
    });

    test('the place is not loaded: nothing happens, and it is no try', () => {
        const { world, getBlock } = houseWorld();
        world.setLoaded({ min: { x: 50, y: 0, z: 50 }, max: { x: 60, y: 100, z: 60 } });
        assert.equal(H.autoHome(getBlock, bank({ home: HOME }), store, BOT).reason, 'not_loaded');
        world.setLoaded(null);
        assert.equal(H.autoHome(getBlock, bank({ home: HOME }), store, BOT).saved, true);
    });

    test('no walls at the place: the text of the spec; at most one try per start', () => {
        const world = createBlockWorld().flatGround(63);
        let reads = 0;
        const getBlock = (x, y, z) => {
            reads++;
            return world.getBlockName(x, y, z);
        };
        assert.deepEqual(H.autoHome(getBlock, bank({ home: HOME }), store, BOT), { saved: false, reason: 'no_walls', text: NO_WALLS_TEXT });
        const after = reads;
        world.house({ x: 0, y: 63, z: 0, width: 7, depth: 9, wallHeight: 2 });
        assert.deepEqual(H.autoHome(getBlock, bank({ home: HOME }), store, BOT), { saved: false, reason: 'tried', text: '' });
        assert.ok(reads - after <= 1, 'no second scan');
        const nextStart = new S.AreaStore(path.join(dir, 'areas.json'));
        nextStart.load();
        assert.equal(H.autoHome(getBlock, bank({ home: HOME }), nextStart, BOT).saved, true, 'a new start tries again');
    });

    test('a place in another dimension than the bot is not scanned', () => {
        const nether = { ...HOME, dimension: 'the_nether' };
        assert.equal(H.autoHome(houseWorld().getBlock, bank({ home: nether }), store, BOT, { dimension: 'overworld' }).reason, 'other_dimension');
        assert.equal(H.autoHome(houseWorld().getBlock, bank({ home: nether }), store, BOT, { dimension: 'minecraft:the_nether' }).saved, true);
        assert.equal(store.get('home').dimension, 'the_nether');
    });

    test('never throws: no store, a broken store, a broken getBlock', () => {
        const { getBlock } = houseWorld();
        assert.equal(H.autoHome(getBlock, bank({ home: HOME }), null, BOT).reason, 'no_store');
        assert.equal(H.autoHome(null, bank({ home: HOME }), store, BOT).reason, 'no_store');
        const broken = { list: () => [], get: () => undefined, set: () => { throw new RangeError('too big'); } };
        assert.equal(H.autoHome(getBlock, bank({ home: HOME }), broken, BOT).reason, 'error');
        assert.ok(cap.of('warn').length >= 1);
        const throwing = () => { throw new Error('chunk'); };
        assert.equal(H.autoHome(throwing, bank({ home: HOME }), store, BOT).reason, 'not_loaded');
        const places = { recallPlaceInfo: () => { throw new Error('disk'); } };
        assert.equal(H.autoHome(getBlock, places, store, BOT).reason, 'error');
    });
});

describe('module rules', () => {
    test('imports only project files and node built-ins', () => {
        assertImportRules(MODULE);
    });

    test('imports cleanly: no output, no files', () => {
        assertCleanImport(MODULE);
    });
});
