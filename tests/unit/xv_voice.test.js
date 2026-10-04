// Spec v0.1.4.13 4.5 (part N2), the voice of the mindserver with a fake engine (no whisper, no Supertonic): the one
// speech queue of a page session (every bot and the supervisor, one line at a time, a bot's answer before the
// supervisor's answer before its update, an update that waited over 20 s not spoken, the owner's speech stops
// everything), the voice of each speaker, and a recognised line sent with the chosen bot's name in front or to every
// bot with "everyone"; the second voice in the config (supervisor_voice).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../../src/mindcraft/voice/voice_server.js';
import { voiceConfig, SUPERVISOR_DEFAULT_VOICE } from '../../src/mindcraft/voice/voice_logic.js';
import { EVERYONE, SUPERVISOR_OUTPUT, supervisorOutput } from '../../src/mindcraft/public/chat_logic.js';

const VOICES = ['supertonic:F1', 'supertonic:F2', 'supertonic:F3', 'supertonic:M1', 'supertonic:M2'].map((id) => ({ id, name: id, engine: 'supertonic', group: 'x' }));

function fakeSession({ transcript = 'come here', agents = [{ name: 'claude', in_game: true }, { name: 'gpt', in_game: true }], slowMs = 0 } = {}) {
    const handlers = {};
    const emitted = [];
    const sent = [];
    const spoken = []; // { text, voice }
    let release = null;
    const socket = {
        on: (event, fn) => { handlers[event] = fn; },
        emit: (event, data) => emitted.push({ event, data }),
    };
    const tts = {
        voices: VOICES, engines: ['Supertonic'], defaultVoice: 'supertonic:F1',
        async synthesize(text, { voice }) {
            spoken.push({ text, voice });
            if (slowMs > 0) await new Promise((resolve) => { release = resolve; setTimeout(resolve, slowMs); });
            return { samples: new Float32Array(441), sampleRate: 44100 }; // 10 ms of audio
        },
    };
    const engine = {
        stt: { state: 'ready', message: 'whisper', impl: { backend: 'cpu', transcribe: async () => transcript } },
        tts: { state: 'ready', message: 'Supertonic', impl: tts },
    };
    const config = voiceConfig({ voice_voice: 'supertonic:F1', supervisor_voice: 'supertonic:M2' }, {}, 'linux', '/h');
    config.quietMs = 50;
    const session = createSession(socket, {
        engine, config, publicState: () => ({ enabled: true }), agents: () => agents,
        sendToAgent: (name, data) => { sent.push({ name, ...data }); return agents.some((a) => a.name === name && a.in_game); },
    });
    return { session, handlers, emitted, sent, spoken, release: () => release?.() };
}

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the one speech queue of a page', () => {
    test('every speaker in its voice; the waiting lines in the order: a bot, the supervisor\'s answer, its update', async () => {
        const f = fakeSession({ slowMs: 40 });
        f.handlers.settings({ agent: 'claude', from: 'MartyByrde2', voices: { claude: 'supertonic:F2', gpt: 'supertonic:F3' }, supervisor: 'Opus' });
        f.session.botLine(SUPERVISOR_OUTPUT, supervisorOutput({ name: 'Opus', kind: 'update', text: 'The mining is at 1 of 6.', by: 'claude' }));
        // while the first line is made, four more arrive
        f.session.botLine(SUPERVISOR_OUTPUT, supervisorOutput({ name: 'Opus', kind: 'update', text: 'The mining is at 2 of 6.', by: 'claude' }));
        f.session.botLine('claude', '[Opus] It is in the tunnel.');
        f.session.botLine('gpt', 'I am here.');
        f.session.botLine('claude', 'Me too. !goToPlayer("MartyByrde2", 3)');
        f.session.botLine('claude', '!stop'); // a command is shown, not spoken
        await settle(400);
        assert.deepEqual(f.spoken, [
            { text: 'The mining is at 1 of 6.', voice: 'supertonic:M2' }, // it was alone when it came: one line at a time
            { text: 'I am here.', voice: 'supertonic:F3' },
            { text: 'Me too.', voice: 'supertonic:F2' },
            { text: 'It is in the tunnel.', voice: 'supertonic:M2' },
            { text: 'The mining is at 2 of 6.', voice: 'supertonic:M2' },
        ]);
        const audio = f.emitted.filter((e) => e.event === 'audio').map((e) => [e.data.speaker, e.data.text]);
        assert.deepEqual(audio.map((a) => a[0]), ['Opus', 'gpt', 'claude', 'Opus', 'Opus']);
        f.handlers.reset();
    });

    test('the supervisor\'s voice: of its line, else the page\'s, else supervisor_voice of the settings', async () => {
        const f = fakeSession();
        f.handlers.settings({ agent: 'claude', from: 'MartyByrde2', supervisor: 'Opus' });
        f.session.botLine('claude', '[Opus] One.');
        await settle();
        f.handlers.settings({ supervisorVoice: 'supertonic:M1' });
        f.session.botLine('claude', '[Opus] Two.');
        await settle();
        f.session.botLine(SUPERVISOR_OUTPUT, supervisorOutput({ name: 'Opus', text: 'Three.', voice: 'supertonic:F1' }));
        await settle();
        assert.deepEqual(f.spoken.map((s) => s.voice), ['supertonic:M2', 'supertonic:M1', 'supertonic:F1']);
        f.handlers.reset();
    });

    test('the owner\'s speech interrupts everything: the waiting lines go', async () => {
        const f = fakeSession({ slowMs: 40 });
        f.handlers.settings({ agent: 'claude', from: 'MartyByrde2', supervisor: 'Opus' });
        f.session.botLine('claude', 'One.');
        f.session.botLine('claude', 'Two.');
        f.session.botLine('claude', '[Opus] Three.');
        f.handlers.interrupt();
        await settle(200);
        assert.deepEqual(f.spoken.map((s) => s.text), ['One.']);
        assert.equal(f.emitted.filter((e) => e.event === 'audio').length, 0, 'the line being made is not sent');
    });

    test('Speak the bot\'s lines off: nothing is spoken', async () => {
        const f = fakeSession();
        f.handlers.settings({ agent: 'claude', from: 'MartyByrde2', speak: false });
        f.session.botLine('claude', 'One.');
        await settle();
        assert.deepEqual(f.spoken, []);
    });
});

