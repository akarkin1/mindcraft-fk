# Handoff notes v0.1.4.12

Notes between the parts, by the engineers, accepted by the tech lead. Where they disagree with
`SPEC.md`, they win.

## From part E (smelting, E2), done in round 1

### Exports

| File | What |
|---|---|
| `src/agent/packs/storage/smelt_logic.js` | pure: the product table (minecraft-data 1.21.8 has no smelting recipes), `productOf(item)`, `chooseFuel(inventory, count)` (one fuel kind per batch, the kind that covers the most when none covers the count; logs being smelted are not fuel), the batches of 64, the time limit, the furnace and placement choice |
| `src/agent/packs/storage/smelt.js` | `smeltItem(bot, ctx, item, count, options)` → `{ ok, reason, text, smelted, fuel }`, never throws; bound by `bindStorage` as `ctx.storage.smeltItem` |
| `src/agent/packs/storage/texts.js` | `TEXTS.smelted`, `noFuel`, `noFurnace`, `noItem`, `stopped`, `notSmeltable` of the spec, and beyond it: `I ran out of time after N of M item.`, `The furnace stopped after N of M item.` (14 s without change), `I carried only N item.`, `I had fuel for N only.`, `The furnace at (x, y, z) is busy with N name.`, `I could not get to the furnace at (x, y, z).` |
| `src/agent/job/plan_logic.js` | `!smeltItem` checked by its product and count; `missingSupplies` adds `smelt: '!smeltItem("raw_iron", n)'` for iron_ingot (copper and gold too); an own copy of the product table (the job module imports no pack; a test keeps the copies equal) |
| `src/agent/job/job_logic.js` (lead) | `blockerOf`: the reason `no_iron` → `{ kind: 'no_iron', item: 'iron_ingot' }` |
| `src/agent/packs/wood/tools.js` | `smeltIronFor`; `ensureTool` for an iron tool with `smelting` on smelts the raw iron it carries or fetches from a known chest first, then crafts; without any iron `reason 'no_iron'` with `noIronText(name, count)` (pickaxe 3, axe 3, sword 2, shovel 1, hoe 2) |

### Decisions beyond the spec, accepted

| Decision | Why |
|---|---|
| A carried furnace lands only where the area guard's `canPlace` allows: in practice in a mine area (a home or building area refuses placing without a permit) | the spec said both conditions; the guard is the stricter one and stays |
| A furnace that holds another item in its input or output is skipped; a furnace the bot placed stays | no claim about what the code did not check |
| Only blocks named `furnace`, not blast furnaces or smokers | |
| The plan changes are not behind the switch | `plan_logic.js` has no settings; the step runs only when `!smeltItem` of the pack exists |
| The storage pack loads only when one of its switches is on; `smelting` needs `storage_pack` | the skill is of the storage pack |

### Requests

- To part B (the watching pack, round 2): nothing.
- To T3: W105 relies on the furnace of the room (a carried furnace would land only in the mine).

## From part C (the watch server, E1), done in round 1

### Exports

