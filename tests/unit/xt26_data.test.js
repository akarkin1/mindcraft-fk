// Tests from the spec v0.1.4.14 (tester T1, round 2): SPEC 4.3, the data of 26.1, against the registry of minecraft-data 26.1
// taken by name (rule 26: never a literal id). Only what xd_copper_food does not already prove.
//   describe 'SPEC 4.3 the copper pickaxe' : copper_pickaxe has 190 uses in the data; PICKAXE_USES has a row for every
//                                            pickaxe of 26.1 and agrees; iron, copper and lapis ore list the copper pickaxe
//                                            among their harvest tools, diamond and gold ore do not; the tier table of the bot
//                                            (PICKAXE_LEVELS, pickaxeFor, pickaxeIsEnough) agrees with the harvest tools for
//                                            every ore block of ORES and every pickaxe.
//   describe 'SPEC 4.3 the copper chests'  : every name of CONTAINER_KINDS is a block of 26.1; every *chest* block of 26.1
//                                            whose window holds the block's own items is in it; shelves are not.
//   describe 'SPEC 4.3 the copper chests on the way' : the path finder takes every chest kind as no floor and never breaks it.
//   describe 'SPEC 4.3 the names'          : chain is no block or item of 26.1; iron_chain and copper_chain are.
//   describe 'SPEC 4.3 the mobs'           : parched has type hostile, copper_golem does not.
//   describe 'SPEC 4.3 the foods'          : VANILLA_FOODS equals foodsByName of 26.1 (names, points, saturation, nothing
//                                            more); every _bucket item name of 26.1 is refused by isEdibleFood, even when a
//                                            table lists it as food; the saturation of each food of 1.21.8 was
//                                            2 x points x the 26.1 value (DECISIONS R1-10), to float32 precision.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { loadSrc, TEST_MC_VERSION } from '../helpers/load.js';

const R = minecraftData(TEST_MC_VERSION);
const OLD = minecraftData('1.21.8'); // kept: R1-10 is a claim about the saturation values of the 1.21.8 data
const T = await loadSrc('src/agent/packs/mining/ore_table.js');
const ST = await loadSrc('src/agent/packs/storage/storage_logic.js');
const F = await loadSrc('src/agent/packs/home/food_logic.js');

const harvestToolNames = (block) => Object.keys(R.blocksByName[block].harvestTools ?? {}).map((id) => R.items[Number(id)].name).sort();
const pickaxes = () => R.itemsArray.map((i) => i.name).filter((n) => n.endsWith('_pickaxe'));

describe('SPEC 4.3 the copper pickaxe', () => {
    test('the registry is 26.1', () => {
        assert.equal(TEST_MC_VERSION, '26.1');
        assert.equal(R.version.minecraftVersion, '26.1');
    });

    test('copper_pickaxe: 190 uses in the data; PICKAXE_USES has every pickaxe of 26.1 and agrees for each material', () => {
        assert.equal(R.itemsByName.copper_pickaxe.maxDurability, 190);
        const materials = pickaxes().map((n) => n.replace(/_pickaxe$/, '')).sort();
        assert.deepEqual(Object.keys(T.PICKAXE_USES).sort(), materials);
        for (const m of materials) assert.equal(T.PICKAXE_USES[m], R.itemsByName[`${m}_pickaxe`].maxDurability, m);
        assert.deepEqual(Object.keys(T.PICKAXE_LEVELS).sort(), materials, 'every material has a tier');
    });

    test('the harvest tools: iron, copper, lapis ore with the copper pickaxe; diamond and gold ore without', () => {
        for (const ore of ['iron_ore', 'copper_ore', 'lapis_ore']) assert.ok(harvestToolNames(ore).includes('copper_pickaxe'), ore);
        for (const ore of ['diamond_ore', 'gold_ore']) assert.ok(!harvestToolNames(ore).includes('copper_pickaxe'), ore);
    });

    test('the tier table of the bot agrees with the harvest tools of 26.1 for every ore block and every pickaxe', () => {
        const wrong = [];
        for (const row of T.ORES) {
            for (const block of row.blocks) {
                assert.ok(R.blocksByName[block], `${block} is a block of 26.1`);
                const tools = harvestToolNames(block);
                for (const pick of pickaxes()) {
                    const material = T.pickaxeMaterial(pick);
                    const data = tools.includes(pick);
                    const bot = T.pickaxeIsEnough(material, T.pickaxeFor(row.ore));
                    if (data !== bot) wrong.push(`${block} ${pick}: data ${data}, bot ${bot}`);
                }
            }
        }
        assert.deepEqual(wrong, []);
    });

    test('copper has the tier of stone and stays below iron', () => {
        assert.equal(T.PICKAXE_LEVELS.copper, T.PICKAXE_LEVELS.stone);
        assert.ok(T.PICKAXE_LEVELS.copper < T.PICKAXE_LEVELS.iron);
        assert.equal(T.pickaxeMaterial('copper_pickaxe'), 'copper');
    });
});

describe('SPEC 4.3 the copper chests', () => {
    // A chest window that holds the block's own items: the ender chest opens the player's ender inventory, not the block's,
    // and was never a container kind (v0.1.4.13; rule 24: no change of behaviour), so it is the one *chest* block left out.
    const OWN_ITEMS_EXCEPT = ['ender_chest'];

    test('every name of CONTAINER_KINDS is a block of 26.1', () => {
        for (const name of ST.CONTAINER_KINDS) assert.ok(R.blocksByName[name], name);
    });

    test('every *chest* block of 26.1 with a window of its own items is in CONTAINER_KINDS and isContainerKind', () => {
        const chests = R.blocksArray.map((b) => b.name).filter((n) => n.includes('chest') && !OWN_ITEMS_EXCEPT.includes(n));
        assert.equal(chests.length, 10, chests.join(', '));
        for (const name of chests) {
            assert.ok(ST.CONTAINER_KINDS.includes(name), name);
            assert.equal(ST.isContainerKind(name), true, name);
        }
    });

    test('no shelf of 26.1 is a container kind', () => {
        const shelves = R.blocksArray.map((b) => b.name).filter((n) => n.endsWith('_shelf'));
        assert.ok(shelves.length >= 12, `${shelves.length}`);
        for (const name of shelves) {
            assert.ok(!ST.CONTAINER_KINDS.includes(name), name);
            assert.equal(ST.isContainerKind(name), false, name);
        }
    });
});

