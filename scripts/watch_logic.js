// v0.1.4.12 (part C): the pure parts of the client of the watch server (scripts/watch.js): the arguments, the
// request bodies, the parsing of the answers and of the stream of events. No socket, no environment here.
import { TEXTS } from '../src/agent/watch/texts.js';
import { eventLine } from '../src/agent/watch/events_logic.js';

export const DEFAULT_URL = 'http://127.0.0.1:8090/mcp';

export const EXIT = Object.freeze({ OK: 0, REFUSED: 1, USAGE: 2 });

export const USAGE = [
    'Usage: node scripts/watch.js <tool> [json args]',
    '  tools: state, inventory, chat, places, events, say',
    '  node scripts/watch.js state',
    '  node scripts/watch.js chat \'{"lines": 20}\'   (or: chat 20)',
    '  node scripts/watch.js say "come here"',
    '  node scripts/watch.js events --follow',
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

/**
 * The arguments of the command line: `<tool> [json args]`, `say <words ...>`, `chat <n>`, `events <since>`,
 * `events --follow`.
 * @param {string[]} argv process.argv.slice(2)
 * @returns {{tool: string, args: object, follow: boolean}|{error: string}}
 */
export function parseCliArgs(argv) {
    const list = Array.isArray(argv) ? argv.filter((a) => typeof a === 'string') : [];
    const follow = list.includes('--follow');
    const rest = list.filter((a) => a !== '--follow');
    const tool = rest.shift();
    if (!tool || tool === '--help' || tool === '-h')
        return { error: USAGE };
    if (follow && tool !== 'events')
        return { error: USAGE };
    const json = jsonObject(rest[0]);
    if (rest.length > 0 && rest[0].trim().startsWith('{') && json === null)
        return { error: `The arguments are no JSON object: ${rest[0]}` };
    let args = json ?? {};
    if (json === null && rest.length > 0) {
        if (tool === 'say')
            args = { text: rest.join(' ') };
        else if (tool === 'chat')
            args = { lines: /^\d+$/.test(rest[0]) ? Number(rest[0]) : rest[0] };
        else if (tool === 'events')
            args = { since: rest[0] };
    }
    return { tool, args, follow };
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

/**
 * A parser of a stream of server-sent events: feed(chunk) returns the parsed data of every complete event.
 * Comments (`: ping`) are skipped; data that is no JSON is skipped.
 */
export function createSseParser() {
    let buffer = '';
    return {
        feed(chunk) {
            buffer += String(chunk ?? '').replace(/\r\n/g, '\n');
            const out = [];
            let at;
            while ((at = buffer.indexOf('\n\n')) >= 0) {
                const block = buffer.slice(0, at);
                buffer = buffer.slice(at + 2);
                const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).replace(/^ /, '')).join('\n');
                if (data === '')
                    continue;
                try {
                    out.push(JSON.parse(data));
                } catch {
                    // not an event of the server
                }
            }
            return out;
        },
    };
}

/** The printed line of a notification of the stream, null for anything else. */
export function streamLine(message) {
    if (message?.method !== 'notifications/message')
        return null;
    const event = message.params?.data;
    if (!event || typeof event !== 'object')
        return null;
    return eventLine(event);
}
