# Handoff: speaking live with the bot through the browser (v0.1.4.13, the voice demo)

For a Claude Code session on the owner's machine. Written by the tech lead in the cloud on 2026-10-03, after the
release of v0.1.4.12. Read `CLAUDE.md` first; its rules hold here word for word. The demo's own docs are beside this
file: `demo/HANDOFF.md` and `demo/README.md` (copies of 2026-10-04); where they and this handoff disagree, they win.

## The ask, in the owner's words

"The feature is speaking live with the bot through a browser window. Another session has completed the demo, and it
works great. The bot already runs a local http server and opens it at startup; we are going to use the same server and
browser window (you will need to clean the UI a bit to keep both the chat and the live button). I like the design of the
demo more than the original design of the bot server, so my preference is to make it look in a similar way. I almost
never use the browser tool, so you are free to improvise here, but make it simple, usable, without functionality
degradation. We ended up choosing Supertonic for TTS and whisper for STT. Both are supposed to run on our GPU. The demo
project weighs 2.5 GB (CUDA, DLLs), so it stays on the machine. You do not need to test it much: the owner and Opus 5.5
tested the demo."

A separate branch, to ship with v0.1.4.13: `release/v0.1.4.13-voice` (this branch, from `main` at v0.1.4.12).

## What exists today

