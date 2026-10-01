// Release v0.1.4.10, spec I7 T2 (part T): scripts/dump_region.js and its pure logic scripts/dump_region_logic.js.
// No network: main() of the script gets a fake bot that serves the blocks of a small world. The script was proven
// by hand against the test server of the container (port 25599): a dump, the dump built at another place with
// tests/world/owner_region.js, a second dump there, the same blocks.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { loadSrc } from '../helpers/load.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const LOGIC = 'scripts/dump_region_logic.js';
const SCRIPT = 'scripts/dump_region.js';
const L = await loadSrc(LOGIC);
const M = await loadSrc(SCRIPT);

describe('the modules', () => {
    test('the logic imports nothing; the script imports node built-ins and its logic statically, mineflayer only when it runs', () => {
        assertImportRules(LOGIC, { allowBuiltins: [], allowedRelative: [] });
        assertImportRules(SCRIPT, { allowBuiltins: ['fs', 'path', 'url'], allowedRelative: ['dump_region_logic.js'] });
        assertCleanImport(LOGIC);
        assertCleanImport(SCRIPT);
    });

    test('the defaults', () => {
        assert.equal(L.DEFAULT_OUT, 'tests/world/owner_region.json');
        assert.equal(L.DUMP_VERSION, 1);
        assert.deepEqual([...L.KEPT_PROPS], ['facing', 'half', 'open', 'hinge', 'part', 'type', 'axis', 'shape']);
    });
});

describe('parseArgs', () => {
    test('the arguments of the spec', () => {
        assert.deepEqual(L.parseArgs(['--host', 'localhost', '--port', '55916', '--name', 'dumper', '--center', '-12', '67', '40', '--radius', '20', '--out', 'x.json']), {
            ok: true, host: 'localhost', port: 55916, name: 'dumper', center: { x: -12, y: 67, z: 40 }, radius: 20, out: 'x.json', wait: 60,
        });
    });

    test('the defaults of the optional ones', () => {
        assert.deepEqual(L.parseArgs(['--port', '25599', '--center', '0', '60', '0']), {
            ok: true, host: '127.0.0.1', port: 25599, name: 'region_dump', center: { x: 0, y: 60, z: 0 }, radius: 16, out: 'tests/world/owner_region.json', wait: 60,
        });
    });

    test('a bad argument: one reason', () => {
        const reason = (argv) => L.parseArgs(argv).reason;
        assert.equal(reason([]), '--port is required');
        assert.equal(reason(['--port', '1']), '--center is required');
        assert.equal(reason(['--port', 'x']), '--port needs a whole number');
        assert.equal(reason(['--port', '70000']), '--port must be from 1 to 65535');
        assert.equal(reason(['--port', '1', '--center', '1', '2']), '--center needs three whole numbers: x y z');
        assert.equal(reason(['--port', '1', '--center', '1', '400', '2']), 'the y of --center must be from -64 to 319');
        assert.equal(reason(['--port', '1', '--center', '1', '2', '3', '--radius', '49']), '--radius must be from 1 to 48');
        assert.equal(reason(['--port', '1', '--center', '1', '2', '3', '--radius', '0']), '--radius must be from 1 to 48');
        assert.equal(reason(['--name', 'a b']), '--name needs 3 to 16 letters, digits or _');
        assert.equal(reason(['--out']), '--out needs a file');
        assert.equal(reason(['--fast']), 'unknown argument --fast');
        assert.equal(L.parseArgs(['--help']).help, true);
    });
});

