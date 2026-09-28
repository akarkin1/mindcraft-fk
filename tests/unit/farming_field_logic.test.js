// Spec v0.1.4.7 F2: the pure field geometry of the farming pack (field_logic.js): which farm, the
// cells of a field, the gates, and where the bot may step.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlockWorld } from '../helpers/block_world.js';
import {
    FARM_RANGE, chooseFarmArea, fieldBox, fieldCells, findGates, insideBox, isInField, stepPenalty,
} from '../../src/agent/packs/farming/field_logic.js';

// A getBlock over the block world: { name, age } or null when not loaded.
function reader(world) {
    return (x, y, z) => {
        const b = world.blockAt({ x, y, z });
        return b ? { name: b.name, age: b.getProperties().age, properties: b.getProperties() } : null;
    };
}

// The owner's field: 2 by 5 at (0..1, 63, 0..4), wheat at ages 0..7, a fence and a gate in the south.
function ownerField() {
    const world = createBlockWorld().flatGround(63);
    const f = world.field({ x: 0, y: 63, z: 0, width: 2, depth: 5, crop: null });
    let age = 0;
    for (let x = 0; x <= 1; x++) {
        for (let z = 0; z <= 4; z++) world.set(x, 64, z, 'wheat', { age: (age++) % 8 });
    }
    const box = { min: { x: f.ring.min.x, y: 62, z: f.ring.min.z }, max: { x: f.ring.max.x, y: 66, z: f.ring.max.z } };
    return { world, f, box };
}

describe('fieldCells', () => {
    test('reads ground, the block above and the age of every column', () => {
        const { world, box } = ownerField();
        const cells = fieldCells(reader(world), box);
        const inner = cells.filter(c => c.ground === 'farmland');
        assert.equal(inner.length, 10);
        assert.ok(inner.every(c => c.y === 63 && c.above === 'wheat' && Number.isInteger(c.age)));
        assert.deepEqual(inner.find(c => c.x === 1 && c.z === 4), { x: 1, y: 63, z: 4, ground: 'farmland', above: 'wheat', age: 1 });
        const ring = cells.filter(c => c.ground !== 'farmland');
        assert.ok(ring.every(c => /fence/.test(c.ground)), 'the fence ring gives no field cell');
        assert.equal(ring.length, 4 * 7 - 10);
    });

    test('free farmland, grass, water and a flat box at the crop level', () => {
        const world = createBlockWorld().flatGround(63);
        world.set(0, 63, 0, 'farmland');
        world.set(1, 63, 0, 'water');
        world.set(2, 63, 0, 'farmland');
        world.set(2, 64, 0, 'carrots', { age: 7 });
        const cells = fieldCells(reader(world), { min: { x: 0, y: 64, z: 0 }, max: { x: 3, y: 64, z: 0 } });
        assert.deepEqual(cells.map(c => [c.x, c.ground, c.above, c.age ?? null]), [
            [0, 'farmland', 'air', null], [1, 'water', 'air', null], [2, 'farmland', 'carrots', 7], [3, 'grass_block', 'air', null],
        ]);
    });

    test('columns that are not loaded or empty are left out; bad input gives nothing', () => {
        const world = createBlockWorld({ loaded: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 100, z: 0 } } }).flatGround(63);
        const cells = fieldCells(reader(world), { min: { x: 0, y: 62, z: 0 }, max: { x: 1, y: 66, z: 0 } });
        assert.deepEqual(cells.map(c => c.x), [0]);
        const empty = createBlockWorld();
        assert.deepEqual(fieldCells(reader(empty), { min: { x: 0, y: 62, z: 0 }, max: { x: 0, y: 66, z: 0 } }), []);
        assert.deepEqual(fieldCells(null, { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }), []);
        assert.deepEqual(fieldCells(reader(world), { min: { x: 1 }, max: {} }), []);
        assert.deepEqual(fieldCells(() => { throw new Error('boom'); }, { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }), []);
    });

    test('a box larger than an area may be is refused', () => {
        const world = createBlockWorld().flatGround(63);
        assert.deepEqual(fieldCells(reader(world), { min: { x: 0, y: 60, z: 0 }, max: { x: 200, y: 66, z: 0 } }), []);
    });
});

