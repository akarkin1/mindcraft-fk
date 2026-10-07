// v0.1.4.12 (part C): the six tools of the watch server (spec 4.1). Each is `async (agent, args, watch) => text`
// and never throws; a failure is a text that names the cause. watch is the state of the server: the chat lines
// (watch.chat, a Ring of { t, name, text }), the events (watch.events), the last player that spoke
// (watch.lastSpeaker), the last line of a player that reached the bot (watch.lastLine { text, by, at }), and for
// tests watch.now and watch.settings. Only `say` changes anything: it hands a line to agent.handleMessage.
//
// v0.1.4.13 (part S): the tools digest, wait, run, look and server (spec 4.1). The state they need lives on
// watch too and is made when it is missing (ensureState): watch.cursors (the last 50 snapshots, digest_logic),
// watch.waits (the open waits, createWaits here), watch.queue (the command queue, queue.js), watch.presence
// ({ seenAt }: the last wait or digest call, for the server line and part N2). registerTool(name, schema,
// handler) adds a tool without editing the table: part N2 adds reply and note. A handler gets a fourth
// argument { signal }: an AbortSignal that fires when the connection of the call closed.
import v8 from 'node:v8';
import { Vec3 } from 'vec3';
import settingsOfAgent from '../settings.js';
import { recallHome } from '../packs/home/context.js';
import { numberedRules } from '../rules/rule_prompt.js';
import { formatDollars } from '../cost/cost_meter.js';
import { TEXTS } from './texts.js';
import { distance, eventLine, eventsSince, plainDimension, pointsText, posText, sinceMs } from './events_logic.js';
import { TOOLS } from './mcp_logic.js';
import {
    DIGEST_RULES, WAIT_RULES, chatLine, createCursorStore, digestLines, isPlayerLine, parseCursor, runningOf, snapshotOf, waitTimeout,
    wakeReason,
} from './digest_logic.js';
import { createQueue, runRefusal } from './queue.js';
import { runQuiet } from '../chat_gate.js'; // v0.1.4.13 fix1
import { lookAround, lookRadius } from './look_logic.js';
import { registerSupervisorTools } from './supervisor.js'; // v0.1.4.13 (part N2): reply and note

export { chatLine };

export const TOOL_RULES = Object.freeze({
    chatDefault: 10,
    chatMax: 50,
    sayMax: 256,
    rulesMax: 10,
    waitsMax: 4,          // open waits at a time
    waitTimeoutMax: 55,   // seconds
    waitTickMs: 500,      // the open waits are checked this often
    presenceMs: 60000,    // a supervisor is connected after a wait or digest within this time
});

function nowOf(watch) {
    const t = typeof watch?.now === 'function' ? Number(watch.now()) : Date.now();
    return Number.isFinite(t) ? t : Date.now();
}

function settingsOf(watch) {
    return watch?.settings ?? settingsOfAgent;
}

function nameOf(agent) {
    return agent?.name || agent?.bot?.username || 'The bot';
}

function lines(list) {
    return list.filter((line) => typeof line === 'string' && line !== '').join('\n');
}

/** The part of the day: day, dusk, night or dawn. */
export function phaseOf(timeOfDay) {
    if (typeof timeOfDay !== 'number' || !Number.isFinite(timeOfDay))
        return 'unknown';
    const t = ((timeOfDay % 24000) + 24000) % 24000;
    if (t < 12000)
        return 'day';
    if (t < 13000)
        return 'dusk';
    if (t < 23000)
        return 'night';
    return 'dawn';
}

/** `12 s ago`, `3 min ago`, `2 h ago`. */
export function agoText(ms) {
    const s = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
    if (s < 60)
        return `${s} s ago`;
    if (s < 3600)
        return `${Math.floor(s / 60)} min ago`;
    return `${Math.floor(s / 3600)} h ago`;
}

// ---- state ----

function underFeet(bot, pos) {
    try {
        const below = typeof pos.offset === 'function' ? pos.offset(0, -0.5, 0) : { x: pos.x, y: pos.y - 0.5, z: pos.z };
        return bot.blockAt?.(below)?.name ?? 'unknown';
    } catch {
        return 'unknown';
    }
}

