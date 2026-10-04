# Plan v0.1.4.13 "Supervision and routines"

Based on your decisions of 2026-10-03 (routines) and 2026-10-04 (supervision as the main feature, one channel for the bot and the supervisor), and on the supervised play of 2026-10-04: Claude on Haiku and gpt on Luna mining diamonds in the deep mine, with me as the supervisor through the watch server for 2 hours 50 minutes. The numbers of that play are in section 2.

## 1. Goal

| After this release | Today |
|---|---|
| You give the supervisor one sentence ("diamonds for a full set, avoid lava, stop at 36") and play, or leave. The supervisor wakes only when something changes, orders the bot in one call, and reports at the end: diamonds per hour, interventions, cost | I poll every 25 seconds, send one order in four calls, and cost $7 an hour |
| "Opus, why is it going to the surface?" in the game chat or by voice: the supervisor answers in chat, in its own voice. "claude, come here": the bot. One channel | Two chats: the game for the bot, this session for me |
| "Maintain the base": the bot works a routine you wrote once in your words, step by step, until "stop" | A rule constrains; nothing describes a procedure |
| Out of food in the mine: the bot takes bread from the chest beside it. A furnace in the bag is placed and used. A plan that was made starts. A worn pickaxe is replaced before it breaks | The bot climbs to the basement for bread that lies 3 blocks away, says it carries no furnace while it does, waits after planning, mines with a pickaxe at 2 uses, then wanders for planks |
| "claude, come here": claude comes, gpt stays quiet. Two bots share the places, chests, routes, mines and rules of a world; a pen is a pen for both before anyone saves it | Both answer every line; gpt learned the mine, four chests and ten rules that Claude already knew; the two opened the pens together |
| Haiku's hour costs about $0.60 | $1.70: every call carries the whole prompt |

## 2. What the play of 2026-10-04 measured

| | Haiku (claude) | Luna, low (gpt) |
|---|---|---|
| Model calls in an hour of your play | 250 | 256 |
| Tokens per call | 4,700 in, 70 out | 3,700 in, 95 out |
| Cost per hour of your play | $1.70 | $0.11 (if the price table is right) |
| Reply time | median 1 s, 9 of 10 under 2 s | median 2 s, 9 of 10 under 4 s |
| Diamonds | 9 in 29 s once in fresh rock | 7 in 2 min once in fresh rock, after 25 min lost |
| Restarts of the process | 3 | 2 |

The supervisor: 166 turns, about $22 at list price, 60 percent of it cache reads of a context of 250k to 700k tokens; about 30 interventions, 25 of them for things the bot's code should do itself. The model comparison stays open: the two sessions differed too much in what happened; package 7 makes it a test.

## 3. Content

### Package 1: Supervision (the main feature)

The watch server of v0.1.4.12 gets the tools a supervisor needs to act in one call and to sleep between changes.

| # | Change |
|---|---|
| 1.1 | `digest` (since a cursor): what changed since the last call, about 10 lines, nothing that did not change: position, health and food, the running command and for how long, the job step and its progress, inventory changes as `+7 diamond -1 iron_pickaxe`, new chat lines, new events, hazards within 8 blocks (lava, water, a drop), the nearest chest with free slots, the remaining uses of the tool in hand. |
| 1.2 | `wait` (for: an event, idle, the command done, any change; a timeout): the server holds the call until it happens and answers with the digest. The client re-arms every 55 s under the tunnel's limit. No SSE: `events --follow` of v0.1.4.12 goes. |
| 1.3 | `run` (a list of commands, stop on failure): a queue, each command after the previous one is done; the result lines come back together. A command that arrives while one runs never cancels it. `say` stays for plain words. |
| 1.4 | `note` (a text, for N minutes): one line from the supervisor in the bot's prompt, `Supervisor: the chest at (15, -59, -99) has bread.` Not an order. 200 characters at most; it expires. |
| 1.5 | `look` (a radius): what is around, no model call: ores, lava, water, chests, furnaces, ladders, doors, drops on the ground. Capped like the scans. |
| 1.6 | `server`: the process and the world: uptime, heap, players online, time and weather, tick lag, the model calls and cost of the session from the cost meter, which switches are on. |
| 1.7 | `watch_report_seconds`: every N seconds a `report` event with the digest, even when nothing happened. Off at 0. |
| 1.8 | `help` event: when the bot would ask the player (`Tell me its name`, `Say "mine 3 iron" first`, a stall) and a supervisor is named, the question goes out as an event; `wait` wakes on it; the answer comes back with `say`. |
| 1.9 | Presence: the server knows whether a supervisor is connected (a `wait` within the last minute). |

