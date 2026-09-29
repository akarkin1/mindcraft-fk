// T1 round 2, spec v0.1.4.8 section 11, items 4 to 7, and the parts "For part G" of the handoff:
//   item 6 at spawn, in this order, each in its own try: moveOffhandBack; autoHome (with protected_areas, its
//          text is said); the door service; readExit and the restart note (with restart_context), which goes
//          into the init message; a step that throws or hangs does not stop the next;
//   item 7 cleanKill writes the exit file (with restart_context), onDisconnect too; the next start tells the
//          model the note of F3 word for word; off: no file (v0.1.4.7);
//   item 4 requestInterrupt(by): who stops is noted, bot.interrupt_code first, then setGoal(null) (S9);
//   item 5 whereAmI() on the agent and ctx.whereAmI on both contexts; ctx.say: chat and history, no model;
//   I9 knowledgeBlock(); last_order.text and typed (handoff F for G, item 2).
// The real Agent prototype on fake fields (tests/helpers/st_glue_env.js); process.exit is replaced while
// cleanKill runs.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Vec3 } from 'vec3';
import * as espree from 'espree';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { patchFs } from '../helpers/fs_patch.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { loadGlue, makeGlueAgent, makeFakeBot, settle } from '../helpers/st_glue_env.js';

const G = await loadGlue();
await import('ses');
const AS = await loadSrc('src/agent/areas/area_store.js');
const RC = await loadSrc('src/agent/restart_context.js');
const WHERE = await loadSrc('src/agent/reflex/where_am_i.js');

const LIMIT = { timeout: 30000 };
const BASE = { language: 'en', blocked_actions: [], max_commands: -1, show_command_syntax: 'full', world_memory: true, protected_areas: false,
    home_pack: false, storage_pack: false, farming_pack: false, wood_pack: false, mining_pack: false, restart_context: false,
    knowledge_in_prompt: false, knowledge_max_chars: 600, narrate_behavior: false };
const NOTE = 'Before the restart MartyByrde2 had ordered: !mineOre("iron", 8). The process ended because: Got stuck and couldn\'t get unstuck. You are at (8, 41, 48). Do not repeat the order by yourself. Tell the player what happened.';

let cap;
let dir;
let cwd;
beforeEach(() => {
    cap = captureConsole();
    dir = makeTmpDir();
    cwd = process.cwd();
    process.chdir(dir); // the exit file is ./bots/<name>/last_exit.json
    G.settingsModule.setSettings({ ...BASE });
});
afterEach(() => {
    process.chdir(cwd);
    cap.restore();
    removeTmpDir(dir);
});

const set = (extra) => G.settingsModule.setSettings({ ...BASE, ...extra });
const exitFile = () => path.join(dir, 'bots', 'andy', 'last_exit.json');

// A house around the place "home" at (12, 67, 52), flat ground at 66.
function houseWorld() {
    const w = createBlockWorld().flatGround(66);
    w.house({ x: 8, y: 66, z: 47, width: 9, depth: 11 });
    return w;
}

// runs cleanKill of the agent with process.exit replaced
function cleanKill(agent, msg, code = 1) {
    const exit = process.exit;
    let exitCode = null;
    process.exit = (c) => { exitCode = c; };
    try {
        delete agent.cleanKill; // the method of the prototype
        agent.cleanKill(msg, code);
    } finally {
        process.exit = exit;
    }
    return exitCode;
}

// ------------------------------------------------------------------------------------ item 6

