// v0.1.4.14, part L (engineer E1), rounds 5 to 8: on 26.1 a craft (bot.craft(recipe, n, table)) could resolve before
// the server's correction (at the table a craft of several, and under load a craft of one; in the 2x2 grid right after a
// closed furnace window), and the server could make fewer than asked (W105: "missing planks, 0 of 2" right after a craft
// of sticks). patches/mineflayer+4.39.0.patch: every craft, at the table and in the 2x2 grid, takes the server's state of
// the window it used after each unit (bot._syncWindow) and lets its slots settle (no change for 50 ms, at most 500 ms);
// at the end it reads the count made from bot.inventory and throws "missing ingredient: crafted m of n" when fewer were
// made while the ingredients for one more are there. The cause in the 2x2 grid, the stale stateId of a closed
// container, is handled in inventory.js (tests/unit/xl_state_id.test.js).
//
// The fake bot below has the real craft plugin of mineflayer and real windows of prismarine-windows. Its clicks change
// nothing; "the server" applies each craft 60 ms after the put-away of the result (planks out, sticks in), and the sync
// of a window resolves once every answer sent before it has arrived, as the window_items reply of a real server does.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { repoPath } from '../helpers/paths.js';

const require = createRequire(import.meta.url);
// upstream's once(bot, 'windowOpen') starts a 20 s sleep that is never cleared; this file loads craft.js with a once
// without that timeout, so no timer outlives the tests (the window opens at once in the fake anyway)
const promiseUtils = require('mineflayer/lib/promise_utils.js');
promiseUtils.once = (emitter, event) => promiseUtils.onceWithCleanup(emitter, event, { timeout: 0 });
const injectCraft = require('mineflayer/lib/plugins/craft.js');
const prismarineRegistry = require('prismarine-registry');

const read = (rel) => fs.readFileSync(repoPath(rel), 'utf8').replace(/\r\n/g, '\n');
const ANSWER_MS = 60;

function craftingBot({ planks = 6, refuseUnits = [] } = {}) {
    const registry = prismarineRegistry('26.1');
    const windows = require('prismarine-windows')(registry);
    const Item = require('prismarine-item')(registry);
    const Recipe = require('prismarine-recipe')(registry).Recipe;
    const recipe = Recipe.find(registry.itemsByName.stick.id)[0];
    const plankId = recipe.delta.find((d) => d.count < 0).id;
    const stickId = registry.itemsByName.stick.id;

    const bot = new EventEmitter();
    bot.registry = registry;
    bot.inventory = windows.createWindow(0, 'minecraft:inventory', 'Inventory');
    bot.inventory.updateSlot(36, new Item(plankId, planks));
    const table = windows.createWindow(1, 'minecraft:crafting', 'Crafting');
    const offset = table.inventoryStart - bot.inventory.inventoryStart;
    const log = { answers: [], syncs: 0, units: 0 };
    let pending = [];
    let active = null; // the window of the craft: the table once opened, else the inventory (2x2)

    // the server's side: one craft, ANSWER_MS after the put-away of the result
    function serverCraft(window) {
        const unit = ++log.units;
        pending.push(new Promise((resolve) => setTimeout(() => {
            if (!refuseUnits.includes(unit)) {
                const src = window.findInventoryItem(plankId, null);
                window.updateSlot(src.slot, src.count > 2 ? new Item(plankId, src.count - 2) : null);
                const sticks = window.findInventoryItem(stickId, null);
                if (sticks) window.updateSlot(sticks.slot, new Item(stickId, sticks.count + 4));
                else window.updateSlot(window.firstEmptyInventorySlot(), new Item(stickId, 4));
            }
            log.answers.push(performance.now());
            resolve();
        }, ANSWER_MS)));
    }

    bot.activateBlock = () => {
        active = table;
        for (let i = bot.inventory.inventoryStart; i < bot.inventory.inventoryEnd; i++) table.updateSlot(i + offset, bot.inventory.slots[i]);
        setImmediate(() => bot.emit('windowOpen', table));
    };
    bot.clickWindow = async () => {};
    bot.putSelectedItemRange = async () => {};
    bot.putAway = async (slot) => { if (slot === 0) serverCraft(active ?? bot.inventory); };
    bot._syncWindow = async () => { log.syncs++; const wait = pending; pending = []; await Promise.all(wait); };
    bot.closeWindow = async (window) => {
        for (let i = window.inventoryStart; i < window.inventoryEnd; i++) bot.inventory.updateSlot(i - offset, window.slots[i]);
    };
    bot.currentWindow = null;
    injectCraft(bot);
    return { bot, recipe, log, sticks: () => bot.inventory.count(stickId, null), planks: () => bot.inventory.count(plankId, null) };
}

