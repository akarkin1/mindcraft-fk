// Guard of protected areas (spec v0.1.4.6, A4). Not pure: it wraps functions of the mineflayer
// bot that is passed in, so no code can break or place a block in a protected area:
// bot.dig, bot.placeBlock, bot._placeBlockWithOptions, bot.activateBlock, and the pathfinder
// (setMovements, getPathTo, getPathFromTo add exclusion functions to the Movements object).
// Nothing is imported from mineflayer.
import { normalizeDimension } from './area_store.js';

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
const EMPTY = Object.freeze([]);

// Every wrapper function this module made, so nothing is wrapped twice.
const wrappers = new WeakSet();
// bot -> guard
const guards = new WeakMap();

/**
 * Error of a refused dig, placeBlock or activateBlock. `message` is the text of explain().
 */
export class ProtectedAreaError extends Error {
    /**
     * @param {string} message
     * @param {{area?: string|null, position?: {x: number, y: number, z: number}|null}} [details]
     */
    constructor(message, details = {}) {
        super(message);
        // defineProperty works after the SES lockdown, where assigning a property that a frozen
        // prototype has could throw.
        Object.defineProperty(this, 'name', { value: 'ProtectedAreaError', writable: true, configurable: true });
        this.area = details?.area ?? null;
        this.position = details?.position ?? null;
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
    return {
        name: area.name,
        farm: area.type === 'farm',
        x0: Math.min(area.min.x, area.max.x),
        y0: Math.min(area.min.y, area.max.y),
        z0: Math.min(area.min.z, area.max.z),
        x1: Math.max(area.min.x, area.max.x),
        y1: Math.max(area.min.y, area.max.y),
        z1: Math.max(area.min.z, area.max.z),
        dimension: normalizeDimension(area.dimension),
    };
}

// A farm before a building, then by name: the first area that contains a block decides.
function compareEntries(a, b) {
    if (a.farm !== b.farm) {
        return a.farm ? -1 : 1;
    }
    if (a.name < b.name) {
        return -1;
    }
    return a.name > b.name ? 1 : 0;
}

function describeError(err) {
    return err?.message ?? String(err);
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
 *   log?: (text: string) => void}} [options]
 *   store: an AreaStore, or a function that returns the current one; null guards nothing.
 *   getDimension: the dimension of the bot, default `bot.game.dimension`; "minecraft:" is ignored
 *   and a missing dimension is the overworld. now: the time in ms (or a Date), default Date.now.
 *   log: receives the text of every refusal and warnings of the guard, default console.warn.
 * `bot.areaGuard` is a frozen view without `permit`, `revoke` and `permits` (Amendment 2, F2): the
 * code of `!newAction` gets the bot and must not open a protected area for itself. Only the caller
 * of installAreaGuard (the agent) gets the full guard.
 *
 * @returns {{canBreak: Function, canPlace: Function, canUse: Function, permit: Function, revoke: Function,
 *   permits: Function, explain: Function, protectMovements: Function}}
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
    const { canBreak, canPlace, canUse, explain, protectMovements } = guard.api;
    bot.areaGuard = Object.freeze({ canBreak, canPlace, canUse, explain, protectMovements });
    guard.install();
    return guard.api;
}

