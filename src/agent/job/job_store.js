// The job of the bot (spec v0.1.4.10, I1), persisted as the record itself in bots/<name>/job.json. One
// job at a time. Beyond I1 a record may hold: skillDone (the skill said the job is done), fails and
// failText (the same failure in a row), blocker ({ kind, item } of the last plan), chainAt (ISO time when
// the bot itself went on: a plan was made or a step was done); v0.1.4.16 FX4 (review 16b, finding 3): a kill_farm job
// bagAtStart (the bag of its start, { name: count }). Never throws.
import fs from 'node:fs';
import { readJsonSafe, writeJsonAtomic } from '../../utils/safe_json.js';
import { JOB_KINDS, JOB_STATES, ROUTINE_KIND } from './job_logic.js';

/** The name of the file in the folder of the bot. */
export const JOB_FILE = 'job.json';
/**
 * v0.1.4.16 (SPEC 8.4a, E8): the kind of the AFK creeper kill's job, beside ROUTINE_KIND. It is no kind of JOB_COMMANDS:
 * createJob starts it for the order !killFarm(<until>), whose text is its command and its one step; the job resume runs
 * the order again when anything but the owner's stop ended the action (a reflex, the night, a restart).
 */
export const KILL_FARM_KIND = 'kill_farm';
/** The command of the kill_farm job. */
export const KILL_FARM_COMMAND = '!killFarm';
/** The states of a step; v0.1.4.16 (F3): `skipped`, a step of a routine's round that failed after its runs and was passed. */
export const STEP_STATES = Object.freeze(['todo', 'done', 'failed', 'skipped']);

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

/**
 * v0.1.4.16 FX4 (review 16b, finding 3): the bag of a kill_farm job's start as the record keeps it: { name: count } of the
 * names with a count above 0 ({} for an empty bag); null for anything that is no such object (a job saved without it).
 * @param {*} bag
 * @returns {Object<string, number>|null}
 */
export function cleanBag(bag) {
    if (!isPlainObject(bag)) {
        return null;
    }
    const out = {};
    for (const [name, n] of Object.entries(bag)) {
        if (name.length > 0 && isFiniteNumber(n) && n > 0) {
            out[name] = Math.floor(n);
        }
    }
    return out;
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
    if (!isPlainObject(job) || !(JOB_KINDS.includes(job.kind) || job.kind === ROUTINE_KIND || job.kind === KILL_FARM_KIND)
        || typeof job.command !== 'string' || job.command.length === 0) {
        return null;
    }
    // v0.1.4.16 (SPEC 8.4a): a kill_farm job is the order !killFarm(<until>)
    if (job.kind === KILL_FARM_KIND && !job.command.startsWith(KILL_FARM_COMMAND)) {
        return null;
    }
    // v0.1.4.15 (part R, SPEC 3.3): a round of a routine names its routine (and its round, 1 without)
    if (job.kind === ROUTINE_KIND && (typeof job.routine !== 'string' || job.routine.length === 0)) {
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
    if (job.kind === ROUTINE_KIND) {
        out.routine = job.routine;
        out.round = Number.isInteger(job.round) && job.round >= 1 ? job.round : 1;
    }
    // v0.1.4.16 FX4 (review 16b, finding 3): the bag of a kill_farm job's start, kept across its resumes and restarts (the farm
    // stores only what it gained since); a job saved without it loads as before
    if (job.kind === KILL_FARM_KIND) {
        const bag = cleanBag(job.bagAtStart);
        if (bag) {
            out.bagAtStart = bag;
        }
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
     * v0.1.4.14: binds the store to another file and reads it (the job of the world the bot is in:
     * bots/<name>/worlds/<seed>/job.json, known only after the login). A job held in memory is dropped: it
     * belonged to no world. null makes the store live in memory only. Never throws.
     * @param {string|null} filePath
     * @returns {object|null} a copy of the job of that file
     */
    bind(filePath) {
        this.filePath = typeof filePath === 'string' && filePath.length > 0 ? filePath : null;
        this._job = null;
        return this.load();
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
