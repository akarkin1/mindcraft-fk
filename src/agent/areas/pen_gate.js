// The gate of a pen (v0.1.4.13, part Q, SPEC 4.6 Q8): an enclosure the scan finds as a pen with animals is protected like
// a saved pen before anyone saves it. The gate of a pen (saved, or found by the scan behind the gate) is never opened by
// the path search (the hook bot.keepGateClosed of the patched mineflayer-pathfinder), the item reflex (keepOutAreas with
// the pens of pensNear), !useOn (skills.useToolOnBlock asks penGateRefusal) or the model's code (bot.activateBlock is
// wrapped: a click that would open such a gate is refused); the bot says, once per minute,
// `That is a pen with 26 chickens; I do not open its gate. Say "open the pen" if you mean it.`
// "open the pen" (!allowChanges with the pen) permits it for some minutes, as the permit of a saved pen; the door
// service of the home pack closes the gate behind the bot. A bot that stands inside the pen may open its gate to walk out.
// A closing click is never refused. Farms are left out: the farming pack walks in through their gates.
// Executing (it reads the world of the bot); the rules and the texts are pure in keep_out_logic.js and area_scan.js.
// Nothing here throws into the bot.
import { Vec3 } from 'vec3';
import { scanPenBehindGate } from './area_scan.js';
import { countContents } from './area_sense.js';
import { PEN_RULES, insideArea, isGateName, isPenArea, mayPenText, penKey, penText, savedPenOf } from './keep_out_logic.js';

const states = new WeakMap();

function stateOf(bot) {
    let state = states.get(bot);
    if (!state) {
        state = { cache: new Map(), permits: new Map(), saidAt: null, areas: () => [], permitted: () => [], say: null, installed: false };
        states.set(bot, state);
    }
    return state;
}

function isOpenBlock(block) {
    try {
        const props = typeof block?.getProperties === 'function' ? block.getProperties() : block?._properties;
        return props?.open === true || props?.open === 'true';
    } catch {
        return false;
    }
}

function blockName(bot, x, y, z) {
    try {
        return bot.blockAt(new Vec3(x, y, z))?.name ?? null;
    } catch {
        return null;
    }
}

function feetOf(bot) {
    const p = bot?.entity?.position;
    return p && Number.isFinite(p.x) ? { x: p.x, y: p.y, z: p.z } : null;
}

function animalsIn(bot, box) {
    try {
        const animals = countContents(bot, box).animals ?? {};
        return Object.fromEntries(Object.entries(animals).filter(([, n]) => Number.isFinite(n) && n > 0));
    } catch {
        return {};
    }
}

/**
 * The unsaved pen behind a gate (Q8), from the cache of 10 s or a new scan: `{ key, gate, min, max, animals }` when the
 * scan finds fenced ground of a pen behind it with animals in it, else null. Never throws.
 * @param {object} bot
 * @param {{x: number, y: number, z: number}} gate
 * @param {number} [now]
 * @returns {{key: string, gate: object, min: object, max: object, animals: Object<string, number>}|null}
 */
export function penBehindGate(bot, gate, now = Date.now()) {
    try {
        const state = stateOf(bot);
        const key = penKey(gate);
        const cached = state.cache.get(key);
        if (cached && now - cached.at < PEN_RULES.cacheMs) {
            return cached.pen;
        }
        const scan = scanPenBehindGate((x, y, z) => blockName(bot, x, y, z), gate);
        let pen = null;
        if (scan.found) {
            const animals = animalsIn(bot, { min: scan.min, max: scan.max });
            if (Object.keys(animals).length > 0) {
                pen = { key, gate: scan.gate, min: scan.min, max: scan.max, animals };
            }
        }
        state.cache.set(key, { at: now, pen });
        if (state.cache.size > 64) {
            state.cache.delete(state.cache.keys().next().value);
        }
        return pen;
    } catch {
        return null;
    }
}

