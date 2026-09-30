# Handoff notes of v0.1.4.8

What the parts that are done give to the parts that follow. Written by the tech lead from the reports.
Where this text and the spec disagree, this text wins.

## For everybody: Node 20

The shell has Node 24. The owner plays with Node 20.20.2. Under Node 24 about 24 test entries fail only
because of the environment. Run everything through fnm, in the work folder:

```
fnm exec --using=v20.20.2 -- node --test tests/unit/<file>
fnm exec --using=v20.20.2 -- npm test
```

A test file must end by itself: no timer and no interval may stay open. `tests/unit/unstuck_timer.test.js`
hung in full runs while part A was in work.

## From part B (library, E2), done in round 1

### Exports

- `skills.pickUpItems(bot, name = '', range = 16) -> Promise<boolean>`: true when the inventory gained
  something. Items within the range, nearest first, never digs, waits 2.5 s at an item for the pick-up
  delay, 2 tries per item, 60 s in all. Texts: `I picked up 8 oak_fence, 1 oak_fence_gate.`,
  `I see no items on the ground within 16 blocks.`, `I see no oak_fence on the ground within 16 blocks.`,
  `I could not pick up 3 items: stick.`, `I was stopped before I picked up 1 item: oak_fence.`,
  `I picked up nothing. The items are no longer there.`
- `skills.discard(bot, itemName, num = -1, walkAway = 0)`: with `walkAway` the bot walks away first, at
  most 3 s, never digs, and tosses where it stands when the walk fails.
- `skills.goToGoal(bot, goal)` resolves false when interrupted. It no longer throws for an interrupt.
- `skills.collectBlock` returns true when the inventory gained something. Texts: `Collected 3 oak_log.`,
  `I broke 10 tall_grass and got nothing. tall_grass drops nothing without shears.`,
  `I broke 2 iron_ore and got 2 raw_iron.` When every candidate is refused, the text of the refusal is
  the whole output.
- `skills.goToPosition` texts: `You have reached (x, y, z).` or `I stopped at (x, y, z), N blocks from the goal.`
- `skills.viewChest` prints one line: `The chest at (x, y, z) contains: leaf_litter 104, cobblestone 81, ...`
  or `The chest at (x, y, z) is empty.` A double chest gives up to about 1,100 characters.
- `skills.smeltItem` first takes out what lay in the output slot: `Took 4 iron_ingot that was already in the furnace.`
- `world.getOffhandItem(bot)`, `world.getOffhandText(bot)` (`In the off-hand: bread 6` or `''`),
  `world.getInventoryItem(bot, itemName)` (main inventory first, then the off-hand),
  `world.sumItemCounts(items)`, `world.getInventoryGain(before, after)`,
  `world.getNearbyItems(bot, itemName = '', maxDistance = 16)`.
- `world.getInventoryCounts` already counted slot 45 once and is unchanged. `bot.inventory.items()` and
  `findInventoryItem` skip slot 45: that was the root of "apple: 1" beside "I have no food."

### For part G (glue, E6)

1. `!inventory` (`queries.js`): add the line of `world.getOffhandText(bot)` when it is not empty, after the
   list of items and before WEARING.
2. `!discard`: replace `moveAway(5)` plus `discard` by `await skills.discard(agent.bot, item_name, num, 5)`.
   Walk back to the start only when the bot moved.
3. `!pickUpItems`: `runAsAction` that calls `skills.pickUpItems(agent.bot, item ?? '', range ?? 16)`.
4. `requestInterrupt`: set `bot.interrupt_code = true` BEFORE the new `setGoal(null)`, so a walk that gets
   GoalChanged sees the interrupt and ends quietly.

### For the testers

Texts that changed against v0.1.4.7: `You have reached at x, y, z.` is now `You have reached (x, y, z).`;
`Unable to reach ...` is now `I stopped at ...`; the output of `viewChest` is one line; `collectBlock` can
say `I broke ...`.

## From part D (areas, E4), done in round 1

### Exports

- `src/agent/areas/area_store.js`: `AREA_TYPES` (frozen, `['home','building','farm','pen','mine']`),
  `AREA_RULES` (the table D2 as data), `normalizeAreaName(name)`, `isShelterType(type)` (home only),
  `isDefendedType(type)`, `typeRank(type)`, `MIN_AREA_SIDE`, `canReplace(old, box, byPlayer) -> boolean`,
  `replaceRefusal(old, box, byPlayer) -> null | { reason: 'too_thin' | 'too_small', text }`,
  `store.areaAt(pos, dim)`. New source of an area: `'auto'`.
