# Decisions v0.1.4.11

Every defect the tests found, with the decision and the owner of the correction.

## Found by the unit tests of T1 (from the spec, 187 tests)

| Id | Finding | Where | Decision | Owner |
|---|---|---|---|---|
| T1-1 | I7 lists no kind for the end of a walk or stairs leg in the middle of a route, which it asks for as a waypoint; `waypointsOf` gives it the kind `walk`. | `nv_navigation` | The spec gets the kind `walk`. | lead, done |

Noted by T1 without a failing test: the size in the P1 texts is the box with its border (a pen of 9 x 7 inside
says 11 x 9); the dry scan returns `text` and `total`, and a search that runs out of time counts as an open hop;
the reservation of I8 protects reserved openables only (the pen gate rule of v0.1.4.10 stays); W7 in a tunnel
with `mine_from_inside` on gives the tunnel row.

## Found by the journeys of T3, written before the build and run on v0.1.4.10

The eight journeys W91 to W98 fail on v0.1.4.10 on the checks of the new behaviour and pass on their
preconditions; the twelve of before pass (W88 `ladders_native` failed once in the group with one fallback
ladder line in a follow and passed alone). Seen along the way, worst first:

| Id | Finding | Where | Decision | Owner |
|---|---|---|---|---|
| T3-1 | "Come here" across the mine (from the tunnel to the room, into the farm, into the house) used the destructive fallback of v0.1.4.10 because the path search of 1 s ran out of time on the long way. Part N reads a bounded search (48 blocks, 3 s) with no way as "no way to you": "come here" across floors would say the N2 text instead of walking. | W98 step 6, W94 | A search that runs out of time is not "no way": the walk to the player follows the partial path of the search toward the player and searches again from there; the N2 text only when no search makes progress. Fix round, before W95 to W97. | N (E4) |
| T3-2 | A mine learned in the room cannot be left: after the trip `I could not get to the way out at (403, 43, -2): I was blocked at ...`, at the gap under the second ladder of the base. | W91 step 4, W92 | To be read on the journeys with the new code (the waypoint walk with native ladders, the fallback that places ladders). | lead |
| T3-3 | The pen gate stayed open after the bot walked out of the pen, in 1 of 3 runs of W94 (the rule of T3-9 of v0.1.4.10). | W94 | W94 checks it; the owner closes the gate before the item test. To be read on the runs with the new code. | lead |
| T3-4 | W88 `ladders_native` is flaky: one fallback ladder line in a follow. | the group | Known from v0.1.4.10; watched. | - |

Decisions of T3 on the spec: W91 adds the stance that fails today (the bot outside the tunnel, the owner at
the rock face); W92 checks the trip down and back through the room, then `!goToMine("diamond")` and
`!leaveMine` from the bottom; W93 accepts either W4 way-out text; W94 accepts the outer or inner box and an
optional trapdoor in the home answer; W95 uses the middle of the first ladder; W96 uses iron doors (a block in a
doorway removes the door); W97 uses closeness 1; W98 routes the fake model for `!newAction`. `GOALS_SETTINGS`
of W85 to W90 does not get the new switches.

## Found by the journeys with the new code (the lead, round 3)

W91 passes at the first run. The others, worst first:

