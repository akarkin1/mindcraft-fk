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

## From part B (mine, E2), done in round 1

### Exports (`src/agent/packs/mining/index.js`)

- `ore_table.js`: every row has `min` and `max` (B4). Old fields unchanged.
- `mine_logic.js`, pure: I6 as named (`mineAt` returns `{ mine, tunnel, onRoute }` with `tunnel` an
  index **from 0**; `measureTunnel` also returns `dir`; `branchPlan` returns
  `{ at, side, dir, junction, start, end, length, done, index }`). Also `legCells`, `legEnd`,
  `tunnelsOf(mine)` (a mine of the bot shows its one tunnel here), `tunnelCells`, `branchCells`,
  `roomBox`, `nearestLeg`, `mineDistance`, `tunnelDirection(dirs, feet, { yaw, anchor })`, `isCorridor`,
  `veinParts` (`take`, `lava`, `beyond`), `cleanPassedEntry`, `addPassedEntry`, `removePassedAt`,
  `senseOres`, `senseCut`; constants `BRANCH_FROM` 32, `BRANCH_EVERY` 4, `BRANCH_LENGTH` 8,
  `PASSED_REASONS`, `MAX_PASSED` 200, `CORRIDOR_LIMIT`, `MAX_SENSE_RANGE`. `tunnelView` takes a fifth
  argument `senseRange = 0`.
- `mine_store.js`: `mineKey(mine)`, `cleanMineName`, `DOOR_KINDS`, `NEAREST_RANGE`; methods
  `byName(name, dim)`, `nearest(pos, dim, range = 64)`, `within(pos, dim, range)`, `addPassed(key, entry)`,
  `removePassed(key, pos)` (both return a copy of the mine or null; `key` is the key or the mine).
  `get` and `atLevel` return only mines of the bot. `remove` also takes a name. A mine has a new
  field `area` (the name of the mine area at the tunnel end, or null).
- `texts.js`: `rememberMineText`, `wayWords`, `noEntranceText`, `rememberTunnelText`, `noTunnelText`,
  `passedText`, `collectPassedText`, `mineLabel`; `TEXTS.noTrail`, `noMineHere`, `noCorridor`, `noRouteWalk`.
- `mine_way.js`: `mineRoutesOn(ctx)`, `senseRangeOf(ctx)` (only `makeJob` calls them), `chooseMine`,
  `wayIn`, `wayOut`, `walksRoute`, `hasDoorLeg`, `routeEndOf`, `minesOf`, `MINE_RANGE`.
- `mine_player.js`: `rememberMine(bot, ctx, name = 'mine', { playerYaw })`,
  `rememberTunnel(bot, ctx, name = '', { playerYaw })`, `collectPassedOre(bot, ctx, ore, count = 8, opts)`,
  `findRoom`. The first two return promises.
- `mining.js`: `digTunnel` options `tunnel`, `branch`, `line`; result fields `left`, `line`;
  `prepareMiningTrip` options `level`, `wayDownTo`, `hasBase`; new exports `takePassedOre`, `BRANCH_BLOCKED`.

### Behaviour decided by E2 and accepted

- **The tunnel of the test base runs south** (+z is south). The example texts of the spec said north;
  the scenarios expect south.
- The room is searched within 6 blocks of the bot and of every step of the way in, from the last
  step backwards. Its center is the feet of the bot when the room is near, else the step nearest to
  the room's blocks.
- The direction of a tunnel: both ends of a corridor are candidates; the yaw of the player decides
  within 60 degrees; else the tunnel points away from the room (or the entrance). An open run in a
  room counts as a tunnel only when every cell has at most 2 open neighbours.
- The mine for an ore: the nearest within 64 blocks that has a fitting tunnel. The `no_tunnel` text
  comes only when none fits and a mine of the player is in reach; `!mineOre(ore, n, true)` still digs a
  new mine.
- With `mine_routes` on, `digTunnel` also looks at the walls, ceiling and floor of the end cell when it
  starts (W68). Ore beside the tunnel that the pickaxe cannot harvest is not dug; it is listed with
  reason `pickaxe` (v0.1.4.8 destroyed it). Blocks ahead are always dug.