- `src/agent/areas/area_scan.js`: `scanFarm(get, origin, opts)`, `scanPen(get, origin, opts)`,
  `findFencedGroundNear(get, pos, range = 6, { type: 'farm' | 'pen' })` returns
  `{ found, reason, text, min, max, cells, entrances, gate, start, inside, ... }`, `scanText(reason, info)`.
  Every failure of a scan has `reason` and `text`. Extra reasons: `no_fence`, `no_crops`, `roofed`, `farmland`,
  `no_fence_near`, `not_closed`, `too_big`.
- `src/agent/areas/placed_store.js`: `PlacedStore(filePath, opts)` with `load()`, `add(pos, dim)`,
  `remove(pos, dim)`, `has(pos, dim)`, `flush()`, `size`, `list()`. A null path keeps it in memory only.
- `src/agent/areas/auto_home.js`: `autoHome(getBlock, places, store, botPos, { dimension }) -> { saved, reason, text }`.
  `places` may be the MemoryBank. The reasons `not_loaded` and `too_far` do not use up the one try.
  It also turns an existing area named `home` of type `building` into type `home`, without a scan.
- Guard view `bot.areaGuard`: `refusal(target, action, { name, item, sneaking, command }?)`,
  `areaAt(pos)`, `isBuilt(name)`, `placedByBot(pos)`, and all it had. `target` is a block or a position.
- Full guard `agent.area_guard`: `setPlayerOrder(isTypedFn, commandTextFn)`, `flushPlaced()`.
  `ProtectedAreaError` has `.reason`.

### Decisions of E4 that the tech lead accepts

- The one-time changes on load run only for a file without `migrated: 1`; every write sets it. `version` stays 1.
- A name "holds mine or mining" when the word starts with it: `iron_mine`, `mineshaft` yes, `jasmine_house` no.
- Where areas overlap: a farm decides first, then a mine, then the other types.
- In a mine a built block is refused with the reason `area`. A typed command does not open it;
  `!allowChanges` does; blocks the bot placed are free.
- The path search never gets the exception for orders typed by the player.
- The farm path rule of v0.1.4.7 stays (crops have cost 0).

### For part G (glue, E6)

1. `installAreaGuard(bot, { ...as today, protectBuiltBlocks: () => settings.protect_built_blocks ?? false,
   placed: () => this._placedStore(), getCommand: () => <text of the running command> })`.
2. Install the guard also when `protect_built_blocks` is on and `protected_areas` is off (store null).
3. `_placedStore()`: `new PlacedStore(<folder of the world>/placed.json)`, `load()` once per world, `flush()`
   when the world changes and in `cleanKill` (or `agent.area_guard.flushPlaced()`).
4. `agent.area_guard.setPlayerOrder(() => typedByPlayer, () => commandText)`.
5. At spawn, with `protected_areas`: `autoHome((x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name ?? null,
   this.memory_bank, this.area_store, bot.entity.position, { dimension: bot.game.dimension })`. Say `text`
   when it is not empty.
6. `actions.js`: import `AREA_TYPES`; update `AREA_TYPE_TEXT`; `!rememberArea` with `farm` or `pen` uses
   `findFencedGroundNear` with the type and returns its `text`; `!setArea` from the model checks
   `replaceRefusal`; `enterBuildingAround` also takes `home` and `pen`; `entrancesText` (also in
   `queries.js`) counts gates for pens.

### For part C (home pack, E3)

- `shelter_logic.js` (about line 45) and `creeper_logic.js` (about line 85) test `type === 'building'`.
  Use `isShelterType` and `isDefendedType` of `src/agent/areas/area_store.js`. Until then an area of type
  `home` is neither a shelter nor defended.

### For part B (library, E2), to check in the integration

- Pass the block itself to `refusal(block, 'break')`.
- In `placeBlock` pass `{ item: blockType }` to `refusal(pos, 'place', ...)`; without it the guard judges the
  item in the hand.

### For the testers

- The one-time changes of the areas file run only on a file without `migrated: 1`. A test must write a
  file of the old style to see them.
- The owner's areas file, loaded by a copy in a test: `farm`, one `mining_area` of type `mine` (the newer
  entry, with 2 doors), no pen.

## From part F (process, E7), done

### What is done

