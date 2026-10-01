# Roadmap

State of 2026-09-30. This file lists what is planned for the fork and in which order. `CHANGELOG.md` lists what is released.

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
| 0.1.4.10 | Goals | Planned |
| 0.1.4.11 | Understanding and watching | Planned, both trials passed |
| Later | See the backlog | Not decided |

## 0.1.4.9 The mine, the routes of the player, and the model comparison

Released on 2026-09-30; `CHANGELOG.md` says what it contains. Left for later: a mine named with a number collides with the mines the bot dug itself; `ore_sense_range` accepts 1 and 2 as well as 0 and 3; a plain `!goToCoordinates` into the mine still stands on the closed trapdoor (the path search of v0.1.4.7), while `!goToRememberedPlace` walks the learned route.

## 0.1.4.10 Goals

From the play of 2026-10-01: the bot mined well until it ran out of torches, then waited for an order at every step while the owner guided it to wood, planks, sticks and torches, and never came back to the mining by itself. The goal mechanism of the original project (`!goal`) is a loop of the model that any message of the player ends, and the model has to be told to use it.

| Part | Content |
|---|---|
| The job | An order with a result that code can check is a job: mine 16 iron, farm the wheat, get 8 logs, make 32 torches. The bot keeps one current job with its state (6 of 16 iron, in the mine "mine"), on disk. An ordinary order becomes the job by itself; "set yourself the goal: ..." sets one explicitly, for the bigger ones. The player never has to say it. |
| Errands do not end the job | "Follow me", "come here", "check the chest", "wait", "go to bed" are errands. When nothing more comes for about 20 s and nothing runs, the bot returns to the job by itself: `I go back to the mining, 6 of 16 iron.` Code decides, no call of the model. |
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
| Down a ladder | A move of one rung down when the block below is a ladder or a vine; the bot slides when the next point is lower. The path search then descends a shaft by itself, and the ladder code of the packs becomes the fallback. |
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

## 0.1.4.11 Understanding and watching

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

Result of the trial on a real 1.21.8 server: 40 of 40 placed blocks and 60 of 60 broken blocks recorded with the right place and name; with two players who build in the same space, 320 of 320 blocks credited to the right player. Limits: the player of the trial was a second bot; crediting needs 16 blocks or less; the bot never sees crafting, the content of a chest that the player uses, or the inventory of the player.

## Backlog

Ordered by recommendation. Nothing here is decided.

| # | Idea | Why |
|---|---|---|
| 1 | Journal and scorecard | Each session leaves a record that a script can read. The analysis of a play test takes minutes, not hours. |
| 2 | Stronger chat model, paid by prompt caching | To be measured. |
| 3 | Saved lessons | A recorded round is replayed on order. The bot checks the world before each step. |
| 4 | Long goals as a plan on disk | Steps that code verifies. Milestones: iron tools alone, diamonds, the Nether. |
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
