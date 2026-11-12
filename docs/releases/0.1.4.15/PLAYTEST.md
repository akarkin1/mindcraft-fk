# Play test v0.1.4.15 "The base survey and Routines"

This release gives the bot the base survey (`!surveyBase`: "here is the base, scan it" saves every place at
once) and Routines (`!rememberRoutine`: a paragraph in your words becomes a standing routine it works when it
has nothing else to do), both behind switches that are off by default; fixes the doorway stall of your play of
2026-11-10 (Q-1); and fixes a full bag in the mine that the gate found (a flint from a dug gravel). Off, the
prompt is byte for byte v0.1.4.14's.

You played the branch at 33cae12 on 2026-11-11 (R-1 to R-13 in `docs/ROADMAP.md`, into 0.1.4.16 by your word).
The release differs from what you played in one thing: the full-bag fix (section 5, step 10). The rest of this
guide is the record of the walks, for a second play or a new world.

## 1. Get the release

In PowerShell 7, in the repo folder, with the bots stopped and Node 22 active (`fnm use 22`):

```powershell
git stash
git checkout main
git pull
git stash pop
```

No `npm install`: the libraries, the lock file and the patches are the ones of v0.1.4.14. Your worlds, memory
and `bots/` are unchanged; the survey adds areas and places with source `survey` beside yours and never renames,
re-boxes or forgets your own.

## 2. Switch the new parts on

New in `settings.js` (or the page's Settings):

```js
"base_survey": true,
"survey_radius": 128,
"routines": true,
```

Off, the eight new commands are blocked and the prompt is v0.1.4.14's. `survey_radius` caps the survey at 128
blocks around the bot; it reads only the loaded blocks anyway.

## 3. The survey

| Step | What you do | What should happen |
|---|---|---|
| 1 | Stand in your base and type `!surveyBase("base")` (or say "here is the base, scan it"). | The command answers one line: `I found N places: house (1 bed, 2 chests), ..., cow pen (5 cows), ... All saved. Say "rename X to Y" or "forget X" to correct.` Typed, you read that line itself; said in words, the model runs the command and tells you in its own sentence (R-3 of your play: the line should be the bot's own, a change of 0.1.4.16). Your own areas are kept and said so (`inside your "wheat farm" (kept as yours)`); nothing of yours renamed, re-boxed or forgotten. The base lands in `bots/<bot>/worlds/<seed>/bases.json` with its places. |
| 2 | Look at `areas.json` and `places.json` of the world. | The new entries carry `"source": "survey"` and `"base": "base"`; the buildings of a floor scan carry `"edge": "wall"`. |
| 3 | "rename cow pen to cows" and "forget trading_hall_2" (or `!renameArea("cow_pen", "cows")`, `!forgetArea("trading_hall_2")`). | `I renamed "cow_pen" to "cows".`; `I forgot "trading_hall_2".`; `!forgetArea("base")` forgets the base with all its places (`I forgot the base "base" and its 12 places.`). |
| 4 | "scan the base again" after a change (a new pen, more cows). | The differences only: `I surveyed "base" again: 2 more cows in the cow pen, the pig pen is new. The rest as saved.` |
| 5 | From 100 blocks away: `!goToBase("base")`. | It walks to the base's door and says `I am at the base "base".` (R-2 of your play: on a base near a village the centre and door were the village's; a finding of 0.1.4.16.) |
| 6 | Underground: a basement under a trapdoor and a ladder, a mine entrance, a cave mouth. | The basement counts as shelter at night; the cave mouth is a place the bot keeps out of; the way house, trapdoor, ladder, basement, mine is a route. |

## 4. Routines

| Step | What you do | What should happen |
|---|---|---|
| 7 | `!rememberRoutine("wheat", "harvest the wheat farm and plant it again, then put the wheat in the chest by the door, every 10 minutes")` (a text up to 400 characters). | `I remember the routine "wheat"; its first round plans the steps.` At the first idle moment the model plans the steps once (your rules in the prompt, the places and chests the bot knows), code checks every step, and the round runs as a job with no model call. `!routines` lists them with the next time; the supervisor's watch tool `routines` the same. |
| 8 | Let it run two rounds; say "stop" during one. | The wheat harvested, replanted and in the chest after each round; "stop" ends the round (`I leave the routine "wheat".`); the routine stays and runs again at its time. Three failed rounds pause it and it says so. |
| 9 | `!doRoutine("wheat")` to run a round now; `!forgetRoutine("wheat")` at the end. | A round at once; `I forgot the routine "wheat".` (R-5 of your play, the plan dropping a given place, a failed step ending the round, the round number, a round in the middle of the supervisor's work: findings of 0.1.4.16.) |

## 5. The two fixes

| Step | What you do | What should happen |
|---|---|---|
| 10 | "mine 6 iron" in a mine whose tunnel has gravel in the way, with a nearly full bag (two free slots). | Without the fix a flint from the gravel fills the bag, the raw iron of the next ore lies where the bag cannot take it, the bot digs the tunnel's ceiling to reach it and ends with `My bag is full of things I keep for the mining. I stop the mining at 1 of 6 iron.` With the fix it leaves the drop lying, stores its things in the mine chest and goes on; the drop is picked up on the next pass with room. |
| 11 | At night, inside the house by a wall: "go to sleep" (Q-1, confirmed twice in your play). | It walks to the bed and sleeps; it never leaves through its own door. |

## 6. What I would like to know

- Whether a mining run of yours still ends `I stopped because I got stuck` after a store trip (R-7): the bot's lines
  right before it, from the log, tell the full-bag race from another cause.
- The report line of a typed `!surveyBase` on your base (`I found N places: ...`), word for word: it tells how the
  survey read your base against the model's summary of 2026-11-11 (R-3).
- Each bot's log and the server log, as before.
