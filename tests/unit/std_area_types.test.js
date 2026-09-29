// Spec v0.1.4.8, part D: D1 (types and names), D2 (the rules table as data), D7 (replacing an area),
// I4 (AREA_TYPES) -- src/agent/areas/area_store.js.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir, listDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

const S = await loadSrc('src/agent/areas/area_store.js');

const T0 = Date.UTC(2026, 8, 29, 10, 0, 0);

// A copy of the areas file of the owner after the play test of v0.1.4.7
// (bots/claude/worlds/seed-ce66bf80acdefa75/areas.json, 2026-09-29).
const OWNER_AREAS = {
    version: 1,
    areas: {
        cow_chicken_pen: {
            name: 'cow_chicken_pen', type: 'building',
            min: { x: -10, y: 62, z: 47 }, max: { x: -10, y: 64, z: 47 },
            dimension: 'overworld', entrances: [], source: 'manual',
            created: '2026-09-28T23:21:38.859Z', updated: '2026-09-28T23:21:41.977Z',
        },
        farm: {
            name: 'farm', type: 'farm',
            min: { x: -13, y: 61, z: 23 }, max: { x: -6, y: 65, z: 34 },
            dimension: 'overworld', entrances: [{ x: -6, y: 63, z: 28, kind: 'gate' }], source: 'scan',
            created: '2026-09-28T21:41:48.717Z', updated: '2026-09-28T21:41:48.717Z',
        },
        'mining area': {
            name: 'mining area', type: 'building',
            min: { x: 6, y: 38, z: 36 }, max: { x: 12, y: 58, z: 49 },
            dimension: 'overworld', entrances: [], source: 'scan',
            created: '2026-09-28T21:46:15.137Z', updated: '2026-09-28T21:46:15.137Z',
        },
        mining_area: {
            name: 'mining_area', type: 'building',
            min: { x: 6, y: 38, z: 36 }, max: { x: 12, y: 58, z: 49 },
            dimension: 'overworld',
            entrances: [{ x: 9, y: 41, z: 43, kind: 'door' }, { x: 10, y: 41, z: 43, kind: 'door' }],
            source: 'scan',
            created: '2026-09-28T22:00:38.108Z', updated: '2026-09-28T22:00:38.108Z',
        },
    },
};

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

const newStore = () => new S.AreaStore(file, { now: () => new Date(T0) });
const writeFile = (data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));
const readFile = () => JSON.parse(fs.readFileSync(file, 'utf8'));

function area(name, type, extra = {}) {
    return { name, type, min: { x: 0, y: 60, z: 0 }, max: { x: 5, y: 65, z: 5 }, dimension: 'overworld', source: 'manual', ...extra };
}

describe('I4: AREA_TYPES', () => {
    test('exactly home, building, farm, pen, mine, frozen', () => {
        assert.deepEqual([...S.AREA_TYPES], ['home', 'building', 'farm', 'pen', 'mine']);
        assert.ok(Object.isFrozen(S.AREA_TYPES));
    });

    test('the store saves each of the five types and refuses others', () => {
        writeFile({ version: 1, areas: {} });
        const store = newStore();
        store.load();
        for (const type of S.AREA_TYPES) {
            assert.equal(store.set(area(`a_${type}`, type)).type, type);
        }
        for (const bad of ['house', 'mines', '', null, 'Home']) {
            assert.throws(() => store.set(area('bad', bad)), TypeError, String(bad));
        }
    });
});

describe('D1: names are normalised on save and on lookup', () => {
    test('normalizeAreaName: trimmed, lower case, spaces to _', () => {
        assert.equal(S.normalizeAreaName('Mining Area'), 'mining_area');
        assert.equal(S.normalizeAreaName('  Home  '), 'home');
        assert.equal(S.normalizeAreaName('cow  chicken\tpen'), 'cow_chicken_pen', 'a run of spaces is one _');
        assert.equal(S.normalizeAreaName('mining_area'), 'mining_area');
        for (const junk of [null, undefined, 42, {}]) assert.equal(S.normalizeAreaName(junk), null);
    });

    test('"Mining Area" and "mining_area" are one area: set replaces, get and remove find it', () => {
        const store = newStore();
        store.load();
        const first = store.set(area('Mining Area', 'mine'));
        assert.equal(first.name, 'mining_area');
        store.set(area('mining_area', 'mine', { max: { x: 9, y: 65, z: 9 } }));
        assert.equal(store.size, 1, 'P7: no duplicate');
        assert.equal(store.get('MINING AREA').max.x, 9);
        assert.equal(store.get(' mining area ').name, 'mining_area');
        assert.equal(store.remove('Mining Area'), true);
        assert.equal(store.size, 0);
    });

    test('a name of more than 64 characters after normalising is refused', () => {
        const store = newStore();
        store.load();
        assert.equal(store.set(area('a'.repeat(64), 'home')).name.length, 64);
        assert.throws(() => store.set(area('a'.repeat(65), 'home')), TypeError);
    });
});

