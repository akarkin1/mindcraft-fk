// Storing and fetching (spec v0.1.4.7 S3): the bot opens chests, trapped chests and barrels, stores
// what the keep plan says, takes items back, and updates the chest index from what it sees while a
// container is open. The decisions are in storage_logic.js; this module walks, opens and clicks.
//
// ctx: { chests, settings, log, now }. chests is the ChestIndex of the world (a temporary one in
// memory when it is missing), settings.keep_items the owner's list of items to keep.
import { Vec3 } from 'vec3';
import { botPos, clockOf, dimensionOf, logTo } from '../home/context.js';
import { walkNear } from '../home/motion.js';
import { ChestIndex } from './chest_index.js';
import { chestKey, chooseChest, cleanName, comparePositions, countIn, distanceTo, isContainerKind, isDimensionName, keepPlan, keyHalf,
    normalizeDimension, otherHalfOf, roomFor, summarizeSlots } from './storage_logic.js';
import { TEXTS, chestLine, chestListText, fetchText, itemChestsText, notFoundText, posText, storeText } from './texts.js';

/** The bot walks to within this many blocks of a container before it opens it. */
export const REACH = 3;
/** A container that has not opened after this time is given up. */
export const OPEN_TIMEOUT_MS = 5000;
/** Default range of lookIntoChests. */
export const LOOK_RANGE = 16;
/** Range of storeItems. */
export const STORE_RANGE = 32;
/** fetchItem, for an item no known chest holds, looks into chests it does not know within this range (v0.1.4.8, E1). */
export const FETCH_LOOK_RANGE = 16;
/** ... and into at most this many of them. */
export const FETCH_LOOK_LIMIT = 3;
/** lookIntoChests opens at most this many containers. */
export const LOOK_LIMIT = 12;
/** Upper limit of time of lookIntoChests and lookIntoChest. */
export const LOOK_TIMEOUT_MS = 120000;
/** Upper limit of time of storeItems. */
export const STORE_TIMEOUT_MS = 240000;
/** Upper limit of time of fetchItem. */
export const FETCH_TIMEOUT_MS = 240000;

const LATE_CLOSE_MS = 500;
const MAX_ROUNDS = 64;
const claimed = new WeakSet();

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPoint(p) {
    return isPlainObject(p) && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
}

function floored(p) {
    return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
}

function vec(p) {
    return new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
}

function indexOf(ctx) {
    const index = ctx?.chests;
    return index && typeof index.update === 'function' && typeof index.list === 'function' ? index : null;
}

