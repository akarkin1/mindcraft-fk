// The watching pack of v0.1.4.12 (part B, SPEC 4.4): learning by watching, behind watch_and_learn. "Watch me" records
// the blocks the owner places and breaks; "continue like this" says the pattern the bot understood (a line, a fence
// with a gate, a tunnel) with the material it needs; "yes" builds or digs the rest. Nothing is placed or dug before
// the yes (rule 20). The record lives in memory until the next watching; nothing is written to disk. No call of the
// model while the bot watches. Importing this file has no side effects.
//
// Pure modules: pattern_logic, texts. Executing modules (get `ctx` = the pack context: skills, storage, areas, say, log,
// now): recorder, build. Every function returns { ok, reason, text } and never throws.
import { Vec3 } from 'vec3';
import { clockOf, logTo, sayTo } from '../home/context.js';
import { createRecord, otherPlayers, startRecorder } from './recorder.js';
import { describePattern, findPattern } from './pattern_logic.js';
import { buildPattern, carried } from './build.js';
import { TEXTS } from './texts.js';

export { DIR_WORDS, TEXTS } from './texts.js';
export { AIR_NAMES, DIRS, FREE_NAMES, GROUND_NAMES, LINE_MAX, SIZE_MAX, TUNNEL_DEFAULT, describePattern, dirOf, findPattern, isFenceName,
    isGateName, netEntries, oppositeOf, parseSize, rightOf, runOf } from './pattern_logic.js';
export { CREDIT_RANGE, RECORD_MAX, changeOf, createRecord, creditedTo, otherPlayers, startRecorder } from './recorder.js';
export { REACH, SETTLE_MS, STAND_OFF, TOO_CLOSE, WALK_MS, buildPattern, buildSteps, carried, sideOfLine, standFor } from './build.js';

/** The follow keeps the bot within this many blocks of the watched player (the follow of !followPlayer, no digging). */
export const WATCH_RANGE = 16;
/** Without a name the nearest player within this many blocks is watched. */
export const FIND_RANGE = 32;
/** The bot turns its head to the watched player this often while it stands. */
export const LOOK_MS = 1000;
/** When the follow ends by itself (no way to the player, the player out of sight) it is tried again after this. */
export const RETRY_MS = 10000;
/** `I watch you.` (PLAN 2.1), said when the watching starts. */
export const WATCHING_TEXT = 'I watch you.';

// per bot: { record, pattern, player, watching }; the last one for record() without a bot
const states = new WeakMap();
let lastState = null;

function stateOf(bot) {
    let state = states.get(bot);
    if (!state) {
        state = { record: null, pattern: null, player: null, watching: null };
        states.set(bot, state);
    }
    lastState = state;
    return state;
}

function nearestPlayer(bot, range) {
    let best = null;
    const me = bot?.entity?.position;
    for (const p of otherPlayers(bot)) {
        const d = me ? Math.hypot(p.position.x - me.x, p.position.y - me.y, p.position.z - me.z) : 0;
        if (d <= range && (best === null || d < best.d))
            best = { name: p.name, d };
    }
    return best?.name ?? null;
}

function lookAtPlayer(bot, name) {
    try {
        const entity = bot.players?.[name]?.entity;
        if (!entity?.position || bot.pathfinder?.isMoving?.())
            return;
        const p = entity.position;
        const eye = new Vec3(p.x, p.y + (entity.height ?? 1.62), p.z);
        Promise.resolve(bot.lookAt(eye)).catch(() => {});
    } catch {
        // looking is a courtesy
    }
}

function counts(state) {
    return state?.record ? state.record.counts() : { placed: 0, broken: 0 };
}

/**
 * Watches the player until the action is stopped (any order of the player: the action manager interrupts it): follows
 * the player within WATCH_RANGE blocks with the follow of !followPlayer (no digging), looks at the player, and records
 * every block the player places or breaks. A new watching empties the record. Returns `I watched you: 4 blocks placed,
 * 0 broken.` when it ends.
 * @param {object} bot
 * @param {object} ctx { skills, say?, log?, now? }
 * @param {string|null} player the name of the player; null: the nearest player
 * @param {{now?: Function, wait?: Function}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, placed?: number, broken?: number}>}
 */
