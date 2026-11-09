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
| `look` | What is around the bot and open to view (ores, lava and water with an open side, never behind a wall), chests with free slots, furnaces, ladders, doors, drops, players. | `look 16` |
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
   again. When two different ways to the same step failed, stop improvising: tell the owner what you saw and offer
   two options in one `reply` (another mine, another job, his help), and keep the bot safe meanwhile. A third
   improvised way costs more time and risk than the question; in the play of 2026-10-05 an hour of workarounds for
   iron brought 2 of 32 and a death.
5. **When the choice is the owner's** (what to build, what to give away, names, a risk he did not allow), or when no
   option is good, ask him in one short `reply` and keep the bot safe meanwhile.
6. **Every question goes into the game chat, and the loop goes on.** The owner plays full screen; a question in
   Claude Code makes him switch windows, and a turn that ends to wait for him stops the loop, so nobody watches the
   bot. Ask with one `reply` that names two options, then `wait event` until his answer comes as a `message` event,
   and answer within a minute. Your turn ends only when the game is over, when the owner says to stop, or when the
   bot is out of the game: then the chat cannot reach you, so say in the last chat line before it leaves that he must
   write in Claude Code. (The play of 2026-11-09: three questions asked in Claude Code, each a window switch and an
   idle bot.)

Examples of reasoning, not rules: hungry deep in the mine with steak in the chest beside the tunnel and bread in the
basement: take the steak there, it fills more and costs no trip. A worn pickaxe while mining iron, with cobblestone in
the bag and 3 iron ingots: a stone pickaxe, keep the iron. A worn pickaxe 20 blocks from the diamonds with 30 ingots in
the chest: an iron one. Lava 6 blocks away across the tunnel's wall of a cave: nothing, the bot avoids it; lava in the next block of the
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
| The bag holds what the goal is for (diamonds, ingots, rare ore) | A death loses the whole bag. Store it in a chest of the mine or the house every 8 or so, before every trip through caves or open ground, and before a fight or a long walk: `!putInChest("diamond", 8)` at a chest with room. Keep the bot's tools, food, torches and the bed. |
| `Running:` names a command nobody ordered, or your command ended `stopped by the command ...` | The bot's own model acts too: it answers its own events and help lines, and may stop your command or start its own (`!leaveMine`, `!goToShelter`, a new mine, `!setMode`). If it serves the goal and the owner's last order, let it; if not, `run ['!stop']` and give your command again. Turn a mode it switched off back on (`!setMode("unstuck", true)`): the profile of the owner decides the modes. |
| The sentence is fulfilled | `run ['!stop']` if needed, then the report. |

## Updates

Only with `supervisor_updates` on; with it off `reply` of kind `update` answers `Updates are off.`: send no more.

The game chat covers the owner's screen. Your `run` and `say` are quiet: their echo and results go to your
answer and the bot's log, never to the chat. Say in the chat only what the owner needs:

- When the bot is in danger or something went wrong: health falling, a mob fight, lava, a death, a fall, the bot
  stuck or lost. `I stopped the bot: lava 2 blocks away.`
- When the goal is done, or cannot go on without the owner: `Done: 36 of 36 diamond.`,
  `The mining stopped: no pickaxe left and no iron. What next?`
- Never for routine work: no progress counts, no "fetched food", no "made a pickaxe", no "still mining". The report
  at the end has them.
- One line, with numbers. At most one per 5 minutes, unless the bot is in danger.
- Never while the owner is being answered: not right after a line of the owner, not while a bot answers him. The
  server holds your line while a bot speaks and drops an update that waited over 20 s:
  `Dropped: the bot was speaking.` Do not send a dropped update again.

## What the commands do not do yet

Found in the play of 2026-10-05 and not fixed in v0.1.4.13 fix 1. Work around them; do not fight them.

