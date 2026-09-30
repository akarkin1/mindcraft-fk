// The world type `base` of release v0.1.4.8 (spec section 12, T2.2): a base like the one of the owner, built
// with console commands in the region of a scenario. The server of the type `base` has the layers of the
// deep world (bedrock, stone up to y 56, dirt from 57 to 59, grass at y 60; see mc_server.js), so the base
// has real rock under it: a shaft, a room at y 41, a descent to y 25 and a tunnel, as the owner dug them.
//
// Every scenario of the type calls basePlan(r) for the coordinates and buildBase(plan) to build it in its
// own region; verifyBase(plan) reads the blocks back from the server. The offsets below are from the origin
// of the region (ox, oz); `g` is the y of the grass (60). x grows to the east, z to the south.
//
//   house   planks, 9 x 6 x 11 blocks (x -4..4, z -5..5, floor at g, roof at g+5), oak_log corner posts,
//           glass windows, an oak door in the middle of the north wall, a red bed, a chest with food and
//           leaf litter, two torches. Saved as the PLACE "home" only (saveHomePlace), never as an area.
//   shaft   an oak trapdoor in the floor of the house at (2, g, -2), closed; under it a shaft of 1 x 1 with
//           ladders on its north wall from y 59 down to the room (the ladders go on in the room to y 41).
//   room    at y 41 (air y 41..43, floor y 40), x 0..4, z -2..2, under the house: a chest and a crafting
//           table, a torch. The shaft opens into its north-east part.
//   descent from the east wall of the room: 16 steps of loose blocks (cobblestone under every step), each one
//           block down and one east, 3 high, from x 5 (feet y 40) to x 20 (feet y 25), along z = 0.
//   landing x 21..23, z -1..1, feet y 25, 3 high; a torch.
//   tunnel  1 wide and 2 high, 12 blocks long: x 22, z 2..13, feet y 25. Open grass above it (35 blocks of
//           rock between), away from the house.
//   farm    a fenced field of 9 x 9 (x -26..-18, z -4..4), oak fence with an oak gate in the middle of the
//           north side, water in the middle, farmland with wheat, a composter inside next to the gate, a
//           chest in the west fence line with a fence post on it (a post of the line replaced by the chest, the
//           fence goes on above it: the owner's build as finding C4 describes it, a fence above the chest).
//   pen     a pen of oak fence of 9 x 9 (x 8..16, z 4..12) with an oak gate in the middle of the north side,
//           grass inside, a cow and a chicken.
import { commands, env } from './control.js';
import {
    MC, passed, fieldPlan, buildField, buildChest, blockNames, chestItems, cropAges, positions, inBox, fmt,
} from './world.js';

const P = (p) => `${p.x} ${p.y} ${p.z}`;

// ------------------------------------------------------------------ the offsets (named constants)

export const BASE_GROUND_Y = 60; // the grass of the base world (the deep layers)
export const HOUSE = Object.freeze({ x0: -4, x1: 4, z0: -5, z1: 5, height: 5 }); // floor g, walls g+1..g+4, roof g+5
export const HOUSE_DOOR = Object.freeze({ dx: 0, dz: -5 }); // lower half at g+1, in the north wall
export const HOUSE_BED = Object.freeze({ dx: -3, dz: 3 }); // the foot; the head is one block south
export const HOUSE_CHEST = Object.freeze({ dx: 3, dz: 4 });
export const HOUSE_TORCHES = Object.freeze([{ dx: -3, dz: -4 }, { dx: 3, dz: -4 }]);
export const HOME_PLACE = Object.freeze({ dx: 0, dz: 1 }); // the place "home": the middle of the room, feet g+1
export const SHAFT = Object.freeze({ dx: 2, dz: -2 }); // the column of the trapdoor and the ladders
export const ROOM = Object.freeze({ y: 41, x0: 0, x1: 4, z0: -2, z1: 2, height: 3 });
export const ROOM_CHEST = Object.freeze({ dx: 0, dz: 2 });
export const ROOM_TABLE = Object.freeze({ dx: 4, dz: 2 });
export const ROOM_TORCH = Object.freeze({ dx: 4, dz: -2 });
export const DESCENT = Object.freeze({ steps: 16, z: 0 }); // step k (1..16) at x = ROOM.x1 + k, feet y ROOM.y - k
export const LANDING = Object.freeze({ y: 25, x0: 21, x1: 23, z0: -1, z1: 1, height: 3 });
export const LANDING_TORCH = Object.freeze({ dx: 23, dz: -1 });
export const TUNNEL = Object.freeze({ x: 22, z0: 2, length: 12, y: 25, height: 2 });
export const FARM = Object.freeze({ x: -26, z: -4, size: 9 }); // the north-west corner of the fence
export const FARM_COMPOSTER_CELL = Object.freeze({ i: 6, j: 1 }); // a cell of the field (i east, j south)
export const PEN = Object.freeze({ x: 8, z: 4, size: 9 });

