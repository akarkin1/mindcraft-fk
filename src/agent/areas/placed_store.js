// Blocks that the bot placed, per world (spec v0.1.4.8, D4), persisted as
// { version: 1, placed: ["overworld 12 64 -3", ...] } in <worldDir>/placed.json, oldest first.
// With protect_built_blocks the guard lets the bot break what it placed itself (D3).
// The file is written at most once per 5 s, and by flush() at the end: never once per block.
import { readJsonSafe, writeJsonAtomic } from '../../utils/safe_json.js';
import { normalizeDimension } from './area_store.js';

const FILE_VERSION = 1;

/** Most positions kept; beyond it the oldest leave. */
export const MAX_PLACED = 5000;

/** Shortest time between two writes of the file, in ms. */
export const SAVE_INTERVAL_MS = 5000;

const ENTRY = /^(\S+) (-?\d+) (-?\d+) (-?\d+)$/;

function isPosition(pos) {
    return pos !== null && typeof pos === 'object'
        && Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z);
}

function keyOf(pos, dimension) {
    return `${normalizeDimension(dimension)} ${Math.floor(pos.x)} ${Math.floor(pos.y)} ${Math.floor(pos.z)}`;
}

function positiveInt(value, fallback) {
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

function defaultSetTimer(fn, ms) {
    const timer = setTimeout(fn, ms);
    timer?.unref?.(); // a pending save never keeps the process alive; flush() writes at the end
    return timer;
}

export class PlacedStore {
    /**
     * @param {string|null} filePath usually <worldDir>/placed.json; null keeps the positions in memory only
     * @param {{max?: number, intervalMs?: number, now?: () => number,
     *   setTimer?: (fn: Function, ms: number) => *, clearTimer?: (timer: *) => void}} [options]
     *   max: most positions (5000); intervalMs: shortest time between writes (5000); the timer functions
     *   default to setTimeout (unref) and clearTimeout.
     */
    constructor(filePath, options = {}) {
        this.filePath = typeof filePath === 'string' && filePath !== '' ? filePath : null;
        const opts = options ?? {};
        this.max = positiveInt(opts.max, MAX_PLACED);
        this.intervalMs = positiveInt(opts.intervalMs, SAVE_INTERVAL_MS);
        this._setTimer = typeof opts.setTimer === 'function' ? opts.setTimer : defaultSetTimer;
        this._clearTimer = typeof opts.clearTimer === 'function' ? opts.clearTimer : (timer) => clearTimeout(timer);
        this._keys = new Set(); // insertion order: oldest first
        this._dirty = false;
        this._timer = null;
        this._writeFailed = false;
    }

    /**
     * Reads the file. Missing: empty. Corrupt: set aside by readJsonSafe, empty. Invalid entries are
     * skipped; beyond `max` only the newest stay. Never throws.
     * @returns {number} number of positions
     */
    load() {
        this._keys = new Set();
        this._dirty = false;
        if (!this.filePath) {
            return 0;
        }
        try {
            const result = readJsonSafe(this.filePath, { expect: 'object' });
            if (result.status === 'ok') {
                const list = Array.isArray(result.data.placed) ? result.data.placed : [];
                let skipped = 0;
                for (const entry of list) {
                    const match = typeof entry === 'string' ? ENTRY.exec(entry) : null;
                    if (!match) {
                        skipped++;
                        continue;
                    }
                    const key = keyOf({ x: Number(match[2]), y: Number(match[3]), z: Number(match[4]) }, match[1]);
                    this._keys.delete(key);
                    this._keys.add(key);
                }
                this._trim();
                if (skipped > 0) {
                    console.warn(`Placed blocks file ${this.filePath}: skipped ${skipped} invalid entries.`);
                }
            } else if (result.status !== 'missing') {
                console.warn(`Placed blocks file ${this.filePath} could not be read (${result.status}). Starting empty.`);
            }
        } catch (err) {
            console.warn(`Placed blocks file ${this.filePath} could not be read:`, err?.message ?? err);
            this._keys = new Set();
        }
        return this._keys.size;
    }

    _trim() {
        while (this._keys.size > this.max) {
            this._keys.delete(this._keys.values().next().value);
        }
    }

    _changed() {
        this._dirty = true;
        if (!this.filePath || this._timer !== null) {
            return;
        }
        try {
            this._timer = this._setTimer(() => {
                this._timer = null;
                this.flush();
            }, this.intervalMs);
        } catch {
            this._timer = null; // flush() at the end still writes
        }
    }

    /**
     * Notes a block that the bot placed. A position noted again becomes the newest.
     * @param {{x: number, y: number, z: number}} pos
     * @param {string} [dimension] default overworld
     * @returns {boolean} false for an invalid position
     */
    add(pos, dimension) {
        if (!isPosition(pos)) {
            return false;
        }
        const key = keyOf(pos, dimension);
        this._keys.delete(key);
        this._keys.add(key);
        this._trim();
        this._changed();
        return true;
    }

    /**
     * Forgets a position: the block there is gone.
     * @returns {boolean} true if it was noted
     */
    remove(pos, dimension) {
        if (!isPosition(pos) || !this._keys.delete(keyOf(pos, dimension))) {
            return false;
        }
        this._changed();
        return true;
    }

    /** @returns {boolean} true when the bot placed the block at the position */
    has(pos, dimension) {
        return isPosition(pos) && this._keys.has(keyOf(pos, dimension));
    }

    /** Number of positions. */
    get size() {
        return this._keys.size;
    }

    /** @returns {{x: number, y: number, z: number, dimension: string}[]} oldest first */
    list() {
        return [...this._keys].map((key) => {
            const [dimension, x, y, z] = key.split(' ');
            return { x: Number(x), y: Number(y), z: Number(z), dimension };
        });
    }

    /**
     * Writes the file now when something changed since the last write. Never throws.
     * @returns {boolean} false when the write failed
     */
    flush() {
        if (this._timer !== null) {
            try {
                this._clearTimer(this._timer);
            } catch {
                // the timer only calls flush(), which then finds nothing to write
            }
            this._timer = null;
        }
        if (!this._dirty || !this.filePath) {
            this._dirty = false;
            return true;
        }
        try {
            writeJsonAtomic(this.filePath, { version: FILE_VERSION, placed: [...this._keys] }, { indent: 0 });
            this._dirty = false;
            this._writeFailed = false;
            return true;
        } catch (err) {
            if (!this._writeFailed) {
                this._writeFailed = true;
                console.warn(`Could not write the placed blocks file ${this.filePath}:`, err?.message ?? err);
            }
            return false;
        }
    }
}
