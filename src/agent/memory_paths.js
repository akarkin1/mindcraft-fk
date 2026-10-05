// One memory of a world for every bot of the owner (v0.1.4.13, M1, shared_memory): the folder of the stores of
// areas, places, routes, mines, chests and rules is bots/shared/worlds/<seed>/ with the switch on, else the bot's
// own bots/<name>/worlds/<seed>/. The chat memory, the histories, the job, the trail and the placed blocks stay
// per bot. Two processes write the same files: a store writes atomically (writeJsonAtomic of safe_json.js) and
// re-reads its file through a SharedFile when another process changed it. A bot that finds a file of the shared
// folder missing and its own present copies its own once (shareOnce) and says SHARED_TEXT.
// Imports nothing of the project; the stores and world_memory.js get what they need through their options.
import fs from 'node:fs';
import path from 'node:path';

/** The folder under bots/ that every bot shares. */
export const SHARED_NAME = 'shared';
/** The files of a world that are shared. */
export const SHARED_FILES = Object.freeze(['areas.json', 'places.json', 'routes.json', 'mines.json', 'chests.json', 'rules.json']);
/** The file that lives in the bot's folder itself (bots/<name>/rules.json), not in its world folder. */
export const RULES_FILE = 'rules.json';
/** What the bot says after the one-time copy. */
export const SHARED_TEXT = 'I share the memory of this world now.';

const DEFAULT_BOTS_DIR = './bots';