| Id | Finding | Where | Decision | Owner |
|---|---|---|---|---|
| F1 | The way out of the mine room fails in the dry scan: `I find no way from (403, 41, -2) to the foot of the ladder at (403, 43, -2).` The second ladder of the base ends 2 blocks above the floor; the scan asked the path search for a cell in the air. `!leaveMine`, `!goToSurface` from the room and `!leaveMine` from the bottom of the inner shaft stop before the first step. | W92 step 4, W93 step 2, W98 step 7 | A ladder hop is walked to the standing cell under the column and climbed by the ladder leg logic of the replay (enterColumn, the placing of missing ladders, climbUp, slideDown), never by the path search alone; the dry scan counts a ladder hop open when the column is intact for the direction or the bot carries the ladders for the gap, else names the gap and the ladders needed. | N (E4) |
| F2 | The pen gate stood open behind the bot after "come here" out of the pen and on to the farm. The service's own click had succeeded (the note and the side tracking dropped, `_seen` left at open), the path search opened the gate again, and the next look saw it open with `before` true: nothing noted. A chicken beside the gate also held every closing (`somebodyNear`). | W94 step 4 | A click sets the gate seen closed, so the opening again is noted as "opened"; a gate of a pen or a farm the bot opened while walking is closed 2 blocks past it, pass seen or not; a gate is held only by an entity in its cell (a door or a trapdoor keeps the 1 block of F21). | lead, done |
| F3 | `!givePlayer` still wrote `Discarded 4 wheat.` before the W5 text, and the control player of W98 never stepped on the items, so the answer was `w_player took 0 of 4 wheat`. | W98 step 4 | The toss of a give says nothing (the W5 texts say what the player took); W98's control player steps onto the items, as the owner does. | lead and T3, done |
| F4 | "Come here" from the tunnel to the room ended in the tunnel: T3-1 (the bounded search of N2 read a long way as no way). | W98 step 6 | T3-1, fixed (2cd7863): the walk in rounds along the partial path. | N (E4), done |
| F5 | "Come here" from the tunnel to the room answers `I find no way to you from here without digging.` at once, with the T3-1 fix in place: the way exists (the staircase of 16 steps and the double door of the room, closed by the door service). | W98 step 6 | The search of the rounds must open doors and climb the stairs as the walks of skills.js do; a unit test with a closed door and a staircase. | N (E4) |
| F6 | On the way down the dry scan says the way is open through a closed iron trapdoor; the locked check of a climb runs only for the way up (found by T1 while adapting the tests to F1). | T1, by probing | The locked check for both ways: the second N1 form naming the trapdoor. | N (E4), after F5 |
| F7 | `!leaveMine` from the bottom of the inner shaft: `I could not follow the route "mine" at step 4 of 10: I got stuck at (403, 39, -2).`, two rungs under the top; the trip itself came back up through the room. | W92 step 4 | The climb out of a shaft whose top rung is at the floor level of the room ends with a sideways step onto the room floor, not a climb into the hole; the record of the inner shaft and the hop agree on `top`. | N (E4), with M |
| F8 | `!leaveMine` from the room after a follow through the double door: `I could not follow the route "mine" at step 4 of 13: the door at (404, 41, -1) is closed and I could not open it.`, the bot east of the door on the descent. | W95 step 1, W96 step 0 | The way out from the room goes to the foot of the ladder, never through the double door; a closed oak door beside the bot is opened. | N (E4) |
| F9 | "Come here" from the room into the house: `I find no way to you from here without digging.`; the only way is ladder 2 whose lowest rung is 2 above the floor, which the path search cannot enter. | W96 step 0 | Before the N2 text the ladder way of v0.1.4.9 toward the player (the missing ladders placed when the bot carries some), as goToPlayer did in v0.1.4.10. | N (E4) |
| F10 | With the oak doors back, `!goToMine` from the house answers after 180 s `I find no way from (422, 25, 9) to the room at (401, 41, -1).`: the dry scan scanned a hop beyond the goal (the tunnel end to the room) and counted the closed double door as a wall. | W96 step 2 | The scan covers only the hops the walk will take, from the nearest waypoint to the goal; a closed openable that `canOpen` accepts is passable in the scan (the walk opens it); the second N1 form only for one `canOpen` refuses; the whole scan answers within 10 s. | N (E4); the spec test, lead |
| F11 | `!goToMine` with the bot halfway down ladder 1 during a follow: `I could not follow the route "mine" at step 1 of 11: I got stuck at (398, 57, -3).`, the bot never moved for 122 s (the owner's defect of v0.1.4.9: a ladder leg from mid-ladder fails). | W95 step 3 | slideDown and climbUp from the middle of a column: release the hold of the interrupt, no walk to the entry, no waiting for a trapdoor above on the way down. | N (E4), ladder.js allowed |
| F12 | 10 s after the way out the trapdoor, one room door and the house door stand open: the walk reserved them, the service never noted the pass, the release left them. | W95 step 5 | A released reservation of an openable the bot passed counts as a pass; the walk may close an openable itself right after its hop. | N (E4) |
| F13 | After the climb out of the inner shaft (F7 works) `I could not follow the route "mine" at step 3 of 10: I got stuck at (403, 41, 0).` inside the open room. | W92 step 4 | To be found in the log: the goal of the hop after the climb. | N (E4) |
| F14 | The inner shaft of W92 was dug on the floor cell under ladder 2 of the parent, where the bot had come down; the way up then crossed the hole (bridged by N with 2 ladders). | W92 | Part M: the inner shaft never starts within 1 block of a ladder cell, foot or entry of the parent's way, nor in or beside a door cell; the nearest free floor cell of the room is taken, else `I find no floor cell for a shaft here that leaves the way out free. Stand elsewhere in the room and tell me again.` | M (E2), done |
| F15 | In the journey group of twenty (a loaded machine) "come here" to a sealed box answered `Command !goToPlayer was stopped by the reflex unstuck.` after 21 s: the rounds of search kept the bot standing, and the unstuck reflex took it for stuck. Alone it passed. | W97, the group | The time a search of the walk to the player runs is not time stuck (`bot.searching`, the stuck clock restarts while it is set); at most 20 s of search per order, then the N2 text. | N (E4), done |
| F16 | W98 step 7 locked the double door east of the room, which since F10 is not on the way in from the house: the bot walked in and said `I am in the mine "mine".`, rightly. | W98 step 7, the group | The scenario locks the house trapdoor, as W96. No change of the code. | T3, done |

## The gate, 2026-10-03

The journey group of twenty (W59, W80 to W98) in the work folder: 18 of 20 at the first run (F15, F16), then W97 and W98 pass alone with the fixes; every journey of this release passed at least twice on the real server after the last change of its part. The fresh clone: see the verification below.

## Found by the full world set in the fresh clone, 2026-10-03

The set at 3276e4d: 89 scenario lines before the time limit of the run (every old scenario), 15 failed.

| Id | Finding | Where | Decision | Owner |
|---|---|---|---|---|
| F17 | `!newAction("dig...")` at the end of the tunnel of a known mine answered the row of "underground, no mine" (`say "leave the mine", then !mineOre("iron", 8, true)`): `whereAmI().mine` is null without `mine_routes`, so the refusal did not see the mine. | dig_code_refused | The refusal reads the mine store itself when `whereAmI` gives no mine: in a tunnel of a known mine the row is `!mineOre("iron", 8)`. | lead, done |
| F18 | W89 pen_gate_safe failed at step 1 once more (the gate open 1.4 blocks behind the stopped bot, 4 of its last 6 runs pass): a race between the scan's walk in, the service's close behind the bot, the path search opening the gate on the way out and the stop. | pen_gate_safe | A debug line behind `MC_DOOR_DEBUG` prints every decision of the service for a gate within 3 blocks; the failing run read, the cause fixed with a unit test. | N (E4) |
| F19 | Thirteen old scenarios expect texts and walks of v0.1.4.10: nine the old answer of `!rememberArea` (shelter, night, protected_house, scan, creeper, sleep, creeper_standing, farm_scan), route_broken the I3 text with "Show me the way again", and W31, W38, W57 (part A) a `!followPlayer` that keeps the bot trying in a sealed room, which now ends with the N2 text as W97 wants. | the set | The nine and route_broken accept the P1 and W1 texts; the three stuck scenarios give `!goToCoordinates` instead of the follow, so that the reflex they test keeps its trigger. | T3 |

F18: fixed by E4 (the door service kept the area store it was made with; a pen saved after the world was
identified was invisible to it, so its gate never counted as a pen gate; now the service asks the area guard of
the moment; a debug line behind `MC_DOOR_DEBUG`). F19: done by T3, all 14 pass one at a time. Two decisions of T3
accepted: on an open field `!rememberArea("camp", "building")` saves nothing and answers `I find no border around
me: ...` (the fallback box of 25 x 13 x 25 of v0.1.4.6 is gone; `!setArea` with corners saves such a place); the
three stuck scenarios (W31, W38, W57 part A) start a walking action of the agent instead of a typed order, since
every typed walk now ends by itself (the N2 text, or "Path not found" within a second) and the reflex they test
needs an action that keeps trying. dig_code_refused saves no mine, so its row is "underground, no known mine".

The set again at 8f5f0fb: 90 of 92 run before the time limit (the eight journeys of this release ran in the
group), 2 failed, both at the climb up ladder 1 under the trapdoor:

| Id | Finding | Where | Decision | Owner |
|---|---|---|---|---|
| F20 | W88: the last climb up ladder 1 took 54 s with a stall of 35 s under the trapdoor; W84 B3: after the climb up ladder 2 the way home stuck at the top of that ladder (`I got stuck at (16403, 53, 0)`), the bot left in the basement. Both passed in the journey group before the second version of F12 (release and close right after the hop) and F18. | ten_minutes, ladders_native | No openable is released or closed by the walk before the bot is through it in the walking direction (a trapdoor: feet above it going up, below going down); the door service never closes a trapdoor over a column while the bot is in the column; the hop after a climb starts at once. | N (E4) |

F20: fixed by E4. The stall of W88 was in `followPlayer`: the bot hung in the open trapdoor cell at the top of
the column with the player 2.2 blocks away, within the follow distance, so the path search counted the goal as
met and held it on the ladder for 35 s; now a follow that hangs in an open trapdoor for 1 s with the player above
jumps and walks out (at most 3 times). The door service never closes a trapdoor over a column while the bot
climbs up in it. W84 and W88 pass after the change; alone at 69de4d1 both had passed too (a race).

The set in the fresh clone at b91df2f: 18 of 20 journeys (W84 and W88, both fixed by E4 at 68f96a8: F21, F22),
the door scenarios pass, `farm_cycle` fails once (F23).

| Id | Finding | Where | Decision | Owner |
|---|---|---|---|---|
| F21 | W88: `approachWithoutDigging` said the N2 text after a round that timed out without progress, while the player stood reachable 6 blocks away. | ladders_native | A round that times out with no progress gets one more search before the N2 text. | N (E4), done |
| F22 | W84 B3: the bot wedged in the open trapdoor cell at the top of ladder 2 and `climbOutToward` gave up there. | ten_minutes | A bot wedged at the column top walks to the free cell beside it; `passDown` refuses only without a floor within 3 blocks below the bottom rung, or over lava. | N (E4), done |
| F23 | `farm_cycle`: the store step kept 32 seeds and put 1 in the chest, then the planting took 6 of the 32: the bot carried 26 seeds, the chest 1, and the text said `I stored 7 wheat, 1 wheat_seeds`. | farm_cycle | The store step keeps 32 seeds plus the seeds the empty cells of the field need; the text and the order of F2 stay. | fix round (E6) |

## Found in the owner's plays of v0.1.4.10, 2026-10-03

Two sessions of the owner (gpt 84 min, $0.39; claude 29 + 21 min, $1.27), the logs, the memories and the game log
read by the lead. What v0.1.4.11 already fixes: the remembered path walked by the letter (routes start from the
nearest waypoint, `routes_by_search`), `!goToRememberedPlace("basement")` ending at the ladder foot (F11), the
argument text of `!consume("wheat", 10)` (W5), doors and trapdoors left open after a hop (F12), digging and
placing toward the player (N2), a pen saved from one sentence with its kind concluded from the scan (P). The rest:

| Id | Finding | Where | Decision | Owner |
|---|---|---|---|---|
| F24 | The owner's cobblestone staircase to the tunnel is no way for the path search: P4 of v0.1.4.10 made bottom stairs and bottom slabs no standing places, so `!goToPlayer` and the follow dug beside the stairs or placed blocks on them ("you're literally standing on the stairs"). Mining failed on it. | the plays | Bottom stairs and bottom slabs are standing places again, as in the pathfinder before P4; a move still never breaks them (`mayBreakOnPath`). The no-stand list of hollow blocks and containers stays. A unit test walks a path over a staircase of bottom stairs and one over bottom slabs. | fix round (E5) |
| F25 | The night reflex fired in the basement (a saved area of type `building`, walls, roof, lit) and in the mine room and said "I cannot get into the shelter "home"" (the way out was the ladder column); the owner had to add rules that the basement and the mine entrance are safe. | the plays | A bot inside the walls of a saved area of type `home` or `building` is in shelter: the reflex does not go, and `!goToShelter` from there answers that it is in the shelter "<name>". In the mine (`whereAmI().mine`, or underground) the reflex waits, as A7 says; the depth is read under a built floor too. A scan with a roof and an opening of kind trapdoor or ladder and no door is a `building`, not a `yard`. | fix round (E5) |
| F26 | Two bots of the owner (gpt and claude) in one world answered each other's command echoes and results as chat and became uncontrollable; `!stfu` held for a moment. The second bot crashed at the start with `EADDRINUSE ::1:8080`, the port of the first mindserver. | the plays | No code: `only_chat_with` with the owner's name in each bot's `settings.js` makes a bot answer the owner only, and `MINDSERVER_PORT` of the launch script gives the second bot its own mindserver. The play guide gets a section "Two bots" with both. A two-bot mode with roles is v0.1.4.12. | lead, PLAYTEST |
| F27 | After the night the model said "I haven't started cutting for that task. I'm carrying 139 oak logs right now." The chop of 128 logs was done (the job store had it done; `farmCycle` was the job after it, left for the night), but the knowledge block says nothing about a finished or left job, so the model answered from its own memory. | the plays | The knowledge line keeps the last job that is done or left: `Last job: the chopping, done, 99 oak_log.`, `Last job: the farming, left.`; a running or paused job as before. One line. | fix round (E6) |
| F28 | `npm run test:play` 6 of 8: "this is the mine" answered `!rememberArea("mine", "mine")`, and the play expects a mine in `mines.json` (`!rememberMine`). "find some iron" failed after it, since no mine was known. | test:play | `!rememberArea(name, "mine")` with the mining pack on also records the mine of the player at the bot's position, as `!rememberMine(name)` does, and appends its sentence; the play accepts both commands and checks the fact. The play runs with `--fake` in the cloud before the merge. | fix round (E6) |
| F29 | The owner dumped his region (629,988 blocks, center (9, 38, 33), radius 48, version 1, complete). | the plays | The dump is not committed (16 MB); `tests/world/owner_region.json` is ignored by git, the cloud session copies it from the upload, and the README says so. W59 and the journeys run on it before the merge. | lead |
| F30 | Chickens escaped: claude placed blocks inside the pen (unstuck and bridge moves) and picked items up in it; the pen was saved as rules only. gpt refused `!rememberArea("pen", "pen")` on the farmland ("it is a farm") and used `!setArea`. | the plays | Part P covers both: the kind is concluded from the scan, and a saved pen is keep-out for placing, bridging and item collection (R1). A journey check: W89 pen_gate_safe asserts no block placed inside the pen. No further code. | lead |

Not in this release: the watch MCP for the owner's machine (the bot's position, inventory, chat and action read
from here while the owner plays, never a connection to port 55916 from the cloud) and the two-bot mode go to
v0.1.4.12 "Understanding and watching".
