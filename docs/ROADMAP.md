# Roadmap

State of 2026-10-02. This file lists what is planned for the fork and in which order. `CHANGELOG.md` lists what is released.

Rules that hold for every release:

- Every new part has a switch in `settings.js` and is off by default.
- Skills are code. They run without a call of the language model, so they cost nothing to run.
- A release is tested by unit tests, by end-to-end tests on a simulated server, and by scenarios on a real Minecraft server with the reflexes of the bot on.
- An idea that needs new technology is built only after a trial proved it.

## Overview

| Release | Name | State |
|---|---|---|
| 0.1.4.8 | Stability | Released |
| 0.1.4.9 | The mine, the routes of the player, and the model comparison | Released |
| 0.1.4.10 | Goals | Released |
| 0.1.4.11 | Navigation and words | Released |
| 0.1.4.12 | Understanding and watching | Released |
| 0.1.4.13 | Supervision | In work: `docs/releases/0.1.4.13/PLAN.md` |
| 0.1.4.14 | Routines | Planned: after the play of 0.1.4.13 |
| Later | See the backlog | Not decided |

## 0.1.4.9 The mine, the routes of the player, and the model comparison

Released on 2026-09-30; `CHANGELOG.md` says what it contains. Left for later: a mine named with a number collides with the mines the bot dug itself; `ore_sense_range` accepts 1 and 2 as well as 0 and 3; a plain `!goToCoordinates` into the mine still stands on the closed trapdoor (the path search of v0.1.4.7), while `!goToRememberedPlace` walks the learned route.

## 0.1.4.10 Goals

From the play of 2026-10-01: the bot mined well until it ran out of torches, then waited for an order at every step while the owner guided it to wood, planks, sticks and torches, and never came back to the mining by itself. The goal mechanism of the original project (`!goal`) is a loop of the model that any message of the player ends, and the model has to be told to use it.

| Part | Content |
|---|---|
| The job | An order with a result that code can check is a job: mine 16 iron, farm the wheat, get 8 logs, make 32 torches. The bot keeps one current job with its state (6 of 16 iron, in the mine "mine"), on disk. An ordinary order becomes the job by itself; "set yourself the goal: ..." sets one explicitly, for the bigger ones. The player never has to say it. |
| Errands do not end the job | "Follow me", "come here", "check the chest", "wait", "go to bed" are errands. When nothing more comes for a while and nothing runs, the bot returns to the job by itself (setting `job_resume_seconds`, default 60; the owner wants a minute or more): `I go back to the mining, 6 of 16 iron.` Code decides, no call of the model. |
| Blockers become steps | No torches is not a reason to idle: the job gets the steps wood, planks, sticks, torches, then back to the mine. The model plans the steps once when no skill knows them; code checks each step. |
| Ending a job is implicit | "Stop" or "that's enough" ends it. A new job replaces it, with one line: `I leave the mining at 6 of 16 iron.` |
| Restarts | The job survives a restart of the process; the bot says where it stands and goes on. |
| Nothing to do | A standing list the player gives once: keep the farm going, tidy the chests, make torches when fewer than 32. The bot works it when it has no job. |
| Progress | One line when a step is done and when the job is done. No narration between. |
| Later: milestones | "Beat the game" or "help me beat it" is the same machine with milestones instead of steps: iron tools, a bed, diamonds, the Nether, each a state that code checks, the model planning only the next one. It needs smelting, trading and the Nether as skills first. |

Why first: the owner saw the bot idle through 20 minutes of guided crafting and never return to the job. The same idea made `!farmCycle` work once the whole cycle was code.

The same release takes the path search in hand. mindcraft-ce was checked on 2026-10-01: its navigation is upstream Mindcraft unchanged, its pathfinder patch is byte-identical to ours; nothing to take. The gains are in our own patch of `mineflayer-pathfinder`:

