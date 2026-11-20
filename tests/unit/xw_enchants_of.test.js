// E3, spec v0.1.4.16 F7: the enchantments of an item as the dig time of the mineflayer patch reads them: enchantsOf of
// node_modules/mineflayer/lib/plugins/digging.js (patches/mineflayer+4.39.0.patch), exported on the plugin function. An
// array ([{ name, lvl }]) is taken as it is; the item component of 26.1 ({ enchantments: [{ id, level }] }) is mapped to
// [{ name: registry.enchantments[id].name, lvl: level }]; anything else is no enchantment; the helmet's the same.
// The 26.1 item is the one E3's probe recorded on the test server on 2026-11-12: `/give w_probe
// diamond_pickaxe[enchantments={efficiency:3}]` gave item.enchants = {"enchantments":[{"id":8,"level":3}]} (prismarine-item
// 1.18.0 returns the component's data as it is); before the patch bot.digTime and bot.dig failed with "enchantments is not
// iterable" (".concat is not a function" with a helmet on), after it bot.digTime gave 150 ms and the stone was dug.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { repoPath } from '../helpers/paths.js';

const require = createRequire(repoPath('package.json'));
const digging = require('mineflayer/lib/plugins/digging.js');
const registry = require('minecraft-data')('26.1');
const { enchantsOf } = digging;

// the item of the probe, as prismarine-item gives it on 26.1
const PROBE_ENCHANTS = Object.freeze({ enchantments: [{ id: 8, level: 3 }] });
const probeItem = () => ({ name: 'diamond_pickaxe', type: registry.itemsByName.diamond_pickaxe.id, enchants: PROBE_ENCHANTS });

describe('F7: enchantsOf of the mineflayer patch', () => {
    test('is exported on the digging plugin', () => {
        assert.equal(typeof digging, 'function', 'the plugin is inject(bot)');
        assert.equal(typeof enchantsOf, 'function');
    });

    test('an array ([{ name, lvl }]) is taken as it is', () => {
        const list = [{ name: 'efficiency', lvl: 2 }, { name: 'unbreaking', lvl: 1 }];
        assert.equal(enchantsOf({ enchants: list }, registry), list);
        assert.deepEqual(enchantsOf({ enchants: [] }, registry), []);
    });

    test('the item component of 26.1 (the recorded item of the probe) is mapped by the registry', () => {
        assert.equal(registry.enchantments[8].name, 'efficiency', 'the id the probe recorded is efficiency on 26.1');
        assert.deepEqual(enchantsOf(probeItem(), registry), [{ name: 'efficiency', lvl: 3 }]);
        assert.deepEqual(enchantsOf({ enchants: { enchantments: [{ id: 8, level: 3 }, { id: 0, level: 1 }] } }, registry),
            [{ name: 'efficiency', lvl: 3 }, { name: 'aqua_affinity', lvl: 1 }], 'the helmet\'s aqua affinity the same way');
        assert.deepEqual(enchantsOf({ enchants: { enchantments: [{ id: 9999, level: 1 }] } }, registry), [{ name: null, lvl: 1 }], 'an unknown id has no name');
        assert.deepEqual(enchantsOf({ enchants: { enchantments: [] } }, registry), []);
    });

    test('anything else is no enchantment, and a getter that throws neither', () => {
        assert.deepEqual(enchantsOf(null, registry), []);
        assert.deepEqual(enchantsOf(undefined, registry), []);
        assert.deepEqual(enchantsOf({}, registry), []);
        assert.deepEqual(enchantsOf({ enchants: null }, registry), []);
        assert.deepEqual(enchantsOf({ enchants: 'efficiency' }, registry), []);
        assert.deepEqual(enchantsOf({ enchants: {} }, registry), []);
        assert.deepEqual(enchantsOf({ enchants: { enchantments: 'x' } }, registry), []);
        const throwing = { get enchants() { throw new Error("Don't know how to get the enchants from an item on this mc version"); } };
        assert.deepEqual(enchantsOf(throwing, registry), []);
        assert.deepEqual(enchantsOf(probeItem(), null), [{ name: null, lvl: 3 }], 'without a registry the levels are kept, the names unknown');
    });

    test('the dig time of prismarine-block: the probe\'s pickaxe digs stone in 150 ms with the mapped list, 300 ms without; the raw object is the error of the play', () => {
        const Block = require('prismarine-block')(registry);
        const stone = Block.fromStateId(registry.blocksByName.stone.defaultState, 0);
        const type = registry.itemsByName.diamond_pickaxe.id;
        assert.equal(stone.digTime(type, false, false, false, [], {}), 300);
        assert.equal(stone.digTime(type, false, false, false, enchantsOf(probeItem(), registry), {}), 150, 'efficiency 3, as the probe measured after the patch');
        assert.throws(() => stone.digTime(type, false, false, false, PROBE_ENCHANTS, {}), /not iterable/, 'the raw component before the patch');
    });
});
