# SPEC v0.1.4.13 "Supervision"

This is the spec as the engineers get it on 2026-10-04. The plan for the owner is `PLAN.md`. The notes
between the parts are `HANDOFF.md`; where they disagree with this spec, they win. The defects that the
tests find, with the decisions, are `DECISIONS.md`. The live voice is built already (`VOICE.md`, merged).

Tech lead: Fable. Base: `origin/main` at v0.1.4.12 (46fed13) with the voice branch merged (488b281).
Branch: `release/v0.1.4.13-rc`. Work folder: the checkout `/home/user/mc-goals`, shared. Node 22.

## 0. Rules for every engineer

The rules of `docs/releases/0.1.4.10/SPEC.md` section 0, `docs/releases/0.1.4.11/SPEC.md` section 0 and
`docs/releases/0.1.4.12/SPEC.md` section 0 hold word for word: never `keys.json`, never a secret printed or
read, never a real model, never port 55916, no git command that writes, strict file ownership, a switch
for new behaviour and none for a correction, LF, texts word for word, `{ ok, reason, text }` and never a
throw, static imports only of names that exist, packs through `ctx`, a report as text at the end, no
`npm run test:world` unless your part says so, the journey scenarios are the gate, a text names the cause
and the next step and never what the code did not check, the functions of `src/agent/library/skills.js`
keep their signatures, `profiles/claude.json` keeps its voice, no new dependency, the watch token never
printed. Three more:

21. A watch tool answers in at most 2 s or says what it waits for; `wait` is the one tool that blocks, and
    only as long as its `timeout`.
22. A correction of package 3 changes what the bot does, never what a text promises: when the bot cannot
    do the corrected thing (no chest with room, no material for a pickaxe), the text says so and names the
    next step.
23. Nothing of this release calls the model where code can decide: addressing by name, the digest, the
    tool wear, the pen, the full bag are code.

## 1. Goal and acceptance

| Goal | Measured by |
|---|---|
| A scripted supervisor drives a 10-minute mining job through `wait` and `run` with at most 6 wakes | W109 |
| Two bots: "claude, come here" moves claude only; "come here" moves both | W110 |
| "Opus, where is it" is answered by the supervisor through `reply` and by no bot; without a supervisor the bot says so | W111 |
| Out of food in the mine, the bot takes bread from the chest beside the tunnel and mines on | W112 |
| "Make me an iron pickaxe" with a furnace in the bag and no furnace near: placed, smelted, crafted, and the plan started by itself | W113 |
| The pickaxe at 10 uses is replaced before it breaks; the mining goes on | W114 |
| `!goToCoordinates` 20 blocks down is refused in words; the bot stands where it stood; a player's death drops stay on the ground | W115 |
| `!followPlayer` through an unsaved pen: the gate stays closed, the bot walks round or waits | W116 |
| With `shared_memory`, the mine one bot saved is known to the other | W117 |
| A full bag during mining: stored in the chest of the mine, mining goes on | W118 |
| Nothing regressed | the 30 journeys of v0.1.4.9 to v0.1.4.12, the full set |

## 2. Settings

New keys in `settings.js` and `src/mindcraft/public/settings_spec.json` (each engineer adds only its keys,
in the style of `watch_server`, after `voice_language`):

| Key | Default | Type | Part | Meaning |
|---|---|---|---|---|
| `supervisor_name` | `""` | string | N | The name the owner addresses the supervisor by; `""`: no supervisor in the chat, no `help` or `message` events, no notes |
| `supervisor_voice` | `"supertonic:M1"` | string | N | With `voice_ui`: the voice of the supervisor's lines on the page |
| `watch_report_seconds` | `0` | int | S | A `report` event every N seconds; 0: none |
| `shared_memory` | `false` | bool | M | One memory of the world for all bots |
| `prompt_cache` | `false` | bool | M | The fixed part of the prompt first and cache-marked |
| `mine_other_ores` | `false` | bool | Q | The other ores in the tunnel's walls are mined too |

The watch tools (S), the addressing (N1), the corrections (P, Q), the creeper loop (K) and the cost meter's
cache writes (M3) have no switch. With every switch off the bot behaves as v0.1.4.12 but for the corrections.

## 3. Parts, owners, files

