# SPEC v0.1.4.11 "Navigation and words"

This is the spec as the engineers get it on 2026-10-02. The plan for the owner is `PLAN.md`. The notes
between the parts are `HANDOFF.md`; where they disagree with this spec, they win. The defects that the
tests find, with the decisions, are `DECISIONS.md`.

Tech lead: Fable. Base: `origin/main` after the merge of `hotfix/goals` (the tag `v0.1.4.10`).
Branch: `hotfix/navigation`. Work folder: the checkout `/home/user/mc-goals`, shared. Node 22.

## 0. Rules for every engineer

The rules of `docs/releases/0.1.4.10/SPEC.md` section 0 hold word for word: never `keys.json`, never a
real model, never port 55916, no git command that writes, strict file ownership, a switch for new
behaviour and none for a correction, LF, texts word for word, `{ ok, reason, text }` and never a throw,
static imports only of names that exist, packs through `ctx`, a report as text at the end, no
`npm run test:world` unless your part says so, the journey scenarios are the gate. Three more:

15. A text the bot says names the cause and the next step. It never asks the owner to do what the bot
    could do, and never names what the code did not check.
16. The functions of `src/agent/library/skills.js` keep their signatures and the meaning of their return
    values; their texts may change.
17. `profiles/claude.json` keeps its voice: nothing goes into it except the two lines of W6.

## 1. Goal and acceptance

| Goal | Measured by |
|---|---|
| Every failure text names the cause and the next step | W98, the unit tests of the texts |
| The tunnel the owner stands in is accepted where the owner stands | W91 |
| A new shaft may start from the room or a tunnel end of a known mine | W92 |
| `!goToSurface` means open sky | W93 |
| One sentence that names the place saves the area, with the kind the bot concludes | W94 |
| A route is walked by the path search from the nearest waypoint | W95 |
| A dry scan before the first step names the block | W96 |
| "Come here" never digs toward the player | W97 |
| Nothing regressed | the journeys W59, W80 to W90, the full set |

## 2. Settings

New keys in `settings.js` and `src/mindcraft/public/settings_spec.json` (part M for the first, P for the
second, N for the third; each engineer adds only its key, in the same style as `area_floors`):

| Key | Default | Type | Meaning |
|---|---|---|---|
| `mine_from_inside` | `false` | bool | A new shaft may start from the room or a tunnel end of a known mine |
| `area_sense` | `false` | bool | The bot scans an unsaved enclosure it enters and says what it thinks it is |
| `routes_by_search` | `false` | bool | Routes are waypoints walked by the path search; off, the legs of v0.1.4.9 |

The texts (W), the tunnel measurement (M2), the surface (W4), the kinds of places (P3), the door service
(N4) and the walk toward the player (N5) are corrections: no switch. With every switch off the bot
behaves as v0.1.4.10, except for the texts.

## 3. Parts, owners, files

| Part | Engineer | Files (owned) | Round |
|---|---|---|---|
| W Words | E1 | `src/agent/packs/routes/texts.js`, `src/agent/packs/routes/replay.js` (the reason of a failed leg only), `src/agent/packs/mining/texts.js` (the texts of W2 and M), `src/agent/dig_request_logic.js`, `src/agent/library/skills.js` (`goToSurface`, `givePlayer` texts only), `src/agent/commands/index.js` (the argument text), `src/agent/commands/actions.js` (descriptions of `!goToSurface`, `!goToMine`, `!leaveMine`, `!rememberTunnel`, `!newAction`), `profiles/claude.json` and `profiles/gpt.json` (the two lines of W6 only), `scripts/scorecard_logic.js` and `scripts/scorecard.js` (W7); `tests/unit/nw_*.test.js` | 1 |
| M The mine | E2 | `src/agent/packs/mining/mining.js`, `mine_logic.js`, `mine_player.js`, `mine_way.js`, `mine_store.js`, `index.js`; `settings.js` and `settings_spec.json` for `mine_from_inside`; `tests/unit/nm_*.test.js` | 1 |
| P Places | E3 | `src/agent/areas/area_scan.js`, `area_store.js`, `keep_out_logic.js`, `keep_out.js`, new `area_kind.js`, new `area_sense.js`; `src/agent/modes.js` (the reflex `area_sense` and the kind checks of item_collecting only); `src/agent/commands/actions.js` (`!rememberArea` only); `src/agent/knowledge/knowledge_text.js` and the input in `src/agent/agent.js` (the enclosure line only); `profiles/defaults/_default.json` (examples), `tests/routing/sentences.json`; `settings.js` and `settings_spec.json` for `area_sense`; `tests/unit/np_*.test.js` | 2 |
| N Navigation | E4 | `src/agent/packs/routes/*` except `texts.js` (new `waypoints.js`, `dry_scan.js`), `src/agent/packs/mining/mine_way.js` (the way in and out by waypoints, behind the switch; after M), `src/agent/packs/home/doors.js` and `door_logic.js` (N4), `src/agent/library/skills.js` (`goToPlayer`, `followPlayer`: N5, N6), `settings.js` and `settings_spec.json` for `routes_by_search`; `tests/unit/nn_*.test.js` | 3 |
| TW Journeys | T3 | `tests/world/w91` to `w98`, `journey.js`, `base_world.js`, `tests/world/README.md` | 1 (written before the build, fail on the old code), run at every integration |
| TU Unit tests from the spec | T1 | `tests/unit/nv_*.test.js` | 2 |
| G Glue | lead | `CHANGELOG.md`, `docs/`, the merge of the parts | every round |

