// Down or up a column of ladders for the follow of a player (spec v0.1.4.9, section 13, part L, F14): the
// path search climbs a ladder but never descends one, and it stops in the cell of an open trapdoor above a
// ladder. The ladder walking of the mining pack (packs/mining/ladder.js: slideDown, climbUp, enterColumn,
// footOf) does it with control states. That module is loaded with a dynamic import() on the first pass, so
// that the library loads without the pack. It runs whatever the settings are (a correction of the path search,
// no switch; decision of the owner and the tech lead), also when the mining pack is off and agent.work_packs is null.
//
// Down: a closed trapdoor over the column is opened from above with a click without sneak (a sneaking click
// with an item in the hand uses the item, F11 of the real server), then slideDown from the cell beside the
// top on the open side. Up: enterColumn from the foot; a closed trapdoor at the top is opened from the ladder
// below it (climb until it is within 2.5 blocks of the eyes, hold by pressing forward, click without sneak),
// then climbUp. Nothing is closed: the door service closes the trapdoor behind the bot as it closes doors.
import { Vec3 } from 'vec3';
import { botPos, clockOf } from '../packs/home/context.js';
import { doorState, openDoor } from '../packs/home/doors.js';
import { entryOf, heightWay, LADDER_RULES, ladderColumnAt, ladderPlace, wallYaw } from './ladder_logic.js';

/** The numbers of a pass. */
export const PASS_RULES = Object.freeze({
    timeoutMs: 30000, // the walk to the column, and the climb to a closed trapdoor
    reach: 4.5,       // a hand reaches a trapdoor this far from the eyes
    holdReach: 2.5,   // on the way up, the bot stops this near below a closed trapdoor to open it
});

/** The reasons of a failed pass in words, for the texts. */
export const PASS_REASONS = Object.freeze({
    no_column: 'I see no ladder there',
    no_path: 'I found no way to it',
    no_foot: 'there is no place to stand at its foot',
    no_floor: 'there is no floor under it',
    blocked_door: 'the trapdoor did not open',
    stuck: 'I got stuck on it',
    timeout: 'it took too long',
    interrupted: 'I was stopped',
    no_module: 'my ladder skills could not be loaded',
    error: 'something went wrong',
});

// The module of the mining pack, by a computed name: it is loaded only when a pass runs.
const LADDER_MODULE = new URL('../packs/mining/ladder.js', import.meta.url).href;
const DIG_MODULE = new URL('../packs/mining/dig.js', import.meta.url).href;
let modules = null;

async function loadModules() {
    if (!modules) {
        modules = Promise.all([import(LADDER_MODULE), import(DIG_MODULE)])
            .then(([ladder, dig]) => ({ ...ladder, walkTo: dig.walkTo }))
            .catch((err) => {
                modules = null;
                throw err;
            });
    }
    return await modules;
}

const AIR = new Set(['air', 'cave_air', 'void_air']);

/**
 * A reader of the world for ladderColumnAt: (x, y, z) => { name, facing } or null. Never throws.
 * @param {object} bot
 * @returns {Function}
 */
export function ladderReader(bot) {
    return (x, y, z) => {
        try {
            const b = bot.blockAt(new Vec3(x, y, z));
            if (!b || typeof b.name !== 'string') {
                return null;
            }
            const props = (typeof b.getProperties === 'function' ? b.getProperties() : b._properties) ?? {};
            return { name: b.name, facing: typeof props.facing === 'string' ? props.facing : null };
        } catch {
            return null;
        }
    };
}

/**
 * The column of ladders near the feet of the bot (ladderColumnAt on the world of the bot), or null.
 * @param {object} bot
 * @param {{reach?: number, height?: number, maxHeight?: number}} [options] as ladderColumnAt
 * @returns {object|null}
 */
export function columnNear(bot, options = {}) {
    const p = botPos(bot);
    if (!p) {
        return null;
    }
    return ladderColumnAt(ladderReader(bot), { x: Math.floor(p.x), y: Math.floor(p.y + 0.01), z: Math.floor(p.z) }, options ?? {});
}

