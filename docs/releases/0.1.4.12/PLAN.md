# Plan v0.1.4.12 "Understanding and watching"

Based on your scope of 2026-10-03, given the day v0.1.4.11 was released: the watch server and learning by watching as two pilots, smelting, the scans underground, the small items, two bots. The local embedding model waits for v0.1.4.13. Your play report of v0.1.4.11 comes later; its fixes join this release near its end.

## 1. Goal

| After this release | Today |
|---|---|
| I watch your play from the cloud: position, inventory, chat, the running command, the job, the saved places, and events, and I can step in with `say` | I read the log after the session |
| "Watch me", three fences and the gate, "continue like this, 7 by 10", "yes": the bot builds the rest | Nothing: the bot never learns from what you do |
| "Make me an iron pickaxe" with ore in the tunnel and coal in the chest: mined, smelted, crafted | `!smeltItem` of the original project puts one coal in the nearest furnace, or places one anywhere; no plan was ever tested on ore |
| In a corridor of rock the bot says it is in a tunnel of its mine, or says nothing | "I am in a walled storage 13 x 26 with 207 water blocks" |
| A bot that gets out of bed gets out; a dig in the first seconds after the spawn is done; a door is read before it is toggled; the path goes through the middle of a door it opens | Workarounds in the home pack, a 3.5 s wait in every test, `!useOn` toggles blind |
| Two of your bots in one world answer you, never each other | Each answers the other's echoes until you say `!stfu` |

## 2. Your decisions that this plan uses

| Decision | Your answer |
|---|---|
| The watch server | A pilot of the MCP idea; the testing routine stays as it is; the long goal is an autonomous mind over the bot for when you are away; the first step is observation and `say` |
| Learning by watching | In, as a second pilot; it learns from you and from a scripted teacher on the test server |
| Smelting | In, as it is medium: one round of an engineer |
| The small items | In, all but the deleted-message bookkeeping of the network library |
| The local embedding model | v0.1.4.13, measured first by the routing check |
| Our own solution | The MCP and supervision idea is borrowed; nothing else |

## 3. Content

### Package 1: The watch server (part C, a pilot)

| # | Change |
|---|---|
| 1.1 | A small server inside the bot's process, behind `watch_server`, on `127.0.0.1` and the port `watch_port` (8090). It speaks the MCP protocol over HTTP (JSON-RPC, no new dependency), so a Claude session lists and calls its tools. It starts only with a token in the environment (`MC_WATCH_TOKEN`, from your secret vault like the API key) and refuses every call without it. It never touches the game port. |
| 1.2 | Six tools, all read-only but the last: `state` (position, the block under the feet, dimension, time of day, health, food, the running command, the job line, the last order and when), `inventory`, `chat` (the last 10 lines, who said what, with the time), `places` (the areas with kind and box, the mines, the routes by name, the rules), `events` (the events since a time), `say` (one chat line, handled exactly as a line you type). |
| 1.3 | Events, kept 200 deep and sent to a listening session as they happen: an explosion within 16 blocks of a saved area; health dropped by 4 or more; animals missing from a saved pen against its record (checked once a minute while the bot is within 32 blocks); a night the bot stayed awake; a job without progress for 10 minutes; the same failure text 5 times; the bot farther than 100 blocks from home; the bot died; the process restarted. |
| 1.4 | `scripts/watch.js`: a command-line client for me (`node scripts/watch.js state`, `... say "come here"`), which is also how the tests call the server. |
| 1.5 | The guide: how you start it (the token, the setting), how you open the tunnel for one evening (a quick tunnel of cloudflared or ngrok, no account for the first), what I see and what I can do, and that your words stay the orders. |

### Package 2: Learning by watching (part B, a pilot)

| # | Change |
|---|---|
| 2.1 | "Watch me" → `!watchMe`: the bot comes within 16 blocks, keeps you in sight and records every block you place or break, with the place, the block and the time. No call of the model while it watches. Any order ends the watching. `I watch you.` |
| 2.2 | "Continue like this, 7 by 10" → `!continueLike("7 by 10")`: the bot finds the pattern in the record and says what it understood with the material it needs: `I understood: a fence 7 x 10 from (x, y, z) eastwards, the gate in the middle of the south side; 30 oak_fence and 1 oak_fence_gate more, I carry 12 oak_fence.` Patterns of this release: a line of the same block (`12 long`), a rectangle of fences with a gate (`7 by 10`), the first steps of a tunnel (`12 long`). Without a pattern: `I see no pattern in what you did: 3 blocks that lie on no line.` |
| 2.3 | "Yes" → `!buildWatched()`: the rest is built or dug with every safety rule (the protected areas, no digging in the house, nothing placed in a pen), the material fetched from a known chest when the bot has too little, and the result said as a skill says it: `I built the fence: 30 oak_fence and 1 gate. Say "this is the pen" to save it.` A stop keeps what is built. |
| 2.4 | The scripted teacher: the player bot of the test harness places the fences and digs the first steps itself, as you would, so every pattern has a journey that needs no owner. |
| 2.5 | Behind `watch_and_learn`. The record stays in memory until the next watching; nothing is written to disk. |

### Package 3: Smelting (part E)

