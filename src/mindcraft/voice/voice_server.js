// The live voice of the mindserver (v0.1.4.13, voice_ui). Loaded by mindserver.js with import() only when voice_ui
// is on. One session per page that sends voice-join:
//   utterance (16 kHz PCM) -> whisper -> transcript to the page, and the text to the bot down send-message as a
//   line of the owner -> the bot's next lines (bot-output) -> sentences -> Supertonic -> audio chunks to the page.
// The socket protocol is the demo's: utterance, settings, interrupt, reset, preview_voice; hello, status,
// transcript, audio, turn_done, error_msg. Added: voice-join and voice-config (the state of the engines).
// The bot's own work cannot be stopped from here; a new utterance stops only the speaking.
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { voiceConfig, splitSentences, routeTranscript, turnStep, problemText } from './voice_logic.js';
import { speechText } from '../public/chat_logic.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TICK_MS = 250;

/**
 * @param {{app: import('express').Express, options: object, sendToAgent: (name: string, data: object) => boolean,
 *          agents: () => {name: string, in_game: boolean}[]}} ctx
 */
export function startVoice({ app, options, sendToAgent, agents }) {
    const config = voiceConfig(options, process.env, process.platform, os.homedir());
    // The browser side of the demo, served from node_modules, no CDN: Silero VAD and its ONNX runtime.
    app.use('/vendor/vad', express.static(path.join(REPO_ROOT, 'node_modules', '@ricky0123', 'vad-web', 'dist')));
    app.use('/vendor/ort', express.static(path.join(REPO_ROOT, 'node_modules', 'onnxruntime-web', 'dist')));

    const engine = {
        stt: { state: 'loading', message: 'Starting whisper...', impl: null },
        tts: { state: 'loading', message: 'Loading the voice...', impl: null },
    };
    const sessions = new Set();
    let closed = false;

    const publicState = () => ({
        enabled: true,
        stt: { state: engine.stt.state, message: engine.stt.message },
        tts: { state: engine.tts.state, message: engine.tts.message },
    });
    const broadcast = () => {
        for (const s of sessions) s.sendState();
    };
    const failed = (part, err) => {
        const code = err?.code ?? `${part}_failed`;
        engine[part] = { state: 'failed', message: problemText(code, { port: config.stt.port, detail: err?.message }), impl: null };
        console.error(`[voice] ${part === 'stt' ? 'whisper' : 'TTS'}: ${err?.message ?? err}`);
        broadcast();
    };

    console.log(`[voice] Loading whisper and Supertonic from ${config.dir}`);
    const t0 = performance.now();
    import('./stt.js')
        .then(({ createStt }) => createStt(config.stt))
        .then((stt) => {
            if (closed) { stt.kill(); return; }
            engine.stt = { state: 'ready', message: `whisper on ${stt.backend}`, impl: stt };
            console.log(`[voice] whisper ready on ${stt.backend} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
            stt.exited.then((code) => {
                if (closed) return;
                console.error(`[voice] whisper-server exited (code ${code}).`);
                failed('stt', Object.assign(new Error(`exit code ${code}`), { code: 'stt_stopped' }));
            });
            broadcast();
        })
        .catch((err) => failed('stt', err));
    import('./tts.js')
        .then(({ createTts }) => createTts(config))
        .then((tts) => {
            if (closed) return;
            engine.tts = { state: 'ready', message: tts.engines.join(' + '), impl: tts };
            console.log(`[voice] ${tts.engines.join(' + ')} ready, ${tts.voices.length} voices, in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
            broadcast();
        })
        .catch((err) => failed('tts', err));

    // Ctrl+C and the closing of the console stop the child too (the demo's start script did the same).
    const onSignal = (signal) => {
        engine.stt.impl?.kill();
        process.exit(signal === 'SIGINT' ? 130 : 0);
    };
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, onSignal);

    function join(socket) {
        if (closed) return;
        for (const s of sessions) if (s.socket === socket) { s.sendState(); return; }
        const session = createSession(socket, { engine, config, publicState, sendToAgent, agents });
        sessions.add(session);
        socket.on('disconnect', () => {
            session.close();
            sessions.delete(session);
        });
        session.sendState();
    }

    function onBotOutput(agentName, message) {
        for (const s of sessions) s.botLine(agentName, message);
    }

    function close() {
        closed = true;
        for (const s of sessions) s.close();
        sessions.clear();
        engine.stt.impl?.kill();
        for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.off(sig, onSignal);
    }

    return { join, onBotOutput, close, config };
}

