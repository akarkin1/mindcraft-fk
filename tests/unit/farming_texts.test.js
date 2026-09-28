// Spec v0.1.4.7 F2: the texts of the farming pack, word for word where the spec gives them.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    TEXTS, boneMealText, countList, cycleText, fertilizeText, gateOpenText, harvestText, noPlantsToFertilizeText, noSeedsText,
    nothingGrowsText, nothingRipeText, nothingToPlantText, plantText, unknownFarmText, unknownSeedText, unreachedText, whereText,
} from '../../src/agent/packs/farming/texts.js';

describe('fixed texts', () => {
    test('as in the spec', () => {
        assert.equal(TEXTS.noFarm, 'I know no farm here. Stand in the farm and tell me that this is the farm.');
        assert.equal(TEXTS.noComposter, 'I found no composter within 32 blocks.');
        assert.equal(TEXTS.nothingToCompost, 'I found nothing to compost. I do not use seeds for that.');
        assert.equal(TEXTS.noBoneMeal, 'I have no bone_meal.');
        assert.equal(TEXTS.noHoe, 'I have no hoe, so I planted only where the ground was farmland.');
        assert.equal(TEXTS.gateClosed, 'The gate is closed.');
        assert.equal(TEXTS.noShears, 'I have no shears, so I can only collect flowers and saplings.', 'Amendment 2, I3');
        assert.ok(Object.isFrozen(TEXTS));
    });
});

describe('countList', () => {
    test('sorted by count, then by name, at most 6 kinds', () => {
        assert.equal(countList({ wheat: 9 }), '9 wheat');
        assert.equal(countList({ carrots: 3, wheat: 9, beetroots: 3 }), '9 wheat, 3 beetroots, 3 carrots');
        const many = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
        assert.equal(countList(many), '8 h, 7 g, 6 f, 5 e, 4 d, 3 c and 2 more kinds');
        assert.equal(countList({ a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1 }), '1 a, 1 b, 1 c, 1 d, 1 e, 1 f and 1 more kinds');
        assert.equal(countList({ a: 0, b: 2 }), '2 b', 'zero counts are left out');
        assert.equal(countList(null), '');
    });

    test('whereText gives block coordinates', () => {
        assert.equal(whereText({ x: -13.7, y: 63, z: 28.2 }), '(-14, 63, 28)');
    });
});

describe('harvest texts', () => {
    test('the example of the spec', () => {
        assert.equal(harvestText({ byCrop: { wheat: 9 }, replanted: 9, unripe: 6 }),
            'I harvested 9 wheat and planted 9 again. 6 plants are not ripe yet.');
    });

    test('all ripe, several crops, one unripe', () => {
        assert.equal(harvestText({ byCrop: { wheat: 4 }, replanted: 4, unripe: 0 }), 'I harvested 4 wheat and planted 4 again.');
        assert.equal(harvestText({ byCrop: { carrots: 2, wheat: 5 }, replanted: 7, unripe: 1 }),
            'I harvested 5 wheat, 2 carrots and planted 7 again. 1 plant is not ripe yet.');
    });

    test('places left empty and ripe plants left by the limit', () => {
        assert.equal(harvestText({ byCrop: { wheat: 9 }, replanted: 7, unripe: 6, unplanted: 2 }),
            'I harvested 9 wheat and planted 7 again. 2 places stay empty, I have no more seeds. 6 plants are not ripe yet.');
        assert.equal(harvestText({ byCrop: { wheat: 1 }, replanted: 0, unripe: 0, unplanted: 1 }),
            'I harvested 1 wheat and planted 0 again. 1 place stays empty, I have no more seeds.');
        assert.equal(harvestText({ byCrop: { wheat: 5 }, replanted: 5, unripe: 0, ripeLeft: 4 }),
            'I harvested 5 wheat and planted 5 again. 4 ripe plants are left.');
        assert.equal(harvestText({ byCrop: { wheat: 5 }, replanted: 5, unripe: 0, ripeLeft: 1 }),
            'I harvested 5 wheat and planted 5 again. 1 ripe plant is left.');
    });

    test('plants out of reach and a gate that stays open', () => {
        assert.equal(unreachedText(3), 'I could not reach 3 ripe plants.');
        assert.equal(unreachedText(1), 'I could not reach 1 ripe plant.');
        assert.equal(gateOpenText({ x: 0, y: 64, z: 5 }), 'The gate at (0, 64, 5) is open.');
    });

    test('nothing ripe and nothing growing', () => {
        assert.equal(nothingRipeText(15), 'Nothing is ripe yet. 15 plants are growing.');
        assert.equal(nothingRipeText(1), 'Nothing is ripe yet. 1 plant is growing.');
        assert.equal(nothingGrowsText('wheat_farm'), 'Nothing grows in the farm "wheat_farm". I can plant if I get seeds.');
        assert.equal(nothingGrowsText(null), 'Nothing grows in this farm. I can plant if I get seeds.');
    });
});

