// Release v0.1.4.12, part F (engineer E5): the scans underground (SPEC 4.5, F1, F2, F4).
//   - scanEnclosure of src/agent/areas/area_scan.js under rock: a border of natural rock (2 of 3 of the border cells or
//     more) gives border 'rock'; a tunnel 1 or 2 wide and 4 long or more (tunnelAt of the mining pack) is a tunnel, else
//     a cave; nothing is found for !rememberArea without a type, whose answer is the refusal of F1;
//   - countContents of area_sense.js does not count water inside rock;
//   - the sentences of F2 (area_kind.js tunnelText, caveText, rockText) word for word;
//   - F4: each cell is read once per scan (at most 4 reads per cell of the box of a 13 x 26 x 5 corridor), a scan over
//     2 s says how long it took.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { createBlockWorld } from '../helpers/block_world.js';

const S = await loadSrc('src/agent/areas/area_scan.js');
const K = await loadSrc('src/agent/areas/area_kind.js');
const A = await loadSrc('src/agent/areas/area_sense.js');
const M = await loadSrc('src/agent/packs/mining/mine_logic.js');

const FEET = 50;
const at = (x, z, y = FEET) => ({ x: x + 0.5, y, z: z + 0.5 });
const rock = () => createBlockWorld().flatGround(120, 'stone', 'stone');
const scan = (world, origin, options = {}) => S.scanEnclosure(world.getBlockName, origin, { tunnelAt: M.tunnelAt, ...options });
const botOf = (world) => ({ entities: {}, blockAt: (p) => world.blockAt(p) });

const TUNNEL_REFUSAL = 'I am in a tunnel; a tunnel is saved with "this is the mine" or "dig here".';
const CAVE_REFUSAL = 'I am in a cave; a cave is nothing I save.';

// A corridor 2 wide and 23 long along x (x 0..22, z 0..1, 2 high) in rock, a room of 5 x 6 at its east end.
function tunnel2x23() {
    const world = rock();
    world.fill(0, FEET, 0, 22, FEET + 1, 1, 'air');
    world.fill(23, FEET, -2, 27, FEET + 2, 3, 'air');
    return world;
}

// A corridor 1 wide and 9 long along z (x 0, z 0..8) in rock, a room of 5 x 5 at its south end.
function tunnel1x9() {
    const world = rock();
    world.fill(0, FEET, 0, 0, FEET + 1, 8, 'air');
    world.fill(-2, FEET, 9, 2, FEET + 2, 13, 'air');
    return world;
}

// A hole of 6 x 3 x 6 (x 0..5, z 0..5) in rock, open on 3 sides: a passage 2 high out of its north, east and south
// walls, its west wall closed.
function cave6x3x6() {
    const world = rock();
    world.fill(0, FEET, 0, 5, FEET + 2, 5, 'air');
    world.fill(1, FEET, -1, 1, FEET + 1, -3, 'air');
    world.fill(6, FEET, 4, 8, FEET + 1, 4, 'air');
    world.fill(4, FEET, 6, 4, FEET + 1, 8, 'air');
    return world;
}

// The owner's corridor of rock (13 x 26 x 5: x 0..12, y 49..53, z 0..25): a corridor 2 wide along z (x 5..6, z 1..24),
// a cross corridor along x (z 12..13, x 1..11), pockets of water in its east wall (x 7..8, z 3..8, at the feet) and
// in its floor (x 5..6, z 20..22), a torch (a torch shows no use, F7).
const CORRIDOR_BOX = { min: { x: 0, y: 49, z: 0 }, max: { x: 12, y: 53, z: 25 } };
function corridor13x26() {
    const world = rock();
    world.fill(5, FEET, 1, 6, FEET + 1, 24, 'air');
    world.fill(1, FEET, 12, 11, FEET + 1, 13, 'air');
    world.fill(7, FEET, 3, 8, FEET, 8, 'water');
    world.fill(5, FEET - 1, 20, 6, FEET - 1, 22, 'water');
    world.set(5, FEET, 10, 'torch');
    return world;
}

