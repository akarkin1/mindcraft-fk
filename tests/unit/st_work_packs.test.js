// T1, spec v0.1.4.8 section 9 (part E) and the interfaces I6, I9, tested from the spec and the handoff:
//   E1 storage: a chest counts as blocked only after an open failed (the chest at the fence line of the
//      play test); chestsText with an item answers from the index; without an item up to 10 kinds per
//      chest; fetchItem for an unknown item opens at most 3 unknown chests within 16 blocks; noteProgress;
//   E2 farming: compost items (leaf_litter yes; seeds, crops, food never), the composter, the texts of the
//      spec built from the text functions, plantText with tilled blocks, no sentence about shears;
//   E3 wood and tools: chopArgs in both orders, chooseMaterial with the chests (130 cobblestone: stone),
//      never a pickaxe for wood, the text of a failed craft, the text of a stopped chopTrees (I6);
//   E4 mining: the owner's mine needs 10 ladders, not 57; mineOre without a mine asks and does nothing;
//      a new entrance keeps 16 blocks from houses, farms, pens and the place home; underground it refuses;
//      the supplies text; eatIfHungry sees the off-hand;
//   E5 / I9 knowledgeText in the format of the spec, cut at whole lines, the nearest chests first.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Vec3 } from 'vec3';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { makeFakeBot, REGISTRY } from '../helpers/st_modes_env.js';

const storage = await loadSrc('src/agent/packs/storage/index.js');
const crop = await loadSrc('src/agent/packs/farming/crop_logic.js');
const field = await loadSrc('src/agent/packs/farming/field_logic.js');
const farmTexts = await loadSrc('src/agent/packs/farming/texts.js');
const wood = await loadSrc('src/agent/packs/wood/index.js');
const woodActions = await loadSrc('src/agent/packs/wood/actions.js');
const mineLogic = await loadSrc('src/agent/packs/mining/mine_logic.js');
const mining = await loadSrc('src/agent/packs/mining/index.js');
const knowledge = await loadSrc('src/agent/knowledge/knowledge_text.js');

const LIMIT = { timeout: 30000 };

// The chest of the house of the owner (chests.json of the play test), and wheat 28 as in the spec.
const OWNER_CHEST = { sand: 18, stone_sword: 1, white_banner: 1, coal: 39, wheat_seeds: 52, oak_slab: 5, oak_sapling: 5, lilac: 5, granite: 18,
    bone: 1, leaf_litter: 104, dirt: 27, oak_door: 2, cobblestone: 81, birch_log: 5, leather: 4, oak_log: 3, charcoal: 2, stick: 1, bone_meal: 1,
    granite_stairs: 12, feather: 2, wooden_axe: 1, wooden_shovel: 1, diorite: 18, copper_ingot: 23, rotten_flesh: 1, birch_sapling: 2, flint: 1,
    raw_copper: 52, bow: 1, ominous_bottle: 1, cobblestone_stairs: 22, spider_eye: 3, lapis_lazuli: 49, iron_ingot: 6, gravel: 56, white_wool: 1 };

// The mines.json of the owner (2026-09-29): ladders from y 66 down to y 25, level 16, no base.
const OWNER_MINES = { version: 1, mines: { 16: { ore: 'iron', entrance: { x: 9, y: 67, z: 58 }, level: 16, base: null, chest: null,
    direction: 'west', length: 0, shaft: 'ladder', created: '2026-09-28T22:55:33.346Z', updated: '2026-09-28T22:58:35.510Z',
    dimension: 'overworld', ores: ['iron'], end: null, tunnel: [],
    route: [{ kind: 'ladder', x: 9, z: 58, top: 66, bottom: 25, face: 'west', entry: { x: 10, y: 67, z: 58 } }] } } };

