// Spec v0.1.4.8, part B in src/agent/library/skills.js:
//   B2 (E1): consume, discard and equip see the off-hand (slot 45); consume moves it to the hand first;
//   B4 (P2): pickUpItems(bot, name, range): nearest first, waits for the pick-up delay, the texts;
//   B5 (C3): viewChest prints one line, the same items added up, the largest count first;
//   B6 (T6, S14): smeltItem counts what this smelt made; discard walks away for at most 3 s and
//   tosses where the bot stands when the walk fails.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { Vec3 } from 'vec3';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { makeBot, makeItem, registry, OFFHAND, HOTBAR, dropItem, neverArrive } from './stb_fake_bot.test.js';

register('../helpers/mcdata_hooks.js', import.meta.url);
const mcdata = await loadSrc('src/utils/mcdata.js');
const skills = await loadSrc('src/agent/library/skills.js');
mcdata.__setMcdataForTests(registry);

const lines = (bot) => bot.output.trimEnd().split('\n');

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

describe('B2: consume sees the off-hand', () => {
    test('bread only in the off-hand: it is moved to the hand first, then eaten', async () => {
        const bot = makeBot();
        bot.inventory.put('bread', 6, OFFHAND);
        assert.equal(await skills.consume(bot, 'bread'), true);
        const equip = bot.calls.find((c) => c[0] === 'equip');
        assert.deepEqual(equip, ['equip', 'bread', OFFHAND, 'hand']);
        assert.ok(bot.calls.some((c) => c[0] === 'consume' && c[1] === 'bread'));
        assert.equal(bot.inventory.slots[HOTBAR].count, 5);
        assert.equal(bot.output, 'Consumed bread.\n');
    });

    test('bread in the main inventory is taken before the off-hand', async () => {
        const bot = makeBot();
        bot.inventory.put('bread', 6, OFFHAND);
        bot.inventory.put('bread', 2, 15);
        assert.equal(await skills.consume(bot, 'bread'), true);
        assert.deepEqual(bot.calls.find((c) => c[0] === 'equip'), ['equip', 'bread', 15, 'hand']);
        assert.equal(bot.inventory.slots[OFFHAND].count, 6);
    });

    test('no bread anywhere: the text of v0.1.4.7, false', async () => {
        const bot = makeBot();
        bot.inventory.put('apple', 1, OFFHAND);
        assert.equal(await skills.consume(bot, 'bread'), false);
        assert.equal(bot.output, 'You do not have any bread to eat.\n');
    });
});

describe('B2: discard sees the off-hand', () => {
    test('all bread, 2 in the inventory and 6 in the off-hand: 8 discarded, each stack once', async () => {
        const bot = makeBot();
        bot.inventory.put('bread', 2, 20);
        bot.inventory.put('bread', 6, OFFHAND);
        assert.equal(await skills.discard(bot, 'bread'), true);
        assert.equal(bot.output, 'Discarded 8 bread.\n');
        assert.equal(bot.inventory.slots[OFFHAND], null);
        assert.equal(bot.inventory.slots.filter((s) => s && s.name === 'bread').length, 0);
    });

    test('3 of a stack that lies only in the off-hand: it goes to the hand, 3 are tossed', async () => {
        const bot = makeBot();
        bot.inventory.put('bread', 6, OFFHAND);
        assert.equal(await skills.discard(bot, 'bread', 3), true);
        assert.equal(bot.output, 'Discarded 3 bread.\n');
        assert.deepEqual(bot.calls.filter((c) => c[0] === 'toss'), [['toss', 'bread', 3, HOTBAR]]);
        assert.equal(bot.heldItem.count, 3);
    });

    test('enough in the main inventory: the off-hand is not touched', async () => {
        const bot = makeBot();
        bot.inventory.put('bread', 5, 20);
        bot.inventory.put('bread', 6, OFFHAND);
        assert.equal(await skills.discard(bot, 'bread', 4), true);
        assert.equal(bot.inventory.slots[OFFHAND].count, 6);
        assert.ok(!bot.calls.some((c) => c[0] === 'equip'));
    });

    test('nothing to discard: the text of v0.1.4.7', async () => {
        const bot = makeBot();
        assert.equal(await skills.discard(bot, 'bread'), false);
        assert.equal(bot.output, 'You do not have any bread to discard.\n');
    });
});

describe('B2: equip sees the off-hand', () => {
    test('bread only in the off-hand is equipped to the hand', async () => {
        const bot = makeBot();
        bot.inventory.put('bread', 6, OFFHAND);
        assert.equal(await skills.equip(bot, 'bread'), true);
        assert.equal(bot.heldItem?.name, 'bread');
        assert.equal(bot.output, 'Equipped bread.\n');
    });

    test('a shield in the off-hand stays there', async () => {
        const bot = makeBot();
        bot.inventory.put('shield', 1, OFFHAND);
        assert.equal(await skills.equip(bot, 'shield'), true);
        assert.equal(bot.inventory.slots[OFFHAND].name, 'shield');
    });
});

