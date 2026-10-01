// The owner's region from a dump (release v0.1.4.10, spec I7 T3): `scripts/dump_region.js` reads the blocks around
// the owner's home in his world into tests/world/owner_region.json; this module builds them in the region of a
// scenario and finds the places the scenarios need.
//
//   loadDump(file)                 the dump of a file, or null when the file is missing or no dump of version 1
//   buildCommands(dump, origin)    the console commands that build it (pure)
//   buildFromDump(dump, origin)    builds it with the console commands through the control of the runner
//   spotsFromDump(dump, origin)    the beds, the chests, the doors, the trapdoors and the ladders
//
// The center of the dump lands on `origin`: a block at p of the dump is built at origin + (p - center). The box of
// the dump (center +- radius, the height cut to the world) is cleared to air first, so the blocks of the test world
// stay only where the dump has a block. The region must be prepared and its chunks loaded (prepareRegion with a
// radius of the dump's radius or more). The contents of chests are not in a dump.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commands } from './control.js';

export const OWNER_REGION_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'owner_region.json');
export const MIN_Y = -64;
export const MAX_Y = 319;

// Blocks that hang on another block or stand on it: built after every other block, so that their support is
// there when they get a block update.
const ATTACHED = /(_door|_bed|_trapdoor|ladder|torch|lantern|_button|^lever$|_sign$|_banner$|_carpet$|rail$|_pressure_plate$|^flower_pot$|^potted_|^vine$|^redstone_wire$|^repeater$|^comparator$|^tripwire|_sapling$|^short_grass$|^tall_grass$|^fern$|^large_fern$|^wheat$|^carrots$|^potatoes$|^beetroots$|^snow$|^cobweb$|^dandelion$|^poppy$|_tulip$|^bell$|^scaffolding$|^leaf_litter$|^chain$)/;

const FACING = Object.freeze({ north: { x: 0, z: -1 }, south: { x: 0, z: 1 }, west: { x: -1, z: 0 }, east: { x: 1, z: 0 } });

/**
 * Whether a value is a dump of version 1: { version: 1, center: {x, y, z}, radius, blocks: [[x, y, z, name, props]] }.
 * @param {unknown} dump
 * @returns {boolean}
 */
export function isDump(dump) {
    return Boolean(dump) && dump.version === 1 && dump.center && [dump.center.x, dump.center.y, dump.center.z].every(Number.isInteger)
        && Number.isInteger(dump.radius) && dump.radius > 0 && Array.isArray(dump.blocks)
        && dump.blocks.every((b) => Array.isArray(b) && [b[0], b[1], b[2]].every(Number.isInteger) && typeof b[3] === 'string');
}

/**
 * The dump of a file, or null when the file is missing, is no JSON or is no dump of version 1.
 * @param {string} [file]
 * @returns {object|null}
 */
export function loadDump(file = OWNER_REGION_FILE) {
    try {
        const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
        return isDump(dump) ? dump : null;
    } catch {
        return null;
    }
}

// The block of a dump entry as an object.
const blockOf = (b) => ({ x: b[0], y: b[1], z: b[2], name: b[3], props: b[4] && typeof b[4] === 'object' ? b[4] : {} });

/**
 * The block state of a setblock or fill command: minecraft:name[k=v,...].
 * @param {string} name
 * @param {object} [props]
 * @returns {string}
 */
export function blockState(name, props = {}) {
    const keys = Object.keys(props ?? {}).filter((k) => props[k] !== undefined && props[k] !== null).sort();
    const id = name.includes(':') ? name : `minecraft:${name}`;
    return keys.length ? `${id}[${keys.map((k) => `${k}=${props[k]}`).join(',')}]` : id;
}

/**
 * Where a block of the dump is built: origin + (p - center).
 * @param {{x, y, z}} p
 * @param {object} dump
 * @param {{x, y, z}} origin
 * @returns {{x, y, z}}
 */
export function placeOf(p, dump, origin) {
    return { x: origin.x + p.x - dump.center.x, y: origin.y + p.y - dump.center.y, z: origin.z + p.z - dump.center.z };
}

