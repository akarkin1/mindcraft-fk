// Tester T1 of v0.1.4.12 "Understanding and watching", from the spec 4.4 (part B, the pattern finder) and the
// journeys W102 to W104: findPattern of src/agent/packs/watch/pattern_logic.js on records of fixtures, for the three
// patterns and the three null cases, and the texts the bot says (describePattern of HANDOFF, the TEXTS of texts.js)
// word for word: a line of 4 oak_planks eastwards with "12 long"; 3 oak_fence northwards and a gate facing east with
// "7 by 10"; 3 cells dug 2 high westwards with "12 long"; too_few, no_line, no_size.
//
// The world of the fixtures: flat grass at y 63, air above, except the blocks the owner placed; for the tunnel stone
// everywhere around the level 30, except the cells the owner dug.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const P = await loadSrc('src/agent/packs/watch/pattern_logic.js');
const TX = await loadSrc('src/agent/packs/watch/texts.js');

let t = 1000;
const place = (name, x, y, z, props = {}) => ({ kind: 'place', name, x, y, z, t: t++, props });
const dig = (name, x, y, z) => ({ kind: 'break', name, x, y, z, t: t++, props: {} });
const key = (x, y, z) => `${x},${y},${z}`;

// A surface world: the placed blocks of the record stand, the rest is grass below 64 and air above.
function surface(record, player = null) {
    const placed = new Map(record.filter((e) => e.kind === 'place').map((e) => [key(e.x, e.y, e.z), e.name]));
    return {
        blockAt: (x, y, z) => placed.get(key(x, y, z)) ?? (y < 64 ? (y === 63 ? 'grass_block' : 'dirt') : 'air'),
        ...(player ? { player } : {}),
    };
}

// A rock world: stone, the dug cells of the record are air.
function rock(record) {
    const dug = new Set(record.filter((e) => e.kind === 'break').map((e) => key(e.x, e.y, e.z)));
    return { blockAt: (x, y, z) => (dug.has(key(x, y, z)) ? 'air' : 'stone') };
}

const carry = (counts) => (name) => counts[name] ?? 0;

// ------------------------------------------------------------------------------------------------ the line (W102)

describe('4.4 line: 4 oak_planks eastwards, "12 long"', () => {
    const record = [10, 11, 12, 13].map((x) => place('oak_planks', x, 64, 5));

    test('kind line, the block, from the first block, eastwards, 12 long, 4 placed, 8 missing', () => {
        const p = P.findPattern(record, '12 long', surface(record));
        assert.equal(p.kind, 'line');
        assert.equal(p.name, 'oak_planks');
        assert.deepEqual({ x: p.from.x, y: p.from.y, z: p.from.z }, { x: 10, y: 64, z: 5 });
        assert.equal(p.dir, 'east');
        assert.equal(p.length, 12);
        assert.equal(p.placed, 4);
        assert.equal(p.missing.length, 8);
        const xs = p.missing.map((c) => c.x).sort((a, b) => a - b);
        assert.deepEqual(xs, [14, 15, 16, 17, 18, 19, 20, 21]);
        assert.ok(p.missing.every((c) => c.y === 64 && c.z === 5), 'the cells after the line, at its y and z');
    });

    test('the text: "I understood: a line of oak_planks 12 long from (10, 64, 5) eastwards; 8 oak_planks more, I carry 20. Say yes to build it."', () => {
        const p = P.findPattern(record, '12 long', surface(record));
        assert.equal(P.describePattern(p, carry({ oak_planks: 20 })),
            'I understood: a line of oak_planks 12 long from (10, 64, 5) eastwards; 8 oak_planks more, I carry 20. Say yes to build it.');
    });

    test('the line placed in reverse order goes westwards from its first block', () => {
        const back = [13, 12, 11, 10].map((x) => place('oak_planks', x, 64, 5));
        const p = P.findPattern(back, '12 long', surface(back));
        assert.equal(p.kind, 'line');
        assert.equal(p.dir, 'west');
        assert.equal(p.from.x, 13);
    });

    test('without a size: to the next block that is not air, or 16', () => {
        const p = P.findPattern(record, '', surface(record));
        assert.equal(p.kind, 'line');
        assert.equal(p.length, 16);
        const wall = { blockAt: (x, y, z) => (x === 18 && y === 64 ? 'stone' : surface(record).blockAt(x, y, z)) };
        const q = P.findPattern(record, '', wall);
        assert.equal(q.length, 8, 'the cells 10 to 17, before the stone at 18');
    });
});

// ------------------------------------------------------------------------------------------------ the fence (W103)

