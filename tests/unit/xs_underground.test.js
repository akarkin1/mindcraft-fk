// Spec v0.1.4.15, S 2.3 (E4): the underground of the base survey, src/agent/packs/survey/underground_logic.js (pure).
//   - followLadder: a trapdoor over a ladder column, or a ladder block, gives the column (top, bottom, x, z, face).
//   - basementOf: the room at the foot through scanEnclosure in building mode with floors; the trapdoor its entrance.
//   - wallOpenings: the openings of the rock walls; beyond them a tunnel (the way to a mine entrance) or a cave.
//   - undergroundOf: the places (basement, mine_entrance, cave_mouth with no_enter) and the routes of the RouteStore shape.
//   - The ore guard: through the ore-blind reader nothing of the result names an ore.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const DIR = 'src/agent/packs/survey/';
const U = await loadSrc(`${DIR}underground_logic.js`);
const L = await loadSrc(`${DIR}survey_logic.js`);
const R = await loadSrc('src/agent/packs/routes/route_logic.js');
const RS = await loadSrc('src/agent/packs/routes/route_store.js');
const ML = await loadSrc('src/agent/packs/mining/mine_logic.js');

// The synthetic base of the tests (the layout of W126 in small): the ground stone to y 59. The house: floor planks at
// y 60 (x 0..8, z 0..8), walls y 61..64, roof y 65, the door at (4, 61, 0), a bed. The basement: a room dug in the stone
// x 1..7, y 54..57, z 1..7 under the house (its floor y 53, its ceiling y 58, 2 blocks of rock to the house floor), a
// chest and a furnace; the ladder of 6 (1, 54..59, 4) against the west wall under the trapdoor (1, 60, 4). From the east
// wall a tunnel 2 wide, 2 high and 12 long (x 8..19, y 54..55, z 3..4). From the north wall an opening (x 5..6, y 54..55,
// z 0..-2) into a dark cave 5 x 5 x 4 (x 3..7, y 54..57, z -8..-3). `options.ore` fills the rock around the basement with
// iron ore.
const Y = { floor: 53, feet: 54, ceiling: 58 };
function base(options = {}) {
    const w = createBlockWorld();
    w.fill(-30, 20, -30, 40, 59, 40, 'stone');
    if (options.ore) {
        w.fill(-2, 48, -2, 10, 59, 10, 'iron_ore'); // the rock around the basement is ore; the room is dug out of it below
    }
    w.fill(0, 60, 0, 8, 65, 8, 'oak_planks');
    w.fill(1, 61, 1, 7, 64, 7, 'air');
    w.set(4, 61, 0, 'oak_door').set(4, 62, 0, 'oak_door');
    w.set(6, 61, 6, 'red_bed').set(5, 61, 6, 'red_bed');
    w.fill(1, 54, 1, 7, 57, 7, 'air');
    w.fill(1, 54, 4, 1, 59, 4, 'ladder');
    w.set(1, 60, 4, 'oak_trapdoor');
    w.set(6, 54, 6, 'chest').set(6, 54, 5, 'furnace');
    if (options.tunnel !== false) {
        w.fill(8, 54, 3, 19, 55, 4, 'air');
    }
    if (options.cave !== false) {
        w.fill(5, 54, -2, 6, 55, 0, 'air');
        w.fill(3, 54, -8, 7, 57, -3, 'air');
    }
    return w;
}

const HOUSE = { name: 'house', kind: 'home', type: 'home', box: { min: { x: 0, y: 60, z: 0 }, max: { x: 8, y: 65, z: 8 } },
    entrances: [{ x: 1, y: 60, z: 4, kind: 'trapdoor' }, { x: 4, y: 61, z: 0, kind: 'door' }] };
const DOWN = [{ x: 1, y: 60, z: 4 }, { x: 1, y: 59, z: 4 }, { x: 1, y: 58, z: 4 }, { x: 1, y: 57, z: 4 }, { x: 1, y: 56, z: 4 }, { x: 1, y: 55, z: 4 }, { x: 1, y: 54, z: 4 }];
const BASEMENT_BOX = { min: { x: 0, y: Y.floor, z: 0 }, max: { x: 8, y: Y.ceiling, z: 8 } };
const measure = { tunnelAt: ML.tunnelAt };

