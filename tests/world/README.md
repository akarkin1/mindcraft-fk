# World tests: the bot on a real Minecraft server

`npm run test:world` runs the scenarios of `tests/world/` against the official Minecraft 1.21.8
server. The unit tests (`npm test`) and the end-to-end tests (`npm run test:e2e`, a simulated
server without a world) cannot prove that the bot digs, walks through doors or runs from a
creeper. These tests can: real blocks, real physics, real monsters. The language model is always a
fake with canned replies; nothing leaves 127.0.0.1.

## Running

```
npm run test:world                       all scenarios (about 30 minutes)
node tests/world/run.js doors shelter    only scenarios whose name contains one of the words
node tests/world/run.js --verbose        the whole output of every scenario while it runs
node tests/world/run.js --server-log     also the server lines of every scenario
```

Node 20 is required, as for the other tests. The exit code is 0 only if every selected scenario
passed and nothing was left behind (see "Hygiene").

### Environment variables

| Variable | Meaning | Default |
|---|---|---|
| `MC_TEST_SERVER_DIR` | folder with `server-1.21.8.jar` and the accepted `eula.txt` | `%LOCALAPPDATA%\Mindcraft\test-server` |
| `MC_TEST_JAVA` | `java.exe` of Java 21 | the Java of the Minecraft launcher (see `mc_server.js`) |
| `MCW_LOG_DIR` | if set, the runner copies the output of every scenario run and the server log there | not set: nothing is kept |

Without the jar, an accepted `eula.txt` or Java the runner prints
`World tests skipped: no test server found.` and exits with 0.

## World types

Every scenario names the world it needs (the fifth field of its entry in `SCENARIOS`, `flat` when
not given). The runner starts one server per world type that the selected scenarios need, one after
the other, the flat one first; each in its own folder of the run directory.

| Type | Layers from y -64 up | Ground (top block) | Used by |
|---|---|---|---|
| `flat` | bedrock, 2 dirt, grass (the default flat world) | y -61 | the scenarios of v0.1.4.6 and the work above ground of v0.1.4.7 |
| `deep` | bedrock, 120 stone, 3 dirt, grass | y 60 | the mining scenarios of v0.1.4.7 |

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
- `snapshotBox(box)` clones a box (the house) to y 280 above it on the server;
  `compareSnapshot(snap, bot)` compares on the server with `execute if blocks`, lists the changed
  blocks with their names, and treats a door that is only open or closed as a state difference.
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
| `w05_night.js` | night comes while the bot works on a day order: it goes to the shelter by itself; an order given at night is obeyed; following continues at night |
| `w06_protected_house.js` | `!collectBlocks("oak_log", 4)` takes the tree, not the house; `bot.dig` on the wall is refused; a path goes around the house |
| `w07_scan.js` | `!rememberArea` finds the house and its door, the fenced farm and its gate, nothing on an open field |
| `w08_farm.js` | in a farm area: ripe wheat can be broken, the fence cannot, seeds can be planted, dirt cannot be placed |
| `w09_creeper.js` | a creeper 10 blocks from the house is led away; house untouched, the bot lives, the door stays shut (monsters: up to 3 runs, 2 must pass) |
| `w10_sleep.js` | at night the bot sleeps in the bed of the house; the text at day; bedrock is no bed |
| `w11_eat.js` | the bot eats bread at a low food level; the text without food; the auto-eat options |
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
- The old `!collectBlocks` of v0.1.4.6 took no crop inside a saved farm (the air above a crop was
  a block of the farm for its guard; fixed in v0.1.4.7, Amendment 2 I5, phase `saved` of `w20`), and
  at a closed fenced field that is not saved it did nothing for 210 s (known, not fixed): `w20`
  compares with an open field.
