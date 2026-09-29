// T1, spec v0.1.4.8 section 7, D5 (P5, P6): the scans of fenced ground, tested from the spec.
//   - scanFarm takes ground for a farm only when it is fenced, holds at least 1 block of farmland or 1
//     crop, and fewer than half of its cells have a solid block within 4 blocks above (P6: the floor of
//     the house was taken for a farm);
//   - scanPen: fenced ground without farmland;
//   - findFencedGroundNear(getBlock, pos, range = 6): from outside or on the fence it tries the walkable
//     cells within range, nearest first, and returns the first enclosed scan with its gate, or a reason
//     no_fence_near, not_closed, too_big (P5: !rememberArea("farm") failed 5 times from outside the gate);
//   - every failure has a reason code and a text that says what to do.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { createBlockWorld } from '../helpers/block_world.js';

const scan = await loadSrc('src/agent/areas/area_scan.js');

// A fenced field of 5 x 5 at (0..4, 63, 0..4), the fence at y 64 around it, the gate at (2, 64, 5).
function farmWorld(options = {}) {
    const world = createBlockWorld().flatGround(63);
    const field = world.field({ x: 0, y: 63, z: 0, width: 5, depth: 5, ...options });
    return { world, field };
}
const INSIDE = { x: 2.5, y: 64, z: 2.5 };

describe('D5: scanFarm', () => {
    test('fenced farmland with wheat is a farm, with its gate', () => {
        const { world } = farmWorld();
        const r = scan.scanFarm(world.getBlockName, INSIDE);
        assert.equal(r.found, true);
        assert.deepEqual(r.entrances.map((e) => [e.x, e.y, e.z, e.kind]), [[2, 64, 5, 'gate']]);
    });

    test('fenced grass without farmland and without a crop is no farm: a reason and a text', () => {
        const { world } = farmWorld({ ground: 'grass_block', crop: null });
        const r = scan.scanFarm(world.getBlockName, INSIDE);
        assert.equal(r.found, false);
        assert.equal(typeof r.reason, 'string');
        assert.ok(r.text.length > 20, r.text);
    });

    test('one block of farmland is enough', () => {
        const { world } = farmWorld({ ground: 'grass_block', crop: null });
        world.set(4, 63, 4, 'farmland');
        assert.equal(scan.scanFarm(world.getBlockName, INSIDE).found, true);
    });

    test('one crop is enough', () => {
        const { world } = farmWorld({ ground: 'grass_block', crop: null });
        world.set(4, 64, 4, 'wheat');
        assert.equal(scan.scanFarm(world.getBlockName, INSIDE).found, true);
    });

    test('half of the cells or more under a solid block within 4 blocks: no farm; fewer than half: a farm', () => {
        const half = farmWorld({ width: 4, depth: 4 });
        half.world.fill(0, 67, 0, 1, 67, 3, 'stone'); // 8 of 16 cells, 4 blocks above the ground
        const r = scan.scanFarm(half.world.getBlockName, { x: 2.5, y: 64, z: 2.5 });
        assert.equal(r.found, false, 'half');
        assert.ok(r.text.length > 0);
        const less = farmWorld({ width: 4, depth: 4 });
        less.world.fill(0, 67, 0, 1, 67, 2, 'stone'); // 6 of 16
        less.world.set(1, 67, 3, 'stone'); // 7 of 16
        assert.equal(scan.scanFarm(less.world.getBlockName, { x: 2.5, y: 64, z: 2.5 }).found, true, 'fewer than half');
        const high = farmWorld({ width: 4, depth: 4 });
        high.world.fill(0, 68, 0, 3, 68, 3, 'stone'); // 5 blocks above: no roof for the rule
        assert.equal(scan.scanFarm(high.world.getBlockName, { x: 2.5, y: 64, z: 2.5 }).found, true, 'a roof 5 blocks up');
    });

    test('play test P6: the floor of the house is no farm', () => {
        const world = createBlockWorld().flatGround(63);
        const house = world.house({ x: 0, y: 63, z: 0, width: 7, depth: 7 });
        const r = scan.scanFarm(world.getBlockName, { x: house.inside.x + 0.5, y: house.inside.y, z: house.inside.z + 0.5 });
        assert.equal(r.found, false);
        assert.ok(r.text.length > 0);
    });

    test('a house without a roof, with farmland and wheat inside, is no farm (walls are no fence)', () => {
        const world = createBlockWorld().flatGround(63);
        const house = world.house({ x: 0, y: 63, z: 0, width: 7, depth: 7, roof: null });
        world.set(3, 63, 3, 'farmland');
        world.set(3, 64, 3, 'wheat');
        const r = scan.scanFarm(world.getBlockName, { x: house.inside.x + 0.5, y: house.inside.y, z: house.inside.z + 0.5 });
        assert.equal(r.found, false);
    });
});

