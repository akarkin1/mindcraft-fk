// v0.1.4.13 (part N2): the pure parts of the supervisor in the chat (spec 4.5). The facts and the clock come in,
// a decision, a text or an event goes out; supervisor.js is the glue over the bot and the watch server. Nothing
// here throws. The texts of 4.5 are here word for word (SUPERVISOR_TEXTS); texts.js stays part S's.
import { makeEvent } from './events_logic.js';
import { MEMORY_MARKER, ROLE_ANCHOR, addressedTo, roleLine } from '../bots_logic.js';

export const SUPERVISOR_RULES = Object.freeze({
    replyMax: 256,         // characters of a reply
    noteMax: 200,          // characters of a note
    minutesDefault: 30,    // a note stands this long ...
    minutesMin: 1,
    minutesMax: 120,       // ... at most
    presenceMs: 60000,     // a supervisor is connected after a wait or digest call within this time (part S)
    answerWaitMs: 10000,   // a supervisor's line waits while the owner's last line has no bot answer yet, up to this
    afterBotLineMs: 3000,  // and this long after a bot line (HANDOFF, W111: nobody speaks over anybody)
    dropAfterMs: 20000,    // an update held longer is dropped; an answer is relayed anyway
    tickMs: 250,           // the held lines are checked this often
});

export const SUPERVISOR_KINDS = Object.freeze(['answer', 'update']);

export const SUPERVISOR_TEXTS = Object.freeze({
    // spec 4.5, word for word
    notHere: 'The supervisor is not here.',
    message: (text) => `Message: "${text}"`,
    updatesOff: 'Updates are off.',
    dropped: 'Dropped: the bot was speaking.',
    noted: (minutes, text) => `Noted for ${minutes} min: "${text}".`,
    supervisorLine: (text) => `Supervisor: ${text}`,
    relay: (name, text) => `[${name}] ${text}`,

    // decided by E5: the answers of reply and note beyond the spec, and the refusals
    relayed: (line) => `Relayed: "${line}".`,
    relayedAfter: (line, seconds) => `Relayed after ${seconds} s: "${line}".`,
    relayFailed: (cause) => `The line was not said: ${cause}.`,
    noteCleared: 'The note is cleared.',
    noName: 'No supervisor_name is set.',
    badReply: 'reply takes a text of 1 to 256 characters.',
    badKind: (value) => `reply takes kind: answer or update, not "${value}".`,
    badNote: 'note takes a text of at most 200 characters.',
    badMinutes: (value) => `note takes minutes of 1 to 120, not "${value}".`,
});

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

/** The name of the supervisor of the settings, '' without one. */
export function supervisorName(settings) {
    const name = settings?.supervisor_name;
    return typeof name === 'string' ? name.trim() : '';
}

/**
 * True when a supervisor is connected: a wait or digest call (watch.presence.seenAt) within presenceMs, or a wait
 * that is still open (a wait of 55 s started 50 s ago is a supervisor that listens).
 * @param {number|null|undefined} seenAt ms of the last call
 * @param {number} now ms
 * @param {number} [presenceMs]
 * @param {number} [openWaits] the waits open now (watch.waits.size)
 */
export function isConnected(seenAt, now, presenceMs = SUPERVISOR_RULES.presenceMs, openWaits = 0) {
    if (isFiniteNumber(openWaits) && openWaits > 0)
        return true;
    return isFiniteNumber(seenAt) && isFiniteNumber(now) && now - seenAt <= presenceMs;
}

/**
 * The words of a line for the supervisor: the line without the address ("Opus, where is it?" gives "where is
 * it?"); the whole line when it is the address alone ("Opus?"); null when the line does not address the name.
 * @param {string} line
 * @param {string} name the supervisor's name
 * @returns {string|null}
 */
export function messageText(line, name) {
    const boss = typeof name === 'string' ? name.trim() : '';
    if (boss === '')
        return null;
    const address = addressedTo(line, [boss]);
    if (!address)
        return null;
    const rest = address.rest.replace(/\s+/g, ' ').trim();
    return rest === '' ? String(line).replace(/\s+/g, ' ').trim() : rest;
}

/**
 * The event of kind message for a line of a player that addresses the supervisor: `Message: "where is it?"` with
 * data.from and data.text; null when the line is not for the supervisor or there is no supervisor.
 * @param {string} line the chat line
 * @param {string} from the player
 * @param {string} name settings.supervisor_name
 * @param {number} [now] ms
 */
export function messageEvent(line, from, name, now = Date.now()) {
    const text = messageText(line, name);
    if (text === null)
        return null;
    return makeEvent('message', SUPERVISOR_TEXTS.message(text), { from: typeof from === 'string' ? from : '', text }, now);
}

