# SPEC v0.1.4.9 "The mine, the routes of the player, and the model comparison"

This is the spec as the engineers get it on 2026-09-30. The plan for the owner is `PLAN.md`; the brief
of the last lead is `BRIEF.md`. The notes between the parts are `HANDOFF.md`; where they disagree with
this spec, they win. The defects that the real server finds, with the decisions, are `DECISIONS.md`.

Tech lead: Fable. Base: `origin/main` at `fdb6000` (tag `v0.1.4.8`). Branch: `hotfix/mine-routes`.
Work folder: the checkout `/home/user/mindcraft-fk`, shared by all engineers. Node 22.

## 0. Rules for every engineer

1. **Never read, create, copy, stage or print `keys.json`.** Never read a secret. Never run
   `test-routing.ps1`, and never run `scripts/routing_check.js` without `--dry-run`.
2. **Never connect to port 55916** (the world of the owner). The test server is on 127.0.0.1:25599 or
   the next free port. Kill only processes that you started, by process id.
3. **No git command that writes** (commit, checkout, stash, reset, pull, push, add, mv, rm). The tech
   lead commits.
4. **File ownership is strict.** You change only the files of your part (section 3). When you need a
   change in a file of another part, write the request into your report; do not make it.
5. Run single test files while you work (`node --test tests/unit/<file>`). Run `npm test` once at the
   end. Do not run `npm run test:world` unless your part says so.
6. New behaviour has a switch in `settings.js` and is off by default (section 2). A correction of a
   defect has no switch. With a switch off the behaviour is that of v0.1.4.8.
7. Match the style of the file you change: comment density, naming, LF line endings (the repository
   stores LF; check with `file` before and after).
8. Texts that the bot says or returns are plain English, short sentences, with numbers. No word of a
   text may claim what the code did not do. Texts given here are used word for word.
9. A function of a pack never throws to its caller. It returns `{ ok, reason, text }`. When it was
   stopped, `reason` is `interrupted` and `text` says what was done.
10. Static imports only of names that exist. A pack behind a switch is loaded with a dynamic
    `import()`. A new function of another part is reached at run time with optional chaining
    (`ctx.routes?.walkTo?.(...)`), so that your module loads while the other part is not there yet.
11. Packs call each other through the context `ctx`. The low-level helpers of the home pack
    (`packs/home/motion.js`, `context.js`, `door_logic.js`, `doors.js`) and the ladder walking of the
    mining pack (`packs/mining/ladder.js`) may be imported directly; the mining pack does so today.
12. Report at the end, as your answer, not as a file: what you changed per file, the exports, what
    you did not do and why, requests to other parts, test results with numbers, and everything that
    surprised you or that you decided alone.

## 1. Goal and acceptance of the release

| Goal | Measured by |
|---|---|
| The bot learns the mine of the player by walking it | W65: after the walk and `!rememberMine`, `mines.json` holds the route with a ladder leg, the room, one tunnel |
| `!mineOre` works in a known mine | W67: the bot walks the route, digs on at the end of the tunnel, comes back up; no new shaft |
| The bot walks a learned route where the path search fails | W62, W63: down and up a ladder with a trapdoor by a route |
| A broken route is reported, nothing is dug | W64 |
| The ore left behind is known and fetched | W68 |
| `ore_sense_range` 0 and 3 | W69, W70 |
| On the mine route the bot is underground | W71 |
| No dig code from the model where a skill exists | W72 |
| The cost meter counts OpenAI models | unit tests of part D with a fake client |
| Every switch off is v0.1.4.8 | W74 |
| Nothing regressed | the long run W60 with the new parts on; all scenarios of v0.1.4.8 pass |

Unit tests, end-to-end tests and world tests all pass in a fresh checkout.

## 2. Settings

New keys in `settings.js` and `src/mindcraft/public/settings_spec.json` (part G owns both files):

| Key | Default | Type | Meaning |
|---|---|---|---|
| `routes_pack` | `false` | bool | The trail is recorded; `!rememberRoute`, `!routes`, `!forgetRoute`; `!goToBed`, the shelter walk and `!goToRememberedPlace` use a route when the path search finds no way |
| `trail_max_steps` | `500` | int >= 50 | With `routes_pack`: steps of the trail kept |
| `mine_routes` | `false` | bool | With `mining_pack` and `routes_pack`: `!rememberMine`, `!rememberTunnel`, `!collectPassedOre`, the work in a known mine, the side branches, the ore list, the mine in the knowledge block |
| `ore_sense_range` | `0` | int, 0 or 3 | 0: only ore that touches the tunnel, and `!collectBlocks` takes only ore with a face in the open. 3: also ore within 3 blocks of the wall |
| `skills_over_code` | `false` | bool | `!newAction` is refused for a request about digging where a skill exists |

`mine_routes` with `routes_pack` off: one warning at the start
(`mine_routes needs routes_pack. The mine routes are off.`) and the behaviour of `mine_routes` off.

## 3. Parts, owners, files

| Part | Engineer | Files (owned) | Round |
|---|---|---|---|
| A Routes pack | E1 | new `src/agent/packs/routes/*`; the hook of I5 in `src/agent/packs/home/sleep.js` and `src/agent/packs/home/shelter.js` | 1 |
| B Mine | E2 | `src/agent/packs/mining/*` | 1 |
| C Library, guard, knowledge | E3 | `src/agent/library/skills.js` (collectBlock only), new `src/agent/library/ore_sight_logic.js`, new `src/agent/dig_request_logic.js`, `src/agent/knowledge/knowledge_text.js`, `src/agent/reflex/where_am_i.js` | 1 |
| D Model comparison | E4 | `src/models/gpt.js`, `src/agent/cost/price_table.js`, `scripts/routing_check.js`, `test-routing.ps1`, `start-gpt.ps1`, `profiles/gpt.json`, `tests/routing/commands.js` (the settings table only) | 2 |
| E Test server | E4 | new `scripts/get_test_server.js`, `tests/world/README.md` (the section on the environment), `tests/world/mc_server.js` (the default folder only) | 2 |
| G Glue | E5 | `src/agent/agent.js`, `src/agent/commands/*`, `src/models/prompter.js`, `profiles/defaults/_default.json`, `settings.js`, `src/mindcraft/public/settings_spec.json`, `src/agent/modes.js`, `tests/routing/sentences.json` | 2 |
| TU Unit tests | T1 | `tests/unit/rt_*.test.js`, `tests/helpers/*` | 2 |
| TW World tests | T2 | `tests/world/*`, `tests/e2e/*` | 3 |

