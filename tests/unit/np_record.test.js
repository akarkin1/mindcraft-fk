// Release v0.1.4.11, part P (engineer E3): what a place holds and how it is kept (SPEC I5).
//   - countContents of src/agent/areas/area_sense.js with a fake bot: the entities and the blocks of a box;
//   - the area record of src/agent/areas/area_store.js: kind, contents, border; the type from the kind; a record of
//     v0.1.4.10 without them loads unchanged; a new box of the same type keeps them;
//   - isKeepOutArea of src/agent/areas/keep_out_logic.js by the facts, and the word of the kind in leaveText.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld, vec } from '../helpers/block_world.js';

const A = await loadSrc('src/agent/areas/area_sense.js');
const AS = await loadSrc('src/agent/areas/area_store.js');
const L = await loadSrc('src/agent/areas/keep_out_logic.js');

const box = (x0, y0, z0, x1, y1, z1) => ({ min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } });

function fakeBot(world, entities = []) {
    const bot = { entity: { id: 1, name: 'player', type: 'player', position: vec(0.5, 64, 0.5) }, blockAt: (pos) => world.blockAt(pos) };
    bot.entities = { 1: bot.entity };
    entities.forEach((e, i) => { bot.entities[10 + i] = { id: 10 + i, ...e }; });
    return bot;
}

describe('countContents (I5)', () => {
    test('animals by kind inside the box; players, items, hostile mobs and animals outside are not counted', () => {
        const world = createBlockWorld().flatGround(63);
        const bot = fakeBot(world, [
            ...Array.from({ length: 6 }, (_, i) => ({ name: 'chicken', type: 'animal', position: vec(1.5 + i * 0.5, 64, 2.5) })),
            { name: 'cow', type: 'animal', position: vec(4.2, 64, 1.1) },
            { name: 'cow', type: 'animal', position: vec(20.5, 64, 1.5) },
            { name: 'player', type: 'player', position: vec(2.5, 64, 2.5) },
            { name: 'item', type: 'object', position: vec(2.5, 64, 2.5) },
            { name: 'zombie', type: 'hostile', position: vec(2.5, 64, 2.5) },
            { name: 'sheep', type: 'mob', position: vec(3.5, 64, 3.5) },
        ]);
        const c = A.countContents(bot, box(0, 62, 0, 8, 66, 6));
        assert.deepEqual(c.animals, { chicken: 6, cow: 1, sheep: 1 });
    });

    test('the blocks: crops by kind, beds by their head, chests once per double chest, furnaces, tables, ladders, water sources', () => {
        const world = createBlockWorld().flatGround(63);
        world.fill(0, 64, 0, 3, 64, 0, 'wheat');
        world.set(0, 64, 1, 'carrots');
        world.set(1, 64, 1, 'attached_melon_stem');
        world.set(2, 64, 1, 'melon_stem');
        world.set(0, 64, 2, 'red_bed', { part: 'head' });
        world.set(1, 64, 2, 'red_bed', { part: 'foot' });
        world.set(0, 64, 3, 'chest', { type: 'left' });
        world.set(1, 64, 3, 'chest', { type: 'right' });
        world.set(2, 64, 3, 'chest');
        world.set(3, 64, 3, 'barrel');
        world.set(0, 64, 4, 'furnace');
        world.set(1, 64, 4, 'smoker');
        world.set(2, 64, 4, 'crafting_table');
        world.fill(3, 64, 4, 3, 66, 4, 'ladder');
        world.set(0, 63, 5, 'water', { level: 0 });
        world.set(1, 63, 5, 'water', { level: 3 });
        world.set(9, 64, 9, 'chest'); // outside
        const c = A.countContents(fakeBot(world), box(0, 63, 0, 4, 66, 5));
        assert.deepEqual(c, { animals: {}, crops: { wheat: 4, carrots: 1, melon_stem: 2 }, beds: 1, chests: 3, furnaces: 2, tables: 1, ladders: 3, water: 1 });
    });

    test('nothing to read: every count 0, never a throw', () => {
        assert.deepEqual(A.countContents({}, box(0, 0, 0, 1, 1, 1)), A.emptyContents());
        assert.deepEqual(A.countContents(null, null), A.emptyContents());
        const bad = { entities: { 1: null }, blockAt() { throw new Error('boom'); } };
        assert.deepEqual(A.countContents(bad, box(0, 0, 0, 1, 1, 1)), A.emptyContents());
    });
});

