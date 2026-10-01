// Part P of v0.1.4.10 "Goals" (engineer E2, spec section 4, I5): the path search of mineflayer-pathfinder, patched
// (patches/mineflayer-pathfinder+2.4.5.patch). The library is loaded as it is installed (npm install applied the
// patch) and runs against a world in memory: the names and properties of the mining fake world
// (tests/unit/mining_fake_bot.test.js, makeWorld), turned into blocks of prismarine-block of 1.21.8, so that the
// shapes and bounding boxes are those of the game. The moves are asserted on Movements; the walks run the path search
// injected into a bot that moves with prismarine-physics (patched, the trapdoor over a ladder is climbable), one
// tick per physicsTick, without timers.
//
// The scene of the ladder tests is the base of the world tests: grass at y 60, a room at y 41 (air y 41..43, x 0..4,
// z -2..2), ladders facing south at (2, 41..59, -2), an oak trapdoor at (2, 60, -2), closed, half top.
import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { repoPath } from '../helpers/paths.js';
import { makeWorld, REGISTRY } from './mining_fake_bot.test.js';

const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
const Block = require('prismarine-block')(REGISTRY);
const { Physics, PlayerState } = require('prismarine-physics');
const pf = require('mineflayer-pathfinder');

// ---------------------------------------------------------------------------------------------------------------
// The world and the bot

// The fake world of the mining tests, read as blocks of prismarine-block. A property that is not given has the
// value of the block's default state (a ladder is not waterlogged).
function blockWorld(world) {
    const cache = new Map();
    const set = world.set;
    world.set = (...args) => {
        cache.clear();
        return set(...args);
    };
    world.getBlock = (pos) => {
        const x = Math.floor(pos.x), y = Math.floor(pos.y), z = Math.floor(pos.z);
        const k = `${x},${y},${z}`;
        let b = cache.get(k);
        if (!b) {
            const name = world.nameAt(x, y, z);
            const reg = REGISTRY.blocksByName[name];
            const base = Block.fromStateId(reg.defaultState, 0).getProperties();
            b = Block.fromProperties(name, { ...base, ...world.propsAt(x, y, z) }, 0);
            b.position = new Vec3(x, y, z);
            cache.set(k, b);
        }
        return b;
    };
    return world;
}

function ladderWorld({ trapdoor = true, open = false, lowest = 41 } = {}) {
    const world = blockWorld(makeWorld({ groundY: 60 }));
    world.fill(0, 41, -2, 4, 43, 2, 'air');
    world.fill(2, 44, -2, 2, 59, -2, 'air');
    world.fill(2, lowest, -2, 2, 59, -2, 'ladder', { facing: 'south' });
    world.set(2, 60, -2, trapdoor ? 'oak_trapdoor' : 'air', trapdoor ? { facing: 'south', half: 'top', open } : {});
    return world;
}

function flatWorld() {
    return blockWorld(makeWorld({ groundY: 60 }));
}

function door(world, x, y, z, facing = 'east') {
    world.set(x, y, z, 'oak_door', { facing, half: 'lower', hinge: 'left', open: false });
    world.set(x, y + 1, z, 'oak_door', { facing, half: 'upper', hinge: 'left', open: false });
}

/**
 * A bot with the patched path search and the physics of the game. bot.tick() runs one tick: physicsTick (the
 * path search sets the controls), then the physics. bot.clicks are the blocks it used; a click toggles `open`
 * (both halves of a door, as the server does). bot.log has one entry per tick: the feet, the controls, the block.
 */
