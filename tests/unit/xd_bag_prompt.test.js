// v0.1.4.14 fix round, part 8 (P-30, E1's finding; the lead's decision): while a window is open (a craft, a chest, a
// furnace) mineflayer copies the inventory section into bot.inventory only at close, so the bag the model saw in the
// prompt (full_state.js, the inventory lines) lagged by the window's lifetime ("a bed looked lost twice"). getFullState
// reads the bag through bagItems of src/agent/watch/digest_logic.js: the open window's inventory section, else
// bot.inventory.items(); the armour, the off-hand and the crafting grid come from bot.inventory.slots as before, so without
// a window the counts are those of getInventoryCounts of world.js.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { MC, makeFakeBot, makeItem } from '../helpers/xt_bot.js';

register('../helpers/mcdata_hooks.js', import.meta.url);

let F;
let world;
let mcdata;
let workDir;
let originalCwd;
let cap;
before(async () => {
    originalCwd = process.cwd();
    workDir = makeTmpDir();
    process.chdir(workDir); // nothing may read a keys.json
    cap = captureConsole();
    try {
        mcdata = await loadSrc('src/utils/mcdata.js');
        world = await loadSrc('src/agent/library/world.js');
        F = await loadSrc('src/agent/library/full_state.js');
    } finally {
        process.chdir(originalCwd);
    }
    mcdata.__setMcdataForTests(MC);
});
after(() => {
    mcdata.__setMcdataForTests?.(null);
    cap.restore();
    removeTmpDir(workDir);
});

// A bot with 3 bread in the hotbar, an iron helmet on (slot 5) and a shield in the off-hand (slot 45). `window`: a chest
// window open (27 container slots, then the 36 slots of the bag) whose inventory section holds 5 oak logs and 1 bread:
// what the game has now, while bot.inventory still shows the 3 bread.
function stateBot({ window = false } = {}) {
    const bot = makeFakeBot({ world: createBlockWorld().flatGround(63, 'grass_block', 'dirt'), pos: { x: 0, y: 64, z: 0 }, items: [makeItem('bread', 3, 36)] });
    const slots = new Array(46).fill(null);
    slots[5] = makeItem('iron_helmet', 1, 5);
    slots[36] = makeItem('bread', 3, 36);
    slots[45] = makeItem('shield', 1, 45);
    bot.inventory.slots = slots;
    bot.inventory.inventoryStart = 9;
    bot.inventory.inventoryEnd = 45;
    bot.world = { getBiome: () => Number(Object.keys(MC.biomes)[0]) };
    bot.modes.getMiniDocs = () => '';
    if (window) {
        const windowSlots = new Array(63).fill(null);
        windowSlots[27 + 27] = makeItem('oak_log', 5, 54); // the first hotbar slot of the section
        windowSlots[62] = makeItem('bread', 1, 62);
        bot.currentWindow = { id: 2, type: 'minecraft:generic_9x3', inventoryStart: 27, inventoryEnd: 63, slots: windowSlots };
    }
    return bot;
}
const agentOf = (bot) => ({ name: 'andy', bot, isIdle: () => true, actions: { currentActionLabel: '' } });

describe('P-30: the inventory lines of the prompt read the bag through the open window (full_state.js)', () => {
    test('no window open: the counts of getInventoryCounts, the stacks of bot.inventory.items()', () => {
        const bot = stateBot();
        const state = F.getFullState(agentOf(bot));
        assert.deepEqual(state.inventory.counts, { iron_helmet: 1, bread: 3, shield: 1 });
        assert.deepEqual(state.inventory.counts, world.getInventoryCounts(bot), 'the same as before');
        assert.equal(state.inventory.stacksUsed, 1);
        assert.equal(state.inventory.totalSlots, 46);
        assert.equal(state.inventory.equipment.helmet, 'iron_helmet');
    });

    test('a chest window open: the section of the window (5 oak_log, 1 bread), the armour and the off-hand from the bag', () => {
        const bot = stateBot({ window: true });
        const state = F.getFullState(agentOf(bot));
        assert.deepEqual(state.inventory.counts, { oak_log: 5, bread: 1, iron_helmet: 1, shield: 1 });
        assert.equal(state.inventory.stacksUsed, 2);
        assert.equal(world.getInventoryCounts(bot).bread, 3, 'bot.inventory lags until the window closes');
    });

    test('the window closed: bot.inventory again', () => {
        const bot = stateBot({ window: true });
        bot.currentWindow = null;
        assert.deepEqual(F.getFullState(agentOf(bot)).inventory.counts, { iron_helmet: 1, bread: 3, shield: 1 });
    });

    test('a window without an inventory section: bot.inventory, no throw', () => {
        const bot = stateBot();
        bot.currentWindow = { id: 4, slots: [] };
        assert.deepEqual(F.getFullState(agentOf(bot)).inventory.counts, { iron_helmet: 1, bread: 3, shield: 1 });
    });
});
