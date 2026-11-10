# Spec v0.1.4.15 "The base survey and Routines"

The plan is `PLAN.md`. The owner's decisions of 2026-11-09 stand word for word (PLAN sections 4 and 5). Where this
spec and the code of v0.1.4.14 disagree, the code's facts win and the lead is told.

## 0. Rules for every engineer

The rules of `docs/releases/0.1.4.13/SPEC.md` section 0 and of `docs/PROCESS.md` hold word for word (never
`keys.json`, never a secret, never a real model in a test, never port 55916, no git command that writes, strict
file ownership, LF, texts word for word, `{ ok, reason, text }` and never a throw, static imports only of names
that exist, packs through `ctx`, no pack imports another pack, a report as text, the journeys are the gate, no
numeric block or item id in `src/`). Four more for this release:

28. **The survey sees, nothing else does.** The survey's reads are the seed names of 2.1 through `bot.findBlocks`
    and an ore-blind reader (2.1) for the scans; no other code gets a new way to read unloaded or hidden blocks.
    The no-x-ray rule of v0.1.4.13 (F1-9) stays everywhere else.
29. **Save first, then ask.** Nothing the survey finds waits for an answer. The owner's own areas and places are
    never renamed, re-boxed or forgotten by a survey; only places with source `survey` are updated by a later
    survey (PLAN 4, decision 6).
30. **Zero model calls in the survey; one in a routine**, the planning of its steps, and that one through the
    existing `promptPlan` (purpose `plan`). A round runs with no model call.
31. **A new command's docs are one line each**; the prompt budget tests take the new limits of 6.3 with the
    reason, and nothing else grows.

## 1. Settings

| Key | Default | Where | Meaning |
|---|---|---|---|
| `base_survey` | false | `settings.js`, `settings_spec.json` | the survey pack: its commands and the `base` tag |
| `survey_radius` | 128 | both | the cap of the survey's reach in blocks, sideways from the bot; the scan takes what is loaded within it |
| `routines` | false | both | the routines: their commands, the rounds, the watch tool |

Off, every command of a part is blocked (`agent.js`, the `blocked_actions` block) and its examples hidden; the
prompt is byte for byte the one of v0.1.4.14.

## 2. Part S: the survey pack (E1 the pure logic, E4 the areas, the underground and the wiring)

Files: `src/agent/packs/survey/` with `survey_logic.js` (E1, pure: imports only `../../areas/area_scan.js`,
`../../areas/area_kind.js`, `../../areas/open_farm.js`, `../home/box_math.js`), `underground_logic.js` (E4,
pure: the same imports), `survey.js` (E4, executing), `texts.js` (E1, pure), `index.js` (E4). Settings and
hygiene as section 8 of the areas report: `_loadWorkPacks` imports it behind `base_survey`; `survey_modules.test.js`
(E1) with the import rules of the other packs.

### 2.1 Seeds (E1, `survey_logic.js`; the reads in `survey.js`)

`SEED_NAMES`: frozen, by category, block names only, never an ore:

| Category | Names |
|---|---|
| `farmland` | `farmland` and the crop blocks of `crop_logic.js` (`wheat`, `carrots`, `potatoes`, `beetroots`) |
| `gates` | every `*_fence_gate` |
| `doors` | every `*_door` that is a block, no trapdoor |
| `rooms` | `*_bed`, `chest`, the 8 copper chests, `barrel`, `furnace`, `blast_furnace`, `smoker`, `crafting_table` |
| `jobs` | `lectern`, `composter`, `smithing_table`, `fletching_table`, `cartography_table`, `loom`, `stonecutter`, `grindstone`, `brewing_stand`, `barrel`, `cauldron`, `blast_furnace`, `smoker` |
| `cane` | `sugar_cane` |
| `portal` | `nether_portal` |
| `down` | `*_trapdoor`, `ladder` |

`survey.js` reads the seeds with `bot.findBlocks({ matching: ids of the names, maxDistance: radius, count: 20000 })`
per category, `radius = min(settings.survey_radius, 128)`, and the entities with `bot.entities` (villagers,
animals, a leashed entity: `entity.leashHolder`/the metadata of a leash, and the `leash_knot` entity). The
ore-blind reader for the scans is `oreBlind(getBlockName)` of `survey_logic.js`: a name ending in `_ore` reads
as `stone` (`deepslate` when it starts with `deepslate_`), `ancient_debris` as `netherrack`; everything else
unchanged. The seeds pass yields in slices: `survey.js` awaits `ctx.clock.wait(0)` after every category and
every cluster, so the bot keeps moving.

