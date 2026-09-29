// Fix round of v0.1.4.8, X1 (the escape part): the pure logic of the last step of the escape of the mode
// unstuck, src/agent/reflex/hole_logic.js. In the long run (w60) the bot stood inside the composter of the
// farm; the path search of moveAway could not plan from there and every order that walks was stopped by
// unstuck. The last step: for a bot in a hole of one block or inside a hollow block (composter, cauldron),
// jump and walk towards each of the four sides in turn, about 1 s each, and look after each whether the bot
// got out (more than 1 block from where it stood, its feet on a block it can stand on). Never into lava or
// fire, never off a drop of more than 3 blocks: the column of a side is tested first.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const H = await loadSrc('src/agent/reflex/hole_logic.js');

// The composter of the farm: flat grass at y 60, the composter at (0, 61, 0), the bot inside it at the
// height of the empty composter (61.125, as in the log of w60).
function composterWorld() {
    const world = createBlockWorld().flatGround(60);
    world.set(0, 61, 0, 'composter');
    return world;
}
const IN_COMPOSTER = { x: 0.5, y: 61.125, z: 0.5 };
const sidesOf = (list) => list.map((s) => [s.dx, s.dz]);

describe('holeAt: where the bot is caught', () => {
    test('inside a composter at every level, and inside the cauldrons', () => {
        const world = composterWorld();
        assert.deepEqual(H.holeAt(world.getBlockName, IN_COMPOSTER), { kind: 'hollow', x: 0, y: 61, z: 0, block: 'composter' });
        assert.equal(H.holeAt(world.getBlockName, { x: 0.5, y: 61.9375, z: 0.5 })?.kind, 'hollow', 'a full composter');
        for (const name of ['cauldron', 'water_cauldron', 'lava_cauldron', 'powder_snow_cauldron', 'minecraft:composter']) {
            world.set(0, 61, 0, name);
            assert.equal(H.holeAt(world.getBlockName, { x: 0.5, y: 61.25, z: 0.5 })?.kind, 'hollow', name);
        }
    });

    test('on top of a composter the bot is not caught', () => {
        const world = composterWorld();
        assert.equal(H.holeAt(world.getBlockName, { x: 0.5, y: 62, z: 0.5 }), null);
    });

    test('a hole of one block: the feet in air, a floor, all four sides closed at the height of the feet', () => {
        const world = createBlockWorld().flatGround(60);
        world.set(0, 60, 0, 'air');
        assert.deepEqual(H.holeAt(world.getBlockName, { x: 0.5, y: 60, z: 0.5 }), { kind: 'hole', x: 0, y: 60, z: 0, block: 'dirt' });
    });

    test('standing on farmland (lower than a full block): the feet are in the block above it', () => {
        const world = createBlockWorld().flatGround(60, 'farmland');
        for (const [dx, dz] of H.SIDES) world.set(dx, 61, dz, 'dirt');
        assert.deepEqual(H.holeAt(world.getBlockName, { x: 0.5, y: 60.9375, z: 0.5 }), { kind: 'hole', x: 0, y: 61, z: 0, block: 'farmland' });
    });

    test('no hole: flat ground, an open side, inside a solid block, a block that is not loaded, no position', () => {
        const flat = createBlockWorld().flatGround(60);
        assert.equal(H.holeAt(flat.getBlockName, { x: 0.5, y: 61, z: 0.5 }), null, 'flat ground');
        flat.set(0, 60, 0, 'air');
        flat.set(1, 60, 0, 'air');
        assert.equal(H.holeAt(flat.getBlockName, { x: 0.5, y: 60, z: 0.5 }), null, 'a trench: one side open');
        assert.equal(H.holeAt(flat.getBlockName, { x: 5.5, y: 58, z: 5.5 }), null, 'inside the dirt');
        const part = createBlockWorld({ loaded: { min: { x: -10, y: 0, z: -10 }, max: { x: 0, y: 100, z: 10 } } }).flatGround(60);
        part.set(0, 60, 0, 'air');
        assert.equal(H.holeAt(part.getBlockName, { x: 0.5, y: 60, z: 0.5 }), null, 'the east side is not loaded');
        assert.equal(H.holeAt(flat.getBlockName, null), null);
        assert.equal(H.holeAt(null, IN_COMPOSTER), null);
        assert.equal(H.holeAt(() => { throw new Error('boom'); }, IN_COMPOSTER), null, 'a reader that throws');
    });
});

