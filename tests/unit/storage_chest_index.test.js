// Spec v0.1.4.7 S1: src/agent/packs/storage/chest_index.js -- ChestIndex, the chests of one world
// and what they hold, persisted as { version: 1, chests: { "<x>,<y>,<z>": chest } }.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir, listDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

const I = await loadSrc('src/agent/packs/storage/chest_index.js');

const T0 = Date.UTC(2026, 8, 28, 10, 0, 0);

let dir;
let file;
let cap;
let clock;
beforeEach(() => {
    dir = makeTmpDir();
    file = path.join(dir, 'chests.json');
    cap = captureConsole();
    clock = T0;
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

function newIndex(fp = file) {
    return new I.ChestIndex(fp, { now: () => new Date(clock) });
}

function chest(x, y, z, items = {}, free = 27, extra = {}) {
    return { x, y, z, dimension: 'overworld', kind: 'chest', items, free_slots: free, ...extra };
}

function readFile() {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

describe('update and the file', () => {
    test('update creates a chest, returns a copy and writes the file', () => {
        const index = newIndex();
        assert.equal(index.load(), 0);
        const saved = index.update(chest(-13, 63, 28, { wheat: 12, wheat_seeds: 3 }, 4));
        assert.deepEqual(saved, {
            x: -13, y: 63, z: 28, dimension: 'overworld', kind: 'chest', items: { wheat: 12, wheat_seeds: 3 }, free_slots: 4,
            seen: new Date(T0).toISOString(),
        });
        saved.items.wheat = 99;
        assert.equal(index.get({ x: -13, y: 63, z: 28 }).items.wheat, 12);
        assert.deepEqual(readFile(), { version: 1, chests: { '-13,63,28': index.get({ x: -13, y: 63, z: 28 }) } });
        assert.equal(index.size, 1);
    });

    test('update replaces the chest at the same place; coordinates are floored', () => {
        const index = newIndex();
        index.update(chest(1, 64, 2, { dirt: 5 }, 20));
        clock += 60000;
        const again = index.update(chest(1.7, 64.2, 2.9, { stone: 1 }, 26, { kind: 'barrel', dimension: 'minecraft:overworld' }));
        assert.equal(index.size, 1);
        assert.deepEqual(again.items, { stone: 1 });
        assert.equal(again.kind, 'barrel');
        assert.equal(again.dimension, 'overworld');
        assert.equal(again.seen, new Date(clock).toISOString());
    });

    test('update keeps a given seen time and cleans the items', () => {
        const index = newIndex(null);
        const saved = index.update(chest(0, 64, 0, { dirt: 3.9, '': 2, stone: 0, sand: -1, gravel: 'x', 'minecraft:clay': 2 }, 3.5,
            { seen: '2026-01-01T00:00:00.000Z', dimension: undefined }));
        assert.deepEqual(saved.items, { dirt: 3, clay: 2 });
        assert.equal(saved.free_slots, 3);
        assert.equal(saved.seen, '2026-01-01T00:00:00.000Z');
        assert.equal(saved.dimension, 'overworld');
        const bad = index.update(chest(1, 64, 0, null, -2));
        assert.deepEqual(bad.items, {});
        assert.equal(bad.free_slots, 0);
    });

    test('update throws for a bad position or kind', () => {
        const index = newIndex(null);
        assert.throws(() => index.update(null), TypeError);
        assert.throws(() => index.update(chest(1, 'a', 2)), TypeError);
        assert.throws(() => index.update(chest(1, 2, 3, {}, 1, { kind: 'furnace' })), TypeError);
        assert.equal(index.size, 0);
    });

    test('load reads the file back', () => {
        const a = newIndex();
        a.update(chest(3, 64, 0, { bread: 5 }, 26));
        a.update(chest(-2, 70, 9, {}, 27, { dimension: 'the_nether', kind: 'trapped_chest' }));
        const b = newIndex();
        assert.equal(b.load(), 2);
        assert.deepEqual(b.list(), a.list());
    });

    test('without a file path the index lives in memory only', () => {
        const index = new I.ChestIndex(null);
        assert.equal(index.load(), 0);
        index.update(chest(1, 2, 3));
        assert.equal(index.remove({ x: 1, y: 2, z: 3 }), true);
        assert.deepEqual(listDir(dir), []);
        assert.equal(typeof new I.ChestIndex(undefined).update(chest(1, 2, 3)).seen, 'string');
    });

    test('a missing file is empty; a corrupt file is set aside; load never throws', () => {
        assert.equal(newIndex(path.join(dir, 'none.json')).load(), 0);
        fs.writeFileSync(file, '{ not json');
        const index = newIndex();
        assert.equal(index.load(), 0);
        assert.ok(cap.of('warn').some(r => r.text.includes('could not be read')));
        assert.ok(!fs.existsSync(file));
    });

    test('invalid entries are skipped; the key comes from the coordinates', () => {
        fs.writeFileSync(file, JSON.stringify({
            version: 1,
            chests: {
                'wrong,key': chest(5, 64, 5, { dirt: 2 }, 10),
                '1,1,1': { x: 1, y: 'a', z: 1, kind: 'chest' },
                '2,2,2': { x: 2, y: 2, z: 2, kind: 'furnace' },
                '3,3,3': 'x',
                '4,4,4': { x: 4, y: 4, z: 4, kind: 'barrel', items: [1, 2], free_slots: 'n', seen: 5 },
            },
        }));
        const index = newIndex();
        assert.equal(index.load(), 2);
        assert.deepEqual(index.get({ x: 5, y: 64, z: 5 }).items, { dirt: 2 });
        const barrel = index.get({ x: 4, y: 4, z: 4 });
        assert.deepEqual(barrel.items, {});
        assert.equal(barrel.free_slots, 0);
        assert.equal(barrel.seen, null);
    });

    test('a file without a chests object starts empty', () => {
        fs.writeFileSync(file, JSON.stringify({ version: 1, chests: [] }));
        assert.equal(newIndex().load(), 0);
        fs.writeFileSync(file, JSON.stringify({ version: 1 }));
        assert.equal(newIndex().load(), 0);
    });

    test('a failed write warns and does not throw', () => {
        const blocker = path.join(dir, 'a_file');
        fs.writeFileSync(blocker, 'x');
        const index = newIndex(path.join(blocker, 'chests.json'));
        assert.doesNotThrow(() => index.update(chest(1, 2, 3)));
        assert.equal(index.size, 1);
        assert.ok(cap.of('warn').some(r => r.text.includes('Could not write the chest file')));
    });
});

describe('queries', () => {
    let index;
    beforeEach(() => {
        index = newIndex(null);
        index.update(chest(5, 64, 0, { wheat: 12, bread: 3 }, 4));
        index.update(chest(-3, 64, 7, { bread: 20 }, 0));
        index.update(chest(-3, 60, 7, { bread: 5, dirt: 64 }, 10));
        index.update(chest(0, 64, 0, {}, 27, { kind: 'barrel' }));
        index.update(chest(1, 40, 1, { bread: 64 }, 2, { dimension: 'the_nether' }));
    });

    test('list(dimension) sorted by x, y, z; list() lists all', () => {
        assert.deepEqual(index.list('overworld').map(I.chestKey), ['-3,60,7', '-3,64,7', '0,64,0', '5,64,0']);
        assert.deepEqual(index.list('minecraft:the_nether').map(I.chestKey), ['1,40,1']);
        assert.equal(index.list().length, 5);
        assert.equal(index.list('the_end').length, 0);
    });

    test('find(item, dimension): chests that hold it, most first', () => {
        assert.deepEqual(index.find('bread', 'overworld').map(I.chestKey), ['-3,64,7', '-3,60,7', '5,64,0']);
        assert.deepEqual(index.find('minecraft:bread', 'the_nether').map(I.chestKey), ['1,40,1']);
        assert.deepEqual(index.find('diamond', 'overworld'), []);
        assert.deepEqual(index.find('', 'overworld'), []);
    });

    test('withSpace(dimension): at least one free slot', () => {
        assert.deepEqual(index.withSpace('overworld').map(I.chestKey), ['-3,60,7', '0,64,0', '5,64,0']);
    });

    test('nearest(pos, dimension, test)', () => {
        const me = { x: 4, y: 64, z: 1 };
        assert.equal(I.chestKey(index.nearest(me, 'overworld')), '5,64,0');
        assert.equal(I.chestKey(index.nearest(me, 'overworld', c => (c.items.bread ?? 0) >= 5)), '-3,64,7');
        assert.equal(I.chestKey(index.nearest(me, 'overworld', c => c.items.dirt > 0)), '-3,60,7');
        assert.equal(I.chestKey(index.nearest(me, 'the_nether')), '1,40,1');
        assert.equal(index.nearest(me, 'overworld', c => c.items.diamond > 0), null);
        assert.equal(index.nearest(null, 'overworld'), null);
        assert.equal(I.chestKey(index.nearest(me, 'overworld', () => { throw new Error('bad test'); })), null);
    });

    test('get and remove', () => {
        assert.equal(index.get({ x: 9, y: 9, z: 9 }), null);
        assert.equal(index.get(null), null);
        assert.equal(index.remove({ x: 5.5, y: 64, z: 0.2 }), true);
        assert.equal(index.remove({ x: 5, y: 64, z: 0 }), false);
        assert.equal(index.remove(null), false);
        assert.equal(index.size, 4);
    });

    test('results are copies', () => {
        index.list()[0].items.bread = 1000;
        index.find('bread', 'overworld')[0].items.bread = 1000;
        assert.equal(index.get({ x: -3, y: 64, z: 7 }).items.bread, 20);
    });
});

test('CHEST_FILE is the name of the file in the world folder', () => {
    assert.equal(I.CHEST_FILE, 'chests.json');
});
