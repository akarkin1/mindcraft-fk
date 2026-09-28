// Spec v0.1.4.6 H (home pack): src/agent/packs/home/box_math.js -- pure geometry of area boxes.
// A box is { min, max } of whole block coordinates, both ends included (spec A1).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const G = await loadSrc('src/agent/packs/home/box_math.js');

const box = (x1, y1, z1, x2, y2, z2) => ({ min: { x: x1, y: y1, z: z1 }, max: { x: x2, y: y2, z: z2 } });
const HOUSE = box(0, 63, 0, 8, 69, 8);

describe('isBox and floorPos', () => {
    test('valid and invalid boxes', () => {
        assert.equal(G.isBox(HOUSE), true);
        assert.equal(G.isBox(null), false);
        assert.equal(G.isBox({ min: { x: 0, y: 0, z: 0 } }), false);
        assert.equal(G.isBox({ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: NaN, z: 1 } }), false);
        assert.equal(G.isBox({ min: { x: 2, y: 0, z: 0 }, max: { x: 1, y: 0, z: 0 } }), false, 'min above max');
    });

    test('floorPos floors every axis, rejects garbage', () => {
        assert.deepEqual(G.floorPos({ x: 1.7, y: -0.2, z: -3.5 }), { x: 1, y: -1, z: -4 });
        assert.equal(G.floorPos(null), null);
        assert.equal(G.floorPos({ x: 1, y: 'a', z: 2 }), null);
    });
});

describe('containsPos', () => {
    test('both ends are included, a position belongs to its floored block', () => {
        assert.equal(G.containsPos(HOUSE, { x: 0, y: 63, z: 0 }), true);
        assert.equal(G.containsPos(HOUSE, { x: 8.99, y: 69.5, z: 8.99 }), true);
        assert.equal(G.containsPos(HOUSE, { x: 9, y: 64, z: 4 }), false);
        assert.equal(G.containsPos(HOUSE, { x: -0.01, y: 64, z: 4 }), false);
        assert.equal(G.containsPos(HOUSE, { x: 4, y: 70, z: 4 }), false);
    });

    test('invalid input: false', () => {
        assert.equal(G.containsPos(null, { x: 0, y: 0, z: 0 }), false);
        assert.equal(G.containsPos(HOUSE, null), false);
    });
});

describe('distances', () => {
    test('distanceToBox is 0 inside and the straight distance outside', () => {
        assert.equal(G.distanceToBox(HOUSE, { x: 4, y: 64, z: 4 }), 0);
        assert.equal(G.distanceToBox(HOUSE, { x: 12, y: 64, z: 4.5 }), 3, 'box covers x up to 9 (block 8 included)');
        assert.equal(G.distanceToBox(HOUSE, { x: -3, y: 64, z: 4 }), 3);
        assert.ok(Math.abs(G.distanceToBox(HOUSE, { x: 12, y: 64, z: 13 }) - 5) < 1e-9, '3-4-5 corner');
        assert.equal(G.distanceToBox(HOUSE, { x: 4, y: 80, z: 4 }), 10);
        assert.equal(G.distanceToBox(null, { x: 0, y: 0, z: 0 }), Infinity);
    });

    test('horizontalDistanceToBox ignores y', () => {
        assert.equal(G.horizontalDistanceToBox(HOUSE, { x: 4, y: 200, z: 4 }), 0);
        assert.equal(G.horizontalDistanceToBox(HOUSE, { x: 13, y: 0, z: 4 }), 4);
        assert.equal(G.horizontalDistanceToBox(undefined, { x: 13, y: 0, z: 4 }), Infinity);
    });

    test('nearestPointOnBox clamps into the box', () => {
        assert.deepEqual(G.nearestPointOnBox(HOUSE, { x: 20, y: 64, z: 4 }), { x: 9, y: 64, z: 4 });
        assert.deepEqual(G.nearestPointOnBox(HOUSE, { x: 4, y: 64, z: 4 }), { x: 4, y: 64, z: 4 });
        assert.equal(G.nearestPointOnBox(null, { x: 4, y: 64, z: 4 }), null);
    });

    test('distance and horizontalDistance of points', () => {
        assert.equal(G.distance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }), 5);
        assert.equal(G.horizontalDistance({ x: 0, y: 0, z: 0 }, { x: 3, y: 99, z: 4 }), 5);
        assert.equal(G.distance(null, { x: 0, y: 0, z: 0 }), Infinity);
        assert.equal(G.horizontalDistance({ x: 0, y: 0, z: 0 }, null), Infinity);
    });
});

describe('expandBox, interiorBox, boxCenter', () => {
    test('expandBox grows and shrinks, null when nothing is left', () => {
        assert.deepEqual(G.expandBox(HOUSE, 2), box(-2, 61, -2, 10, 71, 10));
        assert.deepEqual(G.expandBox(HOUSE, -1), box(1, 64, 1, 7, 68, 7));
        assert.equal(G.expandBox(box(0, 0, 0, 1, 1, 1), -1), null);
        assert.equal(G.expandBox(null, 1), null);
    });

    test('interiorBox takes the walls and the margin off in x and z and keeps y', () => {
        // Scanned box: blocks from 1..7 grown by one. Walls at 1 and 7, interior 2..6.
        assert.deepEqual(G.interiorBox(HOUSE), box(2, 63, 2, 6, 69, 6));
    });

    test('interiorBox of a small box shrinks less instead of vanishing', () => {
        assert.deepEqual(G.interiorBox(box(0, 0, 0, 2, 3, 2)), box(1, 0, 1, 1, 3, 1));
        assert.deepEqual(G.interiorBox(box(0, 0, 0, 0, 3, 0)), box(0, 0, 0, 0, 3, 0));
        assert.deepEqual(G.interiorBox(box(0, 0, 0, 10, 3, 1)), box(2, 0, 0, 8, 3, 1), 'each axis on its own');
        assert.equal(G.interiorBox(null), null);
    });

    test('boxCenter is the middle of the covered space', () => {
        assert.deepEqual(G.boxCenter(HOUSE), { x: 4.5, y: 66.5, z: 4.5 });
        assert.equal(G.boxCenter(null), null);
    });
});

describe('segmentCrossesBox', () => {
    test('a segment through the box crosses it, one beside it does not', () => {
        assert.equal(G.segmentCrossesBox({ x: -5, y: 64, z: 4 }, { x: 15, y: 64, z: 4 }, HOUSE), true);
        assert.equal(G.segmentCrossesBox({ x: -5, y: 64, z: 12 }, { x: 15, y: 64, z: 12 }, HOUSE), false);
        assert.equal(G.segmentCrossesBox({ x: -5, y: 64, z: 4 }, { x: -1, y: 64, z: 4 }, HOUSE), false);
    });

    test('the end point inside counts, bad input does not', () => {
        assert.equal(G.segmentCrossesBox({ x: -5, y: 64, z: 4 }, { x: 1, y: 64, z: 4 }, HOUSE), true);
        assert.equal(G.segmentCrossesBox(null, { x: 1, y: 64, z: 4 }, HOUSE), false);
        assert.equal(G.segmentCrossesBox({ x: -5, y: 64, z: 4 }, { x: 1, y: 64, z: 4 }, null), false);
    });
});
