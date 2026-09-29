// Spec v0.1.4.8, part D: D2 (rules per type), D3 (built blocks everywhere), I3 (the guard) --
// src/agent/areas/area_guard.js with the stores of area_store.js and placed_store.js.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld, vec } from '../helpers/block_world.js';

const GUARD = await loadSrc('src/agent/areas/area_guard.js');
const STORE = await loadSrc('src/agent/areas/area_store.js');
const SCAN = await loadSrc('src/agent/areas/area_scan.js');
const PLACED = await loadSrc('src/agent/areas/placed_store.js');
const require = createRequire(import.meta.url);

const T0 = Date.UTC(2026, 8, 29, 12, 0, 0);

// One area of each type, 20 blocks apart along x: x 0..6, 20..26, 40..46, 60..66, 80..86; y 60..70.
const TYPES = ['home', 'building', 'pen', 'farm', 'mine'];
const X0 = { home: 0, building: 20, pen: 40, farm: 60, mine: 80 };
const inside = (type, dy = 0) => ({ x: X0[type] + 3, y: 64 + dy, z: 3 });

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
    for (const type of TYPES) {
        store.set({ name: `the_${type}`, type, min: { x: X0[type], y: 60, z: 0 }, max: { x: X0[type] + 6, y: 70, z: 6 }, source: 'manual' });
    }
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

const block = (name, pos) => ({ name, position: vec(pos.x, pos.y, pos.z) });

// A fake mineflayer bot on a block world: dig and placeBlock change the world, so blockUpdate and
// blockAt tell the truth.
function fakeBot(world = createBlockWorld().flatGround(63), { held = 'oak_planks' } = {}) {
    const calls = [];
    const listeners = new Map();
    const bot = {
        game: { dimension: 'overworld' },
        heldItem: held ? { name: held } : null,
        inventory: { slots: [] },
        controlState: { sneak: false },
        blockAt: (pos) => world.blockAt(pos),
        dig(b) {
            calls.push(['dig', b.position]);
            const old = world.blockAt(b.position);
            world.set(b.position.x, b.position.y, b.position.z, 'air');
            bot.emit('blockUpdate', old, world.blockAt(b.position));
            return Promise.resolve('dug');
        },
        placeBlock(ref, face) {
            const p = { x: ref.position.x + face.x, y: ref.position.y + face.y, z: ref.position.z + face.z };
            calls.push(['placeBlock', p]);
            world.set(p.x, p.y, p.z, bot.heldItem?.name ?? 'dirt');
            return Promise.resolve('placed');
        },
        activateBlock() {
            calls.push(['activateBlock']);
            return Promise.resolve('activated');
        },
        pathfinder: {
            setMovements() {},
            getPathTo() { return { status: 'success', path: [] }; },
            movements: { exclusionAreasBreak: [], exclusionAreasPlace: [] },
        },
        once(event, fn) {
            listeners.set(`once:${event}`, fn);
        },
        on(event, fn) {
            if (!listeners.has(event)) listeners.set(event, []);
            listeners.get(event).push(fn);
        },
        emit(event, ...args) {
            for (const fn of listeners.get(event) ?? []) fn(...args);
        },
    };
    return { bot, calls, world };
}

function install(bot, extra = {}) {
    return GUARD.installAreaGuard(bot, { store, now: () => clock, log: () => {}, ...extra });
}

function exclusions(guard) {
    const m = { exclusionAreasBreak: [], exclusionAreasPlace: [] };
    guard.protectMovements(m);
    return { breakFn: m.exclusionAreasBreak[0], placeFn: m.exclusionAreasPlace[0] };
}

