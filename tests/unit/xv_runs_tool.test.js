// Spec v0.1.4.16, F9 (engineer E2): the watch tool runs and the answer of run. Every item of the queue has an id; the answer
// of a run that is not done after the answer time ends with `Still running: <command> (run <id>).`; the tool runs lists the
// items of the last hour as { id, command, state: 'running' | 'done' | 'failed', text, startedAt, endedAt }; the queue hands
// its commands with { quiet: true } (the owner's own command behind the queue without).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { RUNS_KEEP_MS, createQueue, runAnswer } from '../../src/agent/watch/queue.js';
import { RUNS_TOOL, registerRunsTool, runTool, toolList, unregisterTool } from '../../src/agent/watch/tools.js';
import { TEXTS } from '../../src/agent/watch/texts.js';
import { TOOL_NAMES } from '../../src/agent/watch/mcp_logic.js';
import { Ring } from '../../src/agent/watch/events_logic.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A fake agent as xs_queue's: handleMessage plays a scripted command and records its arguments.
function fakeAgent(script) {
    const agent = {
        name: 'Luna',
        bot: { username: 'Luna' },
        running_commands: [],
        handled: [],
        routed: [],
        actions: { currentActionLabel: '', executing: false, last_action_time: 0 },
        async routeResponse(to, message) {
            this.routed.push([to, message]);
        },
        async handleMessage(source, message, options) {
            this.handled.push([source, message, options]);
            const name = message.match(/^!(\w+)/)?.[1];
            const step = script[name] ?? { text: `ran ${name}`, ms: 5 };
            const entry = { name: `!${name}`, text: message, typed: true, by: source };
            this.running_commands.push(entry);
            await sleep(step.ms ?? 5);
            if (step.pack)
                entry.pack = step.pack;
            this.running_commands.splice(this.running_commands.indexOf(entry), 1);
            if (step.text !== undefined && step.text !== null)
                this.routeResponse(source, step.text);
            return true;
        },
    };
    return agent;
}

describe('the answer with the id (F9)', () => {
    test('stillRunning names the command and the id; runAnswer uses the running item', () => {
        assert.equal(TEXTS.stillRunning('!mineOre("iron", 6)', 3), 'Still running: !mineOre("iron", 6) (run 3).');
        const answer = runAnswer({ items: [{ id: 1, text: '!stats', status: 'done', result: 'STATS' }, { id: 2, text: '!mineOre("iron", 6)', status: 'running', result: '' }], stopped: null });
        assert.deepEqual(answer.split('\n'), ['Ran 1 of 2.', '1. !stats: STATS', 'Still running: !mineOre("iron", 6) (run 2).']);
    });

    test('after the answer time the answer ends with the running command and its id; the ids count from 1 per queue', async () => {
        const agent = fakeAgent({ goToPlayer: { text: 'Arrived.', ms: 300 }, stats: { text: 'STATS', ms: 5 } });
        const queue = createQueue(agent, { longSkillMs: 1000, answerMs: 60 });
        const answer = await queue.run(['!stats', '!goToPlayer("a", 2)', '!stats'], { by: 'MartyByrde2' });
        assert.deepEqual(answer.split('\n'), ['Ran 1 of 3.', '1. !stats: STATS', 'Still running: !goToPlayer("a", 2) (run 2).']);
        const during = queue.runs();
        assert.deepEqual(during.map((r) => [r.id, r.command, r.state, r.text]), [[1, '!stats', 'done', 'STATS'], [2, '!goToPlayer("a", 2)', 'running', '']], 'the waiting third item is not listed yet');
        assert.equal(typeof during[0].startedAt, 'string');
        assert.equal(typeof during[0].endedAt, 'string');
        assert.equal(during[1].endedAt, null, 'no end while it runs');
        await sleep(400);
        const after = queue.runs();
        assert.deepEqual(after.map((r) => [r.id, r.state, r.text]), [[1, 'done', 'STATS'], [2, 'done', 'Arrived.'], [3, 'done', 'STATS']]);
        assert.ok(after.every((r) => typeof r.endedAt === 'string'));
        assert.deepEqual(agent.handled.map(([, , options]) => options), [{ quiet: true }, { quiet: true }, { quiet: true }], 'the queue hands its commands quiet');
        queue.close();
    });

    test('a failed command is failed; a dropped one is failed with "not run"; the owner\'s own command behind the queue is handed without the flag', async () => {
        const agent = fakeAgent({
            craftRecipe: { text: 'I cannot craft x.', ms: 30, pack: { ok: false, reason: 'no_material', text: 'I cannot craft x.' } },
            stats: { text: 'STATS', ms: 5 },
            goToPlayer: { text: 'Arrived.', ms: 120 },
        });
        const queue = createQueue(agent, { longSkillMs: 1000, answerMs: 2000 });
        const answer = await queue.run(['!craftRecipe("x", 1)', '!stats'], { by: 'MartyByrde2' });
        assert.ok(answer.split('\n').includes('Stopped at 1 of 2.'), answer);
        assert.deepEqual(queue.runs().map((r) => [r.id, r.state, r.text]), [[1, 'failed', 'I cannot craft x.']], 'the skipped command never ran: not listed');
        const run = queue.run(['!goToPlayer("a", 2)'], { by: 'MartyByrde2' });
        await sleep(20);
        await agent.handleMessage('MartyByrde2', '!stats'); // the owner types while the queue runs: queued behind it
        await run;
        await sleep(60);
        const list = queue.runs();
        assert.deepEqual(list.map((r) => [r.id, r.command, r.state]), [[1, '!craftRecipe("x", 1)', 'failed'], [3, '!goToPlayer("a", 2)', 'done'], [4, '!stats', 'done']]);
        assert.deepEqual(agent.handled.map(([, text, options]) => [text, options]), [['!craftRecipe("x", 1)', { quiet: true }], ['!goToPlayer("a", 2)', { quiet: true }], ['!stats', undefined]]);
        queue.close();
    });

    test('the items of the last hour only', async () => {
        let t = Date.UTC(2026, 11, 1, 12, 0, 0);
        const agent = fakeAgent({ stats: { text: 'STATS', ms: 5 } });
        const queue = createQueue(agent, { now: () => t, longSkillMs: 1000, answerMs: 2000 });
        await queue.run(['!stats'], { by: 'MartyByrde2' });
        assert.equal(queue.runs().length, 1);
        assert.equal(queue.runs()[0].startedAt, new Date(t).toISOString());
        t += RUNS_KEEP_MS + 1000;
        assert.deepEqual(queue.runs(), [], 'an hour later the item is gone');
        assert.equal(RUNS_KEEP_MS, 3600000);
        queue.close();
    });
});

