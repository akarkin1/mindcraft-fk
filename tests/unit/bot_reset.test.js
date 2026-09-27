// Spec v0.1.4.3 W13: src/utils/bot_reset.js -- planReset (reads, changes nothing) and applyReset
// (moves with rename, never deletes, never throws). The command line entry scripts/bot_reset.js
// is not started here.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { writeTree, listFiles, snapshot, relSlash, samePath } from '../helpers/tree.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const MODULE = 'src/utils/bot_reset.js';
const BR = await loadSrc(MODULE);

function api(name) {
    const fn = BR[name];
    assert.equal(typeof fn, 'function', `${name} must be an exported function`);
    return fn;
}

const NAME = 'andy';
const NOW = new Date(Date.UTC(2026, 8, 27, 13, 4, 5));
const STAMP = '20260927-130405';
const KEY_A = 'seed-00000000000000aa';
const KEY_H = 'id-Home';

const INDEX = {
    version: 1,
    last_key: KEY_A,
    worlds: {
        [KEY_A]: { key: KEY_A, label: 'Alpha Server', label_source: 'auto', source: 'seed', hashed_seed: '00000000000000aa', first_seen: '2026-09-01T00:00:00.000Z', last_seen: '2026-09-02T00:00:00.000Z', visits: 2, is_hardcore: false, is_flat: false, last_age: 100 },
        [KEY_H]: { key: KEY_H, label: 'My Home', label_source: 'manual', source: 'override', hashed_seed: null, first_seen: '2026-09-01T00:00:00.000Z', last_seen: '2026-09-01T00:00:00.000Z', visits: 1, is_hardcore: null, is_flat: null, last_age: null },
    },
};

const TREE = {
    'andy/memory.json': '{"memory":"root"}',
    'andy/histories/h1.json': '[]',
    'andy/resume_guard.json': '{"version":1,"prompt":"p","resumes":[]}',
    'andy/skills/build.js': '// skill',
    'andy/other.txt': 'unrelated',
    'andy/worlds/index.json': INDEX,
    [`andy/worlds/${KEY_A}/memory.json`]: '{"memory":"A"}',
    [`andy/worlds/${KEY_A}/histories/x.json`]: '[]',
    [`andy/worlds/${KEY_A}/places.json`]: '{"version":1,"places":{}}',
    [`andy/worlds/${KEY_H}/memory.json`]: '{"memory":"H"}',
    [`andy/worlds/${KEY_H}/places.json`]: '{"version":1,"places":{}}',
    'bob/memory.json': '{"memory":"bob"}',
};

let botsDir;
let cap;
beforeEach(() => {
    botsDir = makeTmpDir();
    writeTree(botsDir, TREE);
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
    removeTmpDir(botsDir);
});

const botDir = () => path.join(botsDir, NAME);
const expectedArchive = () => `${botsDir}/_archive/${NAME}-${STAMP}`;

async function plan(options) {
    return await api('planReset')({ botsDir, name: NAME, now: () => NOW, ...options });
}

// Moves as sorted 'from' paths relative to the bot directory; checks that every 'to' mirrors its 'from'.
function movedPaths(p) {
    assert.ok(Array.isArray(p.moves), 'moves is an array');
    const rels = [];
    for (const move of p.moves) {
        const rel = relSlash(botDir(), move.from);
        assert.ok(!rel.startsWith('..'), `from lies in the bot directory: ${move.from}`);
        assert.ok(samePath(move.to, path.join(p.archiveDir, ...rel.split('/').filter(Boolean))), `to mirrors from: ${move.from} -> ${move.to}`);
        rels.push(rel);
    }
    return rels.sort();
}

function assertNoChange(before) {
    assert.deepEqual(snapshot(botsDir), before, 'planReset changed nothing on disk');
}