describe('4.4 fence: 3 oak_fence northwards, a gate facing east, "7 by 10"', () => {
    const record = [
        place('oak_fence', 20, 64, 30),
        place('oak_fence', 20, 64, 29),
        place('oak_fence', 20, 64, 28),
        place('oak_fence_gate', 20, 64, 27, { facing: 'east' }),
    ];
    const isBorder = (c) => (c.x === 20 || c.x === 29 || c.z === 30 || c.z === 24) && c.x >= 20 && c.x <= 29 && c.z >= 24 && c.z <= 30;

    test('kind fence, 7 long northwards from the first fence, 10 wide eastwards (the gate faces inward)', () => {
        const p = P.findPattern(record, '7 by 10', surface(record, { x: 25, y: 64, z: 35 }));
        assert.equal(p.kind, 'fence');
        assert.equal(p.name, 'oak_fence');
        assert.equal(p.gate, 'oak_fence_gate');
        assert.equal(p.a, 7);
        assert.equal(p.b, 10);
        assert.equal(p.dirA, 'north');
        assert.equal(p.dirB, 'east');
        assert.deepEqual({ x: p.corner.x, y: p.corner.y, z: p.corner.z }, { x: 20, y: 64, z: 30 });
    });

    test('the cells: the border of the rectangle x 20..29, z 24..30, 30 cells, one gate where the owner placed it', () => {
        const p = P.findPattern(record, '7 by 10', surface(record, { x: 25, y: 64, z: 35 }));
        assert.equal(p.cells.length, 30);
        assert.ok(p.cells.every(isBorder), JSON.stringify(p.cells.filter((c) => !isBorder(c))));
        assert.ok(p.cells.every((c) => c.y === 64));
        const gates = p.cells.filter((c) => c.name === 'oak_fence_gate');
        assert.equal(gates.length, 1);
        assert.deepEqual({ x: gates[0].x, z: gates[0].z }, { x: 20, z: 27 });
        assert.ok(p.cells.filter((c) => c.name !== 'oak_fence_gate').every((c) => c.name === 'oak_fence'));
        assert.equal(p.missing.length, 26, 'the 4 placed are not missing');
        assert.ok(p.missing.every((c) => c.name === 'oak_fence'));
    });

    test('the text names 7 x 10, the corner, northwards, the gate where it was placed, 26 oak_fence more, I carry 12', () => {
        const p = P.findPattern(record, '7 by 10', surface(record, { x: 25, y: 64, z: 35 }));
        const text = P.describePattern(p, carry({ oak_fence: 12 }));
        assert.ok(text.startsWith('I understood: a fence 7 x 10 from (20, 64, 30) northwards, the gate where you placed it; 26 oak_fence'), text);
        assert.ok(text.endsWith(' more, I carry 12 oak_fence. Say yes to build it.'), text);
        assert.doesNotMatch(text, /oak_fence_gate more/, 'no gate is missing');
    });

    test('the text of the spec for a fence without a placed gate (texts.js)', () => {
        assert.equal(TX.TEXTS.understood.fence(7, 10, { x: 20, y: 64, z: 30 }, 'east', 'the gate in the middle of the south side', 30, 1, 12) + TX.TEXTS.sayYesBuild,
            'I understood: a fence 7 x 10 from (20, 64, 30) eastwards, the gate in the middle of the south side; 30 oak_fence and 1 oak_fence_gate more, I carry 12 oak_fence. Say yes to build it.');
    });

    test('"7 x 10" is the same size', () => {
        const p = P.findPattern(record, '7 x 10', surface(record, { x: 25, y: 64, z: 35 }));
        assert.equal(p.kind, 'fence');
        assert.equal(p.a, 7);
        assert.equal(p.b, 10);
    });
});

// ------------------------------------------------------------------------------------------------ the tunnel (W104)

describe('4.4 tunnel: 3 cells dug 2 high westwards, "12 long"', () => {
    const record = [];
    for (const x of [40, 39, 38]) {
        record.push(dig('stone', x, 30, 10));
        record.push(dig('stone', x, 31, 10));
    }

    test('kind tunnel, from the first cell, westwards, 12 long, 9 more to dig', () => {
        const p = P.findPattern(record, '12 long', rock(record));
        assert.equal(p.kind, 'tunnel');
        assert.deepEqual({ x: p.from.x, y: p.from.y, z: p.from.z }, { x: 40, y: 30, z: 10 });
        assert.equal(p.dir, 'west');
        assert.equal(p.length, 12);
    });

    test('the text: "I understood: a tunnel 12 long from (40, 30, 10) westwards, 2 high; 9 blocks more to dig. Say yes to dig it."', () => {
        const p = P.findPattern(record, '12 long', rock(record));
        assert.equal(P.describePattern(p, carry({})),
            'I understood: a tunnel 12 long from (40, 30, 10) westwards, 2 high; 9 blocks more to dig. Say yes to dig it.');
    });

    test('the missing cells lie ahead, west of x 38, at the level 30, z 10', () => {
        const p = P.findPattern(record, '12 long', rock(record));
        assert.ok(p.missing.length > 0);
        assert.ok(p.missing.every((c) => c.x < 38 && c.x >= 29 && c.z === 10 && (c.y === 30 || c.y === 31)), JSON.stringify(p.missing));
    });

    test('without a size: 8 long', () => {
        const p = P.findPattern(record, '', rock(record));
        assert.equal(p.kind, 'tunnel');
        assert.equal(p.length, 8);
    });
});