// The items of the chests (the owner's house chest held food and 104 leaf litter).
export const HOUSE_CHEST_ITEMS = Object.freeze({ bread: 12, leaf_litter: 64 });
export const ROOM_CHEST_ITEMS = Object.freeze({ cobblestone: 64, torch: 16 });
export const FARM_CHEST_ITEMS = Object.freeze({ wheat: 4 });

// The wheat of the farm by default: the second row from the north is ripe, the rest young.
export const DEFAULT_CROPS = (i, j) => (j === 2 ? { crop: 'wheat', age: 7 } : { crop: 'wheat', age: 3 });

export const PEN_TAG = 'mcw_pen';

// ------------------------------------------------------------------ the plan

// The coordinates of every part in the region r of region() (absolute). `crops(i, j)` chooses the cells of
// the farm as fieldPlan does.
export function basePlan(r, { crops = DEFAULT_CROPS } = {}) {
    const ox = r.ox, oz = r.oz, g = r.g;
    const at = (d, y) => ({ x: ox + d.dx, y, z: oz + d.dz });
    const house = {
        box: { min: { x: ox + HOUSE.x0, y: g, z: oz + HOUSE.z0 }, max: { x: ox + HOUSE.x1, y: g + HOUSE.height, z: oz + HOUSE.z1 } },
        interior: { min: { x: ox + HOUSE.x0 + 1, y: g + 1, z: oz + HOUSE.z0 + 1 }, max: { x: ox + HOUSE.x1 - 1, y: g + HOUSE.height - 1, z: oz + HOUSE.z1 - 1 } },
        door: at(HOUSE_DOOR, g + 1),
        doorUpper: at(HOUSE_DOOR, g + 2),
        outsideDoor: { x: ox + HOUSE_DOOR.dx, y: g + 1, z: oz + HOUSE_DOOR.dz - 2 },
        insideNearDoor: { x: ox + HOUSE_DOOR.dx, y: g + 1, z: oz + HOUSE_DOOR.dz + 2 },
        home: at(HOME_PLACE, g + 1),
        bedFoot: at(HOUSE_BED, g + 1),
        bedHead: { x: ox + HOUSE_BED.dx, y: g + 1, z: oz + HOUSE_BED.dz + 1 },
        chest: at(HOUSE_CHEST, g + 1),
        torches: HOUSE_TORCHES.map((d) => at(d, g + 1)),
        posts: [[HOUSE.x0, HOUSE.z0], [HOUSE.x1, HOUSE.z0], [HOUSE.x0, HOUSE.z1], [HOUSE.x1, HOUSE.z1]]
            .flatMap(([a, c]) => [1, 2, 3, 4].map((dy) => ({ x: ox + a, y: g + dy, z: oz + c }))),
        windows: [{ x: ox + HOUSE.x0, y: g + 2, z: oz }, { x: ox + HOUSE.x1, y: g + 2, z: oz }, { x: ox, y: g + 2, z: oz + HOUSE.z1 }],
    };
    const trapdoor = at(SHAFT, g);
    const ladders = [];
    for (let y = ROOM.y; y <= g - 1; y++) ladders.push(at(SHAFT, y));
    const room = {
        box: { min: { x: ox + ROOM.x0, y: ROOM.y, z: oz + ROOM.z0 }, max: { x: ox + ROOM.x1, y: ROOM.y + ROOM.height - 1, z: oz + ROOM.z1 } },
        floorY: ROOM.y - 1,
        middle: { x: ox + 2, y: ROOM.y, z: oz + 1 },
        chest: at(ROOM_CHEST, ROOM.y),
        table: at(ROOM_TABLE, ROOM.y),
        torch: at(ROOM_TORCH, ROOM.y),
    };
    const steps = [];
    for (let k = 1; k <= DESCENT.steps; k++) {
        const x = ox + ROOM.x1 + k, feet = ROOM.y - k;
        steps.push({ k, feet: { x, y: feet, z: oz + DESCENT.z }, floor: { x, y: feet - 1, z: oz + DESCENT.z } });
    }
    const landing = {
        box: { min: { x: ox + LANDING.x0, y: LANDING.y, z: oz + LANDING.z0 }, max: { x: ox + LANDING.x1, y: LANDING.y + LANDING.height - 1, z: oz + LANDING.z1 } },
        middle: { x: ox + LANDING.x0 + 1, y: LANDING.y, z: oz + LANDING.z0 + 1 },
        torch: at(LANDING_TORCH, LANDING.y),
    };
    const tunnelCells = [];
    for (let k = 0; k < TUNNEL.length; k++) tunnelCells.push({ x: ox + TUNNEL.x, y: TUNNEL.y, z: oz + TUNNEL.z0 + k });
    const tunnel = {
        cells: tunnelCells, // the feet of each step of the tunnel, from the landing on
        start: tunnelCells[0],
        end: tunnelCells[tunnelCells.length - 1],
        box: { min: { x: ox + TUNNEL.x, y: TUNNEL.y, z: oz + TUNNEL.z0 }, max: { x: ox + TUNNEL.x, y: TUNNEL.y + TUNNEL.height - 1, z: oz + TUNNEL.z0 + TUNNEL.length - 1 } },
    };
    // the whole mine, for an area of type mine: shaft, room, descent, landing and tunnel
    const mineBox = {
        min: { x: ox + ROOM.x0, y: LANDING.y - 1, z: oz + Math.min(ROOM.z0, SHAFT.dz, LANDING.z0) },
        max: { x: ox + LANDING.x1, y: g - 1, z: oz + TUNNEL.z0 + TUNNEL.length - 1 },
    };
    const f = fieldPlan(ox + FARM.x, oz + FARM.z, g, (i, j) => (i === FARM_COMPOSTER_CELL.i && j === FARM_COMPOSTER_CELL.j ? { ground: 'dirt' } : crops(i, j)), FARM.size);
    const composterCell = f.cells.find((c) => c.i === FARM_COMPOSTER_CELL.i && c.j === FARM_COMPOSTER_CELL.j);
    const mid = Math.floor(FARM.size / 2);
    // in the west fence line, away from the house, with a fence post on it (buildFarm): a chest alone in the line
    // is a step out of the farm, 0.875 high, which the path search jumped over in W49; finding C4 of the play
    // test counted a fence above the owner's farm chest as solid, so the owner's chest had one
    const farmChest = { x: ox + FARM.x, y: g + 1, z: oz + FARM.z + mid };
    const farm = {
        ...f,
        composter: composterCell.above,
        chest: farmChest,
        // the fence ring as it stands: the gate, the chest, the posts
        ringBlock: (p) => (p.x === f.gate.x && p.z === f.gate.z ? 'oak_fence_gate' : p.x === farmChest.x && p.z === farmChest.z ? 'chest' : 'oak_fence'),
        crops: f.cells.filter((c) => c.spec.crop),
        outsideChest: { x: farmChest.x - 2, y: g + 1, z: farmChest.z },
    };
    const pmid = Math.floor(PEN.size / 2);
    const penRing = [];
    for (let i = 0; i < PEN.size; i++) {
        for (let j = 0; j < PEN.size; j++) {
            if (i === 0 || j === 0 || i === PEN.size - 1 || j === PEN.size - 1) penRing.push({ x: ox + PEN.x + i, y: g + 1, z: oz + PEN.z + j });
        }
    }
    const pen = {
        box: { min: { x: ox + PEN.x, y: g, z: oz + PEN.z }, max: { x: ox + PEN.x + PEN.size - 1, y: g + 2, z: oz + PEN.z + PEN.size - 1 } },
        inner: { min: { x: ox + PEN.x + 1, y: g, z: oz + PEN.z + 1 }, max: { x: ox + PEN.x + PEN.size - 2, y: g + 3, z: oz + PEN.z + PEN.size - 2 } },
        gate: { x: ox + PEN.x + pmid, y: g + 1, z: oz + PEN.z },
        outsideGate: { x: ox + PEN.x + pmid, y: g + 1, z: oz + PEN.z - 3 },
        inside: { x: ox + PEN.x + pmid - 2, y: g + 1, z: oz + PEN.z + pmid },
        ring: penRing,
        ringBlock: (p) => (p.x === ox + PEN.x + pmid && p.z === oz + PEN.z ? 'oak_fence_gate' : 'oak_fence'),
        cow: { x: ox + PEN.x + pmid + 2, y: g + 1, z: oz + PEN.z + pmid },
        chicken: { x: ox + PEN.x + pmid, y: g + 1, z: oz + PEN.z + pmid + 2 },
        tag: PEN_TAG,
    };
    return {
        ox, oz, g, house, trapdoor, shaft: { column: at(SHAFT, 0), ladders }, room, steps, landing, tunnel, mineBox, farm, pen,
        // everything the base covers, for a region radius and for the cleaning of entities
        extent: { min: { x: ox + FARM.x - 2, z: oz + HOUSE.z0 - 3 }, max: { x: ox + LANDING.x1 + 2, z: oz + TUNNEL.z0 + TUNNEL.length + 1 } },
    };
}

