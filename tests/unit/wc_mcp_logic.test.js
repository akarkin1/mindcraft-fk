// Spec v0.1.4.12 4.1 (part C): the JSON-RPC parsing and answers of the watch server, without a socket.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_PROTOCOL, ERRORS, MAX_BODY, SERVER_INFO, TOOLS, TOOL_NAMES, authorized, bearerOf, dispatch,
    handleRpc, tokenHash, tooLargeAnswer, toolResult, unauthorizedAnswer,
} from '../../src/agent/watch/mcp_logic.js';
// v0.1.4.13 (S): the stream of server-sent events is gone (wait replaces it), so are eventNotification and sseMessage;
// the server says the version of this release; the table holds the five tools of 4.1 after the six of v0.1.4.12.

const callTool = async (name, args) => ({ text: `${name}:${JSON.stringify(args)}`, isError: name === 'say' && args.text === '/kill' });

describe('initialize', () => {
    test('the protocol version as the client sent it, the tools capability, the server info', async () => {
        const answer = await handleRpc(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }), { callTool });
        assert.equal(answer.status, 200);
        assert.deepEqual(answer.body, {
            jsonrpc: '2.0', id: 1,
            result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'mindcraft-watch', version: '0.1.4.13' } },
        });
        assert.deepEqual(SERVER_INFO, { name: 'mindcraft-watch', version: '0.1.4.13' });
    });

    test('without a version: 2025-03-26', async () => {
        const answer = await handleRpc('{"jsonrpc":"2.0","id":"a","method":"initialize"}', { callTool });
        assert.equal(answer.body.result.protocolVersion, '2025-03-26');
        assert.equal(DEFAULT_PROTOCOL, '2025-03-26');
    });

    test('notifications/initialized: 202 without a body', async () => {
        const answer = await handleRpc('{"jsonrpc":"2.0","method":"notifications/initialized"}', { callTool });
        assert.deepEqual(answer, { status: 202, body: null });
    });

    test('ping: an empty result', async () => {
        const answer = await handleRpc('{"jsonrpc":"2.0","id":7,"method":"ping"}', { callTool });
        assert.deepEqual(answer.body, { jsonrpc: '2.0', id: 7, result: {} });
    });
});

describe('tools/list', () => {
    test('the six tools with their JSON schemas', async () => {
        const answer = await handleRpc('{"jsonrpc":"2.0","id":2,"method":"tools/list"}', { callTool });
        const tools = answer.body.result.tools;
        assert.deepEqual(tools.map((t) => t.name).slice(0, 6), ['state', 'inventory', 'chat', 'places', 'events', 'say']);
        assert.deepEqual(TOOL_NAMES.slice(0, 6), ['state', 'inventory', 'chat', 'places', 'events', 'say']);
        for (const tool of tools) {
            assert.equal(typeof tool.description, 'string');
            assert.equal(tool.inputSchema.type, 'object');
        }
        const byName = Object.fromEntries(tools.map((t) => [t.name, t.inputSchema]));
        assert.deepEqual(byName.chat.properties.lines, { type: 'integer', minimum: 1, maximum: 50, default: 10, description: 'How many lines, 1 to 50.' });
        assert.equal(byName.events.properties.since.type, 'string');
        assert.deepEqual(byName.say.required, ['text']);
        assert.equal(byName.say.properties.text.minLength, 1);
        assert.equal(byName.say.properties.text.maxLength, 256);
        assert.deepEqual(byName.state.properties, {});
        assert.equal(TOOLS.length, 11); // v0.1.4.13 (S): six of v0.1.4.12 and digest, wait, run, look, server
    });
});