| Part | Content |
|---|---|
| Trapdoors | A closed trapdoor counts as a block to stand on only over solid ground, never over a ladder or air; an openable block is passable only when the move goes through it. Today the bot stands on the closed trapdoor. |
| Ladders inside the search | A move of one rung down when the block below is a ladder or a vine; on a ladder the search looks at the wall and holds forward, as a player does, without steering or planning again. Every walk the search starts, by a command, a reflex, a pack or the model's code, then climbs and descends smoothly by default; the ladder code of the packs becomes the fallback. No switch: a correction of the path search. |
| Doors | Every door point of a path is centred, not only the first; the arrival tolerance at doors and ladders stays at 0.35. The doorway swinging goes. |
| Holes and hollow blocks | Slabs, stairs, cauldrons, composters and hoppers get a no-stand rule in the search itself (the list of `stand_logic.js`), and a one-wide pit with a high exit a cost. |
| Stuck | A cell where the bot got stuck gets a temporary high cost before the path is planned again, so the next plan takes another way. Part of the unstuck escape becomes unnecessary. |
| Known routes | Later: the cells of a walked route get a discount in the search, so the bot prefers known ways. |

Also in 0.1.4.10, from the play tests of 0.1.4.9:

| Part | Content |
|---|---|
| The pen | The item reflex never opens a gate of a pen or a farm and never enters an area of type pen; a saved rule of the player about an area reaches the reflexes as a flag of the area. |
| Floors | The scan of a building stops at a floor: a house above a basement gives two areas, or one area with floors, so that "the basement" and "the house" are different places for the bot and the shelter. A scan that gives the box of an existing area answers that it is that area. |
| `!forgetMine`, `!mines` | A mine can be forgotten by name and listed. A mine named with a number no longer collides with a mine of the bot. |
| Scorecard | `node scripts/scorecard.js <log>`: the numbers of a play log in one table: minutes, processes and why they ended, orders and orders without a result, calls and cost per model, "I'm stuck", doors left open. The analysis of a play test takes a minute. |
| Test base from the owner's world | `scripts/dump_region.js`, run by the owner once: the blocks around home into a JSON; the test base is built from it. |
| A play scenario with the model | `npm run test:play`: the first ten minutes with the chat model of the profile, on the owner's machine only, about 10 cents with Luna. The only test in which the model talks. |
| Chat model | Decided from the routing check with Luna and Haiku: accuracy, time per answer, cost. |

## 0.1.4.11 Navigation and words

Decided on 2026-10-02 from the two play sessions of that day (Luna and Haiku on v0.1.4.9): the same things went wrong with both models, and the cause was the texts the model reasons from and three rules of the code, not the model. The plan is `docs/releases/0.1.4.11/PLAN.md`: every failure text names the cause and the next step; a shaft from the room or a tunnel end; the tunnel accepted where the owner stands; the surface means open sky; a place from one sentence, with the kind the bot concludes from the scan of the area; routes as waypoints walked by the path search, a dry scan before the first step; no digging toward the player. "Understanding and watching" moves to 0.1.4.12.

## 0.1.4.12 Understanding and watching

Scope decided by the owner on 2026-10-03, the release after the plays of v0.1.4.11: it is not an easy one, so it starts early and
runs in rounds, each round shippable on its own. In order: part C (the watch server, a pilot), part B (watching, a pilot, learning
from the owner and from a scripted teacher on the test server), part E (smelting), part F (the scans underground), part G (the
small items), part D (two bots). Part A (the local embedding model) waits for 0.1.4.13: its trial proved the speed, not that the
chat model chooses better, and that is measured first with the routing check.

### Part A: the bot picks better examples

Before each call of the model the bot puts 2 of its examples into the prompt. Two steps of this part were released with 0.1.4.8: examples for the commands that had none, and the choice by the last request of the player (`examples_by_last_request`).