function createSession(socket, { engine, config, publicState, sendToAgent, agents }) {
    const settings = { voice: null, speed: 1, agent: null, from: null, speak: true };
    let turn = null; // { id, kind: 'voice'|'free', abort, t0, sentAt, firstLineAt, lastLineAt, pending, seq, timings, chain }
    let nextTurnId = 1;
    let clock = null;
    let helloSent = false;

    const status = (stage, extra = {}) => socket.emit('status', { stage, ...extra });
    const tts = () => (engine.tts.state === 'ready' ? engine.tts.impl : null);

    function sendState() {
        socket.emit('voice-config', publicState());
        const t = tts();
        if (t && !helloSent) {
            helloSent = true;
            if (!settings.voice || !t.voices.some((v) => v.id === settings.voice)) settings.voice = t.defaultVoice;
            socket.emit('hello', {
                voices: t.voices,
                ttsEngines: t.engines,
                settings: { voice: settings.voice, speed: settings.speed },
                sttBackend: engine.stt.state === 'ready' ? engine.stt.impl.backend : null,
                language: config.language,
            });
        }
    }

    function stopClock() {
        if (clock) clearInterval(clock);
        clock = null;
    }

    function endTurn(current) {
        if (turn !== current) return;
        stopClock();
        turn = null;
    }

    function cancelTurn() {
        if (!turn) return;
        turn.abort.abort();
        endTurn(turn);
    }

    function newTurn(kind) {
        cancelTurn();
        turn = {
            id: kind === 'voice' ? nextTurnId++ : `bot-${nextTurnId++}`,
            kind,
            abort: new AbortController(),
            t0: performance.now(),
            sentAt: null,
            firstLineAt: null,
            lastLineAt: null,
            pending: 0,
            seq: 0,
            timings: {},
            chain: Promise.resolve(),
        };
        return turn;
    }

    function startClock(current) {
        stopClock();
        clock = setInterval(() => {
            if (turn !== current) { stopClock(); return; }
            const step = turnStep({
                now: performance.now(),
                sentAt: current.sentAt ?? current.t0,
                firstLineAt: current.firstLineAt,
                lastLineAt: current.lastLineAt,
                speaking: current.pending > 0,
                quietMs: config.quietMs,
                waitMs: config.waitMs,
            });
            if (step === 'wait') return;
            if (step === 'give_up') {
                status('idle', { turnId: current.id, note: `${settings.agent} said nothing in ${Math.round(config.waitMs / 1000)} s.` });
            } else {
                current.timings.totalMs = Math.round(performance.now() - current.t0);
                socket.emit('turn_done', { turnId: current.id, timings: current.timings });
                status('idle', { turnId: current.id });
            }
            endTurn(current);
        }, TICK_MS);
    }

    // One sentence after the other, in order; an aborted turn speaks no more.
    function speakSentence(current, sentence) {
        const t = tts();
        if (!t) return;
        const { signal } = current.abort;
        current.pending++;
        current.chain = current.chain.then(async () => {
            if (signal.aborted) return;
            const ts = performance.now();
            try {
                const { samples: pcm, sampleRate } = await t.synthesize(sentence, settings);
                if (signal.aborted) return;
                if (current.seq === 0) {
                    current.timings.firstAudioMs = Math.round(performance.now() - current.t0);
                    status('speaking', { turnId: current.id });
                }
                socket.emit('audio', {
                    turnId: current.id,
                    seq: current.seq++,
                    text: sentence,
                    sampleRate,
                    ttsMs: Math.round(performance.now() - ts),
                    pcm: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength),
                });
            } catch (err) {
                if (!signal.aborted) socket.emit('error_msg', { message: `The voice failed: ${err.message}` });
            }
        }).finally(() => {
            current.pending--;
        });
    }

    // A line of a bot (bot-output). Lines of the chosen bot are spoken; in a voice turn they are its answer.
    function botLine(agentName, message) {
        if (!settings.agent || agentName !== settings.agent) return;
        const said = speechText(message);
        const now = performance.now();
        let current = turn;
        if (current && current.kind === 'voice' && current.sentAt !== null) {
            if (current.firstLineAt === null) {
                current.firstLineAt = now;
                current.timings.firstLineMs = Math.round(now - current.t0);
            }
            current.lastLineAt = now;
        }
        if (!said || !settings.speak || !tts()) return;
        if (!current || current.sentAt === null) {
            // not waiting for an answer (a typed line, or the bot speaks on its own): a turn of its own
            if (current && current.kind === 'voice') return; // the owner is being transcribed; the line is shown, not spoken
            if (!current) {
                current = newTurn('free');
                current.sentAt = now;
                current.firstLineAt = now;
                startClock(current);
            }
            current.lastLineAt = now;
        }
        for (const sentence of splitSentences(said)) speakSentence(current, sentence);
    }

    async function runTurn(samples) {
        const current = newTurn('voice');
        const { signal } = current.abort;
        const stt = engine.stt.state === 'ready' ? engine.stt.impl : null;
        if (!stt) {
            socket.emit('error_msg', { message: engine.stt.message });
            status('idle', { turnId: current.id });
            endTurn(current);
            return;
        }
        try {
            status('transcribing', { turnId: current.id });
            const text = await stt.transcribe(samples);
            current.timings.sttMs = Math.round(performance.now() - current.t0);
            if (signal.aborted) return;
            if (!text) {
                status('idle', { turnId: current.id, note: 'Heard nothing clear.' });
                endTurn(current);
                return;
            }
            socket.emit('transcript', {
                turnId: current.id, text, sttMs: current.timings.sttMs, audioSec: +(samples.length / 16000).toFixed(1),
            });
            const route = routeTranscript({ agent: settings.agent, from: settings.from, text, agents: agents() });
            if (!route.ok || !sendToAgent(settings.agent, route.data)) {
                socket.emit('error_msg', { message: route.ok ? `${settings.agent} is not in the game.` : route.text });
                status('idle', { turnId: current.id });
                endTurn(current);
                return;
            }
            current.sentAt = performance.now();
            status('thinking', { turnId: current.id });
            startClock(current);
        } catch (err) {
            if (signal.aborted) return;
            console.error('[voice] turn:', err);
            socket.emit('error_msg', { message: `whisper failed: ${err.message}` });
            status('idle', { turnId: current.id });
            endTurn(current);
        }
    }

    socket.on('settings', (s = {}) => {
        const t = tts();
        if (typeof s.voice === 'string' && (!t || t.voices.some((v) => v.id === s.voice))) settings.voice = s.voice;
        if (Number.isFinite(s.speed)) settings.speed = Math.min(2, Math.max(0.5, s.speed));
        if (typeof s.agent === 'string' || s.agent === null) {
            if (s.agent !== settings.agent) cancelTurn();
            settings.agent = s.agent;
        }
        if (typeof s.from === 'string' || s.from === null) settings.from = s.from;
        if (typeof s.speak === 'boolean') {
            settings.speak = s.speak;
            if (!s.speak && turn?.kind === 'free') cancelTurn();
        }
    });

    socket.on('utterance', (buf) => {
        // Float32 PCM, 16 kHz mono, from the browser VAD.
        try {
            const bytes = Buffer.from(buf);
            const samples = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
            runTurn(new Float32Array(samples)); // copy: socket buffers may be reused
        } catch (err) {
            socket.emit('error_msg', { message: `Bad audio: ${err.message}` });
        }
    });

    socket.on('interrupt', () => {
        cancelTurn();
        status('idle');
    });

    socket.on('preview_voice', async ({ voice } = {}) => {
        const t = tts();
        try {
            const v = t?.voices.find((x) => x.id === voice);
            if (!v) return;
            const { samples, sampleRate } = await t.synthesize(`Hi, I'm ${v.name}, a ${v.engine} voice. Want to go mining?`, { voice, speed: settings.speed });
            socket.emit('audio', { turnId: 'preview', seq: 0, sampleRate, pcm: Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength) });
        } catch (err) {
            socket.emit('error_msg', { message: err.message });
        }
    });

    socket.on('reset', () => {
        cancelTurn();
        status('idle');
    });

    return {
        socket,
        sendState,
        botLine,
        close: cancelTurn,
    };
}
