# SPEC v0.1.4.8 "Stability"

This is the spec as the engineers got it on 2026-09-29. Paths of the machine of the lead are replaced by words. The findings of the play test that the spec refers to by ids (S1, E1, P1 ...) are kept by the lead and not in the repository, because they quote the chat of the owner.

Tech lead: Fable. Base: `origin/main` at `b4bf9b8` (tag `v0.1.4.7`). Branch: `hotfix/stability`.
Work folder: one worktree shared by all engineers.

The plan for the owner is `PLAN.md`. The notes between the parts are `HANDOFF.md`; where they disagree with this spec, they win. The defects that the real server found, with the decisions, are `DECISIONS.md`.

## 0. Rules for every engineer

1. **Never read, create, copy, stage or print `keys.json`.** Never read a secret. Never run
   `test-routing.ps1` and never run `scripts/routing_check.js` without `--dry-run`.
2. **Never connect to port 55916** (the world of the owner). The test server is on 127.0.0.1:25599.
   Kill only processes that you started, by process id.
3. **No git command that writes** (commit, checkout, stash, reset, pull, push, add). The tech lead commits.
4. **File ownership is strict.** You change only the files of your part (section 3). When you need a change
   in a file of another part, write the request into your report; do not make it.
5. Never change anything under `the checkout of the owner` (the checkout of the owner).
6. Run single test files while you work (`node --test tests/unit/<file>`). Run `npm test` once at the end.
   Do not run `npm run test:world` unless your part says so: one run takes more than 20 minutes and uses
   the one test server.
7. New behaviour has a switch in `settings.js` and is off by default (section 2). A correction of a defect
   has no switch. When a switch is off, the behaviour is that of v0.1.4.7, except for the corrections.
8. Match the style of the file you change: comment density, naming, CRLF or LF as the file has it.
9. Texts that the bot says or returns are plain English, short sentences, with numbers. No word of a
   text may claim what the code did not do.
10. A function of a pack never throws to its caller. It returns `{ ok, reason, text }`.
11. Report at the end, as your answer (do not write report files): what you changed per file, what you
    did not do and why, requests to other parts, test results with numbers, and everything that surprised
    you.

## 1. Goal and acceptance of the release

| Goal | Measured by |
|---|---|
| No restart in play | Long run W60: 30 minutes of mixed orders with all reflexes on, the process never ends |
| The bot eats | W41, W42 |
| Nothing that was built is broken | W43, W44 |
| Reflexes know where the bot is | W45 to W48 |
| A work skill finishes with reflexes on | All scenarios w15 to w28 pass with the modes of the profile on |
| A stopped command reports | W33 |

Unit tests, end-to-end tests and world tests all pass in a fresh checkout.

## 2. Settings

New keys in `settings.js` and `src/agent/settings_spec.json` (part G owns both files):

| Key | Default | Type | Meaning |
|---|---|---|---|
| `stuck_restart_after` | `1` | int >= 0 | Failed escapes in a row before the process restarts. 1 is the behaviour of v0.1.4.7. 0 means never. |
| `protect_built_blocks` | `false` | bool | The bot never breaks blocks that players build with, also outside saved areas |
| `knowledge_in_prompt` | `false` | bool | A block "what I know" in the chat prompt |
| `knowledge_max_chars` | `600` | int | Upper limit of that block |
| `repeat_guard` | `0` | int >= 0 | The Nth identical failure in a row is refused. 0 means off. |
| `restart_context` | `false` | bool | After a restart the bot is told its last order and the reason of the end |
| `say_results` | `false` | bool | When the model answers nothing after a skill, the text of the skill goes to the chat |
| `flee_below_health` | `0` | int 0..20 | Below this health the bot does not attack, it retreats. 0 means off. |
| `log_timestamps` | `false` | bool | `[HH:MM:SS]` before each line of the console |
| `home_reflexes.hunger` | `true` | bool | Part of `home_pack`: the hunger reflex |

`ore_sense_range` is NOT part of this release (v0.1.4.9).

## 3. Parts, owners, files

| Part | Engineer | Files (owned) | Round |
|---|---|---|---|
| A Reflex engine | E1 | `src/agent/modes.js`, `src/agent/action_manager.js`, `src/agent/coder.js`, `src/utils/kill_timer.js`, new `src/agent/reflex/*.js` | 1 |
| B Library | E2 | `src/agent/library/skills.js`, `src/agent/library/world.js` | 1 |
| D Areas | E4 | `src/agent/areas/*` | 1 |
| C Home pack | E3 | `src/agent/packs/home/*` | 2 |
| E Work packs | E5 | `src/agent/packs/storage/*`, `packs/farming/*`, `packs/wood/*`, `packs/mining/*`, new `src/agent/knowledge/*.js` | 2 |
| F Process | E7 | `patches/*`, `main.js`, `src/process/*`, `src/agent/cost/*`, new `src/utils/log_time.js`, new `src/agent/restart_context.js`, new `src/agent/repeat_guard.js` | 2 |
| G Glue | E6 | `src/agent/agent.js`, `src/agent/commands/*`, `src/models/prompter.js`, `profiles/defaults/_default.json`, `settings.js`, `src/agent/settings_spec.json`, `tests/routing/*`, `CHANGELOG.md` is the tech lead's | 3 |
| TU Unit tests | T1 | `tests/unit/*` (new files with the prefix `st_`), `tests/helpers/*` | 3 |
| TW World tests | T2 | `tests/world/*`, `tests/e2e/*` | 3 |

