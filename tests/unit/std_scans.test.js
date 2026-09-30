// Spec v0.1.4.8, part D: D5 (scans: the farm is no room, scanPen, findFencedGroundNear, a reason and a
// text for every failure) -- src/agent/areas/area_scan.js on block worlds in memory.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';
import { createBlockWorld } from '../helpers/block_world.js';

const MODULE = 'src/agent/areas/area_scan.js';
const A = await loadSrc(MODULE);

const flat = () => createBlockWorld().flatGround(63);
const box = (x1, y1, z1, x2, y2, z2) => ({ min: { x: x1, y: y1, z: z1 }, max: { x: x2, y: y2, z: z2 } });
const at = (p) => ({ x: p.x + 0.5, y: p.y, z: p.z + 0.5 });

const TEXTS = {
    no_built_blocks: 'I find no built blocks within 6 blocks of me. Stand inside the building and try again.',
    not_loaded: 'Part of the ground around me is not loaded yet. Wait a moment and try again.',
    no_ground: 'I find no ground under me. Stand on the ground inside the fence and try again.',
    not_enclosed: 'I find no closed fence around me within 24 blocks. Stand inside the fence, or close the gap in it, and try again.',
    no_fence_farm: 'The ground around me is closed by walls, not by a fence. This is a room, not a farm.',
    no_fence_pen: 'The ground around me is closed by walls, not by a fence. This is a room, not a pen.',
    no_crops: 'The fenced ground has no farmland and no crop, so it is no farm. Till one block of it, or save it as a pen.',
    roofed: 'Half or more of the fenced ground has a roof over it. This is a room, not a farm.',
    farmland: 'The fenced ground has farmland, so it is a farm, not a pen. Save it as a farm.',
    no_fence_near: 'I see no fence within 6 blocks of me. Stand inside the fence or next to its gate and try again.',
    not_closed: 'The fence near me is not closed. Close the gap in it and try again.',
    too_big: 'The fenced ground is too big for one area. An area has at most 64 x 48 x 64 blocks. Use !setArea to save a part of it.',
};

describe('scanFarm: only fenced ground with farmland or a crop, and no room', () => {
    test('a fenced field of wheat: found, with the numbers of farmland, crop and roofed cells', () => {
        const world = flat();
        const field = world.field({ x: 20, y: 63, z: 0, width: 4, depth: 5 });
        const result = A.scanFarm(world.getBlockName, at(field.inside));
        assert.equal(result.found, true);
        assert.equal(result.reason, null);
        assert.equal(result.text, '');
        assert.deepEqual([result.cells, result.farmland, result.crops, result.roofed], [20, 20, 20, 0]);
        assert.deepEqual({ min: result.min, max: result.max }, box(19, 62, -1, 24, 66, 5));
    });

    test('P6: the floor of the house is no farm (closed by walls, not by a fence)', () => {
        const world = flat();
        const house = world.house({ x: 0, y: 63, z: 0 });
        const result = A.scanFarm(world.getBlockName, at(house.inside));
        assert.equal(result.found, false);
        assert.equal(result.reason, 'no_fence');
        assert.equal(result.text, TEXTS.no_fence_farm);
        assert.equal(result.min, null);
    });

    test('fenced grass without farmland and without a crop: no_crops', () => {
        const world = flat();
        const pen = world.field({ x: 20, y: 63, z: 0, ground: 'grass_block', crop: null });
        const result = A.scanFarm(world.getBlockName, at(pen.inside));
        assert.equal(result.reason, 'no_crops');
        assert.equal(result.text, TEXTS.no_crops);
    });

    test('one block of farmland, or one crop, is enough', () => {
        const world = flat();
        const pen = world.field({ x: 20, y: 63, z: 0, ground: 'grass_block', crop: null });
        world.set(21, 63, 1, 'farmland');
        assert.equal(A.scanFarm(world.getBlockName, at(pen.inside)).found, true);
        const other = flat();
        const berries = other.field({ x: 20, y: 63, z: 0, ground: 'grass_block', crop: null });
        other.set(21, 64, 1, 'sweet_berry_bush');
        const result = A.scanFarm(other.getBlockName, at(berries.inside));
        assert.equal(result.found, true);
        assert.deepEqual([result.farmland, result.crops], [0, 1]);
    });

    test('half or more of the cells with a solid block 1 to 4 above: roofed; fewer than half: a farm', () => {
        const world = flat();
        const field = world.field({ x: 20, y: 63, z: 0, width: 4, depth: 4 }); // 16 cells
        // 7 cells under a roof 4 above the ground (y 67): fewer than half
        world.fill(20, 67, 0, 23, 67, 0, 'oak_planks');
        world.fill(20, 67, 1, 22, 67, 1, 'oak_planks');
        const seven = A.scanFarm(world.getBlockName, at(field.inside));
        assert.equal(seven.found, true);
        assert.equal(seven.roofed, 7);
        world.set(23, 67, 1, 'oak_planks'); // 8 of 16
        const eight = A.scanFarm(world.getBlockName, at(field.inside));
        assert.equal(eight.reason, 'roofed');
        assert.equal(eight.text, TEXTS.roofed);
    });

    test('a roof 5 above the ground does not count', () => {
        const world = flat();
        const field = world.field({ x: 20, y: 63, z: 0, width: 4, depth: 4 });
        world.fill(19, 68, -1, 24, 68, 4, 'glass');
        assert.equal(A.scanFarm(world.getBlockName, at(field.inside)).found, true);
    });

    test('the old reasons have texts now: not_enclosed, no_ground, not_loaded', () => {
        const open = A.scanFarm(flat().getBlockName, { x: 0.5, y: 64, z: 0.5 });
        assert.deepEqual([open.reason, open.text], ['not_enclosed', TEXTS.not_enclosed]);
        const air = A.scanFarm(createBlockWorld().getBlockName, { x: 0.5, y: 64, z: 0.5 });
        assert.deepEqual([air.reason, air.text], ['no_ground', TEXTS.no_ground]);
        const world = flat().setLoaded(box(-5, 0, -5, 5, 100, 5));
        const part = A.scanFarm(world.getBlockName, { x: 0.5, y: 64, z: 0.5 });
        assert.deepEqual([part.reason, part.text], ['not_loaded', TEXTS.not_loaded]);
    });
});

