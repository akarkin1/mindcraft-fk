// src/agent/packs/home/context.js -- reading ctx and the bot for the home pack; never throws.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';

const C = await loadSrc('src/agent/packs/home/context.js');

const area = (name, dimension = 'overworld') => ({ name, dimension, min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 4, z: 4 } });

describe('clock and log', () => {
    test('toMs', () => {
        assert.equal(C.toMs(new Date(5)), 5);
        assert.equal(C.toMs(7), 7);
        assert.equal(C.toMs('7'), null);
        assert.equal(C.toMs(NaN), null);
    });

    test('clockOf prefers options, then ctx.now, then the real clock', async () => {
        assert.equal(C.clockOf({ now: () => 11 }).now(), 11);
        assert.equal(C.clockOf({ now: () => 11 }, { now: () => 22 }).now(), 22);
        assert.equal(C.clockOf({ now: () => new Date(33) }).now(), 33);
        const before = Date.now();
        assert.ok(C.clockOf({ now: () => 'bad' }).now() >= before);
        assert.ok(C.clockOf({ now: () => { throw new Error('x'); } }).now() >= before);
        assert.ok(C.clockOf(null).now() >= before);
        await C.clockOf(null).wait(1);
        await C.clockOf(null, { wait: async () => { throw new Error('x'); } }).wait(1);
    });

    test('logTo never throws', () => {
        const seen = [];
        C.logTo({ log: t => seen.push(t) }, 'hi');
        C.logTo({ log: () => { throw new Error('x'); } }, 'hi');
        C.logTo(null, 'hi');
        assert.deepEqual(seen, ['hi']);
    });
});

describe('bot readers', () => {
    test('dimensionOf and botPos', () => {
        assert.equal(C.dimensionOf({ game: { dimension: 'minecraft:the_nether' } }), 'the_nether');
        assert.equal(C.dimensionOf({ game: {} }), null);
        assert.deepEqual(C.botPos({ entity: { position: { x: 1, y: 2, z: 3 } } }), { x: 1, y: 2, z: 3 });
        assert.equal(C.botPos({ entity: { position: { x: 1, y: NaN, z: 3 } } }), null);
        assert.equal(C.botPos(null), null);
    });

    test('entitiesWhere: nearest first, the bot left out, a throwing test is a no', () => {
        const me = { position: { x: 0, y: 0, z: 0 } };
        const a = { name: 'a', position: { x: 3, y: 0, z: 0 } };
        const b = { name: 'b', position: { x: 1, y: 0, z: 0 } };
        const bad = { name: 'bad', position: { x: 1, y: 0, z: 0 } };
        const bot = { entity: me, entities: { 1: me, 2: a, 3: b, 4: bad, 5: null, 6: { name: 'nopos' } } };
        const test = e => { if (e.name === 'bad') throw new Error('x'); return true; };
        assert.deepEqual(C.entitiesWhere(bot, 5, test).map(e => e.name), ['b', 'a']);
        assert.deepEqual(C.entitiesWhere(bot, 2, test).map(e => e.name), ['b']);
        assert.deepEqual(C.entitiesWhere(bot, 5, test, { x: 3, y: 0, z: 0 }).map(e => e.name), ['a', 'b']);
        assert.deepEqual(C.entitiesWhere({ entity: me }, 5, test), []);
    });

    test('otherPlayerPositions: not the bot, within range, never throws', () => {
        const me = { position: { x: 0, y: 0, z: 0 } };
        const bot = {
            username: 'Bot', entity: me,
            players: { Bot: { entity: me }, near: { entity: { position: { x: 2, y: 0, z: 0 } } }, far: { entity: { position: { x: 99, y: 0, z: 0 } } }, gone: {} },
        };
        assert.deepEqual(C.otherPlayerPositions(bot, 16), [{ x: 2, y: 0, z: 0 }]);
        const broken = { username: 'Bot', entity: me, get players() { throw new Error('x'); } };
        assert.deepEqual(C.otherPlayerPositions(broken), []);
    });

    test('pauseMode never throws', () => {
        const paused = [];
        C.pauseMode({ modes: { pause: n => paused.push(n) } }, 'unstuck');
        C.pauseMode({ modes: { pause: () => { throw new Error('x'); } } }, 'unstuck');
        C.pauseMode(null, 'unstuck');
        assert.deepEqual(paused, ['unstuck']);
    });
});

describe('listAreas and recallHome', () => {
    test('areas from an array, a store, a function; filtered by dimension and validity', () => {
        const list = [area('a'), area('b', 'the_nether'), area('c', null), { name: 'bad' }];
        assert.deepEqual(C.listAreas({ areas: list }, 'overworld').map(a => a.name), ['a', 'c']);
        assert.deepEqual(C.listAreas({ areas: { list: () => list } }, 'minecraft:the_nether').map(a => a.name), ['b', 'c']);
        assert.deepEqual(C.listAreas({ areas: () => list }).map(a => a.name), ['a', 'b', 'c']);
        assert.deepEqual(C.listAreas({ areas: { list: () => 'x' } }), []);
        assert.deepEqual(C.listAreas({}), []);
        const cap = captureConsole();
        try {
            assert.deepEqual(C.listAreas({ areas: { list() { throw new Error('disk'); } } }), []);
        } finally {
            cap.restore();
        }
    });

    test('the place home from a PlaceStore, a MemoryBank or a list of coordinates', () => {
        assert.deepEqual(C.recallHome({ places: { recall: () => ({ x: 1, y: 2, z: 3, dimension: 'overworld' }) } }), { x: 1, y: 2, z: 3, dimension: 'overworld' });
        assert.deepEqual(C.recallHome({ places: { recallPlaceInfo: () => ({ x: 1, y: 2, z: 3 }) } }), { x: 1, y: 2, z: 3, dimension: null });
        assert.deepEqual(C.recallHome({ places: { recallPlace: () => [4, 5, 6] } }), { x: 4, y: 5, z: 6, dimension: null });
        assert.equal(C.recallHome({ places: { recallPlace: () => undefined, recall: () => undefined } }), null);
        assert.equal(C.recallHome({ places: null }), null);
        const cap = captureConsole();
        try {
            assert.equal(C.recallHome({ places: { recall() { throw new Error('x'); } } }), null);
        } finally {
            cap.restore();
        }
    });
});
