# Brief for the lead of release 0.1.4.9

Written on 2026-09-30 by the lead of 0.1.4.8 for the session that builds 0.1.4.9 in the cloud. Read `CLAUDE.md`, `docs/PROCESS.md`, `docs/ROADMAP.md` and `docs/releases/0.1.4.8/` first. This file holds what is not in them: the decisions of the owner, the facts from the play tests, and the lessons of the last release.

## 1. How to work

You are the tech lead. You do not write the code yourself: you write the plan for the owner and the spec for the engineers, you give the work to engineers (subagents on Opus 5.5, `model: "opus"` of the Agent tool, at most three at a time), you check their reports against the code, you commit, you verify and you release. Engineers own files; they never run git commands that write; they answer with a report as text, not with a file. Small things of a few lines you write yourself.

The owner reads short plain English: short sentences, tables, numbers, no jargon. Give time estimates with sizes. Call out a cost risk early. Ask before an irreversible step. Every new part gets a switch in `settings.js`, off by default. The changelog gets an entry per release. Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; pull request bodies end with the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

The release branch is `hotfix/mine-routes`, created from `main` at the tag `v0.1.4.8` with `--no-track`. Documents of the release go to `docs/releases/0.1.4.9/`: `PLAN.md`, `SPEC.md`, `HANDOFF.md`, `DECISIONS.md`, `PLAYTEST.md`. Commit them, so that any session can read them.

A cloud session cannot send messages to other sessions. Report to the owner in the chat; leave results in files on the branch.

## 2. Scope of 0.1.4.9

Agreed with the owner. Three parts.

### 2.1 The mine and the routes of the player

The owner's mine is big: an entrance room with a chest and a crafting table, reached from the basement of the house by a ladder; then a further descent, stairs or just descending blocks; then one or more tunnels. The mining pack of 0.1.4.7 knows only mines it dug itself, and the path search cannot go down a ladder (it climbs up one; the pack climbs by control states, see `src/agent/packs/mining/ladder.js`). The bed of the owner lies 8 blocks under the storage room, and the path search finds no way between them either.

| Part | Content |
|---|---|
| Trail | The bot records the steps it walks (position, the block it stood on, doors, gates, trapdoors and ladders it passed), the last few hundred, on disk per world. No model call. |
| "This is the mine" | The trail from the last point under open sky becomes the route of the mine; chest, crafting table and furnace around the bot become the room. Command, for example `!rememberMine(name)`; the model picks it from a sentence such as "this is the mining area, remember this". |
| Routes inside the base | The same for the way between two places the bot walked with the player, for example storage room to bed: `!goToBed` and the shelter walk use a known route when the path search finds no way. |
| Replay of a route | Short hops with the path search from waypoint to waypoint, ladders by the control states of the pack, doors and trapdoors by the door skills; when the route is broken, the bot says where and asks the player to show the way again. |
| "Dig here" | The bot measures the tunnel where it stands: start, the direction the player looks (yaw of the player, rounded to 4 directions, or the direction of the corridor of air), the end where the rock begins, the level. Command, for example `!rememberTunnel`. |
| Work | `!mineOre` takes the nearest known mine within 64 blocks, walks the route, picks a tunnel whose level fits the ore, digs on at its end, straight, 1 wide and 2 high, with the checks for lava and caves of 0.1.4.7. A new shaft only when no mine is known, and only after the player said yes (`new_mine`, built in 0.1.4.8). When a tunnel gets long, side branches in a fixed pattern. |
| Ore list | Every ore block seen beside the tunnel and not taken, with kind, position and reason (wrong pickaxe, lava beside it, inventory full, vein limit). "Collect the coal you passed" walks back along the tunnel. |
| Setting `ore_sense_range` | Default 0: only ore that touches the tunnel. 3: also ore within 3 blocks of the wall, reached by a short side cut. The owner calls 3 "kind of cheating" and wants to switch it off on servers. The same setting governs the old `!collectBlocks` with an ore: with 0 it takes only ore the bot can see. |
| Area type `mine` | Exists since 0.1.4.8. The reflexes must treat a bot in a mine area or on a mine route as underground: no shelter walk at dusk, creepers only in sight. |
| Own code of the model | `!newAction` is refused for digging where a skill exists, with a text that names the skill. In the play test the model wrote tunnel code six times, each version different, one dug in the wrong direction because it guessed the yaw formula wrong. |
| Where am I | The knowledge block of 0.1.4.8 has a line for the position; add the mine and the tunnel the bot is in. |

