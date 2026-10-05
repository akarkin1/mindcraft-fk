// WAITS FOR PART N2 (SPEC 4.5, engineer E5, round 2): written from the spec while the part is built; a test may fail
// until it lands. Tests from the spec (v0.1.4.13, section 6, T1), with settings.supervisor_name "Opus":
// - a line of the owner that addressedTo resolves to the supervisor becomes an event of kind message,
//   `Message: "why is it going to the surface?"` with data.from; with no supervisor connected (no wait or digest
//   within 60 s) one bot, the first of the mindserver's agents, says `The supervisor is not here.`; the event is
//   kept in the ring whether or not a supervisor is connected;
// - reply (text 1 to 256; kind answer or update, default answer): relayed into the chat as `[Opus] <text>`; an
//   update only with supervisor_updates on, else `Updates are off.` and nothing is said;
// - nobody speaks over anybody: the line is held while the owner's last line has no bot answer yet (up to 10 s) and
//   for 3 s after a bot line (the handoff for W111); an update held more than 20 s is dropped, reply answered
//   `Dropped: the bot was speaking.`;
// - note (text 1 to 200, minutes 1 to 120, default 30): `Noted for 30 min: "the chest at (15, -59, -99) has bread".`;
//   the prompt holds `Supervisor: <text>` as one line; the newer replaces the older; an empty text clears it;
//   an expired note vanishes.
// Fake clocks only: the watch's clock for the hold rule, the mocked Date of node:test for the note. A failing test is
// a finding.
import { describe, test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createRequire } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { T0, makeClock, makeWatch, makeWatchAgent } from '../helpers/xt_watch.js';

register('../helpers/mcdata_hooks.js', import.meta.url);
const require = createRequire(import.meta.url);
const minecraftData = require('minecraft-data');

const OWNER = 'MartyByrde2';
const NOTE = 'the chest at (15, -59, -99) has bread';

let M;
let workDir;
let originalCwd;
before(async () => {
    originalCwd = process.cwd();
    workDir = makeTmpDir();
    process.chdir(workDir); // the prompter loads the models, which read ./keys.json at load
    const cap = captureConsole();
    try {
        M = {
            tools: await loadSrc('src/agent/watch/tools.js'),
            supervisor: await loadSrc('src/agent/watch/supervisor.js'),
            mcdata: await loadSrc('src/utils/mcdata.js'),
            settings: await loadSrc('src/agent/settings.js'),
            prompter: await loadSrc('src/models/prompter.js'),
            claude: await loadSrc('src/models/claude.js'),
        };
    } finally {
        cap.restore();
        process.chdir(originalCwd);
    }
    M.mcdata.__setMcdataForTests(minecraftData('1.21.8'));
    // the watch server registers reply and note when it loads with supervisor_name set (the handoff: registerTool)
    const names = () => M.tools.toolList().map((t) => t.name);
    if (!names().includes('reply')) {
        if (typeof M.supervisor.registerSupervisorTools === 'function')
            M.supervisor.registerSupervisorTools(M.tools.registerTool, { supervisor_name: 'Opus' });
        else
            for (const tool of M.supervisor.SUPERVISOR_TOOLS ?? []) M.tools.registerTool(tool.name, tool.schema, tool.handler);
    }
});
after(() => {
    M.mcdata.__setMcdataForTests?.(null);
    removeTmpDir(workDir);
});

/** The agent and the watch state of one test; agent.watch as startWatchServer gives it ({ push, watch }). */
function setup({ updates = false, clock = makeClock(), connected = false, name = 'claude' } = {}) {
    const watch = makeWatch({ clock, settings: { supervisor_name: 'Opus', supervisor_updates: updates } });
    watch.presence.seenAt = connected ? clock.now() - 12000 : null;
    const agent = makeWatchAgent({ name });
    agent.watch = { watch, push: (event) => watch.events.push(event) };
    return { agent, watch, clock };
}

