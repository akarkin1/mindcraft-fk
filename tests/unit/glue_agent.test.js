// Spec v0.1.4.6 G2, G3, G5 and G6 in agent.js and action_manager.js:
//   - shortenCommandResult and numberSetting (G2, settings of section 1);
//   - agent.last_order: set for a command that a player types or that answers a player, from the
//     time of the message; null again when the command ended and after !stop; not set by the
//     system or another bot (G3);
//   - the result of a command goes into the history shortened to max_command_result_chars (G2);
//   - the area store follows the world directory and exists only with its switches (G5);
//   - ActionManager.timedout is false again when an action starts (G6).
//
// Agent.prototype methods are called on fake agents made with Object.create(Agent.prototype).
// agent.js is imported with an empty temp directory as working directory.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

async function importQuietly() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        const index = await loadSrc('src/agent/commands/index.js');
        const actions = await loadSrc('src/agent/commands/actions.js');
        const agent = await loadSrc('src/agent/agent.js');
        const am = await loadSrc('src/agent/action_manager.js');
        return { settingsModule, index, actions, agent, am };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const M = await importQuietly();
const AS = await loadSrc('src/agent/areas/area_store.js');
const settings = M.settingsModule.default;
const BASE = { language: 'en', max_commands: -1, show_command_syntax: 'full', only_chat_with: [], max_command_result_chars: 0 };
M.settingsModule.setSettings({ ...BASE });

let cap;
beforeEach(() => {
    cap = captureConsole();
    M.settingsModule.setSettings({ ...BASE });
});
afterEach(() => {
    cap.restore();
});

describe('shortenCommandResult(text, max) (G2)', () => {
    const { shortenCommandResult } = M.agent;

    test('0, a negative or missing limit, a shorter text or not a string: unchanged', () => {
        const text = 'x'.repeat(5000);
        assert.equal(shortenCommandResult(text, 0), text);
        assert.equal(shortenCommandResult(text, -1), text);
        assert.equal(shortenCommandResult(text, undefined), text);
        assert.equal(shortenCommandResult('short', 3000), 'short');
        assert.equal(shortenCommandResult('x'.repeat(3000), 3000), 'x'.repeat(3000), 'exactly the limit');
        assert.equal(shortenCommandResult(undefined, 10), undefined);
        assert.deepEqual(shortenCommandResult({ a: 1 }, 1), { a: 1 });
    });

    test('longer: the first 70 and the last 20 percent of the limit, the line between them', () => {
        const text = 'A'.repeat(2000) + 'M'.repeat(3000) + 'Z'.repeat(1000);
        const out = shortenCommandResult(text, 3000);
        const head = text.slice(0, 2100);
        const tail = text.slice(text.length - 600);
        assert.equal(out, `${head}\n... (shortened, ${6000 - 2100 - 600} characters left out) ...\n${tail}`);
        assert.ok(out.includes('... (shortened, 3300 characters left out) ...'));
    });

    test('a small limit', () => {
        assert.equal(shortenCommandResult('abcdefghijklmnopqrst', 10), 'abcdefg\n... (shortened, 11 characters left out) ...\nst');
    });
});

describe('numberSetting(value, fallback)', () => {
    const { numberSetting } = M.agent;
    test('a finite number of 0 or more counts, anything else is the default', () => {
        assert.equal(numberSetting(0, 10), 0);
        assert.equal(numberSetting(2.5, 10), 2.5);
        assert.equal(numberSetting(3000, 0), 3000);
        for (const bad of [-1, NaN, Infinity, '3', null, undefined, true]) assert.equal(numberSetting(bad, 10), 10, String(bad));
    });
});

