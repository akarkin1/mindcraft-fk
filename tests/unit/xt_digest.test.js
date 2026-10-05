// Tests from the spec (v0.1.4.13, section 6, T1): the digest of part S (SPEC 4.1) from staged snapshot pairs.
// Every line of the spec in its order, the unchanged ones absent, `Nothing changed.`, `Cursor` first; chat and
// events in full when 10 or fewer are new, else the count and the last 3; an unknown cursor gives every line.
// Written from the words and the texts of the spec, not from the code. A failing test is a finding.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createCursorStore, digestLines, hazardsOf } from '../../src/agent/watch/digest_logic.js';
import { Ring, makeEvent } from '../../src/agent/watch/events_logic.js';
import { runTool } from '../../src/agent/watch/tools.js';
import { createBlockWorld, vec } from '../helpers/block_world.js';
import { T0, makeSnapshot, makeTool, makeWatch, makeWatchAgent } from '../helpers/xt_watch.js';

const CHAT_LINE = 'I mined 0 diamond of 28. I stopped because my pickaxe is nearly broken.';
const EVENT_TEXT = 'The job (the mining, 0 of 28 diamond) made no progress for 10 minutes.';

function rings({ chat = 0, events = 0 } = {}) {
    const chatRing = new Ring(100);
    for (let i = 1; i <= chat; i++)
        chatRing.push({ t: T0, name: i === chat ? 'gpt' : 'MartyByrde2', text: i === chat ? CHAT_LINE : `line ${i}` });
    const eventRing = new Ring(100);
    for (let i = 1; i <= events; i++)
        eventRing.push(makeEvent('job_stalled', EVENT_TEXT, {}, T0));
    return { chat: chatRing, events: eventRing };
}

/** The snapshot before the spec's example: every fact differs from makeSnapshot(). */
function beforeOfExample() {
    return makeSnapshot({
        t: T0 - 60000,
        pos: { x: 19, y: -59, z: -99 },
        health: 18,
        food: 16,
        running: null,
        job: 'Job: the mining, 0 of 28 diamond, step 2 of 3.',
        inventory: { iron_pickaxe: 2, bread: 8 },
        hand: { name: 'iron_pickaxe', uses: 42 },
        chatIndex: 0,
        eventIndex: 0,
        hazards: [],
        chest: null,
    });
}