| Part | Engineer | Files (owned) | Round |
|---|---|---|---|
| S The watch tools | E1 | `src/agent/watch/tools.js`, `server.js`, `mcp_logic.js`, `events.js`, `events_logic.js`, `texts.js`, new `digest_logic.js`, `queue.js`, `look_logic.js`; `scripts/watch.js`, `scripts/watch_logic.js`; `settings.js` and `settings_spec.json` for `watch_report_seconds`; `tests/unit/xs_*.test.js` | 1 |
| N1 Addressing by name | E2 | `src/agent/bots_logic.js` (`shouldAnswer`, new `addressedTo`), `src/agent/agent.js` (the chat handler `respondFunc` only), `src/agent/conversation.js` only if the handler needs it; `tests/unit/xn_*.test.js` | 1 |
| K The creeper loop | E2 | `src/agent/packs/home/creeper.js`, `src/agent/modes.js` (the creeper mode only), new `scripts/profile_creeper.js` if a script is needed; `tests/unit/xk_*.test.js` | 1 |
| P The job corrections | E3 | `src/agent/job/index.js`, `job_logic.js`, `plan_logic.js`, `job_texts.js`, `src/agent/packs/mining/mining.js` (the supply step, the counter), `src/agent/packs/mining/dig.js` (the wear rule), `src/agent/packs/mining/texts.js` (the new texts), `src/agent/packs/storage/smelt.js`, `smelt_logic.js`, `src/agent/packs/storage/texts.js` (the furnace texts), `src/agent/packs/wood/actions.js` (`ensureTool`), `src/agent/commands/actions.js` (`!getTool`, `!smeltItem` only); `tests/unit/xp_*.test.js` | 1 |
| Q The way and the safety | E4 | `src/agent/library/skills.js` (`goToPosition`, `goToSurface`, `giveToPlayer`, `pickupNearbyItems`: Q2, Q3, Q5, Q6, Q7), `src/agent/commands/actions.js` (`!goToCoordinates`, `!mineOre` only), `src/agent/packs/mining/mine_player.js`, `mine_logic.js`, `mine_way.js` (Q1, Q4), `src/agent/packs/mining/mining.js` (Q4 the full bag, Q9 other ores: after E3's handoff), `src/agent/areas/keep_out_logic.js`, `area_scan.js` (Q8), `src/agent/modes.js` (the item mode: Q6, Q7), `src/agent/packs/home/` (the armour rule: Q6), `patches/mineflayer-pathfinder+2.4.5.patch` (Q3, Q8 the gate rule), `settings.js` and `settings_spec.json` for `mine_other_ores`; `tests/unit/xq_*.test.js` | 2 |
| N2 The supervisor in the chat | E5 | new `src/agent/watch/supervisor.js`, `supervisor_logic.js` (the `message` and `help` events, `reply`, presence, `note`), `src/agent/watch/tools.js` (the registration of `reply` and `note` only, after E1's handoff), `src/agent/bots_logic.js` (the supervisor's name in `shouldAnswer`, after E2's handoff), `src/models/prompter.js` (the note line), `src/mindcraft/voice/voice_logic.js` and `voice_server.js` (the second voice), `src/mindcraft/public/` (the chat of every bot and the supervisor: one file, see 4.6), new `.claude/skills/supervise/SKILL.md`, new `docs/SUPERVISOR.md`, `settings.js` and `settings_spec.json` for `supervisor_name` and `supervisor_voice`; `tests/unit/xv_*.test.js` | 2 |
| M One memory and the cost | E6 | new `src/agent/memory_paths.js`, the stores that open a file of `bots/<name>/worlds/<seed>/` (`src/agent/areas/area_store.js`, `src/agent/packs/mining/mine_store.js`, `src/agent/packs/routes/`, `src/agent/packs/storage/` the chest index, the rules store, the places of `memory_bank.js`: the path only), `src/models/prompter.js` (the two-part prompt), `src/models/claude.js` (the cache mark), `src/agent/cost/price_table.js`, `src/agent/cost/` (the writes), `src/models/gpt.js` (the report of writes), `settings.js` and `settings_spec.json` for `shared_memory` and `prompt_cache`; `tests/unit/xm_*.test.js` | 2 |
| TW Journeys | T3 | `tests/world/w109` to `w118`, `journey.js`, `base_world.js`, `helpers.js`, new `tests/world/supervisor.js` (the scripted supervisor), `tests/world/README.md`, `tests/world/run.js` | 1 (written before the build, fail on the old code), run at every integration |
| TU Unit tests from the spec | T1 | `tests/unit/xt_*.test.js` | 2 |
| G Glue | lead | `CHANGELOG.md`, `docs/`, the merge of the parts | every round |

E2 and E5 both touch `bots_logic.js`: E2 in round 1, E5 in round 2 after the handoff. E3 and E4 both
touch `mining.js` and `actions.js`: E3 in round 1, E4 in round 2 after the handoff, different functions.
E1 and E5 both touch `tools.js`: E1 in round 1 leaves a registration table (4.1) that E5 extends.

## 4. Interfaces

### 4.1 Part S: the watch tools

The server, the protocol and the six tools of v0.1.4.12 stay (`docs/releases/0.1.4.12/SPEC.md` 4.1). The
SSE stream of `GET /mcp` goes: `wait` replaces it; `scripts/watch.js events --follow` becomes
`wait --for any` in a loop and says so in its help. New tools, each `async (agent, args, watch) => text`,
registered in `TOOL_HANDLERS` with their schemas in `mcp_logic.js`; `tools.js` exports
`registerTool(name, schema, handler)` so part N2 adds `reply` and `note` without editing the table.

**`digest`** (`since`: a cursor string the last digest returned, optional). The pure part
`digest_logic.js` takes two snapshots and returns the lines. A snapshot (`snapshotOf(agent)`): position,
dimension, health, food, the running command and its start, the job line, the inventory counts, the
item in hand with its remaining uses, the last chat index, the last event index, the hazards within 8
blocks (`lava`, `water` as a block the bot could walk into, a dropped item), the nearest chest of the
chest index with free slots. The answer, only the lines whose fact changed since the cursor, in this
order, and `Nothing changed.` when none did:

```
Cursor: 184.
At (31, -59, -99) in overworld, moved 12 blocks.
Health 20 of 20, food 15 of 20.
Running: !mineOre("diamond", 28, false) for 138 s.
Job: the mining, 7 of 28 diamond, step 2 of 3.
Inventory: +7 diamond, +25 lapis_lazuli, -1 iron_pickaxe, -4 bread.
Hand: iron_pickaxe, 41 uses left.
Chat: 3 new lines.
[06:45:12] gpt: I mined 0 diamond of 28. I stopped because my pickaxe is nearly broken.
Events: 1 new.
[06:45:12] job_stalled: The job (the mining, 0 of 28 diamond) made no progress for 10 minutes.
Hazards: lava 4 blocks away at (34, -59, -101).
Chest: (16, -59, -98), 22 free slots, 3 blocks away.
```

Without `since`: every line, `Cursor` first. The cursor is a counter the server keeps in memory with the
last 50 snapshots; an unknown cursor gives every line. Chat and events are listed in full when 10 or
fewer are new, else the count and the last 3. The first line is always `Cursor`.

**`wait`** (`for`: `"event"`, `"idle"`, `"done"`, `"any"`; `timeout`: seconds, 1 to 55, default 55;
`since`: a cursor). The server holds the answer until: `event`: a new event; `idle`: no command runs and
nothing ran for 3 s; `done`: the command that ran when the call came has ended (at once with `Running:
nothing.` when none ran); `any`: any line of the digest changes. Then it answers with the digest since
`since`, headed `Woke: event.` (or `idle`, `done`, `changed`). At the timeout: `Woke: timeout.` and the
digest. At most 4 waits at a time; the fifth is refused: `Too many waits: 4 are open.`. A closed
connection ends its wait.

**`run`** (`commands`: an array of 1 to 10 strings, each a `!command(...)`; `stop_on_failure`: bool,
default true). `queue.js`: the commands are handed to `agent.handleMessage(owner, text)` one after the
other, each after the previous one's result; a result whose text is a failure of the skill (`{ ok: false }`
of the pack, or the lines `Failed`, `I could not`, `I cannot`, `Path not found` at the start of the
output) stops the queue when `stop_on_failure`. While the queue runs, a line of the owner that is a
`!command` other than `!stop` is queued behind it, not run; `!stop` empties the queue and stops. The
answer, when the queue is done or stopped, at most 55 s after the call (a longer queue answers with what
is done and `Still running: 2 of 5.` and the rest comes through `digest`):

```
Ran 3 of 3.
1. !takeFromChest("bread", 10): Successfully took 5 bread from the chest.
2. !craftRecipe("stone_pickaxe", 1): Successfully crafted stone_pickaxe, you now have 2 stone_pickaxe.
3. !mineOre("diamond", 28): started.
```

A long skill (`!mineOre`, `!farmCycle`, `!followPlayer`) counts as done for the queue when it has run 2 s
without a failure: the line says `started`. A text that is not a `!command` is refused: `run takes
commands only; use say for words.`

**`look`** (`radius`: 4 to 32, default 16). `look_logic.js` pure over a block reader. The answer, one line
per kind, nearest first, at most 5 of each kind, the kinds in this order and only those present:

```
Ores: deepslate_diamond_ore 3 at (34, -60, -101), redstone_ore 11 nearest at (29, -59, -108).
Lava: 4 blocks away at (34, -59, -101).
Water: none within 16.
Chests: (16, -59, -98) 22 free slots; (11, 7, -100) 27 free slots.
Furnaces: (16, -59, -99).
Ladders: (13, -58, -99) up to 7.
Doors and gates: oak_fence_gate at (-2, 63, 52), closed.
Drops: 3 cobbled_deepslate at (30, -59, -103).
Players: MartyByrde2 at (14, -59, -99), 17 blocks away.
```

The scan reads at most 65,536 blocks (radius 32 is 32 x 16 x 32: 16 up and down); a kind that is absent
is left out, but `Lava` and `Water` are always said (`none within N`).

**`server`**: `Up 42 min, heap 312 of 2048 MB, tick lag 0 ms.`, `Players: MartyByrde2, gpt.`, `Time 14290
(night), weather clear.`, `Model calls 177, session $0.04 (chat $0.03, memory $0.01).` from the cost
meter's session line, `Switches on: watch_server, smelting, voice_ui.` (every boolean setting that is
true, sorted), `Supervisor: connected 12 s ago.` or `Supervisor: none.` (presence of 4.5; `none` until
part N2 exists).

