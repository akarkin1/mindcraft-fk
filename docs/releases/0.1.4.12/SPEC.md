# SPEC v0.1.4.12 "Understanding and watching"

This is the spec as the engineers get it on 2026-10-03. The plan for the owner is `PLAN.md`. The notes
between the parts are `HANDOFF.md`; where they disagree with this spec, they win. The defects that the
tests find, with the decisions, are `DECISIONS.md`.

Tech lead: Fable. Base: `origin/main` after the merge of `hotfix/navigation` (the tag `v0.1.4.11`, 73b7a8e).
Branch: `hotfix/watching`. Work folder: the checkout `/home/user/mc-goals`, shared. Node 22.

## 0. Rules for every engineer

The rules of `docs/releases/0.1.4.10/SPEC.md` section 0 and of `docs/releases/0.1.4.11/SPEC.md` section 0
hold word for word: never `keys.json`, never a secret printed or read, never a real model, never port
55916, no git command that writes, strict file ownership, a switch for new behaviour and none for a
correction, LF, texts word for word, `{ ok, reason, text }` and never a throw, static imports only of
names that exist, packs through `ctx`, a report as text at the end, no `npm run test:world` unless your
part says so, the journey scenarios are the gate, a text names the cause and the next step and never
what the code did not check, the functions of `src/agent/library/skills.js` keep their signatures,
`profiles/claude.json` keeps its voice. Three more:

18. No new dependency in `package.json`. What a part needs it writes itself (the MCP transport of part C
    is JSON-RPC over HTTP: `node:http` is enough). A library is changed only by a file under `patches/`
    with the version that is pinned.
19. The token of part C is read from `process.env.MC_WATCH_TOKEN` once at the start and never printed,
    logged, saved or compared in a text; a test sets its own token in the environment of the agent.
20. A pattern that the bot concludes (part B) is said before it is built; nothing is placed or dug before
    the owner's "yes".

## 1. Goal and acceptance

| Goal | Measured by |
|---|---|
| The watch server answers its six tools and `say` makes the bot act | W100 |
| An explosion near a saved area and missing chickens become events | W101 |
| "Watch me", a line, "continue like this, 12 long", "yes": the line is built | W102 |
| "Watch me", three fences and the gate, "continue like this, 7 by 10", "yes": the fence is built | W103 |
| "Watch me", the first steps of a tunnel, "continue like this, 12 long", "yes": the tunnel is dug | W104 |
| "Make me an iron pickaxe" with ore in the tunnel and coal in the chest | W105 |
| In the tunnel the bot names the tunnel of its mine; in a cave it names a cave; underground it never asks for a name | W106 |
| A dig one second after the spawn is done; the bot gets out of bed with `bot.wake()` of the library | W107 |
| Two bots: each answers the owner once, neither answers the other | W108 |
| Nothing regressed | the 21 journeys of v0.1.4.9 to v0.1.4.11, the full set |

## 2. Settings

New keys in `settings.js` and `src/mindcraft/public/settings_spec.json` (each engineer adds only its keys,
in the style of `area_sense`, after it):

| Key | Default | Type | Part | Meaning |
|---|---|---|---|---|
| `watch_server` | `false` | bool | C | The watch server on `watch_port`, with the token of the environment |
| `watch_port` | `8090` | int | C | The port of the watch server, on 127.0.0.1 |
| `watch_and_learn` | `false` | bool | B | `!watchMe`, `!continueLike`, `!buildWatched` |
| `smelting` | `false` | bool | E | `!smeltItem` of the storage pack and the step `smelt` in a plan |
| `other_bots` | `[]` | string[] | D | Names of the owner's other bots: never answered |
| `bot_role` | `""` | string | D | One sentence in the prompt |

The scans underground (F) and the small items (G) are corrections: no switch. With every switch off the
bot behaves as v0.1.4.11, except for F and G.

## 3. Parts, owners, files

