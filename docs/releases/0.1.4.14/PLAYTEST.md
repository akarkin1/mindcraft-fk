# Play test v0.1.4.14 "Minecraft 26.1"

This release moves the bot to Minecraft Java 26.1 (the libraries of 2026, Node 22), teaches it the copper
tools, the copper chests and the corrected foods of 26.1, tells the chat model what 1.21.9 to 26.1 added
when such a thing is near (`new_things_in_prompt`), and switches the chat model to Claude Haiku 5.5.
Everything else is v0.1.4.13 with fixes 1 and 2. Before you start: a world opened in 26.1 cannot go back to
1.21.8.

## 1. Before the release: the world and the tools

| Step | What you do | Why |
|---|---|---|
| 1 | Back up `saves/<your world>` (copy the folder while the game is closed). | The upgrade of the world is for good. |
| 2 | In the launcher, select **26.1** (26.1.1 and 26.1.2 work as well, the same protocol; 26.2 and 26.3 do not) and open your world once with the game alone, then close it. | The game upgrades the world and installs its Java 25 (`java-runtime-epsilon`), which the test server uses. |
| 3 | `fnm install 22` in PowerShell 7. | The new libraries need Node 22 or newer; `start-claude.ps1` and `start-gpt.ps1` now say `fnm use 22`. |

## 2. Get the release

In PowerShell 7, in the repo folder, with the bots stopped and Node 22 active (`fnm use 22`; `node --version` says 22):

```powershell
git stash
git checkout main
git pull
git stash pop
npm run reinstall
npm run voice:setup
```

`npm run reinstall` removes `node_modules` and installs from nothing: every library changed and the native modules
of the voice and the viewer are rebuilt for Node 22. `npm run voice:setup` only if the voice is on. If a native
module fails to build, send me the error; the bot runs without the voice (`voice_ui` off) and without the viewer.

If you use the test server (`node tests/world/run.js ...`): `node scripts/get_test_server.js --accept-eula`
downloads `server-26.1.jar` (the EULA is the one you accepted on 2026-09-28); the tests find the launcher's Java
25 by themselves, or `node scripts/get_test_server.js --jdk` downloads one into the test-server folder.

## 3. Switch the new part on

Your switches of v0.1.4.13 stay. New in `settings.js` (or the page's Settings):

```js
"new_things_in_prompt": true,
```

Off, the bot's prompt is exactly the one of v0.1.4.13. On, the prompt gets up to three one-line facts about
the new things that are in the bag, in view, in your last lines or in a command the model just wrote
(`NEW SINCE 1.21.8 (true, even if you do not know it): ...`). Nothing when nothing new is near.

`profiles/claude.json` is on `claude-haiku-5-5` with effort `low` (thinking on, kept short). The cost line
at the end of the log counts its thinking as output tokens; the price is $0.10 / $0.50 per million.

## 4. The usual walks, in short

| Step | What you do | What should happen |
|---|---|---|
| 4 | Start claude (the start script switches to Node 22 by itself). | It joins your 26.1 world; `!stats` answers. |
| 5 | "follow me" through the pens and the house. | As in v0.1.4.13: it does not open the pen gates, it opens doors and trapdoors, climbs ladders. Note every place it walks differently than on 1.21.8. |
| 6 | "mine 6 iron" in the deep mine, with the chest beside the tunnel. | The supplies, the trip, the worn-pickaxe rule, `I mined 6 of 6 iron...`, the way back, as in fix 2. |
| 7 | Hit the bot once (or let a zombie). | It is pushed back about a block (the knockback was missing on 26.1 before the patch). |
| 8 | Dig times: watch it dig iron ore with an iron pickaxe. | Under a second per block (4.5 s before the patch). |
| 9 | Night: "go to sleep", then "get up" before the morning. | It sleeps and gets up (getting up was broken on 26.1 before the patch). |
| 9b | Night, the bot down in the basement or the mine room: "go to sleep". | It climbs up the ladder through the trapdoor and sleeps in the bed. (A stall under the trapdoor was found and fixed in the tests; tell me if it still stops there or says `I found no way to the bed.`) |
| 10 | The supervisor as in v0.1.4.13 (a new Claude Code session; `fnm exec --using=v22` in the skill). | As before. |

## 5. The three new things

| Step | What you do | What should happen |
|---|---|---|
| 11 | Give the bot a copper pickaxe (`/give claude copper_pickaxe`) and send it to mine iron. | It uses the copper one for iron and copper, not for diamond or gold; when it is nearly worn (10 uses) it makes a stone one, never a copper one: `My copper_pickaxe is nearly worn: N uses left. I made a new one.` With `new_things_in_prompt` on, a question like "what is that pickaxe?" is answered with the copper facts, not with "I don't know copper tools". |
| 12 | Make the mine's chest a copper chest (`/setblock ... copper_chest` beside the tunnel, with bread in it). | The bot takes its supplies from it and stores into it as from any chest; `!viewChest` and `look` show it. |
| 13 | At low food with a steak and bread in the bag. | It eats the steak first (8 food points), the bread later; it never "eats" a fish bucket if you give it one. |
| 14 | Say "chain" to it near an iron chain, or ask about a shelf, a spear or a copper golem. | With the switch on, one line of facts; with the switch off, whatever Haiku knows (it was trained before all of this). |

## 6. A new world (what your play of 2026-11-07 found, P-1 to P-16)

On a new 26.1 world, in a forest, with nothing built.

| Step | What you do | What should happen |
|---|---|---|
| 15 | Start claude on the new world. | `No memory file found` for the new seed, and no `I was farming. I go on.`, no talk of a connection that dropped: the job and the note about the last exit belong to the world now (`bots/claude/worlds/<seed>/`). |
| 16 | Stand with it under the trees for a few minutes, speak to it twice. | No "walled yard with a roof", no question about the name of a place it has not saved. Your house, pens and farm in the old world are still read as before. |
| 17 | "cut 8 oak logs" among natural oaks; stop it half-way once and ask again. | It cuts, the logs end in its bag (none left under the crown), it plants the saplings; the half-cut tree is cut too; never `Logs of buildings are not mine to take.` unless logs really touch something built. A trunk lying on the ground is cut as well (no sapling for it). |
| 18 | "give me all your logs", on a slope too. | `I gave you N oak_log.`, the stack lands at your feet on the first toss; no `That is a lot`. If you take nothing, it picks the stack up and tosses it once more from one block. |
| 19 | "make a chest and put your logs in it", then "empty the chest" and "collect the chest"; once on a slope with grass and flowers. | The crafting table goes on a cell that takes it (or `I could not place my crafting table here.`); a full chest is refused with its count; the emptied chest is collected and its item is in the bag, not on the ground. |

## 7. What I would like to know

- Whether `npm run reinstall` and `npm run voice:setup` rebuilt the voice and the viewer on Node 22 (the errors if not).
- Every place the bot walks differently than on 1.21.8 (doors, trapdoors, ladders, water, the pen gates).
- The chat lines of Haiku 5.5 against Haiku 4.5: shorter, longer, better, worse; whether it still says "I don't know that" about the new things with the switch on.
- The cost line of each bot's log (the thinking is in the output tokens now) and the supervisor's report.
- Each bot's log and the server log, as before.
