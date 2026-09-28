// Spec v0.1.4.7 S2: src/agent/packs/storage/storage_logic.js -- the keep plan, the choice of a chest
// and the small helpers of the storage pack. Pure.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const L = await loadSrc('src/agent/packs/storage/storage_logic.js');

// A small food table in the shape of bot.registry.foodsByName.
const FOODS = {
    bread: { foodPoints: 5, saturation: 6 },
    cooked_beef: { foodPoints: 8, saturation: 12.8 },
    cooked_porkchop: { foodPoints: 8, saturation: 12.8 },
    baked_potato: { foodPoints: 5, saturation: 6 },
    carrot: { foodPoints: 3, saturation: 3.6 },
    rotten_flesh: { foodPoints: 4, saturation: 0.8 },
    golden_apple: { foodPoints: 4, saturation: 9.6 },
};

let nextSlot = 9;
function inv(...entries) {
    nextSlot = 9;
    return entries.map(([name, count = 1, uses_left = null]) => ({ name, count, slot: nextSlot++, uses_left }));
}

function asMap(list) {
    const out = {};
    for (const e of list) {
        out[e.name] = e.count;
    }
    return out;
}

function plan(inventory, options = {}) {
    return L.keepPlan(inventory, { foods: FOODS, ...options });
}

describe('keepPlan: tools', () => {
    test('keeps the best tool of each kind and one more pickaxe', () => {
        const p = plan(inv(['wooden_pickaxe', 1, 50], ['stone_pickaxe', 1, 100], ['iron_pickaxe', 1, 200],
            ['diamond_axe', 1, 900], ['stone_axe', 1, 120], ['wooden_shovel', 1, 30], ['golden_hoe', 1, 20], ['iron_sword', 1, 5]));
        assert.deepEqual(asMap(p.keep), { iron_pickaxe: 1, stone_pickaxe: 1, diamond_axe: 1, wooden_shovel: 1, golden_hoe: 1, iron_sword: 1 });
        assert.deepEqual(asMap(p.store), { wooden_pickaxe: 1, stone_axe: 1 });
    });

    test('material order: netherite, diamond, iron, stone, golden, wooden', () => {
        const p = plan(inv(['golden_sword', 1, 30], ['stone_sword', 1, 10], ['wooden_sword', 1, 59], ['netherite_axe', 1, 3], ['diamond_axe', 1, 1500]));
        assert.deepEqual(asMap(p.keep), { stone_sword: 1, netherite_axe: 1 });
        assert.deepEqual(asMap(p.store), { golden_sword: 1, wooden_sword: 1, diamond_axe: 1 });
        const q = plan(inv(['golden_shovel', 1, 30], ['wooden_shovel', 1, 59]));
        assert.deepEqual(asMap(q.keep), { golden_shovel: 1 });
    });

    test('among equal tools the one with more uses left; the stored one is named by its slot', () => {
        const items = inv(['stone_pickaxe', 1, 10], ['stone_pickaxe', 1, 100], ['stone_pickaxe', 1, 60], ['iron_pickaxe', 1, 250]);
        const p = plan(items);
        assert.deepEqual(asMap(p.keep), { iron_pickaxe: 1, stone_pickaxe: 1 });
        const stored = p.store.find(e => e.name === 'stone_pickaxe');
        assert.equal(stored.count, 2);
        assert.deepEqual([...stored.slots].sort((a, b) => a - b), [items[0].slot, items[2].slot]);
    });

    test('two pickaxes of the same name are both kept', () => {
        const p = plan(inv(['stone_pickaxe', 1, 10], ['stone_pickaxe', 1, 100]));
        assert.deepEqual(asMap(p.keep), { stone_pickaxe: 2 });
        assert.deepEqual(p.store, []);
    });

    test('a tool without uses_left counts as the most worn one', () => {
        const items = inv(['iron_axe', 1, null], ['iron_axe', 1, 40]);
        const p = plan(items);
        assert.deepEqual(p.store, [{ name: 'iron_axe', count: 1, slots: [items[0].slot] }]);
    });

    test('shears, flint_and_steel and fishing_rod are not tools of the table: stored', () => {
        const p = plan(inv(['shears', 1, 200], ['flint_and_steel', 1, 60], ['fishing_rod', 1, 60]));
        assert.deepEqual(asMap(p.store), { shears: 1, flint_and_steel: 1, fishing_rod: 1 });
    });
});