/** The lines of the supervisor the bot put into the game chat (bot.chat, openChat of the fake agent). */
const inGameChat = (agent) => agent.said.filter((t) => t.startsWith('[Opus] '));

/** The lines of the supervisor that were relayed: in the game chat or in the chat of the watch. */
function relayed(agent, watch) {
    const lines = [...inGameChat(agent), ...watch.chat.last(100).map((e) => e.text).filter((t) => t.startsWith('[Opus] '))];
    return [...new Set(lines)];
}

/** The owner speaks: the chat of the watch and watch.lastLine ({ text, by, at }) as the watch server keeps them. */
function ownerSays(watch, clock, text) {
    watch.chat.push({ t: clock.now(), name: OWNER, text });
    watch.lastLine = { text, by: OWNER, at: clock.now() };
}

/** A bot line in the chat of the watch. */
function botSays(agent, watch, clock, text) {
    watch.chat.push({ t: clock.now(), name: agent.name, text });
    agent.said.push(text);
}

const realMs = (ms) => new Promise((r) => setTimeout(r, ms));

/** Starts the supervisor of the watch with a fast tick, so held lines are checked within a few ms of real time. */
function fastSupervisor(agent, watch) {
    return M.supervisor.ensureSupervisor(agent, watch, { tickMs: 5 });
}

function closeSupervisor(watch) {
    const s = watch.supervisor;
    for (const name of ['close', 'stop', 'dispose'])
        if (typeof s?.[name] === 'function') return s[name]();
}

describe('SPEC 4.5 the message event', () => {
    test('"Opus, why is it going to the surface?" becomes the event, with data.from', () => {
        const { agent, watch } = setup({ connected: true });
        M.supervisor.supervisorMessage(agent, OWNER, 'Opus, why is it going to the surface?', { agents: ['claude', 'gpt'] });
        const events = watch.events.last(100);
        const message = events.find((e) => e.kind === 'message');
        assert.ok(message, `an event of kind message: ${JSON.stringify(events)}`);
        assert.equal(message.text, 'Message: "why is it going to the surface?"');
        assert.equal(message.data?.from, OWNER);
        assert.deepEqual(agent.said, [], 'no bot answers it while the supervisor is connected');
    });

    test('no supervisor connected: the first agent says The supervisor is not here., the other one nothing; the event is kept', () => {
        const first = setup({ connected: false, name: 'claude' });
        const second = setup({ connected: false, name: 'gpt' });
        for (const s of [first, second])
            M.supervisor.supervisorMessage(s.agent, OWNER, 'Opus, hello', { agents: ['claude', 'gpt'] });
        assert.deepEqual(first.agent.said, ['The supervisor is not here.']);
        assert.deepEqual(second.agent.said, []);
        const events = first.watch.events.last(100);
        assert.ok(events.some((e) => e.kind === 'message'), 'the event is kept in the ring');
    });

    test('presence: a wait or digest call more than 60 s ago is no supervisor', () => {
        const { agent, watch, clock } = setup({ connected: false });
        watch.presence.seenAt = clock.now() - 61000;
        M.supervisor.supervisorMessage(agent, OWNER, 'Opus, hello', { agents: ['claude', 'gpt'] });
        assert.deepEqual(agent.said, ['The supervisor is not here.']);
    });
});

describe('SPEC 4.5 presence in the server line', () => {
    test('a wait or digest 12 s ago: Supervisor: connected 12 s ago.; 61 s ago: Supervisor: none.', async () => {
        const { agent, watch, clock } = setup({ connected: true });
        const lines = (await M.tools.runTool(agent, watch, 'server', {})).text.split('\n');
        assert.ok(lines.includes('Supervisor: connected 12 s ago.'), lines.join('\n'));
        watch.presence.seenAt = clock.now() - 61000;
        const later = (await M.tools.runTool(agent, watch, 'server', {})).text.split('\n');
        assert.ok(later.includes('Supervisor: none.'), later.join('\n'));
    });
});

