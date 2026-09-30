// Part G of v0.1.4.8 (E6): the wires in src/agent/agent.js.
//   - requestInterrupt(by): noteStop(by), bot.interrupt_code first, then the path search ends with
//     setGoal(null) (S9, I5);
//   - whereAmI() (I2), ctx.say and ctx.whereAmI on both contexts, foodItems on ctx.home (I7, C2);
//   - at spawn, in this order and each in its own try: moveOffhandBack, autoHome (its text is said), the
//     door service, the restart note (F3); at the exit: the exit file, the door service stops, the store
//     of placed blocks is written;
//   - the guard: installed also for protect_built_blocks alone, with the placed store of the world and
//     the order that the player typed (I3, D3, D4);
//   - the block "what you know" (I9) and say_results in the loop of the agent; last_order.text and typed.
// Agent.prototype methods are called on fake agents made with Object.create(Agent.prototype).
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld, vec } from '../helpers/block_world.js';

async function importQuietly() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        const index = await loadSrc('src/agent/commands/index.js');
        const agent = await loadSrc('src/agent/agent.js');
        return { settingsModule, index, agent };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const M = await importQuietly();
const { Agent, withRestartNote } = M.agent;
const HOME = await loadSrc('src/agent/packs/home/index.js');
const AS = await loadSrc('src/agent/areas/area_store.js');
const RC = await loadSrc('src/agent/restart_context.js');
const KT = await loadSrc('src/agent/knowledge/knowledge_text.js');
const WHERE = await loadSrc('src/agent/reflex/where_am_i.js');

const OFF = { language: 'en', world_memory: true, protected_areas: false, home_pack: false, storage_pack: false, farming_pack: false,
    wood_pack: false, mining_pack: false, protect_built_blocks: false, knowledge_in_prompt: false, restart_context: false,
    say_results: false, repeat_guard: 0, blocked_actions: [] };

let cap;
let dir;
let cwd;
beforeEach(() => {
    cap = captureConsole();
    dir = makeTmpDir();
    cwd = process.cwd();
    M.settingsModule.setSettings({ ...OFF });
});
afterEach(() => {
    process.chdir(cwd);
    cap.restore();
    removeTmpDir(dir);
});

const fakeAgent = (fields = {}) => Object.assign(Object.create(Agent.prototype), { name: 'andy', bot: { username: 'andy' }, ...fields });

describe('requestInterrupt(by) (I5, S9)', () => {
    function recordingBot(events, { failGoal = false } = {}) {
        const bot = {
            set interrupt_code(value) { events.push(`interrupt_code=${value}`); },
            stopDigging: () => events.push('stopDigging'),
            collectBlock: { cancelTask: () => events.push('cancelTask') },
            pathfinder: {
                stop: () => events.push('pathfinder.stop'),
                setGoal: (goal) => { events.push(`setGoal(${goal})`); if (failGoal) throw new Error('no path search'); },
            },
            pvp: { stop: () => events.push('pvp.stop') },
        };
        return bot;
    }

    test('who stops is noted first; interrupt_code before setGoal(null); stop() before setGoal(null)', () => {
        const events = [];
        const agent = fakeAgent({ bot: recordingBot(events), actions: { noteStop: (by) => events.push(`noteStop(${by})`) } });
        agent.requestInterrupt('!stop');
        assert.deepEqual(events, ['noteStop(!stop)', 'interrupt_code=true', 'pathfinder.stop', 'setGoal(null)', 'stopDigging', 'cancelTask', 'pvp.stop']);
    });

    test('without by, and with an action manager of v0.1.4.7 (no noteStop): it still interrupts', () => {
        const events = [];
        fakeAgent({ bot: recordingBot(events), actions: {} }).requestInterrupt();
        assert.deepEqual(events.slice(0, 3), ['interrupt_code=true', 'pathfinder.stop', 'setGoal(null)']);
    });

    test('a path search that throws on setGoal: the rest still runs', () => {
        const events = [];
        fakeAgent({ bot: recordingBot(events, { failGoal: true }), actions: { noteStop() {} } }).requestInterrupt('a new message');
        assert.deepEqual(events.slice(-3), ['stopDigging', 'cancelTask', 'pvp.stop']);
    });

    test('the real action manager: stop(by) reaches requestInterrupt and becomes stopped_by', async () => {
        const AM = await loadSrc('src/agent/action_manager.js');
        const agent = fakeAgent({ history: { add() {} }, self_prompter: { isActive: () => false }, cleanKill() {} });
        agent.bot = { output: '', interrupt_code: false, emit() {}, stopDigging() {}, collectBlock: { cancelTask() {} },
            pathfinder: { stop() {}, setGoal() {} }, pvp: { stop() {} } };
        agent.actions = new AM.ActionManager(agent);
        const run = agent.actions.runAction('action:mineOre', async () => {
            agent.bot.output += 'I dug 3 blocks.\n';
            while (!agent.bot.interrupt_code) await new Promise((r) => setTimeout(r, 5));
        });
        await new Promise((r) => setTimeout(r, 20));
        await agent.actions.stop('!stop');
        const result = await run;
        assert.equal(result.interrupted, true);
        assert.equal(result.stopped_by, '!stop');
        assert.match(result.message, /I dug 3 blocks\./);
    });
});

