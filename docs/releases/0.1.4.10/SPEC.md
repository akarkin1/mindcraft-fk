# SPEC v0.1.4.10 "Goals"

This is the spec as the engineers get it on 2026-10-01. The plan for the owner is `PLAN.md`. The notes
between the parts are `HANDOFF.md`; where they disagree with this spec, they win. The defects that the
tests find, with the decisions, are `DECISIONS.md`.

Tech lead: Fable. Base: `origin/main` after the merge of `hotfix/follow-ladder` (the tag `v0.1.4.9`).
Branch: `hotfix/goals`. Work folder: the checkout `/home/user/mindcraft-fk`, shared. Node 22.

## 0. Rules for every engineer

The rules of `docs/releases/0.1.4.9/SPEC.md` section 0 hold word for word: never `keys.json`, never a
real model, never port 55916, no git command that writes, strict file ownership, a switch for new
behaviour and none for a correction, LF, texts word for word, `{ ok, reason, text }` and never a throw,
static imports only of names that exist, packs through `ctx`, a report as text at the end. Two more:

13. Another tester runs scenarios on the real server while you work: do not run `npm run test:world`
    unless your part says so.
14. The journey scenarios (`tests/world/w80` to `w84`, `journey.js`) are the gate: a change that makes
    one of them fail is wrong, whatever the unit tests say.

## 1. Goal and acceptance

| Goal | Measured by |
|---|---|
| The bot comes back to its job after an errand | W85 |
| A blocker becomes steps and the job goes on | W86 |
| The standing list runs when there is nothing to do | W87 |
| The path search climbs and descends a ladder by itself, opens a trapdoor, centres doors | W88 and the journeys of 0.1.4.9 without the ladder fallback |
| The item reflex never opens a pen gate | W89 |
| The house and the basement are two areas | W90 |
| Nothing regressed | the journeys W80 to W84, the long run W60, the full set |

## 2. Settings

New keys in `settings.js` and `src/mindcraft/public/settings_spec.json` (part G):

| Key | Default | Type | Meaning |
|---|---|---|---|
| `job_memory` | `false` | bool | The bot keeps its job and comes back to it |
| `job_resume_seconds` | `60` | int >= 10 | Seconds without an order, and nothing running, before it comes back |
| `idle_jobs` | `[]` | string[] | Commands the bot runs when it has no job, in order, e.g. `["!farmCycle(\"farm\")", "!craftSupplies(\"torch\", 32)"]` |
| `idle_jobs_minutes` | `15` | int >= 1 | An entry of the list runs at most once per this many minutes |
| `area_floors` | `false` | bool | A scan of a building stops at a floor |

The path search changes (part P), the pen gate (R1), the duplicate area (R3) and the mine commands
(R4) are corrections: no switch.

## 3. Parts, owners, files

| Part | Engineer | Files (owned) | Round |
|---|---|---|---|
| J The job | E1 | new `src/agent/job/*` (`job_logic.js`, `job_store.js`, `job_texts.js`, `plan_logic.js`, `index.js`); `tests/unit/gja_*.test.js` | 1 |
| P The path search | E2 | `patches/mineflayer-pathfinder+2.4.5.patch` (regenerated), new `tests/unit/gjp_*.test.js`, `src/agent/library/ladder_pass.js` and `src/agent/packs/mining/ladder.js` only for the fallback rule (P6) | 1 |
| R Reflex, areas, mines | E3 | `src/agent/modes.js` (item_collecting only), `src/agent/areas/*`, `src/agent/packs/mining/mine_store.js`, `mine_player.js`, `texts.js` (R4), `src/agent/rules/*` (R2); `tests/unit/gjr_*.test.js` | 1 |
| T Tools | E4 | new `scripts/scorecard.js`, `scripts/scorecard_logic.js`, `scripts/dump_region.js`, `scripts/dump_region_logic.js`, `tests/world/owner_region.js` (the loader), new `tests/play/*`, `package.json` (the script `test:play` only); `tests/unit/gjt_*.test.js` | 2 |
| G Glue | E5 | `src/agent/agent.js`, `src/agent/commands/*`, `src/models/prompter.js`, `profiles/defaults/_default.json`, `settings.js`, `settings_spec.json`, `tests/routing/sentences.json`, `tests/routing/commands.js`; `tests/unit/gjg_*.test.js` | 2 |
| TU Unit tests from the spec | T1 | `tests/unit/gj_*.test.js` | 2 |
| TW Journeys and scenarios | T3 | `tests/world/*` (new `w85` to `w90`, `journey.js`, `base_world.js`), `tests/e2e/*` | 3 |

