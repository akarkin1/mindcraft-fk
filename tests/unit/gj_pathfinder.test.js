// Tester T1 of v0.1.4.10 "Goals", from the spec (I5, P1 to P5) and the handoff of part P: the patched path search
// of mineflayer-pathfinder (patches/mineflayer-pathfinder+2.4.5.patch, applied by npm install) on a world in memory.
// The moves are read from the Movements of the library; the controls on a ladder, the arrival tolerance and the
// stuck cost from the injected path search of a bot that does not move by itself (no physics: the test moves it),
// with a mocked clock (performance.now), so no timer stays open.
//
// The handoff wins over the spec where they differ: the stuck cost is added per move in getNeighbors (not through
// exclusionAreasStep), the mark is on the point the bot could not reach, only bottom slabs and bottom stairs are
// no-stand.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { loadSrc } from '../helpers/load.js';

const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
const REGISTRY = require('prismarine-registry')('1.21.8');
const Block = require('prismarine-block')(REGISTRY);
const pf = require('mineflayer-pathfinder');

const STAND = await loadSrc('src/agent/packs/home/stand_logic.js');

// ------------------------------------------------------------------------------------------------ the world

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

function node(x, y, z, remainingBlocks = 0) {
    const n = new Vec3(x, y, z);
    n.remainingBlocks = remainingBlocks;
    return n;
}

const at = (moves, x, y, z) => moves.filter((m) => m.x === x && m.y === y && m.z === z);

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

// ------------------------------------------------------------------------------------------------------- P1

describe('P1: a closed trapdoor is a floor only over a solid block', () => {
    test('a closed trapdoor over a ladder, over a vine or over air is no floor; over stone it is', () => {
        const world = makeWorld();
        world.set(0, 70, 0, 'oak_trapdoor', { facing: 'south', half: 'top', open: false });
        world.set(0, 69, 0, 'ladder', { facing: 'south' });
        world.set(2, 70, 0, 'oak_trapdoor', { facing: 'south', half: 'top', open: false });
        world.set(2, 69, 0, 'vine', { south: true });
        world.set(4, 70, 0, 'oak_trapdoor', { facing: 'south', half: 'top', open: false }); // air under it
        world.set(6, 70, 0, 'oak_trapdoor', { facing: 'south', half: 'top', open: false });
        world.set(6, 69, 0, 'stone');
        const m = new pf.Movements(moveBot(world));
        assert.equal(m.getBlock(new Vec3(0, 70, 0), 0, 0, 0).physical, false, 'over a ladder');
        assert.equal(m.getBlock(new Vec3(2, 70, 0), 0, 0, 0).physical, false, 'over a vine');
        assert.equal(m.getBlock(new Vec3(4, 70, 0), 0, 0, 0).physical, false, 'over air');
        assert.equal(m.getBlock(new Vec3(6, 70, 0), 0, 0, 0).physical, true, 'over stone');
    });

    test('no step onto the closed trapdoor of a ladder shaft; a step onto one over stone', () => {
        const shaft = makeWorld();
        shaft.set(0, 63, 0, 'oak_trapdoor', { facing: 'south', half: 'top', open: false });
        shaft.fill(0, 58, 0, 0, 62, 0, 'ladder', { facing: 'south' });
        const m = new pf.Movements(moveBot(shaft));
        const out = [];
        m.getMoveForward(node(1, 64, 0), { x: -1, z: 0 }, out);
        assert.deepEqual(at(out, 0, 64, 0), [], 'the trapdoor over the ladder is no floor');

        const floor = makeWorld();
        floor.set(0, 63, 0, 'oak_trapdoor', { facing: 'south', half: 'top', open: false });
        const m2 = new pf.Movements(moveBot(floor));
        const out2 = [];
        m2.getMoveForward(node(1, 64, 0), { x: -1, z: 0 }, out2);
        assert.equal(at(out2, 0, 64, 0).length, 1, 'the trapdoor over stone is a floor');
    });

    test('safeOrBreak: a closed trapdoor is no passable cell to stand in, an open one is', () => {
        const world = makeWorld();
        world.set(0, 64, 0, 'oak_trapdoor', { facing: 'south', half: 'bottom', open: false });
        world.set(2, 64, 0, 'oak_trapdoor', { facing: 'south', half: 'bottom', open: true });
        const m = new pf.Movements(moveBot(world));
        assert.ok(m.safeOrBreak(m.getBlock(new Vec3(0, 64, 0), 0, 0, 0), []) >= 100, 'closed');
        assert.ok(m.safeOrBreak(m.getBlock(new Vec3(2, 64, 0), 0, 0, 0), []) < 100, 'open');
    });

    test('a move through a closed door opens it (no break) and is passable', () => {
        const world = makeWorld();
        world.set(1, 64, 0, 'oak_door', { facing: 'east', half: 'lower', hinge: 'left', open: false });
        world.set(1, 65, 0, 'oak_door', { facing: 'east', half: 'upper', hinge: 'left', open: false });
        const m = new pf.Movements(moveBot(world));
        const out = [];
        m.getMoveForward(node(0, 64, 0), { x: 1, z: 0 }, out);
        const through = at(out, 1, 64, 0);
        assert.equal(through.length, 1, 'the move through the door');
        assert.ok(through[0].cost < 100);
        assert.deepEqual(through[0].toBreak, [], 'the door is not broken');
        assert.ok(through[0].toPlace.some((p) => p.useOne === true), 'the door is opened');
    });
});

