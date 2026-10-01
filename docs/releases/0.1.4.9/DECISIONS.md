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

## Found by the play test of the owner, 2026-10-01

Log of 3.5 minutes, 3 processes, 2 ends by "Got stuck and couldn't get unstuck", 1 by the server
closing the socket at login; 3 orders, none with a result; 9 calls, 4 cents.

| Id | Defect | Evidence | Decision | Owner |
|---|---|---|---|---|
| F14 | **`!followPlayer` and `!goToPlayer` cannot go down a ladder.** "follow me" from the house into the basement: the bot walked into the cell of the open trapdoor above the ladder and stood there for 22 s (the trail: `13 67 51 on ladder at oak_trapdoor`); the path search climbs a ladder but never descends one. `unstuck` fired, its escape failed, the process was killed 10 s later (`stuck_restart_after` at its default 1). "come here" said `You have reached MartyByrde2` on the trapdoor and ended the same way. The way into the mine is learned by following, so the release could not be used. The world tests moved the bot down the ladder with the test control and never exercised this. | the log and the trail of 2026-10-01 | Part L (spec section 13): with `routes_pack`, the follow and `!goToPlayer` open a closed trapdoor and go down or up a ladder column with the ladder code of the mining pack when the player is 2 or more blocks below or above. Scenario W75. A fix of v0.1.4.9 on `hotfix/follow-ladder`; the tag goes on its merge commit. | C |
| F15 | An old mine the bot dug on 09-28 sits 6 blocks from the door of the owner (`mines.json`, key `16`, a shaft from y 66 to 25). `!mineOre` would choose it before the mine of the owner. | `mines.json` of the archive | The play test guide says to delete the entry. No code change. | owner |
| F16 | `Error with embedding model` three times at every start: the owner's `profiles/claude.json` lost its `"embedding": "openai"` line when the release was pulled. | the log | The line goes back into the profile; the release never carries it. The guide says so. | owner |
| F17 | The console line `Agent executed: !followPlayer and got: undefined` for an interrupted action. | the log | `... and was stopped.` Done. | C |

## Found by the play of the owner on 2026-10-01, second and third session (Luna, then Claude with an empty memory)

| Id | Defect | Evidence | Decision | Owner |
|---|---|---|---|---|
| F18 | **A route cannot start inside the home**: the area of the house spans both floors (the scan follows the ladder, y 55 to 71), so in the basement `!rememberRoute("basement")` said five times `too short: I stand where it starts`. | Claude log 04:14 to 04:17 | In `routeStart` two steps of the same area count as different known things when their y differs by 3 or more; `from.name` is `<area>, level <y>`. | A |
| F19 | The model answered "go to the basement" with `!goToRememberedPlace("basement")` and got `No location named "basement"`: a route has no place at its end. | Claude log 04:16:30 | `rememberRoute(name)` also saves the place `name` at its end when none exists, and says so. | A |
| F20 | `!goToCoordinates(12, 67, 46)` "to go down the ladder" ended on the closed trapdoor. The path search of every walk to a point ignores ladders downward and trapdoors. | Claude log 04:16:08; Luna log 04:07 | The ladder step of part L becomes one helper used by `goToPlayer`, `followPlayer` and `goToPosition` (so `!goToCoordinates` and `!goToRememberedPlace` too): before the path search and again when it ends 2 or more blocks above or below the target. | C |
| F21 | The door service closed the trapdoor over the owner's head 11 s after "follow me", before the bot had passed it, and shut its own way. The owner also sees trapdoors left open. | Claude log 04:14:01 | The service closes only openables the bot itself passed (for a trapdoor: above then below, or the reverse), 2 blocks past them, never one only a player opened, never with an entity within 1 block. After a ladder pass it closes the trapdoor behind the bot. | A (home pack) |
| L1 | `!goToPlayer` from 3 blocks away never took the ladder and said `You have reached w_player.` on the closed trapdoor. | W75 part 3 | Reach 6; the pass also after the path search; "You have reached" only within the asked distance in 3D, else `I stopped at (x, y, z), N blocks from <name>.` | C |
| L2 | Following up stalled under the closed trapdoor while the player waited beside it. | W75 part 2 | No distance condition for the pass; the still clock looks at the feet cell. | C |
| L3 | Halfway down a column no column was found. | W75 run 1 | `ladderColumnAt` finds the column from inside it. | C |