Engineers of round 1 and 2 also write unit tests for their own pure modules, in files with the prefix of
their part: `tests/unit/sta_*.test.js` (A), `stb_` (B), `stc_` (C), `std_` (D), `ste_` (E), `stf_` (F). The
testers write the tests of the spec, not of the code, in `st_*.test.js`.

Existing tests that a change makes wrong: the engineer of the part corrects them and names them in the report.

## 4. Interfaces between the parts

These are fixed. Build against them, also when the other part is not there yet.

### I1. Progress for `unstuck` (A gives, all use)

`bot.modes.noteProgress(reason)`: a method of `ModeController`. It sets the time of the last progress.
`unstuck` does not count the time before it. Optional chaining at the caller: `bot.modes?.noteProgress?.('chest')`.

`bot.modes.pause('unstuck')` exists. Part G calls it at the start of every pack command (in `runPack` and
in the commands of the home pack). So a pack need not pause by itself. A pack keeps its own time limits.

### I2. Where the bot is (A gives the function, G binds it)

`src/agent/reflex/ground_logic.js`, pure:

```js
// columns: the 8 columns at the offsets (4,0) (-4,0) (0,4) (0,-4) (3,3) (3,-3) (-3,3) (-3,-3) from the bot
export function groundLevelAround(getBlockName, pos, top)   // -> number | null
export function depthUnderGround(getBlockName, pos, top)    // -> number, 0 when the ground is unknown
export function isUnderground(depth)                        // -> depth > 8
```

The ground of a column is the highest block, from `top - 1` down, that is none of: air, leaves, a log, a
built block (`isBuiltBlock`), a plant without collision. `null` (not loaded) columns are left out. With
fewer than 3 known columns the result is `null`. The ground level is the median of the known columns.

`agent.whereAmI()` (part G) returns `{ area: { name, type } | null, depth: number, underground: boolean }`.
`underground` is true when `isUnderground(depth)` or when the bot is inside an area of type `mine`.
It is put on the contexts: `ctx.whereAmI`.

### I3. Guard (D gives, B and G use)

`bot.areaGuard` stays a frozen read-only view. New on it:

```js
bot.areaGuard.areaAt(pos)            // -> { name, type } | null, the smallest area that holds pos
bot.areaGuard.refusal(pos, action)   // action: 'break' | 'place' | 'use'
                                     // -> null | { reason: 'area' | 'built_block', area: string|null, text: string }
bot.areaGuard.isBuilt(name)          // isBuiltBlock of area_scan.js
bot.areaGuard.placedByBot(pos)       // -> boolean
```

`inBuilding(pos)` stays and is true for the types `home`, `building`, `pen`.

Who ordered: the full guard `agent.area_guard` gets `setPlayerOrder(fn)`; `fn()` returns true while the
running command was typed by a player in the chat (part G: `agent.last_order` is set and its command is
the running one). A command typed by the player overrides `built_block`, never `area`.

### I4. Area types (D gives)

`export const AREA_TYPES = ['home', 'building', 'farm', 'pen', 'mine']` in `src/agent/areas/area_store.js`.
Part G imports it; the list in `actions.js` goes away.

### I5. Result of a stopped command (A gives, G uses)

`runAction` returns, when the action was interrupted: `{ success, message, interrupted: true, timedout,
stopped_by: string }`. `message` holds the output so far (not empty text when there is output).
`stopped_by` is one of: `the reflex <mode name>`, `the command !<name>`, `!stop`, `a new message`.

Part G: a stopped command starts no turn of the model. Its text goes into the history as a system
message: `Command !mineOre was stopped by the reflex unstuck. Done so far: <text>`.

### I6. Pack result when stopped (C and E give)

A pack function that was interrupted still returns `{ ok: false, reason: 'interrupted', text }`, and `text`
says what was done: `I cut 3 oak_log and picked up 2. I was stopped before I picked up the rest.`

### I7. Food (C gives, B and E and G use)

In `src/agent/packs/home/food.js`, exported by `packs/home/index.js`:

```js
export function foodItems(bot)               // all food the bot carries, the off-hand included
export async function moveOffhandBack(bot)   // moves a food item of slot 45 into the inventory; { ok, moved, text }
export function knownFood(ctx)               // [{ name, count, chest: {x,y,z} }] from the chest index, banned food left out
```

### I8. Doors (C gives, A and G use)

In `src/agent/packs/home/doors.js`, exported by `packs/home/index.js`:

