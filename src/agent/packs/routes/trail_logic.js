// The rules of the trail (spec v0.1.4.9 I1): when the bot makes a step, what the step holds, which
// openable it passed, and whether it stands under open sky. Pure: the executing part (trail.js) reads
// the world and passes a reader of blocks in.
//
// A step is { x, y, z, on, at, sky, t, via }: the feet cell, the name of the block under the feet and
// at the feet, open sky, the time, and null or the door, gate or trapdoor the bot passed with it.
import { openableKind } from '../home/door_logic.js';

/** The numbers of the trail. */
export const TRAIL_RULES = Object.freeze({
    maxSteps: 500,     // steps kept; the oldest leave
    intervalMs: 250,   // one look at the bot
    saveMs: 5000,      // the file is written at most this often
    skyScan: 64,       // without sky light: blocks of the column above the feet that are looked at
    jump: 16,          // a move this far (sideways or up) between two looks is no walk: the trail starts again
});

/** Blocks whose cell counts as water: the bot swims there, and a step is made. */
export const WATER_NAMES = Object.freeze(['water', 'bubble_column']);

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
}

/**
 * The feet cell of a position: Math.floor of x, y and z.
 * @param {{x: number, y: number, z: number}} pos
 * @returns {{x: number, y: number, z: number}|null}
 */
export function feetCell(pos) {
    return isPoint(pos) ? { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } : null;
}

/**
 * True when two cells are the same.
 * @param {{x,y,z}} a
 * @param {{x,y,z}} b
 * @returns {boolean}
 */
export function sameCell(a, b) {
    return isPoint(a) && isPoint(b) && a.x === b.x && a.y === b.y && a.z === b.z;
}

/**
 * The cell between two cells of consecutive steps: the floor of the middle. For neighbours it is one
 * of the two.
 * @param {{x,y,z}} a
 * @param {{x,y,z}} b
 * @returns {{x: number, y: number, z: number}}
 */
export function cellBetween(a, b) {
    return { x: Math.floor((a.x + b.x) / 2), y: Math.floor((a.y + b.y) / 2), z: Math.floor((a.z + b.z) / 2) };
}

/**
 * True when the bot may make a step: on the ground, on a ladder, or in water. A fall is no step.
 * @param {{onGround?: boolean, at?: string|null, inWater?: boolean}} state
 * @returns {boolean}
 */
export function mayStep(state) {
    return state?.onGround === true || state?.at === 'ladder' || state?.inWater === true || WATER_NAMES.includes(state?.at);
}

/**
 * Open sky over the feet: sky light 15. A sky light of 0 or none at all is read as missing (a server
 * that sends no light gives 0 everywhere, and a cell under open sky never has 0): then the column
 * decides, `columnOpen` (a boolean or a function that returns one) is true when no solid block stands
 * above the feet within 64 blocks.
 * @param {number|undefined} skyLight
 * @param {boolean|(() => boolean)} columnOpen
 * @returns {boolean}
 */
export function isOpenSky(skyLight, columnOpen) {
    if (isFiniteNumber(skyLight) && skyLight > 0) {
        return skyLight >= 15;
    }
    try {
        return (typeof columnOpen === 'function' ? columnOpen() : columnOpen) === true;
    } catch {
        return false;
    }
}

/**
 * True when no solid block stands in the column above the cell within `scan` blocks. A block that is
 * not loaded counts as air (above the loaded world).
 * @param {(x: number, y: number, z: number) => ({solid?: boolean}|null)} getBlock
 * @param {{x,y,z}} cell
 * @param {number} [scan]
 * @returns {boolean}
 */
export function columnIsOpen(getBlock, cell, scan = TRAIL_RULES.skyScan) {
    for (let dy = 1; dy <= scan; dy++) {
        const b = getBlock(cell.x, cell.y + dy, cell.z);
        if (b && b.solid === true) {
            return false;
        }
    }
    return true;
}

// The openable of a cell as { kind, name, x, y, z }, the lower half of a door for its upper half; null.
function openableAt(getBlock, cell) {
    const b = getBlock(cell.x, cell.y, cell.z);
    const kind = openableKind(b?.name);
    if (!kind) {
        return null;
    }
    const y = kind === 'door' && b.half === 'upper' ? cell.y - 1 : cell.y;
    return { kind, name: b.name, x: cell.x, y, z: cell.z };
}

