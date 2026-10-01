// What the item reflex leaves alone (spec v0.1.4.10, R1 and R2). Pure: no imports.
//
// A walk of the mode item_collecting never goes through a fence gate, and never into an area of type
// pen or farm, or an area with the flag no_enter, while the bot is outside that area. An item that lies
// inside such an area is left there, with a text at most once a minute.

/** The extra cost of the path search for a cell the walk must not use (Movements.exclusionAreasStep). */
export const KEEP_OUT_COST = 100;

/** The types of areas the reflex does not enter from outside. */
export const KEEP_OUT_TYPES = Object.freeze(['pen', 'farm']);

/** The flags an area may carry (R2). */
export const AREA_FLAGS = Object.freeze(['no_enter']);

/** The text that an item is left is said at most once in this many ms. */
export const LEAVE_TEXT_MS = 60000;

function isPoint(p) {
    return p !== null && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

function isBox(area) {
    return area !== null && typeof area === 'object' && isPoint(area.min) && isPoint(area.max);
}

function plainDimension(value) {
    if (typeof value !== 'string' || value.length === 0) {
        return 'overworld';
    }
    return value.startsWith('minecraft:') ? value.slice('minecraft:'.length) || 'overworld' : value;
}

/**
 * True for a fence gate of any wood, with or without "minecraft:".
 * @param {*} name
 * @returns {boolean}
 */
export function isGateName(name) {
    return typeof name === 'string' && name.endsWith('_fence_gate');
}

/**
 * True for an area that the reflex does not enter from outside: type pen or farm, or the flag no_enter.
 * @param {object} area
 * @returns {boolean}
 */
export function isKeepOutArea(area) {
    if (!isBox(area)) {
        return false;
    }
    return KEEP_OUT_TYPES.includes(area.type) || area.flags?.no_enter === true;
}

/**
 * True when the block of a position lies in the box of an area (both corners included).
 * @param {{min: object, max: object}} area
 * @param {{x: number, y: number, z: number}} pos
 * @returns {boolean}
 */
export function insideArea(area, pos) {
    if (!isBox(area) || !isPoint(pos)) {
        return false;
    }
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    const z = Math.floor(pos.z);
    return x >= Math.min(area.min.x, area.max.x) && x <= Math.max(area.min.x, area.max.x)
        && y >= Math.min(area.min.y, area.max.y) && y <= Math.max(area.min.y, area.max.y)
        && z >= Math.min(area.min.z, area.max.z) && z <= Math.max(area.min.z, area.max.z);
}

/**
 * The areas a walk that starts at botPos must stay out of: the keep-out areas of the dimension that do
 * not hold the bot. An area that holds the bot is free for it, so the bot can walk out.
 * @param {object[]} areas the areas of the store
 * @param {{x: number, y: number, z: number}} botPos
 * @param {string} [dimension]
 * @returns {object[]}
 */
export function keepOutAreas(areas, botPos, dimension) {
    if (!Array.isArray(areas)) {
        return [];
    }
    const wanted = plainDimension(dimension);
    return areas.filter(area => isKeepOutArea(area) && plainDimension(area.dimension) === wanted
        && !insideArea(area, botPos));
}

/**
 * The first area of the list that holds the position, or null.
 * @param {object[]} areas usually keepOutAreas(...)
 * @param {{x: number, y: number, z: number}} pos
 * @returns {object|null}
 */
export function keptOutBy(areas, pos) {
    if (!Array.isArray(areas)) {
        return null;
    }
    return areas.find(area => insideArea(area, pos)) ?? null;
}

/**
 * The extra cost of a block for the path search: KEEP_OUT_COST for a fence gate and for every block
 * inside one of the areas, else 0. Never throws.
 * @param {{name?: string, position?: object}|null} block
 * @param {object[]} areas usually keepOutAreas(...)
 * @returns {number}
 */
export function stepCost(block, areas) {
    try {
        if (!block) {
            return 0;
        }
        if (isGateName(block.name)) {
            return KEEP_OUT_COST;
        }
        return keptOutBy(areas, block.position) ? KEEP_OUT_COST : 0;
    } catch {
        return 0;
    }
}

/**
 * A function for Movements.exclusionAreasStep of mineflayer-pathfinder (stepCost with the areas).
 * @param {object[]} areas
 * @returns {(block: object) => number}
 */
export function stepCostOf(areas) {
    const list = Array.isArray(areas) ? areas.slice() : [];
    return (block) => stepCost(block, list);
}

/**
 * The name of the item that an item entity carries, or 'item' when it cannot be read. Never throws.
 * @param {object} entity
 * @returns {string}
 */
export function itemNameOf(entity) {
    try {
        const name = entity?.getDroppedItem?.()?.name;
        return typeof name === 'string' && name.length > 0 ? name : 'item';
    } catch {
        return 'item';
    }
}

/**
 * The text when the reflex leaves an item (I6):
 * `I leave the oak_fence in the pen "pen". I do not open its gate.`
 * The word before the name is the type of the area.
 * @param {string} item
 * @param {{name: string, type?: string}} area
 * @returns {string}
 */
export function leaveText(item, area) {
    const type = typeof area?.type === 'string' && area.type.length > 0 ? area.type : 'area';
    return `I leave the ${item || 'item'} in the ${type} "${area?.name ?? ''}". I do not open its gate.`;
}

/**
 * True when the text of leaveText may be said again: never said, or LEAVE_TEXT_MS ago or more.
 * @param {number|null|undefined} saidAt
 * @param {number} now
 * @returns {boolean}
 */
export function mayLeaveText(saidAt, now) {
    return !Number.isFinite(saidAt) || now - saidAt >= LEAVE_TEXT_MS;
}