describe('scanPen: fenced ground without farmland', () => {
    test('fenced grass is a pen', () => {
        const world = flat();
        const pen = world.field({ x: 20, y: 63, z: 0, width: 3, depth: 3, ground: 'grass_block', crop: null });
        const result = A.scanPen(world.getBlockName, at(pen.inside));
        assert.equal(result.found, true);
        assert.equal(result.reason, null);
        assert.equal(result.cells, 9);
        assert.deepEqual(result.entrances, [{ x: 21, y: 64, z: 3, kind: 'gate' }]);
    });

    test('a pen under a roof (a barn) is still a pen', () => {
        const world = flat();
        const pen = world.field({ x: 20, y: 63, z: 0, width: 3, depth: 3, ground: 'grass_block', crop: null });
        world.fill(19, 66, -1, 23, 66, 3, 'oak_planks');
        assert.equal(A.scanPen(world.getBlockName, at(pen.inside)).found, true);
    });

    test('ground with farmland is no pen: farmland', () => {
        const world = flat();
        const field = world.field({ x: 20, y: 63, z: 0 });
        const result = A.scanPen(world.getBlockName, at(field.inside));
        assert.deepEqual([result.found, result.reason, result.text], [false, 'farmland', TEXTS.farmland]);
    });

    test('a room with a fence post in it is no pen; a pen against the wall of a house is one', () => {
        const world = flat();
        const house = world.house({ x: 0, y: 63, z: 0 });
        world.set(4, 64, 3, 'oak_fence'); // the leg of a table
        assert.equal(A.scanPen(world.getBlockName, at(house.inside)).reason, 'no_fence');
        const pen = world.field({ x: 7, y: 63, z: 2, width: 5, depth: 3, ground: 'grass_block', crop: null, sides: { west: null } });
        const result = A.scanPen(world.getBlockName, at(pen.inside));
        assert.equal(result.found, true, JSON.stringify(result));
        assert.equal(result.cells, 15);
    });

    test('a room is no pen: no_fence; open ground: not_enclosed', () => {
        const world = flat();
        const house = world.house({ x: 0, y: 63, z: 0 });
        const room = A.scanPen(world.getBlockName, at(house.inside));
        assert.deepEqual([room.reason, room.text], ['no_fence', TEXTS.no_fence_pen]);
        assert.equal(A.scanPen(world.getBlockName, { x: 30.5, y: 64, z: 30.5 }).reason, 'not_enclosed');
    });

    test('invalid input: a TypeError', () => {
        assert.throws(() => A.scanPen(null, { x: 0, y: 0, z: 0 }), TypeError);
        assert.throws(() => A.scanPen(() => 'air', { x: 0, y: NaN, z: 0 }), TypeError);
    });
});

