# Plan v0.1.4.10 "Goals"

Based on your play of 2026-10-01 (three sessions, Claude and Luna, an empty memory) and your words of the same day in the roadmap. You gave the go for this release before the plan; this is what it will contain, written down so that the spec and the tests have one source.

## 1. Goal

| After this release | Today |
|---|---|
| The bot keeps the job you gave it and comes back to it by itself after an errand | It idles after every "follow me" until you order the job again |
| A missing supply becomes steps of the job, not a stop | "No torches" ended the mining and 20 minutes of guided crafting followed |
| With nothing to do, the bot works a standing list you gave once | It stands still |
| The path search climbs and descends ladders smoothly, opens trapdoors, centres doors, and plans another way when stuck, for every walk | The ladder code of the packs patches it from outside; walks the search starts by itself are still the old way |
| The item reflex never lets your animals out | It opened the gate of the pen three times |
| The house and the basement are different places | One box over both floors |
| A play log is a table in one minute | An hour of reading |

## 2. Your decisions that this plan uses

| Decision | Your answer |
|---|---|
| How a job starts | An ordinary order becomes the job; "set yourself the goal" works too; you never have to say it |
| Errands | "Follow me", "come here", "check the chest", "wait", "go to bed" do not end the job |
| Coming back | After `job_resume_seconds` without an order and nothing running, default 60 |
| Ending | "Stop", "that's enough", or a new job; one line says what was left |
| Big goals | Stashed: a guide per big goal in the backlog, after this release and smelting |
| Ladders | The right climbing is the default, no switch |
| Chat model | Decided from your two routing lines, when you send them |

## 3. Content

### Package 1: The job

| # | Change |
|---|---|
| 1.1 | A job is an order with a result that code can check: mine N of an ore, farm a field, get N logs, make N of an item, collect N blocks. The bot keeps one current job with its state in `job.json` in the folder of the bot. |
| 1.2 | Errands do not end the job. When no order came for `job_resume_seconds` and nothing runs, the bot goes back to the job: `I go back to the mining, 6 of 16 iron.` Code decides; no call of the model. |
| 1.3 | A blocker becomes steps: a skill that fails for a missing supply (no torches, no pickaxe, no wood) asks the model once for the steps, each step a command with a check; the bot works the steps and returns to the job. At most 3 plans per job. |
| 1.4 | "Stop", "that's enough" and the like end the job; a new job replaces it: `I leave the mining at 6 of 16 iron.` |
| 1.5 | The job survives a restart: `I was mining iron, 6 of 16. I go on.` |
| 1.6 | A standing list `idle_jobs` in the settings, for example `["farmCycle farm", "craftSupplies torch 32"]`: with no job, the bot works the list in order, each entry at most once per `idle_jobs_minutes`. |
| 1.7 | One line of progress when a step is done, one when the job is done. Nothing in between. |

### Package 2: The path search

| # | Change |
|---|---|
| 2.1 | A closed trapdoor is a floor only over solid ground, never over a ladder or air; an openable block is passable only through it. The bot no longer stands on a closed trapdoor. |
| 2.2 | Ladders inside the search: a move of one rung down; on a ladder the bot looks at the wall and holds forward, as a player does; no steering, no planning again while it rises or slides. Every walk, by a command, a reflex, a pack or the model's code. |
| 2.3 | Every door point of a path is centred; the arrival tolerance at doors and ladders stays wide. The doorway swinging goes. |
| 2.4 | Slabs, stairs, cauldrons, composters and hoppers are no standing places in the search; a one-wide pit with a high exit costs more. |
| 2.5 | A cell where the bot got stuck gets a temporary high cost before the next plan, so the next plan takes another way. |
| 2.6 | The ladder code of the packs stays as the fallback. |

### Package 3: From your play

| # | Change |
|---|---|
| 3.1 | The item reflex never opens a gate of a pen or a farm and never enters an area of type pen. A rule you say about an area ("never enter the chicken pen") sets a flag of the area that the reflexes read. |
| 3.2 | The scan of a building stops at a floor: a house over a basement gives the area of the floor you stand on. "This is the basement" below the house gives a second area. The shelter is the floor with the bed. |
| 3.3 | A scan that gives the box of an existing area answers `That is the area "home" already.` |
| 3.4 | `!forgetMine("name")` and `!mines`. A mine named with a number no longer collides with a mine of the bot. |
| 3.5 | `!goToPlayer` and `!goToCoordinates` into a place below or above through a closed trapdoor: covered by package 2, kept here as a check. |

### Package 4: Testing and tools

| # | Change |
|---|---|
| 4.1 | `node scripts/scorecard.js <log>`: minutes, processes and why they ended, orders and orders without a result, calls and cost per model, stuck lines, doors left open, the commands chosen. One table. |
| 4.2 | `node scripts/dump_region.js`: run by you once on your machine; connects to your world as a second player, reads the blocks around home into `tests/world/owner_region.json`. The test base is built from it. |
| 4.3 | `npm run test:play`: the first ten minutes with the chat model of your profile, on your machine only, about 10 cents with Luna. The only test in which the model talks. |
| 4.4 | The journey scenarios of 0.1.4.9 plus the journeys of this release: the job comes back after an errand, the blocker becomes steps, the standing list, the pen gate, the floors. They gate the release. |

## 4. New settings

All off by default, as always.

| Setting | Off means | On means |
|---|---|---|
| `job_memory` | No job, as today | The bot keeps its job and comes back to it |
| `job_resume_seconds` | 60 | The wait before it comes back |
| `idle_jobs` | `[]` | The standing list |
| `idle_jobs_minutes` | 15 | How often an entry of the list runs |
| `area_floors` | One box per building, as today | A scan stops at a floor |

The path search changes, the pen gate, the duplicate area and the mine commands are corrections and have no switch.

## 5. Cost

| Item | Effect |
|---|---|
| Coming back to a job, the standing list | Code only. No model call. |
| A blocker | One call of the model per plan, at most 3 per job |
| Two new commands, one setting line in the prompt | About 150 characters. The prompt is at 16,883 of 17,000; I shorten descriptions again. |
| The engineers | About 13 hours of sessions, two full runs on the real server |

## 6. What this release does not contain

| Topic | Where |
|---|---|
| Guides of big goals, smelting, trading, the Nether | Backlog, in that order |
| The local embedding model, learning by watching | v0.1.4.11 |
| A newer mineflayer | When Minecraft 1.21.9 is needed |

## 7. Estimate

| Package | Size | Hours |
|---|---|---|
| 1 The job | Large | 4 |
| 2 The path search | Large | 3 |
| 3 From your play | Medium | 1.5 |
| 4 Testing and tools | Medium | 1.5 |
| Tests, journeys, two full runs, the fix round | Large | 3 |

About 13 hours with three engineers at a time. Package 2 first with package 1, package 3 and 4 beside them.

## 8. What I cannot test

- **The model planning steps.** The journeys give the steps the model would give. `npm run test:play` on your machine is the only place the model plans.
- **Your world.** Until you run the dump, the base is built from your files by hand.