describe('D2: the rules per type', () => {
    for (const type of ['home', 'building', 'pen']) {
        test(`${type}: no break, no place, the path search digs nothing, inBuilding`, () => {
            const guard = install(fakeBot().bot);
            const { breakFn, placeFn } = exclusions(guard);
            for (const name of ['stone', 'dirt', 'oak_planks', 'oak_fence', 'wheat']) {
                assert.equal(guard.canBreak(block(name, inside(type))), false, name);
                assert.equal(breakFn(block(name, inside(type))), 100, name);
            }
            for (const item of ['dirt', 'wheat_seeds', 'torch', null]) {
                assert.equal(guard.canPlace(inside(type), item), false, String(item));
            }
            assert.equal(placeFn(block('air', inside(type))), 100);
            assert.equal(guard.inBuilding(inside(type)), true);
            assert.equal(guard.canUse(block('oak_planks', inside(type)), 'water_bucket'), false);
            assert.deepEqual(guard.refusal(block('stone', inside(type)), 'break'), {
                reason: 'area', area: `the_${type}`,
                text: `The block at (${X0[type] + 3}, 64, 3) belongs to the protected area "the_${type}". I do not break or place blocks there.`,
            });
        });
    }

    test('farm: crops only, seeds only, the path search digs nothing solid, no inBuilding (as in v0.1.4.7)', () => {
        const guard = install(fakeBot().bot);
        const { breakFn, placeFn } = exclusions(guard);
        for (const crop of GUARD.CROP_BLOCKS) assert.equal(guard.canBreak(block(crop, inside('farm'))), true, crop);
        for (const name of ['farmland', 'dirt', 'oak_fence', 'stone']) {
            assert.equal(guard.canBreak(block(name, inside('farm'))), false, name);
            assert.equal(breakFn(block(name, inside('farm'))), 100, name);
        }
        for (const seed of GUARD.PLANTABLE_ITEMS) assert.equal(guard.canPlace(inside('farm'), seed), true, seed);
        assert.equal(guard.canPlace(inside('farm'), 'dirt'), false);
        assert.equal(placeFn(block('air', inside('farm'))), 100);
        assert.equal(guard.inBuilding(inside('farm')), false);
        assert.equal(guard.canUse(block('farmland', inside('farm')), 'bone_meal'), true);
    });

    test('mine: natural blocks may be broken, built blocks not; placing is allowed', () => {
        const guard = install(fakeBot().bot);
        for (const name of ['stone', 'deepslate', 'dirt', 'gravel', 'iron_ore', 'coal_ore', 'oak_log', 'water']) {
            assert.equal(guard.canBreak(block(name, inside('mine'))), true, name);
            assert.equal(guard.refusal(block(name, inside('mine')), 'break'), null, name);
        }
        for (const name of ['oak_planks', 'ladder', 'torch', 'chest', 'cobblestone', 'oak_trapdoor', 'rail']) {
            assert.equal(guard.canBreak(block(name, inside('mine'))), false, name);
        }
        for (const item of ['cobblestone', 'ladder', 'torch', 'dirt', null]) {
            assert.equal(guard.canPlace(inside('mine'), item), true, String(item));
        }
        assert.equal(guard.inBuilding(inside('mine')), false, 'a mine is no building: ore under a ladder may be taken');
        assert.equal(guard.canUse(block('stone', inside('mine')), 'water_bucket'), true);
    });

    test('mine: the refusal of a built block names the mine; reason area, a command of the player does not open it', () => {
        const guard = install(fakeBot().bot);
        guard.setPlayerOrder(() => true);
        assert.deepEqual(guard.refusal(block('ladder', inside('mine')), 'break'), {
            reason: 'area', area: 'the_mine',
            text: 'ladder at (83, 64, 3) is a block that players build with, in the mine "the_mine". I break only natural blocks there.',
        });
    });

    test('mine: the path search may dig natural blocks only, and may place', () => {
        const guard = install(fakeBot().bot);
        const { breakFn, placeFn } = exclusions(guard);
        assert.equal(breakFn(block('stone', inside('mine'))), 0);
        assert.equal(breakFn(block('dirt', inside('mine'))), 0);
        assert.equal(breakFn(block('oak_planks', inside('mine'))), 100);
        assert.equal(breakFn(block('ladder', inside('mine'))), 100);
        assert.equal(placeFn(block('air', inside('mine'))), 0);
    });

    test('mine: a block that the bot placed there may be broken again', async () => {
        const { bot, world } = fakeBot();
        const guard = install(bot);
        const spot = inside('mine');
        world.set(spot.x, spot.y - 1, spot.z, 'stone');
        await bot.placeBlock(block('stone', { ...spot, y: spot.y - 1 }), vec(0, 1, 0));
        assert.equal(world.get(spot.x, spot.y, spot.z), 'oak_planks');
        assert.equal(guard.placedByBot(spot), true);
        assert.equal(guard.canBreak(block('oak_planks', spot)), true);
        await bot.dig(block('oak_planks', spot));
        assert.equal(guard.placedByBot(spot), false, 'broken: no longer noted');
    });

    test('!allowChanges (a permit) opens every type, also for built blocks', () => {
        const guard = install(fakeBot().bot, { protectBuiltBlocks: true });
        for (const type of TYPES) {
            assert.equal(guard.canBreak(block('oak_planks', inside(type))), false, type);
            guard.permit(`the_${type}`, 5);
            assert.equal(guard.canBreak(block('oak_planks', inside(type))), true, type);
            assert.equal(guard.canPlace(inside(type), 'dirt'), true, type);
            assert.equal(guard.refusal(block('oak_planks', inside(type)), 'break'), null, type);
        }
    });

    test('where a mine lies inside a home, the mine decides; where a farm overlaps a mine, the farm', () => {
        store.set({ name: 'shaft', type: 'mine', min: { x: 2, y: 40, z: 2 }, max: { x: 4, y: 66, z: 4 } });
        store.set({ name: 'garden', type: 'farm', min: { x: 84, y: 60, z: 0 }, max: { x: 90, y: 70, z: 6 } });
        const guard = install(fakeBot().bot);
        assert.equal(guard.canBreak(block('dirt', { x: 3, y: 62, z: 3 })), true, 'natural block in the shaft');
        assert.equal(guard.canBreak(block('oak_planks', { x: 3, y: 63, z: 3 })), false, 'the floor of the house');
        assert.equal(guard.canBreak(block('dirt', { x: 5, y: 62, z: 3 })), false, 'beside the shaft: the home');
        assert.equal(guard.canBreak(block('stone', { x: 85, y: 62, z: 3 })), false, 'the farm decides');
        assert.equal(guard.canBreak(block('wheat', { x: 85, y: 64, z: 3 })), true);
    });
});

