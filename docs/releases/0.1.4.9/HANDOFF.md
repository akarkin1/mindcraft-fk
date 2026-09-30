# Handoff notes of v0.1.4.9

What the parts that are done give to the parts that follow. Written by the tech lead from the reports.
Where this text and the spec disagree, this text wins.

## For everybody

- Node 22 in the cloud; on the owner's machine every node command runs through
  `fnm exec --using=v20.20.2 -- node ...`.
- A test file must end by itself: no timer, interval or listener may stay open. The trail's interval is
  `unref()`ed and `stop()` clears it.
- The test server of this container: `MC_TEST_SERVER_DIR=/home/user/mc-test-server`,
  `MC_TEST_JAVA=/usr/bin/java`, and `JAVA_TOOL_OPTIONS` unset for the runner
  (`env -u JAVA_TOOL_OPTIONS MC_TEST_SERVER_DIR=... MC_TEST_JAVA=... node tests/world/run.js <name>`).

## From part C (library, guard, knowledge, E3), done in round 1

### Exports

- `src/agent/library/ore_sight_logic.js`, pure: `oreInSight(getName, pos, range = 0, dug = null)`,
  `isOreName(name)`, `oreKind(name)` (`deepslate_iron_ore` gives `iron`), `sightRange(value)` (0..3,
  invalid is 0), `outOfSightText(blockType, { ore, near, mining })`, `OPEN_NAMES`, `MAX_SIGHT_RANGE`,
  `SIGHT_TEXT_DISTANCE`, `MINING_ORES`.
- `collectBlock` of `skills.js`: an ore out of sight is no candidate. When every candidate is out of
  sight and nothing was dug, the text of C1 is the whole answer and the result is `false`. When
  something was dug first, the output is the C1 text and then the result line
  (`I broke 1 iron_ore and got 1 raw_iron.`). The long text of C1 comes only with `mining_pack` on,
  a hidden ore within 16 blocks, and an ore the pack mines. The signature is unchanged.
- `skills.js` reads `ore_sense_range` from `src/agent/settings.js` first (what the world tests and
  the mind server set), then from the file `settings.js`.
- `src/agent/dig_request_logic.js`, pure: `isDiggingRequest(text)` returns `{ digging, words }`, the
  words in lower case, hyphen and underscore read as a space; `digRefusalText(commands)` (commands with
  or without `!`, order !mineOre, !rememberTunnel, !collectBlocks); `DIGGING_COMMANDS`, `DIG_WORDS`,
  `DIG_ORES`, `ORE_VERBS`. An ore name counts only followed by `ore`, or within 3 words after find,
  get, collect, gather, search, look, bring, fetch, need, want, hunt, mine. "craft an iron pickaxe" is
  no digging request; "get me some iron" is.
- `knowledge_text.js`: `whereLine(where)` with `where.mine = { name, tunnel, level }` (tunnel counted
  from 1; `null` gives "on its way in"); new `passedOreLine(mines)`; in the output the ore line comes
  after the mines and before the places, in the cut after the mines and before the chests. A mine of
  the player is shown by its name in the mines line (`"mine", entrance (30, 60, 4), level 25`), a mine
  of the bot as before. A mine without a name: "in a mine" and "in the mine at (x, y, z)".
- `where_am_i.js`: `whereAmI(bot, now = Date.now(), extra = {})` returns `{ area, depth, underground, mine }`;
  `underground` is also true when `extra.mine` is not null.

### Decisions of the tech lead

- The order of the ore line is by value: diamond, redstone, gold, lapis, iron, copper, coal, then
  other kinds by name. (The example of the spec could not come from "most first".)
- `ore_sense_range` 0 is the default and changes `!collectBlocks` for ore also with every switch off:
  ore inside the rock is no longer dug to. That is a decision of the owner and goes into the
  changelog. W74 (flags off) expects it.

### For part G (glue, E5)

1. `agent.whereAmI` passes `{ mine: { name, tunnel, level } }` from `mineAt`; `level` is the tunnel's
   level when there is a tunnel.
2. With `mine_routes` off, strip `passed` from the mines before `knowledgeText`, so that old entries do
   not show after the switch went off.
3. `!newAction`: build the command list for `digRefusalText` from what is on: `!mineOre` needs
   `mining_pack`, `!rememberTunnel` the effective `mine_routes`, `!collectBlocks` always; none may be
   in `blocked_actions`. Import `dig_request_logic.js` statically; it exists.
4. `ore_sense_range` in `settings_spec.json` as a number, 0 or 3.

### For the testers

- Words of `isDiggingRequest` come back normalised (`iron_ore` as `iron ore`).
- W70: the output is the C1 text, then the result line. W69 and W70 set the range through the agent
  settings. With the owner's switches (mining pack on) W70 gets the long text.
- Corrected old tests: `sta_ground`, `st_reflex_logic`, `stg_agent` (only `mine: null` added).

## From part A (routes pack, E1), done in round 1

### Exports (`src/agent/packs/routes/index.js`, no side effects on import)

- `trail_logic.js`, pure: `TRAIL_RULES`, `feetCell`, `sameCell`, `cellBetween`, `mayStep`, `isOpenSky`,
  `columnIsOpen(getBlock, cell, scan = 64)`, `viaOf(getBlock, feet, last)`, `isJump`, `nextStep(last, { pos, onGround, inWater, t }, getBlock)`, `cleanStep`.
