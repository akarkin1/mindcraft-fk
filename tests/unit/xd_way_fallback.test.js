// v0.1.4.14, the play of 2026-11-09 (DECISIONS P-19, SPEC 8.3.1): the destructive fallback of goToGoal ("Path not found,
// but attempting to navigate anyway using destructive movements") dug into a cave at y 42 and under water on legs of 120
// blocks.
//   1. The fallback runs only for a way of at most 32 blocks; a longer way is walked as near as the path finder gets
//      without digging (the partial path of a search), then `I found no way to (x, y, z) without digging; I stopped at
//      (x, y, z), N blocks away.`
//   2. The fallback never digs a block below the bot's start level minus 1 and never a block touching water or lava: a
//      break exclusion on the movements of the walk (Movements.exclusionAreasBreak, read by safeToBreak).
//   3. goToPosition says no second "I stopped at" line after the text; a destructive path found in time is as before.
// The decision is pure (way_logic.js); the walks run on the fake bot of tests/helpers/xt_bot.js with staged paths.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { Vec3 } from 'vec3';
import pf from 'mineflayer-pathfinder';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { MC, makeFakeBot, move } from '../helpers/xt_bot.js';

register('../helpers/mcdata_hooks.js', import.meta.url);

let skills;
let mcdata;
let W;
let workDir;
let originalCwd;
let cap;
before(async () => {
    originalCwd = process.cwd();
    workDir = makeTmpDir();
    process.chdir(workDir); // nothing may read a keys.json
    cap = captureConsole();
    try {
        mcdata = await loadSrc('src/utils/mcdata.js');
        skills = await loadSrc('src/agent/library/skills.js');
        W = await loadSrc('src/agent/library/way_logic.js');
    } finally {
        process.chdir(originalCwd);
    }
    mcdata.__setMcdataForTests(MC);
});
after(() => {
    mcdata.__setMcdataForTests?.(null);
    cap.restore();
    removeTmpDir(workDir);
});

const feet = { x: 0.5, y: 64, z: 0.5 };

describe('P-19: the decision of the fallback (way_logic.js)', () => {
    test('goalPoint: the cell of a goal with x, y, z; x and z with the feet\'s y; a pos goal; none for a composite', () => {
        assert.deepEqual(W.goalPoint({ x: 3, y: 64, z: -2 }), { x: 3, y: 64, z: -2 });
        assert.deepEqual(W.goalPoint({ x: 3, z: -2 }, feet), { x: 3, y: 64, z: -2 });
        assert.equal(W.goalPoint({ x: 3, z: -2 }), null, 'GoalXZ without the feet');
        assert.deepEqual(W.goalPoint({ pos: new Vec3(1, 2, 3) }), { x: 1, y: 2, z: 3 });
        assert.equal(W.goalPoint({ goals: [] }), null);
        assert.equal(W.goalPoint(null), null);
        assert.deepEqual(W.goalPoint(new pf.goals.GoalNear(10.7, 64.2, -3.1, 2)), { x: 10, y: 64, z: -4 });
        assert.deepEqual(W.goalPoint(new pf.goals.GoalXZ(10.7, -3.1), feet), { x: 10, y: 64, z: -4 });
    });

    test('fallbackAllowed: a way of 32 blocks yes, 33 no, 34 down no; an unknown goal as before', () => {
        assert.deepEqual(W.fallbackAllowed(feet, { x: 32, y: 64, z: 0 }), { allowed: true, blocks: 32, point: { x: 32, y: 64, z: 0 } });
        assert.equal(W.fallbackAllowed(feet, { x: 33, y: 64, z: 0 }).allowed, false);
        assert.equal(W.fallbackAllowed(feet, { x: 0, y: 30, z: 0 }).allowed, false);
        assert.deepEqual(W.fallbackAllowed(feet, { goals: [] }), { allowed: true, blocks: null, point: null });
        assert.equal(W.FALLBACK_RULES.maxWay, 32);
        assert.equal(W.FALLBACK_RULES.digBelowStart, 1);
    });

    test('mayDigOnFallback: the floor is the start level minus 1; water or lava on any of the 6 sides forbids the dig', () => {
        const blocks = new Map([['0,61,0', 'water'], ['3,63,0', 'lava'], ['5,64,0', 'kelp']]);
        const read = (x, y, z) => blocks.get(`${x},${y},${z}`) ?? 'stone';
        assert.equal(W.mayDigOnFallback(read, { x: 10, y: 63, z: 0 }, 64), true, 'the start level minus 1');
        assert.equal(W.mayDigOnFallback(read, { x: 10, y: 62, z: 0 }, 64), false, 'the start level minus 2');
        assert.equal(W.mayDigOnFallback(read, { x: 10, y: 70, z: 0 }, 64), true, 'above');
        assert.equal(W.mayDigOnFallback(read, { x: 10, y: 63, z: 0 }, 64.3), true, 'the feet a little above the level');
        assert.equal(W.mayDigOnFallback(read, { x: 0, y: 62, z: 0 }, 60), false, 'water below');
        assert.equal(W.mayDigOnFallback(read, { x: 2, y: 63, z: 0 }, 64), false, 'lava beside');
        assert.equal(W.mayDigOnFallback(read, { x: 5, y: 63, z: 0 }, 64), false, 'kelp (water) above');
        assert.equal(W.mayDigOnFallback(() => { throw new Error('unloaded'); }, { x: 1, y: 63, z: 1 }, 64), true, 'an unreadable neighbour is rock');
        assert.equal(W.mayDigOnFallback(read, null, 64), false);
    });

    test('noWayText, word for word', () => {
        assert.equal(W.noWayText({ x: 10, y: 64, z: -20 }, { x: 3.5, y: 64, z: -2.2 }, 19.4),
            'I found no way to (10, 64, -20) without digging; I stopped at (3, 64, -3), 19 blocks away.');
    });
});

