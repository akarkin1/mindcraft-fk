// v0.1.4.15, SPEC 2.1 and 2.6 (engineer E1): the seed names of the survey (block names only, never an ore, every gate, door,
// trapdoor and bed of the 26.1 registry), the ore-blind reader on a grid full of every ore of the registry (no result of the
// scans names an ore: PLAN 4 decision 1 and the risk of PLAN 9), and seedsOf from the blocks and the entities.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { loadSrc, TEST_MC_VERSION } from '../helpers/load.js';
import { createBlockWorld, vec } from '../helpers/block_world.js';

const L = await loadSrc('src/agent/packs/survey/survey_logic.js');
const S = await loadSrc('src/agent/areas/area_scan.js');
const F = await loadSrc('src/agent/areas/open_farm.js');
const CROP = await loadSrc('src/agent/packs/farming/crop_logic.js');

const md = minecraftData(TEST_MC_VERSION);
const registry = md.blocksArray.map(b => b.name);
const ORES = registry.filter(n => n.endsWith('_ore') || n === 'ancient_debris');

const isOre = (name) => typeof name === 'string' && (/_ore$/.test(name.replace(/^minecraft:/, '')) || name.endsWith('ancient_debris'));
const namesOre = (value) => /_ore\b|ancient_debris/.test(JSON.stringify(value));

describe('SEED_NAMES (2.1)', () => {
    test('frozen, by category, block names of the 26.1 registry only, never an ore', () => {
        assert.ok(Object.isFrozen(L.SEED_NAMES));
        assert.deepEqual(Object.keys(L.SEED_NAMES), ['farmland', 'gates', 'doors', 'rooms', 'jobs', 'cane', 'portal', 'down']);
        assert.deepEqual(L.SEED_CATEGORIES, Object.keys(L.SEED_NAMES));
        for (const [category, names] of Object.entries(L.SEED_NAMES)) {
            assert.ok(Object.isFrozen(names), category);
            assert.ok(names.length > 0, category);
            for (const name of names) {
                assert.equal(typeof name, 'string', `${category}: ${name}`);
                assert.ok(!name.endsWith('_ore') && name !== 'ancient_debris', `${category} holds the ore ${name}`);
                assert.ok(!name.startsWith('minecraft:'), `${category}: ${name} with a prefix`);
                assert.ok(md.blocksByName[name], `${category}: ${name} is no block of ${TEST_MC_VERSION}`);
            }
            assert.equal(new Set(names).size, names.length, `${category} repeats a name`);
        }
    });

    test('farmland: the farmland and the crop blocks of crop_logic.js', () => {
        assert.deepEqual([...L.SEED_NAMES.farmland], ['farmland', ...CROP.CROPS.map(c => c.block)]);
    });

    test('gates: every fence gate of the registry; doors: every door that is a block and no trapdoor; down: every trapdoor and the ladder', () => {
        assert.deepEqual([...L.SEED_NAMES.gates].sort(), registry.filter(n => n.endsWith('_fence_gate')).sort());
        assert.deepEqual([...L.SEED_NAMES.doors].sort(), registry.filter(n => n.endsWith('_door')).sort());
        assert.ok(L.SEED_NAMES.doors.every(n => !n.includes('trapdoor')));
        assert.deepEqual([...L.SEED_NAMES.down].sort(), [...registry.filter(n => n.endsWith('_trapdoor')), 'ladder'].sort());
    });

    test('rooms: the 16 beds, the chest, the 8 copper chests, barrel, the furnaces and the crafting table; jobs the job sites', () => {
        const beds = registry.filter(n => n.endsWith('_bed'));
        assert.equal(beds.length, 16);
        assert.deepEqual([...L.SEED_NAMES.rooms].sort(), [...beds, 'chest', ...S.COPPER_CHESTS, 'barrel', 'furnace', 'blast_furnace', 'smoker', 'crafting_table'].sort());
        assert.equal(S.COPPER_CHESTS.length, 8);
        assert.deepEqual([...L.SEED_NAMES.jobs], ['lectern', 'composter', 'smithing_table', 'fletching_table', 'cartography_table', 'loom', 'stonecutter',
            'grindstone', 'brewing_stand', 'barrel', 'cauldron', 'blast_furnace', 'smoker']);
        assert.deepEqual([...L.SEED_NAMES.cane], ['sugar_cane']);
        assert.deepEqual([...L.SEED_NAMES.portal], ['nether_portal']);
    });

    test('isOreName: every ore of the registry and nothing of the seeds', () => {
        assert.equal(ORES.length, 19, ORES.join(' '));
        for (const ore of ORES) {
            assert.equal(L.isOreName(ore), true, ore);
            assert.equal(L.isOreName(`minecraft:${ore}`), true, ore);
        }
        for (const names of Object.values(L.SEED_NAMES)) {
            for (const name of names) assert.equal(L.isOreName(name), false, name);
        }
        assert.equal(L.isOreName(null), false);
        assert.equal(L.isOreName('stone'), false);
    });
});

