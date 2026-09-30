// Guard of protected areas (spec v0.1.4.6, A4). Not pure: it wraps functions of the mineflayer
// bot that is passed in, so no code can break or place a block in a protected area:
// bot.dig, bot.placeBlock, bot._placeBlockWithOptions, bot.activateBlock, and the pathfinder
// (setMovements, getPathTo, getPathFromTo add exclusion functions to the Movements object).
// Nothing is imported from mineflayer.
//
// v0.1.4.8 (part D): the rules per type of D2 (a mine lets natural blocks be broken and blocks be
// placed), built blocks outside every area with protect_built_blocks (D3), the blocks that the bot
// placed (D4), and refusal(), areaAt(), isBuilt(), placedByBot() on the view (I3).
import { normalizeDimension, normalizeAreaName, typeRank } from './area_store.js';
import { isBuiltBlock } from './area_scan.js';
import { PlacedStore } from './placed_store.js';

/** Blocks that may be broken inside a farm: ripe or not, the crops. */
export const CROP_BLOCKS = Object.freeze(['wheat', 'carrots', 'potatoes', 'beetroots', 'melon', 'pumpkin',
    'sweet_berry_bush', 'nether_wart', 'torchflower_crop', 'pitcher_crop']);

/** Items that may be placed inside a farm: seeds and crops to plant. */
export const PLANTABLE_ITEMS = Object.freeze(['wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds',
    'carrot', 'potato', 'sweet_berries', 'nether_wart', 'torchflower_seeds', 'pitcher_pod']);

/** Longest permit of !allowChanges, in minutes. */
export const MAX_PERMIT_MINUTES = 60;

const DEFAULT_PERMIT_MINUTES = 10;
const MINUTE_MS = 60_000;
const EXCLUDED = 100; // weight at which the pathfinder refuses to break or place
const CROPS = new Set(CROP_BLOCKS);
const PLANTABLE = new Set(PLANTABLE_ITEMS);
const RISKY_ITEMS = new Set(['flint_and_steel', 'fire_charge', 'bone_meal']);
// Blocks whose own use wins over the item in the hand (unless the player sneaks).
const OWN_USE_BLOCKS = new Set(['chest', 'trapped_chest', 'ender_chest', 'barrel', 'crafting_table', 'furnace',
    'smoker', 'blast_furnace']);
// A block that becomes one of these is gone: the bot no longer counts it as placed by itself.
const GONE_NAMES = new Set(['air', 'cave_air', 'void_air', 'water', 'lava']);
const EMPTY = Object.freeze([]);

// Every wrapper function this module made, so nothing is wrapped twice.
const wrappers = new WeakSet();
// bot -> guard
const guards = new WeakMap();

/**
 * Error of a refused dig, placeBlock or activateBlock. `message` is the text of the refusal.
 */
export class ProtectedAreaError extends Error {
    /**
     * @param {string} message
     * @param {{area?: string|null, position?: {x: number, y: number, z: number}|null,
     *   reason?: 'area'|'built_block'}} [details]
     */
    constructor(message, details = {}) {
        super(message);
        // defineProperty works after the SES lockdown, where assigning a property that a frozen
        // prototype has could throw.
        Object.defineProperty(this, 'name', { value: 'ProtectedAreaError', writable: true, configurable: true });
        this.area = details?.area ?? null;
        this.position = details?.position ?? null;
        this.reason = details?.reason ?? 'area';
    }
}

function baseName(name) {
    if (typeof name !== 'string') {
        return null;
    }
    return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

function isPosition(pos) {
    return pos !== null && typeof pos === 'object'
        && Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z);
}

// A hoe, a shovel, an axe, a bucket with content, flint_and_steel, fire_charge or bone_meal.
function isRiskyItem(itemName) {
    const name = baseName(itemName);
    if (!name) {
        return false;
    }
    return name.endsWith('_hoe') || name.endsWith('_shovel') || name.endsWith('_axe') || name.endsWith('_bucket')
        || RISKY_ITEMS.has(name);
}

// Doors, trapdoors, fence gates, beds, chests and workstations open or work when used, and the
// item in the hand is not used on them. Iron doors and trapdoors have no use of their own.
function blockUseWins(blockName) {
    const name = baseName(blockName);
    if (!name || name.includes('iron')) {
        return false;
    }
    return name.endsWith('_door') || name.endsWith('_trapdoor') || name.endsWith('_fence_gate')
        || name.endsWith('_bed') || name.endsWith('shulker_box') || OWN_USE_BLOCKS.has(name);
}

