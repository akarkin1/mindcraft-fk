// v0.1.4.15, SPEC 2.2 and 2.6 (engineer E1): findPlaces of src/agent/packs/survey/survey_logic.js on synthetic grids, one
// detector at a time: a 9 x 5 potato field, a fenced pen with 5 cows and a roof, a house with 2 cats and a bed, a hall with 3
// villagers at lecterns, a cane row of 22 by water, a portal, a tied ghast; the names and their suffixes; `kept` for a find
// inside the owner's farm; the replace of a former survey's find; the ore guard of the reader.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { createBlockWorld, vec } from '../helpers/block_world.js';

const L = await loadSrc('src/agent/packs/survey/survey_logic.js');

const animal = (name, x, y, z, id = 1) => ({ id, name, type: 'animal', position: vec(x, y, z) });
const villager = (x, y, z, profession, id = 1) => ({ id, name: 'villager', type: 'passive', position: vec(x, y, z), profession });

// The seeds of a world: every block of the categories the world holds, and the entities.
function seedsIn(world, entities = []) {
    const blocks = {};
    for (const [category, names] of Object.entries(L.SEED_NAMES)) {
        blocks[category] = world.positionsOf(name => names.includes(name));
    }
    return L.seedsOf(blocks, entities);
}

function survey(world, entities = [], saved = { areas: [], places: [] }, options = {}) {
    return L.findPlaces(world.getBlockName, seedsIn(world, entities), saved, options);
}

const names = (result) => result.places.map(p => p.name);
const SHAPE = ['at', 'border', 'box', 'contents', 'detail', 'entrances', 'kind', 'name', 'source', 'type'];

// The potato field of the spec: 9 x 5 of farmland at y 63 with potatoes on it, no fence.
function potatoField(world = createBlockWorld().flatGround(63), x0 = 0, z0 = 0) {
    world.fill(x0, 63, z0, x0 + 8, 63, z0 + 4, 'farmland');
    world.fill(x0, 64, z0, x0 + 8, 64, z0 + 4, 'potatoes');
    return world;
}

describe('the open farm (2.2, a 9 x 5 potato field)', () => {
    test('one place potato_farm: kind farm, type farm, border open, the box of findOpenFarm, the field 9 x 5, 45 potatoes', () => {
        const r = survey(potatoField());
        assert.deepEqual(names(r), ['potato_farm']);
        const farm = r.places[0];
        assert.deepEqual(Object.keys(farm).sort(), SHAPE);
        assert.equal(farm.kind, 'farm');
        assert.equal(farm.type, 'farm');
        assert.equal(farm.border, 'open');
        assert.equal(farm.source, 'survey');
        assert.equal(farm.at, null);
        assert.deepEqual(farm.entrances, []);
        assert.deepEqual(farm.box, { min: { x: -1, y: 63, z: -1 }, max: { x: 9, y: 65, z: 5 } });
        assert.deepEqual(farm.detail.field, { min: { x: 0, y: 63, z: 0 }, max: { x: 8, y: 63, z: 4 } });
        assert.equal(farm.detail.farmland, 45);
        assert.equal(farm.detail.crop, 'potatoes');
        assert.equal(farm.detail.fenced, false);
        assert.deepEqual(farm.contents.crops, { potatoes: 45 });
        assert.deepEqual(r.kept, []);
        assert.deepEqual(r.skipped, []);
    });

    test('the name is the main crop: carrot_farm, wheat_farm, beetroot_farm; farm without a crop; a mixed field by the majority', () => {
        for (const [crop, name] of [['carrots', 'carrot_farm'], ['wheat', 'wheat_farm'], ['beetroots', 'beetroot_farm']]) {
            const w = createBlockWorld().flatGround(63);
            w.fill(0, 63, 0, 4, 63, 4, 'farmland');
            w.fill(0, 64, 0, 4, 64, 4, crop);
            assert.deepEqual(names(survey(w)), [name]);
        }
        const bare = createBlockWorld().flatGround(63);
        bare.fill(0, 63, 0, 4, 63, 4, 'farmland');
        assert.deepEqual(names(survey(bare)), ['farm']);
        const mixed = createBlockWorld().flatGround(63);
        mixed.fill(0, 63, 0, 6, 63, 2, 'farmland');
        mixed.fill(0, 64, 0, 2, 64, 2, 'carrots');
        mixed.fill(3, 64, 0, 6, 64, 2, 'potatoes');
        const r = survey(mixed);
        assert.deepEqual(names(r), ['potato_farm']);
        assert.deepEqual(r.places[0].contents.crops, { carrots: 9, potatoes: 12 });
        assert.equal(L.farmName({ crops: { wheat: 3, carrots: 3 } }), 'carrot_farm', 'a tie by name');
        assert.equal(L.farmName({ crops: { melon_stem: 9 } }), 'farm', 'a crop not of the table');
        assert.equal(L.farmName(null), 'farm');
    });

    test('every farmland seed of the field gives one farm, and a second field gives potato_farm_2', () => {
        const w = potatoField();
        potatoField(w, 20, 0);
        const r = survey(w);
        assert.deepEqual(names(r), ['potato_farm', 'potato_farm_2']);
        assert.equal(r.places[1].box.min.x, 19);
    });

    test('a fenced field is a farm with the border fence, its gate and the field inside the fence; the gate makes no pen', () => {
        const w = createBlockWorld().flatGround(63);
        const field = w.field({ x: 0, y: 63, z: 0, width: 5, depth: 4, crop: 'wheat' });
        const r = survey(w);
        assert.deepEqual(names(r), ['wheat_farm']);
        const farm = r.places[0];
        assert.equal(farm.border, 'fence');
        assert.equal(farm.detail.fenced, true);
        assert.deepEqual(farm.entrances, [{ ...field.gate, kind: 'gate' }]);
        assert.deepEqual({ x: farm.detail.field.max.x - farm.detail.field.min.x + 1, z: farm.detail.field.max.z - farm.detail.field.min.z + 1 }, { x: 5, z: 4 });
        assert.equal(farm.box.min.x, -1);
        assert.deepEqual(r.skipped, [], 'the gate lies inside the found farm');
    });
});

