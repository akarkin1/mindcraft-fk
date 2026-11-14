// Spec v0.1.4.16 section 8.3 (E7): the pure part of the enchanting pack (enchant_logic.js) and its texts (texts.js): the
// offers line from three offers of the window, the roman numerals, the choice of the order and its matching, the level rule,
// the item of the bag, the words of the enchantments of 26.1, and every text word for word.
//
// The window's values are the probe's of 2026-11-13 on the test server (15 bookshelves, a fresh world's seed): offers
// Unbreaking I (8), Unbreaking II (13), Efficiency IV (30); offer 1 gave a pickaxe with the component
// { enchantments: [{ id: 8, level: 1 }, { id: 40, level: 1 }] }; an item the table cannot enchant keeps cost 0 with id -1.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import minecraftData from 'minecraft-data';
import { TEST_MC_VERSION } from '../helpers/load.js';
import {
    ENCHANT_RULES, ITEM_KINDS, chooseItem, cleanItemRequest, enchantmentWords, enchantsOfItem, hasData, isOfKind, kindOf, levelShort, matchOffer,
    materialRank, offersFrom, parseChoice, parseTake, roman, windowSlotOf,
} from '../../src/agent/packs/enchanting/enchant_logic.js';
import {
    LAPIS, PURPOSE, TEXTS, askLowText, askText, badChoiceText, enchantedText, failedText, itemWords, lapisShortText, levelText, logLine, noItemText, noOfferText,
    noPermitText, noStockText, offerWords, offersText, takeText, tookBackText, tookText, unreachableText, whereText,
} from '../../src/agent/packs/enchanting/texts.js';
import * as PACK from '../../src/agent/packs/enchanting/index.js';
import * as BREEDING_TEXTS from '../../src/agent/packs/breeding/texts.js';

const REG = minecraftData(TEST_MC_VERSION);
const require = createRequire(import.meta.url);

// The probe's window after the pickaxe was put (property 0..2 the costs, 4..6 the ids, 7..9 the levels).
const PROBE_RAW = [
    { level: 8, expected: { enchant: 40, level: 1 } },
    { level: 13, expected: { enchant: 40, level: 2 } },
    { level: 30, expected: { enchant: 8, level: 4 } },
];
const ZERO = () => [0, 1, 2].map(() => ({ level: 0, expected: { enchant: -1, level: -1 } }));
const UNSET = () => [0, 1, 2].map(() => ({ level: -1, expected: { enchant: -1, level: -1 } }));
// The spec's example (8.3), in its order.
const SPEC_OFFERS = [
    { displayName: 'Efficiency', numeral: 'IV', cost: 30, lapis: 3 },
    { displayName: 'Unbreaking', numeral: 'II', cost: 20, lapis: 2 },
    { displayName: 'Fortune', numeral: 'I', cost: 12, lapis: 1 },
];

describe('roman numerals', () => {
    test('the levels of the enchantments', () => {
        assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(roman), ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']);
        assert.equal(roman(14), 'XIV');
        assert.equal(roman(255), 'CCLV');
    });
    test('a level that is no whole number from 1 is written in digits', () => {
        assert.equal(roman(0), '0');
        assert.equal(roman(-1), '-1');
        assert.equal(roman(2.5), '2.5');
    });
});

describe('the offers of the window (the probe of 26.1)', () => {
    test('three offers: the name through registry.enchantments[id], the numeral, the cost, the lapis index + 1', () => {
        const offers = offersFrom(PROBE_RAW, REG);
        assert.deepEqual(offers.map((o) => [o.index, o.name, o.displayName, o.numeral, o.cost, o.lapis]), [
            [0, 'unbreaking', 'Unbreaking', 'I', 8, 1],
            [1, 'unbreaking', 'Unbreaking', 'II', 13, 2],
            [2, 'efficiency', 'Efficiency', 'IV', 30, 3],
        ]);
    });
    test('"no offer" is cost 0 with the id -1 (a stick, an enchanted item); -1 is "no data yet"', () => {
        assert.deepEqual(offersFrom(ZERO(), REG), []);
        assert.deepEqual(offersFrom(UNSET(), REG), []);
        assert.equal(hasData(UNSET()), false);
        assert.equal(hasData(ZERO()), true, 'the costs 0 of the open count as data');
    });
    test('a missing slot is left out, the others keep their number', () => {
        const raw = [{ level: 0, expected: { enchant: -1, level: -1 } }, PROBE_RAW[1], PROBE_RAW[2]];
        const offers = offersFrom(raw, REG);
        assert.deepEqual(offers.map((o) => o.index), [1, 2]);
        assert.equal(offersText('diamond_pickaxe', offers),
            'The table offers for your diamond_pickaxe: 2) Unbreaking II (13 levels, 2 lapis), 3) Efficiency IV (30 levels, 3 lapis). Say "take 1", "take 2", "take 3" or "none".');
    });
    test('an id the registry does not know keeps a name', () => {
        const offers = offersFrom([{ level: 5, expected: { enchant: 99, level: 1 } }], REG);
        assert.equal(offers[0].displayName, 'Enchantment 99');
        assert.equal(offers[0].name, null);
    });
});

