// Spec v0.1.4.13 4.1 (part S): the client scripts/watch.js: the arguments and the request bodies of digest, wait,
// run, look and server; --follow as a loop of wait any with the cursor of the last answer; the usage.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { USAGE, cursorOf, nextWaitArgs, parseCliArgs, requestBody, requestHeaders, waitArgs } from '../../scripts/watch_logic.js';

describe('the arguments', () => {
    test('digest [since]', () => {
        assert.deepEqual(parseCliArgs(['digest']), { tool: 'digest', args: {}, follow: false });
        assert.deepEqual(parseCliArgs(['digest', '184']), { tool: 'digest', args: { since: '184' }, follow: false });
        assert.deepEqual(requestBody('digest', { since: '184' }, 2), { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'digest', arguments: { since: '184' } } });
    });

    test('wait [for] [timeout]', () => {
        assert.deepEqual(parseCliArgs(['wait']), { tool: 'wait', args: {}, follow: false });
        assert.deepEqual(parseCliArgs(['wait', 'idle', '30']).args, { for: 'idle', timeout: 30 });
        assert.deepEqual(parseCliArgs(['wait', '30']).args, { timeout: 30 });
        assert.deepEqual(parseCliArgs(['wait', 'event']).args, { for: 'event' });
        assert.deepEqual(waitArgs(['done', '5', '184']), { for: 'done', timeout: 5, since: '184' });
        assert.deepEqual(parseCliArgs(['wait', '{"for":"done","timeout":5}']).args, { for: 'done', timeout: 5 });
    });

    test("run '<cmd>' '<cmd>' ...", () => {
        const parsed = parseCliArgs(['run', '!takeFromChest("bread", 10)', '!mineOre("diamond", 28)']);
        assert.deepEqual(parsed, { tool: 'run', args: { commands: ['!takeFromChest("bread", 10)', '!mineOre("diamond", 28)'] }, follow: false });
        assert.deepEqual(requestBody('run', parsed.args).params, { name: 'run', arguments: { commands: ['!takeFromChest("bread", 10)', '!mineOre("diamond", 28)'] } });
        assert.deepEqual(parseCliArgs(['run', '{"commands":["!stats"],"stop_on_failure":false}']).args, { commands: ['!stats'], stop_on_failure: false });
    });

    test('look [radius], server', () => {
        assert.deepEqual(parseCliArgs(['look']).args, {});
        assert.deepEqual(parseCliArgs(['look', '8']).args, { radius: 8 });
        assert.deepEqual(parseCliArgs(['server']), { tool: 'server', args: {}, follow: false });
        assert.deepEqual(requestBody('server').params, { name: 'server', arguments: {} });
    });

    test('--follow: a loop of wait any, alone or with wait', () => {
        assert.deepEqual(parseCliArgs(['--follow']), { tool: 'wait', args: { for: 'any' }, follow: true });
        assert.deepEqual(parseCliArgs(['wait', '--follow', '30']), { tool: 'wait', args: { timeout: 30, for: 'any' }, follow: true });
        assert.ok(parseCliArgs(['events', '--follow']).error.startsWith('events --follow is gone: use --follow, a loop of wait any.'));
        assert.ok(parseCliArgs(['digest', '--follow']).error.startsWith('Usage:'));
    });

    test('the usage lists the tools and says what --follow is', () => {
        for (const tool of ['digest', 'wait', 'run', 'look', 'server', '--follow'])
            assert.ok(USAGE.includes(tool), tool);
        assert.ok(USAGE.includes('replaces events --follow'));
        assert.match(requestHeaders('t').Accept, /application\/json/); // the Accept of an MCP client, unchanged
    });
});

describe('the loop of --follow', () => {
    test('the cursor of an answer feeds the next wait', () => {
        assert.equal(cursorOf('Woke: timeout.\nCursor: 184.\nNothing changed.'), '184');
        assert.equal(cursorOf('Cursor: 1.'), '1');
        assert.equal(cursorOf('The watch server refused the call: unauthorized.'), null);
        assert.deepEqual(nextWaitArgs({ timeout: 30 }, null), { timeout: 30, for: 'any' });
        assert.deepEqual(nextWaitArgs({ timeout: 30, for: 'any' }, '184'), { timeout: 30, for: 'any', since: '184' });
        assert.deepEqual(nextWaitArgs({ for: 'idle' }, 5), { for: 'any', since: '5' });
    });
});
