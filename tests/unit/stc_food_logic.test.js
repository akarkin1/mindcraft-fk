// Spec v0.1.4.8, part C (C1, C2, I7): the pure food logic of the home pack -- food_logic.js and the
// food texts of texts.js. Every row of the table of C2, the texts word for word.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadSrc } from '../helpers/load.js';

const F = await loadSrc('src/agent/packs/home/food_logic.js');
const T = await loadSrc('src/agent/packs/home/texts.js');
const H = await loadSrc('src/agent/packs/home/home_settings.js');

const require = createRequire(import.meta.url);
const FOOD_LIST = require('minecraft-data/minecraft-data/data/pc/1.21.8/foods.json');
const FOODS = Object.fromEntries(FOOD_LIST.map(f => [f.name, f]));

const MIN = 60 * 1000;
const KNOWN = [{ name: 'bread', count: 5, chest: { x: 11, y: 67, z: 53 } }];

// the input of hungerDecision, with a bot that carries nothing, food 20, unhurt, idle
function input(over = {}) {
    return { food: 20, health: 20, carries: false, known: [], idle: true, playerOrder: false, lastSaid: null, now: 10 * MIN, ...over };
}
const decide = (over) => F.hungerDecision(input(over));

describe('C2: hungerDecision, row 1: carries food, and food <= 14, or food <= 17 and health < 20: eat', () => {
    test('food 14 and lower: eat, whatever the health', () => {
        for (const food of [14, 10, 3, 0]) {
            assert.equal(decide({ carries: true, food }).action, 'eat', `food ${food}`);
        }
        assert.equal(decide({ carries: true, food: 14, health: 20 }).reason, 'hungry');
    });

    test('food 15 to 17: eat only while hurt', () => {
        for (const food of [15, 16, 17]) {
            assert.equal(decide({ carries: true, food, health: 19.5 }).action, 'eat', `food ${food}, hurt`);
            assert.equal(decide({ carries: true, food, health: 19.5 }).reason, 'hurt');
            assert.equal(decide({ carries: true, food, health: 20 }).action, 'none', `food ${food}, unhurt`);
        }
    });

    test('food 18 and more: no eating, also when hurt', () => {
        assert.equal(decide({ carries: true, food: 18, health: 5 }).action, 'none');
        assert.equal(decide({ carries: true, food: 20, health: 5 }).action, 'none');
    });

    test('eating does not depend on idle, on an order of the player or on known chests', () => {
        assert.equal(decide({ carries: true, food: 12, idle: false, playerOrder: true }).action, 'eat');
        assert.equal(decide({ carries: true, food: 12, known: KNOWN }).action, 'eat');
    });
});

describe('C2: hungerDecision, row 2: carries none, food <= 10, idle, known not empty: fetch', () => {
    test('food 10 and 4: fetch while idle', () => {
        for (const food of [10, 7, 4]) {
            const d = decide({ food, known: KNOWN, idle: true });
            assert.deepEqual({ action: d.action, text: d.text }, { action: 'fetch', text: null }, `food ${food}`);
        }
    });

    test('food 11: nothing yet', () => {
        assert.equal(decide({ food: 11, known: KNOWN, idle: true }).action, 'none');
    });
});

describe('C2: hungerDecision, row 3: carries none, food <= 10, not idle or nothing known: say, once per 5 minutes', () => {
    const HUNGRY = 'I am hungry and carry no food. Food 6 of 20.';

    test('not idle, food known: the text', () => {
        const d = decide({ food: 6, known: KNOWN, idle: false, playerOrder: true });
        assert.deepEqual({ action: d.action, text: d.text, kind: d.kind }, { action: 'say', text: HUNGRY, kind: 'hungry' });
    });

    test('idle, nothing known: the text', () => {
        assert.equal(decide({ food: 6, known: [], idle: true }).text, HUNGRY);
        assert.equal(decide({ food: 10, known: [] }).text, 'I am hungry and carry no food. Food 10 of 20.');
    });

    test('not idle, no order of the player, food 4 to 10: the text, no fetch (only food <= 3 fetches while busy)', () => {
        assert.equal(decide({ food: 4, known: KNOWN, idle: false, playerOrder: false }).action, 'say');
    });

    test('once per 5 minutes', () => {
        const now = 100 * MIN;
        assert.equal(decide({ food: 6, now, lastSaid: { hungry: now - 4 * MIN } }).action, 'none');
        assert.equal(decide({ food: 6, now, lastSaid: { hungry: now - 4 * MIN } }).reason, 'said_recently');
        assert.equal(decide({ food: 6, now, lastSaid: { hungry: now - 5 * MIN } }).action, 'say');
        assert.equal(decide({ food: 6, now, lastSaid: { starving: now - 1000 } }).action, 'say', 'the other text does not count');
        assert.equal(decide({ food: 6, now, lastSaid: now - 1000 }).action, 'none', 'a number counts for both texts');
    });
});