describe('planReset: selections', () => {
    test('archiveDir is `${botsDir}/_archive/${name}-${stamp}` with a UTC stamp', async () => {
        const p = await plan({ memory: true });
        assert.ok(samePath(p.archiveDir, expectedArchive()), p.archiveDir);
        assert.deepEqual(p.errors, []);
    });

    test('all: the whole bot directory as one move', async () => {
        const before = snapshot(botsDir);
        const p = await plan({ all: true });
        assert.deepEqual(p.errors, []);
        assert.equal(p.moves.length, 1);
        assert.ok(samePath(p.moves[0].from, botDir()));
        assert.ok(samePath(p.moves[0].to, p.archiveDir));
        assertNoChange(before);
    });

    test('memory: root memory.json, histories, resume_guard.json and memory.json/histories of every world', async () => {
        const before = snapshot(botsDir);
        const p = await plan({ memory: true });
        assert.deepEqual(movedPaths(p), [
            'histories',
            'memory.json',
            'resume_guard.json',
            `worlds/${KEY_H}/memory.json`,
            `worlds/${KEY_A}/histories`,
            `worlds/${KEY_A}/memory.json`,
        ].sort());
        assert.deepEqual(p.errors, []);
        assertNoChange(before);
    });

    test('places: places.json of every world', async () => {
        const p = await plan({ places: true });
        assert.deepEqual(movedPaths(p), [`worlds/${KEY_H}/places.json`, `worlds/${KEY_A}/places.json`].sort());
    });

    test('skills: the skills directory', async () => {
        const p = await plan({ skills: true });
        assert.deepEqual(movedPaths(p), ['skills']);
    });

    test('memory + places + skills: the union', async () => {
        const p = await plan({ memory: true, places: true, skills: true });
        assert.deepEqual(movedPaths(p), [
            'histories', 'memory.json', 'resume_guard.json', 'skills',
            `worlds/${KEY_H}/memory.json`, `worlds/${KEY_H}/places.json`,
            `worlds/${KEY_A}/histories`, `worlds/${KEY_A}/memory.json`, `worlds/${KEY_A}/places.json`,
        ].sort());
    });

    test('places with world by key: only that world', async () => {
        const p = await plan({ places: true, world: KEY_H });
        assert.deepEqual(movedPaths(p), [`worlds/${KEY_H}/places.json`]);
    });

    test('memory with world by label: ONLY the memory.json and histories of that world (Amendment 1, M3)', async () => {
        const p = await plan({ memory: true, world: 'Alpha Server' });
        assert.deepEqual(movedPaths(p), [`worlds/${KEY_A}/histories`, `worlds/${KEY_A}/memory.json`].sort());
        assert.deepEqual(p.errors, []);
    });

    test('memory + places with world by key: only that world, no bot-level files (M3)', async () => {
        const p = await plan({ memory: true, places: true, world: KEY_H });
        assert.deepEqual(movedPaths(p), [`worlds/${KEY_H}/memory.json`, `worlds/${KEY_H}/places.json`].sort());
    });

    test('all together with an existing world: all wins, one move, removeWorldKeys empty (M3)', async () => {
        const p = await plan({ all: true, world: KEY_A });
        assert.deepEqual(p.errors, []);
        assert.equal(p.moves.length, 1);
        assert.ok(samePath(p.moves[0].from, botDir()));
        assert.deepEqual(p.removeWorldKeys, []);
    });

    test('all together with an unknown world: the world is still checked, error (M3)', async () => {
        const p = await plan({ all: true, world: 'nowhere' });
        assert.ok(p.errors.length >= 1);
        assert.deepEqual(p.moves, []);
    });

    test('a label that matches more than one world is an error listing the matching keys (M3)', async () => {
        const KEY_B = 'seed-00000000000000bb';
        const index = JSON.parse(JSON.stringify(INDEX));
        index.worlds[KEY_B] = { ...index.worlds[KEY_A], key: KEY_B, label: 'ALPHA server', hashed_seed: '00000000000000bb' };
        writeTree(botsDir, { 'andy/worlds/index.json': index, [`andy/worlds/${KEY_B}/places.json`]: '{"version":1,"places":{}}' });
        const before = snapshot(botsDir);
        for (const options of [{ world: 'Alpha Server' }, { world: 'alpha server', places: true }]) {
            const p = await plan(options);
            assert.ok(p.errors.length >= 1, JSON.stringify(options));
            const text = p.errors.join(' | ');
            assert.ok(text.includes(KEY_A) && text.includes(KEY_B), text);
            assert.deepEqual(p.moves, []);
        }
        assertNoChange(before);
    });

    test('world only, by key: the whole world directory, key in removeWorldKeys', async () => {
        const before = snapshot(botsDir);
        const p = await plan({ world: KEY_A });
        assert.deepEqual(movedPaths(p), [`worlds/${KEY_A}`]);
        assert.deepEqual(p.removeWorldKeys, [KEY_A]);
        assert.deepEqual(p.errors, []);
        assertNoChange(before);
    });

    test('world only, by label without regard to case', async () => {
        const p = await plan({ world: 'mY hOME' });
        assert.deepEqual(movedPaths(p), [`worlds/${KEY_H}`]);
        assert.deepEqual(p.removeWorldKeys, [KEY_H]);
    });

    test('only existing paths are listed', async () => {
        fs.rmSync(path.join(botDir(), 'skills'), { recursive: true });
        fs.rmSync(path.join(botDir(), 'resume_guard.json'));
        const p = await plan({ skills: true });
        assert.deepEqual(p.moves, []);
        assert.deepEqual(p.errors, []);
        const m = await plan({ memory: true });
        assert.ok(!movedPaths(m).includes('resume_guard.json'));
    });

    test('bot without worlds directory: memory selection lists the bot-level files only', async () => {
        writeTree(botsDir, { 'solo/memory.json': '{}' });
        const p = await api('planReset')({ botsDir, name: 'solo', memory: true, now: () => NOW });
        assert.deepEqual(p.errors, []);
        assert.equal(p.moves.length, 1);
        assert.ok(samePath(p.moves[0].from, path.join(botsDir, 'solo', 'memory.json')));
    });
});

