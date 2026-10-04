// The voice of the mindserver (v0.1.4.13, voice_ui): where the engines lie, how a line is cut into sentences,
// where a recognised line goes, when a turn is over, and the texts of the page. Pure: the environment, the
// platform and the clock are handed in. Never throws.
import path from 'node:path';

/** The revision of Supertonic 3 on Hugging Face that the setup downloads (the demo's pin). */
export const SUPERTONIC_REVISION = 'aafc6e32416a594460b32413efc49d7fe4ce6d46';
/** The languages Supertonic 3 speaks (src/mindcraft/voice/vendor/supertonic/helper.js). */
export const SUPERTONIC_LANGS = ['en', 'ko', 'ja', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi', 'fr', 'hi', 'hr',
    'hu', 'id', 'it', 'lt', 'lv', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'vi'];
export const DEFAULT_VOICE = 'supertonic:F1';
/** v0.1.4.13 (part N2): the second voice, the supervisor's lines, without a valid supervisor_voice. */
export const SUPERVISOR_DEFAULT_VOICE = 'supertonic:M1';
/** The size the setup downloads, for the texts. */
export const SETUP_SIZE = 'about 1.6 GB';

const text = (v, fallback) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback);
const num = (v, fallback, min = 0) => {
    const n = Number(v);
    return v !== undefined && v !== '' && Number.isFinite(n) && n >= min ? n : fallback;
};
const flag = (v, fallback) => (v === undefined || v === '' ? fallback : String(v).toLowerCase() === 'true');

/**
 * The folder of the binaries and the models: MC_VOICE_DIR, else %LOCALAPPDATA%\Mindcraft\voice on Windows,
 * else ~/.local/share/mindcraft/voice (as the test server). Outside the checkout, so git never sees them.
 */
export function voiceDir(env = {}, platform = 'linux', home = '') {
    const p = platform === 'win32' ? path.win32 : path.posix;
    if (text(env.MC_VOICE_DIR, ''))
        return p.resolve(env.MC_VOICE_DIR);
    if (platform === 'win32')
        return p.join(text(env.LOCALAPPDATA, p.join(home, 'AppData', 'Local')), 'Mindcraft', 'voice');
    return p.join(text(env.XDG_DATA_HOME, p.join(home, '.local', 'share')), 'mindcraft', 'voice');
}

/**
 * Everything the engines need, from the three settings and the demo's environment variables. v0.1.4.13 (part N2):
 * supervisorVoice, the voice of the supervisor's lines from supervisor_voice (SUPERVISOR_DEFAULT_VOICE when it is no
 * valid id); a kokoro voice there loads Kokoro too.
 * @param {{voice_voice?: string, voice_language?: string, supervisor_voice?: string}} options the settings
 * @param {object} env process.env
 * @param {string} platform process.platform
 * @param {string} home os.homedir()
 */
export function voiceConfig(options = {}, env = {}, platform = 'linux', home = '') {
    const p = platform === 'win32' ? path.win32 : path.posix;
    const dir = voiceDir(env, platform, home);
    const language = text(options?.voice_language, 'en').toLowerCase();
    const defaultVoice = /^(supertonic|kokoro):\S+$/.test(text(options?.voice_voice, '')) ? options.voice_voice.trim() : DEFAULT_VOICE;
    const supervisorVoice = /^(supertonic|kokoro):\S+$/.test(text(options?.supervisor_voice, '')) ? options.supervisor_voice.trim() : SUPERVISOR_DEFAULT_VOICE;
    // whisper takes "auto"; Supertonic needs one language, and English when it does not speak the one asked for
    const ttsLang = text(env.SUPERTONIC_LANG, language).toLowerCase();
    const whisperModel = text(env.WHISPER_MODEL, 'large-v3-turbo-q5_0');
    return {
        dir,
        defaultVoice,
        supervisorVoice,
        language,
        stt: {
            binDir: p.join(dir, 'bin', 'whisper'),
            modelName: whisperModel,
            model: p.join(dir, 'models', `ggml-${whisperModel}.bin`),
            port: num(env.WHISPER_PORT, 8178, 1),
            language,
            useGpu: flag(env.WHISPER_GPU, true),
            threads: num(env.WHISPER_THREADS, 4, 1),
        },
        supertonic: {
            dir: p.join(dir, 'models', 'supertonic-3'),
            revision: SUPERTONIC_REVISION,
            lang: SUPERTONIC_LANGS.includes(ttsLang) ? ttsLang : 'en',
            steps: num(env.SUPERTONIC_STEPS, 8, 1),
            useGpu: flag(env.SUPERTONIC_GPU, true),
            dmlDevice: num(env.SUPERTONIC_DML_DEVICE, 0),
            threads: num(env.SUPERTONIC_THREADS, 6, 1),
        },
        kokoro: {
            // loaded only when its voice is asked for: the default voice, the supervisor's, or VOICE_KOKORO=true for the
            // dropdown
            wanted: defaultVoice.startsWith('kokoro:') || supervisorVoice.startsWith('kokoro:') || flag(env.VOICE_KOKORO, false),
            modelId: 'onnx-community/Kokoro-82M-v1.0-ONNX',
            dtype: text(env.KOKORO_DTYPE, 'fp32'),
            threads: num(env.KOKORO_THREADS, 6, 1),
        },
        // a turn is over when the bot has said nothing for quietMs; it gives up when the bot says nothing in waitMs
        quietMs: num(env.VOICE_QUIET_MS, 2000, 100),
        waitMs: num(env.VOICE_WAIT_SECONDS, 90, 1) * 1000,
    };
}

