// Spec v0.1.4.9 part B (engineer E2), B1 and I6: the mine store keeps the new fields, a mine of
// v0.1.4.7 loads unchanged, the key is the name or the level, byName, nearest, the ore list.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';

const S = await loadSrc('src/agent/packs/mining/mine_store.js');
const L = await loadSrc('src/agent/packs/mining/mine_logic.js');

const now = () => new Date(Date.parse('2026-09-30T10:00:00Z'));
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rtb-store-')), 'mines.json');
const cleanup = file => fs.rmSync(path.dirname(file), { recursive: true, force: true });

// The mines.json of the owner of 2026-09-29 (v0.1.4.7).
const OLD_FILE = { version: 1, mines: { 16: { ore: 'iron', entrance: { x: 9, y: 67, z: 58 }, level: 16, base: { x: 9, y: 16, z: 58 }, chest: null,
    direction: 'west', length: 7, shaft: 'ladder', created: '2026-09-29T10:00:00.000Z', updated: '2026-09-29T11:00:00.000Z', dimension: 'overworld',
    ores: ['iron'], end: { x: 0, y: 16, z: 58 }, tunnel: [{ x: 7, y: 16, z: 58 }, { x: 0, y: 16, z: 58 }],
    route: [{ kind: 'ladder', x: 9, z: 58, top: 66, bottom: 16, face: 'west', entry: { x: 10, y: 67, z: 58 } }] } } };

const PLAYER = {
    name: ' Mine ', source: 'player', ore: 'iron', entrance: { x: 0, y: 64, z: -3 }, level: 34,
    route: [
        { kind: 'walk', from: { x: 0, y: 64, z: -3 }, to: { x: 0, y: 64, z: -1 } },
        { kind: 'door', kind2: 'trapdoor', name: 'oak_trapdoor', x: 0, y: 63, z: 0, from: { x: 0, y: 64, z: -1 }, to: { x: 0, y: 62, z: 0 } },
        { kind: 'ladder', x: 0, z: 0, top: 62, bottom: 50, face: 'south', entry: { x: 0, y: 64, z: -1 } },
    ],
    room: { center: { x: 1, y: 50, z: 0 }, chest: { x: -2, y: 50, z: 2 }, table: null, furnace: { x: 2.4, y: 50, z: -2 } },
    tunnels: [{ start: { x: 21, y: 34, z: 2 }, dir: 'south', end: { x: 21, y: 34, z: 13 }, level: 34, length: 12,
        branches: [{ at: 4, side: 'left', start: { x: 22, y: 34, z: 6 }, end: { x: 25, y: 34, z: 6 }, length: 4, done: false }] }],
    passed: [{ ore: 'gold_ore', x: 22, y: 34, z: 14, reason: 'pickaxe', seen: '2026-09-30T09:00:00.000Z' }],
    area: 'mining_area',
};

