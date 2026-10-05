// Spec v0.1.4.13 4.5 (part N2) and HANDOFF round 1, the glue of the supervisor in the chat
// (src/agent/watch/supervisor.js) with a fake agent and a staged clock: the message event of a line that names the
// supervisor (it wakes `wait event`; `The supervisor is not here.` from the first agent when nobody is connected),
// the relay of `reply` into the chat as `[Opus] ...` (a whisper to only_chat_with, else the open chat; to the page as
// a bot-output of the supervisor), the hold rule (the owner's line without an answer, 3 s after a bot line, an update
// dropped after 20 s), `Updates are off.`, `note` on the agent, the registration through registerTool, the row
// `supervisor` of shouldAnswer, the client's reply and note. Every timer is closed at the end.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Ring } from '../../src/agent/watch/events_logic.js';
import { createWaits, registerTool, runTool, toolList, unregisterTool } from '../../src/agent/watch/tools.js';
import {
    SUPERVISOR_TOOLS, createSupervisor, ensureSupervisor, registerSupervisorTools, supervisorMessage, supervisorPresent,
} from '../../src/agent/watch/supervisor.js';
import { SUPERVISOR_OUTPUT, parseSupervisorOutput } from '../../src/mindcraft/public/chat_logic.js';
import { shouldAnswer } from '../../src/agent/bots_logic.js';
import { USAGE, noteArgs, parseCliArgs, replyArgs } from '../../scripts/watch_logic.js';
import { readRepoFile } from '../helpers/source_ast.js';

const T0 = new Date(2026, 9, 4, 6, 45, 12).getTime();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fixture(settings = {}) {
    const clock = { t: T0 };
    const said = []; // what the bot said in the game: { to, text } (to null: the open chat)
    const opened = []; // the lines of openChat
    const pages = []; // the bot-outputs for the page: [agentName, message]
    const agent = {
        name: 'Luna',
        bot: {
            username: 'Luna', entity: { position: { x: 1.5, y: 2, z: 3.5 } }, health: 20, food: 15, game: { dimension: 'overworld' },
            blockAt: () => ({ name: 'stone' }), heldItem: null, inventory: { items: () => [], slots: [] }, entities: {},
            whisper: (to, text) => said.push({ to, text }),
            chat: (text) => said.push({ to: null, text }),
        },
        actions: { currentActionLabel: '', last_action_time: 0, executing: false },
        running_commands: [],
        openChat(text) {
            opened.push(text);
            watch.chat.push({ t: clock.t, name: 'Luna', text });
        },
    };
    const watch = {
        now: () => clock.t, chat: new Ring(100), events: new Ring(200), lastLine: null, presence: { seenAt: null },
        settings: { supervisor_name: 'Opus', supervisor_updates: true, only_chat_with: ['MartyByrde2'], chat_ingame: true, ...settings },
    };
    const push = (event) => {
        watch.events.push(event);
        watch.waits?.onEvent?.();
    };
    agent.watch = { watch, push };
    const sup = createSupervisor(agent, watch, { output: (name, message) => pages.push([name, message]), tickMs: 3600000 });
    watch.supervisor = sup;
    return { agent, watch, sup, clock, said, opened, pages };
}

const at = (clock, seconds) => { clock.t = T0 + seconds * 1000; };

