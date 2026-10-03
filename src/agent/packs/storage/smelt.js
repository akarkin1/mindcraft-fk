// Smelting (spec v0.1.4.12, 4.2): the bot takes a furnace it may use, or places one from its inventory in
// a saved room, puts in the item and the fuel it needs, reads the furnace every 2 s and takes what is done.
// The decisions are in smelt_logic.js; this module walks, opens and clicks.
//
// ctx: { areas, settings, log, now, skills } of the pack context. The area guard is bot.areaGuard
// (canUse, canPlace), as the mining pack reads it; without it every furnace and cell is allowed.
// A furnace is placed through ctx.skills.placeBlock; without it the bot places none.
import { Vec3 } from 'vec3';
import { botPos, clockOf, dimensionOf, listAreas, logTo } from '../home/context.js';
import { walkNear } from '../home/motion.js';
import { cleanName } from './storage_logic.js';
import { BATCH_MAX, FURNACE_FAR_RANGE, FURNACE_RANGE, PLACE_RANGE, POLL_MS, batchesOf, chooseFuel, chooseFurnaceSpot, fuelPer, productOf,
    timeLimitMs, usableFurnaces, walkLimitMs } from './smelt_logic.js';
import { TEXTS, posText } from './texts.js';

/** The bot walks to within this many blocks of a furnace before it opens it. */
export const SMELT_REACH = 3;
/** A furnace that has not opened after this time is given up. */
export const SMELT_OPEN_TIMEOUT_MS = 5000;
/** A furnace whose input and output did not change for this long has stopped (one item takes 10 s). */
export const STALL_MS = 14000;

const AIR = new Set(['air', 'cave_air', 'void_air']);

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function vec(p) {
    return new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
}

function progress(bot) {
    try {
        bot?.modes?.noteProgress?.('furnace');
    } catch {
        // the modes are optional
    }
}

function counts(bot) {
    const out = {};
    try {
        for (const item of bot.inventory.items()) {
            if (item && typeof item.name === 'string' && isFiniteNumber(item.count)) {
                out[item.name] = (out[item.name] ?? 0) + item.count;
            }
        }
    } catch {
        // an inventory that cannot be read is empty
    }
    return out;
}

function countOf(bot, name) {
    return counts(bot)[name] ?? 0;
}

function typeOf(bot, name) {
    const id = bot.registry?.itemsByName?.[name]?.id;
    if (isFiniteNumber(id)) {
        return id;
    }
    return bot.inventory?.items?.().find(i => i?.name === name)?.type ?? null;
}

function blockAt(bot, p) {
    try {
        return bot.blockAt(vec(p)) ?? null;
    } catch {
        return null;
    }
}

function slotOf(furnace, which) {
    try {
        const item = furnace[which]?.();
        return item && typeof item.name === 'string' && isFiniteNumber(item.count) && item.count > 0 ? item : null;
    } catch {
        return null;
    }
}

function closeQuietly(bot, window) {
    try {
        if (typeof window?.close === 'function') {
            window.close();
        } else {
            bot.closeWindow?.(window);
        }
    } catch {
        // the window is gone already
    }
}

// The furnaces within `range` blocks (among the loaded blocks) that the area guard lets the bot use, the nearest first.
function furnacesNear(bot, range = FURNACE_RANGE) {
    let found = [];
    try {
        found = bot.findBlocks({ matching: b => b?.name === 'furnace', maxDistance: range, count: 16 }) ?? [];
    } catch {
        found = [];
    }
    const guard = bot.areaGuard;
    const held = bot.heldItem?.name ?? null;
    const canUse = guard && typeof guard.canUse === 'function'
        ? (f) => {
            const block = blockAt(bot, f);
            return Boolean(block) && guard.canUse(block, held) !== false;
        }
        : null;
    return usableFurnaces(found.map(p => ({ x: p.x, y: p.y, z: p.z })), botPos(bot), canUse, range);
}

