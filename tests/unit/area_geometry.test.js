// Spec v0.1.4.6 A1: src/agent/areas/area_geometry.js -- boxes of whole blocks, both ends included.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const MODULE = 'src/agent/areas/area_geometry.js';
const G = await loadSrc(MODULE);

const box = (x1, y1, z1, x2, y2, z2) => ({ min: { x: x1, y: y1, z: z1 }, max: { x: x2, y: y2, z: z2 } });

describe('normalizeBox(a, b)', () => {
    test('corners in any order give the same box', () => {
        const expected = box(-8, 62, 25, 0, 67, 31);
        assert.deepEqual(G.normalizeBox({ x: -8, y: 62, z: 25 }, { x: 0, y: 67, z: 31 }), expected);
        assert.deepEqual(G.normalizeBox({ x: 0, y: 67, z: 31 }, { x: -8, y: 62, z: 25 }), expected);
        assert.deepEqual(G.normalizeBox({ x: 0, y: 62, z: 31 }, { x: -8, y: 67, z: 25 }), expected);
    });

    test('fractional corners are floored (a position belongs to the block floor(x), floor(y), floor(z))', () => {
        assert.deepEqual(G.normalizeBox({ x: -7.5, y: 62.9, z: 25.1 }, { x: 0.99, y: 67.2, z: 31.5 }), box(-8, 62, 25, 0, 67, 31));
    });

    test('a single block is a box of size 1', () => {
        const b = G.normalizeBox({ x: 3, y: 4, z: 5 }, { x: 3, y: 4, z: 5 });
        assert.deepEqual(G.boxSize(b), { x: 1, y: 1, z: 1 });
    });

    test('the result is a new object, the inputs are not changed', () => {
        const a = { x: 5, y: 5, z: 5 };
        const b = { x: 1, y: 1, z: 1 };
        const result = G.normalizeBox(a, b);
        assert.deepEqual(a, { x: 5, y: 5, z: 5 });
        assert.deepEqual(b, { x: 1, y: 1, z: 1 });
        assert.notEqual(result.min, b);
    });

    test('corners that are not finite numbers throw a TypeError', () => {
        assert.throws(() => G.normalizeBox({ x: 0, y: 0, z: 0 }, { x: NaN, y: 0, z: 0 }), TypeError);
        assert.throws(() => G.normalizeBox({ x: 0, y: 0, z: 0 }, null), TypeError);
        assert.throws(() => G.normalizeBox({ x: '1', y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), TypeError);
        assert.throws(() => G.normalizeBox({ x: Infinity, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), TypeError);
    });
});

describe('isValidBox(box)', () => {
    test('whole numbers with min <= max are valid', () => {
        assert.equal(G.isValidBox(box(0, 0, 0, 0, 0, 0)), true);
        assert.equal(G.isValidBox(box(-5, 60, -5, 5, 70, 5)), true);
    });

    test('fractions, inverted corners and missing parts are invalid', () => {
        assert.equal(G.isValidBox(box(0.5, 0, 0, 1, 1, 1)), false);
        assert.equal(G.isValidBox(box(2, 0, 0, 1, 1, 1)), false);
        assert.equal(G.isValidBox({ min: { x: 0, y: 0, z: 0 } }), false);
        assert.equal(G.isValidBox(null), false);
        assert.equal(G.isValidBox('box'), false);
    });
});

describe('contains(box, pos)', () => {
    const b = box(0, 60, 0, 4, 64, 4);

    test('both ends are included', () => {
        assert.equal(G.contains(b, { x: 0, y: 60, z: 0 }), true);
        assert.equal(G.contains(b, { x: 4, y: 64, z: 4 }), true);
        assert.equal(G.contains(b, { x: 2, y: 62, z: 3 }), true);
    });

    test('a fractional position belongs to its floored block', () => {
        assert.equal(G.contains(b, { x: 4.99, y: 64.5, z: 0.01 }), true);
        assert.equal(G.contains(b, { x: -0.01, y: 62, z: 2 }), false, 'x -0.01 is block -1');
        assert.equal(G.contains(b, { x: 5, y: 62, z: 2 }), false);
    });

    test('outside on every axis', () => {
        assert.equal(G.contains(b, { x: 2, y: 59, z: 2 }), false);
        assert.equal(G.contains(b, { x: 2, y: 65, z: 2 }), false);
        assert.equal(G.contains(b, { x: 2, y: 62, z: -1 }), false);
        assert.equal(G.contains(b, { x: 2, y: 62, z: 5 }), false);
    });

    test('invalid input gives false instead of throwing', () => {
        assert.equal(G.contains(null, { x: 0, y: 0, z: 0 }), false);
        assert.equal(G.contains(b, null), false);
        assert.equal(G.contains(b, { x: NaN, y: 62, z: 2 }), false);
    });
});

describe('distanceToBox(box, pos) and horizontalDistanceToBox(box, pos)', () => {
    // The box covers the space from min to max + 1 on every axis.
    const b = box(0, 60, 0, 4, 64, 4);

    test('0 inside, also at fractional positions inside', () => {
        assert.equal(G.distanceToBox(b, { x: 2, y: 62, z: 2 }), 0);
        assert.equal(G.distanceToBox(b, { x: 4.9, y: 64.9, z: 0.1 }), 0);
        assert.equal(G.horizontalDistanceToBox(b, { x: 2.5, y: 200, z: 2.5 }), 0);
    });

    test('straight distance to the nearest point, in blocks', () => {
        assert.equal(G.distanceToBox(b, { x: 8, y: 62, z: 2 }), 3, 'the box ends at x = 5');
        assert.equal(G.distanceToBox(b, { x: -3, y: 62, z: 2 }), 3);
        assert.equal(G.distanceToBox(b, { x: 2, y: 55, z: 2 }), 5);
        assert.equal(G.distanceToBox(b, { x: 8, y: 69, z: 2 }), 5, '3-4-5 triangle');
        assert.ok(Math.abs(G.distanceToBox(b, { x: -1, y: 59, z: -1 }) - Math.sqrt(3)) < 1e-9);
    });

    test('the horizontal distance leaves out y', () => {
        assert.equal(G.horizontalDistanceToBox(b, { x: 8, y: 0, z: 2 }), 3);
        assert.equal(G.horizontalDistanceToBox(b, { x: 8, y: 62, z: 9 }), 5);
        assert.equal(G.distanceToBox(b, { x: 8, y: 0, z: 2 }) > 3, true);
    });

    test('invalid input gives Infinity', () => {
        assert.equal(G.distanceToBox(null, { x: 0, y: 0, z: 0 }), Infinity);
        assert.equal(G.horizontalDistanceToBox(b, { x: NaN, y: 0, z: 0 }), Infinity);
    });
});

describe('boxSize, center, expand', () => {
    const b = box(-8, 62, 25, 0, 67, 31);

    test('boxSize counts blocks, both ends included', () => {
        assert.deepEqual(G.boxSize(b), { x: 9, y: 6, z: 7 });
    });

    test('center is the middle of the space the box covers', () => {
        assert.deepEqual(G.center(b), { x: -3.5, y: 65, z: 28.5 });
        assert.deepEqual(G.center(box(0, 0, 0, 0, 0, 0)), { x: 0.5, y: 0.5, z: 0.5 });
        assert.equal(G.contains(b, G.center(b)), true);
    });

    test('expand grows every side by n and returns a new box', () => {
        const grown = G.expand(b, 2);
        assert.deepEqual(grown, box(-10, 60, 23, 2, 69, 33));
        assert.deepEqual(b, box(-8, 62, 25, 0, 67, 31), 'the input is not changed');
        assert.deepEqual(G.expand(b, 0), b);
    });

    test('expand with a negative n shrinks, but never below one block per axis', () => {
        assert.deepEqual(G.expand(b, -1), box(-7, 63, 26, -1, 66, 30));
        const tiny = G.expand(box(0, 0, 0, 2, 0, 3), -5);
        assert.equal(G.isValidBox(tiny), true);
        assert.deepEqual(G.boxSize(tiny), { x: 1, y: 1, z: 1 });
    });

    test('expand with a fraction uses the whole part; invalid n throws a TypeError', () => {
        assert.deepEqual(G.expand(b, 1.7), G.expand(b, 1));
        assert.throws(() => G.expand(b, NaN), TypeError);
        assert.throws(() => G.expand(null, 1), TypeError);
    });
});

describe('module rules (pure module)', () => {
    test('imports nothing but node built-ins and project files, no mineflayer, no model SDK', () => {
        assertImportRules(MODULE);
    });

    test('imports cleanly: no output, no files', () => {
        assertCleanImport(MODULE);
    });
});
