// v0.1.4.14, part L (engineer E1), fix round part 8 (P-30, spec 8.9): the inventory of the watch is read from the bag at
// the request. The watch's inventory tool, the digest's snapshots and the page's state (full_state.js, polled every
// second) all read bot.inventory.items() at the request already; the lag the owner saw (3 to 7 s after a craft, "a bed
// looked lost twice") is in mineflayer: while a window is open (a chest, a furnace, the crafting table through the whole
// craft of several units, 0.3 s a unit on 26.1) the set_slot packets go to bot.currentWindow and its inventory section
// is copied into bot.inventory only when the window closes (lib/plugins/inventory.js, copyInventory). bagItems of
// digest_logic.js reads the open window's inventory section while one is open, else bot.inventory.items(); the
// inventory tool and the digest's inventory counts use it.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { repoPath } from '../helpers/paths.js';
import { bagItems, snapshotOf } from '../../src/agent/watch/digest_logic.js';
import { TOOL_HANDLERS } from '../../src/agent/watch/tools.js';

const item = (name, count, slot) => ({ name, count, slot });

// the bag before the craft: 3 planks and 3 wool in the hotbar; the crafting table window open with the bed in its
// inventory section (slots 10..45 of a crafting table window) and the planks and the wool gone there
function craftingBot() {
    const inventory = {
        inventoryStart: 9, inventoryEnd: 45,
        slots: new Array(46).fill(null),
        items() { return [item('oak_planks', 3, 36), item('white_wool', 3, 37)]; },
    };
    const windowSlots = new Array(46).fill(null);
    windowSlots[10 + 27] = item('white_bed', 1, 37); // the bed landed in the hotbar slot the wool held
    windowSlots[10 + 26] = item('stick', 2, 36);
    const currentWindow = { id: 3, type: 'minecraft:crafting', inventoryStart: 10, inventoryEnd: 46, slots: windowSlots };
    return { bot: { inventory, currentWindow, heldItem: null, entity: { position: { x: 1, y: 64, z: 1 } }, game: { dimension: 'overworld' }, health: 20, food: 20 }, inventory, currentWindow };
}

describe('L: the bag is read through the open window (digest_logic.js bagItems, the inventory tool)', () => {
    test('no window open: the items of bot.inventory', () => {
        const { bot } = craftingBot();
        bot.currentWindow = null;
        assert.deepEqual(bagItems(bot).map((i) => `${i.count} ${i.name}`), ['3 oak_planks', '3 white_wool']);
    });

    test('a window open: the inventory section of the window, the bag as the game has it now', () => {
        const { bot } = craftingBot();
        assert.deepEqual(bagItems(bot).map((i) => `${i.count} ${i.name}`), ['2 stick', '1 white_bed']);
    });

    test('a window without an inventory section, or a bot without a bag: no throw', () => {
        const { bot } = craftingBot();
        bot.currentWindow = { id: 4, slots: [] };
        assert.deepEqual(bagItems(bot).map((i) => i.name), ['oak_planks', 'white_wool']);
        assert.deepEqual(bagItems(null), []);
        assert.deepEqual(bagItems({ inventory: { items() { throw new Error('gone'); } } }), []);
    });

    test('the inventory tool and the digest snapshot show the bed while the crafting window is still open', async () => {
        const { bot } = craftingBot();
        const text = await TOOL_HANDLERS.inventory({ bot });
        assert.equal(text.split('\n')[0], 'Inventory: 2 stick, 1 white_bed.');
        const snap = snapshotOf({ bot }, { now: () => 1000 });
        assert.deepEqual(snap.inventory, { stick: 2, white_bed: 1 });
        bot.currentWindow = null; // the window closed: mineflayer copied the section into bot.inventory (here: not yet)
        assert.equal((await TOOL_HANDLERS.inventory({ bot })).split('\n')[0], 'Inventory: 3 oak_planks, 3 white_wool.');
    });

    test('the source: the tool and the snapshot read bagItems, nothing reads a cached tick', () => {
        const tools = fs.readFileSync(repoPath('src/agent/watch/tools.js'), 'utf8');
        const logic = fs.readFileSync(repoPath('src/agent/watch/digest_logic.js'), 'utf8');
        assert.match(tools, /const items = bagItems\(bot\);/);
        assert.match(logic, /export function bagItems\(bot\)/);
        assert.match(logic, /const items = bagItems\(bot\);\s*\n\s*for \(const item of items\)/);
    });
});
