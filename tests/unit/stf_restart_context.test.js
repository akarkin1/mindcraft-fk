// Spec v0.1.4.8, part F: F3 (restart context, S6) -- src/agent/restart_context.js (I10):
// writeExit, readExit, restartNote. The file is bots/<name>/last_exit.json.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir, listDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const MODULE = 'src/agent/restart_context.js';
const R = await loadSrc(MODULE);

const T0 = Date.UTC(2026, 8, 29, 1, 0, 0);
const MIN = 60 * 1000;
const EXAMPLE = 'Before the restart MartyByrde2 had ordered: !mineOre("iron", 8). The process ended because: '
    + 'Got stuck and couldn\'t get unstuck. You are at (8, 41, 48). Do not repeat the order by yourself. '
    + 'Tell the player what happened.';
const STUCK = 'Got stuck and couldn\'t get unstuck';

let root;
let dir;
let cap;
beforeEach(() => {
    root = makeTmpDir();
    dir = path.join(root, 'bots', 'claude');
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
    removeTmpDir(root);
});

const exitFile = () => path.join(dir, 'last_exit.json');
const exampleExit = (fields = {}) => ({
    reason: STUCK,
    order: { by: 'MartyByrde2', text: '!mineOre("iron", 8)' },
    action: 'action:mineOre',
    position: { x: 8.51, y: 41, z: 48.37 },
    time: T0,
    ...fields,
});

describe('module', () => {
    test('imports only safe_json.js and the built-ins fs and path', () => {
        assertImportRules(MODULE, { allowBuiltins: ['fs', 'path'], allowedRelative: ['safe_json.js'] });
    });

    test('imports without output and without creating files', () => {
        assertCleanImport(MODULE);
    });

    test('exports writeExit, readExit, restartNote; the file name and the age limit', () => {
        for (const name of ['writeExit', 'readExit', 'restartNote'])
            assert.equal(typeof R[name], 'function', name);
        assert.equal(R.EXIT_FILE, 'last_exit.json');
        assert.equal(R.MAX_AGE_MS, 10 * MIN);
    });
});

