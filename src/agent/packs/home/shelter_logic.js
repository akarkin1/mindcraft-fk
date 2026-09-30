// The choices of the shelter part (spec v0.1.4.6 H3, v0.1.4.8 C4), pure: which shelter, which
// entrance, where to stand inside, and which block closes the hole of an emergency shelter.
import { hasWalls, isShelterArea } from './area_kinds.js';
import { boxCenter, containsPos, distanceToBox, interiorBox, isBox } from './box_math.js';

export { isShelterArea };

/** The nearest area of type home within this distance is the shelter (v0.1.4.8, C4). */
export const SHELTER_RANGE = 96;
/** The standing place inside is at most this far from the entrance. */
export const STANDING_RANGE = 8;

// Blocks that fall or explode: they never close the hole above the bot's head.
const FALLING_EXACT = new Set(['sand', 'red_sand', 'gravel', 'suspicious_sand', 'suspicious_gravel', 'anvil',
    'chipped_anvil', 'damaged_anvil', 'dragon_egg', 'pointed_dripstone', 'scaffolding', 'tnt']);

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
}

function stripDimension(value) {
    return typeof value === 'string' && value.length > 0 ? value.replace(/^minecraft:/, '') : null;
}

/**
 * True when two dimensions are the same. A missing dimension matches any.
 * @param {string|null} a
 * @param {string|null} b
 * @returns {boolean}
 */
export function sameDimension(a, b) {
    const x = stripDimension(a);
    const y = stripDimension(b);
    return x === null || y === null || x === y;
}

/**
 * True for an area with a valid box that is a building with walls: type `home` (v0.1.4.8), `building`,
 * or not given. Only a `home` is a shelter (see isShelterArea).
 * @param {object} area
 * @returns {boolean}
 */
export function isBuildingArea(area) {
    return hasWalls(area);
}

/**
 * True when the position is inside the walls of the area: x and z within the interior (the
 * box without its margin and walls, see interiorBox), y within the box. The doorway and the
 * place right in front of the door do not count.
 * @param {object} area
 * @param {{x,y,z}} pos
 * @returns {boolean}
 */
export function isInsideArea(area, pos) {
    return isBox(area) && containsPos(interiorBox(area), pos);
}

/**
 * The shelter of the bot (v0.1.4.8, C4): 1. the area of type `home` that holds the place `home`,
 * 2. the nearest area of type `home` within 96 blocks, 3. the place `home`. Never another type: a
 * building, a pen or a mine is no shelter. Areas and the place of another dimension are left out.
 * Without any of them the kind is `emergency` (why `nothing`): the bot knows no home.
 * @param {{areas: object[], home: {x,y,z,dimension}|null, botPos: {x,y,z}, dimension: string, maxDistance?: number}} input
 * @returns {{kind: 'area'|'place'|'emergency', area?: object, place?: object, why: string}}
 */
export function chooseShelter(input) {
    const i = input && typeof input === 'object' ? input : {};
    const dimension = i.dimension ?? null;
    const maxDistance = isFiniteNumber(i.maxDistance) ? i.maxDistance : SHELTER_RANGE;
    const homes = (Array.isArray(i.areas) ? i.areas : [])
        .filter(isShelterArea)
        .filter(area => sameDimension(area.dimension, dimension));
    const home = isPoint(i.home) && sameDimension(i.home.dimension, dimension) ? i.home : null;

    if (home) {
        const around = homes.find(area => containsPos(area, home));
        if (around) {
            return { kind: 'area', area: around, why: 'contains_home' };
        }
    }
    if (isPoint(i.botPos)) {
        let best = null;
        let bestDistance = Infinity;
        for (const area of homes) {
            const d = distanceToBox(area, i.botPos);
            if (d <= maxDistance && d < bestDistance) {
                best = area;
                bestDistance = d;
            }
        }
        if (best) {
            return { kind: 'area', area: best, why: 'nearest' };
        }
    }
    if (home) {
        return { kind: 'place', place: home, why: 'home_place' };
    }
    return { kind: 'emergency', why: 'nothing' };
}

/**
 * The valid entrances of an area, nearest to the bot first.
 * @param {object} area
 * @param {{x,y,z}} botPos
 * @returns {{x,y,z,kind}[]}
 */