describe('keepPlan: armour, weapons, food and supplies', () => {
    test('armour, shield, bow and crossbow are all kept, arrows up to 64', () => {
        const p = plan(inv(['iron_helmet'], ['diamond_chestplate'], ['iron_leggings'], ['iron_leggings'], ['leather_boots'],
            ['turtle_helmet'], ['elytra'], ['shield'], ['bow'], ['crossbow'], ['arrow', 64], ['arrow', 36], ['spectral_arrow', 10]));
        assert.deepEqual(asMap(p.keep), {
            iron_helmet: 1, diamond_chestplate: 1, iron_leggings: 2, leather_boots: 1, turtle_helmet: 1, elytra: 1,
            shield: 1, bow: 1, crossbow: 1, arrow: 64,
        });
        assert.deepEqual(asMap(p.store), { arrow: 36, spectral_arrow: 10 });
    });

    test('horse armour is no armour of the bot', () => {
        const p = plan(inv(['iron_horse_armor']));
        assert.deepEqual(asMap(p.store), { iron_horse_armor: 1 });
    });

    test('food up to 16 pieces, the best first; banned food is stored', () => {
        const p = plan(inv(['bread', 20], ['cooked_beef', 10], ['rotten_flesh', 5], ['golden_apple', 2]));
        assert.deepEqual(asMap(p.keep), { cooked_beef: 10, bread: 6 });
        assert.deepEqual(asMap(p.store), { bread: 14, rotten_flesh: 5, golden_apple: 2 });
    });

    test('food ties: saturation, then the name', () => {
        const p = plan(inv(['cooked_porkchop', 10], ['cooked_beef', 10], ['baked_potato', 20], ['bread', 20]));
        assert.deepEqual(asMap(p.keep), { cooked_beef: 10, cooked_porkchop: 6 });
    });

    test('without a food table the built-in one knows the common food', () => {
        const p = L.keepPlan(inv(['bread', 20], ['cooked_beef', 4], ['rotten_flesh', 3], ['dirt', 5]));
        assert.deepEqual(asMap(p.keep), { cooked_beef: 4, bread: 12 });
        assert.deepEqual(asMap(p.store), { bread: 8, rotten_flesh: 3, dirt: 5 });
    });

    test('carrot and potato are food, not seeds', () => {
        const p = plan(inv(['carrot', 20]));
        assert.deepEqual(asMap(p.keep), { carrot: 16 });
        assert.deepEqual(asMap(p.store), { carrot: 4 });
    });

    test('torch and ladder up to 64, cobblestone up to 32, several stacks together', () => {
        const p = plan(inv(['torch', 64], ['torch', 36], ['ladder', 70], ['cobblestone', 64], ['cobblestone', 32]));
        assert.deepEqual(asMap(p.keep), { torch: 64, ladder: 64, cobblestone: 32 });
        assert.deepEqual(asMap(p.store), { torch: 36, ladder: 6, cobblestone: 64 });
    });

    test('one crafting_table, one water_bucket, one bucket, one bed', () => {
        const p = plan(inv(['crafting_table', 2], ['water_bucket'], ['water_bucket'], ['bucket', 3], ['white_bed'], ['red_bed']));
        assert.deepEqual(asMap(p.keep), { crafting_table: 1, water_bucket: 1, bucket: 1, red_bed: 1 });
        assert.deepEqual(asMap(p.store), { crafting_table: 1, water_bucket: 1, bucket: 2, white_bed: 1 });
    });

    test('everything else is stored', () => {
        const p = plan(inv(['dirt', 12], ['wheat', 20], ['raw_iron', 5], ['diamond', 2]));
        assert.deepEqual(p.keep, []);
        assert.deepEqual(asMap(p.store), { dirt: 12, wheat: 20, raw_iron: 5, diamond: 2 });
    });
});

