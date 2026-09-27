// Spec v0.1.4.3 W5: src/agent/history.js -- defer_storage, storage_ready, setStorageDir(dir),
// guards of save/load/appendFullHistory, archiveExisting(archiveDir).
//
// As in history.test.js every test runs with the working directory set to an empty temp
// directory, so the default './bots' path can never touch the repository.
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir, listDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { makeFakeAgent } from '../helpers/fake_agent.js';
import { listFiles, samePath } from '../helpers/tree.js';

const H = await loadSrc('src/agent/history.js');

const NAME = 'zz_test_andy';
const TURNS = [{ role: 'user', content: 'steve: hi' }, { role: 'assistant', content: 'hello' }];

let originalCwd;
let fakeCwd;
let botsDir;
let cap;

before(() => {
    originalCwd = process.cwd();
});
after(() => {
    process.chdir(originalCwd);
});
beforeEach(() => {
    fakeCwd = makeTmpDir();
    process.chdir(fakeCwd);
    botsDir = makeTmpDir();
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
    process.chdir(originalCwd);
    removeTmpDir(botsDir);
    removeTmpDir(fakeCwd);
});

function newHistory(options = {}) {
    const agent = makeFakeAgent(NAME);
    return new H.History(agent, { bots_dir: botsDir, ...options });
}
const deferred = () => newHistory({ defer_storage: true });
const worldDir = (key = 'seed-00000000000000aa') => path.join(botsDir, NAME, 'worlds', key);

describe('construction without defer_storage (unchanged behaviour)', () => {
    test('storage_ready is true, memory_fp and histories/ as in v0.1.4.2', () => {
        const history = newHistory();
        assert.equal(history.storage_ready, true);
        assert.equal(history.memory_fp, `${botsDir}/${NAME}/memory.json`);
        assert.ok(fs.statSync(path.join(botsDir, NAME, 'histories')).isDirectory());
    });

    test('defer_storage: false behaves like no option', () => {
        const history = newHistory({ defer_storage: false });
        assert.equal(history.memory_fp, `${botsDir}/${NAME}/memory.json`);
        assert.ok(fs.statSync(path.join(botsDir, NAME, 'histories')).isDirectory());
    });

    test('save, load and appendFullHistory use the bot directory as before', async () => {
        const history = newHistory();
        history.memory = 'kept';
        history.turns = [...TURNS];
        assert.equal(await history.save(), true);
        assert.equal(JSON.parse(fs.readFileSync(path.join(botsDir, NAME, 'memory.json'), 'utf8')).memory, 'kept');
        const other = newHistory();
        assert.equal(other.load().memory, 'kept');
        await other.appendFullHistory(TURNS);
        const files = listDir(path.join(botsDir, NAME, 'histories'));
        assert.equal(files.length, 1);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(botsDir, NAME, 'histories', files[0]), 'utf8')), TURNS);
    });
});

describe('defer_storage: true', () => {
    test('the constructor creates no directory, storage_ready false, memory_fp null', () => {
        const history = deferred();
        assert.deepEqual(listDir(botsDir), []);
        assert.equal(history.storage_ready, false);
        assert.equal(history.memory_fp, null);
        assert.deepEqual(listDir(fakeCwd), [], 'nothing under ./bots either');
    });

    test('save() resolves to false and writes nothing', async () => {
        const history = deferred();
        history.memory = 'x';
        const result = history.save();
        assert.equal(await result, false);
        assert.deepEqual(listFiles(botsDir), []);
        assert.deepEqual(listFiles(fakeCwd), []);
    });

    test('load() returns null', () => {
        const history = deferred();
        assert.equal(history.load(), null);
    });

    test('appendFullHistory(turns) does nothing', async () => {
        const history = deferred();
        await history.appendFullHistory(TURNS);
        assert.deepEqual(listFiles(botsDir), []);
        assert.deepEqual(listFiles(fakeCwd), []);
    });
});

