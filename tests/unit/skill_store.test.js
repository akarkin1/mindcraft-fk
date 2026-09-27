// Spec v0.1.4.4 K3: src/agent/skills/skill_store.js -- SkillStore, the skills of a bot on disk:
//   <dir>/index.json, <dir>/<name>.js, <dir>/.history/<name>.v<N>.js, <dir>/.history/<name>.removed-<stamp>.js
// Real files in a temp directory. Nothing is ever deleted.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir, listDir } from '../helpers/tmp.js';
import { listFiles } from '../helpers/tree.js';
import { captureConsole } from '../helpers/console_capture.js';
import { patchFs, fsError } from '../helpers/fs_patch.js';
import { assertSkillModuleImports } from '../helpers/source_ast.js';
import { assertCleanImport } from '../helpers/module_rules.js';

const MODULE = 'src/agent/skills/skill_store.js';
const S = await loadSrc(MODULE);

const T0 = Date.UTC(2026, 8, 28, 9, 15, 30);
const iso = (ms) => new Date(ms).toISOString();
const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const ENTRY_KEYS = ['consecutive_failures', 'created', 'description', 'failures', 'hash', 'last_error', 'last_used', 'name', 'signature', 'source_task', 'status', 'updated', 'uses', 'version'];

let root; // temp directory of the test
let dir; // store directory, <root>/skills (not created in advance)
let cap;
let clock;
beforeEach(() => {
    root = makeTmpDir();
    dir = path.join(root, 'skills');
    cap = captureConsole();
    clock = T0;
});
afterEach(() => {
    cap.restore();
    removeTmpDir(root);
});

function newStore(d = dir) {
    assert.equal(typeof S.SkillStore, 'function', 'SkillStore must be an exported class');
    return new S.SkillStore(d, { now: () => new Date(clock) });
}
function loaded(d = dir) {
    const store = newStore(d);
    store.load();
    return store;
}

// A normalized skill source (ends with exactly one '\n').
function sourceOf(name, description = 'Builds a wall of the given length.', param = 'length', body = 'return true;') {
    return [`async function ${name}(bot, ${param}) {`, '    /**', `     * ${description}`, '     **/', `    ${body}`, '}', ''].join('\n');
}
const saveArgs = (name, overrides = {}) => ({
    name,
    source: sourceOf(name),
    description: 'Builds a wall.',
    signature: `${name}(bot, length)`,
    sourceTask: 'build a wall',
    ...overrides,
});

const file = (...parts) => path.join(dir, ...parts);
const readText = (...parts) => fs.readFileSync(file(...parts), 'utf8');
const readIndex = () => JSON.parse(readText('index.json'));
const history = () => listDir(file('.history'));

// Content and modification time of every file below d.
function fileState(d = dir) {
    const state = {};
    for (const rel of listFiles(d)) {
        const full = path.join(d, ...rel.split('/'));
        state[rel] = { content: fs.readFileSync(full, 'utf8'), mtimeMs: fs.statSync(full).mtimeMs };
    }
    return state;
}

