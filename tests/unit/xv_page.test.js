// Spec v0.1.4.13 4.5 (part N2), the page and the voice of the mindserver, from the pure functions of
// src/mindcraft/public/chat_logic.js (the voice services do not run in a test): the line of the supervisor on its way
// to the page, the chat of every bot and the supervisor with the name in front, where a line of the owner goes (the
// chosen bot's name in front, "everyone" plain), the voice of each speaker (voice_voice per bot, supervisor_voice for
// `[Opus] ...`), and the one speech queue (a bot's answer, the supervisor's answer, its update; an update that waited
// over 20 s is not spoken).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../src/mindcraft/public/chat_logic.js';
import { ADDRESS_WORDS, addressedTo } from '../../src/agent/bots_logic.js';
import { readRepoFile } from '../helpers/source_ast.js';

const AGENTS = [{ name: 'claude', in_game: true }, { name: 'gpt', in_game: true }, { name: 'luna', in_game: false }];

describe('the line of the supervisor on its way to the page', () => {
    test('supervisorOutput and parseSupervisorOutput: name, kind, text, the bot that relayed it, the voice', () => {
        const message = C.supervisorOutput({ name: 'Opus', kind: 'update', text: ' The mining is at 2 of 6. ', by: 'claude', voice: 'supertonic:M2' });
        assert.deepEqual(C.parseSupervisorOutput(C.SUPERVISOR_OUTPUT, message), { name: 'Opus', kind: 'update', text: 'The mining is at 2 of 6.', by: 'claude', voice: 'supertonic:M2' });
        const plain = C.supervisorOutput({ name: 'Opus', text: 'Yes.', by: 'claude', voice: 'loud' });
        assert.deepEqual(C.parseSupervisorOutput(C.SUPERVISOR_OUTPUT, plain), { name: 'Opus', kind: 'answer', text: 'Yes.', by: 'claude', voice: null });
    });

    test('anything else is no line of the supervisor', () => {
        assert.equal(C.parseSupervisorOutput('claude', C.supervisorOutput({ name: 'Opus', text: 'x' })), null);
        assert.equal(C.parseSupervisorOutput(C.SUPERVISOR_OUTPUT, 'not json'), null);
        assert.equal(C.parseSupervisorOutput(C.SUPERVISOR_OUTPUT, JSON.stringify({ name: '', text: 'x' })), null);
        assert.equal(C.parseSupervisorOutput(C.SUPERVISOR_OUTPUT, JSON.stringify({ name: 'Opus', text: ' ' })), null);
        assert.equal(C.SUPERVISOR_OUTPUT.startsWith('@'), true, 'no Minecraft name starts with @');
    });
});

describe('the chat of every bot and the supervisor, each with its name in front', () => {
    test('a bot line, a command of a bot, a note of the system', () => {
        assert.deepEqual(C.chatEntry('claude', 'I am here.', 'Opus'), { speaker: 'claude', kind: 'bot', text: 'I am here.' });
        assert.deepEqual(C.chatEntry('gpt', '!collectBlocks("oak_log", 10)', 'Opus'), { speaker: 'gpt', kind: 'command', text: '!collectBlocks("oak_log", 10)' });
        assert.deepEqual(C.chatEntry('system', 'Agent claude connected.', 'Opus'), { speaker: null, kind: 'note', text: 'Agent claude connected.' });
    });

    test('the supervisor\'s line: from its output, and a bot line that starts with [<supervisor_name>]', () => {
        const output = C.supervisorOutput({ name: 'Opus', kind: 'update', text: 'The mining is at 2 of 6.', by: 'claude', voice: 'supertonic:M1' });
        assert.deepEqual(C.chatEntry(C.SUPERVISOR_OUTPUT, output, 'Opus'), { speaker: 'Opus', kind: 'supervisor', text: 'The mining is at 2 of 6.', sub: 'update', by: 'claude', voice: 'supertonic:M1' });
        assert.deepEqual(C.chatEntry('claude', '[Opus] It is in the tunnel.', 'Opus'), { speaker: 'Opus', kind: 'supervisor', text: 'It is in the tunnel.', sub: 'answer', by: 'claude', voice: null });
        assert.deepEqual(C.chatEntry('claude', '[Opus] It is in the tunnel.', ''), { speaker: 'claude', kind: 'bot', text: '[Opus] It is in the tunnel.' });
        assert.equal(C.chatEntry(C.SUPERVISOR_OUTPUT, 'broken', 'Opus'), null);
    });

    test('shownLine: the name in front', () => {
        assert.equal(C.shownLine(C.chatEntry('claude', 'I am here.', 'Opus')), 'claude: I am here.');
        assert.equal(C.shownLine(C.chatEntry('gpt', 'On my way.', 'Opus')), 'gpt: On my way.');
        assert.equal(C.shownLine(C.chatEntry('claude', '[Opus] It is in the tunnel.', 'Opus')), '[Opus] It is in the tunnel.');
        assert.equal(C.shownLine(C.chatEntry('claude', '!stop', 'Opus')), '!stop');
    });
});