/**
 * Whether this bot is the one that speaks for all when nobody is connected, so two bots do not both say `The
 * supervisor is not here.`: with two agents or more on its mindserver, the first of them in the game (spec 4.5).
 * Bots of the owner in their own processes (each with its own mindserver, settings.other_bots online in the game)
 * cannot see that list: then the bot that runs the watch server speaks and one without a watch server stays quiet,
 * since the supervisor may be connected to the other one (decided by E5). Alone it speaks.
 * @param {string} self the own name
 * @param {string[]} agents the agents in the game, in the order of the mindserver
 * @param {{hostsWatch?: boolean, peersOnline?: string[]}} [facts] hostsWatch: this bot's watch server runs;
 *   peersOnline: the owner's other bots that are in the game
 */
export function speaksForAll(self, agents, { hostsWatch = true, peersOnline = [] } = {}) {
    const list = (Array.isArray(agents) ? agents : []).filter((n) => typeof n === 'string' && n !== '');
    if (list.length > 1 && list.includes(self))
        return list[0] === self;
    const peers = (Array.isArray(peersOnline) ? peersOnline : []).filter((n) => typeof n === 'string' && n !== '' && n !== self);
    if (peers.length > 0)
        return hostsWatch === true;
    return true;
}

/** The kind of a reply: `answer` (the default) or `update`; null for anything else. */
export function kindOf(value) {
    if (value === undefined || value === null || value === '')
        return 'answer';
    return typeof value === 'string' && SUPERVISOR_KINDS.includes(value.trim()) ? value.trim() : null;
}

/** The line the bot relays: `[Opus] It is in the tunnel.` */
export function relayLine(name, text) {
    return SUPERVISOR_TEXTS.relay(String(name ?? '').trim(), String(text ?? '').replace(/\s+/g, ' ').trim());
}

/** True for a relayed line of the supervisor (`[Opus] ...`), which no bot answers and no bot said. */
export function isRelayedLine(text, name) {
    const boss = typeof name === 'string' ? name.trim() : '';
    return boss !== '' && typeof text === 'string' && text.startsWith(`[${boss}] `);
}

/**
 * Nobody speaks over anybody (HANDOFF round 1, W111): what to do with a held line of the supervisor at `now`.
 * `hold` while the owner's last line has no bot answer yet (up to answerWaitMs after it) and for afterBotLineMs
 * after a bot line; `drop` for an update held longer than dropAfterMs; an answer held that long is relayed anyway
 * (the supervisor was asked); else `relay`.
 * @param {{now: number, kind: 'answer'|'update', queuedAt: number, ownerLineAt: number|null, botLineAt: number|null}} facts
 *   ownerLineAt: the last line of a player that reached the bot; botLineAt: the last line a bot said (not a
 *   relayed line); null when there was none
 * @param {object} [rules] SUPERVISOR_RULES
 * @returns {'relay'|'hold'|'drop'}
 */
export function holdDecision({ now, kind, queuedAt, ownerLineAt = null, botLineAt = null } = {}, rules = SUPERVISOR_RULES) {
    if (!isFiniteNumber(now))
        return 'relay';
    const waited = isFiniteNumber(queuedAt) ? now - queuedAt : 0;
    if (waited > rules.dropAfterMs)
        return kind === 'update' ? 'drop' : 'relay';
    const owner = isFiniteNumber(ownerLineAt) ? ownerLineAt : null;
    const bot = isFiniteNumber(botLineAt) ? botLineAt : null;
    const unanswered = owner !== null && (bot === null || bot < owner) && now - owner < rules.answerWaitMs;
    if (unanswered)
        return 'hold';
    if (bot !== null && now - bot < rules.afterBotLineMs)
        return 'hold';
    return 'relay';
}

/**
 * The held lines at `now`, in the order they go: what is relayed (the answers first, then the updates, each by the
 * time they came), what is dropped (an update held over dropAfterMs) and what stays held. The hold is the same for
 * every line (holdDecision); only the drop is per line.
 * @param {{kind: 'answer'|'update', queuedAt: number}[]} held
 * @param {{now: number, ownerLineAt?: number|null, botLineAt?: number|null}} facts
 * @param {object} [rules] SUPERVISOR_RULES
 * @returns {{relay: object[], drop: object[], keep: object[]}} the entries of `held` themselves
 */