**The report** (`watch_report_seconds` N > 0): every N seconds `events.js` pushes an event of kind
`report` whose text is the digest since the last report, one line, joined with `; `, or `Nothing changed.`
Not counted by `job_stalled`.

**The `help` event** (kind `help`): pushed when a skill or a command ends with a text that asks the
player something: the texts that end with `?`, contain `Say "` or `Tell me` (the list of patterns is
`HELP_PATTERNS` in `events_logic.js`, tested), and only when `settings.supervisor_name` is set. Text:
`Help: "Your mine "deep" has no tunnel where diamond is found. Show me a tunnel at that depth, or tell me to
dig a new mine."`

**The client** `scripts/watch.js`: `digest [since]`, `wait [for] [timeout]`, `run '<cmd>' '<cmd>' ...`,
`look [radius]`, `server`; `--follow` prints a loop of `wait any`. The help text lists them. The pure parts
in `watch_logic.js` with tests.

**Texts** (`texts.js`): every line above, as functions of their numbers.

### 4.2 Part N1: addressing by name

`bots_logic.js` gets `addressedTo(text, names)`: `names` the bot names that may be addressed (the own name,
`settings.other_bots`, `settings.supervisor_name` when set). A line addresses a name when its first word,
with trailing `,`, `:`, `!`, `?`, `.` stripped and compared without case, is that name, or when the name
is one of the first three words preceded by `hey`, `hi`, `ok`, `okay`, `so`, `now`, `please`, `and` (any
of them, in any order: "hey claude, come", "ok so gpt wait"). The answer is `{ name, rest }` with the
addressed name and the line without the address, or `null`. "claude and gpt, come here" addresses none
(both come); a name inside a sentence ("tell gpt to wait") is no address.