describe('writeExit and readExit', () => {
    test('a round trip: the file is written into the folder of the bot, read once and deleted', () => {
        assert.equal(R.writeExit(dir, exampleExit()), true);
        assert.deepEqual(listDir(dir), ['last_exit.json']);
        const exit = R.readExit(dir, 10 * MIN, () => T0 + MIN);
        assert.deepEqual(exit, {
            reason: STUCK,
            order: { by: 'MartyByrde2', command: '!mineOre("iron", 8)' },
            action: 'action:mineOre',
            position: { x: 8, y: 41, z: 48 },
            time: T0,
        });
        assert.deepEqual(listDir(dir), [], 'deleted');
        assert.equal(R.readExit(dir, 10 * MIN, () => T0 + MIN), null, 'a second read finds nothing');
    });

    test('the file: version 1, whole block coordinates, the time in milliseconds', () => {
        R.writeExit(dir, exampleExit());
        const data = JSON.parse(fs.readFileSync(exitFile(), 'utf8'));
        assert.equal(data.version, 1);
        assert.deepEqual(data.position, { x: 8, y: 41, z: 48 });
        assert.equal(data.time, T0);
    });

    test('an order as agent.last_order holds it: { by, command } with the name only', () => {
        R.writeExit(dir, exampleExit({ order: { by: 'MartyByrde2', at: T0, atTimeOfDay: 1000, command: '!mineOre' } }));
        assert.deepEqual(R.readExit(dir, 10 * MIN, () => T0).order, { by: 'MartyByrde2', command: '!mineOre' });
    });

    test('an order as a text, and no order', () => {
        R.writeExit(dir, exampleExit({ order: '!collectBlocks("oak_log", 10)' }));
        assert.deepEqual(R.readExit(dir, 10 * MIN, () => T0).order, { by: null, command: '!collectBlocks("oak_log", 10)' });
        R.writeExit(dir, exampleExit({ order: null }));
        assert.equal(R.readExit(dir, 10 * MIN, () => T0).order, null);
    });

    test('without a time the time of the write is taken', () => {
        const before = Date.now();
        R.writeExit(dir, exampleExit({ time: undefined }));
        const exit = R.readExit(dir);
        assert.ok(exit.time >= before && exit.time <= Date.now());
    });

    test('older than the limit: null, and the file is deleted anyway; exactly at the limit it counts', () => {
        R.writeExit(dir, exampleExit());
        assert.equal(R.readExit(dir, 10 * MIN, () => T0 + 10 * MIN + 1), null);
        assert.deepEqual(listDir(dir), []);
        R.writeExit(dir, exampleExit());
        assert.notEqual(R.readExit(dir, 10 * MIN, () => T0 + 10 * MIN), null);
    });

    test('the default limit is 10 minutes', () => {
        R.writeExit(dir, exampleExit({ time: Date.now() - 11 * MIN }));
        assert.equal(R.readExit(dir), null);
        R.writeExit(dir, exampleExit({ time: Date.now() - 9 * MIN }));
        assert.notEqual(R.readExit(dir), null);
    });

    test('a time in the future is not trusted', () => {
        R.writeExit(dir, exampleExit({ time: T0 + MIN }));
        assert.equal(R.readExit(dir, 10 * MIN, () => T0), null);
    });

    test('a broken file gives null and is deleted; no throw, not moved elsewhere', () => {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(exitFile(), '{ not json');
        assert.equal(R.readExit(dir, 10 * MIN, () => T0), null);
        assert.deepEqual(listDir(dir), []);
        fs.writeFileSync(exitFile(), '[1, 2]');
        assert.equal(R.readExit(dir, 10 * MIN, () => T0), null);
        fs.writeFileSync(exitFile(), JSON.stringify({ time: T0 }));
        assert.equal(R.readExit(dir, 10 * MIN, () => T0), null, 'nothing to tell');
    });

    test('no folder, a missing file, a bad folder argument: null', () => {
        assert.equal(R.readExit(path.join(root, 'nothing')), null);
        assert.equal(R.readExit(undefined), null);
        assert.equal(R.readExit(''), null);
    });

    test('writeExit never throws: a bad folder, bad fields, a folder that cannot be made', () => {
        assert.equal(R.writeExit(undefined, exampleExit()), false);
        assert.equal(R.writeExit('', exampleExit()), false);
        fs.mkdirSync(root, { recursive: true });
        const blocker = path.join(root, 'blocker');
        fs.writeFileSync(blocker, 'a file, not a folder');
        assert.equal(R.writeExit(path.join(blocker, 'claude'), exampleExit()), false);
        assert.equal(R.writeExit(dir), true);
        assert.equal(R.writeExit(dir, { reason: 42, order: 7, action: {}, position: { x: 'a' }, time: 'x' }), true);
    });

    test('long and multi-line texts are cut to one line of at most 300 characters', () => {
        R.writeExit(dir, exampleExit({ reason: `line one\nline two ${'x'.repeat(400)}` }));
        const exit = R.readExit(dir, 10 * MIN, () => T0);
        assert.ok(exit.reason.startsWith('line one line two x'));
        assert.equal(exit.reason.length, 300);
        assert.ok(exit.reason.endsWith('...'));
    });
});

describe('restartNote', () => {
    test('the example of the spec, word for word', () => {
        assert.equal(R.restartNote(exampleExit()), EXAMPLE);
    });

    test('the same text from a file that was written and read', () => {
        R.writeExit(dir, exampleExit());
        assert.equal(R.restartNote(R.readExit(dir, 10 * MIN, () => T0)), EXAMPLE);
    });

    test('without the name of the player: "a player"', () => {
        const note = R.restartNote(exampleExit({ order: '!mineOre("iron", 8)' }));
        assert.ok(note.startsWith('Before the restart a player had ordered: !mineOre("iron", 8). '), note);
    });

    test('without an order: the running action, and no sentence about the order', () => {
        assert.equal(R.restartNote(exampleExit({ order: null })),
            'Before the restart you were running: action:mineOre. The process ended because: Got stuck and couldn\'t get unstuck. '
            + 'You are at (8, 41, 48). Tell the player what happened.');
    });

    test('only a reason', () => {
        assert.equal(R.restartNote({ reason: 'Killed by the player.' }),
            'The process ended because: Killed by the player. Tell the player what happened.');
    });

    test('a reason that ends with a period gets no second one', () => {
        const note = R.restartNote(exampleExit({ reason: 'Got stuck and couldn\'t get unstuck.' }));
        assert.equal(note, EXAMPLE);
    });

    test('nothing to tell: an empty text', () => {
        for (const value of [null, undefined, 'text', 5, {}, { time: T0 }])
            assert.equal(R.restartNote(value), '', String(value));
    });
});
