// Tester T1 of v0.1.4.10 "Goals", from the spec (I6, R2 and R3, section 7) and the handoff of part R:
//   R2 areaFlagOf and AreaStore.setFlag; R3 scanBuilding with floors (the house and the basement are two areas),
//   the old scan without it, and sameBox. Stores on a temp folder under os.tmpdir().
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';

const R = await loadSrc('src/agent/rules/rule_logic.js');
const A = await loadSrc('src/agent/areas/area_store.js');
const SC = await loadSrc('src/agent/areas/area_scan.js');

let dir;
let cap;
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gj-areas-'));
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
    fs.rmSync(dir, { recursive: true, force: true });
});

function box(name, type, min, max, extra = {}) {
    return { name, type, min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] }, dimension: 'overworld', ...extra };
}

// ------------------------------------------------------------------------------------------------------- R2

describe('R2: areaFlagOf', () => {
    const NAMES = ['home', 'chicken pen'];

    test('every keep-out phrase, case free, with a name of the area', () => {
        for (const rule of ['never enter the chicken pen', "don't enter the chicken pen", 'Do not enter the chicken pen',
            'stay out of the chicken pen', 'KEEP OUT of the chicken pen', 'Never Enter The Chicken Pen please']) {
            assert.deepEqual(R.areaFlagOf(rule, NAMES), { area: 'chicken pen', flag: 'no_enter' }, rule);
        }
    });

    test('any word of the name names the area; the store names with underscores too', () => {
        assert.deepEqual(R.areaFlagOf('stay out of the chickens and the chicken coop', ['home', 'chicken_pen']), { area: 'chicken_pen', flag: 'no_enter' });
        assert.deepEqual(R.areaFlagOf('never enter the pen', ['home', 'chicken_pen']), { area: 'chicken_pen', flag: 'no_enter' });
    });

    test('null without a keep-out phrase or without a named area', () => {
        assert.equal(R.areaFlagOf('always close the door of the chicken pen', NAMES), null);
        assert.equal(R.areaFlagOf('never enter the barn', NAMES), null);
        assert.equal(R.areaFlagOf('never enter the barn', []), null);
        assert.equal(R.areaFlagOf(null, NAMES), null);
    });
});

describe('R2: AreaStore.setFlag', () => {
    test('sets no_enter on an area and keeps it in the file', () => {
        const file = path.join(dir, 'areas.json');
        const store = new A.AreaStore(file);
        store.load();
        store.set(box('chicken pen', 'pen', [10, 62, 10], [20, 67, 20]));
        const flagged = store.setFlag('chicken_pen', 'no_enter', true);
        assert.equal(flagged?.flags?.no_enter, true);
        const again = new A.AreaStore(file);
        again.load();
        assert.equal(again.get('chicken_pen').flags?.no_enter, true);
        assert.equal(again.setFlag('barn', 'no_enter', true), null, 'no such area');
    });
});

// ------------------------------------------------------------------------------------------------------- R3

// The base: stone up to y 59, grass at y 60 outside. The house: a floor of planks at y 60 (x -1..7, z -1..7),
// walls of planks y 61..64 on its edge, a roof at y 65, a door at (3, 61..62, -1). The basement: air y 53..55 at
// x 0..6, z 0..6 in the stone. A ladder from (1, 53, 1) to (1, 59, 1) facing south, the trapdoor (1, 60, 1).
function houseWorld() {
    return (x, y, z) => {
        const inHouse = x >= -1 && x <= 7 && z >= -1 && z <= 7;
        if (x === 1 && z === 1 && y >= 53 && y <= 59) return 'ladder';
        if (x === 1 && z === 1 && y === 60) return 'oak_trapdoor';
        if (x === 3 && z === -1 && (y === 61 || y === 62)) return 'oak_door';
        if (x >= 0 && x <= 6 && z >= 0 && z <= 6 && y >= 53 && y <= 55) return 'air';
        if (y < 60) return 'stone';
        if (y === 60) return inHouse ? 'oak_planks' : 'grass_block';
        if (inHouse) {
            if (y === 65) return 'oak_planks';
            if (y <= 64 && (x === -1 || x === 7 || z === -1 || z === 7)) return 'oak_planks';
        }
        return 'air';
    };
}

