# Play test v0.1.4.13 "Supervision"

This release lets a supervisor (a Claude Code session) watch and steer the bot cheaply, puts the bots and the supervisor in one chat, corrects what went wrong in the supervised play of 2026-10-04, shares the memory of a world between two bots, and fixes the creeper crash.

## 1. Get the release

In PowerShell 7, in the repo folder, with the bots stopped:

```powershell
git stash
git checkout main
git pull
git stash pop
Remove-Item -Recurse -Force node_modules\minecraft-data, node_modules\mineflayer-pathfinder
npm install
```

Two library patches changed (the explosion packet of `minecraft-data`, the pen gates of the path search). Over a `node_modules` that carries the old patches the new ones cannot be applied: remove the two packages first. Check: `Select-String vec3f64 node_modules\minecraft-data\minecraft-data\data\pc\1.21.8\protocol.json` prints a line.

## 2. Switch the parts on

Your switches of v0.1.4.12 stay. New in `settings.js` (or the page's Settings):

```js
"supervisor_name": "Opus",
"supervisor_updates": true,
"shared_memory": true,
"prompt_cache": true,
"mine_other_ores": true,
"voice_ui": true,
```

`voice_ui` needs `npm run voice:setup` once (about 1.6 GB). `watch_report_seconds` stays 0 unless you want a report event every N seconds.

## 3. Two bots, one chat

| Step | What you do | What should happen |
|---|---|---|
| 1 | Both bots near you: "claude, come here". | Claude comes. gpt stays where it is and says nothing. |
| 2 | "come here" | Both come. |
| 3 | Claude saves the mine (`!rememberMine("deep")` in the room). Then "gpt, what mines do you know?" | gpt names "deep": one memory (`shared_memory`). The first start with the switch says `I share the memory of this world now.` |
| 4 | Walk through your chicken pen and say "follow me". | Neither bot opens the gate; one says `That is a pen with N chickens; I do not open its gate. Say "open the pen" if you mean it.` Say "open the pen": it comes through and the gate is closed behind it. |

## 4. The supervisor

| Step | What you do | What should happen |
|---|---|---|
| 5 | Start a bot with the watch server, open the tunnel as in v0.1.4.12, and start a fresh Claude Code session in the repo with `/supervise` and one sentence, e.g. "diamonds for a full set, avoid lava, stop at 36". `docs/SUPERVISOR.md` has the steps. | The supervisor waits for changes instead of polling. |
| 6 | "Opus, how is it going?" in the game chat or by voice. | No bot answers; within 5 to 30 s `[Opus] ...` in chat, spoken in another voice than the bot's. |
| 7 | Let it mine for 20 minutes. | Short updates from Opus only when something happens (`supervisor_updates`), never over a bot's answer. |
| 8 | After the session: the cost line of each bot's log and the supervisor's own report. | The supervisor's cost should be about a cent a turn; the bot's line shows the cache reads and writes. |

## 5. The corrections

| Step | What you do | What should happen |
|---|---|---|
| 9 | In the deep mine, with bread in the chest beside the tunnel and little food in the bag: "mine 10 diamonds". | `I get my supplies: N bread from the chest at (...)`: from that chest, no trip to the basement. |
| 10 | Let the pickaxe wear down. | Before it breaks: `My iron_pickaxe is nearly worn: N uses left. I made a new one.` (or `I take my spare one.`), and it mines on. |
| 11 | A full bag during the mining. | `I stored ... in the chest at (...) and go on.` |
| 12 | "make me an iron pickaxe" with a furnace in the bag and none near. | `I placed my furnace at (...)`, then the smelt and the pickaxe, without a second order. |
| 13 | `!goToCoordinates` to a point 20 blocks below the bot. | `I do not dig a shaft 20 blocks down. Say "dig down" if you mean it, or show me stairs.` It stays. |
| 14 | Die near a bot (or drop your things and step away), then come back. | `I leave MartyByrde2's things at (...)`; it does not wear your armour. |
| 15 | "give me 30 cobblestone". | `That is a lot. Say "put my stuff in the chest" ...`; 8 or fewer are thrown, and it steps back. |
| 16 | In an unknown mine underground: "mine 5 iron". | `I made the mine "mine 2" here and measured the tunnel ...` and it mines. |
| 17 | Down in the mine: "get to the surface". | It takes your route up: `I take the route "basement_to_surface".` |
| 18 | Let a creeper blow near the bot. | The bot lives on or dies; the process does not crash. |

## 6. What I would like to know

- Each bot's log and the server log; the supervisor session's report.
- The cost line of Haiku with `prompt_cache` on: whether cache reads appear at all (Haiku caches only from 4,096 tokens; our fixed part is close to that).
- Where a bot answered a line that named the other one, or neither answered.
- Where the supervisor talked over a bot or was too slow to be useful.
