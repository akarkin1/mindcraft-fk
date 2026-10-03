// v0.1.4.13, the live voice (docs/releases/0.1.4.13/HANDOFF-voice.md, 2, 4 to 6): src/mindcraft/voice/voice_logic.js.
// Where the engines lie and the demo's environment variables, the sentences of a line, where a recognised line goes,
// when a turn is over, and the texts of the page. No network, no audio.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { assertCleanImport, assertImportRules } from '../helpers/module_rules.js';

const V = await loadSrc('src/mindcraft/voice/voice_logic.js');

describe('voice_logic.js is pure', () => {
    test('imports only node:path, no side effects', () => {
        assertImportRules('src/mindcraft/voice/voice_logic.js', { allowBuiltins: ['path'], allowedRelative: [] });
        assertCleanImport('src/mindcraft/voice/voice_logic.js');
    });
});

describe('voiceDir(env, platform, home): outside the checkout', () => {
    test('Windows: %LOCALAPPDATA%\\Mindcraft\\voice', () => {
        assert.equal(V.voiceDir({ LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, 'win32', 'C:\\Users\\a'), 'C:\\Users\\a\\AppData\\Local\\Mindcraft\\voice');
        assert.equal(V.voiceDir({}, 'win32', 'C:\\Users\\a'), 'C:\\Users\\a\\AppData\\Local\\Mindcraft\\voice');
    });

    test('elsewhere: ~/.local/share/mindcraft/voice, or under XDG_DATA_HOME', () => {
        assert.equal(V.voiceDir({}, 'linux', '/home/a'), '/home/a/.local/share/mindcraft/voice');
        assert.equal(V.voiceDir({ XDG_DATA_HOME: '/data' }, 'linux', '/home/a'), '/data/mindcraft/voice');
    });

    test('MC_VOICE_DIR wins', () => {
        assert.equal(V.voiceDir({ MC_VOICE_DIR: '/opt/voice', LOCALAPPDATA: 'x' }, 'linux', '/home/a'), '/opt/voice');
        assert.equal(V.voiceDir({ MC_VOICE_DIR: 'D:\\voice' }, 'win32', 'C:\\Users\\a'), 'D:\\voice');
    });
});

describe('voiceConfig(settings, env, platform, home)', () => {
    const base = V.voiceConfig({}, {}, 'linux', '/home/a');

    test('the defaults: whisper large-v3-turbo-q5_0 on 8178 with the GPU, Supertonic F1 in English, 8 steps', () => {
        assert.equal(base.dir, '/home/a/.local/share/mindcraft/voice');
        assert.equal(base.defaultVoice, 'supertonic:F1');
        assert.equal(base.language, 'en');
        assert.deepEqual(base.stt, {
            binDir: '/home/a/.local/share/mindcraft/voice/bin/whisper',
            modelName: 'large-v3-turbo-q5_0',
            model: '/home/a/.local/share/mindcraft/voice/models/ggml-large-v3-turbo-q5_0.bin',
            port: 8178, language: 'en', useGpu: true, threads: 4,
        });
        assert.equal(base.supertonic.dir, '/home/a/.local/share/mindcraft/voice/models/supertonic-3');
        assert.equal(base.supertonic.revision, 'aafc6e32416a594460b32413efc49d7fe4ce6d46');
        assert.equal(base.supertonic.lang, 'en');
        assert.equal(base.supertonic.steps, 8);
        assert.equal(base.supertonic.useGpu, true);
        assert.equal(base.supertonic.dmlDevice, 0);
        assert.equal(base.kokoro.wanted, false, 'Kokoro is loaded only when its voice is asked for');
        assert.equal(base.quietMs, 2000);
        assert.equal(base.waitMs, 90000);
    });

    test('the settings voice_voice and voice_language', () => {
        const c = V.voiceConfig({ voice_voice: 'supertonic:M2', voice_language: 'ru' }, {}, 'linux', '/h');
        assert.equal(c.defaultVoice, 'supertonic:M2');
        assert.equal(c.stt.language, 'ru');
        assert.equal(c.supertonic.lang, 'ru');
        const k = V.voiceConfig({ voice_voice: 'kokoro:af_heart' }, {}, 'linux', '/h');
        assert.equal(k.defaultVoice, 'kokoro:af_heart');
        assert.equal(k.kokoro.wanted, true);
    });

    test('a broken voice falls back to supertonic:F1', () => {
        for (const v of ['', 'F1', 'espeak:x', 42, null]) assert.equal(V.voiceConfig({ voice_voice: v }, {}, 'linux', '/h').defaultVoice, 'supertonic:F1');
    });

    test('auto: whisper hears any language, Supertonic speaks English; a language it lacks: English', () => {
        const auto = V.voiceConfig({ voice_language: 'auto' }, {}, 'linux', '/h');
        assert.equal(auto.stt.language, 'auto');
        assert.equal(auto.supertonic.lang, 'en');
        assert.equal(V.voiceConfig({ voice_language: 'zh' }, {}, 'linux', '/h').supertonic.lang, 'en');
        assert.equal(V.voiceConfig({ voice_language: 'auto' }, { SUPERTONIC_LANG: 'de' }, 'linux', '/h').supertonic.lang, 'de');
    });

    test("the demo's environment variables", () => {
        const c = V.voiceConfig({}, {
            WHISPER_MODEL: 'small', WHISPER_PORT: '9000', WHISPER_GPU: 'false', WHISPER_THREADS: '8',
            SUPERTONIC_STEPS: '4', SUPERTONIC_GPU: 'false', SUPERTONIC_DML_DEVICE: '1', SUPERTONIC_THREADS: '3',
            KOKORO_DTYPE: 'q8', KOKORO_THREADS: '2', VOICE_KOKORO: 'true', VOICE_QUIET_MS: '1500', VOICE_WAIT_SECONDS: '30',
        }, 'linux', '/h');
        assert.equal(c.stt.model, '/h/.local/share/mindcraft/voice/models/ggml-small.bin');
        assert.equal(c.stt.port, 9000);
        assert.equal(c.stt.useGpu, false);
        assert.equal(c.stt.threads, 8);
        assert.equal(c.supertonic.steps, 4);
        assert.equal(c.supertonic.useGpu, false);
        assert.equal(c.supertonic.dmlDevice, 1);
        assert.equal(c.supertonic.threads, 3);
        assert.equal(c.kokoro.dtype, 'q8');
        assert.equal(c.kokoro.threads, 2);
        assert.equal(c.kokoro.wanted, true);
        assert.equal(c.quietMs, 1500);
        assert.equal(c.waitMs, 30000);
    });

    test('bad numbers keep the defaults', () => {
        const c = V.voiceConfig({}, { WHISPER_PORT: 'abc', WHISPER_THREADS: '0', SUPERTONIC_STEPS: '-2', VOICE_QUIET_MS: '' }, 'linux', '/h');
        assert.equal(c.stt.port, 8178);
        assert.equal(c.stt.threads, 4);
        assert.equal(c.supertonic.steps, 8);
        assert.equal(c.quietMs, 2000);
    });
});

describe('splitSentences(line)', () => {
    test('one sentence per call of the voice', () => {
        assert.deepEqual(V.splitSentences('I found 12 oak logs. Now I will craft planks! Do you want a chest?'),
            ['I found 12 oak logs.', 'Now I will craft planks!', 'Do you want a chest?']);
    });

    test('a short piece joins its neighbour', () => {
        assert.deepEqual(V.splitSentences('Sure! I will get wood for the house.'), ['Sure! I will get wood for the house.']);
        assert.deepEqual(V.splitSentences('I will get wood for the house. Ok.'), ['I will get wood for the house. Ok.']);
    });

    test('a long sentence is cut at a comma, else at a space; no letter is lost', () => {
        const long = `${'word '.repeat(40)}and then, ${'more '.repeat(40)}end.`;
        const parts = V.splitSentences(long, { max: 120 });
        assert.ok(parts.every((p) => p.length <= 120), JSON.stringify(parts));
        assert.equal(parts.join(' ').replace(/\s+/g, ' '), long.replace(/\s+/g, ' ').trim());
        const solid = 'x'.repeat(300);
        assert.equal(V.splitSentences(solid, { max: 120 }).join(''), solid);
    });

    test('nothing to say: no sentence', () => {
        assert.deepEqual(V.splitSentences(''), []);
        assert.deepEqual(V.splitSentences('   '), []);
        assert.deepEqual(V.splitSentences(null), []);
    });
});

describe('routeTranscript: a recognised line goes down send-message as a line of the owner', () => {
    const agents = [{ name: 'Claude', in_game: true }, { name: 'gpt', in_game: false }];

    test('the bot in the game: { from, message }, exactly as a typed line', () => {
        assert.deepEqual(V.routeTranscript({ agent: 'Claude', from: 'MartyByrde2', text: ' Collect ten  oak logs. ', agents }),
            { ok: true, data: { from: 'MartyByrde2', message: 'Collect ten oak logs.' } });
    });

    test('a bot out of the game, an unknown bot, no bot', () => {
        assert.deepEqual(V.routeTranscript({ agent: 'gpt', from: 'M', text: 'hi', agents }), { ok: false, reason: 'not_in_game', text: 'gpt is not in the game.' });
        assert.equal(V.routeTranscript({ agent: 'nobody', from: 'M', text: 'hi', agents }).reason, 'not_in_game');
        assert.deepEqual(V.routeTranscript({ agent: null, from: 'M', text: 'hi', agents }), { ok: false, reason: 'no_agent', text: 'No bot is chosen.' });
    });

    test('no name of the owner, no words', () => {
        assert.deepEqual(V.routeTranscript({ agent: 'Claude', from: ' ', text: 'hi', agents }), { ok: false, reason: 'no_name', text: 'Your name is not set.' });
        assert.deepEqual(V.routeTranscript({ agent: 'Claude', from: 'M', text: '  ', agents }), { ok: false, reason: 'empty', text: 'Heard nothing clear.' });
        assert.equal(V.routeTranscript().ok, false);
    });
});

describe('turnStep: when a turn is over', () => {
    const q = { quietMs: 2000, waitMs: 90000 };

    test('before the first line: wait, give up after waitMs', () => {
        assert.equal(V.turnStep({ ...q, now: 5000, sentAt: 0 }), 'wait');
        assert.equal(V.turnStep({ ...q, now: 90000, sentAt: 0 }), 'give_up');
    });

    test('after a line: done when the bot has said nothing for 2 s and nothing is left to speak', () => {
        assert.equal(V.turnStep({ ...q, now: 4000, sentAt: 0, firstLineAt: 3000, lastLineAt: 3000 }), 'wait');
        assert.equal(V.turnStep({ ...q, now: 5000, sentAt: 0, firstLineAt: 3000, lastLineAt: 3000 }), 'done');
        assert.equal(V.turnStep({ ...q, now: 9000, sentAt: 0, firstLineAt: 3000, lastLineAt: 3000, speaking: true }), 'wait');
        assert.equal(V.turnStep({ ...q, now: 6000, sentAt: 0, firstLineAt: 3000, lastLineAt: 4500 }), 'wait');
    });
});

describe('problemText: the texts of the page, plain and short', () => {
    test('word for word', () => {
        assert.equal(V.problemText('off'), 'The voice is off: set voice_ui in settings.js.');
        assert.equal(V.problemText('stt_missing'), 'whisper is not installed: run npm run voice:setup (about 1.6 GB).');
        assert.equal(V.problemText('tts_missing'), 'Supertonic is not installed: run npm run voice:setup (about 1.6 GB).');
        assert.equal(V.problemText('port_busy', { port: 8178 }), "whisper's port 8178 is busy.");
        assert.equal(V.problemText('port_busy', { port: 9001 }), "whisper's port 9001 is busy.");
        assert.equal(V.problemText('packages_missing'), 'The voice packages are missing: run npm install.');
    });

    test('a failure names its first line only', () => {
        assert.equal(V.problemText('stt_failed', { detail: 'exited early:\nlots of log' }), 'whisper did not start: exited early:');
        assert.equal(V.problemText('stt_failed'), 'whisper did not start.');
        assert.equal(V.problemText('nonsense', { detail: 'boom' }), 'boom');
    });
});
