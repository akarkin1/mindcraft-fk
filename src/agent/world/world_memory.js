// Coordinates per-world persistence: watches the raw connection for what
// identifies the world, records the visit in the registry, points History at
// the world's directory and gives the MemoryBank the world's place store.
// Imports nothing from mineflayer; works on bot._client only.
import fs from 'node:fs';
import { resolveWorld } from './world_identity.js';
import { WorldRegistry } from './world_registry.js';
import { PlaceStore } from './place_store.js';

const UNKNOWN_KEY = 'unknown';
const INT32_MIN = -0x80000000;
const UINT32_MAX = 0xFFFFFFFF;
const TWO_POW_32 = 4294967296;

function isObject(value) {
    return value !== null && typeof value === 'object';
}

function isWord(value) {
    return typeof value === 'number' && Number.isInteger(value)
        && value >= INT32_MIN && value <= UINT32_MAX;
}

function finiteOrUndefined(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

// A signed 64-bit protocol value ([high, low], bigint, number or decimal
// string) as a number, or undefined when it cannot be converted.
function int64ToNumber(value) {
    try {
        if (typeof value === 'number') {
            return finiteOrUndefined(value);
        }
        if (typeof value === 'bigint') {
            return finiteOrUndefined(Number(value));
        }
        if (typeof value === 'string') {
            return /^-?\d+$/.test(value) ? finiteOrUndefined(Number(BigInt(value))) : undefined;
        }
        if (isObject(value) && value.length === 2 && isWord(value[0]) && isWord(value[1])) {
            return finiteOrUndefined((value[0] | 0) * TWO_POW_32 + (value[1] >>> 0));
        }
    } catch {
        // not convertible
    }
    return undefined;
}

// UTC YYYYMMDD-HHMMSS
function formatStamp(date) {
    const pad = (n, width = 2) => String(n).padStart(width, '0');
    return `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
        + `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

// UTC YYYY-MM-DD of an ISO time string
function formatDay(isoText) {
    const time = typeof isoText === 'string' ? Date.parse(isoText) : NaN;
    if (Number.isNaN(time)) {
        return 'an unknown date';
    }
    return new Date(time).toISOString().slice(0, 10);
}

function asSentence(text) {
    const trimmed = String(text).trim();
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function isFile(filePath) {
    try {
        return fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
}

function errorText(err) {
    return err?.stack ?? err?.message ?? String(err);
}

export class WorldMemory {
    /**
     * @param {{name: string, botsDir?: string, settings?: object, history: object,
     *   memoryBank: object, now?: () => Date, paths?: object}} options
     *   paths (v0.1.4.13, M1): memoryPathsFor of src/agent/memory_paths.js, `{ storeDir(key), share(key),
     *   sharedFile(file) }`: the folder of the stores of the world (the shared folder with shared_memory), the
     *   one-time copy and the file mark of the places; without it the stores live in the world folder, as before
     */
    constructor({ name, botsDir = './bots', settings = {}, history, memoryBank, now, paths = null } = {}) {
        this.name = name;
        this.botsDir = botsDir;
        this.botDir = `${botsDir}/${name}`;
        this.settings = settings ?? {};
        this.history = history ?? null;
        this.memoryBank = memoryBank ?? null;
        this.now = typeof now === 'function' ? now : () => new Date();
        this.paths = paths !== null && typeof paths === 'object' ? paths : null;
        this._storeDir = null;
        this._sharedCopied = [];

        // what the connection revealed, latest packet wins
        this._login = null; // { hashedSeed, isFlat, name, isHardcore }
        this._motd = undefined;
        this._age = undefined;
        this._client = null;

        this._world = null;
        this._worldDir = null;
        this._registry = null;
    }

    /** Result of the last resolve, or null. */
    get world() {
        return this._world;
    }

    /** Directory of the current world, or null. */
    get worldDir() {
        return this._worldDir;
    }

    /**
     * v0.1.4.13 (M1): the folder of the stores of areas, places, routes, mines, chests and rules of the current
     * world: the shared folder with shared_memory, else the world folder; null before the world is known.
     */
    get storeDir() {
        return this._storeDir;
    }

    /** v0.1.4.13 (M1): the files the last resolve copied into the shared folder (the one-time copy), [] for none. */
    get sharedCopied() {
        return [...this._sharedCopied];
    }

    /**
     * Listens on bot._client for the raw packets login, server_data and
     * update_time. Does nothing without a connection. Never throws.
     */
    attach(bot) {
        try {
            const client = bot?._client;
            if (!client || typeof client.on !== 'function' || client === this._client) {
                return;
            }
            this._client = client;
            client.on('login', packet => this._onLogin(packet));
            client.on('server_data', packet => this._onServerData(packet));
            client.on('update_time', packet => this._onUpdateTime(packet));
        } catch (err) {
            console.warn('World memory could not listen to the connection:', err?.message ?? err);
        }
    }

    _onLogin(packet) {
        try {
            if (!isObject(packet) || !isObject(packet.worldState)) {
                return;
            }
            const worldState = packet.worldState;
            this._login = {
                hashedSeed: worldState.hashedSeed,
                isFlat: worldState.isFlat,
                name: worldState.name,
                isHardcore: packet.isHardcore,
            };
        } catch {
            // packet of another shape
        }
    }

    _onServerData(packet) {
        try {
            if (isObject(packet) && packet.motd !== undefined && packet.motd !== null) {
                this._motd = packet.motd;
            }
        } catch {
            // packet of another shape
        }
    }

    _onUpdateTime(packet) {
        try {
            if (!isObject(packet)) {
                return;
            }
            const age = int64ToNumber(packet.age);
            if (age !== undefined) {
                this._age = age;
            }
        } catch {
            // packet of another shape
        }
    }

    /**
     * Identifies the world and switches memory, history and places to it.
     * Never throws and never rejects; on failure it falls back to the world
     * "unknown".
     * @param {{loadMemory?: boolean, getDimension?: function(): string}} options
     * @returns {Promise<{key: string, label: string, source: string, isNew: boolean,
     *   changedWorld: boolean, warnings: string[], saveData: object|null,
     *   note: string|null, adoptedLegacy: boolean}>}
     */
    async resolve(options = {}) {
        let loadMemory = false;
        let getDimension = null;
        try {
            loadMemory = Boolean(options?.loadMemory);
            getDimension = typeof options?.getDimension === 'function' ? options.getDimension : null;
        } catch {
            // keep the defaults
        }
        const context = { loadMemory, getDimension, registry: null, knownBefore: null };

        try {
            return this._run(this._observedWorld(), context, true);
        } catch (err) {
            console.warn(`World memory failed to set up the world, continuing with the world "${UNKNOWN_KEY}":`, errorText(err));
        }
        try {
            return this._run(this._unknownWorld(), context, false);
        } catch (err) {
            console.warn(`World memory failed to set up the world "${UNKNOWN_KEY}":`, errorText(err));
        }
        const result = {
            key: UNKNOWN_KEY,
            label: UNKNOWN_KEY,
            source: 'unknown',
            isNew: false,
            changedWorld: false,
            warnings: [],
            saveData: null,
            note: null,
            adoptedLegacy: false,
        };
        this._world = result;
        this._worldDir = null;
        this._storeDir = null;
        this._sharedCopied = [];
        return result;
    }

    /**
     * Sets a manual label for the current world.
     * @returns {boolean}
     */
    setLabel(label) {
        try {
            if (this._world === null || this._registry === null) {
                return false;
            }
            if (typeof label !== 'string' || label.trim() === '') {
                return false;
            }
            if (!this._registry.setLabel(this._world.key, label)) {
                return false;
            }
            this._world.label = this._registry.get(this._world.key)?.label ?? label.trim();
            return true;
        } catch (err) {
            console.warn('World memory could not name the world:', err?.message ?? err);
            return false;
        }
    }

    _observedWorld() {
        const login = this._login ?? {};
        return resolveWorld({
            hashedSeed: login.hashedSeed,
            motd: this._motd,
            worldId: this.settings?.world_id,
            isHardcore: login.isHardcore,
            isFlat: login.isFlat,
        });
    }

    _unknownWorld() {
        const login = this._login ?? {};
        // without id, seed and motd resolveWorld gives the world "unknown"
        return resolveWorld({ isHardcore: login.isHardcore, isFlat: login.isFlat });
    }

    // strict: the first error aborts the run. Not strict (the fallback run):
    // every step is tried on its own and a failing step is logged and skipped.
    _run(world, context, strict) {
        const step = (description, action, fallback) => {
            if (strict) {
                return action();
            }
            try {
                return action();
            } catch (err) {
                console.warn(`World memory: ${description} failed:`, err?.message ?? err);
                return fallback;
            }
        };
        const key = world.key;

        // 2. registry
        if (context.registry === null) {
            step('reading the world registry', () => {
                const registry = new WorldRegistry(this.botDir, { now: this.now });
                context.knownBefore = registry.load();
                context.registry = registry;
            }, undefined);
        }
        const registry = context.registry;
        const previous = registry !== null ? registry.get(key) : undefined;
        const visit = registry !== null
            ? step('recording the visit', () => registry.visit(world, { age: this._age }), null)
            : null;
        const isNew = visit !== null ? visit.isNew : previous === undefined;
        const changedWorld = visit !== null ? visit.changedWorld : true;
        const warnings = visit !== null ? [...visit.warnings] : [];
        const storedLabel = visit !== null ? visit.entry.label : previous?.label;
        const label = typeof storedLabel === 'string' && storedLabel !== '' ? storedLabel : world.label;

        // 3. world directory
        const worldDir = `${this.botDir}/worlds/${key}`;
        const dirReady = step('creating the world directory', () => {
            fs.mkdirSync(worldDir, { recursive: true });
            return true;
        }, false);

        // 3b. v0.1.4.13 (M1): the folder of the stores (the shared folder with shared_memory), and the one-time copy
        // of the bot's own files into it before the stores open
        let storeDir = worldDir;
        let sharedCopied = [];
        if (dirReady && this.paths !== null) {
            storeDir = step('finding the folder of the memory of the world', () => {
                const dir = typeof this.paths.storeDir === 'function' ? this.paths.storeDir(key) : null;
                if (typeof dir !== 'string' || dir.length === 0) {
                    return worldDir;
                }
                fs.mkdirSync(dir, { recursive: true });
                return dir;
            }, worldDir);
            sharedCopied = step('sharing the memory of the world', () => {
                const shared = typeof this.paths.share === 'function' ? this.paths.share(key) : null;
                return Array.isArray(shared?.copied) ? [...shared.copied] : [];
            }, []);
        }

        // 4. legacy adoption, only when the memory is loaded
        let adoptedLegacy = false;
        if (dirReady && context.loadMemory && context.knownBefore === 0) {
            adoptedLegacy = step('carrying the earlier memory over', () => this._adoptLegacy(worldDir), false);
        }

        // 5. history storage
        if (dirReady && this.history !== null) {
            step('moving the history storage', () => {
                this.history.setStorageDir(worldDir);
                if (this.history.storage_ready === false) {
                    throw new Error(`history storage could not be set up in ${worldDir}`);
                }
            }, undefined);
        }

        // 6. memory: load it or archive it
        let saveData = null;
        if (dirReady && this.history !== null) {
            if (context.loadMemory) {
                saveData = step('loading the memory', () => this.history.load() ?? null, null);
            } else {
                step('archiving the previous memory', () => {
                    const stamp = formatStamp(this.now());
                    this.history.archiveExisting(`${this.botsDir}/_archive/${this.name}-${stamp}/worlds/${key}`);
                }, undefined);
            }
        }

        // 7. places (v0.1.4.13, M1: in the folder of the stores, re-read when another bot wrote the file)
        if (dirReady && this.memoryBank !== null) {
            step('loading the saved places', () => {
                const file = `${storeDir}/places.json`;
                const shared = typeof this.paths?.sharedFile === 'function' ? this.paths.sharedFile(file) : null;
                const store = new PlaceStore(file, { now: this.now, shared: shared ?? null });
                store.load();
                this.memoryBank.attachStore(store, context.getDimension);
            }, undefined);
        }

        // 8. note
        const result = {
            key,
            label,
            source: world.source,
            isNew,
            changedWorld,
            warnings,
            saveData,
            note: null,
            adoptedLegacy,
        };
        result.note = step('writing the note', () => this._buildNote(result, previous?.last_seen), null);

        this._world = result;
        this._worldDir = dirReady ? worldDir : null;
        this._storeDir = dirReady ? storeDir : null;
        this._sharedCopied = sharedCopied;
        this._registry = registry;
        return result;
    }

    // Copies <botDir>/memory.json into the world directory when it has none.
    _adoptLegacy(worldDir) {
        const legacy = `${this.botDir}/memory.json`;
        const target = `${worldDir}/memory.json`;
        if (!isFile(legacy) || fs.existsSync(target)) {
            return false;
        }
        fs.copyFileSync(legacy, target, fs.constants.COPYFILE_EXCL);
        return true;
    }

    _describePlaces() {
        try {
            if (typeof this.memoryBank?.describePlaces === 'function') {
                return this.memoryBank.describePlaces();
            }
        } catch (err) {
            console.warn('World memory could not list the saved places:', err?.message ?? err);
        }
        return 'none';
    }

    _buildNote(result, previousLastSeen) {
        const { isNew, changedWorld, warnings, adoptedLegacy, label } = result;
        if (!isNew && !changedWorld && warnings.length === 0) {
            return null;
        }
        const sentences = [];
        if (isNew && adoptedLegacy) {
            sentences.push(`You are in the world "${label}". This is your first visit here. Your earlier memory was carried over into this world.`);
        } else if (isNew) {
            sentences.push(`You are in the world "${label}". This is your first visit here: you have no memories and no saved places in this world.`);
        } else {
            sentences.push(`You are in the world "${label}". Your last visit was on ${formatDay(previousLastSeen)}. Saved places here: ${this._describePlaces()}.`);
        }
        for (const warning of warnings) {
            sentences.push(asSentence(warning));
        }
        return sentences.join(' ');
    }
}
