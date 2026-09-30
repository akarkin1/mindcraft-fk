// T1, spec v0.1.4.9 part B, the pure functions of src/agent/packs/mining/mine_logic.js (I6) and the table of the
// ores (B4): mineAt (I6, B8: the room, the tunnels 2 high, the branches, the legs of the route, 1 block of
// tolerance), tunnelFor (the tunnel whose level lies in the range of the ore, nearest to its best level),
// branchPlan (B5: from a length of 32, at 4, 8, 12, ... first left then right, 8 long, the first not done),
// measureTunnel and corridorDirections (B3) on a small world (a getName function over a Map, stone elsewhere),
// tunnelView with senseRange (B7: 0 is the view of v0.1.4.7/8). Directions as in Minecraft: north is -z, east +x;
// the left of north is west.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { loadOld } from '../helpers/rt_old_source.js';

const L = await loadSrc('src/agent/packs/mining/mine_logic.js');
const O = await loadSrc('src/agent/packs/mining/ore_table.js');
const OLD = await loadOld('src/agent/packs/mining/mine_logic.js');

const cell = (p) => (p ? { x: p.x, y: p.y, z: p.z } : p);

// ------------------------------------------------------------------------------ B4: the ranges of the ores

describe('B4: ORES get min and max', () => {
    const RANGES = { coal: [0, 192], copper: [-16, 112], iron: [-64, 72], lapis: [-64, 64], gold: [-64, 32], redstone: [-64, 15], diamond: [-64, 16] };
    for (const [ore, [min, max]] of Object.entries(RANGES)) {
        test(`${ore}: ${min}..${max}`, () => {
            const row = O.ORES.find((r) => r.ore === ore);
            assert.ok(row, ore);
            assert.equal(row.min, min);
            assert.equal(row.max, max);
            assert.ok(row.level >= min && row.level <= max, `the best level ${row.level} lies in the range`);
        });
    }

    test('the other columns of the table of v0.1.4.7 are unchanged', () => {
        const old = { coal: [96, 'wooden', 'coal'], copper: [48, 'stone', 'raw_copper'], iron: [16, 'stone', 'raw_iron'], lapis: [0, 'stone', 'lapis_lazuli'],
            gold: [-16, 'iron', 'raw_gold'], redstone: [-59, 'iron', 'redstone'], diamond: [-59, 'iron', 'diamond'] };
        assert.deepEqual(O.ORES.map((r) => r.ore), Object.keys(old));
        for (const row of O.ORES) assert.deepEqual([row.level, row.pickaxe, row.item], old[row.ore], row.ore);
    });
});

// ------------------------------------------------------------------------------ I6, B8: mineAt

// The mine of the player: a walk on the grass, a trapdoor, a ladder down, a walk into the room; the room at y 42;
// tunnel 0 at level 25 going east from (50, 25, 0) to (61, 25, 0); tunnel 1 at level -40 going north.
function playerMine() {
    return {
        name: 'mine', source: 'player', ore: 'iron', entrance: { x: 40, y: 64, z: 0 }, level: 42, dimension: 'overworld',
        route: [
            { kind: 'walk', from: { x: 40, y: 64, z: 0 }, to: { x: 34, y: 64, z: 0 } },
            { kind: 'door', kind2: 'trapdoor', name: 'oak_trapdoor', x: 30, y: 63, z: 0, from: { x: 31, y: 64, z: 0 }, to: { x: 30, y: 62, z: 0 } },
            { kind: 'ladder', x: 30, z: 0, top: 62, bottom: 42, face: 'south', entry: { x: 31, y: 64, z: 0 } },
            { kind: 'walk', from: { x: 30, y: 42, z: 0 }, to: { x: 30, y: 42, z: 4 } },
        ],
        room: { center: { x: 30, y: 42, z: 6 }, chest: { x: 32, y: 42, z: 7 }, table: { x: 28, y: 42, z: 7 }, furnace: { x: 30, y: 42, z: 8 } },
        tunnels: [
            { start: { x: 50, y: 25, z: 0 }, dir: 'east', end: { x: 61, y: 25, z: 0 }, level: 25, length: 12, branches: [] },
            { start: { x: 50, y: -40, z: 10 }, dir: 'north', end: { x: 50, y: -40, z: -5 }, level: -40, length: 16,
                branches: [{ at: 4, side: 'left', start: { x: 49, y: -40, z: 6 }, end: { x: 42, y: -40, z: 6 }, length: 8, done: true }] },
        ],
        passed: [],
    };
}

