// v0.1.4.13 (part N2): the supervisor in the chat (spec 4.5), the glue over the bot and the watch server:
//   - the message event: a line of a player that addresses the supervisor (the drop branch of respondFunc in
//     agent.js, `verdict.why === 'addressed_supervisor'`) is pushed into the ring of the watch server as an event of
//     kind message; when no supervisor is connected (no wait or digest call within 60 s and no wait open,
//     watch.presence) the first agent of the mindserver says `The supervisor is not here.` through openChat;
//   - the tools reply and note (SUPERVISOR_TOOLS, registered by tools.js through registerTool when supervisor_name
//     is set): reply relays the line into the chat as `[Opus] <text>`, said by the bot directly (bot.whisper to
//     only_chat_with, else bot.chat, as openChat does), never through openChat, so it is no line of the bot for the
//     help event, the digest or the hold rule; it also goes to the page as a bot-output of SUPERVISOR_OUTPUT
//     (chat_logic.js), lazily through the mindserver proxy; note sets agent.supervisor_note, which the prompter reads;
//   - nobody speaks over anybody: a line of the supervisor is held while the owner's last line (watch.lastLine) has
//     no bot line after it yet, up to 10 s, and for 3 s after a bot line (the chat ring of the watch: the own lines
//     and those of other_bots); an update held over 20 s is dropped. The state lives on watch.supervisor
//     (ensureSupervisor). Nothing here throws.
import settingsOfAgent from '../settings.js';
import { SUPERVISOR_OUTPUT, supervisorOutput } from '../../mindcraft/public/chat_logic.js';
import {
    SUPERVISOR_RULES, SUPERVISOR_TEXTS, holdStep, isConnected, isRelayedLine, kindOf, messageEvent, noteOf, noteRefusal,
    relayLine, replyRefusal, speaksForAll, supervisorName,
} from './supervisor_logic.js';

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

function warn(what, error) {
    try {
        console.warn(`The supervisor: ${what}:`, error?.message ?? error);
    } catch {
        // nothing to do
    }
}

function names(list) {
    return (Array.isArray(list) ? list : []).filter((n) => typeof n === 'string' && n.trim() !== '').map((n) => n.trim());
}

// The line of the supervisor to the page, through the socket of the mindserver (lazily: the proxy is loaded
// only when a line is relayed); without a mindserver nothing happens.
let proxy = null;
function pageOutput(agentName, message) {
    proxy = proxy ?? import('../mindserver_proxy.js');
    proxy.then((m) => m.sendOutputToServer(agentName, message)).catch(() => {
        // no mindserver (a test, or the agent runs alone): the page shows nothing
    });
}

/**
 * True when a supervisor is connected to this watch server: a wait or digest within 60 s, or a wait open now.
 * @param {object} watch the state of the watch server
 * @param {number} [now] ms
 */
export function supervisorPresent(watch, now = nowOf(watch)) {
    const open = Number(watch?.waits?.size);
    return isConnected(watch?.presence?.seenAt, now, SUPERVISOR_RULES.presenceMs, Number.isFinite(open) ? open : 0);
}

/**
 * The state of the supervisor over one watch server.
 * @param {object} agent
 * @param {object} watch the state of the watch server: chat (Ring), lastLine, presence, now(), settings (tests)
 * @param {{output?: (agentName: string, message: string) => void, tickMs?: number}} [options] output: where the
 *   line of the supervisor goes for the page (tests); tickMs: how often the held lines are checked
 */
