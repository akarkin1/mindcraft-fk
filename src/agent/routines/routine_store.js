// The routines of the bot in one world (spec v0.1.4.15, part R, 3.1), persisted as { version, routines: [routine] }
// in bots/<name>/worlds/<seed>/routines.json, in the order the owner gave them. Bound at spawn like the job store
// (JobStore.bind's pattern): a store made without a file lives in memory until bind. At most 12 routines. Never
// throws.
import fs from 'node:fs';
import path from 'node:path';
import { readJsonSafe, writeJsonAtomic } from '../../utils/safe_json.js';
import { ROUTINE_RULES, ROUTINE_STATES, normalizeRoutineName } from './routine_logic.js';

/** The name of the file in the folder of the world (or of the bot without world memory). */
export const ROUTINES_FILE = 'routines.json';

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
    return { command: step.command, check: { item: typeof check.item === 'string' ? check.item : null, count: isFiniteNumber(check.count) ? check.count : null } };
}

/**
 * The clean record to store (3.1), or null when it is no routine: a name like an area name, a text of 1 to 400
 * characters. The plan, the condition, the state and the counts are taken when they are sound, their defaults else.
 * v0.1.4.16 (F3): `runs`, the rounds started (the counter of the round texts), default 0.
 * @param {object} routine
 * @param {string|null} now ISO time for updated (and created when it has none)
 * @returns {object|null}
 */
export function validateRoutine(routine, now) {
    if (!isPlainObject(routine)) {
        return null;
    }
    const name = normalizeRoutineName(routine.name);
    const text = typeof routine.text === 'string' ? routine.text.replace(/\s+/g, ' ').trim() : '';
    if (name === null || text.length === 0 || text.length > ROUTINE_RULES.textMax) {
        return null;
    }
    const steps = Array.isArray(routine.steps) ? routine.steps.map(cleanStep).filter(Boolean) : [];
    const c = routine.condition;
    const condition = isPlainObject(c) && typeof c.item === 'string' && c.item.length > 0 && Number.isInteger(c.fewerThan) && c.fewerThan >= 1
        ? { item: c.item, fewerThan: c.fewerThan } : null;
    return {
        name,
        text,
        steps: steps.length > 0 ? steps : null,
        every: Number.isInteger(routine.every) && routine.every >= 1 ? routine.every : ROUTINE_RULES.every,
        condition,
        state: ROUTINE_STATES.includes(routine.state) ? routine.state : 'active',
        rounds: Number.isInteger(routine.rounds) && routine.rounds >= 0 ? routine.rounds : 0,
        runs: Number.isInteger(routine.runs) && routine.runs >= 0 ? routine.runs : 0, // v0.1.4.16 (F3): the rounds started
        fails: Number.isInteger(routine.fails) && routine.fails >= 0 ? routine.fails : 0,
        lastRound: typeof routine.lastRound === 'string' ? routine.lastRound : null,
        created: typeof routine.created === 'string' ? routine.created : now,
        updated: now,
    };
}

export class RoutineStore {
    /**
     * @param {string|null} filePath bots/<name>/worlds/<seed>/routines.json; without it the store lives in memory only
     * @param {{now?: () => Date}} [options]
     */
    constructor(filePath, options = {}) {
        this.filePath = typeof filePath === 'string' && filePath.length > 0 ? filePath : null;
        const now = options?.now;
        this.now = typeof now === 'function' ? now : () => new Date();
        this._list = [];
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
     * Reads the file. Missing: no routines. Corrupt: set aside by readJsonSafe, no routines. A store without a file
     * keeps what it has. Never throws.
     * @returns {object[]} a copy of the routines
     */
    load() {
        if (this.filePath === null) {
            return this.list();
        }
        this._list = [];
        try {
            const result = readJsonSafe(this.filePath, { expect: 'object', now: this.now });
            if (result.status === 'ok') {
                const rows = Array.isArray(result.data.routines) ? result.data.routines : [];
                for (const row of rows) {
                    const clean = validateRoutine(row, typeof row?.updated === 'string' ? row.updated : null);
                    if (clean && !this._list.some(r => r.name === clean.name) && this._list.length < ROUTINE_RULES.max) {
                        this._list.push(clean);
                    }
                }
            } else if (result.status !== 'missing') {
                let warning = `Routine file ${this.filePath} could not be read (${result.status}: ${result.error?.message}).`;
                if (result.quarantinedTo) {
                    warning += ` Corrupt file moved to ${result.quarantinedTo}.`;
                }
                console.warn(`${warning} Starting without routines.`);
            }
        } catch (err) {
            console.warn(`Routine file ${this.filePath} could not be read:`, err?.message ?? err);
            this._list = [];
        }
        return this.list();
    }

    /**
     * Binds the store to another file and reads it (the routines of the world the bot is in, known only after the
     * login). What was held in memory is dropped: it belonged to no world. null makes the store live in memory only.
     * Never throws.
     * @param {string|null} filePath
     * @returns {object[]} a copy of the routines of that file
     */
    bind(filePath) {
        this.filePath = typeof filePath === 'string' && filePath.length > 0 ? filePath : null;
        this._list = [];
        return this.load();
    }

    /**
     * The routines in the order they were given.
     * @returns {object[]} copies
     */
    list() {
        return copy(this._list);
    }

    /**
     * One routine by its name (normalised), or null.
     * @param {string} name
     * @returns {object|null} a copy
     */
    get(name) {
        const key = normalizeRoutineName(name);
        if (key === null) {
            return null;
        }
        const found = this._list.find(r => r.name === key);
        return found ? copy(found) : null;
    }

    /**
     * Saves a routine (a new one at the end, a known name in its place) and writes the file. null when it is no
     * valid routine, or a new one beyond the 12. Never throws.
     * @param {object} routine
     * @returns {object|null} a copy of the saved routine
     */
    set(routine) {
        try {
            const clean = validateRoutine(routine, this._nowIso());
            if (!clean) {
                return null;
            }
            const at = this._list.findIndex(r => r.name === clean.name);
            if (at < 0) {
                if (this._list.length >= ROUTINE_RULES.max) {
                    return null;
                }
                this._list.push(clean);
            } else {
                clean.created = this._list[at].created ?? clean.created;
                this._list[at] = clean;
            }
            this._save();
            return copy(clean);
        } catch (err) {
            console.warn('Could not save the routine:', err?.message ?? err);
            return null;
        }
    }

    /**
     * Removes a routine and writes the file. Never throws.
     * @param {string} name
     * @returns {boolean} true when it was there
     */
    remove(name) {
        const key = normalizeRoutineName(name);
        const at = key === null ? -1 : this._list.findIndex(r => r.name === key);
        if (at < 0) {
            return false;
        }
        this._list.splice(at, 1);
        this._save();
        return true;
    }

    /** The number of routines. */
    get size() {
        return this._list.length;
    }

    /**
     * Forgets every routine and removes the file. Never throws.
     * @returns {boolean} true when there were any
     */
    clear() {
        const had = this._list.length > 0;
        this._list = [];
        if (this.filePath !== null) {
            try {
                fs.rmSync(this.filePath, { force: true });
            } catch (err) {
                console.warn('Could not remove the routine file:', err?.message ?? err);
            }
        }
        return had;
    }

    _save() {
        if (this.filePath === null) {
            return;
        }
        try {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            writeJsonAtomic(this.filePath, { version: FILE_VERSION, routines: this._list }, { indent: 2 });
        } catch (err) {
            console.warn(`Could not write the routine file ${this.filePath}:`, err?.message ?? err);
        }
    }
}
