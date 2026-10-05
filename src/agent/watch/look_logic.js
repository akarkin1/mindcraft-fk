// v0.1.4.13 (part S): the look tool (spec 4.1), pure over a block reader. The reader gives the block at a cell
// and the entities around; lookAround scans the box around the bot, nearest layers first, at most 65,536
// blocks, and returns one line per kind, nearest first, at most 5 of each kind, in the order of the spec:
// Ores, Lava, Water, Chests, Furnaces, Ladders, Doors and gates, Drops, Players. Lava and Water are always
// said. Nothing here throws.
import { TEXTS } from './texts.js';
import { distance, posText } from './events_logic.js';

export const LOOK_RULES = Object.freeze({
    radiusMin: 4,
    radiusMax: 32,
    radiusDefault: 16,
    blocksMax: 65536,   // blocks read at most
    perKind: 5,         // entries per line
    veinRange: 2,       // ore blocks within this many blocks of the nearest one count as one vein
});

export const CHEST_BLOCKS = Object.freeze(['chest', 'trapped_chest', 'barrel']);
export const FURNACE_BLOCKS = Object.freeze(['furnace', 'blast_furnace', 'smoker']);

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
}

function compareNames(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}

/** The radius of a look: an integer 4 to 32, 16 without a value; null for anything else. */
export function lookRadius(value) {
    if (value === undefined || value === null || value === '')
        return LOOK_RULES.radiusDefault;
    const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
    if (!Number.isInteger(n) || n < LOOK_RULES.radiusMin || n > LOOK_RULES.radiusMax)
        return null;
    return n;
}

/** True for an ore block. */
export function isOre(name) {
    return typeof name === 'string' && (name.endsWith('_ore') || name === 'ancient_debris');
}

/** True for a door, a fence gate or a trapdoor. */
export function isDoorOrGate(name) {
    return typeof name === 'string' && (name.endsWith('_door') || name.endsWith('_fence_gate') || name.endsWith('_trapdoor'));
}

function propertiesOf(block) {
    try {
        if (typeof block?.getProperties === 'function')
            return block.getProperties() ?? {};
        return block?._properties ?? block?.properties ?? {};
    } catch {
        return {};
    }
}

/** `open` or `closed` from the properties of a door block. */
export function doorState(block) {
    const props = propertiesOf(block);
    const open = props?.open;
    return open === true || open === 'true' ? 'open' : 'closed';
}

/**
 * The layers of the scan, nearest the bot's level first: 0, 1, -1, 2, -2, ... up to `half` up and down.
 * @param {number} half
 * @returns {number[]}
 */
export function layerOrder(half) {
    const out = [0];
    for (let i = 1; i <= half; i++)
        out.push(i, -i);
    return out;
}

/**
 * Scans the box around the center: x and z within the radius, the layers from the bot's level outward
 * (up to radius / 2 up and down), until 65,536 blocks are read.
 * @param {{blockAt: (x: number, y: number, z: number) => object|null}} reader
 * @param {{x, y, z}} center the cell of the bot
 * @param {number} radius
 * @param {(block: object, x: number, y: number, z: number, d: number) => void} visit
 * @returns {number} blocks read
 */
export function scanBox(reader, center, radius, visit) {
    if (!isPoint(center) || typeof reader?.blockAt !== 'function')
        return 0;
    let read = 0;
    const half = Math.max(1, Math.floor(radius / 2));
    for (const dy of layerOrder(half)) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                if (read >= LOOK_RULES.blocksMax)
                    return read;
                read++;
                let block = null;
                try {
                    block = reader.blockAt(center.x + dx, center.y + dy, center.z + dz);
                } catch {
                    block = null;
                }
                if (!block || typeof block.name !== 'string' || block.name === 'air')
                    continue;
                const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (d > radius)
                    continue;
                visit(block, center.x + dx, center.y + dy, center.z + dz, d);
            }
        }
    }
    return read;
}

/** The ladder columns of a list of ladder cells: `{ pos: the lowest rung, height }`, nearest first. */
export function ladderColumns(cells, center) {
    const byColumn = new Map();
    for (const cell of Array.isArray(cells) ? cells : []) {
        if (!isPoint(cell))
            continue;
        const key = `${cell.x},${cell.z}`;
        if (!byColumn.has(key))
            byColumn.set(key, { x: cell.x, z: cell.z, ys: [] });
        byColumn.get(key).ys.push(cell.y);
    }
    const columns = [];
    for (const { x, z, ys } of byColumn.values()) {
        ys.sort((a, b) => a - b);
        let start = ys[0];
        let prev = ys[0];
        for (let i = 1; i <= ys.length; i++) {
            if (i < ys.length && ys[i] === prev + 1) {
                prev = ys[i];
                continue;
            }
            columns.push({ pos: { x, y: start, z }, height: prev - start + 1 });
            if (i < ys.length) {
                start = ys[i];
                prev = ys[i];
            }
        }
    }
    for (const column of columns)
        column.d = distance(center, column.pos);
    columns.sort((a, b) => a.d - b.d);
    return columns;
}

// v0.1.4.13 fix1, the owner: the bot and its supervisor see only what is open to view, never ore behind a wall (the
// setting that sees through walls is a cheat). An ore, lava or water counts when one of its six sides is open.
const OPEN_BLOCKS = Object.freeze(['air', 'cave_air', 'void_air', 'water', 'lava']);
const SIDES = Object.freeze([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]);

/** True when a side of the block at (x, y, z) is open: air, cave air, water or lava (not the block's own kind). */
export function isExposed(reader, x, y, z, ownName = null) {
    for (const [dx, dy, dz] of SIDES) {
        let side = null;
        try {
            side = reader.blockAt(x + dx, y + dy, z + dz);
        } catch {
            side = null;
        }
        const name = side?.name;
        if (typeof name === 'string' && name !== ownName && OPEN_BLOCKS.includes(name))
            return true;
    }
    return false;
}

