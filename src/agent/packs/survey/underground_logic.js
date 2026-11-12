// The underground of the base survey (v0.1.4.15 "The base survey and Routines", PLAN section 4, SPEC 2.3; engineer E4):
// from a building a trapdoor or a ladder column leads down; the room at the ladder's foot is the basement (a building that
// counts as shelter, `under` the building); the openings of its rock walls lead to a mine entrance (a tunnel) or a cave
// mouth (a keep-out area); the way house, trapdoor, ladder, basement, opening is a route in the shape of the RouteStore.
// Pure: the world is read through a getBlockName(x, y, z) => string|null (the survey gives the ore-blind reader of
// survey_logic.js), nothing here throws, and the module imports only area_scan.js, area_kind.js and the box math of the
// home pack (the imports the spec allows survey_logic.js).
//
// The shapes (SPEC 2.3):
//   followLadder(read, top, options) → { top, bottom, x, z, face, trapdoor } | null
//     top: a `down` seed, the trapdoor over the column or any ladder block of it; the result's top and bottom are the y of
//     the highest and the lowest ladder block (as a ladder leg), face the facing of the ladders (the open side; options.faceAt
//     reads the real `facing` of a block, else the open neighbour tells it), trapdoor the trapdoor block over the column or null.
//   basementOf(read, ladder, options) → { found, box, enclosure, contents, kind, type, entrances, foot } | { found: false }
//     the room at the foot: scanEnclosure in building mode with floors (the rock box of a dug room with a chest or a ladder
//     goes the building way, F7); kind by kindOf (never a pen, a farm or a yard: a room at a ladder's foot is a building).
//   wallOpenings(read, basement, options) → [{ at, beyond, dir, kind: 'tunnel' | 'cave' | null, enclosure }]
//     each opening of kind `gap` of the basement's scan and each air cell of its wall ring whose far side is natural rock or
//     cave air, grouped (a doorway 2 wide and 2 high is one opening); beyond is the cell 2 out, where scanEnclosure in mode
//     auto says tunnel (source rock) or cave.
//   undergroundOf(read, building, downSeeds, options) → { ladder, basement, openings, places, routes }
//     everything of one building, with the places in the shape of findPlaces (survey_logic.js) and the routes of
//     routeOfSurvey, for survey.js to save.
//   routeOfSurvey(building, trapdoor, ladder, basement, opening) → a route of the RouteStore shape without its dimension.
import { scanEnclosure, isBuiltBlock, COPPER_CHESTS } from '../../areas/area_scan.js';
import { kindOf, typeOfKind } from '../../areas/area_kind.js';
import { containsPos, isBox } from '../home/box_math.js';

/** The numbers of the underground (SPEC 2.3). */
export const UNDERGROUND_RULES = Object.freeze({
    ladderMax: 48,      // a ladder column is at most this long
    ladderMin: 2,       // and at least this long to lead down
    trapdoorGap: 2,     // the top ladder is at most this far below the trapdoor
    beyond: 2,          // the cell outside an opening the scan of the rock starts from
    caveGrow: 1,        // the keep-out box of a cave mouth: the opening cell grown by this in every direction
});

/** The names the survey gives the places of the underground. */
export const UNDERGROUND_NAMES = Object.freeze({ basement: 'basement', mine: 'mine_entrance', cave: 'cave_mouth' });

const AIR = new Set(['air', 'cave_air', 'void_air']);
const PASSABLE_NAMES = new Set([...AIR, 'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'snow', 'torch',
    'wall_torch', 'soul_torch', 'soul_wall_torch', 'redstone_wire', 'lever', 'tripwire', 'rail', 'powered_rail', 'detector_rail',
    'activator_rail', 'cobweb', 'light', 'water']);
const PASSABLE_ENDINGS = ['_carpet', '_button', '_pressure_plate', '_sign', '_banner', '_torch', '_sapling'];
const CHESTS = new Set(['chest', 'trapped_chest', 'barrel', ...COPPER_CHESTS]);
const FURNACES = new Set(['furnace', 'blast_furnace', 'smoker']);
// Natural rock and earth: the walls of a dug room, never a built block (isBuiltBlock of area_scan.js is not exported; the
// names a room is dug in are few).
const NATURAL_SOLID = new Set(['stone', 'deepslate', 'granite', 'diorite', 'andesite', 'tuff', 'calcite', 'dirt', 'grass_block',
    'gravel', 'sand', 'red_sand', 'sandstone', 'red_sandstone', 'clay', 'netherrack', 'basalt', 'blackstone', 'end_stone', 'dripstone_block',
    'coarse_dirt', 'rooted_dirt', 'mud', 'packed_mud', 'moss_block', 'snow_block', 'ice', 'packed_ice', 'blue_ice', 'obsidian',
    'terracotta', 'bedrock', 'magma_block', 'soul_sand', 'soul_soil', 'podzol', 'mycelium', 'cobbled_deepslate', 'smooth_basalt']);

const DIRECTIONS = Object.freeze(['north', 'east', 'south', 'west']);
const VECTORS = Object.freeze({ north: { x: 0, z: -1 }, east: { x: 1, z: 0 }, south: { x: 0, z: 1 }, west: { x: -1, z: 0 } });

// --- small helpers -----------------------------------------------------------------------------------------------------

function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

function posOf(p) {
    if (p === null || typeof p !== 'object' || !isFiniteNumber(p.x) || !isFiniteNumber(p.y) || !isFiniteNumber(p.z)) {
        return null;
    }
    return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
}

function plain(name) {
    return typeof name === 'string' && name !== '' ? name.replace(/^minecraft:/, '') : null;
}

// A reader that never throws and gives names without `minecraft:`.
function readerOf(read) {
    if (typeof read !== 'function') {
        return () => null;
    }
    return (x, y, z) => {
        try {
            return plain(read(x, y, z));
        } catch {
            return null;
        }
    };
}

function isPassable(name) {
    return name !== null && (PASSABLE_NAMES.has(name) || PASSABLE_ENDINGS.some(e => name.endsWith(e)));
}

