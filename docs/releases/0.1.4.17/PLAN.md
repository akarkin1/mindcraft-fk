# Plan v0.1.4.17 "Stability 2"

Based on your plays of 2026-11-14, 2026-11-16 and 2026-11-19 (`docs/ROADMAP.md` M-1 to M-8, N-1 to N-5), the
leftovers of 0.1.4.16 (B-8, B-15) and the Stability list of October (the draft in `docs/releases/0.1.4.16/PLAN.md`
section 4b, rows S1 to S12). Started on 2026-11-21 on your word ("ok, you can start working on the next one"),
after my recommendation to split the list in two (section 2). Nothing is built before you approve this plan.

## 1. Goal

| After this release | Today |
|---|---|
| **The bot sleeps near its work**: away from home, a usable bed near the bot comes before a home far off, a village house's bed included; the night reflex never cuts a walk to a bed | At the village woods the bot heads for the base's home 170 blocks off at dusk, across open ground, and cut the walk to the village bed 6 times in one evening |
| **A death is never hidden**: the watch reports it, the restart names it, nothing hangs in a chest window after it | An enderman killed the bot at a chest; no death event, the restart said only that the process had crashed; 58 logs lost unseen |
| **The bot walks out of a leaf trap and climbs a ladder in peace** | Leaves at head height trapped it for a game day ("no way without digging", one walk of 529 s); the unstuck reflex stopped a ladder climb at y 84 |
| **`!chopTrees` brings the wood home**: the logs on the ground picked up, the high ones cut from a pillar | 12 logs left on the ground and 9 "too high" in one run |
| **The farms use their own chests**: the harvest goes to the farm's chest, a full chest gets a new one beside it, the cane is cut in a saved farm, every ripe plant is reached | Carrots in the trading hall's chest; "destination full" and nothing stored; the area guard refused the cane; "I could not reach 1 ripe plant" on an open field |
| **Chests, supplies and crafting behave**: stacked chests are two chests, `!putInChest` moves every stack, a full bag far off gets a chest, supplies are fetched only when near, `!craftRecipe` honours the count | One stack per `!putInChest`; a walk of 150 blocks for 2 torches; `!craftRecipe` of 4 says "missing ingredient" |
| **A stop stops the code, not the bot**: generated code that ignores the stop is ended and the bot stays connected | Code looping `collectBlock` ended the process (`refused stop after 10 seconds`) |
| **Your answer to the supervisor goes to the supervisor** | "Yes, get a new weapon and keep farming" (to the supervisor) made the bot's model run `!getTool` and climb down |
| Everything else is v0.1.4.16 | |

## 2. The scope and the cut rule

My recommendation of 2026-11-20, which this plan takes on your "ok": the list is split in two releases.

- **0.1.4.17 "Stability 2"** (this plan): what your plays keep hitting. The findings N-1 to N-5, the play of
  2026-11-14 (M-1 to M-4, M-7, M-8; your decision 2), B-15, and the October rows that are small or overlap them:
  the shelter (S3), the smaller ones of 2026-10-06 (S4, but the walk to a mine), supplies by need (S5), a full bag
  far off (S7), chests by position (S8), `!craftRecipe` with a count (S9), code that cannot be stopped (S11).
- **0.1.4.18 "Mines and routes"** (section 5): the mining and route rework, the risky part. Tunnels as beams with
  B-8 (S1), routes and places (S2), the mine for the ore (S6), the ladder through a trapdoor (S10, a patch of the
  path search, so with your play test), and S4's walk to a mine.

One round on one branch, the parts built side by side by at most three engineers. The cut rule: a part that runs
over its days by half moves to 0.1.4.18, so the rest is never held. One PR, one fresh-clone gate, one play test.
The branch starts from 0.1.4.16 (`release/v0.1.4.16-rc`) and takes main in once PR #27 is merged.

## 3. What changes for you