## 4. Interfaces

### I1. The job record (J gives, G uses)

`bots/<name>/job.json`, written by `JobStore(filePath)` with `load()`, `set(job)`, `clear()`, `get()`:

```
{ version: 1,
  kind: 'mineOre' | 'farmCycle' | 'chopTrees' | 'getTool' | 'craftSupplies' | 'collectBlocks' | 'collectPassedOre' | 'harvest' | 'plant',
  command: '!mineOre("iron", 16)',        the order as typed or as the model gave it
  args: ["iron", 16],
  wanted: 16, got: 6,                     for jobs with a count; null without
  words: 'the mining',                    the words of the texts (I3)
  state: 'running' | 'paused' | 'done' | 'left',
  by: 'player' | 'model',
  started, updated,                       ISO times
  steps: [ { command: '!chopTrees(4)', check: { item: 'oak_log', count: 4 }, state: 'todo'|'done'|'failed' } ],
  plans: 0 }                              how many times the model planned steps for this job
```

### I2. The decisions (J gives, pure)

`src/agent/job/job_logic.js`:

```js
export const JOB_COMMANDS      // { mineOre: { words: 'the mining', count: 1 /* the index of the count argument */, item: (args) => 'raw_iron' }, farmCycle: { words: 'the farming', count: null }, ... }
export const ERRAND_COMMANDS   // ['!followPlayer', '!goToPlayer', '!goToCoordinates', '!goToRememberedPlace', '!goToShelter', '!goToBed', '!viewChest', '!chests', '!inventory', '!stats', '!stay', '!eat', '!closeDoor', '!pickUpItems', '!rememberHere', '!rememberArea', '!rememberRoute', '!rememberMine', '!rememberTunnel', '!rememberRule', '!routes', '!mines', '!cost', '!help', '!nearbyBlocks', '!craftable', '!savedPlaces', '!areas', '!rules', '!lookAtPlayer', '!useOn']
export function jobOf(commandName, args)                  // -> a job record (state running) or null when the command is no job
export function endsJob(commandName)                      // -> true for !stop and !endGoal
export function shouldResume({ job, now, lastOrderAt, actionRunning, sleeping, night, resumeSeconds })  // -> boolean
export function resumeCommand(job)                        // -> the command text with the remaining count, e.g. '!mineOre("iron", 10)'
export function progress(job, inventoryGain)              // -> the job with got updated (count jobs: got = got + gain of the item)
export function isDone(job)                               // -> wanted !== null && got >= wanted, or the skill said done
export function blockerOf(result)                         // -> { kind: 'no_torches' | 'no_pickaxe' | 'no_tool' | 'no_wood' | 'no_item', item } | null from the reason and text of a pack result
export function nextIdleJob({ idleJobs, lastRun, now, minutes })  // -> the command text to run or null
```

`src/agent/job/plan_logic.js`:

```js
export function planPrompt(job, blocker, inventory, commands)  // -> the text the model gets: the job, the blocker, what the bot carries, the commands it may use, the format
export function parsePlan(answer, commands)                    // -> [{ command, check }] or null when the answer is no plan; at most 6 steps; only commands of the list; a check per step from the command (craftSupplies torch 16 -> { item: 'torch', count: 16 })
export function stepDone(step, inventory)                      // -> boolean
```

### I3. The texts (J gives)

`src/agent/job/job_texts.js`:

