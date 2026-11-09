// Where a bed may be placed (v0.1.4.14, P-24, SPEC 8.6). `!placeHere("black_bed")` placed where the bot stood, once on
// a pillar of cobblestone 2 blocks above the ground, and failed on a slope. A bed lies on two level ground cells with
// air above them, each support block with at least two solid neighbours at its level (no pillar), with a free cell
// beside the bed to stand on. Pure: names through a getter, never throws.

/** How far from the bot (in x and z, one level up or down) the foot of the bed lies without a walk. */
export const BED_REACH = 1;
/** How far the bot looks for level ground for a bed, and walks there. */
export const BED_SEARCH = 4;
/** SPEC 8.11, word for word. */
export const NO_BED_GROUND_TEXT = 'I found no level ground for the bed within 4 blocks.';

// The directions from the foot of a bed to its head.
const DIRS = Object.freeze([
    { dx: 0, dz: -1, facing: 'north' },
    { dx: 1, dz: 0, facing: 'east' },
    { dx: 0, dz: 1, facing: 'south' },
    { dx: -1, dz: 0, facing: 'west' },
]);

// The levels of the foot of a bed around the bot's feet: the ground a pillar stands on lies below it (P-24).
const LEVELS = Object.freeze([0, -1, 1, -2, -3]);

// Cells a bed may take (air, and the plants it replaces), and cells the bot walks through.
const FREE = new Set(['air', 'cave_air', 'void_air', 'short_grass', 'grass', 'fern', 'snow']);
// Blocks that are no level support: liquids, and the blocks below.
const NOT_SUPPORT = new Set(['water', 'lava', 'bubble_column', 'powder_snow', 'scaffolding', 'farmland', 'dirt_path', 'soul_sand', 'mud']);
const NOT_SUPPORT_ENDINGS = ['_bed', '_slab', '_stairs', '_fence', '_fence_gate', '_wall', '_door', '_trapdoor', '_carpet', '_sapling', '_torch',
    '_sign', '_button', '_pressure_plate', '_leaves', '_flower', 'chest', 'cauldron', 'composter', 'hopper'];

function baseName(name) {
    return typeof name === 'string' && name !== '' ? name.replace(/^minecraft:/, '') : null;
}

function reader(getBlockName) {
    const cache = new Map();
    return (x, y, z) => {
        const k = `${x},${y},${z}`;
        if (!cache.has(k)) {
            let name = null;
            try {
                name = baseName(getBlockName(x, y, z));
            } catch {
                name = null;
            }
            cache.set(k, name);
        }
        return cache.get(k);
    };
}

function isFree(name) {
    return name !== null && FREE.has(name);
}

function isSupport(name) {
    return name !== null && !isFree(name) && !NOT_SUPPORT.has(name) && !NOT_SUPPORT_ENDINGS.some(e => name.endsWith(e));
}

// A solid block at the level of a support (its neighbour), for the rule "no pillar".
function isSolid(name) {
    return name !== null && !isFree(name) && !['water', 'lava', 'bubble_column'].includes(name);
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && [p.x, p.y, p.z].every(n => typeof n === 'number' && Number.isFinite(n));
}

// A support block with at least two solid neighbours at its level (sideways).
function groundSupport(read, x, y, z) {
    if (!isSupport(read(x, y, z))) {
        return false;
    }
    return DIRS.filter(d => isSolid(read(x + d.dx, y, z + d.dz))).length >= 2;
}

// A cell to stand in: feet and head free, a support below.
function standable(read, x, y, z) {
    return isFree(read(x, y, z)) && isFree(read(x, y + 1, z)) && isSupport(read(x, y - 1, z));
}

/**
 * The bed at a foot cell with its head toward `dir`, or null: both cells free with air above, both supports level
 * ground (groundSupport), and the cell behind the foot free to stand in (the bot places the bed from there, facing the
 * head).
 * @param {(x: number, y: number, z: number) => string|null} read
 * @param {{x: number, y: number, z: number}} foot
 * @param {{dx: number, dz: number, facing: string}} dir
 * @returns {{foot: object, head: object, facing: string, stand: object}|null}
 */
function bedAt(read, foot, dir) {
    const head = { x: foot.x + dir.dx, y: foot.y, z: foot.z + dir.dz };
    const stand = { x: foot.x - dir.dx, y: foot.y, z: foot.z - dir.dz };
    for (const c of [foot, head]) {
        if (!isFree(read(c.x, c.y, c.z)) || !isFree(read(c.x, c.y + 1, c.z)) || !groundSupport(read, c.x, c.y - 1, c.z)) {
            return null;
        }
    }
    if (!standable(read, stand.x, stand.y, stand.z)) {
        return null;
    }
    return { foot, head, facing: dir.facing, stand };
}

/**
 * The places for a bed around the bot, the best first: those whose foot lies within BED_REACH blocks of the bot's
 * feet (in x and z) and whose stand is the bot's own cell first, then by the way to the stand. Only places within
 * `range` blocks (BED_SEARCH) in x and z, from 3 levels below the feet to 1 above.
 * @param {(x: number, y: number, z: number) => string|null} getBlockName
 * @param {{x: number, y: number, z: number}} origin the bot's position
 * @param {number} [range]
 * @returns {{foot: {x,y,z}, head: {x,y,z}, facing: string, stand: {x,y,z}, near: boolean}[]}
 */
export function bedPlaces(getBlockName, origin, range = BED_SEARCH) {
    try {
        if (typeof getBlockName !== 'function' || !isPoint(origin)) {
            return [];
        }
        const read = reader(getBlockName);
        const o = { x: Math.floor(origin.x), y: Math.floor(origin.y), z: Math.floor(origin.z) };
        const r = Number.isFinite(range) ? Math.max(0, Math.floor(range)) : BED_SEARCH;
        const out = [];
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                for (const dy of LEVELS) {
                    const foot = { x: o.x + dx, y: o.y + dy, z: o.z + dz };
                    for (const dir of DIRS) {
                        const place = bedAt(read, foot, dir);
                        if (place) {
                            const near = Math.max(Math.abs(dx), Math.abs(dz)) <= BED_REACH;
                            const here = place.stand.x === o.x && place.stand.y === o.y && place.stand.z === o.z;
                            const way = Math.hypot(place.stand.x - o.x, place.stand.y - o.y, place.stand.z - o.z);
                            out.push({ ...place, near, here, way });
                        }
                    }
                }
            }
        }
        out.sort((a, b) => Number(b.near && b.here) - Number(a.near && a.here) || Number(b.near) - Number(a.near) || a.way - b.way
            || a.foot.x - b.foot.x || a.foot.z - b.foot.z || a.foot.y - b.foot.y);
        return out.map(({ here, way, ...p }) => p);
    } catch {
        return [];
    }
}