Part W and part M both change `src/agent/packs/mining/texts.js`: W owns the file; M writes its new texts
into its report and W adds them word for word (round 1, the two work side by side; M reaches them as
`TEXTS.<key>` with optional chaining until they exist). Part P and part W both touch
`src/agent/commands/actions.js`: different commands, different rounds.

## 4. Interfaces

### I1. A failed leg of a route (N and W)

`walkRoute` and `walkByRoute` of `replay.js` return, on failure, `{ ok: false, reason, text, route, step,
total, at, cause }` where `cause` is one of

```
{ kind: 'door',    name, x, y, z, state: 'closed' | 'blocked' }      an openable the bot could not open or pass
{ kind: 'ladder',  x, z, y, gap }                                   a column with `gap` missing ladders at `y`
{ kind: 'no_path', from: {x,y,z}, to: {x,y,z} }                     the path search found no way for a walk leg
{ kind: 'stuck',   at: {x,y,z} }                                    the bot did not move for the time of the leg
{ kind: 'interrupted' }
```

`routeFailedText(route, step, total, at, cause)` of `texts.js` writes the text (section 5). Until N lands,
the replay of v0.1.4.10 fills `cause` from what it knows: a door leg that failed gives `door`, a ladder leg
`ladder` or `stuck`, a walk leg `no_path`. The field `cause` is required from round 1; the waypoint walk of
round 3 keeps it.

### I2. The place of the bot for the dig refusal (W)

`digRefusalText(commands, place)`, `place` optional: `{ inTunnel: boolean, inMine: boolean, underground:
boolean, fromInside: boolean, ore: string|null }`; `inTunnel` from `mineAt(...)?.tunnel !== null`,
`inMine` from `mineAt(...) !== null`, `underground` from `whereAmI()`, `fromInside` the setting, `ore`
the ore named in the request when `isDiggingRequest` finds one of the ore table, else `iron`. The glue
(the `!newAction` perform in `actions.js`, part W) builds it.

### I3. The tunnel from the player (M)

`rememberTunnel(bot, ctx, name, options)` takes `options.playerPos` and `options.playerYaw` (the glue of
`!rememberTunnel` passes the position and the yaw of the player who gave the order, as it passes the yaw
today). `measureTunnel(getName, feet, dir)` of `mine_logic.js` accepts a corridor 1 or 2 wide and returns
`width` (1 or 2); `corridorTunnel` tries the bot's cell first, then the player's cell. A corridor whose
only open direction points at the room (the bot at the rock face) is measured backwards and its `dir` is
the direction away from the room.

### I4. The second level of a mine (M)

A shaft dug from inside a known mine makes a mine of the bot (`bot:<level>`, as R4 of v0.1.4.10) with
`parent: '<name of the known mine>'`, `entrance: { x, y, z }` the top cell of the shaft inside the parent
(the floor cell the bot stood on), `shaft: 'ladder'`, `level` the target level, and the tunnel it digs.
`wayIn` to a child: `wayIn` to the parent, then the child's shaft down. `wayOut` from a child: the shaft
up, then the parent's way out. `chooseMine` prefers a child whose `level` fits the ore. `!mines` lists a
child under its parent: `bot:-58 (from the mine "mine")`. `!forgetMine` of a parent forgets its children.