describe('SPEC 4.5 reply: the relay', () => {
    test('an answer: [Opus] <text> in the chat', async () => {
        const { agent, watch } = setup({ connected: true });
        fastSupervisor(agent, watch);
        try {
            const answer = await M.tools.runTool(agent, watch, 'reply', { text: 'It is in the tunnel.' });
            await realMs(30);
            assert.notEqual(answer.isError, true, answer.text);
            assert.deepEqual(relayed(agent, watch), ['[Opus] It is in the tunnel.']);
        } finally {
            closeSupervisor(watch);
        }
    });

    test('an update with supervisor_updates off: Updates are off. and nothing is said', async () => {
        const { agent, watch } = setup({ connected: true, updates: false });
        fastSupervisor(agent, watch);
        try {
            const answer = await M.tools.runTool(agent, watch, 'reply', { text: 'I go on with the mining.', kind: 'update' });
            await realMs(30);
            assert.equal(answer.text, 'Updates are off.');
            assert.deepEqual(relayed(agent, watch), []);
        } finally {
            closeSupervisor(watch);
        }
    });

    test('an update with supervisor_updates on is relayed', async () => {
        const { agent, watch } = setup({ connected: true, updates: true });
        fastSupervisor(agent, watch);
        try {
            await M.tools.runTool(agent, watch, 'reply', { text: 'The mining is done.', kind: 'update' });
            await realMs(30);
            assert.deepEqual(relayed(agent, watch), ['[Opus] The mining is done.']);
        } finally {
            closeSupervisor(watch);
        }
    });

    // the spec: the bot relays the line into the chat, so the players in the game see it (bot.chat or openChat of
    // the bot), not only the chat ring of the watch and the page (failed on an earlier state of N2 in this round)
    test('the relayed line reaches the game chat through the bot', async () => {
        const { agent, watch } = setup({ connected: true });
        fastSupervisor(agent, watch);
        try {
            await M.tools.runTool(agent, watch, 'reply', { text: 'It is in the tunnel.' });
            await realMs(30);
            assert.deepEqual(inGameChat(agent), ['[Opus] It is in the tunnel.']);
        } finally {
            closeSupervisor(watch);
        }
    });

    test('the text is 1 to 256 characters', async () => {
        const { agent, watch } = setup({ connected: true });
        fastSupervisor(agent, watch);
        try {
            const long = await M.tools.runTool(agent, watch, 'reply', { text: 'x'.repeat(257) });
            const empty = await M.tools.runTool(agent, watch, 'reply', { text: '' });
            const max = await M.tools.runTool(agent, watch, 'reply', { text: 'y'.repeat(256) });
            await realMs(30);
            assert.equal(long.isError, true, long.text);
            assert.equal(empty.isError, true, empty.text);
            assert.notEqual(max.isError, true, max.text);
            assert.deepEqual(relayed(agent, watch), [`[Opus] ${'y'.repeat(256)}`]);
        } finally {
            closeSupervisor(watch);
        }
    });
});