/**
 * The openable the bot passed with a step: a door, gate or trapdoor at the feet cell, at the cell of the
 * last step, or at the cell between them; a trapdoor also directly above or below the feet. null for none.
 * @param {(x: number, y: number, z: number) => ({name: string, half?: string}|null)} getBlock
 * @param {{x,y,z}} feet
 * @param {{x,y,z}|null} last the cell of the last step
 * @returns {{kind: 'door'|'gate'|'trapdoor', name: string, x: number, y: number, z: number}|null}
 */
export function viaOf(getBlock, feet, last = null) {
    const cells = [feet];
    if (isPoint(last) && !sameCell(last, feet)) {
        cells.push(last, cellBetween(last, feet));
    }
    for (const cell of cells) {
        const found = openableAt(getBlock, cell);
        if (found) {
            return found;
        }
    }
    for (const dy of [1, -1]) {
        const found = openableAt(getBlock, { x: feet.x, y: feet.y + dy, z: feet.z });
        if (found && found.kind === 'trapdoor') {
            return found;
        }
    }
    return null;
}

/**
 * True when the bot moved too far between two looks for a walk: more than 16 blocks sideways or up (a
 * teleport, a respawn). A fall down is a walk.
 * @param {{x,y,z}} from
 * @param {{x,y,z}} to
 * @returns {boolean}
 */
export function isJump(from, to) {
    if (!isPoint(from) || !isPoint(to)) {
        return false;
    }
    return Math.hypot(to.x - from.x, to.z - from.z) > TRAIL_RULES.jump || to.y - from.y > TRAIL_RULES.jump;
}

/**
 * The next step of the trail, or null when there is none: the bot is in the cell of the last step, or it
 * is not on the ground, not on a ladder and not in water.
 * @param {object|null} last the last step
 * @param {{pos: {x,y,z}, onGround?: boolean, inWater?: boolean, t?: number}} input the bot now
 * @param {(x: number, y: number, z: number) => ({name: string, solid?: boolean, skyLight?: number, half?: string}|null)} getBlock
 * @returns {{x: number, y: number, z: number, on: string|null, at: string|null, sky: boolean, t: number, via: object|null}|null}
 */
export function nextStep(last, input, getBlock) {
    const feet = feetCell(input?.pos);
    if (!feet || typeof getBlock !== 'function') {
        return null;
    }
    if (last && sameCell(last, feet)) {
        return null;
    }
    const here = getBlock(feet.x, feet.y, feet.z);
    const at = typeof here?.name === 'string' ? here.name : null;
    if (!mayStep({ onGround: input.onGround, inWater: input.inWater, at })) {
        return null;
    }
    const below = getBlock(feet.x, feet.y - 1, feet.z);
    return {
        x: feet.x,
        y: feet.y,
        z: feet.z,
        on: typeof below?.name === 'string' ? below.name : null,
        at,
        sky: isOpenSky(here?.skyLight, () => columnIsOpen(getBlock, feet)),
        t: isFiniteNumber(input.t) ? input.t : Date.now(),
        via: viaOf(getBlock, feet, last && isPoint(last) ? last : null),
    };
}

function cleanVia(via) {
    if (via === null || via === undefined) {
        return null;
    }
    if (typeof via !== 'object' || !['door', 'gate', 'trapdoor'].includes(via.kind) || !isPoint(via)) {
        return undefined;
    }
    return { kind: via.kind, name: typeof via.name === 'string' ? via.name : null, x: Math.floor(via.x), y: Math.floor(via.y), z: Math.floor(via.z) };
}

/**
 * A step as the file keeps it, or null when it is not valid (no finite x, y, z).
 * @param {object} step
 * @returns {object|null}
 */
export function cleanStep(step) {
    if (!isPoint(step)) {
        return null;
    }
    const via = cleanVia(step.via);
    if (via === undefined) {
        return null;
    }
    return {
        x: Math.floor(step.x),
        y: Math.floor(step.y),
        z: Math.floor(step.z),
        on: typeof step.on === 'string' ? step.on : null,
        at: typeof step.at === 'string' ? step.at : null,
        sky: step.sky === true,
        t: isFiniteNumber(step.t) ? step.t : 0,
        via,
    };
}
