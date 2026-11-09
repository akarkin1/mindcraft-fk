// v0.1.4.14, part L (engineer E1), fix round part 8 (P-19 point 3, spec 8.3.3): the climb from water onto ice. The owner's
// bot stuck at the edge of the ice of a frozen sea until a code action jumped it out. The cause is in the path search,
// not in the physics: getMoveJumpUp of mineflayer-pathfinder refuses a jump of more than 1.2 blocks measured from the
// top of the block BELOW the bot; swimming in deep water that block is water (height y - 1), so the ice at the water's
// surface (height y + 1) read as a jump of 2. On a shore the ground rises a block at a time, so the walk out of a
// pond was never refused; a frozen sea (or a pier) is a ledge one block above deep water. The game climbs out of
// water onto such a ledge (prismarine-physics, outOfLiquidImpulse), and the physics of the library do it too.
// patches/mineflayer-pathfinder+2.4.5.patch, lib/movements.js: standLevel(node, block0): in water the level the bot
// jumps from is the surface of its own cell; getMoveJumpUp and the jump of getMoveDiagonal use it.
//
// The world and the bot are those of gjp_pathfinder.test.js: the fake world of the mining tests read as blocks of
// prismarine-block (26.1), the patched path search injected into a bot that moves with prismarine-physics, one tick per
// physicsTick, without timers.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { repoPath } from '../helpers/paths.js';
import { makeWorld, REGISTRY } from './mining_fake_bot.test.js';
import { TEST_MC_VERSION } from '../helpers/load.js';

const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
const Block = require('prismarine-block')(REGISTRY);
const { Physics, PlayerState } = require('prismarine-physics');
const pf = require('mineflayer-pathfinder');

const read = (rel) => fs.readFileSync(repoPath(rel), 'utf8').replace(/\r\n/g, '\n');

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

// A frozen sea: ground at y 60 (grass), a pool of water 3 deep (y 58..60) from x 0 to 6, z -3 to 3, the ice at y 60
// everywhere else in the box x -4..10 (the water's surface is at y 60, the ice stands one block above the water the
// bot swims in at y 60? no: the bot swims in the water of y 60, its feet in that cell; the ice of y 61 is the ledge).
// Layout, so that the sea is a ledge: water y 58..61 at x 0..6, ice at y 61 around it (over dirt), air above.
function frozenSea({ edge = 'ice' } = {}) {
    const world = blockWorld(makeWorld({ groundY: 60 }));
    world.fill(-6, 61, -6, 12, 61, 6, edge); // the ice sheet one block above the ground
    world.fill(0, 58, -3, 6, 61, 3, 'water', { level: 0 }); // the hole in the ice: deep water up to the surface at y 61
    return world;
}

