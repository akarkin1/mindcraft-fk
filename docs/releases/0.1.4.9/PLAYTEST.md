# Play test v0.1.4.9 "The mine, the routes of the player, and the model comparison"

This release teaches the bot your mine and the ways of your base by walking with you. It also counts the cost of GPT-6 Luna and lets the routing check compare Luna with Haiku.

## 1. Get the release

Your checkout has local changes in `settings.js` and `profiles/claude.json`, and your own `start-gpt.ps1`. The two launch scripts are in the release exactly as you had them, so they do not collide. `profiles/claude.json` does not change in this release. `settings.js` gets five new lines after `examples_by_last_request`; your changed values are on other lines. `profiles/gpt.json` collides: the release version wins, you set your TTS voice again if you want it.

In PowerShell 7, in the repo folder, with the bot stopped:

```powershell
git stash
git checkout main
git pull
git stash pop
```

If `git stash pop` reports a conflict in `profiles/gpt.json`: keep the version of the release (the one with `gpt-6-luna`, `"speak_model": "system"` and the `code_model`), then `git add profiles/gpt.json`, `git reset`, `git stash drop`. If `settings.js` conflicts, keep your values and the five new lines.

**`npm install` is needed.** The way out of your shaft is a patch of the physics library, and `npm install` applies it. The line `prismarine-physics@1.10.0 ✔` in its output shows that it did.

## 2. Switch the parts on

Your switches of last time stay. Two things from your play of 2026-10-01 first:

- `"stuck_restart_after": 3` in `settings.js`. Your file still has the default `1`, which killed the process 10 seconds after "I'm stuck!" twice. With `3` the bot gives up, tells you where it is stuck, and waits for you.
- `"embedding": "openai",` after `speak_model` in `profiles/claude.json`. The line was lost when you pulled; without it the log says "Error with embedding model" three times at every start.
- Delete the entry `"16"` from `bots\claude\worlds\seed-ce66bf80acdefa75\mines.json`, or the whole file. It is a mine the bot dug on 09-28, 6 blocks from your door, and `!mineOre` would choose it before yours.

New in `settings.js`:

```js
"routes_pack": true,
"mine_routes": true,
"ore_sense_range": 0,
"skills_over_code": true,
```

`trail_max_steps` stays at 500. Set `ore_sense_range` to `3` only on your own world if you want the bot to take ore that lies within 3 blocks of the tunnel wall.

Start with the log:

```powershell
.\start-claude.ps1 -Log
```

## 3. Teach the bot your mine

Do this once. The bot records where it walks from the moment it starts, so it must walk the way itself.

| Step | What you do | What should happen |
|---|---|---|
| 1 | Stand outside, in the open, near the entrance. Say **"follow me"**. | The bot follows. |
| 2 | Walk into the house, down the ladder through the trapdoor, into the entrance room, down to your tunnel, to its end. Walk, do not sprint far ahead; wait at the foot of the ladder until the bot is down. | The bot opens the trapdoor, slides down the ladder and follows on: `I go down the ladder at (x, y, z) after MartyByrde2.` in the log. If it says `I could not go down the ladder ...`, stand still at the foot of the ladder and say "come here". |
| 3 | At the end of the tunnel say **"this is the mine, remember this"**. | `I remember the mine "mine": the entrance at (x, y, z), the way in has N steps with 1 ladder and 1 trapdoor, the room at level 41 with a chest and a crafting table, one tunnel at level 25, 12 blocks long, going south.` The numbers are yours. |
| 4 | If it says `I was not under open sky in my last N steps` | Start again from step 1, from further outside. |
| 5 | Stand in another tunnel and say **"dig here"**. | `I measured the tunnel: it starts at (...), goes east, and ends at (...) after N blocks, at level L.` |
| 6 | Say **"which ways do you know"**. | `I know 1 route: ...` or the routes it has. |

The mine is in `bots\claude\worlds\<world>\mines.json`. Delete the entry and repeat if it went wrong.

## 4. Work in your mine

| Step | What you do | What should happen |
|---|---|---|
| 7 | On the surface say **"find some iron"**. | It walks in by the way it learned, goes to the tunnel whose level fits iron, digs on at its end, and comes back up through the trapdoor. `I mined 8 raw_iron. The mine is at ...` No new shaft, no question. |
| 8 | Ask for diamond. | If no tunnel is deep enough: `Your mine "mine" has no tunnel where diamond is found (from -64 to 16). Its tunnels are at level 25. Show me a tunnel at that depth, or tell me to dig a new mine.` |
| 9 | After a trip, ask **"what ore did you leave behind?"** | The block "what I know" holds a line `Ore left behind: ...`; the bot answers from it. |
| 10 | Say **"collect the coal you passed"**. | `I collected N coal_ore that I had passed.` |
| 11 | Be in the mine at dusk. | The bot stays. No walk to the shelter. |
| 12 | Say **"write code to dig a tunnel to the east"**. | `I do not write code for digging. I have skills for it: ...` No code is written. |
| 13 | Once a tunnel is 32 blocks long, ask for ore again. | It digs branches of 8 blocks to the left and the right, every 4 blocks. |
| 13a | Stand at a chest with logs and coal, say **"check the chest"**, then **"make 32 torches"**. | It names the items of the chest, takes what it needs from it and says `I made 32 torches.` or what is still missing: `I made 28 torches of 32. I need 1 coal more and know no chest with coal.` |
| 13b | After a trip, look into the chest of the mine. | No torches, ladders or pickaxes in it: the bot keeps its supplies. The new part of the tunnel has a torch. |

## 5. The way to your bed

| Step | What you do | What should happen |
|---|---|---|
| 14 | Say "follow me" in the storage room, walk to your bed, and say **"remember this way to the bed"**. | `I remember the way "bed": from the place "..." to here, N steps, 1 ladder. I walk it in both directions.` If it says it does not know where the way starts, first say "remember this place as storage" in the storage room, then walk again. |
| 15 | At night, from the storage room, say **"go to bed"**. | It walks the way it learned and sleeps. |
| 16 | In the morning say **"go to storage"** (the place you saved). | It walks the way back, down the ladder. |
| 17 | Block the way (a block on the ladder) and repeat step 16. | `I could not follow the route "storage" at step N of M, at (x, y, z). Show me the way again.` It digs nothing. |

## 6. GPT-6 Luna

- Start the gpt bot with `.\start-gpt.ps1 -Log`. It needs both secrets in the vault: the code model is a Claude model.
- Play a few minutes, then say "how much did you cost?". `!cost` counts Luna now.
- The routing check with Luna: `.\test-routing.ps1 -Model gpt-6-luna` (about 10 cents), and with Haiku: `.\test-routing.ps1` (about 1 dollar). The summary line of each: `Accuracy: N of 136 (P%). Time per answer: median X s, mean Y s. Cost: Z dollars, measured.` Send me both lines.

## 7. Known limits

- **The way into the mine must be walked.** A teleport or a respawn empties the trail. Only what the bot walked since then can become a route.
- **A route needs a known start.** "Remember this way" starts at the last saved place, area or mine the bot passed. Save the place first.
- **One name per mine.** A mine named with a number collides with the mines the bot dug itself.
- **The area `home`** may still include the top of your shaft, as in v0.1.4.8.

## 8. What I would like to know

- The log under `%LOCALAPPDATA%\Mindcraft\logs`.
- Your `mines.json` and `routes.json` from the world folder after the teaching, and the line of `!cost`.
- The two summary lines of the routing check.
- Anything the bot did wrong or did not understand, in your words.
