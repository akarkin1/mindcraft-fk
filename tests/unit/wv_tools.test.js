// Tester T1 of v0.1.4.12 "Understanding and watching", from the spec 4.1 (part C, the table of the tools): the texts
// of state, inventory, chat, places, events and say, called as a Claude session calls them (tools/call over HTTP on a
// free port of 127.0.0.1) against a fixture agent: Luna at (12, 67, 52) on oak_planks, night, a running
// !farmCycle("farm"), a job, a last order of MartyByrde2, the place home 2 blocks away. The clock of the server is
// the fixture's clock (13:45:02 local time), so the lines carry the times of the spec. Every server is closed.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { loadSrc } from '../helpers/load.js';

const S = await loadSrc('src/agent/watch/server.js');

const TOKEN = `wv-tools-${process.pid}-${Date.now()}`;
const T0 = new Date(2026, 9, 3, 13, 45, 2).getTime(); // 13:45:02 local, as clockText prints it
const clock = { t: T0 };
const now = () => clock.t;

function fixtureAgent({ empty = false } = {}) {
    const bot = new EventEmitter();
    bot.username = 'Luna';
    bot.entity = { position: { x: 12.5, y: 67, z: 52.5 } };
    bot.health = 20;
    bot.food = 18;
    bot.time = { timeOfDay: 13500 };
    bot.game = { dimension: 'overworld' };
    bot.isSleeping = false;
    bot.blockAt = (p) => ({ name: p.y < 67 ? 'oak_planks' : 'air' });
    const items = empty ? [] : [
        { name: 'oak_log', count: 12 },
        { name: 'stone_pickaxe', count: 1 },
        { name: 'cobblestone', count: 40 },
        { name: 'cobblestone', count: 24 }, // two stacks: 64 in all
    ];
    const slots = [];
    if (!empty) slots[45] = { name: 'bread', count: 3 };
    bot.inventory = { items: () => items, slots };
    bot.heldItem = empty ? null : { name: 'stone_pickaxe', count: 1 };
    bot.entities = {};
    bot._client = new EventEmitter();

    const agent = {
        name: 'Luna',
        bot,
        handled: [],
        said: [],
        shut_up: true,
        running_commands: empty ? [] : [{ name: '!farmCycle', text: '!farmCycle("farm")' }],
        actions: empty ? { currentActionLabel: '' } : { currentActionLabel: 'action:farmCycle', last_action_time: T0 - 42000 },
        job: empty ? null : { status: () => 'Job: the mining, 4 of 8 iron.', get: () => null },
        memory_bank: empty ? { recallPlace: () => null } : { recallPlace: (name) => (name === 'home' ? [10, 67, 52] : null) },
        area_store: {
            list: () => (empty ? [] : [
                { name: 'home', kind: 'home', type: 'home', dimension: 'overworld', min: { x: 10, y: 66, z: 50 }, max: { x: 14, y: 70, z: 54 } },
                { name: 'basement', kind: 'building', type: 'building', dimension: 'overworld', min: { x: 10, y: 60, z: 50 }, max: { x: 14, y: 63, z: 54 } },
            ]),
        },
        _workStores: () => ({ mines: { list: () => (empty ? [] : [{ name: 'mine', entrance: { x: 9, y: 67, z: 52 }, tunnels: [{}, {}] }]) } }),
        homeContext: () => ({ routes: { store: { list: () => (empty ? [] : [{ name: 'basement' }, { name: 'mine' }]) } } }),
        rule_store: { list: () => (empty ? [] : [{ id: 1, text: 'Never break the fence of the pen' }]) },
        async handleMessage(source, message) { this.handled.push([source, message]); return true; },
        async openChat(message) { this.said.push(message); },
    };
    return agent;
}