describe('whereAmI and the contexts (I2, C2, I7)', () => {
    test('whereAmI(): the function of reflex/where_am_i.js for the bot of the agent', () => {
        const world = createBlockWorld().flatGround(63);
        const bot = { entity: { position: vec(5.5, 64, 5.5) }, blockAt: (p) => world.blockAt(p), game: { minY: -64, height: 384 },
            areaGuard: { areaAt: () => ({ name: 'mine', type: 'mine' }) } };
        const agent = fakeAgent({ bot });
        assert.deepEqual(agent.whereAmI(), WHERE.whereAmI(bot));
        assert.deepEqual(agent.whereAmI().area, { name: 'mine', type: 'mine' });
        assert.equal(agent.whereAmI().underground, true, 'in a mine');
        assert.deepEqual(fakeAgent({ bot: {} }).whereAmI(), { area: null, depth: 0, underground: false });
    });

    test('ctx.whereAmI and ctx.say on the home context and on the pack context', () => {
        const agent = fakeAgent({ bot: { output: '' }, memory_bank: {}, whereAmI: () => ({ area: null, depth: 20, underground: true }) });
        for (const ctx of [agent.homeContext(), agent.packContext()]) {
            assert.equal(typeof ctx.say, 'function');
            assert.deepEqual(ctx.whereAmI(), { area: null, depth: 20, underground: true });
        }
    });

    test('ctx.say: the text into the history as the words of the bot and into the chat, without a call of the model', async () => {
        const turns = [];
        const chats = [];
        const agent = fakeAgent({ bot: { output: '' }, history: { add: async (name, text) => turns.push([name, text]) },
            openChat: async (text) => chats.push(text), prompter: { promptConvo() { throw new Error('no model'); } } });
        agent.homeContext().say('I am hungry and carry no food. Food 8 of 20.');
        assert.deepEqual(turns, [['andy', 'I am hungry and carry no food. Food 8 of 20.']]);
        assert.deepEqual(chats, ['I am hungry and carry no food. Food 8 of 20.']);
        agent.shut_up = true;
        agent.homeContext().say('Quiet.');
        assert.deepEqual(chats.length, 1, 'shut up: history only');
        assert.equal(turns.length, 2);
        agent.homeContext().say('');
        agent.homeContext().say(null);
        assert.equal(turns.length, 2, 'nothing for an empty text');
    });

    test('ctx.say never throws, also when the history and the chat fail', () => {
        const agent = fakeAgent({ bot: {}, history: { add() { throw new Error('a'); } }, openChat() { throw new Error('b'); } });
        assert.doesNotThrow(() => agent.homeContext().say('text'));
        const rejecting = fakeAgent({ bot: {}, history: { add: async () => { throw new Error('a'); } }, openChat: async () => { throw new Error('b'); } });
        assert.doesNotThrow(() => rejecting.homeContext().say('text'));
    });

    test('ctx.home has foodItems of the home pack (I7), beside the functions of v0.1.4.7', () => {
        const ctx = fakeAgent({ bot: {} }).packContext();
        assert.equal(ctx.home.foodItems, HOME.foodItems);
        assert.equal(ctx.home.passThrough, HOME.passThrough);
    });
});