describe('save(): created', () => {
    test('writes <dir>/<name>.js and index.json; entry has exactly the specified keys and values', () => {
        const store = loaded();
        const result = store.save(saveArgs('buildWall'));
        assert.equal(result.action, 'created');
        const e = result.entry;
        assert.deepEqual(Object.keys(e).sort(), ENTRY_KEYS);
        assert.equal(e.name, 'buildWall');
        assert.equal(e.signature, 'buildWall(bot, length)');
        assert.equal(e.description, 'Builds a wall.');
        assert.equal(e.status, 'active');
        assert.equal(e.version, 1);
        assert.equal(e.created, iso(T0));
        assert.ok(e.updated === null || typeof e.updated === 'string');
        assert.equal(e.uses, 0);
        assert.equal(e.failures, 0);
        assert.equal(e.consecutive_failures, 0);
        assert.equal(e.last_used, null);
        assert.equal(e.last_error, null);
        assert.equal(e.source_task, 'build a wall');
        assert.equal(e.hash, sha(sourceOf('buildWall')));
        assert.match(e.hash, /^[0-9a-f]{64}$/);

        assert.equal(readText('buildWall.js'), sourceOf('buildWall'));
        const index = readIndex();
        assert.equal(index.version, 1);
        assert.deepEqual(Object.keys(index.skills), ['buildWall']);
        assert.deepEqual(index.skills.buildWall, store.get('buildWall'));
        assert.deepEqual(result.entry, store.get('buildWall'));
        assert.equal(store.size, 1);
    });

    test('the source is normalized before it is written and hashed', () => {
        const store = loaded();
        const messy = sourceOf('buildWall').replace(/\n/g, '\r\n') + '  \r\n\r\n';
        const result = store.save(saveArgs('buildWall', { source: messy }));
        assert.equal(readText('buildWall.js'), sourceOf('buildWall'));
        assert.equal(result.entry.hash, sha(sourceOf('buildWall')));
        assert.equal(store.read('buildWall'), sourceOf('buildWall'));
    });

    test('$ characters in source and description are stored exactly', () => {
        const store = loaded();
        const source = sourceOf('payUp', 'Pays $& and $1.', 'amount', 'log(bot, "$& $1 $$ $` $\'");');
        store.save(saveArgs('payUp', { source, description: 'Pays $& and $1.' }));
        assert.equal(readText('payUp.js'), source);
        assert.equal(store.get('payUp').description, 'Pays $& and $1.');
    });

    test('the file is written to a temp file in the same directory and renamed; no temp file is left', () => {
        const store = loaded();
        const renames = [];
        const restore = patchFs('renameSync', (original) => function (from, to, ...rest) {
            renames.push([String(from), String(to)]);
            return original.call(this, from, to, ...rest);
        });
        try {
            store.save(saveArgs('buildWall'));
        } finally {
            restore();
        }
        const target = path.resolve(file('buildWall.js'));
        const hit = renames.find(([, to]) => path.resolve(to) === target);
        assert.ok(hit, `a rename onto buildWall.js, renames: ${JSON.stringify(renames)}`);
        assert.equal(path.dirname(path.resolve(hit[0])), path.resolve(dir), 'the temp file is in the same directory');
        assert.notEqual(path.resolve(hit[0]), target);
        const unexpected = listDir(dir).filter((f) => !['index.json', 'buildWall.js', '.history'].includes(f));
        assert.deepEqual(unexpected, []);
    });

    test('names at the limits of the pattern are accepted', () => {
        const store = loaded();
        const long = 'a' + 'B'.repeat(39);
        assert.equal(store.save(saveArgs('abc')).action, 'created');
        assert.equal(store.save(saveArgs(long)).action, 'created');
        assert.ok(fs.existsSync(file(`${long}.js`)));
    });
});

describe('save(): unchanged', () => {
    test('same hash (also after normalization): nothing is written, action unchanged, version stays 1', () => {
        const store = loaded();
        store.save(saveArgs('buildWall'));
        const before = fileState();
        clock += 60_000;
        const again = saveArgs('buildWall', {
            source: sourceOf('buildWall').replace(/\n/g, '\r\n') + '   ',
            description: 'Other text.',
            signature: 'other(bot)',
            sourceTask: 'other task',
        });
        const result = store.save(again);
        assert.equal(result.action, 'unchanged');
        assert.equal(result.entry.version, 1);
        assert.equal(store.get('buildWall').version, 1);
        assert.deepEqual(fileState(), before, 'no file written or changed');
    });
});

describe('save(): updated', () => {
    test('old file MOVED to .history/<name>.v1.js, new file written, version 2, fields replaced, counters kept', () => {
        const store = loaded();
        const v1 = sourceOf('buildWall');
        store.save(saveArgs('buildWall', { source: v1 }));
        clock = T0 + 1000;
        store.recordUse('buildWall', { ok: true });
        store.recordUse('buildWall', { ok: false, error: 'boom' });
        store.setStatus('buildWall', 'disabled');
        clock = T0 + 3_600_000;
        const v2 = sourceOf('buildWall', 'Builds a better wall.', 'size', 'return false;');
        const result = store.save({ name: 'buildWall', source: v2, description: 'Builds a better wall.', signature: 'buildWall(bot, size)', sourceTask: 'build a better wall' });

        assert.equal(result.action, 'updated');
        const e = result.entry;
        assert.deepEqual(Object.keys(e).sort(), ENTRY_KEYS);
        assert.equal(e.version, 2);
        assert.equal(e.created, iso(T0));
        assert.equal(e.updated, iso(T0 + 3_600_000));
        assert.equal(e.description, 'Builds a better wall.');
        assert.equal(e.signature, 'buildWall(bot, size)');
        assert.equal(e.source_task, 'build a better wall');
        assert.equal(e.hash, sha(v2));
        assert.equal(e.status, 'active');
        assert.equal(e.consecutive_failures, 0);
        assert.equal(e.uses, 2);
        assert.equal(e.failures, 1);

        assert.equal(readText('buildWall.js'), v2);
        assert.deepEqual(history(), ['buildWall.v1.js']);
        assert.equal(readText('.history', 'buildWall.v1.js'), v1);
        assert.deepEqual(readIndex().skills.buildWall, store.get('buildWall'));
        assert.equal(store.size, 1);
    });

    test('a third version moves v2 to .history/<name>.v2.js; v1 stays', () => {
        const store = loaded();
        const v1 = sourceOf('buildWall', 'One.');
        const v2 = sourceOf('buildWall', 'Two.');
        const v3 = sourceOf('buildWall', 'Three.');
        store.save(saveArgs('buildWall', { source: v1 }));
        store.save(saveArgs('buildWall', { source: v2 }));
        const result = store.save(saveArgs('buildWall', { source: v3 }));
        assert.equal(result.entry.version, 3);
        assert.deepEqual(history(), ['buildWall.v1.js', 'buildWall.v2.js']);
        assert.equal(readText('.history', 'buildWall.v1.js'), v1);
        assert.equal(readText('.history', 'buildWall.v2.js'), v2);
        assert.equal(readText('buildWall.js'), v3);
    });
});