function call(port, name, args = {}) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
        const req = http.request({
            host: '127.0.0.1', port, path: '/mcp', method: 'POST', agent: false,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, 'Content-Length': Buffer.byteLength(data) },
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                const result = json.result ?? {};
                resolve({ text: (result.content ?? []).map((c) => c.text).join('\n'), isError: result.isError === true, json });
            });
        });
        req.on('error', reject);
        req.end(data);
    });
}

let full;
let empty;
let fullAgent;
let emptyAgent;
before(async () => {
    fullAgent = fixtureAgent();
    emptyAgent = fixtureAgent({ empty: true });
    full = await S.startWatchServer(fullAgent, { port: 0, token: TOKEN, now, settings: { only_chat_with: ['MartyByrde2'] } });
    empty = await S.startWatchServer(emptyAgent, { port: 0, token: TOKEN, now, settings: { only_chat_with: [] } });
});
after(async () => {
    await full?.close?.();
    await empty?.close?.();
});

describe('4.1 state', () => {
    // FINDING (low harm): the spec's example prints the bot at (12, 67, 52) and home at (10, 67, 52), "2 blocks away".
    // The code measures from the exact position (12.5, 67, 52.5) to the corner of the home block and says "3 blocks
    // away": the two cells it prints are 2 apart. Left failing.
    test('the five lines of the spec, in order', async () => {
        clock.t = T0 - 3 * 60 * 1000;
        await fullAgent.handleMessage('MartyByrde2', 'go to the farm'); // the last order, 3 min before
        clock.t = T0;
        const { text, isError } = await call(full.port, 'state');
        assert.equal(isError, false);
        assert.deepEqual(text.split('\n'), [
            'Luna at (12, 67, 52) in overworld, on oak_planks. Time 13500 (night). Health 20 of 20, food 18 of 20.',
            'Running: !farmCycle("farm") for 42 s.',
            'Job: the mining, 4 of 8 iron.',
            'Last order: "go to the farm" by MartyByrde2, 3 min ago.',
            'Home: (10, 67, 52), 2 blocks away.',
        ]);
    });

    test('nothing running, no job, no order, no home', async () => {
        const { text } = await call(empty.port, 'state');
        const lines = text.split('\n');
        assert.equal(lines.length, 5, text);
        assert.match(lines[0], /^Luna at \(12, 67, 52\) in overworld, on oak_planks\. Time 13500 \(night\)\. Health 20 of 20, food 18 of 20\.$/);
        assert.deepEqual(lines.slice(1), ['Running: nothing.', 'Job: none.', 'Last order: none.', 'Home: unknown.']);
    });
});

describe('4.1 inventory', () => {
    test('sorted by count, then the hands', async () => {
        const { text } = await call(full.port, 'inventory');
        assert.deepEqual(text.split('\n'), [
            'Inventory: 64 cobblestone, 12 oak_log, 1 stone_pickaxe.',
            'Hand: stone_pickaxe. Off-hand: bread.',
        ]);
    });

    test('empty: "Inventory: empty."', async () => {
        const { text } = await call(empty.port, 'inventory');
        assert.equal(text.split('\n')[0], 'Inventory: empty.');
    });
});

describe('4.1 chat', () => {
    test('no line yet: "No chat yet."', async () => {
        const { text } = await call(empty.port, 'chat');
        assert.equal(text, 'No chat yet.');
    });

    test('a player line and the bot line, oldest first, each [hh:mm:ss] name: text', async () => {
        clock.t = T0;
        fullAgent.bot.emit('chat', 'MartyByrde2', 'go to the farm');
        clock.t = T0 + 1000;
        await fullAgent.openChat('I go to the farm.'); // the bot's own line, with its name
        clock.t = T0 + 2000;
        const { text } = await call(full.port, 'chat', { lines: 10 });
        const lines = text.split('\n');
        assert.deepEqual(lines.slice(-2), ['[13:45:02] MartyByrde2: go to the farm', '[13:45:03] Luna: I go to the farm.']);
    });

    test('lines: 1 gives the last line only', async () => {
        const { text } = await call(full.port, 'chat', { lines: 1 });
        assert.equal(text, '[13:45:03] Luna: I go to the farm.');
    });
});

