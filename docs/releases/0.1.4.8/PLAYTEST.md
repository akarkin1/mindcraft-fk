# Play test v0.1.4.8 "Stability"

This release answers your play test of 2026-09-29. Every defect you reported is corrected, and 15 more that the tests on the real server found.

## 1. Get the release

Your checkout has local changes in four files: `settings.js`, `profiles/claude.json`, `profiles/gpt.json` and `start-claude.ps1`, plus your own `start-gpt.ps1`. Two of them collide with the release when you pull. I checked it.

**The easy way:** stop the bot and tell me. I update your checkout, keep your changes, resolve the two collisions, set the new switches and run `npm install`.

**The way by hand**, in PowerShell 7, in the repo folder, with the bot stopped:

```powershell
git stash
git checkout main
git pull
git stash pop
```

`git stash pop` reports a conflict in `settings.js` and in `profiles/claude.json`. Both are small:

| File | What you see | What to keep |
|---|---|---|
| `settings.js`, at `home_pack` | Two versions of two lines | `"home_pack": true` and the line `"home_reflexes"` that contains `"hunger": true` |
| `profiles/claude.json`, at `conversing` | Two versions of the prompt line | Your line `"embedding": "openai",` and the new `conversing` line, which is the one with only one house rule |

Delete the markers `<<<<<<<`, `=======` and `>>>>>>>`, save both files, then tell git that they are resolved and drop the stash:

```powershell
git add settings.js profiles/claude.json
git reset
git stash drop
npm install
```

`git reset` here only takes the files out of the staging area; your changes stay in the files.

**`npm install` is needed this time.** The correction of the chat kick is a patch of the network library, and `npm install` applies it. The line `minecraft-protocol@1.62.0 ✔` in its output shows that it did.

## 2. Switch the parts on

Your seven switches of last time stay. New in `settings.js`:

```js
"stuck_restart_after": 3,
"protect_built_blocks": true,
"knowledge_in_prompt": true,
"examples_by_last_request": true,
"repeat_guard": 3,
"restart_context": true,
"say_results": true,
"flee_below_health": 8,
"log_timestamps": true,
```

The hunger reflex is on with `home_pack`. Start with the log:

```powershell
.\start-claude.ps1 -Log
```

## 3. What happens at the first start, by itself

| The bot | What you should see |
|---|---|
| Moves the food out of its off-hand | Nothing to see, or "I moved N bread from my off-hand into my inventory." |
| Saves your house as the area `home` | "I saved your house as the area "home": X x Y x Z blocks, N doors. Tell me if that is wrong." If it says it finds no walls, stand in the house and say "this place is home". |
| Loads your saved areas | Your two mine areas become one of type `mine`. The pen of 1 x 3 x 1 blocks is dropped. |

Then stand in the pen and say: **"this is the pen for my animals"**. The bot answers with the size and the gate.

## 4. The checks

Each row is one defect of your play test. Do them in any order.

### Stability

| Step | What you do | What should happen |
|---|---|---|
| 1 | Talk with the bot for 25 messages or more in one go | No kick. In your play test the bot was kicked at your 21st message every time. |
| 2 | Give it work that stands still: "put everything in the chest", "make yourself a stone pickaxe" | It finishes. No "I'm stuck!", no restart. |
| 3 | Say "come here" three times in a row | It comes three times. The repeat guard refuses only failures. |
| 4 | Stop a long job with "stop" | It stops within a second and tells you what it did so far |
| 5 | Ask "how much did you cost?" after a restart | The number includes the processes before the restart |

### Eating

| Step | What you do | What should happen |
|---|---|---|
| 6 | Let the bot get hungry while bread lies in a chest it knows | It fetches bread and eats, without an order |
| 7 | Give it food and say "eat" | "I ate N bread. Food 20 of 20, health M of 20." The number is right. |
| 8 | Let it get hungry with no food anywhere | "I am hungry and carry no food. Food N of 20." once, later "I am starving. ..." |

### Your property

| Step | What you do | What should happen |
|---|---|---|
| 9 | Near the pen say "collect some oak fence" | It refuses: "oak_fence is a block that players build with. I do not break it. ..." The fence stands. |
| 10 | Drop some items and say "pick up what I dropped" | It picks them up, also right after you threw them |
| 11 | Say "come here" through a wall of the house | It comes through the door, not through the wall |

### The reflexes

| Step | What you do | What should happen |
|---|---|---|
| 12 | Be in the mine with the bot at dusk | It stays. No "It is getting dark", no walk to the shelter. |
| 13 | Be in the mine while a creeper is on the surface above | It ignores the creeper |
| 14 | Let it go to the shelter at dusk from the farm | The gate and the door are closed behind it |
| 15 | Say "go to bed" by day | "I cannot sleep now, it is day. The night starts in about N minutes." |
| 16 | Say "go to bed" at night, then "come here" in the morning | It sleeps, and it gets up and comes when you call |
| 17 | Say "switch off the creeper reflex" | The bot refuses. Type `!setMode("creeper_safety", false)` yourself in the chat: that works. |

### Chests, farm, wood

| Step | What you do | What should happen |
|---|---|---|
| 18 | Ask "do we have wheat in the chests?" | It answers from memory, with the chest and the number, without walking |
| 19 | With unripe wheat and leaf litter in a chest say "get back to farming" | One command does the round: bone meal from the leaf litter, fertilize, harvest what got ripe, gate closed. Every block of farmland is still farmland. |
| 20 | Say "get me 8 logs" | It gets an axe first, and it comes back with 8 logs or more |
| 21 | Say "find some iron" | It asks before it digs a new mine, and digs nothing until you say yes |

## 5. Known limits

- **The bed.** The bot finds no way from the storage room down to the bed. It says so and digs nothing. The routes that it learns by walking with you come with v0.1.4.9.
- **Your mine.** `!mineOre` cannot use your mine yet. That is v0.1.4.9 too.
- **The area `home`** may include the top of your shaft, because the scan follows the ladders down.

## 6. What I would like to know

- The log of the session under `%LOCALAPPDATA%\Mindcraft\logs`, now with time stamps.
- The line of `!cost` at the end.
- Anything the bot did wrong or did not understand, in your words.

## 7. If you try GPT-6 Luna again

- Copy the new `conversing` text of `profiles/claude.json` into `profiles/gpt.json`. Yours still has the four house rules, which made Luna refuse your orders at night.
- Set reasoning effort `low`.
- The bot `gpt` has its own memory. Its saved areas "mine entrance" and "mine" become areas of type `mine` at the first start. If that is wrong, say "forget the area mine entrance" and show the places again.
- `!cost` shows nothing for GPT until the model comparison release.