function isAir(name) {
    return name !== null && AIR.has(name);
}

function isLadder(name) {
    return name === 'ladder';
}

function isTrapdoor(name) {
    return name !== null && name.endsWith('_trapdoor');
}

function isNaturalSolid(name) {
    return name !== null && (NATURAL_SOLID.has(name) || name.endsWith('_ore'));
}

// A cell a player stands in: feet passable (a ladder counts), head passable.
function standCell(read, x, y, z) {
    const feet = read(x, y, z);
    const head = read(x, y + 1, z);
    return feet !== null && head !== null && (isPassable(feet) || isLadder(feet)) && (isPassable(head) || isLadder(head));
}

function solidGround(read, x, y, z) {
    const name = read(x, y, z);
    return name !== null && !isPassable(name) && !isLadder(name) && !isTrapdoor(name);
}

function backOf(dir) {
    return DIRECTIONS[(DIRECTIONS.indexOf(dir) + 2) % 4];
}

function directionTo(dx, dz) {
    return DIRECTIONS.find(d => VECTORS[d].x === Math.sign(dx) && VECTORS[d].z === Math.sign(dz) && Math.abs(dx) + Math.abs(dz) > 0) ?? null;
}

function emptyContents() {
    return { animals: {}, crops: {}, beds: 0, chests: 0, furnaces: 0, tables: 0, ladders: 0, water: 0 };
}

function tryScan(read, origin, options) {
    try {
        return scanEnclosure(read, origin, options);
    } catch {
        return null;
    }
}

function boxOf(a, b) {
    const p = posOf(a);
    const q = posOf(b);
    if (!p || !q) {
        return null;
    }
    return { min: { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), z: Math.min(p.z, q.z) }, max: { x: Math.max(p.x, q.x), y: Math.max(p.y, q.y), z: Math.max(p.z, q.z) } };
}

function nameOfBuilding(building) {
    return typeof building?.name === 'string' && building.name !== '' ? building.name : 'building';
}

// --- the ladder (2.3.1) ------------------------------------------------------------------------------------------------

// The facing of the ladders of a column from the world: options.faceAt(x, y, z) when it gives a direction for one of the
// ladder blocks; else the open neighbour of the column (a ladder hangs on a wall and faces away from it): with one solid
// neighbour the direction away from it, else the one passable neighbour; else null.
function faceOf(read, x, top, bottom, z, options) {
    const faceAt = typeof options?.faceAt === 'function' ? options.faceAt : null;
    if (faceAt) {
        for (let y = top; y >= bottom; y--) {
            let face = null;
            try {
                face = faceAt(x, y, z);
            } catch {
                face = null;
            }
            if (DIRECTIONS.includes(face)) {
                return face;
            }
        }
    }
    const mid = Math.floor((top + bottom) / 2);
    const solid = [];
    const open = [];
    for (const dir of DIRECTIONS) {
        const v = VECTORS[dir];
        const name = read(x + v.x, mid, z + v.z);
        if (name === null) {
            continue;
        }
        if (isPassable(name) || isLadder(name)) {
            open.push(dir);
        } else {
            solid.push(dir);
        }
    }
    if (solid.length === 1) {
        return backOf(solid[0]);
    }
    if (open.length === 1) {
        return open[0];
    }
    if (solid.length === 3 && open.length === 1) {
        return open[0];
    }
    return null;
}

/**
 * The ladder column a `down` seed leads to (SPEC 2.3.1): a trapdoor over a ladder column (the top ladder at most 2 below
 * it), or any block of a ladder column. The column is followed up to its highest and down to its lowest ladder block, at
 * most 48 long; a column shorter than 2 leads nowhere. Never throws.
 * @param {(x: number, y: number, z: number) => string|null} read
 * @param {{x: number, y: number, z: number}} top the seed: the trapdoor, or a ladder block
 * @param {{faceAt?: (x: number, y: number, z: number) => string|null}} [options] faceAt: the `facing` of a block of the world
 * @returns {{top: number, bottom: number, x: number, z: number, face: string, trapdoor: {x: number, y: number, z: number}|null}|null}
 */
export function followLadder(read, top, options = {}) {
    const r = readerOf(read);
    const seed = posOf(top);
    if (!seed) {
        return null;
    }
    const { x, z } = seed;
    let y = seed.y;
    let trapdoor = null;
    const seedName = r(x, y, z);
    if (isTrapdoor(seedName)) {
        trapdoor = { x, y, z };
        let found = null;
        for (let dy = 1; dy <= UNDERGROUND_RULES.trapdoorGap; dy++) {
            const name = r(x, y - dy, z);
            if (isLadder(name)) {
                found = y - dy;
                break;
            }
            if (!isPassable(name)) {
                break;
            }
        }
        if (found === null) {
            return null;
        }
        y = found;
    } else if (!isLadder(seedName)) {
        return null;
    }
    // up to the highest ladder of the column
    let highest = y;
    while (highest - y < UNDERGROUND_RULES.ladderMax && isLadder(r(x, highest + 1, z))) {
        highest++;
    }
    // down to the lowest
    let lowest = y;
    while (highest - lowest < UNDERGROUND_RULES.ladderMax - 1 && isLadder(r(x, lowest - 1, z))) {
        lowest--;
    }
    if (highest - lowest + 1 < UNDERGROUND_RULES.ladderMin) {
        return null;
    }
    if (!trapdoor) {
        for (let dy = 1; dy <= UNDERGROUND_RULES.trapdoorGap; dy++) {
            const name = r(x, highest + dy, z);
            if (isTrapdoor(name)) {
                trapdoor = { x, y: highest + dy, z };
                break;
            }
            if (!isPassable(name)) {
                break;
            }
        }
    }
    const face = faceOf(r, x, highest, lowest, z, options) ?? 'north';
    return { top: highest, bottom: lowest, x, z, face, trapdoor };
}

