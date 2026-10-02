// Spec v0.1.4.7 M3: src/agent/packs/mining/mine_store.js -- the mines of a world, one per level.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';

const S = await loadSrc('src/agent/packs/mining/mine_store.js');

let clock = Date.parse('2026-09-28T10:00:00Z');
const now = () => new Date(clock);
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mining-store-')), 'mines.json');
const cleanup = file => fs.rmSync(path.dirname(file), { recursive: true, force: true });

const IRON = {
    ore: 'iron', entrance: { x: 20, y: 64, z: -14 }, level: 16, base: { x: 20, y: 16, z: -14 }, chest: { x: 19, y: 16, z: -14 },
    direction: 'north', length: 37, shaft: 'ladder',
    route: [{ kind: 'ladder', x: 20, z: -14, top: 63, bottom: 16, face: 'north', entry: { x: 20, y: 64, z: -13 } }],
    end: { x: 20, y: 16, z: -53 },
};

describe('MineStore', () => {
    test('set, get, list, remove, size in memory', () => {
        const s = new S.MineStore(null, { now });
        assert.equal(s.load(), 0);
        const saved = s.set(IRON);
        assert.equal(saved.ore, 'iron');
        assert.deepEqual(saved.entrance, { x: 20, y: 64, z: -14 });
        assert.equal(saved.level, 16);
        assert.equal(saved.length, 37);
        assert.equal(saved.shaft, 'ladder');
        assert.equal(saved.created, '2026-09-28T10:00:00.000Z');
        assert.equal(saved.updated, '2026-09-28T10:00:00.000Z');
        assert.equal(saved.dimension, 'overworld');
        assert.deepEqual(saved.ores, ['iron']);
        assert.equal(saved.route.length, 1);
        assert.deepEqual(s.get('iron').base, IRON.base);
        assert.deepEqual(s.get('raw_iron').chest, IRON.chest);
        assert.equal(s.get('gold'), null);
        assert.equal(s.get('mithril'), null);
        assert.equal(s.size, 1);
        assert.equal(s.list().length, 1);
        s.get('iron').base.x = 999;
        assert.equal(s.get('iron').base.x, 20, 'copies');
        assert.equal(s.remove('gold'), false);
        assert.equal(s.remove('iron'), true);
        assert.equal(s.size, 0);
    });

    test('one mine per level: two ores with the same level share it, get finds it for both', () => {
        const s = new S.MineStore(null, { now });
        s.set({ ...IRON, ore: 'diamond', level: -59, entrance: { x: 0, y: 64, z: 0 } });
        assert.equal(s.get('redstone')?.ore, 'diamond', 'redstone has the level of diamond');
        clock += 60000;
        const shared = s.set({ ...IRON, ore: 'redstone', level: -59, entrance: { x: 0, y: 64, z: 0 }, length: 50 });
        assert.equal(s.size, 1);
        assert.equal(shared.ore, 'redstone');
        assert.deepEqual(shared.ores.sort(), ['diamond', 'redstone']);
        assert.equal(shared.created, '2026-09-28T10:00:00.000Z', 'created stays');
        assert.equal(shared.updated, '2026-09-28T10:01:00.000Z');
        assert.equal(s.get('diamond').length, 50);
        assert.equal(s.atLevel(-59).ore, 'redstone');
        assert.equal(s.atLevel(3), null);
        assert.equal(s.remove(-59), true);
    });

    test('list: highest level first, by dimension', () => {
        const s = new S.MineStore(null, { now });
        s.set({ ...IRON, ore: 'coal', level: 50 });
        s.set(IRON);
        s.set({ ...IRON, ore: 'gold', level: -16, dimension: 'minecraft:the_nether' });
        assert.deepEqual(s.list().map(m => m.level), [50, 16, -16]);
        assert.deepEqual(s.list('overworld').map(m => m.ore), ['coal', 'iron']);
        assert.deepEqual(s.list('the_nether').map(m => m.ore), ['gold']);
        assert.equal(s.get('gold', 'overworld'), null);
        assert.equal(s.get('gold', 'the_nether').ore, 'gold');
    });

    test('validation', () => {
        const s = new S.MineStore(null, { now });
        assert.throws(() => s.set(null), TypeError);
        assert.throws(() => s.set({ ...IRON, ore: 'mithril' }), TypeError);
        assert.throws(() => s.set({ ...IRON, entrance: { x: 1 } }), TypeError);
        assert.throws(() => s.set({ ...IRON, level: 'deep' }), TypeError);
        const m = s.set({ ore: 'iron_ore', entrance: { x: 1.7, y: 64.2, z: -3.5 }, level: 16.9, direction: 'up', shaft: 'rope', length: -3,
            route: [{ kind: 'walk', from: { x: 1, y: 2, z: 3 }, to: { x: 4, y: 2, z: 3 } }, { kind: 'stairs', from: { x: 1, y: 2, z: 3 }, to: { x: 4, y: 0, z: 3 }, dir: 'x' },
                { kind: 'ladder', x: 1, z: 2 }, 'junk', { kind: 'ladder', x: 1, z: 2, top: 60, bottom: 30, face: 'up' }], ores: ['gold', 'mithril'] });
        assert.equal(m.ore, 'iron');
        assert.deepEqual(m.entrance, { x: 1, y: 64, z: -4 });
        assert.equal(m.level, 16);
        assert.equal(m.direction, null);
        assert.equal(m.shaft, 'ladder');
        assert.equal(m.length, 0);
        assert.equal(m.base, null);
        assert.deepEqual(m.ores.sort(), ['gold', 'iron']);
        assert.deepEqual(m.route.map(l => l.kind), ['walk', 'stairs', 'ladder']);
        assert.equal(m.route[1].dir, 'north');
        assert.equal(m.route[2].face, 'north');
        assert.equal(m.route[2].entry, null);
    });

    test('the file: written on every change, read by load, survives a restart', () => {
        const file = tmpFile();
        try {
            const a = new S.MineStore(file, { now });
            a.set(IRON);
            const json = JSON.parse(fs.readFileSync(file, 'utf8'));
            assert.equal(json.version, 2); // v0.1.4.10 (R4): version 2, a mine of the bot keyed bot:<level>
            assert.deepEqual(Object.keys(json.mines), ['bot:16']);
            const b = new S.MineStore(file, { now });
            assert.equal(b.load(), 1);
            const m = b.get('iron');
            assert.deepEqual(m.route, a.get('iron').route);
            assert.equal(m.created, a.get('iron').created);
            assert.match(m.created, /^2026-09-28T10:0\d:00\.000Z$/);
            b.set({ ...IRON, ore: 'gold', level: -16, dimension: 'the_end' });
            assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).mines).sort(), ['bot:16', 'the_end:bot:-16']);
            b.remove('iron');
            const c = new S.MineStore(file);
            assert.equal(c.load(), 1);
        } finally {
            cleanup(file);
        }
    });

    test('a corrupt or odd file: empty, never throws', () => {
        const file = tmpFile();
        const warn = console.warn;
        console.warn = () => {};
        try {
            fs.writeFileSync(file, '{ not json');
            const s = new S.MineStore(file, { now });
            assert.equal(s.load(), 0);
            fs.writeFileSync(file, JSON.stringify({ version: 1, mines: { a: { ore: 'mithril' }, b: { ...IRON, created: 5 } } }));
            assert.equal(s.load(), 1);
            assert.equal(s.get('iron').created, null);
            fs.writeFileSync(file, JSON.stringify({ version: 1, mines: [] }));
            assert.equal(s.load(), 0);
            assert.equal(new S.MineStore(path.join(path.dirname(file), 'none.json')).load(), 0);
            const bad = new S.MineStore(path.join(path.dirname(file), 'no', 'such', 'dir', 'x.json'));
            fs.writeFileSync(path.join(path.dirname(file), 'no'), 'a file where a folder should be');
            assert.equal(bad.set(IRON).ore, 'iron', 'a write that fails keeps the mine in memory');
        } finally {
            console.warn = warn;
            cleanup(file);
        }
    });
});
