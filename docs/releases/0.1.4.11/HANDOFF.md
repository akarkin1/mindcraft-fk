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

## From part P (the places, E3), done in round 2

### Exports and record

| File | What |
|---|---|
| `src/agent/areas/area_scan.js` | `scanEnclosure(getBlockName, origin, options)` with the I5 result plus `min`, `max`, `entrances`, `source`, `scan` (the v0.1.4.10 result underneath); `scanBuilding`, `scanPen`, `scanFarm` call it and return their v0.1.4.10 results; `scanWithoutType` unchanged; `ENCLOSURE_BORDERS`, `OPENING_KINDS`, `FLOOR_KINDS`; the `no_border` text in `scanText` |
| `src/agent/areas/area_kind.js` (new, pure) | `PLACE_KINDS`, `KIND_TYPES`, `KIND_SENTENCES`, `CONTENT_KEYS`, `kindOf`, `typeOfKind`, `animalCount`, `contentsParts`, `openingsParts`, `borderWord`, `sizeWords`, `withWords`, `savedText` (P1), `kindChangedText`, `senseText` (P2) |
| `src/agent/areas/area_sense.js` (new) | `countContents(bot, box)`, `emptyContents`, `blockNamesOf`, `heldBySaved`, `unsavedEnclosure`, `enclosureKnowledge`, `boxKey`, `newSenseState`, `senseStep` (the timing rules, pure), `senseTick`, `SENSE_RULES`, `ENCLOSURE_KNOWLEDGE_MS` |
| `src/agent/areas/area_store.js` | the record gets `kind`, `contents`, `border`; `type` derived from the kind (storage and yard become building); a v0.1.4.10 record loads unchanged and is not rewritten; `AREA_BORDERS` |
| `src/agent/areas/keep_out_logic.js` | `isKeepOutArea` also true for kind pen and for animals with a gate; `leaveText` names the kind |
| `src/agent/modes.js` | the reflex `area_sense`, added only when `area_sense` and `protected_areas` are on; idle only, never an action |
| `src/agent/commands/actions.js` | `!rememberArea` without a type: the enclosure scan, the kind, the P1 answer; with a type the owner's word; the same name with another type changes the kind; no border: the P1 text, nothing saved; mine as before |
| `src/agent/knowledge/knowledge_text.js`, `src/agent/agent.js` | `whereLine` reads `where.enclosure`; `enclosureLine`; `_enclosureHere(areas)` at most once per 10 s, only with protected areas on and no saved area holding the enclosure |
| `profiles/defaults/_default.json`, `tests/routing/sentences.json` | three examples and three sentences; the system lines of the home and pen examples carry the new answers |

### Decisions beyond the spec, accepted