describe('the box, the chunks, the blocks', () => {
    test('boxOf: radius blocks to each side, the height cut to the world', () => {
        assert.deepEqual(L.boxOf({ x: 10, y: 64, z: -5 }, 3), { min: { x: 7, y: 61, z: -8 }, max: { x: 13, y: 67, z: -2 } });
        assert.deepEqual(L.boxOf({ x: 0, y: -60, z: 0 }, 8), { min: { x: -8, y: -64, z: -8 }, max: { x: 8, y: -52, z: 8 } });
        assert.equal(L.boxOf({ x: 0, y: 315, z: 0 }, 8).max.y, 319);
    });

    test('chunksOf: every chunk column the box touches', () => {
        assert.deepEqual(L.chunksOf(L.boxOf({ x: 0, y: 60, z: 0 }, 8)), [[-1, -1], [-1, 0], [0, -1], [0, 0]]);
        assert.deepEqual(L.chunksOf({ min: { x: 1, y: 0, z: 1 }, max: { x: 14, y: 0, z: 14 } }), [[0, 0]]);
        assert.equal(L.chunksOf(L.boxOf({ x: 8, y: 60, z: 8 }, 48)).length, 49);
    });

    test('compact: no air, short names, only the kept properties, sorted by y, x, z', () => {
        const got = L.compact([
            { x: 1, y: 61, z: 0, name: 'oak_door', props: { facing: 'south', half: 'lower', hinge: 'left', open: false, powered: false } },
            { x: 0, y: 60, z: 1, name: 'minecraft:stone' },
            { x: 0, y: 61, z: 0, name: 'air', props: {} },
            { x: 0, y: 61, z: 1, name: 'cave_air' },
            [0, 60, 0, 'grass_block', { snowy: false }],
            { x: 0, y: 59, z: 0, name: '' },
            { x: 0.5, y: 59, z: 0, name: 'dirt' },
        ]);
        assert.deepEqual(got, [
            [0, 60, 0, 'grass_block', {}],
            [0, 60, 1, 'stone', {}],
            [1, 61, 0, 'oak_door', { facing: 'south', half: 'lower', open: false, hinge: 'left' }],
        ]);
    });

    test('dumpOf and dumpText: version 1, center, radius, blocks; one block per line; JSON that reads back', () => {
        const dump = L.dumpOf({ center: { x: 1, y: 2, z: 3 }, radius: 4, blocks: [{ x: 1, y: 2, z: 3, name: 'chest', props: { facing: 'west', type: 'single', waterlogged: false } }] });
        assert.deepEqual(dump, { version: 1, center: { x: 1, y: 2, z: 3 }, radius: 4, blocks: [[1, 2, 3, 'chest', { facing: 'west', type: 'single' }]] });
        const text = L.dumpText(dump);
        assert.equal(text, '{"version":1,"center":{"x":1,"y":2,"z":3},"radius":4,"blocks":[\n[1,2,3,"chest",{"facing":"west","type":"single"}]\n]}\n');
        assert.deepEqual(JSON.parse(text), dump);
        assert.deepEqual(JSON.parse(L.dumpText(L.dumpOf({ center: { x: 0, y: 0, z: 0 }, radius: 1, blocks: [] }))).blocks, []);
    });

    test('formatTable: one row with the counts', () => {
        const dump = L.dumpOf({ center: { x: 0, y: 60, z: 0 }, radius: 1, blocks: [
            [0, 60, 0, 'red_bed', { part: 'foot' }], [0, 60, 1, 'red_bed', { part: 'head' }], [1, 60, 0, 'chest', {}],
            [-1, 60, 0, 'oak_trapdoor', {}], [-1, 59, 0, 'ladder', {}], [1, 59, 1, 'stone', {}],
        ] });
        assert.equal(L.formatTable({ dump, cells: 27, missing: 0, out: 'o.json' }), [
            '| Box | Cells | Blocks | Air | Not loaded | Kinds | Beds | Chests | Doors | Trapdoors | Ladders | File |',
            '|---|---|---|---|---|---|---|---|---|---|---|---|',
            '| (-1, 59, -1) to (1, 61, 1) | 27 | 6 | 21 | 0 | 5 | 2 | 1 | 0 | 1 | 1 | o.json |',
        ].join('\n'));
    });
});

// A fake mineflayer bot: spawns on the next tick, blockAt serves `world` (air elsewhere) for loaded chunks.
function fakeBot(world, { loaded = () => true, spawn = true, kick = null } = {}) {
    const bot = new EventEmitter();
    bot.options = null;
    bot.entity = { position: { x: 0.5, y: 61, z: 0.5 } };
    bot.quitCalls = 0;
    bot.blockAt = (v) => {
        if (!loaded(Math.floor(v.x / 16), Math.floor(v.z / 16))) return null;
        const b = world.get(`${v.x},${v.y},${v.z}`);
        return { name: b ? b.name : 'air', getProperties: () => (b ? b.props : {}) };
    };
    bot.quit = () => { bot.quitCalls++; setImmediate(() => bot.emit('end', 'quit')); };
    setImmediate(() => {
        if (kick) bot.emit('kicked', kick);
        else if (spawn) bot.emit('spawn');
    });
    return bot;
}

