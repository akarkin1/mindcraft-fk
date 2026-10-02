// T1, spec v0.1.4.9 I6 and B1: the mine record in mines.json (MineStore of src/agent/packs/mining/mine_store.js).
// New fields name, source, room, tunnels, passed (at most 200, the oldest leave); a mine of v0.1.4.7 loads unchanged
// with name null, source 'bot', room null, tunnels [], passed []; a mine of the bot with direction, end and length
// shows one tunnel when read (tunnelsOf); the key is the name when the mine has one, else the level (mineKey); new
// on MineStore: byName, nearest(pos, dimension, range = 64) by the entrance and every cell of the route, the room
// and the tunnels, addPassed, removePassed; get(ore, dimension) stays as it is for the mines of the bot. The reasons
// of the ore list (B6): pickaxe, lava, inventory, vein, stopped.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';

const S = await loadSrc('src/agent/packs/mining/mine_store.js');
const L = await loadSrc('src/agent/packs/mining/mine_logic.js');

const NOW = () => new Date('2026-09-30T10:00:00Z');

// a mine of v0.1.4.7 as the bot dug it: shaft of ladders, room, tunnel north of 8
const BOT_MINE = () => ({
    ore: 'iron', entrance: { x: 9, y: 67, z: 58 }, level: 16, base: { x: 9, y: 16, z: 58 }, chest: { x: 10, y: 16, z: 59 }, direction: 'north', length: 8,
    shaft: 'ladder', created: '2026-09-01T10:00:00.000Z', updated: '2026-09-01T11:00:00.000Z', dimension: 'overworld', ores: ['iron'],
    end: { x: 9, y: 16, z: 48 }, tunnel: [{ x: 9, y: 16, z: 55 }, { x: 9, y: 16, z: 48 }],
    route: [{ kind: 'ladder', x: 9, z: 58, top: 66, bottom: 16, face: 'south', entry: { x: 9, y: 67, z: 57 } }],
});
// the mine of the player (B2)
const PLAYER_MINE = () => ({
    name: 'mine', source: 'player', ore: 'iron', entrance: { x: 30, y: 60, z: 4 }, level: 41, dimension: 'overworld',
    route: [
        { kind: 'door', kind2: 'trapdoor', name: 'oak_trapdoor', x: 30, y: 60, z: 2, from: { x: 30, y: 61, z: 3 }, to: { x: 30, y: 59, z: 2 } },
        { kind: 'ladder', x: 30, z: 2, top: 59, bottom: 41, face: 'south', entry: { x: 30, y: 61, z: 3 } },
        { kind: 'walk', from: { x: 30, y: 41, z: 2 }, to: { x: 30, y: 41, z: 6 } },
    ],
    room: { center: { x: 30, y: 41, z: 6 }, chest: { x: 31, y: 41, z: 7 }, table: { x: 29, y: 41, z: 7 }, furnace: null },
    tunnels: [{ start: { x: 22, y: 25, z: 2 }, dir: 'north', end: { x: 22, y: 25, z: -9 }, level: 25, length: 12,
        branches: [{ at: 4, side: 'left', start: { x: 21, y: 25, z: -2 }, end: { x: 14, y: 25, z: -2 }, length: 8, done: true }] }],
    passed: [],
});
const entry = (i, reason = 'pickaxe', ore = 'gold_ore') => ({ ore, x: 22, y: 25, z: -i, reason, seen: '2026-09-30T10:00:00.000Z' });

let dir;
before(() => {
    dir = makeTmpDir();
});
after(() => removeTmpDir(dir));

