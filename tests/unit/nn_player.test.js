// Spec v0.1.4.11, part N (engineer E4), N2: goToPlayer and followPlayer never dig toward the player and never use the
// destructive fallback of goToGoal. When the path search proves that no walk without digging reaches the player they
// say `I find no way to you from here without digging. Come closer or tell me to dig.` and stop (false). A walk that
// enters a cave stops once and says so. On the fake bot of the mining pack with a fake path search.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { REGISTRY, give, makeWorld, makeMiningBot, tick, v } from './mining_fake_bot.test.js';

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

describe('F5: the way up the descent into the room, through the closed double door', () => {
    // the room at y 41 (x 0..4, z -2..2) closed to the east by a wall at x 4 with a double oak door at (4, 41, -1) and
    // (4, 41, 0), facing west; a descent of 1 block down and 1 east per step from x 5 (feet 40) to x 8 (feet 37), cut 3
    // high; the bot on the landing at x 10, the player in the room. The path search of the fake: no path at all while
    // both doors are closed (a jump up into a closed door has no move), its best node the first step; with a door open
    // the whole way.
    function descent() {
        const world = makeWorld();
        world.fill(0, 41, -2, 4, 43, 2, 'air');
        world.fill(4, 41, -2, 4, 43, 2, 'stone');
        for (const z of [-1, 0]) {
            world.set(4, 41, z, 'oak_door', { facing: 'west', half: 'lower', hinge: z === 0 ? 'left' : 'right', open: false, powered: false });
            world.set(4, 42, z, 'oak_door', { facing: 'west', half: 'upper', hinge: z === 0 ? 'left' : 'right', open: false, powered: false });
        }
        for (let k = 1; k <= 4; k++) world.fill(4 + k, 41 - k, 0, 4 + k, 43 - k, 0, 'air');
        world.fill(9, 37, -1, 11, 39, 1, 'air');
        const bot = scene({ world, pos: [10.5, 37, 0.5], player: [1.5, 41, 0.5] });
        bot.activateBlock = async (block) => {
            const p = block.position;
            bot.calls.push(['activate', p.x, p.y, p.z]);
            for (const y of [p.y, p.y + 1]) {
                if (world.nameAt(p.x, y, p.z) === 'oak_door') world.set(p.x, y, p.z, 'oak_door', { ...world.propsAt(p.x, y, p.z), open: world.propsAt(p.x, y, p.z).open !== true });
            }
        };
        bot.findBlocks = ({ matching, maxDistance = 16, point }) => {
            const c = point ?? bot.entity.position;
            const out = [];
            const r = Math.ceil(maxDistance);
            for (let x = Math.floor(c.x) - r; x <= Math.floor(c.x) + r; x++)
                for (let y = Math.floor(c.y) - r; y <= Math.floor(c.y) + r; y++)
                    for (let z = Math.floor(c.z) - r; z <= Math.floor(c.z) + r; z++)
                        if (matching(world.block(x, y, z)) && Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y, z + 0.5 - c.z) <= maxDistance) out.push(v(x, y, z));
            return out;
        };
        const open = () => world.propsAt(4, 41, 0).open === true || world.propsAt(4, 41, -1).open === true;
        bot.pathfinder.getPathFromTo = function* (movements, start, goal) {
            bot.searches.push({ canDig: movements.canDig, goal: goal?.constructor?.name, open: open() });
            yield { result: { status: 'partial', path: [] } };
            yield { result: open() ? { status: 'success', path: [] } : { status: 'noPath', path: [{ x: 9, y: 37, z: 0 }, { x: 5, y: 40, z: 0 }] } };
        };
        bot.pathfinder.goto = async (goal) => {
            bot.gotos.push([goal.x, goal.y, goal.z, goal.constructor?.name ?? goal.inner?.constructor?.name]);
            if (goal.entity) bot.entity.position = v(2.5, 41, 0.5);
            else bot.entity.position = v(goal.x + 0.5, goal.y, goal.z + 0.5);
        };
        return { world, bot };
    }

    test('"come here" from the landing: up the steps to the last one, the door toward the player opened, then the way to him', async () => {
        const { world, bot } = descent();
        await skills.goToPlayer(bot, PLAYER, 2);
        assert.ok(!bot.output.includes(NO_WAY), bot.output);
        assert.ok(bot.output.trim().endsWith(`You have reached ${PLAYER}.`), bot.output);
        assert.deepEqual(bot.gotos[0].slice(0, 3), [5, 40, 0], 'first to the nearest cell the search reaches, the last step');
        assert.ok(bot.calls.some(c => c[0] === 'activate' && c[1] === 4 && c[2] === 41), 'a door of the double door clicked');
        assert.ok(world.propsAt(4, 41, 0).open === true || world.propsAt(4, 41, -1).open === true, 'a door is open');
        assert.deepEqual(bot.searches.map(q => q.open), [false, true], 'searched again after the door opened');
        assert.ok(bot.searches.every(q => q.canDig === false));
        assert.equal(bot.calls.filter(c => c[0] === 'dig').length, 0);
        assert.ok(!bot.output.includes('using destructive movements'));
    });

    test('followPlayer from the landing: the same, then it follows', async () => {
        const { bot } = descent();
        setTimeout(() => { bot.interrupt_code = true; }, 700);
        const r = await skills.followPlayer(bot, PLAYER, 2);
        assert.equal(r, true);
        assert.ok(bot.output.startsWith(`You are now actively following player ${PLAYER}.`), bot.output);
        assert.ok(bot.calls.some(c => c[0] === 'activate'));
    });

    test('a door that does not open: the text, nothing dug', async () => {
        const { bot } = descent();
        bot.activateBlock = async (block) => { bot.calls.push(['activate', block.position.x, block.position.y, block.position.z]); };
        const r = await skills.goToPlayer(bot, PLAYER, 2);
        assert.equal(r, false);
        assert.ok(bot.output.endsWith(`${NO_WAY}\n`), bot.output);
        assert.equal(bot.searches.length, 1, 'each door is tried once, then no search is left to try');
        assert.equal(bot.calls.filter(c => c[0] === 'dig').length, 0);
    });
});

