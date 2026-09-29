// Fix round of v0.1.4.8, X5 parts 2 and 3: the bot stayed asleep. After "I got up before the morning." it
// still lay in the bed (sleeping=true), !searchForEntity and !goToCoordinates timed out and !chopTrees ran
// 394 s until the morning, without "I'm stuck!", because sleeping counted as progress for unstuck.
//   part 2: when an action starts while bot.isSleeping, and it is a command other than !goToBed, the bot gets
//           out of bed first: agent.wakeForAction (src/agent/agent.js) calls wakeUp of the home pack when it
//           exists, else bot.wake(), and waits until bot.isSleeping is false, at most 3 s. The action
//           manager calls it. Queries (they run no action) do not wake the bot, nor do the reflexes.
//   part 3: sleeping counts as progress for unstuck only while !goToBed (or the night reflex) runs, or no
//           action runs (src/agent/reflex/wake_logic.js, used by the mode unstuck).
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';
import { loadGlue, makeGlueAgent } from '../helpers/st_glue_env.js';
import { loadModes, makeFakeBot, makeFakeAgent, freshPos, noPath } from '../helpers/st_modes_env.js';

const W = await loadSrc('src/agent/reflex/wake_logic.js');
const G = await loadGlue();
const M = await loadModes();
await import('ses'); // the global assert of the agent process, for resume actions