`seedsOf(blocksByCategory, entities)` → `{ farmland: [pos], gates: [pos], doors: [pos], rooms: [pos], jobs: [pos],
cane: [pos], portals: [pos], down: [pos], villagers: [{ pos, profession }], animals: [{ pos, name }],
tied: [{ pos, name, knot: pos }] }`.

### 2.2 Seeds to places (E1, pure; the scans through the ore-blind reader)

`findPlaces(read, seeds, saved, options)` → `{ places: [place], kept: [{ name, inside }], skipped: [{ reason, at }] }`,
with `saved` the areas and places already in the stores (2.4) and `place = { kind, name, type, box: { min, max } |
null, at: pos | null, entrances, contents, border, source: 'survey', detail }`:

| Seeds | Rule | Place |
|---|---|---|
| farmland | for each farmland seed not yet inside a found or saved farm: `findOpenFarm(read, seed)`; the field's main crop names it (`potato_farm`, `carrot_farm`, `wheat_farm`, `beetroot_farm`; `farm` when no crop) | type `farm`, kind `farm`, border `open` (or the fenced farm of `scanFarm` when a fence ring holds it), the box of `findOpenFarm` |
| gates | for each gate not inside a found or saved area: `scanPenBehindGate(read, gate)`; the animals inside (`countContents`'s rules, pets excluded) name it by the majority species (`cow_pen`, `pig_pen`, `chicken_pen`, `sheep_pen`); a fenced ring without animals is a `yard` (kind `yard`, never a keep-out), with crops on tilled ground a farm (`kindOf`'s rules) | type `pen`, kind `pen` (a yard: type by `typeOfKind`) |
| doors | for each door not inside a found or saved area: `scanEnclosure(read, inside, { mode: 'building', floors: true })` from the cell on each side of the door, the side whose box holds the door wins; `kindOf` gives the kind (home, storage, building); the name: `house` for the home, `storage` for a storage, `hall` for a building with 2 villagers or more inside (2.3), else `building` | type by `typeOfKind`, the kind, the entrances of the scan |
| jobs and villagers | 2 villagers or more within 6 blocks of each other and of job-site blocks, inside a found building: that building is the `trading_hall` (kind `building`, `detail.professions`); outside any building: a place `trading_hall` at the villagers' centre | the building renamed, or a place |
| cane | `sugar_cane` seeds within 1 block of water, grouped by adjacency (8 neighbours): a group of 3 or more is `cane` with its count | type `farm`, kind `farm`, border `open`, the box of the group with a margin of 1; `detail.count` |
| tied | the leashed entity and its knot: a place `tied_<name>` at the knot (`tied_happy_ghast`) | a place; the report says "never untie, never break that post" once |
| portals | the lowest portal block of a group: a place `portal` | a place |

Names collide with a `_2`, `_3` suffix against the found and the saved names. `kept` lists every find whose box
lies inside or overlaps by half or more an area of the owner's (source other than `survey`): that find is not
saved and the report names it. A find that overlaps a saved `survey` area of the same kind replaces it (the box
and the contents are updated, the name stays); one of another kind is skipped with the reason.

### 2.3 The underground (E4, `underground_logic.js`, pure; the reads ore-blind)

