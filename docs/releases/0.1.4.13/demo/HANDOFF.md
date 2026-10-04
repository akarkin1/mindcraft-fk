# Handoff: live voice demo

Status as of 2026-10-04. Read this first, then [README.md](README.md) (setup, measurements, options).

## Goal

Talk to an LLM by voice in a browser tab, with VAD, STT and TTS running **locally** (free). This is
a **standalone trial** of the tools. The end goal is to put it into the user's Minecraft bot fork
**mindcraft-fk** (`C:\Users\alex\IdeaProjects\mindcraft-fk`, GitHub `akarkin1/mindcraft-fk`).
There, the bot starts its embedded server, the user opens a browser tab, presses **Talk / Live**,
and talks with the bot while playing. The bot will speak through the browser.

No integration with mindcraft-fk has been done yet. Doing it is a separate, later step, and only
when the user asks.

## State: working

- Built and tested on the user's laptop (Windows 11, Intel Ultra 9 285H with 16 threads,
  RTX 5070 Ti Laptop with 12 GB, Node 24 globally and Node 20 via `fnm`).
- The user has run it and is happy. They found Supertonic "much faster" than Kokoro.
- Tested here:
  - TTS → STT round trips for all engines (`npm run smoke`)
  - the full socket pipeline with a recorded utterance, using the echo bot
  - interruption (talking over the bot)
  - VAD assets loading in the browser
  - startup on Node 20
- **Not tested by Claude:**
  - a real microphone (the in-app browser pane blocks mic access)
  - the real LLM call: the user's key is in a password-protected vault
  - The user has since run it themselves, presumably with both.
- Not a git repo yet. Nothing is committed.

## Pipeline

```
browser: mic → Silero VAD v5 (onnxruntime-web WASM) → Float32 16 kHz utterance ─socket.io─┐
server:  whisper-server.exe (CUDA) → text → OpenAI stream → TextSplitterStream (sentences)  │
         → TTS per sentence → Float32 PCM chunks ─socket.io─→ browser gapless playback ◀────┘
```

| Part | Runs on | Notes |
|---|---|---|
| VAD | CPU, in the browser | `@ricky0123/vad-web` 0.0.31, served locally from node_modules (no CDN) |
| STT | GPU (CUDA) | Prebuilt `whisper-server.exe` (whisper.cpp release b5130, `cublas-12.4.0`), model `large-v3-turbo-q5_0`. Node spawns it as a child process on port 8178. |
| LLM | OpenAI | `gpt-6-luna` through Chat Completions streaming. Falls back to the offline **echo bot** when there is no key or with `OPENAI_MODEL=echo`. |
| TTS: Supertonic 3 | GPU (DirectML) | 10 voices (F1–F5, M1–M5), 44.1 kHz, 31 languages. Falls back to CPU. |
| TTS: Kokoro | CPU | 28 English voices, 24 kHz, `kokoro-js` with fp32 and 6 threads |

Voice ids are `engine:voice`, e.g. `supertonic:F1` or `kokoro:af_heart`. Both engines load at
startup, and the voice dropdown can switch between them mid-conversation.

## Files

| Path | What it does |
|---|---|
| `src/server.js` | express + socket.io; loads the engines; serves `public/` and `/vendor/{vad,ort}` |
| `src/session.js` | One conversation per socket: turns, history, cancellation, timings, voice preview |
| `src/stt.js` | Spawns and warms up `whisper-server`, encodes WAV, filters hallucinations ("thank you." etc.) |
| `src/llm.js` | OpenAI streaming, or the echo bot |
| `src/tts.js` | Kokoro + Supertonic behind one `synthesize(text, {voice, speed})`; one job at a time |
| `src/config.js` | All env options (documented in `.env.example`) |
| `src/vendor/supertonic/helper.js` | Upstream Supertonic ONNX inference (MIT, pinned commit; local change: accepts session options) |
| `public/app.js` | VAD, playback queue, ducking/interrupt, UI |
| `scripts/setup.js` | Downloads the whisper binary and model, Supertonic (pinned HF revision) and Kokoro |
| `scripts/smoke-test.js` | `npm run smoke`: end-to-end check with no mic and no LLM. Uses whisper port 8179, so it can run while the app is up. |
| `start.ps1` | Reads `OpenaiApiKey` from the PowerShell SecretStore, runs on Node 20 via fnm, clears the key afterwards |

Not in the repo (`.gitignore`): `bin/` (whisper), `models/`, `node_modules/`. Rebuild them with
`npm install && npm run setup`.

`stt.js`, `llm.js` and `tts.js` don't depend on each other or on the page. They are written to be
moved into mindcraft-fk as they are.