// --- the basement (2.3.2) ----------------------------------------------------------------------------------------------

// What a box holds, as countContents counts it, from the names of the blocks (a bed is 2 blocks) and the animals given.
function contentsOf(read, box, animals) {
    const c = emptyContents();
    for (const a of Array.isArray(animals) ? animals : []) {
        const pos = posOf(a?.pos);
        if (pos && typeof a.name === 'string' && containsPos(box, pos)) {
            c.animals[a.name] = (c.animals[a.name] ?? 0) + 1;
        }
    }
    let bedBlocks = 0;
    for (let x = box.min.x; x <= box.max.x; x++) {
        for (let y = box.min.y; y <= box.max.y; y++) {
            for (let z = box.min.z; z <= box.max.z; z++) {
                const name = read(x, y, z);
                if (name === null || AIR.has(name)) {
                    continue;
                }
                if (name.endsWith('_bed')) {
                    bedBlocks++;
                } else if (CHESTS.has(name)) {
                    c.chests++;
                } else if (FURNACES.has(name)) {
                    c.furnaces++;
                } else if (name === 'crafting_table') {
                    c.tables++;
                } else if (name === 'ladder') {
                    c.ladders++;
                } else if (name === 'water') {
                    c.water++;
                }
            }
        }
    }
    c.beds = Math.ceil(bedBlocks / 2);
    return c;
}

// The most cells of one room (the floor of the largest area).
const ROOM_MAX_CELLS = 64 * 64;
// A cell of a room has a 3 x 3 of standable floor around it somewhere; a corridor 1 or 2 wide has none.
const ROOM_WINDOW = 1;

// A cell of the floor a player stands on: standable with solid ground under it (the bottom ladder counts).
function floorCell(read, x, y, z) {
    return standCell(read, x, y, z) && solidGround(read, x, y - 1, z);
}

// True when a 3 x 3 window of floor cells at this height holds the cell: a room, not a corridor.
function inRoomWindow(read, x, y, z) {
    // every window of 2 * ROOM_WINDOW + 1 that holds the cell: it starts up to 2 * ROOM_WINDOW before the cell
    for (let ox = -2 * ROOM_WINDOW; ox <= 0; ox++) {
        for (let oz = -2 * ROOM_WINDOW; oz <= 0; oz++) {
            let all = true;
            for (let dx = 0; dx <= 2 * ROOM_WINDOW && all; dx++) {
                for (let dz = 0; dz <= 2 * ROOM_WINDOW && all; dz++) {
                    if (!floorCell(read, x + ox + dx, y, z + oz + dz)) {
                        all = false;
                    }
                }
            }
            if (all) {
                return true;
            }
        }
    }
    return false;
}

// The first block that is not passable over a cell within `height`, or null (no ceiling: the sky, or not loaded).
function ceilingOf(read, x, y, z, height = 16) {
    for (let dy = 1; dy <= height; dy++) {
        const name = read(x, y + dy, z);
        if (name === null) {
            return null;
        }
        if (!isPassable(name) && !isLadder(name)) {
            return y + dy;
        }
    }
    return null;
}

// The room around a floor cell: the flood of the floor cells (one step up or down) that lie in a 3 x 3 of floor (a corridor 1
// or 2 wide, a tunnel, a passage to a cave is a way out of the room, never part of it), at most ROOM_MAX_CELLS; its box (the
// cells grown by 1 in x and z, from the floor under them to the highest ceiling over them). null when the start is no room
// cell, the room has no ceiling over half of its cells, or it is too big.
function roomOf(read, start) {
    const level = start.y;
    if (!inRoomWindow(read, start.x, start.y, start.z)) {
        return null;
    }
    const seen = new Set([`${start.x},${start.y},${start.z}`]);
    const columns = new Set([`${start.x},${start.z}`]);
    const queue = [start];
    const box = { minX: start.x, maxX: start.x, minZ: start.z, maxZ: start.z, minY: start.y, top: -Infinity };
    let roofed = 0;
    for (let head = 0; head < queue.length; head++) {
        const c = queue[head];
        if (queue.length > ROOM_MAX_CELLS) {
            return null;
        }
        box.minX = Math.min(box.minX, c.x);
        box.maxX = Math.max(box.maxX, c.x);
        box.minZ = Math.min(box.minZ, c.z);
        box.maxZ = Math.max(box.maxZ, c.z);
        box.minY = Math.min(box.minY, c.y);
        const ceiling = ceilingOf(read, c.x, c.y, c.z);
        if (ceiling !== null) {
            roofed++;
            box.top = Math.max(box.top, ceiling);
        }
        for (const dir of DIRECTIONS) {
            const v = VECTORS[dir];
            const nx = c.x + v.x;
            const nz = c.z + v.z;
            if (columns.has(`${nx},${nz}`)) {
                continue;
            }
            for (const dy of [0, 1, -1]) {
                const ny = c.y + dy;
                if (Math.abs(ny - level) > 1 || seen.has(`${nx},${ny},${nz}`) || !floorCell(read, nx, ny, nz) || !inRoomWindow(read, nx, ny, nz)) {
                    continue;
                }
                seen.add(`${nx},${ny},${nz}`);
                columns.add(`${nx},${nz}`);
                queue.push({ x: nx, y: ny, z: nz });
                break;
            }
        }
    }
    if (roofed * 2 < queue.length || box.top === -Infinity) {
        return null;
    }
    return {
        cells: queue,
        box: { min: { x: box.minX - 1, y: box.minY - 1, z: box.minZ - 1 }, max: { x: box.maxX + 1, y: box.top, z: box.maxZ + 1 } },
    };
}

