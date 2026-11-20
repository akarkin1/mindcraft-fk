// Spec v0.1.4.16, F2 (engineer E2): forgetting in the bases. !forgetArea of a survey place and of an owner's area removes
// the name from every base's `places` and `kept` (removeFromBases of survey.js, called by the command after store.remove and
// in the place branch of forgetSurveyed); a forget of the base removes its `places`, never its `kept`; the rename keeps both
// lists in step. The command runs through actions.js with the real stores in a temp folder and the survey pack as the agent
// loads it.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

async function importCommands() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        await loadSrc('src/agent/commands/index.js'); // first, as the agent does (actions.js is reached through it)
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
const S = await loadSrc('src/agent/packs/survey/survey.js');
const AS = await loadSrc('src/agent/areas/area_store.js');
const PS = await loadSrc('src/agent/world/place_store.js');
const MB = await loadSrc('src/agent/memory_bank.js');
const BS = await loadSrc('src/agent/world/base_store.js');

settingsModule.setSettings({ language: 'en', protected_areas: true, world_memory: true, base_survey: true });

const command = (name) => actions.actionsList.find((c) => c.name === name);

let dir;
let cap;
beforeEach(() => {
    dir = makeTmpDir();
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

const box = (x1, z1, x2, z2, y = 60) => ({ min: { x: x1, y, z: z1 }, max: { x: x2, y: y + 5, z: z2 } });

// The stores of a surveyed base "east": the survey's house, cow pen and mine entrance, the owner's wheat farm and home.
function surveyed() {
    const areas = new AS.AreaStore(path.join(dir, 'areas.json'));
    areas.load();
    const placeStore = new PS.PlaceStore(path.join(dir, 'places.json'));
    placeStore.load();
    const places = new MB.MemoryBank();
    places.attachStore(placeStore, () => 'overworld');
    const bases = new BS.BaseStore(path.join(dir, 'bases.json'));
    bases.load();
    areas.set({ name: 'house', type: 'home', kind: 'home', ...box(0, 0, 8, 8), dimension: 'overworld', entrances: [{ x: 4, y: 61, z: 0, kind: 'door' }], source: 'survey', base: 'east' });
    areas.set({ name: 'cow_pen', type: 'pen', kind: 'pen', ...box(25, 1, 29, 5), dimension: 'overworld', source: 'survey', base: 'east' });
    areas.set({ name: 'wheat_farm', type: 'farm', kind: 'farm', ...box(10, 0, 16, 8), dimension: 'overworld', source: 'manual' });
    areas.set({ name: 'home', type: 'home', kind: 'home', ...box(40, 0, 48, 8), dimension: 'overworld', source: 'scan' });
    places.rememberPlace('mine_entrance', 8, 54, 3, 'overworld', 'east');
    bases.set({ name: 'east', centre: { x: 10, y: 62, z: 4 }, dimension: 'overworld', door: { x: 4, y: 61, z: 0 }, places: ['house', 'cow_pen', 'mine_entrance'], kept: ['wheat_farm', 'home'] });
    bases.set({ name: 'west', centre: { x: -100, y: 62, z: 4 }, dimension: 'overworld', door: null, places: ['barn'], kept: ['wheat_farm'] });
    const said = [];
    const ctx = { areas, places, bases, settings: settingsModule.default, now: () => 0, log: () => {}, say: (t) => said.push(t), routes: null };
    const agent = { name: 'andy', area_store: areas, memory_bank: places, work_packs: { survey: SURVEY }, packContext: () => ctx, running_commands: [] };
    return { agent, ctx, areas, places, bases, said };
}

describe('!forgetArea and the bases (F2)', () => {
    test('a survey area leaves `places` of its base; the command answers as before', async () => {
        const { agent, areas, bases } = surveyed();
        assert.equal(await command('!forgetArea').perform(agent, 'cow_pen'), 'Forgot the area "cow_pen".');
        assert.equal(areas.get('cow_pen'), undefined);
        assert.deepEqual(bases.get('east').places, ['house', 'mine_entrance']);
        assert.deepEqual(bases.get('east').kept, ['wheat_farm', 'home']);
    });

    test('an owner\'s area leaves `kept` of every base that lists it', async () => {
        const { agent, bases } = surveyed();
        assert.equal(await command('!forgetArea').perform(agent, 'wheat_farm'), 'Forgot the area "wheat_farm".');
        assert.deepEqual(bases.get('east').kept, ['home']);
        assert.deepEqual(bases.get('west').kept, []);
        assert.deepEqual(bases.get('east').places, ['house', 'cow_pen', 'mine_entrance']);
    });

    test('a survey place (the place branch of forgetSurveyed) leaves `places`; the line is said, the model gets the short answer', async () => {
        const { agent, places, bases, said } = surveyed();
        assert.equal(await command('!forgetArea').perform(agent, 'mine_entrance'), 'Done; I said it in the chat.');
        assert.deepEqual(said, ['Forgot the place "mine_entrance".']);
        assert.equal(places.recallPlaceInfo('mine_entrance'), undefined);
        assert.deepEqual(bases.get('east').places, ['house', 'cow_pen']);
    });

    test('a name of no area, place or base: the answer as before, the bases unchanged', async () => {
        const { agent, bases } = surveyed();
        assert.equal(await command('!forgetArea').perform(agent, 'nothing'), 'No area named "nothing" is saved.');
        assert.deepEqual(bases.get('east').places, ['house', 'cow_pen', 'mine_entrance']);
    });

    test('a forget of the base removes its places and the base, never the owner\'s areas of `kept`; the count is of `places`', async () => {
        const { agent, areas, places, bases, said } = surveyed();
        assert.equal(await command('!forgetArea').perform(agent, 'east'), 'Done; I said it in the chat.');
        assert.deepEqual(said, ['I forgot the base "east" and its 3 places.']);
        assert.equal(bases.get('east'), null);
        assert.deepEqual(areas.list().map(a => a.name), ['home', 'wheat_farm'], 'the owner\'s areas stand');
        assert.equal(places.recallPlaceInfo('mine_entrance'), undefined);
        assert.deepEqual(bases.get('west').kept, ['wheat_farm'], 'another base keeps its kept');
    });

    test('removeFromBases: the names of the bases that changed; a rename keeps places and kept in step', () => {
        const { ctx, bases, said } = surveyed();
        assert.deepEqual(S.removeFromBases(ctx, 'wheat_farm'), ['east', 'west']);
        assert.deepEqual(S.removeFromBases(ctx, 'wheat_farm'), []);
        assert.deepEqual(S.removeFromBases(ctx, ''), []);
        assert.deepEqual(S.removeFromBases(ctx, 'Cow Pen'), ['east'], 'the name as an area name');
        assert.deepEqual(bases.get('east').places, ['house', 'mine_entrance']);
        assert.deepEqual(S.removeFromBases({ bases: null }, 'x'), []);
        const r = S.renameArea(ctx, 'home', 'my_house');
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(bases.get('east').kept, ['my_house']);
        assert.deepEqual(said, ['I renamed "home" to "my_house".']);
        assert.equal(S.renameArea(ctx, 'house', 'Villa').ok, true);
        assert.deepEqual(bases.get('east').places, ['villa', 'mine_entrance']);
    });
});