## Socket protocol

- Client → server:
  - `utterance` (ArrayBuffer, Float32 16 kHz)
  - `settings` `{voice, speed}`
  - `interrupt`
  - `reset`
  - `preview_voice` `{voice}`
- Server → client:
  - `hello` `{voices, ttsEngines, settings, sttBackend, llmModel}`
  - `status` `{stage: transcribing|thinking|speaking|idle}`
  - `transcript`
  - `assistant_delta`
  - `audio` `{turnId, seq, text, sampleRate, pcm}`
  - `turn_done` `{timings}`
  - `error_msg`
- A new utterance cancels the turn in progress through an AbortController. The client also drops
  audio from stale turns.

## Decisions and why (don't redo these)

- **Plain JS (ESM), not TypeScript.** mindcraft-fk is plain JS, and the user confirmed this.
- **Audio I/O in the browser, not Node.** An earlier attempt by the user
  (`..\live-speach-demo-node`) got stuck on capturing the mic in Node on Windows. The browser
  also gives echo cancellation for free.
- **Prebuilt whisper-server instead of a Node whisper binding.** Building a binding with CUDA on
  Windows is painful.
- **Kokoro thread cap of 6.** With all 16 threads it was about 5× slower: ONNX Runtime waits on
  the E-cores. fp32 measured faster than q8, q4 and fp16 on this CPU.
- **Kokoro can't use DirectML.** It fails on a `ConvTranspose` op.
- **Supertonic on DirectML device 0.** Device 0 is the RTX (confirmed with nvidia-smi). Device 1
  is the Intel Arc iGPU and about 5× slower. WebGPU isn't available in onnxruntime-node 1.21.
- **Warm-ups at startup:**
  - Whisper: the first run took about 45 s (CUDA JIT, because the CUDA 12.4 build has no
    native sm_120 kernels; the driver caches the result).
  - Supertonic: the first DirectML run is about 2× slower than later ones.
- **`onnxruntime-node` pinned to 1.21.0** to match the version `@huggingface/transformers` uses
  (deduped).
- **"Interrupt by voice" checkbox.** When off, mic input is ignored while the bot speaks, so it
  can't hear itself through speakers. The user said that's fine as a setting.

## Numbers (from `npm run smoke`, Turbo power mode)

| Stage | Time |
|---|---|
| Whisper, per 1–5 s clip | ~100–270 ms |
| Supertonic GPU, per sentence | ~0.55–0.7 s |
| Kokoro CPU, per sentence | ~0.25–1.3 s, depending on length |
| End of speech → first audio | ~1.35 s with the echo bot; with the real LLM, add its time to the first full sentence |

Laptop power mode matters: the user's "Silent" plan throttles the CPU. They switched to Turbo.

## About the user

- Secrets live in a **PowerShell SecretStore vault that needs a password**. Never try to unlock or
  read it. The user runs `start.ps1` themselves.
- They are fine with Claude working without asking permission on this demo.
- mindcraft-fk runs on **Node 20** (via `fnm`), and its `start-gpt.ps1` uses the same vault
  pattern. Keep the code compatible with Node 20.

## Possible next steps (none are requested yet)

1. Option to skip loading Kokoro (saves RAM and startup time) and/or make Supertonic the default
   voice. Today the default is `kokoro:af_heart`; it can be overridden with
   `TTS_VOICE=supertonic:F1`.
2. Try `SUPERTONIC_STEPS` below 8 to cut latency on short replies. Not measured yet.
3. Lower time-to-first-audio: split the first chunk at a comma, or warm up the LLM connection.
4. Non-English: Supertonic supports `ru`, and Whisper takes `WHISPER_LANGUAGE=auto`/`ru`. Kokoro
   (via kokoro-js) is English only.
5. **Integrate into mindcraft-fk.** Reuse its existing express/socket.io server and send the
   transcribed text into the bot's chat/command pipeline instead of `llm.js`. The bot's replies
   then go through `tts.js` to the browser. Check how mindcraft-fk's server and agent messaging
   are structured first.

## Pitfalls hit

- `spawn UNKNOWN` the first time `whisper-server.exe` was run from Node, right after extraction.
  It was most likely Defender scanning the new exe; it worked on retry.
- The `phonemizer` package (a Kokoro dependency) installs global `uncaughtException` and
  `unhandledRejection` handlers. A crash then prints the whole minified file. Filter the output
  to see the real error.
- If whisper's port is busy at startup, `stt.js` throws a clear error. The cause may be the
  **user's own running app**, not a leftover process, so check before killing anything.
