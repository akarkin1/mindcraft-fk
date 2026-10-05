// What the item reflex leaves alone (spec v0.1.4.10, R1 and R2). Pure: no imports.
//
// A walk of the mode item_collecting never goes through a fence gate, and never into an area of type
// pen or farm, or an area with the flag no_enter, while the bot is outside that area. An item that lies
// inside such an area is left there, with a text at most once a minute.
// v0.1.4.11 (I5): also an area of the kind pen, and an area whose contents hold animals and which has a gate.

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

// v0.1.4.11 (I5): animals in the counted contents of an area
function holdsAnimals(area) {
    const animals = area.contents?.animals;
    if (animals === null || typeof animals !== 'object') {
        return false;
    }
    return Object.values(animals).some(n => Number.isFinite(n) && n > 0);
}

function hasGate(area) {
    return Array.isArray(area.entrances) && area.entrances.some(e => e?.kind === 'gate');
}

/**
 * True for an area that the reflex does not enter from outside: type pen or farm, or the flag no_enter.
 * v0.1.4.11 (I5), by the facts: also the kind pen, and an area with animals in its contents and an opening of kind gate.
 * v0.1.4.13 (Q8): also the kind farm; an enclosure the scan finds as a pen with animals (penArea) holds by the facts.
 * @param {object} area
 * @returns {boolean}
 */
export function isKeepOutArea(area) {
    if (!isBox(area)) {
        return false;
    }
    return KEEP_OUT_TYPES.includes(area.type) || KEEP_OUT_TYPES.includes(area.kind) || (holdsAnimals(area) && hasGate(area))
        || area.flags?.no_enter === true;
}

// --- the pen and its gate (v0.1.4.13, part Q, SPEC 4.6 Q8) ---------------------------------------------------------

/** The numbers of Q8. */
export const PEN_RULES = Object.freeze({
    range: 8,          // an unsaved pen counts for the item reflex when the bot is within this many blocks of its gate
    allowRange: 16,    // "open the pen" (!allowChanges) looks for an unsaved pen within this many blocks
    cacheMs: 10000,    // the scan behind a gate is kept this long
    sayMs: 60000,      // the pen text at most once in this many ms
    permitMinutes: 10, // "open the pen" without minutes
});

/**
 * True for a saved area whose gate the walks keep closed (Q8): a pen by its type or kind, or an area with animals and a
 * gate. A farm is no such area (the farming pack walks in through its gate), nor an area only marked no_enter.
 * @param {object} area
 * @returns {boolean}
 */
export function isPenArea(area) {
    if (!isBox(area)) {
        return false;
    }
    return area.type === 'pen' || area.kind === 'pen' || (holdsAnimals(area) && hasGate(area));
}

/**
 * The saved pen whose fence holds a gate (Q8): the first pen area (isPenArea) of the dimension whose box, widened by one
 * block in x and z, holds the cell of the gate; null for none.
 * @param {object[]} areas
 * @param {{x: number, y: number, z: number}} gate
 * @param {string} [dimension]
 * @returns {object|null}
 */
export function savedPenOf(areas, gate, dimension) {
    if (!Array.isArray(areas) || !isPoint(gate)) {
        return null;
    }
    const wanted = plainDimension(dimension);
    return areas.find(area => isPenArea(area) && plainDimension(area.dimension) === wanted && insideArea({
        min: { x: Math.min(area.min.x, area.max.x) - 1, y: Math.min(area.min.y, area.max.y), z: Math.min(area.min.z, area.max.z) - 1 },
        max: { x: Math.max(area.min.x, area.max.x) + 1, y: Math.max(area.min.y, area.max.y), z: Math.max(area.min.z, area.max.z) + 1 },
    }, gate)) ?? null;
}

// The plural of an animal: `chickens`, `sheep`.
const SAME_PLURAL = new Set(['sheep', 'fish', 'cod', 'salmon', 'axolotl_bucket']);
function animalWords(name, n) {
    const word = String(name).replace(/^minecraft:/, '').replace(/_/g, ' ');
    if (n === 1 || SAME_PLURAL.has(word)) {
        return `${n} ${word}`;
    }
    return `${n} ${word.endsWith('s') || word.endsWith('x') ? `${word}es` : `${word}s`}`;
}