// A fenced pen 7 x 5 of grass with a gate in the south fence and a roof of planks over it.
function pen(world = createBlockWorld().flatGround(63), { roof = true, x = 0, z = 0 } = {}) {
    const f = world.field({ x, y: 63, z, width: 7, depth: 5, ground: 'grass_block', crop: null });
    if (roof) world.fill(x - 1, 66, z - 1, x + 7, 66, z + 5, 'oak_planks');
    return f;
}
const cows = (n, x0 = 1, z0 = 1) => Array.from({ length: n }, (_, i) => animal('cow', x0 + i, 64, z0, 10 + i));

describe('the pen behind a gate (2.2, a fenced pen with 5 cows and a roof)', () => {
    test('one place cow_pen: kind pen, type pen, border fence, the gate, 5 cows, the roof noted', () => {
        const w = createBlockWorld().flatGround(63);
        const f = pen(w);
        const r = survey(w, cows(5));
        assert.deepEqual(names(r), ['cow_pen']);
        const p = r.places[0];
        assert.deepEqual(Object.keys(p).sort(), SHAPE);
        assert.equal(p.kind, 'pen');
        assert.equal(p.type, 'pen');
        assert.equal(p.border, 'fence');
        assert.deepEqual(p.contents.animals, { cow: 5 });
        assert.deepEqual(p.entrances, [{ ...f.gate, kind: 'gate' }]);
        assert.equal(p.detail.species, 'cow');
        assert.equal(p.detail.roof, true);
        assert.deepEqual(p.box, { min: { x: -1, y: 62, z: -1 }, max: { x: 7, y: 66, z: 5 } });
        assert.deepEqual(r.skipped, []);
    });

    test('the majority species names it (pig_pen, chicken_pen, sheep_pen); pets do not count; a cat alone makes no pen', () => {
        const w = createBlockWorld().flatGround(63);
        pen(w, { roof: false });
        assert.deepEqual(names(survey(w, [...Array.from({ length: 4 }, (_, i) => animal('pig', 1 + i, 64, 1, 10 + i)), animal('cow', 5, 64, 3, 20)])), ['pig_pen']);
        assert.deepEqual(names(survey(w, [animal('chicken', 1, 64, 1, 1), animal('chicken', 2, 64, 1, 2), animal('cat', 3, 64, 1, 3), animal('cat', 4, 64, 1, 4),
            animal('cat', 5, 64, 1, 5)])), ['chicken_pen'], 'three cats and two chickens: the chickens name it');
        assert.deepEqual(names(survey(w, [animal('sheep', 1, 64, 1)])), ['sheep_pen']);
        assert.equal(L.penName({ animals: { cow: 2, pig: 2 } }), 'cow_pen', 'a tie by name');
        assert.equal(L.penName({ animals: { cat: 3 } }), 'pen');
    });

    test('a fence ring with a gate and no animal is a yard (kind yard, type building), never a pen the bot keeps out of', () => {
        const w = createBlockWorld().flatGround(63);
        const f = pen(w, { roof: false });
        const r = survey(w);
        assert.deepEqual(names(r), ['yard']);
        assert.equal(r.places[0].kind, 'yard');
        assert.equal(r.places[0].type, 'building');
        assert.equal(r.places[0].border, 'fence');
        assert.deepEqual(r.places[0].entrances, [{ ...f.gate, kind: 'gate' }]);
        assert.deepEqual(names(survey(w, [animal('cat', 2, 64, 2), animal('wolf', 3, 64, 2, 2)])), ['yard'], 'pets alone make no pen');
    });

    test('a gate with no fence behind it is skipped with the reason; two pens give cow_pen and pig_pen; a second gate of one pen makes no second pen', () => {
        const w = createBlockWorld().flatGround(63);
        w.set(10, 64, 10, 'oak_fence_gate');
        const r = survey(w);
        assert.deepEqual(r.places, []);
        assert.deepEqual(r.skipped, [{ reason: 'no_pen', at: { x: 10, y: 64, z: 10 } }]);
        const two = createBlockWorld().flatGround(63);
        pen(two, { roof: false });
        pen(two, { roof: false, x: 20 });
        two.set(3, 64, -1, 'oak_fence_gate'); // a second gate in the north fence of the first pen
        const both = survey(two, [...cows(5), animal('pig', 22, 64, 2, 30), animal('pig', 23, 64, 2, 31)]);
        assert.deepEqual(names(both), ['cow_pen', 'pig_pen']);
        assert.equal(both.places[0].entrances.length, 2);
    });
});

