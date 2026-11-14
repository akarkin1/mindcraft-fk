// The decisions of the breeding pack (spec v0.1.4.16, 8.2, E6), pure: the feed of a species, the species of a pen, the
// cap, the stand ring outside the fence, the gates to keep away from, the adults in reach and the new babies. No
// mineflayer, no src/agent/library, no other pack. Every function here never throws for a missing argument.
import { expandBox, isBox } from '../home/box_math.js';

/** The feed of the species the pack breeds: the first item is the one it prefers, the others feed the species too. */
export const FEED = Object.freeze({
    cow: Object.freeze(['wheat']),
    sheep: Object.freeze(['wheat']),
    mooshroom: Object.freeze(['wheat']),
    pig: Object.freeze(['carrot', 'potato', 'beetroot']),
    chicken: Object.freeze(['wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds']),
    rabbit: Object.freeze(['carrot', 'dandelion']),
});

/** Adults plus babies in the box at or above this: the pen is full (the spec's constant, no setting). */
export const PEN_CAP = 12;
/** Blocks from the bot's eyes to an animal it can feed. */
export const FEED_REACH = 3;
/** The game's breeding cooldown of a fed adult. */
export const BREED_COOLDOWN_MS = 300000;
/** During the cooldown the young are counted every this many ms (the spec's 15 s). */
export const COOLDOWN_CHECK_MS = 15000;
/** Every wait of the pack looks at the owner's stop this often: the action manager kills a process whose action has not
 *  ended 10 s after a stop, so no wait may be longer than this (the spec's 15 s steps would be). */
export const STOP_CHECK_MS = 500;
/** After a round with feeds, the young are awaited this long before the next decision (two in love find each other). */
export const BABY_WAIT_MS = 15000;
/** The game's cooldown starts at the birth, a few seconds after the feed; the next round waits this much longer. */
export const COOLDOWN_MARGIN_MS = 5000;
/** At a stand cell the bot waits this long for an adult to come within reach. */
export const COME_WAIT_MS = 10000;
/** After the first round of feeding, at most this many rounds more. */
export const EXTRA_ROUNDS = 2;
/** The eyes of a standing bot above its feet. */
export const EYE_HEIGHT = 1.62;
/** Blocks whose name ends so form a fence ring: fences, their gates and walls (the rule of scanPen). */
export const FENCE_ENDINGS = Object.freeze(['_fence', '_fence_gate', '_wall']);

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function plainName(name) {
    return typeof name === 'string' ? name.replace(/^minecraft:/, '') : '';
}

/**
 * The feed of a species, the preferred one first; null for a species the pack does not breed.
 * @param {string} species the entity name, `minecraft:` and case do not matter
 * @returns {string[]|null}
 */
export function feedOf(species) {
    const name = plainName(species).toLowerCase();
    return Object.prototype.hasOwnProperty.call(FEED, name) ? [...FEED[name]] : null;
}

/**
 * The species of a pen: the key of `contents.animals` with the most animals (ties by name); null without animals.
 * @param {{animals?: Object<string, number>}|null} contents the saved contents of the area, or the live count
 * @returns {string|null}
 */
export function speciesOf(contents) {
    const animals = contents && typeof contents === 'object' && contents.animals && typeof contents.animals === 'object' ? contents.animals : {};
    const entries = Object.entries(animals).filter(([, n]) => isFiniteNumber(n) && n > 0)
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return entries.length > 0 ? plainName(entries[0][0]) : null;
}

/**
 * How many animals a count of animals holds: the sum over the species.
 * @param {{animals?: Object<string, number>}|null} contents
 * @returns {number}
 */
export function animalCount(contents) {
    const animals = contents && typeof contents === 'object' && contents.animals && typeof contents.animals === 'object' ? contents.animals : {};
    return Object.values(animals).filter(isFiniteNumber).reduce((sum, n) => sum + Math.max(0, Math.floor(n)), 0);
}

/**
 * The count of an order as the pack takes it: a whole number of 1 or more, 2 without one.
 * @param {*} value
 * @returns {number}
 */
export function cleanCount(value) {
    const n = typeof value === 'string' ? Number.parseInt(value, 10) : value;
    return isFiniteNumber(n) && n >= 1 ? Math.floor(n) : 2;
}

/**
 * The feed for an order: two per pair, one pair per new animal.
 * @param {number} count the new animals wanted
 * @returns {number}
 */
export function feedNeeded(count) {
    return 2 * cleanCount(count);
}