- F1: `patches/minecraft-protocol+1.62.0.patch`, two hunks in `src/client/chat.js` (the command packet and
  `chat_message` of 1.21.5 and later): the checksum is computed over the acknowledgements in the order of
  the window. Proven by code and test: the old code equals the reference for messages 1 to 20 and differs
  at 21; the patched client sends the reference after each of 25 messages. Still a hypothesis: that the
  server computes exactly this reference. Proof only in play: more than 21 signed messages of the player
  in one process without a kick. The shared `node_modules` of the work folder is patched.
- F2: `main.js` sets `MINDCRAFT_LAUNCH_ID` once; the agent processes inherit it; the cost meter adds up the
  sessions of the same launch for the limit per session and for `!cost`. The rate stays per process.
- F3: `src/agent/restart_context.js`. F4: `src/utils/log_time.js`, called in `main.js` and in
  `src/process/init_agent.js`. F5: `src/agent/repeat_guard.js`.

### For part G (glue, E6)

1. The settings file of the spec is `src/mindcraft/public/settings_spec.json`. The path in the spec
   (`src/agent/settings_spec.json`) is wrong.
2. Restart context: `import { writeExit, readExit, restartNote } from './restart_context.js'`.
   - `writeExit(dir, { reason, order, action, position, time })` returns a boolean, never throws.
   - `readExit(dir, maxAgeMs = 600000, now = Date.now)` returns an object or null, and always deletes the file.
   - `restartNote(exit)` returns a text, `''` when there is nothing to say.
   - `dir` is `./bots/${this.name}`.
   - In `cleanKill`, before `process.exit`, and in `onDisconnect`, with `restart_context` on:
     `writeExit(dir, { reason: msg, order: this.last_order, action: <label of the running action>,
     position: this.bot?.entity?.position, time: Date.now() })`.
   - `last_order.command` holds only the name of the command. Add `order.text` with the full text of the
     command, for example `!mineOre("iron", 8)`; `text` is preferred over `command`.
   - At spawn: `const note = restartNote(readExit(dir))`; when not empty, it goes into the init message.
3. Repeat guard: `new RepeatGuard({ limit: settings.repeat_guard })`; `check(name, args)` returns null or
   the text of the refusal; `record(name, args, result)`, `result` is a text or `{ message }`. In
   `executeCommand`: return the refusal without running the command. Commands typed by the player are
   recorded and never refused.
4. Cost meter: nothing to do. `log_time`: only the setting.
5. Known and not corrected: a deleted chat message (`hide_message`) resets the ring of the last seen
   messages in the library.

## From part A (reflex engine, E1), done

### Exports

- `src/agent/reflex/where_am_i.js`: `whereAmI(bot, now = Date.now()) -> { area: { name, type } | null, depth,
  underground }`, `areaAt(bot, pos)`, `blockNameReader(bot)`, `depthOfBot(bot, now)`.
- `src/agent/reflex/ground_logic.js`: `groundLevelAround(getBlockName, pos, top, bottom = top - 384)`,
  `depthUnderGround(...)`, `isUnderground(depth)`, `isGroundName(name)`, `GROUND_OFFSETS`.
- `src/agent/reflex/output_logic.js`: `MAX_OUT` (1500), `outputSummary(output, max)`, `stopperText(by)`.
- `src/utils/kill_timer.js`: `withTimeLimit(ms, fn, { until, pollMs } = {}) -> Promise<{ done, value?, error?,
  stopped? }>`, never rejects, `ms <= 0` means no limit. `withKillTimer` is unchanged.
- `bot.modes.noteProgress(reason)`.
- `ActionManager`: `stop(by)`, `noteStop(by)` (the first stopper counts), `command_serial`, and the result
  `{ success, message, interrupted, timedout, stopped_by }`. `by` is a label (`mode:x`, `action:x`) or a text
  (`!stop`, `a new message`). `stopped_by` can also be `the time limit` and `an interrupt`.
- The depth functions `depthUnderSurface` and `nightShelterWaits` of v0.1.4.7 are gone from `modes.js`.
- New mode `hunger`. It stands directly after `self_defense` (decision of the tech lead, the spec said
  after `self_preservation`). It shows in `getDocs` and `getMiniDocs`.

### Decisions of the tech lead

- `stuck_restart_after` = 1 is exactly v0.1.4.7: only the time limit of 10 s ends the process. With every
  other value the new rule of failure holds and the limit of the escape is 20 s.
- With an even number of columns the ground level is the lower of the two middle values.