- `I go back to the mining, 6 of 16 iron.` (`resumeText(job)`; without a count: `I go back to the farming.`)
- `I leave the mining at 6 of 16 iron.` (`leaveText(job)`; without a count: `I leave the farming.`)
- `I was mining iron, 6 of 16. I go on.` (`restartText(job)`; the verbs: mining, farming, cutting wood, making tools, making <item>, collecting <block>, harvesting, planting)
- `The mining is done: 16 iron.` (`doneText(job)`; without a count: `The farming is done.`)
- `I have no torches. I get wood, planks, sticks and torches, then I go on.` (`planText(blocker, steps)`: the steps as the items of their checks)
- `Step 2 of 4 done: 16 sticks.` (`stepText(i, n, step)`)
- `I could not plan the steps for the torches. Tell me what to do.` (`noPlanText(blocker)`)
- `I have no job.` (`noJobText()`)

### I4. The job on the agent (G gives, J uses)

`agent.job` is `createJob(agent, store, { settings, now })` of `src/agent/job/index.js`, made at the start with
`job_memory`, else `null`. Its methods, all never throwing:

```js
onCommand(name, args, by, text)      // before a command runs: a job command starts or replaces the job (leaveText when one ran); !stop ends it (leaveText); an errand changes nothing
onResult(name, result, inventoryGainOf)  // after a command ran: progress, done (doneText), a blocker (I2 blockerOf) -> planning
tick()                               // every 5 s from the agent: shouldResume -> runs resumeCommand through agent.executeCommand as a system order (not through the model); the idle list the same
onRestart()                          // at spawn: a running job -> restartText and the job stays running
plan(blocker)                        // asks the model once with planPrompt (purpose 'plan' of the cost meter), parsePlan, sets the steps, says planText
status()                             // -> the line for the knowledge block: `Job: the mining, 6 of 16 iron, step 2 of 4.`
```

The model is called only in `plan`. A step is run like a resumed job: the command through
`agent.executeCommand` as a system order; its result goes to `onResult`, which marks the step done
(`stepDone`) or failed (then the next plan, at most 3 per job, else `noPlanText` and the job pauses).

### I5. The path search (P gives, everybody uses)

`patches/mineflayer-pathfinder+2.4.5.patch` grows. Nothing else changes its interface. The behaviour:

- P1 trapdoors: in `lib/movements.js` a closed trapdoor is `physical` only when the block under it is
  solid; over a ladder, a vine or air it is not a floor. `safeOrBreak` returns a passable cost for an
  openable block only when the move goes through it (from one side to the other), never for standing on it.
- P2 ladders: `getMoveDown` adds a move to `y - 1` with cost 1 when the block below the feet is a ladder
  or a vine (also when `maxDropDown` would allow a drop). In `lib/index.js`, while the bot's feet cell is
  a ladder or a vine and the next point is above or below: look at the wall of the ladder (the opposite
  of its `facing`), hold `forward` for up and release it for down (sneak off), never `jump`, and skip the
  "stuck" re-plan while the height changes by 0.05 or more per tick.
- P3 doors: the re-centring of a path point at a door runs for every point, not only the first; the
  arrival tolerance is 0.35 at a door, a gate, a trapdoor or a ladder cell and 0.175 elsewhere.
- P4 no-stand blocks: `getBlock` marks slabs (bottom half), stairs, cauldrons, composters, hoppers, and
  every block of `isNoStandBlock` of `src/agent/packs/home/stand_logic.js` (copy the list into the
  patch; the patch cannot import) as `physical: false, safe: false` for standing; a one-wide pit whose
  exit needs a jump of 2 gets `+ 50` cost on the move into it.
- P5 stuck: `index.js` keeps the last stuck position; on `resetPath('stuck')` the cells within 1 block of
  it get a cost of 100 for the next 30 s (`movements.exclusionAreasStep`), so the next plan avoids them.
- P6 the fallback: `ladderStepTowards` of `src/agent/library/ladder_pass.js` and `climbUp` of the mining
  pack run only when the path search ended with the bot still 2 or more blocks above or below the
  target; the step before the path search goes away. Their tests change accordingly.

