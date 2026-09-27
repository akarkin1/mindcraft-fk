// Spec v0.1.4.3 W2: src/agent/world/world_registry.js -- WorldRegistry over <botDir>/worlds/index.json.
//
// World objects are written by hand in the shape of a resolveWorld result, so these tests do not
// depend on world_identity.js. The clock is injected through the option `now`.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const MODULE = 'src/agent/world/world_registry.js';
const R = await loadSrc(MODULE);

const T0 = Date.UTC(2026, 8, 20, 12, 0, 0);
const MINUTE = 60_000;
const iso = (ms) => new Date(ms).toISOString();

let root;
let botDir;
let cap;
let clock;
beforeEach(() => {
    root = makeTmpDir();
    botDir = path.join(root, 'andy');
    fs.mkdirSync(botDir);
    cap = captureConsole();
    clock = T0;
});
afterEach(() => {
    cap.restore();
    removeTmpDir(root);
});

function newRegistry(dir = botDir) {
    assert.equal(typeof R.WorldRegistry, 'function', 'WorldRegistry must be an exported class');
    return new R.WorldRegistry(dir, { now: () => new Date(clock) });
}

function world(key, overrides = {}) {
    return { key, source: 'seed', label: key, hashedSeedHex: key.startsWith('seed-') ? key.slice(5) : null, isHardcore: false, isFlat: false, ...overrides };
}

const A = 'seed-00000000000000aa';
const B = 'seed-00000000000000bb';
const C = 'seed-00000000000000cc';
const indexPath = () => path.join(botDir, 'worlds', 'index.json');
const readIndex = () => JSON.parse(fs.readFileSync(indexPath(), 'utf8'));
const warnings = () => cap.of('warn', 'error');

describe('load() and empty state', () => {
    test('missing file: returns 0, list() is empty, lastKey null, get() undefined', () => {
        const reg = newRegistry();
        assert.equal(reg.load(), 0);
        assert.deepEqual(reg.list(), []);
        assert.equal(reg.lastKey, null);
        assert.equal(reg.get(A), undefined);
    });

    test('worldDir(key) is `${botDir}/worlds/${key}`', () => {
        const reg = newRegistry();
        assert.equal(reg.worldDir(A), `${botDir}/worlds/${A}`);
    });

    const CORRUPT = [
        ['invalid JSON', '{"version": 1, "worlds": {'],
        ['an empty file', ''],
        ['an array', '[1, 2]'],
        ['null', 'null'],
        ['worlds is an array', JSON.stringify({ version: 1, last_key: null, worlds: [] })],
        ['worlds is a string', JSON.stringify({ version: 1, last_key: null, worlds: 'x' })],
    ];
    for (const [label, content] of CORRUPT) {
        test(`${label}: load() does not throw, returns 0 and the registry starts empty`, () => {
            fs.mkdirSync(path.dirname(indexPath()), { recursive: true });
            fs.writeFileSync(indexPath(), content);
            const reg = newRegistry();
            let count;
            assert.doesNotThrow(() => {
                count = reg.load();
            });
            assert.equal(count, 0);
            assert.deepEqual(reg.list(), []);
            assert.equal(reg.lastKey, null);
        });
    }

    test('index.json is a directory: load() does not throw, returns 0', () => {
        fs.mkdirSync(indexPath(), { recursive: true });
        const reg = newRegistry();
        assert.equal(reg.load(), 0);
    });

    test('a valid file: load() returns the number of known worlds, lastKey and get() reflect it', () => {
        const first = newRegistry();
        first.load();
        first.visit(world(A));
        clock += MINUTE;
        first.visit(world(B));
        const second = newRegistry();
        assert.equal(second.load(), 2);
        assert.equal(second.lastKey, B);
        assert.equal(second.get(A).visits, 1);
    });
});

describe('visit(world, observed): new entry', () => {
    test('creates the entry with all fields, writes the file, isNew and changedWorld true, no warnings', () => {
        const reg = newRegistry();
        reg.load();
        const w = world(A, { label: 'Alpha Server', isHardcore: true, isFlat: false });
        const result = reg.visit(w, { age: 1200 });
        const expected = {
            key: A,
            label: 'Alpha Server',
            label_source: 'auto',
            source: 'seed',
            hashed_seed: '00000000000000aa',
            first_seen: iso(T0),
            last_seen: iso(T0),
            visits: 1,
            is_hardcore: true,
            is_flat: false,
            last_age: 1200,
        };
        assert.equal(result.isNew, true);
        assert.equal(result.changedWorld, true);
        assert.deepEqual(result.warnings, []);
        assert.deepEqual(result.entry, expected);
        assert.deepEqual(reg.get(A), expected);
        assert.deepEqual(readIndex(), { version: 1, last_key: A, worlds: { [A]: expected } });
        assert.equal(reg.lastKey, A);
    });

    for (const [label, observed] of [['no observed argument', undefined], ['observed {}', {}], ['age NaN', { age: NaN }], ['age Infinity', { age: Infinity }], ['age as string', { age: '100' }], ['age null', { age: null }]]) {
        test(`${label}: last_age is null`, () => {
            const reg = newRegistry();
            reg.load();
            const result = observed === undefined ? reg.visit(world(A)) : reg.visit(world(A), observed);
            assert.equal(result.entry.last_age, null);
        });
    }

    test('source "fallback" and hashed_seed null are stored as given', () => {
        const reg = newRegistry();
        reg.load();
        const key = 'motd-0123456789abcdef';
        const result = reg.visit(world(key, { source: 'fallback', label: 'Srv', hashedSeedHex: null, isHardcore: null, isFlat: null }));
        assert.equal(result.entry.source, 'fallback');
        assert.equal(result.entry.hashed_seed, null);
        assert.equal(result.entry.is_hardcore, null);
        assert.equal(result.entry.is_flat, null);
    });
});

