// v0.1.4.12 (part C): the pure parts of the client of the watch server (scripts/watch.js): the arguments, the
// request bodies, the parsing of the answers. No socket, no environment here.
// v0.1.4.13 (part S): the arguments of digest, wait, run, look and server; --follow is a loop of `wait any`
// (the stream of events of v0.1.4.12 is gone), and the cursor of an answer feeds the next call.
import { TEXTS } from '../src/agent/watch/texts.js';

export const DEFAULT_URL = 'http://127.0.0.1:8090/mcp';

export const EXIT = Object.freeze({ OK: 0, REFUSED: 1, USAGE: 2 });

export const WAIT_FOR = Object.freeze(['event', 'idle', 'done', 'any']);

export const USAGE = [
    'Usage: node scripts/watch.js <tool> [json args]',
    '  tools: state, inventory, chat, places, events, say, digest, wait, run, look, server',
    '  node scripts/watch.js state',
    '  node scripts/watch.js chat \'{"lines": 20}\'   (or: chat 20)',
    '  node scripts/watch.js say "come here"',
    '  node scripts/watch.js digest [since]           what changed since the cursor of the last digest',
    '  node scripts/watch.js wait [for] [timeout]     for: event, idle, done, any (default); timeout 1 to 55 s',
    '  node scripts/watch.js run \'!takeFromChest("bread", 10)\' \'!mineOre("diamond", 28)\'',
    '  node scripts/watch.js look [radius]            4 to 32, default 16',
    '  node scripts/watch.js server',
    '  node scripts/watch.js --follow                 a loop of wait any; replaces events --follow of v0.1.4.12',
    'Environment: MC_WATCH_URL (default http://127.0.0.1:8090/mcp), MC_WATCH_TOKEN.',
].join('\n');

function jsonObject(text) {
    if (typeof text !== 'string' || !text.trim().startsWith('{'))
        return null;
    try {
        const value = JSON.parse(text);
        return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch {
        return null;
    }
}

function integer(text) {
    return typeof text === 'string' && /^\d+$/.test(text.trim()) ? Number(text) : text;
}

/**
 * The arguments of the command line: `<tool> [json args]`, `say <words ...>`, `chat <n>`, `events <since>`,
 * `digest [since]`, `wait [for] [timeout]`, `run '<cmd>' '<cmd>' ...`, `look [radius]`, `--follow` (alone or
 * with wait: a loop of wait any).
 * @param {string[]} argv process.argv.slice(2)
 * @returns {{tool: string, args: object, follow: boolean}|{error: string}}
 */
export function parseCliArgs(argv) {
    const list = Array.isArray(argv) ? argv.filter((a) => typeof a === 'string') : [];
    const follow = list.includes('--follow');
    const rest = list.filter((a) => a !== '--follow');
    const tool = rest.shift() ?? (follow ? 'wait' : undefined);
    if (!tool || tool === '--help' || tool === '-h')
        return { error: USAGE };
    if (follow && tool !== 'wait')
        return { error: tool === 'events' ? `events --follow is gone: use --follow, a loop of wait any.\n${USAGE}` : USAGE };
    const json = jsonObject(rest[0]);
    if (rest.length > 0 && rest[0].trim().startsWith('{') && json === null)
        return { error: `The arguments are no JSON object: ${rest[0]}` };
    let args = json ?? {};
    if (json === null && rest.length > 0) {
        if (tool === 'say')
            args = { text: rest.join(' ') };
        else if (tool === 'chat')
            args = { lines: integer(rest[0]) };
        else if (tool === 'events')
            args = { since: rest[0] };
        else if (tool === 'digest')
            args = { since: rest[0] };
        else if (tool === 'wait')
            args = waitArgs(rest);
        else if (tool === 'run')
            args = { commands: rest };
        else if (tool === 'look')
            args = { radius: integer(rest[0]) };
    }
    if (follow)
        args = { ...args, for: 'any' };
    return { tool, args, follow };
}

/** `wait [for] [timeout] [since]`: `wait idle 30`, `wait 30`, `wait event`; a second number is the cursor. */
export function waitArgs(words) {
    const args = {};
    for (const word of Array.isArray(words) ? words : []) {
        if (WAIT_FOR.includes(word))
            args.for = word;
        else if (/^\d+$/.test(word) && args.timeout === undefined)
            args.timeout = Number(word);
        else if (args.since === undefined)
            args.since = word;
    }
    return args;
}

/** The JSON-RPC body of a call of a tool. */
export function requestBody(tool, args = {}, id = 1) {
    return { jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: args ?? {} } };
}

/** The headers of a request; without a token no Authorization (the server refuses it). */
export function requestHeaders(token, accept = 'application/json, text/event-stream') {
    const headers = { 'Content-Type': 'application/json', Accept: accept };
    if (typeof token === 'string' && token !== '')
        headers.Authorization = `Bearer ${token}`;
    return headers;
}

function oneLine(text) {
    return String(text ?? '').replace(/\s*\r?\n\s*/g, ' ').trim();
}

/**
 * The answer of the server as the client prints it.
 * @param {number} status the HTTP status
 * @param {string} body
 * @returns {{ok: boolean, text: string}} ok false: a refusal, printed as one line, exit 1
 */
export function parseAnswer(status, body) {
    let message = null;
    try {
        message = JSON.parse(body);
    } catch {
        message = null;
    }
    if (message === null || typeof message !== 'object') {
        if (status === 401)
            return { ok: false, text: TEXTS.refused('unauthorized') };
        return { ok: false, text: TEXTS.refused(`HTTP ${status}`) };
    }
    if (message.error) {
        const cause = typeof message.error.message === 'string' && message.error.message !== '' ? message.error.message : `error ${message.error.code}`;
        return { ok: false, text: oneLine(TEXTS.refused(cause.replace(/\.$/, ''))) };
    }
    const content = Array.isArray(message.result?.content) ? message.result.content : [];
    const text = content.filter((c) => c?.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('\n');
    if (message.result?.isError === true)
        return { ok: false, text: oneLine(text) };
    if (status >= 400)
        return { ok: false, text: TEXTS.refused(`HTTP ${status}`) };
    return { ok: true, text };
}

/** The cursor of an answer of digest or wait (`Cursor: 184.`), null without one. */
export function cursorOf(text) {
    const match = /(?:^|\n)Cursor: (\d+)\.(?:\n|$)/.exec(String(text ?? ''));
    return match ? match[1] : null;
}

/**
 * The arguments of the next call of the loop of --follow: `wait any` with the timeout and the cursor of
 * the last answer.
 * @param {object} args the arguments of the first call
 * @param {string|null} cursor the cursor of the last answer
 */
export function nextWaitArgs(args, cursor) {
    const next = { ...(args ?? {}), for: 'any' };
    if (cursor !== null && cursor !== undefined)
        next.since = String(cursor);
    return next;
}