describe('the offers line, word for word', () => {
    test('the spec\'s example', () => {
        assert.equal(offersText('diamond_pickaxe', SPEC_OFFERS),
            'The table offers for your diamond_pickaxe: 1) Efficiency IV (30 levels, 3 lapis), 2) Unbreaking II (20 levels, 2 lapis), 3) Fortune I (12 levels, 1 lapis). Say "take 1", "take 2", "take 3" or "none".');
    });
    test('the probe\'s offers', () => {
        assert.equal(offersText('diamond_pickaxe', offersFrom(PROBE_RAW, REG)),
            'The table offers for your diamond_pickaxe: 1) Unbreaking I (8 levels, 1 lapis), 2) Unbreaking II (13 levels, 2 lapis), 3) Efficiency IV (30 levels, 3 lapis). Say "take 1", "take 2", "take 3" or "none".');
    });
    test('a name the table does not offer: "; none of them is <name>." instead of the "Say ..." tail', () => {
        assert.equal(offersText('diamond_pickaxe', SPEC_OFFERS, { notOffered: 'mending' }),
            'The table offers for your diamond_pickaxe: 1) Efficiency IV (30 levels, 3 lapis), 2) Unbreaking II (20 levels, 2 lapis), 3) Fortune I (12 levels, 1 lapis); none of them is mending.');
    });
    test('one offer', () => {
        assert.equal(offerWords(SPEC_OFFERS[0]), 'Efficiency IV (30 levels, 3 lapis)');
    });
});

describe('the choice of the order', () => {
    test('"" asks; 1 to 3 (number or text) takes that offer; another number is no choice; a text is a name', () => {
        assert.deepEqual(parseChoice(''), { kind: 'ask' });
        assert.deepEqual(parseChoice('  '), { kind: 'ask' });
        assert.deepEqual(parseChoice(undefined), { kind: 'ask' });
        assert.deepEqual(parseChoice(2), { kind: 'index', index: 1 });
        assert.deepEqual(parseChoice('3'), { kind: 'index', index: 2 });
        assert.deepEqual(parseChoice('offer 1'), { kind: 'index', index: 0 });
        assert.deepEqual(parseChoice('take 2'), { kind: 'index', index: 1 });
        assert.deepEqual(parseChoice(0), { kind: 'bad', choice: '0' });
        assert.deepEqual(parseChoice('4'), { kind: 'bad', choice: '4' });
        assert.deepEqual(parseChoice('efficiency'), { kind: 'name', name: 'efficiency' });
    });
    test('the answer of !enchantTake: 0 to 3, else none', () => {
        assert.deepEqual([0, 1, 2, 3, '2'].map(parseTake), [0, 1, 2, 3, 2]);
        assert.deepEqual([4, -1, 1.5, 'two', null].map(parseTake), [null, null, null, null, null]);
    });
    test('a name matches the display name case-insensitive: "efficiency" is Efficiency IV', () => {
        const offers = offersFrom(PROBE_RAW, REG);
        assert.equal(matchOffer(offers, 'efficiency').index, 2);
        assert.equal(matchOffer(offers, 'Efficiency').index, 2);
        assert.equal(matchOffer(offers, 'EFFICIENCY IV').index, 2);
        assert.equal(matchOffer(offers, 'minecraft:efficiency').index, 2);
        assert.equal(matchOffer(offers, 'effic').index, 2, 'the start of a name of 4 letters or more');
    });
    test('two offers of one name: the higher level of the enchantment', () => {
        const offers = offersFrom(PROBE_RAW, REG);
        assert.equal(matchOffer(offers, 'unbreaking').index, 1, 'Unbreaking II, not Unbreaking I');
        assert.equal(matchOffer(offers, 'unbreaking i').index, 0, 'with the numeral: that one');
    });
    test('the registry name with an underscore or a space', () => {
        const offers = offersFrom([{ level: 20, expected: { enchant: REG.enchantmentsByName.silk_touch.id, level: 1 } }], REG);
        assert.equal(matchOffer(offers, 'silk_touch').index, 0);
        assert.equal(matchOffer(offers, 'Silk Touch').index, 0);
    });
    test('a name the table does not offer, a short piece of a name: none', () => {
        const offers = offersFrom(PROBE_RAW, REG);
        assert.equal(matchOffer(offers, 'mending'), null);
        assert.equal(matchOffer(offers, 'eff'), null);
        assert.equal(matchOffer(offers, ''), null);
    });
});

