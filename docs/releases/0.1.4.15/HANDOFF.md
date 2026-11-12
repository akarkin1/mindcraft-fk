# Handoff v0.1.4.15 "The base survey and Routines"

What each finished part gives to the parts that follow. Where it differs from `SPEC.md`, this file wins.

## Round 1 (2026-11-10): the survey pack (E1, E4) and Routines (E2), the scenarios (T3)

Built in one day of working time across six sittings between usage limits. The suites with every change in:
unit 9,097 tests (9,095 pass, 2 skipped), end-to-end 19 of 19 (`routine_round` among them); on the 26.1 server
W126 `survey_base` 53 of 53 twice, W127 `farm_routine` passing, and the area, route and shelter scenarios
(`owner_base`, `pen_gate_safe`, `route_to_bed`, `remember_mine`, `shelter_is_home`, `ten_minutes`,
`spawn_and_bed`, `job_comes_back`, `first_mine`) passing. The gate (DECISIONS G-4) from a fresh clone of bda9b3f,
with the fix of the full bag in the mine (G-2): unit 9,104 tests (9,102 pass, 2 skipped), end-to-end 19 of 19, the
world set 51 of 51 in 5,212 s.

### The survey pack, `src/agent/packs/survey/`

| Module | Exports | Notes |
|---|---|---|
| `survey_logic.js` (pure; E1) | `SEED_NAMES` (8 categories, every gate, door, trapdoor and bed of 26.1, no ore), `SEED_CATEGORIES`, `CROP_FARMS`, `ANIMAL_NAMES`, `LEASH_RANGE` 12, `HALL_REACH` 6, `CANE_MIN` 3, `POINT_REACH` 4, `isOreName`, `oreBlind(getBlockName)`, `seedsOf(blocksByCategory, entities)`, `findPlaces(read, seeds, saved, options)` → `{ places, kept, skipped }`, `farmName`, `penName`, `uniqueName` | The two shapes of SPEC 2.1 and 2.2 stand in the header. `kept` and `replace` compare the x/z footprints of the boxes (y must overlap at all). A seed inside an owner's area is never scanned; inside a survey area it is scanned again and the find replaces it (name kept). A fenced ring without animals is a `yard`. |
| `texts.js` (pure; E1) | `reportText(found, kept, changed)`, `itemText`, `keptText`, `roleOf`, `REPORT_ORDER`, `tiedRuleText(found)`, `nothingText(radius)` (alias `nothingFoundText`), `againText(base, changed, kept = [])`, `renamedText`, `unknownPlaceText`, `placeExistsText`, `forgotBaseText(name, count)`, `atBaseText`, `noBaseText` | Every text of SPEC 2.5 word for word; `found` is one list of E1's places and E4's underground places; the farms carry their size and the pens their count in the order found; the tied sentence is appended to the report line. |
| `underground_logic.js` (pure; E4) | `followLadder`, `basementOf`, `wallOpenings`, `undergroundOf`, `routeOfSurvey`, `basementPlace`, `mineEntrancePlace`, `caveMouthArea`, `UNDERGROUND_RULES`, `UNDERGROUND_NAMES` | A room is where a 3 x 3 of floor is open; a corridor 1 or 2 wide is a way out. The scans beyond the walls read the room as rock. When the rock scan sees no rock over a space beyond an opening (a cave roof 2 blocks under the surface), `wallOpenings` judges the space itself (`enclosure.judged: 'beyond'`): 1 or 2 wide and 4 long is a tunnel, else a cave. The cave mouth is an area of kind `yard`, type `building`, the opening grown by 1, `no_enter`. The route's legs are the `RouteStore` shape (walk, door with `kind2: 'trapdoor'`, ladder with top, bottom, face, entry, foot, walk). |
| `survey.js` (executing; E4) | `surveyBase(bot, ctx, name)`, `renameArea`, `forgetSurveyed`, `goToBase`, `surveyRadius`, `SURVEY_RULES`, `forgotPlaceText`, `noWayToBaseText` | The seeds through `bot.findBlocks` per category with the ids looked up by name, `radius = min(survey_radius, 128)`, count 20,000; `clock.wait(0)` after every category, after `findPlaces` and after each building's underground. Saves: areas (source `survey`, `base`, `flags`, `under`, `edge`), points (`base`), routes (source `survey`, only when no route of the name exists), the base (the centre of the boxes, the home's door). A re-survey gives the difference line, passes `kept` to `againText`, and removes a survey place whose seeds are gone. Own texts: `I found no way to the base "X".` and the dimension text of `!goToBase`. |
| `index.js` (E4) | the re-exports, `BaseStore`, `SURVEY_API` | No side effects; the hygiene test is `survey_modules.test.js`. |

