# Changelog

All notable changes of this fork are listed here, newest release first.

This fork is based on [Mindcraft](https://github.com/mindcraft-bots/mindcraft) `v0.1.4`. Releases of the fork add a fourth number: `v0.1.4.1`, `v0.1.4.2`, and so on. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Each release lists new settings and feature flags with their default value.

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