Engineers of round 1 and 2 write unit tests for their own pure modules: `tests/unit/rta_*.test.js` (A),
`rtb_` (B), `rtc_` (C), `rtd_` (D), `rte_` (E), `rtg_` (G). The tester writes the tests of the spec, not
of the code, in `rt_*.test.js`. Existing tests that a change makes wrong: the engineer of the part
corrects them and names them in the report. `CHANGELOG.md` is the tech lead's.

## 4. Interfaces between the parts

These are fixed. Build against them, also when the other part is not there yet.

### I1. The trail (A gives, G binds)

`src/agent/packs/routes/trail.js`:

```js
export function createTrail(bot, ctx, options = {})
// options: { file: string|null, maxSteps = 500, intervalMs = 250, saveMs = 5000, now, wait }
// -> { start(), stop(), tick(), list(), clear(), size }   tick() is synchronous and never throws
```

A step: `{ x, y, z, on, at, sky, t, via }`. `x, y, z` the feet cell; `on` the name of the block under
the feet; `at` the name of the block at the feet (`ladder`, `air`, `water`, ...); `sky` true when the
feet cell is under open sky; `t` the time; `via` `null` or `{ kind: 'door'|'gate'|'trapdoor', name, x, y, z }`
for an openable the bot passed with this step. The file is `<worldDir>/trail.json`,
`{ version: 1, steps: [...] }`, written at most every 5 s and at `stop()`; the oldest steps leave at
`maxSteps`. `start()` sets an interval that is `unref()`ed; `stop()` clears it. Without a file the trail
lives in memory only.

Rules of a step (pure, `trail_logic.js`): a new step when the feet cell differs from the last step
(`Math.floor` of x, y, z); nothing while the bot is not on the ground and not on a ladder and not in
water (a fall is not a step); `sky` from the sky light of the block at the feet: 15 means open sky;
without sky light, no solid block in the column above within 64 blocks. `via`: an openable (name ends
with `_door`, `_fence_gate` or `_trapdoor`, `openableKind` of `packs/home/door_logic.js`) at the feet
cell, at the last cell, or at the cell between them, and a trapdoor also directly above or below the
feet.

### I2. Routes and legs (A gives, B and G use)

A route: `{ name, dimension, from: { name, x, y, z }, to: { name, x, y, z }, legs, steps, source, created, updated }`.
`source` is `'trail'` or `'mine'`. `steps` is the number of trail steps the route was made from.

Legs, the kinds of `mines.json` of v0.1.4.7 plus one:

```
{ kind: 'walk',   from: {x,y,z}, to: {x,y,z} }                                  path search, at most 12 blocks apart
{ kind: 'ladder', x, z, top, bottom, face, entry: {x,y,z} }                     face: the side of the wall, opposite the `facing` of the ladder
{ kind: 'stairs', from, to, dir }                                                unchanged, made only by the mining pack
{ kind: 'door',   kind2: 'door'|'gate'|'trapdoor', name, x, y, z, from, to }    open it if closed, pass from `from` to `to`
```

`src/agent/packs/routes/route_logic.js`, pure:

```js
export function routeFromSteps(steps, options = {})   // -> { legs, from, to } ; { maxHop = 12 }
export function routeStart(steps, known)              // -> { index, known } | null   (section 5, A2)
export function skyStart(steps)                       // -> index of the last step with sky true, or -1
export function reverseRoute(route)                   // -> a route with the legs reversed, from and to swapped
export function routeEnds(route)                      // -> { from, to }
export function legCells(leg)                         // -> [{x,y,z}] the cells a leg covers (a ladder: the column top..bottom)
export function nearestRoute(routes, target, botPos, options)  // -> { route, reverse, distance } | null   (A4)
```

`src/agent/packs/routes/route_store.js`: `RouteStore(filePath|null, { now })` with `load()`, `set(route)`,
`get(name, dimension)`, `list(dimension)`, `remove(name, dimension)`, `size`, file `<worldDir>/routes.json`
`{ version: 1, routes: { "<name>" | "<dim>:<name>": route } }`, names normalised like areas (trimmed,
lower case, spaces to `_`). Built like `mine_store.js`: `readJsonSafe`, `writeJsonAtomic`, invalid
entries skipped, never throws.

### I3. Walking a route (A gives, B and the home pack use)

`src/agent/packs/routes/replay.js`:

```js
export async function walkRoute(bot, ctx, route, options = {})
// options: { reverse = false, clock, deadline, timeoutMs = 120000 }
// -> { ok, reason, text, leg: number|null, at: {x,y,z}|null }
// reasons: null | 'no_path' | 'blocked_door' | 'interrupted' | 'time' | 'error'
```

A walk leg: `walkNear` of `packs/home/motion.js` to `to` with doors allowed and no digging, 20 s; when
it fails once, a second try with `allowDoors` and `allowDig: false` and a goal `GoalNear` of 1. A ladder
leg: `slideDown` or `climbUp` of `packs/mining/ladder.js` by where the bot is (above `bottom`: down; else
up). A door leg: go to `from`; when the openable is closed, open it (`bot.activateBlock`); for a
trapdoor above a ladder, open it and step onto the ladder; go to `to`. The door service closes doors
behind the bot; `walkRoute` closes nothing. The bot is at a leg's end when its feet are within 1 block
of it. On a failure the text is:

