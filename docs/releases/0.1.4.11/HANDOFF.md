# Handoff notes v0.1.4.11

Notes between the parts, by the engineers, accepted by the tech lead. Where they disagree with
`SPEC.md`, they win.

## From part W (the words, E1), done in round 1

### Exports and texts

| File | What |
|---|---|
| `src/agent/packs/routes/texts.js` | `routeFailedText(route, step, total, at, cause)`, `causeText(cause)`, `noWayToStartText(route, start, from)`. "Show me the way again." is gone; without a cause the text ends with `, at (x, y, z).` |
| `src/agent/packs/routes/replay.js` | `walkRoute` and `walkByRoute` return `route`, `step`, `total`, `cause` on failure (I1); new export `legCause`. A door leg gives `door` (closed or blocked), a ladder leg `ladder` (or `door` for its trapdoor, else `stuck`), a walk or stairs leg `no_path`; a timeout, an error or an empty route `stuck`; a stop `interrupted`. The old note "I need N ladders at ... to climb out." is gone: the ladder cause says it. The legs are walked as before. |
| `src/agent/packs/mining/texts.js` | `rememberTunnelText(t)` reads `t.width === 2` and `t.fromPlayer`; `noCorridorText(cause)` with `{ kind: 'open_sides' \| 'wide' \| 'ceiling' \| 'short', at, sides \| width \| length }` (`short` by the lead: `I stand in no tunnel: the corridor at (x, y, z) is only N long. A tunnel is 4 or more.`); `shaftFromHereText(level, ore)`, `inMineText(mine)`, `TEXTS.undergroundNoMine`. `TEXTS.underground`, `STOP_REASONS.underground` and `TEXTS.noCorridor` stay as fallbacks. |
| `src/agent/dig_request_logic.js` | `digRefusalText(commands, place)` (W7, I2); `oreOfRequest(text)`, `DIG_COUNT` (8). Without `place` the text of v0.1.4.9. |
| `src/agent/commands/actions.js` | `digPlace()` builds `place` from `agent.whereAmI()` for `!newAction`; `surfaceContext()` gives `!goToSurface` the pack context plus `mining` when the mining pack is on, else the home context; the descriptions of `!goToSurface`, `!goToMine`, `!leaveMine`, `!rememberTunnel`, `!newAction` and its parameter are shorter. |
| `src/agent/commands/index.js` | `argumentsText(command)` (W5): `!rememberRoute takes 1 argument (name): !rememberRoute("name").`, also `takes 1 to 3 arguments`, `takes 0 or 1 arguments`, `!stop takes no arguments: !stop.`; item and block names in quotes. |
| `src/agent/library/skills.js` | `goToSurface(bot, ctx = null)` (W4): in a mine the mining pack's way out through `ctx.mining?.climbToSurface`; in a building (an area of kind home, building or storage, or a roof within 6) out through the nearest door or gate with `passThrough`; else the nearest ground cell with open sky within 16, never a roof cell (the block under the top block must not be air, the cell in no building area). No digging. `giveToPlayer` counts what the player picked up: `Gave 44 wheat to MartyByrde2.`, `MartyByrde2 took 40 of 44 wheat; 4 lie on the ground at (x, y, z).` (`1 lies`); its listener is removed afterwards. The signatures and the meaning of the return values are unchanged. |
| `src/agent/library/skill_texts.js` (new) | `SURFACE_TEXTS`, `GIVE_TEXTS` (skills.js may export only functions) |
| `profiles/claude.json`, `profiles/gpt.json` | the two lines of W6 after "have fun :)", nothing else |
| `scripts/scorecard_logic.js`, `scripts/scorecard.js` | `FAILURE_STARTS`, `FAILURE_TOP`, `failureTexts`, `formatFailures`, a `failures` field per row and on the total; printed after the table |
| `tests/routing/commands.js` | the new descriptions of `!goToMine` and `!leaveMine` |

### The prompt

With every switch on the conversing prompt is 16,994 characters, 6 under the limit of 17,000. Part P
adds examples (not counted) and the knowledge line (counted inside the 600 of the block): no new
description or setting line may be added without shortening another. The lead decides what to shorten
when P needs room.

### Decisions beyond the spec, accepted

| Decision | Why |
|---|---|
| I2 reads `whereAmI().mine` for `inMine` and counts `inTunnel` only inside a mine | `mineAt(...)?.tunnel !== null` is true without a mine |
| The give text follows the spec (`Gave 44 wheat to MartyByrde2.`), not the plan | the spec is the source |
| The ladder cause reports the largest missing run and its lowest cell | one number the owner can act on |
| Leaving a building through a fence gate says "through the gate" | |
| The scorecard counts only command results | the table test stays |

## From part M (the mine, E2), done in round 1

### Exports