// The radius of a region that holds the base with room around it.
export const BASE_RADIUS = 40;

// ------------------------------------------------------------------ building

function failures(out, skipFirst = 0) {
    // "Could not set the block": the block is there already; the builders accept that answer
    return out.slice(skipFirst).flat().filter((l) => /not loaded|Incorrect|Unknown|Expected|Invalid|Too many|Cannot place/.test(l));
}

async function run(cmds, what) {
    const out = await commands(cmds, 60000);
    const bad = failures(out);
    if (bad.length) throw new Error(`building ${what} failed: ${bad.slice(0, 3).join(' | ')}`);
    return out;
}

export async function buildHouse(b) {
    const { min, max } = b.house.box;
    const g = min.y;
    const h = b.house;
    const cmds = [
        `fill ${min.x} ${g} ${min.z} ${max.x} ${g} ${max.z} minecraft:oak_planks`,
        `fill ${min.x} ${g + 1} ${min.z} ${max.x} ${g + 4} ${max.z} minecraft:oak_planks`,
        `fill ${min.x + 1} ${g + 1} ${min.z + 1} ${max.x - 1} ${g + 4} ${max.z - 1} minecraft:air`,
        `fill ${min.x} ${g + 5} ${min.z} ${max.x} ${g + 5} ${max.z} minecraft:oak_planks`,
    ];
    for (const [a, c] of [[min.x, min.z], [max.x, min.z], [min.x, max.z], [max.x, max.z]]) cmds.push(`fill ${a} ${g + 1} ${c} ${a} ${g + 4} ${c} minecraft:oak_log[axis=y]`);
    for (const w of h.windows) cmds.push(`setblock ${P(w)} minecraft:glass`);
    cmds.push(`setblock ${P(h.door)} minecraft:air`, `setblock ${P(h.doorUpper)} minecraft:air`);
    cmds.push(`setblock ${P(h.door)} minecraft:oak_door[facing=south,half=lower,hinge=left,open=false]`);
    cmds.push(`setblock ${P(h.doorUpper)} minecraft:oak_door[facing=south,half=upper,hinge=left,open=false]`);
    cmds.push(`setblock ${P(h.bedFoot)} minecraft:red_bed[facing=south,part=foot]`);
    cmds.push(`setblock ${P(h.bedHead)} minecraft:red_bed[facing=south,part=head]`);
    for (const t of h.torches) cmds.push(`setblock ${P(t)} minecraft:torch`);
    await run(cmds, 'the house');
}

