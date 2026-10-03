// Spec v0.1.4.11 part M (engineer E2), I4: the mine of a second level in the store and in the texts. The
// child record (`parent`, entrance the top cell of the shaft in the parent, key bot:<level>), MineStore
// parentOf and children, chooseMine preferring the child whose level fits the ore, minesText listing a child
// under its parent (`bot:-58 (from the mine "mine")`), forgetMine of a parent forgetting its children. The
// records of v0.1.4.10 keep their shape (no `parent` field). A MineStore in memory.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const S = await loadSrc('src/agent/packs/mining/mine_store.js');
const W = await loadSrc('src/agent/packs/mining/mine_way.js');
const P = await loadSrc('src/agent/packs/mining/mine_player.js');
const O = await loadSrc('src/agent/packs/mining/ore_table.js');

// The mine of the player: entrance (9, 67, 52), the room at y 41, one tunnel at level 30 going north.
const PARENT = () => ({
    name: 'mine', source: 'player', ore: 'iron', entrance: { x: 9, y: 67, z: 52 }, level: 41, dimension: 'overworld',
    route: [{ kind: 'ladder', x: 9, z: 52, top: 66, bottom: 41, face: 'south', entry: { x: 9, y: 67, z: 51 } }],
    room: { center: { x: 9, y: 41, z: 55 }, chest: { x: 10, y: 41, z: 56 }, table: null, furnace: null },
    tunnels: [{ start: { x: 9, y: 30, z: 50 }, dir: 'north', end: { x: 9, y: 30, z: 40 }, level: 30, length: 11, branches: [] }], passed: [],
});

// The child: a shaft from the floor of the room (9, 41, 55) down to -58, its room and tunnel going east.
const CHILD = (level = -58) => ({
    ore: 'diamond', entrance: { x: 9, y: 41, z: 55 }, level, base: { x: 9, y: level, z: 55 }, chest: null, direction: 'east', length: 4, shaft: 'ladder',
    dimension: 'overworld', end: { x: 15, y: level, z: 55 }, tunnel: [{ x: 11, y: level, z: 55 }, { x: 15, y: level, z: 55 }], parent: 'mine',
    route: [{ kind: 'ladder', x: 9, z: 55, top: 40, bottom: level, face: 'east', entry: { x: 8, y: 41, z: 55 } }],
});

function store(...mines) {
    const s = new S.MineStore(null, { now: () => new Date(0) });
    for (const m of mines) s.set(m);
    return s;
}

describe('I4: the child record in the store', () => {
    test('key bot:<level>, parent kept, entrance the top cell in the parent; a mine without parent has no parent field', () => {
        const s = store(PARENT(), CHILD());
        const child = s.atLevel(-58);
        assert.equal(S.mineKey(child), 'bot:-58');
        assert.equal(S.mineId(child), 'bot:-58');
        assert.equal(child.parent, 'mine');
        assert.equal(child.source, 'bot');
        assert.equal(child.shaft, 'ladder');
        assert.deepEqual(child.entrance, { x: 9, y: 41, z: 55 });
        assert.equal('parent' in s.byName('mine'), false, 'the records of v0.1.4.10 keep their shape');
        assert.equal(S.mineId(s.byName('mine')), 'mine');
    });

    test('parentOf and children; a parent of the bot is named bot:<level>', () => {
        const s = store(PARENT(), CHILD());
        assert.equal(s.parentOf(s.atLevel(-58)).name, 'mine');
        assert.deepEqual(s.children(s.byName('mine')).map(S.mineKey), ['bot:-58']);
        assert.equal(s.parentOf(s.byName('mine')), null);
        const own = { ...CHILD(16), parent: undefined, ore: 'iron', entrance: { x: 30, y: 64, z: 0 } };
        const deep = { ...CHILD(-40), parent: 'bot:16', entrance: { x: 30, y: 16, z: 2 } };
        const t = store(own, deep);
        assert.equal(S.mineKey(t.parentOf(t.atLevel(-40))), 'bot:16');
        assert.deepEqual(t.children(t.atLevel(16)).map(S.mineKey), ['bot:-40']);
        assert.equal(store(CHILD()).parentOf(CHILD()), null, 'a parent that is gone');
    });
});

