# The live voice (v0.1.4.13, branch `release/v0.1.4.13-voice`)

Built on 2026-10-04 by a local session on the owner's machine, from `HANDOFF-voice.md` and the demo's own docs
(`demo/HANDOFF.md`, `demo/README.md`). Commit `80f1f69` holds the code and the tests; this file is the hand-back.

## What was built

You talk with the bot in the page of the mindserver (http://localhost:8080, opened at the start as before). One page,
in the demo's design (light and dark, one column of 760 px):

- **The header**: the bot you talk with (a dropdown when there are two), the stage (`online`, `live`, `listening`,
  `transcribing`, `thinking`, `speaking`, `idle`, `offline`) and the **Agents** button.
- **The bot line**: the chosen bot's state (in the game, its action, health, hunger, position), **Stop action** and
  **Clear** (clears this page's chat; the bot keeps its memory).
- **The voice controls** (only with `voice_ui`): the voice dropdown with ▶ to hear it, the speed, **Interrupt by
  voice**, **Speak the bot's lines** (new: off mutes the page's voice).
- **The chat**: your typed lines and your recognised speech on the right, the bot's lines on the left; a command, its
  echo or a result block (`!x`, `*x used y*`, `Action output:`, `Found ... path.`, `You have reached`) in small grey
  type.
- **The input** at the bottom, **Send**, and **Talk / Live** beside it (only with `voice_ui`). Above it a status
  line: `Listening...`, `Transcribing...`, `Heard: "..." Thinking...`, the setup texts.
- **The Agents drawer** holds everything the old page had: per agent the stats, the inventory, the viewer
  (`render_bot_view`), **Chat** (talk with this one), **Settings** (the modal over `settings_spec.json`),
  **Stop action**, **Stay still**, **Restart**, **Connect** or **Disconnect**, **Remove**; below them **New agent**
  (the create modal with the profile upload), **Disconnect all agents**, **Full shutdown**.

### The turn

1. The browser's Silero VAD cuts your speech (a pause of 0.7 s ends it) and sends 16 kHz audio (`utterance`).
2. whisper-server writes it down; the page shows it as your line (`spoken, 2.8 s · whisper 104 ms`).
3. The text goes down `send-message { from, message }`, exactly as a typed line. `from` is the first name of
   `only_chat_with` (`MartyByrde2`), else a name the page asks once and keeps in the browser.
4. The bot's next lines (`bot-output`) are its answer: each speakable line is cut into sentences and spoken by
   Supertonic; the part of a line before a command is spoken (`Sure! !collectBlocks(...)` says "Sure!").
5. When the bot has said nothing for 2 s and every sentence is out, the turn is done (`turn_done`, the timings
   under your line: first line, first audio). With no line in 90 s: `Claude said nothing in 90 s.`

Lines the bot says outside a voice turn (an answer to a typed line, a line of its own) are spoken too, while the
page is open and **Speak the bot's lines** is on. Talking over the bot stops the page's speaking at once; the bot's
own work cannot be stopped from the page (as the handoff says).

### Changes outside the page

- `src/agent/speak.js`: `speak()` returns at once with `voice_ui` on (`systemVoiceMuted`), so no line is spoken
  twice. With `voice_ui` off nothing changes.
- `src/agent/agent.js` `openChat`: with `only_chat_with` set, the bot whispered and **never sent its line to the
  page** (the old page showed no last message in the owner's setup, and the voice would have heard nothing). The line
  now also goes to the mindserver as `bot-output`, after the whispers, inside `try`. This is a correction without a
  switch; it changes only what the page shows.
- The old page sent typed lines and its buttons as `ADMIN`, which `shouldAnswer` drops when `only_chat_with` is set:
  **Stop action** and **Stay still** never reached the bot in the owner's setup. The page now sends as the owner.
- `mindserver.js`: `createMindServer(host_public, port, voice_options)`, `sendToAgent`, the events `voice-join` and
  `voice-config`, `voice.onBotOutput`, `voice.close()` on shutdown, `getVoice()`. `mindcraft.js` `init(...,
  voice_options)`, `main.js` passes the three settings.

## The services and how they run

| Part | Where | Runs on | Port |
|---|---|---|---|
| The page, the VAD | the browser | CPU (WASM) | 8080 (the mindserver) |
| `/vendor/vad`, `/vendor/ort` | `node_modules/@ricky0123/vad-web/dist`, `node_modules/onnxruntime-web/dist`, served by the mindserver | | 8080 |
| whisper-server.exe (whisper.cpp b5130, cublas 12.4, `large-v3-turbo-q5_0`) | a child of the mindserver | CUDA | 127.0.0.1:8178 |
| Supertonic 3 (10 voices, 44.1 kHz) | inside the mindserver | DirectML device 0 | |
| Kokoro | inside the mindserver, only when a `kokoro:` voice is asked for | CPU | |

**Start**: whisper and Supertonic start **with the mindserver**, not with the first page: the warm-ups take 2 to 8 s
(45 s on the first run after a driver change), and the page opens 3 s after the start. The page shows
`Starting whisper...` meanwhile. **Stop**: the child is stopped on Full shutdown, on the exit of the process, and on
Ctrl+C or the closing of the console (a handler for SIGINT, SIGTERM and SIGHUP, only with `voice_ui`).
**Problems** are said in the page and the bot plays on: `whisper is not installed: run npm run voice:setup (about 1.6
GB).`, `Supertonic is not installed: ...`, `whisper's port 8178 is busy.` (a free-port probe; nothing is ever
killed), `The voice packages are missing: run npm install.`, `whisper stopped. Restart the bot to listen again.`

**Where `bin/` and `models/` live**: outside the checkout, in `%LOCALAPPDATA%\Mindcraft\voice` (as the test server),
`~/.local/share/mindcraft/voice` elsewhere, or the folder `MC_VOICE_DIR` names. So git never sees the 2.1 GB (the CUDA
DLLs alone are 1.2 GB). `.gitignore` also ignores `/bin/`, `/models/`, `*.dll`, `*.onnx`, `ggml-*.bin` in case a
copy lands in the checkout.

`npm run voice:setup` downloads them (`-- --cpu` for the CPU build of whisper, `-- --kokoro` for the Kokoro model);
`npm run voice:setup -- --from <demo folder>` copies the demo's `bin/` and `models/` instead. On the owner's machine
it was run with `--from C:\Users\alex\IdeaProjects\live-speach-demo-node-2`; the folder is ready.

## The settings

In `settings.js` and `settings_spec.json`, after `bot_role`:

| Setting | Default | What |
|---|---|---|
| `voice_ui` | `false` | the live voice of the page; read when the mindserver starts |
| `voice_voice` | `"supertonic:F1"` | the bot's voice: `supertonic:F1` to `F5`, `M1` to `M5`; `kokoro:af_heart` needs `npm install --no-save kokoro-js@1.2.1` |
| `voice_language` | `"en"` | the language whisper hears (`auto` for any, `ru` ...) and Supertonic speaks (English when it lacks it) |

The demo's other options stay environment variables with the demo's names: `WHISPER_MODEL`, `WHISPER_PORT`,
`WHISPER_GPU`, `WHISPER_THREADS`, `SUPERTONIC_LANG`, `SUPERTONIC_STEPS`, `SUPERTONIC_GPU`, `SUPERTONIC_DML_DEVICE`,
`SUPERTONIC_THREADS`, `KOKORO_DTYPE`, `KOKORO_THREADS`. New ones: `MC_VOICE_DIR` (the folder), `VOICE_KOKORO=true`
(load Kokoro for the dropdown), `VOICE_QUIET_MS` (2000, the quiet that ends a turn), `VOICE_WAIT_SECONDS` (90).
`TTS_VOICE` and `WHISPER_LANGUAGE` of the demo are replaced by `voice_voice` and `voice_language`.

Dependencies, pinned: `@ricky0123/vad-web` 0.0.31, `onnxruntime-web` 1.30.0, `onnxruntime-node` 1.21.0 (25 packages
added; no installed package changed version). `kokoro-js` is **not** a dependency: it pulls `@huggingface/transformers`
(about 1 GB in the demo), and the owner chose Supertonic. They need the owner's play test like a bump.

## The tests and their results

| What | Result |
|---|---|
| `tests/unit/vo_*.test.js`, 5 files, 74 tests: the `!` rule, the owner's name, the config and the env variables, the sentences, the routing of a recognised line, the end of a turn, the texts, the settings, the mute rule, a real mindserver with `voice_ui` off and on with an empty voice folder | 74 of 74 |
| `npm test`, Node 20.20.2, a fresh install in a worktree | 7795 of 7804, 7 fail, 2 skipped. The same 6 fail on `main` (46fed13): `settings.js` and `settings_spec.json` keep LF (this checkout has CRLF), `locateServer` twice and the broken download of `rt_test_server` / `rte_get_test_server` (the environment of this machine), the `watch_and_learn` style check of `wb_commands`. The seventh, `Windows: %LOCALAPPDATA%\Mindcraft\test-server as before`, passes alone on both commits: flaky under load |
| `npm run voice:smoke` on the owner's machine | whisper on CUDA GPU (98 to 142 ms per clip), Supertonic on the GPU (0.22 to 0.83 s per sentence), every line came back as text |

### The manual list

Run by this session with a mindserver on port 8085 (not the owner's world), a fake bot that answers every line of
`MartyByrde2`, and the built-in browser of the desktop app. The browser pane gives no microphone, so speech was sent
by a script: Supertonic M2 spoke "Please collect ten oak logs for the house." and the 16 kHz audio went in as an
`utterance`.

| Step | Result |
|---|---|
| Open the page | OK, no console error; `Voice: whisper on CUDA GPU · Supertonic (GPU)` |
| A bot in the game | OK: the bot line, the dropdown, the drawer card with the stats from `state-update` |
| Type a line | OK: sent as `MartyByrde2`, the answer shown, the command and the result in small type, the stage went to `speaking` |
| Press Talk / Live, say a line | **Not run** (no microphone in the pane). The utterance by script: `transcribing` → transcript `Please collect 10 oak logs for the house.` in 104 ms → `thinking` → the fake bot got it from `MartyByrde2` |
| See "Heard: ..." | the page sets it on `transcript`; seen only through the script's events |
| Hear the answer | **Not heard** by this session. Audio chunks came back: 3 sentences, 44.1 kHz, first audio 1.6 s after the end of speech; the command and `Action output:` not spoken |
| The system voice silent meanwhile | unit test (`vo_mute`): `speak()` starts nothing with `voice_ui` |
| Interrupt the bot by talking | **Not run** (no microphone); the page's logic is the demo's, the server stops the speaking of a cancelled turn |
| The settings modal | OK: opens with the agent's settings, Apply, Discard, Close |
| Create agent | the modal opens with the form; **the upload was not run** (the pane cannot pick a file) |
| `voice_ui` off | OK: no Talk / Live, no voice controls, no request to `/vendor/`, `voice-config { enabled: false }`; no child (unit test) |
| Full shutdown | OK: the mindserver exited and whisper on its port was gone |

**For the owner**: the microphone, hearing the voice, talking over the bot, the profile upload, and the two-bot case
with the real bots.

## What was left out, and what the demo did that this build does not

- **Kokoro** is not installed; the dropdown lists the 10 Supertonic voices. `VOICE_KOKORO=true` with `kokoro-js`
  installed brings it back.
- **The LLM** of the demo (`llm.js`, the OpenAI stream, the echo bot, the history, `assistant_delta`, "New
  conversation"): the bot is the LLM. **Clear** clears the page's chat only.
- The demo's start script and `.env`: the launch scripts are unchanged; the mindserver starts whisper itself.
- **Streaming**: the demo spoke while the LLM streamed. The bot's lines arrive whole, so the first audio comes after
  the bot's first whole line (in the test the first audio came 1.6 s after the end of speech, with a fake bot that
  answers in 0.8 s; with the real bot add the model's time).
- **Two bots**: the page talks with one bot at a time (the dropdown, or Chat in a card). Only the chosen bot's lines
  are spoken; the other bot's lines are kept in its own chat.
- **Two pages** open at once would both speak.
- **After an interrupt** the bot may still say the rest of its old answer, which is then spoken (its work cannot be
  stopped from the page; say "stop" or press Stop action).
- With `voice_ui` on and **no page open**, nothing speaks: the system voice is off.
- `voice_ui` changed in the Settings modal of an agent mutes or unmutes that agent's system voice only; the engines
  follow `settings.js` at the start of the mindserver.

## Found on the way

- In the owner's checkout the patches of `mineflayer` and `mineflayer-pathfinder` did **not** apply
  (`patch-package finished with 2 error(s)`): `node_modules` held an older patched state. So the bot ran without the
  current patches (the wake of 1.21.6, the door centring, the stuck cost), and `gj_pathfinder.test.js` spun for 20
  minutes at 2.7 GB. With the owner's leave the two packages were removed and installed again: all 8 patches apply,
  the pathfinder tests pass (47 of 47 in 0.7 s). **The play test of v0.1.4.13 is the first with these patches applied
  on this machine.**
- The test run left behind by that hang (PID 33116, started by this session) could not be stopped from the session.

## For the changelog of 0.1.4.13

- **The live voice** (`voice_ui`, `voice_voice` "supertonic:F1", `voice_language` "en"): talk with the bot in the page
  of the mindserver. Press Talk / Live and speak; whisper (on the GPU) writes your line down and sends it to the bot
  as your chat line, and the bot's answers are spoken by Supertonic (on the GPU) in the page; commands and results
  are shown, not spoken; the system voice stays silent. `npm run voice:setup` (about 1.6 GB, outside the checkout),
  `npm run voice:smoke`.
- **The page** in a new design: the chat of one bot first, every old control under Agents. The bot's whispered lines
  now reach the page, and the page's lines and buttons are sent as the owner (they were dropped as `ADMIN` with
  `only_chat_with`).