`shouldAnswer` gets the row: a line that addresses another name of `names` is not answered, `why:
'addressed_other'`; a line that addresses the own name is answered with `rest` as the text; a line that
addresses the supervisor is not answered (part N2 turns it into an event). The handler of `agent.js`
hands `rest` on to the rest of the pipeline. A test row for each of: own name first, own name after
"hey", other bot first, supervisor first, no name, name inside, both names.

### 4.3 Part K: the creeper loop

F10 of v0.1.4.12: after an explosion that leaves the bot near death (health about 1), the keep-away
loop of `runCreeperProcedure` runs until the heap is gone (W47, about 1 in 30). E2 finds it with a
profiling run inside the agent process (`node --heap-prof` or `--cpu-prof` on the agent process of W47,
started by `run.js` with `MCW_PROFILE=1`, the profile written to `MCW_LOG_DIR`), and with a unit test
that drives `runCreeperProcedure` with a fake bot whose health is 1 and whose creeper never leaves sight:
the loop must end within 30 s of simulated time and allocate a bounded amount (a counter of iterations
below 1,000). Hypotheses to check first: the retreat goal that cannot be reached at health 1 is
re-planned every tick without a wait; a listener added every iteration; the memory of `creeperMemory`
growing without a cap. The fix gets W47 run 30 times by E2 (the one part that runs world tests in round
1: `node tests/world/run.js creeper_in_sight` in a loop, with the server of the cloud), 0 crashes.