describe('the level rule', () => {
    test('below the offer\'s cost: the level line\'s numbers; enough: null', () => {
        const offer = offersFrom(PROBE_RAW, REG)[2];
        assert.deepEqual(levelShort(12, offer), { level: 12, index: 2, cost: 30 });
        assert.equal(levelShort(30, offer), null);
        assert.equal(levelShort(31, offer), null);
        assert.deepEqual(levelShort(undefined, offer), { level: 0, index: 2, cost: 30 });
        assert.equal(levelText(12, 0, 30), 'Level 12, offer 1 needs 30.');
    });
});

describe('the item of the bag', () => {
    const PICK_FRESH = { name: 'diamond_pickaxe', slot: 40 };
    const PICK_DONE = { name: 'diamond_pickaxe', slot: 36, done: true };
    const NETHERITE_DONE = { name: 'netherite_pickaxe', slot: 37, done: true };
    const IRON = { name: 'iron_pickaxe', slot: 38 };
    const AXE = { name: 'diamond_axe', slot: 39 };
    const done = (i) => i.done === true;

    test('the request as mineflayer names items', () => {
        assert.equal(cleanItemRequest('My Diamond Pickaxe'), 'diamond_pickaxe');
        assert.equal(cleanItemRequest('minecraft:diamond_pickaxe'), 'diamond_pickaxe');
        assert.equal(cleanItemRequest('the pickaxe'), 'pickaxe');
        assert.equal(cleanItemRequest('fishing rod'), 'fishing_rod');
        assert.equal(cleanItemRequest(''), null);
        assert.equal(cleanItemRequest(7), null);
    });
    test('the kinds: a pickaxe is no axe', () => {
        assert.equal(kindOf('pickaxe'), 'pickaxe');
        assert.equal(kindOf('diamond_pickaxe'), null);
        assert.ok(isOfKind('diamond_pickaxe', 'pickaxe'));
        assert.ok(!isOfKind('diamond_pickaxe', 'axe'));
        assert.ok(isOfKind('bow', 'bow') && !isOfKind('crossbow', 'bow'));
        assert.ok(ITEM_KINDS.includes('book'));
        assert.ok(materialRank('netherite_sword') < materialRank('diamond_sword') && materialRank('diamond_sword') < materialRank('iron_sword'));
        assert.ok(materialRank('stone_axe') < materialRank('wooden_axe'));
    });
    test('the exact name: an unenchanted one first', () => {
        assert.equal(chooseItem([PICK_DONE, PICK_FRESH, IRON], 'diamond_pickaxe', done), PICK_FRESH);
        assert.equal(chooseItem([PICK_DONE], 'diamond_pickaxe', done), PICK_DONE, 'an enchanted one when it is the only one (the table then offers nothing)');
    });
    test('the kind "pickaxe": the best unenchanted pickaxe, never an axe', () => {
        assert.equal(chooseItem([NETHERITE_DONE, IRON, PICK_FRESH, AXE], 'pickaxe', done), PICK_FRESH);
        assert.equal(chooseItem([IRON, AXE], 'pickaxe', done), IRON);
        assert.equal(chooseItem([AXE], 'pickaxe', done), null);
    });
    test('none: null', () => {
        assert.equal(chooseItem([], 'diamond_pickaxe', done), null);
        assert.equal(chooseItem([{ name: 'diamond_pickaxe', slot: 36, count: 0 }], 'diamond_pickaxe', done), null);
    });
    test('a bag slot in the open window: 9..44 from the window\'s inventoryStart (the probe: bag 37 -> window 30)', () => {
        assert.equal(windowSlotOf(37, 2), 30);
        assert.equal(windowSlotOf(36, 2), 29);
        assert.equal(windowSlotOf(9, 2), 2);
        assert.equal(windowSlotOf(44, 2), 37);
        assert.equal(windowSlotOf(45, 2), null, 'the off hand is not in the window');
        assert.equal(windowSlotOf(undefined, 2), null);
    });
});