function simBot(world, pos) {
    const bot = new EventEmitter();
    bot.setMaxListeners(100);
    bot.version = '1.21.8';
    bot.registry = REGISTRY;
    bot.game = { minY: world.minY, dimension: 'overworld' };
    bot.world = { setBlockStateId() {} };
    bot.entity = {
        position: new Vec3(...pos), velocity: new Vec3(0, 0, 0), onGround: true, yaw: 0, pitch: 0, effects: {}, attributes: {}, height: 1.8,
        isInWater: false, isInLava: false, isInWeb: false, isCollidedHorizontally: false, isCollidedVertically: false, elytraFlying: false,
    };
    bot.entities = {};
    bot.jumpTicks = 0;
    bot.jumpQueued = false;
    bot.fireworkRocketDuration = 0;
    bot.inventory = { slots: [], items: () => [] };
    bot.controlState = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false };
    bot.setControlState = (k, v) => { bot.controlState[k] = Boolean(v); };
    bot.clearControlStates = () => { for (const k of Object.keys(bot.controlState)) bot.controlState[k] = false; };
    bot.look = async (yaw, pitch) => { bot.entity.yaw = yaw; bot.entity.pitch = pitch; };
    bot.lookAt = async (p) => { bot.entity.yaw = Math.atan2(-(p.x - bot.entity.position.x), -(p.z - bot.entity.position.z)); };
    bot.blockAt = (p) => world.getBlock(p);
    bot.clicks = [];
    bot.digs = [];
    bot.activateBlock = async (block) => {
        const p = block.position;
        bot.clicks.push(`${p.x},${p.y},${p.z}`);
        const name = world.nameAt(p.x, p.y, p.z);
        const props = world.propsAt(p.x, p.y, p.z);
        const open = props.open !== true;
        world.set(p.x, p.y, p.z, name, { ...props, open });
        if (name.endsWith('_door')) {
            const oy = props.half === 'upper' ? p.y - 1 : p.y + 1;
            if (world.nameAt(p.x, oy, p.z) === name) world.set(p.x, oy, p.z, name, { ...world.propsAt(p.x, oy, p.z), open });
        }
    };
    bot.dig = async (block) => {
        bot.digs.push(block.name);
        world.set(block.position.x, block.position.y, block.position.z, 'air');
    };
    bot.stopDigging = () => {};
    bot.physics = Physics(REGISTRY, world);
    bot.log = [];
    pf.pathfinder(bot);
    bot.tick = () => {
        bot.emit('physicsTick');
        const state = new PlayerState(bot, bot.controlState);
        bot.physics.simulatePlayer(state, world).apply(bot);
        const p = bot.entity.position;
        bot.log.push({ y: p.y, name: world.nameAt(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), ...bot.controlState });
    };
    return bot;
}

/** Walks to the goal for at most maxTicks ticks. -> { done: 'ok' | the name of the error | null, ticks, resets, paths } */
async function walk(bot, goal, maxTicks = 1200) {
    let done = null;
    const resets = [];
    const paths = [];
    const onReset = (r) => resets.push(r);
    const onPath = (r) => paths.push(r.path.map((p) => ({ x: p.x, y: p.y, z: p.z, tolerance: p.tolerance, opens: p.toPlace.filter((t) => t.useOne).length })));
    bot.on('path_reset', onReset);
    bot.on('path_update', onPath);
    bot.pathfinder.goto(goal).then(() => { done = 'ok'; }, (err) => { done = err.name; });
    let ticks = 0;
    for (; ticks < maxTicks && done === null; ticks++) {
        bot.tick();
        await new Promise((r) => setImmediate(r));
    }
    for (let i = 0; i < 5 && done === null; i++) await new Promise((r) => setImmediate(r));
    if (done === null) bot.pathfinder.stop();
    bot.removeListener('path_reset', onReset);
    bot.removeListener('path_update', onPath);
    return { done, ticks, resets, paths };
}

function movementsOf(bot) {
    return new pf.Movements(bot);
}

const node = (x, y, z) => ({ x, y, z, remainingBlocks: 0 });
const at = (m) => `${m.x},${m.y},${m.z}`;
const opens = (m) => m.toPlace.filter((t) => t.useOne).map((t) => `${t.x},${t.y},${t.z}`);

// ---------------------------------------------------------------------------------------------------------------