const LIMIT = { timeout: 30000 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

describe('wake_logic.js', () => {
    test('shouldWakeFor: a command other than !goToBed while the bot sleeps', () => {
        assert.equal(W.shouldWakeFor('action:chopTrees', true), true);
        assert.equal(W.shouldWakeFor('action:goToCoordinates', true), true);
        assert.equal(W.shouldWakeFor('action:goToBed', true), false, '!goToBed');
        assert.equal(W.shouldWakeFor('mode:unstuck', true), false, 'a reflex');
        assert.equal(W.shouldWakeFor('mode:night_shelter', true), false, 'the night reflex');
        assert.equal(W.shouldWakeFor('action:chopTrees', false), false, 'awake');
        assert.equal(W.shouldWakeFor('action:chopTrees', 'yes'), false);
        assert.equal(W.shouldWakeFor(null, true), false);
        assert.equal(W.shouldWakeFor('', true), false);
    });

    test('sleepIsProgress: no action, !goToBed and the night reflex; not a command, not another reflex', () => {
        for (const label of ['', null, undefined, 'action:goToBed', 'mode:night_shelter'])
            assert.equal(W.sleepIsProgress(label), true, String(label));
        for (const label of ['action:chopTrees', 'action:searchForEntity', 'mode:unstuck', 'mode:self_defense', 42])
            assert.equal(W.sleepIsProgress(label), false, String(label));
    });

    test('the wait is 3 s at most', () => {
        assert.equal(W.WAKE_RULES.waitMs, 3000);
    });

    test('module rules: imports nothing, importable without output or files', () => {
        assertImportRules('src/agent/reflex/wake_logic.js', { allowBuiltins: [], allowedRelative: [] });
        assertCleanImport('src/agent/reflex/wake_logic.js');
    });
});

describe('the action manager asks the agent to wake the bot before the action (part 2)', () => {
    function makeAgent(wake) {
        const events = [];
        const agent = {
            bot: { output: '', interrupt_code: false, emit() {} },
            clearBotLogs() { agent.bot.output = ''; agent.bot.interrupt_code = false; },
            requestInterrupt() { agent.bot.interrupt_code = true; },
            isIdle: () => !agent.actions.executing,
            self_prompter: { isActive: () => false },
            history: { add() {} },
            cleanKill() {},
            wakeForAction: wake ?? (async (label) => { events.push(`wake ${label}`); }),
        };
        agent.actions = new G.am.ActionManager(agent);
        return { agent, events };
    }

    test('wakeForAction(label) after the start, before the action; for every action (the agent decides)', LIMIT, async () => {
        const { agent, events } = makeAgent();
        await agent.actions.runAction('action:chopTrees', async () => { events.push(`run ${agent.actions.currentActionLabel}`); });
        await agent.actions.runAction('mode:unstuck', async () => { events.push('run mode'); });
        assert.deepEqual(events, ['wake action:chopTrees', 'run action:chopTrees', 'wake mode:unstuck', 'run mode']);
    });

    test('a wake that throws does not stop the action', LIMIT, async () => {
        const { agent, events } = makeAgent(async () => { throw new Error('boom'); });
        const result = await agent.actions.runAction('action:chopTrees', async () => { events.push('run'); });
        assert.deepEqual(events, ['run']);
        assert.equal(result.success, true);
    });

    test('an agent without wakeForAction (the fakes of other tests): the action runs as before', LIMIT, async () => {
        const { agent, events } = makeAgent();
        delete agent.wakeForAction;
        await agent.actions.runAction('action:chopTrees', async () => { events.push('run'); });
        assert.deepEqual(events, ['run']);
    });
});

describe('agent.wakeForAction (part 2, the real Agent prototype)', () => {
    function sleepingAgent({ getsUp = true, after = 150 } = {}) {
        G.settingsModule.setSettings({ language: 'en', blocked_actions: [], home_pack: false, storage_pack: false, farming_pack: false,
            wood_pack: false, mining_pack: false, narrate_behavior: false, world_memory: false, protected_areas: false, show_command_syntax: 'full', max_commands: -1 });
        const agent = makeGlueAgent(G, {});
        const bot = agent.bot;
        bot.isSleeping = true;
        bot.wakes = 0;
        bot.wake = async () => {
            bot.wakes++;
            bot.calls.push(['wake']);
            if (getsUp)
                setTimeout(() => { bot.isSleeping = false; }, after);
        };
        return agent;
    }

    test('a command while the bot sleeps: it gets up first, then the command runs', LIMIT, async () => {
        const agent = sleepingAgent();
        agent.bot.inventory.put('dirt', 3, 9);
        const t0 = Date.now();
        await agent.handleMessage('MartyByrde2', '!equip("dirt")');
        const order = agent.bot.calls.filter(([name]) => name === 'wake' || name === 'equip').map(([name]) => name);
        assert.equal(order[0], 'wake', JSON.stringify(agent.bot.calls));
        assert.ok(order.includes('equip'), 'the command ran');
        assert.ok(order.indexOf('wake') < order.indexOf('equip'));
        assert.equal(agent.bot.isSleeping, false);
        assert.ok(Date.now() - t0 < 3000);
        assert.ok(cap.allText().includes('I got out of bed for action:equip.'), cap.allText().slice(-600));
    });

    test('!goToBed does not wake the bot', LIMIT, async () => {
        const agent = sleepingAgent();
        assert.equal(await agent.wakeForAction('action:goToBed'), false);
        assert.equal(agent.bot.wakes, 0);
        assert.equal(agent.bot.isSleeping, true);
    });

    test('a reflex does not wake the bot', LIMIT, async () => {
        const agent = sleepingAgent();
        assert.equal(await agent.wakeForAction('mode:item_collecting'), false);
        assert.equal(agent.bot.wakes, 0);
    });

    test('a query does not wake the bot (it runs no action)', LIMIT, async () => {
        const agent = sleepingAgent();
        const labels = [];
        const run = agent.actions.runAction.bind(agent.actions);
        agent.actions.runAction = (label, fn, options) => { labels.push(label); return run(label, fn, options); };
        for (const query of ['!stats', '!inventory']) {
            try {
                await G.index.executeCommand(agent, query, { typed: true });
            } catch {
                // a field of the fake bot that the query reads; only the wake counts here
            }
        }
        assert.deepEqual(labels, []);
        assert.equal(agent.bot.wakes, 0);
        assert.equal(agent.bot.isSleeping, true);
    });

    test('the bot does not get up: it waits 3 s at most, says so in the console, and the command starts all the same', { timeout: 20000 }, async () => {
        const agent = sleepingAgent({ getsUp: false });
        const t0 = Date.now();
        assert.equal(await agent.wakeForAction('action:chopTrees'), false);
        const took = Date.now() - t0;
        assert.ok(took >= 2900 && took < 4500, `${took} ms`);
        assert.ok(agent.bot.wakes >= 1);
        assert.ok(cap.allText().includes('I am still in bed after 3 s; action:chopTrees starts all the same.'), cap.allText().slice(-600));
    });

    test('an interrupt ends the wait', LIMIT, async () => {
        const agent = sleepingAgent({ getsUp: false });
        setTimeout(() => { agent.bot.interrupt_code = true; }, 200);
        const t0 = Date.now();
        await agent.wakeForAction('action:chopTrees');
        assert.ok(Date.now() - t0 < 1500, `${Date.now() - t0} ms`);
    });

    test('awake: nothing to do', LIMIT, async () => {
        const agent = sleepingAgent();
        agent.bot.isSleeping = false;
        assert.equal(await agent.wakeForAction('action:chopTrees'), false);
        assert.equal(agent.bot.wakes, 0);
    });
});

// ---------------------------------------------------------------- part 3: the mode unstuck

const realNow = Date.now;
let offset = 0;

describe('part 3: sleeping counts as progress only while !goToBed runs', () => {
    before(() => { Date.now = () => realNow() + offset; });
    after(() => { Date.now = realNow; });
    beforeEach(() => { offset += 10 * 60 * 1000; });

    async function sleepingCommand(label) {
        M.settingsModule.setSettings({ language: 'en', narrate_behavior: false, home_pack: false, stuck_restart_after: 3 });
        const bot = makeFakeBot({ pos: freshPos() });
        bot.gotoImpl = noPath;
        bot.isSleeping = true; // still in the bed, as after "I got up before the morning."
        const agent = makeFakeAgent(M, bot, { on: ['unstuck'] });
        const running = agent.actions.runAction(label, async () => { while (!bot.interrupt_code) await sleep(10); });
        await sleep(30);
        await bot.modes.update();
        offset += 21000;
        await bot.modes.update();
        await sleep(400);
        const escaped = agent.labels.includes('mode:unstuck');
        await agent.actions.stop('!stop');
        await running;
        await sleep(400);
        while (agent.actions.executing) await sleep(10);
        return escaped;
    }

    test('a command that runs while the bot lies in bed is stuck after 20 s', LIMIT, async () => {
        assert.equal(await sleepingCommand('action:chopTrees'), true);
    });

    test('while !goToBed runs, sleeping is progress (v0.1.4.7)', LIMIT, async () => {
        assert.equal(await sleepingCommand('action:goToBed'), false);
    });
});