### I5. The enclosure (P)

```
scanEnclosure(getBlockName, origin, options) ->
  { found: boolean, box: {min, max}, border: 'fence' | 'wall' | 'glass' | 'hedge' | 'water' | 'mixed' | null,
    openings: [{ x, y, z, kind: 'door' | 'gate' | 'trapdoor' | 'gap' }],
    roof: boolean, floor: 'tilled' | 'built' | 'ground' | 'mixed',
    reason: string|null }
countContents(bot, box) ->
  { animals: { chicken: 6, cow: 1 }, crops: { wheat: 40 }, beds: 1, chests: 2, furnaces: 0, tables: 1, ladders: 0, water: 0 }
kindOf(enclosure, contents) -> 'pen' | 'farm' | 'home' | 'storage' | 'building' | 'yard'
```

The rules of `kindOf`, in this order, the first that fits: animals of 1 kind or more and an opening of kind
gate or door: `pen`; crops on tilled floor: `farm`; a roof, a door and a bed: `home`; a roof and chests or
furnaces: `storage`; a roof and a door: `building`; else `yard`. The area record of `area_store.js` gets
`kind` (what the bot concluded), `contents` (the counts, as scanned) and `border`; `type` stays and is set
from the kind (pen, farm, home, building; storage and yard map to building) so that every reflex of
v0.1.4.10 keeps working. `scanBuilding`, `scanPen`, `scanFarm` and `scanWithoutType` stay and call
`scanEnclosure` inside.

The reflexes read the facts: `isKeepOutArea(area)` is true for a kind of pen and for an area with
animals in `contents` and an opening of kind gate, and for `flags.no_enter`, as today for the types pen
and farm.

### I6. The enclosure line of the knowledge block (P)

`whereLine(where)` of `knowledge_text.js` takes `where.enclosure`: `{ saved: false, border, size: { x, z },
contents, openings }` and writes `You stand in a fenced enclosure 9 x 7 with 6 chickens and 1 gate that is
not saved.` The input is built in `agent.js` from `scanEnclosure` at most once per 10 s and only when the
bot stands inside an enclosure that no saved area holds. Nothing when `found` is false or the area is
saved.

### I7. Waypoints (N)

```
waypointsOf(route) -> [{ x, y, z, kind: 'start' | 'door' | 'gate' | 'trapdoor' | 'ladder_top' | 'ladder_foot' | 'room' | 'tunnel' | 'end', name }]
nearestWaypoint(waypoints, pos) -> index
walkWaypoints(bot, ctx, waypoints, { from, to, clock, deadline }) -> { ok, reason, text, step, total, at, cause }
dryScan(bot, waypoints, { from, to }) -> { ok: boolean, step, from: {x,y,z}, to: {x,y,z}, cause }
```

A route of legs gives its waypoints: the ends of every leg, the openable of a door leg, the top and the
foot of a ladder leg. `walkWaypoints` walks with the path search of v0.1.4.10 (native ladders, doors and
trapdoors), waypoint to waypoint, `GoalNear` 1, each hop at most 60 s. `dryScan` computes the path of each
hop without moving (`bot.pathfinder.getPathTo` with the same movements) and stops at the first hop with
no path. `wayIn`, `wayOut`, `walkBack` of `mine_way.js` and the walks of `!goToBed`, `!goToShelter`,
`!goToPlace` use them when `routes_by_search` is on; off, the legs as today.

### I8. A door a walk is about to pass (N4)

`ctx.doors?.reserve?.(door, ms)` of the home pack: the door service does not close this openable for `ms`
(at most 20 s), and never while the bot is within 1.5 blocks of it. `walkWaypoints` reserves the next
openable of its hop before the hop; the pathfinder's own door moves are covered by the 1.5 blocks.

## 5. Texts, word for word

### W1 Routes (`src/agent/packs/routes/texts.js`)

```
I could not follow the route "mine" at step 6 of 12: the door at (9, 41, 43) is closed and I could not open it.
I could not follow the route "mine" at step 6 of 12: the gate at (-6, 63, 28) is blocked.
I could not follow the route "mine" at step 4 of 12: the ladder at (13, 51) has a gap of 2 at y 61. I need 2 ladders to go on.
I could not follow the route "mine" at step 2 of 12: I found no way from (11, 67, 52) to (13, 68, 51).
I could not follow the route "mine" at step 7 of 12: I got stuck at (8, 41, 46).
```