describe('fieldBox, insideBox, isInField', () => {
    test('the box of farmland and crops, else of the tillable ground', () => {
        const cells = [
            { x: 0, y: 63, z: 0, ground: 'oak_fence', above: 'air' },
            { x: 1, y: 63, z: 1, ground: 'farmland', above: 'wheat', age: 1 },
            { x: 3, y: 64, z: 2, ground: 'farmland', above: 'air' },
            { x: 9, y: 63, z: 9, ground: 'grass_block', above: 'air' },
        ];
        assert.deepEqual(fieldBox(cells), { min: { x: 1, y: 63, z: 1 }, max: { x: 3, y: 64, z: 2 } });
        assert.deepEqual(fieldBox(cells.slice(3)), { min: { x: 9, y: 63, z: 9 }, max: { x: 9, y: 63, z: 9 } });
        assert.equal(fieldBox([{ x: 0, y: 1, z: 0, ground: 'stone', above: 'air' }]), null);
        assert.equal(fieldBox(null), null);
    });

    test('insideBox gives the box that passThrough of the home pack sees as inside', () => {
        const box = { min: { x: 1, y: 63, z: 1 }, max: { x: 3, y: 63, z: 2 } };
        assert.deepEqual(insideBox(box), { min: { x: -1, y: 61, z: -1 }, max: { x: 5, y: 65, z: 4 } });
        assert.equal(insideBox(null), null);
    });

    test('isInField: standing on a cell of the field', () => {
        const cells = [
            { x: 1, y: 63, z: 1, ground: 'farmland', above: 'wheat', age: 1 },
            { x: 2, y: 63, z: 1, ground: 'grass_block', above: 'air' },
            { x: 0, y: 63, z: 1, ground: 'oak_fence', above: 'air' },
        ];
        assert.equal(isInField(cells, { x: 1.5, y: 63.9375, z: 1.5 }), true, 'on farmland');
        assert.equal(isInField(cells, { x: 2.5, y: 64, z: 1.5 }), true, 'on grass inside');
        assert.equal(isInField(cells, { x: 0.5, y: 65, z: 1.5 }), false, 'on the fence');
        assert.equal(isInField(cells, { x: 1.5, y: 70, z: 1.5 }), false, 'far above');
        assert.equal(isInField(cells, { x: 5.5, y: 64, z: 1.5 }), false);
        assert.equal(isInField(cells, null), false);
    });
});

describe('findGates', () => {
    test('the gates on the ring around the field', () => {
        const { world, f } = ownerField();
        const gates = findGates(reader(world), { min: f.min, max: f.max });
        assert.deepEqual(gates, [{ x: f.gate.x, y: f.gate.y, z: f.gate.z, kind: 'gate' }]);
    });

    test('several gates sorted by x, z, y; none without a fence', () => {
        const world = createBlockWorld().flatGround(63);
        const f = world.field({ x: 0, y: 63, z: 0, width: 4, depth: 4, gateSide: 'north' });
        world.set(4, 64, 1, 'spruce_fence_gate', { open: true });
        const gates = findGates(reader(world), { min: f.min, max: f.max });
        assert.deepEqual(gates.map(g => [g.x, g.z]), [[1, -1], [4, 1]]);
        assert.deepEqual(findGates(reader(createBlockWorld().flatGround(63)), { min: f.min, max: f.max }), []);
        assert.deepEqual(findGates(reader(world), null), []);
    });
});