describe('names that do not match ^[a-z][A-Za-z0-9]{2,39}$', () => {
    const BAD = [
        ['../evil', '../evil'], ['..\\evil', '..\\evil'], ['a', 'a'], ['Bad', 'Bad'], ['ab', 'ab'], ['empty', ''],
        ['41 characters', 'a'.repeat(41)], ['a slash', 'abc/def'], ['a dot', 'abc.def'], ['a path to a skill', '../skills/buildWall'],
        ['undefined', undefined], ['null', null], ['a number', 42], ['an object', { name: 'abc' }],
    ];

    for (const [label, name] of BAD) {
        test(`save refuses ${label} with a TypeError; nothing is written anywhere`, () => {
            const store = loaded();
            assert.equal(typeof store.save, 'function');
            const before = listFiles(root);
            assert.throws(() => store.save(saveArgs(name)), TypeError);
            assert.equal(store.size, 0);
            assert.deepEqual(listFiles(root), before, 'no file written, also not outside the store directory');
            assert.equal(before.some((f) => f.endsWith('.js')), false);
        });
    }

    test('read and remove return null and false; a file outside the store directory is not reached', () => {
        const bait = path.join(root, 'evil.js');
        fs.writeFileSync(bait, sourceOf('evil'));
        const store = loaded();
        store.save(saveArgs('buildWall'));
        for (const [label, name] of BAD) {
            assert.equal(store.read(name), null, `read ${label}`);
            assert.equal(store.remove(name), false, `remove ${label}`);
        }
        assert.equal(fs.readFileSync(bait, 'utf8'), sourceOf('evil'));
        assert.equal(readText('buildWall.js'), sourceOf('buildWall'));
        assert.deepEqual(history(), []);
        assert.equal(store.size, 1);
    });
});

describe('read, get, list, size', () => {
    test('read(name): the source text, or null for an unknown name', () => {
        const store = loaded();
        store.save(saveArgs('buildWall'));
        assert.equal(store.read('buildWall'), sourceOf('buildWall'));
        assert.equal(store.read('digHole'), null);
    });

    test('get(name): a copy of the entry, or undefined', () => {
        const store = loaded();
        store.save(saveArgs('buildWall'));
        const copy = store.get('buildWall');
        copy.status = 'changed';
        copy.uses = 99;
        assert.equal(store.get('buildWall').status, 'active');
        assert.equal(store.get('buildWall').uses, 0);
        assert.equal(store.get('digHole'), undefined);
    });

    test('list(): copies of all entries, sorted by name; size', () => {
        const store = loaded();
        for (const name of ['zetaSkill', 'alphaSkill', 'midSkill']) store.save(saveArgs(name));
        const list = store.list();
        assert.deepEqual(list.map((e) => e.name), ['alphaSkill', 'midSkill', 'zetaSkill']);
        for (const e of list) assert.deepEqual(Object.keys(e).sort(), ENTRY_KEYS);
        list[0].status = 'changed';
        assert.equal(store.get('alphaSkill').status, 'active');
        assert.equal(store.size, 3);
    });
});

