# Handoff notes v0.1.4.10

Notes between the parts, by the engineers, accepted by the tech lead. Where they disagree with
`SPEC.md`, they win.

## From part J (the job, E1), done in round 1

### Exports

| File | Exports |
|---|---|
| `src/agent/job/job_logic.js` | `JOB_COMMANDS`, `JOB_KINDS`, `ERRAND_COMMANDS` (the list of I2), `END_COMMANDS`, `JOB_RULES`, `JOB_STATES`, `OVERRIDABLE_ACTIONS`; `jobOf(name, args, { by, text, now }?)`, `endsJob(name)`, `isErrand(name)`, `shouldResume({ job, now, lastOrderAt, actionRunning, sleeping, night, resumeSeconds, nightShelter?, underground? })`, `resumeCommand(job)`, `progress(job, gain)`, `isDone(job)`, `blockerOf(result)`, `nextIdleJob({ idleJobs, lastRun, now, minutes })`; helpers `idleCommandText`, `itemMatches`, `gainOf`, `resultOf`, `sameWork`, `readJobSettings`, `jobCommand`, `cleanCommandName`, `dropOf` |
| `src/agent/job/plan_logic.js` | `PLAN_COMMANDS`, `PLAN_COMMAND_NAMES`, `planPrompt(job, blocker, inventory, commands)`, `parsePlan(answer, commands)`, `stepDone(step, inventory, ok?)`, `checkOf`, `inventoryCounts`, `countIn` |
| `src/agent/job/job_texts.js` | the eight texts of I3, `stopText(job, text)`, `statusText(job)` |
| `src/agent/job/job_store.js` | `JOB_FILE = 'job.json'`, `JobStore(filePath, { now })` with `load()`, `set(job)`, `get()`, `clear()`; `STEP_STATES` |
| `src/agent/job/index.js` | `createJob(agent, store, options)`; re-exports `JobStore`, `JOB_FILE` |

`createJob` gives `onCommand`, `onResult`, `tick`, `onRestart`, `plan`, `status`, and also `settled()`
(waits for a running plan), `get()` and `describe()`. Every method returns `{ ok, reason, text }`
(`status` a string) and never throws.

Options of `createJob`: `executeCommand(text, opts)` and `askModel(prompt)` (both from the glue), and
optional readers `say`, `inventory`, `actionRunning`, `sleeping`, `night`, `nightShelter`, `underground`;
without them the agent is read. The job modules import only pure modules (`repeat_guard`, `ore_table`,
`night_logic`, `home_settings`, `safe_json`), nothing from mineflayer or `src/models`.

### Decisions beyond the spec, accepted

| Decision | Why |
|---|---|
| A running `!followPlayer` does not count as an action that blocks the job; `!stay`, `!goToBed` and the model's own goal do | W85 must come back during an endless follow |
| After a plan or a finished step, the next step or the job runs without the 60 s wait, unless an order came in between | every step would wait 60 s |
| A resumed `!mineOre` sets `new_mine` false | never a second mine |
| The same kind and item replaces the job without the leave text | the model resuming with the rest would say "I leave" |
| While a plan runs, a plan command chosen by the model (`!craftSupplies` ...) is an errand, not a new job | the model often works on the blocker too |
| System orders (`by: 'system'`) never start or end a job | |
| The standing list runs when no job is running, a paused job included | a paused job would block the list for ever |
| `!chopTrees(4)` checks for any log | a birch forest |
| `parsePlan` gives null for a command outside the list or more than 6 steps | |
| `blockerOf` also reads "and have N" with N too few, the reason `pickaxe`, `I need a stone pickaxe` | |
| A resumed command or a step starts the plan but `tick()` never waits for the model | |
| Extra fields of the record: `skillDone`, `fails`, `failText`, `blocker`, `chainAt` | |
| The bot waits `job_resume_seconds` after the start | |
| `idle_jobs` also accepts the short form of the plan, `"farmCycle farm"` | |

Texts beyond I3: `I stop the mining: <text>`; `Job: the farming, paused.`; `status()` is `''` without a
job; the words `the wood cutting`, `the tool making`, `the crafting`, `the collecting`, `the ore
collecting`, `the harvest`, `the planting`; plan, step and no-plan wording for other blockers (`I have no
stone pickaxe.`, `Step 1 of 3 done: 4 logs.`, `... for the food.`); `I have no supplies.` when the
missing item is unknown.

### For part G (glue, E5)

1. `agent.job = createJob(agent, new JobStore(path.join(botDir, JOB_FILE)), { settings, executeCommand:
   (text, opts) => executeCommand(agent, text, opts), askModel })`, only with `job_memory` on. `askModel`
   is the call of the chat model with the purpose `'plan'` of the cost meter.
2. In `executeCommand`, `onCommand(name, args, by, text)` before `perform`, with `by` `'player'` (or the
   name of the player), `'model'` or `'system'`. A system order has `by: 'system'` in its options; `tick`
   passes `{ by: 'system', typed: false }`.