describe('SPEC 4.5 nobody speaks over anybody: the hold rule (the handoff for W111)', () => {
    test('an update 300 ms after the owner\'s order waits for the bot\'s answer and 3 s after it', async () => {
        const { agent, watch, clock } = setup({ connected: true, updates: true });
        fastSupervisor(agent, watch);
        try {
            ownerSays(watch, clock, 'claude, where are you?');
            clock.tick(300);
            const pending = M.tools.runTool(agent, watch, 'reply', { text: 'The bot is in the mine.', kind: 'update' });
            await realMs(30);
            assert.deepEqual(relayed(agent, watch), [], 'held: the owner\'s order has no answer yet');
            clock.tick(1500);
            botSays(agent, watch, clock, 'I am at (31, -59, -99).');
            await realMs(30);
            clock.tick(2900);
            await realMs(30);
            assert.deepEqual(relayed(agent, watch), [], 'held for 3 s after the bot\'s line');
            clock.tick(200);
            await realMs(40);
            assert.deepEqual(relayed(agent, watch), ['[Opus] The bot is in the mine.']);
            const texts = watch.chat.last(100).map((e) => e.text);
            assert.ok(texts.indexOf('[Opus] The bot is in the mine.') > texts.indexOf('I am at (31, -59, -99).'), 'after the answer, never between');
            const answer = await pending;
            assert.notEqual(answer.text, 'Dropped: the bot was speaking.');
        } finally {
            closeSupervisor(watch);
        }
    });

    test('the owner\'s line with no answer holds the line up to 10 s, then it is relayed', async () => {
        const { agent, watch, clock } = setup({ connected: true });
        fastSupervisor(agent, watch);
        try {
            ownerSays(watch, clock, 'claude, what do you see?');
            const pending = M.tools.runTool(agent, watch, 'reply', { text: 'It sees lava to the east.' });
            clock.tick(9000);
            await realMs(30);
            assert.deepEqual(relayed(agent, watch), [], 'held while the answer may come');
            clock.tick(1500);
            await realMs(40);
            assert.deepEqual(relayed(agent, watch), ['[Opus] It sees lava to the east.']);
            await pending;
        } finally {
            closeSupervisor(watch);
        }
    });

    test('an update held more than 20 s is dropped: Dropped: the bot was speaking., nothing said', async () => {
        const { agent, watch, clock } = setup({ connected: true, updates: true });
        fastSupervisor(agent, watch);
        try {
            botSays(agent, watch, clock, 'I mined 4 of 6 iron. I go on.');
            clock.tick(500);
            const pending = M.tools.runTool(agent, watch, 'reply', { text: 'Step 2 of 3 is done.', kind: 'update' });
            await realMs(15);
            clock.tick(1500);
            for (let i = 0; i < 12; i++) {
                botSays(agent, watch, clock, `Line ${i} of a long answer.`);
                await realMs(15);
                clock.tick(2000);
            }
            await realMs(40);
            const answer = await pending;
            assert.equal(answer.text, 'Dropped: the bot was speaking.');
            assert.deepEqual(relayed(agent, watch), []);
        } finally {
            closeSupervisor(watch);
        }
    });
});

