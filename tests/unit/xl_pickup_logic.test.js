// v0.1.4.14 (W122 B2): src/agent/packs/home/pickup_logic.js, where the bot stands to pick up an item.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { assertCleanImport, assertImportRules } from '../helpers/module_rules.js';

const T = await loadSrc('src/agent/packs/home/pickup_logic.js');

describe('pickup_logic.js is pure', () => {
    test('no imports, no side effects', () => {
        assertImportRules('src/agent/packs/home/pickup_logic.js', { allowBuiltins: [], allowedRelative: [] });
        assertCleanImport('src/agent/packs/home/pickup_logic.js');
    });
});

describe('pickupStands (v0.1.4.14, W122 B2)', () => {
    // the cells around the row of the fallen trunk at (-8, 65, 93..96) as the server had them: the row cut, oak leaves
    // over it and over the cells to the west, grass with leaf litter to the west, grass and air to the east
    const read = (x, y, z) => {
        if (y <= 63) return 'dirt';
        if (x === -8) return y === 64 ? 'dirt' : y === 65 ? 'air' : y === 66 ? 'oak_leaves' : 'air';
        if (x === -9 || x === -10) return y === 64 ? 'grass_block' : y === 65 ? 'leaf_litter' : y === 66 ? 'oak_leaves' : 'air';
        if (x === -7) return y === 64 ? 'grass_block' : 'air';
        return y === 64 ? 'grass_block' : 'air';
    };

    test('the log the bot left lying: no free cell holds it; the cells of the row and to the west, with the leaf above', () => {
        const stands = T.pickupStands(read, { x: -8.38, y: 65, z: 94.81 }, { x: -6.5, y: 65, z: 94.5 });
        assert.ok(stands.length > 0);
        assert.ok(stands.every(s => s.dig && s.dig.y === 66 && s.dig.x === s.x && s.dig.z === s.z), JSON.stringify(stands));
        assert.ok(stands.every(s => s.x <= -8), 'not from the free cells to the east, 1.9 blocks away');
        assert.deepEqual({ x: stands[0].x, y: stands[0].y, z: stands[0].z }, { x: -8, y: 65, z: 94 }, 'the nearest first');
    });

    test('a log beside a free cell: that cell first, without a leaf', () => {
        const stands = T.pickupStands(read, { x: -7.67, y: 65, z: 93.73 }, { x: -6.5, y: 65, z: 96.5 });
        assert.equal(stands[0].dig, null);
        assert.equal(stands[0].x, -7);
        assert.equal(T.pickupStands(read, null).length, 0);
    });
});

describe('pickupStands: the pickup range', () => {
    const flat = (x, y) => (y <= 63 ? 'grass_block' : 'air');
    test('only cells within 1.3 sideways and with the item 0.7 below to 2.2 above the feet', () => {
        const stands = T.pickupStands(flat, { x: 0.5, y: 64, z: 0.5 }, { x: 0.5, y: 64, z: 0.5 });
        assert.equal(stands.length, 9);
        assert.ok(stands.every(s => s.y === 64 && s.dig === null));
        assert.deepEqual({ x: stands[0].x, z: stands[0].z }, { x: 0, z: 0 });
        assert.equal(T.pickupStands(flat, { x: 1.85, y: 64, z: 0.5 }).filter(s => s.x === 0).length, 0, '1.35 blocks off');
        assert.equal(T.pickupStands(flat, { x: 0.5, y: 63.2, z: 0.5 }).length, 0, 'the feet 0.8 above the item');
        assert.equal(T.pickupStands(() => { throw new Error('x'); }, { x: 0, y: 64, z: 0 }).length, 0);
        assert.equal(T.PICKUP_SIDE, 1.3);
    });
});