let cap;
let dir;
beforeEach(() => {
    cap = captureConsole();
    dir = makeTmpDir();
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

function index(chests) {
    const idx = new storage.ChestIndex(null);
    for (const c of chests) idx.update({ dimension: 'overworld', kind: 'chest', free_slots: 5, ...c });
    return idx;
}

// ------------------------------------------------------------------------------------------ E1

describe('E1: chestsText', () => {
    test('with an item: "wheat: 28 in the chest at (11, 67, 53). Total 28."', () => {
        const idx = index([{ x: 11, y: 67, z: 53, items: { ...OWNER_CHEST, wheat: 28 } }, { x: 11, y: 41, z: 44, items: {} }]);
        assert.equal(storage.chestsText(idx, 'wheat'), 'wheat: 28 in the chest at (11, 67, 53). Total 28.');
        assert.equal(storage.chestsText({ chests: idx }, 'wheat', 'overworld'), 'wheat: 28 in the chest at (11, 67, 53). Total 28.', 'a ctx works too');
    });

    test('with an item no chest holds: "I know no chest with wheat."', () => {
        const idx = index([{ x: 11, y: 67, z: 53, items: OWNER_CHEST }]);
        assert.equal(storage.chestsText(idx, 'wheat'), 'I know no chest with wheat.');
    });

    test('several chests: the total', () => {
        const idx = index([{ x: 11, y: 67, z: 53, items: { wheat: 28 } }, { x: -13, y: 63, z: 28, items: { wheat: 5 } }]);
        assert.equal(storage.chestsText(idx, 'wheat'), 'wheat: 28 in the chest at (11, 67, 53), 5 in the chest at (-13, 63, 28). Total 33.');
    });

    test('without an item: up to 10 kinds per chest, by count, then "and N more kinds" (C2: wheat hid in "32 more kinds")', () => {
        const idx = index([{ x: 11, y: 67, z: 53, items: { ...OWNER_CHEST, wheat: 28 } }]);
        const text = storage.chestsText(idx, '');
        const line = text.split('\n').find((l) => l.includes('(11, 67, 53)'));
        const kinds = line.split(':')[1].split(' and ')[0].split(',').filter((p) => /\d+ \w+/.test(p));
        assert.equal(kinds.length, 10, line);
        assert.ok(line.startsWith('- (11, 67, 53): 104 leaf_litter, 81 cobblestone, 56 gravel, '), line);
        assert.match(line, /and 29 more kinds/);
    });
});

describe('E1: the chest at the fence line and fetchItem', () => {
    // A chest window: 27 slots of the chest, then the inventory.
    function chestWindow(items) {
        const slots = new Array(63).fill(null);
        items.forEach(([name, count], i) => { slots[i] = { name, count, type: REGISTRY.itemsByName[name].id, slot: i }; });
        return { inventoryStart: 27, inventoryEnd: 63, slots, close() {}, containerItems: () => slots.slice(0, 27).filter(Boolean) };
    }

    test('play test C4: a chest with a fence above it opens and is in the index (blocked only after an open failed)', LIMIT, async () => {
        const w = createBlockWorld().flatGround(63);
        w.set(3, 64, 0, 'chest', { type: 'single', facing: 'north' });
        w.set(3, 65, 0, 'oak_fence');
        const bot = makeFakeBot({ world: w });
        bot.gotoImpl = async (goal) => { if (Number.isFinite(goal?.x)) bot.entity.position = new Vec3(goal.x - 1.5, 64, goal.z + 0.5); };
        const notes = [];
        bot.modes = { noteProgress: (r) => notes.push(r), pause() {}, isOn: () => false, exists: () => false };
        let opened = 0;
        bot.openContainer = async () => { opened++; return chestWindow([['wheat', 28]]); };
        const idx = new storage.ChestIndex(null);
        const chests = await storage.lookIntoChests(bot, { chests: idx, log() {} }, 16);
        assert.equal(opened, 1);
        assert.equal(chests.length, 1);
        assert.equal(idx.find('wheat', 'overworld').length, 1);
        assert.ok(notes.includes('chest'), 'noteProgress("chest")');
    });

    test('fetchItem for an item no known chest holds answers from the index: at most 3 unknown chests within 16 blocks are opened', LIMIT, async () => {
        const w = createBlockWorld().flatGround(63);
        const known = [[2, 64, 2], [2, 64, -2]];
        const unknown = [[5, 64, 0], [7, 64, 0], [9, 64, 0], [11, 64, 0], [13, 64, 0]];
        const far = [20, 64, 0];
        for (const [x, y, z] of [...known, ...unknown, far]) w.set(x, y, z, 'chest', { type: 'single', facing: 'north' });
        const bot = makeFakeBot({ world: w });
        bot.gotoImpl = async (goal) => { if (Number.isFinite(goal?.x)) bot.entity.position = new Vec3(goal.x + 0.5, 64, goal.z + 1.5); };
        const openedAt = [];
        bot.openContainer = async (block) => { openedAt.push(block.position.x); return chestWindow([['cobblestone', 10]]); };
        const idx = index(known.map(([x, y, z]) => ({ x, y, z, items: { dirt: 3 } })));
        const r = await storage.fetchItem(bot, { chests: idx, log() {} }, 'wheat', 5);
        assert.equal(r.ok, false);
        assert.ok(openedAt.length <= 3, `opened ${openedAt.length}`);
        assert.ok(!openedAt.includes(2), 'the known chests are answered from the index');
        assert.ok(!openedAt.includes(20), 'not farther than 16 blocks');
        assert.equal(r.text, 'I know no chest with wheat.');
    });
});

describe('I6: fetchItem stopped between two chests', () => {
    test('{ ok: false, reason: "interrupted", text } and the text says what was taken', LIMIT, async () => {
        const w = createBlockWorld().flatGround(63);
        w.set(3, 64, 0, 'chest', { type: 'single', facing: 'north' });
        w.set(9, 64, 0, 'chest', { type: 'single', facing: 'north' });
        const bot = makeFakeBot({ world: w });
        // the first chest is within reach (no walk); !stop comes on the way to the second one
        bot.gotoImpl = async () => { bot.interrupt_code = true; return new Promise(() => {}); };
        bot.openContainer = async () => {
            const slots = new Array(63).fill(null);
            slots[0] = { name: 'wheat', count: 5, type: REGISTRY.itemsByName.wheat.id, slot: 0 };
            return { inventoryStart: 27, inventoryEnd: 63, slots, close() {},
                async withdraw(type, meta, n) { slots[0] = null; slots[30] = { name: 'wheat', count: n, type, slot: 30 }; } };
        };
        const idx = index([{ x: 3, y: 64, z: 0, items: { wheat: 5 } }, { x: 9, y: 64, z: 0, items: { wheat: 5 } }]);
        const r = await storage.fetchItem(bot, { chests: idx, log() {} }, 'wheat', 10);
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'interrupted');
        assert.equal(r.taken, 5);
        assert.equal(r.text, 'I took 5 wheat from the chest at (3, 64, 0). I was stopped.');
    });
});

// ------------------------------------------------------------------------------------------ E2

describe('E2: compost items and the composter', () => {
    test('leaf_litter is a compost item and a block to pick (without shears)', () => {
        assert.equal(crop.isCompostable('leaf_litter'), true);
        assert.equal(crop.compostSource('leaf_litter', {}, false), true);
        assert.equal(crop.compostSource('poppy', {}, false), true, 'flowers without shears');
    });

    test('never seeds, never crops, never food', () => {
        const never = ['wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds', 'torchflower_seeds', 'pitcher_pod',
            'wheat', 'carrot', 'potato', 'beetroot', 'melon_slice', 'pumpkin', 'sugar_cane', 'cactus', 'nether_wart',
            'bread', 'apple', 'cookie', 'baked_potato', 'sweet_berries', 'glow_berries', 'dried_kelp', 'cake', 'pumpkin_pie', 'bone_meal', 'hay_block'];
        assert.deepEqual(never.filter((n) => crop.isCompostable(n)), []);
    });

    test('the item that goes in first is never a seed, a crop or food', () => {
        assert.equal(crop.chooseCompostItem([{ name: 'wheat_seeds', count: 50 }, { name: 'bread', count: 3 }, { name: 'leaf_litter', count: 21 }]), 'leaf_litter');
        assert.equal(crop.chooseCompostItem([{ name: 'wheat_seeds', count: 50 }, { name: 'carrot', count: 3 }]), null);
    });

    test('compost items of the known chests: leaf_litter of the owner\'s chest counts', () => {
        const list = crop.compostInChests([{ items: OWNER_CHEST }]);
        assert.equal(list[0].name, 'leaf_litter');
        assert.equal(list[0].count, 104);
        assert.ok(!list.some((e) => e.name === 'wheat_seeds'));
    });

    test('the composter inside the farm area or within 8 blocks of it; else the nearest within 32 of the bot', () => {
        const farm = { min: { x: -13, y: 61, z: 23 }, max: { x: -6, y: 65, z: 34 } };
        const atFarm = { x: -3, y: 63, z: 28 }; // 2 blocks east of the box
        const nearBot = { x: 10, y: 67, z: 50 };
        assert.deepEqual(field.chooseComposter([nearBot, atFarm], farm, { x: 10.5, y: 67, z: 51.5 }), atFarm);
        assert.deepEqual(field.chooseComposter([nearBot], farm, { x: 10.5, y: 67, z: 51.5 }), nearBot);
        assert.equal(field.chooseComposter([{ x: 60, y: 64, z: 60 }], farm, { x: 10.5, y: 67, z: 51.5 }), null, 'farther than 32 from the bot');
    });
});

describe('E2: the texts of the farm cycle', () => {
    test('the first example of the spec, from the text functions', () => {
        const text = farmTexts.cycleText('farm', [
            farmTexts.harvestText({ byCrop: { wheat: 10 }, replanted: 10, unripe: 0 }),
            farmTexts.notRipeText(48),
            farmTexts.boneMealStepText({ made: 3, compost: { leaf_litter: 21 }, sources: { carried: 0, chest: 21, picked: 0 },
                compostChests: [{ x: 11, y: 67, z: 53 }], used: 3 }),
            farmTexts.ripenedText(9),
            farmTexts.TEXTS.gateClosed,
        ]);
        assert.equal(text, 'Farm "farm": I harvested 10 wheat and planted 10 again. 48 plants are not ripe. I made 3 bone_meal from 21 leaf_litter of the chest at (11, 67, 53) and used them. 9 more plants got ripe and I harvested them. The gate is closed.');
    });

    test('the second example of the spec', () => {
        assert.equal(`${farmTexts.TEXTS.nothingToCompostCycle} ${farmTexts.growingText(48)}`,
            'I have nothing to compost and the chests I know have nothing. 48 plants are growing. Nothing to do now.');
    });

    test('the sentence about shears goes away', () => {
        for (const text of Object.values(farmTexts.TEXTS)) assert.ok(!text.includes('shears'), text);
        assert.ok(!farmTexts.boneMealText(0, 0, 'no_items').includes('shears'));
    });

    test('plantText says how many blocks were tilled', () => {
        assert.equal(farmTexts.plantText({ planted: 12, seed: 'wheat_seeds', tilled: 4 }), 'I tilled 4 blocks and planted 12 wheat_seeds.');
        assert.equal(farmTexts.plantText({ planted: 12, seed: 'wheat_seeds', tilled: 0 }), 'I planted 12 wheat_seeds.');
    });
});

// ------------------------------------------------------------------------------------------ E3

describe('E3: wood and tools', () => {
    test('chopTrees takes its arguments in both orders (T5: the model wrote !chopTrees("", 8))', () => {
        assert.deepEqual(wood.chopArgs(8, 'oak'), { count: 8, kind: 'oak' });
        assert.deepEqual(wood.chopArgs('oak', 8), { count: 8, kind: 'oak' });
        assert.deepEqual(wood.chopArgs('', 8), { count: 8, kind: '' });
    });

    test('play test T3: an empty material with 130 cobblestone in a known chest gives stone', () => {
        assert.equal(wood.chooseMaterial('pickaxe', '', [{ name: 'oak_log', count: 4 }], { chests: { cobblestone: 130 } }), 'stone');
        assert.equal(wood.chooseMaterial('pickaxe', '', [{ name: 'oak_log', count: 4 }], { chests: [{ name: 'cobblestone', count: 130 }] }), 'stone');
    });

    test('an empty material: the best that can be made, up to stone; wooden without cobblestone', () => {
        assert.equal(wood.chooseMaterial('pickaxe', '', [{ name: 'oak_log', count: 4 }]), 'wooden');
        assert.equal(wood.chooseMaterial('pickaxe', '', [{ name: 'oak_log', count: 4 }], { chests: { iron_ingot: 30, cobblestone: 64, diamond: 9 } }), 'stone');
        assert.equal(wood.chooseMaterial('pickaxe', 'iron', [{ name: 'oak_log', count: 4 }], { chests: { iron_ingot: 30 } }), 'iron', 'named: iron');
    });

    test('M12: the warning of a failed craft names the item and the missing ingredient', () => {
        assert.equal(wood.craftFailedText('stone_pickaxe', { name: 'stick', need: 2, have: 1 }), 'I could not craft stone_pickaxe: I need 2 stick and have 1.');
    });

    test('I6: chopTrees stopped says what it cut and what it picked up', () => {
        assert.equal(wood.chopStoppedText({ cut: { oak_log: 3 }, picked: 2 }), 'I cut 3 oak_log and picked up 2. I was stopped before I picked up the rest.');
    });

    test('without an axe it cuts with an empty hand, never with a pickaxe', LIMIT, async () => {
        const bot = makeFakeBot();
        bot.inventory.put('stone_pickaxe', 1, 36);
        bot.unequip = async () => { const it = bot.inventory.slots[36]; bot.inventory.slots[36] = null; bot.inventory.put(it.name, it.count); };
        assert.equal(await woodActions.holdBestOrHand(bot, 'axe'), false);
        assert.equal(bot.heldItem, null, 'the pickaxe is put away');
    });

    test('before the first tree it asks ctx.tools.ensureTool for an axe (from the inventory and the chests only); stopped then: I6', LIMIT, async () => {
        const w = createBlockWorld().flatGround(63);
        w.tree({ x: 4, y: 63, z: 0, height: 5 });
        const bot = makeFakeBot({ world: w });
        bot.gotoImpl = async () => {};
        const asked = [];
        const ctx = { areas: [], log() {}, settings: {}, tools: { ensureTool: async (b, c, kind, material, options) => {
            asked.push({ kind, material, collect: options?.collect });
            bot.interrupt_code = true; // !stop while it gets the axe
            return { ok: false, reason: 'missing', text: 'I have no axe.' };
        } } };
        const r = await wood.chopTrees(bot, ctx, 8);
        assert.deepEqual(asked, [{ kind: 'axe', material: '', collect: false }]);
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'interrupted');
        assert.equal(r.text, 'I stopped before I cut a tree.');
        assert.equal(w.get(4, 64, 0), 'oak_log', 'nothing was cut');
    });

    test('with an axe it holds the axe', LIMIT, async () => {
        const bot = makeFakeBot();
        bot.inventory.put('stone_pickaxe', 1, 36);
        bot.inventory.put('wooden_axe', 1, 12);
        assert.equal(await woodActions.holdBestOrHand(bot, 'axe'), true);
        assert.equal(bot.heldItem?.name, 'wooden_axe');
    });
});