From each found building (and each saved home or building of the owner's), the `down` seeds inside its box:

1. A trapdoor over a ladder column, or a ladder column, leads down: `followLadder(read, top)` → `{ top, bottom,
   x, z, face }` or null (a column of `ladder` blocks, at most 48 long).
2. The room at the foot: `scanEnclosure(read, foot, { mode: 'building', floors: true })` (the rock box of a
   dug room holding a bed, chest, furnace, table, ladder or door goes the building way already, F7). Found: the
   place `basement` (type `building`, kind by `kindOf`, `detail.under: <building name>`, the trapdoor as its
   entrance), shelter by `isShelterType`.
3. From the basement's walls: each opening of kind `gap` of its scan, and each air cell in its wall ring whose
   far side (2 cells out) is natural stone or cave air: `scanEnclosure(read, beyond, { mode: 'auto' })` → with
   `source: 'rock'` and `tunnel`: the place `mine_entrance` at the opening (and `detail.tunnel`); with `cave`: a
   keep-out `cave_mouth`, an area of type `building`, box the opening cell grown by 1 in every direction, flag
   `no_enter`, source `survey` (E4 lets `AreaStore.set` take it: 2.4).
4. The way: `routeOfSurvey(building, trapdoor, ladder, basement, opening)` → a route of the `RouteStore` shape
   (`legs`: a `walk` from the building's door to the trapdoor, a `door` leg with `kind2: 'trapdoor'`, a `ladder`
   leg with `top`, `bottom`, `face`, `entry`, a `walk` to the opening), `source: 'survey'`, named
   `<building>_to_<place>` (`house_to_mine_entrance`), `from` the building (kind `area`), `to` the place. Saved
   only when no route of that name exists.

The ladder through the trapdoor was never proven on the server (PLAN 9): W126 proves `!goToShelter` and the night
walk use this route first.

### 2.4 Saving, the base tag, `bases.json` (E4)

- `AreaStore` takes `source: 'survey'` (`AREA_SOURCES`), the optional `base: <name>` on an area, and a new method
  `rename(oldName, newName)` → the area or null (the file key and `name` change, nothing else). `PlaceStore` gets
  `rename(oldName, newName)` and the optional `base`. Both keep every other rule.
- `BaseStore` (`src/agent/world/base_store.js`, pure file store like `PlaceStore`): `bases.json` per world,
  `{ version: 1, bases: { <name>: { name, centre: {x, y, z}, dimension, door: {x, y, z} | null, surveyed: ISO,
  places: [names] } } }`; `set`, `get`, `list`, `remove`, `rename`.
- `surveyBase(bot, ctx, name)` in `survey.js`: the seeds (2.1), the places (2.2), the underground (2.3); every
  place saved at once: areas through `ctx.areas.set` (the shape of `rememberArea`'s save plus `source: 'survey'`,
  `base: name`), points through `ctx.places.rememberPlace` (the same `base`), routes through `ctx.routes.store`,
  the base through the `BaseStore` (the centre of the found boxes, the door of the home or the first building).
  `name` defaults to `base` when empty, then `base_2`. Then one report line (2.5).
- A survey with a saved base of that name: the places are compared with the saved `survey` places of the base
  (same name: changed when the box or the animal counts differ; new; gone when a saved survey place is not found
  and its seeds are gone) and the report is the difference line.

### 2.5 The commands and the texts (E4 the commands, E1 the texts in `texts.js`)

| Command | Does | Texts |
|---|---|---|
| `!surveyBase(name = '')` | 2.4 | `I found 12 places: house (2 beds), basement (9 chests, 5 furnaces), trading hall (7 villagers), potato farm 14 x 9, carrot farm 12 x 9, wheat farm 16 x 10, cow pen (5 cows), pig pen (4 pigs), chicken pen (9 chickens), cane by the water (22), a tied happy ghast at (x, y, z), a mine entrance at (x, y, z). All saved. Say "rename X to Y" or "forget X" to correct.` · a kept find: `..., a field at (x, y, z) inside your "wheat farm" (kept as yours), ...` · a cave: `..., a cave mouth at (x, y, z) that I keep out of, ...` · nothing: `I found no place of a base within N blocks. Stand in the base and say it again.` · again: `I surveyed "east" again: 2 more cows in the cow pen, the wheat farm is new, the pig pen is gone. The rest as saved.` / `I surveyed "east" again: nothing changed.` |
| `!renameArea(old, new)` | an area or a place (areas first) | `I renamed "X" to "Y".` · `I know no place "X".` · `There is a place "Y" already.` |
| `!forgetArea(name)` | as today, and a place or a base of that name too | as today; a base: `I forgot the base "X" and its 12 places.` |
| `!goToBase(name)` | walks to the base's door (the home's entrance; else the centre) with `ctx.routes.walkTo` | `I am at the base "X".` · `I know no base "X".` · the walk's own failure text |

The report's items, in this order: the home, the basement, the hall, the farms by size, the pens by count, the
cane, the tied animals, the portal, the mine entrance, the cave mouths; a kept find after the item it lies in.
Every number comes from the contents the code counted; nothing is said that the code did not check. The farms'
sizes are the fields' (as `openFarmText`), the pens' the animals' count.

Plain words: the default profile gets three examples (`here is the base, scan it` → `!surveyBase("base")`;
`this is the east base, look around` → `!surveyBase("east")`; `that is the wheat farm, not carrots` →
`!renameArea("carrot_farm", "wheat_farm")`), hidden with the switch (the example filter).

