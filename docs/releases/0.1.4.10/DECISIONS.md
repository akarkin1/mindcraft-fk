# Decisions v0.1.4.10

The defects the tests found, with the decisions. The journeys (black box, the owner's switches, `job_memory`
on) are the gate: W85 to W90 plus W80 to W84 of v0.1.4.9.

## Found by the unit tests of T1

| Id | Defect | Decision | Owner |
|---|---|---|---|
| T1-1 | A bot that hangs still on a ladder was never declared stuck by the path search: the ladder branch returned before the futility check. | The stuck check runs in the ladder branch too; the timer is reset while the height changes by 0.05 or more per tick. Done. | P |

## Found by the journeys of T3 on the real server, 2026-10-01

The branch of this release was taken from the fix branch of v0.1.4.9 before its fixes F33 to F39 (the ladder
step mid-walk, the click on the trapdoor, the hold on the ladder, the trapdoor closed by the pass, the
crafting grid, one craft per call). The findings that those fixes cover are marked so; the branch takes them
when `main` is merged after the fix release.

| Id | Defect | Evidence | Decision | Owner |
|---|---|---|---|---|
| T3-1 | **A blocker does not become steps.** `!mineOre("iron", 4)` without a pickaxe failed at once (`I need a stone pickaxe and have no pickaxe`); the plan prompt listed only what the bot carries, not the known chest with 20 logs and 9 coal, nor the missing torches; the steps failed (`!getTool` found no tree, `!fetchItem` could not get out of the tunnel to the chest); the 3 plans were used within 17 s. | W86, 3 of 3 | The plan prompt names the known chests and what they hold (the chest index of the storage pack), every missing supply of the blocker, and where the bot is. A step that needs the surface runs after the way out of the mine (the glue runs `!leaveMine` or the way-out of the mining pack first when the bot is underground and the step is a wood, chest or crafting command). A failed step is tried once more before the next plan; the plans count per job stays 3. | J, G: done (commit a333c6c) |
| T3-2 | **Follows and walks still use the ladder fallback** (`I go down the ladder ...` lines); climbs up have 2 or 3 steps back of 0.3 blocks, one climb down took 25.9 s with 4 stalls. | W88, every run | The steps back and stalls: covered by F34, F36, F37 and F39 of the fix release (merge `main`). The fallback lines: the path search of part P must take the column and the trapdoor by itself on the real server; the engineer of P runs `follow_ladder first_minutes come_here_floors` on the server after the merge and makes the native moves win (the follow's step after 3 s still must not come first). | P, done (commit c343e69): four rounds on the server, see the handoff |
| T3-3 | **"Come here" across floors**: from the house to the mine room the bot ended under the closed trapdoor with `You have reached`; from the room up `I could not climb up the ladder at (603, 52, -2)`; once `Timeout: Took to long to decide path to goal!`. | W88, W82, W80 | Covered by F33, F35, F39 (merge `main`) and by the native moves of P. The timeout of the path search: the engineer of P checks the cost of the ladder moves (a plan that takes more than a second over 10 blocks is wrong). | P, done: the timeout came from stuck marks left by the hover under the trapdoor |
| T3-4 | **"Let's sleep" cannot get through the trapdoor**: `I cannot get into the shelter "basement". I cannot walk through the trapdoor at (598, 60, -3).` with `area_floors` on and the bed in the basement. | W90, 2 of 2 | The walk into the shelter takes a ladder column through a trapdoor like every other walk (the ladder step of `library/ladder_pass.js`, or the route when one leads there), instead of refusing the trapdoor. | home (E3), done |
| T3-5 | **The gate of the pen stays open** after the bot leaves the pen on "come here" and stops 1 block past it; the animals walk out. | W89, 3 of 3 | A gate the bot passed is closed as soon as the bot is through it, not 2 blocks past; an entity within 1 block holds it only when it is not the bot. | home (E3), done |
| T3-6 | `!rememberArea("chicken pen")` typed inside the pen without a type saved the house (11 x 15 x 13) and the rule marked the house keep out. | W89, run 1 | A scan without a type that starts inside a fenced enclosure (`scanPen` finds one around the bot) saves the pen, not a building beyond the fence. | areas (E3), done |
| T3-7 | Torch crafting fails and coal is lost (`missing stick, 1 of 2`, `I made 0 torches of 8`). | W87 (group), W83 | Covered by F32b and F32c (merge `main`). | - |
| T3-8 | The job comes back while `!followPlayer` runs (the plan says "nothing running"); the standing list says nothing when an entry starts. | W85, W87 | Accepted: a follow does not block the job; the owner stops following by coming back to the job after a minute of silence, which is what he asked for. The standing list says one line when an entry starts: `I take the next of my list: !farmCycle("farm").` | J, done |
| T3-9 | In the fresh clone W89 failed twice (once in the full set, once alone, steps 1 and 2 of the same scenario): after "come here" the bot stood 1.4 blocks past the open gate and nothing closed it within 10 s; the gate was closed by the scenario itself afterwards. The log: the door service's own click succeeded while the bot headed for the gate, which drops the note and the side tracking; the path search opened the gate again and the bot walked through while the service was busy, so no pass was seen; a gate the bot only came near is closed 2 blocks past it (F21), and the bot stops at 1.4. | W89, fresh clone | A noted gate the bot has stopped beside, its feet out of the gate cell, is closed too (`moving` false, about 1.5 s after the stop); while the bot walks, the pass or the 2 blocks decide as before. Doors and trapdoors unchanged. Proven: W89 three times in a row with the fix. | lead, done |

The journeys W80 to W84 pass on the fix branch of v0.1.4.9 (run 15 and 16 of the lead); on this branch they
pass after the merge of `main`.

## The gate, 2026-10-02

After the merge of `main` and the fix round (T3-1 to T3-8, the rounds of part P on the server): the twelve
journeys (W59, W80 to W84, W85 to W90) pass, 12 of 12 in 1339 s, every climb smooth and no fallback ladder line
in a follow or a walk except the owner's second shaft (its lowest ladder is out of jump reach; the fallback
places the ladders). `npm test`: 6665 tests, 6664 pass, 0 failures, 1 skipped (Windows only).

