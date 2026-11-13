// Spec v0.1.4.16, 8.1 (E6): the store of the stock permits (src/agent/world/stock_permits.js): the file
// { version: 1, items: { wheat: { allowed: true, at: <ms> } } }, may, allowedAt, set, list, entry; the names normalised; a
// corrupt file set aside; the texts of !allowTaking word for word.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

const P = await loadSrc('src/agent/world/stock_permits.js');

const T0 = Date.UTC(2026, 10, 13, 12, 0, 0);

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

const file = () => path.join(dir, P.PERMITS_FILE);
const warnings = () => cap.of('warn').map((r) => r.text);

function store(options = {}) {
    const s = new P.StockPermits(file(), { now: () => T0, ...options });
    s.load();
    return s;
}

describe('StockPermits: an empty store', () => {
    test('a missing file: nothing allowed, nothing decided, no file written', () => {
        const s = store();
        assert.equal(s.load(), 0);
        assert.equal(s.may('wheat'), false);
        assert.equal(s.allowedAt('wheat'), 0);
        assert.equal(s.entry('wheat'), null);
        assert.deepEqual(s.list(), []);
        assert.equal(s.size, 0);
        assert.equal(fs.existsSync(file()), false);
        assert.equal(P.PERMITS_FILE, 'permits.json');
    });
});

describe('StockPermits: set, may, allowedAt, entry, list', () => {
    test('a yes is remembered with its time and written as the spec gives the file', () => {
        const s = store();
        assert.deepEqual(s.set('wheat', true), { item: 'wheat', allowed: true, at: T0 });
        assert.equal(s.may('wheat'), true);
        assert.equal(s.allowedAt('wheat'), T0);
        assert.deepEqual(s.entry('wheat'), { item: 'wheat', allowed: true, at: T0 });
        assert.deepEqual(JSON.parse(fs.readFileSync(file(), 'utf8')), { version: 1, items: { wheat: { allowed: true, at: T0 } } });
    });

    test('a no is remembered too: may false, allowedAt 0, the entry says no', () => {
        const s = store();
        s.set('wheat', true);
        const later = new P.StockPermits(file(), { now: () => new Date(T0 + 5000) });
        later.load();
        assert.deepEqual(later.set('wheat', false), { item: 'wheat', allowed: false, at: T0 + 5000 });
        assert.equal(later.may('wheat'), false);
        assert.equal(later.allowedAt('wheat'), 0, 'forbidden since');
        assert.deepEqual(later.entry('wheat'), { item: 'wheat', allowed: false, at: T0 + 5000 });
        assert.equal(later.size, 1);
    });

    test('the names: trimmed, lower case, without minecraft:', () => {
        const s = store();
        s.set(' minecraft:Lapis_Lazuli ', true);
        assert.equal(s.may('lapis_lazuli'), true);
        assert.equal(s.may('minecraft:lapis_lazuli'), true);
        assert.equal(s.allowedAt('LAPIS_LAZULI'), T0);
        assert.equal(P.normalizeItemName(' minecraft:Wheat '), 'wheat');
        assert.equal(P.normalizeItemName(''), null);
        assert.equal(P.normalizeItemName(7), null);
        assert.equal(P.normalizeItemName('x'.repeat(65)), null);
    });

    test('set refuses a bad name or a value that is not a boolean, and changes nothing', () => {
        const s = store();
        assert.equal(s.set('', true), null);
        assert.equal(s.set(null, true), null);
        assert.equal(s.set('wheat', 'yes'), null);
        assert.equal(s.set('wheat', 1), null);
        assert.equal(s.size, 0);
        assert.equal(fs.existsSync(file()), false);
    });

    test('list: every permit by name, copies', () => {
        const s = store();
        s.set('wheat', true);
        s.set('carrot', false);
        s.set('lapis_lazuli', true);
        const list = s.list();
        assert.deepEqual(list.map((e) => e.item), ['carrot', 'lapis_lazuli', 'wheat']);
        list[0].allowed = true;
        assert.equal(s.may('carrot'), false, 'a copy');
        const entry = s.entry('wheat');
        entry.allowed = false;
        assert.equal(s.may('wheat'), true, 'a copy');
    });

    test('a new store reads the file back; entries without a boolean or with a bad name are skipped', () => {
        const s = store();
        s.set('wheat', true);
        s.set('carrot', false);
        const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
        raw.items.bone_meal = { allowed: 'yes', at: 1 };
        raw.items[''] = { allowed: true, at: 1 };
        raw.items.potato = { allowed: true };
        fs.writeFileSync(file(), JSON.stringify(raw));
        const again = new P.StockPermits(file(), { now: () => T0 });
        assert.equal(again.load(), 3);
        assert.equal(again.may('wheat'), true);
        assert.equal(again.may('carrot'), false);
        assert.deepEqual(again.entry('potato'), { item: 'potato', allowed: true, at: 0 }, 'a missing time is 0');
        assert.equal(again.entry('bone_meal'), null);
    });

    test('the clock: now may give a Date or milliseconds; Date.now without one', () => {
        const dated = new P.StockPermits(file(), { now: () => new Date(T0 + 1) });
        assert.equal(dated.set('wheat', true).at, T0 + 1);
        const plain = new P.StockPermits(null);
        const before = Date.now();
        const at = plain.set('wheat', true).at;
        assert.ok(at >= before && at <= Date.now());
    });
});

