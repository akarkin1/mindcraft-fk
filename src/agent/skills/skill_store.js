// Saved skills of one bot (spec K3): one source file per skill plus index.json.
//   <dir>/index.json                          { version, skills: { <name>: entry } }
//   <dir>/<name>.js                           current source of a skill
//   <dir>/.history/<name>.v<N>.js             earlier versions
//   <dir>/.history/<name>.removed-<stamp>.js  removed skills
// Files are only ever moved with a rename, never deleted.
/* global process */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readJsonSafe, writeJsonAtomic } from '../../utils/safe_json.js';
import { normalizeSource, parseGeneratedCode, signatureOf, getDocBlock, firstDocLine } from './skill_source.js';

const FILE_VERSION = 1;
const INDEX_FILE = 'index.json';
const HISTORY_DIR = '.history';
const NAME_PATTERN = /^[a-z][A-Za-z0-9]{2,39}$/;
// <name>.js with one of these names is a device on Windows, not a file
const DEVICE_NAMES = new Set([
    'con', 'prn', 'aux', 'nul',
    'com0', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
    'lpt0', 'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);
const STATUSES = new Set(['active', 'disabled']);
const ERROR_MAX = 200;
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_RETRIES = 5;
const RENAME_RETRY_DELAY_MS = 20;
const MAX_NAME_SUFFIX = 10000;

function isValidName(name) {
    return typeof name === 'string' && NAME_PATTERN.test(name) && !DEVICE_NAMES.has(name.toLowerCase());
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Same order as Array.prototype.sort without a comparator.
function compareNames(a, b) {
    if (a < b) {
        return -1;
    }
    return a > b ? 1 : 0;
}

function hashOf(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function stringOrNull(value) {
    return typeof value === 'string' ? value : null;
}

// A stored time: an ISO string or null. Anything else gets the fallback.
function timeOr(value, fallback) {
    return typeof value === 'string' || value === null ? value : fallback;
}

function countOr(value, fallback) {
    return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function describeName(name) {
    try {
        return typeof name === 'string' ? `"${name}"` : String(name);
    } catch {
        return typeof name;
    }
}

function errorMessage(err) {
    return err?.message ?? String(err);
}

// UTC YYYYMMDD-HHMMSS
function formatStamp(date) {
    const pad = (n, width = 2) => String(n).padStart(width, '0');
    return `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
        + `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

// The only place an entry object is built: exactly these keys, in this order.
function makeEntry(fields) {
    return {
        name: fields.name,
        signature: fields.signature,
        description: fields.description,
        status: fields.status,
        version: fields.version,
        created: fields.created,
        updated: fields.updated,
        uses: fields.uses,
        failures: fields.failures,
        consecutive_failures: fields.consecutive_failures,
        consecutive_errors: fields.consecutive_errors,
        last_used: fields.last_used,
        last_error: fields.last_error,
        source_task: fields.source_task,
        hash: fields.hash,
    };
}

// Whether the result of a run says the skill threw (v0.1.4.5, G1): `error` is given.
function threwError(result) {
    return result !== null && typeof result === 'object' && result.error !== undefined && result.error !== null;
}

function signatureFromSource(name, source) {
    const fn = parseGeneratedCode(source).functions.find(candidate => candidate.name === name);
    return fn ? signatureOf(fn) : `${name}(bot)`;
}

function descriptionFromSource(source) {
    return firstDocLine(getDocBlock(source)?.text ?? '');
}

function errorTextOf(error) {
    if (error === undefined || error === null) {
        return null;
    }
    let text;
    try {
        text = typeof error === 'string' ? error : String(error);
    } catch {
        text = 'Unknown error';
    }
    return text.slice(0, ERROR_MAX);
}

function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function pathTaken(candidate) {
    try {
        fs.lstatSync(candidate);
        return true;
    } catch (err) {
        return err?.code !== 'ENOENT';
    }
}

function isFile(filePath) {
    try {
        return fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
}

function readText(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
}

function removeQuietly(filePath) {
    try {
        fs.unlinkSync(filePath);
    } catch {
        // best effort, only used for our own temp files
    }
}

// Rename that retries transient Windows lock errors.
function renameWithRetry(from, to) {
    for (let attempt = 0; ; attempt++) {
        try {
            fs.renameSync(from, to);
            return;
        } catch (err) {
            if (RETRYABLE_RENAME_CODES.has(err?.code) && attempt < RENAME_RETRIES) {
                sleepSync(RENAME_RETRY_DELAY_MS);
                continue;
            }
            throw err;
        }
    }
}

// Writes text to a new temp file in the directory of filePath and flushes it. Returns its path.
function writeTempNextTo(filePath, text) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    const fd = fs.openSync(tmpPath, 'wx');
    try {
        try {
            fs.writeFileSync(fd, text, 'utf8');
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
    } catch (err) {
        removeQuietly(tmpPath);
        throw err;
    }
    return tmpPath;
}

// <base><ext>, or <base>-2<ext>, <base>-3<ext>, ... when taken. A rename never replaces a file.
function freePath(dir, base, ext) {
    for (let i = 1; i <= MAX_NAME_SUFFIX; i++) {
        const candidate = path.join(dir, i === 1 ? `${base}${ext}` : `${base}-${i}${ext}`);
        if (!pathTaken(candidate)) {
            return candidate;
        }
    }
    throw new Error(`No free file name for ${base}${ext} in ${dir}`);
}

export class SkillStore {
    /**
     * @param {string} dir the skill directory of one bot, created on the first write
     * @param {{now?: () => Date}} options
     */
    constructor(dir, options = {}) {
        if (typeof dir !== 'string' || dir === '') {
            throw new TypeError('Skill directory must be a non-empty string');
        }
        this.dir = dir;
        const now = options?.now;
        this.now = typeof now === 'function' ? now : () => new Date();
        this._entries = new Map();
    }

    /**
     * Reads index.json. Missing, corrupt (quarantined by readJsonSafe) or of the wrong
     * shape: the index is rebuilt from the *.js files directly in the directory.
     * Entries whose source file is missing are dropped. A repaired index is written
     * back. A directory that does not exist is not created. Never throws.
     * @returns {number} number of skills
     */
    load() {
        this._entries = new Map();
        try {
            const result = readJsonSafe(this._indexPath(), { expect: 'object', now: () => this._date() });
            if (result.status === 'ok' && isPlainObject(result.data.skills)) {
                this._loadIndex(result.data.skills);
            } else if (result.status === 'ok') {
                console.warn(`Skill index ${this._indexPath()} has no "skills" object, rebuilding it from the skill files.`);
                this._rebuild('always');
            } else if (result.status === 'missing') {
                this._rebuild('if_any');
            } else {
                let warning = `Skill index ${this._indexPath()} could not be read (${result.status}: ${result.error?.message}).`;
                if (result.quarantinedTo) {
                    warning += ` Corrupt file moved to ${result.quarantinedTo}.`;
                }
                console.warn(`${warning} Rebuilding it from the skill files.`);
                // a file that exists but cannot be read now is not overwritten
                this._rebuild(result.status === 'corrupt' ? 'always' : 'never');
            }
        } catch (err) {
            console.warn(`Skills in ${this.dir} could not be loaded:`, errorMessage(err));
        }
        return this._entries.size;
    }

    /**
     * Saves the normalized source of a skill. New name: file and entry created.
     * Same hash: nothing is written. Other hash: the current file is moved to
     * .history/<name>.v<old version>.js, the new file is written and the entry updated.
     * If the source file cannot be written or the earlier version cannot be moved to the
     * history, the result is { action: 'failed', entry: null, error } with a warning, and
     * the entry in memory is neither created nor changed (Amendment 2, B1). A failing
     * write of index.json only is warned about; the index is rebuilt at the next load.
     * @param {{name: string, source: string, description?: string, signature?: string, sourceTask?: string}} skill
     * @returns {{action: 'created'|'updated'|'unchanged'|'failed', entry: object|null, error?: string}}
     * @throws {TypeError} for an invalid name or a source that is not a string
     */
    save(skill = {}) {
        const { name, source, description, signature, sourceTask } = skill ?? {};
        if (!isValidName(name)) {
            throw new TypeError(`Invalid skill name ${describeName(name)}`);
        }
        if (typeof source !== 'string') {
            throw new TypeError('Skill source must be a string');
        }
        const clash = [...this._entries.keys()].find(other => other !== name && other.toLowerCase() === name.toLowerCase());
        if (clash !== undefined) {
            throw new TypeError(`Skill name "${name}" differs from the saved skill "${clash}" only in case`);
        }

        const text = normalizeSource(source);
        const hash = hashOf(text);
        const current = this._entries.get(name);
        if (current !== undefined && current.hash === hash) {
            return { action: 'unchanged', entry: { ...current } };
        }

        const stamp = this._date().toISOString();
        const fields = {
            description: typeof description === 'string' ? description : descriptionFromSource(text),
            signature: typeof signature === 'string' && signature !== '' ? signature : signatureFromSource(name, text),
            source_task: typeof sourceTask === 'string' ? sourceTask : null,
            hash,
        };

        if (current === undefined) {
            // a file nobody tracks is kept as version 0 instead of being overwritten
            const error = this._putSource(name, text, `${name}.v0`);
            if (error !== null) {
                return { action: 'failed', entry: null, error };
            }
            const entry = makeEntry({
                name,
                ...fields,
                status: 'active',
                version: 1,
                created: stamp,
                updated: stamp,
                uses: 0,
                failures: 0,
                consecutive_failures: 0,
                consecutive_errors: 0,
                last_used: null,
                last_error: null,
            });
            this._entries.set(name, entry);
            this._writeIndex();
            return { action: 'created', entry: { ...entry } };
        }

        const error = this._putSource(name, text, `${name}.v${current.version}`);
        if (error !== null) {
            return { action: 'failed', entry: null, error };
        }
        const entry = makeEntry({
            ...current,
            ...fields,
            status: 'active',
            version: current.version + 1,
            updated: stamp,
            consecutive_failures: 0,
            consecutive_errors: 0,
        });
        this._entries.set(name, entry);
        this._writeIndex();
        return { action: 'updated', entry: { ...entry } };
    }

    /** @returns {string|null} the source text of the skill, null if there is none */
    read(name) {
        if (!isValidName(name)) {
            return null;
        }
        return readText(this._sourcePath(name));
    }

    /** @returns {object|undefined} a copy of the entry */
    get(name) {
        const entry = this._entries.get(name);
        return entry === undefined ? undefined : { ...entry };
    }

    /** @returns {object[]} copies of all entries, sorted by name */
    list() {
        return this._names().map(name => ({ ...this._entries.get(name) }));
    }

    /**
     * Sets the status and writes the index when something changed. 'active' also sets
     * consecutive_errors to 0, so a skill switched off after errors starts to count again
     * when it is enabled (v0.1.4.5). No other counter changes.
     * @param {string} name
     * @param {'active'|'disabled'} status
     * @returns {boolean} true if the skill exists and the status is valid
     */
    setStatus(name, status) {
        const entry = this._entries.get(name);
        if (entry === undefined || !STATUSES.has(status)) {
            return false;
        }
        let changed = false;
        if (entry.status !== status) {
            entry.status = status;
            changed = true;
        }
        if (status === 'active' && entry.consecutive_errors !== 0) {
            entry.consecutive_errors = 0;
            changed = true;
        }
        if (changed) {
            this._writeIndex();
        }
        return true;
    }

    /**
     * Counts one call of a skill and writes the index. Unknown name: nothing happens.
     * A failure without error text sets last_error to null. `error` given (not undefined or
     * null) means the skill threw: consecutive_errors increases (v0.1.4.5, G1). A failure
     * without an error (the skill returned false) neither counts there nor resets it; ok resets it.
     * @param {string} name
     * @param {{ok: boolean, error?: *}} result
     */
    recordUse(name, result = {}) {
        const entry = this._entries.get(name);
        if (entry === undefined) {
            return;
        }
        const ok = typeof result === 'boolean' ? result : Boolean(result?.ok);
        entry.uses += 1;
        entry.last_used = this._date().toISOString();
        if (ok) {
            entry.consecutive_failures = 0;
            entry.consecutive_errors = 0;
        } else {
            entry.failures += 1;
            entry.consecutive_failures += 1;
            entry.last_error = errorTextOf(result?.error);
            if (threwError(result)) {
                entry.consecutive_errors += 1;
            }
        }
        this._writeIndex();
    }

    /**
     * Moves the source file to .history/<name>.removed-<stamp>.js (UTC
     * YYYYMMDD-HHMMSS) and removes the entry. Nothing is deleted.
     * @returns {boolean} true if the skill existed
     */
    remove(name) {
        if (!isValidName(name) || !this._entries.has(name)) {
            return false;
        }
        this._moveToHistory(name, `${name}.removed-${formatStamp(this._date())}`);
        this._entries.delete(name);
        this._writeIndex();
        return true;
    }

    get size() {
        return this._entries.size;
    }

    _indexPath() {
        return path.join(this.dir, INDEX_FILE);
    }

    _sourcePath(name) {
        return path.join(this.dir, `${name}.js`);
    }

    _names() {
        return [...this._entries.keys()].sort(compareNames);
    }

    _date() {
        try {
            const date = this.now();
            if (date instanceof Date && !Number.isNaN(date.getTime())) {
                return date;
            }
        } catch {
            // fall back to the clock
        }
        return new Date();
    }

    _loadIndex(skills) {
        let changed = false;
        for (const [name, raw] of Object.entries(skills)) {
            const file = isValidName(name) ? this._sourcePath(name) : null;
            if (file === null || !isFile(file)) {
                changed = true;
                continue;
            }
            const entry = this._repairEntry(name, raw, file);
            if (JSON.stringify(entry) !== JSON.stringify(raw)) {
                changed = true;
            }
            this._entries.set(name, entry);
        }
        if (changed) {
            this._writeIndex();
        }
    }

    // Keeps every valid field of a stored entry and fills the others.
    _repairEntry(name, raw, file) {
        const stored = isPlainObject(raw) ? raw : {};
        let source;
        const sourceText = () => {
            source ??= normalizeSource(readText(file) ?? '');
            return source;
        };
        const stamp = this._date().toISOString();
        return makeEntry({
            name,
            signature: typeof stored.signature === 'string' && stored.signature !== ''
                ? stored.signature : signatureFromSource(name, sourceText()),
            description: typeof stored.description === 'string' ? stored.description : descriptionFromSource(sourceText()),
            status: STATUSES.has(stored.status) ? stored.status : 'active',
            version: Number.isInteger(stored.version) && stored.version >= 1 ? stored.version : 1,
            created: timeOr(stored.created, stamp),
            updated: timeOr(stored.updated, stamp),
            uses: countOr(stored.uses, 0),
            failures: countOr(stored.failures, 0),
            consecutive_failures: countOr(stored.consecutive_failures, 0),
            consecutive_errors: countOr(stored.consecutive_errors, 0), // absent before v0.1.4.5
            last_used: stringOrNull(stored.last_used),
            last_error: stringOrNull(stored.last_error),
            source_task: stringOrNull(stored.source_task),
            hash: typeof stored.hash === 'string' && /^[0-9a-f]{64}$/.test(stored.hash) ? stored.hash : hashOf(sourceText()),
        });
    }

    // Index from the <name>.js files directly in the directory.
    // writeBack: 'always', 'if_any' (at least one skill found) or 'never'.
    _rebuild(writeBack) {
        let names = [];
        try {
            names = fs.readdirSync(this.dir, { withFileTypes: true })
                .filter(item => item.isFile() && item.name.endsWith('.js'))
                .map(item => item.name.slice(0, -3))
                .filter(isValidName)
                .sort(compareNames);
        } catch (err) {
            if (err?.code !== 'ENOENT' && err?.code !== 'ENOTDIR') {
                console.warn(`Skill directory ${this.dir} could not be listed:`, errorMessage(err));
            }
        }
        for (const name of names) {
            const raw = readText(this._sourcePath(name));
            if (raw === null) {
                continue;
            }
            const source = normalizeSource(raw);
            const stamp = this._date().toISOString();
            this._entries.set(name, makeEntry({
                name,
                signature: signatureFromSource(name, source),
                description: descriptionFromSource(source),
                status: 'active',
                version: 1,
                created: stamp,
                updated: stamp,
                uses: 0,
                failures: 0,
                consecutive_failures: 0,
                consecutive_errors: 0,
                last_used: null,
                last_error: null,
                source_task: null,
                hash: hashOf(source),
            }));
        }
        if (writeBack === 'always' || (writeBack === 'if_any' && this._entries.size > 0)) {
            this._writeIndex();
        }
    }

    // Moves a file to .history/<base>.js, or <base>-2.js ... when taken. Returns the new path. Throws.
    _moveFileToHistory(from, base) {
        const historyDir = path.join(this.dir, HISTORY_DIR);
        fs.mkdirSync(historyDir, { recursive: true });
        const to = freePath(historyDir, base, '.js');
        renameWithRetry(from, to);
        return to;
    }

    // 'moved', 'missing' (no source file) or 'failed' (warned, the file stays where it is).
    _moveToHistory(name, base) {
        const from = this._sourcePath(name);
        if (!pathTaken(from)) {
            return 'missing';
        }
        try {
            this._moveFileToHistory(from, base);
            return 'moved';
        } catch (err) {
            console.warn(`Could not move the skill file ${from} to the history:`, errorMessage(err));
            return 'failed';
        }
    }

    // Puts text into <dir>/<name>.js; a file already there is moved to .history/<historyBase>.js
    // first. The new text goes to a temp file before anything is moved, so a folder that cannot
    // be written changes nothing. Returns null on success, otherwise the error text (warned);
    // then the old file is back in its place if the file system allows it.
    _putSource(name, text, historyBase) {
        const target = this._sourcePath(name);
        const fail = (what, err) => {
            console.warn(what, errorMessage(err));
            return errorMessage(err);
        };
        let tmpPath;
        try {
            tmpPath = writeTempNextTo(target, text);
        } catch (err) {
            return fail(`Could not write the skill file ${target}:`, err);
        }
        let movedTo = null;
        if (pathTaken(target)) {
            try {
                movedTo = this._moveFileToHistory(target, historyBase);
            } catch (err) {
                removeQuietly(tmpPath);
                return fail(`Could not move the skill file ${target} to the history:`, err);
            }
        }
        try {
            renameWithRetry(tmpPath, target);
            return null;
        } catch (err) {
            removeQuietly(tmpPath);
            if (movedTo !== null) {
                try {
                    renameWithRetry(movedTo, target);
                } catch (restoreErr) {
                    console.warn(`Could not move ${movedTo} back to ${target}:`, errorMessage(restoreErr));
                }
            }
            return fail(`Could not write the skill file ${target}:`, err);
        }
    }

    _toJson() {
        const skills = Object.fromEntries(this._names().map(name => [name, { ...this._entries.get(name) }]));
        return { version: FILE_VERSION, skills };
    }

    _writeIndex() {
        try {
            writeJsonAtomic(this._indexPath(), this._toJson(), { indent: 2 });
            return true;
        } catch (err) {
            console.warn(`Could not write the skill index ${this._indexPath()}:`, errorMessage(err));
            return false;
        }
    }
}