export async function buildMine(b) {
    const g = b.g;
    const col = b.shaft.column;
    const room = b.room.box;
    const cmds = [
        // the room, the shaft, the descent, the landing and the tunnel are cut into the rock
        `fill ${P(room.min)} ${P(room.max)} minecraft:air`,
        `fill ${col.x} ${room.max.y + 1} ${col.z} ${col.x} ${g - 1} ${col.z} minecraft:air`,
    ];
    for (const s of b.steps) {
        cmds.push(`fill ${s.feet.x} ${s.feet.y} ${s.feet.z} ${s.feet.x} ${s.feet.y + 2} ${s.feet.z} minecraft:air`);
        cmds.push(`setblock ${P(s.floor)} minecraft:cobblestone`);
    }
    cmds.push(`fill ${P(b.landing.box.min)} ${P(b.landing.box.max)} minecraft:air`);
    cmds.push(`fill ${P(b.tunnel.box.min)} ${P(b.tunnel.box.max)} minecraft:air`);
    // the ladders hang on the north wall of the column (stone, dirt, and the wall of the room)
    cmds.push(`fill ${col.x} ${room.min.y} ${col.z - 1} ${col.x} ${g - 1} ${col.z - 1} minecraft:stone replace minecraft:air`);
    cmds.push(`fill ${col.x} ${room.min.y} ${col.z} ${col.x} ${g - 1} ${col.z} minecraft:ladder[facing=south]`);
    // the trapdoor in the floor of the house, closed, on the same side as the ladders (climbable when open)
    cmds.push(`setblock ${P(b.trapdoor)} minecraft:oak_trapdoor[facing=south,half=top,open=false]`);
    cmds.push(`setblock ${P(b.room.table)} minecraft:crafting_table`);
    cmds.push(`setblock ${P(b.room.torch)} minecraft:torch`);
    cmds.push(`setblock ${P(b.landing.torch)} minecraft:torch`);
    await run(cmds, 'the mine');
}

