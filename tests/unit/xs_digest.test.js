// Spec v0.1.4.13 4.1 (part S): the digest from staged snapshot pairs: every line of the spec, the unchanged ones
// absent; the cursor store; the snapshot of a fixture agent; the digest tool with its cursors.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DIGEST_RULES, createCursorStore, digestLines, hazardsOf, inventoryChanges, parseCursor, runningOf, snapshotOf, usesLeft,
} from '../../src/agent/watch/digest_logic.js';
import { Ring, makeEvent } from '../../src/agent/watch/events_logic.js';
import { TOOL_HANDLERS, runTool } from '../../src/agent/watch/tools.js';
import { TEXTS } from '../../src/agent/watch/texts.js';

const T0 = new Date(2026, 9, 4, 6, 45, 12).getTime();

function snapshot(overrides = {}) {
    return {
        t: T0,
        pos: { x: 19, y: -59, z: -99 },
        dimension: 'overworld',
        health: 20,
        food: 15,
        running: { text: '!mineOre("diamond", 28, false)', startedAt: T0 - 138000 },
        job: 'Job: the mining, 7 of 28 diamond, step 2 of 3.',
        inventory: { diamond: 7, lapis_lazuli: 25, iron_pickaxe: 1, bread: 4 },
        hand: { name: 'iron_pickaxe', uses: 41 },
        chatIndex: 3,
        eventIndex: 1,
        hazards: [{ kind: 'lava', pos: { x: 34, y: -59, z: -101 }, blocks: 4 }],
        chest: { pos: { x: 16, y: -59, z: -98 }, free: 22, blocks: 3 },
        ...overrides,
    };
}