| File | What |
|---|---|
| `src/agent/watch/server.js` | `startWatchServer(agent, { port, token })` → `{ ok, reason, text, close, port, push, watch }`; `HOST` (127.0.0.1), `SSE_PING_MS` (15 s); `port: 0` for tests; reasons `no_token`, `bad_port`, `listen_failed` |
| `src/agent/watch/mcp_logic.js` | pure: `TOOLS` (six, with schemas), `handleRpc`, `dispatch`, `authorized` (SHA-256 hashes, `timingSafeEqual`), `unauthorizedAnswer`, `tooLargeAnswer`, `eventNotification`, `sseMessage`; an unknown tool is -32602, 404 for another path, 405 for another method, batches answered, 413 as -32600 |
| `src/agent/watch/events_logic.js` | pure: `EVENT_KINDS`, `Ring`, `makeEvent`, `eventLine` (`[13:45:02] explosion: Explosion 6 blocks from the area "pen" at (x, y, z).`: time, kind, colon, text), the watchers `createHealthWatch`, `createAnimalsWatch`, `createNightWatch`, `createJobWatch`, `createFailureWatch`, `createHomeWatch` |
| `src/agent/watch/events.js` | `startListeners(agent, watch, push)` → `stop()`; `TICK_MS` (5 s) |
| `src/agent/watch/tools.js` | `TOOL_HANDLERS`, `runTool`; the state's `Last order` is the last line a player gave (through a wrapper of `agent.handleMessage`), `Running` from `agent.running_commands` and `actions.last_action_time`; day under 12000, dusk to 12999, night to 22999, dawn from 23000 |
| `scripts/watch.js`, `scripts/watch_logic.js` | the client (Node's `fetch`, an https tunnel URL works): exit 0 on an answer, 1 on a refusal (`The watch server refused the call: unauthorized.`), 2 on bad arguments; plain words accepted (`say come here`, `chat 20`); `events --follow` prints the stream only |

### How the events are detected

The `explosion` packet of the client against the areas of the dimension; `health` as the highest of the last 5 s minus the current, 4 or more; `animals_missing` once a minute from a minute after the start, `bot.entities` inside the pen's box against `contents.animals`, once per pen until the count is back; `night_awake` when the time passes 23000 naturally without a sleep since 12000; `job_stalled` every 5 s from `job.get()` with `updated` 10 minutes old; `failure_repeated` by a wrapper of `repeat_guard.record` on the instance (5 in a row; without a guard the bot's own failure lines count); `far_from_home` every 5 s from the place home, again only after the bot was back within 100; `death` from the bot; `restart` once the server listens. The chat ring takes `bot.on('chat')`, `bot.on('whisper')` and a wrapper of `agent.openChat`; `close()` restores everything.

### Decisions beyond the spec, accepted

| Decision | Why |
|---|---|
| `say` records the line as `MartyByrde2 (by watch): ...`, sets `shut_up` false and does not wait for `handleMessage` | the answer comes through `chat` |
| The server starts at the end of `start()`, before the spawn; the tools say `<name> is not in a world yet.` until then | the spawn handler is G's |
| Mines come from `agent._workStores().mines` | `packContext()` binds storage on every call |
| Only the hash of the token is kept | rule 19 |

### Requests

- To the lead: the owner's guide needs the tunnel and the client (`MC_WATCH_URL`, `MC_WATCH_TOKEN`), and the cloud session's allowed hosts.

## From part G (the small items, E3), done in round 1

| Item | What |
|---|---|
| G1 | `patches/mineflayer+4.33.0.patch`: `wake()` of `bed.js` sends `entity_action` with `actionId: 'leave_bed'` when `bot.supportFeature('entityActionUsesStringMapper')`, else 2. `wake.js` keeps `wakeUp` (the waits, the tries, the texts) and calls `bot.wake()` only. |
| G2 | `agent.js` exports `sendPlayerLoaded(bot)` (writes `player_loaded {}` when the protocol of the version has the packet, one console line, never throws) and calls it on every `spawn` (mineflayer emits it again after a death and a dimension change). `tests/world/helpers.js` waits 0.5 s after the spawn instead of 3.5. |
| G3 | `patches/mineflayer-pathfinder+2.4.5.patch`: in `postProcessPath` the point after a door, gate or trapdoor the bot opens gets the centre of its cell. Over a full block that point was centred already; it sat off-centre over a floor without a full top face (bottom stairs). |
| G4 | `skills.useToolOn` / `useToolOnBlock` on a door, gate or trapdoor: the state read before the click and again for up to 1 s after it; `I opened the door at (x, y, z).`, `I closed the door at (x, y, z).` (the result true), `The door at (x, y, z) was open already.` (open and stayed open, false), `The door at (x, y, z) did not open.` (closed and stayed closed, false), `The iron door at (x, y, z) does not open by hand.` (no click); the kind word door, gate or trapdoor; both halves of a door give the lower half's place. The description of `!useOn` is unchanged (the prompt has no room). |
| G5 | `!endConversation` → `Conversation with ${name} ended.`; `goToPlayer` → `I see no player "Steve". The players I see: MartyByrde2.` / `... I see no other player.` from `bot.players`; a stopped wait says nothing. |

