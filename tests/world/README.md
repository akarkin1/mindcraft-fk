# World tests: the bot on a real Minecraft server

`npm run test:world` runs the scenarios of `tests/world/` against the official Minecraft 1.21.8
server. The unit tests (`npm test`) and the end-to-end tests (`npm run test:e2e`, a simulated
server without a world) cannot prove that the bot digs, walks through doors or runs from a
creeper. These tests can: real blocks, real physics, real monsters. The language model is always a
fake with canned replies; nothing leaves 127.0.0.1.

## Running

```
npm run test:world                       all scenarios (about 10 to 15 minutes)
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

## How a run works

1. `run.js` creates a temp directory `%TEMP%\mc-world-run-*`, writes `server.properties`
   (127.0.0.1, port 25599 or the next free one but never 55916, offline mode, flat world, no
   structures, peaceful) and copies `eula.txt` there. It starts
   `java -Xms512M -Xmx1G -jar <MC_TEST_SERVER_DIR>\server-1.21.8.jar nogui` with the temp directory as
   working directory, so the world, the libraries the jar unpacks and the logs all land there. The
   server folder itself is only read. The server is ready when it prints `Done (...)! For help`
   (about 12 s, most of it unpacking the libraries).
2. The runner sets the world defaults: no daylight cycle, time 6000, no weather, no natural mob
   spawning, random tick speed 0 (crops do not grow, leaves do not decay), peaceful. It finds the
   ground: the flat world has grass at y -61, so a bot stands at y -60 (read from the server, not
   assumed; given to the scenarios as `MCW_GROUND_Y`).
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