`I could not follow the route "bed" at step 3 of 7, at (12, 45, 8). Show me the way again.`

and nothing is dug. `leg` is the index that failed. When interrupted:
`I was stopped on the route "bed" at step 3 of 7.`

### I4. The routes on the context (A gives, G binds)

The glue puts `ctx.routes` on `homeContext()` (and so on `packContext()`), `null` without `routes_pack`:

```js
ctx.routes = {
    store,                                       // the RouteStore of the world
    trail,                                       // the trail of I1
    walkRoute(bot, route, options),              // I3
    walkTo(bot, target, options),                // -> { ok, reason, text, route: name|null }
    routeFor(target, options),                   // -> { route, reverse } | null  (nearestRoute of A4 with the bot's position)
}
```

`walkTo(bot, target, { range = 4, reach = 32 })`: a route whose end (or start) is within `range` of the
target, and whose other end is within `reach` of the bot: walk with the path search to that end (doors
allowed), then `walkRoute`. Without such a route: `{ ok: false, reason: 'no_route', text: '' }`. Made
with `bindRoutes(bot, ctx, store, trail)` exported by `packs/routes/index.js`.

### I5. The hook in the home pack (A changes, the home pack calls)

In `sleepInBed` (`sleep.js`, after `walkNear` failed with a reason other than `interrupted`) and in
`goToShelter` (`shelter.js`, in `walkToHomePlace` and after `enterBuilding` failed with `no_path`):

```js
const viaRoute = await ctx.routes?.walkTo?.(bot, target, { clock });
```

When `viaRoute?.ok`, the walk goes on as if the path search had arrived. When `viaRoute` failed with a
reason other than `no_route`, its `text` replaces the text of the failure. Without `ctx.routes` nothing
changes.

### I6. The mine record (B gives, A, C and G use)

`mines.json` stays the one store. A mine gets these fields, all optional for a mine of v0.1.4.7:

```
name:    string|null        the name the player gave; a mine dug by the bot has null
source:  'bot'|'player'
room:    { center: {x,y,z}, chest: {x,y,z}|null, table: {x,y,z}|null, furnace: {x,y,z}|null } | null
tunnels: [ { start: {x,y,z}, dir, end: {x,y,z}, level, length, branches: [ { at, side: 'left'|'right', start, end, length, done } ] } ]
passed:  [ { ore, x, y, z, reason, seen } ]      at most 200, the oldest leave
```

The key of the store: `name` when the mine has one, else the level as today (`mineKey`). New on
`MineStore`: `byName(name, dimension)`, `nearest(pos, dimension, range = 64)` (by the entrance and by
every cell of the route, the room and the tunnels), `addPassed(mineKey, entry)`, `removePassed(mineKey, pos)`.
`get(ore, dimension)` stays as it is for the mines of the bot; for `mine_routes` the choice of the mine
is `nearest` (section 6, B4).

`src/agent/packs/mining/mine_logic.js`, pure, new:

```js
export function mineAt(mines, pos)          // -> { mine, tunnel: index|null, onRoute: boolean } | null
export function tunnelFor(mine, ore)        // -> index | null   the tunnel whose level lies in the range of the ore, nearest to its best level
export function branchPlan(tunnel)          // -> the next branch to dig or null (B5)
export function measureTunnel(getName, feet, dir)   // -> { start, end, length, level } | null (B3)
export function corridorDirections(getName, feet)   // -> [{ dir, length }] the directions with 2 or more open cells ahead
```

`mineAt`: `pos` within 1 block of a cell of the room, a tunnel (start to end, 2 high), a branch, or a
leg of the route (`legCells` of I2; the routes pack is not imported, B has its own copy of the cell
rule for the four kinds of legs).

### I7. Where the bot is (C gives, G binds)

`whereAmI(bot, now, extra)` of `src/agent/reflex/where_am_i.js` gets a third argument
`extra = { mine: { name, tunnel, level } | null }` and returns `{ area, depth, underground, mine }`.
`underground` is true also when `extra.mine` is not null. The glue computes `extra.mine` from
`mineAt(mines.list(dim), pos)` (I6) with `mine_routes`, else `null`.

`knowledgeText` (C) reads `where.mine` and `mines[].passed`:

```
You are in the area "mine" (mine), in the mine "mine", tunnel 1 at level 25, 35 blocks under the ground.
You are in the mine "mine", on its way in, 12 blocks under the ground.
Ore left behind: gold 2, coal 6 in the mine "mine".
```

The line of the ore comes after the mines line and before the places; it is cut before the chests.

### I8. Dig requests (C gives, G uses)

`src/agent/dig_request_logic.js`, pure:

```js
export function isDiggingRequest(text)                 // -> { digging: boolean, words: string[] }
export function digRefusalText(commands)               // -> string
```

Words that make a request a digging request (whole words, any case): `dig`, `digs`, `digging`, `dug`,
`tunnel`, `tunnels`, `shaft`, `mine`, `mining`, `strip mine`, `branch mine`, `quarry`, `excavate`, and
the ore names of the mining pack with or without `ore`. `commands` is the list of the digging commands
that are on (the glue gives it): the text is

`I do not write code for digging. I have skills for it: !mineOre for an ore, !rememberTunnel and then !mineOre to dig on in a tunnel, !collectBlocks for blocks in sight.`

with only the commands that are on; without any: `I do not write code for digging. Switch on the mining pack, or type the command !newAction in the chat yourself.`

### I9. Usage of OpenAI models (D gives)

`src/models/gpt.js` calls `reportUsage` of `src/agent/cost/usage_context.js` after every successful
request, like `claude.js`:

```js
reportUsage({ model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens: 0 })
```