describe('main of the script with a fake bot', () => {
    const world = new Map([
        ['0,60,0', { name: 'oak_planks', props: {} }],
        ['1,61,0', { name: 'oak_door', props: { facing: 'north', half: 'lower', hinge: 'right', open: false, powered: false } }],
        ['1,62,0', { name: 'oak_door', props: { facing: 'north', half: 'upper', hinge: 'right', open: false, powered: false } }],
        ['0,59,-1', { name: 'ladder', props: { facing: 'south', waterlogged: false } }],
        ['5,60,5', { name: 'stone', props: {} }], // outside the box
    ]);
    const run = async (argv, botOptions = {}) => {
        const out = [];
        const files = {};
        let created = null;
        const code = await M.main(argv, {
            createBot: async (options) => { created = fakeBot(world, botOptions); created.options = options; return created; },
            vec3: (x, y, z) => ({ x, y, z }),
            writeFile: (f, t) => { files[f] = t; },
            log: (t) => out.push(t),
            pollMs: 5,
        });
        return { code, out: out.join('\n'), files, bot: created };
    };

    test('reads the box, writes the dump without air, prints the table, quits; offline mode, version 1.21.8', async () => {
        const { code, out, files, bot } = await run(['--port', '25599', '--center', '0', '60', '0', '--radius', '2', '--out', 'd.json']);
        assert.equal(code, 0);
        assert.deepEqual(Object.keys(files), ['d.json']);
        assert.deepEqual(JSON.parse(files['d.json']), {
            version: 1, center: { x: 0, y: 60, z: 0 }, radius: 2, blocks: [
                [0, 59, -1, 'ladder', { facing: 'south' }],
                [0, 60, 0, 'oak_planks', {}],
                [1, 61, 0, 'oak_door', { facing: 'north', half: 'lower', open: false, hinge: 'right' }],
                [1, 62, 0, 'oak_door', { facing: 'north', half: 'upper', open: false, hinge: 'right' }],
            ],
        });
        assert.match(out, /^\| \(-2, 58, -2\) to \(2, 62, 2\) \| 125 \| 4 \| 121 \| 0 \| 3 \| 0 \| 0 \| 2 \| 0 \| 1 \| d\.json \|$/m);
        assert.equal(bot.quitCalls, 1);
        assert.deepEqual({ ...bot.options }, { host: '127.0.0.1', port: 25599, username: 'region_dump', auth: 'offline', version: '1.21.8', hideErrors: true, checkTimeoutInterval: 60000 });
    });

    test('chunks that stay unloaded: no file, one line with where the bot stands, exit 1', async () => {
        const { code, out, files, bot } = await run(['--port', '1', '--center', '0', '60', '0', '--radius', '2', '--wait', '1'], { loaded: (cx) => cx >= 0 });
        assert.equal(code, 1);
        assert.deepEqual(files, {});
        assert.equal(out, '2 of 4 chunks of the box are not loaded after 1 s; the bot stands at (0, 61, 0): stand it near (0, 60, 0) and run again.');
        assert.equal(bot.quitCalls, 1);
    });

    test('a kick before the spawn: one line, exit 1', async () => {
        const { code, out } = await run(['--port', '1', '--center', '0', '60', '0'], { kick: 'You are not white-listed on this server!' });
        assert.equal(code, 1);
        assert.equal(out, 'Could not connect to 127.0.0.1:1 as region_dump: kicked: You are not white-listed on this server!.');
    });

    test('a bad argument: one line, exit 1, no connection', async () => {
        const { code, out, bot } = await run(['--port', '1']);
        assert.equal(code, 1);
        assert.equal(out, '--center is required. Run with --help for the usage.');
        assert.equal(bot, null);
    });
});
