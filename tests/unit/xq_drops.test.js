// v0.1.4.13 part Q (engineer E4), SPEC 4.6 Q5 and Q6: the drop rule. The pure rules of src/agent/reflex/drop_logic.js
// (the death of a player from the death message, the drops within 4 blocks for 5 minutes, the items the bot tossed for
// 30 s, the leave text word for word, the armour the bot may wear) and the watch of reflex/drop_watch.js over a fake bot
// with events (the death message, the tosses of a give, the armour rule that replaces the auto-equip).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { loadSrc } from '../helpers/load.js';
import { assertImportRules } from '../helpers/module_rules.js';

const D = await loadSrc('src/agent/reflex/drop_logic.js');
const Wt = await loadSrc('src/agent/reflex/drop_watch.js');

const NAME = 'MartyByrde2';
const deathMessage = (key, name) => ({ translate: key, with: [{ text: name, toString: () => name }] });

describe('Q6: the death of a player', () => {
    test('from a death message of the server: the player of its first argument', () => {
        assert.equal(D.deathOf(deathMessage('death.fell.accident.generic', NAME)), NAME);
        assert.equal(D.deathOf(deathMessage('death.attack.genericKill', 'w_player')), 'w_player');
        assert.equal(D.deathOf({ json: { translate: 'death.attack.lava', with: [{ text: NAME }] } }), NAME, 'the json of the message');
    });

    test('no death: another message, the bot itself, no argument', () => {
        assert.equal(D.deathOf(deathMessage('chat.type.text', NAME)), null);
        assert.equal(D.deathOf(deathMessage('death.attack.mob', 'claude'), 'claude'), null);
        assert.equal(D.deathOf({ translate: 'death.attack.mob', with: [] }), null);
        assert.equal(D.deathOf(null), null);
    });

    test('the drops: within 4 blocks of the death, for 5 minutes', () => {
        const t = 1000000;
        const deaths = D.noteDeath([], NAME, { x: 13.3, y: -57, z: -99.6 }, t);
        assert.equal(D.deathNear(deaths, { x: 16, y: -57, z: -99 }, t + 1000)?.name, NAME, '2.8 blocks away');
        assert.equal(D.deathNear(deaths, { x: 17.5, y: -57, z: -99 }, t + 1000), null, '4.2 blocks away');
        assert.equal(D.deathNear(deaths, { x: 13, y: -57, z: -99 }, t + 299999)?.name, NAME);
        assert.equal(D.deathNear(deaths, { x: 13, y: -57, z: -99 }, t + 300000), null, 'after 5 minutes');
    });

    test('the same death noted twice within 10 s is one death; an old one is forgotten', () => {
        const t = 1000000;
        let deaths = D.noteDeath([], NAME, { x: 0, y: 64, z: 0 }, t);
        deaths = D.noteDeath(deaths, NAME, { x: 0.5, y: 64, z: 0 }, t + 2000);
        assert.equal(deaths.length, 1);
        deaths = D.noteDeath(deaths, 'gpt', { x: 9, y: 64, z: 0 }, t + 400000);
        assert.deepEqual(deaths.map(d => d.name), ['gpt']);
    });

    test('the leave text, word for word', () => {
        assert.equal(D.leaveThingsText(NAME, { x: 13.7, y: -57, z: -98.2 }), "I leave MartyByrde2's things at (13, -57, -99).");
    });
});

describe('Q5: the items the bot tossed', () => {
    test('left alone for 30 s', () => {
        const tossed = new Map([[7, 1000]]);
        assert.equal(D.isTossed(tossed, 7, 30999), true);
        assert.equal(D.isTossed(tossed, 7, 31000), false);
        assert.equal(D.isTossed(tossed, 8, 2000), false);
        D.forgetTosses(tossed, 31000);
        assert.equal(tossed.size, 0);
    });
});