describe('followLadder (2.3.1)', () => {
    test('from the trapdoor: the column under it, top and bottom the highest and lowest ladder, the face away from the wall', () => {
        const w = base();
        assert.deepEqual(U.followLadder(w.getBlockName, { x: 1, y: 60, z: 4 }), { top: 59, bottom: 54, x: 1, z: 4, face: 'east', trapdoor: { x: 1, y: 60, z: 4 } });
    });

    test('from any ladder block of the column: the same column, the trapdoor found above it', () => {
        const w = base();
        assert.deepEqual(U.followLadder(w.getBlockName, { x: 1, y: 57, z: 4 }), { top: 59, bottom: 54, x: 1, z: 4, face: 'east', trapdoor: { x: 1, y: 60, z: 4 } });
        w.set(1, 60, 4, 'oak_planks'); // no trapdoor: an open shaft
        w.set(1, 60, 4, 'air');
        assert.equal(U.followLadder(w.getBlockName, { x: 1, y: 55, z: 4 }).trapdoor, null);
    });

    test('options.faceAt wins over the walls; a column of 1 ladder, a trapdoor over no ladder, a plank: null', () => {
        const w = base();
        assert.equal(U.followLadder(w.getBlockName, { x: 1, y: 60, z: 4 }, { faceAt: () => 'south' }).face, 'south');
        assert.equal(U.followLadder(w.getBlockName, { x: 1, y: 60, z: 4 }, { faceAt: () => 'up' }).face, 'east', 'a facing that is no direction: the walls');
        w.fill(1, 54, 4, 1, 58, 4, 'air');
        assert.equal(U.followLadder(w.getBlockName, { x: 1, y: 60, z: 4 }), null, 'one ladder block leads nowhere');
        w.set(1, 59, 4, 'air');
        assert.equal(U.followLadder(w.getBlockName, { x: 1, y: 60, z: 4 }), null, 'a trapdoor over a hole');
        assert.equal(U.followLadder(w.getBlockName, { x: 4, y: 60, z: 4 }), null, 'a plank');
        assert.equal(U.followLadder(w.getBlockName, null), null);
        assert.equal(U.followLadder(null, { x: 1, y: 60, z: 4 }), null);
    });

    test('a column is at most 48 long', () => {
        const w = createBlockWorld();
        w.fill(-5, 0, -5, 5, 120, 5, 'stone');
        w.fill(0, 1, 0, 0, 100, 0, 'ladder');
        w.fill(1, 1, 0, 1, 100, 0, 'air');
        const r = U.followLadder(w.getBlockName, { x: 0, y: 100, z: 0 });
        assert.equal(r.top, 100);
        assert.equal(r.bottom, 100 - U.UNDERGROUND_RULES.ladderMax + 1);
        assert.equal(U.UNDERGROUND_RULES.ladderMax, 48);
    });
});

describe('basementOf (2.3.2)', () => {
    test('the room at the foot: its box, a storage by kindOf (roof, chest, furnace), type building, the trapdoor its entrance', () => {
        const w = base();
        const ladder = U.followLadder(w.getBlockName, { x: 1, y: 60, z: 4 });
        const b = U.basementOf(w.getBlockName, ladder);
        assert.equal(b.found, true);
        assert.deepEqual(b.box, BASEMENT_BOX);
        assert.equal(b.kind, 'storage');
        assert.equal(b.type, 'building');
        assert.ok(b.entrances.some(e => e.kind === 'trapdoor' && e.x === 1 && e.y === 60 && e.z === 4), JSON.stringify(b.entrances));
        assert.equal(b.contents.chests, 1);
        assert.equal(b.contents.furnaces, 1);
        assert.equal(b.contents.ladders, 5, 'the ladder blocks within the box (its ceiling included)');
        assert.deepEqual(b.foot, { x: 2, y: 54, z: 4 }, 'the cell beside the foot on the open side');
        assert.equal(b.enclosure.roof, true);
    });

    test('a bare room is a building; no room at the foot (the ladder ends in rock): not found', () => {
        const w = base();
        w.set(6, 54, 6, 'air').set(6, 54, 5, 'air');
        const ladder = U.followLadder(w.getBlockName, { x: 1, y: 60, z: 4 });
        assert.equal(U.basementOf(w.getBlockName, ladder).kind, 'building');
        assert.equal(U.basementOf(w.getBlockName, { ...ladder, bottom: 40, top: 41 }).found, false);
        assert.equal(U.basementOf(w.getBlockName, null).found, false);
    });
});

