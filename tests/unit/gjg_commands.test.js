// Part G of v0.1.4.10 (E5): the commands in src/agent/commands/actions.js and the hooks of the job in
// executeCommand (src/agent/commands/index.js).
//   - !mines and !forgetMine (R4) with mining_pack: plain commands (no action) that call minesText(ctx, dimension)
//     and forgetMine(ctx, name) of the mining pack with the pack context; the texts of the real pack word for
//     word; mining_pack off: the off text, no pack touched;
//   - !rememberRule (R2): a saved rule that keeps the bot out of a saved area sets its flag no_enter
//     (areaFlagOf, AreaStore.setFlag) and says so; another rule as before;
//   - !rememberArea (R3): with area_floors the scan stops at a floor (two areas for a house over a basement); a
//     box that another area has already: `That is the area "home" already.`, nothing saved; area_floors off:
//     the old scan;
//   - executeCommand with agent.job (I4): onCommand before with by 'model', the name of the player or 'system',
//     onResult after with the result of the pack, the text, or undefined for a stopped command, and the gain of
//     the inventory; nothing without agent.job.
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { register } from 'node:module';
import minecraftData from 'minecraft-data';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld, vec } from '../helpers/block_world.js';

register('../helpers/mcdata_hooks.js', import.meta.url);

async function importQuietly() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        const index = await loadSrc('src/agent/commands/index.js');
        const actions = await loadSrc('src/agent/commands/actions.js');
        const queries = await loadSrc('src/agent/commands/queries.js');
        const mcdata = await loadSrc('src/utils/mcdata.js');
        return { settingsModule, index, actions, queries, mcdata };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const M = await importQuietly();
const MINING = await loadSrc('src/agent/packs/mining/index.js');
const AS = await loadSrc('src/agent/areas/area_store.js');
const RS = await loadSrc('src/agent/rules/rule_store.js');

const BASE = { language: 'en', world_memory: true, mining_pack: false, protected_areas: true, player_rules: true, area_floors: false,
    blocked_actions: [] };
const NOW = () => new Date('2026-10-01T10:00:00Z');

