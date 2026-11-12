# Spec v0.1.4.16 "Stability, and three packs"

Round one: the twelve fixes of PLAN section 4 (F1 to F12). Round two (the three packs) gets its sections when the
owner has answered PLAN section 10. The code maps the spec rests on are the lead's `map16-x1.md` (F1, F6, F10),
`map16-x2.md` (F2, F3, F4) and `map16-x3.md` (F5, F7, F8, F9, F11, F12); every engineer reads the map of its part
before the first edit. Line numbers in the maps are of main at 9a28d07.

## 0. Rules

1. Every text below is used word for word. A text with `<...>` has a slot; the slot's form is given beside it.
2. Change only the files of your part (section 2). A change you need elsewhere is a request in your report; the
   lead routes it. Never a git command that writes.
3. A module stays importable at every save: the export first, the import of it in another file second.
4. Zero new model calls. The one model call this round touches is the routine plan (F3), which gains rules.
5. A fix changes the behaviour the finding names and nothing beside it. Where a text with a pinned test changes,
   the test changes with it and the report says so.
6. The owner's standing rules hold: never read, create, copy, stage, commit or print `keys.json`; never commit
   anything under `bots/`; never connect to port 55916; never run `test-routing.ps1` or `scripts/routing_check.js`
   without `--dry-run`; never start the bot against a real model in a test; kill only processes you started, by
   pid; never bump a pinned dependency. F7 edits the mineflayer patch, not the version: the patch is applied by
   `npm install` and `npm test` runs on it; the owner's play test covers it, as every patch.
7. The prompt budget: the pinned limits (`LIMIT_ALL_ON` 18,300, `LIMIT_NEW_THINGS` 18,700, `LIMIT_ALL_OFF`
   11,000 in `gjg_prompt`, `glue2_prompt_size`, `rt_glue`, `st_glue_prompt`, `stg_prompt`, `rtg_prompt`,
   `xt26_new_things`) move only by the docs a new command adds, measured, and the report gives the numbers. Off,
   the prompt is byte for byte v0.1.4.15's (`glue2_flags_off`).
8. Logs: a stop, a refusal and a skip write one line through `logTo` (the packs) or `console.log` with the step,
   the position and the text, so the owner's log answers "why" (R-7's lesson).

## 1. Settings

| Setting | Default | Meaning |
|---|---|---|
| `survey_cluster_gap` | 48 | With `base_survey`: two finds farther apart than this (x/z distance between their boxes or points) belong to different bases; the survey saves the cluster the bot stands in and reports the others. In `settings.js` after `survey_radius`, in the settings spec, in `tests/routing/commands.js` (`SPEC_SETTINGS`), in `routing_list`. |

No other setting. The fixes have no switch.

## 2. Parts and owners