describe('the building behind a door (2.2, a house with 2 cats and a bed)', () => {
    test('one place house: kind home, type home, border wall, the door, 1 bed, 1 chest, 2 cats; the upper door half and the second side give no second place', () => {
        const w = createBlockWorld().flatGround(63);
        const h = w.house({ x: 0, y: 63, z: 0, width: 7, depth: 9 });
        const cats = [animal('cat', h.inside.x + 0.5, 64, h.inside.z + 0.5, 1), animal('cat', h.inside.x - 1.5, 64, h.inside.z + 0.5, 2)];
        const r = survey(w, cats);
        assert.deepEqual(names(r), ['house']);
        const house = r.places[0];
        assert.deepEqual(Object.keys(house).sort(), SHAPE);
        assert.equal(house.kind, 'home');
        assert.equal(house.type, 'home');
        assert.equal(house.border, 'wall');
        assert.deepEqual(house.entrances, [{ ...h.door, kind: 'door' }]);
        assert.deepEqual(house.contents.animals, { cat: 2 });
        assert.equal(house.contents.beds, 1);
        assert.equal(house.contents.chests, 1);
        assert.equal(house.detail.villagers, 0);
        assert.equal(house.detail.roof, true);
        assert.ok(house.box.min.x <= h.door.x && house.box.max.x >= h.door.x && house.box.min.z <= h.door.z && house.box.max.z >= h.door.z, 'the box holds the door');
        assert.ok(house.box.min.x <= 0 && house.box.max.x >= 6 && house.box.min.z <= 0 && house.box.max.z >= 8, 'the box holds the walls');
        assert.deepEqual(r.skipped, []);
    });

    test('without a bed the building is a storage (chests) or a building; a door with nothing around it is skipped with the reason', () => {
        const storage = createBlockWorld().flatGround(63);
        storage.house({ x: 0, y: 63, z: 0, bed: null });
        const s = survey(storage);
        assert.deepEqual(names(s), ['storage']);
        assert.equal(s.places[0].kind, 'storage');
        assert.equal(s.places[0].type, 'building');
        const plain = createBlockWorld().flatGround(63);
        plain.house({ x: 0, y: 63, z: 0, bed: null, chest: null });
        const b = survey(plain);
        assert.deepEqual(names(b), ['building']);
        assert.equal(b.places[0].kind, 'building');
        const lone = createBlockWorld().flatGround(63);
        lone.set(5, 64, 5, 'oak_door');
        lone.set(5, 65, 5, 'oak_door');
        const l = survey(lone);
        assert.deepEqual(l.places, []);
        assert.deepEqual(l.skipped, [{ reason: 'no_building', at: { x: 5, y: 64, z: 5 } }]);
    });

    test('two houses: house and house_2', () => {
        const w = createBlockWorld().flatGround(63);
        w.house({ x: 0, y: 63, z: 0 });
        w.house({ x: 20, y: 63, z: 0 });
        assert.deepEqual(names(survey(w)), ['house', 'house_2']);
    });
});

