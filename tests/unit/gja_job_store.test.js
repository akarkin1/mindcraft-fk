// Spec v0.1.4.10 part J (engineer E1): the job record in job.json, src/agent/job/job_store.js (I1), on a
// temporary folder.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';

const S = await loadSrc('src/agent/job/job_store.js');
const L = await loadSrc('src/agent/job/job_logic.js');

const dirs = [];
const tmpFile = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gja-job-'));
    dirs.push(dir);
    return path.join(dir, S.JOB_FILE);
};
const clock = (iso = '2026-10-01T12:00:00.000Z') => () => new Date(iso);

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
    for (const dir of dirs) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('JobStore', () => {
    test('the file name is job.json', () => {
        assert.equal(S.JOB_FILE, 'job.json');
    });

    test('set writes the record of I1 and load reads it back', () => {
        const file = tmpFile();
        const store = new S.JobStore(file, { now: clock() });
        assert.equal(store.load(), null);
        const job = { ...L.jobOf('!mineOre', ['iron', 16], { now: '2026-10-01T11:00:00.000Z' }), got: 6 };
        job.steps = [{ command: '!chopTrees(4)', check: { item: 'log', count: 4 }, state: 'todo' }, { command: '!getTool("axe")', check: { item: 'axe', count: null }, state: 'todo', fails: 1 }];
        const saved = store.set(job);
        assert.equal(saved.updated, '2026-10-01T12:00:00.000Z');
        assert.equal(saved.started, '2026-10-01T11:00:00.000Z');
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.equal(raw.version, 1);
        for (const key of ['kind', 'command', 'args', 'wanted', 'got', 'words', 'state', 'by', 'started', 'updated', 'steps', 'plans']) {
            assert.ok(key in raw, key);
        }
        const again = new S.JobStore(file).load();
        assert.deepEqual(again, saved);
        assert.equal(again.got, 6);
        assert.deepEqual(again.steps, job.steps);
    });

    test('get gives a copy', () => {
        const store = new S.JobStore(null);
        store.set(L.jobOf('!farmCycle', ['']));
        const a = store.get();
        a.state = 'left';
        assert.equal(store.get().state, 'running');
    });

    test('an invalid job is not saved', () => {
        const store = new S.JobStore(null);
        assert.equal(store.set({ kind: 'dance', command: '!dance' }), null);
        assert.equal(store.set(null), null);
        assert.equal(store.get(), null);
    });

    test('the fields beyond I1 survive', () => {
        const store = new S.JobStore(tmpFile());
        store.set({ ...L.jobOf('!mineOre', ['iron', 8]), skillDone: true, fails: 2, failText: 'x', blocker: { kind: 'no_torches', item: 'torch' }, chainAt: '2026-10-01T12:00:00.000Z' });
        const job = new S.JobStore(store.filePath).load();
        assert.equal(job.skillDone, true);
        assert.equal(job.fails, 2);
        assert.deepEqual(job.blocker, { kind: 'no_torches', item: 'torch' });
        assert.equal(job.chainAt, '2026-10-01T12:00:00.000Z');
    });

    test('clear removes the job and the file', () => {
        const file = tmpFile();
        const store = new S.JobStore(file);
        store.set(L.jobOf('!farmCycle', ['']));
        assert.equal(fs.existsSync(file), true);
        assert.equal(store.clear(), true);
        assert.equal(store.get(), null);
        assert.equal(fs.existsSync(file), false);
        assert.equal(store.clear(), false);
    });

    test('a corrupt file is set aside and gives no job', () => {
        const file = tmpFile();
        fs.writeFileSync(file, '{ not json');
        const store = new S.JobStore(file);
        assert.equal(store.load(), null);
        assert.equal(fs.existsSync(file), false);
    });
});
