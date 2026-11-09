# SPEC v0.1.4.14 "Minecraft 26.1"

This is the spec as the engineers get it on 2026-11-03. The plan for the owner is `PLAN.md`. The notes
between the parts are `HANDOFF.md`; where they disagree with this spec, they win. The defects that the
tests find, with the decisions, are `DECISIONS.md`.

Tech lead: Fable. Base: `origin/main` at v0.1.4.13 fix 2 (25bb58d). Branch: `release/v0.1.4.14-rc`.
Work folder: the checkout `/home/user/mc-goals`, shared. Node 22. The test server needs Java 25.

## 0. Rules for every engineer

The rules of `docs/releases/0.1.4.13/SPEC.md` section 0 hold word for word (never `keys.json`, never a
secret, never a real model, never port 55916, no git command that writes, strict file ownership, LF, texts
word for word, `{ ok, reason, text }` and never a throw, static imports only of names that exist, packs
through `ctx`, a report as text, the journeys are the gate, the functions of `skills.js` keep their
signatures, no new dependency beyond section 4.1, the watch token never printed). Four more:

24. This release changes no behaviour of the bot on purpose. A difference the tests show between 1.21.8 and
    26.1 is a finding, never "the new version does it that way": the lead decides.
25. No switch: an upgrade and the corrections of data have none.
26. Nothing in `src/` holds an id of a block or an item. The bot works by name; ids come from the registry.
    A test that needs an id takes it from the registry by name.
27. `npm install` runs from a clean `node_modules` (`npm run reinstall`): the patches of `patches/` must apply
    on the new versions without a warning, or the install is wrong.

## 1. Goal and acceptance

| Goal | Measured by |
|---|---|
| A fresh clone installs with Node 22 and the new libraries; `patch-package` applies every patch cleanly | the install log of the verification |
| The bot connects to a 26.1 server, spawns, and the whole unit, end-to-end and world suites pass on 26.1 | the gate (section 6) |
| A copper pickaxe counts as a stone-tier pickaxe with 190 uses: it digs iron, it is replaced at 10 uses by a stone one, and the bot never crafts a copper one | W121 part A, unit tests of part D |
| A copper chest is a chest for the index, the supplies and `look` | W121 part B |
| The food choice on 26.1 picks the cooked beef over bread, never a fish bucket | W121 part C, unit tests of part D |
| The creeper scenario passes without the dropped explosion patch | W47 `creeper_in_sight`, twice |
| With `new_things_in_prompt` on and a copper pickaxe in the bag, the chat prompt names what it is; with a spear in the owner's line, what a spear is; with nothing new near, nothing | W121 part D, unit tests of part K |
| Nothing regressed | the 30 journeys, the 12 of v0.1.4.13, the full set, all on 26.1 |

## 2. Settings

One new key in `settings.js` and `src/mindcraft/public/settings_spec.json`, in the style of `knowledge_in_prompt`:

| Key | Default | Type | Part | Meaning |
|---|---|---|---|---|
| `new_things_in_prompt` | `false` | bool | K | The prompt names the things of 1.21.9 to 26.1 that are present, one sentence each |

The upgrade and the corrections of data have no switch.

## 3. Parts, owners, files

| Part | Engineer | Files (owned) | Round |
|---|---|---|---|
| L The libraries, the patches, Node 22 | E1 | `package.json`, `package-lock.json`, `patches/*`, `start-claude.ps1`, `start-gpt.ps1`, `CLAUDE.md` (the Node lines), `docs/SUPERVISOR.md` and `.claude/skills/supervise/SKILL.md` (the `fnm` lines only), `src/agent/agent.js` (the `player_loaded` send only, 4.2) | 1 |
| D The data of 26.1 | E2 | `src/agent/packs/mining/ore_table.js`, `mine_logic.js` (`PICKAXE_MATERIAL_ITEMS`), `supply_logic.js` (`pickaxeToCraft`: copper), `texts.js` (`materialWord`), `src/agent/packs/storage/storage_logic.js` (`CONTAINER_KINDS`), `src/agent/watch/look_logic.js` (`CHEST_BLOCKS`), `src/agent/packs/home/food_logic.js` (`VANILLA_FOODS`, `isEdibleFood`), `food.js`, `src/utils/mcdata.js` (only if a name is pinned there); `tests/unit/xd_*.test.js` | 1 |
| T The test setup on 26.1 | E3 | `scripts/get_test_server.js`, `get_test_server_logic.js`, `scripts/dump_region_logic.js`, `tests/world/mc_server.js`, `tests/world/helpers.js` (the version of the player bot), `tests/world/run.js`, `tests/world/README.md`, `tests/e2e/fake_server.js`, `tests/e2e/helpers.js`, `tests/e2e/run.js`, `tests/helpers/xt_bot.js`, `tests/helpers/st_modes_env.js`, `tests/helpers/st_glue_env.js`, `tests/play/run.js`; the unit tests that hold a literal id (rule 26); `tests/unit/xe_*.test.js` | 1 |
| K What the model does not know | E2 | new `src/agent/knowledge/new_things.js` (the table and the pure selection), `src/agent/knowledge/knowledge_text.js` (the lines in the block), `src/models/prompter.js` (the input of the lines, after the knowledge block), `settings.js` and `settings_spec.json` for `new_things_in_prompt`, `tests/unit/gjg_prompt.test.js` and the other prompt-size tests (the budget, 4.7); `tests/unit/xk_*.test.js` | 1 |
| TW The journey W121 | T3 | `tests/world/w121_copper_age.js`, `tests/world/run.js` (the row and the group), `tests/world/README.md` (the row) | 1, written before the build, fails on the old code (a copper pickaxe does not exist in 1.21.8) |
| TU Unit tests from the spec | T1 | `tests/unit/xt26_*.test.js` | 2 |
| G Glue | lead | `CHANGELOG.md`, `docs/`, the merge of the parts, the gate | every round |

