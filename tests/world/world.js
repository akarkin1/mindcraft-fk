// Building and reading the world through the server console: the region of a scenario, a house,
// a tree, a fenced field, and snapshots of a box of blocks that prove a building is untouched.
//
// Coordinates: the region of a scenario has its origin at (env.ox, env.oz). `g` is the y of the
// top block of the flat ground (grass); a bot standing on the ground has its feet at g + 1.
import { commands, command, env } from './control.js';

export const MC = (name) => (name.includes(':') ? name : 'minecraft:' + name);
const P = (p) => `${p.x} ${p.y} ${p.z}`;
export const passed = (lines) => lines.some((l) => /^Test passed/.test(l));

// ------------------------------------------------------------------ region

export function region(radius = 48) {
    return { ox: env.ox, oz: env.oz, g: env.groundY, radius };
}

// Loads the chunks of the region, removes every entity but players, makes the ground flat grass
// (with dirt and bedrock below as in the flat world) and clears the air above it.
export async function prepareRegion(r, height = 24) {
    const x1 = r.ox - r.radius, x2 = r.ox + r.radius, z1 = r.oz - r.radius, z2 = r.oz + r.radius;
    const cmds = [`forceload add ${x1} ${z1} ${x2} ${z2}`];
    // one /fill may change at most 32768 blocks: one command per layer and per strip of x
    const strips = [];
    for (let x = x1; x <= x2; x += 64) strips.push([x, Math.min(x + 63, x2)]);
    for (const [a, b] of strips) {
        cmds.push(`fill ${a} ${r.g} ${z1} ${b} ${r.g} ${z2} minecraft:grass_block`);
        cmds.push(`fill ${a} ${r.g - 1} ${z1} ${b} ${r.g - 1} ${z2} minecraft:dirt`);
        for (let y = r.g + 1; y <= r.g + height; y++) cmds.push(`fill ${a} ${y} ${z1} ${b} ${y} ${z2} minecraft:air`);
    }
    cmds.push(`kill @e[type=!minecraft:player,x=${x1},y=${r.g - 4},z=${z1},dx=${x2 - x1},dy=${height + 8},dz=${z2 - z1}]`);
    const out = await commands(cmds, 60000);
    const notLoaded = out.flat().filter((l) => /not loaded|Cannot place blocks outside/.test(l));
    if (notLoaded.length) throw new Error('region not loaded: ' + notLoaded.slice(0, 2).join(' | '));
    return out;
}

export async function releaseRegion(r, height = 24) {
    const x1 = r.ox - r.radius, x2 = r.ox + r.radius, z1 = r.oz - r.radius, z2 = r.oz + r.radius;
    return commands([
        `kill @e[type=!minecraft:player,x=${x1},y=${r.g - 4},z=${z1},dx=${x2 - x1},dy=${height + 8},dz=${z2 - z1}]`,
        `forceload remove ${x1} ${z1} ${x2} ${z2}`,
    ]);
}

// ------------------------------------------------------------------ house

// A house of 7 x 5 x 7 blocks with its north-west corner at (x, z):
//   floor of oak planks at g (in place of the grass), walls of oak planks from g+1 to g+3 with
//   corner posts of oak logs, a flat roof of oak planks at g+4, glass windows in the west, east
//   and south walls, an oak door in the middle of the north wall (lower block at g+1), a red bed
//   (foot at the north, head at the south) and a chest inside.
export function housePlan(x, z, g) {
    const box = { min: { x, y: g, z }, max: { x: x + 6, y: g + 4, z: z + 6 } };
    const door = { x: x + 3, y: g + 1, z };
    return {
        box,
        door,
        doorUpper: { x: x + 3, y: g + 2, z },
        outsideDoor: { x: x + 3, y: g + 1, z: z - 2 }, // 2 blocks in front of the door
        inside: { x: x + 3, y: g + 1, z: z + 3 }, // the middle of the room
        insideNearDoor: { x: x + 3, y: g + 1, z: z + 2 },
        interior: { min: { x: x + 1, y: g + 1, z: z + 1 }, max: { x: x + 5, y: g + 3, z: z + 5 } },
        bedFoot: { x: x + 1, y: g + 1, z: z + 4 },
        bedHead: { x: x + 1, y: g + 1, z: z + 5 },
        chest: { x: x + 5, y: g + 1, z: z + 5 },
        logs: [[x, z], [x + 6, z], [x, z + 6], [x + 6, z + 6]].flatMap(([a, c]) => [1, 2, 3].map((dy) => ({ x: a, y: g + dy, z: c }))),
        wallWest: { x, y: g + 2, z: z + 2 }, // a plank of the west wall
        wallSouth: { x: x + 2, y: g + 1, z: z + 6 },
        windows: [{ x, y: g + 2, z: z + 3 }, { x: x + 6, y: g + 2, z: z + 3 }, { x: x + 3, y: g + 2, z: z + 6 }],
    };
}