// ------------------------------------------------------------------------------------------------------- P2

describe('P2: ladders in the path search', () => {
    test('one rung down: a move to y - 1 with cost 1 when the block below the feet is a ladder', () => {
        const world = makeWorld();
        world.fill(0, 55, 0, 0, 63, 0, 'ladder', { facing: 'south' });
        world.fill(0, 55, 1, 0, 63, 1, 'air'); // the shaft is open to the south
        const m = new pf.Movements(moveBot(world));
        const out = [];
        m.getMoveDown(node(0, 62, 0), out);
        const rung = at(out, 0, 61, 0);
        assert.equal(rung.length, 1, JSON.stringify(out.map((n) => [n.x, n.y, n.z, n.cost])));
        assert.equal(rung[0].cost, 1);
    });

    test('one rung down a vine too, also where a drop to the bottom would be allowed', () => {
        const world = makeWorld();
        world.fill(0, 60, 0, 0, 63, 0, 'vine', { north: true });
        world.fill(0, 60, 1, 0, 63, 1, 'air');
        const m = new pf.Movements(moveBot(world));
        assert.ok(m.maxDropDown >= 3);
        const out = [];
        m.getMoveDown(node(0, 63, 0), out);
        const rung = at(out, 0, 62, 0);
        assert.equal(rung.length, 1, JSON.stringify(out.map((n) => [n.x, n.y, n.z, n.cost])));
        assert.equal(rung[0].cost, 1);
    });

    test('without a ladder no such rung: an open shaft gives only the drop to its bottom', () => {
        const world = makeWorld();
        world.fill(0, 60, 0, 0, 63, 0, 'air');
        const m = new pf.Movements(moveBot(world));
        const out = [];
        m.getMoveDown(node(0, 63, 0), out);
        assert.deepEqual(at(out, 0, 62, 0), []);
        assert.equal(at(out, 0, 60, 0).length, 1, 'the drop');
    });

    // A ladder against a stone column north of it: ladder cells (0, 64..69, 0) facing south, the column (0, 64..70, -1).
    function towerWorld() {
        const world = makeWorld();
        world.fill(0, 64, -1, 0, 70, -1, 'stone');
        world.fill(0, 64, 0, 0, 69, 0, 'ladder', { facing: 'south' });
        return world;
    }

    test('up the ladder: look at the wall, hold forward, never jump; the ladder points get the wide tolerance', () => {
        const bot = pathBot(towerWorld(), [0.5, 64, 0.5]);
        bot.pathfinder.setGoal(new pf.goals.GoalBlock(0, 68, 0));
        bot.tick();
        bot.tick();
        assert.ok(bot.paths.length >= 1 && bot.paths[0].length > 0, 'a path');
        assert.ok(bot.paths[0].every((p) => p.x === 0.5 && p.z === 0.5), 'every point in the middle of the column');
        assert.ok(bot.paths[0].every((p) => p.tolerance === 0.35), JSON.stringify(bot.paths[0].map((p) => p.tolerance)));
        assert.equal(bot.controlState.forward, true, 'forward');
        assert.equal(bot.controlState.jump, false, 'no jump');
        assert.ok(Math.abs(bot.entity.yaw - 0) < 1e-9, `the yaw towards the wall in the north, got ${bot.entity.yaw}`);
        bot.pathfinder.setGoal(null);
    });

    test('down the ladder: look at the wall, release forward, no sneak, never jump', () => {
        const bot = pathBot(towerWorld(), [0.5, 69, 0.5]);
        bot.entity.onGround = false;
        bot.pathfinder.setGoal(new pf.goals.GoalBlock(0, 64, 0));
        bot.tick();
        bot.tick();
        assert.ok(bot.paths.length >= 1 && bot.paths[0].length > 0, 'a path');
        assert.ok(bot.paths[0][0].y < 69, 'the next point is below');
        assert.equal(bot.controlState.forward, false, 'forward released');
        assert.equal(bot.controlState.jump, false, 'no jump');
        assert.equal(bot.controlState.sneak, false, 'sneak off');
        assert.ok(Math.abs(bot.entity.yaw - 0) < 1e-9, `the yaw towards the wall, got ${bot.entity.yaw}`);
        bot.pathfinder.setGoal(null);
    });

    test('no stuck re-plan while the height on the ladder changes by 0.05 or more per tick; stuck when it does not', () => {
        // The bot is 0.4 off the middle of the column, so it never arrives at a point by the tolerance alone.
        const climbing = pathBot(towerWorld(), [0.9, 64, 0.5]);
        climbing.pathfinder.setGoal(new pf.goals.GoalBlock(0, 69, 0));
        climbing.tick();
        for (let i = 0; i < 8; i++) {
            climbing.entity.position.y += 0.06;
            climbing.tick(1000);
        }
        assert.ok(!climbing.resets.includes('stuck'), `climbing: ${climbing.resets.join(', ')}`);
        climbing.pathfinder.setGoal(null);

        const still = pathBot(towerWorld(), [0.9, 64, 0.5]);
        still.pathfinder.setGoal(new pf.goals.GoalBlock(0, 69, 0));
        still.tick();
        for (let i = 0; i < 8; i++) {
            still.entity.position.y += 0.01;
            still.tick(1000);
        }
        assert.ok(still.resets.includes('stuck'), `still: ${still.resets.join(', ')}`);
        still.pathfinder.setGoal(null);
    });
});

