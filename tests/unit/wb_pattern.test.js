// Spec v0.1.4.12, 4.4 (part B, engineer E4): the pattern finder findPattern(record, size, world) from fixtures of
// records, with the exact understood texts: a line of 4 oak_planks eastwards; 3 oak_fence northwards then a gate facing
// east ("7 by 10"); 3 dug cells 2 high westwards ("12 long"); and the null cases: fewer than 2 entries, entries on no
// line, a fence without a size.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { importsOf } from '../helpers/hygiene.js';

const L = await loadSrc('src/agent/packs/watch/pattern_logic.js');

const rec = (kind, name, x, y, z, t, props = {}) => ({ kind, name, x, y, z, t, props });
const key = (c) => `${c.x},${c.y},${c.z}`;
// a world of grass at y 63, air above, stone below 63, with blocks set by the fixture
function world(blocks = {}, player = null) {
    return {
        blockAt: (x, y, z) => blocks[`${x},${y},${z}`] ?? (y > 63 ? 'air' : y === 63 ? 'grass_block' : 'stone'),
        player,
    };
}

// the fixtures of the spec
const LINE = [0, 1, 2, 3].map(i => rec('place', 'oak_planks', 10 + i, 64, 5, 1000 + i));
const FENCE = [
    rec('place', 'oak_fence', 4, 64, -12, 1), rec('place', 'oak_fence', 4, 64, -13, 2), rec('place', 'oak_fence', 4, 64, -14, 3),
    rec('place', 'oak_fence_gate', 4, 64, -15, 4, { facing: 'east' }),
];
const TUNNEL = [];
for (let i = 0; i < 3; i++) {
    TUNNEL.push(rec('break', 'stone', 20 - i, 40, 3, 10 * i));
    TUNNEL.push(rec('break', 'stone', 20 - i, 41, 3, 10 * i + 1));
}

describe('pattern_logic.js', () => {
    test('pure: imports only the texts of the pack', () => {
        assert.deepEqual(importsOf('src/agent/packs/watch/pattern_logic.js').static, ['./texts.js']);
    });

    test('parseSize', () => {
        assert.deepEqual(L.parseSize('12 long'), { long: 12 });
        assert.deepEqual(L.parseSize(' 12 '), { long: 12 });
        assert.deepEqual(L.parseSize('12 blocks long'), { long: 12 });
        assert.deepEqual(L.parseSize('7 by 10'), { a: 7, b: 10 });
        assert.deepEqual(L.parseSize('7 x 10'), { a: 7, b: 10 });
        assert.deepEqual(L.parseSize('7x10'), { a: 7, b: 10 });
        for (const bad of ['', 'long', 'big', '0 long', '65 long', '1 by 10', '7 by 99', null, undefined, 12]) assert.equal(L.parseSize(bad), null, String(bad));
    });

    test('netEntries: placed and broken again is gone, broken and placed again is a place, newest last', () => {
        const r = [rec('place', 'dirt', 0, 64, 0, 1), rec('place', 'dirt', 1, 64, 0, 2), rec('break', 'dirt', 0, 64, 0, 3),
            rec('break', 'stone', 5, 63, 5, 4), rec('place', 'cobblestone', 5, 63, 5, 5), { kind: 'place', name: 'x', x: 1.5, y: 64, z: 0 }];
        assert.deepEqual(L.netEntries(r).map(e => [e.kind, e.name, e.x]), [['place', 'dirt', 1], ['place', 'cobblestone', 5]]);
        assert.deepEqual(L.netEntries(null), []);
    });
});

