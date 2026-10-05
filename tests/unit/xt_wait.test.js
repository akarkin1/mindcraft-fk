// Tests from the spec (v0.1.4.13, section 6, T1): wait's wake rules of part S (SPEC 4.1) from staged state, and
// the wait tool with a fixture agent: `Woke: event.`, `idle`, `done`, `changed`, `timeout`, `Running: nothing.`
// at once for `done` when nothing ran, `Too many waits: 4 are open.`. The handoff wins over the spec for `any`:
// it ignores the position and the inventory, and a reflex is not a running command (`Running: nothing.` under a
// reflex, no wake when a reflex ends). A failing test is a finding.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runningOf, snapshotOf, wakeReason, waitTimeout } from '../../src/agent/watch/digest_logic.js';
import { makeEvent } from '../../src/agent/watch/events_logic.js';
import { runTool } from '../../src/agent/watch/tools.js';
import { T0, makeClock, makeSnapshot, makeTool, makeWatch, makeWatchAgent } from '../helpers/xt_watch.js';

const RUNNING = { text: '!mineOre("diamond", 28, false)', startedAt: T0 - 138000 };

function state(overrides = {}) {
    return { base: makeSnapshot(), now: makeSnapshot(), runningAtStart: RUNNING, running: RUNNING, idleMs: 0, playerLines: 0, ...overrides };
}

describe('SPEC 4.1 wait: the wake rules from staged state', () => {
    test('event: a new event since the call wakes, nothing else does', () => {
        assert.equal(wakeReason('event', state()), null);
        assert.equal(wakeReason('event', state({ now: makeSnapshot({ eventIndex: 2 }) })), 'event');
        assert.equal(wakeReason('event', state({ now: makeSnapshot({ health: 3, running: null }), running: null })), null);
    });

    test('idle: no command runs and nothing ran for 3 s', () => {
        assert.equal(wakeReason('idle', state({ running: null, idleMs: 3000 })), 'idle');
        assert.equal(wakeReason('idle', state({ running: null, idleMs: Infinity })), 'idle');
        assert.equal(wakeReason('idle', state({ running: null, idleMs: 2999 })), null);
        assert.equal(wakeReason('idle', state({ running: RUNNING, idleMs: 60000 })), null);
    });

    test('done: the command that ran when the call came has ended', () => {
        assert.equal(wakeReason('done', state()), null);
        assert.equal(wakeReason('done', state({ running: null })), 'done');
        assert.equal(wakeReason('done', state({ running: { text: '!goToSurface', startedAt: T0 } })), 'done', 'another command runs: the first one ended');
    });

    test('done: at once when none ran', () => {
        assert.equal(wakeReason('done', state({ runningAtStart: null, running: null })), 'done');
        assert.equal(wakeReason('done', state({ runningAtStart: null, running: RUNNING })), 'done');
    });

    test('any: an event, the start or the end of a command', () => {
        assert.equal(wakeReason('any', state()), null);
        assert.equal(wakeReason('any', state({ now: makeSnapshot({ eventIndex: 2 }) })), 'changed');
        assert.equal(wakeReason('any', state({ now: makeSnapshot({ running: null }), running: null })), 'changed');
        assert.equal(wakeReason('any', state({ base: makeSnapshot({ running: null }), runningAtStart: null })), 'changed');
    });

    test('any: health, food, the item in hand, the hazards, the chest, a line of a player', () => {
        assert.equal(wakeReason('any', state({ now: makeSnapshot({ health: 19 }) })), 'changed');
        assert.equal(wakeReason('any', state({ now: makeSnapshot({ food: 14 }) })), 'changed');
        assert.equal(wakeReason('any', state({ now: makeSnapshot({ hand: { name: 'stone_pickaxe', uses: 41 } }) })), 'changed');
        assert.equal(wakeReason('any', state({ now: makeSnapshot({ hazards: [] }) })), 'changed');
        assert.equal(wakeReason('any', state({ now: makeSnapshot({ chest: null }) })), 'changed');
        assert.equal(wakeReason('any', state({ now: makeSnapshot({ chatIndex: 4 }), playerLines: 1 })), 'changed');
    });

    test('any: not the position, the inventory, the job count, the uses left, the bot\'s own lines (the handoff)', () => {
        assert.equal(wakeReason('any', state({ now: makeSnapshot({ pos: { x: 40, y: -59, z: -99 } }) })), null);
        assert.equal(wakeReason('any', state({ now: makeSnapshot({ inventory: { diamond: 9, bread: 4, iron_pickaxe: 1 } }) })), null);
        assert.equal(wakeReason('any', state({ now: makeSnapshot({ job: 'Job: the mining, 9 of 28 diamond, step 2 of 3.' }) })), null);
        assert.equal(wakeReason('any', state({ now: makeSnapshot({ hand: { name: 'iron_pickaxe', uses: 40 } }) })), null);
        assert.equal(wakeReason('any', state({ now: makeSnapshot({ chatIndex: 4 }), playerLines: 0 })), null);
    });

    test('the timeout: 1 to 55 seconds, 55 without a value', () => {
        assert.equal(waitTimeout(undefined), 55);
        assert.equal(waitTimeout(1), 1);
        assert.equal(waitTimeout(55), 55);
        assert.equal(waitTimeout(0), null);
        assert.equal(waitTimeout(56), null);
    });
});

