# Handoff v0.1.4.14 "Minecraft 26.1"

What a finished part gives to the parts that follow. Where this file and `SPEC.md` disagree, this file wins.
Written by the lead after each round from the engineers' reports. The decisions of the round are in
`DECISIONS.md` (R1-1 to R1-16).

## Round 1 (commit 912e75c): L, D, K, H, T

Node 22 and Java 25 are the floor from this commit on: `npm install` refuses Node below 22 (`engines`), the
world tests refuse a Java below 25 with one line and exit 1. In this container: `fnm` is not used; the Temurin 25
JRE is at `~/.local/share/mindcraft/test-server/jdk/jdk-25.0.5+8-jre/bin/java` and the runner finds it when
`MC_TEST_JAVA` is unset (`MC_TEST_JAVA=/usr/bin/java` is Java 21 and is refused now).

### Part L, the libraries and the patches (E1)

| Gives | Where | Note |
|---|---|---|
| mineflayer 4.39.0, minecraft-protocol 1.68.0, minecraft-data 3.119.0 and the 12 pins of SPEC 4.1 | `package.json` (`dependencies`, `overrides`, `engines.node >= 22`) | `package-lock.json` stays ignored (R1-5). A clean `npm run reinstall` applies 7 patches with no warning |
| `patches/mineflayer+4.39.0.patch` | 6 hunks | `bed.js` wake writes `'stop_sleeping'` from 1.21.6 on (R1-1); `physics.js` sprint writes `'start_sprinting'`/`'stop_sprinting'`, elytra `'start_fall_flying'`; `digging.js` maps `incorrect_for_wooden_tool` to `mineable/pickaxe` before `digTime`; `entities.js` takes the velocity of `entity_velocity` and `spawn_entity` as it is with `bot.supportFeature('entityVelocityIsLpVec3')` (R1-3); `place_block.js` timeout 500 ms (R1-4) |
| `patches/minecraft-protocol+1.68.0.patch` | 2 hunks | The chat checksum, as before, at the new lines |
| `patches/prismarine-physics+1.11.1.patch` | 2 hunks | The 10 trapdoor kinds; `climbableTrapdoor` with `"1.21", "26.1"` (R1-2) |
| Dropped | `minecraft-data+3.98.0.patch` | The explosion doubles are upstream since 3.117.0 |
| `player_loaded` | `src/agent/agent.js` | Our send is gone; mineflayer sends it at every spawn (`health.js`, feature `sendsPlayerLoadedPacket`, R1-6). The 3.5 s wait of `startAgent` and the 4 s of the teacher stay as margins |
| Node 22 | `start-claude.ps1`, `start-gpt.ps1` (`fnm use 22`), `CLAUDE.md`, `docs/SUPERVISOR.md`, `.claude/skills/supervise/SKILL.md` (`fnm exec --using=v22`) | |

