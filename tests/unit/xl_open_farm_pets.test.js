// v0.1.4.14, fix round part 8 (P-18, SPEC 8.2, engineer E4): kindOf with pets and roofs, the typed kind of
// !rememberArea, and the open farm (src/agent/areas/open_farm.js, the farm of `!rememberArea(name, "farm")` with no
// fence) with its texts of 8.11; the farming pack works an open farm on its farmland only.
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { register } from 'node:module';
import minecraftData from 'minecraft-data';
import { loadSrc, TEST_MC_VERSION } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld, vec } from '../helpers/block_world.js';
import { assertCleanImport, assertImportRules } from '../helpers/module_rules.js';

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
        const mcdata = await loadSrc('src/utils/mcdata.js');
        return { settingsModule, index, actions, mcdata };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const M = await importQuietly();
const AS = await loadSrc('src/agent/areas/area_store.js');
const K = await loadSrc('src/agent/areas/area_kind.js');
const F = await loadSrc('src/agent/areas/open_farm.js');
const S = await loadSrc('src/agent/areas/area_scan.js');
const FARM = await loadSrc('src/agent/packs/farming/farming.js');

const BASE = { language: 'en', world_memory: true, protected_areas: true, player_rules: true, area_floors: false, home_pack: false, blocked_actions: [] };
const NOW = () => new Date('2026-11-09T10:00:00Z');

let cap;
let dir;
before(() => M.mcdata.__setMcdataForTests(minecraftData(TEST_MC_VERSION)));
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

const typed = async (agent, text) => {
    const parsed = M.index.parseCommandMessage(text);
    assert.equal(typeof parsed, 'object', parsed);
    return M.actions.actionsList.find((c) => c.name === '!rememberArea').perform(agent, ...parsed.args);
};

function areaAgent(world, at, entities = []) {
    const store = new AS.AreaStore(path.join(dir, 'areas.json'), { now: NOW });
    store.load();
    const bot = { username: 'andy', entity: { id: 1, name: 'player', type: 'player', position: vec(at.x, at.y, at.z) }, game: { dimension: 'overworld' },
        blockAt: (pos) => world.blockAt(pos) };
    bot.entities = { 1: bot.entity };
    entities.forEach((e, i) => { bot.entities[10 + i] = { id: 10 + i, ...e }; });
    return { name: 'andy', area_store: store, running_commands: [], bot };
}

const DOOR = [{ x: 0, y: 64, z: 0, kind: 'door' }];
const GATE = [{ x: 0, y: 64, z: 0, kind: 'gate' }];
const C = (more = {}) => ({ animals: {}, crops: {}, beds: 0, chests: 0, furnaces: 0, tables: 0, ladders: 0, water: 0, ...more });

describe('kindOf: pets and the fence (P-18, the owner: a pen is surrounded by a fence, with a roof or without)', () => {
    test('two cats in a house with a roof, a door and a bed: a home, never a pen', () => {
        assert.equal(K.kindOf({ border: 'wall', roof: true, openings: DOOR }, C({ animals: { cat: 2 }, beds: 2, chests: 9 })), 'home');
    });
    test('sheep in a fence ring with a gate: a pen, without a roof and with one', () => {
        assert.equal(K.kindOf({ border: 'fence', roof: false, openings: GATE }, C({ animals: { sheep: 3 } })), 'pen');
        assert.equal(K.kindOf({ border: 'fence', roof: true, openings: GATE }, C({ animals: { sheep: 3 } })), 'pen', 'a roofed pen');
    });
    test('sheep in a walled place with a door and a roof: never a pen, the rules of the walls', () => {
        assert.equal(K.kindOf({ border: 'wall', roof: true, openings: DOOR }, C({ animals: { sheep: 3 } })), 'building');
        assert.equal(K.kindOf({ border: 'wall', roof: true, openings: DOOR }, C({ animals: { sheep: 3 }, chests: 2 })), 'storage');
        assert.equal(K.kindOf({ border: 'wall', roof: false, openings: GATE }, C({ animals: { sheep: 3 } })), 'yard', 'a wall with a gate');
    });
    test('a mixed ring: a pen when its openings are gates, not when it has a door', () => {
        assert.equal(K.kindOf({ border: 'mixed', roof: false, openings: GATE }, C({ animals: { cow: 2 } })), 'pen');
        assert.equal(K.kindOf({ border: 'mixed', roof: true, openings: [...GATE, { x: 3, y: 64, z: 0, kind: 'door' }] }, C({ animals: { cow: 2 } })),
            'building');
    });
    test('pets alone make no pen; a fence ring without animals is a yard', () => {
        for (const pet of K.PETS) {
            assert.equal(K.kindOf({ border: 'fence', roof: false, openings: GATE }, C({ animals: { [pet]: 2 } })), 'yard', pet);
        }
        assert.equal(K.kindOf({ border: 'fence', roof: false, openings: GATE }, C()), 'yard');
        assert.equal(K.kindOf({ border: 'fence', roof: false, openings: GATE }, C({ animals: { cat: 1, chicken: 2 } })), 'pen');
        assert.equal(K.penAnimalCount(C({ animals: { cat: 2, wolf: 1, 'minecraft:parrot': 1, cow: 3 } })), 3);
    });
});

