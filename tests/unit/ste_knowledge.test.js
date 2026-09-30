// Spec v0.1.4.8 E5 and I9 (part E, engineer E5): knowledgeText, the block "what I know" for the chat
// prompt (finding C1). Pure. The data are copies of the owner's files of the play test (chests.json,
// mines.json, areas.json, places.json of the world seed-ce66bf80acdefa75), read only.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { assertCleanImport } from '../helpers/module_rules.js';
import { importsOf } from '../helpers/hygiene.js';

const K = await loadSrc('src/agent/knowledge/knowledge_text.js');

// chests.json of the owner, the kinds of the chest at (11, 67, 53) as in the example of the spec: 38 kinds
const BIG_CHEST_ITEMS = {
    leaf_litter: 104, cobblestone: 81, raw_copper: 52, wheat_seeds: 52, lapis_lazuli: 49, coal: 39, dirt: 27, copper_ingot: 23,
    cobblestone_stairs: 22, sand: 18, granite: 18, diorite: 18, granite_stairs: 12, iron_ingot: 6, oak_slab: 5, oak_sapling: 5, lilac: 5,
    birch_log: 5, leather: 4, oak_log: 3, spider_eye: 3, oak_door: 2, charcoal: 2, feather: 2, birch_sapling: 2, stone_sword: 1,
    white_banner: 1, bone: 1, stick: 1, bone_meal: 1, wooden_axe: 1, wooden_shovel: 1, rotten_flesh: 1, flint: 1, bow: 1,
    ominous_bottle: 1, white_wool: 1, torch: 1,
};
const CHESTS = [
    { x: 11, y: 41, z: 44, dimension: 'overworld', kind: 'chest', items: {}, free_slots: 27 },
    { x: 11, y: 67, z: 53, dimension: 'overworld', kind: 'chest', items: BIG_CHEST_ITEMS, free_slots: 14 },
];
// mines.json of the owner
const MINES = [{
    ore: 'iron', entrance: { x: 9, y: 67, z: 58 }, level: 16, base: null, chest: null, direction: 'west', length: 0, shaft: 'ladder',
    dimension: 'overworld', ores: ['iron'], end: null, tunnel: [],
    route: [{ kind: 'ladder', x: 9, z: 58, top: 66, bottom: 25, face: 'west', entry: { x: 10, y: 67, z: 58 } }],
}];
// the areas of the example of the spec: the house saved by autoHome, the farm of the owner, the mine
const AREAS = [
    { name: 'home', type: 'home', min: { x: 6, y: 66, z: 46 }, max: { x: 15, y: 72, z: 57 }, entrances: [{ x: 9, y: 67, z: 46, kind: 'door' }] },
    { name: 'farm', type: 'farm', min: { x: -13, y: 61, z: 23 }, max: { x: -6, y: 65, z: 34 }, entrances: [{ x: -6, y: 63, z: 28, kind: 'gate' }] },
    { name: 'mine', type: 'mine', min: { x: 6, y: 38, z: 36 }, max: { x: 12, y: 58, z: 49 }, entrances: [{ x: 9, y: 41, z: 43, kind: 'door' }] },
];
// places.json of the owner
const PLACES = {
    home: { x: 12.457680096938242, y: 67, z: 52.51020485418574, dimension: 'overworld' },
    mine: { x: 9, y: 67, z: 58, dimension: 'overworld' },
    mining_tunnel: { x: -1.5726716385768496, y: 30, z: 25.500131542981496, dimension: 'overworld' },
};
const AT_FARM = { area: { name: 'farm', type: 'farm' }, depth: 0, underground: false, pos: { x: -9.5, y: 64, z: 28.5 } };

const EXAMPLE = [
    'WHAT YOU KNOW (from memory, no need to check):',
    'You are in the area "farm" (farm), on the surface.',
    'Chest (11, 67, 53): leaf_litter 104, cobblestone 81, raw_copper 52, wheat_seeds 52, lapis_lazuli 49, coal 39 and 32 more kinds.',
    'Chest (11, 41, 44): empty.',
    'Areas: home (home), farm (farm, 1 gate), mine (mine).',
    'Mines: iron, entrance (9, 67, 58), level 16.',
].join('\n');