The pack of 0.1.4.7 keeps `mines.json` per world with `entrance`, `level`, `route` (legs of ladders and stairs), `tunnel`, `direction`, `end`. Extend it; do not start a second store. The mine of the owner in his world file is one area `mining_area` of type `mine` (converted at load in 0.1.4.8), a place `mining_tunnel`, and rules 1 and 2 of the player as text. Rules never reach code.

### 2.2 The tools for the model comparison

The owner wants to compare GPT-6 Luna with Haiku 4.5 in speed, cost and the choice of commands. Facts of 2026-09-30:

- Prices per million tokens: Haiku 4.5 1 and 5; GPT-6 Luna 0.10 and 0.50 (cached input 0.01), from the pricing page of OpenAI. Sonnet 5.5 is 2 and 10, like Sonnet 5; the cost meter prices it by prefix already.
- The owner ran two sessions with Luna on 0.1.4.7 (profile `profiles/gpt.json`, name `gpt`, launch script `start-gpt.ps1` of the owner that loads the secret `OpenaiApiKey` from the vault `AlexSecretsLocal`; never read a secret value). Measured from the log of the game: Haiku answers after a median of 1 s, Luna after 3 s, with reasoning effort `low` as well as `medium`. Luna chose good commands (`!goToBed`, a stone pickaxe at once, never own code) but obeyed the old house rules of the prompt to the letter and refused orders at night. The cost meter shows 0 calls for OpenAI models: only `src/models/claude.js` reports usage.

| Part | Content |
|---|---|
| Cost meter | `src/models/gpt.js` reports its usage (input and output tokens, reasoning tokens count as output) like `claude.js` does; prices for `gpt-6-luna` and `text-embedding-3-small` in `src/agent/cost/price_table.js`. |
| Routing check | `scripts/routing_check.js` and `test-routing.ps1` take a model of OpenAI (`--model gpt-6-luna`, key `OPENAI_API_KEY`); the table shows per sentence the command chosen, and at the end the accuracy, the time per answer and the measured cost. Never run it without `--dry-run` yourself; only the owner runs the real one. |
| Launch script | `start-claude.ps1` takes `-Profile <path>` and loads the keys that the profile needs from the vault (`AnthropicsApiKey` for Claude models, `OpenaiApiKey` for OpenAI models and for `"embedding": "openai"`), by name only. |
| Profile | `profiles/gpt.json` gets the `conversing` text of `profiles/claude.json` (one house rule), `speak_model: "system"`, reasoning effort `low`, the same `code_model` as claude.json. The owner's own `profiles/gpt.json` has local changes; the release wins, the owner sets his values again. |

Bench only Luna, not Sol. Embeddings: the owner uses `"embedding": "openai"` in his claude profile since 2026-09-30; the setting `examples_by_last_request` of 0.1.4.8 is what makes them useful.

### 2.3 The test server as a script

`scripts/get_test_server.js`: downloads the official 1.21.8 server through Mojang's version manifest (`piston-meta.mojang.com`, jar from `piston-data.mojang.com`, SHA-1 `6bce4ef400e4efaa63a13d5e6f6b500be969ef81`, 57,555,044 bytes), checks the checksum, puts it into the folder of `MC_TEST_SERVER_DIR` (default on Windows `%LOCALAPPDATA%\Mindcraft\test-server`), and writes `eula.txt` with `eula=true` only with the flag `--accept-eula`. The owner accepted the EULA on 2026-09-28. The cloud session of the owner did all this by hand for 0.1.4.8: Ubuntu 24.04, Node 22, OpenJDK 21 at `/usr/bin/java`, `MC_TEST_JAVA=/usr/bin/java`, `JAVA_TOOL_OPTIONS` unset for the server. Document the two environment variables in `tests/world/README.md`.