function runningLine(agent, now) {
    const running = runningOf(agent, { reflexes: true }); // the state tool of v0.1.4.12 names a reflex too
    if (!running)
        return TEXTS.runningNothing;
    const seconds = running.startedAt > 0 ? Math.max(0, Math.round((now - running.startedAt) / 1000)) : 0;
    return TEXTS.running(running.text, seconds);
}

function jobLine(agent) {
    try {
        const line = agent?.job?.status?.();
        return typeof line === 'string' && line.trim() !== '' ? line.trim() : TEXTS.noJob;
    } catch {
        return TEXTS.noJob;
    }
}

function lastOrderLine(agent, watch, now) {
    const line = watch?.lastLine;
    if (line && typeof line.text === 'string')
        return TEXTS.lastOrder(line.text, line.by ?? '?', agoText(now - line.at));
    const order = agent?.last_order;
    if (order && typeof order === 'object') {
        const text = typeof order.text === 'string' && order.text !== '' ? order.text : order.command;
        if (typeof text === 'string' && text !== '')
            return TEXTS.lastOrder(text, order.by ?? '?', agoText(now - (order.at ?? now)));
    }
    return TEXTS.noLastOrder;
}

function homeLine(agent, pos, dimension) {
    const home = recallHome({ places: agent?.memory_bank });
    if (!home)
        return TEXTS.noHome;
    if (home.dimension && plainDimension(home.dimension) !== plainDimension(dimension))
        return TEXTS.homeElsewhere(posText(home), plainDimension(home.dimension));
    const cell = (p) => (p && Number.isFinite(p.x) ? { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) } : p);
    const d = distance(cell(pos), cell(home)); // T1-2: between the cells, as the two printed positions are
    if (!Number.isFinite(d))
        return TEXTS.homeElsewhere(posText(home), plainDimension(home.dimension));
    return TEXTS.home(posText(home), Math.round(d));
}

export async function state(agent, args = {}, watch = {}) {
    const now = nowOf(watch);
    const bot = agent?.bot;
    const pos = bot?.entity?.position;
    const out = [];
    const dimension = bot?.game?.dimension;
    if (pos && Number.isFinite(pos.x)) {
        const time = bot.time?.timeOfDay;
        const food = Number.isFinite(bot.food) ? Math.round(bot.food) : '?';
        out.push(TEXTS.position(nameOf(agent), posText(pos), plainDimension(dimension), underFeet(bot, pos),
            Number.isFinite(time) ? time : '?', phaseOf(time), pointsText(bot.health), food));
    } else {
        out.push(TEXTS.noWorld(nameOf(agent)));
    }
    out.push(runningLine(agent, now));
    out.push(jobLine(agent));
    out.push(lastOrderLine(agent, watch, now));
    out.push(homeLine(agent, pos, dimension));
    return lines(out);
}

// ---- inventory ----

