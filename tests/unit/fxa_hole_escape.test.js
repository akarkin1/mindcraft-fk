// Fix round of v0.1.4.8, X1 (the escape part): the last step of the escape in the real mode unstuck of
// src/agent/modes.js, with the real ActionManager and the real skills.js on the fake bot of
// tests/helpers/st_modes_env.js. The path finder finds no way (as in the composter of w60); a fake of the
// physics moves the bot when the controls forward and jump are set while it looks to a side that the test
// lets through.
//   - stuck_restart_after 3: the bot inside a composter jumps out: "I'm free.", no line of giving up;
//   - the sides are tried in the order north, east, south, west, one after the other, and a side with lava
//     in its column is never tried;
//   - nothing gets the bot out: the reflex gives up as before, the controls are released;
//   - a stop during the last step is no failure;
//   - stuck_restart_after 1 (the default, v0.1.4.7): no last step; the closed room of w31: no last step.
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { loadModes, makeFakeBot, makeFakeAgent, freshPos, noPath, hang } from '../helpers/st_modes_env.js';

const M = await loadModes();
await import('ses'); // the global assert of the agent process, for resume actions

const LIMIT = { timeout: 30000 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const realNow = Date.now;
let offset = 0;

let cap;
before(() => { Date.now = () => realNow() + offset; });
after(() => { Date.now = realNow; });
beforeEach(() => {
    cap = captureConsole();
    offset += 10 * 60 * 1000;
});
afterEach(() => {
    cap.restore();
});

const setSettings = (extra = {}) => M.settingsModule.setSettings({ language: 'en', narrate_behavior: false, home_pack: false, ...extra });

// Flat grass at y 63; the bot inside a composter at (x, 64, 0), at the height of an empty composter.
function composterBot() {
    const [x] = freshPos();
    const bx = Math.floor(x);
    const world = createBlockWorld().flatGround(63);
    world.set(bx, 64, 0, 'composter');
    const bot = makeFakeBot({ world, pos: [bx + 0.5, 64.125, 0.5] });
    bot.gotoImpl = noPath;
    return { bot, world, bx };
}

const NAMES = new Map([[0, 'north'], [-90, 'east'], [180, 'south'], [-180, 'south'], [90, 'west']]);
const sideName = (yaw) => NAMES.get(Math.round((yaw * 180) / Math.PI)) ?? String(yaw);

// The fake physics: forward and jump together move the bot 1.6 blocks towards the side it looks at, onto
// the grass, when that side is in `open`. Records the sides it looked at and the control states.
function physics(bot, open) {
    const log = { looks: [], states: [] };
    bot.entity.onGround = true;
    bot.look = async (yaw) => { bot.entity.yaw = yaw; log.looks.push(sideName(yaw)); };
    bot.setControlState = (name, value) => {
        bot.controlState[name] = value;
        log.states.push([name, value]);
        if (name === 'jump' && value && bot.controlState.forward && open.includes(sideName(bot.entity.yaw))) {
            const x = Math.floor(bot.entity.position.x) + 0.5, z = Math.floor(bot.entity.position.z) + 0.5;
            bot.entity.position = new Vec3(x - Math.sin(bot.entity.yaw) * 1.6, 64, z - Math.cos(bot.entity.yaw) * 1.6);
        }
    };
    bot.clearControlStates = () => { bot.controlState = {}; log.states.push(['clear']); };
    return log;
}

// A command at the same place for 21 s: the mode unstuck escapes. Returns the promise of the command.
async function getStuck(agent, label = 'action:goToCoordinates') {
    const running = agent.actions.runAction(label, async () => {
        agent.bot.output += 'Found non-destructive path.\n';
        while (!agent.bot.interrupt_code) await sleep(10);
    });
    await sleep(30);
    await agent.bot.modes.update(); // the stuck time starts
    offset += 21000;
    await agent.bot.modes.update();
    return running;
}

async function settle(agent, ms = 15000) {
    await sleep(350);
    const end = realNow() + ms;
    while (agent.actions.executing && realNow() < end) await sleep(10);
    await sleep(50);
}

describe('X1: the last step of the escape, out of a composter', () => {
    test('stuck_restart_after 3: moveAway finds no way, the bot jumps out to the north: "I\'m free.", no giving up', LIMIT, async () => {
        setSettings({ stuck_restart_after: 3 });
        const { bot } = composterBot();
        const log = physics(bot, ['north', 'east', 'south', 'west']);
        const agent = makeFakeAgent(M, bot, { on: ['unstuck'] });
        await getStuck(agent);
        await settle(agent);
        assert.deepEqual(agent.kills, []);
        assert.deepEqual(log.looks, ['north'], 'the first side worked');
        assert.ok(agent.messages[0].includes("I'm stuck!\nI'm free.\n"), agent.messages[0]);
        assert.ok(!agent.messages[0].includes('could not walk away'), agent.messages[0]);
        assert.ok(Math.floor(bot.entity.position.z) === -2 || Math.floor(bot.entity.position.z) === -1, String(bot.entity.position));
        assert.deepEqual(log.states.at(-1), ['clear'], 'the controls are released at the end');
        assert.ok(cap.allText().includes('The escape: I am in a composter at ('), cap.allText().slice(-800));
    });

    test('the sides one after the other, north, east, south; the side with lava is never tried', LIMIT, async () => {
        setSettings({ stuck_restart_after: 3 });
        const { bot, world, bx } = composterBot();
        world.set(bx - 1, 63, 0, 'lava'); // the west column
        const log = physics(bot, ['south', 'west']);
        const agent = makeFakeAgent(M, bot, { on: ['unstuck'] });
        await getStuck(agent);
        await settle(agent);
        assert.deepEqual(log.looks, ['north', 'east', 'south']);
        assert.ok(agent.messages[0].includes("I'm free."), agent.messages[0]);
        assert.ok(bot.entity.position.z > 1.5, 'out to the south');
    });

    test('nothing gets the bot out: the reflex gives up as before, with the composter named in the console', LIMIT, async () => {
        setSettings({ stuck_restart_after: 3 });
        const { bot, bx } = composterBot();
        const log = physics(bot, []);
        const agent = makeFakeAgent(M, bot, { on: ['unstuck'] });
        await getStuck(agent);
        await settle(agent);
        assert.deepEqual(agent.kills, []);
        assert.deepEqual(log.looks, ['north', 'east', 'south', 'west'], 'each of the four sides once');
        assert.ok(agent.messages[0].includes(`I'm stuck!\nI am stuck at (${bx}, 64, 0) and could not walk away.`), agent.messages[0]);
        assert.ok(!agent.messages[0].includes("I'm free."));
        const releases = log.states.filter(([name, value]) => (name === 'forward' || name === 'jump') && value === false);
        assert.ok(releases.length >= 8, 'forward and jump released after each side');
        assert.deepEqual(log.states.at(-1), ['clear']);
    });

    test('a stop during the last step: no failure, no line of giving up; the next failure is the first of its row', LIMIT, async () => {
        setSettings({ stuck_restart_after: 2 });
        const { bot } = composterBot();
        const log = physics(bot, []);
        const agent = makeFakeAgent(M, bot, { on: ['unstuck'] });
        const look = bot.look;
        let stopped = false;
        bot.look = async (yaw) => {
            await look(yaw);
            if (!stopped) {
                stopped = true;
                agent.actions.stop('!stop'); // the player types !stop while the bot jumps
            }
        };
        await getStuck(agent);
        await settle(agent);
        assert.deepEqual(log.looks, ['north'], 'it ends at once');
        assert.deepEqual(agent.kills, []);
        assert.ok(!agent.messages.some((m) => m.includes('could not walk away')), JSON.stringify(agent.messages));
        // stuck_restart_after 2: after a stop that was no failure, one failure does not end the process
        bot.look = look;
        await getStuck(agent);
        await settle(agent);
        assert.deepEqual(agent.kills, [], 'the first failure of the row gives up');
        assert.ok(agent.messages.at(-1).includes('could not walk away'), agent.messages.at(-1));
    });
});

describe('X1: the walk of moveAway that ran out of time', () => {
    test('it is ended first and kept ended while the bot is steered (the interrupt flag), then the flag is given back', { timeout: 60000 }, async () => {
        setSettings({ stuck_restart_after: 3 });
        const { bot } = composterBot();
        bot.gotoImpl = hang; // the walk of moveAway never ends by itself: the 20 s of the escape run out
        const log = physics(bot, ['north']);
        const flags = [];
        const set = bot.setControlState;
        bot.setControlState = (name, value) => { flags.push(bot.interrupt_code); set(name, value); };
        const agent = makeFakeAgent(M, bot, { on: ['unstuck'] });
        const t0 = realNow();
        await getStuck(agent);
        await settle(agent, 40000);
        assert.ok(realNow() - t0 >= 19000, 'the escape waited its 20 s');
        assert.deepEqual(log.looks, ['north']);
        assert.ok(flags.length > 0 && flags.every((f) => f === true), 'no walk may start while the bot is steered');
        assert.equal(bot.interrupt_code, false, 'given back');
        assert.ok(agent.messages[0].includes("I'm stuck!\nI'm free.\n"), agent.messages[0]);
        assert.deepEqual(agent.kills, []);
    });
});

describe('X1: no last step where it does not belong', () => {
    test('stuck_restart_after 1 (the default, v0.1.4.7): moveAway throws, the error goes to the action; the bot is not steered', LIMIT, async () => {
        setSettings(); // 1
        const { bot } = composterBot();
        const log = physics(bot, ['north', 'east', 'south', 'west']);
        const agent = makeFakeAgent(M, bot, { on: ['unstuck'] });
        await getStuck(agent);
        await settle(agent);
        assert.deepEqual(log.looks, []);
        assert.ok(!log.states.some(([name]) => name === 'forward' || name === 'jump'));
        assert.ok(!agent.messages.some((m) => m.includes("I'm free.")));
    });

    test('the closed room of w31 (1 x 1 x 2 of obsidian): no side to jump to, the reflex gives up as before', LIMIT, async () => {
        setSettings({ stuck_restart_after: 3 });
        const [x] = freshPos();
        const bx = Math.floor(x);
        const world = createBlockWorld().flatGround(63);
        world.fill(bx - 1, 63, -1, bx + 1, 66, 1, 'obsidian');
        world.fill(bx, 64, 0, bx, 65, 0, 'air');
        const bot = makeFakeBot({ world, pos: [bx + 0.5, 64, 0.5] });
        bot.gotoImpl = noPath;
        const log = physics(bot, ['north', 'east', 'south', 'west']);
        const agent = makeFakeAgent(M, bot, { on: ['unstuck'] });
        await getStuck(agent);
        await settle(agent);
        assert.deepEqual(log.looks, []);
        assert.ok(agent.messages[0].includes(`I am stuck at (${bx}, 64, 0) and could not walk away.`), agent.messages[0]);
    });

    test('on open ground: no last step', LIMIT, async () => {
        setSettings({ stuck_restart_after: 3 });
        const bot = makeFakeBot({ pos: freshPos() });
        bot.gotoImpl = noPath;
        const log = physics(bot, ['north', 'east', 'south', 'west']);
        const agent = makeFakeAgent(M, bot, { on: ['unstuck'] });
        await getStuck(agent);
        await settle(agent);
        assert.deepEqual(log.looks, []);
        assert.ok(agent.messages[0].includes('could not walk away'));
    });
});