describe('I3: the view bot.areaGuard', () => {
    test('keeps what it had and gains areaAt, refusal, isBuilt, placedByBot; setPlayerOrder is only on the full guard', () => {
        const { bot } = fakeBot();
        const guard = install(bot);
        assert.ok(Object.isFrozen(bot.areaGuard));
        for (const member of ['canBreak', 'canPlace', 'canUse', 'explain', 'protectMovements', 'inBuilding', 'areaAt', 'refusal', 'isBuilt', 'placedByBot']) {
            assert.equal(typeof bot.areaGuard[member], 'function', member);
            assert.equal(bot.areaGuard[member], guard[member], member);
        }
        for (const member of ['permit', 'revoke', 'permits', 'setPlayerOrder', 'flushPlaced']) {
            assert.equal(bot.areaGuard[member], undefined, member);
            assert.equal(typeof guard[member], 'function', member);
        }
    });

    test('areaAt: { name, type } of the smallest area that holds the position; null outside', () => {
        store.set({ name: 'shaft', type: 'mine', min: { x: 2, y: 40, z: 2 }, max: { x: 4, y: 66, z: 4 } });
        const guard = install(fakeBot().bot);
        assert.deepEqual(guard.areaAt({ x: 3.5, y: 50, z: 3.5 }), { name: 'shaft', type: 'mine' });
        assert.deepEqual(guard.areaAt({ x: 3.5, y: 65, z: 3.5 }), { name: 'shaft', type: 'mine' }, 'smaller than the home');
        assert.deepEqual(guard.areaAt({ x: 5.5, y: 65, z: 3.5 }), { name: 'the_home', type: 'home' });
        guard.permit('the_home', 5);
        assert.deepEqual(guard.areaAt({ x: 5.5, y: 65, z: 3.5 }), { name: 'the_home', type: 'home' }, 'a permit does not move the bot out');
        assert.equal(guard.areaAt({ x: 200, y: 65, z: 3 }), null);
        assert.equal(guard.areaAt(null), null);
    });

    test('isBuilt is isBuiltBlock of area_scan.js', () => {
        const guard = install(fakeBot().bot);
        for (const name of ['oak_fence', 'stone', 'red_bed', 'moss_carpet', 'composter', null]) {
            assert.equal(guard.isBuilt(name), SCAN.isBuiltBlock(name), String(name));
        }
    });

    test('refusal: place and use; a position alone is looked up with bot.blockAt; unknown actions and junk give null', () => {
        const { bot, world } = fakeBot(createBlockWorld().flatGround(63), { held: 'wooden_hoe' });
        const guard = install(bot, { protectBuiltBlocks: true });
        assert.equal(guard.refusal(inside('home'), 'place', { item: 'dirt' }).reason, 'area');
        assert.equal(guard.refusal(inside('farm'), 'place', { item: 'wheat_seeds' }), null);
        assert.equal(guard.refusal(inside('home'), 'use').reason, 'area', 'the hoe in the hand');
        assert.equal(guard.refusal(inside('home'), 'use', { item: null }), null);
        world.set(150, 64, 0, 'oak_fence');
        assert.equal(guard.refusal(vec(150, 64, 0), 'break').reason, 'built_block', 'the name comes from bot.blockAt');
        assert.equal(guard.refusal(vec(150, 63, 0), 'break'), null, 'grass');
        assert.equal(guard.refusal(inside('home'), 'jump'), null);
        assert.equal(guard.refusal(null, 'break'), null);
        assert.equal(guard.refusal({ x: NaN, y: 1, z: 1 }, 'break'), null);
    });
});