| Part | Engineer | Files (owned) | Round |
|---|---|---|---|
| C The watch server | E1 | new `src/agent/watch/` (`server.js`, `mcp_logic.js`, `events_logic.js`, `events.js`, `tools.js`, `texts.js`), new `scripts/watch.js` and `scripts/watch_logic.js`, `src/agent/agent.js` (the start and stop of the server in `start` and `cleanKill` only, with a dynamic `import()`), `settings.js` and `settings_spec.json` for `watch_server` and `watch_port`; `tests/unit/wc_*.test.js` | 1 |
| E Smelting | E2 | new `src/agent/packs/storage/smelt.js`, `smelt_logic.js`, `src/agent/packs/storage/texts.js` (the smelting texts), `src/agent/packs/storage/index.js` (the export), `src/agent/commands/actions.js` (`!smeltItem` only), `src/agent/job/plan_logic.js` (the step `smelt` and `checkOf`), `src/agent/packs/wood/` (`ensureTool` leading through the smelt, see 4.2), `settings.js` and `settings_spec.json` for `smelting`; `tests/unit/we_*.test.js` | 1 |
| G The small items | E3 | `patches/mineflayer+4.33.0.patch` (G1), `patches/mineflayer-pathfinder+2.4.5.patch` (G3), `src/agent/packs/home/wake.js` and `sleep.js` (G1, the workaround goes), `src/agent/agent.js` (G2, the spawn handler only), `src/agent/library/skills.js` (`useToolOn`, `useToolOnBlock`, `goToPlayer`: G4, G5), `src/agent/commands/actions.js` (`!endConversation`, `!useOn` description: G5), `tests/world/helpers.js` (the 3.5 s wait, G2); `tests/unit/wg_*.test.js` | 1 |
| B Learning by watching | E4 | new `src/agent/packs/watch/` (`index.js`, `recorder.js`, `pattern_logic.js`, `build.js`, `texts.js`), `src/agent/commands/actions.js` (the three commands), `src/agent/agent.js` (the pack loaded behind the switch, in `_loadWorkPacks`), `profiles/defaults/_default.json` (examples), `tests/routing/sentences.json`, `settings.js` and `settings_spec.json` for `watch_and_learn`; `tests/unit/wb_*.test.js` | 2 |
| F The scans underground | E5 | `src/agent/areas/area_scan.js`, `area_kind.js`, `area_sense.js`, `src/agent/packs/mining/mine_logic.js` (`measureTunnel`, `tunnelAt`: a text helper only), `src/agent/areas/texts.js` if it exists else the texts where they are; `tests/unit/wf_*.test.js` | 2 |
| D Two bots | E6 | `src/agent/agent.js` (the chat handler of `_setupEventHandlers` only), `src/agent/conversation.js`, new `src/agent/bots_logic.js`, `src/agent/prompter.js` or where the prompt is built (the role line), `settings.js` and `settings_spec.json` for `other_bots` and `bot_role`; `tests/unit/wd_*.test.js` | 2 |
| TW Journeys | T3 | `tests/world/w100` to `w108`, `journey.js`, `base_world.js`, `helpers.js` (the teacher of B only, new `teacher.js`), `tests/world/README.md`, `tests/world/run.js` | 1 (written before the build, fail on the old code), run at every integration |
| TU Unit tests from the spec | T1 | `tests/unit/wv_*.test.js` | 2 |
| G Glue | lead | `CHANGELOG.md`, `docs/`, the merge of the parts | every round |

Parts C, B and D all touch `src/agent/agent.js` in different places and different rounds; C and G both in
round 1: C changes `start` and `cleanKill` only, G the spawn handler only. Parts E and G both touch
`src/agent/commands/actions.js` in round 1: different commands. Part B's `actions.js` change is round 2.

## 4. Interfaces

### 4.1 Part C: the watch server

**Where it runs.** In the process of the agent. `agent.start()` calls, after the spawn and the packs,
`const watch = settings.watch_server ? await import('./watch/server.js') : null; this.watch = watch ?
await watch.startWatchServer(this, { port: settings.watch_port, token: process.env.MC_WATCH_TOKEN }) : null;`
`startWatchServer` returns `{ ok, reason, text, close }`; without a token it returns `{ ok: false,
reason: 'no_token', text: TEXTS.noToken }` and the agent prints the text once to the console and goes on.
`cleanKill` calls `this.watch?.close?.()`. The server listens on `127.0.0.1` only.