describe('SPEC 4.1 digest: the lines of the example, in order', () => {
    test('every line of the spec when every fact changed since the cursor', () => {
        const lines = digestLines(beforeOfExample(), makeSnapshot(), { cursor: 184, ...rings({ chat: 3, events: 1 }) });
        assert.deepEqual(lines, [
            'Cursor: 184.',
            'At (31, -59, -99) in overworld, moved 12 blocks.',
            'Health 20 of 20, food 15 of 20.',
            'Running: !mineOre("diamond", 28, false) for 138 s.',
            'Job: the mining, 7 of 28 diamond, step 2 of 3.',
            'Inventory: +7 diamond, +25 lapis_lazuli, -1 iron_pickaxe, -4 bread.',
            'Hand: iron_pickaxe, 41 uses left.',
            'Chat: 3 new lines.',
            '[06:45:12] MartyByrde2: line 1',
            '[06:45:12] MartyByrde2: line 2',
            `[06:45:12] gpt: ${CHAT_LINE}`,
            'Events: 1 new.',
            `[06:45:12] job_stalled: ${EVENT_TEXT}`,
            'Hazards: lava 4 blocks away at (34, -59, -101).',
            'Chest: (16, -59, -98), 22 free slots, 3 blocks away.',
        ]);
    });

    test('the first line is always Cursor', () => {
        const same = makeSnapshot();
        assert.equal(digestLines(same, makeSnapshot(), { cursor: 7, ...rings() })[0], 'Cursor: 7.');
        assert.equal(digestLines(null, makeSnapshot(), { cursor: 1, ...rings({ chat: 3, events: 1 }) })[0], 'Cursor: 1.');
        assert.equal(digestLines(beforeOfExample(), makeSnapshot(), { cursor: 184, ...rings({ chat: 3, events: 1 }) })[0], 'Cursor: 184.');
    });

    test('Nothing changed. when no fact changed', () => {
        const lines = digestLines(makeSnapshot(), makeSnapshot({ t: T0 + 5000 }), { cursor: 9, ...rings({ chat: 3, events: 1 }) });
        assert.deepEqual(lines, ['Cursor: 9.', 'Nothing changed.']);
    });

    test('only the lines whose fact changed: health alone', () => {
        const lines = digestLines(makeSnapshot({ health: 12 }), makeSnapshot(), { cursor: 10, ...rings({ chat: 3, events: 1 }) });
        assert.deepEqual(lines, ['Cursor: 10.', 'Health 20 of 20, food 15 of 20.']);
    });

    test('only the lines whose fact changed: the position and the chest, nothing else', () => {
        const before = makeSnapshot({ pos: { x: 31, y: -59, z: -95 }, chest: { pos: { x: 16, y: -59, z: -98 }, free: 25, blocks: 3 } });
        const lines = digestLines(before, makeSnapshot(), { cursor: 11, ...rings({ chat: 3, events: 1 }) });
        assert.deepEqual(lines, [
            'Cursor: 11.',
            'At (31, -59, -99) in overworld, moved 4 blocks.',
            'Chest: (16, -59, -98), 22 free slots, 3 blocks away.',
        ]);
    });

    test('the running command that ended: Running: nothing.', () => {
        const lines = digestLines(makeSnapshot(), makeSnapshot({ running: null }), { cursor: 12, ...rings({ chat: 3, events: 1 }) });
        assert.deepEqual(lines, ['Cursor: 12.', 'Running: nothing.']);
    });

    test('the lines keep the order of the spec whatever changed', () => {
        const before = makeSnapshot({ chest: null, hazards: [], food: 9, hand: { name: 'stone_pickaxe', uses: 3 } });
        const lines = digestLines(before, makeSnapshot(), { cursor: 13, ...rings({ chat: 3, events: 1 }) });
        assert.deepEqual(lines, [
            'Cursor: 13.',
            'Health 20 of 20, food 15 of 20.',
            'Hand: iron_pickaxe, 41 uses left.',
            'Hazards: lava 4 blocks away at (34, -59, -101).',
            'Chest: (16, -59, -98), 22 free slots, 3 blocks away.',
        ]);
    });
});

describe('SPEC 4.1 digest: without since, every line, Cursor first', () => {
    test('every line in the order of the spec', () => {
        const lines = digestLines(null, makeSnapshot(), { cursor: 1, ...rings({ chat: 3, events: 1 }) });
        const heads = lines.map((l) => l.replace(/[:\s].*$/, ''));
        assert.deepEqual(heads, ['Cursor', 'At', 'Health', 'Running', 'Job', 'Inventory', 'Hand', 'Chat', '[06', '[06', '[06', 'Events', '[06', 'Hazards', 'Chest']);
        assert.equal(lines[0], 'Cursor: 1.');
        assert.equal(lines[2], 'Health 20 of 20, food 15 of 20.');
        assert.equal(lines[3], 'Running: !mineOre("diamond", 28, false) for 138 s.');
        assert.equal(lines[4], 'Job: the mining, 7 of 28 diamond, step 2 of 3.');
        assert.equal(lines[6], 'Hand: iron_pickaxe, 41 uses left.');
        // the handoff (E1's decision that stands): the first digest lists the inventory as counts
        assert.match(lines[5], /^Inventory: .*7 diamond/);
        assert.match(lines[5], /25 lapis_lazuli/);
        assert.match(lines[5], /4 bread/);
        assert.equal(lines[13], 'Hazards: lava 4 blocks away at (34, -59, -101).');
        assert.equal(lines[14], 'Chest: (16, -59, -98), 22 free slots, 3 blocks away.');
    });
});

