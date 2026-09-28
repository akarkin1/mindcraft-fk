// tests/helpers/block_world.js: the block world in memory used by the tests of parts A and H.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createBlockWorld, BlockWorld, vec, AIR_NAMES } from '../helpers/block_world.js';
import { repoPath } from '../helpers/paths.js';

describe('block_world.js', () => {
    test('has no imports', () => {
        const source = fs.readFileSync(repoPath('tests/helpers/block_world.js'), 'utf8');
        assert.equal(/^\s*import\s/m.test(source), false);
    });

    test('set, get, fill; unset is air; fractional positions are floored', () => {
        const world = createBlockWorld();
        assert.ok(world instanceof BlockWorld);
        assert.equal(world.get(0, 0, 0), 'air');
        world.set(1, 2, 3, 'stone').fill(0, 0, 0, -1, 1, 1, 'dirt');
        assert.equal(world.get(1, 2, 3), 'stone');
        assert.equal(world.get(1.9, 2.1, 3.5), 'stone');
        assert.equal(world.get(-1, 1, 1), 'dirt');
        assert.equal(world.positionsOf('dirt').length, 8);
        assert.throws(() => world.set(0.5, 0, 0, 'stone'), TypeError);
        assert.throws(() => world.set(0, 0, 0, ''), TypeError);
        assert.deepEqual(AIR_NAMES, ['air', 'cave_air', 'void_air']);
    });

    test('getBlockName is bound: it works when passed on alone', () => {
        const world = createBlockWorld().set(0, 0, 0, 'glass');
        const { getBlockName } = world;
        assert.equal(getBlockName(0, 0, 0), 'glass');
    });

    test('flat ground: top block at y, below under it; set blocks win', () => {
        const world = createBlockWorld().flatGround(63);
        assert.deepEqual([world.get(5, 64, 5), world.get(5, 63, 5), world.get(5, 10, 5)], ['air', 'grass_block', 'dirt']);
        world.set(5, 63, 5, 'farmland');
        assert.equal(world.get(5, 63, 5), 'farmland');
        assert.throws(() => world.flatGround(1.5), TypeError);
    });

    test('outside of the loaded region: null', () => {
        const world = createBlockWorld({ loaded: { min: { x: 0, y: 0, z: 0 }, max: { x: 9, y: 9, z: 9 } } });
        assert.equal(world.get(5, 5, 5), 'air');
        assert.equal(world.get(10, 5, 5), null);
        assert.equal(world.blockAt({ x: -1, y: 0, z: 0 }), null);
        world.setLoaded(null);
        assert.equal(world.get(10, 5, 5), 'air');
    });

    test('blockAt: name, position with Vec3 methods, properties', () => {
        const world = createBlockWorld().set(1, 64, 2, 'oak_door', { half: 'lower', open: false });
        const b = world.blockAt({ x: 1.5, y: 64.2, z: 2.9 });
        assert.equal(b.name, 'oak_door');
        assert.deepEqual({ x: b.position.x, y: b.position.y, z: b.position.z }, { x: 1, y: 64, z: 2 });
        assert.deepEqual(b.getProperties(), { half: 'lower', open: false });
        assert.equal(b._properties.open, false);
        assert.deepEqual(world.blockAt({ x: 0, y: 0, z: 0 }).getProperties(), {});
        const p = b.position.offset(1, 0, 0);
        assert.deepEqual([p.x, p.y, p.z], [2, 64, 2]);
        assert.equal(b.position.plus(vec(0, 1, 0)).y, 65);
        assert.equal(vec(1.5, 2.5, 3.5).floored().equals(vec(1, 2, 3)), true);
        assert.equal(vec(0, 0, 0).distanceTo(vec(3, 4, 0)), 5);
        assert.equal(vec(1, 2, 3).clone().toString(), '(1, 2, 3)');
        assert.equal(vec(1, 2, 3).equals(null), false);
    });

    test('house: walls, posts, door, windows, bed, chest, the returned positions', () => {
        const world = createBlockWorld().flatGround(63);
        const house = world.house({ x: 0, y: 63, z: 0 });
        assert.deepEqual(house.min, { x: 0, y: 63, z: 0 });
        assert.deepEqual(house.max, { x: 6, y: 67, z: 6 });
        assert.equal(world.get(0, 64, 0), 'oak_log');
        assert.equal(world.get(1, 64, 0), 'oak_planks');
        assert.equal(world.get(3, 67, 3), 'oak_planks');
        assert.deepEqual(house.door, { x: 3, y: 64, z: 6 });
        assert.equal(world.get(3, 65, 6), 'oak_door');
        assert.equal(world.blockAt(house.door).getProperties().half, 'lower');
        assert.equal(world.get(0, 65, 3), 'glass_pane');
        assert.equal(world.get(house.chest.x, house.chest.y, house.chest.z), 'chest');
        assert.deepEqual(house.bed.map(p => world.get(p.x, p.y, p.z)), ['red_bed', 'red_bed']);
        assert.equal(world.get(house.inside.x, house.inside.y, house.inside.z), 'air');
        assert.equal(world.get(house.inside.x, house.inside.y + 1, house.inside.z), 'air');
        assert.throws(() => world.house({ x: 0, y: 0, z: 0, width: 3 }), RangeError);
        assert.throws(() => world.house({ x: 0, y: 0, z: 0, door: 'up' }), TypeError);
    });

    test('house options: door on another side, no floor, no roof, other materials', () => {
        const world = createBlockWorld();
        const house = world.house({ x: 10, y: 70, z: 10, door: 'west', floor: null, roof: null, wall: 'stone_bricks', post: null, glass: null, bed: null, chest: null });
        assert.deepEqual(house.door, { x: 10, y: 71, z: 13 });
        assert.equal(house.min.y, 71);
        assert.equal(house.max.y, 73);
        assert.equal(world.get(10, 71, 10), 'stone_bricks');
        assert.equal(world.get(13, 74, 13), 'air');
        assert.deepEqual(house.windows, []);
        const east = createBlockWorld().house({ x: 0, y: 0, z: 0, door: 'east' });
        assert.deepEqual(east.windows, [{ x: 3, y: 2, z: 0 }, { x: 3, y: 2, z: 6 }]);
    });

    test('tree: soil, trunk, leaves that never replace other blocks', () => {
        const world = createBlockWorld().flatGround(63);
        world.set(9, 67, 3, 'oak_planks');
        const tree = world.tree({ x: 8, y: 63, z: 3 });
        assert.equal(world.get(8, 63, 3), 'dirt');
        assert.equal(tree.trunk.length, 5);
        assert.ok(tree.trunk.every(p => world.get(p.x, p.y, p.z) === 'oak_log'));
        assert.deepEqual(tree.top, { x: 8, y: 68, z: 3 });
        assert.equal(world.get(9, 67, 3), 'oak_planks');
        assert.equal(world.get(8, 69, 3), 'oak_leaves');
        assert.ok(tree.leaves.length > 20);
    });

    test('field: ground, crops, fence ring, gate, gaps and other sides', () => {
        const world = createBlockWorld().flatGround(63);
        const field = world.field({ x: 0, y: 63, z: 0, width: 5, depth: 4, gaps: [{ x: 5, z: 1 }], sides: { north: 'cobblestone_wall' } });
        assert.equal(world.get(0, 63, 0), 'farmland');
        assert.equal(world.get(4, 64, 3), 'wheat');
        assert.equal(world.get(-1, 64, 2), 'oak_fence');
        assert.equal(world.get(2, 64, -1), 'cobblestone_wall');
        assert.equal(world.get(5, 64, 1), 'air');
        assert.deepEqual(field.gate, { x: 2, y: 64, z: 4 });
        assert.equal(world.get(2, 64, 4), 'oak_fence_gate');
        assert.deepEqual(field.ring, { min: { x: -1, y: 64, z: -1 }, max: { x: 5, y: 64, z: 4 } });
        const gateEast = createBlockWorld().flatGround(63).field({ x: 0, y: 63, z: 0, gateSide: 'east', gate: 'spruce_fence_gate' });
        assert.deepEqual(gateEast.gate, { x: 5, y: 64, z: 2 });
        assert.equal(createBlockWorld().field({ x: 0, y: 0, z: 0, gate: null }).gate, null);
    });

    test('snapshot keeps a copy of all set blocks', () => {
        const world = createBlockWorld().set(0, 0, 0, 'stone');
        const before = world.snapshot();
        world.set(0, 0, 0, 'air');
        assert.equal(before.get('0,0,0'), 'stone');
        assert.equal(world.snapshot().get('0,0,0'), 'air');
    });
});