## Verification in a fresh clone, 2026-10-02

Clone of `hotfix/goals` at 0b68189 into a new folder, `npm install` (547 packages, the patch of
`mineflayer-pathfinder` applied), Node 22, the server 1.21.8 of the cloud:

| Step | Result |
|---|---|
| `npm test` | 6665 tests, 6664 pass, 0 failures, 1 skipped (Windows only) |
| `npm run test:e2e` | 17 of 17 in 138 s |
| `npm run test:world`, the full set | 84 of 85 in 6559 s; `pen_gate_safe` failed, and failed again alone: finding T3-9 |

After the fix of T3-9 (d74e99f), the same clone pulled to that head:

| Step | Result |
|---|---|
| `npm test` | 6671 tests, 6670 pass, 0 failures, 1 skipped |
| `npm run test:e2e` | 17 of 17 in 143 s |
| `node tests/world/run.js journeys` | 12 of 12 in 1340 s (owner_base, first_minutes, first_mine, come_here_floors, chest_and_torches, ten_minutes, job_comes_back, blocker_steps, idle_list, ladders_native, pen_gate_safe, two_floors) |
| `pen_gate_safe` in the work folder with the fix | 3 of 3 |

The 84 scenarios of the full set that passed at 0b68189 do not touch the changed rule (the door service closes
a gate the bot stands beside); the journey group, which holds every scenario with a pen gate, is the gate of the
release and passed at d74e99f.

## The chat model, from the routing check of the owner (2026-10-01)

The same 154 sentences, `profiles/claude.json`, every part on, on the owner's machine:

| Model | Right | Median time | Cost of the run | Per hour at that rate |
|---|---|---|---|---|
| GPT-6 Luna | 146 of 154 (95%) | 1.9 s | $0.05 | $0.21 |
| Claude Haiku 4.5 | 145 of 154 (94%) | 0.8 s | $0.78 | $3.12 |

Both answer "mine 5 gold" and "give me all the wheat you've got" in words without a command. Luna also
answers "store the wheat" and "we need coal for torches" in words and sends "go farm" to a remembered place;
Haiku takes "make 10 ladders" and "craft a chest" for `!craftable` and "get 16 birch logs" for
`!searchForBlock`, and answers "kill that zombie", "get a stone pickaxe" and "come up from the mine" in
words. Three expectations of the list were stale and are widened (`!rememberMine` for "remember this spot
as the mine", `!givePlayer` for "fetch me some bread from the chest", `!rememberRule` for the chicken coop).

Decision: Luna for play (the same accuracy at a fifteenth of the cost, with the "command alone" rule of its
profile), Haiku when speed matters. For this release: the description of `!craftable` reads too much like
crafting (G), and an example of a short order answered with a command alone is worth its characters when the
prompt has room.

## The house rule, from the two play sessions of 2026-10-02

The owner played v0.1.4.9 with Luna (47 minutes, $0.11) and with Haiku (23 minutes, $0.57). The same
things went wrong with both: the tunnel the owner stood in was not recognised (`I stand in no tunnel`), a new
mine was refused underground (`I start a new mine only from the surface`) and the model went up, `!goToSurface`
aimed at the roof of the house, the route replay failed on a ladder leg and at doors, the house box held the
basement. The profile's own prompt has one rule, "Never dig straight down."; the texts the models reasoned
from are the command descriptions and the result texts of the skills.

Decision of the owner: there is no such rule, digging down is conditional (a shaft with ladders is fine).
The HOUSE RULES block is removed from both profiles in this release. The texts and the three code rules
(surface only, the strict tunnel, the roof) are the subject of the next release, with the route as waypoints
walked by the path search.
