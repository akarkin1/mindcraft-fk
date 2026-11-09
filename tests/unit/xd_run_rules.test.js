// v0.1.4.14, the play of 2026-11-09 (DECISIONS P-29, SPEC 8.4.6): the bot sprinted its food away on long legs and starved.
//   1. No sprinting below 7 food points (the game's rule: a player with 6 or fewer cannot sprint): the movements of every
//      walk of the skills carry allowSprinting false.
//   2. A walk of more than 200 blocks with 10 food points or fewer is announced first, `A long way: N blocks with F food
//      points; I do not run.`, and walked without sprinting; the hold ends with the walk.
// The sprint rule is maySprint of the home pack's food_logic.js, the one home for the skills (runRule) and for the home
// pack's makeMovements (motion.js); the long-way rule is way_logic.js. The walks run on the fake bot of tests/helpers/xt_bot.js.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
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
let F;
let MO;
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
        F = await loadSrc('src/agent/packs/home/food_logic.js');
        MO = await loadSrc('src/agent/packs/home/motion.js');
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

function walkBot(food) {
    const world = createBlockWorld().flatGround(63, 'grass_block', 'dirt');
    const bot = makeFakeBot({ world, pos: { x: 0, y: 64, z: 0 }, paths: (m, goal) => ({ status: 'success', path: [move(goal.x, goal.y, goal.z)] }) });
    bot.food = food;
    return bot;
}
const LONG_WAY = 'A long way: 250 blocks with 8 food points; I do not run.';

describe('P-29: the rules (food_logic.js for the sprint, way_logic.js for the long way)', () => {
    test('maySprint: 7 yes, 6 no, unreadable yes', () => {
        assert.equal(F.SPRINT_MIN_FOOD, 7);
        assert.equal(F.maySprint(7), true);
        assert.equal(F.maySprint(6), false);
        assert.equal(F.maySprint(0), false);
        assert.equal(F.maySprint(20), true);
        assert.equal(F.maySprint(undefined), true);
        assert.equal(W.maySprint, undefined, 'one home: not in way_logic.js');
    });

    test('the home pack\'s makeMovements follows the rule: food 6 no sprint, 7 yes, sprint false stays false, no food level yes', () => {
        const bot = walkBot(6);
        assert.equal(MO.makeMovements(bot).allowSprinting, false);
        bot.food = 7;
        assert.equal(MO.makeMovements(bot).allowSprinting, true);
        assert.equal(MO.makeMovements(bot, { sprint: false }).allowSprinting, false);
        bot.food = 20;
        assert.equal(MO.makeMovements(bot, { dig: false, doors: false }).allowSprinting, true);
        bot.food = undefined;
        assert.equal(MO.makeMovements(bot).allowSprinting, true);
    });

    test('isLongWay: more than 200 blocks with 10 food points or fewer', () => {
        assert.equal(W.isLongWay(201, 10), true);
        assert.equal(W.isLongWay(200, 10), false);
        assert.equal(W.isLongWay(201, 11), false);
        assert.equal(W.isLongWay(450, 3), true);
        assert.equal(W.isLongWay(NaN, 3), false);
    });

    test('longWayText, word for word; the rules', () => {
        assert.equal(W.longWayText(249.6, 8), LONG_WAY);
        assert.deepEqual(W.LONG_WAY_RULES, { blocks: 200, food: 10 });
    });
});

describe('P-29: the walks of the fake bot', () => {
    test('250 blocks with 8 food points: the line first, the walk without sprint, the hold released after it', async () => {
        const bot = walkBot(8);
        assert.equal(await skills.goToPosition(bot, 250, 64, 0, 2), true);
        assert.ok(bot.output.startsWith(`${LONG_WAY}\n`), bot.output);
        assert.match(bot.output, /You have reached \(250, 64, 0\)\./);
        assert.equal(bot.pathfinder.movements.allowSprinting, false, 'the movements of the walk');
        bot.output = '';
        assert.equal(await skills.goToGoal(bot, new pf.goals.GoalNear(255, 64, 0, 1)), true);
        assert.equal(bot.pathfinder.movements.allowSprinting, true, 'a short walk with 8 food points sprints again');
        assert.ok(!bot.output.includes('A long way'), bot.output);
    });

    test('250 blocks with 12 food points: no line, the sprint allowed', async () => {
        const bot = walkBot(12);
        await skills.goToPosition(bot, 250, 64, 0, 2);
        assert.ok(!bot.output.includes('A long way'), bot.output);
        assert.equal(bot.pathfinder.movements.allowSprinting, true);
    });

    test('10 blocks with 5 food points: no line, no sprint (the game refuses it)', async () => {
        const bot = walkBot(5);
        await skills.goToPosition(bot, 10, 64, 0, 2);
        assert.ok(!bot.output.includes('A long way'), bot.output);
        assert.equal(bot.pathfinder.movements.allowSprinting, false);
    });

    test('200 blocks exactly with 8 food points: no line (more than 200 is long)', async () => {
        const bot = walkBot(8);
        await skills.goToPosition(bot, 200, 64, 0, 2);
        assert.ok(!bot.output.includes('A long way'), bot.output);
    });

    test('goToGoal with 20 food points: as before', async () => {
        const bot = walkBot(20);
        await skills.goToGoal(bot, new pf.goals.GoalNear(20, 64, 0, 1));
        assert.equal(bot.pathfinder.movements.allowSprinting, true);
        assert.match(bot.output, /Found non-destructive path\./);
    });
});
