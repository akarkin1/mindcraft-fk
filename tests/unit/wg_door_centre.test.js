// v0.1.4.12, part G, G3: the path search centres the first point behind a door it opens (the cell on the far
// side of the frame) as it centres the door point itself (P3 of v0.1.4.10), so the bot does not clip the frame
// (patches/mineflayer-pathfinder+2.4.5.patch). The world and the bot of the path search are those of
// tests/unit/gj_pathfinder.test.js (copied: that file exports nothing). Before G3 a floor whose top is not a
// full face (bottom stairs) put that point off the centre, at 3.625 or 0.375.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
const REGISTRY = require('prismarine-registry')('1.21.8');
const Block = require('prismarine-block')(REGISTRY);
const pf = require('mineflayer-pathfinder');

/**
 * A world of stone up to y 63 and air above; set() puts a block with properties. blockAt gives blocks of
 * prismarine-block of 1.21.8, the properties not given at the value of the default state.
 */
function makeWorld({ groundY = 63 } = {}) {
    const cells = new Map();
    const key = (x, y, z) => `${x},${y},${z}`;
    const world = {
        set(x, y, z, name, props = {}) {
            cells.set(key(x, y, z), { name, props });
            return world;
        },
        fill(x1, y1, z1, x2, y2, z2, name, props = {}) {
            for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
                for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
                    for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) world.set(x, y, z, name, props);
            return world;
        },
        cell(x, y, z) {
            return cells.get(key(x, y, z)) ?? { name: y <= groundY ? 'stone' : 'air', props: {} };
        },
        blockAt(pos) {
            const x = Math.floor(pos.x), y = Math.floor(pos.y), z = Math.floor(pos.z);
            const { name, props } = world.cell(x, y, z);
            const base = Block.fromStateId(REGISTRY.blocksByName[name].defaultState, 0);
            const b = Object.keys(props).length === 0 ? base : Block.fromProperties(name, { ...base.getProperties(), ...props }, 0);
            b.position = new Vec3(x, y, z);
            return b;
        },
    };
    return world;
}

/** A bot as the Movements read it: registry, blockAt, an empty inventory, no entities. */
function moveBot(world) {
    return {
        version: '1.21.8',
        registry: REGISTRY,
        game: { minY: -64, height: 384, dimension: 'overworld' },
        entity: { position: new Vec3(0.5, 64, 0.5), effects: {}, onGround: true, height: 1.8 },
        entities: {},
        inventory: { items: () => [], slots: [] },
        blockAt: (p) => world.blockAt(p),
        pathfinder: { bestHarvestTool: () => null },
    };
}

// ------------------------------------------------------------------------- a bot with the injected path search

let clock = 1_000_000;
const realNow = Object.getOwnPropertyDescriptor(performance, 'now');

/**
 * A bot with the injected path search and no physics: bot.tick() emits one physicsTick; the bot moves only when
 * the test moves it. bot.resets lists the reasons of path_reset, bot.paths the paths of path_update.
 */
function pathBot(world, pos) {
    const bot = new EventEmitter();
    bot.setMaxListeners(50);
    Object.assign(bot, moveBot(world));
    bot.game = { minY: -64, dimension: 'overworld' };
    bot.world = { setBlockStateId() {} };
    bot.entity = { position: new Vec3(...pos), velocity: new Vec3(0, 0, 0), onGround: true, yaw: 1, pitch: 0, effects: {}, height: 1.8,
        isInWater: false, isInLava: false, isInWeb: false, attributes: {}, elytraFlying: false, isCollidedHorizontally: false,
        isCollidedVertically: false };
    bot.jumpTicks = 0;
    bot.jumpQueued = false;
    bot.fireworkRocketDuration = 0;
    bot.physics = { simulatePlayer: (state) => state }; // the simulation of a walk never moves: no straight line
    bot.controlState = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false };
    bot.setControlState = (k, v) => { bot.controlState[k] = Boolean(v); };
    bot.clearControlStates = () => { for (const k of Object.keys(bot.controlState)) bot.controlState[k] = false; };
    bot.look = async (yaw, pitch) => { bot.entity.yaw = yaw; bot.entity.pitch = pitch; };
    bot.lookAt = async () => {};
    bot.activateBlock = async () => {};
    bot.dig = async () => {};
    bot.stopDigging = () => {};
    bot.equip = async () => {};
    bot.resets = [];
    bot.paths = [];
    pf.pathfinder(bot);
    bot.on('path_reset', (r) => bot.resets.push(r));
    bot.on('path_update', (r) => bot.paths.push(r.path));
    bot.tick = (ms = 50) => {
        clock += ms;
        bot.emit('physicsTick');
    };
    return bot;
}

