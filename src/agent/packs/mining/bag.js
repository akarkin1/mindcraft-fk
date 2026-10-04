// The full bag during the mining (v0.1.4.13, part Q, SPEC 4.6 Q4): the trip stores the kinds it does not keep in the
// chest of the mine (its room), else in the nearest chest of the index within 32 blocks, says so and goes on; it stops
// only when no chest has room. The rules and the texts are in bag_logic.js. Executing: it moves the bot and uses the
// storage pack through ctx.storage. Never throws.
import { botPos, logTo } from '../home/context.js';
import { blockAt, freeSlots, inventoryList } from './dig.js';
import { cellOf, roomPlan } from './mine_logic.js';
import { BAG_RULES, bagAction, bagFullText, bagKeptText, storeKinds, storedText } from './bag_logic.js';

const CONTAINERS = Object.freeze(['chest', 'trapped_chest', 'barrel']);

// A text for the player now (ctx.say), else into the log of the command.
function sayTo(ctx, text) {
    try {
        if (typeof ctx?.say === 'function') {
            ctx.say(text);
            return;
        }
    } catch {
        // the log below
    }
    logTo(ctx, text);
}

// The chests of the mine that stand: the chest of its room (a mine of the player), its chest and the chests of the
// room plan of a mine of the bot; each once.
function mineChests(bot, mine) {
    const out = [];
    const add = (p) => {
        const c = cellOf(p);
        if (c && CONTAINERS.includes(blockAt(bot, c)?.name) && !out.some(q => q.x === c.x && q.y === c.y && q.z === c.z)) {
            out.push(c);
        }
    };
    add(mine?.room?.chest);
    add(mine?.chest);
    try {
        if (cellOf(mine?.base) && mine?.direction) {
            const plan = roomPlan(cellOf(mine.base), mine.direction);
            add(plan.chest);
            add(plan.chest2);
        }
    } catch {
        // no plan
    }
    return out;
}

function addCounts(into, more) {
    for (const [k, v] of Object.entries(more ?? {})) {
        if (Number.isFinite(v) && v > 0) {
            into[k] = (into[k] ?? 0) + v;
        }
    }
    return into;
}

function anyLeft(left) {
    return Object.values(left ?? {}).some(n => Number.isFinite(n) && n > 0);
}

/**
 * The full bag of a trip (Q4). With something to store (bag_logic storeKinds: not a tool, food, torches, ladders or the
 * ore mined) it stores in the chests of the mine first, then (what is left) in the chests of the index within 32
 * blocks, nearest first (ctx.storage.storeItems with `only`); it says `I stored ... in the chest at (x, y, z) and go on.`
 * With nothing to store and a free slot the trip digs on (action `dig`). It stops (ok false, reason `inventory_full`)
 * with `My bag is full and no chest within 32 blocks has room. I stop the mining at 7 of 28 diamond.` when nothing could
 * be stored, and with bagKeptText when the bag holds only kept things and no slot is free.
 * @param {object} bot
 * @param {object} ctx the pack context (storage, say, log)
 * @param {object|null} mine the mine of the trip
 * @param {{item: string, ore: string}} row the row of the ore
 * @param {{mined?: number, wanted?: number}} [count] for the stop text
 * @returns {Promise<{ok: boolean, reason: null|'inventory_full'|'interrupted', action: 'store'|'dig'|'stop', text: string,
 *   stored: Object<string, number>}>}
 */
export async function storeFullBag(bot, ctx = {}, mine = null, row = {}, count = {}) {
    const stored = {};
    const result = (ok, reason, action, text) => ({ ok, reason, action, text, stored });
    const stop = (text) => {
        sayTo(ctx, text);
        return result(false, 'inventory_full', 'stop', text);
    };
    try {
        const kinds = storeKinds(inventoryList(bot), { ore: row?.item, foods: bot.registry?.foodsByName ?? {} });
        const action = bagAction({ freeSlots: freeSlots(bot), storable: kinds });
        if (action === 'dig') {
            return result(true, null, 'dig', '');
        }
        if (action === 'stop') {
            return stop(bagKeptText(count?.mined, count?.wanted, row?.ore ?? 'ore'));
        }
        if (typeof ctx?.storage?.storeItems !== 'function') {
            return stop(bagFullText(count?.mined, count?.wanted, row?.ore ?? 'ore'));
        }
        let names = kinds.map(k => k.name);
        let first = null;
        for (const chest of mineChests(bot, mine)) {
            if (names.length === 0 || bot.interrupt_code) {
                break;
            }
            const r = await ctx.storage.storeItems(bot, ctx, { chest, only: names });
            addCounts(stored, r?.stored);
            if (r && Object.keys(r.stored ?? {}).length > 0) {
                first ??= chest;
            }
            names = names.filter(n => (r?.left?.[n] ?? (r?.stored?.[n] ? 0 : 1)) > 0);
            if (r?.reason === 'interrupted') {
                break;
            }
        }
        if (names.length > 0 && !bot.interrupt_code) {
            const r = await ctx.storage.storeItems(bot, ctx, { only: names, range: BAG_RULES.chestRange });
            addCounts(stored, r?.stored);
            if (!first && Array.isArray(r?.chests) && r.chests.length > 0) {
                first = cellOf(r.chests[0]);
            }
            if (anyLeft(r?.left)) {
                names = names.filter(n => (r.left[n] ?? 0) > 0);
            }
        }
        if (bot.interrupt_code) {
            return result(false, 'interrupted', 'store', '');
        }
        if (Object.keys(stored).length === 0) {
            return stop(bagFullText(count?.mined, count?.wanted, row?.ore ?? 'ore'));
        }
        const text = storedText(stored, first ?? cellOf(botPos(bot)));
        sayTo(ctx, text);
        return result(true, null, 'store', text);
    } catch (err) {
        console.warn('Mining pack: storing the full bag failed:', err?.stack ?? err);
        return stop(bagFullText(count?.mined, count?.wanted, row?.ore ?? 'ore'));
    }
}