describe('wallOpenings (2.3.3)', () => {
    test('the tunnel of the east wall and the cave of the north wall, each one opening, the kind of the rock beyond', () => {
        const w = base();
        const ladder = U.followLadder(w.getBlockName, { x: 1, y: 60, z: 4 });
        const b = U.basementOf(w.getBlockName, ladder);
        const openings = U.wallOpenings(w.getBlockName, b, measure);
        assert.equal(openings.length, 2, JSON.stringify(openings.map(o => [o.at, o.dir, o.kind])));
        const tunnel = openings.find(o => o.dir === 'east');
        const cave = openings.find(o => o.dir === 'north');
        assert.deepEqual(tunnel.at, { x: 8, y: 54, z: 3 });
        assert.deepEqual(tunnel.beyond, { x: 10, y: 54, z: 3 });
        assert.equal(tunnel.kind, 'tunnel');
        assert.equal(tunnel.enclosure.source, 'rock');
        assert.ok(tunnel.enclosure.tunnel.length >= 4, JSON.stringify(tunnel.enclosure.tunnel));
        assert.deepEqual(cave.at, { x: 5, y: 54, z: 0 });
        assert.equal(cave.kind, 'cave');
        assert.ok(cave.enclosure.cave, JSON.stringify(cave.enclosure));
    });

    test('a closed room has no opening; a made corridor (planks) is no opening of the rock', () => {
        const w = base({ tunnel: false, cave: false });
        const ladder = U.followLadder(w.getBlockName, { x: 1, y: 60, z: 4 });
        const b = U.basementOf(w.getBlockName, ladder);
        assert.deepEqual(U.wallOpenings(w.getBlockName, b, measure), []);
        w.fill(8, 54, 3, 19, 55, 4, 'air');
        w.fill(9, 53, 2, 19, 56, 2, 'oak_planks').fill(9, 53, 5, 19, 56, 5, 'oak_planks').fill(9, 56, 3, 19, 56, 4, 'oak_planks');
        const made = U.wallOpenings(w.getBlockName, U.basementOf(w.getBlockName, ladder), measure);
        assert.equal(made.length, 1);
        assert.equal(made[0].kind, null, 'walls a player built: no tunnel, no cave');
        assert.deepEqual(U.wallOpenings(w.getBlockName, null), []);
    });

    test('without a measure of a tunnel (tunnelAt null) the tunnel reads as a cave, as scanEnclosure says', () => {
        const w = base({ cave: false });
        const b = U.basementOf(w.getBlockName, U.followLadder(w.getBlockName, { x: 1, y: 60, z: 4 }));
        const [o] = U.wallOpenings(w.getBlockName, b, { tunnelAt: null });
        assert.equal(o.kind, 'cave');
    });
});