- A cut through the floor (sense range) is dug from the cell behind the bot and closed again. Cuts into
  the walls and the ceiling stay open.
- A branch is done at 8 blocks, or when blocked, forbidden by an area, unknown or stuck; the trip goes on.
- A second `rememberMine` with the same name keeps the old tunnels and the ore list when the new
  entrance is within 64 blocks of the old one.
- `collectPassedOre("")` or `("all")` takes every ore. It walks in and out when it starts outside the
  mine; it stays when it starts in the room or a tunnel.
- Texts beyond the spec: `It is in the area "x".` (appended to the text of `rememberMine`);
  `It has no tunnel yet.` and `Its tunnels are at levels 40 and 25.` (for `no_tunnel`);
  `I am in the mine "mine".` (`goToMine`); `The room of the mine has no chest.`
- Known limit: a mine named with a number (`"16"`) collides with the key of a mine of the bot at that level.
- `walkRoute` is called with the deadline of the trip; its reason `time` is reported as `no_path`.

### For part G (glue, E5)

1. `!rememberMine(name)` calls `pack.rememberMine(bot, ctx, name, { playerYaw })`;
   `!rememberTunnel(name)` calls `pack.rememberTunnel(bot, ctx, name, { playerYaw })`;
   `!collectPassedOre(ore, num)` calls `pack.collectPassedOre(bot, ctx, ore, num)`.
2. I7: `const at = pack.mineAt(mines.list(dim), pos)`; `extra.mine = at ? { name: at.mine.name, tunnel: at.tunnel, level: at.tunnel !== null ? pack.tunnelsOf(at.mine)[at.tunnel].level : at.mine.level, onRoute: at.onRoute } : null`.
   `tunnel` stays from 0; `whereLine` of part C adds 1.

### For the testers

- W65 and W66 expect "south". W65's text ends with `It is in the area "..."` when a mine area covers the
  tunnel end. `tunnelsOf` lives in `mine_logic.js`.
- Entries of `passed` are `{ ore: 'gold', x, y, z, reason, seen }` (`seen` an ISO time). Mine names are
  stored trimmed, lower case, spaces as `_`.

## From parts D and E (model comparison, test server, E4), done in round 2

- `new GPT(model, url, params, { client })` for tests. Usage is reported after every successful
  request (I9); a cut-off chat completion is reported too, and the retry. Embeddings are reported under
  the purpose of the caller (`other` in practice; there is no embedding purpose).
- `routing_check.js`: `--profile`, `--model`; exports `DEFAULT_PROFILE`, `API_KEYS`, `apiOf`, `withModel`,
  `keyFor`, `placeholderKeys`, `timeStats`; `parseArgs` returns `profile`, `model`, `missing`;
  `summaryLine(passed, total, { times, cost })`. The dry run uses no embedding model. The real run sets
  placeholder keys for the code and vision models whose key is missing (they are never called). The
  time per answer counts non-error answers, summed over the retries of one sentence.
- `test-routing.ps1 -Model <id> -Profile <path>`: loads the key of the chat model's api, and the other
  key too when the secret exists. Not run here (no PowerShell).
- `profiles/gpt.json` as D4. **The prompter makes the code model at the start and `getKey` throws
  when its key is missing**, so the gpt bot does not start without `ANTHROPIC_API_KEY`;
  `start-gpt.ps1` loads both keys.
- `tests/routing/commands.js`: `partIsOn(settings, 'mine_routes')` is the effective switch (all three
  on). The six new commands are in `SPEC_COMMANDS`.
- `scripts/get_test_server.js`: `main(argv, deps)`; `scripts/get_test_server_logic.js`: `parseArgs`,
  `pickVersion`, `serverDownload`, `defaultDir(platform, env, home?)`, `eulaText(date)`, `eulaAccepted(text)`,
  the constants. Proven once against Mojang: 57,555,044 bytes, SHA-1 checked.
- `tests/world/mc_server.js`: `locateServer(env, platform)` shares `defaultDir`; `serverEnv(env)` starts
  the server without `JAVA_TOOL_OPTIONS`. Unsetting it by hand is no longer needed. The cloud still
  needs `MC_TEST_JAVA=/usr/bin/java` and `MC_TEST_SERVER_DIR`.