| # | Change |
|---|---|
| 3.1 | `!smeltItem` behind `smelting` becomes a skill of the storage pack: the furnace of the room or the house, placed only in a saved area of kind storage, building or mine, never in a pen or a farm; fuel in the order coal, charcoal, planks, logs, as much as the batch needs; a batch of up to 64 in one go; the result read from the furnace, not assumed. |
| 3.2 | The texts: `I smelted 8 raw_iron into 8 iron_ingot in the furnace at (x, y, z) with 1 coal.`, `I have no fuel: no coal, charcoal, planks or logs.`, `I know no furnace within 16 blocks and carry none.`, `I stopped after 3 of 8: ...`. |
| 3.3 | A step `smelt` in the plan of a job: no iron pickaxe → mine 3 iron, smelt 3, craft the pickaxe; `!getTool("iron_pickaxe")` leads through it. The journey: "make me an iron pickaxe" with ore in the tunnel and coal in the chest of the room. |

### Package 4: The scans underground (part F)

| # | Change |
|---|---|
| 4.1 | A border of natural rock makes a cave or a tunnel, never a storage, a building or a yard; the water pockets of the rock are not contents. |
| 4.2 | Underground the scan is the measurement of the mining pack: `I am in a tunnel 2 wide and 23 long, heading west, of the mine "mine".`, or `I am in a cave at (x, y, z), 6 wide and open on 3 sides.` |
| 4.3 | The area sense underground names a tunnel it knows and stays quiet in a tunnel or cave it does not; it never asks for a name underground. |
| 4.4 | A scan runs in one pass and the bot stands still while it scans; it says so when it took more than 2 s. |

### Package 5: The small items (part G)

| # | Change |
|---|---|
| 5.1 | `bot.wake()` of mineflayer sends "leave bed" in the form of 1.21.6 and later: a patch file; the workaround of the home pack goes. |
| 5.2 | The bot sends `player_loaded` right after each spawn, so the server takes its actions from the first second; the 3.5 s wait of the tests goes. |
| 5.3 | The path search centres the points of a path behind a door it opens, as it does at the door itself. |
| 5.4 | `!useOn` on a door, gate or trapdoor reads its state first and says what it did: `I opened the door at (x, y, z).`, `The door at (x, y, z) was open already.` |
| 5.5 | `!endConversation` answers without the typing error; `!goToPlayer` for a player the bot does not see: `I see no player "Steve". The players I see: MartyByrde2.` |

### Package 6: Two bots (part D)

| # | Change |
|---|---|
| 6.1 | `other_bots`: the names of your other bots; a bot never answers chat from them and never answers a command echo (`*x used y*`) or a result of another bot, whoever sent it. |
| 6.2 | `bot_role`: one sentence in the prompt (`You are the farmer. gpt is the miner.`); a question to both gets one line from each; a job for the other bot is left to it: `That is gpt's job. I farm.` |
| 6.3 | The launch script of the second bot sets its own mindserver port; the guide says how to run two. |

### Package 7: Tests

| # | Change |
|---|---|
| 7.1 | Journeys, black box, written before the build and failing on v0.1.4.11: the watch server answers every tool and `say` makes the bot come; the events of an explosion and of missing chickens; "watch me" with a line, a fence 7 by 10 and a tunnel, the teacher being the player bot; "make me an iron pickaxe"; the tunnel named underground; a dig one second after the spawn; two bots and one question. They gate the release with the 21 of v0.1.4.9 to v0.1.4.11. |
| 7.2 | Unit tests of every text, of the pattern finder from recorded fixtures, of the events from staged facts, of the fuel choice, of the border rule. |

## 4. New settings

All off by default, as always.

| Setting | Off means | On means |
|---|---|---|
| `watch_server` | No server | The watch server on `watch_port`, with the token |
| `watch_port` | 8090 | The port of the watch server |
| `watch_and_learn` | No `!watchMe` | The three commands of package 2 |
| `smelting` | `!smeltItem` of the original project | The smelting of the storage pack and the step in a plan |
| `other_bots` | `[]`: the bot answers every player | The names it never answers |
| `bot_role` | `""`: no role line | The sentence in the prompt |

The scans underground and the small items are corrections and have no switch.

## 5. Cost

| Item | Effect |
|---|---|
| The watch server, the events, the recorder, the pattern finder | Code only. No model call. |
| `say` | One order, as yours: one call of the model per line |
| The role line | About 60 characters in the prompt of a bot with a role |
| The engineers | About 23 hours of sessions, three full runs on the real server |

## 6. What this release does not contain

| Topic | Where |
|---|---|
| The local embedding model (part A) | v0.1.4.13, after the routing check measures it |
| The supervisor that answers events by itself | After the pilot has shown how often I step in |
| The deleted-message bookkeeping of the network library | Backlog, until it costs a play |
| Guides of big goals, trading, the Nether | Backlog |

## 7. Estimate

| Package | Size | Hours |
|---|---|---|
| 1 The watch server | Large | 4 |
| 2 Learning by watching | Large | 6 |
| 3 Smelting | Medium | 3 |
| 4 The scans underground | Medium | 2 |
| 5 The small items | Medium | 2 |
| 6 Two bots | Small | 2 |
| 7 Tests, journeys, three full runs, the fix round | Large | 4 |

About 23 hours with three engineers at a time. Round 1: packages 1, 3 and 5. Round 2: packages 2, 4 and 6. Round 3: the journeys, the fix round, your findings of v0.1.4.11.

## 8. What I cannot test

- **The tunnel from your machine to the cloud.** The server and its tools are tested on the test server; the tunnel is yours, once, for an evening. The cloud session must be allowed to reach the tunnel's host: its environment has a list of allowed hosts, and I say which one to add when the pilot starts.
- **Your way of teaching.** The teacher of the tests places a fence the way the trial did; where you build differently, the bot says what it understood and you say where it misread you.
