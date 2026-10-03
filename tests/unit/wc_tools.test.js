// Spec v0.1.4.12 4.1 (part C): the texts of the six tools from a fixture agent.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_HANDLERS, agoText, argsRefusal, chatCount, chatLine, ownerName, phaseOf, runTool } from '../../src/agent/watch/tools.js';
import { Ring, makeEvent } from '../../src/agent/watch/events_logic.js';
import { TEXTS } from '../../src/agent/watch/texts.js';

const NOW = new Date(2026, 9, 3, 13, 48, 2).getTime();

function vec(x, y, z) {
    return { x, y, z, offset: (dx, dy, dz) => vec(x + dx, y + dy, z + dz) };
}

function fixtureAgent(overrides = {}) {
    const handled = [];
    const agent = {
        name: 'Luna',
        bot: {
            username: 'Luna',
            entity: { position: vec(12.3, 67, 52.8) },
            health: 20,
            food: 18,
            time: { timeOfDay: 13500 },
            game: { dimension: 'minecraft:overworld' },
            blockAt: (p) => (Math.floor(p.y) === 66 ? { name: 'oak_planks' } : { name: 'air' }),
            heldItem: { name: 'stone_pickaxe' },
            inventory: {
                items: () => [{ name: 'oak_log', count: 12 }, { name: 'cobblestone', count: 64 }, { name: 'stone_pickaxe', count: 1 }, { name: 'oak_log', count: 2 }],
                slots: Object.assign([], { 45: { name: 'bread' } }),
            },
        },
        actions: { currentActionLabel: 'action:farmCycle', last_action_time: NOW - 42000 },
        running_commands: [{ name: '!farmCycle', text: '!farmCycle("farm")' }],
        job: { status: () => 'Job: the farming.' },
        last_order: null,
        memory_bank: { recallPlaceInfo: (name) => (name === 'home' ? { x: 10, y: 67, z: 52, dimension: 'overworld' } : null) },
        area_store: {
            list: () => [
                { name: 'basement', type: 'building', dimension: 'overworld', min: { x: 10, y: 60, z: 50 }, max: { x: 14, y: 65, z: 54 } },
                { name: 'home', type: 'home', dimension: 'overworld', min: { x: 10, y: 66, z: 50 }, max: { x: 14, y: 70, z: 54 } },
            ],
        },
        _workStores: () => ({ mines: { list: () => [{ name: 'mine', level: 16, entrance: { x: 9, y: 67, z: 52 }, tunnels: [{}, {}] }] } }),
        work_packs: {},
        homeContext: () => ({ routes: { store: { list: () => [{ name: 'basement' }, { name: 'mine' }] } } }),
        rule_store: { list: () => [{ id: 1, text: 'Never enter the pen.' }, { id: 2, text: 'Close the doors' }] },
        handleMessage: async (source, text) => {
            handled.push([source, text]);
        },
        ...overrides,
    };
    return { agent, handled };
}

function fixtureWatch(extra = {}) {
    const chat = new Ring(100);
    const events = new Ring(200);
    return { chat, events, lastSpeaker: null, lastLine: null, now: () => NOW, settings: { only_chat_with: [] }, ...extra };
}

