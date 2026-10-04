// Lasting rules that the player teaches the bot (spec v0.1.4.6 R1). They belong to the bot, not
// to a world. File bots/<name>/rules.json: { "version": 1, "rules": [ { id, text, created } ] }.
// No side effects at import.
import { readJsonSafe, writeJsonAtomic } from '../../utils/safe_json.js';

const FILE_VERSION = 1;
export const RULE_TEXT_MAX = 200;
export const DEFAULT_RULES_MAX = 20;

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isId(value) {
    return Number.isSafeInteger(value) && value >= 1;
}

// Trimmed, line breaks become spaces. Not a string: ''.
function cleanText(text) {
    return typeof text === 'string' ? text.replace(/\r\n|\r|\n/g, ' ').trim() : '';
}

// Two rules are the same when they differ only in upper and lower case, in spaces, and in full
// stops at the end.
function sameRuleKey(text) {
    return text.toLowerCase().replace(/\s+/g, ' ').replace(/[\s.]+$/, '');
}

// The limit of rules: a number that is not finite or is below 0 counts as the default, 0 means
// no limit, a fraction is rounded down but a positive limit stays at least 1.
function normalizeMax(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
        return DEFAULT_RULES_MAX;
    if (value === 0)
        return 0;
    return Math.max(1, Math.floor(value));
}

function describePath(filePath) {
    try {
        return String(filePath);
    } catch {
        return '(unprintable path)';
    }
}

function messageOf(error) {
    try {
        return error?.message ?? String(error);
    } catch {
        return '(unprintable error)';
    }
}

export class RuleStore {
    /**
     * @param {string} filePath
     * @param {{now?: () => Date, max?: number, shared?: {changed: (fresh?: boolean) => boolean, mark: (stamp?: string|null) => void, stamp?: () => string|null}|null}} options
     *   shared (v0.1.4.13, M1): a SharedFile of memory_paths.js when another bot writes the same file: the store
     *   re-reads the file before a read or a write when it changed; without it the file is read once, as before
     */
    constructor(filePath, options = {}) {
        this.filePath = filePath;
        const opts = isPlainObject(options) ? options : {};
        this.now = typeof opts.now === 'function' ? opts.now : () => new Date();
        this._max = normalizeMax(opts.max);
        const shared = opts.shared;
        this._shared = shared && typeof shared.changed === 'function' && typeof shared.mark === 'function' ? shared : null;
        this._rules = new Map();
    }

    // v0.1.4.13 (M1): the file as another bot left it; `fresh` before a write (a read looks at most once a second).
    // Never throws.
    _refresh(fresh = false) {
        try {
            if (this._shared !== null && this._shared.changed(fresh))
                this.load();
        } catch (error) {
            console.warn(`Could not re-read the rule file ${describePath(this.filePath)}:`, messageOf(error));
        }
    }

    /**
     * Reads the file. Missing: no rules. Corrupt: set aside by readJsonSafe, no rules. Entries
     * without a whole number id of 1 or more, with an id seen before, or without a text are
     * skipped. Never throws.
     * @returns {number} the number of rules
     */
    load() {
        const seen = this._shared?.stamp?.(); // v0.1.4.13 (M1): the file as it was before the read
        this._rules = new Map();
        try {
            const result = readJsonSafe(this.filePath, { expect: 'object', now: this.now });
            if (result.status === 'ok') {
                const rules = result.data.rules;
                if (Array.isArray(rules)) {
                    for (const entry of rules) {
                        if (!isPlainObject(entry) || !isId(entry.id) || this._rules.has(entry.id))
                            continue;
                        const text = cleanText(entry.text);
                        if (text === '')
                            continue;
                        this._rules.set(entry.id, {
                            id: entry.id,
                            text,
                            created: typeof entry.created === 'string' ? entry.created : null,
                        });
                    }
                } else if (rules !== undefined) {
                    console.warn(`Rule file ${describePath(this.filePath)} has no "rules" list, starting with no rules.`);
                }
            } else if (result.status !== 'missing') {
                let warning = `Rule file ${describePath(this.filePath)} could not be read (${result.status}: ${messageOf(result.error)}).`;
                if (result.quarantinedTo)
                    warning += ` Corrupt file moved to ${result.quarantinedTo}.`;
                console.warn(`${warning} Starting with no rules.`);
            }
        } catch (error) {
            console.warn(`Rule file ${describePath(this.filePath)} could not be read:`, messageOf(error));
            this._rules = new Map();
        }
        this._shared?.mark(seen);
        return this._rules.size;
    }

    /**
     * Saves a rule and writes the file. The text is trimmed and line breaks become spaces.
     * @returns {{ok: boolean, id: number|null, reason: null|'empty'|'too_long'|'duplicate'|'full'}}
     */
    add(text) {
        const clean = cleanText(text);
        if (clean === '')
            return { ok: false, id: null, reason: 'empty' };
        if (clean.length > RULE_TEXT_MAX)
            return { ok: false, id: null, reason: 'too_long' };
        this._refresh(true);
        const key = sameRuleKey(clean);
        for (const rule of this._rules.values()) {
            if (sameRuleKey(rule.text) === key)
                return { ok: false, id: null, reason: 'duplicate' };
        }
        if (this._max > 0 && this._rules.size >= this._max)
            return { ok: false, id: null, reason: 'full' };
        let id = 1;
        while (this._rules.has(id))
            id++;
        this._rules.set(id, { id, text: clean, created: this.now().toISOString() });
        this._save();
        return { ok: true, id, reason: null };
    }

    /**
     * Removes a rule by its number and writes the file.
     * @param {number|string} id - a whole number, also written as text
     * @returns {boolean} true if the rule existed
     */
    remove(id) {
        const number = typeof id === 'string' && /^\s*\d+\s*$/.test(id) ? Number(id) : id;
        if (!isId(number))
            return false;
        this._refresh(true);
        if (!this._rules.has(number))
            return false;
        this._rules.delete(number);
        this._save();
        return true;
    }

    /** @returns {{id: number, text: string, created: string|null}[]} copies, in order of the id */
    list() {
        this._refresh();
        return this._sorted();
    }

    // the rules in the order of list, as copies; no re-read (a save uses it)
    _sorted() {
        return [...this._rules.values()].sort((a, b) => a.id - b.id).map(rule => ({ ...rule }));
    }

    get size() {
        this._refresh();
        return this._rules.size;
    }

    /** The limit of rules, 0 for no limit. */
    get max() {
        return this._max;
    }

    _save() {
        try {
            writeJsonAtomic(this.filePath, { version: FILE_VERSION, rules: this._sorted() }, { indent: 2 });
            this._shared?.mark();
            return true;
        } catch (error) {
            console.warn(`Could not write the rule file ${describePath(this.filePath)}:`, messageOf(error));
            return false;
        }
    }
}
