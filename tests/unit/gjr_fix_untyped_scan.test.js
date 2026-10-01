// Release v0.1.4.10, fix round, T3-6 (engineer E3): `!rememberArea("chicken pen")` typed inside the pen without a
// type saved the house beyond the fence (the fence is built blocks too, and the scan of a building took the house).
// Decision: a scan without a type that starts inside a fenced enclosure (scanPen finds one around the bot) saves the
// pen; with a type given nothing changes. scanWithoutType of src/agent/areas/area_scan.js, and !rememberArea and
// !rememberHere of src/agent/commands/actions.js. The parser fills in the default "building" for a missing type, so
// the command takes "building" as no type.
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

const scan = await loadSrc('src/agent/areas/area_scan.js');

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

const BASE = { language: 'en', world_memory: true, protected_areas: true, player_rules: true, area_floors: false, home_pack: false,
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
    const cmd = M.actions.actionsList.find((c) => c.name === name);
    assert.ok(cmd, `${name} exists`);
    return cmd;
};

// The scene of W89: a house of 11 x 11 and, 2 blocks east of it, a pen of 7 x 7 grass behind an oak fence with a gate
// in its south side.
function penBesideHouse() {
    const world = createBlockWorld().flatGround(63);
    const house = world.house({ x: 0, y: 63, z: 0, width: 11, depth: 11, wallHeight: 4 });
    const pen = world.field({ x: 13, y: 63, z: 2, width: 7, depth: 7, ground: 'grass_block', crop: null });
    return { world, house, pen, inPen: { x: pen.inside.x + 0.5, y: 64, z: pen.inside.z + 0.5 },
        inHouse: { x: house.inside.x + 0.5, y: house.inside.y, z: house.inside.z + 0.5 } };
}

const PEN_BOX = { min: { x: 12, y: 62, z: 1 }, max: { x: 20, y: 66, z: 9 } };
const HOUSE_BOX = { min: { x: -1, y: 62, z: -1 }, max: { x: 11, y: 69, z: 11 } };
const boxOf = (r) => ({ min: r.min, max: r.max });

function areaAgent(world, at) {
    const store = new AS.AreaStore(path.join(dir, 'areas.json'), { now: NOW });
    store.load();
    const places = new Map();
    return {
        name: 'andy', area_store: store, running_commands: [],
        memory_bank: { rememberPlace(name, x, y, z, dimension) { places.set(name, { x, y, z, dimension }); return true; } },
        bot: { username: 'andy', entity: { position: vec(at.x, at.y, at.z) }, game: { dimension: 'overworld' }, blockAt: (pos) => world.blockAt(pos) },
    };
}

describe('T3-6: scanWithoutType', () => {
    test('inside the pen: the pen, not the house beyond the fence (the old scan of a building took the house)', () => {
        const s = penBesideHouse();
        assert.deepEqual(boxOf(scan.scanBuilding(s.world.getBlockName, s.inPen)), HOUSE_BOX, 'the defect of W89');
        const r = scan.scanWithoutType(s.world.getBlockName, s.inPen);
        assert.equal(r.found, true);
        assert.equal(r.kind, 'pen');
        assert.deepEqual(boxOf(r), PEN_BOX);
        assert.deepEqual(r.entrances, [{ x: 16, y: 64, z: 9, kind: 'gate' }]);
    });

    test('inside the house: the building, as before', () => {
        const s = penBesideHouse();
        const r = scan.scanWithoutType(s.world.getBlockName, s.inHouse);
        assert.equal(r.kind, 'building');
        assert.deepEqual(boxOf(r), HOUSE_BOX);
        assert.deepEqual(r, { ...scan.scanBuilding(s.world.getBlockName, s.inHouse), kind: 'building' });
    });

    test('outside both, on open grass: the scan of a building, as before', () => {
        const s = penBesideHouse();
        const at = { x: 30.5, y: 64, z: 30.5 };
        assert.deepEqual(scan.scanWithoutType(s.world.getBlockName, at), { ...scan.scanBuilding(s.world.getBlockName, at), kind: 'building' });
    });

    test('a fenced field with farmland is no pen: the scan of a building, as before', () => {
        const world = createBlockWorld().flatGround(63);
        const field = world.field({ x: 0, y: 63, z: 0, width: 5, depth: 5 });
        const at = { x: field.inside.x + 0.5, y: 64, z: field.inside.z + 0.5 };
        assert.equal(scan.scanWithoutType(world.getBlockName, at).kind, 'building');
    });

    test('bad arguments throw a TypeError, as the other scans', () => {
        assert.throws(() => scan.scanWithoutType(null, { x: 0, y: 0, z: 0 }), TypeError);
        assert.throws(() => scan.scanWithoutType(() => 'air', { x: Number.NaN, y: 0, z: 0 }), TypeError);
    });
});