export async function buildHouse(h, { bed = true, chest = true, door = 'oak_door' } = {}) {
    const { min, max } = h.box;
    const g = min.y;
    const cmds = [
        `fill ${min.x} ${g} ${min.z} ${max.x} ${g} ${max.z} minecraft:oak_planks`,
        `fill ${min.x} ${g + 1} ${min.z} ${max.x} ${g + 3} ${max.z} minecraft:oak_planks`,
        `fill ${min.x + 1} ${g + 1} ${min.z + 1} ${max.x - 1} ${g + 3} ${max.z - 1} minecraft:air`,
        `fill ${min.x} ${g + 4} ${min.z} ${max.x} ${g + 4} ${max.z} minecraft:oak_planks`,
    ];
    for (const [a, c] of [[min.x, min.z], [max.x, min.z], [min.x, max.z], [max.x, max.z]]) {
        cmds.push(`fill ${a} ${g + 1} ${c} ${a} ${g + 3} ${c} minecraft:oak_log[axis=y]`);
    }
    for (const w of h.windows) cmds.push(`setblock ${P(w)} minecraft:glass`);
    cmds.push(`setblock ${P(h.door)} minecraft:air`, `setblock ${P(h.doorUpper)} minecraft:air`);
    if (door) {
        cmds.push(`setblock ${P(h.door)} minecraft:${door}[facing=south,half=lower,hinge=left,open=false]`);
        cmds.push(`setblock ${P(h.doorUpper)} minecraft:${door}[facing=south,half=upper,hinge=left,open=false]`);
    }
    if (bed) {
        cmds.push(`setblock ${P(h.bedFoot)} minecraft:red_bed[facing=south,part=foot]`);
        cmds.push(`setblock ${P(h.bedHead)} minecraft:red_bed[facing=south,part=head]`);
    }
    if (chest) cmds.push(`setblock ${P(h.chest)} minecraft:chest[facing=north]`);
    const out = await commands(cmds);
    const bad = out.flat().filter((l) => /Could not|not loaded|Incorrect|Unknown|Expected|Invalid/.test(l));
    if (bad.length) throw new Error('building the house failed: ' + bad.slice(0, 3).join(' | '));
    return out;
}

// ------------------------------------------------------------------ tree

// An oak tree: dirt at g, a trunk of `height` oak logs from g+1, leaves around the top.
export function treePlan(x, z, g, height = 5) {
    const logs = [];
    for (let i = 1; i <= height; i++) logs.push({ x, y: g + i, z });
    return { x, z, g, height, logs, base: { x, y: g, z } };
}

// options.natural: leaves as a tree grows them (persistent=false; they do not decay while the random
// tick speed is 0, which is the world default of the runner). Without it the leaves are placed ones.
export async function buildTree(t, { natural = false } = {}) {
    const top = t.g + t.height;
    const leaves = `minecraft:oak_leaves[persistent=${natural ? 'false' : 'true'}]`;
    const cmds = [
        `setblock ${t.x} ${t.g} ${t.z} minecraft:dirt`,
        `fill ${t.x - 2} ${top - 1} ${t.z - 2} ${t.x + 2} ${top} ${t.z + 2} ${leaves} replace minecraft:air`,
        `fill ${t.x - 1} ${top + 1} ${t.z - 1} ${t.x + 1} ${top + 2} ${t.z + 1} ${leaves} replace minecraft:air`,
        `fill ${t.x} ${t.g + 1} ${t.z} ${t.x} ${top} ${t.z} minecraft:oak_log[axis=y]`,
    ];
    return commands(cmds);
}

// The box of a tree of treePlan: trunk, crown and the ground block, for a snapshot or a scan.
export function treeBox(t) {
    return { min: { x: t.x - 2, y: t.g, z: t.z - 2 }, max: { x: t.x + 2, y: t.g + t.height + 2, z: t.z + 2 } };
}

// A house of logs (v0.1.4.7 "Trees"): walls of oak logs 3 high around a floor of 5 x 5 with its
// north-west corner at (x, z), an opening for a door in the north wall, a roof of oak planks at g+4
// and oak leaves on the roof (natural ones, as leaves that hang over a roof). No tree anywhere.
export function logHousePlan(x, z, g) {
    return {
        box: { min: { x, y: g, z }, max: { x: x + 4, y: g + 5, z: z + 4 } },
        door: { x: x + 2, y: g + 1, z },
        inside: { x: x + 2, y: g + 1, z: z + 2 },
        roofLeaves: { min: { x, y: g + 5, z }, max: { x: x + 4, y: g + 5, z: z + 4 } },
    };
}

export async function buildLogHouse(h) {
    const { min, max } = h.box;
    const g = min.y;
    const out = await commands([
        `fill ${min.x} ${g} ${min.z} ${max.x} ${g} ${max.z} minecraft:oak_planks`,
        `fill ${min.x} ${g + 1} ${min.z} ${max.x} ${g + 3} ${max.z} minecraft:oak_log[axis=y]`,
        `fill ${min.x + 1} ${g + 1} ${min.z + 1} ${max.x - 1} ${g + 3} ${max.z - 1} minecraft:air`,
        `fill ${h.door.x} ${g + 1} ${h.door.z} ${h.door.x} ${g + 2} ${h.door.z} minecraft:air`,
        `fill ${min.x} ${g + 4} ${min.z} ${max.x} ${g + 4} ${max.z} minecraft:oak_planks`,
        `fill ${min.x} ${g + 5} ${min.z} ${max.x} ${g + 5} ${max.z} minecraft:oak_leaves[persistent=false]`,
    ]);
    const bad = out.flat().filter((l) => /Could not|not loaded|Incorrect|Unknown|Expected|Invalid/.test(l));
    if (bad.length) throw new Error('building the log house failed: ' + bad.slice(0, 3).join(' | '));
    return out;
}