describe('F9: a column whose lowest rung is 2 blocks above the floor of the room', () => {
    // the room at y 41 (floor y 40), ladders facing south at (2, 43..59, -2) under a closed oak trapdoor at (2, 60, -2) in
    // the grass; the player on the grass beside it. The path search of the fake finds no way at all while the bot is
    // under the ground (it cannot get onto the column), the whole way once it is up.
    function column({ ladders = 4 } = {}) {
        const world = makeWorld({ groundY: 60 });
        world.fill(0, 41, -2, 4, 43, 2, 'air');
        world.fill(2, 44, -2, 2, 59, -2, 'air');
        world.fill(2, 43, -2, 2, 59, -2, 'ladder', { facing: 'south' });
        world.set(2, 60, -2, 'oak_trapdoor', { facing: 'south', half: 'top', open: false });
        const solid = world.solid;
        world.solid = (x, y, z) => (world.nameAt(x, y, z).endsWith('_trapdoor') && world.propsAt(x, y, z).open === true ? false : solid(x, y, z));
        const bot = scene({ world, pos: [2.5, 41, 0.5], player: [3.5, 61, -0.5] });
        if (ladders > 0) give(bot, 'ladder', ladders);
        bot.activateBlock = async (block) => {
            const p = block.position;
            world.set(p.x, p.y, p.z, world.nameAt(p.x, p.y, p.z), { ...world.propsAt(p.x, p.y, p.z), open: world.propsAt(p.x, p.y, p.z).open !== true });
        };
        bot.pathfinder.getPathFromTo = function* (movements, start, goal) {
            bot.searches.push({ canDig: movements.canDig, y: start.y });
            yield { result: { status: start.y >= 60 ? 'success' : 'noPath', path: [] } };
        };
        const goto = bot.pathfinder.goto.bind(bot.pathfinder);
        bot.pathfinder.goto = async (goal) => {
            if (goal?.entity || goal?.inner?.entity) {
                bot.entity.position = v(3.5, 61, 0.5);
                return;
            }
            return goto(goal);
        };
        const timer = setInterval(() => tick(bot), 50);
        return { world, bot, stop: () => clearInterval(timer) };
    }

    test('the bot with 4 ladders: places the missing ladder, climbs, reaches the player, no text of no way', { timeout: 60000 }, async () => {
        const { world, bot, stop } = column();
        try {
            await skills.goToPlayer(bot, PLAYER, 2);
        } finally {
            stop();
        }
        assert.ok(!bot.output.includes(NO_WAY), bot.output);
        assert.ok(bot.output.includes(`I climb up the ladder at`), bot.output);
        assert.equal(world.nameAt(2, 42, -2), 'ladder', 'the missing ladder placed');
        assert.ok(bot.output.trim().endsWith(`You have reached ${PLAYER}.`), bot.output);
        assert.equal(bot.calls.filter(c => c[0] === 'dig').length, 0);
    });

    test('without ladders: the pass fails, then the text of no way', { timeout: 60000 }, async () => {
        const { bot, stop } = column({ ladders: 0 });
        let r;
        try {
            r = await skills.goToPlayer(bot, PLAYER, 2);
        } finally {
            stop();
        }
        assert.equal(r, false);
        assert.ok(bot.output.endsWith(`${NO_WAY}\n`), bot.output);
        assert.equal(bot.calls.filter(c => c[0] === 'dig').length, 0);
    });
});