describe('state', () => {
    test('the five lines of the spec', async () => {
        const { agent } = fixtureAgent();
        const watch = fixtureWatch({ lastLine: { text: 'go to the farm', by: 'MartyByrde2', at: NOW - 180000 } });
        assert.equal(await TOOL_HANDLERS.state(agent, {}, watch), [
            'Luna at (12, 67, 52) in overworld, on oak_planks. Time 13500 (night). Health 20 of 20, food 18 of 20.',
            'Running: !farmCycle("farm") for 42 s.',
            'Job: the farming.',
            'Last order: "go to the farm" by MartyByrde2, 3 min ago.',
            'Home: (10, 67, 52), 2 blocks away.',
        ].join('\n'));
    });

    test('nothing running, no job, no order, no home', async () => {
        const { agent } = fixtureAgent({ actions: { currentActionLabel: '' }, job: null, memory_bank: null });
        const text = await TOOL_HANDLERS.state(agent, {}, fixtureWatch());
        assert.deepEqual(text.split('\n').slice(1), ['Running: nothing.', 'Job: none.', 'Last order: none.', 'Home: unknown.']);
    });

    test('a reflex, the last order of the agent', async () => {
        const { agent } = fixtureAgent({
            actions: { currentActionLabel: 'mode:self_defense', last_action_time: NOW - 3000 },
            last_order: { by: 'MartyByrde2', at: NOW - 12000, command: '!goToPlayer', text: '!goToPlayer("MartyByrde2", 2)' },
        });
        const text = await TOOL_HANDLERS.state(agent, {}, fixtureWatch());
        assert.equal(text.split('\n')[1], 'Running: the reflex self_defense for 3 s.');
        assert.equal(text.split('\n')[3], 'Last order: "!goToPlayer("MartyByrde2", 2)" by MartyByrde2, 12 s ago.');
    });

    test('before the spawn', async () => {
        const { agent } = fixtureAgent();
        agent.bot.entity = null;
        assert.equal((await TOOL_HANDLERS.state(agent, {}, fixtureWatch())).split('\n')[0], 'Luna is not in a world yet.');
    });

    test('phaseOf and agoText', () => {
        assert.equal(phaseOf(1000), 'day');
        assert.equal(phaseOf(12500), 'dusk');
        assert.equal(phaseOf(13500), 'night');
        assert.equal(phaseOf(23500), 'dawn');
        assert.equal(agoText(5000), '5 s ago');
        assert.equal(agoText(180000), '3 min ago');
        assert.equal(agoText(7200000), '2 h ago');
    });
});

describe('inventory', () => {
    test('sorted by count, the hand and the off-hand', async () => {
        const { agent } = fixtureAgent();
        assert.equal(await TOOL_HANDLERS.inventory(agent), 'Inventory: 64 cobblestone, 14 oak_log, 1 stone_pickaxe.\nHand: stone_pickaxe. Off-hand: bread.');
    });

    test('empty', async () => {
        const { agent } = fixtureAgent();
        agent.bot.inventory = { items: () => [], slots: [] };
        agent.bot.heldItem = null;
        assert.equal(await TOOL_HANDLERS.inventory(agent), 'Inventory: empty.\nHand: empty. Off-hand: empty.');
    });
});

describe('chat', () => {
    test('the last lines, oldest first', async () => {
        const watch = fixtureWatch();
        watch.chat.push({ t: new Date(2026, 9, 3, 13, 45, 2).getTime(), name: 'MartyByrde2', text: 'go to the farm' });
        watch.chat.push({ t: new Date(2026, 9, 3, 13, 45, 4).getTime(), name: 'Luna', text: 'On my way.' });
        assert.equal(await TOOL_HANDLERS.chat({}, {}, watch), '[13:45:02] MartyByrde2: go to the farm\n[13:45:04] Luna: On my way.');
        assert.equal(await TOOL_HANDLERS.chat({}, { lines: 1 }, watch), '[13:45:04] Luna: On my way.');
    });

    test('no chat yet', async () => {
        assert.equal(await TOOL_HANDLERS.chat({}, {}, fixtureWatch()), 'No chat yet.');
    });

    test('lines: 1 to 50, default 10', () => {
        assert.equal(chatCount(undefined), 10);
        assert.equal(chatCount(0), 1);
        assert.equal(chatCount(99), 50);
        assert.equal(chatCount('20'), 20);
        assert.equal(chatCount('x'), 10);
        assert.equal(chatLine({ t: new Date(2026, 9, 3, 1, 2, 3).getTime(), name: 'A', text: 'b' }), '[01:02:03] A: b');
    });
});

describe('places', () => {
    test('areas, mines, routes, rules', async () => {
        const { agent } = fixtureAgent();
        assert.equal(await TOOL_HANDLERS.places(agent), [
            'Areas: basement (building) (10,60,50)-(14,65,54); home (home) (10,66,50)-(14,70,54).',
            'Mines: mine, entrance (9, 67, 52), 2 tunnels.',
            'Routes: basement, mine.',
            'Rules: 1. Never enter the pen. 2. Close the doors.',
        ].join('\n'));
    });

    test('empty stores and no stores', async () => {
        const { agent } = fixtureAgent({ area_store: undefined, _workStores: undefined, homeContext: undefined, rule_store: undefined });
        assert.equal(await TOOL_HANDLERS.places(agent), 'No areas.\nNo mines.\nNo routes.\nNo rules.');
    });

    test('at most 10 rules', async () => {
        const rules = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, text: `Rule ${i + 1}.` }));
        const { agent } = fixtureAgent({ rule_store: { list: () => rules } });
        const line = (await TOOL_HANDLERS.places(agent)).split('\n')[3];
        assert.ok(line.endsWith('10. Rule 10.'));
    });
});

