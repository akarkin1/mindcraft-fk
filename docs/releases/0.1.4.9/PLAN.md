# Plan v0.1.4.9 "The mine, the routes of the player, and the model comparison"

Based on `docs/releases/0.1.4.9/BRIEF.md` (your decisions and the facts of the play tests up to 2026-09-30) and on the code of v0.1.4.8.

You have not play tested v0.1.4.8 yet. When you attach logs, I analyse them first, and the defects go into this release before the new parts.

## 1. Goal

| After this release | Today |
|---|---|
| You walk the bot through your mine once and say "this is the mine". From then on `!mineOre` uses your mine. | `!mineOre` knows only mines it dug itself. It asks for a new one. |
| You say "dig here" in a tunnel. The bot digs on at its end, straight, 1 wide, 2 high. | The model writes its own tunnel code. Six versions in one play test, one dug the wrong way. |
| The bot walks a way it learned from you: down a ladder with a trapdoor, from the storage room to the bed. | The path search finds no way down a ladder, and no way to your bed. |
| The bot knows what ore it left behind and why, and fetches it on order. | Ore beside the tunnel is taken or lost, nothing is remembered. |
| `!cost` counts GPT-6 Luna. The routing check compares Luna with Haiku 4.5 in accuracy, speed and cost. | `!cost` shows 0 for OpenAI models. The routing check runs only Claude. |
| The test server comes with one script. | It was set up by hand. |

## 2. Your decisions that this plan uses

| Decision | Your answer |
|---|---|
| Tunnels | 1 wide, 2 high. The bot asks before a new shaft. |
| `ore_sense_range` | 0 or 3, default 0. Also for `!collectBlocks` with an ore. |
| Safety reflexes | Only you switch them, as in v0.1.4.8 |
| The model's own code | Refused for digging where a skill exists |
| Model comparison | Luna only, not Sol. Reasoning effort low. |
| Engineers | Opus 5.5, at most three at a time |
| Your files | I change `start-claude.ps1` (it gets `-Profile`) and `profiles/gpt.json` (the release wins, you set your values again). `settings.js` and `profiles/claude.json` stay as they are. |

## 3. Decisions I made, say if one is wrong

| Question | My answer |
|---|---|
| Where a route starts | At the last saved place, area or mine the bot passed before you said "remember this way". You walk from the storage room to the bed and say "remember this way to the bed": the route goes from the storage room to where the bot stands. A route is walked in both directions. |
| Where the mine starts | At the last step of the trail under open sky. Everything from there to where the bot stands is the way in. The chest, the crafting table and the furnace within 6 blocks of the bot are the room. |
| A mine with several tunnels | One mine holds several tunnels, each with its own level. `!mineOre` takes the tunnel whose level fits the ore best. |
| A broken route | The bot says at which step it could not go on, with the position, and asks you to show the way again. It digs nothing. |
| Side branches | When the main tunnel is 32 blocks long, the bot digs branches of 8 blocks to the left and to the right, every 4 blocks, nearest to the room first. |
| The ore list | Kept per mine in `mines.json`, at most 200 entries. Each entry: the ore, the position, the reason. "Collect the coal you passed" is the command `!collectPassedOre("coal")`. |
| Dig code of the model | With `skills_over_code` on, a request to `!newAction` that asks for digging, a tunnel, a shaft or mining is refused with a text that names the skill. Other code is written as before. |

## 4. Content

### Package 1: Trail and routes

| # | Change |
|---|---|
| 1.1 | The bot records where it walks: each block it stood on, the ladders it climbed, the doors, gates and trapdoors it passed. The last 500 steps, in `trail.json` in the folder of the world. No call of the model. |
| 1.2 | "Remember this way to the bed": `!rememberRoute("bed")`. The trail since the last known place becomes a route: short walks, ladders, doors. The bot answers with the start, the end and the number of steps. |
| 1.3 | `!routes` lists the routes. `!forgetRoute` removes one. |
| 1.4 | `!goToBed`, the shelter walk and `!goToRememberedPlace` use a route when the path search finds no way. The bot walks the route step by step: short hops with the path search, ladders by the control states of the mining pack, doors and trapdoors by the door skills. |
| 1.5 | A broken route: the bot stops, says where, and asks you to show the way again. |

### Package 2: Your mine

| # | Change |
|---|---|
| 2.1 | "This is the mine": `!rememberMine("mine")`. The way in from the last point under open sky becomes the route of the mine. Chest, crafting table and furnace near the bot become the room. The area of type `mine` that holds the bot is linked to it. |
| 2.2 | "Dig here": `!rememberTunnel`. The bot measures the tunnel it stands in: start, direction, end, level. It reads the direction from the corridor of air, else from where you look. |
| 2.3 | `!mineOre` takes the nearest known mine within 64 blocks, walks its route, picks the tunnel whose level fits the ore, and digs on at its end. Lava, water and caves are closed as in v0.1.4.7. A new shaft only when no mine is known, and only after you said yes. |
| 2.4 | Side branches when the main tunnel is long (section 3). |
| 2.5 | The ore list: every ore block seen beside the tunnel and not taken, with the reason: wrong pickaxe, lava beside it, inventory full, vein limit. `!collectPassedOre("coal")` walks back along the tunnel and takes it. `!mineOre` says at the end what it left behind. |
| 2.6 | `ore_sense_range`: 0 takes only ore that touches the tunnel; 3 also takes ore within 3 blocks of the wall, through a short side cut. `!collectBlocks("iron_ore")` with 0 takes only ore with a face in the open. |
| 2.7 | In a mine area or on the route of a mine the bot counts as underground: no shelter walk at dusk, creepers only in sight. |
| 2.8 | `!newAction` is refused for digging where a skill exists. |
| 2.9 | The block "what I know" in the prompt says the mine and the tunnel the bot is in, and the ore left behind. |