describe('I6, B8: mineAt(mines, pos)', () => {
    const at = (x, y, z, mines = [playerMine()]) => L.mineAt(mines, { x, y, z });
    const where = (r) => (r ? { name: r.mine?.name, tunnel: r.tunnel, onRoute: r.onRoute } : null);

    test('in the room: the mine, no tunnel, not on the route', () => {
        assert.deepEqual(where(at(30, 42, 6)), { name: 'mine', tunnel: null, onRoute: false });
        assert.deepEqual(where(at(32, 42, 7)), { name: 'mine', tunnel: null, onRoute: false }, 'at the chest');
        assert.deepEqual(where(at(29, 42, 7)), { name: 'mine', tunnel: null, onRoute: false }, 'inside the box of the room');
    });

    test('in a tunnel: its index, not on the route; 2 high; a fractional position', () => {
        assert.deepEqual(where(at(55, 25, 0)), { name: 'mine', tunnel: 0, onRoute: false });
        assert.deepEqual(where(at(55, 26, 0)), { name: 'mine', tunnel: 0, onRoute: false }, 'the head cell');
        assert.deepEqual(where(at(50, 25, 0)), { name: 'mine', tunnel: 0, onRoute: false }, 'the start');
        assert.deepEqual(where(at(61, 25, 0)), { name: 'mine', tunnel: 0, onRoute: false }, 'the end');
        assert.deepEqual(where(at(50, -40, 0)), { name: 'mine', tunnel: 1, onRoute: false });
        assert.deepEqual(where(L.mineAt([playerMine()], { x: 55.7, y: 25.0, z: 0.3 })), { name: 'mine', tunnel: 0, onRoute: false });
    });

    test('1 block of tolerance around a tunnel, not 2', () => {
        assert.equal(at(55, 27, 0)?.tunnel, 0, '1 above the head');
        assert.equal(at(55, 24, 0)?.tunnel, 0, '1 below the feet');
        assert.equal(at(55, 25, 1)?.tunnel, 0, '1 beside');
        assert.equal(at(62, 25, 0)?.tunnel, 0, '1 beyond the end');
        assert.equal(at(55, 28, 0), null, '2 above the head');
        assert.equal(at(55, 25, 2), null, '2 beside');
        assert.equal(at(63, 25, 0), null, '2 beyond the end');
    });

    test('in a branch: the mine', () => {
        const r = at(45, -40, 6);
        assert.ok(r, 'in the branch');
        assert.equal(r.mine.name, 'mine');
    });

    test('on the route: the ladder column, the entry of the ladder, a walk leg, the trapdoor', () => {
        for (const [x, y, z, what] of [[30, 50, 0, 'the ladder'], [30, 43, 0, 'the ladder near its bottom'], [31, 64, 0, 'the entry'],
            [37, 64, 0, 'the walk on the grass'], [30, 42, 2, 'the walk to the room'], [30, 63, 0, 'the trapdoor']]) {
            assert.deepEqual(where(at(x, y, z)), { name: 'mine', tunnel: null, onRoute: true }, what);
        }
    });

    test('1 block of tolerance around the route, not 2', () => {
        assert.equal(at(31, 50, 0)?.onRoute, true, 'beside the ladder');
        assert.equal(at(32, 50, 0), null, '2 beside the ladder');
    });

    test('far from everything, no mines, or no position: null', () => {
        assert.equal(at(0, 64, 100), null);
        assert.equal(at(55, 25, 0, []), null);
        assert.equal(L.mineAt([playerMine()], null), null);
    });

    test('two mines: the one that holds the position', () => {
        const other = { ...playerMine(), name: 'deep', room: null, route: [], tunnels: [{ start: { x: -50, y: -50, z: 0 }, dir: 'west', end: { x: -60, y: -50, z: 0 }, level: -50, length: 11, branches: [] }] };
        assert.equal(L.mineAt([playerMine(), other], { x: -55, y: -50, z: 0 })?.mine?.name, 'deep');
        assert.equal(L.mineAt([other, playerMine()], { x: 55, y: 25, z: 0 })?.mine?.name, 'mine');
    });
});

