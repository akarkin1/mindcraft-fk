// Spec v0.1.4.9 part B (engineer E2): the pure functions of the mine of the player in
// src/agent/packs/mining/mine_logic.js and the ranges of the ore table (I6, B3, B4, B5, B6, B7, B8).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const L = await loadSrc('src/agent/packs/mining/mine_logic.js');
const T = await loadSrc('src/agent/packs/mining/ore_table.js');

// A world of names: every block is `fill` unless set.
function world(fill = 'stone') {
    const m = new Map();
    const w = {
        set(x, y, z, name) {
            m.set(`${x},${y},${z}`, name);
            return w;
        },
        fill(x1, y1, z1, x2, y2, z2, name) {
            for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
                for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
                    for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) {
                        w.set(x, y, z, name);
                    }
                }
            }
            return w;
        },
        get: (x, y, z) => (m.has(`${x},${y},${z}`) ? m.get(`${x},${y},${z}`) : fill),
    };
    return w;
}

// The mine of the base world of the tests: a landing x 21..23, z -1..1 at y 25 (3 high) and a tunnel
// x 22, z 2..13 at y 25 (2 high).
function baseMine() {
    return world().fill(21, 25, -1, 23, 27, 1, 'air').fill(22, 25, 2, 22, 26, 13, 'air');
}

const PLAYER_MINE = {
    name: 'mine', source: 'player', ore: 'iron', entrance: { x: 0, y: 64, z: -3 }, level: 34, dimension: 'overworld',
    route: [
        { kind: 'walk', from: { x: 0, y: 64, z: -3 }, to: { x: 0, y: 64, z: -1 } },
        { kind: 'door', kind2: 'trapdoor', name: 'oak_trapdoor', x: 0, y: 63, z: 0, from: { x: 0, y: 64, z: -1 }, to: { x: 0, y: 62, z: 0 } },
        { kind: 'ladder', x: 0, z: 0, top: 62, bottom: 50, face: 'south', entry: { x: 0, y: 64, z: -1 } },
        { kind: 'walk', from: { x: 0, y: 50, z: 0 }, to: { x: 2, y: 50, z: 0 } },
    ],
    room: { center: { x: 1, y: 50, z: 0 }, chest: { x: -2, y: 50, z: 2 }, table: { x: 2, y: 50, z: 2 }, furnace: null },
    tunnels: [{ start: { x: 21, y: 34, z: 2 }, dir: 'south', end: { x: 21, y: 34, z: 13 }, level: 34, length: 12, branches: [] }],
    passed: [],
};

// A mine of v0.1.4.7: a shaft at (0, 64, 0), base at level 16, a tunnel to the north.
const BOT_MINE = {
    ore: 'iron', entrance: { x: 100, y: 64, z: 0 }, level: 16, base: { x: 100, y: 16, z: 0 }, chest: { x: 99, y: 16, z: 0 }, direction: 'north',
    length: 10, shaft: 'ladder', dimension: 'overworld', end: { x: 100, y: 16, z: -12 }, tunnel: [{ x: 100, y: 16, z: -2 }, { x: 100, y: 16, z: -12 }],
    route: [{ kind: 'ladder', x: 100, z: 0, top: 63, bottom: 16, face: 'north', entry: { x: 100, y: 64, z: 1 } }],
};

describe('the ranges of the ores (B4)', () => {
    test('min and max of every row, the old fields unchanged', () => {
        const ranges = Object.fromEntries(T.ORES.map(r => [r.ore, [r.min, r.max]]));
        assert.deepEqual(ranges, {
            coal: [0, 192], copper: [-16, 112], iron: [-64, 72], lapis: [-64, 64], gold: [-64, 32], redstone: [-64, 15], diamond: [-64, 16],
        });
        assert.equal(T.oreOf('iron').level, 16);
        assert.equal(T.oreOf('iron').pickaxe, 'stone');
    });
});