export async function buildFarm(b) {
    await buildField(b.farm);
    const f = b.farm;
    await run([
        `setblock ${P(f.composter)} minecraft:composter[level=0]`,
        `setblock ${f.chest.x} ${f.chest.y + 1} ${f.chest.z} minecraft:oak_fence`,
    ], 'the farm');
}

export async function buildPen(b) {
    const p = b.pen;
    const { min, max } = p.box;
    const g = min.y;
    const cmds = [
        `fill ${min.x} ${g - 1} ${min.z} ${max.x} ${g - 1} ${max.z} minecraft:dirt`,
        `fill ${min.x} ${g} ${min.z} ${max.x} ${g} ${max.z} minecraft:grass_block`,
        `fill ${min.x} ${g + 1} ${min.z} ${max.x} ${g + 1} ${max.z} minecraft:oak_fence`,
        `fill ${min.x + 1} ${g + 1} ${min.z + 1} ${max.x - 1} ${g + 2} ${max.z - 1} minecraft:air`,
        `setblock ${P(p.gate)} minecraft:oak_fence_gate[facing=south,open=false]`,
    ];
    await run(cmds, 'the pen');
}

// Summons the cow and the chicken of the pen (again), tagged, persistent. Returns their selectors.
export async function penAnimals(b) {
    const p = b.pen;
    await commands([`kill @e[tag=${p.tag}]`]);
    const out = await commands([
        `summon minecraft:cow ${p.cow.x + 0.5} ${p.cow.y} ${p.cow.z + 0.5} {PersistenceRequired:1b,Tags:["${p.tag}","${p.tag}_cow"]}`,
        `summon minecraft:chicken ${p.chicken.x + 0.5} ${p.chicken.y} ${p.chicken.z + 0.5} {PersistenceRequired:1b,Tags:["${p.tag}","${p.tag}_chicken"]}`,
    ]);
    const bad = out.flat().filter((l) => !/Summoned new/.test(l));
    if (bad.length) throw new Error('summoning the animals of the pen failed: ' + bad.join(' | '));
    return { cow: `@e[tag=${p.tag}_cow,limit=1]`, chicken: `@e[tag=${p.tag}_chicken,limit=1]` };
}