// A reader bounded to a box: every passable cell outside the box at the heights of its floor reads as stone, so the scans
// of area_scan.js stop at the room's walls (the floor scan does not run out through a tunnel, the scan of the rock beyond an
// opening does not run back into the room). `inside` true bounds the inside (for the scans beyond the walls), false the outside.
function boundedReader(read, box, inside) {
    return (x, y, z) => {
        const name = read(x, y, z);
        if (name === null || y <= box.min.y || y >= box.max.y) {
            return name;
        }
        // the ring of the box (its walls, the opening cells among them) belongs to the outside for the floor scan of the room
        // and to the inside for the scans beyond its walls, so neither runs through an opening
        const within = inside ? (x >= box.min.x && x <= box.max.x && z >= box.min.z && z <= box.max.z)
            : (x > box.min.x && x < box.max.x && z > box.min.z && z < box.max.z);
        if (within === inside && (isPassable(name) || isLadder(name) || isTrapdoor(name))) {
            return 'stone';
        }
        return name;
    };
}

// The cells a player can stand in beside the foot of the column, the open side of the ladders first.
function footCells(read, ladder) {
    const order = [ladder.face, ...DIRECTIONS.filter(d => d !== ladder.face)];
    const out = [];
    for (const dir of order) {
        const v = VECTORS[dir];
        for (const dy of [0, -1, 1]) {
            const y = ladder.bottom + dy;
            if (standCell(read, ladder.x + v.x, y, ladder.z + v.z) && solidGround(read, ladder.x + v.x, y - 1, ladder.z + v.z)) {
                out.push({ x: ladder.x + v.x, y, z: ladder.z + v.z, dir });
            }
        }
    }
    return out;
}

// The enclosure of a room without the scan (the bounded scan found nothing): a roofed room of rock or made walls with the
// trapdoor as its opening, in the shape scanEnclosure gives.
function roomEnclosure(read, room, trapdoor) {
    const box = room.box;
    let made = 0;
    let natural = 0;
    for (let x = box.min.x; x <= box.max.x; x++) {
        for (const z of [box.min.z, box.max.z]) {
            const name = read(x, box.min.y + 1, z);
            if (isNaturalSolid(name)) natural++; else if (name !== null && !isPassable(name)) made++;
        }
    }
    for (let z = box.min.z + 1; z <= box.max.z - 1; z++) {
        for (const x of [box.min.x, box.max.x]) {
            const name = read(x, box.min.y + 1, z);
            if (isNaturalSolid(name)) natural++; else if (name !== null && !isPassable(name)) made++;
        }
    }
    const openings = trapdoor ? [{ ...trapdoor, kind: 'trapdoor' }] : [];
    return {
        found: true, box: { min: { ...box.min }, max: { ...box.max } }, border: 'wall', openings, roof: true, floor: natural > made ? 'ground' : 'built',
        reason: null, text: '', min: { ...box.min }, max: { ...box.max }, entrances: openings.map(o => ({ ...o })), source: 'building',
        scan: { found: true, floor: true, blocks: room.cells.length, entrances: openings.map(o => ({ ...o })) },
    };
}

/**
 * The room at the foot of a ladder (SPEC 2.3.2): the room is the floor around a cell beside the foot where a 3 x 3 of
 * floor is open (a tunnel or a passage 1 or 2 wide that leaves it is a way out, not part of it; roomOf), and its facts are
 * those of scanEnclosure in building mode with floors, read through a reader bounded to the room (so the floor scan does
 * not run out through the tunnel). The box must hold the foot. The kind is kindOf of the scan and the contents (home,
 * storage or building; anything else is a building: a room at a ladder's foot is no pen, farm or yard), the type that of
 * the kind. The trapdoor over the column is among the entrances. Never throws.
 * @param {(x: number, y: number, z: number) => string|null} read
 * @param {{top: number, bottom: number, x: number, z: number, face: string, trapdoor?: object|null}} ladder of followLadder
 * @param {{animals?: {pos: object, name: string}[], now?: () => number}} [options]
 * @returns {{found: boolean, box?: object, enclosure?: object, contents?: object, kind?: string, type?: string, entrances?: object[], foot?: object}}
 */
export function basementOf(read, ladder, options = {}) {
    const r = readerOf(read);
    if (!ladder || !isFiniteNumber(ladder.x) || !isFiniteNumber(ladder.z) || !isFiniteNumber(ladder.bottom)) {
        return { found: false };
    }
    const scanOptions = { mode: 'building', floors: true, ...(typeof options?.now === 'function' ? { now: options.now } : {}) };
    const footCell = { x: ladder.x, y: ladder.bottom, z: ladder.z };
    const trapdoor = posOf(ladder.trapdoor);
    for (const cell of footCells(r, ladder)) {
        const room = roomOf(r, { x: cell.x, y: cell.y, z: cell.z });
        if (!room || !containsPos(room.box, footCell)) {
            continue;
        }
        const bounded = boundedReader(r, room.box, false);
        let e = tryScan(bounded, { x: cell.x + 0.5, y: cell.y, z: cell.z + 0.5 }, scanOptions);
        if (!e?.found || !e.box || !containsPos(e.box, footCell)) {
            e = roomEnclosure(r, room, trapdoor);
        }
        const box = boxOf(e.min, e.max);
        const contents = contentsOf(r, box, options?.animals);
        let kind = kindOf(e, contents);
        if (kind !== 'home' && kind !== 'storage') {
            kind = 'building';
        }
        const entrances = Array.isArray(e.entrances) ? e.entrances.map(o => ({ ...o })) : [];
        if (trapdoor && !entrances.some(o => o.x === trapdoor.x && o.y === trapdoor.y && o.z === trapdoor.z)) {
            entrances.push({ ...trapdoor, kind: 'trapdoor' });
        }
        return { found: true, box, enclosure: e, contents, kind, type: typeOfKind(kind) ?? 'building', entrances, foot: { x: cell.x, y: cell.y, z: cell.z } };
    }
    return { found: false };
}

// --- the openings of the rock walls (2.3.3) ----------------------------------------------------------------------------

// The wall of the box a ring cell lies in, with the direction outward; null off the walls or on a corner.
function wallOf(box, x, z) {
    const west = x === box.min.x;
    const east = x === box.max.x;
    const north = z === box.min.z;
    const south = z === box.max.z;
    if ((west || east) && (north || south)) {
        return null;
    }
    if (west) return 'west';
    if (east) return 'east';
    if (north) return 'north';
    if (south) return 'south';
    return null;
}

