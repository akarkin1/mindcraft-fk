// The chat of the page (v0.1.4.13, voice_ui): which lines are spoken, how a line is shown, who the owner is.
// Pure, no DOM and no Node: the page loads it as a module and the voice of the mindserver imports it.

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