// The feet in the column, at or below the cell of the trapdoor over it (fix of W75, L3: the bot hung half way).
function inColumn(bot, column) {
    const c = feetOf(bot);
    return Boolean(c) && c.x === column.x && c.z === column.z && c.y <= column.top + 1 && c.y >= column.bottom - 1;
}

/**
 * The text of a pass: `I went down the ladder at (13, 66, 51).`, `I climbed up the ladder at (13, 66, 51).`,
 * `I could not go down the ladder at (13, 66, 51): the trapdoor did not open.`,
 * `I could not climb up the ladder at (13, 66, 51): I got stuck on it.`
 * @param {object} column
 * @param {'down'|'up'} way
 * @param {string|null} reason null for a pass that worked
 * @returns {string}
 */
export function passText(column, way, reason) {
    const at = column ? ladderPlace(column) : '(?, ?, ?)';
    if (reason === null) {
        return way === 'up' ? `I climbed up the ladder at ${at}.` : `I went down the ladder at ${at}.`;
    }
    const why = PASS_REASONS[reason] ?? PASS_REASONS.error;
    return way === 'up' ? `I could not climb up the ladder at ${at}: ${why}.` : `I could not go down the ladder at ${at}: ${why}.`;
}

function release(bot) {
    try {
        bot.clearControlStates();
    } catch {
        // nothing to release
    }
}

function feetOf(bot) {
    const p = botPos(bot);
    return p ? { x: Math.floor(p.x), y: Math.floor(p.y + 0.01), z: Math.floor(p.z) } : null;
}

function eyeDistance(bot, cell) {
    const p = botPos(bot);
    return p ? Math.hypot(cell.x + 0.5 - p.x, cell.y + 0.5 - (p.y + 1.62), cell.z + 0.5 - p.z) : Infinity;
}

function doorOptions(clock) {
    return { now: clock.now, wait: clock.wait };
}

// A click on the trapdoor without sneak.
async function openTrapdoor(bot, trap, clock) {
    try {
        bot.setControlState('sneak', false);
    } catch {
        // no controls
    }
    return await openDoor(bot, trap, doorOptions(clock));
}

// On the way up: climbs until the closed trapdoor is within reach, holds on the ladder by pressing forward
// against the wall and clicks it without sneak (as climbToOpen of the replay of the routes pack).
async function climbToOpen(bot, column, trap, clock, limitMs) {
    try {
        await bot.look(wallYaw(column.facing), 0, true);
    } catch {
        // looking is best effort
    }
    bot.setControlState('forward', true);
    const start = clock.now();
    let lastY = botPos(bot)?.y ?? 0;
    let still = clock.now();
    while (clock.now() - start < limitMs) {
        if (bot.interrupt_code) {
            release(bot);
            return 'interrupted';
        }
        const p = botPos(bot);
        if (!p || eyeDistance(bot, trap) <= PASS_RULES.holdReach) {
            break;
        }
        const c = feetOf(bot);
        const onLadder = bot.blockAt(new Vec3(c.x, c.y, c.z))?.name === 'ladder';
        bot.setControlState('jump', !onLadder && c.x === column.x && c.z === column.z && bot.entity?.onGround === true);
        if (Math.abs(p.y - lastY) > 0.05) {
            lastY = p.y;
            still = clock.now();
        } else if (clock.now() - still > 1500) {
            break;
        }
        await clock.wait(50);
    }
    bot.setControlState('jump', false);
    bot.setControlState('sneak', false);
    bot.setControlState('forward', true);
    await clock.wait(100);
    const opened = eyeDistance(bot, trap) <= PASS_RULES.reach && (await openDoor(bot, trap, doorOptions(clock)));
    release(bot);
    if (bot.interrupt_code) {
        return 'interrupted';
    }
    return opened ? null : 'blocked_door';
}

function stopReason(reason, bot) {
    if (reason === 'interrupted' || bot.interrupt_code) {
        return 'interrupted';
    }
    return PASS_REASONS[reason] ? reason : 'stuck';
}