// True when the opening at a ring cell leads into natural ground: the cells 1 and 2 out are passable (the way goes on),
// or the cell 2 out is natural rock (a short niche of the rock); never into a made block.
function leadsIntoRock(read, cell, dir) {
    const v = VECTORS[dir];
    const one = read(cell.x + v.x, cell.y, cell.z + v.z);
    const two = read(cell.x + 2 * v.x, cell.y, cell.z + 2 * v.z);
    if (one === null || two === null || !isPassable(one)) {
        return false;
    }
    return isAir(two) || isPassable(two) || isNaturalSolid(two);
}

// The ring cells of the box that are open with a floor under them, and the gaps of the scan, as opening cells { x, y, z, dir }.
function openingCells(read, basement) {
    const box = basement.box;
    const cells = new Map();
    const add = (x, y, z, dir) => {
        if (dir && !cells.has(`${x},${y},${z}`)) {
            cells.set(`${x},${y},${z}`, { x, y, z, dir });
        }
    };
    const ring = [];
    for (let x = box.min.x; x <= box.max.x; x++) {
        ring.push([x, box.min.z], [x, box.max.z]);
    }
    for (let z = box.min.z + 1; z <= box.max.z - 1; z++) {
        ring.push([box.min.x, z], [box.max.x, z]);
    }
    for (const [x, z] of ring) {
        const dir = wallOf(box, x, z);
        if (!dir) {
            continue;
        }
        for (let y = box.min.y + 1; y <= box.max.y - 1; y++) {
            if (standCell(read, x, y, z) && solidGround(read, x, y - 1, z) && leadsIntoRock(read, { x, y, z }, dir)) {
                add(x, y, z, dir);
            }
        }
    }
    for (const o of Array.isArray(basement.enclosure?.openings) ? basement.enclosure.openings : []) {
        if (o?.kind !== 'gap' || !isFiniteNumber(o.x) || !isFiniteNumber(o.y) || !isFiniteNumber(o.z)) {
            continue;
        }
        const dir = wallOf(box, o.x, o.z);
        if (dir && leadsIntoRock(read, o, dir)) {
            add(o.x, o.y, o.z, dir);
        }
    }
    return [...cells.values()];
}

// Groups of opening cells of one wall that touch (a doorway 2 wide and 2 high is one opening); the lowest cell first.
function groupOpenings(cells) {
    const groups = [];
    const seen = new Set();
    const sorted = [...cells].sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z);
    for (let i = 0; i < sorted.length; i++) {
        if (seen.has(i)) {
            continue;
        }
        const group = [sorted[i]];
        seen.add(i);
        for (let g = 0; g < group.length; g++) {
            for (let j = 0; j < sorted.length; j++) {
                const c = sorted[j];
                if (!seen.has(j) && c.dir === group[g].dir && Math.abs(c.x - group[g].x) <= 1 && Math.abs(c.z - group[g].z) <= 1 && Math.abs(c.y - group[g].y) <= 1) {
                    seen.add(j);
                    group.push(c);
                }
            }
        }
        groups.push(group);
    }
    return groups;
}

// The flood beyond an opening: at most this many cells, this far from the cell beyond, a ceiling within this height.
const BEYOND_MAX_CELLS = 1024;
const BEYOND_REACH = 24;
const BEYOND_ROOF = 8;
const BEYOND_SHARE = 2 / 3;
const USE_NAMES = new Set(['chest', 'trapped_chest', 'barrel', 'furnace', 'blast_furnace', 'smoker', 'crafting_table', 'ladder', ...COPPER_CHESTS]);

// Natural rock or earth that bounds a space in the ground: solid, not built (isBuiltBlock), no log, no leaves, no glass.
function isNaturalWall(name) {
    return name !== null && !isPassable(name) && !isLadder(name) && !isTrapdoor(name) && !isBuiltBlock(name) && !name.endsWith('_log')
        && !name.endsWith('_wood') && !name.endsWith('_leaves') && !name.includes('glass') && name !== 'water' && name !== 'lava';
}

function isUseName(name) {
    return name !== null && (USE_NAMES.has(name) || name.endsWith('_bed') || name.endsWith('_door') || isTrapdoor(name));
}