describe('F15: the time of the search is no time stuck, and at most 20 s of search per order', () => {
    test('while the search thinks: bot.searching, and the mode unstuck does not count that time', async () => {
        const bot = scene({ status: 'success' });
        let during = null;
        bot.pathfinder.getPathFromTo = function* () {
            const t0 = Date.now();
            while (Date.now() - t0 < 1300) {
                during = bot.searching;
                yield { result: { status: 'partial', path: [] } };
            }
            yield { result: { status: 'noPath', path: [] } };
        };
        const r = await skills.goToPlayer(bot, PLAYER, 3);
        assert.equal(r, false);
        assert.equal(during, true);
        assert.equal(bot.searching, false);
    });

    test('stuckStep: a sample with searching starts the stuck time again, without it the time runs', async () => {
        const S = await loadSrc('src/agent/reflex/stuck_logic.js');
        const pos = { x: 0, y: 64, z: 0 };
        let st = S.stuckStep(S.newStuckState(), { pos }, 0).state;
        const late = S.STUCK_RULES.limitMs + 1000;
        assert.equal(S.stuckStep(st, { pos, searching: true }, late).stuck, false);
        assert.equal(S.stuckStep(st, { pos, searching: true }, late).reason, 'searching');
        assert.equal(S.stuckStep(st, { pos }, late).stuck, true);
    });

    test('a long way the search never finds whole: the text of no way after 20 s of search, not later', { timeout: 40000 }, async () => {
        const bot = scene({ pos: [0.5, 64, 0.5], player: [200.5, 64, 0.5] });
        const timeouts = [];
        bot.pathfinder.getPathFromTo = function* (movements, start, goal, options) {
            timeouts.push(options.timeout);
            const t0 = Date.now();
            while (Date.now() - t0 < options.timeout) yield { result: { status: 'partial', path: [] } };
            yield { result: { status: 'timeout', path: [{ x: Math.floor(start.x) + 10, y: 64, z: 0 }] } };
        };
        bot.pathfinder.goto = async (goal) => { bot.entity.position = v(goal.x + 0.5, 64, 0.5); };
        const t0 = Date.now();
        const r = await skills.goToPlayer(bot, PLAYER, 3);
        const spent = Date.now() - t0;
        assert.equal(r, false);
        assert.ok(bot.output.endsWith(`${NO_WAY}\n`), bot.output);
        assert.ok(spent >= 19000 && spent <= 23000, `${spent} ms`);
        assert.ok(timeouts.every(t => t <= 10000));
    });
});