The sentence "Show me the way again." goes. `noWayToStartText`: `I find no way from (x, y, z) to the start
of the route "mine" at (9, 67, 52).`

### W2 The tunnel (`src/agent/packs/mining/texts.js`)

```
I measured the tunnel: it starts at (10, 30, 6), goes north, and ends at (10, 30, 2) after 5 blocks, at level 30. I dig on at its end when you ask for ore.
I measured the tunnel: it starts at (10, 30, 6), goes north, and ends at (10, 30, 2) after 5 blocks, at level 30, 2 wide. I dig on at its end when you ask for ore.
I measured the tunnel from where you stand: it starts at (10, 30, 6), goes north, and ends at (10, 30, 2) after 5 blocks, at level 30. I dig on at its end when you ask for ore.
I stand in no tunnel: it is open on 3 sides at (10, 30, 6). Stand in the tunnel and say "dig here".
I stand in no tunnel: the way ahead at (10, 30, 5) is 3 wide. A tunnel is 1 or 2 wide and 2 high.
I stand in no tunnel: the ceiling at (10, 32, 6) is open. A tunnel is 1 or 2 wide and 2 high.
```

The third line is the first or second with "from where you stand" when the bot's cell failed and the
player's cell gave the tunnel. The "no tunnel" lines name the first check that failed, in the order: open
sides at the feet, the width ahead, the ceiling.

### W3 The new mine underground (`src/agent/packs/mining/texts.js`)

```
I dig a shaft down from here to level -58 for diamond.                                  (mine_from_inside on, inside a known mine)
I am underground, not in a mine I know. A new mine starts from the surface: say "leave the mine" or "go to the surface" first.   (underground, no known mine here)
I am in the mine "mine". A new shaft from inside needs the setting mine_from_inside; say "leave the mine" first for a new mine from the surface.   (switch off, inside a known mine)
```

### W4 The surface (`src/agent/library/skills.js`, `goToSurface`)

```
I am under the open sky already.
I went out through the door at (10, 67, 52) and stand under the open sky at (8, 67, 50).
I climbed to the open sky at (9, 67, 52).
I find no way to the open sky from (10, 48, -26).
```

"Open sky" means: no block above the bot up to the top of the world. Inside a building (the position is
in an area of kind home, building or storage, or has a roof within 6 blocks) the skill walks to the
nearest entrance of the area and one block beyond it, then checks the sky; in a mine (`whereAmI().mine`)
it calls the way out of the mining pack through `ctx` when the pack is on; elsewhere it walks to the
nearest column with open sky within 16 blocks, else the text of no way. No digging. The description of
`!goToSurface`: `Go out under the open sky: out of a building through its door, up from a mine. Use this when the player says "get to the surface" or "get out".`

### W5 Give and the arguments (`skills.js` `givePlayer`, `src/agent/commands/index.js`)

```
Gave 44 wheat to MartyByrde2.
MartyByrde2 took 40 of 44 wheat; 4 lie on the ground at (8, 63, 28).
!rememberRoute takes 1 argument (name): !rememberRoute("name").
!goToCoordinates takes 3 or 4 arguments (x, y, z, closeness): !goToCoordinates(x, y, z).
```

The argument text is built from `params` of the command: the names in order, the optional ones counted in
the range, the example with the names of the required ones (a string parameter in quotes).

### W6 The two lines of the prompt (both profiles, after "take a deep breath and have fun :)")

```
Answer a question with words, not with a command, and never stop a running command for a question.
A rule about a place names a place you saved; say "this is the aviary" first when it is not saved.
```

### W7 The dig refusal (`src/agent/dig_request_logic.js`)

```
I do not write code for digging. From here: !mineOre("iron", 8).                           (in a tunnel of a known mine)
I do not write code for digging. From here: !mineOre("diamond", 8, true).                  (on the surface, or inside a known mine with mine_from_inside)
I do not write code for digging. From here: !rememberTunnel, then !mineOre("iron", 8).     (in a known mine, not in a tunnel, switch off)
I do not write code for digging. From here: say "leave the mine", then !mineOre("iron", 8, true).   (underground, no known mine)
I do not write code for digging. Switch on the mining pack, or type the command !newAction in the chat yourself.   (no digging command on, as today)
```

