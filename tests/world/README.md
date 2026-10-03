# World tests: the bot on a real Minecraft server

`npm run test:world` runs the scenarios of `tests/world/` against the official Minecraft 1.21.8
server. The unit tests (`npm test`) and the end-to-end tests (`npm run test:e2e`, a simulated
server without a world) cannot prove that the bot digs, walks through doors or runs from a
creeper. These tests can: real blocks, real physics, real monsters. The language model is always a
fake with canned replies; nothing leaves 127.0.0.1.

## Running

```
npm run test:world                       all scenarios (about 90 minutes since v0.1.4.9: the long run alone takes 30)
node tests/world/run.js doors shelter    only scenarios whose name contains one of the words
node tests/world/run.js all_modes_on     a group: the work scenarios w15 to w28 (W30 of v0.1.4.8)
node tests/world/run.js journeys         a group: the journey scenarios W59 and W80 to W84 (below)
node tests/world/run.js --verbose        the whole output of every scenario while it runs
node tests/world/run.js --server-log     also the server lines of every scenario
```

The shell of the owner's machine has Node 24; the tests need Node 20: `fnm exec --using=v20.20.2 -- node tests/world/run.js ...`.

Node 20 is required, as for the other tests. The exit code is 0 only if every selected scenario
passed and nothing was left behind (see "Hygiene").

### Environment variables

| Variable | Meaning | Default |
|---|---|---|
| `MC_TEST_SERVER_DIR` | folder with `server-1.21.8.jar` and the accepted `eula.txt` | Windows: `%LOCALAPPDATA%\Mindcraft\test-server`; Linux and macOS (since v0.1.4.9): `~/.local/share/mindcraft/test-server` |
| `MC_TEST_JAVA` | the `java` of Java 21 (`java.exe` on Windows) | Windows: the Java of the Minecraft launcher (see `mc_server.js`); Linux and macOS: none, set it (for example `/usr/bin/java`) |
| `MCW_LOG_DIR` | if set, the runner copies the output of every scenario run and the server log there | not set: nothing is kept |
| `JAVA_TOOL_OPTIONS` | must not reach the server; `mc_server.js` removes it from the environment of the server process (since v0.1.4.9), so the runner may be started with it set | - |

Without the jar, an accepted `eula.txt` or Java the runner prints
`World tests skipped: no test server found.` and exits with 0.

### Getting the server (v0.1.4.9)

```
node scripts/get_test_server.js                  download the server jar into the folder of the test server
node scripts/get_test_server.js --accept-eula    the same, and write eula.txt with eula=true
node scripts/get_test_server.js --dir <folder>   another folder
```

The script reads Mojang's version manifest (`https://piston-meta.mojang.com/mc/game/version_manifest_v2.json`),
finds 1.21.8 and its server download, and refuses a server whose SHA-1 is not
`6bce4ef400e4efaa63a13d5e6f6b500be969ef81` (the file the tests were made with, 57,555,044 bytes). It downloads
to `server-1.21.8.jar.part`, checks SHA-1 and size and renames it to `server-1.21.8.jar`; a jar that is there
already with the right SHA-1 is kept. The folder is `--dir`, else `MC_TEST_SERVER_DIR`, else the default of the
table above, the same that the runner uses. `--accept-eula` means that you accept the EULA of Minecraft
(`https://aka.ms/MinecraftEULA`); without it the script says how to accept it (the flag, or `eula=true` in
`eula.txt` by hand). It uses the `fetch` of Node, no package; Node's fetch uses `HTTPS_PROXY` only with
`NODE_USE_ENV_PROXY=1` (Node 22.21 and later). Exit codes: 0 done, 1 network or file error, 2 bad arguments,
3 wrong checksum. Java 21 is not part of it: install it and set `MC_TEST_JAVA`.

A Linux machine, for example the cloud container (OpenJDK 21 at `/usr/bin/java`):

```
node scripts/get_test_server.js --accept-eula
MC_TEST_JAVA=/usr/bin/java node tests/world/run.js <name>
```

## World types

Every scenario names the world it needs (the fifth field of its entry in `SCENARIOS`, `flat` when
not given). The runner starts one server per world type that the selected scenarios need, one after
the other, the flat one first; each in its own folder of the run directory.

| Type | Layers from y -64 up | Ground (top block) | Used by |
|---|---|---|---|
| `flat` | bedrock, 2 dirt, grass (the default flat world) | y -61 | the scenarios of v0.1.4.6 and the work above ground of v0.1.4.7 |
| `deep` | bedrock, 120 stone, 3 dirt, grass | y 60 | the mining scenarios of v0.1.4.7 |
| `base` | as `deep` | y 60 | v0.1.4.8: every scenario builds a base like the owner's in its region (`base_world.js`, below) |

The deep world comes from the server property `generator-settings` with the JSON of the flat
generator: `{"layers":[{"block":"minecraft:bedrock","height":1},{"block":"minecraft:stone","height":120},{"block":"minecraft:dirt","height":3},{"block":"minecraft:grass_block","height":1}],"biome":"minecraft:plains","lakes":false,"features":false}`
(`mc_server.js`, `worldProperties`). The 1.21.8 server falls back to the default flat world without
an error when it cannot read that text, so after the start the runner tests the lowest and the
highest block of every layer and y 0 at 0,0 (`layers at 0,0: ok y -64 bedrock, ok y -63 stone, ok y
56 stone, ok y 0 stone, ...`) and stops the scenarios of that world if one is wrong. The deep world
has no ore, no caves and no lakes: a scenario puts them into the stone with console commands.
Why two servers and not one deep world for all: the scenarios of v0.1.4.6 were written for the
ground at y -61 with bedrock 4 blocks under the bot (the sleep scenario checks that bedrock is no
bed; the creeper scenario digs the bot in), and they must keep proving the same. The second server
costs about 12 s. A scenario reads the type as `env.world` (`control.js`).

## How a run works

1. `run.js` creates a temp directory `%TEMP%\mc-world-run-*`, writes `server.properties`
   (127.0.0.1, port 25599 or the next free one but never 55916, offline mode, a flat world of the
   type the scenarios need, no structures, peaceful) and copies `eula.txt` there. It starts
   `java -Xms512M -Xmx1G -jar <MC_TEST_SERVER_DIR>\server-1.21.8.jar nogui` with the temp directory as
   working directory, so the world, the libraries the jar unpacks and the logs all land there. The
   server folder itself is only read. The server is ready when it prints `Done (...)! For help`
   (about 12 s, most of it unpacking the libraries).
2. The runner sets the world defaults: no daylight cycle, time 6000, no weather, no natural mob
   spawning, random tick speed 0 (crops do not grow, farmland does not dry, leaves do not decay),
   peaceful. It finds the ground: the flat world has grass at y -61, so a bot stands at y -60, the
   deep world at y 60 and 61 (read from the server, not assumed; given to the scenarios as
   `MCW_GROUND_Y`).