Responses API: `input_tokens = usage.input_tokens - cached`, `cache_read_tokens = usage.input_tokens_details?.cached_tokens ?? 0`,
`output_tokens = usage.output_tokens` (the reasoning tokens are inside it). Chat completions:
`prompt_tokens`, `completion_tokens`, `prompt_tokens_details?.cached_tokens`. Embeddings:
`input_tokens = usage.prompt_tokens`, `output_tokens = 0`, model `text-embedding-3-small` (or the one used).
Without a `usage` object nothing is reported. Prices in `DEFAULT_PRICES`: `gpt-6-luna` input 0.10,
output 0.50, `cache_read` 0.01; `text-embedding-3-small` input 0.02, output 0.

### I10. The commands (G gives the model)

| Command | Parameters | Switch |
|---|---|---|
| `!rememberRoute` | `name` | `routes_pack` |
| `!routes` | none | `routes_pack` |
| `!forgetRoute` | `name` | `routes_pack` |
| `!rememberMine` | `name`, default `mine` | `mine_routes` |
| `!rememberTunnel` | `name`, default `''` | `mine_routes` |
| `!collectPassedOre` | `ore`, `num` default 8 | `mine_routes` |

## 5. Part A: routes pack (E1)

New pack `src/agent/packs/routes/`: `trail_logic.js`, `route_logic.js` (pure), `trail.js`,
`route_store.js`, `replay.js`, `texts.js`, `index.js`. `index.js` exports everything the glue needs:
`createTrail`, `RouteStore`, `walkRoute`, `bindRoutes`, `rememberRoute`, `routesText`, `forgetRoute`,
`TEXTS`, and the pure functions. Importing `index.js` has no side effects.

### A1. The trail
I1. The recorder reads the bot every 250 ms: position, on ground, the block at and under the feet,
the sky light, the openables around the feet. A test file must end by itself: the interval is
`unref()`ed and `stop()` clears it.

### A2. `rememberRoute(bot, ctx, name, options)`
`{ ok, reason, text, route }`. Known things for `routeStart`: every saved place (`ctx.places`, within
2 blocks), every saved area (`ctx.areas`, inside the box), every known mine (`ctx.mines?.list?.()`,
inside the room or on the route), as `{ name, kind: 'place'|'area'|'mine', test(step) }`. Walk the
trail backwards from the last step; the known thing at the last step (if any) does not count; the first
step at a known thing that is not the one of the last step is the start. The legs are
`routeFromSteps(steps.slice(start))`. `to` is `{ name, x, y, z }` of the bot. Texts:

- `I remember the way "bed": from the place "storage" to here, 7 steps, 1 ladder, 1 trapdoor. I walk it in both directions.`
  (`N steps` is the number of legs; `1 ladder`, `2 ladders`, `1 door`, `1 gate`, `1 trapdoor` are listed when present, in that order)
- `I do not know where this way starts. Stand at a place I know first, then walk with me and tell me again.` (reason `no_start`)
- `The way "bed" is too short: I stand where it starts.` (reason `too_short`, fewer than 2 steps of the trail)
- `I know a way "bed" already. I replace it.` is put in front of the first text when the name existed.

### A3. `routesText(ctx, dimension)` and `forgetRoute`
`!routes`: `I know 2 routes: "bed" from the place "storage" to (12, 45, 8), 7 steps; "mine" from the area "home" to (30, 41, 4), 12 steps.`
or `I know no routes.` `!forgetRoute`: `Forgot the route "bed".` or `I know no route "bed".`

### A4. `nearestRoute(routes, target, botPos, { range = 4, reach = 32 })`
A route qualifies when one of its ends is within `range` of the target and the other end within `reach`
of the bot; the one with the smallest distance of the bot to the other end wins; `reverse` is true when
the bot starts at `to`.

### A5. `walkRoute` and `bindRoutes`
I3 and I4. `walkRoute` calls `bot.modes?.noteProgress?.('route')` after every leg. It pauses nothing;
the caller is a command that pauses `unstuck`.

### A6. The hook of I5.

## 6. Part B: mine (E2)

### B1. The store (I6)
`validateMine` keeps the new fields; a mine of v0.1.4.7 loads unchanged with `name null`, `source 'bot'`,
`room null`, `tunnels []`, `passed []`. A mine of the bot with `direction`, `end`, `length` also shows one
tunnel in `tunnels` when read (`tunnelsOf(mine)`), so that every caller sees one shape.

### B2. `rememberMine(bot, ctx, name, options)`
`{ ok, reason, text, mine }`. The trail is `ctx.routes?.trail?.list?.()`. Without it: reason
`no_trail`, `I have no trail. The routes pack is off.` The start is `skyStart(steps)` (I2) of the routes
pack, reached through `ctx.routes` (the pure functions are exposed on `ctx.routes.logic`: `skyStart`,
`routeFromSteps`); without a sky step: `I was not under open sky in my last N steps. Walk with me from the entrance of the mine and tell me again.`
(reason `no_entrance`). The route is `routeFromSteps(steps.slice(start))`. The room: chest, crafting
table and furnace within 6 blocks of the bot (`bot.findBlocks`), `center` the feet of the bot. The
tunnel: `corridorDirections`; when one direction has 4 or more open cells ahead, `measureTunnel` in that
direction gives the first tunnel; else none. The mine is saved with `name`, `source 'player'`,
`entrance` the sky step, `level` the feet of the bot, `ore` `'iron'` (the store needs one), `route`,
`room`, `tunnels`, `dimension`. The area of type `mine` that holds the bot, if any, is named in the text.
`rememberPlace(ctx, name, entrance)` as today for a new mine. Texts:

- `I remember the mine "mine": the entrance at (30, 60, 4), the way in has 6 steps with 1 ladder and 1 trapdoor, the room at level 41 with a chest and a crafting table, one tunnel at level 25, 12 blocks long, going north.`
  (`with a chest, a crafting table and a furnace`; `no chest`; `no tunnel yet: stand in a tunnel and say "dig here"`)
