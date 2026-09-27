// Spec v0.1.4.3 W4: src/agent/memory_bank.js -- behaviour without a store (as in v0.1.4.2) and
// with an attached PlaceStore (W3).
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

const M = await loadSrc('src/agent/memory_bank.js');
const P = await loadSrc('src/agent/world/place_store.js');

let dir;
let file;
let cap;
beforeEach(() => {
    dir = makeTmpDir();
    file = path.join(dir, 'places.json');
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

const newBank = () => new M.MemoryBank();

function loadedStore(fp = file) {
    assert.equal(typeof P.PlaceStore, 'function', 'PlaceStore must be an exported class');
    const store = new P.PlaceStore(fp, { now: () => new Date(Date.UTC(2026, 0, 1)) });
    store.load();
    return store;
}

const fileNames = () => Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).places).sort();

describe('without a store: behaviour of v0.1.4.2', () => {
    test('rememberPlace / recallPlace return [x, y, z]; unknown name: undefined', () => {
        const bank = newBank();
        bank.rememberPlace('home', 1, 2, 3);
        assert.deepEqual(bank.recallPlace('home'), [1, 2, 3]);
        assert.equal(bank.recallPlace('nowhere'), undefined);
    });

    test('getJson() / loadJson(json) round trip', () => {
        const bank = newBank();
        bank.rememberPlace('home', 1, 2, 3);
        bank.rememberPlace('mine', 4, 5, 6);
        assert.deepEqual(bank.getJson(), { home: [1, 2, 3], mine: [4, 5, 6] });
        const other = newBank();
        other.loadJson({ farm: [7, 8, 9] });
        assert.deepEqual(other.recallPlace('farm'), [7, 8, 9]);
        assert.equal(other.getKeys(), 'farm');
    });

    test('getKeys(): names joined with ", " in insertion order; empty -> ""', () => {
        const bank = newBank();
        assert.equal(bank.getKeys(), '');
        bank.rememberPlace('zeta', 0, 0, 0);
        bank.rememberPlace('alpha', 0, 0, 0);
        assert.equal(bank.getKeys(), 'zeta, alpha');
    });

    test('a fifth argument does not change the RAM format', () => {
        const bank = newBank();
        bank.rememberPlace('home', 1, 2, 3, 'minecraft:the_nether');
        assert.deepEqual(bank.recallPlace('home'), [1, 2, 3]);
    });

    test('rememberPlace returns undefined without a store (Amendment 1, M2)', () => {
        const bank = newBank();
        assert.equal(bank.rememberPlace('home', 1, 2, 3), undefined);
    });

    test('hasStore is false', () => {
        assert.equal(newBank().hasStore, false);
    });

    test('recallPlaceInfo(name): { x, y, z, dimension: null }, even when a dimension was passed; unknown: undefined', () => {
        const bank = newBank();
        bank.rememberPlace('home', 1, 2, 3);
        bank.rememberPlace('hell', 4, 5, 6, 'minecraft:the_nether');
        assert.deepEqual(bank.recallPlaceInfo('home'), { x: 1, y: 2, z: 3, dimension: null });
        assert.deepEqual(bank.recallPlaceInfo('hell'), { x: 4, y: 5, z: 6, dimension: null });
        assert.equal(bank.recallPlaceInfo('nowhere'), undefined);
    });

    test('forgetPlace(name): true if it existed, then gone; false otherwise', () => {
        const bank = newBank();
        bank.rememberPlace('home', 1, 2, 3);
        bank.rememberPlace('mine', 4, 5, 6);
        assert.equal(bank.forgetPlace('home'), true);
        assert.equal(bank.recallPlace('home'), undefined);
        assert.equal(bank.getKeys(), 'mine');
        assert.equal(bank.forgetPlace('home'), false);
    });

    test('describePlaces(): names joined with ", "; no places: "none"', () => {
        const bank = newBank();
        assert.equal(bank.describePlaces(), 'none');
        bank.rememberPlace('alpha', 1, 2, 3);
        bank.rememberPlace('beta', 4, 5, 6);
        assert.equal(bank.describePlaces(), 'alpha, beta');
    });
});