describe('undergroundOf: the places and the routes (2.3.2 to 2.3.4)', () => {
    test('the basement under the house, the mine entrance at the tunnel, the keep-out cave mouth; two routes', () => {
        const w = base();
        const r = U.undergroundOf(w.getBlockName, HOUSE, DOWN, measure);
        assert.ok(r.ladder && r.basement, 'the ladder and the basement');
        // the openings in the order of their cells (the cave's at x 5 before the tunnel's at x 8); the report orders by role
        assert.deepEqual(r.places.map(p => [p.name, p.type, p.kind]), [['basement', 'building', 'storage'], ['cave_mouth', 'building', 'yard'],
            ['mine_entrance', 'place', 'mine_entrance']]);
        const [basement, cave, mine] = r.places;
        assert.equal(basement.source, 'survey');
        assert.equal(basement.under, 'house');
        assert.equal(basement.detail.under, 'house');
        assert.deepEqual(basement.box, BASEMENT_BOX);
        assert.ok(basement.entrances.some(e => e.kind === 'trapdoor'));
        assert.deepEqual(mine.at, { x: 8, y: 54, z: 3 });
        assert.equal(mine.box, null);
        assert.equal(mine.detail.tunnel.width, 2);
        assert.deepEqual(cave.box, { min: { x: 4, y: 53, z: -1 }, max: { x: 6, y: 55, z: 1 } }, 'the opening cell grown by 1');
        assert.deepEqual(cave.flags, { no_enter: true });
        assert.equal(cave.detail.no_enter, true);
        assert.deepEqual(r.routes.map(x => x.name), ['house_to_cave_mouth', 'house_to_mine_entrance']);
    });

    test('the route: a walk from the door to the trapdoor, the trapdoor leg, the ladder leg with top, bottom, face, entry and foot, a walk to the opening', () => {
        const w = base({ cave: false });
        const [route] = U.undergroundOf(w.getBlockName, HOUSE, DOWN, measure).routes;
        assert.equal(route.source, 'survey');
        assert.deepEqual(route.from, { name: 'house', kind: 'area', x: 4, y: 61, z: 0 });
        assert.deepEqual(route.to, { name: 'mine_entrance', x: 8, y: 54, z: 3 });
        assert.deepEqual(route.legs, [
            { kind: 'walk', from: { x: 4, y: 61, z: 0 }, to: { x: 2, y: 61, z: 4 } },
            { kind: 'door', kind2: 'trapdoor', name: 'oak_trapdoor', x: 1, y: 60, z: 4, from: { x: 2, y: 61, z: 4 }, to: { x: 1, y: 59, z: 4 } },
            { kind: 'ladder', x: 1, z: 4, top: 59, bottom: 54, face: 'east', entry: { x: 2, y: 61, z: 4 }, foot: { x: 2, y: 54, z: 4 } },
            { kind: 'walk', from: { x: 2, y: 54, z: 4 }, to: { x: 8, y: 54, z: 3 } },
        ]);
        assert.ok(route.steps > 0);
        // the routes pack takes every leg as it is, and the trapdoor lies over the ladder
        for (const leg of route.legs) {
            assert.deepEqual(R.cleanLeg(leg), leg);
        }
        assert.equal(R.trapdoorOverLadder(route.legs[1], route.legs[2]), true);
        const store = new RS.RouteStore(null);
        store.load();
        const saved = store.set({ ...route, dimension: 'overworld' });
        assert.equal(saved.name, 'house_to_mine_entrance');
        assert.equal(saved.legs.length, 4);
    });

    test('without a trapdoor (an open shaft) the route has no door leg; a building without a ladder has no underground', () => {
        const w = base({ cave: false });
        w.set(1, 60, 4, 'air');
        const r = U.undergroundOf(w.getBlockName, HOUSE, DOWN.slice(1), measure);
        assert.equal(r.ladder.trapdoor, null);
        assert.deepEqual(r.routes[0].legs.map(l => l.kind), ['walk', 'ladder', 'walk']);
        assert.deepEqual(U.undergroundOf(w.getBlockName, HOUSE, [], measure), { ladder: null, basement: null, openings: [], places: [], routes: [] });
        assert.deepEqual(U.undergroundOf(null, HOUSE, DOWN, measure).places, []);
    });

    test('routeOfSurvey alone: null without a ladder or an opening', () => {
        assert.equal(U.routeOfSurvey(HOUSE, null, null, null, { at: { x: 1, y: 1, z: 1 } }), null);
        assert.equal(U.routeOfSurvey(HOUSE, null, { top: 59, bottom: 54, x: 1, z: 4, face: 'east' }, null, null), null);
    });
});