async function passDown(bot, lad, column, clock, walkMs) {
    const leg = { kind: 'ladder', x: column.x, z: column.z, top: column.top, bottom: column.bottom, face: column.facing, entry: entryOf(column) };
    const under = bot.blockAt(new Vec3(column.x, column.bottom - 1, column.z));
    if (!under || AIR.has(under.name)) {
        return 'no_floor'; // the bot would fall past the foot of the column
    }
    // a bot in the column already slides from where it is (slideDown); the trapdoor above it is no matter
    const trap = column.trapdoor && !inColumn(bot, column) ? doorState(bot, column.trapdoor) : null;
    if (trap && trap.open === false) {
        if (eyeDistance(bot, trap) > PASS_RULES.reach) {
            const w = await lad.walkTo(bot, leg.entry, { clock, timeoutMs: walkMs });
            if (!w.ok) {
                return stopReason(w.reason === 'interrupted' ? 'interrupted' : 'no_path', bot);
            }
        }
        if (!(await openTrapdoor(bot, trap, clock))) {
            return bot.interrupt_code ? 'interrupted' : 'blocked_door';
        }
    }
    const r = await lad.slideDown(bot, leg, { clock, walkMs });
    return r.ok ? null : stopReason(r.reason, bot);
}

async function passUp(bot, lad, column, clock, walkMs) {
    const leg = { kind: 'ladder', x: column.x, z: column.z, top: column.top, bottom: column.bottom, face: column.facing, entry: entryOf(column) };
    const into = await lad.enterColumn(bot, leg, { clock, walkMs });
    if (!into.ok) {
        return stopReason(into.reason, bot);
    }
    const trap = column.trapdoor ? doorState(bot, column.trapdoor) : null;
    if (trap && trap.open === false) {
        const o = await climbToOpen(bot, column, trap, clock, walkMs);
        if (o !== null) {
            return o;
        }
    }
    const r = await lad.climbUp(bot, leg, { clock, walkMs });
    return r.ok ? null : stopReason(r.reason, bot);
}

/**
 * Down or up the column of ladders. Never throws.
 * @param {object} bot
 * @param {{x: number, z: number, top: number, bottom: number, facing: string|null, trapdoor: object|null}} column
 *   from ladderColumnAt
 * @param {'down'|'up'} way
 * @param {{clock?: {now: Function, wait: Function}, timeoutMs?: number}} [options] timeoutMs: the longest walk to
 *   the column and the longest climb to a closed trapdoor; the slide and the climb have their own limits by depth
 * @returns {Promise<{ok: boolean, reason: string|null, text: string}>} reasons: no_column, no_path, no_foot,
 *   no_floor, blocked_door, stuck, timeout, interrupted, no_module, error
 */
export async function passLadder(bot, column, way, { clock = null, timeoutMs = PASS_RULES.timeoutMs } = {}) {
    const done = (reason) => ({ ok: reason === null, reason, text: passText(column, way, reason) });
    try {
        const valid = column && typeof column === 'object' && [column.x, column.z, column.top, column.bottom].every(Number.isFinite);
        if (!valid || (way !== 'down' && way !== 'up')) {
            return done('no_column');
        }
        const facing = typeof column.facing === 'string' ? column.facing : null;
        if (!facing) {
            return done('no_path');
        }
        const c = clock && typeof clock.now === 'function' && typeof clock.wait === 'function' ? clock : clockOf(null);
        const walkMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : PASS_RULES.timeoutMs;
        let lad;
        try {
            lad = await loadModules();
        } catch {
            return done('no_module');
        }
        if (bot.interrupt_code) {
            return done('interrupted');
        }
        release(bot); // the controls of the path search, which may hold the bot on a ladder
        const reason = way === 'down' ? await passDown(bot, lad, column, c, walkMs) : await passUp(bot, lad, column, c, walkMs);
        release(bot);
        return done(reason);
    } catch {
        release(bot);
        return done(bot?.interrupt_code ? 'interrupted' : 'error');
    }
}

/** The numbers of the ladder step of goToPosition, goToPlayer and followPlayer (fixes of W75 and L4). */
export const STEP_RULES = Object.freeze({
    reach: LADDER_RULES.followReach, // a column within this many blocks horizontally
    height: LADDER_RULES.reach,      // and with its top or bottom this near vertically (or the bot in or beside it)
    gap: 2,                          // the target is this many blocks above or below the feet or more
    perMinute: 3,                    // passes of one call in a minute
    windowMs: 60000,
});

function pointText(p) {
    return `(${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)})`;
}

