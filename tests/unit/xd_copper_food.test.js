// Part D of v0.1.4.14 (SPEC 4.3): the data of 26.1 in the bot's tables.
//   - the copper pickaxe: tier of stone, 190 uses, as minecraft-data 26.1 says; pickaxeToCraft never copper;
//     usablePickaxes ranks copper as tier 1 below iron; the word of the material is `copper`;
//   - the eight copper chests are containers for the index and `look`, a shelf is not;
//   - the food table is the one of 26.1, no bucket is edible, cooked beef ranks above bread above apple;
//   - isHostile: `parched` yes, the copper golem no.
// The registry is taken by name (rule 26: no literal id).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { loadSrc } from '../helpers/load.js';

const R = minecraftData('26.1');
const OLD = minecraftData('1.21.8'); // kept: the tests compare 26.1 with the data of 1.21.8 (new names, the old food order)
const T = await loadSrc('src/agent/packs/mining/ore_table.js');
const M = await loadSrc('src/agent/packs/mining/mine_logic.js');
const SUP = await loadSrc('src/agent/packs/mining/supply_logic.js');
const TX = await loadSrc('src/agent/packs/mining/texts.js');
const ST = await loadSrc('src/agent/packs/storage/storage_logic.js');
const LK = await loadSrc('src/agent/watch/look_logic.js');
const F = await loadSrc('src/agent/packs/home/food_logic.js');
const MC = await loadSrc('src/utils/mcdata.js');

const COPPER_CHESTS = ['copper_chest', 'exposed_copper_chest', 'weathered_copper_chest', 'oxidized_copper_chest', 'waxed_copper_chest',
    'waxed_exposed_copper_chest', 'waxed_weathered_copper_chest', 'waxed_oxidized_copper_chest'];
const SHELVES = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo', 'crimson', 'warped']
    .map((wood) => `${wood}_shelf`);
const BUCKETS = ['cod_bucket', 'salmon_bucket', 'pufferfish_bucket', 'tropical_fish_bucket'];

const harvests = (block, tool) => Boolean(R.blocksByName[block].harvestTools?.[R.itemsByName[tool].id]);