describe('the trading hall (2.2, 3 villagers at lecterns)', () => {
    test('inside a found building: the building is the trading_hall, kind building, with the villagers and their professions', () => {
        const w = createBlockWorld().flatGround(63);
        const h = w.house({ x: 0, y: 63, z: 0, width: 9, depth: 9, bed: null, chest: null });
        for (const x of [2, 4, 6]) w.set(x, 64, 2, 'lectern');
        const villagers = [villager(2.5, 64, 3.5, 'librarian', 1), villager(4.5, 64, 3.5, 'librarian', 2), villager(6.5, 64, 3.5, 'librarian', 3)];
        const r = survey(w, villagers);
        assert.deepEqual(names(r), ['trading_hall']);
        const hall = r.places[0];
        assert.equal(hall.kind, 'building');
        assert.equal(hall.type, 'building');
        assert.equal(hall.detail.villagers, 3);
        assert.deepEqual(hall.detail.professions, ['librarian']);
        assert.deepEqual(hall.entrances, [{ ...h.door, kind: 'door' }]);
        assert.ok(hall.box, 'an area, not a point');
    });

    test('a building with 2 villagers and no job site is a hall; one villager at a lectern makes no hall', () => {
        const w = createBlockWorld().flatGround(63);
        w.house({ x: 0, y: 63, z: 0, width: 9, depth: 9, bed: null, chest: null });
        assert.deepEqual(names(survey(w, [villager(2.5, 64, 3.5, 'nitwit', 1), villager(4.5, 64, 3.5, 'nitwit', 2)])), ['hall']);
        w.set(2, 64, 2, 'lectern');
        assert.deepEqual(names(survey(w, [villager(2.5, 64, 3.5, 'librarian', 1)])), ['building']);
    });

    test('outside any building: a point trading_hall at the villagers\' centre, type place, with their professions', () => {
        const w = createBlockWorld().flatGround(63);
        w.set(10, 64, 10, 'lectern');
        w.set(14, 64, 10, 'composter');
        const r = survey(w, [villager(10.5, 64, 11.5, 'librarian', 1), villager(12.5, 64, 11.5, 'farmer', 2), villager(14.5, 64, 11.5, 'farmer', 3),
            villager(40.5, 64, 11.5, 'cleric', 4)]);
        assert.deepEqual(names(r), ['trading_hall']);
        const hall = r.places[0];
        assert.deepEqual(Object.keys(hall).sort(), SHAPE);
        assert.equal(hall.kind, 'trading_hall');
        assert.equal(hall.type, 'place');
        assert.equal(hall.box, null);
        assert.deepEqual(hall.at, { x: 12, y: 64, z: 11 });
        assert.deepEqual(hall.entrances, []);
        assert.equal(hall.border, null);
        assert.equal(hall.detail.villagers, 3);
        assert.deepEqual(hall.detail.professions, ['farmer', 'librarian']);
        assert.equal(L.HALL_REACH, 6);
    });
});

