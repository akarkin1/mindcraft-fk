# Defects of v0.1.4.8 found on the real server

Found by the tester T2 in the world tests, 2026-09-29/30. Final full run: 50 of 53 scenarios pass, 4203 s.
Failing: `eat` (w11), `skill_stands_still` (w32), `long_run` (w60). All three are defects of the bot.

Logs: `the logs of the run` (the final full run), `.../t2_logs/g1`, `rep1`,
`rep2`, and in the scratchpad `t2_logs/full1` (the first full run), `run4` to `run6`.

The test base (`tests/world/base_world.js`): a house of planks, a shaft with trapdoor and ladders under it,
a room at y 41, a tunnel at y 25, a fenced farm 9 x 9 with gate, composter inside and a chest in the fence
line, a pen with a cow and a chicken.

Run a scenario: `fnm exec --using=v20.20.2 -- node tests/world/run.js <word of its name>`.

## Decisions of the tech lead

| Id | Defect | Evidence | Decision | Owner |
|---|---|---|---|---|
| X1 | **The bot got into the block of the composter and never came out.** `!farmCycle` was stopped by `night_shelter`; from then on the position of the bot was inside the composter (a hollow block with an open top) of the saved farm. Every order that walks was stopped by `unstuck` after 20 s. Nine times `I am stuck at (11180, 61, -3) and could not walk away. I am in the area "farm" (farm). A oak_fence_gate is at (11178, 61, -4).` The process ended at minute 32. | w60 final, from order 18 | Two corrections. (1) The farm skills never stand in or on a composter, a chest or a fence: the place to stand for the work at the composter is a free block beside it, and the walk never goes over it. (2) The escape of `unstuck` gets a last step for a bot in a hole or a hollow block: jump and walk towards each of the four sides in turn, 1 s each, and see whether the bot came out. | farm: E. escape: A |
| X2 | The farmland beside the composter became dirt in one run of w52. | g1, w52 | The bot must not jump or fall onto farmland. The walk to the composter stays on the paths that the farm skill already uses in the field (no jump). | E |
| X3 | **After `unstuck` fired once, it stops new orders of the player after 0.2 to 20 s.** `Command !goToSurface was stopped by the reflex unstuck` 0.2 s after the order; the same for `!storeItems`. | run6 orders 37, 39; full1 order 40; final order 30 | The stuck time starts from zero when a new action starts (a new label of the action manager). A reflex that gave up does not fire again before the new command had its 20 s. | A |
| X4 | **A typed order that is stopped answers nothing in the chat.** The text goes only into the history. | final, order 52 | For an order that a player typed, the line `Command !x was stopped by ...` also goes to the chat of that player. For a command of the model it stays in the history only. | G |
| X5 | **The bot stays asleep.** After `I got up before the morning.` the bot still lies in the bed (`sleeping=true`, position bed + 0.6875). `!searchForEntity` and `!goToCoordinates` timed out; `!chopTrees` ran 394 s until morning. No `I'm stuck!`, because sleeping counts as progress. | full1, w60 orders 22 to 24; run6 | (1) The sleep skill really gets up: it checks `bot.isSleeping` after `bot.wake()` and only then says that it got up. (2) Every command that moves the bot wakes it first: when `bot.isSleeping` at the start of an action that is not `!goToBed`, the glue calls the wake function of the home pack (or `bot.wake()`). (3) Sleeping counts as progress for `unstuck` only while the running action is `goToBed` or no action runs. | sleep: C. wake before a command: G. progress: A |
| X6 | **The shelter reflex does not find the door when home is only a place.** `I could not get to the place "home".` after 5 s at the east wall; six attempts, never round to the door. 2 of 6 runs. | full1 and g1, w48; w49 stage 1 | The walk to the place `home` may open doors and goes through the nearest door of the building when a wall is in the way: use the door skills of the pack (`enterBuilding` or `passThrough`) with the doors found near the place. | C |
| X7 | **With `home_pack` off, `!goToCoordinates` into a house swings in the doorway for 60 s** and times out. v0.1.4.7 passed. 1 of 4 runs. | full1, w02 | A regression of part B (the watch of `goToGoal` beside the old door timer of v0.1.4.7). Find the cause; with `home_pack` off the walk through a door must be that of v0.1.4.7. | B |
| X8 | **`!storeItems` uses the 12 nearest chests** and then says `The chests are full now, I still carry 768 dirt.` while 12 more chests with free slots stand within 3 blocks. | w32 part C, every run | The limit goes up to 27 chests within the search range, nearest first. The text is only said when every known and every found chest within the range was tried; else it names the number: `I tried the 27 nearest chests.` | E |
| X9 | **The bot can be kicked for spamming.** It said 11 chat lines in 2 s; the server kicked it (`Kicked for spamming`). The process ended with a wrong reason (`Server is under maintenance or restarting`). | stage 1, w60 | The chat of the bot gets a limit: a queue with at most 6 lines at once and then 1 line per 1.2 s; nothing is lost, lines wait. It holds for everything the bot says (answers, reflexes, skills, the echo of a typed command). The reason of a kick is printed as the server gave it. | G |
| X10 | **`!eat` beside the hunger reflex says that it failed while the bot ate.** `I could not eat: Consuming cancelled due to calling bot.consume() again`, while the food level rose from 6 to 20. | w11, every run | One lock for eating in the home pack. While `!eat` runs the reflex and auto-eat do not eat. When the reflex or auto-eat is eating as `!eat` starts, `!eat` waits for it (at most 4 s) and then goes on; its text counts what the bot ate in all. | C |
| X11 | `!collectBlocks("oak_fence", 3)` broke 4 posts and said `Collected 4 oak_fence.` 1 of 3 runs. | rep2, w57 | Never break more blocks than asked: the loop ends when the gain reached the number or when the number of broken blocks reached it. | B |
| X12 | `!consume` with full food answers `!!Code threw exception!! Error: Error: Food is full`. | w60 | `I am not hungry. Food 20 of 20.` and no exception. | B |
| X13 | `!farmCycle` says `I found no way to the door at (...)` about a gate. | w52 | The text names what it is: door, gate or trapdoor. | C or E, where the text lives |
| X14 | One wheat and one bone meal stayed on the ground while the text said harvested and used. | w52 run 4 and 5 | The text counts what the inventory gained and what was used. Items that lie within 3 blocks at the end are picked up once more. | E |
| X15 | `!givePlayer` prints a stray line `61`. | w60 | Remove it. | G or B, where it is printed |

## Not corrected in this release

- The area `home` that the bot saves at the start follows the ladders of a shaft down (11 x 23 x 13 in the
  test base). The house and the top of its shaft are one area. Known.
- The bot does not go down through a closed trapdoor by a command of its own. It comes with v0.1.4.9.
- `!storeItems` may choose the chest of the farm over the chest of the house.