describe('the lines of the spec', () => {
    test('every line, in the order of the spec, when every fact changed', () => {
        const before = snapshot({
            pos: { x: 31, y: -59, z: -99 }, health: 18, food: 16, running: null, job: 'Job: the mining, 0 of 28 diamond, step 2 of 3.',
            inventory: { iron_pickaxe: 2, bread: 8 }, hand: { name: 'iron_pickaxe', uses: 42 }, chatIndex: 0, eventIndex: 0, hazards: [], chest: null,
        });
        const after = snapshot({ t: T0 });
        const chat = new Ring(100);
        chat.push({ t: T0, name: 'gpt', text: 'I mined 0 diamond of 28. I stopped because my pickaxe is nearly broken.' });
        chat.push({ t: T0, name: 'MartyByrde2', text: 'gpt, craft one' });
        chat.push({ t: T0, name: 'gpt', text: 'On it.' });
        const events = new Ring(200);
        events.push(makeEvent('job_stalled', 'The job (the mining, 0 of 28 diamond) made no progress for 10 minutes.', {}, T0));
        assert.deepEqual(digestLines(before, after, { cursor: 184, chat, events }), [
            'Cursor: 184.',
            'At (19, -59, -99) in overworld, moved 12 blocks.',
            'Health 20 of 20, food 15 of 20.',
            'Running: !mineOre("diamond", 28, false) for 138 s.',
            'Job: the mining, 7 of 28 diamond, step 2 of 3.',
            'Inventory: +7 diamond, +25 lapis_lazuli, -1 iron_pickaxe, -4 bread.',
            'Hand: iron_pickaxe, 41 uses left.',
            'Chat: 3 new lines.',
            '[06:45:12] gpt: I mined 0 diamond of 28. I stopped because my pickaxe is nearly broken.',
            '[06:45:12] MartyByrde2: gpt, craft one',
            '[06:45:12] gpt: On it.',
            'Events: 1 new.',
            '[06:45:12] job_stalled: The job (the mining, 0 of 28 diamond) made no progress for 10 minutes.',
            'Hazards: lava 4 blocks away at (34, -59, -101).',
            'Chest: (16, -59, -98), 22 free slots, 3 blocks away.',
        ]);
    });

    test('the unchanged lines are absent; Nothing changed. when none changed', () => {
        const same = snapshot();
        assert.deepEqual(digestLines(same, { ...same, t: T0 + 5000 }, { cursor: 185 }), ['Cursor: 185.', 'Nothing changed.']);
        const moved = digestLines(same, snapshot({ pos: { x: 19, y: -59, z: -95 } }), { cursor: 186 });
        assert.deepEqual(moved, ['Cursor: 186.', 'At (19, -59, -95) in overworld, moved 4 blocks.']);
        const ate = digestLines(same, snapshot({ food: 20, inventory: { ...same.inventory, bread: 3 } }), { cursor: 187 });
        assert.deepEqual(ate, ['Cursor: 187.', 'Health 20 of 20, food 20 of 20.', 'Inventory: -1 bread.']);
    });

    test('the command ended, the job line, the hand, the hazards gone, the chest gone', () => {
        const same = snapshot();
        const ended = digestLines(same, snapshot({ running: null, job: '', hand: null, hazards: [], chest: null }), { cursor: 1 });
        assert.deepEqual(ended, ['Cursor: 1.', 'Running: nothing.', 'Job: none.', 'Hand: empty.', 'Hazards: none.', 'Chest: none.']);
        const noJob = digestLines(same, snapshot({ job: '' }), { cursor: 2 });
        assert.deepEqual(noJob, ['Cursor: 2.', 'Job: none.']);
        const plain = digestLines(same, snapshot({ hand: { name: 'bread', uses: null } }), { cursor: 3 });
        assert.deepEqual(plain, ['Cursor: 3.', 'Hand: bread.']);
    });

    test('a new command: the seconds since its start', () => {
        const same = snapshot();
        const lines = digestLines(same, snapshot({ t: T0 + 3000, running: { text: '!goToPlayer("MartyByrde2", 2)', startedAt: T0 + 1000 } }), { cursor: 4 });
        assert.deepEqual(lines, ['Cursor: 4.', 'Running: !goToPlayer("MartyByrde2", 2) for 2 s.']);
    });

    test('without a snapshot before: every line, the inventory as counts', () => {
        const lines = digestLines(null, snapshot({ chatIndex: 0, eventIndex: 0 }), { cursor: 1 });
        assert.deepEqual(lines, [
            'Cursor: 1.',
            'At (19, -59, -99) in overworld.',
            'Health 20 of 20, food 15 of 20.',
            'Running: !mineOre("diamond", 28, false) for 138 s.',
            'Job: the mining, 7 of 28 diamond, step 2 of 3.',
            'Inventory: 25 lapis_lazuli, 7 diamond, 4 bread, 1 iron_pickaxe.',
            'Hand: iron_pickaxe, 41 uses left.',
            'Hazards: lava 4 blocks away at (34, -59, -101).',
            'Chest: (16, -59, -98), 22 free slots, 3 blocks away.',
        ]);
    });

    test('more than 10 new chat lines: the count and the last 3', () => {
        const chat = new Ring(100);
        for (let i = 1; i <= 12; i++)
            chat.push({ t: T0, name: 'Luna', text: `line ${i}` });
        const lines = digestLines(snapshot({ chatIndex: 0 }), snapshot({ chatIndex: 12 }), { cursor: 9, chat });
        assert.deepEqual(lines, ['Cursor: 9.', 'Chat: 12 new lines.', '[06:45:12] Luna: line 10', '[06:45:12] Luna: line 11', '[06:45:12] Luna: line 12']);
        const ten = digestLines(snapshot({ chatIndex: 2 }), snapshot({ chatIndex: 12 }), { cursor: 10, chat });
        assert.equal(ten.length, 12);
        assert.equal(ten[1], 'Chat: 10 new lines.');
    });

    test('a hazard that is a dropped item, and several hazards', () => {
        const hazards = [
            { kind: 'drop', pos: { x: 20, y: -59, z: -99 }, blocks: 1, name: 'cobbled_deepslate', count: 3 },
            { kind: 'lava', pos: { x: 34, y: -59, z: -101 }, blocks: 4 },
            { kind: 'water', pos: { x: 12, y: -60, z: -99 }, blocks: 7 },
        ];
        const lines = digestLines(snapshot(), snapshot({ hazards }), { cursor: 5 });
        assert.deepEqual(lines, ['Cursor: 5.', 'Hazards: 3 cobbled_deepslate on the ground 1 block away at (20, -59, -99); lava 4 blocks away at (34, -59, -101); water 7 blocks away at (12, -60, -99).']);
    });

    test('inventoryChanges: gains then losses, the smaller first', () => {
        assert.deepEqual(inventoryChanges({ bread: 8, iron_pickaxe: 2 }, { bread: 4, iron_pickaxe: 1, diamond: 7, lapis_lazuli: 25 }), ['+7 diamond', '+25 lapis_lazuli', '-1 iron_pickaxe', '-4 bread']);
        assert.deepEqual(inventoryChanges({ a: 1 }, { a: 1 }), []);
    });
});