| F22 | **A ladder that ends above the floor.** In the mine of the owner the second ladder ends at y 43, two blocks above the room floor at y 41. The bot dropped off it going down; going up the route's walk targets a cell in the air, so `!leaveMine` failed at step 1 and step 5 and the bot stayed underground. | bots/gpt `mines.json`, the Luna log 03:45 and 03:48 | The foot of such a ladder is the cell directly under the column at the floor; the bot enters the column from there with a jump (the physics patch lets a jump climb a ladder); the slide down ends with the drop. | A, with `ladder.js` |
| F23 | `!rememberArea("basement")` and `!rememberHere("bed")` saved two more areas with the same box as `home`. | bots/gpt `areas.json` | Not corrected now: a scan that gives the box of an existing area should answer that it is that area already. Next release. | none |
| F24 | **The walk back to the way out failed** after a trip with side steps and branches: `I could not get to the way out at (10, 30, 16).` The cause is not in the files. | the Luna log 03:43 | The walk back follows the cells the bot knows, branch to junction to corners to the route end, digs a natural block that is in the way, and names the cell that blocked. | B |

Luna session of 53 minutes (13 cents, median answer 3 s), the other findings, corrected with the owner's go (F25 to F30):
the warning spam of `entity.objectType` (15,000 lines), `craftSupplies("torch")` failing with logs in the
inventory, a trip without torches in a mine of the player, `!goToMine` not knowing a mine of the player,
"do not dig" refused as a digging request, the item reflex opening the gate of the pen, `!rememberMine`
texts before any sky step.

## Found by the journey scenarios (black box, the owner's first minutes), 2026-10-01

The gate removal of the ladder step and the journeys: W59, W80 (first minutes) and W82 (come here across
floors) pass; W81 (first mine) walks down both ladders, through the double door, learns the mine, mines
4 iron and comes back to the surface, and fails on one check; W83 fails on the torches; W84 (ten minutes) fails on
the same torch check and on the last "come here".

