// Release v0.1.4.11, part P (engineer E3): the one scan of a place and its kind (SPEC I5, P1, P2).
//   - scanEnclosure of src/agent/areas/area_scan.js on fixtures: a fenced pen with a gate, a walled house with a roof
//     and a door, a doorway without a door (a gap), a hedge, ground in a pond, a pen beside a pond, a fence with a gap,
//     no border; scanBuilding, scanPen and scanFarm give the results of v0.1.4.10;
//   - kindOf of src/agent/areas/area_kind.js for each rule and their order, typeOfKind;
//   - the texts of P1 and P2 from plain data.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const S = await loadSrc('src/agent/areas/area_scan.js');
const K = await loadSrc('src/agent/areas/area_kind.js');

const at = (p) => ({ x: p.x + 0.5, y: p.y, z: p.z + 0.5 });
const box = (x0, y0, z0, x1, y1, z1) => ({ min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } });

function penWorld(options = {}) {
    const world = createBlockWorld().flatGround(63);
    const pen = world.field({ x: 0, y: 63, z: 0, width: 7, depth: 5, ground: 'grass_block', crop: null, ...options });
    return { world, pen };
}

describe('scanEnclosure: the fixtures (I5)', () => {
    test('a fenced pen with a gate: fence, the gate, no roof, ground; the box of scanPen', () => {
        const { world, pen } = penWorld();
        const r = S.scanEnclosure(world.getBlockName, at(pen.inside));
        assert.equal(r.found, true);
        assert.deepEqual(r.box, box(-1, 62, -1, 7, 66, 5));
        assert.equal(r.border, 'fence');
        assert.deepEqual(r.openings, [{ x: 3, y: 64, z: 5, kind: 'gate' }]);
        assert.equal(r.roof, false);
        assert.equal(r.floor, 'ground');
        assert.equal(r.reason, null);
        const pen2 = S.scanPen(world.getBlockName, at(pen.inside));
        assert.deepEqual(r.box, { min: pen2.min, max: pen2.max });
    });

    test('a fenced farm: the floor is tilled', () => {
        const world = createBlockWorld().flatGround(63);
        const field = world.field({ x: 0, y: 63, z: 0, width: 6, depth: 10 });
        const r = S.scanEnclosure(world.getBlockName, at(field.inside));
        assert.equal(r.border, 'fence');
        assert.equal(r.floor, 'tilled');
        assert.equal(r.roof, false);
    });

    test('a walled house with a roof and a door: wall, the door, a roof, a built floor; the box of scanBuilding', () => {
        const world = createBlockWorld().flatGround(63);
        const house = world.house({ x: 0, y: 63, z: 0, width: 7, depth: 9 });
        const r = S.scanEnclosure(world.getBlockName, at(house.inside));
        assert.equal(r.found, true);
        assert.equal(r.source, 'building');
        assert.equal(r.border, 'wall');
        assert.deepEqual(r.openings, [{ ...house.door, kind: 'door' }]);
        assert.equal(r.roof, true);
        assert.equal(r.floor, 'built');
        const b = S.scanBuilding(world.getBlockName, at(house.inside));
        assert.deepEqual(r.box, { min: b.min, max: b.max });
        assert.deepEqual(r.entrances, b.entrances);
    });

    test('with floors the box of the floor (area_floors)', () => {
        const world = createBlockWorld().flatGround(63);
        const house = world.house({ x: 0, y: 63, z: 0, width: 7, depth: 9 });
        const r = S.scanEnclosure(world.getBlockName, at(house.inside), { floors: true });
        assert.deepEqual(r.box, box(0, 63, 0, 6, 67, 8));
        assert.equal(r.border, 'wall');
    });

    test('a doorway without a door: one opening of kind gap', () => {
        const world = createBlockWorld().flatGround(63);
        const house = world.house({ x: 0, y: 63, z: 0, width: 7, depth: 9 });
        world.set(house.door.x, house.door.y, house.door.z, 'air');
        world.set(house.door.x, house.door.y + 1, house.door.z, 'air');
        const r = S.scanEnclosure(world.getBlockName, at(house.inside));
        assert.equal(r.found, true);
        assert.deepEqual(r.openings, [{ ...house.door, kind: 'gap' }]);
        assert.deepEqual(r.entrances, [], 'a gap is no entrance of the store');
    });

    test('a hedge: leaves two high around grass', () => {
        const world = createBlockWorld().flatGround(63);
        for (let x = -1; x <= 5; x++) {
            for (const z of [-1, 5]) world.fill(x, 64, z, x, 65, z, 'oak_leaves');
        }
        for (let z = 0; z <= 4; z++) {
            for (const x of [-1, 5]) world.fill(x, 64, z, x, 65, z, 'oak_leaves');
        }
        const r = S.scanEnclosure(world.getBlockName, { x: 2.5, y: 64, z: 2.5 });
        assert.equal(r.found, true);
        assert.equal(r.border, 'hedge');
        assert.deepEqual(r.box, box(-1, 62, -1, 5, 66, 5));
        assert.deepEqual(r.openings, []);
    });

    test('ground in a pond: water bounds it', () => {
        const world = createBlockWorld().flatGround(63);
        world.fill(-6, 63, -6, 6, 63, 6, 'water');
        world.fill(-2, 63, -2, 2, 63, 2, 'grass_block');
        const r = S.scanEnclosure(world.getBlockName, { x: 0.5, y: 64, z: 0.5 });
        assert.equal(r.found, true);
        assert.equal(r.border, 'water');
        assert.deepEqual(r.box, box(-3, 62, -3, 3, 66, 3));
    });

    test('a pen with a pond as its west side: the fence holds 2 of 3, so fenced', () => {
        const { world } = penWorld({ sides: { west: null } });
        world.fill(-4, 63, -3, -1, 63, 7, 'water');
        const r = S.scanEnclosure(world.getBlockName, { x: 3.5, y: 64, z: 2.5 });
        assert.equal(r.found, true);
        assert.equal(r.border, 'fence');
        assert.equal(r.box.min.x, -1);
    });

    test('a pen as much water as fence: mixed', () => {
        const world = createBlockWorld().flatGround(63);
        world.fill(-6, 63, -6, 6, 63, 6, 'water');
        world.fill(-2, 63, -2, 2, 63, 2, 'grass_block');
        for (let x = -3; x <= 3; x++) world.set(x, 64, -3, 'oak_fence');
        for (let z = -3; z <= 3; z++) world.set(-3, 64, z, 'oak_fence');
        world.fill(-3, 63, -3, 3, 63, -3, 'grass_block');
        world.fill(-3, 63, -3, -3, 63, 3, 'grass_block');
        const r = S.scanEnclosure(world.getBlockName, { x: 0.5, y: 64, z: 0.5 });
        assert.equal(r.found, true);
        assert.equal(r.border, 'mixed');
    });

    test('a fence with a gap: not enclosed, with the text of the gap', () => {
        const { world, pen } = penWorld({ gaps: [{ x: -1, z: 2 }] });
        const r = S.scanEnclosure(world.getBlockName, at(pen.inside));
        assert.equal(r.found, false);
        assert.equal(r.reason, 'not_enclosed');
        assert.equal(r.box, null);
        assert.equal(r.text, 'I find no closed fence around me within 24 blocks. Stand inside the fence, or close the gap in it, and try again.');
    });

    test('no border: the text of P1', () => {
        const world = createBlockWorld().flatGround(63);
        const r = S.scanEnclosure(world.getBlockName, { x: 0.5, y: 64, z: 0.5 });
        assert.equal(r.found, false);
        assert.equal(r.reason, 'no_border');
        assert.equal(r.text, 'I find no border around me: no fence, wall, hedge or water within 24 blocks. Stand inside the place and say it again.');
        assert.equal(S.scanText('no_border'), r.text);
    });

    test('a hollow of the ground is no enclosure: rock is no border', () => {
        const world = createBlockWorld().flatGround(63, 'stone', 'stone');
        world.fill(-2, 63, -2, 2, 63, 2, 'air');
        world.fill(-2, 62, -2, 2, 62, 2, 'stone');
        const r = S.scanEnclosure(world.getBlockName, { x: 0.5, y: 63, z: 0.5 });
        assert.equal(r.found, false);
        assert.equal(r.reason, 'no_border');
    });

    test('a part not loaded: not_loaded', () => {
        const { pen } = penWorld();
        const world = createBlockWorld({ loaded: box(-1, 0, -1, 3, 100, 3) }).flatGround(63);
        world.field({ x: 0, y: 63, z: 0, width: 7, depth: 5, ground: 'grass_block', crop: null });
        assert.equal(S.scanEnclosure(world.getBlockName, at(pen.inside)).reason, 'not_loaded');
    });

    test('bad arguments throw a TypeError, as the other scans', () => {
        assert.throws(() => S.scanEnclosure(null, { x: 0, y: 0, z: 0 }), TypeError);
        assert.throws(() => S.scanEnclosure(() => 'air', { x: Number.NaN, y: 0, z: 0 }), TypeError);
    });

    test('the module stays pure', () => {
        assertImportRules('src/agent/areas/area_scan.js', { allowBuiltins: [], allowedRelative: [] });
        assertCleanImport('src/agent/areas/area_scan.js');
        assertImportRules('src/agent/areas/area_kind.js', { allowBuiltins: [], allowedRelative: [] });
        assertCleanImport('src/agent/areas/area_kind.js');
    });
});