| | After | What you do |
|---|---|---|
| Settings | No new switch; the fixes have none | Nothing |
| Your worlds, memory, `bots/` | Unchanged | Nothing |
| A farm's chest | A chest you name for a farm is its chest: the place `<farm>_chest` (for the farm "farm_east": `farm_east_chest`), else the place `farm_chest`; without one, the chest nearest the farm (not the bot) | "remember here as farm_east_chest" at the chest, once per farm |
| A bed away from home | A village house's bed is the bot's while it works more than 96 blocks from home (your word of 2026-11-19); a trading hall's bed and a bed a villager lies in never are | Nothing |
| The restart | The restart line names a death before it: `I died at (x, y, z) at 04:31 (killed by an enderman) while putting spruce_log in a chest.` | Nothing |
| The supervisor | A question of the supervisor claims your next line for a minute, unless the line names the bot | Answer the supervisor without its name |

## 4. The fixes

| Id | Today | After |
|---|---|---|
| **A. The night and the beds** | | |
| N-1 | `night_shelter` goes to the home area of the place home at any distance, never to a bed; a walk ordered before dusk (`!goToCoordinates` to a bed) is cut; `!goToBed` searches beds within 32 blocks only | Away from home (the home more than 96 blocks off), the night reflex goes to the nearest usable bed within 48 blocks (a saved one, `my_bed`, one in a saved home or shelter, else a village house's bed) and sleeps; with none, it goes home as today. A walk to a bed is never cut. `!goToBed` knows the saved beds beyond 32 blocks |
| S3 | "this is the shelter" on the saved home answered `That is the area "home" already.`; a stray place "shelter"; the home point drifting | "This is the shelter" on a saved home marks it and says `"home" is the shelter.`, saves no place; the home point is the saved home's door, never the bot's position |
| S4a | A bed placed in a 2-wide tunnel | A bed is placed only on level ground outside a tunnel |
| **B. The death** | | |
| N-2 | The watch keeps its events in memory; a death during `!putInChest` (a chest window open, no check of the death) most likely hung the stop until the 10 s kill, and the process ended before the supervisor's wait was answered; the restart said only that the process had ended | The death is written to disk at once (place, time, cause, the command) and the restart line and the restart event of the watch carry it; the watch answers its open waits before the process ends; a death ends the chest work and every window at once. Your logs of 2026-11-16 decide whether this was the path (decision 5) |
| **C. Ways and climbs** | | |
| N-3 | F7's canopy rule counts the leaves around the feet only; leaves at head height on every side do not count | The cell of the head counts too; the trap of 2026-11-19 in the tests |
| N-4 | Fixed in 0.1.4.16 (Q-5's patch); probed on the test server on 2026-11-20 | A damaged, unenchanted item in the probe and the unit tests |
| M-7 | The unstuck reflex counts 2 blocks of movement in 20 s; a slow climb or a stop on a ladder counts as stuck | A bot on a ladder whose height changes is never stuck; a stop on a ladder gets 40 s |
| B-15 | A shaft out of ladders near the surface goes on as a staircase in the open air and stops with `Lava, water or caves ... air` | The staircase starts below the surface; out of ladders the stop says so: `I ran out of ladders at (x, y, z).` |
| **D. Wood** | | |
| N-5 | One pickup pass within 8 blocks and 3 levels, 30 s; "too high" also counts failed walks and pillars; a failed pillar ends every later pillar | A second pickup pass after the last tree within 12 blocks; a log out of reach is cut from a pillar of dirt or cobblestone up to 12 blocks, each tree on its own; the pillar blocks taken down; the line counts only logs truly left |
| **E. Farms and chests** | | |
| M-1 | The farm cycle stores in the chests nearest where it ends, a trading hall's included | Into the farm's chest (section 3), then the chests nearest the farm, never a trading hall's |
| M-2 | A full chest is skipped; nothing places a chest (only the mining does) | A full chest gets a new chest beside it, from the bag or crafted from 8 planks, never on a field cell; without either the bot says what it needs |
| M-3 | Fixed in 0.1.4.16: the cane harvest. Open: the area guard's crops have no `sugar_cane`, so a saved farm area refuses the cut | The cane above the bottom block is a crop for the guard; the bottom block stays protected |
| M-4 | One walk onto the crop cell and one near it, 15 s each, with the field's rules (no doors, no sprint) even outside the field; no second try on an open field | The stand cells around the crop are tried in turn, the field's rules only inside the field; the unreached plants are said by position |
| S7 | A full bag far from the chest: the bot walks back with nothing or drops; `!discard` items picked up again | More than 48 blocks from the chest the bot places a chest from its bag where it stands and stores (the place `cache_N`), or carries the bag back without one; dropped items stay out of the pickup for 60 s |
| S8 | `!putInChest` opens the nearest block named `chest`, moves one stack, no check of a full chest | A chest is named by its position; two stacked chests are two chests; every stack up to the count in one command; a full chest says `The chest at (x, y, z) is full; I put nothing in.`; the chest index is refreshed when a chest is opened |
| S4b | The farm round 40 blocks off the farm, without the bone meal it took | The round stays in the farm; the bone meal taken is used or put back |
| **F. Supplies, crafting, the code** | | |
| S5 | A walk of 150 blocks for 2 torches; a loop of eating the food and fetching more | Supplies are fetched when the chest is within 48 blocks, else the bot says what it lacks and goes without; food once per trip; everything stored or fetched is named |
| S9 | `!craftRecipe` crafts the whole count in one call; the count above 1 says "missing ingredient" | One unit at a time; the missing-ingredient line only when the bag lacks the next unit, with the count made |
| S11 | Generated code checks the stop between its statements only; a skill that does not return holds the stop; after 10 s the process is killed | Every skill call of generated code checks the stop; a code that still holds it for 10 s is left behind, the bot's controls reset, and the bot says `I stopped the code.` and stays connected. A code with an endless loop of its own (no skill call) still ends the process, as the last resort |
| **G. Talk and orders** | | |
| M-8 | Nothing records the supervisor's question; your answer without its name goes to the bot | A relayed line of the supervisor that asks a question claims your next line for 60 s: it goes to the supervisor as a message, the bot does not act on it. A line with the bot's name goes to the bot |
| S4c | The model asks about the area "home" after every restart, answers "where are you?" wrongly, took "it's all good now" as `!stop` | The restart asks nothing about a saved area; "where are you?" is answered with the nearest saved place and the coordinates; "it's all good now" is no stop (the profile's examples) |

## 5. Left for 0.1.4.18 "Mines and routes"

The rows of section 4b of the 0.1.4.16 plan, as drafted there: S1 tunnels as beams with B-8 (a mine from a
forgotten tunnel knows its way out, a bot in its own deep hole walks home), S2 routes and places, S6 the mine for
the ore, S10 a ladder through a trapdoor (a patch of the pinned path search: your play test), S4's
`!goToCoordinates` over the surface to a mine. About 6.5 days with their scenarios and the gate. S1 changes how
your saved mines are stored: the saved mines are converted on load, and the conversion is tested on a copy of the
test base's mines before your world.

## 6. Estimate

| Part | Days |
|---|---|
| A. The night and the beds (N-1, S3, S4a) | 1.75 |
| B. The death (N-2; less with your logs) | 1 |
| C. Ways and climbs (N-3, N-4, M-7, B-15) | 1.25 |
| D. Wood (N-5) | 0.75 |
| E. Farms and chests (M-1 to M-4, S7, S8, S4b) | 3 |
| F. Supplies, crafting, the code (S5, S9, S11) | 1.25 |
| G. Talk and orders (M-8, S4c) | 1.25 |
| The plan, the spec, the scenarios on the server and the fix round | 1.25 |
| The gate: unit, end-to-end and the full world set in a fresh clone | 1 |
| **Total** | **12.5**; without the play of 2026-11-14 (M-1 to M-4, M-7, M-8) about 9 |

My figure of 2026-11-20 ("about 8 days") left out the testing and the play of 2026-11-14; this table has both.

## 7. Testing

As in 0.1.4.16: unit tests carry each rule; each part gets its scenario on the real server, run when it lands; the
full world set runs once in the fresh-clone gate, in two parts (the limit of a background run is 2 hours). The
scenarios are written from this plan, before the build, and fail on v0.1.4.16:

| Scenario | What it proves |
|---|---|
| W137 "the bed near the work" | The place home 150 blocks off, a village house with a bed and a villager 5 blocks off, the bot at work 30 blocks from it at dusk: it goes to that bed and sleeps; a walk ordered to the bed before dusk is not cut; at home the home's bed comes first as before; a trading hall's bed never |
| W138 "the death at the chest" | The bot killed while it puts logs into a chest: the supervisor's wait gets the death event, the restart line names the place, the time and the cause, no window stays open |
| W139 "the leaf trap" | The trap of 2026-11-19 (leaves at head height on every side and above): `!goToCoordinates` out of it in under 60 s |
| W140 "all the logs" | Tall spruces whose top logs are out of reach and a slope where logs fall: every log in the bag or said, the pillar blocks taken down |
| W141 "the farm chest" | A farm with `<farm>_chest` and a nearer chest in a trading hall: the harvest in the farm's chest; the farm chest full: a new chest beside it, the harvest in it; cane in a saved farm cut above the bottom block; every ripe plant of an open field reached from outside the house |
| W142 "chests and counts" | Two stacked chests, three stacks of cobblestone, a full chest, `!craftRecipe("stick", 4)`, a full bag 60 blocks from the chest: each line and each chest as section 4 says |
| W143 "the code stops" | Generated code that loops `collectBlock`: `!stop` ends it within 10 s, `I stopped the code.`, the process the same |
| W144 "the supervisor's question" | The scripted supervisor asks "Shall I get a new sword?", the player answers "yes": the bot runs nothing, the supervisor's wait gets the message; "claude, come here" in the minute after goes to the bot |
| W145 "a long ladder" | A 40-block ladder in a tower and a shaft from the grass with 2 ladders: no unstuck stop on the climb; `I ran out of ladders at (x, y, z).` |
| The unit tests | The canopy cells, the bed choice away from home, the death record, the chest by position and the counts, the guard's cane, the routing of a line after the supervisor's question, every text word for word |

## 8. Left out

- Section 5: 0.1.4.18.
- The model comparison (`npm run test:play -- --situations`, a row of the ROADMAP table; nothing is built): the
  backlog (decision 3).
- The stop words stay English, and a question that holds one ("do we have enough iron?") still lets a model
  `!stop` through: a better rule needs the owner's real lines; a candidate for later.
- The load of the laptop (S12): measured in your play, no code before.
- The anvil of the enchanting pack.

## 9. Risks

| Risk | What we do |
|---|---|
| The bed near the work is a villager's, and a villager cannot sleep | Your word allows it away from home; a bed a villager lies in and a trading hall's bed stay refused |
| The night walk to a far bed is the danger itself | 48 blocks at most, and only when it is nearer than home; with monsters near the creeper and fight reflexes run as before |
| N-2 had another cause than the hang at the chest | The death record on disk and the watch's answer before the exit cover any path to the restart; your logs decide whether the chest fix is the cause or one more guard |
| A chest placed by the bot lands where you do not want it | Only beside a full chest of a farm or at a full bag more than 48 blocks off, never on a field cell, a path or a door; each placement said with its position |
| A code left behind keeps running (JavaScript cannot end a promise) | Every skill call of it checks the stop and throws, so a loop over skills ends at its next call; one with no skill call still ends the process |
| The supervisor's minute takes a line meant for the bot | A line with the bot's name always goes to the bot; the minute ends with the next line |
| The base: 0.1.4.16 is not merged yet | The branch takes main in after PR #27; a change in 0.1.4.16 before its merge is merged here the same day |

## 10. Your decisions

1. The split: taken from your "ok" of 2026-11-21 on my recommendation (section 2). If you meant one release, say
   so: then section 5 joins this plan and the estimate grows by 6.5 days.
2. The play of 2026-11-14 (M-1 to M-4, M-7, M-8): in this plan, as I recommend (part E and G, 3.25 days). Say "out"
   and they wait for later.
3. The model comparison: out, to the backlog, as I recommend.
4. N-1's numbers: away from home means more than 96 blocks from it; the bed near the work is within 48 blocks of the
   bot and nearer than home. A village house's bed counts only away from home.
5. N-2: the log of 2026-11-16 around 04:30 (`%LOCALAPPDATA%\Mindcraft\logs\claude-20261116-*.log`, the minutes
   before and after the death) shows what hung. Your gameplay session can paste those lines into this chat; without
   them B is built as section 4 says.
6. M-2 and S7: the bot may place a chest from its bag or craft one from 8 planks, beside a full farm chest or at a
   full bag far from home, and says where.
7. M-8: a question of the supervisor claims your next line for 60 s.