/**
 * The low mark of the stock for an order (8.1): the feed of one more round, two rounds in all.
 * @param {number} count
 * @returns {number}
 */
export function lowMark(count) {
    return 4 * cleanCount(count);
}

/**
 * True for a baby: the ageable flag of the entity's metadata (index 16, as mcdata.isHuntable reads it).
 * @param {object} entity
 * @returns {boolean}
 */
export function isBaby(entity) {
    const flag = entity?.metadata?.[16];
    return flag === true || flag === 1;
}

/**
 * The eyes of the bot: its feet 1.62 blocks up.
 * @param {{x: number, y: number, z: number}|null} feet
 * @returns {{x: number, y: number, z: number}|null}
 */
export function eyesOf(feet) {
    if (!feet || !isFiniteNumber(feet.x) || !isFiniteNumber(feet.y) || !isFiniteNumber(feet.z)) {
        return null;
    }
    return { x: feet.x, y: feet.y + EYE_HEIGHT, z: feet.z };
}

/**
 * True when the block of a position lies in the box (x, y and z).
 * @param {object} box
 * @param {{x: number, y: number, z: number}} pos
 * @returns {boolean}
 */
export function insideBox(box, pos) {
    if (!isBox(box) || !pos || !isFiniteNumber(pos.x) || !isFiniteNumber(pos.y) || !isFiniteNumber(pos.z)) {
        return false;
    }
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    const z = Math.floor(pos.z);
    return x >= box.min.x && x <= box.max.x && y >= box.min.y && y <= box.max.y && z >= box.min.z && z <= box.max.z;
}

/**
 * True when the block of a position lies in the box in x and z, whatever its height.
 * @param {object} box
 * @param {{x: number, z: number}} pos
 * @returns {boolean}
 */
export function insideBoxXZ(box, pos) {
    if (!isBox(box) || !pos || !isFiniteNumber(pos.x) || !isFiniteNumber(pos.z)) {
        return false;
    }
    const x = Math.floor(pos.x);
    const z = Math.floor(pos.z);
    return x >= box.min.x && x <= box.max.x && z >= box.min.z && z <= box.max.z;
}

/**
 * True for a block of a fence ring: a fence, a fence gate or a wall.
 * @param {string} name
 * @returns {boolean}
 */
export function isFenceName(name) {
    const n = plainName(name);
    return n.length > 0 && FENCE_ENDINGS.some(ending => n.endsWith(ending));
}

// The x/z cells of the border of a box.
function borderCells(box) {
    const cells = [];
    for (let x = box.min.x; x <= box.max.x; x++) {
        for (let z = box.min.z; z <= box.max.z; z++) {
            if (x === box.min.x || x === box.max.x || z === box.min.z || z === box.max.z) {
                cells.push({ x, z });
            }
        }
    }
    return cells;
}

// How many cells of the border of the box hold a fence block somewhere in its height.
function fenceCellsOf(getBlock, box) {
    let fenced = 0;
    for (const c of borderCells(box)) {
        for (let y = box.min.y; y <= box.max.y; y++) {
            let name = null;
            try {
                name = getBlock(c.x, y, c.z)?.name ?? null;
            } catch {
                name = null;
            }
            if (isFenceName(name)) {
                fenced++;
                break;
            }
        }
    }
    return fenced;
}

/**
 * The box whose border is the fence ring of a pen. A saved pen's box holds the fence (scanPen: "min and max cover the
 * cells and the fence around them"), so it is the box itself when half or more of its border cells hold a fence block;
 * else the box grown by one (a box of the cells inside the fence, the spec's reading of 8.2). Without a block reader the
 * box is taken to hold the fence. Never throws.
 * @param {((x: number, y: number, z: number) => ({name: string}|null))|null} getBlock
 * @param {{min: {x, y, z}, max: {x, y, z}}} box the area box
 * @returns {object|null} null for an invalid box
 */
export function fenceBoxOf(getBlock, box) {
    if (!isBox(box)) {
        return null;
    }
    if (typeof getBlock !== 'function') {
        return { min: { ...box.min }, max: { ...box.max } };
    }
    const own = borderCells(box).length;
    if (own > 0 && fenceCellsOf(getBlock, box) * 2 >= own) {
        return { min: { ...box.min }, max: { ...box.max } };
    }
    const grown = expandBox(box, 1);
    const ring = grown ? { min: { x: grown.min.x, y: box.min.y, z: grown.min.z }, max: { x: grown.max.x, y: box.max.y, z: grown.max.z } } : null;
    if (ring && fenceCellsOf(getBlock, ring) * 2 >= borderCells(ring).length) {
        return ring;
    }
    return { min: { ...box.min }, max: { ...box.max } };
}