describe('setStorageDir(dir)', () => {
    test('memory_fp is `${dir}/memory.json`, histories/ created, storage_ready true', () => {
        const history = deferred();
        const dir = worldDir();
        history.setStorageDir(dir);
        assert.equal(history.memory_fp, `${dir}/memory.json`);
        assert.ok(fs.statSync(path.join(dir, 'histories')).isDirectory());
        assert.equal(history.storage_ready, true);
    });

    test('after setStorageDir, save / load / appendFullHistory work in the new directory', async () => {
        const history = deferred();
        const dir = worldDir();
        history.setStorageDir(dir);
        history.memory = 'world memory';
        history.turns = [...TURNS];
        assert.equal(await history.save(), true);
        assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'memory.json'), 'utf8')).memory, 'world memory');
        await history.appendFullHistory(TURNS);
        const files = listDir(path.join(dir, 'histories'));
        assert.equal(files.length, 1);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'histories', files[0]), 'utf8')), TURNS);

        const other = deferred();
        other.setStorageDir(dir);
        const data = other.load();
        assert.equal(data.memory, 'world memory');
        assert.equal(other.memory, 'world memory');
        assert.deepEqual(other.turns, TURNS);
        assert.equal(fs.existsSync(path.join(botsDir, NAME, 'memory.json')), false, 'nothing in the bot directory');
    });

    test('an already opened full history file is closed: full_history_fp undefined, later turns go to the new directory', async () => {
        const history = newHistory();
        await history.appendFullHistory([TURNS[0]]);
        const oldDir = path.join(botsDir, NAME, 'histories');
        const oldFiles = listDir(oldDir);
        assert.equal(oldFiles.length, 1);
        const oldContent = fs.readFileSync(path.join(oldDir, oldFiles[0]), 'utf8');

        const dir = worldDir();
        history.setStorageDir(dir);
        assert.equal(history.full_history_fp, undefined);
        await history.appendFullHistory([TURNS[1]]);
        assert.equal(fs.readFileSync(path.join(oldDir, oldFiles[0]), 'utf8'), oldContent, 'old file unchanged');
        const newFiles = listDir(path.join(dir, 'histories'));
        assert.equal(newFiles.length, 1);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'histories', newFiles[0]), 'utf8')), [TURNS[1]]);
    });

    test('stale temp files memory.json.*.tmp older than 60 seconds are deleted, younger ones and other files kept', () => {
        const dir = worldDir();
        fs.mkdirSync(dir, { recursive: true });
        const nowSec = Date.now() / 1000;
        const files = {
            'memory.json.1234.aabbccddeeff.tmp': nowSec - 3600, // stale: deleted
            'memory.json.99.0123456789ab.tmp': nowSec - 120, // stale: deleted
            'memory.json.5678.ffeeddccbbaa.tmp': nowSec - 5, // young: kept
            'places.json.1234.aabbccddeeff.tmp': nowSec - 3600, // other name: kept
            'memory.json': nowSec - 3600, // the memory itself: kept
            'notes.tmp': nowSec - 3600, // other name: kept
        };
        for (const [name, mtime] of Object.entries(files)) {
            const fp = path.join(dir, name);
            fs.writeFileSync(fp, name === 'memory.json' ? '{"memory":"m","turns":[]}' : 'partial');
            fs.utimesSync(fp, mtime, mtime);
        }
        const history = deferred();
        history.setStorageDir(dir);
        assert.deepEqual(listDir(dir), ['histories', 'memory.json', 'memory.json.5678.ffeeddccbbaa.tmp', 'notes.tmp', 'places.json.1234.aabbccddeeff.tmp']);
    });

    test('failure (a parent of dir is a file): no throw, console.warn, storage_ready stays false, save writes nothing', async () => {
        const blocker = path.join(botsDir, 'blocker');
        fs.writeFileSync(blocker, 'file');
        const history = deferred();
        assert.doesNotThrow(() => history.setStorageDir(path.join(blocker, 'world')));
        assert.equal(history.storage_ready, false);
        assert.ok(cap.of('warn').length >= 1, 'a console.warn is logged');
        assert.equal(await history.save(), false);
        assert.equal(history.load(), null);
        assert.equal(fs.readFileSync(blocker, 'utf8'), 'file');
    });
});

describe('archiveExisting(archiveDir)', () => {
    test('moves memory.json to `${archiveDir}/memory.json` (directory created) and returns the new path', () => {
        const history = newHistory();
        const content = '{"memory":"old","turns":[]}';
        fs.writeFileSync(history.memory_fp, content);
        const archiveDir = path.join(botsDir, '_archive', `${NAME}-20260927-130405`);
        const result = history.archiveExisting(archiveDir);
        assert.ok(typeof result === 'string' && samePath(result, path.join(archiveDir, 'memory.json')), String(result));
        assert.equal(fs.readFileSync(path.join(archiveDir, 'memory.json'), 'utf8'), content);
        assert.equal(fs.existsSync(path.join(botsDir, NAME, 'memory.json')), false, 'moved, not copied');
        assert.equal(history.load(), null);
    });

    test('an existing target gets the suffixes -1, -2 before .json', () => {
        const history = newHistory();
        const archiveDir = path.join(botsDir, 'arch');
        fs.mkdirSync(archiveDir);
        fs.writeFileSync(path.join(archiveDir, 'memory.json'), 'first');
        fs.writeFileSync(history.memory_fp, 'second');
        const r1 = history.archiveExisting(archiveDir);
        assert.ok(samePath(r1, path.join(archiveDir, 'memory-1.json')), String(r1));
        fs.writeFileSync(history.memory_fp, 'third');
        const r2 = history.archiveExisting(archiveDir);
        assert.ok(samePath(r2, path.join(archiveDir, 'memory-2.json')), String(r2));
        assert.deepEqual(
            ['memory.json', 'memory-1.json', 'memory-2.json'].map((f) => fs.readFileSync(path.join(archiveDir, f), 'utf8')),
            ['first', 'second', 'third'],
        );
    });

    test('nothing to move: returns null', () => {
        const history = newHistory();
        assert.equal(history.archiveExisting(path.join(botsDir, 'arch')), null);
    });

    test('works on the world directory set by setStorageDir', () => {
        const history = deferred();
        const dir = worldDir();
        history.setStorageDir(dir);
        fs.writeFileSync(path.join(dir, 'memory.json'), 'world');
        const archiveDir = path.join(botsDir, 'arch', 'worlds', 'seed-00000000000000aa');
        const result = history.archiveExisting(archiveDir);
        assert.ok(samePath(result, path.join(archiveDir, 'memory.json')));
        assert.equal(fs.existsSync(path.join(dir, 'memory.json')), false);
    });

    test('memory_fp null (deferred, no storage dir yet): returns null, no throw', () => {
        const history = deferred();
        let result;
        assert.doesNotThrow(() => {
            result = history.archiveExisting(path.join(botsDir, 'arch'));
        });
        assert.equal(result, null);
    });

    test('move fails (archive path is a file): returns null, no throw, original kept', () => {
        const history = newHistory();
        fs.writeFileSync(history.memory_fp, 'keep me');
        const blocker = path.join(botsDir, 'blocker');
        fs.writeFileSync(blocker, 'file');
        let result;
        assert.doesNotThrow(() => {
            result = history.archiveExisting(path.join(blocker, 'arch'));
        });
        assert.equal(result, null);
        assert.equal(fs.readFileSync(path.join(botsDir, NAME, 'memory.json'), 'utf8'), 'keep me');
    });
});