function simBot(world, pos) {
    const bot = new EventEmitter();
    bot.setMaxListeners(100);
    bot.version = TEST_MC_VERSION;
    bot.registry = REGISTRY;
    bot.game = { minY: world.minY, dimension: 'overworld' };
    bot.world = { setBlockStateId() {} };
    bot.entity = {
        position: new Vec3(...pos), velocity: new Vec3(0, 0, 0), onGround: false, yaw: 0, pitch: 0, effects: {}, attributes: {}, height: 1.8,
        isInWater: true, isInLava: false, isInWeb: false, isCollidedHorizontally: false, isCollidedVertically: false, elytraFlying: false,
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
    bot.activateBlock = async () => {};
    bot.dig = async () => { throw new Error('no digging in this test'); };
    bot.stopDigging = () => {};
    bot.physics = Physics(REGISTRY, world);
    pf.pathfinder(bot);
    bot.tick = () => {
        bot.emit('physicsTick');
        const state = new PlayerState(bot, bot.controlState);
        bot.physics.simulatePlayer(state, world).apply(bot);
    };
    return bot;
}

async function walk(bot, goal, maxTicks = 600) {
    let done = null;
    bot.pathfinder.goto(goal).then(() => { done = 'ok'; }, (err) => { done = err.name; });
    let ticks = 0;
    for (; ticks < maxTicks && done === null; ticks++) {
        bot.tick();
        await new Promise((r) => setImmediate(r));
    }
    for (let i = 0; i < 5 && done === null; i++) await new Promise((r) => setImmediate(r));
    return { done, ticks };
}

function movementsOf(world) {
    const bot = simBot(world, [3.5, 61, 0.5]);
    const movements = new pf.Movements(bot);
    movements.canDig = false;
    movements.allowParkour = false;
    movements.allow1by1towers = false;
    movements.scafoldingBlocks = [];
    return { bot, movements };
}

const node = { x: 6, y: 61, z: 0, remainingBlocks: 0 }; // the last water cell before the ice at x 7
const east = { x: 1, z: 0 };

describe('L: the climb from water onto ice (mineflayer-pathfinder movements.js)', () => {
    test('the patch file and the patched movements.js hold the hunk', () => {
        const patch = read('patches/mineflayer-pathfinder+2.4.5.patch');
        const src = read('node_modules/mineflayer-pathfinder/lib/movements.js');
        for (const line of [
            'if (blockC.height - this.standLevel(node, block0) > 1.2) return // Too high to jump',
            'standLevel (node, block0) {',
            'return here.liquid ? Math.max(block0.height, node.y) : block0.height',
            'if (above.liquid && !overHead.physical && !this.blocksToAvoid.has(overHead.type)) {',
            'underwater (node) {',
            "// P-19: two or more cells under the water's surface the swim up is the only move (one check per node)",
            'if (this.underwater(node)) {',
            'neighbors.push(new Move(node.x, node.y + 1, node.z, node.remainingBlocks, 1 + this.liquidCost, [], []))',
        ]) {
            assert.ok(src.includes(line), `movements.js: ${line}`);
            assert.ok(patch.includes(`+${src.split('\n').find((l) => l.includes(line))}`), `patch: ${line}`);
        }
        assert.doesNotMatch(patch, /\r/, 'LF line endings');
    });

    test('the world: deep water up to the surface at y 61, the ice sheet at y 61 around it', () => {
        const world = frozenSea();
        assert.equal(world.nameAt(6, 61, 0), 'water');
        assert.equal(world.nameAt(6, 60, 0), 'water');
        assert.equal(world.nameAt(6, 58, 0), 'water');
        assert.equal(world.nameAt(7, 61, 0), 'ice');
        assert.equal(world.nameAt(7, 62, 0), 'air');
        assert.equal(world.nameAt(7, 60, 0), 'grass_block');
    });

    test('standLevel: on the ground the top of the block below; in deep water the surface of the cell', () => {
        const { movements } = movementsOf(frozenSea());
        const block0 = movements.getBlock(node, 0, -1, 0);
        assert.equal(block0.liquid, true);
        assert.equal(block0.height, 60, 'water has no shape: its height is the cell');
        assert.equal(movements.standLevel(node, block0), 61);
        const land = { x: 8, y: 62, z: 0, remainingBlocks: 0 };
        const under = movements.getBlock(land, 0, -1, 0);
        assert.equal(movements.standLevel(land, under), 62, 'on the ice: its top');
        const shallow = { x: 6, y: 59, z: 0, remainingBlocks: 0 }; // water with the bottom of the pool right below
        const bottom = movements.getBlock(shallow, 0, -1, 0);
        assert.equal(movements.standLevel(shallow, bottom), 59);
    });

    test('from the water the path search offers the jump onto the ice (getMoveJumpUp)', () => {
        const { movements } = movementsOf(frozenSea());
        const neighbors = [];
        movements.getMoveJumpUp(node, east, neighbors);
        assert.equal(neighbors.length, 1, 'one move onto the ice');
        assert.deepEqual([neighbors[0].x, neighbors[0].y, neighbors[0].z], [7, 62, 0]);
        // the rule it replaces: measured from the water block below, the ice stood 2 above and the jump was refused
        const blockC = movements.getBlock(node, 1, 0, 0);
        const block0 = movements.getBlock(node, 0, -1, 0);
        assert.equal(blockC.height - block0.height, 2);
        assert.equal(blockC.height - movements.standLevel(node, block0), 1);
    });

    test('the same for packed_ice, blue_ice, frosted_ice and a stone pier; two blocks up stays refused', () => {
        for (const edge of ['packed_ice', 'blue_ice', 'frosted_ice', 'stone']) {
            const { movements } = movementsOf(frozenSea({ edge }));
            const neighbors = [];
            movements.getMoveJumpUp(node, east, neighbors);
            assert.equal(neighbors.length, 1, `${edge}: the jump out of the water`);
        }
        const tall = frozenSea();
        tall.set(7, 62, 0, 'ice'); // the edge two blocks above the water
        const { movements } = movementsOf(tall);
        const neighbors = [];
        movements.getMoveJumpUp(node, east, neighbors);
        assert.equal(neighbors.length, 0, 'a wall of 2 is no jump');
    });

    test('a bot that sank: the swim up through the water, one cell at a time, never into the air', () => {
        const { movements } = movementsOf(frozenSea());
        const deep = { x: 3, y: 58, z: 0, remainingBlocks: 0 }; // the bottom of the hole
        const neighbors = [];
        movements.getMoveUp(deep, neighbors);
        assert.equal(neighbors.length, 1);
        assert.deepEqual([neighbors[0].x, neighbors[0].y, neighbors[0].z], [3, 59, 0]);
        assert.equal(neighbors[0].toPlace.length, 0, 'no block placed in water');
        const surface = { x: 3, y: 61, z: 0, remainingBlocks: 0 };
        const none = [];
        movements.getMoveUp(surface, none);
        assert.equal(none.length, 0, 'the cell above the surface is air: no move up out of the water');
        const roofed = frozenSea();
        roofed.set(3, 60, 0, 'ice'); // a roof two cells over the feet of the bot at the bottom: the cell above (59) is water
        const r = movementsOf(roofed);
        const blocked = [];
        r.movements.getMoveUp(deep, blocked);
        assert.equal(blocked.length, 0, 'nothing over the head: no rise into a roof');
    });

    test('two or more cells under the surface the swim up is the only move; a floating bot keeps every move', () => {
        const { movements } = movementsOf(frozenSea());
        const deep = { x: 3, y: 58, z: 0, remainingBlocks: 0 };
        assert.equal(movements.underwater(deep), true);
        assert.equal(movements.underwater({ x: 3, y: 59, z: 0 }), true, 'three cells of water above the feet');
        assert.equal(movements.underwater({ x: 3, y: 60, z: 0 }), false, 'the feet one below the top cell: a floating bot');
        assert.equal(movements.underwater({ x: 3, y: 61, z: 0 }), false, 'the top cell');
        assert.equal(movements.underwater({ x: 8, y: 62, z: 0 }), false, 'on the ice');
        const fromBottom = movements.getNeighbors(deep);
        assert.deepEqual(fromBottom.map((m) => [m.x, m.y, m.z]), [[3, 59, 0]], 'the swim up is the only move from the bottom');
        const floating = movements.getNeighbors({ x: 3, y: 60, z: 0, remainingBlocks: 0 });
        assert.ok(floating.some((m) => m.x === 4 && m.y === 60 && m.z === 0), 'one below the top cell: the swim forward');
        assert.ok(floating.some((m) => m.x === 3 && m.y === 61 && m.z === 0), 'and the swim up');
        // a pond 2 deep: a floating bot has its feet in the bottom cell and swims across as before
        const pond = blockWorld(makeWorld({ groundY: 60 }));
        pond.fill(0, 59, -2, 6, 60, 2, 'water', { level: 0 });
        const m = movementsOf(pond).movements;
        assert.equal(m.underwater({ x: 3, y: 59, z: 0 }), false);
        const across = [];
        m.getMoveForward({ x: 3, y: 59, z: 0, remainingBlocks: 0 }, east, across);
        assert.equal(across.length, 1);
    });

    test('from the bottom of the hole a path onto the ice exists and the bot swims up and climbs out', async () => {
        const world = frozenSea();
        const bot = simBot(world, [3.5, 58.5, 0.5]);
        const movements = new pf.Movements(bot);
        movements.canDig = false;
        movements.allowParkour = false;
        movements.allow1by1towers = false;
        movements.scafoldingBlocks = [];
        bot.pathfinder.setMovements(movements);
        const goal = new pf.goals.GoalBlock(9, 62, 0);
        const path = bot.pathfinder.getPathTo(movements, goal, 2000);
        assert.equal(path.status, 'success', `a path from the bottom: ${path.status}`);
        assert.ok(path.path.some((p) => p.y === 61 && movements.getBlock(p, 0, 0, 0).liquid), 'the path rises through the water to the surface');
        const result = await walk(bot, goal, 1200);
        assert.equal(result.done, 'ok', `the walk ended: ${result.done} after ${result.ticks} ticks`);
        const p = bot.entity.position;
        assert.ok(Math.abs(p.x - 9.5) < 0.6 && p.y >= 62 - 1e-6, `on the ice at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
    });

    test('the diagonal jump out of the water too', () => {
        const { movements } = movementsOf(frozenSea());
        const corner = { x: 6, y: 61, z: 3, remainingBlocks: 0 };
        const neighbors = [];
        movements.getMoveDiagonal(corner, { x: 1, z: 1 }, neighbors);
        assert.equal(neighbors.length, 1);
        assert.deepEqual([neighbors[0].x, neighbors[0].y, neighbors[0].z], [7, 62, 4]);
    });

    test('a path from the middle of the water to the ice exists and the bot swims and climbs out', async () => {
        const world = frozenSea();
        const bot = simBot(world, [3.5, 61.2, 0.5]);
        const movements = new pf.Movements(bot);
        movements.canDig = false;
        movements.allowParkour = false;
        movements.allow1by1towers = false;
        movements.scafoldingBlocks = [];
        bot.pathfinder.setMovements(movements);
        const goal = new pf.goals.GoalBlock(9, 62, 0);
        const path = bot.pathfinder.getPathTo(movements, goal, 2000);
        assert.equal(path.status, 'success', `a path onto the ice: ${path.status}`);
        assert.ok(path.path.some((p) => p.y === 62), 'the path climbs onto the ice');
        const result = await walk(bot, goal, 800);
        assert.equal(result.done, 'ok', `the walk ended: ${result.done} after ${result.ticks} ticks`);
        const p = bot.entity.position;
        assert.ok(Math.abs(p.x - 9.5) < 0.6 && Math.abs(p.z - 0.5) < 0.6 && p.y >= 62 - 1e-6, `on the ice at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
    });
});