**The protocol.** MCP over the streamable HTTP transport, the subset a Claude session needs, written on
`node:http` (rule 18): `POST /mcp` with a JSON-RPC 2.0 body; the methods `initialize` (answer:
`protocolVersion` as the client sent it or `"2025-03-26"`, `capabilities: { tools: {} }`, `serverInfo:
{ name: "mindcraft-watch", version: "0.1.4.12" }`), `notifications/initialized` (202, no body),
`tools/list` (the six tools with their JSON schemas), `tools/call` (the result as `{ content: [{ type:
"text", text }] }`, `isError: true` on a refusal), `ping`. `GET /mcp` opens a server-sent-events stream
on which every new event (4.1 events) is sent as a `notifications/message` with `level: "info"`,
`logger: "events"` and the event as `data`. Every request must carry `Authorization: Bearer <token>`;
without it or with another token the answer is 401 with a JSON-RPC error `-32001 "unauthorized"` and
nothing else; the comparison is constant-time (`crypto.timingSafeEqual` on the hashes). A body over 64 KB
is 413. Unknown method: `-32601`. `mcp_logic.js` holds the pure parts (the parsing, the dispatch table,
the schemas, the answers) and is tested without a socket.

**The tools** (`tools.js`, each `async (agent, args) => text`, never throws; a failure is a text that
names the cause):

| Tool | Arguments | Answer, one line per fact |
|---|---|---|
| `state` | none | `Luna at (12, 67, 52) in overworld, on oak_planks. Time 13500 (night). Health 20 of 20, food 18 of 20.` then `Running: !farmCycle("farm") for 42 s.` or `Running: nothing.`, then the job line of the knowledge block (or `Job: none.`), then `Last order: "go to the farm" by MartyByrde2, 3 min ago.` or `Last order: none.`, then `Home: (10, 67, 52), 2 blocks away.` or `Home: unknown.` |
| `inventory` | none | `Inventory: 64 cobblestone, 12 oak_log, 1 stone_pickaxe, ...` sorted by count; `Hand: stone_pickaxe. Off-hand: bread.`; `Inventory: empty.` |
| `chat` | `lines` (int, 1 to 50, default 10) | The last lines, oldest first, each `[13:45:02] MartyByrde2: go to the farm`, the bot's own lines with its name, the lines of the packs and reflexes (`agent.say`) too. `No chat yet.` |
| `places` | none | `Areas: home (home) (10,66,50)-(14,70,54); basement (building) ...` one per line; `Mines: mine, entrance (9, 67, 52), 2 tunnels.`; `Routes: basement, mine.`; `Rules: 1. ...` (the rules of the player, at most 10); `No areas.` and so on for an empty store |
| `events` | `since` (ISO time, optional) | The events after `since`, oldest first, `[13:45:02] explosion 6 blocks from the area "pen" at (x, y, z).`; without `since` the last 20; `No events.` |
| `say` | `text` (string, 1 to 256 characters) | The line is handed to `agent.handleMessage(owner, text)` with the owner's name (`settings.only_chat_with[0]`, else the last player that spoke, else `"watcher"`) exactly as a typed line, and the tool answers at once `Said as MartyByrde2: "come here".`; the bot's answer comes through `chat`. A text that starts with `/` is refused: `I do not run server commands.` |

**The events** (`events_logic.js` pure, `events.js` the listeners), each `{ t: ISO, kind, text, data }`,
kept in a ring of 200 in memory, pushed to the streams:

| Kind | When | Text |
|---|---|---|
| `explosion` | the packet `explosion` within 16 blocks of a saved area (any kind) | `Explosion 6 blocks from the area "pen" at (x, y, z).` |
| `health` | `bot.health` fell by 4 or more within 5 s | `Health fell from 20 to 14 at (x, y, z).` |
| `animals_missing` | once a minute, while the bot is within 32 blocks of a saved pen with `contents.animals`: the count of each kind inside the box is below the record | `The pen "pen" has 2 chickens, the record says 6.` once per pen until the count is back |
| `night_awake` | the time passed 23000 and the bot did not sleep this night | `The night passed without sleep.` |
| `job_stalled` | the job is running and `updated` is older than 10 minutes | `The job (the mining, 4 of 8 iron) made no progress for 10 minutes.` once per job |
| `failure_repeated` | the repeat guard saw the same failure text 5 times | `The same failure 5 times: "I find no way to you ...".` |
| `far_from_home` | the distance to the place home passed 100 blocks | `Luna is 104 blocks from home at (x, y, z).` once until it is back within 100 |
| `death` | `bot.on('death')` | `Luna died at (x, y, z).` |
| `restart` | the server started (every start of the agent process) | `Luna started.` |