describe('the copper pickaxe (SPEC 4.3)', () => {
    test('the data of 26.1: tier of stone, 190 uses', () => {
        for (const ore of ['iron_ore', 'copper_ore', 'lapis_ore', 'copper_chest'])
            assert.ok(harvests(ore, 'copper_pickaxe'), `copper_pickaxe harvests ${ore}`);
        for (const ore of ['diamond_ore', 'gold_ore', 'redstone_ore'])
            assert.ok(!harvests(ore, 'copper_pickaxe'), `copper_pickaxe does not harvest ${ore}`);
        assert.equal(R.itemsByName.copper_pickaxe.maxDurability, 190);
        assert.equal(OLD.itemsByName.copper_pickaxe, undefined, 'not in 1.21.8');
    });

    test('PICKAXE_LEVELS and PICKAXE_USES: copper is 1 and 190, the others as before', () => {
        assert.equal(T.PICKAXE_LEVELS.copper, 1);
        assert.equal(T.PICKAXE_LEVELS.copper, T.PICKAXE_LEVELS.stone);
        assert.ok(T.PICKAXE_LEVELS.copper < T.PICKAXE_LEVELS.iron);
        assert.equal(T.PICKAXE_USES.copper, 190);
        for (const material of ['wooden', 'stone', 'copper', 'iron', 'golden', 'diamond', 'netherite'])
            assert.equal(T.PICKAXE_USES[material], R.itemsByName[`${material}_pickaxe`].maxDurability, material);
        assert.deepEqual({ ...T.PICKAXE_LEVELS }, { wooden: 0, golden: 0, stone: 1, copper: 1, iron: 2, diamond: 3, netherite: 4 });
    });

    test('pickaxeMaterial and pickaxeIsEnough', () => {
        assert.equal(T.pickaxeMaterial('copper_pickaxe'), 'copper');
        assert.equal(T.pickaxeMaterial('minecraft:copper_pickaxe'), 'copper');
        assert.equal(T.pickaxeMaterial('copper_axe'), null);
        assert.equal(T.pickaxeIsEnough('copper', 'stone'), true);
        assert.equal(T.pickaxeIsEnough('copper', 'wooden'), true);
        assert.equal(T.pickaxeIsEnough('copper', 'iron'), false);
        assert.equal(T.pickaxeIsEnough('stone', 'copper'), true);
        for (const ore of ['iron', 'copper', 'lapis', 'coal'])
            assert.ok(T.pickaxeIsEnough('copper', T.pickaxeFor(ore)), ore);
        for (const ore of ['gold', 'redstone', 'diamond'])
            assert.ok(!T.pickaxeIsEnough('copper', T.pickaxeFor(ore)), ore);
    });

    test('a trip never asks for copper: tripPickaxe is as before', () => {
        for (const ore of ['coal', 'copper', 'iron', 'lapis'])
            assert.equal(T.tripPickaxe(ore), 'stone', ore);
        for (const ore of ['gold', 'redstone', 'diamond'])
            assert.equal(T.tripPickaxe(ore), 'iron', ore);
    });

    test('pickaxeToCraft never returns copper', () => {
        const bags = [
            [{ name: 'copper_ingot', count: 64 }],
            [{ name: 'copper_ingot', count: 64 }, { name: 'cobblestone', count: 3 }],
            [{ name: 'copper_ingot', count: 64 }, { name: 'iron_ingot', count: 21 }],
            [{ name: 'copper_ingot', count: 64 }, { name: 'iron_ingot', count: 3 }],
            [{ name: 'copper_ingot', count: 64 }, { name: 'diamond', count: 3 }],
            [{ name: 'raw_copper', count: 64 }, { name: 'copper_block', count: 9 }],
            [],
        ];
        for (const need of ['wooden', 'stone', 'copper', 'iron', 'diamond'])
            for (const bag of bags)
                assert.notEqual(SUP.pickaxeToCraft(need, bag), 'copper', `${need} ${JSON.stringify(bag)}`);
        assert.equal(SUP.pickaxeToCraft('stone', [{ name: 'copper_ingot', count: 64 }, { name: 'cobblestone', count: 3 }]), 'stone');
        assert.equal(SUP.pickaxeToCraft('stone', [{ name: 'copper_ingot', count: 64 }]), null, 'copper ingots alone: nothing to craft');
        assert.equal(SUP.pickaxeToCraft('copper', [{ name: 'cobblestone', count: 3 }]), 'stone', 'a need of copper is a need of stone');
    });

    test('usablePickaxes: copper is tier 1, below iron, above stone only by its uses', () => {
        const bag = [{ name: 'stone_pickaxe', count: 1 }, { name: 'copper_pickaxe', count: 1 }, { name: 'iron_pickaxe', count: 1 }];
        assert.deepEqual(M.usablePickaxes(bag, 'stone'), [
            { name: 'iron_pickaxe', material: 'iron', uses: 250 },
            { name: 'copper_pickaxe', material: 'copper', uses: 190 },
            { name: 'stone_pickaxe', material: 'stone', uses: 131 },
        ]);
        assert.deepEqual(M.usablePickaxes(bag, 'iron').map((p) => p.name), ['iron_pickaxe'], 'copper does not mine diamond');
        const worn = [{ name: 'copper_pickaxe', count: 1, uses_left: 12 }, { name: 'stone_pickaxe', count: 1, uses_left: 100 }];
        assert.deepEqual(M.usablePickaxes(worn, 'stone').map((p) => p.name), ['stone_pickaxe', 'copper_pickaxe'], 'the same tier: the most uses first');
        assert.equal(M.pickaxeUses({ name: 'copper_pickaxe' }), 190);
    });

    test('a copper pickaxe the bag holds is a usable pickaxe of a trip for iron: nothing missing for the pickaxe', () => {
        const plan = M.tripNeeds('iron', 70, 16, [{ name: 'copper_pickaxe', count: 1, uses_left: 150 }]);
        assert.equal(plan.pickaxe, 'copper_pickaxe');
        assert.ok(!plan.missing.some((m) => m.name === 'pickaxe' && !m.spare), JSON.stringify(plan.missing));
        const gold = M.tripNeeds('gold', 70, 16, [{ name: 'copper_pickaxe', count: 1 }]);
        assert.ok(gold.missing.some((m) => m.name === 'pickaxe' && m.material === 'iron'), 'gold needs iron');
    });

    test('the supply step takes a copper pickaxe from a chest for a trip of tier 1, not for gold', () => {
        const chests = [{ x: 1, y: 64, z: 0, items: { copper_pickaxe: 1 } }];
        const iron = SUP.supplyPlan({ missing: [{ name: 'pickaxe', material: 'stone', count: 1 }], from: { x: 0, y: 64, z: 0 }, chests });
        assert.deepEqual(iron.takes.map((t) => t.items), [{ copper_pickaxe: 1 }]);
        const gold = SUP.supplyPlan({ missing: [{ name: 'pickaxe', material: 'iron', count: 1 }], from: { x: 0, y: 64, z: 0 }, chests });
        assert.deepEqual(gold.takes, []);
    });

    test('the texts: the word `copper`, the existing worn and spare texts', () => {
        assert.equal(TX.wornStopText('copper_pickaxe', 9, 2, 6, 'iron'),
            'My copper_pickaxe is nearly worn: 9 uses left. I have no copper for a new one. I stop the mining at 2 of 6 iron.');
        assert.equal(TX.wornSpareText('copper_pickaxe', 9), 'My copper_pickaxe is nearly worn: 9 uses left. I take my spare one.');
        assert.equal(TX.wornMadeText('copper_pickaxe', 8), 'My copper_pickaxe is nearly worn: 8 uses left. I made a new one.');
        assert.equal(TX.suppliesText([], [{ chest: { x: 1, y: 2, z: 3 }, items: { copper_pickaxe: 1 } }]),
            'I get my supplies: a copper pickaxe from the chest at (1, 2, 3).');
    });
});