let cap;
let dir;
before(() => M.mcdata.__setMcdataForTests(minecraftData('1.21.8')));
after(() => M.mcdata.__setMcdataForTests(null));
beforeEach(() => {
    cap = captureConsole();
    dir = makeTmpDir();
    M.settingsModule.setSettings({ ...BASE });
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

const command = (name) => {
    const cmd = M.actions.actionsList.find((c) => c.name === name) ?? M.queries.queryList.find((c) => c.name === name);
    assert.ok(cmd, `${name} exists`);
    return cmd;
};

// the mine of the bot (level 16) and the mine of the player "mine", as in the tests of part R
const BOT_MINE = () => ({
    ore: 'iron', entrance: { x: 9, y: 67, z: 58 }, level: 16, base: { x: 9, y: 16, z: 58 }, chest: null, direction: 'north', length: 8,
    shaft: 'ladder', created: '2026-09-28T10:00:00.000Z', updated: '2026-09-28T11:00:00.000Z', dimension: 'overworld', ores: ['iron'],
    end: { x: 9, y: 16, z: 50 }, tunnel: [], route: [],
});
const PLAYER_MINE = (name = 'mine') => ({
    name, source: 'player', ore: 'iron', entrance: { x: 9, y: 67, z: 52 }, level: 30, dimension: 'overworld', route: [],
    room: { center: { x: 9, y: 41, z: 50 }, chest: null, table: null, furnace: null },
    tunnels: [
        { start: { x: 12, y: 30, z: 50 }, dir: 'east', end: { x: 20, y: 30, z: 50 }, level: 30, length: 9, branches: [] },
        { start: { x: 12, y: 25, z: 50 }, dir: 'east', end: { x: 24, y: 25, z: 50 }, level: 25, length: 13, branches: [] },
    ],
    passed: [],
});

// A fake agent with the real mining pack and a mine store in memory; runAction is recorded (it must not run).
function mineAgent(...mines) {
    const store = new MINING.MineStore(null, { now: NOW });
    for (const m of mines) store.set(m);
    const agent = {
        name: 'andy', runs: [], logs: [], running_commands: [],
        bot: { username: 'andy', game: { dimension: 'overworld' }, output: '' },
        work_packs: { mining: MINING },
        contexts: 0,
        packContext() {
            agent.contexts++;
            return { mines: store, log: (t) => agent.logs.push(t) };
        },
        actions: { async runAction(label) { agent.runs.push(label); return { success: true, message: '' }; } },
    };
    return { agent, store };
}

// Every property read throws: the command must not touch the packs.
function untouchable() {
    const agent = { name: 'andy', running_commands: [] };
    for (const key of ['work_packs', 'packContext', 'bot']) {
        Object.defineProperty(agent, key, { get() { throw new Error(`${key} was used with the switch off`); } });
    }
    return agent;
}

describe('!mines and !forgetMine (R4)', () => {
    test('names, parameters and short descriptions; both are commands of actions.js', () => {
        assert.equal(command('!mines').description, 'List your mines.');
        assert.equal(command('!mines').params, undefined);
        assert.equal(command('!forgetMine').description, 'Forget a mine.');
        assert.deepEqual(Object.keys(command('!forgetMine').params), ['name']);
        assert.equal(command('!forgetMine').params.name.type, 'string');
        assert.equal(command('!forgetMine').params.name.default, undefined);
        assert.deepEqual(M.index.parseCommandMessage('!forgetMine("old mine")'), { commandName: '!forgetMine', args: ['old mine'] });
        assert.deepEqual(M.index.parseCommandMessage('!mines'), { commandName: '!mines', args: [] });
    });

    test('!mines: the text of minesText of the pack for the dimension of the bot, word for word; no action', async () => {
        M.settingsModule.setSettings({ ...BASE, mining_pack: true });
        const { agent } = mineAgent(BOT_MINE(), PLAYER_MINE());
        assert.equal(await command('!mines').perform(agent),
            'I know 2 mines: "mine", entrance (9, 67, 52), 2 tunnels at levels 30 and 25; the mine at (9, 67, 58) that I dug, level 16.');
        assert.deepEqual(agent.runs, [], 'a plain command: a running action keeps running');
        assert.equal(agent.contexts, 1);
        assert.equal(await command('!mines').perform(mineAgent().agent), 'I know no mines.');
        agent.bot.game.dimension = 'the_nether';
        assert.equal(await command('!mines').perform(agent), 'I know no mines.');
    });

    test('!forgetMine: forgetMine of the pack, by name or by level; the texts word for word', async () => {
        M.settingsModule.setSettings({ ...BASE, mining_pack: true });
        const { agent, store } = mineAgent(BOT_MINE(), PLAYER_MINE());
        assert.equal(await command('!forgetMine').perform(agent, 'mine'), 'Forgot the mine "mine".');
        assert.deepEqual(agent.logs, ['Forgot the mine "mine".']);
        assert.equal(await command('!forgetMine').perform(agent, 'mine'), 'I know no mine "mine".');
        assert.equal(await command('!forgetMine').perform(agent, '16'), 'Forgot the mine "16".');
        assert.equal(store.list().length, 0);
        assert.deepEqual(agent.runs, []);
    });

    test('the result of the pack goes to the entry of the command (repeat guard, job)', async () => {
        M.settingsModule.setSettings({ ...BASE, mining_pack: true });
        const { agent } = mineAgent(PLAYER_MINE());
        const entry = { name: '!forgetMine' };
        agent.running_commands.push(entry);
        await command('!forgetMine').perform(agent, 'nothing');
        assert.deepEqual(entry.pack, { ok: false, reason: 'no_mine', text: 'I know no mine "nothing".' });
    });

    test('mining_pack off: the off text, no pack touched', async () => {
        assert.equal(await command('!mines').perform(untouchable()), 'The mining pack is off.');
        assert.equal(await command('!forgetMine').perform(untouchable(), 'mine'), 'The mining pack is off.');
    });

    test('mining_pack on, its pack not loaded: says so', async () => {
        M.settingsModule.setSettings({ ...BASE, mining_pack: true });
        const { agent } = mineAgent();
        agent.work_packs = {};
        assert.equal(await command('!mines').perform(agent), 'The mining pack could not be loaded.');
        assert.equal(await command('!forgetMine').perform(agent, 'mine'), 'The mining pack could not be loaded.');
    });
});

// A house over a basement, as in the tests of part R: the house floor y 60 to 65, the basement y 55 to 60,
// a ladder at x 2, z 2 with a trapdoor at its top.
function twoFloors() {
    const w = createBlockWorld();
    w.fill(-6, 40, -6, 14, 59, 14, 'stone');
    w.fill(0, 60, 0, 8, 65, 8, 'oak_planks');
    w.fill(1, 61, 1, 7, 64, 7, 'air');
    w.set(4, 61, 0, 'oak_door').set(4, 62, 0, 'oak_door');
    w.fill(1, 56, 1, 7, 59, 7, 'air');
    w.fill(2, 56, 2, 2, 59, 2, 'ladder');
    w.set(2, 60, 2, 'oak_trapdoor');
    w.set(6, 61, 6, 'red_bed').set(6, 56, 6, 'chest');
    return w;
}

function areaAgent(world, at, { rules = false } = {}) {
    const store = new AS.AreaStore(path.join(dir, 'areas.json'), { now: NOW });
    store.load();
    const agent = {
        name: 'andy', area_store: store, running_commands: [],
        bot: { username: 'andy', entity: { position: vec(at.x, at.y, at.z) }, game: { dimension: 'overworld' }, blockAt: (pos) => world.blockAt(pos) },
    };
    if (rules) {
        agent.rule_store = new RS.RuleStore(path.join(dir, 'rules.json'), { now: NOW });
        agent.rule_store.load();
    }
    return agent;
}
const boxOf = (area) => ({ min: area.min, max: area.max });
const box = (x0, y0, z0, x1, y1, z1) => ({ min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } });

describe('!rememberArea (R3)', () => {
    test('area_floors on: the house floor upstairs and the basement below are two areas', async () => {
        M.settingsModule.setSettings({ ...BASE, area_floors: true });
        const world = twoFloors();
        const agent = areaAgent(world, { x: 4.5, y: 61, z: 4.5 });
        const up = await command('!rememberArea').perform(agent, 'home', 'home');
        assert.match(up, /^Area "home" \(home\) saved: 9 x 6 x 9 blocks, from \(0, 60, 0\) to \(8, 65, 8\), 1 door, 1 trapdoor\. Tell me if that is wrong\.$/);
        agent.bot.entity.position = vec(5.5, 56, 5.5);
        const down = await command('!rememberArea').perform(agent, 'basement', 'building');
        assert.match(down, /^Area "basement" \(building\) saved: 9 x 6 x 9 blocks, from \(0, 55, 0\) to \(8, 60, 8\)/);
        assert.deepEqual(boxOf(agent.area_store.get('home')), box(0, 60, 0, 8, 65, 8));
        assert.deepEqual(boxOf(agent.area_store.get('basement')), box(0, 55, 0, 8, 60, 8));
        assert.deepEqual(agent.area_store.get('home').entrances.map((e) => e.kind).sort(), ['door', 'trapdoor']);
    });

    test('area_floors off: the old scan, both floors in one box; the second name of that box is refused', async () => {
        const world = twoFloors();
        const agent = areaAgent(world, { x: 4.5, y: 61, z: 4.5 });
        await command('!rememberArea').perform(agent, 'home', 'home');
        const home = agent.area_store.get('home');
        assert.ok(home.min.y < 60, `the old scan takes the basement too: ${JSON.stringify(boxOf(home))}`);
        agent.bot.entity.position = vec(5.5, 56, 5.5);
        assert.equal(await command('!rememberArea').perform(agent, 'basement', 'building'), 'That is the area "home" already.');
        assert.equal(agent.area_store.get('basement') ?? null, null, 'nothing saved');
        assert.equal(agent.area_store.list().length, 1);
    });

    test('the same name again: saved again as before (a new type too)', async () => {
        const world = twoFloors();
        const agent = areaAgent(world, { x: 4.5, y: 61, z: 4.5 });
        await command('!rememberArea').perform(agent, 'home', 'building');
        assert.match(await command('!rememberArea').perform(agent, 'Home', 'home'), /^Area "home" \(home\) saved: /);
        assert.equal(agent.area_store.list().length, 1);
        assert.equal(agent.area_store.get('home').type, 'home');
    });

    test('no building: the box around the bot; the same box under another name is refused', async () => {
        const world = createBlockWorld().flatGround(63);
        const agent = areaAgent(world, { x: 100.5, y: 64, z: 100.5 });
        assert.match(await command('!rememberArea').perform(agent, 'spot', 'building'), /^I found no building here\./);
        assert.equal(await command('!rememberArea').perform(agent, 'other', 'building'), 'That is the area "spot" already.');
        assert.equal(agent.area_store.list().length, 1);
    });
});

describe('!rememberRule (R2): a rule about a saved area marks it no_enter', () => {
    async function withPen() {
        const agent = areaAgent(createBlockWorld().flatGround(63), { x: 0.5, y: 64, z: 0.5 }, { rules: true });
        agent.area_store.set({ name: 'chicken pen', type: 'pen', min: { x: 0, y: 63, z: 0 }, max: { x: 6, y: 66, z: 6 }, dimension: 'overworld', entrances: [], source: 'manual' });
        agent.area_store.set({ name: 'home', type: 'home', min: { x: 20, y: 63, z: 0 }, max: { x: 26, y: 68, z: 6 }, dimension: 'overworld', entrances: [], source: 'manual' });
        return agent;
    }

    test('saved: the reply of the rule and the sentence of the flag; the flag is in the store and in the file', async () => {
        const agent = await withPen();
        const reply = await command('!rememberRule').perform(agent, 'Never enter the chicken pen.');
        assert.equal(reply, 'Rule 1 saved: "Never enter the chicken pen." I marked the area "chicken_pen" as keep out.');
        assert.deepEqual(agent.area_store.get('chicken pen').flags, { no_enter: true });
        assert.equal(agent.area_store.get('home').flags, undefined);
        const again = new AS.AreaStore(path.join(dir, 'areas.json'));
        again.load();
        assert.deepEqual(again.get('chicken pen').flags, { no_enter: true });
    });

    test('the rule saved already: the flag is set all the same', async () => {
        const agent = await withPen();
        agent.rule_store.add('stay out of the chicken pen');
        assert.equal(await command('!rememberRule').perform(agent, 'Stay out of the chicken pen'),
            'That rule is already saved. I marked the area "chicken_pen" as keep out.');
        assert.equal(agent.area_store.get('chicken pen').flags.no_enter, true);
    });

    test('a rule of another kind, a rule about no saved area, no area store, a rule not saved: as before, no flag', async () => {
        const agent = await withPen();
        assert.equal(await command('!rememberRule').perform(agent, 'Always close the door of the chicken pen.'), 'Rule 1 saved: "Always close the door of the chicken pen."');
        assert.equal(await command('!rememberRule').perform(agent, 'Never enter the nether.'), 'Rule 2 saved: "Never enter the nether."');
        assert.equal(agent.area_store.get('chicken pen').flags, undefined);
        const noAreas = { ...agent, area_store: undefined };
        assert.equal(await command('!rememberRule').perform(noAreas, 'Keep out of the home.'), 'Rule 3 saved: "Keep out of the home."');
        assert.equal(await command('!rememberRule').perform(agent, 'x'.repeat(201) + ' never enter the home'), 'A rule has at most 200 characters.');
        assert.equal(agent.area_store.get('home').flags, undefined);
    });
});

describe('executeCommand: the hooks of the job (I4)', () => {
    // A fake agent with a recording job and the real !forgetMine (a plain command) as the command that runs.
    function jobAgent({ result, gain = {} } = {}) {
        M.settingsModule.setSettings({ ...BASE, mining_pack: true });
        const items = { raw_iron: 2, torch: 5 };
        const calls = [];
        const agent = {
            name: 'andy', running_commands: [], last_order: null, repeat_guard: null, calls,
            bot: { username: 'andy', game: { dimension: 'overworld' }, output: '', inventory: { items: () => Object.entries(items).map(([name, count]) => ({ name, count })) } },
            work_packs: {
                mining: {
                    forgetMine(ctx, name) {
                        calls.push(['perform', name, agent.running_commands.map((e) => e.name)]);
                        for (const [item, n] of Object.entries(gain)) items[item] = (items[item] ?? 0) + n;
                        return result ?? { ok: true, reason: null, text: `Forgot the mine "${name}".` };
                    },
                },
            },
            packContext: () => ({}),
            job: {
                onCommand: (...args) => { calls.push(['onCommand', ...args]); return { ok: true, reason: 'errand', text: '' }; },
                onResult: async (...args) => { calls.push(['onResult', ...args]); return { ok: true, reason: 'none', text: '' }; },
            },
        };
        return agent;
    }

    test('a command of the model: onCommand before with by "model" and the command text, onResult after with the result of the pack and the gain', async () => {
        const agent = jobAgent({ gain: { raw_iron: 3, torch: -1, cobblestone: 4 } });
        const reply = await M.index.executeCommand(agent, '!forgetMine("old")', { typed: false });
        assert.equal(reply, 'Forgot the mine "old".');
        assert.deepEqual(agent.calls, [
            ['onCommand', '!forgetMine', ['old'], 'model', '!forgetMine("old")'],
            ['perform', 'old', ['!forgetMine']],
            ['onResult', '!forgetMine', { ok: true, reason: null, text: 'Forgot the mine "old".' }, { raw_iron: 3, torch: -1, cobblestone: 4 }],
        ]);
    });

    test('typed by the player: by is the name of the player; without a name "player"', async () => {
        const agent = jobAgent();
        await M.index.executeCommand(agent, '!forgetMine("old")', { typed: true, by: 'steve' });
        assert.equal(agent.calls[0][3], 'steve');
        const other = jobAgent();
        await M.index.executeCommand(other, '!forgetMine("old")', { typed: true });
        assert.equal(other.calls[0][3], 'player');
    });

    test('a system order (by "system"): never typed, by "system"; a call without options that is no typed order too', async () => {
        const agent = jobAgent();
        agent.last_order = { typed: true, command: '!forgetMine', by: 'steve' };
        await M.index.executeCommand(agent, '!forgetMine("old")', { by: 'system', typed: false });
        assert.equal(agent.calls[0][3], 'system');
        const task = jobAgent();
        await M.index.executeCommand(task, '!forgetMine("old")');
        assert.equal(task.calls[0][3], 'system');
        const typed = jobAgent();
        typed.last_order = { typed: true, command: '!forgetMine', by: 'alex' };
        await M.index.executeCommand(typed, '!forgetMine("old")');
        assert.equal(typed.calls[0][3], 'alex', 'agent.last_order decides without options, as before');
    });

    test('a result without a pack entry: the text; no gain: {}', async () => {
        const agent = jobAgent();
        agent.work_packs.mining.forgetMine = () => 'just a text';
        await M.index.executeCommand(agent, '!forgetMine("old")', { typed: false });
        const result = agent.calls.find((c) => c[0] === 'onResult');
        assert.deepEqual(result, ['onResult', '!forgetMine', { ok: undefined, reason: null, text: 'just a text' }, {}]);
    });

    test('a stopped command: onResult with undefined', async () => {
        M.settingsModule.setSettings({ ...BASE, mining_pack: true });
        const agent = jobAgent();
        const turns = [];
        Object.assign(agent, {
            history: { add: async (name, text) => turns.push([name, text]) },
            actions: { async runAction(label, fn) { return { success: false, interrupted: true, timedout: false, message: '' }; } },
        });
        agent.work_packs.mining.mineOre = () => ({ ok: true });
        const reply = await M.index.executeCommand(agent, '!mineOre("iron", 4)', { typed: false });
        assert.equal(reply, undefined);
        assert.deepEqual(agent.calls.at(-1), ['onResult', '!mineOre', undefined, {}]);
        assert.equal(agent.calls[0][4], '!mineOre("iron", 4, false)', 'the text with the defaults');
    });

    test('a command that does not parse or that the repeat guard refuses: no hook', async () => {
        const agent = jobAgent();
        assert.equal(await M.index.executeCommand(agent, '!forgetMine(1, 2)', { typed: false }), 'Command !forgetMine was given 2 args, but requires 1 args.');
        agent.repeat_guard = { check: () => 'I tried !forgetMine 3 times with the same result.', record() {} };
        assert.equal(await M.index.executeCommand(agent, '!forgetMine("old")', { typed: false }), 'I tried !forgetMine 3 times with the same result.');
        assert.deepEqual(agent.calls, []);
    });

    test('a hook that throws breaks nothing', async () => {
        const agent = jobAgent();
        agent.job = { onCommand() { throw new Error('broken'); }, onResult() { throw new Error('broken'); } };
        assert.equal(await M.index.executeCommand(agent, '!forgetMine("old")', { typed: false }), 'Forgot the mine "old".');
        const rejecting = jobAgent();
        rejecting.job = { onCommand() {}, onResult: () => Promise.reject(new Error('broken')) };
        assert.equal(await M.index.executeCommand(rejecting, '!forgetMine("old")', { typed: false }), 'Forgot the mine "old".');
        await new Promise((resolve) => setImmediate(resolve));
        assert.ok(cap.of('warn').some((r) => r.text.includes('The job could not note')));
    });

    test('without agent.job (job_memory off): the command runs as before, no inventory is read', async () => {
        const agent = jobAgent();
        agent.job = null;
        Object.defineProperty(agent.bot, 'inventory', { get() { throw new Error('the inventory was read'); } });
        assert.equal(await M.index.executeCommand(agent, '!forgetMine("old")', { typed: false }), 'Forgot the mine "old".');
        assert.deepEqual(agent.calls.map((c) => c[0]), ['perform']);
    });
});