| Decision | Why |
|---|---|
| A typed "building" counts as no type (the parser's default) | the tests pin the default; a barn with a bed is a home |
| An empty fenced enclosure with a gate is a yard, which the reflex enters | `kindOf` needs animals for a pen; the play test says: name the pen with its animals inside, or say "it's a pen" |
| Without a type and without a border nothing is saved | P1; a typed home or mine still gets the box of v0.1.4.10 |
| The scan floods the ground as `scanPen`, then with water as a border; ground with a roof over half, or a bot under a roof, is a building (`scanBuilding`, floors with `area_floors`); rock and hill dirt are no border | caves and hollows are no places |
| Thresholds: one border kind holds 2 of 3 of the border else "mixed"; tilled floor a third or more farmland; a roof half of the cells with a block 1 to 8 above; side-by-side open cells of a wall line are one gap | |
| Words beyond the spec: glass-walled, hedged, water-bound, enclosed (mixed); "crafting table", "water block"; openings listed as doors, gates, trapdoors, gaps; a double chest and a bed count once; barrels count as chests | |
| The P2 and P3 list: the roof first, then the contents, then the openings | fits both examples |
| A type changes the kind only when it differs; the same type scans again | |
| The knowledge line is gated by `knowledge_in_prompt` and protected areas, not by `area_sense` | the line is a correction |
| `!setArea` on an existing name does not change the kind (P1 said it would) | dropped by the lead: `!rememberArea(name, type)` does it |

## From part N (the navigation, E4), done in round 3

### Exports and context

| File | What |
|---|---|
| `src/agent/packs/routes/waypoints.js` (new) | `waypointsOf`, `nearestWaypoint`, `planHops`, `walkWaypoints`, `pickRoute`, `walkByWaypoints`, `isOpenableWaypoint`, `WAYPOINT_RULES`, `WAYPOINT_KINDS` (with `walk` for a walk end in the middle of a route; `name` the route, `block` the openable's block). A hop: `GoalNear` 1, the walk's own movements (no digging, doors allowed), at most 60 s; the whole walk at most 5 minutes; the openables of a hop are reserved before it and released when the walk ends; a failed hop gives `cause` as I1. Openables are not hop goals: they are reserved and passed; under a trapdoor the top of a ladder is its highest rung. A bot already past the nearest waypoint starts at the next one. |
| `src/agent/packs/routes/dry_scan.js` (new) | `dryScan`, `noWayText`, `waypointLabel`, `DRY_SCAN_RULES`; the N1 texts; `getPathFromTo` hop by hop (`getPathTo` for the first), each hop bounded at 24 blocks plus 2 per block and 2 s; a search that times out counts as open; labels `the top of the ladder at`, `the foot of the ladder at`, `the room at`, `the tunnel at`, `the start of / the end of the route "x" at`, a bare position for a walk point; returns also `total` and `text` |
| `src/agent/packs/routes/index.js` | re-exports the above plus `causeText`, `legCause`, `bySearch`; `bindRoutes` gives `bySearch()`, `waypointsOf`, `nearestWaypoint`, `walkWaypoints(bot, waypoints, options)`, `dryScan(bot, waypoints, options)`; with the setting on `walkTo` scans then walks the waypoints and `routeFor` picks by waypoints; off, as before |
| `src/agent/packs/mining/mine_way.js` | `bySearchOn`, `mineWaypoints`; with the setting on `wayIn` and `wayOut` scan then walk the waypoints, a child mine uses the parent's waypoints plus its shaft (`toParent`: only its shaft), `walkBack` walks by the path search first and falls back to the old hops with digging |
| `src/agent/packs/home/door_logic.js` | `DoorWatch.reserve`, `release`, `isReserved`, `reservedCount`; `reserveMaxMs` 20000, `reserveNear` 1.5; `observe` never returns a reserved openable (not before the time runs out, and afterwards not while the bot is within 1.5 blocks, until released) |
| `src/agent/packs/home/doors.js` | `canOpen(bot, pos)` (no for iron, a closed powered door, a block filling the cell before or behind a door or gate, a block on a trapdoor); the service has `reserve(door, ms)` and `release(door)`; `reserveDoor`, `releaseDoor` reach the running service of a bot |
| `src/agent/library/skills.js` | `goToPlayer`, `followPlayer`: no digging, never the destructive line; a bounded search (48 blocks, 3 s) with no way gives the N2 text; `followPlayer` asks again at most every 5 s after standing still 3 s away from the player; the cave rule; `walkWatchingLadders` got an optional `walk` parameter |
| `src/agent/agent.js` (the lead) | `homeContext().doors = { reserve, release }` on the door service (I8) |
| `src/agent/packs/home/shelter.js`, `sleep.js` (the lead) | with `routes_by_search` a learned route into the building, to the place "home" or to the bed goes first, after its dry scan; its failure text ends the walk |

### Decisions beyond the spec, accepted

| Decision | Why |
|---|---|
| The reservation rule of 1.5 blocks covers reserved openables only | the pen gate rule of v0.1.4.10 (closed as soon as the feet leave the cell) stays |
| A path that needs more than 48 blocks of detour to the player is "no way" | the player is near |
| The cave rule needs a natural ceiling within 24 blocks and no saved area; the goal inside the cave means the player stands under rock too; no stop when the walk starts in a cave; after a stop a new walk within 16 blocks and 10 minutes passes the cave | an open meadow is no cave; "go on" works |
| Mines the bot dug itself go down through `descendToLevel` as before, without waypoints | the spec names `wayIn`, `wayOut`, `walkBack` |
| From a tunnel `!leaveMine` runs `walkBack` before the dry scan of the route | the walk back is inside the tunnel |

## The fix rounds (the lead, E4, E2), after the journeys on the real server

| Finding | What changed |
|---|---|
| T3-1, F5, F9 | `goToPlayer` and `followPlayer` (skills.js): the search may think 10 s and has no cap on the length; a long way is walked in rounds along the partial path; where the search ends without a way the bot opens the closed doors and gates within 4 blocks that lie closer to the player and searches again; then the ladder step of v0.1.4.9 toward the player (missing ladders placed); the N2 text only when nothing brings it nearer |
| F1, F6, F13 | `waypoints.js`, `dry_scan.js`, `replay.js`: a ladder hop walks to the standing cell and climbs by `ladderLeg` (exported, with `way` 'up' or 'down'); the scan checks a climb with `ladderCheck` (the column intact for the direction, or the ladders carried) and the trapdoor of the column in both directions with `canOpen`; two columns in one line are two climbs; a dug-away foot is never a goal; a hole under a ladder is bridged (`holeUnder`, `bridgeHole`); the gap text `... the ladder has a gap of 2 at y 42 and I have no ladders.` / `and I have only 1 ladder.` |
| F7, F10 | `mine_way.js` `mineWaypoints`: the parent's waypoints in or over the child's shaft are dropped, the room sits in route order, the walk ends at the waypoint nearest the goal; `standCell` aims a hop beside an open shaft top; the scan covers the hops to the goal only, passes an openable `canOpen` accepts, answers within 10 s, skips a hop of zero length |
| F8 | `waypoints.js`: the closed doors and gates a hop passes are opened when a hand reaches them (4.5 blocks); after a failure at a closed door the bot walks to it, opens it and tries once more; one half of a double door is enough |
| F11 | `ladder.js` (mining pack): `slideDown` starting inside the column releases the controls of the hold and looks at the wall |
| F12 | `door_logic.js` `DoorWatch.release(door, { passed })`, `doors.js` `release`, `releaseDoor`, the glue `homeContext().doors.release(door, options)`: a released reservation of a passed openable counts as a pass; `walkWaypoints` closes the openables it went through (with the other half of a double door) once the bot is out of the cell and 1 block past |
| F14 | `mine_logic.js` `wayCells(mine)`, `shaftCellFree(p, way)`, `insideShaft(..., { mine })` with `moved` and the reason `no_cell`; `mining.js` says `TEXTS.noShaftCell` |
| F2, F3 | `door_logic.js`, `doors.js` `occupiedBy`: a click sets the gate seen closed; a gate of a pen the bot opened while walking is closed 2 blocks past it; a gate is held only by an entity in its cell. `skills.js` `tossItems`: the give says nothing but the W5 texts |

## For part N (round 3)

- `routes/index.js` does not re-export `causeText` or `legCause`: add them with the waypoint exports.
  `walkWaypoints` keeps `cause` (I1) so that W1 texts stay the same.
- `mine_way.js` of part M: `wayIn`, `wayOut`, `walkBack` and the child routes (`parent`, the shaft legs)
  are the places where the waypoint walk goes behind `routes_by_search`; a child's way is the parent's
  waypoints plus the shaft.
- `goToSurface` of skills.js calls `ctx.mining?.climbToSurface`; N's player walks (`goToPlayer`,
  `followPlayer`) live in the same file: change only those two functions.