describe('P1: trapdoors', () => {
    test('a closed trapdoor is a floor only over a solid block: not over a ladder, not over air', () => {
        const world = ladderWorld();
        world.set(8, 61, 8, 'oak_trapdoor', { facing: 'south', half: 'top', open: false });
        world.set(8, 64, 8, 'oak_trapdoor', { facing: 'south', half: 'bottom', open: false });
        const m = movementsOf(simBot(world, [0.5, 61, 0.5]));
        assert.equal(m.getBlock(new Vec3(2, 60, -2), 0, 0, 0).physical, false, 'over the ladder');
        assert.equal(m.getBlock(new Vec3(8, 61, 8), 0, 0, 0).physical, true, 'over the grass');
        assert.equal(m.getBlock(new Vec3(8, 64, 8), 0, 0, 0).physical, false, 'over air');
        world.set(8, 61, 8, 'oak_trapdoor', { facing: 'south', half: 'top', open: true });
        assert.equal(m.getBlock(new Vec3(8, 61, 8), 0, 0, 0).physical, false, 'open: no floor');
    });

    test('an open trapdoor over a ladder of the same facing is climbable, of another facing not', () => {
        const world = ladderWorld({ open: true });
        const m = movementsOf(simBot(world, [0.5, 61, 0.5]));
        assert.equal(m.getBlock(new Vec3(2, 60, -2), 0, 0, 0).climbable, true);
        world.set(2, 60, -2, 'oak_trapdoor', { facing: 'east', half: 'top', open: true });
        assert.equal(m.getBlock(new Vec3(2, 60, -2), 0, 0, 0).climbable, false);
    });

    test('nothing stands on the closed trapdoor: from beside it the only move over the column goes into it and opens it', () => {
        const m = movementsOf(simBot(ladderWorld(), [2.5, 61, -0.5]));
        const moves = m.getNeighbors(node(2, 61, -1));
        assert.equal(moves.some((n) => n.x === 2 && n.z === -2 && n.y >= 61), false, moves.map(at).join(' '));
        const into = moves.filter((n) => n.x === 2 && n.z === -2);
        assert.deepEqual(into.map(at), ['2,60,-2']);
        assert.deepEqual(opens(into[0]), ['2,60,-2']);
        assert.deepEqual(into[0].toBreak, []);
    });

    test('a closed door, gate or trapdoor is passed only by a move that opens it; an open one is passed; no move breaks one', () => {
        const world = ladderWorld();
        world.set(8, 61, 8, 'oak_fence_gate', { facing: 'east', open: false });
        const m = movementsOf(simBot(world, [0.5, 61, 0.5]));
        for (const p of [new Vec3(2, 60, -2), new Vec3(8, 61, 8)]) {
            const toBreak = [];
            assert.equal(m.safeOrBreak(m.getBlock(p, 0, 0, 0), toBreak), 100, `${p}`);
            assert.deepEqual(toBreak, []);
            assert.equal(m.mayBreakOnPath(m.getBlock(p, 0, 0, 0)), false, `never broken by a move: ${p}`);
            assert.equal(m.safeToBreak(m.getBlock(p, 0, 0, 0)), true, `the bot may still collect it: ${p}`);
        }
        assert.equal(m.mayBreakOnPath(m.getBlock(new Vec3(2, 50, -2), 0, 0, 0)), false, 'a ladder is never broken by a move');
        world.set(8, 61, 8, 'oak_fence_gate', { facing: 'east', open: true });
        assert.equal(m.safeOrBreak(m.getBlock(new Vec3(8, 61, 8), 0, 0, 0), []), 0, 'open gate');
    });

    test('up the column: every move past the closed trapdoor opens it (no climb into it with the head)', () => {
        const m = movementsOf(simBot(ladderWorld(), [2.5, 41, 0.5]));
        const moves = m.getNeighbors(node(2, 58, -2)).filter((n) => n.y > 58);
        assert.ok(moves.length > 0);
        for (const n of moves) assert.deepEqual(opens(n), ['2,60,-2'], at(n));
    });

    test('a bot that hangs under the closed trapdoor (feet at 59) opens it with the move up', () => {
        const m = movementsOf(simBot(ladderWorld(), [2.5, 59, -1.5]));
        const up = m.getNeighbors(node(2, 59, -2)).filter((n) => n.y > 59 && n.x === 2 && n.z === -2);
        assert.ok(up.some((n) => at(n) === '2,60,-2' && opens(n).includes('2,60,-2')), up.map(at).join(' '));
        for (const n of up) assert.deepEqual(opens(n), ['2,60,-2'], at(n));
    });

    test('a door: the move through it opens it once, its upper half with it', () => {
        const world = flatWorld();
        world.fill(4, 61, -3, 4, 63, 3, 'oak_planks');
        door(world, 4, 61, 0);
        const m = movementsOf(simBot(world, [3.5, 61, 0.5]));
        const through = m.getNeighbors(node(3, 61, 0)).filter((n) => at(n) === '4,61,0');
        assert.equal(through.length, 1);
        assert.deepEqual(opens(through[0]), ['4,61,0']);
        assert.ok(through[0].cost < 3, `cost ${through[0].cost}`);
    });
});