describe('findPattern: a line', () => {
    test('4 oak_planks eastwards, "12 long": 12 long from the first block, 8 more', () => {
        const p = L.findPattern(LINE, '12 long', world());
        assert.equal(p.kind, 'line');
        assert.equal(p.name, 'oak_planks');
        assert.deepEqual(p.from, { x: 10, y: 64, z: 5 });
        assert.equal(p.dir, 'east');
        assert.equal(p.length, 12);
        assert.equal(p.placed, 4);
        assert.deepEqual(p.missing.map(key), [14, 15, 16, 17, 18, 19, 20, 21].map(x => `${x},64,5`));
        assert.equal(L.describePattern(p, (name) => (name === 'oak_planks' ? 20 : 0)),
            'I understood: a line of oak_planks 12 long from (10, 64, 5) eastwards; 8 oak_planks more, I carry 20. Say yes to build it.');
    });

    test('placed westwards (the same cells in the other order): from the first block placed, westwards', () => {
        const p = L.findPattern([...LINE].reverse().map((e, i) => ({ ...e, t: i })), '6 long', world());
        assert.equal(p.dir, 'west');
        assert.deepEqual(p.from, { x: 13, y: 64, z: 5 });
        assert.deepEqual(p.missing.map(key), ['9,64,5', '8,64,5']);
    });

    test('without a size: to the next block that is not air, or to 16', () => {
        assert.equal(L.findPattern(LINE, '', world()).length, 16);
        assert.equal(L.findPattern(LINE, '', world({ '19,64,5': 'stone' })).length, 9);
        assert.equal(L.findPattern(LINE, '', world({ '15,64,5': 'short_grass' })).length, 16, 'grass is no block in the way');
        assert.equal(L.findPattern(LINE, '').length, 16, 'without the world: 16');
    });

    test('a cell that already holds the block is not missing', () => {
        const p = L.findPattern(LINE, '12 long', world({ '20,64,5': 'oak_planks' }));
        assert.equal(p.missing.length, 7);
    });

    test('northwards and southwards along z', () => {
        const north = [0, 1, 2].map(i => rec('place', 'cobblestone', 0, 70, 0 - i + 0, i));
        assert.deepEqual([L.findPattern(north, '5 long', world()).dir, L.findPattern(north, '5 long', world()).from], ['north', { x: 0, y: 70, z: 0 }]);
        const south = [0, 1].map(i => rec('place', 'cobblestone', 0, 70, i, i));
        assert.equal(L.findPattern(south, '5 long', world()).dir, 'south');
    });
});

describe('findPattern: a fence', () => {
    test('3 oak_fence northwards then a gate facing east, "7 by 10": 7 northwards, 10 eastwards, the gate where it was placed', () => {
        const p = L.findPattern(FENCE, '7 by 10', world());
        assert.equal(p.kind, 'fence');
        assert.equal(p.name, 'oak_fence');
        assert.equal(p.gate, 'oak_fence_gate');
        assert.equal(p.gatePlaced, true);
        assert.deepEqual(p.corner, { x: 4, y: 64, z: -12 });
        assert.deepEqual([p.dirA, p.dirB, p.a, p.b], ['north', 'east', 7, 10]);
        assert.equal(p.cells.length, 30, 'the border of 7 x 10');
        const border = new Set();
        for (let i = 0; i < 10; i++) {
            for (let j = 0; j < 7; j++) {
                if (i === 0 || j === 0 || i === 9 || j === 6) border.add(`${4 + i},64,${-12 - j}`);
            }
        }
        assert.deepEqual(new Set(p.cells.map(key)), border);
        assert.deepEqual(p.cells.filter(c => c.name === 'oak_fence_gate').map(key), ['4,64,-15'], 'one gate, where the teacher put it');
        assert.equal(p.missing.length, 26);
        assert.ok(p.missing.every(c => c.name === 'oak_fence'));
        assert.equal(L.describePattern(p, (name) => (name === 'oak_fence' ? 12 : 0)),
            'I understood: a fence 7 x 10 from (4, 64, -12) northwards, the gate where you placed it; 26 oak_fence more, I carry 12 oak_fence. Say yes to build it.');
    });

    test('the order of the cells: along the placed fences first, then around', () => {
        const p = L.findPattern(FENCE, '7 by 10', world());
        assert.deepEqual(p.missing.slice(0, 5).map(key), ['4,64,-16', '4,64,-17', '4,64,-18', '5,64,-18', '6,64,-18']);
        assert.deepEqual(p.missing.at(-1), { x: 5, y: 64, z: -12, name: 'oak_fence' });
    });

    test('without a gate: the side with more free ground, the gate in the middle of the side nearest to the player', () => {
        const fences = FENCE.slice(0, 3);
        // water on the east: the west has more ground
        const blocks = {};
        for (let x = 5; x < 15; x++) for (let z = -20; z <= -10; z++) blocks[`${x},63,${z}`] = 'water';
        const p = L.findPattern(fences, '7 by 10', world(blocks, { x: -2, y: 64, z: -15 }));
        assert.equal(p.dirB, 'west');
        assert.equal(p.gatePlaced, false);
        const gate = p.cells.filter(c => c.name === 'oak_fence_gate');
        assert.equal(gate.length, 1);
        assert.deepEqual(gate[0], { x: -5, y: 64, z: -15, name: 'oak_fence_gate', facing: 'east' }, 'the middle of the west side, facing inward');
        assert.equal(p.gateSide, 'west');
        assert.equal(L.describePattern(p, () => 12),
            'I understood: a fence 7 x 10 from (4, 64, -12) northwards, the gate in the middle of the west side; 26 oak_fence and 1 oak_fence_gate more, I carry 12 oak_fence. Say yes to build it.');
    });

    test('a fence without a size: no pattern, "a fence needs a size"', () => {
        for (const size of ['', '12 long', 'big']) {
            const p = L.findPattern(FENCE, size, world());
            assert.deepEqual(p, { kind: null, why: 'no_size', n: 4 }, size);
            assert.equal(L.describePattern(p), 'I see no pattern in what you did: a fence needs a size, say "7 by 10".');
        }
    });
});

