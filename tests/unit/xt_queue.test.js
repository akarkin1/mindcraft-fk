// Tests from the spec (v0.1.4.13, section 6, T1): the queue of `run` of part S (SPEC 4.1): the stop rule (a
// result that is a failure of the skill stops the queue when stop_on_failure), the answer lines `Ran 3 of 3.`
// with the numbered lines, `started` for a long skill, `Still running: 2 of 5.`, the refusal `run takes commands
// only; use say for words.`, 1 to 10 commands; the handoff's `Stopped at i of n.` and `Stopped by <player> at i of
// n.`; the owner's typed command queued behind the queue, `!stop` empties it. A failing test is a finding.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueue, isFailureResult, runAnswer, runRefusal } from '../../src/agent/watch/queue.js';
import { PLAY_MS, makeQueueAgent } from '../helpers/xt_watch.js';

const TAKE = '!takeFromChest("bread", 10)';
const CRAFT = '!craftRecipe("stone_pickaxe", 1)';
const MINE = '!mineOre("diamond", 28)';
const TOOK = 'Successfully took 5 bread from the chest.';
const CRAFTED = 'Successfully crafted stone_pickaxe, you now have 2 stone_pickaxe.';

describe('SPEC 4.1 run: the stop rule, what is a failure of the skill', () => {
    test('{ ok: false } of the pack is a failure whatever the text', () => {
        assert.equal(isFailureResult({ ok: false, reason: 'no_chest', text: 'I found no chest.' }, 'I found no chest.'), true);
        assert.equal(isFailureResult({ ok: false }, TOOK), true);
    });

    test('the lines Failed, I could not, I cannot, Path not found at the start of the output', () => {
        assert.equal(isFailureResult(null, 'Failed to craft stone_pickaxe.'), true);
        assert.equal(isFailureResult(null, 'I could not get to the chest.'), true);
        assert.equal(isFailureResult(null, 'I cannot reach the ore.'), true);
        assert.equal(isFailureResult(null, 'Path not found.'), true);
    });

    test('a success of the pack or a plain success text is no failure', () => {
        assert.equal(isFailureResult({ ok: true, reason: null, text: TOOK }, TOOK), false);
        assert.equal(isFailureResult(null, TOOK), false);
        assert.equal(isFailureResult(null, CRAFTED), false);
        assert.equal(isFailureResult(null, 'I mined 8 raw_iron. The mine is at (20, 64, -14).'), false);
    });
});

describe('SPEC 4.1 run: the arguments', () => {
    test('a text that is not a !command is refused', () => {
        assert.equal(runRefusal({ commands: ['come here'] }), 'run takes commands only; use say for words.');
        assert.equal(runRefusal({ commands: [TAKE, 'and then wait'] }), 'run takes commands only; use say for words.');
    });

    test('1 to 10 commands', () => {
        assert.equal(runRefusal({ commands: [TAKE] }), null);
        assert.equal(runRefusal({ commands: Array.from({ length: 10 }, () => TAKE) }), null);
        assert.notEqual(runRefusal({ commands: [] }), null);
        assert.notEqual(runRefusal({ commands: Array.from({ length: 11 }, () => TAKE) }), null);
        assert.notEqual(runRefusal({}), null);
    });
});

