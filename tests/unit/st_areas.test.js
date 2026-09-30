// T1, spec v0.1.4.8 section 7 (part D) and the interfaces I3, I4, tested from the spec and the handoff:
//   D1 types and names, doubles merged, the one-time changes of an old file, with the areas file of the
//      owner of the play test (two areas "mining area" and "mining_area" of type building with the same
//      box, a pen of 1 x 3 x 1, a farm): it becomes `farm` and one `mining_area` of type `mine`;
//   D2 every row and every column of the table of the rules per type, and !allowChanges for every type;
//   D3 built blocks outside every area with protect_built_blocks, the command of the player, the path
//      search (cost 100), the new names of isBuiltBlock; the switch off gives v0.1.4.7;
//   D4 the blocks the bot placed; D6 autoHome; D7 canReplace; I3 the guard view; I4 AREA_TYPES.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';

const storeMod = await loadSrc('src/agent/areas/area_store.js');
const guardMod = await loadSrc('src/agent/areas/area_guard.js');
const scanMod = await loadSrc('src/agent/areas/area_scan.js');
const placedMod = await loadSrc('src/agent/areas/placed_store.js');
const autoMod = await loadSrc('src/agent/areas/auto_home.js');
const homeKinds = await loadSrc('src/agent/packs/home/area_kinds.js');
const creeperLogic = await loadSrc('src/agent/packs/home/creeper_logic.js');
const shelterLogic = await loadSrc('src/agent/packs/home/shelter_logic.js');

// The areas file of the owner (bots/claude/worlds/seed-ce66bf80acdefa75/areas.json, 2026-09-29), copied.
const OWNER_AREAS = {
    version: 1,
    areas: {
        cow_chicken_pen: { name: 'cow_chicken_pen', type: 'building', min: { x: -10, y: 62, z: 47 }, max: { x: -10, y: 64, z: 47 },
            dimension: 'overworld', entrances: [], source: 'manual', created: '2026-09-28T23:21:38.859Z', updated: '2026-09-28T23:21:41.977Z' },
        farm: { name: 'farm', type: 'farm', min: { x: -13, y: 61, z: 23 }, max: { x: -6, y: 65, z: 34 }, dimension: 'overworld',
            entrances: [{ x: -6, y: 63, z: 28, kind: 'gate' }], source: 'scan', created: '2026-09-28T21:41:48.717Z', updated: '2026-09-28T21:41:48.717Z' },
        'mining area': { name: 'mining area', type: 'building', min: { x: 6, y: 38, z: 36 }, max: { x: 12, y: 58, z: 49 },
            dimension: 'overworld', entrances: [], source: 'scan', created: '2026-09-28T21:46:15.137Z', updated: '2026-09-28T21:46:15.137Z' },
        mining_area: { name: 'mining_area', type: 'building', min: { x: 6, y: 38, z: 36 }, max: { x: 12, y: 58, z: 49 },
            dimension: 'overworld', entrances: [{ x: 9, y: 41, z: 43, kind: 'door' }, { x: 10, y: 41, z: 43, kind: 'door' }],
            source: 'scan', created: '2026-09-28T22:00:38.108Z', updated: '2026-09-28T22:00:38.108Z' },
    },
};

const FENCE_TEXT = 'oak_fence is a block that players build with. I do not break it. The player can type the command !collectBlocks("oak_fence", 20) in the chat to do it.';

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

function writeAreas(content) {
    const file = path.join(dir, 'areas.json');
    fs.writeFileSync(file, JSON.stringify(content, null, 2));
    return file;
}

function box(min, max) {
    return { min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] } };
}

// A fake bot for the guard: blocks by name from a BlockWorld, dig and placeBlock that change it.
function guardBot(world) {
    const bot = {
        game: { dimension: 'overworld' },
        heldItem: null,
        inventory: { slots: new Array(46).fill(null) },
        placed: [],
        dug: [],
        blockAt(p) {
            const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
            const name = world.get(x, y, z);
            return name === null ? null : { name, position: { x, y, z } };
        },
        async dig(block) {
            bot.dug.push(block.position);
            world.set(block.position.x, block.position.y, block.position.z, 'air');
        },
        async placeBlock(reference, face) {
            const t = { x: reference.position.x + face.x, y: reference.position.y + face.y, z: reference.position.z + face.z };
            bot.placed.push(t);
            world.set(t.x, t.y, t.z, bot.heldItem?.name ?? 'cobblestone');
        },
        async activateBlock() {},
        pathfinder: { movements: null, setMovements() {}, getPathTo() { return { status: 'success', path: [] }; } },
        on() {},
        once() {},
    };
    return bot;
}

