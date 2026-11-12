# Plan v0.1.4.16 "Stability, and three packs"

Based on your words of 2026-11-11 through your gameplay session: the fixes of your play of v0.1.4.15 (R-1 to
R-13) and three new packs behind switches (the AFK creeper kill, enchanting, breeding), each about a day; and on
your decision of 2026-11-09 that moved the "Stability" list of October to this release. Started on 2026-11-12 on
your word ("proceed to the next release"). The findings are in `docs/ROADMAP.md` ("The play of 2026-11-10",
"The play of 2026-11-11", "Three packs", "0.1.4.16 Stability").

## 1. Goal

| After this release | Today |
|---|---|
| **The bot is safe to leave alone at your base**: the creeper reflex reacts only to a creeper it can see at its own level, it never flees into a cave, it keeps out of caves and refuses to dig into one for a block order, a mining run that stops says why | The reflex fled from creepers 12 blocks below through rock and led the bot into a cave; two deaths in caves under the old mine from `!collectBlocks` orders; three mining runs ended "I got stuck" with no reason |
| **The survey and Routines work on your base as on the test base**: the base's centre and door are your house's, a village 100 blocks off is not your base, the report line is the bot's own, only your house is a shelter; a routine keeps the places you named, skips a failed step and goes on, counts its rounds, never starts under the supervisor's work | The base "base" pointed at a village, the model summarised the report, village houses became shelters; the plan dropped "the west forest chest at (-2383, 65, 832)" and one failed step ended the round |
| **Breeding**: "breed the cows" feeds the animals of a pen from outside the fence, never through a gate, up to a cap | No command; the pen guard refused a feed by hand 3 blocks from a gate |
| **Enchanting**: "enchant my pickaxe" at your table with your lapis, the best offer your levels allow, or the one you name; the bot says what is missing | No command; `bot.dig` fails with an enchanted pickaxe in hand |
| **The AFK creeper kill**: "farm creepers until level 30" climbs to your kill room, kills what lands on the hoppers one hit at a time, collects the gunpowder and the XP, eats, and stops at the level, the time or your word | No command |
| Everything else is v0.1.4.15 | |

## 2. The scope and the cut rule

Your decisions of 2026-11-12: first everything in one release, then, on seeing its size, the split as
recommended. This release is the fixes of your two plays and the three packs. The Stability list of October
(`docs/ROADMAP.md`) goes to 0.1.4.17 "Stability 2", but for three of its rows that your plays keep hitting and
that are in round one here: the caves, "orders stay orders" and the history race. Section 4b keeps the list with
the behaviour each row should have, as the first draft of the plan of 0.1.4.17.

Two rounds on one branch. Round one is the fixes of your two plays (section 4), gated on the server before round
two starts; round two is the three packs (section 5) with a budget of four days: a pack over its day moves to
0.1.4.17, so a new pack never holds the fixes hostage. One PR, one fresh-clone gate, one play test.

## 3. What changes for you

| | After | What you do |
|---|---|---|
| Settings | `breeding` (off), `enchanting` (off), `afk_kill` (off); the fixes have no switch | Switch the packs on in `settings.js` for the play |
| Your worlds, memory, `bots/` | unchanged; a second survey of "base" corrects its centre, door and places by itself (the village is left out) | `!surveyBase("base")` once after the update, or `!forgetArea("base")` first for a clean one |
| Chat | `!breed(pen, count)`, `!enchant(item, preference)`, `!killFarm(until)` and `!stopKillFarm`; plain words map to them with examples in the profile | "breed the cows", "enchant my pickaxe", "farm creepers until level 30" |
| The supervisor | `run` is quiet in the game chat; a `run` answers when the command ends or says `Still running` with the elapsed time | Nothing |
| A rule for the AFK kill | While the bot farms, you are more than 128 blocks from the tower or offline: both players' bubbles share the monster cap (on 2026-11-11 the farm gave almost nothing while the bot stood near the tower) | Stand far off or log out |

## 4. Round one: the fixes of the plays