Unit tests of P: `tests/unit/gjp_pathfinder.test.js` loads the patched library against a fake world
(the `Movements` of the library take a bot with `blockAt` and a registry: the mining fake bot of the
tests gives both; see `tests/unit/mining_fake_bot.test.js`) and asserts the moves: a closed trapdoor
over a ladder is no floor, a move down a rung exists, no stand on a bottom slab, the stuck cost.

### I6. The reflex and the areas (R gives, G uses)

- R1 `item_collecting` in `modes.js`: the walk to an item uses `Movements` with
  `exclusionAreasStep` that returns 100 for every cell of a gate (`_fence_gate`) and every cell inside
  an area of type `pen` or `farm` when the bot is outside it, and the mode never picks an item that
  lies inside such an area while the bot is outside. Text once per minute when it leaves an item:
  `I leave the oak_fence in the pen "pen". I do not open its gate.`
- R2 a rule about an area: `src/agent/rules/rule_logic.js` gets `areaFlagOf(ruleText, areaNames)` ->
  `{ area, flag: 'no_enter' } | null` for a rule that names an area (any of its words, case free) and
  contains `never enter`, `don't enter`, `do not enter`, `stay out` or `keep out`. `!rememberRule` (G)
  sets `area.flags.no_enter = true` through `area_store.setFlag(name, 'no_enter', true)` (R gives). The
  reflexes read `no_enter` like a pen.
- R3 `area_scan.js`: `scanBuilding` with `floors: true` (behind `area_floors`) does not pass a trapdoor
  cell nor a ladder cell vertically: the flood fill of the air never moves up or down by more than 1
  block from the floor level of the origin; a hole of 1 block (a trapdoor cell) is a wall of the floor.
  The entrances include the trapdoor as kind `trapdoor`. `!rememberArea` (G) with a box equal to an
  existing area's box answers `That is the area "home" already.` (R gives `sameBox(store, box)`).
- R4 mines: `MineStore` keys a mine of the bot as `bot:<level>` and a mine of the player by its name;
  the file migrates on load (`version` 2, the old keys kept as `bot:<key>`). New: `remove(name)` by name,
  `list()` unchanged. `mine_player.js`: `forgetMine(ctx, name)` -> `{ ok, reason, text }`:
  `Forgot the mine "mine".` or `I know no mine "mine".`; `minesText(ctx, dimension)` -> a string:
  `I know 2 mines: "mine", entrance (9, 67, 52), 2 tunnels at levels 30 and 25; the mine at (9, 67, 58) that I dug, level 16.`
  or `I know no mines.`

### I7. The tools (T gives)

- T1 `scripts/scorecard.js <log> [<log>...]`: one table per log and a total:

```
| Log | Minutes | Processes | Ends | Orders | Without result | Calls | Cost | Stuck | Doors open |
```

  `Ends` lists the reasons (`stuck 2, socket 1`); `Orders` counts the messages of players; `Without
  result` the orders after which no `Agent executed` or chat answer came within 60 s; `Calls` and
  `Cost` from the `Cost:` lines and the `Awaiting ... response` lines per model; `Stuck` the `I'm stuck!`
  lines; `Doors open` the openables the door service closed minus the ones it opened (approximate: the
  `Door service: closed` lines). Then the commands chosen, most first. Pure logic in
  `scorecard_logic.js`: `parseLog(text) -> { lines, events }`, `scorecard(events) -> rows`,
  `formatTable(rows)`. Unit tests with the owner's logs of 2026-10-01 cut to 200 lines as fixtures
  (the chat of the owner is not committed: anonymise the player name to `player`).
- T2 `scripts/dump_region.js --host <h> --port <p> --name <bot name> --center <x> <y> <z> --radius <r> --out tests/world/owner_region.json`:
  connects with mineflayer as a second player (offline mode; the owner runs it against his own world,
  never this session), waits for the chunks, reads every block in the box (`bot.blockAt`, name and the
  properties `facing`, `half`, `open`), writes `{ version: 1, center, radius, blocks: [[x, y, z, name, props]] }`
  without air, and disconnects. Pure: `dump_region_logic.js` with `parseArgs`, `boxOf(center, radius)`,
  `compact(blocks)`. The README of the tests says how to run it on the owner's machine.