describe('the cursor store', () => {
    test('a counter, the last 50 kept, an unknown cursor gives null', () => {
        const store = createCursorStore(3);
        assert.equal(store.add({ n: 1 }), 1);
        assert.equal(store.add({ n: 2 }), 2);
        assert.equal(store.add({ n: 3 }), 3);
        assert.equal(store.add({ n: 4 }), 4);
        assert.equal(store.get(1), null);
        assert.deepEqual(store.get('2'), { n: 2 });
        assert.deepEqual(store.get(4), { n: 4 });
        assert.equal(store.get('x'), null);
        assert.equal(store.get(99), null);
        assert.equal(store.size, 3);
        assert.equal(DIGEST_RULES.cursorSize, 50);
    });

    test('parseCursor', () => {
        assert.equal(parseCursor('184'), 184);
        assert.equal(parseCursor(184), 184);
        assert.equal(parseCursor(''), null);
        assert.equal(parseCursor(undefined), null);
        assert.equal(parseCursor('yesterday'), null);
        assert.equal(parseCursor('-1'), null);
    });
});

function vec(x, y, z) {
    return { x, y, z, offset: (dx, dy, dz) => vec(x + dx, y + dy, z + dz) };
}

function fixtureAgent(overrides = {}) {
    const blocks = new Map([['34,-59,-101', 'lava'], ['12,-60,-99', 'water'], ['19,-52,-99', 'water']]);
    return {
        name: 'Luna',
        bot: {
            username: 'Luna',
            entity: { position: vec(31.4, -59, -99.2) },
            health: 20,
            food: 15.6,
            game: { dimension: 'minecraft:overworld' },
            blockAt: (p) => ({ name: blocks.get(`${p.x},${p.y},${p.z}`) ?? 'deepslate' }),
            heldItem: { name: 'iron_pickaxe', maxDurability: 250, durabilityUsed: 209 },
            inventory: { items: () => [{ name: 'diamond', count: 7 }, { name: 'bread', count: 4 }], slots: [] },
            entities: { 1: { name: 'item', position: vec(30.5, -59, -103.5), getDroppedItem: () => ({ name: 'cobbled_deepslate', count: 3 }) }, 2: { name: 'zombie', position: vec(30, -59, -99) } },
        },
        actions: { currentActionLabel: 'action:mineOre', last_action_time: T0 - 138000, executing: true },
        running_commands: [{ name: '!mineOre', text: '!mineOre("diamond", 28, false)' }],
        job: { status: () => 'Job: the mining, 7 of 28 diamond, step 2 of 3.' },
        _workStores: () => ({ chests: { nearest: (pos, dimension, test) => [{ x: 16, y: -59, z: -98, free_slots: 22 }, { x: 11, y: 7, z: -100, free_slots: 0 }].filter(test).sort((a, b) => Math.hypot(a.x - pos.x, a.y - pos.y, a.z - pos.z) - Math.hypot(b.x - pos.x, b.y - pos.y, b.z - pos.z))[0] ?? null } }),
        ...overrides,
    };
}

