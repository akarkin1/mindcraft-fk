// Tests from the spec (v0.1.4.13, section 6, T1): look's lines of part S (SPEC 4.1) from a block fixture: one
// line per kind, nearest first, at most 5 of each kind, the kinds in the order Ores, Lava, Water, Chests, Furnaces,
// Ladders, Doors and gates, Drops, Players and only those present; Lava and Water always said (`none within N`);
// the radius 4 to 32, default 16. The fixture stands at the spec's example cell (31, -59, -99); the chest of the
// example at (11, 7, -100) and the gate at (-2, 63, 52) lie outside any scan of the spec's size, so the fixture
// puts them within the scan at the same distance order. A failing test is a finding.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { lookAround, lookRadius } from '../../src/agent/watch/look_logic.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { makeChestIndex, makeReader } from '../helpers/xt_watch.js';

const CENTER = { x: 31, y: -59, z: -99 };

/** The world of the spec's example around (31, -59, -99): deepslate ground at -60, the bot on it. */
function exampleWorld() {
    const world = createBlockWorld().flatGround(-60, 'deepslate', 'deepslate');
    // a vein of 3 diamond ore, the nearest block at (34, -60, -101)
    world.set(34, -60, -101, 'deepslate_diamond_ore');
    world.set(35, -60, -101, 'deepslate_diamond_ore');
    world.set(34, -61, -101, 'deepslate_diamond_ore');
    // 11 redstone ore, spread, the nearest at (29, -59, -108)
    world.set(29, -59, -108, 'redstone_ore');
    // the other 10 between 19 and 30 blocks away: outside a look of 16, inside one of 32, by a box or by distance
    const spread = [[29, -60, -118], [28, -60, -119], [27, -61, -120], [26, -60, -121], [25, -60, -122], [24, -61, -123], [23, -60, -124], [22, -60, -125], [21, -60, -126], [20, -60, -127]];
    for (const [x, y, z] of spread)
        world.set(x, y, z, 'redstone_ore');
    world.set(34, -59, -101, 'lava');
    world.set(16, -59, -98, 'chest');
    world.set(11, -57, -100, 'chest');
    world.set(16, -59, -99, 'furnace');
    for (let y = -58; y <= -52; y++)
        world.set(13, y, -99, 'ladder');
    world.set(3, -59, -92, 'oak_fence_gate', { open: false, facing: 'north' });
    return world;
}

const ENTITIES = [
    { kind: 'item', name: 'cobbled_deepslate', count: 3, position: { x: 30, y: -59, z: -103 } },
    { kind: 'player', name: 'MartyByrde2', position: { x: 14, y: -59, z: -99 } },
];

const CHESTS = makeChestIndex([
    { x: 16, y: -59, z: -98, free_slots: 22, dimension: 'overworld' },
    { x: 11, y: -57, z: -100, free_slots: 27, dimension: 'overworld' },
]);

describe('SPEC 4.1 look: the lines of the example from a block fixture', () => {
    test('every kind present, in the order of the spec, radius 32', () => {
        const lines = lookAround(makeReader(exampleWorld(), ENTITIES), CENTER, 32, { chestIndex: CHESTS });
        assert.deepEqual(lines, [
            'Ores: deepslate_diamond_ore 3 at (34, -60, -101), redstone_ore 11 nearest at (29, -59, -108).',
            'Lava: 4 blocks away at (34, -59, -101).',
            'Water: none within 32.',
            'Chests: (16, -59, -98) 22 free slots; (11, -57, -100) 27 free slots.',
            'Furnaces: (16, -59, -99).',
            'Ladders: (13, -58, -99) up to 7.',
            'Doors and gates: oak_fence_gate at (3, -59, -92), closed.',
            'Drops: 3 cobbled_deepslate at (30, -59, -103).',
            'Players: MartyByrde2 at (14, -59, -99), 17 blocks away.',
        ]);
    });

    test('radius 16: what lies outside is left out, Water says none within 16', () => {
        const lines = lookAround(makeReader(exampleWorld(), ENTITIES), CENTER, 16, { chestIndex: CHESTS });
        assert.equal(lines[0], 'Ores: deepslate_diamond_ore 3 at (34, -60, -101), redstone_ore 1 at (29, -59, -108).');
        assert.equal(lines[1], 'Lava: 4 blocks away at (34, -59, -101).');
        assert.equal(lines[2], 'Water: none within 16.');
        assert.equal(lines[3], 'Chests: (16, -59, -98) 22 free slots.');
        assert.equal(lines[4], 'Furnaces: (16, -59, -99).');
        assert.ok(!lines.some((l) => l.startsWith('Ladders:')), lines.join('\n'));
        assert.ok(!lines.some((l) => l.startsWith('Doors and gates:')), lines.join('\n'));
        assert.equal(lines[5], 'Drops: 3 cobbled_deepslate at (30, -59, -103).');
    });
});