describe('P2: ladders inside the search', () => {
    test('a move one rung down with cost 1', () => {
        const m = movementsOf(simBot(ladderWorld(), [2.5, 50, -1.5]));
        const down = m.getNeighbors(node(2, 50, -2)).filter((n) => at(n) === '2,49,-2');
        assert.equal(down.length, 1);
        assert.equal(down[0].cost, 1);
        assert.deepEqual(down[0].toPlace, []);
    });

    test('a vine is a rung too, also when a drop to the bottom is allowed (a column of 3 over the floor)', () => {
        const world = flatWorld();
        world.fill(5, 57, 5, 5, 60, 5, 'air');
        world.fill(5, 57, 5, 5, 59, 5, 'vine', { north: true });
        const m = movementsOf(simBot(world, [5.5, 59, 5.5]));
        const moves = m.getNeighbors(node(5, 59, 5)).filter((n) => n.x === 5 && n.z === 5 && n.y < 59);
        assert.ok(moves.some((n) => n.y === 58 && n.cost === 1), moves.map(at).join(' '));
        assert.ok(moves.some((n) => n.y === 57), 'the drop is kept');
    });

    test('down 19 rungs through the closed trapdoor: opened, closed again 2 blocks below, never a jump on the ladder, no stuck', { timeout: 30000 }, async () => {
        const world = ladderWorld();
        const bot = simBot(world, [2.5, 61, -0.5]);
        const r = await walk(bot, new pf.goals.GoalNear(2, 41, 1, 1));
        assert.equal(r.done, 'ok', JSON.stringify(bot.entity.position));
        assert.deepEqual(bot.clicks, ['2,60,-2', '2,60,-2'], 'opened, then closed behind the bot');
        assert.equal(world.propsAt(2, 60, -2).open, false);
        assert.equal(Math.floor(bot.entity.position.y), 41);
        assert.ok(r.ticks < 300, `${r.ticks} ticks`);
        assert.equal(bot.log.some((e) => e.name === 'ladder' && e.jump), false, 'jump on the ladder');
        assert.equal(bot.log.some((e) => e.name === 'ladder' && e.y < 58 && e.y > 43 && e.forward), false, 'forward on the way down');
        assert.deepEqual(r.resets.filter((x) => x === 'stuck'), []);
        assert.deepEqual(bot.digs, []);
    });

    test('up 20 rungs through the closed trapdoor and out onto the grass: forward, never a jump on the ladder, closed from beside', { timeout: 30000 }, async () => {
        const world = ladderWorld();
        const bot = simBot(world, [2.5, 41, 0.5]);
        const r = await walk(bot, new pf.goals.GoalNear(2, 61, 1, 1));
        for (let t = 0; t < 10; t++) bot.tick(); // the close comes from beside, on the floor
        assert.equal(r.done, 'ok', JSON.stringify(bot.entity.position));
        assert.deepEqual(bot.clicks, ['2,60,-2', '2,60,-2'], 'opened, then closed behind the bot');
        assert.equal(world.propsAt(2, 60, -2).open, false);
        assert.equal(Math.floor(bot.entity.position.y), 61);
        assert.ok(r.ticks < 400, `${r.ticks} ticks`);
        assert.equal(bot.log.some((e) => e.name === 'ladder' && e.jump), false, 'jump on the ladder');
        assert.deepEqual(r.resets.filter((x) => x === 'stuck'), []);
        assert.deepEqual(bot.digs, []);
    });

    test('a bot hanging under the closed trapdoor (F33) opens it and climbs out', { timeout: 30000 }, async () => {
        const bot = simBot(ladderWorld(), [2.5, 59, -1.5]);
        bot.entity.onGround = false;
        const r = await walk(bot, new pf.goals.GoalNear(2, 61, 1, 1));
        assert.equal(r.done, 'ok');
        assert.equal(bot.clicks[0], '2,60,-2');
        assert.ok(r.ticks < 120, `${r.ticks} ticks`);
    });

    test('a column that ends one block above the floor: a jump at the wall reaches the lowest ladder', { timeout: 30000 }, async () => {
        const bot = simBot(ladderWorld({ lowest: 42 }), [2.5, 41, 0.5]);
        const r = await walk(bot, new pf.goals.GoalNear(2, 61, 1, 1));
        assert.equal(r.done, 'ok', JSON.stringify(bot.entity.position));
        assert.deepEqual(bot.digs, [], 'nothing dug');
    });

    test('down through an open hole without a trapdoor: no click; through an open trapdoor: only the close behind', { timeout: 30000 }, async () => {
        for (const [options, clicks] of [[{ trapdoor: false }, []], [{ open: true }, ['2,60,-2']]]) {
            const bot = simBot(ladderWorld(options), [2.5, 61, -0.5]);
            const r = await walk(bot, new pf.goals.GoalNear(2, 41, 1, 1));
            assert.equal(r.done, 'ok', JSON.stringify(options));
            assert.deepEqual(bot.clicks, clicks);
        }
    });

    test('a walk never ends hanging on a ladder: the goal near the top is reached on the floor beside it', { timeout: 30000 }, async () => {
        const bot = simBot(ladderWorld({ open: true }), [2.5, 41, 0.5]);
        const r = await walk(bot, new pf.goals.GoalNear(4, 61, -2, 3)); // a ladder cell at y 59 is within 3 blocks
        assert.equal(r.done, 'ok');
        assert.equal(Math.floor(bot.entity.position.y), 61, JSON.stringify(bot.entity.position));
    });

    test('down a ladder to a point beside it one block lower (a basement with a low ceiling): slide first, then walk off', { timeout: 30000 }, async () => {
        const world = ladderWorld();
        world.fill(0, 44, -1, 4, 46, 2, 'stone'); // the room is 3 high: (2, 44, -1) beside the column is solid
        const bot = simBot(world, [2.5, 61, -0.5]);
        const r = await walk(bot, new pf.goals.GoalBlock(2, 41, 1));
        assert.equal(r.done, 'ok', JSON.stringify(bot.entity.position));
        assert.deepEqual(r.resets.filter((x) => x === 'stuck'), []);
    });

    test('the follow of a player (dynamic goal) down the ladder and up again', { timeout: 30000 }, async () => {
        const bot = simBot(ladderWorld(), [2.5, 61, 1.5]);
        const player = { id: 7, type: 'player', name: 'player', position: new Vec3(3.5, 41, 1.5), height: 1.8, width: 0.6, isValid: true };
        bot.entities[7] = player;
        bot.pathfinder.setGoal(new pf.goals.GoalFollow(player, 2), true);
        for (let t = 0; t < 400; t++) {
            bot.tick();
            await new Promise((r) => setImmediate(r));
        }
        assert.equal(Math.floor(bot.entity.position.y), 41, 'down with the player');
        player.position = new Vec3(3.5, 61, 2.5);
        for (let t = 0; t < 500; t++) {
            bot.tick();
            await new Promise((r) => setImmediate(r));
        }
        bot.pathfinder.setGoal(null);
        assert.equal(Math.floor(bot.entity.position.y), 61, 'up with the player');
        assert.ok(bot.entity.position.distanceTo(player.position) <= 3);
    });
});

