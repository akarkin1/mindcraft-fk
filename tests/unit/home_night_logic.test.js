// Spec v0.1.4.6 H5: src/agent/packs/home/night_logic.js -- when the bot goes to its shelter by itself.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadSrc } from '../helpers/load.js';

const N = await loadSrc('src/agent/packs/home/night_logic.js');
const require = createRequire(import.meta.url);
const ENTITIES = require('minecraft-data/minecraft-data/data/pc/1.21.8/entities.json');

describe('isNight', () => {
    test('true from 12000 up to 23000', () => {
        assert.equal(N.isNight(0), false);
        assert.equal(N.isNight(6000), false);
        assert.equal(N.isNight(11999), false);
        assert.equal(N.isNight(12000), true);
        assert.equal(N.isNight(13000), true);
        assert.equal(N.isNight(18000), true);
        assert.equal(N.isNight(22999), true);
        assert.equal(N.isNight(23000), false);
        assert.equal(N.isNight(23999), false);
    });

    test('values outside one day are taken modulo 24000', () => {
        assert.equal(N.isNight(24000 + 12500), true);
        assert.equal(N.isNight(-1000), false, '-1000 is 23000');
        assert.equal(N.isNight(-6000), true, '-6000 is 18000');
    });

    test('not a finite number: not night', () => {
        assert.equal(N.isNight(NaN), false);
        assert.equal(N.isNight('13000'), false);
        assert.equal(N.isNight(undefined), false);
    });
});

describe('isHostileForShelter', () => {
    const mob = (name, type = 'hostile') => ({ name, type });

    test('monsters count', () => {
        for (const name of ['zombie', 'skeleton', 'creeper', 'spider', 'witch', 'drowned', 'husk', 'pillager']) {
            assert.equal(N.isHostileForShelter(mob(name)), true, name);
        }
        for (const name of ['phantom', 'ghast', 'slime', 'magma_cube']) {
            assert.equal(N.isHostileForShelter(mob(name, 'mob')), true, name);
        }
    });

    test('peaceful until provoked, golems and the allay do not count', () => {
        for (const [name, type] of [['enderman', 'hostile'], ['piglin', 'hostile'], ['zombified_piglin', 'hostile'],
            ['allay', 'mob'], ['iron_golem', 'mob'], ['snow_golem', 'mob']]) {
            assert.equal(N.isHostileForShelter(mob(name, type)), false, name);
        }
    });

    test('animals, players, items and garbage do not count', () => {
        assert.equal(N.isHostileForShelter({ name: 'cow', type: 'animal' }), false);
        assert.equal(N.isHostileForShelter({ name: 'player', type: 'player' }), false);
        assert.equal(N.isHostileForShelter({ name: 'item', type: 'object' }), false);
        assert.equal(N.isHostileForShelter({ name: 'zombie' }), false, 'no type');
        assert.equal(N.isHostileForShelter({ type: 'hostile' }), false, 'no name');
        assert.equal(N.isHostileForShelter(null), false);
    });

    test('matches isHostile of mcdata for every entity of 1.21.8, except the listed ones', () => {
        const excluded = new Set(['allay', 'enderman', 'piglin', 'zombified_piglin']);
        for (const e of ENTITIES) {
            const oldRule = (e.type === 'mob' || e.type === 'hostile') && e.name !== 'iron_golem' && e.name !== 'snow_golem';
            const expected = oldRule && !excluded.has(e.name);
            assert.equal(N.isHostileForShelter({ name: e.name, type: e.type }), expected, e.name);
        }
    });
});