function createGuard(bot, options) {
    const storeOption = options.store ?? null;
    const resolveStore = typeof storeOption === 'function' ? storeOption : () => storeOption;
    const getDimension = typeof options.getDimension === 'function' ? options.getDimension : () => bot.game?.dimension;
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    const log = typeof options.log === 'function' ? options.log : (text) => console.warn(text);

    let cacheStore = null;
    let cacheRevision = NaN;
    let byDimension = new Map();
    let storeErrorReported = false;
    const permitEnds = new Map();
    const diagonalGuarded = new WeakSet(); // Movements objects whose diagonal steps are guarded

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
    // it and has no running permit. Farms come first, so where a farm and a building overlap,
    // the farm decides. null: nothing protects the block.
    function decidingEntry(x, y, z) {
        const entries = entriesFor(currentDimension());
        let time = NaN;
        for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            if (x < e.x0 || x > e.x1 || y < e.y0 || y > e.y1 || z < e.z0 || z > e.z1) {
                continue;
            }
            if (permitEnds.size > 0) {
                const end = permitEnds.get(e.name);
                if (end !== undefined) {
                    if (Number.isNaN(time)) {
                        time = nowMs();
                    }
                    if (time < end) {
                        continue;
                    }
                    permitEnds.delete(e.name);
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

    // --- the verdicts: the deciding area when refused, null when allowed ---

    function breakRefusal(block) {
        const pos = block?.position;
        if (!isPosition(pos)) {
            return null;
        }
        const entry = decidingEntry(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
        if (entry === null || (entry.farm && CROPS.has(baseName(block.name)))) {
            return null;
        }
        return entry;
    }

    function placeRefusal(pos, itemName) {
        if (!isPosition(pos)) {
            return null;
        }
        const entry = decidingEntry(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
        if (entry === null || (entry.farm && PLANTABLE.has(baseName(itemName)))) {
            return null;
        }
        return entry;
    }

    function useRefusal(block, itemName, sneaking) {
        const pos = block?.position;
        if (!isPosition(pos)) {
            return null;
        }
        const entry = decidingEntry(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
        if (entry === null || entry.farm || !isRiskyItem(itemName)) {
            return null;
        }
        if (!sneaking && blockUseWins(block.name)) {
            return null;
        }
        return entry;
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

    function refuse(pos, entry) {
        const position = floored(pos);
        const message = explainText(position, entry);
        say(message);
        return Promise.reject(new ProtectedAreaError(message, { area: entry.name, position }));
    }

    // --- public members ---

    /**
     * False when the block is in a building, or in a farm and not a crop. A permit opens its area.
     * @param {{position: {x: number, y: number, z: number}, name: string}} block
     * @returns {boolean}
     */
    function canBreak(block) {
        try {
            return breakRefusal(block) === null;
        } catch (err) {
            checkFailed(err);
            return true;
        }
    }

    /**
     * False in a building; in a farm true only for seeds and crops to plant (PLANTABLE_ITEMS).
     * @param {{x: number, y: number, z: number}} pos the block that would be placed
     * @param {string|null} itemName
     * @returns {boolean}
     */
    function canPlace(pos, itemName) {
        try {
            return placeRefusal(pos, itemName) === null;
        } catch (err) {
            checkFailed(err);
            return true;
        }
    }

    /**
     * For bot.activateBlock. In a building false when the item is a hoe, a shovel, an axe, a bucket
     * with content, flint_and_steel, fire_charge or bone_meal, except on a block whose own use wins
     * (doors, trapdoors and fence gates that are not iron, beds, chests, barrels, shulker boxes,
     * crafting table, furnaces) while not sneaking. In a farm always true.
     * @param {{position: {x: number, y: number, z: number}, name: string}} block
     * @param {string|null} itemName the item in the hand
     * @param {{sneaking?: boolean}} [state]
     * @returns {boolean}
     */
    function canUse(block, itemName, state = {}) {
        try {
            return useRefusal(block, itemName, state?.sneaking === true) === null;
        } catch (err) {
            checkFailed(err);
            return true;
        }
    }

    /**
     * Opens the area for changes for some minutes (at most 60; not a finite number: 10;
     * 0 or less: closes it). The name is trimmed; the area may be saved later.
     * @param {string} name
     * @param {number} minutes
     * @returns {number} the end time in ms
     */
    function permit(name, minutes) {
        const key = typeof name === 'string' ? name.trim() : '';
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
        const key = typeof name === 'string' ? name.trim() : '';
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

    const breakExclusion = (block) => (canBreak(block) ? 0 : EXCLUDED);
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
     * not allow and 0 otherwise. Diagonal steps past the corner of a solid block are left out.
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

    function makeDig(original) {
        return function guardedDig(...args) {
            let entry;
            try {
                entry = breakRefusal(args[0]);
            } catch (err) {
                entry = checkFailed(err);
            }
            if (entry) {
                return refuse(args[0].position, entry);
            }
            return Reflect.apply(original, this, args);
        };
    }

    function makePlace(original, withOptions) {
        return function guardedPlace(...args) {
            const [reference, face, placeOptions] = args;
            let target = null;
            let entry = null;
            try {
                const from = reference?.position;
                if (isPosition(from) && isPosition(face)) {
                    target = { x: from.x + face.x, y: from.y + face.y, z: from.z + face.z };
                    const offhand = withOptions && placeOptions?.offhand === true;
                    entry = placeRefusal(target, heldItemName(offhand));
                }
            } catch (err) {
                entry = checkFailed(err);
            }
            if (entry) {
                return refuse(target, entry);
            }
            return Reflect.apply(original, this, args);
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
            let entry;
            try {
                entry = useRefusal(args[0], heldItemName(false), isSneaking());
            } catch (err) {
                entry = checkFailed(err);
            }
            if (entry) {
                return refuse(args[0].position, entry);
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

    function install() {
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

    const api = { canBreak, canPlace, canUse, permit, revoke, permits, explain, protectMovements };
    return { api, install };
}
