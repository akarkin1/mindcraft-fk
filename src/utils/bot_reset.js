// Moves selected parts of a bot's saved data into an archive directory.
// Nothing is ever deleted: every selected file or directory is renamed into
// `${botsDir}/_archive/${name}-${stamp}` at the same relative path.
// No side effects at import.
import fs from 'node:fs';
import path from 'node:path';
import { readJsonSafe, writeJsonAtomic } from './safe_json.js';

export const BOT_NAME_PATTERN = /^[a-zA-Z0-9_]{3,16}$/;

const ARCHIVE_DIR_NAME = '_archive';
const SAFE_KEY_PATTERN = /^[A-Za-z0-9_.-]+$/;
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_RETRIES = 3;
const RENAME_RETRY_DELAY_MS = 50;

/**
 * @param {Date} date
 * @returns {string} UTC time as YYYYMMDD-HHMMSS
 */
export function formatStamp(date) {
    const pad = (n, width = 2) => String(n).padStart(width, '0');
    return `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
        + `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function resolveNow(now) {
    try {
        const value = typeof now === 'function' ? now() : now;
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return value;
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            return new Date(value);
        }
    } catch {
        // fall through to the current time
    }
    return new Date();
}

function pathTaken(candidate) {
    try {
        fs.lstatSync(candidate);
        return true;
    } catch (err) {
        return err?.code !== 'ENOENT';
    }
}

function isDirectory(candidate) {
    try {
        return fs.statSync(candidate).isDirectory();
    } catch {
        return false;
    }
}

function isSafeKey(key) {
    return typeof key === 'string' && SAFE_KEY_PATTERN.test(key) && key !== '.' && key !== '..';
}

function readIndexWorlds(botDir) {
    // quarantine: false, planning must not change anything on disk
    const result = readJsonSafe(`${botDir}/worlds/index.json`, { expect: 'object', quarantine: false });
    const worlds = result.status === 'ok' ? result.data.worlds : null;
    if (!worlds || typeof worlds !== 'object' || Array.isArray(worlds)) {
        return {};
    }
    return worlds;
}