describe('SPEC 4.1 digest: chat and events, in full up to 10, else the count and the last 3', () => {
    test('10 new chat lines are listed in full', () => {
        const lines = digestLines(makeSnapshot({ chatIndex: 0 }), makeSnapshot({ chatIndex: 10 }), { cursor: 20, ...rings({ chat: 10, events: 1 }) });
        assert.equal(lines[1], 'Chat: 10 new lines.');
        assert.equal(lines.length, 2 + 10);
        assert.equal(lines[11], `[06:45:12] gpt: ${CHAT_LINE}`);
    });

    test('11 new chat lines give the count and the last 3', () => {
        const lines = digestLines(makeSnapshot({ chatIndex: 0 }), makeSnapshot({ chatIndex: 11 }), { cursor: 21, ...rings({ chat: 11, events: 1 }) });
        assert.equal(lines[1], 'Chat: 11 new lines.');
        assert.equal(lines.length, 2 + 3);
        assert.deepEqual(lines.slice(2), ['[06:45:12] MartyByrde2: line 9', '[06:45:12] MartyByrde2: line 10', `[06:45:12] gpt: ${CHAT_LINE}`]);
    });

    test('12 new events give the count and the last 3', () => {
        const lines = digestLines(makeSnapshot({ eventIndex: 0 }), makeSnapshot({ eventIndex: 12 }), { cursor: 22, ...rings({ chat: 3, events: 12 }) });
        assert.equal(lines[1], 'Events: 12 new.');
        assert.equal(lines.length, 2 + 3);
        for (const line of lines.slice(2))
            assert.equal(line, `[06:45:12] job_stalled: ${EVENT_TEXT}`);
    });

    test('one new chat line: Chat: 1 new line', () => {
        const lines = digestLines(makeSnapshot({ chatIndex: 2 }), makeSnapshot({ chatIndex: 3 }), { cursor: 23, ...rings({ chat: 3, events: 1 }) });
        assert.equal(lines.length, 3);
        assert.match(lines[1], /^Chat: 1 new line/);
        assert.equal(lines[2], `[06:45:12] gpt: ${CHAT_LINE}`);
    });
});

describe('SPEC 4.1 digest: the hazards within 8 blocks', () => {
    // the spec: lava, water as a block the bot could walk into, a dropped item; the hazards are read from the
    // world by hazardsOf, so the test stages the world, not the shape of a hazard
    test('water the bot could walk into and a dropped item are said, with the item', () => {
        const world = createBlockWorld().flatGround(-60, 'deepslate', 'deepslate');
        world.set(32, -59, -99, 'water');
        const drop = { name: 'item', position: vec(30.5, -59, -102.5), getDroppedItem: () => ({ name: 'cobbled_deepslate', count: 3 }) };
        const agent = makeWatchAgent({ world, entities: [drop] });
        const hazards = hazardsOf(agent.bot, { x: 31, y: -59, z: -99 });
        assert.ok(hazards.some((h) => h.kind === 'water'), `water at the feet is a hazard: ${JSON.stringify(hazards)}`);
        assert.ok(hazards.length >= 2, `the dropped item is a hazard: ${JSON.stringify(hazards)}`);
        const lines = digestLines(makeSnapshot({ hazards: [] }), makeSnapshot({ hazards }), { cursor: 30, ...rings({ chat: 3, events: 1 }) });
        assert.equal(lines.length, 2);
        assert.match(lines[1], /^Hazards: /);
        assert.match(lines[1], /water/);
        assert.match(lines[1], /\(32, -59, -99\)/);
        assert.match(lines[1], /\(30, -59, -103\)/);
        assert.match(lines[1], /3 cobbled_deepslate/);
    });
});