### 4.4 Part P: the job corrections

**P1 The supply step** (`mining.js`, `plan_logic.js` `missingSupplies`). Before the step walks anywhere:
the chests within 16 blocks of the bot (the chest index of the storage pack, and the blocks the bot sees)
are read for the missing items first; then the chests the index knows, nearest first; then crafting from
what the bot carries; the surface last. The text names where it goes: `I get my supplies: 10 bread from
the chest at (15, -59, -99).` The second pickaxe: the step wants a spare pickaxe only when the one in hand
has fewer than 50 uses left or when none is in the bag; a spare is crafted from carried material, never
fetched from the surface while the mining can go on.

**P2 Tool wear** (`dig.js`, `mining.js`). Before each dig the pack reads the uses left of the tool in
hand (`maxDurability - durabilityUsed`). At 10 or fewer: a replacement from the bag (a pickaxe that can
mine the ore) is equipped, else crafted from carried material at the crafting table of the bag or within
16 blocks, with the text `My iron_pickaxe is nearly worn: 8 uses left. I made a new one.`; when nothing
can be made: `My iron_pickaxe is nearly worn: 8 uses left. I have no iron for a new one. I stop the mining
at 7 of 28 diamond.` The old pickaxe is kept in the bag, not thrown. The old stop text `I stopped because
my pickaxe is nearly broken` is said only after this text.

**P3 The plan starts** (`job/index.js`, `plan_logic.js`, `wood/actions.js` `ensureTool`, `!getTool`). A
plan that `!getTool` or a job made runs its first step at once, in the same call, and says the plan once:
`I have no iron ingot. I get raw_iron and iron_ingot, then I go on.` then `Step 1 of 3: !mineOre("iron",
3).` The journey W113 measures it: no second order.

**P4 The furnace in the bag** (`smelt.js`). When no furnace is within the range the guard allows and the
bag holds one, the bot places it on a free solid cell within 3 blocks of itself in a saved area of kind
storage, building or mine, or where it stands when it is underground in a mine it knows, and uses it:
`I placed my furnace at (16, -59, -99).` then the smelt text. `I know no furnace within 64 blocks and carry
none.` only when both hold.

**P5 The counter** (`job_logic.js`, `mining.js`). The job's `got` is set from the skill's own count each
time the skill reports progress (the pack calls `ctx.job?.progress?.(got)`), and the stop text and the
job line say the same number. A unit test with a fake pack that reports 7 asserts both texts.

**P6 No cancel by the model** (`agent.js` is E2's in round 1; so P6 lives in `job/index.js` and
`commands/`): a command the model picks while a skill of a job runs is not executed; it is answered to
the model as `The mining runs, 7 of 28 diamond. Say !stop first.` (a system line, no chat), unless it is
`!stop`, `!stats`, `!inventory`, a query. The owner's typed `!command` keeps today's behaviour (it stops
the skill), except through `run` of part S, which queues.

