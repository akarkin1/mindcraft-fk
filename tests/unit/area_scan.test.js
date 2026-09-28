// Spec v0.1.4.6 A3: src/agent/areas/area_scan.js -- scanBuilding and scanFarm on a block world in memory.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';
import { createBlockWorld } from '../helpers/block_world.js';

const MODULE = 'src/agent/areas/area_scan.js';
const A = await loadSrc(MODULE);

// Flat ground: grass at y 63, dirt below. Houses stand with their floor at y 63.
const flat = () => createBlockWorld().flatGround(63);

// Number of blocks of the default house of block_world.js (7 x 7, walls 3 high):
// floor 49 + walls 3 x 24 (with 4 posts, 2 door blocks, 2 windows) + roof 49 + bed 2 + chest 1.
const HOUSE_BLOCKS = 49 + 72 + 49 + 2 + 1;

const box = (x1, y1, z1, x2, y2, z2) => ({ min: { x: x1, y: y1, z: z1 }, max: { x: x2, y: y2, z: z2 } });

function boxOf(result) {
    return { min: result.min, max: result.max };
}

function covers(outer, inner) {
    return outer.min.x <= inner.min.x && outer.min.y <= inner.min.y && outer.min.z <= inner.min.z
        && outer.max.x >= inner.max.x && outer.max.y >= inner.max.y && outer.max.z >= inner.max.z;
}

function sizeOf(b) {
    return { x: b.max.x - b.min.x + 1, y: b.max.y - b.min.y + 1, z: b.max.z - b.min.z + 1 };
}

describe('isBuiltBlock(name)', () => {
    test('names from the spec count as built', () => {
        const built = [
            'oak_planks', 'spruce_stairs', 'stone_slab', 'oak_door', 'iron_door', 'oak_trapdoor', 'glass',
            'glass_pane', 'white_stained_glass_pane', 'bricks', 'stone_bricks', 'white_wool', 'red_concrete',
            'white_glazed_terracotta', 'white_carpet', 'oak_fence', 'oak_fence_gate', 'cobblestone_wall',
            'cobblestone', 'bookshelf', 'crafting_table', 'furnace', 'chest', 'barrel', 'ladder', 'torch',
            'wall_torch', 'lantern', 'red_bed', 'white_bed',
        ];
        for (const name of built) assert.equal(A.isBuiltBlock(name), true, name);
    });

    // Amendment 1: houses of worked stone and quartz are recognised.
    test('worked stone, quartz and a few more building blocks count as built', () => {
        const built = [
            'smooth_stone', 'smooth_sandstone', 'polished_andesite', 'polished_granite', 'polished_deepslate',
            'cut_sandstone', 'cut_copper', 'chiseled_stone_bricks', 'chiseled_quartz_block',
            'quartz_block', 'quartz_pillar', 'smooth_quartz', 'quartz_bricks',
            'iron_bars', 'hay_block', 'scaffolding',
        ];
        for (const name of built) assert.equal(A.isBuiltBlock(name), true, name);
    });

    // Amendment 1: terracotta is the ground of badlands, only the glazed kind is made by a player.
    test('terracotta counts only when it is glazed; geode shells and quartz ore are natural', () => {
        for (const name of ['terracotta', 'orange_terracotta', 'white_terracotta', 'smooth_basalt',
            'nether_quartz_ore']) {
            assert.equal(A.isBuiltBlock(name), false, name);
        }
        for (const name of ['white_glazed_terracotta', 'minecraft:red_glazed_terracotta']) {
            assert.equal(A.isBuiltBlock(name), true, name);
        }
    });

    test('variants of the named blocks count too (soul and redstone torches, other chests and furnaces)', () => {
        for (const name of ['soul_torch', 'soul_wall_torch', 'redstone_torch', 'soul_lantern', 'trapped_chest',
            'ender_chest', 'blast_furnace', 'smoker', 'mossy_cobblestone']) {
            assert.equal(A.isBuiltBlock(name), true, name);
        }
    });

    test('natural blocks, logs and leaves do not count; moss carpets grow naturally and do not count', () => {
        const natural = [
            'air', 'dirt', 'grass_block', 'stone', 'sand', 'water', 'lava', 'bedrock', 'short_grass', 'oak_log',
            'oak_wood', 'stripped_oak_log', 'oak_leaves', 'farmland', 'wheat', 'moss_carpet', 'pale_moss_carpet',
            'gravel', 'deepslate', 'snow',
        ];
        for (const name of natural) assert.equal(A.isBuiltBlock(name), false, name);
    });

    test('not a name: false', () => {
        for (const value of [null, undefined, '', 42, {}]) assert.equal(A.isBuiltBlock(value), false, String(value));
    });

    test('a "minecraft:" prefix is ignored', () => {
        assert.equal(A.isBuiltBlock('minecraft:oak_planks'), true);
        assert.equal(A.isBuiltBlock('minecraft:dirt'), false);
    });
});

