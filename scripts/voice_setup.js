// One-time setup of the live voice (v0.1.4.13, voice_ui), from the live voice demo: the whisper.cpp server binary
// (release b5130), a Whisper model and Supertonic 3 (a pinned Hugging Face revision), about 1.6 GB, into the voice
// folder outside the checkout (%LOCALAPPDATA%\Mindcraft\voice, ~/.local/share/mindcraft/voice, or MC_VOICE_DIR).
//
//   npm run voice:setup                         CUDA build of whisper.cpp (NVIDIA GPU)
//   npm run voice:setup -- --cpu                CPU-only build
//   npm run voice:setup -- --from <demo dir>    copy bin/ and models/ of the live voice demo instead of downloading
//   npm run voice:setup -- --kokoro             also fetch the Kokoro model (needs: npm install --no-save kokoro-js@1.2.1)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { voiceConfig } from '../src/mindcraft/voice/voice_logic.js';

const config = voiceConfig({}, process.env, process.platform, os.homedir());
const WHISPER_RELEASE = 'b5130';
const args = process.argv.slice(2);
const useCpu = args.includes('--cpu');
const fromIndex = args.indexOf('--from');
const fromDir = fromIndex >= 0 ? args[fromIndex + 1] : null;
const whisperZip = useCpu ? 'whisper-blas-bin-x64.zip' : 'whisper-cublas-12.4.0-bin-x64.zip';
const SUPERTONIC_FILES = [
    'LICENSE',
    ...['duration_predictor.onnx', 'text_encoder.onnx', 'vector_estimator.onnx', 'vocoder.onnx', 'tts.json', 'unicode_indexer.json'].map((f) => `onnx/${f}`),
    ...['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'].map((v) => `voice_styles/${v}.json`),
];

async function download(url, dest) {
    if (fs.existsSync(dest)) {
        console.log(`✓ already have ${dest}`);
        return;
    }
    console.log(`↓ ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
    const total = Number(res.headers.get('content-length')) || 0;
    let done = 0;
    let lastPct = -1;
    const body = Readable.fromWeb(res.body);
    body.on('data', (chunk) => {
        done += chunk.length;
        const pct = total ? Math.floor((done / total) * 100) : -1;
        if (pct !== lastPct && pct % 10 === 0) {
            process.stdout.write(`  ${pct}% (${(done / 1e6).toFixed(0)} MB)\n`);
            lastPct = pct;
        }
    });
    const tmp = `${dest}.part`;
    await pipeline(body, fs.createWriteStream(tmp));
    fs.renameSync(tmp, dest);
}

function findFile(dir, name) {
    if (!fs.existsSync(dir)) return null;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const found = findFile(full, name);
            if (found) return found;
        } else if (entry.name.toLowerCase() === name.toLowerCase()) {
            return full;
        }
    }
    return null;
}

function copy(from, to) {
    if (fs.existsSync(to)) {
        console.log(`✓ already have ${to}`);
        return;
    }
    if (!fs.existsSync(from)) throw new Error(`Not found: ${from}`);
    console.log(`→ copying ${from}`);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true });
}

async function setupWhisper() {
    const binDir = config.stt.binDir;
    fs.mkdirSync(binDir, { recursive: true });
    if (findFile(binDir, 'whisper-server.exe')) {
        console.log('✓ whisper-server.exe already installed');
    } else if (fromDir) {
        fs.rmSync(binDir, { recursive: true, force: true });
        copy(path.join(fromDir, 'bin', 'whisper'), binDir);
    } else {
        const zipPath = path.join(binDir, whisperZip);
        await download(`https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_RELEASE}/${whisperZip}`, zipPath);
        console.log('  extracting...');
        execFileSync('tar', ['-xf', zipPath, '-C', binDir], { stdio: 'inherit' });
        fs.rmSync(zipPath);
    }
    const exe = findFile(binDir, 'whisper-server.exe');
    if (!exe) throw new Error(`whisper-server.exe not found in ${binDir}`);
    console.log(`✓ ${exe}`);

    const modelFile = path.basename(config.stt.model);
    if (fromDir && !fs.existsSync(config.stt.model)) copy(path.join(fromDir, 'models', modelFile), config.stt.model);
    else await download(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelFile}`, config.stt.model);
}

async function setupSupertonic() {
    const { dir, revision } = config.supertonic;
    if (fromDir && !fs.existsSync(path.join(dir, 'onnx', 'vocoder.onnx'))) {
        fs.rmSync(dir, { recursive: true, force: true });
        copy(path.join(fromDir, 'models', 'supertonic-3'), dir);
    }
    const base = `https://huggingface.co/supertone-oss-archive/supertonic-3/resolve/${revision}`;
    for (const f of SUPERTONIC_FILES) {
        fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
        await download(`${base}/${f}`, path.join(dir, f));
    }
}

async function setupKokoro() {
    console.log('↓ Kokoro TTS model (first time only, ~90 MB)...');
    const { createTts } = await import('../src/mindcraft/voice/tts.js');
    const tts = await createTts({ ...config, defaultVoice: 'kokoro:af_heart', kokoro: { ...config.kokoro, wanted: true } });
    await tts.synthesize('Setup complete.', { voice: 'kokoro:af_heart' });
    console.log('✓ Kokoro ready');
}

console.log(`The voice folder: ${config.dir}`);
await setupWhisper();
await setupSupertonic();
if (args.includes('--kokoro')) await setupKokoro();
console.log('\nAll set. Set "voice_ui": true in settings.js and start the bot; npm run voice:smoke checks the voice.');
