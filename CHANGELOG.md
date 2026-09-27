# Changelog

All notable changes of this fork are listed here, newest release first.

This fork is based on [Mindcraft](https://github.com/mindcraft-bots/mindcraft) `v0.1.4`. Releases of the fork add a fourth number: `v0.1.4.1`, `v0.1.4.2`, and so on. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Each release lists new settings and feature flags with their default value.

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