### For part G (glue, E6)

1. `requestInterrupt(by)`: accept `by`, call `this.actions.noteStop?.(by)`, set `bot.interrupt_code = true`
   first, then `bot.pathfinder.setGoal(null)`.
2. `!stop` calls `agent.actions.stop('!stop')`. The path of a new message calls `stop('a new message')`.
3. `agent.whereAmI = () => whereAmI(this.bot)`, and `whereAmI` on the home context and the pack context.
4. Door service: `agent.door_service ??= createDoorService(bot, ctx)` at spawn (the mode creates it when it
   is `undefined`; `null` means there is none). `!closeDoor` uses the same object.
5. Settings that the modes read with defaults: `stuck_restart_after`, `flee_below_health`,
   `home_reflexes.hunger`.
6. The contract of `hungerStep`: the mode sets `state.now`, `state.idle`, `state.playerOrder`,
   `state.walk(fn)` before each call. `state.playerOrder` needs `agent.last_order`.

## From part C (home pack, E3), done

### Exports (`src/agent/packs/home/index.js`)

- `hungerStep(bot, ctx, state)` returns `{ action, reason, text, kind?, result? }`, never throws. It keeps its
  own notes in `state.lastSaid` and `state.fetchFailedAt`.
- `createDoorService(bot, ctx, options?)` returns `{ tick(): void, stop(): void, closeNear(range = 6):
  Promise<{ ok, reason, closed, failed, occupied, text }> }`. `tick()` is synchronous, never throws, looks at
  most every 250 ms, and checks `home_pack` and `home_reflexes.door_closing` itself.
- `closeNear(bot, ctx, range = 6, options?)` also exists on its own.
- `foodItems(bot, { all }?)` (banned food left out unless `all`), `moveOffhandBack(bot)` returning
  `{ ok, moved, text }`, `knownFood(ctx, { foods, from, dimension }?)`.
- Unchanged names: `eatBestFood(bot, ctx, options)`, `findShelter(...)` (`kind` is `area` or `place` for a
  home, `emergency` for none), `goToShelter(bot, ctx, options)`.
- New pure module `area_kinds.js`: `areaType`, `isShelterArea`, `isDefendedArea`, `hasWalls`, `isGatedArea`.

### Behaviour that changed against the spec or v0.1.4.7

- Only an area of type `home` is a shelter, within 96 blocks. The rule "an area named home" is gone.
  With no home `goToShelter` returns `I know no home. Tell me where home is.` (reason `no_home`) and no
  longer digs the bot in.
- `The door is closed.` is said only after the state was read; else `I am in the shelter "X".` or
  `..., but a door is still open.`
- Texts of `!eat` end with `Food N of 20, health M of 20.`; without food: `I carry no food. ...`.
- By day: `I cannot sleep now, it is day. The night starts in about N minutes.` (`1 minute` in the singular).
- The hunger reflex: after a fetch that brought nothing, no new fetch for 60 s.
- The door service takes "the bot opened it" as: no other player within 3 blocks of the door.

### For part G (glue, E6)

1. `ctx.say(text)` on `homeContext` (and so on `packContext`): chat and history, no call of the model.
2. `ctx.whereAmI` on both contexts.
3. `!eat` passes `packContext()` (with `homeContext()` it cannot name a chest with food). Its description
   follows the new behaviour.
4. `!closeDoor` as an action that pauses `unstuck`, calling `agent.door_service.closeNear(6)`.
5. At spawn: `await moveOffhandBack(bot)`, then
   `agent.door_service = createDoorService(bot, { ...agent.homeContext(), log: console.log })`.
   `agent.door_service?.stop()` when the world changes and in `cleanKill`.

### For the tester of the world tests (T2)

- `w10_sleep.js` lines 3 and 45: the text by day changed.
- `w11_eat.js` lines 6, 58 and 71: `I carry no food ...`; the texts end with `Food N of 20, health M of 20.`
- `w04_shelter.js`: the house must be saved as type `home`.

### Not done, known

- `passThrough` still refuses trapdoors. `!useOn` still toggles a door without reading its state.

## From part E (work packs, E5), done

No export was removed; every call of v0.1.4.7 still works.

### Signatures that changed

- `mineOre(bot, ctx, ore, count, options)`: `options.newMine` (default false). New reasons: `ask`,
  `underground`, `no_entrance`. Without a known mine and without `newMine` nothing is dug, crafted or
  fetched. With `newMine` and a known mine, the known mine is used.
