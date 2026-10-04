# The supervisor

A Claude Code session that watches your bot while it works, steps in only when something changes, answers you in
the game chat and reports at the end. You give it one sentence and play, or leave. It reaches the bot through the
watch server of the bot (v0.1.4.12, `watch_server`) and the skill `supervise` of this repository.

## 1. The settings

In `settings.js`, or in Settings of the bot on the page of the mindserver:

| Setting | Value | What it does |
|---|---|---|
| `watch_server` | `true` | The watch server in the bot's process, on 127.0.0.1 only |
| `watch_port` | `8090` | Its port |
| `supervisor_name` | `"Opus"` | The name you call the supervisor by. A line that starts with it ("Opus, why is it going up?") goes to the supervisor, and no bot answers it. The supervisor's lines come back as `[Opus] ...`. Empty: no supervisor in the chat. |
| `supervisor_updates` | `false` | `true`: the supervisor also says a short line when something happened (a step done, the job done, an intervention), at most one per 2 minutes. |
| `supervisor_voice` | `"supertonic:M1"` | With `voice_ui`: the voice the page gives the supervisor's lines. Each bot keeps its `voice_voice`. |

"Opus" is only the example of these docs. Any name works that is not the name of a bot or a player.

## 2. The token

The watch server starts only with a token in the environment of the bot. Put one in your vault once:

```
Set-Secret -Name MindcraftWatchToken -Secret (-join ((48..57)+(97..122) | Get-Random -Count 32 | % {[char]$_}))
```

`.\start-claude.ps1` (and `.\start-gpt.ps1`) hand it to the bot as `MC_WATCH_TOKEN`. The console says
`The watch server listens on 127.0.0.1:8090.` Without the token it says `The watch server does not start:
MC_WATCH_TOKEN is not set.` and the bot plays as before. The token never goes into the repository, a log or a chat.

## 3. The tunnel

A session on your own machine needs none: its URL is `http://127.0.0.1:8090/mcp`.

A session in the cloud reaches your machine through a tunnel that you open for the evening:

```
cloudflared tunnel --url http://127.0.0.1:8090
```

It prints a URL like `https://some-words.trycloudflare.com` (no account needed; `ngrok http 8090` works too). The
URL of the tools is that URL with `/mcp` at the end. The cloud environment must be allowed to reach the tunnel's host:
add it to the network access of the environment. Close the tunnel when the evening is over; the server binds
127.0.0.1 only, so the tunnel is the only way in.

## 4. The tools in the session

In the folder of the repository, once:

```
claude mcp add --transport http mindcraft <url> --header "Authorization: Bearer <token>"
```

`<url>` is `http://127.0.0.1:8090/mcp` or the tunnel's URL with `/mcp`; `<token>` is the token of step 2. In
PowerShell, without typing the token:

```
claude mcp add --transport http mindcraft http://127.0.0.1:8090/mcp --header "Authorization: Bearer $(Get-Secret -Name MindcraftWatchToken -AsPlainText)"
```

Claude Code keeps the header in its own configuration, not in the repository. `claude mcp list` then shows
`mindcraft` as connected, and in the session `/mcp` lists the tools: `wait`, `digest`, `run`, `reply`, `note`,
`look`, `server`, `state`, `inventory`, `chat`, `places`, `events`, `say`. `reply` and `note` are there only with
`supervisor_name` set.

Without the MCP server the session can use the client: `node scripts/watch.js <tool>` with `MC_WATCH_URL` and
`MC_WATCH_TOKEN` in its environment.

## 5. The one sentence

Start a fresh session in the repository and give it one sentence with the skill:

```
/supervise diamonds for a full set, avoid lava, stop at 36
```

The sentence says the goal, the limits and when to stop. The supervisor starts the work, sleeps in `wait` until
something changes, acts in one call, and at the end reports the result per hour, its interventions and the cost.

## 6. Talking with it

- In the game chat, or by voice on the page: "Opus, why is it going to the surface?" No bot answers. The supervisor
  answers in the chat: `[Opus] The bot fetches bread from the chest in the basement.` The page shows it with the name
  in front and speaks it in `supervisor_voice`.
- "claude, come here" is still for the bot named claude; a line without a name goes to every bot.
- When the supervisor has not called `wait` or `digest` for 60 s and no `wait` of it is open, a line for it gets
  one answer from one bot: `The supervisor is not here.`
- Nobody speaks over anybody: a line of the supervisor waits while a bot answers you, and an update that waited
  over 20 s is dropped. On the page your speech stops every voice.
- On the page the dropdown picks the bot you talk with and puts its name in front of what you say (`claude, ...`);
  "everyone" sends your words to every bot without a name.

## 7. The cost

A fresh session with the skill costs about a cent a turn, and it takes a turn only when something changes or a wait
of 55 s runs out: under $1 an hour. On 2026-10-04 a long session cost about $7 an hour, because every turn carried a
context of 250k to 700k tokens. Start a fresh session for each evening. The bot's own model calls and their cost are
in the line `Model calls ...` of `server`.