describe('at spawn (part G, 6)', () => {
    function spawnAgent(log) {
        const world = createBlockWorld().flatGround(63);
        const house = world.house({ x: 0, y: 63, z: 0 });
        const slots = [];
        slots[45] = { name: 'bread', count: 3, slot: 45 };
        const bot = {
            username: 'andy', output: '', entity: { position: vec(house.inside.x + 0.5, house.inside.y, house.inside.z + 0.5) },
            game: { dimension: 'overworld' }, blockAt: (p) => world.blockAt(p), players: {}, entities: {},
            inventory: { slots, items: () => [], firstEmptyInventorySlot: () => 36 },
            moveSlotItem: async (from, to) => { log.push('offhand'); slots[to] = { ...slots[from], slot: to }; slots[from] = null; },
        };
        const store = new AS.AreaStore(path.join(dir, 'areas.json'));
        store.load();
        const agent = fakeAgent({
            bot, area_store: store, memory_bank: { home: { x: house.inside.x, y: house.inside.y, z: house.inside.z } },
            history: { add: async () => {} }, openChat: async (text) => log.push(`said: ${text}`),
        });
        agent._areaStore = () => { log.push('areas'); return store; };
        const homeContext = agent.homeContext.bind(agent);
        agent.homeContext = () => { log.push('doors'); return homeContext(); };
        return { agent, store, house };
    }

    test('every switch on: off-hand, house, doors, restart note, in this order', async () => {
        M.settingsModule.setSettings({ ...OFF, home_pack: true, protected_areas: true, restart_context: true });
        process.chdir(dir);
        assert.equal(RC.writeExit('./bots/andy', { reason: 'Got stuck and could not get unstuck', order: { by: 'bob', command: '!mineOre', text: '!mineOre("iron", 8)' }, position: { x: 8, y: 41, z: 48 } }), true);
        const log = [];
        const { agent, store } = spawnAgent(log);
        const note = await agent._atSpawn();
        assert.deepEqual(log.slice(0, 3), ['offhand', 'areas', log[2]]);
        assert.match(log[2], /^said: I saved your house as the area "home": \d+ x \d+ x \d+ blocks, 1 door\. Tell me if that is wrong\.$/);
        assert.equal(log[3], 'doors');
        assert.equal(store.get('home').type, 'home');
        assert.equal(typeof agent.door_service?.tick, 'function', 'the door service of the agent (I8)');
        assert.equal(note, 'Before the restart bob had ordered: !mineOre("iron", 8). The process ended because: Got stuck and could not get unstuck. You are at (8, 41, 48). Do not repeat the order by yourself. Tell the player what happened.');
        assert.equal(fs.existsSync(path.join(dir, 'bots', 'andy', 'last_exit.json')), false, 'readExit deleted the file');
        agent.door_service.stop();
    });

    test('every switch off: nothing happens, no note (v0.1.4.7)', async () => {
        process.chdir(dir);
        RC.writeExit('./bots/andy', { reason: 'x' });
        const log = [];
        const { agent } = spawnAgent(log);
        assert.equal(await agent._atSpawn(), '');
        assert.deepEqual(log, []);
        assert.equal(agent.door_service, undefined);
        assert.equal(fs.existsSync(path.join(dir, 'bots', 'andy', 'last_exit.json')), true, 'the file is not read');
    });

    test('one failing step does not stop the others; each gives a warning', async () => {
        M.settingsModule.setSettings({ ...OFF, home_pack: true, protected_areas: true, restart_context: true });
        process.chdir(dir);
        RC.writeExit('./bots/andy', { reason: 'The world was closed' });
        const log = [];
        const { agent } = spawnAgent(log);
        agent.bot.moveSlotItem = async () => { throw new Error('no window'); };
        agent._areaStore = () => { throw new Error('the areas are broken'); };
        agent.homeContext = () => { throw new Error('the context is broken'); };
        const note = await agent._atSpawn();
        assert.equal(note, 'The process ended because: The world was closed. Tell the player what happened.');
        assert.equal(agent.door_service, null, 'no door service, null so the mode does not make one');
        const warnings = cap.of('warn').map((r) => r.text).join('\n');
        assert.match(warnings, /Could not save the house as the area "home"/);
        assert.match(warnings, /Could not start the door service/);
    });

    test('the restart note goes into the init message', () => {
        assert.equal(withRestartNote('Respond with hello world and your name', 'Before the restart ...'), 'Respond with hello world and your name\nBefore the restart ...');
        assert.equal(withRestartNote('', 'Note.'), 'Note.');
        assert.equal(withRestartNote(null, 'Note.'), 'Note.');
        assert.equal(withRestartNote('Hello', ''), 'Hello');
        assert.equal(withRestartNote(null, ''), null);
        const text = fs.readFileSync(repoPath('src/agent/agent.js'), 'utf8');
        assert.ok(text.includes('const restart_note = await this._atSpawn();'));
        assert.ok(text.includes('this._setupEventHandlers(save_data, withRestartNote(init_message, restart_note));'));
        assert.ok(text.indexOf('this._workStores(); // the chest index') < text.indexOf('await this._atSpawn()'), 'after the stores of the world');
    });
});