// ------------------------------------------------------------------------------------------------------- P3

describe('P3: doors in the path', () => {
    test('every door point is centred, with tolerance 0.35; the other points 0.175', () => {
        const world = makeWorld();
        for (const x of [2, 4]) {
            world.fill(x, 64, -6, x, 66, 6, 'stone');
            world.set(x, 64, 0, 'oak_door', { facing: 'east', half: 'lower', hinge: 'left', open: false });
            world.set(x, 65, 0, 'oak_door', { facing: 'east', half: 'upper', hinge: 'left', open: false });
        }
        const bot = pathBot(world, [0.5, 64, 0.5]);
        const m = new pf.Movements(bot);
        m.canDig = false;
        const result = bot.pathfinder.getPathTo(m, new pf.goals.GoalBlock(6, 64, 0));
        assert.equal(result.status, 'success');
        const doors = result.path.filter((p) => Math.floor(p.x) === 2 || Math.floor(p.x) === 4);
        assert.equal(doors.length, 2, JSON.stringify(result.path.map((p) => [p.x, p.y, p.z])));
        for (const p of doors) {
            assert.deepEqual([p.x % 1, p.z], [0.5, 0.5], 'centred');
            assert.equal(p.tolerance, 0.35, 'door tolerance');
        }
        const others = result.path.filter((p) => !doors.includes(p));
        assert.ok(others.length > 0);
        for (const p of others) assert.equal(p.tolerance, 0.175, `at ${p.x}, ${p.z}`);
    });
});

// ------------------------------------------------------------------------------------------------------- P4