// Builds the whole base in the region of the plan. options.parts limits it (for example ['house', 'farm']);
// options.chests false leaves the chests empty. The region must be prepared (prepareRegion) and its
// chunks loaded (prepareRegion loads them).
export async function buildBase(b, { parts = ['house', 'mine', 'farm', 'pen'], chests = true, animals = true } = {}) {
    if (env.world !== 'base') throw new Error(`the base is built in the base world, not in the ${env.world} world`);
    if (parts.includes('house')) {
        await buildHouse(b);
        await buildChest(b.house.chest, chests ? HOUSE_CHEST_ITEMS : {}, { facing: 'west' });
    }
    if (parts.includes('mine')) {
        await buildMine(b);
        await buildChest(b.room.chest, chests ? ROOM_CHEST_ITEMS : {}, { facing: 'east' });
    }
    if (parts.includes('farm')) {
        await buildFarm(b);
        await buildChest(b.farm.chest, chests ? FARM_CHEST_ITEMS : {}, { facing: 'west' });
    }
    if (parts.includes('pen')) {
        await buildPen(b);
        if (animals) await penAnimals(b);
    }
    return b;
}

// ------------------------------------------------------------------ memory of the bot

// Saves the place "home" of the base (the middle of the house) in the memory of the agent, as the owner's
// bot had it: a place, no area (spec 12, T2.2; finding M5). Not !rememberHere: with protected_areas on that
// command also saves the building around it as an area.
export function saveHomePlace(agent, b) {
    const p = b.house.home;
    return agent.memory_bank.rememberPlace('home', p.x + 0.5, p.y, p.z + 0.5, agent.bot.game?.dimension);
}

// ------------------------------------------------------------------ reading it back

