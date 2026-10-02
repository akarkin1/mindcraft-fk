# Play test v0.1.4.11 "Navigation and words"

This release changes the words the bot answers with, lets a mine grow a shaft from inside, accepts the tunnel where you stand, makes "the surface" mean the open sky, saves a place from one sentence with the kind the bot concludes itself, and walks your routes with the path search from wherever the bot is.

## 1. Get the release

In PowerShell 7, in the repo folder, with the bot stopped:

```powershell
git stash
git checkout main
git pull
git stash pop
npm install
```

`npm install` is needed when you come from v0.1.4.9 (the path search patch); from v0.1.4.10 it changes nothing.

## 2. Switch the parts on

Your switches of v0.1.4.10 stay. New in `settings.js`:

```js
"mine_from_inside": true,
"area_sense": true,
"routes_by_search": true,
```

Both profiles got two lines ("a question gets an answer", "a rule names a saved place"); your `profiles/claude.json` keeps its voice otherwise. Start with the log: `.\start-claude.ps1 -Log`.

## 3. The words

| Step | What you do | What should happen |
|---|---|---|
| 1 | Give an order that fails: "go to the mine" with the room door blocked, "give me 4 wheat" with none in the bag. | Every answer names the cause and the next step. Never "Show me the way again". |
| 2 | Ask a question while the bot works: "what are you doing?", "can you find the way on your own?" | An answer in words. The running command goes on. |
| 3 | Say "dig a tunnel" in the room, in a tunnel, on the surface. | `I do not write code for digging. From here: !mineOre("iron", 8).` with the call that fits where it stands. |
| 4 | "give me 4 wheat" and pick them up. | `Gave 4 wheat to MartyByrde2.` When you do not: `MartyByrde2 took 0 of 4 wheat; 4 lie on the ground at (x, y, z).` |

## 4. The mine

| Step | What you do | What should happen |
|---|---|---|
| 5 | Stand at the rock face of your tunnel, the bot behind you, and say "dig here". Then with the bot at the rock face. | `I measured the tunnel: ...` both times, with "from where you stand" the first time. No "I stand in no tunnel". A 2-wide tunnel says "2 wide". |
| 6 | In the room say "find 2 diamonds" and confirm the new mine. | `I dig a shaft down from here to level -58 for diamond.` A column of ladders from the room floor down. The bot comes back up through the room. `!mines` lists `bot:-58 (from the mine "mine")`. |
| 7 | From the bottom say "get out". | It climbs the shaft, steps into the room, takes your way out. |
| 8 | Inside the house say "get to the surface". | It goes out through the door and says `I went out through the door at (x, y, z) and stand under the open sky at (x, y, z).` Never the roof. |

The inner shaft never starts on your way out (under a ladder, in a doorway): the bot moves to the nearest free floor cell of the room first. In the middle of a tunnel it leaves a hole in the floor (known limit): dig it from the room.

## 5. The places

| Step | What you do | What should happen |
|---|---|---|
| 9 | Stand in the aviary with the chickens inside and say "we are in the aviary". | `I saved "aviary": a pen, fenced, 9 x 7, 1 gate, 6 chickens. I keep its gate closed and pick nothing up inside it.` The size counts the fence. |
| 10 | In the wheat field: "this is the farmland". In the house: "this is the home". | `a farm, fenced, ...` and `a home, walled, ... with a roof, 1 door, 1 bed`. |
| 11 | Say "no, it is a farm" about a wrong kind. | `"aviary" is a farm now. I only plant and harvest there.` |
| 12 | Walk the bot into a fenced place you never named. | After 3 s: `I am in a fenced pen 9 x 7 with 6 chickens and 1 gate that I have not saved. Tell me its name and I keep it.` Once per place. |

Name a pen while its animals are inside: an empty fence is a yard, which the bot may enter. On open ground with no border at all nothing is saved (`I find no border around me: ...`); say the corners with `!setArea` for such a place.

## 6. The routes

| Step | What you do | What should happen |
|---|---|---|
| 13 | "Follow me" halfway down the ladder, stop, then "go to the mine". | It goes on down from where it is, never back up. |
| 14 | From the tunnel: "get out". | Up through the room and the ladders, every door closed behind it. |
| 15 | Block the room door and say "go to the mine" from the house. | `I find no way from (x, y, z) to the door at (x, y, z): it is closed and I cannot open it.` and it does not move. |
| 16 | Stand behind a wall and say "come here". | `I find no way to you from here without digging. Come closer or tell me to dig.` No block broken. |
| 17 | "Come here" from the house to the mine room and back. | It walks, opens the doors on its way, climbs the ladders, places a missing ladder when it carries one. |

## 7. What I would like to know

- The log and the scorecard (`node scripts/scorecard.js <log>`): the new line `Failure texts` says which text the model hit most.
- Any answer that does not name its cause.
- The kinds the bot concluded for your places, right or wrong.