describe('P3: doors and the arrival tolerance', () => {
    test('two closed doors in a row: both opened, every door point centred, tolerance 0.35 there and 0.175 elsewhere', { timeout: 30000 }, async () => {
        const world = flatWorld();
        world.fill(4, 61, -3, 4, 63, 3, 'oak_planks');
        world.fill(8, 61, -3, 8, 63, 3, 'oak_planks');
        door(world, 4, 61, 0);
        door(world, 8, 61, 1);
        const bot = simBot(world, [0.5, 61, 0.5]);
        const r = await walk(bot, new pf.goals.GoalBlock(11, 61, 1));
        assert.equal(r.done, 'ok');
        assert.deepEqual(bot.clicks, ['4,61,0', '8,61,1']);
        assert.ok(r.ticks < 200, `${r.ticks} ticks`);
        const first = r.paths[0];
        const doors = first.filter((p) => (Math.floor(p.x) === 4 && Math.floor(p.z) === 0) || (Math.floor(p.x) === 8 && Math.floor(p.z) === 1));
        assert.equal(doors.length, 2);
        for (const p of doors) {
            assert.deepEqual([p.x % 1, p.z % 1, p.tolerance], [0.5, 0.5, 0.35], JSON.stringify(p));
        }
        for (const p of first.filter((q) => !doors.includes(q))) assert.equal(p.tolerance, 0.175, JSON.stringify(p));
    });

    test('a fence gate: opened, passed, its point centred', { timeout: 30000 }, async () => {
        const world = flatWorld();
        world.fill(4, 61, -3, 4, 61, 3, 'oak_fence');
        world.set(4, 61, 0, 'oak_fence_gate', { facing: 'east', open: false });
        const bot = simBot(world, [0.5, 61, 0.5]);
        const r = await walk(bot, new pf.goals.GoalBlock(8, 61, 0));
        assert.equal(r.done, 'ok');
        assert.deepEqual(bot.clicks, ['4,61,0']);
        const gate = r.paths[0].find((p) => Math.floor(p.x) === 4);
        assert.deepEqual([gate.x, gate.y, gate.z, gate.tolerance], [4.5, 61, 0.5, 0.35]);
    });

    test('the points of a ladder: centred, tolerance 0.35', { timeout: 30000 }, async () => {
        const bot = simBot(ladderWorld(), [2.5, 41, 0.5]);
        const r = await walk(bot, new pf.goals.GoalNear(2, 61, 1, 1));
        const rungs = r.paths[0].filter((p) => Math.floor(p.x) === 2 && Math.floor(p.z) === -2);
        assert.ok(rungs.length >= 18);
        for (const p of rungs) assert.deepEqual([p.x, p.z, p.tolerance], [2.5, -1.5, 0.35], JSON.stringify(p));
    });
});

