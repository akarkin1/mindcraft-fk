// Tester T1 of v0.1.4.12 "Understanding and watching", from the spec 4.1 (part C, the protocol): the JSON-RPC answers
// of src/agent/watch/mcp_logic.js without a socket (initialize, notifications/initialized, tools/list with exactly six
// tools and their schemas, tools/call as { content: [{ type: "text", text }] } with isError on a refusal, ping, an
// unknown method -32601, the answers 401/-32001 and 413), then the same rules through the real server on a free port
// of 127.0.0.1 with a fake agent: no token, a wrong token, a body over 64 KB. Every server is closed at the end.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { loadSrc } from '../helpers/load.js';

const L = await loadSrc('src/agent/watch/mcp_logic.js');
const S = await loadSrc('src/agent/watch/server.js');

const TOKEN = `wv-${process.pid}-${Date.now()}`;
const SIX = ['state', 'inventory', 'chat', 'places', 'events', 'say'];

// ------------------------------------------------------------------------------------------------ pure answers

const rpc = (method, params, id = 1) => JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });

describe('4.1 mcp_logic: initialize', () => {
    test('the protocol version as the client sent it, capabilities tools, serverInfo mindcraft-watch 0.1.4.12', async () => {
        const a = await L.handleRpc(rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'x', version: '1' } }, 7));
        assert.equal(a.status, 200);
        assert.equal(a.body.jsonrpc, '2.0');
        assert.equal(a.body.id, 7);
        assert.equal(a.body.result.protocolVersion, '2024-11-05');
        assert.deepEqual(a.body.result.capabilities, { tools: {} });
        assert.deepEqual(a.body.result.serverInfo, { name: 'mindcraft-watch', version: '0.1.4.12' });
    });

    test('without a protocol version: "2025-03-26"', async () => {
        const a = await L.handleRpc(rpc('initialize', {}));
        assert.equal(a.body.result.protocolVersion, '2025-03-26');
        const b = await L.handleRpc(rpc('initialize'));
        assert.equal(b.body.result.protocolVersion, '2025-03-26');
    });

    test('notifications/initialized: 202 and no body', async () => {
        const a = await L.handleRpc(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
        assert.equal(a.status, 202);
        assert.equal(a.body, null);
    });

    test('ping: an empty result', async () => {
        const a = await L.handleRpc(rpc('ping', undefined, 3));
        assert.equal(a.status, 200);
        assert.deepEqual(a.body.result, {});
        assert.equal(a.body.id, 3);
    });
});

describe('4.1 mcp_logic: tools/list', () => {
    test('exactly six tools: state, inventory, chat, places, events, say', async () => {
        const a = await L.handleRpc(rpc('tools/list', {}));
        const tools = a.body.result.tools;
        assert.equal(tools.length, 6);
        assert.deepEqual(tools.map((t) => t.name).sort(), [...SIX].sort());
    });

    test('each with a description and a JSON schema of type object', async () => {
        const { tools } = (await L.handleRpc(rpc('tools/list', {}))).body.result;
        for (const t of tools) {
            assert.equal(typeof t.description, 'string', t.name);
            assert.ok(t.description.length > 0, t.name);
            assert.equal(t.inputSchema?.type, 'object', `${t.name}: inputSchema.type`);
            assert.equal(typeof (t.inputSchema.properties ?? {}), 'object', t.name);
        }
    });

    test('the arguments of the spec: chat lines (integer 1 to 50), events since (string), say text (string 1 to 256, required)', async () => {
        const { tools } = (await L.handleRpc(rpc('tools/list', {}))).body.result;
        const by = Object.fromEntries(tools.map((t) => [t.name, t.inputSchema]));
        assert.equal(by.chat.properties.lines.type, 'integer');
        assert.equal(by.chat.properties.lines.minimum, 1);
        assert.equal(by.chat.properties.lines.maximum, 50);
        assert.equal(by.events.properties.since.type, 'string');
        assert.equal(by.say.properties.text.type, 'string');
        assert.equal(by.say.properties.text.minLength, 1);
        assert.equal(by.say.properties.text.maxLength, 256);
        assert.ok(Array.isArray(by.say.required) && by.say.required.includes('text'), 'say: text is required');
        for (const name of ['state', 'inventory', 'places'])
            assert.deepEqual(Object.keys(by[name].properties ?? {}), [], `${name} takes no arguments`);
    });
});

