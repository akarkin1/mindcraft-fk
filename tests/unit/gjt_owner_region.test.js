// Release v0.1.4.10, spec I7 T3 (part T): tests/world/owner_region.js, the loader of a dump of the owner's region.
// The pure parts: the check of a dump, the block states, the console commands that build it at an origin, the
// places of the scenarios. buildFromDump sends the commands through the control of the world runner; it was proven
// by hand on the test server of the container (a dump built at another place and dumped again: the same blocks).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const FILE = 'tests/world/owner_region.js';
const O = await loadSrc(FILE);

// A small region: a floor of planks, a door, a bed, a chest, a trapdoor over two ladders, a torch.
const DUMP = Object.freeze({
    version: 1, center: { x: 100, y: 64, z: -20 }, radius: 2,
    blocks: [
        [99, 62, -21, 'ladder', { facing: 'south' }],
        [99, 63, -21, 'ladder', { facing: 'south' }],
        [98, 63, -20, 'oak_planks', {}], [99, 63, -20, 'oak_planks', {}], [100, 63, -20, 'oak_planks', {}], [102, 63, -20, 'oak_planks', {}],
        [99, 64, -21, 'oak_trapdoor', { facing: 'south', half: 'top', open: false }],
        [101, 64, -20, 'red_bed', { facing: 'south', part: 'head' }],
        [101, 64, -21, 'red_bed', { facing: 'south', part: 'foot' }],
        [100, 64, -22, 'oak_door', { facing: 'north', half: 'lower', hinge: 'left', open: false }],
        [100, 65, -22, 'oak_door', { facing: 'north', half: 'upper', hinge: 'left', open: false }],
        [98, 64, -19, 'chest', { facing: 'west', type: 'single' }],
        [102, 64, -19, 'wall_torch', { facing: 'west' }],
        [99, 66, -18, 'ladder', { facing: 'north' }],
    ],
});

describe('the module', () => {
    test('imports node built-ins and control.js only, and runs nothing when imported', () => {
        assertImportRules(FILE, { allowBuiltins: ['fs', 'path', 'url'], allowedRelative: ['control.js'] });
        assertCleanImport(FILE);
    });

    test('the file of the dump is tests/world/owner_region.json', () => {
        assert.equal(path.basename(O.OWNER_REGION_FILE), 'owner_region.json');
        assert.equal(path.basename(path.dirname(O.OWNER_REGION_FILE)), 'world');
    });
});

describe('isDump and loadDump', () => {
    test('a dump of version 1 and what is none', () => {
        assert.equal(O.isDump(DUMP), true);
        assert.equal(O.isDump({ ...DUMP, version: 2 }), false);
        assert.equal(O.isDump({ ...DUMP, radius: 0 }), false);
        assert.equal(O.isDump({ ...DUMP, center: { x: 0, y: 0 } }), false);
        assert.equal(O.isDump({ ...DUMP, blocks: [[1, 2, 'x', 'stone', {}]] }), false);
        assert.equal(O.isDump(null), false);
    });

    test('loadDump: the dump of a file, null for a missing file, no JSON or no dump', () => {
        const dir = makeTmpDir();
        try {
            const good = path.join(dir, 'a.json');
            fs.writeFileSync(good, JSON.stringify(DUMP));
            assert.deepEqual(O.loadDump(good), JSON.parse(JSON.stringify(DUMP)));
            fs.writeFileSync(path.join(dir, 'b.json'), '{');
            assert.equal(O.loadDump(path.join(dir, 'b.json')), null);
            fs.writeFileSync(path.join(dir, 'c.json'), '{"version":1}');
            assert.equal(O.loadDump(path.join(dir, 'c.json')), null);
            assert.equal(O.loadDump(path.join(dir, 'missing.json')), null);
        } finally {
            removeTmpDir(dir);
        }
    });
});