// A grid full of every ore of the registry: the rock under y 63 is ore, one of the 19 by turns, and the ground is grass.
function oreGrid() {
    const w = createBlockWorld().flatGround(63);
    let i = 0;
    for (let x = -24; x <= 24; x++) {
        for (let z = -24; z <= 24; z++) {
            for (let y = 40; y <= 62; y++) {
                w.set(x, y, z, ORES[i++ % ORES.length]);
            }
        }
    }
    return w;
}

describe('oreBlind (2.1): the reader of the scans never names an ore', () => {
    test('every ore reads as stone, a deepslate ore as deepslate, ancient debris as netherrack; the rest unchanged, null stays null', () => {
        const names = new Map([['iron_ore', 'stone'], ['deepslate_iron_ore', 'deepslate'], ['nether_gold_ore', 'stone'], ['nether_quartz_ore', 'stone'],
            ['ancient_debris', 'netherrack'], ['minecraft:coal_ore', 'stone'], ['minecraft:deepslate_coal_ore', 'deepslate'], ['stone', 'stone'],
            ['minecraft:grass_block', 'minecraft:grass_block'], ['oak_door', 'oak_door']]);
        const read = L.oreBlind((x) => [...names.keys()][x] ?? null);
        [...names.values()].forEach((expected, x) => assert.equal(read(x, 0, 0), expected, [...names.keys()][x]));
        assert.equal(read(99, 0, 0), null);
        for (const ore of ORES) {
            const r = L.oreBlind(() => ore)(0, 0, 0);
            assert.ok(!isOre(r), `${ore} reads as ${r}`);
            assert.ok(['stone', 'deepslate', 'netherrack'].includes(r), `${ore} reads as ${r}`);
        }
    });

    test('a bad reader never throws: not a function, a throw, a non-string', () => {
        assert.equal(L.oreBlind(null)(0, 0, 0), null);
        assert.equal(L.oreBlind(() => { throw new Error('x'); })(0, 0, 0), null);
        assert.equal(L.oreBlind(() => 42)(0, 0, 0), null);
        assert.equal(L.oreBlind(() => undefined)(0, 0, 0), null);
    });

    test('on the grid full of every ore: every read is blind, and the scans of a room, a farm and a pen name no ore', () => {
        const w = oreGrid();
        const read = L.oreBlind(w.getBlockName);
        let ores = 0;
        for (let x = -24; x <= 24; x += 3) {
            for (let z = -24; z <= 24; z += 3) {
                for (let y = 40; y <= 64; y++) {
                    if (isOre(w.getBlockName(x, y, z))) ores++;
                    assert.ok(!isOre(read(x, y, z)), `${x} ${y} ${z}`);
                }
            }
        }
        assert.ok(ores > 1000, 'the grid is full of ore');
        // a room dug in the ore with a chest and a ladder (a basement of the base), a house on top, a field and a pen
        w.fill(-3, 55, -3, 3, 59, 3, 'air');
        w.set(2, 56, 2, 'chest');
        w.fill(0, 56, 0, 0, 63, 0, 'ladder');
        w.set(0, 64, 0, 'oak_trapdoor');
        const house = w.house({ x: -4, y: 63, z: -4, width: 9, depth: 9 });
        w.fill(8, 63, 0, 12, 63, 4, 'farmland');
        w.fill(8, 64, 0, 12, 64, 4, 'potatoes');
        const pen = w.field({ x: -14, y: 63, z: 0, width: 5, depth: 5, ground: 'grass_block', crop: null });
        const results = [
            S.scanEnclosure(read, { x: 0.5, y: 56, z: 1.5 }, { tunnelAt: null }),
            S.scanEnclosure(read, { x: house.inside.x + 0.5, y: house.inside.y, z: house.inside.z + 0.5 }, { mode: 'building', floors: true }),
            F.findOpenFarm(read, { x: 10.5, y: 64, z: 2.5 }),
            S.scanPenBehindGate(read, pen.gate),
        ];
        for (const r of results) {
            assert.ok(!namesOre(r), JSON.stringify(r));
        }
        assert.equal(results[1].found, true, 'the house on the ore is found');
        assert.equal(results[2].found, true, 'the field on the ore is found');
        assert.equal(results[3].found, true, 'the pen on the ore is found');
        // findPlaces through a reader that is NOT blind: its own guard holds
        const seeds = L.seedsOf({ farmland: w.positionsOf('farmland'), gates: w.positionsOf(pen.gate ? 'oak_fence_gate' : 'x'), doors: w.positionsOf('oak_door') },
            [{ id: 1, name: 'cow', type: 'animal', position: vec(-12.5, 64, 2.5) }]);
        const found = L.findPlaces(w.getBlockName, seeds, [], {});
        assert.ok(found.places.length >= 3, JSON.stringify(found.places.map(p => p.name)));
        assert.ok(!namesOre(found), JSON.stringify(found));
    });
});