describe('tools/call', () => {
    test('the result as content of type text', async () => {
        const answer = await handleRpc(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'chat', arguments: { lines: 5 } } }), { callTool });
        assert.equal(answer.status, 200);
        assert.deepEqual(answer.body, { jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: 'chat:{"lines":5}' }] } });
    });

    test('isError: true on a refusal', async () => {
        const answer = await handleRpc(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'say', arguments: { text: '/kill' } } }), { callTool });
        assert.equal(answer.body.result.isError, true);
    });

    test('without arguments: an empty object', async () => {
        const seen = [];
        await dispatch({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'state' } }, { callTool: async (n, a) => { seen.push([n, a]); return { text: 'x' }; } });
        assert.deepEqual(seen, [['state', {}]]);
    });

    test('an unknown tool: -32602', async () => {
        const answer = await handleRpc(JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'kill' } }), { callTool });
        assert.equal(answer.body.error.code, -32602);
        assert.equal(answer.body.error.message, 'Unknown tool: kill.');
    });

    test('a tool that throws: a text with isError, never a throw', async () => {
        const answer = await dispatch({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'state' } }, { callTool: async () => { throw new Error('boom'); } });
        assert.deepEqual(answer.result, { content: [{ type: 'text', text: 'The tool state failed: boom.' }], isError: true });
    });

    test('toolResult', () => {
        assert.deepEqual(toolResult('a'), { content: [{ type: 'text', text: 'a' }] });
        assert.deepEqual(toolResult('b', true), { content: [{ type: 'text', text: 'b' }], isError: true });
    });
});

describe('errors', () => {
    test('an unknown method: -32601', async () => {
        const answer = await handleRpc('{"jsonrpc":"2.0","id":9,"method":"resources/list"}', { callTool });
        assert.equal(answer.status, 200);
        assert.equal(answer.body.error.code, -32601);
        assert.equal(answer.body.id, 9);
        assert.equal(ERRORS.methodNotFound, -32601);
    });

    test('no JSON: -32700 with 400', async () => {
        const answer = await handleRpc('{oops', { callTool });
        assert.equal(answer.status, 400);
        assert.equal(answer.body.error.code, -32700);
    });

    test('no JSON-RPC 2.0: -32600', async () => {
        const answer = await handleRpc('{"id":1,"method":"ping"}', { callTool });
        assert.equal(answer.status, 400);
        assert.equal(answer.body.error.code, -32600);
    });

    test('unauthorized: 401 with -32001 "unauthorized" and nothing else', () => {
        assert.deepEqual(unauthorizedAnswer(), { status: 401, body: { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'unauthorized' } } });
    });

    test('over 64 KB: 413', () => {
        assert.equal(MAX_BODY, 65536);
        assert.equal(tooLargeAnswer().status, 413);
    });

    test('a batch gets an array of the answers', async () => {
        const answer = await handleRpc('[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","method":"notifications/initialized"}]', { callTool });
        assert.equal(answer.status, 200);
        assert.deepEqual(answer.body, [{ jsonrpc: '2.0', id: 1, result: {} }]);
    });
});

describe('the token', () => {
    const wanted = tokenHash('s3cret-token');

    test('bearerOf', () => {
        assert.equal(bearerOf('Bearer abc'), 'abc');
        assert.equal(bearerOf('bearer  abc '), 'abc');
        assert.equal(bearerOf('Basic abc'), null);
        assert.equal(bearerOf(undefined), null);
    });

    test('the right token passes, every other is refused', () => {
        assert.equal(authorized('Bearer s3cret-token', wanted), true);
        assert.equal(authorized('Bearer s3cret-tokeN', wanted), false);
        assert.equal(authorized('Bearer s3cret', wanted), false);
        assert.equal(authorized(undefined, wanted), false);
        assert.equal(authorized('', wanted), false);
        assert.equal(authorized('s3cret-token', wanted), false);
        assert.equal(authorized('Bearer s3cret-token', null), false);
    });

    test('tokenHash: 32 bytes, null without a token', () => {
        assert.equal(wanted.length, 32);
        assert.equal(tokenHash(''), null);
        assert.equal(tokenHash(undefined), null);
    });
});

describe('the stream', () => {
    test('v0.1.4.13 (S): there is no stream; the tools of the server (handlers.tools) win over the table', async () => {
        const tools = [{ name: 'reply', description: 'x', inputSchema: { type: 'object', properties: {} } }];
        const list = await handleRpc('{"jsonrpc":"2.0","id":2,"method":"tools/list"}', { callTool, tools: () => tools });
        assert.deepEqual(list.body.result.tools.map((t) => t.name), ['reply']);
        const known = await handleRpc(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'reply', arguments: {} } }), { callTool, tools });
        assert.equal(known.body.result.content[0].text, 'reply:{}');
        const unknown = await handleRpc(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'state' } }), { callTool, tools });
        assert.equal(unknown.body.error.code, -32602);
    });
});
