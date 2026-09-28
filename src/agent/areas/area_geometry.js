// Boxes of whole blocks for protected areas (spec v0.1.4.6, A1). Pure: no imports.
//
// A box is { min: {x, y, z}, max: {x, y, z} } with whole numbers, both ends included.
// A position belongs to the block floor(x), floor(y), floor(z). In space, a box covers
// everything from min to max + 1 on every axis.

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(value) {
    return value !== null && typeof value === 'object'
        && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z);
}

function isWholePoint(value) {
    return isPoint(value) && Number.isInteger(value.x) && Number.isInteger(value.y) && Number.isInteger(value.z);
}

// Distance from a coordinate to the covered interval [lo, hi + 1] of one axis.
function axisGap(lo, hi, value) {
    if (value < lo) {
        return lo - value;
    }
    const end = hi + 1;
    return value > end ? value - end : 0;
}

/**
 * True for a box of whole numbers with min <= max on every axis.
 * @param {*} box
 * @returns {boolean}
 */
export function isValidBox(box) {
    return box !== null && typeof box === 'object'
        && isWholePoint(box.min) && isWholePoint(box.max)
        && box.min.x <= box.max.x && box.min.y <= box.max.y && box.min.z <= box.max.z;
}

/**
 * Box from two corners in any order. Fractional coordinates are floored.
 * @param {{x: number, y: number, z: number}} a
 * @param {{x: number, y: number, z: number}} b
 * @returns {{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}}}
 * @throws {TypeError} when a corner has no finite x, y, z
 */
export function normalizeBox(a, b) {
    if (!isPoint(a) || !isPoint(b)) {
        throw new TypeError('A box needs two corners with finite x, y and z');
    }
    const ax = Math.floor(a.x);
    const ay = Math.floor(a.y);
    const az = Math.floor(a.z);
    const bx = Math.floor(b.x);
    const by = Math.floor(b.y);
    const bz = Math.floor(b.z);
    return {
        min: { x: Math.min(ax, bx), y: Math.min(ay, by), z: Math.min(az, bz) },
        max: { x: Math.max(ax, bx), y: Math.max(ay, by), z: Math.max(az, bz) },
    };
}

/**
 * True if the block of the position lies in the box, both ends included.
 * Invalid input gives false.
 * @param {{min: object, max: object}} box
 * @param {{x: number, y: number, z: number}} pos
 * @returns {boolean}
 */
export function contains(box, pos) {
    if (!isValidBox(box) || !isPoint(pos)) {
        return false;
    }
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    const z = Math.floor(pos.z);
    return x >= box.min.x && x <= box.max.x
        && y >= box.min.y && y <= box.max.y
        && z >= box.min.z && z <= box.max.z;
}

/**
 * Straight distance in blocks from the position to the nearest point of the space the box
 * covers (min to max + 1). 0 inside. Invalid input gives Infinity.
 * @param {{min: object, max: object}} box
 * @param {{x: number, y: number, z: number}} pos
 * @returns {number}
 */
export function distanceToBox(box, pos) {
    if (!isValidBox(box) || !isPoint(pos)) {
        return Infinity;
    }
    const dx = axisGap(box.min.x, box.max.x, pos.x);
    const dy = axisGap(box.min.y, box.max.y, pos.y);
    const dz = axisGap(box.min.z, box.max.z, pos.z);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Like distanceToBox, without y.
 * @param {{min: object, max: object}} box
 * @param {{x: number, y?: number, z: number}} pos y is ignored
 * @returns {number}
 */
export function horizontalDistanceToBox(box, pos) {
    if (!isValidBox(box) || pos === null || typeof pos !== 'object'
        || !isFiniteNumber(pos.x) || !isFiniteNumber(pos.z)) {
        return Infinity;
    }
    const dx = axisGap(box.min.x, box.max.x, pos.x);
    const dz = axisGap(box.min.z, box.max.z, pos.z);
    return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Size in blocks, both ends included.
 * @param {{min: object, max: object}} box
 * @returns {{x: number, y: number, z: number}}
 */
export function boxSize(box) {
    return {
        x: box.max.x - box.min.x + 1,
        y: box.max.y - box.min.y + 1,
        z: box.max.z - box.min.z + 1,
    };
}

/**
 * Middle of the space the box covers: (min + max + 1) / 2 on every axis.
 * @param {{min: object, max: object}} box
 * @returns {{x: number, y: number, z: number}}
 */
export function center(box) {
    return {
        x: (box.min.x + box.max.x + 1) / 2,
        y: (box.min.y + box.max.y + 1) / 2,
        z: (box.min.z + box.max.z + 1) / 2,
    };
}

// One axis of expand(): shrinking never goes below one block.
function expandAxis(lo, hi, n) {
    const newLo = lo - n;
    const newHi = hi + n;
    if (newLo <= newHi) {
        return [newLo, newHi];
    }
    const middle = Math.floor((lo + hi) / 2);
    return [middle, middle];
}

/**
 * New box, every side moved outwards by n blocks (the whole part of n). A negative n
 * shrinks the box, but every axis keeps at least one block.
 * @param {{min: object, max: object}} box
 * @param {number} n
 * @returns {{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}}}
 * @throws {TypeError} for an invalid box or an n that is not finite
 */
export function expand(box, n) {
    if (!isValidBox(box) || !isFiniteNumber(n)) {
        throw new TypeError('expand needs a valid box and a finite number');
    }
    const whole = Math.trunc(n);
    const [x0, x1] = expandAxis(box.min.x, box.max.x, whole);
    const [y0, y1] = expandAxis(box.min.y, box.max.y, whole);
    const [z0, z1] = expandAxis(box.min.z, box.max.z, whole);
    return { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } };
}