describe('SPEC 4.3 the copper chests on the way (the path finder)', () => {
    // FINDING (T1, round 2): "A copper chest is a chest" (SPEC 4.3; R1-11: "a copper chest is a chest in every list"). The
    // Movements of patches/mineflayer-pathfinder+2.4.5.patch list chest, trapped_chest and ender_chest as no floor and
    // never broken by a move (noStandBlocks, keepBlocks; upstream blocksCantBreak holds chest), the 8 copper chests in none:
    // the bot may stand on a copper chest or dig through it on a walk. Left failing.
    test('every container kind is no floor and never broken by a move, as a chest is', async () => {
        const { createRequire } = await import('node:module');
        const require = createRequire(import.meta.url);
        const Movements = require('mineflayer-pathfinder/lib/movements');
        const registry = require('prismarine-registry')(TEST_MC_VERSION);
        const m = new Movements({ registry, version: TEST_MC_VERSION, game: { minY: -64 }, entity: { position: { x: 0, y: 64, z: 0 } }, entities: {},
            inventory: { items: () => [] } });
        const id = (name) => registry.blocksByName[name].id;
        assert.ok(m.noStandBlocks.has(id('chest')) && m.keepBlocks.has(id('chest')) && m.blocksCantBreak.has(id('chest')), 'a chest');
        const wrong = ST.CONTAINER_KINDS.filter((n) => n !== 'barrel')
            .filter((n) => !(m.noStandBlocks.has(id(n)) && (m.keepBlocks.has(id(n)) || m.blocksCantBreak.has(id(n)))));
        assert.deepEqual(wrong, []);
    });
});

describe('SPEC 4.3 the names', () => {
    test('chain is no block or item of 26.1; iron_chain and copper_chain are both', () => {
        assert.equal(R.blocksByName.chain, undefined);
        assert.equal(R.itemsByName.chain, undefined);
        for (const name of ['iron_chain', 'copper_chain']) {
            assert.ok(R.blocksByName[name], `${name} block`);
            assert.ok(R.itemsByName[name], `${name} item`);
        }
    });
});

describe('SPEC 4.3 the mobs', () => {
    test('parched has type hostile; copper_golem does not', () => {
        assert.equal(R.entitiesByName.parched.type, 'hostile');
        assert.notEqual(R.entitiesByName.copper_golem.type, 'hostile');
    });
});

describe('SPEC 4.3 the foods', () => {
    test('VANILLA_FOODS equals foodsByName of 26.1: names, food points and saturation, no other field', () => {
        const fromData = Object.fromEntries(Object.values(R.foodsByName).map((f) => [f.name, { name: f.name, foodPoints: f.foodPoints, saturation: f.saturation }]));
        const fromBot = Object.fromEntries(Object.entries(F.VANILLA_FOODS).map(([k, f]) => [k, { ...f }]));
        assert.deepEqual(fromBot, fromData);
    });

    test('every _bucket item of 26.1 is refused by isEdibleFood, also when a table lists it as food and nothing is banned', () => {
        const buckets = R.itemsArray.map((i) => i.name).filter((n) => n.endsWith('_bucket'));
        assert.ok(buckets.includes('milk_bucket') && buckets.includes('cod_bucket'), buckets.join(', '));
        const everyBucketAFood = { ...R.foodsByName };
        for (const name of buckets) everyBucketAFood[name] = { name, foodPoints: 4, saturation: 2.4 };
        for (const name of buckets) {
            assert.equal(F.isEdibleFood(name, R.foodsByName), false, `${name}, the data of 26.1`);
            assert.equal(F.isEdibleFood(name, everyBucketAFood, []), false, `${name}, as a food, nothing banned`);
            assert.equal(F.isEdibleFood(name, F.VANILLA_FOODS, []), false, `${name}, VANILLA_FOODS`);
        }
        assert.equal(F.isEdibleFood('cooked_beef', R.foodsByName), true);
    });

    test('R1-10: every food of 1.21.8 is a food of 26.1 with the same points, and its old saturation was 2 x points x the new', () => {
        const wrong = [];
        for (const old of Object.values(OLD.foodsByName)) {
            const now = R.foodsByName[old.name];
            if (!now) { wrong.push(`${old.name} gone`); continue; }
            if (now.foodPoints !== old.foodPoints) wrong.push(`${old.name} points ${old.foodPoints} -> ${now.foodPoints}`);
            const expected = 2 * old.foodPoints * now.saturation;
            // the data is float32: 86.4 against 86.4000036 is the same number to 1e-6 of the value
            if (Math.abs(old.saturation - expected) > 1e-6 * Math.max(1, Math.abs(expected))) wrong.push(`${old.name} ${old.saturation} vs ${expected}`);
        }
        assert.deepEqual(wrong, []);
        const added = Object.keys(R.foodsByName).filter((n) => !OLD.foodsByName[n]).sort();
        assert.deepEqual(added, ['cod_bucket', 'pufferfish_bucket', 'salmon_bucket', 'tropical_fish_bucket'], 'the only new foods are the 4 buckets');
    });
});
