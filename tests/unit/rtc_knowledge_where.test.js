// Spec v0.1.4.9 C3, C4 and I7 (part C, engineer E3): the line of where the bot is names the mine
// (knowledge_text.js whereLine with where.mine), the new line of the ore left behind (passedOreLine, from
// mines[].passed of I6), its place in the knowledge block and in the cut, and whereAmI(bot, now, extra)
// of reflex/where_am_i.js with extra.mine.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { createBlockWorld } from '../helpers/block_world.js';

const K = await loadSrc('src/agent/knowledge/knowledge_text.js');
const W = await loadSrc('src/agent/reflex/where_am_i.js');

const MINE_AREA = { name: 'mine', type: 'mine' };
const IN_TUNNEL = { area: MINE_AREA, depth: 35, underground: true, mine: { name: 'mine', tunnel: 0, level: 25 } };
const ON_ROUTE = { area: null, depth: 12, underground: true, mine: { name: 'mine', tunnel: null, level: 41 } };

const entry = (ore, x, reason = 'pickaxe') => ({ ore, x, y: 25, z: 10, reason, seen: 1000 + x });
// a mine of the player (I6) and a mine of the bot (v0.1.4.7, name null)
const PLAYER_MINE = {
    name: 'mine', source: 'player', ore: 'iron', entrance: { x: 30, y: 60, z: 4 }, level: 25, dimension: 'overworld',
    route: [], room: null, tunnels: [],
    passed: [entry('coal_ore', 1), entry('gold_ore', 2), entry('coal_ore', 3), entry('deepslate_gold_ore', 4), entry('coal_ore', 5),
        entry('coal_ore', 6), entry('coal_ore', 7), entry('coal_ore', 8)],
};
const BOT_MINE = {
    name: null, source: 'bot', ore: 'iron', entrance: { x: 9, y: 67, z: 58 }, level: 16, dimension: 'overworld', route: [], tunnels: [],
    passed: [entry('iron', 1, 'inventory'), entry('redstone', 2, 'vein')],
};

describe('whereLine with where.mine (I7)', () => {
    test('the two lines of the spec, word for word', () => {
        assert.equal(K.whereLine(IN_TUNNEL), 'You are in the area "mine" (mine), in the mine "mine", tunnel 1 at level 25, 35 blocks under the ground.');
        assert.equal(K.whereLine(ON_ROUTE), 'You are in the mine "mine", on its way in, 12 blocks under the ground.');
    });

    test('the tunnel is shown from 1; without a level no level', () => {
        assert.equal(K.whereLine({ ...ON_ROUTE, mine: { name: 'deep', tunnel: 2, level: -40 } }), 'You are in the mine "deep", tunnel 3 at level -40, 12 blocks under the ground.');
        assert.equal(K.whereLine({ ...ON_ROUTE, mine: { name: 'deep', tunnel: 1 } }), 'You are in the mine "deep", tunnel 2, 12 blocks under the ground.');
    });

    test('in a mine the bot is under the ground, also when where.underground is false', () => {
        assert.equal(K.whereLine({ area: null, depth: 3, underground: false, mine: { name: 'mine', tunnel: null, level: 60 } }),
            'You are in the mine "mine", on its way in, 3 blocks under the ground.');
        assert.equal(K.whereLine({ area: null, depth: 0, underground: false, mine: { name: 'mine', tunnel: null, level: 60 } }),
            'You are in the mine "mine", on its way in, under the ground.');
    });

    test('a mine of the bot has no name: "a mine"', () => {
        assert.equal(K.whereLine({ area: null, depth: 30, underground: true, mine: { name: null, tunnel: 0, level: 16 } }),
            'You are in a mine, tunnel 1 at level 16, 30 blocks under the ground.');
    });

    test('without a mine: the lines of v0.1.4.8', () => {
        assert.equal(K.whereLine({ area: { name: 'farm', type: 'farm' }, underground: false, mine: null }), 'You are in the area "farm" (farm), on the surface.');
        assert.equal(K.whereLine({ area: null, depth: 26, underground: true, mine: null }), 'You are 26 blocks under the ground.');
        assert.equal(K.whereLine({ area: MINE_AREA, depth: 26, underground: true }), 'You are in the area "mine" (mine), 26 blocks under the ground.');
        assert.equal(K.whereLine({ area: null, depth: 0, underground: false, mine: 'x' }), 'You are on the surface.', 'a mine that is no object');
    });
});

