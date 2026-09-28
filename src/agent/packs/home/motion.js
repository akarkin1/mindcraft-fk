// Moving the bot for the home pack: Movements that do not dig or place near protected areas, and
// a goto with an upper time limit that ends on an interrupt and never throws.
import pf from 'mineflayer-pathfinder';
import { containsPos, expandBox } from './box_math.js';
import { botPos, clockOf } from './context.js';

/** Goals of mineflayer-pathfinder. */
export const goals = pf.goals;

/**
 * Movements for the home pack. By default they never dig (`canDig = false`) and never place
 * (`allow1by1towers = false`, no scaffolding blocks). With `dig: true` digging is allowed except
 * in the given areas and within 2 blocks of them, for long ways far from home and to get out of a pit.
 * @param {object} bot
 * @param {{dig?: boolean, doors?: boolean, sprint?: boolean, areas?: object[]}} [options]
 *   doors: the pathfinder may open doors and gates (default true); sprint: default true
 * @returns {object} a pathfinder Movements object
 */
export function makeMovements(bot, options = {}) {
    const m = new pf.Movements(bot);
    m.canDig = options.dig === true;
    if (m.canDig) {
        m.digCost = 10;
        const areas = Array.isArray(options.areas) ? options.areas.map(a => expandBox(a, 2)).filter(Boolean) : [];
        if (areas.length > 0) {
            m.exclusionAreasBreak.push(block => (block?.position && areas.some(a => containsPos(a, block.position)) ? 100 : 0));
        }
    }
    m.allow1by1towers = false;
    m.scafoldingBlocks = [];
    m.exclusionAreasPlace.push(() => 100);
    m.canOpenDoors = options.doors !== false;
    m.allowSprinting = options.sprint !== false;
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
        const promise = Promise.resolve(bot.pathfinder.goto(goal));
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