describe('visit(world, observed): existing entry', () => {
    test('same world again: visits +1, last_seen now, first_seen kept, isNew false, changedWorld false, no warnings', () => {
        const reg = newRegistry();
        reg.load();
        reg.visit(world(A, { label: 'Alpha' }), { age: 100 });
        clock += 5 * MINUTE;
        const result = reg.visit(world(A, { label: 'Alpha' }), { age: 200 });
        assert.equal(result.isNew, false);
        assert.equal(result.changedWorld, false);
        assert.deepEqual(result.warnings, []);
        assert.equal(result.entry.visits, 2);
        assert.equal(result.entry.first_seen, iso(T0));
        assert.equal(result.entry.last_seen, iso(T0 + 5 * MINUTE));
        assert.equal(result.entry.last_age, 200);
        assert.equal(readIndex().worlds[A].visits, 2);
    });

    test('changedWorld: A, then B, then A again -> true, true, true; A again -> false', () => {
        const reg = newRegistry();
        reg.load();
        assert.equal(reg.visit(world(A)).changedWorld, true);
        assert.equal(reg.visit(world(B)).changedWorld, true);
        const back = reg.visit(world(A));
        assert.equal(back.changedWorld, true);
        assert.equal(back.isNew, false);
        assert.equal(reg.visit(world(A)).changedWorld, false);
        assert.equal(reg.lastKey, A);
    });

    test('changedWorld uses last_key of the file after a restart', () => {
        const first = newRegistry();
        first.load();
        first.visit(world(A));
        const second = newRegistry();
        second.load();
        assert.equal(second.visit(world(A)).changedWorld, false);
        const third = newRegistry();
        third.load();
        assert.equal(third.visit(world(B)).changedWorld, true);
    });

    test('auto label that changed: warning with both labels and the word world, label replaced', () => {
        const reg = newRegistry();
        reg.load();
        reg.visit(world(A, { label: 'Old MOTD' }));
        const result = reg.visit(world(A, { label: 'New MOTD' }));
        assert.equal(result.warnings.length, 1);
        const w = result.warnings[0];
        assert.equal(typeof w, 'string');
        assert.match(w, /world/i);
        assert.ok(w.includes('Old MOTD') && w.includes('New MOTD'), w);
        assert.equal(result.entry.label, 'New MOTD');
        assert.equal(result.entry.label_source, 'auto');
        assert.equal(readIndex().worlds[A].label, 'New MOTD');
    });

    test('world label equal to its key: no warning, stored label kept', () => {
        const reg = newRegistry();
        reg.load();
        reg.visit(world(A, { label: 'Alpha' }));
        const result = reg.visit(world(A, { label: A }));
        assert.deepEqual(result.warnings, []);
        assert.equal(result.entry.label, 'Alpha');
    });

    test('manual label is never replaced and gives no warning', () => {
        const reg = newRegistry();
        reg.load();
        reg.visit(world(A, { label: 'Alpha' }));
        assert.equal(reg.setLabel(A, 'Home'), true);
        const result = reg.visit(world(A, { label: 'Something else' }));
        assert.deepEqual(result.warnings, []);
        assert.equal(result.entry.label, 'Home');
        assert.equal(result.entry.label_source, 'manual');
    });

    test('observed age smaller than last_age: warning with "age" and "world", last_age updated', () => {
        const reg = newRegistry();
        reg.load();
        reg.visit(world(A), { age: 5000 });
        const result = reg.visit(world(A), { age: 100 });
        assert.equal(result.warnings.length, 1);
        assert.match(result.warnings[0], /\bage\b/);
        assert.match(result.warnings[0], /world/i);
        assert.equal(result.entry.last_age, 100);
    });

    test('observed age equal or larger: no warning, last_age updated', () => {
        const reg = newRegistry();
        reg.load();
        reg.visit(world(A), { age: 5000 });
        assert.deepEqual(reg.visit(world(A), { age: 5000 }).warnings, []);
        const result = reg.visit(world(A), { age: 9000 });
        assert.deepEqual(result.warnings, []);
        assert.equal(result.entry.last_age, 9000);
    });

    test('age not observed: no warning, last_age kept', () => {
        const reg = newRegistry();
        reg.load();
        reg.visit(world(A), { age: 5000 });
        const result = reg.visit(world(A), {});
        assert.deepEqual(result.warnings, []);
        assert.equal(result.entry.last_age, 5000);
    });

    test('stored last_age null and an age is observed: no warning, last_age set', () => {
        const reg = newRegistry();
        reg.load();
        reg.visit(world(A));
        const result = reg.visit(world(A), { age: 10 });
        assert.deepEqual(result.warnings, []);
        assert.equal(result.entry.last_age, 10);
    });

    for (const [field, prop] of [['is_hardcore', 'isHardcore'], ['is_flat', 'isFlat']]) {
        test(`${field} stored false, observed true: warning with "world", stored value replaced`, () => {
            const reg = newRegistry();
            reg.load();
            reg.visit(world(A, { [prop]: false }));
            const result = reg.visit(world(A, { [prop]: true }));
            assert.equal(result.warnings.length, 1);
            assert.match(result.warnings[0], /world/i);
            assert.equal(result.entry[field], true);
            assert.equal(readIndex().worlds[A][field], true);
        });

        test(`${field} stored true, observed null: no warning`, () => {
            const reg = newRegistry();
            reg.load();
            reg.visit(world(A, { [prop]: true }));
            assert.deepEqual(reg.visit(world(A, { [prop]: null })).warnings, []);
        });
    }

    test('several changes at once: label, age and flags each give a warning, all values updated', () => {
        const reg = newRegistry();
        reg.load();
        reg.visit(world(A, { label: 'One', isHardcore: false, isFlat: true }), { age: 900 });
        const result = reg.visit(world(A, { label: 'Two', isHardcore: true, isFlat: false }), { age: 10 });
        assert.ok(result.warnings.length >= 3, JSON.stringify(result.warnings));
        for (const w of result.warnings) assert.match(w, /world/i);
        assert.ok(result.warnings.some((w) => w.includes('One') && w.includes('Two')));
        assert.ok(result.warnings.some((w) => /\bage\b/.test(w)));
        assert.deepEqual(
            [result.entry.label, result.entry.last_age, result.entry.is_hardcore, result.entry.is_flat],
            ['Two', 10, true, false],
        );
    });
});