describe('the copper chests (SPEC 4.3)', () => {
    test('the eight names are blocks of 26.1, none of 1.21.8; the twelve shelves likewise', () => {
        for (const name of [...COPPER_CHESTS, ...SHELVES]) {
            assert.ok(R.blocksByName[name], `${name} in 26.1`);
            assert.equal(OLD.blocksByName[name], undefined, `${name} not in 1.21.8`);
        }
    });

    test('CONTAINER_KINDS and isContainerKind: the old three and the eight copper chests, no shelf', () => {
        for (const name of ['chest', 'trapped_chest', 'barrel', ...COPPER_CHESTS])
            assert.ok(ST.isContainerKind(name), name);
        assert.equal(ST.CONTAINER_KINDS.length, 11);
        for (const name of [...SHELVES, 'ender_chest', 'copper_block', 'copper_golem_statue'])
            assert.ok(!ST.isContainerKind(name), name);
    });

    test('CHEST_BLOCKS of the look tool: the same eleven, no shelf', () => {
        assert.deepEqual([...LK.CHEST_BLOCKS].sort(), [...ST.CONTAINER_KINDS].sort());
        for (const name of SHELVES)
            assert.ok(!LK.CHEST_BLOCKS.includes(name), name);
    });

    test('look lists a copper chest under Chests:', () => {
        const blocks = new Map([['2,64,0', 'oxidized_copper_chest'], ['-3,64,0', 'oak_shelf']]);
        const reader = { blockAt: (x, y, z) => ({ name: blocks.get(`${x},${y},${z}`) ?? 'air' }), entities: () => [] };
        const lines = LK.lookAround(reader, { x: 0, y: 64, z: 0 }, 4);
        const chests = lines.find((l) => l.startsWith('Chests'));
        assert.ok(chests && chests.includes('(2, 64, 0)'), lines.join('\n'));
        assert.ok(!chests.includes('(-3, 64, 0)'), 'a shelf is no chest');
    });
});