describe('isLogBlock(name)', () => {
    test('names ending with _log or _wood, stripped ones too', () => {
        for (const name of ['oak_log', 'dark_oak_log', 'stripped_spruce_log', 'birch_wood', 'stripped_oak_wood']) {
            assert.equal(A.isLogBlock(name), true, name);
        }
        for (const name of ['oak_planks', 'oak_leaves', 'dirt', null, '']) assert.equal(A.isLogBlock(name), false, String(name));
    });
});

describe('scanBuilding: a house of planks with oak log corner posts', () => {
    test('finds the house: box = blocks grown by 1, the door, the number of blocks', () => {
        const world = flat();
        const house = world.house({ x: 0, y: 63, z: 0 });
        const result = A.scanBuilding(world.getBlockName, house.inside);
        assert.equal(result.found, true);
        assert.deepEqual(boxOf(result), box(-1, 62, -1, 7, 68, 7));
        assert.equal(result.blocks, HOUSE_BLOCKS);
        assert.deepEqual(result.entrances, [{ x: 3, y: 64, z: 6, kind: 'door' }]);
        assert.equal(result.clipped, false);
    });

    test('the same result from a fractional position inside and from just outside the door', () => {
        const world = flat();
        world.house({ x: 0, y: 63, z: 0 });
        const inside = A.scanBuilding(world.getBlockName, { x: 3.5, y: 64, z: 3.5 });
        const outside = A.scanBuilding(world.getBlockName, { x: 3.5, y: 64, z: 8.3 });
        assert.deepEqual(boxOf(inside), box(-1, 62, -1, 7, 68, 7));
        assert.deepEqual(outside, inside);
    });

    test('the corner posts of oak logs are part of it (a log touched by planks)', () => {
        const world = flat();
        world.house({ x: 0, y: 63, z: 0, wall: 'oak_planks', post: 'oak_log' });
        const withPosts = A.scanBuilding(world.getBlockName, { x: 3, y: 64, z: 3 });
        const plain = flat();
        plain.house({ x: 0, y: 63, z: 0, post: null });
        assert.equal(withPosts.blocks, A.scanBuilding(plain.getBlockName, { x: 3, y: 64, z: 3 }).blocks);
    });

    test('the result is within the size limit of an area (64 x 48 x 64)', () => {
        const world = flat();
        const house = world.house({ x: 0, y: 63, z: 0 });
        const size = sizeOf(A.scanBuilding(world.getBlockName, house.inside));
        assert.ok(size.x <= 64 && size.y <= 48 && size.z <= 64, JSON.stringify(size));
    });
});

