// Tester T1 of v0.1.4.11 "Navigation and words", from the spec (section 2 and the switch rule of section 0, rule
// 15 and the rules of CLAUDE.md): every new key in settings.js and settings_spec.json, every switch off by default,
// and with a switch off the behaviour of v0.1.4.10.
//
// settings.js is the owner's live configuration (CLAUDE.md): its values are not asserted, only that each key exists
// with a valid value of its type. settings_spec.json holds the defaults in code: they are asserted exactly.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';

const settings = (await loadSrc('settings.js')).default;
const spec = JSON.parse(fs.readFileSync(repoPath('src/mindcraft/public/settings_spec.json'), 'utf8'));

// key, default, type in settings_spec.json (section 2)
const ROWS = [
    ['mine_from_inside', false, 'boolean'],
    ['area_sense', false, 'boolean'],
    ['routes_by_search', false, 'boolean'],
];

describe('section 2: the settings in settings.js', () => {
    for (const [key] of ROWS) {
        test(`${key} exists with a boolean value`, () => {
            assert.ok(Object.hasOwn(settings, key), `settings.js has no ${key}`);
            assert.equal(typeof settings[key], 'boolean', `${key}: ${JSON.stringify(settings[key])}`);
        });
    }

    test('each key is written in the style of area_floors: a quoted key, false, a comment', () => {
        const source = fs.readFileSync(repoPath('settings.js'), 'utf8');
        assert.match(source, /^\s*"area_floors":\s*(true|false),\s*\/\/ \S/m, 'the reference line of area_floors'); // the value is the owner's
        for (const [key] of ROWS) {
            assert.match(source, new RegExp(`^\\s*"${key}":\\s*(true|false),\\s*// \\S`, 'm'), `${key} as "key": true|false, // ...`);
        }
    });

    test('settings.js keeps LF line endings', () => {
        const source = fs.readFileSync(repoPath('settings.js'), 'utf8');
        assert.ok(!source.includes('\r\n'), 'CRLF in settings.js');
    });
});

describe('section 2: the settings in settings_spec.json', () => {
    for (const [key, def, type] of ROWS) {
        test(`${key}: type ${type}, default ${JSON.stringify(def)}, a description`, () => {
            const entry = spec[key];
            assert.ok(entry, `settings_spec.json has no ${key}`);
            assert.equal(entry.type, type);
            assert.deepEqual(entry.default, def);
            assert.equal(typeof entry.description, 'string');
            assert.ok(entry.description.length > 0);
        });
    }

    test('the three switches are off by default (section 2, "All off by default")', () => {
        for (const [key] of ROWS) assert.equal(spec[key]?.default, false, key);
    });

    test('the same keys as area_floors: type, description, default and nothing else', () => {
        const shape = Object.keys(spec.area_floors).sort();
        for (const [key] of ROWS) assert.deepEqual(Object.keys(spec[key] ?? {}).sort(), shape, key);
    });

    test('settings_spec.json keeps LF line endings', () => {
        const source = fs.readFileSync(repoPath('src/mindcraft/public/settings_spec.json'), 'utf8');
        assert.ok(!source.includes('\r\n'), 'CRLF in settings_spec.json');
    });
});

// ------------------------------------------------------------------------------------------------ switches off

describe('mine_from_inside off: a new mine from the surface only, as v0.1.4.10', () => {
    test('fromInsideOn reads only mine_from_inside === true', async () => {
        const W = await loadSrc('src/agent/packs/mining/mine_way.js');
        assert.equal(W.fromInsideOn({}), false);
        assert.equal(W.fromInsideOn(null), false);
        assert.equal(W.fromInsideOn({ settings: {} }), false);
        assert.equal(W.fromInsideOn({ settings: { mine_from_inside: false } }), false);
        assert.equal(W.fromInsideOn({ settings: { mine_from_inside: 'true' } }), false);
        assert.equal(W.fromInsideOn({ settings: { mine_from_inside: true } }), true);
    });

    test('tripStart inside a known mine with the switch off refuses (in_mine), with it on digs from inside', async () => {
        const L = await loadSrc('src/agent/packs/mining/mine_logic.js');
        assert.equal(L.tripStart({ mine: null, underground: true, inMine: true, fromInside: false }), 'in_mine');
        assert.equal(L.tripStart({ mine: null, underground: true, inMine: true }), 'in_mine');
        assert.equal(L.tripStart({ mine: null, underground: true, inMine: true, fromInside: true }), 'inside');
    });

    test('tripStart without inMine is as v0.1.4.10: underground, ask, new, use', async () => {
        const L = await loadSrc('src/agent/packs/mining/mine_logic.js');
        for (const fromInside of [false, true]) {
            assert.equal(L.tripStart({ mine: null, underground: true, fromInside }), 'underground');
            assert.equal(L.tripStart({ mine: null, underground: false, newMine: false, fromInside }), 'ask');
            assert.equal(L.tripStart({ mine: null, underground: false, newMine: true, fromInside }), 'new');
            assert.equal(L.tripStart({ mine: { name: 'mine' }, underground: true, inMine: true, fromInside }), 'use');
        }
    });
});

describe('area_sense off: no scan without the owner\'s sentence', () => {
    test('modes.js adds the reflex area_sense only with area_sense === true (and protected areas)', () => {
        const source = fs.readFileSync(repoPath('src/agent/modes.js'), 'utf8');
        assert.match(source, /settings\.area_sense\s*!==\s*true|settings\.area_sense\s*===\s*true|!settings\.area_sense\b/,
            'a guard on settings.area_sense');
        // the mode object is pushed into modes_map only behind that guard: one place adds it
        const adds = source.match(/modes_map\.area_sense\s*=/g) ?? [];
        assert.equal(adds.length, 1, 'one place adds the reflex');
        const guardAt = source.search(/settings\.area_sense/);
        const addAt = source.search(/modes_map\.area_sense\s*=/);
        assert.ok(guardAt >= 0 && guardAt < addAt, 'the guard comes before the add');
    });

    test('the reflex area_sense is not in the static list of the modes (it is added only with the switch)', () => {
        const source = fs.readFileSync(repoPath('src/agent/modes.js'), 'utf8');
        const listAt = source.search(/const modes_list\s*=\s*\[/);
        assert.ok(listAt >= 0, 'modes_list');
        const end = source.indexOf('];', listAt);
        const list = source.slice(listAt, end);
        assert.ok(!/area_sense_mode/.test(list), 'area_sense_mode in the static modes_list');
    });
});

describe('routes_by_search off: the legs of v0.1.4.9', () => {
    test('bySearch of the routes pack reads only routes_by_search === true', async () => {
        const P = await loadSrc('src/agent/packs/routes/index.js');
        assert.equal(P.bySearch({}), false);
        assert.equal(P.bySearch({ settings: { routes_by_search: false } }), false);
        assert.equal(P.bySearch({ settings: { routes_by_search: 1 } }), false);
        assert.equal(P.bySearch({ settings: { routes_by_search: true } }), true);
    });

    test('bySearchOn of the mining pack is false with the switch off, whatever ctx.routes holds', async () => {
        const W = await loadSrc('src/agent/packs/mining/mine_way.js');
        const routes = { waypointsOf: () => [], walkWaypoints: async () => ({ ok: true }) };
        assert.equal(W.bySearchOn({ routes }), false);
        assert.equal(W.bySearchOn({ settings: { routes_by_search: false }, routes }), false);
        assert.equal(W.bySearchOn({ settings: { routes_by_search: true }, routes }), true);
    });
});