describe('at the exit (F3, D4, I8)', () => {
    test('with restart_context: the exit file with the order, the action and the position; the door service stops; the placed blocks are written', () => {
        M.settingsModule.setSettings({ ...OFF, restart_context: true });
        process.chdir(dir);
        const events = [];
        const agent = fakeAgent({
            bot: { entity: { position: { x: 8.5, y: 41, z: 48.3 } } },
            last_order: { by: 'bob', command: '!mineOre', text: '!mineOre("iron", 8)', typed: false },
            actions: { currentActionLabel: 'mode:unstuck' },
            door_service: { stop: () => events.push('doors stop') },
            _placed: { dir: 'w', store: { flush: () => events.push('placed flush') } },
        });
        agent._atExit("Got stuck and couldn't get unstuck");
        assert.deepEqual(events, ['doors stop', 'placed flush']);
        const exit = RC.readExit('./bots/andy');
        assert.equal(exit.reason, "Got stuck and couldn't get unstuck");
        assert.deepEqual(exit.order, { by: 'bob', command: '!mineOre("iron", 8)' });
        assert.equal(exit.action, 'the reflex unstuck');
        assert.deepEqual(exit.position, { x: 8, y: 41, z: 48 });
    });

    test('without restart_context: no file; the rest still runs', () => {
        process.chdir(dir);
        const events = [];
        fakeAgent({ door_service: { stop: () => events.push('doors stop') } })._atExit('bye');
        assert.equal(fs.existsSync(path.join(dir, 'bots')), false);
        assert.deepEqual(events, ['doors stop']);
    });

    test('cleanKill runs it before the exit; a failing door service does not stop the exit', () => {
        M.settingsModule.setSettings({ ...OFF, restart_context: true });
        process.chdir(dir);
        const exits = [];
        const realExit = process.exit;
        process.exit = (code) => exits.push(code);
        try {
            const agent = fakeAgent({ history: { add() {}, save() {} }, bot: { chat() {} }, door_service: { stop() { throw new Error('boom'); } },
                actions: { currentActionLabel: 'action:chopTrees' } });
            agent.cleanKill('Killing agent process...', 1);
        } finally {
            process.exit = realExit;
        }
        assert.deepEqual(exits, [1]);
        assert.equal(RC.readExit('./bots/andy').action, '!chopTrees');
    });
});

