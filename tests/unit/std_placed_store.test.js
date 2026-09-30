// Spec v0.1.4.8, part D: D4 (what the bot placed) -- src/agent/areas/placed_store.js, and how the
// guard of area_guard.js feeds it.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir, listDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';
import { vec } from '../helpers/block_world.js';

const MODULE = 'src/agent/areas/placed_store.js';
const P = await loadSrc(MODULE);
const GUARD = await loadSrc('src/agent/areas/area_guard.js');

let dir;
let file;
let cap;
beforeEach(() => {
    dir = makeTmpDir();
    file = path.join(dir, 'placed.json');
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

// Timers under the control of the test: fire() runs what is due.
function fakeTimers() {
    const pending = [];
    return {
        pending,
        setTimer(fn, ms) {
            const timer = { fn, ms, cleared: false };
            pending.push(timer);
            return timer;
        },
        clearTimer(timer) {
            timer.cleared = true;
        },
        fire() {
            const due = pending.splice(0).filter(t => !t.cleared);
            for (const t of due) t.fn();
            return due.length;
        },
    };
}

function newStore(extra = {}) {
    const timers = fakeTimers();
    const store = new P.PlacedStore(file, { setTimer: timers.setTimer, clearTimer: timers.clearTimer, ...extra });
    store.load();
    return { store, timers };
}

describe('constants', () => {
    test('at most 5000 positions, a write at most once per 5 s', () => {
        assert.equal(P.MAX_PLACED, 5000);
        assert.equal(P.SAVE_INTERVAL_MS, 5000);
    });
});

describe('add, has, remove', () => {
    test('positions are floored; each dimension has its own; invalid positions are refused', () => {
        const { store } = newStore();
        assert.equal(store.add({ x: 1.7, y: 64.2, z: -3.5 }), true);
        assert.equal(store.has({ x: 1, y: 64, z: -4 }), true);
        assert.equal(store.has({ x: 1.2, y: 64.9, z: -3.1 }, 'overworld'), true);
        assert.equal(store.has({ x: 1, y: 64, z: -4 }, 'minecraft:overworld'), true);
        assert.equal(store.has({ x: 1, y: 64, z: -4 }, 'the_nether'), false);
        store.add({ x: 1, y: 64, z: -4 }, 'the_nether');
        assert.equal(store.size, 2);
        assert.equal(store.add(null), false);
        assert.equal(store.add({ x: NaN, y: 1, z: 1 }), false);
        assert.equal(store.has(undefined), false);
        assert.equal(store.remove({ x: 1, y: 64, z: -4 }), true);
        assert.equal(store.remove({ x: 1, y: 64, z: -4 }), false);
        assert.deepEqual(store.list(), [{ x: 1, y: 64, z: -4, dimension: 'the_nether' }]);
    });

    test('at most 5000: the oldest leave; a position noted again is the newest', () => {
        const { store } = newStore();
        for (let i = 0; i < 5000; i++) store.add({ x: i, y: 64, z: 0 });
        assert.equal(store.size, 5000);
        store.add({ x: 0, y: 64, z: 0 }); // again: now the newest
        store.add({ x: 5000, y: 64, z: 0 });
        assert.equal(store.size, 5000);
        assert.equal(store.has({ x: 0, y: 64, z: 0 }), true);
        assert.equal(store.has({ x: 1, y: 64, z: 0 }), false, 'the oldest left');
        assert.equal(store.has({ x: 5000, y: 64, z: 0 }), true);
    });

    test('the limit can be set lower (option max)', () => {
        const { store } = newStore({ max: 3 });
        for (let i = 0; i < 5; i++) store.add({ x: i, y: 0, z: 0 });
        assert.deepEqual(store.list().map(p => p.x), [2, 3, 4]);
    });
});

describe('writing the file: never once per block', () => {
    test('a change starts one timer of 5 s; more changes add none; the timer writes once', () => {
        const { store, timers } = newStore();
        for (let i = 0; i < 100; i++) store.add({ x: i, y: 64, z: 0 });
        store.remove({ x: 5, y: 64, z: 0 });
        assert.equal(fs.existsSync(file), false, 'nothing written yet');
        assert.equal(timers.pending.length, 1);
        assert.equal(timers.pending[0].ms, 5000);
        assert.equal(timers.fire(), 1);
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.equal(data.version, 1);
        assert.equal(data.placed.length, 99);
        assert.equal(data.placed[0], 'overworld 0 64 0');
        assert.deepEqual(listDir(dir), ['placed.json'], 'atomic write, no temp file');
        store.add({ x: 500, y: 64, z: 0 });
        assert.equal(timers.pending.length, 1, 'a new change after the write starts a new timer');
    });

    test('flush() writes now and stops the timer; with nothing new it writes nothing', () => {
        const { store, timers } = newStore();
        store.add({ x: 1, y: 2, z: 3 });
        assert.equal(store.flush(), true);
        assert.equal(timers.pending[0].cleared, true);
        assert.ok(fs.existsSync(file));
        fs.unlinkSync(file);
        assert.equal(store.flush(), true);
        assert.equal(fs.existsSync(file), false, 'nothing changed since the last write');
    });

    test('the default timer does not keep the process alive and writes after the interval', async () => {
        const store = new P.PlacedStore(file, { intervalMs: 20 });
        store.load();
        store.add({ x: 1, y: 2, z: 3 });
        assert.equal(fs.existsSync(file), false);
        await new Promise(resolve => setTimeout(resolve, 80));
        assert.ok(fs.existsSync(file));
    });

    test('a store without a file keeps the positions in memory and never starts a timer', () => {
        const timers = fakeTimers();
        const store = new P.PlacedStore(null, { setTimer: timers.setTimer, clearTimer: timers.clearTimer });
        assert.equal(store.load(), 0);
        store.add({ x: 1, y: 2, z: 3 });
        assert.equal(store.has({ x: 1, y: 2, z: 3 }), true);
        assert.equal(timers.pending.length, 0);
        assert.equal(store.flush(), true);
        assert.deepEqual(listDir(dir), []);
    });

    test('a failing write warns once, returns false and does not throw', () => {
        const blocker = path.join(dir, 'blocker');
        fs.writeFileSync(blocker, 'a file where a directory should be');
        const store = new P.PlacedStore(path.join(blocker, 'placed.json'), { setTimer: () => 1, clearTimer: () => {} });
        store.add({ x: 1, y: 2, z: 3 });
        assert.equal(store.flush(), false);
        store.add({ x: 2, y: 2, z: 3 });
        assert.equal(store.flush(), false);
        assert.equal(cap.of('warn').length, 1, cap.allText());
    });
});

describe('load()', () => {
    test('reads what was written, oldest first', () => {
        const { store } = newStore();
        store.add({ x: 3, y: 64, z: 0 });
        store.add({ x: 1, y: 64, z: 0 }, 'the_nether');
        store.flush();
        const { store: again } = newStore();
        assert.equal(again.size, 2);
        assert.deepEqual(again.list(), [{ x: 3, y: 64, z: 0, dimension: 'overworld' }, { x: 1, y: 64, z: 0, dimension: 'the_nether' }]);
    });

    test('missing: empty; invalid entries skipped with a warning; beyond the limit the newest stay', () => {
        assert.equal(newStore().store.size, 0);
        fs.writeFileSync(file, JSON.stringify({ version: 1, placed: ['overworld 1 2 3', 'junk', 42, 'overworld 1.5 2 3', 'overworld 4 5 6', 'the_end 7 8 9'] }));
        const { store } = newStore({ max: 2 });
        assert.deepEqual(store.list().map(p => p.x), [4, 7]);
        assert.ok(cap.of('warn').some(r => r.text.includes('skipped 3')), cap.allText());
    });

    test('a corrupt file is set aside and the store starts empty; load never throws', () => {
        fs.writeFileSync(file, '{ not json');
        const { store } = newStore();
        assert.equal(store.size, 0);
        assert.ok(listDir(dir).some(n => n.startsWith('placed.corrupt.')), listDir(dir).join(', '));
    });
});

describe('the guard feeds the store', () => {
    function fakeBot() {
        const calls = [];
        return {
            calls,
            bot: {
                game: { dimension: 'overworld' },
                heldItem: { name: 'cobblestone' },
                inventory: { slots: [] },
                dig: (b) => { calls.push(['dig', b]); return Promise.resolve('dug'); },
                placeBlock: () => Promise.resolve('placed'),
                _placeBlockWithOptions: () => Promise.resolve('placed with options'),
                activateBlock: () => Promise.resolve('activated'),
                pathfinder: { setMovements() {}, getPathTo() {}, movements: { exclusionAreasBreak: [], exclusionAreasPlace: [] } },
                once() {},
            },
        };
    }

    test('placeBlock and _placeBlockWithOptions note the new block after success', async () => {
        const { store } = newStore();
        const { bot } = fakeBot();
        const guard = GUARD.installAreaGuard(bot, { placed: () => store, log() {} });
        assert.equal(await bot.placeBlock({ name: 'stone', position: vec(1, 63, 1) }, vec(0, 1, 0)), 'placed');
        assert.equal(await bot._placeBlockWithOptions({ name: 'stone', position: vec(2, 63, 1) }, vec(0, 1, 0), {}), 'placed with options');
        assert.equal(store.has({ x: 1, y: 64, z: 1 }), true);
        assert.equal(store.has({ x: 2, y: 64, z: 1 }), true);
        assert.equal(guard.placedByBot(vec(1, 64, 1)), true);
        assert.equal(bot.areaGuard.placedByBot(vec(2.5, 64.5, 1.5)), true);
        assert.equal(fs.existsSync(file), false, 'no write per block');
    });

    test('a rejected place notes nothing and keeps the error', async () => {
        const { store } = newStore();
        const { bot } = fakeBot();
        const failure = new Error('No block has been placed');
        bot.placeBlock = () => Promise.reject(failure);
        GUARD.installAreaGuard(bot, { placed: store, log() {} });
        await assert.rejects(bot.placeBlock({ name: 'stone', position: vec(1, 63, 1) }, vec(0, 1, 0)), (err) => err === failure);
        assert.equal(store.size, 0);
    });

    test('dig forgets the block after success; per world: another store knows nothing', async () => {
        const first = newStore().store;
        const second = new P.PlacedStore(null);
        let current = first;
        const { bot } = fakeBot();
        const guard = GUARD.installAreaGuard(bot, { placed: () => current, log() {} });
        await bot.placeBlock({ name: 'stone', position: vec(1, 63, 1) }, vec(0, 1, 0));
        assert.equal(guard.placedByBot({ x: 1, y: 64, z: 1 }), true);
        current = second;
        assert.equal(guard.placedByBot({ x: 1, y: 64, z: 1 }), false, 'another world');
        current = first;
        await bot.dig({ name: 'cobblestone', position: vec(1, 64, 1) });
        assert.equal(first.has({ x: 1, y: 64, z: 1 }), false);
    });

    test('without the option the guard keeps a store in memory; flushPlaced writes the store of the world', async () => {
        const { bot } = fakeBot();
        const guard = GUARD.installAreaGuard(bot, { log() {} });
        await bot.placeBlock({ name: 'stone', position: vec(5, 63, 5) }, vec(0, 1, 0));
        assert.equal(guard.placedByBot({ x: 5, y: 64, z: 5 }), true);
        assert.equal(guard.flushPlaced(), true);
        assert.deepEqual(listDir(dir), []);

        const { store } = newStore();
        const other = fakeBot();
        const guard2 = GUARD.installAreaGuard(other.bot, { placed: store, log() {} });
        await other.bot.placeBlock({ name: 'stone', position: vec(5, 63, 5) }, vec(0, 1, 0));
        assert.equal(fs.existsSync(file), false);
        assert.equal(guard2.flushPlaced(), true);
        assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).placed, ['overworld 5 64 5']);
    });

    test('a store that throws never breaks the place', async () => {
        const { bot } = fakeBot();
        const broken = { has() { throw new Error('x'); }, add() { throw new Error('y'); }, remove() { throw new Error('z'); } };
        const guard = GUARD.installAreaGuard(bot, { placed: broken, log() {}, protectBuiltBlocks: true });
        assert.equal(await bot.placeBlock({ name: 'stone', position: vec(1, 63, 1) }, vec(0, 1, 0)), 'placed');
        assert.equal(guard.placedByBot({ x: 1, y: 64, z: 1 }), false);
        assert.equal(await bot.dig({ name: 'stone', position: vec(1, 60, 1) }), 'dug');
    });
});

describe('module rules', () => {
    test('imports only project files and node built-ins', () => {
        assertImportRules(MODULE);
    });

    test('imports cleanly: no output, no files', () => {
        assertCleanImport(MODULE);
    });
});