describe('a recognised line', () => {
    test('a bot chosen: to it, its name in front; the transcript says what was sent', async () => {
        const f = fakeSession({ transcript: 'come here' });
        f.handlers.settings({ agent: 'claude', from: 'MartyByrde2' });
        f.handlers.utterance(new Float32Array(1600).buffer);
        await settle();
        assert.deepEqual(f.sent, [{ name: 'claude', from: 'MartyByrde2', message: 'claude, come here' }]);
        const t = f.emitted.find((e) => e.event === 'transcript').data;
        assert.equal(t.text, 'come here');
        assert.equal(t.sent, 'claude, come here');
        assert.deepEqual(t.to, ['claude']);
        f.handlers.reset();
    });

    test('"everyone": to every bot in the game, plain; the answer of either bot counts for the turn', async () => {
        const f = fakeSession({ transcript: 'come here' });
        f.handlers.settings({ agent: EVERYONE, from: 'MartyByrde2' });
        f.handlers.utterance(new Float32Array(1600).buffer);
        await settle();
        assert.deepEqual(f.sent, [{ name: 'claude', from: 'MartyByrde2', message: 'come here' }, { name: 'gpt', from: 'MartyByrde2', message: 'come here' }]);
        f.session.botLine('gpt', 'On my way.');
        await settle(600); // the clock of a turn ticks every 250 ms
        assert.ok(f.emitted.some((e) => e.event === 'turn_done'), 'the turn ended after the answer');
        f.handlers.reset();
    });

    test('a line for the supervisor goes as it is, to the chosen bot', async () => {
        const f = fakeSession({ transcript: 'Opus, where is it?' });
        f.handlers.settings({ agent: 'claude', from: 'MartyByrde2', supervisor: 'Opus' });
        f.handlers.utterance(new Float32Array(1600).buffer);
        await settle();
        assert.deepEqual(f.sent, [{ name: 'claude', from: 'MartyByrde2', message: 'Opus, where is it?' }]);
        f.handlers.reset();
    });

    test('a bot out of the game: the page is told, nothing is sent', async () => {
        const f = fakeSession({ transcript: 'come', agents: [{ name: 'claude', in_game: false }] });
        f.handlers.settings({ agent: 'claude', from: 'MartyByrde2' });
        f.handlers.utterance(new Float32Array(1600).buffer);
        await settle();
        assert.deepEqual(f.sent, []);
        assert.equal(f.emitted.find((e) => e.event === 'error_msg').data.message, 'claude is not in the game.');
    });
});

describe('the second voice in the config', () => {
    test('supervisor_voice, else supertonic:M1; a kokoro voice there loads Kokoro', () => {
        assert.equal(voiceConfig({}, {}, 'linux', '/h').supervisorVoice, 'supertonic:M1');
        assert.equal(SUPERVISOR_DEFAULT_VOICE, 'supertonic:M1');
        assert.equal(voiceConfig({ supervisor_voice: 'supertonic:M3' }, {}, 'linux', '/h').supervisorVoice, 'supertonic:M3');
        assert.equal(voiceConfig({ supervisor_voice: 'loud' }, {}, 'linux', '/h').supervisorVoice, 'supertonic:M1');
        assert.equal(voiceConfig({ supervisor_voice: 'kokoro:am_adam' }, {}, 'linux', '/h').kokoro.wanted, true);
        assert.equal(voiceConfig({ supervisor_voice: 'supertonic:M3' }, {}, 'linux', '/h').kokoro.wanted, false);
    });
});