describe('the guard (I3, D3, D4)', () => {
    function guardBot() {
        return { game: { dimension: 'overworld' }, dig: async () => 'dug', placeBlock: async () => 'placed', on() {}, once() {},
            blockAt: (p) => ({ name: 'oak_fence', position: p }) };
    }

    test('protect_built_blocks alone installs the guard: a fence outside every area is refused', () => {
        M.settingsModule.setSettings({ ...OFF, protect_built_blocks: true, protected_areas: false });
        const agent = fakeAgent({ bot: guardBot(), world_memory: { worldDir: dir }, running_commands: [{ name: '!collectBlocks', text: '!collectBlocks("oak_fence", 20)', typed: false }] });
        agent._startAreaGuard();
        assert.equal(typeof agent.bot.areaGuard?.refusal, 'function');
        const refusal = agent.bot.areaGuard.refusal({ x: 1, y: 64, z: 1 }, 'break', { name: 'oak_fence' });
        assert.equal(refusal?.reason, 'built_block');
        assert.equal(refusal.text, 'oak_fence is a block that players build with. I do not break it. The player can type the command !collectBlocks("oak_fence", 20) in the chat to do it.');
    });

    test('an order that the player typed and whose action runs opens it (setPlayerOrder); an order the model answered does not', () => {
        M.settingsModule.setSettings({ ...OFF, protect_built_blocks: true });
        const agent = fakeAgent({ bot: guardBot(), world_memory: { worldDir: dir }, actions: { executing: true, currentActionLabel: 'action:collectBlocks' } });
        agent._startAreaGuard();
        const refused = () => agent.bot.areaGuard.refusal({ x: 1, y: 64, z: 1 }, 'break', { name: 'oak_fence' });
        agent.last_order = { by: 'bob', command: '!collectBlocks', text: '!collectBlocks("oak_fence", 20)', typed: true };
        assert.equal(refused(), null);
        agent.last_order = { ...agent.last_order, typed: false };
        assert.equal(refused()?.reason, 'built_block');
        agent.last_order = { by: 'bob', command: '!collectBlocks', typed: true };
        agent.actions = { executing: true, currentActionLabel: 'mode:unstuck' };
        assert.equal(refused()?.reason, 'built_block', 'a reflex runs, not the order');
    });

    test('the switch off: the fence is no built block for the guard of the areas; neither switch: no guard (v0.1.4.7)', () => {
        M.settingsModule.setSettings({ ...OFF, protected_areas: true, world_memory: true });
        const agent = fakeAgent({ bot: guardBot(), world_memory: { worldDir: dir } });
        agent._startAreaGuard();
        assert.equal(agent.bot.areaGuard.refusal({ x: 1, y: 64, z: 1 }, 'break', { name: 'oak_fence' }), null);
        M.settingsModule.setSettings({ ...OFF });
        const none = fakeAgent({ bot: guardBot() });
        none._startAreaGuard();
        assert.equal(none.bot.areaGuard, undefined);
        assert.equal(none.area_guard, undefined);
    });

    test('_placedStore: one per world in <world>/placed.json, in memory without world_memory, null before the world is known', () => {
        const agent = fakeAgent({ world_memory: { worldDir: null } });
        assert.equal(agent._placedStore(), null);
        agent.world_memory.worldDir = path.join(dir, 'w1');
        fs.mkdirSync(agent.world_memory.worldDir);
        const first = agent._placedStore();
        assert.equal(first.filePath, `${agent.world_memory.worldDir}/placed.json`);
        assert.equal(agent._placedStore(), first, 'the same store for the same world');
        first.add({ x: 1, y: 2, z: 3 }, 'overworld');
        agent.world_memory.worldDir = path.join(dir, 'w2');
        fs.mkdirSync(agent.world_memory.worldDir);
        const second = agent._placedStore();
        assert.notEqual(second, first);
        assert.ok(fs.existsSync(path.join(dir, 'w1', 'placed.json')), 'the store of the world that is left was written');
        M.settingsModule.setSettings({ ...OFF, world_memory: false });
        const memory = fakeAgent({})._placedStore();
        assert.equal(memory.filePath, null);
    });
});

