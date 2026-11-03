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
| Nothing regressed | the 30 journeys, the 12 of v0.1.4.13, the full set, all on 26.1 |

## 2. Settings

None.

## 3. Parts, owners, files

| Part | Engineer | Files (owned) | Round |
|---|---|---|---|
| L The libraries, the patches, Node 22 | E1 | `package.json`, `package-lock.json`, `patches/*`, `start-claude.ps1`, `start-gpt.ps1`, `CLAUDE.md` (the Node lines), `docs/SUPERVISOR.md` and `.claude/skills/supervise/SKILL.md` (the `fnm` lines only), `src/agent/agent.js` (the `player_loaded` send only, 4.2) | 1 |
| D The data of 26.1 | E2 | `src/agent/packs/mining/ore_table.js`, `mine_logic.js` (`PICKAXE_MATERIAL_ITEMS`), `supply_logic.js` (`pickaxeToCraft`: copper), `texts.js` (`materialWord`), `src/agent/packs/storage/storage_logic.js` (`CONTAINER_KINDS`), `src/agent/watch/look_logic.js` (`CHEST_BLOCKS`), `src/agent/packs/home/food_logic.js` (`VANILLA_FOODS`, `isEdibleFood`), `food.js`, `src/utils/mcdata.js` (only if a name is pinned there); `tests/unit/xd_*.test.js` | 1 |
| T The test setup on 26.1 | E3 | `scripts/get_test_server.js`, `get_test_server_logic.js`, `scripts/dump_region_logic.js`, `tests/world/mc_server.js`, `tests/world/helpers.js` (the version of the player bot), `tests/world/run.js`, `tests/world/README.md`, `tests/e2e/fake_server.js`, `tests/e2e/helpers.js`, `tests/e2e/run.js`, `tests/helpers/xt_bot.js`, `tests/helpers/st_modes_env.js`, `tests/helpers/st_glue_env.js`, `tests/play/run.js`; the unit tests that hold a literal id (rule 26); `tests/unit/xe_*.test.js` | 1 |
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
| `mineflayer+4.33.0`, `bed.js` (`leave_bed` through the string mapper) | the context matches; 4.39.0 still writes `actionId: 2` | Keep |
| `mineflayer+4.33.0`, `digging.js` (`incorrect_for_wooden_tool` as `mineable/pickaxe`; `isInWater` false) | fails: `digTime` is called with other arguments in 4.39.0 | Read the new call. Re-apply what is still needed; what upstream fixed is dropped. Say in the report which of the two fixes stays and why. The dig times of the mining trips (W114, W120) are the check |
| `mineflayer+4.33.0`, `inventory.js` (the yaw and pitch of `use_item`) | upstream: `rotation: { x: toNotchianYaw(bot.entity.yaw), ... }` | **Drop** after checking that the pitch is there too |
| `mineflayer+4.33.0`, `place_block.js` (the timeout of the block update 5000 to 500) | fails on context only; 4.39.0 still has 5000 | Re-apply |
| `mineflayer-pathfinder+2.4.5` (919 lines: the pen gates, the ladders, the no-dig rule) | the library is unchanged | Keep as is; the gate proves it against the new physics and blocks |
| `mineflayer-pvp+1.3.2` | unchanged | Keep |
| `prismarine-physics+1.10.0`, `index.js` (the 10 trapdoor kinds) | applies at an offset of 1 line | Regenerate as `+1.11.1` |
| `prismarine-physics+1.10.0`, `features.json` (the version list) | upstream lists 1.21 and 26.1 | Drop that hunk |
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
- Throughout: the process lives, no request reached a real model, the server log holds no
  `Unknown packet` or disconnect of the bot.

### 4.6 Texts

No new text. The worn and spare texts of the mining take the pickaxe's name as today, so
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
