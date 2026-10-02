// Spec v0.1.4.11, part N (engineer E4), N2: goToPlayer and followPlayer never dig toward the player and never use the
// destructive fallback of goToGoal. When the path search proves that no walk without digging reaches the player they
// say `I find no way to you from here without digging. Come closer or tell me to dig.` and stop (false). A walk that
// enters a cave stops once and says so. On the fake bot of the mining pack with a fake path search.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { REGISTRY, makeWorld, makeMiningBot, v } from './mining_fake_bot.test.js';

register('../helpers/mcdata_hooks.js', import.meta.url);
const mcdata = await loadSrc('src/utils/mcdata.js');
mcdata.__setMcdataForTests(REGISTRY);
const skills = await loadSrc('src/agent/library/skills.js');

const PLAYER = 'MartyByrde2';
const NO_WAY = 'I find no way to you from here without digging. Come closer or tell me to dig.';

function scene({ world = makeWorld(), pos = [0.5, 64, 0.5], player = [3.5, 64, 0.5], status = 'noPath' } = {}) {
    const bot = makeMiningBot({ world, pos });
    bot.output = '';
    bot.modes = { exists: () => false, isOn: () => false, pause() {}, unpause() {}, noteProgress() {} };
    bot.players = { [PLAYER]: { username: PLAYER, entity: { position: v(...player), height: 1.8, id: 7, type: 'player', username: PLAYER } } };
    bot.entities[7] = bot.players[PLAYER].entity;
    bot.searches = [];
    bot.pathfinder.getPathFromTo = function* (movements, start, goal, options) {
        bot.searches.push({ canDig: movements.canDig, radius: options?.searchRadius, goal: goal?.constructor?.name });
        yield { result: { status: 'partial', path: [] } };
        yield { result: { status: typeof status === 'function' ? status() : status, path: [] } };
    };
    bot.gotos = [];
    bot.movementsSet = [];
    const setMovements = bot.pathfinder.setMovements.bind(bot.pathfinder);
    bot.pathfinder.setMovements = (m) => { bot.movementsSet.push(m.canDig); return setMovements(m); };
    return bot;
}

let quiet;
beforeEach(() => {
    quiet = { log: console.log, warn: console.warn };
    console.log = () => {};
    console.warn = () => {};
});
afterEach(() => {
    console.log = quiet.log;
    console.warn = quiet.warn;
});

describe('goToPlayer without a way (N2)', () => {
    test('the player in a sealed box: the text, false, no walk, no destructive line', async () => {
        const bot = scene();
        bot.pathfinder.goto = async (goal) => { bot.gotos.push(goal); };
        const r = await skills.goToPlayer(bot, PLAYER, 3);
        assert.equal(r, false);
        assert.equal(bot.output, `${NO_WAY}\n`);
        assert.ok(!bot.output.includes('using destructive movements'));
        assert.deepEqual(bot.gotos, [], 'the bot does not move');
        assert.equal(bot.searches.length, 1);
        assert.equal(bot.searches[0].canDig, false, 'the search without digging');
        assert.equal(bot.searches[0].goal, 'GoalFollow');
        assert.equal(bot.searches[0].radius, -1, 'no limit on the length of the way (T3-1)');
        assert.equal(bot.calls.filter(c => c[0] === 'dig').length, 0);
    });

    test('a search that runs out of time with no node nearer to the player: the text, never the fallback', async () => {
        const bot = scene({ status: 'timeout' });
        bot.pathfinder.goto = async (goal) => { bot.gotos.push(goal); };
        const r = await skills.goToPlayer(bot, PLAYER, 3);
        assert.equal(r, false);
        assert.equal(bot.output, `${NO_WAY}\n`);
        assert.deepEqual(bot.gotos, []);
    });

    test('the walk itself finds no way: the text, never the fallback', async () => {
        const bot = scene({ status: 'success' });
        bot.pathfinder.goto = async () => {
            const err = new Error('No path to the goal!');
            err.name = 'NoPath';
            throw err;
        };
        const r = await skills.goToPlayer(bot, PLAYER, 3);
        assert.equal(r, false);
        assert.ok(bot.output.endsWith(`${NO_WAY}\n`), bot.output);
        assert.ok(!bot.output.includes('using destructive movements'), bot.output);
        assert.ok(bot.movementsSet.length > 0 && bot.movementsSet.every(d => d === false), 'every walk without digging');
    });

    test('a way without digging: the walk without digging, reached', async () => {
        const bot = scene({ status: 'success' });
        bot.pathfinder.goto = async () => { bot.entity.position = v(2.5, 64, 0.5); };
        await skills.goToPlayer(bot, PLAYER, 3);
        assert.deepEqual(bot.output.trim().split('\n'), ['Found non-destructive path.', `You have reached ${PLAYER}.`]);
        assert.deepEqual(bot.movementsSet, [false]);
    });
});