3. After the command, `onResult(name, packResultOrText, gain)`: the pack result when there is one, else
   the text; `undefined` for a stopped command. `gain` is `{ name: after - before }` of the inventory.
   Without the gain a job with a count ends only when its skill says done.
4. `tick()` every 5 s, not awaited; it returns `busy` while one runs. When the glue skips the hooks for
   system orders, `tick` passes the result to `onResult` itself, without the gain.
5. `onRestart()` at spawn; `status()` after the where line of the knowledge block when it is not empty.

Tests: `tests/unit/gja_*.test.js`, 90.

## From part R (reflex, areas, mines, E3), done in round 1

### Exports

| Module | Exports |
|---|---|
| `src/agent/areas/keep_out_logic.js` (pure) | `KEEP_OUT_COST` (100), `KEEP_OUT_TYPES`, `AREA_FLAGS`, `LEAVE_TEXT_MS`, `isGateName(name)`, `isKeepOutArea(area)`, `insideArea(area, pos)`, `keepOutAreas(areas, botPos, dimension)`, `keptOutBy(areas, pos)`, `stepCost(block, areas)`, `stepCostOf(areas)`, `itemNameOf(entity)`, `leaveText(item, area)`, `mayLeaveText(saidAt, now)` |
| `src/agent/areas/keep_out.js` | `collectItems(bot, { areas, first, allow, log })` -> `{ ok, reason, text, picked }`, never throws |
| `src/agent/rules/rule_logic.js` | `areaFlagOf(ruleText, areaNames)` -> `{ area, flag: 'no_enter' }` or null |
| `src/agent/areas/area_store.js` | `ENTRANCE_KINDS` with `'trapdoor'`; `AREA_FLAG_NAMES`; `AreaStore.setFlag(name, flag, value)` -> a copy of the area or null; `sameBox(store, box)` -> the area or null; `sameBoxText(name)` |
| `src/agent/areas/area_scan.js` | `scanBuilding(..., { floors: true })`; the result has `floor: true/false` only with `floors` |
| `src/agent/packs/mining/mine_store.js` | `BOT_KEY_PREFIX`; `find(name, dimension)`; `remove(name, dimension)` |
| `src/agent/packs/mining/mine_player.js` | `forgetMine(ctx, name)` -> `{ ok, reason, text }`; `minesText(ctx, dimension)` -> string; both exported from the pack's `index.js` (added by the lead) |
| `src/agent/packs/mining/texts.js` | `tunnelsWords`, `mineEntryText`, `minesListText`, `forgetMineText` |

### Decisions beyond the spec, accepted

- The reflex stays out of: type `pen`, type `farm`, any area with `flags.no_enter`. A gate cell costs 100
  everywhere; on the real `Movements` a cost of 100 drops the move.
- The item walk of `item_collecting` is `collectItems` of `keep_out.js` (not `skills.pickupNearbyItems`,
  which walks to every item): digging off, the step cost, 15 s per walk, at most 16 items; the second try
  the same. The text once per item and at most once a minute, to `agent.sayText` and the behaviour log.
- The mode reads `agent.area_store`; without it (protected areas and world memory off) no area is kept
  out, gates still cost 100.
- `set()` keeps the flags of an area whose box is saved again; unknown flags are dropped on load.
- The floor scan: the box runs from the ground block to the highest ceiling plus the walls, from a cell
  within 1 block of the bot; a floor that reaches the scan limit counts as no floor; without a floor the
  old scan runs and the result has `floor: false`.
- `remove` and `find` try the name, then a level ("16", "bot:16", 16), then an ore; the old key `'16'`
  still finds `bot:16`.
- `minesText` without a store returns the no-store text.

### Migration of `mines.json`

A version 1 file is read as before and written again at load as `version: 2`: `"16"` becomes `"bot:16"`,
`"the_nether:40"` becomes `"the_nether:bot:40"`, `"mine"` stays. An empty or missing file is not written.

### For part G (glue, E5)

| Command | Call |
|---|---|
| `!forgetMine(name)` | `pack.forgetMine({ mines: store, log }, name)`, answer `.text` |
| `!mines` | `pack.minesText({ mines: store }, bot.game.dimension)` |
| `!rememberRule` | after saving: `const f = areaFlagOf(text, areaStore.list().map(a => a.name)); if (f) areaStore.setFlag(f.area, 'no_enter', true)` |
| `!rememberArea` | `scanBuilding(blockNameOf(bot), origin, { floors: settings.area_floors === true })`; then `const same = sameBox(store, { min: scan.min, max: scan.max, dimension })`; when found, answer `sameBoxText(same.name)` |

Existing tests changed: `sta_modes` (the fake of the item walk is `collectItems`), `mining_store`,
`rt_mine_store`, `rtb_store` (the keys `bot:16`, version 2). Tests: `tests/unit/gjr_*.test.js`, 43.
