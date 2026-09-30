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
| 0.1.4.8.1 | Model comparison | Planned, small |
| 0.1.4.9 | The mine and the routes of the player | Planned |
| 0.1.4.10 | Understanding and watching | Planned, both trials passed |
| Later | See the backlog | Not decided |

## 0.1.4.8.1 Model comparison

A small release of tools. It changes nothing while Claude is the chat model.

| Part | Content |
|---|---|
| Cost meter | Models of OpenAI report their tokens. Prices for GPT-6 Luna. |
| Routing check | A model of OpenAI can be chosen. The table also shows the time per answer and the measured cost. |
| Launch script | It takes a profile and loads the key that the profile needs. |
| Profile | The prompt of the owner with GPT-6 Luna as chat model. |

Why: a first play with GPT-6 Luna showed answers after about 3 seconds against 1 second with Haiku 4.5, at a tenth of the price. The choice of commands was not measured. The routing check measures it with the same sentences for both models.

## 0.1.4.9 The mine and the routes of the player

The bot learns a place by walking through it with the player. Code stores it as a route. The language model never has to understand what a tunnel is.

| Part | Content |
|---|---|
| Trail | The bot records the steps it walks, on disk. No call of the model. |
| "This is the mine" | The trail from the last point under open sky becomes the route. Chest and crafting table around the bot become the room. |
| Routes inside the base | The same for the ways between floors, for example from the storage room to the bed. The path search finds no way through a ladder with a trapdoor; a route that the bot walked once with the player is walked again step by step. |
| "Dig here" | The bot measures the tunnel: start, direction, end. It digs on at the end, straight, 1 wide and 2 high. |
| Work | `!mineOre` takes the nearest known mine and a tunnel that fits. It asks before it digs a new shaft. |
| Ore list | Every ore block seen and left behind, with kind, position and reason. |
| Setting `ore_sense_range` | 0: only ore that touches the tunnel. 3: also ore within 3 blocks of the wall. Default 0. The bot knows every block of the loaded area, also behind rock; this setting decides how much of that it uses in a mine. |
| Own code of the model | `!newAction` is refused for digging where a skill exists. |
| Where am I | One line in the prompt: area, tunnel, depth. |

## 0.1.4.10 Understanding and watching

### Part A: the bot picks better examples

Before each call of the model the bot puts 2 of its examples into the prompt. Two steps of this part are released with 0.1.4.8: examples for the commands that had none, and the choice by the last request of the player (`examples_by_last_request`).

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