- `I know a mine "mine" already. I replace it.` in front when the name existed.

### B3. `rememberTunnel(bot, ctx, name, options)`
`{ ok, reason, text, mine, tunnel }`. The mine: `mineAt` for the bot's position, else `nearest` within
64; none: `I know no mine here. Tell me "this is the mine" first.` (reason `no_mine`). The direction:
`corridorDirections`; with several, the one nearest to the yaw of the player who gave the order
(`options.playerYaw`, the glue passes the yaw of `agent.last_order` player if it is in sight, else
undefined), else the longest. Without a corridor: `I stand in no tunnel. A tunnel is 1 wide and 2 high and open ahead of me.`
(reason `no_corridor`). `measureTunnel`: `start` the last open cell behind the bot before the corridor
opens into a room (a cell with 3 or more open neighbours at the feet level) or ends, `end` the last open
cell ahead before rock, `level` the feet, `length` the cells from start to end. A tunnel whose start is
within 2 blocks of an existing tunnel's start replaces it. Text:

`I measured the tunnel: it starts at (22, 25, 2), goes north, and ends at (22, 25, 13) after 12 blocks, at level 25. I dig on at its end when you ask for ore.`

### B4. The work in a known mine
With `mine_routes` (`ctx.settings.mine_routes` and `ctx.routes` present) `mineOre` changes its choice
of the mine: `store.nearest(feet, dim, 64)` first; a mine of the player without a fitting tunnel
(`tunnelFor` null):

`Your mine "mine" has no tunnel where diamond is found (from -64 to 16). Its tunnels are at level 25. Show me a tunnel at that depth, or tell me to dig a new mine.`
(reason `no_tunnel`; `Its tunnel is at level 25.` in the singular). `ORES` get `min` and `max`:
coal 0..192, copper -16..112, iron -64..72, lapis -64..64, gold -64..32, redstone -64..15, diamond -64..16.

The way in: `ctx.routes.walkRoute(bot, { legs: mine.route }, { deadline })` when a leg of the route is
a `door` or the mine is a player's; else `followDown` as today. The way out: `walkRoute` with `reverse`,
else `followUp`. A failed route: the text of `walkRoute` (I3) and reason `no_path`; nothing is dug.

The tunnel: `tunnelFor(mine, ore)`; the bot walks to its `end` (through the room), and `digTunnel` digs
on from the tunnel's `end` in its `dir`, as today from `mine.end` in `mine.direction`. `depositAtBase`
uses `room.chest` when the mine has a room. The tunnel's `end` and `length` are saved after every step.
`mine.length` in `mineText` is the length of the tunnel that was used.

Without `mine_routes` nothing here changes: the choice by level, `followDown`, `followUp`.

### B5. Side branches
`branchPlan(tunnel)`: when `tunnel.length >= 32`, the next branch: at `at = 4, 8, 12, ...` from the
start, at each `at` first `left` then `right`, each 8 blocks long, the first branch not `done`, nearest
to the start first. `digTunnel` with `options.line = { start, dir, end, length }` digs a branch as it
digs a tunnel. A branch is `done` at 8 blocks or when it is blocked. The main tunnel is dug on only
when every branch of its length is done. With `mine_routes` off no branch is dug.

### B6. The ore list
Every ore block that `tunnelStep` or `mineVeins` sees and does not take gets an entry in `passed`
(`addPassed`) with the reason: `pickaxe` (the pickaxe is too weak), `lava` (lava on a face), `inventory`
(no free slot), `vein` (beyond the vein limit), `stopped` (interrupted or time over). An entry leaves
when the block is broken by the bot (`removePassed`) or is no ore any more when seen again. `mineOreText`
gets `extra`: `I left 2 gold_ore behind: I need an iron pickaxe.` / `... behind: lava beside it.` /
`... behind: my inventory was full.` / `... behind: the vein was bigger than 12.` / `... behind: I was stopped.`,
one sentence per reason, the ores summed by kind.

`collectPassedOre(bot, ctx, ore, count, options)` -> `{ ok, reason, text, collected }`: the mine of
the bot (`mineAt`) else `nearest`; the entries of the ore, nearest to the room first; for each: walk
to a cell adjacent to it (the tunnel or branch it lies on), check the reason again (a pickaxe of the
right material is equipped, a lava face is patched first with a filler, free slots), take it with the
vein rule, `removePassed`. Texts:

- `I collected 4 coal_ore that I had passed. 2 gold_ore stay: I need an iron pickaxe.`
- `I collected 4 coal_ore that I had passed.`
- `I passed no coal in the mine "mine".` (reason `none`)
- `I was stopped after 2 of 6 coal_ore.` (reason `interrupted`)

### B7. `ore_sense_range`
`ctx.settings.ore_sense_range` 3: `tunnelView` looks 3 blocks into the left and right wall and the
floor and the ceiling at every step (`senseRange`); an ore within that range is reached with a side cut
1 wide and 2 high, at most 3 blocks, taken with the vein rule, and the cut is left open. With 0 the
view is that of v0.1.4.7. `mining.js` never reads the setting directly; `makeJob` puts `senseRange`
on the job.

### B8. Underground on the route
`mineAt` (I6) is also what the glue uses for I7. The room and the tunnels count with the cells of
their boxes; a ladder leg with its column and the cell of `entry`; a walk leg with the straight line
of cells from `from` to `to`; a door leg with `from`, `to` and the openable.

## 7. Part C: library, guard, knowledge (E3)

### C1. `collectBlock` and ore
In `collectBlock` of `skills.js`, when `blockType` is an ore (`isOreBlock` of
`packs/mining/ore_table.js` is not imported: the library uses its own name test, a name that ends with
`_ore` or is `ancient_debris`), the candidates are filtered by `ctx`-free rules of a new pure module
`src/agent/library/ore_sight_logic.js` (owned by C):

