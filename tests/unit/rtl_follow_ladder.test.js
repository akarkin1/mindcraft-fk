// Spec v0.1.4.9 section 13, part L (engineer E3): the ladder step of followPlayer and goToPlayer in
// src/agent/library/skills.js, on the fake bot of the mining pack in real time (its physics moves on one tick per
// 50 ms). A short shaft: ladders facing south at (2, 53..59, -2), a closed oak trapdoor at (2, 60, -2), grass at
// y 60, a room at y 53. The bot stands on the grass beside the trapdoor, the player MartyByrde2 in the room at the
// foot of the ladder, 8 blocks below. The path search of the fake does not move the bot, as the real one stops
// above the ladder (F14). With routes_pack on: after 3 s without moving the bot goes down once (the path search
// stopped, the follow goal set again); the step runs whatever the settings are: a correction of the path search,
// no switch (decision of the owner and the tech lead on 2026-10-01).
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { REGISTRY, makeWorld, makeMiningBot, tick, v } from './mining_fake_bot.test.js';

register('../helpers/mcdata_hooks.js', import.meta.url);
const mcdata = await loadSrc('src/utils/mcdata.js');
mcdata.__setMcdataForTests(REGISTRY);
const agentSettings = await loadSrc('src/agent/settings.js');
const skills = await loadSrc('src/agent/library/skills.js');
const fileSettings = (await loadSrc('settings.js')).default;

const PLAYER = 'MartyByrde2';
const DOWN_TEXT = `I go down the ladder at (2, 60, -2) after ${PLAYER}.`;

function scene({ pos = [2.5, 61, -0.5], player = [2.5, 53, -0.5], low = 53 } = {}) {
    const world = makeWorld({ groundY: 60 });
    world.fill(0, low, -2, 4, low + 2, 2, 'air');
    world.fill(2, low + 3, -2, 2, 59, -2, 'air');
    world.fill(2, low, -2, 2, 59, -2, 'ladder', { facing: 'south' });
    world.set(2, 60, -2, 'oak_trapdoor', { facing: 'south', half: 'top', open: false });
    const solid = world.solid;
    world.solid = (x, y, z) => (world.nameAt(x, y, z).endsWith('_trapdoor') && world.propsAt(x, y, z).open === true ? false : solid(x, y, z));
    const bot = makeMiningBot({ world, pos });
    bot.output = '';
    bot.clicks = [];
    bot.goals = [];
    bot.progress = [];
    bot.activateBlock = async (block) => {
        const p = block.position;
        bot.clicks.push({ x: p.x, y: p.y, z: p.z, sneak: bot.controls.sneak });
        world.set(p.x, p.y, p.z, world.nameAt(p.x, p.y, p.z), { ...world.propsAt(p.x, p.y, p.z), open: world.propsAt(p.x, p.y, p.z).open !== true });
    };
    bot.modes = { exists: () => false, isOn: () => false, pause() {}, unpause() {}, noteProgress: (why) => bot.progress.push(why) };
    const setGoal = bot.pathfinder.setGoal.bind(bot.pathfinder);
    bot.pathfinder.setGoal = (goal, dynamic) => {
        bot.goals.push(goal === null || goal === undefined ? null : goal.constructor?.name ?? 'goal');
        return setGoal(goal, dynamic);
    };
    bot.pathfinder.isMoving = () => false;
    bot.pathfinder.getPathTo = () => ({ status: 'success', path: [] });
    bot.players = { [PLAYER]: { username: PLAYER, entity: { position: v(...player), height: 1.8, id: 7, type: 'player', username: PLAYER } } };
    bot.entities[7] = bot.players[PLAYER].entity;
    const timer = setInterval(() => tick(bot), 50);
    const feet = () => ({ x: Math.floor(bot.entity.position.x), y: Math.floor(bot.entity.position.y + 0.01), z: Math.floor(bot.entity.position.z) });
    return { world, bot, feet, stop: () => clearInterval(timer) };
}

// The path search of the fake for the goal of the follow (GoalFollow): `fn`; other goals (the walks of the
// ladder pass to a cell) as the fake does them.
function stubFollowGoto(bot, fn = async () => {}) {
    const goto = bot.pathfinder.goto.bind(bot.pathfinder);
    bot.pathfinder.goto = async (goal, ...rest) => (goal?.constructor?.name === 'GoalFollow' ? fn(goal) : goto(goal, ...rest));
}