describe('the scans of v0.1.4.10 go through scanEnclosure and keep their results (I5)', () => {
    test('scanPen and scanFarm: the fields of v0.1.4.10, no field of the enclosure', () => {
        const { world, pen } = penWorld();
        const r = S.scanPen(world.getBlockName, at(pen.inside));
        assert.deepEqual(Object.keys(r).sort(), ['cells', 'crops', 'entrances', 'farmland', 'found', 'max', 'min', 'reason', 'roofed', 'text']);
        assert.equal(S.scanFarm(world.getBlockName, at(pen.inside)).reason, 'no_crops');
    });

    test('scanBuilding: the fields of v0.1.4.10', () => {
        const world = createBlockWorld().flatGround(63);
        const house = world.house({ x: 0, y: 63, z: 0 });
        const r = S.scanBuilding(world.getBlockName, at(house.inside));
        assert.deepEqual(Object.keys(r).sort(), ['blocks', 'clipped', 'entrances', 'found', 'max', 'min', 'reason', 'text']);
        assert.deepEqual(S.scanEnclosure(world.getBlockName, at(house.inside), { mode: 'building' }).scan, r);
    });

    test('the error of a bad call names the scan that was called', () => {
        assert.throws(() => S.scanPen(null, { x: 0, y: 0, z: 0 }), /scanPen/);
        assert.throws(() => S.scanBuilding(null, { x: 0, y: 0, z: 0 }), /scanBuilding/);
    });
});

