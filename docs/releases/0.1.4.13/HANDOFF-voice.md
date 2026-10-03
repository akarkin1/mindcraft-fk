# Handoff: speaking live with the bot through the browser (v0.1.4.13, the voice demo)

For a Claude Code session on the owner's machine. Written by the tech lead in the cloud on 2026-10-03, after the
release of v0.1.4.12. Read `CLAUDE.md` first; its rules hold here word for word.

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

## What to build

1. **The page, in the demo's design.** One page that keeps every control of today (nothing lost: start, stop, restart,
   the settings modal, create agent, the inventory, disconnect all, shutdown) but puts the conversation first: the
   chat of one bot (the owner's lines and the bot's lines, `bot-output`), the text input, and the live button beside
   it. The agent cards and the rest fold away behind one control. Keep it one file as today, or split into
   `index.html`, `app.js`, `style.css` under `src/mindcraft/public/` (the mindserver serves the folder; check
   `express.static` in `mindserver.js`). No build step, no framework, no CDN: the page must open without the internet.
2. **The live button.** Push to talk or a toggle, as the demo does it. The browser records the microphone
   (MediaRecorder or the demo's way), the audio goes to the mindserver over the socket or an HTTP route, the
   mindserver hands it to the STT service, the text comes back and goes down the existing `send-message` path with the
   owner's name, so the bot answers as to a typed line. Show the recognised text in the chat as the owner's line.
3. **The bot's voice.** Every `bot-output` line of the chosen bot goes to the TTS service and plays in the page.
   While the live mode is on, the system voice must not speak the same line twice: the agent's `speak()` of
   `src/agent/speak.js` learns a `speak_model` value `"browser"` (the line is sent to the mindserver and played by
   the page) or the page tells the mindserver to mute the system voice while it is open. Decide from the demo; say
   which in the notes. A line that starts with `!` (a command echo) is never spoken.
4. **The services: Supertonic (TTS) and whisper (STT) on the GPU.** Take the demo's way of running them (the
   processes, the ports, the audio format, the model files). Into the repo go only the glue: a small service module or
   the demo's server file if it is small, a pinned `requirements.txt` or the equivalent, and a launch script
   `start-voice.ps1` that starts both and prints their ports. The models, the weights, CUDA and the DLLs stay outside
   the repo (a sibling folder or `%LOCALAPPDATA%\Mindcraft\voice`); `.gitignore` names them. The mindserver reaches
   the services by URL from `settings.js`.
5. **Settings, off by default**, in `settings.js` and `src/mindcraft/public/settings_spec.json`, after `bot_role`:
   `voice_ui` (the live button and the bot's voice in the page), `voice_stt_url`, `voice_tts_url`. With `voice_ui` off
   the page shows no live button and plays no audio; the bot behaves as before. The look of the page is not bot
   behaviour and needs no switch.
6. **Texts** in the page, short and plain: "Listening...", "Heard: ...", "The voice service is not running: start it
   with start-voice.ps1." Never a claim the code did not check (a service that answered 200 is "running"; one that
   did not is "not running", with its URL).

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
- A manual list in `docs/releases/0.1.4.13/VOICE.md`: open the page, start a bot, type a line, press live, say a
  line, hear the answer, the system voice silent meanwhile, the settings modal still works, create agent still works,
  `voice_ui` off hides the button.

## Handing back

- Commit on this branch with clear messages; push with `git push -u origin release/v0.1.4.13-voice`. Never `main`.
- Write `docs/releases/0.1.4.13/VOICE.md`: what was built, the services and how they run, the ports, the settings,
  the manual list with its results, what was left out and why, and anything the demo did that this build does not.
- The cloud session (the tech lead) folds the branch into v0.1.4.13 with the routines, through the usual gate.

## Open questions for the demo

Read the demo before writing code and answer these in `VOICE.md`: how Supertonic and whisper are started (one process
or two, Python or Node, GPU selection), the audio formats in and out, the latency the owner saw, whether the demo
streams the bot's voice by sentence or waits for the whole line, and what in the demo's design the owner liked
(screenshots or the demo's files; keep its layout, colours and type).