describe('plant texts', () => {
    test('the examples of the spec', () => {
        assert.equal(plantText({ planted: 12, seed: 'wheat_seeds', emptyNoSeeds: 3 }),
            'I planted 12 wheat_seeds. 3 places stay empty, I have no more seeds.');
        assert.equal(noSeedsText('wheat_seeds'), 'I have no wheat_seeds and know no chest with them.');
        assert.equal(plantText({ planted: 4, seed: 'wheat_seeds', noHoe: true }),
            'I planted 4 wheat_seeds. I have no hoe, so I planted only where the ground was farmland.');
        assert.equal(plantText({ planted: 12, seed: 'wheat_seeds', emptyNoSeeds: 3, noHoe: true }),
            'I planted 12 wheat_seeds. 3 places stay empty, I have no more seeds. I have no hoe, so I planted only where the ground was farmland.');
    });

    test('everything planted, one place, places out of reach', () => {
        assert.equal(plantText({ planted: 10, seed: 'carrot' }), 'I planted 10 carrot.');
        assert.equal(plantText({ planted: 3, seed: 'potato', emptyNoSeeds: 1, emptyUnreached: 2 }),
            'I planted 3 potato. 1 place stays empty, I have no more seeds. 2 places stay empty, I could not reach them.');
    });

    test('nothing to plant and unknown seeds', () => {
        assert.equal(nothingToPlantText('wheat_farm'), 'Every place in the farm "wheat_farm" is planted already.');
        assert.equal(nothingToPlantText(''), 'Every place in this farm is planted already.');
        assert.equal(unknownSeedText('melon_seeds'), 'I cannot plant melon_seeds. I can plant wheat_seeds, carrot, potato and beetroot_seeds.');
    });
});

describe('bone meal texts', () => {
    test('the examples of the spec', () => {
        assert.equal(boneMealText(2, 15), 'I made 2 bone_meal from 15 items.');
        assert.equal(fertilizeText(6, 4), 'I used 6 bone_meal. 4 plants are ripe now.');
    });

    test('short of the wish, one plant, none ripe', () => {
        assert.equal(boneMealText(1, 64, 'limit'), 'I made 1 bone_meal from 64 items. I stop after 64 items.');
        assert.equal(boneMealText(0, 5, 'no_items', 3), 'I made 0 bone_meal from 5 items. The composter is at level 3 of 7, I have nothing more to compost.');
        assert.equal(boneMealText(0, 0, 'error'), 'I made 0 bone_meal from 0 items.');
        assert.equal(fertilizeText(1, 1), 'I used 1 bone_meal. 1 plant is ripe now.');
        assert.equal(fertilizeText(2, 0), 'I used 2 bone_meal. No plant is ripe yet.');
        assert.equal(noPlantsToFertilizeText(5), 'No plant needs bone_meal. 5 plants are ripe.');
        assert.equal(noPlantsToFertilizeText(1), 'No plant needs bone_meal. 1 plant is ripe.');
        assert.equal(noPlantsToFertilizeText(0), 'No plant needs bone_meal.');
    });
});

describe('farm texts', () => {
    test('the cycle joins its parts behind the name of the farm', () => {
        assert.equal(cycleText('wheat_farm', ['I harvested 9 wheat and planted 9 again. 6 plants are not ripe yet.',
            'I stored 9 wheat in the chest at (-13, 63, 28).', null, '', TEXTS.gateClosed]),
        'Farm "wheat_farm": I harvested 9 wheat and planted 9 again. 6 plants are not ripe yet. I stored 9 wheat in the chest at (-13, 63, 28). The gate is closed.');
        assert.equal(cycleText(null, ['Nothing is ripe yet. 2 plants are growing.']), 'Farm: Nothing is ripe yet. 2 plants are growing.');
    });

    test('an unknown farm name lists the farms that are known', () => {
        assert.equal(unknownFarmText('wheat', ['farm_a', 'farm_b']), 'I know no farm "wheat". I know the farms "farm_a", "farm_b".');
        assert.equal(unknownFarmText('wheat', []), `I know no farm "wheat". ${TEXTS.noFarm}`);
        const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
        assert.equal(unknownFarmText('x', names), 'I know no farm "x". I know the farms "a", "b", "c", "d", "e", "f" and 2 more.');
    });
});