describe('the message event', () => {
    test('a supervisor that waits: `wait event` wakes with the message; no bot says a word', async () => {
        const f = fixture();
        f.watch.waits = createWaits(f.agent, f.watch, { tickMs: 10 });
        const pending = runTool(f.agent, f.watch, 'wait', { for: 'event', timeout: 5 });
        await sleep(20);
        const result = supervisorMessage(f.agent, 'MartyByrde2', 'Opus, where is it?', { agents: ['Luna'] });
        const answer = await pending;
        assert.equal(result.ok, true);
        assert.equal(result.said, false);
        assert.deepEqual(result.event.data, { from: 'MartyByrde2', text: 'where is it?' });
        const lines = answer.text.split('\n');
        assert.equal(lines[0], 'Woke: event.');
        assert.ok(lines.some((l) => l.endsWith('message: Message: "where is it?"')), answer.text);
        assert.deepEqual(f.opened, []);
        assert.deepEqual(f.said, []);
        f.watch.waits.close();
        f.sup.close();
    });

    test('a supervisor seen within 60 s: the event, no line', () => {
        const f = fixture();
        f.watch.presence.seenAt = T0 - 59000;
        const result = supervisorMessage(f.agent, 'MartyByrde2', 'Opus, why is it going to the surface?', { agents: ['Luna', 'gpt'] });
        assert.equal(result.reason, null);
        assert.equal(f.watch.events.items.at(-1).text, 'Message: "why is it going to the surface?"');
        assert.deepEqual(f.opened, []);
        f.sup.close();
    });

    test('nobody connected for 60 s: the first agent says `The supervisor is not here.` once; the event is kept', () => {
        const f = fixture();
        f.watch.presence.seenAt = T0 - 61000;
        const result = supervisorMessage(f.agent, 'MartyByrde2', 'Opus, hello', { agents: ['Luna', 'gpt'] });
        assert.equal(result.said, true);
        assert.equal(result.text, 'The supervisor is not here.');
        assert.deepEqual(f.opened, ['The supervisor is not here.']);
        assert.equal(f.watch.events.items.at(-1).kind, 'message');
        assert.equal(f.watch.events.items.at(-1).text, 'Message: "hello"');
        f.sup.close();
    });

    test('the second agent of the mindserver stays quiet: two bots do not both answer', () => {
        const f = fixture();
        const result = supervisorMessage(f.agent, 'MartyByrde2', 'Opus, hello', { agents: ['claude', 'Luna'] });
        assert.equal(result.reason, 'another_speaks');
        assert.equal(result.said, false);
        assert.deepEqual(f.opened, []);
        assert.equal(f.watch.events.items.at(-1).kind, 'message');
        f.sup.close();
    });

    test('without a watch server: nobody can be connected; the bot says so', () => {
        const opened = [];
        const agent = { name: 'Luna', watch: null, openChat: (t) => opened.push(t) };
        const result = supervisorMessage(agent, 'MartyByrde2', 'Opus, hello', { agents: [], settings: { supervisor_name: 'Opus' } });
        assert.equal(result.said, true);
        assert.deepEqual(opened, ['The supervisor is not here.']);
    });

    test('two bots in their own processes: the one without a watch server is quiet while the other is in the game', () => {
        const opened = [];
        const gpt = { name: 'gpt', watch: { ok: false }, bot: { players: { gpt: {}, Luna: {}, MartyByrde2: {} } }, openChat: (t) => opened.push(t) };
        const settings = { supervisor_name: 'Opus', other_bots: ['luna'] };
        const quiet = supervisorMessage(gpt, 'MartyByrde2', 'Opus, where is it?', { agents: ['gpt'], settings });
        assert.equal(quiet.reason, 'another_speaks');
        assert.deepEqual(opened, []);
        delete gpt.bot.players.Luna; // the other bot left: this one answers
        assert.equal(supervisorMessage(gpt, 'MartyByrde2', 'Opus, hello', { agents: ['gpt'], settings }).said, true);
        // the bot with the watch server and nobody connected speaks, the other bot being in the game or not
        const f = fixture({ other_bots: ['gpt'] });
        f.agent.bot.players = { gpt: {}, Luna: {} };
        assert.equal(supervisorMessage(f.agent, 'MartyByrde2', 'Opus, hello', { agents: ['Luna'] }).said, true);
        f.sup.close();
    });

    test('no supervisor_name: nothing, no event', () => {
        const f = fixture({ supervisor_name: '' });
        const result = supervisorMessage(f.agent, 'MartyByrde2', 'Opus, hello', { agents: [] });
        assert.equal(result.reason, 'no_name');
        assert.equal(f.watch.events.length, 0);
        assert.deepEqual(f.opened, []);
        f.sup.close();
    });

    test('presence: a wait or digest within 60 s, or a wait open', () => {
        const f = fixture();
        assert.equal(supervisorPresent(f.watch, T0), false);
        f.watch.presence.seenAt = T0 - 12000;
        assert.equal(supervisorPresent(f.watch, T0), true);
        f.watch.presence.seenAt = T0 - 70000;
        f.watch.waits = { size: 1 };
        assert.equal(supervisorPresent(f.watch, T0), true);
        f.sup.close();
    });
});