describe('planReset: errors (moves empty)', () => {
    const CASES = [
        ['missing name', { name: undefined, memory: true }],
        ['empty name', { name: '', memory: true }],
        ['name too short', { name: 'ab', memory: true }],
        ['name too long (17)', { name: 'a'.repeat(17), memory: true }],
        ['name with a dash', { name: 'bad-name', memory: true }],
        ['name with a path', { name: '../andy', memory: true }],
        ['bot directory not found', { name: 'nobody', memory: true }],
        ['world not found', { world: 'nowhere', memory: true }],
        ['world key with other case is not a key match', { world: 'SEED-00000000000000AA' }],
        ['nothing selected', {}],
    ];
    for (const [label, options] of CASES) {
        test(`${label}: errors non-empty, moves empty, disk unchanged`, async () => {
            const before = snapshot(botsDir);
            const p = await plan(options);
            assert.ok(Array.isArray(p.errors) && p.errors.length >= 1, JSON.stringify(p.errors));
            for (const e of p.errors) assert.equal(typeof e, 'string');
            assert.deepEqual(p.moves, []);
            assertNoChange(before);
        });
    }

    test('the name _archive is refused (Amendment 1, M3)', async () => {
        writeTree(botsDir, { '_archive/andy-20260101-000000/memory.json': '{}', '_archive/memory.json': '{}' });
        const before = snapshot(botsDir);
        for (const options of [{ memory: true }, { all: true }]) {
            const p = await api('planReset')({ botsDir, name: '_archive', now: () => NOW, ...options });
            assert.ok(Array.isArray(p.errors) && p.errors.length >= 1, JSON.stringify(p.errors));
            assert.deepEqual(p.moves, []);
        }
        assertNoChange(before);
    });

    for (const name of ['abc', 'a'.repeat(16), 'Andy_2']) {
        test(`valid name ${JSON.stringify(name)} of an existing bot: no errors`, async () => {
            writeTree(botsDir, { [`${name}/memory.json`]: '{}' });
            const p = await api('planReset')({ botsDir, name, memory: true, now: () => NOW });
            assert.deepEqual(p.errors, []);
        });
    }
});

