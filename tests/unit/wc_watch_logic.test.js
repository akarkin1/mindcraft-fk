// Spec v0.1.4.12 4.1 (part C): the pure parts of the client scripts/watch.js: arguments, request bodies, answers.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_URL, EXIT, parseAnswer, parseCliArgs, requestBody, requestHeaders } from '../../scripts/watch_logic.js';
// v0.1.4.13 (S): the stream of events is gone (createSseParser, streamLine); `events --follow` is refused with a hint,
// `--follow` is a loop of `wait any` (tested in xs_watch_logic.test.js).

describe('the arguments', () => {
    test('<tool> [json args]', () => {
        assert.deepEqual(parseCliArgs(['state']), { tool: 'state', args: {}, follow: false });
        assert.deepEqual(parseCliArgs(['chat', '{"lines": 20}']), { tool: 'chat', args: { lines: 20 }, follow: false });
        assert.deepEqual(parseCliArgs(['say', '{"text":"come here"}']), { tool: 'say', args: { text: 'come here' }, follow: false });
    });

    test('plain words', () => {
        assert.deepEqual(parseCliArgs(['say', 'come here']), { tool: 'say', args: { text: 'come here' }, follow: false });
        assert.deepEqual(parseCliArgs(['say', 'come', 'here']).args, { text: 'come here' });
        assert.deepEqual(parseCliArgs(['chat', '5']).args, { lines: 5 });
        assert.deepEqual(parseCliArgs(['events', '2026-10-03T13:00:00Z']).args, { since: '2026-10-03T13:00:00Z' });
    });

    test('events --follow is gone: a hint and the usage (v0.1.4.13)', () => {
        const parsed = parseCliArgs(['events', '--follow']);
        assert.ok(parsed.error.startsWith('events --follow is gone: use --follow, a loop of wait any.'));
    });

    test('no tool, broken JSON, --follow on another tool: the usage', () => {
        assert.ok(parseCliArgs([]).error.startsWith('Usage: node scripts/watch.js <tool> [json args]'));
        assert.ok(parseCliArgs(['chat', '{lines']).error);
        assert.ok(parseCliArgs(['state', '--follow']).error);
        assert.equal(EXIT.REFUSED, 1);
    });
});

describe('the request', () => {
    test('the body of tools/call', () => {
        assert.deepEqual(requestBody('say', { text: 'come here' }, 3), { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'say', arguments: { text: 'come here' } } });
        assert.deepEqual(requestBody('state').params, { name: 'state', arguments: {} });
    });

    test('the headers: the bearer token, none without a token', () => {
        assert.equal(requestHeaders('abc').Authorization, 'Bearer abc');
        assert.equal(requestHeaders('').Authorization, undefined);
        assert.equal(requestHeaders(undefined)['Content-Type'], 'application/json');
        assert.equal(DEFAULT_URL, 'http://127.0.0.1:8090/mcp');
    });
});

describe('the answer', () => {
    test('a result: its text', () => {
        const body = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'Inventory: empty.\nHand: empty. Off-hand: empty.' }] } });
        assert.deepEqual(parseAnswer(200, body), { ok: true, text: 'Inventory: empty.\nHand: empty. Off-hand: empty.' });
    });

    test('a refusal of the tool: one line, not ok', () => {
        const body = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'I do not run server commands.' }], isError: true } });
        assert.deepEqual(parseAnswer(200, body), { ok: false, text: 'I do not run server commands.' });
    });

    test('unauthorized: one line that says unauthorized and nothing else', () => {
        const body = JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'unauthorized' } });
        assert.deepEqual(parseAnswer(401, body), { ok: false, text: 'The watch server refused the call: unauthorized.' });
        assert.deepEqual(parseAnswer(401, ''), { ok: false, text: 'The watch server refused the call: unauthorized.' });
    });

    test('an error of JSON-RPC, a body that is no JSON', () => {
        const body = JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Unknown tool: kill.' } });
        assert.deepEqual(parseAnswer(200, body), { ok: false, text: 'The watch server refused the call: Unknown tool: kill.' });
        assert.deepEqual(parseAnswer(502, '<html>'), { ok: false, text: 'The watch server refused the call: HTTP 502.' });
    });
});