describe('4.1 mcp_logic: tools/call', () => {
    test('the result is { content: [{ type: "text", text }] }, no isError on an answer', async () => {
        const handlers = { callTool: async (name, args) => ({ text: `called ${name} ${JSON.stringify(args)}`, isError: false }) };
        const a = await L.handleRpc(rpc('tools/call', { name: 'state', arguments: {} }, 9), handlers);
        assert.equal(a.status, 200);
        assert.equal(a.body.id, 9);
        assert.deepEqual(a.body.result.content, [{ type: 'text', text: 'called state {}' }]);
        assert.notEqual(a.body.result.isError, true);
    });

    test('a refusal: isError true and the text of the refusal', async () => {
        const handlers = { callTool: async () => ({ text: 'I do not run server commands.', isError: true }) };
        const a = await L.handleRpc(rpc('tools/call', { name: 'say', arguments: { text: '/kill' } }), handlers);
        assert.deepEqual(a.body.result, { content: [{ type: 'text', text: 'I do not run server commands.' }], isError: true });
    });

    test('toolResult gives the same shape', () => {
        assert.deepEqual(L.toolResult('x'), { content: [{ type: 'text', text: 'x' }] });
        assert.deepEqual(L.toolResult('no', true), { content: [{ type: 'text', text: 'no' }], isError: true });
    });
});

describe('4.1 mcp_logic: errors', () => {
    test('an unknown method: -32601', async () => {
        const a = await L.handleRpc(rpc('resources/list', {}, 4));
        assert.equal(a.body.error.code, -32601);
        assert.equal(a.body.id, 4);
        assert.equal(a.body.result, undefined);
    });

    test('unauthorized: 401 with the JSON-RPC error -32001 "unauthorized" and nothing else', () => {
        const a = L.unauthorizedAnswer();
        assert.equal(a.status, 401);
        assert.equal(a.body.error.code, -32001);
        assert.equal(a.body.error.message, 'unauthorized');
        assert.equal(a.body.result, undefined);
        assert.deepEqual(Object.keys(a.body.error).sort(), ['code', 'message']);
    });

    test('a body over 64 KB: 413', () => {
        assert.equal(L.tooLargeAnswer().status, 413);
        assert.equal(L.MAX_BODY, 64 * 1024);
    });

    test('authorized: only "Bearer <the token>"; none, another token, another scheme: false', () => {
        const wanted = L.tokenHash(TOKEN);
        assert.equal(L.authorized(`Bearer ${TOKEN}`, wanted), true);
        assert.equal(L.authorized(undefined, wanted), false);
        assert.equal(L.authorized('', wanted), false);
        assert.equal(L.authorized(`Bearer ${TOKEN}x`, wanted), false);
        assert.equal(L.authorized('Bearer other', wanted), false);
        assert.equal(L.authorized(`Basic ${TOKEN}`, wanted), false);
        assert.equal(L.authorized(TOKEN, wanted), false);
    });

    test('the comparison is constant-time: crypto.timingSafeEqual on the hashes (source)', async () => {
        const fs = await import('node:fs');
        const { repoPath } = await import('../helpers/paths.js');
        const src = fs.readFileSync(repoPath('src/agent/watch/mcp_logic.js'), 'utf8');
        assert.match(src, /timingSafeEqual/);
        assert.match(src, /createHash\(['"]sha256['"]\)/);
    });
});

// ------------------------------------------------------------------------------------------------ the real server

function fakeAgent() {
    const bot = new EventEmitter();
    bot.username = 'Luna';
    bot.entity = { position: { x: 12.5, y: 67, z: 52.5 } };
    bot.health = 20;
    bot.food = 18;
    bot.time = { timeOfDay: 1000 };
    bot.game = { dimension: 'overworld' };
    bot.blockAt = () => ({ name: 'oak_planks' });
    bot.inventory = { items: () => [], slots: [] };
    bot.heldItem = null;
    bot.entities = {};
    bot._client = new EventEmitter();
    return {
        name: 'Luna',
        bot,
        handled: [],
        actions: { currentActionLabel: '' },
        area_store: { list: () => [] },
        async handleMessage(source, message) { this.handled.push([source, message]); return true; },
        async openChat() {},
    };
}

function post(port, { body, token = TOKEN, raw = false }) {
    return new Promise((resolve, reject) => {
        const data = raw ? body : JSON.stringify(body);
        const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Content-Length': Buffer.byteLength(data) };
        if (token !== null) headers.Authorization = token.startsWith('Basic ') ? token : `Bearer ${token}`;
        const req = http.request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers, agent: false }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let json = null;
                try { json = JSON.parse(text); } catch { json = null; }
                resolve({ status: res.statusCode, text, json });
            });
        });
        req.on('error', (e) => (e.code === 'ECONNRESET' || e.code === 'EPIPE' ? resolve({ status: 'reset', text: '', json: null }) : reject(e)));
        req.end(data);
    });
}

