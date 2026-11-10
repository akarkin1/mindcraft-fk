// Geometry of area boxes for the home pack. Pure: no imports.
//
// A box is { min: {x,y,z}, max: {x,y,z} } of whole block coordinates, both ends included
// (spec v0.1.4.6 A1). As space it covers [min, max + 1) on every axis. A position belongs to
// the block floor(x), floor(y), floor(z).
//
// The home pack keeps its own copy of these few functions so that it does not depend on the
// load order or the state of src/agent/areas/.

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
}

/**
 * True for a box with finite corners and min <= max on every axis.
 * @param {*} box
 * @returns {boolean}
 */
export function isBox(box) {
    return box !== null && typeof box === 'object' && isPoint(box.min) && isPoint(box.max)
        && box.min.x <= box.max.x && box.min.y <= box.max.y && box.min.z <= box.max.z;
}

/**
 * The block of a position.
 * @param {{x: number, y: number, z: number}} p
 * @returns {{x: number, y: number, z: number}|null} null for a position that is not finite
 */
export function floorPos(p) {
    if (!isPoint(p)) {
        return null;
    }
    return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
}

/**
 * True when the block of the position lies in the box.
 * @param {object} box
 * @param {{x: number, y: number, z: number}} pos
 * @returns {boolean}
 */
export function containsPos(box, pos) {
    const b = floorPos(pos);
    if (!b || !isBox(box)) {
        return false;
    }
    return b.x >= box.min.x && b.x <= box.max.x && b.y >= box.min.y && b.y <= box.max.y
        && b.z >= box.min.z && b.z <= box.max.z;
}

function axisGap(value, min, max) {
    if (value < min) {
        return min - value;
    }
    if (value > max + 1) {
        return value - (max + 1);
    }
    return 0;
}

/**
 * Straight distance from a position to the space of the box, 0 inside.
 * @param {object} box
 * @param {{x: number, y: number, z: number}} pos
 * @returns {number} Infinity for invalid input
 */