describe('the ore guard (PLAN 9)', () => {
    test('with the rock around the basement all iron ore, through oreBlind nothing of the result names an ore', () => {
        const w = base({ ore: true });
        const read = L.oreBlind(w.getBlockName);
        const r = U.undergroundOf(read, HOUSE, DOWN, measure);
        assert.equal(r.places.length, 3, JSON.stringify(r.places.map(p => p.name)));
        assert.ok(!JSON.stringify(r).includes('_ore'));
        assert.ok(!JSON.stringify(r).includes('ancient_debris'));
    });
});

// T3's layout of W126 (tests/world/w126_base.js, smallBasePlan with ox 400, oz 0, g 60, as the first run of 2026-11-10 built it): the
// ground grass at y 60 on stone; the house x 397..403, z -3..3, its floor planks at y 60, walls 61..63 with oak logs at the corners,
// the roof at 64, the door at (400, 61, -3), the bed, a chest, a crafting table; the trapdoor (401, 60, 0) over the ladder of 6
// (401, 54..59, 0, facing south) down to the basement x 399..403, y 54..56, z 0..4 (its floor 53) with a chest, a furnace and a
// torch; the tunnel of 12 east (x 404..415, y 54..55, z 1..2); the opening west (x 397..398, y 54..55, z 2) into a dark cave
// 5 x 5 x 4 (x 392..396, y 54..57, z 0..4): a cave 2 blocks under the surface, which the rock rule of area_scan.js (3 solid
// blocks over the roof) never sees. 20 iron ore in the rock around the basement.
function t3Base() {
    const ox = 400, oz = 0, g = 60;
    const w = createBlockWorld();
    w.fill(ox - 40, 20, oz - 40, ox + 40, g - 1, oz + 40, 'stone');
    w.fill(ox - 40, g, oz - 40, ox + 40, g, oz + 40, 'grass_block');
    // the house (housePlan(ox - 3, oz - 3, g) of tests/world/world.js)
    const hx = ox - 3, hz = oz - 3;
    w.fill(hx, g, hz, hx + 6, g, hz + 6, 'oak_planks');
    w.fill(hx, g + 1, hz, hx + 6, g + 3, hz + 6, 'oak_planks');
    w.fill(hx + 1, g + 1, hz + 1, hx + 5, g + 3, hz + 5, 'air');
    w.fill(hx, g + 4, hz, hx + 6, g + 4, hz + 6, 'oak_planks');
    for (const [a, c] of [[hx, hz], [hx + 6, hz], [hx, hz + 6], [hx + 6, hz + 6]]) w.fill(a, g + 1, c, a, g + 3, c, 'oak_log');
    w.set(hx + 3, g + 1, hz, 'oak_door').set(hx + 3, g + 2, hz, 'oak_door');
    w.set(hx + 1, g + 1, hz + 4, 'red_bed').set(hx + 1, g + 1, hz + 5, 'red_bed');
    w.set(hx + 5, g + 1, hz + 5, 'chest').set(ox + 2, g + 1, oz - 2, 'crafting_table');
    // the basement, the ladder, the trapdoor
    w.fill(ox - 1, g - 6, oz, ox + 3, g - 4, oz + 4, 'air');
    w.fill(ox + 1, g - 6, oz, ox + 1, g - 1, oz, 'ladder');
    w.set(ox + 1, g, oz, 'oak_trapdoor');
    w.set(ox - 1, g - 6, oz + 4, 'chest').set(ox + 3, g - 6, oz + 4, 'furnace').set(ox + 1, g - 6, oz + 4, 'torch');
    // the tunnel, the opening into the cave, the cave
    w.fill(ox + 4, g - 6, oz + 1, ox + 15, g - 5, oz + 2, 'air');
    w.fill(ox - 3, g - 6, oz + 2, ox - 2, g - 5, oz + 2, 'air');
    w.fill(ox - 8, g - 6, oz, ox - 4, g - 3, oz + 4, 'air');
    // the ore (part E)
    for (let x = ox - 1; x <= ox + 3; x++) for (const z of [oz + 1, oz + 2]) w.set(x, g - 8, z, 'iron_ore');
    for (let x = ox - 1; x <= ox + 3; x++) for (const y of [g - 6, g - 5]) w.set(x, y, oz + 6, 'iron_ore');
    const house = { name: 'house', kind: 'home', type: 'home', box: { min: { x: hx, y: g, z: hz }, max: { x: hx + 6, y: g + 4, z: hz + 6 } },
        entrances: [{ x: ox + 1, y: g, z: oz, kind: 'trapdoor' }, { x: hx + 3, y: g + 1, z: hz, kind: 'door' }] };
    const down = [{ x: ox + 1, y: g, z: oz }];
    for (let y = g - 6; y <= g - 1; y++) down.push({ x: ox + 1, y, z: oz });
    return { w, house, down, ox, oz, g };
}

