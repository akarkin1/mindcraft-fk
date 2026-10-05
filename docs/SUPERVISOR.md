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
| `watch_local_only` | `true` on your machine | The server answers this machine only and needs no token. A request through a tunnel is refused. Leave it `false` only for a session in the cloud (section 3). |
| `supervisor_name` | `"Opus"` | The name you call the supervisor by. A line that starts with it ("Opus, why is it going up?") goes to the supervisor, and no bot answers it. The supervisor's lines come back as `[Opus] ...`. Empty: no supervisor in the chat. |
| `supervisor_updates` | `false` | `true`: the supervisor also says a short line when something happened (a step done, the job done, an intervention), at most one per 2 minutes. |
| `supervisor_voice` | `"supertonic:M1"` | With `voice_ui`: the voice the page gives the supervisor's lines. Each bot keeps its `voice_voice`. |

"Opus" is only the example of these docs. Any name works that is not the name of a bot or a player.

## 2. The token

On your machine with `watch_local_only` on: no token, skip this section.

For a session in the cloud the token keeps strangers out of the tunnel. The watch server starts only with a token in the environment of the bot. Put one in your vault once:

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

The repository has a `.mcp.json` that declares the MCP server `mindcraft` for every Claude Code session opened in
it, on your machine and in the cloud alike. It holds no secret: the URL is `MC_WATCH_URL` (default
`http://127.0.0.1:8090/mcp`) and the token is `MC_WATCH_TOKEN`, both read from the environment of the session. The
first time, Claude Code asks whether to trust the project's server: say yes.

**On your machine.** With `watch_local_only` on and the bot running, start `claude` in the folder of the repository.
`/mcp` lists `mindcraft` as connected with its tools: `wait`, `digest`, `run`, `reply`, `note`, `look`, `server`,
`state`, `inventory`, `chat`, `places`, `events`, `say` (`reply` and `note` only with `supervisor_name` set). No
token, no tunnel. The bot's console says `The watch server listens on 127.0.0.1:8090, for this machine only,
without a token.`

**In the cloud.** The same file, with two variables in the environment of the cloud session (its settings, as
environment variables): `MC_WATCH_TOKEN` (the token of step 2) and `MC_WATCH_URL` (the tunnel's URL with `/mcp`). A
quick tunnel gets a new URL at every start, so `MC_WATCH_URL` has to change with it; a named tunnel of cloudflared
(with an account) keeps one URL. The host must be allowed in the network access of the environment.

**By hand**, instead of the file, for one machine only (kept in Claude Code's own configuration, not in the
repository):

```
claude mcp add --transport http mindcraft <url> --header "Authorization: Bearer <token>"
```

`<url>` is `http://127.0.0.1:8090/mcp` or the tunnel's URL with `/mcp`; `<token>` is the token of step 2. Such a
server is not seen by a session in the cloud.

Without the MCP server the session can use the client: `node scripts/watch.js <tool>` with `MC_WATCH_URL` and
`MC_WATCH_TOKEN` in its environment (on your machine `fnm exec --using=v20.20.2 -- node scripts/watch.js <tool>`).

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