function cleanName(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function botsDirOf(value) {
    return typeof value === 'string' && value.length > 0 ? value : DEFAULT_BOTS_DIR;
}

function isShared(settings) {
    try {
        return settings?.shared_memory === true;
    } catch {
        return false;
    }
}

/**
 * The bot's own folder of a world: bots/<name>/worlds/<seed>.
 * @param {string} agentName
 * @param {string} seed the key of the world
 * @param {string} [botsDir] './bots'
 * @returns {string}
 */
export function ownWorldDir(agentName, seed, botsDir = DEFAULT_BOTS_DIR) {
    return `${botsDirOf(botsDir)}/${cleanName(agentName) ?? 'unknown'}/worlds/${cleanName(seed) ?? 'unknown'}`;
}

/**
 * The shared folder of a world: bots/shared/worlds/<seed>.
 * @param {string} seed
 * @param {string} [botsDir]
 * @returns {string}
 */
export function sharedWorldDir(seed, botsDir = DEFAULT_BOTS_DIR) {
    return `${botsDirOf(botsDir)}/${SHARED_NAME}/worlds/${cleanName(seed) ?? 'unknown'}`;
}

/**
 * The folder of the stores of areas, places, routes, mines, chests and rules of a world: the shared folder with
 * shared_memory on, else the bot's own world folder.
 * @param {string} agentName
 * @param {string} seed the key of the world
 * @param {{shared_memory?: boolean}} settings
 * @param {string} [botsDir] './bots'
 * @returns {string}
 */
export function worldDir(agentName, seed, settings, botsDir = DEFAULT_BOTS_DIR) {
    return isShared(settings) ? sharedWorldDir(seed, botsDir) : ownWorldDir(agentName, seed, botsDir);
}

/**
 * The bot's own file of one of SHARED_FILES: rules.json in bots/<name>/ (the rules belonged to the bot, not to a
 * world, before shared_memory), every other file in the own world folder.
 * @param {string} agentName
 * @param {string} seed
 * @param {string} file one of SHARED_FILES
 * @param {string} [botsDir]
 * @returns {string}
 */
export function ownFileOf(agentName, seed, file, botsDir = DEFAULT_BOTS_DIR) {
    if (file === RULES_FILE) {
        return `${botsDirOf(botsDir)}/${cleanName(agentName) ?? 'unknown'}/${RULES_FILE}`;
    }
    return `${ownWorldDir(agentName, seed, botsDir)}/${file}`;
}

function isFile(filePath) {
    try {
        return fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
}

/**
 * The one-time copy: with shared_memory on, every file of SHARED_FILES that is missing in the shared folder and
 * present in the bot's own folder is copied there (never overwritten: a file another bot shared first stays).
 * Never throws; a file that cannot be copied is left out with a warning.
 * @param {string} agentName
 * @param {string} seed
 * @param {{shared_memory?: boolean}} settings
 * @param {string} [botsDir]
 * @returns {{copied: string[], text: string|null}} the names of the files copied and SHARED_TEXT when one was
 */
export function shareOnce(agentName, seed, settings, botsDir = DEFAULT_BOTS_DIR) {
    const copied = [];
    if (!isShared(settings)) {
        return { copied, text: null };
    }
    const target = sharedWorldDir(seed, botsDir);
    for (const file of SHARED_FILES) {
        const own = ownFileOf(agentName, seed, file, botsDir);
        const shared = `${target}/${file}`;
        try {
            if (fs.existsSync(shared) || !isFile(own)) {
                continue;
            }
            fs.mkdirSync(target, { recursive: true });
            fs.copyFileSync(own, shared, fs.constants.COPYFILE_EXCL);
            copied.push(file);
        } catch (err) {
            if (err?.code === 'EEXIST') {
                continue; // the other bot shared it in the same moment
            }
            console.warn(`Could not share ${own} as ${shared}:`, err?.message ?? err);
        }
    }
    return { copied, text: copied.length > 0 ? SHARED_TEXT : null };
}

/** How long a read trusts the last look at a shared file, in ms: the area guard asks for every block of a path. */
export const READ_CHECK_MS = 1000;

/**
 * The mark of a file that another process may write. A store marks the file when it read or wrote it and asks
 * `changed()` before a read and `changed(true)` before a write: true when the file's mtime, size or inode differs
 * from the mark (a missing file counts as a state too; every atomic write is a new inode). A read looks at the file
 * at most once per `readCheckMs`, so the change of another bot is seen within that time; a write always looks.
 * Never throws.
 */
export class SharedFile {
    /**
     * @param {string} filePath
     * @param {{readCheckMs?: number, now?: () => number}} [options] readCheckMs: READ_CHECK_MS; 0 looks every time
     */
    constructor(filePath, options = {}) {
        this.filePath = filePath;
        const every = options?.readCheckMs;
        this._every = typeof every === 'number' && Number.isFinite(every) && every >= 0 ? every : READ_CHECK_MS;
        this._now = typeof options?.now === 'function' ? options.now : Date.now;
        this._seen = undefined;
        this._lookedAt = null;
    }

    /** @returns {string|null} the mtime, size and inode of the file, null when it is missing */
    stamp() {
        try {
            const stat = fs.statSync(this.filePath);
            return `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
        } catch {
            return null;
        }
    }

    /**
     * @param {boolean} [fresh] true before a write: always look at the file
     * @returns {boolean} true when the file differs from the last mark (always before the first mark)
     */
    changed(fresh = false) {
        const now = this._time();
        if (!fresh && this._seen !== undefined && this._lookedAt !== null && now - this._lookedAt < this._every) {
            return false;
        }
        this._lookedAt = now;
        return this.stamp() !== this._seen;
    }

    /**
     * Remembers the file as it was when `stamp` was taken: a store takes the stamp before it reads, so a write of
     * another bot during the read is seen as a change at the next look.
     * @param {string|null} [stamp] the result of stamp(); without it the file as it is now
     */
    mark(stamp) {
        this._seen = stamp === undefined ? this.stamp() : stamp;
        this._lookedAt = this._time();
    }

    _time() {
        try {
            const value = this._now();
            return typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
        } catch {
            return Date.now();
        }
    }
}

/**
 * The paths of one bot, for world_memory.js and the stores of agent.js (they import nothing of this module):
 * `storeDir(key)` the folder of the stores (worldDir), `share(key)` the one-time copy (shareOnce), `sharedFile(file)`
 * a SharedFile of a store's file with shared_memory on, else null (the store then reads its file once, as before).
 * @param {string} agentName
 * @param {{shared_memory?: boolean}} settings read live
 * @param {string} [botsDir]
 * @returns {{storeDir: function(string): string, share: function(string): {copied: string[], text: string|null},
 *   sharedFile: function(string): (SharedFile|null), shared: function(): boolean}}
 */
export function memoryPathsFor(agentName, settings, botsDir = DEFAULT_BOTS_DIR) {
    return {
        storeDir: (key) => worldDir(agentName, key, settings, botsDir),
        share: (key) => shareOnce(agentName, key, settings, botsDir),
        sharedFile: (file) => (isShared(settings) && typeof file === 'string' && file.length > 0 ? new SharedFile(path.normalize(file)) : null),
        shared: () => isShared(settings),
    };
}