The ore is the one of the request when it names one of the ore table, else `iron`; the count is 8.

### W8 The scorecard

`scripts/scorecard.js` prints, after the table of commands chosen, `Failure texts, <log>: <text> N, ...`:
the result texts that begin with `I could not`, `I find no`, `I stand in no`, `I am underground` or `I
cannot`, cut at the first colon or period, counted, the most frequent first, at most 10.

### P1 Places (`src/agent/areas/area_kind.js`, the answer of `!rememberArea`)

```
I saved "aviary": a pen, fenced, 9 x 7, 1 gate, 6 chickens. I keep its gate closed and pick nothing up inside it.
I saved "wheat_farm": a farm, fenced, 8 x 12, 1 gate, 40 wheat. I only plant and harvest there.
I saved "home": a home, walled, 9 x 11 with a roof, 1 door, 1 bed, 2 chests. I shelter there at night.
I saved "cellar": a storage, walled, 5 x 5 with a roof, 1 door, 4 chests, 2 furnaces. I use its chests.
I saved "barn": a building, walled, 7 x 9 with a roof, 1 door. I change nothing in it.
I saved "yard": a yard, fenced, 12 x 12, 1 gate. I change nothing in it.
"aviary" is a farm now. I only plant and harvest there.                                  (the same name again with a type, or !setArea on an existing name)
That is the area "home" already.                                                           (v0.1.4.10, unchanged)
I find no border around me: no fence, wall, hedge or water within 24 blocks. Stand inside the place and say it again.
```

The contents list the counts that are not 0, in the order animals (by kind, the most first), crops, beds,
chests, furnaces, tables, ladders, water. The sentence of the kind: pen `I keep its gate closed and pick
nothing up inside it.`; farm `I only plant and harvest there.`; home `I shelter there at night.`; storage
`I use its chests.`; building and yard `I change nothing in it.` `!rememberArea("aviary", "pen")` with a
type keeps the owner's word as the kind and says it the same way.

### P2 The area sense (`src/agent/areas/area_sense.js`, the reflex `area_sense`)

```
I am in a fenced pen 9 x 7 with 6 chickens and 1 gate that I have not saved. Tell me its name and I keep it.
I am in a walled building 7 x 9 with a roof and 1 door that I have not saved. Tell me its name and I keep it.
```

Once per enclosure (its box) per start, not while a command runs, not within 60 s of the last such line,
only when the bot has stood inside for 3 s. The reflex is off by default (`area_sense`) and is listed in
the modes with the others.

### P3 The knowledge line

```
You stand in a fenced enclosure 9 x 7 with 6 chickens and 1 gate that is not saved.
```

### N1 The dry scan

```
I find no way from (11, 67, 52) to the trapdoor at (13, 67, 51).
I find no way from (9, 41, 42) to the door at (9, 41, 43): it is closed and I cannot open it.
```

Said before the first step, the bot does not move. The second form when the hop ends at an openable that
is closed and `canOpen` of the home pack says no (locked, blocked, iron).

### N2 The walk toward the player

```
I find no way to you from here without digging. Come closer or tell me to dig.
I stopped at (13, 40, -10): ahead is a cave. Tell me to go on if you want.
```

The first replaces the destructive fallback of `goToPlayer` and `followPlayer` (the log line `Path not
found, but attempting to navigate anyway using destructive movements.` is never written by these two);
other walks keep the fallback. The second when a walk of these two enters a cave: a cell with open air 3
wide and 3 high around the bot and no placed block (`placed.json`) within 8 blocks, the goal not inside
it; the walk stops and says it once.

## 6. Unit tests to write

| Part | Tests |
|---|---|
| W | `routeFailedText` for each cause, no "Show me the way again" anywhere in the texts of the packs (a grep test over `src/agent/packs/*/texts.js`); the tunnel texts; the refusal for each place; the argument text from `params`; the two lines present in both profiles and nothing else changed in `profiles/claude.json` (the test of v0.1.4.10 adapted); the scorecard counts the failure texts |
| M | `tripStart` with `fromInside` and `mine`; the child mine record, `chooseMine` prefers the child by level; `measureTunnel` width 1 and 2, backwards at the rock face, from the player's cell; `minesText` with a child |
| P | `scanEnclosure` on fixtures: a fenced pen with a gate, a walled house with a roof and a door, a hedge, a pond, a fence with a gap, no border; `countContents` with a fake bot (entities and blocks); `kindOf` for each rule and the order; the record fields; `isKeepOutArea` by facts; the texts; the knowledge line; the area sense once per box and the timing rules |
| N | `waypointsOf` for each leg kind, `nearestWaypoint`, the direction choice; `walkWaypoints` and `dryScan` with a fake pathfinder; the reservation of a door; `goToPlayer` with no path: the text, no destructive movements |
| T1 | From the spec, not the code: the texts of section 5 word for word, the kind rules, the waypoint rules, the switch defaults, every setting in `settings_spec.json` |

