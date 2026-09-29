// Fix round of v0.1.4.8, X3: after unstuck fired once, it stopped new orders of the player 0.2 to 20 s after
// their start (long run: `Command !storeItems was stopped by the reflex unstuck` 0.2 s after the order).
// Two causes, both corrected:
//   1. The race in src/agent/action_manager.js: the action of the reflex waited in stop() (a sleep of 300 ms)
//      for the command before it; the player's next command came in that sleep, saw nothing running and
//      started; then the reflex woke up, saw an action running and stopped it. Now every request to start
//      takes a ticket, and an action that waited starts only while its ticket is the newest one.
//   2. The stuck time of unstuck went on from the action before: it starts from zero when a new action
//      starts (ActionManager.action_serial), so a new command always has its full 20 s, also after the
//      reflex gave up.
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { captureConsole } from '../helpers/console_capture.js';
import { loadModes, makeFakeBot, makeFakeAgent, freshPos, noPath } from '../helpers/st_modes_env.js';

const M = await loadModes();
await import('ses'); // the global assert of the agent process, for resume actions

const LIMIT = { timeout: 30000 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A fake agent as in sta_action_manager.test.js: requestInterrupt sets interrupt_code, clearBotLogs resets it.
function makeAgent() {
    const agent = {
        bot: { output: '', interrupt_code: false, emitted: [], emit(name) { agent.bot.emitted.push(name); } },
        interrupts: [],
        kills: [],
        clearBotLogs() { agent.bot.output = ''; agent.bot.interrupt_code = false; },
        requestInterrupt(...args) { agent.interrupts.push(args); agent.bot.interrupt_code = true; },
        isIdle: () => !agent.actions.executing,
        self_prompter: { isActive: () => false },
        history: { add() {} },
        cleanKill(msg) { agent.kills.push(msg); },
    };
    agent.actions = new M.am.ActionManager(agent);
    return agent;
}

// An action that runs until it is interrupted.
function waiting(agent, ran, name) {
    return async () => {
        ran.push(`${name} starts`);
        while (!agent.bot.interrupt_code) await sleep(10);
        ran.push(`${name} stopped`);
    };
}

// An action that runs ms milliseconds and notes whether it was interrupted on the way.
function timed(agent, ran, name, ms) {
    return async () => {
        ran.push(`${name} starts`);
        const end = Date.now() + ms;
        while (Date.now() < end) {
            if (agent.bot.interrupt_code) {
                ran.push(`${name} interrupted`);
                return;
            }
            await sleep(10);
        }
        ran.push(`${name} ends`);
    };
}

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

describe('X3: two actions that wait for the same one never both start', () => {
    test('the race of the long run: the reflex waits for the command before, the new command of the player starts meanwhile; the reflex neither starts nor stops it', LIMIT, async () => {
        const agent = makeAgent();
        const ran = [];
        const before = agent.actions.runAction('action:goToRememberedPlace', waiting(agent, ran, 'goToRememberedPlace'));
        await sleep(30);
        const reflex = agent.actions.runAction('mode:unstuck', async () => { ran.push('unstuck starts'); });
        const r0 = await before; // the reflex still sleeps up to 300 ms in its wait
        assert.equal(r0.stopped_by, 'the reflex unstuck');
        const store = agent.actions.runAction('action:storeItems', timed(agent, ran, 'storeItems', 700));
        const [r1, r2] = await Promise.all([reflex, store]);
        assert.deepEqual(ran, ['goToRememberedPlace starts', 'goToRememberedPlace stopped', 'storeItems starts', 'storeItems ends']);
        assert.deepEqual(r2, { success: true, message: 'Action output:\n', interrupted: false, timedout: false }, 'the command was not stopped');
        assert.equal(r1.interrupted, true, 'the reflex reports as stopped');
        assert.equal(r1.stopped_by, 'the command !storeItems');
        assert.equal(r1.success, false, 'it did not run');
        assert.ok(cap.allText().includes('action "mode:unstuck" does not start: action:storeItems came after it'), cap.allText());
    });

    test('two actions wait for the same one: only the newer starts', LIMIT, async () => {
        const agent = makeAgent();
        const ran = [];
        const first = agent.actions.runAction('action:chopTrees', waiting(agent, ran, 'chopTrees'));
        await sleep(30);
        const reflex = agent.actions.runAction('mode:unstuck', async () => { ran.push('unstuck starts'); });
        const command = agent.actions.runAction('action:goToSurface', timed(agent, ran, 'goToSurface', 400));
        const [r0, r1, r2] = await Promise.all([first, reflex, command]);
        assert.deepEqual(ran, ['chopTrees starts', 'chopTrees stopped', 'goToSurface starts', 'goToSurface ends']);
        assert.equal(r0.stopped_by, 'the reflex unstuck', 'the first stopper of the running action counts');
        assert.equal(r1.stopped_by, 'the command !goToSurface');
        assert.equal(r2.interrupted, false);
    });

    test('a stop from outside (!stop) also drops an action that waits to start', LIMIT, async () => {
        const agent = makeAgent();
        const ran = [];
        const first = agent.actions.runAction('action:chopTrees', waiting(agent, ran, 'chopTrees'));
        await sleep(30);
        const reflex = agent.actions.runAction('mode:item_collecting', async () => { ran.push('item_collecting starts'); });
        await agent.actions.stop('!stop');
        const [r0, r1] = await Promise.all([first, reflex]);
        assert.deepEqual(ran, ['chopTrees starts', 'chopTrees stopped']);
        assert.equal(r0.stopped_by, 'the reflex item_collecting', 'the first stopper counts');
        assert.equal(r1.interrupted, true);
        assert.equal(r1.stopped_by, '!stop');
        assert.equal(agent.actions.executing, false);
    });

    test('an action that throws when it is stopped: the action that waited for it still starts', LIMIT, async () => {
        const agent = makeAgent();
        const ran = [];
        const first = agent.actions.runAction('action:chopTrees', async () => {
            while (!agent.bot.interrupt_code) await sleep(10);
            throw new Error('GoalChanged: The goal was changed before it could be completed!');
        });
        await sleep(30);
        const reflex = await agent.actions.runAction('mode:unstuck', async () => { ran.push('unstuck starts'); });
        assert.equal((await first).stopped_by, 'the reflex unstuck');
        assert.deepEqual(ran, ['unstuck starts']);
        assert.equal(reflex.interrupted, false);
    });

    test('action_serial counts the actions that started, not the ones that were replaced before their start', LIMIT, async () => {
        const agent = makeAgent();
        assert.equal(agent.actions.action_serial, 0);
        await agent.actions.runAction('action:a', async () => {});
        await agent.actions.runAction('mode:unstuck', async () => {});
        assert.equal(agent.actions.action_serial, 2);
        const ran = [];
        const first = agent.actions.runAction('action:b', waiting(agent, ran, 'b'));
        await sleep(30);
        const skipped = agent.actions.runAction('mode:unstuck', async () => {});
        const next = agent.actions.runAction('action:c', async () => {});
        await Promise.all([first, skipped, next]);
        assert.equal(agent.actions.action_serial, 4, 'b and c started, the reflex did not');
    });

    test('a new resume that was replaced before its start does not clear the label of the action that runs', LIMIT, async () => {
        const agent = makeAgent();
        const ran = [];
        const first = agent.actions.runAction('action:chopTrees', waiting(agent, ran, 'chopTrees'));
        await sleep(30);
        const follow = agent.actions.runAction('action:followPlayer', async () => { ran.push('followPlayer starts'); }, { resume: true });
        await first; // the resume still sleeps in its wait
        const store = agent.actions.runAction('action:storeItems', timed(agent, ran, 'storeItems', 800));
        await follow;
        assert.equal(agent.actions.currentActionLabel, 'action:storeItems', 'the running command keeps its label');
        await store;
        assert.deepEqual(ran, ['chopTrees starts', 'chopTrees stopped', 'storeItems starts', 'storeItems ends']);
        assert.equal(agent.actions.currentActionLabel, '');
    });
});

// ---------------------------------------------------------------- the stuck time of the mode unstuck

const realNow = Date.now;
let offset = 0;

describe('X3: the stuck time starts from zero when a new action starts', () => {
    before(() => { Date.now = () => realNow() + offset; });
    after(() => { Date.now = realNow; });
    beforeEach(() => { offset += 10 * 60 * 1000; });

    const setSettings = (extra = {}) => M.settingsModule.setSettings({ language: 'en', narrate_behavior: false, home_pack: false, ...extra });

    function command(agent, label) {
        return agent.actions.runAction(label, async () => {
            agent.bot.output += 'Walking.\n';
            while (!agent.bot.interrupt_code) await sleep(10);
        });
    }

    async function settle(agent, ms = 15000) {
        await sleep(350);
        const end = realNow() + ms;
        while (agent.actions.executing && realNow() < end) await sleep(10);
        await sleep(50);
    }

    test('a command 15 s at the same place, then the player types the next one: it gets its own 20 s', LIMIT, async () => {
        setSettings({ stuck_restart_after: 3 });
        const bot = makeFakeBot({ pos: freshPos() });
        bot.gotoImpl = noPath;
        const agent = makeFakeAgent(M, bot, { on: ['unstuck'] });
        const first = command(agent, 'action:goToCoordinates');
        await sleep(30);
        await bot.modes.update(); // the stuck time of the first command starts
        offset += 15000;
        await bot.modes.update();
        const second = command(agent, 'action:goToSurface'); // replaces the first one directly, no idle between
        await first;
        await sleep(400);
        await bot.modes.update();
        offset += 6000; // 21 s after the start of the first command, 6 s after the second
        await bot.modes.update();
        await sleep(50);
        assert.deepEqual(agent.labels, ['action:goToCoordinates', 'action:goToSurface'], 'no escape: the second command has its own 20 s');
        offset += 15000; // 21 s after the start of the second command
        await bot.modes.update();
        await second;
        await settle(agent);
        assert.ok(agent.labels.includes('mode:unstuck'), 'now it escapes');
    });

    test('after the reflex gave up, the new command has its full 20 s', LIMIT, async () => {
        setSettings({ stuck_restart_after: 3 });
        const bot = makeFakeBot({ pos: freshPos() });
        bot.gotoImpl = noPath;
        const agent = makeFakeAgent(M, bot, { on: ['unstuck'] });
        const first = command(agent, 'action:goToCoordinates');
        await sleep(30);
        await bot.modes.update();
        offset += 21000;
        await bot.modes.update();
        await first;
        await settle(agent);
        assert.ok(agent.messages[0].includes('could not walk away'), 'the reflex gave up');
        const escapes = () => agent.labels.filter((l) => l === 'mode:unstuck').length;
        assert.equal(escapes(), 1);

        const second = command(agent, 'action:storeItems');
        await sleep(30);
        await bot.modes.update(); // the pause ends: a new command
        offset += 19000;
        await bot.modes.update();
        await sleep(50);
        assert.equal(escapes(), 1, '19 s: not yet');
        offset += 2000;
        await bot.modes.update();
        await second;
        await settle(agent);
        assert.equal(escapes(), 2, '21 s: the second escape');
    });
});
