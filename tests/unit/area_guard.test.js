// Spec v0.1.4.6 A4: src/agent/areas/area_guard.js -- the guard wraps dig, placeBlock, activateBlock
// and the pathfinder of a bot, so nothing breaks or places a block in a protected area.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';
import { createBlockWorld, vec } from '../helpers/block_world.js';

const MODULE = 'src/agent/areas/area_guard.js';
const GUARD = await loadSrc(MODULE);
const STORE = await loadSrc('src/agent/areas/area_store.js');
const require = createRequire(import.meta.url);

const T0 = Date.UTC(2026, 8, 28, 20, 0, 0);
const MINUTE = 60_000;

let dir;
let cap;
let clock;
let store;
beforeEach(() => {
    dir = makeTmpDir();
    cap = captureConsole();
    clock = T0;
    store = new STORE.AreaStore(path.join(dir, 'areas.json'), { now: () => new Date(clock) });
    store.load();
    // home: a building. field: a farm. garden: a farm that overlaps the east side of home.
    store.set({ name: 'home', type: 'building', min: { x: 0, y: 63, z: 0 }, max: { x: 6, y: 67, z: 6 }, dimension: 'overworld', source: 'scan' });
    store.set({ name: 'field', type: 'farm', min: { x: 10, y: 62, z: 0 }, max: { x: 16, y: 66, z: 6 }, dimension: 'overworld', source: 'scan' });
    store.set({ name: 'garden', type: 'farm', min: { x: 5, y: 62, z: 0 }, max: { x: 8, y: 66, z: 3 }, dimension: 'overworld', source: 'manual' });
    store.set({ name: 'nether_base', type: 'building', min: { x: 100, y: 63, z: 0 }, max: { x: 106, y: 67, z: 6 }, dimension: 'the_nether', source: 'manual' });
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

const block = (name, x, y, z) => ({ name, position: vec(x, y, z) });

// A fake mineflayer bot: records every call of the functions the guard wraps.
function fakeBot({ dimension = 'overworld', held = null } = {}) {
    const calls = [];
    const listeners = new Map();
    const initialMovements = { exclusionAreasBreak: [], exclusionAreasPlace: [] };
    const bot = {
        game: { dimension },
        entity: { position: vec(0, 64, 0) },
        heldItem: held ? { name: held } : null,
        inventory: { slots: [] },
        controlState: { sneak: false },
        dig(...args) {
            calls.push({ fn: 'dig', args, self: this });
            return Promise.resolve('dug');
        },
        placeBlock(...args) {
            calls.push({ fn: 'placeBlock', args, self: this });
            return Promise.resolve('placed');
        },
        _placeBlockWithOptions(...args) {
            calls.push({ fn: '_placeBlockWithOptions', args, self: this });
            return Promise.resolve('placed with options');
        },
        activateBlock(...args) {
            calls.push({ fn: 'activateBlock', args, self: this });
            return Promise.resolve('activated');
        },
        pathfinder: {
            setMovements(...args) {
                calls.push({ fn: 'setMovements', args, self: this });
                return 'set';
            },
            getPathTo(...args) {
                calls.push({ fn: 'getPathTo', args, self: this });
                return { status: 'success', path: [] };
            },
            *getPathFromTo(...args) {
                calls.push({ fn: 'getPathFromTo', args, self: this });
                yield { result: { status: 'success' } };
            },
            movements: initialMovements,
        },
        once(event, fn) {
            listeners.set(event, fn);
        },
        emit(event) {
            const fn = listeners.get(event);
            listeners.delete(event);
            if (fn) fn();
        },
    };
    return { bot, calls, initialMovements };
}

function install(bot, extra = {}) {
    return GUARD.installAreaGuard(bot, { store, now: () => clock, log: () => {}, ...extra });
}

function newMovements() {
    return { exclusionAreasBreak: [], exclusionAreasPlace: [] };
}

describe('installAreaGuard(bot, options)', () => {
    test('returns the full guard; bot.areaGuard is a frozen view without permits (Amendment 2, F2)', () => {
        const { bot } = fakeBot();
        const guard = install(bot);
        for (const member of ['canBreak', 'canPlace', 'canUse', 'permit', 'revoke', 'permits', 'explain', 'protectMovements']) {
            assert.equal(typeof guard[member], 'function', member);
        }
        assert.notEqual(bot.areaGuard, guard);
        assert.deepEqual(Object.keys(bot.areaGuard).sort(), ['canBreak', 'canPlace', 'canUse', 'explain', 'protectMovements']);
        assert.ok(Object.isFrozen(bot.areaGuard));
        for (const member of ['canBreak', 'canPlace', 'canUse', 'explain', 'protectMovements']) {
            assert.equal(bot.areaGuard[member], guard[member], member);
        }
        assert.throws(() => { bot.areaGuard.permit = () => 0; }, TypeError, 'ES modules are strict: a frozen object refuses new members');
        assert.equal(bot.areaGuard.permit, undefined);
    });

    test('F2: code that has only the bot cannot open an area; the full guard can', async () => {
        const { bot } = fakeBot();
        const guard = install(bot);
        const wall = block('oak_planks', 2, 64, 2);
        assert.equal(bot.areaGuard.canBreak(wall), false);
        await assert.rejects(bot.dig(wall), { name: 'ProtectedAreaError' });
        guard.permit('home', 5);
        assert.equal(bot.areaGuard.canBreak(wall), true, 'the view sees the permit of the full guard');
        assert.equal(await bot.dig(wall), 'dug');
    });

    test('a second call on the same bot does nothing and returns the same guard', async () => {
        const { bot, calls } = fakeBot();
        const guard = install(bot);
        const dig = bot.dig;
        const setMovements = bot.pathfinder.setMovements;
        assert.equal(install(bot), guard);
        assert.equal(GUARD.installAreaGuard(bot, { store: null }), guard);
        assert.equal(bot.dig, dig);
        assert.equal(bot.pathfinder.setMovements, setMovements);
        await bot.dig(block('dirt', 50, 63, 50));
        assert.equal(calls.filter(c => c.fn === 'dig').length, 1, 'the original runs once, not twice');
    });

    test('the current movements of the pathfinder are protected at once', () => {
        const { bot, initialMovements } = fakeBot();
        install(bot);
        assert.equal(initialMovements.exclusionAreasBreak.length, 1);
        assert.equal(initialMovements.exclusionAreasPlace.length, 1);
    });

    test('without a bot: TypeError', () => {
        assert.throws(() => GUARD.installAreaGuard(null, { store }), TypeError);
    });

    test('functions that do not exist yet are wrapped on "spawn"', async () => {
        const { bot, calls } = fakeBot();
        const dig = bot.dig;
        delete bot.dig;
        const pathfinder = bot.pathfinder;
        delete bot.pathfinder;
        install(bot);
        bot.dig = dig;
        bot.pathfinder = pathfinder;
        bot.emit('spawn');
        await assert.rejects(bot.dig(block('oak_planks', 2, 64, 2)), { name: 'ProtectedAreaError' });
        const m = newMovements();
        bot.pathfinder.setMovements(m);
        assert.equal(m.exclusionAreasBreak.length, 1);
        assert.equal(calls.filter(c => c.fn === 'dig').length, 0);
    });

    test('still missing after spawn: one warning through log, no throw', () => {
        const { bot } = fakeBot();
        delete bot.placeBlock;
        const lines = [];
        install(bot, { log: (text) => lines.push(text) });
        bot.emit('spawn');
        assert.equal(lines.length, 1);
        assert.match(lines[0], /placeBlock/);
    });
});

describe('canBreak(block)', () => {
    test('false inside a building, true outside', () => {
        const guard = install(fakeBot().bot);
        assert.equal(guard.canBreak(block('oak_planks', 2, 64, 2)), false);
        assert.equal(guard.canBreak(block('oak_log', 0, 63, 0)), false, 'corner of the box');
        assert.equal(guard.canBreak(block('oak_log', 0, 62, 0)), true, 'one below the box');
        assert.equal(guard.canBreak(block('oak_log', -1, 64, 0)), true);
        assert.equal(guard.canBreak(block('stone', 50, 60, 50)), true);
    });

    test('inside a farm only crops are true', () => {
        const guard = install(fakeBot().bot);
        for (const crop of GUARD.CROP_BLOCKS) assert.equal(guard.canBreak(block(crop, 12, 63, 2)), true, crop);
        assert.deepEqual([...GUARD.CROP_BLOCKS].sort(), ['beetroots', 'carrots', 'melon', 'nether_wart', 'pitcher_crop',
            'potatoes', 'pumpkin', 'sweet_berry_bush', 'torchflower_crop', 'wheat']);
        for (const name of ['oak_fence', 'oak_fence_gate', 'farmland', 'dirt', 'water', 'torch', 'oak_log']) {
            assert.equal(guard.canBreak(block(name, 12, 63, 2)), false, name);
        }
    });

    test('where a farm and a building overlap, the farm decides', () => {
        const guard = install(fakeBot().bot);
        assert.equal(guard.canBreak(block('wheat', 6, 64, 2)), true);
        assert.equal(guard.canBreak(block('oak_planks', 6, 64, 2)), false);
        assert.equal(guard.canPlace({ x: 6, y: 64, z: 2 }, 'wheat_seeds'), true);
    });

    test('an area of the overworld does not guard the nether, and the other way round', () => {
        const overworld = install(fakeBot().bot);
        const nether = install(fakeBot({ dimension: 'the_nether' }).bot);
        const inHome = block('oak_planks', 2, 64, 2);
        const inNetherBase = block('nether_bricks', 102, 64, 2);
        assert.equal(overworld.canBreak(inHome), false);
        assert.equal(overworld.canBreak(inNetherBase), true);
        assert.equal(nether.canBreak(inHome), true);
        assert.equal(nether.canBreak(inNetherBase), false);
    });

    test('the dimension comes from getDimension when given, "minecraft:" is ignored, missing is the overworld', () => {
        let dimension = 'minecraft:the_nether';
        const guard = install(fakeBot().bot, { getDimension: () => dimension });
        assert.equal(guard.canBreak(block('nether_bricks', 102, 64, 2)), false);
        dimension = undefined;
        assert.equal(guard.canBreak(block('oak_planks', 2, 64, 2)), false);
        dimension = 'the_end';
        assert.equal(guard.canBreak(block('oak_planks', 2, 64, 2)), true);
    });

    test('an area saved after the guard was installed is guarded at once; a removed one is free at once', () => {
        const guard = install(fakeBot().bot);
        const shed = block('oak_planks', 30, 64, 30);
        assert.equal(guard.canBreak(shed), true);
        store.set({ name: 'shed', type: 'building', min: { x: 28, y: 63, z: 28 }, max: { x: 32, y: 66, z: 32 } });
        assert.equal(guard.canBreak(shed), false);
        store.remove('shed');
        assert.equal(guard.canBreak(shed), true);
    });

    test('a block without a position is not guarded', () => {
        const guard = install(fakeBot().bot);
        assert.equal(guard.canBreak(null), true);
        assert.equal(guard.canBreak({ name: 'oak_planks' }), true);
        assert.equal(guard.canBreak({ name: 'oak_planks', position: { x: NaN, y: 0, z: 0 } }), true);
    });

    test('without a store everything is allowed; a store getter is read on every call', () => {
        let current = null;
        const guard = install(fakeBot().bot, { store: () => current });
        assert.equal(guard.canBreak(block('oak_planks', 2, 64, 2)), true);
        current = store;
        assert.equal(guard.canBreak(block('oak_planks', 2, 64, 2)), false);
    });

    test('a store that throws: allowed, one warning, no throw', () => {
        const lines = [];
        const broken = { revision: 1, list() { throw new Error('disk on fire'); } };
        const guard = install(fakeBot().bot, { store: broken, log: (text) => lines.push(text) });
        assert.equal(guard.canBreak(block('oak_planks', 2, 64, 2)), true);
        assert.equal(guard.canBreak(block('oak_planks', 2, 64, 2)), true);
        assert.equal(lines.length, 1);
        assert.match(lines[0], /disk on fire/);
    });

    test('a store without a revision number is read again on every call', () => {
        let areas = [];
        const plain = { list: () => areas };
        const guard = install(fakeBot().bot, { store: plain });
        assert.equal(guard.canBreak(block('oak_planks', 2, 64, 2)), true);
        areas = store.list();
        assert.equal(guard.canBreak(block('oak_planks', 2, 64, 2)), false);
    });
});

describe('canPlace(pos, itemName)', () => {
    test('false inside a building for every item, true outside', () => {
        const guard = install(fakeBot().bot);
        for (const item of ['dirt', 'oak_planks', 'wheat_seeds', 'torch', null]) {
            assert.equal(guard.canPlace({ x: 3, y: 65, z: 3 }, item), false, String(item));
        }
        assert.equal(guard.canPlace({ x: 3, y: 69, z: 3 }, 'dirt'), true);
        assert.equal(guard.canPlace({ x: 3.9, y: 62.5, z: 3.1 }, 'dirt'), true, 'y 62 is below the box');
    });

    test('inside a farm only seeds and crops to plant', () => {
        const guard = install(fakeBot().bot);
        assert.deepEqual([...GUARD.PLANTABLE_ITEMS].sort(), ['beetroot_seeds', 'carrot', 'melon_seeds', 'nether_wart',
            'pitcher_pod', 'potato', 'pumpkin_seeds', 'sweet_berries', 'torchflower_seeds', 'wheat_seeds']);
        for (const item of GUARD.PLANTABLE_ITEMS) assert.equal(guard.canPlace({ x: 12, y: 64, z: 2 }, item), true, item);
        for (const item of ['dirt', 'cobblestone', 'oak_fence', 'water_bucket', 'torch', null, undefined]) {
            assert.equal(guard.canPlace({ x: 12, y: 64, z: 2 }, item), false, String(item));
        }
    });

    test('an invalid position is not guarded', () => {
        const guard = install(fakeBot().bot);
        assert.equal(guard.canPlace(null, 'dirt'), true);
    });
});

describe('canUse(block, itemName)', () => {
    test('inside a building: false with a hoe, a shovel, an axe, a bucket with content, flint_and_steel, fire_charge, bone_meal', () => {
        const guard = install(fakeBot().bot);
        const floor = block('oak_log', 2, 63, 2);
        for (const item of ['wooden_hoe', 'diamond_hoe', 'iron_shovel', 'stone_axe', 'netherite_axe', 'water_bucket',
            'lava_bucket', 'powder_snow_bucket', 'milk_bucket', 'flint_and_steel', 'fire_charge', 'bone_meal']) {
            assert.equal(guard.canUse(floor, item), false, item);
        }
    });

    test('inside a building: true with anything else, also a pickaxe and an empty bucket', () => {
        const guard = install(fakeBot().bot);
        const floor = block('oak_planks', 2, 63, 2);
        for (const item of [null, undefined, 'bread', 'iron_pickaxe', 'bucket', 'oak_planks', 'stick', 'iron_sword']) {
            assert.equal(guard.canUse(floor, item), true, String(item));
        }
    });

    test('doors, gates, trapdoors, chests, beds and the crafting table work whatever is in the hand', () => {
        const guard = install(fakeBot().bot);
        for (const name of ['oak_door', 'spruce_trapdoor', 'oak_fence_gate', 'chest', 'trapped_chest', 'barrel',
            'red_bed', 'crafting_table', 'furnace', 'white_shulker_box']) {
            for (const item of [null, 'iron_axe', 'water_bucket', 'wooden_hoe', 'flint_and_steel']) {
                assert.equal(guard.canUse(block(name, 3, 64, 3), item), true, `${name} with ${item}`);
            }
        }
    });

    test('...but not an iron door, and not while sneaking (then the item is used, not the block)', () => {
        const guard = install(fakeBot().bot);
        assert.equal(guard.canUse(block('iron_door', 3, 64, 3), 'water_bucket'), false);
        assert.equal(guard.canUse(block('iron_door', 3, 64, 3), null), true);
        assert.equal(guard.canUse(block('oak_door', 3, 64, 3), 'water_bucket', { sneaking: true }), false);
        assert.equal(guard.canUse(block('oak_door', 3, 64, 3), null, { sneaking: true }), true);
    });

    test('inside a farm: always true; outside: always true', () => {
        const guard = install(fakeBot().bot);
        assert.equal(guard.canUse(block('dirt', 12, 63, 2), 'wooden_hoe'), true);
        assert.equal(guard.canUse(block('farmland', 12, 63, 2), 'bone_meal'), true);
        assert.equal(guard.canUse(block('grass_block', 50, 63, 50), 'flint_and_steel'), true);
    });
});

describe('permit, revoke, permits', () => {
    test('a permit opens an area until its end time; it returns the end time', () => {
        const guard = install(fakeBot().bot);
        const wall = block('oak_planks', 2, 64, 2);
        assert.equal(guard.permit('home', 10), T0 + 10 * MINUTE);
        assert.equal(guard.canBreak(wall), true);
        assert.equal(guard.canPlace({ x: 2, y: 64, z: 2 }, 'dirt'), true);
        assert.equal(guard.canUse(wall, 'stone_axe'), true);
        clock = T0 + 10 * MINUTE - 1;
        assert.equal(guard.canBreak(wall), true);
        clock = T0 + 10 * MINUTE;
        assert.equal(guard.canBreak(wall), false, 'expired');
        assert.deepEqual(guard.permits(), []);
    });

    test('at most 60 minutes; a number that is not finite means 10; 0 or less means no permit', () => {
        const guard = install(fakeBot().bot);
        assert.equal(guard.permit('home', 500), T0 + 60 * MINUTE);
        assert.equal(guard.permit('home', 'soon'), T0 + 10 * MINUTE);
        assert.equal(guard.permit('home', 0), T0);
        assert.equal(guard.canBreak(block('oak_planks', 2, 64, 2)), false);
        assert.equal(guard.permit('home', -5), T0);
        assert.deepEqual(guard.permits(), []);
    });

    test('permits() lists the open areas by name; revoke() closes one', () => {
        const guard = install(fakeBot().bot);
        guard.permit('home', 5);
        guard.permit(' field ', 30);
        assert.deepEqual(guard.permits(), [
            { name: 'field', until: T0 + 30 * MINUTE },
            { name: 'home', until: T0 + 5 * MINUTE },
        ]);
        assert.equal(guard.revoke('home'), true);
        assert.equal(guard.revoke('home'), false);
        assert.equal(guard.revoke('nothing'), false);
        assert.deepEqual(guard.permits().map(p => p.name), ['field']);
        assert.equal(guard.canBreak(block('oak_planks', 2, 64, 2)), false);
        assert.equal(guard.canBreak(block('oak_fence', 12, 64, 2)), true, 'the permit of the farm opens everything in it');
    });

    test('a permit for one area does not open another area that overlaps it', () => {
        const guard = install(fakeBot().bot);
        guard.permit('home', 10);
        assert.equal(guard.canBreak(block('oak_planks', 2, 64, 2)), true, 'only home');
        assert.equal(guard.canBreak(block('oak_planks', 6, 64, 2)), false, 'the garden farm still protects its part');
        assert.equal(guard.canBreak(block('wheat', 6, 64, 2)), true);
    });

    test('a permit may name an area that is saved later', () => {
        const guard = install(fakeBot().bot);
        guard.permit('shed', 10);
        store.set({ name: 'shed', type: 'building', min: { x: 28, y: 63, z: 28 }, max: { x: 32, y: 66, z: 32 } });
        assert.equal(guard.canBreak(block('oak_planks', 30, 64, 30)), true);
    });

    test('a Date from now() works as well as a number', () => {
        const guard = install(fakeBot().bot, { now: () => new Date(clock) });
        assert.equal(guard.permit('home', 1), T0 + MINUTE);
        assert.equal(guard.canBreak(block('oak_planks', 2, 64, 2)), true);
    });
});

describe('explain(pos)', () => {
    test('the text of the spec, with the floored block position', () => {
        const guard = install(fakeBot().bot);
        assert.equal(guard.explain({ x: 2.7, y: 64.2, z: 3.9 }),
            'The block at (2, 64, 3) belongs to the protected area "home". I do not break or place blocks there.');
        assert.equal(guard.explain({ x: 12, y: 64, z: -0.5 }), 'The block at (12, 64, -1) is not in a protected area.');
    });

    test('the area that decides is named: the farm where a farm and a building overlap', () => {
        const guard = install(fakeBot().bot);
        assert.match(guard.explain({ x: 6, y: 64, z: 2 }), /"garden"/);
    });
});

describe('wrapped bot.dig', () => {
    test('refused: rejects with a ProtectedAreaError, message = explain(...), nothing sent', async () => {
        const { bot, calls } = fakeBot();
        const lines = [];
        const guard = install(bot, { log: (text) => lines.push(text) });
        const wall = block('oak_planks', 2, 64, 2);
        const promise = bot.dig(wall, true);
        assert.ok(promise instanceof Promise);
        await assert.rejects(promise, (err) => {
            assert.ok(err instanceof Error);
            assert.ok(err instanceof GUARD.ProtectedAreaError);
            assert.equal(err.name, 'ProtectedAreaError');
            assert.equal(err.message, guard.explain(wall.position));
            assert.equal(err.area, 'home');
            assert.deepEqual(err.position, { x: 2, y: 64, z: 2 });
            return true;
        });
        assert.equal(calls.length, 0);
        assert.deepEqual(lines, [guard.explain(wall.position)]);
    });

    test('allowed: same arguments (also extra ones), same return value, same this', async () => {
        const { bot, calls } = fakeBot();
        install(bot);
        const stone = block('stone', 50, 60, 50);
        assert.equal(await bot.dig(stone, true, 'raycast'), 'dug');
        assert.equal(calls.length, 1);
        assert.equal(calls[0].args.length, 3);
        assert.equal(calls[0].args[0], stone);
        assert.equal(calls[0].args[1], true);
        assert.equal(calls[0].args[2], 'raycast');
        assert.equal(calls[0].self, bot);
        const other = { name: 'other this' };
        await bot.dig.call(other, stone);
        assert.equal(calls[1].self, other);
        assert.equal(calls[1].args.length, 1);
    });

    test('the errors of the original stay the same: rejections and synchronous throws', async () => {
        const { bot } = fakeBot();
        const failure = new Error('Block not in view');
        bot.dig = () => Promise.reject(failure);
        const syncFailure = new TypeError('no block');
        bot.placeBlock = () => { throw syncFailure; };
        install(bot);
        await assert.rejects(bot.dig(block('stone', 50, 60, 50)), (err) => err === failure);
        assert.throws(() => bot.placeBlock(block('stone', 50, 60, 50), vec(0, 1, 0)), (err) => err === syncFailure);
    });

    test('a call the guard cannot judge (no block) goes to the original unchanged', async () => {
        const { bot, calls } = fakeBot();
        install(bot);
        await bot.dig(null);
        await bot.dig();
        assert.deepEqual(calls.map(c => c.args.length), [1, 0]);
    });
});

describe('wrapped bot.placeBlock and bot._placeBlockWithOptions', () => {
    test('the target is referenceBlock.position + faceVector; the item is the one in the hand', async () => {
        const { bot, calls } = fakeBot({ held: 'oak_planks' });
        install(bot);
        // From outside against the east wall of home: the new block would be inside.
        await assert.rejects(bot.placeBlock(block('grass_block', 7, 63, 3), vec(-1, 1, 0)), { name: 'ProtectedAreaError' });
        // From the wall to the outside: allowed.
        assert.equal(await bot.placeBlock(block('oak_planks', 0, 64, 3), { x: -1, y: 0, z: 0 }), 'placed');
        assert.equal(calls.length, 1);
        assert.equal(calls[0].self, bot);
        assert.equal(calls[0].args.length, 2);
    });

    test('in a farm: seeds yes, dirt no', async () => {
        const { bot } = fakeBot({ held: 'wheat_seeds' });
        install(bot);
        const farmland = block('farmland', 12, 63, 2);
        assert.equal(await bot.placeBlock(farmland, vec(0, 1, 0)), 'placed');
        bot.heldItem = { name: 'dirt' };
        await assert.rejects(bot.placeBlock(farmland, vec(0, 1, 0)), { name: 'ProtectedAreaError' });
        bot.heldItem = null;
        await assert.rejects(bot.placeBlock(farmland, vec(0, 1, 0)), { name: 'ProtectedAreaError' });
    });

    test('_placeBlockWithOptions: same rule, options kept; offhand uses the item in the off hand', async () => {
        const { bot, calls } = fakeBot({ held: 'dirt' });
        install(bot);
        bot.inventory.slots[45] = { name: 'wheat_seeds' };
        const farmland = block('farmland', 12, 63, 2);
        await assert.rejects(bot._placeBlockWithOptions(farmland, vec(0, 1, 0), { swingArm: 'right' }), { name: 'ProtectedAreaError' });
        const options = { offhand: true };
        assert.equal(await bot._placeBlockWithOptions(farmland, vec(0, 1, 0), options), 'placed with options');
        assert.equal(calls[0].args[2], options);
    });

    test('without a reference block or face vector the original decides', async () => {
        const { bot, calls } = fakeBot({ held: 'dirt' });
        install(bot);
        await bot.placeBlock(block('dirt', 2, 64, 2));
        await bot.placeBlock(null, vec(0, 1, 0));
        assert.equal(calls.length, 2);
    });
});

describe('wrapped bot.activateBlock', () => {
    test('doors, chests and beds in the house work; a hoe on the floor is refused', async () => {
        const { bot, calls } = fakeBot({ held: 'wooden_hoe' });
        install(bot);
        const door = block('oak_door', 3, 64, 6);
        assert.equal(await bot.activateBlock(door, vec(0, 0, 1), vec(0.5, 0.5, 0.5)), 'activated');
        assert.equal(calls[0].args.length, 3);
        assert.equal(calls[0].args[0], door);
        await assert.rejects(bot.activateBlock(block('oak_planks', 3, 63, 3)), { name: 'ProtectedAreaError' });
        bot.heldItem = null;
        assert.equal(await bot.activateBlock(block('oak_planks', 3, 63, 3)), 'activated');
    });

    test('while sneaking with a bucket of water, a door counts like any block', async () => {
        const { bot } = fakeBot({ held: 'water_bucket' });
        install(bot);
        assert.equal(await bot.activateBlock(block('oak_door', 3, 64, 6)), 'activated');
        bot.controlState.sneak = true;
        await assert.rejects(bot.activateBlock(block('oak_door', 3, 64, 6)), { name: 'ProtectedAreaError' });
    });
});

describe('wrapped pathfinder: setMovements, getPathTo, getPathFromTo', () => {
    test('setMovements adds one function each to exclusionAreasBreak and exclusionAreasPlace, once per object', () => {
        const { bot, calls } = fakeBot();
        install(bot);
        const m = newMovements();
        assert.equal(bot.pathfinder.setMovements(m), 'set');
        assert.equal(bot.pathfinder.setMovements(m), 'set');
        assert.equal(m.exclusionAreasBreak.length, 1);
        assert.equal(m.exclusionAreasPlace.length, 1);
        assert.equal(calls.length, 2);
        assert.equal(calls[0].args[0], m);
        assert.equal(calls[0].self, bot.pathfinder);
    });

    test('an exclusion list that was emptied later gets the function again', () => {
        const { bot } = fakeBot();
        install(bot);
        const m = newMovements();
        bot.pathfinder.setMovements(m);
        m.exclusionAreasBreak = [];
        bot.pathfinder.setMovements(m);
        assert.equal(m.exclusionAreasBreak.length, 1);
        assert.equal(m.exclusionAreasPlace.length, 1);
    });

    test('getPathTo and getPathFromTo protect the movements before the call and keep arguments and result', () => {
        const { bot, calls } = fakeBot();
        install(bot);
        const m = newMovements();
        const goal = { isEnd: () => true };
        const result = bot.pathfinder.getPathTo(m, goal, 100);
        assert.deepEqual(result, { status: 'success', path: [] });
        assert.deepEqual(calls[0].args, [m, goal, 100]);
        assert.equal(m.exclusionAreasBreak.length, 1);
        const m2 = newMovements();
        const generator = bot.pathfinder.getPathFromTo(m2, vec(0, 64, 0), goal, { timeout: 5 });
        assert.deepEqual(generator.next().value, { result: { status: 'success' } });
        assert.equal(m2.exclusionAreasPlace.length, 1);
        assert.equal(calls[1].args.length, 4);
    });

    test('the functions give 100 for a block the guard does not allow and 0 otherwise', () => {
        const { bot } = fakeBot();
        install(bot);
        const m = newMovements();
        bot.pathfinder.setMovements(m);
        const [breakFn] = m.exclusionAreasBreak;
        const [placeFn] = m.exclusionAreasPlace;
        assert.equal(breakFn(block('oak_planks', 2, 64, 2)), 100);
        assert.equal(breakFn(block('wheat', 12, 64, 2)), 0, 'a crop in a farm may be broken');
        assert.equal(breakFn(block('oak_fence', 12, 64, 2)), 100);
        assert.equal(breakFn(block('stone', 50, 60, 50)), 0);
        assert.equal(placeFn(block('air', 2, 64, 2)), 100);
        assert.equal(placeFn(block('air', 12, 64, 2)), 100, 'the pathfinder places scaffolding, never seeds');
        assert.equal(placeFn(block('air', 50, 64, 50)), 0);
        assert.equal(breakFn(null), 0);
        assert.equal(placeFn({}), 0);
    });

    test('movements without exclusion lists, or none at all, go to the original unchanged', () => {
        const { bot, calls } = fakeBot();
        const guard = install(bot);
        bot.pathfinder.setMovements({});
        bot.pathfinder.setMovements(null);
        assert.equal(calls.length, 2);
        assert.equal(guard.protectMovements({}), false);
        assert.equal(guard.protectMovements(newMovements()), true);
    });
});

describe('the real Movements class of mineflayer-pathfinder', () => {
    const registry = require('prismarine-registry')('1.21.8');
    const Block = require('prismarine-block')(registry);
    const { Vec3 } = require('vec3');
    const Movements = require('mineflayer-pathfinder/lib/movements');
    const AStar = require('mineflayer-pathfinder/lib/astar');
    const Move = require('mineflayer-pathfinder/lib/move');
    const { GoalBlock } = require('mineflayer-pathfinder/lib/goals');

    // A small bot for Movements: a registry and blocks of a BlockWorld as prismarine blocks.
    function movementsBot(world) {
        const cache = new Map();
        return {
            registry,
            game: { minY: -64, dimension: 'overworld' },
            entity: { position: new Vec3(3.5, 64, -5.5), effects: {} },
            entities: {},
            inventory: { items: () => [] },
            pathfinder: { bestHarvestTool: () => null },
            blockAt(pos) {
                const x = Math.floor(pos.x);
                const y = Math.floor(pos.y);
                const z = Math.floor(pos.z);
                const k = `${x},${y},${z}`;
                if (!cache.has(k)) {
                    const name = world.get(x, y, z);
                    const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0);
                    b.position = new Vec3(x, y, z);
                    cache.set(k, b);
                }
                return cache.get(k);
            },
        };
    }

    function realBlock(name, x, y, z) {
        const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0);
        b.position = new Vec3(x, y, z);
        return b;
    }

    test('safeToBreak refuses a block in a building after the guard touched the movements', () => {
        const world = createBlockWorld().flatGround(63);
        const { bot } = fakeBot();
        const guard = install(bot);
        const movements = new Movements(movementsBot(world));
        const wall = realBlock('oak_planks', 2, 64, 2);
        const outside = realBlock('oak_planks', 30, 64, 30);
        assert.equal(movements.safeToBreak(wall), true, 'before: the pathfinder would break the wall');
        bot.pathfinder.setMovements(movements);
        assert.equal(movements.safeToBreak(wall), false);
        assert.equal(movements.exclusionBreak(wall), 100);
        assert.equal(movements.safeToBreak(outside), true);
        assert.equal(movements.exclusionPlace(realBlock('air', 3, 65, 3)), 100);
        guard.permit('home', 5);
        assert.equal(movements.safeToBreak(wall), true, 'with a permit');
    });

    test('a path to a place behind a protected glass wall goes around it instead of through it', () => {
        const world = createBlockWorld().flatGround(63);
        world.fill(-10, 64, 4, 10, 66, 4, 'glass');
        store.set({ name: 'glass_wall', type: 'building', min: { x: -11, y: 63, z: 3 }, max: { x: 11, y: 67, z: 5 } });
        const inArea = (p) => p.x >= -11 && p.x <= 11 && p.y >= 63 && p.y <= 67 && p.z >= 3 && p.z <= 5;
        const search = (movements) => {
            const astar = new AStar(new Move(0, 64, -5, 0, 0), movements, new GoalBlock(0, 64, 10), 20000, 20000);
            let result = astar.compute();
            while (result.status === 'partial') result = astar.compute();
            return result;
        };

        const unguarded = search(new Movements(movementsBot(world)));
        assert.equal(unguarded.status, 'success');
        assert.ok(unguarded.path.some(step => step.toBreak.some(inArea)), 'precondition: without the guard the path breaks the glass');

        const { bot } = fakeBot();
        install(bot);
        const movements = new Movements(movementsBot(world));
        bot.pathfinder.setMovements(movements);
        const guarded = search(movements);
        assert.equal(guarded.status, 'success');
        for (const step of guarded.path) {
            assert.equal(step.toBreak.some(inArea), false, 'nothing broken in the area');
            assert.equal(step.toPlace.some(inArea), false, 'nothing placed in the area');
        }
        assert.ok(guarded.path.some(step => Math.abs(step.x) > 10), 'the path goes around the end of the wall');
    });
});

