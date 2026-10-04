// v0.1.4.13 (the owner, 2026-10-04): watch_local_only. On the owner's machine the supervisor runs beside the bot, so the
// watch server needs no token; a request that came through a tunnel (whose requests also arrive from 127.0.0.1), from
// a browser page (another Host, a body that is not JSON) is refused. No Minecraft; every server is closed at the end.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { startWatchServer } from '../../src/agent/watch/server.js';
import { localRefusal } from '../../src/agent/watch/mcp_logic.js';
import { TEXTS } from '../../src/agent/watch/texts.js';

function fakeAgent() {
    const bot = new EventEmitter();
    Object.assign(bot, { username: 'Luna', health: 20, food: 20, time: { timeOfDay: 1000 }, game: { dimension: 'overworld' },
        entity: { position: { x: 0.5, y: 64, z: 0.5, offset: () => ({ x: 0.5, y: 63.5, z: 0.5 }) } }, blockAt: () => ({ name: 'stone' }),
        inventory: { items: () => [], slots: [] }, heldItem: null, entities: {}, _client: new EventEmitter() });
    return { name: 'Luna', bot, actions: { currentActionLabel: '' }, handleMessage: async () => true, openChat: async () => {} };
}

function post(port, { headers = {}, body = { jsonrpc: '2.0', id: 1, method: 'tools/list' } } = {}) {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } }, (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { text += c; });
            res.on('end', () => resolve({ status: res.statusCode, text }));
        });
        req.on('error', reject);
        req.end(data);
    });
}

describe('watch_local_only: the rule', () => {
    test('a direct call of this machine passes', () => {
        assert.equal(localRefusal({ host: '127.0.0.1:8090', 'content-type': 'application/json' }), null);
        assert.equal(localRefusal({ host: 'localhost:8090', 'content-type': 'application/json; charset=utf-8' }), null);
    });

    test('a tunnel, another host, a body that is not JSON are refused', () => {
        assert.match(localRefusal({ host: '127.0.0.1:8090', 'content-type': 'application/json', 'cf-ray': 'x' }), /tunnel \(cf-ray\)/);
        assert.match(localRefusal({ host: '127.0.0.1:8090', 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' }), /tunnel/);
        assert.match(localRefusal({ host: 'evil.example:8090', 'content-type': 'application/json' }), /not this machine/);
        assert.match(localRefusal({ host: '127.0.0.1:8090', 'content-type': 'text/plain' }), /not JSON/);
    });
});

describe('watch_local_only: the server', () => {
    test('without a token and without the setting the server does not start (as before)', async () => {
        const r = await startWatchServer(fakeAgent(), { port: 0 });
        assert.equal(r.reason, 'no_token');
        await r.close();
    });

    test('without a token, for this machine only: tools/list answers; a tunnel and a browser page get 403', async () => {
        const r = await startWatchServer(fakeAgent(), { port: 0, localOnly: true });
        try {
            assert.equal(r.ok, true, r.text);
            assert.equal(r.text, TEXTS.startedLocal(r.port));
            const ok = await post(r.port);
            assert.equal(ok.status, 200);
            assert.match(ok.text, /"digest"/);
            const tunnel = await post(r.port, { headers: { 'Cf-Connecting-Ip': '203.0.113.7' } });
            assert.equal(tunnel.status, 403);
            assert.match(tunnel.text, /for this machine only: the request came through a tunnel/);
            const page = await post(r.port, { headers: { Host: 'evil.example' } });
            assert.equal(page.status, 403);
            const form = await post(r.port, { headers: { 'Content-Type': 'text/plain' } });
            assert.equal(form.status, 403);
        } finally {
            await r.close();
        }
    });

    test('with a token and the setting: the token is still asked for', async () => {
        const r = await startWatchServer(fakeAgent(), { port: 0, localOnly: true, token: 'tok-123' });
        try {
            assert.equal((await post(r.port)).status, 401);
            assert.equal((await post(r.port, { headers: { Authorization: 'Bearer tok-123' } })).status, 200);
        } finally {
            await r.close();
        }
    });
});