describe('the block "what you know" (I9, C1)', () => {
    function knowingAgent() {
        return fakeAgent({
            bot: { entity: { position: vec(10.5, 64, 50.5) }, game: { dimension: 'overworld' } },
            _workStores: () => ({ chests: { list: (d) => (d === 'overworld' ? [{ x: 11, y: 67, z: 53, items: { wheat: 28, cobblestone: 81 } }] : []) }, mines: null }),
            area_store: { list: () => [{ name: 'farm', type: 'farm', dimension: 'overworld', entrances: [{ kind: 'gate' }] }, { name: 'nether_base', type: 'building', dimension: 'the_nether' }] },
            memory_bank: { getJson: () => ({ home: [12, 67, 52] }) },
            whereAmI: () => ({ area: null, depth: 0, underground: false }),
        });
    }

    test('off: nothing', () => {
        assert.equal(knowingAgent().knowledgeBlock(), '');
    });

    test('on: knowledgeText of the chests and areas of this dimension, the places and where the bot is, word for word', () => {
        M.settingsModule.setSettings({ ...OFF, knowledge_in_prompt: true });
        const text = knowingAgent().knowledgeBlock();
        assert.equal(text, [
            'WHAT YOU KNOW (from memory, no need to check):',
            'You are on the surface.',
            'Chest (11, 67, 53): cobblestone 81, wheat 28.',
            'Areas: farm (farm, 1 gate).',
            'Places: home (12, 67, 52).',
        ].join('\n'));
        assert.equal(text, KT.knowledgeText({ chests: [{ x: 11, y: 67, z: 53, items: { wheat: 28, cobblestone: 81 } }],
            areas: [{ name: 'farm', type: 'farm', dimension: 'overworld', entrances: [{ kind: 'gate' }] }], mines: [],
            places: { home: [12, 67, 52] }, where: { area: null, depth: 0, underground: false, pos: { x: 10.5, y: 64, z: 50.5 } } }, 600));
    });

    test('knowledge_max_chars is the limit; a broken store gives a warning and nothing', () => {
        M.settingsModule.setSettings({ ...OFF, knowledge_in_prompt: true, knowledge_max_chars: 80 });
        const text = knowingAgent().knowledgeBlock();
        assert.ok(text.length <= 80, text);
        assert.ok(text.startsWith('WHAT YOU KNOW'));
        const broken = knowingAgent();
        broken._workStores = () => { throw new Error('broken'); };
        assert.equal(broken.knowledgeBlock(), '');
        assert.equal(fakeAgent({ bot: {} }).knowledgeBlock(), '', 'no position yet');
    });
});

