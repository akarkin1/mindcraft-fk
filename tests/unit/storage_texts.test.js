// Spec v0.1.4.7 S3 and 0.1: the texts of the storage pack, word for word.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const T = await loadSrc('src/agent/packs/storage/texts.js');

const AT = { x: -13, y: 63, z: 28 };
const AT2 = { x: 1, y: 12, z: 5 };

describe('lists and positions', () => {
    test('countsText: by count, highest first, then by name; at most 6 kinds', () => {
        assert.equal(T.countsText({ wheat_seeds: 3, wheat: 12 }), '12 wheat, 3 wheat_seeds');
        assert.equal(T.countsText([{ name: 'dirt', count: 12 }, { name: 'cobblestone', count: 64 }]), '64 cobblestone, 12 dirt');
        assert.equal(T.countsText({ a: 1, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7 }), '7 h, 6 g, 5 f, 4 e, 3 d, 2 c and 2 more kinds');
        assert.equal(T.countsText({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 }), '7 g, 6 f, 5 e, 4 d, 3 c, 2 b and 1 more kinds');
        assert.equal(T.countsText({ zero: 0, dirt: 2 }), '2 dirt');
        assert.equal(T.countsText(null), '');
    });

    test('posText floors the coordinates', () => {
        assert.equal(T.posText({ x: -12.5, y: 63, z: 28.9 }), '(-13, 63, 28)');
    });
});

describe('storing', () => {
    test('stored in one chest, in several chests', () => {
        assert.equal(T.storeText({ stored: { wheat: 12, wheat_seeds: 3 }, left: {}, chests: [AT] }),
            'I stored 12 wheat, 3 wheat_seeds in the chest at (-13, 63, 28).');
        assert.equal(T.storeText({ stored: { wheat: 12, wheat_seeds: 3 }, left: {}, chests: [AT, AT2] }),
            'I stored 12 wheat, 3 wheat_seeds in 2 chests.');
    });

    test('nothing to store, no chest', () => {
        assert.equal(T.TEXTS.nothingToStore, 'I have nothing to store. I keep my tools, food and torches.');
        assert.equal(T.storeText({ stored: {}, left: {}, chests: [] }), T.TEXTS.nothingToStore);
        assert.equal(T.TEXTS.noChest, 'I know no chest nearby. Place one or take me to one.');
        assert.equal(T.storeText({ stored: {}, left: { dirt: 3 }, chests: [], reason: 'no_chest' }), T.TEXTS.noChest);
    });

    test('all full, partly', () => {
        assert.equal(T.storeText({ stored: {}, left: { cobblestone: 64, dirt: 12 }, chests: [], reason: 'full' }),
            'All chests nearby are full. I still carry 64 cobblestone, 12 dirt.');
        assert.equal(T.storeText({ stored: { cobblestone: 40 }, left: { cobblestone: 24 }, chests: [AT2], reason: 'full' }),
            'I stored 40 cobblestone in the chest at (1, 12, 5). The chests are full now, I still carry 24 cobblestone.');
    });

    test('unreachable, interrupted, time, error', () => {
        assert.equal(T.storeText({ stored: {}, left: { dirt: 3 }, chests: [], reason: 'unreachable' }),
            'I could not get to a chest nearby or open it. I still carry 3 dirt.');
        assert.equal(T.storeText({ stored: { sand: 2 }, left: { dirt: 3 }, chests: [AT], reason: 'unreachable' }),
            'I stored 2 sand in the chest at (-13, 63, 28). I could not get to another chest, I still carry 3 dirt.');
        assert.equal(T.storeText({ stored: {}, left: { dirt: 3 }, chests: [], reason: 'interrupted' }),
            'I was stopped before I stored anything.');
        assert.equal(T.storeText({ stored: { sand: 2 }, left: { dirt: 3 }, chests: [AT], reason: 'interrupted' }),
            'I stored 2 sand in the chest at (-13, 63, 28). I was stopped, I still carry 3 dirt.');
        assert.equal(T.storeText({ stored: {}, left: { dirt: 3 }, chests: [], reason: 'timeout' }),
            'I ran out of time before I stored anything. I still carry 3 dirt.');
        assert.equal(T.storeText({ stored: { sand: 2 }, left: { dirt: 3 }, chests: [AT], reason: 'timeout' }),
            'I stored 2 sand in the chest at (-13, 63, 28). I ran out of time, I still carry 3 dirt.');
        assert.equal(T.storeText({ stored: {}, left: { dirt: 3 }, chests: [], reason: 'error', error: new Error('boom') }),
            'I could not store my things: boom');
        assert.equal(T.storeText({ stored: { sand: 2 }, left: { dirt: 3 }, chests: [AT], reason: 'error', error: 'bad' }),
            'I stored 2 sand in the chest at (-13, 63, 28). I could not store my things: bad');
        assert.equal(T.storeText({ stored: {}, left: { dirt: 3 }, chests: [], reason: 'error' }),
            'I could not store my things: unknown error');
    });

    test('missing fields do not throw', () => {
        assert.equal(T.storeText(null), T.TEXTS.nothingToStore);
    });
});

