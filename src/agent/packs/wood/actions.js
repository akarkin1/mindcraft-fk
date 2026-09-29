// Small actions of the wood pack on the bot: read a block, wait with a limit, dig with a limit.
// Shared by wood.js and tools.js. Every function here never throws.
import { Vec3 } from 'vec3';
import { botPos } from '../home/context.js';
import { findItem, inventoryOf } from './inventory.js';
import { bestTool, parseTool } from './tool_logic.js';
import { DEFAULT_REACH, EYE_HEIGHT } from './tree_logic.js';

/**
 * The reach the executing code allows. The plans use 4.5 from the centre of the block the bot
 * stands in; the bot rarely stands exactly there, and the server allows 4.5 plus 1 to the
 * nearest point of the block.
 */
export const EXEC_REACH = DEFAULT_REACH + 0.3;
/** Upper limit of one dig. */
export const DIG_LIMIT_MS = 20000;
/** Upper limit of one placement. */
export const PLACE_LIMIT_MS = 3000;

const AIR_LIKE = new Set(['air', 'cave_air', 'void_air', 'short_grass', 'tall_grass', 'fern']);

/**
 * A Vec3 of a position.
 * @param {{x: number, y: number, z: number}} p
 * @returns {Vec3}
 */
export function vec(p) {
    return new Vec3(p.x, p.y, p.z);
}

/**
 * The name of the block at a position, null when it is not loaded.
 * @param {object} bot
 * @param {{x,y,z}} p
 * @returns {string|null}
 */
export function nameAt(bot, p) {
    try {
        return bot.blockAt(vec(p))?.name ?? null;
    } catch {
        return null;
    }
}

/**
 * True for air and the plants a bot walks through.
 * @param {string|null} name
 * @returns {boolean}
 */
export function isAirLike(name) {
    return name !== null && AIR_LIKE.has(name);
}

/**
 * The block the feet of the bot are in.
 * @param {object} bot
 * @returns {{x: number, y: number, z: number}|null}
 */
export function feetOf(bot) {
    const p = botPos(bot);
    return p ? { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) } : null;
}

/**
 * The eyes of the bot.
 * @param {object} bot
 * @returns {{x: number, y: number, z: number}|null}
 */
export function eyeOfBot(bot) {
    const p = botPos(bot);
    return p ? { x: p.x, y: p.y + EYE_HEIGHT, z: p.z } : null;
}

/**
 * Waits until the test is true or the time is over.
 * @param {{now: Function, wait: Function}} clock
 * @param {() => boolean} test
 * @param {number} ms
 * @returns {Promise<boolean>} the last result of the test
 */
export async function waitUntil(clock, test, ms) {
    const start = clock.now();
    while (!test()) {
        if (clock.now() - start >= ms) {
            return false;
        }
        await clock.wait(50);
    }
    return true;
}

/**
 * Runs an action of mineflayer with a time limit; ends early on bot.interrupt_code, then calls
 * onStop. Never throws.
 * @param {object} bot
 * @param {{now: Function, wait: Function}} clock
 * @param {() => Promise<*>} start
 * @param {number} ms
 * @param {Function|null} [onStop]
 * @returns {Promise<{ok: boolean, err?: Error}>}
 */
export async function settle(bot, clock, start, ms, onStop = null) {
    let result = null;
    Promise.resolve().then(start).then(() => { result = { ok: true }; }, err => { result = { ok: false, err }; });
    const t0 = clock.now();
    while (result === null) {
        if (bot.interrupt_code || clock.now() - t0 >= ms) {
            try {
                onStop?.();
            } catch {
                // nothing to stop
            }
            return { ok: false, err: new Error(bot.interrupt_code ? 'interrupted' : 'timeout') };
        }
        await clock.wait(50);
    }
    return result;
}

/**
 * Holds the best tool of the kind the bot has. Nothing when it has none. Never throws.
 * @param {object} bot
 * @param {string} kind axe, pickaxe, ...
 * @returns {Promise<boolean>} true when the bot holds such a tool
 */
export async function holdBest(bot, kind) {
    try {
        const tool = bestTool(inventoryOf(bot), kind);
        if (!tool) {
            return false;
        }
        if (bot.heldItem?.name === tool.name) {
            return true;
        }
        const item = findItem(bot, tool);
        if (item) {
            await bot.equip(item, 'hand');
            return true;
        }
    } catch {
        // by hand then
    }
    return false;
}

/**
 * Holds the best tool of the kind, else an empty hand: a tool of another kind (a pickaxe for a
 * log, spec v0.1.4.8 E3) is put away, into the inventory, or a block without wear is held instead
 * when the inventory has no room. Never throws.
 * @param {object} bot
 * @param {string} kind
 * @returns {Promise<boolean>} true when the bot holds a tool of the kind
 */
export async function holdBestOrHand(bot, kind) {
    if (await holdBest(bot, kind)) {
        return true;
    }
    try {
        if (!parseTool(bot.heldItem?.name)) {
            return false;
        }
        try {
            if (typeof bot.unequip === 'function') {
                await bot.unequip('hand');
            }
        } catch {
            // no room in the inventory: another item below
        }
        if (parseTool(bot.heldItem?.name)) {
            const other = (bot.inventory?.items?.() ?? []).find(i => i && i.count > 0 && !parseTool(i.name) && !(i.maxDurability > 0));
            if (other) {
                await bot.equip(other, 'hand');
            }
        }
    } catch {
        // the hand stays as it is
    }
    return false;
}

/**
 * Breaks one block when its name passes the test, holding the best tool of `tool` if given.
 * Never throws.
 * @param {object} bot
 * @param {{x,y,z}} pos
 * @param {{now: Function, wait: Function}} clock
 * @param {(name: string) => boolean} accept
 * @param {string|null} [tool] kind of tool to hold
 * @param {{handIfNone?: boolean}} [options] handIfNone: without a tool of the kind, no other tool
 *   is held (v0.1.4.8, E3: never a pickaxe for wood)
 * @returns {Promise<boolean>} true when the block is gone
 */
export async function digBlock(bot, pos, clock, accept, tool = null, options = {}) {
    let block = null;
    try {
        block = bot.blockAt(vec(pos));
    } catch {
        block = null;
    }
    if (!block || !accept(block.name)) {
        return false;
    }
    if (tool && options?.handIfNone === true) {
        await holdBestOrHand(bot, tool);
    } else if (tool) {
        await holdBest(bot, tool);
    }
    const res = await settle(bot, clock, () => bot.dig(block, true), DIG_LIMIT_MS, () => bot.stopDigging?.());
    const after = nameAt(bot, pos);
    return after === null ? res.ok : !accept(after);
}
