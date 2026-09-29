// v0.1.4.8, fix round, the last holes of X1 (DEFECTS_WORLD_0148.md): the bot got into the composter of the
// farm; the path search takes a composter for ground, the bot fits between its walls and falls in. The
// farming pack avoids it in its own walks; these are the walks of the home pack:
//   1. makeMovements (motion.js): a composter, cauldron, hopper, chest, fence or wall is no ground to stand
//      on, and gotoGoal never ends a walk in or on one of them or on a closed gate (safeGoal);
//   2. passThrough (doors.js): into a farm (the option `inside`, or farmland within 2 blocks behind the
//      gate) the step through has no sprint, no parkour and no jump; `options.movements` is taken as given;
//   3. the far cell of passThrough is never the cell of such a block nor the cell above it: the nearest
//      free cell beside it on the far side.
// The path search is the real one of mineflayer-pathfinder where the test plans a way (A* over real blocks).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeFakeBot, buildHouse, REGISTRY, v } from './home_fake_bot.test.js';

const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
const Block = require('prismarine-block')(REGISTRY);
const AStar = require('mineflayer-pathfinder/lib/astar.js');
const Move = require('mineflayer-pathfinder/lib/move.js');
const pf = require('mineflayer-pathfinder');

const S = await loadSrc('src/agent/packs/home/stand_logic.js');
const M = await loadSrc('src/agent/packs/home/motion.js');
const D = await loadSrc('src/agent/packs/home/doors.js');
const SH = await loadSrc('src/agent/packs/home/shelter.js');
const H = await loadSrc('src/agent/packs/home/index.js');

let warn;
before(() => { warn = console.warn; console.warn = () => {}; });
after(() => { console.warn = warn; });