| Part | Owner | Files (yours to change) |
|---|---|---|
| A: the reflexes, the beds, the caves, the wood (F1, F6, F10, F11-wood, F11-bee) | E1 | `src/agent/packs/home/creeper_logic.js`, `creeper.js`, `sleep.js`, `sleep_logic.js`, `texts.js` (home), `motion.js`; `src/agent/modes.js` (the creeper mode's say rule only); `src/agent/library/skills.js` (`collectBlock`/`collectBlocks`, `caveAt` and the new `inCave` only); `src/agent/packs/mining/mine_logic.js` (`tunnelStep` beyond-cells only) and `mining.js` (`!sealOpening` glue only); `src/agent/commands/actions.js` (`!sealOpening`, `!collectBlocks` cave text); `src/agent/packs/wood/wood.js`, `wood/actions.js`; `src/agent/world/area_scan.js` (`hasCoverBesideTrees`); `src/agent/packs/survey/survey_logic.js` export of `SEED_NAMES.jobs` is read, not changed; tests `tests/unit/xu_*.test.js` and the pinned ones named in F1, F6, F10, F11 |
| B: the survey, Routines, the farm, the watch run (F2, F3, F4, F9) | E2 | `src/agent/packs/survey/*`, `src/agent/world/base_store.js`, `src/agent/routines/*`, `src/agent/job/index.js` and `job_logic.js` (the routine round only), `src/agent/packs/farming/farming.js`, `field_logic.js`, `crop_logic.js`, `farming/texts.js`, `src/agent/packs/home/shelter.js` (`leaveBuilding` only), `src/agent/watch/queue.js`, `watch/texts.js`, `watch/tools.js` (`runs` tool), `src/agent/chat_gate.js`, `src/agent/agent.js` (the echo of F9 and the `quiet` flag only), `src/agent/commands/actions.js` (`!forgetArea`, `!renameArea`, `!surveyBase`, `!harvest`, `!rememberRoutine` answers), `src/agent/rules/rule_commands.js` (the cap text), `settings.js` and the settings spec (`survey_cluster_gap`), `tests/routing/sentences.json`, `tests/routing/commands.js`, `profiles/defaults/_default.json` (the examples of F2); tests `tests/unit/xv_*.test.js` and the pinned ones named in F2, F3, F4, F9 |
| C: the mining, the dig, the clock, the orders, the history (F5, F7, F8, F11-chest, F12) | E3 | `src/agent/packs/mining/mining.js`, `mine_logic.js`, `mine_player.js`, `texts.js` (mining), `supply_logic.js`, `bag_logic.js`, `dig.js`; `patches/mineflayer+4.39.0.patch` (`digging.js` only); `src/agent/library/skills.js` (`craftRecipe`, the leaves fallback of `goToGoal`, `walkNearWithoutDigging`) and `src/agent/**/way_logic.js`; `src/agent/history.js`; `src/agent/commands/index.js` (the order check), `queries.js`, `full_state.js`, `src/agent/packs/home/night_logic.js`, `clock_logic.js`, `src/agent/watch/tools.js` (`phaseOf` only); `src/agent/job/index.js` (`progress` of F5 only); `profiles/defaults/_default.json` (the `!mineOre` example of F5); tests `tests/unit/xw_*.test.js` and the pinned ones named in F5, F7, F8, F11, F12 |
| T: the scenarios | T3 | `tests/world/w128_*.js` to `w133_*.js`, `tests/world/run.js` (the six entries), `tests/world/w126_base.js` (check A1), `tests/world/journey.js` helpers if needed; `tests/world/README.md` |

Two owners in one file (`actions.js`, `skills.js`, `job/index.js`, `watch/tools.js`, `_default.json`): each edits only
the functions named for it, with one commit of the lead between rounds of edits when both report. The lead
resolves a clash.

## 3. The fixes

### F1 The creeper reflex (E1)

Rules:
- `countsForBot` (`creeper_logic.js`): a creeper counts when `dBot <= 16`, `|dy| <= 3` and `sight !== false`. The
  6-block bypass of the sight check is gone. `CREEPER_RULES.botHeight` becomes 3; `botClose` is removed from the
  rule (kept as a constant only if a test of the lure step reads it).
- `countsForArea`: as today, with `areaHeight` 3 and `sight !== false` as well, so a creeper under the base's
  floor through rock is no area creeper.
- The flee points (`backOffPoint`, `lurePoint`, `runPoint`, `attentionPoint`): a candidate is clear only when the
  ground under it (the highest solid block at the candidate's x/z within 3 blocks down from the bot's y) lies
  within 1 block of the bot's y, and the candidate lies in no area with `no_enter` (`isKeepOutArea` of
  `keep_out_logic.js`). A reader `groundYAt(x, z)` comes in the state from `creeper.js`.
