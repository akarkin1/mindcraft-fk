// v0.1.4.12 (part C): the pure parts of the watch server (spec 4.1). MCP over the streamable HTTP transport,
// the subset a Claude session needs: JSON-RPC 2.0 with initialize, notifications/initialized, tools/list,
// tools/call and ping; the bearer token; the answers. No socket here: server.js reads the request and writes
// what these functions return. Nothing here throws.
// v0.1.4.13 (part S): the schemas of digest, wait, run, look and server; the stream of server-sent events is
// gone (wait replaces it); tools/list takes the list from handlers.tools when the server gives one (the
// registered tools of registerTool), else TOOLS.
import crypto from 'node:crypto';
import { TEXTS } from './texts.js';

export const SERVER_INFO = Object.freeze({ name: 'mindcraft-watch', version: '0.1.4.13' });
export const DEFAULT_PROTOCOL = '2025-03-26';
export const MAX_BODY = 64 * 1024;
export const MCP_PATH = '/mcp';

export const ERRORS = Object.freeze({
    parse: -32700,
    invalidRequest: -32600,
    methodNotFound: -32601,
    invalidParams: -32602,
    internal: -32603,
    unauthorized: -32001,
});

const NO_ARGS = Object.freeze({ type: 'object', properties: {}, additionalProperties: false });