// F7: a basement dug into the stone under a house (x -3..3, z -2..3, 3 high), stone walls and a ceiling 3 thick, the
// floor of the house of planks above it, a trapdoor in the ceiling with a ladder under it, torches, a bed and a chest.
function basement() {
    const world = rock();
    world.fill(-3, FEET, -2, 3, FEET + 2, 3, 'air');
    world.fill(-5, FEET + 6, -5, 5, FEET + 6, 5, 'oak_planks');
    world.fill(-5, FEET + 7, -5, 5, 125, 5, 'air');
    world.fill(3, FEET + 4, -2, 3, FEET + 5, -2, 'air'); // the shaft up to the floor of the house
    world.set(3, FEET + 3, -2, 'oak_trapdoor');
    world.fill(3, FEET, -2, 3, FEET + 2, -2, 'ladder');
    world.set(-3, FEET + 1, 0, 'wall_torch');
    world.set(-3, FEET, 3, 'red_bed', { part: 'foot' });
    world.set(-2, FEET, 3, 'chest');
    return world;
}

// F7: a bare cave dug into rock (6 x 3 x 6, x 0..5, z 0..5), open to a passage 2 high one block up, nothing inside.
function bareCave() {
    const world = rock();
    world.fill(0, FEET, 0, 5, FEET + 2, 5, 'air');
    world.fill(2, FEET + 1, -1, 2, FEET + 2, -6, 'air');
    return world;
}

