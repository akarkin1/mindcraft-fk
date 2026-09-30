# Plan v0.1.4.8 "Stability"

Based on your play test of 2026-09-29 (two sessions, 117 minutes, 20 restarts) and your decisions of the same day.

## 1. Goal

| After this release | Today |
|---|---|
| Two hours of play without a restart | 20 restarts in two hours |
| The bot eats by itself and tells you when it has no food | It starved with food in its hand |
| It breaks nothing that you built | It broke the fence of the pen |
| The reflexes know where the bot is | Shelter reflex in the shaft, creepers through 40 blocks of rock |
| A work skill finishes its job with all reflexes on | `!mineOre` never ran to the end |

## 2. Your decisions that this plan uses

| Decision | Your answer |
|---|---|
| Order | Stability first, your mine after it (v0.1.4.9) |
| New shaft | The bot asks before it digs one |
| Tunnel shape | 1 wide, 2 high |
| X-ray in the mine | A setting: off, or 3 blocks. Off by default. Comes with v0.1.4.9. |
| List of ore left behind | Yes. Comes with v0.1.4.9. |
| Safety reflexes | Only you switch them off |
| Scope | You did not answer. I take my recommendation: all six packages in one release. |

**How "only you" works.** A command that you type in the chat yourself runs without the model. So the rule is: what only you may do, you type as a command. The model gets a refusal with that explanation.

## 3. Content

### Package 1: Stability

| # | Change | Finding |
|---|---|---|
| 1.1 | A work skill pauses `unstuck` while it runs. Each skill has its own time limits and answers with a text when it cannot go on. | S1, S15 |
| 1.2 | `unstuck` also counts as progress: the inventory changed, a chest is open, the bot eats or sleeps. | S1 |
| 1.3 | When the escape fails, `unstuck` gives up: it stops the command and tells the model where the bot is stuck. The process restarts only after several failed escapes in a row. | S1, S2 |
| 1.4 | The escape opens doors and gates. | S11 |
| 1.5 | A stopped command always answers: what it did so far, and who stopped it. | S3 |
| 1.6 | A stop really stops the path search, and it stops the writing of new code. | S9, S10 |
| 1.7 | An older `!followPlayer` does not come back after a newer command. A stopped `!newAction` starts no second turn of the model. | S4, S5 |
| 1.8 | The chat kick at your 21st message: patch of the network library. | S12 |
| 1.9 | After a restart the bot is told its last order and why the process ended. | S6 |
| 1.10 | The cost limit counts per launch, across restarts. | S7 |
| 1.11 | The same command failing with the same arguments is refused the third time. The bot asks you instead. | 20 eat attempts |
| 1.12 | When the model answers nothing, the result text of a skill goes to the chat. | 66 silent answers |
| 1.13 | Time stamps in the log. | S8 |

### Package 2: Eating and health

| # | Change | Finding |
|---|---|---|
| 2.1 | Food stays in the main inventory. At the start the bot moves food out of the off-hand. | E1 |
| 2.2 | `!eat`, `!consume`, `!discard` see the off-hand. `!inventory` says what is in the off-hand. | E1 |
| 2.3 | The bot eats until health can come back (food level 18), and until full when it is hurt. | E2, E4 |
| 2.4 | Hunger reflex: with no food, the bot fetches food from the chests it knows. When there is none, it tells you, once at "hungry" and once at "starving". No model call. | E3 |
| 2.5 | Starving no longer makes the bot run 20 blocks out of the house. | E5 |
| 2.6 | With low health the bot does not chase a monster, it retreats. | E6 |

### Package 3: Your property

| # | Change | Finding |
|---|---|---|
| 3.1 | Blocks that players build with are safe everywhere: fences, gates, doors, planks, glass, chests, beds and the like. This holds for collecting, for code of the model, and for the path search. Exceptions: blocks the bot placed itself, and a command you type yourself. | P1 |
| 3.2 | New area types: `home`, `mine`, `pen`. In a `mine` the bot may dig rock and never breaks what was placed. | P3 |
| 3.3 | Your house becomes an area. At the start the bot scans the building at the place "home", saves it, and tells you the size and the doors. | M5 |
| 3.4 | The shelter is only an area of type `home`. | R2 |
| 3.5 | Dropped items: the bot tries again after the pick-up delay. New command `!pickUpItems`. | P2 |
| 3.6 | `!rememberArea` walks in through the gate when the bot stands outside, and says why when it fails. | P5 |
| 3.7 | The model cannot shrink a saved area. The names "mining area" and "mining_area" count as one. | P4, P7 |
| 3.8 | The farm scan no longer takes a room for a farm. | P6 |

### Package 4: Reflexes

