# Decisions v0.1.4.13 "Supervision"

The defects and open points the tests found, with the decision and who made the correction. The play of
2026-10-04 that the release corrects is in `PLAN.md` section 2.

## Round 1 (08675a0)

| Id | Finding | Where | Decision | By |
|---|---|---|---|---|
| R1-1 | F10 of v0.1.4.12, the creeper heap crash, was not in the fork's code: the 1.21.8 server writes the explosion's player knockback as three doubles, `minecraft-data` 3.98.0 read three floats, so the y float was the low mantissa word of the x double, now and then 5·10^14; mineflayer added it to the velocity and the next physics tick walked a bounding box of that height in one synchronous call. Found with a watchdog that paused the blocked process through its inspector (`scripts/profile_creeper.js`). | `patches/minecraft-data+3.98.0.patch` | The patch takes `vec3f64` (1.21.6 and 1.21.8) as upstream 3.117.0 does; no version bump. 13 runs before: 1 crash; 36 after: 0, peak 255 MB. The play test must remove `node_modules\minecraft-data` before the install. | E2 |
| R1-2 | Three journeys failed on texts while the facts held: W114's supply text named `a second stone pickaxe` while an iron one was made; W112's check wanted the bread chest alone in the supply line; W113 expected a plan where `!getTool` already leads through the smelt in one call, and looked for the placement text as a line of its own. | `packs/mining/texts.js`, W112, W113, W114 | The spare's text names no material (`a second pickaxe`); W112 finds the bread entry among several chests; W113 finds the placement inside the result line and asks for the plan texts only when a plan was made; W114 takes the spare made before the trip as the replacement. | lead |
| R1-3 | W109 with `wait any`: the position changes at every step of a mining job, so 6 wakes are impossible. | W109, part S | W109 waits for `done`; `wait any` ignores the position, the inventory, the job's count and the uses left; a reflex is no running command. | T3, E1 |
| R1-4 | `run` answered `started` without the period; the digest showed a reflex as the running command and a `Last job` line. | part S | Fixed to the spec. | E1 |
| R1-5 | After the owner's `!stop` the leave text said `0 of 6` while the skill said `2`. | part P | The leave text waits for the skill's last count; the pack reports after every ore. | E3 |
| R1-6 | W112: the owner's climb to the basement for bread did not reproduce black-box (v0.1.4.12 already takes bread from a chest it sees within 11 blocks). | W112 | W112 gates the supply text and the facts; the correction of P1 stays (the nearby chests first). | T3 |

## Round 2 (83e06fa)

