// Spec v0.1.4.8, part B, B3 (S9, S11, P5) in src/agent/library/skills.js:
//   - goToGoal watches bot.interrupt_code every 250 ms and ends the path search with setGoal(null);
//     an interrupted walk ends within 1 s and returns false instead of throwing;
//   - goToPosition names the real position: "You have reached (x, y, z)." or
//     "I stopped at (x, y, z), N blocks from the goal.", and notes progress for unstuck
//     (bot.modes.noteProgress('path')) while the path search walks the bot nearer to the goal;
//   - moveAway gets door help also while the door reflex is on: out of a closed room through its
//     door, up a shaft through a trapdoor.
// Two fakes: the bot of stb_fake_bot.test.js for the stop, and the bot of the home pack
// (home_fake_bot.test.js, doors that open and close) for the door help.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { Vec3 } from 'vec3';
import pf from 'mineflayer-pathfinder';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { makeBot, registry, neverArrive } from './stb_fake_bot.test.js';
import { makeWorld, makeFakeBot, buildHouse, straightGoto } from './home_fake_bot.test.js';

register('../helpers/mcdata_hooks.js', import.meta.url);
const mcdata = await loadSrc('src/utils/mcdata.js');
const skills = await loadSrc('src/agent/library/skills.js');
mcdata.__setMcdataForTests(registry);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

describe('B3: goToGoal really stops on an interrupt', () => {
    test('a walk that never ends: stopped with setGoal(null) within 1 s of the interrupt, false', async () => {
        const bot = makeBot();
        bot.gotoImpl = neverArrive;
        let at = 0;
        setTimeout(() => { at = Date.now(); bot.interrupt_code = true; }, 300);
        const result = await skills.goToGoal(bot, new pf.goals.GoalNear(40, 64, 0, 1));
        const ms = Date.now() - at;
        assert.equal(result, false);
        assert.ok(ms < 1000, `ended ${ms} ms after the interrupt`);
        assert.ok(bot.calls.some((c) => c[0] === 'setGoal' && c[1] === null), 'setGoal(null)');
        assert.ok(bot.calls.some((c) => c[0] === 'clearControlStates'));
    });

    test('a walk that fails because it was stopped (PathStopped) returns false, no exception', async () => {
        const bot = makeBot();
        bot.gotoImpl = async () => {
            await sleep(100);
            bot.interrupt_code = true;
            const err = new Error('Path was stopped before it could be completed!');
            err.name = 'PathStopped';
            throw err;
        };
        assert.equal(await skills.goToGoal(bot, new pf.goals.GoalNear(40, 64, 0, 1)), false);
    });

    test('already interrupted: no walk starts', async () => {
        const bot = makeBot();
        bot.interrupt_code = true;
        assert.equal(await skills.goToGoal(bot, new pf.goals.GoalNear(40, 64, 0, 1)), false);
        assert.ok(!bot.calls.some((c) => c[0] === 'goto'));
    });

    test('without an interrupt: true after the walk, errors are thrown as before', async () => {
        const bot = makeBot();
        assert.equal(await skills.goToGoal(bot, new pf.goals.GoalNear(5, 64, 0, 1)), true);
        bot.gotoImpl = () => { const e = new Error('No path to the goal!'); e.name = 'NoPath'; throw e; };
        await assert.rejects(skills.goToGoal(bot, new pf.goals.GoalNear(5, 64, 0, 1)), { name: 'NoPath' });
    });

    test('goToPosition interrupted: false within 1 s, the text names where the bot stopped', async () => {
        const bot = makeBot({ pos: [0.5, 64, 0.5] });
        bot.gotoImpl = neverArrive;
        setTimeout(() => { bot.interrupt_code = true; }, 200);
        const t0 = Date.now();
        assert.equal(await skills.goToPosition(bot, 30, 64, 0, 2), false);
        assert.ok(Date.now() - t0 < 1200);
        assert.equal(bot.output.trimEnd().split('\n').at(-1), 'I stopped at (0, 64, 0), 30 blocks from the goal.');
    });
});