/**
 * The lines of the look tool.
 * @param {{blockAt: Function, entities?: () => Array<{kind: 'item'|'player', name: string, count?: number, position: {x, y, z}}>}} reader
 * @param {{x, y, z}} center the cell of the bot
 * @param {number} radius 4 to 32
 * @param {{chestIndex?: object}} [options] chestIndex: the chest index (get(pos) gives free_slots)
 * @returns {string[]}
 */
export function lookAround(reader, center, radius, options = {}) {
    const r = lookRadius(radius) ?? LOOK_RULES.radiusDefault;
    const ores = new Map(); // name -> [{ pos, d }]
    let lava = null;
    let water = null;
    const chests = [];
    const furnaces = [];
    const ladders = [];
    const doors = [];
    scanBox(reader, center, r, (block, x, y, z, d) => {
        const name = block.name;
        const pos = { x, y, z };
        if ((isOre(name) || name === 'lava' || name === 'water') && !isExposed(reader, x, y, z, name))
            return; // behind a wall: not seen
        if (isOre(name)) {
            if (!ores.has(name))
                ores.set(name, []);
            ores.get(name).push({ pos, d });
        } else if (name === 'lava') {
            if (lava === null || d < lava.d)
                lava = { pos, d };
        } else if (name === 'water') {
            if (water === null || d < water.d)
                water = { pos, d };
        } else if (CHEST_BLOCKS.includes(name)) {
            chests.push({ pos, d });
        } else if (FURNACE_BLOCKS.includes(name)) {
            furnaces.push({ pos, d });
        } else if (name === 'ladder') {
            ladders.push(pos);
        } else if (isDoorOrGate(name)) {
            const props = propertiesOf(block);
            if (props?.half === 'upper')
                return; // a door is said once, by its lower half
            doors.push({ name, pos, d, state: doorState(block) });
        }
    });
    const nearest = (a, b) => a.d - b.d;
    const out = [];

    // Ores: nearest kinds first, a vein when every block lies within 2 blocks of the nearest
    const kinds = [...ores.entries()].map(([name, list]) => {
        list.sort(nearest);
        const first = list[0];
        const vein = list.every((b) => Math.max(Math.abs(b.pos.x - first.pos.x), Math.abs(b.pos.y - first.pos.y), Math.abs(b.pos.z - first.pos.z)) <= LOOK_RULES.veinRange);
        return { name, count: list.length, pos: first.pos, d: first.d, vein };
    }).sort((a, b) => a.d - b.d || compareNames(a.name, b.name)).slice(0, LOOK_RULES.perKind);
    if (kinds.length > 0)
        out.push(TEXTS.ores(kinds.map((k) => (k.vein ? TEXTS.oreVein(k.name, k.count, posText(k.pos)) : TEXTS.oreSpread(k.name, k.count, posText(k.pos)))).join(', ')));
    out.push(lava ? TEXTS.lava(Math.round(lava.d), posText(lava.pos)) : TEXTS.noLava(r));
    out.push(water ? TEXTS.water(Math.round(water.d), posText(water.pos)) : TEXTS.noWater(r));
    if (chests.length > 0) {
        chests.sort(nearest);
        const index = options?.chestIndex ?? null;
        out.push(TEXTS.chests(chests.slice(0, LOOK_RULES.perKind).map((c) => {
            let known = null;
            try {
                known = typeof index?.get === 'function' ? index.get(c.pos) : null;
            } catch {
                known = null;
            }
            return known && isFiniteNumber(known.free_slots) ? TEXTS.chestEntry(posText(c.pos), known.free_slots) : TEXTS.chestUnknown(posText(c.pos));
        }).join('; ')));
    }
    if (furnaces.length > 0) {
        furnaces.sort(nearest);
        out.push(TEXTS.furnaces(furnaces.slice(0, LOOK_RULES.perKind).map((f) => posText(f.pos)).join('; ')));
    }
    if (ladders.length > 0) {
        const columns = ladderColumns(ladders, center);
        out.push(TEXTS.ladders(columns.slice(0, LOOK_RULES.perKind).map((c) => TEXTS.ladder(posText(c.pos), c.height)).join('; ')));
    }
    if (doors.length > 0) {
        doors.sort(nearest);
        out.push(TEXTS.doors(doors.slice(0, LOOK_RULES.perKind).map((d) => TEXTS.door(d.name, posText(d.pos), d.state)).join('; ')));
    }

    let entities = [];
    try {
        entities = typeof reader?.entities === 'function' ? reader.entities() ?? [] : [];
    } catch {
        entities = [];
    }
    const withDistance = entities.filter((e) => e && isPoint(e.position)).map((e) => ({ ...e, d: distance(center, e.position) }));
    const drops = withDistance.filter((e) => e.kind === 'item' && e.d <= r).sort((a, b) => a.d - b.d || compareNames(a.name ?? '', b.name ?? ''));
    if (drops.length > 0)
        out.push(TEXTS.drops(drops.slice(0, LOOK_RULES.perKind).map((e) => TEXTS.drop(isFiniteNumber(e.count) ? e.count : 1, e.name ?? 'item', posText(e.position))).join('; ')));
    const players = withDistance.filter((e) => e.kind === 'player' && typeof e.name === 'string').sort((a, b) => a.d - b.d || compareNames(a.name, b.name));
    if (players.length > 0)
        out.push(TEXTS.players(players.slice(0, LOOK_RULES.perKind).map((p) => TEXTS.player(p.name, posText(p.position), Math.round(p.d))).join('; ')));
    return out;
}