### Package 3: Model comparison

| # | Change |
|---|---|
| 3.1 | The cost meter counts the models of OpenAI: input, output and reasoning tokens. Prices for GPT-6 Luna and the embedding model. `!cost` shows them. |
| 3.2 | The routing check takes a model of OpenAI: `--model gpt-6-luna`. The table shows per sentence the command chosen, and at the end the accuracy, the time per answer and the measured cost. Only you run the real one. |
| 3.3 | `start-claude.ps1 -Profile .\profiles\gpt.json` loads the keys the profile needs from your vault, by name. Without `-Profile` it works as today. |
| 3.4 | `profiles/gpt.json`: your prompt with one house rule, `speak_model` system, reasoning effort low, the code model of the claude profile. |

### Package 4: Test server

| # | Change |
|---|---|
| 4.1 | `node scripts/get_test_server.js --accept-eula`: downloads the official 1.21.8 server through Mojang's manifest, checks the SHA-1, writes `eula.txt`. Without the flag it only downloads. |
| 4.2 | `tests/world/README.md` documents `MC_TEST_SERVER_DIR` and `MC_TEST_JAVA`. |

### Package 5: Tests

| # | Change |
|---|---|
| 5.1 | Unit tests from the spec by an independent tester. |
| 5.2 | The test base gets a mine like yours: a second bot walks the bot in as the player. |
| 5.3 | About 14 scenarios on the real server, with all reflexes on: remember the mine, dig here, mine in a known mine, the ore list, the route to the bed, the shelter by a route, a broken route, dusk on the mine route, the refusal of dig code, `ore_sense_range` 0 and 3, the switches off. |
| 5.4 | The long run of 30 minutes stays green, with the new parts on. |

## 5. New settings

All off by default. The play test guide says which to switch on.

| Setting | Off means | On means |
|---|---|---|
| `routes_pack` | No trail, no routes | The trail is recorded, `!rememberRoute` and `!routes` exist, `!goToBed` and the shelter use routes |
| `trail_max_steps` | 500 steps kept | The number you set |
| `mine_routes` | `!mineOre` as in v0.1.4.8 | With `mining_pack` and `routes_pack`: `!rememberMine`, `!rememberTunnel`, `!collectPassedOre`, the work in your mine, the side branches, the ore list |
| `ore_sense_range` | 0: only ore that touches the tunnel or has a face in the open | 3: also ore within 3 blocks of the wall |
| `skills_over_code` | `!newAction` writes code for everything | `!newAction` refuses digging where a skill exists |

The cost meter for OpenAI, the routing check, the launch script and the test server script have no switch. The line about the mine in "what I know" comes with `knowledge_in_prompt`.

## 6. Cost

| Item | Effect |
|---|---|
| Five new commands in the prompt | About 500 characters. The prompt is at 16,807 of 17,000 characters with every switch on (10,524 with every switch off). I shorten descriptions to stay under the limit and tell you the sizes. |
| One more line in "what I know" | About 60 characters |
| The trail | A file write every 5 seconds, about 40 KB. No model call. |
| Routes, "this is the mine", "dig here", the ore list | Code only. No model call. |
| The work in your mine | Longer trips, no more calls of the model per trip than today. |
| The routing check with a real model | Costs money each run: 136 sentences per model, each with the whole prompt. Only you run it. About 1 dollar per run with Haiku 4.5, about 10 cents with Luna. |
| The engineers | About 10 hours of Opus 5.5 sessions plus 3 full runs on the real server of 75 minutes each. |

Expected cost in play: about the same as today, 1.50 to 1.70 dollars per hour with Haiku 4.5.

## 7. What this release does not contain

| Topic | Where |
|---|---|
| The local embedding model, learning by watching | v0.1.4.10 |
| Smelting | Backlog |
| A patch of `bot.wake()` and of the path behind a door | Backlog |
| The area `home` that follows the shaft down | Known limit of v0.1.4.8, stays |
| Sol, or any model but Luna, in the comparison | Not planned |

## 8. Estimate

| Package | Size | Hours |
|---|---|---|
| 1 Trail and routes | Large | 3 |
| 2 Your mine | Large | 3 |
| 3 Model comparison | Medium | 1.5 |
| 4 Test server | Small | 0.5 |
| 5 Tests, with the runs on the real server and the fix round | Large | 3 |

About 11 hours with three engineers at a time. The three world runs alone take about 4 hours of that. Packages 1 and 2 run first and together, 3 and 4 beside them. If the release gets too long, I cut the side branches and `ore_sense_range` 3 first, and tell you.

## 9. What I cannot test

- **Your mine itself.** The test base gets a mine built like yours (ladder with trapdoor, room, descent, tunnel), but not your world. The proof is your play: "this is the mine", then "find some iron".
- **A real model.** My tests give the commands directly. The routing check with Luna runs only on your machine.
- **The chat kick of v0.1.4.8.** Still only proven by unit tests.

## 10. What I need from you

| Item | Why |
|---|---|
| Your "go" | To start the engineers |
| A "no" to any row of section 3 | Before the spec is written |
| Later: the logs of your play test of v0.1.4.8 | Its defects go in before the new parts |