describe('setStatus(name, status)', () => {
    test('true for an existing skill and active/disabled; stored in index.json', () => {
        const store = loaded();
        store.save(saveArgs('buildWall'));
        assert.equal(store.setStatus('buildWall', 'disabled'), true);
        assert.equal(store.get('buildWall').status, 'disabled');
        assert.equal(readIndex().skills.buildWall.status, 'disabled');
        assert.equal(store.setStatus('buildWall', 'active'), true);
        assert.equal(store.get('buildWall').status, 'active');
    });

    test('false for another status value; nothing changes', () => {
        const store = loaded();
        store.save(saveArgs('buildWall'));
        for (const status of ['deleted', 'ACTIVE', '', undefined, null, 1]) {
            assert.equal(store.setStatus('buildWall', status), false, String(status));
        }
        assert.equal(store.get('buildWall').status, 'active');
    });

    test('false for an unknown name', () => {
        const store = loaded();
        assert.equal(store.setStatus('digHole', 'disabled'), false);
        assert.equal(store.setStatus('../evil', 'disabled'), false);
    });
});

describe('recordUse(name, { ok, error })', () => {
    test('counters, last_used, last_error cut to 200 characters; stored in index.json', () => {
        const store = loaded();
        store.save(saveArgs('buildWall'));

        clock = T0 + 5000;
        store.recordUse('buildWall', { ok: true });
        let e = store.get('buildWall');
        assert.deepEqual([e.uses, e.failures, e.consecutive_failures, e.last_used], [1, 0, 0, iso(T0 + 5000)]);

        clock = T0 + 6000;
        store.recordUse('buildWall', { ok: false, error: 'E'.repeat(500) });
        e = store.get('buildWall');
        assert.deepEqual([e.uses, e.failures, e.consecutive_failures, e.last_used], [2, 1, 1, iso(T0 + 6000)]);
        assert.equal(e.last_error, 'E'.repeat(200));

        store.recordUse('buildWall', { ok: false, error: 'second $& failure' });
        e = store.get('buildWall');
        assert.deepEqual([e.uses, e.failures, e.consecutive_failures, e.last_error], [3, 2, 2, 'second $& failure']);

        store.recordUse('buildWall', { ok: true });
        e = store.get('buildWall');
        assert.deepEqual([e.uses, e.failures, e.consecutive_failures], [4, 2, 0]);
        assert.deepEqual(readIndex().skills.buildWall, store.get('buildWall'));
    });

    test('unknown name: nothing happens, nothing is written', () => {
        const store = loaded();
        store.save(saveArgs('buildWall'));
        const before = fileState();
        const listBefore = store.list();
        assert.doesNotThrow(() => store.recordUse('digHole', { ok: false, error: 'x' }));
        assert.doesNotThrow(() => store.recordUse('../evil', { ok: true }));
        assert.deepEqual(store.list(), listBefore);
        assert.deepEqual(fileState(), before);
    });
});

describe('remove(name)', () => {
    test('the file is MOVED to .history/<name>.removed-<UTC stamp>.js, the entry removed; true', () => {
        const store = loaded();
        const v1 = sourceOf('buildWall', 'One.');
        const v2 = sourceOf('buildWall', 'Two.');
        store.save(saveArgs('buildWall', { source: v1 }));
        store.save(saveArgs('buildWall', { source: v2 }));
        store.save(saveArgs('digHole'));
        clock = Date.UTC(2026, 8, 28, 23, 5, 9);

        assert.equal(store.remove('buildWall'), true);
        assert.equal(store.get('buildWall'), undefined);
        assert.equal(store.read('buildWall'), null);
        assert.equal(store.size, 1);
        assert.equal(fs.existsSync(file('buildWall.js')), false);
        assert.deepEqual(history(), ['buildWall.removed-20260928-230509.js', 'buildWall.v1.js']);
        assert.equal(readText('.history', 'buildWall.removed-20260928-230509.js'), v2);
        assert.equal(readText('.history', 'buildWall.v1.js'), v1);
        assert.deepEqual(Object.keys(readIndex().skills), ['digHole']);
    });

    test('unknown name: false, nothing changes', () => {
        const store = loaded();
        store.save(saveArgs('buildWall'));
        const before = fileState();
        assert.equal(store.remove('digHole'), false);
        assert.deepEqual(fileState(), before);
    });

    test('nothing is ever deleted: every source written over a lifecycle is still on disk', () => {
        const store = loaded();
        const written = [];
        const put = (name, description) => {
            const source = sourceOf(name, description);
            written.push(source);
            store.save(saveArgs(name, { source }));
        };
        put('buildWall', 'Version one.');
        put('buildWall', 'Version two.');
        put('digHole', 'Digs.');
        clock += 1000;
        store.remove('buildWall');
        clock += 1000;
        put('buildWall', 'Version three.');
        clock += 1000;
        store.remove('digHole');
        const onDisk = Object.values(fileState()).map((f) => f.content);
        for (const source of written) assert.ok(onDisk.includes(source), `still on disk: ${source.split('\n')[2]}`);
    });
});

