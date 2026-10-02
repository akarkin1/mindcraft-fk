// The job of the bot (spec v0.1.4.10, I1), persisted as the record itself in bots/<name>/job.json. One
// job at a time. Beyond I1 a record may hold: skillDone (the skill said the job is done), fails and
// failText (the same failure in a row), blocker ({ kind, item } of the last plan), chainAt (ISO time when
// the bot itself went on: a plan was made or a step was done). Never throws.
import fs from 'node:fs';
import { readJsonSafe, writeJsonAtomic } from '../../utils/safe_json.js';
import { JOB_KINDS, JOB_STATES } from './job_logic.js';

/** The name of the file in the folder of the bot. */
export const JOB_FILE = 'job.json';
/** The states of a step. */
export const STEP_STATES = Object.freeze(['todo', 'done', 'failed']);

const FILE_VERSION = 1;

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function copy(value) {
    return JSON.parse(JSON.stringify(value));
}

function cleanStep(step) {
    if (!isPlainObject(step) || typeof step.command !== 'string' || step.command.length === 0) {
        return null;
    }
    const check = isPlainObject(step.check) ? step.check : {};
    const out = {
        command: step.command,
        check: { item: typeof check.item === 'string' ? check.item : null, count: isFiniteNumber(check.count) ? check.count : null },
        state: STEP_STATES.includes(step.state) ? step.state : 'todo',
    };
    if (Number.isInteger(step.fails) && step.fails > 0) {
        out.fails = step.fails; // the failed runs of the step (T3-1: a failed step is tried once more)
    }
    return out;
}

/**
 * The clean record to store, or null when it is no job: a known kind, a command text, a state.
 * @param {object} job
 * @param {string} now ISO time for updated (and started when it has none)
 * @returns {object|null}
 */
function validateJob(job, now) {
    if (!isPlainObject(job) || !JOB_KINDS.includes(job.kind) || typeof job.command !== 'string' || job.command.length === 0) {
        return null;
    }
    const wanted = isFiniteNumber(job.wanted) ? job.wanted : null;
    const out = {
        version: FILE_VERSION,
        kind: job.kind,
        command: job.command,
        args: Array.isArray(job.args) ? copy(job.args) : [],
        wanted,
        got: wanted === null ? null : (isFiniteNumber(job.got) ? job.got : 0),
        words: typeof job.words === 'string' ? job.words : '',
        state: JOB_STATES.includes(job.state) ? job.state : 'running',
        by: job.by === 'model' ? 'model' : 'player',
        started: typeof job.started === 'string' ? job.started : now,
        updated: now,
        steps: (Array.isArray(job.steps) ? job.steps : []).map(cleanStep).filter(Boolean),
        plans: Number.isInteger(job.plans) && job.plans >= 0 ? job.plans : 0,
    };
    if (job.skillDone === true) {
        out.skillDone = true;
    }
    if (Number.isInteger(job.fails) && job.fails > 0 && typeof job.failText === 'string') {
        out.fails = job.fails;
        out.failText = job.failText;
    }
    if (isPlainObject(job.blocker) && typeof job.blocker.kind === 'string') {
        out.blocker = { kind: job.blocker.kind, item: typeof job.blocker.item === 'string' ? job.blocker.item : null };
    }
    if (typeof job.chainAt === 'string') {
        out.chainAt = job.chainAt;
    }
    return out;
}

export class JobStore {
    /**
     * @param {string|null} filePath usually bots/<name>/job.json; without it the store lives in memory only
     * @param {{now?: () => Date}} [options]
     */
    constructor(filePath, options = {}) {
        this.filePath = typeof filePath === 'string' && filePath.length > 0 ? filePath : null;
        const now = options?.now;
        this.now = typeof now === 'function' ? now : () => new Date();
        this._job = null;
    }

    _nowIso() {
        try {
            const value = this.now();
            return (value instanceof Date ? value : new Date(value)).toISOString();
        } catch {
            return new Date().toISOString();
        }
    }

    /**
     * Reads the file. Missing: no job. Corrupt: set aside by readJsonSafe, no job. A store without a file
     * keeps the job it has. Never throws.
     * @returns {object|null} a copy of the job
     */
    load() {
        if (this.filePath === null) {
            return this.get(); // a store in memory keeps its job
        }
        this._job = null;
        try {
            const result = readJsonSafe(this.filePath, { expect: 'object', now: this.now });
            if (result.status === 'ok') {
                const clean = validateJob(result.data, null);
                if (clean) {
                    clean.started = typeof result.data.started === 'string' ? result.data.started : null;
                    clean.updated = typeof result.data.updated === 'string' ? result.data.updated : null;
                    this._job = clean;
                }
            } else if (result.status !== 'missing') {
                let warning = `Job file ${this.filePath} could not be read (${result.status}: ${result.error?.message}).`;
                if (result.quarantinedTo) {
                    warning += ` Corrupt file moved to ${result.quarantinedTo}.`;
                }
                console.warn(`${warning} Starting without a job.`);
            }
        } catch (err) {
            console.warn(`Job file ${this.filePath} could not be read:`, err?.message ?? err);
            this._job = null;
        }
        return this.get();
    }

    /**
     * Sets the job and writes the file. Never throws.
     * @param {object} job
     * @returns {object|null} a copy of the saved job, null when it is no valid job
     */
    set(job) {
        try {
            const clean = validateJob(job, this._nowIso());
            if (!clean) {
                return null;
            }
            this._job = clean;
            this._save();
            return copy(clean);
        } catch (err) {
            console.warn('Could not save the job:', err?.message ?? err);
            return null;
        }
    }

    /**
     * The job, or null.
     * @returns {object|null} a copy
     */
    get() {
        return this._job ? copy(this._job) : null;
    }

    /**
     * Forgets the job and removes the file. Never throws.
     * @returns {boolean} true when there was a job
     */
    clear() {
        const had = this._job !== null;
        this._job = null;
        if (this.filePath !== null) {
            try {
                fs.rmSync(this.filePath, { force: true });
            } catch (err) {
                console.warn('Could not remove the job file:', err?.message ?? err);
            }
        }
        return had;
    }

    _save() {
        if (this.filePath === null) {
            return;
        }
        try {
            writeJsonAtomic(this.filePath, this._job);
        } catch (err) {
            console.warn(`Could not write the job file ${this.filePath}:`, err?.message ?? err);
        }
    }
}