// ------------------------------------------------------------------ fenced field

// A field of 9 x 9 blocks with its north-west corner at (x, z): an oak fence around it at g+1 with
// an oak fence gate in the middle of the north side, farmland at g inside with a water source in
// the middle, ripe wheat (age 7) on the second row from the north, young wheat (age 2) on the
// second row from the south, the other farmland empty.
export function farmPlan(x, z, g) {
    const ripe = [], young = [], empty = [];
    for (let i = 1; i <= 7; i++) {
        ripe.push({ x: x + i, y: g + 1, z: z + 2 });
        young.push({ x: x + i, y: g + 1, z: z + 6 });
        if (i !== 4) empty.push({ x: x + i, y: g, z: z + 4 }); // farmland without a crop (the ground block)
    }
    return {
        box: { min: { x, y: g, z }, max: { x: x + 8, y: g + 1, z: z + 8 } },
        gate: { x: x + 4, y: g + 1, z },
        water: { x: x + 4, y: g, z: z + 4 },
        fence: { x, y: g + 1, z: z + 3 }, // a fence post of the west side
        inside: { x: x + 3, y: g + 1, z: z + 4 }, // a standing place inside (on farmland)
        outsideGate: { x: x + 4, y: g + 1, z: z - 3 },
        ripe, young, empty,
    };
}

export async function buildFarm(f, { gate = true, crops = true } = {}) {
    const { min, max } = f.box;
    const g = min.y;
    const cmds = [
        `fill ${min.x} ${g + 1} ${min.z} ${max.x} ${g + 1} ${max.z} minecraft:oak_fence`,
        `fill ${min.x + 1} ${g + 1} ${min.z + 1} ${max.x - 1} ${g + 1} ${max.z - 1} minecraft:air`,
    ];
    if (crops) {
        cmds.push(`fill ${min.x + 1} ${g} ${min.z + 1} ${max.x - 1} ${g} ${max.z - 1} minecraft:farmland[moisture=7]`);
        cmds.push(`setblock ${P(f.water)} minecraft:water`);
    }
    if (gate) cmds.push(`setblock ${P(f.gate)} minecraft:oak_fence_gate[facing=south,open=false]`);
    if (crops) for (const p of f.ripe) cmds.push(`setblock ${P(p)} minecraft:wheat[age=7]`);
    if (crops) for (const p of f.young) cmds.push(`setblock ${P(p)} minecraft:wheat[age=2]`);
    return commands(cmds);
}

// A fenced field with chosen cells (v0.1.4.7, part F). size x size blocks with the north-west corner
// at (x, z): an oak fence at g+1 around it with an oak fence gate in the middle of the north side, a
// water source in the middle of the ground, and every other inner cell as `cell(i, j)` says, i and j
// from 1 to size - 2 (i to the east, j to the south):
//   { ground: 'farmland' | 'grass_block' | 'dirt' | 'coarse_dirt', crop?: 'wheat', age?: 0..7 }
// Returns { box, gate, water, fence, outsideGate, inside, cells, fenceRing } where every cell is
// { i, j, ground, above, spec } (ground: the position of the ground block, above: the block over it).
export function fieldPlan(x, z, g, cell, size = 9) {
    const mid = Math.floor(size / 2);
    const cells = [];
    for (let j = 1; j <= size - 2; j++) {
        for (let i = 1; i <= size - 2; i++) {
            if (i === mid && j === mid) continue;
            cells.push({ i, j, ground: { x: x + i, y: g, z: z + j }, above: { x: x + i, y: g + 1, z: z + j }, spec: { ground: 'farmland', ...cell(i, j) } });
        }
    }
    const fenceRing = [];
    for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
            if (i === 0 || j === 0 || i === size - 1 || j === size - 1) fenceRing.push({ x: x + i, y: g + 1, z: z + j });
        }
    }
    return {
        box: { min: { x, y: g, z }, max: { x: x + size - 1, y: g + 1, z: z + size - 1 } },
        gate: { x: x + mid, y: g + 1, z },
        water: { x: x + mid, y: g, z: z + mid },
        fence: { x, y: g + 1, z: z + mid },
        outsideGate: { x: x + mid, y: g + 1, z: z - 3 },
        inside: { x: x + mid - 1, y: g + 1, z: z + mid },
        cells, fenceRing,
    };
}