## 7. Journeys (T3, written from the plan before the build; they fail on v0.1.4.10)

The rules of `docs/PROCESS.md` hold: black box, the control never moves the bot, the owner's switches of
`PLAYTEST.md` section 2 plus the three new switches on, an empty memory, facts of the world.

| Journey | Steps | Passes when |
|---|---|---|
| W91 `tunnel_where_you_stand` | The owner walks the bot (follow) to the rock face of the tunnel of the base (`base_world.js` gets a 1-wide tunnel of 8 from the room, if it has none); "dig here" (`!rememberTunnel`) with the bot at the end, then with the owner at the end and the bot 3 behind; then `!mineOre("iron", 2)` | Both measurements answer with `I measured the tunnel` and the right start, end and direction; no `I stand in no tunnel`; the bot digs on at the end (the tunnel is 2 longer after the order) |
| W92 `shaft_from_room` | The bot in the room of the mine (the owner's route), `!mineOre("diamond", 1, true)` with `mine_from_inside` | The text `I dig a shaft down from here to level`; a column of ladders from the room floor down; the bot comes back to the room; `!mines` lists the child under the parent; `!leaveMine` from the bottom reaches the surface |
| W93 `open_sky` | `!goToSurface` from inside the house, then from the mine room | Both end with no block above the bot; the first went through the door (the door closed after); the texts of W4; never on the roof (y of the bot is the ground level, not the roof) |
| W94 `place_from_sentence` | In the pen of the base: `!rememberArea("aviary")`; in the farm: `!rememberArea("farmland")`; in the house: `!rememberArea("home")`; then items dropped in the aviary with the bot outside | The three answers of P1 with the right kinds and counts; the areas hold the right boxes; the reflex says `I leave the ... in the pen "aviary"` and the gate stays closed; `!rememberArea("aviary", "farm")` answers `"aviary" is a farm now.` |
| W95 `route_joined` | `routes_by_search` on; the owner's route to the mine remembered; the bot put on the way by following the owner to the middle ladder and stopping there; `!goToMine`; then from the tunnel `!leaveMine`; the door service on | The bot reaches the room without going back to the house (its y never rises above the ladder top during the walk); `!leaveMine` reaches the surface; no `I could not follow`; every door closed behind it at the end |
| W96 `dry_scan` | The owner puts a block in the doorway of the room door (or locks it with a block in front); `!goToMine` from the house | The text of N1 naming the door; the bot's position unchanged (within 1 block) after the answer; after the owner removes the block `!goToMine` reaches the room |
| W97 `no_digging_to_player` | The owner stands in a sealed box of stone 3 away from the bot; "come here" | The text of N2; no block of the box broken; no `destructive` line in the log of the bot; then the owner opens the box and "come here" reaches him |
| W98 `words` | `!goToMine` with no route and a blocked way; `!newAction("dig a tunnel")` in the room, in the tunnel, on the surface; `!rememberRoute("a", "b")`; `!givePlayer` of 4 wheat | No answer holds `Show me the way again`; the refusal names the call of W7 for each place; the argument text of W5; `Gave 4 wheat to w_player.` |

`journey.js` gets the three switches in `JOURNEY_SETTINGS`. The README rows, as for W85 to W90.

## 8. Order of the rounds

Round 1: T3 writes W91 to W98 and runs them on v0.1.4.10 (they fail); E1 and E2 build W and M. The lead
runs the unit tests, W91 to W93 and W98, commits, writes the handoff.
Round 2: E3 builds P; T1 writes the tests from the spec. The lead runs W94 and the twelve of before.
Round 3: E4 builds N. The lead runs W95 to W97, then the journey group, then the full set in a fresh
clone; the fix round; the release.
