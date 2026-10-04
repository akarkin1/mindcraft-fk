// Spec v0.1.4.13 4.1 (part S): the four wake rules of wait from staged state (digest_logic.wakeReason), the wait
// tool with a fake agent: the timeout, the wake on an event, idle, done, a changed fact, at most 4 open, a closed
// connection. Every timer is closed at the end.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { changedFacts, isPlayerLine, waitTimeout, wakeReason } from '../../src/agent/watch/digest_logic.js';
import { Ring, makeEvent } from '../../src/agent/watch/events_logic.js';
import { TOOL_HANDLERS, TOOL_RULES, argsRefusal, createWaits, runTool, waitRule } from '../../src/agent/watch/tools.js';

const T0 = new Date(2026, 9, 4, 6, 45, 12).getTime();

function snapshot(overrides = {}) {
    return {
        t: T0, pos: { x: 1, y: 2, z: 3 }, dimension: 'overworld', health: 20, food: 15,
        running: { text: '!mineOre("iron", 6, false)', startedAt: T0 - 1000 }, job: 'Job: the mining, 0 of 6 iron.',
        inventory: { bread: 4 }, hand: { name: 'iron_pickaxe', uses: 41 }, chatIndex: 0, eventIndex: 0, hazards: [], chest: null,
        ...overrides,
    };
}

describe('the wake rules', () => {
    const base = snapshot();
    const running = base.running;

    test('event: a new event since the call', () => {
        assert.equal(wakeReason('event', { base, now: snapshot(), runningAtStart: running, running, idleMs: 0 }), null);
        assert.equal(wakeReason('event', { base, now: snapshot({ eventIndex: 1 }), runningAtStart: running, running, idleMs: 0 }), 'event');
    });

    test('idle: no command runs and nothing ran for 3 s', () => {
        assert.equal(wakeReason('idle', { base, now: base, runningAtStart: running, running, idleMs: 0 }), null);
        assert.equal(wakeReason('idle', { base, now: base, runningAtStart: running, running: null, idleMs: 2999 }), null);
        assert.equal(wakeReason('idle', { base, now: base, runningAtStart: running, running: null, idleMs: 3000 }), 'idle');
        assert.equal(wakeReason('idle', { base, now: base, runningAtStart: null, running: null, idleMs: Infinity }), 'idle');
    });

    test('done: the command that ran when the call came has ended; at once when none ran', () => {
        assert.equal(wakeReason('done', { base, now: base, runningAtStart: running, running, idleMs: 0 }), null);
        assert.equal(wakeReason('done', { base, now: base, runningAtStart: running, running: null, idleMs: 0 }), 'done');
        assert.equal(wakeReason('done', { base, now: base, runningAtStart: running, running: { text: '!goToPlayer("a", 2)', startedAt: T0 }, idleMs: 0 }), 'done');
        assert.equal(wakeReason('done', { base, now: base, runningAtStart: null, running: null, idleMs: 0 }), 'done');
    });

    test('a reflex neither runs for done nor wakes any (a finding of the journey tester)', async () => {
        const agent = fixtureAgent();
        agent.actions = { currentActionLabel: 'mode:torch_placing', last_action_time: T0 - 500, executing: true };
        const { watch } = fixtureWatch(agent);
        const atOnce = await wait(agent, watch, { for: 'done', timeout: 5 });
        assert.deepEqual(atOnce.text.split('\n').slice(0, 2), ['Woke: done.', 'Running: nothing.']);
        const pending = wait(agent, watch, { for: 'any', timeout: 1 });
        await new Promise((r) => setTimeout(r, 30));
        agent.actions = { currentActionLabel: '', last_action_time: T0 - 500, executing: false };
        const answer = await pending;
        assert.equal(answer.text.split('\n')[0], 'Woke: timeout.'); // the reflex ending changed no line
    });

    test('any: a change of the situation, not of the progress', () => {
        const state = (now, extra = {}) => ({ base, now, runningAtStart: running, running: now.running, idleMs: 0, ...extra });
        assert.equal(wakeReason('any', state(snapshot())), null);
        assert.equal(wakeReason('any', state(snapshot({ pos: { x: 9, y: 2, z: 3 }, inventory: { bread: 4, raw_iron: 3 }, job: 'Job: the mining, 3 of 6 iron.', hand: { name: 'iron_pickaxe', uses: 38 } }))), null);
        assert.equal(wakeReason('any', state(snapshot({ health: 14 }))), 'changed');
        assert.equal(wakeReason('any', state(snapshot({ food: 12 }))), 'changed');
        assert.equal(wakeReason('any', state(snapshot({ running: null }))), 'changed');
        assert.equal(wakeReason('any', state(snapshot({ hand: { name: 'stone_pickaxe', uses: 100 } }))), 'changed');
        assert.equal(wakeReason('any', state(snapshot({ hazards: [{ kind: 'lava', pos: { x: 3, y: 2, z: 3 }, blocks: 2 }] }))), 'changed');
        assert.equal(wakeReason('any', state(snapshot({ chest: { pos: { x: 0, y: 0, z: 0 }, free: 2, blocks: 4 } }))), 'changed');
        assert.equal(wakeReason('any', state(snapshot({ eventIndex: 1 }))), 'changed');
        assert.equal(wakeReason('any', state(snapshot({ chatIndex: 2 }), { playerLines: 0 })), null); // the bot's own lines
        assert.equal(wakeReason('any', state(snapshot({ chatIndex: 2 }), { playerLines: 1 })), 'changed');
        assert.deepEqual(changedFacts(base, snapshot({ health: 1, hazards: [{ kind: 'lava', pos: { x: 3, y: 2, z: 3 }, blocks: 2 }] })), ['health', 'hazards']);
        assert.equal(wakeReason('nap', state(snapshot({ health: 1 }))), null);
    });

    test('a line of a player: not the bot, not a line of the watch', () => {
        assert.equal(isPlayerLine({ name: 'MartyByrde2' }, 'Luna'), true);
        assert.equal(isPlayerLine({ name: 'Luna' }, 'Luna'), false);
        assert.equal(isPlayerLine({ name: 'MartyByrde2 (by watch)' }, 'Luna'), false);
    });

    test('for and timeout', () => {
        assert.equal(waitRule(undefined), 'any');
        assert.equal(waitRule('idle'), 'idle');
        assert.equal(waitRule('nap'), null);
        assert.equal(waitTimeout(undefined), 55);
        assert.equal(waitTimeout('30'), 30);
        assert.equal(waitTimeout(0), null);
        assert.equal(waitTimeout(56), null);
        assert.equal(argsRefusal('wait', { for: 'nap' }), 'wait takes for: event, idle, done or any, not "nap".');
        assert.equal(argsRefusal('wait', { timeout: 90 }), 'wait takes a timeout of 1 to 55 seconds, not "90".');
        assert.equal(argsRefusal('wait', { for: 'done', timeout: 5, since: '3' }), null);
    });
});

