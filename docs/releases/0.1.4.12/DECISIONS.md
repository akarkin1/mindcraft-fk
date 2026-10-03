# Decisions v0.1.4.12

Every defect the tests found, with the decision and the owner of the correction. The tests of T3 were
written from the plan before the build; the engineers' parts came in while they were run.

## Found by the journeys of T3, written before the build

| Id | Finding | Where | Decision | Owner |
|---|---|---|---|---|
| T3-1 | W105: the job planner said "I could not plan the steps for the iron ingot": the plan commands have no way to get raw iron (`!mineOre` is not a plan command). | iron_pickaxe | `!mineOre(ore, num)` becomes a plan command when the mining pack is on and a mine is known; `missingSupplies` for iron proposes mine, smelt, tool. | E (E2) |
| T3-2 | W106: `!leaveMine` from the tunnel of the base said `the ladder at (x, z) has a gap of 1 at y 42. I need 1 ladder to go on.`: shaft 2 of the owner variant ends 2 blocks above the room floor. `!goToMine` and the typed walk still reach the tunnel; the walk to the cave used destructive movements (`!goToCoordinates` of the original project). | scan_underground | The base keeps its gap (it is the owner's); the scenario goes on. `!goToCoordinates` digging is the original project's command and not of this release. | none |
| T3-3 | W107 cannot tell v0.1.4.11 from v0.1.4.12: a dig ordered 1 s after the spawn is dropped once and done at 3 s (within the 10 s window); the workaround of the home pack already gets the bot out of bed in 0.5 s. | spawn_and_bed | Kept as it is: the scenario proves the behaviour, not the difference; the unit tests of G1 and G2 prove the packets. A 2 s window would be a race. | lead |
| T3-4 | W108: with `only_chat_with` the bots whisper only to the player, so "neither answers the other" holds on the old code too. | two_bots | The sharp checks are the role line in every prompt, the farmer running no `!mineOre`, the miner running it. | lead |

Decisions of T3 accepted: the teacher is the player of the order channel; W105 teaches the mine first and puts the ore beyond the tunnel's end (the way W81 and W86 prove); W106 accepts `I am in a cave` or `I am in a tunnel` with nothing saved; W103 checks the understood text by its parts; the second bot of W108 runs as a second node process of the same file (the settings are one module per process).

## State at the plan limit, 2026-10-03 (6900267)

Parts C, E, G and B are done and committed with their journeys passing (W100, W101, W102, W107). Parts F (E5) and D
(E6) were stopped mid-work by the session limit of the plan (it resets at 06:00 UTC); their files are in the wip commit
as they stood. T1 has not started. Open items, in the order of the next session:

| Id | Finding | Where | Decision | Owner |
|---|---|---|---|---|
| F1 | W105: the plan runs now (4 raw iron mined), but `!smeltItem` in the tunnel says `I know no furnace within 16 blocks and carry none.`: the furnace of the room is 20 to 30 blocks from the tunnel's end. | iron_pickaxe | `smeltItem` looks for a furnace within 16 blocks first, then within 64 among the loaded blocks the guard allows, and walks to it with the pack's walk (no digging); the text names the range it searched. | E (E2), done: W105 passes in 188 s (mine 44 s, smelt 42 s, the tool 2 s; `I smelted 3 raw_iron into 3 iron_ingot in the furnace at (400, 41, -2) with 2 oak_planks.`) |
| F2 | D3 as written needs a placeholder in both profiles, which breaks rule 17 (`profiles/claude.json` unchanged) and the four tests of W6 of v0.1.4.11. | two_bots | No placeholder: the prompter inserts the role line after the W6 sentence "A rule about a place names a saved place..." when `bot_role` is set; both profiles go back to their text. | D (E6) |
| F3 | The source test of `_loadWorkPacks` (tests/unit/rtg_agent.test.js, "the packs are loaded for routes_pack alone too") reads the `if` line of `start()`, which now names `watch_and_learn` too. | the lead's glue | The test accepts the longer condition. | T1 |
| F4 | `tests/unit/stg_commands.test.js` ("the words of the new behaviour") wants `home.*building.*farm.*pen.*mine` in the description of `!rememberArea`, which the lead shortened for the prompt limit. | the lead's glue | The description names the kinds in short: `...; without a type you conclude the kind (home, building, farm, pen, mine) from what is there.`, the test stays. | lead |
| F5 | `scripts/routing_check.js --dry-run --all-parts` fails ("every part is on"): the dry run's list of parts does not switch `watch_and_learn` on. | routing | `--all-parts` switches every key of PART_COMMANDS on. | T1 |
| F6 | E5's static import of `tunnelAt` from the mining pack in `area_sense.js` (the rule: packs through ctx). | scan_underground | Through the context, or a pure copy in areas if small; E5 was told. | F (E5) |