function listWorldDirs(botDir) {
    let entries;
    try {
        entries = fs.readdirSync(`${botDir}/worlds`, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort();
}

function findWorld(world, dirKeys, indexWorlds) {
    const knownKeys = new Set([...dirKeys, ...Object.keys(indexWorlds).filter(isSafeKey)]);
    if (knownKeys.has(world)) {
        return { key: world };
    }
    const wanted = world.trim().toLowerCase();
    const matches = Object.entries(indexWorlds)
        .filter(([key, entry]) => isSafeKey(key)
            && typeof entry?.label === 'string'
            && entry.label.trim().toLowerCase() === wanted)
        .map(([key]) => key)
        .sort();
    if (matches.length === 1) {
        return { key: matches[0] };
    }
    if (matches.length > 1) {
        return { error: `World label "${world}" is ambiguous, it matches the worlds ${matches.join(', ')}. Give the key instead.` };
    }
    return { error: `World not found: "${world}".` };
}

/**
 * Plans a reset. Reads the disk and changes nothing.
 * @returns {{archiveDir: string|null, moves: {from: string, to: string}[], removeWorldKeys: string[], errors: string[]}}
 */
export function planReset(options = {}) {
    const plan = { archiveDir: null, moves: [], removeWorldKeys: [], errors: [] };
    const errors = plan.errors;
    try {
        const {
            botsDir = './bots', name, memory = false, places = false, skills = false,
            all = false, world, now,
        } = options ?? {};
        const worldGiven = world !== undefined && world !== null;

        let nameOk = false;
        if (typeof name !== 'string' || name.trim() === '') {
            errors.push('Missing bot name.');
        } else if (!BOT_NAME_PATTERN.test(name)) {
            errors.push(`Invalid bot name "${name}": use 3 to 16 letters, digits or underscores.`);
        } else if (name === ARCHIVE_DIR_NAME) {
            errors.push(`"${ARCHIVE_DIR_NAME}" is the archive directory, not a bot.`);
        } else {
            nameOk = true;
        }

        if (!memory && !places && !skills && !all && !worldGiven) {
            errors.push('Nothing selected: give --memory, --places, --skills, --all or --world.');
        }
        if (worldGiven && (typeof world !== 'string' || world.trim() === '')) {
            errors.push('Missing world key or label.');
        }

        if (!nameOk) {
            plan.moves = [];
            return plan;
        }

        const botDir = `${botsDir}/${name}`;
        const archiveDir = `${botsDir}/${ARCHIVE_DIR_NAME}/${name}-${formatStamp(resolveNow(now))}`;
        plan.archiveDir = archiveDir;
        Object.defineProperty(plan, 'botDir', { value: botDir, enumerable: false });

        if (!isDirectory(botDir)) {
            errors.push(`Bot directory not found: ${botDir}`);
            return plan;
        }

        const dirKeys = listWorldDirs(botDir);
        let worldKey = null;
        if (worldGiven && typeof world === 'string' && world.trim() !== '') {
            const found = findWorld(world, dirKeys, readIndexWorlds(botDir));
            if (found.error) {
                errors.push(found.error);
            } else {
                worldKey = found.key;
            }
        }
        if (errors.length > 0) {
            return plan;
        }

        const moves = [];
        const add = (rel) => {
            const from = `${botDir}/${rel}`;
            if (pathTaken(from)) {
                moves.push({ from, to: `${archiveDir}/${rel}` });
            }
        };

        if (all) {
            moves.push({ from: botDir, to: archiveDir });
        } else if (memory || places || skills) {
            const selectedKeys = worldKey !== null ? [worldKey] : dirKeys;
            if (memory && worldKey === null) {
                // the files directly in the bot directory only without --world
                add('memory.json');
                add('histories');
                add('resume_guard.json');
            }
            for (const key of selectedKeys) {
                if (memory) {
                    add(`worlds/${key}/memory.json`);
                    add(`worlds/${key}/histories`);
                }
                if (places) {
                    add(`worlds/${key}/places.json`);
                }
            }
            if (skills) {
                add('skills');
            }
        } else if (worldKey !== null) {
            add(`worlds/${worldKey}`);
            plan.removeWorldKeys.push(worldKey);
        }
        plan.moves = moves;
        return plan;
    } catch (err) {
        errors.push(`Cannot plan the reset: ${err?.message ?? err}`);
        plan.moves = [];
        plan.removeWorldKeys = [];
        return plan;
    }
}

function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

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

function botDirOf(plan) {
    if (typeof plan.botDir === 'string') {
        return plan.botDir;
    }
    // derive it from `${botsDir}/_archive/${name}-${stamp}`
    if (typeof plan.archiveDir !== 'string') {
        return null;
    }
    const match = /^(.+)-\d{8}-\d{6}$/.exec(path.basename(plan.archiveDir));
    if (!match) {
        return null;
    }
    const botsDir = path.dirname(path.dirname(plan.archiveDir));
    return `${botsDir}/${match[1]}`;
}

function normalise(p) {
    return path.resolve(p).toLowerCase();
}

function removeWorldsFromIndex(indexPath, keys) {
    const result = readJsonSafe(indexPath, { expect: 'object', quarantine: false });
    if (result.status !== 'ok') {
        if (result.status !== 'missing') {
            console.warn(`Could not update ${indexPath} (${result.status}: ${result.error?.message}).`);
        }
        return;
    }
    const data = result.data;
    const worlds = data.worlds;
    if (!worlds || typeof worlds !== 'object' || Array.isArray(worlds)) {
        return;
    }
    let changed = false;
    for (const key of keys) {
        if (Object.hasOwn(worlds, key)) {
            delete worlds[key];
            changed = true;
        }
    }
    if (typeof data.last_key === 'string' && keys.includes(data.last_key)) {
        data.last_key = null;
        changed = true;
    }
    if (changed) {
        writeJsonAtomic(indexPath, data);
    }
}

/**
 * Performs a plan of planReset. Never deletes data, never throws.
 * @returns {{moved: {from: string, to: string}[], failed: {from: string, to: string, error: string}[]}}
 */
export function applyReset(plan) {
    const moved = [];
    const failed = [];
    try {
        if (!plan || typeof plan !== 'object') {
            return { moved, failed };
        }
        if (Array.isArray(plan.errors) && plan.errors.length > 0) {
            return { moved, failed };
        }

        for (const move of Array.isArray(plan.moves) ? plan.moves : []) {
            const from = move?.from;
            const to = move?.to;
            try {
                if (typeof from !== 'string' || typeof to !== 'string') {
                    throw new Error('invalid move');
                }
                if (pathTaken(to)) {
                    // never overwrite an earlier archive
                    throw new Error(`target already exists: ${to}`);
                }
                fs.mkdirSync(path.dirname(to), { recursive: true });
                renameWithRetry(from, to);
                moved.push({ from, to });
            } catch (err) {
                failed.push({ from, to, error: String(err?.message ?? err) });
            }
        }

        const keys = Array.isArray(plan.removeWorldKeys) ? plan.removeWorldKeys.filter(isSafeKey) : [];
        const botDir = keys.length > 0 ? botDirOf(plan) : null;
        if (botDir !== null) {
            // keep the index entry of a world whose directory could not be moved
            const failedFrom = new Set(failed.filter(f => typeof f.from === 'string').map(f => normalise(f.from)));
            const removable = keys.filter(key => !failedFrom.has(normalise(`${botDir}/worlds/${key}`)));
            if (removable.length > 0) {
                try {
                    removeWorldsFromIndex(`${botDir}/worlds/index.json`, removable);
                } catch (err) {
                    console.warn(`Could not update the world index of ${botDir}:`, err?.message ?? err);
                }
            }
        }
    } catch (err) {
        console.warn('Reset stopped by an unexpected error:', err?.message ?? err);
    }
    return { moved, failed };
}