function compileArea(area) {
    if (area === null || typeof area !== 'object' || typeof area.name !== 'string'
        || !isPosition(area.min) || !isPosition(area.max)) {
        return null;
    }
    // an area without a known type counts as a building, as in v0.1.4.6
    const type = typeof area.type === 'string' ? area.type : 'building';
    const entry = {
        name: area.name,
        key: normalizeAreaName(area.name),
        type,
        rank: typeRank(type),
        farm: type === 'farm',
        mine: type === 'mine',
        x0: Math.min(area.min.x, area.max.x),
        y0: Math.min(area.min.y, area.max.y),
        z0: Math.min(area.min.z, area.max.z),
        x1: Math.max(area.min.x, area.max.x),
        y1: Math.max(area.min.y, area.max.y),
        z1: Math.max(area.min.z, area.max.z),
        dimension: normalizeDimension(area.dimension),
    };
    entry.volume = (entry.x1 - entry.x0 + 1) * (entry.y1 - entry.y0 + 1) * (entry.z1 - entry.z0 + 1);
    return entry;
}

// A farm first, then a mine, then the other types (typeRank), then by name: the first area that
// contains a block decides.
function compareEntries(a, b) {
    if (a.rank !== b.rank) {
        return a.rank - b.rank;
    }
    if (a.name < b.name) {
        return -1;
    }
    return a.name > b.name ? 1 : 0;
}

function describeError(err) {
    return err?.message ?? String(err);
}

// A function that returns the value of the option: a function is called, anything else is the value.
function optionReader(value) {
    return typeof value === 'function' ? value : () => value;
}

/**
 * Installs the guard on a bot and sets it as `bot.areaGuard`. A second call on the same bot
 * does nothing and returns the guard of the first call. Functions the bot does not have yet
 * (before login) are wrapped on the first "spawn".
 *
 * The guard reads the store on every call: an area saved later is guarded at once. The areas
 * are cached and the cache is refreshed when `store.revision` changes (a store without a
 * revision number is read on every call).
 *
 * @param {object} bot a mineflayer bot
 * @param {{store?: object|(() => object|null)|null, getDimension?: () => string, now?: () => number|Date,
 *   log?: (text: string) => void, protectBuiltBlocks?: boolean|(() => boolean),
 *   placed?: object|(() => object|null)|null, getCommand?: () => string|null}} [options]
 *   store: an AreaStore, or a function that returns the current one; null guards nothing.
 *   getDimension: the dimension of the bot, default `bot.game.dimension`; "minecraft:" is ignored
 *   and a missing dimension is the overworld. now: the time in ms (or a Date), default Date.now.
 *   log: receives the text of every refusal and warnings of the guard, default console.warn.
 *   protectBuiltBlocks (v0.1.4.8, D3): the setting protect_built_blocks, or a function that reads it;
 *   default false. placed (D4): the PlacedStore of the current world, or a function that returns it;
 *   default a store in memory. getCommand: the text of the running command, for the refusal texts.
 * `bot.areaGuard` is a frozen view without `permit`, `revoke`, `permits` and `setPlayerOrder`
 * (Amendment 2, F2): the code of `!newAction` gets the bot and must not open a protected area for
 * itself. Only the caller of installAreaGuard (the agent) gets the full guard.
 *
 * @returns {{canBreak: Function, canPlace: Function, canUse: Function, permit: Function, revoke: Function,
 *   permits: Function, explain: Function, protectMovements: Function, inBuilding: Function, areaAt: Function,
 *   refusal: Function, isBuilt: Function, placedByBot: Function, setPlayerOrder: Function, flushPlaced: Function}}
 * @throws {TypeError} without a bot object
 */
export function installAreaGuard(bot, options = {}) {
    if (bot === null || typeof bot !== 'object') {
        throw new TypeError('installAreaGuard needs a bot object');
    }
    const existing = guards.get(bot);
    if (existing) {
        return existing;
    }
    const guard = createGuard(bot, options ?? {});
    guards.set(bot, guard.api);
    const { canBreak, canPlace, canUse, explain, protectMovements, inBuilding, areaAt, refusal, isBuilt,
        placedByBot } = guard.api;
    bot.areaGuard = Object.freeze({ canBreak, canPlace, canUse, explain, protectMovements, inBuilding, areaAt,
        refusal, isBuilt, placedByBot });
    guard.install();
    return guard.api;
}