/**
 * The sentences of a line, each spoken by one call of the voice. A piece shorter than `min` letters joins the one
 * before it; a sentence longer than `max` is cut at a comma or a space.
 * @param {string} line
 * @returns {string[]}
 */
export function splitSentences(line, { min = 12, max = 280 } = {}) {
    const all = String(line ?? '').replace(/\s+/g, ' ').trim();
    if (!all)
        return [];
    const pieces = all.split(/(?<=[.!?…])\s+(?=\S)/);
    const joined = [];
    for (const piece of pieces) {
        if (joined.length > 0 && (piece.length < min || joined[joined.length - 1].length < min))
            joined[joined.length - 1] += ` ${piece}`;
        else
            joined.push(piece);
    }
    const out = [];
    for (let s of joined) {
        while (s.length > max) {
            const head = s.slice(0, max);
            const comma = head.lastIndexOf(', ');
            const space = head.lastIndexOf(' ');
            // after the comma, at the space, or hard at max
            const end = comma >= max / 3 ? comma + 1 : space >= max / 3 ? space : max;
            out.push(s.slice(0, end).trim());
            s = s.slice(end).trim();
        }
        if (s)
            out.push(s);
    }
    return out;
}

/**
 * Where a recognised line goes: down send-message to the bot as a line of the owner, exactly as a typed line.
 * @param {{agent: string|null, from: string|null, text: string, agents: {name: string, in_game: boolean}[]}} turn
 * @returns {{ok: true, data: {from: string, message: string}} | {ok: false, reason: string, text: string}}
 */
export function routeTranscript({ agent, from, text: said, agents } = {}) {
    const message = String(said ?? '').replace(/\s+/g, ' ').trim();
    if (!message)
        return { ok: false, reason: 'empty', text: 'Heard nothing clear.' };
    if (typeof agent !== 'string' || agent === '')
        return { ok: false, reason: 'no_agent', text: 'No bot is chosen.' };
    const known = (Array.isArray(agents) ? agents : []).find((a) => a?.name === agent);
    if (!known || !known.in_game)
        return { ok: false, reason: 'not_in_game', text: `${agent} is not in the game.` };
    if (typeof from !== 'string' || from.trim() === '')
        return { ok: false, reason: 'no_name', text: 'Your name is not set.' };
    return { ok: true, data: { from: from.trim(), message } };
}

/**
 * What a turn does at `now`: 'wait', 'done' (the bot said its lines and has been quiet for quietMs, nothing is left
 * to speak) or 'give_up' (the bot said nothing in waitMs).
 */
export function turnStep({ now, sentAt, firstLineAt = null, lastLineAt = null, speaking = false, quietMs = 2000, waitMs = 90000 }) {
    if (firstLineAt === null || firstLineAt === undefined)
        return now - sentAt >= waitMs ? 'give_up' : 'wait';
    if (speaking)
        return 'wait';
    return now - (lastLineAt ?? firstLineAt) >= quietMs ? 'done' : 'wait';
}

/**
 * The text of the page for a problem of the voice.
 * @param {'off'|'stt_missing'|'tts_missing'|'port_busy'|'packages_missing'|'stt_failed'|'tts_failed'|'stt_stopped'} code
 */
export function problemText(code, { port = 8178, detail = '' } = {}) {
    const why = String(detail ?? '').split('\n')[0].trim();
    switch (code) {
    case 'off': return 'The voice is off: set voice_ui in settings.js.';
    case 'stt_missing': return `whisper is not installed: run npm run voice:setup (${SETUP_SIZE}).`;
    case 'tts_missing': return `Supertonic is not installed: run npm run voice:setup (${SETUP_SIZE}).`;
    case 'port_busy': return `whisper's port ${port} is busy.`;
    case 'packages_missing': return 'The voice packages are missing: run npm install.';
    case 'stt_failed': return why ? `whisper did not start: ${why}` : 'whisper did not start.';
    case 'tts_failed': return why ? `The voice did not start: ${why}` : 'The voice did not start.';
    case 'stt_stopped': return 'whisper stopped. Restart the bot to listen again.';
    default: return why || 'The voice has a problem.';
    }
}
