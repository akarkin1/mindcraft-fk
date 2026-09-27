// Spec v0.1.4.3 W3: src/agent/world/place_store.js -- PlaceStore, a persistent list of named places.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir, listDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const MODULE = 'src/agent/world/place_store.js';
const P = await loadSrc(MODULE);

const T0 = Date.UTC(2026, 8, 21, 8, 30, 0);

let dir;
let file;
let cap;
let clock;
beforeEach(() => {
    dir = makeTmpDir();
    file = path.join(dir, 'places.json');
    cap = captureConsole();
    clock = T0;
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

function newStore(fp = file) {
    assert.equal(typeof P.PlaceStore, 'function', 'PlaceStore must be an exported class');
    return new P.PlaceStore(fp, { now: () => new Date(clock) });
}

function loaded(fp = file) {
    const store = newStore(fp);
    store.load();
    return store;
}

const readFile = () => JSON.parse(fs.readFileSync(file, 'utf8'));

describe('load()', () => {
    test('missing file: returns 0, size 0, list() and names() empty', () => {
        const store = newStore();
        assert.equal(store.load(), 0);
        assert.equal(store.size, 0);
        assert.deepEqual(store.list(), []);
        assert.deepEqual(store.names(), []);
    });

    test('a valid file: returns the number of places', () => {
        fs.writeFileSync(file, JSON.stringify({ version: 1, places: {
            home: { x: 1, y: 64, z: -2, dimension: 'minecraft:overworld', saved_at: '2026-01-01T00:00:00.000Z' },
            mine: { x: 10.5, y: 12, z: 3, dimension: null, saved_at: '2026-01-02T00:00:00.000Z' },
        } }));
        const store = newStore();
        assert.equal(store.load(), 2);
        assert.equal(store.size, 2);
        assert.deepEqual(store.recall('mine'), { x: 10.5, y: 12, z: 3, dimension: null, saved_at: '2026-01-02T00:00:00.000Z' });
    });

    test('entries without finite x, y, z are skipped', () => {
        fs.writeFileSync(file, JSON.stringify({ version: 1, places: {
            good: { x: 1, y: 2, z: 3, dimension: 'minecraft:overworld', saved_at: 'a' },
            string_x: { x: '1', y: 2, z: 3, dimension: null, saved_at: 'a' },
            no_z: { x: 1, y: 2, dimension: null, saved_at: 'a' },
            null_y: { x: 1, y: null, z: 3, dimension: null, saved_at: 'a' },
            not_an_object: 'x',
            nothing: null,
        } }));
        const store = newStore();
        assert.equal(store.load(), 1);
        assert.deepEqual(store.names(), ['good']);
    });

    const CORRUPT = [['invalid JSON', '{"version": 1, "places": {'], ['an empty file', ''], ['an array', '[]']];
    for (const [label, content] of CORRUPT) {
        test(`corrupt file (${label}): no throw, empty, file quarantined by readJsonSafe`, () => {
            fs.writeFileSync(file, content);
            const store = newStore();
            let count;
            assert.doesNotThrow(() => {
                count = store.load();
            });
            assert.equal(count, 0);
            assert.equal(store.size, 0);
            assert.equal(fs.existsSync(file), false, 'places.json moved away');
            const quarantined = listDir(dir).filter((f) => /^places\.corrupt\.\d{8}-\d{6}(-\d+)?\.json$/.test(f));
            assert.equal(quarantined.length, 1, `files: ${listDir(dir)}`);
            assert.equal(fs.readFileSync(path.join(dir, quarantined[0]), 'utf8'), content);
        });
    }

    test('places missing or of the wrong type: no throw, 0 places', () => {
        for (const content of [{ version: 1 }, { version: 1, places: [] }, { version: 1, places: 'x' }]) {
            fs.writeFileSync(file, JSON.stringify(content));
            const store = newStore();
            assert.equal(store.load(), 0, JSON.stringify(content));
        }
    });

    test('path is a directory: no throw, 0 places', () => {
        fs.mkdirSync(file);
        const store = newStore();
        assert.equal(store.load(), 0);
    });
});

describe('remember(name, x, y, z, dimension)', () => {
    test('returns the stored entry and writes the file in the specified format', () => {
        const store = loaded();
        const entry = store.remember('home', 1.5, 64, -3.25, 'minecraft:overworld');
        assert.deepEqual(Object.keys(entry).sort(), ['dimension', 'saved_at', 'x', 'y', 'z']);
        assert.equal(entry.x, 1.5);
        assert.equal(entry.y, 64);
        assert.equal(entry.z, -3.25);
        assert.equal(entry.dimension, 'minecraft:overworld');
        assert.deepEqual(readFile(), { version: 1, places: { home: entry } });
        assert.equal(store.size, 1);
    });

    test('saved_at is the ISO time of the injected clock', () => {
        const store = loaded();
        assert.equal(store.remember('home', 0, 0, 0).saved_at, new Date(T0).toISOString());
    });

    test('name is trimmed', () => {
        const store = loaded();
        store.remember('  base camp  ', 1, 2, 3);
        assert.deepEqual(store.names(), ['base camp']);
        assert.deepEqual(Object.keys(readFile().places), ['base camp']);
    });

    test('name of 1 and of 64 characters (after trimming) is accepted', () => {
        const store = loaded();
        store.remember('a', 1, 2, 3);
        store.remember('  ' + 'n'.repeat(64) + '  ', 1, 2, 3);
        assert.deepEqual(store.names(), ['a', 'n'.repeat(64)]);
    });

    const BAD_NAMES = [['empty', ''], ['blank', '   '], ['65 characters', 'n'.repeat(65)], ['a number', 42], ['null', null], ['undefined', undefined], ['an object', { name: 'x' }]];
    for (const [label, name] of BAD_NAMES) {
        test(`name ${label}: TypeError, nothing stored, no file`, () => {
            const store = loaded();
            assert.equal(typeof store.remember, 'function');
            assert.throws(() => store.remember(name, 1, 2, 3), TypeError);
            assert.equal(store.size, 0);
            assert.equal(fs.existsSync(file), false);
        });
    }

    const BAD_COORDS = [['NaN', [NaN, 1, 1]], ['Infinity', [1, Infinity, 1]], ['-Infinity', [1, 1, -Infinity]], ['a string', ['1', 2, 3]], ['null', [1, null, 3]], ['undefined', [1, 2, undefined]], ['a bigint', [1n, 2, 3]]];
    for (const [label, coords] of BAD_COORDS) {
        test(`coordinate ${label}: TypeError, nothing stored`, () => {
            const store = loaded();
            assert.equal(typeof store.remember, 'function');
            assert.throws(() => store.remember('p', ...coords), TypeError);
            assert.equal(store.size, 0);
        });
    }

    for (const [label, dim, expected] of [['omitted', undefined, null], ['null', null, null], ['empty string', '', null], ['a number', 42, null], ['a string', 'minecraft:the_nether', 'minecraft:the_nether']]) {
        test(`dimension ${label} -> ${expected}`, () => {
            const store = loaded();
            const entry = dim === undefined ? store.remember('p', 1, 2, 3) : store.remember('p', 1, 2, 3, dim);
            assert.equal(entry.dimension, expected);
            assert.equal(readFile().places.p.dimension, expected);
        });
    }

    test('overwrites an existing place of the same name', () => {
        const store = loaded();
        store.remember('home', 1, 2, 3, 'minecraft:overworld');
        clock += 1000;
        store.remember('home', 7, 8, 9, 'minecraft:the_end');
        assert.equal(store.size, 1);
        const got = store.recall('home');
        assert.deepEqual([got.x, got.y, got.z, got.dimension], [7, 8, 9, 'minecraft:the_end']);
        assert.equal(got.saved_at, new Date(T0 + 1000).toISOString());
    });

    test('write failure (parent path is a file): no throw, console.warn, in-memory state updated', () => {
        const blocker = path.join(dir, 'blocker');
        fs.writeFileSync(blocker, 'file');
        const store = loaded(path.join(blocker, 'places.json'));
        let entry;
        assert.doesNotThrow(() => {
            entry = store.remember('home', 1, 2, 3, 'minecraft:overworld');
        });
        assert.equal(entry.x, 1);
        assert.ok(cap.of('warn').length >= 1, 'a console.warn is logged');
        assert.equal(store.recall('home').z, 3);
        assert.equal(store.size, 1);
        assert.doesNotThrow(() => store.forget('home'));
        assert.equal(store.size, 0);
    });
});

describe('recall, forget, list, names, size', () => {
    test('recall(name) returns a copy; changing it does not change the store', () => {
        const store = loaded();
        store.remember('home', 1, 2, 3);
        const copy = store.recall('home');
        copy.x = 999;
        assert.equal(store.recall('home').x, 1);
    });

    test('recall of an unknown name: undefined', () => {
        const store = loaded();
        assert.equal(store.recall('nowhere'), undefined);
    });

    test('forget(name): true if it existed, removed from memory and file; false otherwise', () => {
        const store = loaded();
        store.remember('home', 1, 2, 3);
        store.remember('mine', 4, 5, 6);
        assert.equal(store.forget('home'), true);
        assert.equal(store.recall('home'), undefined);
        assert.deepEqual(Object.keys(readFile().places), ['mine']);
        assert.equal(store.forget('home'), false);
        assert.equal(store.size, 1);
    });

    test('list() gives { name, x, y, z, dimension, saved_at } sorted by name; names() sorted', () => {
        const store = loaded();
        store.remember('zeta', 1, 2, 3, 'minecraft:the_end');
        store.remember('alpha', 4, 5, 6);
        store.remember('mid', 7, 8, 9, 'minecraft:overworld');
        const stamp = new Date(T0).toISOString();
        assert.deepEqual(store.list(), [
            { name: 'alpha', x: 4, y: 5, z: 6, dimension: null, saved_at: stamp },
            { name: 'mid', x: 7, y: 8, z: 9, dimension: 'minecraft:overworld', saved_at: stamp },
            { name: 'zeta', x: 1, y: 2, z: 3, dimension: 'minecraft:the_end', saved_at: stamp },
        ]);
        assert.deepEqual(store.names(), ['alpha', 'mid', 'zeta']);
        assert.equal(store.size, 3);
    });

    test('persistence: a new instance loads what the first one wrote', () => {
        const first = loaded();
        first.remember('home', 1, 2, 3, 'minecraft:overworld');
        first.remember('mine', -4, 5.5, 6);
        first.forget('home');
        first.remember('farm', 0, 70, 0, 'minecraft:overworld');
        const second = newStore();
        assert.equal(second.load(), 2);
        assert.deepEqual(second.list(), first.list());
    });
});

describe('module rules', () => {
    test('imports only node built-ins and project files, nothing from mineflayer or src/models', () => {
        assertImportRules(MODULE);
    });

    test('importing the module prints nothing and creates no files', () => {
        assertCleanImport(MODULE);
    });
});
