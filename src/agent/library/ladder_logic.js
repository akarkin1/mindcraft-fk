// A column of ladders near the bot, and whether the follow of a player needs it (spec v0.1.4.9, section 13,
// part L, F14 of the play test: the path search climbs a ladder but never descends one, and it stops in the
// cell of an open trapdoor above a ladder). Pure: no imports; the world is read through
// getName(x, y, z), which returns the name of a block, or an object { name, facing } (the facing of a
// ladder), or null for a block that is not loaded. Never throws.
//
// A column: the ladders in one (x, z) above each other. `top` is the highest ladder, `bottom` the cell the
// bot stands in at its foot: the lowest ladder, or the free cell under it when the column ends one block
// above the floor (the bot jumps to reach it). `facing` is the ladder block's own facing, the open side (the
// `face` of a ladder leg of the mining pack and the routes pack). `trapdoor` is a trapdoor directly above
// the top ladder.

const DIRS = Object.freeze({ north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] });
const AIR = new Set(['air', 'cave_air', 'void_air']);

/** The numbers of the ladder step of the follow. */
export const LADDER_RULES = Object.freeze({
    reach: 2,       // a column whose top or bottom is this near to the feet, horizontally and vertically
    followReach: 6, // followPlayer and goToPlayer: horizontally (fix of W75, L1); vertically `reach`
    maxHeight: 64,  // the longest column that is read
    below: 2,       // the player is this many blocks below the feet or more: down
    above: 2,       // this many above or more: up
    near: 3,        // down: the player is within this many blocks of the column, horizontally
});

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
}

function baseName(name) {
    return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

// { name, facing } of a cell, or null.
function readCell(getName, x, y, z) {
    let r;
    try {
        r = getName(x, y, z);
    } catch {
        return null;
    }
    if (typeof r === 'string') {
        return { name: baseName(r), facing: null };
    }
    if (r && typeof r === 'object' && typeof r.name === 'string') {
        return { name: baseName(r.name), facing: Object.prototype.hasOwnProperty.call(DIRS, r.facing) ? r.facing : null };
    }
    return null;
}

const isLadder = (cell) => cell?.name === 'ladder';

/**
 * The column of ladders near the feet: one whose top or bottom lies within `reach` blocks of the feet
 * horizontally and within `height` blocks vertically (both 2 by default), the nearest first. Also a column the
 * bot is in or beside at any height (fix of W75, L3): when the feet cell or one of its 4 neighbours holds a
 * ladder, that column, whatever the distance to its ends. null when there is none.
 * @param {Function} getName (x, y, z) => name | {name, facing} | null
 * @param {{x: number, y: number, z: number}} feet
 * @param {{reach?: number, height?: number, maxHeight?: number}} [options] height: by default the reach
 * @returns {{x: number, z: number, top: number, bottom: number, facing: string|null, trapdoor: {x: number, y: number, z: number, name: string}|null}|null}
 */
export function ladderColumnAt(getName, feet, { reach = LADDER_RULES.reach, height = reach, maxHeight = LADDER_RULES.maxHeight } = {}) {
    try {
        if (typeof getName !== 'function' || !isPoint(feet)) {
            return null;
        }
        const r = isFiniteNumber(reach) && reach >= 0 ? Math.floor(reach) : LADDER_RULES.reach;
        const hv = isFiniteNumber(height) && height >= 0 ? Math.floor(height) : r;
        const h = isFiniteNumber(maxHeight) && maxHeight >= 1 ? Math.floor(maxHeight) : LADDER_RULES.maxHeight;
        const fx = Math.floor(feet.x), fy = Math.floor(feet.y), fz = Math.floor(feet.z);
        // in the column, or beside it at the height of the feet: that column (L3, the bot hung half way down)
        for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (isLadder(readCell(getName, fx + dx, fy, fz + dz))) {
                return columnFrom(getName, fx + dx, fy, fz + dz, h);
            }
        }
        const found = [];
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                const x = fx + dx, z = fz + dz;
                let seed = null;
                for (let dy = -hv; dy <= hv && seed === null; dy++) {
                    if (isLadder(readCell(getName, x, fy + dy, z))) {
                        seed = fy + dy;
                    }
                }
                if (seed === null) {
                    continue;
                }
                const column = columnFrom(getName, x, seed, z, h);
                if (Math.abs(column.top - fy) <= hv || Math.abs(column.bottom - fy) <= hv) {
                    found.push({ column, d: Math.hypot(dx, dz), v: Math.min(Math.abs(column.top - fy), Math.abs(column.bottom - fy)) });
                }
            }
        }
        found.sort((a, b) => a.d - b.d || a.v - b.v);
        return found.length > 0 ? found[0].column : null;
    } catch {
        return null;
    }
}