describe('stepPenalty', () => {
    test('refuses the air above the plants and the water, allows walking among them', () => {
        const cells = [
            { x: 0, y: 63, z: 0, ground: 'farmland', above: 'wheat', age: 2 },
            { x: 1, y: 63, z: 0, ground: 'farmland', above: 'air' },
            { x: 2, y: 63, z: 0, ground: 'water', above: 'air' },
            { x: 3, y: 63, z: 0, ground: 'grass_block', above: 'air' },
        ];
        const cost = stepPenalty(cells);
        for (const x of [0, 1]) {
            assert.equal(cost({ x, y: 64, z: 0 }), 0, 'feet among the plants');
            assert.equal(cost({ x, y: 65, z: 0 }), 0, 'head among the plants');
            for (const y of [66, 67, 68]) assert.equal(cost({ x, y, z: 0 }), 100, `a jump or a drop onto the field at y ${y}`);
            assert.equal(cost({ x, y: 69, z: 0 }), 0);
        }
        assert.equal(cost({ x: 2, y: 63, z: 0 }), 100, 'no step into the water');
        assert.equal(cost({ x: 2, y: 64, z: 0 }), 0);
        assert.equal(cost({ x: 3, y: 66, z: 0 }), 0, 'grass is no farmland');
        assert.equal(cost({ x: 9, y: 66, z: 9 }), 0);
        assert.equal(cost(null), 0);
        assert.equal(cost({ x: 'a' }), 0);
        assert.equal(stepPenalty(null)({ x: 0, y: 66, z: 0 }), 0);
    });

    test('works with a mineflayer block as input', () => {
        const cost = stepPenalty([{ x: 0, y: 63, z: 0, ground: 'farmland', above: 'air' }]);
        assert.equal(cost({ position: { x: 0, y: 66, z: 0 } }), 100);
    });
});

describe('chooseFarmArea', () => {
    const farm = (name, x, extra = {}) => ({ name, type: 'farm', dimension: 'overworld', min: { x, y: 62, z: 0 }, max: { x: x + 4, y: 66, z: 4 }, entrances: [], ...extra });
    const areas = [
        farm('wheat_farm', 10), farm('far_farm', 200), farm('Carrot_Farm', -30),
        { name: 'home', type: 'building', dimension: 'overworld', min: { x: 0, y: 60, z: 0 }, max: { x: 5, y: 70, z: 5 } },
        farm('nether_farm', 0, { dimension: 'the_nether' }),
    ];

    test('by name, without regard to case', () => {
        assert.equal(chooseFarmArea(areas, { name: 'carrot_farm', pos: { x: 0, y: 64, z: 0 } }).area.name, 'Carrot_Farm');
        assert.equal(chooseFarmArea(areas, { name: ' Wheat_Farm ', pos: { x: 0, y: 64, z: 0 } }).area.name, 'wheat_farm');
        assert.equal(chooseFarmArea(areas, { name: 'far_farm', pos: { x: 0, y: 64, z: 0 } }).reason, 'named', 'a name has no range');
    });

    test('an unknown name or a building is no farm', () => {
        const res = chooseFarmArea(areas, { name: 'home', pos: { x: 0, y: 64, z: 0 } });
        assert.equal(res.area, null);
        assert.equal(res.reason, 'unknown_name');
        assert.deepEqual(res.known, ['Carrot_Farm', 'far_farm', 'wheat_farm']);
    });

    test('without a name: the nearest farm within 64 blocks in the dimension', () => {
        assert.equal(FARM_RANGE, 64);
        const near = chooseFarmArea(areas, { name: '', pos: { x: 0, y: 64, z: 0 }, dimension: 'overworld' });
        assert.equal(near.area.name, 'wheat_farm');
        assert.equal(near.reason, 'nearest');
        assert.equal(chooseFarmArea(areas, { pos: { x: 150, y: 64, z: 0 } }).area.name, 'far_farm');
        assert.equal(chooseFarmArea(areas, { pos: { x: 100, y: 64, z: 0 } }).area, null, 'the farms are 85 and 100 blocks away');
        assert.equal(chooseFarmArea(areas, { pos: { x: 2, y: 64, z: 2 }, dimension: 'the_nether' }).area.name, 'nether_farm');
        assert.equal(chooseFarmArea(areas, { pos: { x: 2, y: 64, z: 2 }, dimension: 'the_end' }).reason, 'none');
    });

    test('bad input gives none', () => {
        assert.equal(chooseFarmArea(null, { pos: { x: 0, y: 0, z: 0 } }).reason, 'none');
        assert.equal(chooseFarmArea(areas, {}).reason, 'none');
        assert.equal(chooseFarmArea(areas).reason, 'none');
    });
});