**The client** `scripts/watch.js`: `node scripts/watch.js <tool> [json args]` with `MC_WATCH_URL`
(default `http://127.0.0.1:8090/mcp`) and `MC_WATCH_TOKEN` from the environment; prints the text of the
answer, exit 1 with one line on a refusal; `node scripts/watch.js events --follow` prints the stream. The
pure parts (`watch_logic.js`: the request bodies, the parsing of answers) are unit-tested.

**Texts** (`texts.js`): `TEXTS.noToken = 'The watch server does not start: MC_WATCH_TOKEN is not set.'`,
`TEXTS.started = (port) => \`The watch server listens on 127.0.0.1:${port}.\``, `TEXTS.noCommands = 'I do not
run server commands.'`.

### 4.2 Part E: smelting

**The skill** `smeltItem(bot, ctx, item, count, options)` in `smelt.js`, bound by `bindStorage` like the
other storage skills, result `{ ok, reason, text, smelted, fuel }`:

1. The furnace: the nearest furnace within 16 blocks that `ctx.areas`/the area guard lets the bot use
   (`canUse`); none → a furnace from the inventory, placed on the nearest free floor cell within 8 blocks
   that lies in a saved area of kind `storage`, `building`, `home` or `mine` (never a pen, a farm, a yard,
   never outside every area when areas exist; without any area, the nearest free cell) and that
   `canPlace` allows; none → `{ ok: false, reason: 'no_furnace', text: TEXTS.noFurnace }`.
2. The fuel (`chooseFuel(inventory, count)` in `smelt_logic.js`, pure): coal or charcoal (8 items each),
   then planks (1.5), then logs (1.5); the fewest units that cover `count`; none → `reason 'no_fuel'`,
   `TEXTS.noFuel`. Lava buckets and blaze rods are never used.
3. The batch: at most 64 of the item at once; the item into the input slot, the fuel into the fuel slot,
   then it waits and reads the output slot every 2 s (never assumes), takes the output when the input is
   empty or when the furnace stops; a stop (`bot.interrupt_code`) takes what is done and leaves the
   furnace empty of the bot's items: `reason 'interrupted'`, `TEXTS.stopped(done, count, item)`.
4. The time limit: 12 s per item plus 10 s; beyond it `reason 'timeout'` with what was done.