async function until(check, ms) {
    const end = Date.now() + ms;
    while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
    return check();
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
    agentSettings.setSettings({});
});

describe('followPlayer with routes_pack on: the player below the ladder', () => {
    test('one pass down after 3 s: the path search is stopped, the bot slides down, the follow goal is set again', { timeout: 30000 }, async () => {
        agentSettings.setSettings({ routes_pack: true });
        const s = scene();
        try {
            const run = skills.followPlayer(s.bot, PLAYER, 4);
            const arrived = await until(() => s.feet().y === 53 && s.bot.goals.length >= 3, 20000);
            s.bot.interrupt_code = true;
            assert.equal(await run, true, 'the return value as before');
            assert.ok(arrived, `feet ${JSON.stringify(s.feet())}, goals ${JSON.stringify(s.bot.goals)}`);
            assert.deepEqual(s.bot.goals, ['GoalFollow', null, 'GoalFollow']);
            assert.deepEqual(s.bot.clicks, [{ x: 2, y: 60, z: -2, sneak: false }], 'the trapdoor opened with one click without sneak');
            assert.deepEqual(s.feet(), { x: 2, y: 53, z: -2 });
            assert.deepEqual(s.bot.output.trim().split('\n'), [`You are now actively following player ${PLAYER}.`, DOWN_TEXT]);
            assert.deepEqual(s.bot.progress, ['ladder']);
        } finally {
            s.bot.interrupt_code = true;
            s.stop();
        }
    });

    test('a pass that fails writes its text once, and at most 3 passes are tried in a minute', { timeout: 30000 }, async () => {
        agentSettings.setSettings({ routes_pack: true });
        const s = scene();
        s.bot.activateBlock = async (block) => { s.bot.clicks.push({ x: block.position.x, sneak: s.bot.controls.sneak }); }; // it stays closed
        try {
            const run = skills.followPlayer(s.bot, PLAYER, 4);
            await until(() => s.bot.goals.filter((g) => g === null).length >= 3, 25000);
            await new Promise((r) => setTimeout(r, 4000)); // a fourth pass would come now
            s.bot.interrupt_code = true;
            await run;
            const lines = s.bot.output.trim().split('\n');
            assert.equal(lines.filter((l) => l === DOWN_TEXT).length, 3, lines.join(' | '));
            assert.equal(lines.filter((l) => l === 'I could not go down the ladder at (2, 60, -2): the trapdoor did not open.').length, 1, lines.join(' | '));
            assert.equal(s.feet().y, 61, 'nothing else moved the bot');
        } finally {
            s.bot.interrupt_code = true;
            s.stop();
        }
    });
});

describe('no switch: the ladder step runs with routes_pack off and absent', () => {
    test('routes_pack off: the pass runs all the same (a correction, no switch)', { timeout: 30000 }, async () => {
        agentSettings.setSettings({ routes_pack: false });
        const s = scene();
        try {
            const run = skills.followPlayer(s.bot, PLAYER, 4);
            await until(() => s.bot.clicks.length > 0 && s.feet().y <= 53, 12000);
            s.bot.interrupt_code = true;
            assert.equal(await run, true);
            assert.ok(s.bot.goals.includes(null), s.bot.goals.join(','));
            assert.deepEqual(s.bot.clicks, [{ x: 2, y: 60, z: -2, sneak: false }]);
            assert.ok(s.bot.output.includes(DOWN_TEXT), s.bot.output);
        } finally {
            s.bot.interrupt_code = true;
            s.stop();
        }
    });

    test('routes_pack absent from the agent settings and false in settings.js: the pass runs all the same', { timeout: 30000 }, async () => {
        agentSettings.setSettings({});
        const saved = fileSettings.routes_pack;
        fileSettings.routes_pack = false;
        const s = scene();
        try {
            const run = skills.followPlayer(s.bot, PLAYER, 4);
            await until(() => s.bot.clicks.length > 0, 12000);
            s.bot.interrupt_code = true;
            await run;
            assert.ok(s.bot.goals.includes(null), s.bot.goals.join(','));
            assert.equal(s.bot.clicks.length, 1);
        } finally {
            s.bot.interrupt_code = true;
            s.stop();
            if (saved === undefined) delete fileSettings.routes_pack;
            else fileSettings.routes_pack = saved;
        }
    });
});

