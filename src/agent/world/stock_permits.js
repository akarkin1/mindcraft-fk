// The stock permits of one world (spec v0.1.4.16, section 8.1, E6): whether the bot may take an item from the chests it knows
// for its work (the feed of the breeding, the lapis of the enchanting). The owner's rule (DECISIONS O-3): the bot asks the
// first time, remembers the yes, and asks again only when the stock runs low. Persisted as
// { version: 1, items: { wheat: { allowed: true, at: <ms> } } } in <worldDir>/permits.json. A pure file store like BaseStore:
// it reads and writes its file and nothing else. An item is kept as mineflayer names it (trimmed, lower case, without
// `minecraft:`), so "Wheat" and "minecraft:wheat" are one item. The agent wires it as ctx.permits (_workStores) while one of
// breeding, enchanting or afk_kill is on; the texts of !allowTaking live here too, as actions.js imports no pack.
import { readJsonSafe, writeJsonAtomic } from '../../utils/safe_json.js';

/** The name of the file in the world folder. */
export const PERMITS_FILE = 'permits.json';

/** The answer of !allowTaking to the model once the line was said in the chat (as the survey's commands answer). */
export const ALLOW_SAID_TEXT = 'Done; I said it in the chat.';

const FILE_VERSION = 1;
const NAME_MAX = 64;

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

// Same order as Array.prototype.sort without a comparator.
function compareNames(a, b) {
    if (a < b) {
        return -1;
    }
    return a > b ? 1 : 0;
}

/**
 * The name of an item as it is saved and looked up: trimmed, lower case, without `minecraft:`.
 * @param {*} name
 * @returns {string|null} null for anything that is not a non-empty string of at most 64 characters
 */
export function normalizeItemName(name) {
    if (typeof name !== 'string') {
        return null;
    }
    const clean = name.trim().toLowerCase().replace(/^minecraft:/, '');
    return clean.length >= 1 && clean.length <= NAME_MAX ? clean : null;
}

/**
 * The line of !allowTaking (8.1): `I may take wheat from the chests now.` or `I take no wheat from the chests.`
 * @param {string} item
 * @param {boolean} allowed
 * @returns {string}
 */
export function allowTakingText(item, allowed) {
    return allowed === true ? `I may take ${item} from the chests now.` : `I take no ${item} from the chests.`;
}

/**
 * The answer of !allowTaking when no player gave the word (the model on its own, a routine, another bot): the no-permit
 * line of 8.1, `I take no wheat without your word; say "you may take wheat" when you want.` (noPermitText of the breeding
 * pack gives the same sentence; actions.js imports no pack).
 * @param {string} item
 * @returns {string}
 */
export function noWordText(item) {
    return `I take no ${item} without your word; say "you may take ${item}" when you want.`;
}

function toMs(value) {
    if (value instanceof Date) {
        return value.getTime();
    }
    return isFiniteNumber(value) ? value : null;
}

// The clean entry to store, or null when the entry is not valid: an item name and a boolean.
function validateEntry(item, entry) {
    const name = normalizeItemName(item);
    if (!name || !isPlainObject(entry) || typeof entry.allowed !== 'boolean') {
        return null;
    }
    return { item: name, allowed: entry.allowed, at: isFiniteNumber(entry.at) && entry.at >= 0 ? Math.floor(entry.at) : 0 };
}

export class StockPermits {
    /**
     * @param {string|null} filePath usually <worldDir>/permits.json; without it the store lives in memory only
     * @param {{now?: () => (Date|number), shared?: {changed: (fresh?: boolean) => boolean, mark: (stamp?: string|null) => void, stamp?: () => string|null}|null}} [options]
     *   now: the clock of `at` (a Date or milliseconds; Date.now without it); shared (v0.1.4.13, M1): a SharedFile of
     *   memory_paths.js when another bot writes the same file: the store re-reads the file before a read or a write when it
     *   changed; without it the file is read once
     */
    constructor(filePath, options = {}) {
        this.filePath = typeof filePath === 'string' && filePath.length > 0 ? filePath : null;
        const now = options?.now;
        this.now = typeof now === 'function' ? now : () => Date.now();
        const shared = options?.shared;
        this._shared = this.filePath !== null && shared && typeof shared.changed === 'function' && typeof shared.mark === 'function' ? shared : null;
        this._items = new Map();
    }