The stores: `AreaStore` takes source `survey`, the optional `base`, `under` and `edge` (`'wall' | 'margin'`,
kept on a re-save of the same box), `rename(old, new)`, `ofBase(base)`; `isShelterType(type, area)` is true for a
building with `under` (the basement is shelter). `PlaceStore` and `MemoryBank` take `base`, `rename`,
`ofBase`/`placesOfBase`. `BaseStore` (`src/agent/world/base_store.js`): `bases.json` per world, `set`, `get`,
`list`, `remove`, `rename`. `ROUTE_SOURCES` takes `survey`.

The commands (`actions.js`, behind `base_survey`): `!surveyBase(name = '')`, `!renameArea(old_name, new_name)`,
`!goToBase(name)`, and `!forgetArea(name)` extended to a place or a base. Settings `base_survey` (false),
`survey_radius` (128). The default profile has three examples. The registrations: `PART_COMMANDS.base_survey`,
`SPEC_SETTINGS`, `SPEC_COMMANDS`, `NEW_EXAMPLES`, 7 routing sentences.

### The fix of the doorway stall (Q-1 of the owner's play of 2026-11-10; E4)

`interiorBox(box, margin)` of `box_math.js` shrinks by 1 for a box whose edge is the wall and by 2 for a box with an
air margin (`interiorMargin`, `edgeOf(read, box)` reads the ring at the walls' height, `BOX_EDGES`, `EDGE_MARGINS`);
`withEdge(area, read)` of `shelter_logic.js` resolves it from the world and the area caches it (`edge`);
`!rememberArea` saves `wall` for the floor scan and `margin` for `scanBuilding`, the survey the same. `chooseSides`
of `doors.js` (exported) takes the side inside the box before "away from the bot" when neither side is in the
interior. The executing sites: `sleep.js` (the bed's area), `shelter.js` (`goToShelter`, `enterBuilding`,
`walkToRoom`, `bedInShelter`, `isInShelter`), `doors.js` (`passThrough` with `options.inside`). An area without
the flag and no reader keeps the margin of 2. `areas/auto_home.js` saves no `edge` yet.

### The fix of the full bag in the mine (G-2 of the gate; E4's analysis and patch, applied by the lead)

`roomForDrop(bot, entity)` of `src/agent/packs/mining/dig.js` (exported): true with a free slot, or with a stack of
the drop's kind that has room; a drop of unknown kind fits only a free slot; no bot, no room. `droppedName` reads
the real entity's `getDroppedItem()` or a fake's `item`. `collectDrops` with `dig: true` walks with digging
movements to a drop only when `roomForDrop` says yes; otherwise the drop stays and is picked up when room is back.
The race itself (a flint picked up after `mineVeins` checked `roomFor` for the first ore of a vein) remains: the
second ore is noted `inventory` and the raw iron of the first lies on it until the next pass with room. Test:
`tests/unit/xs_drop_room.test.js` (7). The mining pack is otherwise unchanged since a87639e.

### Routines, `src/agent/routines/` (E2)

| Module | Exports |
|---|---|
| `routine_texts.js` (pure) | every text of SPEC 3.6 word for word: `rememberedText, knownText, fullText, listText, routineLine, noRoutinesText, forgotText, unknownText, planText, badPlanText, noPlanText, roundStartText, roundDoneText, pausedText, waitsText, everyText, conditionText, clockText, sentenceOf, planReasons, ROUTINES_OFF, NAME_TEXT, TEXT_TEXT` |
| `routine_logic.js` (pure) | `ROUTINE_RULES` (12 routines, 400 characters, every 15, 8 steps, 3 fails), `ROUTINE_STATES`, `ROUTINE_COMMAND_NAMES`, `ROUTINE_COMMANDS`, `ROUTINE_PLAN_NAMES`, `routineCommands({ mining, baseSurvey })`, `normalizeRoutineName`, `everyOf`, `conditionOf(text, isItem)`, `parseRoutineText`, `routineOf`, `routinePlanPrompt(routine, inventory, areas, chests, commands, { rules, places })`, `readPlan`, `checkPlan(steps, commands, blocked)` → `{ ok, reason, step, steps }`, `routineCheckOf`, `isDue`, `conditionHolds`, `nextRoutine(routines, now, inventory = {})`, `noteRound`, `routinesJson` |
| `routine_store.js` | `RoutineStore(filePath | null, { now })`: `load, bind, list, get, set, remove, size, clear`; `ROUTINES_FILE = 'routines.json'` (`{ version: 1, routines: [...] }` in the order given), `validateRoutine` |
| `routines.js` (executing) | `createRoutines(agent, store, options)` → `remember, list, forget, doNow, due, startRound, onRoundEnd, json, bind, get, all`; `ROUTINES_TOOL`, `registerRoutinesTool(register, settings)`, `ROUTINES_WARNING`; re-exports `RoutineStore, ROUTINES_FILE, ROUTINE_COMMAND_NAMES, ROUTINES_OFF` |

The job module: `job_logic.js` exports `ROUTINE_KIND = 'routine'` beside `JOB_KINDS` (not in `JOB_COMMANDS`);
`isDone` and `resumeCommand` know it; `job_store.js` accepts it with `routine` and `round`; `job_texts.js` says
`I was doing the routine "x", round 5. I go on.` at a restart; `index.js` gets `options.routines`,
`startRoutineRound(routine, round)`, `leaveRound(name)`, `finishRound`, `failRound`, `roundLeft`, `runRound`; the
tick runs a due routine before `idle_jobs`; a failed step ends the round without a plan; a step's result goes out
with `history: false` (one line in `_runJobOrder`) and a round's lines go to the chat through `sayQuiet`
(`openChat`, quiet with `shut_up`), so a round makes no model call. The one model call is the plan, through
`promptPlan`, with `buildRulesSection` in the prompt and the places line `The places the bot knows: the areas farm
(farm); the places post, spot.` Routine names keep their spaces; `every N hours` and `less than` are read too; a
failed or NONE plan pauses the routine, `!doRoutine` unpauses and replans; `!doRoutine` refuses any running job with
its `busyText`. The routine store is bound at spawn beside the job store (`_bindRoutinesToWorld`). The commands:
`!rememberRoutine(name, text)`, `!routines()`, `!forgetRoutine(name)`, `!doRoutine(name)`, behind `routines`; the
watch tool `routines` through `registerRoutinesTool`; `SKILL.md` step 3 names it.

### The prompt budget (SPEC 4)

With every switch on: 18,596 characters with the block of the new things (17,511 before; the growth exactly the
eight commands' docs, 552 + 533 = 1,085, rounded up to 1,100): `LIMIT_ALL_ON` 18,300, `LIMIT_NEW_THINGS` 18,700,
the rules case of `st_glue_prompt` 19,100 (18,906 measured); `LIMIT_ALL_OFF` 11,000 unchanged (10,400 measured),
so with both switches off the prompt is byte for byte v0.1.4.14's.

### The scenarios (T3)

W126 `survey_base` (base world, 1200 s): the built base of SPEC 7.1 (the ghast leashed with `leash:[I;x,y,z]`,
the portal lit), checks A to E; W127 `farm_routine` (base world, 1200 s); `s20_routine_round` on the fake server
(two typed walks between saved places). `s19` is skipped (the fake server holds no blocks). The runner's substring
rule is why the entry is `survey_base`.

### Open for the next engineer

- `reportText`'s third argument (`changed`, the replaced names) is passed and unused by the text.
- `!renameArea` does not rename routes whose `from` or `to` names the old area (routes keep working by position).
- `areas/auto_home.js` saves no `edge`.
- Round 3 of PLAN 4 (the `base` tag, `bases.json`, `!goToBase`, the differences on return) is in; an offer on arrival
  and a walk for bases larger than the loaded radius are later.
