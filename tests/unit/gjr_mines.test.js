// Spec v0.1.4.10 part R (engineer E3), R4: the mines.
//   - MineStore keys a mine of the bot bot:<level> and a mine of the player by its name; a mine of the
//     player named "16" and the mine of the bot at level 16 are two mines;
//   - a file of version 1 is written again as version 2 at load, every mine kept;
//   - remove(name) and find(name): the name first, then a level ("16", "bot:16"), then an ore;
//   - forgetMine(ctx, name) and minesText(ctx, dimension) of mine_player.js, the texts word for word.
// The stores live in a temp directory, never under bots/.
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

const S = await loadSrc('src/agent/packs/mining/mine_store.js');
const P = await loadSrc('src/agent/packs/mining/mine_player.js');
const T = await loadSrc('src/agent/packs/mining/texts.js');

const NOW = () => new Date('2026-10-01T10:00:00Z');

// the mine of the bot of the owner (F15): a shaft at (9, 67, 58) to level 16
const BOT_MINE = () => ({
    ore: 'iron', entrance: { x: 9, y: 67, z: 58 }, level: 16, base: { x: 9, y: 16, z: 58 }, chest: null, direction: 'north', length: 8,
    shaft: 'ladder', created: '2026-09-28T10:00:00.000Z', updated: '2026-09-28T11:00:00.000Z', dimension: 'overworld', ores: ['iron'],
    end: { x: 9, y: 16, z: 50 }, tunnel: [], route: [],
});
// the mine of the player with two tunnels at levels 30 and 25
const PLAYER_MINE = (name = 'mine') => ({
    name, source: 'player', ore: 'iron', entrance: { x: 9, y: 67, z: 52 }, level: 30, dimension: 'overworld', route: [],
    room: { center: { x: 9, y: 41, z: 50 }, chest: null, table: null, furnace: null },
    tunnels: [
        { start: { x: 12, y: 30, z: 50 }, dir: 'east', end: { x: 20, y: 30, z: 50 }, level: 30, length: 9, branches: [] },
        { start: { x: 12, y: 25, z: 50 }, dir: 'east', end: { x: 24, y: 25, z: 50 }, level: 25, length: 13, branches: [] },
    ],
    passed: [],
});

let dir;
let cap;
before(() => { dir = makeTmpDir(); });
after(() => removeTmpDir(dir));
beforeEach(() => { cap = captureConsole(); });
afterEach(() => cap.restore());

let n = 0;
const fileName = () => path.join(dir, `mines${++n}.json`);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

describe('R4: the keys and the file', () => {
    test('a mine of the bot is bot:<level>, a mine of the player its name; the dimension in front', () => {
        assert.equal(S.mineKey(BOT_MINE()), 'bot:16');
        assert.equal(S.mineKey({ ...BOT_MINE(), dimension: 'the_nether' }), 'the_nether:bot:16');
        assert.equal(S.mineKey(PLAYER_MINE()), 'mine');
        assert.equal(S.mineKey(PLAYER_MINE('16')), '16');
        assert.equal(S.BOT_KEY_PREFIX, 'bot:');
    });

    test('a mine of the player named "16" and the mine of the bot at level 16 are two mines', () => {
        const file = fileName();
        const s = new S.MineStore(file, { now: NOW });
        s.set(BOT_MINE());
        s.set(PLAYER_MINE('16'));
        assert.equal(s.size, 2);
        const json = readJson(file);
        assert.equal(json.version, 2);
        assert.deepEqual(Object.keys(json.mines).sort(), ['16', 'bot:16']);
        assert.equal(s.byName('16').source, 'player');
        assert.equal(s.atLevel(16).source, 'bot');
    });

    test('a file of version 1 is written as version 2 at load, every mine kept, the level keys bot:<level>', () => {
        const file = fileName();
        const nether = { ...BOT_MINE(), level: 40, dimension: 'the_nether' };
        fs.writeFileSync(file, JSON.stringify({ version: 1, mines: { 16: BOT_MINE(), mine: PLAYER_MINE(), 'the_nether:40': nether } }));
        const s = new S.MineStore(file, { now: NOW });
        assert.equal(s.load(), 3);
        const json = readJson(file);
        assert.equal(json.version, 2);
        assert.deepEqual(Object.keys(json.mines).sort(), ['bot:16', 'mine', 'the_nether:bot:40']);
        assert.equal(json.mines['bot:16'].created, '2026-09-28T10:00:00.000Z', 'the mine itself unchanged');
        assert.deepEqual(json.mines.mine.tunnels.map((t) => t.level), [30, 25]);
        const before = fs.readFileSync(file, 'utf8');
        fs.writeFileSync(file, before.replace('"created": "2026-09-28T10:00:00.000Z"', '"created": "2026-09-27T10:00:00.000Z"'));
        const again = new S.MineStore(file, { now: NOW });
        assert.equal(again.load(), 3);
        assert.ok(fs.readFileSync(file, 'utf8').includes('2026-09-27T10:00:00.000Z'), 'a file of version 2 is not written at load');
    });

    test('an empty or missing file is not written at load', () => {
        const file = fileName();
        assert.equal(new S.MineStore(file, { now: NOW }).load(), 0);
        assert.equal(fs.existsSync(file), false);
        fs.writeFileSync(file, JSON.stringify({ version: 1, mines: {} }));
        new S.MineStore(file, { now: NOW }).load();
        assert.equal(readJson(file).version, 1);
    });

    test('the old key of a level still reaches the mine of the bot (addPassed)', () => {
        const s = new S.MineStore(null, { now: NOW });
        s.set(BOT_MINE());
        assert.ok(s.addPassed('16', { ore: 'gold', x: 9, y: 16, z: 52, reason: 'pickaxe' }));
        assert.ok(s.addPassed('bot:16', { ore: 'gold', x: 9, y: 16, z: 53, reason: 'pickaxe' }));
        assert.equal(s.atLevel(16).passed.length, 2);
        assert.equal(s.addPassed('17', { ore: 'gold', x: 9, y: 16, z: 53, reason: 'pickaxe' }), null);
    });
});