export function createSupervisor(agent, watch, options = {}) {
    const output = typeof options?.output === 'function' ? options.output : pageOutput;
    const tickMs = Number.isFinite(options?.tickMs) && options.tickMs > 0 ? options.tickMs : SUPERVISOR_RULES.tickMs;
    let held = []; // { line, kind, queuedAt, resolve }
    let timer = null;

    const ownerLineAt = () => {
        const at = watch?.lastLine?.at;
        return Number.isFinite(at) ? at : null;
    };
    // the last line of a bot: the own lines (openChat) and the lines of the owner's other bots, never a relayed line
    const botLineAt = (boss) => {
        const items = watch?.chat?.items;
        if (!Array.isArray(items))
            return null;
        const bots = new Set([nameOf(agent), ...names(settingsOf(watch)?.other_bots)].map((n) => n.toLowerCase()));
        for (let i = items.length - 1; i >= 0; i--) {
            const entry = items[i];
            if (typeof entry?.name === 'string' && bots.has(entry.name.toLowerCase()) && !isRelayedLine(entry.text, boss))
                return Number.isFinite(entry.t) ? entry.t : null;
        }
        return null;
    };

    // Says the line as the bot: a whisper to every name of only_chat_with, else the open chat (as openChat does),
    // into the chat ring of the watch, and to the page. Returns null, or the cause when nothing could be said.
    const relay = (line, kind, boss) => {
        const settings = settingsOf(watch);
        const bot = agent?.bot;
        try {
            const listened = names(settings?.only_chat_with);
            if (listened.length > 0) {
                for (const username of listened)
                    bot.whisper(username, line);
            } else if (settings?.chat_ingame !== false) { // as openChat; a setting that is not there counts as on
                bot.chat(line);
            }
        } catch (error) {
            return error?.message ?? String(error);
        }
        try {
            watch?.chat?.push?.({ t: nowOf(watch), name: nameOf(agent), text: line });
        } catch (error) {
            warn('could not keep the relayed line', error);
        }
        try {
            const voice = typeof settings?.supervisor_voice === 'string' ? settings.supervisor_voice : '';
            output(SUPERVISOR_OUTPUT, supervisorOutput({ name: boss, kind, text: line.slice(`[${boss}] `.length), by: nameOf(agent), voice }));
        } catch (error) {
            warn('could not show the line on the page', error);
        }
        return null;
    };

    const stopTimer = () => {
        if (timer)
            clearInterval(timer);
        timer = null;
    };
    const startTimer = () => {
        if (timer)
            return;
        timer = setInterval(tick, tickMs);
        timer.unref?.();
    };

    /** Relays or drops the held lines whose time has come: the answers first, then the updates. */
    function tick() {
        const now = nowOf(watch);
        const boss = supervisorName(settingsOf(watch));
        const step = holdStep(held, { now, ownerLineAt: ownerLineAt(), botLineAt: botLineAt(boss) });
        held = step.keep;
        for (const h of step.drop)
            h.resolve(SUPERVISOR_TEXTS.dropped);
        for (const h of step.relay) {
            const cause = relay(h.line, h.kind, boss);
            if (cause !== null) {
                h.resolve(SUPERVISOR_TEXTS.relayFailed(cause));
                continue;
            }
            const waited = Math.round((now - h.queuedAt) / 1000);
            h.resolve(waited >= 1 ? SUPERVISOR_TEXTS.relayedAfter(h.line, waited) : SUPERVISOR_TEXTS.relayed(h.line));
        }
        if (held.length === 0)
            stopTimer();
    }

    return {
        /**
         * The tool reply: the line of the supervisor into the chat, after the hold rule. Answers when the line was
         * relayed or dropped (at most 20 s after the call, and one tick).
         * @param {{text: string, kind?: string}} args
         * @returns {Promise<string>}
         */
        reply(args = {}) {
            const settings = settingsOf(watch);
            const boss = supervisorName(settings);
            if (boss === '')
                return Promise.resolve(SUPERVISOR_TEXTS.noName);
            const refusal = replyRefusal(args);
            if (refusal)
                return Promise.resolve(refusal);
            const kind = kindOf(args?.kind) ?? 'answer';
            if (kind === 'update' && settings?.supervisor_updates !== true)
                return Promise.resolve(SUPERVISOR_TEXTS.updatesOff);
            const line = relayLine(boss, args.text);
            return new Promise((resolve) => {
                held.push({ line, kind, queuedAt: nowOf(watch), resolve });
                tick();
                if (held.length > 0)
                    startTimer();
            });
        },

        /**
         * The tool note: one line in the prompt for N minutes (agent.supervisor_note); '' clears it.
         * @param {{text: string, minutes?: number}} args
         * @returns {string}
         */
        note(args = {}) {
            const boss = supervisorName(settingsOf(watch));
            if (boss === '')
                return SUPERVISOR_TEXTS.noName;
            const refusal = noteRefusal(args);
            if (refusal)
                return refusal;
            const note = noteOf(args.text, args.minutes, nowOf(watch));
            try {
                agent.supervisor_note = note;
            } catch (error) {
                return SUPERVISOR_TEXTS.relayFailed(error?.message ?? String(error));
            }
            return note ? SUPERVISOR_TEXTS.noted(note.minutes, note.text) : SUPERVISOR_TEXTS.noteCleared;
        },

        /** The held lines (tests): [{ line, kind, queuedAt }]. */
        pending() {
            return held.map((h) => ({ line: h.line, kind: h.kind, queuedAt: h.queuedAt }));
        },

        tick,

        /** Ends the held lines (the server closes) and the timer. */
        close() {
            for (const h of held.splice(0))
                h.resolve(SUPERVISOR_TEXTS.relayFailed('the watch server closed'));
            stopTimer();
        },
    };
}

/** The supervisor of a watch state, made when it is missing (watch.supervisor). */
export function ensureSupervisor(agent, watch, options = {}) {
    if (!watch || typeof watch !== 'object')
        return createSupervisor(agent, watch, options);
    if (!watch.supervisor)
        watch.supervisor = createSupervisor(agent, watch, options);
    return watch.supervisor;
}

// The owner's other bots (settings.other_bots) that are in the game now, as the bot sees the players.
function peersOnline(agent, settings) {
    try {
        const players = Object.keys(agent?.bot?.players ?? {}).map((n) => n.toLowerCase());
        const own = nameOf(agent).toLowerCase();
        return names(settings?.other_bots).filter((n) => n.toLowerCase() !== own && players.includes(n.toLowerCase()));
    } catch {
        return [];
    }
}

