// Moving the bot for the home pack: Movements that do not dig or place near protected areas, and
// a goto with an upper time limit that ends on an interrupt and never throws.
// v0.1.4.16 (F10): every walk honours the no_enter areas it is given (applyKeepOut: the step cost of keep_out_logic.js),
// so no walk of the home, farming, wood or mining pack crosses a cave mouth the survey saved.
import pf from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { KEEP_OUT_COST, insideArea } from '../../areas/keep_out_logic.js';
import { containsPos, expandBox, isBox } from './box_math.js';
import { botPos, clockOf } from './context.js';
import { goalAvoiding, isNoStandBlock, isNoStandCell } from './stand_logic.js';
import { maySprint } from './food_logic.js'; // v0.1.4.14 (P-29): no sprint below 7 food points

/** Goals of mineflayer-pathfinder. */
export const goals = pf.goals;

const NO_STAND_IDS = new WeakMap();

// The block ids of the blocks of isNoStandBlock, per registry (gates left out: the pathfinder opens and
// closes them itself).
function noStandIds(bot) {
    const registry = bot?.registry;
    if (!registry || !Array.isArray(registry.blocksArray)) {
        return [];
    }
    let ids = NO_STAND_IDS.get(registry);
    if (!ids) {
        ids = registry.blocksArray.filter(b => typeof b?.name === 'string' && !b.name.endsWith('_fence_gate') && isNoStandBlock(b.name))
            .map(b => b.id);
        NO_STAND_IDS.set(registry, ids);
    }
    return ids;
}

/**
 * Reads a block as { name, properties } for isNoStandCell, or null. Never throws.
 * @param {object} bot
 * @returns {(x: number, y: number, z: number) => ({name: string, properties: object|null}|null)}
 */
export function blockReader(bot) {
    return (x, y, z) => {
        try {
            const b = bot.blockAt(new Vec3(x, y, z));
            if (!b || typeof b.name !== 'string') {
                return null;
            }
            const properties = typeof b.getProperties === 'function' ? b.getProperties() : (b._properties ?? null);
            return { name: b.name, properties };
        } catch {
            return null;
        }
    };
}

/**
 * The goal without the places in or on a composter, cauldron, hopper, chest, fence, wall or closed
 * gate (fix round, X1): the path search never ends a walk there. The goal as it is for a bot that
 * cannot read blocks, and a goal that is wrapped already.
 * @param {object} bot
 * @param {object} goal
 * @returns {object}
 */
export function safeGoal(bot, goal) {
    if (typeof bot?.blockAt !== 'function' || !goal || typeof goal !== 'object' || goal.inner) {
        return goal;
    }
    const get = blockReader(bot);
    return goalAvoiding(goal, node => isNoStandCell(get, node));
}

function plainDimension(value) {
    return typeof value === 'string' && value.length > 0 ? value.replace(/^minecraft:/, '') : null;
}

/**
 * The no_enter areas of `areas` (v0.1.4.16, F10) as a step cost of the path search: every cell inside one of them costs
 * KEEP_OUT_COST (100, keep_out_logic.js) more, so a walk crosses a cave mouth the survey saved or an area a rule keeps
 * the bot out of only when there is no other way. An area that holds the start of the walk (`options.from`, the bot's
 * position) is free, so the bot can walk out of it; an area of another dimension (`options.dimension`) does not count.
 * `areas` may also be a function `(pos) => area|null` (the area at a cell) for a caller without the list. Returns the
 * movements. Never throws.
 * @param {object} movements a pathfinder Movements object
 * @param {object[]|((pos: {x,y,z}) => object|null)} areas the areas (every kind; only those with flags.no_enter count)
 * @param {{from?: {x,y,z}|null, dimension?: string|null}} [options]
 * @returns {object} movements
 */
