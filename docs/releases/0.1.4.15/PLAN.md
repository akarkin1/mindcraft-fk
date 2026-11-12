# Plan v0.1.4.15 "The base survey and Routines"

Based on your decision of 2026-11-09 (option A): the base survey and Routines in one release, two rounds on one
branch, the survey first; the fixes and small items planned for 0.1.4.15 until then move to 0.1.4.16
"Stability". The survey's design and your decisions came through your gameplay session of 2026-11-09
(`docs/ROADMAP.md`, "The base survey"); Routines were decided on 2026-10-03 and split off 0.1.4.13.

## 1. Goal

| After this release | Today |
|---|---|
| **"Here is the base, scan it"**: the bot finds every place of a base by itself from the loaded blocks around it, saves them all at once (farms with or without a fence, pens, the house and its rooms, the trading hall, the cane by the water, a tied animal, the basement, the mine or cave entrance), reports in one line and takes your corrections by name | You stand the bot at every place and name it; a farm without a fence could not be saved until v0.1.4.14 |
| **Routines**: a paragraph in your words ("keep the farm going, tidy the chests, make torches when fewer than 32") becomes a standing job the bot works when it has nothing else to do, plans once with the model and checks with code, and runs again until you say stop | The bot idles between orders; "maintain the base" cannot be expressed as a function |
| Several bases: the places of a base carry its name, `!goToBase(name)` walks to its door, a survey on return reports only what changed | Every base's places end up in one flat list |
| Everything else is v0.1.4.14 | |

## 2. Why these two together, and the cut rule

Routines like "maintain the base" need the base's places known, so the survey is their foundation and goes
first. You test both in one gameplay. Round one is the survey, gated on the server before round two starts;
round two is Routines with a budget of four days: over the budget, the release ships as the survey alone and
Routines move to 0.1.4.16, so a feature that is new ground never holds a finished one hostage. One PR, one
fresh-clone gate, one play test.

## 3. What changes for you

| | After | What you do |
|---|---|---|
| Settings | `base_survey` (off), `survey_radius` (128), `routines` (off); on in your play | Switch them on in `settings.js` for the play |
| Your worlds, memory, `bots/` | unchanged; the survey adds areas and places with source `survey` beside yours | Nothing. The wrong "carrot_farm" pen over your house: `!forgetArea("carrot_farm")` |
| Seeing | The survey is the one exception to the no-x-ray rule of v0.1.4.13: it reads the loaded blocks around the bot, no walking. Its block getter refuses ore names, so it can never find ore. Everywhere else the rule stays | Nothing |
| Chat | `!surveyBase(name)`, `!renameArea(old, new)`, `!forgetArea(name)`, `!goToBase(name)`, `!rememberRoutine(text)`, `!routines`, `!forgetRoutine(name)`, `!doRoutine(name)`; plain words map to them with examples in the profile | Say "here is the base, scan it" |

## 4. The base survey

Your decisions: (1) the survey sees the loaded blocks (x-ray, with the ore guard); (2) save first, then ask:
everything found is saved at once with source `survey`, one report line, and you correct by name, never a
dialog that holds the result back; (3) plain words trigger it, no automatic survey in this version; (4) the
underground is part of the base; (5) the radius is everything the server has loaded, capped by `survey_radius`
with 128 as the default; (6) your words are respected: an area you saved or named yourself is never renamed,
re-boxed or forgotten by a survey (unless the attempt failed and the bot said so, or you say so); the survey adds
what is new and says where its finds lie inside your areas; only a survey's own places are updated by a later
survey.

| Step | What the bot does |
|---|---|
| Seeds | One pass over the loaded blocks within the radius, in slices so the bot keeps moving: farmland and crops; fence gates and fence loops; doors, beds, chests, furnaces, workstations; villagers at job sites; sugar cane by water; a leashed entity with its knot; a nether portal; trapdoors and ladder columns |
| Places | Open farms from the connected farmland (the code of v0.1.4.14), named by the main crop (`potato_farm`); pens from each gate with the pen scan, named by the majority species (`cow_pen`); buildings from each door with the building scan and the kind rules (your house is a home); a trading hall where villagers stand at job sites, a new kind; the cane, a tied animal ("never untie, never break that post") and the portal as places; everything deduplicated against what is saved |
| The underground | From each building a trapdoor or ladder leads down: the room at the ladder's foot is the basement (a building that counts as shelter); openings in its rock walls lead to a mine entrance (a place and a route; the mine itself stays for `!mineOre`) or a cave mouth (a keep-out place); the way house, trapdoor, ladder, basement, mine is recorded as a route for the shelter and the mine walks |
| The report | `I found 12 places: house (2 beds), basement (9 chests, 5 furnaces), trading hall (7 villagers), potato farm 14 x 9, carrot farm 12 x 9, wheat farm 16 x 10, cow pen (5 cows), pig pen (4 pigs), chicken pen (9 chickens), cane by the water (22), a tied ghast at (x, y, z), a mine entrance at (x, y, z). All saved. Say "rename X to Y" or "forget X" to correct.` Nothing claimed that the code did not check |
| Bases | A `base` tag on the areas and places and `bases.json` per world (name, centre, dimension); `!goToBase(name)`; a survey on return reports the differences only |