export function distanceToBox(box, pos) {
    if (!isBox(box) || !isPoint(pos)) {
        return Infinity;
    }
    const dx = axisGap(pos.x, box.min.x, box.max.x);
    const dy = axisGap(pos.y, box.min.y, box.max.y);
    const dz = axisGap(pos.z, box.min.z, box.max.z);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Like distanceToBox, without y.
 * @param {object} box
 * @param {{x: number, y: number, z: number}} pos
 * @returns {number} Infinity for invalid input
 */
export function horizontalDistanceToBox(box, pos) {
    if (!isBox(box) || !isPoint(pos)) {
        return Infinity;
    }
    const dx = axisGap(pos.x, box.min.x, box.max.x);
    const dz = axisGap(pos.z, box.min.z, box.max.z);
    return Math.sqrt(dx * dx + dz * dz);
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

/**
 * The point of the space of the box that is nearest to the position.
 * @param {object} box
 * @param {{x: number, y: number, z: number}} pos
 * @returns {{x: number, y: number, z: number}|null}
 */
export function nearestPointOnBox(box, pos) {
    if (!isBox(box) || !isPoint(pos)) {
        return null;
    }
    return {
        x: clamp(pos.x, box.min.x, box.max.x + 1),
        y: clamp(pos.y, box.min.y, box.max.y + 1),
        z: clamp(pos.z, box.min.z, box.max.z + 1),
    };
}

/**
 * The box grown by n blocks on every side; a negative n shrinks it.
 * @param {object} box
 * @param {number} n
 * @returns {object|null} null when nothing is left or the input is invalid
 */
export function expandBox(box, n) {
    if (!isBox(box) || !isFiniteNumber(n)) {
        return null;
    }
    const out = {
        min: { x: box.min.x - n, y: box.min.y - n, z: box.min.z - n },
        max: { x: box.max.x + n, y: box.max.y + n, z: box.max.z + n },
    };
    return isBox(out) ? out : null;
}

function shrinkAxis(min, max, by = 2) {
    for (let n = by; n >= 1; n--) {
        if (min + n <= max - n) {
            return [min + n, max - n];
        }
    }
    return [min, max];
}

/**
 * How the edge of a box lies (v0.1.4.15, Q-1 and W126 D): `wall` when the box's edge columns are the walls themselves
 * (the box of the floor scan with area_floors, and of the base survey: the room grown by 1), `margin` when a margin of
 * air lies between the walls and the edge (the box of scanBuilding without floors: the blocks grown by 1). The interior
 * of a `wall` box is the box shrunk by 1, of a `margin` box by 2; a box without the mark counts as `margin` (as before).
 */
export const BOX_EDGES = Object.freeze(['wall', 'margin']);

/** The margin the interior of a box shrinks by for each kind of edge. */
export const EDGE_MARGINS = Object.freeze({ wall: 1, margin: 2 });

// Names a player walks through: the ring of a `margin` box is made of them, the ring of a `wall` box is not.
const OPEN_NAMES = new Set(['air', 'cave_air', 'void_air', 'water', 'lava', 'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'snow',
    'torch', 'wall_torch', 'soul_torch', 'soul_wall_torch', 'redstone_wire', 'rail', 'powered_rail', 'detector_rail', 'activator_rail', 'cobweb', 'light']);
const OPEN_ENDINGS = ['_carpet', '_pressure_plate', '_button', '_sign', '_banner', '_torch', '_sapling', '_tulip'];

function isOpenName(name) {
    return OPEN_NAMES.has(name) || OPEN_ENDINGS.some(e => name.endsWith(e));
}

/**
 * The margin the interior of a box shrinks by: `margin` when given a whole number, else by the box's `edge` (BOX_EDGES),
 * else 2 (a box without the mark: the boxes of before v0.1.4.15).
 * @param {object} box
 * @param {number|null} [margin]
 * @returns {number}
 */
export function interiorMargin(box, margin = null) {
    if (Number.isInteger(margin) && margin >= 0) {
        return margin;
    }
    return Object.hasOwn(EDGE_MARGINS, box?.edge) ? EDGE_MARGINS[box.edge] : EDGE_MARGINS.margin;
}

/**
 * The room inside the walls: x and z shrink by the margin of the box (interiorMargin: 1 for a box whose edge is the
 * wall, 2 for a box with a margin of air outside the walls or without the mark), y stays. An axis that is too small
 * for that shrinks less, or not at all.
 * @param {object} box an area or a box, with its optional `edge`
 * @param {number|null} [margin] shrink by this instead
 * @returns {object|null}
 */
export function interiorBox(box, margin = null) {
    if (!isBox(box)) {
        return null;
    }
    const by = interiorMargin(box, margin);
    const [minX, maxX] = shrinkAxis(box.min.x, box.max.x, by);
    const [minZ, maxZ] = shrinkAxis(box.min.z, box.max.z, by);
    return { min: { x: minX, y: box.min.y, z: minZ }, max: { x: maxX, y: box.max.y, z: maxZ } };
}

/**
 * The kind of a box's edge read from the world (v0.1.4.15): the ring of the box at the height of the walls (2 over its
 * bottom, the first level above the floor blocks; its top at most) is looked at: half or more of the cells read solid,
 * the edge is the wall (`wall`); else air lies between the walls and the edge (`margin`). null when no cell of the ring
 * is loaded. Never throws.
 * @param {(x: number, y: number, z: number) => string|{name: string}|null} read a block name reader (blockReader of
 *   motion.js gives { name }, the scans a name)
 * @param {object} box
 * @returns {'wall'|'margin'|null}
 */
export function edgeOf(read, box) {
    if (typeof read !== 'function' || !isBox(box)) {
        return null;
    }
    const y = Math.min(box.min.y + 2, box.max.y);
    let solid = 0;
    let open = 0;
    const look = (x, z) => {
        let value;
        try {
            value = read(x, y, z);
        } catch {
            value = null;
        }
        const name = typeof value === 'string' ? value : value?.name;
        if (typeof name !== 'string' || name === '') {
            return;
        }
        if (isOpenName(name.replace(/^minecraft:/, ''))) {
            open++;
        } else {
            solid++;
        }
    };
    for (let x = box.min.x; x <= box.max.x; x++) {
        look(x, box.min.z);
        if (box.max.z !== box.min.z) {
            look(x, box.max.z);
        }
    }
    for (let z = box.min.z + 1; z <= box.max.z - 1; z++) {
        look(box.min.x, z);
        if (box.max.x !== box.min.x) {
            look(box.max.x, z);
        }
    }
    if (solid + open === 0) {
        return null;
    }
    return solid * 2 >= solid + open ? 'wall' : 'margin';
}

/**
 * The middle of the space of the box.
 * @param {object} box
 * @returns {{x: number, y: number, z: number}|null}
 */
export function boxCenter(box) {
    if (!isBox(box)) {
        return null;
    }
    return {
        x: (box.min.x + box.max.x + 1) / 2,
        y: (box.min.y + box.max.y + 1) / 2,
        z: (box.min.z + box.max.z + 1) / 2,
    };
}

/**
 * Straight distance of two points.
 * @returns {number} Infinity for invalid input
 */
export function distance(a, b) {
    if (!isPoint(a) || !isPoint(b)) {
        return Infinity;
    }
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

/**
 * Distance of two points without y.
 * @returns {number} Infinity for invalid input
 */
export function horizontalDistance(a, b) {
    if (!isPoint(a) || !isPoint(b)) {
        return Infinity;
    }
    return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
}

/**
 * True when a point of the segment from a to b lies in the box. Checked every quarter block.
 * @param {{x: number, y: number, z: number}} a
 * @param {{x: number, y: number, z: number}} b
 * @param {object} box
 * @returns {boolean}
 */
export function segmentCrossesBox(a, b, box) {
    if (!isPoint(a) || !isPoint(b) || !isBox(box)) {
        return false;
    }
    const length = distance(a, b);
    const steps = Math.max(1, Math.ceil(length / 0.25));
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
        if (containsPos(box, point)) {
            return true;
        }
    }
    return false;
}
