// Helpers that read the context object `ctx` and the bot for the executing modules of the home
// pack. No imports of mineflayer; every function here never throws.
//
// ctx is { areas, places, settings, log, now, skills, world } (spec v0.1.4.6 H):
// - areas: the AreaStore of the world (list()), an array of areas, or a function returning either;
// - places: the PlaceStore (recall(name)) or the MemoryBank (recallPlaceInfo(name));
// - settings: the settings object;
// - log(text): progress text for the action output;
// - now(): milliseconds (or a Date).
// v0.1.4.8 adds, all optional: say(text) (chat and history, no call of the model), whereAmI() (I2),
// and from the pack context chests (the chest index) and storage (fetchItem of the storage pack).
import { isBox } from './box_math.js';

/**
 * Milliseconds of a number or a Date.
 * @param {number|Date} value
 * @returns {number|null}
 */
export function toMs(value) {
    if (value instanceof Date) {
        return value.getTime();
    }
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function realWait(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * The clock of an executing function: `options.now` / `options.wait` for tests, otherwise
 * `ctx.now` and setTimeout.
 * @param {object} ctx
 * @param {{now?: Function, wait?: Function}} [options]
 * @returns {{now: () => number, wait: (ms: number) => Promise<void>}}
 */
export function clockOf(ctx, options = {}) {
    const nowFn = typeof options?.now === 'function' ? options.now : (typeof ctx?.now === 'function' ? ctx.now : null);
    const waitFn = typeof options?.wait === 'function' ? options.wait : realWait;
    return {
        now() {
            if (nowFn) {
                try {
                    const t = toMs(nowFn());
                    if (t !== null) {
                        return t;
                    }
                } catch {
                    // fall through to the real clock
                }
            }
            return Date.now();
        },
        async wait(ms) {
            try {
                await waitFn(ms);
            } catch {
                // a failing wait is no reason to stop
            }
        },
    };
}

/**
 * Hands a progress text to ctx.log. Never throws.
 * @param {object} ctx
 * @param {string} text
 */
export function logTo(ctx, text) {
    try {
        if (typeof ctx?.log === 'function') {
            ctx.log(text);
        }
    } catch {
        // logging must not break an action
    }
}

/**
 * The dimension of the bot without the `minecraft:` prefix, or null.
 * @param {object} bot
 * @returns {string|null}
 */
export function dimensionOf(bot) {
    const d = bot?.game?.dimension;
    return typeof d === 'string' && d.length > 0 ? d.replace(/^minecraft:/, '') : null;
}

/**
 * The position of the bot as a plain object, or null.
 * @param {object} bot
 * @returns {{x: number, y: number, z: number}|null}
 */
export function botPos(bot) {
    const p = bot?.entity?.position;
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
        return null;
    }
    return { x: p.x, y: p.y, z: p.z };
}

/**
 * The areas of ctx.areas (an AreaStore with list(), an array, or a function that returns one of them) with a valid box, in the given
 * dimension when one is given. Never throws.
 * @param {object} ctx
 * @param {string|null} [dimension]
 * @returns {object[]}
 */
export function listAreas(ctx, dimension = null) {
    let list = [];
    try {
        let source = ctx?.areas;
        if (typeof source === 'function') {
            source = source();
        }
        if (Array.isArray(source)) {
            list = source;
        } else if (source && typeof source.list === 'function') {
            list = source.list();
        }
    } catch (err) {
        console.warn('Home pack: could not read the areas:', err?.message ?? err);
        list = [];
    }
    if (!Array.isArray(list)) {
        return [];
    }
    const dim = typeof dimension === 'string' ? dimension.replace(/^minecraft:/, '') : null;
    return list.filter(area => isBox(area)).filter(area => {
        const d = typeof area.dimension === 'string' && area.dimension.length > 0 ? area.dimension.replace(/^minecraft:/, '') : null;
        return dim === null || d === null || d === dim;
    });
}

/**
 * The saved place `home` as {x, y, z, dimension}, from a PlaceStore (recall) or a MemoryBank
 * (recallPlaceInfo, recallPlace). null when there is none.
 * @param {object} ctx
 * @returns {{x: number, y: number, z: number, dimension: string|null}|null}
 */
export function recallHome(ctx) {
    const places = ctx?.places;
    if (!places) {
        return null;
    }
    const ok = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
    try {
        for (const fn of ['recall', 'recallPlaceInfo']) {
            if (typeof places[fn] === 'function') {
                const p = places[fn]('home');
                if (ok(p)) {
                    return { x: p.x, y: p.y, z: p.z, dimension: p.dimension ?? null };
                }
            }
        }
        if (typeof places.recallPlace === 'function') {
            const arr = places.recallPlace('home');
            if (Array.isArray(arr) && arr.length >= 3 && arr.slice(0, 3).every(Number.isFinite)) {
                return { x: arr[0], y: arr[1], z: arr[2], dimension: null };
            }
        }
    } catch (err) {
        console.warn('Home pack: could not read the place "home":', err?.message ?? err);
    }
    return null;
}

/**
 * Entities of the bot within range that match the test, nearest first. The bot itself is left out.
 * @param {object} bot
 * @param {number} range
 * @param {(entity: object) => boolean} test
 * @param {{x,y,z}} [from] measure from here instead of the bot
 * @returns {object[]}
 */
export function entitiesWhere(bot, range, test, from = null) {
    const origin = from ?? botPos(bot);
    if (!origin || !bot?.entities) {
        return [];
    }
    const out = [];
    for (const entity of Object.values(bot.entities)) {
        if (!entity || entity === bot.entity || !entity.position) {
            continue;
        }
        let match = false;
        try {
            match = test(entity) === true;
        } catch {
            match = false;
        }
        if (!match) {
            continue;
        }
        const p = entity.position;
        const d = Math.sqrt((p.x - origin.x) ** 2 + (p.y - origin.y) ** 2 + (p.z - origin.z) ** 2);
        if (d <= range) {
            out.push({ entity, distance: d });
        }
    }
    return out.sort((a, b) => a.distance - b.distance).map(e => e.entity);
}

/**
 * Positions of the other players whose entities the bot sees within range.
 * @param {object} bot
 * @param {number} [range]
 * @returns {{x: number, y: number, z: number}[]}
 */
export function otherPlayerPositions(bot, range = 16) {
    const out = [];
    const me = botPos(bot);
    try {
        for (const [name, player] of Object.entries(bot?.players ?? {})) {
            const e = player?.entity;
            if (name === bot.username || !e?.position || e === bot.entity) {
                continue;
            }
            const p = e.position;
            if (me && Math.sqrt((p.x - me.x) ** 2 + (p.y - me.y) ** 2 + (p.z - me.z) ** 2) > range) {
                continue;
            }
            out.push({ x: p.x, y: p.y, z: p.z });
        }
    } catch {
        return out;
    }
    return out;
}

/**
 * Pauses a mode of the bot until it is next idle (see ModeController.pause). Never throws.
 * @param {object} bot
 * @param {string} name
 */
export function pauseMode(bot, name) {
    try {
        bot?.modes?.pause?.(name);
    } catch {
        // modes are optional
    }
}

/**
 * Tells the mode `unstuck` that the bot makes progress (v0.1.4.8, I1: bot.modes.noteProgress of
 * part A, when it exists). Never throws.
 * @param {object} bot
 * @param {string} reason
 */
export function noteProgress(bot, reason) {
    try {
        bot?.modes?.noteProgress?.(reason);
    } catch {
        // modes are optional
    }
}

/**
 * True when ctx.whereAmI() (v0.1.4.8, I2, bound by the glue) says that the bot is underground or in
 * a mine. Without ctx.whereAmI, or when it fails, the bot counts as on the surface. Never throws.
 * @param {object} ctx
 * @returns {boolean}
 */
export function isUnderground(ctx) {
    try {
        return typeof ctx?.whereAmI === 'function' && ctx.whereAmI()?.underground === true;
    } catch {
        return false;
    }
}

/**
 * Says a text without a call of the model (v0.1.4.8, C2): through ctx.say of the glue, which puts it
 * into the chat and into the history. Without ctx.say the text goes into the behaviour log of the
 * modes (the model reads it with the next message) and to the console. Never throws.
 * @param {object} bot
 * @param {object} ctx
 * @param {string} text
 * @returns {'say'|'log'} the way the text went
 */
export function sayTo(bot, ctx, text) {
    if (typeof text !== 'string' || text.length === 0) {
        return 'log';
    }
    try {
        if (typeof ctx?.say === 'function') {
            ctx.say(text);
            return 'say';
        }
    } catch (err) {
        console.warn('Home pack: could not say a text:', err?.message ?? err);
    }
    try {
        if (bot?.modes && typeof bot.modes.behavior_log === 'string') {
            bot.modes.behavior_log += text + '\n';
        }
    } catch {
        // the console line is enough
    }
    console.log(text);
    return 'log';
}