describe('legCells (I2, B8)', () => {
    test('the four kinds of legs', () => {
        const ladder = L.legCells({ kind: 'ladder', x: 0, z: 0, top: 3, bottom: 1, face: 'south', entry: { x: 0, y: 5, z: -1 } });
        assert.deepEqual(ladder, [{ x: 0, y: 1, z: 0 }, { x: 0, y: 2, z: 0 }, { x: 0, y: 3, z: 0 }, { x: 0, y: 5, z: -1 }]);
        assert.deepEqual(L.legCells({ kind: 'walk', from: { x: 0, y: 5, z: 0 }, to: { x: 3, y: 5, z: 0 } }).map(p => p.x), [0, 1, 2, 3]);
        assert.deepEqual(L.legCells({ kind: 'stairs', from: { x: 0, y: 5, z: 0 }, to: { x: 0, y: 3, z: -2 }, dir: 'north' }),
            [{ x: 0, y: 5, z: 0 }, { x: 0, y: 4, z: -1 }, { x: 0, y: 3, z: -2 }]);
        assert.deepEqual(L.legCells({ kind: 'door', kind2: 'door', name: 'oak_door', x: 0, y: 5, z: 0, from: { x: 0, y: 5, z: -1 }, to: { x: 0, y: 5, z: 1 } }),
            [{ x: 0, y: 5, z: -1 }, { x: 0, y: 5, z: 0 }, { x: 0, y: 5, z: 1 }]);
        assert.deepEqual(L.legCells(null), []);
        assert.deepEqual(L.legCells({ kind: 'rope' }), []);
        assert.ok(L.legCells({ kind: 'walk', from: { x: 0, y: 0, z: 0 }, to: { x: -3, y: 0, z: -1 } }).every(p => !Object.is(p.x, -0) && !Object.is(p.z, -0)), 'no -0');
    });

    test('legEnd: a ladder ends at its bottom, the others at `to`', () => {
        assert.deepEqual(L.legEnd(PLAYER_MINE.route[2]), { x: 0, y: 50, z: 0 });
        assert.deepEqual(L.legEnd(PLAYER_MINE.route[1]), { x: 0, y: 62, z: 0 });
        assert.equal(L.legEnd({}), null);
    });
});

describe('tunnelsOf (B1)', () => {
    test('a mine of the bot shows its tunnel of v0.1.4.7 in one shape', () => {
        const [t] = L.tunnelsOf(BOT_MINE);
        assert.deepEqual({ ...t, corners: undefined }, {
            start: { x: 100, y: 16, z: -2 }, dir: 'north', end: { x: 100, y: 16, z: -12 }, level: 16, length: 10, branches: [], corners: undefined,
        });
        assert.equal(L.tunnelsOf(BOT_MINE).length, 1);
        assert.deepEqual(L.tunnelsOf({ ...BOT_MINE, direction: null }), [], 'no direction: no tunnel');
        assert.deepEqual(L.tunnelsOf({ ...BOT_MINE, end: null }), []);
    });

    test('the branches of the tunnel of the bot are those of tunnels[0]; a player mine has its tunnels', () => {
        const branch = { at: 4, side: 'left', start: { x: 99, y: 16, z: -6 }, end: { x: 99, y: 16, z: -6 }, length: 1, done: false };
        const stale = { start: { x: 100, y: 16, z: -2 }, dir: 'north', end: { x: 100, y: 16, z: -5 }, level: 16, length: 3, branches: [branch] };
        const [t] = L.tunnelsOf({ ...BOT_MINE, tunnels: [stale] });
        assert.deepEqual(t.end, { x: 100, y: 16, z: -12 }, 'the fields of v0.1.4.7 win');
        assert.deepEqual(t.branches, [branch]);
        assert.deepEqual(L.tunnelsOf(PLAYER_MINE), PLAYER_MINE.tunnels);
        assert.deepEqual(L.tunnelsOf({ source: 'player', tunnels: [{ start: null }] }), []);
        assert.deepEqual(L.tunnelsOf(null), []);
    });
});