describe('speed', () => {
    test('100,000 calls of the exclusion function with 10 areas take less than 100 ms', (t) => {
        store.remove('nether_base');
        for (let i = 0; i < 7; i++) {
            store.set({ name: `extra_${i}`, type: i % 2 ? 'farm' : 'building',
                min: { x: 200 + i * 20, y: 60, z: 0 }, max: { x: 210 + i * 20, y: 70, z: 10 } });
        }
        assert.equal(store.size, 10);
        const guard = install(fakeBot().bot, { now: () => Date.now() });
        guard.permit('extra_0', 30);
        const m = newMovements();
        guard.protectMovements(m);
        const [breakFn] = m.exclusionAreasBreak;
        const blocks = [];
        for (let i = 0; i < 1000; i++) {
            blocks.push(block(i % 3 ? 'oak_planks' : 'wheat', (i * 7) % 340 - 20, 60 + (i % 10), (i * 13) % 30 - 10));
        }
        let best = Infinity;
        let sum = 0;
        for (let round = 0; round < 3; round++) {
            const started = performance.now();
            for (let i = 0; i < 100_000; i++) sum += breakFn(blocks[i % 1000]);
            best = Math.min(best, performance.now() - started);
        }
        t.diagnostic(`100,000 calls with 10 areas: ${best.toFixed(1)} ms (best of 3)`);
        assert.ok(sum > 0, 'some blocks were refused');
        assert.ok(best < 100, `took ${best} ms`);
    });
});

