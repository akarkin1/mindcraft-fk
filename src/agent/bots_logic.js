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

const nameList = (list) => (Array.isArray(list) ? list : []).filter((n) => typeof n === 'string' && n.trim() !== '');

/** The words before a name that still make an address (v0.1.4.13, N1): "hey claude, come", "ok so gpt wait". */
export const ADDRESS_WORDS = Object.freeze(['hey', 'hi', 'ok', 'okay', 'so', 'now', 'please', 'and']);
/** The punctuation stripped from the end of a word before it is compared with a name (N1). */
const WORD_END = /[,:!?.]+$/;
/** Blanks at the end of an address: the rest of the line starts after them. */
const ADDRESS_GAP = /^\s+/;

const stripEnd = (word) => word.replace(WORD_END, '');

/**
 * Which name of `names` a chat line addresses (spec v0.1.4.13, 4.2, part N1). A line addresses a name when its
 * first word, with trailing `,` `:` `!` `?` `.` stripped and compared without case, is that name, or when the
 * name is one of the first three words and every word before it is one of hey, hi, ok, okay, so, now, please,
 * and ("hey claude, come", "ok so gpt wait"). "claude and gpt, come here" addresses none: both come. A name
 * inside a sentence ("tell gpt to wait") is no address. Pure, never throws.
 * @param {string} text the chat line
 * @param {string[]} names the names that may be addressed (the own name, the other bots, the supervisor)
 * @returns {{name: string, rest: string}|null} the addressed name as it stands in `names`, and the line without
 *   the address ('' when the line is the address alone); null when no name is addressed
 */
export function addressedTo(text, names) {
    try {
        const line = String(text ?? '').trim();
        const known = nameList(names);
        if (line === '' || known.length === 0)
            return null;
        const words = line.split(/\s+/);
        const nameOf = (word) => {
            const bare = stripEnd(word).toLowerCase();
            return bare === '' ? null : (known.find((n) => n.toLowerCase() === bare) ?? null);
        };
        for (let i = 0; i < Math.min(3, words.length); i++) {
            const name = nameOf(words[i]);
            if (name === null) {
                if (ADDRESS_WORDS.includes(stripEnd(words[i]).toLowerCase()))
                    continue;
                return null;
            }
            // "claude and gpt, come here": two names addressed are no address
            if (i + 2 < words.length && stripEnd(words[i + 1]).toLowerCase() === 'and' && nameOf(words[i + 2]) !== null)
                return null;
            // the rest: the line after the words of the address, with the blanks after it gone
            let end = 0;
            for (let k = 0; k <= i; k++) {
                end = line.indexOf(words[k], end) + words[k].length;
            }
            return { name, rest: line.slice(end).replace(ADDRESS_GAP, '') };
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Whether the bot answers a chat line (D1; v0.1.4.13, N1: the address by name). The rows, first match wins:
 * from the bot itself (`self`), from one of `otherBots` (`other_bot`), a command echo, a result of a bot, a
 * sender outside `onlyChatWith` (`not_listened`); then the address (addressedTo over the own name, `otherBots`,
 * `names` and `supervisor`): another bot addressed (`addressed_other`, not answered), the supervisor addressed
 * (`addressed_supervisor`, not answered; part N2 makes it an event), the own name addressed (`addressed_self`,
 * answered, `text` the line without the address). A line without an address is answered, why null.
 * @param {{from: string, text: string, self: string, otherBots?: string[], onlyChatWith?: string[],
 *   names?: string[], supervisor?: string}} line
 *   names: more names that may be addressed (the other agents of the mindserver); supervisor: `settings.supervisor_name`
 * @returns {{answer: boolean, why: 'self'|'other_bot'|'command_echo'|'bot_result'|'not_listened'|'addressed_other'
 *   |'addressed_supervisor'|'addressed_self'|null, text?: string}}
 */
export function shouldAnswer({ from, text, self, otherBots = [], onlyChatWith = [], names = [], supervisor = '' } = {}) {
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
        const boss = typeof supervisor === 'string' ? supervisor.trim() : '';
        const own = typeof self === 'string' ? self : '';
        const address = addressedTo(line, [own, ...nameList(otherBots), ...nameList(names), boss]);
        if (address) {
            if (boss !== '' && address.name === boss && address.name !== own)
                return { answer: false, why: 'addressed_supervisor' };
            if (address.name !== own)
                return { answer: false, why: 'addressed_other' };
            return { answer: true, why: 'addressed_self', text: address.rest };
        }
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