/**
 * A line of a player for the supervisor (the drop branch of respondFunc, `addressed_supervisor`): the event of
 * kind message into the ring of the watch server, and `The supervisor is not here.` from one bot when no supervisor
 * is connected (speaksForAll: the first agent of the mindserver; of bots in their own processes the one that runs
 * the watch server). Never throws.
 * @param {object} agent agent.watch: the result of startWatchServer ({ push, watch }), or null
 * @param {string} from the player
 * @param {string} text the line
 * @param {{agents?: string[], settings?: object}} [options] agents: the agents in the game, in the order of the
 *   mindserver; settings: the settings when the agent runs no watch server (tests)
 * @returns {{ok: boolean, reason: string|null, text: string, event: object|null, said: boolean}}
 */
export function supervisorMessage(agent, from, text, options = {}) {
    const watch = agent?.watch?.watch ?? null;
    const push = typeof agent?.watch?.push === 'function' ? agent.watch.push : null;
    try {
        const settings = options?.settings ?? settingsOf(watch);
        const name = supervisorName(settings);
        if (name === '')
            return { ok: false, reason: 'no_name', text: '', event: null, said: false };
        const now = nowOf(watch);
        const event = messageEvent(text, from, name, now);
        if (!event)
            return { ok: false, reason: 'not_addressed', text: '', event: null, said: false };
        if (push) {
            try {
                push(event);
            } catch (error) {
                warn('could not keep the message', error);
            }
        }
        if (watch && supervisorPresent(watch, now))
            return { ok: true, reason: null, text: '', event, said: false };
        const facts = { hostsWatch: Boolean(watch && push), peersOnline: peersOnline(agent, settings) };
        if (!speaksForAll(nameOf(agent), options?.agents, facts))
            return { ok: true, reason: 'another_speaks', text: '', event, said: false };
        try {
            Promise.resolve(agent.openChat(SUPERVISOR_TEXTS.notHere)).catch((error) => warn('could not say that nobody is here', error));
        } catch (error) {
            warn('could not say that nobody is here', error);
            return { ok: false, reason: 'not_said', text: SUPERVISOR_TEXTS.notHere, event, said: false };
        }
        return { ok: true, reason: 'not_here', text: SUPERVISOR_TEXTS.notHere, event, said: true };
    } catch (error) {
        warn('the line was not handled', error);
        return { ok: false, reason: 'error', text: '', event: null, said: false };
    }
}

/** The tools of the supervisor, for registerTool of tools.js: { name, schema, handler }. */
export const SUPERVISOR_TOOLS = Object.freeze([
    {
        name: 'reply',
        schema: {
            description: 'Your line into the game chat, said by the bot as [<supervisor_name>] <text>; no bot answers it. kind answer (the default): an answer to a line that named you. kind update: a short unasked line when something happened (only with supervisor_updates on, else "Updates are off."). The line waits while a bot is answering the owner; an update held over 20 s is dropped. Answers when the line was said or dropped.',
            inputSchema: {
                type: 'object',
                properties: {
                    text: { type: 'string', minLength: 1, maxLength: 256, description: 'The line, 1 to 256 characters.' },
                    kind: { type: 'string', enum: ['answer', 'update'], default: 'answer', description: 'answer or update.' },
                },
                required: ['text'],
                additionalProperties: false,
            },
            refusal: replyRefusal,
        },
        handler: async (agent, args = {}, watch = {}) => ensureSupervisor(agent, watch).reply(args),
    },
    {
        name: 'note',
        schema: {
            description: 'One line from you in the bot\'s prompt for N minutes, as "Supervisor: <text>": a fact, not an order. One note at a time, the newer replaces the older; an empty text clears it.',
            inputSchema: {
                type: 'object',
                properties: {
                    text: { type: 'string', maxLength: 200, description: 'The note, at most 200 characters; empty clears it.' },
                    minutes: { type: 'integer', minimum: 1, maximum: 120, default: 30, description: 'How long it stands, 1 to 120 minutes.' },
                },
                required: ['text'],
                additionalProperties: false,
            },
            refusal: noteRefusal,
        },
        handler: async (agent, args = {}, watch = {}) => ensureSupervisor(agent, watch).note(args),
    },
].map((tool) => Object.freeze(tool)));

/**
 * Registers reply and note with registerTool of tools.js, only when settings.supervisor_name is set (spec 2: an
 * empty name means no supervisor; tools/list stays the one of part S). Returns the number registered.
 * @param {(name: string, schema: object, handler: Function) => boolean} register
 * @param {object} settings
 */
export function registerSupervisorTools(register, settings) {
    if (typeof register !== 'function' || supervisorName(settings) === '')
        return 0;
    let n = 0;
    for (const tool of SUPERVISOR_TOOLS) {
        try {
            if (register(tool.name, tool.schema, tool.handler))
                n++;
        } catch (error) {
            warn(`could not register the tool ${tool.name}`, error);
        }
    }
    return n;
}