describe('D3: built blocks outside every area', () => {
    const FENCE_TEXT = 'oak_fence is a block that players build with. I do not break it. The player can type the command !collectBlocks("oak_fence", 20) in the chat to do it.';
    const outside = { x: 150, y: 64, z: 0 };

    test('switch off: as in v0.1.4.7, built blocks outside the areas are free', () => {
        const guard = install(fakeBot().bot);
        const { breakFn } = exclusions(guard);
        assert.equal(guard.canBreak(block('oak_fence', outside)), true);
        assert.equal(guard.refusal(block('oak_fence', outside), 'break'), null);
        assert.equal(breakFn(block('oak_fence', outside)), 0);
    });

    test('switch on: a built block is refused with the reason built_block and the text of the spec', () => {
        const guard = install(fakeBot().bot, { protectBuiltBlocks: true });
        assert.equal(guard.canBreak(block('oak_fence', outside)), false);
        assert.deepEqual(guard.refusal(block('oak_fence', outside), 'break', { command: '!collectBlocks("oak_fence", 20)' }),
            { reason: 'built_block', area: null, text: FENCE_TEXT });
        assert.equal(guard.canBreak(block('grass_block', outside)), true, 'natural blocks stay free');
        assert.equal(guard.canBreak(block('oak_log', outside)), true, 'a log is natural');
        assert.equal(guard.canPlace(outside, 'dirt'), true, 'placing is not changed');
    });

    test('the command comes from getCommand when the caller names none; without one the sentence stays general', () => {
        const guard = install(fakeBot().bot, { protectBuiltBlocks: true });
        assert.equal(guard.refusal(block('oak_fence', outside), 'break').text,
            'oak_fence is a block that players build with. I do not break it. The player can type the command in the chat to do it.');
        guard.setPlayerOrder(() => false, () => '!collectBlocks("oak_fence", 20)');
        assert.equal(guard.refusal(block('oak_fence', outside), 'break').text, FENCE_TEXT);
    });

    test('the switch may be a function that is read on every call', () => {
        let on = false;
        const guard = install(fakeBot().bot, { protectBuiltBlocks: () => on });
        assert.equal(guard.canBreak(block('oak_fence', outside)), true);
        on = true;
        assert.equal(guard.canBreak(block('oak_fence', outside)), false);
    });

    test('the path search: cost 100 for a built block, 0 for a natural one', () => {
        const guard = install(fakeBot().bot, { protectBuiltBlocks: true });
        const { breakFn } = exclusions(guard);
        assert.equal(breakFn(block('oak_fence', outside)), 100);
        assert.equal(breakFn(block('oak_door', outside)), 100);
        assert.equal(breakFn(block('stone', outside)), 0);
    });

    test('a command typed by the player overrides built_block, never area, and never the path search', () => {
        let typed = true;
        const guard = install(fakeBot().bot, { protectBuiltBlocks: true });
        guard.setPlayerOrder(() => typed);
        const { breakFn } = exclusions(guard);
        assert.equal(guard.canBreak(block('oak_fence', outside)), true);
        assert.equal(guard.refusal(block('oak_fence', outside), 'break'), null);
        assert.equal(breakFn(block('oak_fence', outside)), 100, 'the way to the fence does not break other fences');
        assert.equal(guard.canBreak(block('oak_planks', inside('home'))), false, 'an area stays closed');
        typed = false;
        assert.equal(guard.canBreak(block('oak_fence', outside)), false);
        guard.setPlayerOrder(() => { throw new Error('broken'); });
        assert.equal(guard.canBreak(block('oak_fence', outside)), false, 'an error counts as not typed');
        guard.setPlayerOrder(null);
        assert.equal(guard.canBreak(block('oak_fence', outside)), false);
    });

    test('until setPlayerOrder is called no order counts as typed by the player', () => {
        const guard = install(fakeBot().bot, { protectBuiltBlocks: true });
        assert.equal(guard.canBreak(block('oak_fence', outside)), false);
    });

    test('blocks that the bot placed may be broken: placeBlock notes them, dig forgets them', async () => {
        const { bot, world } = fakeBot();
        const guard = install(bot, { protectBuiltBlocks: true });
        const { breakFn } = exclusions(guard);
        await bot.placeBlock(block('grass_block', { x: 150, y: 63, z: 0 }), vec(0, 1, 0));
        assert.equal(world.get(150, 64, 0), 'oak_planks');
        assert.equal(bot.areaGuard.placedByBot(vec(150.7, 64.2, 0.1)), true);
        assert.equal(guard.canBreak(block('oak_planks', outside)), true);
        assert.equal(breakFn(block('oak_planks', outside)), 0);
        assert.equal(await bot.dig(block('oak_planks', outside)), 'dug');
        assert.equal(guard.placedByBot(outside), false);
        world.set(150, 64, 0, 'oak_planks');
        assert.equal(guard.canBreak(block('oak_planks', outside)), false, 'a new block there is not the bot\'s');
    });

    test('a noted block that someone else breaks leaves the store (blockUpdate to air)', async () => {
        const { bot, world } = fakeBot();
        const guard = install(bot, { protectBuiltBlocks: true });
        await bot.placeBlock(block('grass_block', { x: 150, y: 63, z: 0 }), vec(0, 1, 0));
        const old = world.blockAt(outside);
        world.set(150, 64, 0, 'air');
        bot.emit('blockUpdate', old, world.blockAt(outside));
        assert.equal(guard.placedByBot(outside), false);
        world.set(150, 64, 0, 'oak_fence');
        assert.equal(guard.canBreak(block('oak_fence', outside)), false, 'the fence of the player is protected');
    });

    test('a refused dig rejects with a ProtectedAreaError: reason built_block, no area, the text', async () => {
        const { bot, calls } = fakeBot();
        const lines = [];
        install(bot, { protectBuiltBlocks: true, log: (t) => lines.push(t), getCommand: () => '!collectBlocks("oak_fence", 20)' });
        await assert.rejects(bot.dig(block('oak_fence', outside)), (err) => {
            assert.ok(err instanceof GUARD.ProtectedAreaError);
            assert.equal(err.reason, 'built_block');
            assert.equal(err.area, null);
            assert.deepEqual(err.position, outside);
            assert.equal(err.message, FENCE_TEXT);
            return true;
        });
        assert.deepEqual(lines, [FENCE_TEXT]);
        assert.equal(calls.length, 0);
    });

    test('an area refusal keeps its reason: area', async () => {
        const { bot } = fakeBot();
        install(bot);
        await assert.rejects(bot.dig(block('oak_planks', inside('home'))), { name: 'ProtectedAreaError', reason: 'area', area: 'the_home' });
    });

    test('with the switch on, blocks inside an area follow the rules of the area, not the built rule', () => {
        const guard = install(fakeBot().bot, { protectBuiltBlocks: true });
        guard.setPlayerOrder(() => true);
        assert.equal(guard.refusal(block('oak_fence', inside('farm')), 'break').reason, 'area');
        assert.equal(guard.refusal(block('oak_fence', inside('home')), 'break').reason, 'area');
    });

    test('the real Movements: safeToBreak refuses the fence of a pen that is no saved area', () => {
        const registry = require('prismarine-registry')('1.21.8');
        const Block = require('prismarine-block')(registry);
        const { Vec3 } = require('vec3');
        const Movements = require('mineflayer-pathfinder/lib/movements');
        const real = (name, x, y, z) => {
            const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0);
            b.position = new Vec3(x, y, z);
            return b;
        };
        const movementsBot = {
            registry, game: { minY: -64 }, entity: { position: new Vec3(0, 64, 0), effects: {} }, entities: {},
            inventory: { items: () => [] }, pathfinder: { bestHarvestTool: () => null },
            blockAt: (pos) => real('air', Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)),
        };
        const movements = new Movements(movementsBot);
        const guard = install(fakeBot().bot, { protectBuiltBlocks: true });
        assert.equal(movements.safeToBreak(real('oak_fence', 150, 64, 0)), true, 'before');
        guard.protectMovements(movements);
        assert.equal(movements.safeToBreak(real('oak_fence', 150, 64, 0)), false);
        assert.equal(movements.safeToBreak(real('dirt', 150, 63, 0)), true);
    });

    test('speed: 100,000 calls of the exclusion function with the switch on and 5000 placed blocks', (t) => {
        const placed = new PLACED.PlacedStore(null);
        for (let i = 0; i < 5000; i++) placed.add({ x: 1000 + i, y: 64, z: 0 });
        const guard = install(fakeBot().bot, { protectBuiltBlocks: true, placed, now: () => Date.now() });
        const { breakFn } = exclusions(guard);
        const blocks = [];
        for (let i = 0; i < 1000; i++) {
            blocks.push(block(i % 3 ? 'oak_fence' : 'stone', { x: 200 + (i * 7) % 300, y: 60 + (i % 10), z: (i * 13) % 30 }));
        }
        let best = Infinity;
        let sum = 0;
        for (let round = 0; round < 3; round++) {
            const started = performance.now();
            for (let i = 0; i < 100_000; i++) sum += breakFn(blocks[i % 1000]);
            best = Math.min(best, performance.now() - started);
        }
        t.diagnostic(`100,000 calls: ${best.toFixed(1)} ms (best of 3)`);
        assert.ok(sum > 0);
        assert.ok(best < 250, `took ${best} ms`);
    });
});