describe('goToPlayer with routes_pack on', () => {
    test('the player below: down the ladder first, then the path search as before', { timeout: 30000 }, async () => {
        agentSettings.setSettings({ routes_pack: true });
        const s = scene();
        let pathSearch = 0;
        stubFollowGoto(s.bot, async () => { pathSearch++; });
        try {
            await skills.goToPlayer(s.bot, PLAYER, 3);
            assert.deepEqual(s.feet(), { x: 2, y: 53, z: -2 });
            assert.deepEqual(s.bot.clicks, [{ x: 2, y: 60, z: -2, sneak: false }]);
            assert.ok(s.bot.output.startsWith(`${DOWN_TEXT}\n`), s.bot.output);
            assert.ok(s.bot.output.includes(`You have reached ${PLAYER}.`), s.bot.output);
            assert.ok(pathSearch >= 1, 'the path search ran after the pass');
        } finally {
            s.stop();
        }
    });

    test('routes_pack off: the pass runs all the same', { timeout: 30000 }, async () => {
        agentSettings.setSettings({ routes_pack: false });
        const s = scene();
        stubFollowGoto(s.bot);
        try {
            await skills.goToPlayer(s.bot, PLAYER, 3);
            assert.deepEqual(s.bot.clicks, [{ x: 2, y: 60, z: -2, sneak: false }]);
            assert.ok(s.bot.output.startsWith(`${DOWN_TEXT}\n`), s.bot.output);
        } finally {
            s.stop();
        }
    });
});

describe('the fixes of W75', () => {
    test('L2: up under the closed trapdoor with the player waiting beside it (nearer than the follow distance), bobbing between two cells', { timeout: 30000 }, async () => {
        agentSettings.setSettings({ routes_pack: true });
        const s = scene({ pos: [2.5, 58, -1.5], player: [2.5, 61, -0.5] }); // 3.2 blocks apart, follow distance 4
        let up = true;
        const bob = setInterval(() => { // the bot under the trapdoor goes up and down between y 58 and 59
            if (s.bot.goals.includes(null)) return;
            s.bot.entity.position.y = up ? 59.1 : 58.3;
            s.bot.entity.velocity.y = 0;
            up = !up;
        }, 120);
        try {
            const run = skills.followPlayer(s.bot, PLAYER, 4);
            const out = await until(() => s.feet().y >= 61 && s.bot.goals.length >= 3, 20000);
            s.bot.interrupt_code = true;
            await run;
            assert.ok(out, `feet ${JSON.stringify(s.feet())}, goals ${JSON.stringify(s.bot.goals)}, output ${s.bot.output}`);
            // one pass: the goal dropped (and dropped again by climbUp of the mining pack at its end), then set again
            const g = s.bot.goals;
            assert.ok(g[0] === 'GoalFollow' && g.at(-1) === 'GoalFollow' && g.slice(1, -1).length >= 1 && g.slice(1, -1).every((x) => x === null),
                `${JSON.stringify(g)} ${s.bot.output}`);
            assert.deepEqual(s.bot.clicks, [{ x: 2, y: 60, z: -2, sneak: false }]);
            assert.ok(s.bot.output.includes(`I climb up the ladder at (2, 60, -2) after ${PLAYER}.`), s.bot.output);
        } finally {
            clearInterval(bob);
            s.bot.interrupt_code = true;
            s.stop();
        }
    });

    test('L1: goToPlayer from inside the house, 3 blocks beside the column: down the ladder first, then "You have reached"', { timeout: 30000 }, async () => {
        agentSettings.setSettings({ routes_pack: true });
        const s = scene({ pos: [5.5, 61, -0.5] });
        stubFollowGoto(s.bot);
        try {
            await skills.goToPlayer(s.bot, PLAYER, 2);
            assert.deepEqual(s.feet(), { x: 2, y: 53, z: -2 });
            assert.deepEqual(s.bot.output.trim().split('\n').filter((l) => !l.startsWith('Found ')), [DOWN_TEXT, `You have reached ${PLAYER}.`]);
        } finally {
            s.stop();
        }
    });

    test('L1: the path search ends with the player still 8 below: the pass then, and the path search once more', { timeout: 30000 }, async () => {
        agentSettings.setSettings({ routes_pack: true });
        const s = scene({ pos: [12.5, 61, -0.5] }); // 10 blocks from the column: no pass before the path search
        let searches = 0;
        stubFollowGoto(s.bot, async () => {
            searches++;
            if (searches === 1) s.bot.entity.position = v(3.5, 61, -0.5); // it stops on the floor beside the trapdoor
        });
        try {
            await skills.goToPlayer(s.bot, PLAYER, 2);
            assert.equal(searches, 2);
            assert.deepEqual(s.feet(), { x: 2, y: 53, z: -2 });
            assert.deepEqual(s.bot.output.trim().split('\n').filter((l) => !l.startsWith('Found ')), [DOWN_TEXT, `You have reached ${PLAYER}.`]);
        } finally {
            s.stop();
        }
    });

    test('L1: not arrived: "I stopped at (x, y, z), N blocks from <name>." instead of "You have reached" (the player at the same height, no ladder step)', { timeout: 30000 }, async () => {
        agentSettings.setSettings({ routes_pack: false });
        const s = scene({ pos: [2.5, 61, -0.5], player: [10.5, 61, -0.5] });
        stubFollowGoto(s.bot);
        try {
            await skills.goToPlayer(s.bot, PLAYER, 2);
            assert.equal(s.bot.output.trim().split('\n').at(-1), `I stopped at (2, 61, -1), 8 blocks from ${PLAYER}.`);
            assert.ok(!s.bot.output.includes('You have reached'), s.bot.output);
        } finally {
            s.stop();
        }
    });
});