describe('the enchantments of an item on 26.1', () => {
    const COMPONENT = { enchantments: [{ id: 8, level: 1 }, { id: 40, level: 1 }] };
    test('the component through the registry, in the order the item has them', () => {
        assert.deepEqual(enchantsOfItem({ enchants: COMPONENT }, REG), [{ name: 'efficiency', lvl: 1 }, { name: 'unbreaking', lvl: 1 }]);
        assert.deepEqual(enchantmentWords(enchantsOfItem({ enchants: COMPONENT }, REG), REG), ['Efficiency I', 'Unbreaking I']);
    });
    test('the F7 reader of the patched digging plugin gives the same', () => {
        const digging = require('mineflayer/lib/plugins/digging.js');
        assert.equal(typeof digging.enchantsOf, 'function', 'the patch of F7 is applied (npm install)');
        assert.deepEqual(enchantsOfItem({ enchants: COMPONENT }, REG, digging.enchantsOf), [{ name: 'efficiency', lvl: 1 }, { name: 'unbreaking', lvl: 1 }]);
    });
    test('the old array form as it is; nothing, a throwing getter: none', () => {
        assert.deepEqual(enchantsOfItem({ enchants: [{ name: 'sharpness', lvl: 2 }] }, REG), [{ name: 'sharpness', lvl: 2 }]);
        assert.deepEqual(enchantsOfItem({ enchants: [] }, REG), []);
        assert.deepEqual(enchantsOfItem(null, REG), []);
        assert.deepEqual(enchantsOfItem({ get enchants() { throw new Error('broken'); } }, REG), []);
        assert.deepEqual(enchantsOfItem({ enchants: COMPONENT }, REG, () => { throw new Error('broken reader'); }), [{ name: 'efficiency', lvl: 1 }, { name: 'unbreaking', lvl: 1 }]);
    });
    test('a name the registry does not know stays as it is', () => {
        assert.deepEqual(enchantmentWords([{ name: 'minecraft:made_up', lvl: 2 }, { name: null, lvl: 1 }], REG), ['made_up II', 'an enchantment I']);
    });
});