One channel, two names: what you say goes into the game chat, and both of us read it there.

| # | Change |
|---|---|
| 1.10 | Addressing by name, for the bots too (your play of 2026-10-04 with two bots: both answered every line until you told them). A line that starts with a name, or names one in its first words ("claude, come here", "gpt please wait here"), is for that one; the other bot stays quiet and does nothing. A line without a name goes to every bot, as today. The name is matched by code, no model call for the bot that is not meant. |
| 1.11 | `supervisor_name`: a line that names the supervisor ("Opus, why is it going up?") is a `message` event for the supervisor and nothing a bot answers; every line the supervisor writes is a line no bot answers (the `other_bots` filter of v0.1.4.12 with one more name). |
| 1.12 | `reply`: the supervisor's answer, which a bot relays into chat as `[Opus] ...`. With nobody connected, "Opus, ..." gets one line: `The supervisor is not here.` |
| 1.13 | Voice (section 9, built): the recognised speech goes into the game chat as your line, so the same names apply; the page's dropdown of the bot you talk with puts that name in front of your speech; the page speaks each bot in its own voice (`voice_voice` per profile) and the supervisor's `[Opus]` lines in another. |

The supervisor's side, in the repository:

| # | Change |
|---|---|
| 1.14 | `.claude/skills/supervise/SKILL.md`: the loop (`wait`, read the digest, decide, `run`, `wait`), the standing rules (idle with a job left: resume; low food: the nearest chest; a worn tool: craft; a lava event: stop and tell), what never to do (`!goToCoordinates` downwards, an order while a command runs), the report at the end. |
| 1.15 | `docs/SUPERVISOR.md`: the token, the tunnel, `claude mcp add` so the tools are native in a Claude Code session, the one sentence you give the supervisor, what it costs. A fresh session with that prompt costs about a cent a turn. |
| 1.16 | A journey with a scripted supervisor on the test server: a 10-minute mining job through `wait` and `run` with at most 6 wakes, the food fetched from the chest beside the tunnel, one `help` answered. |

### Package 2: Routines

Your words of 2026-10-03: "something like maintain the base cannot be expressed as a function, but can easily be described with words". A rule is a constraint; a routine is a procedure in your words, kept per world like the rules.

| # | Change |
|---|---|
| 2.1 | `!rememberRoutine("maintain the base", "Farm the wheat and store it. Feed the chickens if any are missing. Keep 32 torches. At night mine iron in the mine. Stay within 100 blocks of home.")`, `!routines`, `!forgetRoutine`; in `bots/<name>/routines.json` or the shared memory of package 4; at most 20, one paragraph each. |
| 2.2 | `!doRoutine("maintain the base")`, or the name in a sentence: the text becomes the goal of a job of v0.1.4.10; the model turns the sentences into steps (commands only, never code), code checks each step, errands do not end it, it survives a restart; a routine that maintains runs its steps again when they are done, until "stop". One line per step done; the knowledge block names the running routine and its step. |
| 2.3 | The supervisor's lever: `say "maintain the base"` when you are away. |
| 2.4 | What it is not: no new commands beyond the four, no code written, no rule changed. |

### Package 3: The corrections from the play of 2026-10-04

No switch: each is a defect. The 25 interventions of the supervisor map onto them.