// K3 as accepted in Amendment 1: a history file is never replaced, a suffix -2, -3 is added.
describe('history file names never collide', () => {
    test('save, update, remove, save, update, remove, save of one name in the same second: every earlier file keeps its own name and content', () => {
        const store = loaded();
        const A = sourceOf('buildWall', 'Version A.');
        const B = sourceOf('buildWall', 'Version B.');
        const C = sourceOf('buildWall', 'Version C.');
        const D = sourceOf('buildWall', 'Version D.');
        const E = sourceOf('buildWall', 'Version E.');
        const put = (source) => store.save(saveArgs('buildWall', { source })).action;
        assert.equal(put(A), 'created');
        assert.equal(put(B), 'updated'); // A -> buildWall.v1.js
        assert.equal(store.remove('buildWall'), true); // B -> buildWall.removed-<stamp>.js
        assert.equal(put(C), 'created'); // version 1 again
        assert.equal(put(D), 'updated'); // C -> buildWall.v1.js is taken: buildWall.v1-2.js
        assert.equal(store.remove('buildWall'), true); // D -> the same second: buildWall.removed-<stamp>-2.js
        assert.equal(put(E), 'created');

        const stamp = '20260928-091530';
        const expected = {
            'buildWall.v1.js': A,
            [`buildWall.removed-${stamp}.js`]: B,
            'buildWall.v1-2.js': C,
            [`buildWall.removed-${stamp}-2.js`]: D,
        };
        assert.deepEqual(history(), Object.keys(expected).sort());
        for (const [name, content] of Object.entries(expected)) assert.equal(readText('.history', name), content, name);
        assert.equal(readText('buildWall.js'), E);
        assert.equal(store.get('buildWall').version, 1);
    });

    test('three removes of the same name within the same second: -2 and -3 are added, nothing is replaced', () => {
        const store = loaded();
        const sources = ['One.', 'Two.', 'Three.'].map((d) => sourceOf('digHole', d));
        for (const source of sources) {
            store.save(saveArgs('digHole', { source }));
            assert.equal(store.remove('digHole'), true);
        }
        const names = ['digHole.removed-20260928-091530.js', 'digHole.removed-20260928-091530-2.js', 'digHole.removed-20260928-091530-3.js'];
        assert.deepEqual(history(), [...names].sort());
        names.forEach((name, i) => assert.equal(readText('.history', name), sources[i], name));
        assert.equal(fs.existsSync(file('digHole.js')), false);
    });

    test('removes in different seconds get their own stamp without a suffix', () => {
        const store = loaded();
        store.save(saveArgs('digHole', { source: sourceOf('digHole', 'One.') }));
        store.remove('digHole');
        clock += 1000;
        store.save(saveArgs('digHole', { source: sourceOf('digHole', 'Two.') }));
        store.remove('digHole');
        assert.deepEqual(history(), ['digHole.removed-20260928-091530.js', 'digHole.removed-20260928-091531.js']);
    });

    test('a file nobody tracks is kept as v0, a second one as v0-2', () => {
        const store = loaded();
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file('buildWall.js'), 'untracked one\n');
        store.save(saveArgs('buildWall', { source: sourceOf('buildWall', 'First.') }));
        store.remove('buildWall');
        fs.writeFileSync(file('buildWall.js'), 'untracked two\n');
        store.save(saveArgs('buildWall', { source: sourceOf('buildWall', 'Second.') }));
        assert.equal(readText('.history', 'buildWall.v0.js'), 'untracked one\n');
        assert.equal(readText('.history', 'buildWall.v0-2.js'), 'untracked two\n');
        assert.equal(readText('.history', 'buildWall.removed-20260928-091530.js'), sourceOf('buildWall', 'First.'));
        assert.equal(readText('buildWall.js'), sourceOf('buildWall', 'Second.'));
    });

    test('a directory in the way of a history name is skipped too', () => {
        const store = loaded();
        fs.mkdirSync(file('.history', 'buildWall.v1.js'), { recursive: true });
        store.save(saveArgs('buildWall', { source: sourceOf('buildWall', 'One.') }));
        store.save(saveArgs('buildWall', { source: sourceOf('buildWall', 'Two.') }));
        assert.equal(readText('.history', 'buildWall.v1-2.js'), sourceOf('buildWall', 'One.'));
        assert.ok(fs.statSync(file('.history', 'buildWall.v1.js')).isDirectory());
    });
});

