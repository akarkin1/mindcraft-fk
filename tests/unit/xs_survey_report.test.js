// v0.1.4.15, SPEC 2.5 and 2.6 (engineer E1): the texts of src/agent/packs/survey/texts.js word for word: the report of
// !surveyBase for the example of 2.5, its order (the home, the basement, the hall, the farms, the pens, the cane, the tied
// animals, the portal, the mine entrance, the cave mouths; a kept find after the items of its kind), the kept find and the
// cave mouth, nothing found, the "again" lines, and the texts of !renameArea, !forgetArea (a base) and !goToBase.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const T = await loadSrc('src/agent/packs/survey/texts.js');

const C = (more = {}) => ({ animals: {}, crops: {}, beds: 0, chests: 0, furnaces: 0, tables: 0, ladders: 0, water: 0, ...more });
const box = (x1, z1, x2, z2, y = 63) => ({ min: { x: x1, y, z: z1 }, max: { x: x2, y: y + 4, z: z2 } });
const area = (kind, name, b, contents = C(), detail = {}) => ({ kind, name, type: kind === 'home' ? 'home' : kind === 'storage' ? 'building' : kind,
    box: b, at: null, entrances: [], contents, border: 'wall', source: 'survey', detail });
const point = (kind, name, at, detail = {}) => ({ kind, name, type: 'place', box: null, at, entrances: [], contents: C(), border: null, source: 'survey', detail });
const farm = (name, w, d, x = 0, z = 0) => area('farm', name, box(x - 1, z - 1, x + w, z + d), C(), { field: { min: { x, y: 63, z }, max: { x: x + w - 1, y: 63, z: z + d - 1 } } });
const pen = (name, animals) => area('pen', name, box(0, 0, 8, 6), C({ animals }));

// The base of the example of 2.5, in the order the survey finds the places.
function example() {
    return [
        area('home', 'house', box(0, 0, 10, 10), C({ beds: 2, animals: { cat: 2 } })),
        { ...area('storage', 'basement', box(1, 1, 9, 9, 56), C({ chests: 9, furnaces: 5 }), { what: 'basement', under: 'house' }), type: 'building',
            entrances: [{ x: 5, y: 63, z: 5, kind: 'trapdoor' }] },
        area('building', 'trading_hall', box(20, 0, 32, 12), C(), { villagers: 7, professions: ['farmer', 'librarian'] }),
        farm('potato_farm', 14, 9, 40, 0),
        farm('carrot_farm', 12, 9, 40, 12),
        farm('wheat_farm', 16, 10, 40, 24),
        pen('cow_pen', { cow: 5 }),
        pen('pig_pen', { pig: 4 }),
        pen('chicken_pen', { chicken: 9, cat: 1 }),
        area('farm', 'cane', box(60, 0, 83, 2), C(), { what: 'cane', count: 22 }),
        point('tied', 'tied_happy_ghast', { x: 12, y: 64, z: -3 }, { animal: 'happy_ghast', animalAt: { x: 14, y: 68, z: -4 } }),
        point('mine_entrance', 'mine_entrance', { x: 5, y: 57, z: 14 }, { what: 'mine_entrance', tunnel: { length: 12, width: 2 } }),
    ];
}

// The cave mouth of the underground (E4's shape): an area of the kind yard with the flag no_enter, and its opening cell.
const caveMouth = (at) => ({ kind: 'yard', name: 'cave_mouth', type: 'building', box: { min: { x: at.x - 1, y: at.y - 1, z: at.z - 1 }, max: { x: at.x + 1, y: at.y + 1, z: at.z + 1 } },
    at, entrances: [], contents: C(), border: 'rock', source: 'survey', flags: { no_enter: true }, detail: { what: 'cave_mouth', no_enter: true } });

const EXAMPLE = 'I found 12 places: house (2 beds), basement (9 chests, 5 furnaces), trading hall (7 villagers), potato farm 14 x 9, carrot farm 12 x 9, '
    + 'wheat farm 16 x 10, cow pen (5 cows), pig pen (4 pigs), chicken pen (9 chickens), cane by the water (22), a tied happy ghast at (12, 64, -3), '
    + 'a mine entrance at (5, 57, 14). All saved. Say "rename X to Y" or "forget X" to correct.';

