// v0.1.4.12 (part C): the pure parts of the watch server (spec 4.1). MCP over the streamable HTTP transport,
// the subset a Claude session needs: JSON-RPC 2.0 with initialize, notifications/initialized, tools/list,
// tools/call and ping; the bearer token; the answers. No socket here: server.js reads the request and writes
// what these functions return. Nothing here throws.
import crypto from 'node:crypto';
import { TEXTS } from './texts.js';

export const SERVER_INFO = Object.freeze({ name: 'mindcraft-watch', version: '0.1.4.12' });
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

/**
 * One JSON-RPC message. A notification (no id) gets null (no answer). Never throws.
 * @param {*} message
 * @param {{callTool: (name: string, args: object) => Promise<{text: string, isError?: boolean}|null>}} handlers
 *   callTool: null for an unknown tool
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
            return rpcResult(id, { tools: TOOLS.map((tool) => ({ ...tool })) });
        case 'tools/call': {
            const name = typeof params.name === 'string' ? params.name : '';
            const args = isObject(params.arguments) ? params.arguments : {};
            if (!TOOL_NAMES.includes(name))
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

/**
 * An event as an MCP notification for the stream of GET /mcp.
 * @param {{t: string, kind: string, text: string, data: object}} event
 */
export function eventNotification(event) {
    return { jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', logger: 'events', data: event } };
}

/** One server-sent event with the notification of an event. */
export function sseMessage(event) {
    return `event: message\ndata: ${JSON.stringify(eventNotification(event))}\n\n`;
}