| # | Change | Finding |
|---|---|---|
| 4.1 | New depth check: the bot compares its height with the ground around it, not with the column above it. In a saved mine it always counts as underground. | R1 |
| 4.2 | The shelter reflex waits while the bot is underground. | R1, M8 |
| 4.3 | A creeper counts only when it can reach the bot: about the same level, and no rock in between. Areas of type `mine` are not defended. | R3 |
| 4.4 | Doors are closed after every walk, also the walks of the reflexes. Gates and trapdoors included. Each closing is a line in the log. | R5, R6 |
| 4.5 | New command `!closeDoor`. | R7 |
| 4.6 | The model cannot switch off `creeper_safety`, `night_shelter`, `door_closing`, the hunger reflex and `self_preservation`. | R4 |
| 4.7 | `!goToBed` by day says when the night starts. | sleep loops |

### Package 5: Chests, farm, tools, mining minimum

| # | Change | Finding |
|---|---|---|
| 5.1 | A short block "what I know" in the prompt: chests with their main content, areas, mines, where the bot is. | C1 |
| 5.2 | `!chests("wheat")` answers from memory where an item lies and how many. | C2 |
| 5.3 | A chest view is never cut in the middle. | C3 |
| 5.4 | The chest at the fence opens. | C4 |
| 5.5 | `!givePlayer` fetches from a chest when the bot does not carry the item. | C6 |
| 5.6 | `!farmCycle` does the whole round: harvest, plant, store, get bone meal, fertilize, harvest again. For bone meal it looks into its inventory, then the chests, then picks leaf litter and flowers near the farm. It fetches or crafts a hoe. Seeds are never composted. | F1, F2 |
| 5.7 | The texts name the next step and no longer send the model away for flowers. | F3, F7 |
| 5.8 | `!chopTrees` picks up the logs as it goes and when it is stopped. It gets an axe first. | T1, T4 |
| 5.9 | `!getTool` counts what lies in the chests. Without a material it makes the best tool it can. | T3 |
| 5.10 | `!mineOre`: says what it prepares, takes only the ladders that are missing, asks before a new shaft, never digs near the house, never takes a cave floor as entrance. | M1, M2, M4 |

### Package 6: Tests

| # | Change |
|---|---|
| 6.1 | Every scenario on the real server runs with the reflexes of your profile on, through the chat command. |
| 6.2 | A test base like yours: a house that is not saved, a mine under the house with trapdoors and ladders, a farm with composter and chest at the fence, a pen with animals. |
| 6.3 | About 20 new scenarios, one per defect of this list. |
| 6.4 | One long run of 30 minutes with mixed orders. It fails when the process ends once. |

## 4. New settings

All are off by default, as always. The play test guide will tell you which to switch on.

| Setting | Off means | On means |
|---|---|---|
| `stuck_restart_after` | 1: restart after the first failed escape, as today | 3: give up twice, restart the third time |
| `protect_built_blocks` | Built blocks are safe only in saved areas | Safe everywhere |
| `knowledge_in_prompt` | Chests only behind `!chests` | The block "what I know" is in the prompt |
| `repeat_guard` | 0: no check | 3: the third identical failure is refused |
| `restart_context` | After a restart the bot knows only its memory | It is told its last order |
| `say_results` | Silence when the model answers nothing | The result text goes to the chat |
| `flee_below_health` | 0: the bot fights at any health | 8: it retreats below 8 of 20 |
| `log_timestamps` | No time in the log | A time stamp per line |

The hunger reflex is a part of `home_pack`, as `home_reflexes.hunger`.

Everything else in section 3 is a correction of a defect and has no switch.

## 5. Cost

| Item | Effect |
|---|---|
| Block "what I know" | About 150 tokens per call |
| Two new commands | About 100 tokens per call |
| Refused repeats, results instead of silence | Fewer calls. Today 5 to 6 per minute, many of them repeats. |
| Expected cost | About the same as measured: 1.50 to 1.70 dollars per hour |

The prompt has 16,080 of 17,000 characters today. I will shorten existing descriptions to make room, and tell you the new size.

## 6. What this release does not contain

| Topic | Release |
|---|---|
| Your mine: trail, route, room, tunnels, "dig here" | v0.1.4.9 |
| List of ore left behind | v0.1.4.9 |
| Setting `ore_sense_range`, 0 or 3 | v0.1.4.9 |
| No own tunnel code of the model where a skill exists | v0.1.4.9 |
| Smelting | Not planned yet |

## 7. Estimate

| Package | Size | Hours |
|---|---|---|
| 1 Stability | Large | 2.5 |
| 2 Eating | Medium | 1 |
| 3 Property | Medium | 1.5 |
| 4 Reflexes | Medium | 1.5 |
| 5 Chests, farm, tools | Large | 2 |
| 6 Tests, with the runs on the real server | Large | 2 |

With three engineers at a time this is about 8 hours. Package 5 comes last. If the release gets too long, I cut it there and tell you.

## 8. What I cannot test

- **The chat kick.** The test server does not sign chat, so the kick cannot happen there. I test the patched function with unit tests. The proof is your play: more than 21 messages without a kick.
- **A real model.** As before, my tests give the commands directly.

## 9. What I need from you

| Item | Why |
|---|---|
| Your "go" | To start |
| Optional: the line with `claude` and `validate` from `.minecraft\logs\latest.log` of the play test | It confirms the cause of the chat kick |