describe('keepPlan: options and the setting', () => {
    test('seeds and bone_meal are stored unless options.keep names them', () => {
        const items = inv(['wheat_seeds', 50], ['beetroot_seeds', 5], ['bone_meal', 7]);
        assert.deepEqual(asMap(plan(items).store), { wheat_seeds: 50, beetroot_seeds: 5, bone_meal: 7 });
        const p = plan(items, { keep: { wheat_seeds: 32, bone_meal: -1 } });
        assert.deepEqual(asMap(p.keep), { wheat_seeds: 32, bone_meal: 7 });
        assert.deepEqual(asMap(p.store), { wheat_seeds: 18, beetroot_seeds: 5 });
    });

    test('options.keep as a list or a single name keeps all of them', () => {
        const items = inv(['bone_meal', 7], ['wheat_seeds', 3], ['dirt', 1]);
        assert.deepEqual(asMap(plan(items, { keep: ['bone_meal', 'wheat_seeds'] }).keep), { bone_meal: 7, wheat_seeds: 3 });
        assert.deepEqual(asMap(plan(items, { keep: 'bone_meal' }).keep), { bone_meal: 7 });
    });

    test('names in keepItems (the setting keep_items) are kept', () => {
        const p = plan(inv(['diamond', 5], ['dirt', 20], ['gravel', 3]), { keepItems: { diamond: -1, dirt: 5, gravel: 0 } });
        assert.deepEqual(asMap(p.keep), { diamond: 5, dirt: 5 });
        assert.deepEqual(asMap(p.store), { dirt: 15, gravel: 3 });
    });

    test('several rules for one name: the largest count wins', () => {
        const items = inv(['torch', 100], ['cobblestone', 100]);
        const p = plan(items, { keep: { torch: 10 }, keepItems: { cobblestone: 64 } });
        assert.deepEqual(asMap(p.keep), { torch: 64, cobblestone: 64 });
        const q = plan(items, { keep: { torch: 10 }, keepItems: { torch: -1 } });
        assert.equal(asMap(q.keep).torch, 100);
    });

    test('invalid counts are ignored, minecraft: prefixes are removed', () => {
        const p = plan(inv(['dirt', 10]), { keep: { dirt: 'many', 'minecraft:gravel': 2, sand: Number.NaN, clay: -5 }, keepItems: 'x' });
        assert.deepEqual(asMap(p.store), { dirt: 10 });
        const q = plan(inv(['gravel', 3]), { keep: { 'minecraft:gravel': 2 } });
        assert.deepEqual(asMap(q.keep), { gravel: 2 });
    });

    test('options.only stores the named items and keeps everything else', () => {
        const items = inv(['wheat', 20], ['torch', 30], ['dirt', 5], ['stone_pickaxe', 1, 10], ['wooden_pickaxe', 1, 10], ['wooden_pickaxe', 1, 20]);
        const p = plan(items, { only: ['wheat', 'torch'] });
        assert.deepEqual(asMap(p.store), { wheat: 20, torch: 30 });
        assert.deepEqual(asMap(p.keep), { dirt: 5, stone_pickaxe: 1, wooden_pickaxe: 2 });
        assert.deepEqual(asMap(plan(items, { only: 'dirt' }).store), { dirt: 5 });
    });

    test('options.only with options.keep: the seeds beyond 32 are stored, the setting does not apply', () => {
        const p = plan(inv(['wheat', 9], ['wheat_seeds', 40], ['bread', 3]), {
            only: ['wheat', 'wheat_seeds'], keep: { wheat_seeds: 32 }, keepItems: { wheat: -1 },
        });
        assert.deepEqual(asMap(p.store), { wheat: 9, wheat_seeds: 8 });
        assert.deepEqual(asMap(p.keep), { wheat_seeds: 32, bread: 3 });
    });

    test('options.only with a tool stores the named tools by their slots', () => {
        const items = inv(['stone_axe', 1, 5], ['stone_axe', 1, 50]);
        const p = plan(items, { only: ['stone_axe'], keep: { stone_axe: 1 } });
        assert.deepEqual(p.store, [{ name: 'stone_axe', count: 1, slots: [items[0].slot] }]);
    });

    test('an empty options.only list means no restriction', () => {
        assert.deepEqual(asMap(plan(inv(['dirt', 5]), { only: [] }).store), { dirt: 5 });
    });
});