describe('R3: scanBuilding with floors', () => {
    test('upstairs: the house floor only, y 60 to 65, with the door and the trapdoor as entrances', () => {
        const scan = SC.scanBuilding(houseWorld(), { x: 3.5, y: 61, z: 3.5 }, { floors: true });
        assert.equal(scan.found, true);
        assert.equal(scan.floor, true);
        assert.equal(scan.min.y, 60, 'from the floor');
        assert.equal(scan.max.y, 65, 'to the roof');
        assert.ok(scan.min.x <= -1 && scan.max.x >= 7 && scan.min.z <= -1 && scan.max.z >= 7, JSON.stringify([scan.min, scan.max]));
        const kinds = scan.entrances.map((e) => `${e.kind}@${e.x},${e.y},${e.z}`);
        assert.ok(kinds.includes('trapdoor@1,60,1'), kinds.join(' '));
        assert.ok(scan.entrances.some((e) => e.kind === 'door' && e.x === 3 && e.z === -1), kinds.join(' '));
    });

    test('the basement: a second box below the house floor, with the trapdoor as entrance', () => {
        const up = SC.scanBuilding(houseWorld(), { x: 3.5, y: 61, z: 3.5 }, { floors: true });
        const down = SC.scanBuilding(houseWorld(), { x: 3.5, y: 53, z: 3.5 }, { floors: true });
        assert.equal(down.found, true);
        assert.equal(down.floor, true);
        assert.ok(down.min.y <= 53 && down.max.y < 60, JSON.stringify([down.min, down.max]));
        assert.ok(down.max.y < up.min.y || down.max.y <= up.min.y, 'two floors, not one box');
        assert.ok(down.entrances.some((e) => e.kind === 'trapdoor' && e.x === 1 && e.y === 60 && e.z === 1),
            down.entrances.map((e) => `${e.kind}@${e.x},${e.y},${e.z}`).join(' '));
    });

    test('trapdoor is an entrance kind of the store', () => {
        assert.ok(A.ENTRANCE_KINDS.includes('trapdoor'));
    });
});

describe('R3: area_floors off, the old scan', () => {
    test('without floors (and with floors false) the scan is the old one: no floor field, the same box', () => {
        const origin = { x: 3.5, y: 61, z: 3.5 };
        const old = SC.scanBuilding(houseWorld(), origin);
        const off = SC.scanBuilding(houseWorld(), origin, { floors: false });
        assert.deepEqual(off, old);
        assert.equal('floor' in old, false);
    });
});

describe('R3: sameBox', () => {
    test('a box equal to the box of an area gives that area; the text', () => {
        const store = new A.AreaStore(path.join(dir, 'areas.json'));
        store.load();
        store.set(box('home', 'home', [-1, 60, -1], [7, 65, 7]));
        store.set(box('basement', 'home', [-1, 52, -1], [7, 56, 7]));
        assert.equal(A.sameBox(store, { min: { x: -1, y: 60, z: -1 }, max: { x: 7, y: 65, z: 7 }, dimension: 'overworld' })?.name, 'home');
        assert.equal(A.sameBox(store, { min: { x: -1, y: 60, z: -1 }, max: { x: 7, y: 65, z: 7 } })?.name, 'home', 'the overworld by default');
        assert.equal(A.sameBox(store, { min: { x: -1, y: 60, z: -1 }, max: { x: 7, y: 66, z: 7 } }), null);
        assert.equal(A.sameBox(store, { min: { x: -1, y: 60, z: -1 }, max: { x: 7, y: 65, z: 7 }, dimension: 'the_nether' }), null);
        assert.equal(A.sameBoxText('home'), 'That is the area "home" already.');
    });
});