describe('B1: the fields of v0.1.4.9', () => {
    test('a mine of v0.1.4.7 loads unchanged with name null, source bot, room null, tunnels [], passed []', () => {
        const file = tmpFile();
        try {
            fs.writeFileSync(file, JSON.stringify(OLD_FILE));
            const s = new S.MineStore(file, { now });
            assert.equal(s.load(), 1);
            const m = s.get('iron');
            assert.equal(m.name, null);
            assert.equal(m.source, 'bot');
            assert.equal(m.room, null);
            assert.deepEqual(m.tunnels, []);
            assert.deepEqual(m.passed, []);
            assert.deepEqual(m.route, OLD_FILE.mines[16].route);
            assert.deepEqual(m.end, { x: 0, y: 16, z: 58 });
            assert.equal(m.created, '2026-09-29T10:00:00.000Z');
            const [t] = L.tunnelsOf(m);
            assert.deepEqual([t.start, t.dir, t.end, t.level, t.length], [{ x: 7, y: 16, z: 58 }, 'west', { x: 0, y: 16, z: 58 }, 16, 7], 'one tunnel when read');
            s.set(m);
            assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).mines), ['16'], 'the key stays the level');
        } finally {
            cleanup(file);
        }
    });

    test('a mine of the player: the name as key, the room, tunnels, door legs and the ore list are kept', () => {
        const file = tmpFile();
        try {
            const s = new S.MineStore(file, { now });
            const m = s.set(PLAYER);
            assert.equal(m.name, 'mine', 'trimmed and lower case');
            assert.equal(m.source, 'player');
            assert.deepEqual(m.room, { center: { x: 1, y: 50, z: 0 }, chest: { x: -2, y: 50, z: 2 }, table: null, furnace: { x: 2, y: 50, z: -2 } });
            assert.deepEqual(m.route[1], PLAYER.route[1]);
            assert.deepEqual(m.tunnels, PLAYER.tunnels);
            assert.deepEqual(m.passed, [{ ore: 'gold', x: 22, y: 34, z: 14, reason: 'pickaxe', seen: '2026-09-30T09:00:00.000Z' }]);
            assert.equal(m.area, 'mining_area');
            assert.equal(S.mineKey(m), 'mine');
            assert.equal(S.mineKey({ ...m, dimension: 'the_nether' }), 'the_nether:mine');
            assert.equal(S.mineKey({ level: 16 }), '16');
            s.set({ ...PLAYER, name: 'deep', level: 16 });
            s.set(OLD_FILE.mines[16]);
            assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).mines).sort(), ['16', 'deep', 'mine']);
            const again = new S.MineStore(file, { now });
            assert.equal(again.load(), 3);
            assert.deepEqual(again.byName('MINE').tunnels, PLAYER.tunnels);
        } finally {
            cleanup(file);
        }
    });

    test('invalid parts are left out, the mine stays', () => {
        const s = new S.MineStore(null, { now });
        const m = s.set({
            ...PLAYER, source: 'someone', room: { chest: { x: 1, y: 2, z: 3 } }, name: '  ',
            tunnels: [{ start: { x: 1 }, dir: 'north', end: { x: 1, y: 2, z: 3 } }, { start: { x: 0, y: 1, z: 0 }, dir: 'up', end: { x: 0, y: 1, z: 0 } },
                { start: { x: 0, y: 1, z: 0 }, dir: 'east', end: { x: 5, y: 1, z: 0 }, length: -2, branches: [{ at: 4, side: 'up' }, 'x'] }],
            passed: [{ ore: 'stone', x: 1, y: 1, z: 1, reason: 'lava' }, { ore: 'coal', x: 1, y: 1, z: 1, reason: 'lava' }, { ore: 'coal', x: 1, y: 1, z: 1, reason: 'vein' }],
            route: [{ kind: 'door', x: 1, y: 2, z: 3, from: { x: 1, y: 2, z: 2 }, to: { x: 1, y: 2, z: 4 } }, { kind: 'door', x: 1 }],
        });
        assert.equal(m.source, 'bot');
        assert.equal(m.name, null);
        assert.equal(m.room, null);
        assert.deepEqual(m.tunnels, [{ start: { x: 0, y: 1, z: 0 }, dir: 'east', end: { x: 5, y: 1, z: 0 }, level: 1, length: 0, branches: [] }]);
        assert.deepEqual(m.passed, [{ ore: 'coal', x: 1, y: 1, z: 1, reason: 'vein', seen: null }], 'one entry per cell, the last wins');
        assert.deepEqual(m.route, [{ kind: 'door', kind2: 'door', name: null, x: 1, y: 2, z: 3, from: { x: 1, y: 2, z: 2 }, to: { x: 1, y: 2, z: 4 } }]);
    });
});