describe('Q6: the armour the bot may wear', () => {
    test('armour by its name and slot; the rank by material', () => {
        assert.deepEqual(['iron_boots', 'diamond_helmet', 'leather_leggings', 'netherite_chestplate', 'elytra', 'iron_ingot'].map(D.armourSlot),
            ['feet', 'head', 'legs', 'torso', 'torso', null]);
        assert.ok(D.armourRank('diamond_boots') > D.armourRank('iron_boots'));
        assert.equal(D.armourRank('stick'), -1);
    });

    test('never what the bot picked up from the ground', () => {
        assert.equal(D.mayWear('iron_boots', new Set(['iron_boots'])), false);
        assert.equal(D.mayWear('iron_boots', new Set()), true);
        assert.equal(D.mayWear('iron_ingot', new Set()), false);
    });

    test('drop_logic.js is pure', () => {
        assertImportRules('src/agent/reflex/drop_logic.js', { allowBuiltins: [], allowedRelative: [] });
    });
});

describe('Q5 and Q6: the watch of a bot', () => {
    function fakeBot() {
        const bot = new EventEmitter();
        Object.assign(bot, {
            username: 'claude',
            entity: { position: { x: 0.5, y: 64, z: 0.5 } },
            entities: {},
            players: { [NAME]: { username: NAME, entity: { position: { x: 3.5, y: 64, z: 0.5 } } } },
            equipped: [],
            inventory: { items: () => bot.items, slots: [] },
            items: [],
            async equip(item, slot) { bot.equipped.push([item.name, slot]); },
        });
        // the plugin of the auto-equip as mineflayer-armor-manager installs it
        bot.armorManager = { equipAll: async () => { bot.equipped.push('plugin'); } };
        bot.on('playerCollect', function pluginListener() { const isArmor = true; void isArmor; bot.equipped.push('plugin-collect'); });
        return bot;
    }

    test('a death message notes the death at the player; his drops are left and the text taken once', () => {
        const bot = fakeBot();
        Wt.watchDrops(bot);
        bot.emit('message', deathMessage('death.attack.genericKill', NAME));
        const drop = { id: 50, name: 'item', position: { x: 4, y: 64, z: 1 } };
        const far = { id: 51, name: 'item', position: { x: 12, y: 64, z: 1 } };
        const why = Wt.leftAlone(bot, drop);
        assert.equal(why?.why, 'death');
        assert.equal(Wt.leftAlone(bot, far), null);
        assert.equal(Wt.takeLeaveText(why.death), true);
        assert.equal(Wt.takeLeaveText(Wt.leftAlone(bot, drop).death), false, 'once');
    });

    test('a death drop at the feet is found to step away from, once per item', () => {
        const bot = fakeBot();
        Wt.watchDrops(bot);
        bot.emit('message', deathMessage('death.fell.accident.generic', NAME));
        bot.entities[60] = { id: 60, name: 'item', position: { x: 1.2, y: 64, z: 0.9 } };
        assert.equal(Wt.deathDropAtFeet(bot, new Set())?.id, 60);
        assert.equal(Wt.deathDropAtFeet(bot, new Set([60])), null);
    });

    test('the items of a toss are left for 30 s; items that spawn without a toss are not', async () => {
        const bot = fakeBot();
        Wt.watchDrops(bot);
        const stop = Wt.startTossing(bot);
        bot.emit('entitySpawn', { id: 70, name: 'item', position: { x: 0.5, y: 65.3, z: 0.5 } });
        stop();
        await new Promise(resolve => setTimeout(resolve, 600));
        bot.emit('entitySpawn', { id: 71, name: 'item', position: { x: 0.5, y: 65.3, z: 0.5 } });
        assert.equal(Wt.leftAlone(bot, { id: 70, position: { x: 0.5, y: 64, z: 0.5 } })?.why, 'tossed');
        assert.equal(Wt.leftAlone(bot, { id: 71, position: { x: 0.5, y: 64, z: 0.5 } }), null);
    });

    test('the armour rule: the plugin listener leaves; armour picked up is never put on, crafted armour is', async () => {
        const bot = fakeBot();
        Wt.watchDrops(bot);
        bot.emit('playerCollect', { username: 'claude' }, { getDroppedItem: () => ({ name: 'iron_boots' }) });
        assert.deepEqual(bot.equipped, [], 'the auto-equip of the plugin did not run');
        bot.items = [{ name: 'iron_boots', count: 1 }, { name: 'iron_helmet', count: 1 }];
        await bot.armorManager.equipAll();
        assert.deepEqual(bot.equipped, [['iron_helmet', 'head']], 'only the helmet the bot did not pick up');
    });
});
