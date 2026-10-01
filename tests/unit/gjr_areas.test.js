// Spec v0.1.4.10 part R (engineer E3), R2 and R3 on the areas and the rules:
//   - R2 areaFlagOf of src/agent/rules/rule_logic.js, and AreaStore.setFlag (the flag no_enter is kept
//     in the file, a new box keeps it, an unknown flag or area gives null);
//   - R3 scanBuilding with floors: true on a house over a basement: two areas, the trapdoor an
//     entrance; without floors the old scan; sameBox and its text.
// The stores live in a temp directory, never under bots/.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';

const R = await loadSrc('src/agent/rules/rule_logic.js');
const S = await loadSrc('src/agent/areas/area_store.js');
const A = await loadSrc('src/agent/areas/area_scan.js');

// ------------------------------------------------------------------------------- R2 the rule

describe('R2: areaFlagOf', () => {
    const names = ['home', 'pen', 'chicken_pen', 'farm'];

    test('the five phrases, case free, name the area', () => {
        for (const rule of ['never enter the chicken pen', "Don't enter the chicken pen.", 'Do NOT enter the Chicken Pen',
            'stay out of the chicken pen', 'Keep out of the chicken_pen!', 'Don’t enter the chicken pen']) {
            assert.deepEqual(R.areaFlagOf(rule, names), { area: 'chicken_pen', flag: 'no_enter' }, rule);
        }
    });

    test('any word of the name: "the chickens\' pen" is not "chicken", "the pen" is the pen', () => {
        assert.deepEqual(R.areaFlagOf('never enter the pen', names), { area: 'pen', flag: 'no_enter' });
        assert.deepEqual(R.areaFlagOf('never enter the chicken house', names), { area: 'chicken_pen', flag: 'no_enter' });
        assert.deepEqual(R.areaFlagOf('keep out of the farm', ['Wheat Farm']), { area: 'Wheat Farm', flag: 'no_enter' });
    });

    test('null without a phrase, without an area, for bad input', () => {
        assert.equal(R.areaFlagOf('never break the chicken pen', names), null);
        assert.equal(R.areaFlagOf('always enter the chicken pen', names), null);
        assert.equal(R.areaFlagOf('never enter the nether', names), null);
        assert.equal(R.areaFlagOf('stay outside', names), null, '"stay out" is a phrase of whole words');
        assert.equal(R.areaFlagOf(null, names), null);
        assert.equal(R.areaFlagOf('never enter the pen', null), null);
        assert.equal(R.areaFlagOf('never enter the pen', [null, 5]), null);
    });
});

// ------------------------------------------------------------------------------- R2 the store