- `chopTrees(bot, ctx, count, kind, options)`: `count` is the number of logs wanted; the arguments work in
  either order (`chopArgs`). `options.axe` (false leaves the axe out). The result has `cut`.
- `ensureTool(bot, ctx, kind, minMaterial, options)`: `options.collect` (false: inventory and chests only).
- `chooseMaterial(kind, min, inv, options)`: `options.chests`. An empty material means the best up to stone.
- `tripNeeds(..., options)`: `wayDownTo`, `hasBase`; the result has `rest`.
- `chooseEntrance(input)`: `input.homes`. A new entrance keeps 16 blocks from areas of the types home,
  building, pen, farm and from the place `home`.
- `chestsText(source, item = '', dimension)`: `source` is the ChestIndex or a ctx. The old call
  `chestsText(ctx, dimension)` still works.
- `farmCycle(bot, ctx, name, options)`: `options.fertilize` (default true). The result has `madeBoneMeal`.
- `plantText({ ..., tilled })`: `I tilled 4 blocks and planted 12 wheat_seeds.`
- New file `src/agent/knowledge/knowledge_text.js`: `knowledgeText({ chests, areas, mines, places, where },
  maxChars = 600)`, pure. It adds a line of places at the end, which is the first to be cut.

### For part G (glue, E6)

1. `!mineOre`: parameter `new_mine` (bool, default false); call
   `pack.mineOre(bot, ctx, ore, num, { newMine: new_mine })`. The description says that without a known
   mine the bot asks first.
2. `!chopTrees`: the pack sorts the arguments itself, but the parser of the commands types `num` as int and
   refuses `("", 8)` before the pack sees it. Declare the parameters so that both orders get through.
   `num` is the number of logs.
3. `!chests`: optional `item`; call `storage.chestsText(ctx, item ?? '', bot.game.dimension)`.
4. `!farmCycle`: the description says: the whole round, with bone meal from the composter.
   `!makeBoneMeal` and `!getTool`: no shears in the description; "empty material: the best up to stone,
   the known chests count".
5. `!givePlayer`: `ctx.storage.fetchItem(item, n)` first when the bot does not carry the item.
6. Context: `ctx.whereAmI`, `ctx.say(text)`, and `foodItems` of the home pack on `ctx.home`. Without them
   the packs fall back: on the surface, the log, slot 45 read directly. The refusal to start a mine under
   the ground works only with `ctx.whereAmI`.
7. Prompt: `knowledgeText({ chests: ctx.chests?.list(dim), areas: area_store?.list(dim),
   mines: ctx.mines?.list(dim), places: memory_bank, where: { ...agent.whereAmI(), pos: bot.entity.position } },
   settings.knowledge_max_chars)`. `where.pos` is needed for "the nearest chests first".

### For the tester of the world tests (T2)

- `w27_mining_trip` and `w28_mine_house` give the order `!mineOre("iron", 6, true)`. Without `true` the
  bot asks.
- `w24` to `w26` call `descendToLevel` directly. Its entrance now keeps 16 blocks from houses and farms.
- `w17`: with tilled ground the text starts `I tilled N blocks and planted ...`.
- `w18`, `w19`: no sentence about shears; the texts of `farmCycle` change because the step with bone
  meal is on by default.
- `w21`, `w22`: `chopTrees` may craft an axe from logs the bot carries before the first tree; `num` is the
  number of logs.

## State of the unit tests

After the parts A to F: `npm test` under Node 20: 137 files, 4383 tests, 0 failures.

## After the first round of the tester T1

- Corrected by the tech lead: `skills.placeBlock` passes `{ item: item_name }` to the guard (finding T1-1);
  `eatBestFood` returns `{ ok, ate, reason, text }`, and when it was stopped before the bot had enough:
  `{ ok: false, reason: 'interrupted', text: '... I was stopped before I had eaten enough.' }` (T1-2).
- Decided: the repeat guard counts failures only. `record(name, args, result, failed)`: `true` a failure,
  `false` a success that ends the row; not a boolean: an object with a boolean `ok` or `success` decides,
  else `looksLikeFailure(text)`. New export `looksLikeFailure(text)`. A result with the reason
  `interrupted` is not recorded (or recorded with `failed = false`). A refused command is not recorded.
- Decided: the 2 blocks of `unstuck` are measured from where the stuck time started, as upstream does.
- State of the unit tests after T1: 147 files, 4738 tests.