describe('B3: goToPosition names the real position', () => {
    test('reached: "You have reached (x, y, z)." with the position of the bot', async () => {
        const bot = makeBot();
        assert.equal(await skills.goToPosition(bot, 5, 64, 3, 0), true);
        assert.equal(bot.output.trimEnd().split('\n').at(-1), 'You have reached (5, 64, 3).');
    });

    test('one block short of a closeness of 0 is still reached, and the text names that block', async () => {
        const bot = makeBot();
        bot.gotoImpl = () => { bot.entity.position = new Vec3(4.5, 64, 3.5); };
        assert.equal(await skills.goToPosition(bot, 5, 64, 3, 0), true);
        assert.equal(bot.output.trimEnd().split('\n').at(-1), 'You have reached (4, 64, 3).');
    });

    test('stopped short: "I stopped at (x, y, z), N blocks from the goal.", false', async () => {
        const bot = makeBot();
        bot.gotoImpl = () => { bot.entity.position = new Vec3(2.5, 64, 0.5); };
        assert.equal(await skills.goToPosition(bot, 10, 64, 0, 2), false);
        assert.equal(bot.output.trimEnd().split('\n').at(-1), 'I stopped at (2, 64, 0), 8 blocks from the goal.');
    });

    test('an error of the walk: the error and the position', async () => {
        const bot = makeBot();
        bot.gotoImpl = () => { const e = new Error('Took to long to decide path to goal!'); e.name = 'Timeout'; throw e; };
        assert.equal(await skills.goToPosition(bot, 10, 64, 0, 2), false);
        assert.deepEqual(bot.output.trimEnd().split('\n').slice(-2), [
            'Pathfinding stopped: Took to long to decide path to goal!.',
            'I stopped at (0, 64, 0), 10 blocks from the goal.',
        ]);
    });
});

describe('B3: goToPosition notes progress for unstuck', () => {
    function progressBot(step) {
        const bot = makeBot({ pos: [0.5, 64, 0.5] });
        bot.notes = [];
        bot.modes.noteProgress = (reason) => bot.notes.push(reason);
        bot.gotoImpl = async () => {
            bot.pathfinder.moving = true;
            for (let i = 0; i < 12; i++) {
                await sleep(250);
                const p = bot.entity.position;
                bot.entity.position = new Vec3(p.x + step, p.y, p.z);
            }
            bot.pathfinder.moving = false;
        };
        return bot;
    }

    test('the path search walks the bot nearer to the goal: progress "path" is noted', async () => {
        const bot = progressBot(0.5);
        await skills.goToPosition(bot, 20, 64, 0, 1);
        assert.ok(bot.notes.length >= 2, JSON.stringify(bot.notes));
        assert.ok(bot.notes.every((n) => n === 'path'));
    });

    test('the path search pushes the bot against a wall (no step nearer): nothing is noted', async () => {
        const bot = progressBot(0);
        await skills.goToPosition(bot, 20, 64, 0, 1);
        assert.deepEqual(bot.notes, []);
    });

    test('a mode controller without noteProgress (part A not there): no error', async () => {
        const bot = progressBot(0.5);
        delete bot.modes.noteProgress;
        await skills.goToPosition(bot, 20, 64, 0, 1);
        assert.ok(bot.output.includes('I stopped at'), bot.output);
    });
});

