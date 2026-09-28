// Spec v0.1.4.6, Amendment 2 F1 in src/agent/library/skills.js: the old door timer of goToGoal and
// followPlayer (startDoorInterval) toggles the nearest door or gate whenever the bot has not moved
// for 1.2 seconds. On the real server it opened and closed a fence gate every 1.5 seconds while the
// bot stood in the gate, and the bot never arrived.
//   - while the reflex door_closing of the home pack exists and is on, the timer is not started;
//   - with home_pack off (the mode does not exist) the timer works as before;
//   - with the mode switched off by !setMode the timer works as before.
// The bot is a fake that stands still next to an oak door; its path finder "walks" for 1.9 s.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import prismarineBlock from 'prismarine-block';
import { Vec3 } from 'vec3';
import pf from 'mineflayer-pathfinder';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { makeWorld, makeFakeBot, buildHouse, straightGoto } from './home_fake_bot.test.js';
import { register } from 'node:module';

register('../helpers/mcdata_hooks.js', import.meta.url);
const mcdata = await loadSrc('src/utils/mcdata.js');
const skills = await loadSrc('src/agent/library/skills.js');

const registry = minecraftData('1.21.8');
const Block = prismarineBlock(registry);
mcdata.__setMcdataForTests(registry);

const WALK_MS = 1900; // longer than the 1.2 s after which the timer toggles a door

// modes: null (home_pack off: no mode door_closing) or { on } for the mode door_closing
function makeBot(modes) {
    const world = createBlockWorld().flatGround(63);
    world.set(1, 64, 0, 'oak_door');
    const activated = [];
    const bot = {
        username: 'andy',
        registry,
        output: '',
        interrupt_code: false,
        entity: { position: new Vec3(0.5, 64, 0.5) },
        entities: {},
        players: { steve: { entity: { position: new Vec3(20.5, 64, 0.5) } } },
        game: { dimension: 'overworld', gameMode: 'survival' },
        modes: {
            exists: (name) => modes !== null && name === 'door_closing',
            isOn: (name) => modes !== null && name === 'door_closing' && modes.on,
            pause() {},
            unpause() {},
        },
        on() {},
        once() {},
        blockAt(pos) {
            const p = new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
            const name = world.get(p.x, p.y, p.z);
            if (name === null) return null;
            const block = Block.fromStateId(registry.blocksByName[name].defaultState, 0);
            block.position = p;
            return block;
        },
        activateBlock(block) {
            activated.push(block.name);
            return Promise.resolve();
        },
        pathfinder: {
            getPathTo: () => ({ status: 'success' }),
            setMovements() {},
            setGoal() {},
            stop() {},
            goto: () => new Promise((resolve) => setTimeout(resolve, WALK_MS)),
        },
        activated,
    };
    return bot;
}

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

async function follow(bot) {
    setTimeout(() => { bot.interrupt_code = true; }, WALK_MS);
    return skills.followPlayer(bot, 'steve', 4);
}

describe('F1: the door timer of goToGoal', () => {
    test('home_pack off (no mode door_closing): the timer toggles the door next to a bot that stands still', async () => {
        const bot = makeBot(null);
        assert.equal(await skills.goToGoal(bot, new pf.goals.GoalNear(5, 64, 0, 1)), true);
        assert.ok(bot.activated.includes('oak_door'), JSON.stringify(bot.activated));
    });

    test('the reflex door_closing on: the timer is not started, no door is toggled', async () => {
        const bot = makeBot({ on: true });
        assert.equal(await skills.goToGoal(bot, new pf.goals.GoalNear(5, 64, 0, 1)), true);
        assert.deepEqual(bot.activated, []);
    });

    test('the mode door_closing switched off: the timer works as before', async () => {
        const bot = makeBot({ on: false });
        await skills.goToGoal(bot, new pf.goals.GoalNear(5, 64, 0, 1));
        assert.ok(bot.activated.includes('oak_door'), JSON.stringify(bot.activated));
    });

    test('a failing mode controller does not stop the walk (the timer runs as before)', async () => {
        const bot = makeBot(null);
        bot.modes.exists = () => { throw new Error('broken'); };
        assert.equal(await skills.goToGoal(bot, new pf.goals.GoalNear(5, 64, 0, 1)), true);
        assert.ok(bot.activated.includes('oak_door'));
    });
});