describe('the texts, word for word', () => {
    test('the fixed texts', () => {
        assert.equal(TEXTS.noTable, 'No enchanting table within 32 blocks.');
        assert.equal(TEXTS.offersTail, 'Say "take 1", "take 2", "take 3" or "none".');
        assert.equal(TEXTS.noQuestion, 'There is no enchanting question to answer.');
        assert.equal(TEXTS.badTake, 'Say 1, 2 or 3 to take an offer of the table, or 0 to take the item back.');
        assert.ok(Object.isFrozen(TEXTS));
        assert.equal(LAPIS, 'lapis_lazuli');
        assert.equal(PURPOSE, 'the enchanting');
    });
    test('the spec\'s texts of 8.3', () => {
        assert.equal(noItemText('diamond_pickaxe'), 'I have no diamond_pickaxe.');
        assert.equal(noOfferText('diamond_pickaxe'), 'The table offers nothing for this diamond_pickaxe.');
        assert.equal(tookBackText('diamond_pickaxe'), 'I took the diamond_pickaxe back; say "enchant my pickaxe" again when you have chosen.');
        assert.equal(levelText(12, 0, 30), 'Level 12, offer 1 needs 30.');
        assert.equal(enchantedText('diamond_pickaxe', ['Efficiency IV'], 30, 3), 'I enchanted your diamond_pickaxe: Efficiency IV (30 levels, 3 lapis).');
    });
    test('the enchanted line names every enchantment of the result (the lead\'s rule): the probe\'s pickaxe', () => {
        assert.equal(enchantedText('diamond_pickaxe', ['Efficiency I', 'Unbreaking I'], 8, 1), 'I enchanted your diamond_pickaxe: Efficiency I, Unbreaking I (8 levels, 1 lapis).');
    });
    test('the item words of the took-back line', () => {
        assert.equal(itemWords('diamond_pickaxe'), 'pickaxe');
        assert.equal(itemWords('iron_axe'), 'axe');
        assert.equal(itemWords('netherite_chestplate'), 'chestplate');
        assert.equal(itemWords('fishing_rod'), 'fishing rod');
        assert.equal(itemWords('bow'), 'bow');
        assert.equal(tookBackText('bow'), 'I took the bow back; say "enchant my bow" again when you have chosen.');
    });
    test('the pack\'s own texts', () => {
        assert.equal(badChoiceText('5'), 'I take offer 1, 2 or 3, or an enchantment by its name, not "5".');
        assert.equal(unreachableText({ x: 3.5, y: 64, z: -2.2 }), 'I cannot reach the enchanting table at (3, 64, -3).');
        assert.equal(failedText('diamond_pickaxe', 'the table did not answer.'), 'I could not enchant the diamond_pickaxe: the table did not answer.');
        assert.equal(takeText(2), 'I take offer 2.');
        assert.equal(takeText(0), 'I take the item back.');
        assert.equal(whereText({ x: -14.5, y: 63, z: 28.9 }), '(-15, 63, 28)');
        assert.equal(logLine('no_table', { x: 1.2, y: 64, z: 2 }, 'table', TEXTS.noTable), 'Enchanting no_table at (1, 64, 2), step table: No enchanting table within 32 blocks.');
        assert.equal(logLine('no_table', null, 'table', TEXTS.noTable), 'Enchanting no_table, step table: No enchanting table within 32 blocks.');
        // v0.1.4.16 fix round (V-12): the lapis slot short of the chosen offer
        assert.equal(lapisShortText(2, 2), 'Only 2 lapis are on the table; offer 3 needs 3.');
        assert.equal(lapisShortText(1, 1), 'Only 1 lapis is on the table; offer 2 needs 2.');
        assert.equal(PACK.lapisShortText, lapisShortText);
    });
    test('the asking texts of 8.1 are the breeding pack\'s, word for word and argument for argument', () => {
        const chest = { x: 11, y: 67, z: 53 };
        assert.equal(askText(3, LAPIS, chest, PURPOSE), 'May I take 3 lapis_lazuli from the chest at (11, 67, 53) for the enchanting? Say yes or no.');
        assert.equal(askLowText(6, 3, LAPIS, PURPOSE), 'Only 6 lapis_lazuli are left in the chests; may I take 3 for the enchanting? Say yes or no.');
        assert.equal(tookText(3, LAPIS, chest), 'I took 3 lapis_lazuli from the chest at (11, 67, 53).');
        assert.equal(noPermitText(LAPIS), 'I take no lapis_lazuli without your word; say "you may take lapis_lazuli" when you want.');
        assert.equal(noStockText(LAPIS), 'I have no lapis_lazuli and the chests have none.');
        for (const [mine, theirs, args] of [
            [askText, BREEDING_TEXTS.askText, [3, LAPIS, chest, PURPOSE]],
            [askLowText, BREEDING_TEXTS.askLowText, [6, 3, LAPIS, PURPOSE]],
            [askLowText, BREEDING_TEXTS.askLowText, [1, 3, LAPIS, PURPOSE]],
            [tookText, BREEDING_TEXTS.tookText, [3, LAPIS, chest]],
            [noPermitText, BREEDING_TEXTS.noPermitText, [LAPIS]],
            [noStockText, BREEDING_TEXTS.noStockText, [LAPIS]],
        ]) {
            assert.equal(mine(...args), theirs(...args), mine.name);
        }
        assert.equal(BREEDING_TEXTS.PURPOSES.enchanting, PURPOSE);
    });
});

describe('the pack\'s index', () => {
    test('re-exports the logic, the texts and the work', () => {
        for (const name of ['enchant', 'enchantTake', 'questionWaits', 'offersFrom', 'matchOffer', 'roman', 'offersText', 'enchantedText', 'TEXTS', 'ENCHANT_RULES']) {
            assert.ok(name in PACK, name);
        }
        assert.equal(PACK.offersText, offersText);
        assert.equal(ENCHANT_RULES.tableRange, 32);
        assert.equal(ENCHANT_RULES.askMs, 60000);
        assert.equal(ENCHANT_RULES.lapis, 3);
        assert.equal(ENCHANT_RULES.lapisLow, 6);
        assert.ok(Object.isFrozen(ENCHANT_RULES));
    });
});
