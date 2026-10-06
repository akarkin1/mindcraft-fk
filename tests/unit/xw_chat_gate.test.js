// v0.1.4.13 fix1: what of the bot's lines reaches the game chat (the play of 2026-10-05: 811 lines of the bot in
// under two hours, code in the chat, three kicks while generated code called bot.chat, `!stop` through run that
// never ran, the loop guard that killed the process under a run of quick failures). No timer stays open.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { chatText, inCode, installCodeChat, isQuiet, runAsCode, runQuiet } from '../../src/agent/chat_gate.js';
import { createQueue } from '../../src/agent/watch/queue.js';
import { ActionManager } from '../../src/agent/action_manager.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('chatText: no code in the chat', () => {
    test('the code of a code action is left out, its output stays', () => {
        const summary = 'Agent wrote this code: \n```let x = 1;\nbot.chat("hi");\n```\nCode Output:\nAction output: Placed white_bed at (16, 14, 26).';
        assert.equal(chatText(summary), 'Action output: Placed white_bed at (16, 14, 26).');
        assert.equal(chatText('Agent wrote this code: \n```// nothing```\nCode Output:\n'), '');
    });

    test('any other code block is left out; a block without its end too', () => {
        assert.equal(chatText('Here: ```const a = 2;``` done.'), 'Here:  done.');
        assert.equal(chatText('Start ```const a = 2;\nmore'), 'Start');
    });

    test('a plain line stays as it is; a number becomes text; nothing else is said', () => {
        assert.equal(chatText('I mined 6 of 6 iron.'), 'I mined 6 of 6 iron.');
        assert.equal(chatText(42), '42');
        assert.equal(chatText(null), '');
        assert.equal(chatText({}), '');
    });
});

describe('quiet and code: the context reaches what the call awaits', () => {
    test('runQuiet: quiet inside, after an await and in a timer it started; not outside', async () => {
        assert.equal(isQuiet(), false);
        const seen = await runQuiet(async () => {
            const first = isQuiet();
            await sleep(1);
            const later = isQuiet();
            const inTimer = await new Promise((resolve) => setTimeout(() => resolve(isQuiet()), 1));
            return [first, later, inTimer];
        });
        assert.deepEqual(seen, [true, true, true]);
        assert.equal(isQuiet(), false);
    });

    test('runAsCode: code inside only', async () => {
        assert.equal(inCode(), false);
        assert.equal(await runAsCode(async () => { await sleep(1); return inCode(); }), true);
        assert.equal(inCode(), false);
    });
});

describe('installCodeChat: the chat of generated code goes to its output', () => {
    const fakeBot = () => {
        const sent = [];
        return { sent, chat(message) { sent.push(['chat', message]); }, whisper(user, message) { sent.push(['whisper', user, message]); } };
    };

    test('inside code: bot.chat and bot.whisper go to the output, nothing to the server', async () => {
        const bot = fakeBot();
        const output = [];
        installCodeChat(bot, (text) => output.push(text));
        await runAsCode(async () => {
            bot.chat('Position: x=1, y=2, z=3');
            await sleep(1);
            bot.chat('Found 12 air blocks.');
            bot.whisper('MartyByrde2', 'hi');
        });
        assert.deepEqual(bot.sent, []);
        assert.deepEqual(output, ['Position: x=1, y=2, z=3', 'Found 12 air blocks.', 'to MartyByrde2: hi']);
    });

    test('a server command still goes out; outside code everything goes out as before; installed once', async () => {
        const bot = fakeBot();
        const output = [];
        installCodeChat(bot, (text) => output.push(text));
        installCodeChat(bot, (text) => output.push(`twice ${text}`));
        await runAsCode(async () => bot.chat('/time query daytime'));
        bot.chat('I am here.');
        bot.whisper('MartyByrde2', 'I am here.');
        assert.deepEqual(bot.sent, [['chat', '/time query daytime'], ['chat', 'I am here.'], ['whisper', 'MartyByrde2', 'I am here.']]);
        assert.deepEqual(output, []);
    });

    test('an output that throws drops the line and throws nothing', async () => {
        const bot = fakeBot();
        installCodeChat(bot, () => { throw new Error('no output'); });
        await runAsCode(async () => bot.chat('x'));
        assert.deepEqual(bot.sent, []);
    });
});

// A fake agent: handleMessage runs a scripted command and records whether it ran quiet; `!stop` ends the running
// command at once, as the real !stop interrupts the action.
function fakeAgent(script) {
    let abort = null;
    const agent = {
        name: 'claude',
        bot: { username: 'claude' },
        running_commands: [],
        handled: [],
        routed: [],
        async routeResponse(to, message) {
            this.routed.push([to, message, isQuiet()]);
        },
        async handleMessage(source, message) {
            this.handled.push([source, message, isQuiet()]);
            const name = message.match(/^!(\w+)/)?.[1];
            this.routeResponse(source, `*${source} used ${name}*`);
            if (name === 'stop') {
                abort?.();
                this.routeResponse(source, 'Stopped.');
                return true;
            }
            const step = script[name] ?? { text: `ran ${name}`, ms: 5 };
            const entry = { name: `!${name}`, text: message, typed: true, by: source };
            this.running_commands.push(entry);
            const stopped = await new Promise((resolve) => {
                const timer = setTimeout(() => resolve(false), step.ms ?? 5);
                abort = () => { clearTimeout(timer); resolve(true); };
            });
            abort = null;
            entry.pack = stopped ? { ok: false, reason: 'interrupted', text: step.stopText ?? 'stopped' } : step.pack;
            this.running_commands.splice(this.running_commands.indexOf(entry), 1);
            this.routeResponse(source, stopped ? (step.stopText ?? 'stopped') : step.text);
            return true;
        },
    };
    return agent;
}