/**
 * The animals of a pen as words, the most first: `26 chickens`, `6 chickens and 1 cow`, `4 sheep, 2 pigs and 1 cow`.
 * @param {Object<string, number>} animals
 * @returns {string}
 */
export function penAnimalsText(animals) {
    const parts = Object.entries(animals && typeof animals === 'object' ? animals : {})
        .filter(([, n]) => Number.isFinite(n) && n > 0)
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .map(([name, n]) => animalWords(name, Math.floor(n)));
    if (parts.length <= 1) {
        return parts.join('') || 'animals';
    }
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * Q8, word for word: `That is a pen with 26 chickens; I do not open its gate. Say "open the pen" if you mean it.`
 * @param {Object<string, number>} animals
 * @returns {string}
 */
export function penText(animals) {
    return `That is a pen with ${penAnimalsText(animals)}; I do not open its gate. Say "open the pen" if you mean it.`;
}

/**
 * Q8, within the minute after the pen text: `I do not open the gate of the pen at (0, 64, -3).`
 * @param {{x: number, y: number, z: number}} gate
 * @returns {string}
 */
export function penAgainText(gate) {
    return `I do not open the gate of the pen at (${Math.floor(gate?.x)}, ${Math.floor(gate?.y)}, ${Math.floor(gate?.z)}).`;
}

/**
 * The answer of "open the pen" for an unsaved pen (`!allowChanges("pen")`, Q8 and the handoff): `I may open the gate of
 * the pen with 6 chickens at (0, 64, -3) for 10 minutes. I close it behind me.`
 * @param {Object<string, number>} animals
 * @param {{x: number, y: number, z: number}} gate
 * @param {number} minutes
 * @returns {string}
 */
export function penAllowedText(animals, gate, minutes) {
    return `I may open the gate of the pen with ${penAnimalsText(animals)} at (${gate.x}, ${gate.y}, ${gate.z}) for ${minutes} minutes. `
        + 'I close it behind me.';
}

/**
 * The answer of "open the pen" when no area of that name is saved and no pen with animals is near (Q8).
 * @param {string} name
 * @returns {string}
 */
export function noPenText(name) {
    return `No area named "${name}" is saved, and I see no pen with animals within ${PEN_RULES.allowRange} blocks.`;
}

/**
 * True when a name of !allowChanges means an unsaved pen (the handoff of round 1): the kind word "pen", or a name of
 * a few words with the word pen in it ("the pen", "chicken pen", "fenced pen" as the sense says it).
 * @param {string} name
 * @returns {boolean}
 */
export function isPenWord(name) {
    if (typeof name !== 'string') {
        return false;
    }
    const words = name.trim().toLowerCase().split(/[\s_]+/).filter(Boolean);
    return words.length > 0 && words.length <= 4 && words.includes('pen');
}

/**
 * The key of a pen for its permit: the cell of its gate.
 * @param {{x: number, y: number, z: number}} gate
 * @returns {string}
 */
export function penKey(gate) {
    return isPoint(gate) ? `${Math.floor(gate.x)},${Math.floor(gate.y)},${Math.floor(gate.z)}` : '';
}

/**
 * True when the text of the pen may be said again: never said, or 60 s ago or more.
 * @param {number|null|undefined} saidAt
 * @param {number} now
 * @returns {boolean}
 */
export function mayPenText(saidAt, now) {
    return !Number.isFinite(saidAt) || now - saidAt >= PEN_RULES.sayMs;
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
 * The word before the name is the kind of the area (v0.1.4.11), else its type.
 * @param {string} item
 * @param {{name: string, type?: string, kind?: string}} area
 * @returns {string}
 */
export function leaveText(item, area) {
    const word = typeof area?.kind === 'string' && area.kind.length > 0 ? area.kind : area?.type;
    const type = typeof word === 'string' && word.length > 0 ? word : 'area';
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
