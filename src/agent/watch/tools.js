// v0.1.4.12 (part C): the six tools of the watch server (spec 4.1). Each is `async (agent, args, watch) => text`
// and never throws; a failure is a text that names the cause. watch is the state of the server: the chat lines
// (watch.chat, a Ring of { t, name, text }), the events (watch.events), the last player that spoke
// (watch.lastSpeaker), the last line of a player that reached the bot (watch.lastLine { text, by, at }), and for
// tests watch.now and watch.settings. Only `say` changes anything: it hands a line to agent.handleMessage.
import settingsOfAgent from '../settings.js';
import { recallHome } from '../packs/home/context.js';
import { numberedRules } from '../rules/rule_prompt.js';
import { TEXTS } from './texts.js';
import { clockText, distance, eventLine, eventsSince, plainDimension, pointsText, posText, sinceMs } from './events_logic.js';

export const TOOL_RULES = Object.freeze({
    chatDefault: 10,
    chatMax: 50,
    sayMax: 256,
    rulesMax: 10,
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

/** `[13:45:02] MartyByrde2: go to the farm` */
export function chatLine(entry) {
    return `[${clockText(entry?.t)}] ${entry?.name ?? '?'}: ${entry?.text ?? ''}`;
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
    const label = agent?.actions?.currentActionLabel;
    if (typeof label !== 'string' || label === '')
        return TEXTS.runningNothing;
    let what = label;
    if (label.startsWith('action:')) {
        const name = `!${label.slice('action:'.length)}`;
        const list = Array.isArray(agent.running_commands) ? agent.running_commands : [];
        const running = [...list].reverse().find((c) => c?.name === name && typeof c.text === 'string');
        what = running ? running.text : name;
    } else if (label.startsWith('mode:')) {
        what = `the reflex ${label.slice('mode:'.length)}`;
    }
    const started = agent.actions?.last_action_time;
    const seconds = Number.isFinite(started) && started > 0 ? Math.max(0, Math.round((now - started) / 1000)) : 0;
    return TEXTS.running(what, seconds);
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
    const d = distance(pos, home);
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
        Promise.resolve(agent.handleMessage(owner, text)).catch((error) => console.warn('The line of the watch failed:', error?.message ?? error));
    } catch (error) {
        return TEXTS.sayFailed(error?.message ?? String(error));
    }
    return TEXTS.said(owner, text);
}

export const TOOL_HANDLERS = Object.freeze({ state, inventory, chat, places, events, say });

/**
 * The refusal of the arguments of a tool, or null. Pure. say: a text of 1 to 256 characters that does not
 * start with "/"; events: since an ISO time when given.
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
    return null;
}

/**
 * Runs a tool: { text, isError } (isError on a refusal or a failure); null for an unknown tool. Never throws.
 * @param {object} agent
 * @param {object} watch
 * @param {string} name
 * @param {object} args
 * @returns {Promise<{text: string, isError: boolean}|null>}
 */
export async function runTool(agent, watch, name, args = {}) {
    const handler = Object.prototype.hasOwnProperty.call(TOOL_HANDLERS, name) ? TOOL_HANDLERS[name] : null;
    if (!handler)
        return null;
    const clean = args !== null && typeof args === 'object' && !Array.isArray(args) ? args : {};
    const refusal = argsRefusal(name, clean);
    if (refusal)
        return { text: refusal, isError: true };
    try {
        const text = await handler(agent, clean, watch);
        return { text: typeof text === 'string' ? text : String(text), isError: false };
    } catch (error) {
        return { text: TEXTS.toolFailed(name, error?.message ?? String(error)), isError: true };
    }
}
