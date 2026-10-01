// Part G of v0.1.4.10 (E5), section 2 of the spec: the five new keys in settings.js and in
// src/mindcraft/public/settings_spec.json with their defaults, types and rules. settings.js is the live
// configuration of the owner: its VALUES are never asserted, only that each key is there with a valid value
// (CLAUDE.md); the defaults are asserted in settings_spec.json. The warning of idle_jobs without job_memory.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';

const settings = (await loadSrc('settings.js')).default;
const SPEC = JSON.parse(fs.readFileSync(repoPath('src/mindcraft/public/settings_spec.json'), 'utf8'));

const isBool = (v) => typeof v === 'boolean';
// key, default, type in settings_spec.json, the values the setting may hold (the rules of section 2)
const TABLE = [
    ['job_memory', false, 'boolean', isBool],
    ['job_resume_seconds', 60, 'number', (v) => Number.isInteger(v) && v >= 10],
    ['idle_jobs', [], 'array', (v) => Array.isArray(v) && v.every((e) => typeof e === 'string')],
    ['idle_jobs_minutes', 15, 'number', (v) => Number.isInteger(v) && v >= 1],
    ['area_floors', false, 'boolean', isBool],
];

describe('section 2: the new keys in settings_spec.json', () => {
    for (const [key, def, type] of TABLE) {
        test(`${key}: type ${type}, default ${JSON.stringify(def)}, with a description`, () => {
            const entry = SPEC[key];
            assert.ok(entry, `${key} is in settings_spec.json`);
            assert.equal(entry.type, type);
            assert.deepEqual(entry.default, def);
            assert.equal(typeof entry.description, 'string');
            assert.ok(entry.description.trim().length > 20, entry.description);
        });
    }

    test('every new switch is off by default; the list is empty', () => {
        assert.equal(SPEC.job_memory.default, false);
        assert.equal(SPEC.area_floors.default, false);
        assert.deepEqual(SPEC.idle_jobs.default, []);
    });

    test('the defaults are valid values of the table', () => {
        for (const [key, , , valid] of TABLE) assert.ok(valid(SPEC[key].default), key);
    });

    test('the rules are named in the descriptions: 10 or more, 1 or more, a list of texts', () => {
        assert.match(SPEC.job_resume_seconds.description, /whole number of 10 or more/);
        assert.match(SPEC.idle_jobs_minutes.description, /whole number of 1 or more/);
        assert.match(SPEC.idle_jobs.description, /list of texts/);
        for (const key of ['job_resume_seconds', 'idle_jobs', 'idle_jobs_minutes']) assert.match(SPEC[key].description, /^With job_memory on: /, key);
    });

    test('the rules of the job module accept exactly the valid values (readJobSettings)', async () => {
        const J = await loadSrc('src/agent/job/job_logic.js');
        assert.deepEqual(J.readJobSettings({ job_resume_seconds: 10, idle_jobs: ['!farmCycle("farm")'], idle_jobs_minutes: 1 }),
            { resumeSeconds: 10, idleJobs: ['!farmCycle("farm")'], idleMinutes: 1 });
        assert.deepEqual(J.readJobSettings({ job_resume_seconds: 9, idle_jobs: 'x', idle_jobs_minutes: 0 }), { resumeSeconds: 60, idleJobs: [], idleMinutes: 15 });
        assert.deepEqual(J.readJobSettings({ job_resume_seconds: 30.5, idle_jobs_minutes: 2.5 }), { resumeSeconds: 60, idleJobs: [], idleMinutes: 15 });
    });
});

describe('section 2: the new keys in settings.js (the values of the owner are not asserted)', () => {
    for (const [key, , , valid] of TABLE) {
        test(`${key} exists and holds a valid value`, () => {
            assert.ok(Object.hasOwn(settings, key), `${key} is in settings.js`);
            assert.ok(valid(settings[key]), `${key}: ${JSON.stringify(settings[key])}`);
        });
    }

    test('the comment of each new key in settings.js says what it does', () => {
        const text = fs.readFileSync(repoPath('settings.js'), 'utf8');
        for (const [key] of TABLE) {
            const line = text.split(/\r?\n/).find((l) => l.includes(`"${key}"`));
            assert.ok(line, key);
            assert.match(line, /\/\/ \S.{20,}/, `${key}: ${line}`);
        }
    });
});

describe('idle_jobs without job_memory', () => {
    test('one warning at the start, word for word, in the agent', () => {
        const source = fs.readFileSync(repoPath('src/agent/agent.js'), 'utf8');
        assert.ok(source.includes("export const IDLE_JOBS_WARNING = 'idle_jobs needs job_memory. The list does not run.';"));
        assert.ok(source.includes('console.warn(IDLE_JOBS_WARNING);'));
    });
});
