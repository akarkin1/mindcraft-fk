# Cloud test report for v0.1.4.8

**Status: INTERIM, written at 2026-09-30T00:36:52Z while the world run is still going.** The final version replaces this file when the run has ended.

## 1. What was tested

- Branch `claude/admiring-euler-xagtrz`, commit `d5b4ba5`: the merge of `origin/main` at `6aaee79` into `2f625ba`. The bot's code is exactly that of `6aaee79`.
- Changes made for the cloud, all in tests, none in `src/`:
  - `2f625ba` "test: accept an LF checkout in the two line-ending tests": `tests/unit/examples_valid.test.js` and `tests/unit/settings_persistence.test.js` accept one consistent kind of line ending (LF or CRLF) and still fail on a mix. Before, both asserted CRLF, which only a Windows checkout with `core.autocrlf=true` gives.
  - Nothing else. The world runner and the scenarios run as committed; the machine is described through environment variables only.

## 2. The machine

| Item | Value |
|---|---|
| OS | Ubuntu 24.04.4 LTS, cloud container, 4 CPUs, 15 GB memory, about 29 GB free disk |
| Node | v22.22.2 (the container has no Node 20; `npm install` and all suites ran on 22) |
| Java | OpenJDK 21.0.10, Ubuntu build 21.0.10+7, `/usr/bin/java` |
| Minecraft server | official 1.21.8 server jar, downloaded through `piston-meta.mojang.com` version manifest from `piston-data.mojang.com`; SHA-1 `6bce4ef400e4efaa63a13d5e6f6b500be969ef81`, checked against the manifest |
| EULA | `eula.txt` with `eula=true` written by the download script next to the jar, in `/home/user/mc-test-server` |
| Server start | 9.3 s to "Done" on the flat world (`-Xms512M -Xmx1G`) |

## 3. Unit tests (`npm test`)

| tests | pass | fail | skipped |
|---|---|---|---|
| 5231 | 5228 | 2 | 1 |

Failing tests, both the same class as the two fixed in `2f625ba` (LF checkout on Linux; the tests assert CRLF):

- `tests/unit/stg_prompt.test.js:221` "profiles/claude.json (section 11, item 12 of the task) > the file keeps its CRLF line endings"
      AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
      
      1 !== 12
      
          at TestContext.<anonymous> (file:///home/user/mindcraft-fk/tests/unit/stg_prompt.test.js:223:16)
- `tests/unit/stg_settings.test.js:70` "settings.js: the settings of v0.1.4.8 > the file keeps its CRLF line endings"
      AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
      
      1 !== 104
      
          at TestContext.<anonymous> (file:///home/user/mindcraft-fk/tests/unit/stg_settings.test.js:71:16)

I did not change these two tests (the owner asked for tests only, no changes). They will pass on a Windows checkout and fail on every LF checkout.

## 4. End-to-end tests (`npm run test:e2e`)

17 passed, 0 failed, 161.8 s. PASS: sandbox, world_identity, worlds_are_separate, dimension, flag_off, legacy_adoption, resume_policy, reset_tool, skill_capture, skill_reuse, skill_sandbox, skill_prompts_commands, skill_flags_off, skill_agent_start, skill_partial_flags, skill_guardrails, playtest_fixes.

## 5. World tests (`node tests/world/run.js`, all 58 scenarios, `long_run` included)

Run started 2026-09-30T00:20:13Z (UTC), logs kept with `MCW_LOG_DIR`. Results so far, in run order:

- PASS baseline (17.2 s, flat world, region x=400)
- PASS flags_off (53.6 s, flat world, region x=600)
- PASS doors (44.3 s, flat world, region x=800)
- PASS shelter (28.5 s, flat world, region x=1000)
- PASS night (123.9 s, flat world, region x=1200)
- PASS protected_house (36.5 s, flat world, region x=1400)
- PASS scan (8.4 s, flat world, region x=1600)
- PASS farm (10.1 s, flat world, region x=1800)
- PASS creeper: 2 of 2 runs passed (pass, pass)
- PASS sleep (21.8 s, flat world, region x=2400)
- PASS eat (36.9 s, flat world, region x=2600)
- PASS rules (16.1 s, flat world, region x=2800)
- PASS cost (9.6 s, flat world, region x=3000)
- PASS creeper_standing (28.6 s, flat world, region x=3200)
- PASS storage (29.7 s, flat world, region x=3400)
- PASS harvest (24.6 s, flat world, region x=3600)
- PASS plant (85.5 s, flat world, region x=3800)
- PASS bone_meal (13.1 s, flat world, region x=4000)
- PASS farm_cycle (36.5 s, flat world, region x=4200)
- PASS farm_old_command (53.3 s, flat world, region x=4400)
- PASS trees (32.2 s, flat world, region x=4600)
- PASS tall_tree (59.5 s, flat world, region x=4800)
- PASS tools (69.2 s, flat world, region x=5000)
- PASS flags_off_0147 (26.9 s, flat world, region x=5200)

No failure so far. The scenarios after these (flat: stuck_gives_up to chat_burst; deep: 5; base: 20 with long_run last) are still to come.

## 6. The scenarios of commit 6aaee79

Not reached yet at the time of this interim report, except: `night` PASS (123.9 s, first run, with the corrected stage-2 window), `eat` PASS (36.9 s). The rest follows in the final report.

## 7. What differs from the README of tests/world

- Paths: `MC_TEST_SERVER_DIR=/home/user/mc-test-server`, `MC_TEST_JAVA=/usr/bin/java`; there is no `%LOCALAPPDATA%` and no launcher Java. The defaults in `mc_server.js` are Windows paths, the variables cover it.
- Temp: the runner uses `os.tmpdir()`, which is `/tmp` here (`/tmp/mc-world-run-*`, `/tmp/mc-world-scn-*`).
- Line endings: the checkout is LF (the repository stores LF, no autocrlf). Only the four CRLF-asserting unit tests notice; the bot and the scenarios do not.
- Ports: 25599 was free and used; 55916 is never touched.
- Java: the container sets `JAVA_TOOL_OPTIONS` with proxy settings for every Java process. I unset it for the server so it runs without them (offline mode needs no network). With it set, Java prints one extra "Picked up JAVA_TOOL_OPTIONS" line on stderr, nothing else.
- Node 22 instead of 20.
- Killing: on Linux the runner kills the server with SIGKILL instead of `taskkill`; that path in `mc_server.js` worked.

## 8. Still running or not yet run

- The world run (started 2026-09-30T00:20:13Z).
- After it: `night` three more times to confirm the corrected check, then the final version of this file.