describe('scanBuilding: hard worlds', () => {
    test('a tree one block away from the wall is not part of the house', () => {
        const world = flat();
        const house = world.house({ x: 0, y: 63, z: 0 });
        const tree = world.tree({ x: 8, y: 63, z: 3 });
        const result = A.scanBuilding(world.getBlockName, house.inside);
        assert.deepEqual(boxOf(result), box(-1, 62, -1, 7, 68, 7));
        assert.equal(result.blocks, HOUSE_BLOCKS);
        for (const log of tree.trunk) assert.ok(log.x > result.max.x, 'trunk outside the box');
    });

    test('a tree whose trunk touches the wall: the trunk counts (spec: a log touched by a built block), the leaves do not', () => {
        const world = flat();
        const house = world.house({ x: 0, y: 63, z: 0 });
        const tree = world.tree({ x: 7, y: 63, z: 3, height: 5 });
        const result = A.scanBuilding(world.getBlockName, house.inside);
        assert.equal(result.found, true);
        assert.equal(result.blocks, HOUSE_BLOCKS + tree.trunk.length);
        assert.ok(covers(boxOf(result), house), 'the whole house is inside the box');
        assert.deepEqual(boxOf(result), box(-1, 62, -1, 8, 69, 7), 'house plus trunk, grown by 1');
        assert.equal(result.clipped, false);
    });

    test('a log house without planks, with a door and glass: the logs count through the door and the glass', () => {
        const world = flat();
        const house = world.house({ x: 0, y: 63, z: 0, floor: null, wall: 'oak_log', post: 'oak_log', roof: 'oak_log', bed: null, chest: null });
        const result = A.scanBuilding(world.getBlockName, house.inside);
        assert.equal(result.found, true);
        assert.equal(result.blocks, 68 + 49 + 2 + 2, '68 wall logs, 49 roof logs, 2 door blocks, 2 windows');
        assert.deepEqual(boxOf(result), box(-1, 63, -1, 7, 68, 7));
        assert.deepEqual(result.entrances, [{ x: 3, y: 64, z: 6, kind: 'door' }]);
    });

    test('a log hut without any built block is not a building (logs alone do not count)', () => {
        const world = flat();
        const hut = world.house({ x: 0, y: 63, z: 0, floor: null, wall: 'oak_log', post: 'oak_log', roof: 'oak_log', door: null, glass: null, bed: null, chest: null });
        const result = A.scanBuilding(world.getBlockName, hut.inside);
        assert.equal(result.found, false);
        assert.equal(result.min, null);
        assert.equal(result.max, null);
    });

    test('two houses 5 blocks apart: only the house the bot is in', () => {
        const world = flat();
        const a = world.house({ x: 0, y: 63, z: 0 });
        const b = world.house({ x: 12, y: 63, z: 0 });
        assert.deepEqual(boxOf(A.scanBuilding(world.getBlockName, a.inside)), box(-1, 62, -1, 7, 68, 7));
        assert.deepEqual(boxOf(A.scanBuilding(world.getBlockName, b.inside)), box(11, 62, -1, 19, 68, 7));
    });

    test('two houses 3 blocks apart, bot at the wall that faces the other house: still only its own house', () => {
        const world = flat();
        world.house({ x: 0, y: 63, z: 0 });
        world.house({ x: 10, y: 63, z: 0 });
        // x 5 is the last free column inside house A; house B starts at x 10, 5 blocks away.
        const result = A.scanBuilding(world.getBlockName, { x: 5.5, y: 64, z: 4.5 });
        assert.deepEqual(boxOf(result), box(-1, 62, -1, 7, 68, 7));
        assert.equal(result.blocks, HOUSE_BLOCKS);
    });

    test('between two houses, outside: the nearer house', () => {
        const world = flat();
        world.house({ x: 0, y: 63, z: 0 });
        world.house({ x: 12, y: 63, z: 0 });
        assert.deepEqual(boxOf(A.scanBuilding(world.getBlockName, { x: 8.5, y: 64, z: 3.5 })), box(-1, 62, -1, 7, 68, 7));
        assert.deepEqual(boxOf(A.scanBuilding(world.getBlockName, { x: 10.5, y: 64, z: 3.5 })), box(11, 62, -1, 19, 68, 7));
    });

    test('a house on a slope: the natural ground around it is not part of it', () => {
        const world = flat();
        // Terrain rises by one block every 4 blocks to the east: x 0 has its top at 65, x 6 at 67.
        for (let x = -12; x <= 20; x++) {
            const top = 63 + Math.floor((x + 12) / 4);
            for (let z = -8; z <= 14; z++) {
                world.fill(x, 60, z, x, top - 1, z, 'dirt');
                world.set(x, top, z, 'grass_block');
            }
        }
        const house = world.house({ x: 0, y: 66, z: 0 });
        const result = A.scanBuilding(world.getBlockName, house.inside);
        assert.equal(result.found, true);
        assert.equal(result.blocks, HOUSE_BLOCKS);
        assert.deepEqual(boxOf(result), box(-1, 65, -1, 7, 71, 7));
    });

    test('a house bigger than the limit: clipped at 24 blocks from the bot, the box still fits an area', () => {
        const world = flat();
        world.house({ x: -35, y: 63, z: 0, width: 70, depth: 7, door: null });
        const result = A.scanBuilding(world.getBlockName, { x: 0.5, y: 64, z: 3.5 });
        assert.equal(result.found, true);
        assert.equal(result.clipped, true);
        assert.equal(result.min.x, -25);
        assert.equal(result.max.x, 25);
        const size = sizeOf(result);
        assert.ok(size.x <= 64 && size.y <= 48 && size.z <= 64, JSON.stringify(size));
    });

    test('a log tower on the roof, higher than the limit: the logs count up to the limit, clipped', () => {
        const world = flat();
        const house = world.house({ x: 0, y: 63, z: 0 });
        world.fill(3, 68, 3, 3, 110, 3, 'oak_log');
        const result = A.scanBuilding(world.getBlockName, house.inside);
        assert.equal(result.clipped, true);
        assert.equal(result.max.y, 64 + 16 + 1, 'logs up to 16 above the bot, grown by 1');
        assert.equal(result.blocks, HOUSE_BLOCKS + (80 - 68 + 1));
    });

    test('a village-like row of fences with lamp posts does not pull the next house in', () => {
        const world = flat();
        world.house({ x: 0, y: 63, z: 0 });
        world.house({ x: 30, y: 63, z: 0 });
        world.fill(7, 64, 3, 29, 64, 3, 'oak_fence');
        for (const x of [12, 17, 22, 27]) world.set(x, 65, 3, 'torch');
        const result = A.scanBuilding(world.getBlockName, { x: 3.5, y: 64, z: 3.5 });
        assert.equal(result.found, true);
        assert.equal(result.clipped, false);
        assert.ok(result.max.x <= 8, `the fence post touching the wall may join, not the row: ${JSON.stringify(boxOf(result))}`);
        assert.equal(result.blocks, HOUSE_BLOCKS + 1);
    });

    test('a fenced field next to the house is not part of the house', () => {
        const world = flat();
        const house = world.house({ x: 0, y: 63, z: 0 });
        world.field({ x: 9, y: 63, z: 0, width: 6, depth: 6 });
        const result = A.scanBuilding(world.getBlockName, house.inside);
        assert.deepEqual(boxOf(result), box(-1, 62, -1, 7, 68, 7));
    });

    test('a position in the open: nothing found', () => {
        const world = flat();
        world.tree({ x: 3, y: 63, z: 3 });
        const result = A.scanBuilding(world.getBlockName, { x: 0.5, y: 64, z: 0.5 });
        assert.equal(result.found, false);
        assert.equal(result.blocks, 0);
        assert.deepEqual(result.entrances, []);
        assert.equal(result.clipped, false);
    });

    test('a house farther than 6 blocks is not found (the start takes built blocks within 6 blocks)', () => {
        const world = flat();
        world.house({ x: 0, y: 63, z: 0 });
        assert.equal(A.scanBuilding(world.getBlockName, { x: 3.5, y: 64, z: 14.5 }).found, false, 'the door wall is at z 6, 8 away');
        assert.equal(A.scanBuilding(world.getBlockName, { x: 3.5, y: 64, z: 12.5 }).found, true, '6 away');
    });

    test('fewer than 12 blocks is not a building; the option minBlocks changes that', () => {
        const world = flat();
        world.fill(0, 64, 0, 4, 64, 1, 'oak_planks'); // 10 blocks
        assert.equal(A.scanBuilding(world.getBlockName, { x: 2, y: 64, z: 3 }).found, false);
        const small = A.scanBuilding(world.getBlockName, { x: 2, y: 64, z: 3 }, { minBlocks: 10 });
        assert.equal(small.found, true);
        assert.equal(small.blocks, 10);
    });

    test('options radius and height limit the search', () => {
        const world = flat();
        world.house({ x: -20, y: 63, z: 0, width: 41, depth: 7, door: null });
        const result = A.scanBuilding(world.getBlockName, { x: 0.5, y: 64, z: 3.5 }, { radius: 10, height: 2 });
        assert.equal(result.clipped, true);
        assert.deepEqual([result.min.x, result.max.x], [-11, 11]);
        assert.deepEqual([result.min.y, result.max.y], [62, 67], 'the roof at 67 is 3 above the bot, beyond height 2');
    });

    test('option gap: with gap 4, two houses 3 blocks apart (walls 4 apart) are one building', () => {
        const world = flat();
        world.house({ x: 0, y: 63, z: 0 });
        world.house({ x: 10, y: 63, z: 0 });
        const joined = A.scanBuilding(world.getBlockName, { x: 3.5, y: 64, z: 3.5 }, { gap: 4 });
        assert.equal(joined.max.x, 17);
        assert.equal(joined.blocks, 2 * HOUSE_BLOCKS);
    });

    test('entrances: every door once (lower block), fence gates of the building, sorted', () => {
        const world = flat();
        world.house({ x: 0, y: 63, z: 0 });
        world.set(3, 64, 0, 'spruce_door', { half: 'lower' }).set(3, 65, 0, 'spruce_door', { half: 'upper' });
        world.set(0, 64, 2, 'oak_fence_gate');
        const result = A.scanBuilding(world.getBlockName, { x: 3, y: 64, z: 3 });
        assert.deepEqual(result.entrances, [
            { x: 0, y: 64, z: 2, kind: 'gate' },
            { x: 3, y: 64, z: 0, kind: 'door' },
            { x: 3, y: 64, z: 6, kind: 'door' },
        ]);
    });

    test('unloaded blocks (null) are not built; a getBlockName that throws counts as unloaded', () => {
        const world = flat();
        world.house({ x: 0, y: 63, z: 0 });
        world.setLoaded(box(-30, 0, -30, 3, 100, 30));
        const half = A.scanBuilding(world.getBlockName, { x: 2, y: 64, z: 3 });
        assert.equal(half.found, true);
        assert.equal(half.max.x, 4, 'blocks up to x 3 are loaded');
        const broken = A.scanBuilding(() => { throw new Error('chunk error'); }, { x: 0, y: 64, z: 0 });
        assert.equal(broken.found, false);
    });

    test('a very big built volume finishes quickly and is clipped', () => {
        const world = createBlockWorld();
        world.fill(-30, 50, -30, 30, 80, 30, 'stone_bricks');
        const started = performance.now();
        const result = A.scanBuilding(world.getBlockName, { x: 0, y: 64, z: 0 });
        const ms = performance.now() - started;
        assert.equal(result.clipped, true);
        assert.deepEqual(sizeOf(result), { x: 51, y: 33, z: 51 });
        assert.ok(ms < 5000, `took ${ms} ms`);
    });

    test('invalid input: a TypeError', () => {
        assert.throws(() => A.scanBuilding(null, { x: 0, y: 0, z: 0 }), TypeError);
        assert.throws(() => A.scanBuilding(() => 'air', { x: NaN, y: 0, z: 0 }), TypeError);
        assert.throws(() => A.scanBuilding(() => 'air', null), TypeError);
    });
});

