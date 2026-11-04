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