// True while a permit of the pen runs: a permit of "open the pen" for the unsaved pen, or a permit of the area guard
// (!allowChanges of a saved area) for the saved pen.
function permitted(state, pen, saved, now) {
    const until = pen ? state.permits.get(pen.key) : undefined;
    if (Number.isFinite(until) && now < until) {
        return true;
    }
    if (saved) {
        try {
            const name = String(saved.name ?? '').trim().toLowerCase().replace(/\s+/g, '_');
            return (state.permitted() ?? []).some(p => p?.name === name && (!Number.isFinite(p.until) || now < p.until));
        } catch {
            return false;
        }
    }
    return false;
}

/**
 * The gate of a pen at a block (Q8): `{ text, pen, allowed }` when the block is a closed fence gate of a pen (a saved pen
 * of the areas of installPenGuard, or an unsaved pen with animals behind it); `allowed` when a permit opens it or the bot
 * stands inside the pen (it walks out). null for no gate, an open gate, or a gate of no pen. Never throws.
 * @param {object} bot
 * @param {object} block a block of bot.blockAt (name, position, properties)
 * @param {number} [now]
 * @returns {{text: string, pen: object, allowed: boolean}|null}
 */
export function penGateOf(bot, block, now = Date.now()) {
    try {
        if (!block || !isGateName(block.name) || isOpenBlock(block)) {
            return null;
        }
        const state = stateOf(bot);
        const p = block.position;
        const gate = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
        const me = feetOf(bot);
        let saved = null;
        try {
            saved = savedPenOf(state.areas() ?? [], gate, bot.game?.dimension);
        } catch {
            saved = null;
        }
        const pen = saved ? null : penBehindGate(bot, gate, now);
        if (!saved && !pen) {
            return null;
        }
        const box = saved ?? pen;
        const allowed = Boolean(me && insideArea(box, me)) || permitted(state, pen, saved, now);
        const animals = pen?.animals ?? animalsIn(bot, saved);
        return { text: penText(animals), pen: pen ?? { key: penKey(gate), gate, min: saved.min, max: saved.max, animals, saved: saved.name }, allowed };
    } catch {
        return null;
    }
}

/**
 * The verdict for opening a block (Q8): `{ text, pen }` when the block is a closed fence gate of a pen that no permit
 * opens and that does not hold the bot; null when the click may happen (no gate, an open gate, a permit, the bot
 * inside). Never throws.
 * @param {object} bot
 * @param {object} block
 * @param {number} [now]
 * @returns {{text: string, pen: object}|null}
 */
export function penGateRefusal(bot, block, now = Date.now()) {
    const gate = penGateOf(bot, block, now);
    return gate && !gate.allowed ? { text: gate.text, pen: gate.pen } : null;
}

/** Q8: the close behind the bot of a pen gate it opened: the bot 2 blocks or more from the gate for 1 s, at most 30 s. */
export const CLOSE_BEHIND = Object.freeze({ away: 2, stableMs: 1000, everyMs: 500, limitMs: 30000, tries: 3, playerNear: 1.5 });

// Q8 ("closed behind the bot"): watches a pen gate the bot opened (on a permit, or walking out) and clicks it shut once
// the bot stands 2 blocks or more from it for 1 s with nobody else in it, unless it is closed by then (the door service
// of the home pack may close it first). At most 3 clicks and 30 s; the timer does not keep a process alive. Never throws.
function closeBehind(bot, gate, click) {
    try {
        const start = Date.now();
        let awaySince = null;
        let tries = 0;
        let waitUntil = 0;
        let seenOpen = false;
        const timer = setInterval(() => {
            try {
                const now = Date.now();
                const block = bot.blockAt(new Vec3(gate.x, gate.y, gate.z));
                if (!block || !isGateName(block.name) || now - start > CLOSE_BEHIND.limitMs || tries >= CLOSE_BEHIND.tries) {
                    clearInterval(timer);
                    return;
                }
                if (!isOpenBlock(block)) {
                    // closed: by the click of the door service or ours; before the gate was seen open, the opening click
                    // has not arrived yet (at most 3 s)
                    if (seenOpen || now - start > 3000) {
                        clearInterval(timer);
                    }
                    return;
                }
                seenOpen = true;
                if (now < waitUntil) {
                    return;
                }
                const me = feetOf(bot);
                const center = { x: gate.x + 0.5, z: gate.z + 0.5 };
                const away = me && Math.hypot(me.x - center.x, me.z - center.z) >= CLOSE_BEHIND.away;
                const someone = Object.values(bot.entities ?? {}).some(e => e && e !== bot.entity && e.type === 'player' && e.position
                    && Math.hypot(e.position.x - center.x, e.position.z - center.z) < CLOSE_BEHIND.playerNear && Math.abs(e.position.y - gate.y) < 2);
                if (!away || someone) {
                    awaySince = null;
                    return;
                }
                awaySince ??= now;
                if (now - awaySince < CLOSE_BEHIND.stableMs) {
                    return;
                }
                tries++;
                waitUntil = now + 1500;
                Promise.resolve(click(block)).catch(() => {});
            } catch {
                // the next look
            }
        }, CLOSE_BEHIND.everyMs);
        timer.unref?.();
    } catch {
        // the gate stays as it is
    }
}

