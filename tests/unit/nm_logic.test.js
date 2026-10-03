// Spec v0.1.4.11 part M (engineer E2), the pure functions of src/agent/packs/mining/mine_logic.js:
// I3 measureTunnel with `width` (1 or 2), corridorWidth, tunnelAt (the bot at the rock face measured
// backwards, the checks of W2 in their order: open sides at the feet, the width ahead, the ceiling; then the
// length), addTunnel; I4 tripStart with `inMine` and `fromInside`, insideShaft (the face of a shaft from the
// floor of a known mine). A small world: a getName function over a Map, stone elsewhere. North is -z, east +x.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const L = await loadSrc('src/agent/packs/mining/mine_logic.js');

// open cells (feet and head, 2 high) at feet level y; `extra` more open cells
function world() {
    const open = new Map();
    const w = {
        open,
        air(x, y, z) {
            open.set(`${x},${y},${z}`, 'air');
            return w;
        },
        cell(x, y, z) {
            return w.air(x, y, z).air(x, y + 1, z);
        },
        // a box of cells 2 high at feet level y
        room(x1, z1, x2, z2, y) {
            for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) w.cell(x, y, z);
            return w;
        },
        get: (x, y, z) => open.get(`${x},${y},${z}`) ?? 'stone',
    };
    return w;
}

// A room x 0..4, z 0..4 at y 30 (the anchor at its middle) and a tunnel from it going north at x 2,
// z -1 .. -10 (10 cells), 1 wide.
function oneWide() {
    return world().room(0, 0, 4, 4, 30).room(2, -1, 2, -10, 30);
}

// The same room and a tunnel 2 wide going north at x 2..3, z -1 .. -8.
function twoWide() {
    return world().room(0, 0, 4, 4, 30).room(2, -1, 3, -8, 30);
}

const ROOM = { x: 2, y: 30, z: 2 };

describe('I3: corridorWidth and measureTunnel with width', () => {
    test('a corridor 1 wide: width 1; the start the last cell before the room, as in v0.1.4.9', () => {
        const w = oneWide();
        assert.equal(L.corridorWidth(w.get, { x: 2, y: 30, z: -5 }, 'north'), 1);
        assert.deepEqual(L.measureTunnel(w.get, { x: 2, y: 30, z: -5 }, 'north'),
            { start: { x: 2, y: 30, z: -1 }, end: { x: 2, y: 30, z: -10 }, length: 10, level: 30, dir: 'north', width: 1 });
    });

    test('a corridor 2 wide: width 2, measured in the lane of the bot from the room to the rock', () => {
        const w = twoWide();
        assert.equal(L.corridorWidth(w.get, { x: 2, y: 30, z: -5 }, 'north'), 2);
        assert.equal(L.corridorWidth(w.get, { x: 3, y: 30, z: -5 }, 'south'), 2, 'either lane, either direction');
        assert.equal(L.corridorWidth(w.get, { x: 2, y: 30, z: 2 }, 'north'), 5, 'the room is 5 wide');
        assert.deepEqual(L.measureTunnel(w.get, { x: 2, y: 30, z: -5 }, 'north'),
            { start: { x: 2, y: 30, z: -1 }, end: { x: 2, y: 30, z: -8 }, length: 8, level: 30, dir: 'north', width: 2 });
    });

    test('nothing to measure: null, never a throw', () => {
        const w = oneWide();
        assert.equal(L.measureTunnel(w.get, { x: 9, y: 30, z: 9 }, 'north'), null, 'feet in rock');
        assert.equal(L.measureTunnel(w.get, { x: 2, y: 30, z: -5 }, 'up'), null);
        assert.equal(L.corridorWidth(w.get, null, 'north'), 0);
    });
});

