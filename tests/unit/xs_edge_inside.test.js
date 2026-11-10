// v0.1.4.15, the owner's finding Q-1 of 2026-11-10 ("locked out", "I stopped in the doorway"), reproduced by W126 part D (E4):
// the box of the floor scan (area_floors) and of the base survey has the walls as its edge, the box of scanBuilding without
// floors a margin of air outside the walls; interiorBox shrank both by 2, so in a wall-edge box the whole floor row along
// the walls counted as "outside", and both sides of a door in such a wall too: the bot inside by its door was sent to "get
// into the shelter", passThrough took the side away from the bot, and the bot walked out through its own door and closed
// it behind itself.
//   A. chooseSides: when neither side of the door lies in the interior, the side inside the box itself is the inner one.
//   B. The interior margin is 1 for a box whose edge is the wall (`edge: 'wall'`) and 2 for one with a margin (`edge:
//      'margin'`, or no mark, as before); edgeOf reads the kind from the world, withEdge puts it on an area; the area
//      store keeps it; sleep.js counts a bot in the floor row by the wall as inside and walks to the bed.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { makeWorld, makeFakeBot, buildHouse } from './home_fake_bot.test.js';

const B = await loadSrc('src/agent/packs/home/box_math.js');
const SL = await loadSrc('src/agent/packs/home/shelter_logic.js');
const D = await loadSrc('src/agent/packs/home/doors.js');
const DL = await loadSrc('src/agent/packs/home/door_logic.js');
const Z = await loadSrc('src/agent/packs/home/sleep.js');
const A = await loadSrc('src/agent/areas/area_scan.js');
const AS = await loadSrc('src/agent/areas/area_store.js');

const QUICK = { checkMs: 40, wait: () => new Promise(r => setTimeout(r, 2)) };

// The house of W126 as T3 built it: floor planks at y 60 over x 397..403, z -3..3, walls 61..63, roof 64, the door in the
// north wall at (400, 61, -3). The box of the floor scan: the walls as the edge; the box of scanBuilding: grown by 1.
function w126House() {
    const w = createBlockWorld();
    w.fill(380, 20, -20, 420, 59, 20, 'stone');
    w.fill(380, 60, -20, 420, 60, 20, 'grass_block');
    w.fill(397, 60, -3, 403, 64, 3, 'oak_planks');
    w.fill(398, 61, -2, 402, 63, 2, 'air');
    w.set(400, 61, -3, 'oak_door').set(400, 62, -3, 'oak_door');
    w.set(398, 61, 1, 'red_bed').set(398, 61, 2, 'red_bed');
    w.set(402, 61, 2, 'chest');
    return w;
}
const WALL_BOX = { min: { x: 397, y: 60, z: -3 }, max: { x: 403, y: 64, z: 3 } };
const MARGIN_BOX = { min: { x: 396, y: 59, z: -4 }, max: { x: 404, y: 65, z: 4 } };