## From part G (glue, E5), done in round 2

- Settings as section 2; `settings_spec.json` has `ore_sense_range` as a number with options `[0, 3]`.
- `mineRoutesOn()` exported by `actions.js` (all three switches, `mine_routes` exactly `true`) and used
  by `agent.js`. Off texts: `The routes pack is off.` and
  `The mine routes are off. They need mine_routes, mining_pack and routes_pack.`
- The trail: `<worldDir>/trail.json`, started at spawn, stopped and restarted on a world change,
  stopped in `_atExit`. `homeContext().routes` is bound per world, null when off.
- `whereAmI()` passes `extra.mine = { name, tunnel (from 0), level, onRoute }`; the knowledge block
  drops `passed` when mine routes are off.
- **`!rememberRoute`, `!routes`, `!forgetRoute`, `!rememberMine`, `!rememberTunnel` are plain commands**
  (`runPlain`): no action, no pause of `unstuck`, a running `!followPlayer` keeps running. Their text is
  recorded for `say_results` and the repeat guard. A pack that throws gives
  `The <name> pack failed: <message>`. Only `!collectPassedOre` is an action through `runPack`.
- `!goToRememberedPlace` tries a route only when the bot is still more than 2 blocks from the place
  after the path search; it pauses `unstuck` for it and writes the text of the route
  (`I followed the route "x", N steps.`).
- `!newAction` with `skills_over_code`: the check of the `prompt` and of the last message of a player
  (the `name:` prefix stripped) runs before the cost check; the command list drops what the agent hides.
- Prompt: 16,883 characters with every switch on, 9,743 with every switch off. Descriptions of
  `!getCraftingPlan`, `!modes`, `!searchForBlock`, `!searchForEntity`, `!moveAway`, `!placeHere`,
  `!digDown`, `!endGoal`, `!goToSurface`, `!lookAtPlayer`, `!useOn`, `!setMode` and some parameter
  texts were shortened; no meaning changed.
- 18 new sentences in the routing list; "this is the mine" expects `!rememberArea` or `!rememberMine`.
- `action_manager.js` now imports `assert` (the resume of `!followPlayer` used a global that only the
  sandbox lockdown supplies). Corrected by the tech lead.

## After the fix rounds (T1 and the real server)

- A ladder leg has `foot` (the cell beside the column at the bottom) as it has `entry` (the top). Walk
  legs end at `foot` or `entry`, never in a column. `ladder.js` exports `footOf(bot, leg)` and
  `enterColumn(bot, leg, options)`; `climbUp` uses `enterColumn`; `followUp` skips its walk when the
  leg has a `foot`. The mine store keeps `foot`.
- `climbUp` has a second way out at the top (`jumpOut`): after 1.5 s without rising, jump and hold
  forward towards the entry for 1 s, up to 3 times, then the path search.
- `patches/prismarine-physics+1.10.0.patch`: `climbableTrapdoor` and `climbUsingJump` for 1.21, the
  bamboo, pale oak and copper trapdoors in the set. `rta_physics_patch.test.js` proves it by behaviour.
- The trail: `sky` is `columnIsOpen` (64 blocks) and not on a ladder and 2 of 4 neighbours at head
  height open; the light is never read. `viaOf` looks at every cell on the line between two steps
  (`lineCells`); the interval is 100 ms (`TRAIL_RULES`).
- The legs follow the order of the trail (down: walk, door, ladder, walk); a door leg ends past the
  openable; `too_short` when fewer than 2 steps since the known place.
- `tunnelDirection` ignores a yaw that points towards the anchor; `rememberTunnel` needs a corridor of
  4 cells (`MIN_TUNNEL_CELLS`) with at most 2 open neighbours per cell (`corridorTunnel`, shared with
  `rememberMine`).
- `!goToRememberedPlace`: `routeFirst` walks a route (when `routeFor` finds one) before the path search,
  with `unstuck` paused; a failed route is the whole answer. `collectWork` decides ore in sight with
  `oreInSight` and `sightRange`; underground it never goes to `!mineOre`.

