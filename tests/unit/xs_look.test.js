// Spec v0.1.4.13 4.1 (part S): the look tool from a block fixture: one line per kind, nearest first, at most 5 of
// each kind, the kinds in order, Lava and Water always, the cap of 65,536 blocks, the radius 4 to 32.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOK_RULES, doorState, isOre, ladderColumns, layerOrder, lookAround, lookRadius, scanBox } from '../../src/agent/watch/look_logic.js';
import { TOOL_HANDLERS, argsRefusal, runTool } from '../../src/agent/watch/tools.js';

// a world: a map "x,y,z" -> block, air elsewhere
function world(blocks) {
    const map = new Map(Object.entries(blocks));
    return {
        blockAt: (x, y, z) => map.get(`${x},${y},${z}`) ?? { name: 'air' },
        entities: () => [],
    };
}

const center = { x: 31, y: -59, z: -99 };

describe('the lines of the spec', () => {
    test('ores, lava, water, chests, furnaces, ladders, doors, drops, players', () => {
        const reader = world({
            '34,-60,-101': { name: 'deepslate_diamond_ore' }, '35,-60,-101': { name: 'deepslate_diamond_ore' }, '34,-61,-102': { name: 'deepslate_diamond_ore' },
            '29,-59,-108': { name: 'redstone_ore' }, '20,-59,-108': { name: 'redstone_ore' }, '38,-62,-90': { name: 'redstone_ore' },
            '34,-59,-101': { name: 'lava' }, '40,-59,-101': { name: 'lava' },
            '25,-60,-99': { name: 'water' },
            '16,-59,-98': { name: 'chest' }, '20,-58,-99': { name: 'barrel' },
            '16,-59,-99': { name: 'furnace' },
            '23,-58,-99': { name: 'ladder' }, '23,-57,-99': { name: 'ladder' }, '23,-56,-99': { name: 'ladder' },
            '30,-59,-96': { name: 'oak_fence_gate', getProperties: () => ({ open: false }) },
            '33,-59,-96': { name: 'oak_door', getProperties: () => ({ open: true, half: 'lower' }) }, '33,-58,-96': { name: 'oak_door', getProperties: () => ({ open: true, half: 'upper' }) },
        });
        reader.entities = () => [
            { kind: 'item', name: 'cobbled_deepslate', count: 3, position: { x: 30, y: -59, z: -103 } },
            { kind: 'item', name: 'gravel', count: 1, position: { x: 60, y: -59, z: -103 } }, // beyond the radius
            { kind: 'player', name: 'MartyByrde2', position: { x: 14, y: -59, z: -99 } },
        ];
        const index = { get: (pos) => (pos.x === 16 ? { free_slots: 22 } : null) };
        assert.deepEqual(lookAround(reader, center, 16, { chestIndex: index }), [
            'Ores: deepslate_diamond_ore 3 at (34, -60, -101), redstone_ore 3 nearest at (29, -59, -108).',
            'Lava: 4 blocks away at (34, -59, -101).',
            'Water: 6 blocks away at (25, -60, -99).',
            'Chests: (20, -58, -99); (16, -59, -98) 22 free slots.', // the barrel 11 blocks away, the chest 15
            'Furnaces: (16, -59, -99).',
            'Ladders: (23, -58, -99) up to 3.',
            'Doors and gates: oak_fence_gate at (30, -59, -96), closed; oak_door at (33, -59, -96), open.',
            'Drops: 3 cobbled_deepslate at (30, -59, -103).',
            'Players: MartyByrde2 at (14, -59, -99), 17 blocks away.',
        ]);
    });

    test('only the kinds present; Lava and Water always', () => {
        assert.deepEqual(lookAround(world({}), center, 16), ['Lava: none within 16.', 'Water: none within 16.']);
        assert.deepEqual(lookAround(world({ '31,-59,-90': { name: 'chest' } }), center, 8), ['Lava: none within 8.', 'Water: none within 8.']); // 9 blocks off, beyond 8
    });

    test('at most 5 of each kind, nearest first', () => {
        const blocks = {};
        for (let i = 1; i <= 8; i++)
            blocks[`${31 + i},-59,-99`] = { name: 'chest' };
        const lines = lookAround(world(blocks), center, 16);
        assert.equal(lines[2], 'Chests: (32, -59, -99); (33, -59, -99); (34, -59, -99); (35, -59, -99); (36, -59, -99).');
        const ores = {};
        for (let i = 1; i <= 7; i++)
            ores[`${31 + i},-59,-99`] = { name: `ore_${i}_ore` };
        assert.equal(lookAround(world(ores), center, 16)[0].split(',').length, 5 * 3); // 5 kinds, each with a position of 3 parts
    });

    test('the scan reads at most 65,536 blocks, the layers from the bot outward', () => {
        let read = 0;
        const reader = { blockAt: () => { read++; return { name: 'stone' }; } };
        const layers = new Set();
        const n = scanBox(reader, center, 32, (block, x, y) => layers.add(y));
        assert.equal(n, 65536);
        assert.equal(read, 65536);
        assert.ok(layers.has(-59) && layers.has(-52) && layers.has(-66));
        assert.equal(LOOK_RULES.blocksMax, 65536);
        assert.deepEqual(layerOrder(2), [0, 1, -1, 2, -2]);
        let small = 0;
        scanBox({ blockAt: () => { small++; return null; } }, center, 4, () => {});
        assert.equal(small, 9 * 9 * 5); // radius 4: 9 wide, 2 up and down
    });

    test('ladder columns, door state, ores, the radius', () => {
        assert.deepEqual(ladderColumns([{ x: 1, y: 5, z: 1 }, { x: 1, y: 6, z: 1 }, { x: 1, y: 9, z: 1 }, { x: 0, y: 1, z: 0 }], { x: 0, y: 0, z: 0 }).map((c) => [c.pos, c.height]),
            [[{ x: 0, y: 1, z: 0 }, 1], [{ x: 1, y: 5, z: 1 }, 2], [{ x: 1, y: 9, z: 1 }, 1]]);
        assert.equal(doorState({ getProperties: () => ({ open: 'true' }) }), 'open');
        assert.equal(doorState({ _properties: { open: false } }), 'closed');
        assert.equal(doorState({}), 'closed');
        assert.equal(isOre('deepslate_iron_ore'), true);
        assert.equal(isOre('ancient_debris'), true);
        assert.equal(isOre('iron_block'), false);
        assert.equal(lookRadius(undefined), 16);
        assert.equal(lookRadius('32'), 32);
        assert.equal(lookRadius(3), null);
        assert.equal(lookRadius(33), null);
        assert.equal(argsRefusal('look', { radius: 2 }), 'look takes a radius of 4 to 32, not "2".');
        assert.equal(argsRefusal('look', {}), null);
    });
});