describe('handleMessage: last_order (G3) and the shortened result (G2)', () => {
    const { Agent } = M.agent;
    const LONG = 'L'.repeat(4000);

    // A fake agent; the command !modes is replaced by a recorder of agent.last_order.
    function makeAgent(replies = []) {
        const agent = Object.create(Agent.prototype);
        const turns = [];
        Object.assign(agent, {
            name: 'andy',
            shut_up: false,
            last_sender: null,
            last_order: null,
            task: { data: null },
            bot: { time: { timeOfDay: 13000 }, modes: { flushBehaviorLog: () => '' } },
            history: { turns, async add(name, content) { turns.push([name, content]); }, save() {}, getHistory: () => [] },
            self_prompter: { shouldInterrupt: () => false, isActive: () => false, handleUserPromptedCmd() {} },
            prompter: { async promptConvo() { return replies.length ? replies.shift() : ''; } },
            routed: [],
        });
        agent.routeResponse = (to, message) => agent.routed.push([to, message]);
        return agent;
    }

    let seen;
    let modes;
    let original;
    beforeEach(() => {
        seen = [];
        modes = M.index.getCommand('!modes');
        original = modes.perform;
        modes.perform = (agent) => {
            seen.push(agent.last_order === null ? null : { ...agent.last_order });
            return LONG;
        };
    });
    afterEach(() => {
        modes.perform = original;
    });

    test('a command typed by a player: the order during the command, null afterwards', async () => {
        const agent = makeAgent();
        const before = Date.now();
        await agent.handleMessage('bob', '!modes');
        assert.equal(seen.length, 1);
        assert.equal(seen[0].by, 'bob');
        assert.equal(seen[0].command, '!modes');
        assert.equal(seen[0].atTimeOfDay, 13000);
        assert.ok(seen[0].at >= before && seen[0].at <= Date.now());
        // v0.1.4.8 (part G): text is the whole command, typed marks an order typed in the chat
        assert.deepEqual(Object.keys(seen[0]).sort(), ['at', 'atTimeOfDay', 'by', 'command', 'text', 'typed']);
        assert.equal(seen[0].text, '!modes');
        assert.equal(seen[0].typed, true);
        assert.equal(agent.last_order, null);
    });

    test('a command that answers a player: the order with the time of the message', async () => {
        const agent = makeAgent(['Here they are. !modes', '']);
        await agent.handleMessage('bob', 'which modes do you have?');
        assert.equal(seen.length, 1);
        assert.equal(seen[0].by, 'bob');
        assert.equal(seen[0].command, '!modes');
        assert.equal(seen[0].text, '!modes');
        assert.equal(seen[0].typed, false, 'the model ran it (v0.1.4.8)');
        assert.equal(agent.last_order, null);
    });

    test('the system and the bot itself do not set it', async () => {
        for (const source of ['system', 'andy']) {
            const agent = makeAgent(['!modes', '']);
            await agent.handleMessage(source, 'go on', 2);
            assert.deepEqual(seen.pop(), null, source);
        }
    });

    test('a newer order is not cleared when an older command ends', async () => {
        const agent = makeAgent();
        modes.perform = (a) => {
            a.last_order = { by: 'eve', at: 1, atTimeOfDay: 1, command: '!followPlayer' }; // another message came in
            return 'ok';
        };
        await agent.handleMessage('bob', '!modes');
        assert.equal(agent.last_order.by, 'eve');
    });

    test('!stop sets it to null', async () => {
        const agent = {
            last_order: { by: 'bob', at: 1, atTimeOfDay: 1, command: '!collectBlocks' },
            actions: { async stop() {}, cancelResume() {} },
            clearBotLogs() {},
            bot: { emit() {} },
            self_prompter: { isActive: () => false },
        };
        assert.equal(await M.actions.actionsList.find((c) => c.name === '!stop').perform(agent), 'Agent stopped.');
        assert.equal(agent.last_order, null);
    });

    test('the result goes into the history shortened to max_command_result_chars; 0 keeps it whole', async () => {
        settings.max_command_result_chars = 3000;
        let agent = makeAgent(['!modes', '']);
        await agent.handleMessage('bob', 'modes?');
        const system = agent.history.turns.filter(([name]) => name === 'system').map(([, content]) => content);
        assert.equal(system.length, 1);
        assert.equal(system[0], M.agent.shortenCommandResult(LONG, 3000));
        assert.ok(system[0].includes('... (shortened, 1300 characters left out) ...'));

        settings.max_command_result_chars = 0;
        agent = makeAgent(['!modes', '']);
        await agent.handleMessage('bob', 'modes?');
        assert.deepEqual(agent.history.turns.filter(([name]) => name === 'system').map(([, c]) => c), [LONG]);

        settings.max_command_result_chars = -5; // not valid: the default 0
        agent = makeAgent(['!modes', '']);
        await agent.handleMessage('bob', 'modes?');
        assert.deepEqual(agent.history.turns.filter(([name]) => name === 'system').map(([, c]) => c), [LONG]);
    });

    test('a command typed by a player: the reply to the chat is not shortened', async () => {
        settings.max_command_result_chars = 100;
        const agent = makeAgent();
        await agent.handleMessage('bob', '!modes');
        assert.deepEqual(agent.routed.at(-1), ['bob', LONG]);
    });
});