// options.fence false: the same cells without the fence and the gate (an open field).
export async function buildField(f, { fence = true } = {}) {
    const { min, max } = f.box;
    const g = min.y;
    const cmds = [
        `fill ${min.x} ${g - 1} ${min.z} ${max.x} ${g - 1} ${max.z} minecraft:dirt`,
        `fill ${min.x} ${g} ${min.z} ${max.x} ${g} ${max.z} minecraft:grass_block`,
        `fill ${min.x} ${g + 1} ${min.z} ${max.x} ${g + 1} ${max.z} minecraft:${fence ? 'oak_fence' : 'air'}`,
        `fill ${min.x + 1} ${g + 1} ${min.z + 1} ${max.x - 1} ${g + 1} ${max.z - 1} minecraft:air`,
        `setblock ${P(f.water)} minecraft:water`,
    ];
    if (fence) cmds.push(`setblock ${P(f.gate)} minecraft:oak_fence_gate[facing=south,open=false]`);
    for (const c of f.cells) {
        const ground = c.spec.ground === 'farmland' ? 'minecraft:farmland[moisture=7]' : MC(c.spec.ground);
        cmds.push(`setblock ${P(c.ground)} ${ground}`);
        if (c.spec.crop) cmds.push(`setblock ${P(c.above)} ${MC(c.spec.crop)}[age=${c.spec.age ?? 0}]`);
    }
    const out = await commands(cmds);
    // "Could not set the block": the block is there already (grass on grass)
    const bad = out.flat().filter((l) => /not loaded|Incorrect|Unknown|Expected|Invalid/.test(l));
    if (bad.length) throw new Error('building the field failed: ' + bad.slice(0, 3).join(' | '));
    return out;
}

// ------------------------------------------------------------------ containers (v0.1.4.7, part S)

const ONE_PER_STACK = /_(pickaxe|axe|shovel|hoe|sword|helmet|chestplate|leggings|boots)$|^(bow|shield|crossbow|shears|water_bucket|lava_bucket|bucket|.*_bed)$/;
export const stackSize = (name) => (ONE_PER_STACK.test(name) ? 1 : 64);

// Splits { name: count } or [[name, count], ...] into stacks: a list of [name, count].
export function stacksOf(items) {
    const list = Array.isArray(items) ? items : Object.entries(items);
    const out = [];
    for (const [name, count] of list) {
        for (let left = count; left > 0; left -= stackSize(name)) out.push([name, Math.min(left, stackSize(name))]);
    }
    return out;
}

// A chest (single, facing north) or a barrel at p with the items in its first slots. A chest needs
// air above it to open (a fact of the game); the caller keeps that block free.
export async function buildChest(p, items = {}, { kind = 'chest', facing = 'north' } = {}) {
    const block = kind === 'barrel' ? 'minecraft:barrel[facing=up]' : `minecraft:${kind}[facing=${facing},type=single]`;
    const stacks = stacksOf(items);
    if (stacks.length > 27) throw new Error(`a chest has 27 slots, not ${stacks.length}`);
    const cmds = [`setblock ${P(p)} minecraft:air`, `setblock ${P(p)} ${block}`];
    stacks.forEach(([name, count], slot) => cmds.push(`item replace block ${P(p)} container.${slot} with ${MC(name)} ${count}`));
    const out = await commands(cmds);
    // the first command may answer "Could not set the block" when the block was air already
    const bad = out.slice(1).flat().filter((l) => /Could not|not loaded|Incorrect|Unknown|Expected|Invalid|is not a container/.test(l));
    if (bad.length) throw new Error('building the chest failed: ' + bad.slice(0, 3).join(' | '));
    return out;
}

// A chest whose 27 slots are all full (64 of `name` in each), or `free` slots left empty.
export async function buildFullChest(p, name = 'stone', { free = 0 } = {}) {
    return buildChest(p, [[name, 64 * (27 - free)]]);
}

// A composter at p, empty unless `level` is given (0 to 8).
export async function buildComposter(p, level = 0) {
    return commands([`setblock ${P(p)} minecraft:composter[level=${level}]`]);
}

// The level of a composter (0 to 8), or null when there is none.
export async function composterLevel(p) {
    const out = await commands([0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => `execute if block ${P(p)} minecraft:composter[level=${n}]`));
    const i = out.findIndex(passed);
    return i >= 0 ? i : null;
}

// The items of an SNBT list as the server prints it: [{Slot: 0b, id: "minecraft:bread", count: 5}, ...]
// (components of a tool may be nested in braces). Returns [{ slot, name, count }].
// With open '{' it reads the items of a compound instead: {head: {count: 1, id: "..."}, offhand: {...}}
// (the equipment of a player since 1.21.5: armour and the off hand are no longer in Inventory).
export function parseItemList(text, open = '[') {
    const close = open === '[' ? ']' : '}';
    const start = text.indexOf(open);
    if (start < 0) return [];
    const objects = [];
    let depth = 0, from = -1, quote = false;
    for (let i = start + 1; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"' && text[i - 1] !== '\\') quote = !quote;
        if (quote) continue;
        if (ch === '{') { if (depth === 0) from = i; depth++; }
        else if (ch === '}' && depth > 0) { depth--; if (depth === 0 && from >= 0) { objects.push(text.slice(from, i + 1)); from = -1; } }
        else if (ch === close && depth === 0) break;
    }
    return objects.map((o) => {
        const top = o.replace(/components: \{.*\}(?=[,}])/s, '');
        const id = /id: "(?:minecraft:)?([\w.-]+)"/.exec(top)?.[1] ?? /id: "(?:minecraft:)?([\w.-]+)"/.exec(o)?.[1] ?? null;
        const count = Number(/count: (\d+)/.exec(top)?.[1] ?? 1);
        const slot = Number(/Slot: (-?\d+)b/.exec(top)?.[1] ?? NaN);
        return { slot, name: id, count };
    }).filter((x) => x.name);
}