describe('mineAt (I6, B8)', () => {
    test('a tunnel, the room, the route; nothing elsewhere', () => {
        assert.deepEqual(L.mineAt([PLAYER_MINE], { x: 21.5, y: 34, z: 7.5 }), { mine: PLAYER_MINE, tunnel: 0, onRoute: false });
        assert.deepEqual(L.mineAt([PLAYER_MINE], { x: 22.5, y: 35, z: 13.2 }), { mine: PLAYER_MINE, tunnel: 0, onRoute: false }, 'within 1 block');
        assert.deepEqual(L.mineAt([PLAYER_MINE], { x: 0.5, y: 51, z: 1.5 }), { mine: PLAYER_MINE, tunnel: null, onRoute: false }, 'the room');
        assert.deepEqual(L.mineAt([PLAYER_MINE], { x: 0.5, y: 57, z: 0.5 }), { mine: PLAYER_MINE, tunnel: null, onRoute: true }, 'the ladder');
        assert.deepEqual(L.mineAt([PLAYER_MINE], { x: 0.5, y: 63, z: 0.5 }), { mine: PLAYER_MINE, tunnel: null, onRoute: true }, 'the trapdoor');
        assert.equal(L.mineAt([PLAYER_MINE], { x: 21.5, y: 34, z: 16 }), null, '2 blocks beyond the end');
        assert.equal(L.mineAt([PLAYER_MINE], { x: 40, y: 64, z: 40 }), null);
        assert.equal(L.mineAt([PLAYER_MINE], null), null);
        assert.equal(L.mineAt(null, { x: 0, y: 0, z: 0 }), null);
    });

    test('a branch counts for its tunnel; the tunnel and room of a mine of the bot', () => {
        const mine = { ...PLAYER_MINE, tunnels: [{ ...PLAYER_MINE.tunnels[0], branches: [{ at: 4, side: 'left', start: { x: 22, y: 34, z: 6 }, end: { x: 29, y: 34, z: 6 }, length: 8, done: true }] }] };
        assert.equal(L.mineAt([mine], { x: 28, y: 34, z: 6 })?.tunnel, 0);
        assert.equal(L.mineAt([BOT_MINE], { x: 100, y: 16, z: -8 })?.tunnel, 0);
        assert.deepEqual(L.mineAt([BOT_MINE], { x: 99, y: 18, z: 0 }), { mine: BOT_MINE, tunnel: null, onRoute: false }, 'the room of roomPlan wins over the shaft beside it');
        assert.equal(L.mineAt([BOT_MINE], { x: 100, y: 40, z: 0 })?.onRoute, true, 'the shaft');
    });

    test('a tunnel of any mine wins over a room and a route', () => {
        const other = { ...PLAYER_MINE, name: 'other', tunnels: [], room: { center: { x: 21, y: 34, z: 7 }, chest: null, table: null, furnace: null } };
        assert.equal(L.mineAt([other, PLAYER_MINE], { x: 21, y: 34, z: 7 }).mine.name, 'mine');
    });
});

describe('mineDistance and nearestLeg', () => {
    test('by the entrance and every cell of the route, the room and the tunnels', () => {
        assert.equal(L.mineDistance(PLAYER_MINE, { x: 0, y: 64, z: -3 }), 0);
        assert.equal(L.mineDistance(PLAYER_MINE, { x: 21, y: 34, z: 20 }), 7, 'from the end of the tunnel');
        assert.equal(L.mineDistance(PLAYER_MINE, { x: 5, y: 50, z: 0 }), 3, 'from the room box');
        assert.equal(L.mineDistance(null, { x: 0, y: 0, z: 0 }), Infinity);
        assert.equal(L.nearestLeg(PLAYER_MINE.route, { x: 0, y: 55, z: 0 }), 2);
        assert.equal(L.nearestLeg(PLAYER_MINE.route, { x: 2, y: 50, z: 0 }), 3);
        assert.equal(L.nearestLeg([], { x: 0, y: 0, z: 0 }), -1);
    });
});

describe('tunnelFor (I6, B4)', () => {
    test('the tunnel in the range of the ore, nearest to its best level', () => {
        const mine = {
            ...PLAYER_MINE,
            tunnels: [{ ...PLAYER_MINE.tunnels[0], level: 60 }, { ...PLAYER_MINE.tunnels[0], level: 25 }, { ...PLAYER_MINE.tunnels[0], level: -10 }],
        };
        assert.equal(L.tunnelFor(mine, 'iron'), 1, '25 is nearest to 16');
        assert.equal(L.tunnelFor(mine, 'coal'), 0, 'coal: 0..192, best 96');
        assert.equal(L.tunnelFor(mine, 'diamond'), 2, 'only -10 is in -64..16');
        assert.equal(L.tunnelFor(mine, 'raw_gold'), 2, 'gold -64..32 best -16: -10');
        assert.equal(L.tunnelFor(PLAYER_MINE, 'diamond'), null, 'level 34 is above 16');
        assert.equal(L.tunnelFor(PLAYER_MINE, 'redstone'), null);
        assert.equal(L.tunnelFor(PLAYER_MINE, 'mithril'), null);
        assert.equal(L.tunnelFor({ ...PLAYER_MINE, tunnels: [] }, 'iron'), null);
        assert.equal(L.tunnelFor(BOT_MINE, 'iron'), 0);
    });
});

