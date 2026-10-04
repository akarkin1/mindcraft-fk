// Tester T1 of v0.1.4.12 "Understanding and watching", from the spec 4.1 (part C, the client): the pure parts of
// scripts/watch_logic.js (the request body of a call, the headers with the bearer, the parsing of an answer, a refusal
// as one line, the default URL, the stream line) and scripts/watch.js itself against a real server on a free port:
// the text of an answer with exit 0, a refusal with exit 1 and one line that says unauthorized and nothing of the state.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';

const W = await loadSrc('scripts/watch_logic.js');
const S = await loadSrc('src/agent/watch/server.js');

const TOKEN = `wv-client-${process.pid}-${Date.now()}`;

describe('4.1 the client: the request', () => {
    test('the default URL: http://127.0.0.1:8090/mcp', () => {
        assert.equal(W.DEFAULT_URL, 'http://127.0.0.1:8090/mcp');
    });

    test('the body of a call: JSON-RPC 2.0, tools/call with the name and the arguments', () => {
        const body = W.requestBody('chat', { lines: 20 }, 3);
        assert.deepEqual(body, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'chat', arguments: { lines: 20 } } });
        const plain = W.requestBody('state');
        assert.equal(plain.jsonrpc, '2.0');
        assert.equal(plain.method, 'tools/call');
        assert.deepEqual(plain.params, { name: 'state', arguments: {} });
        assert.ok(plain.id !== undefined && plain.id !== null, 'a request, not a notification');
    });

    test('the headers: Authorization: Bearer <token>, JSON', () => {
        const h = W.requestHeaders('abc');
        assert.equal(h.Authorization, 'Bearer abc');
        assert.match(h['Content-Type'], /application\/json/);
        assert.match(h.Accept, /application\/json/);
        assert.match(h.Accept, /text\/event-stream/);
    });

    test('the arguments of the command line: <tool> [json args]', () => {
        assert.deepEqual(W.parseCliArgs(['state']), { tool: 'state', args: {}, follow: false });
        assert.deepEqual(W.parseCliArgs(['chat', '{"lines": 20}']).args, { lines: 20 });
        assert.deepEqual(W.parseCliArgs(['say', '{"text": "come here"}']).args, { text: 'come here' });
        // v0.1.4.13 (part S): the stream is gone; --follow is a loop of wait any, events --follow is refused with the hint
        assert.equal(W.parseCliArgs(['wait', '--follow']).follow, true);
        assert.equal(W.parseCliArgs(['--follow']).tool, 'wait');
        assert.match(W.parseCliArgs(['events', '--follow']).error, /events --follow is gone: use --follow, a loop of wait any\./);
    });
});

describe('4.1 the client: the answer', () => {
    const answer = (result) => JSON.stringify({ jsonrpc: '2.0', id: 1, result });

    test('a text answer: ok and the text as the server gave it', () => {
        const r = W.parseAnswer(200, answer({ content: [{ type: 'text', text: 'Inventory: empty.\nHand: empty. Off-hand: empty.' }] }));
        assert.deepEqual(r, { ok: true, text: 'Inventory: empty.\nHand: empty. Off-hand: empty.' });
    });

    test('a refusal (isError): not ok, the text of the refusal in one line', () => {
        const r = W.parseAnswer(200, answer({ content: [{ type: 'text', text: 'I do not run server commands.' }], isError: true }));
        assert.equal(r.ok, false);
        assert.equal(r.text, 'I do not run server commands.');
        assert.ok(!r.text.includes('\n'));
    });

    test('401 -32001: not ok, one line that says unauthorized', () => {
        const r = W.parseAnswer(401, JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'unauthorized' } }));
        assert.equal(r.ok, false);
        assert.match(r.text, /unauthorized/);
        assert.ok(!r.text.includes('\n'));
    });

    test('401 without a body, 413, a body that is no JSON: not ok', () => {
        assert.equal(W.parseAnswer(401, '').ok, false);
        assert.match(W.parseAnswer(401, '').text, /unauthorized/);
        assert.equal(W.parseAnswer(413, '').ok, false);
        assert.equal(W.parseAnswer(200, 'not json').ok, false);
    });

    test('an error -32601: not ok', () => {
        assert.equal(W.parseAnswer(200, JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Unknown method: x.' } })).ok, false);
    });

    test('v0.1.4.13 (part S): the stream and its parser are gone; wait replaces them', () => {
        assert.equal(W.streamLine, undefined);
        assert.equal(W.createSseParser, undefined);
    });
});

// ------------------------------------------------------------------------------------------------ scripts/watch.js

function runClient(args, env) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [repoPath('scripts/watch.js'), ...args], {
            env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '';
        let err = '';
        child.stdout.on('data', (c) => { out += c; });
        child.stderr.on('data', (c) => { err += c; });
        const timer = setTimeout(() => child.kill(), 15000);
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ code, out, err });
        });
    });
}

describe('4.1 scripts/watch.js against a server', () => {
    let server;
    before(async () => {
        const bot = new EventEmitter();
        bot.username = 'Luna';
        bot.entity = { position: { x: 12.5, y: 67, z: 52.5 } };
        bot.health = 20;
        bot.food = 20;
        bot.time = { timeOfDay: 1000 };
        bot.game = { dimension: 'overworld' };
        bot.blockAt = () => ({ name: 'grass_block' });
        bot.inventory = { items: () => [{ name: 'bread', count: 3 }], slots: [] };
        bot.entities = {};
        bot._client = new EventEmitter();
        server = await S.startWatchServer({ name: 'Luna', bot, area_store: { list: () => [] }, async handleMessage() {}, async openChat() {} },
            { port: 0, token: TOKEN });
    });
    after(async () => {
        await server?.close?.();
    });

    test('inventory with the token: the text, exit 0', async () => {
        const r = await runClient(['inventory'], { MC_WATCH_URL: `http://127.0.0.1:${server.port}/mcp`, MC_WATCH_TOKEN: TOKEN });
        assert.equal(r.code, 0, r.err);
        assert.match(r.out, /^Inventory: 3 bread\./);
    });

    test('without the token: exit 1, one line that says unauthorized, nothing of the state', async () => {
        const r = await runClient(['state'], { MC_WATCH_URL: `http://127.0.0.1:${server.port}/mcp` });
        assert.equal(r.code, 1);
        const all = `${r.out}${r.err}`.trim();
        assert.equal(all.split('\n').length, 1, all);
        assert.match(all, /unauthorized/);
        assert.doesNotMatch(all, /Luna|overworld|Health/);
    });

    test('with a wrong token: exit 1', async () => {
        const r = await runClient(['state'], { MC_WATCH_URL: `http://127.0.0.1:${server.port}/mcp`, MC_WATCH_TOKEN: `${TOKEN}x` });
        assert.equal(r.code, 1);
        assert.match(`${r.out}${r.err}`, /unauthorized/);
    });

    test('say "/kill": exit 1 with the refusal', async () => {
        const r = await runClient(['say', '{"text": "/kill"}'], { MC_WATCH_URL: `http://127.0.0.1:${server.port}/mcp`, MC_WATCH_TOKEN: TOKEN });
        assert.equal(r.code, 1);
        assert.match(`${r.out}${r.err}`, /I do not run server commands\./);
    });
});
