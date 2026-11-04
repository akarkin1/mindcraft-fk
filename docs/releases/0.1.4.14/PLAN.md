# Plan v0.1.4.14 "Minecraft 26.1"

Based on your question of 2026-10-22 ("Why can't our bot run on the latest version of Minecraft?") and your
decision of 2026-11-03: the upgrade is the next release candidate; Routines and the other work planned under
0.1.4.14 move to 0.1.4.15. The facts below were checked on 2026-11-03 against the published libraries, the
pull requests of PrismarineJS, Mojang's version manifest and a plain mineflayer bot on real 26.2 and 26.3
servers (`DECISIONS.md` of this release keeps the record).

## 1. Goal

| After this release | Today |
|---|---|
| The bot plays in Minecraft Java **26.1** (the "Tiny Takeover" release of 2026-03-24): your client, your world and the test server on 26.1 | 1.21.8; a 26.x client cannot connect the bot at all |
| The libraries are the newest released ones (mineflayer 4.39.0, minecraft-protocol 1.68.0, minecraft-data 3.119.0); the next move, to 26.2, is then a library update and a play test, not a port | mineflayer 4.33.0 of 2025-09, pinned, with 8 patches |
| The bot knows what 26.1 added that touches its work: copper pickaxes (stone tier, 190 uses), copper chests, the new hostile mob "parched", the corrected food table | Unknown items are "not a pickaxe", "not a chest"; the food table is the one of 1.21.8 |
| Everything else is as in v0.1.4.13 with fixes 1 and 2 | |

## 2. Why 26.1 and not 26.3

| Version | State on 2026-11-03 |
|---|---|
| **26.3** (current, 2026-09-15) | No library supports it. The pull requests are scaffolds; a reviewer found their "26.3 data" is a copy of 26.1; digging and tool speeds are wrong; the chunk and physics libraries have nothing. Not usable. |
| **26.2** (2026-06-16) | Works for a basic bot from unreleased branches: our test passed all 10 checks on a vanilla 26.2 server, but only with pull requests of five libraries built from source. Nothing is released; no date. Not for play. |
| **26.1** (2026-03-24) | Supported by released libraries. **This release.** |

When 26.2 is released, most of this release carries over (Node 22, Java 25, the rewritten patches, the test
setup, the data tables), and the move is a smaller release.

## 3. What changes for you

| | Now | After | What you do |
|---|---|---|---|
| Node | 20.20.2 through fnm | **22** (the new libraries require Node 22 or newer) | `fnm install 22`; the start scripts switch by themselves; `npm run reinstall` once (the native modules of the voice and the viewer rebuild) |
| Java for the test server | 21, from the Minecraft launcher | **25** (the 26.1 server requires it) | Nothing when the launcher has updated to 26.1: its runtime `java-runtime-epsilon` is Java 25 and the tests find it. Else `MC_TEST_JAVA` |
| The test server jar | `server-1.21.8.jar` | `server-26.1.jar` | `node scripts/get_test_server.js --accept-eula` downloads it (the EULA you accepted on 2026-09-28 is the same) |
| Your world | 1.21.8 | 26.1, **for good**: a world opened in 26.1 cannot go back to 1.21.8 | Back up `saves/<world>` before you open it in 26.1 |
| Your client | 1.21.8 | 26.1 | Select 26.1 in the launcher |
| Settings, profiles, memory, `bots/` | | unchanged | Nothing |

New setting: `new_things_in_prompt` (off), section 4b. The rest is an upgrade with corrections of data and needs no switch.

## 4. What 26.1 brings that the bot must know

From the data of minecraft-data 3.119.0, 1.21.8 against 26.1:

| Change | Where the bot meets it | What we do |
|---|---|---|
| Copper tools (the Copper Age drop of 1.21.9): `copper_pickaxe` mines what a stone one mines (iron, copper, lapis, not diamond or gold) and has 190 uses | the worn-pickaxe rule, the cheapest-pickaxe rule, the supplies, `look` | Copper is a pickaxe of stone tier with 190 uses. The bot never crafts one (stone from cobblestone is cheaper); it uses one it has |
| Copper chests, in 8 variants (oxidation and waxed) | the chest index, `!viewChest`, the supplies, `look` | A copper chest is a chest |
| Shelves (16 wood kinds) | none: a shelf holds 3 items and is no container window | Left out; a shelf is a built block |
| `chain` is renamed `iron_chain`; `copper_chain` added | the "thin built parts" list | Nothing: the list matches by the word "chain" |
| New mobs: `parched` (hostile), copper golem, nautilus, zombie nautilus, camel husk, mannequin | self-defence, the shelter rule | Nothing: the bot reads "hostile" from the data's category |
| The food table: minecraft-data corrected the saturation values (an apple: 2.4, not 19.2); four fish buckets are listed as foods | the food choice, the fallback table | The fallback table is regenerated from 26.1; a bucket is never food |
| 946 of 1,105 block ids and 1,185 of 1,416 item ids moved | nothing in the bot (it works by name); the unit tests that hold an id | The tests take ids from the registry by name |

## 4b. What the model does not know

The four releases between 1.21.8 and 26.1, from Mojang's notes (bug fixes left out):

