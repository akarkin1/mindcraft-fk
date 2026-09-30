// Spec v0.1.4.6 H3: src/agent/packs/home/shelter_logic.js -- the pure choices of goToShelter and
// emergencyShelter: which shelter, which entrance, where to stand inside, which block closes the hole.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const S = await loadSrc('src/agent/packs/home/shelter_logic.js');

// v0.1.4.8, C4: only an area of type home is a shelter, so the areas of these tests are homes
const area = (name, x1, z1, x2, z2, extra = {}) => ({
    name, type: 'home', dimension: 'overworld', source: 'scan',
    min: { x: x1, y: 63, z: z1 }, max: { x: x2, y: 69, z: z2 }, entrances: [], ...extra,
});
const p = (x, z, y = 64) => ({ x, y, z });

// A scanned house: blocks 1..7 (walls), the box grown by one, door in the south wall.
const HOUSE = area('cabin', 0, 0, 8, 8, { entrances: [{ x: 4, y: 64, z: 7, kind: 'door' }] });

describe('isBuildingArea, isInsideArea, sameDimension', () => {
    test('home, building or no type counts as building, farm does not', () => {
        assert.equal(S.isBuildingArea(HOUSE), true);
        assert.equal(S.isBuildingArea({ ...HOUSE, type: 'building' }), true);
        assert.equal(S.isBuildingArea({ ...HOUSE, type: undefined }), true);
        assert.equal(S.isBuildingArea({ ...HOUSE, type: 'farm' }), false);
        assert.equal(S.isBuildingArea(null), false);
        assert.equal(S.isBuildingArea({ name: 'x' }), false, 'no box');
    });

    test('inside means within the walls, not in the margin or the doorway', () => {
        assert.equal(S.isInsideArea(HOUSE, p(4.5, 4.5)), true);
        assert.equal(S.isInsideArea(HOUSE, p(2.1, 6.9)), true, 'next to the wall inside');
        assert.equal(S.isInsideArea(HOUSE, p(4.5, 7.5)), false, 'in the doorway');
        assert.equal(S.isInsideArea(HOUSE, p(4.5, 8.5)), false, 'in front of the door');
        assert.equal(S.isInsideArea(HOUSE, p(4.5, 4.5, 80)), false, 'above the roof');
        assert.equal(S.isInsideArea(null, p(4.5, 4.5)), false);
    });

    test('sameDimension ignores the minecraft: prefix and lets a missing dimension match', () => {
        assert.equal(S.sameDimension('overworld', 'minecraft:overworld'), true);
        assert.equal(S.sameDimension('the_nether', 'overworld'), false);
        assert.equal(S.sameDimension(null, 'overworld'), true);
        assert.equal(S.sameDimension('overworld', undefined), true);
    });
});

describe('chooseShelter: the order of the spec (v0.1.4.8, C4)', () => {
    const home = { x: 30.5, y: 64, z: 30.5, dimension: 'overworld' };
    const homeHouse = area('villa', 26, 26, 36, 36);
    const named = area('home', 100, 100, 108, 108);
    const near = area('shed', -10, -10, -4, -4);

    test('1. the home area that contains the place home', () => {
        const r = S.chooseShelter({ areas: [near, named, homeHouse], home, botPos: p(-7, -7), dimension: 'overworld' });
        assert.equal(r.kind, 'area');
        assert.equal(r.area.name, 'villa');
        assert.equal(r.why, 'contains_home');
    });

    test('the name home has no rule of its own any more: the nearest home area', () => {
        const r = S.chooseShelter({ areas: [near, named], home, botPos: p(-7, -7), dimension: 'overworld' });
        assert.equal(r.area.name, 'shed');
        assert.equal(r.why, 'nearest');
    });

    test('2. the nearest home area within 96 blocks', () => {
        const far = area('far', 110, 0, 118, 8);
        const r = S.chooseShelter({ areas: [far, near], home: null, botPos: p(70, 0), dimension: 'overworld' });
        assert.equal(r.area.name, 'far');
        assert.equal(r.why, 'nearest');
        const none = S.chooseShelter({ areas: [far], home: null, botPos: p(-200, 0), dimension: 'overworld' });
        assert.equal(none.kind, 'emergency', 'beyond 96 blocks: no home');
        const beyond = S.chooseShelter({ areas: [far], home: null, botPos: p(10, 0), dimension: 'overworld' });
        assert.equal(beyond.kind, 'emergency', '100 blocks away');
    });

    test('3. the place home without an area', () => {
        const r = S.chooseShelter({ areas: [area('far', 500, 500, 508, 508)], home, botPos: p(0, 0), dimension: 'overworld' });
        assert.equal(r.kind, 'place');
        assert.deepEqual(r.place, home);
    });

    test('no home at all: the kind emergency, why nothing', () => {
        assert.deepEqual(S.chooseShelter({ areas: [], home: null, botPos: p(0, 0), dimension: 'overworld' }), { kind: 'emergency', why: 'nothing' });
        assert.equal(S.chooseShelter(undefined).kind, 'emergency');
    });

    test('farms are no shelter', () => {
        const farm = area('home', 26, 26, 36, 36, { type: 'farm' });
        const r = S.chooseShelter({ areas: [farm], home, botPos: p(0, 0), dimension: 'overworld' });
        assert.equal(r.kind, 'place');
    });

    test('areas and the home place of another dimension are ignored', () => {
        const nether = { ...homeHouse, dimension: 'the_nether' };
        const r = S.chooseShelter({ areas: [nether], home: { ...home, dimension: 'the_nether' }, botPos: p(30, 30), dimension: 'overworld' });
        assert.equal(r.kind, 'emergency');
        const r2 = S.chooseShelter({ areas: [{ ...homeHouse, dimension: null }], home, botPos: p(0, 0), dimension: 'minecraft:overworld' });
        assert.equal(r2.area.name, 'villa', 'an area without a dimension matches');
    });

    test('invalid areas and a home without coordinates are skipped', () => {
        const r = S.chooseShelter({ areas: [null, { name: 'x' }, near], home: { x: 'a' }, botPos: p(0, 0), dimension: 'overworld' });
        assert.equal(r.area.name, 'shed');
    });
});

