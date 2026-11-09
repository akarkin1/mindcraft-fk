// The open farm (v0.1.4.14, P-18, SPEC 8.2 point 3): the owner's farms have no fence, so `!rememberArea(name, "farm")`
// with no fence saves the farmland around the bot. Pure: it reads blocks through getBlockName and never throws.

/** How far from the bot the farmland of an open farm is looked for and followed, in blocks (horizontal). */
export const OPEN_FARM_RANGE = 24;
/** The margin of the box of an open farm around its field, in x and z. */
export const OPEN_FARM_MARGIN = 1;
/** The height of the box of an open farm above the lowest ground of its field (the ground and the crops). */
export const OPEN_FARM_HEIGHT = 2;

// The levels around the bot where farmland is looked for: from 6 below its feet to 3 above.
const BELOW = 6;
const ABOVE = 3;
// At most this many cells are followed (a field of 64 x 64).
const MAX_CELLS = 4096;
// The ground of a field besides the farmland: water and paths, when they lie among the farmland.
const AMONG = new Set(['water', 'dirt_path']);

function baseName(name) {
    return typeof name === 'string' ? name.replace(/^minecraft:/, '') : null;
}

function reader(getBlockName) {
    const cache = new Map();
    return (x, y, z) => {
        const k = `${x},${y},${z}`;
        if (!cache.has(k)) {
            let name = null;
            try {
                name = baseName(getBlockName(x, y, z));
            } catch {
                name = null;
            }
            cache.set(k, name);
        }
        return cache.get(k);
    };
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && [p.x, p.y, p.z].every(n => typeof n === 'number' && Number.isFinite(n));
}

// Farmland within 1 block (sideways and diagonally, one level up or down) of the cell.
function besideFarmland(read, x, y, z) {
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            for (let dy = -1; dy <= 1; dy++) {
                if ((dx !== 0 || dz !== 0) && read(x + dx, y + dy, z + dz) === 'farmland') {
                    return true;
                }
            }
        }
    }
    return false;
}

/**
 * The open farm at the bot: the farmland nearest to the bot within OPEN_FARM_RANGE blocks and all farmland connected to
 * it (sideways, one level up or down), with the water and the paths among it (a water or path cell beside farmland),
 * within the range; its box with a margin of 1 in x and z, from the lowest ground of the field to 2 above the highest
 * (min.y is the ground, the crops stand above it), and `field`, the extent of the field itself (its farmland, water and
 * paths, without the margin). `found` false without farmland.
 * @param {(x: number, y: number, z: number) => string|null} getBlockName
 * @param {{x: number, y: number, z: number}} origin the bot's position
 * @returns {{found: boolean, field?: {min: {x,y,z}, max: {x,y,z}}, min?: {x,y,z}, max?: {x,y,z}, farmland?: number, cells?: number}}
 */
export function findOpenFarm(getBlockName, origin) {
    try {
        if (typeof getBlockName !== 'function' || !isPoint(origin)) {
            return { found: false };
        }
        const read = reader(getBlockName);
        const o = { x: Math.floor(origin.x), y: Math.floor(origin.y), z: Math.floor(origin.z) };
        const inRange = (x, z) => Math.hypot(x + 0.5 - origin.x, z + 0.5 - origin.z) <= OPEN_FARM_RANGE;
        let start = null;
        let best = Infinity;
        for (let dx = -OPEN_FARM_RANGE; dx <= OPEN_FARM_RANGE; dx++) {
            for (let dz = -OPEN_FARM_RANGE; dz <= OPEN_FARM_RANGE; dz++) {
                const x = o.x + dx;
                const z = o.z + dz;
                if (!inRange(x, z)) {
                    continue;
                }
                for (let y = o.y - BELOW; y <= o.y + ABOVE; y++) {
                    if (read(x, y, z) === 'farmland') {
                        const d = Math.hypot(x + 0.5 - origin.x, y - origin.y, z + 0.5 - origin.z);
                        if (d < best) {
                            best = d;
                            start = { x, y, z };
                        }
                    }
                }
            }
        }
        if (!start) {
            return { found: false };
        }
        const seen = new Set([`${start.x},${start.y},${start.z}`]);
        const queue = [start];
        const cells = [];
        let farmland = 0;
        while (queue.length > 0 && cells.length < MAX_CELLS) {
            const c = queue.shift();
            cells.push(c);
            if (read(c.x, c.y, c.z) === 'farmland') {
                farmland++;
            }
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                for (const dy of [0, -1, 1]) {
                    const n = { x: c.x + dx, y: c.y + dy, z: c.z + dz };
                    const k = `${n.x},${n.y},${n.z}`;
                    if (seen.has(k) || !inRange(n.x, n.z)) {
                        continue;
                    }
                    const name = read(n.x, n.y, n.z);
                    if (name === 'farmland' || (AMONG.has(name) && besideFarmland(read, n.x, n.y, n.z))) {
                        seen.add(k);
                        queue.push(n);
                        break;
                    }
                }
            }
        }
        const xs = cells.map(c => c.x);
        const ys = cells.map(c => c.y);
        const zs = cells.map(c => c.z);
        return {
            found: true,
            field: { min: { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) }, max: { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) } },
            min: { x: Math.min(...xs) - OPEN_FARM_MARGIN, y: Math.min(...ys), z: Math.min(...zs) - OPEN_FARM_MARGIN },
            max: { x: Math.max(...xs) + OPEN_FARM_MARGIN, y: Math.max(...ys) + OPEN_FARM_HEIGHT, z: Math.max(...zs) + OPEN_FARM_MARGIN },
            farmland,
            cells: cells.length,
        };
    } catch {
        return { found: false };
    }
}