describe('branchPlan (B5)', () => {
    const tunnel = (length, branches = []) => ({ start: { x: 0, y: 10, z: 0 }, dir: 'north', end: { x: 0, y: 10, z: -length + 1 }, level: 10, length, branches });

    test('none below 32; at 4 first left, then right', () => {
        assert.equal(L.branchPlan(tunnel(31)), null);
        assert.equal(L.branchPlan(null), null);
        const first = L.branchPlan(tunnel(32));
        assert.deepEqual(first, {
            at: 4, side: 'left', dir: 'west', junction: { x: 0, y: 10, z: -4 }, start: { x: -1, y: 10, z: -4 }, end: { x: 0, y: 10, z: -4 },
            length: 0, done: false, index: null,
        });
        const done = (at, side) => ({ at, side, start: { x: 0, y: 10, z: -at }, end: { x: 0, y: 10, z: -at }, length: 8, done: true });
        const second = L.branchPlan(tunnel(32, [done(4, 'left')]));
        assert.deepEqual([second.at, second.side, second.dir], [4, 'right', 'east']);
        const third = L.branchPlan(tunnel(32, [done(4, 'left'), done(4, 'right')]));
        assert.deepEqual([third.at, third.side], [8, 'left']);
    });

    test('a branch dug half goes on from its end; all branches of the length done: null', () => {
        const half = { at: 4, side: 'left', start: { x: -1, y: 10, z: -4 }, end: { x: -3, y: 10, z: -4 }, length: 3, done: false };
        const plan = L.branchPlan(tunnel(32, [half]));
        assert.deepEqual([plan.index, plan.length, plan.end], [0, 3, { x: -3, y: 10, z: -4 }]);
        const all = [];
        for (let at = 4; at < 32; at += 4) {
            for (const side of ['left', 'right']) {
                all.push({ at, side, start: { x: 0, y: 10, z: -at }, end: { x: 0, y: 10, z: -at }, length: 8, done: true });
            }
        }
        assert.equal(all.length, 14, 'at 4 to 28');
        assert.equal(L.branchPlan(tunnel(32, all)), null, 'the main tunnel goes on');
        assert.deepEqual(L.branchPlan(tunnel(33, all)).at, 32, 'a longer tunnel has a new junction');
    });
});