describe('P4: no stand on hollow and half blocks, the pit', () => {
    test('a bottom slab, bottom stairs, a cauldron, a composter, a hopper, a chest are no floor; a top slab and top stairs are', () => {
        const world = flatWorld();
        const cases = [['oak_slab', { type: 'bottom' }, false], ['oak_stairs', { half: 'bottom' }, false], ['cauldron', {}, false],
            ['composter', {}, false], ['hopper', {}, false], ['chest', {}, false], ['oak_slab', { type: 'top' }, true],
            ['oak_slab', { type: 'double' }, true], ['oak_stairs', { half: 'top' }, true], ['stone', {}, true]];
        cases.forEach(([name, props], i) => world.set(i * 2, 61, 5, name, props));
        const m = movementsOf(simBot(world, [0.5, 61, 0.5]));
        cases.forEach(([name, props, floor], i) => {
            const b = m.getBlock(new Vec3(i * 2, 61, 5), 0, 0, 0);
            assert.equal(b.physical, floor, `${name} ${JSON.stringify(props)}`);
            if (!floor) {
                assert.equal(b.safe, false, `${name}: not walked through either`);
                assert.equal(m.mayBreakOnPath(b), false, `${name}: never broken by a move`);
            }
        });
    });

    test('no move ends on a bottom slab; the walk goes around a floor of slabs', { timeout: 30000 }, async () => {
        const world = flatWorld();
        world.fill(3, 60, -1, 6, 60, 1, 'oak_slab', { type: 'bottom' });
        const bot = simBot(world, [0.5, 61, 0.5]);
        const m = movementsOf(bot);
        assert.equal(m.getNeighbors(node(2, 61, 0)).some((n) => n.x === 3 && n.z === 0), false);
        const r = await walk(bot, new pf.goals.GoalBlock(9, 61, 0));
        assert.equal(r.done, 'ok');
        assert.equal(bot.log.some((e) => e.y < 60.99), false, 'never half a block low');
    });

    test('a move down into a one-wide pit whose way out needs a jump of 2 costs 50 more; into a wide one not', () => {
        const world = flatWorld();
        world.fill(3, 58, 0, 3, 60, 0, 'air'); // one wide, 3 deep
        world.fill(3, 58, 6, 4, 60, 6, 'air'); // two wide
        const m = movementsOf(simBot(world, [2.5, 61, 0.5]));
        const pit = m.getNeighbors(node(2, 61, 0)).find((n) => at(n) === '3,58,0');
        const wide = m.getNeighbors(node(2, 61, 6)).find((n) => at(n) === '3,58,6');
        assert.ok(pit && wide);
        assert.equal(pit.cost - wide.cost, 50);
        world.set(3, 58, 0, 'ladder', { facing: 'south' });
        assert.equal(m.isOneWidePit(new Vec3(3, 58, 0)), false, 'a shaft with a ladder is no pit');
    });
});