function installGuard(world, areas, options = {}) {
    const store = new storeMod.AreaStore(path.join(dir, 'guard_areas.json'));
    for (const a of areas) store.set(a);
    const bot = guardBot(world);
    const guard = guardMod.installAreaGuard(bot, { store, log: () => {}, ...options });
    return { bot, guard, store };
}

// ---------------------------------------------------------------------------------------- I4, D1

describe('I4: AREA_TYPES', () => {
    test('the five types, in the order of the spec, frozen', () => {
        assert.deepEqual([...storeMod.AREA_TYPES], ['home', 'building', 'farm', 'pen', 'mine']);
        assert.ok(Object.isFrozen(storeMod.AREA_TYPES));
    });

    test('the store takes every type and refuses others', () => {
        const store = new storeMod.AreaStore(path.join(dir, 'a.json'));
        for (const type of storeMod.AREA_TYPES) {
            store.set({ name: `a_${type}`, type, ...box([0, 60, 0], [4, 64, 4]) });
            assert.equal(store.get(`a_${type}`).type, type);
        }
        assert.throws(() => store.set({ name: 'x', type: 'castle', ...box([0, 60, 0], [4, 64, 4]) }));
    });
});

describe('D1: names are normalised on save and on lookup', () => {
    test('trimmed, lower case, spaces to _', () => {
        assert.equal(storeMod.normalizeAreaName('  Mining Area '), 'mining_area');
        assert.equal(storeMod.normalizeAreaName('Farm'), 'farm');
    });

    test('!rememberHere "mining area" and !rememberArea "mining_area" are one area (P7)', () => {
        const store = new storeMod.AreaStore(path.join(dir, 'a.json'));
        store.set({ name: 'Mining Area', type: 'mine', ...box([6, 38, 36], [12, 58, 49]) });
        store.set({ name: 'mining_area', type: 'mine', ...box([6, 38, 36], [12, 58, 49]) });
        assert.equal(store.size, 1);
        assert.equal(store.get('MINING AREA')?.name, 'mining_area');
        assert.equal(store.get(' mining area ')?.name, 'mining_area');
    });
});

describe('D1: on load', () => {
    test('two areas whose normalised names are equal become one, the newer wins', () => {
        const file = writeAreas({ version: 1, migrated: 1, areas: {
            'Old Barn': { name: 'Old Barn', type: 'building', ...box([0, 60, 0], [5, 65, 5]), created: '2026-09-28T10:00:00.000Z', updated: '2026-09-28T10:00:00.000Z' },
            old_barn: { name: 'old_barn', type: 'building', ...box([20, 60, 20], [25, 65, 25]), created: '2026-09-28T11:00:00.000Z', updated: '2026-09-28T11:00:00.000Z' },
        } });
        const store = new storeMod.AreaStore(file);
        assert.equal(store.load(), 1);
        assert.deepEqual(store.get('old_barn').min, { x: 20, y: 60, z: 20 });
    });

    test('the newer wins also when it comes first in the file', () => {
        const file = writeAreas({ version: 1, migrated: 1, areas: {
            old_barn: { name: 'old_barn', type: 'building', ...box([20, 60, 20], [25, 65, 25]), created: '2026-09-28T11:00:00.000Z', updated: '2026-09-28T11:00:00.000Z' },
            'Old Barn': { name: 'Old Barn', type: 'building', ...box([0, 60, 0], [5, 65, 5]), created: '2026-09-28T10:00:00.000Z', updated: '2026-09-28T10:00:00.000Z' },
        } });
        const store = new storeMod.AreaStore(file);
        store.load();
        assert.deepEqual(store.get('old_barn').min, { x: 20, y: 60, z: 20 });
    });

    test('once, an old file: a building whose name holds mine or mining becomes a mine; a side of less than 2 blocks is dropped; both written to the console', () => {
        const file = writeAreas({ version: 1, areas: {
            iron_mine: { name: 'iron_mine', type: 'building', ...box([0, 30, 0], [5, 60, 5]) },
            'mining shaft': { name: 'mining shaft', type: 'building', ...box([20, 30, 0], [25, 60, 5]) },
            jasmine_house: { name: 'jasmine_house', type: 'building', ...box([40, 60, 0], [45, 65, 5]) },
            thin_x: { name: 'thin_x', type: 'pen', ...box([60, 60, 0], [60, 62, 10]) },
            thin_z: { name: 'thin_z', type: 'farm', ...box([70, 60, 0], [80, 62, 0]) },
            two_wide: { name: 'two_wide', type: 'pen', ...box([90, 60, 0], [91, 62, 1]) },
        } });
        const store = new storeMod.AreaStore(file);
        store.load();
        assert.equal(store.get('iron_mine').type, 'mine');
        assert.equal(store.get('mining_shaft').type, 'mine');
        assert.equal(store.get('jasmine_house').type, 'building', 'the handoff: a word that starts with mine or mining');
        assert.equal(store.get('thin_x'), undefined);
        assert.equal(store.get('thin_z'), undefined);
        assert.ok(store.get('two_wide'), 'a side of 2 blocks stays');
        const logged = cap.allText();
        for (const name of ['iron_mine', 'mining_shaft', 'thin_x', 'thin_z']) {
            assert.ok(logged.includes(name), `the console names ${name}: ${logged}`);
        }
    });

    test('the one-time changes run once: an area the player saves later as a building named mine stays a building', () => {
        const file = writeAreas({ version: 1, areas: {
            old_mine: { name: 'old_mine', type: 'building', ...box([0, 30, 0], [5, 60, 5]) },
        } });
        const first = new storeMod.AreaStore(file);
        first.load();
        assert.equal(first.get('old_mine').type, 'mine');
        first.set({ name: 'mine_house', type: 'building', ...box([20, 60, 20], [25, 65, 25]) });
        const again = new storeMod.AreaStore(file);
        again.load();
        assert.equal(again.get('mine_house').type, 'building');
        assert.equal(again.get('old_mine').type, 'mine');
    });

    test('play test: the owner\'s areas file becomes `farm` and one `mining_area` of type `mine` with 2 doors, no pen', () => {
        const file = writeAreas(OWNER_AREAS);
        const store = new storeMod.AreaStore(file);
        assert.equal(store.load(), 2);
        assert.deepEqual(store.list().map((a) => a.name).sort(), ['farm', 'mining_area']);
        const mine = store.get('mining_area');
        assert.equal(mine.type, 'mine');
        assert.equal(mine.entrances.filter((e) => e.kind === 'door').length, 2, 'the newer entry, with 2 doors');
        assert.equal(store.get('farm').type, 'farm');
        assert.equal(store.get('cow_chicken_pen'), undefined, 'the pen of 1 x 3 x 1 is dropped');
        // the file is written again and a second load finds the same
        const again = new storeMod.AreaStore(file);
        assert.equal(again.load(), 2);
        assert.equal(again.get('mining_area').type, 'mine');
    });
});