describe('T3\'s layout of W126 (the first run of 2026-11-10): the cave 2 blocks under the surface', () => {
    test('the basement, the mine entrance at the tunnel\'s mouth, the cave mouth at the opening (the rock rule saw no cave: the space beyond judged)', () => {
        const { w, house, down } = t3Base();
        const r = U.undergroundOf(L.oreBlind(w.getBlockName), house, down, measure);
        assert.ok(r.basement, 'the basement');
        assert.deepEqual(r.basement.box, { min: { x: 398, y: 53, z: -1 }, max: { x: 404, y: 57, z: 5 } }, 'the box of T3\'s run');
        assert.deepEqual(r.places.map(p => [p.name, p.type]), [['basement', 'building'], ['cave_mouth', 'building'], ['mine_entrance', 'place']]);
        const cave = r.places.find(p => p.name === 'cave_mouth');
        assert.deepEqual(cave.at, { x: 398, y: 54, z: 2 }, 'the opening cell of the west wall');
        assert.deepEqual(cave.box, { min: { x: 397, y: 53, z: 1 }, max: { x: 399, y: 55, z: 3 } });
        assert.deepEqual(cave.flags, { no_enter: true });
        const mine = r.places.find(p => p.name === 'mine_entrance');
        assert.deepEqual(mine.at, { x: 404, y: 54, z: 1 });
        assert.equal(mine.detail.tunnel.length >= 4, true);
        const openings = r.openings;
        assert.equal(openings.find(o => o.dir === 'west').enclosure.judged, 'beyond', 'the cave by the fallback');
        assert.equal(openings.find(o => o.dir === 'east').enclosure.judged, undefined, 'the tunnel by the scan of the rock');
        assert.ok(!JSON.stringify(r).includes('_ore'));
        assert.deepEqual(r.routes.map(x => x.name), ['house_to_cave_mouth', 'house_to_mine_entrance']);
        const ladder = r.routes[0].legs.find(l => l.kind === 'ladder');
        assert.deepEqual({ top: ladder.top, bottom: ladder.bottom, x: ladder.x, z: ladder.z }, { top: 59, bottom: 54, x: 401, z: 0 });
    });

    test('the same cave with the ore around it all stone (no fallback needed when deep): a deeper cave is found by the scan of the rock itself', () => {
        const { w, house, down, ox, oz, g } = t3Base();
        w.fill(ox - 8, g - 6, oz, ox - 4, g - 3, oz + 4, 'stone'); // the cave filled
        w.fill(ox - 8, g - 6, oz, ox - 4, g - 5, oz + 4, 'air'); // dug again 2 high: the roof block at g - 4, 3 solid blocks over it
        const r = U.undergroundOf(w.getBlockName, house, down, measure);
        const cave = r.openings.find(o => o.dir === 'west');
        assert.equal(cave.kind, 'cave');
        assert.equal(cave.enclosure.judged, undefined, 'the scan of the rock saw it');
    });
});

describe('module rules', () => {
    test('underground_logic.js is pure: area_scan.js, area_kind.js and box_math.js only, no packages, no side effects', () => {
        assertImportRules(`${DIR}underground_logic.js`, { allowBuiltins: [], allowedRelative: ['area_scan.js', 'area_kind.js', 'open_farm.js', 'box_math.js'] });
        assertCleanImport(`${DIR}underground_logic.js`);
    });
});