describe('the cane by the water (2.2, a row of 22)', () => {
    // sand along x 0..21 at z 0 with the water beside it at z 1, sugar cane 3 high on the sand
    function caneRow(n = 22, height = 3) {
        const w = createBlockWorld().flatGround(63);
        for (let x = 0; x < n; x++) {
            w.set(x, 63, 0, 'sand');
            w.set(x, 63, 1, 'water');
            for (let y = 64; y < 64 + height; y++) w.set(x, y, 0, 'sugar_cane');
        }
        return w;
    }

    test('one place cane: kind farm, type farm, border open, the count of the plants (22, not the blocks), the box with a margin of 1', () => {
        const r = survey(caneRow());
        assert.deepEqual(names(r), ['cane']);
        const cane = r.places[0];
        assert.deepEqual(Object.keys(cane).sort(), SHAPE);
        assert.equal(cane.kind, 'farm');
        assert.equal(cane.type, 'farm');
        assert.equal(cane.border, 'open');
        assert.deepEqual(cane.entrances, []);
        assert.equal(cane.detail.count, 22);
        assert.equal(cane.detail.what, 'cane');
        assert.deepEqual(cane.box, { min: { x: -1, y: 63, z: -1 }, max: { x: 22, y: 67, z: 1 } }, 'the sand under the cane, the top of the cane, 1 around');
    });

    test('a group needs 3 plants; cane with no water within 1 block is none; two rows apart are cane and cane_2', () => {
        assert.deepEqual(names(survey(caneRow(2))), []);
        assert.equal(L.CANE_MIN, 3);
        const dry = createBlockWorld().flatGround(63);
        for (let x = 0; x < 5; x++) dry.set(x, 64, 0, 'sugar_cane');
        assert.deepEqual(names(survey(dry)), []);
        const two = caneRow(4);
        for (let x = 10; x < 14; x++) {
            two.set(x, 63, 0, 'sand');
            two.set(x, 63, 1, 'water');
            two.set(x, 64, 0, 'sugar_cane');
        }
        const r = survey(two);
        assert.deepEqual(names(r), ['cane', 'cane_2']);
        assert.equal(r.places[1].detail.count, 4);
        assert.equal(r.places[1].box.max.y, 65);
    });
});

describe('the portal and the tied animal (2.2)', () => {
    test('a portal: the lowest block of the group, type place, the count of its blocks; two portals apart are portal and portal_2', () => {
        const w = createBlockWorld().flatGround(63);
        w.fill(4, 64, 0, 5, 66, 0, 'nether_portal');
        w.fill(3, 63, 0, 6, 68, 0, 'obsidian');
        w.fill(4, 64, 0, 5, 66, 0, 'nether_portal');
        const r = survey(w);
        assert.deepEqual(names(r), ['portal']);
        const portal = r.places[0];
        assert.deepEqual(Object.keys(portal).sort(), SHAPE);
        assert.equal(portal.kind, 'portal');
        assert.equal(portal.type, 'place');
        assert.equal(portal.box, null);
        assert.deepEqual(portal.at, { x: 4, y: 64, z: 0 });
        assert.equal(portal.detail.blocks, 6);
        w.fill(20, 64, 0, 21, 66, 0, 'nether_portal');
        assert.deepEqual(names(survey(w)), ['portal', 'portal_2']);
    });

    test('a tied ghast: the place tied_happy_ghast at the knot, type place, with the animal and where it floats', () => {
        const w = createBlockWorld().flatGround(63);
        w.fill(8, 64, 8, 8, 65, 8, 'oak_fence');
        const r = survey(w, [
            { id: 1, name: 'leash_knot', type: 'other', position: vec(8, 65, 8) },
            { id: 2, name: 'happy_ghast', type: 'animal', position: vec(10.5, 68, 9.5), leashHolder: 1 },
        ]);
        assert.deepEqual(names(r), ['tied_happy_ghast']);
        const tied = r.places[0];
        assert.deepEqual(Object.keys(tied).sort(), SHAPE);
        assert.equal(tied.kind, 'tied');
        assert.equal(tied.type, 'place');
        assert.equal(tied.box, null);
        assert.deepEqual(tied.at, { x: 8, y: 65, z: 8 });
        assert.deepEqual(tied.detail, { animal: 'happy_ghast', animalAt: { x: 10, y: 68, z: 9 } });
    });
});