describe('C2: hungerDecision, row 4: carries none, food <= 3, no order of the player, known not empty: fetch, also when busy', () => {
    test('busy without an order of the player: fetch', () => {
        for (const food of [3, 1, 0]) {
            const d = decide({ food, known: KNOWN, idle: false, playerOrder: false });
            assert.equal(d.action, 'fetch', `food ${food}`);
            assert.equal(d.reason, 'starving');
        }
    });

    test('an order of the player runs: no fetch, the text of hunger', () => {
        const d = decide({ food: 2, known: KNOWN, idle: false, playerOrder: true });
        assert.deepEqual({ action: d.action, text: d.text }, { action: 'say', text: 'I am hungry and carry no food. Food 2 of 20.' });
    });

    test('idle: fetch', () => {
        assert.equal(decide({ food: 2, known: KNOWN, idle: true }).action, 'fetch');
    });
});

describe('C2: hungerDecision, row 5: carries none, food <= 3, nothing known: say, once per 2 minutes', () => {
    const STARVING = 'I am starving. I have no food and know no chest with food.';

    test('the text, idle or busy, with or without an order', () => {
        for (const over of [{ idle: true }, { idle: false }, { idle: false, playerOrder: true }]) {
            const d = decide({ food: 3, known: [], ...over });
            assert.deepEqual({ action: d.action, text: d.text, kind: d.kind }, { action: 'say', text: STARVING, kind: 'starving' });
        }
    });

    test('once per 2 minutes', () => {
        const now = 100 * MIN;
        assert.equal(decide({ food: 0, now, lastSaid: { starving: now - 119 * 1000 } }).action, 'none');
        assert.equal(decide({ food: 0, now, lastSaid: { starving: now - 2 * MIN } }).text, STARVING);
        assert.equal(decide({ food: 0, now, lastSaid: { hungry: now - 1000 } }).text, STARVING, 'the text of hunger does not count');
    });
});

describe('C2: hungerDecision, other inputs', () => {
    test('a fetch that brought nothing during the last 60 s: no fetch, the text of hunger instead', () => {
        const now = 100 * MIN;
        assert.equal(decide({ food: 6, known: KNOWN, now, fetchFailedAt: now - 59 * 1000 }).action, 'say');
        assert.equal(decide({ food: 2, known: KNOWN, idle: false, now, fetchFailedAt: now - 1000 }).text, 'I am hungry and carry no food. Food 2 of 20.',
            'food is known, so the text never says that none is known');
        assert.equal(decide({ food: 6, known: KNOWN, now, fetchFailedAt: now - 60 * 1000 }).action, 'fetch');
    });

    test('bad input: none, no throw', () => {
        for (const bad of [null, undefined, 'x', {}, { food: 'x' }, { food: NaN }]) {
            assert.equal(F.hungerDecision(bad).action, 'none');
        }
        assert.equal(F.HUNGER_RULES.eatAt, 14);
        assert.equal(F.HUNGER_RULES.eatHurtAt, 17);
        assert.equal(F.HUNGER_RULES.fetchAt, 10);
        assert.equal(F.HUNGER_RULES.starvingAt, 3);
    });
});

describe('C1: how far the bot eats', () => {
    test('eatTarget: 18, and 20 while health is below 20', () => {
        assert.equal(F.eatTarget(20), 18);
        assert.equal(F.eatTarget(19.5), 20);
        assert.equal(F.eatTarget(1), 20);
        assert.equal(F.eatTarget(undefined), 18);
    });

    test('wantsFood', () => {
        assert.equal(F.wantsFood(17, 20), true);
        assert.equal(F.wantsFood(18, 20), false);
        assert.equal(F.wantsFood(19, 12), true);
        assert.equal(F.wantsFood(20, 12), false, 'a full bot cannot eat');
        assert.equal(F.wantsFood(undefined, 12), false);
    });
});

describe('C1: auto-eat keeps the food in the main hand', () => {
    test('autoEatOptions: offhand false, also when the plugin says true', () => {
        assert.equal(F.autoEatOptions({ offhand: true }).offhand, false);
        assert.equal(F.autoEatOptions(undefined).offhand, false);
        assert.equal(F.AUTO_EAT_DEFAULTS.offhand, false);
        assert.equal(F.autoEatOptions({ offhand: true }).equipOldItem, true, 'the old item comes back into the hand');
    });
});

