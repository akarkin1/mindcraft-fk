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