```js
export function oreInSight(getName, pos, range)   // -> boolean
```

`range` 0: the ore has a face towards a non-solid cell (air, cave air, water, torch, ladder, or a cell
the bot dug in this call). `range` 3: a non-solid cell within 3 blocks (Chebyshev). The range comes
from `settings.ore_sense_range`. When every candidate is out of sight the text is:
`I see no iron_ore. I know that there is some within 16 blocks, but it is inside the rock. Tell me to mine iron and I get it from a mine.`
(with `!mineOre` on) or `I see no iron_ore within 16 blocks.` The signature of `collectBlock` does not
change. Without `mining_pack` and with `ore_sense_range` 0 the rule holds too (it is a property of the
setting, not of the pack).

### C2. Dig requests
I8. `isDiggingRequest` looks at whole words, any case; `strip mine` and `branch mine` also with a
hyphen.

### C3. Knowledge
I7: `whereLine` with `where.mine`; `passedOreLine(mines)`; the cut order.

### C4. Where am I
I7: the third argument. Without it the result is that of v0.1.4.8 plus `mine: null`.

## 8. Part D: model comparison (E4)

### D1. Usage
I9. Unit tests with a fake OpenAI client (an object with `responses.create`, `chat.completions.create`,
`embeddings.create` that return fixtures): the reported numbers for each of the three calls, and that
a response without `usage` reports nothing. The constructor of `GPT` takes an optional client for
the tests: `new GPT(model, url, params, { client })`.

### D2. Prices
I9. `priceFor('gpt-6-luna')` and `priceFor('text-embedding-3-small')`. No price for the speech model.

### D3. Routing check
`scripts/routing_check.js` gets `--profile <path>` (default `profiles/claude.json`) and `--model <id>`.
`--model` replaces the chat model of the profile (`profile.model = { model: id, params }` keeping the
params of the profile); an id that starts with `gpt-` sets `api: 'openai'`. The key that the real run
needs is the one of the api: `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`; the usage line names it. The dry
run sets the placeholder for the api in use. The table of the real run gets a column `ms` (the time of
the answer); the summary is

`Accuracy: 118 of 136 (87%). Time per answer: median 1.0 s, mean 1.2 s. Cost: 0.93 dollars, measured.`

`test-routing.ps1` gets `-Model <id>` and `-Profile <path>`; with a model that starts with `gpt-` or a
profile whose model is an OpenAI model it loads `OpenaiApiKey` from the vault, else `AnthropicsApiKey`,
by name only, and removes the variable at the end. `tests/routing/commands.js`: the new settings in
`SPEC_SETTINGS` and the new commands in `PART_COMMANDS` (`routes_pack`, `mine_routes`).

### D4. Profile
`profiles/gpt.json`: `name` `gpt`, `model` `{ "model": "gpt-6-luna", "params": { "reasoning": { "effort": "low" } } }`,
`speak_model` `"system"`, `conversing` the text of `profiles/claude.json` as it is on the branch,
`code_model` the one of `profiles/claude.json`. Because the code model is a Claude model, `start-gpt.ps1`
also loads `AnthropicsApiKey` (the same two lines as `start-claude.ps1`), and its comment says why.
Check in `src/models/prompter.js` that the code model is made at the start: if the Anthropic key is
missing then, the bot must not fail to start; if it does, report it, do not change the prompter (part G
owns it).

## 9. Part E: test server (E4)

`scripts/get_test_server.js [--accept-eula] [--dir <folder>]`:

1. Reads `https://piston-meta.mojang.com/mc/game/version_manifest_v2.json`, finds `1.21.8`, reads its
   version file, takes `downloads.server` (`url`, `sha1`, `size`).
2. Refuses to go on when `sha1` is not `6bce4ef400e4efaa63a13d5e6f6b500be969ef81`: the file is not
   the one the tests were made with. Exit code 3.
3. Downloads to `<dir>/server-1.21.8.jar.part`, checks SHA-1 and size, renames to `server-1.21.8.jar`.
   A jar that is already there with the right SHA-1 is kept: `The server jar is already there.`
4. With `--accept-eula`, writes `eula.txt` with `eula=true` and a comment line with the date. Without
   the flag it prints that the EULA must be accepted and how (`--accept-eula`, or `eula.txt` by hand).
5. `<dir>` is `--dir`, else `MC_TEST_SERVER_DIR`, else `%LOCALAPPDATA%\Mindcraft\test-server` on
   Windows, else `~/.local/share/mindcraft/test-server`. `tests/world/mc_server.js` `locateServer`
   gets the same default for Linux and macOS (today it knows only the Windows one; read it first).
6. Uses the global `fetch` of Node (20 and later), no dependency. Prints what it did, one line per step.
   Exit codes: 0 done, 1 network or file error, 2 bad arguments, 3 wrong checksum.

Pure functions in `scripts/get_test_server_logic.js`, unit tested: `parseArgs`, `pickVersion(manifest, id)`,
`serverDownload(versionJson)`, `defaultDir(platform, env)`, `eulaText(date)`.

`tests/world/README.md`, the section on the environment: the script, the two variables
`MC_TEST_SERVER_DIR` and `MC_TEST_JAVA`, and the note that `JAVA_TOOL_OPTIONS` must be unset for the
server (the runner unsets it for the child process: check `mc_server.js`, and add it there if it does
not; that is the one change of E in that file besides the default folder).

## 10. Part G: glue (E5)

Starts when parts A, B and C are reported. Reads their reports and `HANDOFF.md` first.

1. **Settings** (section 2), with `settings_spec.json`. The warning of `mine_routes` without `routes_pack`.
2. **The routes pack**: `_loadWorkPacks` imports `./packs/routes/index.js` with `routes_pack`. The
   route store through `_workStore('routes', packs.routes?.RouteStore, 'routes.json')`. The trail:
   `createTrail(bot, ctx, { file: <worldDir>/trail.json, maxSteps: settings.trail_max_steps })` at spawn,
   `start()`; `stop()` when the world changes and in `cleanKill`. `ctx.routes` (I4) on `homeContext()`.