describe('where a line of the owner goes', () => {
    const route = (selected, text, supervisor = 'Opus') => C.routeLine({ selected, text, agents: AGENTS, supervisor });

    test('a bot chosen: to that bot, its name in front', () => {
        assert.deepEqual(route('claude', 'come here'), { ok: true, targets: ['claude'], message: 'claude, come here' });
        assert.deepEqual(route('gpt', '  please  wait  '), { ok: true, targets: ['gpt'], message: 'gpt, please wait' });
    });

    test('"everyone": every bot in the game, plain', () => {
        assert.deepEqual(route(C.EVERYONE, 'come here'), { ok: true, targets: ['claude', 'gpt'], message: 'come here' });
    });

    test('a line that names someone goes as it is: to the bot it names, the two it names, the supervisor through the chosen bot', () => {
        assert.deepEqual(route('claude', 'gpt, wait here'), { ok: true, targets: ['gpt'], message: 'gpt, wait here' });
        assert.deepEqual(route('claude', 'hey claude, come'), { ok: true, targets: ['claude'], message: 'hey claude, come' });
        assert.deepEqual(route('claude', 'claude and gpt, come here'), { ok: true, targets: ['claude', 'gpt'], message: 'claude and gpt, come here' });
        assert.deepEqual(route('claude', 'Opus, why is it going up?'), { ok: true, targets: ['claude'], message: 'Opus, why is it going up?' });
        assert.deepEqual(route(C.EVERYONE, 'Opus, why is it going up?'), { ok: true, targets: ['claude', 'gpt'], message: 'Opus, why is it going up?' });
        assert.deepEqual(route('claude', 'tell gpt to wait'), { ok: true, targets: ['claude'], message: 'claude, tell gpt to wait' }, 'a name inside a sentence is no address');
    });

    test('nobody to send it to', () => {
        assert.deepEqual(route('luna', 'come'), { ok: false, reason: 'not_in_game', text: 'luna is not in the game.' });
        assert.deepEqual(route('claude', 'luna, come'), { ok: false, reason: 'not_in_game', text: 'luna is not in the game.' });
        assert.deepEqual(route(null, 'come'), { ok: false, reason: 'no_agent', text: 'No bot is chosen.' });
        assert.deepEqual(route('claude', '   '), { ok: false, reason: 'empty', text: 'Heard nothing clear.' });
        assert.deepEqual(C.routeLine({ selected: C.EVERYONE, text: 'come', agents: [{ name: 'luna', in_game: false }] }), { ok: false, reason: 'not_in_game', text: 'No bot is in the game.' });
    });

    test('addressOf decides as addressedTo of bots_logic.js (the page cannot import it)', () => {
        assert.deepEqual([...C.ADDRESS_WORDS], [...ADDRESS_WORDS]);
        const names = ['claude', 'gpt', 'Opus'];
        const rows = ['claude, come here', 'hey claude, come', 'ok so gpt wait', 'gpt please wait here', 'Opus, where is it?',
            'claude and gpt, come here', 'tell gpt to wait', 'come here', 'CLAUDE: stop', 'claude?', 'hey', '', 'please now and claude go',
            'now please hi gpt'];
        for (const line of rows) assert.deepEqual(C.addressOf(line, names), addressedTo(line, names), line);
    });
});

