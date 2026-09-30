// Spec v0.1.4.8, part B (B2, B4, B5) in src/agent/library/world.js: the off-hand (slot 45) and the
// new functions for items.
//   - getOffhandItem, getOffhandText ("In the off-hand: bread 6"), getInventoryItem (main first, then
//     the off-hand), getInventoryCounts counts the off-hand once;
//   - sumItemCounts: the same names added up, the largest count first;
//   - getInventoryGain: only what became more;
//   - getNearbyItems: items on the ground, by name and range, nearest first.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { loadSrc } from '../helpers/load.js';
import { makeBot, makeItem, OFFHAND } from './stb_fake_bot.test.js';

const world = await loadSrc('src/agent/library/world.js');

function groundItem(id, name, count, at) {
    return { id, name: 'item', position: new Vec3(...at), getDroppedItem: () => (name ? { name, count } : null) };
}

describe('B2: the off-hand in world.js', () => {
    test('getOffhandItem: the stack of slot 45, null when it is empty', () => {
        const bot = makeBot();
        assert.equal(world.getOffhandItem(bot), null);
        bot.inventory.put('bread', 6, OFFHAND);
        assert.equal(world.getOffhandItem(bot).name, 'bread');
        assert.equal(world.getOffhandItem({ inventory: {} }), null, 'no slots: null, no TypeError');
    });

    test('getOffhandText: the line of the spec, or an empty text', () => {
        const bot = makeBot();
        assert.equal(world.getOffhandText(bot), '');
        bot.inventory.put('bread', 6, OFFHAND);
        assert.equal(world.getOffhandText(bot), 'In the off-hand: bread 6');
    });

    test('getInventoryItem: the main inventory first, then the off-hand', () => {
        const bot = makeBot();
        assert.equal(world.getInventoryItem(bot, 'bread'), null);
        bot.inventory.put('bread', 6, OFFHAND);
        assert.equal(world.getInventoryItem(bot, 'bread').slot, OFFHAND);
        bot.inventory.put('bread', 2, 12);
        assert.equal(world.getInventoryItem(bot, 'bread').slot, 12);
        assert.equal(world.getInventoryItem(bot, 'apple'), null);
    });

    test('getInventoryCounts counts the off-hand once, beside the main inventory', () => {
        const bot = makeBot();
        bot.inventory.put('bread', 6, OFFHAND);
        bot.inventory.put('bread', 2, 20);
        bot.inventory.put('apple', 1, 40);
        assert.deepEqual(world.getInventoryCounts(bot), { bread: 8, apple: 1 });
    });
});

describe('B5: sumItemCounts', () => {
    test('the same names added up, the largest count first, equal counts by name', () => {
        const items = [makeItem('cobblestone', 64), makeItem('leaf_litter', 64), makeItem('cobblestone', 17),
            makeItem('leaf_litter', 40), makeItem('wheat', 3), makeItem('apple', 3)];
        assert.deepEqual(world.sumItemCounts(items), [
            { name: 'leaf_litter', count: 104 }, { name: 'cobblestone', count: 81 },
            { name: 'apple', count: 3 }, { name: 'wheat', count: 3 },
        ]);
    });

    test('an object of counts works too; counts of 0 or less and entries without a name are left out', () => {
        assert.deepEqual(world.sumItemCounts({ stick: 2, dirt: 0, stone: -1, oak_log: 5 }),
            [{ name: 'oak_log', count: 5 }, { name: 'stick', count: 2 }]);
        assert.deepEqual(world.sumItemCounts([null, { count: 3 }, { name: 'x', count: 0 }]), []);
        assert.deepEqual(world.sumItemCounts([]), []);
        assert.deepEqual(world.sumItemCounts(null), []);
    });
});

describe('B1, B4: getInventoryGain', () => {
    test('only what became more, new names included', () => {
        assert.deepEqual(world.getInventoryGain({ oak_log: 2, bread: 5, stick: 1 }, { oak_log: 5, bread: 3, stick: 1, oak_sapling: 1 }),
            { oak_log: 3, oak_sapling: 1 });
    });

    test('nothing gained: an empty object; missing counts are 0', () => {
        assert.deepEqual(world.getInventoryGain({ dirt: 4 }, { dirt: 4 }), {});
        assert.deepEqual(world.getInventoryGain(null, { dirt: 4 }), { dirt: 4 });
        assert.deepEqual(world.getInventoryGain({ dirt: 4 }, null), {});
    });
});

describe('B4: getNearbyItems', () => {
    function scene() {
        const bot = makeBot({ pos: [0.5, 64, 0.5] });
        bot.entities = {
            1: bot.entity,
            10: groundItem(10, 'oak_fence', 8, [6.5, 64, 0.5]),
            11: groundItem(11, 'oak_fence_gate', 1, [2.5, 64, 0.5]),
            12: groundItem(12, 'stick', 1, [20.5, 64, 0.5]),
            13: { id: 13, name: 'cow', position: new Vec3(1.5, 64, 0.5) },
            14: groundItem(14, null, 1, [3.5, 64, 0.5]), // metadata not arrived yet
        };
        return bot;
    }

    test('all items within the range, nearest first; mobs and the bot are left out', () => {
        const bot = scene();
        assert.deepEqual(world.getNearbyItems(bot).map((e) => e.id), [11, 14, 10]);
        assert.deepEqual(world.getNearbyItems(bot, '', 32).map((e) => e.id), [11, 14, 10, 12]);
    });

    test('with a name: only items of that name (an item without known name is left out)', () => {
        const bot = scene();
        assert.deepEqual(world.getNearbyItems(bot, 'oak_fence').map((e) => e.id), [10]);
        assert.deepEqual(world.getNearbyItems(bot, 'stick', 16), []);
        assert.deepEqual(world.getNearbyItems(bot, 'stick', 21).map((e) => e.id), [12]);
    });
});
