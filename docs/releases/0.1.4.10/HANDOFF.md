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
