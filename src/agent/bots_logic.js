// Two bots (spec v0.1.4.12, part D): which chat line the bot answers, and the role line of the prompt.
// Pure: no bot, no settings module; the callers hand the values in. Never throws.

/** A command echo of a bot: `*MartyByrde2 used stop*` (D1). */
export const COMMAND_ECHO = /^\*\S+ used \S+\*$/;
/** A result of a bot that a bot says in the chat (D1). */
export const BOT_RESULT = /^(Action output:|Found (non-)?destructive path\.|You have reached)/;
/** The placeholder of the role line in the conversing prompt of a profile (D3). */
export const ROLE_PLACEHOLDER = '$BOT_ROLE';
/** Where the role line goes in a conversing prompt without the placeholder: before the memory. */
const MEMORY_MARKER = '\nSummarized memory:';

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
 * The prompt with the placeholder $BOT_ROLE replaced (D3): by the role line, or, with an empty role, removed
 * with its line break, so the prompt is the one without a role. No replacement patterns: a `$` in the role
 * stays as it is.
 * @param {string} prompt
 * @param {string} role
 * @returns {string}
 */
export function withBotRole(prompt, role) {
    if (typeof prompt !== 'string' || !prompt.includes(ROLE_PLACEHOLDER))
        return prompt;
    const line = roleLine(role);
    if (!line)
        return prompt.split(ROLE_PLACEHOLDER + '\n').join('').split(ROLE_PLACEHOLDER).join('');
    return prompt.split(ROLE_PLACEHOLDER).join(line);
}

/**
 * For a conversing prompt without the placeholder (the default profile, an older profile of the owner): the
 * role line on its own line before "Summarized memory:" (after the two lines of W6 where a profile has them),
 * else as the first line. An empty role leaves the prompt as it is.
 * @param {string} prompt
 * @param {string} role
 * @returns {string}
 */
export function insertRoleLine(prompt, role) {
    const line = roleLine(role);
    if (typeof prompt !== 'string' || !line || prompt.includes(line))
        return prompt;
    const at = prompt.indexOf(MEMORY_MARKER);
    if (at < 0)
        return `${line}\n${prompt}`;
    return prompt.slice(0, at) + '\n' + line + prompt.slice(at);
}