// ---------------------------------------------------------------------------------- D2, I3

describe('D2: the rules per type', () => {
    // one area of each type, far apart; in each: stone (natural), oak_planks (built), wheat (crop)
    const AREAS = {
        home: box([0, 60, 0], [10, 70, 10]),
        building: box([100, 60, 0], [110, 70, 10]),
        pen: box([200, 60, 0], [210, 70, 10]),
        farm: box([300, 60, 0], [310, 70, 10]),
        mine: box([400, 30, 0], [410, 70, 10]),
    };
    const at = (type, dx = 5, dy = 64, dz = 5) => ({ x: AREAS[type].min.x + dx, y: dy, z: AREAS[type].min.z + dz });

    function setup(options = {}) {
        const world = createBlockWorld().flatGround(63);
        for (const type of Object.keys(AREAS)) {
            const s = at(type);
            world.set(s.x, 64, s.z, 'stone');
            world.set(s.x + 1, 64, s.z, 'oak_planks');
            world.set(s.x + 2, 64, s.z, 'wheat');
        }
        const areas = Object.entries(AREAS).map(([type, b]) => ({ name: `${type}_area`, type, ...b }));
        return { world, ...installGuard(world, areas, options) };
    }
    const block = (world, p) => ({ name: world.get(p.x, p.y, p.z), position: p });

    // [type, break natural, break built, break crop, place block, place seeds, path natural, path built, shelter, defended]
    const TABLE = [
        ['home', false, false, false, false, false, false, false, true, true],
        ['building', false, false, false, false, false, false, false, false, true],
        ['pen', false, false, false, false, false, false, false, false, true],
        ['farm', false, false, true, false, true, false, false, false, true],
        ['mine', true, false, true, true, true, true, false, false, false],
    ];

    for (const [type, brNat, brBuilt, brCrop, plBlock, plSeed, pathNat, pathBuilt, shelter, defended] of TABLE) {
        test(`${type}: break, place, path search, shelter, creepers`, () => {
            const { world, bot, guard } = setup();
            const stone = at(type);
            const planks = { ...stone, x: stone.x + 1 };
            const wheat = { ...stone, x: stone.x + 2 };
            assert.equal(guard.canBreak(block(world, stone)), brNat, 'break a natural block');
            assert.equal(guard.canBreak(block(world, planks)), brBuilt, 'break a built block');
            assert.equal(guard.canBreak(block(world, wheat)), brCrop, 'break a crop');
            assert.equal(bot.areaGuard.refusal(stone, 'break') === null, brNat, 'refusal of the view agrees');
            if (!brNat) {
                const r = bot.areaGuard.refusal(stone, 'break');
                assert.equal(r.reason, 'area');
                assert.equal(r.area, `${type}_area`);
                assert.equal(typeof r.text, 'string');
            }
            const free = { ...stone, y: 66 };
            assert.equal(guard.canPlace(free, 'cobblestone'), plBlock, 'place a block');
            assert.equal(guard.canPlace(free, 'wheat_seeds'), plSeed, 'place seeds');
            assert.equal(bot.areaGuard.refusal(free, 'place', { item: 'cobblestone' }) === null, plBlock);
            // the path search: the exclusion function that the guard installs, cost 100
            const movements = { exclusionAreasBreak: [], exclusionAreasPlace: [] };
            assert.equal(guard.protectMovements(movements), true);
            const cost = (b) => movements.exclusionAreasBreak.reduce((sum, fn) => sum + fn(b), 0);
            assert.equal(cost(block(world, stone)), pathNat ? 0 : 100, 'the path search digs a natural block');
            assert.equal(cost(block(world, planks)), pathBuilt ? 0 : 100, 'the path search digs a built block');
            // the table of the types as the home pack reads it
            assert.equal(storeMod.isShelterType(type), shelter, 'shelter');
            assert.equal(storeMod.isDefendedType(type), defended, 'defended against creepers');
            assert.equal(homeKinds.isShelterArea({ name: 'x', type, ...AREAS[type] }), shelter);
            assert.equal(homeKinds.isDefendedArea({ name: 'x', type, ...AREAS[type] }), defended);
        });
    }

    test('farm: the path search keeps the rule of v0.1.4.7, crops have cost 0 (handoff)', () => {
        const { world, guard } = setup();
        const movements = { exclusionAreasBreak: [], exclusionAreasPlace: [] };
        guard.protectMovements(movements);
        const wheat = { ...at('farm'), x: at('farm').x + 2 };
        assert.equal(movements.exclusionAreasBreak.reduce((s, fn) => s + fn(block(world, wheat)), 0), 0);
    });

    for (const [type] of TABLE) {
        test(`!allowChanges keeps its meaning for ${type}: a permit opens the area`, () => {
            const { world, guard } = setup();
            const planks = { ...at(type), x: at(type).x + 1 };
            guard.permit(`${type}_area`, 10);
            assert.equal(guard.canBreak(block(world, planks)), true);
            assert.equal(guard.canPlace({ ...at(type), y: 66 }, 'cobblestone'), true);
            guard.revoke(`${type}_area`);
            assert.equal(guard.canBreak(block(world, planks)), false);
        });
    }

    test('I3: refusal(pos, "use"): a fire item in a home is refused; in a farm and a mine it is not', () => {
        const { bot } = setup();
        const stone = (type) => ({ name: 'stone', position: at(type) });
        assert.equal(bot.areaGuard.refusal(stone('home'), 'use', { item: 'flint_and_steel', sneaking: false })?.reason, 'area');
        assert.equal(bot.areaGuard.refusal(stone('pen'), 'use', { item: 'flint_and_steel', sneaking: false })?.reason, 'area');
        assert.equal(bot.areaGuard.refusal(stone('farm'), 'use', { item: 'bone_meal', sneaking: false }), null);
        assert.equal(bot.areaGuard.refusal(stone('mine'), 'use', { item: 'flint_and_steel', sneaking: false }), null);
        assert.equal(bot.areaGuard.refusal({ x: 1000, y: 64, z: 1000 }, 'use', { item: 'flint_and_steel' }), null);
    });

    test('mine (handoff): a block the bot placed may be broken; a command typed by the player does not open a built block, !allowChanges does', async () => {
        const { world, bot, guard } = setup();
        const planks = { ...at('mine'), x: at('mine').x + 1 };
        guard.setPlayerOrder(() => true);
        assert.equal(bot.areaGuard.refusal(planks, 'break')?.reason, 'area', 'the order of the player does not open it');
        guard.setPlayerOrder(() => false);
        bot.heldItem = { name: 'cobblestone' };
        const free = { ...at('mine'), y: 66 };
        await bot.placeBlock({ position: { ...free, y: 65 } }, { x: 0, y: 1, z: 0 });
        assert.equal(bot.areaGuard.placedByBot(free), true);
        assert.equal(guard.canBreak({ name: 'cobblestone', position: free }), true, 'placed by the bot');
        guard.permit('mine_area', 5);
        assert.equal(guard.canBreak(block(world, planks)), true, '!allowChanges');
    });

    test('I3: inBuilding is true for home, building and pen', () => {
        const { bot } = setup();
        const expect = { home: true, building: true, pen: true, farm: false, mine: false };
        for (const [type, value] of Object.entries(expect)) assert.equal(bot.areaGuard.inBuilding(at(type)), value, type);
        assert.equal(bot.areaGuard.inBuilding({ x: 1000, y: 64, z: 1000 }), false);
    });

    test('I3: areaAt gives { name, type } of the smallest area that holds the position, null outside', () => {
        const world = createBlockWorld().flatGround(63);
        const { bot } = installGuard(world, [
            { name: 'farm', type: 'farm', ...box([0, 60, 0], [30, 70, 30]) },
            { name: 'pen', type: 'pen', ...box([5, 60, 5], [9, 66, 9]) },
        ]);
        assert.deepEqual(bot.areaGuard.areaAt({ x: 6.5, y: 64, z: 6.5 }), { name: 'pen', type: 'pen' });
        assert.deepEqual(bot.areaGuard.areaAt({ x: 20.5, y: 64, z: 20.5 }), { name: 'farm', type: 'farm' });
        assert.equal(bot.areaGuard.areaAt({ x: 50, y: 64, z: 50 }), null);
    });

    test('I3: the view is frozen and has refusal, areaAt, isBuilt, placedByBot, not setPlayerOrder', () => {
        const world = createBlockWorld().flatGround(63);
        const { bot, guard } = installGuard(world, []);
        assert.ok(Object.isFrozen(bot.areaGuard));
        for (const fn of ['refusal', 'areaAt', 'isBuilt', 'placedByBot', 'inBuilding']) assert.equal(typeof bot.areaGuard[fn], 'function', fn);
        assert.equal(bot.areaGuard.setPlayerOrder, undefined);
        assert.equal(bot.areaGuard.permit, undefined);
        assert.equal(typeof guard.setPlayerOrder, 'function');
        assert.equal(bot.areaGuard.isBuilt('oak_fence'), scanMod.isBuiltBlock('oak_fence'));
        assert.equal(bot.areaGuard.isBuilt('stone'), false);
    });
});