// The whole column through the ladder at (x, seed, z), at most maxHeight cells up and down.
function columnFrom(getName, x, seed, z, maxHeight) {
    let top = seed;
    while (top - seed < maxHeight && isLadder(readCell(getName, x, top + 1, z))) {
        top++;
    }
    let low = seed;
    while (seed - low < maxHeight && isLadder(readCell(getName, x, low - 1, z))) {
        low--;
    }
    // the column ends one block above the floor: the bot stands in the free cell under it
    let bottom = low;
    const under = readCell(getName, x, low - 1, z);
    const floor = readCell(getName, x, low - 2, z);
    if (under && AIR.has(under.name) && floor && !AIR.has(floor.name)) {
        bottom = low - 1;
    }
    let facing = null;
    for (let y = top; y >= low && facing === null; y--) {
        facing = readCell(getName, x, y, z)?.facing ?? null;
    }
    // without a facing from the world: guessed at every cell of the column, the top first (in a shaft of 1 x 1
    // only the foot, where it opens into a room, shows the open side; finding T1-L-1)
    for (let y = top; y >= low && facing === null; y--) {
        facing = guessFacing(getName, x, y, z);
    }
    const above = readCell(getName, x, top + 1, z);
    const trapdoor = above && above.name.endsWith('_trapdoor') ? { x, y: top + 1, z, name: above.name } : null;
    return { x, z, top, bottom, facing, trapdoor };
}

// Without a facing from the world, at one cell of the column: the ladders face away from the wall, the side
// that is air when the opposite side is not.
function guessFacing(getName, x, y, z) {
    for (const [dir, [vx, vz]] of Object.entries(DIRS)) {
        const open = readCell(getName, x + vx, y, z + vz);
        const wall = readCell(getName, x - vx, y, z - vz);
        if (open && wall && AIR.has(open.name) && !AIR.has(wall.name)) {
            return dir;
        }
    }
    return null;
}

/**
 * Whether the follow of a player needs the column: 'down' when the target is 2 or more blocks below the
 * feet and within 3 blocks of the column horizontally, and the feet are above the bottom of the column;
 * 'up' when the target is 2 or more blocks above the feet and the feet are below the way out at the top of
 * the column; null otherwise.
 * @param {{x: number, z: number, top: number, bottom: number}|null} column
 * @param {{x: number, y: number, z: number}} feet
 * @param {{x: number, y: number, z: number}} target
 * @returns {'down'|'up'|null}
 */
export function ladderWay(column, feet, target) {
    try {
        if (!column || !isFiniteNumber(column.x) || !isFiniteNumber(column.z) || !isFiniteNumber(column.top)
            || !isFiniteNumber(column.bottom) || !isPoint(feet) || !isPoint(target)) {
            return null;
        }
        const fy = Math.floor(feet.y);
        if (target.y <= feet.y - LADDER_RULES.below) {
            const d = Math.hypot(target.x - (column.x + 0.5), target.z - (column.z + 0.5));
            return d <= LADDER_RULES.near && fy > column.bottom ? 'down' : null;
        }
        if (target.y >= feet.y + LADDER_RULES.above) {
            return fy <= column.top ? 'up' : null;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * The way of goToPlayer (section 13): 'down' when the target is 2 or more blocks below the feet, 'up' when
 * 2 or more above, whatever the distance to the column; with the same bounds as ladderWay (down only above
 * the bottom of the column, up only below its way out). null otherwise.
 * @param {{x: number, z: number, top: number, bottom: number}|null} column
 * @param {{x: number, y: number, z: number}} feet
 * @param {{x: number, y: number, z: number}} target
 * @returns {'down'|'up'|null}
 */
export function heightWay(column, feet, target) {
    try {
        if (!column || !isFiniteNumber(column.top) || !isFiniteNumber(column.bottom) || !isPoint(feet) || !isPoint(target)) {
            return null;
        }
        const fy = Math.floor(feet.y);
        if (target.y <= feet.y - LADDER_RULES.below) {
            return fy > column.bottom ? 'down' : null;
        }
        if (target.y >= feet.y + LADDER_RULES.above) {
            return fy <= column.top ? 'up' : null;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * The cell beside the top of the column where the bot stands before it slides down: on the open side (the
 * facing) at the height of the feet above the top, `top + 2` (the trapdoor or the floor is at `top + 1`).
 * @param {{x: number, z: number, top: number, facing: string|null}} column
 * @returns {{x: number, y: number, z: number}}
 */
export function entryOf(column) {
    const [vx, vz] = DIRS[column.facing] ?? [0, 0];
    return { x: column.x + vx, y: column.top + 2, z: column.z + vz };
}

/**
 * The yaw of mineflayer to look at the wall of the column (against the facing of the ladders).
 * @param {string|null} facing
 * @returns {number}
 */
export function wallYaw(facing) {
    const [vx, vz] = DIRS[facing] ?? [0, 1];
    return Math.atan2(vx, vz); // towards (-vx, -vz): atan2(-dx, -dz) of mineflayer
}

/**
 * The position of the column in texts: `(13, 66, 51)`, the trapdoor over it, else its top ladder.
 * @param {{x: number, z: number, top: number, trapdoor?: object|null}} column
 * @returns {string}
 */
export function ladderPlace(column) {
    const y = column.trapdoor && isFiniteNumber(column.trapdoor.y) ? column.trapdoor.y : column.top;
    return `(${column.x}, ${y}, ${column.z})`;
}