describe('SPEC 4.1 run: the answer lines', () => {
    test('Ran 3 of 3. with the numbered lines and started for the long skill', () => {
        const answer = runAnswer({
            items: [
                { text: TAKE, status: 'done', result: TOOK },
                { text: CRAFT, status: 'done', result: CRAFTED },
                { text: MINE, status: 'started', result: '' },
            ],
            stopped: null,
        });
        assert.equal(answer, [
            'Ran 3 of 3.',
            `1. ${TAKE}: ${TOOK}`,
            `2. ${CRAFT}: ${CRAFTED}`,
            `3. ${MINE}: started.`,
        ].join('\n'));
    });

    test('a longer queue: what is done and Still running: 2 of 5.', () => {
        const answer = runAnswer({
            items: [
                { text: TAKE, status: 'done', result: TOOK },
                { text: CRAFT, status: 'running', result: '' },
                { text: MINE, status: 'waiting', result: '' },
                { text: '!goToSurface', status: 'waiting', result: '' },
                { text: '!stop', status: 'waiting', result: '' },
            ],
            stopped: null,
        });
        const lines = answer.split('\n');
        assert.ok(lines.includes(`1. ${TAKE}: ${TOOK}`), answer);
        assert.ok(lines.includes('Still running: 2 of 5.'), answer);
        assert.ok(!lines.some((l) => l.startsWith('3. ')), 'the rest comes through digest');
    });

    test('stopped by the stop rule: Stopped at 2 of 3. (the handoff)', () => {
        const answer = runAnswer({
            items: [
                { text: TAKE, status: 'done', result: TOOK },
                { text: CRAFT, status: 'failed', result: 'Failed to craft stone_pickaxe: I need 3 cobblestone and have 1.' },
                { text: MINE, status: 'skipped', result: '' },
            ],
            stopped: { by: null, at: 2 },
        });
        const lines = answer.split('\n');
        assert.ok(lines.includes('Stopped at 2 of 3.'), answer);
        assert.ok(lines.includes(`1. ${TAKE}: ${TOOK}`), answer);
        assert.ok(lines.includes(`2. ${CRAFT}: Failed to craft stone_pickaxe: I need 3 cobblestone and have 1.`), answer);
    });

    test('stopped by the owner: Stopped by MartyByrde2 at 2 of 3. (the handoff)', () => {
        const answer = runAnswer({
            items: [
                { text: TAKE, status: 'done', result: TOOK },
                { text: MINE, status: 'started', result: '' },
                { text: CRAFT, status: 'skipped', result: '' },
            ],
            stopped: { by: 'MartyByrde2', at: 2 },
        });
        assert.ok(answer.split('\n').includes('Stopped by MartyByrde2 at 2 of 3.'), answer);
    });
});

const textOf = (answer) => (typeof answer === 'string' ? answer : answer?.text ?? JSON.stringify(answer));

