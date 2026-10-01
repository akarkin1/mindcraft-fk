# Play test v0.1.4.10 "Goals"

This release makes the bot keep the job you gave it, lets the path search climb ladders and open trapdoors by itself, keeps the item reflex out of your pens, tells the house and the basement apart, and turns a play log into a table.

## 1. Get the release

In PowerShell 7, in the repo folder, with the bot stopped:

```powershell
git stash
git checkout main
git pull
git stash pop
npm install
```

**`npm install` is needed.** The path search is a patch of `mineflayer-pathfinder`, and `npm install` applies it. The line `mineflayer-pathfinder@2.4.5 ✔` in its output shows that it did.

## 2. Switch the parts on

Your switches of v0.1.4.9 stay. New in `settings.js`:

```js
"job_memory": true,
"job_resume_seconds": 60,
"idle_jobs": [],
"idle_jobs_minutes": 15,
"area_floors": true,
```

Leave `idle_jobs` empty for the first session. For the second, try `["!farmCycle(\"farm\")", "!craftSupplies(\"torch\", 16)"]` with the names of your areas.

Delete `bots\claude\job.json` if one exists from a test. The file `mines.json` of your world is rewritten as version 2 at the first start; every mine is kept.

Start with the log:

```powershell
.\start-claude.ps1 -Log
```

## 3. The job

| Step | What you do | What should happen |
|---|---|---|
| 1 | Say **"find 16 iron"**. | The bot goes to the mine and mines. |
| 2 | After a minute say **"follow me"**, walk 20 blocks, stop, and say nothing for a minute. | `I go back to the mining, N of 16 iron.` It walks back to the mine and goes on by itself. |
| 3 | Say **"that's enough"** or **"stop"**. | `I leave the mining at N of 16 iron.` |
| 4 | Give it a job it cannot do: put its torches and pickaxe into the chest, say **"find 4 iron"**. | `I have no torches. I get wood, planks, sticks and torches, then I go on.` or the pickaxe first; then `Step 2 of 4 done: ...` lines, then the iron. At most 3 plans; then `I could not plan the steps for the torches. Tell me what to do.` |
| 5 | Restart the bot while a job runs. | `I was mining iron, 6 of 16. I go on.` |
| 6 | Ask **"what are you doing"**. | The knowledge block has `Job: the mining, 6 of 16 iron.` and the answer says so. |

## 4. Ladders and trapdoors

| Step | What you do | What should happen |
|---|---|---|
| 7 | Say **"follow me"** and go down your ladders, through the trapdoors, into the mine. | It follows without a stop and without a step back on the ladder. The trapdoor behind it is closed. |
| 8 | Stand in the mine room and say **"come here"** from a floor above or below. | It comes down or up by itself, the trapdoor closed behind it. |
| 9 | From the house say **"go to bed"** at night with the bed in the basement. | It goes down the ladder and sleeps. |

Look for lines `I go down the ladder at` or `I climb up the ladder at` in the log: with this release the path search climbs by itself, and those lines mean the fallback took over. Send me the log if you see many.

## 5. The pen and the floors

| Step | What you do | What should happen |
|---|---|---|
| 10 | Drop a few fences inside the chicken pen, the bot outside. | `I leave the oak_fence in the pen "pen". I do not open its gate.` The gate stays closed. |
| 11 | Say **"never enter the chicken pen"**. | `I marked the area "chicken_pen" as keep out.` The reflex stays out from then on, whatever the type of the area. |
| 12 | Walk the bot out of the pen through the gate. | The gate is closed as soon as the bot is through it. |
| 13 | Upstairs say **"this is home"**, then in the basement **"this is the basement"**. | Two areas: the house floor and the basement. Said again from the house: `That is the area "home" already.` |
| 14 | Say **"which mines do you know"** and **"forget the mine 16"**. | `I know 2 mines: ...` and `Forgot the mine "16".` |

## 6. The tools

- `node scripts/scorecard.js %LOCALAPPDATA%\Mindcraft\logs\<log>` after a session: one table with the minutes, the orders, the calls and the cost per model, the stuck lines and the doors left open.
- `node scripts/dump_region.js --port 55916 --center <x> <y> <z> --radius 24` while your world runs and you stand at home: it writes `tests/world/owner_region.json`, from which the test base is built from then on. Commit that file to the repo.
- `npm run test:play` with your key in the environment: the first minutes with the chat model of your profile, about 10 cents with Luna. Send me its table.

## 7. Known limits

- A staircase built of bottom slabs or bottom stairs is no way for the path search any more; it walks around.
- A ladder that ends 2 blocks above the floor (your second shaft) needs ladders in the bot's bag: it places the missing ones. Without ladders it says so.
- The standing list needs `job_memory`.
- The job comes back while "follow me" runs: a minute of silence ends the follow.

## 8. What I would like to know

- The log, the scorecard table, and `job.json` after a session.
- Whether a climb ever stepped back, and the two lines of `npm run test:play`.
