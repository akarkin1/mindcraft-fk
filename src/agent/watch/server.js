// v0.1.4.12 (part C): the watch server (spec 4.1). In the process of the agent, behind watch_server, on
// 127.0.0.1:watch_port only, written on node:http (rule 18). POST /mcp takes JSON-RPC 2.0 (mcp_logic.js). Every
// request carries `Authorization: Bearer <token>`; the token comes from the agent, which reads MC_WATCH_TOKEN
// once, and is kept here only as its SHA-256 (rule 19: never printed, logged or saved). startWatchServer never
// throws.
// v0.1.4.13 (part S): the stream of GET /mcp is gone: the wait tool holds its answer until something happens.
// The state of the new tools is made here: watch.cursors (the last 50 snapshots), watch.waits (the open waits,
// told of every event), watch.queue (the command queue of run; it wraps agent.handleMessage after the
// listeners, so the owner's commands wait behind the queue). A request whose connection closes aborts its
// wait. tools/list comes from toolList() (the table and the tools of registerTool).
import http from 'node:http';
import { MAX_BODY, MCP_PATH, authorized, handleRpc, tokenHash, tooLargeAnswer, unauthorizedAnswer } from './mcp_logic.js';
import { EVENT_RULES, Ring, restartEvent } from './events_logic.js';
import { startListeners } from './events.js';
import { createWaits, runTool, toolList } from './tools.js';
import { createCursorStore } from './digest_logic.js';
import { createQueue } from './queue.js';
import { TEXTS } from './texts.js';

export const HOST = '127.0.0.1';

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
 * @param {{port?: number, token?: string, now?: () => number, tickMs?: number, animalsEveryMs?: number, reportMs?: number,
 *   waitTickMs?: number, answerMs?: number, longSkillMs?: number, settings?: object}} options
 *   port: watch_port (0 for a free port, in tests); token: MC_WATCH_TOKEN as the agent read it; the rest for tests
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
    let watch = null;
    const closeState = () => {
        try {
            watch?.queue?.close?.();
        } catch {
            // the queue is gone
        }
        try {
            watch?.waits?.close?.();
        } catch {
            // the waits are gone
        }
    };
    try {
        const startedAt = Date.now();
        watch = {
            chat: new Ring(EVENT_RULES.chatSize),
            events: new Ring(EVENT_RULES.ringSize),
            lastSpeaker: null,
            lastLine: null,
            now: typeof options?.now === 'function' ? options.now : () => Date.now(),
            uptime: () => (Date.now() - startedAt) / 1000,
            presence: { seenAt: null },
        };
        if (options?.settings)
            watch.settings = options.settings;
        watch.cursors = createCursorStore();
        watch.waits = createWaits(agent, watch, { tickMs: options?.waitTickMs });
        const push = (event) => {
            if (!event)
                return;
            watch.events.push(event);
            try {
                watch.waits.onEvent();
            } catch (error) {
                console.warn('Watch server: the waits were not told of an event:', error?.message ?? error);
            }
        };
        const handlers = {
            tools: () => toolList(),
            callTool: (name, args, request) => runTool(agent, watch, name, args, request),
        };

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
                    // a closed connection ends the wait of this call
                    const aborter = new AbortController();
                    const onClose = () => aborter.abort();
                    res.on('close', onClose);
                    const request = { signal: aborter.signal };
                    const answer = await handleRpc(body.text, { tools: handlers.tools, callTool: (name, args) => handlers.callTool(name, args, request) });
                    res.off('close', onClose);
                    if (aborter.signal.aborted)
                        return;
                    sendJson(res, answer.status, answer.body);
                    return;
                }
                req.resume();
                sendJson(res, 405, { jsonrpc: '2.0', id: null, error: { code: -32600, message: `Method not allowed: ${req.method}` } }, { Allow: 'POST' });
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
            closeState();
            return { ok: false, reason: 'listen_failed', text: TEXTS.listenFailed(port, listened.error?.code ?? 'error'), close: noop };
        }
        server.on('error', (error) => console.warn('Watch server:', error?.message ?? error));
        const actual = server.address()?.port ?? port;

        stopListeners = startListeners(agent, watch, push, { tickMs: options?.tickMs, animalsEveryMs: options?.animalsEveryMs, reportMs: options?.reportMs });
        // the queue wraps handleMessage after the listeners did, so it is the outermost wrapper
        watch.queue = createQueue(agent, { now: watch.now, answerMs: options?.answerMs, longSkillMs: options?.longSkillMs });
        push(restartEvent(agent?.name || agent?.bot?.username || 'The bot', watch.now()));

        let closing = null;
        const close = () => {
            if (closing)
                return closing;
            closing = new Promise((resolve) => {
                closeState(); // the queue first: its wrapper lies over the one of the listeners
                try {
                    stopListeners();
                } catch {
                    // the listeners are gone with the process
                }
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
        closeState();
        return { ok: false, reason: 'error', text: `The watch server does not start: ${error?.message ?? error}.`, close: noop };
    }
}