// What lies beyond an opening when the scan of the rock says nothing: scanEnclosure counts a place as under rock only with
// 3 solid blocks over its roof block (ROCK_ABOVE of area_scan.js), and a cave 2 blocks under the surface, as the one of W126,
// has 2. From the cell beyond, the flood of the cells to stand in (one step up or down, at most BEYOND_REACH away and
// BEYOND_MAX_CELLS): the space is of the rock when 2 of 3 of the columns that bound it are natural, 2 of 3 of its cells have
// a ceiling within 8 (not the open sky) and nothing of use stands in it (no chest, bed, table, ladder, door: a dug room that
// is lived in is no cave); then a tunnel when it is 1 or 2 wide and 4 long or more, else a cave. null otherwise.
function rockBeyond(read, start) {
    const level = start.y;
    const seen = new Set([`${start.x},${start.y},${start.z}`]);
    const columns = new Set([`${start.x},${start.z}`]);
    const queue = [start];
    const counts = { natural: 0, other: 0 };
    let roofed = 0;
    let use = false;
    const box = { min: { ...start }, max: { ...start } };
    for (let head = 0; head < queue.length && queue.length <= BEYOND_MAX_CELLS; head++) {
        const c = queue[head];
        box.min.x = Math.min(box.min.x, c.x);
        box.max.x = Math.max(box.max.x, c.x);
        box.min.z = Math.min(box.min.z, c.z);
        box.max.z = Math.max(box.max.z, c.z);
        box.min.y = Math.min(box.min.y, c.y);
        box.max.y = Math.max(box.max.y, c.y);
        const ceiling = ceilingOf(read, c.x, c.y, c.z, BEYOND_ROOF);
        if (ceiling !== null) {
            roofed++;
        }
        for (const dy of [-1, 0, 1, 2]) {
            if (isUseName(read(c.x, c.y + dy, c.z))) {
                use = true;
            }
        }
        for (const dir of DIRECTIONS) {
            const v = VECTORS[dir];
            const nx = c.x + v.x;
            const nz = c.z + v.z;
            if (columns.has(`${nx},${nz}`)) {
                continue;
            }
            let stepped = false;
            for (const dy of [0, 1, -1]) {
                const ny = c.y + dy;
                if (Math.abs(ny - level) > 1 || !floorCell(read, nx, ny, nz)) {
                    continue;
                }
                if (Math.abs(nx - start.x) > BEYOND_REACH || Math.abs(nz - start.z) > BEYOND_REACH) {
                    stepped = true; // beyond the reach: the space goes on, it is no wall
                    break;
                }
                if (!seen.has(`${nx},${ny},${nz}`)) {
                    seen.add(`${nx},${ny},${nz}`);
                    columns.add(`${nx},${nz}`);
                    queue.push({ x: nx, y: ny, z: nz });
                }
                stepped = true;
                break;
            }
            if (!stepped) {
                columns.add(`${nx},${nz}`);
                const wall = read(nx, c.y, nz);
                const over = read(nx, c.y + 1, nz);
                if (isNaturalWall(wall) || (wall !== null && isPassable(wall) && isNaturalWall(over))) {
                    counts.natural++;
                } else if (wall !== null && !isPassable(wall)) {
                    counts.other++; // a built block: planks, a door, glass
                } else if (wall !== null) {
                    counts.natural++; // a drop or a step the flood did not take, in the ground
                }
            }
        }
    }
    const cells = queue.length;
    const bounds = counts.natural + counts.other;
    if (cells === 0 || use || bounds < 3 || counts.natural < bounds * BEYOND_SHARE || roofed * 3 < cells * 2) {
        return null;
    }
    const dx = box.max.x - box.min.x + 1;
    const dz = box.max.z - box.min.z + 1;
    const width = Math.min(dx, dz);
    const length = Math.max(dx, dz);
    const grown = { min: { x: box.min.x - 1, y: box.min.y - 1, z: box.min.z - 1 }, max: { x: box.max.x + 1, y: box.max.y + 2, z: box.max.z + 1 } };
    if (width <= 2 && length >= 4) {
        const alongX = dx >= dz;
        const far = alongX ? (Math.abs(box.max.x - start.x) >= Math.abs(box.min.x - start.x) ? box.max.x : box.min.x)
            : (Math.abs(box.max.z - start.z) >= Math.abs(box.min.z - start.z) ? box.max.z : box.min.z);
        const dir = alongX ? (far >= start.x ? 'east' : 'west') : (far >= start.z ? 'south' : 'north');
        const end = alongX ? { x: far, y: level, z: start.z } : { x: start.x, y: level, z: far };
        return { kind: 'tunnel', box: grown, tunnel: { start: { ...start }, end, dir, length, width, level } };
    }
    return { kind: 'cave', box: grown, cave: { at: { ...start }, width: length, sides: 0 } };
}

/**
 * The openings of the rock walls of a basement (SPEC 2.3.3): each `gap` opening of its scan and each air cell of its wall
 * ring (a cell to stand in with a floor under it) whose far side is natural rock or cave air, grouped by wall and
 * adjacency. From the cell 2 out of each opening scanEnclosure in mode auto says what lies there: `tunnel` (source rock
 * with a tunnel: the way to a mine entrance), `cave`, or null (nothing of the rock: a made corridor, open ground). When
 * the scan sees no rock because the roof of the space is thin (a cave 2 blocks under the surface), rockBeyond judges the
 * space itself: natural walls, a ceiling, nothing of use; 1 or 2 wide and 4 long is a tunnel, else a cave. Never throws.
 * @param {(x: number, y: number, z: number) => string|null} read
 * @param {{box: object, enclosure?: object}} basement of basementOf
 * @param {{tunnelAt?: Function|null, now?: () => number}} [options] tunnelAt: the measure of a tunnel (tunnelAt of the
 *   mining pack); without the key the one registered with useTunnelMeasure of area_scan.js is used
 * @returns {{at: object, beyond: object, dir: string, kind: 'tunnel'|'cave'|null, enclosure: object|null}[]}
 */
export function wallOpenings(read, basement, options = {}) {
    const r = readerOf(read);
    if (!basement || !isBox(basement.box)) {
        return [];
    }
    const box = boxOf(basement.box.min, basement.box.max);
    const scanOptions = { mode: 'auto' };
    if (options && Object.hasOwn(options, 'tunnelAt')) {
        scanOptions.tunnelAt = options.tunnelAt;
    }
    if (typeof options?.now === 'function') {
        scanOptions.now = options.now;
    }
    const out = [];
    // the scans beyond the walls read the room as rock, so a cave or a tunnel never runs back into the basement
    const outside = boundedReader(r, box, true);
    for (const group of groupOpenings(openingCells(r, { ...basement, box }))) {
        const at = group[0];
        const v = VECTORS[at.dir];
        const two = { x: at.x + 2 * v.x, y: at.y, z: at.z + 2 * v.z };
        const beyond = standCell(r, two.x, two.y, two.z) ? two : { x: at.x + v.x, y: at.y, z: at.z + v.z };
        let e = tryScan(outside, { x: beyond.x + 0.5, y: beyond.y, z: beyond.z + 0.5 }, scanOptions);
        let kind = null;
        if (e && e.source === 'rock' && (e.reason === 'tunnel' || e.reason === 'cave')) {
            kind = e.reason;
        } else if (!e?.found) {
            // the scan found neither rock nor a building: the space beyond judged by its walls and its ceiling
            const rock = rockBeyond(outside, beyond);
            if (rock) {
                kind = rock.kind;
                e = { ...(e ?? {}), found: false, box: rock.box, min: rock.box.min, max: rock.box.max, border: 'rock', reason: rock.kind, source: 'rock',
                    tunnel: rock.tunnel ?? null, cave: rock.cave ?? null, judged: 'beyond' };
            }
        }
        out.push({ at: { x: at.x, y: at.y, z: at.z }, beyond, dir: at.dir, kind, enclosure: e ?? null });
    }
    return out;
}

