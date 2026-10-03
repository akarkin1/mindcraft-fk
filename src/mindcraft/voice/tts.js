// Text to speech (v0.1.4.13, voice_ui), from the live voice demo. Two local engines behind one interface:
//   - Supertonic 3 (99M, 10 voices, 31 languages) on the GPU through DirectML, the owner's choice
//   - Kokoro (82M, 28 English voices) on the CPU, loaded only when its voice is asked for; kokoro-js is not a
//     dependency of the fork: npm install --no-save kokoro-js@1.2.1
// Voice ids are "engine:voice", e.g. "supertonic:F1" or "kokoro:af_heart". The config comes from voiceConfig().
import fs from 'node:fs';
import path from 'node:path';

async function createKokoro(cfg) {
    // Built by hand instead of KokoroTTS.from_pretrained() so the thread count can be capped:
    // with all 16 threads on a hybrid Intel CPU, ONNX Runtime waits on the slow E-cores
    // and synthesis is ~5x slower than with 6.
    const { KokoroTTS } = await import('kokoro-js');
    const { StyleTextToSpeech2Model, AutoTokenizer } = await import('@huggingface/transformers');
    const [model, tokenizer] = await Promise.all([
        StyleTextToSpeech2Model.from_pretrained(cfg.modelId, {
            dtype: cfg.dtype,
            device: 'cpu',
            session_options: { intraOpNumThreads: cfg.threads, interOpNumThreads: 1 },
        }),
        AutoTokenizer.from_pretrained(cfg.modelId),
    ]);
    const kokoro = new KokoroTTS(model, tokenizer);

    return {
        engine: 'Kokoro',
        device: 'CPU', // DirectML fails on this model (ConvTranspose), so CPU only
        voices: Object.entries(kokoro.voices).map(([id, v]) => ({
            id,
            name: v.name,
            group: `${v.language === 'en-gb' ? 'British' : 'American'} ${v.gender}`,
            grade: v.overallGrade,
        })),
        async synthesize(text, voice, speed) {
            const audio = await kokoro.generate(text, { voice, speed });
            return { samples: audio.audio, sampleRate: audio.sampling_rate };
        },
    };
}

async function loadSupertonicModel(cfg, helper) {
    const { dir, useGpu, dmlDevice, threads } = cfg;
    const onnxDir = path.join(dir, 'onnx');
    const cpu = () => helper.loadTextToSpeech(onnxDir, false, { intraOpNumThreads: threads, interOpNumThreads: 1 });
    if (!useGpu) return { tts: await cpu(), device: 'CPU' };
    try {
        // DirectML (Windows GPU API). Unlike Kokoro, all of Supertonic's ops run on it.
        // ~2x faster than the CPU and steadier: measured RTF 0.18 vs 0.33 on an RTX 5070 Ti Laptop.
        // Device order on a hybrid laptop: 0 was the NVIDIA GPU, 1 the Intel iGPU (5x slower).
        const tts = await helper.loadTextToSpeech(onnxDir, false, {
            executionProviders: [{ name: 'dml', deviceId: dmlDevice }],
            logSeverityLevel: 3, // hide "some nodes were not assigned to the preferred EP" warnings
        });
        return { tts, device: 'GPU' };
    } catch (err) {
        console.warn(`[voice] Supertonic: DirectML failed (${err.message.split('\n')[0]}), using CPU`);
        return { tts: await cpu(), device: 'CPU' };
    }
}

async function createSupertonic(cfg) {
    let helper;
    try {
        helper = await import('./vendor/supertonic/helper.js');
    } catch (err) {
        throw Object.assign(new Error(`onnxruntime-node is missing: ${err.message}`), { code: 'packages_missing' });
    }
    const { dir, lang, steps } = cfg;
    const { tts, device } = await loadSupertonicModel(cfg, helper);
    const styleDir = path.join(dir, 'voice_styles');
    const ids = fs.readdirSync(styleDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
    const styles = new Map(ids.map((id) => [id, helper.loadVoiceStyle([path.join(styleDir, `${id}.json`)])]));
    // Warm-up: the first DirectML run is ~2x slower (1.4 s vs ~0.6 s); pay it at startup.
    await tts.call('Hello.', lang, styles.get(ids[0]), steps, 1.05);

    return {
        engine: 'Supertonic',
        device,
        voices: ids.map((id) => ({
            id,
            name: id,
            group: id.startsWith('F') ? 'Female' : 'Male',
        })),
        async synthesize(text, voice, speed) {
            // Supertonic's natural pace is 1.05; scale the UI speed around it.
            const { wav, duration } = await tts.call(text, lang, styles.get(voice), steps, 1.05 * speed);
            const len = Math.min(wav.length, Math.floor(tts.sampleRate * duration[0]));
            return { samples: Float32Array.from(wav.slice(0, len)), sampleRate: tts.sampleRate };
        },
    };
}

/**
 * Loads Supertonic (and Kokoro when asked for). Throws an Error with code 'tts_missing', 'packages_missing' or
 * 'tts_failed' when no engine could be loaded.
 * @param {ReturnType<import('./voice_logic.js').voiceConfig>} config
 */
export async function createTts(config) {
    const engines = {};
    const problems = {};
    const loaders = {
        supertonic: () => {
            if (!fs.existsSync(path.join(config.supertonic.dir, 'onnx', 'vocoder.onnx')))
                throw Object.assign(new Error(`Supertonic model files missing in ${config.supertonic.dir}`), { code: 'tts_missing' });
            return createSupertonic(config.supertonic);
        },
    };
    if (config.kokoro.wanted) loaders.kokoro = () => createKokoro(config.kokoro);
    await Promise.all(
        Object.entries(loaders).map(async ([key, load]) => {
            try {
                engines[key] = await load();
            } catch (err) {
                problems[key] = err;
                console.warn(`[voice] TTS engine "${key}" disabled: ${err.message}`);
            }
        }),
    );
    if (!Object.keys(engines).length) {
        const err = problems.supertonic ?? problems.kokoro;
        throw Object.assign(new Error(err?.message ?? 'No TTS engine could be loaded'), { code: err?.code ?? 'tts_failed' });
    }

    const voices = Object.entries(engines).flatMap(([key, e]) =>
        e.voices.map((v) => ({ ...v, id: `${key}:${v.id}`, engine: e.engine })),
    );
    const defaultVoice = voices.some((v) => v.id === config.defaultVoice) ? config.defaultVoice : voices[0].id;

    // Serialise synthesis: one job at a time keeps CPU usage predictable while gaming.
    let queue = Promise.resolve();

    return {
        engines: Object.values(engines).map((e) => `${e.engine} (${e.device})`),
        voices,
        defaultVoice,

        /** @returns {Promise<{ samples: Float32Array, sampleRate: number }>} */
        synthesize(text, { voice = defaultVoice, speed = 1 } = {}) {
            const [key, name] = voice.split(':');
            const engine = engines[key];
            if (!engine) return Promise.reject(new Error(`Unknown voice ${voice}`));
            const job = queue.then(() => engine.synthesize(text, name, speed));
            queue = job.catch(() => {});
            return job;
        },
    };
}