// The fake bot on flat grass; `paths(movements, goal)` stages the answers of the path finder; `water`: cells of water.
function sceneBot({ paths, pos = { x: 0, y: 64, z: 0 }, water = [] } = {}) {
    const world = createBlockWorld().flatGround(63, 'grass_block', 'dirt');
    for (const [x, y, z] of water) world.set(x, y, z, 'water');
    return makeFakeBot({ world, pos, paths });
}
const success = (x, y, z) => ({ status: 'success', path: [move(x, y, z)] });
const noPath = () => ({ status: 'noPath', path: [] });
// the search without digging (canDig false) finds no path and offers its best node at x 20
const longWayPaths = (m, goal) => {
    if (goal?.constructor?.name === 'GoalNear' && goal.x === 20) return success(20, 64, 0); // the walk to the best node
    if (m.canDig === false) return { status: 'noPath', path: [move(5, 64, 0), move(10, 64, 0), move(20, 64, 0)] };
    return noPath(); // the two searches of a second
};

describe('P-19: goToGoal on the fake bot', () => {
    test('a way of 10 blocks and no path in a second: the fallback digs, with the dig rule on its movements', async () => {
        let searches = 0;
        const bot = sceneBot({ paths: (m, goal) => (searches++ < 2 ? noPath() : success(goal.x, goal.y, goal.z)), water: [[4, 62, 0]] });
        assert.equal(await skills.goToGoal(bot, new pf.goals.GoalNear(10, 64, 0, 1)), true);
        assert.match(bot.output, /Path not found, but attempting to navigate anyway using destructive movements\./);
        const m = bot.pathfinder.movements;
        assert.equal(m.canDig, true, 'the fallback digs');
        assert.equal(m.exclusionAreasBreak.length, 1, 'one break rule of the fallback');
        const rule = m.exclusionAreasBreak[0];
        assert.equal(rule({ position: new Vec3(2, 63, 0) }), 0, 'the block under the feet (the start level 64 minus 1)');
        assert.equal(rule({ position: new Vec3(2, 62, 0) }), 100, 'below the start level minus 1: never');
        assert.equal(rule({ position: new Vec3(4, 63, 0) }), 100, 'water below the block: never');
        assert.equal(rule({ position: new Vec3(2, 65, 0) }), 0, 'above: as the path finder likes');
    });

    test('a way of 40 blocks and no path: no fallback; the best node of a search without digging is walked, then the text', async () => {
        const bot = sceneBot({ paths: longWayPaths });
        assert.equal(await skills.goToGoal(bot, new pf.goals.GoalNear(40, 64, 0, 1)), false);
        assert.ok(!bot.output.includes('Path not found'), bot.output);
        assert.ok(!bot.output.includes('destructive'), bot.output);
        assert.equal(bot.output, 'I found no way to (40, 64, 0) without digging; I stopped at (20, 64, 0), 20 blocks away.\n');
        assert.equal(bot.pathfinder.movements.canDig, false, 'the walk digs nothing');
        assert.deepEqual(bot.calls.walked, [[{ x: 20, y: 64, z: 0 }]], 'one walk, to the best node');
        assert.deepEqual(bot.calls.dug, []);
    });

    test('the long way: a search without digging that finds a way after all walks it', async () => {
        const bot = sceneBot({ paths: (m, goal) => (m.canDig === false ? success(goal.x, goal.y, goal.z) : noPath()) });
        assert.equal(await skills.goToGoal(bot, new pf.goals.GoalNear(40, 64, 0, 1)), true);
        assert.equal(bot.output, '', 'no text: it arrived');
        assert.equal(bot.pathfinder.movements.canDig, false);
    });

    test('goToPosition on the long way: the text once, no second "I stopped at" line', async () => {
        const bot = sceneBot({ paths: longWayPaths });
        assert.equal(await skills.goToPosition(bot, 40, 64, 0, 2), false);
        assert.equal((bot.output.match(/I stopped at/g) ?? []).length, 1, bot.output);
        assert.ok(!bot.output.includes('blocks from the goal'), bot.output);
        assert.match(bot.output, /I found no way to \(40, 64, 0\) without digging; I stopped at \(20, 64, 0\), 20 blocks away\./);
    });

    test('a destructive path found in time: as before, no break rule', async () => {
        let searches = 0;
        const bot = sceneBot({ paths: (m, goal) => (searches++ === 0 ? noPath() : success(goal.x, goal.y, goal.z)) });
        assert.equal(await skills.goToGoal(bot, new pf.goals.GoalNear(40, 64, 0, 1)), true);
        assert.match(bot.output, /Found destructive path\./);
        assert.equal(bot.pathfinder.movements.exclusionAreasBreak.length, 0);
    });

    test('a goal without one cell (a composite): the fallback as before', async () => {
        let searches = 0;
        const bot = sceneBot({ paths: () => (searches++ < 2 ? noPath() : success(40, 64, 0)) });
        const goal = new pf.goals.GoalCompositeAny([new pf.goals.GoalNear(40, 64, 0, 1)]);
        await skills.goToGoal(bot, goal);
        assert.match(bot.output, /Path not found, but attempting to navigate anyway/);
    });

    test('the signatures stay', () => {
        assert.equal(skills.goToGoal.length, 2);
        assert.equal(skills.goToPosition.length, 4);
    });
});
