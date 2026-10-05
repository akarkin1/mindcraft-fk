// Spec v0.1.4.13 4.1 (part S): the schemas of digest, wait, run, look and server in mcp_logic; registerTool of
// tools.js: a tool of another part (N2: reply, note) is listed and called without editing the table.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, TOOL_NAMES, handleRpc } from '../../src/agent/watch/mcp_logic.js';
import { TOOL_HANDLERS, argsRefusal, registerTool, runTool, toolList, unregisterTool } from '../../src/agent/watch/tools.js';

describe('the schemas', () => {
    const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

    test('the eleven tools, the five of 4.1 after the six of v0.1.4.12', () => {
        assert.deepEqual(TOOL_NAMES, ['state', 'inventory', 'chat', 'places', 'events', 'say', 'digest', 'wait', 'run', 'look', 'server']);
        assert.deepEqual(Object.keys(TOOL_HANDLERS), TOOL_NAMES);
        for (const tool of TOOLS) {
            assert.equal(typeof tool.description, 'string');
            assert.ok(tool.description.length > 20, tool.name);
            assert.equal(tool.inputSchema.type, 'object');
            assert.equal(tool.inputSchema.additionalProperties, false);
        }
    });

    test('digest: since, a string', () => {
        assert.deepEqual(Object.keys(byName.digest.inputSchema.properties), ['since']);
        assert.equal(byName.digest.inputSchema.properties.since.type, 'string');
        assert.equal(byName.digest.inputSchema.required, undefined);
    });

    test('wait: for of the four rules, timeout 1 to 55 default 55, since', () => {
        const props = byName.wait.inputSchema.properties;
        assert.deepEqual(props.for.enum, ['event', 'idle', 'done', 'any']);
        assert.deepEqual(props.timeout, { type: 'integer', minimum: 1, maximum: 55, default: 55, description: 'Seconds, 1 to 55.' });
        assert.equal(props.since.type, 'string');
    });

    test('run: commands 1 to 10 strings, stop_on_failure default true', () => {
        const schema = byName.run.inputSchema;
        assert.deepEqual(schema.required, ['commands']);
        assert.deepEqual(schema.properties.commands.items, { type: 'string' });
        assert.equal(schema.properties.commands.minItems, 1);
        assert.equal(schema.properties.commands.maxItems, 10);
        assert.deepEqual(schema.properties.stop_on_failure, { type: 'boolean', default: true, description: 'Stop at the first failure.' });
    });

    test('look: radius 4 to 32 default 16; server: no arguments', () => {
        assert.deepEqual(byName.look.inputSchema.properties.radius, { type: 'integer', minimum: 4, maximum: 32, default: 16, description: 'Blocks, 4 to 32.' });
        assert.deepEqual(byName.server.inputSchema.properties, {});
    });

    test('tools/list over the protocol holds the eleven', async () => {
        const answer = await handleRpc('{"jsonrpc":"2.0","id":1,"method":"tools/list"}', { callTool: async () => null });
        assert.equal(answer.body.result.tools.length, 11);
    });
});

describe('registerTool', () => {
    test('a tool of another part is listed after the table, called with its arguments, refused by its own rule', async () => {
        const seen = [];
        const ok = registerTool('reply', {
            description: 'The answer of the supervisor, relayed into the chat.',
            inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
            refusal: (args) => (typeof args.text === 'string' && args.text !== '' ? null : 'The text must have 1 to 256 characters.'),
        }, async (agent, args, watch, request) => {
            seen.push([agent.name, args, watch.tag, typeof request]);
            return `[Opus] ${args.text}`;
        });
        assert.equal(ok, true);
        const list = toolList();
        assert.equal(list.length, 12);
        assert.deepEqual(list.at(-1), { name: 'reply', description: 'The answer of the supervisor, relayed into the chat.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } });
        assert.deepEqual(await runTool({ name: 'Luna' }, { tag: 'w' }, 'reply', { text: 'It is in the tunnel.' }), { text: '[Opus] It is in the tunnel.', isError: false });
        assert.deepEqual(seen, [['Luna', { text: 'It is in the tunnel.' }, 'w', 'object']]);
        assert.deepEqual(await runTool({}, {}, 'reply', {}), { text: 'The text must have 1 to 256 characters.', isError: true });
        assert.equal(argsRefusal('reply', { text: '' }), 'The text must have 1 to 256 characters.');
        const rpc = await handleRpc(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'reply', arguments: { text: 'hi' } } }), { tools: () => toolList(), callTool: (name, args) => runTool({ name: 'Luna' }, {}, name, args) });
        assert.equal(rpc.body.result.content[0].text, '[Opus] hi');
        assert.equal(unregisterTool('reply'), true);
        assert.equal(await runTool({}, {}, 'reply', { text: 'x' }), null);
        assert.equal(toolList().length, 11);
    });

    test('a name of the table, a bad name or no handler is refused', () => {
        assert.equal(registerTool('state', {}, async () => 'x'), false);
        assert.equal(registerTool('Bad Name', {}, async () => 'x'), false);
        assert.equal(registerTool('note', {}, null), false);
        assert.equal(toolList().length, 11);
    });
});