3. Every scenario runs in its own node process, with its own temp directory
   `%TEMP%\mc-world-scn-*` as working directory (the bot's `bots/` folder lands there), and in its
   own region of the world: x = 400 + 200 * n, z = 0, 200 blocks from the others. A scenario that
   runs again (monsters) gets a fresh region.
4. After each scenario the runner kills every non-player entity in the region, releases its chunks
   and sets the world defaults again. After the last one it stops the server with `stop` and kills
   the java process by its process id if it has not ended within 20 s.

### Console commands from a scenario

The runner owns the server process and its standard input. A scenario sends console commands
through a small HTTP service of the runner on 127.0.0.1 (random port, random token, both in the
environment of the scenario process: `MCW_CONTROL`, `MCW_TOKEN`). `control.js` is the client:

```js
import { command, commands, waitServerLine, serverMark } from './control.js';
await command('time set 12000');                 // -> ['Set the time to 12000']
const out = await commands(['execute if block 1 -60 2 minecraft:oak_door[open=true]', 'list']);
```

The runner writes every command followed by a marker (an unknown command whose echo is unique)
and returns the server lines between two markers as the answer of the command. Commands of one
call are executed by the server in one tick, in order. The console has all rights (`/fill`,
`/setblock`, `/summon`, `/tp`, `/give`, `/kill`, `/gamerule`, `/effect`); the bot is not an
operator.

## Writing a scenario

A scenario is a file `wNN_name.js` with an entry in the `SCENARIOS` list of `run.js` (name, file,
time limit in seconds, whether it depends on monsters). It uses the checks and the fake model of
the end-to-end tests (`tests/e2e/helpers.js`, imported, not copied) through `helpers.js`:

```js
import { scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, placeBot, resetBot, command_ } from './helpers.js';
import { region, prepareRegion, releaseRegion, housePlan, buildHouse, isOpen } from './world.js';

await scenarioMain({
    async main() {
        const r = region(40);                      // origin of this scenario's region, ground y, radius
        await prepareRegion(r);                    // load chunks, flat grass, clear air, no entities
        const h = housePlan(r.ox, r.oz, r.g);      // coordinates of a house (box, door, inside, ...)
        await buildHouse(h);
        let agent = null;
        try {
            const s = await startAgent('w_example', { ...NEW_FLAGS_OFF, home_pack: true, world_memory: true });
            agent = s.agent;
            await resetBot('w_example');           // survival, empty inventory, full health and food
            await placeBot(agent, h.outsideDoor, 180);
            const reply = await command_(agent, '!goToShelter', 60000);
            check(await isOpen(h.door) === false, 'the door is closed');
        } finally {
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
```

- `startAgent(name, settings, options)` runs the real `Agent.start` (lockdown, prompter, modes,
  spawn handler) against the test server, with the fork's `settings.js` plus the overrides. The
  modes of the profile are all off unless `profile.modes` says otherwise; the new modes of this
  release keep their defaults. Every request to the fake model is printed as a `MODEL` line.
  `s.route(/w_player: text/, '!command(...)')` answers the request whose last turn matches;
  everything else gets `''`. `options.usage` makes the fakes report usage like the Claude adapter.
- Feature flags are switched per scenario through these settings. `NEW_FLAGS_OFF` has every
  setting of release v0.1.4.6 off.
- `connectPlayer(name)` connects a plain mineflayer bot that plays the player: it chats
  (`player.chat('follow me')`), stands where it is teleported and records what it hears
  (`heardFrom(player, botName)`).
- Waiting: never sleep for something that can be observed. `waitFor(fn, { ms })` polls the block
  state, the position or the chat until it holds or the time is up.
- Read results from the server, not from the bot's view: `entityPos(name)`, `blockIs(p, name)`,
  `isOpen(door)`, `entityNumber(name, 'foodLevel')`.
- `snapshotBox(box)` clones a box (the house) on the server to a place 100 blocks and more south of it,
  at the same height, force-loaded while it lives (v0.1.4.8; before, copies lay at y 280 over the same
  columns, and the new depth check of the bot, which reads each column from the top of the world down, took
  copies of natural blocks for the ground: "I am underground" on the surface in w28); `compareSnapshot(snap)`
  compares on the server with `execute if blocks`, lists the changed blocks with their names (read from the
  server) and treats a door that is only open or closed as a state difference; `dropSnapshot` removes the
  copy and releases its chunks.
- A scenario that needs a restart runs phases: `runPhase(SELF, 'second')` starts the same file
  again with `--phase=second` (see `w12_rules.js`).
- A scenario cleans up what it made: its agent, its player, its mobs (`kill`), difficulty and time.

### Helpers of v0.1.4.7

Building (`world.js`, console commands): `buildChest(p, items)` (items in its first slots),
`buildFullChest(p, name, { free })`, `buildComposter(p, level)`, `fieldPlan(x, z, g, cell)` and
`buildField(f, { fence })` (a fenced field of 9 x 9 with a gate and water, every cell farmland, grass
or dirt with a crop of a chosen age), `buildTree(t, { natural })` (leaves that a tree grows),
`logHousePlan` and `buildLogHouse` (walls of logs, leaves on the roof), and underground `digShaft`
(with ladders on one wall), `carve` (a room, a cave), `caveBox`, `placeVein` and `veinBeside`,
`lavaPocket`. Directions as in the mine store: `DIRS`, `rightOf`, `leftOf`, `add`.

Reading (from the server): `chestItems(p)` and `chestFreeSlots(p)`, `inventoryOf(name)` (with armour
and the off hand, which 1.21.5 moved out of `Inventory`), `stableInventory(name)` (the inventory once
it did not change for 500 ms: right after crafting the counts can be wrong), `cropAge` and `cropAges`,
`composterLevel`, `blockNames(list, names)` and `findBlocks(box, names)` (many blocks in one batch),
`itemsOnGround(box)` (drops that nobody picked up), `snapshotBox(box, { y })` for a second snapshot
over the same columns.

Driving (`helpers.js`): `giveItems(name, items, bot)` waits until the bot sees the items (a command
that starts at once would not); `runSkill(agent, label, fn)` runs a function of a pack with
`agent.packContext()` as an action, for the functions of the spec that have no command
(`descendToLevel`, `setupMineBase`, `digTunnel`, `climbToSurface`); `historyTurn(agent, part)` finds
the result of a command that the fake model gave; `watchHealth(bot)` sees every change of health (in
peaceful the health comes back within seconds, a sample can miss a hit); `largestDrop(rows)` finds a
fall in a trace. `NEW_FLAGS_OFF` has the four switches of v0.1.4.7 off, `WORK_COMMANDS` their
commands, `MINING_SETTINGS` and `MINING_KIT` what the mining scenarios start from.

### Helpers of v0.1.4.8

The play test of v0.1.4.7 failed where the scenarios had not looked: they ran with the modes of the bot off,
gave their orders straight to the command parser, and built test worlds that did not look like the owner's
base. Since v0.1.4.8 (spec section 12, T2):

- **`MODES_PROFILE`** (`helpers.js`): the modes of `profiles/defaults/assistant.json`, the owner's base profile
  (self_preservation, unstuck, self_defense, item_collecting, torch_placing, elbow_room, idle_staring on;
  cowardice, hunting, cheat off), plus the home reflexes door_closing, night_shelter, creeper_safety, hunger.
  `withModes(settings, modes)` returns the settings with `home_pack` on, every home reflex on and these modes as
  the modes of the profile. Every scenario that tests a skill uses it. `MODES_OFF` stays only for scenarios
  that test a switch that is off (w29, w57, the phases "off" and "saved" of w20, the scenarios of v0.1.4.6).
  `startAgent` checks that the modes of the agent are as the profile of the scenario sets them.
- **`OWNER_SWITCHES`**: the switches of v0.1.4.6 and v0.1.4.7 as the owner plays (every pack on, protected areas,
  rules, world memory). `FLAGS_0148_OFF` has the new settings of v0.1.4.8 at their defaults (the behaviour of
  v0.1.4.7), `FLAGS_0148_ON` has them all on (the long run).
- **Orders in the chat**: `orderChannel(s, { name, at, gamemode })` connects the player (creative by default,
  so monsters leave it alone) at `at`. `ch.order(text, ms)` types a command in the chat and resolves with the
  text the agent answered in the chat (`''` for none, `'(timeout)'`, `'(not received)'`); the agent runs it
  through its real path (respondFunc, handleMessage, the branch of a command typed by a player: `last_order`
  is set, the model is not asked, the result goes to the chat, not into the history). `ch.orderInfo` gives the
  details, among them the history lines "Command !x was stopped by ..." (I5) added while it ran. `ch.say(text)`
  writes a message for the model.
- **What the agent did** (`recordAgent`, installed by `startAgent`): `s.messages` (every handleMessage),
  `s.routes`, `s.chats` (everything the bot said, also the texts of the modes), `s.behavior` (every line of the
  behaviour log: "I'm stuck!", "I am stuck at ..."), `s.added` (every line added to the history), `s.logs`
  (every console line, for example "Door service: closed ..."), `s.killed` (the text of cleanKill).
  `saidSince(s, part, t)` searches the behaviour log and the chat. Nothing is changed: every wrapper calls the
  original. A cleanKill prints `CHECK FAIL the agent process was ended by cleanKill: <text>` before the
  process ends, unless the scenario expects it (`s.killExpected = true`).
- `runSkill` pauses the mode unstuck at the start, as the glue does for every pack command (spec I1), so a
  pack function without a command (descendToLevel, setupMineBase, digTunnel) runs as inside its command.

### The world `base` (`base_world.js`)

`basePlan(region(BASE_RADIUS))` gives the coordinates, `buildBase(plan)` builds it (about 0.6 s),
`verifyBase(plan)` reads every part back from the server, `saveHomePlace(agent, plan)` saves the place "home"
in the memory of the bot (a place, never an area: the owner's house was a place only, finding M5). The
offsets are named constants of the module, from the origin of the region (x east, z south); `g` = 60 is the
grass:

| Part | Where (offsets from the origin) |
|---|---|
| house | planks, x -4..4, z -5..5, floor g, walls g+1..g+4, roof g+5 (9 x 6 x 11 blocks), oak_log posts, glass at (-4, g+2, 0), (4, g+2, 0), (0, g+2, 5); oak door (0, g+1, -5) in the north wall; red bed foot (-3, g+1, 3), head (-3, g+1, 4); chest (3, g+1, 4) with 12 bread and 64 leaf_litter; torches (-3, g+1, -4), (3, g+1, -4); the place "home" at (0, g+1, 1) |
| shaft | oak trapdoor (2, g, -2) in the floor, closed, facing south (climbable when open, over the ladders); ladders facing south at (2, 41..59, -2) on the north wall |
| room | air x 0..4, y 41..43, z -2..2 (stone floor at y 40), under the house; chest (0, 41, 2) with 64 cobblestone and 16 torches; crafting table (4, 41, 2); furnace (0, 41, -2) facing east (v0.1.4.9: the room of the owner's mine has one); torch (4, 41, -2) |
| descent | 16 steps of loose blocks along z 0: step k at x 4+k, feet y 41-k, 3 high, cobblestone under each step; from x 5 (feet 40) to x 20 (feet 25) |
| landing | air x 21..23, y 25..27, z -1..1; torch (23, 25, -1) |
| tunnel | 1 wide, 2 high, 12 long: x 22, y 25..26, z 2..13; stone around it, grass 34 blocks above |
| farm | fenced field of 9 x 9, x -26..-18, z -4..4 (`fieldPlan`): oak fence at g+1, gate (-22, g+1, -4) facing south, water (-22, g, 0), farmland with wheat (the row z -2 ripe, age 7; the rest age 3; a scenario chooses the crops), composter (-20, g+1, -3) inside, chest (-26, g+1, 0) in the west fence line (a post replaced) with 4 wheat and a fence post on it (the owner's build as finding C4 describes it) |
| pen | oak fence of 9 x 9, x 8..16, z 4..12, gate (12, g+1, 4) facing south, grass inside, a cow at (14, g+1, 8) and a chicken at (12, g+1, 10) (tags `mcw_pen_cow`, `mcw_pen_chicken`, persistent) |
| mine box | x 0..23, y 24..59, z -2..13: room, descent, landing, tunnel (for an area of type mine; W46 to W48 save it up to 6 blocks under the surface, as the owner's box) |

`penFence(plan)`, `farmFence(plan)` and `penAnimalsWhere(plan)` read the fences and the animals back.
`w58_base_world.js` proves the build (every part read back) and that the agent can stand in every part.

The owner variant (`basePlan(r, { owner: true })`, or `buildBase(plan, { owner: true })`), for the journey scenarios: the
way into the mine as in the owner's world (his `mines.json` of 2026-09-30). Everything else is as above.

| Part | Where (offsets from the origin) |
|---|---|
| shaft 1 | closed oak trapdoor (-2, g, -3) in the floor of the house, facing south; ladders facing south at (-2, 53..59, -3), down to the basement |
| basement | air x -3..3, y 53..55, z -2..3 (stone floor at y 52), torches (-3, 53, 3) and (3, 53, 3); `plan.owner.homeBox` spans both floors, y 52 to g+5 (the owner's area "home" spans y 55 to 71) |
| shaft 2 | a hole in the basement floor at (3, 52, -2), ladders facing south at (3, 43..52, -2): the last ladder is 2 blocks above the floor of the room, (3, 41, -2) and (3, 42, -2) are air. A bot drops down; up, a jump does not reach the ladder (W59 proves it) |
| double door | the room is closed at x 4 by stone, with two oak doors (4, 41, -1) and (4, 41, 0), facing west, hinges at the outer edges, closed; the crafting table (4, 41, 2) stays in that wall, the torch of the room is at (1, 41, -2); the first step of the descent is 2 wide (z -1 and 0) |
| not built | the default shaft at (2, -2); the mine box ends at y 51, under the basement |

`w59_owner_base.js` proves the owner variant (every part read back, the bot stands in the house, the basement and under
the last ladder, and cannot jump to it).

### Helpers of v0.1.4.9

The routes and the mine of the player are learned from the trail of the bot, so the scenarios W61 to W73 walk the
bot along the way (spec 11 TW 2) instead of teleporting it: a teleport of more than 16 blocks sideways or up starts
the trail again (HANDOFF part A).

- `settings0149(extra, modes)`: the owner's switches (`OWNER_SWITCHES`), every setting of v0.1.4.8 on (`FLAGS_0148_ON`,
  knowledge in the prompt among them), the switches of v0.1.4.9 on (`FLAGS_0149_ON`: `routes_pack`, `mine_routes`;
  `ore_sense_range` 0 and `skills_over_code` off unless `extra` sets them), a trip of at most 12 minutes, and the modes
  of the owner (`withModes`). `FLAGS_0149_OFF` has the new settings at their defaults (W74), `COMMANDS_0149` the six
  new commands by switch.
- `walkTyped(orders, agent, cell)`: a typed `!goToCoordinates` to a cell (closeness 0), with a note whether the bot
  arrived. `stepCells(agent, cells, { ms: 200 })` and `columnCells(x, z, from, to)`: the bot moved cell by cell with
  `/tp` where the path search cannot walk (the ladder). `setTrapdoor(plan, open)`: the player opens or closes the
  trapdoor of the base.
- `walkUpToBed(agent, orders, plan)` (W62 to W64): from the middle of the room at y 41 to the floor beside the ladder
  (typed), up the ladder cell by cell, through the open trapdoor into the house, to the bed (typed); the trapdoor is
  closed behind the bot. `walkIntoMine(agent, orders, plan, { end })` (W65 to W73): from outside in front of the door
  into the house next to the trapdoor (typed: the path search opens the door), down the ladder cell by cell, and down
  the descent to `end` (typed; the end of the tunnel by default).
- `worldDirOf(agent)`, `readWorldFile(agent, name)`, `minesInFile(agent)`, `routesInFile(agent)`: the files of the
  folder of the current world (`bots/<name>/worlds/<key>/trail.json`, `routes.json`, `mines.json`).
- `serverSleeping(name)`: the server says the player sleeps (as W39). `recordMoves(agent)`: every `activateBlock` and
  every goal of the path search as `MOVE` lines, for the report of a failing walk (nothing is changed).

## Reading a failing scenario

The runner prints every `CHECK` and `NOTE` line. For a failed run it also prints the last 40
output lines of the scenario and the server lines of that run (command answers left out). The
labels of the checks say what was expected. Scenarios that move the bot print `TRACE` lines:
time, position of the bot (from the server), state of the door, action of the agent, and in the
creeper scenario the distance of the creeper to the house, the door and the bot, its fuse and the
health of the bot. Set `MCW_LOG_DIR` to keep the full output of each run and the server log.

## Scenarios

| File | What it proves |
|---|---|
| `w01_baseline.js` | the harness: walk 20 blocks, break a block, place a block, open a door (all flags off) |
| `w02_flags_off.js` | all new flags off: no new command for the model, no new mode, no new file; the problems of today: the door stays open, `!collectBlocks("oak_log", 4)` takes logs of the house |
| `w03_doors.js` | the door and the fence gate are closed after the bot walked through; a player in the doorway keeps it open |
| `w04_shelter.js` | `!goToShelter` from 40 blocks away: inside the house, door closed, house untouched |
| `w05_night.js` | night comes while the bot works on a day order: it goes to the shelter by itself; an order given at night is obeyed (the rows up to the first that is not the order, no "Command !collectBlocks was stopped by the reflex night_shelter"); following continues at night |
| `w06_protected_house.js` | `!collectBlocks("oak_log", 4)` takes the tree, not the house; `bot.dig` on the wall is refused; a path goes around the house |
| `w07_scan.js` | `!rememberArea` finds the house and its door, the fenced farm and its gate, nothing on an open field |
| `w08_farm.js` | in a farm area: ripe wheat can be broken, the fence cannot, seeds can be planted, dirt cannot be placed |
| `w09_creeper.js` | a creeper 10 blocks from the house is led away; house untouched, the bot lives, the door stays shut (monsters: up to 3 runs, 2 must pass) |
| `w10_sleep.js` | at night the bot sleeps in the bed of the house; the text at day; bedrock is no bed |
| `w11_eat.js` | the bot eats bread at a low food level; the text without food; the auto-eat options; the number in the text of `!eat` is the bread that left the inventory (X10); `!consume` at full food: "I am not hungry. Food 20 of 20." (X12) |
| `w12_rules.js` | a rule survives a restart and is in the conversing prompt |
| `w13_cost.js` | the cost meter with a fake model that reports usage: totals, report line, state `saving` and what it switches off, `usage.json` |
| `w14_creeper_standing.js` | Amendment 2 F3: a creeper that stands (NoAI) near the house is left alone well within 90 s, never approached closer than 8 blocks; at night the bot does not open the door near it and digs in 24 blocks away |
| `w15_storage.js` | v0.1.4.7 S: `!storeItems` with a full inventory stores what the keep plan stores and keeps tools, food, torches; `chests.json`; after a restart `!chests` and `!fetchItem("bread", 5)` from a chest 40 blocks away that only the index knows; a full chest is skipped, a chest that fills up is left for the next |
| `w16_harvest.js` | F: `!harvest` in a fenced farm: ripe wheat taken and planted again, unripe stands, no farmland turned to dirt, fence whole, gate closed |
| `w17_plant.js` | F: `!plant` with a hoe plants farmland, grass and dirt (48 cells); without a hoe only the farmland; nothing dug around the field |
| `w18_bone_meal.js` | F: `!makeBoneMeal` with only seeds makes nothing and keeps the seeds; with leaves it makes bone meal and keeps every seed |
| `w19_farm_cycle.js` | F: the player writes "get back to farming", the fake model answers `!farmCycle`: harvest, the wheat in the chest next to the field, planting, the gate closed, the text in order |
| `w20_farm_old_command.js` | F: `!collectBlocks("wheat", 5)` with `farming_pack` on harvests 5 ripe plants and plants again; off, the old command breaks wheat and plants nothing, also inside a saved farm (Amendment 2, I5); `!setArea` of a fenced field counts its gate (I6) |
| `w21_trees.js` | T: `!chopTrees(4)` next to a house with log posts cuts the whole tree, not the house, and plants a sapling; a house of logs with leaves on its roof is no tree |
| `w22_tall_tree.js` | T: a trunk of 9 logs is cut whole from a pillar that is taken away; the bot ends on the ground with the 9 logs |
| `w23_tools.js` | T: `!getTool("pickaxe", "stone")` with an empty inventory: tree, wooden pickaxe, stone, stone pickaxe |
| `w24_mine_basics.js` | M0 (deep world): the bot digs a shaft of 20 blocks; `!leaveMine`, `!goToMine`, `!leaveMine` up and down its ladders, timed, never hurt, never falling |
| `w25_shaft.js` | M (deep): a shaft of 30 blocks with lava beside it and a cave under it put in while the bot digs: ladders, lava closed, no fall, the way up; with 10 ladders the rest is a staircase |
| `w26_tunnel.js` | M (deep): 24 steps from the base with a vein of 5, lava beside and a cave ahead on the line: straight, 1 wide, 2 high, torches at 8 and 16, the whole vein taken, lava closed, cave closed off, the tunnel turned |
| `w27_mining_trip.js` | M (deep): `!mineOre("iron", 6)` twice with iron ore beside the way: back on the surface with 6 raw_iron, cobblestone in the chest of the mine, the mine in the store; the second trip uses the same shaft and goes on at the end of the tunnel |
| `w28_mine_house.js` | M (deep): a protected house 5 blocks from the bot: the entrance of the mine is at least 8 blocks from it, nothing under or beside the house changed |
| `w29_flags_off_0147.js` | the four switches of v0.1.4.7 off: none of their 14 commands exists for the model, no pack object, no `chests.json` or `mines.json`, `!collectBlocks` for logs and ore as in v0.1.4.6 |

Release v0.1.4.8 "Stability" (spec section 12, T2): one defect of the play test of v0.1.4.7 per scenario
(the ids of `FINDINGS_PLAYTEST_0147.md` in brackets), the modes of the owner on, the orders typed by the
player in the chat. The comment at the top of each file says how it would have failed against v0.1.4.7.

| Id | File | World | What it proves |
|---|---|---|---|
| W30 | `w15` to `w28` (group `all_modes_on`) | flat, deep | the work scenarios of v0.1.4.7 with `MODES_PROFILE` and their orders in the chat; `!mineOre(..., true)` for a new mine (E4), the entrance 16 blocks from a house (E4), `I tilled N blocks and planted ...` (E2), `N plants are not ripe.` (E2) |
| W31 | `w31_stuck_gives_up.js` | flat | [S1, S2] in a room of obsidian with `stuck_restart_after` 3: the reflex gives up twice ("I am stuck at (x, y, z) and could not walk away."), the model is told the position, the process lives; the third failure in a row ends it |
| W32 | `w32_skill_stands_still.js` | flat | [S15] `!goToBed` at dusk waits 40 s at the bed without "I'm stuck!"; `!makeBoneMeal`, `!storeItems` into 24 chests with a free slot each, `!getTool` from a known chest: no "I'm stuck!", their result in the world (they are too quick to stand 25 s, which is noted) |
| W33 | `w33_stopped_command.js` | base | [S3, T1] `!chopTrees(20, "oak")` stopped by `!stop`: the history holds "Command !chopTrees was stopped by !stop. Done so far: I cut N oak_log and picked up M." ; since X4 the same text is the answer in the chat of the player |
| W34 | `w34_stop_is_hard.js` | flat | [S9] `!goToCoordinates` 70 blocks, `!stop` after 6, 14, 22 blocks: the bot stands within 1 s, no kill |
| W35 | `w35_resume_ends.js` | base | [S5] `!followPlayer`, then `!storeItems`: afterwards the bot does not follow again |
| W36 | `w36_composter_never.js` | base | [X1, X2] four `!farmCycle` with unripe wheat and a full composter, two of them stopped at dusk: the bot is never in or on the composter (samples every 250 ms), no farmland becomes dirt, a walk afterwards reaches its goal |
| W37 | `w37_hole_escape.js` | flat | [X1] the bot inside a composter and inside a cauldron, a typed `!goToCoordinates`: it gets out and reaches the goal, no give-up |
| W38 | `w38_order_after_stuck.js` | flat | [X3] right after a give-up a new order has its 20 s before "I'm stuck!"; three walks after it are not stopped by `unstuck` |
| W39 | `w39_wake_for_order.js` | base | [X5] asleep after `!goToBed` (and by `night_shelter`), a typed `!goToCoordinates` / `!searchForEntity`: the bot is out of the bed within 10 s (server) and the command reaches its goal |
| W40 | `w40_chat_burst.js` | flat | [X9] 12 lines at once all arrive, in order, the last 6 s after the first; fast typed queries: no kick; a kick prints "The server said: Kicked for spamming" |
| W41 | `w41_offhand_food.js` | flat | [E1] bread in slot 45: `!inventory` says "In the off-hand: bread 6", `!eat` eats it |
| W42 | `w42_hunger_reflex.js` | base | [E3] food 6, no food carried, bread in the known chest of the house: the bot fetches and eats without an order and without the model |
| W43 | `w43_fence_is_safe.js` | base | [P1] the model's `!collectBlocks("oak_fence", 20)` in the pen with `protect_built_blocks`: every fence stands, the animals are inside, the text of B1 |
| W44 | `w44_pick_up_dropped.js` | base | [P2] a second bot drops 8 fences and a gate 12 blocks away: `!pickUpItems` gets them; `!givePlayer` has no stray number line (X15) |
| W45 | `w45_shaft_underground.js` | base | [R1, M8] at dusk in the room at y 41 and at the landing at y 25 `night_shelter` does nothing; on the surface it runs (control) |
| W46 | `w46_creeper_above.js` | base | [R3] creepers on the surface above the mine (area of type mine): no reaction in 30 s, at y 41 and at y 25 |
| W47 | `w47_creeper_in_sight.js` | base | [R3] a creeper 8 blocks away in the same tunnel: the reflex reacts (monsters: 2 of 3 runs) |
| W48 | `w48_shelter_is_home.js` | base | [R2, M5] areas mine and pen nearer than the house: at dusk the bot goes into the house (the place "home") |
| W49 | `w49_doors_after_reflex.js` | base | [R5, R9] the night reflex walks the bot from the farm into the house: gate and door are closed afterwards, "Door service: closed ..." |
| W50 | `w50_auto_home.js` | base | [M5] a restart with the place "home" and no area: the area "home" (type home, source auto) exists, the bot says so |
| W51 | `w51_chest_at_fence.js` | base | [C4] `!storeItems` at the farm: the chest in the fence line opens and is in the index |
| W52 | `w52_farm_cycle_whole.js` | base | [F1, F2, F3] unripe wheat, leaf litter in the known chest: one `!farmCycle` makes bone meal, uses it and ends with harvested wheat; X13 (a gate is no door), X14 (wheat left in the field only with "I could not pick up the crop of N plants.") |
| W53 | `w53_trees_with_axe.js` | base | [T4, T1] `!chopTrees(6)` with a pickaxe in the hand: an axe is made and held for every log, 6 logs or more |
| W54 | `w54_mine_asks.js` | base | [M1, M3, M5] `!mineOre("iron", 8)` with no mine: the text asks, nothing dug or crafted, the proposed entrance 16 blocks from home |
| W55 | `w55_reflex_switch.js` | flat | [R4] `!setMode` of the five safety reflexes from the model is refused; typed by the player it works |
| W56 | `w56_farm_scan.js` | base | [P5] `!rememberArea("farm", "farm")` from outside the gate saves the farm with its gate |
| W57 | `w57_flags_off_0148.js` | flat | every new setting of v0.1.4.8 at its default: the behaviour of v0.1.4.7 (the escape that returns says "I'm free.", no give-up; free fences can be collected, no knowledge block, no repeat guard, no text to the chat, no time stamps, no `last_exit.json`, the prompt examples chosen by the whole conversation) |
| W58 | `w58_base_world.js` | base | the harness of the base world: every part read back from the server, the agent stands in every part, a typed order answers in the chat |
| W60 | `w60_long_run.js` | base | [all 20 ends of the process] 60 orders in a fixed order over 30 minutes (at least 15 s apart), every part and setting on, the daylight cycle on: the process never ends, every order has a result text (the endless `!followPlayer` is answered by the `!stop` after it), the bot is alive at the end |

The chat kick of the play test (S12) cannot happen on the test server, which does not sign chat: no world
scenario for it (spec 12, T2.4).

Release v0.1.4.9 "The mine, the routes of the player" (spec section 11, TW): the group `mine_routes_0149`
(`node tests/world/run.js mine_routes_0149`), all in the base world, with the modes of the owner, the owner's switches,
the settings of v0.1.4.8 on and the switches of v0.1.4.9 on (`settings0149`), the orders typed by the player. The
comment at the top of each file says how it would have failed against v0.1.4.8.

| Id | File | What it proves |
|---|---|---|
| W61 | `w61_trail_records.js` | after a typed walk of 36 blocks through the door into the house, `trail.json` holds the steps in order, one with `via` the door, `sky` false inside the house and true outside (with notes of the light the bot reads and the light of the server) |
| W62 | `w62_route_to_bed.js` | the place `storage` in the room at y 41; walked to the ladder, moved up it cell by cell, through the trapdoor to the bed: `!rememberRoute("bed")` answers the text of A2 with 1 ladder and 1 trapdoor, `routes.json` has the ladder and the trapdoor legs; from the room at night `!goToBed` climbs the ladder and sleeps in the bed ("I slept. It is morning."), nothing dug |
| W63 | `w63_route_reverse.js` | the route of W62; from the bed `!goToRememberedPlace("storage")` goes down the ladder into the room at y 41, nothing dug, never hurt |
| W64 | `w64_route_broken.js` | the route of W62, 7 ladders taken away: `!goToRememberedPlace("storage")` answers the text of I3 with the step of the ladder and the position of the bot, nothing dug, the bot lives in the house |
| W65 | `w65_remember_mine.js` | walked from outside through the door, down the ladder, to the end of the tunnel: `!rememberMine("mine")` answers the text of B2 (1 ladder, 1 door, 1 trapdoor; chest, crafting table, furnace; one tunnel of 12 at level 25 going south); `mines.json` has the mine of the player with its entrance outside, the route, the room and the tunnel; the place "mine"; whereAmI names the mine |
| W66 | `w66_remember_tunnel.js` | the mine of W65; in the tunnel, the player looking south, `!rememberTunnel` answers the text of B3 (start, south, end, 12 blocks, level 25); the tunnel dug 4 further, it measures 16 and replaces the tunnel |
| W67 | `w67_mine_known.js` | the mine of W65, 4 iron ore beyond the end of the tunnel: `!mineOre("iron", 4)` from the door walks the route in and out by the ladder, brings 4 raw_iron, the ore is gone, the tunnel is longer than 12, no new mine and no new shaft |
| W68 | `w68_passed_ore.js` | the mine of W65, 2 gold ore beside the end of the tunnel, stone pickaxes: `!mineOre("iron", 2)` says "I left 2 gold_ore behind: I need an iron pickaxe.", `passed` lists them (reason pickaxe); with an iron pickaxe `!collectPassedOre("gold")` gets both, `passed` is empty |
| W69 | `w69_ore_sense.js` | the mine of W65, an iron ore 2 blocks inside the wall beside the new steps: with `ore_sense_range` 0 it stays (the ore ahead is taken), with 3 it is taken with a side cut |
| W70 | `w70_ore_in_sight.js` | one iron ore in the wall of the tunnel, one 5 blocks inside the rock: `!collectBlocks("iron_ore", 2)` with `ore_sense_range` 0 takes the one in the wall, says the text of C1, digs nothing towards the other |
| W71 | `w71_dusk_on_route.js` | the mine of W65; the bot held on the ladder of its route at dusk: whereAmI says underground in the mine on its way in, `night_shelter` does nothing for 60 s; control on the surface |
| W72 | `w72_dig_code_refused.js` | `skills_over_code`: the model's `!newAction("dig a tunnel to the east")` gets the text of I8 and the fake code model is never called; typed by the player it runs |
| W73 | `w73_branches.js` | the tunnel of the base dug to 32, learned with `!rememberMine`: `!mineOre("iron", 2)` digs the first branch to the left (east) at 4 blocks from the start, 1 wide and 2 high, nothing to the right, the branch in `mines.json` |
| W74 | `w74_flags_off_0149.js` | every setting of v0.1.4.9 at its default: no `trail.json` or `routes.json`, the six commands hidden and "not a command", `!mineOre` asks as in v0.1.4.8, `!collectBlocks` for ore by `ore_sense_range` 0 (decision of the owner), the model's `!newAction` runs |
| W75 | `w75_follow_ladder.js` | section 13 (F14 of the play test): typed `!followPlayer`, the player goes down the ladder through the closed trapdoor to the room at y 41: within 60 s the bot is within 4 blocks of it there, it opened the trapdoor with a click without sneak, `trail.json` holds the ladder run; the player climbs back and the bot follows into the house; a typed `!goToPlayer` from the house reaches the player in the room; the process lives |
| W60 | `w60_long_run.js` | v0.1.4.9: as before with the switches of v0.1.4.9 on (`ore_sense_range` 3, `skills_over_code` on) and 8 orders of the new commands (`!rememberRoute`, `!routes`, `!rememberMine`, `!rememberTunnel`, `!mineOre` in the known mine, `!collectPassedOre`, `!forgetRoute`) in the places of 8 repeated queries: still 60 orders; the process never ends, every order has a result text |

## Journey scenarios

The group `journeys` (`node tests/world/run.js journeys`, about 15 minutes) plays the owner's first minutes with a bot
that knows nothing, from the player's side, in the owner variant of the base. The player is a second bot that types
the commands the owner's model chose in his play logs of 2026-10-01, at the moments he said them, and walks the way.
A journey passes only on facts of the world: where the bot stands (server), the blocks, the state of a trapdoor, the
inventory; a text is checked only where the owner reads it.

**The rule: the bot is never moved by the control.** The control builds the world, puts the bot and the player at their
places at the start, gives the bot its kit at the start (what the owner's chest would give), moves the player, and reads
the world. No `/tp` of the bot, no `stepCells` of the bot, no trapdoor opened for it. What the bot cannot do by itself
is a failure of the bot, never a reason to help it. A failing journey is a finding, left failing.

Every journey runs with the owner's switches of PLAYTEST.md section 2 (`journey.js`, `JOURNEY_SETTINGS`: every pack,
protected areas, rules, `routes_pack`, `mine_routes`, `skills_over_code`, `knowledge_in_prompt`, `stuck_restart_after`
3), the modes of his profile (`MODES_PROFILE`), and an empty memory: the fresh working directory of the scenario has an
empty `bots/`, and a journey saves no place, area or route itself (the first check says so). `journey.js` holds the
player's legs through the owner variant (`playerDownToBasement`, `playerDownToRoom`, `playerToTunnelEnd`, ...), the
waits for the bot (`waitBot`), and the parts A (W80) and B (W81) that W84 chains.

| Id | File | The owner's words, typed | What must happen in the world |
|---|---|---|---|
| W59 | `w59_owner_base.js` | - | the owner variant is built as planned; the bot cannot reach the last ladder of shaft 2 by a jump |
| W80 | `w80_first_minutes.js` | "this is home" `!rememberArea("home", "home")`; "follow me" `!followPlayer("w_player", 3)`; "remember the path here" `!rememberRoute("basement")`; "come here" `!goToPlayer`; "go to the basement" `!goToRememberedPlace("basement")` | the bot is in the basement within 60 s of "follow me"; the trapdoor is closed within 10 s after the bot passed it; the route names 1 ladder and 1 trapdoor; the bot comes up into the house within 60 s; it goes to the basement within 60 s; every climb of the bot is smooth (sampled every 100 ms: never more than 0.1 block against the direction, at most one stall over 1 s, under 0.8 s per block); nothing in the house, the shafts and the basement dug or placed |
| W81 | `w81_first_mine.js` | "follow me" `!followPlayer("w_player", 4)` from outside; "this is the mine" `!rememberMine("mine")`; "find some iron" `!mineOre("iron", 12)` | the bot follows down both ladders (the second ends 2 blocks above the floor), through the double door, into the tunnel (60 s per leg); the mine names 2 ladders and the room; 12 iron ore ahead of the end, `!mineOre("iron", 12)`: within 5 minutes 12 raw_iron in the bot's inventory, the bot on the surface, the trapdoor closed, torches still carried (none put into the room chest), the tunnel 8 or more blocks longer with a torch in the new part |
| W82 | `w82_come_here_across_floors.js` | "come here" `!goToPlayer("w_player", 3)` | from the house to the player in the basement within 60 s; back up within 60 s; from the house to the player in the mine room (two ladders) within 120 s; every climb smooth as in W80 |
| W83 | `w83_chest_and_torches.js` | "check the chest" `!viewChest`; "make 32 torches" `!craftSupplies("torch", 32)` | the chest of the house holds 20 oak_log and 9 coal: the answer names them; within 60 s the bot has 32 torches and does not say it lacks logs; nothing of the house taken |
| W84 | `w84_ten_minutes.js` | W80, then W81 from the basement (led out under the open sky first), "let's sleep" `!goToBed` at night, "come here" from the mine room | every check of the parts; the bot sleeps and says "I slept. It is morning."; it reaches the player in the mine room within 120 s; the process never ends and the bot never dies |

| `job_comes_back` | w85 | `!mineOre("iron", 8)`, then "follow me" 20 blocks and silence: `I go back to the mining, N of 8 iron.`, 8 raw_iron, on the surface (`job_memory`) |
| `blocker_steps` | w86 | `!mineOre("iron", 4)` without torches and pickaxe, logs and coal in the house chest: the plan text, the steps, the iron |
| `idle_list` | w87 | `idle_jobs` with the farm cycle and 8 torches: after 60 s of silence both run, no order given |
| `ladders_native` | w88 | W80, W82 and the follow of W75 with the fallback counted: no `I go down the ladder` line, the climbs smooth |
| `pen_gate_safe` | w89 | fences dropped in the pen: the gate stays closed, `I leave the oak_fence in the pen "pen". I do not open its gate.`; the same with a rule |
| `two_floors` | w90 | `area_floors`: home is the house floor, the basement a second area, `!goToBed` sleeps below, `That is the area "home" already.` |
| `tunnel_where_you_stand` | w91 | the room tunnel of `base_world.js` (8 blocks west of the room), the mine learned in the room: "dig here" `!rememberTunnel` with the bot in the room and the owner at the rock face (`I measured the tunnel from where you stand: ...`), with the bot 3 behind him, with the bot at the rock face: the start, west, the end, 8 blocks; no `I stand in no tunnel`; `!mineOre("iron", 2)` digs the tunnel 2 longer |
| `shaft_from_room` | w92 | `mine_from_inside`, the mine learned in the room, diamond ore at y -59 and -58: `!mineOre("diamond", 1, true)` says `I dig a shaft down from here to level ...`, a column of ladders down from the room floor, the bot back through the room with a diamond; `!mines` lists `bot:<level> (from the mine "mine")`; `!goToMine("diamond")` to the bottom, `!leaveMine` from there to the surface |
| `open_sky` | w93 | `!goToSurface` in the house: `I went out through the door at ...`, outside at the ground, no block above, nothing of the house dug, the door closed after; from the mine room (the mine learned there): the ground under the open sky |
| `place_from_sentence` | w94 | `!rememberArea` without a type in the pen (6 chickens, 1 cow), the farm and the house: the answers of P1 with the kind and the counts, the boxes; fences dropped in the aviary: the gate stays closed, `I leave the oak_fence in the pen "aviary"`; `!rememberArea("aviary", "farm")`: `"aviary" is a farm now.` |
| `route_joined` | w95 | `routes_by_search`, the mine learned, `!leaveMine`; "follow me" down ladder 1 and `!goToMine` while the bot is on the ladder: the room without going back up, no `I could not follow`; `!leaveMine` to the surface; every door closed after |
| `dry_scan` | w96 | the mine learned, the bot in the house, the trapdoor of the house over ladder 1 iron (closed): `!goToMine` answers `I find no way from ... to the trapdoor at ...: it is closed and I cannot open it.` and the bot does not move; the oak trapdoor back: it reaches the room |
| `no_digging_to_player` | w97 | the owner in the sealed stone box of `base_world.js`: `!goToPlayer` answers `I find no way to you from here without digging. Come closer or tell me to dig.`, no block broken, no destructive walk; the box opened: the bot reaches him |
| `words` | w98 | `!goToMine` with no mine, and with the house trapdoor iron (closed): `I find no way from ... to the trapdoor at ...: it is closed and I cannot open it.`, the bot does not move, no `Show me the way again`; the model's `!newAction("dig a tunnel")` on the surface, in the tunnel, in the room: `From here: !mineOre("iron", 8, true).`, `!mineOre("iron", 8).`, `!mineOre("iron", 8, true).`; `!rememberRoute("a", "b")`: `!rememberRoute takes 1 argument (name): !rememberRoute("name").`; `Gave 4 wheat to w_player.` |
| `owner_region` | w99 | `MCW_OWNER_DUMP` names the owner's region dump (radius 48, center (9, 38, 33); skipped without it), built at the owner's y with x and z shifted: "come here" `!goToPlayer("w_player", 2)` up and down his cobblestone staircase (F24): the bot within 2 blocks within 90 s, no block of the staircase broken, none placed on it, no destructive walk; the basement saved with `!setArea("basement", "building", ...)` and night (F25): no `I cannot get into the shelter`, no `It is getting dark. I go to the shelter.`, the bot stays in the basement 30 s, `!goToShelter` answers `I am in the shelter "basement"` |
| `watch_server` | w100 | `watch_server` on, a random token in the environment of the agent (never printed): `node scripts/watch.js` answers `state` (the position within 1 block of the server's, `in overworld`, the time), `inventory` (the kit), `places` (`home (home)` after `!rememberArea("home", "home")`), `chat` (the owner's line and the bot's answer); a POST without the token is 401 / -32001; the client without the token or with another one exits 1 with "unauthorized" and no state; `say {"text":"come here"}`: `Said as w_player: "come here".` and the bot within 2 blocks in 60 s; `say "/kill"`: `I do not run server commands.`, the bot lives; the token in no console line |
| `watch_events` | w101 | the pen with 6 chickens saved (`!rememberArea("pen")`), the house as `home`; 4 chickens killed: `The pen "pen" has 2 chickens, the record says 6.` in `events` within 90 s; a primed TNT 8 blocks north of the house: `Explosion N blocks from the area "home"` within 30 s, the house stands; `events --follow` printed both |
| `watch_line` | w102 | the teacher (`teacher.js`, the player placing in creative) says `!watchMe`, places 4 oak_planks eastwards, `!continueLike("12 long")`: `I watched you: 4 blocks placed, 0 broken.`, `I understood: a line of oak_planks 12 long from (x, y, z) eastwards; 8 oak_planks more, I carry 20. Say yes to build it.`; `!buildWatched`: the 12 cells hold oak_planks within 90 s, `I built the line: 8 oak_planks.`, nothing else within 3 blocks |
| `watch_fence` | w103 | the teacher places 3 oak_fence northwards and a gate facing east, `!continueLike("7 by 10")`: `a fence 7 x 10`, `the gate where you placed it`, 26 oak_fence more, `I carry 12 oak_fence`; `!buildWatched`: the rectangle 7 x 10 of fences with the teacher's gate as the only gate, the inside untouched, fences fetched from the chest of the house (64) |
| `watch_tunnel` | w104 | the teacher digs 3 deep, 2 high, west out of the mine room, `!continueLike("12 long")`: `I understood: a tunnel 12 long from (x, y, z) westwards, 2 high; 9 blocks more to dig. Say yes to dig it.`; `!buildWatched`: 12 cells dug, floor and ceiling stand, nothing dug beside or beyond, no block of the room changed |
| `iron_pickaxe` | w105 | `smelting` on, the mine taught, 6 iron ore beyond the end of the tunnel, 8 coal in the room chest, a stone pickaxe, 4 planks and 8 ladders: "make me an iron pickaxe" (`!getTool("pickaxe", "iron")`, the plan steps mine, smelt, craft): an iron_pickaxe within 8 minutes, the room furnace stands, no furnace in the pen or the farm, `I smelted N raw_iron into N iron_ingot in the furnace at ...`; phase `off`: `smelting` off, the process lives |
| `scan_underground` | w106 | the mine taught, `!leaveMine`, `!goToMine`, a typed walk into the tunnel: `I am in a tunnel 1 wide and N long, heading ..., of the mine "mine".`; never "storage" or "Tell me its name"; a cave dug beside the room tunnel: no line of the sense; `!rememberArea("x")` there answers `I am in a cave ...`/`I am in a tunnel; ...` and saves nothing |
| `spawn_and_bed` | w107 | A: the agent started without the 3.5 s wait (`startRealAgent`), `!collectBlocks("oak_log", 1)` 1 s after the spawn: the log 2 blocks away is gone within 10 s; B: asleep after `!goToBed`, `!stop` and `!goToCoordinates` 5 blocks away: out of the bed within 4 s, there within 30 s |
| `two_bots` | w108 | `w_farmer` here and `w_miner` in the phase `miner` (a second process), `other_bots`, `bot_role`, `only_chat_with` the player: "where are you?" gets exactly one line from each and no line in the 10 s after; "mine 4 iron": the farmer `That is w_miner's job. I farm.` and no `!mineOre`, the miner runs `!mineOre`; the role line in every prompt of each |

## Tools of v0.1.4.10

### The scorecard of a play log

```
node scripts/scorecard.js play.log [more.log ...]
```

One row per log and a total, then the commands chosen, most first. The log is the console output of the bot (UTF-8, or
the UTF-16 of a PowerShell 5 redirect) or the output of a scenario (`MCW_LOG_DIR`).

| Column | What it counts |
|---|---|
| Minutes | from the first to the last time stamp (`[HH:MM:SS]`, `log_timestamps`); `-` for a log without times |
| Processes | the lines `Initializing agent <name>...` |
| Ends | per process the reason of `Agent process ends with exit code N: <text>` (stuck, socket, kicked, restart, mindserver, code, players, other), or `exit N` when only `Agent process exited with code N` came |
| Orders | the messages of players (`<bot> received message from <player> :`); handleMessage prints a message a second time, it counts once; messages of `system` are no orders |
| Without result | the orders after which no `Agent executed:` line and no `full response to <player>` came within 60 s; a typed command also counts as answered by its `parsed command:` line (its answer is not printed). Without times: before the next order |
| Calls | the calls of the last `Cost:` line of each process (cumulative, `It includes N earlier processes` replaces the sum); without a cost line the `Awaiting ... response` lines. In brackets the `Awaiting` lines per model |
| Cost | the dollars of the same `Cost:` lines; `-` without one |
| Stuck | the lines with `I'm stuck!` (also inside an AUTO MESSAGE) |
| Doors open | the `Door service: closed ...` lines: doors the bot left open and the service closed; `could not close` lines are added as "N not closed" |

A log cut in the middle counts what it holds: the calls of the cost meter are those of its last cost line, the
`Awaiting` lines only those in the cut.

### The dump of the owner's region

`scripts/dump_region.js` reads the blocks around home in the owner's world into `tests/world/owner_region.json`.
The owner runs it once, on his machine, while his world is open (the bot of the tests never connects to it). The
file is not committed (16 MB at radius 48; `.gitignore` lists it): the owner sends it as an upload, and a session
in the cloud copies it to that path before the world tests.

```
fnm exec --using=v20.20.2 -- node scripts/dump_region.js --host 127.0.0.1 --port 55916 --name region_dump --center <x> <y> <z> --radius 24 --out tests/world/owner_region.json
```

- `--center` is the middle of the box, for example the floor of the house in front of the bed (F3 shows it); the box
  is `2r+1` blocks wide, long and high (`--radius` 1 to 48, default 16). 24 holds the house, the basement and the
  mine room when they lie within 24 blocks.
- The script joins as a second player in offline mode (the world must allow it, as it does for the bot) and reads only:
  no chat, no command, nothing dug or placed. It waits until every chunk of the box is loaded (`--wait`, 60 s): stand
  near the box, or the script says which chunks are missing and where its player stands.
- It writes `{ version: 1, center, radius, blocks: [[x, y, z, name, props]] }`, absolute coordinates, without air, one
  block per line; props are `facing`, `half`, `open`, `hinge`, `part`, `type`, `axis`, `shape` when the block has
  them. The contents of chests are not read. Then one table: the box, the cells, the blocks, the air, the cells not
  loaded, the kinds, the beds, chests, doors, trapdoors and ladders. Exit 1 with one line on a bad argument, no
  connection or chunks not loaded.

`tests/world/owner_region.js` is the loader: `loadDump(file)` (null without the file), `buildFromDump(dump, origin)`
clears the box at the origin and builds every block with the control (the center of the dump lands on `origin`, the
attached blocks last, a door's and a bed's halves together), `buildCommands(dump, origin)` gives those commands, and
`spotsFromDump(dump, origin)` finds the beds, the chests, the doors, the trapdoors and the ladders (with their
columns). The region must be prepared with a radius of the dump's radius or more.

### `npm run test:play`

The first ten minutes with the chat model of the owner's profile: the only test in which the model talks. It runs on
the owner's machine, by hand, never in `npm test`, and costs money (about 10 cents with Luna).

```
npm.cmd run test:play                                   the chat model of profiles/claude.json
npm.cmd run test:play -- --profile profiles/gpt.json    another profile
npm.cmd run test:play -- --fake                         the fake model of the world tests: no key, no cost
```

It refuses to run without the key of the chat model in the environment (`ANTHROPIC_API_KEY` for Claude,
`OPENAI_API_KEY` for gpt and Luna, ...): `Play test refused: ...`. It starts the test server as the world runner does
(`MC_TEST_SERVER_DIR`, `MC_TEST_JAVA`, 127.0.0.1, port 25599 or the next free one, a base world), builds the owner
variant of the base, starts the bot with the model and the owner's switches of the journeys, and a second bot as the
player says, in plain words, the sentences of W80 and W84 while it walks their way: "this is home", "follow me" (down
to the basement), "remember the path here", "come here", "go to the basement", "follow me" (out, down both ladders, into
the tunnel), "this is the mine", "find some iron". After each sentence it waits for the world fact of the journeys (an
area around the middle of the house, the bot in the basement, a route with a ladder, the bot in the house, the bot in
the tunnel, a mine of the player, 4 raw_iron). The table: the sentence, the command the model chose, the command of
the journeys, the fact, pass or fail, the cost of the sentence; then the line of the cost meter. Exit 0 when every fact
holds. With `--fake` the fake answers each sentence with the command of the journeys, and its cost is of a made-up
usage (3000 tokens in, 40 out per call).

## Hygiene

The runner checks at the end and fails the run otherwise: the java process it started has ended,
no `mc-world-*` temp directory is left, the repository's `bots/` folder is unchanged, and the
server folder is unchanged (its `logs` folder is not compared). It never stops a process it did
not start, and it never connects to port 55916.

## Game mechanics worth knowing

- Peaceful removes hostile mobs at once, also summoned ones, and fills the food bar by itself.
  The creeper scenario uses `difficulty normal`, the eat scenario `difficulty easy`.
- A player can sleep only from time 12542 (the server) or 12541 (mineflayer) until 23458, or in a
  thunderstorm; time 12000 is sunset but not yet "night" for a bed.
- With `doDaylightCycle false` sleeping does not end the night; the sleep scenario turns the
  cycle on while the bot sleeps.
- `bedrock` is the floor of the flat world, 4 blocks below every bot: code that matches beds with
  `includes('bed')` always finds it.
- The 1.21.8 server ignores every action of a player (dig, place, use) until the client sends
  `player_loaded` (new in 1.21.4) or 60 ticks have passed. mineflayer 4.33 never sends it, so for
  3 s after a spawn nothing a bot does reaches the world, without any answer. `startAgent` waits
  3.5 s after the spawn for this reason.
- mineflayer-pathfinder plans diagonal steps past the corner of a solid block and then cannot walk
  them (it resets "stuck" for ever); after opening a fence gate it steers to the corner of the gate.
  See the area guard (diagonals) and `goToGoal` in `skills.js` (a stuck walk at a door or gate).
- `setblock` of the block that is there already answers "Could not set the block"; the builders
  accept that answer.
- `/give` is confirmed by the server before the bot has the items in its own view: wait for them.
- Since 1.21.5 the armour and the off hand of a player are in `equipment`, not in `Inventory`.
- Leaves never decay while the random tick speed is 0, so no sapling comes from them; a scenario
  that needs a sapling gives one. A ripe wheat drops 0 to 3 seeds; a scenario that plants again at
  once gives a few seeds, or the result would depend on luck.
- A command typed by a player (the orders of `orderChannel`) answers only in the chat; its result does not go
  into the history and asks no model. A command the model gives puts its result into the history as a
  system line. Scenarios that test what the model is told (W31, W43, W55) let the fake model give the order.
- In a closed room of 1 x 1 x 2 (obsidian, W31 and W57) the path search finds no way out and the escape of
  unstuck returns at once without moving ("Moved away from (x, y, z) to (x, y, z)."): with
  `stuck_restart_after` 1 (v0.1.4.7) that is "I'm free.", no kill; above 1 it is a failed escape. The kill of
  v0.1.4.7 came only from an escape that did not return within 10 s.
- A chest alone in a fence line is a way through the fence: it is 0.875 blocks high and the path search jumps
  onto it and down (seen in W49: the night reflex left the farm over the chest, not through the gate), and the
  farm scan calls such a fence "not closed" (W56). The chest of the farm of the base has a fence post on it.
- A trapdoor above a ladder is climbable when it is open and faces the same way as the ladder (both `facing=south`
  in the base).
- The daylight cycle is stopped by the runner; a scenario that needs dusk sets `time set 12500` (W45, W48, W49).
  The long run switches the cycle on: dusk comes about 9 minutes after `time set 1000`.
- The mode torch_placing puts a torch at the feet of an idle bot that carries torches when no torch is within
  6 blocks, also by day in the open (upstream). A scenario that compares the inventory or the blocks around
  the bot before and after an order either gives no torches (W54) or takes the numbers right before the order
  (w15).
- A player in creative mode is ignored by monsters; the player of `orderChannel` is in creative unless a
  scenario needs it to drop items (W44: survival).
- The old `!collectBlocks` of v0.1.4.6 took no crop inside a saved farm (the air above a crop was
  a block of the farm for its guard; fixed in v0.1.4.7, Amendment 2 I5, phase `saved` of `w20`), and
  at a closed fenced field that is not saved it did nothing for 210 s (known, not fixed): `w20`
  compares with an open field.