describe('I4: chooseMine prefers the child whose level fits the ore', () => {
    const row = (ore) => O.oreOf(ore);
    const at = { x: 9, y: 41, z: 55 };

    test('diamond: only the child fits', () => {
        const s = store(PARENT(), CHILD());
        const pick = W.chooseMine(s, at, 'overworld', row('diamond'));
        assert.equal(S.mineKey(pick.mine), 'bot:-58');
        assert.equal(pick.tunnel, 0);
    });

    test('gold (best level -16): both fit, the child at -20 is nearer to the best level than the parent at 30', () => {
        const s = store(PARENT(), CHILD(-20));
        const pick = W.chooseMine(s, { x: 9, y: 67, z: 52 }, 'overworld', row('gold'));
        assert.equal(S.mineKey(pick.mine), 'bot:-20', 'from the surface, where the parent is nearer');
    });

    test('coal (best level 96): the parent at 30 is nearer to it than the child at -20', () => {
        const s = store(PARENT(), CHILD(-20));
        const pick = W.chooseMine(s, { x: 9, y: 67, z: 52 }, 'overworld', row('coal'));
        assert.equal(pick.mine.name, 'mine');
    });

    test('without children as before; never throws', () => {
        const s = store(PARENT());
        assert.equal(W.chooseMine(s, at, 'overworld', row('iron')).mine.name, 'mine');
        assert.deepEqual(W.chooseMine(null, at, 'overworld', row('iron')), { mine: null, tunnel: null, player: null });
    });
});

describe('I4: !mines and !forgetMine with a child', () => {
    test('minesText lists the child under its parent', () => {
        const s = store(PARENT(), CHILD(), { ...CHILD(16), parent: undefined, ore: 'iron', entrance: { x: 30, y: 64, z: 0 }, tunnel: [], end: null, base: null });
        assert.equal(P.minesText({ mines: s }, 'overworld'),
            'I know 3 mines: "mine", entrance (9, 67, 52), 1 tunnel at level 30; bot:-58 (from the mine "mine"); the mine at (30, 64, 0) that I dug, level 16.');
    });

    test('a child whose parent is gone is listed on its own, as a mine of the bot', () => {
        assert.equal(P.minesText({ mines: store(CHILD()) }, 'overworld'), 'I know 1 mine: the mine at (9, 41, 55) that I dug, level -58.');
    });

    test('forgetMine of the parent forgets its children; of a child only the child', () => {
        const s = store(PARENT(), CHILD());
        assert.deepEqual(P.forgetMine({ mines: s }, 'bot:-58'), { ok: true, reason: null, text: 'Forgot the mine "bot:-58".' });
        assert.equal(s.size, 1);
        s.set(CHILD());
        assert.deepEqual(P.forgetMine({ mines: s }, 'mine'), { ok: true, reason: null, text: 'Forgot the mine "mine".' });
        assert.equal(s.size, 0, 'the child went with its parent');
    });
});

describe('the switch mine_from_inside', () => {
    test('fromInsideOn: true only for true', () => {
        assert.equal(W.fromInsideOn({ settings: { mine_from_inside: true } }), true);
        for (const v of [false, undefined, 'true', 1]) assert.equal(W.fromInsideOn({ settings: { mine_from_inside: v } }), false, String(v));
        assert.equal(W.fromInsideOn(null), false);
    });

    test('parentMine through the store of the context', () => {
        const s = store(PARENT(), CHILD());
        assert.equal(W.parentMine({ mines: s }, s.atLevel(-58)).name, 'mine');
        assert.equal(W.parentMine({ mines: s }, s.byName('mine')), null);
        assert.equal(W.parentMine({}, CHILD()), null);
    });
});