describe('R4: remove(name) and find(name)', () => {
    test('the name first, then the level, then the ore; list unchanged', () => {
        const s = new S.MineStore(null, { now: NOW });
        s.set(BOT_MINE());
        s.set(PLAYER_MINE('16'));
        s.set(PLAYER_MINE('mine'));
        assert.equal(s.find('16').source, 'player', 'the name wins');
        assert.equal(s.find('bot:16').source, 'bot');
        assert.equal(s.find(16).source, 'bot');
        assert.equal(s.find('iron').source, 'bot', 'an ore: the mine of the bot for it');
        assert.equal(s.find('Mine').name, 'mine');
        assert.equal(s.find('nope'), null);
        assert.equal(s.find(null), null);
        assert.equal(s.remove('16'), true);
        assert.deepEqual(s.list().map(S.mineKey).sort(), ['bot:16', 'mine']);
        assert.equal(s.remove('16'), true, 'now the mine of the bot at level 16');
        assert.deepEqual(s.list().map(S.mineKey), ['mine']);
        assert.equal(s.remove('16'), false);
    });
});

describe('R4: forgetMine and minesText', () => {
    function ctxWith(...mines) {
        const store = new S.MineStore(null, { now: NOW });
        for (const m of mines) store.set(m);
        const logs = [];
        return { ctx: { mines: store, log: (t) => logs.push(t) }, store, logs };
    }

    test('forgetMine: the texts word for word', () => {
        const { ctx, store, logs } = ctxWith(PLAYER_MINE(), BOT_MINE());
        assert.deepEqual(P.forgetMine(ctx, 'mine'), { ok: true, reason: null, text: 'Forgot the mine "mine".' });
        assert.deepEqual(logs, ['Forgot the mine "mine".']);
        assert.deepEqual(P.forgetMine(ctx, 'mine'), { ok: false, reason: 'no_mine', text: 'I know no mine "mine".' });
        assert.deepEqual(P.forgetMine(ctx, '16'), { ok: true, reason: null, text: 'Forgot the mine "16".' });
        assert.equal(store.size, 0);
    });

    test('forgetMine never throws', () => {
        assert.equal(P.forgetMine({}, 'mine').reason, 'no_store');
        const broken = { list: () => [], set: () => {}, find: () => { throw new Error('disk'); } };
        const r = P.forgetMine({ mines: broken }, 'mine');
        assert.deepEqual([r.ok, r.reason, r.text], [false, 'error', 'I could not forget the mine: disk']);
    });

    test('minesText: the example of the spec, the mines with a name first', () => {
        const { ctx } = ctxWith(BOT_MINE(), PLAYER_MINE());
        assert.equal(P.minesText(ctx, 'overworld'),
            'I know 2 mines: "mine", entrance (9, 67, 52), 2 tunnels at levels 30 and 25; the mine at (9, 67, 58) that I dug, level 16.');
        assert.equal(P.minesText(ctx, 'the_nether'), 'I know no mines.');
        assert.equal(P.minesText(ctxWith().ctx), 'I know no mines.');
    });

    test('minesText: one mine, one tunnel, no tunnel', () => {
        const one = { ...PLAYER_MINE(), tunnels: [PLAYER_MINE().tunnels[1]] };
        assert.equal(P.minesText(ctxWith(one).ctx), 'I know 1 mine: "mine", entrance (9, 67, 52), 1 tunnel at level 25.');
        assert.equal(P.minesText(ctxWith({ ...PLAYER_MINE(), tunnels: [] }).ctx), 'I know 1 mine: "mine", entrance (9, 67, 52), no tunnel.');
        assert.equal(T.tunnelsWords([{ level: 25 }, { level: 25 }]), '2 tunnels at level 25');
        assert.equal(T.tunnelsWords([{ level: 40 }, { level: 30 }, { level: 25 }]), '3 tunnels at levels 40, 30 and 25');
    });

    test('minesText never throws', () => {
        assert.equal(P.minesText({}), 'I cannot remember mines here: I have no mine store for this world.');
        const broken = { list: () => { throw new Error('disk'); }, set: () => {} };
        assert.equal(P.minesText({ mines: broken }), 'I could not read the mines: disk');
    });
});
