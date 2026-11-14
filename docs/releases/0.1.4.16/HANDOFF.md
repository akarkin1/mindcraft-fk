# Handoff v0.1.4.16 "Stability, and three packs"

What each finished part gives to the parts that follow. Where it differs from `SPEC.md`, this file wins.

## Round 1 (2026-11-12 to 2026-11-14): the fixes of the plays (E1, E2, E3; E5's fix round; T3, T4 the scenarios)

| Fix | Where | What the next engineer needs to know |
|---|---|---|
| F1 the creeper reflex | `home/creeper_logic.js` (`countsForBot`: `dBot <= 16`, `\|dy\| <= 3`, sight required; `countsForArea` needs sight too; `clearGroundY`), `home/creeper.js` (`GoalNear` to the ground's y, `maxDropDown` 1), `modes.js` (`result.say !== false`) | The help line is logged every run and said once in 120 s. |
| F2 the survey's base | `survey/survey_logic.js` (`clustersOf`, `startClusterOf`, `leftOutOf`, `xzDistance`, `directionOf`), `survey/texts.js` (`leftOutText`), `survey/survey.js` (`removeFromBases`, `SAID_TEXT`), `world/base_store.js` (`kept`) | `bases.json`: `{ name, centre, dimension, door, surveyed, places, kept }`, `kept` always present. The say-commands (`!surveyBase`, `!renameArea`, `!forgetArea`, `!goToBase`) say their line through `ctx.say` and answer the model `Done; I said it in the chat.`; `agent.js` never says that short answer by `say_results` (B-13). |
| F3 Routines | `routines/routine_logic.js` (`PLAN_PLACE_LINES`, `checkPlan(..., { text, places })`, `HIDDEN_PLACES = ['my_bed']`), `routine_store.js` (`runs`), `job/index.js` (a failed step skipped with a quiet line; `isBusy`), `farming/field_logic.js` (`isCaneName`, `caneColumns`, `isCaneArea`) | A round is done when every step is done or failed and one is done; the stored step state stays `failed`. |
| F4 the farm from inside | `home/shelter.js` `leaveBuilding(bot, ctx)` (also in `ctx.home`), called by the farming pack's `prepare` | Passes the door towards a point beyond it. |
| F5 the mining | `mining/mining.js`, `mine_logic.js`, `mine_player.js`, `texts.js` (`STOP_REASONS.dig_failed`, `stopReasonText`), `bag_logic.js` (`bagUnreachableText`, `isMineChestKind`), `storage/storage.js` (`failedAt`) | Every stop logs `Mining stop: <reason> at (x, y, z), step <step>: <text>`, the way-out failure after a full trip too; a dig cut by `!stop` is `interrupted`; `tripStart` gives `new` on the surface only (B-2). |
| F6 the bed | `home/sleep.js` (`candidateBeds`, `bedExclusion`), `sleep_logic.js`, `JOB_SITE_NAMES` (a pinned copy of the survey's) | The trading hall's box excludes every bed; the job-site and villager rules skip `my_bed` and the beds in a home or an owner's shelter (B-12). `my_bed` is saved when the bot lies in a bed. |
| F7 enchanted tools | `patches/mineflayer+4.39.0.patch` (`enchantsOf(item, registry)` in `digging.js`, exported as `inject.enchantsOf`), `library/way_logic.js` (leaves in a canopy) | The version stays 4.39.0. |
| F8 the clock and the orders | `home/clock_logic.js` (`dayPhase`), `night_logic.js` (`isNight` from 13000 for the labels, `isShelterNight` from 12000 for the shelter and the job resume), `commands/index.js` (`WORK_COMMANDS`, `STOP_COMMANDS`, `orderRefusal`) | The packs' `!breed`, `!enchant`, `!killFarm` are work commands too. |
| F9 the watch's run | `agent.js` (`handleMessage(source, message, { quiet })`, `last_order.quiet`), `watch/queue.js` (the answer with the run id), `watch/tools.js` (the tool `runs`) | Twelve watch tools; the pinned `TOOL_NAMES` table stays at eleven. |
| F10 the caves | `library/skills.js` (`inCave`, the order of the candidates, the fall of 5 with health 12, `caveCarefulText`, the no-way line), `home/motion.js` (`applyKeepOut`), `areas/area_guard.js` (`listAreas`), `mining/mine_logic.js` (the beyond cells), `mining/mining.js` (`sealOpening`, `openingCells` by the wall's own plane, `SEAL_RULES`) | The collect's count is the bot's own breaks only. |
| F11 the smalls | `wood/wood.js` (`toolForBlock`), `areas/area_scan.js` (`hasCoverBesideTrees`), `mining/bag_logic.js` (`isMineChestKind`) | |
| F12 the history | `history.js` (`add` pushes and splices at once, `_summarizeChunk` serialised) | B-5. |
| F13 the login guard | `connection_handler.js` (`log()` to the console only), `restart_context.js` (`CONNECTION_LOST_TEXT`, `isConnectionError`) | |

## Round 2 (2026-11-13 to 2026-11-14): the three packs (E6, E7, E8; T5 the scenarios)

| Part | Where | What the next engineer needs to know |
|---|---|---|
| The wiring | `settings.js`, the settings spec, `agent.js` (`_loadWorkPacks`, `blocked_actions`, the storage pack loads for the three, the wood pack for `afk_kill`), `actions.js` (`BREEDING_OFF`, `ENCHANTING_OFF`, `AFK_KILL_OFF`), `tests/routing/commands.js` (`SHARED_PART_COMMANDS` for `!allowTaking`) | The budget: +1,300 (`LIMIT_ALL_ON` 19,795, `LIMIT_NEW_THINGS` 20,195, `st_glue` 20,595); off 11,000 unchanged. |
| The permits | `world/stock_permits.js` (`StockPermits`: `may`, `allowedAt`, `set`, `list`, `entry`), `breeding/stock_logic.js` (`takeOrAsk(bot, ctx, item, count, { low, purpose })`), `ctx.permits`, `ctx.stock` | `!allowTaking` refuses a permit the model or a routine gives itself. |
| Breeding | `packs/breeding/` (`FEED`, `PEN_CAP` 12, `fenceBoxOf`, a pinned copy of `findGates`) | The bot goes to the ring cell nearest the next adult; the cooldown counts from the last birth; the stop is checked every 500 ms. |
| Enchanting | `packs/enchanting/` (`enchant`, `enchantTake`, `questionWaits`; the window's own slots; the offers polled; no offer = cost 0, enchantment -1; one re-put) | The anvil is not built. |
| The AFK kill | `packs/afk_kill/` (`killFarm`, `KILL_SPOT`, `KILL_CHEST`, `KILL_BED`, `KILL_EXIT`, `usesLeft` a pinned copy), `job/job_store.js` and `job/index.js` (the kind `kill_farm`: `KILL_FARM_KIND`, `killFarmJob`, `killFarmResume`) | A stop by anything but `!stop` resumes after 60 s; the kill check counts landed hits; plain block names (not the mining reader). |

## Open for the next engineer

- B-8: a mine made from a forgotten tunnel knows no way out; a bot in its own deep 1 x 1 hole cannot walk home from
  far away. Both older than this release, candidates for 0.1.4.17.
- `route_joined` (W95) stalls once in a while for 117 s one cell from shaft 2's hole and passes alone.
- The breeding cooldown is covered by `xy_breed` only (W134 never waits 5 minutes).
- The play of 2026-11-14 (ROADMAP M-1 to M-4, M-7, M-8) waits for the owner's word.