// ------------------------------------------------------------------------------------------ E4

describe('E4: mining, the minimum', () => {
    test('play test M1, M2: the owner\'s mine (ladders from y 66 down to y 25, level 16, no base) needs 10 ladders, not 57', () => {
        const r = mineLogic.tripNeeds('iron', 67, 16, [{ name: 'stone_pickaxe', count: 1, uses_left: 131 }], { shaftExists: true, wayDownTo: 25, hasBase: false });
        assert.equal(r.needs.find((n) => n.name === 'ladder')?.count, 10);
        const fresh = mineLogic.tripNeeds('iron', 67, 16, [], {});
        assert.equal(fresh.needs.find((n) => n.name === 'ladder')?.count, 57, 'a new shaft of the same depth');
    });

    test('the same through prepareMiningTrip with the owner\'s mines.json: "I get my supplies: 10 ladders, ..."', LIMIT, async () => {
        const file = path.join(dir, 'mines.json');
        fs.writeFileSync(file, JSON.stringify(OWNER_MINES));
        const mines = new mining.MineStore(file);
        mines.load();
        const bot = makeFakeBot({ pos: [9.5, 67, 58.5] });
        bot.inventory.put('stone_pickaxe', 1, 36);
        const said = [];
        await mining.prepareMiningTrip(bot, { mines, say: (t) => said.push(t), log() {}, settings: {} }, 'iron');
        assert.ok(said.length > 0, 'it says what it prepares');
        assert.match(said[0], /^I get my supplies: 10 ladders, /);
    });

    test('the supplies text of the spec', () => {
        assert.equal(mining.suppliesText([{ name: 'ladder', count: 16 }, { name: 'torch', count: 8 }, { name: 'chest', count: 1 }]),
            'I get my supplies: 16 ladders, 8 torches, a chest.');
    });

    test('shaftExists (the route has a leg): the rest of the way only', () => {
        const r = mineLogic.tripNeeds('iron', 67, 16, [], { shaftExists: true, wayDownTo: 16, hasBase: true });
        assert.equal(r.needs.find((n) => n.name === 'ladder'), undefined, 'the way reaches the level');
        assert.equal(r.needs.find((n) => n.name === 'chest'), undefined, 'the base is there');
    });

    // the base of the owner: the house around the place home at (12, 67, 52), flat ground at 66
    function base({ underground = false } = {}) {
        const w = createBlockWorld().flatGround(66);
        const bot = makeFakeBot({ world: w, pos: [9.5, 67, 58.5] });
        const calls = [];
        const spy = (name) => async (...args) => { calls.push(name); return { ok: false, reason: 'test', text: '' }; };
        bot.dig = async () => { calls.push('dig'); };
        bot.placeBlock = async () => { calls.push('placeBlock'); };
        bot.craft = async () => { calls.push('craft'); };
        const said = [];
        const ctx = {
            settings: {}, log() {}, say: (t) => said.push(t),
            areas: [{ name: 'home', type: 'home', min: { x: 8, y: 66, z: 47 }, max: { x: 16, y: 71, z: 57 }, dimension: 'overworld' }],
            places: { recall: (n) => (n === 'home' ? { x: 12.46, y: 67, z: 52.51, dimension: 'overworld' } : null) },
            mines: new mining.MineStore(null),
            storage: { fetchItem: spy('fetchItem'), storeItems: spy('storeItems') },
            tools: { ensureTool: spy('ensureTool'), craftSupplies: spy('craftSupplies') },
            whereAmI: () => ({ area: null, depth: underground ? 30 : 0, underground }),
        };
        bot.inventory.put('stone_pickaxe', 1, 36);
        return { bot, ctx, calls, said };
    }

    test('mineOre without a known mine and without newMine: reason ask, the text of the spec, nothing dug, crafted or fetched', LIMIT, async () => {
        const { bot, ctx, calls } = base();
        const r = await mining.mineOre(bot, ctx, 'iron', 8);
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'ask');
        const m = /^I know no mine for iron\. I can dig a new one at \((-?\d+), (-?\d+), (-?\d+)\), (\d+) blocks from your house\. Tell me to do it, or show me your mine\.$/.exec(r.text);
        assert.ok(m, r.text);
        assert.deepEqual(calls, [], 'nothing dug, crafted or fetched');
        const [x, , z] = [Number(m[1]), Number(m[2]), Number(m[3])];
        assert.ok(Math.hypot(x + 0.5 - 12.46, z + 0.5 - 52.51) >= 16, `the entrance (${x}, ${z}) keeps 16 blocks from the place home`);
        assert.ok(Number(m[4]) >= 16, 'at least 16 blocks from the house');
    });

    test('underground: "I am underground. I start a new mine only from the surface."', LIMIT, async () => {
        const { bot, ctx, calls } = base({ underground: true });
        const r = await mining.mineOre(bot, ctx, 'iron', 8, { newMine: true });
        assert.equal(r.ok, false);
        assert.equal(r.text, 'I am underground. I start a new mine only from the surface.');
        assert.deepEqual(calls, []);
    });

    test('a new entrance is never within 16 blocks of an area of the types home, building, pen, farm, nor of the place home', () => {
        const box = (type, x) => ({ name: type, type, min: { x, y: 60, z: 0 }, max: { x: x + 4, y: 66, z: 4 } });
        for (const type of ['home', 'building', 'pen', 'farm']) {
            assert.equal(mineLogic.entranceAllowed({ x: 20, z: 2 }, [box(type, 0)]), false, `${type}: 15.5 blocks`);
            assert.equal(mineLogic.entranceAllowed({ x: 21, z: 2 }, [box(type, 0)]), true, `${type}: 16.5 blocks`);
        }
        assert.equal(mineLogic.entranceAllowed({ x: 14, z: 2 }, [box('mine', 0)]), true, 'a mine: only the 8 blocks of every area');
        assert.equal(mineLogic.entranceAllowed({ x: 9, z: 58 }, [], [{ x: 12.46, z: 52.51 }]), false, 'play test: 6.5 blocks from the place home');
        assert.equal(mineLogic.entranceAllowed({ x: 12, z: 69 }, [], [{ x: 12.46, z: 52.51 }]), true);
    });

    test('chooseEntrance keeps the rule for every place it offers', () => {
        const homes = [{ x: 12.46, z: 52.51 }];
        const areas = [{ name: 'farm', type: 'farm', min: { x: -13, y: 61, z: 23 }, max: { x: -6, y: 65, z: 34 } }];
        const e = mineLogic.chooseEntrance({ bot: { x: 9.5, y: 67, z: 58.5 }, level: 16, areas, homes, ground: () => ({ y: 66, name: 'grass_block' }) });
        assert.ok(e, 'a place is found');
        assert.ok(mineLogic.entranceAllowed(e, areas, homes));
        assert.ok(Math.hypot(e.x + 0.5 - 12.46, e.z + 0.5 - 52.51) >= 16);
    });

    test('tripStart: use a known mine; underground; ask without newMine; new with it', () => {
        assert.equal(mineLogic.tripStart({ mine: { ore: 'iron' }, newMine: false }), 'use');
        assert.equal(mineLogic.tripStart({ mine: null, newMine: false }), 'ask');
        assert.equal(mineLogic.tripStart({ mine: null, newMine: true }), 'new');
        assert.equal(mineLogic.tripStart({ mine: null, newMine: true, underground: true }), 'underground');
    });
});