// { name: count } of a list of { name, count }.
export function countsOf(list) {
    const out = {};
    for (const { name, count } of list) out[name] = (out[name] || 0) + count;
    return out;
}

// The items of a container at p from the server: { name: count } ({} when empty), or null when the
// block is no container.
export async function chestItems(p) {
    const out = await command(`data get block ${P(p)} Items`);
    const line = out.find((l) => /has the following block data: /.test(l));
    if (line) return countsOf(parseItemList(line.slice(line.indexOf('block data: ') + 12)));
    if (out.some((l) => /Found no elements matching Items/.test(l))) return {};
    return null;
}

// The number of free slots of a chest at p (27 slots).
export async function chestFreeSlots(p) {
    const out = await command(`data get block ${P(p)} Items`);
    const line = out.find((l) => /has the following block data: /.test(l));
    return line ? 27 - parseItemList(line.slice(line.indexOf('block data: ') + 12)).length : 27;
}

// ------------------------------------------------------------------ inventory of a player

// The inventory of a player from the server, with armour and the off hand: { name: count }.
export async function inventoryOf(name) {
    const out = await commands([`data get entity ${name} Inventory`, `data get entity ${name} equipment`]);
    const at = (lines) => lines.find((l) => /has the following entity data: /.test(l));
    const main = at(out[0]);
    const worn = at(out[1]);
    const list = main ? parseItemList(main.slice(main.indexOf('entity data: ') + 13)) : [];
    if (worn) list.push(...parseItemList(worn.slice(worn.indexOf('entity data: ') + 13), '{'));
    return countsOf(list);
}

// The inventory once it did not change for `still` ms (right after crafting or picking up, counts can
// be wrong for a moment). Resolves with { items, stable }.
export async function stableInventory(name, { ms = 8000, still = 500 } = {}) {
    const t0 = Date.now();
    let last = JSON.stringify(await inventoryOf(name));
    let since = Date.now();
    for (;;) {
        await new Promise((r) => setTimeout(r, 150));
        const now = JSON.stringify(await inventoryOf(name));
        if (now !== last) { last = now; since = Date.now(); }
        if (Date.now() - since >= still) return { items: JSON.parse(last), stable: true };
        if (Date.now() - t0 >= ms) return { items: JSON.parse(last), stable: false };
    }
}