describe('scanFarm: fenced ground', () => {
    test('finds the field: cells, box of cells and fence from 1 below the ground to 3 above, the gate', () => {
        const world = flat();
        const field = world.field({ x: 20, y: 63, z: 0, width: 5, depth: 6 });
        const result = A.scanFarm(world.getBlockName, field.inside);
        assert.equal(result.found, true);
        assert.equal(result.reason, null);
        assert.equal(result.cells, 30);
        assert.deepEqual(boxOf(result), box(19, 62, -1, 25, 66, 6));
        assert.deepEqual(result.entrances, [{ x: 22, y: 64, z: 6, kind: 'gate' }]);
    });

    test('standing on farmland (feet at y + 0.9375) gives the same result as standing in the crop', () => {
        const world = flat();
        world.field({ x: 20, y: 63, z: 0, width: 5, depth: 6 });
        const inCrop = A.scanFarm(world.getBlockName, { x: 22.5, y: 64, z: 2.5 });
        const onFarmland = A.scanFarm(world.getBlockName, { x: 22.5, y: 63.9375, z: 2.5 });
        assert.deepEqual(onFarmland, inCrop);
        assert.equal(inCrop.found, true);
    });

    test('a field whose fence has a gap is not enclosed', () => {
        const world = flat();
        const field = world.field({ x: 20, y: 63, z: 0, width: 5, depth: 6, gaps: [{ x: 25, z: 2 }] });
        const result = A.scanFarm(world.getBlockName, field.inside);
        assert.equal(result.found, false);
        assert.equal(result.reason, 'not_enclosed');
        assert.equal(result.min, null);
        assert.equal(result.max, null);
        assert.deepEqual(result.entrances, []);
    });

    test('an open gate is still a boundary (only the name counts)', () => {
        const world = flat();
        const field = world.field({ x: 20, y: 63, z: 0 });
        world.set(field.gate.x, field.gate.y, field.gate.z, 'oak_fence_gate', { open: true });
        assert.equal(A.scanFarm(world.getBlockName, field.inside).found, true);
    });

    test('a cobblestone wall on one side and a fence on the others', () => {
        const world = flat();
        const field = world.field({ x: 20, y: 63, z: 0, width: 5, depth: 5, sides: { east: 'cobblestone_wall' } });
        const result = A.scanFarm(world.getBlockName, field.inside);
        assert.equal(result.found, true);
        assert.equal(result.cells, 25);
        assert.deepEqual(boxOf(result), box(19, 62, -1, 25, 66, 5));
    });

    test('the wall of a house on one side and a fence on the others', () => {
        const world = flat();
        world.house({ x: 0, y: 63, z: 0 });
        // Ground x 7..11, z 2..4; the fence ring would stand on x 6, which is the house wall.
        const field = world.field({ x: 7, y: 63, z: 2, width: 5, depth: 3, sides: { west: null } });
        const result = A.scanFarm(world.getBlockName, field.inside);
        assert.equal(result.found, true, JSON.stringify(result));
        assert.equal(result.cells, 15);
        assert.deepEqual(boxOf(result), box(6, 62, 1, 12, 66, 5));
    });

    test('a water channel through the field is part of it', () => {
        const world = flat();
        const field = world.field({ x: 20, y: 63, z: 0, width: 7, depth: 5 });
        world.fill(23, 63, 0, 23, 63, 4, 'water');
        world.fill(23, 64, 0, 23, 64, 4, 'air');
        const result = A.scanFarm(world.getBlockName, field.inside);
        assert.equal(result.found, true);
        assert.equal(result.cells, 35);
    });

    test('a field on a slope with steps of one block', () => {
        const world = flat();
        world.field({ x: 20, y: 63, z: 0, width: 6, depth: 4, crop: null, ground: 'grass_block' });
        // The eastern half is one block higher, the fence there stands one higher too.
        world.fill(23, 64, 0, 25, 64, 3, 'grass_block');
        world.fill(22, 65, -1, 26, 65, -1, 'oak_fence');
        world.fill(22, 64, -1, 26, 64, -1, 'dirt');
        world.fill(22, 65, 4, 26, 65, 4, 'oak_fence');
        world.fill(22, 64, 4, 26, 64, 4, 'dirt');
        world.fill(26, 65, 0, 26, 65, 3, 'oak_fence');
        world.fill(26, 64, 0, 26, 64, 3, 'dirt');
        const result = A.scanFarm(world.getBlockName, { x: 21.5, y: 64, z: 1.5 });
        assert.equal(result.found, true, JSON.stringify(result));
        assert.equal(result.cells, 24);
        assert.deepEqual([result.min.y, result.max.y], [62, 67]);
    });

    test('a field whose fence is more than 24 blocks away is not enclosed; the option radius changes that', () => {
        const world = flat();
        world.field({ x: 0, y: 63, z: 0, width: 60, depth: 5, gate: null });
        const result = A.scanFarm(world.getBlockName, { x: 2.5, y: 64, z: 2.5 });
        assert.equal(result.found, false);
        assert.equal(result.reason, 'not_enclosed');
        assert.equal(A.scanFarm(world.getBlockName, { x: 2.5, y: 64, z: 2.5 }, { radius: 60 }).found, true);
    });

    test('a position in the open is not enclosed', () => {
        const world = flat();
        const result = A.scanFarm(world.getBlockName, { x: 0.5, y: 64, z: 0.5 });
        assert.equal(result.found, false);
        assert.equal(result.reason, 'not_enclosed');
    });

    test('no ground under the bot: reason no_ground', () => {
        const world = createBlockWorld();
        const result = A.scanFarm(world.getBlockName, { x: 0.5, y: 64, z: 0.5 });
        assert.equal(result.found, false);
        assert.equal(result.reason, 'no_ground');
    });

    test('the search reaches unloaded blocks: reason not_loaded', () => {
        const world = flat();
        world.setLoaded(box(-5, 0, -5, 5, 100, 5));
        const result = A.scanFarm(world.getBlockName, { x: 0.5, y: 64, z: 0.5 });
        assert.equal(result.found, false);
        assert.equal(result.reason, 'not_loaded');
    });

    test('the blocks above the ground are not loaded: reason not_loaded', () => {
        const world = flat();
        world.setLoaded(box(-50, 0, -50, 50, 64, 50));
        assert.equal(A.scanFarm(world.getBlockName, { x: 0.5, y: 64, z: 0.5 }).reason, 'not_loaded');
    });

    test('two gates: both are entrances', () => {
        const world = flat();
        const field = world.field({ x: 20, y: 63, z: 0, width: 5, depth: 5 });
        world.set(19, 64, 2, 'birch_fence_gate');
        const result = A.scanFarm(world.getBlockName, field.inside);
        assert.deepEqual(result.entrances, [
            { x: 19, y: 64, z: 2, kind: 'gate' },
            { x: 22, y: 64, z: 5, kind: 'gate' },
        ]);
    });

    test('invalid input: a TypeError', () => {
        assert.throws(() => A.scanFarm('world', { x: 0, y: 0, z: 0 }), TypeError);
        assert.throws(() => A.scanFarm(() => 'air', { x: 0, y: Infinity, z: 0 }), TypeError);
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