describe('D5: scanPen', () => {
    test('fenced ground without farmland is a pen', () => {
        const { world } = farmWorld({ ground: 'grass_block', crop: null });
        const r = scan.scanPen(world.getBlockName, INSIDE);
        assert.equal(r.found, true);
        assert.equal(r.entrances.length, 1);
    });

    test('fenced ground with farmland is no pen: a reason and a text', () => {
        const { world } = farmWorld();
        const r = scan.scanPen(world.getBlockName, INSIDE);
        assert.equal(r.found, false);
        assert.equal(typeof r.reason, 'string');
        assert.ok(r.text.length > 20, r.text);
    });
});

describe('D5: findFencedGroundNear', () => {
    test('the default range is 6', () => {
        const { world } = farmWorld();
        // 7 blocks south of the fence: no fence within 6
        assert.equal(scan.findFencedGroundNear(world.getBlockName, { x: 2.5, y: 64, z: 12.5 }).reason, 'no_fence_near');
        assert.equal(scan.findFencedGroundNear(world.getBlockName, { x: 2.5, y: 64, z: 10.5 }).found, true);
    });

    test('from inside: the ground itself', () => {
        const { world } = farmWorld();
        const r = scan.findFencedGroundNear(world.getBlockName, INSIDE, 6, { type: 'farm' });
        assert.equal(r.found, true);
        assert.equal(r.inside, true);
    });

    test('play test P5: from outside the gate: the ground behind it, the gate, and the text of the spec', () => {
        const { world, field } = farmWorld();
        const r = scan.findFencedGroundNear(world.getBlockName, { x: 2.5, y: 64, z: 7.5 }, 6, { type: 'farm' });
        assert.equal(r.found, true);
        assert.equal(r.inside, false);
        assert.deepEqual(r.gate, field.gate);
        assert.equal(r.text, `I stand outside the fence. The gate is at (${field.gate.x}, ${field.gate.y}, ${field.gate.z}). I can save the ground behind it.`);
        assert.ok(r.min && r.max, 'the box of the ground');
    });

    test('from the side without a gate: the nearest cells are tried first, the same field is found', () => {
        const { world, field } = farmWorld();
        const r = scan.findFencedGroundNear(world.getBlockName, { x: 7.5, y: 64, z: 2.5 }, 6, { type: 'farm' });
        assert.equal(r.found, true);
        assert.deepEqual(r.gate, field.gate);
    });

    test('standing in the gate: found', () => {
        const { world, field } = farmWorld();
        const r = scan.findFencedGroundNear(world.getBlockName, { x: field.gate.x + 0.5, y: 64, z: field.gate.z + 0.5 }, 6, { type: 'farm' });
        assert.equal(r.found, true);
    });

    test('no fence near: reason no_fence_near and a text', () => {
        const world = createBlockWorld().flatGround(63);
        const r = scan.findFencedGroundNear(world.getBlockName, { x: 0.5, y: 64, z: 0.5 });
        assert.equal(r.found, false);
        assert.equal(r.reason, 'no_fence_near');
        assert.ok(r.text.length > 20, r.text);
    });

    test('a fence with a gap: reason not_closed and a text', () => {
        const { world } = farmWorld({ gaps: [{ x: 0, z: -1 }] });
        const r = scan.findFencedGroundNear(world.getBlockName, INSIDE);
        assert.equal(r.found, false);
        assert.equal(r.reason, 'not_closed');
        assert.ok(r.text.length > 20, r.text);
    });

    test('a fence that closes, but wider than an area: reason too_big and a text', () => {
        const world = createBlockWorld().flatGround(63);
        world.field({ x: 0, y: 63, z: 0, width: 70, depth: 70, ground: 'grass_block', crop: null });
        const r = scan.findFencedGroundNear(world.getBlockName, { x: 2.5, y: 64, z: 2.5 });
        assert.equal(r.found, false);
        assert.equal(r.reason, 'too_big');
        assert.ok(r.text.length > 20, r.text);
    });

    test('type pen at a farm: no pen, the reason says why', () => {
        const { world } = farmWorld();
        const r = scan.findFencedGroundNear(world.getBlockName, INSIDE, 6, { type: 'pen' });
        assert.equal(r.found, false);
        assert.ok(r.text.length > 20);
    });
});

describe('D5: every failure has a reason code and a text that says what to do', () => {
    for (const reason of ['no_fence', 'no_crops', 'roofed', 'farmland', 'no_fence_near', 'not_closed', 'too_big', 'not_loaded', 'no_ground', 'not_enclosed']) {
        test(reason, () => {
            const text = scan.scanText(reason);
            assert.ok(text.length > 20, `${reason}: ${text}`);
            assert.match(text, /\.$/);
        });
    }
});