// Items that lie on the ground in a box (item entities, drops not picked up): [{ name, count, pos }].
export async function itemsOnGround(box) {
    const sel = `@e[type=minecraft:item,x=${box.min.x},y=${box.min.y},z=${box.min.z},dx=${box.max.x - box.min.x},dy=${box.max.y - box.min.y},dz=${box.max.z - box.min.z}]`;
    const out = await commands([`execute as ${sel} run data get entity @s Item`, `execute as ${sel} run data get entity @s Pos`]);
    const items = out[0].filter((l) => /has the following entity data: \{/.test(l)).map((l) => parseItemList(`[${l.slice(l.indexOf('entity data: ') + 13)}]`)[0]);
    const pos = out[1].filter((l) => /has the following entity data: \[/.test(l)).map((l) => {
        const n = l.slice(l.indexOf('[')).match(/-?\d+(?:\.\d+)?/g).map(Number);
        return { x: n[0], y: n[1], z: n[2] };
    });
    return items.map((it, i) => ({ name: it?.name, count: it?.count, pos: pos[i] ?? null }));
}

// Items as a short text for notes: "12 wheat, 3 wheat_seeds".
export function itemsText(items) {
    const e = Object.entries(items || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    return e.length ? e.map(([n, c]) => `${c} ${n}`).join(', ') : '(nothing)';
}

// ------------------------------------------------------------------ crops

// The age of a crop at p (0 to maxAge), or null when the block is not that crop.
export async function cropAge(p, crop = 'wheat', maxAge = 7) {
    return (await cropAges([p], crop, maxAge))[0];
}

// The ages of the crops at many positions, in one batch of commands: a list of numbers or null.
export async function cropAges(list, crop = 'wheat', maxAge = 7) {
    const cmds = [];
    for (const p of list) for (let a = 0; a <= maxAge; a++) cmds.push(`execute if block ${P(p)} ${MC(crop)}[age=${a}]`);
    const out = await commands(cmds, 60000);
    return list.map((p, k) => {
        for (let a = 0; a <= maxAge; a++) if (passed(out[k * (maxAge + 1) + a])) return a;
        return null;
    });
}

// ------------------------------------------------------------------ reading many blocks

// Which of `names` each position holds, in one batch: a list of a name or null (none of them).
// Names may carry states: 'wheat[age=7]'.
export async function blockNames(list, names) {
    const cmds = [];
    for (const p of list) for (const n of names) cmds.push(`execute if block ${P(p)} ${MC(n)}`);
    const out = await commands(cmds, 120000);
    return list.map((p, k) => {
        for (let i = 0; i < names.length; i++) if (passed(out[k * names.length + i])) return names[i];
        return null;
    });
}

// Every position of a box, x then y then z.
export function boxPositions(box) {
    const out = [];
    for (let x = box.min.x; x <= box.max.x; x++) {
        for (let y = box.min.y; y <= box.max.y; y++) {
            for (let z = box.min.z; z <= box.max.z; z++) out.push({ x, y, z });
        }
    }
    return out;
}

// The positions of a box that hold one of `names`: [{ pos, name }].
export async function findBlocks(box, names) {
    const list = boxPositions(box);
    const got = await blockNames(list, names);
    return list.map((pos, i) => ({ pos, name: got[i] })).filter((x) => x.name);
}

// ------------------------------------------------------------------ underground (v0.1.4.7, part M)

// Directions of the mine store and the unit steps of them.
export const DIRS = { north: { x: 0, z: -1 }, south: { x: 0, z: 1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 } };
export const rightOf = (d) => ({ north: 'east', east: 'south', south: 'west', west: 'north' }[d]);
export const leftOf = (d) => ({ north: 'west', west: 'south', south: 'east', east: 'north' }[d]);
export const add = (p, d, n = 1, dy = 0) => ({ x: p.x + DIRS[d].x * n, y: p.y + dy, z: p.z + DIRS[d].z * n });

// A shaft of 1 by 1 from the ground block at `top` (x, g, z) down `depth` blocks: the blocks from
// y g - depth + 1 to g are air, the floor is the block at g - depth. With ladders, every air block of
// the shaft holds a ladder on the wall at the `wall` side (the ladder faces the other way). Returns
// { column, top, bottom (where a bot stands at the bottom), ladders: [positions], wall }.
export async function digShaft(top, depth, { ladders = true, wall = 'south' } = {}) {
    const face = { south: 'north', north: 'south', east: 'west', west: 'east' }[wall];
    const cmds = [`fill ${top.x} ${top.y - depth + 1} ${top.z} ${top.x} ${top.y} ${top.z} minecraft:air`];
    const list = [];
    if (ladders) {
        for (let y = top.y - depth + 1; y <= top.y; y++) list.push({ x: top.x, y, z: top.z });
        const back = add({ x: top.x, y: 0, z: top.z }, wall);
        cmds.push(`fill ${back.x} ${top.y - depth + 1} ${back.z} ${back.x} ${top.y} ${back.z} minecraft:stone replace minecraft:air`);
        cmds.push(`fill ${top.x} ${top.y - depth + 1} ${top.z} ${top.x} ${top.y} ${top.z} minecraft:ladder[facing=${face}]`);
    }
    const out = await commands(cmds);
    const bad = out.flat().filter((l) => /Could not|not loaded|Incorrect|Unknown|Expected|Invalid|Too many/.test(l));
    if (bad.length) throw new Error('digging the shaft failed: ' + bad.slice(0, 3).join(' | '));
    return { column: { x: top.x, z: top.z }, top, bottom: { x: top.x, y: top.y - depth + 1, z: top.z }, ladders: list, wall };
}

// Air in a box (a room, a cave). Returns the box.
export async function carve(box, block = 'air') {
    const out = await commands([`fill ${P(box.min)} ${P(box.max)} ${MC(block)}`]);
    const bad = out.flat().filter((l) => /Could not|not loaded|Incorrect|Unknown|Expected|Invalid|Too many/.test(l));
    if (bad.length) throw new Error(`fill ${block} failed: ` + bad.slice(0, 3).join(' | '));
    return box;
}

// A vein: ore blocks at the positions (one vein when they touch). Returns the positions.
export async function placeVein(list, ore = 'iron_ore') {
    await commands(list.map((p) => `setblock ${P(p)} ${MC(ore)}`));
    return list;
}

// A vein of `n` ore blocks that starts beside a line at `start` and goes away from it in direction
// `away` and down: the first block touches the line, the others touch the one before with a face.
export function veinBeside(start, away, n = 5) {
    const out = [start];
    const steps = [[away, 1, 0], [null, 0, -1], [away, 1, 0], [null, 0, 1], [away, 1, 0], [null, 0, -1]];
    let p = start;
    for (let i = 0; out.length < n; i++) {
        const [d, k, dy] = steps[i % steps.length];
        p = d ? add(p, d, k, dy) : { ...p, y: p.y + dy };
        out.push(p);
    }
    return out;
}

// A source of lava at p, with stone around it where there is air, so it stays a pocket.
export async function lavaPocket(p) {
    const cmds = [];
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        cmds.push(`setblock ${p.x + dx} ${p.y + dy} ${p.z + dz} minecraft:stone keep`);
    }
    cmds.push(`setblock ${P(p)} minecraft:lava`);
    return commands(cmds);
}

// The box of a cave of w x h x d blocks whose middle top block is at `topMiddle`.
export function caveBox(topMiddle, w = 3, h = 3, d = 3) {
    const hw = Math.floor(w / 2), hd = Math.floor(d / 2);
    return { min: { x: topMiddle.x - hw, y: topMiddle.y - h + 1, z: topMiddle.z - hd }, max: { x: topMiddle.x - hw + w - 1, y: topMiddle.y, z: topMiddle.z - hd + d - 1 } };
}

// ------------------------------------------------------------------ reading blocks

export async function blockIs(p, name) {
    return passed(await command(`execute if block ${P(p)} ${MC(name)}`));
}

// Door or gate state from the server: true (open), false (closed) or null (no such block).
export async function isOpen(p, name = 'oak_door') {
    const out = await commands([`execute if block ${P(p)} ${MC(name)}[open=true]`, `execute if block ${P(p)} ${MC(name)}[open=false]`]);
    if (passed(out[0])) return true;
    if (passed(out[1])) return false;
    return null;
}

// Sets an oak door (both halves, facing south, hinge left) or a fence gate open or closed.
export async function setOpen(p, open, kind = 'oak_door') {
    if (kind.endsWith('_door')) {
        return commands([
            `setblock ${P(p)} minecraft:${kind}[facing=south,half=lower,hinge=left,open=${open}]`,
            `setblock ${p.x} ${p.y + 1} ${p.z} minecraft:${kind}[facing=south,half=upper,hinge=left,open=${open}]`,
        ]);
    }
    return commands([`setblock ${P(p)} minecraft:${kind}[facing=south,open=${open}]`]);
}

// Snapshots (v0.1.4.8): a copy of a box lies 100 blocks and more south of it, at the same height, not above it.
// Since v0.1.4.8 the bot reads the ground of the columns around it from the top of the world down (spec I2,
// ground_logic.js); copies of natural blocks high above the region (y 280, the place of v0.1.4.7) were taken
// for the ground there and made the bot "underground" on the surface (seen in w28 and W54: "I am underground.
// I start a new mine only from the surface."). The chunks of a copy are force-loaded while it lives
// (dropSnapshot releases them); the names of changed blocks are read from the server, since the bot does not
// see that far. Up to SNAP_SLOTS snapshots of one scenario lie side by side (each SNAP_STEP further south).
const SNAP_DZ = 100;
const SNAP_STEP = 48;
const SNAP_SLOTS = 3;
let snapSlot = 0;

// Names that a changed block of a snapshot may have; the first that the server confirms is reported.
const SNAPSHOT_NAMES = ['air', 'cave_air', 'oak_planks', 'oak_log', 'glass', 'oak_door', 'red_bed', 'chest', 'torch', 'wall_torch',
    'ladder', 'oak_trapdoor', 'oak_fence', 'oak_fence_gate', 'crafting_table', 'composter', 'farmland', 'dirt', 'grass_block',
    'stone', 'cobblestone', 'water', 'lava', 'wheat', 'oak_leaves', 'oak_sapling', 'coal_ore', 'iron_ore', 'bedrock', 'short_grass',
    'gravel', 'deepslate', 'dirt_path', 'coarse_dirt', 'furnace', 'gold_ore'];

// The first name of SNAPSHOT_NAMES that the block at p has (states left out), or null.
async function nameOnServer(p) {
    const got = await blockNames([p], SNAPSHOT_NAMES);
    return got[0];
}

// Takes a snapshot of a box: the server clones it to a place SNAP_DZ (+ SNAP_STEP per slot) blocks south of
// the box, at the same height, with its chunks force-loaded. options.slot chooses the place; without it the
// slots are used in turn. The option `y` of v0.1.4.7 (a second snapshot over the same columns) is not needed
// any more and is ignored. Returns { box, at, forceload } for compareSnapshot and dropSnapshot.
export async function snapshotBox(box, { slot = null } = {}) {
    const k = Number.isInteger(slot) ? slot : (snapSlot++ % SNAP_SLOTS);
    const at = { x: box.min.x, y: box.min.y, z: box.max.z + SNAP_DZ + k * SNAP_STEP };
    const far = { x: at.x + box.max.x - box.min.x, y: at.y + box.max.y - box.min.y, z: at.z + box.max.z - box.min.z };
    const forceload = `${at.x} ${at.z} ${far.x} ${far.z}`;
    await command(`forceload add ${forceload}`);
    const loaded = async () => passed(await command(`execute if loaded ${P(at)}`)) && passed(await command(`execute if loaded ${P(far)}`));
    const t0 = Date.now();
    while (!(await loaded())) {
        if (Date.now() - t0 > 20000) throw new Error(`snapshot: the chunks at ${P(at)} did not load within 20 s`);
        await new Promise((r) => setTimeout(r, 100));
    }
    const out = await command(`clone ${P(box.min)} ${P(box.max)} ${P(at)} replace force`);
    if (!out.some((l) => /Successfully cloned/.test(l))) throw new Error('snapshot failed: ' + out.join(' | '));
    return { box, at, forceload, count: (box.max.x - box.min.x + 1) * (box.max.y - box.min.y + 1) * (box.max.z - box.min.z + 1) };
}

// Compares the box with its snapshot on the server. Returns { same, differences } where every
// difference is { pos, now, was, stateOnly } (names read from the server, see SNAPSHOT_NAMES; `viewBot` is
// no longer needed and is ignored). `same` counts only changed block names: a door that was opened and closed
// again is the same; one that is still open is a state difference (stateOnly true).
export async function compareSnapshot(snap, viewBot = null) {
    void viewBot;
    const { box, at } = snap;
    const whole = await command(`execute if blocks ${P(box.min)} ${P(box.max)} ${P(at)} all`);
    if (passed(whole)) return { same: true, identical: true, differences: [] };
    const positions = [];
    for (let x = box.min.x; x <= box.max.x; x++) {
        for (let y = box.min.y; y <= box.max.y; y++) {
            for (let z = box.min.z; z <= box.max.z; z++) positions.push({ x, y, z });
        }
    }
    const back = (p) => ({ x: at.x + p.x - box.min.x, y: at.y + p.y - box.min.y, z: at.z + p.z - box.min.z });
    const out = await commands(positions.map((p) => `execute if blocks ${P(p)} ${P(p)} ${P(back(p))} all`), 60000);
    const differing = positions.filter((p, i) => !passed(out[i]));
    const differences = [];
    for (const p of differing.slice(0, 200)) {
        const now = await nameOnServer(p);
        const was = await nameOnServer(back(p));
        const stateOnly = Boolean(was) && now === was;
        differences.push({ pos: p, now, was, stateOnly });
    }
    for (const p of differing.slice(200)) differences.push({ pos: p, now: null, was: null, stateOnly: false });
    return { same: differences.every((d) => d.stateOnly), identical: false, differences };
}

export function describeDifferences(diffs, max = 12) {
    if (!diffs.length) return 'no differences';
    return diffs.slice(0, max).map((d) => `(${d.pos.x}, ${d.pos.y}, ${d.pos.z}) ${d.was ?? '?'} -> ${d.now ?? '?'}${d.stateOnly ? ' (state only)' : ''}`).join('; ')
        + (diffs.length > max ? `; and ${diffs.length - max} more` : '');
}

// Removes the snapshot copy and releases its chunks.
export async function dropSnapshot(snap) {
    const { box, at } = snap;
    const max = { x: at.x + box.max.x - box.min.x, y: at.y + box.max.y - box.min.y, z: at.z + box.max.z - box.min.z };
    const out = await command(`fill ${P(at)} ${P(max)} minecraft:air`);
    if (snap.forceload) await command(`forceload remove ${snap.forceload}`);
    return out;
}

// ------------------------------------------------------------------ entities through the console

const NUM = /-?\d+(?:\.\d+)?(?:E-?\d+)?/gi;

// Position of an entity (a player name or a selector) from the server: {x,y,z} or null.
export async function entityPos(target) {
    const out = await command(`data get entity ${target} Pos`);
    const line = out.find((l) => /has the following entity data: \[/.test(l));
    if (!line) return null;
    const nums = line.slice(line.indexOf('[')).match(NUM).map(Number);
    return nums.length >= 3 ? { x: nums[0], y: nums[1], z: nums[2] } : null;
}

// A number stored in an entity (Health, foodLevel, ...) or null.
export async function entityNumber(target, pathName) {
    const out = await command(`data get entity ${target} ${pathName}`);
    const line = out.find((l) => /has the following entity data: /.test(l));
    if (!line) return null;
    const m = /has the following entity data: (-?[\d.]+)/.exec(line);
    return m ? Number(m[1]) : null;
}

// Several positions in one batch: { name: {x,y,z} | null }.
export async function positions(targets) {
    const out = await commands(targets.map((t) => `data get entity ${t} Pos`));
    const res = {};
    targets.forEach((t, i) => {
        const line = out[i].find((l) => /has the following entity data: \[/.test(l));
        const nums = line ? line.slice(line.indexOf('[')).match(NUM).map(Number) : [];
        res[t] = nums.length >= 3 ? { x: nums[0], y: nums[1], z: nums[2] } : null;
    });
    return res;
}

export const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : Infinity);
export const hdist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.z - b.z) : Infinity);

// Distance from a position to the nearest point of a box (blocks, both ends included).
export function distToBox(p, box) {
    if (!p) return Infinity;
    const dx = Math.max(box.min.x - p.x, 0, p.x - (box.max.x + 1));
    const dy = Math.max(box.min.y - p.y, 0, p.y - (box.max.y + 1));
    const dz = Math.max(box.min.z - p.z, 0, p.z - (box.max.z + 1));
    return Math.hypot(dx, dy, dz);
}

export function inBox(p, box) {
    return Boolean(p) && Math.floor(p.x) >= box.min.x && Math.floor(p.x) <= box.max.x
        && Math.floor(p.y) >= box.min.y && Math.floor(p.y) <= box.max.y
        && Math.floor(p.z) >= box.min.z && Math.floor(p.z) <= box.max.z;
}

export const fmt = (p) => (p ? `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})` : '(none)');

// Teleports a player (or selector) to the middle of a block, looking in a direction.
export async function tp(target, p, yaw = 0, pitch = 0) {
    return command(`tp ${target} ${p.x + 0.5} ${p.y} ${p.z + 0.5} ${yaw} ${pitch}`);
}
