// T1, spec v0.1.4.9 I7, C3, C4: whereAmI(bot, now, extra) of src/agent/reflex/where_am_i.js with the third argument
// { mine: { name, tunnel, level } | null } -> { area, depth, underground, mine }, underground also when extra.mine
// is not null, without the argument the result of v0.1.4.8 plus mine null; knowledgeText of
// src/agent/knowledge/knowledge_text.js with where.mine and mines[].passed: the two lines of where the bot is, the
// line of the ore left behind after the mines line and before the places, cut before the chests. The handoff: the
// tunnel is counted from 1 in the text (mineAt gives an index), the order of the ore line is by value.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { loadSrc } from '../helpers/load.js';
import { createBlockWorld } from '../helpers/block_world.js';

const W = await loadSrc('src/agent/reflex/where_am_i.js');
const K = await loadSrc('src/agent/knowledge/knowledge_text.js');

const HEADER = 'WHAT YOU KNOW (from memory, no need to check):';

// the bot on flat ground (feet y 64), or 20 blocks under it in a cave
function botAt(y, area = null) {
    const world = createBlockWorld().flatGround(63, 'grass_block', 'stone');
    if (y < 63) world.fill(-2, y, -2, 2, y + 2, 2, 'air');
    return {
        entity: { position: new Vec3(0.5, y, 0.5) },
        game: { minY: -64, height: 384 },
        blockAt: (p) => world.blockAt(p),
        areaGuard: area ? { areaAt: () => area } : undefined,
    };
}

describe('I7, C4: whereAmI with the third argument', () => {
    test('on the surface, no area, no mine: underground false, mine null', () => {
        const r = W.whereAmI(botAt(64), 1000, { mine: null });
        assert.deepEqual({ area: r.area, underground: r.underground, mine: r.mine }, { area: null, underground: false, mine: null });
        assert.equal(r.depth, 0);
    });

    test('extra.mine not null: underground true, also near the surface; the mine is returned as given', () => {
        const mine = { name: 'mine', tunnel: null, level: 61 };
        const r = W.whereAmI(botAt(64), 1000, { mine });
        assert.equal(r.underground, true);
        assert.deepEqual(r.mine, mine);
    });

    test('without the third argument: the result of v0.1.4.8 plus mine null', () => {
        const r = W.whereAmI(botAt(64), 1000);
        assert.deepEqual(Object.keys(r).sort(), ['area', 'depth', 'mine', 'underground']);
        assert.equal(r.mine, null);
        assert.equal(r.underground, false);
        const deep = W.whereAmI(botAt(40), 1000);
        assert.equal(deep.underground, true, '24 blocks under the ground, as in v0.1.4.8');
        assert.equal(deep.mine, null);
    });

    test('an area of type mine: underground as in v0.1.4.8', () => {
        const r = W.whereAmI(botAt(64, { name: 'mine', type: 'mine' }), 1000);
        assert.equal(r.underground, true);
        assert.deepEqual(r.area, { name: 'mine', type: 'mine' });
    });

    test('never throws: a bot without a body keeps the mine of extra', () => {
        const r = W.whereAmI({}, 1000, { mine: { name: 'mine', tunnel: 0, level: 25 } });
        assert.equal(r.underground, true);
        assert.deepEqual(r.mine, { name: 'mine', tunnel: 0, level: 25 });
    });
});

// ------------------------------------------------------------------------------ knowledgeText

const MINE = (passed = []) => ({ name: 'mine', source: 'player', ore: 'iron', entrance: { x: 30, y: 60, z: 4 }, level: 25, dimension: 'overworld', passed });
const P = (ore, i, reason = 'pickaxe') => ({ ore, x: 20 + i, y: 25, z: 5, reason, seen: '2026-09-30T10:00:00Z' });
const GOLD2_COAL6 = [P('gold_ore', 0), P('coal_ore', 1, 'inventory'), P('gold_ore', 2), P('coal_ore', 3, 'inventory'), P('coal_ore', 4, 'vein'),
    P('coal_ore', 5, 'vein'), P('coal_ore', 6, 'stopped'), P('coal_ore', 7, 'lava')];