describe('corridorDirections, measureTunnel, tunnelDirection, isCorridor (B3)', () => {
    test('at the end of the tunnel of the base: one corridor back to the landing', () => {
        const w = baseMine();
        assert.deepEqual(L.corridorDirections(w.get, { x: 22, y: 25, z: 13 }), [{ dir: 'north', length: 14 }]);
        assert.deepEqual(L.corridorDirections(w.get, { x: 22, y: 25, z: 7 }), [{ dir: 'north', length: 8 }, { dir: 'south', length: 6 }]);
        assert.deepEqual(L.corridorDirections(w.get, { x: 0, y: 0, z: 0 }), [], 'in the rock');
    });

    test('measured to the south from the end: start before the landing, end, 12 blocks, level 25', () => {
        const w = baseMine();
        for (const feet of [{ x: 22, y: 25, z: 13 }, { x: 22, y: 25, z: 7 }, { x: 22, y: 25, z: 2 }]) {
            assert.deepEqual(L.measureTunnel(w.get, feet, 'south'),
                { start: { x: 22, y: 25, z: 2 }, end: { x: 22, y: 25, z: 13 }, length: 12, level: 25, dir: 'south' }, JSON.stringify(feet));
        }
        const back = L.measureTunnel(w.get, { x: 22, y: 25, z: 13 }, 'north');
        assert.deepEqual([back.start, back.end], [{ x: 22, y: 25, z: 13 }, { x: 22, y: 25, z: -1 }], 'the end is the last open cell before rock');
        assert.equal(L.measureTunnel(w.get, { x: 0, y: 0, z: 0 }, 'north'), null, 'feet in rock');
        assert.equal(L.measureTunnel(w.get, { x: 22, y: 25, z: 7 }, 'up'), null);
        assert.equal(L.isCorridor(w.get, L.measureTunnel(w.get, { x: 22, y: 25, z: 7 }, 'south')), true);
        assert.equal(L.isCorridor(w.get, { start: { x: 21, y: 25, z: 0 }, end: { x: 23, y: 25, z: 0 } }), false, 'the landing is a room');
    });

    test('tunnelDirection: the yaw of the player, else away from the room, else the longest', () => {
        const dirs = [{ dir: 'north', length: 14 }];
        const feet = { x: 22, y: 25, z: 13 };
        assert.equal(L.tunnelDirection(dirs, feet, { yaw: Math.PI }), 'south', 'the player looks south (yaw pi)');
        assert.equal(L.tunnelDirection(dirs, feet, { yaw: 0 }), 'north');
        assert.equal(L.tunnelDirection(dirs, feet, { yaw: Math.PI / 2, anchor: { x: 2, y: 41, z: 0 } }), 'south', 'yaw across the tunnel: the room decides');
        assert.equal(L.tunnelDirection(dirs, feet, { anchor: { x: 2, y: 41, z: 0 } }), 'south', 'away from the room');
        assert.equal(L.tunnelDirection(dirs, feet, {}), 'north', 'the longest');
        assert.equal(L.tunnelDirection([], feet, { yaw: 0 }), null);
    });

    test('F6: a yaw towards the anchor is ignored, the tunnel points away from it; without an anchor the yaw decides', () => {
        const room = { x: 2, y: 41, z: 0 };
        const end = { x: 22, y: 25, z: 13 };
        assert.equal(L.tunnelDirection([{ dir: 'north', length: 14 }], end, { yaw: 0, anchor: room }), 'south', 'yaw 0 (north) looks back to the room');
        assert.equal(L.tunnelDirection([{ dir: 'north', length: 14 }], end, { yaw: 0 }), 'north', 'no anchor: the yaw rule stays');
        const middle = { x: 22, y: 25, z: 7 };
        const both = [{ dir: 'north', length: 8 }, { dir: 'south', length: 6 }];
        assert.equal(L.tunnelDirection(both, middle, { yaw: Math.PI, anchor: room }), 'south', 'a yaw away from the room is kept');
        assert.equal(L.tunnelDirection(both, middle, { yaw: 0, anchor: room }), 'south', 'towards the room: ignored, away from it');
        const behind = { x: 22, y: 41, z: 30 }; // an entrance south of the bot
        assert.equal(L.tunnelDirection(both, middle, { yaw: 0, anchor: behind }), 'north', 'the yaw points away from this anchor');
        assert.equal(L.tunnelDirection(both, middle, { yaw: Math.PI, anchor: behind }), 'north', 'towards this anchor: ignored');
        assert.equal(L.tunnelDirection(both, middle, { yaw: Math.PI, anchor: { x: 40, y: 25, z: 7 } }), 'south', 'an anchor across the tunnel: the yaw decides');
    });
});

describe('veinParts (B6)', () => {
    test('take is veinOrder; lava and beyond the limit are the rest', () => {
        const w = world();
        for (let x = 0; x < 15; x++) {
            w.set(x, 0, 0, 'coal_ore');
        }
        w.set(20, 0, 0, 'coal_ore').set(21, 0, 0, 'coal_ore').set(20, 1, 0, 'lava');
        const parts = L.veinParts({ x: 0, y: 0, z: 0 }, w.get);
        assert.equal(parts.take.length, 12);
        assert.deepEqual(parts.beyond.map(p => p.x), [12, 13, 14]);
        assert.deepEqual(parts.lava, []);
        assert.deepEqual(L.veinOrder({ x: 0, y: 0, z: 0 }, w.get), parts.take);
        const lava = L.veinParts({ x: 21, y: 0, z: 0 }, w.get);
        assert.deepEqual(lava.take.map(p => p.x), [21]);
        assert.deepEqual(lava.lava.map(p => p.x), [20]);
        assert.deepEqual(L.veinParts({ x: 50, y: 0, z: 0 }, w.get), { take: [], lava: [], beyond: [] });
    });
});