// ------------------------------------------------------------------------------------------ E5

describe('E5, I9: the knowledge text', () => {
    // The example of the spec: the owner's chest without its gravel 56 (the example was written before
    // it came), with one more kind so that 38 kinds leave "32 more kinds".
    const { gravel, ...EXAMPLE_CHEST } = { ...OWNER_CHEST, glass: 1 };
    const INPUT = {
        where: { area: { name: 'farm', type: 'farm' }, depth: 0, underground: false },
        chests: [{ x: 11, y: 67, z: 53, items: EXAMPLE_CHEST }, { x: 11, y: 41, z: 44, items: {} }],
        areas: [{ name: 'home', type: 'home', entrances: [{ kind: 'door' }] }, { name: 'farm', type: 'farm', entrances: [{ x: -6, y: 63, z: 28, kind: 'gate' }] },
            { name: 'mine', type: 'mine', entrances: [] }],
        mines: [{ ore: 'iron', entrance: { x: 9, y: 67, z: 58 }, level: 16 }],
    };
    const EXAMPLE = [
        'WHAT YOU KNOW (from memory, no need to check):',
        'You are in the area "farm" (farm), on the surface.',
        'Chest (11, 67, 53): leaf_litter 104, cobblestone 81, raw_copper 52, wheat_seeds 52, lapis_lazuli 49, coal 39 and 32 more kinds.',
        'Chest (11, 41, 44): empty.',
        'Areas: home (home), farm (farm, 1 gate), mine (mine).',
        'Mines: iron, entrance (9, 67, 58), level 16.',
    ].join('\n');

    test('the format of the spec, word for word (the chests of the example)', () => {
        assert.equal(knowledge.knowledgeText(INPUT), EXAMPLE);
    });

    test('the default upper limit is 600 characters', () => {
        const many = Array.from({ length: 30 }, (_, i) => ({ x: i, y: 64, z: 0, items: { cobblestone: 64 + i, dirt: 10 } }));
        const text = knowledge.knowledgeText({ ...INPUT, chests: many });
        assert.ok(text.length <= 600, `${text.length}`);
        assert.equal(knowledge.KNOWLEDGE_MAX_CHARS, 600);
    });

    test('cut at whole lines: every line is a line of the whole text', () => {
        const whole = knowledge.knowledgeText(INPUT, 100000).split('\n');
        for (const max of [60, 120, 200, 260, 330]) {
            const text = knowledge.knowledgeText(INPUT, max);
            assert.ok(text.length <= max, `${max}: ${text.length}`);
            for (const line of text.split('\n').filter(Boolean)) assert.ok(whole.includes(line), `${max}: ${line}`);
        }
    });

    test('the nearest chests first', () => {
        const chests = [{ x: 100, y: 64, z: 0, items: { dirt: 1 } }, { x: 1, y: 64, z: 0, items: { stone: 1 } }];
        const text = knowledge.knowledgeText({ chests, where: { depth: 0, underground: false, pos: { x: 0, y: 64, z: 0 } } });
        const lines = text.split('\n');
        assert.ok(lines.indexOf('Chest (1, 64, 0): stone 1.') < lines.indexOf('Chest (100, 64, 0): dirt 1.'), text);
        const cut = knowledge.knowledgeText({ chests, where: { depth: 0, underground: false, pos: { x: 0, y: 64, z: 0 } } },
            'WHAT YOU KNOW (from memory, no need to check):'.length + 1 + 'You are on the surface.'.length + 1 + 'Chest (1, 64, 0): stone 1.'.length);
        assert.ok(cut.includes('Chest (1, 64, 0)') && !cut.includes('Chest (100, 64, 0)'), cut);
    });
});