describe('SPEC 4.1 run: the queue with a fixture agent', () => {
    test('the commands run one after the other, each after the previous result', async () => {
        const agent = makeQueueAgent({
            [TAKE]: { ms: PLAY_MS, pack: { ok: true, reason: null, text: TOOK } },
            [CRAFT]: { ms: PLAY_MS, pack: { ok: true, reason: null, text: CRAFTED } },
        });
        const queue = createQueue(agent, { longSkillMs: 200 });
        try {
            const answer = await queue.run([TAKE, CRAFT], { by: 'MartyByrde2', stopOnFailure: true });
            const text = typeof answer === 'string' ? answer : answer?.text ?? JSON.stringify(answer);
            assert.deepEqual(agent.played.map((p) => p.text), [TAKE, CRAFT]);
            assert.equal(text.split('\n')[0], 'Ran 2 of 2.');
            assert.ok(text.includes(`1. ${TAKE}: ${TOOK}`), text);
            assert.ok(text.includes(`2. ${CRAFT}: ${CRAFTED}`), text);
        } finally {
            queue.close();
        }
    });

    test('a failure of the skill stops the queue when stop_on_failure; the rest is not run', async () => {
        const agent = makeQueueAgent({
            [TAKE]: { ms: PLAY_MS, pack: { ok: false, reason: 'no_chest', text: 'I found no chest within 16 blocks.' } },
            [CRAFT]: { ms: PLAY_MS, pack: { ok: true, reason: null, text: CRAFTED } },
        });
        const queue = createQueue(agent, { longSkillMs: 200 });
        try {
            const answer = await queue.run([TAKE, CRAFT, MINE], { by: 'MartyByrde2', stopOnFailure: true });
            const text = typeof answer === 'string' ? answer : answer?.text ?? JSON.stringify(answer);
            assert.deepEqual(agent.played.map((p) => p.text), [TAKE], 'the queue stopped after the failure');
            assert.ok(text.split('\n').includes('Stopped at 1 of 3.'), text);
        } finally {
            queue.close();
        }
    });

    test('with stop_on_failure false the queue goes on after a failure', async () => {
        const agent = makeQueueAgent({
            [TAKE]: { ms: PLAY_MS, pack: { ok: false, reason: 'no_chest', text: 'I found no chest within 16 blocks.' } },
            [CRAFT]: { ms: PLAY_MS, pack: { ok: true, reason: null, text: CRAFTED } },
        });
        const queue = createQueue(agent, { longSkillMs: 200 });
        try {
            const answer = await queue.run([TAKE, CRAFT], { by: 'MartyByrde2', stopOnFailure: false });
            const text = typeof answer === 'string' ? answer : answer?.text ?? JSON.stringify(answer);
            assert.deepEqual(agent.played.map((p) => p.text), [TAKE, CRAFT]);
            assert.equal(text.split('\n')[0], 'Ran 2 of 2.');
        } finally {
            queue.close();
        }
    });

    test('a long skill counts as done after 2 s without a failure: started', async () => {
        const agent = makeQueueAgent({
            [MINE]: { ms: 600, pack: { ok: true, reason: null, text: 'I mined 28 diamond.' } },
        });
        const queue = createQueue(agent, { longSkillMs: 100 });
        try {
            const started = Date.now();
            const answer = await queue.run([MINE], { by: 'MartyByrde2', stopOnFailure: true });
            const text = typeof answer === 'string' ? answer : answer?.text ?? JSON.stringify(answer);
            assert.ok(Date.now() - started < 550, 'answered while the skill still ran');
            assert.equal(text, `Ran 1 of 1.\n1. ${MINE}: started.`);
            await new Promise((r) => setTimeout(r, 700));
        } finally {
            queue.close();
        }
    });

    test('a long skill that fails within 2 s is a failure, not started, and stops the queue', async () => {
        const agent = makeQueueAgent({
            [MINE]: { ms: PLAY_MS, pack: { ok: false, reason: 'no_mine', text: 'I know no mine for diamond. Tell me where to dig.' } },
        });
        const queue = createQueue(agent, { longSkillMs: 400 });
        try {
            const answer = textOf(await queue.run([MINE, CRAFT], { by: 'MartyByrde2', stopOnFailure: true }));
            assert.deepEqual(agent.played.map((p) => p.text), [MINE]);
            assert.ok(answer.includes(`1. ${MINE}: I know no mine for diamond. Tell me where to dig.`), answer);
            assert.ok(!answer.includes('started'), answer);
            assert.ok(answer.split('\n').includes('Stopped at 1 of 2.'), answer);
        } finally {
            queue.close();
        }
    });

    // FINDING (T1-run-long): the spec names the long skills, `!mineOre`, `!farmCycle`, `!followPlayer`, and only they
    // count as done after 2 s; the queue answers `started` for any last command that still runs after the long-skill
    // time (`!goToPlayer`, `!takeFromChest`), so its result, or a failure that comes later, is not in the answer.
    test('a skill that is not long is waited for, however long it runs, and its result is the line', async () => {
        const GO = '!goToPlayer("MartyByrde2", 3)';
        const agent = makeQueueAgent({ [GO]: { ms: 500, pack: null, output: 'You have reached MartyByrde2.' } });
        const queue = createQueue(agent, { longSkillMs: 100 });
        try {
            const answer = textOf(await queue.run([GO], { by: 'MartyByrde2', stopOnFailure: true }));
            assert.equal(answer, `Ran 1 of 1.\n1. ${GO}: You have reached MartyByrde2.`);
        } finally {
            queue.close();
        }
        await new Promise((r) => setTimeout(r, 600));
    });

    test('a skill that is not long, before another command: the next one is handed on after it ended', async () => {
        const GO = '!goToPlayer("MartyByrde2", 3)';
        const agent = makeQueueAgent({
            [GO]: { ms: 500, pack: null, output: 'You have reached MartyByrde2.' },
            [TAKE]: { ms: PLAY_MS, pack: { ok: true, reason: null, text: TOOK } },
        });
        const queue = createQueue(agent, { longSkillMs: 300 });
        try {
            const answer = textOf(await queue.run([GO, TAKE], { by: 'MartyByrde2', stopOnFailure: true }));
            const take = agent.played.find((p) => p.text === TAKE);
            assert.deepEqual(take?.busy, [], 'the take is handed on after the walk ended');
            assert.ok(answer.includes(`1. ${GO}: You have reached MartyByrde2.`), answer);
        } finally {
            queue.close();
        }
        await new Promise((r) => setTimeout(r, 600));
    });

    test('a command that ends at once (a query, an instant failure) still gives its line and the stop rule', async () => {
        // the queue must see a result that comes faster than its poll: !inventory answers at once, and a craft
        // without the material fails at once in the game
        const INV = '!inventory';
        const agent = makeQueueAgent({
            [INV]: { ms: 1, pack: null, output: 'INVENTORY\n- bread: 4' },
            [CRAFT]: { ms: 1, pack: null, output: 'Failed to craft stone_pickaxe: I need 3 cobblestone and have 1.' },
        });
        const queue = createQueue(agent, { longSkillMs: 200 });
        try {
            const answer = textOf(await queue.run([INV, CRAFT, TAKE], { by: 'MartyByrde2', stopOnFailure: true }));
            assert.deepEqual(agent.played.map((p) => p.text), [INV, CRAFT], 'the failure stopped the queue');
            assert.ok(answer.includes('1. !inventory: INVENTORY'), answer);
            assert.ok(answer.includes(`2. ${CRAFT}: Failed to craft stone_pickaxe`), answer);
            assert.ok(answer.split('\n').includes('Stopped at 2 of 3.'), answer);
        } finally {
            queue.close();
        }
    });

    test('at the answer time: what is done and Still running: 2 of 5., the rest runs on', async () => {
        const agent = makeQueueAgent({ [TAKE]: { ms: PLAY_MS, pack: { ok: true, reason: null, text: TOOK } } });
        const queue = createQueue(agent, { longSkillMs: 5000, answerMs: PLAY_MS + 75 });
        try {
            const answer = textOf(await queue.run([TAKE, CRAFT, '!stats', '!inventory', '!goToSurface'], { by: 'MartyByrde2', stopOnFailure: true }));
            const lines = answer.split('\n');
            assert.ok(lines.includes(`1. ${TAKE}: ${TOOK}`), answer);
            assert.ok(lines.includes('Still running: 2 of 5.'), answer);
            await new Promise((r) => setTimeout(r, PLAY_MS));
            assert.ok(agent.played.length >= 3, `the rest runs on after the answer: ${agent.played.length}`);
        } finally {
            queue.close();
        }
        await new Promise((r) => setTimeout(r, 4 * PLAY_MS));
    });
});