describe('events', () => {
    const watch = fixtureWatch();
    watch.events.push(makeEvent('restart', 'Luna started.', {}, new Date(2026, 9, 3, 13, 40, 0).getTime()));
    watch.events.push(makeEvent('explosion', 'Explosion 6 blocks from the area "pen" at (1, 2, 3).', {}, new Date(2026, 9, 3, 13, 45, 2).getTime()));

    test('without since: the last 20', async () => {
        assert.equal(await TOOL_HANDLERS.events({}, {}, watch),
            '[13:40:00] restart: Luna started.\n[13:45:02] explosion: Explosion 6 blocks from the area "pen" at (1, 2, 3).');
    });

    test('since: the events after it', async () => {
        const since = new Date(2026, 9, 3, 13, 41, 0).toISOString();
        assert.equal(await TOOL_HANDLERS.events({}, { since }, watch), '[13:45:02] explosion: Explosion 6 blocks from the area "pen" at (1, 2, 3).');
        assert.equal(await TOOL_HANDLERS.events({}, { since: new Date(2026, 9, 3, 14, 0, 0).toISOString() }, watch), 'No events.');
    });

    test('a since that is no time is refused', async () => {
        const answer = await runTool({}, watch, 'events', { since: 'yesterday' });
        assert.deepEqual(answer, { text: 'The time "yesterday" is no ISO time like 2026-10-03T13:45:02Z.', isError: true });
    });
});

describe('say', () => {
    test('handed to handleMessage with the owner of only_chat_with, the answer at once', async () => {
        const { agent, handled } = fixtureAgent();
        const watch = fixtureWatch({ settings: { only_chat_with: ['MartyByrde2'] } });
        const answer = await runTool(agent, watch, 'say', { text: 'come here' });
        assert.deepEqual(answer, { text: 'Said as MartyByrde2: "come here".', isError: false });
        assert.deepEqual(handled, [['MartyByrde2', 'come here']]);
        assert.equal(watch.chat.items.length, 1);
    });

    test('the owner: only_chat_with[0], else the last player that spoke, else "watcher"', () => {
        assert.equal(ownerName({ only_chat_with: ['A', 'B'] }, { lastSpeaker: 'C' }), 'A');
        assert.equal(ownerName({ only_chat_with: [] }, { lastSpeaker: 'C' }), 'C');
        assert.equal(ownerName({ only_chat_with: [] }, {}), 'watcher');
    });

    test('a server command is refused and never handed on', async () => {
        const { agent, handled } = fixtureAgent();
        const answer = await runTool(agent, fixtureWatch(), 'say', { text: '/kill' });
        assert.deepEqual(answer, { text: 'I do not run server commands.', isError: true });
        assert.deepEqual(handled, []);
        assert.equal(TEXTS.noCommands, 'I do not run server commands.');
    });

    test('1 to 256 characters', () => {
        assert.equal(argsRefusal('say', { text: '' }), 'The text must have 1 to 256 characters.');
        assert.equal(argsRefusal('say', { text: 'x'.repeat(257) }), 'The text must have 1 to 256 characters.');
        assert.equal(argsRefusal('say', {}), 'The text must have 1 to 256 characters.');
        assert.equal(argsRefusal('say', { text: 'x'.repeat(256) }), null);
    });
});

describe('runTool', () => {
    test('an unknown tool: null; a tool that fails: a text with isError', async () => {
        assert.equal(await runTool({}, fixtureWatch(), 'kill', {}), null);
        const agent = { get bot() { throw new Error('no bot'); } };
        const answer = await runTool(agent, fixtureWatch(), 'inventory', {});
        assert.equal(answer.isError, true);
        assert.equal(answer.text, 'The tool inventory failed: no bot.');
    });

    test('the texts of the spec', () => {
        assert.equal(TEXTS.noToken, 'The watch server does not start: MC_WATCH_TOKEN is not set.');
        assert.equal(TEXTS.started(8090), 'The watch server listens on 127.0.0.1:8090.');
    });
});
