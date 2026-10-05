// The live voice of the mindserver (v0.1.4.13, voice_ui). Loaded by mindserver.js with import() only when voice_ui
// is on. One session per page that sends voice-join:
//   utterance (16 kHz PCM) -> whisper -> transcript to the page, and the text to the bot down send-message as a
//   line of the owner -> the bot's next lines (bot-output) -> sentences -> Supertonic -> audio chunks to the page.
// The socket protocol is the demo's: utterance, settings, interrupt, reset, preview_voice; hello, status,
// transcript, audio, turn_done, error_msg. Added: voice-join and voice-config (the state of the engines).
// The bot's own work cannot be stopped from here; a new utterance stops only the speaking.
// v0.1.4.13 (part N2, spec 4.5): one speech queue for every speaker, one line at a time: the lines of every bot, each
// in its own voice (settings.voices from the page: voice_voice, or the page's choice), and the supervisor's lines
// (bot-output of SUPERVISOR_OUTPUT, or a bot line `[<supervisor_name>] ...`) in supervisor_voice (the voice the line
// came with, else the page's, else config.supervisorVoice); a bot's line
// first, then the supervisor's answer, then its update (nextSpeech of chat_logic.js); an update that waited over
// 20 s is not spoken; the owner's speech interrupts everything. The next line is taken shortly before the audio sent
// so far ends on the page. A recognised line goes where routeLine says: the chosen bot with its name in front, or
// every bot plain with "everyone" (settings.agent EVERYONE).
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { voiceConfig, splitSentences, routeTranscript, turnStep, problemText } from './voice_logic.js';
import { chatEntry, nextSpeech, routeLine, speechItem } from '../public/chat_logic.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TICK_MS = 250;
const LEAD_MS = 300; // the next line of the queue is made this long before the page has played the last one

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

/**
 * One page that joined the voice (exported for the tests of the speech queue, v0.1.4.13 part N2).
 * @param {{on: Function, emit: Function}} socket
 * @param {{engine: object, config: object, publicState: () => object, sendToAgent: (name: string, data: object) => boolean,
 *          agents: () => {name: string, in_game: boolean}[]}} ctx
 */
