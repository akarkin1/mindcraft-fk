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