describe('the area store of the current world (G5)', () => {
    const { Agent } = M.agent;
    let root;
    beforeEach(() => {
        root = makeTmpDir();
    });
    afterEach(() => {
        removeTmpDir(root);
    });

    const agentIn = (worldDir) => Object.assign(Object.create(Agent.prototype), { world_memory: { worldDir } });

    test('with protected_areas and world_memory: a store in <worldDir>/areas.json that follows the world', () => {
        M.settingsModule.setSettings({ ...BASE, protected_areas: true, world_memory: true });
        const a = path.join(root, 'a');
        const b = path.join(root, 'b');
        fs.mkdirSync(a);
        fs.mkdirSync(b);
        const agent = agentIn(null);
        assert.equal(agent._areaStore(), null, 'no store before the world is known');
        agent.world_memory.worldDir = a;
        const first = agent._areaStore();
        assert.ok(first instanceof AS.AreaStore);
        assert.equal(agent.area_store, first);
        assert.equal(agent._areaStore(), first, 'the same store while the world stays');
        first.set({ name: 'home', type: 'building', min: { x: 0, y: 60, z: 0 }, max: { x: 5, y: 65, z: 5 } });
        assert.ok(fs.existsSync(path.join(a, 'areas.json')));
        agent.world_memory.worldDir = b;
        const second = agent._areaStore();
        assert.notEqual(second, first, 'another world, another store');
        assert.equal(second.size, 0);
        agent.world_memory.worldDir = a;
        assert.equal(agent._areaStore().get('home').name, 'home', 'back in the first world, its areas are there');
    });

    test('without protected_areas or without world_memory: no store, no file', () => {
        for (const flags of [{ protected_areas: false, world_memory: true }, { protected_areas: true, world_memory: false }]) {
            M.settingsModule.setSettings({ ...BASE, ...flags });
            const agent = agentIn(root);
            assert.equal(agent._areaStore(), null);
            assert.equal(agent.area_store, undefined);
            const bot = {};
            Agent.prototype._startAreaGuard.call(Object.assign(agent, { bot }));
            assert.equal(bot.areaGuard, undefined, 'no guard');
        }
        assert.deepEqual(fs.readdirSync(root), []);
    });

    test('_startAreaGuard: installs bot.areaGuard, which reads the store of the current world', () => {
        M.settingsModule.setSettings({ ...BASE, protected_areas: true, world_memory: true });
        const agent = agentIn(root);
        agent.bot = { game: { dimension: 'overworld' }, dig: async () => 'dug', on() {}, once() {} };
        agent._startAreaGuard();
        assert.equal(typeof agent.bot.areaGuard?.canBreak, 'function');
        assert.equal(typeof agent.area_guard?.permit, 'function', 'the agent keeps the full guard (F2)');
        assert.equal(agent.bot.areaGuard.permit, undefined, 'bot.areaGuard has no permit (F2)');
        const block = { name: 'oak_planks', position: { x: 1, y: 61, z: 1 } };
        assert.equal(agent.bot.areaGuard.canBreak(block), true, 'no areas yet');
        agent._areaStore().set({ name: 'home', type: 'building', min: { x: 0, y: 60, z: 0 }, max: { x: 5, y: 65, z: 5 } });
        assert.equal(agent.bot.areaGuard.canBreak(block), false, 'the area saved later is guarded');
    });

    test('homeContext: what the home pack gets', () => {
        const agent = Object.assign(Object.create(Agent.prototype), { memory_bank: { recallPlaceInfo() {} }, area_store: { list: () => [] }, bot: { output: '' } });
        const ctx = agent.homeContext();
        // v0.1.4.8 (part G): say (C2) and whereAmI (I2), tested in stg_agent.test.js; v0.1.4.9: routes (I4), null
        // without routes_pack, tested in rtg_agent.test.js
        assert.deepEqual(Object.keys(ctx).sort(), ['areas', 'log', 'now', 'places', 'routes', 'say', 'settings', 'skills', 'whereAmI', 'world']);
        assert.equal(ctx.routes, null);
        assert.equal(ctx.areas, agent.area_store);
        assert.equal(ctx.places, agent.memory_bank);
        assert.equal(ctx.settings, settings);
        assert.equal(typeof ctx.skills.collectBlock, 'function');
        assert.equal(typeof ctx.world.getNearestBlock, 'function');
        ctx.log('Walking to the door.');
        assert.equal(agent.bot.output, 'Walking to the door.\n', 'progress goes into the action output');
        assert.ok(Math.abs(ctx.now() - Date.now()) < 1000);
        assert.equal(Object.assign(Object.create(Agent.prototype), { bot: {} }).homeContext().areas, null);
    });
});

describe('ActionManager.timedout is false again when an action starts (G6)', () => {
    test('after a timed out action, the next action reports timedout: false', async () => {
        const agent = {
            bot: { output: '', interrupt_code: false, emit() {} },
            clearBotLogs() { agent.bot.output = ''; agent.bot.interrupt_code = false; },
            requestInterrupt() { agent.bot.interrupt_code = true; },
            isIdle: () => !manager.executing,
            self_prompter: { isActive: () => false },
            history: { add() {} },
            cleanKill() {},
        };
        const manager = new M.am.ActionManager(agent);
        manager.timedout = true; // left over from an earlier action
        const result = await manager.runAction('action:test', async () => {
            assert.equal(manager.timedout, false, 'reset when the action starts');
        }, { timeout: -1 });
        assert.equal(result.timedout, false);
        assert.equal(result.success, true);
    });
});
