// T1, spec v0.1.4.8 section 6 (part B): skills.js and world.js on a fake bot (tests/helpers/st_modes_env.js),
// tested from the spec and the handoff:
//   B1 collectBlock asks the guard for every block (with the real guard of part D and protect_built_blocks:
//      the fences of the pen of the play test stand, the text of the refusal is the answer); the count is
//      what the inventory gained; breakBlockAt and placeBlock name the reason of a refusal;
//   B2 the off-hand (slot 45): consume, discard, equip, the counts, the line of !inventory;
//   B3 walking: an interrupted walk ends within 1 s; the texts of goToPosition; noteProgress('path');
//      moveAway opens a trapdoor in its way while the door reflex is on;
//   B4 pickUpItems; B5 the chest in one line; B6 smeltItem counts what it made, discard walks at most 3 s.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Vec3 } from 'vec3';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { loadModes, makeFakeBot, hang, noPath, itemEntity, REGISTRY } from '../helpers/st_modes_env.js';

const M = await loadModes();
const skills = M.skills;
const world = await loadSrc('src/agent/library/world.js');
const guardMod = await loadSrc('src/agent/areas/area_guard.js');
const storeMod = await loadSrc('src/agent/areas/area_store.js');

const LIMIT = { timeout: 30000 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const FENCE_TEXT = 'oak_fence is a block that players build with. I do not break it. The player can type the command !collectBlocks("oak_fence", 20) in the chat to do it.';

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

// Walks arrive at the goal of a GoalNear or GoalBlock, and at the entity of a GoalFollow.
function arrive(bot) {
    return async (goal) => {
        if (goal?.entity?.position) bot.entity.position = goal.entity.position.clone();
        else if (Number.isFinite(goal?.x) && Number.isFinite(goal?.z)) bot.entity.position = new Vec3(goal.x + 0.5, Number.isFinite(goal.y) ? goal.y : bot.entity.position.y, goal.z + 0.5);
    };
}

// What a broken block drops into the inventory.
const DROPS = { oak_log: [['oak_log', 1]], oak_fence: [['oak_fence', 1]], tall_grass: [], short_grass: [], iron_ore: [['raw_iron', 1]], stone: [['cobblestone', 1]] };

function collectScene(blocks) {
    const w = createBlockWorld().flatGround(63);
    for (const [name, x, y, z] of blocks) w.set(x, y, z, name);
    const bot = makeFakeBot({ world: w, pos: [0.5, 64, 0.5], realBlocks: true });
    bot.gotoImpl = arrive(bot);
    bot.broken = [];
    const breakIt = (block) => {
        const p = block.position;
        bot.broken.push(`${block.name}@${p.x},${p.y},${p.z}`);
        w.set(p.x, p.y, p.z, 'air');
        for (const [name, n] of DROPS[block.name] ?? []) bot.inventory.add(name, n);
    };
    bot.collectBlock = { async collect(block) { breakIt(block); }, cancelTask() {} };
    bot.dig = async (block) => { breakIt(block); };
    return { w, bot };
}

// ------------------------------------------------------------------------------------------ B1

describe('B1: collectBlock and the guard', () => {
    const PEN = [['oak_fence', 3, 64, 0], ['oak_fence', 4, 64, 0], ['oak_fence', 5, 64, 0], ['oak_fence', 6, 64, 0], ['oak_fence', 6, 64, 1]];

    test('play test P1: !collectBlocks("oak_fence", 20) with protect_built_blocks: every fence stands, the text of the refusal is the answer', LIMIT, async () => {
        const { w, bot } = collectScene(PEN);
        guardMod.installAreaGuard(bot, { store: null, protectBuiltBlocks: true, getCommand: () => '!collectBlocks("oak_fence", 20)', log: () => {} });
        const got = await skills.collectBlock(bot, 'oak_fence', 20);
        assert.equal(got, false);
        assert.deepEqual(bot.broken, []);
        for (const [, x, y, z] of PEN) assert.equal(w.get(x, y, z), 'oak_fence');
        assert.equal(bot.output, `${FENCE_TEXT}\n`);
    });

    test('protect_built_blocks off: the fences are taken, as in v0.1.4.7', LIMIT, async () => {
        const { bot } = collectScene(PEN);
        guardMod.installAreaGuard(bot, { store: null, protectBuiltBlocks: false, log: () => {} });
        assert.equal(await skills.collectBlock(bot, 'oak_fence', 2), true);
        assert.equal(bot.broken.length, 2);
        assert.equal(bot.output.trim().split('\n').at(-1), 'Collected 2 oak_fence.');
    });

    test('the count is what the inventory gained: "Collected 3 oak_log."', LIMIT, async () => {
        const { bot } = collectScene([['oak_log', 3, 64, 0], ['oak_log', 3, 65, 0], ['oak_log', 3, 66, 0]]);
        assert.equal(await skills.collectBlock(bot, 'oak_log', 3), true);
        assert.equal(bot.output.trim().split('\n').at(-1), 'Collected 3 oak_log.');
    });

    test('tall_grass by hand: "I broke 10 tall_grass and got nothing. tall_grass drops nothing without shears."', LIMIT, async () => {
        const blocks = [];
        for (let x = 2; x < 7; x++) blocks.push(['tall_grass', x, 64, 3], ['tall_grass', x, 64, -3]);
        const { bot } = collectScene(blocks);
        assert.equal(await skills.collectBlock(bot, 'tall_grass', 10), false);
        assert.equal(bot.broken.length, 10);
        assert.equal(bot.output.trim().split('\n').at(-1), 'I broke 10 tall_grass and got nothing. tall_grass drops nothing without shears.');
        assert.ok(!bot.output.includes('Collected 10'), 'the count of v0.1.4.7 is gone (F4)');
    });

    test('an ore gives another item: "I broke 2 iron_ore and got 2 raw_iron." (handoff)', LIMIT, async () => {
        const { bot } = collectScene([['iron_ore', 3, 63, 0], ['iron_ore', 4, 63, 0]]);
        bot.inventory.put('stone_pickaxe', 1, 36);
        assert.equal(await skills.collectBlock(bot, 'iron_ore', 2), true);
        assert.equal(bot.output.trim().split('\n').at(-1), 'I broke 2 iron_ore and got 2 raw_iron.');
    });

    test('breakBlockAt: a refused block is not broken, the text of the refusal is in the output', LIMIT, async () => {
        const { w, bot } = collectScene([['oak_fence', 2, 64, 0]]);
        guardMod.installAreaGuard(bot, { store: null, protectBuiltBlocks: true, getCommand: () => '!collectBlocks("oak_fence", 20)', log: () => {} });
        assert.equal(await skills.breakBlockAt(bot, 2, 64, 0), false);
        assert.equal(w.get(2, 64, 0), 'oak_fence');
        assert.ok(bot.output.includes(FENCE_TEXT), bot.output);
    });

    test('placeBlock: a refusal of an area names its reason in the output', LIMIT, async () => {
        const { w, bot } = collectScene([]);
        const store = new storeMod.AreaStore(path.join(dir, 'areas.json'));
        store.set({ name: 'house', type: 'building', min: { x: -5, y: 60, z: -5 }, max: { x: 10, y: 70, z: 10 } });
        guardMod.installAreaGuard(bot, { store, log: () => {} });
        bot.inventory.put('cobblestone', 10);
        assert.equal(await skills.placeBlock(bot, 'cobblestone', 3, 64, 3), false);
        assert.equal(w.get(3, 64, 3), 'air');
        assert.ok(bot.output.includes('"house"'), bot.output);
    });

    // D2 and the handoff (part D, "for part B"): placeBlock must ask the guard with the item it places,
    // { item: blockType }; without it the guard judges the item in the hand.
    // Finding T1-1 of round 1 (placeBlock asked the guard without the item): corrected by the tech lead.
    test('placeBlock of seeds in a farm is allowed (D2: seeds), whatever the hand holds', LIMIT, async () => {
        const { w, bot } = collectScene([]);
        w.fill(0, 63, 2, 4, 63, 6, 'farmland');
        const store = new storeMod.AreaStore(path.join(dir, 'areas.json'));
        store.set({ name: 'farm', type: 'farm', min: { x: -1, y: 62, z: 1 }, max: { x: 5, y: 66, z: 7 } });
        bot.placeBlock = async (ref, face) => { w.set(ref.position.x + face.x, ref.position.y + face.y, ref.position.z + face.z, 'wheat'); };
        guardMod.installAreaGuard(bot, { store, log: () => {} });
        bot.inventory.put('iron_hoe', 1, 36); // the hand holds the hoe of the farm work
        bot.inventory.put('wheat_seeds', 10, 9);
        const ok = await skills.placeBlock(bot, 'wheat_seeds', 2, 64, 4);
        assert.equal(ok, true, bot.output);
    });
});

// ------------------------------------------------------------------------------------------ B2

describe('B2: the off-hand (slot 45)', () => {
    test('consume of an item in the off-hand moves it to the hand first (E1: "I have no food" beside "apple: 1")', LIMIT, async () => {
        const bot = makeFakeBot();
        bot.inventory.put('apple', 1, 45);
        assert.equal(await skills.consume(bot, 'apple'), true);
        assert.ok(bot.calls.some((c) => c[0] === 'equip' && c[1] === 'apple' && c[2] === 'hand'));
        assert.ok(bot.calls.some((c) => c[0] === 'consume' && c[1] === 'apple'));
        assert.equal(bot.output, 'Consumed apple.\n');
    });

    test('discard sees slot 45', LIMIT, async () => {
        const bot = makeFakeBot();
        bot.inventory.put('bread', 6, 45);
        assert.equal(await skills.discard(bot, 'bread'), true);
        assert.equal(bot.inventory.slots[45], null);
        assert.ok(bot.output.includes('Discarded 6 bread.'), bot.output);
    });

    test('equip sees slot 45', LIMIT, async () => {
        const bot = makeFakeBot();
        bot.inventory.put('bread', 6, 45);
        assert.equal(await skills.equip(bot, 'bread'), true);
        assert.equal(bot.heldItem?.name, 'bread');
    });

    test('counts include the off-hand once', () => {
        const bot = makeFakeBot();
        bot.inventory.put('bread', 2, 9);
        bot.inventory.put('bread', 6, 45);
        assert.equal(world.getInventoryCounts(bot).bread, 8);
    });

    test('the line of !inventory: "In the off-hand: bread 6", nothing when it is empty', () => {
        const bot = makeFakeBot();
        assert.equal(world.getOffhandText(bot), '');
        bot.inventory.put('bread', 6, 45);
        assert.equal(world.getOffhandText(bot), 'In the off-hand: bread 6');
    });

    test('getInventoryItem: the main inventory first, then the off-hand', () => {
        const bot = makeFakeBot();
        bot.inventory.put('bread', 6, 45);
        assert.equal(world.getInventoryItem(bot, 'bread')?.slot, 45);
        bot.inventory.put('bread', 1, 12);
        assert.equal(world.getInventoryItem(bot, 'bread')?.slot, 12);
    });
});

// ------------------------------------------------------------------------------------------ B3

describe('B3: walking', () => {
    test('goToGoal: an interrupted walk ends within 1 s, the path search is stopped with setGoal(null)', LIMIT, async () => {
        const bot = makeFakeBot();
        bot.gotoImpl = hang;
        const walk = skills.goToGoal(bot, new (await import('mineflayer-pathfinder')).default.goals.GoalNear(200, 64, 200, 1));
        await sleep(100);
        const t0 = Date.now();
        bot.interrupt_code = true;
        const r = await walk;
        assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
        assert.equal(r, false, 'resolves false when interrupted (handoff)');
        assert.ok(bot.pathfinder.goals.includes(null));
    });

    test('goToPosition: "You have reached (x, y, z)." with the real position', LIMIT, async () => {
        const bot = makeFakeBot();
        bot.gotoImpl = async () => { bot.entity.position = new Vec3(10.7, 64, -3.2); };
        assert.equal(await skills.goToPosition(bot, 10, 64, -3, 2), true);
        assert.equal(bot.output.trim().split('\n').at(-1), 'You have reached (10, 64, -4).');
    });

    test('goToPosition: "I stopped at (x, y, z), N blocks from the goal."', LIMIT, async () => {
        const bot = makeFakeBot();
        bot.gotoImpl = async () => { bot.entity.position = new Vec3(20.5, 64, 0.5); };
        assert.equal(await skills.goToPosition(bot, 30.5, 64, 0.5, 2), false);
        assert.equal(bot.output.trim().split('\n').at(-1), 'I stopped at (20, 64, 0), 10 blocks from the goal.');
    });

    test('goToPosition: a walk that finds no path names where the bot stopped', LIMIT, async () => {
        const bot = makeFakeBot();
        bot.gotoImpl = noPath;
        assert.equal(await skills.goToPosition(bot, 30.5, 64, 0.5, 2), false);
        assert.equal(bot.output.trim().split('\n').at(-1), 'I stopped at (0, 64, 0), 30 blocks from the goal.');
    });

    test('goToPosition calls bot.modes.noteProgress("path") while the path search moves the bot nearer', LIMIT, async () => {
        const bot = makeFakeBot();
        const notes = [];
        bot.modes = { isOn: () => false, exists: () => false, pause() {}, noteProgress: (r) => notes.push(r) };
        bot.pathfinder.isMoving = () => true;
        bot.gotoImpl = async () => {
            for (let i = 0; i < 12; i++) {
                bot.entity.position = bot.entity.position.offset(1, 0, 0);
                await sleep(200);
            }
        };
        await skills.goToPosition(bot, 12.5, 64, 0.5, 1);
        assert.ok(notes.includes('path'), JSON.stringify(notes));
    });

    test('moveAway with the door reflex on: it opens the trapdoor in its way and walks out (S11)', LIMIT, async () => {
        const w = createBlockWorld().flatGround(63);
        w.set(0, 66, 0, 'oak_trapdoor', { open: false, half: 'bottom', facing: 'north' });
        const bot = makeFakeBot({ world: w });
        bot.modes = { isOn: (n) => n === 'door_closing', exists: (n) => n === 'door_closing', pause() {}, noteProgress() {} };
        bot.activateBlock = async (block) => {
            const p = block.position;
            const props = w.blockAt(p)._properties;
            w.set(p.x, p.y, p.z, block.name, { ...props, open: !props.open });
        };
        bot.gotoImpl = async () => {
            if (!w.blockAt({ x: 0, y: 66, z: 0 })._properties.open) return noPath();
            bot.entity.position = bot.entity.position.offset(0, 2, 6);
        };
        assert.equal(await skills.moveAway(bot, 5), true);
        assert.equal(w.blockAt({ x: 0, y: 66, z: 0 })._properties.open, true);
        assert.ok(bot.entity.position.distanceTo(new Vec3(0.5, 64, 0.5)) > 5);
    });
});

// ------------------------------------------------------------------------------------------ B4

describe('B4: pickUpItems', () => {
    // An item is picked up 100 ms after the bot came within 1.5 blocks of it.
    function pickScene() {
        const bot = makeFakeBot();
        bot.gotoImpl = async (goal) => {
            const target = goal?.entity;
            if (!target) return;
            bot.entity.position = target.position.clone();
            setTimeout(() => {
                if (bot.entities[target.id] !== target) return;
                delete bot.entities[target.id];
                target.isValid = false;
                const stack = target.getDroppedItem();
                bot.inventory.add(stack.name, stack.count);
            }, 100);
        };
        return bot;
    }
    function drop(bot, name, count, at) {
        const e = itemEntity(name, at);
        e.getDroppedItem = () => ({ name, count });
        bot.entities[e.id] = e;
        return e;
    }

    test('"I picked up 8 oak_fence, 1 oak_fence_gate.", true', LIMIT, async () => {
        const bot = pickScene();
        drop(bot, 'oak_fence', 8, [3.5, 64, 0.5]);
        drop(bot, 'oak_fence_gate', 1, [5.5, 64, 2.5]);
        assert.equal(await skills.pickUpItems(bot), true);
        assert.equal(bot.output.trim().split('\n').at(-1), 'I picked up 8 oak_fence, 1 oak_fence_gate.');
    });

    test('nothing within the range: "I see no items on the ground within 16 blocks.", false', LIMIT, async () => {
        const bot = pickScene();
        drop(bot, 'oak_fence', 8, [30.5, 64, 0.5]);
        assert.equal(await skills.pickUpItems(bot), false);
        assert.equal(bot.output.trim(), 'I see no items on the ground within 16 blocks.');
    });

    test('with a name: only those items', LIMIT, async () => {
        const bot = pickScene();
        drop(bot, 'oak_fence', 8, [3.5, 64, 0.5]);
        const dirt = drop(bot, 'dirt', 3, [1.5, 64, 1.5]);
        assert.equal(await skills.pickUpItems(bot, 'oak_fence'), true);
        assert.equal(bot.entities[dirt.id], dirt, 'the dirt stays');
        assert.equal(bot.output.trim().split('\n').at(-1), 'I picked up 8 oak_fence.');
    });

    test('items that cannot be picked up: "I could not pick up 3 items: stick.", false', { timeout: 40000 }, async () => {
        const bot = makeFakeBot();
        bot.gotoImpl = async (goal) => { if (goal?.entity) bot.entity.position = goal.entity.position.clone(); };
        drop(bot, 'stick', 3, [2.5, 64, 0.5]);
        assert.equal(await skills.pickUpItems(bot), false);
        assert.equal(bot.output.trim().split('\n').at(-1), 'I could not pick up 3 items: stick.');
    });
});

// ------------------------------------------------------------------------------------------ B5

describe('B5: the chest view in one line', () => {
    function chestScene(items) {
        const w = createBlockWorld().flatGround(63);
        w.set(11, 67, 53, 'chest');
        const bot = makeFakeBot({ world: w, pos: [12.5, 67, 52.5], realBlocks: true });
        bot.gotoImpl = async () => {};
        bot.openContainer = async () => ({ containerItems: () => items.map(([name, count]) => ({ name, count })), close() {} });
        return bot;
    }

    test('same names added up, ordered by count', LIMIT, async () => {
        const bot = chestScene([['cobblestone', 64], ['leaf_litter', 64], ['cobblestone', 17], ['leaf_litter', 40], ['raw_copper', 52]]);
        assert.equal(await skills.viewChest(bot), true);
        const lines = bot.output.trim().split('\n').filter((l) => l.startsWith('The chest'));
        assert.deepEqual(lines, ['The chest at (11, 67, 53) contains: leaf_litter 104, cobblestone 81, raw_copper 52.']);
    });

    test('the owner\'s chest of the play test: wheat is in the one line, not in a cut middle', LIMIT, async () => {
        const owner = { sand: 18, stone_sword: 1, white_banner: 1, coal: 39, wheat_seeds: 52, oak_slab: 5, oak_sapling: 5, lilac: 5, granite: 18,
            bone: 1, leaf_litter: 104, dirt: 27, oak_door: 2, cobblestone: 81, birch_log: 5, leather: 4, oak_log: 3, charcoal: 2, stick: 1,
            bone_meal: 1, granite_stairs: 12, feather: 2, wooden_axe: 1, wooden_shovel: 1, diorite: 18, copper_ingot: 23, rotten_flesh: 1,
            birch_sapling: 2, flint: 1, raw_copper: 52, bow: 1, ominous_bottle: 1, cobblestone_stairs: 22, spider_eye: 3, lapis_lazuli: 49,
            iron_ingot: 6, gravel: 56, white_wool: 1, wheat: 28 };
        const bot = chestScene(Object.entries(owner));
        await skills.viewChest(bot);
        const line = bot.output.trim().split('\n').find((l) => l.startsWith('The chest'));
        assert.ok(line.startsWith('The chest at (11, 67, 53) contains: leaf_litter 104, cobblestone 81, '), line);
        assert.ok(line.includes('wheat 28'));
    });

    test('an empty chest: "The chest at (x, y, z) is empty."', LIMIT, async () => {
        const bot = chestScene([]);
        await skills.viewChest(bot);
        assert.ok(bot.output.includes('The chest at (11, 67, 53) is empty.'), bot.output);
    });
});

// ------------------------------------------------------------------------------------------ B6

describe('B6: small corrections', () => {
    test('smeltItem counts what the bot gained, not what lay in the output slot before (T6)', LIMIT, async () => {
        const w = createBlockWorld().flatGround(63);
        w.set(2, 64, 0, 'furnace');
        const bot = makeFakeBot({ world: w, realBlocks: true });
        bot.inventory.put('raw_iron', 2);
        bot.inventory.put('coal', 1);
        const ingot = REGISTRY.itemsByName.iron_ingot.id;
        const furnace = {
            input: null, fuel: null, output: { type: ingot, count: 4, name: 'iron_ingot' },
            inputItem() { return this.input; }, fuelItem() { return this.fuel; }, outputItem() { return this.output; },
            async takeOutput() { const o = this.output; this.output = null; if (o) bot.inventory.add('iron_ingot', o.count); return o; },
            async putFuel(type, m, n) { this.fuel = { type, count: n }; },
            async putInput(type, m, n) {
                this.input = { type, count: n };
                setTimeout(() => { this.input = null; this.output = { type: ingot, count: n, name: 'iron_ingot' }; }, 300);
            },
            async takeInput() { this.input = null; }, async takeFuel() { this.fuel = null; },
        };
        bot.openFurnace = async () => furnace;
        assert.equal(await skills.smeltItem(bot, 'raw_iron', 2), true);
        assert.ok(bot.output.includes('Took 4 iron_ingot that was already in the furnace.'), bot.output);
        assert.equal(bot.output.trim().split('\n').at(-1), 'Successfully smelted raw_iron, got 2 iron_ingot.');
    });

    test('discard with a walk away: the walk has a limit of 3 s; when it fails the item is tossed where the bot stands (S14)', LIMIT, async () => {
        const bot = makeFakeBot();
        bot.gotoImpl = hang;
        bot.inventory.put('dirt', 5);
        const t0 = Date.now();
        assert.equal(await skills.discard(bot, 'dirt', -1, 5), true);
        const took = Date.now() - t0;
        assert.ok(took >= 2800 && took < 4500, `${took} ms`);
        assert.ok(bot.output.includes('Discarded 5 dirt.'));
        assert.ok(bot.pathfinder.goals.includes(null), 'the walk is stopped');
    });

    test('discard with a walk away that finds no path tosses at once', LIMIT, async () => {
        const bot = makeFakeBot();
        bot.gotoImpl = noPath;
        bot.inventory.put('dirt', 5);
        const t0 = Date.now();
        assert.equal(await skills.discard(bot, 'dirt', 2, 5), true);
        assert.ok(Date.now() - t0 < 1500);
        assert.ok(bot.output.includes('Discarded 2 dirt.'));
    });
});
