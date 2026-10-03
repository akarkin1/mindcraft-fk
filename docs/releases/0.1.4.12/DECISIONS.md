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
