// Spec v0.1.4.15 part R (engineer E2): the store of the routines, src/agent/routines/routine_store.js (SPEC 3.1): the
// bind at spawn like the job store, the shape of a routine, the names (as an area name, with spaces), at most 12, the
// order the owner gave them, a corrupt file set aside.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';

const S = await loadSrc('src/agent/routines/routine_store.js');
const L = await loadSrc('src/agent/routines/routine_logic.js');

const T0 = Date.UTC(2026, 10, 10, 12, 0, 0);
const NOW = () => new Date(T0);
const routine = (name, text = 'keep the farm going', extra = {}) => ({ ...L.routineOf(name, text, { now: new Date(T0).toISOString() }), ...extra });

let dir;
let warn;
before(() => {
    dir = makeTmpDir();
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
    removeTmpDir(dir);
});

describe('SPEC 3.1: the store, bound at spawn like the job store', () => {
    test('a store without a file lives in memory; bind drops what it held and reads the file of the world', () => {
        const store = new S.RoutineStore(null, { now: NOW });
        assert.ok(store.set(routine('the farm')));
        assert.equal(store.size, 1);
        const file = path.join(dir, 'w1', S.ROUTINES_FILE);
        assert.deepEqual(store.bind(file), []); // the new world has no routines; the memory one belonged to no world
        assert.equal(store.size, 0);
        assert.ok(store.set(routine('torches', 'make torches when fewer than 32 torches')));
        assert.ok(fs.existsSync(file), 'the file is written at the bound path');
        const again = new S.RoutineStore(file, { now: NOW });
        again.load();
        assert.equal(again.get('torches')?.text, 'make torches when fewer than 32 torches');
        assert.equal(again.bind(null).length, 0, 'null makes the store live in memory only');
        assert.equal(store.bind(file).length, 1, 'back in the world its routine is there');
    });

    test('ROUTINES_FILE is routines.json; the file holds { version: 1, routines: [...] } in the order given', () => {
        assert.equal(S.ROUTINES_FILE, 'routines.json');
        const file = path.join(dir, 'w2', S.ROUTINES_FILE);
        const store = new S.RoutineStore(file, { now: NOW });
        store.set(routine('b first'));
        store.set(routine('a second'));
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.equal(data.version, 1);
        assert.deepEqual(data.routines.map(r => r.name), ['b first', 'a second']);
        assert.deepEqual(store.list().map(r => r.name), ['b first', 'a second'], 'the order the owner gave them, not the alphabet');
    });

    test('a corrupt file is set aside and the store starts empty', () => {
        const file = path.join(dir, 'w3', S.ROUTINES_FILE);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '{ not json');
        const store = new S.RoutineStore(file, { now: NOW });
        assert.deepEqual(store.load(), []);
        assert.ok(store.set(routine('the farm')), 'the store works after the corrupt file');
    });

    test('load keeps only sound rows, one per name, and keeps their updated stamp', () => {
        const file = path.join(dir, 'w4', S.ROUTINES_FILE);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ version: 1, routines: [
            { name: 'the farm', text: 'keep the farm going', updated: '2026-11-01T00:00:00.000Z', rounds: 3, state: 'paused' },
            { name: 'the farm', text: 'a double' },
            { name: '', text: 'no name' },
            { text: 'no name either' },
            { name: 'long', text: 'x'.repeat(401) },
            7,
        ] }));
        const store = new S.RoutineStore(file, { now: NOW });
        const list = store.load();
        assert.deepEqual(list.map(r => r.name), ['the farm']);
        assert.equal(list[0].updated, '2026-11-01T00:00:00.000Z');
        assert.equal(list[0].rounds, 3);
        assert.equal(list[0].state, 'paused');
    });
});