describe('4.1 the server on 127.0.0.1: the same answers over HTTP', () => {
    let server;
    let agent;
    before(async () => {
        agent = fakeAgent();
        server = await S.startWatchServer(agent, { port: 0, token: TOKEN, settings: { only_chat_with: ['MartyByrde2'] } });
    });
    after(async () => {
        await server?.close?.();
    });

    test('it starts: ok, the started text with the port', () => {
        assert.equal(server.ok, true, server.text);
        assert.equal(server.text, `The watch server listens on 127.0.0.1:${server.port}.`);
    });

    test('without a token: the noToken text, nothing listens', async () => {
        const r = await S.startWatchServer(fakeAgent(), { port: 0, token: undefined });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'no_token');
        assert.equal(r.text, 'The watch server does not start: MC_WATCH_TOKEN is not set.');
        await r.close?.();
    });

    test('initialize over HTTP', async () => {
        const r = await post(server.port, { body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } } });
        assert.equal(r.status, 200);
        assert.equal(r.json.result.serverInfo.name, 'mindcraft-watch');
        assert.equal(r.json.result.protocolVersion, '2025-03-26');
    });

    test('tools/list over HTTP: six tools', async () => {
        const r = await post(server.port, { body: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
        assert.deepEqual(r.json.result.tools.map((t) => t.name).sort(), [...SIX].sort());
    });

    test('tools/call say "/kill": isError and "I do not run server commands."; nothing handed to the bot', async () => {
        const r = await post(server.port, { body: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'say', arguments: { text: '/kill' } } } });
        assert.deepEqual(r.json.result, { content: [{ type: 'text', text: 'I do not run server commands.' }], isError: true });
        assert.deepEqual(agent.handled, []);
    });

    test('an unknown method: -32601', async () => {
        const r = await post(server.port, { body: { jsonrpc: '2.0', id: 4, method: 'prompts/list' } });
        assert.equal(r.json.error.code, -32601);
    });

    test('without the bearer: 401, -32001 "unauthorized" and nothing else', async () => {
        const r = await post(server.port, { body: { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'state', arguments: {} } }, token: null });
        assert.equal(r.status, 401);
        assert.equal(r.json.error.code, -32001);
        assert.equal(r.json.error.message, 'unauthorized');
        assert.equal(r.json.result, undefined);
        assert.doesNotMatch(r.text, /Luna|overworld|Health/);
    });

    test('with a wrong bearer: 401 -32001; with another scheme: 401', async () => {
        const r = await post(server.port, { body: { jsonrpc: '2.0', id: 6, method: 'tools/list' }, token: `${TOKEN}-wrong` });
        assert.equal(r.status, 401);
        assert.equal(r.json.error.code, -32001);
        assert.equal(r.json.result, undefined);
        const b = await post(server.port, { body: { jsonrpc: '2.0', id: 7, method: 'tools/list' }, token: `Basic ${TOKEN}` });
        assert.equal(b.status, 401);
    });

    test('a body over 64 KB: 413', async () => {
        const big = JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'say', arguments: { text: 'x'.repeat(70 * 1024) } } });
        const r = await post(server.port, { body: big, raw: true });
        assert.equal(r.status, 413);
        assert.deepEqual(agent.handled, []);
    });
});
