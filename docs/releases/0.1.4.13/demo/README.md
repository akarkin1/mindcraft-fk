# Live Voice Demo

Talk to an LLM by voice from a browser tab. Everything except the LLM runs locally:

```
browser                                   node server
───────                                   ───────────
mic → Silero VAD (WASM) ──utterance──▶  whisper.cpp (CUDA)  → text
                                          LLM (OpenAI, streamed)
speaker ◀──────────audio chunks───────  sentence splitter → Kokoro (CPU) / Supertonic (GPU)
```

- **VAD** runs in the browser, so talking over the bot interrupts it instantly.
- **STT** is the prebuilt `whisper-server.exe` (whisper.cpp, CUDA build), started and stopped by Node.
- **TTS** has two engines with 38 voices to compare: Kokoro (28 English voices) and Supertonic 3
  (10 voices, 31 languages). Voices can be switched mid-conversation.
- The LLM reply is streamed and spoken sentence by sentence.

Plain JavaScript (ESM), works on Node 20+, same `express` + `socket.io` stack as mindcraft-fk.

## Setup (once)

```bash
npm install
npm run setup          # ~1.6 GB: whisper.cpp CUDA build, Whisper model, Supertonic, Kokoro
```

`npm run setup -- --cpu` downloads the CPU-only whisper build instead.

## Run

```powershell
.\start.ps1            # reads OpenaiApiKey from the PowerShell secret vault (PS 7+)
```

Then open http://localhost:3000 (it opens automatically), click **Talk / Live**, and talk.
A ~0.7 s pause ends your turn.

Without an API key (`npm start`), the app runs an offline **echo bot** that repeats what it heard.
Use it to try voices and STT for free.

Options are listed in [.env.example](.env.example).

`npm run smoke` checks the pipeline without a mic or LLM: each voice speaks a few sentences and
Whisper transcribes them back, with timings. It can run while the app is up.

## Measured on this laptop (Ultra 9 285H, RTX 5070 Ti Laptop)

| Stage | Time |
|---|---|
| Whisper large-v3-turbo (q5_0) on GPU, 4 s clip | ~110–270 ms |
| Kokoro fp32 on CPU, 4–5 s sentence | ~0.9–1.35 s (≈0.2–0.3× real time) |
| Supertonic 3 on GPU (DirectML), any sentence | ~0.55–0.65 s (≈0.13× real time on long ones) |
| Supertonic 3 on CPU (`SUPERTONIC_GPU=false`), 4–5 s sentence | ~1.0–1.6 s |
| End of speech → first audio (echo bot) | ~1.35 s, plus the LLM's time to first sentence |

Resources: Whisper ~1–1.5 GB VRAM (busy only for a moment per utterance), Supertonic ~10–20 % GPU
for under a second per sentence, Kokoro a few CPU cores during speech, VAD ~1–2 % of one core in
the browser.

## Notes / gotchas

- **First start after setup** takes ~45 s longer: the driver JIT-compiles the CUDA kernels
  (the CUDA 12.4 build has no native RTX 50xx kernels). The result is cached by the driver.
- **Thread count matters.** With all 16 threads, ONNX Runtime waits on the E-cores and Kokoro is ~5×
  slower. 6 threads is the default.
- **Echo:** with speakers, the bot can hear itself. Untick *Interrupt by voice* (mic input is then
  ignored while the bot talks), or use headphones.
- **GPU for TTS:** Supertonic runs on the GPU through DirectML (falls back to CPU if that fails).
  Kokoro can't: DirectML fails on one of its ops (`ConvTranspose`), so Kokoro stays on the CPU.
- **DirectML device order:** on this laptop, adapter 0 is the RTX and 1 is the Intel Arc iGPU
  (5× slower). If Supertonic ever gets slow, try `SUPERTONIC_DML_DEVICE=1`.

## Layout

```
src/server.js      express + socket.io, loads the engines
src/session.js     one conversation per browser tab: STT → LLM → TTS, interruption
src/stt.js         whisper-server child process + WAV encoding
src/llm.js         OpenAI streaming (or the offline echo bot)
src/tts.js         Kokoro + Supertonic behind one interface
src/vendor/supertonic/helper.js   upstream Supertonic ONNX inference (MIT)
public/            the page: VAD, playback queue, voice picker
scripts/setup.js   downloads binaries and models
```

`stt.js`, `llm.js` and `tts.js` don't depend on each other or on the page, so they can be moved into
mindcraft-fk's server as they are.