export function holdStep(held, { now, ownerLineAt = null, botLineAt = null } = {}, rules = SUPERVISOR_RULES) {
    const out = { relay: [], drop: [], keep: [] };
    const list = (Array.isArray(held) ? held : []).filter((h) => h !== null && typeof h === 'object');
    const rank = (h) => (h.kind === 'update' ? 1 : 0);
    const at = (h) => (isFiniteNumber(h.queuedAt) ? h.queuedAt : 0);
    const ordered = list.map((h, i) => ({ h, i })).sort((a, b) => (rank(a.h) - rank(b.h)) || (at(a.h) - at(b.h)) || (a.i - b.i));
    for (const { h } of ordered) {
        const decision = holdDecision({ now, kind: h.kind, queuedAt: h.queuedAt, ownerLineAt, botLineAt }, rules);
        out[decision === 'hold' ? 'keep' : decision].push(h);
    }
    return out;
}

/** The refusal of the arguments of reply, or null: a text of 1 to 256 characters, a kind of answer or update. */
export function replyRefusal(args = {}) {
    const text = args?.text;
    if (typeof text !== 'string' || text.trim() === '' || text.length > SUPERVISOR_RULES.replyMax)
        return SUPERVISOR_TEXTS.badReply;
    if (kindOf(args?.kind) === null)
        return SUPERVISOR_TEXTS.badKind(String(args.kind));
    return null;
}

/** The minutes of a note: the default without a value, an integer 1 to 120 (also as a string), else null. */
export function noteMinutes(value) {
    if (value === undefined || value === null || value === '')
        return SUPERVISOR_RULES.minutesDefault;
    const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
    if (!Number.isInteger(n) || n < SUPERVISOR_RULES.minutesMin || n > SUPERVISOR_RULES.minutesMax)
        return null;
    return n;
}

/** The refusal of the arguments of note, or null: a text of at most 200 characters ('' clears), minutes 1 to 120. */
export function noteRefusal(args = {}) {
    const text = args?.text;
    if (typeof text !== 'string' || text.length > SUPERVISOR_RULES.noteMax)
        return SUPERVISOR_TEXTS.badNote;
    if (noteMinutes(args?.minutes) === null)
        return SUPERVISOR_TEXTS.badMinutes(String(args.minutes));
    return null;
}

/**
 * A note of the supervisor: { text, minutes, at, until }; null for an empty text (the note is cleared).
 * @param {string} text at most 200 characters
 * @param {number} [minutes] 1 to 120, default 30
 * @param {number} [now] ms
 */
export function noteOf(text, minutes, now = Date.now()) {
    const clean = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
    if (clean === '')
        return null;
    const stands = noteMinutes(minutes) ?? SUPERVISOR_RULES.minutesDefault;
    const at = isFiniteNumber(now) ? now : Date.now();
    return { text: clean, minutes: stands, at, until: at + stands * 60000 };
}

/**
 * The line of the prompt for a note: `Supervisor: the chest at (15, -59, -99) has bread.`; '' without a note or
 * when it expired (`until` passed).
 * @param {{text: string, until: number}|null} note
 * @param {number} [now] ms
 */
export function noteText(note, now = Date.now()) {
    if (!note || typeof note !== 'object' || typeof note.text !== 'string' || note.text.trim() === '')
        return '';
    if (isFiniteNumber(note.until) && isFiniteNumber(now) && now >= note.until)
        return '';
    return SUPERVISOR_TEXTS.supervisorLine(note.text.trim());
}

function afterLine(prompt, start, line) {
    const end = prompt.indexOf('\n', start);
    if (end < 0)
        return `${prompt}\n${line}`;
    return prompt.slice(0, end) + '\n' + line + prompt.slice(end);
}

/**
 * The conversing prompt with the note line: on its own line right after the role line of v0.1.4.12 (D3), or where
 * the role line would be (after the line that starts with "A rule about a place names ", else before "Summarized
 * memory:", else nowhere). An empty line, or the line there already: the prompt unchanged.
 * @param {string} prompt
 * @param {string} line noteText(...)
 * @param {string} [role] settings.bot_role, to find the role line
 */
export function insertNoteLine(prompt, line, role = '') {
    if (typeof prompt !== 'string' || typeof line !== 'string' || line === '' || prompt.includes(line))
        return prompt;
    const roleText = roleLine(role);
    if (roleText) {
        const at = prompt.startsWith(roleText) ? 0 : prompt.indexOf('\n' + roleText);
        if (at >= 0)
            return afterLine(prompt, at + (at === 0 ? 0 : 1), line);
    }
    const anchor = prompt.startsWith(ROLE_ANCHOR) ? 0 : prompt.indexOf('\n' + ROLE_ANCHOR);
    if (anchor >= 0)
        return afterLine(prompt, anchor + (anchor === 0 ? 0 : 1), line);
    const memory = prompt.startsWith(MEMORY_MARKER) ? 0 : prompt.indexOf('\n' + MEMORY_MARKER);
    if (memory < 0)
        return prompt;
    if (memory === 0)
        return `${line}\n${prompt}`;
    return prompt.slice(0, memory) + '\n' + line + prompt.slice(memory);
}