/**
 * The stand cells: the ring one block outside the fence ring, as x/z cells in the order of a walk around the pen
 * (clockwise from the north-west corner), so that the next cell is always a neighbour of the one before.
 * @param {{min: {x, z}, max: {x, z}}} fenceBox the box whose border is the fence (fenceBoxOf)
 * @returns {{x: number, z: number}[]}
 */
export function standRing(fenceBox) {
    if (!fenceBox || !fenceBox.min || !fenceBox.max || ![fenceBox.min.x, fenceBox.min.z, fenceBox.max.x, fenceBox.max.z].every(isFiniteNumber)) {
        return [];
    }
    const x0 = Math.floor(fenceBox.min.x) - 1;
    const x1 = Math.floor(fenceBox.max.x) + 1;
    const z0 = Math.floor(fenceBox.min.z) - 1;
    const z1 = Math.floor(fenceBox.max.z) + 1;
    const ring = [];
    for (let x = x0; x <= x1; x++) ring.push({ x, z: z0 });
    for (let z = z0 + 1; z <= z1; z++) ring.push({ x: x1, z });
    for (let x = x1 - 1; x >= x0; x--) ring.push({ x, z: z1 });
    for (let z = z1 - 1; z > z0; z--) ring.push({ x: x0, z });
    return ring;
}

/**
 * The ring without the gate cells and the cells before a gate: a cell with the x/z of a gate, or next to it (the four
 * neighbours; on the ring that is the cell straight before the gate).
 * @param {{x: number, z: number}[]} ring
 * @param {{x: number, z: number}[]} gates
 * @returns {{x: number, z: number}[]}
 */
export function withoutGateCells(ring, gates) {
    const list = Array.isArray(gates) ? gates.filter(g => g && isFiniteNumber(g.x) && isFiniteNumber(g.z)) : [];
    return (Array.isArray(ring) ? ring : []).filter(c => !list.some(g => Math.abs(g.x - c.x) + Math.abs(g.z - c.z) <= 1));
}

/**
 * The ring starting at the cell nearest to a position, then on around the ring.
 * @param {{x: number, z: number}[]} ring
 * @param {{x: number, z: number}|null} from
 * @returns {{x: number, z: number}[]}
 */
export function ringFrom(ring, from) {
    const list = Array.isArray(ring) ? ring : [];
    if (list.length === 0 || !from || !isFiniteNumber(from.x) || !isFiniteNumber(from.z)) {
        return [...list];
    }
    let best = 0;
    let bestD = Infinity;
    list.forEach((c, i) => {
        const d = Math.hypot(c.x + 0.5 - from.x, c.z + 0.5 - from.z);
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    });
    return [...list.slice(best), ...list.slice(0, best)];
}

/**
 * The fence gates around a box: blocks whose name ends with `_fence_gate` on the ring one block outside the box, from the
 * bottom of the box to 2 blocks above its top. A copy of findGates of the farming pack (field_logic.js), as a pack never
 * imports another one statically (the switch rule; xy_breeding_logic pins the copy to the original). Never throws.
 * @param {(x: number, y: number, z: number) => ({name: string}|null)} getBlock
 * @param {{min: {x,y,z}, max: {x,y,z}}} box
 * @returns {{x: number, y: number, z: number, kind: 'gate'}[]} sorted by x, z, y
 */
export function findGates(getBlock, box) {
    if (typeof getBlock !== 'function' || !isBox(box)) {
        return [];
    }
    const gates = [];
    const x0 = box.min.x - 1;
    const x1 = box.max.x + 1;
    const z0 = box.min.z - 1;
    const z1 = box.max.z + 1;
    try {
        for (let x = x0; x <= x1; x++) {
            for (let z = z0; z <= z1; z++) {
                if (x !== x0 && x !== x1 && z !== z0 && z !== z1) {
                    continue;
                }
                for (let y = box.min.y; y <= box.max.y + 2; y++) {
                    const name = getBlock(x, y, z)?.name;
                    if (typeof name === 'string' && name.endsWith('_fence_gate')) {
                        gates.push({ x, y, z, kind: 'gate' });
                    }
                }
            }
        }
    } catch {
        return [];
    }
    return gates.sort((a, b) => a.x - b.x || a.z - b.z || a.y - b.y);
}

/**
 * The gates of a saved pen: its entrances of the kind gate.
 * @param {{entrances?: object[]}|null} area
 * @returns {{x: number, y: number, z: number}[]}
 */