// True when a walk of the bot wants into the pen whose gate the path search keeps closed: a player stands inside it, or
// the goal of the path search (a point, or the entity it follows) lies inside it. A walk past a pen says nothing.
function wantsIn(bot, pen) {
    try {
        const box = { min: pen.min, max: pen.max };
        for (const entity of Object.values(bot.entities ?? {})) {
            if (entity && entity !== bot.entity && entity.type === 'player' && insideArea(box, entity.position)) {
                return true;
            }
        }
        const goal = bot.pathfinder?.goal;
        const point = goal?.entity?.position ?? (Number.isFinite(goal?.x) && Number.isFinite(goal?.z) ? { x: goal.x, y: goal.y ?? pen.min.y + 1, z: goal.z } : null);
        return Boolean(point) && insideArea(box, point);
    } catch {
        return false;
    }
}

// Says the pen text, at most once per minute (Q8). Never throws.
function sayPen(bot, text, now = Date.now()) {
    try {
        const state = stateOf(bot);
        if (!mayPenText(state.saidAt, now)) {
            return;
        }
        state.saidAt = now;
        if (typeof state.say === 'function') {
            state.say(text);
        }
    } catch {
        // the text is a help
    }
}

/**
 * True when the pen text may be said now (at most once per minute per bot, the same clock as the guard's own text), and
 * notes it as said (for skills.useToolOnBlock, which writes the text into its own output). Never throws.
 * @param {object} bot
 * @param {number} [now]
 * @returns {boolean}
 */
export function takePenText(bot, now = Date.now()) {
    try {
        const state = stateOf(bot);
        if (!mayPenText(state.saidAt, now)) {
            return false;
        }
        state.saidAt = now;
        return true;
    } catch {
        return true;
    }
}

/**
 * "open the pen" (Q8 and the handoff of round 1): permits the nearest unsaved pen with animals within 16 blocks of the
 * bot for `minutes`; the pen, or null when there is none. Never throws.
 * @param {object} bot
 * @param {number} minutes
 * @param {number} [now]
 * @returns {{key: string, gate: object, min: object, max: object, animals: object}|null}
 */
export function permitPenNear(bot, minutes, now = Date.now()) {
    try {
        const pen = pensNear(bot, PEN_RULES.allowRange, now)[0] ?? null;
        if (!pen) {
            return null;
        }
        const length = Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, 60) : PEN_RULES.permitMinutes;
        stateOf(bot).permits.set(pen.key, now + length * 60000);
        return pen;
    } catch {
        return null;
    }
}

/**
 * The unsaved pens with animals whose gate lies within `range` blocks of the bot (Q8), the nearest gate first, as areas
 * for keepOutAreas of keep_out_logic.js: `{ name: 'pen', kind: 'pen', min, max, entrances, contents, gate, key }`.
 * A pen a saved area holds is left out (the saved one counts). Never throws.
 * @param {object} bot
 * @param {number} [range]
 * @param {number} [now]
 * @returns {object[]}
 */