describe('F1: a border of rock is a tunnel or a cave', () => {
    test('the corridor of rock with water pockets: border rock, not found, the water not counted', () => {
        const world = corridor13x26();
        const r = scan(world, at(5, 12));
        assert.equal(r.border, 'rock');
        assert.equal(r.found, false, 'nothing for !rememberArea without a type');
        assert.equal(K.kindOf(r, A.countContents(botOf(world), r.box, { border: r.border })), 'cave');
        assert.deepEqual(r.box, { min: { x: 0, y: 49, z: 0 }, max: { x: 12, y: 52, z: 25 } });
        assert.ok(A.countContents(botOf(world), r.box).water > 0, 'without the border the pockets are water blocks');
        assert.equal(A.countContents(botOf(world), r.box, { border: 'rock' }).water, 0, 'inside rock the water is not counted');
        assert.equal(r.text, CAVE_REFUSAL);
        assert.equal(r.reason, 'cave');
    });

    test('in the same corridor away from the crossing: a tunnel 2 wide of 11 cells, its walls rock though water is in one', () => {
        const r = scan(corridor13x26(), at(5, 4));
        assert.equal(r.border, 'rock');
        assert.equal(K.kindOf(r, null), 'tunnel');
        assert.deepEqual({ width: r.tunnel.width, length: r.tunnel.length, dir: r.tunnel.dir }, { width: 2, length: 11, dir: 'north' });
        assert.equal(r.text, TUNNEL_REFUSAL);
    });

    test('a corridor 2 x 23 with a room at its end: a tunnel 2 wide and 23 long, heading away from the room', () => {
        const r = scan(tunnel2x23(), at(11, 0));
        assert.equal(r.found, false);
        assert.equal(r.border, 'rock');
        assert.equal(K.kindOf(r, A.emptyContents()), 'tunnel');
        assert.deepEqual(r.tunnel, { start: { x: 22, y: FEET, z: 0 }, end: { x: 0, y: FEET, z: 0 }, dir: 'west', length: 23, width: 2, level: FEET });
        assert.deepEqual(r.box, { min: { x: -1, y: FEET - 1, z: -1 }, max: { x: 23, y: FEET + 2, z: 2 } });
        assert.equal(r.reason, 'tunnel');
        assert.equal(r.text, TUNNEL_REFUSAL);
    });

    test('a hole of 6 x 3 x 6 open on 3 sides: a cave', () => {
        const r = scan(cave6x3x6(), at(2, 2));
        assert.equal(r.border, 'rock');
        assert.equal(r.found, false);
        assert.equal(K.kindOf(r, A.emptyContents()), 'cave');
        assert.deepEqual(r.cave, { at: { x: 2, y: FEET, z: 2 }, width: 6, sides: 3 });
        assert.equal(r.tunnel, null);
        assert.equal(r.text, CAVE_REFUSAL);
    });

    test('without the measure of a tunnel a tunnel is a cave; short corridors are no tunnel', () => {
        assert.equal(K.kindOf(scan(tunnel2x23(), at(11, 0), { tunnelAt: null }), null), 'cave');
        const world = rock();
        world.fill(0, FEET, 0, 0, FEET + 1, 2, 'air'); // 3 long, closed
        assert.equal(K.kindOf(scan(world, at(0, 1)), null), 'cave');
    });

    test('the refusals of !rememberArea without a type, word for word', () => {
        assert.equal(S.scanText('tunnel'), TUNNEL_REFUSAL);
        assert.equal(S.scanText('cave'), CAVE_REFUSAL);
        assert.ok(S.ENCLOSURE_BORDERS.includes('rock'));
        assert.deepEqual([...K.ROCK_KINDS], ['tunnel', 'cave']);
        assert.equal(K.typeOfKind('tunnel'), null, 'never a type of the area store');
        assert.equal(K.typeOfKind('cave'), null);
    });

    test('no rock: a corridor of planks underground, a pit under the sky, a stone house with a thin roof', () => {
        const built = rock();
        built.fill(-1, FEET - 1, -1, 1, FEET + 2, 10, 'oak_planks');
        built.fill(0, FEET, 0, 0, FEET + 1, 9, 'air');
        assert.notEqual(scan(built, at(0, 4)).border, 'rock', 'a corridor a player built is no tunnel');

        const pit = rock();
        pit.fill(-3, 115, -3, 3, 120, 3, 'air');
        assert.notEqual(scan(pit, { x: 0.5, y: 115, z: 0.5 }).border, 'rock', 'no roof over it');

        const house = createBlockWorld().flatGround(63);
        house.fill(-3, 64, -3, 3, 67, 3, 'stone');
        house.fill(-2, 64, -2, 2, 66, 2, 'air');
        assert.notEqual(scan(house, { x: 0.5, y: 64, z: 0.5 }).border, 'rock', 'a roof of one block with the sky above');
    });

    test('the scans of the surface keep their results: a fenced pen', () => {
        const world = createBlockWorld().flatGround(63);
        const pen = world.field({ x: 0, y: 63, z: 0, width: 7, depth: 5, ground: 'grass_block', crop: null });
        const r = scan(world, { x: pen.inside.x + 0.5, y: pen.inside.y, z: pen.inside.z + 0.5 });
        assert.equal(r.found, true);
        assert.equal(r.border, 'fence');
        assert.equal(K.kindOf(r, A.emptyContents()), 'yard');
    });
});

describe('F7: a place in rock that is used is no cave', () => {
    test('the basement with a trapdoor, a ladder, a bed and a chest: not rock, the old way (a building)', () => {
        const r = scan(basement(), at(0, 0));
        assert.notEqual(r.border, 'rock');
        assert.notEqual(r.reason, 'cave');
        assert.equal(r.found, true, 'the building scan finds it, so "this is the basement" saves it');
    });

    test('the same basement without the bed, the chest, the ladder and the trapdoor: a cave', () => {
        const world = basement();
        for (const [x, y, z] of [[-3, FEET, 3], [-2, FEET, 3], [3, FEET + 3, -2], [3, FEET, -2], [3, FEET + 1, -2], [3, FEET + 2, -2]]) {
            world.set(x, y, z, x === 3 && y === FEET + 3 ? 'stone' : 'air');
        }
        const r = scan(world, at(0, 0));
        assert.equal(r.border, 'rock');
        assert.equal(K.kindOf(r, null), 'cave');
    });

    test('a bare cave stays a cave; one chest in it makes it a used place', () => {
        const r = scan(bareCave(), at(2, 3));
        assert.equal(r.border, 'rock');
        assert.equal(K.kindOf(r, null), 'cave');
        assert.equal(r.text, CAVE_REFUSAL);
        assert.equal(K.rockText(r), 'I am in a cave at (2, 50, 3), 6 wide and open on 1 side.');
        for (const name of ['chest', 'crafting_table', 'furnace', 'ladder', 'white_bed', 'barrel']) {
            const world = bareCave();
            world.set(5, FEET, 5, name);
            assert.notEqual(scan(world, at(2, 3)).border, 'rock', name);
        }
        const torch = bareCave();
        torch.set(5, FEET, 5, 'torch');
        assert.equal(scan(torch, at(2, 3)).border, 'rock', 'a torch shows no use');
    });

    test('a tunnel stays a tunnel with a chest in the room at its end (the tunnel rule comes first)', () => {
        const world = tunnel2x23();
        world.set(27, FEET, 3, 'chest');
        assert.equal(K.kindOf(scan(world, at(11, 0)), null), 'tunnel');
    });
});