describe('B3: moveAway gets door help while the door reflex is on', () => {
    // The house of the home pack: walls x, z 1..7, door at (4, 64, 7) facing south. The walls are
    // cells the fake path finder cannot cross.
    function roomScene({ reflex = true } = {}) {
        const world = makeWorld();
        buildHouse(world);
        const bot = makeFakeBot({ world, pos: [4.5, 64, 5.5] });
        for (let i = 1; i <= 7; i++) {
            for (const [x, z] of [[i, 1], [i, 7], [1, i], [7, i]]) {
                if (!(x === 4 && z === 7)) bot.blocked.add(`${x},64,${z}`);
            }
        }
        bot.output = '';
        bot.modes = { paused: [], exists: (n) => reflex && n === 'door_closing', isOn: (n) => reflex && n === 'door_closing', pause(n) { this.paused.push(n); }, unpause() {} };
        bot.pathfinder.getPathTo = () => ({ status: 'noPath' });
        return { world, bot };
    }

    test('a closed room with one door: no path, the bot goes through the door, closes it and walks 5 blocks away', async () => {
        const { world, bot } = roomScene();
        assert.equal(await skills.moveAway(bot, 5), true);
        const p = bot.entity.position;
        assert.ok(p.distanceTo(new Vec3(4.5, 64, 5.5)) >= 5, `away: ${p}`);
        assert.equal(world.propsAt(4, 64, 7).open, false, 'the door is closed again');
        assert.ok(bot.output.includes('I am stuck at the door at (4, 64, 7). I walk through it.'), bot.output);
        assert.ok(bot.output.includes('Moved away from (4, 64, 5) to'), bot.output);
    });

    test('the door reflex off: no help, the failed walk throws as in v0.1.4.7', async () => {
        const { bot } = roomScene({ reflex: false });
        await assert.rejects(skills.moveAway(bot, 5), { name: 'NoPath' });
        assert.ok(!bot.output.includes('I walk through it'), bot.output);
    });

    test('a walk that gets away by itself: no door is touched', async () => {
        const world = makeWorld();
        const bot = makeFakeBot({ world, pos: [20.5, 64, 20.5] });
        world.door(22, 64, 20);
        bot.output = '';
        bot.modes = { exists: (n) => n === 'door_closing', isOn: (n) => n === 'door_closing', pause() {}, unpause() {} };
        bot.pathfinder.getPathTo = () => ({ status: 'success' });
        assert.equal(await skills.moveAway(bot, 5), true);
        assert.ok(!bot.calls.some((c) => c[0] === 'activate'), JSON.stringify(bot.calls.filter((c) => c[0] === 'activate')));
    });

    test('stuck for 3 s at the door of the room (the path finder does not give up): through the door', async () => {
        const { world, bot } = roomScene();
        let calls = 0;
        bot.gotoImpl = (goal) => {
            calls++;
            if (calls > 1) return straightGoto(bot, goal);
            return new Promise((resolve, reject) => { // the first walk makes no progress and does not end
                bot.onSetGoal = (g) => {
                    if (g !== null) return;
                    const err = new Error('The goal was changed before it could be completed!');
                    err.name = 'GoalChanged';
                    reject(err);
                };
            });
        };
        bot.entity.position = new Vec3(4.5, 64, 6.2); // at the door
        const t0 = Date.now();
        assert.equal(await skills.moveAway(bot, 5), true);
        assert.ok(Date.now() - t0 >= 3000, 'after 3 s without progress');
        assert.ok(bot.output.includes('I am stuck at the door at (4, 64, 7). I walk through it.'), bot.output);
        assert.equal(world.propsAt(4, 64, 7).open, false, 'the door is closed again');
        assert.ok(bot.entity.position.distanceTo(new Vec3(4.5, 64, 6.2)) >= 5, `${bot.entity.position}`);
    });

    test('a shaft closed by a trapdoor above: the trapdoor is opened, then the bot climbs out', async () => {
        const world = makeWorld();
        world.set(0, 66, 0, 'oak_trapdoor', { facing: 'north', half: 'bottom', open: false });
        const bot = makeFakeBot({ world, pos: [0.5, 64, 0.5] });
        bot.output = '';
        bot.modes = { exists: (n) => n === 'door_closing', isOn: (n) => n === 'door_closing', pause() {}, unpause() {} };
        bot.pathfinder.getPathTo = () => ({ status: 'noPath' });
        bot.gotoImpl = async () => {
            if (world.propsAt(0, 66, 0).open !== true) {
                const e = new Error('No path to the goal!');
                e.name = 'NoPath';
                throw e;
            }
            bot.entity.position = new Vec3(0.5, 67, 6.5); // up the ladder and away
        };
        assert.equal(await skills.moveAway(bot, 5), true);
        assert.equal(world.propsAt(0, 66, 0).open, true, 'open: the door service closes it later');
        assert.ok(bot.output.includes('I opened the oak_trapdoor at (0, 66, 0).'), bot.output);
        assert.ok(bot.entity.position.distanceTo(new Vec3(0.5, 64, 0.5)) >= 5);
    });
});
