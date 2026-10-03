// Two bots (spec v0.1.4.12, part D): which chat line the bot answers, and the role line of the prompt.
// Pure: no bot, no settings module; the callers hand the values in. Never throws.

/** A command echo of a bot: `*MartyByrde2 used stop*` (D1). */
export const COMMAND_ECHO = /^\*\S+ used \S+\*$/;
/** A result of a bot that a bot says in the chat (D1). */
export const BOT_RESULT = /^(Action output:|Found (non-)?destructive path\.|You have reached)/;
/** The start of the W6 sentence of v0.1.4.11 in the conversing prompt; the role line follows its line (D3, DECISIONS F2). */
export const ROLE_ANCHOR = 'A rule about a place names ';
/** The fallback place of the role line: right before this line (DECISIONS F2b). */
export const MEMORY_MARKER = 'Summarized memory:';

const nameList = (list) => (Array.isArray(list) ? list : []).filter((n) => typeof n === 'string');

/**
 * Whether the bot answers a chat line (D1).
 * @param {{from: string, text: string, self: string, otherBots?: string[], onlyChatWith?: string[]}} line
 * @returns {{answer: boolean, why: 'self'|'other_bot'|'command_echo'|'bot_result'|'not_listened'|null}}
 */
export function shouldAnswer({ from, text, self, otherBots = [], onlyChatWith = [] } = {}) {
    try {
        if (from === self)
            return { answer: false, why: 'self' };
        const lower = String(from ?? '').toLowerCase();
        if (nameList(otherBots).some((n) => n.toLowerCase() === lower))
            return { answer: false, why: 'other_bot' };
        const line = String(text ?? '').trim();
        if (COMMAND_ECHO.test(line))
            return { answer: false, why: 'command_echo' };
        if (BOT_RESULT.test(line))
            return { answer: false, why: 'bot_result' };
        const listened = nameList(onlyChatWith);
        if (listened.length > 0 && !listened.includes(from))
            return { answer: false, why: 'not_listened' };
        return { answer: true, why: null };
    } catch {
        return { answer: true, why: null };
    }
}

/**
 * Whether a name is one of the owner's other bots (case-insensitive).
 * @param {string} name
 * @param {string[]} otherBots
 * @returns {boolean}
 */
export function isOtherBot(name, otherBots) {
    if (typeof name !== 'string')
        return false;
    const lower = name.toLowerCase();
    return nameList(otherBots).some((n) => n.toLowerCase() === lower);
}

/**
 * The role line of the prompt (D3): `${role} A question to all of us gets one line from you.`, '' for an
 * empty role or one that is not a string.
 * @param {string} role
 * @returns {string}
 */
export function roleLine(role) {
    const text = typeof role === 'string' ? role.trim() : '';
    return text ? `${text} A question to all of us gets one line from you.` : '';
}

/**
 * The conversing prompt with the role line (D3, DECISIONS F2 and F2b): on its own line right after the line that
 * starts with "A rule about a place names " (the second W6 line of v0.1.4.11); without that line, on its own line
 * right before "Summarized memory:"; without both, nothing. An empty role or the line there already: the prompt
 * unchanged, byte for byte.
 * @param {string} prompt
 * @param {string} role
 * @returns {string}
 */
export function insertRoleLine(prompt, role) {
    const line = roleLine(role);
    if (typeof prompt !== 'string' || !line || prompt.includes(line))
        return prompt;
    const at = prompt.startsWith(ROLE_ANCHOR) ? 0 : prompt.indexOf('\n' + ROLE_ANCHOR);
    if (at >= 0) {
        const end = prompt.indexOf('\n', at + 1);
        if (end < 0)
            return `${prompt}\n${line}`;
        return prompt.slice(0, end) + '\n' + line + prompt.slice(end);
    }
    const memory = prompt.startsWith(MEMORY_MARKER) ? 0 : prompt.indexOf('\n' + MEMORY_MARKER);
    if (memory < 0)
        return prompt;
    if (memory === 0)
        return `${line}\n${prompt}`;
    return prompt.slice(0, memory) + '\n' + line + prompt.slice(memory);
}