describe('reply: the relay into the chat', () => {
    test('a whisper to only_chat_with as `[Opus] <text>`, into the chat of the watch, to the page in supervisor_voice', async () => {
        const f = fixture({ supervisor_voice: 'supertonic:M2' });
        const answer = await f.sup.reply({ text: 'It is in the tunnel.' });
        assert.equal(answer, 'Relayed: "[Opus] It is in the tunnel.".');
        assert.deepEqual(f.said, [{ to: 'MartyByrde2', text: '[Opus] It is in the tunnel.' }]);
        assert.deepEqual(f.watch.chat.items.at(-1), { t: T0, name: 'Luna', text: '[Opus] It is in the tunnel.' });
        assert.deepEqual(f.opened, [], 'not through openChat: no help event, no line of the bot');
        assert.equal(f.pages.length, 1);
        assert.equal(f.pages[0][0], SUPERVISOR_OUTPUT);
        assert.deepEqual(parseSupervisorOutput(...f.pages[0]), { name: 'Opus', kind: 'answer', text: 'It is in the tunnel.', by: 'Luna', voice: 'supertonic:M2' });
        f.sup.close();
    });

    test('without only_chat_with: the open chat; chat_ingame off: not in the game, only to the page', async () => {
        const f = fixture({ only_chat_with: [] });
        await f.sup.reply({ text: 'Fine.' });
        assert.deepEqual(f.said, [{ to: null, text: '[Opus] Fine.' }]);
        const g = fixture({ only_chat_with: [], chat_ingame: false });
        await g.sup.reply({ text: 'Fine.' });
        assert.deepEqual(g.said, []);
        assert.equal(g.pages.length, 1);
        f.sup.close();
        g.sup.close();
    });

    test('a relayed line is no bot line: the next reply goes at once', async () => {
        const f = fixture();
        await f.sup.reply({ text: 'One.' });
        at(f.clock, 0.5);
        assert.equal(await f.sup.reply({ text: 'Two.' }), 'Relayed: "[Opus] Two.".');
        f.sup.close();
    });

    test('an update with supervisor_updates off: `Updates are off.`, nothing said, nothing on the page', async () => {
        const f = fixture({ supervisor_updates: false });
        assert.equal(await f.sup.reply({ text: 'The mining is at 2 of 6.', kind: 'update' }), 'Updates are off.');
        assert.deepEqual(f.said, []);
        assert.deepEqual(f.pages, []);
        assert.equal(await f.sup.reply({ text: 'It is in the tunnel.' }), 'Relayed: "[Opus] It is in the tunnel.".', 'an answer still goes');
        f.sup.close();
    });

    test('no supervisor_name, a bad text, a failing chat', async () => {
        const f = fixture({ supervisor_name: '' });
        assert.equal(await f.sup.reply({ text: 'x' }), 'No supervisor_name is set.');
        const g = fixture();
        assert.equal(await g.sup.reply({ text: '' }), 'reply takes a text of 1 to 256 characters.');
        g.agent.bot.whisper = () => { throw new Error('the bot left'); };
        assert.equal(await g.sup.reply({ text: 'x' }), 'The line was not said: the bot left.');
        f.sup.close();
        g.sup.close();
    });
});

