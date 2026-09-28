// Building and reading the world through the server console: the region of a scenario, a house,
// a tree, a fenced field, and snapshots of a box of blocks that prove a building is untouched.
//
// Coordinates: the region of a scenario has its origin at (env.ox, env.oz). `g` is the y of the
// top block of the flat ground (grass); a bot standing on the ground has its feet at g + 1.
import { Vec3 } from 'vec3';
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

export async function buildTree(t) {
    const top = t.g + t.height;
    const cmds = [
        `setblock ${t.x} ${t.g} ${t.z} minecraft:dirt`,
        `fill ${t.x - 2} ${top - 1} ${t.z - 2} ${t.x + 2} ${top} ${t.z + 2} minecraft:oak_leaves[persistent=true] replace minecraft:air`,
        `fill ${t.x - 1} ${top + 1} ${t.z - 1} ${t.x + 1} ${top + 2} ${t.z + 1} minecraft:oak_leaves[persistent=true] replace minecraft:air`,
        `fill ${t.x} ${t.g + 1} ${t.z} ${t.x} ${top} ${t.z} minecraft:oak_log[axis=y]`,
    ];
    return commands(cmds);
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

const BACKUP_Y = 280; // snapshots are cloned high above the region, out of reach of every search

// Takes a snapshot of a box: the server clones it to a place high above the same columns.
// Returns { box, at } for compareSnapshot.
export async function snapshotBox(box) {
    const at = { x: box.min.x, y: BACKUP_Y, z: box.min.z };
    const out = await command(`clone ${P(box.min)} ${P(box.max)} ${P(at)} replace force`);
    if (!out.some((l) => /Successfully cloned/.test(l))) throw new Error('snapshot failed: ' + out.join(' | '));
    return { box, at, count: (box.max.x - box.min.x + 1) * (box.max.y - box.min.y + 1) * (box.max.z - box.min.z + 1) };
}

// Compares the box with its snapshot on the server. Returns { same, differences } where every
// difference is { pos, now, was, stateOnly } (names read through `viewBot`, a mineflayer bot near
// the box, when one is given). `same` counts only changed block names: a door that was opened and
// closed again is the same; one that is still open is a state difference (stateOnly true).
export async function compareSnapshot(snap, viewBot = null) {
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
    // names: the server can test a name without its states; the names come from the view of the bot
    const differences = [];
    for (const p of differing) {
        const b = back(p);
        let now = null, was = null;
        if (viewBot) {
            try { now = viewBot.blockAt(new Vec3(p.x, p.y, p.z))?.name ?? null; } catch { /* not loaded */ }
            try { was = viewBot.blockAt(new Vec3(b.x, b.y, b.z))?.name ?? null; } catch { /* not loaded */ }
        }
        let stateOnly = false;
        if (was) stateOnly = await blockIs(p, was);
        differences.push({ pos: p, now, was, stateOnly });
    }
    return { same: differences.every((d) => d.stateOnly), identical: false, differences };
}

export function describeDifferences(diffs, max = 12) {
    if (!diffs.length) return 'no differences';
    return diffs.slice(0, max).map((d) => `(${d.pos.x}, ${d.pos.y}, ${d.pos.z}) ${d.was ?? '?'} -> ${d.now ?? '?'}${d.stateOnly ? ' (state only)' : ''}`).join('; ')
        + (diffs.length > max ? `; and ${diffs.length - max} more` : '');
}

// Removes the snapshot copy.
export async function dropSnapshot(snap) {
    const { box, at } = snap;
    const max = { x: at.x + box.max.x - box.min.x, y: at.y + box.max.y - box.min.y, z: at.z + box.max.z - box.min.z };
    return command(`fill ${P(at)} ${P(max)} minecraft:air`);
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
