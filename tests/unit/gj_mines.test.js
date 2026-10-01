// Tester T1 of v0.1.4.10 "Goals", from the spec (I6, R4, section 7) and the handoff of part R: the keys of the mines
// (bot:<level> for a mine of the bot, the name for a mine of the player), the migration of mines.json to version 2
// with every mine kept, remove(name), forgetMine and minesText word for word. On a temp folder under os.tmpdir().
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';

const S = await loadSrc('src/agent/packs/mining/mine_store.js');
const PLAYER = await loadSrc('src/agent/packs/mining/mine_player.js');
const PACK = await loadSrc('src/agent/packs/mining/index.js');

let dir;
let file;
let cap;
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gj-mines-'));
    file = path.join(dir, 'mines.json');
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
    fs.rmSync(dir, { recursive: true, force: true });
});

// A mine the bot dug at level 16 (entrance (9, 67, 58)); a mine of the player "mine" with 2 tunnels at 30 and 25.
const botMine = (extra = {}) => ({ ore: 'iron', entrance: { x: 9, y: 67, z: 58 }, level: 16, shaft: 'ladder', ...extra });
const playerMine = (extra = {}) => ({
    ore: 'iron', entrance: { x: 9, y: 67, z: 52 }, level: 30, name: 'mine', source: 'player',
    tunnels: [
        { start: { x: 9, y: 30, z: 40 }, dir: 'north', end: { x: 9, y: 30, z: 20 }, level: 30, length: 20, branches: [] },
        { start: { x: 12, y: 25, z: 40 }, dir: 'east', end: { x: 30, y: 25, z: 40 }, level: 25, length: 18, branches: [] },
    ],
    ...extra,
});

describe('R4: the keys of the mines', () => {
    test('a mine of the bot is bot:<level>, a mine of the player its name; version 2', () => {
        const store = new S.MineStore(file);
        store.load();
        store.set(botMine());
        store.set(playerMine());
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.equal(raw.version, 2);
        assert.deepEqual(Object.keys(raw.mines).sort(), ['bot:16', 'mine']);
    });

    test('a mine of the player named "16" and the mine of the bot at level 16 are two mines', () => {
        const store = new S.MineStore(file);
        store.load();
        store.set(botMine());
        store.set(playerMine({ name: '16', level: 16 }));
        assert.equal(store.list().length, 2);
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.deepEqual(Object.keys(raw.mines).sort(), ['16', 'bot:16']);
    });
});

describe('R4: the migration of mines.json', () => {
    test('a version 1 file is written again as version 2 at load, every mine kept, the old keys as bot:<key>', () => {
        const v1 = { version: 1, mines: {
            16: { ...botMine(), created: '2026-09-01T00:00:00.000Z', updated: '2026-09-01T00:00:00.000Z' },
            'the_nether:40': { ...botMine({ ore: 'gold', level: 40, entrance: { x: 1, y: 70, z: 1 } }), dimension: 'the_nether' },
            mine: playerMine(),
        } };
        fs.writeFileSync(file, JSON.stringify(v1));
        const store = new S.MineStore(file);
        assert.equal(store.load(), 3);
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.equal(raw.version, 2);
        assert.deepEqual(Object.keys(raw.mines).sort(), ['bot:16', 'mine', 'the_nether:bot:40']);
        assert.equal(raw.mines['bot:16'].created, '2026-09-01T00:00:00.000Z', 'the mine as it was');
        assert.equal(store.list().length, 3, 'list unchanged in shape');
    });
});

describe('R4: remove by name', () => {
    test('remove(name) removes the mine of the player; a level the mine of the bot; false for none', () => {
        const store = new S.MineStore(file);
        store.load();
        store.set(botMine());
        store.set(playerMine());
        assert.equal(store.remove('mine'), true);
        assert.deepEqual(store.list().map((m) => m.level), [16]);
        assert.equal(store.remove('nothing'), false);
        assert.equal(store.remove('bot:16'), true);
        assert.equal(store.list().length, 0);
        assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).mines, {});
    });
});

describe('R4: forgetMine and minesText, word for word', () => {
    test('forgetMine', () => {
        const store = new S.MineStore(file);
        store.load();
        store.set(playerMine());
        const ok = PLAYER.forgetMine({ mines: store }, 'mine');
        assert.deepEqual([ok.ok, ok.text], [true, 'Forgot the mine "mine".']);
        assert.equal(store.list().length, 0);
        const none = PLAYER.forgetMine({ mines: store }, 'mine');
        assert.deepEqual([none.ok, none.text], [false, 'I know no mine "mine".']);
        assert.equal(typeof none.reason, 'string');
    });

    test('minesText', () => {
        const store = new S.MineStore(file);
        store.load();
        assert.equal(PLAYER.minesText({ mines: store }, 'overworld'), 'I know no mines.');
        store.set(botMine());
        store.set(playerMine());
        assert.equal(PLAYER.minesText({ mines: store }, 'overworld'),
            'I know 2 mines: "mine", entrance (9, 67, 52), 2 tunnels at levels 30 and 25; the mine at (9, 67, 58) that I dug, level 16.');
    });

    test('both are reached through the pack', () => {
        assert.equal(typeof PACK.forgetMine, 'function');
        assert.equal(typeof PACK.minesText, 'function');
    });

    test('never throws: a broken store gives a result', () => {
        const broken = { list() { throw new Error('disk'); }, set() {}, find() { throw new Error('disk'); }, remove() { throw new Error('disk'); } };
        const r = PLAYER.forgetMine({ mines: broken }, 'mine');
        assert.equal(r.ok, false);
        assert.equal(typeof PLAYER.minesText({ mines: broken }), 'string');
    });
});