## From part L (the follow down a ladder, E3), the fix after the play test

- `src/agent/library/ladder_logic.js`, pure: `ladderColumnAt(getName, feet, { reach = 2, maxHeight = 64 })`
  (`getName` may return a name or `{ name, facing }`; the facing is guessed at every cell of the column
  when the block gives none), `ladderWay(column, feet, target)`, `heightWay`, `entryOf`, `ladderPlace`,
  `wallYaw`, `LADDER_RULES`.
- `src/agent/library/ladder_pass.js`: `passLadder(bot, column, way, { clock, timeoutMs = 30000 })`
  returns `{ ok, reason, text }`, reasons `no_column`, `no_path`, `no_foot`, `no_floor`, `blocked_door`,
  `stuck`, `timeout`, `interrupted`, `no_module`, `error`. It loads the ladder module of the mining pack
  with a dynamic `import()` of a computed URL on the first pass (the flags-off test forbids a literal
  pack import outside `agent.js`). Also `columnNear(bot)`, `ladderReader(bot)`, `passText`, `PASS_RULES`.
- `followPlayer`: its own 3 s timer for the ladder step (the existing `stuck_since` restarts while the
  player is within 6 blocks); down only while the bot is above the bottom of the column, up only while
  below the top; at most 3 passes per sliding minute; a failed text once. `goToPlayer`: the pass by
  the height rule, then the path search. Down is refused with `no_floor` when there is air under the
  column. The texts name the cell of the trapdoor, or the top ladder without one.
- `agent.js` line 1276: an action whose result is `undefined` prints `and was stopped.`
- Tests read no switch from `settings.js` any more: the prompt-size tests and `rtc_collect_sight` pin
  what they measure (the owner's `settings.js` on `main` has every pack on).

## From the journey scenarios (the fix round F31 to F33)

- `packs/mining/mining.js`: `tripKeep(bot, extra)` is the keep plan of `depositAtBase` (torches, ladders,
  pickaxes all; food up to `TRIP_FOOD_KEEP` 16; fillers up to `TRIP_FILLER_KEEP` 32, cobblestone first; one
  chest; `extra` adds). `mine_logic.js`: `torchDue(getName, feet, dir, every = 8)` and `TORCH_NAMES`;
  `digTunnel` places by it with `mine_routes`, every 8 steps without.
- `packs/wood/tools.js`: `craftSupplies` crafts what the inventory gives, gathers the rest (known chests
  through `ctx.storage.fetchItem`, then trees), crafts again, up to 6 rounds. Its success text is
  `I made 32 torches.` for every supply (was `I crafted 9 ladder.`); `count` is what was made.
  `wood/texts.js`: `madeSuppliesText`, `supplyWords`.
- `packs/storage/storage.js`: `recordChest(ctx, pos, items, options)` updates the chest index from a list
  or counts by name; exported from the pack. `!viewChest` parses its own output (`viewedChest(output)` in
  `commands/actions.js`) and records the chest while the storage pack is on.
- `library/ladder_pass.js`: `ladderWayTowards(bot, target, { reach, height })` gives the column and the
  way or null; `ladderStepTowards` uses it. `library/skills.js`: `walkWatchingLadders(bot, makeGoal,
  target, passes, after)` wraps the path search of `goToPlayer` and `goToPosition`: still in its cell
  for 3 s with the target 2 or more blocks above or below and a column near, `setGoal(null)`, the ladder
  step, the path search again; at most 3 passes a minute per call.

## State of the unit tests

After parts A, B and C: E2 reports `npm test` with 5476 tests, 1 failure (the pack list, corrected by
the tech lead). After parts D, E and G: E5 reports 5965 tests, 2 failures, both in the tester's files
against part A (`rt_route_logic` trapdoor leg, `rt_routes_pack` `too_short`). After the tester T1:
6041 tests, 8 failures (T1-1 to T1-5). After both fix rounds: 6078 tests, 0 failures, 1 skipped
(Windows only). End-to-end: 17 of 17. After the fix of the follow and the journeys: 6202 tests, 0 failures.