### 2.6 Tests of part S

Unit (E1, E4): `oreBlind` on a grid full of every ore: no result names an ore; `SEED_NAMES` holds no ore
(`xs_survey_seeds`); each detector on a synthetic grid: a 9 x 5 potato field, a fenced pen with 5 cows and a
roof, a house with 2 cats and a bed, a hall with 3 villagers at lecterns, a cane row of 22 by water, a portal, a
tied ghast; the names and their suffixes; `kept` for a find inside the owner's farm; the replace of a survey find;
the ladder follow, the basement, the tunnel and the cave; the route's legs; the stores' `rename` and `base`; the
report text word for word for the example of 2.5 (`xs_survey_places`, `xs_underground`, `xs_survey_report`,
`xs_stores_rename`). End-to-end (T3): `s19_survey` on the fake server with a tiny base if the fake server can hold
blocks (else a unit test on `survey.js` with a fake bot). World (T3): W126 "the base" (2 and 7.1).

## 3. Part R: Routines (E2)

Files: `src/agent/routines/routine_store.js` (per world: `bots/<name>/worlds/<seed>/routines.json`, bound at
spawn like the job store, `JobStore.bind`'s pattern), `routine_logic.js` (pure), `routine_texts.js` (pure),
`routines.js` (executing: the commands' work and the rounds); the job module gets a tenth kind (3.3);
`src/agent/watch/tools.js` registers the tool `routines` (3.5) behind the switch.

### 3.1 A routine

`{ name, text, steps: [{ command, check }] | null, every: minutes (15), condition: { item, fewerThan } | null,
state: 'active' | 'paused', rounds, fails, lastRound: ISO | null, created, updated }`. `name` normalised like an
area name; `text` at most 400 characters. Code reads two things from the text and nothing else: `every N
minutes` (or `every minute`, `every hour`) sets `every`; `when fewer than N <item>` sets `condition` (the item an
item name of the registry). At most `ROUTINE_RULES.max = 12` routines.

### 3.2 Planning (once, with the model)

`routinePlanPrompt(routine, inventory, areas, chests, commands)`: the first line fixed, `You plan the steps of a
Minecraft bot for a standing task the player described in his words.`; then the task (the text), the places the
bot knows (the areas by name and kind, the chests by position, from the stores, no model call), what it carries,
`The commands you may use:` with the lines of `ROUTINE_COMMANDS`; it closes with: one command per line, at most
8, double quotes, the first command runs first, `When the task cannot be done with these commands, answer NONE.`
The prompt goes through `promptPlan` (the chat model, purpose `plan`, with the rules section of the player as
every prompt has it).

`ROUTINE_COMMANDS`: `PLAN_COMMANDS` of `plan_logic.js` plus `!harvest(farm)`, `!plant(farm)`, `!farmCycle(farm)`,
`!storeItems()`, `!putInChest(item, num)`, `!fetchItem(item, num)`, `!goToRememberedPlace(name)`,
`!goToBase(name)` (when `base_survey` is on), `!collectBlocks(type, num)`, `!craftRecipe(name, num)`; never a
routine command, never `!newAction`, never `!stop`.

`checkPlan(steps, commands, blocked)` → `{ ok, reason, step }`: every command in `ROUTINE_COMMANDS` and not in
`agent.blocked_actions`, the arguments of the types and domains of the command's params (`parsePlan`'s rules), 1 to
8 steps. A plan that fails: not saved, the text of 3.6; `parsePlan`'s NONE: `noPlanText` of 3.6. A saved plan
is kept until the routine is forgotten or three rounds in a row fail (then one replan; a second failure of the
plan pauses the routine).

### 3.3 A round as a job

`job_logic.js` gets the kind `routine` in `JOB_COMMANDS`: `{ words: 'the routine "<name>"', count: false }`;
`job_store.js` accepts `kind: 'routine'` with `routine: name` and `round: n` (the validator); `createJob` gets
`startRoutineRound(routine)`: a job of kind `routine`, `by: 'player'`, `steps` the routine's saved steps with
their checks (`checkOf`), no plan call; `isDone` for the kind: every step done; `resumeCommand`: the next step;
the job's `stepRuns` (2), `maxFails` (3) and the errands hold as for any job; `doneText` for the kind is the
`roundDoneText` of 3.6 (one line, no narration between the steps beyond the job's own step lines). "Stop" ends
the round as any job (`state: 'left'`), the routine stays active. A round's failure (the job paused by
`noteFailure` or a failed step after its runs) counts `fails` on the routine; three in a row pause it (3.6).

### 3.4 When a round runs

`job.tick()` (every 5 s), when no job is running and `shouldResume`'s conditions hold for an empty job (no order
for `resumeSeconds`, nothing running, not sleeping, not night with the night shelter on, the bot not underground):
`nextRoutine(routines, now)` picks the active routine whose `lastRound` is oldest and older than its `every`
minutes and whose `condition`, if any, holds (the bag holds fewer than N of the item), and starts its round; the
`idle_jobs` list runs only when no routine is due (it stays as it is). `!doRoutine(name)` starts a round now and
unpauses a paused routine; a running job of another kind is refused with the job's `busyText`.