describe('escapeSides: the sides to jump to, the column of each tested first', () => {
    test('the composter on flat ground: all four sides, north, east, south, west', () => {
        const sides = H.escapeSides(composterWorld().getBlockName, IN_COMPOSTER);
        assert.deepEqual(sidesOf(sides), [[0, -1], [1, 0], [0, 1], [-1, 0]]);
        assert.deepEqual(sides[0], { dx: 0, dz: -1, yaw: 0, x: 0, z: -1, landY: 61, ground: 'grass_block', drop: 0, rank: 0 });
    });

    test('never into lava or fire, never onto magma, a cactus or a campfire', () => {
        for (const [at, name] of [[[0, 60, -1], 'lava'], [[0, 61, -1], 'fire'], [[0, 61, -1], 'soul_fire'], [[0, 60, -1], 'magma_block'],
            [[0, 61, -1], 'cactus'], [[0, 61, -1], 'campfire'], [[0, 62, -1], 'lava'], [[0, 59, -1], 'lava']]) {
            const world = composterWorld();
            if (name === 'lava' && at[1] === 59) world.set(0, 60, -1, 'air'); // the bot would fall into it
            world.set(...at, name);
            const sides = sidesOf(H.escapeSides(world.getBlockName, IN_COMPOSTER));
            assert.ok(!sides.some(([dx, dz]) => dx === 0 && dz === -1), `${name} at ${at}: north is left out, ${JSON.stringify(sides)}`);
            assert.equal(sides.length, 3, name);
        }
    });

    test('a drop of 3 blocks is allowed, a drop of 4 is not', () => {
        const world = createBlockWorld().flatGround(56);
        world.fill(0, 57, 0, 0, 60, 0, 'stone'); // a pillar with the composter on top
        world.set(0, 61, 0, 'composter');
        assert.deepEqual(H.escapeSides(world.getBlockName, IN_COMPOSTER), [], 'the ground is 4 blocks down on every side');
        world.set(1, 57, 0, 'stone');
        const sides = H.escapeSides(world.getBlockName, IN_COMPOSTER);
        assert.deepEqual(sidesOf(sides), [[1, 0]]);
        assert.equal(sides[0].landY, 58);
        assert.equal(sides[0].drop, 3);
    });

    test('a step up onto a block at the height of the feet; never onto a fence, a wall, a gate or another composter', () => {
        const world = createBlockWorld().flatGround(60);
        world.set(0, 60, 0, 'air'); // a hole of one block
        world.set(0, 60, -1, 'oak_fence');
        world.set(1, 60, 0, 'cobblestone_wall');
        world.set(0, 60, 1, 'composter');
        const sides = H.escapeSides(world.getBlockName, { x: 0.5, y: 60, z: 0.5 });
        assert.deepEqual(sidesOf(sides), [[-1, 0]], 'only the grass to the west');
        assert.equal(sides[0].landY, 61);
        assert.equal(sides[0].drop, -1);
        assert.equal(sides[0].ground, 'grass_block');
    });

    test('no room for the body over a side: that side is left out', () => {
        const world = composterWorld();
        world.set(1, 62, 0, 'oak_planks');
        world.set(0, 63, -1, 'oak_planks');
        assert.deepEqual(sidesOf(H.escapeSides(world.getBlockName, IN_COMPOSTER)), [[0, 1], [-1, 0]]);
    });

    test('a hole of two blocks and the closed room of w31: nothing to jump to', () => {
        const shaft = createBlockWorld().flatGround(60);
        shaft.set(0, 60, 0, 'air');
        shaft.set(0, 59, 0, 'air');
        assert.equal(H.holeAt(shaft.getBlockName, { x: 0.5, y: 59, z: 0.5 })?.kind, 'hole');
        assert.deepEqual(H.escapeSides(shaft.getBlockName, { x: 0.5, y: 59, z: 0.5 }), [], 'the sides are 2 blocks high');
        const room = createBlockWorld().flatGround(60);
        room.fill(-1, 60, -1, 1, 63, 1, 'obsidian');
        room.fill(0, 61, 0, 0, 62, 0, 'air');
        assert.deepEqual(H.escapeSides(room.getBlockName, { x: 0.5, y: 61, z: 0.5 }), [], 'a roof over the bot');
    });

    test('plain ground first, farmland (it can be trampled) and water last', () => {
        const world = composterWorld();
        world.set(0, 60, -1, 'farmland'); // north
        world.set(0, 61, -1, 'wheat');
        world.set(1, 60, 0, 'water'); // east: the bot lands in water on the dirt under it
        const sides = H.escapeSides(world.getBlockName, IN_COMPOSTER);
        assert.deepEqual(sidesOf(sides), [[0, 1], [-1, 0], [0, -1], [1, 0]]);
        assert.deepEqual(sides.map((s) => s.rank), [0, 0, 1, 1]);
        assert.equal(sides[2].ground, 'farmland');
        assert.equal(sides[3].landY, 60);
    });

    test('a side that is not loaded is left out', () => {
        const world = createBlockWorld({ loaded: { min: { x: -5, y: 0, z: -5 }, max: { x: 0, y: 100, z: 5 } } }).flatGround(60);
        world.set(0, 61, 0, 'composter');
        assert.deepEqual(sidesOf(H.escapeSides(world.getBlockName, IN_COMPOSTER)), [[0, -1], [0, 1], [-1, 0]]);
    });

    test('not caught: no sides', () => {
        assert.deepEqual(H.escapeSides(createBlockWorld().flatGround(60).getBlockName, { x: 0.5, y: 61, z: 0.5 }), []);
    });
});