describe('T3-6: !rememberArea without a type inside a pen', () => {
    test('typed !rememberArea("chicken pen") in the pen: the pen is saved as a pen, the reply says why', async () => {
        const s = penBesideHouse();
        const agent = areaAgent(s.world, s.inPen);
        const parsed = M.index.parseCommandMessage('!rememberArea("chicken pen")');
        assert.deepEqual(parsed.args, ['chicken pen', 'building'], 'the parser fills in the default');
        const reply = await command('!rememberArea').perform(agent, ...parsed.args);
        assert.equal(reply, 'I stand inside a fence, so I saved the pen. Area "chicken_pen" (pen) saved: 9 x 5 x 9 blocks, '
            + 'from (12, 62, 1) to (20, 66, 9), 1 gate. Tell me if that is wrong.');
        const area = agent.area_store.get('chicken pen');
        assert.equal(area.type, 'pen');
        assert.deepEqual(boxOf(area), PEN_BOX);
        assert.equal(agent.area_store.list().length, 1, 'the house is not saved');
    });

    test('with a type given nothing changes: "home" in the pen scans a building', async () => {
        const s = penBesideHouse();
        const agent = areaAgent(s.world, s.inPen);
        const reply = await command('!rememberArea').perform(agent, 'home', 'home');
        assert.match(reply, /^Area "home" \(home\) saved: /);
        assert.deepEqual(boxOf(agent.area_store.get('home')), HOUSE_BOX);
    });

    test('with the type pen: the fenced ground as before', async () => {
        const s = penBesideHouse();
        const agent = areaAgent(s.world, s.inPen);
        const reply = await command('!rememberArea').perform(agent, 'chicken pen', 'pen');
        assert.match(reply, /^Area "chicken_pen" \(pen\) saved: 9 x 5 x 9 blocks/);
    });

    test('without a type inside the house: the house, as before', async () => {
        const s = penBesideHouse();
        const agent = areaAgent(s.world, s.inHouse);
        const reply = await command('!rememberArea').perform(agent, 'house', 'building');
        assert.match(reply, /^Area "house" \(building\) saved: 13 x 8 x 13 blocks/);
    });

    test('the pen box under another name already: refused as any box', async () => {
        const s = penBesideHouse();
        const agent = areaAgent(s.world, s.inPen);
        await command('!rememberArea').perform(agent, 'pen', 'pen');
        assert.equal(await command('!rememberArea').perform(agent, 'chicken pen', 'building'), 'That is the area "pen" already.');
        assert.equal(agent.area_store.list().length, 1);
    });
});

describe('T3-6: !rememberHere inside a pen', () => {
    test('the place is saved and the pen around it, not the house', async () => {
        const s = penBesideHouse();
        const agent = areaAgent(s.world, s.inPen);
        const reply = await command('!rememberHere').perform(agent, 'chickens');
        assert.equal(reply, 'Location saved as "chickens". I also saved the fenced pen around it as a protected area: 9 x 5 x 9 blocks, 1 gate.');
        assert.equal(agent.area_store.get('chickens').type, 'pen');
        assert.deepEqual(boxOf(agent.area_store.get('chickens')), PEN_BOX);
    });

    test('inside the house: the building as before', async () => {
        const s = penBesideHouse();
        const agent = areaAgent(s.world, s.inHouse);
        const reply = await command('!rememberHere').perform(agent, 'home');
        assert.match(reply, /^Location saved as "home"\. I also saved the building around it as a protected area: 13 x 8 x 13 blocks, 1 door\.$/);
        assert.equal(agent.area_store.get('home').type, 'home');
    });
});
