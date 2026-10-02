# Plan v0.1.4.11 "Navigation and words"

Based on your two sessions of 2026-10-02 on v0.1.4.9 (Luna, 47 minutes, $0.11; Haiku, 23 minutes, $0.57) and your words after them. You gave the go on the same day. "Understanding and watching" (the local embedding model, learning by watching) moves to v0.1.4.12.

## 1. Goal

| After this release | Today |
|---|---|
| Every failure text names the cause and the next step | "Show me the way again", "I start a new mine only from the surface", "I stand in no tunnel" |
| The tunnel you stand in is accepted where you stand | Both models needed two or three tries of `!rememberTunnel`; Haiku walked into a cave instead |
| A new shaft may start from the mine room or a tunnel end | Refused underground; both models went up the shaft |
| `!goToSurface` means open sky | Inside the house it aims at the roof |
| "We are in the aviary" saves the area, with the kind the bot concludes itself | Nothing saved; Haiku saved a rule that attaches to no area |
| A route is walked by the path search from the nearest waypoint, in the shorter direction | A leg-by-leg replay that fails on a ladder from mid-ladder and at doors the service closes |
| `!goToMine`, `!leaveMine`, `!goToBed`, `!goToShelter` say what blocks the way before the first step | They walk, fail, and ask you to walk it again |
| "Come here" never digs toward you while a walk exists | 9 destructive attempts in one session |
| A question gets an answer, not a command | "Can you find the path on your own?" killed a working `!mineOre` |

## 2. Your decisions that this plan uses

| Decision | Your answer |
|---|---|
| The house rule "Never dig straight down." | Gone, since v0.1.4.10: digging down is conditional |
| The prompt | The texts the model reasons from are the problem: the result texts and the descriptions, not the profile |
| Places | One sentence that names the place; the bot scans the area and concludes the kind itself; generic, no list of place words |
| Routes | A smarter path search needs no literal route; the route is a memory of where, the search finds how |
| The order | Words and the mine first, places second, the routes third |
| Haiku | Keeps its character: the "command alone" rule of the gpt profile does not go into `profiles/claude.json` |

## 3. Content

### Package 1: Words

| # | Change |
|---|---|
| 1.1 | Every failure text of a skill names the cause and the next step. The sentence "Show me the way again" goes; a route failure names the block, the door or the gap: `The door at (9, 41, 43) is closed and I could not open it.` |
| 1.2 | `!rememberTunnel` says what failed: `Ahead of me is rock at (10, 30, -10).`, `The tunnel is 2 wide at (10, 30, -8).`, `Beside me is open ground, no wall.` |
| 1.3 | The refusal of `!newAction` for digging names the one call to make from where the bot stands, with its arguments: in a tunnel `!mineOre("iron", 8)`, in a room `!mineOre("iron", 8, true)`, elsewhere `!rememberTunnel` or "say dig here". |
| 1.4 | `!goToSurface`: open sky above the bot, never the roof. Inside a building it leaves through the door first. The description says "the open sky". |
| 1.5 | `!givePlayer` says `I gave you 44 wheat.`; a command called with the wrong number of arguments answers with its form: `!rememberRoute takes one argument: !rememberRoute("name").` |
| 1.6 | Two lines in the prompt of both profiles: a question gets an answer and never a command that stops a running command; a rule about a place names a saved place. About 150 characters. |
| 1.7 | The knowledge block names an unsaved enclosure the bot stands in: `You stand in a fenced enclosure 9 x 7 with 6 chickens that is not saved.` Only when true. |

### Package 2: The mine

| # | Change |
|---|---|
| 2.1 | A new shaft may start from the room of a known mine or from the end of its tunnel, when you ask for a deeper ore there. The shaft gets its ladders and its trapdoor as a surface shaft does; the mine gets a second level. Behind `mine_from_inside`. |
| 2.2 | The tunnel is measured from the bot's cell; when that fails, from your position and facing. Standing at the rock face counts; a corridor 2 wide is accepted and its width is said. A failure names the cause (1.2). |
| 2.3 | `!mineOre` inside a tunnel that is not saved measures it first and says so: `I measured the tunnel: ... I dig on at its end.` |

### Package 3: Places