/** The six tools with their JSON schemas, in the order of the spec. */
export const TOOLS = Object.freeze([
    {
        name: 'state',
        description: 'Where the bot is, the block under its feet, the dimension, the time, health and food, the running command, the job, the last order and the place home.',
        inputSchema: NO_ARGS,
    },
    {
        name: 'inventory',
        description: 'The items the bot carries, the most first, and what it holds in its hand and off-hand.',
        inputSchema: NO_ARGS,
    },
    {
        name: 'chat',
        description: 'The last lines of the chat, oldest first, with the time and who said them; the lines of the bot too.',
        inputSchema: {
            type: 'object',
            properties: { lines: { type: 'integer', minimum: 1, maximum: 50, default: 10, description: 'How many lines, 1 to 50.' } },
            additionalProperties: false,
        },
    },
    {
        name: 'places',
        description: 'The saved areas with kind and box, the mines, the routes by name and the rules of the player.',
        inputSchema: NO_ARGS,
    },
    {
        name: 'events',
        description: 'The events (explosion, health, animals_missing, night_awake, job_stalled, failure_repeated, far_from_home, death, restart) after a time, oldest first; without a time the last 20.',
        inputSchema: {
            type: 'object',
            properties: { since: { type: 'string', description: 'An ISO time; only the events after it.' } },
            additionalProperties: false,
        },
    },
    {
        name: 'say',
        description: 'One chat line, handed to the bot with the name of the owner exactly as a line the owner types. The answer of the bot comes through chat. Server commands (a line that starts with /) are refused.',
        inputSchema: {
            type: 'object',
            properties: { text: { type: 'string', minLength: 1, maxLength: 256, description: 'The line, 1 to 256 characters.' } },
            required: ['text'],
            additionalProperties: false,
        },
    },
    // v0.1.4.13 (part S)
    {
        name: 'digest',
        description: 'What changed since a cursor, about 10 lines: the position, health and food, the running command, the job, the inventory changes, the item in hand with its uses, new chat lines, new events, hazards within 8 blocks, the nearest chest with free slots. The first line is the cursor for the next call; without a cursor every line.',
        inputSchema: {
            type: 'object',
            properties: { since: { type: 'string', description: 'The cursor the last digest returned; without it every line.' } },
            additionalProperties: false,
        },
    },
    {
        name: 'wait',
        description: 'Holds the answer until something happens, then answers with the digest: for event (a new event), idle (nothing runs and nothing ran for 3 s), done (the command that runs has ended), any (a change of the bot\'s situation: health, food, the running command, the item in hand, a hazard, the chest, a line of a player, an event). At the timeout: Woke: timeout. At most 4 waits at a time.',
        inputSchema: {
            type: 'object',
            properties: {
                for: { type: 'string', enum: ['event', 'idle', 'done', 'any'], default: 'any', description: 'What to wait for.' },
                timeout: { type: 'integer', minimum: 1, maximum: 55, default: 55, description: 'Seconds, 1 to 55.' },
                since: { type: 'string', description: 'A cursor of digest: the answer is the digest since it; without it, since the call.' },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'run',
        description: 'Runs commands as the owner, one after the other, each after the previous one ended; a failure stops the queue when stop_on_failure. A skill that ran 2 s counts as started. The result lines come back together, at most 55 s after the call; a longer queue answers with what is done and the rest comes through digest. A command of the owner while the queue runs waits behind it; !stop empties the queue. !stop first stops the running command at once. Quiet: nothing of it goes to the game chat.',
        inputSchema: {
            type: 'object',
            properties: {
                commands: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10, description: 'The commands, each a !command(...), 1 to 10.' },
                stop_on_failure: { type: 'boolean', default: true, description: 'Stop at the first failure.' },
            },
            required: ['commands'],
            additionalProperties: false,
        },
    },
    {
        name: 'look',
        description: 'What is around the bot, no model call: ores, lava, water, chests with their free slots, furnaces, ladders, doors and gates, drops on the ground, players. One line per kind, nearest first, at most 5 of each kind.',
        inputSchema: {
            type: 'object',
            properties: { radius: { type: 'integer', minimum: 4, maximum: 32, default: 16, description: 'Blocks, 4 to 32.' } },
            additionalProperties: false,
        },
    },
    {
        name: 'server',
        description: 'The process and the world: uptime, heap, tick lag, the players online, time and weather, the model calls and cost of the session, the switches that are on, whether a supervisor is connected.',
        inputSchema: NO_ARGS,
    },
].map((tool) => Object.freeze(tool)));

export const TOOL_NAMES = Object.freeze(TOOLS.map((tool) => tool.name));

/**
 * The SHA-256 of a token, for the comparison in constant time. null for anything that is not a non-empty string.
 * @param {*} token
 * @returns {Buffer|null}
 */
export function tokenHash(token) {
    if (typeof token !== 'string' || token === '')
        return null;
    return crypto.createHash('sha256').update(token, 'utf8').digest();
}

/**
 * The token of an Authorization header `Bearer <token>`, or null.
 * @param {*} header
 * @returns {string|null}
 */
export function bearerOf(header) {
    if (typeof header !== 'string')
        return null;
    const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(header);
    return match ? match[1] : null;
}

/**
 * True when the header carries the token whose hash is wanted. The hashes are compared with
 * crypto.timingSafeEqual, so the time does not tell how much of a token was right.
 * @param {*} header the Authorization header
 * @param {Buffer|null} wanted tokenHash of the token of the server
 * @returns {boolean}
 */
export function authorized(header, wanted) {
    try {
        if (!Buffer.isBuffer(wanted) || wanted.length === 0)
            return false;
        const given = tokenHash(bearerOf(header) ?? '') ?? crypto.createHash('sha256').update('', 'utf8').digest();
        const same = crypto.timingSafeEqual(given, wanted);
        return same && bearerOf(header) !== null;
    } catch {
        return false;
    }
}

/** A JSON-RPC error object. */
export function rpcError(id, code, message) {
    return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/** A JSON-RPC result object. */
export function rpcResult(id, result) {
    return { jsonrpc: '2.0', id, result };
}

/** The answer to a request without the token: 401 with the error -32001 "unauthorized" and nothing else. */
export function unauthorizedAnswer() {
    return { status: 401, body: rpcError(null, ERRORS.unauthorized, TEXTS.unauthorized) };
}

// v0.1.4.13 (the owner, 2026-10-04): watch_local_only, the server for this machine only, without a token. A tunnel
// (cloudflared, ngrok) also reaches the server from 127.0.0.1, so its requests are told apart by the headers it adds;
// a browser page by the Host and the Content-Type it can send without a preflight.
export const TUNNEL_HEADERS = Object.freeze(['cf-connecting-ip', 'cf-ray', 'cf-ipcountry', 'x-forwarded-for', 'x-forwarded-host',
    'x-forwarded-proto', 'x-real-ip', 'forwarded', 'ngrok-trace-id']);
const LOCAL_HOSTS = Object.freeze(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Why a request may not reach the server for this machine only, or null when it may: a header of a tunnel, a Host
 * that is not this machine, a POST whose Content-Type is not JSON. Never throws.
 * @param {object} headers the request's headers (lower-case names, as node:http gives them)
 * @param {string} method the request's method
 * @returns {string|null}
 */
export function localRefusal(headers, method = 'POST') {
    try {
        const h = headers && typeof headers === 'object' ? headers : {};
        const tunnel = TUNNEL_HEADERS.find((name) => h[name] !== undefined);
        if (tunnel)
            return `the request came through a tunnel (${tunnel})`;
        const host = String(h.host ?? '').toLowerCase().replace(/:\d+$/, '');
        if (!LOCAL_HOSTS.includes(host))
            return `the host "${host}" is not this machine`;
        const type = String(h['content-type'] ?? '').toLowerCase();
        if (String(method).toUpperCase() === 'POST' && !type.startsWith('application/json'))
            return 'the body is not JSON';
        return null;
    } catch {
        return 'the request could not be read';
    }
}

/** The answer to a request that the server for this machine only refuses (403). */
export function localOnlyAnswer(why) {
    return { status: 403, body: rpcError(null, ERRORS.unauthorized, TEXTS.localOnly(why)) };
}

/** The answer to a body over 64 KB. */
export function tooLargeAnswer() {
    return { status: 413, body: rpcError(null, ERRORS.invalidRequest, TEXTS.tooLarge) };
}

/**
 * The result of tools/call: `{ content: [{ type: "text", text }] }`, with isError: true on a refusal.
 * @param {string} text
 * @param {boolean} [isError]
 */
export function toolResult(text, isError = false) {
    const result = { content: [{ type: 'text', text: typeof text === 'string' ? text : String(text) }] };
    if (isError)
        result.isError = true;
    return result;
}

/** The answer to initialize: the protocol version as the client sent it, else DEFAULT_PROTOCOL. */
export function initializeResult(params) {
    const asked = params?.protocolVersion;
    return {
        protocolVersion: typeof asked === 'string' && asked !== '' ? asked : DEFAULT_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { ...SERVER_INFO },
    };
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRequestShape(message) {
    return isObject(message) && message.jsonrpc === '2.0' && typeof message.method === 'string' && message.method !== '';
}

function toolsOf(handlers) {
    try {
        const list = typeof handlers?.tools === 'function' ? handlers.tools() : handlers?.tools;
        if (Array.isArray(list))
            return list.filter((tool) => isObject(tool) && typeof tool.name === 'string');
    } catch {
        // the table
    }
    return TOOLS;
}

/**
 * One JSON-RPC message. A notification (no id) gets null (no answer). Never throws.
 * @param {*} message
 * @param {{callTool: (name: string, args: object) => Promise<{text: string, isError?: boolean}|null>, tools?: Function|object[]}} handlers
 *   callTool: null for an unknown tool; tools: the schemas for tools/list (registerTool), else TOOLS
 * @returns {Promise<object|null>}
 */
export async function dispatch(message, handlers = {}) {
    if (!isRequestShape(message))
        return rpcError(isObject(message) ? message.id : null, ERRORS.invalidRequest, TEXTS.invalidRequest);
    const notification = !Object.prototype.hasOwnProperty.call(message, 'id');
    const { id, method } = message;
    const params = isObject(message.params) ? message.params : {};
    if (notification)
        return null; // notifications/initialized and any other notification: no answer
    switch (method) {
        case 'initialize':
            return rpcResult(id, initializeResult(params));
        case 'ping':
            return rpcResult(id, {});
        case 'tools/list':
            return rpcResult(id, { tools: toolsOf(handlers).map((tool) => ({ ...tool })) });
        case 'tools/call': {
            const name = typeof params.name === 'string' ? params.name : '';
            const args = isObject(params.arguments) ? params.arguments : {};
            if (!toolsOf(handlers).some((tool) => tool.name === name))
                return rpcError(id, ERRORS.invalidParams, TEXTS.unknownTool(name || '(none)'));
            let answer = null;
            try {
                answer = typeof handlers.callTool === 'function' ? await handlers.callTool(name, args) : null;
            } catch (error) {
                answer = { text: TEXTS.toolFailed(name, error?.message ?? String(error)), isError: true };
            }
            if (!answer)
                return rpcError(id, ERRORS.invalidParams, TEXTS.unknownTool(name));
            return rpcResult(id, toolResult(answer.text, answer.isError === true));
        }
        default:
            return rpcError(id, ERRORS.methodNotFound, TEXTS.unknownMethod(method));
    }
}

/**
 * The answer to the body of POST /mcp: `{ status, body }`, body null for 202 (only notifications). A batch
 * (an array) gets an array of the answers. Never throws.
 * @param {string} text the body
 * @param {object} handlers see dispatch
 * @returns {Promise<{status: number, body: object|object[]|null}>}
 */
export async function handleRpc(text, handlers = {}) {
    let message;
    try {
        message = JSON.parse(typeof text === 'string' ? text : '');
    } catch {
        return { status: 400, body: rpcError(null, ERRORS.parse, TEXTS.parseError) };
    }
    if (Array.isArray(message)) {
        if (message.length === 0)
            return { status: 400, body: rpcError(null, ERRORS.invalidRequest, TEXTS.invalidRequest) };
        const answers = [];
        for (const one of message) {
            const answer = await dispatch(one, handlers);
            if (answer)
                answers.push(answer);
        }
        return answers.length > 0 ? { status: 200, body: answers } : { status: 202, body: null };
    }
    const answer = await dispatch(message, handlers);
    if (answer === null)
        return { status: 202, body: null };
    return { status: answer.error?.code === ERRORS.invalidRequest ? 400 : 200, body: answer };
}