describe('the voice of each speaker', () => {
    test('a bot in its voice; the supervisor in the voice of its line, else supervisor_voice, else supertonic:M1', () => {
        const known = { voices: { claude: 'supertonic:F2', gpt: 'supertonic:M3' }, supervisorVoice: 'supertonic:M4', fallback: 'supertonic:F1' };
        assert.equal(C.voiceFor(C.chatEntry('claude', 'Hi.'), known), 'supertonic:F2');
        assert.equal(C.voiceFor(C.chatEntry('gpt', 'Hi.'), known), 'supertonic:M3');
        assert.equal(C.voiceFor(C.chatEntry('luna', 'Hi.'), known), 'supertonic:F1');
        assert.equal(C.voiceFor(C.chatEntry('claude', '[Opus] Hi.', 'Opus'), known), 'supertonic:M4');
        const output = C.supervisorOutput({ name: 'Opus', text: 'Hi.', voice: 'supertonic:M5' });
        assert.equal(C.voiceFor(C.chatEntry(C.SUPERVISOR_OUTPUT, output, 'Opus'), known), 'supertonic:M5');
        assert.equal(C.voiceFor(C.chatEntry('claude', '[Opus] Hi.', 'Opus'), {}), C.SUPERVISOR_VOICE);
        assert.equal(C.SUPERVISOR_VOICE, 'supertonic:M1');
        assert.equal(C.voiceFor(C.chatEntry('claude', 'Hi.'), {}), C.BOT_VOICE);
    });

    test('voiceMap: the page\'s choice for a bot, else its voice_voice; only valid ids', () => {
        const settings = { claude: { voice_voice: 'supertonic:F2' }, gpt: { voice_voice: 'bad voice' }, luna: { voice_voice: 'kokoro:af_heart' } };
        assert.deepEqual(C.voiceMap(AGENTS, settings), { claude: 'supertonic:F2', luna: 'kokoro:af_heart' });
        assert.deepEqual(C.voiceMap(AGENTS, settings, { gpt: 'supertonic:M2', claude: 'nonsense' }), { claude: 'supertonic:F2', gpt: 'supertonic:M2', luna: 'kokoro:af_heart' });
    });

    test('supervisorOf: the name and the voice of the first bot that names one', () => {
        assert.equal(C.supervisorOf(AGENTS, { claude: { supervisor_name: '' } }), null);
        assert.deepEqual(C.supervisorOf(AGENTS, { claude: { supervisor_name: '' }, gpt: { supervisor_name: ' Opus ', supervisor_voice: 'supertonic:M2' } }), { name: 'Opus', voice: 'supertonic:M2' });
        assert.deepEqual(C.supervisorOf(AGENTS, { claude: { supervisor_name: 'Opus', supervisor_voice: 'x' } }), { name: 'Opus', voice: 'supertonic:M1' });
    });
});

