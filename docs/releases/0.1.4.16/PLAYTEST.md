# Play test v0.1.4.16 "Stability, and three packs"

This release fixes what your plays of 2026-11-10, 2026-11-11 and 2026-11-13 found on your base, and adds three
packs behind switches, off by default: breeding, enchanting and the AFK creeper kill. Off, the prompt is v0.1.4.15's.

## 1. Get the release

In PowerShell 7, in the repo folder, with the bots stopped and Node 22 active:

```powershell
git stash
git checkout main
git pull
git stash pop
npm install
```

`npm install` once: the mineflayer patch changed (the enchanted tools, below), and `npm install` applies it. The
libraries' versions are unchanged.

## 2. Switch the new parts on

```js
"breeding": true,
"enchanting": true,
"afk_kill": true,
```

`base_survey` and `routines` as you had them. `survey_cluster_gap` is 48 (two finds farther apart are two bases).

## 3. The fixes you will meet first

| Step | What you do | What should happen |
|---|---|---|
| 1 | Walk the bot past the trading hall and the pens. | No "A creeper keeps following me" from the caves below; a creeper the bot sees at its level still makes it back off, never downhill. |
| 2 | `!surveyBase("base")` again (or `!forgetArea("base")` first). | The bot says the report itself; the village 100 blocks south is `I left out N places about 100 blocks south ...`; `bases.json` has your house's door; only your house is a home; your 14 areas are in the base's `kept`. |
| 3 | "rename pen to horse_house". | `I renamed "pen" to "horse_house".` |
| 4 | A routine naming the west forest chest by coordinates. | The plan walks there first; a failed step says `Step N of "..." failed: ...; I go on.` and the round goes on; the round numbers count up; no round while the supervisor's command runs. |
| 5 | `!harvest("sugar_cane")`; `!farmCycle` from inside the house. | The cane cut above the bottom block and picked up; the farm round leaves the house by the door first. |
| 6 | "mine 16 iron" with a mine known; `!mineOre("iron", 8, true)`. | Every stop names its reason, also in the log (`Mining stop: ...`); `new_mine` true starts a new mine where the bot stands. |
| 7 | At night by the trading hall, "go to sleep". | Its own bed or your house's, never a villager's. |
| 8 | Give it an enchanted pickaxe and let it dig. | No `enchantments.concat is not a function`. |
| 9 | A supervisor `run` of any command. | Nothing of it in the game chat; the answer has a run id, and the watch tool `runs` shows when it ended. |
| 10 | `!collectBlocks("stone", 10)` underground. | The stone outside caves first; `The stone is in a cave; I go carefully.` once before the first in a cave; never a refusal. |
| 11 | Restart the game for a backup while the bot is on. | No `[LoginGuard]` line in the chats or the voice; after the reconnect at most `The connection to the server was lost.` |

## 4. The three packs

| Step | What you do | What should happen |
|---|---|---|
| 12 | "breed the cows" (`!breed("cow_pen", 2)`) with wheat in the bag. | The bot stands outside the fence, never at the gate, feeds a pair: `I fed 2 cows in the cow pen.`, then `I fed 4 cows in the cow pen; 2 calves.` The gate stays shut. |
| 13 | "breed the pigs" with carrots only in a chest. | `May I take 4 carrot from the chest at (x, y, z) for the feeding? Say yes or no.` Your "yes" (`!allowTaking`), then `I took 4 carrot ...`. Next time no question, until the chests run low. |
| 14 | At your table: "enchant my pickaxe". | Lapis from the bag or, once allowed, from the valuables chest; `The table offers for your diamond_pickaxe: 1) ... 2) ... 3) ... Say "take 1", "take 2", "take 3" or "none".`; "take 2" enchants and names every enchantment of the result; "none" gives the pickaxe back. Too low a level: `Level 12, offer 3 needs 30.`, nothing spent. |
| 15 | Stand at your kill spot and say "remember here as kill_spot"; then "farm creepers" (`!killFarm()`), and go more than 128 blocks away or log out. | The bot climbs to the spot, sneaks and steps under the slab, `I farm creepers at the kill spot. Stay more than 128 blocks away or log out, ...`; one line every 50 kills with the hits and the level; the gunpowder in the kill chests; at night it sleeps in the bed by the room and goes back; after a reflex or a restart it goes back by itself; "stop" ends it with the totals. "farm creepers until level 30" stops there. |
| 16 | Let a sword wear out at the kill spot. | It takes the next sword from the chests (iron, stone, ...; never diamond or netherite) or crafts one, and says so. |

## 5. What I would like to know

- Whether the kill farm keeps going through a whole night and a backup restart without the supervisor.
- The gunpowder and XP figures of the stop line against what you see in the chests and the bar.
- Whether the base report and the bed choice match your base now.
- Each bot's log and the server log, as before.