| Id | Defect | Evidence | Decision | Owner |
|---|---|---|---|---|
| F31 | **The bot stored its torches in the mine chest** before digging (`torch 16` in the room chest, none placed). `depositAtBase` keeps only the ore. | W81 B3 | `depositAtBase` keeps the supplies of a trip: torches, ladders, pickaxes, food up to 16, fillers up to 32, a chest. A torch is due within the first 8 new blocks when the last torch is 8 or more behind. | B |
| F32 | **"check the chest", then "make 32 torches"** answered `I need 8 stick and have 6` with 19 logs in the chest it had just looked into: `!viewChest` does not record the chest in the index, and `craftSupplies` neither crafts what it can nor fetches from the chests. The owner saw the same ("why are you gathering oak logs while you have some in the chest"). | W83 | `craftSupplies` crafts what it can, fetches the missing ingredients from the chests it knows, then names what is still missing: `I made 24 torches of 32. I need 2 coal more and know no chest with coal.` `!viewChest` records the chest in the index. | B (wood, storage), G |
| F33 | **"come here" from the mine room after sleeping left the bot standing on the trapdoor** for 20 s until the reflex unstuck stopped the command: the bed is 7 blocks from the ladder, so no ladder step came before the path search; the path search planned through the closed trapdoor, walked the bot to the top and held it there; the ladder step after the path search never came. | W84 D | The walk of `goToPlayer` and `goToPosition` watches the bot as `followPlayer` does: still in its cell for 3 s, the target 2 or more blocks above or below, a column near, then the path search is stopped for the ladder step and started again. | lead |
| F34 | **The bot slides back 0.3 blocks on every climb up a ladder with a closed trapdoor** (the "flinch" of the owner): the click on the trapdoor turns the look to it, so the bot no longer presses against the wall and slides; then the controls were released before the climb went on. Measured by the tester: 2 to 3 reversals of 0.3 blocks per climb up, none on the way down. | W80 A4, W82 step 2, 3 of 3 runs | Jump is held during the click (a jump climbs a ladder in 1.21), the look goes back to the wall at once, the controls stay pressed for the climb that follows. In `ladder_pass.js` and in the route replay. A second cause stays: an order that interrupts a climb ("come here" while the follow climbs) releases the controls for a moment, about 0.3 blocks. | lead |
| F32b | **"make 32 torches" still made none on the real server**: the bot fetched 8 coal and a log from the chest, crafted planks and sticks, and the torch craft threw `missing ingredient`; 2 coal and 2 sticks vanished. `bot.craft` clicks in the window that is open; a craft that stops half way leaves its ingredients in the 2x2 grid, where the inventory count does not see them. Then `craftSupplies` stopped at the first failed step instead of crafting what was left (6 coal and 6 sticks give 24). | W83, runs 2 and 3 | Before every craft the wood pack closes an open window, waits for it to clear, and puts back what lies in the grid and on the cursor (`freeCraftingGrid`). After a failed step the next round crafts what the inventory gives; a third failure ends it. | B |
| F35 | **After the climb through the trapdoor the bot hung in the hole**: the trapdoor stayed open until the door service closed it 2 blocks past the bot, and the path search walked the bot over the open trapdoor on its way to the player (an open trapdoor is climbable: the bot hung at y 60.6, said "You have reached"). | W82 step 2, run 3 | A trapdoor the bot climbed out of is closed at once, while the bot stands beside it; in the ladder pass and in the route replay. The path search of v0.1.4.10 (P1) stops treating a trapdoor as a floor. | lead |
| F32c | **"make 32 torches" made 12**: every call of `bot.craft` with a count over 1 crafted once and threw `missing ingredient` on its second craft (the slots of the inventory are stale right after a craft). | W83, run 4 | One craft per call, the inventory settled between them. | lead |
| F36 | **"come here" said while the bot climbs after the player made it slide 0.3 blocks** (the hand-over): the interrupted pass released the controls and the next order took the ladder a moment later. | W80 A4, runs 2 to 4 | A pass or a route leg that is interrupted while the bot hangs on a ladder holds on with sneak (the physics stops a sneaking bot on a ladder); the next pass or walk clears the controls as it starts. | lead |
| F37 | **The way out of the mine failed at the second ladder** (W84 B3, runs 2 and 4; W81 passed): the door service closed the door of the room while the bot climbed the ladder beside it; the click turned its look away from the wall, the bot stepped out of the column and fell, and the climb gave up after 3 s. A click during a slide down stalled the slide too (W80 run 13), and from the floor 7 blocks below the click never reached the trapdoor (W80 runs 5 and 6). | W84 B3, W80 A1 and A2 | The door service never clicks at a bot on a ladder, a vine or an open trapdoor off the ground. The ladder pass and the route leg close the trapdoor they came through themselves: on the way down 2 blocks below it, while the slide presses nothing; on the way up from beside it (F35). | lead |
| F38 | **"come here" answered `Could not find w_player.` at once** when the player had just moved to another floor and their entity was not loaded for a moment. | W82, run 5 | `goToPlayer` waits up to 2 s for the entity of the player before it gives up. | lead |
| F39 | **"come here" said while the bot climbs after the player left it bobbing under the trapdoor for 62 s**: the pass that took over clicked the trapdoor the first pass had just opened (its state reached the bot a moment later) and closed it again, then climbed against it. | W80 A4, run 14 | Under the trapdoor the pass waits 0.4 s, reads the state again and gives an open trapdoor no click. In the ladder pass and the route replay. | lead |
| F40 | **The trip could not get out of the mine of the player** (`I could not get to the way out at (822, 25, 13): I was blocked at (803, 40, 2).`): from the room the walk back hopped to the end of the nearest leg of the way in, which lay at the foot of the descent below the room; the walk down was blocked and the trip ended in the room. The journeys passed because in the owner's base the nearest leg ends in the room. | mine_known, passed_ore, ore_sense, branches in the fresh checkout | The hop from the room is the cell of the nearest leg that is nearest to the feet, at the room level. The route scenario accepts the place saved at the end of the way (F19). | lead |

The full world run in the fresh checkout (6213 s) found F40 and the text of `route_to_bed` (F19); the
journey group after the fix round (run 16, 2026-10-01) passed 6 of 6. Run 13: owner_base, first_mine, come_here_floors,
chest_and_torches and ten_minutes pass; first_minutes failed on the trapdoor only, corrected by the third
step of F37 (the pass closes the trapdoor itself).

## Not corrected in this release

- A mine named with a number (`"16"`) collides with the key of a mine of the bot at that level.
- `ore_sense_range` accepts 1 and 2 as well as 0 and 3.
- The gpt bot does not start without `ANTHROPIC_API_KEY`, because the prompter makes the code model at
  the start. `start-gpt.ps1` loads both keys.