function fixtureAgent() {
    return {
        name: 'Luna',
        bot: {
            username: 'Luna', entity: { position: { x: 1.5, y: 2, z: 3.5 } }, health: 20, food: 15, game: { dimension: 'overworld' },
            blockAt: () => ({ name: 'stone' }), heldItem: null, inventory: { items: () => [], slots: [] }, entities: {},
        },
        actions: { currentActionLabel: '', last_action_time: 0, executing: false },
        running_commands: [],
    };
}

function fixtureWatch(agent) {
    const now = { t: T0 };
    const watch = { now: () => now.t, chat: new Ring(100), events: new Ring(200), settings: {}, waitTickMs: 10 };
    watch.waits = createWaits(agent, watch, { tickMs: 10 });
    return { watch, now };
}

const wait = (agent, watch, args, request) => runTool(agent, watch, 'wait', args, request);

describe('the wait tool', () => {
    test('the timeout: Woke: timeout. and the digest since the call', async () => {
        const agent = fixtureAgent();
        const { watch } = fixtureWatch(agent);
        const answer = await wait(agent, watch, { for: 'event', timeout: 1 });
        assert.equal(answer.isError, false);
        assert.deepEqual(answer.text.split('\n'), ['Woke: timeout.', 'Cursor: 1.', 'Nothing changed.']);
        assert.equal(watch.waits.size, 0);
    });

    test('event: wakes when an event is pushed, with the event in the digest', async () => {
        const agent = fixtureAgent();
        const { watch } = fixtureWatch(agent);
        const pending = wait(agent, watch, { for: 'event', timeout: 5 });
        await new Promise((r) => setTimeout(r, 15));
        watch.events.push(makeEvent('death', 'Luna died at (1, 2, 3).', {}, T0));
        watch.waits.onEvent();
        const answer = await pending;
        assert.deepEqual(answer.text.split('\n'), ['Woke: event.', 'Cursor: 1.', 'Events: 1 new.', '[06:45:12] death: Luna died at (1, 2, 3).']);
    });

    test('done: at once with Running: nothing. when none ran; else when the command ended', async () => {
        const agent = fixtureAgent();
        const { watch } = fixtureWatch(agent);
        const atOnce = await wait(agent, watch, { for: 'done', timeout: 5 });
        assert.deepEqual(atOnce.text.split('\n'), ['Woke: done.', 'Running: nothing.', 'Cursor: 1.', 'Nothing changed.']);
        agent.actions = { currentActionLabel: 'action:mineOre', last_action_time: T0 - 1000, executing: true };
        agent.running_commands = [{ name: '!mineOre', text: '!mineOre("iron", 6, false)' }];
        const pending = wait(agent, watch, { for: 'done', timeout: 5 }); // without since: the digest since the call
        await new Promise((r) => setTimeout(r, 30));
        agent.actions = { currentActionLabel: '', last_action_time: T0 - 1000, executing: false };
        agent.running_commands = [];
        const answer = await pending;
        assert.deepEqual(answer.text.split('\n'), ['Woke: done.', 'Cursor: 2.', 'Running: nothing.']);
    });

    test('idle: nothing runs and nothing ran for 3 s', async () => {
        const agent = fixtureAgent();
        const { watch, now } = fixtureWatch(agent);
        agent.actions = { currentActionLabel: 'action:goToPlayer', last_action_time: T0 - 500, executing: true };
        const pending = wait(agent, watch, { for: 'idle', timeout: 5 });
        await new Promise((r) => setTimeout(r, 30));
        agent.actions = { currentActionLabel: '', last_action_time: T0 - 500, executing: false };
        now.t = T0 + 1000;
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(watch.waits.size, 1); // 1 s idle is not 3 s
        now.t = T0 + 3100;
        const answer = await pending;
        assert.equal(answer.text.split('\n')[0], 'Woke: idle.');
    });

    test('any: a changed fact wakes, headed Woke: changed.', async () => {
        const agent = fixtureAgent();
        const { watch } = fixtureWatch(agent);
        const pending = wait(agent, watch, {});
        await new Promise((r) => setTimeout(r, 15));
        agent.bot.health = 14;
        const answer = await pending;
        assert.deepEqual(answer.text.split('\n'), ['Woke: changed.', 'Cursor: 1.', 'Health 14 of 20, food 15 of 20.']);
    });

    test('at most 4 waits; the fifth is refused', async () => {
        const agent = fixtureAgent();
        const { watch } = fixtureWatch(agent);
        const open = [1, 2, 3, 4].map(() => wait(agent, watch, { for: 'event', timeout: 2 }));
        await new Promise((r) => setTimeout(r, 15));
        const fifth = await wait(agent, watch, { for: 'event', timeout: 1 });
        assert.deepEqual(fifth, { text: 'Too many waits: 4 are open.', isError: true });
        assert.equal(TOOL_RULES.waitsMax, 4);
        watch.waits.close();
        const answers = await Promise.all(open);
        assert.ok(answers.every((a) => a.text.startsWith('Woke: timeout.')));
    });

    test('a closed connection ends its wait', async () => {
        const agent = fixtureAgent();
        const { watch } = fixtureWatch(agent);
        const aborter = new AbortController();
        const pending = TOOL_HANDLERS.wait(agent, {}, watch, { signal: aborter.signal });
        await new Promise((r) => setTimeout(r, 15));
        assert.equal(watch.waits.size, 1);
        aborter.abort();
        assert.equal(await pending, '');
        assert.equal(watch.waits.size, 0);
        assert.equal(typeof watch.presence.seenAt, 'number');
    });
});