| Thing | Where | What it does |
|---|---|---|
| The mindserver | `src/mindcraft/mindserver.js`, socket.io on `settings.mindserver_port` (8080) | the agents connect to it; the page gets `agents-status`, `bot-output` (every line the bot says, `sendOutputToServer` of `src/agent/mindserver_proxy.js`), `state-update`; the page sends `send-message { from, message }`, which reaches `agent.respondFunc(from, message)` in the agent: the same path as a chat line typed in the game |
| The page | `src/mindcraft/public/index.html`, one file of 965 lines (markup, style, script) | agent cards with start, stop, restart, settings (a modal over `settings_spec.json`), the inventory view, the chat input per agent (`sendMessage`), the create-agent modal (profile upload), disconnect all, full shutdown; opened at the start by `src/mindcraft/mindcraft.js` `init(..., auto_open_ui)` |
| Text to speech of the original project | `settings.speak` (true in the owner's settings), `speak_model: "system"` in both profiles, `src/agent/speak.js` | the system voice of Windows speaks every line; `gpt` and `gemini` TTS configs exist in `src/models` |
| The watch server of v0.1.4.12 | `src/agent/watch/`, 127.0.0.1:8090 | for a Claude session, not for the page; leave it alone |
| The launch scripts | `start-claude.ps1`, `start-gpt.ps1` | keys and the watch token from the vault; `fnm` with Node 20 |

Who speaks to the bot: the page sends `from`; the bot answers the owner only when `only_chat_with` names them (the
owner's settings: `["MartyByrde2"]` for two bots). The live voice must speak as the owner: `from` = the first name of
`only_chat_with`, else a name the page asks once and keeps in `localStorage`.

## The demo, as its own HANDOFF.md and README.md describe it (2026-10-04)

The demo is plain JavaScript (ESM), `express` + `socket.io`, Node 20: the same stack as this fork. Nothing of it is
Python. It is not a git repository; nothing is committed. Its own docs win over this handoff where they disagree.

```
browser: mic → Silero VAD v5 (onnxruntime-web WASM) → Float32 16 kHz utterance ─socket.io─┐
server:  whisper-server.exe (CUDA, a child process on port 8178) → text → LLM stream → sentences
         → TTS per sentence → Float32 PCM chunks ─socket.io─→ browser gapless playback ◀────┘
```

| Part of the demo | What it is | Into the fork |
|---|---|---|
| `src/stt.js` | spawns and warms up `whisper-server.exe` (whisper.cpp b5130, cublas 12.4, model `large-v3-turbo-q5_0`), encodes WAV, filters hallucinations | as it is, into `src/mindcraft/voice/stt.js` |
| `src/tts.js`, `src/vendor/supertonic/helper.js` | Supertonic 3 on the GPU through DirectML (device 0 is the RTX), 10 voices, 44.1 kHz; Kokoro on the CPU; `synthesize(text, { voice, speed })`, one job at a time | as they are, into `src/mindcraft/voice/`; the owner chose Supertonic: load Kokoro only when its voice is asked for (the demo's next step 1), default voice `supertonic:F1` |
| `src/llm.js`, the echo bot | OpenAI streaming or an offline echo | not needed: the bot is the LLM. Keep the echo only inside the smoke test |
| `src/session.js` | one conversation per socket: turns, history, cancellation, timings, voice preview | the turn model changes (below); keep the cancellation, the timings and the preview |
| `src/server.js` | express + socket.io, loads the engines, serves `public/` and `/vendor/{vad,ort}` from node_modules (no CDN) | folds into `src/mindcraft/mindserver.js`: the same server, the same port 8080, the vendor routes added |
| `public/app.js` and the page | VAD, the playback queue, ducking and interrupt, the voice dropdown, "Interrupt by voice", the Talk / Live button | the design the owner wants; merged with the fork's page (below) |
| `scripts/setup.js` | downloads the whisper binary and model, Supertonic (pinned HF revision) and Kokoro, about 1.6 GB, into `bin/` and `models/` | `scripts/voice_setup.js`, `npm run voice:setup`; `bin/` and `models/` in `.gitignore` as in the demo |
| `scripts/smoke-test.js` | `npm run smoke`: TTS to STT round trips without a mic or an LLM, whisper on port 8179 so it runs beside the app | `scripts/voice_smoke.js`, `npm run voice:smoke` |
| `start.ps1`, `.env.example` | the key from the SecretStore, Node 20 via fnm; every option as an env variable | no separate start script: the mindserver starts whisper itself when `voice_ui` is on; the options become settings (below) or stay env variables with the demo's names |

Dependencies the demo adds, pinned: `@ricky0123/vad-web` 0.0.31, `onnxruntime-web`, `onnxruntime-node` 1.21.0 (pinned to
match `@huggingface/transformers`), `kokoro-js` (optional). They go into `package.json` pinned; a new dependency is not a
bump of a pinned one, but it needs the owner's play test like one.

Decisions of the demo that stay (its HANDOFF says "don't redo these"): plain JS; audio in the browser, not in Node; the
prebuilt whisper-server, not a binding; Kokoro at 6 threads, fp32, CPU only; Supertonic on DirectML device 0; the
warm-ups at startup (whisper's first run about 45 s on an RTX 50xx, cached by the driver); "Interrupt by voice" as a
checkbox. Its socket protocol (`utterance`, `settings`, `interrupt`, `reset`, `preview_voice`; `hello`, `status`,
`transcript`, `assistant_delta`, `audio`, `turn_done`, `error_msg`) is kept word for word where it still applies.

## What to build

1. **The page, in the demo's design.** The demo's page and the fork's page become one, under `src/mindcraft/public/`,
   served by the mindserver on 8080 as today, no build step, no CDN (the VAD and ORT files from node_modules as the
   demo serves them). The conversation first: the chat of one bot (the owner's lines, the recognised speech as the
   owner's line, the bot's lines from `bot-output`), the text input, the Talk / Live button beside it, the voice
   dropdown and "Interrupt by voice" as the demo has them. Every control of the fork's page stays reachable (start,
   stop, restart, the settings modal over `settings_spec.json`, create agent with the profile upload, the inventory,
   disconnect all, full shutdown), folded behind one control. One file or three (`index.html`, `app.js`, `style.css`),
   your choice.
2. **The turn.** The demo streams an LLM; the bot answers through its own chat pipeline. So: `utterance` → `stt.js` →
   `transcript` to the page and the text down the fork's `send-message { from, message }` path with the owner's name,
   exactly as a typed line (the bot cannot tell the difference). `status` goes `transcribing` → `thinking`; the bot's
   next `bot-output` lines of that bot are the answer: each line through the sentence splitter and `tts.js` to `audio`
   chunks as the demo does, `status: speaking`, then `idle` and `turn_done` with the timings when the bot has said
   nothing for 2 s. A line that starts with `!` or `*` (a command echo), or a line of a result block (`Action output:`,
   `Found non-destructive path.`, `You have reached`), is shown but not spoken. A new utterance interrupts the
   playback as in the demo; the bot's own processing cannot be aborted, which the notes say.
3. **The system voice.** With `voice_ui` on the page speaks and the agent's `speak()` of `src/agent/speak.js` returns
   at once, so no line is spoken twice; with `voice_ui` off nothing changes (`settings.speak` and `speak_model` as
   today). The profiles stay as they are.
4. **Starting and stopping.** With `voice_ui` on the mindserver starts `whisper-server.exe` as the demo's `stt.js` does
   when the first page connects (or at its own start; your choice, say which), warms up whisper and Supertonic, and
   stops the child on shutdown. If the binaries or the models are missing, the page says so with the setup command,
   and the bot plays on without voice. If whisper's port is busy, the error names the port and never kills anything.
5. **Settings, off by default**, in `settings.js` and `src/mindcraft/public/settings_spec.json`, after `bot_role`:
   `voice_ui` (false), `voice_voice` (`"supertonic:F1"`), `voice_language` (`"en"`; whisper takes `auto` or `ru`,
   Supertonic speaks 31 languages, Kokoro English only). The rest of the demo's options stay env variables with the
   demo's names, documented in the README of the tests or `docs/releases/0.1.4.13/VOICE.md`. With `voice_ui` off the
   page shows no live button, loads no engine and starts no child; the bot behaves as before. The look of the page is
   not bot behaviour and needs no switch.
6. **Texts** in the page, short and plain, with numbers where there are any: "Listening...", "Heard: ...",
   "Thinking...", "The voice is off: set voice_ui in settings.js.", "whisper is not installed: run npm run voice:setup
   (about 1.6 GB).", "whisper's port 8178 is busy." Never a claim the code did not check.

## What not to change

- `src/agent/library/skills.js` signatures, the profiles' voice (`profiles/claude.json`), anything under `bots/`,
  `keys.json` (never read it), the watch server, the packs.
- `settings.js` is edited by the owner; add the three keys only, in the style of the others.
- Line endings: the owner's checkout has CRLF; keep the endings of every file you touch (`file` before and after).
- Node: `fnm exec --using=v20.20.2 -- node ...`; `npm` is `npm.cmd`.

## Tests

The owner asked for little testing: the demo was tested by him and by Opus 5.5. What must still hold:

- `npm test` stays green (it has source checks: the settings style, `glue2_flags_off`, the prompt size). New pure
  logic (the routing of a recognised line to `send-message`, the mute rule, the `!` rule, the URL settings) gets unit
  tests in `tests/unit/vo_*.test.js`, node:test, no network, no audio.
- `npm run voice:smoke` (the demo's round trips, TTS to STT, without a mic or the bot) passes on the owner's machine.
- A manual list in `docs/releases/0.1.4.13/VOICE.md`: open the page, start a bot, type a line, press Talk / Live, say a
  line, see "Heard: ...", hear the answer, the system voice silent meanwhile, interrupt the bot by talking, the settings
  modal still works, create agent still works, `voice_ui` off hides the button and starts no child.

## Handing back

- Commit on this branch with clear messages; push with `git push -u origin release/v0.1.4.13-voice`. Never `main`.
- Write `docs/releases/0.1.4.13/VOICE.md`: what was built, the services and how they run, the ports, the settings,
  the manual list with its results, what was left out and why, and anything the demo did that this build does not.
- The cloud session (the tech lead) folds the branch into v0.1.4.13 with the routines, through the usual gate.

## Open questions for the demo

The demo's docs answer most of them (the numbers: whisper 100 to 270 ms per clip, Supertonic 0.55 to 0.7 s per sentence,
end of speech to first audio about 1.35 s plus the bot's time). Left for `VOICE.md`: where `bin/` and `models/` live in
the fork's checkout (the demo keeps them in the project, ignored by git; the same here, or `%LOCALAPPDATA%\\Mindcraft\\voice`
with a path setting), whether whisper starts with the mindserver or with the first page, how the two-bot case picks the
bot that speaks (the chat of one bot at a time; the dropdown of agents), and what of the demo's page was dropped.