describe('orderEntrances', () => {
    test('nearest to the bot first, invalid entries left out', () => {
        const a = area('two', 0, 0, 20, 8, { entrances: [{ x: 18, y: 64, z: 7, kind: 'door' }, null, { x: 'a' }, { x: 2, y: 64, z: 7, kind: 'gate' }] });
        assert.deepEqual(S.orderEntrances(a, p(0, 12)).map(e => e.x), [2, 18]);
        assert.deepEqual(S.orderEntrances(a, p(20, 12)).map(e => e.x), [18, 2]);
        assert.deepEqual(S.orderEntrances({ ...a, entrances: undefined }, p(0, 0)), []);
        assert.deepEqual(S.orderEntrances(null, p(0, 0)), []);
    });
});

describe('chooseStandingPlace', () => {
    // Floor at y 63, free cells at y 64 inside the walls (x, z 2..6).
    const freeRoom = (x, y, z) => y === 64 && x >= 2 && x <= 6 && z >= 2 && z <= 6;
    const door = HOUSE.entrances[0];
    const dWall = (c) => Math.min(c.x - 1, 7 - c.x, c.z - 1, 7 - c.z);

    test('a free place away from the door and away from the walls', () => {
        const spot = S.chooseStandingPlace({ area: HOUSE, entrance: door, isFree: freeRoom });
        assert.ok(freeRoom(spot.x, spot.y, spot.z), JSON.stringify(spot));
        const dDoor = Math.hypot(spot.x - door.x, spot.z - door.z);
        assert.ok(dDoor >= 3.9, `away from the door: ${dDoor}`);
        assert.ok(dWall(spot) >= 2, `away from the walls: ${dWall(spot)}`);
        assert.deepEqual(S.chooseStandingPlace({ area: HOUSE, entrance: door, isFree: freeRoom }), spot, 'deterministic');
    });

    test('at most 8 blocks from the entrance', () => {
        const hall = area('hall', 0, 0, 40, 8, { entrances: [{ x: 2, y: 64, z: 7, kind: 'door' }] });
        const free = (x, y, z) => y === 64 && x >= 2 && x <= 38 && z >= 2 && z <= 6;
        const spot = S.chooseStandingPlace({ area: hall, entrance: hall.entrances[0], isFree: free });
        assert.ok(Math.hypot(spot.x - 2, spot.y - 64, spot.z - 7) <= 8, JSON.stringify(spot));
    });

    test('without an entrance: the most central free place', () => {
        const spot = S.chooseStandingPlace({ area: HOUSE, entrance: null, isFree: freeRoom });
        assert.deepEqual(spot, { x: 4, y: 64, z: 4 });
    });

    test('nothing free, a throwing isFree, bad input: null', () => {
        assert.equal(S.chooseStandingPlace({ area: HOUSE, entrance: door, isFree: () => false }), null);
        assert.equal(S.chooseStandingPlace({ area: HOUSE, entrance: door, isFree: () => { throw new Error('x'); } }), null);
        assert.equal(S.chooseStandingPlace({ area: null, entrance: door, isFree: freeRoom }), null);
        assert.equal(S.chooseStandingPlace({ area: HOUSE, entrance: door }), null);
        assert.equal(S.chooseStandingPlace(undefined), null);
    });
});

describe('chooseCoverBlock', () => {
    const full = (name) => ['dirt', 'cobblestone', 'stone', 'oak_planks', 'sand', 'gravel', 'tnt', 'red_concrete_powder'].includes(name);

    test('dirt first, then cobblestone, then any full block', () => {
        assert.equal(S.chooseCoverBlock(['cobblestone', 'dirt', 'stone'], full), 'dirt');
        assert.equal(S.chooseCoverBlock(['stone', 'cobblestone'], full), 'cobblestone');
        assert.equal(S.chooseCoverBlock(['torch', 'oak_planks'], full), 'oak_planks');
    });

    test('blocks that fall or explode are never chosen', () => {
        assert.equal(S.chooseCoverBlock(['sand', 'gravel', 'tnt', 'red_concrete_powder'], full), null);
        assert.equal(S.isFallingBlockName('red_sand'), true);
        assert.equal(S.isFallingBlockName('anvil'), true);
        assert.equal(S.isFallingBlockName('dirt'), false);
    });

    test('nothing usable: null', () => {
        assert.equal(S.chooseCoverBlock([], full), null);
        assert.equal(S.chooseCoverBlock(['torch'], full), null);
        assert.equal(S.chooseCoverBlock(['stone'], undefined), null, 'without a test only dirt and cobblestone');
        assert.equal(S.chooseCoverBlock(['cobblestone'], undefined), 'cobblestone');
        assert.equal(S.chooseCoverBlock(null, full), null);
        assert.equal(S.chooseCoverBlock(['stone'], () => { throw new Error('x'); }), null);
    });
});
