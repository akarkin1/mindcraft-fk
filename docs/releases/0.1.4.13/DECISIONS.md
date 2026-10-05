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