describe('handleMessage: the orders, say_results (part G, 7 and 11)', () => {
    function loopAgent(replies, { storage = true } = {}) {
        const agent = Object.create(Agent.prototype);
        const turns = [];
        Object.assign(agent, {
            name: 'andy', shut_up: false, last_sender: null, last_order: null, task: { data: null },
            bot: { time: { timeOfDay: 1000 }, modes: { flushBehaviorLog: () => '', pause() {} }, output: '', interrupt_code: false },
            history: { turns, async add(name, content) { turns.push([name, content]); }, save() {}, getHistory: () => [] },
            self_prompter: { shouldInterrupt: () => false, isActive: () => false, handleUserPromptedCmd() {} },
            prompter: { async promptConvo() { return replies.length ? replies.shift() : ''; } },
            actions: { async runAction(label, fn) { await fn(); return { success: true, message: 'Action output:\n', interrupted: false, timedout: false }; } },
            work_packs: storage ? { storage: { storeItems: async () => ({ ok: true, text: 'I stored 12 wheat in the chest at (11, 67, 53).' }) } } : {},
            packContext: () => ({}),
            routed: [],
            orders: [],
        });
        agent.routeResponse = (to, message) => agent.routed.push([to, message]);
        return agent;
    }

    test('with say_results: the model answers nothing (or a tab) after a pack command, its text goes to the chat', async () => {
        for (const empty of ['', '\t']) {
            M.settingsModule.setSettings({ ...OFF, storage_pack: true, say_results: true, show_command_syntax: 'none', max_commands: -1, only_chat_with: [] });
            const agent = loopAgent(['!storeItems', empty]);
            await agent.handleMessage('bob', 'put it in the chest');
            assert.deepEqual(agent.routed, [['bob', 'I stored 12 wheat in the chest at (11, 67, 53).']], JSON.stringify(empty));
        }
    });

    test('without say_results, or when the model says something, or after a command that is no pack: nothing more', async () => {
        M.settingsModule.setSettings({ ...OFF, storage_pack: true, say_results: false, show_command_syntax: 'none', max_commands: -1, only_chat_with: [] });
        const off = loopAgent(['!storeItems', '']);
        await off.handleMessage('bob', 'put it in the chest');
        assert.deepEqual(off.routed, []);
        M.settingsModule.setSettings({ ...OFF, storage_pack: true, say_results: true, show_command_syntax: 'none', max_commands: -1, only_chat_with: [] });
        const talks = loopAgent(['!storeItems', 'Stored the wheat.']);
        await talks.handleMessage('bob', 'put it in the chest');
        assert.deepEqual(talks.routed, [['bob', 'Stored the wheat.']]);
        const noPack = loopAgent(['!cost', '']);
        noPack.cost_meter = { summaryText: () => 'Cost: session $0.10.' };
        await noPack.handleMessage('bob', 'what did you cost?');
        assert.deepEqual(noPack.routed, [], 'a query is no pack command');
    });

    test('last_order of a typed command: text and typed; of a command of the model: typed false', async () => {
        M.settingsModule.setSettings({ ...OFF, storage_pack: true, show_command_syntax: 'none', max_commands: -1, only_chat_with: [] });
        const seen = [];
        const typed = loopAgent([]);
        typed.work_packs.storage.storeItems = async () => { seen.push({ ...typed.last_order }); return { ok: true, text: 'done' }; };
        await typed.handleMessage('bob', '!storeItems');
        assert.equal(seen[0].text, '!storeItems');
        assert.equal(seen[0].typed, true);
        assert.equal(typed.last_order, null);
        const answered = loopAgent(['Sure. !storeItems', '']);
        answered.work_packs.storage.storeItems = async () => { seen.push({ ...answered.last_order }); return { ok: true, text: 'done' }; };
        await answered.handleMessage('bob', 'store your stuff');
        assert.equal(seen[1].text, '!storeItems');
        assert.equal(seen[1].typed, false);
    });
});

describe('the start of the agent (source): the new parts behind their switches', () => {
    const text = fs.readFileSync(repoPath('src/agent/agent.js'), 'utf8').replace(/\r\n/g, '\n');

    test('!closeDoor is hidden without the home pack', () => {
        assert.ok(text.includes("this.blocked_actions.push('!goToShelter', '!eat', '!closeDoor');"));
    });

    test('the repeat guard exists only with repeat_guard above 0', () => {
        assert.match(text, /if \(numberSetting\(settings\.repeat_guard, 0\) > 0\) \{\n\s+try \{\n\s+this\.repeat_guard = new RepeatGuard\(\{ limit: settings\.repeat_guard \}\);/);
    });

    test('the guard is started for the areas or for protect_built_blocks', () => {
        assert.ok(text.includes('if (areas_on || settings.protect_built_blocks)\n            this._startAreaGuard();'));
    });

    test('the handler of a disconnect writes the exit before it ends the process', () => {
        const at = text.indexOf("console.log(`Agent process ends with exit code 1: ${msg}`);\n            this._atExit(msg);");
        assert.ok(at > 0 && at < text.indexOf('process.exit(1);\n        };'));
    });
});
