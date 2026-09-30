# Defects of v0.1.4.9 found by the tests

Found by the tester T1 (unit tests from the spec, 377 tests) and the tester T2 (scenarios on the real
server), 2026-09-30. The decisions of the tech lead and the owner of each correction.

## Found by the unit tests of T1

| Id | Defect | Evidence | Decision | Owner |
|---|---|---|---|---|
| T1-5 | **A way recorded going down through a trapdoor gets its legs in the wrong order**: `[walk, ladder, door, walk]`. `walkRoute` slides down the ladder and then tries to go back up to the trapdoor; the way into a mine (B2) is always recorded going down, so `!mineOre` in the mine of the owner would fail. | `rt_route_logic` 89, `rt_routes_pack` 448, `rt_mine_player` 441 | The legs follow the order of the trail: going down `[walk, door (trapdoor, from above to the top of the column), ladder, walk]`, going up the mirror. | A |
| T1-4 | A route that starts in the column above a ladder gets a ladder entry of `(x, top+1, wall side)`, inside the ground. The trip fails at that step. | `rt_route_logic` 106, `rt_mine_player` 455 | The entry is a cell where the bot can stand at the top: the last step beside the column before the ladder run, else top+2 on the open side, as the legs of the mining pack. | A |
| T1-3 | In a ladder shaft open to the sky the sky light is 15 down to the foot of the ladder, so the way in starts at the foot and has no ladder. The shaft of the test base and of the owner is under the house roof, so neither is hit; other mines are. | `rt_mine_player` 544 | A step is under open sky only when the sky light or the column says so, the step is not on a ladder, and at least 2 of the 4 horizontal neighbours at head height are open. | A |
| T1-1 | Going up with a step in the cell of the trapdoor, the trapdoor leg ends in the cell of the trapdoor, not past it. | `rt_route_logic` 63 | The `to` of a door leg is the first cell past the openable in the direction walked. | A |
| T1-2 | A trail of one step at a known place answers `no_start` instead of `too_short`. | `rt_routes_pack` 161 | Fewer than 2 steps since the last known thing: `too_short`. `no_start` only when no known thing is in the trail at all. | A |

## Found by the scenarios of T2

Pending: the world tests are running.

## Decided from the reports of the engineers, without a test

| Id | Defect | Decision | Owner |
|---|---|---|---|
| R1 | The remember, list and forget commands of routes and mines ran as actions and stopped a running `!followPlayer`. | They are plain commands; only `!collectPassedOre` is an action. Done. | G |
| R2 | `!rememberMine` on an empty trail said `in my last 0 steps`. | `I have no trail yet. Walk with me from the entrance of the mine and tell me again.` Done. | lead |
| R3 | `action_manager.js` used a global `assert` that only the sandbox lockdown supplies; a resume action threw without the lockdown. | `import assert from 'node:assert'`. Done. | lead |
| R4 | An ore name alone made "craft an iron pickaxe" a digging request. | An ore counts only followed by `ore`, or within 3 words after find, get, collect and the like. Done. | C |
| R5 | The real routing run with the owner's profile chose the examples by word overlap while play uses embeddings, because only one key was loaded. | `test-routing.ps1` loads the other key too when its secret exists. Done. | D |

## Not corrected in this release

- A mine named with a number (`"16"`) collides with the key of a mine of the bot at that level.
- `ore_sense_range` accepts 1 and 2 as well as 0 and 3.
- The gpt bot does not start without `ANTHROPIC_API_KEY`, because the prompter makes the code model at
  the start. `start-gpt.ps1` loads both keys.