- T3 `tests/world/owner_region.js`: `buildFromDump(dump, origin)` places the blocks of a dump at an
  origin with `/setblock` through the control, and `spotsFromDump(dump)` finds the bed, the chests,
  the trapdoors and the ladders. `basePlan(r, { dump })` of `base_world.js` (T3 owns it in round 3) uses
  it when `tests/world/owner_region.json` exists; else the hand-built owner variant.
- T4 `npm run test:play`: `tests/play/run.js` starts the test server like the world runner, builds the
  owner variant, starts the bot with the chat model of `profiles/claude.json` (or `--profile`), a second
  bot as the player with the sentences of W80 and W84 in plain words ("follow me", "this is home",
  "remember the path here", "go to the basement", "find some iron"), waits for the world facts of the
  journeys, and prints a table: the sentence, the command the model chose, the fact, pass or fail, and
  the cost. It refuses to run without the key of the model in the environment and never runs in
  `npm test`. The cost meter's line at the end.

## 5. Part J: the job (E1)

I1 to I4. Decisions:

- A job command typed by the player or chosen by the model starts the job. A job started by the model
  while the player's last message was an order of another kind is still a job (the model acts for the
  player).
- `shouldResume` is true when: a job is running, `now - lastOrderAt >= resumeSeconds * 1000`, no action
  runs, the bot does not sleep, and it is not night with `night_shelter` on (the shelter reflex wins).
  The mining job also waits while `whereAmI().underground` is false and the time is night.