describe('I3: tunnelAt, the tunnel at a cell', () => {
    test('in the middle of a tunnel 1 wide: the tunnel away from the room, width 1', () => {
        const r = L.tunnelAt(oneWide().get, { x: 2, y: 30, z: -5 }, { anchor: ROOM, minCells: 4 });
        assert.deepEqual(r, { ok: true, tunnel: { start: { x: 2, y: 30, z: -1 }, dir: 'north', end: { x: 2, y: 30, z: -10 }, level: 30, length: 10, width: 1 } });
    });

    test('a tunnel 2 wide is accepted and its width is 2', () => {
        const r = L.tunnelAt(twoWide().get, { x: 3, y: 30, z: -4 }, { anchor: ROOM, minCells: 4 });
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.deepEqual(r.tunnel, { start: { x: 3, y: 30, z: -1 }, dir: 'north', end: { x: 3, y: 30, z: -8 }, level: 30, length: 8, width: 2 });
    });

    test('the bot at the rock face: the only open way points at the room, measured backwards, dir away from the room', () => {
        const w = oneWide();
        for (const yaw of [undefined, 0, Math.PI, Math.PI / 2]) {
            const r = L.tunnelAt(w.get, { x: 2, y: 30, z: -10 }, { anchor: ROOM, yaw, minCells: 4 });
            assert.equal(r.ok, true, JSON.stringify(r));
            assert.deepEqual(r.tunnel, { start: { x: 2, y: 30, z: -1 }, dir: 'north', end: { x: 2, y: 30, z: -10 }, level: 30, length: 10, width: 1 }, `yaw ${yaw}`);
        }
        const wide = L.tunnelAt(twoWide().get, { x: 2, y: 30, z: -8 }, { anchor: ROOM, yaw: Math.PI, minCells: 4 });
        assert.deepEqual([wide.tunnel.dir, wide.tunnel.end, wide.tunnel.width], ['north', { x: 2, y: 30, z: -8 }, 2], 'at the face of a tunnel 2 wide');
    });

    test('W2 check 1: open on 3 or 4 sides at the feet', () => {
        const w = oneWide();
        const wall = L.tunnelAt(w.get, { x: 2, y: 30, z: 0 }, { anchor: ROOM });
        assert.deepEqual(wall, { ok: false, cause: { kind: 'open_sides', at: { x: 2, y: 30, z: 0 }, sides: 4 } }, 'the cell of the room at the mouth of the tunnel');
        const middle = L.tunnelAt(w.get, { x: 1, y: 30, z: 1 }, { anchor: ROOM });
        assert.equal(middle.cause.kind, 'open_sides');
        assert.equal(middle.cause.sides, 4);
        const t = world().room(0, 0, 6, 0, 30).room(3, -1, 3, -6, 30); // a T: the bot where the stem meets the bar
        const tee = L.tunnelAt(t.get, { x: 3, y: 30, z: 0 }, { anchor: { x: 3, y: 30, z: 20 } });
        assert.deepEqual(tee.cause, { kind: 'open_sides', at: { x: 3, y: 30, z: 0 }, sides: 3 });
    });

    test('W2 check 2: the way ahead more than 2 wide, named at its first cell', () => {
        // a corridor 1 wide that runs into a hall 3 wide ahead of the bot
        const w = world().room(0, 0, 0, 5, 30).room(-1, 6, 1, 9, 30);
        const r = L.tunnelAt(w.get, { x: 0, y: 30, z: 2 }, { anchor: { x: 0, y: 30, z: -20 } });
        assert.deepEqual(r, { ok: false, cause: { kind: 'wide', at: { x: 0, y: 30, z: 6 }, width: 3 } });
    });

    test('W2 check 3: the ceiling above the head open', () => {
        const w = oneWide().air(2, 32, -5);
        const r = L.tunnelAt(w.get, { x: 2, y: 30, z: -5 }, { anchor: ROOM });
        assert.deepEqual(r, { ok: false, cause: { kind: 'ceiling', at: { x: 2, y: 32, z: -5 } } });
    });

    test('the order of the checks: open sides before the width before the ceiling', () => {
        // open on both sides and an open ceiling: open sides
        const a = world().room(0, 0, 2, 0, 30).room(1, -1, 1, -4, 30).air(1, 32, 0);
        assert.equal(L.tunnelAt(a.get, { x: 1, y: 30, z: 0 }, { anchor: { x: 1, y: 30, z: 10 } }).cause.kind, 'open_sides');
        // wide ahead and an open ceiling: wide
        const b = world().room(0, 0, 0, 5, 30).room(-1, 6, 1, 9, 30).air(0, 32, 2);
        assert.equal(L.tunnelAt(b.get, { x: 0, y: 30, z: 2 }, { anchor: { x: 0, y: 30, z: -20 } }).cause.kind, 'wide');
    });

    test('too short for minCells: short, with its length; a pocket of 1 cell: short 1', () => {
        const w = world().room(0, 0, 0, 2, 30); // 3 cells
        assert.deepEqual(L.tunnelAt(w.get, { x: 0, y: 30, z: 0 }, { minCells: 4 }).cause, { kind: 'short', at: { x: 0, y: 30, z: 0 }, length: 3 });
        assert.equal(L.tunnelAt(w.get, { x: 0, y: 30, z: 0 }, { minCells: 3 }).ok, true);
        const pocket = world().cell(5, 30, 5);
        assert.deepEqual(L.tunnelAt(pocket.get, { x: 5, y: 30, z: 5 }, { minCells: 4 }).cause, { kind: 'short', at: { x: 5, y: 30, z: 5 }, length: 1 });
    });

    test('never throws', () => {
        assert.equal(L.tunnelAt(null, { x: 0, y: 0, z: 0 }).ok, false);
        assert.equal(L.tunnelAt(oneWide().get, null).ok, false);
        assert.equal(L.tunnelAt(() => { throw new Error('x'); }, { x: 0, y: 0, z: 0 }).ok, false);
    });
});