3. **`whereAmI()`** (I7): `extra.mine` from `mineAt` with `mine_routes`, the mines of the dimension.
4. **Commands** (I10): `!rememberRoute`, `!routes`, `!forgetRoute` through `runPack` with the routes
   pack; `!rememberMine`, `!rememberTunnel`, `!collectPassedOre` through `runPack` with the mining pack
   (`mine_routes`; `playerYaw` for `!rememberTunnel` from the player of `agent.last_order` when the
   player is in `bot.players`). `!goToRememberedPlace`: when `goToPosition` did not arrive (the bot is
   farther than 2 blocks from the place), `ctx.routes?.walkTo(bot, place)`; its text when it fails with
   a reason other than `no_route`. `!mineOre` unchanged (the pack decides).
5. **`!newAction`** with `skills_over_code`: before the cost check, `isDiggingRequest` of the `prompt`
   argument and of the last message of a player in the history; a digging request returns
   `digRefusalText(commands)` with the digging commands that are on and no call of the model.
   A command typed by the player runs.
6. **Prompt**: descriptions of the new commands, examples for: "this is the mine, remember this" to
   `!rememberMine("mine")`, "dig here" to `!rememberTunnel`, "remember this way to the bed" to
   `!rememberRoute("bed")`, "collect the coal you passed" to `!collectPassedOre("coal")`, "which ways do
   you know" to `!routes`. No example switches a safety reflex off. The knowledge block: nothing to do
   beyond `whereAmI`.
7. **Prompt size**: with every switch on the conversing prompt without conversation stays at 17,000
   characters or less (today 16,807). Shorten descriptions of commands to get there. Report the sizes:
   all off, all on. The test `tests/unit/stg_prompt.test.js` must keep passing with the new switches
   added to its list.
8. **Routing list**: sentences for the new commands, at least 15, parts `routes_pack` and `mine_routes`.
9. **`modes.js`**: `whereOf(agent)` already uses `agent.whereAmI()`; check that `night_shelter` and
   the creeper check see `underground` true on the route (I7) without a change; change nothing else.

## 11. Tests

### TU: unit tests from the spec (T1)
One file per section of the spec, `tests/unit/rt_<topic>.test.js`. Test the texts word for word where
the spec gives them. Test every row of the tables (settings, legs, reasons of the ore list, the ranges
of the ores, the exit codes of the script). Test that every switch off gives the behaviour of v0.1.4.8.
Test `routeStart` with a trail that passes two known things, `skyStart`, `routeFromSteps` with a ladder
run and a trapdoor, `reverseRoute`, `nearestRoute`, `mineAt`, `tunnelFor`, `branchPlan`,
`measureTunnel`, `oreInSight`, `isDiggingRequest` (also `mine` as a pronoun: "give me mine" is a
digging request too; the spec accepts that), the usage numbers of the three OpenAI calls, `priceFor`.

### TW: world tests (T2)
1. `tests/world/base_world.js`: the mine of the base gets a furnace in the room. The base is otherwise
   as it is: shaft with trapdoor and ladders, room at y 41, descent to y 25, tunnel of 12 to the north.
2. **The walk in.** A scenario that needs the trail moves the bot along the way with typed
   `!goToCoordinates` orders where the path search can walk, and cell by cell with the test control
   (200 ms per cell) where it cannot (the ladder). The trail then holds a ladder run and the trapdoor.
3. **Scenarios**, numbers from W61, one per row, all with `MODES_PROFILE` and typed orders:

| Id | Name | Passes when |
|---|---|---|
| W61 | trail_records | after a walk of 30 blocks through the door of the house, `trail.json` holds the steps in order, one with `via` door, `sky` false inside the house and true outside |
| W62 | route_to_bed | the place `storage` saved in the room at y 41; the bot walks up the ladder and through the trapdoor to the bed; `!rememberRoute("bed")` answers the text of A2 with 1 ladder and 1 trapdoor; the bot is put back into the room; at night `!goToBed` puts it to sleep in the bed |
| W63 | route_reverse | from the bed `!goToRememberedPlace("storage")` brings the bot into the room at y 41 down the ladder |
| W64 | route_broken | the ladder removed: `!goToRememberedPlace("storage")` answers the text of I3 with the step and the position, digs nothing, the bot lives |
| W65 | remember_mine | the bot walks from outside the house down to the tunnel end; `!rememberMine("mine")` answers the text of B2; `mines.json` holds the mine with `source player`, a route with a ladder leg and a door leg, a room with chest, table and furnace, one tunnel of 12 at level 25 going north |
| W66 | remember_tunnel | in the tunnel `!rememberTunnel` answers the text of B3 with start, north, end, 12 blocks, level 25 |
| W67 | mine_known | 4 iron ore placed beyond the tunnel end: `!mineOre("iron", 4)` walks the route, digs on, brings 4 raw_iron, comes up; the tunnel is longer than 12 in `mines.json`; no new entrance |
| W68 | passed_ore | 2 gold ore in the wall beside the tunnel end, the bot with a stone pickaxe: after `!mineOre("iron", 2)` the gold is in `passed` with reason `pickaxe` and the text says so; with an iron pickaxe `!collectPassedOre("gold")` gets it and `passed` is empty |
| W69 | ore_sense | an iron ore 2 blocks inside the wall: with `ore_sense_range` 0 it stays after `!mineOre("iron", 1)` (the ore placed ahead is taken instead); with 3 it is taken |
| W70 | ore_in_sight | one iron ore exposed in the tunnel wall, one 5 blocks inside the rock: `!collectBlocks("iron_ore", 2)` with `ore_sense_range` 0 takes the exposed one and says the text of C1 |
| W71 | dusk_on_route | the bot on the ladder run of the mine route at dusk: `night_shelter` does nothing for 60 s |
| W72 | dig_code_refused | `!newAction("dig a tunnel to the east")` with `skills_over_code`: the text of I8, the fake code model is never called |
| W73 | branches | a mine with a tunnel of 32 in the store: `!mineOre("iron", 2)` digs the first branch to the left at 4 blocks from the start, 1 wide, 2 high |
| W74 | flags_off_0149 | every new switch off: no `trail.json`, the six commands are hidden, `!mineOre` asks as in v0.1.4.8, `!newAction` runs |
| W60 | long_run | as before, with `routes_pack` and `mine_routes` on and the orders of the new commands in the list; the process never ends |

