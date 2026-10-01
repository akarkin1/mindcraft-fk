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
| T3-1 | **A blocker does not become steps.** `!mineOre("iron", 4)` without a pickaxe failed at once (`I need a stone pickaxe and have no pickaxe`); the plan prompt listed only what the bot carries, not the known chest with 20 logs and 9 coal, nor the missing torches; the steps failed (`!getTool` found no tree, `!fetchItem` could not get out of the tunnel to the chest); the 3 plans were used within 17 s. | W86, 3 of 3 | The plan prompt names the known chests and what they hold (the chest index of the storage pack), every missing supply of the blocker, and where the bot is. A step that needs the surface runs after the way out of the mine (the glue runs `!leaveMine` or the way-out of the mining pack first when the bot is underground and the step is a wood, chest or crafting command). A failed step is tried once more before the next plan; the plans count per job stays 3. | J, G |
| T3-2 | **Follows and walks still use the ladder fallback** (`I go down the ladder ...` lines); climbs up have 2 or 3 steps back of 0.3 blocks, one climb down took 25.9 s with 4 stalls. | W88, every run | The steps back and stalls: covered by F34, F36, F37 and F39 of the fix release (merge `main`). The fallback lines: the path search of part P must take the column and the trapdoor by itself on the real server; the engineer of P runs `follow_ladder first_minutes come_here_floors` on the server after the merge and makes the native moves win (the follow's step after 3 s still must not come first). | P |
| T3-3 | **"Come here" across floors**: from the house to the mine room the bot ended under the closed trapdoor with `You have reached`; from the room up `I could not climb up the ladder at (603, 52, -2)`; once `Timeout: Took to long to decide path to goal!`. | W88, W82, W80 | Covered by F33, F35, F39 (merge `main`) and by the native moves of P. The timeout of the path search: the engineer of P checks the cost of the ladder moves (a plan that takes more than a second over 10 blocks is wrong). | P |
| T3-4 | **"Let's sleep" cannot get through the trapdoor**: `I cannot get into the shelter "basement". I cannot walk through the trapdoor at (598, 60, -3).` with `area_floors` on and the bed in the basement. | W90, 2 of 2 | The walk into the shelter takes a ladder column through a trapdoor like every other walk (the ladder step of `library/ladder_pass.js`, or the route when one leads there), instead of refusing the trapdoor. | home (E3), done |
| T3-5 | **The gate of the pen stays open** after the bot leaves the pen on "come here" and stops 1 block past it; the animals walk out. | W89, 3 of 3 | A gate the bot passed is closed as soon as the bot is through it, not 2 blocks past; an entity within 1 block holds it only when it is not the bot. | home (E3), done |
| T3-6 | `!rememberArea("chicken pen")` typed inside the pen without a type saved the house (11 x 15 x 13) and the rule marked the house keep out. | W89, run 1 | A scan without a type that starts inside a fenced enclosure (`scanPen` finds one around the bot) saves the pen, not a building beyond the fence. | areas (E3), done |
| T3-7 | Torch crafting fails and coal is lost (`missing stick, 1 of 2`, `I made 0 torches of 8`). | W87 (group), W83 | Covered by F32b and F32c (merge `main`). | - |
| T3-8 | The job comes back while `!followPlayer` runs (the plan says "nothing running"); the standing list says nothing when an entry starts. | W85, W87 | Accepted: a follow does not block the job; the owner stops following by coming back to the job after a minute of silence, which is what he asked for. The standing list says one line when an entry starts: `I take the next of my list: !farmCycle("farm").` | J |

The journeys W80 to W84 pass on the fix branch of v0.1.4.9 (run 15 and 16 of the lead); on this branch they
pass after the merge of `main`.
