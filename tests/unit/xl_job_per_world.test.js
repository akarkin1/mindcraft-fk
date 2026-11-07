// v0.1.4.14, the play of 2026-11-07: in a new world the bot said "I was farming. I go on." and ran the farming of the
// old world ("I know no farm here" every 5 s), and the note about the last exit came from the old world too. The job
// and the exit note live in the bot's folder of the world, bots/<name>/worlds/<seed>/, bound at spawn once the world
// is known; a new world starts from scratch. No timer stays open.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JobStore, JOB_FILE } from '../../src/agent/job/job_store.js';
import { createJob } from '../../src/agent/job/index.js';
import { ownFileOf, ownWorldDir } from '../../src/agent/memory_paths.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mc-job-world-'));
const JOB = { version: 1, kind: 'farmCycle', command: '!farmCycle("")', args: [''], wanted: null, got: 0, words: 'the farming', state: 'running', by: 'player' };

describe('the job file of a world', () => {
    test('bots/<name>/worlds/<seed>/job.json, beside the memory of the world', () => {
        assert.equal(ownFileOf('claude', 'seed-5e68c4284dbcbdb2', JOB_FILE), './bots/claude/worlds/seed-5e68c4284dbcbdb2/job.json');
        assert.equal(ownWorldDir('claude', 'seed-5e68c4284dbcbdb2'), './bots/claude/worlds/seed-5e68c4284dbcbdb2');
    });

    test('bind reads the file of the world and drops a job held in memory', () => {
        const dir = tmp();
        try {
            const old = new JobStore(path.join(dir, 'old', JOB_FILE));
            assert.ok(old.set(JOB), 'the job of the old world is written');
            const store = new JobStore(null);
            assert.ok(store.set(JOB), 'a store in memory keeps a job');
            assert.equal(store.bind(path.join(dir, 'new', JOB_FILE)), null, 'the new world has no job: nothing resumes');
            assert.equal(store.get(), null);
            assert.equal(store.filePath, path.join(dir, 'new', JOB_FILE));
            assert.ok(store.set({ ...JOB, kind: 'mineOre', command: '!mineOre("iron", 4)', args: ['iron', 4], wanted: 4, words: 'the mining' }));
            assert.ok(fs.existsSync(path.join(dir, 'new', JOB_FILE)), 'the job of the new world is written in its folder');
            assert.ok(fs.existsSync(path.join(dir, 'old', JOB_FILE)), 'the job of the old world is left where it is');
            const back = new JobStore(null);
            assert.equal(back.bind(path.join(dir, 'old', JOB_FILE))?.kind, 'farmCycle', 'back in the old world its job is there');
            assert.equal(back.bind(null), null, 'null makes the store live in memory');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('the job object binds through its store; onRestart says nothing in a world without a job', () => {
        const dir = tmp();
        try {
            new JobStore(path.join(dir, 'old', JOB_FILE)).set(JOB);
            const said = [];
            const job = createJob({ sayText: (t) => said.push(t), bot: {} }, new JobStore(null), { settings: { job_memory: true }, now: () => 0 });
            assert.equal(job.bind(path.join(dir, 'new', JOB_FILE)), null);
            assert.deepEqual(job.onRestart(), { ok: true, reason: 'no_job', text: '' });
            assert.deepEqual(said, []);
            assert.equal(job.bind(path.join(dir, 'old', JOB_FILE))?.kind, 'farmCycle');
            assert.equal(job.onRestart().reason, 'running');
            assert.ok(said.some((t) => /I was farming\. I go on\./.test(t)), JSON.stringify(said));
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('the agent binds the job and the exit note to the world at spawn, after the world is known', () => {
        const src = fs.readFileSync(new URL('../../src/agent/agent.js', import.meta.url), 'utf8');
        assert.ok(src.includes('new JobStore(settings.world_memory ? null : `./bots/${this.name}/${JOB_FILE}`)'), 'the store starts without a file with world_memory');
        const resolve = src.indexOf('save_data = await this._resolveWorld(load_mem);');
        const bind = src.indexOf('this._bindJobToWorld();');
        const spawnSteps = src.indexOf('const restart_note = await this._atSpawn();');
        assert.ok(resolve > 0 && resolve < bind && bind < spawnSteps, 'resolve the world, bind the job, then the restart note');
        assert.ok(src.includes('readExit(this._worldStateDir())'), 'the exit note is read from the world folder');
        assert.ok(src.includes('writeExit(this._worldStateDir(), {'), 'the exit note is written into the world folder');
        assert.ok(!src.includes('readExit(`./bots/${this.name}`)') && !src.includes('writeExit(`./bots/${this.name}`, {'), 'the old bot-folder calls are gone');
    });
});