Zero model calls: the scan is code, only the report goes to the chat. Your rules apply to the new areas as to
the old ("never open the livestock pens" covers every pen).

## 5. Routines

A routine is a paragraph in your words that describes standing work, saved by name: `!rememberRoutine("the
farm", "keep the wheat and the carrots harvested and replanted, bring the harvest to the chest by the door")`.
The bot works its routines when it has no job and nothing runs (the "nothing to do" of v0.1.4.10, which the
model today can neither write nor keep), one at a time, in the order you gave them.

| Part | What the bot does |
|---|---|
| Planning | When a routine runs for the first time, the model turns the paragraph into steps once: each step a command the bot has, with its arguments; code checks every step (a known command, arguments of the right kind, no command the owner forbade, within your rules) and refuses a plan that fails the check with the reason. The plan is saved with the routine; the model is not asked again unless the plan fails three times |
| Running | The steps run as a job of v0.1.4.10 with its state on disk, its errands ("follow me", "come here") that do not end it, its progress lines (one when a step is done, one when the round is done) and its restart. A maintaining routine runs again when its round is done and the conditions hold ("when fewer than 32 torches") |
| Stopping | "Stop" ends the running round; `!forgetRoutine(name)` removes the routine; a routine that fails three rounds in a row is paused with one line and waits for you |
| The supervisor | The watch tools list and start routines, so the supervisor has the lever it lacked when you were away |

What the model may not do: it never runs a routine's steps itself, never changes a saved plan, never adds a
command the check refused. Zero model calls during a round.

## 6. Estimate

| Part | Days |
|---|---|
| S1: the seeds, the places and the kinds of the survey (a pure module per detector, unit tests on synthetic grids) | 1.5 |
| S2: the underground, the routes and the shelter | 1 |
| S3: the report, the commands, the base tag, `bases.json`, `!goToBase`, the differences on return | 1 |
| S4: the end-to-end scenario on the fake server with a tiny base; the world scenario with a built base | 0.5 |
| R1: the routine store, the planning and the check, the four commands | 2 |
| R2: the rounds as jobs, the stop, the pause, the supervisor's tools | 1.5 |
| R3: the scenarios (the farm routine on the test base, a maintaining routine over two rounds) | 0.5 |
| The gate: unit, end-to-end and the full world set in a fresh clone, the fix round | 1 |
| **Total** | **9**, Routines capped at 4 |

## 7. Testing

Unit tests on synthetic grids and one end-to-end scenario on the fake server carry most of each feature's
behaviour and run in minutes. On the real server each feature's own scenario runs once when the feature lands,
so a defect is found while the engineer has the context; the full world set runs once, in the fresh-clone gate
at the end, for both features together. Nothing a scenario alone can prove is skipped: the ladder through the
trapdoor to the basement has never been proven on the server and is the survey's world scenario's first check.

## 8. Left out

- The fixes and small items of the October plays (tunnels as beams, caves, routes and places, supplies by need,
  chests by position, the history race of P-21 and the rest): 0.1.4.16 "Stability" (`docs/ROADMAP.md`).
- An offer to survey on arrival (`survey_offer`) and a walk for bases larger than the loaded radius: later.
- Milestones ("beat the game"): later, after smelting, trading and the Nether are skills.
- Thick snow layers (every state of a snow layer is "empty" for the path finder): a known issue of 0.1.4.14.

## 9. Risks

| Risk | What we do |
|---|---|
| The ladder through the trapdoor to the basement: the path finder could not climb it in the play of 2026-10-05; the route waypoints of v0.1.4.13 were meant to cover it | The survey's world scenario proves it first; if it fails, the route store records the way and the walk uses the ladder code of the packs |
| The survey reads a forest, a hill or a shore as a place (the false yards of 0.1.4.14) | The detectors start from seeds that are built (farmland, gates, doors, workstations), never from a border alone; the kinds of v0.1.4.14 |
| The survey finds ore by accident (the x-ray rule) | The block getter of the survey refuses every ore name; a unit test proves it on a grid full of ore |
| The model plans a routine badly (a wrong command, a wrong argument, an endless loop) | Code checks every step before it is saved; three failed rounds pause the routine; "stop" always ends it; the owner's rules are checked at every step as for any order |
| The prompt budget: new commands add to the docs | The routine commands are four short lines; the budget is measured in the tests as in 0.1.4.14 |
| Two features in one play | Each feature behind its own switch; the survey's places are marked `survey` so they can be forgotten as a group if the play goes wrong |