- The walk of `runCreeperProcedure` (`creeper.js`): the goal is `GoalNear(x, groundY, z, 1)` (the y of the
  candidate's ground), and the movements get `maxDropDown = 1`. The bot never goes down more than a block per
  step and never into a hole.
- The help line `A creeper keeps following me near the base. I stay away from the buildings. Can you help?` is
  said when a run reaches 3 tries and `now - memory.lastHelp >= 120000`; `lastHelp` is set when it is said. The
  log line (`logTo`) stays on every run; the chat line is once per 120 s.

Tests: `tests/unit/xu_creeper_sight.test.js`: a creeper 12 below through rock with `sight false` at 5 blocks
sideways does not count; the same at `|dy| 3` with sight counts; a creeper at 5 blocks with `sight false` (behind a
wall) does not count (the bypass is gone); the flee candidates skip a point whose ground is 4 blocks lower and a
point in a `no_enter` area; the help line once in 120 s over four runs. The pinned tests `stc_creeper`,
`home_creeper_logic`, `home_creeper`, `xk_creeper_loop` change where they relied on the bypass; the report lists
each changed assertion.

### F6 The bed of `!goToBed` (E1)

Rules:
- The bot's own bed: when `sleepInBed` succeeds, the bed's foot is saved as the place `my_bed` (source `auto`)
  through `ctx.places` (the PlaceStore; `rememberPlace('my_bed', pos, dimension)`); a later sleep in another bed
  moves it. `my_bed` is never listed in the places line of the prompt (the PlaceStore's `listed === false` flag, or
  a name filter where the line is built; E2 is told, since the line is the survey's neighbour).
- The order of `orderBeds` (`sleep_logic.js`): first `my_bed` when it stands; then the beds inside an area of kind
  `home` or of a shelter type the owner saved (the AreaStore's `isShelterType`, `source !== 'survey'` for the owner's,
  the survey's `home` too); then the rest by distance. Excluded: a bed inside the box of a saved place or area of
  kind `trading_hall`, a bed within 8 blocks of a job-site block (`SEED_NAMES.jobs` of `survey_logic.js`, read
  through `bot.findBlocks` around the bed), a bed within 8 blocks of a villager entity.
- Texts: `All beds nearby are taken.` only when a non-excluded bed was occupied; when every bed within 32 blocks
  is excluded: `The beds nearby are the villagers'; I found no bed of mine.` (new, `TEXTS.villagersBeds`); no bed
  at all: `I found no bed nearby.` as today.

Tests: `tests/unit/xu_bed_order.test.js` on the fake bot: own bed first, a home's bed before a nearer stray bed, a
bed by a lectern excluded with the new text, a bed by a villager excluded, the taken text only for a candidate
bed. Pinned: `home_sleep_food`, `home_food_sleep_logic` (orderBeds).

### F10 The caves (E1)

Rules:
- `inCave(bot, pos, ctx)` (`skills.js`, exported): true when the block at `pos` has natural rock above it within
  24 blocks and no sky (`isNaturalCeiling` of the `CAVE_RULES`), and `pos` lies in no saved area and in no
  known mine (`ctx.mines?.mineAt(pos)` or the mining pack's `mineAt`, through optional chaining), and the bot
  itself stands in no saved area or known mine. A basement, a saved cave room (an area the owner saved) and a
  mine are never a cave.
- `!collectBlocks(type, num)` (`collectBlock`/`collectBlocks` of `skills.js`): candidates in a cave are skipped;
  when every candidate within range is in a cave, the command ends with `That is in a cave; I do not go there
  alone.`; when some are, the others are collected and nothing is said about the skipped ones. The line is
  returned to the model and said (`agent.sayText`), so the owner sees it. Log line: `Caves: skipped N <type> in a
  cave at (x, y, z) ...` (the first three positions).
- Every walk built by `makeMovements` (`home/motion.js`) honours the `no_enter` areas it is given: `areas` with
  `no_enter` get `exclusionAreasStep` with `KEEP_OUT_COST` (the function of `keep_out_logic.js`), so no walk of
  the home, farming, wood or mining pack crosses a cave mouth the survey saved. The raw `new pf.Movements` of
  `skills.js` (`goToGoal`, the player walks) get the same through one helper `applyKeepOut(movements, areas)`
  exported from `motion.js` and called where `exclusionAreasBreak` is set today (skills.js ~2267).
- The mining (`mine_logic.js` `tunnelStep`): air in a `beyond` slot with no air ahead gives result `turn` with
  the beyond cells adjacent to the end face as `patches` (today: nothing patched). `digTunnel` patches them with
  filler when the bag has it (as for the ahead cells) and says the existing side-step line; without filler the
  wall stays open as today and the log says so.
- `!sealOpening(x, y, z)` (behind `mining_pack`; one line of docs: `Close an opening into a cave at a block
  position with stone from the bag, up to 9 blocks.`): the bot walks within reach of the cell, finds the air
  cells of the opening's face connected to the cell within a 3 x 3 (at most 9), places filler into each
  (`placeInto`, `FILLERS`), and answers `I sealed the opening at (x, y, z) with N cobblestone.` (the filler's name
  in the slot) or `I have no stone to seal it.` or `I cannot reach (x, y, z).` Registered in `actionsList`,
  blocked when `mining_pack` is off, in `PART_COMMANDS`, `NEW_EXAMPLES`, one routing sentence ("seal that hole at
  (x, y, z)").

Tests: `tests/unit/xu_cave_collect.test.js` (the fake world of `nn_player`: a stone in a cave under rock skipped
with the text; the same stone inside a saved area collected; inside a known mine collected; a mix collects the
surface ones); `xu_keep_out_walks.test.js` (`makeMovements` with a `no_enter` area gives a step cost of 100 inside
it; `applyKeepOut` on a raw Movements); `xu_seal_opening.test.js` (the fake mining bot: 9 air cells filled, the
texts); `mining_logic` gains the beyond-cells case. Pinned: `nn_player`, `nv_navigation` (caveWatch unchanged),
`mining_logic` (`tunnelStep` beyond: the result stays `turn`, the patches are new).

### F11 The wood and the bee nest (E1); the mine chest (E3)

- E1: `digAt` of `wood.js` on a leaves block uses the hand (`'hand'`, never the axe); `pillarUp` the same. The
  axe is swung at logs only. Test: `wood_chop` or a new `xu_axe_on_leaves.test.js` on the wood fake bot: after 10
  leaves the axe's durability is unchanged.
- E1: `hasCoverBesideTrees` (`area_scan.js`): `bee_nest` and `beehive` are no cover, and a block that touches
  leaves on any side is no cover. Test: `area_scan` gains the bee nest under oak leaves: no yard.
- E3: `depositAtBase` (`mining.js`) stores only the mining's kinds: `isMineChestKind(name)` (`bag_logic.js`,
  exported): every ore and raw metal, coal, redstone, lapis, diamond, emerald, amethyst shards, the stone kinds
  and `FILLERS`, gravel, flint, dirt, sand, clay, the kept kinds excluded as today. Saplings, seeds, the bed, the
  crafting table, wood, food and tools stay in the bag. `storeFullBag` (`bag.js`) keeps its rule (a full bag stores
  what is not kept) but stores the mine-chest kinds first and the rest only when the bag is still full after them.
  Tests: `xq_bag` or `xw_mine_chest_kinds.test.js`: a bag with saplings, a bed and raw iron after a trip stores the
  raw iron and the cobblestone, not the saplings or the bed.

### F2 The survey's base (E2)

Rules:
- Clusters (`survey_logic.js`, pure): `clustersOf(finds, gap)` groups the finds (boxes and points) by connectivity:
  two finds are connected when the x/z distance between their boxes (edge to edge, 0 inside) or points is at
  most `gap`. `survey.js` takes the cluster that contains the bot's start (the find whose box holds `botAt`, else
  the cluster of the nearest find) and saves only it. Every other cluster is reported, not saved: for each,
  `N places about D blocks <dir> (another base or a village): not saved; survey it from there for its own name`
  where N is its count (the whole line reads `I left out 2 places about 100 blocks south (another base or a
  village): not saved; survey it from there for its own name.`), D the distance from the start to its nearest find rounded to 10, `<dir>` one of north,
  south, east, west, north-east, north-west, south-east, south-west. The sentence joins the report after `All
  saved.` as `I left out ...` (one per cluster, joined with `; `). Setting `survey_cluster_gap` (section 1).
- Centre and door (`baseOf`): the centre is the average of the saved boxes' centres (as today, cluster only);
  the door is the door of the house that holds the place `my_bed` (F6; read through `ctx.places.get('my_bed')`
  with optional chaining), else the `home` nearest the start, else the building with a door nearest the start.
- `home` once: after `findPlaces`, `survey.js` keeps `home` for the house that holds `my_bed`, else for the home
  nearest the start, and demotes every other `home` to kind `building` (type `building`, no shelter), name
  `house_N` as `uniqueName` gives. The report says them as `house (1 bed)` as today.
- The owner's areas in the base: the finds `kept` inside the owner's areas add the owner's area's name to a new
  list `kept` of the base (`bases.json`: `{ name, centre, door, dimension, places, kept, surveyed }`;
  `BaseStore.validateBase` accepts `kept` as an optional array of names). `forgotBaseText` counts `places` only;
  `forgetSurveyed(base)` removes `places`, never `kept`. `!goToBase` is unchanged.
- `places` holds only names the stores confirmed: `savePoint` counts a save when `rememberPlace` returned `true`;
  without a store the point is not saved and not listed (the report's N counts saved items only, as today).
- Forgetting: `!forgetArea(name)` (`actions.js`) calls `pack.removeFromBases(ctx, name)` (new in `survey.js`, next
  to `renameInBases`) after `store.remove(name)` and in the place branch of `forgetSurveyed`; the name leaves every
  base's `places` and `kept`.
- The report is the bot's own line: `!surveyBase`, `!renameArea`, `!forgetArea` (both branches), `!goToBase` say
  their result through `ctx.say` (`agent.sayText`: history plus chat) and return to the model the short answer
  `Done; I said it in the chat.` for a success and the error text as today for a failure. The texts themselves do
  not change. `survey.js` gets `ctx.say` through `packContext` (it exists: `ctx.say = agent.sayText`).
- The rename in words: `tests/routing/sentences.json` gains four `base_survey` sentences: "rename pen to
  horse_house", "rename the pen to horse house", "call the cow pen cows from now on", "the pen is the horse
  house, rename it" → `!renameArea`; `_default.json` gains a second `!renameArea` example (the owner's words
  "rename pen to horse_house" → `!renameArea("pen", "horse_house")` and the bot's line); `examples_valid` and
  `routing_list` follow.

Tests: `tests/unit/xv_clusters.test.js` (two clusters 100 blocks apart, the start's one saved, the report's left-out
sentence word for word, the gap setting), `xv_base_door.test.js` (the door of the house with `my_bed`; the
nearest home without; one home only, the rest `building`), `xv_forget_in_bases.test.js` (`!forgetArea` of a survey
place and of an owner's area removes the name from `places`/`kept`; `kept` never forgotten by a base forget),
`xv_survey_says.test.js` (the report goes through `ctx.say`, the model gets the short answer). Pinned:
`xs_survey_wiring`, `xs_survey_report`, `xs_stores_rename` (the base shape), `examples_valid`, `routing_list`,
`rtd_routing_check`.

### F3 Routines (E2)

Rules:
- The plan prompt (`routinePlanPrompt`) gains two lines before "Answer with the steps": `Every place the player
  names and every coordinate (x, y, z) in the task is a step of its own before the work there:
  !goToRememberedPlace("name") for a saved place, !goToCoordinates(x, y, z, 2) for a coordinate. Keep the
  player's numbers.` `!goToCoordinates` joins `ROUTINE_COMMANDS` (`usage: !goToCoordinates(x, y, z, closeness)`,
  params int, int, int, int default 2; description `Walk to a coordinate.`).
- The check (`checkPlan`): it gets the task text; every coordinate of the text (the pattern
  `(-?\d+),\s*(-?\d+),\s*(-?\d+)` inside parentheses) must appear as a `!goToCoordinates` step with the same three
  numbers, and every saved place whose name appears in the text (the names of `placesLine`) as a
  `!goToRememberedPlace` step; otherwise the plan is refused with the reason `places` and the line `I could not
  plan the routine "<name>": the plan lost <what> you named. Say it differently.` where `<what>` is `the place
  (x, y, z)` or `the place "name"`.
- A failed step: in `stepResult` (`job/index.js`), a routine step that fails after `stepRuns` tries is marked
  `skipped` with the quiet line `Step <n> of "<name>" failed: <text>; I go on.` (`sayQuiet`, `history: false`), the
  round goes on with the next step; the round is `done` when every step is done or skipped and at least one is
  done (`rounds + 1`, the done line as today), and `failed` only when every step was skipped (`noteRound` fail, the
  pause after three as today).
- The round number: a persisted counter `runs` on the routine (the store's shape gains `runs`, default 0),
  incremented at each round start; `roundStartText` and `roundDoneText` use `runs`.
- The idle test: `JobIndex` gets an option `isBusy()` (from `agent.js`: `() => agent.watch?.watch?.queue?.isActive?.()
  === true || (agent.watch?.watch?.queue?.size?.() ?? 0) > 0`); `tick()` runs no routine round while `isBusy()`,
  and a running round is not interrupted by it (the queue's command interrupts it as any order would).
- The caps: `TEXT_TEXT` becomes `The text of a routine is 1 to 400 characters; yours has <n>.` and the rule
  store's line `A rule has at most 200 characters; yours has <n>.`; both are said by the bot (`agent.sayText`)
  and returned to the model.
- `!harvest("sugar_cane")` and the cane: `harvestCrops` resolves `sugar_cane`, `cane` or the name of a survey area
  with `detail.what === 'cane'` to that area; on a cane area it cuts every cane column from its second block up
  (dig the block above the bottom one; the rest falls), collects the drops, plants nothing, and says `I cut <n>
  sugar cane at "<area>" and picked them up.`; a cane area with nothing above the bottom row: `The cane at
  "<area>" has not grown yet.` `!farmCycle` on a cane area does the same and stores the cane.

Tests: `xv_plan_places.test.js` (the prompt lines; a plan without the walk step refused with the text; with it
accepted), `xv_round_skip.test.js` (on the job fake: step 2 of 3 fails, the round is done, the quiet line, `runs`
2 after two rounds; all steps fail: the round is failed), `xv_idle_busy.test.js` (`isBusy` true: no round due;
false: the round runs), `xv_caps_text.test.js`, `xv_cane.test.js` (the farming fake bot with a cane area: the cut,
the drops, the texts). Pinned: `xr_routine_logic`, `xr_routine_round`, `xr_routine_store`, `xr_routine_commands`,
`gja_job_index`, `farming_actions`; `s20_routine_round` (e2e) keeps passing.

### F4 `!farmCycle` from inside a building (E2)

Rule: `leaveBuilding(bot, ctx)` (new in `home/shelter.js`, exported; the model is `goToSurface`'s building part):
when the bot stands inside a building area (`inBuildingHere`), walk to its nearest entrance and `passThrough` it
outward (`{ inside: area }`), without digging; returns `{ ok, area }`. `prepare` of the farming pack calls
`ctx.home.leaveBuilding?.(bot, ctx)` before `enterField` when the bot is inside a building (the farm itself is no
building). Text on failure: `I cannot get out of "<area>" to the farm.` Tests: `xv_leave_building.test.js` on the
home fake bot (a bot inside the W126 house walks out through the door before the farm), `farming_actions` gains
the case through the fake's `home.leaveBuilding`.

### F9 The watch's `run` (E2)

Rules:
- A command that comes from the watch queue carries `quiet: true` through `handleMessage(owner, text, { quiet })`
  (a third argument, default `{}`); `routeResponse` skips the echo `*<owner> used <command>*` and the model's
  command echo (`show_command_syntax`) for a quiet message; the command's own lines (`sayText` of the packs, the
  result when `say_results` is on) are unchanged. `openChat` keeps the `isQuiet()` rule for the async context.
- The answer: `answerMs` stays 55 s; the answer is `Ran <done> of <total>. Still running: <command> (run <id>).`
  where `<id>` is the queue item's id; a new watch tool `runs` (through `registerTool`, `TOOL_NAMES` untouched)
  lists the queue's items of the last hour: `{ id, command, state: 'running'|'done'|'failed', text, startedAt,
  endedAt }`, so a supervisor script polls `runs` instead of taking `Still running` as finished. The supervise
  skill (`.claude/skills/supervise/SKILL.md`) gets two lines about it (E2 edits that file; PR #25 also edits it,
  the lead resolves the merge).

Tests: `xv_quiet_run.test.js` (the fake agent: a quiet message writes no `*used*` line to `openChat`, a typed one
does), `xv_runs_tool.test.js` (the tool's list after a run; the answer text with the id). Pinned: `xs_queue`,
`xt_queue`, `xw_chat_gate`, `glue_agent`.

### F5 The mining (E3)

Rules:
- Every stop: `finish(ok, reason, extra)` writes `logTo(ctx, 'Mining stop: <reason> at (x, y, z), step <step>: <text>')`
  with the trip's last step name and its text (`t.text` kept in the loop as `lastText`); the chat line gains the
  detail: `I mined <n> <item> of <m>. I stopped because <STOP_REASONS[reason]>: <text>` when a text exists, the
  old line without it. `mineOreText` and `tunnelText` get the optional third part; the pinned texts tests change
  with them.
- `new_mine`: `tripStart` (`mine_logic.js`) returns `'new'` when `input.newMine` is true, before `'use'`; the new
  mine starts where the bot stands when it is on the surface, else at the surface above the bot (the existing
  new-mine flow); the first line of the trip is `I start a new mine here, as you said.`
- A forgotten mine: when the trip starts `underground` and no known mine is at the bot, `mineHere` runs even
  with `mine_routes` off: a tunnel of width 1 or 2 at the bot's feet (`tunnelAt`) becomes the mine `mine_<n>`
  (`uniqueName`) with the line `This tunnel is a mine now: "mine_2" at (x, y, z).` and the trip uses it; only a
  bot in an open cave gets `undergroundNoMine`.
- The way down: `'blocked'` only for lava, water and a cave the shaft cannot get around; a failed or timed-out
  dig is the reason `dig_failed` with the text `I could not dig the <block> at (x, y, z).` (`STOP_REASONS.dig_failed`
  = `I could not dig the <block> at (x, y, z)`); the blocked line names the block: `Lava, water or caves block the
  way down at (x, y, z): <block>, and I found no way around them.`
- The count at the start: a `!mineOre` that resumes a job (`ctx.job` has the job with `got > 0`, or the job's
  `created` is older than the order) counts the bag: `startCount = max(0, countOf(bot, item) - job.got)` so the
  bag's ore of the earlier trips is counted once; a fresh order counts from the bag as today. The profile's
  `!mineOre` example keeps the player's number ("mine 32 iron" → `!mineOre("iron", 32, false)`).
- The pickaxe: `wornStopText`'s "no <word>" is said only when `pickaxeToCraft` found no material; when the craft
  failed with material in the bag the line is `My <name> is nearly worn: <uses> uses left. I could not make a new
  one: <reason>. I stop the mining at <mined> of <wanted> <ore>.` with `ensureTool`'s reason.
- The craft and the unstuck reflex: `skills.craftRecipe` runs between `pauseUnstuck` and its release (the agent's
  `pauseUnstuck` reached through `agent` as `runPack` does; `!craftRecipe`'s perform wraps it); `stuckSample`
  counts an open window within the last 10 s as progress.

Tests: `xw_mine_stop_reason.test.js` (the texts with and without the detail; the log line), `xw_new_mine.test.js`
(`tripStart` with newMine and a known mine → `'new'`), `xw_forgotten_mine.test.js` (the fake world with a tunnel,
no store entry: the mine is made, the line), `xw_way_down.test.js` (a failed dig → `dig_failed` with the block;
lava → blocked with the block), `xw_resume_count.test.js`, `xw_worn_craft.test.js`, `xw_craft_pause.test.js`.
Pinned: `mining_texts`, `rt_mine_texts`, `nw_mine_texts`, `nm_logic`, `ste_mining`, `rt_mine_player`,
`gja_job_index`, `sta_stuck_logic`, `craft_recipe`.

### F7 The dig with enchanted tools; the leaves (E3)

Rules:
- The patch (`patches/mineflayer+4.39.0.patch`, `digging.js` `digTime`): the enchantments of an item are read
  through `enchantsOf(item)`: an array as it is (`[{name, lvl}]`), an object `{enchantments: [{id, level}]}` (the
  component of 26.1) mapped to `[{name: mcData.enchantments[id].name, lvl: level}]`, anything else `[]`; the
  helmet's the same. The probe first: on the test server, `/give <bot> diamond_pickaxe[enchantments={efficiency:3}]`
  and a dig of stone with the fake-free bot of `tests/world` (a tiny scenario script in the scratchpad, not in the
  repo) proves the error and then the fix; the report quotes both runs.
- The leaves: `mayDigOnFallback` (`way_logic.js`) allows every `*_leaves` block when the bot's start cell has
  leaves in two or more of the six neighbours (a canopy); the fallback walk's movements then may dig leaves only
  (`movementsFor` of the wood pack is the model: `blocksCantBreak` everything but leaves). The text is unchanged.

Tests: `xw_enchants_of.test.js` (the three shapes, with a recorded 26.1 item from the probe), `xd_way_fallback`
gains the canopy case. The patch is regenerated with `npx patch-package mineflayer` and `npm install` applies it
cleanly (the report shows the `patch-package` lines).

### F8 The clock and the orders (E3)

Rules:
- One clock: `dayPhase(timeOfDay)` in `clock_logic.js` (exported): `morning` 0 to 5999, `afternoon` 6000 to 11999,
  `evening` 12000 to 12999, `night` 13000 to 22999, `dawn` 23000 to 23999. `!stats` (`queries.js`), `full_state.js`,
  the watch's `phaseOf` use it with the labels `Morning`, `Afternoon`, `Evening`, `Night`, `Dawn`; `isNight` of
  `night_logic.js` is `phase === 'night'` (13000 to 22999, the game's sleep window begins at 12542: the shelter
  reflex keeps its own start as today, only the label changes). A unit test on the recorded `update_time` packets
  of 26.1 (`xl_time_runs` has them) checks the label at five times.
- The model's own orders: `WORK_COMMANDS` (`commands/index.js`, exported) = `!collectBlocks`, `!mineOre`,
  `!chopTrees`, `!farmCycle`, `!harvest`, `!plant`, `!newAction`, `!digDown`, `!digTunnel`, `!smeltItem`,
  `!craftSupplies`. `executeCommand` refuses a work command whose `orderBy` is `'model'` (the last message is the
  bot's own or an AUTO MESSAGE of a mode) with the model-only text `I do not start work without an order from the
  player or the supervisor.` (returned, not said); a running job's resume and the routines' rounds are not
  affected (they come as `system` orders with their own paths).
- The supervisor's orders: a message from the watch (`quiet: true` of F9, or `by: 'supervisor'` in the queue's
  call) sets `orderBy` to `'player'` for its commands; a `!stop` or `!setMode` issued by the model while a
  supervisor's or player's command runs is refused with `That is the player's order; I do not stop it.` (returned,
  not said); the owner's own `!stop` works as today.

Tests: `xw_day_phase.test.js`, `xw_model_orders.test.js` (the fake agent: a work command after an AUTO MESSAGE is
refused with the text; after a player message it runs; `!stop` by the model during a player's command refused).
Pinned: `glue2_commands`, `xs_queue`, `sta_modes`, `stf_log_time`, `wc_watch_logic` (phaseOf labels).

### F12 The history race (E3)

Rule: `History.add` is serialised: a promise chain `this._chain = this._chain.then(() => this._add(...))` so two
adds never interleave; the summary (`summarizeMemories`) runs inside `_add` as today but no other add pushes
while it awaits; `appendFullHistory` stays. The `closedByUser` guard of the model class stays. Tests:
`xw_history_chain.test.js`: an add that triggers a summary with a delayed promise and a concurrent add: the turns
stay in order and the last turn is the user's; the summary's chunk is the first five. Pinned: `history`,
`history_storage`, `xl_closing_turn`.

## 4. Interfaces between the parts

| From | To | What |
|---|---|---|
| E1 (F6) | E2 (F2) | The place `my_bed` (source `auto`) in the PlaceStore; E2 reads it with `ctx.places?.get?.('my_bed')`; E2 keeps it out of the prompt's places line |
| E1 (F10) | E2, E3 | `applyKeepOut(movements, areas)` of `motion.js`; the mining and farming packs call it where they build movements, when E1 reports it exported |
| E2 (F9) | E3 (F8) | `handleMessage(owner, text, { quiet: true })` for the watch's commands; E3's `orderBy` reads the flag through the message's source record (E2 states the field name in its report, E3 waits for it and uses optional chaining) |
| E2 (F4) | E2 | `leaveBuilding` of `shelter.js` is E2's own |
| E3 (F5) | E1 (F10) | `mineAt` for `inCave` is read through `ctx.mines?.mineAt?.(pos)` |
| T3 | all | The scenarios check the world and the said lines; the texts are this spec's |

## 5. The budget

`!sealOpening` adds one line of docs behind `mining_pack`; `!goToCoordinates` is already a command. The limits
move by the measured growth only; E1 reports the number from `glue2_prompt_size` with every switch on.

## 6. The order

1. The lead commits the spec; E1, E2, E3 start at once on their parts; T3 writes W128 to W133 from the plan
   and this spec (they fail on 9a28d07), and the W126 A1 change.
2. Each engineer reports (what changed, exports, requests, numbers, decisions alone); the lead commits.
3. T3 runs each new scenario on the server when its part lands, then the area, mine, shelter and routine
   scenarios of 0.1.4.15 once (`survey_base`, `farm_routine`, `full_bag`, `ten_minutes`, `spawn_and_bed`,
   `route_joined`, `creeper_in_sight`); findings to DECISIONS.
4. The fix round; the handoff; round two's spec when the owner has answered.
5. The gate from a fresh clone (SPEC 0.1.4.15 section 6's set plus `creepers_below the_base_by_the_village
   routine_places mine_says_why night_orders cave_in_the_way`), the PR, the owner's word, the merge, the tag.

## 7. The scenarios (T3)

All on the base world unless said; the runner's substring rule names the entries.

| Entry | File | Checks |
|---|---|---|
| `creepers_below` | `w128_creepers_below.js` | A: three creepers summoned in a cave 12 blocks under the trading hall (the W126 base), the bot walks past the hall at the surface: no "A creeper keeps following me", the walk ends within 60 s, no flee. B: one creeper summoned 8 blocks away in sight at the bot's level: the reflex backs off (the existing texts), the bot's y never drops below its start minus 1. C: the help line at most once in 120 s over the scenario |
| `the_base_by_the_village` | `w129_base_village.js` | The W126 base and a village (three houses with beds and a lectern, a villager) 100 blocks south: `!surveyBase("east")` saves the base's finds only, the report line is in the bot's said lines word for word with the `I left out ...` sentence, `bases.json` has the house's door and a centre within 10 blocks of the house, one `home`, the village houses absent, `!forgetArea` of a survey place removes it from `places`, the owner's `wheat_farm` in `kept`; `!goToBed` by the village chooses no villager bed (`The beds nearby are the villagers'; ...` when no own bed) |
| `routine_places` | `w130_routine_places.js` | A routine "go to the chest at (x, y, z), take 4 wheat, then harvest the wheat farm and store the wheat" with a wrong second place: the plan has the `!goToCoordinates` step, the failed step is skipped with the quiet line, the round is done, `runs` is 2 after `!doRoutine`; while a watch `run` works, no round starts |
| `mine_says_why` | `w131_mine_says_why.js` | The W118 mine: a blocked way back (a wall placed by the test): the stop line names the reason and the position and the log has the `Mining stop:` line; `!mineOre("iron", 2, true)` with the mine known starts a new one at the bot; after `!forgetMine` the bot in the old tunnel: `This tunnel is a mine now` and the trip runs; a shaft over solid rock digs down (no `block the way down`); an unbreakable block (bedrock placed) gives `I could not dig the bedrock at ...` |
| `night_orders` | `w132_night_orders.js` | `!stats` at 1000, 7000, 12500, 18000, 23500 says Morning, Afternoon, Evening, Night, Dawn; the bot alone for 3 minutes with the modes on starts no work command (the log has no `used` line of a work command); a supervisor `run` of `!collectBlocks("stone", 2)` is quiet in the chat and the model's `!stop` of it is refused |
| `cave_in_the_way` | `w133_cave_in_the_way.js` | The only stone within 16 blocks lies in a cave under rock: `!collectBlocks("stone", 4)` answers `That is in a cave; I do not go there alone.` and the bot stays on the surface; stone on the surface too: the surface ones are collected; the mine of W118 with a cave one block beyond the tunnel's end: the beyond cells are patched; `!sealOpening` closes a 3 x 3 opening |
| W126 A1 | `w126_base.js` | The report line is read from the said lines (`saidLines`), the command's reply is `Done; I said it in the chat.` |

Each scenario fails on 9a28d07 for the fix it proves (the report says which check fails there).

## 8. Open for round two

The packs' spec (breeding, enchanting, the AFK creeper kill) follows the owner's answers to PLAN section 10.
The probe of the 26.1 enchantment window is E3's first task of round two, before the spec is final.