describe('goToPosition (L4 of the play test: "no idea about up and down")', () => {
    test('to a point 18 blocks below, from the house through the closed trapdoor: one pass, then the path search arrives', { timeout: 40000 }, async () => {
        agentSettings.setSettings({ routes_pack: true });
        const s = scene({ pos: [5.5, 61, -0.5], low: 41 });
        try {
            assert.equal(await skills.goToPosition(s.bot, 2, 41, 0, 1), true);
            const lines = s.bot.output.trim().split('\n');
            assert.equal(lines.filter((l) => l.startsWith('I go down the ladder')).length, 1, lines.join(' | '));
            assert.equal(lines[0], 'I go down the ladder at (2, 60, -2) to (2, 41, 0).');
            assert.equal(lines.at(-1), `You have reached ${`(${Math.floor(s.bot.entity.position.x)}, 41, ${Math.floor(s.bot.entity.position.z)})`}.`);
            assert.deepEqual(s.bot.clicks, [{ x: 2, y: 60, z: -2, sneak: false }]);
            assert.equal(s.feet().y, 41);
        } finally {
            s.stop();
        }
    });

    test('routes_pack off: the pass runs all the same', { timeout: 30000 }, async () => {
        agentSettings.setSettings({ routes_pack: false });
        const s = scene({ pos: [5.5, 61, -0.5], low: 41 });
        try {
            await skills.goToPosition(s.bot, 2, 41, 0, 1);
            assert.deepEqual(s.bot.clicks, [{ x: 2, y: 60, z: -2, sneak: false }]);
            assert.ok(s.bot.output.includes('I go down the ladder'), s.bot.output);
        } finally {
            s.stop();
        }
    });
});

describe('the console line of a stopped action (src/agent/agent.js)', () => {
    test('"Agent executed: !followPlayer and was stopped." instead of "and got: undefined"', async () => {
        const { readFileSync } = await import('node:fs');
        const source = readFileSync(new URL('../../src/agent/agent.js', import.meta.url), 'utf8');
        const lines = source.split(/\r?\n/).filter((l) => l.includes("'Agent executed:'"));
        assert.equal(lines.length, 1, lines.join('\n'));
        const args = (execute_res) => (execute_res === undefined ? ['Agent executed:', '!followPlayer', 'and was stopped.'] : ['Agent executed:', '!followPlayer', 'and got:', execute_res]);
        assert.ok(lines[0].includes("execute_res === undefined ? ['Agent executed:', command_name, 'and was stopped.'] : ['Agent executed:', command_name, 'and got:', execute_res]"), lines[0]);
        assert.equal(args(undefined).join(' '), 'Agent executed: !followPlayer and was stopped.');
        assert.equal(args('ok').join(' '), 'Agent executed: !followPlayer and got: ok');
    });
});
