// Spec v0.1.4.9 section 13, part L (engineer E3): the ladder step of followPlayer and goToPlayer in
// src/agent/library/skills.js, on the fake bot of the mining pack in real time (its physics moves on one tick per
// 50 ms). A short shaft: ladders facing south at (2, 53..59, -2), a closed oak trapdoor at (2, 60, -2), grass at
// y 60, a room at y 53. The bot stands on the grass beside the trapdoor, the player MartyByrde2 in the room at the
// foot of the ladder, 8 blocks below. The path search of the fake does not move the bot, as the real one stops
// above the ladder (F14). With routes_pack on: after 3 s without moving the bot goes down once (the path search
// stopped, the follow goal set again); with the switch off nothing changes.
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

function scene({ pos = [2.5, 61, -0.5], player = [2.5, 53, -0.5] } = {}) {
    const world = makeWorld({ groundY: 60 });
    world.fill(0, 53, -2, 4, 55, 2, 'air');
    world.fill(2, 56, -2, 2, 59, -2, 'air');
    world.fill(2, 53, -2, 2, 59, -2, 'ladder', { facing: 'south' });
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

describe('the switch off', () => {
    test('routes_pack off: no pass, no click, the follow as in v0.1.4.8', { timeout: 30000 }, async () => {
        agentSettings.setSettings({ routes_pack: false });
        const s = scene();
        try {
            const run = skills.followPlayer(s.bot, PLAYER, 4);
            await new Promise((r) => setTimeout(r, 4500));
            s.bot.interrupt_code = true;
            assert.equal(await run, true);
            assert.deepEqual(s.bot.goals, ['GoalFollow']);
            assert.deepEqual(s.bot.clicks, []);
            assert.equal(s.feet().y, 61);
            assert.equal(s.bot.output, `You are now actively following player ${PLAYER}.\n`);
        } finally {
            s.bot.interrupt_code = true;
            s.stop();
        }
    });

    test('routes_pack absent from the agent settings: the value of settings.js decides (here false)', { timeout: 30000 }, async () => {
        agentSettings.setSettings({});
        const saved = fileSettings.routes_pack;
        fileSettings.routes_pack = false;
        const s = scene();
        try {
            const run = skills.followPlayer(s.bot, PLAYER, 4);
            await new Promise((r) => setTimeout(r, 3800));
            s.bot.interrupt_code = true;
            await run;
            assert.deepEqual(s.bot.goals, ['GoalFollow']);
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
        s.bot.pathfinder.goto = async () => { pathSearch++; };
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

    test('the switch off: no pass', { timeout: 30000 }, async () => {
        agentSettings.setSettings({ routes_pack: false });
        const s = scene();
        s.bot.pathfinder.goto = async () => {};
        try {
            await skills.goToPlayer(s.bot, PLAYER, 3);
            assert.deepEqual(s.bot.clicks, []);
            assert.equal(s.feet().y, 61);
            assert.ok(!s.bot.output.includes('ladder'), s.bot.output);
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
