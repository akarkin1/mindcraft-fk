// Decides whether a goal loaded from memory is resumed after a start, and
// guards against a goal that makes the bot crash over and over.
import { writeJsonAtomic, readJsonSafe } from '../../utils/safe_json.js';

export const RESUME_POLICIES = Object.freeze(['always', 'after_crash', 'never']);

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

/**
 * @param {*} value
 * @returns {'always'|'after_crash'|'never'} the policy, 'always' for anything unknown
 */
export function normalizePolicy(value) {
    if (typeof value !== 'string') {
        return 'always';
    }
    const policy = value.trim().toLowerCase();
    return RESUME_POLICIES.includes(policy) ? policy : 'always';
}

/**
 * @param {*} policy
 * @param {*} isRestart true when the process was restarted automatically
 * @returns {boolean}
 */
export function shouldResumeGoal(policy, isRestart) {
    switch (normalizePolicy(policy)) {
        case 'never':
            return false;
        case 'after_crash':
            return isRestart === true;
        default:
            return true;
    }
}

/**
 * Counts how often the same goal was resumed inside a time window.
 * File: { "version": 1, "prompt": "...", "resumes": [ <epoch ms>, ... ] }
 */
export class ResumeGuard {
    constructor(filePath, options = {}) {
        const { limit = 0, windowMs = DEFAULT_WINDOW_MS, now = () => new Date() } = options ?? {};
        this.filePath = filePath;
        this.limit = Number.isFinite(limit) ? limit : 0;
        this.windowMs = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : DEFAULT_WINDOW_MS;
        this.now = typeof now === 'function' ? now : () => new Date();
        this.prompt = null;
        this.resumes = [];
        this.loaded = false;
    }

    _nowMs() {
        const value = this.now();
        return value instanceof Date ? value.getTime() : Number(value);
    }

    // entries older than windowMs are outside; an entry exactly windowMs old is inside
    _inWindow(time, nowMs) {
        return nowMs - time <= this.windowMs;
    }

    load() {
        this.loaded = true;
        this.prompt = null;
        this.resumes = [];
        try {
            const result = readJsonSafe(this.filePath, { expect: 'object' });
            if (result.status !== 'ok') {
                if (result.status !== 'missing') {
                    console.warn(`Resume guard: could not read ${this.filePath} (${result.status}: ${result.error?.message}), starting empty.`);
                }
                return;
            }
            const data = result.data;
            this.prompt = typeof data.prompt === 'string' ? data.prompt : null;
            this.resumes = Array.isArray(data.resumes) ? data.resumes.filter(t => Number.isFinite(t)) : [];
        } catch (error) {
            console.warn(`Resume guard: could not read ${this.filePath}:`, error?.message ?? error);
            this.prompt = null;
            this.resumes = [];
        }
    }

    _ensureLoaded() {
        if (!this.loaded) {
            this.load();
        }
    }

    /**
     * @param {string} prompt
     * @returns {{allowed: boolean, count: number}}
     */
    check(prompt) {
        if (!(this.limit > 0)) {
            return { allowed: true, count: 0 };
        }
        this._ensureLoaded();
        let count = 0;
        if (prompt === this.prompt) {
            const nowMs = this._nowMs();
            count = this.resumes.filter(t => this._inWindow(t, nowMs)).length;
        }
        return { allowed: count < this.limit, count };
    }

    record(prompt) {
        if (!(this.limit > 0)) {
            return;
        }
        this._ensureLoaded();
        if (prompt !== this.prompt) {
            this.prompt = prompt;
            this.resumes = [];
        }
        const nowMs = this._nowMs();
        this.resumes.push(nowMs);
        this.resumes = this.resumes.filter(t => this._inWindow(t, nowMs));
        this._write();
    }

    clear() {
        this.loaded = true;
        this.prompt = null;
        this.resumes = [];
        if (this.limit > 0) {
            this._write();
        }
    }

    _write() {
        try {
            writeJsonAtomic(this.filePath, { version: 1, prompt: this.prompt, resumes: this.resumes });
        } catch (error) {
            console.warn(`Resume guard: could not write ${this.filePath}:`, error?.message ?? error);
        }
    }
}
