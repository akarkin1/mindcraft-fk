// Spec v0.1.4.16, F2 (engineer E2): the report is the bot's own line. !surveyBase, !renameArea, !forgetArea (a base, a place)
// and !goToBase say their result through ctx.say (agent.sayText: the history and the chat) and return to the model the short
// answer `Done; I said it in the chat.`; a failure returns its text as today and says nothing. The commands run through
// actions.js (runPack, runPlain) with the survey pack as the agent loads it, a fake bot over a block world and the real
// stores in a temp folder.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { createBlockWorld, vec } from '../helpers/block_world.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

async function importCommands() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        await loadSrc('src/agent/commands/index.js');
        const actions = await loadSrc('src/agent/commands/actions.js');
        return { settingsModule, actions };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const { settingsModule, actions } = await importCommands();
const SURVEY = await loadSrc('src/agent/packs/survey/index.js');
const L = await loadSrc('src/agent/packs/survey/survey_logic.js');
const AS = await loadSrc('src/agent/areas/area_store.js');
const PS = await loadSrc('src/agent/world/place_store.js');
const MB = await loadSrc('src/agent/memory_bank.js');
const BS = await loadSrc('src/agent/world/base_store.js');

const command = (name) => actions.actionsList.find((c) => c.name === name);
const SAID = 'Done; I said it in the chat.';

const NAMES = [...new Set([...Object.values(L.SEED_NAMES).flat(), 'air', 'stone', 'dirt', 'grass_block', 'oak_planks', 'oak_log', 'glass_pane'])];
const registry = { blocksByName: Object.fromEntries(NAMES.map((name, i) => [name, { id: i + 1, name }])) };
const idOf = (name) => registry.blocksByName[name]?.id ?? null;

function fakeBot(w, at) {
    const bot = {
        username: 'andy', registry, entity: { position: vec(at.x, at.y, at.z) }, entities: {}, game: { dimension: 'overworld' }, interrupt_code: false, output: '',
        blockAt: (pos) => w.blockAt(pos),
        findBlocks({ matching, maxDistance, count }) {
            const ids = new Set(matching);
            const me = bot.entity.position;
            return w.positionsOf((name) => ids.has(idOf(name))).map((p) => ({ p, d: Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z) }))
                .filter(({ d }) => d <= maxDistance).sort((a, b) => a.d - b.d).slice(0, count).map(({ p }) => vec(p.x, p.y, p.z));
        },
    };
    return bot;
}

let dir;
let cap;
beforeEach(() => {
    dir = makeTmpDir();
    cap = captureConsole();
    settingsModule.setSettings({ language: 'en', protected_areas: true, world_memory: true, base_survey: true, say_results: false });
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

// The agent as actions.js sees it: runAction runs fn (runPack), packContext gives the stores and say = sayText, which records
// the bot's own lines and the history turns.
function makeAgent() {
    const w = createBlockWorld();
    w.fill(-40, 20, -40, 60, 57, 60, 'stone');
    w.fill(-40, 58, -40, 60, 58, 60, 'grass_block');
    const house = w.house({ x: 0, y: 59, z: 0, chest: null });
    const areas = new AS.AreaStore(path.join(dir, 'areas.json'));
    areas.load();
    const placeStore = new PS.PlaceStore(path.join(dir, 'places.json'));
    placeStore.load();
    const places = new MB.MemoryBank();
    places.attachStore(placeStore, () => 'overworld');
    const bases = new BS.BaseStore(path.join(dir, 'bases.json'));
    bases.load();
    const said = [];
    const turns = [];
    const agent = {
        name: 'andy', said, turns, runs: [], running_commands: [], last_pack_text: null,
        bot: fakeBot(w, { x: house.inside.x + 0.5, y: house.inside.y, z: house.inside.z + 0.5 }),
        area_store: areas, memory_bank: places, work_packs: { survey: SURVEY },
        history: { add: async (name, content) => { turns.push([name, content]); } },
        sayText(text) { said.push(text); turns.push(['andy', text]); },
        actions: {
            async runAction(label, fn) {
                agent.runs.push(label);
                await fn();
                return { success: true, message: 'Action output:\n', interrupted: false, timedout: false };
            },
        },
    };
    agent.packContext = () => ({ areas, places, bases, settings: settingsModule.default, now: () => 0, log: () => {}, say: (t) => agent.sayText(t),
        routes: { store: null, walkTo: async () => ({ ok: true, reason: null, text: '' }) } });
    return { agent, house, areas, places, bases, said, turns };
}

describe('the survey commands say their result (F2)', () => {
    test('!surveyBase: the report is said once, word for word; the model gets the short answer; the history has the line', async () => {
        const { agent, said, turns } = makeAgent();
        const reply = await command('!surveyBase').perform(agent, 'east');
        assert.equal(reply, SAID);
        assert.deepEqual(said, ['I found 1 place: house (1 bed). All saved. Say "rename X to Y" or "forget X" to correct.']);
        assert.deepEqual(turns, [['andy', said[0]]], 'sayText noted the line; the command result is added by the agent loop as today');
        assert.equal(agent.last_pack_text, SAID, 'runPack notes the answer as the pack text');
        assert.deepEqual(agent.runs, ['action:surveyBase'], 'still an action');
    });

    test('!renameArea: a success is said, a failure is the answer as today and nothing is said', async () => {
        const { agent, said } = makeAgent();
        await command('!surveyBase').perform(agent, 'east');
        said.length = 0;
        assert.equal(await command('!renameArea').perform(agent, 'house', 'villa'), SAID);
        assert.deepEqual(said, ['I renamed "house" to "villa".']);
        assert.equal(await command('!renameArea').perform(agent, 'pen', 'horse_house'), 'I know no place "pen".');
        assert.equal(await command('!renameArea').perform(agent, 'villa', 'villa'), 'There is a place "villa" already.');
        assert.equal(said.length, 1);
    });

    test('!forgetArea of a base and of a place: said; of nothing: the answer as today', async () => {
        const { agent, said, places } = makeAgent();
        await command('!surveyBase').perform(agent, 'east');
        said.length = 0;
        places.rememberPlace('post', 3, 59, 12, 'overworld', 'east');
        assert.equal(await command('!forgetArea').perform(agent, 'post'), SAID);
        assert.deepEqual(said, ['Forgot the place "post".']);
        assert.equal(await command('!forgetArea').perform(agent, 'east'), SAID);
        assert.deepEqual(said[1], 'I forgot the base "east" and its 1 place.');
        assert.equal(await command('!forgetArea').perform(agent, 'east'), 'No area named "east" is saved.');
        assert.equal(said.length, 2);
    });

    test('!goToBase: the arrival is said; an unknown base is the answer as today', async () => {
        const { agent, said } = makeAgent();
        await command('!surveyBase').perform(agent, 'east');
        said.length = 0;
        assert.equal(await command('!goToBase').perform(agent, 'east'), SAID);
        assert.deepEqual(said, ['I am at the base "east".']);
        assert.equal(await command('!goToBase').perform(agent, 'west'), 'I know no base "west".');
        assert.equal(said.length, 1);
    });

    test('with the switch off the commands answer as today and say nothing', async () => {
        settingsModule.setSettings({ language: 'en', protected_areas: true, world_memory: true, base_survey: false });
        const { agent, said } = makeAgent();
        assert.equal(await command('!surveyBase').perform(agent, 'east'), 'The base survey is off.');
        assert.deepEqual(said, []);
    });
});