describe('F2: the sentences underground, word for word', () => {
    test('a tunnel of the mine "mine"', () => {
        const r = scan(tunnel2x23(), at(11, 0));
        assert.equal(K.rockText(r, { name: 'mine', tunnel: 0, level: FEET }), 'I am in a tunnel 2 wide and 23 long, heading west, of the mine "mine".');
        assert.equal(K.tunnelText(r.tunnel, 'mine'), 'I am in a tunnel 2 wide and 23 long, heading west, of the mine "mine".');
    });

    test('a tunnel of no mine', () => {
        const r = scan(tunnel1x9(), at(0, 4));
        assert.equal(K.rockText(r, null), 'I am in a tunnel 1 wide and 9 long, heading north, of no mine I know.');
    });

    test('a cave', () => {
        const r = scan(cave6x3x6(), at(2, 2));
        assert.equal(K.rockText(r, { name: 'mine' }), 'I am in a cave at (2, 50, 2), 6 wide and open on 3 sides.');
        assert.equal(K.caveText({ at: { x: 1, y: 40, z: -7 }, width: 4, sides: 1 }), 'I am in a cave at (1, 40, -7), 4 wide and open on 1 side.');
        assert.equal(K.caveText({ at: { x: 1, y: 40, z: -7 }, width: 4, sides: 0 }), 'I am in a cave at (1, 40, -7), 4 wide and closed on every side.');
    });

    test('nothing for what is not a place in rock', () => {
        assert.equal(K.rockText({ border: 'fence' }, 'mine'), '');
        assert.equal(K.rockText(null), '');
        assert.equal(K.tunnelText(null, 'mine'), '');
        assert.equal(K.caveText({}), '');
        assert.equal(K.tunnelText({ width: 1, length: 5, dir: 'west' }, { name: null }), 'I am in a tunnel 1 wide and 5 long, heading west, of my mine.');
    });
});

describe('F4: one pass, and the time of a slow scan', () => {
    test('the corridor of 13 x 26 x 5: each cell read once, at most 4 reads per cell of the box', () => {
        const world = corridor13x26();
        for (const origin of [at(5, 12), at(5, 4), at(6, 20)]) {
            const reads = new Map();
            let count = 0;
            const getBlockName = (x, y, z) => {
                count++;
                const key = `${x},${y},${z}`;
                reads.set(key, (reads.get(key) ?? 0) + 1);
                return world.getBlockName(x, y, z);
            };
            const r = S.scanEnclosure(getBlockName, origin, { tunnelAt: M.tunnelAt });
            assert.equal(r.border, 'rock');
            const cells = 13 * 26 * 5;
            assert.ok(count <= 4 * cells, `${count} reads for ${cells} cells`);
            assert.equal(Math.max(...reads.values()), 1, 'no cell is read twice in one scan');
        }
        assert.deepEqual(CORRIDOR_BOX.max.x - CORRIDOR_BOX.min.x + 1, 13);
    });

    test('a scan over 2 s appends "The scan took 3 s." to its text; 2 s or less says nothing', () => {
        let t = 0;
        const slow = () => { const v = t; t += 3000; return v; };
        const r = scan(cave6x3x6(), at(2, 2), { now: slow });
        assert.equal(r.took, 'The scan took 3 s.');
        assert.equal(r.text, `${CAVE_REFUSAL} The scan took 3 s.`);
        let u = 0;
        const quick = () => { const v = u; u += 2000; return v; };
        const q = scan(cave6x3x6(), at(2, 2), { now: quick });
        assert.equal(q.took, undefined);
        assert.equal(q.text, CAVE_REFUSAL);
        assert.equal(S.tookText(3200), 'The scan took 3 s.');
        assert.equal(S.tookText(2000), '');
    });

    test('the answer of !rememberArea after a slow scan says it too', () => {
        const enclosure = { border: 'fence', roof: false, openings: [{ x: 0, y: 64, z: 0, kind: 'gate' }], took: 'The scan took 3 s.' };
        const box = { min: { x: 0, y: 63, z: 0 }, max: { x: 8, y: 66, z: 6 } };
        assert.equal(K.savedText('aviary', 'pen', enclosure, { animals: { chicken: 6 } }, box),
            'I saved "aviary": a pen, fenced, 9 x 7, 1 gate, 6 chickens. I keep its gate closed and pick nothing up inside it. The scan took 3 s.');
    });
});