describe('keepPlan: input and output', () => {
    test('invalid entries are left out, a missing inventory is empty', () => {
        assert.deepEqual(L.keepPlan(null), { keep: [], store: [] });
        assert.deepEqual(L.keepPlan(undefined, null), { keep: [], store: [] });
        const p = plan([null, 'dirt', { name: 'dirt', count: 0 }, { count: 4 }, { name: '', count: 1 }, { name: 'air', count: 1 },
            { name: 'dirt', count: 3.7, slot: 9 }, { name: 'minecraft:gravel', count: 2, slot: 10 }]);
        assert.deepEqual(p.keep, []);
        assert.deepEqual(asMap(p.store), { dirt: 3, gravel: 2 });
    });

    test('lists are sorted by count, highest first, then by name', () => {
        const p = plan(inv(['dirt', 5], ['sand', 12], ['clay', 5], ['torch', 3], ['bread', 3]));
        assert.deepEqual(p.store.map(e => e.name), ['sand', 'clay', 'dirt']);
        assert.deepEqual(p.keep.map(e => e.name), ['bread', 'torch']);
    });

    test('does not change the input', () => {
        const items = inv(['dirt', 5], ['torch', 100]);
        const copy = JSON.parse(JSON.stringify(items));
        plan(items, { keep: { dirt: 1 } });
        assert.deepEqual(items, copy);
    });
});

describe('item kinds', () => {
    test('toolKindOf and materialOf', () => {
        assert.equal(L.toolKindOf('wooden_pickaxe'), 'pickaxe');
        assert.equal(L.toolKindOf('stone_axe'), 'axe');
        assert.equal(L.toolKindOf('diamond_hoe'), 'hoe');
        assert.equal(L.toolKindOf('golden_shovel'), 'shovel');
        assert.equal(L.toolKindOf('netherite_sword'), 'sword');
        assert.equal(L.toolKindOf('stick'), null);
        assert.equal(L.toolKindOf('pickaxe'), null);
        assert.equal(L.toolKindOf(null), null);
        assert.equal(L.materialOf('golden_axe'), 'golden');
        assert.equal(L.materialOf('iron_pickaxe'), 'iron');
        assert.equal(L.materialOf('copper_pickaxe'), null);
        assert.equal(L.materialOf(3), null);
    });

    test('isContainerKind, isArmour, isSeed, isBed', () => {
        assert.deepEqual(L.CONTAINER_KINDS, ['chest', 'trapped_chest', 'barrel']);
        assert.equal(L.isContainerKind('chest'), true);
        assert.equal(L.isContainerKind('trapped_chest'), true);
        assert.equal(L.isContainerKind('barrel'), true);
        assert.equal(L.isContainerKind('ender_chest'), false);
        assert.equal(L.isContainerKind(undefined), false);
        assert.equal(L.isArmour('iron_boots'), true);
        assert.equal(L.isArmour('elytra'), true);
        assert.equal(L.isArmour('diamond_horse_armor'), false);
        assert.equal(L.isSeed('wheat_seeds'), true);
        assert.equal(L.isSeed('pitcher_pod'), true);
        assert.equal(L.isSeed('carrot'), false);
        assert.equal(L.isBed('red_bed'), true);
        assert.equal(L.isBed('bedrock'), false);
    });
});

describe('positions and dimensions', () => {
    test('normalizeDimension', () => {
        assert.equal(L.normalizeDimension('minecraft:the_nether'), 'the_nether');
        assert.equal(L.normalizeDimension('overworld'), 'overworld');
        assert.equal(L.normalizeDimension(''), 'overworld');
        assert.equal(L.normalizeDimension(null), 'overworld');
    });

    test('chestKey floors the coordinates', () => {
        assert.equal(L.chestKey({ x: -13.2, y: 63.9, z: 28 }), '-14,63,28');
        assert.equal(L.chestKey(null), null);
        assert.equal(L.chestKey({ x: 1, y: 'a', z: 2 }), null);
    });

    test('keyHalf: the smaller x, then the smaller z', () => {
        assert.deepEqual(L.keyHalf({ x: 4, y: 64, z: 0 }, { x: 3, y: 64, z: 0 }), { x: 3, y: 64, z: 0 });
        assert.deepEqual(L.keyHalf({ x: 3, y: 64, z: 0 }, { x: 4, y: 64, z: 0 }), { x: 3, y: 64, z: 0 });
        assert.deepEqual(L.keyHalf({ x: 3, y: 64, z: 6 }, { x: 3, y: 64, z: 5 }), { x: 3, y: 64, z: 5 });
        assert.deepEqual(L.keyHalf({ x: 3, y: 64, z: 5 }, { x: 3, y: 64, z: 6 }), { x: 3, y: 64, z: 5 });
        assert.deepEqual(L.keyHalf({ x: 3, y: 64, z: 5 }, null), { x: 3, y: 64, z: 5 });
    });

    test('otherHalfOf: the connected half of a double chest', () => {
        const p = { x: 10, y: 64, z: 20 };
        assert.deepEqual(L.otherHalfOf(p, { facing: 'north', type: 'left' }), { x: 11, y: 64, z: 20 });
        assert.deepEqual(L.otherHalfOf(p, { facing: 'north', type: 'right' }), { x: 9, y: 64, z: 20 });
        assert.deepEqual(L.otherHalfOf(p, { facing: 'south', type: 'left' }), { x: 9, y: 64, z: 20 });
        assert.deepEqual(L.otherHalfOf(p, { facing: 'east', type: 'left' }), { x: 10, y: 64, z: 21 });
        assert.deepEqual(L.otherHalfOf(p, { facing: 'west', type: 'left' }), { x: 10, y: 64, z: 19 });
        assert.deepEqual(L.otherHalfOf(p, { facing: 'west', type: 'right' }), { x: 10, y: 64, z: 21 });
        assert.equal(L.otherHalfOf(p, { facing: 'north', type: 'single' }), null);
        assert.equal(L.otherHalfOf(p, { facing: 'up', type: 'left' }), null);
        assert.equal(L.otherHalfOf(p, null), null);
        assert.equal(L.otherHalfOf(null, { facing: 'north', type: 'left' }), null);
    });

    test('distanceTo measures to the centre of the block', () => {
        assert.equal(L.distanceTo({ x: 0.5, y: 64.5, z: 0.5 }, { x: 3.7, y: 64, z: 0 }), 3);
        assert.equal(L.distanceTo(null, { x: 0, y: 0, z: 0 }), Infinity);
    });
});