```js
export function createDoorService(bot, ctx)  // -> { tick(), stop(), closeNear(range) }
```

`tick()` is quick and starts no action. Part A calls it from the mode `door_closing`, which becomes a
background mode (A3). `closeNear(6)` is the function of `!closeDoor`.

### I9. Knowledge text (E gives, G uses)

`src/agent/knowledge/knowledge_text.js`, pure:

```js
export function knowledgeText({ chests, areas, mines, places, where }, maxChars = 600)  // -> string
```

### I10. Restart context, repeat guard, log time (F gives, G uses)

```js
// src/agent/restart_context.js
export function writeExit(dir, { reason, order, action, position, time })   // never throws
export function readExit(dir, maxAgeMs = 10 * 60 * 1000)                    // -> object | null, deletes the file
export function restartNote(exit)                                           // -> string for the init message

// src/agent/repeat_guard.js
export class RepeatGuard { constructor({ limit, windowMs = 5 * 60 * 1000, now })
    check(name, args)            // -> null | string (the refusal text), before the command runs
    record(name, args, result) } // after the command ran

// src/utils/log_time.js
export function installLogTime(enabled, now = () => new Date())   // wraps console.log, warn, error once
```

## 5. Part A: reflex engine (E1)

### A1. What counts as stuck (S1)
Pure module `src/agent/reflex/stuck_logic.js`. A sample is `{ pos, digTarget, inventoryKey, windowOpen,
sleeping, usingItem, notedAt }`. The time of being stuck starts again when, against the last sample: the
position moved 2 blocks or more; the dig target changed; `inventoryKey` changed; a window is open; the
bot sleeps; the bot uses an item; `notedAt` is newer than the start of the stuck time. `inventoryKey` is a
short text of the counts of all slots, the off-hand included. Limit 20 s, 40 s for obsidian, as today.

### A2. A failed escape does not kill (S1, S2)
- `unstuck` says `I'm stuck!` and runs `skills.moveAway(bot, 5)` with a limit of 10 s, as today.
- Success: `I'm free.`, the count of failed escapes is 0.
- Failure (time over, or the bot is still within 2 blocks of where it stood): count + 1.
  - `stuck_restart_after > 0` and count >= `stuck_restart_after`: `cleanKill("Got stuck and couldn't get unstuck")`, as today.
  - Otherwise the reflex gives up: it stops the path search (`bot.pathfinder.setGoal(null)`), writes one
    line into the behaviour log, and pauses itself until a new command starts or the bot moved 2 blocks.
    The line: `I am stuck at (x, y, z) and could not walk away.` plus ` I am in the area "<name>" (<type>).`
    when `bot.areaGuard.areaAt` says so, plus ` A <block name> is at (x, y, z).` for the nearest door, gate
    or trapdoor within 3 blocks.
- The existing automatic message tells the model. No new message path.
- `kill_timer.js`: add `withTimeLimit(ms, fn)` that resolves `{ done: boolean, value, error }` and never
  kills. `withKillTimer` stays for other callers.

### A3. Background modes (R5)
A mode with `background: true` is updated on every tick, also while another mode is active and while an
action runs. It must not call `execute`. `door_closing` gets `background: true` and calls the door service
(I8). The other modes keep the exclusive chain.

### A4. Result of a stopped action (S3)
See I5. `getBotOutputSummary` no longer returns an empty text for an interrupted action. The action manager
knows who stops: `stop()` gets an optional argument `by`; `_executeAction` passes the label of the new
action; the agent passes `!stop` and `a new message` (part G calls `requestInterrupt(by)`).

`MAX_OUT` becomes 1500. A cut never splits a line: whole lines from the start and whole lines from the end.

### A5. A newer command ends an older resume (S5)
When an action with a label `action:*` starts with `resume: false`, the resume function is cancelled.
An action that a mode starts does not cancel it.

### A6. Code generation can be stopped (S10)
In `coder.js` the wait for the code model ends when `bot.interrupt_code` is set: poll every 200 ms. The
late answer of the model is dropped. The result is `{ interrupted: true }` as for other interrupts. No
code of a dropped answer runs.

### A7. Underground (R1, M8)
`depthUnderSurface` and `nightShelterWaits` in `modes.js` are replaced by `ground_logic.js` (I2).
`night_shelter` waits while `agent.whereAmI().underground` is true, with or without `mining_pack`.
`night_shelter` reads the shelter from the home pack (C4); when there is none it does nothing.

### A8. Items on the ground (P2)
`item_collecting`: after a pick-up that gained nothing, the same item is tried again after 3 s, at most 3
times. The rule `prev_item` must not block these tries. An item that the bot itself dropped in the last
10 s is left.

### A9. Hunger and `self_preservation` (E5)
`self_preservation` does not run away when the damage is hunger: the food level is 0, the bot is not in
lava, fire or water over its head, and no hostile mob is within 16 blocks. It writes
`I am starving.` into the behaviour log once per 60 s and leaves the rest to the hunger reflex.