describe('attachStore(store, getDimension)', () => {
    test('hasStore becomes true', () => {
        const bank = newBank();
        bank.attachStore(loadedStore());
        assert.equal(bank.hasStore, true);
    });

    test('places in RAM are written to the store unless the store has that name', () => {
        const store0 = loadedStore();
        store0.remember('home', 7, 8, 9, 'minecraft:overworld');
        const bank = newBank();
        bank.rememberPlace('home', 1, 2, 3);
        bank.rememberPlace('mine', 4, 5, 6);
        const store = loadedStore();
        bank.attachStore(store);
        const home = store.recall('home');
        assert.deepEqual([home.x, home.y, home.z, home.dimension], [7, 8, 9, 'minecraft:overworld'], 'store version wins');
        const mine = store.recall('mine');
        assert.deepEqual([mine.x, mine.y, mine.z], [4, 5, 6]);
        assert.deepEqual(fileNames(), ['home', 'mine'], 'merged place is written to the file');
        assert.deepEqual(bank.recallPlace('home'), [7, 8, 9]);
    });

    test('every read goes through the store: a place added to the store directly is visible', () => {
        const bank = newBank();
        const store = loadedStore();
        bank.attachStore(store);
        store.remember('direct', 1, 2, 3, 'minecraft:the_end');
        assert.deepEqual(bank.recallPlace('direct'), [1, 2, 3]);
        assert.deepEqual(bank.recallPlaceInfo('direct'), { x: 1, y: 2, z: 3, dimension: 'minecraft:the_end' });
    });

    test('rememberPlace writes to the store and to its file', () => {
        const bank = newBank();
        bank.attachStore(loadedStore());
        bank.rememberPlace('home', 1, 2, 3, 'minecraft:overworld');
        const again = loadedStore();
        const home = again.recall('home');
        assert.deepEqual([home.x, home.y, home.z, home.dimension], [1, 2, 3, 'minecraft:overworld']);
    });

    test('dimension: explicit argument wins over getDimension', () => {
        const bank = newBank();
        bank.attachStore(loadedStore(), () => 'minecraft:overworld');
        bank.rememberPlace('hell', 1, 2, 3, 'minecraft:the_nether');
        assert.equal(bank.recallPlaceInfo('hell').dimension, 'minecraft:the_nether');
    });

    test('dimension undefined: result of getDimension is used', () => {
        const bank = newBank();
        let calls = 0;
        bank.attachStore(loadedStore(), () => {
            calls++;
            return 'minecraft:the_end';
        });
        bank.rememberPlace('end', 1, 2, 3);
        assert.equal(bank.recallPlaceInfo('end').dimension, 'minecraft:the_end');
        assert.ok(calls >= 1);
    });

    test('dimension null passed explicitly: stored as null, getDimension is not used', () => {
        const bank = newBank();
        bank.attachStore(loadedStore(), () => 'minecraft:the_end');
        bank.rememberPlace('p', 1, 2, 3, null);
        assert.equal(bank.recallPlaceInfo('p').dimension, null);
    });

    test('getDimension throws: dimension null, no throw', () => {
        const bank = newBank();
        bank.attachStore(loadedStore(), () => {
            throw new Error('no game yet');
        });
        assert.doesNotThrow(() => bank.rememberPlace('p', 1, 2, 3));
        assert.equal(bank.recallPlaceInfo('p').dimension, null);
    });

    test('no getDimension and no argument: dimension null', () => {
        const bank = newBank();
        bank.attachStore(loadedStore());
        bank.rememberPlace('p', 1, 2, 3);
        assert.equal(bank.recallPlaceInfo('p').dimension, null);
    });

    test('rememberPlace returns true when the store stored the place (Amendment 1, M2)', () => {
        const bank = newBank();
        bank.attachStore(loadedStore());
        assert.equal(bank.rememberPlace('home', 1, 2, 3, 'minecraft:overworld'), true);
        assert.equal(bank.rememberPlace('home', 4, 5, 6), true, 'overwrite');
    });

    const REFUSED = [['empty name', ['', 1, 2, 3]], ['blank name', ['   ', 1, 2, 3]], ['65-character name', ['n'.repeat(65), 1, 2, 3]], ['NaN coordinate', ['p', NaN, 2, 3]], ['string coordinate', ['p', 1, '2', 3]]];
    for (const [label, args] of REFUSED) {
        test(`rememberPlace returns false when the store refuses (${label}), no throw, nothing stored (Amendment 1, M2)`, () => {
            const bank = newBank();
            bank.attachStore(loadedStore());
            let result;
            assert.doesNotThrow(() => {
                result = bank.rememberPlace(...args);
            });
            assert.equal(result, false);
            assert.equal(bank.getKeys(), '');
            assert.equal(fs.existsSync(file), false);
        });
    }

    test('recallPlace: [x, y, z] or undefined', () => {
        const bank = newBank();
        bank.attachStore(loadedStore());
        bank.rememberPlace('home', 1, 2, 3, 'minecraft:overworld');
        assert.deepEqual(bank.recallPlace('home'), [1, 2, 3]);
        assert.equal(bank.recallPlace('nowhere'), undefined);
        assert.equal(bank.recallPlaceInfo('nowhere'), undefined);
    });

    test('forgetPlace: true if it existed, removed from store and file; false otherwise', () => {
        const bank = newBank();
        const store = loadedStore();
        bank.attachStore(store);
        bank.rememberPlace('home', 1, 2, 3);
        bank.rememberPlace('mine', 4, 5, 6);
        assert.equal(bank.forgetPlace('home'), true);
        assert.equal(store.recall('home'), undefined);
        assert.deepEqual(fileNames(), ['mine']);
        assert.equal(bank.forgetPlace('home'), false);
    });

    test('getKeys() with a store: sorted names joined with ", "', () => {
        const bank = newBank();
        bank.attachStore(loadedStore());
        bank.rememberPlace('zeta', 0, 0, 0);
        bank.rememberPlace('alpha', 0, 0, 0);
        bank.rememberPlace('mid', 0, 0, 0);
        assert.equal(bank.getKeys(), 'alpha, mid, zeta');
    });

    test('describePlaces() with a store: "name (dimension)" for places with a dimension; none: "none"', () => {
        const bank = newBank();
        bank.attachStore(loadedStore());
        assert.equal(bank.describePlaces(), 'none');
        bank.rememberPlace('alpha', 1, 2, 3, 'minecraft:overworld');
        bank.rememberPlace('beta', 4, 5, 6, null);
        bank.rememberPlace('gamma', 7, 8, 9, 'minecraft:the_nether');
        assert.equal(bank.describePlaces(), 'alpha (minecraft:overworld), beta, gamma (minecraft:the_nether)');
    });

    test('places from the store file are available right after attaching (persistence across instances)', () => {
        const first = newBank();
        first.attachStore(loadedStore());
        first.rememberPlace('home', 1, 2, 3, 'minecraft:overworld');
        const second = newBank();
        second.attachStore(loadedStore());
        assert.deepEqual(second.recallPlace('home'), [1, 2, 3]);
        assert.equal(second.describePlaces(), 'home (minecraft:overworld)');
    });

    test('write failure of the store does not throw through the bank', () => {
        const blocker = path.join(dir, 'blocker');
        fs.writeFileSync(blocker, 'file');
        const bank = newBank();
        bank.attachStore(loadedStore(path.join(blocker, 'places.json')));
        assert.doesNotThrow(() => bank.rememberPlace('home', 1, 2, 3, 'minecraft:overworld'));
        assert.deepEqual(bank.recallPlace('home'), [1, 2, 3]);
        assert.doesNotThrow(() => bank.forgetPlace('home'));
    });
});