describe('findFencedGroundNear (P5): the bot stood outside the fence or on the gate', () => {
    // Inner ground x 20..24, z 0..4; the fence ring x 19..25, z -1..5 at y 64; the gate at (22, 64, 5).
    function farm() {
        const world = flat();
        const field = world.field({ x: 20, y: 63, z: 0, width: 5, depth: 5 });
        return { world, field };
    }

    test('inside: the ground at the position, inside, no text, the gate', () => {
        const { world, field } = farm();
        const result = A.findFencedGroundNear(world.getBlockName, at(field.inside), 6, { type: 'farm' });
        assert.equal(result.found, true);
        assert.equal(result.inside, true);
        assert.equal(result.text, '');
        assert.deepEqual(result.gate, { x: 22, y: 64, z: 5 });
        assert.deepEqual(result.start, { x: 22, y: 64, z: 2 });
        assert.equal(result.cells, 25);
    });

    test('outside, in front of the gate: the ground behind it, with the text of the spec', () => {
        const { world } = farm();
        const result = A.findFencedGroundNear(world.getBlockName, { x: 22.5, y: 64, z: 7.5 }, 6, { type: 'farm' });
        assert.equal(result.found, true);
        assert.equal(result.inside, false);
        assert.deepEqual(result.gate, { x: 22, y: 64, z: 5 });
        assert.equal(result.text, 'I stand outside the fence. The gate is at (22, 64, 5). I can save the ground behind it.');
        assert.deepEqual({ min: result.min, max: result.max }, box(19, 62, -1, 25, 66, 5));
        assert.deepEqual(result.start, { x: 22, y: 64, z: 4 }, 'the nearest cell behind the gate');
    });

    test('outside at the far side: the gate nearest to the bot is named', () => {
        const { world } = farm();
        const result = A.findFencedGroundNear(world.getBlockName, { x: 17.5, y: 64, z: 2.5 });
        assert.equal(result.found, true);
        assert.equal(result.text, 'I stand outside the fence. The gate is at (22, 64, 5). I can save the ground behind it.');
    });

    test('in the gate block', () => {
        const { world, field } = farm();
        world.set(22, 64, 5, 'oak_fence_gate', { open: true });
        const result = A.findFencedGroundNear(world.getBlockName, at(field.gate));
        assert.equal(result.found, true);
        assert.equal(result.inside, false);
        assert.equal(result.text, 'I stand in the gate at (22, 64, 5). I can save the ground behind it.');
    });

    test('a fence without a gate', () => {
        const world = flat();
        world.field({ x: 20, y: 63, z: 0, gate: null });
        const result = A.findFencedGroundNear(world.getBlockName, { x: 22.5, y: 64, z: 7.5 });
        assert.equal(result.found, true);
        assert.equal(result.gate, null);
        assert.equal(result.text, 'I stand outside the fence, and it has no gate. I can save the ground behind it.');
    });

    test('no fence within the range: no_fence_near; a larger range finds it', () => {
        const { world } = farm();
        const pos = { x: 22.5, y: 64, z: 12.5 }; // the gate is 7 blocks away
        const near = A.findFencedGroundNear(world.getBlockName, pos);
        assert.deepEqual([near.found, near.reason, near.text], [false, 'no_fence_near', TEXTS.no_fence_near]);
        assert.equal(near.gate, null);
        assert.equal(A.findFencedGroundNear(world.getBlockName, pos, 10).found, true);
        assert.equal(A.findFencedGroundNear(world.getBlockName, pos, 10).text,
            'I stand outside the fence. The gate is at (22, 64, 5). I can save the ground behind it.');
    });

    test('a fence with a gap: not_closed, from outside and from inside', () => {
        const world = flat();
        const field = world.field({ x: 20, y: 63, z: 0, gaps: [{ x: 25, z: 2 }] });
        const outside = A.findFencedGroundNear(world.getBlockName, { x: 22.5, y: 64, z: 7.5 });
        assert.deepEqual([outside.reason, outside.text], ['not_closed', TEXTS.not_closed]);
        assert.equal(A.findFencedGroundNear(world.getBlockName, at(field.inside)).reason, 'not_closed');
    });

    test('a closed fence around more ground than an area holds: too_big, from inside and from outside', () => {
        const world = flat();
        world.field({ x: 0, y: 63, z: 0, width: 70, depth: 5 });
        const inside = A.findFencedGroundNear(world.getBlockName, { x: 10.5, y: 64, z: 2.5 }, 6, { type: 'farm' });
        assert.deepEqual([inside.found, inside.reason, inside.text], [false, 'too_big', TEXTS.too_big]);
        const outside = A.findFencedGroundNear(world.getBlockName, { x: 10.5, y: 64, z: 7.5 }, 6, { type: 'farm' });
        assert.equal(outside.reason, 'too_big');
    });

    test('62 cells wide is still one area (64 blocks with the fence)', () => {
        const world = flat();
        world.field({ x: 0, y: 63, z: 0, width: 62, depth: 3 });
        const result = A.findFencedGroundNear(world.getBlockName, { x: 5.5, y: 64, z: 1.5 });
        assert.equal(result.found, true);
        assert.equal(result.max.x - result.min.x + 1, 64);
    });

    test('P6 and P5: from inside the house the farm beside it is found; a room alone says it is a room', () => {
        const world = flat();
        world.house({ x: 0, y: 63, z: 0 });
        world.field({ x: 9, y: 63, z: 1, width: 4, depth: 4 });
        const result = A.findFencedGroundNear(world.getBlockName, { x: 5.5, y: 64, z: 3.5 }, 6, { type: 'farm' });
        assert.equal(result.found, true);
        assert.equal(result.inside, false);
        assert.deepEqual({ min: result.min, max: result.max }, box(8, 62, 0, 13, 66, 5));
        const alone = flat();
        const house = alone.house({ x: 0, y: 63, z: 0 });
        const room = A.findFencedGroundNear(alone.getBlockName, at(house.inside), 6, { type: 'farm' });
        assert.deepEqual([room.found, room.reason, room.text], [false, 'no_fence', TEXTS.no_fence_farm]);
    });

    test('the type decides: from a pen the farm beside it; a pen wanted near a farm only: farmland', () => {
        const world = flat();
        world.field({ x: 0, y: 63, z: 0, width: 4, depth: 4, ground: 'grass_block', crop: null }); // pen x 0..3
        world.field({ x: 5, y: 63, z: 0, width: 4, depth: 4 }); // farm x 5..8, the fence x 4 is shared
        const fromPen = A.findFencedGroundNear(world.getBlockName, { x: 2.5, y: 64, z: 1.5 }, 6, { type: 'farm' });
        assert.equal(fromPen.found, true);
        assert.equal(fromPen.farmland, 16);
        assert.equal(fromPen.min.x, 4);
        const penHere = A.findFencedGroundNear(world.getBlockName, { x: 2.5, y: 64, z: 1.5 }, 6, { type: 'pen' });
        assert.equal(penHere.inside, true);
        const only = flat();
        only.field({ x: 20, y: 63, z: 0 });
        const wrong = A.findFencedGroundNear(only.getBlockName, { x: 22.5, y: 64, z: 7.5 }, 6, { type: 'pen' });
        assert.deepEqual([wrong.found, wrong.reason, wrong.text], [false, 'farmland', TEXTS.farmland]);
        const noCrop = A.findFencedGroundNear(world.getBlockName, { x: -2.5, y: 64, z: 1.5 }, 3, { type: 'farm' });
        assert.equal(noCrop.reason, 'no_crops', 'the pen is the only fenced ground within 3 blocks');
    });

    test('without a type any fenced ground counts', () => {
        const world = flat();
        const pen = world.field({ x: 20, y: 63, z: 0, ground: 'grass_block', crop: null });
        assert.equal(A.findFencedGroundNear(world.getBlockName, at(pen.inside)).found, true);
    });

    test('ground that is not loaded: not_loaded', () => {
        const world = flat();
        world.field({ x: -2, y: 63, z: -2, width: 13, depth: 5 }); // the ring x -3..11, z -3..3
        world.setLoaded(box(-5, 0, -5, 5, 100, 5));
        const result = A.findFencedGroundNear(world.getBlockName, { x: 0.5, y: 64, z: 0.5 });
        assert.deepEqual([result.reason, result.text], ['not_loaded', TEXTS.not_loaded]);
    });

    test('nothing to stand on: no_ground', () => {
        const world = createBlockWorld();
        world.set(1, 64, 1, 'oak_fence');
        const result = A.findFencedGroundNear(world.getBlockName, { x: 0.5, y: 64, z: 0.5 });
        assert.equal(result.reason, 'no_ground');
        assert.equal(result.text, TEXTS.no_ground);
    });

    test('range: at most 16; a bad range is 6; invalid input: a TypeError', () => {
        const { world } = farm();
        const far = { x: 22.5, y: 64, z: 25.5 }; // 20 away
        assert.equal(A.findFencedGroundNear(world.getBlockName, far, 100).reason, 'no_fence_near');
        assert.equal(A.findFencedGroundNear(world.getBlockName, { x: 22.5, y: 64, z: 12.5 }, 'x').reason, 'no_fence_near');
        assert.throws(() => A.findFencedGroundNear(null, { x: 0, y: 0, z: 0 }), TypeError);
        assert.throws(() => A.findFencedGroundNear(world.getBlockName, null), TypeError);
    });

    test('an open world around the bot finishes quickly', () => {
        const world = flat();
        world.set(3, 64, 0, 'oak_fence');
        const started = performance.now();
        const result = A.findFencedGroundNear(world.getBlockName, { x: 0.5, y: 64, z: 0.5 });
        const ms = performance.now() - started;
        assert.equal(result.reason, 'not_closed');
        assert.ok(ms < 3000, `took ${ms} ms`);
    });
});