### A10. Retreat at low health (E6)
With `flee_below_health` > 0 and health below it, `self_defense` does not attack. It goes to the nearest
player within 32 blocks, else into the shelter of the home pack, else `moveAway(10)`. One line in the
behaviour log: `I am hurt (health N of 20). I retreat.`

### A11. Mode `hunger`
New mode entry `hunger`, on when `home_pack` and `home_reflexes.hunger`, placed after `self_preservation`.
It calls `hungerStep` of the home pack (C2) every 2 s. It uses `execute` only for the walk to a chest.

## 6. Part B: library (E2)

### B1. `collectBlock` (P1, F4)
- Before each block: `bot.areaGuard?.refusal(pos, 'break')`. A refused block is no candidate. When every
  candidate is refused, the text is the `text` of the refusal, for example:
  `oak_fence is a block that players build with. I do not break it. The player can type the command !collectBlocks("oak_fence", 20) in the chat to do it.`
- The count in the result is what the inventory gained, not what was broken:
  `Collected 3 oak_log.` or `I broke 10 tall_grass and got nothing. tall_grass drops nothing without shears.`
- `breakBlockAt` and `placeBlock` ask the guard the same way (they are already wrapped by the guard for
  areas; make sure the new reason reaches the output).

### B2. Off-hand (E1)
`consume`, `discard`, `equip` and the inventory functions of `world.js` see slot 45. `consume` of an item
in the off-hand moves it to the hand first. The text of `!inventory` gets one more line when the off-hand
holds something: `In the off-hand: bread 6`. Counts include the off-hand once.

### B3. Walking (S9, S11, P5)
- `goToGoal` watches `bot.interrupt_code` every 250 ms and calls `bot.pathfinder.setGoal(null)`, like
  `gotoGoal` of `packs/home/motion.js`. An interrupted walk ends within 1 s.
- `moveAway` gets door help also while the door reflex is on: it may open a door, gate or trapdoor in its
  way. The door service closes it afterwards.
- The result of `goToPosition` names the real position: `You have reached (x, y, z).` when the bot is
  within the closeness, else `I stopped at (x, y, z), N blocks from the goal.`
- `goToPosition` calls `bot.modes?.noteProgress?.('path')` while the path search reports movement.

### B4. `pickUpItems(bot, name = '', range = 16)`
New. Walks to dropped items within `range` (all, or those with the item name), nearest first, waits for
the pick-up delay, at most 60 s in all. Returns true when the inventory gained something. Output:
`I picked up 8 oak_fence, 1 oak_fence_gate.` or `I see no items on the ground within 16 blocks.` or
`I could not pick up 3 items: <names>.`

### B5. Chest view (C3)
`viewChest` prints one line: `The chest at (x, y, z) contains: leaf_litter 104, cobblestone 81, ...`, same
item names added up, ordered by count. An empty chest: `The chest at (x, y, z) is empty.`

### B6. Small corrections
- `smeltItem`: the text counts what the bot gained, not what lay in the output slot before (T6).
- `discard`: the walk away before the toss has a limit of 3 s; when it fails the item is tossed where
  the bot stands (S14).
- `defendSelf`: no change here (A10 decides before it is called).

## 7. Part D: areas (E4)

### D1. Types and names (P3, P7)
- `AREA_TYPES` (I4). Names are normalised on save and on lookup: trimmed, lower case, spaces to `_`.
- On load: two areas whose normalised names are equal become one, the newer wins.
- On load, once, written to the console: an area of type `building` whose name holds `mine` or `mining`
  becomes type `mine`; an area with a side of less than 2 blocks (x or z) is dropped.

### D2. Rules per type

| Type | Break | Place | Path search may dig | Shelter | Defended against creepers |
|---|---|---|---|---|---|
| `home` | no | no | no | yes | yes |
| `building` | no | no | no | no | yes |
| `pen` | no | no | no | no | yes |
| `farm` | crops only, as in v0.1.4.7 | seeds, as in v0.1.4.7 | no | no | yes |
| `mine` | natural blocks yes, built blocks no | yes | natural blocks only | no | no |

`!allowChanges` keeps its meaning for every type.

### D3. Built blocks everywhere (P1)
With `protect_built_blocks` on, `refusal(pos, 'break')` returns `{ reason: 'built_block' }` for a block with
`isBuiltBlock(name)` outside every area, unless `placedByBot(pos)` or the player ordered it (I3). The path
search gets the same rule through the exclusion function that the guard already installs: cost 100.

`isBuiltBlock` gains: beds, signs, banners, `composter`, pressure plates, buttons, rails, `lever`,
`flower_pot`, campfires, `anvil`, `cauldron`, `hopper`, `bell`, `lectern`, `loom`, shulker boxes, `_stairs`
and `_slab` of every material. Natural names that would match stay natural (`NATURAL_NAMES`).

