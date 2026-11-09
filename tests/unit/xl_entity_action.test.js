// v0.1.4.14, part L (engineer E1): the actions of entity_action from Minecraft 1.21.6. minecraft-data 3.119.0 dropped
// the feature entityActionUsesStringMapper that mineflayer 4.39.0 still asks for, so without our patch the bot sent the
// old ids (wake 2, sprint 3 / 4), which mean other actions from 1.21.6 on. patches/mineflayer+4.39.0.patch writes the
// names from 1.21.6 (bot.registry.version['>=']('1.21.6')), the old ids before; the mapping of the data decides the
// number. Also: the velocity of spawn_entity and entity_velocity is taken as it is when it is an lpVec3 (26.1).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { repoPath } from '../helpers/paths.js';

const require = createRequire(import.meta.url);
const { createSerializer } = require('minecraft-protocol');
const prismarineRegistry = require('prismarine-registry');

const NAMED = "bot.registry.version['>=']('1.21.6')";
const read = (rel) => fs.readFileSync(repoPath(rel), 'utf8').replace(/\r\n/g, '\n');
const patch = read('patches/mineflayer+4.39.0.patch');
const bed = read('node_modules/mineflayer/lib/plugins/bed.js');
const physics = read('node_modules/mineflayer/lib/plugins/physics.js');
const entities = read('node_modules/mineflayer/lib/plugins/entities.js');

describe('L: entity_action by name from 1.21.6', () => {
    test('wake writes stop_sleeping from 1.21.6, the id 2 before (patch and node_modules)', () => {
        const line = `actionId: ${NAMED} ? 'stop_sleeping' : 2,`;
        assert.ok(patch.includes(`+        ${line}`), 'the patch');
        assert.ok(bed.includes(line), 'bed.js');
    });

    test('sprint writes start_sprinting / stop_sprinting from 1.21.6, 3 / 4 before', () => {
        const lines = `actionId: ${NAMED}\n          ? (state ? 'start_sprinting' : 'stop_sprinting')\n          : (state ? 3 : 4),`;
        assert.ok(physics.includes(lines), 'physics.js');
        assert.ok(patch.includes(`+        actionId: ${NAMED}\n`), 'the patch');
    });

    test('elytra writes start_fall_flying from 1.21.6, 8 before', () => {
        const line = `actionId: ${NAMED} ? 'start_fall_flying' : 8,`;
        assert.ok(physics.includes(line), 'physics.js');
        assert.ok(patch.includes(`+      ${line}`), 'the patch');
    });

    test('no action of mineflayer asks for the dropped feature any more', () => {
        assert.doesNotMatch(bed + physics, /entityActionUsesStringMapper/);
    });

    test('the version check: 1.21.5 old ids, 1.21.6, 1.21.8 and 26.1 names', () => {
        assert.equal(prismarineRegistry('1.21.5').version['>=']('1.21.6'), false);
        for (const v of ['1.21.6', '1.21.8', '26.1']) assert.equal(prismarineRegistry(v).version['>=']('1.21.6'), true, v);
    });

    for (const version of ['1.21.8', '26.1']) { // kept: both versions name the actions from 1.21.6 on
        test(`${version}: the serializer of minecraft-protocol maps the names to 0, 1, 2 (and 6)`, () => {
            const serializer = createSerializer({ state: 'play', isServer: false, version });
            const lastTwo = (actionId) => [...serializer.createPacketBuffer({ name: 'entity_action', params: { entityId: 1, actionId, jumpBoost: 0 } }).subarray(-2)];
            assert.deepEqual(lastTwo('stop_sleeping'), [0, 0]);
            assert.deepEqual(lastTwo('start_sprinting'), [1, 0]);
            assert.deepEqual(lastTwo('stop_sprinting'), [2, 0]);
            assert.deepEqual(lastTwo('start_fall_flying'), [6, 0]);
        });
    }
});

describe('L: the velocity of 26.1 as it is (lpVec3, blocks per tick)', () => {
    test('entity_velocity and spawn_entity take it as it is with entityVelocityIsLpVec3, else fromNotchVelocity', () => {
        assert.ok(entities.includes("entity.velocity.update(bot.supportFeature('entityVelocityIsLpVec3') ? notchVel : conv.fromNotchVelocity(notchVel))"), 'entity_velocity');
        assert.ok(entities.includes("entity.velocity.update(bot.supportFeature('entityVelocityIsLpVec3') ? vel : conv.fromNotchVelocity(vel))"), 'spawn_entity');
        assert.equal((patch.match(/\+.*entityVelocityIsLpVec3/g) ?? []).length, 2, 'two hunks in the patch');
        assert.equal(prismarineRegistry('1.21.8').supportFeature('entityVelocityIsLpVec3'), false);
        assert.equal(prismarineRegistry('26.1').supportFeature('entityVelocityIsLpVec3'), true);
    });
});