describe('the scan of a roofed pen (P-18)', () => {
    test('a fence ring with a gate under a roof of planks: border fence, its gate, a pen with sheep; a house stays walled', () => {
        const w = createBlockWorld().flatGround(63);
        const f = w.field({ x: 0, y: 63, z: 0, width: 7, depth: 7, ground: 'grass_block', crop: null });
        w.fill(-1, 66, -1, 7, 66, 7, 'oak_planks');
        const r = S.scanEnclosure(w.getBlockName, { x: f.inside.x + 0.5, y: 64, z: f.inside.z + 0.5 });
        assert.equal(r.found, true, r.reason);
        assert.equal(r.border, 'fence');
        assert.equal(r.roof, true);
        assert.deepEqual(r.openings.map(o => o.kind), ['gate']);
        assert.equal(K.kindOf(r, C({ animals: { sheep: 4 } })), 'pen');
        const h = createBlockWorld().flatGround(63);
        const house = h.house({ x: 0, y: 63, z: 0, width: 7, depth: 7 });
        const hr = S.scanEnclosure(h.getBlockName, { x: house.inside.x + 0.5, y: house.inside.y, z: house.inside.z + 0.5 });
        assert.equal(hr.border, 'wall');
        assert.equal(K.kindOf(hr, C({ animals: { cat: 2 }, beds: 1 })), 'home');
        assert.equal(K.kindOf(hr, C({ animals: { sheep: 2 } })), 'building', 'sheep in a house: no pen');
    });
});

describe('the typed kind wins (P-18, SPEC 8.2 point 2)', () => {
    function house() {
        const world = createBlockWorld().flatGround(63);
        const h = world.house({ x: 0, y: 63, z: 0, width: 7, depth: 9 });
        return { world, at: { x: h.inside.x + 0.5, y: h.inside.y, z: h.inside.z + 0.5 } };
    }
    const cats = (at) => [0, 1].map((i) => ({ name: 'cat', type: 'animal', position: vec(at.x + i, at.y, at.z) }));

    test('!rememberArea("home", "building") with 2 cats and a bed saves a building and says what it found', async () => {
        const { world, at } = house();
        const agent = areaAgent(world, at, cats(at));
        const reply = await typed(agent, '!rememberArea("home", "building")');
        assert.match(reply, /^I saved "home": a building, walled, \d+ x \d+ with a roof, 1 door, 2 cats, 1 bed\b.*I change nothing in it\.$/, reply);
        assert.equal(agent.area_store.get('home').kind, 'building');
        assert.equal(agent.area_store.get('home').type, 'building');
    });

    test('without a type the same house with 2 cats is a home (the parser fills in "auto")', async () => {
        const { world, at } = house();
        const agent = areaAgent(world, at, cats(at));
        assert.deepEqual(M.index.parseCommandMessage('!rememberArea("home")').args, ['home', 'auto']);
        const reply = await typed(agent, '!rememberArea("home")');
        assert.match(reply, /^I saved "home": a home, walled, /, reply);
    });
});

// A field without a fence: farmland x 0..6, z 0..2 at y 63 with a water cell in the middle, carrots on the west part
// and potatoes on the east, a path beside it, and a river 2 blocks off that is not among the farmland.
function openField() {
    const world = createBlockWorld().flatGround(63);
    world.fill(0, 63, 0, 6, 63, 2, 'farmland');
    world.set(3, 63, 1, 'water');
    world.fill(0, 64, 0, 2, 64, 2, 'carrots');
    world.set(3, 64, 0, 'carrots');
    world.set(3, 64, 2, 'carrots');
    world.fill(4, 64, 0, 6, 64, 2, 'potatoes');
    world.set(7, 63, 1, 'dirt_path');
    world.fill(9, 63, 1, 14, 63, 1, 'water');
    return world;
}