describe('B: interiorBox by the kind of the edge', () => {
    test('a wall-edge box shrinks by 1, a margin box or an unmarked box by 2, an explicit margin wins', () => {
        assert.deepEqual(B.interiorBox({ ...WALL_BOX, edge: 'wall' }), { min: { x: 398, y: 60, z: -2 }, max: { x: 402, y: 64, z: 2 } });
        assert.deepEqual(B.interiorBox({ ...MARGIN_BOX, edge: 'margin' }), { min: { x: 398, y: 59, z: -2 }, max: { x: 402, y: 65, z: 2 } });
        assert.deepEqual(B.interiorBox(WALL_BOX), { min: { x: 399, y: 60, z: -1 }, max: { x: 401, y: 64, z: 1 } }, 'unmarked: as before');
        assert.deepEqual(B.interiorBox(WALL_BOX, 1), B.interiorBox({ ...WALL_BOX, edge: 'wall' }));
        assert.deepEqual(B.interiorBox(WALL_BOX, 0), WALL_BOX);
        assert.equal(B.interiorMargin({ edge: 'wall' }), 1);
        assert.equal(B.interiorMargin({ edge: 'margin' }), 2);
        assert.equal(B.interiorMargin({}), 2);
        assert.equal(B.interiorMargin(null), 2);
        assert.deepEqual([...B.BOX_EDGES], ['wall', 'margin']);
        assert.deepEqual({ ...B.EDGE_MARGINS }, { wall: 1, margin: 2 });
    });

    test('edgeOf reads the kind from the world: the floor scan\'s box is a wall edge, scanBuilding\'s a margin; unloaded: null', () => {
        const w = w126House();
        const floor = A.scanEnclosure(w.getBlockName, { x: 400.5, y: 61, z: 0.5 }, { mode: 'building', floors: true });
        assert.deepEqual({ min: floor.min, max: floor.max }, WALL_BOX, 'the floor scan gives the walls as the box');
        const plain = A.scanBuilding(w.getBlockName, { x: 400.5, y: 61, z: 0.5 });
        assert.deepEqual({ min: plain.min, max: plain.max }, MARGIN_BOX, 'scanBuilding grows by 1');
        assert.equal(B.edgeOf(w.getBlockName, floor.box), 'wall');
        assert.equal(B.edgeOf(w.getBlockName, plain), 'margin');
        assert.equal(B.edgeOf((x, y, z) => ({ name: w.getBlockName(x, y, z) }), floor.box), 'wall', 'a reader that gives { name } (blockReader)');
        assert.equal(B.edgeOf(() => null, floor.box), null);
        assert.equal(B.edgeOf(null, floor.box), null);
        assert.equal(B.edgeOf(w.getBlockName, null), null);
    });

    test('withEdge: an area keeps its mark, gets it from the world when it has none, stays as it is without a reader', () => {
        const w = w126House();
        const house = { name: 'house', type: 'home', ...WALL_BOX, entrances: [{ x: 400, y: 61, z: -3, kind: 'door' }] };
        assert.equal(SL.withEdge(house, w.getBlockName).edge, 'wall');
        assert.equal(SL.withEdge({ ...house, edge: 'margin' }, w.getBlockName).edge, 'margin', 'the mark stands');
        assert.equal(SL.withEdge(house).edge, undefined);
        assert.equal(SL.withEdge(house, () => null).edge, undefined);
        assert.equal(SL.withEdge(null, w.getBlockName), null);
        assert.equal(SL.withEdge(house, w.getBlockName).name, 'house');
    });

    test('isInsideArea: the floor row by the wall is inside a wall-edge box; in an unmarked box it is not (as before)', () => {
        const w = w126House();
        const house = { name: 'house', type: 'home', ...WALL_BOX, entrances: [] };
        const byTheWall = { x: 401.5, y: 61, z: -1.5 }; // where the bot stood after the climb (W126 D, cell z -2)
        assert.equal(SL.isInsideArea(house, byTheWall), false, 'today');
        assert.equal(SL.isInsideArea(SL.withEdge(house, w.getBlockName), byTheWall), true);
        assert.equal(SL.isInsideArea({ ...house, edge: 'wall' }, { x: 400.5, y: 61, z: -3.3 }), false, 'in front of the door, outside');
        assert.equal(SL.isInsideArea({ ...house, edge: 'wall' }, { x: 400.5, y: 61, z: -1.5 }), true, 'right behind the door (cell z -2), inside');
        assert.equal(SL.isInsideArea({ ...house, edge: 'wall' }, { x: 400.5, y: 61, z: -2.5 }), false, 'the door cell itself (z -3), the wall');
        assert.equal(SL.isInsideArea({ ...house, edge: 'wall' }, { x: 397.5, y: 61, z: 0.5 }), false, 'in the wall');
    });
});

describe('A: chooseSides when neither side lies in the interior', () => {
    // the door of the W126 house: in the north wall at (400, 61, -3), its sides (400, 61, -4) outside and (400, 61, -2) inside
    const door = { x: 400, y: 61, z: -3, kind: 'door', facing: 'south' };
    const sides = DL.doorSides(door);
    const house = { name: 'house', type: 'home', ...WALL_BOX, entrances: [{ ...door, kind: 'door' }] };
    const botAt = (x, y, z) => ({ entity: { position: { x, y, z } } });

    test('the sides: one in the box, one out, neither in the interior of the unmarked box', () => {
        const inner = sides.find(s => s.z === -2);
        const outer = sides.find(s => s.z === -4);
        assert.ok(inner && outer);
        const room = B.interiorBox(house);
        assert.equal(B.containsPos(room, { x: inner.x + 0.5, y: inner.y, z: inner.z + 0.5 }), false);
        assert.equal(B.containsPos(room, { x: outer.x + 0.5, y: outer.y, z: outer.z + 0.5 }), false);
    });

    test('the bot inside by the door: the far side is the inner side, never the way out (W126 D)', () => {
        const r = D.chooseSides(door, sides, botAt(400.6, 61, -1.5), house);
        assert.equal(r.far.z, -2, 'the inner side');
        assert.equal(r.near.z, -4);
    });

    test('the bot outside in front of the door: the far side is the inner side too', () => {
        const r = D.chooseSides(door, sides, botAt(400.5, 61, -4.5), house);
        assert.equal(r.far.z, -2);
    });

    test('with the mark wall the interior decides as before the fix; without any box the side away from the bot', () => {
        const marked = D.chooseSides(door, sides, botAt(400.6, 61, -1.5), { ...house, edge: 'wall' });
        assert.equal(marked.far.z, -2);
        const none = D.chooseSides(door, sides, botAt(400.6, 61, -1.5), null);
        assert.equal(none.far.z, -4, 'away from the bot, as before');
        const toward = D.chooseSides(door, sides, botAt(400.6, 61, -1.5), null, { x: 400.5, y: 61, z: -8 });
        assert.equal(toward.far.z, -4, 'toward a point');
    });
});