/**
 * The box of the dump at the origin: center +- radius, the height cut to the world.
 * @param {object} dump
 * @param {{x, y, z}} origin
 * @returns {{min: {x, y, z}, max: {x, y, z}}}
 */
export function boxAt(dump, origin) {
    const r = dump.radius;
    const min = placeOf({ x: dump.center.x - r, y: dump.center.y - r, z: dump.center.z - r }, dump, origin);
    const max = placeOf({ x: dump.center.x + r, y: dump.center.y + r, z: dump.center.z + r }, dump, origin);
    return { min: { ...min, y: Math.max(MIN_Y, min.y) }, max: { ...max, y: Math.min(MAX_Y, max.y) } };
}

// The order of the attached blocks: by height, and the second half of a door or a bed right after its first half,
// so that no other block update reaches a half alone.
function attachedOrder(list) {
    const key = (b) => {
        const f = FACING[b.props.facing];
        if (b.name.endsWith('_door') && b.props.half === 'upper') return [b.y - 1, b.x, b.z, 1];
        if (b.name.endsWith('_bed') && b.props.part === 'head' && f) return [b.y, b.x - f.x, b.z - f.z, 1];
        return [b.y, b.x, b.z, 0];
    };
    return list.map((b) => ({ b, k: key(b) }))
        .sort((p, q) => p.k[0] - q.k[0] || p.k[1] - q.k[1] || p.k[2] - q.k[2] || p.k[3] - q.k[3])
        .map((p) => p.b);
}

/**
 * The console commands that build a dump at the origin: the box cleared to air (one fill per layer), the other
 * blocks (runs of the same block along x as one fill), then the attached blocks one by one.
 * @param {object} dump
 * @param {{x, y, z}} origin
 * @param {{clear?: boolean}} [options]
 * @returns {string[]}
 */
export function buildCommands(dump, origin, { clear = true } = {}) {
    const out = [];
    if (clear) {
        const box = boxAt(dump, origin);
        for (let y = box.min.y; y <= box.max.y; y++) out.push(`fill ${box.min.x} ${y} ${box.min.z} ${box.max.x} ${y} ${box.max.z} minecraft:air`);
    }
    const blocks = dump.blocks.map(blockOf).filter((b) => {
        const y = b.y - dump.center.y + origin.y;
        return y >= MIN_Y && y <= MAX_Y;
    });
    const solid = blocks.filter((b) => !ATTACHED.test(b.name)).sort((a, b) => (a.y - b.y) || (a.z - b.z) || (a.x - b.x));
    let run = null;
    const flush = () => {
        if (!run) return;
        const a = placeOf(run.first, dump, origin);
        const state = blockState(run.first.name, run.first.props);
        out.push(run.count === 1 ? `setblock ${a.x} ${a.y} ${a.z} ${state}` : `fill ${a.x} ${a.y} ${a.z} ${a.x + run.count - 1} ${a.y} ${a.z} ${state}`);
        run = null;
    };
    for (const b of solid) {
        const state = blockState(b.name, b.props);
        if (run && run.state === state && run.first.y === b.y && run.first.z === b.z && run.first.x + run.count === b.x) {
            run.count++;
            continue;
        }
        flush();
        run = { first: b, state, count: 1 };
    }
    flush();
    for (const b of attachedOrder(blocks.filter((x) => ATTACHED.test(x.name)))) {
        const a = placeOf(b, dump, origin);
        out.push(`setblock ${a.x} ${a.y} ${a.z} ${blockState(b.name, b.props)}`);
    }
    return out;
}

// The answers of the server that mean a command failed. "Could not set the block" (the block is there already)
// and "No blocks were filled" are no failure.
const FAILED = /not loaded|Incorrect|Unknown block|Expected|Invalid|Too many|Cannot place|out of the world/;

/**
 * Builds a dump at the origin through the control of the world runner.
 * @param {object} dump
 * @param {{x, y, z}} origin
 * @param {{clear?: boolean, batch?: number}} [options]
 * @returns {Promise<{ok: boolean, commands: number, failed: string[]}>}
 */