describe('F10: a scan is bounded', () => {
    test('an unbounded cave (air everywhere between a floor and a thick roof): found false, no_border, fast, under the caps', () => {
        let reads = 0;
        const get = (x, y, z) => { reads++; return y < FEET || y > FEET + 3 ? 'stone' : 'air'; };
        const started = Date.now();
        const r = S.scanEnclosure(get, at(0, 0), { tunnelAt: M.tunnelAt });
        assert.ok(Date.now() - started < 200, `${Date.now() - started} ms`);
        assert.equal(r.found, false);
        assert.equal(r.reason, 'no_border');
        assert.notEqual(r.border, 'rock');
        assert.ok(reads <= S.SCAN_READ_LIMIT, `${reads} reads`);
    });

    test('unbounded open air on a floor: found false, fast', () => {
        const started = Date.now();
        const r = S.scanEnclosure((x, y) => (y < FEET ? 'stone' : 'air'), at(0, 0), { tunnelAt: M.tunnelAt });
        assert.ok(Date.now() - started < 200);
        assert.equal(r.found, false);
    });

    test('a reader that never repeats a cell is cut at SCAN_READ_LIMIT: the scan ends as an open place', () => {
        let reads = 0;
        // a building of planks everywhere around: the building scan would read its whole region
        const r = S.scanEnclosure(() => { reads++; return reads % 3 === 0 ? 'oak_planks' : 'air'; }, at(0, 0), { mode: 'building' });
        assert.equal(typeof r.found, 'boolean');
        assert.ok(reads <= S.SCAN_READ_LIMIT, `${reads} reads`);
    });

    test('a tunnel that opens into a big cave: still a tunnel, the cave beyond is not in its box', () => {
        const world = rock();
        world.fill(0, FEET, 0, 0, FEET + 1, 9, 'air'); // the tunnel, 1 wide, z 0..9
        world.fill(-30, FEET, 10, 30, FEET + 3, 70, 'air'); // the big cave beyond its south end
        const started = Date.now();
        const r = scan(world, at(0, 3));
        assert.ok(Date.now() - started < 200);
        assert.equal(K.kindOf(r, null), 'tunnel');
        assert.ok(r.box.max.z - r.box.min.z + 1 <= S.ROCK_BOX_MAX.xz);
        const inCave = scan(world, at(0, 40));
        assert.equal(inCave.found, false);
        assert.notEqual(inCave.border, 'rock', 'a cave wider than the caps is open');
    });

    test('a tunnel longer than 46 cells has a box over 48: open, nothing to say', () => {
        const world = rock();
        world.fill(0, FEET, 0, 0, FEET + 1, 59, 'air');
        const r = scan(world, at(0, 30));
        assert.equal(r.found, false);
        assert.equal(r.reason, 'no_border');
        assert.notEqual(r.border, 'rock');
    });
});