describe('the tool runs (F9)', () => {
    test('registered through registerTool, never in the pinned table; it answers the queue\'s items as JSON', async () => {
        assert.ok(!TOOL_NAMES.includes('runs'), 'TOOL_NAMES is untouched');
        const tool = toolList().find((t) => t.name === 'runs');
        assert.ok(tool, 'registered when tools.js loads');
        assert.match(tool.description, /Still running: <command> \(run <id>\)/);
        assert.deepEqual(tool.inputSchema, { type: 'object', properties: {}, additionalProperties: false });
        const agent = fakeAgent({ stats: { text: 'STATS', ms: 5 }, goToPlayer: { text: 'Arrived.', ms: 200 } });
        const watch = { now: () => Date.now(), chat: new Ring(100), events: new Ring(200), settings: { only_chat_with: ['MartyByrde2'] }, longSkillMs: 1000, answerMs: 60 };
        const ran = await runTool(agent, watch, 'run', { commands: ['!stats', '!goToPlayer("a", 2)'] });
        assert.deepEqual(ran, { text: 'Ran 1 of 2.\n1. !stats: STATS\nStill running: !goToPlayer("a", 2) (run 2).', isError: false });
        const out = await runTool(agent, watch, 'runs', {});
        assert.equal(out.isError, false);
        const parsed = JSON.parse(out.text);
        assert.deepEqual(parsed.runs.map((r) => [r.id, r.command, r.state, r.text]), [[1, '!stats', 'done', 'STATS'], [2, '!goToPlayer("a", 2)', 'running', '']]);
        await sleep(300);
        assert.deepEqual(JSON.parse((await runTool(agent, watch, 'runs', {})).text).runs.map((r) => r.state), ['done', 'done']);
        const fresh = await runTool(agent, { now: () => Date.now(), chat: new Ring(10), events: new Ring(10), settings: {} }, 'runs', {});
        assert.deepEqual(JSON.parse(fresh.text), { runs: [] }, 'a watch without a queue yet: an empty list');
        watch.queue.close();
    });

    test('RUNS_TOOL and registerRunsTool', async () => {
        assert.equal(RUNS_TOOL.name, 'runs');
        assert.equal(await RUNS_TOOL.handler({}, {}, { queue: { runs: () => [{ id: 1 }] } }), '{"runs":[{"id":1}]}');
        assert.equal(await RUNS_TOOL.handler({}, {}, { queue: { runs: () => { throw new Error('x'); } } }), '{"runs":[]}');
        assert.equal(registerRunsTool(null), false);
        assert.equal(unregisterTool('runs'), true);
        assert.equal(registerRunsTool((name, schema, handler) => name === 'runs' && typeof handler === 'function' && Boolean(schema)), true);
        // put it back as tools.js registers it, for the other tests of this process
        const { registerTool } = await import('../../src/agent/watch/tools.js');
        registerRunsTool(registerTool);
        assert.ok(toolList().some((t) => t.name === 'runs'));
    });
});
