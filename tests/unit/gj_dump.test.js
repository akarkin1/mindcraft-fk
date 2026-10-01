// Tester T1 of v0.1.4.10 "Goals", from the spec (I7, T2): the pure logic of the dump of a region,
// scripts/dump_region_logic.js: parseArgs, boxOf(center, radius), compact(blocks). The dump file is
// { version: 1, center, radius, blocks: [[x, y, z, name, props]] } without air, with the properties facing, half and
// open. No connection is made here.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const D = await loadSrc('scripts/dump_region_logic.js');

const xyz = (p) => (Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : { x: p?.x, y: p?.y, z: p?.z });

describe('I7 T2: parseArgs', () => {
    test('the arguments of the command line', () => {
        const args = D.parseArgs(['--host', '127.0.0.1', '--port', '25599', '--name', 'dumper', '--center', '10', '64', '-5', '--radius', '8',
            '--out', 'tests/world/owner_region.json']);
        assert.equal(args.host, '127.0.0.1');
        assert.equal(Number(args.port), 25599);
        assert.equal(args.name, 'dumper');
        assert.deepEqual(xyz(args.center), { x: 10, y: 64, z: -5 });
        assert.equal(Number(args.radius), 8);
        assert.equal(args.out, 'tests/world/owner_region.json');
    });
});

describe('I7 T2: boxOf', () => {
    test('the box of a center and a radius', () => {
        const box = D.boxOf({ x: 10, y: 64, z: -5 }, 8);
        assert.deepEqual(xyz(box.min), { x: 2, y: 56, z: -13 });
        assert.deepEqual(xyz(box.max), { x: 18, y: 72, z: 3 });
    });
});

describe('I7 T2: compact', () => {
    // A block read in the box: x, y, z, the name and the properties (the spec does not fix the shape of the input;
    // the fields are given under the usual names).
    const block = (x, y, z, name, props = {}) => ({ name, position: { x, y, z }, x, y, z, props, properties: props, getProperties: () => ({ ...props }) });

    test('no air; [x, y, z, name, props] with facing, half and open only', () => {
        const out = D.compact([
            block(0, 64, 0, 'air'),
            block(1, 64, 0, 'cave_air'),
            block(2, 64, 0, 'oak_trapdoor', { facing: 'south', half: 'top', open: false, powered: false, waterlogged: false }),
            block(3, 64, 0, 'ladder', { facing: 'south', waterlogged: false }),
            block(4, 63, 0, 'stone'),
        ]);
        assert.ok(Array.isArray(out));
        const names = out.map((r) => r[3]);
        assert.ok(!names.includes('air') && !names.includes('cave_air'), names.join(', '));
        const trapdoor = out.find((r) => r[3] === 'oak_trapdoor');
        assert.deepEqual(trapdoor.slice(0, 4), [2, 64, 0, 'oak_trapdoor']);
        assert.deepEqual(trapdoor[4], { facing: 'south', half: 'top', open: false });
        const ladder = out.find((r) => r[3] === 'ladder');
        assert.deepEqual(ladder[4], { facing: 'south' });
        const stone = out.find((r) => r[3] === 'stone');
        assert.deepEqual(stone.slice(0, 4), [4, 63, 0, 'stone']);
        assert.ok(stone[4] === undefined || stone[4] === null || Object.keys(stone[4]).length === 0, JSON.stringify(stone));
    });
});