describe('item 6: at spawn', () => {
    function spawnAgent(order) {
        set({ home_pack: true, protected_areas: true, restart_context: true });
        const bot = makeFakeBot({ world: houseWorld(), pos: [12.5, 67, 52.5] });
        bot.inventory.put('bread', 6, 45);
        const move = bot.moveSlotItem;
        bot.moveSlotItem = async (from, to) => { order.push('offhand'); return move(from, to); };
        const store = new AS.AreaStore(path.join(dir, 'areas.json'));
        const agent = makeGlueAgent(G, { bot, fields: { memory_bank: { recall: (n) => (n === 'home' ? { x: 12.5, y: 67, z: 52.5, dimension: 'overworld' } : null) } } });
        agent._areaStore = () => { order.push('autoHome'); return store; };
        const home = agent.homeContext.bind(agent);
        agent.homeContext = () => { order.push('doors'); return home(); };
        return { agent, bot, store };
    }

    test('the four steps in the order of the spec; the note of the restart is returned', LIMIT, async () => {
        const order = [];
        const { agent, bot, store } = spawnAgent(order);
        RC.writeExit(path.join('bots', 'andy'), { reason: "Got stuck and couldn't get unstuck", order: { by: 'MartyByrde2', command: '!mineOre', text: '!mineOre("iron", 8)' },
            position: { x: 8.51, y: 41, z: 48.37 }, time: Date.now() });
        const restore = patchFs('rmSync', (rm) => (...a) => { if (String(a[0]).includes('last_exit.json')) order.push('restart'); return rm(...a); });
        let note;
        try {
            note = await agent._atSpawn();
        } finally {
            restore();
        }
        assert.deepEqual(order.filter((s, i) => order.indexOf(s) === i), ['offhand', 'autoHome', 'doors', 'restart']);
        assert.equal(bot.inventory.slots[45], null, 'the bread left the off-hand');
        assert.equal(store.get('home')?.type, 'home', 'the house is the area "home"');
        assert.equal(typeof agent.door_service?.tick, 'function', 'the door service');
        assert.equal(note, NOTE);
        assert.equal(fs.existsSync(exitFile()), false, 'the file is deleted');
    });

    test('the text of autoHome is said: into the chat and into the history, no call of the model', LIMIT, async () => {
        const { agent } = spawnAgent([]);
        await agent._atSpawn();
        const said = agent.chats.find((c) => c.startsWith('I saved your house as the area "home"'));
        assert.ok(said, JSON.stringify(agent.chats));
        assert.ok(agent.turns.some(([n, t]) => n === 'andy' && t === said));
        assert.equal(agent.prompter.calls, 0);
    });

    test('the note goes into the init message', () => {
        assert.equal(G.agentModule.withRestartNote('Say hello.', NOTE), `Say hello.\n${NOTE}`);
        assert.equal(G.agentModule.withRestartNote(null, NOTE), NOTE);
        assert.equal(G.agentModule.withRestartNote('Say hello.', ''), 'Say hello.', 'no note: the init message of v0.1.4.7');
    });

    test('a step that throws does not stop the next ones', LIMIT, async () => {
        const order = [];
        const { agent } = spawnAgent(order);
        RC.writeExit(path.join('bots', 'andy'), { reason: "Got stuck and couldn't get unstuck", order: { by: 'MartyByrde2', text: '!mineOre("iron", 8)' },
            position: { x: 8.51, y: 41, z: 48.37 }, time: Date.now() });
        agent._areaStore = () => { throw new Error('the areas file is broken'); };
        agent.homeContext = () => { throw new Error('no context'); };
        agent.bot.moveSlotItem = async () => { throw new Error('the server said no'); };
        const note = await agent._atSpawn();
        assert.equal(note, NOTE, 'the last step still runs');
    });

    test('a move out of the off-hand that the server never answers: the start goes on', { timeout: 20000 }, async () => {
        const { agent } = spawnAgent([]);
        agent.bot.moveSlotItem = () => new Promise(() => {});
        const t0 = Date.now();
        await agent._atSpawn();
        assert.ok(Date.now() - t0 < 10000, `${Date.now() - t0} ms`);
        assert.equal(typeof agent.door_service?.tick, 'function', 'the door service still starts');
    });

    test('every switch off: nothing happens at spawn (v0.1.4.7)', LIMIT, async () => {
        const order = [];
        const { agent, bot, store } = spawnAgent(order);
        set({});
        RC.writeExit(path.join('bots', 'andy'), { reason: 'x', time: Date.now() });
        const note = await agent._atSpawn();
        assert.equal(note, '');
        assert.deepEqual(order, []);
        assert.equal(bot.inventory.slots[45]?.name, 'bread');
        assert.equal(store.size, 0);
        assert.equal(agent.door_service, undefined);
        assert.equal(fs.existsSync(exitFile()), true, 'the file is not read');
    });
});

// ------------------------------------------------------------------------------------ item 7