function createGuard(bot, options) {
    const storeOption = options.store ?? null;
    const resolveStore = typeof storeOption === 'function' ? storeOption : () => storeOption;
    const getDimension = typeof options.getDimension === 'function' ? options.getDimension : () => bot.game?.dimension;
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    const log = typeof options.log === 'function' ? options.log : (text) => console.warn(text);
    const readProtectBuilt = optionReader(options.protectBuiltBlocks ?? false);
    const memoryPlaced = new PlacedStore(null);
    const readPlaced = options.placed === undefined || options.placed === null
        ? () => memoryPlaced : optionReader(options.placed);
    let isPlayerOrder = null;
    let readCommand = typeof options.getCommand === 'function' ? options.getCommand : null;

    let cacheStore = null;
    let cacheRevision = NaN;
    let byDimension = new Map();
    let storeErrorReported = false;
    const permitEnds = new Map();
    const diagonalGuarded = new WeakSet(); // Movements objects whose diagonal steps are guarded
    const builtNames = new Map(); // block name -> isBuiltBlock, the exclusion function is called often

    function say(text) {
        try {
            log(text);
        } catch {
            // a broken logger must not break the guard
        }
    }

    function nowMs() {
        try {
            const value = now();
            return value instanceof Date ? value.getTime() : Number(value);
        } catch {
            return Date.now();
        }
    }

    function currentDimension() {
        try {
            return normalizeDimension(getDimension());
        } catch {
            return normalizeDimension(null);
        }
    }

    function reportStoreError(err) {
        if (!storeErrorReported) {
            storeErrorReported = true;
            say(`Area guard: the protected areas could not be read, nothing is guarded until they can: ${describeError(err)}`);
        }
    }

    function rebuild(store, revision) {
        cacheStore = store;
        cacheRevision = revision;
        byDimension = new Map();
        let areas;
        try {
            areas = store.list();
        } catch (err) {
            reportStoreError(err);
            return;
        }
        storeErrorReported = false;
        for (const area of Array.isArray(areas) ? areas : []) {
            const entry = compileArea(area);
            if (!entry) {
                continue;
            }
            if (!byDimension.has(entry.dimension)) {
                byDimension.set(entry.dimension, []);
            }
            byDimension.get(entry.dimension).push(entry);
        }
        for (const list of byDimension.values()) {
            list.sort(compareEntries);
        }
    }

    function entriesFor(dimension) {
        let store;
        try {
            store = resolveStore();
        } catch (err) {
            reportStoreError(err);
            return EMPTY;
        }
        if (!store || typeof store.list !== 'function') {
            return EMPTY;
        }
        const revision = typeof store.revision === 'number' ? store.revision : NaN;
        // NaN never equals itself: a store without a revision number is read on every call.
        if (store !== cacheStore || revision !== cacheRevision) {
            rebuild(store, revision);
        }
        return byDimension.get(dimension) ?? EMPTY;
    }

    // The area that decides for the block at x, y, z (whole numbers): the first one that contains
    // it and has no running permit. Farms come first, then mines, so where a farm and a building
    // overlap, the farm decides. null: no area protects the block.
    function decidingEntry(x, y, z) {
        const entries = entriesFor(currentDimension());
        let time = NaN;
        for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            if (x < e.x0 || x > e.x1 || y < e.y0 || y > e.y1 || z < e.z0 || z > e.z1) {
                continue;
            }
            if (permitEnds.size > 0) {
                const end = permitEnds.get(e.key);
                if (end !== undefined) {
                    if (Number.isNaN(time)) {
                        time = nowMs();
                    }
                    if (time < end) {
                        continue;
                    }
                    permitEnds.delete(e.key);
                }
            }
            return e;
        }
        return null;
    }

    function firstContaining(x, y, z) {
        for (const e of entriesFor(currentDimension())) {
            if (x >= e.x0 && x <= e.x1 && y >= e.y0 && y <= e.y1 && z >= e.z0 && z <= e.z1) {
                return e;
            }
        }
        return null;
    }

    function floored(pos) {
        return { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
    }

    function protectBuilt() {
        try {
            return readProtectBuilt() === true;
        } catch {
            return false;
        }
    }

    function placedStore() {
        try {
            const store = readPlaced();
            return store && typeof store.has === 'function' ? store : null;
        } catch {
            return null;
        }
    }

    function isPlaced(x, y, z) {
        const store = placedStore();
        return store !== null && store.has({ x, y, z }, currentDimension()) === true;
    }

    function builtName(name) {
        const n = baseName(name);
        if (n === null) {
            return false;
        }
        let built = builtNames.get(n);
        if (built === undefined) {
            built = isBuiltBlock(n);
            builtNames.set(n, built);
        }
        return built;
    }

    // A built block that the bot did not place: players build with it.
    function builtByPlayer(block, x, y, z) {
        return builtName(block.name) && !isPlaced(x, y, z);
    }

    function playerOrdered() {
        try {
            return typeof isPlayerOrder === 'function' && isPlayerOrder() === true;
        } catch {
            return false;
        }
    }

    // --- the verdicts: null when allowed, else { reason, entry, built } ---

    // forPath: the rule of the path search, which a command of the player does not open (D3).
    function breakVerdict(block, forPath) {
        const pos = block?.position;
        if (!isPosition(pos)) {
            return null;
        }
        const x = Math.floor(pos.x);
        const y = Math.floor(pos.y);
        const z = Math.floor(pos.z);
        const entry = decidingEntry(x, y, z);
        if (entry !== null) {
            if (entry.farm) {
                return CROPS.has(baseName(block.name)) ? null : { reason: 'area', entry, built: false };
            }
            if (entry.mine) {
                // D2: natural blocks yes, built blocks no; what the bot placed is not built by players
                return builtByPlayer(block, x, y, z) ? { reason: 'area', entry, built: true } : null;
            }
            return { reason: 'area', entry, built: false };
        }
        // D3: outside every area (a permit opens its area for built blocks too)
        if (!protectBuilt() || firstContaining(x, y, z) !== null || !builtByPlayer(block, x, y, z)) {
            return null;
        }
        if (!forPath && playerOrdered()) {
            return null;
        }
        return { reason: 'built_block', entry: null, built: true };
    }

    function placeVerdict(pos, itemName) {
        if (!isPosition(pos)) {
            return null;
        }
        const entry = decidingEntry(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
        if (entry === null || entry.mine || (entry.farm && PLANTABLE.has(baseName(itemName)))) {
            return null;
        }
        return { reason: 'area', entry, built: false };
    }

    function useVerdict(block, itemName, sneaking) {
        const pos = block?.position;
        if (!isPosition(pos)) {
            return null;
        }
        const entry = decidingEntry(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
        if (entry === null || entry.farm || entry.mine || !isRiskyItem(itemName)) {
            return null;
        }
        if (!sneaking && blockUseWins(block.name)) {
            return null;
        }
        return { reason: 'area', entry, built: false };
    }

    // An unexpected error in a check allows the call: the guard never breaks the bot.
    let checkErrorReported = false;
    function checkFailed(err) {
        if (!checkErrorReported) {
            checkErrorReported = true;
            say(`Area guard: a check failed and the call was allowed: ${describeError(err)}`);
        }
        return null;
    }

    function explainText(pos, entry) {
        const at = `(${pos.x}, ${pos.y}, ${pos.z})`;
        if (!entry) {
            return `The block at ${at} is not in a protected area.`;
        }
        return `The block at ${at} belongs to the protected area "${entry.name}". I do not break or place blocks there.`;
    }

    function commandText(given) {
        if (typeof given === 'string' && given.trim() !== '') {
            return given.trim();
        }
        try {
            const text = typeof readCommand === 'function' ? readCommand() : null;
            return typeof text === 'string' && text.trim() !== '' ? text.trim() : null;
        } catch {
            return null;
        }
    }

    // The text of a verdict. pos: whole numbers. name: the block, for the texts of built blocks.
    function verdictText(verdict, pos, name, command) {
        if (verdict.reason === 'built_block') {
            const how = command ? `the command ${command}` : 'the command';
            return `${name} is a block that players build with. I do not break it. The player can type ${how} in the chat to do it.`;
        }
        if (verdict.built) {
            return `${name} at (${pos.x}, ${pos.y}, ${pos.z}) is a block that players build with, in the mine `
                + `"${verdict.entry.name}". I break only natural blocks there.`;
        }
        return explainText(pos, verdict.entry);
    }

    function refuse(pos, verdict, name) {
        const position = floored(pos);
        const message = verdictText(verdict, position, baseName(name), commandText(null));
        say(message);
        return Promise.reject(new ProtectedAreaError(message,
            { area: verdict.entry?.name ?? null, position, reason: verdict.reason }));
    }

    // --- public members ---

    /**
     * False when the block is in a building, a home or a pen, in a farm and not a crop, or in a mine
     * and built by players (D2). With protect_built_blocks, also false for a built block outside every
     * area that the bot did not place, unless a command typed by the player runs (D3). A permit opens
     * its area.
     * @param {{position: {x: number, y: number, z: number}, name: string}} block
     * @returns {boolean}
     */
    function canBreak(block) {
        try {
            return breakVerdict(block, false) === null;
        } catch (err) {
            checkFailed(err);
            return true;
        }
    }

    /**
     * False in a building, a home or a pen; in a farm true only for seeds and crops to plant
     * (PLANTABLE_ITEMS); in a mine always true.
     * @param {{x: number, y: number, z: number}} pos the block that would be placed
     * @param {string|null} itemName
     * @returns {boolean}
     */
    function canPlace(pos, itemName) {
        try {
            return placeVerdict(pos, itemName) === null;
        } catch (err) {
            checkFailed(err);
            return true;
        }
    }

    /**
     * For bot.activateBlock. In a building, a home or a pen false when the item is a hoe, a shovel,
     * an axe, a bucket with content, flint_and_steel, fire_charge or bone_meal, except on a block whose
     * own use wins (doors, trapdoors and fence gates that are not iron, beds, chests, barrels, shulker
     * boxes, crafting table, furnaces) while not sneaking. In a farm and in a mine always true.
     * @param {{position: {x: number, y: number, z: number}, name: string}} block
     * @param {string|null} itemName the item in the hand
     * @param {{sneaking?: boolean}} [state]
     * @returns {boolean}
     */
    function canUse(block, itemName, state = {}) {
        try {
            return useVerdict(block, itemName, state?.sneaking === true) === null;
        } catch (err) {
            checkFailed(err);
            return true;
        }
    }

    /**
     * Opens the area for changes for some minutes (at most 60; not a finite number: 10;
     * 0 or less: closes it). The name is normalised; the area may be saved later.
     * @param {string} name
     * @param {number} minutes
     * @returns {number} the end time in ms
     */
    function permit(name, minutes) {
        const key = normalizeAreaName(name) ?? '';
        let length = typeof minutes === 'number' && Number.isFinite(minutes) ? minutes : DEFAULT_PERMIT_MINUTES;
        length = Math.min(length, MAX_PERMIT_MINUTES);
        const time = nowMs();
        if (key === '' || !(length > 0)) {
            permitEnds.delete(key);
            return time;
        }
        const end = time + length * MINUTE_MS;
        permitEnds.set(key, end);
        return end;
    }

    /**
     * Closes a permit.
     * @param {string} name
     * @returns {boolean} true if the area had a running permit
     */
    function revoke(name) {
        const key = normalizeAreaName(name) ?? '';
        const end = permitEnds.get(key);
        permitEnds.delete(key);
        return end !== undefined && nowMs() < end;
    }

    /**
     * The running permits, sorted by name.
     * @returns {{name: string, until: number}[]}
     */
    function permits() {
        const time = nowMs();
        const result = [];
        for (const [name, until] of permitEnds) {
            if (time < until) {
                result.push({ name, until });
            } else {
                permitEnds.delete(name);
            }
        }
        return result.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    }

    /**
     * The text for a refused block: `The block at (12, 64, -3) belongs to the protected area "home".
     * I do not break or place blocks there.` Outside of areas: `The block at (x, y, z) is not in a
     * protected area.`
     * @param {{x: number, y: number, z: number}} pos
     * @returns {string}
     */
    function explain(pos) {
        if (!isPosition(pos)) {
            return 'The block is not in a protected area.';
        }
        const p = floored(pos);
        let entry;
        try {
            entry = decidingEntry(p.x, p.y, p.z) ?? firstContaining(p.x, p.y, p.z);
        } catch (err) {
            entry = checkFailed(err);
        }
        return explainText(p, entry);
    }

    /**
     * True when the position lies in an area of type home, building or pen that has no running
     * permit, also where a farm overlaps it (v0.1.4.7 Amendment 2, I5; v0.1.4.8, I3). Not in a farm
     * and not in a mine. Never throws; false on an error.
     * @param {{x: number, y: number, z: number}} pos
     * @returns {boolean}
     */
    function inBuilding(pos) {
        try {
            if (!isPosition(pos)) {
                return false;
            }
            const { x, y, z } = floored(pos);
            let time = NaN;
            for (const e of entriesFor(currentDimension())) {
                if (e.farm || e.mine || x < e.x0 || x > e.x1 || y < e.y0 || y > e.y1 || z < e.z0 || z > e.z1) {
                    continue;
                }
                const end = permitEnds.get(e.key);
                if (end !== undefined) {
                    if (Number.isNaN(time)) {
                        time = nowMs();
                    }
                    if (time < end) {
                        continue;
                    }
                }
                return true;
            }
            return false;
        } catch (err) {
            checkFailed(err);
            return false;
        }
    }

    /**
     * The smallest area that holds the position, in the dimension of the bot, permits or not
     * (v0.1.4.8, I3); ties by name. Never throws.
     * @param {{x: number, y: number, z: number}} pos
     * @returns {{name: string, type: string}|null}
     */
    function areaAt(pos) {
        try {
            if (!isPosition(pos)) {
                return null;
            }
            const { x, y, z } = floored(pos);
            let best = null;
            for (const e of entriesFor(currentDimension())) {
                if (x < e.x0 || x > e.x1 || y < e.y0 || y > e.y1 || z < e.z0 || z > e.z1) {
                    continue;
                }
                if (!best || e.volume < best.volume || (e.volume === best.volume && e.name < best.name)) {
                    best = e;
                }
            }
            return best ? { name: best.name, type: best.type } : null;
        } catch (err) {
            checkFailed(err);
            return null;
        }
    }

    /**
     * Why the bot may not break, place or use at a position (v0.1.4.8, I3), or null when it may.
     * reason 'area': an area refuses it (only a permit opens it); 'built_block': with
     * protect_built_blocks, a block that players build with outside every area (a command typed by the
     * player opens it). text: for the model, for example `oak_fence is a block that players build with.
     * I do not break it. The player can type the command !collectBlocks("oak_fence", 20) in the chat to
     * do it.` Never throws.
     * @param {{x: number, y: number, z: number}|{name?: string, position: object}} target a position, or a block
     * @param {'break'|'place'|'use'} action
     * @param {{name?: string, item?: string|null, sneaking?: boolean, command?: string}} [details]
     *   name: the block (default: the name of the block, else bot.blockAt); item: the item to place or
     *   to use (default: the item in the hand); command: the command for the text (default: getCommand)
     * @returns {null|{reason: 'area'|'built_block', area: string|null, text: string}}
     */
    function refusal(target, action, details = {}) {
        try {
            const opts = details ?? {};
            const raw = isPosition(target?.position) ? target.position : target;
            if (!isPosition(raw)) {
                return null;
            }
            const p = floored(raw);
            let verdict;
            let name = null;
            if (action === 'break' || action === 'use') {
                name = baseName(opts.name ?? target?.name ?? blockNameAt(raw));
                const block = { name, position: p };
                const item = opts.item !== undefined ? opts.item : heldItemName(false);
                verdict = action === 'break' ? breakVerdict(block, false)
                    : useVerdict(block, item, opts.sneaking === undefined ? isSneaking() : opts.sneaking === true);
            } else if (action === 'place') {
                verdict = placeVerdict(p, opts.item !== undefined ? opts.item : heldItemName(false));
            } else {
                return null;
            }
            if (!verdict) {
                return null;
            }
            return { reason: verdict.reason, area: verdict.entry?.name ?? null,
                text: verdictText(verdict, p, name, commandText(opts.command)) };
        } catch (err) {
            checkFailed(err);
            return null;
        }
    }

    /**
     * isBuiltBlock of area_scan.js: true for a block that players build with.
     * @param {string|null} name
     * @returns {boolean}
     */
    function isBuilt(name) {
        return isBuiltBlock(name);
    }

    /**
     * True when the bot placed the block at the position (D4) and it was not broken since.
     * @param {{x: number, y: number, z: number}} pos
     * @returns {boolean}
     */
    function placedByBot(pos) {
        try {
            return isPosition(pos) && isPlaced(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
        } catch {
            return false;
        }
    }

    /**
     * Who ordered (I3). `isTyped()` returns true while the running command was typed by a player in
     * the chat: then a built block outside the areas may be broken (never a block of an area).
     * `getCommand()` returns the text of that command for the refusal texts. Not on bot.areaGuard.
     * @param {(() => boolean)|null} isTyped
     * @param {(() => string|null)} [getCommand]
     */
    function setPlayerOrder(isTyped, getCommand) {
        isPlayerOrder = typeof isTyped === 'function' ? isTyped : null;
        if (typeof getCommand === 'function') {
            readCommand = getCommand;
        }
    }

    /**
     * Writes the placed blocks of the current world now (D4, "at the end"). Never throws.
     * @returns {boolean} false when the write failed
     */
    function flushPlaced() {
        try {
            const store = placedStore();
            return store && typeof store.flush === 'function' ? store.flush() !== false : true;
        } catch {
            return false;
        }
    }

    const breakExclusion = (block) => {
        try {
            return breakVerdict(block, true) === null ? 0 : EXCLUDED;
        } catch (err) {
            checkFailed(err);
            return 0;
        }
    };
    const placeExclusion = (block) => (canPlace(block?.position, null) ? 0 : EXCLUDED);

    // A solid block beside a diagonal step, at the height of the feet or of the head.
    function solidBeside(movements, node, dx, dz) {
        for (const dy of [0, 1]) {
            const block = movements.getBlock(node, dx, dy, dz);
            if (block && block.physical && !block.safe) {
                return true;
            }
        }
        return false;
    }

    // The path finder allows a diagonal step past the corner of a solid block when the other side is
    // free. Its own controller cannot walk that line: the bot presses against the corner and the path
    // finder resets "stuck" for ever. On the real server this happened at the corner post of a
    // protected house and at the trunk of a tree whose lowest log the bot had just taken (v0.1.4.6).
    // The guard makes the bot walk around buildings, so with the guard such steps are left out.
    function guardDiagonals(movements) {
        const original = movements.getMoveDiagonal;
        if (typeof original !== 'function' || diagonalGuarded.has(movements)) {
            return;
        }
        diagonalGuarded.add(movements);
        movements.getMoveDiagonal = function guardedMoveDiagonal(node, dir, neighbors) {
            try {
                if (solidBeside(this, node, dir.x, 0) || solidBeside(this, node, 0, dir.z)) {
                    return undefined;
                }
            } catch {
                // the path finder decides as before
            }
            return Reflect.apply(original, this, [node, dir, neighbors]);
        };
    }

    /**
     * Adds the exclusion functions of the guard to a Movements object of mineflayer-pathfinder,
     * once: exclusionAreasBreak and exclusionAreasPlace then give 100 for a block the guard does
     * not allow and 0 otherwise. The path search may dig natural blocks in a mine, and with
     * protect_built_blocks no built block outside the areas, also while a command of the player runs.
     * Diagonal steps past the corner of a solid block are left out.
     * @param {object} movements
     * @returns {boolean} true if the object has the two lists and is protected now
     */
    function protectMovements(movements) {
        try {
            if (movements === null || typeof movements !== 'object') {
                return false;
            }
            const breakList = movements.exclusionAreasBreak;
            const placeList = movements.exclusionAreasPlace;
            if (!Array.isArray(breakList) || !Array.isArray(placeList)) {
                return false;
            }
            if (!breakList.includes(breakExclusion)) {
                breakList.push(breakExclusion);
            }
            if (!placeList.includes(placeExclusion)) {
                placeList.push(placeExclusion);
            }
            guardDiagonals(movements);
            return true;
        } catch {
            return false;
        }
    }

    // --- wrappers ---

    function heldItemName(offhand) {
        try {
            const item = offhand ? bot.inventory?.slots?.[45] : bot.heldItem;
            return item?.name ?? null;
        } catch {
            return null;
        }
    }

    function blockNameAt(pos) {
        try {
            return typeof bot.blockAt === 'function' ? bot.blockAt(pos)?.name ?? null : null;
        } catch {
            return null;
        }
    }

    function notePlaced(pos) {
        try {
            placedStore()?.add?.(floored(pos), currentDimension());
        } catch {
            // the note is a help, never a reason to fail the call
        }
    }

    function forgetPlaced(pos) {
        try {
            if (isPosition(pos)) {
                placedStore()?.remove?.(floored(pos), currentDimension());
            }
        } catch {
            // as above
        }
    }

    // Runs `after` when the call succeeded; the result and the errors of the call stay the same.
    function whenDone(result, after) {
        if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
            return result.then((value) => {
                after();
                return value;
            });
        }
        after();
        return result;
    }

    function makeDig(original) {
        return function guardedDig(...args) {
            let verdict;
            try {
                verdict = breakVerdict(args[0], false);
            } catch (err) {
                verdict = checkFailed(err);
            }
            if (verdict) {
                return refuse(args[0].position, verdict, args[0].name);
            }
            const result = Reflect.apply(original, this, args);
            return whenDone(result, () => {
                let pos = null;
                try {
                    pos = args[0]?.position;
                } catch {
                    // a block whose position cannot be read: nothing to forget
                }
                forgetPlaced(pos);
            });
        };
    }

    function makePlace(original, withOptions) {
        return function guardedPlace(...args) {
            const [reference, face, placeOptions] = args;
            let target = null;
            let verdict = null;
            try {
                const from = reference?.position;
                if (isPosition(from) && isPosition(face)) {
                    target = { x: from.x + face.x, y: from.y + face.y, z: from.z + face.z };
                    const offhand = withOptions && placeOptions?.offhand === true;
                    verdict = placeVerdict(target, heldItemName(offhand));
                }
            } catch (err) {
                verdict = checkFailed(err);
            }
            if (verdict) {
                return refuse(target, verdict, null);
            }
            const result = Reflect.apply(original, this, args);
            return target === null ? result : whenDone(result, () => notePlaced(target));
        };
    }

    function isSneaking() {
        try {
            return bot.controlState?.sneak === true;
        } catch {
            return false;
        }
    }

    function makeActivate(original) {
        return function guardedActivateBlock(...args) {
            let verdict;
            try {
                verdict = useVerdict(args[0], heldItemName(false), isSneaking());
            } catch (err) {
                verdict = checkFailed(err);
            }
            if (verdict) {
                return refuse(args[0].position, verdict, args[0].name);
            }
            return Reflect.apply(original, this, args);
        };
    }

    function makePathfinderCall(original) {
        return function guardedPathfinderCall(...args) {
            protectMovements(args[0]);
            return Reflect.apply(original, this, args);
        };
    }

    function wrap(target, key, make) {
        const original = target[key];
        if (typeof original !== 'function') {
            return false;
        }
        if (!wrappers.has(original)) {
            const wrapper = make(original);
            wrappers.add(wrapper);
            target[key] = wrapper;
        }
        return true;
    }

    // Wraps what exists; returns the names of the required functions that are missing.
    function wrapAll() {
        const missing = [];
        const need = (ok, label) => {
            if (!ok) {
                missing.push(label);
            }
        };
        need(wrap(bot, 'dig', makeDig), 'dig');
        need(wrap(bot, 'placeBlock', (fn) => makePlace(fn, false)), 'placeBlock');
        wrap(bot, '_placeBlockWithOptions', (fn) => makePlace(fn, true));
        need(wrap(bot, 'activateBlock', makeActivate), 'activateBlock');
        const pathfinder = bot.pathfinder;
        if (pathfinder !== null && typeof pathfinder === 'object') {
            need(wrap(pathfinder, 'setMovements', makePathfinderCall), 'pathfinder.setMovements');
            need(wrap(pathfinder, 'getPathTo', makePathfinderCall), 'pathfinder.getPathTo');
            wrap(pathfinder, 'getPathFromTo', makePathfinderCall);
            protectMovements(pathfinder.movements);
        } else {
            missing.push('pathfinder');
        }
        return missing;
    }

    // D4: a noted block that turns into air or a fluid is gone, whoever broke it.
    function watchBlocks() {
        if (typeof bot.on !== 'function') {
            return;
        }
        try {
            bot.on('blockUpdate', (oldBlock, newBlock) => {
                try {
                    const store = placedStore();
                    if (store === null || store.size === 0 || !GONE_NAMES.has(baseName(newBlock?.name))) {
                        return;
                    }
                    forgetPlaced(newBlock.position ?? oldBlock?.position);
                } catch {
                    // an event handler of the guard never throws into the bot
                }
            });
        } catch {
            // without the event a block leaves the store when the bot breaks it
        }
    }

    function install() {
        watchBlocks();
        const missing = wrapAll();
        if (missing.length === 0) {
            return;
        }
        const warnMissing = (names) => say(`Area guard: the bot has no ${names.join(', ')}. `
            + 'Those calls are not guarded.');
        if (typeof bot.once === 'function') {
            bot.once('spawn', () => {
                const still = wrapAll();
                if (still.length > 0) {
                    warnMissing(still);
                }
            });
        } else {
            warnMissing(missing);
        }
    }

    const api = { canBreak, canPlace, canUse, permit, revoke, permits, explain, protectMovements, inBuilding,
        areaAt, refusal, isBuilt, placedByBot, setPlayerOrder, flushPlaced };
    return { api, install };
}