describe('4.1 places', () => {
    test('areas with kind and box, mines, routes, rules', async () => {
        const { text } = await call(full.port, 'places');
        const lines = text.split('\n');
        assert.ok(lines[0].startsWith('Areas: home (home) (10,66,50)-(14,70,54); basement (building) (10,60,50)-(14,63,54)'), lines[0]);
        assert.ok(lines.includes('Mines: mine, entrance (9, 67, 52), 2 tunnels.'), text);
        assert.ok(lines.includes('Routes: basement, mine.'), text);
        assert.ok(lines.some((l) => l.startsWith('Rules: 1. Never break the fence of the pen')), text);
    });

    test('an empty store: "No areas."', async () => {
        const { text } = await call(empty.port, 'places');
        assert.equal(text.split('\n')[0], 'No areas.');
    });
});

describe('4.1 events', () => {
    test('no event but the start: the restart event "Luna started."; with since after it: "No events."', async () => {
        const { text } = await call(empty.port, 'events');
        assert.match(text, /Luna started\./);
        const later = new Date(T0 + 60 * 60 * 1000).toISOString();
        const r = await call(empty.port, 'events', { since: later });
        assert.equal(r.text, 'No events.');
    });

    test('since: only the events after it, oldest first', async () => {
        const t1 = T0 + 10 * 1000;
        const t2 = T0 + 20 * 1000;
        full.push({ t: new Date(t1).toISOString(), kind: 'health', text: 'Health fell from 20 to 14 at (12, 67, 52).', data: {} });
        full.push({ t: new Date(t2).toISOString(), kind: 'death', text: 'Luna died at (12, 67, 52).', data: {} });
        const { text } = await call(full.port, 'events', { since: new Date(t1 - 1).toISOString() });
        const lines = text.split('\n');
        assert.equal(lines.length, 2, text);
        assert.match(lines[0], /^\[13:45:12\] .*Health fell from 20 to 14 at \(12, 67, 52\)\.$/);
        assert.match(lines[1], /^\[13:45:22\] .*Luna died at \(12, 67, 52\)\.$/);
        const after = await call(full.port, 'events', { since: new Date(t1).toISOString() });
        assert.equal(after.text.split('\n').length, 1, after.text);
    });
});

describe('4.1 say', () => {
    test('handed to handleMessage with the owner\'s name, answered at once', async () => {
        fullAgent.handled.length = 0;
        const { text, isError } = await call(full.port, 'say', { text: 'come here' });
        assert.equal(isError, false);
        assert.equal(text, 'Said as MartyByrde2: "come here".');
        await new Promise((r) => setImmediate(r));
        assert.deepEqual(fullAgent.handled, [['MartyByrde2', 'come here']]);
    });

    test('a line that starts with "/" is refused: "I do not run server commands."; nothing handed', async () => {
        fullAgent.handled.length = 0;
        const { text, isError } = await call(full.port, 'say', { text: '/kill' });
        assert.equal(isError, true);
        assert.equal(text, 'I do not run server commands.');
        await new Promise((r) => setImmediate(r));
        assert.deepEqual(fullAgent.handled, []);
    });

    test('without only_chat_with: the last player that spoke, else "watcher"', async () => {
        const first = await call(empty.port, 'say', { text: 'hello' });
        assert.equal(first.text, 'Said as watcher: "hello".');
        emptyAgent.bot.emit('chat', 'Alex', 'hi');
        const second = await call(empty.port, 'say', { text: 'hello' });
        assert.equal(second.text, 'Said as Alex: "hello".');
    });

    test('a text over 256 characters is refused', async () => {
        const r = await call(full.port, 'say', { text: 'x'.repeat(257) });
        assert.equal(r.isError, true);
    });
});