describe('item 7: the exit file', () => {
    test('cleanKill with restart_context: the file with the reason, the order, the action and the position; the next start tells the model', LIMIT, async () => {
        set({ restart_context: true });
        const bot = makeFakeBot({ pos: [8.51, 41, 48.37] });
        const agent = makeGlueAgent(G, { bot });
        agent.last_order = { by: 'MartyByrde2', command: '!mineOre', text: '!mineOre("iron", 8)', typed: false };
        agent.actions.currentActionLabel = 'action:mineOre';
        assert.equal(cleanKill(agent, "Got stuck and couldn't get unstuck"), 1);
        const data = JSON.parse(fs.readFileSync(exitFile(), 'utf8'));
        assert.equal(data.reason, "Got stuck and couldn't get unstuck");
        assert.deepEqual(data.position, { x: 8, y: 41, z: 48 });
        assert.equal(data.action, '!mineOre');
        const next = makeGlueAgent(G);
        assert.equal(await next._atSpawn(), NOTE);
    });

    test('cleanKill without restart_context: no file (v0.1.4.7)', LIMIT, () => {
        const agent = makeGlueAgent(G);
        agent.last_order = { by: 'MartyByrde2', command: '!mineOre', text: '!mineOre("iron", 8)' };
        cleanKill(agent, "Got stuck and couldn't get unstuck");
        assert.equal(fs.existsSync(exitFile()), false);
    });

    test('cleanKill stops the door service', LIMIT, () => {
        const agent = makeGlueAgent(G);
        let stopped = 0;
        agent.door_service = { tick() {}, stop() { stopped++; } };
        cleanKill(agent, 'bye');
        assert.equal(stopped, 1);
    });

    test('onDisconnect writes the exit file before the process exits', () => {
        const source = fs.readFileSync(repoPath('src/agent/agent.js'), 'utf8');
        const tree = espree.parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true });
        let body = null;
        const visit = (node) => {
            if (!node || typeof node.type !== 'string' || body) return;
            if (node.type === 'VariableDeclarator' && node.id?.name === 'onDisconnect') body = source.slice(...node.init.range);
            for (const [key, value] of Object.entries(node)) {
                if (key === 'range') continue;
                if (Array.isArray(value)) value.forEach(visit);
                else if (value && typeof value.type === 'string') visit(value);
            }
        };
        visit(tree);
        assert.ok(body, 'onDisconnect');
        const atExit = body.indexOf('this._atExit(');
        assert.ok(atExit > 0 && atExit < body.indexOf('process.exit('), body);
    });
});

// ------------------------------------------------------------------------------ items 4 and 5

describe('item 4: requestInterrupt(by)', () => {
    test('who stops is noted; bot.interrupt_code is set before setGoal(null); the path search ends', () => {
        const events = [];
        const agent = makeGlueAgent(G);
        const bot = agent.bot;
        let code = false;
        Object.defineProperty(bot, 'interrupt_code', { get: () => code, set: (v) => { code = v; events.push(`interrupt_code=${v}`); }, configurable: true });
        bot.pathfinder.setGoal = (goal) => events.push(`setGoal(${goal})`);
        agent.actions.noteStop = (by) => events.push(`noteStop(${by})`);
        agent.requestInterrupt('!stop');
        assert.ok(events.indexOf('noteStop(!stop)') >= 0, JSON.stringify(events));
        assert.ok(events.indexOf('interrupt_code=true') < events.indexOf('setGoal(null)'), JSON.stringify(events));
    });

    test('!stop: the running walk ends within 1 s and reports !stop, no kill (S9, W34)', LIMIT, async () => {
        const agent = makeGlueAgent(G);
        agent.bot.gotoImpl = () => new Promise(() => {});
        const running = G.index.executeCommand(agent, '!goToCoordinates(500, 64, 500, 1)', { typed: false });
        await new Promise((r) => setTimeout(r, 100));
        const t0 = Date.now();
        await G.index.executeCommand(agent, '!stop', { typed: true });
        await running;
        assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
        assert.deepEqual(agent.kills, []);
        assert.ok(agent.turns.some(([n, t]) => n === 'system' && t.startsWith('Command !goToCoordinates was stopped by !stop.')));
    });
});