describe('B6: discard walks away for at most 3 s', () => {
    test('the walk does not end: after 3 s the path search is stopped and the items are tossed where the bot stands', async () => {
        const bot = makeBot();
        bot.inventory.put('apple', 4, 20);
        bot.gotoImpl = neverArrive;
        const t0 = Date.now();
        assert.equal(await skills.discard(bot, 'apple', -1, 5), true);
        const ms = Date.now() - t0;
        assert.ok(ms >= 3000 && ms < 3800, `${ms} ms`);
        const names = bot.calls.map((c) => c[0]);
        assert.ok(names.indexOf('goto') < names.indexOf('setGoal') && names.indexOf('setGoal') < names.indexOf('toss'), JSON.stringify(names));
        assert.deepEqual(bot.calls.find((c) => c[0] === 'setGoal'), ['setGoal', null]);
        assert.equal(bot.pathfinder.movements.canDig, false, 'the walk of discard never digs');
        assert.equal(bot.output, 'Discarded 4 apple.\n');
    });

    test('the walk fails at once (no path): tossed where the bot stands, no error', async () => {
        const bot = makeBot();
        bot.inventory.put('apple', 4, 20);
        bot.gotoImpl = () => { const e = new Error('No path to the goal!'); e.name = 'NoPath'; throw e; };
        assert.equal(await skills.discard(bot, 'apple', 2, 5), true);
        assert.equal(bot.output, 'Discarded 2 apple.\n');
    });

    test('walkAway 0 (the default of v0.1.4.7): no walk', async () => {
        const bot = makeBot();
        bot.inventory.put('apple', 4, 20);
        assert.equal(await skills.discard(bot, 'apple'), true);
        assert.ok(!bot.calls.some((c) => c[0] === 'goto'));
    });

    test('nothing to discard: no walk', async () => {
        const bot = makeBot();
        assert.equal(await skills.discard(bot, 'apple', -1, 5), false);
        assert.ok(!bot.calls.some((c) => c[0] === 'goto'));
    });
});

describe('B5: viewChest prints one line', () => {
    function chestScene(items) {
        const world = createBlockWorld().flatGround(63);
        world.set(11, 64, 3, 'chest');
        const bot = makeBot({ world, pos: [10.5, 64, 3.5] });
        bot.openContainer = async () => ({ containerItems: () => items, close: async () => {} });
        return bot;
    }

    test('the same names added up, the largest count first', async () => {
        const bot = chestScene([makeItem('cobblestone', 64), makeItem('leaf_litter', 64), makeItem('wheat', 12),
            makeItem('cobblestone', 17), makeItem('leaf_litter', 40), makeItem('wheat', 16)]);
        assert.equal(await skills.viewChest(bot), true);
        assert.equal(lines(bot).at(-1), 'The chest at (11, 64, 3) contains: leaf_litter 104, cobblestone 81, wheat 28.');
        assert.equal(bot.output.split('\n').filter((l) => l.includes('chest')).length, 1);
    });

    test('an empty chest', async () => {
        const bot = chestScene([]);
        assert.equal(await skills.viewChest(bot), true);
        assert.equal(lines(bot).at(-1), 'The chest at (11, 64, 3) is empty.');
    });
});

describe('B6: smeltItem counts what this smelt made', () => {
    test('4 iron_ingot of an earlier smelt lay in the output: they are named apart, the smelt made 1', async () => {
        const world = createBlockWorld().flatGround(63);
        world.set(2, 64, 0, 'furnace');
        const bot = makeBot({ world, pos: [0.5, 64, 0.5] });
        bot.inventory.put('raw_iron', 1);
        bot.inventory.put('coal', 1);
        const slots = { input: null, fuel: null, output: makeItem('iron_ingot', 4) };
        const furnace = {
            inputItem: () => slots.input,
            fuelItem: () => slots.fuel,
            outputItem: () => slots.output,
            async putFuel() { slots.fuel = makeItem('coal', 1); },
            async putInput(type, meta, n) { slots.input = makeItem('raw_iron', n); setTimeout(() => { slots.input = null; slots.output = makeItem('iron_ingot', n); }, 300); },
            async takeOutput() { const it = slots.output; slots.output = null; bot.inventory.add(it.name, it.count); return it; },
            async takeInput() { const it = slots.input; slots.input = null; return it; },
            async takeFuel() { const it = slots.fuel; slots.fuel = null; return it; },
        };
        bot.openFurnace = async () => furnace;
        bot.closeWindow = () => {};
        bot.modes.pause = () => {};
        assert.equal(await skills.smeltItem(bot, 'raw_iron', 1), true);
        assert.ok(bot.output.includes('Took 4 iron_ingot that was already in the furnace.\n'), bot.output);
        assert.equal(lines(bot).at(-1), 'Successfully smelted raw_iron, got 1 iron_ingot.');
        assert.equal(bot.inventory.findInventoryItem('iron_ingot').count, 5);
    });
});

