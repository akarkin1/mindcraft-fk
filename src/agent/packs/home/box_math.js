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

function shrinkAxis(min, max) {
    for (const n of [2, 1]) {
        if (min + n <= max - n) {
            return [min + n, max - n];
        }
    }
    return [min, max];
}

/**
 * The room inside the walls: x and z shrink by 2 (the margin of a scanned box and the wall),
 * y stays. An axis that is too small for that shrinks by 1 or not at all.
 * @param {object} box
 * @returns {object|null}
 */
export function interiorBox(box) {
    if (!isBox(box)) {
        return null;
    }
    const [minX, maxX] = shrinkAxis(box.min.x, box.max.x);
    const [minZ, maxZ] = shrinkAxis(box.min.z, box.max.z);
    return { min: { x: minX, y: box.min.y, z: minZ }, max: { x: maxX, y: box.max.y, z: maxZ } };
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