describe('item 5: where the bot is and the contexts', () => {
    test('agent.whereAmI() is whereAmI of reflex/where_am_i.js for the bot', () => {
        const w = createBlockWorld().flatGround(66);
        const bot = makeFakeBot({ world: w, pos: [0.5, 41, 0.5] });
        const agent = makeGlueAgent(G, { bot });
        assert.deepEqual(agent.whereAmI(), WHERE.whereAmI(bot));
        assert.equal(agent.whereAmI().underground, true);
    });

    test('ctx.whereAmI and ctx.say on the home context and on the pack context', () => {
        const agent = makeGlueAgent(G);
        agent.whereAmI = () => ({ area: null, depth: 20, underground: true });
        for (const ctx of [agent.homeContext(), agent.packContext()]) {
            assert.deepEqual(ctx.whereAmI(), { area: null, depth: 20, underground: true });
            assert.equal(typeof ctx.say, 'function');
        }
        assert.equal(typeof agent.packContext().home.foodItems, 'function', 'foodItems on ctx.home (I7)');
    });

    test('ctx.say: into the chat and into the history as the words of the bot, without a call of the model', async () => {
        const agent = makeGlueAgent(G);
        agent.homeContext().say('I am hungry and carry no food. Food 6 of 20.');
        await new Promise((r) => setTimeout(r, 10));
        assert.deepEqual(agent.chats, ['I am hungry and carry no food. Food 6 of 20.']);
        assert.deepEqual(agent.turns, [['andy', 'I am hungry and carry no food. Food 6 of 20.']]);
        assert.equal(agent.prompter.calls, 0);
    });

    test('!eat gets the pack context with the storage pack: the text names a chest with food (C1)', LIMIT, async () => {
        set({ home_pack: true, storage_pack: true });
        const agent = makeGlueAgent(G, { fields: { work_packs: { storage: {} } } });
        agent.bot.food = 6;
        agent._workStores = () => ({ chests: { list: () => [{ x: 11, y: 67, z: 53, dimension: 'overworld', items: { apple: 5 } }] }, mines: null });
        const r = await G.index.executeCommand(agent, '!eat', { typed: false });
        assert.equal(r, 'I carry no food. The chest at (11, 67, 53) has 5 apple.');
    });
});

describe('I9: knowledgeBlock of the agent', () => {
    test('with knowledge_in_prompt: where the bot is, the chests, the areas and the mines of this world', () => {
        set({ knowledge_in_prompt: true, knowledge_max_chars: 600 });
        const agent = makeGlueAgent(G, { bot: makeFakeBot({ pos: [11.5, 67, 52.5] }) });
        agent.area_store = { list: () => [{ name: 'farm', type: 'farm', entrances: [{ kind: 'gate' }], dimension: 'overworld' }] };
        agent._workStores = () => ({ chests: { list: () => [{ x: 11, y: 67, z: 53, items: { wheat: 28 } }] },
            mines: { list: () => [{ ore: 'iron', entrance: { x: 9, y: 67, z: 58 }, level: 16 }] } });
        agent.whereAmI = () => ({ area: { name: 'farm', type: 'farm' }, depth: 0, underground: false });
        assert.equal(agent.knowledgeBlock(), [
            'WHAT YOU KNOW (from memory, no need to check):',
            'You are in the area "farm" (farm), on the surface.',
            'Chest (11, 67, 53): wheat 28.',
            'Areas: farm (farm, 1 gate).',
            'Mines: iron, entrance (9, 67, 58), level 16.',
        ].join('\n'));
    });

    test('without knowledge_in_prompt: empty', () => {
        const agent = makeGlueAgent(G);
        agent._workStores = () => { throw new Error('must not be read'); };
        assert.equal(agent.knowledgeBlock(), '');
    });
});

describe('the order of the player: last_order.text and typed (handoff F for G, item 2)', () => {
    test('typed in the chat: typed true and the full text of the command while it runs; null after it', LIMIT, async () => {
        set({ mining_pack: true });
        const seen = [];
        const agent = makeGlueAgent(G);
        agent.work_packs = { mining: { async mineOre() { seen.push({ ...agent.last_order }); return { ok: false, reason: 'ask', text: 'I know no mine for iron.' }; } } };
        await agent.handleMessage('MartyByrde2', '!mineOre("iron", 8)');
        await settle(agent);
        assert.equal(seen[0].typed, true);
        assert.equal(seen[0].by, 'MartyByrde2');
        assert.match(seen[0].text, /^!mineOre\("iron", 8/);
        assert.equal(agent.last_order, null);
    });

    test('the answer of the model to a player: typed false', LIMIT, async () => {
        set({ mining_pack: true });
        const seen = [];
        const agent = makeGlueAgent(G, { replies: ['!mineOre("iron", 8)', ''] });
        agent.work_packs = { mining: { async mineOre() { seen.push({ ...agent.last_order }); return { ok: false, reason: 'ask', text: 'I know no mine for iron.' }; } } };
        await agent.handleMessage('MartyByrde2', 'get me iron');
        assert.equal(seen[0].typed, false);
        assert.match(seen[0].text, /^!mineOre\("iron", 8/);
    });
});