describe('the handoff: a reflex is not a running command', () => {
    test('under a reflex the running command is nothing', () => {
        const agent = makeWatchAgent({ label: 'mode:item_collecting' });
        agent.actions.executing = true;
        assert.equal(runningOf(agent), null);
        assert.equal(snapshotOf(agent, makeWatch()).running, null);
    });

    test('the end of a reflex does not wake `wait done` or `wait any`', () => {
        const agent = makeWatchAgent({ label: 'mode:item_collecting' });
        agent.actions.executing = true;
        const watch = makeWatch();
        const base = snapshotOf(agent, watch);
        agent.actions.executing = false;
        agent.actions.currentActionLabel = '';
        const now = snapshotOf(agent, watch);
        assert.equal(wakeReason('any', { base, now, runningAtStart: base.running, running: now.running, idleMs: 0, playerLines: 0 }), null);
    });
});

describe('SPEC 4.1 the wait tool with a fixture agent', () => {
    const items = [makeTool('iron_pickaxe', 41), { name: 'bread', count: 4 }];

    test('done when nothing runs: at once, Woke: done. and Running: nothing.', async () => {
        const agent = makeWatchAgent({ items, held: makeTool('iron_pickaxe', 41) });
        const watch = makeWatch();
        const started = Date.now();
        const answer = await runTool(agent, watch, 'wait', { for: 'done', timeout: 5 });
        assert.ok(Date.now() - started < 1000, 'answered at once');
        const lines = answer.text.split('\n');
        assert.equal(lines[0], 'Woke: done.');
        assert.ok(lines.includes('Running: nothing.'), answer.text);
        watch.waits?.close?.();
    });

    test('event: a new event wakes it with the digest since the call', async () => {
        const agent = makeWatchAgent({ items, held: makeTool('iron_pickaxe', 41) });
        const watch = makeWatch();
        const pending = runTool(agent, watch, 'wait', { for: 'event', timeout: 5 });
        await new Promise((r) => setTimeout(r, 20));
        watch.events.push(makeEvent('health', 'Health 9 of 20, it fell by 11 in 2 s.', {}, T0));
        const answer = await pending;
        const lines = answer.text.split('\n');
        assert.equal(lines[0], 'Woke: event.');
        assert.match(lines[1], /^Cursor: \d+\.$/);
        assert.ok(lines.includes('Events: 1 new.'), answer.text);
        assert.ok(lines.some((l) => l.endsWith('health: Health 9 of 20, it fell by 11 in 2 s.')), answer.text);
        watch.waits?.close?.();
    });

    test('any: a line of a player wakes it, Woke: changed.', async () => {
        const agent = makeWatchAgent({ items, held: makeTool('iron_pickaxe', 41) });
        const watch = makeWatch();
        const pending = runTool(agent, watch, 'wait', { for: 'any', timeout: 5 });
        await new Promise((r) => setTimeout(r, 20));
        watch.chat.push({ t: T0, name: 'MartyByrde2', text: 'claude, where are you?' });
        const answer = await pending;
        const lines = answer.text.split('\n');
        assert.equal(lines[0], 'Woke: changed.');
        assert.ok(lines.includes('[06:45:12] MartyByrde2: claude, where are you?'), answer.text);
        watch.waits?.close?.();
    });

    test('any: the bot\'s own line and a move do not wake it; the timeout answers Woke: timeout.', async () => {
        const clock = makeClock();
        const agent = makeWatchAgent({ items, held: makeTool('iron_pickaxe', 41) });
        const watch = makeWatch({ clock });
        const pending = runTool(agent, watch, 'wait', { for: 'any', timeout: 1 });
        await new Promise((r) => setTimeout(r, 20));
        watch.chat.push({ t: T0, name: 'claude', text: 'I am at (31, -59, -99).' });
        agent.bot.entity.position.x = 45;
        clock.tick(1500);
        const answer = await pending;
        const lines = answer.text.split('\n');
        assert.equal(lines[0], 'Woke: timeout.');
        assert.match(lines[1], /^Cursor: \d+\.$/);
        watch.waits?.close?.();
    });

    test('a closed connection ends its wait, and its place is free for another', async () => {
        const agent = makeWatchAgent({ items, held: makeTool('iron_pickaxe', 41) });
        const watch = makeWatch();
        const controllers = Array.from({ length: 4 }, () => new AbortController());
        const open = controllers.map((c) => runTool(agent, watch, 'wait', { for: 'event', timeout: 5 }, { signal: c.signal }));
        await new Promise((r) => setTimeout(r, 20));
        controllers[0].abort();
        const ended = await Promise.race([open[0].then(() => 'ended'), new Promise((r) => setTimeout(() => r('still open'), 500))]);
        assert.equal(ended, 'ended', 'the closed connection ended its wait');
        const fifth = runTool(agent, watch, 'wait', { for: 'event', timeout: 5 });
        await new Promise((r) => setTimeout(r, 20));
        watch.events.push(makeEvent('restart', 'claude restarted.', {}, T0));
        const answer = await fifth;
        assert.equal(answer.text.split('\n')[0], 'Woke: event.', 'the fifth wait was not refused');
        await Promise.all(open.slice(1));
        watch.waits?.close?.();
    });

    test('since: the digest of the answer is the one since that cursor', async () => {
        const agent = makeWatchAgent({ items, held: makeTool('iron_pickaxe', 41), food: 15 });
        const watch = makeWatch();
        const first = await runTool(agent, watch, 'digest', {});
        const cursor = first.text.split('\n')[0].match(/^Cursor: (\d+)\.$/)[1];
        agent.bot.entity.position.x += 5; // before the call: no wake (the handoff), but a line since the cursor
        const pending = runTool(agent, watch, 'wait', { for: 'any', timeout: 5, since: cursor });
        await new Promise((r) => setTimeout(r, 20));
        agent.bot.food = 9;
        const answer = await pending;
        const lines = answer.text.split('\n');
        assert.equal(lines[0], 'Woke: changed.');
        assert.match(lines[1], /^Cursor: \d+\.$/);
        assert.deepEqual(lines.slice(2), ['At (36, -59, -99) in overworld, moved 5 blocks.', 'Health 20 of 20, food 9 of 20.'], 'what changed since the cursor');
        watch.waits?.close?.();
    });

    test('the fifth wait is refused: Too many waits: 4 are open.', async () => {
        const agent = makeWatchAgent({ items, held: makeTool('iron_pickaxe', 41) });
        const watch = makeWatch();
        const open = [];
        for (let i = 0; i < 4; i++)
            open.push(runTool(agent, watch, 'wait', { for: 'event', timeout: 5 }));
        await new Promise((r) => setTimeout(r, 20));
        const fifth = await runTool(agent, watch, 'wait', { for: 'event', timeout: 5 });
        assert.equal(fifth.text, 'Too many waits: 4 are open.');
        watch.events.push(makeEvent('restart', 'claude restarted.', {}, T0));
        const answers = await Promise.all(open);
        for (const a of answers)
            assert.equal(a.text.split('\n')[0], 'Woke: event.');
        watch.waits?.close?.();
    });
});