| # | Change |
|---|---|
| 3.1 | The supply step of a job looks in the chests near the bot first, then in the chests it knows; it never goes to the surface for a second pickaxe while the one in hand has uses left. |
| 3.2 | Tool wear: before the tool in hand reaches 10 uses, the bot crafts a replacement from what it carries or says what it lacks; `I mined 0 of 28. I stopped because my pickaxe is nearly broken` becomes a crafted pickaxe and the mining going on. |
| 3.3 | A plan of `!getTool` starts at once. Today it was made and waited for the next order. |
| 3.4 | `!smeltItem` places the furnace the bot carries when none is near; the text `I know no furnace within 64 blocks and carry none` is said only when both are true. |
| 3.5 | The job counter counts what the skill mined: `0 of 28` beside `I mined 7 of 28` never again. |
| 3.6 | A command the model picks while a skill runs waits for the skill, unless it is a stop; the mining is never cancelled by the model's own follow-up. |
| 3.7 | `!mineOre` underground in a mine it does not know works from where the bot stands: the room becomes the mine, the tunnel the bot stands in becomes its tunnel; no `!rememberMine` and `!rememberTunnel` first. A tunnel that earlier mining widened still counts as a tunnel. |
| 3.8 | `!goToSurface` finds the way `!goToRememberedPlace` walks: a known route up counts as a way to the open sky. |
| 3.9 | The ladder: the top of a ladder into a corridor (the landing at level 30) and the ladder under a trapdoor (the basement) are left without getting stuck. |
| 3.10 | A full bag during a job: the bot stores in the chest of the mine or the nearest chest it knows and goes on; it stops only when no chest has room. |
| 3.11 | The bot never picks up a player's death drops and never equips armour it did not own: a drop within 4 blocks of where a player died, for 5 minutes, is left; worn items are only what the bot crafted or took from a chest. |
| 3.12 | `!givePlayer`: the bot throws from 2 blocks and steps back 3, and its item reflex leaves what it just gave alone for 30 seconds; the text says where the rest lies. A pickup the server does when you walk the item onto the bot stays. For a whole kit: `Say "put my stuff in the chest".` |
| 3.13 | `!goToCoordinates` downwards never digs a shaft: more than 3 blocks down is dug as stairs or with ladders placed, or refused in words. The shaft of 2026-10-04 killed the owner. |
| 3.14 | The pens (your play of 2026-10-04 with two bots: they opened the pens together; one knew the fences, the other had no idea). An enclosure the scan calls a pen (a fence with animals inside, which the sense already says: `I am in a fenced pen 5 x 6 with 26 chickens`) is protected like a saved pen before anyone saves it: the path search never opens its gate, the item reflex never enters it, `!useOn` and the model's code never open its gate. The bot says `That is a pen with 26 chickens; I do not open its gate. Say "open the pen" if you mean it.` A gate opened on your word is closed behind the bot. |
| 3.15 | `mine_other_ores` (a setting, off): while mining one ore, the redstone, lapis, gold, iron and coal exposed in the tunnel's walls are mined too, with the text counting them. |

### Package 4: Two bots, one memory

| # | Change |
|---|---|
| 4.1 | `shared_memory` (a setting, off): the areas, places, routes, mines, chests, rules and routines of a world live in `bots/shared/worlds/<seed>/` and both bots read and write them; the chat memory and the job stay per bot. With it, a pen one bot saved and a rule you gave one bot hold for the other; 3.14 holds before anything is saved. |

### Package 5: Cost