// Reads the base back from the server. Returns { ok, lines, failed }: one line per part with the number of
// blocks that are as planned. `parts` as for buildBase.
export async function verifyBase(b, { parts = ['house', 'mine', 'farm', 'pen'], animals = true } = {}) {
    const lines = [];
    const failed = [];
    const expect = async (what, list, names) => {
        const got = await blockNames(list.map((x) => x.pos), [...new Set(names.flat())]);
        const wrong = list.filter((x, i) => !(Array.isArray(x.name) ? x.name.includes(got[i]) : got[i] === x.name));
        const ok = wrong.length === 0;
        lines.push(`${ok ? 'ok' : 'WRONG'} ${what}: ${list.length - wrong.length} of ${list.length}`);
        if (!ok) failed.push(`${what}: ${wrong.slice(0, 4).map((x) => `(${x.pos.x}, ${x.pos.y}, ${x.pos.z}) is ${got[list.indexOf(x)] ?? 'other'}, planned ${x.name}`).join('; ')}`);
        return ok;
    };
    const g = b.g;
    if (parts.includes('house')) {
        const h = b.house;
        await expect('house: door, bed, chest, posts, windows, torches', [
            { pos: h.door, name: 'oak_door[half=lower,open=false]' }, { pos: h.doorUpper, name: 'oak_door[half=upper,open=false]' },
            { pos: h.bedFoot, name: 'red_bed[part=foot]' }, { pos: h.bedHead, name: 'red_bed[part=head]' },
            { pos: h.chest, name: 'chest' },
            ...h.posts.map((pos) => ({ pos, name: 'oak_log' })), ...h.windows.map((pos) => ({ pos, name: 'glass' })),
            ...h.torches.map((pos) => ({ pos, name: 'torch' })),
        ], ['oak_door[half=lower,open=false]', 'oak_door[half=upper,open=false]', 'red_bed[part=foot]', 'red_bed[part=head]', 'chest', 'oak_log', 'glass', 'torch']);
        const walls = [];
        const { min, max } = h.box;
        for (let x = min.x + 1; x < max.x; x += 2) walls.push({ pos: { x, y: g + 3, z: min.z }, name: 'oak_planks' }, { pos: { x, y: g + 3, z: max.z }, name: 'oak_planks' });
        for (let x = min.x; x <= max.x; x += 2) for (let z = min.z; z <= max.z; z += 2) walls.push({ pos: { x, y: g + 5, z }, name: 'oak_planks' });
        await expect('house: walls and roof (planks)', walls, ['oak_planks']);
        const air = [h.home, { ...h.home, y: g + 4 }, h.insideNearDoor, { ...h.insideNearDoor, y: g + 2 }].map((pos) => ({ pos, name: 'air' }));
        await expect('house: air inside', air, ['air']);
        const items = await chestItems(h.chest);
        const okItems = Object.entries(HOUSE_CHEST_ITEMS).every(([n, c]) => (items?.[n] || 0) === c);
        lines.push(`${okItems ? 'ok' : 'WRONG'} house: the chest holds ${JSON.stringify(items)}`);
        if (!okItems) failed.push(`house chest: ${JSON.stringify(items)}`);
    }
    if (parts.includes('mine')) {
        await expect('shaft: trapdoor closed in the floor', [{ pos: b.trapdoor, name: 'oak_trapdoor[half=top,open=false,facing=south]' }], ['oak_trapdoor[half=top,open=false,facing=south]']);
        await expect(`shaft: ladders from y ${b.room.box.min.y} to ${g - 1}`, b.shaft.ladders.map((pos) => ({ pos, name: 'ladder[facing=south]' })), ['ladder[facing=south]']);
        const roomAir = [];
        for (let x = b.room.box.min.x; x <= b.room.box.max.x; x++) {
            for (let z = b.room.box.min.z; z <= b.room.box.max.z; z++) {
                for (let y = b.room.box.min.y; y <= b.room.box.max.y; y++) {
                    const p = { x, y, z };
                    const special = [b.room.chest, b.room.table, b.room.torch, ...b.shaft.ladders].some((q) => q.x === x && q.y === y && q.z === z);
                    if (!special) roomAir.push({ pos: p, name: 'air' });
                }
            }
        }
        await expect(`room at y ${b.room.box.min.y}: air`, roomAir, ['air']);
        await expect('room: chest, crafting table, torch, stone floor', [
            { pos: b.room.chest, name: 'chest' }, { pos: b.room.table, name: 'crafting_table' }, { pos: b.room.torch, name: 'torch' },
            { pos: { ...b.room.middle, y: b.room.floorY }, name: 'stone' },
        ], ['chest', 'crafting_table', 'torch', 'stone']);
        const steps = b.steps.flatMap((s) => [
            { pos: s.floor, name: 'cobblestone' }, { pos: s.feet, name: 'air' }, { pos: { ...s.feet, y: s.feet.y + 1 }, name: 'air' }, { pos: { ...s.feet, y: s.feet.y + 2 }, name: 'air' },
        ]);
        await expect(`descent: ${b.steps.length} steps of loose blocks from y ${b.steps[0].feet.y} to ${b.steps[b.steps.length - 1].feet.y}`, steps, ['cobblestone', 'air']);
        await expect('landing: air and torch', [{ pos: b.landing.middle, name: 'air' }, { pos: { ...b.landing.middle, y: b.landing.middle.y + 2 }, name: 'air' }, { pos: b.landing.torch, name: 'torch' }], ['air', 'torch']);
        const tunnel = b.tunnel.cells.flatMap((c) => [
            { pos: c, name: 'air' }, { pos: { ...c, y: c.y + 1 }, name: 'air' }, { pos: { ...c, y: c.y + 2 }, name: 'stone' }, { pos: { ...c, y: c.y - 1 }, name: 'stone' },
            { pos: { ...c, x: c.x - 1 }, name: 'stone' }, { pos: { ...c, x: c.x + 1 }, name: 'stone' },
        ]);
        await expect(`tunnel: 1 x 2, ${b.tunnel.cells.length} blocks long, stone around it`, tunnel, ['air', 'stone']);
        const above = { x: b.tunnel.cells[6].x, y: g, z: b.tunnel.cells[6].z };
        await expect('tunnel: grass above it', [{ pos: above, name: 'grass_block' }, { pos: { ...above, y: g + 1 }, name: 'air' }], ['grass_block', 'air']);
    }
    if (parts.includes('farm')) {
        const f = b.farm;
        await expect('farm: fence ring with gate and chest', f.fenceRing.map((pos) => ({ pos, name: f.ringBlock(pos) })), ['oak_fence', 'oak_fence_gate', 'chest']);
        await expect('farm: gate closed, water, composter, a fence post on the chest', [
            { pos: f.gate, name: 'oak_fence_gate[open=false]' }, { pos: f.water, name: 'water' }, { pos: f.composter, name: 'composter[level=0]' },
            { pos: { ...f.chest, y: f.chest.y + 1 }, name: 'oak_fence' },
        ], ['oak_fence_gate[open=false]', 'water', 'composter[level=0]', 'oak_fence']);
        await expect('farm: farmland', f.cells.filter((c) => c.spec.ground === 'farmland').map((c) => ({ pos: c.ground, name: 'farmland' })), ['farmland']);
        const ages = await cropAges(f.crops.map((c) => c.above));
        const wrongAges = f.crops.filter((c, i) => ages[i] !== c.spec.age);
        lines.push(`${wrongAges.length ? 'WRONG' : 'ok'} farm: wheat ${f.crops.length - wrongAges.length} of ${f.crops.length} of the planned age`);
        if (wrongAges.length) failed.push(`farm crops: ${wrongAges.length} of another age`);
    }
    if (parts.includes('pen')) {
        const p = b.pen;
        await expect('pen: fence ring with gate', p.ring.map((pos) => ({ pos, name: p.ringBlock(pos) })), ['oak_fence', 'oak_fence_gate']);
        await expect('pen: gate closed', [{ pos: p.gate, name: 'oak_fence_gate[open=false]' }], ['oak_fence_gate[open=false]']);
        if (animals) {
            const where = await penAnimalsWhere(b);
            const ok = where.cow.inside && where.chicken.inside;
            lines.push(`${ok ? 'ok' : 'WRONG'} pen: cow at ${fmt(where.cow.pos)}, chicken at ${fmt(where.chicken.pos)}, both inside`);
            if (!ok) failed.push(`pen animals: cow ${fmt(where.cow.pos)}, chicken ${fmt(where.chicken.pos)}`);
        }
    }
    return { ok: failed.length === 0, lines, failed };
}