// ------------------------------------------------------------------------------------------ D3

describe('D3: built blocks everywhere', () => {
    function fenceWorld() {
        const world = createBlockWorld().flatGround(63);
        for (let x = 0; x < 5; x++) world.set(x, 64, 0, 'oak_fence');
        world.set(0, 64, 3, 'stone');
        return world;
    }
    const FENCE = { x: 2, y: 64, z: 0 };

    test('protect_built_blocks off (default): a fence outside every area may be broken, as in v0.1.4.7', () => {
        const world = fenceWorld();
        const { bot, guard } = installGuard(world, []);
        assert.equal(bot.areaGuard.refusal(FENCE, 'break'), null);
        assert.equal(guard.canBreak({ name: 'oak_fence', position: FENCE }), true);
    });

    test('on: refusal { reason: built_block, area: null, text } with the text of the spec', () => {
        const world = fenceWorld();
        const { bot } = installGuard(world, [], { protectBuiltBlocks: true, getCommand: () => '!collectBlocks("oak_fence", 20)' });
        assert.deepEqual(bot.areaGuard.refusal(FENCE, 'break'), { reason: 'built_block', area: null, text: FENCE_TEXT });
    });

    test('on: the block itself may be passed (handoff)', () => {
        const world = fenceWorld();
        const { bot } = installGuard(world, [], { protectBuiltBlocks: true, getCommand: () => '!collectBlocks("oak_fence", 20)' });
        assert.equal(bot.areaGuard.refusal({ name: 'oak_fence', position: FENCE }, 'break')?.reason, 'built_block');
    });

    test('on: a natural block outside the areas is no built block', () => {
        const world = fenceWorld();
        const { bot } = installGuard(world, [], { protectBuiltBlocks: true });
        assert.equal(bot.areaGuard.refusal({ x: 0, y: 64, z: 3 }, 'break'), null);
    });

    test('on: a block that the bot placed may be broken', async () => {
        const world = fenceWorld();
        const { bot } = installGuard(world, [], { protectBuiltBlocks: true });
        bot.heldItem = { name: 'oak_fence' };
        await bot.placeBlock({ position: { x: 7, y: 63, z: 0 } }, { x: 0, y: 1, z: 0 });
        assert.equal(bot.areaGuard.placedByBot({ x: 7, y: 64, z: 0 }), true);
        assert.equal(bot.areaGuard.refusal({ x: 7, y: 64, z: 0 }, 'break'), null);
        assert.equal(bot.areaGuard.refusal(FENCE, 'break')?.reason, 'built_block');
    });

    test('on: a command typed by the player overrides built_block, never area', () => {
        const world = fenceWorld();
        world.set(30, 64, 30, 'oak_planks');
        const { bot, guard } = installGuard(world, [{ name: 'house', type: 'building', ...box([28, 60, 28], [34, 70, 34]) }], { protectBuiltBlocks: true });
        guard.setPlayerOrder(() => true);
        assert.equal(bot.areaGuard.refusal(FENCE, 'break'), null, 'built_block is opened');
        assert.equal(bot.areaGuard.refusal({ x: 30, y: 64, z: 30 }, 'break')?.reason, 'area', 'area stays');
        guard.setPlayerOrder(() => false);
        assert.equal(bot.areaGuard.refusal(FENCE, 'break')?.reason, 'built_block');
    });

    test('on: the wrapped bot.dig refuses the fence; with the player\'s order it digs', async () => {
        const world = fenceWorld();
        const { bot, guard } = installGuard(world, [], { protectBuiltBlocks: true });
        await assert.rejects(bot.dig({ name: 'oak_fence', position: FENCE }), (err) => err.reason === 'built_block');
        assert.equal(world.get(2, 64, 0), 'oak_fence');
        guard.setPlayerOrder(() => true);
        await bot.dig({ name: 'oak_fence', position: FENCE });
        assert.equal(world.get(2, 64, 0), 'air');
    });

    test('on: the path search gets cost 100 for a built block outside the areas, also with the order of the player', () => {
        const world = fenceWorld();
        const { guard } = installGuard(world, [], { protectBuiltBlocks: true });
        guard.setPlayerOrder(() => true);
        const movements = { exclusionAreasBreak: [], exclusionAreasPlace: [] };
        guard.protectMovements(movements);
        const cost = (b) => movements.exclusionAreasBreak.reduce((s, fn) => s + fn(b), 0);
        assert.equal(cost({ name: 'oak_fence', position: FENCE }), 100);
        assert.equal(cost({ name: 'stone', position: { x: 0, y: 64, z: 3 } }), 0);
    });

    test('off: the path search digs a built block outside the areas (v0.1.4.7)', () => {
        const world = fenceWorld();
        const { guard } = installGuard(world, []);
        const movements = { exclusionAreasBreak: [], exclusionAreasPlace: [] };
        guard.protectMovements(movements);
        assert.equal(movements.exclusionAreasBreak.reduce((s, fn) => s + fn({ name: 'oak_fence', position: FENCE }), 0), 0);
    });

    const NEW_BUILT = ['red_bed', 'white_bed', 'oak_sign', 'oak_wall_sign', 'oak_hanging_sign', 'white_banner', 'red_wall_banner', 'composter',
        'stone_pressure_plate', 'oak_pressure_plate', 'heavy_weighted_pressure_plate', 'stone_button', 'oak_button', 'rail', 'powered_rail',
        'detector_rail', 'activator_rail', 'lever', 'flower_pot', 'campfire', 'soul_campfire', 'anvil', 'chipped_anvil', 'damaged_anvil',
        'cauldron', 'water_cauldron', 'hopper', 'bell', 'lectern', 'loom', 'shulker_box', 'red_shulker_box', 'oak_stairs', 'granite_stairs',
        'cobblestone_stairs', 'deepslate_tile_stairs', 'oak_slab', 'smooth_stone_slab', 'mud_brick_slab', 'cut_copper_slab'];
    test('isBuiltBlock gains the names of D3', () => {
        const missing = NEW_BUILT.filter((n) => !scanMod.isBuiltBlock(n));
        assert.deepEqual(missing, []);
    });

    test('natural names that would match stay natural', () => {
        const natural = ['moss_carpet', 'pale_moss_carpet', 'smooth_basalt', 'nether_quartz_ore', 'stone', 'dirt', 'grass_block', 'bedrock',
            'terracotta', 'red_terracotta', 'oak_log', 'oak_leaves', 'deepslate', 'gravel', 'sand'];
        assert.deepEqual(natural.filter((n) => scanMod.isBuiltBlock(n)), []);
    });
});