describe('I7: the food of the known chests', () => {
    const chests = [
        { x: 11, y: 67, z: 53, items: { rotten_flesh: 12, spider_eye: 3, cobblestone: 81 } },
        { x: 0, y: 64, z: 0, items: { apple: 5, bread: 2, dirt: 3 } },
        { x: 30, y: 64, z: 0, items: { cooked_beef: 9 } },
        { x: 'a', items: { bread: 1 } },
        { x: 5, y: 64, z: 5 },
    ];

    test('banned food and no food are left out; the nearest chest first, the most food points first within it', () => {
        const list = F.listKnownFood(chests, { foods: FOODS, from: { x: 1, y: 64, z: 1 } });
        assert.deepEqual(list, [
            { name: 'bread', count: 2, chest: { x: 0, y: 64, z: 0 } },
            { name: 'apple', count: 5, chest: { x: 0, y: 64, z: 0 } },
            { name: 'cooked_beef', count: 9, chest: { x: 30, y: 64, z: 0 } },
        ]);
    });

    test('only rotten flesh and spider eyes (the play test): nothing', () => {
        assert.deepEqual(F.listKnownFood([chests[0]], { foods: FOODS }), []);
    });

    test('without the registry: the foods of 1.21.8; without a position: the largest count first', () => {
        assert.deepEqual(F.listKnownFood(chests).map(k => k.name), ['cooked_beef', 'apple', 'bread']);
        assert.equal(F.VANILLA_FOODS.bread.foodPoints, 5);
        assert.deepEqual(Object.keys(F.VANILLA_FOODS).sort(), Object.keys(FOODS).sort());
        assert.deepEqual(F.listKnownFood(null), []);
    });

    test('chooseKnownFood: the most food points, then the count of all chests', () => {
        const known = F.listKnownFood(chests, { foods: FOODS });
        assert.equal(F.chooseKnownFood(known, FOODS), 'cooked_beef');
        assert.equal(F.chooseKnownFood([{ name: 'apple', count: 1 }, { name: 'carrot', count: 3 }, { name: 'apple', count: 3 }], FOODS), 'apple');
        assert.equal(F.chooseKnownFood([{ name: 'rotten_flesh', count: 9 }], FOODS), null);
        assert.equal(F.chooseKnownFood(null), null);
    });
});

describe('C1, C2, C6: the texts, word for word', () => {
    test('!eat', () => {
        assert.equal(T.ateStatusText({ bread: 2 }, 19, 12), 'I ate 2 bread. Food 19 of 20, health 12 of 20.');
        assert.equal(T.notHungryText(19, 20), 'I am not hungry. Food 19 of 20, health 20 of 20.');
        assert.equal(T.noFoodText([{ name: 'apple', count: 5, chest: { x: 11, y: 67, z: 53 } }]), 'I carry no food. The chest at (11, 67, 53) has 5 apple.');
        assert.equal(T.noFoodText([]), 'I carry no food and know no chest with food.');
        assert.equal(T.TEXTS.noFoodNoChest, 'I carry no food and know no chest with food.');
    });

    test('the food of the first chest only, all of its kinds', () => {
        const known = [
            { name: 'bread', count: 2, chest: { x: 0, y: 64, z: 0 } },
            { name: 'apple', count: 5, chest: { x: 0, y: 64, z: 0 } },
            { name: 'cooked_beef', count: 9, chest: { x: 30, y: 64, z: 0 } },
        ];
        assert.equal(T.noFoodText(known), 'I carry no food. The chest at (0, 64, 0) has 2 bread and 5 apple.');
    });

    test('health: a fraction is rounded down, a hurt bot never reads 20', () => {
        assert.equal(T.statusText(19, 19.6), 'Food 19 of 20, health 19 of 20.');
        assert.equal(T.statusText(19, 0.4), 'Food 19 of 20, health 1 of 20.');
        assert.equal(T.statusText(19, 20), 'Food 19 of 20, health 20 of 20.');
        assert.equal(T.statusText(19, undefined), 'Food 19 of 20.');
    });

    test('the hunger reflex', () => {
        assert.equal(T.hungryText(6), 'I am hungry and carry no food. Food 6 of 20.');
        assert.equal(T.TEXTS.starving, 'I am starving. I have no food and know no chest with food.');
    });

    test('sleep by day, the home', () => {
        assert.equal(T.dayText(5), 'I cannot sleep now, it is day. The night starts in about 5 minutes.');
        assert.equal(T.dayText(0.4), 'I cannot sleep now, it is day. The night starts in about 1 minute.');
        assert.equal(T.TEXTS.noHome, 'I know no home. Tell me where home is.');
    });
});

describe('the switch home_reflexes.hunger', () => {
    test('default true, part of home_pack', () => {
        assert.equal(H.reflexOn({ home_pack: true }, 'hunger'), true);
        assert.equal(H.reflexOn({ home_pack: true, home_reflexes: { hunger: false } }, 'hunger'), false);
        assert.equal(H.reflexOn({ home_pack: false }, 'hunger'), false);
        assert.equal(H.HOME_REFLEX_DEFAULTS.hunger, true);
    });
});