// --- the places and the route (2.3.2 to 2.3.4) --------------------------------------------------------------------------

function makePlace(kind, name, type, box, at, entrances, contents, border, detail) {
    return {
        kind,
        name,
        type,
        box: box ? { min: { ...box.min }, max: { ...box.max } } : null,
        at: at ? { ...at } : null,
        entrances: (Array.isArray(entrances) ? entrances : []).map(e => ({ ...e })),
        contents,
        border,
        source: 'survey',
        detail,
    };
}

/**
 * The keep-out area of a cave mouth (SPEC 2.3.3): an area of type building (its kind `yard`, so the night logic never
 * counts a cave mouth as a shelter), the box of the opening cell grown by 1 in every direction, the flag no_enter, source
 * survey. In the shape of a place of findPlaces, with `flags` for the area store.
 * @param {{at: object, enclosure?: object|null}} opening of wallOpenings
 * @param {string} under the name of the basement it opens from
 * @returns {object}
 */
export function caveMouthArea(opening, under) {
    const at = posOf(opening?.at);
    if (!at) {
        return null;
    }
    const g = UNDERGROUND_RULES.caveGrow;
    const box = { min: { x: at.x - g, y: at.y - g, z: at.z - g }, max: { x: at.x + g, y: at.y + g, z: at.z + g } };
    const place = makePlace('yard', UNDERGROUND_NAMES.cave, 'building', box, at, [], emptyContents(), null,
        { what: 'cave_mouth', under, cave: opening?.enclosure?.cave ?? null, no_enter: true });
    place.flags = { no_enter: true };
    place.edge = 'wall'; // the rock around the opening is the box's edge (Q-1: the interior shrinks by 1)
    return place;
}

/**
 * The place of a mine entrance (SPEC 2.3.3): a point at the opening cell (`!goToRememberedPlace` walks to it; the mine
 * itself stays for `!mineOre`), with the tunnel of the scan in its detail.
 * @param {{at: object, enclosure?: object|null, dir?: string}} opening of wallOpenings
 * @param {string} under the name of the basement it opens from
 * @returns {object}
 */
export function mineEntrancePlace(opening, under) {
    const at = posOf(opening?.at);
    if (!at) {
        return null;
    }
    return makePlace('mine_entrance', UNDERGROUND_NAMES.mine, 'place', null, at, [], emptyContents(), null,
        { what: 'mine_entrance', under, tunnel: opening?.enclosure?.tunnel ?? null, dir: opening?.dir ?? null });
}

/**
 * The place of a basement (SPEC 2.3.2): type building, kind by kindOf, the trapdoor among its entrances, `detail.under`
 * the building it lies under. In the shape of a place of findPlaces, with `under` for the area store (isShelterType).
 * @param {object} basement of basementOf (found)
 * @param {object} building the building above (its name)
 * @returns {object}
 */
export function basementPlace(basement, building) {
    const under = nameOfBuilding(building);
    const place = makePlace(basement.kind, UNDERGROUND_NAMES.basement, basement.type, basement.box, null, basement.entrances, basement.contents,
        basement.enclosure?.border ?? 'wall', { what: 'basement', under, floor: basement.enclosure?.scan?.floor === true, roof: basement.enclosure?.roof === true });
    place.under = under;
    place.edge = 'wall'; // the box of the floor scan: the walls are its edge (Q-1: the interior shrinks by 1)
    return place;
}

// The cell a player stands in at the top of the column, beside the trapdoor, on the floor of the building: the open side
// of the ladders first, then the other sides, at the height of the floor over the trapdoor (top + 2 as the trail's routes).
function entryCell(read, ladder) {
    const y = ladder.top + 2;
    const order = [ladder.face, ...DIRECTIONS.filter(d => d !== ladder.face)];
    for (const dir of order) {
        const v = VECTORS[dir];
        const x = ladder.x + v.x;
        const z = ladder.z + v.z;
        if (standCell(read, x, y, z) && solidGround(read, x, y - 1, z)) {
            return { x, y, z };
        }
    }
    const v = VECTORS[ladder.face];
    return { x: ladder.x + v.x, y, z: ladder.z + v.z };
}

// The door of a building as a cell to stand in: its first entrance of kind door, else its first entrance, else the middle of
// its floor.
function doorCellOf(building) {
    const entrances = Array.isArray(building?.entrances) ? building.entrances : [];
    const door = entrances.find(e => e?.kind === 'door') ?? entrances[0] ?? null;
    const p = posOf(door);
    if (p) {
        return p;
    }
    const box = building?.box && isBox(building.box) ? building.box : (isBox(building) ? building : null);
    if (!box) {
        return null;
    }
    return { x: Math.floor((box.min.x + box.max.x) / 2), y: box.min.y + 1, z: Math.floor((box.min.z + box.max.z) / 2) };
}

function steps(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
}

/**
 * The way from a building to an opening of its basement (SPEC 2.3.4), a route in the shape of the RouteStore (without its
 * dimension, which survey.js adds): a walk from the building's door to the cell beside the trapdoor, a door leg with kind2
 * trapdoor (when there is one), a ladder leg with top, bottom, face, entry and foot, a walk from the foot to the opening.
 * Named `<building>_to_<place>` (`house_to_mine_entrance`), from the building (kind area), to the place, source survey.
 * The caller saves it only when no route of that name exists. Never throws; null without a ladder or an opening.
 * @param {object} building a place of findPlaces or an area (name, entrances, box or min/max)
 * @param {object|null} trapdoor the trapdoor block, or null for an open shaft
 * @param {{top: number, bottom: number, x: number, z: number, face: string}} ladder of followLadder
 * @param {object} basement of basementOf (found)
 * @param {{at: object, placeName?: string, kind?: string}} opening of wallOpenings, with the name of its place
 * @param {{read?: Function}} [options] read: the reader, for the cells beside the column
 * @returns {object|null}
 */