## 3. Decisions of the owner that hold

- Tunnels are 1 wide, 2 high. The bot asks before a new shaft.
- `ore_sense_range`: 0 or 3, default 0.
- Only the player switches a safety reflex; the model gets a refusal (built in 0.1.4.8).
- No fifth number in the version. No spec-kit; our own documents.
- Engineers run on Opus 5.5. At most three at a time; the plan limit stopped the work three times with more.
- Ask before changing the owner's own files (`profiles/claude.json`, `settings.js` values, `start-claude.ps1`); the owner said yes to the house rules once.

## 4. Lessons of 0.1.4.8

- The scenarios on the real server must run with the reflexes of the profile on and in a base like the owner's (`tests/world/base_world.js`). The first play of 0.1.4.7 failed only because the tests had run with the reflexes off.
- Every scenario that tests a skill: one run with all reflexes on, one where the skill is stopped half way (the text must say what was done), and the long run of 30 minutes (`w60_long_run.js`) must stay green.
- A tester who writes tests from the spec, not from the code, found 3 defects that the engineers' own tests missed.
- A static import of a name that does not exist yet breaks the loading of the module and hundreds of tests; packs are loaded with dynamic `import()` behind their switch, and new functions of other parts are reached with optional chaining.
- Line endings: the repository stores LF, a Windows checkout has CRLF; edit with scripts that keep them. Tests must accept either kind, never assert one.
- On the owner's machine every node command runs through `fnm exec --using=v20.20.2 -- ...`; in the cloud Node 22 works.
- Do not create a release branch with `origin/main` as upstream: a push then lands on `main`. Use `--no-track`.
- The bot is ignored by the server for 3.5 s after every spawn (mineflayer never sends `player_loaded`).
- `bot.wake()` of mineflayer is wrong since Minecraft 1.21.6 (the home pack has its own `wakeUp`); the path search opens doors but does not centre the path behind them. Both are candidates for a patch in `patches/`.
- Reports of subagents cannot be written as files by them; ask for the report as text.

## 5. Play test of 0.1.4.8

The owner has not played 0.1.4.8 yet. When he attaches logs (`%LOCALAPPDATA%\Mindcraft\logs\claude-<date>.log`, with time stamps since 0.1.4.8), analyse them as in `docs/releases/0.1.4.8/`: numbers first (calls, cost from `bots/claude/usage.json` if attached, process ends, results lost), then each complaint with its cause and the file and line. Defects of 0.1.4.8 that his play finds go into 0.1.4.9 before the new parts.

Where his play matters most: more than 21 chat messages in one go (the chat kick was proven by unit tests only), dusk in the mine, the farm cycle with leaf litter in a chest, "get me 8 logs", "find some iron".

## 6. After 0.1.4.9

0.1.4.10 "Understanding and watching": the local embedding model (`all-MiniLM-L6-v2` through `@huggingface/transformers` 4.3.0 as an optional dependency, proven in a trial) and learning by watching (proven in a trial on the real server: 360 of 360 blocks recorded, crediting 320 of 320 within 16 blocks by pairing the place sound with the arm swing). Details in `docs/ROADMAP.md`.

## 7. Estimate for 0.1.4.9

| Part | Size | Hours |
|---|---|---|
| Trail, routes, replay | Large | 3 |
| "This is the mine", "dig here", the work in a known mine, the ore list, `ore_sense_range` | Large | 3 |
| Model comparison tools | Medium | 1.5 |
| Test server script | Small | 0.5 |
| Tests: spec tests, scenarios with a player-built mine in the base, the long run | Large | 2.5 |

About 10 hours with three engineers at a time. Tell the owner the estimate and ask for the go before the engineers start.