describe('SPEC 3.1: the shape of a routine', () => {
    test('set gives the record of 3.1 with every field, the defaults filled in, and a copy', () => {
        const store = new S.RoutineStore(null, { now: NOW });
        const saved = store.set({ name: 'The Farm', text: 'keep the farm going every 5 minutes' , every: 5 });
        // v0.1.4.16 (F3): `runs`, the rounds started, default 0
        assert.deepEqual(saved, {
            name: 'the farm', text: 'keep the farm going every 5 minutes', steps: null, every: 5, condition: null, state: 'active',
            rounds: 0, runs: 0, fails: 0, lastRound: null, created: new Date(T0).toISOString(), updated: new Date(T0).toISOString(),
        });
        assert.equal(store.set({ name: 'runs', text: 'x', runs: 7 }).runs, 7);
        assert.equal(store.set({ name: 'runs', text: 'x', runs: -1 }).runs, 0);
        saved.rounds = 9;
        assert.equal(store.get('the farm').rounds, 0, 'a copy');
    });

    test('the plan and the condition are kept when sound, the counts and the state too; junk is dropped', () => {
        const store = new S.RoutineStore(null, { now: NOW });
        const saved = store.set(routine('torches', 'make torches when fewer than 32 torches', {
            steps: [{ command: '!craftSupplies("torch", 32)', check: { item: 'torch', count: 32 } }, { command: '' }, { nope: 1 }, { command: '!storeItems', check: null }],
            condition: { item: 'torch', fewerThan: 32 }, state: 'paused', rounds: 4, fails: 2, lastRound: '2026-11-10T03:12:00.000Z', junk: true,
        }));
        assert.deepEqual(saved.steps, [{ command: '!craftSupplies("torch", 32)', check: { item: 'torch', count: 32 } }, { command: '!storeItems', check: { item: null, count: null } }]);
        assert.deepEqual(saved.condition, { item: 'torch', fewerThan: 32 });
        assert.equal(saved.state, 'paused');
        assert.equal(saved.rounds, 4);
        assert.equal(saved.fails, 2);
        assert.equal(saved.lastRound, '2026-11-10T03:12:00.000Z');
        assert.equal('junk' in saved, false);
        const bad = store.set(routine('odd', 'x', { every: 0, condition: { item: 'torch', fewerThan: 0 }, state: 'gone', rounds: -1, fails: 'two', steps: [] }));
        assert.equal(bad.every, 15);
        assert.equal(bad.condition, null);
        assert.equal(bad.state, 'active');
        assert.equal(bad.rounds, 0);
        assert.equal(bad.fails, 0);
        assert.equal(bad.steps, null);
    });

    test('no name, an empty text or a text over 400 characters is no routine: set gives null', () => {
        const store = new S.RoutineStore(null, { now: NOW });
        assert.equal(store.set({ name: '', text: 'x' }), null);
        assert.equal(store.set({ name: 'x', text: '' }), null);
        assert.equal(store.set({ name: 'x', text: 'y'.repeat(401) }), null);
        assert.equal(store.set({ name: 'x'.repeat(65), text: 'y' }), null);
        assert.equal(store.set(null), null);
        assert.ok(store.set({ name: 'x', text: 'y'.repeat(400) }), '400 characters are fine');
    });

    test('a name is looked up as an area name, with spaces: "The  Farm", "the_farm" and "the farm" are one routine', () => {
        const store = new S.RoutineStore(null, { now: NOW });
        store.set(routine('The  Farm'));
        assert.equal(store.get('the farm')?.name, 'the farm');
        assert.equal(store.get('the_farm')?.name, 'the farm');
        assert.equal(store.get(' THE FARM ')?.name, 'the farm');
        assert.equal(store.get('farm'), null);
        assert.equal(store.get(null), null);
        assert.equal(store.set(routine('the_farm', 'a new text')).text, 'a new text', 'the same routine, replaced in place');
        assert.equal(store.size, 1);
    });

    test('a replace keeps the place and the created stamp; remove gives true once; clear removes the file', () => {
        const file = path.join(dir, 'w5', S.ROUTINES_FILE);
        const store = new S.RoutineStore(file, { now: NOW });
        store.set(routine('a'));
        store.set(routine('b'));
        const later = new S.RoutineStore(file, { now: () => new Date(T0 + 60000) });
        later.load();
        const replaced = later.set({ ...later.get('a'), text: 'changed' });
        assert.equal(replaced.created, new Date(T0).toISOString());
        assert.equal(replaced.updated, new Date(T0 + 60000).toISOString());
        assert.deepEqual(later.list().map(r => r.name), ['a', 'b']);
        assert.equal(later.remove('a'), true);
        assert.equal(later.remove('a'), false);
        assert.deepEqual(later.list().map(r => r.name), ['b']);
        assert.equal(later.clear(), true);
        assert.equal(fs.existsSync(file), false);
        assert.equal(later.clear(), false);
    });
});

describe('SPEC 3.1: at most 12 routines', () => {
    test('the thirteenth new routine is refused (null); a known name is replaced all the same', () => {
        const store = new S.RoutineStore(null, { now: NOW });
        assert.equal(L.ROUTINE_RULES.max, 12);
        for (let i = 1; i <= 12; i++) {
            assert.ok(store.set(routine(`routine ${i}`)), `routine ${i}`);
        }
        assert.equal(store.size, 12);
        assert.equal(store.set(routine('routine 13')), null);
        assert.equal(store.size, 12);
        assert.ok(store.set(routine('routine 12', 'replaced')), 'the twelfth, replaced');
        assert.equal(store.get('routine 12').text, 'replaced');
    });

    test('a file with more than 12 rows gives the first 12', () => {
        const file = path.join(dir, 'w6', S.ROUTINES_FILE);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ version: 1, routines: Array.from({ length: 15 }, (_, i) => ({ name: `r${i}`, text: 'x' })) }));
        const store = new S.RoutineStore(file, { now: NOW });
        assert.equal(store.load().length, 12);
    });
});