export function applyKeepOut(movements, areas, options = {}) {
    try {
        if (!movements || typeof movements !== 'object') {
            return movements;
        }
        if (!Array.isArray(movements.exclusionAreasStep)) {
            movements.exclusionAreasStep = [];
        }
        const from = options?.from ?? null;
        const keepOut = area => area?.flags?.no_enter === true && isBox(area) && !(from && insideArea(area, from));
        let cost;
        if (typeof areas === 'function') {
            cost = block => {
                try {
                    return block?.position && keepOut(areas(block.position)) ? KEEP_OUT_COST : 0;
                } catch {
                    return 0;
                }
            };
        } else {
            const dim = plainDimension(options?.dimension);
            const list = (Array.isArray(areas) ? areas : []).filter(keepOut)
                .filter(area => dim === null || plainDimension(area.dimension) === null || plainDimension(area.dimension) === dim);
            if (list.length === 0) {
                return movements;
            }
            cost = block => (block?.position && list.some(area => insideArea(area, block.position)) ? KEEP_OUT_COST : 0);
        }
        movements.exclusionAreasStep.push(cost);
    } catch (err) {
        console.warn('Home pack: could not apply the keep-out areas to the walk:', err?.message ?? err);
    }
    return movements;
}

/**
 * Movements for the home pack. By default they never dig (`canDig = false`) and never place
 * (`allow1by1towers = false`, no scaffolding blocks). With `dig: true` digging is allowed except
 * in the given areas and within 2 blocks of them, for long ways far from home and to get out of a pit.
 * Fix round (X1): a composter, cauldron, hopper, chest, fence or wall counts like a fence of the path
 * search: no ground to stand on and nothing to walk through (the pathfinder took a composter for
 * ground, and the bot fell into it).
 * v0.1.4.16 (F10): the no_enter areas among `areas` get the step cost of applyKeepOut, digging or not.
 * @param {object} bot
 * @param {{dig?: boolean, doors?: boolean, sprint?: boolean, areas?: object[]}} [options]
 *   doors: the pathfinder may open doors and gates (default true); sprint: default true
 * @returns {object} a pathfinder Movements object
 */
export function makeMovements(bot, options = {}) {
    const m = new pf.Movements(bot);
    try {
        if (m.fences && typeof m.fences.add === 'function') {
            for (const id of noStandIds(bot)) {
                m.fences.add(id);
            }
        }
    } catch (err) {
        console.warn('Home pack: could not mark the blocks to avoid:', err?.message ?? err);
    }
    m.canDig = options.dig === true;
    if (m.canDig) {
        m.digCost = 10;
        const areas = Array.isArray(options.areas) ? options.areas.map(a => expandBox(a, 2)).filter(Boolean) : [];
        if (areas.length > 0) {
            m.exclusionAreasBreak.push(block => (block?.position && areas.some(a => containsPos(a, block.position)) ? 100 : 0));
        }
    }
    if (Array.isArray(options.areas) && options.areas.length > 0) {
        applyKeepOut(m, options.areas, { from: botPos(bot), dimension: bot?.game?.dimension ?? null });
    }
    m.allow1by1towers = false;
    m.scafoldingBlocks = [];
    m.exclusionAreasPlace.push(() => 100);
    m.canOpenDoors = options.doors !== false;
    // v0.1.4.14 (P-29, the play of 2026-11-09): never a sprint below 7 food points (the game refuses it; the bot sprinted its
    // food away and starved), whatever the caller asks
    m.allowSprinting = options.sprint !== false && maySprint(bot?.food);
    return m;
}

/**
 * Stops the pathfinder and releases the controls. Never throws.
 * @param {object} bot
 */
export function stopMoving(bot) {
    try {
        bot?.pathfinder?.setGoal(null);
    } catch {
        // nothing to stop
    }
    try {
        bot?.clearControlStates?.();
    } catch {
        // nothing to release
    }
}