describe('robustness: the guard never throws into the bot', () => {
    const throwing = (message) => ({ get() { throw new Error(message); } });

    test('a logger that throws: the refusal still rejects with the ProtectedAreaError', async () => {
        const { bot } = fakeBot();
        install(bot, { log: () => { throw new Error('log broken'); } });
        await assert.rejects(bot.dig(block('oak_planks', 2, 64, 2)), { name: 'ProtectedAreaError' });
    });

    test('now() or getDimension() that throw: the clock and the overworld are used', () => {
        const guard = install(fakeBot().bot, {
            now: () => { throw new Error('no clock'); },
            getDimension: () => { throw new Error('no dimension'); },
        });
        const before = Date.now();
        const end = guard.permit('field', 1);
        assert.ok(end >= before + MINUTE && end <= Date.now() + MINUTE);
        assert.equal(guard.canBreak(block('oak_planks', 2, 64, 2)), false, 'overworld home');
    });

    test('a store getter that throws: allowed, one warning', () => {
        const lines = [];
        const guard = install(fakeBot().bot, { store: () => { throw new Error('no world yet'); }, log: (t) => lines.push(t) });
        assert.equal(guard.canBreak(block('oak_planks', 2, 64, 2)), true);
        assert.equal(guard.canBreak(block('oak_planks', 2, 64, 2)), true);
        assert.equal(lines.length, 1);
        assert.match(lines[0], /no world yet/);
    });

    test('invalid entries of a store are skipped; overlapping areas of one type: the first by name decides', () => {
        const areas = [
            null,
            { name: 'broken', type: 'building', min: { x: 0 }, max: { x: 1, y: 1, z: 1 } },
            { name: 'b_hut', type: 'building', min: { x: 0, y: 60, z: 0 }, max: { x: 4, y: 70, z: 4 } },
            { name: 'c_hut', type: 'building', min: { x: 0, y: 60, z: 0 }, max: { x: 4, y: 70, z: 4 } },
            { name: 'a_hut', type: 'building', min: { x: 4, y: 70, z: 4 }, max: { x: 0, y: 60, z: 0 } },
        ];
        const guard = install(fakeBot().bot, { store: { revision: 1, list: () => areas } });
        assert.match(guard.explain({ x: 1, y: 64, z: 1 }), /"a_hut"/);
        guard.permit('a_hut', 10);
        assert.match(guard.explain({ x: 1, y: 64, z: 1 }), /"b_hut"/);
        guard.permit('b_hut', 10);
        guard.permit('c_hut', 10);
        assert.match(guard.explain({ x: 1, y: 64, z: 1 }), /"a_hut"/, 'all open: the area is still named');
    });

    test('a block whose position throws: the check allows the call and warns once', async () => {
        const { bot, calls } = fakeBot({ held: 'water_bucket' });
        const lines = [];
        const guard = install(bot, { log: (t) => lines.push(t) });
        const bad = Object.defineProperty({ name: 'oak_planks' }, 'position', throwing('position broken'));
        assert.equal(guard.canBreak(bad), true);
        assert.equal(guard.canUse(bad, 'water_bucket'), true);
        assert.equal(guard.canPlace(Object.defineProperty({}, 'x', throwing('x broken')), 'dirt'), true);
        assert.equal(await bot.dig(bad), 'dug');
        assert.equal(await bot.activateBlock(bad), 'activated');
        assert.equal(await bot.placeBlock(bad, vec(0, 1, 0)), 'placed');
        assert.equal(calls.length, 3);
        assert.equal(lines.length, 1);
        assert.match(lines[0], /position broken/);
    });

    test('explain works during an error: the position without an area', () => {
        const guard = install(fakeBot().bot, { store: { get revision() { throw new Error('revision broken'); }, list: () => [] } });
        assert.equal(guard.explain({ x: 1, y: 2, z: 3 }), 'The block at (1, 2, 3) is not in a protected area.');
        assert.equal(guard.explain(null), 'The block is not in a protected area.');
    });

    test('a held item or sneak state that throws counts as an empty hand, not sneaking', async () => {
        const { bot, calls } = fakeBot();
        Object.defineProperty(bot, 'heldItem', throwing('inventory broken'));
        Object.defineProperty(bot, 'controlState', throwing('controls broken'));
        install(bot);
        assert.equal(await bot.activateBlock(block('oak_door', 3, 64, 6)), 'activated');
        await assert.rejects(bot.placeBlock(block('farmland', 12, 63, 2), vec(0, 1, 0)), { name: 'ProtectedAreaError' });
        assert.equal(calls.length, 1);
    });

    test('a block without a name and a risky item: judged like any block', () => {
        const guard = install(fakeBot().bot);
        assert.equal(guard.canUse({ position: vec(2, 63, 2) }, 'stone_axe'), false);
        assert.equal(guard.canBreak({ position: vec(12, 63, 2) }), false, 'in a farm, a block without a name is no crop');
    });

    test('expired permits are dropped by permits()', () => {
        const guard = install(fakeBot().bot);
        guard.permit('home', 1);
        guard.permit('field', 5);
        clock = T0 + 2 * MINUTE;
        assert.deepEqual(guard.permits().map(p => p.name), ['field']);
        assert.equal(guard.revoke('home'), false, 'already expired');
    });

    test('movements whose exclusion list cannot be read: not protected, no throw', () => {
        const guard = install(fakeBot().bot);
        const odd = Object.defineProperty({ exclusionAreasPlace: [] }, 'exclusionAreasBreak', throwing('odd'));
        assert.equal(guard.protectMovements(odd), false);
    });

    test('a bot without once() and without some functions: one warning at once', () => {
        const lines = [];
        const bot = { dig() {}, placeBlock() {}, activateBlock() {} };
        GUARD.installAreaGuard(bot, { store, log: (t) => lines.push(t) });
        assert.equal(lines.length, 1);
        assert.match(lines[0], /pathfinder/);
        assert.equal(typeof bot.areaGuard.canBreak, 'function');
    });

    test('the default log is console.warn', async () => {
        const { bot } = fakeBot();
        GUARD.installAreaGuard(bot, { store });
        await assert.rejects(bot.dig(block('oak_planks', 2, 64, 2)));
        assert.ok(cap.of('warn').some(r => r.text.includes('belongs to the protected area "home"')), cap.allText());
    });
});

describe('ProtectedAreaError', () => {
    test('an Error with the name ProtectedAreaError and the area and position', () => {
        const err = new GUARD.ProtectedAreaError('text', { area: 'home', position: { x: 1, y: 2, z: 3 } });
        assert.ok(err instanceof Error);
        assert.equal(err.name, 'ProtectedAreaError');
        assert.equal(err.message, 'text');
        assert.equal(err.area, 'home');
        assert.equal(String(err), 'ProtectedAreaError: text');
        const bare = new GUARD.ProtectedAreaError('bare');
        assert.equal(bare.area, null);
        assert.equal(bare.position, null);
    });
});

describe('module rules', () => {
    test('no mineflayer, no library, no model SDK: it works on the bot that is passed in', () => {
        assertImportRules(MODULE);
    });

    test('imports cleanly: no output, no files', () => {
        assertCleanImport(MODULE);
    });
});