**The texts** (in `storage/texts.js`): `smelted(count, item, product, pos, fuelCount, fuelName)` →
`I smelted 8 raw_iron into 8 iron_ingot in the furnace at (x, y, z) with 1 coal.`; `noFuel` → `I have no
fuel: no coal, charcoal, planks or logs.`; `noFurnace` → `I know no furnace within 16 blocks and carry
none.`; `noItem(item)` → `I carry no raw_iron.`; `stopped(done, count, item)` → `I stopped after 3 of 8
raw_iron.`; `notSmeltable(item)` → `raw_cobblestone is not something a furnace changes.` (the product
comes from minecraft-data's smelting recipes).

**The command.** `!smeltItem(item_name, num)` keeps its name, description and parameters. With `smelting`
on and the storage pack loaded it runs the skill through `runPack`; off, `skills.smeltItem` of the
original project as today.

**The plan.** `plan_logic.js`: `PLAN_COMMANDS` keeps `!smeltItem` with the description `Smelt num of an item
in a furnace: raw_iron to iron_ingot, raw_copper, raw_gold, sand to glass, logs to charcoal.`; `checkOf`
gives `{ item: productOf(item), count }` (the product, not the input: the plan is done when the ingots
are there); `missingSupplies` knows `iron_ingot` as a supply that `!smeltItem("raw_iron", n)` makes.
`ensureTool` of the wood pack, asked for an `iron_pickaxe`, `iron_axe`, `iron_sword`, `iron_shovel` with
`smelting` on: with raw iron in the inventory or a known chest it smelts first (through `ctx.storage.smeltItem`),
then crafts; without raw iron it returns `{ ok: false, reason: 'no_iron', text: 'I have no iron for an
iron_pickaxe: 3 iron_ingot or 3 raw_iron are needed. Say "mine 3 iron" first.' }` so that the job planner
plans the mining. The plan prompt lists `!smeltItem` among the commands a step may use.

### 4.3 Part G: the small items

| Id | Change | Where | Test |
|---|---|---|---|
| G1 | `bot.wake()` sends `entity_action` with `actionId: 'leave_bed'` when `bot.supportFeature('entityActionUsesStringMapper')`, else the id as before; `wake.js` keeps `wakeUp` (the waits and the tries) but calls `bot.wake()` only | the mineflayer patch, `wake.js` | `wg_wake`: a fake client records the packet |
| G2 | Right after `spawn` the agent sends `bot._client.write('player_loaded', {})` when the protocol of the version has the packet (`bot.supportFeature` or the presence of `packet_player_loaded` in `bot._client.state`'s protocol; use `bot.registry`/minecraft-data `protocol` of the version); the harness's 3.5 s wait becomes 0.5 s and W107 proves a dig at 1 s | `agent.js` spawn handler, `helpers.js` | `wg_spawn`: the packet is written once, after the spawn, never twice |
| G3 | The path search centres the first point behind a door it opens, as it centres the door point itself (P3 of v0.1.4.10 centres door points; the point after a door, on the far side of the frame, keeps the corner of the cell today; it gets the centre of its cell, so the bot does not clip the frame) | the pathfinder patch | `wg_door_centre`: a path through a door, the points inspected |
| G4 | `useToolOn(bot, tool, target)` with a target that is a door, a fence gate or a trapdoor reads the state first and says `I opened the door at (x, y, z).`, `I closed the door at (x, y, z).`, `The door at (x, y, z) was open already.` (the kind word: door, gate, trapdoor); a second argument `"open"` or `"close"` is not added (the signature stays) | `skills.js` | `wg_use_on` |
| G5 | `!endConversation` answers `Conversation with ${name} ended.`; `goToPlayer` for a player without an entity after the wait: `I see no player "Steve". The players I see: MartyByrde2.` (`I see no other player.` when none) | `actions.js`, `skills.js` | `wg_texts` |

### 4.4 Part B: learning by watching

**The pack** `src/agent/packs/watch/` behind `watch_and_learn`, loaded in `_loadWorkPacks` as the other
packs, reached as `agent.work_packs.watch`, bound with `ctx` (the home context plus `storage` for the
fetch and `areas`). Exports: `watchMe(bot, ctx, player, options)`, `continueLike(bot, ctx, size)`,
`buildWatched(bot, ctx, options)`, `stopWatching(bot, ctx)`, `record()` (the current record, read-only).

**The recorder** (`recorder.js`): on `watchMe` it follows the player within 16 blocks with the follow of
the home pack (no digging, as `!followPlayer`), keeps looking at the player, and records from
`bot.on('blockUpdate')`: a block that became air is `break`, a block that became non-air is `place`;
credited to the watched player when the player is within 6 blocks of the block and is the nearest player
(the bot itself never credited); each entry `{ kind: 'place'|'break', name, x, y, z, t, props }` with the
facing of a gate or a door. The record is a list in memory, newest last, at most 500 entries; a new
`watchMe` empties it. Any command of the player ends the watching (the action manager interrupts the
follow); the record stays. No call of the model while watching: the command returns only when the
watching ends, with `{ ok: true, reason: null, text: TEXTS.watched(n) }` (`I watched you: 4 blocks placed,
0 broken.`).

**The pattern finder** (`pattern_logic.js`, pure, tested from fixtures): `findPattern(record, size)` with
`size` the owner's words (`"12 long"`, `"7 by 10"`, `""`) → `{ kind: 'line'|'fence'|'tunnel'|null, ... }`:

- `line`: 2 or more `place` entries of the same block, at the same y, in one direction (x or z), each
  one cell after the other; `size` `N long` gives the length from the first block; without a size the
  line is extended to the next block that is not air or to 16, whichever is first. Result `{ kind:
  'line', name, from, dir, length, placed: n, missing: [cells] }`.
- `fence`: `place` entries of a fence (name ends with `_fence`) in one direction, with or without a gate
  (`_fence_gate`) among them, and `size` `A by B` → the rectangle A long in the direction of the placed
  fences and B wide, turning to the side on which the gate's facing points inward or, without a gate, to
  the side with more free ground (a scan of the ground: cells that are grass, dirt or sand count); the
  gate at the first gate placed, else in the middle of the side that faces the player's position when
  "continue" was said. Result `{ kind: 'fence', name, gate: name|null, corner, dirA, dirB, a, b, cells:
  [{x,y,z,name}], missing: [...] }`.
- `tunnel`: `break` entries that free cells 2 high (feet and head) in one direction at one level, 2 or
  more deep; `size` `N long` gives the length from the first cell; without a size 8. Result `{ kind:
  'tunnel', from, dir, length, dug: n, missing: [cells] }` (the mining pack digs it: `ctx.mining?.digLine`
  if it exists, else the digging of the skills with the area guard).
- `null` with `why`: `too_few` (fewer than 2 entries), `no_line` (the entries lie on no line), `no_size`
  (a fence needs `A by B`).

**The texts** (`texts.js`), word for word:
`understood.line(name, length, from, dir, more, have)` → `I understood: a line of oak_planks 12 long from
(x, y, z) eastwards; 7 oak_planks more, I carry 20.`; `understood.fence(a, b, from, dir, gateWhere, moreFence,
moreGate, have)` → `I understood: a fence 7 x 10 from (x, y, z) eastwards, the gate in the middle of the south
side; 30 oak_fence and 1 oak_fence_gate more, I carry 12 oak_fence.` (`the gate where you placed it` when the
owner placed one); `understood.tunnel(length, from, dir, more)` → `I understood: a tunnel 12 long from (x, y, z)
westwards, 2 high; 9 blocks more to dig.`; after each: ` Say yes to build it.` / ` Say yes to dig it.`;
`noPattern(n, why)` → `I see no pattern in what you did: 3 blocks that lie on no line.` / `... : 1 block.` /
`... : a fence needs a size, say "7 by 10".`; `nothingWatched` → `I have watched nothing yet. Say "watch me"
first.`; `built.line(n, name)` → `I built the line: 7 oak_planks.`; `built.fence(fences, gates)` → `I built the
fence: 30 oak_fence and 1 gate. Say "this is the pen" to save it.`; `built.tunnel(n)` → `I dug the tunnel: 9
blocks.`; `short(name, missing, have)` → `I have 12 oak_fence and need 30. I fetch the rest from the chest.` then
`... I found no more in the chests; I built 12 of 30.`; `stopped(done, total)` → `I stopped after 12 of 30.`;
`refused(cell, why)` → `I placed nothing at (x, y, z): it is inside the area "pen".`

**The build** (`build.js`): `buildWatched` takes the last pattern of `continueLike` (none → `TEXTS.nothingToBuild`:
`I have no plan. Say "continue like this" first.`); fetches the missing material through `ctx.storage.fetchItem`
when a chest has it; places cell by cell with `skills.placeBlock` (a gate with its facing) and the area guard's
`canPlace`, digs with the area guard's `canBreak`; a refused cell is skipped and counted; the result names what
was built and what was skipped. A stop keeps what is built.

**The commands** (`actions.js`): `!watchMe` (`Watch what I do and learn the pattern.`, no params), `!continueLike`
(`Continue the pattern you watched. size: "12 long" or "7 by 10".`, one string param), `!buildWatched` (`Build
or dig what you understood, after I said yes.`, no params), `!stopWatching` is not a command: any order ends it.
Examples in `_default.json`: "watch me" → `!watchMe`; "continue like this, 7 by 10" → `!continueLike("7 by 10")`;
"yes, build it" after an understood text → `!buildWatched`. Three sentences in `tests/routing/sentences.json`.

### 4.5 Part F: the scans underground

| Id | Rule |
|---|---|
| F1 | `scanEnclosure` with a border whose kind is `natural` for 2/3 or more of the border cells gives `border: 'rock'` and `kindOf` gives `cave` when the scan found no tunnel, `tunnel` when `tunnelAt` of the mining pack accepts the origin (width 1 or 2, length 4 or more); water inside rock is not counted as contents (`countContents` skips water when `border` is `rock`). Neither is saved by `!rememberArea` without a type: `I am in a tunnel; a tunnel is saved with "this is the mine" or "dig here".` |
| F2 | The sentence of the sense underground: `I am in a tunnel 2 wide and 23 long, heading west, of the mine "mine".` (the mine from `whereAmI().mine`), `I am in a tunnel 1 wide and 9 long, heading north, of no mine I know.`, `I am in a cave at (x, y, z), 6 wide and open on 3 sides.` |
| F3 | `area_sense` underground (`whereAmI().underground` or depth 8 or more): it says F2 once per tunnel or cave per start only when the tunnel is of a known mine; in a tunnel of no mine and in a cave it says nothing and never asks for a name. The knowledge line underground names the known tunnel or nothing. |
| F4 | A scan runs in one pass over the cells it needs (the enclosure scan reads each cell once, cached per scan); the bot stands still from the start of a scan to its end (`bot.clearControlStates()` first, no walk in the scan); a scan over 2 s says `The scan took 3 s.` appended to its text. A unit test measures the number of block reads of a 13 x 26 corridor: at most 4 reads per cell of the box. |

### 4.6 Part D: two bots

| Id | Rule |
|---|---|
| D1 | `bots_logic.js` (pure): `shouldAnswer({ from, text, self, otherBots, onlyChatWith })` → `{ answer: boolean, why }`: false for `from === self`, for `from` in `otherBots` (case-insensitive), for a text that is a command echo (`/^\*\S+ used \S+\*$/`) from anyone, for a text that is a result of a bot (`/^(Action output:|Found (non-)?destructive path\.|You have reached)/`) from anyone, for a `from` not in `onlyChatWith` when that list is not empty; true otherwise. |
| D2 | The chat and whisper handlers of `agent.js` ask `shouldAnswer` first; `conversation.js` `isOtherAgent(name)` is true for `other_bots` too, so the original project's bot-to-bot paths treat them as bots (no "received whisper from other bot??" warning: the line is dropped silently with a console line behind `settings.verbose_commands`). |
| D3 | `bot_role` non-empty: the line `${bot_role} A question to all of us gets one line from you.` goes into the prompt after the two lines of W6 of v0.1.4.11 (the same place in both profiles' conversing prompt, through the prompter's replacement of a placeholder, not by editing the profiles); a job that the role gives to another bot is answered `That is gpt's job. I farm.` only by the model (an example in `_default.json` with the role line). The knowledge block says nothing new. |
| D4 | The guide: `only_chat_with` and `MINDSERVER_PORT` stay the way to run two; `other_bots` and `bot_role` come on top. |

## 5. The journeys (T3)

Black box, written from `PLAN.md` and this section only, the control never moves the bot, each with an
empty memory, the owner's switches of v0.1.4.11 plus the switches of this release on, failing on
v0.1.4.11. The base world; the owner's dump when `MCW_OWNER_DUMP` is set is not needed.

| Id | Name | What |
|---|---|---|
| W100 | watch_server | The agent starts with `watch_server` on and `MC_WATCH_TOKEN` in its environment (the harness sets a random token and never prints it). `node scripts/watch.js` as the client, with the same token: `state` names the bot's position within 1 block of the server's, the dimension, the time; `inventory` names the kit; `places` names the saved area after `!rememberArea("home", "home")`; `chat` holds the owner's last line and the bot's answer; a call without the token is refused (exit 1, the text says unauthorized, nothing else of the state in the output); `say "come here"` with the player 8 blocks away: the bot comes within 2 blocks in 60 s; `say "/kill"` is refused and the bot lives. |
| W101 | watch_events | The pen of the base saved with its chickens (`!rememberArea("pen")`); the control kills 4 of the 6 chickens (not a block: `kill @e[type=chicken,limit=4,...]`): within 90 s `events` has `animals_missing` for "pen" with 2 and 6; the control summons a primed TNT 8 blocks from the house (`summon tnt`): `events` has `explosion` naming the area "home" or "pen" within 30 s, the house blocks stand or the explosion was 8 or more from the house; the stream (`--follow`) printed both. |
| W102 | watch_line | The teacher (the player bot, `teacher.js`: it places and digs itself with its own inventory in creative, the control gives it the blocks) says "watch me" (`!watchMe`), places 4 oak_planks in a line eastwards at ground level 2 blocks apart from the bot's view, says "continue like this, 12 long" (`!continueLike("12 long")`): the answer is the understood text with 8 more and the count the bot carries (the kit holds 20); "yes" (`!buildWatched`): within 90 s the 12 cells hold oak_planks (server), the text `I built the line: 8 oak_planks.`; nothing else placed within 3 blocks of the line. |
| W103 | watch_fence | The teacher places 3 oak_fence northwards and then an oak_fence_gate as the 4th, facing east, says "continue like this, 7 by 10": the understood text names 7 x 10 and the gate where it was placed; "yes": the rectangle stands (every border cell a fence or the one gate), the gate is the one the teacher placed, the inside is untouched (no block inside changed), the material was fetched from the chest of the house when the kit was short (kit 12 fences, the chest 64). |
| W104 | watch_tunnel | In the mine room the teacher digs 3 cells deep, 2 high, westwards into the rock, says "continue like this, 12 long": the understood text; "yes": the 12 cells are air (server), the ceiling and the floor stand, nothing dug beside; no block of the room broken. |
| W105 | iron_pickaxe | Iron ore in the tunnel of the base (6 blocks), coal in the chest of the room, a furnace in the room, the bot with a stone pickaxe; "make me an iron pickaxe" (`!getTool("pickaxe", "iron")` or the job `!craftRecipe("iron_pickaxe", 1)` with the planner): within 8 minutes the bot carries an iron_pickaxe (server), the furnace stands where it was, no furnace placed in the pen or the farm, the said lines hold the smelt text with the count. With `smelting` off (part B of the scenario): the old behaviour, no assertion but that the process lives. |
| W106 | scan_underground | The bot in the tunnel of the base with the mine saved (`!rememberMine`), `area_sense` on, walked in by `!goToMine` then into the tunnel by a typed walk: the said lines hold F2's tunnel sentence of the mine within 20 s, no "storage", no "Tell me its name"; then in a dug cave (the control digs a 6 x 3 x 6 hole at y 40 beside the tunnel, open on 3 sides) via `!goToCoordinates`: no line of the sense at all; `!rememberArea("x")` there answers the F1 refusal. |
| W107 | spawn_and_bed | A: 1 s after the spawn `!collectBlocks("oak_log", 1)` with a log 2 blocks away: the log is gone within 10 s (server). B: night, the bot in its bed (`!goToBed`), then `!stop` and `!goToCoordinates` 5 blocks away: the bot is out of the bed within 4 s and at the coordinates within 30 s (G1: the patched `bot.wake()` works through `wakeUp`). |
| W108 | two_bots | Two agents (`w_farmer` with `bot_role` "You are the farmer. w_miner is the miner." and `other_bots: ["w_miner"]`; `w_miner` the reverse), both with `only_chat_with` the player; the player says "where are you?": within 20 s each bot said exactly one line and neither said a line within 10 s after the other's line that answers it (the chat log of the server: no bot line follows a bot line without a player line between); "mine 4 iron": the farmer's answer names the miner's job (`gpt's job` form with the names), the miner answers with `!mineOre`; the process of each lives. |

The teacher (`tests/world/teacher.js`): a mineflayer bot in creative, `teacher.place(name, cell, facing)` and
`teacher.dig(cell)` with the real mechanics (equip, look, place or dig), `teacher.say(text)`; it stands within
4 blocks of each cell it works on.

## 6. The unit tests from the spec (T1, round 2)

`tests/unit/wv_*.test.js`: the six tools' texts from fixtures of an agent (W100's lines), the JSON-RPC answers
of `mcp_logic.js` (initialize, tools/list with six tools, tools/call, unauthorized, unknown method, 413), the
events from staged facts (each kind of 4.1), `chooseFuel`, the smelt texts, `findPattern` for the three
patterns and the three `null` cases with the exact texts, the F1 border rule from a corridor fixture, `shouldAnswer`
for every row of D1, the texts of G4 and G5.