Proven on a real 26.1 server (the lead's scratchpad, `e1/prove.log`): a bot sleeps and `bot.wake()` gets it up in
51 ms; a second bot sees the sprint flag of the first 51 ms after `setControlState('sprint', true)` and sees it
clear; the old id 3 written by hand starts no sprint (the regression was real). Tests: `xl_entity_action` (9),
`wg_spawn`, `wg_wake`, `rta_physics_patch`, `st_process`, `stf_chat_checksum`, `xk_explosion_packet` updated.

Behaviour that changed against 1.21.8 without a switch, all corrections of library defects: the bot gets out
of bed by itself again, the server knows when it sprints, a hit knocks it back on 26.1, iron ore takes 750 ms
instead of 4,550 with an iron pickaxe on 26.1.

### Part D, the data of 26.1 (E2)

| Gives | Where | Note |
|---|---|---|
| Copper is a pickaxe material | `ore_table.js` `PICKAXE_LEVELS.copper = 1`, `PICKAXE_USES.copper = 190`; `mine_logic.js` `PICKAXE_MATERIAL_ITEMS.copper = 'copper_ingot'` | `pickaxeMaterial('copper_pickaxe')` is `'copper'`; `pickaxeToCraft` never returns copper (a need of copper is tier 1: stone) |
| `COPPER_CHESTS` (8 names), `CONTAINER_KINDS` = the 3 old kinds + 8 | `src/agent/packs/storage/storage_logic.js` | Also in `look_logic.js` `CHEST_BLOCKS`, `mining.js` `CONTAINER_NAMES`, `bag.js`, `area_sense.js`, `area_scan.js`, `area_guard.js`, `stand_logic.js`, `field_logic.js` (imported, or copied with a drift test, R1-11); `MATERIALS` has `copper` between stone and iron |
| `VANILLA_FOODS` of 26.1 (44 rows), `isBucketName(name)` | `food_logic.js` | The 4 fish buckets are in the table and never chosen: `isEdibleFood`, `chooseKnownFood`, `storeKinds` of `bag_logic.js` and the `bannedFood` list of auto-eat refuse a `_bucket` name (R1-10). The saturation values were 2 × points × the new ones: the food order is unchanged |
| `copper_golem` is not hostile | `mcdata.js` `isHostile`, `night_logic.js` `NOT_HOSTILE_FOR_SHELTER` | `isHostile` reads `mob.type`; `parched` is `hostile` there, the golem is `mob` (R1-9) |
| `chain` | nothing | `THIN_BUILT_PARTS` matches by substring: `iron_chain` and `copper_chain` are covered |
| `COPPER` of the wood pack (the lead, from E2's finding) | `src/agent/packs/wood/tool_logic.js` | Like `GOLDEN`: known, never crafted, level 1, 190 uses, ranked between stone and iron by `bestTool`; a need of copper chooses stone |

### Part K, what the model does not know (E2)

| Gives | Where | Note |
|---|---|---|
| `NEW_THINGS` (14 entries `{ names, since, line }`), `NEW_THINGS_LIMIT` 3, `NEW_THINGS_BLOCK_RANGE` 8, `NEW_THINGS_ENTITY_RANGE` 16, `thingKey(name)`, `newThingLines({ inventory, near, lines, limit })`, `nearThingNames({ reader, center, entities })` | `src/agent/knowledge/new_things.js` | Pure; `nearThingNames` reuses `scanBox` of `look_logic.js`. Plurals and family words (`shelf`, `spear`, `copper chest`) match; the effect is `BreathOfTheNautilus` as the registry spells it (R1-8) |
| `NEW_THINGS_HEADER`, `NEW_THINGS_MAX_CHARS` 360, `NEW_THINGS_MAX_LINES` 3, `newThingsText(lines, maxChars)` | `src/agent/knowledge/knowledge_text.js` | The 360 count includes the header and the breaks; a line that does not fit is skipped (R1-7) |
| `newThingsOf(agent, messages)` | `src/agent/prompter.js` | The bag (`bot.inventory.items()` and slot 45), the view (the scan within 8, `bot.entities` within 16, a dropped item by its item name), the last 3 turns and the last `!command`; the block goes after the knowledge block on both paths. With the switch off the prompt is byte for byte as before (a test) |
| `new_things_in_prompt` (false) | `settings.js`, `settings_spec.json`, after `prompt_cache` | The prompt-size tests allow 17,400 with the block (largest measured 17,342) and 17,000 without |

The header in the prompt: `NEW SINCE 1.21.8 (true, even if you do not know it):`.

### Part H, Claude Haiku 5.5 (E2)

| Gives | Where | Note |
|---|---|---|
| `"model": { "model": "claude-haiku-5-5", "params": { "max_tokens": 4096, "output_config": { "effort": "low" } } }` | `profiles/claude.json` | 4096 is the default of `claude.js`; `output_config` reaches the API through the spread of `params` (SDK 0.17.2); thinking tokens are counted by the meter as output (R1-12) |
| `'claude-haiku-5-5': { input: 0.1, output: 0.5 }` | `src/agent/cost/price_table.js` | |

### Part T, the test setup on 26.1 (E3)

| Gives | Where | Note |
|---|---|---|
| `VERSION '26.1'`, `JAR_NAME`, `JAR_SHA1`, `JAR_SIZE 60417588`, `MIN_JAVA 25`, the `--jdk` step | `scripts/get_test_server_logic.js`, `scripts/get_test_server.js` | `--jdk` downloads the Temurin 25 JRE (Linux x64, Windows x64) into `<dir>/jdk/` after the jar and the EULA, checked against the SHA-256 of the Adoptium API (R1-15) |
| `DEFAULT_JAVA` (`java-runtime-epsilon`), `chooseJava`, `locateServer(env, platform, versionOf)` with `{ refused }` | `tests/world/mc_server.js` | `MC_TEST_JAVA` first and alone when set; else the launcher's Java if 25 or newer, else `<dir>/jdk/*/bin/java`. `white-list=false`, `enforce-whitelist=false` in the properties |
| `GAMERULES_26_1`, `consoleCommand26(cmd)`, `answerLine26(line)` | `tests/world/mc_server.js` | 26.1 renamed the game rules and the daytime query; `commands` of the scenarios is translated and counted, one summary line per run (R1-13). **New scenarios use the 26.1 names**: `gamerule advance_time false`, `time query minecraft:day` (answer `Timeline minecraft:day is at N tick(s)`), `time set` answers `Set minecraft:overworld to N tick(s)` |
| The world defaults in 26.1 names | `tests/world/run.js`, `tests/play/run.js` | |
| `version: '26.1'` | `tests/world/helpers.js` (the player), `tests/helpers/xt_bot.js`, `st_modes_env.js`, `st_glue_env.js`, `tests/e2e/helpers.js`, `tests/e2e/run.js`, `scripts/dump_region_logic.js` | |
| The simulated server | `tests/e2e/fake_server.js` | `update_time` carries `clockUpdates` per dimension (R1-14); every other packet is the same as on 1.21.8; the 17 end-to-end scenarios pass |
| `xe_test_setup` (28), `xp_wear` by name | `tests/unit/` | The only literal ids were the 3 lines of `xp_wear` |

Real-server runs of the round: `owner_base` (12 to 13 s), `sleep` (16.7 s, "I slept. It is morning.") on the 26.1
server with the Temurin JRE, after the reinstall with the new patches.

### Known issues after round 1 (SPEC 4.8)

- mineflayer 4.39.0 `time.js` reads the clock of the End as 0 (the bot does not go there).
- The end-to-end helper logs `_shareRuleStore is not a function` (pre-existing, the scenarios pass).
- About 40 scenario lines, `journey.js` and `tests/play/play.js` use the 1.21.8 rule names; the harness translates.
- About 40 unit files load the 1.21.8 registry directly; they work with minecraft-data 3.119.0 (T1 moves them).

### Round 2: what T3 and T1 build on this

- T3 writes `tests/world/w121_copper_age.js` (SPEC 4.5) with the 26.1 console names; a copper pickaxe worn to
  12 uses is `give <bot> minecraft:copper_pickaxe[minecraft:damage=178] 1` (190 uses); the copper chest is
  `minecraft:copper_chest` (or an oxidized or waxed variant); the prompt lines come from
  `s.chat.requests[].prompt` as in W119; knockback with a hitter bot as in the lead's `mf261/test/bot-test.js`.
- T1 writes `tests/unit/xt26_*.test.js` from the spec (SPEC 6): the data facts of 4.3 against the 26.1 registry
  by name, the patch facts of 4.2, the prompt block of 4.7 (the exact lines), the Java rule of 4.4, the profile
  of 4.9; and moves the unit files that load `'1.21.8'` to the 26.1 registry where the test is about the bot's
  data (a test about the history of 1.21.8 keeps its version with a comment).
- The lead runs `journeys journeys13 copper_age creeper_in_sight` on 26.1 twice (SPEC 6).

## Round 2 (commit 4bd2780): the tests from the spec, W121, the first gate run and its fixes

### T1: the tests from the spec and the registry sweep

| Gives | Where | Note |
|---|---|---|
| `xt26_libraries` (4.1, 4.2), `xt26_data` (4.3), `xt26_setup` (4.4), `xt26_new_things` (4.7, reads SPEC.md), `xt26_model` (4.9), `xt26_rules` (25 to 27) | `tests/unit/` | Each describe names its spec section; `xt26_data` found the path finder's copper chests (R2-1) |
| `TEST_MC_VERSION` (`'26.1'`) | `tests/helpers/load.js` | 46 unit files load the registry through it (R2-3); the files that compare the versions keep `'1.21.8'` with a comment |

### T3: W121 "the Copper Age"

`tests/world/w121_copper_age.js`, registered as `copper_age` (base world, 1200 s, no group). Parts A to E of SPEC
4.5 as corrected in R2-5. Passes twice on the real server with the chest fix (R2-4); the numbers: 6 raw_iron in
24 s with the copper pickaxe worn to exactly 10 uses and a stone spare made from 3 cobblestone; 8 bread taken from
the copper chest at (401, 41, 2); the beef eaten first at food 4, the bread and the cod bucket kept; the prompt block
with the copper line, then with the spear line, then without; a hit moves the bot 1.1 to 2.0 blocks; iron ore in
about 770 ms with the iron pickaxe.

### The fixes of the first gate run (the lead's runs: journeys 27 of 30; `sleep`, `spawn_and_bed`, `copper_age`)

| Finding | Fix | Where |
|---|---|---|
| The path finder let the bot stand on or break a copper chest (R2-1) | the 8 names in `noStandNames` and `blocksCantBreak` | `patches/mineflayer-pathfinder+2.4.5.patch` (E1) |
| The bot could not open a copper chest (R2-4) | the 8 names in `allowedWindowTypes` of `chest.js`; `xl_copper_chest_window` | `patches/mineflayer+4.39.0.patch` (E1) |
| The explosion event never fired: the packet of 26.1 has `center` (R2-8) | `explosionCenter(packet)` of `events_logic.js`, both shapes; `xd_explosion_26` | `src/agent/watch/` (E2) |
| The console's count answer changed: `Test passed. Count: N` (R2-9) | `answerLine26` restores the old words; the summary line counts commands and answers | `tests/world/mc_server.js` (E3) |
| A table craft of several resolved before the server's correction, and the server could make fewer than asked (R2-10) | `craft.js` syncs the window and lets it settle after each unit (at the table and in the 2x2 grid), checks the count made; `xl_craft_one_at_a_time` | `patches/mineflayer+4.39.0.patch` (E1). Crafts take about 0.3 s per unit on 26.1 now |
| A craft in the 2x2 grid right after a furnace window closed left the planks on the cursor and every later craft failed: one `stateId` for all windows (G-4) | `inventory.js`: a click on another window than the one of the last `stateId` fetches that window's state first; `xl_state_id` | `patches/mineflayer+4.39.0.patch` (E1) |
| `job_comes_back`: the walk up the learned route stuck at the top of ladder 2: the taught route recorded the top stand cell one block up in the air (G-6) | `standingEntry` of `ladder.js` lowers it onto the floor when the route is walked; `xl_ladder_top` | `src/agent/packs/mining/ladder.js` (E4) |
| `place_from_sentence`: the pen's gate stayed open after the bot walked out: the click waited for a clear block around the gate while an animal stood beside it (G-9) | `doors.js`: the click uses the watch's rule; a fence gate is held only by somebody in its bar; `xl_gate_chicken` | `src/agent/packs/home/doors.js` (E4) |
| `unsaved_pen`: the gate opened by the follow stayed open while the bot stood inside: the reservation of `openTowardPlayer` was never handed back (G-11) | `src/agent/library/toward_doors.js`, `releasePassedToward` in the follow loop and at the walks' end; `xl_toward_doors` | (E4) |
| `ladders_native`: the stall under the open trapdoor was the server teleporting the bot back from a move a rounding error into the floor block (G-12) | `aabb.js` of prismarine-physics stops a move at a face the box is less than 1e-7 past; `xl_aabb_touch` | `patches/prismarine-physics+1.11.1.patch` (E4) |
| `ten_minutes` part C: the bed walk from the door failed: the shelter walk took the learned route "basement" into the area box and the bed walk stuck climbing back through the trapdoor (R2-13) | `isRouteWithinArea` of `shelter_logic.js`: a route within the area is never a way into it; `xd_shelter_route` | `src/agent/packs/home/` (E2) |

The probes of E1 (the scratchpad of the lead's session, `e1/prove_inventory.js`, `e1/craft-26.1-*.log`): a container
window (furnace, chest) does not update `bot.inventory` until it is closed, on 26.1 and on 1.21.8 alike; nothing in
the bot reads the bag while a window is open.

## The gate (commit 26d0939)

A fresh clone on Node 22.23.4: the 7 patches apply with no warning; unit 8,690 tests (8,688 pass, 2 skipped);
end-to-end 17 of 17; the full world set on the 26.1 server 44 of 44 in 4,175 s (G-13). The four full runs
before it (42 of 44 each, with different failures every time) and what they found are G-1 to G-12.

## The play of 2026-11-07 (parts 4 to 7 of the fix round)

The owner's first play on a new 26.1 world (DECISIONS P-1 to P-16). The gate could not see these: the test base is a
hand-built flat world, the owner plays on a generated one. E3 added the world type `natural` (seed 8675309, a forest
spawn, structures off; the server places some trees of the seed differently per run, so a scenario reads the trees of
its own run with `treesNear` and never names a tree by position) and T3 wrote W122 "a fresh world" on it, which failed
as the owner saw it before the fixes and passes 5 of 5 after them.

| Finding | Fix and its test | Files |
|---|---|---|
| The job and the exit note of the old world resumed in the new one (P-1) | the job store is bound at spawn to `bots/<bot>/worlds/<seed>/job.json`, the exit note read and written there; `xl_job_per_world` | `src/agent/job/`, `src/agent/agent.js` (the lead) |
| `!givePlayer` refused more than 8 of a kind (P-2); the stack landed 6 blocks behind the bot because the toss went out in the same tick as the look (P-14) | the give gives what is asked, a stack at a time, the kit rule a hint; the look at the feet, two ticks, the toss from 1.5 blocks, a second toss from 1 block after a miss; `xd_give_collect` (19) | `src/agent/library/skills.js`, `way_logic.js`, `skill_texts.js`, `repeat_guard.js` (E2) |
| Natural oaks were "no tree" (P-3, P-7): the rest of a cut trunk hangs, a fallen trunk lies, a corner touch joined a row to a standing oak (P-13) | `judgeHanging`, `fallenRow`, `splitFallenRows`, `whyNoTree`; the no-tree answer says what was seen; `wood_tree_logic`, `wood_chop` | `src/agent/packs/wood/tree_logic.js`, `texts.js` (E4) |
| Logs of cut trees stayed under the crown (P-12) | `sweepTree` walks the tree's cells and steps into a `pickupStands` stand for every drop; honest count | `src/agent/packs/wood/wood.js`, `src/agent/packs/home/pickup_logic.js` (E4) |
| A forest read as "a walled yard with a roof" (P-4, P-8) | trunks are no wall, crowns no hedge and no roof, a yard's roof must be built, a wall ring mostly built; `xl_natural_terrain` (7) | `src/agent/areas/area_scan.js` (E4) |
| The bot's own empty chest could not be collected (P-5); its item was lost after the break (P-16) | `collectOwnContainer`: the placed empty container is taken, a full one or another's refused with the reason; the item from a `pickupStands` stand | `src/agent/library/skills.js` (E2) |
| `Recipe requires craftingTable` when the one cell did not take the table (P-15) | `placeCraftingTable` tries 8 cells; `I could not place my crafting table here.`; `xd_craft_table` (5) | `src/agent/library/skills.js` (E2) |

The pure helper `pickupStands` lives in the home pack with the other shared helpers (`box_math.js`, `food_logic.js`):
packs never import the library (P-10). The bot works with 26.1.1 and 26.1.2 too, proven on a 26.1.2 server (P-11); the
test server stays `server-26.1.jar`.

## The final gate (commit 9e4ff1f)

A fresh clone on Node 22.23.4: the 7 patches apply with no warning; unit 8,747 tests (8,744 pass, 3 skipped: the
third is the comparison with `origin/main` in `nv_words`, absent in a single-branch clone); end-to-end 17 of 17; the
full world set on the 26.1 server with `natural_smoke` and `fresh_world` 46 of 46 in 4,403 s (G-14).

## The play of 2026-11-09 (fix round, part 8)

The owner's play of 9e4ff1f on his machine found 15 more things (DECISIONS P-17 to P-31, P-32 as context), led by
the bot's clock standing still in a boat. The spec of the round is SPEC.md section 8; E1, E2, E4 and the tester T3
built it in one day with three cuts by the usage limit.

| Finding | Fix and its proof | Files |
|---|---|---|
| The clock froze in a boat (P-17): 26.1's per-second packet carries only the age, the clock state comes on login and `time set`, and mineflayer advanced the clock on `physicsTick`, which stops while riding, dead or in an unloaded chunk | the patched `time.js` runs the clock on its own 50 ms timer; riding 30 s: 1 tick from the server (613 behind before); standing: worst 2 ticks; `time set` within 1 s; `xl_time_runs` (15), `xl_day_marks` (8), the end-to-end `s18_night_falls` (fails before), W123 with a riding part | `patches/mineflayer+4.39.0.patch`, `src/agent/clock_logic.js`, `agent.js` (E1) |
| Farms without a fence, the house a pen (P-18) | `open_farm.js` (pure) finds the connected farmland; a typed kind wins (the parser's default is `auto`; a typed kind with nothing found saves nothing); pets are no livestock; the border decides a pen (fence) from a building (wall), roof or not; `xl_open_farm_pets`; W124 | `src/agent/areas/open_farm.js`, `area_kind.js`, `area_scan.js`, the `rememberArea` block of `actions.js`, `farming.js` (E4) |
| Tunnels on long walks, snow, ice (P-19) | the destructive fallback only within 32 blocks and never below the start level or into water (`xd_way_fallback`); snow by hand (`xl_snow_by_hand`); the climb from water onto ice measured from the surface (`xl_ice_from_water`); W125 | `skills.js`, `way_logic.js` (E2); `patches/mineflayer-pathfinder+2.4.5.patch`, one line of `skills.js` (E1) |
| `I broke 2 black_bed and got nothing.` (P-20) | the count is of the blocks gone; the refusal text names the rule; the placed store covers beds (`xd_collect_count`, `xl_placed_bed`) | `skills.js` (E2), `area_guard.js` (E4) |
| The 400 "assistant message prefill" (P-21) | the turns end with the `_` filler when the last is the assistant's (`xl_closing_turn`); the race behind it is in the roadmap for 0.1.4.16 | `src/models/claude.js` (E1) |
| `respondFunc is not a function` (P-22) | a page line is kept until the bot can answer (`xl_page_line_kept`) | `mindserver_proxy.js` (E1) |
| Pits and the frozen ocean as yards (P-23) | a pit that sees the sky is no building; water bounds a yard only up to 20 x 20 and never open water (`xl_natural_terrain`, 12) | `area_scan.js` (E4) |
| Beds on a pillar (P-24) | `bed_logic.js` (pure) and `bed.js`: two level cells, a stand beside, within 4 blocks (`xl_bed_place`); W125 | `src/agent/packs/home/bed_logic.js`, `bed.js`, `actions.js` (E4) |
| The give into the water (P-25), the kill drops (P-26), the reflex in a boat (P-27), the commands (P-28), the sprint (P-29) | a dry side first; `pickUpKillDrops` from the pickup stands; the unstuck mode quiet with `bot.vehicle`; `!boardBoat`, `!leaveBoat`, `!leaveGame` (the prompt budget raised by 200 for their docs); `maySprint` in `food_logic.js`, the long-way line; `xd_kill_give`, `xd_ride_quiet`, `xd_boat_leave`, `xd_run_rules`; W125 | `skills.js`, `skill_texts.js`, `modes.js`, `actions.js`, `food_logic.js`, `motion.js` (E2) |
| The watch tooling (P-30) | `You have reached` ends a success; `bagItems` reads the bag through an open window for the `inventory` tool, the digest and the prompt (`xl_reached_is_success`, `xl_bag_live`, `xd_bag_prompt`) | `watch/queue.js`, `watch/digest_logic.js` (E1), `full_state.js` (E2) |

The suites with every change in: unit 8,906 tests (8,904 pass, 2 skipped), end-to-end 18 of 18 (the new
`night_falls` among them); on the server, against the worktree, W123 passes with the boat (the clock within 2
ticks riding and standing; `!leaveBoat` after E1's dismount fix), W124 36 of 36 (the home with cats, the typed
building, the open farm harvested, the roofed pen a pen) and W125 35 of 35 (the bed on the slope, the give beside
the pond, the kill drops, the snow by hand, 60 blocks with no dig), each failing before on the owner's exact
findings; the older scenarios W06, W07, W09 and W10 pass with the typed kind (W07's farm text is the new one, W10
types "home"). The scenarios W123, W124 and W125 join the gate's set.

## The gate after part 8 (commit ebdd9a4)

A fresh clone on Node 22.23.4: the 7 patches apply with no warning; unit 8,906 tests (8,904 pass, 2 skipped);
end-to-end 18 of 18; the full world set on the 26.1 server with `natural_smoke`, `fresh_world`, `night_falls`,
`open_farm` and `open_ground` 49 of 49 in 4,802 s (G-15).
