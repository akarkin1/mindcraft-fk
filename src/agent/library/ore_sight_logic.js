// Ore in sight for collectBlock (spec v0.1.4.9 C1, setting ore_sense_range). Pure: no imports; the world
// is read through getName(x, y, z), which returns the name of a block, or null for a block that is not
// loaded. The library has its own name test of ores: packs/mining/ore_table.js is not imported, so that
// the rule holds without the mining pack (it is a property of the setting, not of the pack).
//
// ore_sense_range 0: an ore is in sight when one of its 6 faces touches an open cell. 3: when an open
// cell lies within 3 blocks of it (Chebyshev distance, edges and corners count). Open cells are air,
// water, torches, ladders and the cells the caller dug in this call. A cell that is not loaded is rock.

/** The names of the cells an ore is seen through. */
export const OPEN_NAMES = Object.freeze(['air', 'cave_air', 'void_air', 'water', 'flowing_water', 'torch', 'wall_torch',
    'soul_torch', 'soul_wall_torch', 'ladder']);
const OPEN = new Set(OPEN_NAMES);

/** The largest sight range (ore_sense_range is 0 or 3). */
export const MAX_SIGHT_RANGE = 3;

/** The distance of the text "within 16 blocks". */
export const SIGHT_TEXT_DISTANCE = 16;

/** The ores the mining pack mines with !mineOre (packs/mining/ore_table.js, not imported). */
export const MINING_ORES = Object.freeze(['coal', 'copper', 'iron', 'lapis', 'gold', 'redstone', 'diamond']);

const FACES = Object.freeze([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]);

function baseName(name) {
    return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

/**
 * True for the name of an ore block: it ends with `_ore` (also deepslate and nether ores), or it is
 * `ancient_debris`.
 * @param {string} name
 * @returns {boolean}
 */
export function isOreName(name) {
    if (typeof name !== 'string')
        return false;
    const n = baseName(name.trim().toLowerCase());
    return (n.endsWith('_ore') && n.length > '_ore'.length) || n === 'ancient_debris';
}

/**
 * The ore of the mining pack a block drops: `iron_ore` and `deepslate_iron_ore` -> `iron`. null for
 * every other name, also for ores the mining pack does not mine (emerald, the nether ores).
 * @param {string} name
 * @returns {string|null}
 */
export function oreKind(name) {
    if (!isOreName(name))
        return null;
    const n = baseName(name.trim().toLowerCase()).replace(/^deepslate_/, '').replace(/_ore$/, '');
    return MINING_ORES.includes(n) ? n : null;
}

/**
 * The sight range of a value of ore_sense_range: a whole number from 0 to 3. Anything that is not a
 * number, or below 0, is 0; above 3 is 3.
 * @param {*} value
 * @returns {number}
 */
export function sightRange(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
        return 0;
    return Math.min(Math.floor(value), MAX_SIGHT_RANGE);
}

// An open cell: dug in this call, or a block of OPEN. A block that cannot be read is rock.
function isOpen(getName, x, y, z, dug) {
    try {
        if (dug && typeof dug.has === 'function' && dug.has(`${x},${y},${z}`))
            return true;
    } catch {
        // not dug
    }
    let name;
    try {
        name = getName(x, y, z);
    } catch {
        name = null;
    }
    return typeof name === 'string' && OPEN.has(baseName(name));
}

/**
 * True when the ore at pos is in sight. range 0 (ore_sense_range 0): one of the 6 faces touches an
 * open cell. range 1 to 3: an open cell lies within that many blocks (Chebyshev distance); the nearest
 * cells are read first. Open cells: air, cave_air, void_air, water, flowing_water, torch, wall_torch,
 * soul_torch, soul_wall_torch, ladder, and the cells in `dug`. A cell for which getName gives null
 * (not loaded) is rock. The range is read with sightRange. Never throws.
 * @param {Function} getName (x, y, z) => name | null
 * @param {{x: number, y: number, z: number}} pos the ore
 * @param {number} [range] 0 or 3
 * @param {Set<string>|{has: Function}|null} [dug] the cells dug in this call, as "x,y,z"
 * @returns {boolean}
 */
export function oreInSight(getName, pos, range = 0, dug = null) {
    if (typeof getName !== 'function' || !isPoint(pos))
        return false;
    const x = Math.floor(pos.x), y = Math.floor(pos.y), z = Math.floor(pos.z);
    const r = sightRange(range);
    if (r === 0)
        return FACES.some(([dx, dy, dz]) => isOpen(getName, x + dx, y + dy, z + dz, dug));
    for (let d = 1; d <= r; d++) {
        for (let dx = -d; dx <= d; dx++) {
            for (let dy = -d; dy <= d; dy++) {
                for (let dz = -d; dz <= d; dz++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== d)
                        continue; // read in a nearer shell
                    if (isOpen(getName, x + dx, y + dy, z + dz, dug))
                        return true;
                }
            }
        }
    }
    return false;
}

/**
 * The text of collectBlock when every candidate is out of sight (spec C1). With the mining pack on,
 * an ore out of sight within 16 blocks, and that ore one the mining pack mines:
 * `I see no iron_ore. I know that there is some within 16 blocks, but it is inside the rock. Tell me to mine iron and I get it from a mine.`
 * Otherwise: `I see no iron_ore within 16 blocks.`
 * @param {string} blockType the block type collectBlock was asked for
 * @param {{ore?: string|null, near?: boolean, mining?: boolean}} [facts]
 *   ore: oreKind of the ore out of sight; near: one lies within 16 blocks; mining: !mineOre is on
 * @returns {string}
 */
export function outOfSightText(blockType, { ore = null, near = false, mining = false } = {}) {
    const name = typeof blockType === 'string' && blockType !== '' ? blockType : 'ore';
    if (mining === true && near === true && typeof ore === 'string' && MINING_ORES.includes(ore))
        return `I see no ${name}. I know that there is some within ${SIGHT_TEXT_DISTANCE} blocks, but it is inside the rock. Tell me to mine ${ore} and I get it from a mine.`;
    return `I see no ${name} within ${SIGHT_TEXT_DISTANCE} blocks.`;
}