describe('a long way (T3-1): partial paths while they bring the bot nearer', () => {
    // the search runs out of time twice with a partial path to its best node, the third time it finds the whole way;
    // the player 60 blocks away along the x axis
    function longWay(statuses) {
        const bot = scene({ pos: [0.5, 64, 0.5], player: [60.5, 64, 0.5] });
        const rounds = [];
        bot.pathfinder.getPathFromTo = function* (movements, start, goal, options) {
            rounds.push({ from: Math.floor(start.x), timeout: options?.timeout, radius: options?.searchRadius, canDig: movements.canDig });
            const status = statuses[rounds.length - 1] ?? 'success';
            const x = Math.floor(start.x) + 20;
            yield { result: { status: 'partial', path: [] } };
            yield { result: { status, path: status === 'timeout' ? [{ x: x - 10, y: 64, z: 0 }, { x, y: 64, z: 0 }] : [] } };
        };
        bot.pathfinder.goto = async (goal) => {
            bot.gotos.push([goal.x, goal.y, goal.z]);
            const x = goal.x ?? 59;
            bot.entity.position = v(x + 0.5, 64, 0.5);
        };
        return { bot, rounds };
    }

    test('two partial paths, then the whole way: the bot walks them and reaches the player', async () => {
        const { bot, rounds } = longWay(['timeout', 'timeout', 'success']);
        await skills.goToPlayer(bot, PLAYER, 3);
        assert.equal(rounds.length, 3);
        assert.deepEqual(rounds.map(r => r.from), [0, 20, 40], 'each search from where the partial walk ended');
        assert.ok(rounds.every(r => r.timeout >= 10000), 'at least 10 s of think time');
        assert.ok(rounds.every(r => r.radius === -1), 'no limit on the length of the way');
        assert.ok(rounds.every(r => r.canDig === false));
        assert.deepEqual(bot.gotos.slice(0, 2), [[20, 64, 0], [40, 64, 0]], 'the ends of the partial paths');
        assert.ok(!bot.output.includes(NO_WAY), bot.output);
        assert.ok(bot.output.trim().endsWith(`You have reached ${PLAYER}.`), bot.output);
        assert.ok(!bot.output.includes('using destructive movements'));
    });

    test('a partial walk that brings the bot no nearer: the text and stop', async () => {
        const { bot } = longWay(['timeout', 'timeout']);
        bot.pathfinder.goto = async (goal) => { bot.gotos.push([goal.x, goal.y, goal.z]); }; // the bot stays
        const r = await skills.goToPlayer(bot, PLAYER, 3);
        assert.equal(r, false);
        assert.equal(bot.output, `${NO_WAY}\n`);
        assert.equal(bot.gotos.length, 1);
    });

    test('followPlayer: the partial paths first, then the follow', async () => {
        const { bot, rounds } = longWay(['timeout', 'success']);
        setTimeout(() => { bot.interrupt_code = true; }, 700);
        const r = await skills.followPlayer(bot, PLAYER, 4);
        assert.equal(r, true);
        assert.equal(rounds.length, 2);
        assert.ok(bot.output.startsWith(`You are now actively following player ${PLAYER}.`), bot.output);
    });
});

