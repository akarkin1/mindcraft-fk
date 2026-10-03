// Spec v0.1.4.12 4.1 (part C): the watch server on a free port with a fake agent, called with node:http and with the
// client scripts/watch.js. No Minecraft. Every server, stream and child process is closed at the end.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWatchServer } from '../../src/agent/watch/server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOKEN = `test-${process.pid}-${Date.now()}`;

class FakeAgent {
    constructor() {
        this.name = 'Luna';
        this.handled = [];
        this.said = [];
        const bot = new EventEmitter();
        bot.username = 'Luna';
        bot.entity = { position: { x: 12.5, y: 67, z: 52.5, offset: () => ({ x: 12.5, y: 66.5, z: 52.5 }) } };
        bot.health = 20;
        bot.food = 20;
        bot.time = { timeOfDay: 1000 };
        bot.game = { dimension: 'overworld' };
        bot.blockAt = () => ({ name: 'grass_block' });
        bot.inventory = { items: () => [{ name: 'bread', count: 3 }], slots: [] };
        bot.heldItem = null;
        bot.entities = {};
        bot._client = new EventEmitter();
        this.bot = bot;
        this.actions = { currentActionLabel: '' };
        this.area_store = { list: () => [{ name: 'pen', type: 'pen', dimension: 'overworld', min: { x: 0, y: 64, z: 0 }, max: { x: 6, y: 66, z: 6 } }] };
    }

    async handleMessage(source, message) {
        this.handled.push([source, message]);
        return true;
    }

    async openChat(message) {
        this.said.push(message);
    }
}

function request(port, { method = 'POST', body = null, token = TOKEN, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const data = body === null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
        const req = http.request({
            host: '127.0.0.1', port, path: '/mcp', method,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(data !== null ? { 'Content-Length': Buffer.byteLength(data) } : {}),
                ...headers,
            },
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let json = null;
                try {
                    json = JSON.parse(text);
                } catch {
                    json = null;
                }
                resolve({ status: res.statusCode, text, json });
            });
        });
        req.on('error', reject);
        if (data !== null)
            req.write(data);
        req.end();
    });
}

const call = (port, name, args = {}, id = 1) => request(port, { body: { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } } });

function runClient(port, args, token) {
    return new Promise((resolve) => {
        const env = { ...process.env, MC_WATCH_URL: `http://127.0.0.1:${port}/mcp` };
        delete env.MC_WATCH_TOKEN;
        delete env.NODE_USE_ENV_PROXY;
        if (token)
            env.MC_WATCH_TOKEN = token;
        const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'watch.js'), ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        child.stdout.on('data', (c) => (out += c));
        child.stderr.on('data', (c) => (out += c));
        child.on('close', (code) => resolve({ code, out }));
    });
}

describe('the start', () => {
    test('without a token: no_token and the text of the spec', async () => {
        const result = await startWatchServer(new FakeAgent(), { port: 0, token: undefined });
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'no_token');
        assert.equal(result.text, 'The watch server does not start: MC_WATCH_TOKEN is not set.');
        await result.close();
        assert.equal((await startWatchServer(new FakeAgent(), { port: 0, token: '' })).reason, 'no_token');
    });

    test('a port that is taken: listen_failed, never a throw', async () => {
        const first = await startWatchServer(new FakeAgent(), { port: 0, token: TOKEN });
        assert.equal(first.ok, true);
        const second = await startWatchServer(new FakeAgent(), { port: first.port, token: TOKEN });
        assert.equal(second.ok, false);
        assert.equal(second.reason, 'listen_failed');
        await first.close();
    });

    test('a bad port', async () => {
        assert.equal((await startWatchServer(new FakeAgent(), { port: 'x', token: TOKEN })).reason, 'bad_port');
    });
});