### D4. What the bot placed
`src/agent/areas/placed_store.js`: positions of blocks that the bot placed, per world, in `placed.json` in
the folder of the world, at most 5000, the oldest leave. Fed by the wrapped `bot.placeBlock` after
success. A position leaves when the bot breaks the block. Saved at most once per 5 s and at the end.

### D5. Scans (P5, P6)
- `scanFarm` takes ground for a farm only when it is fenced and holds at least 1 block of farmland or 1
  crop, and when fewer than half of its cells have a solid block within 4 blocks above.
- New `scanPen`: fenced ground without farmland. Used for the type `pen`.
- New `findFencedGroundNear(getBlock, pos, range = 6)`: when `pos` is outside or on the fence, it tries the
  walkable cells within `range`, nearest first, and returns the first scan that is enclosed, with the
  position of its gate, or a reason: `no_fence_near`, `not_closed`, `too_big`.
- Every failure of a scan has a reason code and a text that says what to do, for example:
  `I stand outside the fence. The gate is at (x, y, z). I can save the ground behind it.`

### D6. The house (M5, R2)
`autoHome(getBlock, places, store, botPos)`: when no area of type `home` exists and the place `home`
exists and is loaded and within 48 blocks: scan the building from the place, save it as `home`, type
`home`, source `auto`. Returns `{ saved, text }`. Text:
`I saved your house as the area "home": 9 x 6 x 11 blocks, 2 doors. Tell me if that is wrong.` or
`I know the place "home" but I find no walls there. Stand in your house and tell me that this is home.`
At most one try per start.

### D7. Replacing an area (P4)
`canReplace(old, box, byPlayer)`: false when the model wants a box with a side (x or z) of less than 2
blocks, or replaces an area by a box of less than half its volume. The player can, by typing the command.
Text of the refusal: `The new box is much smaller than the area "<name>" that I know. The player can type !setArea in the chat to do it.`

## 8. Part C: home pack (E3)

### C1. Food (E1, E2, E4)
- `autoEatOptions`: `offhand: false`. `AUTO_EAT_DEFAULTS.offhand` false too.
- `foodItems`, `moveOffhandBack`, `knownFood` (I7). `!eat` and the choice of food use `foodItems`.
- `!eat` eats until the food level is 18 or more. When health is below 20 it eats until 20 while it has
  food.
- Texts of `!eat`:
  - `I ate 2 bread. Food 19 of 20, health 12 of 20.`
  - `I am not hungry. Food 19 of 20, health 20 of 20.`
  - `I carry no food. The chest at (11, 67, 53) has 5 apple.` or `I carry no food and know no chest with food.`
- The description of `!eat` (part G) follows the behaviour.

### C2. Hunger reflex (E3)
Pure `hungerDecision(input)` in `food_logic.js`; input `{ food, health, carries, known, idle, playerOrder,
lastSaid, now }`; result `{ action, text }`:

| Case | Action |
|---|---|
| carries food, and food <= 14, or food <= 17 and health < 20 | `eat` |
| carries none, food <= 10, idle, `known` not empty | `fetch` (storage pack: `ctx.storage.fetchItem`), then `eat` |
| carries none, food <= 10, not idle or nothing known | `say`: `I am hungry and carry no food. Food N of 20.` once per 5 minutes |
| carries none, food <= 3, no order of the player runs, `known` not empty | `fetch`, also when busy |
| carries none, food <= 3, nothing known | `say`: `I am starving. I have no food and know no chest with food.` once per 2 minutes |

`hungerStep(bot, ctx, state)` executes it. The texts go to the chat and into the history, without a call
of the model.

### C3. Creepers (R3)
- The context gives per creeper: `dBot`, `dy` (creeper y minus bot y), `sight` (no solid block on the line
  from the eyes of the bot to the middle of the creeper).
- A creeper counts for the bot only when `|dy| <= 4` and (`dBot <= 6` or `sight`).
- A creeper counts for an area only when the type is defended (D2), its horizontal distance to the box is
  16 or less, and its y is between `min.y - 3` and `max.y + 3`.
- While `ctx.whereAmI().underground` and no creeper counts for the bot, the reflex does nothing and says
  nothing.

### C4. Shelter (R2)
The shelter is: the area of type `home` that holds the place `home`, else the nearest area of type `home`
within 96 blocks, else the place `home`. Never another type. With no home at all: nothing happens, and
once per night the text `I know no home. Tell me where home is.`
The text `The door is closed.` is only said when the code checked the state of the door.

### C5. Doors (R5, R6, R7, R9)
`createDoorService` (I8):
- It follows doors, fence gates and trapdoors.
- It notes an openable that goes from closed to open within 3 blocks of the bot while the bot moves or
  opens it itself.
- It closes a noted openable when the bot is 2 blocks or more past it and no entity stands in it. It
  tries up to 3 times.
- In an area of type `pen` or `farm` it closes every open gate of the area that the bot passed, also
  when the gate was open before.
- At the start: open openables within 6 blocks of the bot that lie in a saved area are closed when no
  player is within 3 blocks of them.