| # | Change |
|---|---|
| 5.1 | `prompt_cache` (a setting, off): on the Anthropic API the fixed part of the prompt (the command list, the examples' format) is sent with a cache mark; the cost meter counts cache reads at their price. About 70 percent of Haiku's input tokens; the hour from $1.70 to about $0.60. Nothing the bot does changes. |
| 5.2 | The price of `gpt-6-luna` in the price table is checked against your bill once and corrected if needed. |

### Package 6: The creeper loop

| # | Change |
|---|---|
| 6.1 | F10 of v0.1.4.12: about once in 30 runs after an explosion that leaves the bot near death, the keep-away loop of the creeper reflex runs until the process is out of memory (W47). A profiling run inside the agent process finds the loop; the fix gets W47 run 30 times. |

### Package 7: Tests

| # | Change |
|---|---|
| 7.1 | Journeys, black box, written before the build and failing on v0.1.4.12: the scripted supervisor (1.16); "claude, come here" with two bots and only claude moving; "Opus, where is it" answered and not answered by the bots; a routine of three steps run to the end and again; food from the chest beside the tunnel; the furnace from the bag; the plan that starts; the worn pickaxe; the shaft refused; the unsaved pen whose gate stays closed under `!followPlayer` through it; the shared mine known to the second bot. They gate the release with the 30 of v0.1.4.9 to v0.1.4.12. |
| 7.2 | Unit tests of every text, of the digest from staged facts, of the addressing rule, of the routine store, of the tool wear rule, of the shared memory paths. |
| 7.3 | The model comparison: `npm run test:play -- --situations`: six situations in plain words, the same for each model ("you are stuck, get back to your tunnel", "your bag is full, deal with it", "there is lava ahead", "go get bread", "give me the rest of my stuff", a two-step order), on your machine only, about 20 cents a model; the table says the first command, the follow-ups and the time. |

## 4. New settings

All off by default, as always.

| Setting | Off means | On means |
|---|---|---|
| `supervisor_name` | `""`: no supervisor in the chat, no `help` events, no notes | The name you address the supervisor by; the bot never answers it |
| `watch_report_seconds` | `0`: no report | A `report` event with the digest every N seconds |
| `routines` | No `!rememberRoutine` | The four commands of package 2 |
| `shared_memory` | Each bot its own memory | One memory of the world for all bots |
| `prompt_cache` | The prompt sent as today | The fixed part marked for the cache on the Anthropic API |
| `mine_other_ores` | Only the ore asked for | The other ores in the tunnel's walls too |
| `voice_ui`, `voice_voice`, `voice_language` | No voice on the page | The live voice of section 9 (`false`, `"supertonic:F1"`, `"en"`) |

The tools of the watch server, the addressing by name, the corrections, the creeper loop and the tests have no switch.

## 5. Cost

| Item | Effect |
|---|---|
| The watch tools, the digest, the events, the queue | Code only. No model call. |
| `note` | About 50 tokens in the prompt while a note stands |
| A routine | One call of the model when it starts (the steps), then code; a call per step the model has to plan |
| The supervisor | A fresh session with the skill: about a cent a turn, and a turn only when something changes. Under $1 an hour against $7 on 2026-10-04. |
| `prompt_cache` | Haiku's hour from about $1.70 to about $0.60 |
| The engineers | About 32 hours of sessions, three full runs on the real server |

## 6. What this release does not contain

| Topic | Where |
|---|---|
| The supervisor and the bot as one mind | After this release: when the supervisor is a program with its own model loop, not a coding session; a session turn is 5 to 30 s and cents, the bot's model 2 s and a fraction of a cent |
| The local embedding model (part A of v0.1.4.12) | After the routing check measures it |
| Guides of big goals, trading, the Nether | Backlog |

## 7. Estimate

| Package | Size | Hours |
|---|---|---|
| 1 Supervision: the tools, the channel, the skill, the guide | Large | 9 |
| 2 Routines | Large | 6 |
| 3 The corrections | Large | 8 |
| 4 One memory | Small | 2 |
| 5 Cost | Small | 1 |
| 6 The creeper loop | Small | 2 |
| 7 Tests, journeys, three full runs, the fix round | Large | 4 |

About 32 hours with three engineers at a time, plus the voice branch, which is built. Round 1: the voice branch merged, packages 3 and 6, the tools of package 1 (1.1 to 1.9) and the addressing (1.10). Round 2: package 2, the channel and the skill of package 1 (1.11 to 1.16), packages 4 and 5. Round 3: the journeys, the fix round, your findings of v0.1.4.12.

## 8. What I cannot test

- **The tunnel and the voice.** The supervisor's tools are tested on the test server with a scripted supervisor; the tunnel is yours, for an evening. The voice runs on your GPU only: its unit tests run here, the round trips of `npm run voice:smoke` and the page are yours, as on 2026-10-04.
- **Your name for the supervisor.** `supervisor_name` is yours to choose; the plan says "Opus" where it needs a name.
- **The price of Luna.** Package 5.2 needs your bill.

## 9. The voice branch

`release/v0.1.4.13-voice`: the live voice, built by your local session on 2026-10-04 from `HANDOFF-voice.md` and the demo's docs, proven in a game session. Commit 80f1f69 holds the code and the tests, `docs/releases/0.1.4.13/VOICE.md` the hand-back: the page in the demo's design with the Agents drawer, whisper-server and Supertonic as services of the mindserver, `speak()` silent while `voice_ui` is on, the bot's lines sent to the page also with `only_chat_with` set (a correction), `npm run voice:setup` (about 1.6 GB) and `npm run voice:smoke`. It merges into this branch in round 1; 1.13 builds on it.