describe('D1: load of the areas file of the owner', () => {
    test('farm, one mining_area of type mine (the newer, with its doors), no pen', () => {
        writeFile(OWNER_AREAS);
        const store = newStore();
        assert.equal(store.load(), 2);
        assert.deepEqual(store.list().map(a => a.name), ['farm', 'mining_area']);
        const mine = store.get('mining_area');
        assert.equal(mine.type, 'mine');
        assert.deepEqual(mine.entrances, [{ x: 9, y: 41, z: 43, kind: 'door' }, { x: 10, y: 41, z: 43, kind: 'door' }]);
        assert.equal(mine.created, '2026-09-28T22:00:38.108Z', 'the newer of the two');
        assert.equal(store.get('farm').type, 'farm');
        assert.deepEqual(store.get('farm').min, { x: -13, y: 61, z: 23 });
        assert.equal(store.get('cow_chicken_pen'), undefined);
    });

    test('each change is written to the console once', () => {
        writeFile(OWNER_AREAS);
        newStore().load();
        const lines = cap.of('log').map(r => r.text);
        assert.equal(lines.length, 3, lines.join('\n'));
        assert.ok(lines.some(l => l.includes('"mining area" and "mining_area" are the same area "mining_area". I keep the newer one, "mining_area".')), lines.join('\n'));
        assert.ok(lines.some(l => l === 'Area "mining_area" was of type building. Its name says it is a mine, so it is of type mine now.'), lines.join('\n'));
        assert.ok(lines.some(l => l === 'Area "cow_chicken_pen" is 1 x 3 x 1 blocks. An area needs at least 2 blocks in x and z, so I dropped it.'), lines.join('\n'));
    });

    test('the file is written again with the changes; a second load changes nothing and says nothing', () => {
        writeFile(OWNER_AREAS);
        newStore().load();
        const data = readFile();
        assert.equal(data.version, 1);
        assert.equal(data.migrated, 1);
        assert.deepEqual(Object.keys(data.areas), ['farm', 'mining_area']);
        assert.equal(data.areas.mining_area.type, 'mine');
        assert.deepEqual(listDir(dir), ['areas.json']);
        const before = fs.readFileSync(file, 'utf8');
        const count = cap.records.length;
        const again = newStore();
        assert.equal(again.load(), 2);
        assert.equal(cap.records.length, count, 'nothing written to the console');
        assert.equal(fs.readFileSync(file, 'utf8'), before, 'the file is not written again');
    });
});

describe('D1: the merge of doubles', () => {
    test('the newer wins also when it comes first in the file', () => {
        writeFile({ version: 1, migrated: 1, areas: {
            'Big Barn': area('Big Barn', 'building', { max: { x: 9, y: 65, z: 9 }, updated: '2026-09-02T00:00:00.000Z' }),
            big_barn: area('big_barn', 'building', { updated: '2026-09-01T00:00:00.000Z' }),
        } });
        const store = newStore();
        assert.equal(store.load(), 1);
        assert.equal(store.get('big_barn').max.x, 9);
        assert.ok(cap.of('log').some(r => r.text.includes('I keep the newer one, "Big Barn".')), cap.allText());
    });

    test('merging happens on every load, also in a file that had the one-time changes', () => {
        writeFile({ version: 1, migrated: 1, areas: { 'A B': area('A B', 'home'), a_b: area('a_b', 'home') } });
        assert.equal(newStore().load(), 1);
        assert.deepEqual(Object.keys(readFile().areas), ['a_b']);
    });
});