describe('SPEC 4.1 run: the owner while the queue runs (the handoff)', () => {
    const GO = '!goToPlayer("MartyByrde2", 3)';

    test('a typed !command of the owner is queued behind the queue, not run, and told so', async () => {
        const agent = makeQueueAgent({});
        const queue = createQueue(agent, { longSkillMs: 5000 });
        try {
            const pending = queue.run([TAKE, CRAFT], { by: 'MartyByrde2', stopOnFailure: true });
            await new Promise((r) => setTimeout(r, PLAY_MS / 2));
            await agent.handleMessage('MartyByrde2', GO);
            assert.deepEqual(agent.played.map((p) => p.text).filter((t) => t === GO).length <= 1, true);
            assert.ok(agent.routed.some((r) => /^Queued: I run it after \d+ commands?\.$/.test(r.text)), JSON.stringify(agent.routed));
            const queued = agent.routed.find((r) => r.text.startsWith('Queued:'));
            assert.equal(queued.text, 'Queued: I run it after 2 commands.', 'the take that runs and the craft that waits');
            await pending;
            await new Promise((r) => setTimeout(r, 2 * PLAY_MS));
            const order = agent.played.map((p) => p.text);
            assert.deepEqual(order.slice(0, 3), [TAKE, CRAFT, GO], `run after the queue: ${JSON.stringify(order)}`);
        } finally {
            queue.close();
        }
        await new Promise((r) => setTimeout(r, 2 * PLAY_MS));
    });

    test('!stop of the owner empties the queue and stops: Stopped by MartyByrde2 at 1 of 3.', async () => {
        const agent = makeQueueAgent({});
        const queue = createQueue(agent, { longSkillMs: 5000 });
        try {
            const pending = queue.run([TAKE, CRAFT, GO], { by: 'MartyByrde2', stopOnFailure: true });
            await new Promise((r) => setTimeout(r, PLAY_MS / 2));
            await agent.handleMessage('MartyByrde2', '!stop');
            const answer = textOf(await pending);
            await new Promise((r) => setTimeout(r, 2 * PLAY_MS));
            const order = agent.played.map((p) => p.text);
            assert.ok(!order.includes(CRAFT) && !order.includes(GO), `the rest is not run: ${JSON.stringify(order)}`);
            assert.ok(answer.split('\n').includes('Stopped by MartyByrde2 at 1 of 3.'), answer);
        } finally {
            queue.close();
        }
    });
});