    // The file as another bot left it; `fresh` before a write (a read looks at most once a second). Never throws.
    _refresh(fresh = false) {
        try {
            if (this._shared !== null && this._shared.changed(fresh)) {
                this.load();
            }
        } catch (err) {
            console.warn(`Could not re-read the permits file ${this.filePath}:`, err?.message ?? err);
        }
    }

    _nowMs() {
        try {
            const t = toMs(this.now());
            return t === null ? Date.now() : t;
        } catch {
            return Date.now();
        }
    }

    /**
     * Reads the file. Missing: empty. Corrupt: set aside by readJsonSafe, empty. Invalid entries are skipped. Never throws.
     * @returns {number} number of items with a permit (a yes or a no)
     */
    load() {
        const seen = this._shared?.stamp?.();
        this._items = new Map();
        if (this.filePath === null) {
            return 0;
        }
        try {
            const result = readJsonSafe(this.filePath, { expect: 'object', now: () => new Date(this._nowMs()) });
            if (result.status === 'ok') {
                const items = result.data.items;
                if (isPlainObject(items)) {
                    for (const [item, entry] of Object.entries(items)) {
                        const clean = validateEntry(item, entry);
                        if (clean) {
                            this._items.set(clean.item, clean);
                        }
                    }
                } else if (items !== undefined) {
                    console.warn(`Permits file ${this.filePath} has no "items" object, starting empty.`);
                }
            } else if (result.status !== 'missing') {
                let warning = `Permits file ${this.filePath} could not be read (${result.status}: ${result.error?.message}).`;
                if (result.quarantinedTo) {
                    warning += ` Corrupt file moved to ${result.quarantinedTo}.`;
                }
                console.warn(`${warning} Starting with no permits.`);
            }
        } catch (err) {
            console.warn(`Permits file ${this.filePath} could not be read:`, err?.message ?? err);
            this._items = new Map();
        }
        this._shared?.mark(seen);
        return this._items.size;
    }

    /**
     * The permit of an item: whether it may be taken, and when that was decided.
     * @param {string} item
     * @returns {{item: string, allowed: boolean, at: number}|null} a copy; null when nothing was decided for the item
     */
    entry(item) {
        const name = normalizeItemName(item);
        if (!name) {
            return null;
        }
        this._refresh();
        const found = this._items.get(name);
        return found ? { ...found } : null;
    }

    /**
     * True when the bot may take the item from the chests it knows.
     * @param {string} item
     * @returns {boolean}
     */
    may(item) {
        return this.entry(item)?.allowed === true;
    }

    /**
     * When the item was allowed, in milliseconds; 0 when it is not allowed (never, or forbidden since).
     * @param {string} item
     * @returns {number}
     */
    allowedAt(item) {
        const found = this.entry(item);
        return found && found.allowed === true ? found.at : 0;
    }

    /**
     * Allows or forbids an item and writes the file; `at` is the time of the call. Never throws.
     * @param {string} item
     * @param {boolean} allowed
     * @returns {{item: string, allowed: boolean, at: number}|null} a copy of the saved permit; null for a bad item name or
     *   a value that is not a boolean
     */
    set(item, allowed) {
        try {
            const clean = validateEntry(item, { allowed, at: this._nowMs() });
            if (!clean) {
                return null;
            }
            this._refresh(true);
            this._items.set(clean.item, clean);
            this._save();
            return { ...clean };
        } catch (err) {
            console.warn('Could not save the permit:', err?.message ?? err);
            return null;
        }
    }

    /**
     * Every permit, by item name.
     * @returns {{item: string, allowed: boolean, at: number}[]} copies
     */
    list() {
        this._refresh();
        return [...this._items.keys()].sort(compareNames).map(name => ({ ...this._items.get(name) }));
    }

    /** Number of items with a permit. */
    get size() {
        this._refresh();
        return this._items.size;
    }

    _toJson() {
        const names = [...this._items.keys()].sort(compareNames);
        return { version: FILE_VERSION, items: Object.fromEntries(names.map(name => {
            const { allowed, at } = this._items.get(name);
            return [name, { allowed, at }];
        })) };
    }

    _save() {
        if (this.filePath === null) {
            return true;
        }
        try {
            writeJsonAtomic(this.filePath, this._toJson(), { indent: 2 });
            this._shared?.mark();
            return true;
        } catch (err) {
            console.warn(`Could not write the permits file ${this.filePath}:`, err?.message ?? err);
            return false;
        }
    }
}