describe('D1: the one-time changes', () => {
    test('a building whose name holds mine or mining becomes a mine; other names and types stay', () => {
        writeFile({ version: 1, areas: {
            iron_mine: area('iron_mine', 'building'),
            mineshaft: area('mineshaft', 'building'),
            'Mining Area 2': area('Mining Area 2', 'building'),
            mine: area('mine', 'building'),
            jasmine_house: area('jasmine_house', 'building'),
            determine: area('determine', 'building'),
            mine_farm: area('mine_farm', 'farm'),
            mining_pen: area('mining_pen', 'pen'),
        } });
        const store = newStore();
        store.load();
        const types = Object.fromEntries(store.list().map(a => [a.name, a.type]));
        assert.deepEqual(types, {
            determine: 'building', iron_mine: 'mine', jasmine_house: 'building', mine: 'mine', mine_farm: 'farm',
            mineshaft: 'mine', mining_area_2: 'mine', mining_pen: 'pen',
        });
    });

    test('an area with a side of less than 2 blocks in x or z is dropped; y does not count', () => {
        writeFile({ version: 1, areas: {
            thin_x: area('thin_x', 'pen', { min: { x: 0, y: 60, z: 0 }, max: { x: 0, y: 70, z: 9 } }),
            thin_z: area('thin_z', 'home', { min: { x: 0, y: 60, z: 3 }, max: { x: 9, y: 70, z: 3 } }),
            flat: area('flat', 'farm', { min: { x: 0, y: 60, z: 0 }, max: { x: 1, y: 60, z: 1 } }),
        } });
        const store = newStore();
        assert.equal(store.load(), 1);
        assert.deepEqual(store.list().map(a => a.name), ['flat']);
    });

    test('once: in a file that had them, a thin area and a building named mine stay (the player saved them later)', () => {
        const store = newStore();
        store.load();
        store.set(area('fence_line', 'building', { min: { x: 0, y: 60, z: 0 }, max: { x: 0, y: 62, z: 9 } }));
        store.set(area('mine_house', 'building'));
        assert.equal(readFile().migrated, 1, 'every write marks the file');
        const again = newStore();
        assert.equal(again.load(), 2);
        assert.equal(again.get('fence_line').type, 'building');
        assert.equal(again.get('mine_house').type, 'building');
    });

    test('a file with nothing to change is not written on load', () => {
        writeFile({ version: 1, areas: { home: area('home', 'building') } });
        const before = fs.readFileSync(file, 'utf8');
        assert.equal(newStore().load(), 1);
        assert.equal(fs.readFileSync(file, 'utf8'), before);
        assert.equal(cap.of('log').length, 0);
    });
});

describe('areasAt and areaAt with five types', () => {
    test('areasAt: a farm first, then a mine, then the other types, each by name', () => {
        const store = newStore();
        store.load();
        for (const [name, type] of [['z_home', 'home'], ['a_pen', 'pen'], ['m_mine', 'mine'], ['f_farm', 'farm'], ['b_building', 'building']]) {
            store.set(area(name, type));
        }
        assert.deepEqual(store.areasAt({ x: 2, y: 62, z: 2 }).map(a => a.name), ['f_farm', 'm_mine', 'a_pen', 'b_building', 'z_home']);
    });

    test('areaAt: the smallest area that holds the position; null outside', () => {
        const store = newStore();
        store.load();
        store.set(area('base', 'home', { min: { x: 0, y: 60, z: 0 }, max: { x: 20, y: 70, z: 20 } }));
        store.set(area('shaft', 'mine', { min: { x: 5, y: 40, z: 5 }, max: { x: 7, y: 70, z: 7 } }));
        assert.equal(store.areaAt({ x: 6, y: 65, z: 6 }).name, 'shaft');
        assert.equal(store.areaAt({ x: 15, y: 65, z: 15 }).name, 'base');
        assert.equal(store.areaAt({ x: 50, y: 65, z: 50 }), null);
        assert.equal(store.areaAt({ x: 6, y: 65, z: 6 }, 'the_nether'), null);
    });
});