describe('sideYaw: the yaw of mineflayer towards a side', () => {
    test('north 0, east -pi/2, south pi, west pi/2 (as bot.lookAt computes it)', () => {
        assert.equal(H.sideYaw(0, -1), 0);
        assert.ok(Math.abs(H.sideYaw(1, 0) + Math.PI / 2) < 1e-12);
        assert.ok(Math.abs(Math.abs(H.sideYaw(0, 1)) - Math.PI) < 1e-12);
        assert.ok(Math.abs(H.sideYaw(-1, 0) - Math.PI / 2) < 1e-12);
        assert.ok(!Object.is(H.sideYaw(0, -1), -0));
    });
});

describe('walkControls: one tick of the walk towards a side', () => {
    const hole = { x: 0, y: 61, z: 0 };

    test('in the hole: forward and jump', () => {
        assert.deepEqual(H.walkControls({ hole, pos: IN_COMPOSTER, onGround: true, elapsedMs: 0 }), { forward: true, jump: true, done: false });
    });

    test('over the wall, out of the column: no more jumps (no hopping over farmland), forward until 1.1 blocks', () => {
        assert.deepEqual(H.walkControls({ hole, pos: { x: 1.2, y: 62.2, z: 0.5 }, onGround: false, elapsedMs: 400 }), { forward: true, jump: false, done: false });
    });

    test('far enough and on the ground: done; far enough in the air: wait for the landing', () => {
        assert.deepEqual(H.walkControls({ hole, pos: { x: 1.7, y: 61, z: 0.5 }, onGround: true, elapsedMs: 600 }), { forward: false, jump: false, done: true });
        assert.deepEqual(H.walkControls({ hole, pos: { x: 1.7, y: 61.4, z: 0.5 }, onGround: false, elapsedMs: 600 }), { forward: false, jump: false, done: false });
    });

    test('about 1 s: the time of the step is over', () => {
        assert.deepEqual(H.walkControls({ hole, pos: IN_COMPOSTER, onGround: true, elapsedMs: 1000 }), { forward: false, jump: false, done: true });
        assert.deepEqual(H.walkControls({ hole, pos: IN_COMPOSTER, onGround: true, elapsedMs: NaN }), { forward: false, jump: false, done: true });
    });

    test('nothing to steer: done', () => {
        assert.deepEqual(H.walkControls(null), { forward: false, jump: false, done: true });
        assert.deepEqual(H.walkControls({ hole, pos: null, elapsedMs: 0 }), { forward: false, jump: false, done: true });
    });
});

