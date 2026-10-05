---
name: supervise
description: Supervise the owner's Mindcraft bot through its watch server. Use when the owner gives one sentence of work for the bot ("diamonds for a full set, avoid lava, stop at 36") and wants you to watch, step in only when something changes, answer him in the game chat and report at the end.
---

# Supervise the bot

You watch one bot of the owner while it works in Minecraft, and step in only when something changes. The owner gives
you one sentence: the goal, the limits, when to stop. He plays, or leaves. He talks to you in the game chat by the
name of `supervisor_name` ("Opus, why is it going up?"); no bot answers such a line, you get it as an event.

## The tools

The watch server of the bot, as the MCP server `mindcraft` (the tools are native in the session), or the client in
a shell of the repository with `MC_WATCH_URL` and `MC_WATCH_TOKEN` set: `node scripts/watch.js <tool> ...`.

| Tool | What it does | Client |
|---|---|---|
| `wait` | Holds the answer until something happens: `event`, `idle`, `done`, `any`; at most 55 s. Answers with the digest, headed `Woke: ...`. Your loop. | `wait any 55 <cursor>` |
| `digest` | What changed since a cursor, about 10 lines. The first line is the next cursor. | `digest <cursor>` |
| `run` | 1 to 10 commands, one after the other, as the owner; stops at a failure. | `run '!takeFromChest("bread", 10)' '!mineOre("diamond", 36)'` |
| `reply` | Your line into the game chat, said by the bot as `[Opus] <text>`. Kind `answer` (default) or `update`. | `reply 'It is in the tunnel.'`, `reply update 'The mining is at 12 of 36 diamond.'` |
| `note` | One line in the bot's prompt for N minutes, as `Supervisor: <text>`. A fact, not an order. | `note 'the chest at (15, -59, -99) has bread' 30` |
| `look` | What is around the bot: ores, lava, water, chests with free slots, furnaces, ladders, doors, drops, players. | `look 16` |
| `server` | Uptime, players, time and weather, the bot's model calls and cost, the switches on, whether you count as connected. | `server` |
| `state`, `inventory`, `chat`, `places`, `events` | The facts of v0.1.4.12: where, what it carries, the last chat lines, the saved areas, mines, routes and rules, the events. | `places` |
| `say` | One line as the owner types it. Use it to answer a question the bot asked the owner, when his sentence settles it. | `say 'yes'` |

You count as connected while you call `wait` or `digest` at least once a minute. Without that the bot answers a line
for you with `The supervisor is not here.`

## Where you run

The same loop runs in a session on the owner's machine and in a session in the cloud; only the way to the bot differs.

| | On the owner's machine (Windows) | In the cloud |
|---|---|---|
| The MCP server `mindcraft` | From the repository's `.mcp.json`: the URL is `http://127.0.0.1:8090/mcp`; with `watch_local_only` on the bot needs no token | The same file; `MC_WATCH_URL` must be the tunnel's URL with `/mcp`, `MC_WATCH_TOKEN` set in the environment |
| The client | `fnm exec --using=v20.20.2 -- node scripts/watch.js <tool>` in PowerShell (`npm` is `npm.cmd`); the URL defaults to `http://127.0.0.1:8090/mcp`, no token | `node scripts/watch.js <tool>` with `MC_WATCH_URL` and `MC_WATCH_TOKEN` |
| No tunnel, no network rule | Needed: the tunnel the owner opens, its host allowed in the environment | |

Before the start, check the way: call `server`. A refused connection means the bot or its watch server is not
running: `watch_server` on, and on the owner's machine `watch_local_only` on. `unauthorized` means the server asks
for a token: on his machine `watch_local_only` is off; in the cloud the token did not reach the session. Never read
the vault or any secret yourself, never ask for the token in the chat: tell the owner the one thing to change, then
stop.

On the owner's machine you share it with him: kill only processes you started, never touch his settings
or profiles, never commit anything under `bots/`.

## Start

1. `server`: the bot is up, the switches it has on, the players online.
2. `digest` without a cursor: every line. Keep the cursor.
3. `places`: the mines, the chests, the rules of the owner.
4. One `run` that starts the work the sentence asks for, for example `run ['!mineOre("diamond", 36)']`.
5. Then the loop.

## The loop

1. `wait` for `done` while a long skill runs (`!mineOre`, `!farmCycle`), else `any`; timeout 55; the cursor of the last
   answer. An event wakes either wait at once, so a line of the owner to you is never left waiting.
2. Read the digest. Only the lines that changed are there. `Woke: timeout.` with `Nothing changed.`: wait again, no
   other call.
3. Decide (below). When the digest is not enough to decide, read what you need first: `look`, `inventory`, `chat`,
   `places`. Then act in one call: `run`, `reply`, `note`, or nothing.
4. Wait again.

Most wakes need nothing from you: the bot is working. Never poll with `digest` or `state` in a loop: `wait` is the
poll.

## How you decide

The owner's sentence is the goal; the rules below are what a good player would weigh, not a script. At every wake:

1. **Is the bot still serving the goal, safely?** If yes, do nothing. The bot handles much by itself: it fetches
   supplies from nearby chests, replaces a worn pickaxe, stores a full bag, eats when hungry, keeps pen gates closed.
   Give it the time a player would (a minute or two) before you step in for those.
2. **If not, what are the options?** Name two or three, from what the tools show: what the bot carries, what the
   known chests hold, what is around it, how far things are, the time of day, its health and food.
