// Blocks the bot never stands in or on (v0.1.4.8, fix round, the last holes of X1). Pure.
// mineflayer-pathfinder takes a composter, a cauldron, a hopper and a chest for solid ground to stand on.
// A composter is hollow: the bot fits between its walls, falls in and gets out only with a jump, which
// the path search does not know (the long run: !farmCycle was stopped by night_shelter, and the walk of
// the shelter ended on the composter). The farming pack has the same list for its own walks; the packs
// do not import each other, so the home pack keeps its own copy.

/** Hollow blocks and containers: never a place to stand in or on. */
export const NO_STAND_NAMES = Object.freeze(['composter', 'cauldron', 'water_cauldron', 'lava_cauldron', 'powder_snow_cauldron', 'hopper',
    'chest', 'trapped_chest', 'ender_chest']);

function plainName(name) {
    return typeof name === 'string' && name.length > 0 ? name.trim().toLowerCase().replace(/^minecraft:/, '') : '';
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPos(p) {
    return p !== null && typeof p === 'object' && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
}

/**
 * True for a block the bot never stands in or on: a composter, a cauldron, a hopper, a chest (also
 * trapped and ender), a fence, a wall, and a fence gate that is closed.
 * @param {string} name
 * @param {object|null} [properties] the block properties; `open` of a gate
 * @returns {boolean}
 */
export function isNoStandBlock(name, properties = null) {
    const n = plainName(name);
    if (n.length === 0) {
        return false;
    }
    if (NO_STAND_NAMES.includes(n)) {
        return true;
    }
    if (n.endsWith('_fence_gate')) {
        return !(properties && (properties.open === true || properties.open === 'true'));
    }
    return n.endsWith('_fence') || n.endsWith('_wall');
}

function noStandAt(getBlock, x, y, z) {
    try {
        const b = getBlock(x, y, z);
        return Boolean(b) && typeof b.name === 'string' && isNoStandBlock(b.name, b.properties ?? null);
    } catch {
        return false;
    }
}

/**
 * True when a place to stand (the block of the feet) is in or on a block of isNoStandBlock: the block
 * of the feet or the block under it is one. Never throws.
 * @param {(x: number, y: number, z: number) => ({name: string, properties?: object}|null)} getBlock
 * @param {{x: number, y: number, z: number}} pos
 * @returns {boolean}
 */
export function isNoStandCell(getBlock, pos) {
    if (typeof getBlock !== 'function' || !isPos(pos)) {
        return false;
    }
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    const z = Math.floor(pos.z);
    return noStandAt(getBlock, x, y, z) || noStandAt(getBlock, x, y - 1, z);
}

/**
 * A goal of mineflayer-pathfinder that is `goal` without the places that `forbidden(node)` refuses: the
 * path search never ends a walk there. Everything else of the goal is its own: the wrapper reads x, y, z,
 * rangeSq, entity ... through its prototype, and heuristic, hasChanged and isValid run on the goal itself
 * (a dynamic goal updates its own fields). Never throws in isEnd.
 * @param {object} goal
 * @param {(node: {x: number, y: number, z: number}) => boolean} forbidden
 * @returns {object} a goal
 */
export function goalAvoiding(goal, forbidden) {
    if (!goal || typeof goal !== 'object' || typeof goal.isEnd !== 'function' || typeof forbidden !== 'function') {
        return goal;
    }
    const refused = (node) => {
        try {
            return forbidden(node) === true;
        } catch {
            return false;
        }
    };
    const wrapped = Object.create(goal);
    wrapped.inner = goal;
    wrapped.isEnd = (node) => goal.isEnd(node) === true && !refused(node);
    wrapped.heuristic = (node) => goal.heuristic(node);
    wrapped.hasChanged = () => (typeof goal.hasChanged === 'function' ? goal.hasChanged() : false);
    wrapped.isValid = () => (typeof goal.isValid === 'function' ? goal.isValid() : true);
    return wrapped;
}