export function routeOfSurvey(building, trapdoor, ladder, basement, opening, options = {}) {
    try {
        const at = posOf(opening?.at);
        if (!ladder || !isFiniteNumber(ladder.top) || !isFiniteNumber(ladder.bottom) || !isFiniteNumber(ladder.x) || !isFiniteNumber(ladder.z) || !at) {
            return null;
        }
        const r = readerOf(options?.read);
        const face = DIRECTIONS.includes(ladder.face) ? ladder.face : 'north';
        const col = { ...ladder, face };
        const entry = entryCell(r, col);
        const footSide = basement?.foot ? posOf(basement.foot) : null;
        const foot = footSide ?? { x: ladder.x + VECTORS[face].x, y: ladder.bottom, z: ladder.z + VECTORS[face].z };
        const door = doorCellOf(building) ?? entry;
        const placeName = typeof opening.placeName === 'string' && opening.placeName !== '' ? opening.placeName
            : (opening.kind === 'cave' ? UNDERGROUND_NAMES.cave : UNDERGROUND_NAMES.mine);
        const buildingName = nameOfBuilding(building);
        const legs = [];
        if (door.x !== entry.x || door.y !== entry.y || door.z !== entry.z) {
            legs.push({ kind: 'walk', from: { ...door }, to: { ...entry } });
        }
        const trap = posOf(trapdoor);
        if (trap) {
            legs.push({ kind: 'door', kind2: 'trapdoor', name: plain(r(trap.x, trap.y, trap.z)) ?? 'trapdoor', x: trap.x, y: trap.y, z: trap.z,
                from: { ...entry }, to: { x: ladder.x, y: ladder.top, z: ladder.z } });
        }
        legs.push({ kind: 'ladder', x: ladder.x, z: ladder.z, top: ladder.top, bottom: ladder.bottom, face, entry: { ...entry }, foot: { ...foot } });
        if (foot.x !== at.x || foot.y !== at.y || foot.z !== at.z) {
            legs.push({ kind: 'walk', from: { ...foot }, to: { ...at } });
        }
        return {
            name: `${buildingName}_to_${placeName}`,
            from: { name: buildingName, kind: 'area', ...door },
            to: { name: placeName, ...at },
            legs,
            steps: steps(door, entry) + 1 + (ladder.top - ladder.bottom + 1) + steps(foot, at),
            source: 'survey',
        };
    } catch {
        return null;
    }
}

/**
 * The underground of one building (SPEC 2.3): from its `down` seeds the first ladder column that leads to a room, the
 * basement, the openings of its rock walls and their places (a mine entrance per tunnel, a cave mouth per cave) and the
 * routes from the building to each place. The names are the plain ones (`basement`, `mine_entrance`, `cave_mouth`); the
 * caller makes them unique. Never throws.
 * @param {(x: number, y: number, z: number) => string|null} read the ore-blind reader
 * @param {object} building a place of findPlaces or a saved area (name, box or min/max, entrances)
 * @param {object[]} downSeeds the `down` seeds inside the building's box (trapdoors, ladder blocks)
 * @param {{faceAt?: Function, animals?: object[], tunnelAt?: Function|null, now?: () => number}} [options]
 * @returns {{ladder: object|null, basement: object|null, openings: object[], places: object[], routes: object[]}}
 */
export function undergroundOf(read, building, downSeeds, options = {}) {
    const none = { ladder: null, basement: null, openings: [], places: [], routes: [] };
    try {
        const r = readerOf(read);
        const seeds = (Array.isArray(downSeeds) ? downSeeds : []).map(posOf).filter(Boolean)
            .sort((a, b) => (isTrapdoor(r(a.x, a.y, a.z)) ? 0 : 1) - (isTrapdoor(r(b.x, b.y, b.z)) ? 0 : 1) || b.y - a.y);
        const tried = new Set();
        for (const seed of seeds) {
            const ladder = followLadder(r, seed, options);
            if (!ladder || tried.has(`${ladder.x},${ladder.z},${ladder.bottom}`)) {
                continue;
            }
            tried.add(`${ladder.x},${ladder.z},${ladder.bottom}`);
            const box = building?.box && isBox(building.box) ? building.box : (isBox(building) ? building : null);
            if (box && ladder.bottom >= box.min.y + 1 && containsPos(box, { x: ladder.x, y: ladder.bottom, z: ladder.z }) && !ladder.trapdoor) {
                continue; // a ladder that stays on the floor of the building (a loft) leads nowhere down
            }
            const basement = basementOf(r, ladder, options);
            if (!basement.found) {
                continue;
            }
            const places = [basementPlace(basement, building)];
            const routes = [];
            const openOptions = {};
            if (options && Object.hasOwn(options, 'tunnelAt')) {
                openOptions.tunnelAt = options.tunnelAt;
            }
            if (typeof options?.now === 'function') {
                openOptions.now = options.now;
            }
            const openings = wallOpenings(r, basement, openOptions);
            for (const opening of openings) {
                let place = null;
                if (opening.kind === 'tunnel') {
                    place = mineEntrancePlace(opening, UNDERGROUND_NAMES.basement);
                } else if (opening.kind === 'cave') {
                    place = caveMouthArea(opening, UNDERGROUND_NAMES.basement);
                }
                if (!place) {
                    continue;
                }
                places.push(place);
                const route = routeOfSurvey(building, ladder.trapdoor, ladder, basement, { ...opening, placeName: place.name }, { read: r });
                if (route) {
                    routes.push(route);
                }
            }
            return { ladder, basement, openings, places, routes };
        }
    } catch {
        return none;
    }
    return none;
}