export function createSession(socket, { engine, config, publicState, sendToAgent, agents }) {
    // voices: the voice of each bot (the page sends it); supervisor, supervisorVoice: supervisor_name and
    // supervisor_voice as the page knows them (v0.1.4.13, part N2); agent: a bot, or EVERYONE
    const settings = { voice: null, speed: 1, agent: null, from: null, speak: true, voices: {}, supervisor: null, supervisorVoice: null };
    let turn = null; // { id, kind: 'voice', abort, t0, sentAt, firstLineAt, lastLineAt, pending, seq, timings, targets }
    let nextTurnId = 1;
    let clock = null;
    let helloSent = false;
    // the one speech queue (part N2): the lines waiting, the line being made, when the audio sent so far ends
    const waiting = [];
    let lineSeq = 0;
    let making = false;
    let playedUntil = 0;
    let pumpTimer = null;
    let epoch = 0; // a new epoch after an interrupt: the audio of the lines of the old one is stale on the page
    let freeSeq = 0;

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

    // The owner's speech interrupts everything: the lines waiting go, the line being made stops.
    function silence() {
        epoch++;
        waiting.length = 0;
        playedUntil = 0;
        if (pumpTimer) clearTimeout(pumpTimer);
        pumpTimer = null;
    }

    function cancelTurn() {
        silence();
        if (!turn) return;
        turn.abort.abort();
        endTurn(turn);
    }

    function newTurn(kind) {
        cancelTurn();
        turn = {
            id: nextTurnId++,
            kind,
            abort: new AbortController(),
            t0: performance.now(),
            sentAt: null,
            firstLineAt: null,
            lastLineAt: null,
            pending: 0,
            seq: 0,
            timings: {},
            targets: [],
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
                const who = current.targets.length === 1 ? current.targets[0] : 'Nobody';
                status('idle', { turnId: current.id, note: `${who} said nothing in ${Math.round(config.waitMs / 1000)} s.` });
            } else {
                current.timings.totalMs = Math.round(performance.now() - current.t0);
                socket.emit('turn_done', { turnId: current.id, timings: current.timings });
                status('idle', { turnId: current.id });
            }
            endTurn(current);
        }, TICK_MS);
    }

    const voiceOf = (t, id) => (typeof id === 'string' && t.voices.some((v) => v.id === id) ? id : (settings.voice ?? t.defaultVoice));

    // One line of the queue: its sentences one after the other in its speaker's voice; stops when the owner speaks.
    async function speakLine(t, item) {
        const mine = epoch;
        const current = item.turn;
        const turnId = current ? current.id : `line-${mine}`;
        const voice = voiceOf(t, item.voice);
        for (const sentence of splitSentences(item.text)) {
            if (mine !== epoch || current?.abort.signal.aborted) return;
            const ts = performance.now();
            try {
                const { samples: pcm, sampleRate } = await t.synthesize(sentence, { voice, speed: settings.speed });
                if (mine !== epoch || current?.abort.signal.aborted) return;
                if (current && current.seq === 0) {
                    current.timings.firstAudioMs = Math.round(performance.now() - current.t0);
                    status('speaking', { turnId });
                }
                socket.emit('audio', {
                    turnId,
                    seq: current ? current.seq++ : freeSeq++,
                    text: sentence,
                    speaker: item.speaker,
                    sampleRate,
                    ttsMs: Math.round(performance.now() - ts),
                    pcm: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength),
                });
                const ms = sampleRate > 0 ? (pcm.length / sampleRate) * 1000 : 0;
                playedUntil = Math.max(playedUntil, performance.now()) + ms;
            } catch (err) {
                if (mine === epoch) socket.emit('error_msg', { message: `The voice failed: ${err.message}` });
            }
        }
    }

    // Takes the next line of the queue when the page has (nearly) played the last one: one line at a time.
    function pump() {
        if (making) return;
        const t = tts();
        if (!t) {
            for (const item of waiting.splice(0)) if (item.turn) item.turn.pending--;
            return;
        }
        const now = performance.now();
        if (playedUntil - now > LEAD_MS) {
            if (!pumpTimer) pumpTimer = setTimeout(() => { pumpTimer = null; pump(); }, playedUntil - now - LEAD_MS);
            return;
        }
        const { next, rest, dropped } = nextSpeech(waiting, now);
        for (const item of dropped) if (item.turn) item.turn.pending--;
        waiting.splice(0, waiting.length, ...rest);
        if (!next) return;
        making = true;
        speakLine(t, next).finally(() => {
            making = false;
            if (next.turn) next.turn.pending--;
            pump();
        });
    }

    // A line of a bot or of the supervisor (bot-output). Every speaker goes into the one queue; in a voice turn the
    // lines of the bots it was sent to are its answer.
    function botLine(agentName, message) {
        const entry = chatEntry(agentName, message, settings.supervisor ?? '');
        if (!entry || (entry.kind !== 'bot' && entry.kind !== 'supervisor' && entry.kind !== 'command')) return;
        const now = performance.now();
        const current = turn;
        const answers = Boolean(current && current.sentAt !== null && entry.kind !== 'supervisor' && current.targets.includes(agentName));
        if (answers) {
            if (current.firstLineAt === null) {
                current.firstLineAt = now;
                current.timings.firstLineMs = Math.round(now - current.t0);
            }
            current.lastLineAt = now;
        }
        if (!settings.speak || !tts()) return;
        if (current && current.sentAt === null) return; // the owner is being transcribed; the line is shown, not spoken
        const item = speechItem(entry, {
            at: now, seq: lineSeq++, voices: settings.voices, supervisorVoice: settings.supervisorVoice ?? config.supervisorVoice, fallback: settings.voice,
        });
        if (!item) return;
        item.turn = answers ? current : null;
        if (item.turn) item.turn.pending++;
        waiting.push(item);
        pump();
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
            // where the line goes and how it reads: the chosen bot's name in front, or every bot with "everyone"
            const known = agents();
            const line = routeLine({ selected: settings.agent, text, agents: known, supervisor: settings.supervisor ?? '' });
            socket.emit('transcript', {
                turnId: current.id, text, sent: line.ok ? line.message : null, to: line.ok ? line.targets : [],
                sttMs: current.timings.sttMs, audioSec: +(samples.length / 16000).toFixed(1),
            });
            let problem = line.ok ? null : line.text;
            for (const target of line.ok ? line.targets : []) {
                const route = routeTranscript({ agent: target, from: settings.from, text: line.message, agents: known });
                if (!route.ok) { problem = route.text; continue; }
                if (sendToAgent(target, route.data)) current.targets.push(target);
                else problem = `${target} is not in the game.`;
            }
            if (current.targets.length === 0) {
                socket.emit('error_msg', { message: problem ?? 'No bot is chosen.' });
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

    const voiceTable = (value) => {
        const out = {};
        if (value && typeof value === 'object')
            for (const [name, voice] of Object.entries(value)) if (typeof voice === 'string') out[name] = voice;
        return out;
    };

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
            if (!s.speak) silence();
        }
        if (s.voices !== undefined) settings.voices = voiceTable(s.voices);
        if (typeof s.supervisor === 'string' || s.supervisor === null) settings.supervisor = s.supervisor;
        if (typeof s.supervisorVoice === 'string' || s.supervisorVoice === null) settings.supervisorVoice = s.supervisorVoice;
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