| Release | Date | What a player meets |
|---|---|---|
| 1.21.9 "The Copper Age" | 2025-09-30 | Copper tools, weapons and armour (like stone, faster, 190 uses, from copper ingots); the copper chest (oxidizes, can be waxed); the copper golem, spawned with a pumpkin on a copper block, which carries items from copper chests into chests that are empty or hold the same kind, 16 at a time, within 32 blocks; shelves of 12 woods (3 item slots, swap with the hand; not a chest); copper torch, lantern, bars and chain; `chain` renamed to iron chain; lightning rods oxidize; mobs can spawn with copper armour; the End flashes; the server management protocol and the code of conduct |
| 1.21.10 | 2025-10-07 | Bug fixes |
| 1.21.11 "Mounts of Mayhem" | 2025-12-09 | The spear in wood, stone, copper, iron, gold, diamond and netherite (a jab or a charge, long reach, no block breaking); the nautilus (neutral, in every ocean, tamed with pufferfish) and the zombie nautilus with a drowned rider; nautilus armour; the parched, a desert skeleton that does not burn in sunlight and shoots arrows of weakness; the camel husk, an undead camel with a husk and a parched on it; zombie horses spawn at night with a zombie rider holding a spear; horses, camels and the like no longer sink when ridden; the effect "breath of the nautilus" |
| 26.1 "Tiny Takeover" | 2026-03-24 | New looks and sounds for baby animals; the golden dandelion, which stops a baby animal from growing; name tags craftable from 1 paper and 1 metal nugget, and no longer in librarian trades or mansion chests; stone and deepslate cut straight to their cobbled kinds in the stonecutter; villager trades follow the world seed; the game takes 4 GB by default; worlds are upgraded on opening |

The bot's chat model, Claude Haiku 4.5, was trained before all of these, as far as we know (Luna too, until
proven otherwise). The commands work by the data (`!craftRecipe("copper_pickaxe", 1)` crafts one), but the
model that chooses the command does not know the thing exists, what it is for, or that `chain` is
`iron_chain` now, and says so. What we do:

- A table of the new things, one plain sentence each with numbers, in the code (part K).
- The prompt gets the sentences for the things that are present: in the bag, in view, in your last lines, or
  in a command the model just wrote. At most 3 sentences, so the prompt stays within its budget. Nothing when
  nothing new is near.
- Behind the switch `new_things_in_prompt` (off by default, as every new behaviour; on in your play).

Shelves, the copper golem's sorting, spears and the new mounts are known, not used: no skill of the bot
builds on them in this release.

## 5. The libraries and the patches

| Library | Now | After |
|---|---|---|
| mineflayer | 4.33.0 | 4.39.0 |
| minecraft-protocol | 1.62.0 | 1.68.0 |
| minecraft-data | 3.98.0 | 3.119.0 |
| the 12 pinned prismarine libraries | the versions of 2025-09 | the versions mineflayer 4.39.0 asks for (SPEC section 4.1) |
| mineflayer-pathfinder, mineflayer-pvp, protodef, prismarine-viewer | unchanged (2.4.5, 1.3.2, 1.19.0, 1.33.0) | unchanged |

Of the 8 patches: 4 stay as they are (the path search, pvp, the viewer, protodef); 1 applies with an
offset (the protocol's chat); 1 is dropped (the creeper explosion of minecraft-data: upstream reads doubles
since 3.117.0); 1 shrinks (physics: the trapdoor part stays, the version list is upstream now); 1 is
rewritten (mineflayer: the yaw of `use_item` is upstream now; the bed, the dig time and the place timeout
are re-applied on the new code). The test-applied details are in SPEC 4.2.

## 6. Estimate

| Part | Days |
|---|---|
| L: the libraries, the patches, Node 22 | 1 |
| D: the data of 26.1 in the bot's tables | 0.5 |
| T: the test setup on 26.1 (server, Java 25, the simulated server, the fixtures) | 1 |
| K: what the model does not know, in the prompt | 0.5 |
| The gate: unit, end-to-end and every world scenario on a 26.1 server, and the fix round | 1 to 1.5 |
| **Total** | **4 to 4.5** |

The uncertainty is in the gate: the path search patch (919 lines on a library from 2023) has never run
against the blocks and the physics of 26.1, and the simulated server of the end-to-end tests speaks the
packets of 1.21.8.

## 7. Left out

- 26.2 and 26.3: not released by the libraries (section 2).
- Shelves as storage, the copper golem, the new mounts and the spear of 1.21.11: nothing in the bot's
  skills uses them.
- The straw bed of 26.3 (sleep without moving the spawn point): would solve the bed rule of the supervise
  skill; waits for 26.3.
- Routines, tunnels as beams, caves, the supplies, the chests by position and the rest of the former
  0.1.4.14 list: now 0.1.4.15 (`docs/ROADMAP.md`).

## 8. Risks

| Risk | What we do |
|---|---|
| The path search behaves differently on the new physics or blocks (ladders, doors, trapdoors, water, the pen gates) | The 30 journeys and the 12 of 0.1.4.13 run on 26.1; every difference is a finding of the fix round |
| A native module of the voice (`onnxruntime-node`, `@ricky0123/vad-web`) or the viewer (`canvas`, `gl`) has no build for Node 22 on Windows | Checked by you in the play test with `npm run reinstall` and `npm run voice:setup`; a module that fails is reported with its error, the voice can be off |
| The simulated server of the end-to-end tests needs new packet shapes | Part T; the end-to-end suite is the check |
| Your world after the upgrade: new blocks generate only in new chunks; the base is unchanged | The dump of your region (`owner_region.json`) stays valid: block names, not ids |