| Id | Finding | Where | Decision | By |
|---|---|---|---|---|
| R2-1 | W117 ordered `!goToMine("deep")`, but the command takes an ore: the spec's error. | W117 | `!goToMine()`: bot B knows one mine, the shared "deep". A mine's name as the argument of `!goToMine` is a candidate for v0.1.4.14. | lead |
| R2-2 | W116 part 2: the player stood at the far fence; the bot followed round the outside within 3 blocks and never needed the gate. | W116 | The player stands in the middle of the pen. | E4, lead |
| R2-3 | T1: the queue answered `started` for any command still running at 2 s (a walk's failure never reached the supervisor). | part S | `started` only for `!mineOre`, `!farmCycle`, `!followPlayer`; every other command answers with its result. | lead |
| R2-4 | T1: the spec's own help example (`... or tell me to dig a new mine.`) gave no help event: `Tell me` was case-sensitive. | part S | `tell me` in any case. | lead |
| R2-5 | T1: the job's count after a resume stayed at the base. | T1's fake | The fake's `executeCommand` returned before the command ended; with the real order (the command runs while the pack reports) the count is 10 of 28. The fake waits now. | lead |
| R2-6 | `reply` blocks up to 20 s while a bot speaks (the hold rule), against rule 21 (a tool answers within 2 s). | part N2 | Accepted: the answer `Dropped: the bot was speaking.` needs it. The scripted supervisor waits 25 s for `reply`. | E5, lead |
| R2-7 | Claude Haiku 4.5 caches only a prefix of 4,096 tokens or more; the fixed part of the owner's prompt is about 3,800 to 4,350. | part M | Shipped as is; the cost meter shows whether Haiku caches. The prompt with the changing part in the last message (the history then caches too) is a candidate for v0.1.4.14. | E6, lead |
| R2-8 | The older give test gave 44 wheat; the kit rule of Q5 refuses more than 8. | `nw_surface_give` | The test gives 8. | lead |
| R2-9 | Q3: the two ladder places of the play (the landing at level 30, the ladder under the basement trapdoor) did not reproduce in the base; the second ladder's gap of the way out did and is fixed. | part Q | The two play places stay open; in the known limitations of the changelog. | E4 |
| R2-10 | Q9: the mining already digs every ore it exposes; the plan's "off: only the ore asked for" would change v0.1.4.12's behaviour with the switch off. | part Q | `mine_other_ores` adds the count of the other ores to the end text; off is as before. | E4 |

## The gate in the fresh clone at 83e06fa, 2026-10-04

Unit: 8,405 tests, 8,404 pass, 0 fail, 1 skipped. The world set: the ten journeys of this release, the 30 of v0.1.4.9 to v0.1.4.12 and `creeper_in_sight` twice: 40 of 41 in 3,826 s. The one failure, W101 `watch_events` step 4, asked for the stream `events --follow` that part S replaced by `wait`; its helper now starts `--follow` (a loop of `wait any`), and W101 passed alone in the same clone (75 s).

## Round 3: the owner's requests on PR #21

| Id | Request | Where | Decision | By |
|---|---|---|---|---|
| R3-1 | The supervisor runs in a session on the owner's machine. | `.mcp.json`, the skill, `docs/SUPERVISOR.md` | The MCP server `mindcraft` comes from the repository's `.mcp.json`, `http://127.0.0.1:8090/mcp` by default. | lead |
| R3-2 | No token and no tunnel on one machine. | `watch_local_only` (off by default) | No token; a request with tunnel headers, a host other than the machine's own, or a POST that is not JSON is refused. A token, if set, is still checked. | lead |
| R3-3 | The best food, not bread only; the decisions of the supervisor by the situation. | the skill | A food order (steak first) and a section "How you decide": the options, safety, then the cost to the owner, then the goal. | lead |
| R3-4 | The cheapest pickaxe that is enough. | `supply_logic.js` `pickaxeToCraft`, `mining.js`, `wood/tools.js` | A worn pickaxe is replaced by stone for stone, coal, copper, iron and lapis; iron only for diamond, gold, redstone and emerald, or when no cobblestone is there. W114 adapted. The first pickaxe of a trip is a candidate for v0.1.4.14. | E (engineer), lead |
| R3-5 | Down is fine when the way is safe. | `way_logic.js`, `ladder_shaft.js`, `skills.js` `goToPosition`, `digDown` | Deeper than 3 blocks a shaft gets a ladder on every block when the bag holds the depth plus 2 ladders; without them a refusal that names the count. W115 adapted (part A refusal, part A2 with 30 ladders). | E (engineer), lead |
| R3-6 | `wait done` did not wake on the owner's line to the supervisor. | `digest_logic.js` `wakeReason` | A new event wakes every wait. | lead |
| R3-7 | W115 part B, 1 run of 2: a walk over the owner's drops took them after the leave text. | `drop_watch.js` `deathNearBot`, `modes.js` | The item mode takes nothing within 8 blocks of a recent death of another player. A later failure of the check had the bot right (nothing taken, the text once): the death had scattered the boots 5.1 blocks away, so W115 counts the drops within 8 blocks. After it W115 passed 5 of 5 runs, W114 1 of 1. | lead |

The unit suite after round 3: 8,441 tests, 8,439 pass, 0 fail, 2 skipped. The `!digDown` description was cut to keep the conversing prompt with every switch on under 17,000 characters (16,987).

## Fix 1: the play of 2026-10-05

The owner's play with a supervisor: 1 h 50 min, 38 of 37 diamonds stored, 2 of 32 raw iron, 1 death in a cave, the
process restarted 4 times, 811 lines of the bot in the chat. The data: the bot's log, the server's log, the bot's
memory and histories (not in the repository).

| Id | Finding | Cause | Decision | By |
|---|---|---|---|---|
| F1-1 | 811 lines of the bot in the owner's chat in under 2 hours; the chat covered the screen. | The supervisor's `run` hands its commands to `agent.handleMessage(owner, ...)`: 236 echoes `*MartyByrde2 used X*`, 155 results. 35 lines were the supervisor's own. | A command of `run` and the line of `say` run quiet (`chat_gate.js`, AsyncLocalStorage): `openChat` writes `[quiet] ...` to the log; the watch still records the line, so the digest has it. | lead |
| F1-2 | Code in the chat, 24 dumps up to 312 characters, spoken by the voice. | The result of `!newAction` starts with `Agent wrote this code: ...`. | `chatText` leaves every code block out of a line of the chat; the model's history keeps it. | lead |
| F1-3 | 3 kicks `chat_validation_failed`. | Each time generated code called `bot.chat` several times in a row; none of about 800 whispers did. | `bot.chat` and `bot.whisper` inside generated code go to the code's output; a server command still goes out. | lead |
| F1-4 | The process ended at 03:27, `Infinite action loop detected`. | A `run` of 10 quick commands (repeated `!putInChest`, `!craftRecipe("torch", 1)`) started 6 actions within 20 ms each. | The loop guard does not count quiet actions; a run is bounded to 10 commands, each after the last one's result. | lead |
| F1-5 | `!stop` through `run` answered `Ran 0 of 1.` | It waited in the queue behind the running skill. | `!stop` first in a run stops at once, as the owner's typed one; the rest of the call runs after it. | lead |
| F1-6 | The supervisor reported routine work; used `!collectBlocks` and code near caves; took the owner's diamonds when asked to check; said the bed was back before it checked. | The skill. | The skill: the chat only for danger, the goal done or stuck, and the owner's questions, at most one line per 5 minutes; underground only `!mineOre`; out of caves; "check" never moves things; nothing claimed before a tool showed it. | lead |
| F1-7 | "Home was set to the bed in the cave." | No place "home" changed: the supervisor placed the owner's bed at (16, 14, 26) and the bot slept in it, which sets the respawn point (vanilla). | No change of code; the skill: never sleep in a placed bed underground. | lead |
| F1-9 | The supervisor counted "66 diamond ore within 32 blocks" and "41 iron ore within 12 blocks" and sent the bot toward them, into a cave. | `look` listed every ore within the radius, through the rock. The owner: the bot sees only what is open to his or the player's view; seeing through walls is a cheat. | `look` lists ore, lava and water only with an open side. | lead |
| F1-8 | `start-gpt.ps1` loaded the watch token while `start-claude.ps1` no longer did (the owner's commit b6639e8 for `watch_local_only`). | | The same two lines commented out in `start-gpt.ps1`. | lead |
| F1-10 | W115 part B in the gate of the fix: the bot carried the dead player's 5 ingots (2 of 7 runs since v0.1.4.13). | Not the item reflex (no `Picking up item!`): the step away from a death drop at the bot's feet aimed away from one drop (the boots) and walked over the ingots, which the server gives to whoever touches them. | The step goes 4 blocks away from the middle of all the death's drops within 6 blocks (`awayPoint`). W115 gains part B2: the player dies 1 block from the bot, in gold. After it W115 passed 8 of 8 runs; in one B2 run the drops landed at the bot's feet and it stepped 5 blocks away from all of them, taking none. | lead |
| F1-11 | W118 in the gate of the fix: 1 of 6 raw iron in 3 minutes. | The bot dug a parallel tunnel at z -2 instead of the measured one at z 0 and never reached the seeded iron; with one free slot it walked to the chest every 2 cobblestone. The same code passed W118 in 70 s an hour before, and in the gate of the release. | A flake of the mining's choice of tunnel, not of this fix; with the full bag far from the chest in 0.1.4.14. | lead |
| F1-12 | W116 in the first run of the group: the gate open 10 s after the bot passed. | | Passed 2 of 2 alone and in the gate; a flake of the timing of the gate. | lead |
| F1-13 | W113 in the last group run: `I placed my furnace at (x, y, z).` not said. | A race of the test: it read the bot's lines at 34 s, when the pickaxe was in the bag; the result line came when the command ended, a moment later (the log has it). | W113 waits up to 10 s for the line; 3 of 3 after it. | lead |

Not a defect: the mining digs only ore that its tunnel exposes; the bot sees no ore behind walls, as the owner intends
(the setting that sees through walls is a cheat and stays off). The rest of the play's findings (caves, the supplies, the mine and its route, a full bag
far from the chest, chests by position, `!craftRecipe` with a count, a ladder through a trapdoor, orders that the
bot's model overrides, code that cannot be stopped) are planned for 0.1.4.14 in
`docs/ROADMAP.md`; the load of the laptop only if it remains after this fix.

The gate of the fix in a fresh clone (fe5a19a): unit 8,457 tests, 0 fail; the world set of the release gate (the 30
journeys, the 11 of 0.1.4.13 with W119, `creeper_in_sight` twice) 40 of 42, the two failures F1-10 (fixed) and F1-11
(a flake). After F1-10 and F1-13: unit 8,461 tests, 0 fail; the 11 of 0.1.4.13 10 of 11 (W113, F1-13), then W113 3 of 3,
W115 8 of 8, W118 2 of 2.