describe('seedsOf (2.1)', () => {
    test('the blocks: plain whole positions, no duplicates, sorted by x, z, y; the portal under portal or portals', () => {
        const seeds = L.seedsOf({
            farmland: [vec(2, 63, 1), { x: 1.7, y: 63.2, z: 1.1 }, vec(1, 63, 1), vec(1, 63, 0)],
            gates: [vec(0, 64, 0)], doors: [], rooms: [vec(3, 64, 3)], jobs: null, cane: undefined, portal: [vec(5, 64, 5)], portals: [vec(5, 65, 5)],
            down: [vec(1, 64, 1)],
        }, {});
        assert.deepEqual(seeds.farmland, [{ x: 1, y: 63, z: 0 }, { x: 1, y: 63, z: 1 }, { x: 2, y: 63, z: 1 }]);
        assert.deepEqual(seeds.gates, [{ x: 0, y: 64, z: 0 }]);
        assert.deepEqual(seeds.doors, []);
        assert.deepEqual(seeds.rooms, [{ x: 3, y: 64, z: 3 }]);
        assert.deepEqual(seeds.jobs, []);
        assert.deepEqual(seeds.cane, []);
        assert.deepEqual(seeds.portals, [{ x: 5, y: 64, z: 5 }, { x: 5, y: 65, z: 5 }]);
        assert.deepEqual(seeds.down, [{ x: 1, y: 64, z: 1 }]);
        assert.deepEqual(seeds.villagers, []);
        assert.deepEqual(seeds.animals, []);
        assert.deepEqual(seeds.tied, []);
        for (const p of seeds.farmland) assert.deepEqual(Object.keys(p), ['x', 'y', 'z']);
    });

    test('the villagers with their profession: set by the caller, from the metadata by id or by word, else unknown', () => {
        const meta = (profession) => { const m = []; m[18] = { villagerType: 1, villagerProfession: profession, level: 2 }; return m; };
        const seeds = L.seedsOf({}, {
            1: { id: 1, name: 'villager', type: 'passive', position: vec(1.5, 64, 1.5), metadata: meta(9) },
            2: { id: 2, name: 'minecraft:villager', type: 'passive', position: vec(2.5, 64, 1.5), profession: 'Farmer L2' },
            3: { id: 3, name: 'villager', type: 'passive', position: vec(3.5, 64, 1.5), metadata: meta('cleric') },
            4: { id: 4, name: 'villager', type: 'passive', position: vec(4.5, 64, 1.5) },
            5: { id: 5, name: 'player', type: 'player', username: 'owner', position: vec(5.5, 64, 1.5) },
        });
        assert.deepEqual(seeds.villagers, [
            { pos: { x: 1, y: 64, z: 1 }, profession: 'librarian' },
            { pos: { x: 2, y: 64, z: 1 }, profession: 'farmer' },
            { pos: { x: 3, y: 64, z: 1 }, profession: 'cleric' },
            { pos: { x: 4, y: 64, z: 1 }, profession: 'unknown' },
        ]);
        assert.deepEqual(seeds.animals, []);
    });

    test('the animals: by name (pets among them) or by the type animal; players, villagers, items and monsters are none', () => {
        const seeds = L.seedsOf({}, [
            { id: 1, name: 'cow', type: 'animal', position: vec(1.5, 64, 1.5) },
            { id: 2, name: 'minecraft:cat', type: 'animal', position: vec(2.5, 64, 1.5) },
            { id: 3, name: 'sniffer', type: 'mob', position: vec(3.5, 64, 1.5) },
            { id: 4, name: 'allay', type: 'animal', position: vec(4.5, 64, 1.5) },
            { id: 5, name: 'zombie', type: 'hostile', position: vec(5.5, 64, 1.5) },
            { id: 6, name: 'item', type: 'object', position: vec(6.5, 64, 1.5) },
            { id: 7, name: 'villager', type: 'passive', position: vec(7.5, 64, 1.5) },
            { id: 8, name: 'player', type: 'player', position: vec(8.5, 64, 1.5) },
            { id: 9, name: 'happy_ghast', type: 'animal', position: vec(9.5, 66, 1.5) },
        ]);
        assert.deepEqual(seeds.animals.map(a => a.name), ['cow', 'cat', 'sniffer', 'allay', 'happy_ghast']);
        assert.deepEqual(seeds.animals[1].pos, { x: 2, y: 64, z: 1 });
        assert.ok(L.ANIMAL_NAMES.includes('happy_ghast'));
    });

    test('the tied entity and its knot: by the leash holder (an id or the entity), else the animal nearest to the knot within the leash', () => {
        const knot = { id: 10, name: 'leash_knot', type: 'other', position: vec(8, 65, 8) };
        const byId = L.seedsOf({}, {
            10: knot,
            11: { id: 11, name: 'happy_ghast', type: 'animal', position: vec(10.5, 68, 9.5), leashHolder: 10 },
            12: { id: 12, name: 'cow', type: 'animal', position: vec(8.5, 64, 9.5) },
        });
        assert.deepEqual(byId.tied, [{ pos: { x: 10, y: 68, z: 9 }, name: 'happy_ghast', knot: { x: 8, y: 65, z: 8 } }]);
        const byEntity = L.seedsOf({}, [knot, { id: 11, name: 'minecraft:happy_ghast', type: 'animal', position: vec(10.5, 68, 9.5), leashHolder: knot }]);
        assert.deepEqual(byEntity.tied, [{ pos: { x: 10, y: 68, z: 9 }, name: 'happy_ghast', knot: { x: 8, y: 65, z: 8 } }]);
        // mineflayer knows no leashes: the nearest animal or mob within LEASH_RANGE blocks of the knot
        const nearest = L.seedsOf({}, [knot,
            { id: 11, name: 'happy_ghast', type: 'animal', position: vec(11.5, 69, 9.5) },
            { id: 12, name: 'cow', type: 'animal', position: vec(30, 64, 8) },
            { id: 13, name: 'villager', type: 'passive', position: vec(8.5, 65, 9.5) },
            { id: 14, name: 'item', type: 'object', position: vec(8.5, 65, 8.5) },
            { id: 15, name: 'player', type: 'player', position: vec(9, 65, 8) }]);
        assert.deepEqual(nearest.tied, [{ pos: { x: 11, y: 69, z: 9 }, name: 'happy_ghast', knot: { x: 8, y: 65, z: 8 } }]);
        assert.equal(L.LEASH_RANGE, 12);
        // a knot with nothing near it, a leash held by a player: no tied entry
        assert.deepEqual(L.seedsOf({}, [knot, { id: 12, name: 'cow', type: 'animal', position: vec(30, 64, 8) }]).tied, []);
        assert.deepEqual(L.seedsOf({}, [{ id: 15, name: 'player', type: 'player', position: vec(9, 65, 8) },
            { id: 11, name: 'cow', type: 'animal', position: vec(9.5, 65, 9.5), leashHolder: 15 }]).tied, []);
    });

    test('bad input never throws and gives empty lists', () => {
        for (const args of [[null, null], [undefined, undefined], [{ farmland: 'x', gates: 3 }, 'entities'], [[], [null, 1, { name: 'cow' }]]]) {
            const seeds = L.seedsOf(...args);
            for (const key of ['farmland', 'gates', 'doors', 'rooms', 'jobs', 'cane', 'portals', 'down', 'villagers', 'animals', 'tied']) {
                assert.deepEqual(seeds[key], [], `${key} of ${JSON.stringify(args)}`);
            }
        }
    });
});