describe('the look tool', () => {
    test('reads the blocks and the entities of the bot, the free slots of the chest index', async () => {
        const blocks = new Map([['3,64,0', 'lava'], ['-2,64,0', 'chest']]);
        const agent = {
            name: 'Luna',
            bot: {
                username: 'Luna',
                entity: { position: { x: 0.5, y: 64, z: 0.5 } },
                blockAt: (p) => ({ name: blocks.get(`${p.x},${p.y},${p.z}`) ?? 'air' }),
                players: { Luna: { entity: { position: { x: 0.5, y: 64, z: 0.5 } } }, MartyByrde2: { entity: { position: { x: 4, y: 64, z: 0 } } }, Far: {} },
                entities: { 1: { name: 'item', position: { x: 1, y: 64, z: 1 }, getDroppedItem: () => ({ name: 'bread', count: 2 }) }, 2: { name: 'cow', position: { x: 1, y: 64, z: 1 } } },
            },
            _workStores: () => ({ chests: { get: (pos) => (pos.x === -2 ? { free_slots: 27 } : null) } }),
        };
        const text = await TOOL_HANDLERS.look(agent, { radius: 4 });
        assert.deepEqual(text.split('\n'), [
            'Lava: 3 blocks away at (3, 64, 0).',
            'Water: none within 4.',
            'Chests: (-2, 64, 0) 27 free slots.',
            'Drops: 2 bread at (1, 64, 1).',
            'Players: MartyByrde2 at (4, 64, 0), 4 blocks away.',
        ]);
        agent.bot.entity = null;
        assert.equal(await TOOL_HANDLERS.look(agent, {}), 'Luna is not in a world yet.');
        const refused = await runTool(agent, {}, 'look', { radius: 99 });
        assert.equal(refused.isError, true);
    });
});