/**
 * The column of ladders near the bot that leads towards the height of the target, and the way on it: down only to
 * a point below its top ladder, up only to a point 2 or more above its bottom (a pit 2 blocks deep beside the
 * ladder is no reason to slide 20 blocks). Null without such a column. Never throws.
 * @param {object} bot
 * @param {{x: number, y: number, z: number}} target
 * @param {{reach?: number, height?: number}} [options] as ladderStepTowards
 * @returns {{column: object, way: 'down'|'up'}|null}
 */
export function ladderWayTowards(bot, target, options = {}) {
    try {
        const p = botPos(bot);
        if (!p || !target || ![target.x, target.y, target.z].every(Number.isFinite)) {
            return null;
        }
        const column = columnNear(bot, { reach: options.reach ?? STEP_RULES.reach, height: options.height ?? STEP_RULES.height });
        if (!column) {
            return null;
        }
        const way = heightWay(column, p, target);
        if ((way === 'down' && target.y >= column.top) || (way === 'up' && target.y < column.bottom + STEP_RULES.gap)) {
            return null;
        }
        return way ? { column, way } : null;
    } catch {
        return null;
    }
}

/**
 * The ladder step towards a target (fixes of W75 and L4): the column within 6 blocks, when the target is 2 or
 * more blocks below the feet and below the top ladder, or 2 or more above the feet and 2 or more above the bottom: the log line
 * `I go down the ladder at (2, 60, -2) to (12, 41, 46).` (or `after MartyByrde2.` with `after`), the pass with
 * the trapdoor opened, and the progress for the mode unstuck. At most 3 passes a minute per `passes` (the
 * times, kept by the caller for one call of a skill). The text of a failed pass is not logged here. Never throws.
 * @param {object} bot
 * @param {{x: number, y: number, z: number}} target
 * @param {{after?: string|null, log?: Function|null, passes?: number[]|null, reach?: number, height?: number,
 *   clock?: object, timeoutMs?: number, now?: Function, onPass?: Function}} [options] onPass: called when a pass
 *   begins (followPlayer stops its path search there)
 * @returns {Promise<{tried: boolean, ok: boolean, reason: string|null, text: string, way: string|null}>}
 *   tried false: no pass was made (reason no_column, no_way or limit)
 */
export async function ladderStepTowards(bot, target, options = {}) {
    const none = (reason) => ({ tried: false, ok: false, reason, text: '', way: null });
    try {
        const now = typeof options.now === 'function' ? options.now : Date.now;
        const passes = Array.isArray(options.passes) ? options.passes : null;
        if (passes) {
            while (passes.length > 0 && now() - passes[0] >= STEP_RULES.windowMs) {
                passes.shift();
            }
            if (passes.length >= STEP_RULES.perMinute) {
                return none('limit');
            }
        }
        const p = botPos(bot);
        if (!p || !target || ![target.x, target.y, target.z].every(Number.isFinite)) {
            return none('no_column');
        }
        const column = columnNear(bot, { reach: options.reach ?? STEP_RULES.reach, height: options.height ?? STEP_RULES.height });
        if (!column) {
            return none('no_column');
        }
        // the ladder leads towards the height of the target (ladderWayTowards)
        const way = ladderWayTowards(bot, target, options)?.way ?? null;
        if (!way) {
            return none('no_way');
        }
        passes?.push(now());
        try {
            options.onPass?.(column, way);
        } catch {
            // the hook is best effort
        }
        const place = ladderPlace(column);
        const whom = typeof options.after === 'string' && options.after !== '' ? `after ${options.after}` : `to ${pointText(target)}`;
        const line = way === 'down' ? `I go down the ladder at ${place} ${whom}.` : `I climb up the ladder at ${place} ${whom}.`;
        try {
            options.log?.(line);
        } catch {
            // the log is best effort
        }
        const pass = await passLadder(bot, column, way, { clock: options.clock ?? null, timeoutMs: options.timeoutMs ?? PASS_RULES.timeoutMs });
        try {
            bot.modes?.noteProgress?.('ladder');
        } catch {
            // modes are optional
        }
        return { tried: true, ok: pass.ok, reason: pass.reason, text: pass.text, way };
    } catch {
        return none('no_column');
    }
}