describe('leftHole: did the bot get out', () => {
    const hole = { kind: 'hollow', x: 0, y: 61, z: 0, block: 'composter' };

    test('more than 1 block away, out of the column, on the grass: out', () => {
        const world = composterWorld();
        assert.equal(H.leftHole(world.getBlockName, hole, IN_COMPOSTER, { x: 1.7, y: 61, z: 0.5 }, true), true);
        assert.equal(H.leftHole(world.getBlockName, hole, IN_COMPOSTER, { x: 1.7, y: 61, z: 0.5 }), true, 'onGround not known');
    });

    test('on farmland (the feet in its block) and on a carpet: out', () => {
        const world = composterWorld();
        world.set(1, 60, 0, 'farmland');
        assert.equal(H.leftHole(world.getBlockName, hole, IN_COMPOSTER, { x: 1.7, y: 60.9375, z: 0.5 }, true), true);
        world.set(0, 61, 1, 'white_carpet');
        assert.equal(H.leftHole(world.getBlockName, hole, IN_COMPOSTER, { x: 0.5, y: 61.0625, z: 1.7 }, true), true);
    });

    test('1 block or less away, still in the column, in the air, in water, inside another composter: not out', () => {
        const world = composterWorld();
        assert.equal(H.leftHole(world.getBlockName, hole, IN_COMPOSTER, { x: 1.45, y: 61, z: 0.5 }, true), false, '0.95 blocks away');
        assert.equal(H.leftHole(world.getBlockName, hole, IN_COMPOSTER, { x: 0.5, y: 62.9, z: 0.5 }, false), false, 'jumped up, same column');
        assert.equal(H.leftHole(world.getBlockName, hole, IN_COMPOSTER, { x: 1.7, y: 61.5, z: 0.5 }, false), false, 'in the air');
        world.set(0, 60, -2, 'water');
        world.set(0, 59, -2, 'water');
        assert.equal(H.leftHole(world.getBlockName, hole, IN_COMPOSTER, { x: 0.5, y: 60.2, z: -1.5 }, true), false, 'in water');
        world.set(-2, 61, 0, 'composter');
        assert.equal(H.leftHole(world.getBlockName, hole, IN_COMPOSTER, { x: -1.5, y: 61.125, z: 0.5 }, true), false, 'another composter');
        assert.equal(H.leftHole(world.getBlockName, null, IN_COMPOSTER, { x: 1.7, y: 61, z: 0.5 }, true), false);
    });
});

describe('the names', () => {
    test('passable, danger, hollow, standable', () => {
        for (const name of ['air', 'water', 'short_grass', 'wheat', 'torch', 'wall_torch', 'oak_sapling', 'red_tulip', 'white_carpet', 'stone_button',
            'oak_pressure_plate', 'oak_sign', 'rail', 'snow', 'leaf_litter', 'minecraft:air'])
            assert.equal(H.isPassableName(name), true, name);
        for (const name of ['stone', 'composter', 'oak_fence', 'farmland', 'lava', null, '', 42])
            assert.equal(H.isPassableName(name), false, String(name));
        for (const name of ['lava', 'fire', 'soul_fire', 'magma_block', 'cactus', 'campfire', 'sweet_berry_bush', 'powder_snow'])
            assert.equal(H.isDangerName(name), true, name);
        assert.equal(H.isHollowName('composter'), true);
        assert.equal(H.isHollowName('stone'), false);
        for (const name of ['grass_block', 'farmland', 'oak_planks', 'glass', 'oak_slab'])
            assert.equal(H.isStandableName(name), true, name);
        for (const name of ['air', 'lava', 'composter', 'cauldron', 'oak_fence', 'cobblestone_wall', 'oak_fence_gate', null])
            assert.equal(H.isStandableName(name), false, String(name));
    });

    test('the rules', () => {
        assert.equal(H.HOLE_RULES.stepMs, 1000, 'about 1 s per side');
        assert.equal(H.HOLE_RULES.maxDrop, 3, 'never a drop of more than 3 blocks');
        assert.equal(H.HOLE_RULES.outBlocks, 1, 'out: more than 1 block');
        assert.deepEqual(H.SIDES, [[0, -1], [1, 0], [0, 1], [-1, 0]]);
        assert.ok(Object.isFrozen(H.HOLE_RULES) && Object.isFrozen(H.SIDES));
    });
});

describe('module rules', () => {
    test('hole_logic.js imports nothing and is importable without output or files', () => {
        assertImportRules('src/agent/reflex/hole_logic.js', { allowBuiltins: [], allowedRelative: [] });
        assertCleanImport('src/agent/reflex/hole_logic.js');
    });
});