describe('SPEC 4.5 note', () => {
    test('the answer: Noted for 30 min: "<text>". and the minutes 1 to 120', async () => {
        const { agent, watch } = setup({ connected: true });
        const noted = await M.tools.runTool(agent, watch, 'note', { text: NOTE });
        assert.equal(noted.text, `Noted for 30 min: "${NOTE}".`);
        const five = await M.tools.runTool(agent, watch, 'note', { text: NOTE, minutes: 5 });
        assert.equal(five.text, `Noted for 5 min: "${NOTE}".`);
        assert.equal((await M.tools.runTool(agent, watch, 'note', { text: NOTE, minutes: 0 })).isError, true);
        assert.equal((await M.tools.runTool(agent, watch, 'note', { text: NOTE, minutes: 121 })).isError, true);
        assert.equal((await M.tools.runTool(agent, watch, 'note', { text: 'z'.repeat(201) })).isError, true);
    });

    /** The conversing prompt the model gets for the agent of the test. */
    async function promptOf(agent, { promptCache = false, model: chatModel = null } = {}) {
        M.settings.setSettings({ language: 'en', blocked_actions: [], prompt_cache: promptCache, only_chat_with: [], supervisor_name: 'Opus' });
        let seen = '';
        const model = chatModel ?? { async sendRequest(turns, system) { seen = Array.isArray(system) ? system.map((p) => p?.text ?? p).join('\n') : String(system); return 'ok'; } };
        const prompter = Object.create(M.prompter.Prompter.prototype);
        Object.assign(agent, {
            blocked_actions: [], history: { memory: '' },
            self_prompter: { isStopped: () => true, isActive: () => false, isPaused: () => false, prompt: '' },
            task: { task_id: null }, npc: {}, isIdle: () => true, knowledgeBlock: () => '',
        });
        Object.assign(prompter, {
            agent,
            profile: { name: agent.name, conversing: 'You are $NAME.\nA rule about a place names a place you saved.\nSummarized memory:\'$MEMORY\'\n$COMMAND_DOCS\nConversation Begin:' },
            cooldown: 0, last_prompt_time: 0, awaiting_coding: false, convo_examples: null, coding_examples: null,
            chat_model: model, code_model: model,
        });
        const cap = captureConsole();
        try {
            await prompter.promptConvo([{ role: 'user', content: `${OWNER}: hi` }]);
        } finally {
            cap.restore();
        }
        return seen;
    }

    const noteLines = (prompt) => prompt.split('\n').filter((l) => l.startsWith('Supervisor: '));

    test('the prompt holds Supervisor: <text> as one line; the newer replaces the older; empty clears it', async () => {
        // the prompter reads the time of the system: the watch's clock is the same here
        const { agent, watch } = setup({ connected: true, clock: { now: () => Date.now(), tick: () => {} } });
        await M.tools.runTool(agent, watch, 'note', { text: NOTE });
        const prompt = await promptOf(agent);
        assert.deepEqual(noteLines(prompt), [`Supervisor: ${NOTE}`]);
        const lines = prompt.split('\n');
        const anchor = lines.findIndex((l) => l.startsWith('A rule about a place names '));
        assert.equal(lines[anchor + 1], `Supervisor: ${NOTE}`, 'one line where the role line would be, after the rule about places');
        await M.tools.runTool(agent, watch, 'note', { text: 'the owner is away until night' });
        assert.deepEqual(noteLines(await promptOf(agent)), ['Supervisor: the owner is away until night']);
        await M.tools.runTool(agent, watch, 'note', { text: '' });
        assert.deepEqual(noteLines(await promptOf(agent)), []);
    });

    test('with prompt_cache on the note is in the changing part, the fixed part stays the same (SPEC 4.7 M2)', async () => {
        const { agent, watch } = setup({ connected: true, clock: { now: () => Date.now(), tick: () => {} } });
        const requests = [];
        const adapter = Object.create(M.claude.Claude.prototype);
        Object.assign(adapter, { model_name: 'claude-haiku-4-5-20251001', params: {} });
        adapter.anthropic = { messages: { create: async (r) => { requests.push(r); return { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, output_tokens: 2 } }; } } };
        await promptOf(agent, { promptCache: true, model: adapter });
        await M.tools.runTool(agent, watch, 'note', { text: NOTE });
        await promptOf(agent, { promptCache: true, model: adapter });
        const [before, withNote] = requests.map((r) => r.system);
        assert.ok(Array.isArray(before) && Array.isArray(withNote), 'two blocks');
        assert.equal(withNote[0].text, before[0].text, 'the fixed part did not change with the note');
        assert.ok(!withNote[0].text.includes('Supervisor: '), 'no note in the fixed part');
        assert.ok(withNote[1].text.split('\n').includes(`Supervisor: ${NOTE}`), 'the note in the changing part');
    });

    test('the note expires: present at 29 min, gone after 30 min (a mocked clock)', async () => {
        mock.timers.enable({ apis: ['Date'], now: T0 });
        try {
            const clock = { now: () => Date.now(), tick: (ms) => mock.timers.tick(ms) };
            const { agent, watch } = setup({ connected: true, clock });
            await M.tools.runTool(agent, watch, 'note', { text: NOTE });
            mock.timers.tick(29 * 60000);
            assert.deepEqual(noteLines(await promptOf(agent)), [`Supervisor: ${NOTE}`]);
            mock.timers.tick(61000);
            assert.deepEqual(noteLines(await promptOf(agent)), [], 'the expired note vanished');
        } finally {
            mock.timers.reset();
        }
    });
});