export function gatesOf(area) {
    const list = Array.isArray(area?.entrances) ? area.entrances : [];
    return list.filter(e => e && e.kind === 'gate' && isFiniteNumber(e.x) && isFiniteNumber(e.z)).map(e => ({ x: e.x, y: e.y, z: e.z }));
}

function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * The animals of a species inside the box, from the entities of the bot.
 * @param {object} entities bot.entities
 * @param {object} box
 * @param {string} species
 * @returns {object[]}
 */
export function animalsIn(entities, box, species) {
    const wanted = plainName(species);
    const out = [];
    for (const entity of Object.values(entities ?? {})) {
        if (!entity || !entity.position || plainName(entity.name) !== wanted) {
            continue;
        }
        if (insideBox(box, entity.position)) {
            out.push(entity);
        }
    }
    return out;
}

/**
 * The adults of the species the pack may feed: inside the box, not babies, not fed within the cooldown; with `only` just
 * those ids (the animals of the start: a calf born meanwhile shows as an adult until its metadata arrives), without the ids
 * of `skip` (the ones that did not come this round).
 * @param {object} entities bot.entities
 * @param {object} box the pen
 * @param {string} species
 * @param {{fedAt?: Map<number, number>, now?: number, cooldownMs?: number, only?: Set<number>|null, skip?: Set<number>|null}} [options]
 * @returns {object[]}
 */
export function feedableAdults(entities, box, species, options = {}) {
    const cooldown = isFiniteNumber(options.cooldownMs) ? options.cooldownMs : BREED_COOLDOWN_MS;
    const fedAt = options.fedAt instanceof Map ? options.fedAt : new Map();
    const now = isFiniteNumber(options.now) ? options.now : 0;
    const only = options.only instanceof Set ? options.only : null;
    const skip = options.skip instanceof Set ? options.skip : null;
    return animalsIn(entities, box, species)
        .filter(e => !isBaby(e))
        .filter(e => only === null || only.has(e.id))
        .filter(e => skip === null || !skip.has(e.id))
        .filter(e => !(fedAt.has(e.id) && now - fedAt.get(e.id) < cooldown));
}

/**
 * The adults of the species that the bot can feed from where it stands: feedableAdults within reach of the eyes (to the middle
 * of the body, half a block above the feet); the nearest first.
 * @param {object} entities bot.entities
 * @param {object} box the pen
 * @param {string} species
 * @param {{x: number, y: number, z: number}|null} eyes
 * @param {{reach?: number, fedAt?: Map<number, number>, now?: number, cooldownMs?: number, only?: Set<number>|null, skip?: Set<number>|null}} [options]
 * @returns {object[]}
 */
export function adultsInReach(entities, box, species, eyes, options = {}) {
    if (!eyes) {
        return [];
    }
    const reach = isFiniteNumber(options.reach) ? options.reach : FEED_REACH;
    return feedableAdults(entities, box, species, options)
        .map(e => ({ e, d: distance(eyes, { x: e.position.x, y: e.position.y + 0.5, z: e.position.z }) }))
        .filter(({ d }) => d <= reach)
        .sort((a, b) => a.d - b.d)
        .map(({ e }) => e);
}

/**
 * The stand cell of the ring nearest to a position (x/z, to the middle of the cell); ties by the order of the ring.
 * @param {{x: number, z: number}[]} ring
 * @param {{x: number, z: number}|null} pos
 * @returns {{x: number, z: number}|null}
 */
export function nearestRingCell(ring, pos) {
    const list = Array.isArray(ring) ? ring : [];
    if (list.length === 0 || !pos || !isFiniteNumber(pos.x) || !isFiniteNumber(pos.z)) {
        return null;
    }
    let best = null;
    let bestD = Infinity;
    for (const c of list) {
        const d = Math.hypot(c.x + 0.5 - pos.x, c.z + 0.5 - pos.z);
        if (d < bestD) {
            bestD = d;
            best = c;
        }
    }
    return best ? { x: best.x, z: best.z } : null;
}

/**
 * The babies of the species inside the box whose entity ids are not among the known ones (the animals at the start).
 * @param {object} entities bot.entities
 * @param {object} box
 * @param {string} species
 * @param {Set<number>} knownIds
 * @returns {object[]}
 */
export function newBabies(entities, box, species, knownIds) {
    const known = knownIds instanceof Set ? knownIds : new Set();
    return animalsIn(entities, box, species).filter(e => isBaby(e) && !known.has(e.id));
}