// The free floor cells within 8 blocks: air with a full block below, not where the bot stands.
function freeFloorCells(bot) {
    const me = botPos(bot);
    if (!me) {
        return [];
    }
    const feet = { x: Math.floor(me.x), y: Math.floor(me.y), z: Math.floor(me.z) };
    const cells = [];
    for (let dx = -PLACE_RANGE; dx <= PLACE_RANGE; dx++) {
        for (let dz = -PLACE_RANGE; dz <= PLACE_RANGE; dz++) {
            for (let dy = -3; dy <= 3; dy++) {
                const c = { x: feet.x + dx, y: feet.y + dy, z: feet.z + dz };
                if (c.x === feet.x && c.z === feet.z && (c.y === feet.y || c.y === feet.y + 1)) {
                    continue;
                }
                const here = blockAt(bot, c);
                const below = blockAt(bot, { x: c.x, y: c.y - 1, z: c.z });
                if (here && AIR.has(here.name) && below && below.boundingBox === 'block' && !AIR.has(below.name)) {
                    cells.push(c);
                }
            }
        }
    }
    return cells;
}

// A furnace from the inventory on the nearest allowed cell (spec 4.2, 1); its position, or null.
async function placeFurnace(bot, ctx) {
    if (countOf(bot, 'furnace') === 0 || typeof ctx?.skills?.placeBlock !== 'function') {
        return null;
    }
    const guard = bot.areaGuard;
    const canPlace = guard && typeof guard.canPlace === 'function' ? (c, item) => guard.canPlace(c, item) : null;
    const spot = chooseFurnaceSpot(freeFloorCells(bot), listAreas(ctx, dimensionOf(bot)), botPos(bot), canPlace);
    if (!spot) {
        return null;
    }
    try {
        await ctx.skills.placeBlock(bot, 'furnace', spot.x, spot.y, spot.z);
    } catch (err) {
        console.warn(`Storage pack: placing a furnace at ${posText(spot)} failed:`, err?.message ?? err);
    }
    return blockAt(bot, spot)?.name === 'furnace' ? spot : null;
}