describe('the server', () => {
    let agent;
    let server;
    let port;

    before(async () => {
        agent = new FakeAgent();
        server = await startWatchServer(agent, { port: 0, token: TOKEN, settings: { only_chat_with: ['MartyByrde2'] } });
        port = server.port;
    });

    after(async () => {
        await server.close();
    });

    test('it listens on 127.0.0.1 and says so', () => {
        assert.equal(server.ok, true);
        assert.equal(server.text, `The watch server listens on 127.0.0.1:${port}.`);
        assert.ok(!server.text.includes(TOKEN));
    });

    test('without the token or with another: 401, -32001 "unauthorized" and nothing else', async () => {
        for (const token of [null, 'wrong']) {
            const answer = await call(port, 'state');
            assert.equal(answer.status, 200);
            const refused = await request(port, { token, body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'state' } } });
            assert.equal(refused.status, 401);
            assert.deepEqual(refused.json, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'unauthorized' } });
            const stream = await request(port, { method: 'GET', token });
            assert.equal(stream.status, 401);
        }
    });

    test('initialize, notifications/initialized, ping, tools/list', async () => {
        const init = await request(port, { body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } } });
        assert.equal(init.json.result.serverInfo.name, 'mindcraft-watch');
        const note = await request(port, { body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
        assert.equal(note.status, 202);
        assert.equal(note.text, '');
        assert.deepEqual((await request(port, { body: { jsonrpc: '2.0', id: 2, method: 'ping' } })).json.result, {});
        const list = await request(port, { body: { jsonrpc: '2.0', id: 3, method: 'tools/list' } });
        assert.equal(list.json.result.tools.length, 6);
    });

    test('an unknown method: -32601', async () => {
        const answer = await request(port, { body: { jsonrpc: '2.0', id: 4, method: 'prompts/list' } });
        assert.equal(answer.json.error.code, -32601);
    });

    test('a body over 64 KB: 413', async () => {
        const answer = await request(port, { body: { jsonrpc: '2.0', id: 5, method: 'ping', params: { pad: 'x'.repeat(70 * 1024) } } });
        assert.equal(answer.status, 413);
    });

    test('state and inventory from the agent', async () => {
        const state = await call(port, 'state');
        assert.match(state.json.result.content[0].text, /^Luna at \(12, 67, 52\) in overworld, on grass_block\. Time 1000 \(day\)\. Health 20 of 20, food 20 of 20\.\nRunning: nothing\./);
        const inventory = await call(port, 'inventory');
        assert.equal(inventory.json.result.content[0].text, 'Inventory: 3 bread.\nHand: empty. Off-hand: empty.');
    });

    test('chat: the lines of the players and of the bot', async () => {
        agent.bot.emit('chat', 'MartyByrde2', 'where are you?');
        agent.bot.emit('chat', 'Luna', 'an echo of the own line');
        await agent.openChat('I am at the farm.');
        assert.deepEqual(agent.said, ['I am at the farm.']); // the original runs
        const text = (await call(port, 'chat', { lines: 2 })).json.result.content[0].text;
        assert.match(text, /^\[\d\d:\d\d:\d\d\] MartyByrde2: where are you\?\n\[\d\d:\d\d:\d\d\] Luna: I am at the farm\.$/);
    });

    test('say: handed to handleMessage as the owner; a server command refused', async () => {
        const said = await call(port, 'say', { text: 'come here' });
        assert.equal(said.json.result.content[0].text, 'Said as MartyByrde2: "come here".');
        assert.equal(said.json.result.isError, undefined);
        assert.deepEqual(agent.handled.at(-1), ['MartyByrde2', 'come here']);
        const state = (await call(port, 'state')).json.result.content[0].text;
        assert.match(state, /Last order: "come here" by MartyByrde2, \d+ s ago\./);
        const refused = await call(port, 'say', { text: '/kill' });
        assert.equal(refused.json.result.isError, true);
        assert.equal(refused.json.result.content[0].text, 'I do not run server commands.');
        assert.equal(agent.handled.length, 1);
    });

    test('places', async () => {
        const text = (await call(port, 'places')).json.result.content[0].text;
        assert.equal(text, 'Areas: pen (pen) (0,64,0)-(6,66,6).\nNo mines.\nNo routes.\nNo rules.');
    });

    test('the stream: an event as notifications/message, and the events tool', async () => {
        const got = await new Promise((resolve, reject) => {
            const req = http.request({ host: '127.0.0.1', port, path: '/mcp', method: 'GET', headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'text/event-stream' } }, (res) => {
                assert.equal(res.statusCode, 200);
                assert.match(res.headers['content-type'], /text\/event-stream/);
                let text = '';
                res.on('data', (c) => {
                    text += c;
                    const data = text.split('\n').find((line) => line.startsWith('data: '));
                    if (data) {
                        req.destroy();
                        resolve(JSON.parse(data.slice(6)));
                    }
                });
                setImmediate(() => agent.bot._client.emit('explosion', { x: 10.5, y: 64, z: 3 }));
            });
            req.on('error', (error) => {
                if (error.code !== 'ECONNRESET')
                    reject(error);
            });
            req.end();
        });
        assert.equal(got.method, 'notifications/message');
        assert.equal(got.params.level, 'info');
        assert.equal(got.params.logger, 'events');
        assert.equal(got.params.data.kind, 'explosion');
        assert.equal(got.params.data.text, 'Explosion 4 blocks from the area "pen" at (10, 64, 3).');
        agent.bot.emit('death');
        const events = (await call(port, 'events')).json.result.content[0].text.split('\n');
        assert.match(events[0], /^\[\d\d:\d\d:\d\d\] restart: Luna started\.$/);
        assert.match(events.at(-2), /explosion: Explosion 4 blocks/);
        assert.match(events.at(-1), /death: Luna died at \(12, 67, 52\)\.$/);
    });

    test('the client: a tool, and a refusal as one line with exit 1', async () => {
        const ok = await runClient(port, ['inventory'], TOKEN);
        assert.equal(ok.code, 0);
        assert.equal(ok.out, 'Inventory: 3 bread.\nHand: empty. Off-hand: empty.\n');
        const refused = await runClient(port, ['state'], null);
        assert.equal(refused.code, 1);
        assert.equal(refused.out, 'The watch server refused the call: unauthorized.\n');
        const command = await runClient(port, ['say', '/kill'], TOKEN);
        assert.equal(command.code, 1);
        assert.equal(command.out, 'I do not run server commands.\n');
    });
});