// ------------------------------------------------------------------------------ I6: tunnelFor

describe('I6: tunnelFor(mine, ore)', () => {
    const mine = (levels) => ({ ...playerMine(), tunnels: levels.map((level, i) => ({ start: { x: i * 10, y: level, z: 0 }, dir: 'north', end: { x: i * 10, y: level, z: -11 }, level, length: 12, branches: [] })) });

    test('both in range: the tunnel nearest to the best level of the ore', () => {
        assert.equal(L.tunnelFor(mine([25, -40]), 'iron'), 0, 'iron best 16: 25 is nearer than -40');
        assert.equal(L.tunnelFor(mine([-40, 25]), 'iron'), 1);
        assert.equal(L.tunnelFor(mine([25, -40]), 'gold'), 1, 'gold best -16: -40 is 24 away, 25 is 41 away');
    });

    test('only one in range: that one', () => {
        assert.equal(L.tunnelFor(mine([25, -40]), 'diamond'), 1, 'diamond -64..16');
        assert.equal(L.tunnelFor(mine([25, -40]), 'coal'), 0, 'coal 0..192');
    });

    test('none in range: null', () => {
        assert.equal(L.tunnelFor(mine([25]), 'diamond'), null);
        assert.equal(L.tunnelFor(mine([25]), 'redstone'), null);
        assert.equal(L.tunnelFor(mine([-40]), 'coal'), null);
        assert.equal(L.tunnelFor(mine([]), 'iron'), null);
    });

    test('the bounds of the range count', () => {
        assert.equal(L.tunnelFor(mine([16]), 'diamond'), 0, '16 is the top of diamond');
        assert.equal(L.tunnelFor(mine([17]), 'diamond'), null);
        assert.equal(L.tunnelFor(mine([0]), 'coal'), 0, '0 is the bottom of coal');
        assert.equal(L.tunnelFor(mine([-1]), 'coal'), null);
    });

    test('the ore by the name of its block or item', () => {
        assert.equal(L.tunnelFor(mine([25]), 'iron_ore'), 0);
        assert.equal(L.tunnelFor(mine([25]), 'diamond_ore'), null);
    });
});

// ------------------------------------------------------------------------------ B5: branchPlan