Decisions accepted: the door toggles (the three texts of the spec fit only with a toggle); the texts of a stopped `goToPlayer`; `sendPlayerLoaded` as a top-level export for its test. Tests adapted by the lead: `fxc_wake` (the fake bots send the packet from `bot.wake()`), `rtl_follow_ladder` (the new text).

## From part B (learning by watching, E4), done in round 2

### Exports

| File | What |
|---|---|
| `src/agent/packs/watch/index.js` | `watchMe(bot, ctx, player)`, `continueLike(bot, ctx, size)`, `buildWatched(bot, ctx)`, `stopWatching(bot, ctx)`, `record()` (a frozen copy); loaded by `_loadWorkPacks` behind `watch_and_learn` as `agent.work_packs.watch` |
| `pattern_logic.js` | pure: `findPattern(record, size, world)` → line, fence, tunnel or null (`too_few`, `no_line`, `no_size`); `describePattern(pattern, have)`; `parseSize`, `netEntries` (a block placed and broken again cancels out), `dirOf`, `rightOf`, `oppositeOf` |
| `recorder.js` | `changeOf`, `creditedTo`, `createRecord` (500 entries), `startRecorder`: a block that turns to air is a break, one that appears where air, a plant, snow or a liquid was is a place; a state change (a fence connecting, a gate opening), liquids, fire, ground plants, leaves, the upper half of a door and the head of a bed count as nothing; credited to the watched player within 6 blocks of the block and nearest of the players other than the bot |
| `build.js` | `buildPattern`, `buildSteps`, `standFor`: the bot walks with `walkNear` (no digging), stands 2 beside a line, 2 outside a fence, 2 behind a gate against its facing, in the column before a tunnel cell; a cell with a block in it is skipped and named, never broken; a tunnel block next to lava is refused |
| `texts.js` | the texts of the spec plus `refusedDig`, the reasons `whyGuard`, `whyInTheWay`, `whyUnreachable`, `whyPlaceFailed`, `whyDigFailed`, `whyLava`, `noPlayer`, `shortBuilt`; `watched(placed, broken)`; `understood.fence` takes the block names as trailing parameters |
| `actions.js` | `!watchMe` (`Watch what I do and learn the pattern.`), `!continueLike` (`Continue the pattern you watched, for a size.`, `size`: `"12 long" or "7 by 10".`), `!buildWatched` (`Build or dig what you understood, after I said yes.`), after `!stay`; `!watchMe` runs as an action until the next order interrupts it and then says `I watched you: ...` without a model call |

### Decisions beyond the spec, accepted

| Decision | Why |
|---|---|
| The follow is `skills.followPlayer(bot, player, 16)`, the head turned to the player every second, `I watch you.` at the start, the follow retried every 10 s when it ends by itself | PLAN 2.1 |
| The larger of the stated size and the run the owner placed; sizes 1 to 64; a line takes only `N long` | |
| A gate facing along the line: the side with more free ground; a tie: the right of the line's direction; without a gate the gate goes on the nearest unplaced cell of the side nearest the player | |
| A tunnel counts columns 2 high (12 long minus 3 dug = 9) | the example of the spec |
| In creative mode the material is not counted | |
| The lead: the commands are hidden when the switch is off or the pack is missing (`blocked_actions`), the packs load with `watch_and_learn` alone, the routing list knows the part, four descriptions of other commands were shortened for the prompt limit (`!rememberArea`, `!rememberRule`, `!setMode`, the material of `!getTool`): 16,770 characters with every switch on | the prompt at 17,000 |

W102 passed on the real server (the line built in 6.1 s, nothing else placed within 3 blocks).