E1 and E3 both touch the Node and Java lines of the docs: E1 owns Node, E3 owns Java and the server.

## 4. The parts

### 4.1 Part L: the libraries

`package.json`, `dependencies` and `overrides`, exact versions as today (no `^` on a pinned library):

| Library | From | To | Note |
|---|---|---|---|
| `mineflayer` | 4.33.0 | 4.39.0 | `engines.node >= 22` |
| `minecraft-protocol` | 1.62.0 | 1.68.0 | `engines.node >= 22`; it asks `protodef ^1.18.0`: the pin 1.19.0 stays |
| `minecraft-data` | 3.98.0 | 3.119.0 | the newest with 26.1; no 26.2 |
| `prismarine-chunk` | 1.39.0 | 1.41.0 | mineflayer asks `^1.41.0` |
| `prismarine-physics` | 1.10.0 | 1.11.1 | asks `^1.11.1` |
| `prismarine-recipe` | 1.3.1 | 1.5.0 | asks `^1.5.0` |
| `prismarine-registry` | 1.11.0 | 1.12.0 | |
| `prismarine-block` | 1.22.0 | 1.23.0 | |
| `prismarine-item` | 1.17.0 | 1.18.0 | in both `dependencies` and `overrides` |
| `prismarine-entity` | 2.5.0 | 2.6.0 | |
| `prismarine-windows` | 2.9.0 | 2.10.0 | |
| `prismarine-world` | 3.6.3 | 3.7.0 | |
| `prismarine-biome` | 1.3.0 | 1.4.0 | |
| `prismarine-chat` | 1.11.0 | 1.13.0 | |
| `prismarine-nbt` | 2.7.0 | 2.8.0 | |
| `mineflayer-pathfinder` | ^2.4.5 | 2.4.5 pinned | unchanged since 2023; our patch |
| `mineflayer-pvp`, `mineflayer-collectblock`, `mineflayer-armor-manager`, `mineflayer-auto-eat`, `prismarine-viewer`, `protodef` | as today | as today | `mineflayer-auto-eat` stays `^3.3.6`: 5.x is another API |

Add `"engines": { "node": ">=22" }`. Node 22 is the newest LTS with a build of every native module we use;
Node 24 is not required and the owner's rule (one Node, through fnm) stays. `start-claude.ps1` and
`start-gpt.ps1`: `fnm use 20` becomes `fnm use 22`. `CLAUDE.md`, `docs/SUPERVISOR.md`, the skill:
`fnm exec --using=v20.20.2` becomes `fnm exec --using=v22`. The exact 22.x the owner installs is his.

### 4.2 Part L: the patches

Each patch is regenerated with `npx patch-package <name>` from the new version, named
`<name>+<new version>.patch`; the old file goes. Test-applied by the lead on 2026-11-03:

| Patch | On the new version | What to do |
|---|---|---|
| `minecraft-data+3.98.0` (the explosion's knockback as `vec3f64`, 1.21.6 and 1.21.8) | upstream since 3.117.0 | **Drop.** Check in 3.119.0 that `pc/1.21.8/protocol.json` and `pc/26.1/protocol.json` read the knockback as `vec3f64`; W47 twice in the gate |
| `minecraft-protocol+1.62.0` (`src/client/chat.js`, 2 hunks) | applies at an offset of 42 lines | Regenerate as `+1.68.0` |
| `mineflayer+4.33.0`, `bed.js` (`leave_bed` through the string mapper) | the context matches; 4.39.0 still writes `actionId: 2`. **Found in round 1 (E1):** minecraft-data 3.119.0 removed the feature `entityActionUsesStringMapper` and renamed the actions of 1.21.6 and later (0 `stop_sleeping`, 1 `start_sprinting`, 2 `stop_sprinting`, 6 `start_fall_flying`); 4.39.0 falls back to the old numbers, so on 1.21.8 and 26.1 `bot.wake()` sent "stop sprinting" and a sprint sent "start riding jump" | **Rewrite:** from 1.21.6 on (`bot.registry.version['>=']('1.21.6')`) `bed.js` writes `'stop_sleeping'`, `physics.js` writes `'start_sprinting'`/`'stop_sprinting'` and `'start_fall_flying'`; the names go through the mapper of the data. Below 1.21.6 the old numbers. A unit test checks the serializer on 1.21.8 and 26.1; E1 proved wake and sprint on a 26.1 server |
| `mineflayer+4.33.0`, `digging.js` (`incorrect_for_wooden_tool` as `mineable/pickaxe`; `isInWater` false) | fails on context: 4.37.1 took the `isInWater` fix upstream; the material fix is still needed (the test of 2026-11-04: iron ore 4,550 ms instead of 750 with an iron pickaxe, deepslate iron ore 6,750 instead of 1,150, with iron, stone and copper pickaxes; stone correct) | Re-apply the material fix on the new call; drop the `isInWater` line. W121 part E checks the dig time |
| **new** `mineflayer`, `lib/plugins/entities.js` (the knockback) | 26.1 sends `entity_velocity` as an `lpVec3` in blocks per tick (minecraft-data's feature `entityVelocityIsLpVec3`, 1.21.9+); 4.39.0 still divides it by 8,000, so a hit moves the bot by 0.00005 blocks: no knockback from a player or a zombie (issue #4167, confirmed on 2026-11-04). Round 1 (E1): `spawn_entity` carries the same velocity and has the same bug | **Add** a hunk for both packets: with `bot.supportFeature('entityVelocityIsLpVec3')` the velocity is taken as it is, else through `fromNotchVelocity`. W121 part E checks the knockback |
| `mineflayer+4.33.0`, `inventory.js` (the yaw and pitch of `use_item`) | upstream: `rotation: { x: toNotchianYaw(bot.entity.yaw), ... }` | **Drop** after checking that the pitch is there too |
| `mineflayer+4.33.0`, `place_block.js` (the timeout of the block update 5000 to 500) | fails on context only; 4.39.0 still has 5000 | Re-apply |
| `mineflayer-pathfinder+2.4.5` (919 lines: the pen gates, the ladders, the no-dig rule) | the library is unchanged | Keep as is; the gate proves it against the new physics and blocks |
| `mineflayer-pvp+1.3.2` | unchanged | Keep |
| `prismarine-physics+1.10.0`, `index.js` (the 10 trapdoor kinds) | applies at an offset of 1 line | Regenerate as `+1.11.1` |
| `prismarine-physics+1.10.0`, `features.json` (the version list) | the spec first said "upstream lists 1.21 and 26.1": wrong (round 1, E1). Upstream 1.11.1 lists them for `climbUsingJump` only; `climbableTrapdoor` still stops at 1.20 (the check uses the major version, "1.21", "26.1"), so a trapdoor over a ladder would not be climbable | Keep the `climbableTrapdoor` half with `"1.21", "26.1"`; drop the `climbUsingJump` half |
| `prismarine-viewer+1.33.0` | unchanged | Keep |
| `protodef+1.19.0` | unchanged | Keep |

`src/agent/agent.js` sends `player_loaded` itself after a spawn ("mineflayer 4.33 never sends that packet",
G2 of v0.1.4.12). Check whether 4.39.0 sends it; if it does, ours goes, with the comment; W107 and the
teacher of the journeys are the check.

### 4.3 Part D: the data of 26.1

From minecraft-data 3.119.0, `pc/26.1` against `pc/1.21.8` (checked by the lead):

**Copper tools.** `copper_pickaxe` harvests `iron_ore`, `copper_ore`, `lapis_ore`, `copper_chest` and not
`diamond_ore`, `gold_ore`, `redstone_ore`: the tier of stone. `maxDurability` 190.

- `ore_table.js`: `PICKAXE_LEVELS` gets `copper: 1`; `PICKAXE_USES` gets `copper: 190`; `pickaxeMaterial`
  returns `'copper'` for `copper_pickaxe` (and the sword, axe, shovel, hoe where the same function serves them).
- `mine_logic.js`: `PICKAXE_MATERIAL_ITEMS` gets `copper: 'copper_ingot'`.
- `supply_logic.js` `pickaxeToCraft`: never `'copper'`. Stone from cobblestone stays the cheapest for an ore
  of tier 1; a copper pickaxe the bot carries is a usable pickaxe of tier 1 (`usablePickaxes`), taken before
  a worn one and kept as a spare like a stone one.
- `texts.js` `materialWord`: `copper_pickaxe` gives `copper` (`I have no copper for a new one.` is never
  said, since none is crafted; the word exists for the spare and worn texts).
- The supply step's spare rule, the wear rule (`WEAR_LIMIT` 10) and the cheapest-pickaxe rule of fix 2 do not
  change.

**Copper chests.** The blocks `copper_chest`, `exposed_copper_chest`, `weathered_copper_chest`,
`oxidized_copper_chest` and their four `waxed_` variants: `CONTAINER_KINDS` of `storage_logic.js` and
`CHEST_BLOCKS` of `look_logic.js` list them; `isContainerKind` holds. The window of a copper chest is the
chest window (27 slots); the index saves `kind: 'copper_chest'` with the exact name. A shelf is no container.

**Foods.** `VANILLA_FOODS` of `food_logic.js` is regenerated from `pc/26.1/foods.json` with the same shape
(`[name, foodPoints, saturation]`, the comment says 26.1). The saturation column of 26.1 holds the game's
values (an apple 2.4, bread 6, cooked beef 12.8; 1.21.8 held 19.2, 60, 204.8): the order of the foods is the
same, and every caller compares, never reads an absolute saturation. `isEdibleFood` and the food choice
exclude a name that ends in `_bucket` (`cod_bucket`, `salmon_bucket`, `pufferfish_bucket`,
`tropical_fish_bucket` are listed as foods in 26.1 and are not food). The rule "never rotten flesh, spider
eyes, poisonous potatoes or raw chicken while anything else is there" stays.

**Names.** `chain` is `iron_chain` in 26.1; `copper_chain` is new. `THIN_BUILT_PARTS` of `ground_logic.js`
matches the word `chain` and needs no change; the engineer greps `src/` for `'chain'` as a whole name and
for every other 1.21.8 name that 26.1 renamed (the lead found only `chain`) and reports.

**Mobs.** `parched` is `Hostile mobs` in the data; `isHostile` of `mcdata.js` reads the category, so the
self-defence, the door rule and the shelter rule cover it without a change. The engineer checks that no list
in `src/` names hostile mobs by name in a way that would leave `parched` out, and reports.

**Unit tests** `tests/unit/xd_*.test.js`: the pickaxe tiers and uses with copper; `pickaxeToCraft` never
returns copper; `usablePickaxes` ranks copper as tier 1 below iron; the 8 copper chests are containers and a
shelf is not; the food table has the 26.1 values, no bucket is edible, cooked beef ranks above bread above
apple; `isHostile` for `parched`.

### 4.4 Part T: the test setup

**The server.** `scripts/get_test_server_logic.js`: `VERSION = '26.1'`, `JAR_NAME = 'server-26.1.jar'`,
`JAR_SHA1 = '3872a7f07a1a595e651aef8b058dfc2bb3772f46'`, size 60,417,588 bytes (Mojang's version file of
26.1). The usage text names 26.1 and Java 25. `tests/world/mc_server.js`: `JAR_NAME` likewise;
`DEFAULT_JAVA` is the launcher's `java-runtime-epsilon` (Java 25) in place of `java-runtime-delta`; the
runner refuses a Java below 25 with one line that says what it found and what it needs (the 26.1 server
requires Java 25: `javaVersion.majorVersion` 25 in Mojang's version file). `tests/world/README.md`: Java 25,
the jar, the sha. In the cloud there is no Java 25: `scripts/get_test_server.js --jdk` downloads the Eclipse
Temurin 25 JRE for the machine (Linux x64 or Windows x64, from `https://api.adoptium.net/v3/binary/latest/25/ga/<os>/x64/jre/hotspot/normal/eclipse`,
checked by the sha256 the API gives) into `<test-server dir>/jdk/`, and the runner takes `<dir>/jdk/*/bin/java`
when `MC_TEST_JAVA` is unset and the default Java is missing or older than 25. `scripts/dump_region_logic.js`:
`MC_VERSION = '26.1'`.

**The bots of the tests.** `tests/world/helpers.js` (the player bot `version`), `tests/helpers/xt_bot.js`
(`VERSION`), `tests/helpers/st_modes_env.js` (`REGISTRY`), `tests/helpers/st_glue_env.js`,
`tests/e2e/helpers.js` (`minecraft_version`): `'26.1'`. `tests/play/run.js`: the comment.

**The simulated server** `tests/e2e/fake_server.js`: `VERSION = '26.1'`. It writes the login and the world
packets itself; where 26.1 changed a packet's shape (the login packet's registries, the chunk data, the
entity movement), the server is adapted until every end-to-end scenario passes. Nothing of a scenario is
weakened for it.

**Literal ids in tests.** 946 of 1,105 block ids and 1,185 of 1,416 item ids moved between 1.21.8 and 26.1.
Every unit test or helper that holds a literal id (`type: 892`, `harvestTools: { 721: true }`; the lead
counted 12 lines) takes it from the registry by name (rule 26). `tests/unit/xe_*.test.js`: the version
constants of the helpers are `'26.1'`; the jar and the sha of the test server logic; the Java rule of
`mc_server.js` with a fake `java -version` output.

**The owner's region.** `tests/world/owner_region.json` (ignored by git) is a dump by block names and stays
valid; `base_world.js` builds from names. No change unless a name of the dump is renamed (`chain`).

### 4.5 Part TW: the journey W121 "the Copper Age"

The owner variant of the base on a 26.1 server with the room tunnel, the owner's switches of v0.1.4.12 and
v0.1.4.13 (`SUPERVISION_SETTINGS`), the modes of his profile, an empty memory. Fails on v0.1.4.13: the kit
cannot be given (no `copper_pickaxe`, no `copper_chest` in 1.21.8), which the scenario reports as the finding.

- **A. The copper pickaxe.** The kit: a `copper_pickaxe` worn to 12 uses (damage 178 of 190), 16 torches,
  8 ladders, 4 bread, 8 cobblestone, 2 sticks, no other pickaxe. The player teaches the mine in the room
  (`partTeachMineInRoom`); 6 iron ore beyond the rock face as in W114. Typed `!mineOre("iron", 6)`: within 3
  minutes the bag holds 6 raw_iron (server); the copper pickaxe dug (its damage rose) and was replaced at 10
  uses or fewer by a stone one (`My copper_pickaxe is nearly worn: N uses left. I made a new one.`); the bag
  holds the old copper one and a `stone_pickaxe`, no second copper one; the 8 cobblestone are spent by 3.
- **B. The copper chest.** A `copper_chest` with 20 bread set by the control 4 blocks from the bot in the
  room, no other chest within 16. The bot's food is set to 4 (`foodTo`). Typed `!mineOre("iron", 2)`: the
  supply text names the chest: `I get my supplies: N bread from the chest at (x, y, z).` with the copper
  chest's cell; the bread count of the chest fell (server); `look 16` of the watch server lists it under
  `Chests:`.
- **C. The food choice.** The bag holds 3 bread and 3 cooked_beef, and a `cod_bucket`; the bot's food is set
  to 4. Within 30 s the bot ate cooked beef (its count fell to 2, the bread stays 3, the bucket stays).
- **D. What the model does not know** (`new_things_in_prompt` on). With the copper pickaxe of part A in the
  bag, the chat prompt of the fake model (recorded by the harness) holds
  `NEW SINCE 1.21.8 (true, even if you do not know it):` and the copper tools line. The player says "make me
  a spear": the next prompt holds the spear line; the fake model answers `!craftRecipe("stone_spear", 1)`
  and the bag holds a `stone_spear` (server). With the pickaxe stored and nothing new near, the next prompt
  holds no `NEW SINCE` header.
- **E. Knockback and dig time** (the two library defects of 26.1, SPEC 4.8). A second bot of the control (survival,
  1.5 blocks east, as the hitter of the test of 2026-11-04) hits the bot once with its fist: within 1 s the bot's
  position moved at least 0.3 blocks west (server), every component of `bot.entity.velocity` stayed a finite number,
  and `onGround` is true again within 3 s. Then an `iron_ore` set next to the bot: `!collectBlocks("iron_ore", 1)` with
  the iron pickaxe in hand takes at most 1,500 ms from the first `block_dig` to the block being air (server), not
  4,550.
- Throughout: the process lives, no request reached a real model, the server log holds no
  `Unknown packet` or disconnect of the bot.

### 4.7 Part K: what the model does not know

The chat model (Claude Haiku 4.5 in the owner's profile) was trained before 1.21.9; it does not know the
things of PLAN section 4b and says "I don't know" or picks a wrong name. The data knows them (26.1 of
minecraft-data), so every command works once the model names the thing.

**The table.** `src/agent/knowledge/new_things.js` exports `NEW_THINGS`: a frozen list of entries
`{ names: [...], since: '1.21.9' | '1.21.11' | '26.1', line: '...' }`, one entry per thing, the names as the
registry spells them (items, blocks, entities, effects; a wood or copper variant lists every variant). The
lines, word for word:

| names | line |
|---|---|
| copper_pickaxe, copper_axe, copper_shovel, copper_hoe, copper_sword, copper_nugget, copper_helmet, copper_chestplate, copper_leggings, copper_boots | `Copper tools and armour exist since 1.21.9: like stone but faster, 190 uses, from copper ingots; a copper pickaxe mines iron, copper and lapis, not diamond or gold.` |
| copper_chest and its 7 variants | `A copper chest is a chest with 27 slots; it oxidizes unless waxed; a copper golem takes items out of it.` |
| copper_golem, copper_golem_statue and its variants | `A copper golem sorts items: it carries up to 16 from a copper chest into a chest that is empty or holds that kind, within 32 blocks; a pumpkin on a copper block spawns one.` |
| the 12 shelves | `A shelf holds 3 item stacks; using a slot swaps it with the item in hand. It is not a chest.` |
| copper_torch, copper_wall_torch, copper_lantern, copper_bars, copper_chain, iron_chain and the oxidized and waxed variants | `Copper torches, lanterns, bars and chains work like the iron ones; the chain is called iron_chain now.` |
| the 7 spears | `A spear is a weapon with long reach since 1.21.11: a quick jab or a charge while running; wood to netherite; it breaks no blocks.` |
| parched | `A parched is a desert skeleton that does not burn in sunlight and shoots arrows of weakness.` |
| camel_husk | `A camel husk is an undead camel; with its husk and parched riders it is hostile, without them harmless.` |
| nautilus, zombie_nautilus | `A nautilus is a neutral ocean mob that dashes when hit and is tamed with pufferfish; a zombie nautilus carries a drowned with a trident.` |
| zombie_horse | `Zombie horses spawn at night with a zombie rider that holds a spear.` |
| golden_dandelion | `A golden dandelion, used on a baby animal, stops it from growing; used again, it grows.` |
| name_tag | `A name tag is crafted from 1 paper and 1 nugget of any metal since 26.1.` |
| mannequin | `A mannequin is a player-shaped figure placed by command, not a mob.` |
| breath_of_the_nautilus (effect) | `Breath of the nautilus pauses the use of air under water.` |

**The selection**, pure: `newThingLines({ inventory, near, lines, limit })` returns at most `limit` (3)
lines, each once, in this order: a thing in the bag (`inventory`: names), a thing in view (`near`: the
names of blocks within 8 blocks and entities within 16, from the look scan of the watch server's
`look_logic.js` reused as a reader, no model call), a thing a line of the owner or of the model names
(`lines`: the last 3 chat lines and the last command text; a name matches as a whole word, with spaces or
underscores, singular or plural: "copper pickaxe", "spears", "shelf"). Nothing matches: an empty list.

**The prompt.** With `new_things_in_prompt` on, the lines follow the knowledge block (after its last line,
or alone when the block is off), headed `NEW SINCE 1.21.8 (true, even if you do not know it):`. The block
is at most 3 lines and 360 characters. The prompt-size tests (`gjg_prompt` and the others that hold
17,000) allow 17,400 characters with every switch on, a block of 600 and these 3 lines: the lead's
decision, recorded here, since the budget of v0.1.4.13 had 13 characters left. With the switch off nothing
changes in the prompt and the old limits hold.

**Unit tests** `xk_*.test.js`: every name of the table is in the 26.1 registry (items, blocks, entities or
effects) and none in 1.21.8's except `name_tag`, `zombie_horse` and `mannequin` (which existed, and changed);
the selection by bag, by view, by line, the order, the limit, the whole-word match ("copper" alone matches
nothing); the prompt holds the header and the lines with the switch on and nothing with it off; the sizes.

### 4.8 Known issues of the libraries on 26.1

Checked on 2026-11-04 with the released libraries on a vanilla 26.1 server (`DECISIONS.md`, "Before the build").

| Issue | On 26.1 with 4.39.0 | What we do |
|---|---|---|
| #4167 no knockback since 1.21.9 | **Real**: a hit from a player or a zombie moves the bot by 0.00005 blocks | The `entities.js` hunk of 4.2; W121 part E |
| #3921 wrong dig time for `incorrect_for_wooden_tool` blocks (the ores) | **Real**: 4,550 ms instead of 750 for iron ore | Our `digging.js` material fix stays; W121 part E |
| #3882, #3887 the bot freezes or hangs in the air after damage | Not reproduced: no NaN in 121 of 121 ticks, `onGround` back after one tick, it walked and jumped right after | Nothing; W121 part E guards it (finite velocity, `onGround`) |
| #3911, #3915 stuck at one-block steps, hundreds of position corrections | Not reproduced on vanilla: a 5-step staircase and a wall detour with 0 corrections (the reports were on Paper) | Nothing; the journeys walk stairs and ladders |
| #3906 3x3 crafting delivers nothing | Not reproduced as described: the server counts the stone pickaxe. **Found in the gate (G-4):** mineflayer keeps one `stateId` for every window, so a craft right after a container window closed clicks with a stale id; the server drops a click, the planks end on the cursor and every later craft fails. Also a table craft of several resolves before the server's correction (R2-10) | The `inventory.js` hunk (the window's state before a click on another window) and the `craft.js` hunk (the server's state after each unit, the count check) of 4.2 |
| #3838 kick after about 22 chat messages | Not reproduced in offline mode: 30 lines each way; only the vanilla spam limit at 300 ms spacing, which our chat limit of v0.1.4.8 already respects (6 lines, then 1 per 1.2 s) | Nothing; signed chat (online mode) is not our case |

Found in the build and the gate, not in the issue tracker (`DECISIONS.md` R1-1, R2-4, R2-8, G-7): minecraft-data
3.119.0 renamed the entity actions of 1.21.6 and later and 4.39.0 still sends the old numbers (the `bed.js` and
`physics.js` hunks); `chest.js` cannot open a copper chest (the hunk); the explosion packet of 26.1 carries `center`
(the bot's reader accepts both shapes); a climb up a ladder through a trapdoor stalled on silent teleports by the server, a floating-point
slip of the physics' collision (the `aabb.js` hunk, G-12); `time.js` reads the clock of the End as
0 (the bot does not go there).

### 4.9 Part H: the chat model Claude Haiku 5.5 (if the owner confirms the switch)

The owner, 2026-11-04: the bot moves to Claude Haiku 5.5 (`claude-haiku-5-5`). `src/models/claude.js` sends only
`max_tokens`, the system prompt and the messages and reads the answer by block type, so it is compatible as it is.
Part H (E2, 2 hours): `profiles/claude.json` gets the model id and `"output_config": { "effort": "low" }` in its
params (the chat's level; the model still thinks when a line needs it); `src/agent/cost/price_table.js` gets the
row `claude-haiku-5-5: input 0.10, output 0.50` (the rate for prompts up to 100K tokens; ours is about 5K) with a
unit test; the cost meter's session line is checked to count the thinking tokens (they are in `output_tokens`).
Known from the docs, no code: the minimum cacheable prefix is 512 tokens (4,096 on Haiku 4.5), so `prompt_cache`
now works for the whole fixed part; the tokenizer counts about 30% more tokens, so the meter's token numbers rise
while the cost falls to about a tenth. The play test reads the cache reads and the cost line. Part K stays
independent of the model: whether Haiku 5.5 knows the things of 4.3 is for the owner's probe to show.

### 4.6 Texts

No new text of the bot. The worn and spare texts of the mining take the pickaxe's name as today, so
`My copper_pickaxe is nearly worn: 9 uses left. I take my spare one.` comes from the existing text.

## 5. Order of work

1. T3 writes W121 and runs it on v0.1.4.13 against a 26.1 server: it fails at the kit. (It needs the server of
   part T first: T3 and E3 agree on `get_test_server.js` by the second day; until then T3 uses a 26.1 jar and a
   Java 25 by hand through `MC_TEST_SERVER_DIR` and `MC_TEST_JAVA`.)
2. E1 (L), E2 (D), E3 (T) in parallel, round 1. E1 first: without the libraries nothing connects. E1 reports
   the install log of a clean `npm run reinstall` with Node 22 and the `patch-package` lines.
3. The lead merges, runs unit and end-to-end, writes `HANDOFF.md`.
4. T1 writes the tests from the spec (round 2) while the lead runs the world set on 26.1.
5. `DECISIONS.md`, the fix round, the gate in a fresh clone, the changelog, the pull request, the tag
   `v0.1.4.14`, the play test guide.

## 6. The gate

In a fresh clone with Node 22 and a 26.1 server (Java 25): `npm test` with 0 failures;
`npm run test:e2e` with 0 failures; `node tests/world/run.js journeys journeys13 copper_age creeper_in_sight`
with every scenario passing (a scenario that fails twice is a finding, one that fails once and passes alone
is noted in `DECISIONS.md` as today). `creeper_in_sight` runs twice, as in the gate of v0.1.4.13, because the
explosion patch is dropped.

## 7. The play test guide (for the lead to write)

Your steps: back up the world; Node 22 (`fnm install 22`); the client on 26.1; `npm run reinstall`;
`npm run voice:setup` if the voice is on; open the world; the usual walks of `PLAYTEST.md` of v0.1.4.13 in
short (follow me through the pens, the mine, a mining trip, sleep, the supervisor), and the three new
things: a copper pickaxe in the bag during a mining trip, a copper chest as the mine's chest, a steak and
bread in the bag at low food. What I would like to know: whether the voice and the viewer rebuilt on Node
22, and every place the bot walks differently than on 1.21.8.

## 8. Round 3: the play of 2026-11-09 (fix round, part 8)

The rules of section 0 hold. The findings are DECISIONS.md P-17 to P-32; the owner's order: the clock first, the
farm second, then the rest by impact. Owners by file: **E1** `patches/`, `src/models/claude.js`,
`src/agent/mindserver_proxy.js`, `src/agent/watch/`, the `time` listener of `src/agent/agent.js`, the fake server of
the end-to-end tests (with T3): P-17, P-19 (snow and ice), P-21, P-22, P-30. **E2** `src/agent/library/skills.js`,
`src/agent/modes.js`, the new commands in `src/agent/commands/actions.js`: P-19 (the fallback), P-20 (the text),
P-25, P-26, P-27, P-28, P-29. **E4** `src/agent/areas/`, `src/agent/packs/home/`, the `rememberArea` block of
`actions.js`, the farming pack's reading of a farm: P-18, P-20 (the placed store), P-23, P-24. **T3** the
scenarios of 8.10. The lead: P-31 (closed: the table is right, Haiku 5.5 is $0.10 / $0.50 and Sonnet 5.5 is priced
as Sonnet 5; cache reads at a tenth explain the figure), P-32 (the docs). Two engineers may touch `actions.js`
and `agent.js`: edits only, never a whole-file write, and a line to the lead when done.

### 8.1 The clock (P-17, E1)

1. When the server sends `clockUpdates` (26.1), `bot.time.time`, `bigTime`, `timeOfDay`, `day`, `isDay` and
   `moonPhase` follow the clock of the current dimension every physics tick: between packets they advance with the
   clock's `rate` (with rate 0 they stand still), a packet sets them to the server's value. With the old packet
   shape (1.21.8) nothing changes.
2. The `time` event fires on every packet and, between packets, at most once per 20 ticks (the cadence of the
   packets of 1.21.8) and only when the fields changed.
3. Listeners that compared exact values (`agent.js`, the `time` listener: `== 0`, `6000`, `12000`, `18000`)
   take the crossing of the mark since the last event, so a sunrise is neither missed nor doubled.
4. The change lives in `patches/mineflayer+4.39.0.patch` (`lib/plugins/time.js`); a unit test on the patched
   file (`xl_time_runs`: a fake client sends one `update_time` with rate 1, 40 physics ticks later `timeOfDay` is
   40 more and `time` fired twice; rate 0: unchanged; a second packet sets the value; the old packet shape
   unchanged).
5. The fake server of the end-to-end tests gets the scenario `night_falls` (T3 with E1): one `update_time` at
   login with `totalTicks` 12700 and rate 1, no later packet; 30 s later the agent's `!stats` says the night
   label and the night event of the watch fires. Before the fix the scenario fails.

### 8.2 Farms and pens (P-18, E4)

1. `kindOf`: cats, wolves and parrots are pets, not animals of the pen rule. What makes a pen is its border: a pen
   is surrounded by a fence (the border `fence`, its openings gates) and holds animals of one kind or more, with a
   roof or without one (the owner, 2026-11-09: "a livestock pen can be with roof or without it, but it needs to be
   surrounded by a fence"). A walled enclosure (the border `wall`, doors) is never a pen whatever stands inside
   it: a home (a roof, a door, a bed), a storage, a building, by the rules as they were. A fenced enclosure
   without animals is a yard; a farm needs no fence (point 3). The base's house, pens, farm and room keep their
   kinds.
2. A typed kind wins: `!rememberArea(name, kind)` saves the kind the player named and the answer describes what was
   found (`I saved "home": a building, walled, 6 x 8 with a roof, 2 doors, 2 cats, ...`). A typed kind with nothing
   found saves nothing, like the untyped scan (P1 of v0.1.4.11): the answer is P1's `I find no border around me ...
   Stand inside the place and say it again.`; the box of v0.1.4.10 is never saved for a typed kind.
3. `!rememberArea(name, "farm")` with no fence saves the open farm: the connected farmland (with the water, the
   crops and the paths among it) within 24 blocks of the bot, boxed with a margin of 1 and a height of 2,
   border `open`. `I saved "<name>": an open farm 9 x 5 with 28 carrots and 12 potatoes.`; no farmland:
   `I see no farmland within 24 blocks of me and no fence. Stand on the field and say it again.` A fenced farm as
   before. The farming pack works an open farm as any farm (its field is the farmland of the box).
4. Tests: `kindOf` (cats, a roof and a bed: home; sheep and a gate without a roof: pen; sheep, a door and a roof:
   building), the open-farm box on a fake field, the typed kind; W124 (8.10).

### 8.3 The path finder (P-19)

1. E2, `goToGoal`: the destructive fallback ("Path not found, but attempting to navigate anyway") runs only for a
   way of at most 32 blocks; a longer way is walked as near as the path finder gets without digging, then
   `I found no way to (x, y, z) without digging; I stopped at (x, y, z), N blocks away.` The fallback never digs a
   block below the bot's start level minus 1 and never a block touching water or lava.
2. E1: `snow` (the layer) and `snow_block` are breakable by hand for the path finder and for the check
   `Cannot break ... with current tools` (the game breaks them by hand; only the drop needs a shovel); the fix
   where the rule lives (the pathfinder patch or the check in `skills.js`, which E1 may edit for this one line).
3. E1: the climb from water onto ice (`ice`, `packed_ice`, `blue_ice`, `frosted_ice`): why the path finder or the
   physics refuse it, fixed if small; else a known issue (4.8) with the words the bot says.
4. Tests: the fallback decision (lengths, the dig floor, water), the snow rule; W125 (8.10).

### 8.4 The library (E2)

1. P-20: `collectedText` counts the blocks that are gone after the dig, never the attempts: `I broke 0 black_bed:
   <the reason>.` A block the bot placed itself (E4 makes `placedByBot` cover every block the bot placed, beds
   included) may be collected on any order, typed or not; a block somebody else built only on a typed order (the
   owner's rule of v0.1.4.8); the refusal names it: `I do not break a black_bed that I did not place; type the
   order yourself if you want it gone.`
2. P-25: before the toss, water or lava on the line from the bot to the player at ground level, or within 2
   blocks behind the player: the bot walks to a side where the line is dry (up to 3 sides) and tosses from 1
   block; none: `I could not give you N item: water all around you; come to dry ground.`
3. P-26: after a kill the drops are taken from the stands of `pickupStands` for up to 3 s after the death (the drop
   lands late); `Picked up N items.` counts what the bag gained.
4. P-27: the unstuck mode is quiet while `bot.vehicle` is set; "I'm stuck!" never fires in a boat or a minecart.
5. P-28: `!boardBoat()` boards the nearest boat within 6 blocks (`I boarded the boat.`, `I see no boat within 6
   blocks.`); `!leaveBoat()` (`I left the boat.`, `I am not in a boat.`); `!leaveGame(reason)` says
   `I leave the game: <reason>.`, writes the exit note `left on request` and exits with code 0 (E2 reads
   `start-claude.ps1` and the supervise skill: if they restart on every exit, the note says so and the handoff
   names it).
6. P-29: no sprinting below 7 food points; a walk of more than 200 blocks with 10 food points or fewer is
   announced first: `A long way: N blocks with F food points; I do not run.`

### 8.5 The area sense (P-23, E4)

A hollow whose floor lies below the ground around it and whose walls are the ground itself (dirt, stone, snow, sand,
gravel, ice) is a pit, no building: "a building of dirt or stone is walled too" applies only to walls that stand
above the ground. A water-bound area of more than 20 x 20, or whose water is open water (water at the surface for
8 blocks or more outward), is no yard. Snow blocks and snow layers are natural. Fake layouts of the pit, the snow
hollow and the frozen ocean in `xl_natural_terrain`; the house, pen, farm and room scenarios unchanged.

### 8.6 Beds (P-24, E4)

A bed is placed on two level ground cells with air above them, each support block with at least two solid
neighbours at its level (no pillar), within 1 block of the bot, with a free cell beside the bed to stand on;
otherwise the bot looks within 4 blocks for such a place and walks there; none: `I found no level ground for the bed
within 4 blocks.` `!placeHere("<kind>_bed")` and the bed of the sleep pack use the same rule.

### 8.7 The model class (P-21, E1)

The messages sent to Claude end with a user turn: when the last turn is the assistant's, the filler of
`strictFormat` (`_`) closes the list, in `claude.js` after `strictFormat`. E1 verifies with the turns of a command
answer which path produces the trailing assistant turn and fixes the source too if it is ours. A unit test with a
turn list ending in the assistant's.

### 8.8 The proxy (P-22, E1)

A `send-message` from the page before `respondFunc` exists is kept (up to 20 lines) and delivered when it is set;
the page gets `The bot is not ready yet; your line is kept.` A unit test.

### 8.9 The watch tooling (P-30, E1)

`run` of the watch server counts a result whose last line is `You have reached (x, y, z)` as a success whatever
the lines before it; the inventory of `state` and of the view is read from the bag at the request, not from a
cached tick (E1 names the lag's source and fixes it if small).

### 8.10 The scenarios (T3) and the gate

W123 "the night falls" (base world): `gamerule doDaylightCycle true` (the harness translates it), `time set
12000`, nobody sleeps; after 60 s the bot's clock (through `!stats` and the watch `state`) is within 100 ticks of
the server's `time query daytime`; at 13000 and more "is it night?" is answered with the night and `!goToBed` is
not refused as daytime; `time set 1000` sets the bot's clock within 1 s; the cycle off again at the end. Against
9e4ff1f the scenario fails (the clock stands at 12000). W124 "the open farm and the cats" (base world): the house
with 2 cats and a bed, `!rememberArea("home", "building")` saves a building; a field of farmland with carrots
and no fence, `!rememberArea("carrots", "farm")` saves an open farm with its crops and the farming pack can work
it; the pen with its chickens stays a pen; a pit dug beside the house raises no yard. W125 "the open ground"
(natural world): a bed placed on a slope lies on level ground and the bot sleeps in it; a give beside a pond
reaches the player; a summoned sheep killed and its drops in the bag; a snow field (`setblock`) crossed without a
shovel; a way of 60 blocks to a goal behind a hill ends without a tunnel. T3 writes W123 first and runs it against
9e4ff1f: it must fail; then W124 and W125. The gate of section 6 with `natural_smoke fresh_world night_falls
(end-to-end) W123 W124 W125`.

### 8.11 Texts, word for word

`I saved "<name>": an open farm <w> x <d> with <crops>.` · `I see no farmland within 24 blocks of me and no fence.
Stand on the field and say it again.` · `I found no way to (x, y, z) without digging; I stopped at (x, y, z), N
blocks away.` · `I broke 0 <block>: <reason>.` · `I do not break a <block> that I did not place; type the order
yourself if you want it gone.` · `I could not give you N <item>: water all around you; come to dry ground.` ·
`I boarded the boat.` · `I see no boat within 6 blocks.` · `I left the boat.` · `I am not in a boat.` ·
`I leave the game: <reason>.` · `A long way: N blocks with F food points; I do not run.` · `I found no level
ground for the bed within 4 blocks.` · `The bot is not ready yet; your line is kept.`
