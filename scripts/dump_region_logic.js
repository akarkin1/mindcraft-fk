// The pure part of scripts/dump_region.js (release v0.1.4.10, spec I7 T2): the arguments, the box around the
// center, the chunks of the box, the compact list of blocks of the dump file and the table. No network, no files,
// no output.
//
// The dump file: { version: 1, center: { x, y, z }, radius, blocks: [[x, y, z, name, props]] }, absolute
// coordinates of the world it was read from, without air, sorted by y, x, z. props holds only the properties of
// KEPT_PROPS that the block has ({} when none).
export const DUMP_VERSION = 1;
export const DEFAULT_OUT = 'tests/world/owner_region.json';
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_NAME = 'region_dump';
export const DEFAULT_RADIUS = 16;
export const MAX_RADIUS = 48;
export const DEFAULT_WAIT_S = 60;
export const MIN_Y = -64;
export const MAX_Y = 319;
export const MC_VERSION = '1.21.8';

// facing, half and open (the spec), and the properties without which a block is rebuilt wrong: the hinge of a
// door, the part of a bed, the type of a slab or a double chest, the axis of a log, the shape of stairs.
export const KEPT_PROPS = Object.freeze(['facing', 'half', 'open', 'hinge', 'part', 'type', 'axis', 'shape']);
export const AIR_NAMES = Object.freeze(['air', 'cave_air', 'void_air']);

export const USAGE = [
    'Usage: node scripts/dump_region.js --port <p> --center <x> <y> <z> [--radius <r>] [--host <h>] [--name <bot name>]',
    `                                   [--out <file>] [--wait <seconds>]`,
    `  --host    the server (default ${DEFAULT_HOST})`,
    '  --port    the port of the world (required)',
    `  --name    the name of the bot that reads the blocks, offline mode (default ${DEFAULT_NAME})`,
    '  --center  the middle of the box, for example the floor of the house in front of the bed',
    `  --radius  half the side of the box, 1 to ${MAX_RADIUS} (default ${DEFAULT_RADIUS}): the box is 2r+1 blocks wide, long and high`,
    `  --out     the dump file (default ${DEFAULT_OUT})`,
    `  --wait    seconds to wait until every chunk of the box is loaded (default ${DEFAULT_WAIT_S})`,
    'The bot must stand within the view distance of the box: a chunk that is not loaded is not read.',
].join('\n');

const INT = /^-?\d+$/;

/**
 * The arguments of the script.
 * @param {string[]} argv the arguments after the script name
 * @returns {{ok: true, host: string, port: number, name: string, center: {x, y, z}, radius: number, out: string, wait: number}
 *   |{ok: false, reason: string}|{ok: false, help: true, reason: string}}
 */
export function parseArgs(argv) {
    const list = (Array.isArray(argv) ? argv : []).map(String);
    const a = { host: DEFAULT_HOST, port: null, name: DEFAULT_NAME, center: null, radius: DEFAULT_RADIUS, out: DEFAULT_OUT, wait: DEFAULT_WAIT_S };
    const fail = (reason) => ({ ok: false, reason });
    const intOf = (flag, value, min, max) => {
        if (value === undefined || !INT.test(value)) return { error: `${flag} needs a whole number` };
        const n = Number(value);
        if (n < min || n > max) return { error: `${flag} must be from ${min} to ${max}` };
        return { n };
    };
    for (let i = 0; i < list.length; i++) {
        const flag = list[i];
        const next = () => list[++i];
        if (flag === '--help' || flag === '-h') return { ok: false, help: true, reason: USAGE };
        if (flag === '--host') {
            const v = next();
            if (!v || v.startsWith('--')) return fail('--host needs a name or an address');
            a.host = v;
        } else if (flag === '--port') {
            const v = intOf('--port', next(), 1, 65535);
            if (v.error) return fail(v.error);
            a.port = v.n;
        } else if (flag === '--name') {
            const v = next();
            if (!v || !/^[A-Za-z0-9_]{3,16}$/.test(v)) return fail('--name needs 3 to 16 letters, digits or _');
            a.name = v;
        } else if (flag === '--center') {
            const xyz = [next(), next(), next()];
            if (xyz.some((v) => v === undefined || !INT.test(v))) return fail('--center needs three whole numbers: x y z');
            const [x, y, z] = xyz.map(Number);
            if (y < MIN_Y || y > MAX_Y) return fail(`the y of --center must be from ${MIN_Y} to ${MAX_Y}`);
            a.center = { x, y, z };
        } else if (flag === '--radius') {
            const v = intOf('--radius', next(), 1, MAX_RADIUS);
            if (v.error) return fail(v.error);
            a.radius = v.n;
        } else if (flag === '--out') {
            const v = next();
            if (!v || v.startsWith('--')) return fail('--out needs a file');
            a.out = v;
        } else if (flag === '--wait') {
            const v = intOf('--wait', next(), 1, 600);
            if (v.error) return fail(v.error);
            a.wait = v.n;
        } else {
            return fail(`unknown argument ${flag}`);
        }
    }
    if (a.port === null) return fail('--port is required');
    if (a.center === null) return fail('--center is required');
    return { ok: true, ...a };
}