The ids: R are your play of 2026-11-11 on v0.1.4.15, Q your play of 2026-11-10 on v0.1.4.14 (Q-1 is fixed),
P-21 the fix round of 0.1.4.14. "After" is the behaviour the tests prove.

| Id | Finding | After |
|---|---|---|
| F1 | R-1, Q-2: `creeper_safety` reacts to creepers in caves 12 blocks below, through rock; loops "A creeper keeps following me"; once led the bot into a cave | The reflex counts a creeper only with a line of sight, within 16 blocks and within 3 blocks of the bot's level; the flee target is never lower than the bot and never inside a cave or a dark opening; the "keeps following me" line comes once per creeper, not per tick |
| F2 | R-2, R-3, R-4: the base "base" has a village's centre and door; `!forgetArea` of a village place left it in the base; `trading_hall_2` listed but not saved; your 14 areas not part of the base; the report reached you as the model's summary; village houses saved as `home`; "rename pen to horse_house" got no response | A base is the finds within reach of each other from where the bot stands (a gap of more than 48 blocks starts another cluster, which is reported as "a village 100 blocks south, not saved"); its centre and door are the house with your bed or the nearest house; your own areas around the start join the base; `!forgetArea` removes the place from its base; only saved names are listed; the report line is said by the bot itself, word for word, and the command's answer to the model is one short line; `home` only for the house with your bed or the one nearest the start, the other houses `building` (no shelter); the rename sentences route to `!renameArea` and the answer is spoken |
| F3 | R-5: the plan drops places given in the text; one failed step ends the round; the round number is always 1; `!harvest("sugar_cane")` cuts nothing in 0 s; a round starts under the supervisor's work; the 400 and 200 character caps with a quiet refusal | Every coordinate or named place in the text becomes a walk step before the work there, and the check refuses a plan that lost one; a failed step is said and skipped, the round goes on and counts as failed only when every step failed; the round counter is kept in the store; `!harvest` of cane cuts the cane above the bottom block; a round waits while the supervisor's queue has work or a command runs; a text over the cap is refused with the count and the cap in the line |
| F4 | R-6: `!farmCycle` from inside the house "could not reach 48 ripe plants" | A farm command started inside a building leaves it through its door first, as the shelter code does |
| F5 | R-7, Q-6, Q-7: three runs "I stopped because I got stuck" after a store trip, no reason in the log; `new_mine` true walks to the old mine; "A new mine starts from the surface" underground in a forgotten mine; "lava, water or caves block the way down" where the rock is solid; "0 of 32" with 22 raw iron in the bag; "no stone for a new one" with 65 cobblestone; a table craft broken by the unstuck reflex | Every stop of a mining run names its reason in the text and the log (the step, the position, what failed); `new_mine` true starts a new mine where the bot stands or at the surface above it; a forgotten mine's tunnel the bot stands in becomes a mine again (your Q1 of 0.1.4.13); the way-down check reads the blocks it names and says which block at which position stopped it; the count at the start includes the ore in the bag; the pickaxe rule counts the cobblestone in the bag; the unstuck reflex is paused during a craft |
| F6 | R-8: `!goToBed` near the trading hall chose villager beds | The bed order: the bot's own bed, then a bed in your home or a shelter you named, never a bed in a trading hall or within 8 blocks of a villager's job site; "All beds nearby are taken" only when those are taken |
| F7 | R-10, Q-5: `bot.dig` fails with `enchantments.concat is not a function` with an enchanted pickaxe; "no way without digging" inside a leaf canopy | The dig time reads the enchantments of 26.1 (the item components) in the mineflayer patch; a probe on the test server first; breaking leaves is an allowed way out of a canopy |
| F8 | R-11, Q-3, "orders stay orders": the model said night by day, started `!collectBlocks` by itself, stopped the supervisor's commands, turned off its unstuck reflex | The prompt's clock line and the texts read one clock (the patched `bot.time`), with a unit test on the 26.1 packets; the model may not start a work command without an order from you or the supervisor (the profile's rule and a check in the command path for the work commands when the last message is the bot's own); the supervisor's commands are orders the model cannot stop |
| F9 | R-12, Q-4, Q-8: `run` echoes into the game chat, including the code of `!newAction`; `Ran 0 of 1. Still running` after 60 s taken as finished | `run` is quiet in the game chat (the command's own lines stay); a `run` answers when the command ends or, after 60 s, says `Still running after 60 s: <command>` with an id the supervisor polls, so no script takes it as finished |
| F10 | R-13 and the caves row: two deaths in caves under the old mine from `!collectBlocks` underground | `!collectBlocks` and `!collectBlock` refuse a block that lies in a cave or whose way crosses one, with the line `That is in a cave; I do not go there alone.`; the mining walls off a cave it breaks into (one line of blocks, your stone); `!sealOpening` closes an opening you name; the bot keeps out of dark caves on every walk (the path cost) |
| F11 | Q-9: an iron axe lasted 150 logs; the mine chest filled with 33 kinds; "a walled yard with a roof, 1 bee" was leaves | `!chopTrees` never swings the axe at leaves; the mine chest takes only the mining's kinds (ore, raw metal, stone, the fillers, the drops of digging); a bee nest or a hive is a built block of no kind for the area sense |
| F12 | P-21: `history.add` awaits the memory summary while a concurrent `handleMessage` pushes a turn, so the turns can end with the bot's own line | One add at a time (a queue), the summary off the add path; the end-of-turn rule of 0.1.4.14 stays as the guard |

Each fix is a unit test and, where the server can show it, a scenario (section 7). Zero new model calls.

## 4b. Left for 0.1.4.17 "Stability 2": the Stability list of October

Not in this release (your decision of 2026-11-12, section 2). The rows of `docs/ROADMAP.md` "0.1.4.17 Stability 2"
as the plays of 2026-10-05 and 2026-10-06 found them, with the behaviour each should have, kept here as the first
draft of the next plan; the caves, "orders stay orders" and the history race are in round one of this release.

| Id | Finding | After |
|---|---|---|
| S1 | Tunnels as beams: "mine" kept 3 pieces of a 116-block tunnel, "deep" 34 of more than 110; every later run said "no way" or walked home with 0 iron, ended 2 blocks below its level, planned the way back through the room, ignored the route saved by hand | A tunnel is saved as a start, a direction and a level, never an end or a length; its end is where the open cells along it stop, found when the bot stands in it; every run digs on from there; pieces on the same row, level and direction are one beam (the saved mines merge on load); the way in is to the start and along the beam; a branch starts on a beam with its own direction |
| S2 | Routes and places: the route "mine" breaks at the foot of the ladder; "mine_to_deep" ends in the room, not at the deep mine; the place "house_to_mine" took the route "farm_to_home"; "I find no way to the top of the ladder" at the basement's bed | A route's waypoints include both ends of every ladder it climbs; a route to a mine ends at the mine's start; a place and a route never share a name (the second gets `_2` and the bot says so); the walk to a ladder's top uses the ladder code of the packs |
| S3 | Shelter: "this is the shelter" answered `That is the area "home" already.` while the model claimed it saved it; a stray place "shelter" by the pens; the home point drifting | "This is the shelter" on a saved home marks that home as the shelter and says so (`"home" is the shelter.`), saves no new place; the home point is the saved home's door, never the bot's position |
| S4 | The smaller ones of 2026-10-06: a bed in a 2-wide tunnel; the farm round 40 blocks off the farm without the bone meal it took; `!goToCoordinates` over the surface to a mine; `!putInChest` into a full chest reports wrong; the chest index stale; the model asks about the area "home" after every restart, answers "where are you?" wrongly, took "it's all good now" as `!stop` | A bed is placed only on level ground outside a tunnel (the rule of 0.1.4.14 extended to tunnels); the farm round uses the bone meal it took or puts it back; `!goToCoordinates` to a point inside a known mine takes the mine's way in; `!putInChest` into a full chest says `The chest at (x, y, z) is full; I put nothing in.`; the chest index is refreshed when a chest is opened; the restart asks nothing about a saved area; "where are you?" is answered with the nearest saved place and the coordinates; "it's all good now" is no `!stop` (the profile's examples) |
| S5 | Supplies by need: a walk of 150 blocks for 2 torches; a loop of eating the food and fetching more; the cobblestone unnamed | Supplies are fetched when a trip needs them and the chest is within 48 blocks, else the bot says what it lacks and goes without; food is fetched once per trip; every stored or fetched thing is named |
| S6 | The mine and its route: `!mineOre("diamond")` took the shallow mine; the same route failure came 4 times | The mine for an ore is the one whose level reaches the ore (diamond below y 16); a route that fails is said once and marked, the next walk takes the plain way |
| S7 | A full bag far from the chest: carry it back or place a chest; `!discard` picked up again | A full bag more than 48 blocks from the chest: the bot places a chest from the bag where it stands and stores into it (a saved place `cache_N`), or carries the bag back when it has no chest; `!discard` keeps the dropped items out of the pickup for 60 s |
| S8 | Chests by position: the upper of two stacked chests; every stack in one `!putInChest` | A chest is named by its position in the texts; two stacked chests are two chests; `!putInChest(item, num)` moves every stack of the item up to num in one command |
| S9 | `!craftRecipe` with a count above 1 says "missing ingredient" | The count is honoured: one unit at a time with the check of 0.1.4.14, the missing-ingredient line only when the bag lacks the ingredients for the next unit |
| S10 | A ladder through a trapdoor: the path search opens it | The path finder opens a trapdoor above a ladder as it opens doors (a patch of the pinned path search, so your play test covers it) |
| S11 | Code that cannot be stopped: generated code running `collectBlock` in a loop ended the process (`refused stop after 10 seconds`) | Generated code runs with the interrupt flag checked between skill calls, and a code that ignores the stop for 10 s is killed without ending the process (`I stopped the code.`) |
| S12 | The load of the laptop | Only if it remains in your play after the quiet supervisor of 0.1.4.13; measured in the play, no code before |

## 5. Round two: the three packs

Each pack is a work pack like the farming or the mining pack: its own folder, its switch, its commands blocked
when off, one line of docs per command in the prompt, its texts word for word from the spec.

### Breeding (`breeding`)

| Part | What the bot does |
|---|---|
| The order | `!breed(pen, count)`: "breed the cows", "breed 4 pigs in the pig pen". The pen is a saved pen (yours or the survey's); the species comes from the pen's animals |
| The feed | Wheat for cows and sheep, carrots for pigs, seeds for chickens, from the bag or the chest you named for feed; without feed: `I have no wheat for the cows.` |
| The walk | Outside the fence, never through or at a gate (the pen guard allows a feed over the fence and refuses an open gate as before); the bot stands one block from the fence on the feed row, holds the feed a few seconds so the animals come, feeds two animals within reach, skips the ones out of reach, moves along the fence; never places a block in or by a pen |
| The pace | 5 minutes per pair before the next (the game's breeding cooldown), up to `count` new animals or the pen's cap (default 12 per pen); one line per pair fed, one at the end: `I fed 4 cows in the cow pen; 2 calves.` |
| Pickup | Minecraft picks items up by itself; the bot cannot turn that off. It stays a block from the fence so nothing inside the pen is within reach, and never enters |

### Enchanting (`enchanting`)

| Part | What the bot does |
|---|---|
| The order | `!enchant(item, preference)`: "enchant my pickaxe", "enchant the sword, sharpness". The item from the bag or from you (`I have no diamond_pickaxe.`) |
| The table | Your enchanting table within 32 blocks (a saved place or a scan); none: `No enchanting table within 32 blocks.`; the bot never crafts or places a table or a bookshelf without your order |
| The lapis | From the bag, or from the chest you name as the lapis chest (your valuables chest holds 55); without: `I have no lapis.` |
| The levels | The three offers are read; the default is the highest offer the bot's level allows, or the one whose name matches your preference; too low: `Level 12, I need 30 for the best offer; the offers are ...` and nothing is spent unless you say "take what you can" |
| The anvil | Later, if the day allows: `bot.openAnvil` to combine a book with the item |
| 26.1 | The enchantments of 26.1 are item components; the pack reads them through one reader, shared with F7, probed on the test server before the spec is final |

### The AFK creeper kill (`afk_kill`)

| Part | What the bot does |
|---|---|
| The order | `!killFarm(until)`: "farm creepers until level 30", "farm creepers for 20 minutes"; `!stopKillFarm` or "stop" ends it |
| The farm | Your tower at about (-2276, 870): the tier floor at y 197, the roof at y 200, the drop shaft with water at y 190, the hoppers at y 170 to 171, the kill room at about (-2275, 170, 870) with the hoppers and two chests at z 870 to 872, a slab between the creepers and the killer. The pack learns it from a saved place `kill_room` (the spot under the slab) and `kill_room_chest`; the survey or `!rememberPlace` saves them |
| The job | Climb the tower's ladder to the kill room, stand at the kill spot under the slab; hit only hostile mobs within reach that stand on the hoppers, one hit each with the sword; collect the XP orbs and the drops within the room; put the gunpowder and the other drops into the chests when the bag has 4 free slots or fewer; eat when hungry from the bag; one line every 50 kills: `I killed 50 creepers; level 14; 62 gunpowder stored.` |
| The stop | At the level, at the time, at your word, or when health falls under 10 of 20 (`I leave the kill room: health 9.`); on the way out only by the ladder |
| Safety | `creeper_safety` is off while the bot stands at the kill spot and on again when it leaves; the bot refuses to start when the slab over the hoppers is missing (`The kill room has no slab over the hoppers; I do not farm there.`) or the water of the shaft is gone; it never leaves the kill room except by the ladder; it never hits a villager, a pet or you |
| The numbers | Level 30 needs 1,395 XP, a creeper gives 5, so about 280 creepers |

## 6. Estimate

| Part | Days |
|---|---|
| F1 the creeper reflex, F10 the caves (one engineer: the reflexes and the caves) | 1.5 |
| F2 the survey, F6 the beds | 1.25 |
| F3 Routines, F4 the farm from inside | 1.25 |
| F5 the mining | 1.5 |
| F7 the dig with enchanted tools (the probe, the patch), F11 the smalls | 1 |
| F8 the clock and the orders, F9 the supervisor's run, F12 the history race | 1.5 |
| Round one: the scenarios on the server and the fix round | 1 |
| Breeding | 1 |
| Enchanting (with the probe of the 26.1 window) | 1.25 |
| The AFK creeper kill (with its world scenario) | 1.25 |
| The gate: unit, end-to-end and the full world set in a fresh clone, the fix round | 1 |
| **Total** | **12.5**, the packs capped at 4. The Stability list of October (section 4b) is about 8 more days, in 0.1.4.17 |

## 7. Testing

As in 0.1.4.15: unit tests carry each rule and run in minutes; each fix and each pack gets its scenario on the
real server, run once when it lands; the full world set runs once in the fresh-clone gate. The scenarios are
written from this plan, before the build, and fail on v0.1.4.15:

| Scenario | What it proves |
|---|---|
| W128 "creepers below" | Creepers in a cave 12 blocks under the bot: the reflex stays quiet and a walk past the trading hall goes through; a creeper in sight at the bot's level: the reflex works as before and never flees downhill |
| W129 "the base by the village" | The W126 base with a village 100 blocks south: the base's centre and door are the house's, the village is reported and not saved, the report line is the bot's own, the village houses are no shelter, `!forgetArea` of a place removes it from the base, your own areas are in the base |
| W130 "the routine with places" | A routine naming a chest by coordinates and two steps: the walk step is planned, one failed step is skipped and said, the round counter grows, no round while the supervisor's `run` works |
| W131 "the mine says why" | The W118 mine with a blocked way back, `new_mine` true, a forgotten tunnel, solid rock under the start: every stop names its reason, the new mine starts at the bot, the tunnel becomes a mine, the way down is dug |
| W132 "the night and the orders" | The clock line of the prompt at three times of the day; a bot alone for 3 minutes starts no work command |
| W133 "a cave in the way" | `!collectBlocks("stone", 10)` with the only stone in a cave: refused with the line; a mine that breaks into a cave walls it off |
| W134 "the pens" | The W126 pens: "breed the cows" feeds over the fence, the gate stays shut, two calves within the scenario's time (the cooldown is set by command), the cap holds, nothing placed by the pen |
| W135 "the enchanting table" | A table with 15 bookshelves built by the test, lapis in a chest, `/xp set` to 30: the offers read, the best taken, the item enchanted; at level 12 the line with the offers and nothing spent; without a table the line |
| W136 "the kill room" | A shaft and a kill room built by the test, creepers summoned onto the hoppers with low health under a slab: the climb, the kills one hit each, the drops and the XP collected, the gunpowder stored, the stop at the level and at health, `creeper_safety` quiet at the spot and on again outside |
| The unit tests | F7's reader on the 26.1 item components (recorded packets), F12's queue with a concurrent add, F8's clock on recorded `update_time` packets, every text word for word |

## 8. Left out

- The Stability list of October (section 4b): 0.1.4.17 "Stability 2", your decision of 2026-11-12.
- The anvil of the enchanting pack, if its day is spent.
- A kill room the bot builds itself, and any farm but a drop shaft with hoppers under a slab.
- Breeding of horses, bees or villagers; feeding through a gate; a feed the bot grows itself.
- An automatic survey, milestones, thick snow layers: as before.

## 9. Risks

| Risk | What we do |
|---|---|
| A creeper explodes at the kill spot | The pack starts only with the slab over the hoppers and the water in the shaft; one hit per mob at the hoppers' edge; the stop at health 10; your rule of 128 blocks in the play guide |
| The enchanting window of 26.1 differs from what mineflayer 4.39.0 expects (the item components) | A probe on the test server before the spec of the pack is final; if the window is broken, the pack is cut to 0.1.4.17 and the finding goes to the patch with your play test, as the rule for pinned libraries says |
| Breeding: the animals stay out of reach, the bot picks up a drop by the fence | The bot holds the feed so the animals come, skips the ones out of reach and says so; it stays a block from the fence; a drop outside the pen is picked up, one inside is never reached |
| The survey still groups a near village with your base | The cluster gap of 48 blocks is a number you can change (`survey_cluster_gap`); `!forgetArea` of a place removes it from the base; the report names what was left out and where |
| The mining's "I got stuck" has a cause the logs do not show | F5 starts with the reason in every stop line; the fix of the cause follows what the scenario shows, and a cause the scenario cannot show is a finding for your next play |
| The caves rule refuses a block order you meant | The line names the cave; `!collectBlocks` with a position you give still refuses a cave; the way around is `!goToCoordinates` and a block order by hand, or your word "it is safe" (`!allowChanges` style) which the spec defines |
| The model's own orders (F8) block a thing you want it to do by itself | The rule covers the work commands only (collect, mine, chop, farm); talk, follow, look and answers stay free |

## 10. Your decisions

1. The cut: decided on 2026-11-12, the split (section 2): the plays' fixes and the three packs here, the October list in 0.1.4.17.
2. The AFK kill: the default stop (level 30), the health threshold (10 of 20), whether the bot may eat from the hopper chests when its bag has no food.
3. Enchanting: the default preference (the highest offer the levels allow) and whether the bot may take lapis from your valuables chest by itself or only from a chest you name.
4. Breeding: the cap per pen (12), the pace (5 minutes per pair), and whether the bot may take the feed from the farm chests by itself.
5. The caves: `!collectBlocks` underground refused for the bot alone (your words after the two deaths), or allowed with the wall-off rule only.

Round one runs while you decide; the three packs' spec follows your answers to 2 to 5.