4. The scenarios of v0.1.4.8 (W30 to W58) pass as they are; a text that changed is corrected in the
   scenario and named in the report.

## 12. Order of work

| Round | Parallel | Then |
|---|---|---|
| 1 | A (E1), B (E2), C (E3) | tech lead reads the reports, `npm test`, `HANDOFF.md` |
| 2 | D+E (E4), G (E5), TU (T1) | `npm test`, `npm run test:e2e` |
| 3 | TW (T2), and a fix engineer for what the tests found | `npm run test:world`, `DECISIONS.md`, fix round, fresh checkout, PR |

## 13. Addendum after the play test of 2026-10-01: the follow down a ladder (F14)

The owner's play (`docs/releases/0.1.4.9/DECISIONS.md`, F14): `!followPlayer` and `!goToPlayer` use the
path search, which climbs a ladder but never descends one and stops in the cell of an open trapdoor above
a ladder. So the bot cannot follow the player down into the basement, and the way into the mine cannot be
learned. This is a fix of v0.1.4.9, on the branch `hotfix/follow-ladder`; the tag `v0.1.4.9` goes on its
merge commit.

### Part L: the ladder in the follow (E3, owner of `skills.js`)

Files: `src/agent/library/skills.js` (`followPlayer`, `goToPlayer` and their helpers only), new
`src/agent/library/ladder_logic.js` (pure), new `src/agent/library/ladder_pass.js` (executing), unit tests
`tests/unit/rtl_*.test.js`. The signatures and the return values of `followPlayer` and `goToPlayer` do not
change.

Behind `routes_pack` (read like `ore_sense_range`: the agent settings first, then the file). With the
switch off nothing changes.

`ladder_logic.js`, pure:

```js
export function ladderColumnAt(getName, feet, { reach = 2, maxHeight = 64 })
// -> { x, z, top, bottom, facing, trapdoor: {x,y,z,name}|null } | null
//    the ladder column whose top or bottom cell is within `reach` blocks of the feet (horizontally 2, vertically 2),
//    with a trapdoor directly above its top when there is one
export function ladderWay(column, feet, target)
// -> 'down' | 'up' | null : down when the target is 2 or more blocks below the feet and within 3 blocks
//    horizontally of the column; up when 2 or more above; null otherwise
```

`ladder_pass.js`: `passLadder(bot, column, way, { clock, timeoutMs = 30000 })` -> `{ ok, reason, text }`,
never throws. It imports `slideDown`, `climbUp`, `enterColumn` and `footOf` from
`src/agent/packs/mining/ladder.js` with a dynamic `import()` (the library must load without the pack).
Down: when the trapdoor is closed, walk to the cell beside it, open it with `bot.activateBlock` (no
sneak), then `slideDown` with a leg `{ kind: 'ladder', x, z, top, bottom, face: facing, entry: <the cell
beside the top on the open side> }`. Up: `enterColumn` from the foot, `climbUp`; a closed trapdoor at the
top is opened from below as `replay.js` does (`climbToOpen`: press forward, click without sneak). The door
service closes the trapdoor behind the bot as it closes doors.

In `followPlayer`: in the loop, when the bot has not moved for 3 s (the existing `stuck_since`) or the
path search has no goal, and `ladderWay(ladderColumnAt(...), feet, player.position)` is not null: stop the
path search (`setGoal(null)`), `passLadder`, then set the follow goal again. At most 3 ladder passes per
minute; a failed pass writes its text to the log once. In `goToPlayer`: before the path search, when the
player is 2 or more blocks below or above and a column is within reach, `passLadder` first, then the path
search as today. `bot.modes?.noteProgress?.('ladder')` after a pass.

Texts (log): `I go down the ladder at (13, 66, 51) after MartyByrde2.`, `I climb up the ladder at (13, 66, 51) after MartyByrde2.`,
`I could not go down the ladder at (13, 66, 51): <reason of passLadder>.`

The console line of an interrupted action: `Agent executed: !followPlayer and got: undefined` becomes
`Agent executed: !followPlayer and was stopped.` (part G's file `src/agent/agent.js` or wherever the
line is printed; E3 may change that one line and names it).

### Tests

- TU: `tests/unit/rt_ladder_follow.test.js` from this section: `ladderColumnAt` (a column with and
  without a trapdoor, out of reach, a column of one ladder), `ladderWay` (down, up, null), `passLadder` on
  the fake bot of the mining pack (down through a closed trapdoor, up, interrupted), `followPlayer` on a
  fake bot with a player below (the pass is called once, the goal is set again), the switch off.
- TW: `w75_follow_ladder.js`: in the base world, with `MODES_PROFILE` and the owner's switches, a second
  bot (`connectPlayer`) stands in the house; `!followPlayer` typed; the second bot goes down the ladder
  cell by cell with the test control to the room at y 41; within 60 s the bot is within 4 blocks of it at
  y 41, the trapdoor was opened by the bot (the move recorder shows the click), the trail holds the
  ladder run; then the second bot climbs up and the bot follows to the house. Then `!goToPlayer` typed
  with the player in the room and the bot in the house: the bot arrives. W60 stays green.