describe('shouldShelter', () => {
    const NOW = 50_000_000;
    const base = Object.freeze({ timeOfDay: 13000, inShelter: false, action: '', order: null, selfPrompting: false, lastAttempt: null, now: NOW });
    const ask = (over) => N.shouldShelter({ ...base, ...over });

    test('an idle bot outside at night goes', () => {
        assert.deepEqual(ask({}), { go: true, reason: 'night' });
    });

    test('day: no', () => {
        assert.deepEqual(ask({ timeOfDay: 6000 }), { go: false, reason: 'day' });
        assert.deepEqual(ask({ timeOfDay: 6000, inShelter: true }), { go: false, reason: 'day' }, 'first match wins');
    });

    test('in the shelter: no', () => {
        assert.deepEqual(ask({ inShelter: true }), { go: false, reason: 'in_shelter' });
    });

    test('cooldown of 60 s after the last attempt', () => {
        assert.deepEqual(ask({ lastAttempt: NOW - 30_000 }), { go: false, reason: 'cooldown' });
        assert.deepEqual(ask({ lastAttempt: NOW - 59_999 }), { go: false, reason: 'cooldown' });
        assert.deepEqual(ask({ lastAttempt: NOW - 60_000 }), { go: true, reason: 'night' });
        assert.deepEqual(ask({ lastAttempt: NOW - 30_000, inShelter: true }), { go: false, reason: 'in_shelter' });
    });

    test('busy with a player or with safety: no', () => {
        for (const action of ['action:followPlayer', 'action:goToPlayer', 'action:goToShelter', 'action:goToBed',
            'mode:self_defense', 'mode:creeper_safety', 'mode:night_shelter']) {
            assert.deepEqual(ask({ action }), { go: false, reason: 'busy_with_player_or_safety' }, action);
        }
    });

    test('an action ordered by a player during this night: no', () => {
        const order = { by: 'alex', at: NOW - 20_000, atTimeOfDay: 12600, command: '!collectBlocks' };
        assert.deepEqual(ask({ action: 'action:collectBlocks', order }), { go: false, reason: 'ordered_at_night' });
    });

    test('an action ordered during the day that is still running: yes', () => {
        const order = { by: 'alex', at: NOW - 120_000, atTimeOfDay: 10600, command: '!collectBlocks' };
        assert.deepEqual(ask({ action: 'action:collectBlocks', order }), { go: true, reason: 'night' });
    });

    test('an order of the previous night does not count', () => {
        const order = { by: 'alex', at: NOW - 25 * 60_000, atTimeOfDay: 12800, command: '!collectBlocks' };
        assert.deepEqual(ask({ action: 'action:collectBlocks', order }), { go: true, reason: 'night' }, 'more than a day ago');
        const late = { by: 'alex', at: NOW - 60_000, atTimeOfDay: 20000, command: '!collectBlocks' };
        assert.deepEqual(ask({ action: 'action:collectBlocks', order: late }), { go: true, reason: 'night' }, 'later in the night than now');
    });

    test('busy wins over an order at night', () => {
        const order = { by: 'alex', at: NOW - 20_000, atTimeOfDay: 12600, command: '!followPlayer' };
        assert.deepEqual(ask({ action: 'action:followPlayer', order }), { go: false, reason: 'busy_with_player_or_safety' });
    });

    test('self prompting does not change the answer', () => {
        assert.deepEqual(ask({ selfPrompting: true }), { go: true, reason: 'night' });
        assert.deepEqual(ask({ selfPrompting: true, action: 'action:newAction' }), { go: true, reason: 'night' });
    });

    test('garbage state: not night, no throw', () => {
        assert.deepEqual(N.shouldShelter(null), { go: false, reason: 'day' });
        assert.deepEqual(N.shouldShelter(undefined), { go: false, reason: 'day' });
        assert.deepEqual(ask({ action: null, order: 'x', lastAttempt: 'y' }), { go: true, reason: 'night' });
    });
});

describe('orderedThisNight', () => {
    const NOW = 50_000_000;

    test('with the time of day of the order', () => {
        assert.equal(N.orderedThisNight({ at: NOW - 1000, atTimeOfDay: 13000 }, 13100, NOW), true);
        assert.equal(N.orderedThisNight({ at: NOW - 1000, atTimeOfDay: 11990 }, 12010, NOW), false, 'given before sunset');
        assert.equal(N.orderedThisNight({ at: NOW - 1000, atTimeOfDay: 22990 }, 13000, NOW), false, 'the night before');
        assert.equal(N.orderedThisNight({ at: NOW - 21 * 60_000, atTimeOfDay: 13000 }, 14000, NOW), false, 'more than 20 minutes ago');
    });

    test('without the time of day of the order it uses how long the night has lasted', () => {
        // 1000 ticks of night have passed, that is 50 s.
        assert.equal(N.orderedThisNight({ at: NOW - 40_000 }, 13000, NOW), true);
        assert.equal(N.orderedThisNight({ at: NOW - 60_000 }, 13000, NOW), false);
    });

    test('no order, bad values, day: false', () => {
        assert.equal(N.orderedThisNight(null, 13000, NOW), false);
        assert.equal(N.orderedThisNight({ at: 'x' }, 13000, NOW), false);
        assert.equal(N.orderedThisNight({ at: NOW - 1000, atTimeOfDay: 13000 }, 6000, NOW), false);
    });
});
