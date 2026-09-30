// Spec v0.1.4.8, part A: the pure rules of A8 (src/agent/reflex/item_logic.js) and of A9, A10
// (src/agent/reflex/health_logic.js).
//   - A8: a pick-up that gained nothing is tried again after 3 s, at most 3 times; an item that the bot
//     itself dropped in the last 10 s is left;
//   - A9: hunger damage (food 0, no lava, fire or water over the head, no hostile mob within 16 blocks);
//   - A10: retreat below flee_below_health, the line of the behaviour log word for word, where to go.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const I = await loadSrc('src/agent/reflex/item_logic.js');
const H = await loadSrc('src/agent/reflex/health_logic.js');

describe('A8: tries of an item', () => {
    test('an item never tried may be tried', () => {
        assert.equal(I.mayTryItem(undefined, 0), true);
        assert.equal(I.mayTryItem(null, 0), true);
    });

    test('nothing gained: again after 3 s', () => {
        const record = I.afterItemTry(undefined, false, 10_000);
        assert.deepEqual(record, { tries: 1, nextAt: 13_000, done: false });
        assert.equal(I.mayTryItem(record, 12_999), false);
        assert.equal(I.mayTryItem(record, 13_000), true);
    });

    test('at most 3 times again: 4 tries in all, then the item is left', () => {
        let record;
        let now = 0;
        const tries = [];
        for (let i = 0; i < 10 && I.mayTryItem(record, now); i++) {
            tries.push(now);
            record = I.afterItemTry(record, false, now);
            now = record.nextAt === Infinity ? now + 3000 : record.nextAt;
        }
        assert.deepEqual(tries, [0, 3000, 6000, 9000]);
        assert.equal(record.done, true);
        assert.equal(I.mayTryItem(record, 1e12), false);
        assert.equal(I.ITEM_RULES.maxRetries, 3);
        assert.equal(I.ITEM_RULES.retryMs, 3000);
    });

    test('something gained: done', () => {
        assert.deepEqual(I.afterItemTry({ tries: 1, nextAt: 3000, done: false }, true, 3000), { tries: 2, nextAt: Infinity, done: true });
    });

    test('an item that the bot threw: at the x and z of the bot, 1.32 above its feet (0.97 when it sneaks)', () => {
        const bot = { x: 10.3, y: 64, z: -2.7 };
        assert.equal(I.isOwnDropSpawn({ x: 10.3, y: 65.32, z: -2.7 }, bot), true);
        assert.equal(I.isOwnDropSpawn({ x: 10.5, y: 64.97, z: -2.6 }, bot), true, 'sneaking, a little late');
    });

    test('drops of broken blocks, of other players and of mobs are not the bot\'s', () => {
        const bot = { x: 10.3, y: 64, z: -2.7 };
        assert.equal(I.isOwnDropSpawn({ x: 11.5, y: 65.5, z: -2.5 }, bot), false, 'a block at the head, next to the bot');
        assert.equal(I.isOwnDropSpawn({ x: 10.5, y: 66.5, z: -2.5 }, bot), false, 'the block above the head');
        assert.equal(I.isOwnDropSpawn({ x: 10.5, y: 63.5, z: -2.5 }, bot), false, 'the block under the feet');
        assert.equal(I.isOwnDropSpawn({ x: 13.3, y: 65.32, z: -2.7 }, bot), false, 'a player 3 blocks away');
        assert.equal(I.isOwnDropSpawn(null, bot), false);
        assert.equal(I.isOwnDropSpawn({ x: 1, y: 1, z: 1 }, undefined), false);
    });

    test('a drop of the bot is left for 10 s', () => {
        assert.equal(I.isRecentOwnDrop(1000, 1000), true);
        assert.equal(I.isRecentOwnDrop(1000, 10_999), true);
        assert.equal(I.isRecentOwnDrop(1000, 11_000), false);
        assert.equal(I.isRecentOwnDrop(undefined, 5), false);
    });
});

describe('A9: hunger damage', () => {
    const starving = { food: 0, inLava: false, inFire: false, burning: false, waterOverHead: false, hostileNear: false };

    test('food 0, nothing else: hunger', () => {
        assert.equal(H.isHungerDamage(starving), true);
        assert.equal(H.isHungerDamage({ food: 0 }), true);
    });

    test('food above 0, lava, fire, burning, water over the head or a hostile mob: not hunger', () => {
        assert.equal(H.isHungerDamage({ ...starving, food: 1 }), false);
        for (const field of ['inLava', 'inFire', 'burning', 'waterOverHead', 'hostileNear'])
            assert.equal(H.isHungerDamage({ ...starving, [field]: true }), false, field);
        assert.equal(H.isHungerDamage(undefined), false);
    });

    test('the text and the times', () => {
        assert.equal(H.STARVING_TEXT, 'I am starving.');
        assert.equal(H.STARVING_LOG_MS, 60000);
        assert.equal(H.HOSTILE_RANGE, 16);
    });
});

describe('A10: retreat at low health', () => {
    test('flee_below_health 0 (the default) or not a number: never', () => {
        for (const setting of [0, undefined, null, -3, 'x', NaN])
            assert.equal(H.shouldRetreat(1, setting), false, String(setting));
    });

    test('below the setting: retreat; at it or above: fight', () => {
        assert.equal(H.shouldRetreat(7, 8), true);
        assert.equal(H.shouldRetreat(7.5, 8), true);
        assert.equal(H.shouldRetreat(8, 8), false);
        assert.equal(H.shouldRetreat(20, 20), false);
        assert.equal(H.shouldRetreat(19.5, 20), true);
        assert.equal(H.shouldRetreat(19, 25), true, 'more than 20 counts as 20');
        assert.equal(H.shouldRetreat(NaN, 8), false);
    });

    test('the line of the behaviour log, word for word', () => {
        assert.equal(H.hurtText(6), 'I am hurt (health 6 of 20). I retreat.');
        assert.equal(H.hurtText(7.5), 'I am hurt (health 7.5 of 20). I retreat.');
        assert.equal(H.hurtText(3.3333333), 'I am hurt (health 3.3 of 20). I retreat.');
    });

    test('where to: a player, else the shelter, else away', () => {
        assert.equal(H.retreatTarget({ player: true, shelter: true }), 'player');
        assert.equal(H.retreatTarget({ player: false, shelter: true }), 'shelter');
        assert.equal(H.retreatTarget({ player: false, shelter: false }), 'away');
        assert.equal(H.retreatTarget(undefined), 'away');
        assert.equal(H.PLAYER_RANGE, 32);
    });
});

describe('module rules', () => {
    for (const rel of ['src/agent/reflex/item_logic.js', 'src/agent/reflex/health_logic.js']) {
        test(`${rel} imports nothing and is importable without output or files`, () => {
            assertImportRules(rel, { allowBuiltins: [], allowedRelative: [] });
            assertCleanImport(rel);
        });
    }
});
