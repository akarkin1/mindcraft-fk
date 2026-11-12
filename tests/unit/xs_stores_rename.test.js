// Spec v0.1.4.15, S 2.4 (E4): the stores' changes for the base survey.
//   - AreaStore takes source 'survey', the optional `base` and `under` of an area, and rename(old, new): the file key
//     and `name` change, nothing else; isShelterType covers a basement (a building under another one).
//   - PlaceStore gets rename(old, new) and the optional `base`; MemoryBank passes both on.
//   - BaseStore (src/agent/world/base_store.js): bases.json per world, set, get, list, remove, rename.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const S = await loadSrc('src/agent/areas/area_store.js');
const P = await loadSrc('src/agent/world/place_store.js');
const M = await loadSrc('src/agent/memory_bank.js');
const B = await loadSrc('src/agent/world/base_store.js');
const K = await loadSrc('src/agent/packs/home/area_kinds.js');

const T0 = Date.UTC(2026, 10, 9, 10, 0, 0);

let dir;
let cap;
let clock;
beforeEach(() => {
    dir = makeTmpDir();
    cap = captureConsole();
    clock = T0;
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

const now = () => new Date(clock);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function areaStore() {
    const store = new S.AreaStore(path.join(dir, 'areas.json'), { now });
    store.load();
    return store;
}

const house = (extra = {}) => ({
    name: 'house', type: 'home', kind: 'home', min: { x: 0, y: 60, z: 0 }, max: { x: 8, y: 65, z: 8 }, dimension: 'overworld',
    entrances: [{ x: 4, y: 61, z: 0, kind: 'door' }], source: 'survey', ...extra,
});

describe('AreaStore: the source survey, base and under (S 2.4)', () => {
    test('AREA_SOURCES holds survey; an area saved with it keeps it', () => {
        assert.ok(S.AREA_SOURCES.includes('survey'));
        const store = areaStore();
        const saved = store.set(house());
        assert.equal(saved.source, 'survey');
        assert.equal(readJson(store.filePath).areas.house.source, 'survey');
    });

    test('base and under are kept, normalised like names; an area without them has no field', () => {
        const store = areaStore();
        const saved = store.set(house({ base: 'East Base' }));
        assert.equal(saved.base, 'east_base');
        assert.equal('under' in saved, false);
        const basement = store.set({ ...house({ base: 'east' }), name: 'basement', type: 'building', kind: 'storage', under: 'House',
            min: { x: 0, y: 55, z: 0 }, max: { x: 8, y: 60, z: 8 } });
        assert.equal(basement.under, 'house');
        assert.equal(basement.base, 'east');
        const plain = store.set({ ...house(), name: 'barn', type: 'building', kind: 'building', source: 'scan' });
        assert.equal('base' in plain, false);
        assert.equal('under' in plain, false);
        const file = readJson(store.filePath).areas;
        assert.equal(file.house.base, 'east_base');
        assert.equal(file.basement.under, 'house');
        assert.equal('base' in file.barn, false);
        // the file is read back with them
        const again = areaStore();
        assert.equal(again.get('basement').under, 'house');
        assert.equal(again.get('house').base, 'east_base');
    });

    test('a new box keeps base and under unless the call gives them', () => {
        const store = areaStore();
        store.set(house({ base: 'east', under: 'nothing' }));
        const moved = store.set({ ...house(), base: undefined, max: { x: 9, y: 65, z: 9 } });
        assert.equal(moved.base, 'east');
        assert.equal(moved.under, 'nothing');
        const other = store.set({ ...house(), base: 'west' });
        assert.equal(other.base, 'west');
    });

    test('ofBase lists the areas of a base by name', () => {
        const store = areaStore();
        store.set(house({ base: 'east' }));
        store.set({ ...house({ base: 'east' }), name: 'cow_pen', type: 'pen', kind: 'pen', min: { x: 20, y: 60, z: 0 }, max: { x: 30, y: 63, z: 10 } });
        store.set({ ...house({ base: 'west' }), name: 'far', min: { x: 100, y: 60, z: 0 }, max: { x: 108, y: 65, z: 8 } });
        assert.deepEqual(store.ofBase('East').map(a => a.name), ['cow_pen', 'house']);
        assert.deepEqual(store.ofBase('north'), []);
        assert.deepEqual(store.ofBase(null), []);
    });
});

describe('AreaStore.rename(old, new) (S 2.4)', () => {
    test('the file key and name change, nothing else, not even updated', () => {
        const store = areaStore();
        const before = store.set({ ...house(), name: 'carrot_farm', type: 'farm', kind: 'farm', border: 'open', contents: { crops: { potatoes: 27 } } });
        clock += 60000;
        const renamed = store.rename('carrot_farm', 'Wheat Farm');
        assert.equal(renamed.name, 'wheat_farm');
        assert.deepEqual({ ...renamed, name: undefined }, { ...before, name: undefined });
        assert.equal(renamed.updated, before.updated);
        assert.equal(store.get('carrot_farm'), undefined);
        assert.equal(store.get('wheat_farm').contents.crops.potatoes, 27);
        const file = readJson(store.filePath).areas;
        assert.deepEqual(Object.keys(file), ['wheat_farm']);
        assert.equal(file.wheat_farm.name, 'wheat_farm');
    });

    test('null for an unknown area, for a name that exists already and for a bad name; nothing changes', () => {
        const store = areaStore();
        store.set(house());
        store.set({ ...house(), name: 'barn', type: 'building', kind: 'building' });
        const revision = store.revision;
        assert.equal(store.rename('shed', 'barn2'), null);
        assert.equal(store.rename('house', 'barn'), null);
        assert.equal(store.rename('house', ''), null);
        assert.equal(store.rename('house', 'x'.repeat(65)), null);
        assert.equal(store.rename(null, 'y'), null);
        assert.equal(store.revision, revision);
        assert.deepEqual(store.list().map(a => a.name), ['barn', 'house']);
    });

    test('the revision changes, so the guard refreshes', () => {
        const store = areaStore();
        store.set(house());
        const revision = store.revision;
        store.rename('house', 'home');
        assert.ok(store.revision > revision);
    });
});

describe('isShelterType covers the basement (S 2.3)', () => {
    test('a home is a shelter; a building only when it lies under another building', () => {
        assert.equal(S.isShelterType('home'), true);
        assert.equal(S.isShelterType('building'), false);
        assert.equal(S.isShelterType('building', { under: 'house' }), true);
        assert.equal(S.isShelterType('building', { under: '' }), false);
        assert.equal(S.isShelterType('pen', { under: 'house' }), false);
        assert.equal(S.isShelterType('farm'), false);
    });

    test('isShelterArea of the home pack: the basement of the survey is a shelter', () => {
        const basement = { type: 'building', under: 'house', min: { x: 0, y: 55, z: 0 }, max: { x: 8, y: 60, z: 8 } };
        assert.equal(K.isShelterArea(basement), true);
        assert.equal(K.isShelterArea({ ...basement, under: undefined }), false);
        assert.equal(K.isShelterArea({ type: 'home', min: basement.min, max: basement.max }), true);
    });
});

function placeStore() {
    const store = new P.PlaceStore(path.join(dir, 'places.json'), { now });
    store.load();
    return store;
}

describe('PlaceStore: base and rename (S 2.4)', () => {
    test('remember with a base keeps it, normalised; without one the entry has no base field', () => {
        const store = placeStore();
        const saved = store.remember('mine_entrance', 10, 50, -3, 'overworld', 'East Base');
        assert.equal(saved.base, 'east_base');
        const plain = store.remember('bed', 1, 2, 3, 'overworld');
        assert.equal('base' in plain, false);
        const file = readJson(store.filePath).places;
        assert.equal(file.mine_entrance.base, 'east_base');
        assert.equal('base' in file.bed, false);
        assert.deepEqual(file.bed, { x: 1, y: 2, z: 3, dimension: 'overworld', saved_at: new Date(T0).toISOString() });
        const again = placeStore();
        assert.equal(again.recall('mine_entrance').base, 'east_base');
        assert.equal(again.list().find(p => p.name === 'mine_entrance').base, 'east_base');
    });

    test('a place saved again without a base keeps its base; a new base replaces it', () => {
        const store = placeStore();
        store.remember('portal', 0, 60, 0, 'overworld', 'east');
        assert.equal(store.remember('portal', 0, 61, 0, 'overworld').base, 'east');
        assert.equal(store.remember('portal', 0, 61, 0, 'overworld', 'west').base, 'west');
    });

    test('ofBase lists the places of a base', () => {
        const store = placeStore();
        store.remember('a', 0, 0, 0, null, 'east');
        store.remember('b', 1, 0, 0, null, 'west');
        store.remember('c', 2, 0, 0, null, 'east');
        assert.deepEqual(store.ofBase('east').map(p => p.name), ['a', 'c']);
        assert.deepEqual(store.ofBase(''), []);
    });

    test('rename: the key changes, nothing else; null for unknown, taken or bad names', () => {
        const store = placeStore();
        const before = store.remember('tied_ghast', 5, 64, 5, 'overworld', 'east');
        clock += 1000;
        const renamed = store.rename('tied_ghast', 'ghast');
        assert.deepEqual(renamed, before);
        assert.equal(store.recall('tied_ghast'), undefined);
        assert.deepEqual(store.recall('ghast'), before);
        assert.deepEqual(Object.keys(readJson(store.filePath).places), ['ghast']);
        store.remember('other', 1, 1, 1);
        assert.equal(store.rename('ghast', 'other'), null);
        assert.equal(store.rename('nothing', 'x'), null);
        assert.equal(store.rename('ghast', ' '), null);
        assert.deepEqual(store.names(), ['ghast', 'other']);
    });
});

describe('MemoryBank: base and rename (S 2.4)', () => {
    test('with a store: rememberPlace passes the base on, recallPlaceInfo gives it, rename renames', () => {
        const bank = new M.MemoryBank();
        bank.attachStore(placeStore(), () => 'overworld');
        assert.equal(bank.rememberPlace('cane', 3, 63, 9, undefined, 'east'), true);
        assert.deepEqual(bank.recallPlaceInfo('cane'), { x: 3, y: 63, z: 9, dimension: 'overworld', base: 'east' });
        bank.rememberPlace('bed', 1, 1, 1);
        assert.equal('base' in bank.recallPlaceInfo('bed'), false);
        assert.equal(bank.rename('cane', 'sugar'), true);
        assert.equal(bank.recallPlaceInfo('cane'), undefined);
        assert.equal(bank.recallPlaceInfo('sugar').base, 'east');
        assert.equal(bank.rename('sugar', 'bed'), false);
        assert.equal(bank.rename('nothing', 'x'), false);
        assert.deepEqual(bank.placesOfBase('east').map(p => p.name), ['sugar']);
    });

    test('without a store: rename works in RAM and the base is dropped', () => {
        const bank = new M.MemoryBank();
        bank.rememberPlace('a', 1, 2, 3, undefined, 'east');
        assert.deepEqual(bank.recallPlace('a'), [1, 2, 3]);
        assert.equal(bank.rename('a', 'b'), true);
        assert.equal(bank.recallPlace('a'), undefined);
        assert.deepEqual(bank.recallPlace('b'), [1, 2, 3]);
        assert.equal(bank.rename('b', ''), false);
        assert.deepEqual(bank.placesOfBase('east'), []);
    });
});

function baseStore(file = path.join(dir, 'bases.json')) {
    const store = new B.BaseStore(file, { now });
    store.load();
    return store;
}

const east = (extra = {}) => ({ name: 'east', centre: { x: 10.7, y: 64, z: -3.2 }, dimension: 'minecraft:overworld', door: { x: 4, y: 61, z: 0 },
    places: ['house', 'basement', 'cow_pen'], ...extra });

describe('BaseStore (S 2.4)', () => {
    test('set writes bases.json in the shape of the spec; surveyed is the time of the call', () => {
        const store = baseStore();
        const saved = store.set(east());
        assert.deepEqual(saved, { name: 'east', centre: { x: 10, y: 64, z: -4 }, dimension: 'overworld', door: { x: 4, y: 61, z: 0 },
            surveyed: new Date(T0).toISOString(), places: ['house', 'basement', 'cow_pen'] });
        assert.deepEqual(readJson(store.filePath), { version: 1, bases: { east: saved } });
        assert.equal(B.BASE_FILE, 'bases.json');
    });

    test('get, list, remove; names normalised; a base without a door', () => {
        const store = baseStore();
        store.set(east());
        store.set(east({ name: 'West Base', door: null, dimension: 'the_nether' }));
        assert.equal(store.get('East').name, 'east');
        assert.equal(store.get('west_base').door, null);
        assert.deepEqual(store.list().map(b => b.name), ['east', 'west_base']);
        assert.deepEqual(store.list('overworld').map(b => b.name), ['east']);
        assert.equal(store.size, 2);
        assert.equal(store.remove('east'), true);
        assert.equal(store.remove('east'), false);
        assert.equal(store.get('east'), null);
        assert.deepEqual(Object.keys(readJson(store.filePath).bases), ['west_base']);
    });

    test('rename: the key and the name change, nothing else; null for unknown or taken names', () => {
        const store = baseStore();
        const before = store.set(east());
        clock += 5000;
        const renamed = store.rename('east', 'Home Base');
        assert.deepEqual(renamed, { ...before, name: 'home_base' });
        assert.equal(store.get('east'), null);
        assert.deepEqual(Object.keys(readJson(store.filePath).bases), ['home_base']);
        store.set(east({ name: 'other' }));
        assert.equal(store.rename('home_base', 'other'), null);
        assert.equal(store.rename('nothing', 'x'), null);
        assert.equal(store.rename('home_base', ''), null);
    });

    test('the file is read back; invalid entries are skipped; a corrupt file starts empty', () => {
        const store = baseStore();
        store.set(east());
        store.set(east({ name: 'north', surveyed: '2026-11-01T00:00:00.000Z', places: ['a', 'a', 7, ' b '] }));
        const again = baseStore();
        assert.equal(again.size, 2);
        assert.equal(again.get('north').surveyed, '2026-11-01T00:00:00.000Z');
        assert.deepEqual(again.get('north').places, ['a', 'b']);
        fs.writeFileSync(store.filePath, JSON.stringify({ version: 1, bases: { bad: { name: 'bad' }, good: east() } }));
        const third = baseStore();
        assert.deepEqual(third.list().map(b => b.name), ['good']);
        fs.writeFileSync(store.filePath, '{ not json');
        const fourth = baseStore();
        assert.equal(fourth.size, 0);
    });

    test('invalid bases are refused with null; an in-memory store without a file works', () => {
        const store = baseStore();
        assert.equal(store.set(null), null);
        assert.equal(store.set({ name: 'x' }), null);
        assert.equal(store.set({ centre: { x: 0, y: 0, z: 0 } }), null);
        const memory = new B.BaseStore(null, { now });
        memory.load();
        assert.ok(memory.set(east()));
        assert.equal(memory.get('east').name, 'east');
        assert.equal(fs.existsSync(path.join(dir, 'bases.json')), false);
        assert.equal(B.normalizeBaseName(' East  Base '), 'east_base');
        assert.equal(B.normalizeBaseName(7), null);
    });
});

describe('module rules', () => {
    test('base_store.js imports only the safe json helper, with no side effects', () => {
        assertImportRules('src/agent/world/base_store.js', { allowBuiltins: [], allowedRelative: ['safe_json.js'] });
        assertCleanImport('src/agent/world/base_store.js');
    });
});
