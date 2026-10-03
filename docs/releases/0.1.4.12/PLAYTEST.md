# Play test v0.1.4.12 "Understanding and watching"

This release lets me watch your play from the cloud, teaches the bot a pattern from what you build, smelts, names a tunnel as a tunnel, fixes five small things, and keeps two bots from talking to each other.

## 1. Get the release

In PowerShell 7, in the repo folder, with the bot stopped:

```powershell
git stash
git checkout main
git pull
git stash pop
Remove-Item -Recurse -Force node_modules\mineflayer, node_modules\mineflayer-pathfinder
npm install
```

Two library patches changed (the wake packet, the point behind a door). Over a `node_modules` that carries the old patches the new ones cannot be applied, and `npm install` says so only in its output: remove the two packages first, as above. Check: `Select-String leave_bed node_modules\mineflayer\lib\plugins\bed.js` prints a line.

## 2. Switch the parts on

Your switches of v0.1.4.11 stay. New in `settings.js`:

```js
"watch_server": true,
"watch_port": 8090,
"watch_and_learn": true,
"smelting": true,
```

`other_bots` and `bot_role` only for section 8. The scans underground, the small items and the job changes have no switch.

## 3. The watch server, the pilot

| Step | What you do | What should happen |
|---|---|---|
| 1 | Put a token in your vault once: `Set-Secret -Name MindcraftWatchToken -Secret (-join ((48..57)+(97..122) \| Get-Random -Count 32 \| % {[char]$_}))`. Start the bot with `.\start-claude.ps1 -Log`. | The console says `The watch server listens on 127.0.0.1:8090.` Without the token it says `The watch server does not start: MC_WATCH_TOKEN is not set.` and the bot plays as before. |
| 2 | In a second PowerShell: `$env:MC_WATCH_TOKEN = Get-Secret -Name MindcraftWatchToken -AsPlainText; node scripts/watch.js state` | One line per fact: where the bot is, the time, health and food, what runs, the job, your last order, home. `node scripts/watch.js say "come here"` makes the bot come; `node scripts/watch.js events --follow` prints the events as they happen. |
| 3 | For an evening with me: open a tunnel to the port, `cloudflared tunnel --url http://127.0.0.1:8090` (no account) or `ngrok http 8090`, and send me the URL and the token (the token through a channel you trust, never in the repo). | I read the state, the chat and the events while you play and step in with `say` when you ask me to. The cloud session must be allowed to reach the tunnel's host: I tell you which host to add to the environment when we start. Your words stay the orders. |

The six tools are read-only but `say`, and `say` refuses a server command. The server binds 127.0.0.1 only; the tunnel is the only way in, for the evening you open it.

## 4. Learning by watching

| Step | What you do | What should happen |
|---|---|---|
| 4 | Say "watch me". Place 4 oak planks in a line. Say "continue like this, 12 long". | `I watch you.` then `I watched you: 4 blocks placed, 0 broken.` and `I understood: a line of oak_planks 12 long from (x, y, z) eastwards; 8 oak_planks more, I carry 20. Say yes to build it.` |
| 5 | Say "yes". | The 8 planks are placed; `I built the line: 8 oak_planks.` Nothing else is placed. |
| 6 | "Watch me", place 3 fences and the gate, "continue like this, 7 by 10", "yes". | `I understood: a fence 7 x 10 from (x, y, z) northwards, the gate where you placed it; 26 oak_fence more, I carry 12 oak_fence. Say yes to build it.` It fetches the rest from a chest it knows and builds the rectangle. Then `Say "this is the pen" to save it.` |
| 7 | In the mine room: "watch me", dig 3 cells deep into the rock, "continue like this, 12 long", "yes". | `I understood: a tunnel 12 long from (x, y, z) westwards, 2 high; 9 blocks more to dig.` and it digs them, nothing beside. |
| 8 | Say "continue like this" after placing 3 blocks that lie on no line. | `I see no pattern in what you did: 3 blocks that lie on no line.` |

Any order ends the watching. Nothing is placed or dug before your yes.

## 5. Smelting

| Step | What you do | What should happen |
|---|---|---|
| 9 | With raw iron in the bag and coal in the room chest: "make me an iron pickaxe". | `I have no iron for an iron_pickaxe: 3 iron_ingot or 3 raw_iron are needed.` is NOT said when you carry raw iron; it smelts in the furnace of the room: `I smelted 3 raw_iron into 3 iron_ingot in the furnace at (x, y, z) with 1 coal.` and crafts the pickaxe. |
| 10 | Without iron, with the mine known: "make me an iron pickaxe". | The plan: `I have no iron ingot. I get raw_iron and iron_ingot, then I go on.`, it mines 3 iron, smelts, crafts: `The tool making is done.` |
| 11 | "Smelt 8 raw copper" far from any furnace, with none in the bag. | `I know no furnace within 64 blocks and carry none.` |

## 6. Underground

| Step | What you do | What should happen |
|---|---|---|
| 12 | Walk the bot into your tunnel. | Within a few seconds: `I am in a tunnel 2 wide and 23 long, heading west, of the mine "mine".` Never "storage", never "Tell me its name". |
| 13 | In a cave: "remember this as the cave". | `I am in a cave; a cave is nothing I save.` |

## 7. The small items

| Step | What you do | What should happen |
|---|---|---|
| 14 | Night, the bot in bed: "come here". | It is out of bed within a second and comes. |
| 15 | Right after a start: "collect 1 oak log" with a tree beside it. | The first dig is done, no 3 s of deafness. |
| 16 | "Use your hand on the door". | `I opened the door at (x, y, z).` or `The door at (x, y, z) was open already.` |
| 17 | "Go to Steve" with no Steve around. | `I see no player "Steve". The players I see: MartyByrde2.` |

## 8. Two bots

In each bot's `settings.js`: `"only_chat_with": ["MartyByrde2"]`, `"other_bots": ["gpt"]` (the other's name), `"bot_role": "You are the farmer. gpt is the miner."` (the reverse for gpt), and `$env:MINDSERVER_PORT = "8081"` before the second launch script.

| Step | What you do | What should happen |
|---|---|---|
| 18 | "Where are you?" | One line from each, and neither answers the other. |
| 19 | "Mine 4 iron." | The farmer: `That is gpt's job. I farm.` The miner mines. |

Keep the role to one short sentence: the prompt is close to its limit with every switch on.

## 9. What I would like to know

- The log and the scorecard of the session, and the events you saw on `events --follow`.
- Where the bot misread what you built: the understood text and what you meant.
- Whether the tunnel from your machine held for the evening.