### 4.5 Part N2: the supervisor in the chat

`supervisor_logic.js` pure, `supervisor.js` the glue. With `settings.supervisor_name` set:

- A line of the owner that `addressedTo` resolves to the supervisor becomes an event of kind `message`:
  `Message: "why is it going to the surface?"` with `data.from`, and no bot answers it. When no supervisor
  is connected (presence: no `wait` or `digest` call within 60 s), one bot (the first of the mindserver's
  agents, so two bots do not both answer) says `The supervisor is not here.`
- **`reply`** (`text`, 1 to 256 characters): the bot relays the line into the chat as
  `[Opus] <text>` (the configured name); the line is one no bot answers (`shouldAnswer`: `why:
  'supervisor'`), and the page speaks it with `supervisor_voice`.
- **`note`** (`text`, 1 to 200 characters; `minutes`, 1 to 120, default 30): the prompter inserts
  `Supervisor: <text>` as one line after the role line of v0.1.4.12 (or where the role line would be);
  one note at a time, the newer replaces the older; expired notes vanish. `note` with an empty text clears
  it. Answer: `Noted for 30 min: "the chest at (15, -59, -99) has bread".`
- Presence: `server` says `Supervisor: connected 12 s ago.`; the `help` and `message` events are kept in
  the ring whether or not a supervisor is connected.

The page: the chat shows the lines of every bot and the supervisor's relayed lines, each with its name
in front; the dropdown of the bot you talk with puts that name in front of the recognised speech (`claude,
...`), and "everyone" sends it plain. The speaking voice is the bot's `voice_voice` for a bot's line and
`supervisor_voice` for a line that starts with `[<supervisor_name>]`.

`.claude/skills/supervise/SKILL.md` (for a Claude Code session in the repository): the loop, the standing
rules, what never to do, the report format; it names the tools and the client, nothing of the code.
`docs/SUPERVISOR.md`: the setup for the owner (the token, the tunnel, `claude mcp add --transport http
mindcraft <url> --header "Authorization: Bearer <token>"`), the one sentence to give the supervisor, the
cost (a cent a turn in a fresh session).

### 4.6 Part Q: the way and the safety

**Q1 `!mineOre` from where the bot stands** (`mine_player.js`, `mine_logic.js`, `!mineOre`). Underground,
in no mine it knows, with `mine_from_inside` off or on: the room within 8 blocks that has a chest or a
crafting table, or the bot's cell when there is none, becomes the mine `"mine N"` (the next free name) with
the way in unknown, and the tunnel the bot stands in (1 or 2 wide, 2 high, or up to 4 wide when earlier
mining widened it: `measureTunnel` takes a width up to 4 when the floor is level and the ceiling closed)
becomes its tunnel; then the mining starts: `I made the mine "mine 2" here and measured the tunnel: it
starts at (30, -59, -100), goes north, 4 blocks. I dig on at its end.` The old refusal is said only when
the bot stands in open rock with no tunnel in any direction.

**Q2 `!goToSurface`** (`skills.goToSurface`): before the search for open sky, the routes of the routes
pack whose end is under the sky and whose start is within 8 blocks, and the way out of a known mine
(`WAY_OUT_COMMAND`), are tried; the text names what it walked: `I take the route "basement_to_surface".`

**Q3 Two ladder places** (the pathfinder patch, `mine_way.js`): the top of a ladder into a corridor (the
cell above the last rung is air and the corridor starts beside it: the move steps off sideways) and a
ladder whose top is under a trapdoor (the trapdoor is opened from the ladder, the move goes through it).
W80 to W84's climbs stay smooth.

