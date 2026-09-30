// Spec v0.1.4.6 G4 and Amendment 1 (part G): the modes with home_pack on.
//   - creeper_safety and night_shelter directly after self_preservation, door_closing at the end;
//     a reflex that is false in home_reflexes does not exist; !setMode works for them;
//   - creeper_safety and night_shelter run through execute (an action 'mode:<name>'), door_closing
//     never does, also while an action runs;
//   - while creeper_safety is on, a creeper is no target for self_defense and cowardice;
//   - torch_placing places no torch where the area guard refuses one.
// v0.1.4.8 (part A): the mode hunger comes directly after self_defense (A11, decision of the tech lead);
// night_shelter does nothing without a home (A7, C4), so its test gives the place "home".
//
// The modes run through the real ModeController.update() of a fake agent. runAction records the
// label and does not run the mode's function (the functions of the home pack are tested by H).
// modes_list is a module variable, so this file switches the home pack on once, before initModes.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { runNodeModuleSource, describeRun } from '../helpers/child.js';

register('../helpers/mcdata_hooks.js', import.meta.url);

async function importQuietly() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        const mcdata = await loadSrc('src/utils/mcdata.js');
        const modes = await loadSrc('src/agent/modes.js');
        const actions = await loadSrc('src/agent/commands/actions.js');
        return { settingsModule, mcdata, modes, actions };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const { settingsModule, mcdata, modes, actions } = await importQuietly();
const settings = settingsModule.default;
settingsModule.setSettings({ language: 'en', home_pack: true, narrate_behavior: false });
mcdata.__setMcdataForTests(minecraftData('1.21.8'));

const ALL_OFF = { self_preservation: false, unstuck: false, cowardice: false, self_defense: false, hunting: false, item_collecting: false,
    torch_placing: false, elbow_room: false, idle_staring: false, cheat: false, creeper_safety: false, night_shelter: false, door_closing: false,
    hunger: false };
// v0.1.4.8: the place "home" far away, so night_shelter has a shelter to go to (A7, C4)
const PLACES = { recall: (name) => (name === 'home' ? { x: 100, y: 64, z: 100, dimension: 'overworld' } : null) };

function makeAgent() {
    const bot = {
        username: 'andy',
        entity: { position: new Vec3(0.5, 64, 0.5), height: 1.8 },
        entities: {},
        players: {},
        game: { dimension: 'overworld', gameMode: 'survival' },
        time: { timeOfDay: 1000 },
        health: 20,
        food: 20,
        output: '',
        interrupt_code: false,
        heldItem: null,
        torches: false,
        inventory: { items: () => [], findInventoryItem: (name) => (bot.torches && name === 'torch' ? { name: 'torch' } : null), emptySlotCount: () => 30, slots: [] },
        findBlocks: () => [],
        blockAt: (p) => ({ name: 'air', position: p }),
        nearestEntity(filter) {
            return Object.values(bot.entities).find((e) => filter(e)) ?? null;
        },
        on() {},
        once() {},
    };
    const agent = {
        name: 'andy',
        bot,
        shut_up: true,
        last_order: null,
        last_sender: null,
        isIdle: () => agent.actions.currentActionLabel === '',
        openChat() {},
        handleMessage() {},
        self_prompter: { isActive: () => false, stopLoop() {} },
        prompter: { getInitModes: () => ALL_OFF },
        actions: {
            currentActionLabel: '',
            resume_func: null,
            runs: [],
            // records the mode action without running it; "interrupted" so execute asks no model
            async runAction(label) {
                agent.actions.runs.push(label);
                return { success: true, message: '', interrupted: true, timedout: false };
            },
        },
        homeContext: () => ({ areas: null, places: PLACES, settings, log() {}, now: () => Date.now(), skills: {}, world: {} }),
    };
    modes.initModes(agent);
    return agent;
}

const names = (agent) => agent.bot.modes.getMiniDocs().split('\n').slice(1).map((l) => l.replace(/^- /, '').replace(/\((ON|OFF)\)$/, ''));
const tick = async (agent) => {
    await agent.bot.modes.update();
    await new Promise((r) => setTimeout(r, 5));
};

let cap;
beforeEach(() => {
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
});

