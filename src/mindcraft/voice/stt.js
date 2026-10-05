// Speech to text (v0.1.4.13, voice_ui), from the live voice demo: the prebuilt whisper.cpp HTTP server runs as a child
// process on 127.0.0.1 and gets 16 kHz mono clips. The config comes from voiceConfig() of voice_logic.js.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

function findExe(dir, name) {
    if (!fs.existsSync(dir)) return null;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const found = findExe(full, name);
            if (found) return found;
        } else if (entry.name.toLowerCase() === name) {
            return full;
        }
    }
    return null;
}

/** Float32 PCM [-1, 1] -> 16-bit WAV file bytes. */
export function encodeWav(samples, sampleRate) {
    const buffer = Buffer.alloc(44 + samples.length * 2);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + samples.length * 2, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(1, 22); // mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(samples.length * 2, 40);
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        buffer.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), 44 + i * 2);
    }
    return buffer;
}

// Whisper likes to "hear" these in silence or noise.
export const HALLUCINATIONS = /^\s*(\[.*\]|\(.*\)|thank you\.?|thanks for watching!?|you|\.+)\s*$/i;

// Whether the port is free on 127.0.0.1. Whatever holds it is never stopped: it may be the owner's own app.
function portFree(port) {
    return new Promise((resolve) => {
        const probe = net.createServer();
        probe.once('error', () => resolve(false));
        probe.once('listening', () => probe.close(() => resolve(true)));
        probe.listen(port, '127.0.0.1');
    });
}

function fail(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
}

/**
 * Starts whisper-server, waits for it and warms it up.
 * Throws an Error with code 'stt_missing', 'port_busy' or 'stt_failed'.
 * @param {ReturnType<import('./voice_logic.js').voiceConfig>['stt']} cfg
 */
export async function createStt(cfg) {
    const exe = findExe(cfg.binDir, 'whisper-server.exe') ?? findExe(cfg.binDir, 'whisper-server');
    if (!exe) throw fail('stt_missing', `whisper-server not found in ${cfg.binDir}`);
    if (!fs.existsSync(cfg.model)) throw fail('stt_missing', `Whisper model missing: ${cfg.model}`);
    if (!(await portFree(cfg.port))) throw fail('port_busy', `Port ${cfg.port} is in use`);

    const baseUrl = `http://127.0.0.1:${cfg.port}`;
    const args = [
        '-m', cfg.model,
        '--host', '127.0.0.1',
        '--port', String(cfg.port),
        '-t', String(cfg.threads),
        '-l', cfg.language,
    ];
    if (!cfg.useGpu) args.push('-ng');

    const proc = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: true });
    let log = '';
    const onData = (d) => {
        log += d.toString();
        if (log.length > 20000) log = log.slice(-10000);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    let spawnError = null;
    proc.on('error', (err) => { spawnError = err; });

    const exited = new Promise((resolve) => proc.on('exit', resolve));
    const kill = () => {
        process.off('exit', kill);
        if (proc.exitCode === null && !proc.killed) proc.kill();
    };
    process.on('exit', kill);

    try {
        // Wait until the server answers (the model load takes a few seconds).
        const deadline = Date.now() + 120_000;
        for (;;) {
            if (spawnError) throw fail('stt_failed', spawnError.message);
            if (proc.exitCode !== null) throw fail('stt_failed', `whisper-server exited early:\n${log.slice(-3000)}`);
            try {
                const res = await fetch(`${baseUrl}/health`);
                if (res.ok) break;
            } catch {}
            if (Date.now() > deadline) throw fail('stt_failed', `whisper-server did not start in time:\n${log.slice(-3000)}`);
            await new Promise((r) => setTimeout(r, 300));
        }
    } catch (err) {
        kill();
        throw err;
    }

    const gpuLine = log.split('\n').find((l) => /CUDA0|ggml_cuda_init: found|use gpu/i.test(l));
    const backend = /ggml_cuda_init: found [1-9]/.test(log) && cfg.useGpu ? 'CUDA GPU' : 'CPU';

    const stt = {
        backend,
        gpuLine: gpuLine?.trim(),
        exited,
        kill,

        /** @param {Float32Array} samples 16 kHz mono */
        async transcribe(samples) {
            const form = new FormData();
            form.append('file', new Blob([encodeWav(samples, 16000)], { type: 'audio/wav' }), 'speech.wav');
            form.append('response_format', 'json');
            form.append('temperature', '0.0');
            const res = await fetch(`${baseUrl}/inference`, { method: 'POST', body: form });
            if (!res.ok) throw new Error(`whisper-server error ${res.status}: ${await res.text()}`);
            const { text = '' } = await res.json();
            const clean = text.replace(/\s+/g, ' ').trim();
            return HALLUCINATIONS.test(clean) ? '' : clean;
        },
    };

    // Warm-up: the prebuilt CUDA 12.4 binary has no native kernels for newer GPUs
    // (e.g. RTX 50xx), so the driver JIT-compiles them on first use (~45 s the very
    // first time, cached by the driver afterwards). Do it now, not on the first sentence.
    try {
        await stt.transcribe(new Float32Array(16000));
    } catch (err) {
        kill();
        throw fail('stt_failed', err.message);
    }
    return stt;
}