export async function buildFromDump(dump, origin, { clear = true, batch = 400 } = {}) {
    if (!isDump(dump)) return { ok: false, commands: 0, failed: ['no dump of version 1'] };
    const list = buildCommands(dump, origin, { clear });
    const failed = [];
    for (let i = 0; i < list.length; i += batch) {
        const part = list.slice(i, i + batch);
        const out = await commands(part, 60000);
        out.forEach((lines, k) => {
            const bad = lines.filter((l) => FAILED.test(l));
            if (bad.length) failed.push(`${part[k]}: ${bad.join(' | ')}`);
        });
    }
    return { ok: failed.length === 0, commands: list.length, failed };
}

// The ladders as columns: runs of ladders of the same x, z and facing, one above the other.
function ladderColumns(ladders) {
    const byColumn = new Map();
    for (const l of ladders) {
        const k = `${l.x},${l.z},${l.facing}`;
        if (!byColumn.has(k)) byColumn.set(k, []);
        byColumn.get(k).push(l);
    }
    const out = [];
    for (const list of byColumn.values()) {
        list.sort((a, b) => a.y - b.y);
        let col = null;
        for (const l of list) {
            if (col && l.y === col.top + 1) col.top = l.y;
            else { col = { x: l.x, z: l.z, facing: l.facing, bottom: l.y, top: l.y }; out.push(col); }
        }
    }
    return out.sort((a, b) => (a.x - b.x) || (a.z - b.z) || (a.bottom - b.bottom));
}

/**
 * The places of a dump the scenarios need. Positions are those of the dump, or those at the origin when it is given.
 *   beds        [{ foot, head, name, facing }] (head null when the dump has none)
 *   bed         the first of them, or null
 *   chests      [{ x, y, z, name, type }] (chest, trapped_chest, barrel)
 *   doors       [{ lower, upper, name, facing, hinge, open }]
 *   trapdoors   [{ x, y, z, name, facing, half, open }]
 *   ladders     [{ x, y, z, facing }]
 *   ladderColumns [{ x, z, facing, bottom, top }]
 * @param {object} dump
 * @param {{x, y, z}|null} [origin]
 * @returns {object}
 */
export function spotsFromDump(dump, origin = null) {
    const empty = { beds: [], bed: null, chests: [], doors: [], trapdoors: [], ladders: [], ladderColumns: [] };
    if (!isDump(dump)) return empty;
    const at = (p) => (origin ? placeOf(p, dump, origin) : { x: p.x, y: p.y, z: p.z });
    const blocks = dump.blocks.map(blockOf);
    const find = (x, y, z, test) => blocks.find((b) => b.x === x && b.y === y && b.z === z && test(b));
    const beds = blocks.filter((b) => b.name.endsWith('_bed') && b.props.part !== 'head').map((foot) => {
        const f = FACING[foot.props.facing];
        const head = f ? find(foot.x + f.x, foot.y, foot.z + f.z, (b) => b.name === foot.name && b.props.part === 'head') : null;
        return { foot: at(foot), head: head ? at(head) : null, name: foot.name, facing: foot.props.facing ?? null };
    });
    const chests = blocks.filter((b) => b.name === 'chest' || b.name === 'trapped_chest' || b.name === 'barrel')
        .map((b) => ({ ...at(b), name: b.name, type: b.props.type ?? null }));
    const doors = blocks.filter((b) => b.name.endsWith('_door') && b.props.half !== 'upper').map((lower) => {
        const upper = find(lower.x, lower.y + 1, lower.z, (b) => b.name === lower.name && b.props.half === 'upper');
        return { lower: at(lower), upper: upper ? at(upper) : null, name: lower.name, facing: lower.props.facing ?? null, hinge: (upper ?? lower).props.hinge ?? null, open: lower.props.open ?? null };
    });
    const trapdoors = blocks.filter((b) => b.name.endsWith('_trapdoor'))
        .map((b) => ({ ...at(b), name: b.name, facing: b.props.facing ?? null, half: b.props.half ?? null, open: b.props.open ?? null }));
    const ladders = blocks.filter((b) => b.name === 'ladder').map((b) => ({ ...at(b), facing: b.props.facing ?? null }));
    return { beds, bed: beds[0] ?? null, chests, doors, trapdoors, ladders, ladderColumns: ladderColumns(ladders) };
}