describe('P5: the stuck cost', () => {
    let realNow = null;
    afterEach(() => {
        if (realNow) delete performance.now;
        realNow = null;
    });

    test('a move into a cell within 1 block of a stuck mark costs 100 more, farther away nothing', () => {
        const m = movementsOf(simBot(flatWorld(), [0.5, 61, 0.5]));
        const before = new Map(m.getNeighbors(node(0, 61, 0)).map((n) => [at(n), n.cost]));
        m.stuckMarks = [{ x: 2, y: 61, z: 0 }];
        const after = new Map(m.getNeighbors(node(0, 61, 0)).map((n) => [at(n), n.cost]));
        assert.equal(after.get('1,61,0') - before.get('1,61,0'), 100);
        assert.equal(after.get('1,61,1') - before.get('1,61,1'), 100);
        assert.equal(after.get('-1,61,0'), before.get('-1,61,0'));
    });

    test('stuck for 3.5 s: the point it could not reach is marked, the next plan avoids it, the mark ends after 30 s', { timeout: 30000 }, async () => {
        let now = 1000;
        realNow = performance.now;
        performance.now = () => now;
        const bot = simBot(flatWorld(), [0.5, 61, 0.5]);
        bot.tick = () => { bot.emit('physicsTick'); }; // the bot does not move
        const resets = [];
        const plans = [];
        bot.on('path_reset', (r) => resets.push(r));
        bot.on('path_update', () => plans.push(bot.pathfinder.movements.stuckMarks.map((s) => `${s.x},${s.y},${s.z}`)));
        bot.pathfinder.setGoal(new pf.goals.GoalBlock(6, 61, 0));
        bot.tick();
        const first = plans.length;
        now += 3600;
        bot.tick();
        assert.ok(resets.includes('stuck'));
        bot.tick();
        assert.equal(plans.length, first + 1, 'planned again');
        assert.deepEqual(plans.at(-1), ['1,61,0'], 'the mark at the first point of the path');
        now += 30001;
        bot.pathfinder.setGoal(new pf.goals.GoalBlock(6, 61, 0));
        bot.tick();
        assert.deepEqual(plans.at(-1), [], 'gone after 30 s');
        bot.pathfinder.setGoal(null);
    });
});

describe('the patch file', () => {
    const patch = fs.readFileSync(repoPath('patches/mineflayer-pathfinder+2.4.5.patch'), 'utf8');

    test('LF, and the hunks of v0.1.4.9 are kept: lava, door centring, trapdoor climbing, doors opened, jump released', () => {
        assert.equal(patch.includes('\r'), false, 'LF');
        for (const text of ['const lavaType = bot.registry.blocksByName.lava.id', 'movements.updateLavaAvoidance()', 'updateLavaAvoidance () {',
            '} else if (bot.entity.isInLava) {', 'openned doors have small Collision box', 'getMoveClimbUpThroughTrapdoor (node, neighbors) {',
            'getMoveClimbTop (node, neighbors) {', 'Enhanced trapdoor logic', 'this.canOpenDoors = true', "bot.setControlState('jump', false)",
            'registry.blocksByName.cave_vines_plant', 'if (!placingBlock) {']) {
            assert.ok(patch.includes(text), text);
        }
    });

    test('the hunks of v0.1.4.10 are in it and in the installed library', () => {
        const index = fs.readFileSync(repoPath('node_modules/mineflayer-pathfinder/index.js'), 'utf8');
        const movements = fs.readFileSync(repoPath('node_modules/mineflayer-pathfinder/lib/movements.js'), 'utf8');
        for (const [text, file] of [['getMoveIntoLadderBelow (node, dir, neighbors) {', movements], ['isOneWidePit (pos) {', movements],
            ['this.stuckCost = 100', movements], ['this.pitCost = 50', movements], ['function climbTowards (p, nextPoint) {', index],
            ['const STUCK_MS = 30000', index], ['return isDoorLike(b) || isClimbable(b) ? 0.35 : 0.175', index]]) {
            assert.ok(patch.includes(text), `patch: ${text}`);
            assert.ok(file.includes(text), `installed: ${text}`);
        }
    });
});