describe('passedOreLine (I7)', () => {
    test('the line of the spec, word for word: gold 2, coal 6 in the mine "mine"', () => {
        assert.equal(K.passedOreLine([PLAYER_MINE]), 'Ore left behind: gold 2, coal 6 in the mine "mine".');
        const reversed = { ...PLAYER_MINE, passed: [...PLAYER_MINE.passed].reverse() };
        assert.equal(K.passedOreLine([reversed]), 'Ore left behind: gold 2, coal 6 in the mine "mine".', 'the order of the entries does not matter');
    });

    test('several mines joined by "; "', () => {
        const deep = { ...PLAYER_MINE, name: 'deep', passed: [entry('coal', 1), entry('coal', 2), entry('coal', 3)] };
        const gold = { ...PLAYER_MINE, passed: [entry('gold_ore', 1), entry('gold_ore', 2)] };
        assert.equal(K.passedOreLine([gold, deep]), 'Ore left behind: gold 2 in the mine "mine"; coal 3 in the mine "deep".');
    });

    test('the deeper ore of the mining pack first, then other kinds by name', () => {
        const all = ['coal', 'copper', 'iron', 'lapis', 'gold', 'redstone', 'diamond', 'emerald', 'ancient_debris'].map((ore, i) => entry(`${ore}_ore`, i));
        assert.equal(K.passedOreLine([{ ...PLAYER_MINE, passed: all }]),
            'Ore left behind: diamond 1, redstone 1, gold 1, lapis 1, iron 1, copper 1, coal 1, ancient_debris 1, emerald 1 in the mine "mine".');
    });

    test('a mine of the bot is named by its entrance', () => {
        assert.equal(K.passedOreLine([BOT_MINE]), 'Ore left behind: redstone 1, iron 1 in the mine at (9, 67, 58).');
    });

    test('nothing left behind: empty; bad entries are left out; never throws', () => {
        assert.equal(K.passedOreLine([]), '');
        assert.equal(K.passedOreLine(null), '');
        assert.equal(K.passedOreLine([{ ...PLAYER_MINE, passed: [] }, { ...BOT_MINE, passed: undefined }, null, 5]), '');
        assert.equal(K.passedOreLine([{ ...PLAYER_MINE, passed: [null, { ore: 'coal' }, { ore: 5, x: 1, y: 2, z: 3 }, entry('coal', 1)] }]),
            'Ore left behind: coal 1 in the mine "mine".');
    });
});

describe('minesLine: a mine the player named', () => {
    test('shown by its name, not by the ore the store needs; a mine of the bot as before', () => {
        assert.equal(K.minesLine([BOT_MINE, PLAYER_MINE]), 'Mines: iron, entrance (9, 67, 58), level 16; "mine", entrance (30, 60, 4), level 25.');
        assert.equal(K.minesLine([{ name: 'mine', entrance: { x: 1, y: 2, z: 3 } }]), 'Mines: "mine", entrance (1, 2, 3).', 'a named mine without an ore');
    });
});

describe('knowledgeText: the place of the ore line, and the cut', () => {
    const CHESTS = [{ x: 31, y: 41, z: 5, items: { cobblestone: 64, coal: 12 } }, { x: 100, y: 64, z: 100, items: {} }];
    const PLACES = { storage: { x: 31, y: 41, z: 6 } };
    const input = { chests: CHESTS, areas: [{ name: 'mine', type: 'mine' }], mines: [PLAYER_MINE], places: PLACES, where: { ...IN_TUNNEL, pos: { x: 30, y: 25, z: 10 } } };

    test('after the mines line, before the places', () => {
        assert.deepEqual(K.knowledgeText(input, 5000).split('\n'), [
            K.KNOWLEDGE_HEADER,
            'You are in the area "mine" (mine), in the mine "mine", tunnel 1 at level 25, 35 blocks under the ground.',
            'Chest (31, 41, 5): cobblestone 64, coal 12.',
            'Chest (100, 64, 100): empty.',
            'Areas: mine (mine).',
            'Mines: "mine", entrance (30, 60, 4), level 25.',
            'Ore left behind: gold 2, coal 6 in the mine "mine".',
            'Places: storage (31, 41, 6).',
        ]);
    });

    test('in the cut it is taken after the mines and before the chests', () => {
        const full = K.knowledgeText(input, 5000).split('\n');
        const ore = 'Ore left behind: gold 2, coal 6 in the mine "mine".';
        const withoutChests = [full[0], full[1], full[4], full[5], ore];
        const limit = withoutChests.join('\n').length;
        assert.deepEqual(K.knowledgeText(input, limit).split('\n'), withoutChests, 'no room for a chest: the ore line stays');
        const small = K.knowledgeText(input, limit - 1).split('\n');
        assert.ok(!small.includes(ore), 'no room for the ore line: it goes');
        assert.deepEqual(small.slice(0, 2), [full[0], full[1]]);
        assert.ok(small.includes(full[4]) && small.includes(full[5]), 'the areas and the mines stay');
        assert.ok(small.every((line) => full.includes(line)), 'whole lines only');
        const oneChest = [full[0], full[1], full[2], full[4], full[5], ore];
        assert.deepEqual(K.knowledgeText(input, oneChest.join('\n').length).split('\n'), oneChest, 'the nearest chest after the ore line');
    });

    test('only ore left behind is known: header and the ore line', () => {
        assert.equal(K.knowledgeText({ mines: [{ name: 'mine', passed: [entry('coal', 1)] }] }), `${K.KNOWLEDGE_HEADER}\nOre left behind: coal 1 in the mine "mine".`);
    });

    test('mines without passed (v0.1.4.8): no ore line, the text as before', () => {
        const old = { ...BOT_MINE, passed: undefined };
        assert.equal(K.knowledgeText({ mines: [old] }), `${K.KNOWLEDGE_HEADER}\nMines: iron, entrance (9, 67, 58), level 16.`);
    });
});

