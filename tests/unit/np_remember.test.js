// Release v0.1.4.11, part P (engineer E3): !rememberArea of src/agent/commands/actions.js (SPEC P1, I5).
//   - without a type (the parser fills in "building") the kind is concluded from the enclosure and its contents, and
//     the answer is that of P1, word for word: a pen, a farm, a home, a storage, a building, a yard;
//   - with a type the owner's word is the kind; the same name again with another type changes the kind and keeps the
//     box; the box of a saved area under another name is refused as in v0.1.4.10; no border: nothing is saved;
//   - the area record gets kind, contents and border.
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

const BASE = { language: 'en', world_memory: true, protected_areas: true, player_rules: true, area_floors: false, home_pack: false, blocked_actions: [] };
const NOW = () => new Date('2026-10-02T10:00:00Z');
const NO_BORDER = 'I find no border around me: no fence, wall, hedge or water within 24 blocks. Stand inside the place and say it again.';

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

const remember = (agent, ...args) => M.actions.actionsList.find((c) => c.name === '!rememberArea').perform(agent, ...args);
const typed = async (agent, text) => {
    const parsed = M.index.parseCommandMessage(text);
    assert.equal(typeof parsed, 'object', parsed);
    return remember(agent, ...parsed.args);
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

const inside = (p) => ({ x: p.x + 0.5, y: p.y, z: p.z + 0.5 });
const chickens = (n, x0, z) => Array.from({ length: n }, (_, i) => ({ name: 'chicken', type: 'animal', position: vec(x0 + 0.5 + i, 64, z + 0.5) }));

function aviary() {
    const world = createBlockWorld().flatGround(63);
    const pen = world.field({ x: 0, y: 63, z: 0, width: 7, depth: 5, ground: 'grass_block', crop: null });
    return areaAgent(world, inside(pen.inside), chickens(6, 0, 0));
}

describe('P1: the kind concluded without a type, word for word', () => {
    test('a pen: fenced, 9 x 7, 1 gate, 6 chickens; the record has the kind, the contents and the border', async () => {
        const agent = aviary();
        assert.equal(await typed(agent, '!rememberArea("aviary")'),
            'I saved "aviary": a pen, fenced, 9 x 7, 1 gate, 6 chickens. I keep its gate closed and pick nothing up inside it.');
        const area = agent.area_store.get('aviary');
        assert.equal(area.kind, 'pen');
        assert.equal(area.type, 'pen');
        assert.equal(area.border, 'fence');
        assert.deepEqual(area.contents.animals, { chicken: 6 });
        assert.deepEqual(area.entrances, [{ x: 3, y: 64, z: 5, kind: 'gate' }]);
        assert.equal(area.source, 'scan');
    });

    test('a farm: fenced, 8 x 12, 1 gate, 40 wheat', async () => {
        const world = createBlockWorld().flatGround(63);
        const field = world.field({ x: 0, y: 63, z: 0, width: 6, depth: 10 });
        for (let i = 0; i < 20; i++) world.set(i % 6, 64, 6 + Math.floor(i / 6), 'air'); // 40 of the 60 wheat stay
        const agent = areaAgent(world, inside(field.inside));
        assert.equal(await typed(agent, '!rememberArea("wheat_farm")'), 'I saved "wheat_farm": a farm, fenced, 8 x 12, 1 gate, 40 wheat. I only plant and harvest there.');
        assert.equal(agent.area_store.get('wheat_farm').type, 'farm');
    });

    test('a home: walled, 9 x 11 with a roof, 1 door, 1 bed, 2 chests', async () => {
        const world = createBlockWorld().flatGround(63);
        const house = world.house({ x: 0, y: 63, z: 0, width: 7, depth: 9 });
        world.set(5, 64, 7, 'chest');
        const agent = areaAgent(world, inside(house.inside));
        assert.equal(await typed(agent, '!rememberArea("home")'), 'I saved "home": a home, walled, 9 x 11 with a roof, 1 door, 1 bed, 2 chests. I shelter there at night.');
        assert.equal(agent.area_store.get('home').type, 'home');
    });

    test('a storage: walled, 5 x 5 with a roof, 1 door, 4 chests, 2 furnaces (the floor of area_floors)', async () => {
        M.settingsModule.setSettings({ ...BASE, area_floors: true });
        const world = createBlockWorld().flatGround(63);
        const house = world.house({ x: 0, y: 63, z: 0, width: 5, depth: 5, bed: null });
        for (const [x, z] of [[1, 1], [1, 3], [3, 3]]) world.set(x, 64, z, 'chest'); // the fourth is the one of the house at (3, 64, 1)
        world.set(0, 64, 1, 'furnace');
        world.set(4, 64, 3, 'furnace');
        const agent = areaAgent(world, inside(house.inside));
        assert.equal(await typed(agent, '!rememberArea("cellar")'), 'I saved "cellar": a storage, walled, 5 x 5 with a roof, 1 door, 4 chests, 2 furnaces. I use its chests.');
        const area = agent.area_store.get('cellar');
        assert.equal(area.kind, 'storage');
        assert.equal(area.type, 'building', 'a storage is saved as a building');
    });

    test('a building: walled, 7 x 9 with a roof, 1 door', async () => {
        const world = createBlockWorld().flatGround(63);
        const house = world.house({ x: 0, y: 63, z: 0, width: 5, depth: 7, bed: null, chest: null });
        const agent = areaAgent(world, inside(house.inside));
        assert.equal(await typed(agent, '!rememberArea("barn")'), 'I saved "barn": a building, walled, 7 x 9 with a roof, 1 door. I change nothing in it.');
    });

    test('a yard: fenced, 12 x 12, 1 gate', async () => {
        const world = createBlockWorld().flatGround(63);
        const field = world.field({ x: 0, y: 63, z: 0, width: 10, depth: 10, ground: 'grass_block', crop: null });
        const agent = areaAgent(world, inside(field.inside));
        assert.equal(await typed(agent, '!rememberArea("yard")'), 'I saved "yard": a yard, fenced, 12 x 12, 1 gate. I change nothing in it.');
        assert.equal(agent.area_store.get('yard').type, 'building', 'a yard is saved as a building');
    });

    test('no border: the text of P1, nothing is saved', async () => {
        const agent = areaAgent(createBlockWorld().flatGround(63), { x: 50.5, y: 64, z: 50.5 });
        assert.equal(await typed(agent, '!rememberArea("aviary")'), NO_BORDER);
        assert.equal(agent.area_store.size, 0);
    });
});

describe('P1: the type of the owner', () => {
    test('with a type the owner\'s word is the kind, said the same way', async () => {
        const agent = aviary();
        assert.equal(await typed(agent, '!rememberArea("aviary", "pen")'),
            'I saved "aviary": a pen, fenced, 9 x 7, 1 gate, 6 chickens. I keep its gate closed and pick nothing up inside it.');
        const world = createBlockWorld().flatGround(63);
        const house = world.house({ x: 0, y: 63, z: 0, width: 5, depth: 7, bed: null, chest: null });
        const barn = areaAgent(world, inside(house.inside));
        assert.equal(await typed(barn, '!rememberArea("barn", "home")'), 'I saved "barn": a home, walled, 7 x 9 with a roof, 1 door. I shelter there at night.');
        assert.equal(barn.area_store.get('barn').kind, 'home');
    });

    test('the same name again with another type changes the kind; the box stays', async () => {
        const agent = aviary();
        await typed(agent, '!rememberArea("aviary")');
        const before = agent.area_store.get('aviary');
        agent.bot.entity.position = vec(40.5, 64, 40.5); // the owner says it elsewhere
        assert.equal(await typed(agent, '!rememberArea("aviary", "farm")'), '"aviary" is a farm now. I only plant and harvest there.');
        const after = agent.area_store.get('aviary');
        assert.equal(after.kind, 'farm');
        assert.equal(after.type, 'farm');
        assert.deepEqual([after.min, after.max], [before.min, before.max]);
        assert.deepEqual(after.contents, before.contents);
        assert.equal(await typed(agent, '!rememberArea("Aviary", "pen")'), '"aviary" is a pen now. I keep its gate closed and pick nothing up inside it.');
    });

    test('a mine keeps the text of v0.1.4.10', async () => {
        const agent = areaAgent(createBlockWorld().flatGround(63), { x: 100.5, y: 64, z: 100.5 });
        assert.equal(await typed(agent, '!rememberArea("mine", "mine")'),
            'I saved a box of 25 x 13 x 25 blocks around this place as the mine "mine". Use !setArea to correct it.');
        assert.equal('kind' in agent.area_store.get('mine'), false);
    });

    test('a farm from outside the gate: the text of the gate before P1', async () => {
        const world = createBlockWorld().flatGround(63);
        world.field({ x: 0, y: 63, z: 0, width: 5, depth: 5 });
        const agent = areaAgent(world, { x: 2.5, y: 64, z: 7.5 });
        assert.equal(await typed(agent, '!rememberArea("farm", "farm")'),
            'I stand outside the fence. The gate is at (2, 64, 5). I saved "farm": a farm, fenced, 7 x 7, 1 gate, 25 wheat. I only plant and harvest there.');
        assert.equal(agent.area_store.get('farm').border, 'fence');
    });
});

describe('v0.1.4.10 kept', () => {
    test('the box of a saved area under another name: That is the area "aviary" already.', async () => {
        const agent = aviary();
        await typed(agent, '!rememberArea("aviary")');
        assert.equal(await typed(agent, '!rememberArea("chicken pen")'), 'That is the area "aviary" already.');
        assert.equal(agent.area_store.size, 1);
    });

    test('a bad name, an unknown type, no store', async () => {
        const agent = aviary();
        assert.equal(await remember(agent, '   ', 'building'), 'An area needs a name of 1 to 64 characters.');
        assert.equal(await remember(agent, 'x', 'castle'), 'The type of an area is "home", "building", "farm", "pen" or "mine".');
        assert.equal(await remember({ bot: agent.bot }, 'x', 'building'), 'Protected areas are off.');
    });
});