describe('the names, the owner\'s areas and the replace of a former survey\'s find (2.2)', () => {
    const area = (name, min, max, more = {}) => ({ name, type: 'farm', kind: 'farm', min, max, dimension: 'overworld', source: 'manual', ...more });

    test('uniqueName: the name, else _2, _3 against the taken names', () => {
        assert.equal(L.uniqueName('potato_farm', []), 'potato_farm');
        assert.equal(L.uniqueName('potato_farm', ['potato_farm']), 'potato_farm_2');
        assert.equal(L.uniqueName('potato_farm', new Set(['potato_farm', 'potato_farm_2'])), 'potato_farm_3');
    });

    test('a found name collides with a saved area or a saved place of that name: _2', () => {
        const w = potatoField();
        const byArea = survey(w, [], { areas: [area('potato_farm', { x: 50, y: 63, z: 50 }, { x: 60, y: 65, z: 60 })], places: [] });
        assert.deepEqual(names(byArea), ['potato_farm_2']);
        const byPlace = survey(w, [], { areas: [], places: [{ name: 'potato_farm', x: 50, y: 64, z: 50, dimension: 'overworld' }] });
        assert.deepEqual(names(byPlace), ['potato_farm_2']);
        const asArray = survey(w, [], [area('potato_farm', { x: 50, y: 63, z: 50 }, { x: 60, y: 65, z: 60 })]);
        assert.deepEqual(names(asArray), ['potato_farm_2'], 'a plain array of areas');
    });

    test('kept: the owner\'s wheat_farm over half of the potato field (W126 C): the field is kept, not saved, and the owner\'s area is untouched', () => {
        const w = potatoField();
        const owner = area('wheat_farm', { x: 4, y: 63, z: -1 }, { x: 12, y: 65, z: 5 }); // x 4..12: 5 of the 9 columns of the field
        const r = survey(w, [], { areas: [owner], places: [] });
        assert.deepEqual(r.places, []);
        assert.equal(r.kept.length, 1);
        assert.equal(r.kept[0].name, 'potato_farm');
        assert.equal(r.kept[0].inside, 'wheat_farm');
        assert.equal(r.kept[0].kind, 'farm');
        assert.deepEqual(r.kept[0].at, { x: 4, y: 64, z: 2 });
        assert.equal(r.kept[0].place.detail.farmland, 45);
        assert.deepEqual(owner, area('wheat_farm', { x: 4, y: 63, z: -1 }, { x: 12, y: 65, z: 5 }), 'nothing of the owner\'s changed');
    });

    test('W126 part C as T3 played it: the owner\'s wheat_farm of 6 x 2 x 7 over 6 of the 9 columns of the field (42 of the 77 columns of the find, 36 % of its volume) keeps the field: footprints count, not volumes', () => {
        const w = potatoField();
        const owner = area('wheat_farm', { x: 3, y: 63, z: -1 }, { x: 8, y: 64, z: 5 }); // 6 x 2 x 7 by hand (!setArea)
        const r = survey(w, [], { areas: [owner], places: [] });
        assert.deepEqual(r.places, [], 'no new potato_farm over the owner\'s area');
        assert.deepEqual(r.kept.map(k => [k.name, k.inside]), [['potato_farm', 'wheat_farm']]);
        assert.deepEqual(r.kept[0].place.box, { min: { x: -1, y: 63, z: -1 }, max: { x: 9, y: 65, z: 5 } }, 'the find is 11 x 3 x 7');
        // an owner's area over the same columns but above the field (a roof over it) overlaps in no y: the field is a find of its own
        const above = survey(w, [], { areas: [area('loft', { x: 3, y: 70, z: -1 }, { x: 8, y: 72, z: 5 }, { type: 'building', kind: 'building' })], places: [] });
        assert.deepEqual(names(above), ['potato_farm']);
        assert.deepEqual(above.kept, []);
        // the replace of a survey find compares footprints too: a saved survey farm 1 high over 6 columns is replaced
        const low = survey(w, [], { areas: [area('spuds', { x: 3, y: 63, z: -1 }, { x: 8, y: 63, z: 5 }, { source: 'survey' })], places: [] });
        assert.deepEqual(names(low), ['spuds']);
        assert.equal(low.places[0].detail.replaces, 'spuds');
    });

    test('a seed inside the owner\'s area is never scanned: the owner\'s farm over the whole field gives nothing; the owner\'s source scan, manual, radius, auto all count', () => {
        for (const source of ['scan', 'manual', 'radius', 'auto', undefined]) {
            const r = survey(potatoField(), [], { areas: [area('wheat_farm', { x: -2, y: 62, z: -2 }, { x: 10, y: 66, z: 6 }, { source })], places: [] });
            assert.deepEqual(r.places, [], source);
            assert.deepEqual(r.kept, [], source);
        }
    });

    test('less than half inside the owner\'s area: a find of its own; a point inside the owner\'s area is kept', () => {
        const r = survey(potatoField(), [], { areas: [area('wheat_farm', { x: 7, y: 63, z: -1 }, { x: 12, y: 65, z: 5 })], places: [] });
        assert.deepEqual(names(r), ['potato_farm']);
        assert.deepEqual(r.kept, []);
        const w = createBlockWorld().flatGround(63);
        w.fill(4, 64, 0, 5, 66, 0, 'nether_portal');
        const p = survey(w, [], { areas: [area('yard', { x: 0, y: 63, z: -3 }, { x: 8, y: 70, z: 3 }, { type: 'building', kind: 'yard' })], places: [] });
        assert.deepEqual(p.places, []);
        assert.deepEqual(p.kept.map(k => [k.name, k.inside, k.at]), [['portal', 'yard', { x: 4, y: 64, z: 0 }]]);
    });

    test('a saved survey farm of the same kind under the field is replaced: the name stays, the box and the contents are the new ones', () => {
        const w = potatoField();
        const former = area('spuds', { x: -1, y: 63, z: -1 }, { x: 5, y: 65, z: 5 }, { source: 'survey', contents: { crops: { potatoes: 20 } } });
        const r = survey(w, [], { areas: [former], places: [] });
        assert.deepEqual(names(r), ['spuds']);
        assert.equal(r.places[0].detail.replaces, 'spuds');
        assert.deepEqual(r.places[0].box, { min: { x: -1, y: 63, z: -1 }, max: { x: 9, y: 65, z: 5 } });
        assert.deepEqual(r.places[0].contents.crops, { potatoes: 45 });
        assert.deepEqual(r.kept, []);
        assert.deepEqual(r.skipped, []);
        const same = survey(w, [], { areas: [area('potato_farm', { x: -1, y: 63, z: -1 }, { x: 9, y: 65, z: 5 }, { source: 'survey' })], places: [] });
        assert.deepEqual(names(same), ['potato_farm'], 'the same box again: the name stays, no _2');
    });

    test('a saved survey area of another kind under the find is skipped with the reason; a saved survey point of the kind near a point keeps its name', () => {
        const w = potatoField();
        const r = survey(w, [], { areas: [area('cow_pen', { x: -1, y: 62, z: -1 }, { x: 9, y: 66, z: 5 }, { type: 'pen', kind: 'pen', source: 'survey' })], places: [] });
        assert.deepEqual(r.places, []);
        assert.deepEqual(r.skipped, [{ reason: 'other_kind', at: { x: 4, y: 64, z: 2 }, name: 'potato_farm', over: 'cow_pen' }]);
        const p = createBlockWorld().flatGround(63);
        p.fill(4, 64, 0, 5, 66, 0, 'nether_portal');
        const again = survey(p, [], { areas: [], places: [{ name: 'portal', x: 5, y: 64, z: 1, source: 'survey' }, { name: 'tied_cow', x: 4, y: 64, z: 0, source: 'survey' }] });
        assert.deepEqual(names(again), ['portal']);
        assert.equal(again.places[0].detail.replaces, 'portal');
        assert.equal(L.POINT_REACH, 4);
        const far = survey(p, [], { areas: [], places: [{ name: 'portal', x: 20, y: 64, z: 1, source: 'survey' }] });
        assert.deepEqual(names(far), ['portal_2']);
    });

    test('a home and a storage are one family for the replace (a house whose bed is gone keeps its name)', () => {
        const w = createBlockWorld().flatGround(63);
        const h = w.house({ x: 0, y: 63, z: 0, bed: null });
        const former = { name: 'house', type: 'home', kind: 'home', min: h.min, max: h.max, dimension: 'overworld', source: 'survey' };
        const r = survey(w, [], { areas: [former], places: [] });
        assert.deepEqual(names(r), ['house']);
        assert.equal(r.places[0].kind, 'storage');
        assert.equal(r.places[0].detail.replaces, 'house');
    });

    test('saved areas of another dimension are ignored when the dimension is given', () => {
        const w = potatoField();
        const nether = area('potato_farm', { x: -1, y: 63, z: -1 }, { x: 9, y: 65, z: 5 }, { dimension: 'the_nether' });
        assert.deepEqual(names(survey(w, [], { areas: [nether], places: [] }, { dimension: 'overworld' })), ['potato_farm']);
        assert.deepEqual(names(survey(w, [], { areas: [nether], places: [] })), [], 'without a dimension every area counts');
    });
});