describe('F20 (W88): a follow that hangs in the open trapdoor under the player climbs out', () => {
    // the house floor at y 60, an open oak trapdoor at (2, 60, -2) over ladders facing south; the bot hangs in it
    function hanging({ pos, player }) {
        const world = makeWorld({ groundY: 60 });
        world.fill(2, 53, -2, 2, 59, -2, 'ladder', { facing: 'south' });
        world.set(2, 60, -2, 'oak_trapdoor', { facing: 'south', half: 'top', open: true });
        const bot = scene({ world, pos, player, status: 'success' });
        bot.entity.onGround = false;
        const goals = [];
        const setGoal = bot.pathfinder.setGoal.bind(bot.pathfinder);
        bot.pathfinder.setGoal = (goal, dynamic) => {
            goals.push(goal?.constructor?.name ?? null);
            return setGoal(goal, dynamic);
        };
        const walks = [];
        bot.pathfinder.goto = async (goal) => {
            walks.push([goal.x, goal.y, goal.z, goal.constructor?.name]);
            bot.entity.position = v(goal.x + 0.5, goal.y, goal.z + 0.5);
            bot.entity.onGround = true;
        };
        return { bot, goals, walks };
    }

    test('the follow goal met while hanging: after 1 s it walks out to the free cell toward the player, then follows again', { timeout: 20000 }, async () => {
        const { bot, goals, walks } = hanging({ pos: [2.5, 60.7, -1.5], player: [4.5, 61, -1.5] });
        setTimeout(() => { bot.interrupt_code = true; }, 3000);
        await skills.followPlayer(bot, PLAYER, 4);
        assert.deepEqual(walks, [[3, 61, -2, 'GoalBlock']], 'beside the top of the column, toward the player');
        assert.equal(Math.floor(bot.entity.position.y), 61);
        // F22: the follow is stopped for the walk out and set again after it
        assert.equal(goals[0], 'GoalFollow');
        assert.equal(goals[goals.length - 1], 'GoalFollow');
        assert.ok(goals.includes(null));
    });

    test('F22: wedged against the side toward the player: out to another side, never that one', { timeout: 20000 }, async () => {
        // the middle of the bot 0.21 south of the middle of the cell (pressed into the floor edge toward the player)
        const { bot, walks } = hanging({ pos: [2.5, 60.72, -1.29], player: [2.5, 61, 1.5] });
        setTimeout(() => { bot.interrupt_code = true; }, 3000);
        await skills.followPlayer(bot, PLAYER, 4);
        assert.equal(walks.length, 1);
        assert.notDeepEqual(walks[0].slice(0, 3), [2, 61, -1], 'not the side it is wedged against');
        assert.equal(walks[0][1], 61);
        assert.equal(Math.floor(bot.entity.position.y), 61);
    });
});