export async function inventory(agent) {
    const bot = agent?.bot;
    const counts = new Map();
    let items = [];
    try {
        items = bot?.inventory?.items?.() ?? [];
    } catch {
        items = [];
    }
    for (const item of items) {
        if (typeof item?.name === 'string' && Number.isFinite(item.count))
            counts.set(item.name, (counts.get(item.name) ?? 0) + item.count);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const first = sorted.length === 0 ? TEXTS.inventoryEmpty : TEXTS.inventory(sorted.map(([name, n]) => `${n} ${name}`).join(', '));
    const hand = bot?.heldItem?.name ?? 'empty';
    const offHand = bot?.inventory?.slots?.[45]?.name ?? 'empty';
    return lines([first, TEXTS.hands(hand, offHand)]);
}

// ---- chat ----

/** The number of lines of the chat tool: an integer 1 to 50, else 10. */
export function chatCount(value) {
    const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
    if (!Number.isInteger(n))
        return TOOL_RULES.chatDefault;
    return Math.min(Math.max(n, 1), TOOL_RULES.chatMax);
}

export async function chat(agent, args = {}, watch = {}) {
    const list = watch?.chat?.last?.(chatCount(args?.lines)) ?? [];
    return list.length === 0 ? TEXTS.noChat : lines(list.map(chatLine));
}

// ---- places ----

function boxText(area) {
    const a = area.min;
    const b = area.max;
    return `(${a.x},${a.y},${a.z})-(${b.x},${b.y},${b.z})`;
}

function areasLine(agent) {
    let areas = [];
    try {
        areas = agent?.area_store?.list?.() ?? [];
    } catch {
        areas = [];
    }
    const parts = areas.filter((area) => area?.min && area?.max).map((area) => {
        const where = plainDimension(area.dimension) === 'overworld' ? '' : ` in ${plainDimension(area.dimension)}`;
        return `${area.name} (${area.kind ?? area.type}) ${boxText(area)}${where}`;
    });
    return parts.length === 0 ? TEXTS.noAreas : TEXTS.areas(parts.join('; '));
}

function minesLine(agent) {
    let mines = [];
    try {
        const store = agent?._workStores?.()?.mines ?? null;
        mines = store?.list?.() ?? [];
    } catch {
        mines = [];
    }
    const tunnelsOf = agent?.work_packs?.mining?.tunnelsOf;
    const parts = mines.map((mine) => {
        let tunnels = Array.isArray(mine?.tunnels) ? mine.tunnels.length : 0;
        try {
            if (typeof tunnelsOf === 'function')
                tunnels = tunnelsOf(mine)?.length ?? tunnels;
        } catch {
            // the count of the record
        }
        const name = typeof mine?.name === 'string' && mine.name !== '' ? mine.name : `bot:${Math.floor(mine?.level)}`;
        return TEXTS.mine(name, posText(mine?.entrance), tunnels);
    });
    return parts.length === 0 ? TEXTS.noMines : TEXTS.mines(parts.join('; '));
}

function routesLine(agent) {
    let routes = [];
    try {
        routes = agent?.homeContext?.()?.routes?.store?.list?.() ?? [];
    } catch {
        routes = [];
    }
    const names = routes.map((route) => route?.name).filter((name) => typeof name === 'string' && name !== '');
    return names.length === 0 ? TEXTS.noRoutes : TEXTS.routes(names.join(', '));
}

function rulesLine(agent) {
    let rules = [];
    try {
        rules = agent?.rule_store?.list?.() ?? [];
    } catch {
        rules = [];
    }
    const numbered = numberedRules(rules).slice(0, TOOL_RULES.rulesMax).map((line) => (/[.!?]$/.test(line) ? line : `${line}.`));
    return numbered.length === 0 ? TEXTS.noRules : TEXTS.rules(numbered.join(' '));
}

export async function places(agent) {
    return lines([areasLine(agent), minesLine(agent), routesLine(agent), rulesLine(agent)]);
}

// ---- events ----

export async function events(agent, args = {}, watch = {}) {
    const since = args?.since === undefined || args?.since === null || args?.since === '' ? null : sinceMs(args.since);
    const list = eventsSince(watch?.events?.items ?? [], since);
    return list.length === 0 ? TEXTS.noEvents : lines(list.map(eventLine));
}

// ---- say ----

/** The name the line of say is handed with: only_chat_with[0], else the last player that spoke, else "watcher". */
export function ownerName(settings, watch) {
    const first = Array.isArray(settings?.only_chat_with) ? settings.only_chat_with[0] : null;
    if (typeof first === 'string' && first !== '')
        return first;
    if (typeof watch?.lastSpeaker === 'string' && watch.lastSpeaker !== '')
        return watch.lastSpeaker;
    return 'watcher';
}

export async function say(agent, args = {}, watch = {}) {
    const text = args.text;
    const owner = ownerName(settingsOf(watch), watch);
    try {
        watch?.chat?.push?.({ t: nowOf(watch), name: `${owner} (by watch)`, text });
        agent.shut_up = false; // as a typed line
        // v0.1.4.13 fix1: quiet, the bot's answer goes to the digest and the log, not to the game chat
        Promise.resolve(runQuiet(() => agent.handleMessage(owner, text))).catch((error) => console.warn('The line of the watch failed:', error?.message ?? error));
    } catch (error) {
        return TEXTS.sayFailed(error?.message ?? String(error));
    }
    return TEXTS.said(owner, text);
}

// ---- v0.1.4.13 (part S): the state of the new tools ----

/** The last wait or digest call: the presence of a supervisor (4.5, for part N2 and the server line). */
export function touchPresence(watch) {
    if (!watch || typeof watch !== 'object')
        return;
    if (!watch.presence || typeof watch.presence !== 'object')
        watch.presence = { seenAt: null };
    watch.presence.seenAt = nowOf(watch);
}

/**
 * The open waits of the server. wait() holds its answer until the rule fires, the timeout passes or the
 * connection closes; at most 4 at a time. One timer runs while a wait is open and goes when none is.
 * @param {object} agent
 * @param {object} watch
 * @param {{tickMs?: number}} [options]
 */
export function createWaits(agent, watch, options = {}) {
    const tickMs = Number.isFinite(options?.tickMs) && options.tickMs > 0 ? options.tickMs : TOOL_RULES.waitTickMs;
    const open = new Set();
    let timer = null;
    let lastBusyAt = null;
    const busy = () => {
        try {
            return runningOf(agent) !== null; // a command, never a reflex
        } catch {
            return false;
        }
    };
    const idleMs = (t) => {
        const started = agent?.actions?.last_action_time;
        const since = Math.max(lastBusyAt ?? -Infinity, Number.isFinite(started) ? started : -Infinity);
        return since === -Infinity ? Infinity : Math.max(0, t - since);
    };
    const playerLines = (base) => {
        try {
            const bot = nameOf(agent);
            return (watch?.chat?.since?.(base.chatIndex) ?? []).filter((entry) => isPlayerLine(entry, bot)).length;
        } catch {
            return 0;
        }
    };
    const stopTimer = () => {
        if (timer)
            clearInterval(timer);
        timer = null;
    };
    const finish = (w, reason) => {
        if (!open.has(w))
            return;
        open.delete(w);
        clearTimeout(w.timer);
        if (open.size === 0)
            stopTimer();
        if (reason === null) {
            w.resolve(''); // the connection is gone
            return;
        }
        try {
            const after = snapshotOf(agent, watch);
            const cursors = ensureState(agent, watch).cursors;
            const cursor = cursors.add(after);
            const before = w.since !== null ? cursors.get(w.since) : w.base;
            const digest = digestLines(before, after, { cursor, chat: watch?.chat, events: watch?.events });
            const head = [TEXTS.woke(reason)];
            if (reason === 'done' && !w.runningAtStart)
                head.push(TEXTS.runningNothing);
            w.resolve([...head, ...digest].join('\n'));
        } catch (error) {
            w.resolve(TEXTS.toolFailed('wait', error?.message ?? String(error)));
        }
    };
    const check = (w, t) => {
        const needSnapshot = w.rule === 'any' || w.rule === 'event';
        const now = needSnapshot ? snapshotOf(agent, watch) : null;
        const running = runningOf(agent);
        return wakeReason(w.rule, {
            base: w.base, now: now ?? w.base, runningAtStart: w.runningAtStart, running, idleMs: idleMs(t),
            playerLines: w.rule === 'any' ? playerLines(w.base) : 0,
        });
    };
    const tick = () => {
        const t = nowOf(watch);
        if (busy())
            lastBusyAt = t;
        for (const w of [...open]) {
            try {
                const reason = check(w, t);
                if (reason)
                    finish(w, reason);
            } catch (error) {
                finish(w, 'timeout');
                console.warn('Watch server: a wait failed:', error?.message ?? error);
            }
        }
    };
    const startTimer = () => {
        if (timer)
            return;
        timer = setInterval(tick, tickMs);
        timer.unref?.();
    };
    return {
        /**
         * @param {{rule: string, timeout: number, since: number|null}} request timeout in seconds
         * @param {AbortSignal} [signal] the connection of the call
         * @returns {Promise<string>}
         */
        wait(request, signal) {
            return new Promise((resolve) => {
                const t = nowOf(watch);
                if (busy())
                    lastBusyAt = t;
                const base = snapshotOf(agent, watch);
                const w = { rule: request.rule, since: request.since ?? null, base, runningAtStart: base.running, resolve, timer: null };
                open.add(w);
                const first = check(w, t);
                if (first) {
                    finish(w, first);
                    return;
                }
                // not unref'd: an open wait is an open request, it keeps the process until it is answered
                w.timer = setTimeout(() => finish(w, 'timeout'), Math.max(1, request.timeout) * 1000);
                if (signal && typeof signal.addEventListener === 'function')
                    signal.addEventListener('abort', () => finish(w, null), { once: true });
                startTimer();
            });
        },
        /** An event was pushed: the waits are checked at once. */
        onEvent() {
            if (open.size > 0)
                tick();
        },
        get size() {
            return open.size;
        },
        close() {
            for (const w of [...open])
                finish(w, 'timeout');
            stopTimer();
        },
    };
}

/** The state of the new tools on watch, made when it is missing. */
export function ensureState(agent, watch) {
    if (!watch || typeof watch !== 'object')
        return { cursors: createCursorStore(), waits: null, queue: null };
    if (!watch.cursors)
        watch.cursors = createCursorStore(DIGEST_RULES.cursorSize);
    if (!watch.waits)
        watch.waits = createWaits(agent, watch, { tickMs: watch.waitTickMs });
    if (!watch.queue)
        watch.queue = createQueue(agent, { now: watch.now, answerMs: watch.answerMs, longSkillMs: watch.longSkillMs });
    return watch;
}

// ---- digest ----

export async function digest(agent, args = {}, watch = {}) {
    const stateOf = ensureState(agent, watch);
    touchPresence(watch);
    const after = snapshotOf(agent, watch);
    const cursor = stateOf.cursors.add(after);
    const since = parseCursor(args?.since);
    const before = since === null ? null : stateOf.cursors.get(since);
    return digestLines(before, after, { cursor, chat: watch?.chat, events: watch?.events }).join('\n');
}

// ---- wait ----

/** The rule of a wait: one of WAIT_RULES, `any` without a value; null for anything else. */
export function waitRule(value) {
    if (value === undefined || value === null || value === '')
        return 'any';
    return typeof value === 'string' && WAIT_RULES.includes(value.trim()) ? value.trim() : null;
}

export async function wait(agent, args = {}, watch = {}, request = {}) {
    const stateOf = ensureState(agent, watch);
    touchPresence(watch);
    if (stateOf.waits.size >= TOOL_RULES.waitsMax)
        return TEXTS.tooManyWaits(TOOL_RULES.waitsMax);
    const rule = waitRule(args?.for);
    const timeout = waitTimeout(args?.timeout, TOOL_RULES.waitTimeoutMax);
    return stateOf.waits.wait({ rule, timeout, since: parseCursor(args?.since) }, request?.signal);
}

// ---- run ----

export async function run(agent, args = {}, watch = {}) {
    const stateOf = ensureState(agent, watch);
    const owner = ownerName(settingsOf(watch), watch);
    try {
        agent.shut_up = false; // as a typed line
    } catch {
        // a fixture agent
    }
    return stateOf.queue.run(args.commands.map((c) => c.trim()), { by: owner, stopOnFailure: args?.stop_on_failure !== false });
}

// ---- look ----

function readerOf(agent) {
    const bot = agent?.bot;
    return {
        blockAt(x, y, z) {
            return bot.blockAt(new Vec3(x, y, z));
        },
        entities() {
            const out = [];
            const own = bot?.username ?? agent?.name;
            for (const [name, player] of Object.entries(bot?.players ?? {})) {
                if (name !== own && player?.entity?.position)
                    out.push({ kind: 'player', name, position: player.entity.position });
            }
            for (const entity of Object.values(bot?.entities ?? {})) {
                if (entity?.name !== 'item' || !entity.position)
                    continue;
                let item = null;
                try {
                    item = typeof entity.getDroppedItem === 'function' ? entity.getDroppedItem() : null;
                } catch {
                    item = null;
                }
                out.push({ kind: 'item', name: item?.name ?? 'item', count: Number.isFinite(item?.count) ? item.count : 1, position: entity.position });
            }
            return out;
        },
    };
}

export async function look(agent, args = {}) {
    const bot = agent?.bot;
    const pos = bot?.entity?.position;
    if (!pos || !Number.isFinite(pos.x) || typeof bot.blockAt !== 'function')
        return TEXTS.noWorld(nameOf(agent));
    const center = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
    let chestIndex = null;
    try {
        chestIndex = agent?._workStores?.()?.chests ?? null;
    } catch {
        chestIndex = null;
    }
    return lines(lookAround(readerOf(agent), center, lookRadius(args?.radius), { chestIndex }));
}

// ---- server ----

/** `42 min`, `2 h 5 min`, `30 s`. */
export function upText(seconds) {
    const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    if (s < 60)
        return `${s} s`;
    const minutes = Math.floor(s / 60);
    if (minutes < 60)
        return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** `$0.04 (chat $0.03, memory $0.01)` from the totals of the cost meter, the purposes by dollars. */
export function sessionText(totals) {
    const purposes = Object.entries(totals?.by_purpose ?? {})
        .filter(([, bucket]) => Number.isFinite(bucket?.calls) && bucket.calls > 0)
        .sort(([nameA, a], [nameB, b]) => (b.dollars - a.dollars) || (b.calls - a.calls) || (nameA < nameB ? -1 : nameA > nameB ? 1 : 0));
    const session = `$${formatDollars(totals?.dollars)}`;
    if (purposes.length === 0)
        return session;
    return `${session} (${purposes.map(([name, bucket]) => `${name} $${formatDollars(bucket.dollars)}`).join(', ')})`;
}

/** The boolean settings that are true, sorted. */
export function switchesOn(settings) {
    return Object.entries(settings ?? {}).filter(([, value]) => value === true).map(([key]) => key).sort();
}

function weatherOf(bot) {
    if (Number.isFinite(bot?.thunderState) && bot.thunderState > 0)
        return 'thunder';
    return bot?.isRaining === true ? 'rain' : 'clear';
}

export async function server(agent, args = {}, watch = {}) {
    const now = nowOf(watch);
    const bot = agent?.bot;
    const out = [];
    const heap = Math.round((process.memoryUsage().heapUsed ?? 0) / 1048576);
    const limit = Math.round((v8.getHeapStatistics().heap_size_limit ?? 0) / 1048576);
    const lag = typeof watch?.tickLag?.lag === 'function' ? watch.tickLag.lag() : 0;
    out.push(TEXTS.up(upText(typeof watch?.uptime === 'function' ? watch.uptime() : process.uptime()), heap, limit, Number.isFinite(lag) ? lag : 0));
    const own = bot?.username ?? agent?.name;
    const players = Object.keys(bot?.players ?? {}).filter((name) => name !== own).sort();
    out.push(players.length === 0 ? TEXTS.noPlayers : TEXTS.playersOnline(players.join(', ')));
    const time = bot?.time?.timeOfDay;
    out.push(TEXTS.timeWeather(Number.isFinite(time) ? time : '?', phaseOf(time), weatherOf(bot)));
    let totals = null;
    try {
        totals = agent?.cost_meter?.totals?.() ?? null;
    } catch {
        totals = null;
    }
    out.push(totals ? TEXTS.modelCalls(Number.isFinite(totals.calls) ? totals.calls : 0, sessionText(totals)) : TEXTS.noCostMeter);
    const on = switchesOn(settingsOf(watch));
    out.push(on.length === 0 ? TEXTS.noSwitches : TEXTS.switchesOn(on.join(', ')));
    const seenAt = watch?.presence?.seenAt;
    out.push(Number.isFinite(seenAt) && now - seenAt <= TOOL_RULES.presenceMs ? TEXTS.supervisorConnected(agoText(now - seenAt)) : TEXTS.noSupervisor);
    return lines(out);
}

// ---- the table and the registry ----

export const TOOL_HANDLERS = Object.freeze({ state, inventory, chat, places, events, say, digest, wait, run, look, server });

const registry = new Map(); // name -> { schema, handler }: the tools of other parts (N2: reply, note)

/**
 * Adds a tool without editing the table (part N2: reply and note). A name of the table cannot be replaced.
 * @param {string} name
 * @param {{description: string, inputSchema: object}} schema the JSON schema of its arguments, as in TOOLS
 * @param {(agent: object, args: object, watch: object, request?: {signal?: AbortSignal}) => Promise<string>} handler
 * @returns {boolean} true when it was added
 */
export function registerTool(name, schema, handler) {
    if (typeof name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(name) || typeof handler !== 'function')
        return false;
    if (Object.prototype.hasOwnProperty.call(TOOL_HANDLERS, name))
        return false;
    const description = typeof schema?.description === 'string' ? schema.description : '';
    const inputSchema = schema?.inputSchema && typeof schema.inputSchema === 'object' ? schema.inputSchema : { type: 'object', properties: {}, additionalProperties: false };
    registry.set(name, { schema: Object.freeze({ name, description, inputSchema }), handler, refusal: typeof schema?.refusal === 'function' ? schema.refusal : null });
    return true;
}

/** Removes a registered tool (tests). */
export function unregisterTool(name) {
    return registry.delete(name);
}

/** The schemas of every tool for tools/list: the table, then the registered ones. */
export function toolList() {
    return [...TOOLS.map((tool) => ({ ...tool })), ...[...registry.values()].map((entry) => ({ ...entry.schema }))];
}

function handlerOf(name) {
    if (Object.prototype.hasOwnProperty.call(TOOL_HANDLERS, name))
        return TOOL_HANDLERS[name];
    return registry.get(name)?.handler ?? null;
}

/**
 * The refusal of the arguments of a tool, or null. Pure. say: a text of 1 to 256 characters that does not
 * start with "/"; events: since an ISO time when given; wait: for one of event, idle, done, any and a timeout
 * of 1 to 55; run: 1 to 10 commands; look: a radius of 4 to 32. A registered tool with a `refusal` function
 * in its schema is asked.
 * @param {string} name
 * @param {object} args
 * @returns {string|null}
 */
export function argsRefusal(name, args = {}) {
    if (name === 'say') {
        const text = args?.text;
        if (typeof text !== 'string' || text.trim() === '' || text.length > TOOL_RULES.sayMax)
            return TEXTS.badText;
        if (text.trim().startsWith('/'))
            return TEXTS.noCommands;
    }
    if (name === 'events') {
        const since = args?.since;
        if (since !== undefined && since !== null && since !== '' && sinceMs(since) === null)
            return TEXTS.badSince(String(since));
    }
    if (name === 'wait') {
        if (waitRule(args?.for) === null)
            return TEXTS.badWaitFor(String(args.for));
        if (waitTimeout(args?.timeout, TOOL_RULES.waitTimeoutMax) === null)
            return TEXTS.badTimeout(String(args.timeout));
    }
    if (name === 'run')
        return runRefusal(args);
    if (name === 'look' && lookRadius(args?.radius) === null)
        return TEXTS.badRadius(String(args.radius));
    const registered = registry.get(name);
    if (registered?.refusal) {
        try {
            const refusal = registered.refusal(args);
            return typeof refusal === 'string' && refusal !== '' ? refusal : null;
        } catch {
            return null;
        }
    }
    return null;
}

/**
 * Runs a tool: { text, isError } (isError on a refusal or a failure); null for an unknown tool. Never throws.
 * @param {object} agent
 * @param {object} watch
 * @param {string} name
 * @param {object} args
 * @param {{signal?: AbortSignal}} [request] the connection of the call, for wait
 * @returns {Promise<{text: string, isError: boolean}|null>}
 */
export async function runTool(agent, watch, name, args = {}, request = {}) {
    const handler = handlerOf(name);
    if (!handler)
        return null;
    const clean = args !== null && typeof args === 'object' && !Array.isArray(args) ? args : {};
    const refusal = argsRefusal(name, clean);
    if (refusal)
        return { text: refusal, isError: true };
    // v0.1.4.13 fix 2: every call of the supervisor counts as presence, at its start and its end (a run of commands
    // can take 55 s; in the play of 2026-10-06 the bot said "The supervisor is not here." during two such runs).
    // Not `server`: its line reports the presence of the other calls.
    const present = name !== 'server';
    if (present)
        touchPresence(watch);
    try {
        const text = await handler(agent, clean, watch, request ?? {});
        if (present)
            touchPresence(watch);
        const isError = name === 'wait' && text === TEXTS.tooManyWaits(TOOL_RULES.waitsMax);
        return { text: typeof text === 'string' ? text : String(text), isError };
    } catch (error) {
        return { text: TEXTS.toolFailed(name, error?.message ?? String(error)), isError: true };
    }
}

// v0.1.4.13 (part N2): the tools of the supervisor in the chat (spec 4.5), reply and note, registered when the
// server is loaded (after the settings of the agent are set) and only with supervisor_name set
registerSupervisorTools(registerTool, settingsOfAgent);