describe('reportText (2.5)', () => {
    test('the example of 2.5 word for word', () => {
        assert.equal(T.reportText(example(), []), EXAMPLE);
        assert.equal(T.reportText(example()), EXAMPLE, 'kept and changed may be left out');
    });

    test('the order is the report\'s whatever the order of finding: the home, the basement, the hall, the farms, the pens, the cane, the tied, the portal, the mine, the caves', () => {
        const shuffled = [...example()].reverse();
        assert.equal(T.reportText(shuffled, []), EXAMPLE.replace('wheat farm 16 x 10, carrot farm 12 x 9, potato farm 14 x 9', 'x')
            .replace('potato farm 14 x 9, carrot farm 12 x 9, wheat farm 16 x 10', 'wheat farm 16 x 10, carrot farm 12 x 9, potato farm 14 x 9')
            .replace('cow pen (5 cows), pig pen (4 pigs), chicken pen (9 chickens)', 'chicken pen (9 chickens), pig pen (4 pigs), cow pen (5 cows)'),
        'within a role the items keep the order they were found in');
        assert.deepEqual(T.REPORT_ORDER, ['home', 'basement', 'hall', 'building', 'farm', 'pen', 'cane', 'tied', 'portal', 'mine', 'cave']);
        const all = [point('portal', 'portal', { x: 1, y: 64, z: 1 }), area('storage', 'storage', box(0, 0, 4, 4), C({ chests: 3 })), ...example(),
            caveMouth({ x: 31, y: 52, z: 31 })];
        assert.equal(T.reportText(all, []), 'I found 15 places: house (2 beds), basement (9 chests, 5 furnaces), trading hall (7 villagers), storage (3 chests), '
            + 'potato farm 14 x 9, carrot farm 12 x 9, wheat farm 16 x 10, cow pen (5 cows), pig pen (4 pigs), chicken pen (9 chickens), cane by the water (22), '
            + 'a tied happy ghast at (12, 64, -3), a portal at (1, 64, 1), a mine entrance at (5, 57, 14), a cave mouth at (31, 52, 31) that I keep out of. '
            + 'All saved. Say "rename X to Y" or "forget X" to correct.');
    });

    test('a kept find comes after the items of its kind: a field at (x, y, z) inside your "wheat farm" (kept as yours)', () => {
        const kept = [{ name: 'potato_farm', inside: 'wheat_farm', kind: 'farm', at: { x: 4, y: 64, z: 2 }, place: farm('potato_farm', 9, 5) }];
        assert.equal(T.reportText(example(), kept), EXAMPLE.replace('wheat farm 16 x 10, cow pen', 'wheat farm 16 x 10, a field at (4, 64, 2) inside your "wheat farm" (kept as yours), cow pen'));
        assert.equal(T.keptText(kept[0]), 'a field at (4, 64, 2) inside your "wheat farm" (kept as yours)');
        assert.equal(T.keptText({ name: 'cow_pen', inside: 'yard', at: { x: 1, y: 64, z: 1 }, place: pen('cow_pen', { cow: 2 }) }), 'a pen at (1, 64, 1) inside your "yard" (kept as yours)');
        assert.equal(T.keptText({ name: 'house', inside: 'home', at: { x: 1, y: 64, z: 1 }, place: area('home', 'house', box(0, 0, 4, 4)) }), 'a house at (1, 64, 1) inside your "home" (kept as yours)');
        assert.equal(T.keptText({ name: 'portal', inside: 'yard', at: { x: 1, y: 64, z: 1 }, place: point('portal', 'portal', { x: 1, y: 64, z: 1 }) }), 'a portal at (1, 64, 1) inside your "yard" (kept as yours)');
        assert.equal(T.keptText({ name: 'cane', inside: 'wheat_farm', place: area('farm', 'cane', box(0, 0, 4, 0), C(), { what: 'cane', count: 5 }) }), 'cane at (2, 65, 0) inside your "wheat farm" (kept as yours)');
        const only = T.reportText([farm('wheat_farm', 16, 10)], kept);
        assert.equal(only, 'I found 1 place: wheat farm 16 x 10, a field at (4, 64, 2) inside your "wheat farm" (kept as yours). All saved. Say "rename X to Y" or "forget X" to correct.');
    });

    test('the cave mouth: a cave mouth at (x, y, z) that I keep out of; one place is singular; nothing gives the empty text', () => {
        assert.equal(T.reportText([caveMouth({ x: 3, y: 50, z: 9 })], []),
            'I found 1 place: a cave mouth at (3, 50, 9) that I keep out of. All saved. Say "rename X to Y" or "forget X" to correct.');
        assert.equal(T.itemText(point('cave_mouth', 'cave_mouth_2', { x: 3, y: 50, z: 9 })), 'a cave mouth 2 at (3, 50, 9) that I keep out of');
        assert.equal(T.reportText([], []), '');
        assert.equal(T.reportText(null, null), '');
    });

    test('every number is counted: no bed, no chest, no animal, no villager gives no parentheses; the farm\'s size is the field\'s, the box without a field', () => {
        assert.equal(T.itemText(area('building', 'building', box(0, 0, 4, 4))), 'building');
        assert.equal(T.itemText(area('home', 'house', box(0, 0, 4, 4), C({ beds: 1, chests: 2, furnaces: 1, tables: 3 }))), 'house (1 bed, 2 chests, 1 furnace)');
        assert.equal(T.itemText(pen('pen', {})), 'pen');
        assert.equal(T.itemText(pen('cow_pen', { cow: 3, pig: 2, cat: 1, sheep: 2 })), 'cow pen (3 cows, 2 pigs, 2 sheep)');
        assert.equal(T.itemText(pen('sheep_pen', { sheep: 1 })), 'sheep pen (1 sheep)');
        assert.equal(T.itemText(area('building', 'trading_hall', box(0, 0, 4, 4), C(), { villagers: 1, professions: ['farmer'] })), 'trading hall (1 villager)');
        assert.equal(T.itemText(point('trading_hall', 'trading_hall_2', { x: 0, y: 64, z: 0 }, { villagers: 2, professions: [] })), 'trading hall 2 (2 villagers)');
        assert.equal(T.itemText(farm('potato_farm_2', 9, 5)), 'potato farm 2 9 x 5');
        assert.equal(T.itemText({ kind: 'farm', name: 'farm', box: box(-1, -1, 9, 5), contents: C(), detail: {} }), 'farm 11 x 7');
        assert.equal(T.itemText(area('farm', 'cane', box(0, 0, 4, 0), C(), { what: 'cane', count: 7 })), 'cane by the water (7)');
        assert.equal(T.itemText(point('portal', 'portal_2', { x: 1, y: 2, z: 3 })), 'a portal 2 at (1, 2, 3)');
        assert.equal(T.itemText({ name: 'basement', kind: 'home', type: 'home', box: box(0, 0, 4, 4, 50), contents: C({ beds: 1, chests: 2 }), detail: { under: 'house' } }), 'basement (1 bed, 2 chests)');
    });

    test('roleOf: by the kind, the detail and the name, so the places of the underground (E4) fall into place', () => {
        assert.equal(T.roleOf(area('home', 'house', box(0, 0, 4, 4))), 'home');
        assert.equal(T.roleOf(area('storage', 'basement', box(0, 0, 4, 4), C(), { under: 'house' })), 'basement');
        assert.equal(T.roleOf(area('building', 'cellar', box(0, 0, 4, 4), C(), { under: 'house' })), 'basement');
        assert.equal(T.roleOf(area('building', 'trading_hall', box(0, 0, 4, 4), C(), { villagers: 3, professions: ['x'] })), 'hall');
        assert.equal(T.roleOf(area('building', 'hall', box(0, 0, 4, 4), C(), { villagers: 2, professions: [] })), 'hall');
        assert.equal(T.roleOf(area('storage', 'storage', box(0, 0, 4, 4))), 'building');
        assert.equal(T.roleOf(area('yard', 'yard', box(0, 0, 4, 4))), 'building');
        assert.equal(T.roleOf(farm('potato_farm', 9, 5)), 'farm');
        assert.equal(T.roleOf(area('farm', 'cane_2', box(0, 0, 4, 4), C(), { what: 'cane', count: 3 })), 'cane');
        assert.equal(T.roleOf(pen('cow_pen', { cow: 1 })), 'pen');
        assert.equal(T.roleOf(point('tied', 'tied_happy_ghast', { x: 0, y: 0, z: 0 })), 'tied');
        assert.equal(T.roleOf(point('portal', 'portal', { x: 0, y: 0, z: 0 })), 'portal');
        assert.equal(T.roleOf({ name: 'mine_entrance_2', x: 1, y: 2, z: 3 }), 'mine');
        assert.equal(T.roleOf(point('mine_entrance', 'the_shaft', { x: 0, y: 0, z: 0 }, { what: 'mine_entrance' })), 'mine');
        assert.equal(T.roleOf({ name: 'cave_mouth', type: 'building', flags: { no_enter: true } }), 'cave');
        assert.equal(T.roleOf(caveMouth({ x: 0, y: 0, z: 0 })), 'cave');
        assert.equal(T.roleOf({ name: 'cellar', kind: 'storage', detail: { what: 'basement' } }), 'basement');
        assert.equal(T.roleOf(null), 'building');
    });

    test('tiedRuleText: the one sentence when a tied animal is among the places, else nothing', () => {
        assert.equal(T.tiedRuleText(example()), 'Never untie, never break that post.');
        assert.equal(T.tiedRuleText([farm('potato_farm', 9, 5)]), '');
        assert.equal(T.tiedRuleText(null), '');
    });
});

