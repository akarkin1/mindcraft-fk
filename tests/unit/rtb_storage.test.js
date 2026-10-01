// Fix round of v0.1.4.9 (F32 b, engineer E2): recordChest of the storage pack updates the chest index from
// a list of items (the glue calls it after !viewChest, so that a chest the player showed is known).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const S = await loadSrc('src/agent/packs/storage/index.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

describe('recordChest(ctx, pos, items)', () => {
    test('a list or counts by name; the free slots the index knew stay; never throws', () => {
        const chests = new S.ChestIndex(null, { now: () => new Date('2026-10-01T10:00:00Z') });
        const ctx = { chests };
        const r = S.recordChest(ctx, { x: 12.4, y: 67, z: 53 }, [{ name: 'oak_log', count: 19 }, { name: 'coal', count: 1 }, { name: 'minecraft:oak_log', count: 1 }, { name: 'air', count: 0 }]);
        assert.equal(r.ok, true);
        assert.deepEqual(chests.get({ x: 12, y: 67, z: 53 }).items, { oak_log: 20, coal: 1 });
        assert.equal(chests.find('coal').length, 1, 'fetchItem finds it');
        chests.update({ x: 12, y: 67, z: 53, kind: 'chest', items: {}, free_slots: 7 });
        S.recordChest(ctx, { x: 12, y: 67, z: 53 }, { torch: 16 });
        assert.deepEqual([chests.get({ x: 12, y: 67, z: 53 }).items, chests.get({ x: 12, y: 67, z: 53 }).free_slots], [{ torch: 16 }, 7]);
        assert.equal(S.recordChest({}, { x: 0, y: 0, z: 0 }, []).reason, 'no_index');
        assert.equal(S.recordChest(ctx, { x: 'a' }, []).reason, 'bad_position');
        assert.equal(S.recordChest({ chests: { update() { throw new Error('x'); }, list: () => [] } }, { x: 0, y: 0, z: 0 }, []).reason, 'error');
    });
});