describe('B5: branchPlan(tunnel)', () => {
    const tunnel = (length, branches = []) => ({ start: { x: 0, y: -40, z: 0 }, dir: 'north', end: { x: 0, y: -40, z: -(length - 1) }, level: -40, length, branches });
    const b = (at, side, done, extra = {}) => ({ at, side, start: { x: side === 'left' ? -1 : 1, y: -40, z: -at }, end: { x: side === 'left' ? -8 : 8, y: -40, z: -at }, length: done ? 8 : 3, done, ...extra });
    const plan = (t) => {
        const r = L.branchPlan(t);
        return r ? { at: r.at, side: r.side } : null;
    };

    test('below 32 blocks: null', () => {
        assert.equal(L.branchPlan(tunnel(31)), null);
        assert.equal(L.branchPlan(tunnel(12)), null);
    });

    test('at 32: the first branch at 4 to the left', () => {
        assert.deepEqual(plan(tunnel(32)), { at: 4, side: 'left' });
    });

    test('the order: at each `at` first left then right; 4, 8, 12', () => {
        assert.deepEqual(plan(tunnel(32, [b(4, 'left', true)])), { at: 4, side: 'right' });
        assert.deepEqual(plan(tunnel(32, [b(4, 'left', true), b(4, 'right', true)])), { at: 8, side: 'left' });
        assert.deepEqual(plan(tunnel(32, [b(4, 'left', true), b(4, 'right', true), b(8, 'left', true)])), { at: 8, side: 'right' });
        assert.deepEqual(plan(tunnel(40, [b(4, 'left', true), b(4, 'right', true), b(8, 'left', true), b(8, 'right', true)])), { at: 12, side: 'left' });
    });

    test('done branches are skipped; a branch not done is the next; nearest to the start first', () => {
        assert.deepEqual(plan(tunnel(32, [b(4, 'left', false)])), { at: 4, side: 'left' }, 'begun, not done');
        assert.deepEqual(plan(tunnel(32, [b(4, 'left', true), b(4, 'right', false)])), { at: 4, side: 'right' });
        assert.deepEqual(plan(tunnel(32, [b(8, 'left', true), b(8, 'right', true)])), { at: 4, side: 'left' }, 'the one at 4 is missing');
        assert.deepEqual(plan(tunnel(32, [b(8, 'right', true), b(4, 'right', true), b(4, 'left', true)])), { at: 8, side: 'left' }, 'the order of the list does not matter');
    });

    test('a branch starts beside the tunnel at `at` from its start: left of north is west, right is east', () => {
        // The plan is the record of a branch not dug yet (start, end at the start, length 0); the 8 blocks of B5 are
        // what digTunnel digs with options.line (W73), not a field of the plan.
        const left = L.branchPlan(tunnel(32));
        assert.deepEqual(cell(left.start), { x: -1, y: -40, z: -4 }, JSON.stringify(left));
        if (left.dir !== undefined) assert.equal(left.dir, 'west');
        assert.equal(left.done, false);
        const right = L.branchPlan(tunnel(32, [b(4, 'left', true)]));
        assert.deepEqual(cell(right.start), { x: 1, y: -40, z: -4 }, JSON.stringify(right));
        if (right.dir !== undefined) assert.equal(right.dir, 'east');
    });
});

// ------------------------------------------------------------------------------ B3: measureTunnel, corridorDirections

// A corridor 1 wide and 2 high at x 22, feet y 25, from z 2 north to z -9; south of it at z 3..5 a room of 3 x 3
// (x 21..23), 2 high. Stone elsewhere.
function corridorWorld({ room = true } = {}) {
    const open = new Map();
    const air = (x, y, z) => open.set(`${x},${y},${z}`, 'air');
    for (let z = -9; z <= 2; z++) for (const y of [25, 26]) air(22, y, z);
    if (room) for (let x = 21; x <= 23; x++) for (let z = 3; z <= 5; z++) for (const y of [25, 26]) air(x, y, z);
    const getName = (x, y, z) => open.get(`${x},${y},${z}`) ?? 'stone';
    return { getName, open };
}

describe('B3: measureTunnel(getName, feet, dir)', () => {
    test('from the middle, north: start the last cell before the room, end the last open cell before rock, 12 long, level 25', () => {
        const { getName } = corridorWorld();
        const r = L.measureTunnel(getName, { x: 22, y: 25, z: -3 }, 'north');
        assert.deepEqual(cell(r.start), { x: 22, y: 25, z: 2 });
        assert.deepEqual(cell(r.end), { x: 22, y: 25, z: -9 });
        assert.equal(r.length, 12);
        assert.equal(r.level, 25);
    });

    test('a corridor that ends behind the bot (no room): start the last open cell', () => {
        const { getName } = corridorWorld({ room: false });
        const r = L.measureTunnel(getName, { x: 22, y: 25, z: 0 }, 'north');
        assert.deepEqual(cell(r.start), { x: 22, y: 25, z: 2 });
        assert.deepEqual(cell(r.end), { x: 22, y: 25, z: -9 });
        assert.equal(r.length, 12);
    });

    test('a fractional position of the feet', () => {
        const { getName } = corridorWorld();
        const r = L.measureTunnel(getName, { x: 22.5, y: 25, z: -2.7 }, 'north');
        assert.deepEqual(cell(r.end), { x: 22, y: 25, z: -9 });
        assert.equal(r.level, 25);
    });

    test('pure: no direction, nothing to measure: null, no throw', () => {
        const { getName } = corridorWorld();
        assert.equal(L.measureTunnel(getName, { x: 22, y: 25, z: -3 }, 'up'), null);
    });
});

