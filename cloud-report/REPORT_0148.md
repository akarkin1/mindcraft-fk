# Cloud test report for v0.1.4.8

Final, written 2026-09-30T01:45:56Z. Everything asked for in the request of the tech lead, in its order. All runs were made in a cloud container with a real Minecraft 1.21.8 server; no code of the bot and no test was changed for them beyond commit `2f625ba`.

**Short form: unit 5228 of 5231 pass (2 CRLF assertions fail on the LF checkout, 1 skipped); end-to-end 17 of 17; world 58 of 58 in 75.4 minutes with the long run; night 4 of 4 with the corrected check. No defect of the bot found.**

## 1. What was tested

- Branch `claude/admiring-euler-xagtrz`, commit `d5b4ba5`: the merge of `origin/main` at `6aaee79` into `2f625ba`. The bot's code and the tests are exactly those of `6aaee79` plus the one commit below.
- Changes for the cloud, all in tests, none in `src/`:
  - `2f625ba` "test: accept an LF checkout in the two line-ending tests": `tests/unit/examples_valid.test.js` and `tests/unit/settings_persistence.test.js` accept one consistent kind of line ending (all LF or all CRLF) and still fail on a mix. Before, both asserted CRLF, which only a Windows checkout with `core.autocrlf=true` gives.
  - Nothing else. The world runner and the scenarios ran as committed. The machine is described through the environment variables of the README only.
- Commits after `d5b4ba5` on this branch hold only this file under `cloud-report/`.

## 2. The machine

| Item | Value |
|---|---|
| OS | Ubuntu 24.04.4 LTS in a cloud container, 4 CPUs, 15 GB memory, about 29 GB free disk |
| Node | v22.22.2. The container has no Node 20; `npm install` (with the patches) and every suite ran on 22 |
| Java | OpenJDK 21.0.10 (build 21.0.10+7-Ubuntu-124.04), `/usr/bin/java` |
| Minecraft server | the official 1.21.8 server jar: URL taken from the version manifest at `piston-meta.mojang.com`, file from `piston-data.mojang.com`; SHA-1 `6bce4ef400e4efaa63a13d5e6f6b500be969ef81`, checked against the manifest |
| EULA | `eula.txt` with `eula=true`, written by my download script next to the jar in `/home/user/mc-test-server` |
| Server start | 9.3 s (flat), 9.6 s (deep), 9.9 s (base) to "Done", with `-Xms512M -Xmx1G` |

## 3. Unit tests (`npm test`)

| tests | pass | fail | skipped |
|---|---|---|---|
| 5231 | 5228 | 2 | 1 |

The two failing tests are of the same class as the two fixed in `2f625ba`: they assert CRLF, the checkout is LF.