describe('StockPermits: the file', () => {
    test('a corrupt file is set aside, the store starts empty with one warning, and the next set writes a good file', () => {
        fs.writeFileSync(file(), '{ not json');
        const s = store();
        assert.equal(s.size, 0);
        assert.equal(warnings().length, 1);
        assert.match(warnings()[0], /Permits file .* could not be read/);
        s.set('wheat', true);
        assert.deepEqual(JSON.parse(fs.readFileSync(file(), 'utf8')).items, { wheat: { allowed: true, at: T0 } });
    });

    test('a file without an items object: one warning, empty', () => {
        fs.writeFileSync(file(), JSON.stringify({ version: 1, items: [] }));
        const s = store();
        assert.equal(s.size, 0);
        assert.match(warnings().join('\n'), /has no "items" object/);
    });

    test('without a path the store lives in memory: nothing is written', () => {
        const s = new P.StockPermits(null, { now: () => T0 });
        assert.equal(s.load(), 0);
        assert.deepEqual(s.set('wheat', true), { item: 'wheat', allowed: true, at: T0 });
        assert.equal(s.may('wheat'), true);
        assert.deepEqual(fs.readdirSync(dir), []);
    });

    test('shared (M1): the file another bot changed is read again before a read', () => {
        const s = store();
        s.set('wheat', false);
        let changed = false;
        const shared = { changed: () => changed, mark: () => {}, stamp: () => null };
        const other = new P.StockPermits(file(), { now: () => T0, shared });
        other.load();
        assert.equal(other.may('wheat'), false);
        fs.writeFileSync(file(), JSON.stringify({ version: 1, items: { wheat: { allowed: true, at: T0 + 10 } } }));
        assert.equal(other.may('wheat'), false, 'not told of a change yet');
        changed = true;
        assert.equal(other.may('wheat'), true);
        assert.equal(other.allowedAt('wheat'), T0 + 10);
    });
});

describe('the texts of !allowTaking (8.1), word for word', () => {
    test('the yes and the no', () => {
        assert.equal(P.allowTakingText('wheat', true), 'I may take wheat from the chests now.');
        assert.equal(P.allowTakingText('wheat', false), 'I take no wheat from the chests.');
        assert.equal(P.allowTakingText('lapis_lazuli', true), 'I may take lapis_lazuli from the chests now.');
    });

    test('the short answer to the model once the line was said, as the survey answers', () => {
        assert.equal(P.ALLOW_SAID_TEXT, 'Done; I said it in the chat.');
    });
});