| Command or tool | What it does | So |
|---|---|---|
| `!stop` | Stops the running command at once only as the first command of a `run`. | `run ['!stop']` alone, then the next `run`. |
| `!craftRecipe(item, N)` | N above 1 often fails with `missing ingredient`; several crafts in one `run` race each other and fail. | One craft per `run` call: `!craftRecipe("torch", 1)` makes 4 torches; call it again for more. |
| `!takeFromChest`, `!putInChest`, `!viewChest` | Open the nearest chest only; `!putInChest` stores one stack per call. The upper of two stacked chests is never the nearest. | Stand next to the chest you mean; repeat `!putInChest` per stack. A chest you cannot make the nearest: ask the owner, or one `!newAction` with `bot.openContainer(bot.blockAt(new Vec3(x, y, z)))`. |
| `inventory`, the digest's bag | Lags a few seconds behind a craft, a take or a restart. | Read `inventory` again before you tell the owner that something is in the bag or lost. The bed "lost" on 2026-10-05 was in the bag. |
| `!chests` | The chest index is as old as the last time the bot opened each chest. | `!viewChest` at the chest before you rely on what the index says. |
| `!mineOre` | Before a trip it wants 16 torches, 32 cobblestone, 8 food items and a chest, and walks to whatever chest holds the shortfall, even 150 blocks home for 2 torches. It fetches exactly the shortfall, then eats one and is short again. | Before `!mineOre`, fill the bag above those numbers from a chest nearby, or craft torches from coal and sticks on the spot. |
| `!mineOre` | Mines only the ore its tunnel uncovers; ore one block off the walls stays. It stops when the bag is full and no chest within 32 blocks has room. | Store the rubble (cobbled deepslate, tuff, gravel) in a chest of the mine before the tunnel outgrows 32 blocks. If the tunnel finds nothing for 60 blocks while `look` shows the ore near, tell the owner rather than chase it. |
| `!discard` | Drops at the bot's feet; the bot picks it up again at once. | Store rubble in a chest instead. |
| The pathfinder | Cannot climb a ladder through a trapdoor, open or closed; the bot hangs on the ladder. | Tell the owner where the trapdoor is; never break his blocks. |
| `run` | `Path not found, but attempting to navigate anyway` counts as a failure and stops the queue, even when the bot reached the goal. | Check the position, then send the rest of the queue in a new `run`. |
| The process | Restarts by itself after a kick or a hang; the tools answer `ECONNRESET`, then `ECONNREFUSED` for about 10 s. | Wait, then `digest` without a cursor and read where the bot is and what it carries. |
| `!newAction` | About 4 cents a call; the generated code may differ from what you asked. | Only when no command can do it, read-only first; say "never call bot.chat, console.log only" in the prompt. |

## What never to do

- Never end your turn to ask the owner something while the bot is in the game: ask in the chat and keep waiting
  (rule 6 above).
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
- Never the same failing command a third time, and never more than two ways to the same end before you ask the
  owner in one `reply`.
- Underground, never `!goToCoordinates` to a far point: it can cross open ground or dig its own way. Lead the bot leg
  by leg along what is known (a route, the mine's way in, the tunnel), one short leg per command.
- When `!mineOre` ends with "stuck" or "no way", the job pauses and waits for you: do not run it again from where the
  bot stands. Lead the bot to the open end of the tunnel by hand, then run it once more; if it fails again, tell the
  owner. (The mining keeps only parts of its tunnels until v0.1.4.14.)
- When the owner speaks to you, answer first, then start a long run of commands.
- Never `!collectBlocks` or `!newAction` to fetch ore or blocks underground: they chase ore into dark caves, where
  the bot died twice in the play of 2026-10-05. Underground only `!mineOre` and the commands of the mine.
- Keep the bot out of caves. When the bot breaks into a cave (cave air, mobs, a dark open space in `look`), stop it,
  send it back into its tunnel, and tell the owner where the opening is; never send it into the cave.
- Never `!newAction` for a scan you can do with `look`, `state` or `places`, and never in a loop: a code action costs
  the bot's model about 4 cents and its code can hang.
- Never move the owner's things when he asked you to check them: "check the chest" is `!viewChest`, not
  `!takeFromChest`.
- Never say that something is so before a tool showed it: read `inventory`, `look` or `chat` first.
- Never let the bot sleep in a bed it placed underground: the respawn point moves to the bed.
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