describe('B1: the fields of a mine', () => {
    test('a mine of the player keeps name, source, room, tunnels (with branches), route with a door leg, passed', () => {
        const store = new S.MineStore(null, { now: NOW });
        store.set({ ...PLAYER_MINE(), passed: [entry(1)] });
        const m = store.byName('mine', 'overworld');
        assert.ok(m, 'byName');
        const want = PLAYER_MINE();
        assert.equal(m.name, 'mine');
        assert.equal(m.source, 'player');
        assert.deepEqual(m.room, want.room);
        assert.equal(m.tunnels.length, 1);
        for (const k of ['start', 'dir', 'end', 'level', 'length']) assert.deepEqual(m.tunnels[0][k], want.tunnels[0][k], k);
        assert.equal(m.tunnels[0].branches.length, 1);
        for (const k of ['at', 'side', 'start', 'end', 'length', 'done']) assert.deepEqual(m.tunnels[0].branches[0][k], want.tunnels[0].branches[0][k], `branch ${k}`);
        assert.deepEqual(m.route.map((l) => l.kind), ['door', 'ladder', 'walk']);
        assert.deepEqual({ ...m.route[0] }, want.route[0]);
        assert.equal(m.passed.length, 1);
        for (const k of ['x', 'y', 'z', 'reason']) assert.equal(m.passed[0][k], entry(1)[k], `passed ${k}`);
        assert.ok(['gold', 'gold_ore'].includes(m.passed[0].ore), m.passed[0].ore);
    });

    test('a mine of v0.1.4.7 from the file loads unchanged, with name null, source bot, room null, passed []', () => {
        const file = path.join(dir, 'old.json');
        fs.writeFileSync(file, JSON.stringify({ version: 1, mines: { 16: BOT_MINE() } }));
        const store = new S.MineStore(file, { now: NOW });
        store.load();
        const m = store.get('iron', 'overworld');
        assert.ok(m, 'get(ore) finds the mine of the bot');
        const old = BOT_MINE();
        for (const k of ['ore', 'entrance', 'level', 'base', 'chest', 'direction', 'length', 'shaft', 'created', 'end', 'route']) assert.deepEqual(m[k], old[k], k);
        assert.equal(m.name, null);
        assert.equal(m.source, 'bot');
        assert.equal(m.room, null);
        assert.deepEqual(m.passed, []);
        assert.ok(Array.isArray(m.tunnels));
    });

    test('a mine of the bot with direction, end and length shows one tunnel when read (tunnelsOf); mineAt finds it', () => {
        const store = new S.MineStore(null, { now: NOW });
        store.set(BOT_MINE());
        const m = store.get('iron', 'overworld');
        const tunnels = L.tunnelsOf(m);
        assert.equal(tunnels.length, 1, JSON.stringify(tunnels));
        assert.deepEqual({ ...tunnels[0].start }, { x: 9, y: 16, z: 55 }, 'the tunnel starts at its first corner, by the room');
        assert.equal(tunnels[0].dir, 'north');
        assert.deepEqual({ ...tunnels[0].end }, { x: 9, y: 16, z: 48 });
        assert.equal(tunnels[0].level, 16);
        assert.equal(tunnels[0].length, 8);
        assert.equal(L.mineAt(store.list('overworld'), { x: 9, y: 16, z: 50 })?.tunnel, 0);
    });

    test('a mine of v0.1.4.7 without a tunnel: tunnels []', () => {
        const store = new S.MineStore(null, { now: NOW });
        const { direction, end, ...rest } = BOT_MINE();
        void direction;
        void end;
        store.set({ ...rest, length: 0 });
        assert.deepEqual(L.tunnelsOf(store.get('iron', 'overworld')), []);
    });
});

describe('I6: the key, byName, get', () => {
    test('the key: the name when the mine has one, else the level', () => {
        const file = path.join(dir, 'keys.json');
        const store = new S.MineStore(file, { now: NOW });
        store.set(BOT_MINE());
        store.set(PLAYER_MINE());
        const json = JSON.parse(fs.readFileSync(file, 'utf8'));
        // v0.1.4.10 (R4): a mine of the bot is keyed bot:<level>
        assert.deepEqual(Object.keys(json.mines).sort(), ['bot:16', 'mine']);
        assert.equal(S.mineKey(PLAYER_MINE()), 'mine');
        assert.equal(S.mineKey(BOT_MINE()), 'bot:16');
    });

    test('byName: the mine of that name in that dimension; null for another name', () => {
        const store = new S.MineStore(null, { now: NOW });
        store.set(PLAYER_MINE());
        assert.equal(store.byName('mine', 'overworld')?.name, 'mine');
        assert.equal(store.byName('deep', 'overworld') ?? null, null);
        assert.equal(store.byName('mine', 'the_nether') ?? null, null);
    });

    test('get(ore) stays for the mines of the bot: a mine of the player is not given for its ore', () => {
        const store = new S.MineStore(null, { now: NOW });
        store.set(PLAYER_MINE());
        assert.equal(store.get('iron', 'overworld') ?? null, null);
        store.set(BOT_MINE());
        assert.equal(store.get('iron', 'overworld')?.level, 16);
    });

    test('the file: read back by a new store with every field', () => {
        const file = path.join(dir, 'back.json');
        const a = new S.MineStore(file, { now: NOW });
        a.set(PLAYER_MINE());
        const b = new S.MineStore(file, { now: NOW });
        b.load();
        const m = b.byName('mine', 'overworld');
        assert.deepEqual(m.room, PLAYER_MINE().room);
        assert.equal(m.tunnels[0].length, 12);
        assert.equal(m.source, 'player');
    });
});