/**
 * The box around the center: radius blocks to every side, the height cut to the world (y -64 to 319).
 * @param {{x: number, y: number, z: number}} center
 * @param {number} radius
 * @returns {{min: {x, y, z}, max: {x, y, z}}}
 */
export function boxOf(center, radius) {
    return {
        min: { x: center.x - radius, y: Math.max(MIN_Y, center.y - radius), z: center.z - radius },
        max: { x: center.x + radius, y: Math.min(MAX_Y, center.y + radius), z: center.z + radius },
    };
}

/**
 * The chunks a box touches, as [chunkX, chunkZ].
 * @param {{min, max}} box
 * @returns {number[][]}
 */
export function chunksOf(box) {
    const out = [];
    for (let cx = Math.floor(box.min.x / 16); cx <= Math.floor(box.max.x / 16); cx++) {
        for (let cz = Math.floor(box.min.z / 16); cz <= Math.floor(box.max.z / 16); cz++) out.push([cx, cz]);
    }
    return out;
}

// The kept properties of a block, values as the game gives them (strings, booleans or numbers).
export function keptProps(props) {
    const out = {};
    if (!props || typeof props !== 'object') return out;
    for (const k of KEPT_PROPS) if (props[k] !== undefined && props[k] !== null) out[k] = props[k];
    return out;
}

/**
 * The blocks of the dump file: [[x, y, z, name, props]] without air and without blocks of no name, sorted by y,
 * then x, then z; a name without "minecraft:".
 * @param {Array<{x, y, z, name, props?}|Array>} blocks
 * @returns {Array}
 */
export function compact(blocks) {
    const out = [];
    for (const b of Array.isArray(blocks) ? blocks : []) {
        const [x, y, z, name, props] = Array.isArray(b) ? b : [b?.x, b?.y, b?.z, b?.name, b?.props];
        if (![x, y, z].every(Number.isInteger) || typeof name !== 'string' || name === '') continue;
        const short = name.replace(/^minecraft:/, '');
        if (AIR_NAMES.includes(short)) continue;
        out.push([x, y, z, short, keptProps(props)]);
    }
    return out.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]) || (a[2] - b[2]));
}

/**
 * The content of the dump file.
 * @param {{center: {x, y, z}, radius: number, blocks: Array}} input
 * @returns {{version: number, center: object, radius: number, blocks: Array}}
 */
export function dumpOf({ center, radius, blocks }) {
    return { version: DUMP_VERSION, center: { x: center.x, y: center.y, z: center.z }, radius, blocks: compact(blocks) };
}

// The dump as JSON: one block per line, so that a diff of two dumps is readable.
export function dumpText(dump) {
    const head = `{"version":${dump.version},"center":${JSON.stringify(dump.center)},"radius":${dump.radius},"blocks":[`;
    return head + (dump.blocks.length ? '\n' + dump.blocks.map((b) => JSON.stringify(b)).join(',\n') + '\n' : '') + ']}\n';
}

// How many blocks of the dump match each kind of the table.
export const KINDS = Object.freeze({
    Beds: (n) => n.endsWith('_bed'),
    Chests: (n) => n === 'chest' || n === 'trapped_chest' || n === 'barrel',
    Doors: (n) => n.endsWith('_door'),
    Trapdoors: (n) => n.endsWith('_trapdoor'),
    Ladders: (n) => n === 'ladder',
});

/**
 * The table of a dump: the box, the cells read, the blocks kept, the air left out, the cells of chunks that were
 * not loaded, the kinds of block, and the counts of KINDS (a bed and a door count each of their two blocks).
 * @param {{dump: object, cells: number, missing: number, out: string}} input
 * @returns {string}
 */
export function formatTable({ dump, cells, missing = 0, out }) {
    const box = boxOf(dump.center, dump.radius);
    const names = new Set(dump.blocks.map((b) => b[3]));
    const head = ['Box', 'Cells', 'Blocks', 'Air', 'Not loaded', 'Kinds', ...Object.keys(KINDS), 'File'];
    const count = (fn) => dump.blocks.filter((b) => fn(b[3])).length;
    const row = [
        `(${box.min.x}, ${box.min.y}, ${box.min.z}) to (${box.max.x}, ${box.max.y}, ${box.max.z})`,
        String(cells), String(dump.blocks.length), String(cells - missing - dump.blocks.length), String(missing), String(names.size),
        ...Object.values(KINDS).map((fn) => String(count(fn))), out,
    ];
    return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, `| ${row.join(' | ')} |`].join('\n');
}