describe('the one speech queue', () => {
    const voices = { voices: { claude: 'supertonic:F1', gpt: 'supertonic:F3' }, supervisorVoice: 'supertonic:M1' };
    const update = (text, at, seq) => C.speechItem(C.chatEntry(C.SUPERVISOR_OUTPUT, C.supervisorOutput({ name: 'Opus', kind: 'update', text }), 'Opus'), { at, seq, ...voices });
    const answer = (text, at, seq) => C.speechItem(C.chatEntry('claude', `[Opus] ${text}`, 'Opus'), { at, seq, ...voices });
    const bot = (name, text, at, seq) => C.speechItem(C.chatEntry(name, text, 'Opus'), { at, seq, ...voices });

    test('speechItem: what is said, by whom, in which voice; nothing for a command or a note', () => {
        assert.deepEqual(bot('claude', 'Sure! !collectBlocks("oak_log", 10)', 5, 1), { speaker: 'claude', kind: 'bot', text: 'Sure!', voice: 'supertonic:F1', at: 5, seq: 1 });
        assert.deepEqual(answer('It is in the tunnel.', 6, 2), { speaker: 'Opus', kind: 'answer', text: 'It is in the tunnel.', voice: 'supertonic:M1', at: 6, seq: 2 });
        assert.equal(update('The mining is at 2 of 6.', 7, 3).kind, 'update');
        assert.equal(bot('claude', '!stop', 0, 0), null);
        assert.equal(C.speechItem(C.chatEntry('system', 'hello'), { at: 0, seq: 0 }), null);
    });

    test('the order: a bot\'s answer, the supervisor\'s answer, its update; each kind in the order it came', () => {
        const u = update('The mining is at 2 of 6.', 1000, 1);
        const a = answer('It is in the tunnel.', 2000, 2);
        const b1 = bot('claude', 'I am here.', 3000, 3);
        const b2 = bot('gpt', 'Me too.', 3500, 4);
        let queue = [u, a, b1, b2];
        const spoken = [];
        for (let now = 4000; ; now += 100) {
            const step = C.nextSpeech(queue, now);
            assert.deepEqual(step.dropped, []);
            if (!step.next) break;
            spoken.push(step.next);
            queue = step.rest;
        }
        assert.deepEqual(spoken, [b1, b2, a, u]);
        assert.deepEqual(C.SPEECH_ORDER, ['bot', 'answer', 'update']);
    });

    test('one line at a time: next is one line, the rest waits in its order', () => {
        const a = answer('Yes.', 0, 1);
        const b = bot('claude', 'No.', 10, 2);
        const step = C.nextSpeech([a, b], 20);
        assert.equal(step.next, b);
        assert.deepEqual(step.rest, [a]);
    });

    test('an update that waited more than 20 s is not spoken; an answer is', () => {
        const u = update('The mining is at 2 of 6.', 0, 1);
        const a = answer('It is in the tunnel.', 0, 2);
        assert.equal(C.nextSpeech([u], 20000).next, u);
        const late = C.nextSpeech([u, a], 20001);
        assert.deepEqual(late.dropped, [u]);
        assert.equal(late.next, a);
        assert.deepEqual(late.rest, []);
        assert.equal(C.SPEECH_RULES.updateMaxWaitMs, 20000);
    });

    test('an empty queue', () => {
        assert.deepEqual(C.nextSpeech([], 0), { next: null, rest: [], dropped: [] });
        assert.deepEqual(C.nextSpeech(undefined, 0), { next: null, rest: [], dropped: [] });
    });
});

describe('the page and the voice use these functions', () => {
    test('app.js: the chat of every speaker, routeLine for a typed line, everyone in the dropdown, the voices to the voice', () => {
        const app = readRepoFile('src/mindcraft/public/app.js');
        assert.match(app, /import \{[^}]*chatEntry[^}]*routeLine[^}]*\} from '\.\/chat_logic\.js'/);
        assert.match(app, /new Option\('everyone', EVERYONE\)/);
        assert.match(app, /voices: voiceMap\(currentAgents, agentSettings, prefs\.voices \|\| \{\}\)/);
        assert.match(app, /supervisorVoice: sup\?\.voice \?\? null/);
    });

    test('voice_server.js: every bot-output into one queue (nextSpeech), a recognised line through routeLine', () => {
        const voice = readRepoFile('src/mindcraft/voice/voice_server.js');
        assert.match(voice, /import \{ chatEntry, nextSpeech, routeLine, speechItem \} from '\.\.\/public\/chat_logic\.js'/);
        assert.doesNotMatch(voice, /agentName !== settings\.agent/, 'not only the chosen bot');
        assert.match(voice, /routeLine\(\{ selected: settings\.agent, text, agents: known, supervisor: settings\.supervisor \?\? '' \}\)/);
    });
});