describe('F1: a walk that is stuck at a door goes through it with passThrough', () => {
    // On the real server the path finder opened a fence gate and then stood at the corner of the
    // gate for ever. With the door reflex on, goToGoal waits 3 s without progress, then passes the
    // door or gate between the bot and the goal with passThrough and walks on.
    function stuckScene({ reflex = true } = {}) {
        const world = makeWorld();
        buildHouse(world, { doorOpen: true }); // door at (4, 64, 7), facing south, opened by the path finder
        const bot = makeFakeBot({ world, pos: [4.0, 64, 8.0] }); // at the corner of the doorway
        bot.modes = { paused: [], exists: (n) => reflex && n === 'door_closing', isOn: () => reflex, pause(n) { this.paused.push(n); }, unpause() {} };
        bot.output = '';
        bot.pathfinder.getPathTo = () => ({ status: 'success' });
        let calls = 0;
        bot.gotoImpl = (goal) => {
            calls++;
            if (calls > 1) return straightGoto(bot, goal);
            return new Promise((resolve, reject) => { // the first walk makes no progress
                bot.onSetGoal = (g) => {
                    if (g !== null) return;
                    const err = new Error('The goal was changed before it could be completed!');
                    err.name = 'GoalChanged';
                    reject(err);
                };
                setTimeout(() => { const err = new Error('stuck'); err.name = 'Stuck'; reject(err); }, 5000);
            });
        };
        return { world, bot, walks: () => calls };
    }

    test('the reflex on: after 3 s at the door the bot goes through it, closes it and arrives', async () => {
        const { world, bot } = stuckScene();
        const t0 = Date.now();
        assert.equal(await skills.goToGoal(bot, new pf.goals.GoalNear(4, 64, 4, 1)), true);
        assert.ok(Date.now() - t0 >= 3000 && Date.now() - t0 < 4800, `after about 3 s: ${Date.now() - t0} ms`);
        assert.ok(bot.output.includes('I am stuck at the door at (4, 64, 7). I walk through it.'), bot.output);
        assert.ok(bot.output.includes('I went through the door at'), bot.output);
        assert.equal(world.propsAt(4, 64, 7).open, false, 'the door is closed');
        const p = bot.entity.position;
        assert.ok(Math.hypot(p.x - 4.5, p.z - 4.5) < 0.1, `arrived: ${p}`);
    });

    test('the reflex off: no help, the walk fails as before', async () => {
        const { bot } = stuckScene({ reflex: false });
        await assert.rejects(skills.goToGoal(bot, new pf.goals.GoalNear(4, 64, 4, 1)), { name: 'Stuck' });
        assert.ok(!bot.output.includes('I walk through it'), bot.output);
    });

    test('no door between the bot and the goal: no help', async () => {
        const { bot } = stuckScene();
        await assert.rejects(skills.goToGoal(bot, new pf.goals.GoalNear(4, 64, 14, 1)), { name: 'Stuck' });
        assert.ok(!bot.output.includes('I walk through it'), bot.output);
    });
});

describe('F1: the door timer of followPlayer', () => {
    test('home_pack off: the timer toggles the door while the player is far', async () => {
        const bot = makeBot(null);
        assert.equal(await follow(bot), true);
        assert.ok(bot.activated.includes('oak_door'), JSON.stringify(bot.activated));
    });

    test('the reflex door_closing on: no door is toggled', async () => {
        const bot = makeBot({ on: true });
        assert.equal(await follow(bot), true);
        assert.deepEqual(bot.activated, []);
    });
});