// ------------------------------------------------------------------------------------------ D4

describe('D4: what the bot placed', () => {
    test('fed by the wrapped bot.placeBlock after success; a position leaves when the bot breaks the block', async () => {
        const world = createBlockWorld().flatGround(63);
        const { bot } = installGuard(world, []);
        await bot.placeBlock({ position: { x: 3, y: 63, z: 3 } }, { x: 0, y: 1, z: 0 });
        assert.equal(bot.areaGuard.placedByBot({ x: 3, y: 64, z: 3 }), true);
        await bot.dig({ name: 'cobblestone', position: { x: 3, y: 64, z: 3 } });
        assert.equal(bot.areaGuard.placedByBot({ x: 3, y: 64, z: 3 }), false);
    });

    test('a place that fails is not noted', async () => {
        const world = createBlockWorld().flatGround(63);
        const bot = guardBot(world);
        bot.placeBlock = async () => { throw new Error('No block has been placed'); };
        guardMod.installAreaGuard(bot, { store: null, log: () => {} });
        await assert.rejects(bot.placeBlock({ position: { x: 3, y: 63, z: 3 } }, { x: 0, y: 1, z: 0 }));
        assert.equal(bot.areaGuard.placedByBot({ x: 3, y: 64, z: 3 }), false);
    });

    test('at most 5000 positions per world, the oldest leave', () => {
        assert.equal(placedMod.MAX_PLACED, 5000);
        const store = new placedMod.PlacedStore(null);
        for (let i = 0; i < 5003; i++) store.add({ x: i, y: 64, z: 0 });
        assert.equal(store.size, 5000);
        assert.equal(store.has({ x: 2, y: 64, z: 0 }), false);
        assert.equal(store.has({ x: 3, y: 64, z: 0 }), true);
        assert.equal(store.has({ x: 5002, y: 64, z: 0 }), true);
    });

    test('placed.json in the folder of the world: saved at most once per 5 s, and at the end', () => {
        const file = path.join(dir, 'placed.json');
        const timers = [];
        const store = new placedMod.PlacedStore(file, { setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
            clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); } });
        store.load();
        for (let i = 0; i < 10; i++) store.add({ x: i, y: 64, z: 0 });
        assert.equal(fs.existsSync(file), false, 'not once per block');
        assert.equal(timers.length, 1);
        assert.equal(timers[0].ms, 5000);
        timers.shift().fn();
        assert.equal(fs.existsSync(file), true);
        store.add({ x: 99, y: 64, z: 0 });
        store.flush(); // the end
        const again = new placedMod.PlacedStore(file);
        assert.equal(again.load(), 11);
        assert.equal(again.has({ x: 99, y: 64, z: 0 }), true);
    });

    test('positions are per world: the dimension counts', () => {
        const store = new placedMod.PlacedStore(null);
        store.add({ x: 1, y: 64, z: 1 }, 'overworld');
        assert.equal(store.has({ x: 1, y: 64, z: 1 }, 'the_nether'), false);
        assert.equal(store.has({ x: 1, y: 64, z: 1 }, 'minecraft:overworld'), true);
    });
});