export async function watchMe(bot, ctx = {}, player = null, options = {}) {
    let state = null;
    try {
        const clock = clockOf(ctx, options);
        state = stateOf(bot);
        stopWatching(bot, ctx); // one watching at a time
        const name = typeof player === 'string' && player !== '' && player !== bot.username ? player : nearestPlayer(bot, FIND_RANGE);
        if (!name)
            return { ok: false, reason: 'no_player', text: TEXTS.noPlayer };
        state.record = createRecord();
        state.pattern = null;
        state.player = name;
        const watch = { stopped: false, stopRecorder: startRecorder(bot, name, state.record, () => clock.now()), look: null };
        state.watching = watch;
        watch.look = setInterval(() => lookAtPlayer(bot, name), LOOK_MS);
        sayTo(bot, ctx, WATCHING_TEXT);
        try {
            while (!bot.interrupt_code && !watch.stopped) {
                const visible = Boolean(bot.players?.[name]?.entity);
                if (visible && typeof ctx.skills?.followPlayer === 'function') {
                    try {
                        await ctx.skills.followPlayer(bot, name, WATCH_RANGE);
                    } catch (error) {
                        logTo(ctx, `I could not follow ${name}: ${error?.message ?? error}`);
                    }
                }
                // the follow ends by itself only without a way or without the player: wait and try again
                const until = clock.now() + RETRY_MS;
                while (!bot.interrupt_code && !watch.stopped && clock.now() < until)
                    await clock.wait(250);
            }
        } finally {
            endWatch(state, watch);
        }
        const { placed, broken } = counts(state);
        return { ok: true, reason: null, text: TEXTS.watched(placed, broken), placed, broken };
    } catch (error) {
        if (state?.watching)
            endWatch(state, state.watching);
        const text = `I could not watch: ${error?.message ?? error}`;
        logTo(ctx, text);
        return { ok: false, reason: 'error', text };
    }
}

function endWatch(state, watch) {
    watch.stopped = true;
    try {
        clearInterval(watch.look);
    } catch {
        // no interval
    }
    try {
        watch.stopRecorder?.();
    } catch {
        // no listener
    }
    if (state.watching === watch)
        state.watching = null;
}

/**
 * Ends a running watching at once: the recording stops; the watching itself returns at the end of the follow, which
 * the action manager ends. Not a command: any order of the player ends the watching. The record stays.
 * @param {object} bot
 * @param {object} [ctx]
 * @returns {{ok: boolean, reason: string|null, text: string}}
 */
export function stopWatching(bot, ctx = {}) {
    try {
        const state = states.get(bot) ?? null;
        if (!state?.record)
            return { ok: false, reason: 'nothing_watched', text: TEXTS.nothingWatched };
        if (state.watching)
            endWatch(state, state.watching);
        const { placed, broken } = counts(state);
        return { ok: true, reason: null, text: TEXTS.watched(placed, broken) };
    } catch (error) {
        return { ok: false, reason: 'error', text: `I could not stop watching: ${error?.message ?? error}` };
    }
}

/**
 * The current record, read-only (a frozen copy, oldest first); [] before any watching.
 * @param {object} [bot] the bot; without it the record of the last watching
 * @returns {readonly object[]}
 */
export function record(bot = null) {
    const state = bot ? states.get(bot) : lastState;
    const entries = state?.record?.entries ?? [];
    return Object.freeze(entries.map(e => Object.freeze({ ...e, props: Object.freeze({ ...(e.props ?? {}) }) })));
}

/**
 * Finds the pattern in the record and says what the bot understood, with the material it needs and carries, ending
 * with " Say yes to build it." (or dig). Places nothing. The pattern is kept for buildWatched.
 * @param {object} bot
 * @param {object} ctx
 * @param {string} size the owner's words: "12 long", "7 by 10" or ""
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, pattern?: object}>} reason: null, nothing_watched,
 *   too_few, no_line, no_size
 */
export async function continueLike(bot, ctx = {}, size = '') {
    try {
        const state = states.get(bot) ?? null;
        if (!state?.record)
            return { ok: false, reason: 'nothing_watched', text: TEXTS.nothingWatched };
        if (state.watching)
            endWatch(state, state.watching);
        const playerPos = bot.players?.[state.player]?.entity?.position ?? null;
        const world = {
            blockAt: (x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name ?? null,
            player: playerPos ? { x: playerPos.x, y: playerPos.y, z: playerPos.z } : null,
        };
        const pattern = findPattern(state.record.entries, typeof size === 'string' ? size : '', world);
        state.pattern = pattern.kind ? pattern : null;
        const text = describePattern(pattern, (name) => carried(bot, name));
        logTo(ctx, text);
        return { ok: Boolean(pattern.kind), reason: pattern.kind ? null : pattern.why, text, pattern };
    } catch (error) {
        return { ok: false, reason: 'error', text: `I could not read what you did: ${error?.message ?? error}` };
    }
}

/**
 * Builds or digs the rest of the pattern of the last continueLike, after the owner said yes. Without one:
 * `I have no plan. Say "continue like this" first.`
 * @param {object} bot
 * @param {object} ctx
 * @param {object} [options] see buildPattern
 * @returns {Promise<{ok: boolean, reason: string|null, text: string}>}
 */
export async function buildWatched(bot, ctx = {}, options = {}) {
    try {
        const state = states.get(bot) ?? null;
        if (!state?.pattern)
            return { ok: false, reason: 'no_plan', text: TEXTS.nothingToBuild };
        return await buildPattern(bot, ctx, state.pattern, options);
    } catch (error) {
        return { ok: false, reason: 'error', text: `I could not build it: ${error?.message ?? error}` };
    }
}
