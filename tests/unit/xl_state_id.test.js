// v0.1.4.14, part L (engineer E1), round 8: mineflayer keeps one stateId for all windows (the last one of a set_slot or a
// window_items). After a container (a furnace) closed it still held the container's, and on 26.1 the first clicks on the
// inventory with it were dropped or applied out of order: a craft in the 2x2 grid right after a closed furnace window
// left the planks on the cursor, the view and the server apart (W105, the packet trace of round 8).
// patches/mineflayer+4.39.0.patch, lib/plugins/inventory.js: a click on another window than the one of the last stateId
// first fetches that window's state (bot._syncWindow: a click with stateId -1, the server answers with window_items),
// at most 1 s, and then clicks with the fresh stateId. Clicks on the window of the last stateId go out at once.
//
// The fake bot below has the real inventory plugin of mineflayer; its client records what it writes and answers a sync
// click on window 0 with a window_items of stateId 9, as the server does.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { repoPath } from '../helpers/paths.js';

const require = createRequire(import.meta.url);
// upstream's once() starts a 20 s sleep that is never cleared; this file loads the plugin with a once without that
// timeout, so no timer outlives the tests (the fake server answers at once)
const promiseUtils = require('mineflayer/lib/promise_utils.js');
promiseUtils.once = (emitter, event) => promiseUtils.onceWithCleanup(emitter, event, { timeout: 0 });
const injectInventory = require('mineflayer/lib/plugins/inventory.js');
const prismarineRegistry = require('prismarine-registry');

const read = (rel) => fs.readFileSync(repoPath(rel), 'utf8').replace(/\r\n/g, '\n');
const empty = { itemCount: 0 };

function inventoryBot({ answers = true } = {}) {
    const registry = prismarineRegistry('26.1');
    const bot = new EventEmitter();
    bot.registry = registry;
    bot.version = '26.1';
    bot.supportFeature = registry.supportFeature;
    bot.entity = { yaw: 0, pitch: 0 };
    bot._client = new EventEmitter();
    const clicks = [];
    bot._client.write = (name, params) => {
        if (name !== 'window_click') return;
        clicks.push({ windowId: params.windowId, stateId: params.stateId, slot: params.slot, mode: params.mode });
        if (answers && params.stateId === -1) {
            setImmediate(() => bot._client.emit('window_items', { windowId: params.windowId, stateId: 9, items: new Array(46).fill(empty), carriedItem: empty }));
        }
    };
    injectInventory(bot, { hideErrors: false });
    return { bot, clicks };
}

describe('L: a click after another window fetches the state first (mineflayer inventory.js)', () => {
    test('the patch file and the patched inventory.js hold the hunk', () => {
        const patch = read('patches/mineflayer+4.39.0.patch');
        const src = read('node_modules/mineflayer/lib/plugins/inventory.js');
        assert.ok(patch.includes('diff --git a/node_modules/mineflayer/lib/plugins/inventory.js'), 'a hunk for inventory.js');
        for (const line of [
            "let stateWindowId = null // v0.1.4.14: the window whose packet set stateId",
            "const listener = packet => { stateId = packet.stateId; stateWindowId = packet.windowId }",
            "if (bot.supportFeature('stateIdUsed') && stateWindowId !== window.id) {",
            "await withTimeout(syncWindow(window), 1000).catch(() => {})",
        ]) {
            assert.ok(src.includes(line), `inventory.js: ${line}`);
            assert.ok(patch.includes(`+${src.split('\n').find((l) => l.includes(line))}`), `patch: ${line}`);
        }
        assert.match(patch, /\+\s*\/\/ v0\.1\.4\.14 \(Mindcraft fork\): stateId is one for all windows\./);
        // the use_item hunk of 4.33.0 stays dropped: the patch does not touch use_item
        assert.doesNotMatch(patch, /^[+-].*use_item/m);
    });

    test('after a packet of a closed furnace (window 3): a sync of window 0 first, then the click with its stateId', async () => {
        const { bot, clicks } = inventoryBot();
        bot._client.emit('set_slot', { windowId: 3, stateId: 1, slot: 0, item: empty });
        await bot.clickWindow(36, 0, 0);
        assert.deepEqual(clicks, [
            { windowId: 0, stateId: -1, slot: -999, mode: 5 },
            { windowId: 0, stateId: 9, slot: 36, mode: 0 },
        ]);
    });

    test('the next click on the same window goes out at once, with the same stateId', async () => {
        const { bot, clicks } = inventoryBot();
        bot._client.emit('set_slot', { windowId: 3, stateId: 1, slot: 0, item: empty });
        await bot.clickWindow(36, 0, 0);
        await bot.clickWindow(37, 0, 0);
        assert.equal(clicks.length, 3);
        assert.deepEqual(clicks[2], { windowId: 0, stateId: 9, slot: 37, mode: 0 });
    });

    test('a stateId already of window 0: no sync', async () => {
        const { bot, clicks } = inventoryBot();
        bot._client.emit('window_items', { windowId: 0, stateId: 5, items: new Array(46).fill(empty), carriedItem: empty });
        await bot.clickWindow(36, 0, 0);
        assert.deepEqual(clicks, [{ windowId: 0, stateId: 5, slot: 36, mode: 0 }]);
    });

    test('a server that never answers the sync: the click still goes out after at most 1 s', async () => {
        const { bot, clicks } = inventoryBot({ answers: false });
        bot._client.emit('set_slot', { windowId: 3, stateId: 1, slot: 0, item: empty });
        const t = performance.now();
        await bot.clickWindow(36, 0, 0);
        const ms = performance.now() - t;
        assert.ok(ms >= 900 && ms < 2000, `${Math.round(ms)} ms`);
        assert.deepEqual(clicks.map((c) => c.stateId), [-1, 1]);
    });
});