describe('I6: nearest(pos, dimension, range = 64)', () => {
    const store = () => {
        const s = new S.MineStore(null, { now: NOW });
        s.set(PLAYER_MINE());
        return s;
    };

    test('by the entrance', () => {
        assert.equal(store().nearest({ x: 30, y: 60, z: 40 }, 'overworld')?.name, 'mine');
    });

    test('by a cell of the tunnel: far from the entrance, near the end of the tunnel', () => {
        // (22, 25, -60): 51 from the end of the tunnel, 72 from the entrance
        assert.equal(store().nearest({ x: 22, y: 25, z: -60 }, 'overworld')?.name, 'mine');
    });

    test('by a cell of the route and of the room', () => {
        assert.equal(store().nearest({ x: 30, y: 45, z: 60 }, 'overworld')?.name, 'mine', 'the ladder at (30, 45, 2) is 58 away');
        assert.equal(store().nearest({ x: 31, y: 41, z: 70 }, 'overworld')?.name, 'mine', 'the chest at (31, 41, 7) is 63 away');
    });

    test('beyond 64 of every cell: null; with a larger range: the mine', () => {
        const far = { x: 120, y: 60, z: 4 };
        assert.equal(store().nearest(far, 'overworld') ?? null, null);
        assert.equal(store().nearest(far, 'overworld', 100)?.name, 'mine');
    });

    test('another dimension: null', () => {
        assert.equal(store().nearest({ x: 30, y: 60, z: 4 }, 'the_nether') ?? null, null);
    });

    test('two mines: the nearer one', () => {
        const s = store();
        s.set({ ...PLAYER_MINE(), name: 'deep', entrance: { x: -30, y: 60, z: 4 }, route: [], room: null, tunnels: [] });
        assert.equal(s.nearest({ x: -25, y: 60, z: 4 }, 'overworld')?.name, 'deep');
        assert.equal(s.nearest({ x: 25, y: 60, z: 4 }, 'overworld')?.name, 'mine');
    });
});

describe('I6, B6: addPassed and removePassed', () => {
    test('the five reasons of the ore list are kept', () => {
        const s = new S.MineStore(null, { now: NOW });
        s.set(PLAYER_MINE());
        const reasons = ['pickaxe', 'lava', 'inventory', 'vein', 'stopped'];
        reasons.forEach((reason, i) => s.addPassed('mine', entry(i, reason)));
        assert.deepEqual(s.byName('mine', 'overworld').passed.map((e) => e.reason), reasons);
    });

    test('at most 200 entries; the oldest leave', () => {
        const s = new S.MineStore(null, { now: NOW });
        s.set(PLAYER_MINE());
        for (let i = 0; i < 205; i++) s.addPassed('mine', { ore: 'coal_ore', x: i, y: 25, z: 0, reason: 'inventory', seen: '2026-09-30T10:00:00.000Z' });
        const passed = s.byName('mine', 'overworld').passed;
        assert.equal(passed.length, 200);
        assert.equal(passed[0].x, 5, 'the five oldest left');
        assert.equal(passed.at(-1).x, 204);
    });

    test('removePassed: the entry at the position leaves; the others stay; the file follows', () => {
        const file = path.join(dir, 'passed.json');
        const s = new S.MineStore(file, { now: NOW });
        s.set(PLAYER_MINE());
        s.addPassed('mine', entry(1));
        s.addPassed('mine', entry(2, 'lava'));
        s.removePassed('mine', { x: 22, y: 25, z: -1 });
        assert.deepEqual(s.byName('mine', 'overworld').passed.map((e) => e.z), [-2]);
        const json = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.deepEqual(json.mines.mine.passed.map((e) => e.z), [-2]);
    });

    test('a mine of the bot has its ore list too (its key is the level)', () => {
        const s = new S.MineStore(null, { now: NOW });
        s.set(BOT_MINE());
        s.addPassed('16', entry(1, 'vein', 'iron_ore'));
        assert.equal(s.get('iron', 'overworld').passed.length, 1);
    });

    test('an unknown mine: nothing happens, nothing throws', () => {
        const s = new S.MineStore(null, { now: NOW });
        assert.doesNotThrow(() => s.addPassed('nope', entry(1)));
        assert.doesNotThrow(() => s.removePassed('nope', { x: 1, y: 2, z: 3 }));
    });
});