describe('the area record (I5)', () => {
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
    const NOW = () => new Date('2026-10-02T10:00:00Z');
    const CONTENTS = { animals: { chicken: 6 }, crops: {}, beds: 0, chests: 0, furnaces: 0, tables: 0, ladders: 0, water: 0 };
    const base = (fields = {}) => ({ name: 'aviary', min: { x: 0, y: 62, z: 0 }, max: { x: 8, y: 66, z: 6 }, dimension: 'overworld',
        entrances: [{ x: 4, y: 64, z: 6, kind: 'gate' }], source: 'scan', ...fields });

    test('kind, contents and border are saved, and the type is that of the kind', () => {
        const store = new AS.AreaStore(path.join(dir, 'areas.json'), { now: NOW });
        const a = store.set(base({ kind: 'pen', type: 'building', contents: CONTENTS, border: 'fence' }));
        assert.equal(a.type, 'pen');
        assert.equal(a.kind, 'pen');
        assert.deepEqual(a.contents, CONTENTS);
        assert.equal(a.border, 'fence');
        assert.equal(store.set(base({ name: 'shed', kind: 'storage' })).type, 'building');
        assert.equal(store.set(base({ name: 'court', kind: 'yard' })).type, 'building');
        const again = new AS.AreaStore(path.join(dir, 'areas.json'), { now: NOW });
        again.load();
        assert.deepEqual(again.get('aviary'), a);
    });

    test('a kind alone is enough; bad fields are left out', () => {
        const store = new AS.AreaStore(path.join(dir, 'areas.json'), { now: NOW });
        const a = store.set(base({ kind: 'farm', contents: { animals: { cow: -1, pig: 2.7 }, crops: 'x', beds: 'one' }, border: 'castle' }));
        assert.equal(a.type, 'farm');
        assert.deepEqual(a.contents, { animals: { pig: 2 }, crops: {}, beds: 0, chests: 0, furnaces: 0, tables: 0, ladders: 0, water: 0 });
        assert.equal('border' in a, false);
        const b = store.set(base({ name: 'x', type: 'home', kind: 'castle' }));
        assert.equal('kind' in b, false);
        assert.equal(b.type, 'home');
    });

    test('a copy cannot change the store', () => {
        const store = new AS.AreaStore(path.join(dir, 'areas.json'), { now: NOW });
        store.set(base({ kind: 'pen', contents: CONTENTS }));
        store.get('aviary').contents.animals.chicken = 99;
        assert.equal(store.get('aviary').contents.animals.chicken, 6);
    });

    test('a record of v0.1.4.10 without the new fields loads unchanged', () => {
        const file = path.join(dir, 'areas.json');
        const old = { name: 'pen', type: 'pen', min: { x: 0, y: 62, z: 0 }, max: { x: 8, y: 66, z: 6 }, dimension: 'overworld',
            entrances: [{ x: 4, y: 64, z: 6, kind: 'gate' }], source: 'scan', created: '2026-09-30T10:00:00.000Z', updated: '2026-09-30T10:00:00.000Z' };
        fs.writeFileSync(file, JSON.stringify({ version: 1, migrated: 1, areas: { pen: old } }));
        const store = new AS.AreaStore(file, { now: NOW });
        store.load();
        assert.deepEqual(store.get('pen'), old);
        assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).areas.pen, old, 'the file is not written again');
    });

    test('a new box of the same type keeps the kind, the contents and the border; another type drops them', () => {
        const store = new AS.AreaStore(path.join(dir, 'areas.json'), { now: NOW });
        store.set(base({ name: 'shed', kind: 'storage', contents: CONTENTS, border: 'wall' }));
        const moved = store.set(base({ name: 'shed', type: 'building', max: { x: 9, y: 66, z: 6 } }));
        assert.equal(moved.kind, 'storage');
        assert.deepEqual(moved.contents, CONTENTS);
        assert.equal(moved.border, 'wall');
        const other = store.set(base({ name: 'shed', type: 'mine' }));
        assert.equal('kind' in other, false);
        assert.equal('contents' in other, false);
    });
});

describe('isKeepOutArea by the facts (I5)', () => {
    const area = (fields) => ({ name: 'a', min: { x: 0, y: 0, z: 0 }, max: { x: 5, y: 5, z: 5 }, entrances: [], ...fields });
    const GATE = [{ x: 2, y: 1, z: 5, kind: 'gate' }];

    test('the types pen and farm and the flag no_enter, as in v0.1.4.10', () => {
        assert.equal(L.isKeepOutArea(area({ type: 'pen' })), true);
        assert.equal(L.isKeepOutArea(area({ type: 'farm' })), true);
        assert.equal(L.isKeepOutArea(area({ type: 'home', flags: { no_enter: true } })), true);
        assert.equal(L.isKeepOutArea(area({ type: 'home' })), false);
    });

    test('the kind pen', () => {
        assert.equal(L.isKeepOutArea(area({ type: 'building', kind: 'pen' })), true);
    });

    test('animals in the contents and a gate, whatever the kind', () => {
        assert.equal(L.isKeepOutArea(area({ type: 'building', kind: 'yard', contents: { animals: { chicken: 2 } }, entrances: GATE })), true);
        assert.equal(L.isKeepOutArea(area({ type: 'building', kind: 'yard', contents: { animals: { chicken: 2 } } })), false, 'no gate');
        assert.equal(L.isKeepOutArea(area({ type: 'building', kind: 'yard', contents: { animals: {} }, entrances: GATE })), false, 'no animal');
        assert.equal(L.isKeepOutArea(area({ type: 'home', contents: { animals: { cow: 1 } }, entrances: [{ kind: 'door' }] })), false, 'a door is no gate');
    });

    test('keepOutAreas takes them; leaveText names the kind', () => {
        const yard = area({ name: 'court', type: 'building', kind: 'yard', contents: { animals: { pig: 1 } }, entrances: GATE, dimension: 'overworld' });
        assert.deepEqual(L.keepOutAreas([yard], { x: 20, y: 1, z: 20 }, 'overworld').map((a) => a.name), ['court']);
        assert.equal(L.leaveText('oak_fence', yard), 'I leave the oak_fence in the yard "court". I do not open its gate.');
        assert.equal(L.leaveText('oak_fence', { name: 'aviary', type: 'pen' }), 'I leave the oak_fence in the pen "aviary". I do not open its gate.');
    });
});
