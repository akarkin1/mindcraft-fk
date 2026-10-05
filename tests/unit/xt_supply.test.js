// Tests from the spec (v0.1.4.13, section 6, T1): the supply step of part P (SPEC 4.4, P1) from a chest fixture.
// The chests within 16 blocks of the bot are read for the missing items first, then the chests the index knows,
// nearest first; what no chest gives is left for the craft and the surface. The text names where it goes:
// `I get my supplies: 10 bread from the chest at (15, -59, -99).` The second pickaxe: wanted only when the one in
// hand has fewer than 50 uses left (the handoff: only with exactly one usable pickaxe under 50 uses); the lead's
// decision of 0c5e823: the spare in the supply text is `a second pickaxe`, without a material.
// The missing list is the one of tripNeeds (its names: food, torch, pickaxe, ...). A failing test is a finding.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { SPARE_PICKAXE_USES, SUPPLY_NEAR_RANGE, applySpareRule, supplyPlan } from '../../src/agent/packs/mining/supply_logic.js';
import { suppliesText } from '../../src/agent/packs/mining/texts.js';
import { tripNeeds } from '../../src/agent/packs/mining/mine_logic.js';

const FOODS = ['bread', 'cooked_beef', 'baked_potato'];
const BOT = { x: 31, y: -59, z: -99 };

/** The missing list of tripNeeds for a bot that carries everything but food: one entry, the food. */
function missingFood(count) {
    const inventory = [{ name: 'torch', count: 16 }, { name: 'cobblestone', count: 32 }, { name: 'iron_pickaxe', count: 1, uses_left: 200 }];
    const needs = tripNeeds('iron', 64, 16, inventory, { foods: FOODS, shaftExists: true, wayDownTo: 16, hasBase: true });
    assert.equal(needs.missing.length, 1, `the fixture misses only food: ${JSON.stringify(needs.missing)}`);
    return [{ ...needs.missing[0], count }];
}

const chest = (x, y, z, items) => ({ x, y, z, items });
const at = (c) => `${c.x},${c.y},${c.z}`;
const total = (takes, name) => takes.reduce((s, t) => s + (t.items[name] ?? 0), 0);

describe('SPEC 4.4 P1: the order of the chests', () => {
    test('the constants of the spec: 16 blocks, 50 uses', () => {
        assert.equal(SUPPLY_NEAR_RANGE, 16);
        assert.equal(SPARE_PICKAXE_USES, 50);
    });

    test('the chests within 16 blocks first, then the others nearest first', () => {
        const chests = [
            chest(31, -59, -130, { bread: 20 }), // 31 blocks
            chest(20, -59, -99, { bread: 4 }), // 11 blocks
            chest(31, -59, -120, { bread: 2 }), // 21 blocks
            chest(28, -59, -99, { bread: 3 }), // 3 blocks
        ];
        const plan = supplyPlan({ missing: missingFood(10), from: BOT, chests, foods: FOODS });
        const order = plan.takes.map((t) => at(t.chest));
        assert.deepEqual(order.slice(0, 2).sort(), ['20,-59,-99', '28,-59,-99'].sort(), 'the two chests within 16 come first');
        assert.deepEqual(order.slice(2), ['31,-59,-120', '31,-59,-130'], 'then the others, nearest first');
        assert.deepEqual(plan.takes.map((t) => t.near), [true, true, false, false]);
        assert.equal(total(plan.takes, 'bread'), 10, 'what is missing, no more');
        assert.equal(plan.takes[3].items.bread, 1);
        assert.deepEqual(plan.rest, []);
    });

    test('a chest within 16 that holds it all: no other chest is read', () => {
        const chests = [chest(31, -59, -120, { bread: 64 }), chest(25, -59, -99, { bread: 30 })];
        const plan = supplyPlan({ missing: missingFood(10), from: BOT, chests, foods: FOODS });
        assert.equal(plan.takes.length, 1);
        assert.equal(at(plan.takes[0].chest), '25,-59,-99');
        assert.equal(plan.takes[0].near, true);
        assert.deepEqual(plan.takes[0].items, { bread: 10 });
    });

    test('a nearer chest beyond 16 comes after every chest within 16', () => {
        const chests = [chest(31, -59, -116, { bread: 10 }), chest(31, -59, -84, { bread: 10 })]; // 17 and 15 blocks
        const plan = supplyPlan({ missing: missingFood(10), from: BOT, chests, foods: FOODS });
        assert.equal(at(plan.takes[0].chest), '31,-59,-84');
        assert.equal(plan.takes.length, 1);
    });

    test('food is any edible item', () => {
        const chests = [chest(28, -59, -99, { cooked_beef: 6, cobblestone: 64 })];
        const plan = supplyPlan({ missing: missingFood(6), from: BOT, chests, foods: FOODS });
        assert.deepEqual(plan.takes.map((t) => t.items), [{ cooked_beef: 6 }]);
    });

    test('what no chest gives is the rest, for the craft and the surface', () => {
        const missing = tripNeeds('iron', 64, 16, [{ name: 'cobblestone', count: 32 }, { name: 'iron_pickaxe', count: 1, uses_left: 200 }], { foods: FOODS, shaftExists: true, wayDownTo: 16, hasBase: true }).missing;
        const chests = [chest(28, -59, -99, { bread: 20 })];
        const plan = supplyPlan({ missing, from: BOT, chests, foods: FOODS });
        assert.equal(total(plan.takes, 'bread') > 0, true);
        assert.ok(plan.rest.some((m) => m.name === 'torch'), `the torches stay: ${JSON.stringify(plan.rest)}`);
        assert.ok(!plan.rest.some((m) => m.name === 'food'), `the food came from the chest: ${JSON.stringify(plan.rest)}`);
    });
});

describe('SPEC 4.4 P1: the text names where it goes', () => {
    test('the example of the spec, word for word', () => {
        const missing = missingFood(10);
        const plan = supplyPlan({ missing, from: { x: 16, y: -59, z: -103 }, chests: [chest(15, -59, -99, { bread: 20 })], foods: FOODS });
        assert.equal(suppliesText(missing, plan.takes), 'I get my supplies: 10 bread from the chest at (15, -59, -99).');
    });
});

describe('SPEC 4.4 P1: the second pickaxe', () => {
    const IRON = (uses) => ({ name: 'iron_pickaxe', material: 'iron', uses });

    test('the one in hand with 49 uses and none in the bag: a spare is wanted, "a second pickaxe" without a material', () => {
        const missing = applySpareRule([], [IRON(49)], 'iron');
        const text = suppliesText(missing, []);
        assert.match(text, /^I get my supplies: .*a second pickaxe/, text);
        assert.doesNotMatch(text, /a second (wooden|stone|iron|golden|diamond|netherite) pickaxe/, text);
    });

    test('the one in hand with 50 uses: no spare', () => {
        const missing = applySpareRule([], [IRON(50)], 'iron');
        assert.doesNotMatch(suppliesText(missing, []), /pickaxe/);
    });

    test('a spare already in the bag: no other spare, whatever the uses of the one in hand', () => {
        const missing = applySpareRule([], [IRON(200), IRON(12)], 'iron');
        assert.doesNotMatch(suppliesText(missing, []), /pickaxe/);
    });

    test('no pickaxe at all: the first pickaxe is missing, not a second one', () => {
        const missing = applySpareRule([{ name: 'pickaxe', material: 'stone', count: 1 }], [], 'stone');
        const text = suppliesText(missing, []);
        assert.match(text, /pickaxe/, text);
        assert.doesNotMatch(text, /second/, text);
    });
});