describe('findPattern: a tunnel', () => {
    test('3 cells dug 2 high westwards, "12 long": 12 long, 9 more to dig', () => {
        const p = L.findPattern(TUNNEL, '12 long', world({ '20,40,3': 'air', '20,41,3': 'air', '19,40,3': 'air', '19,41,3': 'air', '18,40,3': 'air', '18,41,3': 'air' }));
        assert.equal(p.kind, 'tunnel');
        assert.deepEqual(p.from, { x: 20, y: 40, z: 3 });
        assert.equal(p.dir, 'west');
        assert.equal(p.length, 12);
        assert.equal(p.dug, 3);
        assert.deepEqual(p.missing.map(key), [17, 16, 15, 14, 13, 12, 11, 10, 9].map(x => `${x},40,3`));
        assert.equal(L.describePattern(p), 'I understood: a tunnel 12 long from (20, 40, 3) westwards, 2 high; 9 blocks more to dig. Say yes to dig it.');
    });

    test('without a size: 8 long', () => {
        assert.equal(L.findPattern(TUNNEL, '').length, 8);
    });

    test('cells dug 1 high, or on two levels: no tunnel', () => {
        const low = TUNNEL.filter(e => e.y === 40);
        assert.equal(L.findPattern(low, '12 long').kind, null);
        const levels = TUNNEL.map(e => (e.x === 18 ? { ...e, y: e.y + 1 } : e));
        assert.equal(L.findPattern(levels, '12 long').why, 'no_line');
    });
});

describe('findPattern: no pattern', () => {
    test('fewer than 2 entries', () => {
        assert.deepEqual(L.findPattern([], '12 long'), { kind: null, why: 'too_few', n: 0 });
        const p = L.findPattern([LINE[0]], '12 long');
        assert.deepEqual(p, { kind: null, why: 'too_few', n: 1 });
        assert.equal(L.describePattern(p), 'I see no pattern in what you did: 1 block.');
        assert.deepEqual(L.findPattern(null), { kind: null, why: 'too_few', n: 0 });
    });

    test('entries that lie on no line', () => {
        const r = [rec('place', 'oak_planks', 0, 64, 0, 1), rec('place', 'oak_planks', 2, 64, 1, 2), rec('place', 'oak_planks', 5, 64, 7, 3)];
        const p = L.findPattern(r, '12 long', world());
        assert.deepEqual(p, { kind: null, why: 'no_line', n: 3 });
        assert.equal(L.describePattern(p), 'I see no pattern in what you did: 3 blocks that lie on no line.');
    });

    test('a gap, a step in y, two kinds of block: no line', () => {
        assert.equal(L.findPattern([LINE[0], LINE[2]], '').why, 'no_line');
        assert.equal(L.findPattern([LINE[0], { ...LINE[1], y: 65 }], '').why, 'no_line');
        assert.equal(L.findPattern([LINE[0], { ...LINE[1], name: 'stone' }], '').why, 'no_line');
    });

    test('never throws', () => {
        assert.equal(L.findPattern([{}, { kind: 'place' }, 7], 'x').kind, null);
        assert.equal(L.findPattern(LINE, '12 long', { blockAt() { throw new Error('x'); } }).kind, 'line');
    });
});