describe('the snapshot of the agent', () => {
    test('position, health, food, the running command, the job, the inventory, the hand with its uses, the hazards, the chest', () => {
        const agent = fixtureAgent();
        const chat = new Ring(100);
        chat.push({ t: T0, name: 'Luna', text: 'x' });
        const snap = snapshotOf(agent, { now: () => T0, chat, events: new Ring(200) });
        assert.deepEqual(snap.pos, { x: 31, y: -59, z: -100 });
        assert.equal(snap.dimension, 'overworld');
        assert.equal(snap.health, 20);
        assert.equal(snap.food, 16);
        assert.deepEqual(snap.running, { text: '!mineOre("diamond", 28, false)', startedAt: T0 - 138000 });
        assert.equal(snap.job, 'Job: the mining, 7 of 28 diamond, step 2 of 3.');
        assert.deepEqual(snap.inventory, { diamond: 7, bread: 4 });
        assert.deepEqual(snap.hand, { name: 'iron_pickaxe', uses: 41 });
        assert.equal(snap.chatIndex, 1);
        assert.equal(snap.eventIndex, 0);
        assert.deepEqual(snap.hazards, [
            { kind: 'lava', pos: { x: 34, y: -59, z: -101 }, blocks: 3 },
            { kind: 'drop', pos: { x: 30, y: -59, z: -104 }, blocks: 4, name: 'cobbled_deepslate', count: 3 },
        ]); // the water at y -60 within 8 blocks is 19 blocks off in x; the water 7 blocks above is no block the bot walks into
        assert.deepEqual(snap.chest, { pos: { x: 16, y: -59, z: -98 }, free: 22, blocks: 15 });
        assert.equal(snap.t, T0);
    });

    test('hazardsOf: water at the feet, one below or one above; nothing without a world', () => {
        const bot = { blockAt: (p) => ({ name: p.y === -60 && p.x === 3 ? 'water' : (p.y === -50 ? 'water' : 'stone') }), entities: {} };
        assert.deepEqual(hazardsOf(bot, { x: 0, y: -59, z: 0 }), [{ kind: 'water', pos: { x: 3, y: -60, z: 0 }, blocks: 3 }]);
        assert.deepEqual(hazardsOf({ entities: {} }, { x: 0, y: 0, z: 0 }), []);
        assert.deepEqual(hazardsOf(bot, null), []);
    });

    test('usesLeft and runningOf', () => {
        assert.equal(usesLeft({ maxDurability: 250, durabilityUsed: 209 }), 41);
        assert.equal(usesLeft({ name: 'bread' }), null);
        assert.equal(runningOf({ actions: { currentActionLabel: '' } }), null);
        // a reflex is no command for the digest and the wake rules (a finding of the journey tester); the state tool asks for it
        assert.equal(runningOf({ actions: { currentActionLabel: 'mode:torch_placing', last_action_time: 5 } }), null);
        assert.deepEqual(runningOf({ actions: { currentActionLabel: 'mode:self_defense', last_action_time: 5 } }, { reflexes: true }), { text: 'the reflex self_defense', startedAt: 5 });
    });

    test('a reflex is not the running command; a done or left job is no job line', () => {
        const agent = fixtureAgent({
            actions: { currentActionLabel: 'mode:torch_placing', last_action_time: T0 - 1000, executing: true },
            running_commands: [],
            job: { status: () => 'Last job: the mining, left.' },
        });
        const snap = snapshotOf(agent, { now: () => T0 });
        assert.equal(snap.running, null);
        assert.equal(snap.job, '');
        const lines = digestLines(null, snap, { cursor: 1 });
        assert.ok(lines.includes('Running: nothing.'));
        assert.ok(lines.includes('Job: none.'));
        assert.ok(!lines.some((line) => line.includes('reflex') || line.startsWith('Last job')));
    });

    test('before the spawn: no position, no hazards, no chest', () => {
        const agent = fixtureAgent();
        agent.bot.entity = null;
        const snap = snapshotOf(agent, { now: () => T0 });
        assert.equal(snap.pos, null);
        assert.deepEqual(snap.hazards, []);
        assert.equal(snap.chest, null);
        assert.equal(digestLines(null, snap, { cursor: 1 })[1], 'At (unknown) in overworld.');
    });
});

describe('the digest tool', () => {
    test('without since every line and the cursor first; with the cursor only the changes; an unknown cursor every line', async () => {
        const agent = fixtureAgent();
        const watch = { now: () => T0, chat: new Ring(100), events: new Ring(200), settings: {} };
        const first = (await TOOL_HANDLERS.digest(agent, {}, watch)).split('\n');
        assert.equal(first[0], 'Cursor: 1.');
        assert.equal(first[1], 'At (31, -59, -100) in overworld.');
        assert.ok(first.includes('Inventory: 7 diamond, 4 bread.'));
        agent.bot.inventory.items = () => [{ name: 'diamond', count: 9 }, { name: 'bread', count: 4 }];
        const second = (await runTool(agent, watch, 'digest', { since: '1' })).text.split('\n');
        assert.deepEqual(second, ['Cursor: 2.', 'Inventory: +2 diamond.']);
        const third = (await runTool(agent, watch, 'digest', { since: '2' })).text.split('\n');
        assert.deepEqual(third, ['Cursor: 3.', 'Nothing changed.']);
        const unknown = (await runTool(agent, watch, 'digest', { since: '77' })).text.split('\n');
        assert.equal(unknown[0], 'Cursor: 4.');
        assert.equal(unknown[1], 'At (31, -59, -100) in overworld.');
        assert.equal(watch.cursors.cursor, 4);
        assert.equal(watch.presence.seenAt, T0);
        assert.equal(TEXTS.nothingChanged, 'Nothing changed.');
    });

    test('the new chat lines and events since the cursor', async () => {
        const agent = fixtureAgent();
        const watch = { now: () => T0, chat: new Ring(100), events: new Ring(200), settings: {} };
        await TOOL_HANDLERS.digest(agent, {}, watch);
        watch.chat.push({ t: T0, name: 'MartyByrde2', text: 'claude, come here' });
        watch.events.push(makeEvent('death', 'Luna died at (1, 2, 3).', {}, T0));
        const lines = (await TOOL_HANDLERS.digest(agent, { since: '1' }, watch)).split('\n');
        assert.deepEqual(lines, ['Cursor: 2.', 'Chat: 1 new line.', '[06:45:12] MartyByrde2: claude, come here', 'Events: 1 new.', '[06:45:12] death: Luna died at (1, 2, 3).']);
    });
});