describe('B4: pickUpItems', () => {
    // the path finder walks at once to the item of a GoalFollow
    function walkingBot() {
        const bot = makeBot({ pos: [0.5, 64, 0.5] });
        bot.entities[bot.entity.id] = bot.entity;
        bot.gotoImpl = (goal) => {
            if (goal?.entity) bot.entity.position = goal.entity.position.clone();
        };
        return bot;
    }

    test('nothing on the ground: the text of the spec, false', async () => {
        const bot = walkingBot();
        assert.equal(await skills.pickUpItems(bot), false);
        assert.equal(bot.output, 'I see no items on the ground within 16 blocks.\n');
    });

    test('an item name that is not on the ground: the text names it', async () => {
        const bot = walkingBot();
        dropItem(bot, 'stick', 1, [3.5, 64, 0.5]);
        assert.equal(await skills.pickUpItems(bot, 'oak_fence', 8), false);
        assert.equal(bot.output, 'I see no oak_fence on the ground within 8 blocks.\n');
    });

    test('items a player threw (2 s delay): the bot waits and picks them up, nearest first', async () => {
        const bot = walkingBot();
        const t0 = Date.now();
        dropItem(bot, 'oak_fence_gate', 1, [7.5, 64, 0.5], { delayMs: 2000 });
        dropItem(bot, 'oak_fence', 8, [4.5, 64, 0.5], { delayMs: 2000 });
        assert.equal(await skills.pickUpItems(bot), true);
        assert.ok(Date.now() - t0 >= 2000, 'it waited for the pick-up delay');
        assert.equal(bot.output, 'I picked up 8 oak_fence, 1 oak_fence_gate.\n');
        const collected = bot.calls.filter((c) => c[0] === 'collect').map((c) => c[1]);
        assert.deepEqual(collected, ['oak_fence', 'oak_fence_gate']);
    });

    test('with a name only those items; other items are not visited', async () => {
        const bot = walkingBot();
        dropItem(bot, 'stick', 2, [2.5, 64, 0.5]);
        dropItem(bot, 'oak_fence', 3, [-4.5, 64, 0.5]);
        assert.equal(await skills.pickUpItems(bot, 'oak_fence'), true);
        assert.equal(bot.output, 'I picked up 3 oak_fence.\n');
        assert.equal(bot.inventory.findInventoryItem('stick'), null);
    });

    test('an item that is never picked up (a full inventory): tried twice, then named', async () => {
        const bot = walkingBot();
        dropItem(bot, 'oak_fence', 8, [2.5, 64, 0.5]);
        dropItem(bot, 'stick', 3, [5.5, 64, 0.5], { pickable: false });
        const t0 = Date.now();
        assert.equal(await skills.pickUpItems(bot), true);
        assert.equal(bot.output, 'I picked up 8 oak_fence. I could not pick up 3 items: stick.\n');
        assert.equal(bot.calls.filter((c) => c[0] === 'goto').length, 2, 'one walk to the fence, one to the stick (the second try starts there)');
        assert.ok(Date.now() - t0 >= 5000, 'two waits of 2.5 s at the stick');
    });

    test('stopped: the text says so and names what is left', async () => {
        const bot = walkingBot();
        dropItem(bot, 'oak_fence', 1, [9.5, 64, 0.5]);
        bot.gotoImpl = neverArrive;
        setTimeout(() => { bot.interrupt_code = true; }, 300);
        const t0 = Date.now();
        assert.equal(await skills.pickUpItems(bot), false);
        assert.ok(Date.now() - t0 < 1000, 'the walk ended within 1 s');
        assert.equal(bot.output, 'I was stopped before I picked up 1 item: oak_fence.\n');
    });

    test('the items vanished without a gain (another player took them): "I picked up nothing."', async () => {
        const bot = walkingBot();
        const item = dropItem(bot, 'oak_fence', 2, [3.5, 64, 0.5], { pickable: false });
        bot.gotoImpl = () => { item.isValid = false; delete bot.entities[item.id]; };
        assert.equal(await skills.pickUpItems(bot), false);
        assert.equal(bot.output, 'I picked up nothing. The items are no longer there.\n');
    });

    test('the inventory changes a moment after the item left the ground: the gain is still counted', async () => {
        const bot = walkingBot();
        const item = dropItem(bot, 'oak_fence', 2, [3.5, 64, 0.5], { pickable: false });
        bot.gotoImpl = () => {
            item.isValid = false;
            delete bot.entities[item.id];
            setTimeout(() => bot.inventory.add('oak_fence', 2), 200);
        };
        assert.equal(await skills.pickUpItems(bot), true);
        assert.equal(bot.output, 'I picked up 2 oak_fence.\n');
    });

    test('the item stack of a mob is no item: a cow is not visited', async () => {
        const bot = walkingBot();
        bot.entities[900] = { id: 900, name: 'cow', position: new Vec3(2, 64, 0) };
        assert.equal(await skills.pickUpItems(bot), false);
        assert.ok(!bot.calls.some((c) => c[0] === 'goto'));
    });
});