### 3.5 The commands and the tool

| Command | Does |
|---|---|
| `!rememberRoutine(name, text)` | saves the routine (3.1); the plan is made at its first round |
| `!routines()` | the list (3.6) |
| `!forgetRoutine(name)` | removes it; a running round ends (`left`) |
| `!doRoutine(name)` | a round now (3.4) |

The watch tool `routines` (`registerTool`, behind `routines`): `{ routines: [{ name, text, every, condition,
state, rounds, fails, lastRound, steps }] }` as JSON text; the supervisor starts one with `run ['!doRoutine("x")']`.
`.claude/skills/supervise/SKILL.md` step 3 names the tool (E2 edits the two lines).

### 3.6 Texts, word for word

`I remember the routine "the farm": harvest the wheat and the carrots and plant them again, then put the harvest in the chest by the door. I do it when I have nothing else to do, every 15 minutes.` ·
`I know that routine already as "the farm".` · `I have 12 routines already; forget one first.` ·
`My routines: the farm (every 15 minutes, 4 rounds, last 03:12); torches (when fewer than 32 torch, paused).` ·
`I have no routines.` · `I forgot the routine "the farm".` · `I know no routine "x".` ·
the plan: `My plan for "the farm": !harvest("farm"), !plant("farm"), !putInChest("wheat", 64). I start.` ·
`I could not plan the routine "the farm": <reason>. Say it differently.` (the reasons: `the command !x is not one I may use`, `!x takes a number`, `too many steps`) ·
`NONE`: `I cannot do the routine "the farm" with my commands. Say it differently.` ·
the round: `I start the routine "the farm", round 5.` · `Round 5 of "the farm" is done.` ·
`I pause the routine "the farm": !harvest("farm") failed three times. Say "do the routine the farm" to try again.` ·
`!doRoutine` while a job runs: the job's `busyText` · the condition holds not: `The routine "torches" waits: I have 40 torch.`

### 3.7 Tests of part R

Unit (E2): the store (bind, the shape, 12 at most), the text parse (`every`, `fewer than`), `routinePlanPrompt`
word for word for the example, `checkPlan` (a command outside the list, a wrong type, 9 steps, a blocked
command), the tenth kind through the validator, `nextRoutine` (the oldest due, the condition, `every`, the
`idle_jobs` after), a round's end and the pause after three failures, the commands' texts (`xr_routine_store`,
`xr_routine_logic`, `xr_routine_round`, `xr_routine_commands`), the watch tool (`xr_routines_tool`). End-to-end
(T3): `s20_routine_round` on the fake server with the fake model answering the plan prompt with two commands the
fake world can satisfy (`!collectBlocks("dirt", 2)`, `!craftRecipe("oak_planks", 1)` or what the fake server
holds): the plan line, the round, the done line, the second round after `every minute`. World (T3): W127 "the
farm routine" (7.2).

## 4. The prompt budget

The eight commands' docs (section 2.5 and 3.5) are one line each with one-line params. E2 measures the prompt with
every switch on after both parts are in and raises `LIMIT_ALL_ON` and `LIMIT_NEW_THINGS` of the six budget files
and the literals of `xt26_new_things` by the measured growth, rounded up to the next 100, with the reason in each
file. With both switches off the prompt is byte for byte v0.1.4.14's (`LIMIT_ALL_OFF` unchanged; a test proves it).

## 5. Order of work

1. The lead writes this spec; T3 writes W126 and W127 from PLAN.md and this section's 7, runs them against
   v0.1.4.14 (they must fail: no `!surveyBase`, no `!rememberRoutine`).
