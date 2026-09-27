// Crash-safe JSON persistence helpers. Synchronous on purpose: callers write
// state right before process.exit(), so the write must be complete when the
// call returns.
/* global process */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const MAX_QUARANTINE_SUFFIX = 10000;

function sleepSync(ms) {
    if (Number.isFinite(ms) && ms > 0) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    }
}

function removeQuietly(filePath) {
    try {
        fs.unlinkSync(filePath);
    } catch {
        // best effort
    }
}

function toError(err) {
    return err instanceof Error ? err : new Error(String(err));
}

function serialise(data, indent) {
    let text;
    try {
        text = JSON.stringify(data, null, indent);
    } catch (err) {
        throw new Error(`Cannot serialise data to JSON: ${toError(err).message}`, { cause: err });
    }
    if (typeof text !== 'string') {
        throw new Error('Cannot serialise data to JSON: JSON.stringify returned undefined');
    }
    return text;
}

function writeTempFile(tmpPath, text) {
    const fd = fs.openSync(tmpPath, 'wx');
    let closing = false;
    try {
        fs.writeFileSync(fd, text, 'utf8');
        fs.fsyncSync(fd);
        closing = true;
        fs.closeSync(fd);
    } catch (err) {
        if (!closing) {
            try {
                fs.closeSync(fd);
            } catch {
                // ignore, the write error is the one that matters
            }
        }
        removeQuietly(tmpPath);
        throw err;
    }
}

/**
 * Atomically replaces filePath with JSON.stringify(data, null, indent).
 * Writes a temp file in the same directory, fsyncs it, then renames it onto
 * filePath. On failure the previous content of filePath is left intact.
 * @param {string} filePath
 * @param {*} data
 * @param {{indent?: number|string, retries?: number, retryDelayMs?: number}} options
 * @returns {undefined}
 */
export function writeJsonAtomic(filePath, data, options = {}) {
    const { indent = 2, retries = 5, retryDelayMs = 20 } = options ?? {};

    // 1. serialise before touching the disk
    const text = serialise(data, indent);

    // 2. parent directory
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    // 3. temp file in the same directory, <basename>.<pid>.<random>.tmp, flushed to disk
    const random = crypto.randomBytes(6).toString('hex');
    const tmpPath = `${filePath}.${process.pid}.${random}.tmp`;
    writeTempFile(tmpPath, text);

    // 4. rename onto the target, retrying transient Windows lock errors
    const maxRetries = Number.isFinite(retries) && retries > 0 ? Math.floor(retries) : 0;
    let attempt = 0;
    for (;;) {
        try {
            fs.renameSync(tmpPath, filePath);
            return undefined;
        } catch (err) {
            if (RETRYABLE_RENAME_CODES.has(err?.code) && attempt < maxRetries) {
                attempt++;
                sleepSync(retryDelayMs);
                continue;
            }
            // 5. final failure: drop the temp file, keep the old target
            removeQuietly(tmpPath);
            throw err;
        }
    }
}

function formatStamp(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new Error('Invalid date for quarantine stamp');
    }
    const pad = (n, width = 2) => String(n).padStart(width, '0');
    return `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
        + `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function pathTaken(candidate) {
    try {
        fs.lstatSync(candidate);
        return true;
    } catch (err) {
        return err?.code !== 'ENOENT';
    }
}

function quarantineFile(filePath, now) {
    try {
        const parsed = path.parse(filePath);
        const stamp = formatStamp(now());
        // keep the directory part exactly as the caller wrote it
        const prefix = filePath.endsWith(parsed.base)
            ? filePath.slice(0, filePath.length - parsed.base.length)
            : null;
        for (let i = 0; i <= MAX_QUARANTINE_SUFFIX; i++) {
            const base = `${parsed.name}.corrupt.${stamp}${i === 0 ? '' : `-${i}`}${parsed.ext}`;
            const candidate = prefix !== null ? prefix + base : path.join(parsed.dir, base);
            if (pathTaken(candidate)) {
                continue;
            }
            fs.renameSync(filePath, candidate);
            return candidate;
        }
        return null;
    } catch {
        return null;
    }
}

function parseJson(text, expect) {
    if (text.charCodeAt(0) === 0xFEFF) {
        text = text.slice(1);
    }
    if (text.trim() === '') {
        return { ok: false, error: new Error('JSON file is empty') };
    }
    let value;
    try {
        value = JSON.parse(text);
    } catch (err) {
        return { ok: false, error: toError(err) };
    }
    if (expect === 'object' && (value === null || typeof value !== 'object' || Array.isArray(value))) {
        const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
        return { ok: false, error: new Error(`Expected a JSON object but found ${kind}`) };
    }
    return { ok: true, value };
}

/**
 * Reads and parses a JSON file. Never throws.
 * @param {string} filePath
 * @param {{quarantine?: boolean, expect?: 'any'|'object', now?: () => Date}} options
 * @returns {{status: 'ok'|'missing'|'corrupt'|'error', data: *, error: Error|null, quarantinedTo: string|null}}
 */
export function readJsonSafe(filePath, options = {}) {
    try {
        const { quarantine = true, expect = 'any', now = () => new Date() } = options ?? {};

        let text;
        try {
            text = fs.readFileSync(filePath, 'utf8');
        } catch (err) {
            if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') {
                return { status: 'missing', data: null, error: null, quarantinedTo: null };
            }
            return { status: 'error', data: null, error: toError(err), quarantinedTo: null };
        }

        const parsed = parseJson(text, expect);
        if (parsed.ok) {
            return { status: 'ok', data: parsed.value, error: null, quarantinedTo: null };
        }

        const quarantinedTo = quarantine === true ? quarantineFile(filePath, now) : null;
        return { status: 'corrupt', data: null, error: parsed.error, quarantinedTo };
    } catch (err) {
        return { status: 'error', data: null, error: toError(err), quarantinedTo: null };
    }
}
