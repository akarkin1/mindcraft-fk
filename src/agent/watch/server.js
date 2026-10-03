// v0.1.4.12 (part C): the watch server (spec 4.1). In the process of the agent, behind watch_server, on
// 127.0.0.1:watch_port only, written on node:http (rule 18). POST /mcp takes JSON-RPC 2.0 (mcp_logic.js), GET /mcp
// opens a stream of server-sent events with every new event as notifications/message. Every request carries
// `Authorization: Bearer <token>`; the token comes from the agent, which reads MC_WATCH_TOKEN once, and is kept
// here only as its SHA-256 (rule 19: never printed, logged or saved). startWatchServer never throws.
import http from 'node:http';
import { MAX_BODY, MCP_PATH, authorized, handleRpc, sseMessage, tokenHash, tooLargeAnswer, unauthorizedAnswer } from './mcp_logic.js';
import { EVENT_RULES, Ring, restartEvent } from './events_logic.js';
import { startListeners } from './events.js';
import { runTool } from './tools.js';
import { TEXTS } from './texts.js';

export const HOST = '127.0.0.1';
export const SSE_PING_MS = 15000;

function validPort(port) {
    return Number.isInteger(port) && port >= 0 && port <= 65535;
}

function sendJson(res, status, body, headers = {}) {
    try {
        if (body === null) {
            res.writeHead(status, headers);
            res.end();
            return;
        }
        const text = JSON.stringify(body);
        res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), ...headers });
        res.end(text);
    } catch {
        try {
            res.destroy();
        } catch {
            // the socket is gone
        }
    }
}

// The body of a request, at most MAX_BODY bytes: { text } or { tooLarge: true }.
function readBody(req) {
    return new Promise((resolve) => {
        const declared = Number(req.headers['content-length']);
        if (Number.isFinite(declared) && declared > MAX_BODY) {
            req.resume();
            resolve({ tooLarge: true });
            return;
        }
        const chunks = [];
        let size = 0;
        let done = false;
        req.on('data', (chunk) => {
            if (done)
                return;
            size += chunk.length;
            if (size > MAX_BODY) {
                done = true;
                req.resume();
                resolve({ tooLarge: true });
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (!done) {
                done = true;
                resolve({ text: Buffer.concat(chunks).toString('utf8') });
            }
        });
        req.on('error', () => {
            if (!done) {
                done = true;
                resolve({ text: '' });
            }
        });
    });
}

/**
 * Starts the watch server.
 * @param {object} agent
 * @param {{port?: number, token?: string, now?: () => number, tickMs?: number, animalsEveryMs?: number, settings?: object}} options
 *   port: watch_port (0 for a free port, in tests); token: MC_WATCH_TOKEN as the agent read it
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, close: () => Promise<void>, port?: number, push?: Function, watch?: object}>}
 */
export async function startWatchServer(agent, options = {}) {
    const noop = async () => {};
    const wanted = tokenHash(options?.token);
    if (!wanted)
        return { ok: false, reason: 'no_token', text: TEXTS.noToken, close: noop };
    const port = options?.port === undefined || options?.port === null ? 8090 : options.port;
    if (!validPort(port))
        return { ok: false, reason: 'bad_port', text: TEXTS.badPort(port), close: noop };

    let stopListeners = () => {};
    let pinger = null;
    const streams = new Set();
    try {
        const watch = {
            chat: new Ring(EVENT_RULES.chatSize),
            events: new Ring(EVENT_RULES.ringSize),
            lastSpeaker: null,
            lastLine: null,
            now: typeof options?.now === 'function' ? options.now : () => Date.now(),
        };
        if (options?.settings)
            watch.settings = options.settings;
        const push = (event) => {
            if (!event)
                return;
            watch.events.push(event);
            const message = sseMessage(event);
            for (const res of streams) {
                try {
                    res.write(message);
                } catch {
                    streams.delete(res);
                }
            }
        };
        const handlers = { callTool: (name, args) => runTool(agent, watch, name, args) };

        const server = http.createServer(async (req, res) => {
            try {
                if (!authorized(req.headers.authorization, wanted)) {
                    req.resume();
                    const answer = unauthorizedAnswer();
                    sendJson(res, answer.status, answer.body, { 'WWW-Authenticate': 'Bearer' });
                    return;
                }
                const path = String(req.url ?? '').split('?')[0];
                if (path !== MCP_PATH) {
                    req.resume();
                    sendJson(res, 404, { jsonrpc: '2.0', id: null, error: { code: -32600, message: `Not found: ${path}` } });
                    return;
                }
                if (req.method === 'POST') {
                    const body = await readBody(req);
                    if (body.tooLarge) {
                        const answer = tooLargeAnswer();
                        sendJson(res, answer.status, answer.body, { Connection: 'close' });
                        return;
                    }
                    const answer = await handleRpc(body.text, handlers);
                    sendJson(res, answer.status, answer.body);
                    return;
                }
                if (req.method === 'GET') {
                    req.resume();
                    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
                    res.write(': the events of the watch server\n\n');
                    streams.add(res);
                    const drop = () => streams.delete(res);
                    res.on('close', drop);
                    res.on('error', drop);
                    return;
                }
                req.resume();
                sendJson(res, 405, { jsonrpc: '2.0', id: null, error: { code: -32600, message: `Method not allowed: ${req.method}` } }, { Allow: 'GET, POST' });
            } catch (error) {
                sendJson(res, 500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: String(error?.message ?? error) } });
            }
        });

        const listened = await new Promise((resolve) => {
            const fail = (error) => resolve({ error });
            server.once('error', fail);
            server.listen(port, HOST, () => {
                server.off('error', fail);
                resolve({ error: null });
            });
        });
        if (listened.error) {
            try {
                server.close();
            } catch {
                // never listened
            }
            return { ok: false, reason: 'listen_failed', text: TEXTS.listenFailed(port, listened.error?.code ?? 'error'), close: noop };
        }
        server.on('error', (error) => console.warn('Watch server:', error?.message ?? error));
        const actual = server.address()?.port ?? port;

        stopListeners = startListeners(agent, watch, push, { tickMs: options?.tickMs, animalsEveryMs: options?.animalsEveryMs });
        pinger = setInterval(() => {
            for (const res of streams) {
                try {
                    res.write(': ping\n\n');
                } catch {
                    streams.delete(res);
                }
            }
        }, SSE_PING_MS);
        pinger.unref?.();
        push(restartEvent(agent?.name || agent?.bot?.username || 'The bot', watch.now()));

        let closing = null;
        const close = () => {
            if (closing)
                return closing;
            closing = new Promise((resolve) => {
                try {
                    stopListeners();
                } catch {
                    // the listeners are gone with the process
                }
                clearInterval(pinger);
                for (const res of streams) {
                    try {
                        res.end();
                    } catch {
                        // the socket is gone
                    }
                }
                streams.clear();
                try {
                    server.close(() => resolve());
                    server.closeAllConnections?.();
                } catch {
                    resolve();
                }
            });
            return closing;
        };
        return { ok: true, reason: null, text: TEXTS.started(actual), port: actual, close, push, watch };
    } catch (error) {
        try {
            stopListeners();
        } catch {
            // nothing started
        }
        clearInterval(pinger);
        return { ok: false, reason: 'error', text: `The watch server does not start: ${error?.message ?? error}.`, close: noop };
    }
}