describe('nothingText and the "again" lines (2.5)', () => {
    test('nothing: I found no place of a base within N blocks. Stand in the base and say it again.', () => {
        assert.equal(T.nothingText(128), 'I found no place of a base within 128 blocks. Stand in the base and say it again.');
        assert.equal(T.nothingText(64.7), 'I found no place of a base within 64 blocks. Stand in the base and say it again.');
        assert.equal(T.nothingFoundText, T.nothingText, 'the name of the brief is the same text');
    });

    test('again: the example word for word, from the differences E4 computed ({ more, changed, added, gone })', () => {
        assert.equal(T.againText('east', { more: [{ name: 'cow_pen', animal: 'cow', count: 2 }], added: ['wheat_farm'], gone: ['pig_pen'] }),
            'I surveyed "east" again: 2 more cows in the cow pen, the wheat farm is new, the pig pen is gone. The rest as saved.');
        assert.equal(T.againText('east', { more: [], changed: [], added: [], gone: [] }), 'I surveyed "east" again: nothing changed.');
        assert.equal(T.againText('east', null), 'I surveyed "east" again: nothing changed.');
        assert.equal(T.againText('east', {}), 'I surveyed "east" again: nothing changed.');
    });

    test('again: fewer animals, one animal, sheep, a changed box, several of each, a count of 0 says nothing', () => {
        assert.equal(T.againText('base', { more: [{ name: 'sheep_pen', animal: 'sheep', count: -1 }, { name: 'chicken_pen', animal: 'chicken', count: 1 },
            { name: 'cow_pen', animal: 'cow', count: 0 }], changed: ['potato_farm', 'house'], added: ['portal'], gone: ['tied_happy_ghast'] }),
        'I surveyed "base" again: 1 fewer sheep in the sheep pen, 1 more chicken in the chicken pen, the potato farm changed, the house changed, '
            + 'the portal is new, the tied happy ghast is gone. The rest as saved.');
        assert.equal(T.againText('east', { more: [{ name: 'cow_pen', animal: 'minecraft:cow', count: -3 }] }), 'I surveyed "east" again: 3 fewer cows in the cow pen. The rest as saved.');
    });

    test('again with kept finds (W126 part C): after the gone ones, with keptText; a kept find alone is a difference; nothing at all stays "nothing changed"', () => {
        const kept = [{ name: 'potato_farm', inside: 'wheat_farm', kind: 'farm', at: { x: 4, y: 64, z: 2 }, place: farm('potato_farm', 9, 5) }];
        assert.equal(T.againText('east', { added: ['pig_pen'] }, kept),
            'I surveyed "east" again: the pig pen is new, a field at (4, 64, 2) inside your "wheat farm" (kept as yours). The rest as saved.');
        assert.equal(T.againText('east', { more: [], changed: [], added: [], gone: [] }, kept),
            'I surveyed "east" again: a field at (4, 64, 2) inside your "wheat farm" (kept as yours). The rest as saved.');
        assert.equal(T.againText('east', { gone: ['pig_pen'] }, [...kept, { name: 'portal', inside: 'yard', at: { x: 1, y: 64, z: 1 }, place: point('portal', 'portal', { x: 1, y: 64, z: 1 }) }]),
            'I surveyed "east" again: the pig pen is gone, a field at (4, 64, 2) inside your "wheat farm" (kept as yours), a portal at (1, 64, 1) inside your "yard" (kept as yours). The rest as saved.');
        assert.equal(T.againText('east', null, []), 'I surveyed "east" again: nothing changed.');
        assert.equal(T.againText('east', null, null), 'I surveyed "east" again: nothing changed.');
    });
});

describe('the texts of !renameArea, !forgetArea and !goToBase (2.5)', () => {
    test('word for word', () => {
        assert.equal(T.renamedText('potato_farm', 'spuds'), 'I renamed "potato_farm" to "spuds".');
        assert.equal(T.unknownPlaceText('x'), 'I know no place "x".');
        assert.equal(T.placeExistsText('spuds'), 'There is a place "spuds" already.');
        assert.equal(T.forgotBaseText('east', 12), 'I forgot the base "east" and its 12 places.');
        assert.equal(T.forgotBaseText('east', 1), 'I forgot the base "east" and its 1 place.');
        assert.equal(T.forgotBaseText('east', null), 'I forgot the base "east" and its 0 places.');
        assert.equal(T.atBaseText('east'), 'I am at the base "east".');
        assert.equal(T.noBaseText('east'), 'I know no base "east".');
    });
});