describe('the close', () => {
    test('the listeners, the wrappers and the socket go', async () => {
        const agent = new FakeAgent();
        const server = await startWatchServer(agent, { port: 0, token: TOKEN });
        assert.ok(Object.prototype.hasOwnProperty.call(agent, 'openChat'));
        assert.equal(agent.bot.listenerCount('chat'), 1);
        await server.close();
        assert.ok(!Object.prototype.hasOwnProperty.call(agent, 'openChat'));
        assert.ok(!Object.prototype.hasOwnProperty.call(agent, 'handleMessage'));
        assert.equal(agent.bot.listenerCount('chat'), 0);
        assert.equal(agent.bot._client.listenerCount('explosion'), 0);
        await assert.rejects(request(server.port, { body: { jsonrpc: '2.0', id: 1, method: 'ping' } }));
    });
});

describe('the settings', () => {
    test('watch_server and watch_port are valid in settings.js and in the spec of the settings', async () => {
        const settings = (await import('../../settings.js')).default;
        assert.equal(typeof settings.watch_server, 'boolean');
        assert.ok(Number.isInteger(settings.watch_port) && settings.watch_port >= 1 && settings.watch_port <= 65535);
        const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'mindcraft', 'public', 'settings_spec.json'), 'utf8'));
        assert.equal(spec.watch_server.type, 'boolean');
        assert.equal(spec.watch_server.default, false);
        assert.equal(spec.watch_port.type, 'number');
        assert.equal(spec.watch_port.default, 8090);
    });
});
