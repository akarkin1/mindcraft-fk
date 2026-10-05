// v0.1.4.13 fix1: what of the bot's lines reaches the game chat. The play of 2026-10-05 had 811 lines of the bot
// in the owner's chat in under two hours: 236 echoes of the supervisor's commands, 155 results of them, 24 dumps of
// generated code; and three kicks (chat_validation_failed) while generated code called bot.chat in a row.
//   - Quiet: the commands of the supervisor (the run and say tools) run quiet; every line the bot would say for
//     them goes to the bot's log as `[quiet] ...`, never to the chat, the page or the voice.
//   - Code: generated code runs as code; its bot.chat and bot.whisper go to the code's output (what the coder
//     reads back), never to the server. A server command ('/...') still goes out.
//   - chatText: a code block is never said; `Agent wrote this code: ...` is left out of every line.
import { AsyncLocalStorage } from 'node:async_hooks';

const quietStore = new AsyncLocalStorage();
const codeStore = new AsyncLocalStorage();

/**
 * Runs fn quiet: what it awaits, its timers and promise chains included.
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function runQuiet(fn) {
    return quietStore.run(true, fn);
}

/** True inside runQuiet. */
export function isQuiet() {
    return quietStore.getStore() === true;
}

/**
 * Runs fn as generated code: bot.chat and bot.whisper inside it go to the code's output.
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function runAsCode(fn) {
    return codeStore.run(true, fn);
}

/** True inside runAsCode. */
export function inCode() {
    return codeStore.getStore() === true;
}

const CODE_SUMMARY = /Agent wrote this code:\s*```[\s\S]*?```\s*(Code Output:\s*)?/g;
const CODE_BLOCK = /```[\s\S]*?(```|$)/g;

/**
 * The text of a line for the chat: the code a code action wrote is left out (`Agent wrote this code: ```...```
 * Code Output:`), any other code block too; what is left is trimmed. Pure.
 * @param {*} message
 * @returns {string} '' when nothing is left to say
 */
export function chatText(message) {
    if (typeof message === 'number')
        message = String(message);
    if (typeof message !== 'string')
        return '';
    return message.replace(CODE_SUMMARY, '').replace(CODE_BLOCK, '').replace(/[ \t]+\n/g, '\n').trim();
}

/**
 * Wraps bot.chat and bot.whisper once: inside runAsCode a line that is no server command goes to output(text)
 * instead of the server. Outside it the call goes on as before.
 * @param {object} bot
 * @param {(text: string) => void} output the output of the running code
 */
export function installCodeChat(bot, output) {
    if (!bot || bot._codeChatInstalled)
        return;
    const wrap = (name, toText) => {
        const inner = bot[name];
        if (typeof inner !== 'function')
            return;
        bot[name] = function (...args) {
            if (inCode()) {
                const text = toText(...args);
                if (!(typeof text === 'string' && text.startsWith('/'))) {
                    try {
                        output(text);
                    } catch {
                        // the line is dropped
                    }
                    return;
                }
            }
            return inner.apply(this, args);
        };
    };
    wrap('chat', (message) => String(message));
    wrap('whisper', (username, message) => `to ${username}: ${String(message)}`);
    bot._codeChatInstalled = true;
}