- Each closing prints `Door service: closed <name> at (x, y, z).` to the console.
- `closeNear(6)`: closes all open openables within 6 blocks. Text: `I closed oak_door at (x, y, z) and
  oak_fence_gate at (x, y, z).` or `All doors near me are closed.`

### C6. Sleep (S15)
- `goToBed` pauses `unstuck` from its start.
- By day: `I cannot sleep now, it is day. The night starts in about N minutes.`

## 9. Part E: work packs (E5)

### E1. Storage (C2, C4, C6)
- A chest counts as blocked only after an open failed. `isBlocked` no longer decides alone.
- `chestsText(index, item)`: with an item: `wheat: 28 in the chest at (11, 67, 53). Total 28.` or
  `I know no chest with wheat.` Without: up to 10 kinds per chest, by count, then `and N more kinds`.
- `fetchItem` for an item that no known chest holds answers from the index. It opens at most 3 chests
  that it does not know, within 16 blocks.
- Every walk and every open calls `bot.modes?.noteProgress?.('chest')`.

### E2. Farming (F1, F2, F3, F5, F6, F7)
- `farmCycle(bot, ctx, name, options)`, `options.fertilize` default true. Steps:
  1. harvest ripe plants, plant again;
  2. store the harvest (seeds up to the keep limit stay);
  3. plant free farmland; without a hoe: `ctx.tools.ensureTool(bot, 'hoe')`;
  4. when plants are not ripe and `fertilize`: get bone meal (below), use it, harvest what got ripe;
  5. close the gate.
  One cycle takes at most 10 minutes. It reads the ripe plants again after every walk to a chest.
- Bone meal, in this order: carried; known chests (`bone_meal`); made in the composter.
- Compost items, in this order: carried; known chests (through `ctx.storage.fetchItem`); picked within 32
  blocks of the middle of the farm: `leaf_litter`, flowers. Never seeds, never crops, never food.
  `leaf_litter` is a compost item and a block to pick.
- The composter: the one inside the farm area or within 8 blocks of it; else the nearest within 32 blocks
  of the bot.
- Texts name the numbers and the next step. Examples:
  `Farm "farm": I harvested 10 wheat and planted 10 again. 48 plants are not ripe. I made 3 bone_meal from 21 leaf_litter of the chest at (11, 67, 53) and used them. 9 more plants got ripe and I harvested them. The gate is closed.`
  `I have nothing to compost and the chests I know have nothing. 48 plants are growing. Nothing to do now.`
  The sentence about shears goes away.
- `plantText` says how many blocks were tilled.

### E3. Wood and tools (T1, T3, T4, T5)
- `chopTrees(bot, ctx, num, kind)`: `num` is the number of logs wanted. The bot cuts whole trees until it
  gained `num` logs or more. It picks up the drops after each tree and, when stopped, returns what it cut
  and what it picked up (I6).
- Before the first tree: `ensureTool(bot, 'axe')`. Without an axe and without material it cuts with an
  empty hand, never with a pickaxe.
- `chooseMaterial` counts what the bot carries and what the known chests hold. An empty material means
  the best material that can be made, up to stone.
- The warning of a failed craft names the item and the missing ingredient (M12). The inventory is read
  again before each craft step.

### E4. Mining, the minimum (M1, M2, M4, M5)
- `tripNeeds`: ladders only for the part of the way down that has no ladders yet. `shaftExists` is true
  when the route has a leg.
- `mineOre(bot, ctx, ore, count, options)`, `options.newMine` default false. Without a known mine for the
  ore and without `newMine`:
  `{ ok: false, reason: 'ask', text: 'I know no mine for iron. I can dig a new one at (x, y, z), N blocks from your house. Tell me to do it, or show me your mine.' }`
  Nothing is dug, nothing is crafted.
- A new entrance is never within 16 blocks of an area of the types `home`, `building`, `pen`, `farm`, and
  never within 16 blocks of the place `home`. It is on the surface: when `ctx.whereAmI().underground`, the
  answer is `I am underground. I start a new mine only from the surface.`
- The bot says what it prepares, through `ctx.say`: `I get my supplies: 16 ladders, 8 torches, a chest.`
- `eatIfHungry` uses `foodItems` (I7).
- The rest of mining (the mine of the player, tunnels on order, the list of ore) is v0.1.4.9. Do not
  start it.

### E5. Knowledge text (C1)
`knowledgeText` (I9). Format, one item per line, cut at whole lines, the nearest chests first:

```
WHAT YOU KNOW (from memory, no need to check):
You are in the area "farm" (farm), on the surface.
Chest (11, 67, 53): leaf_litter 104, cobblestone 81, raw_copper 52, wheat_seeds 52, lapis_lazuli 49, coal 39 and 32 more kinds.
Chest (11, 41, 44): empty.
Areas: home (home), farm (farm, 1 gate), mine (mine).
Mines: iron, entrance (9, 67, 58), level 16.
```

## 10. Part F: process (E7)