describe('L: every table craft waits for the server, one unit at a time (mineflayer craft.js)', () => {
    test('the patch file and the patched craft.js hold the hunk', () => {
        const patch = read('patches/mineflayer+4.39.0.patch');
        const craft = read('node_modules/mineflayer/lib/plugins/craft.js');
        assert.ok(patch.includes('diff --git a/node_modules/mineflayer/lib/plugins/craft.js'), 'a hunk for craft.js');
        for (const line of [
            "const resultBefore = bot.inventory.count(recipe.result.id, recipe.result.metadata)",
            "await settleUnit(craftingTable ? windowCraftingTable : bot.inventory)",
            "throw new Error(`missing ingredient: crafted ${made} of ${count}`)",
            "async function settleUnit (window) {",
            "function settle (window, quietMs = 50, maxMs = 500) {",
        ]) {
            assert.ok(craft.includes(line), `craft.js: ${line}`);
            assert.ok(patch.includes(`+${craft.split('\n').find((l) => l.includes(line))}`), `patch: ${line}`);
        }
        assert.doesNotMatch(craft, /perUnit/, 'every craft, at the table and in the 2x2 grid');
        assert.match(patch, /\+\s*\/\/ v0\.1\.4\.14 \(Mindcraft fork\): on 26\.1 a craft could resolve before the server's correction/);
        assert.match(patch, /\+\s*\/\/ cause, the stale stateId of the closed container, inventory\.js now handles\)/);
    });

    test('bot.craft(recipe, 3, table) makes 3 and resolves only after the third answer of the server', async () => {
        const { bot, recipe, log, sticks, planks } = craftingBot({ planks: 6 });
        await bot.craft(recipe, 3, {});
        const resolvedAt = performance.now();
        assert.equal(log.answers.length, 3, 'three answers');
        assert.ok(resolvedAt >= log.answers[2], 'resolved after the third answer');
        assert.equal(sticks(), 12);
        assert.equal(planks(), 0);
        assert.equal(log.syncs, 4, 'one sync after each unit and the one of upstream before the close');
    });

    test('the server makes fewer than asked while planks are left: "missing ingredient: crafted 2 of 3"', async () => {
        const { bot, recipe, sticks, planks } = craftingBot({ planks: 8, refuseUnits: [2] });
        await assert.rejects(bot.craft(recipe, 3, {}), /missing ingredient: crafted 2 of 3/);
        assert.equal(sticks(), 8);
        assert.equal(planks(), 4);
    });

    test('planks for two of three: the third unit fails on its clicks with the error of upstream, after two made', async () => {
        const { bot, recipe, log, sticks, planks } = craftingBot({ planks: 4 });
        await assert.rejects(bot.craft(recipe, 3, {}), /missing ingredient/);
        assert.equal(log.answers.length, 2);
        assert.equal(planks(), 0);
        assert.equal(sticks(), 8, 'the two made are in the inventory after the close of upstream on an error');
    });

    test('a craft of one at the table also waits for the server: it resolves after the answer, two syncs', async () => {
        const { bot, recipe, log, sticks, planks } = craftingBot({ planks: 2 });
        await bot.craft(recipe, 1, {});
        const resolvedAt = performance.now();
        assert.equal(log.answers.length, 1);
        assert.ok(resolvedAt >= log.answers[0], 'resolved after the answer of the server');
        assert.equal(log.syncs, 2, 'one after the unit and the one of upstream before the close');
        assert.equal(sticks(), 4);
        assert.equal(planks(), 0);
    });

    test('a craft of one the server refuses while the planks are there: "missing ingredient: crafted 0 of 1"', async () => {
        const { bot, recipe, sticks, planks } = craftingBot({ planks: 2, refuseUnits: [1] });
        await assert.rejects(bot.craft(recipe, 1, {}), /missing ingredient: crafted 0 of 1/);
        assert.equal(sticks(), 0);
        assert.equal(planks(), 2);
    });

    test('the 2x2 craft without a table also waits for the server: one sync per unit, it resolves after the answer', async () => {
        const { bot, recipe, log, sticks, planks } = craftingBot({ planks: 4 });
        await bot.craft(recipe, 2, null);
        const resolvedAt = performance.now();
        assert.equal(log.syncs, 2, 'one after each unit, no table window to close');
        assert.equal(log.answers.length, 2);
        assert.ok(resolvedAt >= log.answers[1], 'resolved after the second answer of the server');
        assert.equal(sticks(), 8);
        assert.equal(planks(), 0);
    });

    test('a 2x2 craft the server refuses while the planks are there: "missing ingredient: crafted 0 of 1"', async () => {
        const { bot, recipe, sticks, planks } = craftingBot({ planks: 2, refuseUnits: [1] });
        await assert.rejects(bot.craft(recipe, 1, null), /missing ingredient: crafted 0 of 1/);
        assert.equal(sticks(), 0);
        assert.equal(planks(), 2);
    });
});