| Step | Content |
|---|---|
| Local model | A small embedding model on the computer of the player compares the meaning of sentences. Model file 23 MB, library 480 MB on disk, an optional dependency. Setting `local_embeddings`. |
| Lowest score | Below it no example is put into the prompt. Setting `examples_min_score`. The score is set from real requests. |

Design rules: no database, the comparison runs in memory; the name of the model is saved with the numbers; a cache on disk keyed by a hash of each text; for skills the description is compared, never the code; names of players are replaced before the comparison; the bot never waits for the model and compares words until it is loaded.

Result of the trial: the model runs inside the sandbox of the bot, starts in 0.6 seconds, answers in 5 milliseconds, needs about 120 MB. Of 76 requests of two play sessions, 16 got a fitting example with the method of 0.1.4.7, 34 with the last request only, 62 with the local model. Not proven: that the chat model then chooses the right command more often.

### Part B: learning by watching

The player shows the start of a job, the bot does the rest. Watching writes no new code. It fills in the details of a skill that exists.

| Step | The player | The bot |
|---|---|---|
| 1 | Says "watch me" | Comes within 16 blocks, keeps the player in sight, records. No call of the model. |
| 2 | Places 3 fences and the gate | Writes down each action with place and block |
| 3 | Says "continue like this, 7 by 10" | Finds the pattern and says what it understood, with the material it needs |
| 4 | Says "yes" | Does the rest, with all its safety rules |

Patterns of this release: a line of placed blocks, a rectangle of fences with a gate, the first steps of a tunnel. Setting `watch_and_learn`.

A pilot as part C is: the recorder learns from any player, so the test server gets a scripted teacher (a second bot of the harness
that places the fences and digs the first steps, as the trial did) and every pattern has a journey that needs no owner; the owner
teaches the same patterns in his world and says where the bot misread him.

Result of the trial on a real 1.21.8 server: 40 of 40 placed blocks and 60 of 60 broken blocks recorded with the right place and name; with two players who build in the same space, 320 of 320 blocks credited to the right player. Limits: the player of the trial was a second bot; crediting needs 16 blocks or less; the bot never sees crafting, the content of a chest that the player uses, or the inventory of the player.

### Part C: watching the play from the cloud

A pilot of the idea, decided by the owner on 2026-10-03: the testing routine (unit, end-to-end, the journeys on the real server, the play test) stays as it is; this part adds a way to watch and to step in. The long goal behind it is an autonomous mind over the bot that controls it while the owner is away; the first step is observation and the `say` tool, nothing more.

From the plays of 2026-10-03: the owner cannot judge a test without the geometry, and the tech lead reads the logs only after the session. A small MCP server on the owner's machine, started by the launch script next to the bot, exposes what the bot knows: its position and the block it stands on, its inventory, the last 10 chat lines, the running command and the job, the areas and mines it saved, and one tool `say` that types a chat line as the owner would. The session in the cloud connects to that server over the owner's tunnel, never to the game port 55916, and watches while the owner plays; the owner's words stay the orders. Setting `watch_server` (off), a token in the environment, read-only but for `say`.

The server pushes events, so that the supervisor sleeps between them: an explosion near a saved area, a drop of health, animals missing from a pen against its record, a night without sleep, a job stalled for 10 minutes, the same failure text 5 times, the bot farther than 100 blocks from home. The supervisor answers an event with an order, a job or a rule; the predictable cases (sleep every night, the creeper by the pen) stay in the reflexes. A goal the skills do not know ("find a village") goes to the supervisor, which plans the legs and gives the orders. Without the supervisor the bot finishes its job, works the standing list and sleeps, as today.