| # | Change |
|---|---|
| 3.1 | One scan of the enclosure around the bot, whatever its border: fence, wall, glass, hedge, water, doorway, gate. It gives the box, the border kind, the openings. The scans of buildings and of pens become cases of it. |
| 3.2 | The contents, counted: animals by kind, crops by kind, beds, chests, furnaces, crafting tables, ladders, water. Saved with the area. |
| 3.3 | The kind is the bot's conclusion from the contents, never a word you must say: animals behind a border with a gate make a pen; tilled soil with crops a farm; walls, a door and a bed a home; walls with chests or furnaces a storage; an enclosure with nothing a yard. `!rememberArea("aviary")` without a type uses it; `!rememberArea("aviary", "pen")` keeps your word. |
| 3.4 | The answer says what was found: `I saved "aviary": a pen, fenced, 9 x 7, 1 gate, 6 chickens. I keep its gate closed and pick nothing up inside it.` "No, it is a farm" changes the kind. |
| 3.5 | The reflexes follow the kind and the facts: animals and a gate, the gate stays closed and no item is picked inside; crops, only plant and harvest; a bed, a shelter. A rule you say attaches to the name. |
| 3.6 | Behind `area_sense`: the bot that enters an unsaved enclosure scans it once and says what it thinks it is: `I am in a fenced pen 9 x 7 with 6 chickens and 1 gate. Tell me its name and I keep it.` Once per enclosure per start. |
| 3.7 | Examples for "we are in the aviary", "it's a pen, chickens live here", "this is the farmland"; three sentences in the routing list. |

### Package 4: Navigation

| # | Change |
|---|---|
| 4.1 | A route is a list of waypoints: its ends, every door, gate, trapdoor and ladder end, the room, the tunnel ends. The path search walks waypoint to waypoint, with its native ladders, doors and trapdoors; the leg replay goes. Behind `routes_by_search`; off, the legs of v0.1.4.9. |
| 4.2 | The walk starts at the nearest waypoint and goes in the direction whose end is nearer to the goal. A bot on the ladder, in the room or in the tunnel joins there. |
| 4.3 | A dry scan before the first step: `!goToMine`, `!leaveMine`, `!goToBed`, `!goToShelter`, `!goToPlace` compute the path to the first waypoint and from waypoint to waypoint without moving, and name the block that blocks when there is none. |
| 4.4 | The door service leaves alone a door or trapdoor that a running walk is about to pass. |
| 4.5 | `!goToPlayer` and `!followPlayer` never dig toward you while a walk exists within the search range; when none exists they say so and stop: `I find no way to you from here without digging. Come closer or tell me to dig.` |
| 4.6 | A walk that enters a cave (a cell with open air 3 wide and no placed block within 8) stops and says it, unless the goal is inside. |

### Package 5: Tests

| # | Change |
|---|---|
| 5.1 | Journeys of this release, black box, the control never moves the bot: the tunnel accepted where the player stands; the shaft from the room; the surface from inside the house; "we are in the aviary" with the kind concluded; the route joined mid-ladder and in the room; the dry scan text at a closed door; "come here" without digging. They gate the release with the twelve of v0.1.4.9 and v0.1.4.10. |
| 5.2 | Unit tests of every text (the texts are data in `texts.js`); the kinds of 3.3 from fixtures of real enclosures; the waypoint walk on the simulated server. |
| 5.3 | `scripts/scorecard.js` counts the failure texts by sentence, so a session shows which text the model hit most. |

## 4. New settings

All off by default, as always.

| Setting | Off means | On means |
|---|---|---|
| `mine_from_inside` | A new mine from the surface only, as today | A shaft from the room or a tunnel end |
| `area_sense` | No scan without your sentence | The bot notices an enclosure it enters |
| `routes_by_search` | Routes as legs, as today | Routes as waypoints walked by the path search |

The texts, the tunnel measurement, the surface, the kinds of places, the door service and the walk toward the player are corrections and have no switch.

## 5. Cost

| Item | Effect |
|---|---|
| The texts, the kinds, the dry scan | Code only. No model call. |
| The prompt | About 150 characters for the two lines; the descriptions get shorter, not longer; the knowledge line only when it is true. The prompt stays at 17,000 or less. |
| The engineers | About 14 hours of sessions, two full runs on the real server |

## 6. What this release does not contain

| Topic | Where |
|---|---|
| The local embedding model, learning by watching | v0.1.4.12 |
| Guides of big goals, smelting, trading, the Nether | Backlog |
| A newer mineflayer | When Minecraft 1.21.9 is needed |

## 7. Estimate

| Package | Size | Hours |
|---|---|---|
| 1 Words | Medium | 2 |
| 2 The mine | Medium | 2 |
| 3 Places | Large | 3 |
| 4 Navigation | Large | 4 |
| 5 Tests, journeys, two full runs, the fix round | Large | 3 |

About 14 hours with three engineers at a time. Round 1: packages 1 and 2. Round 2: package 3. Round 3: package 4. Package 5 grows with each round.

## 8. What I cannot test

- **The model answering a question with words.** The routing list measures it; `npm run test:play` on your machine is the only place the model talks.
- **Your enclosures.** The kinds are concluded from fixtures built like yours. The dump of your region (`scripts/dump_region.js`) would make them yours.