describe('I3: addTunnel', () => {
    const mine = () => ({ name: 'mine', source: 'player', tunnels: [{ start: { x: 2, y: 30, z: -1 }, dir: 'north', end: { x: 2, y: 30, z: -6 }, level: 30, length: 6,
        branches: [{ at: 4, side: 'left', start: { x: 1, y: 30, z: -5 }, end: { x: 1, y: 30, z: -5 }, length: 0, done: false }] }] });

    test('a start within 2 of a known one replaces it, its branches kept for the same direction; pure', () => {
        const m = mine();
        const out = L.addTunnel(m, { start: { x: 2, y: 30, z: -2 }, dir: 'north', end: { x: 2, y: 30, z: -10 }, level: 30, length: 9, width: 1 });
        assert.equal(out.tunnels.length, 1);
        assert.deepEqual(out.tunnels[0].end, { x: 2, y: 30, z: -10 });
        assert.equal(out.tunnels[0].branches.length, 1);
        assert.equal('width' in out.tunnels[0], false, 'the width is said, not stored');
        assert.deepEqual(m.tunnels[0].end, { x: 2, y: 30, z: -6 }, 'the mine given is not changed');
    });

    test('a new start is a second tunnel', () => {
        const out = L.addTunnel(mine(), { start: { x: 9, y: 30, z: 0 }, dir: 'east', end: { x: 14, y: 30, z: 0 }, level: 30, length: 6 });
        assert.equal(out.tunnels.length, 2);
    });
});

describe('I4: tripStart with inMine and fromInside', () => {
    test('as in v0.1.4.10 without inMine', () => {
        assert.equal(L.tripStart({ mine: { level: 16 } }), 'use');
        assert.equal(L.tripStart({ mine: null, underground: true }), 'underground');
        assert.equal(L.tripStart({ mine: null, underground: true, fromInside: true }), 'underground');
        assert.equal(L.tripStart({ mine: null, newMine: true }), 'new');
        assert.equal(L.tripStart({ mine: null }), 'ask');
        assert.equal(L.tripStart(undefined), 'ask');
    });

    test('under the ground in a known mine: inside with the switch, in_mine without it; a known mine for the ore wins', () => {
        assert.equal(L.tripStart({ mine: null, underground: true, inMine: true, fromInside: true }), 'inside');
        assert.equal(L.tripStart({ mine: null, underground: true, inMine: true, fromInside: true, newMine: true }), 'inside');
        assert.equal(L.tripStart({ mine: null, underground: true, inMine: true, fromInside: false }), 'in_mine');
        assert.equal(L.tripStart({ mine: null, underground: true, inMine: true }), 'in_mine');
        assert.equal(L.tripStart({ mine: { level: 16 }, underground: true, inMine: true, fromInside: true }), 'use');
        assert.equal(L.tripStart({ mine: null, underground: false, inMine: true, fromInside: true, newMine: true }), 'new', 'on the surface as before');
    });
});