- The resumed command gets the remaining count; a job without a count runs its command again. A resumed
  command that fails with the same text 3 times in a row pauses the job: `I stop the mining: <text>`
  (the repeat guard's rule).
- Blockers (`blockerOf`): the reasons `no_pickaxe`, `no_tool`, `no_item`, `no_supplies` and the texts
  `I have no torches`, `I need N <item> ... and have none`, `I carry no food`. The plan prompt lists
  the commands of the wood, storage and crafting kind only (`!chopTrees`, `!craftSupplies`,
  `!craftRecipe`, `!getTool`, `!fetchItem`, `!collectBlocks`, `!smeltItem`); `parsePlan` refuses any
  other. A step's check is the item and count the command names; a step without a count is done when
  its command returns `ok`.
- `idle_jobs`: an entry is a command text; it runs through `executeCommand` as a system order when
  `shouldResume` would be true for a job and no job exists; `lastRun` per entry; the list is never
  planned by the model.
- The knowledge block gets the line of `status()` after the where line (G).

## 6. Part P: the path search (E2)

I5. Work on `node_modules/mineflayer-pathfinder` and regenerate the patch with
`npx patch-package mineflayer-pathfinder`; read the current patch first (lava, door centring, the trapdoor
rule, climbing). Keep every hunk of today that P1 to P5 do not replace. The unit tests of I5. Then run,
and only you in round 1 may: `node tests/world/run.js route_to_bed route_reverse mine_known follow_ladder
first_minutes come_here_floors` with the environment of the README and report the table; the journeys
must pass with the fallback of P6 never used (grep the log for `I go down the ladder` lines: none for
the follow and the walks; the route replay keeps its own ladder legs).

## 7. Part R: reflex, areas, mines (E3)

I6. Decisions: R1 holds for every walk of the mode, also the second try; a pen area is the type `pen`
or an area with `flags.no_enter`; R3 changes `scanBuilding` only with `floors: true`, the old scan stays
the default; R4's migration writes `version: 2` and keeps every mine.

## 8. Part T: tools (E4)

I7. The scorecard is proven on the three logs of the owner (the lead gives them anonymised as fixtures
under `tests/fixtures/logs/`). The dump script is proven against the test server of this container only
(start it with `tests/world/mc_server.js` the way the runner does, on 127.0.0.1:25599) and never against
55916. `test:play` is proven here with the fake model only (`--fake`), and once by the owner.

## 9. Part G: glue (E5)

1. Settings (section 2).
2. `agent.job` (I4): `createJob` at the start with `job_memory`; `onCommand` in `executeCommand` before
   a command runs (name, args, by, the text), `onResult` after; `tick()` from the agent's own 5 s timer;
   `onRestart` at spawn after the restart note; the knowledge line.
3. `!forgetMine(name)`, `!mines` (R4) with `mining_pack`; `!rememberRule` sets the area flag (R2);
   `!rememberArea` with `area_floors` passes `floors: true` and answers `sameBox` (R3).
4. Prompt: no new examples for the job (it needs none); the descriptions of `!mines` and `!forgetMine`;
   the size at 17,000 or less with every switch on, the sizes reported.
5. Routing list: 6 sentences for `!mines` and `!forgetMine`.

## 10. Tests

### TU (T1): from the spec, `tests/unit/gj_*.test.js`
Every text of I3 word for word; every row of the settings; `jobOf` for every command of `JOB_COMMANDS`
and null for every errand; `shouldResume` with the clock; `resumeCommand` with the remaining count;
`blockerOf` for the texts named; `parsePlan` refusing a command outside the list and more than 6 steps;
`nextIdleJob`; the moves of P1 to P5 on the fake world; R1 to R4; the scorecard on the fixtures; the
dump logic; the switch off for every switch.

### TW (T3): journeys and scenarios, black box
T3 gets `PLAN.md`, `CHANGELOG.md`, the README of the tests and the owner's logs, never this spec. The
scenarios, in the owner variant of the base with `MODES_PROFILE`, the owner's switches and
`job_memory` on:

| Id | Name | Passes when |
|---|---|---|
| W85 | job_comes_back | typed `!mineOre("iron", 8)` with 4 ore reachable, then after 20 s typed `!followPlayer`, the player walks 20 blocks and stops; the player says nothing for 90 s: the bot says `I go back to the mining, N of 8 iron.` and ends with 8 raw_iron and on the surface |
| W86 | blocker_steps | `!mineOre("iron", 4)` with no torches and no pickaxe in the inventory, logs and coal in the house chest: the bot says the plan text, makes the torches and the pickaxe (world facts: the inventory), and mines the iron; the fake model answers the plan prompt with the steps the owner's model would (the scenario gives them) |
| W87 | idle_list | `idle_jobs` with `!farmCycle("farm")` and `!craftSupplies("torch", 8)`, unripe wheat and leaf litter: after 60 s without an order the farm cycle runs and then the torches are made; no order was given |
| W88 | ladders_native | the journeys W80, W82 and the scenario W75 with the fallback counted: no `I go down the ladder` and no `I climb up the ladder` line in the whole run; the smoothness numbers of W80 hold |
| W89 | pen_gate_safe | 8 fences dropped inside the pen, the bot outside: within 60 s the gate is still closed, the animals inside, the text `I leave the oak_fence in the pen "pen". I do not open its gate.`; with a rule `never enter the chicken pen` on an area named `chicken pen` the same |
| W90 | two_floors | `area_floors` on: "this is home" upstairs gives an area of the house floor only (y 60 to 65 in the base); "this is the basement" below gives a second area; `!goToBed` at night sleeps in the basement bed through the route; the shelter is the floor with the bed |
| W60 | long_run | with `job_memory` and the standing list on: the process never ends |

The journeys W80 to W84 pass unchanged. The full set once in the fresh checkout.

## 11. Order of work

| Round | Parallel | Then |
|---|---|---|
| 1 | J (E1), P (E2), R (E3) | reports, `npm test`, the handoff |
| 2 | T (E4), G (E5), TU (T1) | `npm test`, `npm run test:e2e`, the journeys |
| 3 | TW (T3), a fix engineer | the full run, DECISIONS, the fresh checkout, PR, merge, tag, PLAYTEST |