describe('findOpenFarm (pure)', () => {
    test('the module is pure', () => {
        assertImportRules('src/agent/areas/open_farm.js', { allowBuiltins: [], allowedRelative: [] });
        assertCleanImport('src/agent/areas/open_farm.js');
    });

    test('the connected farmland with its water and the path among it, boxed with a margin of 1 and a height of 2', () => {
        const world = openField();
        const farm = F.findOpenFarm(world.getBlockName, { x: 3.5, y: 64, z: 5.5 });
        assert.equal(farm.found, true);
        assert.deepEqual({ min: farm.min, max: farm.max }, { min: { x: -1, y: 63, z: -1 }, max: { x: 8, y: 65, z: 3 } }, 'the river is no part');
        assert.deepEqual(farm.field, { min: { x: 0, y: 63, z: 0 }, max: { x: 7, y: 63, z: 2 } }, 'the field itself, the path at x 7 among it');
        assert.equal(farm.farmland, 20);
    });

    test('no farmland within 24 blocks: not found; a bad getter or origin never throws', () => {
        const world = openField();
        assert.equal(F.findOpenFarm(world.getBlockName, { x: 40.5, y: 64, z: 0.5 }).found, false);
        assert.equal(F.findOpenFarm(null, { x: 0, y: 64, z: 0 }).found, false);
        assert.equal(F.findOpenFarm(() => { throw new Error('x'); }, { x: 0, y: 64, z: 0 }).found, false);
        assert.equal(F.findOpenFarm(world.getBlockName, null).found, false);
    });
});

describe('!rememberArea(name, "farm") with no fence (P-18, SPEC 8.2 point 3)', () => {
    test('the open farm is saved with its crops, border open, word for word; the size is the field\'s, the box keeps its margin', async () => {
        const agent = areaAgent(openField(), { x: 3.5, y: 64, z: 4.5 });
        const reply = await typed(agent, '!rememberArea("carrots", "farm")');
        assert.equal(reply, 'I saved "carrots": an open farm 8 x 3 with 11 carrots and 9 potatoes.');
        const area = agent.area_store.get('carrots');
        assert.deepEqual({ min: area.min, max: area.max }, { min: { x: -1, y: 63, z: -1 }, max: { x: 8, y: 65, z: 3 } }, 'the box: 10 x 5 with the margin');
        assert.equal(area.type, 'farm');
        assert.equal(area.border, 'open');
        assert.deepEqual(area.entrances, []);
    });

    test('the field of the spec\'s example: 9 x 5 of farmland saved in a box of 11 x 7', async () => {
        const world = createBlockWorld().flatGround(63);
        world.fill(0, 63, 0, 8, 63, 4, 'farmland');
        world.fill(0, 64, 0, 8, 64, 2, 'carrots');
        const agent = areaAgent(world, { x: 4.5, y: 64, z: 6.5 });
        assert.equal(await typed(agent, '!rememberArea("carrots", "farm")'), 'I saved "carrots": an open farm 9 x 5 with 27 carrots.');
        const area = agent.area_store.get('carrots');
        assert.equal(area.max.x - area.min.x + 1, 11);
        assert.equal(area.max.z - area.min.z + 1, 7);
    });

    test('no farmland and no fence: the text of 8.11, nothing saved', async () => {
        const agent = areaAgent(createBlockWorld().flatGround(63), { x: 0.5, y: 64, z: 0.5 });
        assert.equal(await typed(agent, '!rememberArea("carrots", "farm")'),
            'I see no farmland within 24 blocks of me and no fence. Stand on the field and say it again.');
        assert.equal(agent.area_store.list().length, 0);
    });

    test('a fenced farm as before', async () => {
        const world = createBlockWorld().flatGround(63);
        const field = world.field({ x: 0, y: 63, z: 0, width: 5, depth: 5 });
        const agent = areaAgent(world, { x: field.inside.x + 0.5, y: 64, z: field.inside.z + 0.5 });
        const reply = await typed(agent, '!rememberArea("wheat", "farm")');
        assert.match(reply, /^I saved "wheat": a farm, fenced, /, reply);
        assert.equal(agent.area_store.get('wheat').border, 'fence');
    });

    test('the farming pack finds the open farm as a farm, marked open (worked on its farmland only)', () => {
        const area = { name: 'carrots', type: 'farm', min: { x: -1, y: 63, z: -1 }, max: { x: 8, y: 65, z: 3 }, dimension: 'overworld', entrances: [],
            border: 'open' };
        const bot = { entity: { position: vec(3.5, 64, 4.5) }, game: { dimension: 'overworld' }, blockAt: () => null };
        const r = FARM.findFarm(bot, { areas: [area] }, '');
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.equal(r.farm.open, true);
        assert.equal(FARM.findFarm(bot, { areas: [{ ...area, border: 'fence' }] }, '').farm.open, false);
    });
});
