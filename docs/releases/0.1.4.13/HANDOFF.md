# Handoff v0.1.4.13 "Supervision"

What a finished part gives to the parts that follow. Where this file and `SPEC.md` disagree, this file wins.
Written by the lead after each round from the engineers' reports.

## Round 1 (commit 08675a0): S, N1, K, P, the journeys

### Part S, the watch tools (E1)

| Gives | Where | Note |
|---|---|---|
| `registerTool(name, schema, handler)`, `unregisterTool`, `toolList` | `src/agent/watch/tools.js` | `schema = { description, inputSchema, refusal?: (args) => string \| null }`; `handler(agent, args, watch, request)` with `request.signal`; a registered tool is listed after the eleven and run by `runTool` without a change of the table. Part N2 adds `reply` and `note` this way. |
| Presence | `watch.presence.seenAt` | ms of the last `wait` or `digest` call (`touchPresence`); `server` already says `Supervisor: connected 12 s ago.` within 60 s, else `Supervisor: none.`. N2 reads it for "no supervisor within 60 s". |
| The `help` event | `src/agent/watch/events.js`, `HELP_PATTERNS` in `events_logic.js` | Fires from every line the bot says (`openChat`) that matches `/\?\s*$/`, `/Say "/`, `/Tell me/`, only with `settings.supervisor_name` set (read live from `watch.settings ?? settings`). N2 adds only the key. |
| The cursor | `digest` answers `Cursor: N.` first | `since: "N"` gives the changes since that snapshot; unknown or absent gives every line. `wait` without `since` answers the digest since the call. |
| The queue | `watch.queue` (`src/agent/watch/queue.js`) | `pending()` → `[{ text, by, status }]` with `waiting \| running \| started \| done \| failed \| skipped`; the owner's typed `!command` while the queue runs is queued (`Queued: I run it after N commands.`), `!stop` empties it; the answer `Ran k of n.` + lines, `Still running: i of n.` at 55 s, `Stopped at i of n.` or `Stopped by <player> at i of n.`. Commands of the queue go through `agent.handleMessage(owner, text)`, so part P's refusal (P6) never applies to them. |
| `wait any` | `digest_logic.js` `wakeReason` | Wakes on an event, the start or end of a command, a change of health, food, the hand item's name, the hazards, the nearest chest, a chat line of a player. Not on the position, the inventory, the job's count, the uses left, the bot's own lines. A reflex is not a command: `Running: nothing.` under a reflex, no wake when a reflex ends. |
| The client | `scripts/watch.js` | `digest [since]`, `wait [for] [timeout] [since]`, `run '<cmd>' ...`, `look [radius]`, `server`; `--follow` is a loop of `wait any`; `events --follow` is refused with a hint. No SSE anywhere. |

Decisions of E1 that stand: `look` scans x and z within the radius and the layers from the bot's level outward until 65,536 blocks (±7 at radius 32); hazards are lava within 8, water at the feet or one above or below, up to 3 drops; the first digest lists the inventory as counts, later ones as `+7 diamond, -4 bread`.

### Part N1, addressing by name (E2)

| Gives | Where | Note |
|---|---|---|
| `addressedTo(text, names) → { name, rest } \| null`, `ADDRESS_WORDS` | `src/agent/bots_logic.js` | The rule of SPEC 4.2; `name` is the spelling from `names`; `rest` is `''` when the line is the address alone (the handler then hands the original line on, so "claude?" is answered). "claude and gpt, come here" addresses none. |
| `shouldAnswer({ ..., names, supervisor })` | `src/agent/bots_logic.js` | New rows after the five of v0.1.4.12: `addressed_other` (false), `addressed_supervisor` (false), `addressed_self` (true, `text` = rest). **For N2:** a line to the supervisor reaches the handler's drop branch of `respondFunc` with `verdict.why === 'addressed_supervisor'`: that is the hook for the `message` event. `why: 'supervisor'` is free for the relayed `[Opus] ...` lines. |
| The handler | `src/agent/agent.js` `respondFunc` | Passes `names: convoManager.getInGameAgents()` and `supervisor: settings.supervisor_name`; a dropped line returns before any model call. |

### Part K, the creeper loop (E2)

F10 was not in the fork's code. The 1.21.8 server writes the player knockback of an explosion as three doubles; minecraft-data 3.98.0 read it as three floats, so the y float was the low mantissa word of the x double, now and then 5e14, which mineflayer added to the velocity; the next physics tick walked a bounding box of that height in one synchronous call until the heap was gone. The patch of the pinned minecraft-data (`patches/minecraft-data+3.98.0.patch`, 1.21.6 and 1.21.8) takes `vec3f64` as upstream 3.117.0 does; the pin stays 3.98.0. After it: 36 runs of W47, 0 crashes, peak 255 MB. **For the play test:** `node_modules/minecraft-data` must be removed before `npm install` (as the two packages of v0.1.4.12), and one creeper explosion is part of the play. `scripts/profile_creeper.js` is a Linux watchdog; `MCW_PROFILE=cpu|heap|1` in `tests/world/run.js`.

### Part P, the job corrections (E3)