describe('the ore list (B6)', () => {
    test('an entry: the ore of the table, a cell, a reason', () => {
        assert.deepEqual(L.cleanPassedEntry({ ore: 'deepslate_gold_ore', x: 1.5, y: 2, z: -3.2, reason: 'pickaxe', seen: 'T' }),
            { ore: 'gold', x: 1, y: 2, z: -4, reason: 'pickaxe', seen: 'T' });
        assert.equal(L.cleanPassedEntry({ ore: 'gold', x: 1, y: 2, z: 3, reason: 'lazy' }), null);
        assert.equal(L.cleanPassedEntry({ ore: 'stone', x: 1, y: 2, z: 3, reason: 'lava' }), null);
        assert.deepEqual([...L.PASSED_REASONS], ['pickaxe', 'lava', 'inventory', 'vein', 'stopped']);
    });

    test('added: the same cell replaced, at most 200, the oldest leave; removed by cell', () => {
        let list = [];
        for (let i = 0; i < 205; i++) {
            list = L.addPassedEntry(list, { ore: 'coal', x: i, y: 0, z: 0, reason: 'inventory' });
        }
        assert.equal(list.length, 200);
        assert.equal(list[0].x, 5, 'the oldest left');
        list = L.addPassedEntry(list, { ore: 'coal', x: 10, y: 0, z: 0, reason: 'stopped' });
        assert.equal(list.length, 200);
        assert.deepEqual(list[list.length - 1], { ore: 'coal', x: 10, y: 0, z: 0, reason: 'stopped', seen: null });
        list = L.removePassedAt(list, { x: 10.7, y: 0.2, z: 0.1 });
        assert.equal(list.length, 199);
        assert.equal(list.some(e => e.x === 10), false);
        assert.deepEqual(L.addPassedEntry(null, { ore: 'x' }), []);
    });
});

describe('the sense range (B7)', () => {
    test('tunnelView: no field `sensed` with 0; ore 2 and 3 blocks in the walls, ceiling and floor with 3', () => {
        const feet = { x: 0, y: 16, z: 0 };
        const w = world().set(-2, 16, -1, 'iron_ore').set(3, 17, -1, 'coal_ore').set(0, 19, -1, 'iron_ore').set(0, 14, -1, 'gold_ore')
            .set(-4, 16, -1, 'iron_ore').set(-1, 16, -1, 'iron_ore');
        assert.equal('sensed' in L.tunnelView(w.get, feet, 'north', 1), false);
        assert.equal('sensed' in L.tunnelView(w.get, feet, 'north', 1, 0), false);
        const sensed = L.tunnelView(w.get, feet, 'north', 1, 3).sensed;
        const key = s => `${s.side}:${s.depth}:${s.up}`;
        assert.deepEqual(sensed.map(key).sort(), ['above:2:1', 'below:2:0', 'left:2:0', 'right:3:1'], 'depth 1 is tunnelStep, depth 4 is too far');
        assert.deepEqual(L.senseOres(w.get, feet, 'north', 2).map(key).sort(), ['above:2:1', 'below:2:0', 'left:2:0']);
    });

    test('senseCut: 1 wide and 2 high to a wall, up to the ceiling, down from the cell behind', () => {
        const feet = { x: 0, y: 16, z: -1 };
        assert.deepEqual(L.senseCut(feet, 'north', { side: 'left', depth: 3, up: 0 }),
            { cells: [{ x: -1, y: 17, z: -1 }, { x: -1, y: 16, z: -1 }, { x: -2, y: 17, z: -1 }, { x: -2, y: 16, z: -1 }], stand: null, refill: [] });
        assert.deepEqual(L.senseCut(feet, 'north', { side: 'above', depth: 2, up: 1 }), { cells: [{ x: 0, y: 18, z: -1 }], stand: null, refill: [] });
        assert.deepEqual(L.senseCut(feet, 'north', { side: 'below', depth: 3, up: 0 }),
            { cells: [{ x: 0, y: 15, z: -1 }, { x: 0, y: 14, z: -1 }], stand: { x: 0, y: 16, z: 0 }, refill: [{ x: 0, y: 15, z: -1 }] });
        assert.deepEqual(L.senseCut(null, 'north', { side: 'left', depth: 2 }), { cells: [], stand: null, refill: [] });
    });
});