describe('F21 (W84, D): a search that runs out of time with no progress is no proof that there is no way', () => {
    // the house floor at y 60 (grass), a closed oak trapdoor at (2, 60, -2) over ladders facing south at (2, 43..59, -2)
    // whose lowest rung is 2 blocks above the floor of the room (y 41, floor y 40); the bot stands on the trapdoor, the
    // player in the room 20 blocks below. The path search of the fake runs out of time with no node nearer to the player
    // while the bot is up (its best node is where the bot stands), and finds the whole way once the bot is down.
    function trapdoorUnder({ ladders = 4, open = () => true } = {}) {
        const world = makeWorld({ groundY: 60 });
        world.fill(0, 41, -2, 4, 43, 2, 'air');
        world.fill(2, 44, -2, 2, 59, -2, 'air');
        world.fill(2, 43, -2, 2, 59, -2, 'ladder', { facing: 'south' });
        world.set(2, 60, -2, 'oak_trapdoor', { facing: 'south', half: 'top', open: false });
        const solid = world.solid;
        world.solid = (x, y, z) => (world.nameAt(x, y, z).endsWith('_trapdoor') && world.propsAt(x, y, z).open === true ? false : solid(x, y, z));
        const bot = scene({ world, pos: [2.5, 61, -1.5], player: [2.5, 41, 0.5] });
        if (ladders > 0) give(bot, 'ladder', ladders);
        bot.activateBlock = async (block) => {
            const p = block.position;
            bot.calls.push(['activate', p.x, p.y, p.z]);
            if (open())
                world.set(p.x, p.y, p.z, world.nameAt(p.x, p.y, p.z), { ...world.propsAt(p.x, p.y, p.z), open: world.propsAt(p.x, p.y, p.z).open !== true });
        };
        bot.findBlocks = ({ matching, maxDistance = 16, point }) => {
            const c = point ?? bot.entity.position;
            const out = [];
            const r = Math.ceil(maxDistance);
            for (let x = Math.floor(c.x) - r; x <= Math.floor(c.x) + r; x++)
                for (let y = Math.floor(c.y) - r; y <= Math.floor(c.y) + r; y++)
                    for (let z = Math.floor(c.z) - r; z <= Math.floor(c.z) + r; z++)
                        if (matching(world.block(x, y, z)) && Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y, z + 0.5 - c.z) <= maxDistance) out.push(v(x, y, z));
            return out;
        };
        bot.pathfinder.getPathFromTo = function* (movements, start, goal) {
            bot.searches.push({ canDig: movements.canDig, y: start.y });
            yield { result: { status: 'partial', path: [] } };
            yield { result: start.y < 50 ? { status: 'success', path: [] } : { status: 'timeout', path: [{ x: 2, y: 61, z: -2 }] } };
        };
        const goto = bot.pathfinder.goto.bind(bot.pathfinder);
        bot.pathfinder.goto = async (goal) => {
            if (goal?.entity || goal?.inner?.entity) {
                bot.entity.position = v(2.5, 41, -0.5);
                return;
            }
            return goto(goal);
        };
        const timer = setInterval(() => tick(bot), 50);
        return { world, bot, stop: () => clearInterval(timer) };
    }

    test('the trapdoor under the bot opened from above, down the column, the search again: it arrives, no text', { timeout: 60000 }, async () => {
        const { bot, stop } = trapdoorUnder();
        try {
            await skills.goToPlayer(bot, PLAYER, 3);
        } finally {
            stop();
        }
        assert.ok(!bot.output.includes(NO_WAY), bot.output);
        assert.ok(bot.calls.some(c => c[0] === 'activate' && c[1] === 2 && c[2] === 60 && c[3] === -2), 'the trapdoor clicked');
        assert.ok(bot.searches.length >= 2 && bot.searches[bot.searches.length - 1].y < 50, 'searched again from below');
        assert.ok(bot.searches.every(q => q.canDig === false));
        assert.ok(bot.output.trim().endsWith(`You have reached ${PLAYER}.`), bot.output);
        assert.equal(bot.calls.filter(c => c[0] === 'dig').length, 0);
    });

    test('nothing to open and no column: one search more, then the text', async () => {
        const bot = scene({ status: 'timeout' });
        bot.pathfinder.goto = async (goal) => { bot.gotos.push(goal); };
        const r = await skills.goToPlayer(bot, PLAYER, 3);
        assert.equal(r, false);
        assert.equal(bot.output, `${NO_WAY}\n`);
        assert.equal(bot.searches.length, 2, 'a search that ran out of time is asked once more');
        assert.deepEqual(bot.gotos, []);
    });
});