describe('load()', () => {
    test('empty or missing directory: 0 skills', () => {
        const store = newStore();
        assert.equal(store.load(), 0);
        assert.equal(store.size, 0);
        assert.deepEqual(store.list(), []);
    });

    test('a valid index: returns the number of skills, entries kept as written', () => {
        const first = loaded();
        first.save(saveArgs('buildWall'));
        first.save(saveArgs('digHole'));
        first.recordUse('buildWall', { ok: true });
        first.recordUse('buildWall', { ok: false, error: 'boom' });
        first.setStatus('digHole', 'disabled');
        const second = newStore();
        assert.equal(second.load(), 2);
        assert.deepEqual(second.list(), first.list());
        assert.equal(second.read('buildWall'), sourceOf('buildWall'));
    });

    test('an entry whose source file is missing is dropped', () => {
        const first = loaded();
        first.save(saveArgs('buildWall'));
        first.save(saveArgs('digHole'));
        fs.unlinkSync(file('digHole.js')); // test setup: the file got lost
        const second = newStore();
        assert.equal(second.load(), 1);
        assert.equal(second.get('digHole'), undefined);
        assert.equal(second.read('digHole'), null);
        assert.deepEqual(second.list().map((e) => e.name), ['buildWall']);
    });

    function writeSkillFiles() {
        fs.mkdirSync(file('.history'), { recursive: true });
        const wall = sourceOf('buildWall', 'Builds a wall of the given length.', 'length');
        const hole = sourceOf('digHole', 'Digs a hole.', 'depth');
        fs.writeFileSync(file('buildWall.js'), wall);
        fs.writeFileSync(file('digHole.js'), hole);
        fs.writeFileSync(file('.history', 'oldSkill.v1.js'), sourceOf('oldSkill'));
        fs.writeFileSync(file('notes.txt'), 'not a skill');
        return { wall, hole };
    }

    function assertRebuilt(store, { wall, hole }) {
        assert.deepEqual(store.list().map((e) => e.name), ['buildWall', 'digHole']);
        const e = store.get('buildWall');
        assert.deepEqual(Object.keys(e).sort(), ENTRY_KEYS);
        assert.equal(e.status, 'active');
        assert.equal(e.version, 1);
        assert.equal(e.description, 'Builds a wall of the given length.');
        assert.equal(e.signature, 'buildWall(bot, length)');
        assert.deepEqual([e.uses, e.failures, e.consecutive_failures], [0, 0, 0]);
        assert.equal(e.hash, sha(wall));
        const h = store.get('digHole');
        assert.equal(h.description, 'Digs a hole.');
        assert.equal(h.signature, 'digHole(bot, depth)');
        assert.equal(store.read('digHole'), hole);
    }

    test('missing index: rebuilt from the *.js files directly in dir (not .history, not other files)', () => {
        const files = writeSkillFiles();
        const store = newStore();
        assert.equal(store.load(), 2);
        assertRebuilt(store, files);
    });

    test('corrupt index: rebuilt; the corrupt content is not lost', () => {
        const files = writeSkillFiles();
        fs.writeFileSync(file('index.json'), '{"version": 1, "skills": {');
        const store = newStore();
        let count;
        assert.doesNotThrow(() => {
            count = store.load();
        });
        assert.equal(count, 2);
        assertRebuilt(store, files);
        const contents = Object.values(fileState()).map((f) => f.content);
        assert.ok(contents.includes('{"version": 1, "skills": {'), 'the corrupt index is kept (quarantined), not deleted');
    });

    for (const [label, content] of [
        ['an array', '[]'],
        ['null', 'null'],
        ['no skills', '{"version": 1}'],
        ['skills is an array', '{"version": 1, "skills": []}'],
        ['skills is a string', '{"version": 1, "skills": "x"}'],
        ['an empty file', ''],
    ]) {
        test(`index of the wrong shape (${label}): rebuilt from the files`, () => {
            const files = writeSkillFiles();
            fs.writeFileSync(file('index.json'), content);
            const store = newStore();
            assert.equal(store.load(), 2);
            assertRebuilt(store, files);
        });
    }

    test('dir is a file: no throw, 0', () => {
        fs.writeFileSync(dir, 'not a directory');
        const store = newStore();
        let count;
        assert.doesNotThrow(() => {
            count = store.load();
        });
        assert.equal(count, 0);
    });

    test('index.json is a directory: no throw', () => {
        fs.mkdirSync(file('index.json'), { recursive: true });
        const store = newStore();
        assert.doesNotThrow(() => store.load());
    });
});