// ---- a block world of real prismarine blocks: grass at y 60, air above ----
const key = (x, y, z) => `${x},${y},${z}`;
function realWorld() {
    const map = new Map();
    const at = (x, y, z) => map.get(key(x, y, z)) ?? { name: y < 60 ? 'dirt' : y === 60 ? 'grass_block' : 'air', props: {} };
    return {
        set: (x, y, z, name, props = {}) => map.set(key(x, y, z), { name, props }),
        block(pos) {
            const b = at(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
            const block = Block.fromProperties(b.name, b.props, 0);
            block.position = new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
            return block;
        },
    };
}

function pathBot(world) {
    return {
        registry: REGISTRY,
        entity: { position: new Vec3(0.5, 61, 0.5), isInLava: false, effects: [] },
        game: { minY: -64 },
        inventory: { items: () => [] },
        pathfinder: { bestHarvestTool: () => null },
        blockAt: (pos) => world.block(pos),
    };
}

function search(movements, goal, from, timeoutMs = 5000) {
    const astar = new AStar(new Move(from.x, from.y, from.z, 0, 0), movements, goal, timeoutMs, timeoutMs, -1);
    let result = astar.compute();
    while (result.status === 'partial') result = astar.compute();
    return result;
}

const inOrOn = (p, b) => p.x === b.x && p.z === b.z && (p.y === b.y || p.y === b.y + 1);
const COMPOSTER = { x: 4, y: 61, z: 0 };

describe('X1: the blocks the bot never stands in or on (stand_logic.js, pure)', () => {
    test('composter, cauldrons, hopper, chests, fences, walls and closed gates; an open gate and other blocks are fine', () => {
        for (const name of ['composter', 'minecraft:composter', 'cauldron', 'water_cauldron', 'lava_cauldron', 'powder_snow_cauldron', 'hopper',
            'chest', 'trapped_chest', 'ender_chest', 'oak_fence', 'nether_brick_fence', 'cobblestone_wall']) {
            assert.equal(S.isNoStandBlock(name), true, name);
        }
        assert.equal(S.isNoStandBlock('oak_fence_gate', { open: false }), true);
        assert.equal(S.isNoStandBlock('oak_fence_gate', { open: true }), false);
        assert.equal(S.isNoStandBlock('oak_fence_gate', { open: 'true' }), false);
        for (const name of ['grass_block', 'farmland', 'oak_planks', 'wall_torch', 'oak_door', 'red_bed', 'air', '', null]) {
            assert.equal(S.isNoStandBlock(name), false, String(name));
        }
    });

    test('isNoStandCell: in the block or on it', () => {
        const get = (x, y, z) => (x === 1 && y === 61 && z === 1 ? { name: 'chest' } : { name: 'air' });
        assert.equal(S.isNoStandCell(get, { x: 1.5, y: 61, z: 1.5 }), true, 'in');
        assert.equal(S.isNoStandCell(get, { x: 1.5, y: 62, z: 1.5 }), true, 'on');
        assert.equal(S.isNoStandCell(get, { x: 1.5, y: 63, z: 1.5 }), false);
        assert.equal(S.isNoStandCell(get, { x: 2.5, y: 62, z: 1.5 }), false);
        assert.equal(S.isNoStandCell(() => { throw new Error('x'); }, { x: 0, y: 0, z: 0 }), false);
    });

    test('goalAvoiding keeps the goal: its fields, its heuristic, a dynamic goal that moves', () => {
        const goal = new pf.goals.GoalNear(3, 61, 3, 1);
        const wrapped = S.goalAvoiding(goal, (n) => n.x === 3 && n.z === 3);
        assert.equal(wrapped.x, 3);
        assert.equal(wrapped.rangeSq, 1);
        assert.ok(wrapped instanceof pf.goals.GoalNear);
        assert.equal(wrapped.isEnd(v(3, 61, 3)), false, 'refused');
        assert.equal(wrapped.isEnd(v(3, 61, 2)), true);
        assert.equal(wrapped.heuristic(v(0, 61, 3)), goal.heuristic(v(0, 61, 3)));
        const entity = { position: v(10.5, 61, 10.5), isValid: true };
        const follow = new pf.goals.GoalFollow(entity, 1);
        const wf = S.goalAvoiding(follow, () => false);
        entity.position = v(20.5, 61, 10.5);
        assert.equal(wf.hasChanged(), true);
        assert.equal(wf.x, 20, 'the goal updated its own fields; the wrapper reads them');
        assert.equal(wf.isEnd(v(20, 61, 10)), true);
        assert.equal(S.goalAvoiding(null, () => true), null);
    });

    test('exported by the home pack', () => {
        assert.equal(H.isNoStandBlock, S.isNoStandBlock);
        assert.equal(typeof H.safeGoal, 'function');
        assert.equal(typeof H.freeFarCell, 'function');
        assert.equal(typeof H.farmBehind, 'function');
    });
});

describe('X1: makeMovements and gotoGoal of the home pack (real path search)', () => {
    test('the cause: the plain path search ends a walk to the rim of the composter on top of it', () => {
        const w = realWorld();
        w.set(COMPOSTER.x, COMPOSTER.y, COMPOSTER.z, 'composter', { level: 0 });
        const old = new pf.Movements(pathBot(w));
        old.canDig = false;
        const res = search(old, new pf.goals.GoalNear(4, 62, 0, 1), { x: 2, y: 61, z: 0 });
        assert.equal(res.status, 'success');
        const end = res.path[res.path.length - 1];
        assert.deepEqual([end.x, end.y, end.z], [4, 62, 0], 'on top of the hollow composter');
    });

    test('with makeMovements and safeGoal no walk goes into or onto a composter, chest, cauldron or hopper', () => {
        const w = realWorld();
        const blocks = [['composter', 4, 0], ['chest', 4, 3], ['cauldron', 4, 6], ['hopper', 4, 9]];
        for (const [name, x, z] of blocks) w.set(x, 61, z, name);
        const bot = pathBot(w);
        const m = M.makeMovements(bot, { dig: false });
        for (const name of ['composter', 'chest', 'trapped_chest', 'ender_chest', 'cauldron', 'water_cauldron', 'hopper', 'oak_fence', 'cobblestone_wall']) {
            assert.ok(m.fences.has(REGISTRY.blocksByName[name].id), name);
        }
        assert.equal(m.fences.has(REGISTRY.blocksByName.oak_fence_gate.id), false, 'gates: the path search opens them itself');
        for (const [name, x, z] of blocks) {
            const res = search(m, M.safeGoal(bot, new pf.goals.GoalNear(x, 61, z, 1)), { x: 1, y: 61, z });
            assert.equal(res.status, 'success', name);
            assert.ok(res.path.every((p) => !inOrOn(p, { x, y: 61, z })), `${name}: ${JSON.stringify(res.path)}`);
            const end = res.path[res.path.length - 1];
            assert.equal(end.y, 61, `${name}: the walk ends on the ground beside it`);
        }
    });

    test('a walk over a row of chests goes round them, not over them', () => {
        const w = realWorld();
        for (let z = -3; z <= 3; z++) w.set(3, 61, z, 'chest');
        const bot = pathBot(w);
        const res = search(M.makeMovements(bot, { dig: false }), M.safeGoal(bot, new pf.goals.GoalBlock(6, 61, 0)), { x: 0, y: 61, z: 0 });
        assert.equal(res.status, 'success');
        assert.ok(res.path.every((p) => !(p.x === 3 && p.z >= -3 && p.z <= 3)), JSON.stringify(res.path));
    });

    test('gotoGoal hands the path search the safe goal: never on a chest, as before elsewhere', async () => {
        const world = makeWorld();
        world.set(3, 64, 3, 'chest');
        const bot = makeFakeBot({ world, pos: [0.5, 64, 0.5] });
        bot.gotoImpl = async () => {};
        await M.gotoGoal(bot, new pf.goals.GoalNear(3, 65, 3, 1), { timeoutMs: 1000 });
        const goal = bot.calls.find((c) => c[0] === 'goto')[1];
        assert.equal(goal.isEnd(v(3, 65, 3)), false, 'on the chest');
        assert.equal(goal.isEnd(v(3, 64, 3)), false, 'in the chest');
        assert.equal(goal.isEnd(v(2, 65, 3)), true, 'beside it');
        assert.equal(goal.x, 3, 'the fields of the goal');
        assert.equal(M.safeGoal(bot, goal), goal, 'not wrapped twice');
    });

    test('a place to stand in the house is never on a chest (standingTest)', () => {
        const world = makeWorld();
        world.set(3, 64, 3, 'chest');
        world.set(5, 64, 3, 'oak_planks');
        const test = SH.standingTest(makeFakeBot({ world }));
        assert.equal(test(3, 65, 3), false, 'on the chest');
        assert.equal(test(5, 65, 3), true, 'on planks');
    });
});

// ---- passThrough with the fake bot of the home pack: a gate in the south side of a field at z 7 ----
function gateScene({ farmland = true, composterAt = null } = {}) {
    const world = makeWorld();
    world.gate(4, 64, 7, { facing: 'south' });
    for (let x = 2; x <= 6; x++) if (x !== 4) world.set(x, 64, 7, 'oak_fence'); // the fence line of the gate
    if (farmland) {
        for (let x = 2; x <= 6; x++) for (let z = 3; z <= 6; z++) world.set(x, 63, z, 'farmland');
    }
    if (composterAt) world.set(composterAt.x, composterAt.y, composterAt.z, 'composter');
    const bot = makeFakeBot({ world, pos: [4.5, 64, 11.5] });
    const moves = [];
    const setMovements = bot.pathfinder.setMovements.bind(bot.pathfinder);
    bot.pathfinder.setMovements = (m) => { moves.push(m); setMovements(m); };
    const ctx = { areas: [], settings: {}, log: () => {}, now: () => Date.now() };
    return { world, bot, moves, ctx, gate: { x: 4, y: 64, z: 7 } };
}

// The movements and the goal of the step through: the last goto with a GoalBlock
function stepThrough(bot, moves) {
    const gotos = bot.calls.filter((c) => c[0] === 'goto');
    return { goal: gotos[gotos.length - 1][1], movements: moves[moves.length - 1] };
}

const careful = (m) => m.allowSprinting === false && m.allowParkour === false && m.getMoveJumpUp() === undefined
    && m.getNeighbors !== pf.Movements.prototype.getNeighbors;

describe('X1: passThrough into a farm steps carefully', () => {
    test('farmland within 2 blocks behind the gate: no sprint, no parkour, no jump', async () => {
        const { bot, moves, ctx, gate } = gateScene();
        const res = await D.passThrough(bot, gate, ctx, { checkMs: 40 });
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(res.text, 'I went through the gate at (4, 64, 7) and closed it.');
        assert.ok(careful(stepThrough(bot, moves).movements));
    });

    test('the option inside given by the farming pack (a box without a type) is a farm too', async () => {
        const { bot, moves, ctx, gate } = gateScene({ farmland: false });
        const inside = { min: { x: 1, y: 63, z: 1 }, max: { x: 7, y: 66, z: 6 } };
        await D.passThrough(bot, gate, ctx, { checkMs: 40, inside });
        assert.ok(careful(stepThrough(bot, moves).movements));
    });

    test('into a house (an area of type home, no farmland): the step through as before', async () => {
        const world = makeWorld();
        const area = buildHouse(world);
        const bot = makeFakeBot({ world, pos: [4.5, 64, 12.5] });
        const moves = [];
        const setMovements = bot.pathfinder.setMovements.bind(bot.pathfinder);
        bot.pathfinder.setMovements = (m) => { moves.push(m); setMovements(m); };
        const res = await D.passThrough(bot, { x: 4, y: 64, z: 7 }, { areas: [area] }, { checkMs: 40, inside: area });
        assert.equal(res.ok, true);
        const m = stepThrough(bot, moves).movements;
        assert.equal(m.allowSprinting, true);
        assert.equal(m.getNeighbors, pf.Movements.prototype.getNeighbors);
        assert.equal(D.farmBehind(bot, { x: 4, y: 64, z: 7, facing: 'south' }, -1, area), false);
    });

    test('options.movements: the step through takes them as given', async () => {
        const { bot, moves, ctx, gate } = gateScene();
        const own = M.makeMovements(bot, { dig: false, doors: false });
        own.mine = true;
        await D.passThrough(bot, gate, ctx, { checkMs: 40, movements: own });
        assert.equal(stepThrough(bot, moves).movements, own);
    });

    test('with the real path search: careful movements plan no jump up behind the gate, the plain ones do', () => {
        const w = realWorld();
        w.set(1, 61, 0, 'dirt'); // a step of one block
        const bot = pathBot(w);
        const goal = new pf.goals.GoalBlock(1, 62, 0);
        const plain = search(D.stepMovements(bot, false), goal, { x: 0, y: 61, z: 0 });
        assert.equal(plain.status, 'success');
        const safe = search(D.stepMovements(bot, true), goal, { x: 0, y: 61, z: 0 }, 300);
        assert.notEqual(safe.status, 'success', 'no way up without a jump');
    });

    test('farmBehind reads 2 blocks behind the gate, not in front of it and not farther', () => {
        const { bot } = gateScene({ farmland: false });
        const gate = { x: 4, y: 64, z: 7, facing: 'south' };
        bot.world.set(4, 63, 9, 'farmland'); // in front (z 9 is the near side)
        assert.equal(D.farmBehind(bot, gate, -1), false);
        bot.world.set(6, 63, 5, 'farmland'); // 2 behind, 2 to the side
        assert.equal(D.farmBehind(bot, gate, -1), true);
        assert.equal(D.FARMLAND_BEHIND, 2);
    });
});

describe('X1: the far cell of passThrough is never in or on a composter, chest, fence', () => {
    test('a composter on the far cell: the step ends on the nearest free cell beside it on the far side', async () => {
        const { bot, moves, ctx, gate, world } = gateScene({ composterAt: { x: 4, y: 64, z: 6 } });
        const res = await D.passThrough(bot, gate, ctx, { checkMs: 40 });
        assert.equal(res.ok, true, JSON.stringify(res));
        const { goal } = stepThrough(bot, moves);
        assert.notDeepEqual([goal.x, goal.y, goal.z], [4, 64, 6]);
        assert.equal(Math.abs(goal.x - 4) + Math.abs(goal.z - 6), 1, `beside it: ${goal.x}, ${goal.z}`);
        assert.ok(goal.z < 7, 'on the far side');
        const p = bot.entity.position;
        assert.ok(!(Math.floor(p.x) === 4 && Math.floor(p.z) === 6), `not in the composter: ${p}`);
        assert.equal(world.propsAt(4, 64, 7).open, false, 'the gate is closed');
    });

    test('a composter under the far cell (the bot would stand on it): the same', async () => {
        const { bot, moves, ctx, gate } = gateScene({ farmland: false, composterAt: { x: 4, y: 63, z: 6 } });
        await D.passThrough(bot, gate, ctx, { checkMs: 40 });
        const { goal } = stepThrough(bot, moves);
        assert.notDeepEqual([goal.x, goal.z], [4, 6]);
    });

    test('freeFarCell: the far cell as it is when free; null when nothing beside it is free', () => {
        const { bot } = gateScene({ farmland: false });
        const gate = { x: 4, y: 64, z: 7, facing: 'south' };
        assert.deepEqual(D.freeFarCell(bot, gate, { x: 4, y: 64, z: 6 }, -1), { x: 4, y: 64, z: 6 });
        for (let x = 1; x <= 7; x++) for (let z = 3; z <= 6; z++) bot.world.set(x, 64, z, 'chest');
        assert.equal(D.freeFarCell(bot, gate, { x: 4, y: 64, z: 6 }, -1), null);
    });
});