describe('D3: more names in isBuiltBlock', () => {
    test('beds, signs, banners, composter, plates, buttons, rails, lever, pots, campfires, anvil, cauldron, hopper, bell, lectern, loom, shulker boxes', () => {
        const built = ['red_bed', 'white_bed', 'oak_sign', 'oak_wall_sign', 'cherry_hanging_sign', 'oak_wall_hanging_sign',
            'white_banner', 'red_wall_banner', 'composter', 'stone_pressure_plate', 'light_weighted_pressure_plate',
            'oak_button', 'stone_button', 'rail', 'powered_rail', 'detector_rail', 'activator_rail', 'lever', 'flower_pot',
            'potted_poppy', 'potted_oak_sapling', 'campfire', 'soul_campfire', 'anvil', 'chipped_anvil', 'damaged_anvil',
            'cauldron', 'water_cauldron', 'lava_cauldron', 'powder_snow_cauldron', 'hopper', 'bell', 'lectern', 'loom',
            'shulker_box', 'red_shulker_box', 'minecraft:composter'];
        for (const name of built) assert.equal(SCAN.isBuiltBlock(name), true, name);
    });

    test('_stairs and _slab of every material', () => {
        for (const name of ['oak_stairs', 'cobblestone_stairs', 'mud_brick_stairs', 'cut_copper_stairs', 'bamboo_mosaic_stairs',
            'oak_slab', 'stone_slab', 'smooth_stone_slab', 'petrified_oak_slab', 'tuff_slab', 'resin_brick_slab', 'waxed_cut_copper_slab']) {
            assert.equal(SCAN.isBuiltBlock(name), true, name);
        }
    });

    test('natural names stay natural', () => {
        for (const name of ['moss_carpet', 'pale_moss_carpet', 'smooth_basalt', 'nether_quartz_ore', 'stone', 'dirt', 'grass_block',
            'oak_log', 'oak_leaves', 'short_grass', 'poppy', 'sweet_berry_bush', 'pointed_dripstone', 'terracotta', 'red_sand', 'bamboo',
            'mangrove_roots', 'water', 'lava', 'snow', 'sculk_sensor', 'amethyst_cluster']) {
            assert.equal(SCAN.isBuiltBlock(name), false, name);
        }
    });
});