function makeState(bot, ctx, options, defaultMs) {
    const clock = clockOf(ctx, options);
    const limit = isFiniteNumber(options?.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : defaultMs;
    return {
        bot,
        clock,
        index: indexOf(ctx) ?? new ChestIndex(null),
        dimension: normalizeDimension(dimensionOf(bot)),
        deadline: clock.now() + limit,
        opened: new Set(),
        failed: 0,
    };
}

function stopReason(state) {
    if (state.bot?.interrupt_code) {
        return 'interrupted';
    }
    return state.clock.now() >= state.deadline ? 'timeout' : null;
}

function finish(ctx, result) {
    logTo(ctx, result.text);
    return result;
}

// Progress for the reflex unstuck (v0.1.4.8, I1): a walk to a chest and an open are work, not being stuck.
function progress(bot) {
    try {
        bot?.modes?.noteProgress?.('chest');
    } catch {
        // the modes are optional
    }
}

function nearestFirst(me, list) {
    return [...list].sort((a, b) => distanceTo(me, a) - distanceTo(me, b) || comparePositions(a, b));
}

// ---- containers in the world -------------------------------------------------------------------

function typeOfHalf(block) {
    try {
        return block?.getProperties?.()?.type ?? null;
    } catch {
        return null;
    }
}

function propsOf(block) {
    try {
        return block?.getProperties?.() ?? {};
    } catch {
        return {};
    }
}

// The partner of a chest half, checked both ways: the block there is the same kind and points back.
// The mirrored reading is a guard in case the game connects left and right the other way round.
function partnerOf(bot, at, block) {
    const props = propsOf(block);
    for (const flip of [false, true]) {
        const guess = otherHalfOf(at, props);
        const q = guess && flip ? { x: 2 * at.x - guess.x, y: at.y, z: 2 * at.z - guess.z } : guess;
        if (!q) {
            return null;
        }
        const other = bot.blockAt(vec(q));
        if (!other || other.name !== block.name || !['left', 'right'].includes(typeOfHalf(other))) {
            continue;
        }
        const back = otherHalfOf(q, propsOf(other));
        const backQ = back && flip ? { x: 2 * q.x - back.x, y: q.y, z: 2 * q.z - back.z } : back;
        if (backQ && chestKey(backQ) === chestKey(at)) {
            return q;
        }
    }
    return null;
}

// What stands at a position: null when the block is loaded and no container, { loaded: false }
// when it is not loaded, otherwise the container with the key half and both halves.
function describeContainer(bot, pos) {
    const at = floored(pos);
    const block = bot.blockAt(vec(at));
    if (!block) {
        return { loaded: false };
    }
    if (!isContainerKind(block.name)) {
        return null;
    }
    const other = block.name === 'barrel' ? null : partnerOf(bot, at, block);
    const key = keyHalf(at, other);
    return { loaded: true, x: key.x, y: key.y, z: key.z, kind: block.name, halves: other ? [at, other] : [at] };
}

// A chest does not open with a solid block above one of its halves; a barrel always opens. Since
// v0.1.4.8 (E1, C4) this only explains an open that failed: it does not decide alone.
function isBlocked(bot, info) {
    if (info.kind === 'barrel') {
        return false;
    }
    return info.halves.some(h => {
        const above = bot.blockAt(vec({ x: h.x, y: h.y + 1, z: h.z }));
        return Boolean(above) && above.boundingBox === 'block' && above.transparent !== true;
    });
}

function scanContainers(state, range) {
    const bot = state.bot;
    const positions = bot.findBlocks({ matching: b => isContainerKind(b?.name), maxDistance: range, count: 256 }) ?? [];
    const byKey = new Map();
    for (const p of positions) {
        const info = describeContainer(bot, p);
        if (info && info.loaded && !byKey.has(chestKey(info))) {
            byKey.set(chestKey(info), info);
        }
    }
    return nearestFirst(botPos(bot), [...byKey.values()]);
}

// Chests of the index within the range that are gone, and halves of double chests that are not the
// key, are removed.
function prune(state, found, range) {
    const me = botPos(state.bot);
    const keys = new Set(found.map(chestKey));
    const halves = new Set(found.flatMap(f => f.halves.map(chestKey)));
    for (const chest of state.index.list(state.dimension)) {
        const k = chestKey(chest);
        if (keys.has(k) || distanceTo(me, chest) > range - 1) {
            continue;
        }
        const block = state.bot.blockAt(vec(chest));
        if (halves.has(k) || (block && !isContainerKind(block.name))) {
            state.index.remove(chest);
        }
    }
}

function record(state, info, window) {
    const size = window.inventoryStart;
    const { items, free_slots } = summarizeSlots(window.slots.slice(0, size));
    for (const half of info.halves) {
        if (chestKey(half) !== chestKey(info)) {
            state.index.remove(half);
        }
    }
    return state.index.update({ x: info.x, y: info.y, z: info.z, dimension: state.dimension, kind: info.kind, items, free_slots });
}

function closeQuietly(window) {
    try {
        window?.close?.();
    } catch {
        // the window is gone already
    }
}

// A window that opens after its time was up is closed, unless a later open took it.
function closeLate(window) {
    const timer = setTimeout(() => {
        if (!claimed.has(window)) {
            closeQuietly(window);
        }
    }, LATE_CLOSE_MS);
    timer?.unref?.();
}

async function openWithin(bot, block, clock, ms) {
    let settled = null;
    let late = false;
    const opening = Promise.resolve().then(() => bot.openContainer(block));
    opening.then(window => {
        if (late) {
            closeLate(window);
        } else {
            settled = { ok: true, window };
        }
    }, err => {
        if (!late) {
            settled = { ok: false, reason: 'error', error: err };
        }
    });
    const start = clock.now();
    while (settled === null) {
        if (bot.interrupt_code || clock.now() - start >= ms) {
            late = true;
            return { ok: false, reason: bot.interrupt_code ? 'interrupted' : 'timeout' };
        }
        await clock.wait(50);
    }
    if (settled.ok) {
        claimed.add(settled.window);
    }
    return settled;
}

async function walkTo(state, target) {
    const left = state.deadline - state.clock.now();
    const d = distanceTo(botPos(state.bot), target);
    const perTry = Math.max(1000, Math.min(left, 20000 + (isFiniteNumber(d) ? d * 500 : 0)));
    progress(state.bot);
    const walk = await walkNear(state.bot, target, REACH, { clock: state.clock, timeoutMs: perTry });
    progress(state.bot);
    return walk;
}

// Walks to a container, opens it, runs the work, records what it holds and closes it.
// Reasons: interrupted, timeout, unreachable (no path, did not open, blocked), gone, error.
// Since v0.1.4.8 (E1, C4) a chest counts as blocked only after its open failed.
async function withOpen(state, target, work) {
    const bot = state.bot;
    const stop = stopReason(state);
    if (stop) {
        return { ok: false, reason: stop };
    }
    const walk = await walkTo(state, target);
    if (!walk.ok) {
        return { ok: false, reason: walk.reason === 'interrupted' ? 'interrupted' : 'unreachable' };
    }
    const info = describeContainer(bot, target);
    if (info === null) {
        state.index.remove(target);
        return { ok: false, reason: 'gone' };
    }
    if (!info.loaded) {
        return { ok: false, reason: 'unreachable' };
    }
    if (chestKey(info) !== chestKey(target)) {
        state.index.remove(target);
    }
    progress(bot);
    const opened = await openWithin(bot, bot.blockAt(vec(info)), state.clock, OPEN_TIMEOUT_MS);
    progress(bot);
    if (!opened.ok) {
        const blocked = opened.reason !== 'interrupted' && isBlocked(bot, info);
        if (opened.error || blocked) {
            console.warn(`Storage pack: the container at ${posText(info)} did not open${blocked ? ', a solid block is above it' : ''}:`,
                opened.error?.message ?? opened.error ?? opened.reason);
        }
        return { ok: false, reason: opened.reason === 'interrupted' ? 'interrupted' : 'unreachable', blocked };
    }
    const key = chestKey(info);
    state.opened.add(key);
    const window = opened.window;
    let error = null;
    try {
        await work(window);
    } catch (err) {
        error = err;
        console.warn(`Storage pack: work at the container at ${posText(info)} failed:`, err?.message ?? err);
    }
    progress(bot);
    let chest = null;
    try {
        chest = record(state, info, window);
    } finally {
        closeQuietly(window);
    }
    return { ok: error === null, reason: error === null ? null : 'error', error, chest, key };
}

async function lookInto(state, targets) {
    const pending = targets.slice(0, LOOK_LIMIT);
    const chests = [];
    while (pending.length > 0 && !stopReason(state)) {
        const target = nearestFirst(botPos(state.bot), pending)[0];
        pending.splice(pending.indexOf(target), 1);
        const res = await withOpen(state, target, () => null);
        if (res.ok) {
            chests.push(res.chest);
        } else if (res.reason !== 'gone') {
            state.failed++;
        }
    }
    return chests;
}

/**
 * Opens every chest, trapped chest and barrel within range that the bot can reach, the nearest
 * first, at most 12, and updates the chest index with what it sees. Chests of the index within the
 * range that are gone are removed. Never throws; ends on bot.interrupt_code and after 2 minutes.
 * @param {object} bot
 * @param {object} ctx { chests, now, log }
 * @param {number} [range] 16
 * @param {{now?: Function, wait?: Function, timeoutMs?: number}} [options]
 * @returns {Promise<object[]>} the chests as saved in the index
 */
export async function lookIntoChests(bot, ctx = {}, range = LOOK_RANGE, options = {}) {
    try {
        const state = makeState(bot, ctx, options, LOOK_TIMEOUT_MS);
        const r = isFiniteNumber(range) && range > 0 ? range : LOOK_RANGE;
        const found = scanContainers(state, r);
        prune(state, found, r);
        return await lookInto(state, found);
    } catch (err) {
        console.warn('Storage pack: looking into the chests failed:', err?.message ?? err);
        return [];
    }
}

/**
 * Opens the container at a position (either half of a double chest) and updates the chest index.
 * For the old commands !putInChest, !takeFromChest and !viewChest. Never throws.
 * @param {object} bot
 * @param {object} ctx
 * @param {{x,y,z}} pos
 * @param {{now?: Function, wait?: Function, timeoutMs?: number}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, chest: object|null, text: string}>}
 */
export async function lookIntoChest(bot, ctx = {}, pos, options = {}) {
    if (!isPoint(pos)) {
        return { ok: false, reason: 'bad_position', chest: null, text: 'I need the position of the chest.' };
    }
    try {
        const state = makeState(bot, ctx, options, LOOK_TIMEOUT_MS);
        const res = await withOpen(state, floored(pos), () => null);
        if (res.ok) {
            return { ok: true, reason: null, chest: res.chest, text: chestLine(res.chest).slice(2) };
        }
        return { ok: false, reason: res.reason, chest: null, text: `I could not look into the chest at ${posText(pos)}.` };
    } catch (err) {
        console.warn('Storage pack: looking into a chest failed:', err?.message ?? err);
        return { ok: false, reason: 'error', chest: null, text: `I could not look into the chest at ${posText(pos)}.` };
    }
}

/**
 * Updates the chest index from a container window that is open now, without moving. For code that
 * opened the container itself. Never throws.
 * @param {object} bot
 * @param {object} ctx { chests }
 * @param {object} block the block that was opened (either half of a double chest)
 * @param {object} window the open window
 * @returns {object|null} the chest as saved, or null
 */
export function recordContainer(bot, ctx, block, window) {
    try {
        const index = indexOf(ctx);
        if (!index || !isPoint(block?.position)) {
            return null;
        }
        const info = describeContainer(bot, block.position);
        if (!info || !info.loaded) {
            return null;
        }
        return record({ index, dimension: normalizeDimension(dimensionOf(bot)) }, info, window);
    } catch (err) {
        console.warn('Storage pack: could not record the container:', err?.message ?? err);
        return null;
    }
}

// ---- storing ---------------------------------------------------------------------------------

function usesLeft(item) {
    if (!isFiniteNumber(item?.maxDurability) || item.maxDurability <= 0) {
        return null;
    }
    return item.maxDurability - (isFiniteNumber(item.durabilityUsed) ? item.durabilityUsed : 0);
}

function inventoryList(bot) {
    return bot.inventory.items().map(item => ({ name: item.name, count: item.count, slot: item.slot, uses_left: usesLeft(item) }));
}

function stackSizeOf(bot, name, window) {
    const size = bot.registry?.itemsByName?.[name]?.stackSize ?? window.slots.find(s => s?.name === name)?.stackSize;
    return isFiniteNumber(size) && size > 0 ? size : 64;
}

async function depositSlots(bot, window, name, invSlots, count) {
    const offset = window.inventoryStart - (bot.inventory?.inventoryStart ?? 9);
    let done = 0;
    for (const slot of invSlots) {
        const ws = slot + offset;
        const item = window.slots[ws];
        if (done >= count || !item || item.name !== name) {
            continue;
        }
        const n = Math.min(item.count, count - done);
        await bot.transfer({ window, itemType: item.type, metadata: null, count: n, sourceStart: ws, sourceEnd: ws + 1, destStart: 0, destEnd: window.inventoryStart });
        done += n;
    }
}

// Deposits the named items as far as they fit. `remaining` and `stored` change as the window shows.
async function depositAll(state, window, names, job) {
    const bot = state.bot;
    const size = window.inventoryStart;
    const box = () => window.slots.slice(0, size);
    for (const name of names) {
        const want = job.remaining.get(name) ?? 0;
        if (want <= 0 || bot.interrupt_code) {
            continue;
        }
        const before = countIn(box(), name);
        const n = Math.min(want, roomFor(box(), name, stackSizeOf(bot, name, window)));
        try {
            if (n > 0 && job.slots.has(name) && typeof bot.transfer === 'function') {
                await depositSlots(bot, window, name, job.slots.get(name), n);
            } else if (n > 0) {
                const item = window.slots.slice(size).find(s => s?.name === name);
                await window.deposit(item?.type ?? bot.registry?.itemsByName?.[name]?.id, null, n);
            }
        } finally {
            progress(bot);
            const moved = Math.max(0, countIn(box(), name) - before);
            if (moved > 0) {
                job.stored[name] = (job.stored[name] ?? 0) + moved;
                job.moved += moved;
            }
            if (want - moved > 0) {
                job.remaining.set(name, want - moved);
            } else {
                job.remaining.delete(name);
            }
        }
    }
}

function noteUsed(job, chest) {
    const i = job.used.findIndex(c => chestKey(c) === chestKey(chest));
    if (i >= 0) {
        job.used[i] = chest;
    } else {
        job.used.push(chest);
    }
}

async function storeLoop(state, job, opts) {
    const bot = state.bot;
    const origin = botPos(bot);
    const range = isFiniteNumber(opts.range) && opts.range > 0 ? opts.range : STORE_RANGE;
    let single = null;
    if (opts.chest !== undefined && opts.chest !== null) {
        const info = isPoint(opts.chest) ? describeContainer(bot, opts.chest) : null;
        if (info === null) {
            return 'no_chest';
        }
        single = info.loaded ? { x: info.x, y: info.y, z: info.z } : floored(opts.chest);
    } else {
        const found = scanContainers(state, range);
        prune(state, found, range);
        const known = new Set(state.index.list(state.dimension).map(chestKey));
        await lookInto(state, found.filter(f => !known.has(chestKey(f))));
    }
    const candidates = () => {
        if (single) {
            return [state.index.get(single) ?? { ...single, dimension: state.dimension, kind: 'chest', items: {}, free_slots: 1 }];
        }
        return state.index.list(state.dimension).filter(c => distanceTo(origin, c) <= range + 1);
    };
    const excluded = new Set();
    let full = false;
    let refreshed = false;
    for (let round = 0; job.remaining.size > 0 && round < MAX_ROUNDS; round++) {
        if (stopReason(state)) {
            break;
        }
        const pool = candidates().filter(c => !excluded.has(chestKey(c)));
        const me = botPos(bot);
        const targets = new Map();
        for (const name of job.remaining.keys()) {
            const chest = chooseChest(pool, me, name);
            if (chest) {
                const k = chestKey(chest);
                targets.set(k, { chest, names: [...(targets.get(k)?.names ?? []), name] });
            }
        }
        if (targets.size === 0) {
            const unseen = pool.filter(c => !state.opened.has(chestKey(c)));
            if (!refreshed && unseen.length > 0) {
                refreshed = true;
                await lookInto(state, unseen);
                continue;
            }
            full = full || pool.length > 0;
            break;
        }
        const target = nearestFirst(me, [...targets.values()].map(t => t.chest))[0];
        const names = targets.get(chestKey(target)).names;
        const before = job.moved;
        const res = await withOpen(state, target, window => depositAll(state, window, names, job));
        if (job.moved > before && res.chest) {
            noteUsed(job, res.chest);
        }
        if (res.reason === 'interrupted') {
            break;
        }
        if (!res.ok) {
            excluded.add(chestKey(target));
            if (res.reason !== 'gone') {
                state.failed++;
            }
        } else if (names.some(n => job.remaining.has(n))) {
            excluded.add(chestKey(target));
            excluded.add(res.key);
            full = true;
        }
    }
    if (job.remaining.size === 0) {
        return null;
    }
    const stop = stopReason(state);
    if (stop) {
        return stop;
    }
    if (state.failed > 0) {
        return 'unreachable';
    }
    return full ? 'full' : 'no_chest';
}

/**
 * Stores what the bot carries by the keep plan (keepPlan with `options.only`, `options.keep` and
 * the setting keep_items). The chests come from the index within 32 blocks and from a look into the
 * containers within 32 blocks that the index does not know yet. Each item goes to a chest that
 * already holds it, otherwise to the nearest with space. A chest that is full is left and the next
 * one takes the rest; when the index says all are full, they are looked into once more.
 * `options.chest` ({x, y, z}, either half of a double chest) stores into that container only,
 * `options.range` changes the 32 blocks. Never throws; ends on bot.interrupt_code and after 4 minutes.
 * @param {object} bot
 * @param {object} ctx { chests, settings, log, now }
 * @param {{only?: string|string[], keep?: object|string[], chest?: {x,y,z}, range?: number, timeoutMs?: number, now?: Function, wait?: Function}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, stored: Object<string, number>, left: Object<string, number>, chests: object[], text: string}>}
 *   reason: null, no_chest, full, unreachable, interrupted, timeout or error; `left` is what the plan
 *   wanted to store and the bot still carries; `chests` are the chests it stored into
 */
export async function storeItems(bot, ctx = {}, options = {}) {
    const opts = isPlainObject(options) ? options : {};
    const job = { remaining: new Map(), slots: new Map(), stored: {}, used: [], moved: 0 };
    try {
        const plan = keepPlan(inventoryList(bot), {
            only: opts.only, keep: opts.keep, keepItems: ctx?.settings?.keep_items, foods: bot.registry?.foodsByName,
        });
        if (plan.store.length === 0) {
            return finish(ctx, { ok: true, reason: null, stored: {}, left: {}, chests: [], text: TEXTS.nothingToStore });
        }
        for (const entry of plan.store) {
            job.remaining.set(entry.name, entry.count);
            if (entry.slots) {
                job.slots.set(entry.name, entry.slots);
            }
        }
        const state = makeState(bot, ctx, opts, STORE_TIMEOUT_MS);
        const reason = stopReason(state) ?? await storeLoop(state, job, opts);
        const left = Object.fromEntries(job.remaining);
        const text = storeText({ stored: job.stored, left, chests: job.used, reason });
        return finish(ctx, { ok: reason === null, reason, stored: job.stored, left, chests: job.used, text });
    } catch (err) {
        console.warn('Storage pack: storing failed:', err?.message ?? err);
        const text = storeText({ stored: job.stored, left: {}, chests: job.used, reason: 'error', error: err });
        return finish(ctx, { ok: false, reason: 'error', stored: job.stored, left: Object.fromEntries(job.remaining), chests: job.used, text });
    }
}

// ---- fetching --------------------------------------------------------------------------------

async function takeFrom(state, window, name, need, tally) {
    const bot = state.bot;
    const size = window.inventoryStart;
    const end = window.inventoryEnd;
    const box = () => window.slots.slice(0, size);
    const inv = () => window.slots.slice(size, end);
    const available = countIn(box(), name);
    const n = Math.min(need, available, roomFor(inv(), name, stackSizeOf(bot, name, window)));
    const before = countIn(inv(), name);
    try {
        if (n > 0) {
            const type = box().find(s => s?.name === name).type;
            if (typeof bot.transfer === 'function') {
                // window.withdraw refuses when no slot is empty, even with room on a stack.
                await bot.transfer({ window, itemType: type, metadata: null, count: n, sourceStart: 0, sourceEnd: size, destStart: size, destEnd: end });
            } else {
                await window.withdraw(type, null, n);
            }
        }
    } finally {
        progress(bot);
        tally.moved = Math.max(0, countIn(inv(), name) - before);
        tally.full = tally.moved < Math.min(need, available);
    }
}

/**
 * Takes an item from the chests of the index, the nearest first, from several when one is not
 * enough. Without a chest in the index that holds it, the answer comes from the index: it looks
 * only into the containers within 16 blocks that the index does not know, at most 3, the nearest
 * first (v0.1.4.8, E1; v0.1.4.7 opened every container within 32 blocks). `count` -1 takes all
 * there is. What the bot sees in a chest updates the index. Never throws; ends on
 * bot.interrupt_code and after 4 minutes.
 * @param {object} bot
 * @param {object} ctx { chests, log, now }
 * @param {string} name item name, `minecraft:` and case do not matter
 * @param {number} [count] 1
 * @param {{now?: Function, wait?: Function, timeoutMs?: number}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, taken: number, chests: object[], text: string}>}
 *   ok when the count was taken (with -1: something). reason: null, bad_name, not_found, no_more,
 *   inventory_full, unreachable, interrupted, timeout or error
 */
export async function fetchItem(bot, ctx = {}, name, count = 1, options = {}) {
    const item = cleanName(name);
    if (item === null) {
        return finish(ctx, { ok: false, reason: 'bad_name', taken: 0, chests: [], text: TEXTS.noItemName });
    }
    const wanted = count === -1 ? Infinity : (isFiniteNumber(count) && count >= 1 ? Math.floor(count) : 1);
    const used = [];
    let taken = 0;
    let failedAt = null;
    const done = (reason, error = null) => finish(ctx, {
        ok: reason === null, reason, taken, chests: used, text: fetchText({ name: item, taken, chests: used, reason, failedAt, error }),
    });
    try {
        const state = makeState(bot, ctx, isPlainObject(options) ? options : {}, FETCH_TIMEOUT_MS);
        const holders = () => state.index.find(item, state.dimension);
        const stop = stopReason(state);
        if (stop) {
            return done(stop);
        }
        if (holders().length === 0) {
            const found = scanContainers(state, FETCH_LOOK_RANGE);
            prune(state, found, FETCH_LOOK_RANGE);
            const known = new Set(state.index.list(state.dimension).map(chestKey));
            const unknown = found.filter(f => !known.has(chestKey(f))).slice(0, FETCH_LOOK_LIMIT);
            if (unknown.length > 0) {
                await lookInto(state, unknown);
            }
        }
        if (holders().length === 0) {
            return done('not_found');
        }
        const visited = new Set();
        let reason = null;
        let inventoryFull = false;
        while (taken < wanted) {
            reason = stopReason(state);
            const next = nearestFirst(botPos(bot), holders().filter(c => !visited.has(chestKey(c))))[0];
            if (reason || !next) {
                break;
            }
            visited.add(chestKey(next));
            const tally = { moved: 0, full: false };
            const res = await withOpen(state, next, window => takeFrom(state, window, item, wanted - taken, tally));
            taken += tally.moved;
            if (tally.moved > 0) {
                used.push(res.chest ?? next);
            }
            if (res.reason === 'interrupted') {
                reason = 'interrupted';
                break;
            }
            if (!res.ok && res.reason !== 'gone') {
                failedAt = failedAt ?? next;
            }
            if (tally.full) {
                inventoryFull = true;
                break;
            }
        }
        if (reason === null && taken < wanted) {
            if (inventoryFull) {
                reason = 'inventory_full';
            } else if (failedAt) {
                reason = 'unreachable';
            } else if (!(wanted === Infinity && taken > 0)) {
                reason = 'no_more';
            }
        }
        return done(reason);
    } catch (err) {
        console.warn('Storage pack: fetching failed:', err?.message ?? err);
        return done('error', err);
    }
}

/**
 * The text of the command !chests (spec v0.1.4.8 E1). Without an item: the chests of the index in
 * the dimension (all without one), at most 10, each with up to 10 kinds by count and its free
 * slots. With an item: `wheat: 28 in the chest at (11, 67, 53). Total 28.` or
 * `I know no chest with wheat.` The first argument is the chest index or a ctx with `chests`.
 * The call of v0.1.4.7, chestsText(ctx, dimension), still works: a dimension name in the place of
 * the item is taken as the dimension. Never throws.
 * @param {object} source the ChestIndex, or ctx { chests }
 * @param {string} [item] '' for all chests
 * @param {string} [dimension]
 * @returns {string}
 */
export function chestsText(source, item = '', dimension = undefined) {
    let name = item;
    let dim = dimension;
    if (dim === undefined && isDimensionName(item)) {
        dim = item;
        name = '';
    }
    const clean = cleanName(name);
    try {
        const index = indexOf(source) ?? indexOf({ chests: source });
        if (clean !== null) {
            return itemChestsText(clean, index ? index.find(clean, dim) : []);
        }
        return index ? chestListText(index.list(dim)) : TEXTS.noChests;
    } catch {
        return clean !== null ? notFoundText(clean) : TEXTS.noChests;
    }
}