describe('P4: blocks to stand on', () => {
    test('a bottom slab and bottom stairs are no floor; a top slab, a double slab and top stairs are', () => {
        const world = makeWorld();
        world.set(0, 64, 0, 'oak_slab', { type: 'bottom' });
        world.set(1, 64, 0, 'oak_slab', { type: 'top' });
        world.set(2, 64, 0, 'oak_slab', { type: 'double' });
        world.set(3, 64, 0, 'oak_stairs', { half: 'bottom', facing: 'north' });
        world.set(4, 64, 0, 'oak_stairs', { half: 'top', facing: 'north' });
        const m = new pf.Movements(moveBot(world));
        const physical = (x) => m.getBlock(new Vec3(x, 64, 0), 0, 0, 0).physical;
        assert.equal(physical(0), false, 'bottom slab');
        assert.equal(physical(1), true, 'top slab');
        assert.equal(physical(2), true, 'double slab');
        assert.equal(physical(3), false, 'bottom stairs');
        assert.equal(physical(4), true, 'top stairs');
    });

    test('cauldrons, composters, hoppers and every block of isNoStandBlock are no floor', () => {
        const names = REGISTRY.blocksArray.map((b) => b.name).filter((n) => STAND.isNoStandBlock(n, null));
        for (const n of ['composter', 'cauldron', 'hopper']) assert.ok(names.includes(n), n);
        const world = makeWorld();
        names.forEach((n, i) => world.set(i, 64, 5, n));
        const m = new pf.Movements(moveBot(world));
        const wrong = names.filter((n, i) => m.getBlock(new Vec3(i, 64, 5), 0, 0, 0).physical !== false);
        assert.deepEqual(wrong, []);
    });

    test('no step onto a composter: the forward move over it is not offered', () => {
        const world = makeWorld();
        world.set(1, 63, 0, 'composter');
        const m = new pf.Movements(moveBot(world));
        const out = [];
        m.getMoveForward(node(0, 64, 0), { x: 1, z: 0 }, out);
        assert.deepEqual(at(out, 1, 64, 0), []);
    });

    test('a one-wide pit whose way out needs a jump of 2 costs 50 more to enter than a wide one', () => {
        const pit = makeWorld();
        pit.fill(1, 62, 0, 1, 63, 0, 'air');
        const wide = makeWorld();
        wide.fill(1, 62, 0, 2, 63, 0, 'air');
        const cost = (world) => {
            const m = new pf.Movements(moveBot(world));
            const moves = at(m.getNeighbors(node(0, 64, 0)), 1, 62, 0);
            assert.equal(moves.length, 1, 'the drop into the hole');
            return moves[0].cost;
        };
        const a = cost(pit);
        const b = cost(wide);
        assert.ok(Math.abs(a - b - 50) < 1e-9, `pit ${a}, wide ${b}`);
    });
});

// ------------------------------------------------------------------------------------------------------- P5

describe('P5: the cells near a stuck point cost 100 more for 30 s', () => {
    test('a stuck walk marks the unreached point; the next search avoids it; 30 s later the cost is gone', () => {
        const world = makeWorld();
        const bot = pathBot(world, [0.5, 64, 0.5]);
        const goal = new pf.goals.GoalBlock(6, 64, 0);
        bot.pathfinder.setGoal(goal);
        bot.tick();
        assert.ok(bot.paths.length >= 1, 'a path');
        const first = bot.paths[0][0];
        const mark = [Math.floor(first.x), Math.floor(first.y), Math.floor(first.z)];
        for (let i = 0; i < 5 && !bot.resets.includes('stuck'); i++) bot.tick(1000); // the bot does not move
        assert.ok(bot.resets.includes('stuck'), bot.resets.join(', '));
        bot.pathfinder.setGoal(null);

        const base = new pf.Movements(bot).getNeighbors(node(0, 64, 0));
        const m = new pf.Movements(bot);
        bot.pathfinder.getPathTo(m, goal); // the search gets the active marks
        const near = m.getNeighbors(node(0, 64, 0));
        const costOf = (list, x, y, z) => at(list, x, y, z)[0]?.cost;
        assert.ok(Math.abs(costOf(near, ...mark) - costOf(base, ...mark) - 100) < 1e-9,
            `into the marked cell ${mark}: ${costOf(near, ...mark)} vs ${costOf(base, ...mark)}`);
        const far = [-1, 64, 0];
        if (Math.abs(far[0] - mark[0]) > 1) {
            assert.equal(costOf(near, ...far), costOf(base, ...far), 'a cell farther than 1 block');
        }

        clock += 30001;
        const later = new pf.Movements(bot);
        bot.pathfinder.getPathTo(later, goal);
        const after30 = later.getNeighbors(node(0, 64, 0));
        assert.equal(costOf(after30, ...mark), costOf(base, ...mark), 'after 30 s');
    });
});