| File | Exports |
|---|---|
| `mine_logic.js` | `measureTunnel` returns `width` (1 or 2); `corridorWidth`, `tunnelAt(get, feet, { minCells, playerPos, yaw, anchor })` (the direction, the rock-face case, the W2 checks in order: open sides, width ahead, ceiling, then `short`), `addTunnel` (pure), `insideShaft` (the ladder face and the exit cell of a shaft from inside); `tripStart({ mine, newMine, underground, inMine, fromInside })` returns also `inside` or `in_mine` |
| `mine_player.js` | `rememberTunnel(bot, ctx, name, { playerYaw, playerPos })`: the bot's cell first, then the player's; when both fail the text names the first failed check at the bot's cell. `rememberMine` uses `tunnelAt` (2-wide tunnels accepted). `minesText` lists a child as `bot:-58 (from the mine "mine")`. `forgetMine` of a parent forgets its children. |
| `mine_store.js` | the field `parent` (written only when set), `mineId`, `parentOf`, `children` |
| `mine_way.js` | `fromInsideOn`, `parentMine`; `chooseMine` picks, within a parent and its children, the level nearest the ore's best level (a tie: the deeper); `wayIn` of a child: the parent, then the shaft; `wayOut` of a child: the shaft, then the parent's way out (or stops in the parent with `toParent`) |
| `mining.js` | `mineOre`: with mine_routes an unsaved tunnel is measured, saved and announced first; the `inside` case says the W3 shaft text, writes the child record with `parent` and digs the shaft from the cell the bot stands on; `in_mine` and `underground` use the W3 texts; a trip that starts in the parent ends in the parent. `descendToLevel` builds the child and enters an existing child through its parent; `climbToSurface` takes the child's shaft and the parent's way out. `goToMine` with an ore picks the fitting level within a parent and its children. |
| `settings.js`, `settings_spec.json` | `mine_from_inside: false` |

The glue of `!rememberTunnel` passes `playerPos` (the lead, in `actions.js`).

### Decisions beyond the spec, accepted

| Decision | Why |
|---|---|
| The rock-face rule applies only when the one open direction points at the room's anchor | keeps the sealed-pocket rule of F7 |
| A tunnel is 2 wide when any cell from start to end is 2 or more wide | one niche makes it "2 wide"; the owner sees the width in the text |
| The ceiling is checked above the feet cell only | |
| A shaft from inside needs no `newMine`; with mine_routes a player mine without a fitting tunnel still answers `no_tunnel` unless `!mineOre(..., true)` | matches W7 |
| `inside` and `in_mine` only when `whereAmI` says underground | the surface is unchanged |
| The shaft starts on the cell the bot stands on, also in the middle of a tunnel | I4 literally; see the limit below |
| A level collision moves the child level up by 1, at most 8 times | no record overwritten |
| Areas of type `mine` stay protected for the inner shaft | as v0.1.4.10 |
| A trip started in the parent ends in the parent; one started on the surface ends on the surface | W92 |
| A tunnel `mineOre` just measured is used when its level fits the ore | the owner showed it |
| The return time of a child counts only the child's shaft | |
| `Forgot the mine "mine".` stays when children go with it | |
| Six new texts in the files where they are used: `The way down from (x, y, z) would come too near a protected area.`, `I find no open cell beside (x, y, z) to climb out of a shaft. Stand on the floor of the room and tell me again.`, `I could not get to the place for the shaft at (x, y, z).`, `I could not climb down the shaft at (x, y, z).`, `I am back in the mine "mine" at (x, y, z).`, `I climbed the shaft to (x, y, z). I know no mine above it.` | |

### Known limit (the lead)

A shaft dug in the middle of a tunnel leaves a ladder hole in the floor of the tunnel, with no trapdoor
(the surface shaft places none); digging on at that tunnel's end later walks over it. The play test
says: dig the inner shaft from the room. W92 tests the room. A trapdoor over an inner shaft is a
candidate for the fix round if the journeys or the play test show a fall.

## For part P (round 2)

- The prompt has 6 characters of room. P's knowledge line counts inside the 600 of the block, not the
  17,000; P's examples are not counted. If P needs a description, the lead shortens one.
- `whereAmI()` of the agent gives `{ area, depth, underground, mine }`; the enclosure line (I6) is built
  beside it in `agent.js`, at most once per 10 s.
- `isKeepOutArea` of `keep_out_logic.js` is read by `modes.js` (item_collecting) and `keep_out.js`
  (the walks); the kind and the contents go into the area record of `area_store.js` (`kind`,
  `contents`, `border`; `type` stays and is derived from the kind).

## For part N (round 3)

- `routes/index.js` does not re-export `causeText` or `legCause`: add them with the waypoint exports.
  `walkWaypoints` keeps `cause` (I1) so that W1 texts stay the same.
- `mine_way.js` of part M: `wayIn`, `wayOut`, `walkBack` and the child routes (`parent`, the shaft legs)
  are the places where the waypoint walk goes behind `routes_by_search`; a child's way is the parent's
  waypoints plus the shaft.
- `goToSurface` of skills.js calls `ctx.mining?.climbToSurface`; N's player walks (`goToPlayer`,
  `followPlayer`) live in the same file: change only those two functions.