export function pensNear(bot, range = PEN_RULES.range, now = Date.now()) {
    const out = [];
    try {
        const me = feetOf(bot);
        if (!me) {
            return out;
        }
        const state = stateOf(bot);
        const r = Math.max(1, Math.floor(range));
        const gates = [];
        const fx = Math.floor(me.x);
        const fy = Math.floor(me.y + 0.01);
        const fz = Math.floor(me.z);
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                for (let dy = -2; dy <= 2; dy++) {
                    if (isGateName(blockName(bot, fx + dx, fy + dy, fz + dz)) && Math.hypot(dx, dz) <= r) {
                        gates.push({ x: fx + dx, y: fy + dy, z: fz + dz, d: Math.hypot(dx, dy, dz) });
                    }
                }
            }
        }
        gates.sort((a, b) => a.d - b.d);
        for (const g of gates) {
            if (savedPenOf(state.areas() ?? [], g, bot.game?.dimension)) {
                continue;
            }
            const pen = penBehindGate(bot, g, now);
            if (pen && !out.some(p => p.key === pen.key || (p.min.x === pen.min.x && p.min.z === pen.min.z && p.max.x === pen.max.x && p.max.z === pen.max.z))) {
                out.push({ name: 'pen', kind: 'pen', min: pen.min, max: pen.max, entrances: [{ ...pen.gate, kind: 'gate' }],
                    contents: { animals: pen.animals }, gate: pen.gate, key: pen.key, animals: pen.animals, dimension: bot.game?.dimension });
            }
        }
    } catch {
        // the pens found so far
    }
    return out;
}

/**
 * Installs the guard of the pens on a bot, once (Q8): the hook of the path search (bot.keepGateClosed, read by the patch
 * of mineflayer-pathfinder for a gate a move would open) and the wrap of bot.activateBlock (a click that would open the
 * gate of a pen is refused with the pen text as its error, and the text is said at most once per minute).
 * @param {object} bot
 * @param {{areas?: () => object[], permits?: () => {name: string, until: number}[], say?: (text: string) => void}} [options]
 *   areas: the saved areas of the world now; permits: the running permits of the area guard; say: the chat of the bot
 */
export function installPenGuard(bot, options = {}) {
    try {
        if (!bot || typeof bot !== 'object') {
            return;
        }
        const state = stateOf(bot);
        if (typeof options.areas === 'function') {
            state.areas = options.areas;
        }
        if (typeof options.permits === 'function') {
            state.permitted = options.permits;
        }
        if (typeof options.say === 'function') {
            state.say = options.say;
        }
        if (state.installed) {
            return;
        }
        state.installed = true;
        bot.keepGateClosed = (block) => {
            const refusal = penGateRefusal(bot, block);
            if (refusal && wantsIn(bot, refusal.pen)) {
                sayPen(bot, refusal.text); // the walk would have gone through this gate
            }
            return refusal !== null;
        };
        // the plugins of mineflayer are injected after the bot is made: the click is wrapped now when it exists, and at
        // the spawn (a wrap of another guard around this one, or this one around it, both hold)
        const wrap = () => {
            try {
                const original = bot.activateBlock;
                if (typeof original !== 'function' || original.penGuard === true) {
                    return;
                }
                const guarded = function guardedPenGate(...args) {
                    const pen = penGateOf(bot, args[0]);
                    if (pen && !pen.allowed) {
                        sayPen(bot, pen.text);
                        return Promise.reject(Object.assign(new Error(pen.text), { name: 'PenGate' }));
                    }
                    const result = Reflect.apply(original, this, args);
                    if (pen) {
                        // a pen gate opened on a permit or from inside is closed behind the bot
                        closeBehind(bot, pen.pen.gate, (block) => Reflect.apply(original, bot, [block]));
                    }
                    return result;
                };
                guarded.penGuard = true;
                bot.activateBlock = guarded;
            } catch {
                // the click is not guarded
            }
        };
        wrap();
        if (typeof bot.once === 'function') {
            bot.once('spawn', wrap);
        }
    } catch {
        // the bot works as before
    }
}

export { PEN_RULES, isPenArea };