describe('nobody speaks over anybody (staged clock)', () => {
    test('W111: an update 300 ms after the owner\'s order comes after the bot\'s answer, 3 s after it', async () => {
        const f = fixture();
        f.watch.lastLine = { text: 'where are you?', by: 'MartyByrde2', at: T0 };
        at(f.clock, 0.3);
        let answer = null;
        f.sup.reply({ text: 'The mining is at 2 of 6.', kind: 'update' }).then((a) => { answer = a; });
        assert.equal(f.sup.pending().length, 1);
        at(f.clock, 1.4);
        f.sup.tick();
        at(f.clock, 1.5);
        f.agent.openChat('I am here.'); // the bot's answer
        f.agent.bot.whisper('MartyByrde2', 'I am here.');
        for (const s of [1.6, 3.0, 4.4]) {
            at(f.clock, s);
            f.sup.tick();
        }
        await sleep(0);
        assert.equal(answer, null, 'held for 3 s after the answer');
        at(f.clock, 4.5);
        f.sup.tick();
        await sleep(0);
        assert.equal(answer, 'Relayed after 4 s: "[Opus] The mining is at 2 of 6.".');
        assert.deepEqual(f.said.map((s) => s.text), ['I am here.', '[Opus] The mining is at 2 of 6.']);
        f.sup.close();
    });

    test('the owner\'s line that no bot answers holds the line 10 s, then it goes', async () => {
        const f = fixture();
        f.watch.lastLine = { text: '!stop', by: 'MartyByrde2', at: T0 };
        let answer = null;
        f.sup.reply({ text: 'Stopped.' }).then((a) => { answer = a; });
        at(f.clock, 9.9);
        f.sup.tick();
        await sleep(0);
        assert.equal(answer, null);
        at(f.clock, 10);
        f.sup.tick();
        await sleep(0);
        assert.equal(answer, 'Relayed after 10 s: "[Opus] Stopped.".');
        f.sup.close();
    });

    test('an update held over 20 s is dropped: `Dropped: the bot was speaking.`, nothing said; an answer goes', async () => {
        const f = fixture();
        let update = null;
        let reply = null;
        f.agent.openChat('I mined 1 of 6 iron.');
        f.sup.reply({ text: 'The mining is at 2 of 6.', kind: 'update' }).then((a) => { update = a; });
        f.sup.reply({ text: 'It is in the tunnel.' }).then((a) => { reply = a; });
        for (let s = 2; s <= 20; s += 2) { // the bot speaks every 2 s
            at(f.clock, s);
            f.agent.openChat(`I mined ${s} of 60 iron.`);
            f.sup.tick();
        }
        await sleep(0);
        assert.equal(update, null);
        at(f.clock, 20.1);
        f.sup.tick();
        await sleep(0);
        assert.equal(update, 'Dropped: the bot was speaking.');
        assert.equal(reply, 'Relayed after 20 s: "[Opus] It is in the tunnel.".');
        assert.deepEqual(f.said.map((s) => s.text), ['[Opus] It is in the tunnel.']);
        assert.equal(f.sup.pending().length, 0);
        f.sup.close();
    });

    test('a line of another bot of other_bots counts as a bot line', async () => {
        const f = fixture({ other_bots: ['gpt'] });
        f.watch.chat.push({ t: T0, name: 'gpt', text: 'On my way.' });
        let answer = null;
        f.sup.reply({ text: 'Good.' }).then((a) => { answer = a; });
        at(f.clock, 2.9);
        f.sup.tick();
        await sleep(0);
        assert.equal(answer, null);
        at(f.clock, 3.0);
        f.sup.tick();
        await sleep(0);
        assert.equal(answer, 'Relayed after 3 s: "[Opus] Good.".');
        f.sup.close();
    });

    test('the answers before the updates when both are held', async () => {
        const f = fixture();
        f.agent.openChat('I am here.');
        const order = [];
        f.sup.reply({ text: 'An update.', kind: 'update' }).then(() => order.push('update'));
        at(f.clock, 1);
        f.sup.reply({ text: 'An answer.' }).then(() => order.push('answer'));
        at(f.clock, 3);
        f.sup.tick();
        await sleep(0);
        assert.deepEqual(f.said.map((s) => s.text), ['[Opus] An answer.', '[Opus] An update.']);
        assert.deepEqual(order, ['answer', 'update']);
        f.sup.close();
    });

    test('close: the held lines answer, the timer goes', async () => {
        const f = fixture();
        f.watch.lastLine = { text: 'hi', by: 'MartyByrde2', at: T0 };
        const pending = f.sup.reply({ text: 'Later.' });
        f.sup.close();
        assert.equal(await pending, 'The line was not said: the watch server closed.');
        assert.deepEqual(f.said, []);
    });
});