describe('whereAmI(bot, now, extra) (C4, I7)', () => {
    function makeBot(pos, areaAt = null) {
        const world = createBlockWorld().flatGround(63);
        return {
            entity: { position: pos },
            game: { minY: -64, height: 384 },
            blockAt: (p) => {
                const name = world.get(p.x, p.y, p.z);
                return name === null ? null : { name };
            },
            areaGuard: areaAt ? { areaAt } : undefined,
        };
    }
    const MINE = { name: 'mine', tunnel: null, level: 41 };

    test('extra.mine: mine is given back, and the bot is underground also on the surface', () => {
        assert.deepEqual(W.whereAmI(makeBot({ x: 0.5, y: 64, z: 0.5 }), 1000, { mine: MINE }), { area: null, depth: 0, underground: true, mine: MINE });
        const deep = W.whereAmI(makeBot({ x: 0.5, y: 40, z: 0.5 }), 1000, { mine: { name: 'mine', tunnel: 0, level: 40 } });
        assert.equal(deep.underground, true);
        assert.equal(deep.depth, 24);
        assert.deepEqual(deep.mine, { name: 'mine', tunnel: 0, level: 40 });
    });

    test('with an area: both', () => {
        const r = W.whereAmI(makeBot({ x: 0.5, y: 64, z: 0.5 }, () => ({ name: 'farm', type: 'farm' })), 1000, { mine: MINE });
        assert.deepEqual(r, { area: { name: 'farm', type: 'farm' }, depth: 0, underground: true, mine: MINE });
    });

    test('two arguments (the callers of v0.1.4.8): the result of v0.1.4.8 plus mine null', () => {
        assert.deepEqual(W.whereAmI(makeBot({ x: 0.5, y: 64, z: 0.5 }), 1000), { area: null, depth: 0, underground: false, mine: null });
        assert.deepEqual(W.whereAmI(makeBot({ x: 0.5, y: 64, z: 0.5 })), { area: null, depth: 0, underground: false, mine: null });
        assert.deepEqual(W.whereAmI(makeBot({ x: 0.5, y: 64, z: 0.5 }), 1000, { mine: null }), { area: null, depth: 0, underground: false, mine: null });
    });

    test('a mine that is no object is null', () => {
        for (const extra of [null, undefined, 5, 'mine', { mine: 'mine' }, { mine: true }, { mine: 0 }]) {
            assert.deepEqual(W.whereAmI(makeBot({ x: 0.5, y: 64, z: 0.5 }), 1000, extra).mine, null, JSON.stringify(extra));
        }
    });

    test('never throws; the mine stays when the world cannot be read', () => {
        assert.deepEqual(W.whereAmI(null, 0, { mine: MINE }), { area: null, depth: 0, underground: true, mine: MINE });
        const broken = { entity: { position: { x: 0, y: 30, z: 0 } }, blockAt: () => { throw new Error('no world'); } };
        assert.deepEqual(W.whereAmI(broken, 0, { mine: MINE }), { area: null, depth: 0, underground: true, mine: MINE });
        const evil = { get mine() { throw new Error('x'); } };
        assert.deepEqual(W.whereAmI(makeBot({ x: 0.5, y: 64, z: 0.5 }), 1000, evil), { area: null, depth: 0, underground: false, mine: null });
    });
});