function classify(err) {
    const name = err?.name ?? '';
    if (name === 'NoPath' || name === 'Timeout') {
        return { ok: false, reason: 'no_path', error: err };
    }
    if (name === 'PathStopped' || name === 'GoalChanged') {
        return { ok: false, reason: 'interrupted', error: err };
    }
    return { ok: false, reason: 'error', error: err };
}

/**
 * Runs bot.pathfinder.goto(goal) with an upper time limit. Ends when bot.interrupt_code is set.
 * Fix round (X1): the walk never ends in or on a composter, cauldron, hopper, chest, fence, wall or
 * closed gate (safeGoal).
 * Note: a resolved goto does not prove the goal was reached; callers check the position.
 * @param {object} bot
 * @param {object} goal a pathfinder goal
 * @param {{movements?: object, timeoutMs?: number, clock?: object}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, error?: Error}>} reasons: no_path, interrupted, timeout, error
 */
export async function gotoGoal(bot, goal, options = {}) {
    const clock = options.clock ?? clockOf(null);
    const limit = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 30000;
    if (bot?.interrupt_code) {
        return { ok: false, reason: 'interrupted' };
    }
    let settled = null;
    try {
        if (options.movements) {
            bot.pathfinder.setMovements(options.movements);
        }
        const promise = Promise.resolve(bot.pathfinder.goto(safeGoal(bot, goal)));
        promise.then(() => {
            settled = { ok: true, reason: null };
        }, err => {
            settled = classify(err);
        });
    } catch (err) {
        return classify(err);
    }
    const start = clock.now();
    while (settled === null) {
        if (bot.interrupt_code) {
            stopMoving(bot);
            return { ok: false, reason: 'interrupted' };
        }
        if (clock.now() - start >= limit) {
            stopMoving(bot);
            return { ok: false, reason: 'timeout' };
        }
        await clock.wait(50);
    }
    return settled;
}

/**
 * True when the bot is within `range` blocks of the point (straight distance).
 * @param {object} bot
 * @param {{x,y,z}} point
 * @param {number} range
 * @returns {boolean}
 */
export function isNear(bot, point, range) {
    const p = botPos(bot);
    if (!p || !point) {
        return false;
    }
    return Math.sqrt((p.x - point.x) ** 2 + (p.y - point.y) ** 2 + (p.z - point.z) ** 2) <= range;
}

/**
 * Walks to within `range` of a block position. Tries without digging and without opening doors,
 * then with opening doors, and, with `allowDig`, with digging outside the protected areas.
 * @param {object} bot
 * @param {{x,y,z}} target block position
 * @param {number} range
 * @param {{timeoutMs?: number, clock?: object, allowDig?: boolean, allowDoors?: boolean, areas?: object[]}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null}>}
 */
export async function walkNear(bot, target, range, options = {}) {
    const center = { x: target.x + 0.5, y: target.y, z: target.z + 0.5 };
    if (isNear(bot, center, range + 0.5)) {
        return { ok: true, reason: null };
    }
    const tries = [{ dig: false, doors: false }];
    if (options.allowDoors !== false) {
        tries.push({ dig: false, doors: true });
    }
    if (options.allowDig === true) {
        tries.push({ dig: true, doors: options.allowDoors !== false, areas: options.areas ?? [] });
    }
    let last = { ok: false, reason: 'no_path' };
    for (const t of tries) {
        let movements;
        try {
            movements = makeMovements(bot, t);
        } catch (err) {
            return { ok: false, reason: 'error', error: err };
        }
        const goal = new goals.GoalNear(target.x, target.y, target.z, range);
        last = await gotoGoal(bot, goal, { movements, timeoutMs: options.timeoutMs, clock: options.clock });
        if (isNear(bot, center, range + 1)) {
            return { ok: true, reason: null };
        }
        if (last.reason === 'interrupted') {
            return last;
        }
    }
    return { ok: false, reason: last.reason === 'timeout' ? 'timeout' : 'no_path' };
}