describe('chooseChest', () => {
    const at = (x, items, free, z = 0) => ({ x, y: 64, z, dimension: 'overworld', kind: 'chest', items, free_slots: free });
    const bot = { x: 0.5, y: 64, z: 0.5 };

    test('a chest that holds the item and has space, the nearest first', () => {
        const far = at(20, { wheat: 5 }, 3);
        const near = at(10, { wheat: 1 }, 1);
        const empty = at(2, {}, 27);
        assert.equal(L.chooseChest([empty, far, near], bot, 'wheat'), near);
    });

    test('a chest that holds the item but is full is skipped', () => {
        const full = at(3, { wheat: 64 }, 0);
        const other = at(9, {}, 5);
        assert.equal(L.chooseChest([full, other], bot, 'wheat'), other);
    });

    test('otherwise the nearest with space; ties by position', () => {
        const a = at(5, { dirt: 3 }, 2);
        const b = at(-4, {}, 2);
        assert.equal(L.chooseChest([a, b], bot, 'wheat'), b);
        const c = at(0, {}, 1, 3);
        const d = at(0, {}, 1, -2);
        assert.equal(L.chooseChest([c, d], { x: 0.5, y: 64, z: 1 }, 'wheat'), d);
        assert.equal(L.chooseChest([a, b], bot), b);
    });

    test('null without a chest with space; bad input', () => {
        assert.equal(L.chooseChest([at(1, {}, 0)], bot, 'dirt'), null);
        assert.equal(L.chooseChest([], bot, 'dirt'), null);
        assert.equal(L.chooseChest(null, bot, 'dirt'), null);
        assert.equal(L.chooseChest([null, { x: 'a' }, at(1, {}, 'x')], bot, 'dirt'), null);
    });
});

describe('slots of a container', () => {
    const s = (name, count) => ({ name, count });

    test('summarizeSlots counts the items and the free slots', () => {
        assert.deepEqual(L.summarizeSlots([s('wheat', 12), null, s('wheat', 3), s('dirt', 64), undefined, { name: 'x', count: 0 }]),
            { items: { wheat: 15, dirt: 64 }, free_slots: 3 });
        assert.deepEqual(L.summarizeSlots(null), { items: {}, free_slots: 0 });
    });

    test('countIn and roomFor', () => {
        const slots = [s('wheat', 60), null, s('dirt', 1), s('wheat', 64), null];
        assert.equal(L.countIn(slots, 'wheat'), 124);
        assert.equal(L.countIn(null, 'wheat'), 0);
        assert.equal(L.roomFor(slots, 'wheat', 64), 4 + 64 + 64);
        assert.equal(L.roomFor(slots, 'iron_pickaxe', 1), 2);
        assert.equal(L.roomFor(slots, 'dirt'), 63 + 128);
        assert.equal(L.roomFor(null, 'dirt', 64), 0);
    });
});
