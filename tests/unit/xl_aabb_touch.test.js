// v0.1.4.14, fix round (engineer E4): W88 ladders_native, the climb up ladder 1 through the trapdoor (G-7). The path
// search turns the bot at the top of the shaft towards the way out behind it and holds forward and jump; the bot is
// pressed against the floor block south of the trapdoor cell at z -2.3, where the float sums give its box a maxZ of
// -1.9999999999999998, a hair inside the block face at -2. prismarine-physics stopped a move only when the box was
// at or before the face, so the next tick moved the bot 0.018 into the block; the server refused that move and
// teleported it back (position packets at y 60.68 and 60.80, up to 98 in a row), and the climb dropped back 0.3 blocks.
// patches/prismarine-physics+1.11.1.patch: lib/aabb.js stops a move at a face the box is less than 1e-7 past, as the
// vanilla collision does (Shapes.collide, 1.0E-7).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { TEST_MC_VERSION } from '../helpers/load.js';

const require = createRequire(import.meta.url);
const AABB = require('prismarine-physics/lib/aabb.js');
const { Physics, PlayerState } = require('prismarine-physics');
const { Vec3 } = require('vec3');
const mcData = require('minecraft-data')(TEST_MC_VERSION);
const Block = require('prismarine-block')(TEST_MC_VERSION);

// the box of a player at z -2.3 (0.6 wide), as the physics makes it
const playerAt = (x, y, z) => new AABB(-0.3, 0, -0.3, 0.3, 1.8, 0.3).offset(x, y, z);

describe('the face of a block the box touches stops the move (1e-7)', () => {
    test('a box at z -2.3 has its south face a hair inside the block at z -2: the move south is stopped', () => {
        const box = playerAt(98.5, 100.681, -2.3);
        assert.ok(box.maxZ > -2, `the float sum: maxZ ${box.maxZ}`);
        const block = new AABB(98, 100, -2, 99, 101, -1);
        assert.ok(block.computeOffsetZ(box, 0.018) <= 1e-7, 'stopped at the face');
    });

    test('the same on x and y, both ways; a box truly before the face moves up to it; one past the face is not stopped', () => {
        const bx = new AABB(-0.3, 0, -0.3, 0.3, 1.8, 0.3).offset(-2.3, 0.5, 0.5); // maxX -1.9999999999999998
        assert.ok(new AABB(-2, 0, 0, -1, 1, 1).computeOffsetX(bx, 0.05) <= 1e-7);
        const bneg = playerAt(0.5, 0, 0.5).offset(0, 0, -0.2 + 1e-12); // minZ a hair past the face at 0
        assert.ok(new AABB(0, 0, -1, 1, 1, 0).computeOffsetZ(bneg, -0.05) >= -1e-7, 'moving north onto the face');
        const feet = new AABB(0, 64 - 1e-12, 0, 1, 66, 1);
        assert.ok(new AABB(0, 63, 0, 1, 64, 1).computeOffsetY(feet, -0.08) >= -1e-7, 'standing a hair inside the floor');
        const before = playerAt(0.5, 0.5, -0.4); // maxZ -0.1, the face at 0
        assert.ok(Math.abs(new AABB(0, 0, 0, 1, 1, 1).computeOffsetZ(before, 0.5) - 0.1) < 1e-9);
        const past = playerAt(0.5, 0.5, 0.1); // 0.4 into the block: the old rule, no stop
        assert.equal(new AABB(0, 0, 0, 1, 1, 1).computeOffsetZ(past, 0.05), 0.05);
    });
});

// the top of the trapdoor shaft of the base: ladders facing south at (98, 93..99, -3), the open trapdoor at (98, 100, -3),
// the floor of planks at y 100 around it, air above
function shaft() {
    return {
        getBlock(p) {
            const x = Math.floor(p.x);
            const y = Math.floor(p.y);
            const z = Math.floor(p.z);
            let b;
            if (x === 98 && z === -3 && y >= 93 && y <= 99) b = Block.fromProperties('ladder', { facing: 'south', waterlogged: false }, 0);
            else if (x === 98 && z === -3 && y === 100) b = Block.fromProperties('oak_trapdoor', { facing: 'south', half: 'top', open: true, powered: false, waterlogged: false }, 0);
            else if (y <= 100) b = Block.fromProperties('oak_planks', {}, 0);
            else b = Block.fromProperties('air', {}, 0);
            b.position = new Vec3(x, y, z);
            return b;
        },
    };
}

describe('W88: the climb out of the trapdoor cell towards the way out behind the bot', () => {
    test('pressed against the floor block at z -2.3 with forward and jump: never into it before the feet are over it', () => {
        const world = shaft();
        const physics = Physics(mcData, world);
        const bot = {
            entity: {
                position: new Vec3(98.5, 100.681, -2.3), velocity: new Vec3(0, 0.118, 0), onGround: false, isInWater: false, isInLava: false,
                isInWeb: false, isCollidedHorizontally: true, isCollidedVertically: false, elytraFlying: false, yaw: Math.PI, pitch: 0, effects: {},
            },
            jumpTicks: 0, jumpQueued: false, fireworkRocketDuration: 0, version: TEST_MC_VERSION, inventory: { slots: [] },
        };
        const control = { forward: true, back: false, left: false, right: false, jump: true, sprint: false, sneak: false };
        for (let i = 0; i < 30; i++) {
            const state = new PlayerState(bot, control);
            physics.simulatePlayer(state, world);
            state.apply(bot);
            const p = bot.entity.position;
            if (p.y < 101) {
                assert.ok(p.z + 0.3 <= -2 + 1e-6, `tick ${i}: the box in the floor block at y ${p.y.toFixed(3)}, z ${p.z}`);
            }
        }
    });
});
