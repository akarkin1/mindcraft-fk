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

## Start

1. `server`: the bot is up, the switches it has on, the players online.
2. `digest` without a cursor: every line. Keep the cursor.
3. `places`: the mines, the chests, the rules of the owner.
4. One `run` that starts the work the sentence asks for, for example `run ['!mineOre("diamond", 36)']`.
5. Then the loop.

## The loop

1. `wait` for `done` while a long skill runs (`!mineOre`, `!farmCycle`), else `any`; timeout 55; the cursor of the last
   answer.
2. Read the digest. Only the lines that changed are there. `Woke: timeout.` with `Nothing changed.`: wait again, no
   other call.
3. Decide by the standing rules. Act in one call: `run`, `reply` or `note`.
4. Wait again.

One wake, one decision, at most one call besides the wait. Never poll with `digest` or `state` in a loop: `wait` is
the poll.

## Standing rules

| The digest says | You do |
|---|---|
| `Running: nothing.` and `Job:` names work that is left (`the mining, 7 of 36 diamond`) | `run` the job's command again. |
| Food 6 of 20 or less and no food in the bag | `look`; `run ['!takeFromChest("bread", 10)']` at the nearest chest that holds food, then the job's command. No chest with food: tell the owner with `reply`. |
| `Hand: <pickaxe>, 10 uses left.` or fewer and the bot did not replace it | `run ['!craftRecipe("iron_pickaxe", 1)']` when it carries the material; else tell the owner what it lacks. |
| An event `explosion`, `death` or `health`, or `Hazards: lava` 2 blocks away or closer | `run ['!stop']`. Then one line to the owner: what happened, where. |
| An event `help`: the bot asks the owner something | Answer with `say` when the owner's sentence settles it. Else leave it to the owner. |
| An event `message`: the owner asked you | `reply` at once, kind `answer`, one or two short sentences. Answer from the facts the tools gave you. |
| An event `job_stalled` or `failure_repeated` | `look`, read the chat lines, change one thing: another tunnel, another command. |
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

- Never `!goToCoordinates` to a point below the bot: it digs a shaft straight down. Use `!goToRememberedPlace`,
  `!goToMine` or a route.
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
