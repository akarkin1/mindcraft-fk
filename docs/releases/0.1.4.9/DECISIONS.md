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
| T1-2 | A trail of one step at a known place answers `no_start` instead of `too_short`. | `rt_routes_pack` 161 | Fewer than 2 steps since the last known thing: `too_short`; a trail that never left the thing the bot stands at: `too_short`; a walk in from somewhere unknown: `no_start`. | A |

All five are corrected: unit tests 6046, 0 failures. The tester's line `rt_mine_player` 565 expected
`sky === true` on a ladder step; it now expects `false`, by T1-3.

## Found by the scenarios of T2 on the real server

First full run: 64 of 72 scenarios pass, 5865 s. Failing: W62, W63, W64, W66, W67, W70, W74 and w21 (a
flake). The test base (`tests/world/base_world.js`) now has a furnace in the room of the mine.

| Id | Defect | Evidence | Decision | Owner |
|---|---|---|---|---|
| F1 | **The bot cannot climb out of the shaft through the open trapdoor.** After every trip in the mine of the player it stays in the room at y 41: `I could not follow the route "mine" at step 5 of 6, at (1203, 41, -2).` In W62 it opened the trapdoor, sat in its cell at y 60 for 17 s and slid back down. Cause: `prismarine-physics` 1.10.0 knows that an open trapdoor above a ladder is climbable only for Minecraft 1.9 to 1.20 (`lib/features.json`, `climbableTrapdoor`), and its set of trapdoors ends at mangrove. For 1.21.8 the bot's physics does not climb the trapdoor cell. | W67, W62; the same text in W68, W69, W73 | A patch `patches/prismarine-physics+1.10.0.patch`: the feature also for 1.21, and the bamboo, cherry and copper trapdoors in the set. In `climbUp` a second way out when the physics still does not climb: from the top ladder, jump and walk towards the open side for 1 s, up to 3 times. W67 checks that the bot is on the surface at the end. | A, with `ladder.js` and `patches/` |
| F2 | **`!goToRememberedPlace` never reaches the learned route.** The path search stands on the closed trapdoor until `unstuck` stops the command after 20 s: `Command !goToRememberedPlace was stopped by the reflex unstuck.` The route walk would only start after the path search returns. Called alone, the route works both ways and the I3 text is exact. | W63, W64, W60 order 35 | With `routes_pack` and a route for the place (`routeFor`), the route is walked first, then the path search for the rest; without a route as before. The command pauses `unstuck` like a pack command. | G |
| F3 | **The walk to the foot of a ladder fails**: a path-search goal on the foot of the ladder makes the patched path search enter the column and climb, and the bot hangs at y 43 to 44. | the route "bed" alone from the room; `!goToBed` | A ladder leg gets `foot`, the cell beside the column at the bottom (the last trail step beside it), as it has `entry` at the top. Walk legs end at `foot` or `entry`, never inside a column; `climbUp` steps into the column from `foot` and sets no goal in a column. | A |
| F4 | **`!collectBlocks` refuses an ore in the tunnel wall at the height of the feet** with the mining pack on: `I am underground. I start a new mine only from the surface.` The check of v0.1.4.7 in `actions.js` uses `bot.canSeeBlock` from the eyes; the block above the ore blocks the ray, the order goes to `!mineOre`, which refuses underground. | W70, W74 part D | `collectWork` uses the sight rule of C1 (`oreInSight` with `ore_sense_range`) instead of `bot.canSeeBlock`. Underground it never goes to `!mineOre`; the text of the library is the answer. | G |
| F5 | **The sky light of the bot is stale**: 15 inside the house and at the roof block when the house crosses a chunk border; `!rememberMine` then puts the entrance inside the house next to the trapdoor, without the door leg. | W61 in the regions at x 400, 800, 1200; W65 exposed | The trail never trusts the light: open sky is the column of 64 blocks above (`columnIsOpen`), plus the rules of T1-3. | A |
| F6 | **The tunnel direction follows a stale yaw of the player** (a player who did not turn since a teleport). A second tunnel pointing into the landing appeared. | W66, 2 of 4 runs | The yaw of the player is ignored when it points towards the room or the entrance (the anchor); then the tunnel points away from the anchor. The scenario turns the player, as a real player does. | B |
| F7 | **`!rememberTunnel` accepts a room as a tunnel**: inside the house, `it starts at (15002, 61, -2), goes north, and ends at (15002, 61, -4) after 3 blocks, at level 61.` A trip for coal, copper or iron could choose it. | W60 order 38 | `rememberTunnel` uses the corridor rule of `rememberMine` (every cell at most 2 open neighbours) and needs 4 or more cells; else the no-corridor text. | B |
| F8 | **The route sometimes misses the trapdoor**: `3 steps, 1 ladder.` without the trapdoor. `viaOf` looks at one cell between two steps; at 200 ms per cell and 250 ms per tick the step under the trapdoor is skipped. A sprinting bot skips cells too. | W62, 2 of 4 runs | `viaOf` looks at every cell on the line between two steps (up to 4 cells), and the trail ticks every 100 ms. | A |
| F9 | w47 `creeper_in_sight` hung twice as the 14th scenario of a long session: the server dropped both bots with `Timed out`. Alone and in the full run it passes, with v0.1.4.8 as well. | one session | Not reproduced. Known flake, watched in the next full run. | none |
| F10 | w21 `trees` left one log on the ground in the full run; alone it passes. The wood pack did not change. | one run | Known flake. | none |