- `route_logic.js`, pure, exactly I2: `routeFromSteps(steps, { maxHop = 12, faceAt })`, `routeStart(steps, known)`,
  `skyStart(steps)`, `reverseRoute`, `routeEnds`, `legCells`, `nearestRoute(routes, target, botPos, { range = 4, reach = 32 })`.
  Extra: `knownThings({ places, areas, mines })`, `startOffLadder`, `trapdoorOverLadder`, `legCounts`,
  `cleanLeg`, `nearCell`, `normalizeRouteName`, `ROUTE_RULES`.
- `route_store.js`: `RouteStore(filePath|null, { now })` with `load`, `set` (returns `null` for an
  invalid route, never throws), `get`, `list`, `remove`, `size`; `ROUTE_FILE`, `ROUTE_SOURCES`, `START_KINDS`.
- `trail.js` (I1): `createTrail(bot, ctx, { file, maxSteps, intervalMs, saveMs, now, wait })` returns
  `{ start, stop, tick, list, clear, size, running, file, maxSteps }`. The file is read at creation.
- `replay.js` (I3): `walkRoute(bot, ctx, route, { reverse, clock, deadline, timeoutMs = 120000 })`
  returns `{ ok, reason, text, leg, at }`; reasons also `time`. `walkByRoute(bot, ctx, routes, target, options)`,
  `ladderIntact(bot, leg, maxGap = 0)`, `REPLAY_RULES`.
- `bindRoutes(bot, ctx, store, trail)` returns `{ store, trail, walkRoute, walkTo, routeFor, logic }`
  (I4); `logic.routeFromSteps` reads the ladder facing from the world of the bot; `logic.skyStart`.
- `rememberRoute(bot, ctx, name, options)` is **synchronous**, returns `{ ok, reason, text, route }`.
  `routesText(ctx|store, dimension)` returns a **string**. `forgetRoute(ctx|store, name, dimension)`
  returns `{ ok, reason, text }`, reason `unknown` when there is no such route. `savedPlaces(ctx, dimension)`.

### Behaviour that the spec did not fix, decided by E1 and accepted

- **The `face` of a ladder leg is the ladder block's own `facing`**, the wall behind it, as `ladder.js`
  has always read it. The spec's "opposite the facing" was wrong. Part B builds its cells without
  `face`, so nothing changes there.
- A sky light of 0 counts as missing (sections without light data), then the column of 64 blocks decides.
- The trail restarts on a jump of more than 16 blocks sideways or up (teleport, respawn) and on a
  dimension change. The trail file has a top-level `dimension`.
- A trapdoor door leg is made only when the trail crosses the trapdoor's height. The ladder leg handles a
  closed trapdoor at the top of its column itself: down, it opens it from above; up, it climbs to
  within 2.5 blocks, holds with sneak, opens it, climbs out. The door service closes it behind the bot.
- A ladder column is entered only when its ladders are in place: down, at most 2 missing in a row; up,
  none. So a broken ladder fails before the trapdoor is opened and the bot does not fall.
- `rememberRoute` moves a start that lies half way up a ladder back to the foot of the ladder.
- A walk leg is at most 12 blocks from its start and covers at most 24 blocks of trail.
- `nearestRoute` accepts a box as target (the shelter hook). `walkTo` walks to the route's start
  first and, after the route, to within 1 block of a point target.
- Routes store `from.kind`; `leg` in a result is the index in the order walked.
- Texts beyond the spec: `The time for the route "bed" ran out at step 3 of 7, at (x, y, z).`,
  `I followed the route "bed", 7 steps.`, `The route "bed" has no steps.`,
  `I found no way to the start of the route "bed" at (x, y, z).`
- Mines as known things for `routeStart`: within 2 blocks of the room's center, chest, table, furnace or
  base. A mine of the bot without a name is named `level N`.

### The hooks of I5 (done)

- `sleep.js`: after `walkNear` to a bed fails, `ctx?.routes?.walkTo?.(bot, bed, { clock })`; interrupted
  returns at once with the route's text; another failure of the route becomes the final text when no
  bed works.
- `shelter.js`: after `enterBuilding` fails with `no_path`, the route to the area box; when it arrives,
  `walkToRoom` when inside, else `enterBuilding` again. In `walkToHomePlace` the route comes after the
  door attempts and before the digging; a failed route digs nothing and returns its text.

### For part G (glue, E5)

1. `bindRoutes(bot, ctx, store, trail)` never reads `ctx.routes`, so it can be built inside
   `homeContext()`; cache it per world.
2. `createTrail(bot, ctx, { file: world_memory ? <worldDir>/trail.json : null, maxSteps: settings.trail_max_steps })`,
   `start()` at spawn, `stop()` on a world change and in `cleanKill`.
3. `!routes` gets a string; `rememberRoute` is synchronous; `!goToRememberedPlace` calls
   `ctx.routes?.walkTo?.(bot, place)` when the walk did not arrive.
4. `tests/unit/glue2_flags_off.test.js` knows the routes pack now (done by the tech lead).

### For the testers

- A `/tp` of more than 16 blocks empties the trail: W61 and W65 must walk after any teleport (the cell
  by cell moves on the ladder are within 16 blocks).
- W64 fails at the ladder leg (step 3 of 4 in the fake geometry of the unit tests).
- The climb out through an open trapdoor is proven only on the real server (W62, W63): the fake bot has
  no climbable-trapdoor rule.

## State of the unit tests

After parts A and C: E1 reports `npm test` with 5474 tests, 1 failure (the pack list, corrected).