describe('B: the area store keeps the kind of the edge', () => {
    let dir;
    let cap;
    beforeEach(() => {
        dir = makeTmpDir();
        cap = captureConsole();
    });
    afterEach(() => {
        cap.restore();
        removeTmpDir(dir);
    });

    test('edge wall or margin is kept and read back; anything else is dropped; the same box keeps it, another box drops it', () => {
        const store = new AS.AreaStore(path.join(dir, 'areas.json'));
        store.load();
        const saved = store.set({ name: 'house', type: 'home', ...WALL_BOX, source: 'survey', edge: 'wall' });
        assert.equal(saved.edge, 'wall');
        assert.deepEqual([...AS.AREA_EDGES], ['wall', 'margin']);
        const again = new AS.AreaStore(path.join(dir, 'areas.json'));
        again.load();
        assert.equal(again.get('house').edge, 'wall');
        assert.equal(store.set({ name: 'house', type: 'home', ...WALL_BOX, source: 'survey' }).edge, 'wall', 'the same box keeps it');
        assert.equal(store.set({ name: 'house', type: 'home', ...MARGIN_BOX, source: 'manual' }).edge, undefined, 'another box drops it');
        assert.equal(store.set({ name: 'house', type: 'home', ...MARGIN_BOX, source: 'manual', edge: 'margin' }).edge, 'margin');
        assert.equal(store.set({ name: 'shed', type: 'building', ...MARGIN_BOX, edge: 'thick' }).edge, undefined);
    });
});

describe('B: sleep.js with a bot in the floor row by the wall of its wall-edge house', () => {
    // the house of home_fake_bot: walls at x, z 1..7, floor y 63, roof 68, the door in the south wall at (4, 64, 7); the box of
    // buildHouse is the margin box (0..8); the wall-edge box is (1, 63, 1) to (7, 69, 7)
    function scene(box) {
        const world = makeWorld();
        const house = buildHouse(world);
        world.bed(5, 64, 5, { facing: 'east' });
        const bot = makeFakeBot({ world, pos: [2.5, 64, 2.5] }); // the floor row by the west wall (x 1): cell x 2
        bot.time.timeOfDay = 13000;
        const area = { ...house, ...box };
        const ctx = { areas: [area], places: null, settings: {}, log: () => {}, now: () => Date.now() };
        return { world, bot, ctx, area };
    }

    test('the wall-edge box without the mark: the bot is inside (edgeOf reads the walls), walks to the bed and sleeps; the door is never touched', async () => {
        const { bot, ctx } = scene({ min: { x: 1, y: 63, z: 1 }, max: { x: 7, y: 69, z: 7 } });
        const r = await Z.sleepInBed(bot, ctx, QUICK);
        assert.equal(r.ok, true, r.text);
        assert.ok(!bot.calls.some(c => c[0] === 'activate' && c[1] === 4 && c[3] === 7), `the door was touched: ${JSON.stringify(bot.calls.filter(c => c[0] === 'activate'))}`);
        assert.ok(!bot.calls.some(c => c[0] === 'pf_open'), 'no door opened by the path search');
    });

    test('the margin box of buildHouse: inside as before, the same walk to the bed', async () => {
        const { bot, ctx } = scene({});
        const r = await Z.sleepInBed(bot, ctx, QUICK);
        assert.equal(r.ok, true, r.text);
        assert.ok(!bot.calls.some(c => c[0] === 'activate' && c[1] === 4 && c[3] === 7));
    });
});
