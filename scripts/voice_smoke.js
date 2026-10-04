// End-to-end check of the live voice (v0.1.4.13) without a mic, a page or the bot: each voice speaks a few lines,
// cut as the bot's lines are cut, and Whisper transcribes them back. Prints the timings per stage. From the demo.
//
//   npm run voice:smoke                        (supertonic:F1 and supertonic:M2)
//   npm run voice:smoke -- supertonic:F3       (other voices)
//
// Uses its own whisper port (8179), so it can run while the bot is up.
import os from 'node:os';
import { voiceConfig, splitSentences } from '../src/mindcraft/voice/voice_logic.js';
import { speechText } from '../src/mindcraft/public/chat_logic.js';
import { createStt } from '../src/mindcraft/voice/stt.js';
import { createTts } from '../src/mindcraft/voice/tts.js';

process.env.WHISPER_PORT ??= '8179';
const voices = process.argv.slice(2).length ? process.argv.slice(2) : ['supertonic:F1', 'supertonic:M2'];
const config = voiceConfig({ voice_voice: voices[0] }, process.env, process.platform, os.homedir());
if (voices.some((v) => v.startsWith('kokoro:'))) config.kokoro.wanted = true;

const lines = [
    "Hey, can you hear me? Let's go mining for some diamonds tonight.",
    'Build a small wooden house next to the river, and put a chest inside.',
    'Sure! !collectBlocks("oak_log", 10)',
];

let t = performance.now();
const stt = await createStt(config.stt);
console.log(`STT ready in ${Math.round(performance.now() - t)} ms on ${stt.backend}`);
let failures = 0;
try {
    t = performance.now();
    const tts = await createTts(config);
    console.log(`TTS ready in ${Math.round(performance.now() - t)} ms: ${tts.engines.join(' + ')}, ${tts.voices.length} voices\n`);
    for (const voice of voices) {
        for (const line of lines) {
            for (const s of splitSentences(speechText(line))) {
                t = performance.now();
                const { samples, sampleRate } = await tts.synthesize(s, { voice });
                const ttsMs = Math.round(performance.now() - t);
                // Naive resample to Whisper's 16 kHz.
                const ratio = sampleRate / 16000;
                const pcm16k = new Float32Array(Math.floor(samples.length / ratio));
                for (let i = 0; i < pcm16k.length; i++) pcm16k[i] = samples[Math.floor(i * ratio)];
                t = performance.now();
                const text = await stt.transcribe(pcm16k);
                const sec = samples.length / sampleRate;
                if (!text) failures++;
                console.log(
                    `${voice.padEnd(17)} ${sec.toFixed(1)}s audio | TTS ${String(ttsMs).padStart(5)} ms ` +
                        `(${(ttsMs / 1000 / sec).toFixed(2)}x RT) | STT ${String(Math.round(performance.now() - t)).padStart(4)} ms | "${text}"`,
                );
            }
        }
    }
} finally {
    stt.kill();
}
console.log(failures ? `\n${failures} lines came back empty.` : '\nEvery line came back as text.');
process.exit(failures ? 1 : 0);