describe('I7, C3: the line of where the bot is', () => {
    test('in the area "mine", in a tunnel: `You are in the area "mine" (mine), in the mine "mine", tunnel 1 at level 25, 35 blocks under the ground.`', () => {
        const where = { area: { name: 'mine', type: 'mine' }, depth: 35, underground: true, mine: { name: 'mine', tunnel: 0, level: 25 } };
        assert.equal(K.whereLine(where), 'You are in the area "mine" (mine), in the mine "mine", tunnel 1 at level 25, 35 blocks under the ground.');
        const text = K.knowledgeText({ where });
        assert.equal(text.split('\n')[1], 'You are in the area "mine" (mine), in the mine "mine", tunnel 1 at level 25, 35 blocks under the ground.');
    });

    test('on the route: `You are in the mine "mine", on its way in, 12 blocks under the ground.`', () => {
        const where = { area: null, depth: 12, underground: true, mine: { name: 'mine', tunnel: null, level: 48 } };
        assert.equal(K.whereLine(where), 'You are in the mine "mine", on its way in, 12 blocks under the ground.');
    });

    test('where.mine null: the lines of v0.1.4.8', () => {
        assert.equal(K.whereLine({ area: { name: 'farm', type: 'farm' }, depth: 0, underground: false, mine: null }), 'You are in the area "farm" (farm), on the surface.');
        assert.equal(K.whereLine({ area: null, depth: 26, underground: true, mine: null }), 'You are 26 blocks under the ground.');
    });
});

describe('I7, C3: the line of the ore left behind', () => {
    test('`Ore left behind: gold 2, coal 6 in the mine "mine".`', () => {
        const text = K.knowledgeText({ mines: [MINE(GOLD2_COAL6)] });
        assert.ok(text.split('\n').includes('Ore left behind: gold 2, coal 6 in the mine "mine".'), text);
    });

    test('by value (handoff): diamond before iron, whatever the counts', () => {
        const text = K.knowledgeText({ mines: [MINE([P('iron_ore', 0), P('iron_ore', 1), P('iron_ore', 2), P('diamond_ore', 3)])] });
        assert.ok(text.split('\n').includes('Ore left behind: diamond 1, iron 3 in the mine "mine".'), text);
    });

    test('no entries: no line', () => {
        const text = K.knowledgeText({ mines: [MINE([])] });
        assert.ok(!text.includes('Ore left behind'), text);
    });

    test('the order: after the mines line, before the places; the chests before the areas as in v0.1.4.8', () => {
        const text = K.knowledgeText({
            where: { area: null, depth: 0, underground: false, mine: null },
            chests: [{ x: 11, y: 64, z: 53, items: { wheat: 28 } }],
            areas: [{ name: 'home', type: 'home' }],
            mines: [MINE(GOLD2_COAL6)],
            places: [{ name: 'home', x: 12, y: 64, z: 52 }],
        }, 2000);
        const lines = text.split('\n');
        const at = (prefix) => lines.findIndex((l) => l.startsWith(prefix));
        assert.equal(lines[0], HEADER);
        assert.ok(at('Mines: ') > 0, text);
        assert.equal(at('Ore left behind: '), at('Mines: ') + 1, text);
        assert.ok(at('Places: ') > at('Ore left behind: '), text);
    });

    test('the cut: the ore line stays when the chests are cut', () => {
        const input = {
            chests: [{ x: 11, y: 64, z: 53, items: { wheat: 28, cobblestone: 81, oak_log: 12 } }],
            mines: [MINE(GOLD2_COAL6)],
        };
        const full = K.knowledgeText(input, 2000);
        const chestLine = full.split('\n').find((l) => l.startsWith('Chest '));
        assert.ok(chestLine, full);
        const text = K.knowledgeText(input, full.length - 1);
        assert.ok(text.includes('Ore left behind: gold 2, coal 6 in the mine "mine".'), text);
        assert.ok(!text.includes('Chest '), text);
    });
});