describe('note', () => {
    test('one line on the agent for N minutes; the newer replaces the older; "" clears', () => {
        const f = fixture();
        assert.equal(f.sup.note({ text: 'the chest at (15, -59, -99) has bread' }), 'Noted for 30 min: "the chest at (15, -59, -99) has bread".');
        assert.deepEqual(f.agent.supervisor_note, { text: 'the chest at (15, -59, -99) has bread', minutes: 30, at: T0, until: T0 + 30 * 60000 });
        assert.equal(f.sup.note({ text: 'the lava is east', minutes: 5 }), 'Noted for 5 min: "the lava is east".');
        assert.equal(f.agent.supervisor_note.text, 'the lava is east');
        assert.equal(f.sup.note({ text: '' }), 'The note is cleared.');
        assert.equal(f.agent.supervisor_note, null);
        assert.equal(f.sup.note({ text: 'x', minutes: 0 }), 'note takes minutes of 1 to 120, not "0".');
        f.sup.close();
        const g = fixture({ supervisor_name: '' });
        assert.equal(g.sup.note({ text: 'x' }), 'No supervisor_name is set.');
        assert.equal(g.agent.supervisor_note, undefined);
        g.sup.close();
    });
});

describe('the tools through registerTool', () => {
    test('registered only with supervisor_name set', () => {
        const names = [];
        assert.equal(registerSupervisorTools((name) => names.push(name), {}), 0);
        assert.equal(registerSupervisorTools((name) => names.push(name), { supervisor_name: '  ' }), 0);
        assert.deepEqual(names, []);
        assert.equal(registerSupervisorTools((name) => { names.push(name); return true; }, { supervisor_name: 'Opus' }), 2);
        assert.deepEqual(names, ['reply', 'note']);
    });

    test('the schemas: reply text 1 to 256 and kind answer or update; note text up to 200 and minutes 1 to 120', () => {
        const [reply, note] = SUPERVISOR_TOOLS;
        assert.deepEqual(reply.schema.inputSchema.properties.kind.enum, ['answer', 'update']);
        assert.equal(reply.schema.inputSchema.properties.text.maxLength, 256);
        assert.deepEqual(reply.schema.inputSchema.required, ['text']);
        assert.equal(note.schema.inputSchema.properties.text.maxLength, 200);
        assert.equal(note.schema.inputSchema.properties.minutes.minimum, 1);
        assert.equal(note.schema.inputSchema.properties.minutes.maximum, 120);
        assert.equal(note.schema.inputSchema.properties.minutes.default, 30);
        for (const tool of SUPERVISOR_TOOLS) assert.equal(tool.schema.inputSchema.additionalProperties, false);
    });

    test('listed after the table, called through runTool, refused by their own rule; gone again', async () => {
        const before = toolList().length;
        assert.equal(registerSupervisorTools(registerTool, { supervisor_name: 'Opus' }), 2);
        try {
            const list = toolList();
            assert.equal(list.length, before + 2);
            assert.deepEqual(list.slice(-2).map((t) => t.name), ['reply', 'note']);
            const f = fixture();
            assert.deepEqual(await runTool(f.agent, f.watch, 'reply', { text: 'It is in the tunnel.' }), { text: 'Relayed: "[Opus] It is in the tunnel.".', isError: false });
            assert.deepEqual(await runTool(f.agent, f.watch, 'reply', { text: '' }), { text: 'reply takes a text of 1 to 256 characters.', isError: true });
            assert.deepEqual(await runTool(f.agent, f.watch, 'reply', { text: 'x', kind: 'shout' }), { text: 'reply takes kind: answer or update, not "shout".', isError: true });
            assert.deepEqual(await runTool(f.agent, f.watch, 'note', { text: 'the chest has bread', minutes: 45 }), { text: 'Noted for 45 min: "the chest has bread".', isError: false });
            assert.deepEqual(await runTool(f.agent, f.watch, 'note', { text: 'x'.repeat(201) }), { text: 'note takes a text of at most 200 characters.', isError: true });
            f.sup.close();
        } finally {
            unregisterTool('reply');
            unregisterTool('note');
        }
        assert.equal(toolList().length, before);
    });

    test('ensureSupervisor keeps one supervisor per watch server', () => {
        const watch = {};
        const one = ensureSupervisor({ name: 'Luna' }, watch, { output: () => {} });
        assert.equal(ensureSupervisor({ name: 'Luna' }, watch), one);
        one.close();
    });
});