describe('a failing write', () => {
    // Amendment 2, B1: for save() a failed write of the source is a failure (see below). The rule
    // "does not throw, the state in memory stays updated" still holds for recordUse, setStatus, remove.
    test('of recordUse, setStatus and remove is reported with console.warn, does not throw, and the in-memory state stays updated', () => {
        const store = loaded();
        store.save(saveArgs('buildWall'));
        const restore = patchFs('renameSync', () => () => {
            throw fsError('EIO');
        });
        try {
            assert.doesNotThrow(() => store.recordUse('buildWall', { ok: false, error: 'x' }));
            assert.equal(store.get('buildWall').uses, 1);
            assert.equal(store.setStatus('buildWall', 'disabled'), true);
            assert.equal(store.get('buildWall').status, 'disabled');
            assert.doesNotThrow(() => store.remove('buildWall'));
            assert.equal(store.get('buildWall'), undefined);
        } finally {
            restore();
        }
        assert.ok(cap.of('warn').length >= 3, 'a console.warn per failed write');
    });
});

// Amendment 2, B1: if the source file could not be written, or the earlier version could not be
// moved to the history, save returns { action: 'failed', entry: null, error } and the entry in
// memory is neither created nor changed, so the store shows what is on disk. No throw, a warning.
describe('save(): a failed write is a failure (Amendment 2, B1)', () => {
    function assertFailed(result) {
        assert.equal(result.action, 'failed', JSON.stringify(result));
        assert.equal(result.entry, null);
        assert.equal(typeof result.error, 'string');
        assert.ok(result.error.length > 0);
        assert.ok(cap.of('warn').length >= 1, 'a console.warn is logged');
    }
    const tempFiles = (d = dir) => listDir(d).filter((f) => f.endsWith('.tmp'));

    test('the skills folder is a file: a new skill is not created', () => {
        const blocker = path.join(root, 'blocker');
        fs.writeFileSync(blocker, 'a file where the directory should be');
        const store = loaded(blocker);
        let result;
        assert.doesNotThrow(() => {
            result = store.save(saveArgs('buildWall'));
        });
        assertFailed(result);
        assert.equal(store.get('buildWall'), undefined);
        assert.equal(store.size, 0);
        assert.equal(store.read('buildWall'), null);
        assert.equal(fs.readFileSync(blocker, 'utf8'), 'a file where the directory should be');
    });

    test('a folder above the skills folder is a file: a new skill is not created', () => {
        const blocker = path.join(root, 'blocker');
        fs.writeFileSync(blocker, 'x');
        const store = loaded(path.join(blocker, 'skills'));
        assertFailed(store.save(saveArgs('buildWall')));
        assert.deepEqual(store.list(), []);
    });

    test('the history folder is a file: an update fails, the entry is unchanged and read() gives the old source', () => {
        const store = loaded();
        const v1 = sourceOf('buildWall', 'One.');
        store.save(saveArgs('buildWall', { source: v1 }));
        store.recordUse('buildWall', { ok: true });
        const before = store.get('buildWall');
        const indexBefore = readText('index.json');
        fs.writeFileSync(file('.history'), 'a file where the history folder should be');
        clock += 60_000;

        const result = store.save(saveArgs('buildWall', { source: sourceOf('buildWall', 'Two.') }));
        assertFailed(result);
        assert.deepEqual(store.get('buildWall'), before);
        assert.equal(store.read('buildWall'), v1);
        assert.equal(readText('buildWall.js'), v1);
        assert.equal(readText('index.json'), indexBefore, 'the index is not written');
        assert.deepEqual(tempFiles(), []);
    });

    test('the history folder is a file: a file nobody tracks cannot be kept as v0, so a new skill is not created and the file stays', () => {
        const store = loaded();
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file('buildWall.js'), 'untracked\n');
        fs.writeFileSync(file('.history'), 'x');
        assertFailed(store.save(saveArgs('buildWall')));
        assert.equal(store.get('buildWall'), undefined);
        assert.equal(readText('buildWall.js'), 'untracked\n');
        assert.deepEqual(tempFiles(), []);
    });

    test('a new skill: the new file cannot be renamed into place -> failed, no file, no temp file left', () => {
        const store = loaded();
        const restore = patchFs('renameSync', (original) => function (from, to, ...rest) {
            if (String(from).endsWith('.tmp') && path.resolve(String(to)) === path.resolve(file('buildWall.js'))) throw fsError('EIO');
            return original.call(this, from, to, ...rest);
        });
        let result;
        try {
            result = store.save(saveArgs('buildWall'));
        } finally {
            restore();
        }
        assertFailed(result);
        assert.equal(store.get('buildWall'), undefined);
        assert.equal(fs.existsSync(file('buildWall.js')), false);
        assert.deepEqual(tempFiles(), []);
    });

    test('an update: the new file cannot be renamed into place -> the old file is moved back, failed, read() gives the old source', () => {
        const store = loaded();
        const v1 = sourceOf('buildWall', 'One.');
        store.save(saveArgs('buildWall', { source: v1 }));
        const before = store.get('buildWall');
        const restore = patchFs('renameSync', (original) => function (from, to, ...rest) {
            if (String(from).endsWith('.tmp') && path.resolve(String(to)) === path.resolve(file('buildWall.js'))) throw fsError('EIO');
            return original.call(this, from, to, ...rest);
        });
        let result;
        try {
            result = store.save(saveArgs('buildWall', { source: sourceOf('buildWall', 'Two.') }));
        } finally {
            restore();
        }
        assertFailed(result);
        assert.deepEqual(store.get('buildWall'), before);
        assert.equal(store.read('buildWall'), v1);
        assert.deepEqual(history(), [], 'the old version went back to its place');
        assert.deepEqual(tempFiles(), []);
    });

    test('an update: neither the new file nor the old one can be put into place -> failed, the old source is kept in the history', () => {
        const store = loaded();
        const v1 = sourceOf('buildWall', 'One.');
        store.save(saveArgs('buildWall', { source: v1 }));
        const before = store.get('buildWall');
        const target = path.resolve(file('buildWall.js'));
        const restore = patchFs('renameSync', (original) => function (from, to, ...rest) {
            if (path.resolve(String(to)) === target) throw fsError('EIO');
            return original.call(this, from, to, ...rest);
        });
        let result;
        try {
            result = store.save(saveArgs('buildWall', { source: sourceOf('buildWall', 'Two.') }));
        } finally {
            restore();
        }
        assertFailed(result);
        assert.ok(cap.of('warn').length >= 2, 'the failed move back is warned about too');
        assert.deepEqual(store.get('buildWall'), before);
        assert.equal(readText('.history', 'buildWall.v1.js'), v1, 'nothing is lost');
        assert.deepEqual(tempFiles(), []);
    });

    test('only index.json cannot be written: the result stays created and updated, the files are written', () => {
        const store = loaded();
        const restore = patchFs('renameSync', (original) => function (from, to, ...rest) {
            if (path.basename(String(to)) === 'index.json') throw fsError('EIO');
            return original.call(this, from, to, ...rest);
        });
        let created;
        let updated;
        try {
            created = store.save(saveArgs('buildWall', { source: sourceOf('buildWall', 'One.') }));
            updated = store.save(saveArgs('buildWall', { source: sourceOf('buildWall', 'Two.') }));
        } finally {
            restore();
        }
        assert.equal(created.action, 'created');
        assert.equal(updated.action, 'updated');
        assert.equal(store.get('buildWall').version, 2);
        assert.equal(readText('buildWall.js'), sourceOf('buildWall', 'Two.'));
        assert.equal(readText('.history', 'buildWall.v1.js'), sourceOf('buildWall', 'One.'));
        assert.equal(fs.existsSync(file('index.json')), false);
        assert.ok(cap.of('warn').length >= 2);
        // the index is rebuilt from the files at the next start
        assert.deepEqual(loaded().list().map((e) => e.name), ['buildWall']);
    });

    test('after a failed save the next save works normally', () => {
        const store = loaded();
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file('.history'), 'x');
        store.save(saveArgs('buildWall', { source: sourceOf('buildWall', 'One.') }));
        assertFailed(store.save(saveArgs('buildWall', { source: sourceOf('buildWall', 'Two.') })));
        fs.unlinkSync(file('.history'));
        const result = store.save(saveArgs('buildWall', { source: sourceOf('buildWall', 'Two.') }));
        assert.equal(result.action, 'updated');
        assert.equal(result.entry.version, 2);
        assert.equal(readText('.history', 'buildWall.v1.js'), sourceOf('buildWall', 'One.'));
    });
});

describe('module rules', () => {
    test('no mineflayer, no model SDK, not skills.js or world.js, no require()', () => {
        assertSkillModuleImports(MODULE);
    });

    test('importing the module prints nothing and creates no files', () => {
        assertCleanImport(MODULE);
    });
});