describe('B3: corridorDirections(getName, feet)', () => {
    const dirs = (r) => Object.fromEntries(r.map((d) => [d.dir, d.length]));

    test('in the middle of the corridor: north and south, not east or west', () => {
        const { getName } = corridorWorld();
        const r = dirs(L.corridorDirections(getName, { x: 22, y: 25, z: -3 }));
        assert.deepEqual(Object.keys(r).sort(), ['north', 'south']);
        assert.equal(r.north, 6, 'z -4..-9');
    });

    test('2 or more open cells ahead: one open cell is not a corridor', () => {
        const { getName } = corridorWorld();
        const r = dirs(L.corridorDirections(getName, { x: 22, y: 25, z: -8 }));
        assert.equal(r.north, undefined, 'one open cell to the north');
        assert.ok(r.south >= 2);
        const at7 = dirs(L.corridorDirections(getName, { x: 22, y: 25, z: -7 }));
        assert.equal(at7.north, 2, 'two open cells to the north');
    });

    test('at the dead end: only south', () => {
        const { getName } = corridorWorld();
        assert.deepEqual(Object.keys(dirs(L.corridorDirections(getName, { x: 22, y: 25, z: -9 }))), ['south']);
    });

    test('in solid rock: none', () => {
        const getName = () => 'stone';
        assert.deepEqual(L.corridorDirections(getName, { x: 0, y: 0, z: 0 }), []);
    });
});

// ------------------------------------------------------------------------------ B7: tunnelView and senseRange

describe('B7: tunnelView with senseRange; 0 is the view of v0.1.4.8', () => {
    // a tunnel dug east at feet y 20 from x 0; iron ore in the left (north) wall 2 blocks inside, coal in the right
    // wall touching the tunnel, stone elsewhere
    function wall(extra = {}) {
        const cells = new Map(Object.entries({ '0,20,0': 'air', '0,21,0': 'air', '1,20,-3': 'iron_ore', '1,20,1': 'coal_ore', ...extra }));
        return (x, y, z) => cells.get(`${x},${y},${z}`) ?? 'stone';
    }
    const FEET = { x: 0, y: 20, z: 0 };

    test('senseRange 0 and no senseRange give the same view', () => {
        assert.deepEqual(L.tunnelView(wall(), FEET, 'east', 1, 0), L.tunnelView(wall(), FEET, 'east', 1));
    });

    test('the view with senseRange 0 is the view of v0.1.4.8', (t) => {
        if (!OLD) return t.skip('the tag v0.1.4.8 is not in this checkout');
        for (const extra of [{}, { '1,22,0': 'gravel' }, { '2,20,0': 'lava' }, { '1,19,0': 'water' }, { '1,20,-1': 'diamond_ore' }]) {
            assert.deepEqual(L.tunnelView(wall(extra), FEET, 'east', 1, 0), OLD.tunnelView(wall(extra), FEET, 'east', 1), JSON.stringify(extra));
        }
    });

    test('tunnelStep of such a view: the decisions of v0.1.4.8 (every field the old step had)', (t) => {
        if (!OLD) return t.skip('the tag v0.1.4.8 is not in this checkout');
        for (const extra of [{}, { '1,22,0': 'gravel' }, { '2,20,0': 'lava' }, { '1,19,0': 'water' }, { '1,20,-1': 'diamond_ore' }, { '1,21,1': 'iron_ore' }]) {
            const view = OLD.tunnelView(wall(extra), FEET, 'east', 1);
            const before = OLD.tunnelStep(JSON.parse(JSON.stringify(view)));
            const now = L.tunnelStep(JSON.parse(JSON.stringify(view)));
            for (const key of Object.keys(before)) assert.deepEqual(now[key], before[key], `${key} for ${JSON.stringify(extra)}`);
        }
    });

    test('senseRange 3 sees the ore 2 blocks inside the wall; 0 does not', () => {
        const near = JSON.stringify(L.tunnelView(wall(), FEET, 'east', 1, 0));
        const far = JSON.stringify(L.tunnelView(wall(), FEET, 'east', 1, 3));
        assert.ok(!near.includes('iron_ore'), near);
        assert.ok(far.includes('iron_ore'), far);
    });
});