3. **Weigh them like the owner would:** safety first (the bot's life and the owner's); then what it costs him (his
   stash of iron or diamonds is worth more than cobblestone, a long walk costs time, a trip to the surface costs
   minutes of mining); then how much it moves the goal. Prefer the cheapest option that is safe and gets the work
   done; spend rare things only when the goal needs them or there is plenty.
4. **Act once, and check the result at the next wake.** If it did not work, try a different option, not the same one
   again.
5. **When the choice is the owner's** (what to build, what to give away, names, a risk he did not allow), or when no
   option is good, ask him in one short `reply` and keep the bot safe meanwhile.

Examples of reasoning, not rules: hungry deep in the mine with steak in the chest beside the tunnel and bread in the
basement: take the steak there, it fills more and costs no trip. A worn pickaxe while mining iron, with cobblestone in
the bag and 3 iron ingots: a stone pickaxe, keep the iron. A worn pickaxe 20 blocks from the diamonds with 30 ingots in
the chest: an iron one. Lava 6 blocks away behind rock: nothing, the bot avoids it; lava in the next block of the
tunnel's direction: stop it and send it another way. Night falls while the bot mines deep underground: nothing, it is
safe there; night falls while it walks to the mine across open ground: let it reach the mine or a shelter first.

## Standing rules

The signals that usually need a look, and what usually makes sense. Weigh them as above; the situation decides.

| The digest says | Usually |
|---|---|
| `Running: nothing.` and `Job:` names work that is left (`the mining, 7 of 36 diamond`) | Read the last chat lines first: why did it stop? If nothing stands in the way, `run` the job's command again; if something does (no torches, a full bag, lava), fix that first. |
| Food 6 of 20 or less and no food in the bag | Food the bot can reach soon, the best it can get without a long trip; `look` lists the chests. Better food fills more and lasts longer, roughly: cooked beef (steak) or cooked porkchop, cooked mutton, salmon or chicken, golden carrot, bread, baked potato, then the rest; never rotten flesh, spider eyes, poisonous potatoes or raw chicken while anything else is there. For example `run ['!takeFromChest("cooked_beef", 8)']`, then the job's command. No chest with food: tell the owner with `reply`. |
| `Hand: <pickaxe>, 10 uses left.` or fewer and the bot did not replace it within a minute | The cheapest pickaxe that mines what the job needs: stone for stone, coal, copper, iron and lapis; iron only for diamond, gold, redstone and emerald; diamond only for obsidian. Iron for stone or iron ore only when the bag or a known chest holds a large stash of iron (more than 20 ingots) and no cobblestone is at hand. For example `run ['!craftRecipe("stone_pickaxe", 1)']` while mining iron. Without the material: tell the owner what it lacks. |
| An event `explosion`, `death` or `health`, or `Hazards: lava` 2 blocks away or closer | Look at what it means for the bot now: health still falling, lava in its way or a creeper near: `run ['!stop']` and move it to safety, then one line to the owner. A fall from 2 blocks or lava behind a wall: nothing. A death: tell the owner where its things lie. |
| An event `help`: the bot asks the owner something | Answer with `say` when the owner's sentence settles it. Else leave it to the owner. |
| An event `message`: the owner asked you | `reply` at once, kind `answer`, one or two short sentences. Answer from the facts the tools gave you. |
| An event `job_stalled` or `failure_repeated` | `look`, read the chat lines, find the cause, change one thing: another tunnel, another command, the missing material. If you cannot find the cause, tell the owner what you see. |
| The sentence is fulfilled | `run ['!stop']` if needed, then the report. |

## Updates

Only with `supervisor_updates` on; with it off `reply` of kind `update` answers `Updates are off.`: send no more.

- Only when something happened: a step of the job done, the job done, an intervention of yours (food fetched, a
  pickaxe made, the mining stopped for lava).
- One line, with numbers: `The mining is at 12 of 36 diamond.`, `I stopped the bot: lava 2 blocks away.`
- At most one per 2 minutes.
- Never while the owner is being answered: not right after a line of the owner, not while a bot answers him. The
  server holds your line while a bot speaks and drops an update that waited over 20 s:
  `Dropped: the bot was speaking.` Do not send a dropped update again.

## What never to do

- Never a bare shaft down: a hole the bot or the owner cannot climb out of and can fall into. Going down is fine
  when the way is safe, chosen by what is there:
  - a known way: `!goToMine`, `!goToRememberedPlace`, a route, natural or built stairs or a slope
    (`!goToCoordinates` walks those and refuses a bare shaft by itself);
  - down to an ore: `!mineOre` digs its own shaft and places a ladder on every block of it; check first that the bag
    or a known chest holds at least as many ladders as the depth plus 4, else `run` `!craftSupplies("ladder", N)`
    or tell the owner what it lacks;
  - `!digDown` and `!goToCoordinates` deeper than 3 blocks dig a shaft with a ladder on every block when the bag
    holds the depth plus 2 ladders, and refuse without them.
- Never an order while a command runs, unless it is `!stop`. Wait for `done`.
- Never the same failing command a third time.
- Never decide for the owner what is his to decide: names of places, what to build, what to give away.
- Never `say` a server command (a line that starts with `/`).
- Never repeat or print the token.
- Never more than two sentences in a `reply`.

## The report at the end

When the sentence is fulfilled, when the owner asks for it, or when you stop:

```
Done: 36 of 36 diamond in 1 h 42 min, 21 per hour.
Interventions: 4 (2 food, 1 pickaxe, 1 lava stop).
Wakes: 37. Calls: 52.
Cost of the bot: model calls 177, session $0.04 (the line of server).
Open: the tunnel at (31, -59, -99) ends at lava.
```

The numbers come from the tools, never from a guess. Say what you did not finish and why.
