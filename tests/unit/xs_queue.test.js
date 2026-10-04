// Spec v0.1.4.13 4.1 (part S): the command queue of run: the commands one after the other as the owner, the stop
// rule, "started" for a long skill, the owner's commands behind the queue, !stop, the answer at the latest after
// the answer time, the refusals. A fake agent whose handleMessage runs scripted commands. No timer stays open.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { FAILURE_STARTS, createQueue, isCommandText, isFailureResult, runAnswer, runRefusal } from '../../src/agent/watch/queue.js';
import { TOOL_HANDLERS, argsRefusal, runTool } from '../../src/agent/watch/tools.js';
import { Ring } from '../../src/agent/watch/events_logic.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('the pure parts', () => {
    test('a !command and nothing else', () => {
        assert.equal(isCommandText('!mineOre("diamond", 28)'), true);
        assert.equal(isCommandText('!stop'), true);
        assert.equal(isCommandText('  !stats '), true);
        assert.equal(isCommandText('come here'), false);
        assert.equal(isCommandText('please !stop'), false);
        assert.equal(isCommandText(''), false);
    });

    test('the stop rule: { ok: false } of the pack, or the four line starts of the spec', () => {
        assert.equal(isFailureResult({ ok: false, text: 'I mined 0 of 28.' }, 'I mined 0 of 28.'), true);
        assert.equal(isFailureResult({ ok: true }, 'Successfully crafted stone_pickaxe, you now have 2 stone_pickaxe.'), false);
        assert.equal(isFailureResult(null, 'Failed to craft.'), true);
        assert.equal(isFailureResult(null, 'I could not reach the chest.'), true);
        assert.equal(isFailureResult(null, 'I cannot see a furnace.'), true);
        assert.equal(isFailureResult(null, 'Path not found to the farm.'), true);
        assert.equal(isFailureResult(null, 'Successfully took 5 bread from the chest.'), false);
        assert.equal(isFailureResult(null, ''), false);
        assert.equal(FAILURE_STARTS.length, 4);
    });

    test('the refusals of run: 1 to 10 commands, each a !command', () => {
        assert.equal(runRefusal({}), 'run takes commands: an array of 1 to 10 strings.');
        assert.equal(runRefusal({ commands: [] }), 'run takes commands: an array of 1 to 10 strings.');
        assert.equal(runRefusal({ commands: Array(11).fill('!stats') }), 'run takes commands: an array of 1 to 10 strings.');
        assert.equal(runRefusal({ commands: ['come here'] }), 'run takes commands only; use say for words.');
        assert.equal(runRefusal({ commands: ['!stats'] }), null);
        assert.equal(argsRefusal('run', { commands: ['go'] }), 'run takes commands only; use say for words.');
    });

    test('the answer from a batch record', () => {
        const items = [
            { text: '!takeFromChest("bread", 10)', status: 'done', result: 'Successfully took 5 bread from the chest.' },
            { text: '!craftRecipe("stone_pickaxe", 1)', status: 'done', result: 'Successfully crafted stone_pickaxe, you now have 2 stone_pickaxe.' },
            { text: '!mineOre("diamond", 28)', status: 'started', result: 'started.' },
        ];
        assert.equal(runAnswer({ items, stopped: null }), [
            'Ran 3 of 3.',
            '1. !takeFromChest("bread", 10): Successfully took 5 bread from the chest.',
            '2. !craftRecipe("stone_pickaxe", 1): Successfully crafted stone_pickaxe, you now have 2 stone_pickaxe.',
            '3. !mineOre("diamond", 28): started.',
        ].join('\n'));
        const long = [items[0], items[1], { text: '!goToPlayer("a", 2)', status: 'running', result: '' }, { text: '!stats', status: 'waiting', result: '' }, { text: '!stats', status: 'waiting', result: '' }];
        assert.equal(runAnswer({ items: long, stopped: null }).split('\n').at(-1), 'Still running: 3 of 5.');
        assert.equal(runAnswer({ items: long, stopped: null }).split('\n')[0], 'Ran 2 of 5.');
        const failed = [items[0], { text: '!craftRecipe("x", 1)', status: 'failed', result: 'I cannot craft x.' }, { text: '!stats', status: 'skipped', result: '' }];
        assert.deepEqual(runAnswer({ items: failed, stopped: { by: null, at: 2 } }).split('\n'), ['Ran 2 of 3.', '1. !takeFromChest("bread", 10): Successfully took 5 bread from the chest.', '2. !craftRecipe("x", 1): I cannot craft x.', 'Stopped at 2 of 3.']);
        assert.equal(runAnswer({ items: failed, stopped: { by: 'MartyByrde2', at: 2 } }).split('\n').at(-1), 'Stopped by MartyByrde2 at 2 of 3.');
    });
});