**Q4 The full bag** (`mining.js`, after E3's handoff): when the bag is full during the mining, the pack
stores in the chest of the mine (the mine's room), else the nearest chest of the index within 32 blocks,
the kinds that are not tools, food, torches, ladders or the ore mined: `I stored 203 cobbled_deepslate and
65 gravel in the chest at (16, -59, -98) and go on.`; only when no chest has room: `My bag is full and no
chest within 32 blocks has room. I stop the mining at 7 of 28 diamond.`

**Q5 `!givePlayer`** (`giveToPlayer`): the toss from 2 blocks, then 3 blocks back, the wait of 3 s as
today; the item mode ignores an item the bot tossed itself for 30 s (`modes.js`, a set of tossed entity
ids with their time). The text of a kit: when `num` is more than 8 of one kind or the line names more than
3 kinds, the answer is `That is a lot. Say "put my stuff in the chest" and I put it in the nearest chest.`
and nothing is thrown.

**Q6 Death drops and armour** (`modes.js` the item mode, `pickupNearbyItems`, the home pack's armour
rule if one exists): the item mode records each player's death (`bot.on('playerDeath')` is not in the
library: the chat line `<name> fell from a high place` and the family of death messages, or the entity
vanishing at health 0; E4 picks and documents) with its position; items within 4 blocks of that position
are not picked up for 5 minutes, and the bot never equips armour it did not craft or take from a chest
(a set of item entity ids the bot picked from the ground: those are never equipped by the auto-equip of
the home pack). Text when it leaves them: `I leave MartyByrde2's things at (13, -57, -99).`

**Q7 No shaft** (`!goToCoordinates`, `goToPosition`): when the target is more than 3 blocks below the bot
and the path found is destructive straight down (every step of the path within 1 block of the vertical
line), the walk is refused: `I do not dig a shaft 64 blocks down. Say "dig down" if you mean it, or show me
stairs.` A target reached by stairs, a ladder or a slope is walked.

**Q8 The pen** (`keep_out_logic.js`, `area_scan.js`, the pathfinder patch): `isKeepOutArea` holds for a
saved area of kind pen or farm, and for the enclosure the scan returns as a pen with animals when the bot
is within 8 blocks of its gate (`area_scan` already finds it for the sense); the gate of such an enclosure
is never opened by the path, the item mode, `!useOn` or the model's code (`bot.activateBlock` on a gate
that is in a pen is refused in `skills.useToolOnBlock` and in the sandbox's bot proxy); the bot says, once
per minute: `That is a pen with 26 chickens; I do not open its gate. Say "open the pen" if you mean it.`;
after "open the pen" (`!allowChanges` with the pen, as a saved pen's rule) the gate is used and closed
behind the bot.

**Q9 Other ores** (`mine_other_ores`, `mining.js`): while mining one ore, an ore block of another kind the
tool in hand can mine, exposed in the wall, floor or ceiling of the tunnel cell just dug, is mined too
and counted: the stop and done texts add `, and 11 redstone and 4 lapis_lazuli on the way`.

### 4.7 Part M: one memory and the cost

**M1 `shared_memory`** (`memory_paths.js`): `worldDir(agentName, seed, settings)` returns
`bots/shared/worlds/<seed>/` when `shared_memory` is on, else `bots/<name>/worlds/<seed>/`, for the
stores of areas, places, routes, mines, chests and rules; the chat memory, the histories and the job stay
per bot. Two processes write the same files: each store writes atomically (a temp file and a rename) and
re-reads the file before a write when its mtime changed. A bot that finds a file of the shared folder
missing and its own folder present copies its own once and says `I share the memory of this world now.`

**M2 `prompt_cache`** (`prompter.js`, `claude.js`): with the switch on, `replaceStrings` builds the system
prompt as two parts: the fixed part (the template up to and including `$COMMAND_DOCS`, with `$NAME` and
`$SELF_PROMPT` filled, the placeholders `$MEMORY`, `$STATS`, `$INVENTORY`, `$KNOWLEDGE`, `$EXAMPLES`
removed from it) and the changing part (those placeholders in their order of the template). The system
message handed to the model is the fixed part, then the changing part. `claude.js` sends `system` as two
blocks with `cache_control: { type: 'ephemeral' }` on the first. Every other model gets the joined string.
The role line and the note stay in the changing part. A unit test asserts that the fixed part of two
calls is byte-identical while memory and inventory differ.

**M3 The cost meter**: `price_table.js` gets `cache_write` for `gpt-6-luna` (0.125); `gpt.js` reports
`cache_write_tokens` as the prompt tokens that were not cached when the prompt is 1,024 tokens or longer;
the session line and the scorecard show writes. The journey W13 (cost) stays green.

## 5. The journeys (T3)

Black box, written from `PLAN.md` and this section only, the control never moves the bot, each with an
empty memory, the owner's switches of v0.1.4.12 plus the switches of this release on, failing on
v0.1.4.12. The scripted supervisor (`tests/world/supervisor.js`) is a client of the watch server in the
test process: `wait`, `digest`, `run`, `look`, `reply`, counted calls.

| Id | Name | What |
|---|---|---|
| W109 | supervised_mining | The bot in the mine room of the base with the mine saved and 4 bread; `run ['!mineOre("iron", 6)']`; the supervisor loops `wait any` and acts by two rules only: a `help` or a failure line gets `run` of the fix, `idle` with the job unfinished gets the job's command again; at most 6 wakes until the job is done: 6 raw_iron in the bag (server), the supervisor's wakes 6 or fewer, no `wait` answered later than 60 s. |
| W110 | two_bots_names | Two bots 6 blocks from the player; "claude, come here": within 20 s claude within 2 blocks, gpt did not move more than 1 block and said nothing; "come here": both within 2 blocks within 20 s. |
| W111 | supervisor_chat | `supervisor_name` "Opus"; the player says "Opus, where is it?": no bot answers (no bot line within 10 s), `wait event` of the supervisor got the `message`; `reply "It is in the tunnel."`: the chat holds `[Opus] It is in the tunnel.` and no bot answered it; without a supervisor (no call for 60 s): "Opus, hello" gets exactly one line, `The supervisor is not here.`, from one bot. |
| W112 | bread_beside_tunnel | The mine room with a chest holding 20 bread 4 blocks from the tunnel, the bot with 0 food items and food 12 of 20; `!mineOre("iron", 6)`: within 60 s the bot took bread from that chest (the chest's count fell, the bag's rose), it did not climb to the surface (y never above the room's level + 3), the supply text names the chest. |
| W113 | furnace_in_bag | A furnace in the bag, none within 64 blocks, 3 raw_iron in the bag, 2 planks; `!getTool("iron_pickaxe")`: with no second order, within 3 minutes a furnace stands within 3 blocks of where the bot stood (server), the bag holds an iron_pickaxe, the plan text and the step text were said. |
| W114 | worn_pickaxe | The bot's iron pickaxe worn to 12 uses (the control gives it with damage), 3 iron_ingot and 2 sticks in the bag; `!mineOre("iron", 6)`: the mining ends with 6 raw_iron, the bag holds a new iron_pickaxe and the old one, the wear text was said, no "nearly broken" stop. |
| W115 | shaft_and_drops | A: `!goToCoordinates(x, y-20, z)` with rock below: the refusal text, the bot within 2 blocks of where it stood after 20 s, no block below the bot broken. B: the player bot dies 3 blocks from the bot (the control kills it) with iron boots and 5 iron ingots: after 60 s the items lie within 4 blocks of the death (server entities), the bot wears no boots, the leave text was said once. |
| W116 | unsaved_pen | The base's pen with its 6 chickens, not saved, the player walks through it (the control opens and closes the gate for the player) and says "follow me": within 60 s the gate is closed (server), no chicken outside the fence, the bot said the pen text; then "open the pen" and "follow me": the bot passes and the gate is closed within 10 s after. |
| W117 | shared_mine | Two agents with `shared_memory`; bot A `!rememberMine("deep")` in the mine room; bot B 20 blocks away `!mines`: names "deep"; bot B `!goToMine("deep")`: within 90 s in the room. |
| W118 | full_bag | The bag full but 2 slots, a chest with 20 free slots in the mine room; `!mineOre("iron", 6)` in a tunnel seeded with cobblestone and gravel to dig: the mining ends with 6 raw_iron, the chest holds the cobblestone, the store text was said, no stop for the bag. |

## 6. The unit tests from the spec (T1, round 2)

`tests/unit/xt_*.test.js`: the digest lines from staged snapshot pairs (every line of 4.1, the unchanged
ones absent), `wait`'s wake rules from staged state, the queue's stop rule, `look`'s lines from a block
fixture, the `help` patterns, `addressedTo` for every row of 4.2, the supply order of P1 from a chest
fixture, the wear rule of P2 at 11, 10, 0 uses, P5's two texts, Q5's kit rule, Q7's shaft rule on three
paths, Q8's enclosure rule, the two-part prompt of M2, the writes of M3.
