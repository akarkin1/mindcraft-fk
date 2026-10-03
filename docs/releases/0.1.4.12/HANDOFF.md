# Handoff notes v0.1.4.12

Notes between the parts, by the engineers, accepted by the tech lead. Where they disagree with
`SPEC.md`, they win.

## From part E (smelting, E2), done in round 1

### Exports

| File | What |
|---|---|
| `src/agent/packs/storage/smelt_logic.js` | pure: the product table (minecraft-data 1.21.8 has no smelting recipes), `productOf(item)`, `chooseFuel(inventory, count)` (one fuel kind per batch, the kind that covers the most when none covers the count; logs being smelted are not fuel), the batches of 64, the time limit, the furnace and placement choice |
| `src/agent/packs/storage/smelt.js` | `smeltItem(bot, ctx, item, count, options)` → `{ ok, reason, text, smelted, fuel }`, never throws; bound by `bindStorage` as `ctx.storage.smeltItem` |
| `src/agent/packs/storage/texts.js` | `TEXTS.smelted`, `noFuel`, `noFurnace`, `noItem`, `stopped`, `notSmeltable` of the spec, and beyond it: `I ran out of time after N of M item.`, `The furnace stopped after N of M item.` (14 s without change), `I carried only N item.`, `I had fuel for N only.`, `The furnace at (x, y, z) is busy with N name.`, `I could not get to the furnace at (x, y, z).` |
| `src/agent/job/plan_logic.js` | `!smeltItem` checked by its product and count; `missingSupplies` adds `smelt: '!smeltItem("raw_iron", n)'` for iron_ingot (copper and gold too); an own copy of the product table (the job module imports no pack; a test keeps the copies equal) |
| `src/agent/job/job_logic.js` (lead) | `blockerOf`: the reason `no_iron` → `{ kind: 'no_iron', item: 'iron_ingot' }` |
| `src/agent/packs/wood/tools.js` | `smeltIronFor`; `ensureTool` for an iron tool with `smelting` on smelts the raw iron it carries or fetches from a known chest first, then crafts; without any iron `reason 'no_iron'` with `noIronText(name, count)` (pickaxe 3, axe 3, sword 2, shovel 1, hoe 2) |

### Decisions beyond the spec, accepted

| Decision | Why |
|---|---|
| A carried furnace lands only where the area guard's `canPlace` allows: in practice in a mine area (a home or building area refuses placing without a permit) | the spec said both conditions; the guard is the stricter one and stays |
| A furnace that holds another item in its input or output is skipped; a furnace the bot placed stays | no claim about what the code did not check |
| Only blocks named `furnace`, not blast furnaces or smokers | |
| The plan changes are not behind the switch | `plan_logic.js` has no settings; the step runs only when `!smeltItem` of the pack exists |
| The storage pack loads only when one of its switches is on; `smelting` needs `storage_pack` | the skill is of the storage pack |

### Requests

- To part B (the watching pack, round 2): nothing.
- To T3: W105 relies on the furnace of the room (a carried furnace would land only in the mine).