describe('I6: get, atLevel, byName, nearest, remove', () => {
    test('get and atLevel choose from the mines of the bot only', () => {
        const s = new S.MineStore(null, { now });
        s.set({ ...PLAYER, level: 16 });
        assert.equal(s.get('iron'), null, 'the mine of the player is not the mine of the ore');
        assert.equal(s.atLevel(16), null);
        s.set(OLD_FILE.mines[16]);
        assert.equal(s.get('iron').source, 'bot');
        assert.equal(s.atLevel(16).source, 'bot');
        assert.equal(s.size, 2, 'the level and the name are two keys');
        assert.equal(s.byName('mine').source, 'player');
        assert.equal(s.byName('none'), null);
        assert.equal(s.byName(null), null);
    });

    test('nearest: by the entrance and every cell of the route, the room and the tunnels, within 64', () => {
        const s = new S.MineStore(null, { now });
        s.set(PLAYER);
        s.set({ ...OLD_FILE.mines[16], entrance: { x: 200, y: 64, z: 0 }, base: null, end: null, tunnel: [], direction: null, route: [] });
        assert.equal(s.nearest({ x: 21, y: 34, z: 40 }).name, 'mine', '27 blocks from the end of the tunnel');
        assert.equal(s.nearest({ x: 0, y: 55, z: 10 }).name, 'mine', 'the ladder');
        assert.equal(s.nearest({ x: 21, y: 34, z: 90 }), null, '77 blocks');
        assert.equal(s.nearest({ x: 21, y: 34, z: 90 }, undefined, 80).name, 'mine');
        assert.equal(s.nearest({ x: 190, y: 64, z: 0 }).source, 'bot');
        assert.equal(s.nearest({ x: 0, y: 64, z: -3 }, 'the_nether'), null);
        assert.deepEqual(s.within({ x: 100, y: 64, z: 0 }, undefined, 200).map(m => m.source), ['player', 'bot']);
        assert.equal(s.remove('mine'), true, 'removed by its name');
        assert.equal(s.byName('mine'), null);
    });
});

describe('I6: addPassed and removePassed', () => {
    test('added with the time, replaced at the same cell, at most 200, removed by cell; written to the file', () => {
        const file = tmpFile();
        try {
            const s = new S.MineStore(file, { now });
            s.set({ ...PLAYER, passed: [] });
            const m = s.addPassed('mine', { ore: 'coal_ore', x: 20, y: 34, z: 5, reason: 'inventory' });
            assert.deepEqual(m.passed, [{ ore: 'coal', x: 20, y: 34, z: 5, reason: 'inventory', seen: '2026-09-30T10:00:00.000Z' }]);
            s.addPassed(m, { ore: 'coal', x: 20, y: 34, z: 5, reason: 'stopped', seen: 'then' });
            assert.deepEqual(s.byName('mine').passed, [{ ore: 'coal', x: 20, y: 34, z: 5, reason: 'stopped', seen: 'then' }]);
            for (let i = 0; i < 210; i++) {
                s.addPassed('mine', { ore: 'iron', x: i, y: 0, z: 0, reason: 'vein' });
            }
            assert.equal(s.byName('mine').passed.length, 200);
            assert.equal(s.byName('mine').passed[0].x, 10);
            assert.equal(s.removePassed('mine', { x: 50.5, y: 0, z: 0.9 }).passed.length, 199);
            assert.equal(s.removePassed('mine', { x: 50, y: 0, z: 0 }).passed.length, 199, 'nothing there');
            const json = JSON.parse(fs.readFileSync(file, 'utf8'));
            assert.equal(json.mines.mine.passed.length, 199);
            assert.equal(s.addPassed('none', { ore: 'iron', x: 0, y: 0, z: 0, reason: 'vein' }), null);
            assert.equal(s.addPassed('mine', { ore: 'iron', x: 0, y: 0, z: 0, reason: 'bored' }), null);
            assert.equal(s.removePassed('none', { x: 0, y: 0, z: 0 }), null);
        } finally {
            cleanup(file);
        }
    });
});
