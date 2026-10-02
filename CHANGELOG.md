# Changelog

All notable changes of this fork are listed here, newest release first.

This fork is based on [Mindcraft](https://github.com/mindcraft-bots/mindcraft) `v0.1.4`. Releases of the fork add a fourth number: `v0.1.4.1`, `v0.1.4.2`, and so on. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Each release lists new settings and feature flags with their default value.

## [0.1.4.10] - 2026-10-02

"Goals": the bot keeps the job you gave it, the path search climbs ladders by itself, the item reflex
never opens a pen, the house and the basement are two places, and a play log is a table.

### Added

- **The job** (`job_memory`, off): an order with a result that code can check (mine N of an ore, farm a field, get N logs, make N of an item, collect N blocks) becomes the job of the bot, kept in `bots/<name>/job.json`. Errands ("follow me", "come here", "check the chest", "wait", "go to bed", the questions) do not end it. After `job_resume_seconds` (60) without an order and nothing running the bot goes back by itself: `I go back to the mining, 6 of 16 iron.` No call of the model for that. "Stop", "that's enough" or a new job end it: `I leave the mining at 6 of 16 iron.` It survives a restart: `I was mining iron, 6 of 16. I go on.` One line when the job is done: `The mining is done: 16 iron.`
- **A blocker becomes steps**: a skill that fails for a missing supply (no torches, no pickaxe, no wood, no food) asks the model once for steps (at most 6, only wood, storage and crafting commands, at most 3 plans per job): `I have no torches. I get wood, planks, sticks and torches, then I go on.` and `Step 2 of 4 done: 16 sticks.`; when no plan comes: `I could not plan the steps for the torches. Tell me what to do.`
- **The standing list** (`idle_jobs`, `[]`; `idle_jobs_minutes`, 15): commands the bot runs in order when it has no job, each at most once per `idle_jobs_minutes`, for example `["!farmCycle(\"farm\")", "!craftSupplies(\"torch\", 32)"]`. Needs `job_memory`.
- **Two commands with `mining_pack`**: `!mines` lists the mines (`I know 2 mines: "mine", entrance (9, 67, 52), 2 tunnels at levels 30 and 25; the mine at (9, 67, 58) that I dug, level 16.`) and `!forgetMine("name")` forgets one.
- **Floors** (`area_floors`, off): "this is home" upstairs saves the floor you stand on; "this is the basement" below saves a second area; the shelter is the floor with the bed. A scan that gives the box of an existing area answers `That is the area "home" already.` A rule such as "never enter the chicken pen" marks that area keep out: `I marked the area "chicken_pen" as keep out.`
- **Tools**: `node scripts/scorecard.js <log>` prints one table per play log (minutes, processes and why they ended, orders and orders without a result, calls and cost per model, stuck lines, doors left open, the commands chosen). `node scripts/dump_region.js` reads the blocks around a point of your world into `tests/world/owner_region.json`, from which the test base is built. `npm run test:play` plays the first minutes with the chat model of your profile, on your machine only, and prints the sentence, the command the model chose, the fact and the cost.
- The job line in the knowledge block: `Job: the mining, 6 of 16 iron, step 2 of 4.`

### Changed

- **The path search climbs and descends ladders itself**, opens a closed trapdoor on its way, centres every door point, takes a tolerance of 0.35 blocks at doors, gates, trapdoors and ladders, never stands on a bottom slab, bottom stairs, a cauldron, a composter or a hopper, pays 50 more for a one-wide pit and 100 more for 30 s for a point it could not reach, so the next plan takes another way. On a ladder it looks at the wall and holds or releases forward, never jumps. The ladder step of v0.1.4.9 stays as the fallback after a walk, and mid-walk when the bot stands still.
- **The item reflex never opens the gate of a pen or a farm** and never picks an item inside such an area or an area marked keep out while the bot is outside: `I leave the oak_fence in the pen "pen". I do not open its gate.` once a minute.
- A mine of the bot is keyed by its level (`bot:16`), a mine of the player by its name; `mines.json` becomes version 2 at the first load, every mine kept. A mine named "16" no longer collides.
- The descriptions of `!mines` and `!forgetMine` are short; the prompt with every switch on is 16,981 characters. `!craftable` says it crafts nothing (Haiku took "make 10 ladders" for it).
- `profiles/gpt.json` picks its prompt examples with the same embedding model as the claude profile. The routing check of 2026-10-01: Luna 146 of 154 for 5 cents, Haiku 145 of 154 for 78 cents; three stale expectations of the sentence list widened.
- A ladder pass that ran out of time while the bot still arrived claims no failure.

### Settings

| Key | Default | Meaning |
|---|---|---|
| `job_memory` | `false` | The bot keeps its job and comes back to it |
| `job_resume_seconds` | `60` | Seconds without an order, and nothing running, before it comes back (10 or more) |
| `idle_jobs` | `[]` | Commands the bot runs when it has no job, in order |
| `idle_jobs_minutes` | `15` | An entry of the list runs at most once per this many minutes |
| `area_floors` | `false` | A scan of a building stops at a floor |

The path search, the pen gate, the duplicate area and the mine commands are corrections and have no switch.

## [0.1.4.9] - 2026-09-30

The mine, the routes of the player, and the model comparison. The bot learns a place by walking through it with the player: the way into the mine, with its ladders, doors and trapdoors, and the way from one room of the base to another. Code stores the way as a route and walks it again. The language model never has to understand what a tunnel is, and it no longer writes tunnel code.

Every new switch is off by default. Corrections have no switch.

### Added

- **Setting `routes_pack`**, default `false`, with `trail_max_steps`, default `500`. The bot records the steps it walks, the ladders it climbs and the doors, gates and trapdoors it passes, in `trail.json` in the folder of the world. No call of the model.
  - **`!rememberRoute("bed")`**: the trail since the last saved place, area or mine the bot passed becomes a route of walks, ladders and doors. The bot walks a route in both directions: short hops with the path search, ladders by control states, doors and trapdoors by the door skills.
  - **`!routes`** lists the routes, **`!forgetRoute`** removes one.
  - `!goToBed`, the shelter walk and `!goToRememberedPlace` use a route when the path search finds no way, for example down a ladder with a trapdoor.
  - A broken route: the bot says at which step and where, digs nothing, and asks the player to show the way again.
- **Setting `mine_routes`**, default `false`. With `mining_pack` and `routes_pack`:
  - **`!rememberMine("mine")`**, "this is the mine": the trail from the last step under open sky becomes the way into the mine; the chest, crafting table and furnace near the way become the room; the tunnel the bot stands in is measured.
  - **`!rememberTunnel`**, "dig here": the bot measures the tunnel it stands in: start, direction, end, level. One mine holds several tunnels.
  - **`!mineOre` in the mine of the player.** It takes the nearest known mine within 64 blocks, walks its route, picks the tunnel whose level lies in the range of the ore and nearest to its best level, and digs on at its end, 1 wide and 2 high, with the checks for lava and caves. When no tunnel of the mine fits the ore, it says at which levels the tunnels are and asks. A new shaft only when no mine is known, and only after the player said yes.
  - **Side branches.** When a tunnel is 32 blocks long, the bot digs branches of 8 blocks to the left and to the right every 4 blocks, nearest to the room first.
  - **The ore list.** Every ore block seen beside the tunnel and not taken is remembered with its reason: the pickaxe is too weak, lava beside it, the inventory was full, the vein was bigger than 12, the bot was stopped. `!mineOre` says what it left behind. **`!collectPassedOre("coal")`** walks back and takes it.
  - On the route of a mine and in its room and tunnels the bot counts as underground: no shelter walk at dusk, creepers only in sight.
  - The block "what I know" names the mine and the tunnel the bot is in, and the ore it left behind. With `knowledge_in_prompt`.
- **Setting `ore_sense_range`**, default `0`. `3`: in a tunnel the bot also takes ore within 3 blocks of the wall, the ceiling and the floor, through a short side cut; `!collectBlocks` with an ore takes ore that has an open cell within 3 blocks.
- **Setting `skills_over_code`**, default `false`. `!newAction` is refused for a request about digging, a tunnel, a shaft or an ore where a skill exists, with a text that names the skill. In the play test the model wrote tunnel code six times, each version different, one dug in the wrong direction.
- **The cost meter counts the models of OpenAI**: input, cached and output tokens of the Responses API, of chat completions and of embeddings. Prices for `gpt-6-luna` (0.10 and 0.50 dollars per million tokens, cached input 0.01) and `text-embedding-3-small` (0.02). Before, `!cost` showed 0 calls for them.
- **The routing check takes a model of OpenAI**: `node scripts/routing_check.js --model gpt-6-luna` or `--profile profiles/gpt.json`; `test-routing.ps1 -Model gpt-6-luna`. The table shows the time of every answer; the summary shows the accuracy, the median and mean time per answer and the measured cost. The key of the api of the chat model is loaded from the vault, and the other key too when it exists, so that the examples are chosen as in play.
- **`profiles/gpt.json`**: the prompt of the owner with GPT-6 Luna as chat model, reasoning effort low, the code model of the claude profile, and one rule more: with a command the bot answers the command alone, because Luna narrated every step aloud. `start-gpt.ps1` starts it and loads both keys.
- **`scripts/get_test_server.js`**: downloads the official 1.21.8 server through Mojang's version manifest, checks the SHA-1 (`6bce4ef4…`) and, with `--accept-eula`, writes `eula.txt`. The world runner and the script share the default folder: `%LOCALAPPDATA%\Mindcraft\test-server` on Windows, `~/.local/share/mindcraft/test-server` elsewhere, or `MC_TEST_SERVER_DIR`. The server starts without `JAVA_TOOL_OPTIONS`.
- Examples and 18 sentences of the routing list for the new commands.
- 377 unit tests written from the spec by an independent tester, 6078 in all. 14 more scenarios on the real server, 72 in all, among them the walk into the mine, the routes to the bed and back, a broken route and the long run of 30 minutes with the new parts on.

### Changed

- **`!collectBlocks` with an ore takes only ore in sight**: an ore block needs a face towards an open cell. Before, the bot saw ore through the rock and dug to it. When every ore is inside the rock it says so and, with `mining_pack`, points to `!mineOre`. This holds with every switch off; `ore_sense_range` 3 widens it to ore within 3 blocks of an open cell. In a tunnel the bot no longer sends an ore beside it to `!mineOre` because a ray from its eyes did not reach it, and underground it never does.
- **`!goToRememberedPlace` walks a learned route first** when one leads to the place, then the path search does the rest. With `routes_pack`.
- **`!mineOre` no longer breaks an ore its pickaxe cannot harvest** beside the tunnel; it is listed as passed. With `mine_routes`.
- The block "what I know" shows a mine of the player by its name.
- The remembering, listing and forgetting of routes and mines are plain commands: a running `!followPlayer` keeps running, so "follow me, this is the mine" works.

### Fixed

- **The bot could not climb out of a shaft through an open trapdoor.** `prismarine-physics` 1.10.0 treats an open trapdoor above a ladder as climbable only up to Minecraft 1.20, and knows no trapdoor newer than mangrove. Corrected by `patches/prismarine-physics+1.10.0.patch`, which also lets a jump climb a ladder in 1.21; `npm install` applies it. The climb has a second way out at the top: jump and walk towards the entry.
- **The path search climbed any ladder it entered**, so a walk to the foot of a ladder hung in the column. The bot now walks to the cell beside the column and steps in.
- **The sky light the bot reads is stale** on a chunk border (15 inside a house). Open sky is decided by the column above the bot, never by the light.
- **`!craftSupplies("torch", 32)` said it had no logs while it carried some.** The crafting chain of the wood pack chose one plank kind and read the inventory once. It now uses the logs the bot carries, oak first, reads the inventory again before each step, tries a step up to 4 times, and names the item that is really missing.
- **The log exploded during `!mineOre`**: 15,000 copies of a deprecation warning of prismarine-entity, printed as `[object Object]`. The mining pack no longer reads `entity.objectType`, and the stamped console formats objects and traces like Node does.
- **"do not dig" in a code request was refused as a digging request.** A dig word within 3 words after not, no, never, don't, without or avoid does not count.
- **`!goToMine` knew only mines the bot dug** and climbed down with the shaft code. With `mine_routes` it takes the nearest known mine, the mine of the player included, and walks in by its route.
- **A trip without torches dug in the dark and said nothing.** The text at the end says `I had no torches, the tunnel is dark.`
- **`!rememberMine` after a start underground** said "in my last 0 steps". It says that it has not been under open sky since it started.
- **The way out of a mine** after side steps and branches walks back along the cells the bot dug, digs a natural block in the way, and names the cell when it may not.
- **`!leaveMine` from a room whose ladder ends above the floor** targeted a cell in the air. The foot of such a ladder is the cell under it; the bot places the missing ladder blocks when it carries ladders, else says which cells need one.
- **A route could not start inside the house**: the area of the house spans both floors, so "remember the path here" in the basement answered "too short". Floors 3 or more blocks apart count as different places, and a route saves the place of its name at its end, so "go to the basement" walks it.
- **The door service closed the trapdoor over the player's head** while the bot was about to follow. It closes only what the bot itself passed, 2 blocks past it, and never with an entity within 1 block.
- **The bot could not follow the player down a ladder.** `!followPlayer`, `!goToPlayer` and every walk to a point open a closed trapdoor and go down or up a ladder column within 6 blocks when the target is 2 or more blocks below or above. Also mid-walk: when the path search holds the bot at the top of a ladder for 3 s with the target 2 or more blocks below or above, the walk stops for the ladder and goes on. Always on; a correction of the path search.
- **"Come here" right after the player changed floors answered `Could not find`**: the bot waits up to 2 seconds for the player to appear.
- **The door service could knock the bot off a ladder**: it closed a door while the bot climbed beside it, and the click turned the bot away from the wall. It waits while the bot is on a ladder.
- **An order given while the bot climbs a ladder made it slide back** for a moment. A stopped climb holds on with sneak until the next order takes the ladder.
- **After climbing out through a trapdoor the bot could hang in the hole**: the open trapdoor stayed open until the bot was 2 blocks past it, and a walk across it fell in. The bot closes the trapdoor it climbed out of at once.
- **The bot slid back half a block on every climb up to a closed trapdoor.** The click turned its look away from the wall. It holds jump during the click, looks back at the wall at once and climbs on.
- **A trip put its torches into the chest of the mine** before digging and dug in the dark. Storing at the base keeps every torch, ladder and pickaxe, food up to 16 and fillers up to 32. A torch is placed when none stands in the last 8 cells of the tunnel, so a short dig gets one too. With `mine_routes`.
- **"check the chest", then "make 32 torches" said it lacked sticks** with 19 logs in that chest. `!viewChest` records the chest in the chest index (with `storage_pack`), and `!craftSupplies` crafts what the inventory gives, fetches the rest from the chests it knows, closes any open chest window and clears the crafting grid before each craft, crafts one batch at a time, then says what is still missing: `I made 28 torches of 32. I need 1 coal more and know no chest with coal.`
- **A resume action such as `!followPlayer` used a global `assert`** that only the sandbox lockdown supplies. The action manager imports it.
- Nothing of a play test: `0.1.4.8` was not played before this release.

## [0.1.4.8] - 2026-09-30

Stability. The answer to the first play test of the work skills: 20 restarts of the process in two hours, a bot that starved with food in its hand, a broken fence, reflexes that did not know where the bot was. This release corrects defects of `0.1.4.6` and `0.1.4.7` and adds switches for new behaviour.

Every new switch is off by default. Corrections have no switch.

The scenarios on the real Minecraft server now run with the reflexes of the profile on, in a test base with a house, a mine under the house, a farm and a pen. Their first full run found 15 more defects, among them a bot that got into a composter and never came out. They are corrected in this release too.

### Added

- **Setting `stuck_restart_after`**, default `1`. The number of failed escapes of the reflex `unstuck` in a row before the process restarts. `1` is the behaviour of `0.1.4.7`. With `3` the reflex gives up twice: it first tries to jump out of a hole or a hollow block, then stops the command, tells the model where the bot is stuck, names the area and the nearest door, and waits for the next command. `0` means never.
- **Setting `protect_built_blocks`**, default `false`. The bot never breaks blocks that players build with: fences, gates, doors, planks, glass, chests, beds and the like. This holds outside saved areas too, for `!collectBlocks`, for code that the model writes, and for the path search. Exceptions: blocks that the bot placed itself, and a command that the player types in the chat.
- **Area types `home`, `pen` and `mine`**, next to `building` and `farm`. Only a `home` is a shelter. In a `mine` the bot may dig natural blocks and never breaks what was placed. An area of type `building` with `mine` or `mining` in its name becomes a `mine` when the file is loaded; an area with a side of less than 2 blocks is dropped.
- **The house becomes an area.** At the start the bot scans the building at the place `home` and saves it as the area `home`. With `protected_areas`.
- **Hunger reflex**, setting `home_reflexes.hunger`, default `true`, part of `home_pack`. The bot eats by itself. With no food it fetches food from a chest it knows. With no food anywhere it tells the player, once at "hungry" and once at "starving". No call of the model.
- **Setting `flee_below_health`**, default `0`. Below this health the bot does not attack a monster, it retreats to the player or into the shelter.
- **Setting `knowledge_in_prompt`**, default `false`, with `knowledge_max_chars`, default `600`. A short block in the chat prompt: where the bot is, the chests it knows with their main content, the areas, the mines. It also reaches a profile that has its own prompt text.
- **Setting `examples_by_last_request`**, default `false`. The examples of the prompt are chosen by the last request of the player, not by the whole conversation. In a session about farming the example "get back to farming" was shown for "get to the shelter", with an embedding model and without.
- **Setting `repeat_guard`**, default `0`. With `3`, the third try in a row of a command of the model that failed twice with the same result is refused, and the bot is told to ask the player. Only failures count. Looking at the inventory in between does not end the row. Commands typed by the player are never refused.
- **Setting `restart_context`**, default `false`. After a restart the bot is told the last order and why the process ended.
- **Setting `say_results`**, default `false`. When the model answers nothing after a skill, the text of the skill goes to the chat.
- **Setting `log_timestamps`**, default `false`. `[HH:MM:SS]` before each line of the console.
- **Command `!pickUpItems`**. Picks up items that lie on the ground, and waits for the pick-up delay of a thrown item.
- **Command `!closeDoor`**, with `home_pack`. Closes the open doors, gates and trapdoors within 6 blocks.
- **`!chests` with an item.** `!chests("wheat")` answers from memory where the item lies and how many.
- **`!mineOre` asks first.** Without a known mine the bot digs nothing and asks. `!mineOre("iron", 8, true)` starts a new mine.
- Examples for 14 commands that had none, among them `!goToBed` and `!givePlayer`, and for the new commands and area types. 23 more sentences in the routing list.
- 506 unit tests written from the spec by an independent tester. 29 more scenarios on the real server, 58 in all, among them a long run of 30 minutes with 60 orders.
- `docs/ROADMAP.md`: the releases that are planned and the backlog.

### Changed

- **The model cannot switch off a safety reflex.** `!setMode` refuses the model for `self_preservation`, `creeper_safety`, `night_shelter`, `door_closing` and `hunger`. A command that the player types in the chat runs.
- **The chat of the bot has a limit**: 6 lines at once, then 1 line per 1.2 seconds. Lines wait in their order, nothing is lost. The server kicked the bot for spamming after 11 lines in 2 seconds.
- **A command wakes a sleeping bot.** A command that is not `!goToBed` gets the bot out of the bed first.
- **`!chopTrees` takes the number of logs**, not of trees. The bot cuts whole trees until it gained that many logs. It gets an axe first and picks up the logs after each tree.
- **`!farmCycle` does the whole round**: harvest, plant, store, bone meal, fertilize, harvest what got ripe, close the gate. Bone meal and compost come from the inventory, then from the chests the bot knows, then from the composter of the farm. Leaf litter is compost. Seeds, crops and food never are.
- **In a farm the bot walks carefully**: no sprint, no jump, no diagonal step past a corner, and it never stands in or on a composter, a chest, a fence or a closed gate.
- **`!getTool` counts the chests.** Without a material it makes the best tool it can, up to stone.
- **`!eat`** eats until health can come back (food level 18), and until full when the bot is hurt. Its text counts what left the inventory.
- **The shelter** is only an area of type `home`. With no home the shelter reflex says so and no longer digs the bot in.
- **A new mine** keeps 16 blocks from house, farm and pen, and never starts underground.
- **`!rememberArea`** finds the fenced ground when the bot stands outside the gate, and says why when it fails. The model cannot shrink a saved area with `!setArea`.
- **`!storeItems`** tries the 27 nearest chests.
- A chest view is one line, added up and ordered by count. The output of an action is cut at 1500 characters, at whole lines.
- The cost limit per session and `!cost` count all processes since the bot was started.
- An embedding model that cannot be created, for example because its key is missing, no longer stops the start. The examples are then chosen by word overlap.
- A kick prints the reason that the server gave.
- The house rules in `profiles/claude.json` shrink to the one that code does not cover.

### Fixed

- **Chat kick after 21 messages.** The server kicked the bot with `Checksum mismatch on last seen update` at its first chat after the 21st message of a player. `minecraft-protocol` 1.62.0 computed the checksum of the last seen messages in the order of its ring, not in the order of the window. Corrected by `patches/minecraft-protocol+1.62.0.patch`; `npm install` applies it.
- **The bot starved with food in its hand.** The home pack left the food in the off-hand, where `!eat`, `!consume` and `!discard` did not look. A defect of `0.1.4.6`.
- **`unstuck` stopped work skills.** Storage, wood and mining did not pause the reflex while they worked in one place. 11 restarts in the play test. A defect of `0.1.4.7`.
- **The bot got into a composter and never came out.** A walk to a bone meal that lay on the rim of the composter ended on top of it, and the bot fell in; the path search plans no way out of a hollow block. In 6 of 10 runs before, in 0 of 20 after. A defect of `0.1.4.7`.
- **The bot stayed in the bed** and said that it got up. `bot.wake()` of mineflayer 4.33 sends the action 2, which means "stop sprinting" since Minecraft 1.21.6. The home pack sends `leave_bed` itself.
- **A new order was stopped after 0.2 seconds** when `unstuck` had fired before: an action that waited for a stop started after a newer one.
- **A stopped command returned nothing.** It now writes into the history what it did and who stopped it, and an order that the player typed answers in the chat. No second turn of the model starts.
- **Shelter reflex in a shaft.** The depth was measured in the column above the bot, which in a shaft is air and ladders. It is now measured against the ground around the bot. A defect of `0.1.4.7`.
- **Creepers through rock.** The creeper reflex used the plain distance. A creeper now counts only at about the same height and with no solid block in between. A defect of `0.1.4.6`.
- **Doors left open.** The door reflex did not run while another reflex moved the bot. It now runs beside every reflex and command, and closes gates and trapdoors too. A defect of `0.1.4.6`.
- **Swinging in a doorway.** With `home_pack` off, the old door timer closed a door that the path search had just opened. It only opens now.
- **The shelter was the nearest building**, also a mine or a pen. A home that is only a place was not entered through its door. Defects of `0.1.4.6`.
- **`!eat` beside the hunger reflex** said that it failed while the bot ate: two eaters called the game at the same moment.
- **`!mineOre` wanted ladders for the whole way** also when the shaft had ladders. A defect of `0.1.4.7`.
- **The chest at a fence never opened** for the storage pack. `!storeItems` looked into 12 chests only and then said that all were full. Defects of `0.1.4.7`.
- **The farm scan took a room for a farm.** A defect of `0.1.4.6`.
- **`!collectBlocks` counted broken blocks as collected**, and broke more blocks than asked on its way to a drop. Tall grass broken by hand gave "Collected 10 tall_grass". It now reports what the inventory gained.
- **The harvest counted a crop that stayed on the ground.** It counts what reached the inventory, and picks up once more at the end.
- `!consume` with full food threw an exception. `!givePlayer` printed a stray number. A gate was called a door.
- A stop did not stop a walk; the writing of new code could not be stopped.
- An older `!followPlayer` came back after a newer command.
- Dropped items were tried once and never again.
- Two unit tests failed in a checkout with LF line endings.

### Known limitations

- The correction of the chat kick is proven by unit tests. The test server does not sign chat, so the proof against a real server is the play of the owner.
- The bot finds no way between two floors that are joined by a ladder with a trapdoor. It then says so and digs nothing. Routes that the bot learns by walking with the player come with `0.1.4.9`.
- A command that the player typed loses its right to break built blocks when the model runs another command while it still works. It then is refused, to the safe side.
- `!useOn` still toggles a door without reading its state. `!closeDoor` reads it.
- When a chat message is deleted by the server, the network library forgets which messages it has seen.
- The area `home` that the bot saves at the start follows the ladders of a shaft down, so the house and the top of its shaft are one area.
- The rest of mining comes with `0.1.4.9`: the mine of the player, tunnels on order, the list of ore.

## [0.1.4.7] - 2026-09-29

Work skills. Four sets of skills that do a whole job with one command: storage, farming, wood and tools, mining. The language model chooses the command, code does the work.

Every set has its own switch and is off by default.

### Added

- **Storage**, setting `storage_pack`, default `false`.
  - `!storeItems` puts what the bot carries into chests. The bot keeps its best tool of each kind and a spare pickaxe, armour, up to 16 pieces of food, and torches, ladders and cobblestone up to a limit. The setting `keep_items` adds items that stay with the bot.
  - `!fetchItem` gets an item out of a chest the bot knows.
  - `!chests` lists the chests the bot knows and what is in them.
  - The bot remembers per world which chest holds what, in `chests.json` in the folder of the world.
  - A full chest is skipped and the next one is used. Double chests and barrels work.
- **Farming**, setting `farming_pack`, default `false`.
  - `!harvest` takes ripe plants only and plants the same crop again at once. Wheat, carrots, potatoes and beetroots.
  - `!plant` plants the free ground of a farm, and uses the hoe where the ground is not farmland yet.
  - `!makeBoneMeal` fills a composter with leaves, grass, flowers and saplings. It never uses seeds, crops or food.
  - `!fertilize` uses bone meal on plants that are not ripe.
  - `!farmCycle` does the whole round: harvest, store the harvest in a chest, plant again, fertilize.
  - The bot enters and leaves a fenced farm through the gate and closes it. It does not jump in the field, so the farmland stays farmland. It digs nothing.
  - The farm is a saved area of type `farm`, or the ground inside the fence around the bot.
- **Wood and tools**, setting `wood_pack`, default `false`.
  - `!chopTrees` cuts real trees only: a trunk that stands on the ground and has leaves. It takes the whole tree, also tall ones, and plants a sapling. Logs of a building are never taken, also when no area is saved: a trunk that touches blocks of a building is no tree.
  - `!getTool` makes sure the bot has a tool, and crafts it with every step. A bot with an empty inventory cuts a tree, crafts a wooden pickaxe, breaks stone and crafts a stone pickaxe.
  - `!craftSupplies` crafts torches, ladders, a chest or a crafting table, and collects the wood for it.
- **Mining**, setting `mining_pack`, default `false`.
  - `!mineOre` goes mining for coal, copper, iron, lapis, gold, redstone or diamond. The bot goes down to the best level for the ore, clears a room with a chest, digs one straight tunnel, collects the ore with the whole vein, and comes back up.
  - The way down is a shaft with ladders. When the ladders are used up, it goes on as a staircase.
  - Lava, water and caves beside the shaft and the tunnel are closed with cobblestone before the bot digs. It never digs a block while a block of the view is unknown.
  - When the inventory is nearly full, the bot stores into the chest of the mine and goes on. It places a second chest when the first is full.
  - The bot takes the best pickaxe it has, stone or better for every trip, and a spare one for a long trip.
  - A mine is remembered per world in `mines.json`. The next trip uses the same shaft and goes on at the end of the tunnel.
  - No shaft is dug within 8 blocks of a protected area.
  - `!goToMine` and `!leaveMine`.
  - Setting `mining_max_minutes`, default `30`: the longest time of one trip.
- **Old commands lead to the new skills.** While the set is on, `!collectBlocks` with a crop harvests ripe plants only, with a log it cuts trees, and with an ore that is not in sight it goes mining. `!putInChest`, `!takeFromChest` and `!viewChest` update what the bot knows about the chest.
- 14 prompt examples and 45 sentences of the routing list for the new commands.
- 15 more scenarios on the real Minecraft server, 29 in all, and a second world type with 120 layers of stone for mining.

### Changed

- With every part of this and the last release on, the chat prompt has about 4,020 tokens without conversation, against about 2,620 with all parts off. The commands of this release are about 820 of them.
- While `mining_pack` is on, the reflex `night_shelter` waits while the bot is more than 8 blocks under the ground, so it does not pull the bot out of the mine.

### Fixed

- With protected areas on, `!collectBlocks` took no crop inside a saved farm and answered that all blocks belong to a protected area. The rule that protects the ground under the floor of a building also looked at the air above the plants. A defect of `0.1.4.6`.
- `!setArea` did not know the doors and gates inside the box and answered `0 gates` for a fenced field. A defect of `0.1.4.6`.
- A unit test of the cost meter depended on which of two requests ended first.

### Known limitations

- Without shears, grass and leaves give nothing when they are broken. A bot without shears can collect flowers and saplings for the composter, nothing else. It says so when it made less bone meal than asked.
- The bot plants a sapling where a tree stood if it has one. Leaves give saplings slowly, so after most trees it has none and says so. A single sapling of dark oak never grows.
- The bot does not smelt. It cannot make iron tools from ore by itself.
- Mining was tried in a test world of flat stone with lava, water and caves that were put there. Not tried: natural caves of irregular shape, big lakes of lava, monsters in the mine, levels with deepslate.
- A chest counts as full when it has no empty slot, also when a stack of the same item in it has room.
- With `farming_pack` off and no saved area, the old `!collectBlocks` for a crop does nothing at a fenced field whose gate is closed.

## [0.1.4.6] - 2026-09-28

Cost control, and the first set of basic skills: home and safety. The bot measures what it costs. It can protect buildings and farms, close doors behind itself, go to shelter at dusk, lead creepers away from a building, and keep rules that the player teaches.

Every part has its own switch. The new parts are off by default, except the cost meter.

### Added

- **Cost meter**, setting `cost_meter`, default `true`. Every call to a Claude model is counted in tokens and dollars, by model and by purpose: chat, memory, coding, skill review.
  - The console shows a line every `cost_report_minutes` minutes, default `10`, and at the end of a session.
  - Sessions are kept in `bots/<name>/usage.json`.
  - The command `!cost` answers the question what the bot has cost.
  - Prices are built in for Haiku 4.5, Sonnet 5, Opus 5 and Opus 5.5. The setting `model_prices` adds or replaces prices.
- **Budget.** Three settings in dollars, `0` switches one off. The default in code is `0` for all three.
  - `cost_warn_per_hour`, `3` in the fork: the bot warns in chat.
  - `cost_limit_per_hour`, `8` in the fork, and `cost_limit_per_session`, `10` in the fork: the bot stops working on goals by itself, stops writing new code and skips skill reviews. Chat and commands keep working. It says so in chat, and it says so again when the cost is back below the limit.
- Setting `max_command_result_chars`, default `0`, `3000` in the fork. A longer result of a command is shortened before it goes into the conversation. A wiki lookup used to put about 500 lines there, which were sent again with each of the next calls.
- **Protected areas**, setting `protected_areas`, default `false`. It needs `world_memory`.
  - An area is a box with a type. In a `building` the bot does not break or place blocks. In a `farm` it only plants and harvests.
  - `!rememberArea` finds the box by itself: the building around the bot, or the ground inside the fence around the bot. `!rememberHere` saves the building around a place as well.
  - The protection sits on the bot itself. It covers the commands, the path search, the plugins and code that the bot writes.
  - Doors, chests, beds and the crafting table inside a building work as before.
  - Commands `!rememberArea`, `!setArea`, `!forgetArea`, `!areas`, and `!allowChanges`, which opens an area for some minutes when the player asks for changes there.
- **Rules of the player**, setting `player_rules`, default `false`, with `rules_max`, default `20`. A rule that the player teaches is stored for good in `bots/<name>/rules.json` and is part of every prompt. It does not pass through the memory summary, where lessons got lost. Commands `!rememberRule`, `!forgetRule`, `!rules`.
- **Home pack**, setting `home_pack`, default `false`.
  - `!goToShelter`: the bot goes to its shelter, gets in through the door and closes it. Without a shelter it digs in and closes the hole.
  - `!eat`: the bot eats the best food it has.
  - `!goToBed` handles a bed that is taken, monsters near the bed, and a time of day when sleeping is not possible.
  - `!goToRememberedPlace` enters a building through the door and closes it.
- **Reflexes of the home pack**, setting `home_reflexes`. They run in code and need no call to the model.
  - `door_closing`: a door or gate that the bot walked through is closed, and the bot checks that it is closed. Not while a player stands in the doorway.
  - `night_shelter`: at dusk the bot stops its work and goes to the shelter, when it works alone. An order to follow a player, and any order given during the night, wins.
  - `creeper_safety`: with a creeper near a building or a farm, the bot first leads it away, then runs. It enters the shelter only when no monster is near the door. The bot never opens a door while a monster is within 16 blocks of it.
- Setting `creeper_fighting`, default `false`. With it the bot may fight a creeper on open ground after it led it away, with a sword of stone or better and good health.
- **Commands in plain words.**
  - A parameter of a command can have a default, so `!followPlayer("name")` works without the distance.
  - Arguments in single quotes are read.
  - The prompt examples contain sentences from a real play session.
- Routing check: `test-routing.ps1` sends a list of plain sentences to the chat model and reports how many led to the right command. It takes the API key from the PowerShell secret vault. One run costs about 25 cents with Haiku 4.5.
- Tests on a real Minecraft 1.21.8 server: `npm run test:world`, 14 scenarios with real blocks and real monsters. They need a local test server and are skipped without one.

### Changed

- With all new parts on, the chat prompt is about 550 tokens bigger, which is about 20 percent of the prompt without conversation. Every saved rule adds about 25 tokens.

### Fixed

- Nothing in the bot closed a door. See the reflex `door_closing`.
- The bot stopped eating before it had finished, and did not take its tool back into the hand afterwards. The options of the automatic eating were incomplete. Fixed with `home_pack` on.
- `!goToBed` took `bedrock` for a bed.
- Six prompt examples taught the model calls that the command parser refuses, or commands that do not exist.
- After the first action that ran into its time limit, every later action was reported as timed out.
- `!stats` wrote the current action onto the line of the time.
- `useDoor` failed when no oak door was near.
- A timer of the movement code opened and closed the nearest door or gate every 1.5 seconds while the bot stood still. The bot could get stuck in a fence gate for good. With the door reflex on, the timer is not used. A bot that makes no progress at a door or gate walks through it in one go and closes it.
- With protected areas on, the path search no longer plans a diagonal step past the corner of a solid block. The bot could not walk such a step and tried it again and again, for example at the corner post of a house.

All bugs in this list came from upstream.

### Known limitations

- Only calls to Claude models are counted. Calls through other providers are not.
- The protection of areas guards against mistakes, not against an attacker: code that sends raw packets to the server passes it. Cheat mode, explosions, fire and other players are not guarded.
- A building is recognised by the blocks a player builds with. A house of plain stone or plain terracotta is not found by the scan. Use `!setArea` for it.
- The bot cannot lead away a creeper that does not follow it. After two tries to be seen it keeps away from it and says so. It then uses a door that is at least 16 blocks from that creeper, or digs in.
- The door reflex does not run while another reflex is active, for example while the bot flees.
- After every respawn the server ignores what the bot does for 3 seconds. The library that connects the bot does not send the message that the server waits for. The first action after a death can be lost.

## [0.1.4.5] - 2026-09-28

Fixes from the first play test, and limits for the skill library.

### Security

- **Text-to-speech could run commands on the computer.** With `speak` on, the reply of the bot was put into a shell command, and only single quotes were escaped. A reply with a double quote, `&` or `|` could run a command. What the bot says is influenced by what other players write in chat. The text is now handed over as data and no shell is used. The bug came from upstream and affected Windows, macOS and Linux.

### Added

- Setting `skill_disable_after_errors`, default `3`. A saved skill that ends with an error this many times in a row is switched off, and the bot is told why. A corrected version under the same name switches it on again, and so does `!enableSkill`. `0` switches this off. A run that returns `false` does not count as an error.
- Setting `skill_max_count`, default `100`. When the skill library has this many skills, new skills are not saved and the bot is told to forget one first. New versions of saved skills are always accepted. `0` switches the limit off.
- Every end of the agent process prints its reason and exit code to the console. Before, some restarts left no trace in the log.

### Changed

- A function that does next to nothing is not reviewed and not saved as a skill: no loop and at most one call of a built-in or saved function. This saves one call to the model.
- The command `!restart` is blocked in the fork's `settings.js`. In the play test the model used it as an answer to a remark of the player. Remove it from `blocked_actions` to get it back.

### Fixed

- `!craftRecipe` ended with a `TypeError` for an item without a crafting recipe, such as `farmland`. It now answers that the item has no recipe.
- The bot restarted 10 seconds after its attempt to get unstuck was interrupted, for example by `!stop`. The timer that ends the process is now cleared in that case.
- The reason for a kick by the server was printed as `[object Object]`. It is now printed as text, for example `multiplayer.disconnect.invalid_player_movement`.
- Text-to-speech failed for every reply that contained a line break.
- Item goals of the NPC system failed for every item without a crafting recipe.
- A skill file could not replace the name `customSkills` in the sandbox in release `0.1.4.4` as long as the first of two protections was active. The second protection now holds on its own as well.
- A skill that contains `import` followed by a comment is refused when it is saved. Before, it was saved and could not be loaded.

All bugs in this list except the last two came from upstream.

## [0.1.4.4] - 2026-09-28

Skills release. The bot can save code that worked as a named skill and call it again later. Skills belong to the bot and are shared by all its worlds. The feature is behind a feature flag and is off by default.

### Added

- **Skill learning**, setting `skill_learning`, default `false`. It needs `allow_insecure_coding`. While it is off, the bot behaves as in `0.1.4.3`.
- **Saving skills**, setting `skill_capture`, default `true`:
  - The coding prompt asks the model to write a task that could be needed again as one function with parameters.
  - After `!newAction` ran such code without an error and without being interrupted, a second call to the model decides whether the task was done and whether the function is general. It sees the code, the output and what changed in the inventory and the position.
  - If both answers are yes, the function is saved in `bots/<name>/skills/` and the bot is told the name of the new skill.
  - A skill is refused if it contains coordinates of the current world, if it uses a constant or a helper from the code around it, if its name clashes with a built-in function, if it has no description, if it is longer than 8,000 characters, or if it contains code that the sandbox does not allow.
  - Writing a function under an existing name replaces the skill. The earlier version is kept in `bots/<name>/skills/.history/`.
- **Using skills**, setting `skill_reuse`, default `true`:
  - New code can call a saved skill as `customSkills.<name>(bot, ...)`. Skills can call each other.
  - The coding prompt lists the saved skills. The ones that fit the task best come with their full description.
  - The conversation prompt lists the saved skills by name, so the bot decides by itself when to use one.
  - Saved skills run in the same sandbox as new code.
  - Every skill counts how often it ran and how often it failed.
  - A skill file that cannot be loaded is skipped. The bot starts without it.
- Commands `!skills`, `!forgetSkill`, `!disableSkill` and `!enableSkill`. They are hidden while skill learning is off. `!forgetSkill` moves the skill to the history folder. It does not delete it.
- Command `!useSkill`, setting `skill_command`, default `false`. It runs a saved skill directly, without writing new code.
- Prompt `skill_review` in `profiles/defaults/_default.json`. A profile can replace it.
- Placeholder `$CUSTOM_SKILLS` for the `coding` and `conversing` prompts of a profile. It sets the place of the skill list. Without it the list is put before the conversation.

### Fixed

- Code written by the model was changed before it ran if it contained a dollar sign followed by `&`, a quote or a backtick, for example `'Price: $'`. The code is now used as written. The bug came from upstream.
- `!newAction` gave up after one attempt when the code could not be prepared for the sandbox, for example because of a syntax error. The error now goes back to the model like any other code error, and the model tries again, up to five times. The bug came from upstream.

### Changed

- With skill saving on, every `!newAction` that ran a new function costs one more call to the model. The call goes to the coding model.
- `bots/<name>/last_profile.json` contains the new prompt `skill_review`, also while skill learning is off.

### Known limitations

- Skills are found by keywords. A skill with a poor description may not be listed with its full description.
- A skill that keeps failing is not switched off automatically yet. Use `!disableSkill`.
- The review relies on the model's judgement. It can save a skill that is less general than it looks.
- Two skill names that differ only in upper and lower case are refused, because they would be the same file on Windows.

## [0.1.4.3] - 2026-09-27

Persistence release. The bot can keep memory and places per Minecraft world, and it no longer restarts an old goal without being asked. World memory is behind a feature flag and is off by default.

### Added

- **World memory**, setting `world_memory`, default `false`. When it is on:
  - The bot recognises the world it joins by the hashed seed that the server sends at login. No configuration is needed.
  - Conversation memory, the current goal and saved places are kept per world in `bots/<name>/worlds/<world key>/`.
  - Places are written to disk on every change. They survive a restart.
  - Every place is stored with its dimension. `!goToRememberedPlace` refuses a place in another dimension and says why.
  - The bot's stats show the world and the dimension. When the bot enters another world it gets a note with the world's name, its last visit and its saved places.
  - On the first start with the flag on, the existing `bots/<name>/memory.json` is copied into the first world the bot joins. The original file is not changed.
- Setting `world_id`, default empty. A name set here replaces the automatic world key. Use it for two worlds that were created from the same seed.
- Commands `!forgetPlace` and `!nameWorld`. They are hidden while `world_memory` is off.
- Setting `resume_goal` with the values `always`, `after_crash` and `never`. The default in code is `always`, which is the behaviour of earlier releases. The fork's `settings.js` sets `after_crash`: a goal continues after a crash, but not when you start the bot yourself.
- Setting `goal_resume_limit`, default `0`, which means no limit. The fork's `settings.js` sets `3`: a goal that was resumed three times within 15 minutes is stopped and the bot says so in chat.
- Reset tool: `npm run bot:reset -- <name>` with `--memory`, `--places`, `--skills`, `--all`, `--world <key or label>` and `--dry-run`. It moves the selected data to `bots/_archive/`. It never deletes anything.
- End-to-end tests against a simulated Minecraft 1.21.8 server: `npm run test:e2e`.
- Launch script `start-claude.ps1` for PowerShell 7. Run it without parameters to start the bot with the claude profile. It reads the API key from the PowerShell secret vault with `Get-Secret`, hands it to the bot as an environment variable and removes it when the bot stops. The key is not written to a file. With `-Log` it also writes everything the bot prints to a log file under `Mindcraft\logs` in the local application data folder. A value for the same key in `keys.json` wins over the environment variable.

### Changed

- Starting the bot with `load_memory: false` no longer overwrites the old `memory.json`. The file is moved to `bots/_archive/` first.
- The bot's folder is created only after its name has been checked. An invalid name no longer leaves an empty folder behind.
- Automatic restarts pass a new argument to the agent process, so the agent can tell a crash restart from a normal start.

### Fixed

- Temporary files that were left behind when the process was killed while writing `memory.json` are removed at the next start.
- The place of death is stored with its dimension.

### Known limitations

- Two worlds created from the same seed get the same key and share their memory. The bot warns when it notices a different world name or a lower world age. Set `world_id` to separate them.
- The bot cannot travel between dimensions by itself.
- A server that hides the seed gets a key derived from the server description, with a warning.

## [0.1.4.2] - 2026-09-27

Foundation release. It fixes problems that were found while preparing persistent memory and the skill library. It adds no learning feature yet.

### Security

- **The code sandbox now works.** `lockdown()` in `src/agent/library/lockdown.js` called itself instead of the SES library, so the lockdown never ran. Code written by the model could reach the Node.js process and through it the file system. The bug came from upstream and existed since June 2025. The lockdown now runs when the agent starts, if `allow_insecure_coding` is on.

### Added

- Setting `sandbox_lockdown`, default `true`. Set it to `false` only if a library stops working with the lockdown.
- Error reporting for the locked-down process. Errors passed to `console.log`, `info`, `warn`, `error` and `debug` are printed with message and stack. Without this, Node.js prints them as `{}` once the lockdown is active.
- Unit tests, 423 in this release. `npm test` runs them, `npm run test:coverage` adds a coverage report. They need no Minecraft server, no network and no API key.
- `CHANGELOG.md`.
- `.gitattributes` that keeps the files in `patches/` with LF line endings on Windows.
- Documentation for eight functions that the model could not use before: `skills.log`, `skills.showVillagerTrades`, `skills.tradeWithVillager`, `world.getNearbyEntities`, `world.getNearestEntityWhere`, `world.getNearbyPlayers`, `world.getVillagerProfession`, `world.shouldPlaceTorch`.

### Fixed

- **Function docs in the coding prompt.** With a profile that has no embedding model, the coding prompt contained 3 of 52 function docs, whatever `relevant_docs_count` said. The docs are now ranked by keywords from the task. `relevant_docs_count: -1` includes all docs.
- Four function docs were unreadable for the model because their comment block ended with `*/`: `skills.useToolOn`, `skills.useToolOnBlock`, `world.isEntityType`, `world.isClearPath`.
- The code check told the model that eight existing functions "do not exist", because they had no documentation.
- `memory.json` is written atomically. A crash during saving can no longer leave a broken file.
- A broken `memory.json` no longer stops the bot for good. The file is renamed to `memory.corrupt.<date>-<time>.json` and the bot starts with an empty memory.
- A failed call to the model no longer replaces the memory with the text "My brain disconnected, try again.". The old memory is kept and the summary is tried again with the next message. If summaries keep failing, the oldest turns leave the context once it holds twice `max_messages`. They are still written to the history file.
- After one failed coding request, `!newAction` answered "no response" until the bot was restarted.
- From upstream `develop`:
  - `!searchForBlock` with a range below 32 failed with a reference error.
  - The bot did not always pick its strongest weapon.
  - The death message showed the x coordinate in place of z.

### Changed

- With `relevant_docs_count: 5` the coding prompt now carries about 4,200 characters of function docs. Before it carried about 2,200, because only the three fixed docs were included.
- An uncaught error in a locked-down agent ends the agent process with exit code 1. The agent is restarted if it had run for at least 10 seconds. This is the behaviour of releases before this one. It is listed because the SES default would have stopped the whole application.

### Known limitations

- Keyword ranking is simple. For some tasks the most useful function is not among the first five. `relevant_docs_count: -1` gives the model all docs, about 26,000 characters per coding request.
- With the lockdown active, errors that sit inside another object are still printed as `{}`.
- This release was tested with automated tests and with a simulated server. It was not yet played in a real game.

## [0.1.4.1] - 2026-09-27

First release of the fork. It makes Mindcraft `v0.1.4` work with Minecraft Java 1.21.8.

### Fixed

- Dependencies are pinned, because `package-lock.json` is not part of the repository and newer versions break the bot:
  - `minecraft-data` 3.98.0, `minecraft-protocol` 1.62.0, `mineflayer` 4.33.0, `prismarine-item` 1.17.0.
  - Twelve `prismarine-*` packages through `overrides`.
  - Newer `minecraft-data` makes the server kick the bot in fights with "Invalid move player packet". Newer `minecraft-protocol` and `prismarine-chunk` crash at start.
- The patch for `minecraft-data` now covers protocol 1.21.8 and both chat packets. Before, sending chat could fail with a range error.

### Changed

- `profiles/claude.json`: model `claude-haiku-4-5-20251001`, system text-to-speech, no embedding model, a conversation prompt with house rules.
- `settings.js`: the Claude profile is active, `load_memory`, `speak` and `allow_insecure_coding` are on.