// Where the cow and the chicken of the pen are (server) and whether each is inside the fence.
export async function penAnimalsWhere(b) {
    const p = b.pen;
    const sel = { cow: `@e[tag=${p.tag}_cow,limit=1]`, chicken: `@e[tag=${p.tag}_chicken,limit=1]` };
    const got = await positions([sel.cow, sel.chicken]);
    const inside = (pos) => inBox(pos, p.inner);
    return {
        cow: { pos: got[sel.cow], inside: inside(got[sel.cow]) },
        chicken: { pos: got[sel.chicken], inside: inside(got[sel.chicken]) },
    };
}

// Whether the fence ring of the pen stands as built: { whole, missing: [positions] }.
export async function penFence(b) {
    const p = b.pen;
    const got = await blockNames(p.ring, ['oak_fence', 'oak_fence_gate']);
    const missing = p.ring.filter((pos, i) => got[i] !== p.ringBlock(pos));
    return { whole: missing.length === 0, missing };
}

// Whether the fence ring of the farm stands as built (gate and chest included).
export async function farmFence(b) {
    const f = b.farm;
    const got = await blockNames(f.fenceRing, ['oak_fence', 'oak_fence_gate', 'chest']);
    const missing = f.fenceRing.filter((pos, i) => got[i] !== f.ringBlock(pos));
    return { whole: missing.length === 0, missing };
}

export { passed, MC };