describe('fetching', () => {
    test('fetched, fetched from several chests, fetched less', () => {
        assert.equal(T.fetchText({ name: 'bread', taken: 5, chests: [AT] }), 'I took 5 bread from the chest at (-13, 63, 28).');
        assert.equal(T.fetchText({ name: 'bread', taken: 8, chests: [AT, AT2] }), 'I took 8 bread from 2 chests.');
        assert.equal(T.fetchText({ name: 'bread', taken: 3, chests: [AT], reason: 'no_more' }),
            'I took 3 bread from the chest at (-13, 63, 28). There was no more.');
    });

    test('not found, nothing where the index said', () => {
        assert.equal(T.notFoundText('bread'), 'I know no chest with bread.');
        assert.equal(T.fetchText({ name: 'bread', taken: 0, chests: [], reason: 'not_found' }), 'I know no chest with bread.');
        assert.equal(T.fetchText({ name: 'bread', taken: 0, chests: [], reason: 'no_more' }), 'I found no bread in the chests I know.');
    });

    test('inventory full, unreachable, interrupted, time, error, bad name', () => {
        assert.equal(T.fetchText({ name: 'bread', taken: 3, chests: [AT], reason: 'inventory_full' }),
            'I took 3 bread from the chest at (-13, 63, 28). My inventory is full.');
        assert.equal(T.fetchText({ name: 'bread', taken: 0, chests: [], reason: 'inventory_full' }), 'My inventory is full, I took no bread.');
        assert.equal(T.fetchText({ name: 'bread', taken: 3, chests: [AT], reason: 'unreachable' }),
            'I took 3 bread from the chest at (-13, 63, 28). I could not get to the other chests with bread.');
        assert.equal(T.fetchText({ name: 'bread', taken: 0, chests: [], reason: 'unreachable', failedAt: AT2 }),
            'I could not get to the chest with bread at (1, 12, 5).');
        assert.equal(T.fetchText({ name: 'bread', taken: 0, chests: [], reason: 'unreachable' }),
            'I could not get to a chest with bread.');
        assert.equal(T.fetchText({ name: 'bread', taken: 2, chests: [AT], reason: 'interrupted' }),
            'I took 2 bread from the chest at (-13, 63, 28). I was stopped.');
        assert.equal(T.fetchText({ name: 'bread', taken: 0, chests: [], reason: 'interrupted' }), 'I was stopped before I took any bread.');
        assert.equal(T.fetchText({ name: 'bread', taken: 2, chests: [AT], reason: 'timeout' }),
            'I took 2 bread from the chest at (-13, 63, 28). I ran out of time.');
        assert.equal(T.fetchText({ name: 'bread', taken: 0, chests: [], reason: 'timeout' }), 'I ran out of time before I took any bread.');
        assert.equal(T.fetchText({ name: 'bread', taken: 0, chests: [], reason: 'error', error: new Error('boom') }),
            'I could not take bread: boom');
        assert.equal(T.fetchText({ name: 'bread', taken: 1, chests: [AT], reason: 'error', error: new Error('boom') }),
            'I took 1 bread from the chest at (-13, 63, 28). I could not take more: boom');
        assert.equal(T.TEXTS.noItemName, 'Tell me which item to fetch.');
        assert.equal(T.fetchText(null), 'I know no chest with an item.');
    });
});

describe('the list of chests', () => {
    const c = (x, items, free) => ({ x, y: 63, z: 28, dimension: 'overworld', kind: 'chest', items, free_slots: free });

    test('one line per chest', () => {
        assert.equal(T.chestListText([c(-13, { wheat_seeds: 3, wheat: 12 }, 4), c(2, {}, 27)]),
            'Chests I know in this world:\n- (-13, 63, 28): 12 wheat, 3 wheat_seeds, 4 free slots\n- (2, 63, 28): empty, 27 free slots');
        assert.equal(T.chestLine(c(0, { dirt: 1 }, 1)), '- (0, 63, 28): 1 dirt, 1 free slots');
    });

    test('at most 10 chests, none', () => {
        const many = Array.from({ length: 13 }, (_, i) => c(i, { dirt: i + 1 }, 1));
        const lines = T.chestListText(many).split('\n');
        assert.equal(lines.length, 1 + 10 + 1);
        assert.equal(lines[10], '- (9, 63, 28): 10 dirt, 1 free slots');
        assert.equal(lines[11], 'And 3 more chests.');
        assert.equal(T.chestListText([]), 'I know no chests in this world.');
        assert.equal(T.chestListText(null), T.TEXTS.noChests);
    });
});