before(() => {
    Object.defineProperty(performance, 'now', { value: () => clock, configurable: true, writable: true });
});
after(() => {
    if (realNow) Object.defineProperty(performance, 'now', realNow);
    else delete performance.now;
});


// ------------------------------------------------------------------------------------------------------- G3

/** A wall at x 2 with a closed oak door at (2, 64, 0); floor: the stone of the world, or `floor` under (3, 64, 0). */
function doorWorld({ facing = 'east', floor = null } = {}) {
    const world = makeWorld();
    world.fill(2, 64, -6, 2, 66, 6, 'stone');
    world.set(2, 64, 0, 'oak_door', { facing, half: 'lower', hinge: 'left', open: false });
    world.set(2, 65, 0, 'oak_door', { facing, half: 'upper', hinge: 'left', open: false });
    if (floor) world.set(3, 63, 0, floor.name, floor.props);
    return world;
}

function pathThrough(world, from = [0.5, 64, 0.5], goal = [6, 64, 0]) {
    const bot = pathBot(world, from);
    const m = new pf.Movements(bot);
    m.canDig = false;
    const result = bot.pathfinder.getPathTo(m, new pf.goals.GoalBlock(...goal));
    assert.equal(result.status, 'success');
    return result.path;
}

const show = (path) => JSON.stringify(path.map((p) => [p.x, p.y, p.z]));

describe('G3: the first point behind a door the bot opens is the centre of its cell', () => {
    const floors = [
        { name: 'oak_stairs', props: { facing: 'east', half: 'bottom' } },
        { name: 'oak_stairs', props: { facing: 'north', half: 'bottom' } },
        { name: 'oak_stairs', props: { facing: 'west', half: 'bottom' } },
        null,
    ];
    for (const floor of floors) {
        test(`eastwards, the floor behind the door ${floor ? floor.name + ' ' + floor.props.facing : 'stone'}`, () => {
            const path = pathThrough(doorWorld({ floor }));
            const i = path.findIndex((p) => Math.floor(p.x) === 2);
            assert.ok(i >= 0, show(path));
            const door = path[i];
            assert.ok(door.toPlace.some((p) => p.useOne), 'the bot opens the door');
            assert.deepEqual([door.x, door.z], [2.5, 0.5], 'the door point, centred (P3)');
            const behind = path[i + 1];
            assert.deepEqual([behind.x, behind.y, behind.z], [3.5, 64, 0.5], show(path));
            assert.equal(behind.tolerance, 0.175);
        });
    }

    test('westwards through the door: the point behind it at (1.5, 64, 0.5)', () => {
        const world = doorWorld({ facing: 'west' });
        world.set(1, 63, 0, 'oak_stairs', { facing: 'south', half: 'bottom' });
        const path = pathThrough(world, [5.5, 64, 0.5], [-2, 64, 0]);
        const i = path.findIndex((p) => Math.floor(p.x) === 2);
        assert.ok(i >= 0, show(path));
        assert.deepEqual([path[i + 1].x, path[i + 1].y, path[i + 1].z], [1.5, 64, 0.5], show(path));
    });

    test('only the first point behind the door: the next one keeps the top of its floor', () => {
        const world = doorWorld();
        world.set(4, 63, 0, 'oak_stairs', { facing: 'east', half: 'bottom' });
        const path = pathThrough(world);
        const p = path.find((q) => Math.floor(q.x) === 4);
        assert.equal(p.x, 4.625, show(path));
    });

    test('an open door (nothing to open): the point behind it as before', () => {
        const world = doorWorld({ floor: { name: 'oak_stairs', props: { facing: 'east', half: 'bottom' } } });
        world.set(2, 64, 0, 'oak_door', { facing: 'east', half: 'lower', hinge: 'left', open: true });
        world.set(2, 65, 0, 'oak_door', { facing: 'east', half: 'upper', hinge: 'left', open: true });
        const path = pathThrough(world);
        const i = path.findIndex((p) => Math.floor(p.x) === 2);
        assert.ok(i >= 0, show(path));
        assert.ok(!path[i].toPlace.some((p) => p.useOne), 'nothing to open');
        assert.equal(path[i + 1].x, 3.625, show(path));
    });
});