describe('I4: insideShaft, the face of a shaft from the floor of a known mine', () => {
    test('in the room: the ladders on a wall whose cell behind is open on solid ground; prefer first', () => {
        const w = oneWide();
        const r = L.insideShaft(w.get, { x: 2, y: 30, z: 2 }, 16, [], { prefer: 'north' });
        assert.deepEqual(r, { top: { x: 2, y: 30, z: 2 }, face: 'north', entry: { x: 2, y: 30, z: 3 }, moved: false, reason: null }); // F13: moved
        const e = L.insideShaft(w.get, { x: 2, y: 30, z: 2 }, 16, [], { prefer: 'east' });
        assert.deepEqual([e.face, e.entry], ['east', { x: 1, y: 30, z: 2 }]);
    });

    test('at the end of a tunnel: the only open cell is behind the bot, so the face is the tunnel direction', () => {
        const r = L.insideShaft(oneWide().get, { x: 2, y: 30, z: -10 }, 16, [], { prefer: 'south' });
        assert.deepEqual([r.face, r.entry], ['north', { x: 2, y: 30, z: -9 }]);
    });

    test('no direction keeps to the protected areas: area; no open cell beside: no_entry', () => {
        const area = [{ name: 'home', type: 'home', min: { x: -20, y: 0, z: -20 }, max: { x: 20, y: 40, z: 20 } }];
        assert.equal(L.insideShaft(oneWide().get, { x: 2, y: 30, z: 2 }, 16, area).reason, 'area');
        const pocket = world().cell(5, 30, 5);
        assert.equal(L.insideShaft(pocket.get, { x: 5, y: 30, z: 5 }, 16, []).reason, 'no_entry');
        assert.equal(L.insideShaft(null, { x: 5, y: 30, z: 5 }, 16, []).reason, 'no_entry');
    });
});

describe('F13 (W92): insideShaft never on the way of the parent', () => {
    // the room x 0..4, z 0..4 at y 30; the parent came down a ladder at (1, 1) whose foot is (1, 30, 1), its entry
    // above at (1, 40, 0); a door leg at the mouth of the tunnel (2, 30, -1)
    const parent = () => ({
        name: 'mine', source: 'player', room: { center: { x: 2, y: 30, z: 2 }, chest: { x: 0, y: 30, z: 4 }, table: { x: 4, y: 30, z: 4 }, furnace: null },
        route: [{ kind: 'ladder', x: 1, z: 1, top: 39, bottom: 30, face: 'south', entry: { x: 1, y: 40, z: 0 }, foot: { x: 1, y: 30, z: 2 } },
            { kind: 'door', kind2: 'door', name: 'oak_door', x: 2, y: 30, z: -1, from: { x: 2, y: 30, z: 0 }, to: { x: 2, y: 30, z: -2 } }],
    });

    test('wayCells and shaftCellFree: the ladder column, foot and entry within 1; the door and its two cells exactly', () => {
        const way = L.wayCells(parent());
        assert.equal(L.shaftCellFree({ x: 1, y: 30, z: 1 }, way), false, 'under the ladder');
        assert.equal(L.shaftCellFree({ x: 2, y: 30, z: 2 }, way), false, 'beside the column');
        assert.equal(L.shaftCellFree({ x: 2, y: 30, z: 3 }, way), false, 'beside the foot');
        assert.equal(L.shaftCellFree({ x: 2, y: 30, z: 0 }, way), false, 'the cell before the door');
        assert.equal(L.shaftCellFree({ x: 3, y: 30, z: 0 }, way), true);
        assert.equal(L.shaftCellFree({ x: 3, y: 30, z: 3 }, way), true);
        assert.equal(L.shaftCellFree({ x: 1, y: 30, z: 1 }, L.wayCells(null)), true, 'no route');
    });

    test('the bot at the foot of the ladder: the nearest free floor cell of the room, moved', () => {
        const w = oneWide();
        const r = L.insideShaft(w.get, { x: 1, y: 30, z: 1 }, 16, [], { mine: parent() });
        assert.equal(r.moved, true);
        assert.equal(r.reason, null);
        assert.equal(L.shaftCellFree(r.top, L.wayCells(parent())), true, JSON.stringify(r.top));
        assert.deepEqual(r.top, { x: 3, y: 30, z: 2 }, 'the nearest free cell of the room box (x 0..4, z 2..4)');
        const stay = L.insideShaft(w.get, { x: 3, y: 30, z: 3 }, 16, [], { mine: parent() });
        assert.deepEqual([stay.top, stay.moved], [{ x: 3, y: 30, z: 3 }, false], 'a free cell stays');
    });

    test('no free floor cell: no_cell; without a parent the feet as before', () => {
        // a pocket of 3 cells under the ladder, no room
        const w = world().room(0, 0, 0, 2, 30);
        const p = { name: 'm', route: [{ kind: 'ladder', x: 0, z: 1, top: 39, bottom: 30, face: 'south', entry: { x: 0, y: 40, z: 0 } }] };
        assert.equal(L.insideShaft(w.get, { x: 0, y: 30, z: 1 }, 16, [], { mine: p }).reason, 'no_cell');
        assert.equal(L.insideShaft(w.get, { x: 0, y: 30, z: 1 }, 16, []).moved, false);
    });
});