State after the fix round: F1 to F8 are corrected in the tree (unit tests 6078, 0 failures). Beyond the
decisions: the patch also switches on `climbUsingJump` for 1.21 (a jump climbs a ladder, which the
second way out of `climbUp` needs) and adds the pale oak trapdoor; the mine store keeps the `foot` of a
ladder leg. The tester's test `rt_trail` 113 expected the sky light to decide; it now expects the
column, by F5. The re-run on the real server follows.

Second full run, after the fix round: 68 of 72 pass, 5483 s; w47 and w21 did not flake. The physics
patch works (the stall at y 60 is gone), F2 to F8 hold on the real server. The four failures (W67, W68,
W69, W73) share one new cause:

| Id | Defect | Evidence | Decision | Owner |
|---|---|---|---|---|
| F11 | **The bot cannot open the trapdoor from below while it holds a tool.** It climbs to y 56.6 and clicks the closed trapdoor three times while sneaking; a sneaking click with an item in the hand uses the item, not the block. W62 passed only because its bot has an empty hand. | W67, W68, W69, W73; the move recorder: `activateBlock oak_trapdoor ... holding iron_pickaxe sneak true` | `climbToOpen` holds the bot on the ladder by pressing forward against the closed trapdoor instead of sneaking, and clicks without sneak. Done. | lead |
| F12 | `!collectPassedOre` said `I collected 2 gold_ore that I had passed.` while the bot hung on the ladder: the result of the climb to the surface was ignored. | W68 | The text of a failed climb is appended. Done. | lead |
| F13 | A plain `!goToCoordinates` into the mine stands on the closed trapdoor until `unstuck` stops it (the old path search plans through the trapdoor). `!goToRememberedPlace` avoids it by walking the route first. | W60 orders 35, 37 | Not corrected: a limit of the path search of v0.1.4.7, no regression. The play test guide says to use the saved places. | none |

After F11: W62 (with an iron pickaxe in the hand), W67, W68, W69 and W73 pass twice in a row on the
real server; the trapdoor opens from below with the tool in hand, and the bot ends every trip on the
surface.

Notes of T2 that are accepted as they are: a route from the trapdoor to the bed starts at the place
`home` when it passes within 2 blocks of it (A2 as written); W60 replaces 8 repeated queries by 8 orders
of the new commands so that it stays under 45 minutes; the hidden commands answer
`Command '!x' does not exist.`

## Decided from the reports of the engineers, without a test

| Id | Defect | Decision | Owner |
|---|---|---|---|
| R1 | The remember, list and forget commands of routes and mines ran as actions and stopped a running `!followPlayer`. | They are plain commands; only `!collectPassedOre` is an action. Done. | G |
| R2 | `!rememberMine` on an empty trail said `in my last 0 steps`. | `I have no trail yet. Walk with me from the entrance of the mine and tell me again.` Done. | lead |
| R3 | `action_manager.js` used a global `assert` that only the sandbox lockdown supplies; a resume action threw without the lockdown. | `import assert from 'node:assert'`. Done. | lead |
| R4 | An ore name alone made "craft an iron pickaxe" a digging request. | An ore counts only followed by `ore`, or within 3 words after find, get, collect and the like. Done. | C |
| R5 | The real routing run with the owner's profile chose the examples by word overlap while play uses embeddings, because only one key was loaded. | `test-routing.ps1` loads the other key too when its secret exists. Done. | D |

## Verification in a fresh checkout

Commit `ac3f2c7`, cloned fresh, `npm install` (547 packages, every patch applied), Node 22:

| Run | Result |
|---|---|
| `npm test` | 6078 tests, 0 failures, 1 skipped (Windows only) |
| `npm run test:e2e` | 17 of 17, 146 s |
| `npm run test:world` | 70 of 72, 5817 s. Every scenario of v0.1.4.9 passes, the long run too. Failing: `tall_tree` (one log left on the ground, the wood pack is unchanged, F10), `wake_for_order` (the bot got out of the bed as the scenario demands; the walk to the cow was then stopped by `unstuck` beside the pen, a behaviour of v0.1.4.8), and one repeat of `creeper_in_sight` timed out when the server dropped the connection (F9). All three passed in the second full run of the tester on the same tree. Not regressions. |

## Not corrected in this release

- A mine named with a number (`"16"`) collides with the key of a mine of the bot at that level.
- `ore_sense_range` accepts 1 and 2 as well as 0 and 3.
- The gpt bot does not start without `ANTHROPIC_API_KEY`, because the prompter makes the code model at
  the start. `start-gpt.ps1` loads both keys.