// ------------------------------------------------------------------------------------------------ no pattern

describe('4.4 no pattern: too_few, no_line, no_size, with the texts', () => {
    test('too_few: one block; "I see no pattern in what you did: 1 block."', () => {
        const record = [place('oak_planks', 0, 64, 0)];
        const p = P.findPattern(record, '12 long', surface(record));
        assert.equal(p.kind, null);
        assert.equal(p.why, 'too_few');
        assert.equal(P.describePattern(p), 'I see no pattern in what you did: 1 block.');
        assert.equal(TX.TEXTS.noPattern(1, 'too_few'), 'I see no pattern in what you did: 1 block.');
    });

    test('too_few: nothing watched', () => {
        const p = P.findPattern([], '12 long', surface([]));
        assert.equal(p.kind, null);
        assert.equal(p.why, 'too_few');
    });

    test('no_line: 3 blocks that lie on no line', () => {
        const record = [place('oak_planks', 0, 64, 0), place('oak_planks', 2, 64, 5), place('oak_planks', 7, 64, 1)];
        const p = P.findPattern(record, '12 long', surface(record));
        assert.equal(p.kind, null);
        assert.equal(p.why, 'no_line');
        assert.equal(P.describePattern(p), 'I see no pattern in what you did: 3 blocks that lie on no line.');
        assert.equal(TX.TEXTS.noPattern(3, 'no_line'), 'I see no pattern in what you did: 3 blocks that lie on no line.');
    });

    test('no_line: blocks in a line but with a gap', () => {
        const record = [place('oak_planks', 0, 64, 0), place('oak_planks', 1, 64, 0), place('oak_planks', 3, 64, 0)];
        const p = P.findPattern(record, '12 long', surface(record));
        assert.equal(p.kind, null);
        assert.equal(p.why, 'no_line');
    });

    test('no_size: a fence without "A by B"', () => {
        const record = [place('oak_fence', 20, 64, 30), place('oak_fence', 20, 64, 29), place('oak_fence', 20, 64, 28)];
        for (const size of ['', '12 long']) {
            const p = P.findPattern(record, size, surface(record));
            assert.equal(p.kind, null, size);
            assert.equal(p.why, 'no_size', size);
            assert.equal(P.describePattern(p), 'I see no pattern in what you did: a fence needs a size, say "7 by 10".');
        }
        assert.equal(TX.TEXTS.noPattern(3, 'no_size'), 'I see no pattern in what you did: a fence needs a size, say "7 by 10".');
    });
});

describe('4.4 the other texts of the spec, word for word', () => {
    const at = { x: 3, y: 64, z: 7 };
    test('nothingWatched, built, short, stopped, refused', () => {
        assert.equal(TX.TEXTS.nothingWatched, 'I have watched nothing yet. Say "watch me" first.');
        assert.equal(TX.TEXTS.built.line(7, 'oak_planks'), 'I built the line: 7 oak_planks.');
        assert.equal(TX.TEXTS.built.fence(30, 1), 'I built the fence: 30 oak_fence and 1 gate. Say "this is the pen" to save it.');
        assert.equal(TX.TEXTS.built.tunnel(9), 'I dug the tunnel: 9 blocks.');
        assert.equal(TX.TEXTS.short('oak_fence', 30, 12), 'I have 12 oak_fence and need 30. I fetch the rest from the chest.');
        assert.equal(TX.TEXTS.stopped(12, 30), 'I stopped after 12 of 30.');
        assert.equal(TX.TEXTS.refused(at, 'it is inside the area "pen"'), 'I placed nothing at (3, 64, 7): it is inside the area "pen".');
        assert.equal(TX.TEXTS.nothingToBuild, 'I have no plan. Say "continue like this" first.');
        assert.equal(TX.TEXTS.watched(4, 0), 'I watched you: 4 blocks placed, 0 broken.');
    });
});
