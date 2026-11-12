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
| 0.1.4.13 | Supervision | Released: `CHANGELOG.md` |
| 0.1.4.14 | Minecraft 26.1 | Released: `CHANGELOG.md`, merged 2026-11-09 (#24) |
| 0.1.4.15 | The base survey and Routines | Released: `CHANGELOG.md`, merged 2026-11-12 (#26). The plan `docs/releases/0.1.4.15/PLAN.md`. Decided by the owner on 2026-11-09 (option A): two rounds on one branch, the survey first, Routines with a budget of four days and a cut rule (over the budget, the release ships the survey alone); one gate, one play of both |
| 0.1.4.16 | Stability | In work from 2026-11-12 (`docs/releases/0.1.4.16/PLAN.md`): the fixes and small items planned for 0.1.4.15 below (tunnels as beams, caves, routes and places, supplies by need, the rest), moved by the owner on 2026-11-09; the findings of the play of 2026-11-11 on v0.1.4.15 (R-1 to R-13) and three packs behind switches (AFK creeper kill, enchanting, breeding), put here by the owner on 2026-11-11; not started until the owner says so |
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

## 0.1.4.14 Minecraft 26.1

The owner, 2026-11-03: the upgrade of the bot to Minecraft Java 26.1 is the next release candidate. The newest
released libraries (mineflayer 4.39.0, minecraft-protocol 1.68.0, minecraft-data 3.119.0) support 26.1 and
nothing newer; 26.2 works only from unreleased branches of five libraries and 26.3 from none (checked on real
servers on 2026-11-03). Node 22, Java 25 for the test server, the 8 patches regenerated, the data of 26.1 in the
bot's tables (copper pickaxes, copper chests, the corrected foods). The plan is `docs/releases/0.1.4.14/PLAN.md`,
the spec `SPEC.md`. About 4 days.

## 0.1.4.16 Stability (the list planned for 0.1.4.15 until 2026-11-09)

Split off 0.1.4.13 by the owner on 2026-10-04, moved behind the upgrade to 26.1 on 2026-11-03. On 2026-11-09 the owner
moved Routines into 0.1.4.15 with the base survey (option A, above) and this list to 0.1.4.16; one row from the fix
round of 0.1.4.14 joins it at the end.

| Part | Content |
|---|---|
| Routines | Decided on 2026-10-03: "something like maintain the base cannot be expressed as a function, but can easily be described with words". `!rememberRoutine`, `!routines`, `!forgetRoutine`, `!doRoutine`: a paragraph in the owner's words becomes a job of v0.1.4.10, the model plans the steps, code checks them, a maintaining routine runs again until "stop". The supervisor's lever when the owner is away. |
| The model comparison | `npm run test:play -- --situations`: six situations in plain words, the same for each model, with the first command, the follow-ups and the time. |
| Tunnels as beams | The owner, 2026-10-06: "The tunnel is not a segment, it is a beam, it will be growing infinitely; the bot should expect that." A tunnel is saved as a start, a direction and a level, never an end or a length; its end is where the open cells along it stop, found when the bot stands in it; every run digs on from there; pieces on the same row, level and direction are one beam (the saved mines merge on load); the way in is to the start and along the beam; branches start on a beam with their own direction. The play of 2026-10-06: "mine" kept 3 pieces of a 116-block tunnel, "deep" 34 of more than 110 blocks; every later run said "no way" or walked home with 0 iron, ended 2 blocks below its level, planned the way back through the room, ignored the route saved by hand. About 2 days. |
| Routes and places | The route "mine" breaks at the foot of the ladder (8, 41, 46) to (8, 41, 48); "mine_to_deep" ends in the room, not at the deep mine; the place "house_to_mine" took the route "farm_to_home"; "I find no way to the top of the ladder" at the basement's bed. About 1 day. |
| Shelter | "this is the shelter" answered `That is the area "home" already.` while the model claimed it saved it; a stray place "shelter" by the pens; the home point drifting. About 0.5 to 1 day. |
| Smaller ones of 2026-10-06 | A bed in a 2-wide tunnel; the farm round 40 blocks off the farm without the bone meal it took; `!goToCoordinates` over the surface to a mine; `!putInChest` into a full chest reports wrong; the chest index stale; the model asks about the area "home" after every restart, answers "where are you?" wrongly, took "it's all good now" as `!stop`. |
| Caves | The play of 2026-10-05: two deaths in caves. The mining walls off a cave it breaks into; a command seals an opening; the bot keeps out of dark caves. About 1 to 1.5 days. |
| Supplies by need | No walk of 150 blocks for 2 torches; no loop of eating the food and fetching more; the cobblestone named. About 0.5 day. |
| The mine and its route | `!mineOre("diamond")` took the shallow mine; the same route failure came 4 times. About 0.5 day. |
| A full bag far from the chest | Carry it back or place a chest; `!discard` no longer picked up again. About 0.5 day. |
| Chests by position | The upper of two stacked chests; every stack in one `!putInChest`. About 0.5 day. |
| `!craftRecipe` with a count | A count above 1 says "missing ingredient". About 2 hours. |
| A ladder through a trapdoor | The path search opens it; a patch of the pinned path search, so a play test of the owner. About 0.5 day. |
| Orders stay orders | The bot's model stopped the supervisor's commands, turned off its unstuck reflex, left the mine after "wait", made a mine without a yes. About 0.5 day. |
| Code that cannot be stopped | Generated code that ran `collectBlock` in a loop ended the process (`refused stop after 10 seconds`). About 0.5 day. |
| The load of the laptop | Only if it remains in the play after the quiet supervisor of the fix of 0.1.4.13. |
| The history race (0.1.4.14, P-21) | `history.add` awaits the memory summary at `max_messages` while a concurrent `handleMessage` pushes the assistant's command turn, so the turns can end with the bot's own line; the model class closes them with a user turn since 0.1.4.14, the race itself is to be removed (one add at a time, or the summary off the add path). About 0.5 day. |

Setting `routines` (off) belongs to 0.1.4.15 now.

### The play of 2026-11-10 on v0.1.4.14 (Q-1 to Q-9; the owner decides the release)

Reported by the owner's gameplay session on 2026-11-10 (the world "Speed Run 1 [26.1]", the base at (-2300, 63, 816),
the house doors on the south side at z 819); recorded here untouched until the owner says where they go.

| Id | Finding | Where to look |
|---|---|---|
| Q-1 | `!goToBed` and the night shelter stop at the house's east wall (-2297, 63, 814) with "locked out" / "I cannot get into the shelter home" / "I stopped in the doorway"; the reflex retried every minute without end. The doors are at (-2301, 63, 819) and (-2300, 63, 819). `!goToCoordinates(-2300, 63, 821, 1)`, then `(-2300, 63, 815, 0)`, then `!goToBed` works every time: the shelter walk seems to aim at the nearest wall, not a door. | `shelter.js`, `shelter_logic.js` (the entrance choice, the route of the walk), the door service |
| Q-2 | A phantom creeper, a death: `creeper_safety` stopped every walk near the trading hall at about (-2262, 63, 838), "A creeper keeps following me" with no creeper there (`!entities` showed none); underground at level 16 the reflex fled down into a cave to (-2245, -4, 864), where the bot died with 22 raw iron. 71 monsters tracked around the tower, 26 creepers, mostly below y 40: the reflex counts creepers through blocks and in caves below. It must react only to a creeper it can see, within reach and at its level, and never flee into a cave. | `creeper_logic.js`, `modes.js` (`creeper_safety`), the flee target |
| Q-3 | The clock in the prompt: the model said "Night's coming", went to the shelter, ran `!stay` and "Night's still on" in full daylight (Time 932 and 2166 on the watch); `!goToBed` once said "It is day, the night starts in about 1 minute" at dusk. Does every time the prompt and the texts read come from the patched clock (`bot.time.timeOfDay`)? | `full_state.js`, `queries.js` (`!stats`), `sleep.js`, `night_logic.js`, the `time` listener of `agent.js` |
| Q-4 | Every `run` of the supervisor echoes `*MartyByrde2 used setArea*` and the result into the game chat, and for `!newAction` the whole generated code; the skill says `run` is quiet. | `watch/queue.js` (`runQuiet`), `agent.js` (`routeResponse`, `show_command_syntax`) |
| Q-5 | `bot.dig` fails with `enchantments.concat is not a function` while holding an enchanted diamond pickaxe the owner gave; the 26.1 item components (enchantments are no array) in the dig-time code or the pathfinder's dig cost. The bot also said "no way without digging" inside a leaf canopy where breaking leaves was the way out. | `patches/mineflayer+4.39.0.patch` (`digging.js`, `digTime`), prismarine-item's `enchants` on 26.1, the fallback rule of `way_logic.js` for leaves |
| Q-6 | `!mineOre("iron", 32, true)` after a restart or a `!stop` starts at "0 of 32" with 22 raw iron in the bag; the model shortened the owner's 32 to `!mineOre("iron", 8, true)`. | `job/index.js` (`progress`, the bag's count at the start), the profile's examples |
| Q-7 | `!mineOre`: "I have no stone for a new one" with 65 cobblestone in the bag; it stored 133 cobblestone and its crafting table in the mine chest and planned to smelt the owner's iron for an iron pickaxe; the stone pickaxe craft beside a placed table failed twice ("windowOpen did not fire") because the unstuck reflex moved the bot away; standing next to the table it worked. | `mining/` (the pickaxe rule, the supplies), `skills.js` `craftRecipe` (the unstuck pause during a craft), the chest storing rule |
| Q-8 | The watch's `run` returns "Ran 0 of 1. Still running" after about 60 s while the command goes on; a supervisor script takes it as finished. | `watch/queue.js` (`QUEUE_RULES.answerMs`), the supervise skill |
| Q-9 | Small: an iron axe lasted about 150 logs (does `!chopTrees` swing at leaves or use the axe on other blocks?); the mine chest filled with 33 kinds (saplings, dirt, the bed, the crafting table); the area sense asked about "a walled yard with a roof, 1 bee" that was tree leaves. | `wood.js` (the tool use on leaves), the storing rule, `area_scan.js` (a hive or a bee nest as a built block?) |

