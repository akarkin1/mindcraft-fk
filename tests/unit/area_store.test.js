// Spec v0.1.4.6 A2: src/agent/areas/area_store.js -- AreaStore, the protected areas of one world.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir, listDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const MODULE = 'src/agent/areas/area_store.js';
const S = await loadSrc(MODULE);

const T0 = Date.UTC(2026, 8, 28, 10, 0, 0);

let dir;
let file;
let cap;
let clock;
beforeEach(() => {
    dir = makeTmpDir();
    file = path.join(dir, 'areas.json');
    cap = captureConsole();
    clock = T0;
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

function newStore(fp = file) {
    return new S.AreaStore(fp, { now: () => new Date(clock) });
}

function loaded(fp = file) {
    const store = newStore(fp);
    store.load();
    return store;
}

const readFile = () => JSON.parse(fs.readFileSync(file, 'utf8'));

function home(extra = {}) {
    return {
        name: 'home',
        type: 'building',
        min: { x: -8, y: 62, z: 25 },
        max: { x: 0, y: 67, z: 31 },
        dimension: 'overworld',
        entrances: [{ x: -4, y: 63, z: 31, kind: 'door' }],
        source: 'scan',
        ...extra,
    };
}

function farm(extra = {}) {
    return {
        name: 'wheat_farm',
        type: 'farm',
        min: { x: -6, y: 61, z: 28 },
        max: { x: 4, y: 66, z: 36 },
        dimension: 'overworld',
        entrances: [{ x: 0, y: 63, z: 36, kind: 'gate' }],
        source: 'scan',
        ...extra,
    };
}

describe('constants', () => {
    test('limits of an area: 64 x 48 x 64 blocks', () => {
        assert.deepEqual({ ...S.MAX_AREA_SIZE }, { x: 64, y: 48, z: 64 });
        // v0.1.4.8, I4 and D6: five types, and the source "auto" of autoHome
        assert.deepEqual([...S.AREA_TYPES], ['home', 'building', 'farm', 'pen', 'mine']);
        assert.deepEqual([...S.AREA_SOURCES], ['scan', 'manual', 'radius', 'auto']);
    });
});

describe('set(area)', () => {
    test('saves an area with all fields and returns a copy', () => {
        const store = loaded();
        const saved = store.set(home());
        const iso = new Date(T0).toISOString();
        assert.deepEqual(saved, {
            name: 'home',
            type: 'building',
            min: { x: -8, y: 62, z: 25 },
            max: { x: 0, y: 67, z: 31 },
            dimension: 'overworld',
            entrances: [{ x: -4, y: 63, z: 31, kind: 'door' }],
            source: 'scan',
            created: iso,
            updated: iso,
        });
        saved.min.x = 999;
        saved.entrances.push({ x: 0, y: 0, z: 0, kind: 'door' });
        assert.equal(store.get('home').min.x, -8, 'the returned copy is not the stored object');
        assert.equal(store.get('home').entrances.length, 1);
    });

    test('writes the file { version: 1, areas: { <name>: area } }', () => {
        const store = loaded();
        store.set(home());
        const data = readFile();
        assert.equal(data.version, 1);
        assert.deepEqual(Object.keys(data.areas), ['home']);
        assert.equal(data.areas.home.name, 'home');
        assert.deepEqual(data.areas.home.min, { x: -8, y: 62, z: 25 });
        assert.deepEqual(listDir(dir), ['areas.json'], 'atomic write leaves no temp file');
    });

    test('corners in any order and with fractions are normalised (floored, min <= max)', () => {
        const store = loaded();
        const saved = store.set(home({ min: { x: 0.7, y: 67.2, z: 31.9 }, max: { x: -7.5, y: 62, z: 25 } }));
        assert.deepEqual(saved.min, { x: -8, y: 62, z: 25 });
        assert.deepEqual(saved.max, { x: 0, y: 67, z: 31 });
    });

    test('the name is trimmed; 1 to 64 characters, otherwise a TypeError', () => {
        const store = loaded();
        assert.equal(store.set(home({ name: '  home  ' })).name, 'home');
        assert.equal(store.set(home({ name: 'x'.repeat(64) })).name.length, 64);
        for (const bad of ['', '   ', 'x'.repeat(65), null, 42, undefined]) {
            assert.throws(() => store.set(home({ name: bad })), TypeError, `name ${JSON.stringify(bad)}`);
        }
        assert.deepEqual(store.list().map(a => a.name), ['home', 'x'.repeat(64)]);
    });

    test('type must be building or farm, otherwise a TypeError', () => {
        const store = loaded();
        assert.throws(() => store.set(home({ type: 'house' })), TypeError);
        assert.throws(() => store.set(home({ type: undefined })), TypeError);
        assert.equal(store.size, 0);
    });

    test('corners that are missing or not finite give a TypeError', () => {
        const store = loaded();
        assert.throws(() => store.set(home({ min: null })), TypeError);
        assert.throws(() => store.set(home({ max: { x: 1, y: NaN, z: 1 } })), TypeError);
        assert.throws(() => store.set(null), TypeError);
        assert.equal(store.size, 0);
    });

    test('a box larger than 64 in x or z or 48 in y is refused with a RangeError; the limit itself is fine', () => {
        const store = loaded();
        const at = (sx, sy, sz) => home({ min: { x: 0, y: 0, z: 0 }, max: { x: sx - 1, y: sy - 1, z: sz - 1 } });
        assert.throws(() => store.set(at(65, 10, 10)), RangeError);
        assert.throws(() => store.set(at(10, 49, 10)), RangeError);
        assert.throws(() => store.set(at(10, 10, 65)), RangeError);
        assert.equal(store.size, 0);
        assert.equal(fs.existsSync(file), false, 'nothing written for a refused area');
        const ok = store.set(at(64, 48, 64));
        assert.deepEqual(ok.max, { x: 63, y: 47, z: 63 });
    });

    test('replacing keeps "created" and sets a new "updated"', () => {
        const store = loaded();
        store.set(home());
        clock = T0 + 60_000;
        const replaced = store.set(home({ type: 'farm', max: { x: 2, y: 67, z: 31 } }));
        assert.equal(replaced.created, new Date(T0).toISOString());
        assert.equal(replaced.updated, new Date(T0 + 60_000).toISOString());
        assert.equal(replaced.type, 'farm');
        assert.equal(store.size, 1);
    });

    test('dimension: the "minecraft:" prefix is dropped; missing means overworld', () => {
        const store = loaded();
        assert.equal(store.set(home({ dimension: 'minecraft:the_nether' })).dimension, 'the_nether');
        assert.equal(store.set(home({ dimension: undefined })).dimension, 'overworld');
        assert.equal(store.set(home({ dimension: '' })).dimension, 'overworld');
    });

    test('entrances: coordinates floored, invalid entries left out, not a list means none', () => {
        const store = loaded();
        const saved = store.set(home({ entrances: [
            { x: 1.5, y: 63.2, z: -2.5, kind: 'door' },
            { x: 1, y: 63, z: 1, kind: 'window' },
            { x: 'a', y: 63, z: 1, kind: 'gate' },
            null,
            { x: 2, y: 63, z: 2, kind: 'gate' },
        ] }));
        assert.deepEqual(saved.entrances, [{ x: 1, y: 63, z: -3, kind: 'door' }, { x: 2, y: 63, z: 2, kind: 'gate' }]);
        assert.deepEqual(store.set(home({ entrances: 'none' })).entrances, []);
    });

    test('source: scan, manual or radius; anything else becomes manual', () => {
        const store = loaded();
        assert.equal(store.set(home({ source: 'radius' })).source, 'radius');
        assert.equal(store.set(home({ source: 'guess' })).source, 'manual');
        assert.equal(store.set(home({ source: undefined })).source, 'manual');
    });

    test('a failing write logs a warning, does not throw, and keeps the area in memory', () => {
        const blocker = path.join(dir, 'blocker');
        fs.writeFileSync(blocker, 'a file where a directory should be');
        const store = loaded(path.join(blocker, 'areas.json'));
        const saved = store.set(home());
        assert.equal(saved.name, 'home');
        assert.equal(store.size, 1);
        assert.ok(cap.of('warn').some(r => r.text.includes('areas.json')), cap.allText());
    });
});

describe('load()', () => {
    test('missing file: 0 areas, nothing written', () => {
        const store = newStore();
        assert.equal(store.load(), 0);
        assert.equal(store.size, 0);
        assert.deepEqual(listDir(dir), []);
    });

    test('reads what set() wrote, in a new store', () => {
        const first = loaded();
        first.set(home());
        first.set(farm());
        const second = newStore();
        assert.equal(second.load(), 2);
        assert.deepEqual(second.get('home'), first.get('home'));
        assert.deepEqual(second.get('wheat_farm'), first.get('wheat_farm'));
    });

    test('invalid entries are skipped, valid ones kept, never throws', () => {
        const good = home();
        fs.writeFileSync(file, JSON.stringify({ version: 1, areas: {
            home: { ...good, created: '2026-01-01T00:00:00.000Z', updated: '2026-01-02T00:00:00.000Z' },
            nobox: { name: 'nobox', type: 'building' },
            badtype: { ...good, name: 'badtype', type: 'castle' },
            huge: { ...good, name: 'huge', min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 1, z: 1 } },
            text: 'not an area',
            ['x'.repeat(65)]: { ...good, name: 'x'.repeat(65) },
            ' spaced ': { ...good, name: ' spaced ' },
        } }));
        const store = newStore();
        // v0.1.4.8, D1: names are normalised on load, so " spaced " is the area "spaced" now
        assert.equal(store.load(), 2);
        const area = store.get('home');
        assert.equal(area.created, '2026-01-01T00:00:00.000Z');
        assert.equal(area.updated, '2026-01-02T00:00:00.000Z');
        assert.equal(store.get('spaced').name, 'spaced');
        assert.ok(cap.of('warn').length >= 1, 'skipped entries are reported');
    });

    test('the key of the file is the name of the area', () => {
        fs.writeFileSync(file, JSON.stringify({ version: 1, areas: { base: { ...home(), name: 'other' } } }));
        const store = newStore();
        assert.equal(store.load(), 1);
        assert.equal(store.get('base').name, 'base');
        assert.equal(store.get('other'), undefined);
    });

    test('a corrupt file is set aside and the store starts empty', () => {
        fs.writeFileSync(file, '{ not json');
        const store = newStore();
        assert.equal(store.load(), 0);
        const names = listDir(dir);
        assert.equal(names.includes('areas.json'), false);
        assert.ok(names.some(n => n.startsWith('areas.corrupt.')), names.join(', '));
        assert.ok(cap.of('warn').length >= 1);
    });

    test('a file without an "areas" object gives 0 and a warning', () => {
        fs.writeFileSync(file, JSON.stringify({ version: 1, areas: [] }));
        assert.equal(newStore().load(), 0);
        assert.ok(cap.of('warn').length >= 1);
    });

    test('load() replaces what was in memory', () => {
        const store = loaded();
        store.set(home());
        fs.writeFileSync(file, JSON.stringify({ version: 1, areas: { farm2: farm({ name: 'farm2' }) } }));
        assert.equal(store.load(), 1);
        assert.deepEqual(store.list().map(a => a.name), ['farm2']);
    });
});

describe('get, remove, list, size, revision', () => {
    test('get() returns a copy or undefined; the name is trimmed', () => {
        const store = loaded();
        store.set(home());
        assert.equal(store.get(' home ').name, 'home');
        assert.equal(store.get('nothing'), undefined);
        assert.equal(store.get(null), undefined);
        store.get('home').max.x = 100;
        assert.equal(store.get('home').max.x, 0);
    });

    test('remove() deletes and writes the file; false when the area does not exist', () => {
        const store = loaded();
        store.set(home());
        store.set(farm());
        assert.equal(store.remove('home'), true);
        assert.equal(store.remove('home'), false);
        assert.deepEqual(Object.keys(readFile().areas), ['wheat_farm']);
        assert.equal(store.size, 1);
    });

    test('list() is sorted by name and returns copies', () => {
        const store = loaded();
        store.set(home({ name: 'zeta' }));
        store.set(home({ name: 'alpha' }));
        store.set(farm({ name: 'Mid' }));
        // v0.1.4.8, D1: names are saved in lower case, so "Mid" is "mid"
        assert.deepEqual(store.list().map(a => a.name), ['alpha', 'mid', 'zeta']);
        store.list()[0].name = 'changed';
        assert.equal(store.list()[0].name, 'alpha');
    });

    test('revision changes on every load, set and remove (the guard refreshes its cache with it)', () => {
        const store = newStore();
        const seen = [store.revision];
        store.load();
        seen.push(store.revision);
        store.set(home());
        seen.push(store.revision);
        store.set(home());
        seen.push(store.revision);
        store.remove('home');
        seen.push(store.revision);
        assert.equal(new Set(seen).size, seen.length, `all different: ${seen}`);
        const before = store.revision;
        store.remove('home');
        store.get('home');
        store.list();
        assert.equal(store.revision, before, 'reading and removing nothing do not change it');
    });
});

describe('areasAt, nearest, near', () => {
    function world() {
        const store = loaded();
        store.set(home());
        store.set(farm());
        store.set(home({ name: 'nether_base', dimension: 'the_nether', min: { x: -8, y: 62, z: 25 }, max: { x: 0, y: 67, z: 31 } }));
        store.set(home({ name: 'far', min: { x: 100, y: 60, z: 100 }, max: { x: 110, y: 70, z: 110 } }));
        return store;
    }

    test('areasAt: areas whose box contains the position, in that dimension, a farm before a building', () => {
        const store = world();
        assert.deepEqual(store.areasAt({ x: -2.5, y: 63, z: 30 }, 'overworld').map(a => a.name), ['wheat_farm', 'home']);
        assert.deepEqual(store.areasAt({ x: -7, y: 63, z: 26 }, 'overworld').map(a => a.name), ['home']);
        assert.deepEqual(store.areasAt({ x: -7, y: 63, z: 26 }, 'the_nether').map(a => a.name), ['nether_base']);
        assert.deepEqual(store.areasAt({ x: -7, y: 63, z: 26 }, 'minecraft:the_nether').map(a => a.name), ['nether_base']);
        assert.deepEqual(store.areasAt({ x: 50, y: 63, z: 50 }, 'overworld'), []);
    });

    test('areasAt: areas of the same type by name', () => {
        const store = world();
        store.set(home({ name: 'annex' }));
        store.set(farm({ name: 'beans' }));
        assert.deepEqual(store.areasAt({ x: -2, y: 63, z: 30 }, 'overworld').map(a => a.name), ['beans', 'wheat_farm', 'annex', 'home']);
    });

    test('an invalid position: areasAt empty, nearest null, near empty', () => {
        const store = world();
        assert.deepEqual(store.areasAt(null, 'overworld'), []);
        assert.equal(store.nearest({ x: NaN, y: 0, z: 0 }, 'overworld'), null);
        assert.deepEqual(store.near(null, 'overworld', 100), []);
    });

    test('areasAt without a dimension means the overworld', () => {
        const store = world();
        assert.deepEqual(store.areasAt({ x: -7, y: 63, z: 26 }).map(a => a.name), ['home']);
    });

    test('nearest: { area, distance } of the nearest area, optionally of one type; null without areas', () => {
        const store = world();
        const inside = store.nearest({ x: -7, y: 63, z: 26 }, 'overworld');
        assert.equal(inside.area.name, 'home');
        assert.equal(inside.distance, 0);
        const outside = store.nearest({ x: 5, y: 63, z: 20 }, 'overworld', 'building');
        assert.equal(outside.area.name, 'home');
        assert.ok(Math.abs(outside.distance - Math.hypot(4, 5)) < 1e-9, String(outside.distance));
        assert.equal(store.nearest({ x: 105, y: 65, z: 90 }, 'overworld').area.name, 'far');
        assert.equal(store.nearest({ x: 0, y: 63, z: 0 }, 'overworld', 'farm').area.name, 'wheat_farm');
        assert.equal(store.nearest({ x: 0, y: 63, z: 0 }, 'the_end'), null);
        assert.equal(loaded(path.join(dir, 'other.json')).nearest({ x: 0, y: 0, z: 0 }, 'overworld'), null);
    });

    test('near: areas with a horizontal distance of at most range, nearest first', () => {
        const store = world();
        // x 5.5: the farm (x -6..4, space up to 5) is 0.5 away, home (x -8..0, space up to 1) 4.5 away.
        const pos = { x: 5.5, y: 200, z: 30 };
        assert.deepEqual(store.near(pos, 'overworld', 5).map(a => a.name), ['wheat_farm', 'home']);
        assert.deepEqual(store.near(pos, 'overworld', 4.5).map(a => a.name), ['wheat_farm', 'home'], 'at most range: included');
        assert.deepEqual(store.near(pos, 'overworld', 1).map(a => a.name), ['wheat_farm']);
        assert.deepEqual(store.near(pos, 'overworld', 0.4).map(a => a.name), []);
        assert.deepEqual(store.near({ x: -2, y: 0, z: 30 }, 'overworld', 0).map(a => a.name).sort(), ['home', 'wheat_farm']);
        assert.deepEqual(store.near(pos, 'the_nether', 1000).map(a => a.name), ['nether_base']);
    });
});

describe('module rules', () => {
    test('imports only project files and node built-ins, no mineflayer, no model SDK', () => {
        assertImportRules(MODULE);
    });

    test('imports cleanly: no output, no files', () => {
        assertCleanImport(MODULE);
    });
});