describe('the whole base and the guards', () => {
    test('a house with 2 cats, a potato field, a pen with 5 cows, a cane row, villagers at job sites and a portal: every place, each once', () => {
        const w = createBlockWorld().flatGround(63);
        const h = w.house({ x: 0, y: 63, z: 0, width: 7, depth: 9 });
        potatoField(w, 12, 0);
        const f = pen(w, { x: 0, z: 14 });
        for (let x = 24; x < 36; x++) {
            w.set(x, 63, 0, 'sand');
            w.set(x, 63, 1, 'water');
            w.set(x, 64, 0, 'sugar_cane');
        }
        w.set(26, 64, 10, 'lectern');
        w.set(28, 64, 10, 'composter');
        w.fill(40, 64, 0, 41, 66, 0, 'nether_portal');
        const entities = [animal('cat', h.inside.x + 0.5, 64, h.inside.z + 0.5, 1), animal('cat', h.inside.x - 1.5, 64, h.inside.z + 0.5, 2),
            ...cows(5, 1, 15), villager(26.5, 64, 11.5, 'librarian', 30), villager(28.5, 64, 11.5, 'farmer', 31), villager(27.5, 64, 12.5, 'farmer', 32),
            { id: 40, name: 'leash_knot', type: 'other', position: vec(f.ring.min.x, 64, f.ring.min.z) },
            { id: 41, name: 'happy_ghast', type: 'animal', position: vec(f.ring.min.x - 2.5, 68, f.ring.min.z - 2.5), leashHolder: 40 }];
        const r = survey(w, entities);
        assert.deepEqual(names(r).sort(), ['cane', 'cow_pen', 'house', 'portal', 'potato_farm', 'tied_happy_ghast', 'trading_hall'].sort());
        assert.deepEqual(r.kept, []);
        assert.deepEqual(r.skipped, []);
        assert.equal(r.places.find(p => p.name === 'cane').detail.count, 12);
        assert.equal(r.places.find(p => p.name === 'cow_pen').contents.animals.cow, 5);
        assert.equal(r.places.find(p => p.name === 'house').contents.animals.cat, 2);
        for (const p of r.places) assert.equal(p.source, 'survey');
    });

    test('bad input never throws: no reader, no seeds, no saved; a reader that throws', () => {
        assert.deepEqual(L.findPlaces(null, null, null), { places: [], kept: [], skipped: [] });
        assert.deepEqual(L.findPlaces(undefined, {}, undefined, null), { places: [], kept: [], skipped: [] });
        const seeds = seedsIn(potatoField());
        const r = L.findPlaces(() => { throw new Error('no world'); }, seeds, { areas: [], places: [] });
        assert.deepEqual(r.places, []);
        assert.ok(Array.isArray(r.skipped));
    });

    test('the ore guard: a reader that shows ore around the base yields places that name no ore', () => {
        const w = potatoField();
        w.fill(-30, 40, -30, 30, 62, 30, 'iron_ore');
        w.fill(-2, 62, -2, 10, 62, 6, 'deepslate_gold_ore');
        const r = survey(w);
        assert.deepEqual(names(r), ['potato_farm']);
        assert.ok(!/_ore\b|ancient_debris/.test(JSON.stringify(r)));
    });
});