describe('the list of modes with home_pack on', () => {
    test('creeper_safety and night_shelter after self_preservation, hunger after self_defense, door_closing at the end; a second initModes adds nothing', () => {
        const expected = ['self_preservation', 'creeper_safety', 'night_shelter', 'unstuck', 'cowardice', 'self_defense', 'hunger', 'hunting',
            'item_collecting', 'torch_placing', 'elbow_room', 'idle_staring', 'cheat', 'door_closing'];
        const agent = makeAgent();
        assert.deepEqual(names(agent), expected);
        assert.deepEqual(names(makeAgent()), expected);
    });

    test('!setMode works for them, the profile value counts', async () => {
        const agent = makeAgent();
        assert.equal(agent.bot.modes.isOn('night_shelter'), false, 'the profile of the test switched it off');
        const setMode = actions.actionsList.find((c) => c.name === '!setMode');
        assert.equal(await setMode.perform(agent, 'night_shelter', true), 'Mode night_shelter is now on.');
        assert.equal(agent.bot.modes.isOn('night_shelter'), true);
        assert.equal(await setMode.perform(agent, 'door_closing', true), 'Mode door_closing is now on.');
    });

    test('a reflex that is false in home_reflexes does not exist (separate process)', () => {
        const dir = makeTmpDir();
        try {
            const url = (rel) => pathToFileURL(repoPath(rel)).href;
            const source = [
                `const s = await import(${JSON.stringify(url('src/agent/settings.js'))});`,
                "s.setSettings({ home_pack: true, home_reflexes: { door_closing: false, night_shelter: true } });",
                `const m = await import(${JSON.stringify(url('src/agent/modes.js'))});`,
                "const agent = { bot: {}, prompter: { getInitModes: () => null } };",
                'm.initModes(agent);',
                "console.log('RESULT ' + JSON.stringify(agent.bot.modes.getMiniDocs().split('\\n').slice(1)));",
            ].join('\n');
            const run = runNodeModuleSource(source, { cwd: dir });
            assert.equal(run.status, 0, describeRun(run));
            const line = run.stdout.split(/\r?\n/).find((l) => l.startsWith('RESULT '));
            const list = JSON.parse(line.slice(7)).map((l) => l.replace(/^- /, '').replace(/\((ON|OFF)\)$/, ''));
            assert.deepEqual(list.slice(0, 4), ['self_preservation', 'creeper_safety', 'night_shelter', 'unstuck']);
            assert.equal(list[list.indexOf('self_defense') + 1], 'hunger');
            assert.ok(!list.includes('door_closing'));
        } finally {
            removeTmpDir(dir);
        }
    });
});

describe('the three reflexes', () => {
    test('door_closing never runs through execute, also while an action runs', async () => {
        const agent = makeAgent();
        agent.bot.modes.setOn('door_closing', true);
        agent.actions.currentActionLabel = 'action:collectBlocks';
        for (let i = 0; i < 3; i++) await tick(agent);
        agent.actions.currentActionLabel = '';
        await tick(agent);
        assert.deepEqual(agent.actions.runs, []);
    });

    test('night_shelter: nothing at day, nothing while a player\'s order of this night runs; otherwise the text and an action mode:night_shelter, then the cooldown', async () => {
        const agent = makeAgent();
        agent.bot.modes.setOn('night_shelter', true);
        await tick(agent);
        assert.deepEqual(agent.actions.runs, [], 'day');
        agent.bot.time.timeOfDay = 13000;
        agent.actions.currentActionLabel = 'action:collectBlocks';
        agent.last_order = { by: 'bob', at: Date.now() - 1000, atTimeOfDay: 12980, command: '!collectBlocks' };
        await tick(agent);
        assert.deepEqual(agent.actions.runs, [], 'ordered at night');
        agent.last_order = null; // now an action of the bot itself
        await tick(agent);
        assert.deepEqual(agent.actions.runs, ['mode:night_shelter']);
        assert.ok(agent.bot.modes.flushBehaviorLog().includes('It is getting dark. I go to the shelter.'));
        agent.actions.currentActionLabel = '';
        await tick(agent);
        assert.deepEqual(agent.actions.runs, ['mode:night_shelter'], 'no second attempt within 60 seconds');
    });

    test('creeper_safety: a creeper 3 blocks away runs the procedure through execute; none, nothing', async () => {
        const agent = makeAgent();
        agent.bot.modes.setOn('creeper_safety', true);
        await tick(agent);
        assert.deepEqual(agent.actions.runs, []);
        agent.bot.entities[7] = { id: 7, name: 'creeper', type: 'hostile', position: new Vec3(3.5, 64, 0.5), metadata: {} };
        await tick(agent);
        assert.deepEqual(agent.actions.runs, ['mode:creeper_safety']);
    });

    test('self_defense and cowardice leave a creeper to creeper_safety while it is on', async () => {
        const agent = makeAgent();
        const creeper = { id: 7, name: 'creeper', type: 'hostile', position: new Vec3(3.5, 64, 0.5), metadata: {} };
        agent.bot.entities[7] = creeper;
        const asked = [];
        agent.bot.nearestEntity = (filter) => {
            asked.push(filter(creeper));
            return null;
        };
        agent.bot.modes.setOn('self_defense', true);
        agent.bot.modes.setOn('cowardice', true);
        agent.bot.modes.setOn('creeper_safety', true);
        agent.bot.modes.pause('creeper_safety'); // only the filters are under test
        agent.actions.currentActionLabel = 'action:collectBlocks';
        await tick(agent);
        assert.deepEqual(asked, [false, false], 'no target while creeper_safety is on');
        asked.length = 0;
        agent.bot.modes.setOn('creeper_safety', false);
        await tick(agent);
        assert.deepEqual(asked, [true, true], 'a target again when it is off');
    });

    test('torch_placing: no torch inside a building area, no action, no log line; without the guard as before', async () => {
        const agent = makeAgent();
        agent.bot.torches = true;
        agent.bot.modes.setOn('torch_placing', true);
        agent.bot.areaGuard = { canPlace: (pos, item) => !(item === 'torch' && pos.x < 10) };
        await new Promise((r) => setTimeout(r, 5100)); // the cooldown of 5 seconds after the start of the mode
        await tick(agent);
        cap.records.length = 0; // lines of other modes (unpausing) are not under test
        await tick(agent);
        assert.deepEqual(agent.actions.runs, []);
        assert.equal(cap.records.length, 0, cap.allText());
        agent.bot.areaGuard = undefined;
        await tick(agent);
        assert.deepEqual(agent.actions.runs, ['mode:torch_placing']);
    });
});