// ------------------------------------------------------------------------------------------ D6

describe('D6: the house', () => {
    const HOME = { x: 12, y: 67, z: 52 };
    function houseWorld() {
        const world = createBlockWorld().flatGround(66);
        const house = world.house({ x: 8, y: 66, z: 47, width: 9, depth: 11, wallHeight: 4 });
        // a second door on the north side
        world.set(12, 67, 47, 'oak_door', { half: 'lower', open: false });
        world.set(12, 68, 47, 'oak_door', { half: 'upper', open: false });
        return { world, house };
    }
    const places = (p) => ({ recall: (name) => (name === 'home' ? { ...p, dimension: 'overworld' } : null) });

    test('no area of type home, the place home within 48 blocks: saved as "home", type home, source auto, with the text', () => {
        const { world } = houseWorld();
        const store = new storeMod.AreaStore(path.join(dir, 'areas.json'));
        const r = autoMod.autoHome(world.getBlockName, places(HOME), store, { x: 20, y: 67, z: 60 }, { dimension: 'overworld' });
        assert.equal(r.saved, true);
        const area = store.get('home');
        assert.equal(area.type, 'home');
        assert.equal(area.source, 'auto');
        const size = { x: area.max.x - area.min.x + 1, y: area.max.y - area.min.y + 1, z: area.max.z - area.min.z + 1 };
        const doors = area.entrances.filter((e) => e.kind === 'door').length;
        assert.equal(doors, 2);
        assert.equal(r.text, `I saved your house as the area "home": ${size.x} x ${size.y} x ${size.z} blocks, 2 doors. Tell me if that is wrong.`);
    });

    test('the place home in the open: the text asks the player', () => {
        const world = createBlockWorld().flatGround(66);
        const store = new storeMod.AreaStore(path.join(dir, 'areas.json'));
        const r = autoMod.autoHome(world.getBlockName, places(HOME), store, HOME, { dimension: 'overworld' });
        assert.equal(r.saved, false);
        assert.equal(r.text, 'I know the place "home" but I find no walls there. Stand in your house and tell me that this is home.');
        assert.equal(store.size, 0);
    });

    test('at most one try per start', () => {
        const world = createBlockWorld().flatGround(66);
        const store = new storeMod.AreaStore(path.join(dir, 'areas.json'));
        autoMod.autoHome(world.getBlockName, places(HOME), store, HOME, { dimension: 'overworld' });
        const { world: built } = houseWorld();
        const r = autoMod.autoHome(built.getBlockName, places(HOME), store, HOME, { dimension: 'overworld' });
        assert.equal(r.saved, false);
        assert.equal(store.size, 0);
    });

    test('nothing when an area of type home exists, when the place is farther than 48 blocks, or not loaded', () => {
        const { world } = houseWorld();
        const withHome = new storeMod.AreaStore(path.join(dir, 'a1.json'));
        withHome.set({ name: 'my_house', type: 'home', ...box([100, 60, 100], [110, 70, 110]) });
        assert.equal(autoMod.autoHome(world.getBlockName, places(HOME), withHome, HOME).saved, false);
        assert.equal(withHome.get('home'), undefined);

        const far = new storeMod.AreaStore(path.join(dir, 'a2.json'));
        assert.equal(autoMod.autoHome(world.getBlockName, places(HOME), far, { x: HOME.x + 49, y: 67, z: HOME.z }).saved, false);
        assert.equal(far.size, 0);

        const unloaded = new storeMod.AreaStore(path.join(dir, 'a3.json'));
        world.setLoaded({ min: { x: 100, y: 0, z: 100 }, max: { x: 200, y: 100, z: 200 } });
        assert.equal(autoMod.autoHome(world.getBlockName, places(HOME), unloaded, HOME).saved, false);
        world.setLoaded(null);
        assert.equal(autoMod.autoHome(world.getBlockName, places(HOME), unloaded, HOME).saved, true, 'not loaded does not use up the try (handoff)');
    });

    test('handoff: an area named home of type building becomes type home without a scan', () => {
        const world = createBlockWorld().flatGround(66);
        const store = new storeMod.AreaStore(path.join(dir, 'areas.json'));
        store.set({ name: 'home', type: 'building', ...box([8, 66, 47], [16, 71, 57]) });
        const r = autoMod.autoHome(world.getBlockName, places(HOME), store, HOME);
        assert.equal(r.saved, true);
        assert.equal(store.get('home').type, 'home');
    });

    test('the saved house is the shelter of the home pack (C4)', () => {
        const { world } = houseWorld();
        const store = new storeMod.AreaStore(path.join(dir, 'areas.json'));
        autoMod.autoHome(world.getBlockName, places(HOME), store, HOME, { dimension: 'overworld' });
        const choice = shelterLogic.chooseShelter({ areas: store.list(), home: { ...HOME, dimension: 'overworld' }, botPos: { x: 0, y: 64, z: 0 }, dimension: 'overworld' });
        assert.equal(choice.kind, 'area');
        assert.equal(choice.area.name, 'home');
    });
});