Two small items beside it, from the same talk: the night reflex lies down in the bed for a moment when it reaches it and nobody else sleeps, which resets the phantom clock without passing the night (the server's statistic "time since rest" proves it in a world test), then goes on with its night work; and a scan whose border is natural rock is a cave, not a storage (T3-6 of v0.1.4.11: the corridor above the staircase counted 207 water blocks of the rock).

### Part E: smelting

Today `!smeltItem` is the command of the original project: it puts 1 coal into the nearest furnace within 16 blocks (or places
one on the nearest free cell, inside the house or the pen too), smelts one item at a time and waits; the blocker steps of a job
may call it, but no plan was ever tested on ore, so the bot cannot make iron tools from ore by itself. The part, one round of an
engineer: a furnace of the storage pack (the furnace of the room or the house, placed only in a saved area of type storage,
building or mine, never in a pen or a farm), fuel in the order coal, charcoal, planks, logs, with the count the batch needs, a
batch of up to 64 in one go, the texts (`I smelted 8 raw_iron into 8 iron_ingot in the furnace at (x, y, z) with 1 coal.`, `I have
no fuel: no coal, charcoal, planks or logs.`), a step `smelt` in the plan of a job (no iron pickaxe: mine 3 iron, smelt 3, craft)
and `!getTool("iron_pickaxe")` leading through it. A journey: "make me an iron pickaxe" with ore in the tunnel, coal in the chest.

### Part F: the scans underground

From T3-6 of v0.1.4.11 and the owner's plays: the enclosure scan in a corridor of rock called it a storage and counted the water
pockets of the rock; "scanning not always smooth". The part: a border of natural rock makes a cave or a tunnel, never a storage
or a building; the scan of a tunnel is the measurement of the mining pack (width, length, direction, open sides) and says so
(`I am in a tunnel 2 wide and 23 long, heading west, of the mine "mine".`); the area sense underground names a tunnel it knows
and stays quiet in one it does not; the scan runs in one pass and the bot stands still while it scans.

### Part G: the small items

Fixed in this release, each with a unit test, the library ones as files under `patches/` (no pinned version changes): `bot.wake()`
of mineflayer sends the wrong action since Minecraft 1.21.6 (the home pack's workaround goes); the path search centres the points
of a path behind a door it opens; the bot sends `player_loaded` after each spawn, so it hears the first 3 seconds; `!useOn` reads
the state of a door before it toggles it; `!endConversation` and `!goToPlayer` for an unknown player answer in plain words. The
deleted-message bookkeeping of the network library is left alone until it bites: it is deep in the chat session code and has not
cost a play yet.

### Part D: two bots

Two bots of the owner in one world answered each other's command echoes and results (2026-10-03). Until this part, `only_chat_with` names the owner in each bot's settings and `MINDSERVER_PORT` gives the second bot its own port. The part: a bot recognises the other bots of the owner by name (the launch script passes them), never answers their echoes or results, and a role per bot ("you farm, you mine") in the settings; a question to both ("where are you?") gets one line from each.

## 0.1.4.13 Supervision

Scope decided by the owner on 2026-10-04 after the supervised play of that day (Claude on Haiku and gpt on Luna mining
diamonds, the tech lead as the supervisor through the watch server): supervision is the main feature and the corrections the play found come with it. Routines go to 0.1.4.14 (the owner's
split of 2026-10-04: two smaller releases, and the play of this one shows which routines the owner would write). The
plan is `docs/releases/0.1.4.13/PLAN.md`.

| Part | Content |
|---|---|
| Supervision | The watch server gets `digest`, `wait`, `run`, `note`, `look`, `server`, a report every N seconds and a `help` event, so a supervisor wakes only on a change and orders in one call. One channel, names: a line that names one bot is for that bot and the other stays quiet; a line that names the supervisor is a message for it and nothing a bot answers; the supervisor's `reply` goes into the chat; the voice page speaks each. A `/supervise` skill and `docs/SUPERVISOR.md` make a supervision session cheap (about a cent a turn against $7 an hour on 2026-10-04). |
| The corrections | Supplies from the chest beside the bot, tool wear, the plan that starts, the furnace in the bag, the job counter, no cancel by the model's follow-up, `!mineOre` from where the bot stands, `!goToSurface` by a known route, two ladder places, the full bag, death drops and armour, `!givePlayer`, no shaft downwards, an unsaved pen protected like a saved one (two bots opened the pens together on 2026-10-04). `mine_other_ores` as a setting. |
| Two bots, one memory | `shared_memory`: the places, chests, routes, mines, rules and routines of a world shared by the bots. |
| Cost | `prompt_cache` on the Anthropic API: Haiku's hour from about $1.70 to about $0.60. The price of Luna checked against the bill. |
| The creeper loop | F10 of v0.1.4.12: the keep-away loop that about once in 30 runs after an explosion runs until the process is out of memory (W47). A profiling run finds it. |

Voice (the demo's page, whisper and Supertonic in the mindserver, `voice_ui`, `voice_voice`, `voice_language`) was built
by a local session on `release/v0.1.4.13-voice` on 2026-10-04 and proven in a game session; it merges in with round 1.
After this release: the supervisor and the bot as one mind, and part A of v0.1.4.12 (the local embedding model) after
the routing check measures it.

## 0.1.4.14 Routines

Split off 0.1.4.13 by the owner on 2026-10-04: planned after the play of 0.1.4.13.

| Part | Content |
|---|---|
| Routines | Decided on 2026-10-03: "something like maintain the base cannot be expressed as a function, but can easily be described with words". `!rememberRoutine`, `!routines`, `!forgetRoutine`, `!doRoutine`: a paragraph in the owner's words becomes a job of v0.1.4.10, the model plans the steps, code checks them, a maintaining routine runs again until "stop". The supervisor's lever when the owner is away. |
| The model comparison | `npm run test:play -- --situations`: six situations in plain words, the same for each model, with the first command, the follow-ups and the time. |

Setting `routines` (off).

## Backlog

Ordered by recommendation. Nothing here is decided.

| # | Idea | Why |
|---|---|---|
| 1 | Journal and scorecard | Each session leaves a record that a script can read. The analysis of a play test takes minutes, not hours. |
| 2 | Stronger chat model, paid by prompt caching | To be measured. |
| 3 | Saved lessons | A recorded round is replayed on order. The bot checks the world before each step. |
| 4 | Guides of big goals | A short file per big goal, ten lines: the milestones in order, each with the state that code checks (an iron pickaxe in the inventory, 5 diamonds, the portal lit). The model plans only the next milestone; the skills do the work; the player edits the file. The guide is also the list of skills to build: smelting, trading, the Nether. "Beat the game" first. Stashed on 2026-10-01 until the job of v0.1.4.10 and smelting exist. |
| 5 | Review after the session | A strong model reads the journal after play and proposes rules and corrections. The player approves. |
| 6 | Smelting | The bot makes iron tools by itself. |
| 7 | New skills from a record | The strong model writes a skill from what it watched. The player approves each one. Experimental. |
| 8 | Learned skills on top of the coded ones | The skill library of 0.1.4.4, with approval for each skill. |
| 9 | Vision | A look on request. An experiment. |

### Small items

| Item |
|---|
| `bot.wake()` of mineflayer sends the wrong action since Minecraft 1.21.6. The home pack works around it; a patch of the library would correct every caller. |
| The path search does not centre the points of a path behind a door that it opens, so the bot can stick at the frame. |
| The bot is ignored for 3 seconds after each spawn, because mineflayer does not send the packet `player_loaded`. |
| When a chat message is deleted by the server, the network library forgets which messages it has seen. |
| `!useOn` toggles a door without reading its state. |
| `!endConversation` answers with a typing error. `!goToPlayer` fails for a player it does not know. |
| Pull requests for the original project: text-to-speech without a shell, the sandbox, the chat checksum. |

## Open decisions

| Decision | Options |
|---|---|
| What the bot is first | A companion in the base, or a player that pursues the game |
| Chat model | Haiku 4.5, or another model after a measurement |
| Rules and skills the bot learns | Ask before keeping, or keep and tell |
