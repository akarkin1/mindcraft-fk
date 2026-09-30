// Fix round 2 of v0.1.4.9, finding F1 (engineer E1): patches/prismarine-physics+1.10.0.patch. The physics of the
// bot knows that an open trapdoor over a ladder of the same facing is climbable (feature climbableTrapdoor) also
// for 1.21, and the bamboo, pale oak and copper trapdoors are trapdoors. The feature and the set of trapdoors are
// closures of Physics(), so the test proves them by what they do: a player that holds sneak in the cell of an
// open trapdoor over a ladder stays up only when the cell is climbable. Without the patch it drops to the ladder.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { repoPath } from '../helpers/paths.js';

const require = createRequire(import.meta.url);
const { Physics, PlayerState } = require('prismarine-physics');
const { Vec3 } = require('vec3');
const mcData = require('minecraft-data')('1.21.8');
const Block = require('prismarine-block')('1.21.8');

// the shaft of the base: ladders at (2, 41..59, -2), the trapdoor at (2, 60, -2), stone around, air above y 60
function shaft(trapdoor, ladderFacing = 'south') {
    return {
        getBlock(p) {
            const x = Math.floor(p.x);
            const y = Math.floor(p.y);
            const z = Math.floor(p.z);
            let b;
            if (x === 2 && z === -2 && y >= 41 && y <= 59) b = Block.fromProperties('ladder', { facing: ladderFacing, waterlogged: false }, 0);
            else if (x === 2 && z === -2 && y === 60) b = Block.fromProperties(trapdoor, { facing: 'south', half: 'top', open: true, powered: false, waterlogged: false }, 0);
            else b = Block.fromProperties(y > 60 || (x === 2 && z === -2) ? 'air' : 'stone', {}, 0);
            b.position = new Vec3(x, y, z);
            return b;
        },
    };
}

// the feet after 20 ticks of sneaking without moving, from (2.5, 60.2, -1.45) in the cell of the trapdoor
function heldAt(world) {
    const physics = Physics(mcData, world);
    const bot = {
        entity: {
            position: new Vec3(2.5, 60.2, -1.45), velocity: new Vec3(0, 0, 0), onGround: false, isInWater: false, isInLava: false, isInWeb: false,
            isCollidedHorizontally: false, isCollidedVertically: false, elytraFlying: false, yaw: 0, pitch: 0, effects: {},
        },
        jumpTicks: 0, jumpQueued: false, fireworkRocketDuration: 0, version: '1.21.8', inventory: { slots: [] },
    };
    const control = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: true };
    for (let i = 0; i < 20; i++) {
        const state = new PlayerState(bot, control);
        physics.simulatePlayer(state, world);
        state.apply(bot);
    }
    return bot.entity.position.y;
}

describe('F1: the patch of prismarine-physics for 1.21', () => {
    test('the feature climbableTrapdoor lists 1.21, the major version of 1.21.8', () => {
        assert.equal(mcData.version.majorVersion, '1.21');
        const features = JSON.parse(fs.readFileSync(repoPath('node_modules/prismarine-physics/lib/features.json'), 'utf8'));
        assert.ok(features.find(f => f.name === 'climbableTrapdoor').versions.includes('1.21'));
    });

    test('the patch file is there and changes the two files', () => {
        const patch = fs.readFileSync(repoPath('patches/prismarine-physics+1.10.0.patch'), 'utf8');
        assert.match(patch, /"1\.20", "1\.21"\]/);
        for (const name of ['bamboo_trapdoor', 'copper_trapdoor', 'waxed_oxidized_copper_trapdoor']) assert.ok(patch.includes(`blocksByName.${name}.id`), name);
        assert.equal(patch.includes('\r'), false, 'LF');
    });

    for (const trapdoor of ['oak_trapdoor', 'bamboo_trapdoor', 'pale_oak_trapdoor', 'copper_trapdoor', 'exposed_copper_trapdoor', 'weathered_copper_trapdoor',
        'oxidized_copper_trapdoor', 'waxed_copper_trapdoor', 'waxed_exposed_copper_trapdoor', 'waxed_weathered_copper_trapdoor', 'waxed_oxidized_copper_trapdoor']) {
        test(`an open ${trapdoor} over a ladder of the same facing is climbable: sneaking holds the bot in its cell`, () => {
            assert.ok(heldAt(shaft(trapdoor)) >= 60.19, trapdoor);
        });
    }

    test('the rule of the game stays: under a ladder of another facing the open trapdoor is not climbable', () => {
        assert.ok(heldAt(shaft('oak_trapdoor', 'east')) < 60, 'the ladder faces east');
    });
});