describe('the foods of 26.1 (SPEC 4.3)', () => {
    const FOODS = R.foodsByName;

    test('VANILLA_FOODS is foods.json of 26.1: the same names, points and saturation', () => {
        assert.deepEqual(Object.keys(F.VANILLA_FOODS).sort(), Object.keys(FOODS).sort());
        for (const [name, food] of Object.entries(FOODS)) {
            assert.equal(F.VANILLA_FOODS[name].foodPoints, food.foodPoints, name);
            assert.equal(F.VANILLA_FOODS[name].saturation, food.saturation, name);
            assert.equal(F.VANILLA_FOODS[name].name, name);
        }
        assert.equal(F.VANILLA_FOODS.apple.saturation, 2.4);
        assert.equal(F.VANILLA_FOODS.bread.saturation, 6);
        assert.equal(F.VANILLA_FOODS.cooked_beef.saturation, 12.8);
        assert.ok(Object.isFrozen(F.VANILLA_FOODS) && Object.isFrozen(F.VANILLA_FOODS.bread));
    });

    test('no bucket is edible, with any banned list and either table', () => {
        for (const name of BUCKETS) {
            assert.ok(FOODS[name], `${name} is listed as food by 26.1`);
            assert.equal(F.isEdibleFood(name, FOODS), false, name);
            assert.equal(F.isEdibleFood(name, FOODS, []), false, `${name}, nothing banned`);
            assert.equal(F.isEdibleFood(name, F.VANILLA_FOODS), false, `${name}, the fallback table`);
        }
        assert.equal(F.isEdibleFood('bread', FOODS), true);
        assert.equal(F.isEdibleFood('rotten_flesh', FOODS), false, 'banned stays banned');
        assert.equal(F.isEdibleFood('rotten_flesh', FOODS, []), true, 'with nothing banned rotten flesh is food');
    });

    test('the food choice: cooked beef above bread above apple; never a bucket', () => {
        const item = (name, count = 1) => ({ name, count });
        for (const foods of [FOODS, F.VANILLA_FOODS]) {
            assert.equal(F.chooseFood([item('apple'), item('bread'), item('cooked_beef'), item('cod_bucket')], foods), 'cooked_beef');
            assert.equal(F.chooseFood([item('apple'), item('bread'), item('salmon_bucket')], foods), 'bread');
            assert.equal(F.chooseFood([item('apple'), item('tropical_fish_bucket')], foods), 'apple');
            assert.equal(F.chooseFood([item('cod_bucket'), item('dried_kelp')], foods), 'dried_kelp', 'kelp, not the bucket of 2 points');
            assert.equal(F.chooseFood(BUCKETS.map((n) => item(n)), foods), null);
            assert.equal(F.chooseFood([item('cooked_chicken'), item('cooked_mutton')], foods), 'cooked_mutton', 'same points: more saturation');
        }
    });

    test('the order of the foods by points and saturation is the one of 1.21.8', () => {
        const rank = (table) => Object.values(table).filter((f) => !BUCKETS.includes(f.name))
            .sort((a, b) => b.foodPoints - a.foodPoints || b.saturation - a.saturation || (a.name < b.name ? -1 : 1)).map((f) => f.name);
        assert.deepEqual(rank(F.VANILLA_FOODS), rank(OLD.foodsByName));
    });

    test('the chests: a bucket is no known food, and never fetched', () => {
        const chests = [{ x: 0, y: 64, z: 0, items: { cod_bucket: 5, salmon_bucket: 5, bread: 1 } }];
        assert.deepEqual(F.listKnownFood(chests, { foods: FOODS }).map((k) => k.name), ['bread']);
        assert.deepEqual(F.listKnownFood([{ x: 0, y: 64, z: 0, items: { cod_bucket: 5 } }]), [], 'the fallback table too');
        assert.equal(F.chooseKnownFood([{ name: 'cod_bucket', count: 9 }, { name: 'dried_kelp', count: 1 }], FOODS), 'dried_kelp');
        assert.equal(F.chooseKnownFood([{ name: 'cod_bucket', count: 9 }], FOODS), null);
    });

    test('the supply step and the trip count no bucket as food', () => {
        assert.equal(SUP.supplyPlan({ missing: [{ name: 'food', count: 8 }], from: { x: 0, y: 64, z: 0 },
            chests: [{ x: 1, y: 64, z: 0, items: { cod_bucket: 8 } }], foods: FOODS }).takes.length, 0);
        const plan = M.tripNeeds('iron', 70, 16, [{ name: 'stone_pickaxe', count: 1 }, { name: 'cod_bucket', count: 8 }], { foods: FOODS });
        assert.ok(plan.missing.some((m) => m.name === 'food' && m.count === 8), JSON.stringify(plan.missing));
    });
});