async function openWithin(bot, block, clock, ms) {
    let settled = null;
    let late = false;
    const opening = Promise.resolve().then(() => bot.openFurnace(block));
    opening.then(window => {
        if (late) {
            closeQuietly(bot, window);
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
    return settled;
}

// A furnace that holds another item in its input or output is busy: the bot leaves it alone.
function busyWith(furnace, item, product) {
    const input = slotOf(furnace, 'inputItem');
    if (input && input.name !== item) {
        return input;
    }
    const output = slotOf(furnace, 'outputItem');
    return output && output.name !== product ? output : null;
}

// Walks to the furnace and opens it. { ok, window } or { ok: false, reason }: interrupted, unreachable, busy.
// The walk is the storage pack's walk to a chest: walkNear without digging (doors open), 20 s plus 0.5 s per block.
async function useFurnace(bot, at, item, product, clock) {
    const me = botPos(bot);
    const d = me ? Math.hypot(at.x + 0.5 - me.x, at.y - me.y, at.z + 0.5 - me.z) : 0;
    progress(bot);
    const walk = await walkNear(bot, at, SMELT_REACH, { clock, timeoutMs: walkLimitMs(d) });
    progress(bot);
    if (bot.interrupt_code || walk.reason === 'interrupted') {
        return { ok: false, reason: 'interrupted' };
    }
    const block = blockAt(bot, at);
    if (!walk.ok || block?.name !== 'furnace') {
        return { ok: false, reason: 'unreachable' };
    }
    const opened = await openWithin(bot, block, clock, SMELT_OPEN_TIMEOUT_MS);
    progress(bot);
    if (!opened.ok) {
        if (opened.error) {
            console.warn(`Storage pack: the furnace at ${posText(at)} did not open:`, opened.error?.message ?? opened.error);
        }
        return { ok: false, reason: opened.reason === 'interrupted' ? 'interrupted' : 'unreachable' };
    }
    const busy = busyWith(opened.window, item, product);
    if (busy) {
        closeQuietly(bot, opened.window);
        return { ok: false, reason: 'busy', busy };
    }
    return { ok: true, window: opened.window };
}

// The counts of the inventory without the items still to smelt (a log to smelt is no fuel).
function fuelInventory(bot, item, keep) {
    const c = counts(bot);
    if (c[item]) {
        c[item] = Math.max(0, c[item] - keep);
    }
    return c;
}

// Takes the output; returns how many of the product came out.
async function takeProduct(furnace, product) {
    const out = slotOf(furnace, 'outputItem');
    if (!out) {
        return 0;
    }
    await furnace.takeOutput();
    return out.name === product ? out.count : 0;
}

// Leaves the furnace empty of the bot's items: the output, the input of the item, the fuel the bot put in.
// Returns how many of the product came out. Never throws.
async function emptyFurnace(furnace, item, product, fuelName) {
    let got = 0;
    try {
        got += await takeProduct(furnace, product);
    } catch (err) {
        console.warn('Storage pack: could not take the output of the furnace:', err?.message ?? err);
    }
    try {
        if (slotOf(furnace, 'inputItem')?.name === item) {
            await furnace.takeInput();
        }
    } catch (err) {
        console.warn('Storage pack: could not take the input of the furnace:', err?.message ?? err);
    }
    let fuelBack = 0;
    try {
        const fuel = slotOf(furnace, 'fuelItem');
        if (fuelName && fuel?.name === fuelName) {
            fuelBack = fuel.count;
            await furnace.takeFuel();
        }
    } catch (err) {
        console.warn('Storage pack: could not take the fuel out of the furnace:', err?.message ?? err);
    }
    return { got, fuelBack };
}

// One batch in the open furnace. Changes `run` (smelted, fuel put). Returns a stop reason or null.
async function runBatch(bot, furnace, run, batch) {
    const { item, product, clock } = run;
    const slotFuel = slotOf(furnace, 'fuelItem');
    const credit = slotFuel ? Math.floor(slotFuel.count * fuelPer(slotFuel.name)) : 0;
    const need = Math.max(0, batch - credit);
    let fuel = null;
    let n = batch;
    if (need > 0) {
        fuel = chooseFuel(fuelInventory(bot, item, run.target - run.smelted), need);
        const covers = fuel && fuel.count > 0 ? fuel.covers : 0;
        if (covers < need) {
            if (credit + covers <= 0) {
                return 'no_fuel';
            }
            n = credit + covers;
            run.littleFuel = run.smelted + n;
            fuel = covers > 0 ? fuel : null;
        }
    }
    if (n <= 0) {
        return 'no_fuel';
    }
    let owed = fuel ? fuel.count : 0;
    const putFuel = async () => {
        const inSlot = slotOf(furnace, 'fuelItem');
        if (owed <= 0 || (inSlot && inSlot.name !== fuel.name)) {
            return;
        }
        const k = Math.min(owed, 64 - (inSlot?.count ?? 0), countOf(bot, fuel.name));
        if (k <= 0) {
            return;
        }
        await furnace.putFuel(typeOf(bot, fuel.name), null, k);
        owed -= k;
        run.fuelPut[fuel.name] = (run.fuelPut[fuel.name] ?? 0) + k;
        run.fuelName = fuel.name;
    };
    await furnace.putInput(typeOf(bot, item), null, n);
    await putFuel();
    progress(bot);
    let done = 0;
    let lastInput = slotOf(furnace, 'inputItem')?.count ?? 0;
    let lastChange = clock.now();
    for (;;) {
        await clock.wait(POLL_MS);
        progress(bot);
        if (bot.interrupt_code) {
            return 'interrupted';
        }
        await putFuel();
        const got = await takeProduct(furnace, product);
        if (got > 0) {
            done += got;
            run.smelted += got;
            lastChange = clock.now();
        }
        const input = slotOf(furnace, 'inputItem')?.count ?? 0;
        if (input !== lastInput) {
            lastInput = input;
            lastChange = clock.now();
        }
        if (done >= n || (input === 0 && !slotOf(furnace, 'outputItem'))) {
            return null;
        }
        if (clock.now() >= run.deadline) {
            return 'timeout';
        }
        if (clock.now() - lastChange >= run.stallMs) {
            return 'stalled';
        }
    }
}

function mainFuel(fuelPut, fuelBack, lastName) {
    const used = { ...fuelPut };
    if (lastName && used[lastName] !== undefined) {
        used[lastName] = Math.max(0, used[lastName] - fuelBack);
    }
    const entries = Object.entries(used).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    return entries.length > 0 ? { name: entries[0][0], count: entries[0][1] } : null;
}

/**
 * Smelts `count` of an item (spec v0.1.4.12, 4.2). The furnace: the nearest within 16 blocks that the
 * area guard lets the bot use (canUse) and that holds nothing else, then (F1) the nearest within 64 blocks
 * among the loaded blocks, walked to without digging; none: a furnace from the inventory,
 * placed on the nearest free floor cell within 8 blocks that lies in a saved area of kind storage,
 * building, home or mine (never a pen, a farm or a yard, never outside every area when areas exist;
 * without any area the nearest free cell) and that canPlace allows. The fuel: chooseFuel (coal or
 * charcoal, then planks, then logs; the fewest units). Batches of at most 64; the furnace is read every
 * 2 s and the output taken as it comes, the count is what came out. A stop (bot.interrupt_code) takes
 * what is done and leaves the furnace empty of the bot's items. Time limit: 12 s per item plus 10 s, from the
 * open furnace (the walk has its own limit: 20 s plus 0.5 s per block, at most 60 s). Without a furnace:
 * `I know no furnace within 64 blocks and carry none.`
 * Never throws.
 * @param {object} bot
 * @param {object} ctx { areas, log, now, skills }
 * @param {string} item `raw_iron`; `minecraft:` and case do not matter
 * @param {number} [count] 1
 * @param {{now?: Function, wait?: Function, stallMs?: number}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, smelted: number, fuel: {name: string, count: number}|null}>}
 *   reason: null, not_smeltable, no_item, no_fuel, no_furnace, unreachable, busy, interrupted, timeout,
 *   stalled, little_fuel, short or error; smelted: the items of the product taken out of the furnace
 */
export async function smeltItem(bot, ctx = {}, item, count = 1, options = {}) {
    const name = cleanName(item);
    const run = {
        item: name,
        product: name ? productOf(name) : null,
        clock: clockOf(ctx, options),
        target: 0,
        smelted: 0,
        fuelPut: {},
        fuelName: null,
        littleFuel: null,
        deadline: 0,
        stallMs: isFiniteNumber(options?.stallMs) && options.stallMs > 0 ? options.stallMs : STALL_MS,
    };
    const finish = (ok, reason, text, fuel = null) => {
        const result = { ok, reason, text, smelted: run.smelted, fuel };
        logTo(ctx, text);
        return result;
    };
    if (!run.product) {
        return finish(false, 'not_smeltable', TEXTS.notSmeltable(name ?? String(item ?? '')));
    }
    const wanted = isFiniteNumber(count) && count >= 1 ? Math.floor(count) : 1;
    let window = null;
    let at = null;
    try {
        const have = countOf(bot, name);
        if (have === 0) {
            return finish(false, 'no_item', TEXTS.noItem(name));
        }
        run.target = Math.min(wanted, have);
        if (!chooseFuel(fuelInventory(bot, name, run.target), run.target)) {
            return finish(false, 'no_fuel', TEXTS.noFuel);
        }
        // v0.1.4.12 (F1): a furnace within 16 blocks first, then one within 64 among the loaded blocks, then one placed
        let failed = null;
        const near = furnacesNear(bot, FURNACE_RANGE);
        const tried = new Set(near.map(f => `${f.x},${f.y},${f.z}`));
        const far = furnacesNear(bot, FURNACE_FAR_RANGE).filter(f => !tried.has(`${f.x},${f.y},${f.z}`));
        for (const f of [...near, ...far]) {
            const use = await useFurnace(bot, f, name, run.product, run.clock);
            if (use.ok) {
                window = use.window;
                at = f;
                break;
            }
            if (use.reason === 'interrupted') {
                return finish(false, 'interrupted', TEXTS.stopped(0, wanted, name));
            }
            failed = failed ?? { ...use, at: f };
        }
        if (!window) {
            const placed = await placeFurnace(bot, ctx);
            if (placed) {
                const use = await useFurnace(bot, placed, name, run.product, run.clock);
                if (use.ok) {
                    window = use.window;
                    at = placed;
                } else if (use.reason === 'interrupted') {
                    return finish(false, 'interrupted', TEXTS.stopped(0, wanted, name));
                } else {
                    failed = failed ?? { ...use, at: placed };
                }
            }
        }
        if (!window) {
            if (failed?.reason === 'busy') {
                return finish(false, 'busy', `The furnace at ${posText(failed.at)} is busy with ${failed.busy.count} ${failed.busy.name}.`);
            }
            if (failed) {
                return finish(false, 'unreachable', `I could not get to the furnace at ${posText(failed.at)}.`);
            }
            return finish(false, 'no_furnace', TEXTS.noFurnace(FURNACE_FAR_RANGE));
        }
        // the time limit counts from the open furnace: the walk to it has its own limit
        run.deadline = run.clock.now() + timeLimitMs(run.target);
        // what lay in the output before is the product of an earlier smelt: taken out, not counted
        const earlier = slotOf(window, 'outputItem');
        if (earlier) {
            await window.takeOutput();
        }
        let reason = null;
        for (const batch of batchesOf(run.target)) {
            if (bot.interrupt_code) {
                reason = 'interrupted';
                break;
            }
            const n = Math.min(batch, BATCH_MAX, countOf(bot, name));
            if (n <= 0) {
                break;
            }
            reason = await runBatch(bot, window, run, n);
            if (reason !== null || run.littleFuel !== null) {
                break;
            }
        }
        const back = await emptyFurnace(window, name, run.product, run.fuelName);
        run.smelted += back.got;
        closeQuietly(bot, window);
        window = null;
        const fuel = mainFuel(run.fuelPut, back.fuelBack, run.fuelName);
        const did = run.smelted > 0 ? TEXTS.smelted(run.smelted, name, run.product, at, fuel?.count ?? 0, fuel?.name ?? 'the fuel in it') : '';
        const join = (...parts) => parts.filter(p => p.length > 0).join(' ');
        if (reason === 'interrupted') {
            return finish(false, 'interrupted', TEXTS.stopped(run.smelted, wanted, name), fuel);
        }
        if (reason === 'timeout') {
            return finish(false, 'timeout', join(did, TEXTS.smeltTimeout(run.smelted, wanted, name)), fuel);
        }
        if (reason === 'stalled') {
            return finish(false, 'stalled', join(did, TEXTS.smeltStalled(run.smelted, wanted, name)), fuel);
        }
        if (reason === 'no_fuel') {
            return finish(false, 'no_fuel', join(did, TEXTS.noFuel), fuel);
        }
        if (run.littleFuel !== null && run.smelted < wanted) {
            return finish(false, 'little_fuel', join(did, TEXTS.smeltLittleFuel(run.littleFuel)), fuel);
        }
        if (run.smelted < wanted) {
            const short = run.target < wanted ? TEXTS.smeltOnly(run.target, name) : TEXTS.smeltStalled(run.smelted, run.target, name);
            return finish(false, 'short', join(did, short), fuel);
        }
        return finish(true, null, did, fuel);
    } catch (err) {
        console.warn('Storage pack: smelting failed:', err?.message ?? err);
        if (window) {
            const back = await emptyFurnace(window, name, run.product, run.fuelName);
            run.smelted += back.got;
            closeQuietly(bot, window);
        }
        return finish(false, 'error', TEXTS.smeltError(name, err?.message ?? String(err)), mainFuel(run.fuelPut, 0, null));
    }
}