describe('applyReset(plan)', () => {
    test('memory: every planned path moved into the archive, content intact, nothing deleted', async () => {
        const before = snapshot(botsDir);
        const countBefore = listFiles(botsDir).length;
        const p = await plan({ memory: true });
        const result = await api('applyReset')(p);
        assert.deepEqual(result.failed, []);
        assert.equal(result.moved.length, p.moves.length);
        assert.equal(listFiles(botsDir).length, countBefore, 'total number of files unchanged');
        const archiveRel = relSlash(botsDir, p.archiveDir);
        for (const move of p.moves) assert.equal(fs.existsSync(move.from), false, `moved away: ${move.from}`);
        assert.equal(fs.readFileSync(path.join(p.archiveDir, 'memory.json'), 'utf8'), before['andy/memory.json']);
        assert.equal(fs.readFileSync(path.join(p.archiveDir, 'worlds', KEY_A, 'memory.json'), 'utf8'), before[`andy/worlds/${KEY_A}/memory.json`]);
        const after = snapshot(botsDir);
        assert.equal(after[`${archiveRel}/worlds/${KEY_A}/histories/x.json`], '[]');
        assert.equal(after[`andy/worlds/${KEY_A}/places.json`], before[`andy/worlds/${KEY_A}/places.json`], 'places stay');
        assert.equal(after['andy/skills/build.js'], '// skill', 'skills stay');
        assert.equal(after['bob/memory.json'], before['bob/memory.json'], 'other bot untouched');
    });

    test('all: the bot directory is moved as a whole, file count unchanged', async () => {
        const countBefore = listFiles(botsDir).length;
        const p = await plan({ all: true });
        const result = await api('applyReset')(p);
        assert.deepEqual(result.failed, []);
        assert.equal(result.moved.length, 1);
        assert.equal(fs.existsSync(botDir()), false);
        assert.equal(listFiles(botsDir).length, countBefore);
        assert.equal(fs.readFileSync(path.join(p.archiveDir, 'other.txt'), 'utf8'), 'unrelated');
    });

    test('world only: world directory moved and its key removed from index.json, other worlds kept', async () => {
        const countBefore = listFiles(botsDir).length;
        const p = await plan({ world: 'Alpha Server' });
        const result = await api('applyReset')(p);
        assert.deepEqual(result.failed, []);
        assert.equal(fs.existsSync(path.join(botDir(), 'worlds', KEY_A)), false);
        assert.ok(fs.existsSync(path.join(p.archiveDir, 'worlds', KEY_A, 'places.json')));
        const index = JSON.parse(fs.readFileSync(path.join(botDir(), 'worlds', 'index.json'), 'utf8'));
        assert.deepEqual(Object.keys(index.worlds), [KEY_H]);
        assert.deepEqual(index.worlds[KEY_H], INDEX.worlds[KEY_H]);
        assert.equal(index.last_key, null, 'last_key pointed to the removed world (Amendment 1, M3)');
        assert.equal(listFiles(botsDir).length, countBefore);
    });

    test('world only, another world than last_key: last_key kept', async () => {
        const p = await plan({ world: KEY_H });
        const result = await api('applyReset')(p);
        assert.deepEqual(result.failed, []);
        const index = JSON.parse(fs.readFileSync(path.join(botDir(), 'worlds', 'index.json'), 'utf8'));
        assert.deepEqual(Object.keys(index.worlds), [KEY_A]);
        assert.equal(index.last_key, KEY_A);
    });

    test('a move that fails is reported in failed with an error text, the others still happen, no throw', async () => {
        const p = await plan({ places: true });
        const missing = path.join(botDir(), 'worlds', 'seed-00000000000000ff', 'places.json');
        const broken = { ...p, moves: [{ from: missing, to: path.join(p.archiveDir, 'worlds', 'seed-00000000000000ff', 'places.json') }, ...p.moves] };
        let result;
        await assert.doesNotReject(async () => {
            result = await api('applyReset')(broken);
        });
        assert.equal(result.failed.length, 1);
        assert.ok(samePath(result.failed[0].from, missing));
        assert.equal(typeof result.failed[0].error, 'string');
        assert.ok(result.failed[0].error.length > 0);
        assert.equal(result.moved.length, p.moves.length);
    });

    test('never throws for a bad argument', async () => {
        const fn = api('applyReset');
        for (const bad of [undefined, null, {}, { moves: 'x' }]) {
            await assert.doesNotReject(async () => {
                await fn(bad);
            }, String(bad));
        }
        assert.equal(listFiles(botsDir).length, Object.keys(TREE).length);
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