const ENC = (fields = {}) => ({ roof: false, floor: 'ground', openings: [], border: 'fence', ...fields });
const GATE = [{ x: 0, y: 64, z: 0, kind: 'gate' }];
const DOOR = [{ x: 0, y: 64, z: 0, kind: 'door' }];
const C = (fields = {}) => ({ animals: {}, crops: {}, beds: 0, chests: 0, furnaces: 0, tables: 0, ladders: 0, water: 0, ...fields });

describe('kindOf: each rule and the order (I5)', () => {
    test('animals and a gate or a door: pen', () => {
        assert.equal(K.kindOf(ENC({ openings: GATE }), C({ animals: { chicken: 6 } })), 'pen');
        assert.equal(K.kindOf(ENC({ openings: DOOR }), C({ animals: { cow: 1 } })), 'pen');
        assert.equal(K.kindOf(ENC(), C({ animals: { cow: 1 } })), 'yard', 'animals without an opening');
    });

    test('crops on a tilled floor: farm', () => {
        assert.equal(K.kindOf(ENC({ floor: 'tilled', openings: GATE }), C({ crops: { wheat: 40 } })), 'farm');
        assert.equal(K.kindOf(ENC({ floor: 'ground', openings: GATE }), C({ crops: { wheat: 40 } })), 'yard', 'crops on grass');
    });

    test('a roof, a door and a bed: home', () => {
        assert.equal(K.kindOf(ENC({ roof: true, openings: DOOR, border: 'wall' }), C({ beds: 1, chests: 2 })), 'home');
        assert.equal(K.kindOf(ENC({ roof: true, openings: GATE }), C({ beds: 1 })), 'yard', 'a bed under a roof without a door');
    });

    test('a roof and chests or furnaces: storage', () => {
        assert.equal(K.kindOf(ENC({ roof: true, openings: DOOR }), C({ chests: 4, furnaces: 2 })), 'storage');
        assert.equal(K.kindOf(ENC({ roof: true }), C({ furnaces: 1 })), 'storage', 'no door needed');
    });

    test('a roof and a door: building; else yard', () => {
        assert.equal(K.kindOf(ENC({ roof: true, openings: DOOR }), C()), 'building');
        assert.equal(K.kindOf(ENC({ openings: GATE }), C()), 'yard');
        assert.equal(K.kindOf(null, null), 'yard');
    });

    // v0.1.4.11 (F25): the owner's basement, 0 doors and 2 trapdoors in its ceiling over ladders
    test('a roof and a trapdoor without a door: building; a trapdoor without a roof or a roof with a gap: yard', () => {
        const hatches = [{ x: 0, y: 66, z: 0, kind: 'trapdoor' }, { x: 3, y: 66, z: 0, kind: 'trapdoor' }];
        assert.equal(K.kindOf(ENC({ roof: true, border: 'wall', openings: hatches }), C({ ladders: 6 })), 'building');
        assert.equal(K.kindOf(ENC({ roof: true, border: 'wall', openings: hatches }), C({ beds: 1 })), 'building', 'a bed but no door: no home');
        assert.equal(K.kindOf(ENC({ roof: true, openings: hatches }), C({ chests: 1 })), 'storage', 'storage comes first');
        assert.equal(K.kindOf(ENC({ openings: hatches }), C()), 'yard', 'no roof');
        assert.equal(K.kindOf(ENC({ roof: true, openings: [{ x: 0, y: 64, z: 0, kind: 'gap' }] }), C()), 'yard', 'a gap is no trapdoor');
    });

    test('the order: the first rule that fits wins', () => {
        const all = C({ animals: { pig: 2 }, crops: { carrots: 3 }, beds: 1, chests: 1 });
        assert.equal(K.kindOf(ENC({ roof: true, floor: 'tilled', openings: DOOR }), all), 'pen');
        assert.equal(K.kindOf(ENC({ roof: true, floor: 'tilled', openings: DOOR }), { ...all, animals: {} }), 'farm');
        assert.equal(K.kindOf(ENC({ roof: true, floor: 'built', openings: DOOR }), { ...all, animals: {} }), 'home');
        assert.equal(K.kindOf(ENC({ roof: true, floor: 'built', openings: DOOR }), { ...all, animals: {}, beds: 0 }), 'storage');
    });

    test('the type of each kind: storage and yard are a building', () => {
        assert.deepEqual(K.PLACE_KINDS.map(K.typeOfKind), ['pen', 'farm', 'home', 'building', 'building', 'building']);
        assert.equal(K.typeOfKind('castle'), null);
    });
});