describe('D2 as data: AREA_RULES, isShelterType, isDefendedType, typeRank', () => {
    test('one row per type, as the table of the spec', () => {
        assert.deepEqual(Object.keys(S.AREA_RULES).sort(), [...S.AREA_TYPES].sort());
        assert.deepEqual({ ...S.AREA_RULES.home }, { break: 'none', place: 'none', pathDig: 'none', shelter: true, defended: true });
        assert.deepEqual({ ...S.AREA_RULES.building }, { break: 'none', place: 'none', pathDig: 'none', shelter: false, defended: true });
        assert.deepEqual({ ...S.AREA_RULES.pen }, { break: 'none', place: 'none', pathDig: 'none', shelter: false, defended: true });
        assert.deepEqual({ ...S.AREA_RULES.farm }, { break: 'crops', place: 'seeds', pathDig: 'none', shelter: false, defended: true });
        assert.deepEqual({ ...S.AREA_RULES.mine }, { break: 'natural', place: 'all', pathDig: 'natural', shelter: false, defended: false });
    });

    test('only a home is a shelter; every type but mine is defended against creepers', () => {
        assert.deepEqual(S.AREA_TYPES.filter(S.isShelterType), ['home']);
        assert.deepEqual(S.AREA_TYPES.filter(S.isDefendedType), ['home', 'building', 'farm', 'pen']);
        assert.equal(S.isShelterType('castle'), false);
        assert.equal(S.isDefendedType(undefined), false);
    });

    test('typeRank: farm 0, mine 1, the rest 2', () => {
        assert.deepEqual(S.AREA_TYPES.map(S.typeRank), [2, 2, 0, 2, 1]);
        assert.equal(S.typeRank('unknown'), 2);
    });
});

describe('D7: canReplace(old, box, byPlayer)', () => {
    const old = { name: 'pen', min: { x: -20, y: 60, z: 40 }, max: { x: 4, y: 72, z: 64 } }; // 25 x 13 x 25
    const box = (x1, y1, z1, x2, y2, z2) => ({ min: { x: x1, y: y1, z: z1 }, max: { x: x2, y: y2, z: z2 } });

    test('P4: the model may not shrink the pen to 1 x 3 x 1; the player may', () => {
        const small = box(-10, 62, 47, -10, 64, 47);
        assert.equal(S.canReplace(old, small, false), false);
        assert.equal(S.canReplace(old, small, true), true);
    });

    test('a side of less than 2 blocks in x or z: false, also for a new area; the text', () => {
        assert.equal(S.canReplace(null, box(0, 60, 0, 0, 70, 9), false), false);
        assert.equal(S.canReplace(undefined, box(0, 60, 0, 9, 70, 0), false), false);
        assert.equal(S.canReplace(null, box(0, 60, 0, 1, 60, 1), false), true, '2 x 1 x 2 is allowed');
        assert.deepEqual(S.replaceRefusal(null, box(5, 60, 0, 5, 70, 9), false), {
            reason: 'too_thin',
            text: 'The new box is only 1 block wide. An area needs at least 2 blocks in x and z. The player can type !setArea in the chat to do it.',
        });
    });

    test('less than half the volume of the old area: false, with the text of the spec', () => {
        // old: 25 * 13 * 25 = 8125. 12 x 13 x 25 = 3900 < 4062.5; 13 x 13 x 25 = 4225 >= 4062.5
        assert.equal(S.canReplace(old, box(-20, 60, 40, -9, 72, 64), false), false);
        assert.equal(S.canReplace(old, box(-20, 60, 40, -8, 72, 64), false), true);
        assert.deepEqual(S.replaceRefusal(old, box(-20, 60, 40, -9, 72, 64), false), {
            reason: 'too_small',
            text: 'The new box is much smaller than the area "pen" that I know. The player can type !setArea in the chat to do it.',
        });
        assert.equal(S.replaceRefusal(old, box(-20, 60, 40, -9, 72, 64), true), null);
    });

    test('exactly half is allowed; a bigger box and corners in any order are allowed', () => {
        const ten = { name: 'ten', min: { x: 0, y: 0, z: 0 }, max: { x: 9, y: 0, z: 1 } }; // 20
        assert.equal(S.canReplace(ten, box(0, 0, 0, 4, 0, 1), false), true, '10 of 20');
        assert.equal(S.canReplace(ten, box(0, 0, 0, 3, 0, 1), false), false, '8 of 20');
        assert.equal(S.canReplace(old, box(10, 80, 70, -30, 50, 30), false), true);
    });

    test('bad input never throws: the store refuses bad corners itself', () => {
        assert.equal(S.canReplace(old, null, false), true);
        assert.equal(S.canReplace(old, { min: null, max: { x: 1, y: 1, z: 1 } }, false), true);
        assert.equal(S.canReplace({ name: 'x', min: 5 }, box(0, 0, 0, 3, 3, 3), false), true);
    });
});