// ------------------------------------------------------------------------------------------ D7

describe('D7: replacing an area', () => {
    const PEN = { name: 'cow_chicken_pen', type: 'pen', ...box([-22, 62, 35], [-(-2), 74, 59]) };

    test('the model may not save a box with a side of less than 2 blocks; the player may', () => {
        assert.equal(storeMod.canReplace(null, box([0, 60, 0], [0, 62, 10]), false), false);
        assert.equal(storeMod.canReplace(null, box([0, 60, 0], [10, 62, 0]), false), false);
        assert.equal(storeMod.canReplace(null, box([0, 60, 0], [0, 62, 10]), true), true);
        assert.equal(storeMod.canReplace(null, box([0, 60, 0], [1, 62, 1]), false), true);
    });

    test('play test: the model shrinks the pen of 25 x 13 x 25 to 1 x 3 x 1: refused', () => {
        const pen = { name: 'cow_chicken_pen', type: 'pen', ...box([-22, 62, 35], [-(-2), 74, 59]) };
        assert.equal(storeMod.canReplace(pen, box([-10, 62, 47], [-10, 64, 47]), false), false);
        assert.equal(storeMod.canReplace(pen, box([-10, 62, 47], [-10, 64, 47]), true), true);
    });

    test('less than half the volume: refused with the text of the spec', () => {
        const old = { name: 'farm', type: 'farm', ...box([0, 60, 0], [9, 64, 9]) }; // 500
        const smaller = box([0, 60, 0], [4, 64, 8]); // 225
        assert.equal(storeMod.canReplace(old, smaller, false), false);
        assert.equal(storeMod.replaceRefusal(old, smaller, false)?.text,
            'The new box is much smaller than the area "farm" that I know. The player can type !setArea in the chat to do it.');
        assert.equal(storeMod.canReplace(old, smaller, true), true);
        assert.equal(storeMod.canReplace(old, box([0, 60, 0], [4, 64, 9]), false), true, 'half the volume is allowed');
        assert.equal(PEN.type, 'pen');
    });
});

// --------------------------------------------------------------------- D2 and C3 together

describe('D2 with the home pack: creepers count only for defended types', () => {
    const area = (type) => ({ name: type, type, ...box([0, 60, 0], [10, 70, 10]) });
    const creeper = { x: 20, y: 64, z: 5 }; // 9 blocks from the box, at its height

    for (const type of ['home', 'building', 'pen', 'farm']) {
        test(`${type}: a creeper 9 blocks away at its height counts`, () => {
            assert.equal(creeperLogic.countsForArea(area(type), creeper), true);
        });
    }

    test('mine: a creeper near the mine does not count', () => {
        assert.equal(creeperLogic.countsForArea(area('mine'), creeper), false);
    });
});