describe('scanBuilding: reasons and texts', () => {
    test('no built block near: no_built_blocks; too few: too_few_blocks; found: no reason', () => {
        const open = A.scanBuilding(flat().getBlockName, { x: 0.5, y: 64, z: 0.5 });
        assert.deepEqual([open.found, open.reason, open.text], [false, 'no_built_blocks', TEXTS.no_built_blocks]);
        const world = flat();
        world.fill(0, 64, 0, 4, 64, 1, 'oak_planks');
        const few = A.scanBuilding(world.getBlockName, { x: 2, y: 64, z: 3 });
        assert.equal(few.reason, 'too_few_blocks');
        assert.equal(few.text, 'I find only 10 built blocks here, and a building has at least 12. Stand inside the building and try again.');
        const house = flat();
        const h = house.house({ x: 0, y: 63, z: 0 });
        const found = A.scanBuilding(house.getBlockName, h.inside);
        assert.deepEqual([found.found, found.reason, found.text], [true, null, '']);
    });
});

describe('scanText: every reason code has a text that says what to do', () => {
    test('all codes', () => {
        for (const reason of ['no_built_blocks', 'too_few_blocks', 'not_loaded', 'no_ground', 'not_enclosed', 'no_fence', 'no_crops',
            'roofed', 'farmland', 'no_fence_near', 'not_closed', 'too_big']) {
            const text = A.scanText(reason);
            assert.ok(text.length > 20 && text.endsWith('.'), `${reason}: ${text}`);
        }
        assert.equal(A.scanText('no_fence', { what: 'a pen' }), TEXTS.no_fence_pen);
        assert.equal(A.scanText('no_fence_near', { range: 10 }), 'I see no fence within 10 blocks of me. Stand inside the fence or next to its gate and try again.');
        assert.equal(A.scanText('nothing'), '');
        assert.equal(A.scanText('toString'), '');
    });
});

describe('module rules (pure module)', () => {
    test('imports no mineflayer, no library, no model SDK', () => {
        assertImportRules(MODULE);
    });

    test('imports cleanly: no output, no files', () => {
        assertCleanImport(MODULE);
    });
});
