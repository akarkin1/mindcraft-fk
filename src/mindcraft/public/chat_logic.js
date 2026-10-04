// The chat of the page (v0.1.4.13, voice_ui): which lines are spoken, how a line is shown, who the owner is.
// Pure, no DOM and no Node: the page loads it as a module and the voice of the mindserver imports it.
// v0.1.4.13 (part N2, spec 4.5): the lines of the supervisor on the way to the page (SUPERVISOR_OUTPUT, a JSON line
// down bot-output, made by src/agent/watch/supervisor.js); the chat of every bot and the supervisor, each line with
// its name in front; where a line of the owner goes ("everyone" in the dropdown, the chosen bot's name in front);
// the one speech queue (a bot's answer, the supervisor's answer, its update; an update that waited over 20 s is not
// spoken); the voice of each speaker.

/**
 * The name of a bot-output that carries a line of the supervisor (never a line of a bot: no Minecraft name starts
 * with "@"). Its message is the JSON of supervisorOutput.
 */
export const SUPERVISOR_OUTPUT = '@supervisor';
/** The value of the dropdown of the page for every bot in the game at once. */
export const EVERYONE = '*';

/** A command echo of a bot: `*MartyByrde2 used stop*` (the same as COMMAND_ECHO of src/agent/bots_logic.js). */
export const COMMAND_ECHO = /^\*\S+ used \S+\*$/;
/** A result of a bot that a bot says in the chat (the same as BOT_RESULT of src/agent/bots_logic.js). */
export const BOT_RESULT = /^(Action output:|Found (non-)?destructive path\.|You have reached)/;
// A command inside a line: `!collectBlocks("oak_log", 10)` after a space, a stop or the start.
const COMMAND_INSIDE = /(^|[\s.,;:!?])!\w+/;

const clean = (line) => String(line ?? '').replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').trim();

/**
 * How the page shows a line of the bot: 'command' (a command, its echo or a result: small, not spoken) or 'say'.
 * @param {string} line
 * @returns {'command'|'say'}
 */
export function lineKind(line) {
    const text = clean(line);
    if (text.startsWith('!') || text.startsWith('*') || COMMAND_ECHO.test(text) || BOT_RESULT.test(text))
        return 'command';
    return 'say';
}

/**
 * The words of a line of the bot that the voice speaks: '' for a command, its echo or a result; the part before a
 * command inside the line; no markdown signs. '' when nothing is left to say.
 * @param {string} line
 * @returns {string}
 */