### F1. The chat kick (S12)
Confirmed by the log of the game: `Failed to validate message acknowledgements from claude: Checksum
mismatch on last seen update`, 3 times, each at the first chat of the bot after the 21st message of the
player. `minecraft-protocol` 1.62.0 keeps the last seen messages in a ring of 20 and computes the checksum
of 1.21.5 and later in index order of the array. The server computes it in the order of the window,
oldest first.
- Correct it with a patch through `patch-package`: `patches/minecraft-protocol+1.62.0.patch`. Look at how
  the existing patches are made, and at `package.json` (`postinstall`).
- Unit test `tests/unit/stf_chat_checksum.test.js`: feed 25 signatures, compute the checksum with the
  patched function and with a reference that you write from the rule of the game (start 1; for each
  signature of the window, oldest first: `31 * value + checksum of the signature`; the low byte; 0
  becomes 1). Before message 20 the old and the new code agree, after it only the new one matches.
- State in your report what you could verify and what stays a hypothesis.

### F2. Cost per launch (S7)
The main process sets `MINDCRAFT_LAUNCH_ID` (the time of its start) in its environment once. Agent
processes inherit it. The cost meter writes it into each session of `usage.json`. The limit per session
and `!cost` count all sessions of the same launch. Without the variable the behaviour is that of v0.1.4.7.

### F3. Restart context (S6)
`restart_context.js` (I10). The file is `bots/<name>/last_exit.json`. It is never committed (the folder
`bots/` is ignored). `restartNote` example:
`Before the restart <player> had ordered: !mineOre("iron", 8). The process ended because: Got stuck and couldn't get unstuck. You are at (8, 41, 48). Do not repeat the order by yourself. Tell the player what happened.`

### F4. Time in the log (S8)
`installLogTime` (I10), called first in `main.js` and in the start of the agent process, with the setting.

### F5. Repeat guard
`RepeatGuard` (I10). A failure is: the same command, the same arguments, the same result text, `limit - 1`
times in a row within the window. `check` then returns:
`I tried !consume("bread") 2 times with the same result: You do not have any bread to eat. I do not try a third time. Ask the player what to do.`
Commands that only read (`!stats`, `!inventory`, `!chests`, `!areas`, `!rules`, `!cost`, `!nearbyBlocks`,
`!craftable`, `!savedPlaces`, `!skills`, `!help`) are never counted. A different command in between
ends the row.

## 11. Part G: glue (E6)

Starts when parts A to F are reported. Reads their reports first.

1. **Settings** (section 2), with `settings_spec.json`.
2. **Pack commands**: `runPack` and the commands of the home pack pause `unstuck` at the start.
3. **Stopped commands** (I5): `runAsAction`, `runForText`, `runPack` put the text into the history and
   return nothing, so no second turn starts. The same for a stopped `!newAction` (S4).
4. **`requestInterrupt(by)`**: passes who stops; calls `bot.pathfinder.setGoal(null)` (S9).
5. **`whereAmI()`** (I2), on the contexts.
6. **At spawn**, in this order, each in its own try: `moveOffhandBack`; `autoHome` (with `protected_areas`);
   the door service; `readExit` and the restart note (with `restart_context`).
7. **`cleanKill`** writes the exit file (with `restart_context`).
8. **`!setMode`**: for `self_preservation`, `creeper_safety`, `night_shelter`, `door_closing`, `hunger` a
   call of the model is refused: `Only the player switches the reflex <name>. The player can type !setMode("<name>", false) in the chat.`
   A command typed by the player runs. No setting: decision of the owner.
9. **Guard**: `setPlayerOrder` (I3).
10. **Commands**:

| Command | Parameters | Pack or switch |
|---|---|---|
| `!pickUpItems` | `item` (optional), `range` default 16 | always |
| `!closeDoor` | none | `home_pack` |
| `!chests` | `item` (optional) | `storage_pack` |
| `!mineOre` | `ore`, `num`, `new_mine` default false | `mining_pack` |
| `!chopTrees` | `num` logs, `kind`; both orders of the arguments are accepted | `wood_pack` |
| `!rememberArea`, `!setArea` | the five types | `protected_areas` |
| `!givePlayer` | fetches the item from a known chest first when the bot does not carry it | `storage_pack` for the fetch |

    `!rememberArea` with `farm` or `pen` uses `findFencedGroundNear` and walks in through the gate with
    `passThrough` when needed.
11. **Prompt**: `$KNOWLEDGE` in the conversing prompt of `_default.json`, filled by `knowledgeText` with
    `knowledge_in_prompt`, else empty. Examples for: the mine ("this is the mine" to `!rememberArea("mine",
    "mine")`), the pen, "pick up what I dropped", "close the door", "do you remember what is in the chest"
    to `!chests`, "do we have wheat" to `!chests("wheat")`, "yes, dig a new mine" to `!mineOre("iron", 8, true)`.
    No example may show a safety reflex being switched off.
12. **Prompt size**: with every switch on, the conversing prompt without conversation stays at 17,000
    characters or less. Shorten descriptions of commands to get there. Report the sizes: all off, all on.
