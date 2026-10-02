// Tester T1 of v0.1.4.10 "Goals", from the spec (I1): the job record in job.json, written by JobStore(filePath)
// with load(), set(job), clear(), get(). On a temp folder under os.tmpdir(), never under bots/.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';

const S = await loadSrc('src/agent/job/job_store.js');
const J = await loadSrc('src/agent/job/job_logic.js');

let dir;
let file;
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gj-store-'));
    file = path.join(dir, 'job.json');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('I1: JobStore', () => {
    test('the file is job.json', () => {
        assert.equal(S.JOB_FILE, 'job.json');
    });

    test('set writes the record of I1; a new store loads it', () => {
        const store = new S.JobStore(file, { now: () => new Date('2026-10-01T10:00:00Z') });
        assert.equal(store.load(), null, 'no file: no job');
        const job = J.jobOf('!mineOre', ['iron', 16], { text: '!mineOre("iron", 16)', now: '2026-10-01T10:00:00.000Z' });
        job.got = 6;
        job.steps = [{ command: '!chopTrees(4)', check: { item: 'oak_log', count: 4 }, state: 'todo' }];
        assert.ok(store.set(job));
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.equal(raw.version, 1);
        for (const key of ['kind', 'command', 'args', 'wanted', 'got', 'words', 'state', 'by', 'started', 'updated', 'steps', 'plans']) {
            assert.ok(key in raw, key);
        }
        assert.deepEqual([raw.kind, raw.command, raw.wanted, raw.got, raw.words, raw.state, raw.by, raw.plans],
            ['mineOre', '!mineOre("iron", 16)', 16, 6, 'the mining', 'running', 'player', 0]);
        assert.deepEqual(raw.steps, [{ command: '!chopTrees(4)', check: { item: 'oak_log', count: 4 }, state: 'todo' }]);
        assert.equal(typeof raw.started, 'string');
        assert.equal(typeof raw.updated, 'string');

        const again = new S.JobStore(file);
        const loaded = again.load();
        assert.equal(loaded.kind, 'mineOre');
        assert.equal(loaded.got, 6);
        assert.deepEqual(again.get(), loaded);
    });

    test('clear forgets the job and removes the file', () => {
        const store = new S.JobStore(file);
        store.set(J.jobOf('!farmCycle', ['farm']));
        assert.ok(fs.existsSync(file));
        store.clear();
        assert.equal(store.get(), null);
        assert.equal(fs.existsSync(file), false);
        assert.equal(new S.JobStore(file).load(), null);
    });

    test('a corrupt file gives no job and never throws', () => {
        fs.writeFileSync(file, '{ not json');
        const cap = captureConsole();
        try {
            const store = new S.JobStore(file);
            assert.equal(store.load(), null);
            assert.equal(store.get(), null);
        } finally {
            cap.restore();
        }
    });

    test('a record that is no job is not saved', () => {
        const store = new S.JobStore(file);
        assert.equal(store.set({ kind: 'followPlayer', command: '!followPlayer("p")' }), null);
        assert.equal(store.get(), null);
    });
});