- `tests/unit/stg_prompt.test.js:221`, "profiles/claude.json (section 11, item 12 of the task) > the file keeps its CRLF line endings":
      AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
      
      1 !== 12
      
          at TestContext.<anonymous> (file:///home/user/mindcraft-fk/tests/unit/stg_prompt.test.js:223:16)
- `tests/unit/stg_settings.test.js:70`, "settings.js: the settings of v0.1.4.8 > the file keeps its CRLF line endings":
      AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
      
      1 !== 104
      
          at TestContext.<anonymous> (file:///home/user/mindcraft-fk/tests/unit/stg_settings.test.js:71:16)

Judgement: the tests are wrong for an LF checkout, the files are fine. I did not change them (tests only, no changes, as the owner asked). They pass on a Windows checkout with `core.autocrlf=true` and fail on every LF checkout, so they will fail in any Linux CI. The fix of `2f625ba` (accept one consistent ending) fits them too.

## 4. End-to-end tests (`npm run test:e2e`)

17 passed, 0 failed, 161.8 s.

| Scenario | Result | Time |
|---|---|---|
| sandbox | PASS | 5.5 s |
| world_identity | PASS | 3.1 s |
| worlds_are_separate | PASS | 8.2 s |
| dimension | PASS | 5.6 s |
| flag_off | PASS | 5.4 s |
| legacy_adoption | PASS | 8.6 s |
| resume_policy | PASS | 1.5 s |
| reset_tool | PASS | 8.4 s |
| skill_capture | PASS | 7.3 s |
| skill_reuse | PASS | 14.8 s |
| skill_sandbox | PASS | 4.8 s |
| skill_prompts_commands | PASS | 7.6 s |
| skill_flags_off | PASS | 16.6 s |
| skill_agent_start | PASS | 12.7 s |
| skill_partial_flags | PASS | 16.7 s |
| skill_guardrails | PASS | 13.1 s |
| playtest_fixes | PASS | 21.9 s |

## 5. World tests (`node tests/world/run.js`, no words: all 58 scenarios)

- Run: started 2026-09-30T00:20:13Z, ended 01:35:55Z, **58 passed, 0 failed in 4523.1 s** (75.4 minutes), exit code 0. Logs of every scenario and every server were kept with `MCW_LOG_DIR`.
- `long_run` was part of it: PASS in 1782.4 s. All 60 orders were given and reached the agent, no order stayed without a result text, the process never ended, the bot is alive at the end, 0 deaths, 29.6 minutes for the 60 orders, 3 requests to the fake chat model, longest conversing prompt 16,576 characters (the limit of G12 is 17,000).
- Hygiene line of the runner: "no server process left (pid 4016, 5907, 6390 ended), no mc-world-* temp directory left, repository bots/ unchanged, server folder unchanged".
- The three scenarios that failed in the first full run on the laptop (`eat`, `skill_stands_still`, `long_run`) pass here.
- No failing scenario, so no failing CHECK lines and no agent tails to give.

The RESULTS block of the runner, word for word:

```
RESULTS
  PASS baseline           17.2 s
  PASS flags_off          53.6 s
  PASS doors              44.3 s
  PASS shelter            28.5 s
  PASS night             123.9 s
  PASS protected_house    36.5 s
  PASS scan                8.4 s
  PASS farm               10.1 s
  PASS creeper            51.0 s  runs: pass, pass
  PASS sleep              21.8 s
  PASS eat                36.9 s
  PASS rules              16.1 s
  PASS cost                9.6 s
  PASS creeper_standing   28.6 s
  PASS storage            29.7 s
  PASS harvest            24.6 s
  PASS plant              85.5 s
  PASS bone_meal          13.1 s
  PASS farm_cycle         36.5 s
  PASS farm_old_command   53.3 s
  PASS trees              32.2 s
  PASS tall_tree          59.5 s
  PASS tools              69.2 s
  PASS flags_off_0147     26.9 s
  PASS stuck_gives_up     73.9 s
  PASS skill_stands_still  118.8 s
  PASS stop_is_hard       27.4 s
  PASS offhand_food       21.1 s
  PASS reflex_switch       9.3 s
  PASS flags_off_0148     57.0 s
  PASS hole_escape        57.7 s
  PASS order_after_stuck   60.4 s
  PASS chat_burst         43.0 s
  PASS mine_basics        66.2 s
  PASS shaft             114.6 s
  PASS tunnel             79.3 s
  PASS mining_trip       157.2 s
  PASS mine_house         44.0 s
  PASS base_world         12.1 s
  PASS stopped_command_reports   22.4 s
  PASS resume_ends        38.3 s
  PASS hunger_reflex      30.0 s
  PASS fence_is_safe      19.4 s
  PASS pick_up_dropped    19.8 s
  PASS shaft_is_underground   90.2 s
  PASS creeper_above      71.0 s
  PASS creeper_in_sight   31.7 s  runs: pass, pass
  PASS shelter_is_home    24.8 s
  PASS doors_after_reflex   23.2 s
  PASS auto_home          15.4 s
  PASS chest_at_fence     22.4 s
  PASS farm_cycle_whole   45.3 s
  PASS trees_with_axe     54.9 s
  PASS mine_asks          10.7 s
  PASS farm_scan          11.6 s
  PASS composter_never   223.5 s
  PASS wake_for_order     94.0 s
  PASS long_run         1782.4 s
SUMMARY 58 passed, 0 failed in 4523.1 s
```

Observations that are not failures:

- `long_run`: `!goToBed` gave no answer within 90 s and `!followPlayer("w_player", 3)` none within 30 s; both "keep running" by design of the orders, the runner only notes it.
- `night`, stage 2, in the flat world: to collect 8 dirt the bot digs straight down under itself (y -60 to -63, on the bedrock) because the flat world has dirt only under the grass. Expected there; in play `!collectBlocks("dirt")` will do the same wherever the nearest dirt is below the bot.
- Every scenario prints three times `Error with embedding model, using word-overlap instead.` on stderr: the fake model has no embeddings. Noise, not a defect.

## 6. The scenarios of commit 6aaee79

All of them ran, all passed, every check of them passed, none has a TODO, a skip or a note of something unfinished in its output.

| Scenario | Ran | What it proved here | Wrong or missing |
|---|---|---|---|
| w36 composter_never | PASS, 223.5 s | 4 rounds of `!farmCycle` with the composter at level 8: day, dusk 24 s after the order, day, dusk 32 s after the order. In every round: the bot never stood inside or on the composter (X1), no farmland became dirt (X2), the order ended, the process lives. After the rounds a typed `!goToCoordinates` reaches its goal, no "I am stuck at ... and could not walk away." | The request said "run it 5 times"; the scenario runs 4 rounds. Otherwise complete. |
| w37 hole_escape | PASS, 57.7 s | Two phases, composter and cauldron: the bot placed inside gets out, the order reaches its goal (at once or typed again), the reflex does not give up, "I'm stuck!" is followed by "I'm free." | Nothing missing against the request. The hopper is not tried (only composter and cauldron). |
| w38 order_after_stuck | PASS, 60.4 s | In a closed room of obsidian the reflex gives up; a new order then has its full 20 s (first "I'm stuck!" 18 s or later after the order, X3); three orders in a row are not stopped by unstuck and reach their goal. | Nothing missing. |
| w39 wake_for_order | PASS, 94.0 s | A: asleep after `!goToBed`, a typed `!goToCoordinates` gets the bot out of the bed within 10 s (its own view and the server, X5), reaches the goal, and the `!goToBed` order ended. B: asleep again, a typed `!searchForEntity` gets it out, 8 blocks from the bed within 20 s, reaches the cow. | Nothing missing. |
| w40 chat_burst | PASS, 43.0 s | A: 12 lines at once all reach the player, in order, 6 at once then 1 per 1.2 s (last line 6 s or more after the first), no kick (X9). B: six query commands, the player never sees more than 15 lines in 10 s, no kick. Phase kick: a forced kick prints "The server said: Kicked for spamming", not "Server is under maintenance or restarting". | Nothing missing. |
| w05 night (changed) | PASS 4 of 4 (123.9, 126.2, 126.1, 125.3 s) | See the finding below. | The corrected window is right; nothing missing. |
| w11 eat (changed) | PASS, 36.9 s | The X10 check is there and passed: "the number in the text of !eat is the bread that left the inventory while it ran". Also `!consume` with full food answers "I am not hungry. Food 20 of 20." (X12). | Nothing missing. |
| w33 stopped_command_reports (changed) | PASS, 22.4 s | X4: the stopped `!chopTrees` answers the player "Command !chopTrees was stopped by !stop. Done so far: I cut N oak_log and picked up M." and the player saw it in the chat; N equals the logs gone from the trees (server). | Nothing missing. |
| w44 pick_up_dropped (changed) | PASS, 19.8 s | "I picked up 8 oak_fence, 1 oak_fence_gate." (B4), the items are in the inventory (server), nothing on the ground, the answer of `!givePlayer` has no line of only a number (X15). | Nothing missing. |
| w52 farm_cycle_whole (changed) | PASS, 45.3 s | The texts of X13 (gate, not door) and X14 ("I could not pick up the crop of N plants." or no wheat in the field; "got ripe and I harvested them") are checked and passed; no farmland became dirt; the gate is closed. | Nothing missing. |
| w57 flags_off_0148 (changed) | PASS, 57.0 s | H: `examples_by_last_request` off, the whole conversation chose the examples. A to G as before (stuck_restart_after 1, protect_built_blocks off with "Collected 3 oak_fence.", knowledge_in_prompt off, repeat_guard 0, say_results off, log_timestamps off, restart_context off). | Nothing missing. The "on" side of the new switch is not in this scenario (it is a flags-off scenario); if it is tested anywhere on the real server, I did not find it. |

**The finding about `night` (stage 2), checked in the traces of the four runs:**

- In 2 of the 4 runs (my runs 2 and 3) the reflex `night_shelter` started right after the order ended: the last rows of the stage-2 trace show `action=mode:night_shelter` with `dirt=11`, that is `dirtBefore + 8` already reached, and stage 2 has no "Command !collectBlocks was stopped by the reflex night_shelter" line (the check prints `[]`). The order was not interrupted; the reflex followed it.
- The corrected check counts only the rows up to the first row whose action is not `action:collectBlocks` (63 and 62 rows in those runs, 76 in the other two). With the old window (`t <= started2 + done2`) both runs would have failed on "the night reflex did not interrupt the order", as the engineer described.
- So the engineer's finding is right, the correction in `6aaee79` is the right one, and it is not a defect of the bot.
- In the other 2 runs (1 and 4) the command ended with "Collected 8 dirt." after two "Failed to collect dirt: Timeout: Took to long to decide path to goal!" (the drop that can only be reached by digging, X11), and the reflex had not started when the trace stopped.

## 7. What differs from the README of tests/world in the cloud

- Paths: `MC_TEST_SERVER_DIR=/home/user/mc-test-server`, `MC_TEST_JAVA=/usr/bin/java`. There is no `%LOCALAPPDATA%` and no Java of the Minecraft launcher; the defaults in `mc_server.js` are Windows paths, the two variables cover it, nothing in the runner needed a change.
- Temp: `os.tmpdir()` is `/tmp`, so the run directories are `/tmp/mc-world-run-*` and `/tmp/mc-world-scn-*`. All were removed at the end.
- Line endings: the checkout is LF (the repository stores LF; `.gitattributes` only pins `*.patch`). Only the four CRLF-asserting unit tests notice; the bot, the runner and the scenarios do not.
- Ports: 25599 was free and used for all three servers in turn; 55916 is never touched.
- Java: the container sets `JAVA_TOOL_OPTIONS` (proxy settings) for every Java process. I unset it for the runner, so the server runs without it. With it set, Java prints one extra "Picked up JAVA_TOOL_OPTIONS" line on stderr, nothing else.
- Killing: on Linux `killPid` sends SIGKILL instead of `taskkill`; all three servers ended with `stop` anyway (exit code 0), the kill path was not needed.
- Node 22 instead of 20 (see section 2).
- Time: the full run took 75.4 minutes here against about 70 on the laptop for 53 scenarios; the server starts in about 10 s.

## 8. Still running or not yet run

- Nothing is still running. No java or node process of the tests is left, no temp directory, the repository is clean (`git status` empty apart from this file).
- Not run: nothing of the three suites. Every scenario of `tests/world/run.js`, every end-to-end scenario and every unit test ran once; `night` ran four times.
- Not tested here: anything with a real model (every run uses the fake), the Windows paths and the launcher Java of the README, Node 20, the play test guide, the `on` side of `examples_by_last_request` on the real server (see w57 above).

Logs: kept in the scratchpad of this cloud session under `world-logs/final2/<scenario>_run<n>.log` and `_server.log`, `world-logs/night_2..4/`, `unit-0148.log`, `e2e-0148.log`. They are not in the repository. Ask the owner if you need one of them; the summary lines are above.
