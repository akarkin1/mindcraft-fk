// Spec v0.1.4.6 R1: src/agent/rules/rule_store.js -- RuleStore, the lasting rules that the player
// teaches. File bots/<name>/rules.json: { "version": 1, "rules": [ { id, text, created } ] }.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir, listDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const MODULE = 'src/agent/rules/rule_store.js';
const R = await loadSrc(MODULE);

const NOW = new Date(Date.UTC(2026, 8, 28, 12, 0, 0));
const NOW_ISO = NOW.toISOString();

let dir;
let file;
let cap;
beforeEach(() => {
    dir = makeTmpDir();
    file = path.join(dir, 'bots', 'andy', 'rules.json');
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

function store(options = {}) {
    const s = new R.RuleStore(file, { now: () => NOW, ...options });
    s.load();
    return s;
}

function readFile() {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeFile(data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data), 'utf8');
}

describe('module', () => {
    test('exports RuleStore and the limits', () => {
        assert.equal(typeof R.RuleStore, 'function');
        assert.equal(R.RULE_TEXT_MAX, 200);
        assert.equal(R.DEFAULT_RULES_MAX, 20);
    });

    test('imports only node built-ins and safe_json.js', () => {
        assertImportRules(MODULE, { allowedRelative: ['safe_json.js'] });
    });

    test('importing the module prints nothing and creates no files', () => {
        assertCleanImport(MODULE);
    });
});

describe('load()', () => {
    test('missing file: 0 rules, nothing written, no warning', () => {
        const s = new R.RuleStore(file, { now: () => NOW });
        assert.equal(s.load(), 0);
        assert.equal(s.size, 0);
        assert.deepEqual(s.list(), []);
        assert.equal(fs.existsSync(file), false);
        assert.deepEqual(cap.of('warn'), []);
    });

    test('reads the rules of a valid file, in order of the id', () => {
        writeFile({ version: 1, rules: [
            { id: 2, text: 'Seeds are for planting.', created: '2026-01-02T00:00:00.000Z' },
            { id: 1, text: 'Close the door behind you.', created: '2026-01-01T00:00:00.000Z' },
        ] });
        const s = new R.RuleStore(file, { now: () => NOW });
        assert.equal(s.load(), 2);
        assert.deepEqual(s.list(), [
            { id: 1, text: 'Close the door behind you.', created: '2026-01-01T00:00:00.000Z' },
            { id: 2, text: 'Seeds are for planting.', created: '2026-01-02T00:00:00.000Z' },
        ]);
    });

    test('skips invalid entries and keeps the valid ones', () => {
        writeFile({ version: 1, rules: [
            null,
            'a string',
            [1, 'x'],
            { id: 0, text: 'id zero' },
            { id: -1, text: 'negative id' },
            { id: 1.5, text: 'fraction id' },
            { id: '3', text: 'id as text' },
            { id: 4, text: '' },
            { id: 5, text: '   ' },
            { id: 6, text: 42 },
            { id: 7, text: 'Valid rule.', created: '2026-01-01T00:00:00.000Z' },
            { id: 7, text: 'Same id again.' },
            { id: 8, text: 'Valid without created.' },
        ] });
        const s = new R.RuleStore(file, { now: () => NOW });
        assert.equal(s.load(), 2);
        assert.deepEqual(s.list(), [
            { id: 7, text: 'Valid rule.', created: '2026-01-01T00:00:00.000Z' },
            { id: 8, text: 'Valid without created.', created: null },
        ]);
    });

    test('line breaks in a text of the file become spaces, the text is trimmed', () => {
        writeFile({ version: 1, rules: [{ id: 1, text: '  Close\r\nthe\ndoor.  ', created: null }] });
        assert.deepEqual(store().list(), [{ id: 1, text: 'Close the door.', created: null }]);
    });

    test('keeps more rules than max from the file; add then reports full', () => {
        writeFile({ version: 1, rules: [1, 2, 3].map((id) => ({ id, text: `Rule ${id}.`, created: null })) });
        const s = new R.RuleStore(file, { now: () => NOW, max: 2 });
        assert.equal(s.load(), 3);
        assert.deepEqual(s.add('Another rule.'), { ok: false, id: null, reason: 'full' });
    });

    test('a file without a rules array: warning, 0 rules', () => {
        writeFile({ version: 1, rules: { 1: 'x' } });
        const s = new R.RuleStore(file, { now: () => NOW });
        assert.equal(s.load(), 0);
        assert.equal(cap.of('warn').length, 1);
        assert.match(cap.of('warn')[0].text, /rules/);
    });

    test('a file with an empty object: 0 rules, no warning', () => {
        writeFile({});
        assert.equal(store().size, 0);
        assert.deepEqual(cap.of('warn'), []);
    });

    test('a corrupt file is set aside, a warning is printed, the store starts empty and can save', () => {
        writeFile('{ not json');
        const s = new R.RuleStore(file, { now: () => NOW });
        assert.equal(s.load(), 0);
        const warnings = cap.of('warn');
        assert.equal(warnings.length, 1);
        assert.match(warnings[0].text, /corrupt|could not be read/i);
        const names = listDir(path.dirname(file));
        assert.ok(names.some((n) => n.startsWith('rules.corrupt.')), names.join(', '));
        assert.equal(s.add('Close the door.').ok, true);
        assert.equal(readFile().rules.length, 1);
    });

    test('a JSON array as file: warning, 0 rules', () => {
        writeFile('[1, 2]');
        const s = new R.RuleStore(file, { now: () => NOW });
        assert.equal(s.load(), 0);
        assert.equal(cap.of('warn').length, 1);
    });

    test('never throws, also when reading fails in an unexpected way', () => {
        const s = new R.RuleStore(file, { now: () => NOW });
        s.filePath = { toString() { throw new Error('boom'); } };
        assert.doesNotThrow(() => s.load());
        assert.equal(s.size, 0);
    });

    test('load() again replaces the rules in memory with the file', () => {
        const s = store();
        s.add('Close the door.');
        writeFile({ version: 1, rules: [] });
        assert.equal(s.load(), 0);
        assert.equal(s.size, 0);
    });
});

describe('add(text)', () => {
    test('saves the rule with id 1 and writes the file', () => {
        const s = store();
        assert.deepEqual(s.add('Close the door behind you.'), { ok: true, id: 1, reason: null });
        assert.equal(s.size, 1);
        assert.deepEqual(readFile(), {
            version: 1,
            rules: [{ id: 1, text: 'Close the door behind you.', created: NOW_ISO }],
        });
    });

    test('the text is trimmed and line breaks become spaces', () => {
        const s = store();
        s.add('  Close the door\r\nbehind you.\nAlways.\r  ');
        assert.equal(s.list()[0].text, 'Close the door behind you. Always.');
    });

    test('ids count up from 1', () => {
        const s = store();
        assert.equal(s.add('One.').id, 1);
        assert.equal(s.add('Two.').id, 2);
        assert.equal(s.add('Three.').id, 3);
    });

    test('the id is the lowest free whole number', () => {
        const s = store();
        s.add('One.');
        s.add('Two.');
        s.add('Three.');
        s.remove(2);
        assert.equal(s.add('New two.').id, 2);
        s.remove(1);
        s.remove(3);
        assert.equal(s.add('New one.').id, 1);
        assert.equal(s.add('New three.').id, 3);
        assert.deepEqual(s.list().map((r) => r.id), [1, 2, 3]);
    });

    test('empty text: reason empty, nothing saved', () => {
        const s = store();
        for (const text of ['', '   ', '\n\r\n', undefined, null, 42, {}, ['x']]) {
            assert.deepEqual(s.add(text), { ok: false, id: null, reason: 'empty' }, String(text));
        }
        assert.equal(s.size, 0);
        assert.equal(fs.existsSync(file), false);
    });

    test('200 characters are allowed, 201 are too long', () => {
        const s = store();
        assert.deepEqual(s.add('a'.repeat(201)), { ok: false, id: null, reason: 'too_long' });
        assert.equal(s.size, 0);
        assert.deepEqual(s.add('a'.repeat(200)), { ok: true, id: 1, reason: null });
    });

    test('the length is measured after trimming', () => {
        const s = store();
        assert.equal(s.add(`   ${'b'.repeat(200)}   `).ok, true);
    });

    test('duplicate: same text regardless of case and of a full stop at the end', () => {
        const s = store();
        s.add('Close the door behind you.');
        for (const text of ['Close the door behind you.', 'close the door behind you', 'CLOSE THE DOOR BEHIND YOU.', ' close the door\nbehind you. ', 'Close  the door behind you...']) {
            assert.deepEqual(s.add(text), { ok: false, id: null, reason: 'duplicate' }, text);
        }
        assert.equal(s.size, 1);
    });

    test('a different text is no duplicate', () => {
        const s = store();
        s.add('Close the door behind you.');
        assert.equal(s.add('Close the door in front of you.').ok, true);
        assert.equal(s.add('Close the door behind you!').ok, true, 'only a full stop is ignored');
    });

    test('full: at most max rules', () => {
        const s = store({ max: 2 });
        s.add('One.');
        s.add('Two.');
        assert.deepEqual(s.add('Three.'), { ok: false, id: null, reason: 'full' });
        assert.equal(s.size, 2);
        s.remove(1);
        assert.equal(s.add('Three.').ok, true);
    });

    test('the order of the checks: empty, too_long, duplicate, full', () => {
        const s = store({ max: 1 });
        s.add('One.');
        assert.equal(s.add('').reason, 'empty');
        assert.equal(s.add('x'.repeat(201)).reason, 'too_long');
        assert.equal(s.add('one').reason, 'duplicate');
        assert.equal(s.add('Two.').reason, 'full');
    });

    test('20 rules by default', () => {
        const s = store();
        for (let i = 1; i <= 20; i++) assert.equal(s.add(`Rule number ${i}.`).ok, true, `rule ${i}`);
        assert.deepEqual(s.add('Rule number 21.'), { ok: false, id: null, reason: 'full' });
        assert.equal(readFile().rules.length, 20);
    });

    test('a failing write logs a warning, does not throw, and keeps the rule for this session', () => {
        fs.mkdirSync(dir, { recursive: true });
        const blocker = path.join(dir, 'blocker');
        fs.writeFileSync(blocker, 'a file where a folder should be');
        const s = new R.RuleStore(path.join(blocker, 'rules.json'), { now: () => NOW });
        s.load();
        let result;
        assert.doesNotThrow(() => {
            result = s.add('Close the door.');
        });
        assert.deepEqual(result, { ok: true, id: 1, reason: null });
        assert.equal(s.size, 1);
        assert.equal(cap.of('warn').length, 1);
        assert.match(cap.of('warn')[0].text, /Could not write the rule file/);
    });

    test('created comes from now()', () => {
        let t = Date.UTC(2026, 0, 1);
        const s = new R.RuleStore(file, { now: () => new Date(t) });
        s.load();
        s.add('One.');
        t += 1000;
        s.add('Two.');
        assert.deepEqual(s.list().map((r) => r.created), ['2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z']);
    });

    test('without now the current time is used', () => {
        const s = new R.RuleStore(file);
        s.load();
        const before = Date.now();
        s.add('One.');
        const created = Date.parse(s.list()[0].created);
        assert.ok(created >= before - 1000 && created <= Date.now() + 1000);
    });
});

describe('remove(id)', () => {
    test('removes an existing rule, returns true and writes the file', () => {
        const s = store();
        s.add('One.');
        s.add('Two.');
        assert.equal(s.remove(1), true);
        assert.deepEqual(s.list().map((r) => r.text), ['Two.']);
        assert.deepEqual(readFile().rules.map((r) => r.id), [2]);
    });

    test('an unknown id returns false and writes nothing', () => {
        const s = store();
        assert.equal(s.remove(1), false);
        assert.equal(fs.existsSync(file), false);
        s.add('One.');
        const before = fs.readFileSync(file, 'utf8');
        assert.equal(s.remove(2), false);
        assert.equal(fs.readFileSync(file, 'utf8'), before);
    });

    test('a number written as text is accepted', () => {
        const s = store();
        s.add('One.');
        assert.equal(s.remove(' 1 '), true);
    });

    test('ids that are no whole numbers return false', () => {
        const s = store();
        s.add('One.');
        for (const id of [1.5, '1.5', 'one', '', null, undefined, NaN, {}, [1], 0, -1]) {
            assert.equal(s.remove(id), false, String(id));
        }
        assert.equal(s.size, 1);
    });
});

describe('list(), size, max', () => {
    test('list() returns copies', () => {
        const s = store();
        s.add('One.');
        const listed = s.list();
        listed[0].text = 'changed';
        listed.push({ id: 9, text: 'x', created: null });
        assert.deepEqual(s.list().map((r) => r.text), ['One.']);
    });

    test('max: 20 by default', () => {
        assert.equal(store().max, 20);
    });

    test('max: a valid number is used, 0 switches the limit off', () => {
        assert.equal(store({ max: 5 }).max, 5);
        const s = store({ max: 0 });
        assert.equal(s.max, 0);
        for (let i = 1; i <= 25; i++) assert.equal(s.add(`Rule ${i}.`).ok, true);
        assert.equal(s.size, 25);
    });

    test('max: not finite, below 0 or no number counts as the default', () => {
        for (const max of [-1, NaN, Infinity, -Infinity, '5', null, true]) {
            assert.equal(store({ max }).max, 20, String(max));
        }
    });

    test('max: a fraction is rounded down, but a positive limit stays at least 1', () => {
        assert.equal(store({ max: 5.7 }).max, 5);
        assert.equal(store({ max: 0.5 }).max, 1);
    });

    test('options may be missing or not an object', () => {
        for (const options of [undefined, null, 'x']) {
            const s = new R.RuleStore(file, options);
            assert.equal(s.max, 20);
            assert.equal(s.load(), 0);
        }
    });

    test('rules survive a new store on the same file', () => {
        const s = store();
        s.add('Close the door behind you.');
        s.add('Seeds are for planting, never compost them.');
        const again = store();
        assert.deepEqual(again.list(), s.list());
    });

    test('the file lists the rules in order of the id', () => {
        const s = store();
        s.add('One.');
        s.add('Two.');
        s.add('Three.');
        s.remove(1);
        s.add('New one.');
        assert.deepEqual(readFile().rules.map((r) => r.id), [1, 2, 3]);
    });
});