export function speechText(line) {
    const text = clean(line);
    if (!text || lineKind(text) === 'command')
        return '';
    const m = COMMAND_INSIDE.exec(text);
    const said = (m ? text.slice(0, m.index + m[1].length) : text)
        .replace(/[`*_#>|~]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return /[\p{L}\p{N}]/u.test(said) ? said : '';
}

/**
 * The name the page speaks as: the first name of only_chat_with (the bot answers only them), else the stored name.
 * null: the page asks the owner once.
 * @param {string[]} onlyChatWith
 * @param {string|null} stored
 * @returns {string|null}
 */
export function speakerName(onlyChatWith, stored) {
    const first = (Array.isArray(onlyChatWith) ? onlyChatWith : [])
        .find((n) => typeof n === 'string' && n.trim() !== '');
    if (first)
        return first.trim();
    const name = typeof stored === 'string' ? stored.trim() : '';
    return name || null;
}

// ---- v0.1.4.13 (part N2): the supervisor on the page, everyone, the speech queue, the voices ----

const VOICE_ID = /^(supertonic|kokoro):\S+$/;
const KINDS = ['answer', 'update'];

/** The voice of the supervisor without a valid supervisor_voice (its default in settings.js). */
export const SUPERVISOR_VOICE = 'supertonic:M1';
/** The voice of a bot without a valid voice_voice (the default of voice_voice). */
export const BOT_VOICE = 'supertonic:F1';
/** The one speech queue of the page (spec 4.5): an update that waited longer is not spoken. */
export const SPEECH_RULES = Object.freeze({ updateMaxWaitMs: 20000 });
/** The order of the one speech queue: a bot's line (its answer to the owner), the supervisor's answer, its update. */
export const SPEECH_ORDER = Object.freeze(['bot', 'answer', 'update']);
/** The words before a name that still make an address (ADDRESS_WORDS of src/agent/bots_logic.js). */
export const ADDRESS_WORDS = Object.freeze(['hey', 'hi', 'ok', 'okay', 'so', 'now', 'please', 'and']);

const words = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const nameList = (list) => (Array.isArray(list) ? list : []).filter((n) => typeof n === 'string' && n.trim() !== '').map((n) => n.trim());
const validVoice = (voice) => (typeof voice === 'string' && VOICE_ID.test(voice.trim()) ? voice.trim() : null);
const sameName = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/**
 * The message of a bot-output of SUPERVISOR_OUTPUT: the line of the supervisor as the bot relayed it.
 * @param {{name: string, kind: 'answer'|'update', text: string, by: string, voice?: string}} line name: the
 *   supervisor's name; by: the bot that relayed it; voice: supervisor_voice of that bot
 * @returns {string} JSON
 */
export function supervisorOutput({ name, kind, text, by, voice } = {}) {
    return JSON.stringify({
        name: String(name ?? '').trim(),
        kind: KINDS.includes(kind) ? kind : 'answer',
        text: String(text ?? '').trim(),
        by: String(by ?? '').trim(),
        voice: validVoice(voice),
    });
}

/**
 * The line of the supervisor of a bot-output, or null for a line of a bot, of the system, or a message that is not
 * one of supervisorOutput.
 * @param {string} agentName the first argument of bot-output
 * @param {string} message the second
 * @returns {{name: string, kind: 'answer'|'update', text: string, by: string, voice: string|null}|null}
 */
export function parseSupervisorOutput(agentName, message) {
    if (agentName !== SUPERVISOR_OUTPUT || typeof message !== 'string')
        return null;
    try {
        const line = JSON.parse(message);
        if (!line || typeof line !== 'object' || typeof line.name !== 'string' || typeof line.text !== 'string')
            return null;
        const name = line.name.trim();
        const text = line.text.trim();
        if (name === '' || text === '')
            return null;
        return {
            name, text,
            kind: KINDS.includes(line.kind) ? line.kind : 'answer',
            by: typeof line.by === 'string' ? line.by.trim() : '',
            voice: validVoice(line.voice),
        };
    } catch {
        return null;
    }
}

/**
 * The entry of the page's chat for a bot-output: every bot's line and the supervisor's, each with its speaker.
 * A bot line that starts with `[<supervisor>] ` is the supervisor's (spec 4.5), an answer.
 * @param {string} agentName the first argument of bot-output
 * @param {string} message the second
 * @param {string} [supervisor] supervisor_name, to know a relayed line that came as a bot line
 * @returns {{speaker: string|null, kind: 'bot'|'command'|'supervisor'|'note', text: string, sub?: 'answer'|'update',
 *   by?: string, voice?: string|null}|null} null for a supervisor's output that cannot be read
 */
export function chatEntry(agentName, message, supervisor = '') {
    if (agentName === SUPERVISOR_OUTPUT) {
        const line = parseSupervisorOutput(agentName, message);
        return line ? { speaker: line.name, kind: 'supervisor', text: line.text, sub: line.kind, by: line.by, voice: line.voice } : null;
    }
    const text = String(message ?? '');
    if (agentName === 'system' || typeof agentName !== 'string' || agentName === '')
        return { speaker: null, kind: 'note', text };
    const boss = typeof supervisor === 'string' ? supervisor.trim() : '';
    if (boss !== '' && text.startsWith(`[${boss}] `))
        return { speaker: boss, kind: 'supervisor', text: text.slice(boss.length + 3).trim(), sub: 'answer', by: agentName, voice: null };
    return { speaker: agentName, kind: lineKind(text) === 'command' ? 'command' : 'bot', text };
}

/**
 * A chat entry as one line with the name in front: `claude: I am here.`, `[Opus] It is in the tunnel.`; a command
 * and a note as they are.
 * @param {{speaker: string|null, kind: string, text: string}} entry
 * @returns {string}
 */
export function shownLine(entry) {
    const text = String(entry?.text ?? '');
    if (entry?.kind === 'supervisor' && entry.speaker)
        return `[${entry.speaker}] ${text}`;
    if (entry?.kind === 'bot' && entry.speaker)
        return `${entry.speaker}: ${text}`;
    return text;
}

/**
 * The name a line of the owner starts with, as addressedTo of src/agent/bots_logic.js decides it (the page cannot
 * import it): the first word, without `,` `:` `!` `?` `.` and compared without case, or one of the first three
 * words after hey, hi, ok, okay, so, now, please, and; two names joined by "and" are no address.
 * @param {string} text
 * @param {string[]} names
 * @returns {{name: string, rest: string}|null}
 */
export function addressOf(text, names) {
    const line = String(text ?? '').trim();
    const known = nameList(names);
    if (line === '' || known.length === 0)
        return null;
    const list = line.split(/\s+/);
    const bare = (word) => word.replace(/[,:!?.]+$/, '');
    const nameIn = (word) => {
        const w = bare(word).toLowerCase();
        return w === '' ? null : (known.find((n) => n.toLowerCase() === w) ?? null);
    };
    for (let i = 0; i < Math.min(3, list.length); i++) {
        const name = nameIn(list[i]);
        if (name === null) {
            if (ADDRESS_WORDS.includes(bare(list[i]).toLowerCase()))
                continue;
            return null;
        }
        if (i + 2 < list.length && bare(list[i + 1]).toLowerCase() === 'and' && nameIn(list[i + 2]) !== null)
            return null;
        let end = 0;
        for (let k = 0; k <= i; k++)
            end = line.indexOf(list[k], end) + list[k].length;
        return { name, rest: line.slice(end).replace(/^\s+/, '') };
    }
    return null;
}

// "claude and gpt, come here": the bots it names, when its first words are two names joined by "and"
function twoNames(text, bots) {
    const list = words(text).split(' ');
    if (list.length < 3 || list[1].replace(/[,:!?.]+$/, '').toLowerCase() !== 'and')
        return null;
    const first = bots.find((n) => sameName(n, list[0].replace(/[,:!?.]+$/, '')));
    const second = bots.find((n) => sameName(n, list[2].replace(/[,:!?.]+$/, '')));
    return first && second && first !== second ? [first, second] : null;
}

/**
 * Where a line of the owner goes from the page (typed, or recognised speech), and how it reads (spec 4.5): with a
 * bot chosen in the dropdown, to that bot with its name in front (`claude, come here`), so the same names apply as
 * in the game chat; with EVERYONE, to every bot in the game, plain. A line that already names someone goes as it
 * is: to the bot it names (or the two it names), and a line for the supervisor to the chosen bot (EVERYONE: to
 * every bot), which hands it to the supervisor.
 * @param {{selected: string|null, text: string, agents: {name: string, in_game: boolean}[], supervisor?: string}} line
 * @returns {{ok: true, targets: string[], message: string}|{ok: false, reason: string, text: string}}
 */
export function routeLine({ selected, text, agents, supervisor = '' } = {}) {
    const message = words(text);
    if (message === '')
        return { ok: false, reason: 'empty', text: 'Heard nothing clear.' };
    const all = (Array.isArray(agents) ? agents : []).filter((a) => a && typeof a.name === 'string' && a.name !== '');
    const inGame = all.filter((a) => a.in_game === true).map((a) => a.name);
    if (typeof selected !== 'string' || selected === '')
        return { ok: false, reason: 'no_agent', text: 'No bot is chosen.' };
    const notInGame = (name) => ({ ok: false, reason: 'not_in_game', text: `${name} is not in the game.` });
    const chosen = () => {
        if (selected === EVERYONE)
            return inGame.length > 0 ? inGame : null;
        return inGame.includes(selected) ? [selected] : null;
    };
    const boss = typeof supervisor === 'string' ? supervisor.trim() : '';
    const pair = twoNames(message, all.map((a) => a.name));
    if (pair) {
        const missing = pair.find((n) => !inGame.includes(n));
        return missing ? notInGame(missing) : { ok: true, targets: pair, message };
    }
    const address = addressOf(message, [...all.map((a) => a.name), boss]);
    if (address && boss !== '' && sameName(address.name, boss)) {
        const targets = chosen();
        if (!targets)
            return selected === EVERYONE ? { ok: false, reason: 'not_in_game', text: 'No bot is in the game.' } : notInGame(selected);
        return { ok: true, targets, message };
    }
    if (address)
        return inGame.includes(address.name) ? { ok: true, targets: [address.name], message } : notInGame(address.name);
    if (selected === EVERYONE)
        return inGame.length > 0 ? { ok: true, targets: inGame, message } : { ok: false, reason: 'not_in_game', text: 'No bot is in the game.' };
    if (!inGame.includes(selected))
        return notInGame(selected);
    return { ok: true, targets: [selected], message: `${selected}, ${message}` };
}

/**
 * The voice of a line: the supervisor's line in the voice it came with, else supervisor_voice, else
 * SUPERVISOR_VOICE; a bot's line in the bot's voice (`voices`, from its voice_voice or the page's choice for it),
 * else `fallback`, else BOT_VOICE.
 * @param {{speaker: string|null, kind: string, voice?: string|null}} entry a chat entry or a speech item
 * @param {{voices?: Object<string, string>, supervisorVoice?: string|null, fallback?: string|null}} [known]
 * @returns {string}
 */
export function voiceFor(entry, { voices = {}, supervisorVoice = null, fallback = null } = {}) {
    if (entry?.kind === 'supervisor' || entry?.kind === 'answer' || entry?.kind === 'update')
        return validVoice(entry?.voice) ?? validVoice(supervisorVoice) ?? SUPERVISOR_VOICE;
    const own = typeof entry?.speaker === 'string' ? voices?.[entry.speaker] : null;
    return validVoice(own) ?? validVoice(fallback) ?? BOT_VOICE;
}

/**
 * The item of the speech queue for a chat entry: { speaker, kind, text, voice, at, seq }, kind `bot` for a bot's
 * line, `answer` or `update` for the supervisor's; null for a command, a note or a line with nothing to say.
 * @param {object} entry chatEntry(...)
 * @param {{at: number, seq: number, voices?: object, supervisorVoice?: string|null, fallback?: string|null}} facts
 */
export function speechItem(entry, { at = 0, seq = 0, voices = {}, supervisorVoice = null, fallback = null } = {}) {
    if (!entry || (entry.kind !== 'bot' && entry.kind !== 'supervisor'))
        return null;
    const text = speechText(entry.text);
    if (text === '')
        return null;
    const kind = entry.kind === 'supervisor' ? (entry.sub === 'update' ? 'update' : 'answer') : 'bot';
    return { speaker: entry.speaker, kind, text, voice: voiceFor(entry, { voices, supervisorVoice, fallback }), at, seq };
}

/**
 * The one speech queue (spec 4.5): one line at a time, a bot's line first, then the supervisor's answer, then its
 * update, each kind in the order the lines came; an update that waited more than 20 s is not spoken.
 * @param {{kind: 'bot'|'answer'|'update', at: number, seq?: number}[]} queue the lines waiting
 * @param {number} now ms
 * @param {{updateMaxWaitMs: number}} [rules]
 * @returns {{next: object|null, rest: object[], dropped: object[]}} next: the line to speak now; rest: the lines
 *   that wait, in the order they will go; dropped: the updates that waited too long
 */
export function nextSpeech(queue, now, rules = SPEECH_RULES) {
    const list = (Array.isArray(queue) ? queue : []).filter((item) => item !== null && typeof item === 'object');
    const dropped = [];
    const live = [];
    for (const item of list) {
        const waited = Number.isFinite(now) && Number.isFinite(item.at) ? now - item.at : 0;
        if (item.kind === 'update' && waited > rules.updateMaxWaitMs)
            dropped.push(item);
        else
            live.push(item);
    }
    const rank = (item) => {
        const i = SPEECH_ORDER.indexOf(item.kind);
        return i < 0 ? SPEECH_ORDER.length : i;
    };
    const order = (item, i) => (Number.isFinite(item.seq) ? item.seq : (Number.isFinite(item.at) ? item.at : i));
    const sorted = live.map((item, i) => ({ item, i })).sort((a, b) => (rank(a.item) - rank(b.item))
        || (order(a.item, a.i) - order(b.item, b.i)) || (a.i - b.i)).map((x) => x.item);
    return { next: sorted[0] ?? null, rest: sorted.slice(1), dropped };
}

/**
 * The voice of every bot: the page's choice for it (`chosen`), else its voice_voice; only valid ids.
 * @param {{name: string}[]} agents
 * @param {Object<string, {voice_voice?: string}>} settingsByName
 * @param {Object<string, string>} [chosen] the voices picked on the page, per bot
 * @returns {Object<string, string>}
 */
export function voiceMap(agents, settingsByName, chosen = {}) {
    const out = {};
    for (const a of Array.isArray(agents) ? agents : []) {
        if (typeof a?.name !== 'string' || a.name === '')
            continue;
        const voice = validVoice(chosen?.[a.name]) ?? validVoice(settingsByName?.[a.name]?.voice_voice);
        if (voice)
            out[a.name] = voice;
    }
    return out;
}

/**
 * The supervisor as the page knows it: the name and the voice (supervisor_name, supervisor_voice) of the first
 * bot whose settings name one; the voice SUPERVISOR_VOICE when its setting is no valid id; null without a name.
 * @param {{name: string}[]} agents
 * @param {Object<string, {supervisor_name?: string, supervisor_voice?: string}>} settingsByName
 * @returns {{name: string, voice: string}|null}
 */
export function supervisorOf(agents, settingsByName) {
    for (const a of Array.isArray(agents) ? agents : []) {
        const s = settingsByName?.[a?.name];
        const name = typeof s?.supervisor_name === 'string' ? s.supervisor_name.trim() : '';
        if (name === '')
            continue;
        return { name, voice: validVoice(s.supervisor_voice) ?? SUPERVISOR_VOICE };
    }
    return null;
}