describe('SPEC 4.1 look: Lava and Water are always said, absent kinds are left out', () => {
    test('an empty world gives the two lines only', () => {
        const world = createBlockWorld().flatGround(-60, 'deepslate', 'deepslate');
        const lines = lookAround(makeReader(world, []), CENTER, 16, { chestIndex: makeChestIndex([]) });
        assert.deepEqual(lines, ['Lava: none within 16.', 'Water: none within 16.']);
    });

    test('water the bot could walk into is said like lava', () => {
        const world = createBlockWorld().flatGround(-60, 'deepslate', 'deepslate');
        world.set(33, -59, -99, 'water');
        const lines = lookAround(makeReader(world, []), CENTER, 16, { chestIndex: makeChestIndex([]) });
        assert.deepEqual(lines, ['Lava: none within 16.', 'Water: 2 blocks away at (33, -59, -99).']);
    });

    test('an open gate says open', () => {
        const world = createBlockWorld().flatGround(-60, 'deepslate', 'deepslate');
        world.set(33, -59, -99, 'oak_fence_gate', { open: true, facing: 'north' });
        const lines = lookAround(makeReader(world, []), CENTER, 16, { chestIndex: makeChestIndex([]) });
        assert.deepEqual(lines, ['Lava: none within 16.', 'Water: none within 16.', 'Doors and gates: oak_fence_gate at (33, -59, -99), open.']);
    });
});

describe('SPEC 4.1 look: nearest first, at most 5 of each kind', () => {
    test('7 chests give the 5 nearest, nearest first', () => {
        const world = createBlockWorld().flatGround(-60, 'deepslate', 'deepslate');
        const entries = [];
        for (let i = 1; i <= 7; i++) {
            world.set(31 + i * 2, -59, -99, 'chest');
            entries.push({ x: 31 + i * 2, y: -59, z: -99, free_slots: 10 + i, dimension: 'overworld' });
        }
        const lines = lookAround(makeReader(world, []), CENTER, 16, { chestIndex: makeChestIndex(entries) });
        const chests = lines.find((l) => l.startsWith('Chests:'));
        assert.equal(chests, 'Chests: (33, -59, -99) 11 free slots; (35, -59, -99) 12 free slots; (37, -59, -99) 13 free slots; (39, -59, -99) 14 free slots; (41, -59, -99) 15 free slots.');
    });

    test('7 drops give the 5 nearest, nearest first', () => {
        const world = createBlockWorld().flatGround(-60, 'deepslate', 'deepslate');
        const drops = [];
        for (let i = 7; i >= 1; i--)
            drops.push({ kind: 'item', name: 'cobblestone', count: i, position: { x: 31, y: -59, z: -99 - i } });
        const lines = lookAround(makeReader(world, drops), CENTER, 16, { chestIndex: makeChestIndex([]) });
        const line = lines.find((l) => l.startsWith('Drops:'));
        assert.equal(line, 'Drops: 1 cobblestone at (31, -59, -100); 2 cobblestone at (31, -59, -101); 3 cobblestone at (31, -59, -102); 4 cobblestone at (31, -59, -103); 5 cobblestone at (31, -59, -104).');
    });

    test('the nearest ore of each kind comes first', () => {
        const world = createBlockWorld().flatGround(-60, 'deepslate', 'deepslate');
        world.set(40, -60, -99, 'iron_ore');
        world.set(33, -60, -99, 'coal_ore');
        world.set(36, -60, -99, 'coal_ore');
        const lines = lookAround(makeReader(world, []), CENTER, 16, { chestIndex: makeChestIndex([]) });
        assert.equal(lines[0], 'Ores: coal_ore 2 nearest at (33, -60, -99), iron_ore 1 at (40, -60, -99).');
    });
});

describe('SPEC 4.1 look: the size of the scan', () => {
    test('radius 32 reads at most 65,536 blocks', () => {
        const world = createBlockWorld().flatGround(-60, 'deepslate', 'deepslate');
        const reader = makeReader(world, []);
        let reads = 0;
        const counting = { ...reader, blockAt: (x, y, z) => { reads += 1; return reader.blockAt(x, y, z); } };
        const lines = lookAround(counting, CENTER, 32, { chestIndex: makeChestIndex([]) });
        assert.ok(reads > 0, 'the scan reads the blocks through the reader');
        assert.ok(reads <= 65536, `${reads} blocks read`);
        assert.deepEqual(lines, ['Lava: none within 32.', 'Water: none within 32.']);
    });
});

describe('SPEC 4.1 look: the radius', () => {
    test('4 to 32, default 16', () => {
        assert.equal(lookRadius(undefined), 16);
        assert.equal(lookRadius(4), 4);
        assert.equal(lookRadius(32), 32);
        assert.equal(lookRadius(3), null);
        assert.equal(lookRadius(33), null);
    });
});