| Gives | Where | Note |
|---|---|---|
| `ctx.job.progress(got)` | `agent.packContext()` (the lead), `src/agent/job/index.js` | The one call a pack makes to the job; `got` is the count of this run, the job adds its base. The mining pack calls it after every ore (`onProgress` of `makeJob`), on `!stop` the leave text waits for the skill's last count: `I leave the mining at 2 of 6 iron.` once. |
| The trip loop of `mineOre` | `src/agent/packs/mining/mining.js` | In order: `eatIfHungry`, `report()`, the wear check (`wornPickaxe` → `replaceWorn`), `pickaxeState`/`shouldReturn`, the `inventory_full` branch (`depositAtBase`, `depositsWithoutProgress`), one chunk, `report()`, the `worn` handling. **Q4 (the full bag) hooks in the `back.go && back.reason === 'inventory_full'` branch**: replace `depositAtBase` there, keep `report()` and `replaceWorn`. **Q9 (the other ores) hooks in `digTunnel`**: `veinsOf(job, step.ores, ...)` takes the ore blocks of the step's view; add the other kinds to `collected` and to the texts of `finish` (`extra`); every dig goes through `digClear` → `digBlock`, so the wear rule covers Q9's blocks; a `worn` result must be propagated as the existing sites do. |
| The supply order | `src/agent/packs/mining/supply_logic.js` (pure) | `supplyPlan({ missing, from, chests, foods })` → `{ takes: [{ chest, near, items }], rest }`; chests within 16 first, then the others, nearest first; `applySpareRule` (a spare only with exactly one usable pickaxe under 50 uses); `prepareMiningTrip` looks into unknown containers within 16 (`ctx.storage.lookIntoChests`) before it decides. |
| The wear rule | `src/agent/packs/mining/dig.js` | `WEAR_LIMIT` 10, `wornTool(item)`, `fitsBlock`; `digBlock` equips a better pickaxe of the bag at the limit or returns `{ ok: false, reason: 'worn', worn: { name, uses } }`; `replaceWornPickaxe(bot, ctx, row, worn, { mined, wanted })` in `mining.js`. Texts: `wornMadeText`, `wornSpareText` (`... I take my spare one.`, beyond the spec), `wornStopText`. W114 accepts either of the first two. |
| The plan starts | `src/agent/job/index.js` | Every plan runs its first step in the same call (`startFirstStep` → `runStep`), with the way out of the mine first for a surface step underground; `stepStartText(i, n, step)` at every step start. The tests of v0.1.4.10 were adapted by the lead. |
| P6 | `src/agent/commands/index.js` `executeCommand`, `job.refusal(name, by, query)` | A command the model picks while a skill of the job runs is answered `The mining runs, 7 of 28 diamond. Say !stop first.` as a system line and not run; `!stop`, `!stats`, `!inventory` and queries pass; a typed command of the owner passes. |
| The furnace of the bag | `src/agent/packs/storage/smelt.js`, `smelt_logic.js` | Placed within 3 blocks in an allowed area or anywhere in a known mine (`inKnownMine`); `I placed my furnace at (x, y, z).` in front of the result; reason `no_spot` with `TEXTS.noFurnaceSpot` when carried but no cell; `I know no furnace within 64 blocks and carry none.` only when none is carried. `bindStorage` also binds `lookIntoChests`. |
| Help texts for part S | | `TEXTS.noFurnaceSpot` ends with `tell me again.`; `busyText` is a system line, never chat, never a help text. |

### The journeys (T3)

`tests/world/w109` to `w118`, `tests/world/supervisor.js` (the scripted supervisor, a client of the protocol, not of the code), the group `journeys13`; `journey.js` gains `SUPERVISION_SETTINGS`, `partTeachMineInRoom`, `countEntities`, `penChickenSelector`, `readSharedWorldFile`; `helpers.js` gains `itemDamages`, `foodTo`. All ten fail on v0.1.4.12 for the right reason; W110 passes on round 1.

Points of T3 the parts of round 2 must meet:

- **W109** waits for `done`, not `any` (the lead's decision: with `any` on the position the 6 wakes are impossible; E1's `any` ignores the position anyway). The owner's `!stop` 6 s in is staged so that the second rule fires.
- **W111**: an `update` sent 300 ms after the owner's order, with the bot's answer 1.5 s later, must appear after the answer. **N2 holds a supervisor's line while the owner's last line has no bot answer yet (up to 10 s), and for 3 s after a bot line**; the spec's "3 s after a bot line" alone fails it.
- **W113** stages the raw iron in the known room chest with 4 planks and 1 coal in the bag and orders `!getTool("pickaxe", "iron")` (the existing signature). E3's P3 covers every plan; the fake model of the journey plans the steps.
- **W116** says "open the pen" and its fake model answers `!allowChanges("pen")` for the unsaved pen: **Q8 makes `!allowChanges` accept the kind word or the name the sense gave the enclosure** when no saved area matches.
- **W112** gates the P1 text and the facts; the owner's climb of 3.1 did not reproduce black-box (v0.1.4.12 already took the bread from a chest it saw within 11 blocks).
- The bot twice could not climb out of the base's mine after a job: `I could not get to the way out at (403, 43, -2): I was blocked at (402, 44, -1)` (the gap of the second ladder): **Q3**.
- `MCW_PROFILE` is to be added to the README's environment table (the lead, round 2).

## Round 2: Q, N2, M, and the unit tests from the spec

Files: SPEC section 3. Q changes `mining.js` after P as above and `actions.js` for `!goToCoordinates` and `!mineOre` only; N2 changes `bots_logic.js` and `tools.js` only through the hooks above; M changes the stores' paths only through `memory_paths.js`.