describe('SPEC 4.1 digest: lava within 8 blocks', () => {
    test('lava 8 blocks away is a hazard, 9 blocks away is not', () => {
        const world = createBlockWorld().flatGround(-60, 'deepslate', 'deepslate');
        world.set(39, -59, -99, 'lava');
        const near = hazardsOf(makeWatchAgent({ world }).bot, { x: 31, y: -59, z: -99 });
        assert.ok(near.some((h) => h.kind === 'lava'), `lava at 8 blocks: ${JSON.stringify(near)}`);
        const far = createBlockWorld().flatGround(-60, 'deepslate', 'deepslate');
        far.set(40, -59, -99, 'lava');
        const none = hazardsOf(makeWatchAgent({ world: far }).bot, { x: 31, y: -59, z: -99 });
        assert.ok(!none.some((h) => h.kind === 'lava'), `no lava at 9 blocks: ${JSON.stringify(none)}`);
    });

    test('the line of the spec: Hazards: lava 4 blocks away at (34, -59, -101).', () => {
        const world = createBlockWorld().flatGround(-60, 'deepslate', 'deepslate');
        world.set(34, -59, -101, 'lava');
        const hazards = hazardsOf(makeWatchAgent({ world }).bot, { x: 31, y: -59, z: -99 });
        const lines = digestLines(makeSnapshot({ hazards: [] }), makeSnapshot({ hazards }), { cursor: 31, ...rings({ chat: 3, events: 1 }) });
        assert.deepEqual(lines, ['Cursor: 31.', 'Hazards: lava 4 blocks away at (34, -59, -101).']);
    });
});

describe('SPEC 4.1 digest: the cursor store keeps the last 50 snapshots', () => {
    test('a cursor older than the last 50 is unknown', () => {
        const store = createCursorStore();
        const cursors = [];
        for (let i = 0; i < 51; i++)
            cursors.push(store.add(makeSnapshot({ t: T0 + i })));
        assert.equal(cursors.length, 51);
        assert.equal(store.get(cursors[0]), null, 'the 51st snapshot pushed the first one out');
        assert.ok(store.get(cursors[1]), 'the 50 last snapshots are kept');
        assert.ok(store.get(cursors[50]));
        assert.equal(store.get(999999), null);
    });
});

describe('SPEC 4.1 the digest tool with a fixture agent', () => {
    const items = [{ name: 'diamond', count: 7 }, { name: 'bread', count: 4 }, makeTool('iron_pickaxe', 41)];

    test('without since every line, Cursor first; with the cursor and nothing changed, Nothing changed.', async () => {
        const agent = makeWatchAgent({ items, held: makeTool('iron_pickaxe', 41), food: 15 });
        const watch = makeWatch();
        const first = await runTool(agent, watch, 'digest', {});
        assert.equal(first.isError, false);
        const lines = first.text.split('\n');
        assert.match(lines[0], /^Cursor: \d+\.$/);
        assert.equal(lines[2], 'Health 20 of 20, food 15 of 20.');
        assert.ok(lines.some((l) => l === 'Hand: iron_pickaxe, 41 uses left.'), lines.join('\n'));
        const cursor = lines[0].match(/^Cursor: (\d+)\.$/)[1];
        const second = await runTool(agent, watch, 'digest', { since: cursor });
        const again = second.text.split('\n');
        assert.match(again[0], /^Cursor: \d+\.$/);
        assert.deepEqual(again.slice(1), ['Nothing changed.']);
    });

    test('an unknown cursor gives every line', async () => {
        const agent = makeWatchAgent({ items, held: makeTool('iron_pickaxe', 41), food: 15 });
        const watch = makeWatch();
        await runTool(agent, watch, 'digest', {});
        const unknown = await runTool(agent, watch, 'digest', { since: '999999' });
        const lines = unknown.text.split('\n');
        assert.match(lines[0], /^Cursor: \d+\.$/);
        assert.notEqual(lines[1], 'Nothing changed.');
        assert.ok(lines.some((l) => l.startsWith('At (31, -59, -99) in overworld')), lines.join('\n'));
        assert.ok(lines.some((l) => l === 'Health 20 of 20, food 15 of 20.'));
    });

    test('a change of the food since the cursor is the one line', async () => {
        const agent = makeWatchAgent({ items, held: makeTool('iron_pickaxe', 41), food: 15 });
        const watch = makeWatch();
        const first = await runTool(agent, watch, 'digest', {});
        const cursor = first.text.split('\n')[0].match(/^Cursor: (\d+)\.$/)[1];
        agent.bot.food = 14;
        const second = await runTool(agent, watch, 'digest', { since: cursor });
        assert.deepEqual(second.text.split('\n').slice(1), ['Health 20 of 20, food 14 of 20.']);
    });
});