describe('knowledgeText: the format of the spec (E5)', () => {
    test('the example of the spec, word for word', () => {
        assert.equal(K.knowledgeText({ chests: CHESTS, areas: AREAS, mines: MINES, where: AT_FARM }), EXAMPLE);
    });

    test('the nearest chests first', () => {
        const deep = { ...AT_FARM, area: { name: 'mine', type: 'mine' }, underground: true, depth: 26, pos: { x: 10.5, y: 41, z: 44.5 } };
        const lines = K.knowledgeText({ chests: CHESTS, where: deep }).split('\n');
        assert.deepEqual(lines, [
            K.KNOWLEDGE_HEADER,
            'You are in the area "mine" (mine), 26 blocks under the ground.',
            'Chest (11, 41, 44): empty.',
            'Chest (11, 67, 53): leaf_litter 104, cobblestone 81, raw_copper 52, wheat_seeds 52, lapis_lazuli 49, coal 39 and 32 more kinds.',
        ]);
        const noPos = K.knowledgeText({ chests: CHESTS }).split('\n');
        assert.equal(noPos[1], 'Chest (11, 41, 44): empty.', 'without a position: the order given');
    });

    test('the places come last; stores with list() and a MemoryBank are read too', () => {
        const text = K.knowledgeText({ chests: { list: () => CHESTS }, areas: { list: () => AREAS }, mines: { list: () => MINES }, places: PLACES, where: AT_FARM }, 2000);
        assert.equal(text, `${EXAMPLE}\nPlaces: home (12, 67, 52), mine (9, 67, 58), mining_tunnel (-2, 30, 25).`);
        const bank = { getJson: () => ({ home: [12.4, 67, 52.5] }) };
        assert.match(K.knowledgeText({ places: bank }), /\nPlaces: home \(12, 67, 52\)\.$/);
        assert.match(K.knowledgeText({ places: [{ name: 'home', x: 1, y: 2, z: 3 }, { name: 'bad' }] }), /\nPlaces: home \(1, 2, 3\)\.$/);
    });

    test('cut at whole lines to maxChars: where, areas and mines stay, then the nearest chests, then the places', () => {
        const far = Array.from({ length: 6 }, (_, i) => ({ x: 40 + 10 * i, y: 64, z: 0, items: { a_item: 10 + i, b_item: 5, c_item: 4, d_item: 3, e_item: 2, f_item: 1, g_item: 1 } }));
        const input = { chests: [...far, ...CHESTS], areas: AREAS, mines: MINES, places: PLACES, where: AT_FARM };
        const full = K.knowledgeText(input, 5000);
        assert.ok(full.length > 600, `${full.length}`);
        const cut = K.knowledgeText(input);
        assert.ok(cut.length <= 600, `${cut.length}`);
        const lines = cut.split('\n');
        for (const line of lines) assert.ok(full.split('\n').includes(line), 'only whole lines');
        assert.deepEqual(lines.slice(0, 4), EXAMPLE.split('\n').slice(0, 4), 'the header, where, then the two nearest chests');
        assert.ok(lines.includes('Areas: home (home), farm (farm, 1 gate), mine (mine).'));
        assert.ok(lines.includes('Mines: iron, entrance (9, 67, 58), level 16.'));
        assert.ok(lines.some(l => l.startsWith('Chest (40, 64, 0)')), 'the nearest of the far chests');
        assert.ok(!lines.some(l => l.startsWith('Chest (90, 64, 0)')), 'the farthest chest is cut');
        assert.ok(!cut.includes('Places:'), 'the places come after the chests');
        const order = lines.map(l => l.split(' ')[0].replace(/:$/, ''));
        assert.ok(order.indexOf('Areas') > order.lastIndexOf('Chest'), 'the lines keep the order of the format');
        const small = K.knowledgeText(input, 250);
        assert.ok(small.length <= 250 && small.includes('Areas: ') && small.includes('Mines: '), small);
        assert.ok(!small.includes('leaf_litter'), 'the long line of a chest that does not fit is left out');
        assert.equal(K.knowledgeText({ chests: CHESTS }, 10), '', 'not even the header fits');
        assert.equal(K.KNOWLEDGE_MAX_CHARS, 600);
    });

    test('nothing known: empty; bad input never throws', () => {
        assert.equal(K.knowledgeText({}), '');
        assert.equal(K.knowledgeText(null), '');
        assert.equal(K.knowledgeText({ chests: { list() { throw new Error('x'); } }, areas: 'x', mines: [null, { ore: 'iron' }], places: 5 }), '');
        assert.equal(K.knowledgeText({ where: { area: null, depth: 0, underground: false } }), `${K.KNOWLEDGE_HEADER}\nYou are on the surface.`);
    });
});

describe('the lines', () => {
    test('whereLine', () => {
        assert.equal(K.whereLine({ area: { name: 'farm', type: 'farm' }, underground: false }), 'You are in the area "farm" (farm), on the surface.');
        assert.equal(K.whereLine({ area: null, depth: 26, underground: true }), 'You are 26 blocks under the ground.');
        assert.equal(K.whereLine({ area: null, depth: 0, underground: true }), 'You are under the ground.');
        assert.equal(K.whereLine({ area: { name: 'old', type: null }, underground: false }), 'You are in the area "old" (building), on the surface.');
        assert.equal(K.whereLine(null), '');
    });

    test('chest, areas, mines and places lines', () => {
        assert.equal(K.chestKnowledgeLine({ x: -13, y: 63, z: 28, items: { wheat: 28, wheat_seeds: 3 } }), 'Chest (-13, 63, 28): wheat 28, wheat_seeds 3.');
        assert.equal(K.chestKnowledgeLine({ x: 1.7, y: 2, z: 3, items: { a: 0 } }), 'Chest (1, 2, 3): empty.');
        assert.equal(K.areasLine([{ name: 'pen', type: 'pen', entrances: [{ kind: 'gate' }, { kind: 'gate' }] }, { name: 'shed', entrances: [] }, { type: 'farm' }]),
            'Areas: pen (pen, 2 gates), shed (building).');
        assert.equal(K.areasLine([]), '');
        assert.equal(K.minesLine([MINES[0], { ore: 'coal', ores: ['coal', 'redstone'], entrance: { x: 1, y: 70, z: 2 }, level: 56 }]),
            'Mines: iron, entrance (9, 67, 58), level 16; coal and redstone, entrance (1, 70, 2), level 56.');
        assert.equal(K.placesLine([]), '');
    });

    test('the module is pure: no imports, no side effects', () => {
        assert.deepEqual(importsOf('src/agent/knowledge/knowledge_text.js').static, []);
        assertCleanImport('src/agent/knowledge/knowledge_text.js');
    });
});
