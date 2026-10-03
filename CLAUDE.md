# Rules of this repository for Claude

This is a fork of [Mindcraft](https://github.com/mindcraft-bots/mindcraft) for Minecraft Java 1.21.8. One owner plays with one bot. The fork adds skills that are code, reflexes, memory per world, protected areas, a cost meter and tests on a real server. `CHANGELOG.md` says what each release contains, `docs/ROADMAP.md` what is planned, `docs/PROCESS.md` how a release is made.

## Never

- Never read, create, copy, stage, commit or print `keys.json`. Never read a secret. The bot gets its keys as environment variables from the launch script.
- Never commit anything under `bots/`: chat histories, memory, world data of the owner.
- Never connect to port 55916. That is the world of the owner. The test server of the world tests runs on 127.0.0.1:25599 or the next free port.
- Never run `test-routing.ps1`, and never run `scripts/routing_check.js` without `--dry-run`. Both call a real model and cost money.
- Never start the bot against a real model in a test. The tests use a fake model.
- Kill only processes that you started, by process id.
- Never bump a pinned dependency without a play test of the owner. The files under `patches/` are functional; `npm install` applies them.

## Branches

- `main` is the release line of the fork. Releases are tagged `v0.1.4.N`.
- `develop` and `stable` are mirrors of the original project. Do not commit to them.
- A release is built on a branch `release/v0.1.4.N-rc` (the release candidate) and merged with a pull request; after the merge the lead deletes the branch. A fix on top of a release goes on `release/v0.1.4.N-fix1`, `-fix2`, and so on. Create such a branch with `git checkout -b release/v0.1.4.N-rc origin/main --no-track`, so that a push never goes to `main`. Branches carry the version number, not a topic name: the owner reads numbers better than words.
- The owner edits `settings.js` and `profiles/claude.json` in their checkout. Unit tests never assert the values of settings; they check their validity.

## Node and line endings

- The owner plays with Node 20.20.2. On the owner's machine run every node command through fnm: `fnm exec --using=v20.20.2 -- node ...`; `npm` is `npm.cmd` there. The shell has Node 24, where about 24 tests fail for reasons of the environment. In the cloud Node 22 works.
- The repository stores LF. A Windows checkout has CRLF. Keep the line endings of every file you change, and check with `file` before and after.

## Tests

| Command | What | Time |
|---|---|---|
| `npm test` | Unit tests, `tests/unit`, node:test | About 1 minute |
| `npm run test:e2e` | Scenarios on a simulated server, `tests/e2e` | About 4 minutes |
| `npm run test:world` | Scenarios on the real Minecraft server, `tests/world`, see its README | About 75 minutes for all; single scenarios by name |

Every scenario that tests a skill runs with the reflexes of the profile on and gives its order as a chat command. A test file must end by itself: no timer, interval or listener may stay open.

The test server: the jar of the 1.21.8 server and an accepted `eula.txt` in `%LOCALAPPDATA%\Mindcraft\test-server` on the owner's machine, `~/.local/share/mindcraft/test-server` elsewhere, or in the folder that `MC_TEST_SERVER_DIR` names. `node scripts/get_test_server.js --accept-eula` downloads and checks the jar and writes `eula.txt`. The owner accepted the EULA on 2026-09-28. In the cloud set `MC_TEST_JAVA=/usr/bin/java`.

## Code

- Every new behaviour has a switch in `settings.js` and in `src/mindcraft/public/settings_spec.json`, off by default. A correction of a defect has no switch. With a switch off the bot behaves as before.
- Skills are code under `src/agent/packs/<name>/`: pure logic in `*_logic.js` with unit tests, thin executing modules, an `index.js`. A skill returns `{ ok, reason, text }` and never throws. When it is stopped, `reason` is `interrupted` and `text` says what was done. Packs call each other only through the context `ctx`, never by import.
- Texts that the bot says are plain English, short sentences, with numbers. A text never claims what the code did not check.
- Match the style of the file you change. Static imports only of names that exist; a pack behind a switch is loaded with a dynamic `import()`.
- The functions of `src/agent/library/skills.js` are also called by code that the language model writes. Do not change a signature or the meaning of a return value.
- Every release gets an entry in `CHANGELOG.md` with its settings and their defaults.

## Documents of a release

`docs/releases/<version>/`: the plan for the owner, the spec for the engineers, the handoff notes between the parts, the decisions after the tests. Commit them on the release branch, so that a session in the cloud can read them.
