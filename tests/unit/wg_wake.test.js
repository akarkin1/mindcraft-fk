// v0.1.4.12, part G, G1; v0.1.4.14: bot.wake() of mineflayer sends entity_action with actionId 'stop_sleeping'
// (the name of minecraft-data 3.119.0, id 0) for Minecraft 1.21.6 and later, else the id 2 as before
// (patches/mineflayer+4.39.0.patch; minecraft-data 3.119.0 dropped the feature entityActionUsesStringMapper). wakeUp of the home pack keeps its waits and tries and its
// texts, and calls bot.wake() only: it writes no packet itself.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { loadSrc, TEST_MC_VERSION } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { captureConsole } from '../helpers/console_capture.js';

const require = createRequire(import.meta.url);
const prismarineRegistry = require('prismarine-registry');
const injectBed = require('mineflayer/lib/plugins/bed.js');
const W = await loadSrc('src/agent/packs/home/wake.js');

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

/**
 * A bot with the bed plugin of mineflayer and a client that records what it writes. `named`: the registry of
 * the version the bot plays, 26.1 (the actions by name), else of 1.21.5. The server takes the bot out of the bed for the action
 * `answerTo` (the name for 1.21.6 and later, the id 2 before), never for another.
 */
function bedBot({ named = true, answerTo = named ? 'stop_sleeping' : 2 } = {}) {
    const bot = new EventEmitter();
    bot.writes = [];
    bot.entity = { id: 7 };
    bot.registry = prismarineRegistry(named ? TEST_MC_VERSION : '1.21.5') // 1.21.5: the last version of the old action ids;
    bot.supportFeature = bot.registry.supportFeature;
    bot._client = new EventEmitter();
    bot._client.write = (name, params) => {
        bot.writes.push([name, { ...params }]);
        if (name === 'entity_action' && params.actionId === answerTo)
            setImmediate(() => bot.emit('entityWake', bot.entity));
    };
    injectBed(bot);
    return bot;
}

describe('G1: bot.wake() of the patched mineflayer', () => {
    test('1.21.6 and later: entity_action with actionId stop_sleeping', async () => {
        const bot = bedBot({ named: true });
        bot.isSleeping = true;
        await bot.wake();
        assert.deepEqual(bot.writes, [['entity_action', { entityId: 7, actionId: 'stop_sleeping', jumpBoost: 0 }]]);
    });

    test('before 1.21.6: the id 2 as before', async () => {
        const bot = bedBot({ named: false });
        bot.isSleeping = true;
        await bot.wake();
        assert.deepEqual(bot.writes, [['entity_action', { entityId: 7, actionId: 2, jumpBoost: 0 }]]);
    });

    test('awake: it throws "already awake" and writes nothing (unchanged)', async () => {
        const bot = bedBot();
        await assert.rejects(bot.wake(), /already awake/);
        assert.deepEqual(bot.writes, []);
    });

    test('the patch file holds the change', () => {
        const patch = fs.readFileSync(repoPath('patches/mineflayer+4.39.0.patch'), 'utf8');
        assert.match(patch, /\+\s+actionId: bot\.registry\.version\['>='\]\('1\.21\.6'\) \? 'stop_sleeping' : 2,/);
    });
});

describe('G1: wakeUp calls bot.wake() only', () => {
    test('1.21.8: one stop_sleeping through bot.wake(), "I got up." once bot.isSleeping is false', async () => {
        const bot = bedBot({ named: true });
        bot.isSleeping = true;
        let wakes = 0;
        const wake = bot.wake;
        bot.wake = async () => { wakes++; return wake(); };
        const res = await W.wakeUp(bot, {});
        assert.deepEqual(res, { ok: true, woke: true, reason: null, text: 'I got up.' });
        assert.equal(wakes, 1);
        assert.deepEqual(bot.writes, [['entity_action', { entityId: 7, actionId: 'stop_sleeping', jumpBoost: 0 }]]);
        assert.equal(bot.isSleeping, false);
    });

    test('before 1.21.6: the id 2 through bot.wake()', async () => {
        const bot = bedBot({ named: false });
        bot.isSleeping = true;
        const res = await W.wakeUp(bot, {});
        assert.equal(res.ok, true);
        assert.deepEqual(bot.writes, [['entity_action', { entityId: 7, actionId: 2, jumpBoost: 0 }]]);
    });

    test('wakeUp writes no packet itself: a bot.wake() that writes nothing leaves the client untouched', async () => {
        const bot = bedBot();
        bot.isSleeping = true;
        let wakes = 0;
        bot.wake = async () => { wakes++; };
        const res = await W.wakeUp(bot, {}, { waitMs: 60 });
        assert.deepEqual(res, { ok: false, woke: false, reason: 'still_sleeping', text: 'I could not get up. I still lie in the bed.' });
        assert.equal(wakes, 2, 'the first try and one more');
        assert.deepEqual(bot.writes, []);
    });

    test('the waits and the tries stay: 3 s, 2 tries', () => {
        assert.equal(W.WAKE_WAIT_MS, 3000);
        assert.equal(W.WAKE_TRIES, 2);
    });

    test('a bot.wake() that throws: the state decides, never a throw', async () => {
        const bot = bedBot();
        bot.isSleeping = true;
        bot.wake = async () => { throw new Error('socket closed'); };
        const res = await W.wakeUp(bot, {}, { now: () => 5, wait: async () => {} });
        assert.equal(res.ok, false);
        assert.equal(res.text, 'I could not get up. I still lie in the bed.');
    });

    test('wake.js no longer writes entity_action', () => {
        const src = fs.readFileSync(repoPath('src/agent/packs/home/wake.js'), 'utf8');
        assert.doesNotMatch(src, /_client\.write/);
    });
});