describe('followPlayer without a way (N2)', () => {
    test('the text and false before following', async () => {
        const bot = scene();
        const r = await skills.followPlayer(bot, PLAYER, 4);
        assert.equal(r, false);
        assert.equal(bot.output, `${NO_WAY}\n`);
        assert.equal(bot.pathfinder.goal, null, 'no follow goal was set');
    });

    test('a way: it follows without digging', async () => {
        const bot = scene({ status: 'success' });
        setTimeout(() => { bot.interrupt_code = true; }, 700);
        const r = await skills.followPlayer(bot, PLAYER, 4);
        assert.equal(r, true, 'the return value as before');
        assert.ok(bot.output.startsWith(`You are now actively following player ${PLAYER}.`), bot.output);
        assert.equal(bot.pathfinder.movements.canDig, false);
    });
});

describe('the cave (N2)', () => {
    // a cave 9 x 5 x 9 of air in the stone at y 40 to 44 (floor y 39), a 1-wide tunnel of 2 high into it from the west
    function caveWorld() {
        const world = makeWorld();
        world.fill(0, 40, 0, 8, 44, 8, 'air');
        world.fill(-6, 40, 4, -1, 41, 4, 'air');
        return world;
    }

    function walkInto(bot, cell) {
        bot.pathfinder.goto = () => new Promise((resolve, reject) => {
            bot.entity.position = v(cell[0] + 0.5, cell[1], cell[2] + 0.5);
            const set = bot.pathfinder.setGoal.bind(bot.pathfinder);
            const timer = setTimeout(resolve, 1500);
            bot.pathfinder.setGoal = (goal) => {
                set(goal);
                if (goal === null) {
                    clearTimeout(timer);
                    const err = new Error('The goal was changed before it could be completed!');
                    err.name = 'GoalChanged';
                    reject(err);
                }
            };
        });
    }

    test('the bot walks into a cave toward the player on the surface: it stops once and says so; told to go on, it walks on', { timeout: 20000 }, async () => {
        const bot = scene({ world: caveWorld(), pos: [-5.5, 40, 4.5], player: [20.5, 64, 4.5], status: 'success' });
        walkInto(bot, [4, 40, 4]);
        const r = await skills.goToPlayer(bot, PLAYER, 3);
        assert.equal(r, false);
        assert.ok(bot.output.includes('I stopped at (4, 40, 4): ahead is a cave. Tell me to go on if you want.\n'), bot.output);
        // "go on": the same walk again from the tunnel passes the cave
        bot.output = '';
        bot.entity.position = v(-5.5, 40, 4.5);
        walkInto(bot, [4, 40, 4]);
        await skills.goToPlayer(bot, PLAYER, 3);
        assert.ok(!bot.output.includes('ahead is a cave'), bot.output);
    });

    test('no stop when the player is in the cave too, or when the bot placed a block near', { timeout: 20000 }, async () => {
        const inside = scene({ world: caveWorld(), pos: [-5.5, 40, 4.5], player: [7.5, 40, 7.5], status: 'success' });
        walkInto(inside, [4, 40, 4]);
        await skills.goToPlayer(inside, PLAYER, 3);
        assert.ok(!inside.output.includes('ahead is a cave'), inside.output);

        const placed = scene({ world: caveWorld(), pos: [-5.5, 40, 4.5], player: [20.5, 64, 4.5], status: 'success' });
        placed.areaGuard = { placedByBot: p => p.x === 2 && p.y === 39 && p.z === 2, areaAt: () => null };
        walkInto(placed, [4, 40, 4]);
        await skills.goToPlayer(placed, PLAYER, 3);
        assert.ok(!placed.output.includes('ahead is a cave'), placed.output);
    });
});
