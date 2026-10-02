// Tester T1 of v0.1.4.10 "Goals", from the spec (section 2, section 9 and the switch rule of section 0): every row of
// the settings table in settings.js and settings_spec.json, and every switch off.
//
// settings.js is the owner's live configuration (CLAUDE.md): its values are not asserted, only that each key exists
// with a valid value of its type. settings_spec.json holds the defaults in code: they are asserted exactly.
//
// The switches off:
//   job_memory: agent.job is null (no object, no tick) and executeCommand runs a command as before;
//   area_floors: the old scan (tests/unit/gj_areas.test.js asserts the scan itself; here the glue passes floors only
//   with the switch on).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { captureConsole } from '../helpers/console_capture.js';
import { loadGlue, makeGlueAgent } from '../helpers/st_glue_env.js';

const settings = (await loadSrc('settings.js')).default;
const spec = JSON.parse(fs.readFileSync(repoPath('src/mindcraft/public/settings_spec.json'), 'utf8'));

const isInt = (v) => Number.isInteger(v);
// key, default, type in settings_spec.json, valid(value) for settings.js (section 2)
const ROWS = [
    ['job_memory', false, 'boolean', (v) => typeof v === 'boolean'],
    ['job_resume_seconds', 60, 'number', (v) => isInt(v) && v >= 10],
    ['idle_jobs', [], 'array', (v) => Array.isArray(v) && v.every((e) => typeof e === 'string')],
    ['idle_jobs_minutes', 15, 'number', (v) => isInt(v) && v >= 1],
    ['area_floors', false, 'boolean', (v) => typeof v === 'boolean'],
];

describe('section 2: the settings in settings.js', () => {
    for (const [key, , , valid] of ROWS) {
        test(`${key} exists with a valid value`, () => {
            assert.ok(Object.hasOwn(settings, key), `settings.js has no ${key}`);
            assert.ok(valid(settings[key]), `${key}: ${JSON.stringify(settings[key])}`);
        });
    }
});

describe('section 2: the settings in settings_spec.json', () => {
    for (const [key, def, type] of ROWS) {
        test(`${key}: type ${type}, default ${JSON.stringify(def)}`, () => {
            const entry = spec[key];
            assert.ok(entry, `settings_spec.json has no ${key}`);
            assert.equal(entry.type, type);
            assert.deepEqual(entry.default, def);
            assert.equal(typeof entry.description, 'string');
            assert.ok(entry.description.length > 0);
        });
    }

    test('the switches are off by default', () => {
        assert.equal(spec.job_memory?.default, false);
        assert.equal(spec.area_floors?.default, false);
    });
});

describe('section 2: the job reads its settings with the defaults of the table', () => {
    test('readJobSettings: the defaults, and the limits int >= 10 and int >= 1', async () => {
        const J = await loadSrc('src/agent/job/job_logic.js');
        assert.deepEqual(J.readJobSettings({}), { resumeSeconds: 60, idleJobs: [], idleMinutes: 15 });
        assert.equal(J.readJobSettings({ job_resume_seconds: 9 }).resumeSeconds, 60);
        assert.equal(J.readJobSettings({ job_resume_seconds: 10 }).resumeSeconds, 10);
        assert.equal(J.readJobSettings({ idle_jobs_minutes: 0 }).idleMinutes, 15);
        assert.equal(J.readJobSettings({ idle_jobs_minutes: 1 }).idleMinutes, 1);
        assert.deepEqual(J.readJobSettings({ idle_jobs: ['!farmCycle("farm")'] }).idleJobs, ['!farmCycle("farm")']);
    });
});

// ------------------------------------------------------------------------------------------------ switches off

describe('job_memory off: agent.job is null', () => {
    const source = fs.readFileSync(repoPath('src/agent/agent.js'), 'utf8');

    test('agent.js sets this.job to null and makes it with createJob only behind job_memory', () => {
        const nullAt = source.indexOf('this.job = null');
        const guardAt = source.search(/if\s*\(\s*settings\.job_memory\s*(===\s*true\s*)?\)/);
        const createAt = source.indexOf('createJob(');
        assert.ok(nullAt >= 0, 'this.job = null');
        assert.ok(guardAt >= 0, 'if (settings.job_memory ...)');
        assert.ok(createAt >= 0, 'createJob(...)');
        assert.ok(nullAt < guardAt && guardAt < createAt, 'null first, then the guard, then createJob');
        const calls = source.split('createJob(').length - 1;
        assert.equal(calls, 1, 'one call of createJob');
    });

    test('every use of the job in agent.js is guarded', () => {
        for (const rel of ['src/agent/agent.js']) {
            const lines = fs.readFileSync(repoPath(rel), 'utf8').split('\n');
            lines.forEach((line, i) => {
                const m = line.match(/\b(this|agent)\.job\.(\w+)\(/);
                if (!m) return;
                const before = lines.slice(Math.max(0, i - 12), i + 1).join('\n');
                assert.ok(/!\s*(this|agent)\.job\b|\bif\s*\(\s*(this|agent)\.job\b|\bif\s*\(\s*job\b|job\s*\?|\(\s*job\s*\)/.test(before),
                    `${rel}:${i + 1} uses ${m[0]} without a guard`);
            });
        }
    });

    test('executeCommand with agent.job null runs a command as before', async () => {
        const cap = captureConsole();
        try {
            const G = await loadGlue();
            G.settingsModule.setSettings({ job_memory: false, blocked_actions: [] });
            const agent = makeGlueAgent(G);
            agent.job = null;
            const out = await G.index.executeCommand(agent, '!inventory', { typed: true, by: 'player' });
            assert.equal(typeof out, 'string');
            assert.ok(out.length > 0);
        } finally {
            cap.restore();
        }
    });

    test('with a job (job_memory on) the same command goes through onCommand and onResult', async () => {
        const cap = captureConsole();
        try {
            const G = await loadGlue();
            G.settingsModule.setSettings({ job_memory: true, blocked_actions: [] });
            const agent = makeGlueAgent(G);
            const calls = [];
            agent.job = {
                onCommand: (...args) => { calls.push(['onCommand', ...args]); return { ok: true, reason: null, text: '' }; },
                onResult: async (...args) => { calls.push(['onResult', args[0]]); return { ok: true, reason: null, text: '' }; },
            };
            await G.index.executeCommand(agent, '!inventory', { typed: true, by: 'player' });
            await new Promise((resolve) => setImmediate(resolve));
            assert.deepEqual(calls.map((c) => c[0]), ['onCommand', 'onResult']);
            assert.equal(calls[0][1], '!inventory');
        } finally {
            cap.restore();
        }
    });
});

describe('area_floors off: the old scan', () => {
    test('the glue passes floors: true only with area_floors on', () => {
        const source = fs.readFileSync(repoPath('src/agent/commands/actions.js'), 'utf8');
        assert.match(source, /area_floors\s*===\s*true/);
        const lines = source.split('\n').filter((l) => /floors\s*:\s*true/.test(l));
        assert.ok(lines.length > 0, 'floors: true is passed somewhere');
        for (const line of lines) assert.match(line, /area_floors/, `unguarded: ${line.trim()}`);
    });
});