describe('the mobs of 26.1 (SPEC 4.3)', () => {
    const mob = (name) => ({ name, type: R.entitiesByName[name].type });

    test('parched is hostile by the data, and for isHostile', () => {
        assert.equal(R.entitiesByName.parched.category, 'Hostile mobs');
        assert.equal(MC.isHostile(mob('parched')), true);
    });

    test('the copper golem is no enemy, like the iron and the snow golem; the new animals neither', () => {
        for (const name of ['copper_golem', 'iron_golem', 'snow_golem', 'nautilus', 'zombie_nautilus', 'camel_husk', 'mannequin'])
            assert.equal(MC.isHostile(mob(name)), false, name);
        for (const name of ['zombie', 'skeleton', 'husk', 'creeper'])
            assert.equal(MC.isHostile(mob(name)), true, name);
    });
});

// ------------------------------------------------------------------ round 2: everywhere a chest is
const SCAN = await loadSrc('src/agent/areas/area_scan.js');
const STAND = await loadSrc('src/agent/packs/home/stand_logic.js');
const FIELD = await loadSrc('src/agent/packs/farming/field_logic.js');
const NIGHT = await loadSrc('src/agent/packs/home/night_logic.js');
const BAG = await loadSrc('src/agent/packs/mining/bag_logic.js');

describe('round 2: a copper chest is a chest everywhere (SPEC 4.3)', () => {
    test('COPPER_CHESTS of storage_logic.js: the eight names; the copies of the import-free modules hold exactly the same', () => {
        assert.deepEqual([...ST.COPPER_CHESTS], COPPER_CHESTS);
        for (const [label, copy] of [['area_scan.js', SCAN.COPPER_CHESTS], ['stand_logic.js', STAND.COPPER_CHESTS], ['field_logic.js', FIELD.COPPER_CHESTS],
            ['bag_logic.js', BAG.COPPER_CHESTS]]) {
            assert.deepEqual([...copy], [...ST.COPPER_CHESTS], label);
            assert.ok(Object.isFrozen(copy), label);
        }
    });

    test('the bot never stands on a copper chest (the home pack and the farming pack); a shelf is no container', () => {
        for (const name of COPPER_CHESTS) {
            assert.ok(STAND.NO_STAND_NAMES.includes(name), name);
            assert.equal(STAND.isNoStandBlock(name), true, `home: ${name}`);
            assert.equal(FIELD.isNoStandBlock(name), true, `farming: ${name}`);
        }
        assert.ok(STAND.NO_STAND_NAMES.includes('chest'));
        assert.deepEqual([...BAG.CONTAINER_NAMES].sort(), [...ST.CONTAINER_KINDS].sort(), 'the containers of the mining pack');
    });

    test('MATERIALS of the keep plan: copper between iron and stone; materialOf', () => {
        assert.deepEqual([...ST.MATERIALS], ['netherite', 'diamond', 'iron', 'copper', 'stone', 'golden', 'wooden']);
        assert.equal(ST.materialOf('copper_pickaxe'), 'copper');
        assert.equal(ST.materialOf('copper_sword'), 'copper');
    });
});

describe('round 2: the mobs for the shelter and a bucket in the bag (SPEC 4.3)', () => {
    const mob = (name) => ({ name, type: R.entitiesByName[name].type });

    test('isHostileForShelter: the copper golem is not hostile, the parched is', () => {
        assert.equal(NIGHT.isHostileForShelter(mob('copper_golem')), false);
        assert.equal(NIGHT.isHostileForShelter(mob('parched')), true);
        assert.ok(NIGHT.NOT_HOSTILE_FOR_SHELTER.includes('copper_golem'));
    });

    test('storeKinds: a fish bucket is no food, it is stored; bread is kept', () => {
        const items = [{ name: 'cod_bucket', count: 1 }, { name: 'bread', count: 4 }, { name: 'salmon_bucket', count: 1 }];
        for (const foods of [R.foodsByName, Object.keys(R.foodsByName), new Set(Object.keys(R.foodsByName)), (n) => Boolean(R.foodsByName[n])]) {
            assert.deepEqual(BAG.storeKinds(items, { foods }).map((k) => k.name).sort(), ['cod_bucket', 'salmon_bucket']);
        }
    });

    test('the auto-eat plugin gets the four fish buckets banned', () => {
        const opts = F.autoEatOptions({});
        for (const name of BUCKETS) assert.ok(opts.bannedFood.includes(name), name);
        assert.deepEqual([...F.FISH_BUCKETS].sort(), [...BUCKETS].sort());
    });
});