export function orderEntrances(area, botPos) {
    const list = Array.isArray(area?.entrances) ? area.entrances.filter(isPoint) : [];
    if (!isPoint(botPos)) {
        return list.map(e => ({ ...e }));
    }
    const d = e => Math.hypot(e.x + 0.5 - botPos.x, e.y - botPos.y, e.z + 0.5 - botPos.z);
    return list.map(e => ({ ...e })).sort((a, b) => d(a) - d(b));
}

/**
 * The free standing place inside that is farthest from the entrance and from the outer walls,
 * at most 8 blocks from the entrance. The score is the smaller of the distance to the entrance
 * and twice the distance to the nearest wall, so the bot stands clear of the doorway without
 * pressing into a corner; ties go to the larger sum, then to the lower x, z, y. Without an
 * entrance: the place farthest from the walls.
 * @param {{area: object, entrance: {x,y,z}|null, isFree: (x: number, y: number, z: number) => boolean,
 *   maxFromEntrance?: number}} input isFree tells whether the bot can stand at that block
 * @returns {{x,y,z}|null}
 */
export function chooseStandingPlace(input) {
    const i = input && typeof input === 'object' ? input : {};
    if (!isBox(i.area) || typeof i.isFree !== 'function') {
        return null;
    }
    const room = interiorBox(i.area);
    const walls = { minX: i.area.min.x + 1, maxX: i.area.max.x - 1, minZ: i.area.min.z + 1, maxZ: i.area.max.z - 1 };
    const entrance = isPoint(i.entrance) ? i.entrance : null;
    const range = isFiniteNumber(i.maxFromEntrance) ? i.maxFromEntrance : STANDING_RANGE;
    let yMin = room.min.y;
    let yMax = room.max.y;
    if (entrance) {
        yMin = Math.max(yMin, entrance.y - 2);
        yMax = Math.min(yMax, entrance.y + 2);
    }
    let best = null;
    for (let x = room.min.x; x <= room.max.x; x++) {
        for (let z = room.min.z; z <= room.max.z; z++) {
            const dWall = Math.min(x - walls.minX, walls.maxX - x, z - walls.minZ, walls.maxZ - z);
            for (let y = yMin; y <= yMax; y++) {
                let dEntrance = 0;
                if (entrance) {
                    dEntrance = Math.hypot(x - entrance.x, y - entrance.y, z - entrance.z);
                    if (dEntrance > range) {
                        continue;
                    }
                }
                let free = false;
                try {
                    free = i.isFree(x, y, z) === true;
                } catch {
                    free = false;
                }
                if (!free) {
                    continue;
                }
                const score = entrance ? Math.min(dEntrance, 2 * dWall) : dWall;
                const sum = dEntrance + dWall;
                if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && sum > best.sum + 1e-9)) {
                    best = { x, y, z, score, sum };
                }
            }
        }
    }
    return best ? { x: best.x, y: best.y, z: best.z } : null;
}

/**
 * True for blocks that fall (sand, gravel, concrete powder, anvils) or explode (tnt).
 * @param {string} name
 * @returns {boolean}
 */
export function isFallingBlockName(name) {
    return typeof name === 'string' && (FALLING_EXACT.has(name) || name.endsWith('_concrete_powder'));
}

/**
 * The block that closes the hole above the bot's head: `dirt`, then `cobblestone`, then any
 * full block that does not fall or explode.
 * @param {string[]} itemNames names of the items in the inventory
 * @param {(name: string) => boolean} [isFullBlock] tells whether an item places a full block
 * @returns {string|null}
 */
export function chooseCoverBlock(itemNames, isFullBlock) {
    if (!Array.isArray(itemNames)) {
        return null;
    }
    const names = itemNames.filter(n => typeof n === 'string');
    for (const preferred of ['dirt', 'cobblestone']) {
        if (names.includes(preferred)) {
            return preferred;
        }
    }
    if (typeof isFullBlock !== 'function') {
        return null;
    }
    for (const name of names) {
        if (isFallingBlockName(name)) {
            continue;
        }
        let full = false;
        try {
            full = isFullBlock(name) === true;
        } catch {
            full = false;
        }
        if (full) {
            return name;
        }
    }
    return null;
}

/**
 * The centre of the room of an area, for a bot that walks in without a known entrance.
 * @param {object} area
 * @returns {{x,y,z}|null}
 */
export function roomCenter(area) {
    return isBox(area) ? boxCenter(interiorBox(area)) : null;
}