Lessons for the supervise skill (the gameplay session's, no code): watch scripts resume from the last cursor, not
the newest; owner lines without the supervisor's name are not message events.

Q-1 is fixed in 0.1.4.15 (the doorway stall) and confirmed by the play of 2026-11-11 (`!goToBed` from the east
wall at night walked in and slept, twice). Q-2, Q-4 and Q-5 came back on 2026-11-11 as R-1, R-12 and R-10 below,
which the owner put into 0.1.4.16; the other Q rows wait for the owner's word with them.

### The play of 2026-11-11 on v0.1.4.15 (R-1 to R-13; the owner: into 0.1.4.16, not before his word)

Reported by the owner's gameplay session on 2026-11-11: the branch `release/v0.1.4.15-rc` at 33cae12, `base_survey`
and `routines` on, the base at (-2300, 63, 816), the owner's 14 areas saved by `!setArea` before the survey; the
owner's log `%LOCALAPPDATA%\Mindcraft\logs\claude-20261111-014535.log` on his machine. The owner says the fixes
belong in 0.1.4.16 and the work does not start until he says so.

Passed in the play: Q-1 (above); "here is the base, scan it" became `!surveyBase("base")`, which found the horse
house, the farm tower and the cave room at the bottom of the shaft (y -20 to 0) and left the 14 saved areas alone;
`!renameArea` and `!forgetArea`; `!rememberRoutine`, `!routines`, `!forgetRoutine`, `!doRoutine`, and "stop" ends a
round ("I leave the routine"); `!farmCycle` on all three farms harvested, replanted and stored to the farm chest when
started outside the house.

| Id | Finding | Where to look |
|---|---|---|
| R-1 | `creeper_safety` reacts to creepers in caves 12 blocks below, through rock: `bot.entities` showed creepers at y 50 while the bot stood at y 62, 4 to 8 blocks away sideways. It loops "A creeper keeps following me", blocks every walk near the trading hall, and once led the bot down into a cave. The owner had it off for the session. Q-2 again: line of sight, or the vertical difference. | `creeper_logic.js`, `modes.js` (`creeper_safety`), the flee target |
| R-2 | `bases.json`, the base "base": its centre (-2290, 60, 894) and door (-2311, 71, 918) come from a village 100 blocks south, so `!goToBase` walked into a village house; `!forgetArea` of 4 village places left them in the base's `places` (`!renameArea` did update it); it lists a `trading_hall_2` that is no saved area; the 14 areas saved before the survey are not part of the base. | `survey.js` (the base's centre and door: the house with the bot's bed or the nearest to the bot, not the farthest find; `forgetSurveyed` removes the place from the base; a name is listed only when saved), `survey_logic.js` (the extent of a base: the finds within reach of the bot's start, a village 100 blocks off is another base), `base_store.js` (the owner's own areas around the start join the base) |
| R-3 | The report: the line names no places and no count ("I found the houses, trading halls, farm, pen and a few more places, all saved"), so the model's paraphrase reached the owner instead of `reportText`'s line. The survey saved village houses as kind `home`, which makes them shelters; the owner wants only his house as a shelter. | `survey.js` (the report said by the bot itself, the command's output a short confirmation), `survey_logic.js` (`home` only for the house with the bot's bed or nearest the start; other houses `building`), `area_kinds.js` (`isShelterArea`) |
| R-4 | "rename pen to horse_house", said as the owner, got "No response from Claude". | the routing sentences of `base_survey` (`tests/routing/sentences.json`), the profile's example for `!renameArea`, the response path of `agent.js` when the model answers with a command and no words |
| R-5 | Routine planning: the plan drops places given in the text ("go to the west forest chest at (-2383, 65, 832), chop there") and plans `!chopTrees(128, "spruce")`, which searches 48 blocks around where the bot stands; one failed step ("no spruce tree within 48 blocks") ends the whole round instead of skipping the step; the round number is always 1; `!harvest("sugar_cane")` finished in 0 s and cut nothing; a round starts by itself in the middle of the supervisor's work; a routine is capped at 400 characters and a rule at 200, with a one-line refusal that is easy to miss. | `routine_logic.js` (the plan rules: every coordinate and named place of the text becomes a `!goToCoordinates` or `!goToPlace` step before the work there; a failed step is skipped and said, the round goes on), `routines.js` (the round counter, "idle" while the supervisor's queue has work), `routine_store.js` (the caps and their text), the farming pack (`!harvest` of cane) |
| R-6 | `!farmCycle` started inside the house said "could not reach 48 ripe plants" on an open, flat field; from outside it worked. | the farming pack (leave the building through its door before the walk to the farm, as the shelter code does) |
| R-7 | `!mineOre("iron", 16, true)`: after one good run (8 raw iron in 2 min), 3 runs in a row ended "I stopped because I got stuck" with 0 iron, each after storing items in the mine chest and climbing to the surface, and the log gives no reason (maybe the race of G-2 of 0.1.4.15, maybe another); with a mine known, `new_mine` true still walks to the old mine; underground in a forgotten mine it says "A new mine starts from the surface", although Q1 of 0.1.4.13 says the spot becomes a mine; a new shaft at (-2337, 65, 860) stopped after 4 blocks with "lava, water or caves block the way down" where a read-only scan saw solid rock from y 10 to 62 within 6 blocks. | `mining.js` (the stuck reason into the text and the log; the `new_mine` flag; the underground start; the way-down check), `mine_logic.js` |
| R-8 | `!goToBed` near the trading hall chose villager beds ("All beds nearby are taken"); once "I stopped at the door", then it got in on its own retry. | `sleep.js` (the bot's own bed and the home's bed first; a bed in a trading hall or a villager's house never) |
| R-9 | The pen guard refused feeding pigs over the fence with `bot.activateEntity` from `!newAction` at (-2293, 64, 835), 3 blocks from the pig pen's gate: "That is a pen with 5 pigs; I do not open its gate"; it worked from (-2295, 64, 835) holding a carrot; cows, sheep and chickens worked over the fence. The owner wants breeding: feed from outside only, never through a gate, item pickup off near the pens, skip animals out of reach. No breeding command exists; a candidate pack. | the gate rule of the pen guard (`doors.js`, `area_kinds.js`: a feed over the fence is no gate opening), a `breeding` pack |
| R-10 | Still there: `bot.dig` fails with `enchantments.concat is not a function` while holding an enchanted diamond pickaxe (Q-5). | `patches/mineflayer+4.39.0.patch` (`digTime`), prismarine-item's `enchants` on 26.1 |
| R-11 | The bot's own model said it was night by day once, and started `!collectBlocks("stone", 10)` by itself on the surface. | `full_state.js` (the clock line, Q-3), the idle behaviour of the model |
| R-12 | The supervisor's `run` commands still echo into the game chat, including the code of `!newAction` (Q-4). | `watch/queue.js` (`runQuiet`), `agent.js` (`routeResponse`) |
| R-13 | Two deaths in caves under the old mine, both from supervisor orders (`!collectBlocks` underground), not from the bot. The owner decided that mining is too dangerous for the bot alone; his routine "maintain base" excludes it. | `collectBlocks` underground (the caves row of the 0.1.4.16 list), the supervise skill |

### Three packs for 0.1.4.16 (the owner's brief of 2026-11-11, relayed by his gameplay session; not started)

Beside the fixes of the play above. Each pack gets its own switch, off by default. The work does not start until
the owner says so. The sizes are the gameplay session's words to the owner: about a day each, the AFK kill pack
with a world test, enchanting with a test world that needs a table and XP by commands.

| Pack | The owner's brief |
|---|---|
| AFK creeper kill (switch `afk_kill`) | The farm: the owner's creeper farm tower at about (-2276, 870); the tier floor at y 197, the roof at y 200; the drop shaft has water at y 190, so the creepers land on the hoppers at y 170 to 171 with little health left, and a slab between them and the killer keeps them from exploding (intended, never to be "fixed"); the kill room at about (-2275, 170, 870) with the hoppers and 2 chests at y 170, z 870 to 872. The job: climb the tower ladder to the kill room and stand at the kill spot under the slab; hit only the hostile mobs in reach that stand on the hoppers, one hit each (sword); collect the XP orbs and the drops; put the gunpowder and the other drops into the hopper chests; eat when hungry; stop at a set time or level, or when the owner says stop. Safety: `creeper_safety` must be off at the kill spot (the creepers are 1 block away) or the bot flees; never leave the kill room except by the ladder; stop when health falls below a threshold. A rule for the owner and the docs: while the bot farms, the owner is more than 128 blocks from the tower or offline, since both players' bubbles share the monster cap (on 2026-11-11 the farm gave almost nothing while the bot stood near the tower). The XP: level 30 needs 1,395 XP, a creeper gives 5, so about 280 creepers. |
| Enchanting (switch `enchanting`) | Mineflayer's `bot.openEnchantmentTable(block)`: put in the item and the lapis, read the 3 offers, choose by the owner's preference (default the highest offer the levels allow), `enchant(choice)`; optionally the anvil (`bot.openAnvil`) to combine books. The lapis comes from the owner's chest (the valuables chest at (-2299, 63, 816) holds 55). The owner may not have a table with 15 bookshelves yet: the pack says what is missing ("no enchanting table within 32 blocks", "level 12, need 30") and never crafts or places a table without the owner's order. The 26.1 item components: `bot.dig` already fails with `enchantments.concat is not a function` on an enchanted pickaxe (R-10); reading enchantments must work with the 26.1 format. |
| Breeding (switch `breeding`) | Feed the animals only from outside a pen, never through or at a gate: wheat for cows and sheep, carrots for pigs, seeds for chickens; skip the animals out of reach, wait 5 minutes per animal, cap the number per pen. Item pickup off near the pens and on again after; never place a block in a pen or by a gate. Pigs come to the fence when the bot holds a carrot for a few seconds. The pen guard refused a feed 3 blocks from a gate (R-9): feeding must be allowed, opening must not. The owner's pens are saved areas: the sheep, cow, chicken and pig pens on z 836 to 841, the gates on z 836, the feed row z 835. |

## The base survey (brief of 2026-11-09; built in 0.1.4.15)

From the owner's gameplay session of 2026-11-09, relayed to the lead with the owner's decisions; the plan and the
spec are written under `docs/releases/<version>/` when the owner says so. The problem in the owner's words: each
time the bot comes to a base the owner has to stand it at every place and name it, which is tedious and broken
today (an unfenced farm cannot be saved; the house was saved as a pen because of 2 cats). The last base: a house,
a villager trading hall, three unfenced farms (potatoes, carrots, wheat), three fenced pens (pigs, cows, chickens),
a happy ghast leashed to a fence gate, sugar cane by the shore; underground a basement under the house, a ladder,
then a mine or a cave entrance. The owner will move between several bases.

The owner's decisions: (1) the survey may read the loaded blocks around the bot (the one exception to the no-x-ray
rule of v0.1.4.13; its block getter refuses ore names, so it can never find ore); (2) save first, then ask: every
place found is saved at once with source `survey`, one report line, and the owner corrects by name ("rename X to
Y", "forget X"); never a dialog that holds the result back; (3) plain words in the chat ("here is the base, scan
it") map to `!surveyBase`, no automatic trigger in the first version; (4) the underground is part of the base.

| Round | Content | Where |
|---|---|---|
| 1 | The defects without a switch: pets (cat, wolf, parrot) do not make a pen and a home is judged before a pen (`kindOf`); `!rememberArea(name, "farm")` without a fence saves the connected farmland at the bot's feet as an open farm. The wrong "carrot_farm" pen over the owner's house in his `areas.json` is his to forget once the commands exist. | v0.1.4.14 fix round part 8 (DECISIONS P-18) |
| 2 | A `survey` pack (`src/agent/packs/survey/`: `survey_logic.js` pure, `survey.js`, `texts.js`, `index.js`), switch `base_survey` (off), `survey_radius` (48; the owner's last base needs 64), zero model calls. One pass over the loaded blocks for seeds (farmland and crops, fence gates and fence loops, doors and beds and chests and furnaces and workstations, villagers at job sites, sugar cane by water, a leashed entity with its knot, a nether portal, trapdoors and ladder columns); seeds to places with the area code (`fieldBox`, `scanPenBehindGate`, `scanEnclosure` in building mode with floors, `kindOf`, the places store), names by the main crop or the majority species (`potato_farm`, `cow_pen`), a new kind `trading_hall`, dedupe through `AreaStore`; the underground from each building: the trapdoor and ladder to the basement (a building, shelter), openings in its rock walls to a mine entrance (a place and a route) or a cave mouth (keep-out), the way house, trapdoor, ladder, basement, mine in the `RouteStore`. Save all with source `survey` and a `base` tag, one line: `I found 12 places: house (2 beds), basement (9 chests, 5 furnaces), trading hall (7 villagers), potato farm 14 x 9, ... All saved. Say "rename X to Y" or "forget X" to correct.`; `!renameArea(old, new)`, `!forgetArea(name)`. Tests: a unit test per detector on synthetic grids, one end-to-end scenario on the fake server with a tiny base, one world test with a built base (house, trapdoor, ladder, basement, a tunnel, an unfenced farm, a pen, cane). To verify there: the climb of a ladder through a trapdoor. | The survey release |
| 3 | The `base` tag and `bases.json` per world (name, centre, dimension), `!goToBase(name)` to its home door, a survey on return reports the differences only; later an offer on arrival behind `survey_offer` and a walk for bases larger than the loaded radius. | The same release if it fits |

Also: the supervise skill's step 3 gets the base from one `run ['!surveyBase("east")']` and `places`; texts plain and
short with numbers, nothing claimed that the code did not check.

The owner's answers of 2026-11-09 to the lead's questions: the survey scans everything the server has loaded around
the bot, capped by `survey_radius` with 128 as the default (64 was already the ceiling of his last base); the
survey saves all at once and the owner's words are respected: an area the owner saved or named himself is never
renamed, re-boxed or forgotten by a survey (unless the attempt failed and the bot said so, or the owner says so
explicitly), the survey adds what is new and says where its finds lie inside the owner's areas; only a survey's own
places are updated by a later survey. Testing: the scenarios of both features run once each as they land, the full
world set once in the gate at the end for both together; the fake server carries what it can.

## Backlog

Ordered by recommendation. Nothing here is decided.

| # | Idea | Why |
|---|---|---|
| 1 | Journal and scorecard | Each session leaves a record that a script can read. The analysis of a play test takes minutes, not hours. |
| 2 | Stronger chat model, paid by prompt caching | To be measured. |
| 3 | Saved lessons | A recorded round is replayed on order. The bot checks the world before each step. |
| 4 | Guides of big goals | A short file per big goal, ten lines: the milestones in order, each with the state that code checks (an iron pickaxe in the inventory, 5 diamonds, the portal lit). The model plans only the next milestone; the skills do the work; the player edits the file. The guide is also the list of skills to build: smelting, trading, the Nether. "Beat the game" first. Stashed on 2026-10-01 until the job of v0.1.4.10 and smelting exist. |
| 5 | Review after the session | A strong model reads the journal after play and proposes rules and corrections. The player approves. |
| 7 | New skills from a record | The strong model writes a skill from what it watched. The player approves each one. Experimental. |
| 8 | Learned skills on top of the coded ones | The skill library of 0.1.4.4, with approval for each skill. |
| 9 | Vision | A look on request. An experiment. |
| 10 | Building from a blueprint | The owner's wish of 2026-10-04. The original project has blueprints for its construction tasks (`src/agent/tasks/construction_tasks.js`: levels of blocks with coordinates, `Blueprint.explain` and `Blueprint.check`), reachable only through the four blocked commands of a task. A skill of the fork: "build me a 5 by 7 house" gets a blueprint from a file under `blueprints/` or from the model once, says the material it needs, places it level by level with every safety rule and checks each level against the world as the task check does, then says what is missing. Next to `!buildWatched` of v0.1.4.12, which builds the rest of what the owner started. |

### Small items

| Item |
|---|
| When a chat message is deleted by the server, the network library forgets which messages it has seen. |
| Pull requests for the original project: text-to-speech without a shell, the sandbox, the chat checksum. |

## Open decisions

| Decision | Options |
|---|---|
| What the bot is first | A companion in the base, or a player that pursues the game |
| Chat model | Haiku 4.5, or another model after a measurement |
| Rules and skills the bot learns | Ask before keeping, or keep and tell |