describe('the queue of run: quiet, and !stop at once', () => {
    test('the commands of run run quiet: their echo and result are routed quiet', async () => {
        const agent = fakeAgent({ stats: { text: 'STATS', ms: 5 } });
        const queue = createQueue(agent, { longSkillMs: 200 });
        const answer = await queue.run(['!stats'], { by: 'MartyByrde2' });
        assert.deepEqual(answer.split('\n'), ['Ran 1 of 1.', '1. !stats: STATS']);
        assert.deepEqual(agent.handled.map(([, , quiet]) => quiet), [true]);
        assert.ok(agent.routed.length >= 2 && agent.routed.every(([, , quiet]) => quiet), JSON.stringify(agent.routed));
        queue.close();
    });

    test('a command the owner types while the queue runs is not quiet', async () => {
        const agent = fakeAgent({ goToPlayer: { text: 'Arrived.', ms: 40 }, stats: { text: 'STATS', ms: 5 } });
        const queue = createQueue(agent, { longSkillMs: 1000 });
        const pending = queue.run(['!goToPlayer("MartyByrde2", 2)'], { by: 'MartyByrde2' });
        await sleep(5);
        await agent.handleMessage('MartyByrde2', '!stats'); // the wrapper queues it behind
        await pending;
        await sleep(30);
        const typed = agent.handled.find(([, text]) => text === '!stats');
        assert.ok(typed, 'the typed command ran');
        assert.equal(typed[2], false);
        queue.close();
    });

    test('!stop through run while a long skill runs: it stops at once, never behind the skill', async () => {
        const agent = fakeAgent({ mineOre: { text: 'I mined 6 of 6 diamond.', ms: 5000, stopText: 'I mined 0 of 6 diamond. I was stopped.' } });
        const queue = createQueue(agent, { longSkillMs: 20, answerMs: 3000 });
        const started = await queue.run(['!mineOre("diamond", 6)'], { by: 'MartyByrde2' });
        assert.deepEqual(started.split('\n'), ['Ran 1 of 1.', '1. !mineOre("diamond", 6): started.']);
        const t = Date.now();
        const answer = await queue.run(['!stop'], { by: 'MartyByrde2' });
        assert.ok(Date.now() - t < 1000, `the stop answered after ${Date.now() - t} ms`);
        assert.deepEqual(answer.split('\n'), ['Ran 1 of 1.', '1. !stop: stopped']);
        assert.deepEqual(agent.handled.map(([, text, quiet]) => [text, quiet]), [['!mineOre("diamond", 6)', true], ['!stop', true]]);
        await sleep(20);
        assert.equal(queue.isActive(), false);
        queue.close();
    });

    test('!stop first, then more commands: the rest runs after the stop', async () => {
        const agent = fakeAgent({ mineOre: { text: 'done', ms: 5000, stopText: 'stopped' }, stats: { text: 'STATS', ms: 5 } });
        const queue = createQueue(agent, { longSkillMs: 20, answerMs: 3000 });
        await queue.run(['!mineOre("iron", 6)'], { by: 'MartyByrde2' });
        const answer = await queue.run(['!stop', '!stats'], { by: 'MartyByrde2' });
        assert.deepEqual(answer.split('\n'), ['1. !stop: stopped', 'Ran 1 of 1.', '1. !stats: STATS']);
        queue.close();
    });

    test('!stop through run with nothing running runs as a command', async () => {
        const agent = fakeAgent({});
        const queue = createQueue(agent, { longSkillMs: 200 });
        const answer = await queue.run(['!stop'], { by: 'MartyByrde2' });
        assert.deepEqual(answer.split('\n'), ['Ran 1 of 1.', '1. !stop: Stopped.']);
        queue.close();
    });
});

describe('the loop guard and the quiet run', () => {
    const fakeManagerAgent = () => {
        const agent = {
            killed: null,
            bot: { emit() {}, interrupt_code: false, pathfinder: { stop() {} }, pvp: { stop() {} }, collectBlock: { cancelTask() {} }, clearControlStates() {}, stopDigging() {} },
            cleanKill(message) { this.killed = message; },
            isIdle: () => true,
            self_prompter: { isActive: () => false },
            clearBotLogs() {},
            history: { add() {} },
            coder: { generating: false },
        };
        return agent;
    };

    test('10 quick actions of a quiet run do not kill the process; 10 of the model do', async () => {
        const quietAgent = fakeManagerAgent();
        const quiet = new ActionManager(quietAgent);
        await runQuiet(async () => {
            for (let i = 0; i < 10; i++)
                await quiet.runAction('action:craftRecipe', async () => {});
        });
        assert.equal(quietAgent.killed, null);

        const loudAgent = fakeManagerAgent();
        const loud = new ActionManager(loudAgent);
        for (let i = 0; i < 10; i++)
            await loud.runAction('action:craftRecipe', async () => {});
        assert.equal(loudAgent.killed, 'Infinite action loop detected, shutting down.');
    });
});