2. E1 (S, the pure logic and the texts), E4 (S, the areas, the underground, the stores, the wiring and the
   commands) and E2 (R) in parallel; E1 and E4 agree on the shapes of 2.1 and 2.2 on the first day through the
   lead; E4 integrates E1's module.
3. The lead merges, runs unit and end-to-end, runs W126 once; a failing W126 is a finding of the survey round and
   is fixed before Routines' scenarios run. Routines' budget: four days from the start of step 2; over it, the
   release ships the survey alone (PLAN 2).
4. T1 writes the tests from the spec (sections 2.6 and 3.7 as the tester reads them), the lead runs the full set
   once in a fresh clone (section 6), the fix round, `DECISIONS.md`, the changelog, the pull request, the tag
   `v0.1.4.15`, the play guide.

## 6. The gate

In a fresh clone with Node 22 and the 26.1 server: `npm test` with 0 failures; `npm run test:e2e` with 0 failures;
`node tests/world/run.js journeys journeys13 copper_age creeper_in_sight natural_smoke fresh_world night_falls
open_farm open_ground base farm_routine` with every scenario passing.

## 7. The scenarios (T3)

### 7.1 W126 "the base" (`base`, base world, 1200 s)

The control builds, in free space of the region: a house (walls, a roof, a door, a bed, a chest, a crafting table,
2 cats), under it a basement reached by a trapdoor in the floor and a ladder of 6 (a dug room with a chest and a
furnace), from the basement a tunnel of 12 into the rock (2 wide, 2 high, straight) and, on the other wall, an
opening into a dark cave of 5 x 5 x 4; an unfenced potato field of 9 x 5 beside the house; a fenced pen with 5
cows and a roof of planks; a fenced pen with 4 pigs; a lectern and a composter with 3 villagers (`summon
villager` with the professions); a row of 12 sugar cane by a pool; a happy ghast leashed to a fence post if
`summon` with a leash works on 26.1 (else noted and skipped); a nether portal frame lit if `setblock
nether_portal` holds. The bot stands at the house door with an empty memory and the switches on.

Checks: A typed `!surveyBase("east")`: within 60 s one report line that names every place above with the counts
the control knows (5 cows, 4 pigs, 3 villagers, 12 cane, the potato farm 9 x 5), `All saved.`; `areas.json`
holds the house as a home, the basement as a building under it, the two pens, the farm (border `open`), the cane,
the cave mouth with `no_enter`; `places.json` the mine entrance (and the tied ghast); `routes.json` the route
house to mine entrance with a trapdoor leg and a ladder leg; `bases.json` the base `east` with its door. B
`!renameArea("potato_farm", "spuds")` renames it and `!routines`-free `!forgetArea("pig_pen")` forgets it; a
second `!surveyBase("east")` reports `the pig pen is new` and nothing else changed. C the owner's words: the
control saves `wheat_farm` by hand over half of the potato field before a third survey: the report says the field
is inside the owner's "wheat_farm" and kept, and `wheat_farm` is unchanged. D the underground in use: at night
`!goToBed` from the mine entrance takes the ladder up through the trapdoor and sleeps in the house's bed (the
route of 2.3.4 is walked; the bot never stands in the cave). E the x-ray guard: the control places 20 iron ore in
the rock around the basement before the survey; no report, no area, no place and no route names ore, and the
bot's `!stats`/the watch `state` show no ore knowledge.

### 7.2 W127 "the farm routine" (`farm_routine`, base world, 1200 s)

The base's fenced wheat farm ripe, a chest by the house door, the bot idle with the switch on and
`job_resume_seconds` 10. A typed `!rememberRoutine("the farm", "harvest the wheat farm and plant it again, then
put the wheat in the chest by the door, every minute")`: the remember line; within 70 s (the resume wait and the
first round) the plan line with `!harvest`, `!plant` (or `!farmCycle`) and `!putInChest` in it, the round's start
and done lines; the farm's cells replanted (server), wheat in the chest (server), none in the bag; a second round
within the next 90 s with no new plan line; `!routines` lists it with 2 rounds; a `!stop` during a third round
ends the round and `!routines` still lists the routine active; `!forgetRoutine("the farm")` and no fourth round
within 120 s. Before this release the first command answers `Command '!rememberRoutine' does not exist.`

### 7.3 Both must fail on v0.1.4.14 and pass on the release; the gate runs them with the set.