const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
let dir;
let file;
let cap;
beforeEach(() => {
    dir = makeTmpDir();
    file = path.join(dir, 'areas.json');
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

function store() {
    const s = new S.AreaStore(file, { now: () => new Date(T0) });
    s.load();
    return s;
}

const PEN = { name: 'Chicken Pen', type: 'pen', min: { x: 10, y: 62, z: 10 }, max: { x: 20, y: 66, z: 20 } };

describe('R2: AreaStore.setFlag', () => {
    test('sets no_enter, writes it, reads it back; false clears it', () => {
        const s = store();
        s.set(PEN);
        assert.equal(s.get('chicken_pen').flags, undefined, 'no flags: no field, as before');
        const area = s.setFlag('chicken pen', 'no_enter', true);
        assert.deepEqual(area.flags, { no_enter: true });
        const json = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.deepEqual(json.areas.chicken_pen.flags, { no_enter: true });
        assert.deepEqual(store().get('chicken_pen').flags, { no_enter: true }, 'after a load');
        assert.equal(store().setFlag('chicken_pen', 'no_enter', false).flags, undefined);
        assert.equal(store().get('chicken_pen').flags, undefined);
    });

    test('a new box for the area keeps the flag; the list carries it', () => {
        const s = store();
        s.set(PEN);
        s.setFlag('chicken_pen', 'no_enter', true);
        s.set({ ...PEN, max: { x: 22, y: 66, z: 22 } });
        assert.deepEqual(s.get('chicken_pen').flags, { no_enter: true });
        assert.deepEqual(s.list()[0].flags, { no_enter: true });
        const copy = s.get('chicken_pen');
        copy.flags.no_enter = false;
        assert.equal(s.get('chicken_pen').flags.no_enter, true, 'a copy');
    });

    test('an unknown area or flag: null, nothing written', () => {
        const s = store();
        s.set(PEN);
        const before = fs.readFileSync(file, 'utf8');
        assert.equal(s.setFlag('barn', 'no_enter', true), null);
        assert.equal(s.setFlag('chicken_pen', 'no_break', true), null);
        assert.equal(fs.readFileSync(file, 'utf8'), before);
    });

    test('unknown flags in the file are dropped on load', () => {
        fs.writeFileSync(file, JSON.stringify({ version: 1, migrated: 1, areas: { pen: { ...PEN, name: 'pen', flags: { no_enter: true, fly: true } } } }));
        assert.deepEqual(store().get('pen').flags, { no_enter: true });
    });

    test('an entrance of kind trapdoor is kept', () => {
        const s = store();
        s.set({ ...PEN, entrances: [{ x: 12, y: 62, z: 12, kind: 'trapdoor' }, { x: 13, y: 62, z: 12, kind: 'hatch' }] });
        assert.deepEqual(s.get('chicken_pen').entrances, [{ x: 12, y: 62, z: 12, kind: 'trapdoor' }]);
        assert.ok(S.ENTRANCE_KINDS.includes('trapdoor'));
    });
});

// ------------------------------------------------------------------------------- R3 the floors

// A house over a basement. The ground is stone to y 59. The house: floor planks at y 60 (x 0..8,
// z 0..8), walls of planks y 61..64, roof planks at y 65, the door at (4, 61, 0). The basement:
// floor y 55, room x 1..7, y 56..59, z 1..7 in the stone, the ceiling the floor of the house. A
// ladder (2, 56..59, 2) under a trapdoor at (2, 60, 2).
function twoFloors() {
    const w = createBlockWorld();
    w.fill(-6, 40, -6, 14, 59, 14, 'stone');
    w.fill(0, 60, 0, 8, 65, 8, 'oak_planks');
    w.fill(1, 61, 1, 7, 64, 7, 'air');
    w.set(4, 61, 0, 'oak_door').set(4, 62, 0, 'oak_door');
    w.fill(1, 56, 1, 7, 59, 7, 'air');
    w.fill(2, 56, 2, 2, 59, 2, 'ladder');
    w.set(2, 60, 2, 'oak_trapdoor');
    w.set(6, 61, 6, 'red_bed').set(6, 56, 6, 'chest');
    return w;
}
const boxOf = (r) => ({ min: r.min, max: r.max });
const box = (x0, y0, z0, x1, y1, z1) => ({ min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } });

describe('R3: scanBuilding with floors', () => {
    test('upstairs: the house floor only, the door and the trapdoor its entrances', () => {
        const w = twoFloors();
        const r = A.scanBuilding(w.getBlockName, { x: 4.5, y: 61, z: 4.5 }, { floors: true });
        assert.equal(r.found, true);
        assert.equal(r.floor, true);
        assert.deepEqual(boxOf(r), box(0, 60, 0, 8, 65, 8));
        assert.deepEqual(r.entrances, [{ x: 2, y: 60, z: 2, kind: 'trapdoor' }, { x: 4, y: 61, z: 0, kind: 'door' }]);
        assert.equal(r.blocks, 7 * 7 - 1, 'the cells of the floor without the trapdoor; on the bed is a step of 1');
    });

    test('below: the basement, a second box; the trapdoor at the top of the ladder its entrance', () => {
        const w = twoFloors();
        const r = A.scanBuilding(w.getBlockName, { x: 5.5, y: 56, z: 5.5 }, { floors: true });
        assert.equal(r.found, true);
        assert.deepEqual(boxOf(r), box(0, 55, 0, 8, 60, 8));
        assert.deepEqual(r.entrances, [{ x: 2, y: 60, z: 2, kind: 'trapdoor' }]);
    });

    test('on the ladder or on the trapdoor: a floor next to it', () => {
        const w = twoFloors();
        assert.deepEqual(boxOf(A.scanBuilding(w.getBlockName, { x: 2.5, y: 61, z: 2.5 }, { floors: true })), box(0, 60, 0, 8, 65, 8));
        assert.deepEqual(boxOf(A.scanBuilding(w.getBlockName, { x: 2.5, y: 57, z: 2.5 }, { floors: true })), box(0, 55, 0, 8, 60, 8));
    });

    test('a step up of 1 is the same floor, a stair of 2 is not', () => {
        const w = twoFloors();
        w.fill(5, 61, 1, 7, 61, 3, 'oak_planks'); // a raised corner of 1 block: 9 cells one higher
        w.fill(1, 61, 5, 2, 62, 7, 'oak_planks'); // a block of 2: 6 cells two higher
        const r = A.scanBuilding(w.getBlockName, { x: 2.5, y: 61, z: 2.5 + 1 }, { floors: true });
        assert.deepEqual(boxOf(r), box(0, 60, 0, 8, 65, 8));
        assert.equal(r.blocks, 7 * 7 - 1 - 6, 'the raised corner counts, the block of 2 does not');
    });

    test('without floors: the scan of v0.1.4.9, unchanged, both floors in one box', () => {
        const w = twoFloors();
        const plain = A.scanBuilding(w.getBlockName, { x: 4.5, y: 61, z: 4.5 });
        const off = A.scanBuilding(w.getBlockName, { x: 4.5, y: 61, z: 4.5 }, { floors: false });
        assert.deepEqual(off, plain);
        assert.equal('floor' in plain, false, 'no new field');
        assert.ok(plain.min.y < 60, 'the old box reaches into the basement');
    });

    test('outside under the sky: no floor, the old scan with floor false', () => {
        const w = twoFloors();
        const r = A.scanBuilding(w.getBlockName, { x: 4.5, y: 60, z: -3.5 }, { floors: true });
        const plain = A.scanBuilding(w.getBlockName, { x: 4.5, y: 60, z: -3.5 });
        assert.equal(r.floor, false);
        assert.deepEqual({ ...r, floor: undefined }, { ...plain, floor: undefined });
    });

    test('a roofed floor open to the limits is no floor of a building', () => {
        const w = createBlockWorld();
        w.fill(-40, 59, -40, 40, 59, 40, 'stone');
        w.fill(-40, 64, -40, 40, 64, 40, 'oak_leaves');
        const r = A.scanBuilding(w.getBlockName, { x: 0.5, y: 60, z: 0.5 }, { floors: true, radius: 8 });
        assert.equal(r.floor, false);
    });
});

describe('R3: sameBox', () => {
    test('the area with that box, in that dimension, else null; the text', () => {
        const s = store();
        s.set({ name: 'home', type: 'home', min: { x: 0, y: 60, z: 0 }, max: { x: 8, y: 65, z: 8 } });
        s.set({ name: 'basement', type: 'home', min: { x: 0, y: 55, z: 0 }, max: { x: 8, y: 60, z: 8 } });
        assert.equal(S.sameBox(s, box(0, 60, 0, 8, 65, 8))?.name, 'home');
        assert.equal(S.sameBox(s, box(8, 65, 8, 0.5, 60.2, 0))?.name, 'home', 'corners in any order, floored');
        assert.equal(S.sameBox(s, { ...box(0, 60, 0, 8, 65, 8), dimension: 'the_nether' }), null);
        assert.equal(S.sameBox(s, box(0, 60, 0, 8, 64, 8)), null);
        assert.equal(S.sameBox(null, box(0, 60, 0, 8, 65, 8)), null);
        assert.equal(S.sameBox(s, null), null);
        assert.equal(S.sameBoxText('home'), 'That is the area "home" already.');
    });
});