13. **`repeat_guard`** in `executeCommand`; **`say_results`** in the agent loop: only texts of pack
    commands, only when the answer of the model is empty or a tab.
14. **Routing list**: sentences for the new commands and types, at least 20.

## 12. Tests

### T1: unit tests from the spec
One file per section of the spec, `tests/unit/st_<topic>.test.js`. Test the texts word for word where the
spec gives them. Test every row of the tables (D2, C2, settings). Test that every switch off gives the
behaviour of v0.1.4.7.

### T2: world tests
1. **Modes.** `helpers.js` gets `MODES_PROFILE`: the modes of `profiles/defaults/assistant.json`
   (self_preservation, unstuck, self_defense, item_collecting, torch_placing, elbow_room, idle_staring on)
   plus the home reflexes. Every scenario that tests a skill uses it, and gives the order as a chat
   command. `MODES_OFF` stays only for scenarios that test a switch that is off.
2. **World type `base`**, built with console commands:
   - a house of planks with a door, a bed, a chest with food and leaf litter; saved as the place `home`
     only;
   - under the house: a shaft with trapdoor and ladders down to a room at y 41 with chest and crafting
     table, a descent of loose blocks to y 25, a tunnel 1 x 2 of 12 blocks;
   - a fenced farm with gate, composter and a chest at the fence line;
   - a pen of fence with a gate, a cow and a chicken.
3. **Scenarios.** Numbers from w30. One defect per scenario:

| Id | Name | Passes when |
|---|---|---|
| W30 | all_modes_on | w15 to w28 of v0.1.4.7 pass with `MODES_PROFILE` (run them, do not copy them) |
| W31 | stuck_gives_up | the bot in a closed room of 1 x 1 x 2 with `stuck_restart_after` 3: the process lives, the model is told the position |
| W32 | skill_stands_still | `!storeItems`, `!getTool`, `!makeBoneMeal`, `!goToBed` with waits of 25 s or more: no `I'm stuck!` |
| W33 | stopped_command_reports | `!chopTrees` stopped by `!stop`: the history holds what was cut and picked up |
| W34 | stop_is_hard | `!goToCoordinates` far away, then `!stop`: the bot stands within 1 s, no kill |
| W35 | resume_ends | `!followPlayer`, then `!storeItems`: after it the bot does not follow again |
| W41 | offhand_food | bread in slot 45: `!eat` eats it; `!inventory` names the off-hand |
| W42 | hunger_reflex | food level 6, no food carried, bread in the chest of the house: the bot fetches and eats without an order |
| W43 | fence_is_safe | `!collectBlocks("oak_fence", 20)` in the pen with `protect_built_blocks`: every fence stands, the animals are inside, the text says why |
| W44 | pick_up_dropped | a second bot drops 8 fences and a gate: `!pickUpItems` gets them |
| W45 | shaft_is_underground | the bot at y 41 under the house at dusk: `night_shelter` does nothing |
| W46 | creeper_above | the bot at y 25 in the tunnel, a creeper on the surface above: no reaction in 30 s |
| W47 | creeper_in_sight | a creeper 8 blocks away in the same tunnel: the reflex reacts |
| W48 | shelter_is_home | areas `mine` and `pen` nearer than the house: at dusk the bot goes into the house |
| W49 | doors_after_reflex | the reflex walks the bot from the farm into the house: gate and door are closed afterwards |
| W50 | auto_home | start with the place `home` and no area: the area `home` exists afterwards |
| W51 | chest_at_fence | `!storeItems` at the farm: the chest at the fence opens and is in the index |
| W52 | farm_cycle_whole | unripe wheat, leaf litter in the chest: one `!farmCycle` ends with harvested wheat |
| W53 | trees_with_axe | `!chopTrees(6)`: an axe in the hand, 6 logs or more in the inventory |
| W54 | mine_asks | `!mineOre("iron", 8)` with no mine: nothing dug, the text asks |
| W55 | reflex_switch | `!setMode("creeper_safety", false)` from the model is refused; typed by the player it works |
| W56 | farm_scan | `!rememberArea("farm", "farm")` from outside the gate saves the farm |
| W57 | flags_off_0148 | every new switch off: behaviour of v0.1.4.7 |
| W60 | long_run | 30 minutes, about 60 orders in a fixed order with all parts on: the process never ends, no order stays without a result text |

4. The chat kick cannot happen on the test server (it does not sign chat). No world scenario for it.

## 13. Order of work

| Round | Parallel | Then |
|---|---|---|
| 1 | A (E1), B (E2), D (E4) | tech lead reads the reports, `npm test` |
| 2 | C (E3), E (E5), F (E7) | tech lead reads the reports, `npm test` |
| 3 | G (E6), TU (T1), TW (T2) | `npm test`, `npm run test:e2e`, `npm run test:world` |
| 4 | one integration engineer for what failed | full runs by the tech lead, fresh checkout, PR |