// A fake agent: handleMessage runs a scripted command: { text, ms, pack } per command name; the result is routed
// to the player as the real agent does, after the echo of the command.
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
        async handleMessage(source, message) {
            this.handled.push([source, message]);
            const name = message.match(/^!(\w+)/)?.[1];
            const step = script[name] ?? { text: `ran ${name}`, ms: 5 };
            this.routeResponse(source, `*${source} used ${name}*`);
            const entry = { name: `!${name}`, text: message, typed: true, by: source };
            this.running_commands.push(entry);
            this.actions = { currentActionLabel: `action:${name}`, executing: true, last_action_time: Date.now() };
            await sleep(step.ms ?? 5);
            if (step.pack)
                entry.pack = step.pack;
            this.running_commands.splice(this.running_commands.indexOf(entry), 1);
            this.actions = { currentActionLabel: '', executing: false, last_action_time: this.actions.last_action_time };
            if (step.text !== undefined && step.text !== null)
                this.routeResponse(source, step.text);
            return true;
        },
    };
    return agent;
}

describe('the queue', () => {
    test('the commands one after the other as the owner; the lines come back together', async () => {
        const agent = fakeAgent({
            takeFromChest: { text: 'Successfully took 5 bread from the chest.', ms: 10 },
            craftRecipe: { text: 'Successfully crafted stone_pickaxe, you now have 2 stone_pickaxe.', ms: 10 },
            stats: { text: 'STATS', ms: 5 },
        });
        const queue = createQueue(agent, { longSkillMs: 200 });
        const answer = await queue.run(['!takeFromChest("bread", 10)', '!craftRecipe("stone_pickaxe", 1)', '!stats'], { by: 'MartyByrde2' });
        assert.deepEqual(answer.split('\n'), [
            'Ran 3 of 3.',
            '1. !takeFromChest("bread", 10): Successfully took 5 bread from the chest.',
            '2. !craftRecipe("stone_pickaxe", 1): Successfully crafted stone_pickaxe, you now have 2 stone_pickaxe.',
            '3. !stats: STATS',
        ]);
        assert.deepEqual(agent.handled.map(([by]) => by), ['MartyByrde2', 'MartyByrde2', 'MartyByrde2']);
        assert.equal(queue.isActive(), false);
        queue.close();
        assert.ok(!Object.prototype.hasOwnProperty.call(agent, 'handleMessage') || agent.handleMessage.toString().includes('handled'));
    });

    test('a long skill counts as started after 2 s without a failure; the next command waits for its end', async () => {
        const agent = fakeAgent({ mineOre: { text: 'I mined 6 of 6 iron.', ms: 150, pack: { ok: true, reason: null, text: 'I mined 6 of 6 iron.' } }, stats: { text: 'STATS', ms: 5 } });
        const queue = createQueue(agent, { longSkillMs: 40, answerMs: 2000 });
        const started = Date.now();
        const answer = await queue.run(['!mineOre("iron", 6)', '!stats'], { by: 'MartyByrde2' });
        assert.deepEqual(answer.split('\n'), ['Ran 2 of 2.', '1. !mineOre("iron", 6): I mined 6 of 6 iron.', '2. !stats: STATS']);
        assert.ok(Date.now() - started >= 150, 'stats ran after the mining ended');
        assert.equal(agent.handled.length, 2);
        const only = createQueue(fakeAgent({ mineOre: { text: null, ms: 300 } }), { longSkillMs: 40, answerMs: 2000 });
        const t = Date.now();
        const soon = await only.run(['!mineOre("iron", 6)'], { by: 'MartyByrde2' });
        assert.deepEqual(soon.split('\n'), ['Ran 1 of 1.', '1. !mineOre("iron", 6): started.']);
        assert.ok(Date.now() - t < 250, 'the answer came before the mining ended');
        await sleep(320);
        assert.equal(only.isActive(), false);
        only.close();
        queue.close();
    });

    test('the stop rule: a failure stops the queue; not with stop_on_failure false', async () => {
        const script = { takeFromChest: { text: 'I cannot reach the chest.', ms: 5, pack: { ok: false, reason: 'no_path', text: 'I cannot reach the chest.' } }, stats: { text: 'STATS', ms: 5 } };
        const agent = fakeAgent(script);
        const queue = createQueue(agent, { longSkillMs: 200 });
        const stopped = await queue.run(['!stats', '!takeFromChest("bread", 10)', '!stats'], { by: 'MartyByrde2' });
        assert.deepEqual(stopped.split('\n'), ['Ran 2 of 3.', '1. !stats: STATS', '2. !takeFromChest("bread", 10): I cannot reach the chest.', 'Stopped at 2 of 3.']);
        assert.equal(agent.handled.length, 2);
        const goesOn = await queue.run(['!takeFromChest("bread", 10)', '!stats'], { by: 'MartyByrde2', stopOnFailure: false });
        assert.equal(goesOn.split('\n')[0], 'Ran 2 of 2.');
        const byText = createQueue(fakeAgent({ goToPlayer: { text: 'Path not found to the player.', ms: 5 }, stats: { text: 'STATS', ms: 5 } }), { longSkillMs: 200 });
        const text = await byText.run(['!goToPlayer("a", 2)', '!stats'], { by: 'MartyByrde2' });
        assert.deepEqual(text.split('\n'), ['Ran 1 of 2.', '1. !goToPlayer("a", 2): Path not found to the player.', 'Stopped at 1 of 2.']);
        byText.close();
        queue.close();
    });

    test('a command of the owner while the queue runs is queued behind it and told so; a plain line passes', async () => {
        const agent = fakeAgent({ mineOre: { text: 'I mined 6 of 6 iron.', ms: 80 }, stats: { text: 'STATS', ms: 5 } });
        const queue = createQueue(agent, { longSkillMs: 20 });
        const pending = queue.run(['!mineOre("iron", 6)'], { by: 'MartyByrde2' });
        await sleep(10);
        assert.equal(await agent.handleMessage('MartyByrde2', '!stats'), true);
        assert.equal(agent.handled.length, 1, 'not run yet');
        assert.deepEqual(agent.routed.at(-1), ['MartyByrde2', 'Queued: I run it after 1 command.']);
        assert.deepEqual(queue.pending().map((p) => p.text), ['!mineOre("iron", 6)', '!stats']);
        await agent.handleMessage('MartyByrde2', 'how are you');
        assert.equal(agent.handled.length, 2, 'a plain line reaches the bot');
        await pending;
        await sleep(120);
        assert.deepEqual(agent.handled.map(([, text]) => text), ['!mineOre("iron", 6)', 'how are you', '!stats']);
        assert.equal(queue.isActive(), false);
        queue.close();
    });

    test('!stop of the owner empties the queue and runs', async () => {
        const agent = fakeAgent({ mineOre: { text: 'stopped', ms: 60, pack: { ok: false, reason: 'interrupted', text: 'I mined 2 of 6 iron and stopped.' } }, stats: { text: 'STATS', ms: 5 }, stop: { text: 'Stopped.', ms: 1 } });
        const queue = createQueue(agent, { longSkillMs: 20 });
        const pending = queue.run(['!mineOre("iron", 6)', '!stats', '!stats'], { by: 'MartyByrde2' });
        await sleep(10);
        await agent.handleMessage('MartyByrde2', '!stop');
        assert.deepEqual(agent.handled.map(([, text]) => text), ['!mineOre("iron", 6)', '!stop']);
        const answer = await pending;
        assert.deepEqual(answer.split('\n'), ['Ran 0 of 3.', 'Stopped by MartyByrde2 at 1 of 3.']);
        await sleep(80);
        assert.equal(agent.handled.length, 2, 'the rest never ran');
        queue.close();
    });

    test('the answer at the latest after the answer time: what is done and Still running', async () => {
        const agent = fakeAgent({ goToPlayer: { text: 'Arrived.', ms: 400 }, stats: { text: 'STATS', ms: 5 } });
        const queue = createQueue(agent, { longSkillMs: 1000, answerMs: 60 });
        const answer = await queue.run(['!stats', '!goToPlayer("a", 2)', '!stats'], { by: 'MartyByrde2' });
        assert.deepEqual(answer.split('\n'), ['Ran 1 of 3.', '1. !stats: STATS', 'Still running: 2 of 3.']);
        await sleep(450);
        assert.equal(agent.handled.length, 3, 'the rest ran on');
        queue.close();
    });

    test('the run tool: the owner of only_chat_with, the refusal of words', async () => {
        const agent = fakeAgent({ stats: { text: 'STATS', ms: 5 } });
        const watch = { now: () => Date.now(), chat: new Ring(100), events: new Ring(200), settings: { only_chat_with: ['MartyByrde2'] }, longSkillMs: 100 };
        const answer = await runTool(agent, watch, 'run', { commands: ['!stats'] });
        assert.deepEqual(answer, { text: 'Ran 1 of 1.\n1. !stats: STATS', isError: false });
        assert.deepEqual(agent.handled, [['MartyByrde2', '!stats']]);
        const refused = await runTool(agent, watch, 'run', { commands: ['come here'] });
        assert.deepEqual(refused, { text: 'run takes commands only; use say for words.', isError: true });
        assert.equal(typeof TOOL_HANDLERS.run, 'function');
        watch.queue.close();
    });
});