describe('the commands', () => {
    test('blockState and placeOf', () => {
        assert.equal(O.blockState('oak_door', { open: false, facing: 'north', half: 'lower' }), 'minecraft:oak_door[facing=north,half=lower,open=false]');
        assert.equal(O.blockState('stone', {}), 'minecraft:stone');
        assert.equal(O.blockState('minecraft:stone'), 'minecraft:stone');
        assert.deepEqual(O.placeOf({ x: 101, y: 64, z: -21 }, DUMP, { x: 400, y: 61, z: 0 }), { x: 401, y: 61, z: -1 });
        assert.deepEqual(O.boxAt(DUMP, { x: 400, y: 61, z: 0 }), { min: { x: 398, y: 59, z: -2 }, max: { x: 402, y: 63, z: 2 } });
    });

    test('buildCommands: the box cleared per layer, runs of a block as one fill, the attached blocks last, each pair together', () => {
        assert.deepEqual(O.buildCommands(DUMP, { x: 400, y: 61, z: 0 }), [
            'fill 398 59 -2 402 59 2 minecraft:air',
            'fill 398 60 -2 402 60 2 minecraft:air',
            'fill 398 61 -2 402 61 2 minecraft:air',
            'fill 398 62 -2 402 62 2 minecraft:air',
            'fill 398 63 -2 402 63 2 minecraft:air',
            'fill 398 60 0 400 60 0 minecraft:oak_planks',
            'setblock 402 60 0 minecraft:oak_planks',
            'setblock 398 61 1 minecraft:chest[facing=west,type=single]',
            'setblock 399 59 -1 minecraft:ladder[facing=south]',
            'setblock 399 60 -1 minecraft:ladder[facing=south]',
            'setblock 399 61 -1 minecraft:oak_trapdoor[facing=south,half=top,open=false]',
            'setblock 400 61 -2 minecraft:oak_door[facing=north,half=lower,hinge=left,open=false]',
            'setblock 400 62 -2 minecraft:oak_door[facing=north,half=upper,hinge=left,open=false]',
            'setblock 401 61 -1 minecraft:red_bed[facing=south,part=foot]',
            'setblock 401 61 0 minecraft:red_bed[facing=south,part=head]',
            'setblock 402 61 1 minecraft:wall_torch[facing=west]',
            'setblock 399 63 2 minecraft:ladder[facing=north]',
        ]);
    });

    test('without clearing; blocks that would leave the world are left out', () => {
        const cmds = O.buildCommands(DUMP, { x: 0, y: -63, z: 0 }, { clear: false });
        assert.equal(cmds.some((c) => c.includes('minecraft:air')), false);
        assert.equal(cmds.some((c) => / -6[5-9] /.test(c)), false);
        assert.equal(cmds.length, 11); // the ladder at y 62 lands at -65: out; the 4 planks are a fill and a setblock
    });

    test('buildFromDump refuses what is no dump without a command', async () => {
        assert.deepEqual(await O.buildFromDump({ version: 2 }, { x: 0, y: 0, z: 0 }), { ok: false, commands: 0, failed: ['no dump of version 1'] });
    });
});

describe('spotsFromDump', () => {
    test('the bed with its head, the chest, the door with its upper half, the trapdoor, the ladders and their columns', () => {
        const s = O.spotsFromDump(DUMP);
        assert.deepEqual(s.bed, { foot: { x: 101, y: 64, z: -21 }, head: { x: 101, y: 64, z: -20 }, name: 'red_bed', facing: 'south' });
        assert.equal(s.beds.length, 1);
        assert.deepEqual(s.chests, [{ x: 98, y: 64, z: -19, name: 'chest', type: 'single' }]);
        assert.deepEqual(s.doors, [{ lower: { x: 100, y: 64, z: -22 }, upper: { x: 100, y: 65, z: -22 }, name: 'oak_door', facing: 'north', hinge: 'left', open: false }]);
        assert.deepEqual(s.trapdoors, [{ x: 99, y: 64, z: -21, name: 'oak_trapdoor', facing: 'south', half: 'top', open: false }]);
        assert.equal(s.ladders.length, 3);
        assert.deepEqual(s.ladderColumns, [
            { x: 99, z: -21, facing: 'south', bottom: 62, top: 63 },
            { x: 99, z: -18, facing: 'north', bottom: 66, top: 66 },
        ]);
    });

    test('with an origin the places are where buildFromDump puts them', () => {
        const s = O.spotsFromDump(DUMP, { x: 400, y: 61, z: 0 });
        assert.deepEqual(s.bed.foot, { x: 401, y: 61, z: -1 });
        assert.deepEqual(s.trapdoors[0], { x: 399, y: 61, z: -1, name: 'oak_trapdoor', facing: 'south', half: 'top', open: false });
        assert.deepEqual(s.ladderColumns[0], { x: 399, z: -1, facing: 'south', bottom: 59, top: 60 });
    });

    test('no dump: empty lists and no bed', () => {
        assert.deepEqual(O.spotsFromDump(null), { beds: [], bed: null, chests: [], doors: [], trapdoors: [], ladders: [], ladderColumns: [] });
    });
});