describe('shouldAnswer: the row supervisor', () => {
    const base = { self: 'gpt', otherBots: [], onlyChatWith: [], names: ['claude', 'gpt'], supervisor: 'Opus' };

    test('a relayed line, whoever said it, and a line of the supervisor itself are answered by no bot', () => {
        assert.deepEqual(shouldAnswer({ ...base, from: 'claude', text: '[Opus] It is in the tunnel.' }), { answer: false, why: 'supervisor' });
        assert.deepEqual(shouldAnswer({ ...base, from: 'MartyByrde2', text: '[Opus] hi' }), { answer: false, why: 'supervisor' });
        assert.deepEqual(shouldAnswer({ ...base, from: 'Opus', text: 'come here' }), { answer: false, why: 'supervisor' });
        assert.deepEqual(shouldAnswer({ ...base, from: 'opus', text: 'come here' }), { answer: false, why: 'supervisor' });
        assert.deepEqual(shouldAnswer({ ...base, onlyChatWith: ['MartyByrde2'], from: 'claude', text: '[Opus] hi' }), { answer: false, why: 'supervisor' });
    });

    test('a line to the supervisor stays addressed_supervisor; without a name the brackets mean nothing', () => {
        assert.deepEqual(shouldAnswer({ ...base, from: 'MartyByrde2', text: 'Opus, where is it?' }), { answer: false, why: 'addressed_supervisor' });
        assert.deepEqual(shouldAnswer({ ...base, supervisor: '', from: 'MartyByrde2', text: '[Opus] hi' }), { answer: true, why: null });
        assert.deepEqual(shouldAnswer({ ...base, from: 'MartyByrde2', text: 'come here' }), { answer: true, why: null });
    });
});

describe('the drop branch of respondFunc (agent.js)', () => {
    test('addressed_supervisor hands the line to supervisorMessage through a dynamic import, before any model call', () => {
        const source = readRepoFile('src/agent/agent.js').replace(/\r\n/g, '\n');
        assert.doesNotMatch(source, /^import .*watch\/supervisor/m);
        const at = source.indexOf("verdict.why === 'addressed_supervisor'");
        assert.ok(at > 0);
        const branch = source.slice(at, at + 400);
        assert.match(branch, /import\('\.\/watch\/supervisor\.js'\)/);
        assert.match(branch, /supervisorMessage\(this, username, message, \{ agents: convoManager\.getInGameAgents\(\) \}\)/);
        const drop = source.lastIndexOf('if (!verdict.answer) {', at);
        assert.ok(drop > 0 && at - drop < 600, 'inside the drop branch');
        assert.ok(source.indexOf('return;', at) < source.indexOf('this.handleMessage(username', at), 'returns before the line reaches the model');
    });
});

describe('the client: reply and note', () => {
    test('reply [kind] \'<text>\'', () => {
        assert.deepEqual(parseCliArgs(['reply', 'It is in the tunnel.']), { tool: 'reply', args: { text: 'It is in the tunnel.' }, follow: false });
        assert.deepEqual(parseCliArgs(['reply', 'update', 'The mining is at 2 of 6.']).args, { kind: 'update', text: 'The mining is at 2 of 6.' });
        assert.deepEqual(parseCliArgs(['reply', 'answer', 'Yes.']).args, { kind: 'answer', text: 'Yes.' });
        assert.deepEqual(replyArgs(['update']), { text: 'update' });
        assert.deepEqual(parseCliArgs(['reply', '{"text": "hi", "kind": "update"}']).args, { text: 'hi', kind: 'update' });
    });

    test('note \'<text>\' [minutes]; an empty text clears', () => {
        assert.deepEqual(parseCliArgs(['note', 'the chest at (15, -59, -99) has bread']).args, { text: 'the chest at (15, -59, -99) has bread' });
        assert.deepEqual(parseCliArgs(['note', 'the chest has bread', '45']).args, { text: 'the chest has bread', minutes: 45 });
        assert.deepEqual(parseCliArgs(['note', '']).args, { text: '' });
        assert.deepEqual(noteArgs(['30']), { text: '30' });
    });

    test('the help names both', () => {
        assert.match(USAGE, /tools: .*reply, note/);
        assert.match(USAGE, /node scripts\/watch\.js reply \[kind\] '<text>'/);
        assert.match(USAGE, /node scripts\/watch\.js note '<text>' \[minutes\]/);
    });
});