describe('visit(): write failure', () => {
    test('worlds is a file: no throw, console.warn, in-memory state updated', () => {
        fs.writeFileSync(path.join(botDir, 'worlds'), 'not a directory');
        const reg = newRegistry();
        reg.load();
        let result;
        assert.doesNotThrow(() => {
            result = reg.visit(world(A, { label: 'Alpha' }));
        });
        assert.equal(result.isNew, true);
        assert.ok(cap.of('warn').length >= 1, 'a console.warn is logged');
        assert.equal(reg.get(A).visits, 1);
        assert.equal(reg.lastKey, A);
        assert.equal(fs.readFileSync(path.join(botDir, 'worlds'), 'utf8'), 'not a directory');
    });
});

describe('setLabel(key, label)', () => {
    test('known key: true, label trimmed, label_source manual, file written', () => {
        const reg = newRegistry();
        reg.load();
        reg.visit(world(A, { label: 'Alpha' }));
        assert.equal(reg.setLabel(A, '  My Base  '), true);
        assert.equal(reg.get(A).label, 'My Base');
        assert.equal(reg.get(A).label_source, 'manual');
        const again = newRegistry();
        again.load();
        assert.equal(again.get(A).label, 'My Base');
        assert.equal(again.get(A).label_source, 'manual');
    });

    test('label cut to 80 characters', () => {
        const reg = newRegistry();
        reg.load();
        reg.visit(world(A));
        assert.equal(reg.setLabel(A, 'L'.repeat(81)), true);
        assert.equal(reg.get(A).label, 'L'.repeat(80));
    });

    test('unknown key: false, nothing changes, no file written', () => {
        const reg = newRegistry();
        reg.load();
        assert.equal(reg.setLabel(A, 'Home'), false);
        assert.equal(reg.get(A), undefined);
        assert.equal(fs.existsSync(indexPath()), false);
    });

    for (const [label, value] of [['empty', ''], ['blank', '   ']]) {
        test(`${label} label: false, stored label unchanged`, () => {
            const reg = newRegistry();
            reg.load();
            reg.visit(world(A, { label: 'Alpha' }));
            const before = fs.readFileSync(indexPath(), 'utf8');
            assert.equal(reg.setLabel(A, value), false);
            assert.equal(reg.get(A).label, 'Alpha');
            assert.equal(reg.get(A).label_source, 'auto');
            assert.equal(fs.readFileSync(indexPath(), 'utf8'), before);
        });
    }
});

describe('list()', () => {
    test('all entries sorted by last_seen descending', () => {
        const reg = newRegistry();
        reg.load();
        reg.visit(world(A));
        clock += MINUTE;
        reg.visit(world(B));
        clock += MINUTE;
        reg.visit(world(C));
        clock += MINUTE;
        reg.visit(world(A));
        assert.deepEqual(reg.list().map((e) => e.key), [A, C, B]);
    });
});

describe('module rules', () => {
    test('imports only node built-ins and project files, nothing from mineflayer or src/models', () => {
        assertImportRules(MODULE);
    });

    test('importing the module prints nothing and creates no files', () => {
        assertCleanImport(MODULE);
    });
});