describe('the texts of P1 and P2 from plain data', () => {
    const b = (x, z) => box(0, 60, 0, x - 1, 66, z - 1);

    test('P1, word for word', () => {
        assert.equal(K.savedText('aviary', 'pen', ENC({ openings: GATE }), C({ animals: { chicken: 6 } }), b(9, 7)),
            'I saved "aviary": a pen, fenced, 9 x 7, 1 gate, 6 chickens. I keep its gate closed and pick nothing up inside it.');
        assert.equal(K.savedText('wheat_farm', 'farm', ENC({ openings: GATE }), C({ crops: { wheat: 40 } }), b(8, 12)),
            'I saved "wheat_farm": a farm, fenced, 8 x 12, 1 gate, 40 wheat. I only plant and harvest there.');
        assert.equal(K.savedText('home', 'home', ENC({ border: 'wall', roof: true, openings: DOOR }), C({ beds: 1, chests: 2 }), b(9, 11)),
            'I saved "home": a home, walled, 9 x 11 with a roof, 1 door, 1 bed, 2 chests. I shelter there at night.');
        assert.equal(K.savedText('cellar', 'storage', ENC({ border: 'wall', roof: true, openings: DOOR }), C({ chests: 4, furnaces: 2 }), b(5, 5)),
            'I saved "cellar": a storage, walled, 5 x 5 with a roof, 1 door, 4 chests, 2 furnaces. I use its chests.');
        assert.equal(K.savedText('barn', 'building', ENC({ border: 'wall', roof: true, openings: DOOR }), C(), b(7, 9)),
            'I saved "barn": a building, walled, 7 x 9 with a roof, 1 door. I change nothing in it.');
        assert.equal(K.savedText('yard', 'yard', ENC({ openings: GATE }), C(), b(12, 12)),
            'I saved "yard": a yard, fenced, 12 x 12, 1 gate. I change nothing in it.');
        assert.equal(K.kindChangedText('aviary', 'farm'), '"aviary" is a farm now. I only plant and harvest there.');
    });

    test('the contents: animals by kind the most first, crops, beds, chests, furnaces, tables, ladders, water', () => {
        const all = C({ animals: { cow: 1, chicken: 6, sheep: 2 }, crops: { carrots: 1, wheat: 40 }, beds: 2, chests: 1, furnaces: 1, tables: 1, ladders: 3, water: 1 });
        assert.deepEqual(K.contentsParts(all), ['6 chickens', '2 sheep', '1 cow', '40 wheat', '1 carrot', '2 beds', '1 chest', '1 furnace',
            '1 crafting table', '3 ladders', '1 water block']);
        assert.deepEqual(K.contentsParts(null), []);
        assert.deepEqual(K.openingsParts([...DOOR, ...GATE, ...GATE, { kind: 'trapdoor' }, { kind: 'gap' }]), ['1 door', '2 gates', '1 trapdoor', '1 gap']);
    });

    test('P2, word for word', () => {
        assert.equal(K.senseText('pen', ENC({ openings: GATE }), C({ animals: { chicken: 6 } }), b(9, 7)),
            'I am in a fenced pen 9 x 7 with 6 chickens and 1 gate that I have not saved. Tell me its name and I keep it.');
        assert.equal(K.senseText('building', ENC({ border: 'wall', roof: true, openings: DOOR }), C(), b(7, 9)),
            'I am in a walled building 7 x 9 with a roof and 1 door that I have not saved. Tell me its name and I keep it.');
        assert.equal(K.senseText('yard', ENC({ border: 'mixed' }), C(), b(5, 5)),
            'I am in an enclosed yard 5 x 5 that I have not saved. Tell me its name and I keep it.');
    });

    test('the words of the borders', () => {
        assert.deepEqual(['fence', 'wall', 'glass', 'hedge', 'water', 'mixed', null].map(K.borderWord),
            ['fenced', 'walled', 'glass-walled', 'hedged', 'water-bound', 'enclosed', 'enclosed']);
    });
});
