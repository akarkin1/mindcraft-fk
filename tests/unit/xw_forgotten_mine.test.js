// E3, spec v0.1.4.16 F5 (the play of 2026-11-11: "A new mine starts from the surface" underground in a forgotten mine): a
// tunnel 1 or 2 wide at the bot's feet, in no mine the bot knows, becomes the mine `mine_<n>` with the line `This tunnel is
// a mine now: "mine_2" at (x, y, z).` (mineHere of mine_player.js), with or without mine_routes; only a bot in an open
// cave or open rock gets no mine (mineOre then says undergroundNoMine). The widened tunnel of Q1 keeps its text.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const P = await loadSrc('src/agent/packs/mining/index.js');
const T = await loadSrc('src/agent/packs/mining/texts.js');

// A world of stone with rooms cut into it.
function world() {
    const m = new Map();
    const k = (x, y, z) => `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    const w = {
        get: (x, y, z) => m.get(k(x, y, z)) ?? 'stone',
        set(x, y, z, name) { m.set(k(x, y, z), name); return w; },
        // a room from (x1, z1) to (x2, z2) at the floor level y, 2 high
        room(x1, z1, x2, z2, y) {
            for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
                for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) {
                    w.set(x, y, z, 'air').set(x, y + 1, z, 'air');
                }
            }
            return w;
        },
    };
    return w;
}

// the bot at y -59 in a tunnel 1 wide going north (x 30, z -97 .. -100); a far mine "mine" in the store when `far`
function scene({ routes = true, tunnel = true, far = true, cave = false } = {}) {
    const w = world();
    if (tunnel) w.room(30, -97, 30, -100, -59);
    if (cave) w.room(26, -103, 34, -94, -59);
    const said = [];
    const bot = {
        entity: { position: { x: 30.5, y: -59, z: -98.5 } },
        game: { dimension: 'overworld' },
        blockAt: (p) => ({ name: w.get(p.x, p.y, p.z), boundingBox: ['air', 'cave_air'].includes(w.get(p.x, p.y, p.z)) ? 'empty' : 'block' }),
    };
    const store = new P.MineStore(null);
    if (far) {
        store.set({
            name: 'mine', source: 'player', ore: 'iron', entrance: { x: 500, y: 64, z: 500 }, level: -59, base: null, chest: null, direction: null,
            length: 0, shaft: 'ladder', dimension: 'overworld', end: null, tunnel: [], route: [],
            room: { center: { x: 500, y: -59, z: 500 }, chest: null, table: null, furnace: null }, tunnels: [], passed: [],
        });
    }
    const ctx = {
        mines: store, settings: { mine_routes: routes }, routes: routes ? {} : null, areas: [],
        whereAmI: () => ({ underground: true }), say: (t) => said.push(t),
    };
    return { bot, ctx, said, store, w };
}

const LINE = 'This tunnel is a mine now: "mine_2" at (30, -59, -99).';

describe('F5: the forgotten mine', () => {
    test('the text, word for word', () => {
        assert.equal(T.tunnelIsMineText('mine_2', { x: 30, y: -59, z: -99 }), LINE);
        assert.equal(T.tunnelIsMineText('mine_1', { x: 1.9, y: 2, z: -3.2 }), 'This tunnel is a mine now: "mine_1" at (1, 2, -4).');
    });

    test('with mine_routes: the tunnel 1 wide becomes "mine_2" (a mine "mine" is known far away), the line is said, the trip can use it', () => {
        const s = scene();
        const r = P.mineHere(s.bot, s.ctx, 'iron');
        assert.equal(r.made, true, JSON.stringify(r));
        assert.deepEqual(s.said, [LINE]);
        assert.equal(r.text, LINE);
        const mine = s.store.byName('mine_2', 'overworld');
        assert.ok(mine, 'in the store as mine_2');
        assert.deepEqual([mine.source, mine.level, mine.ore, mine.route], ['player', -59, 'iron', []]);
        assert.deepEqual(mine.tunnels.map(t => [t.start, t.dir, t.end]), [[{ x: 30, y: -59, z: -97 }, 'north', { x: 30, y: -59, z: -100 }]]);
        assert.equal(r.mine.name, mine.name);
        assert.equal(s.store.list('overworld').length, 2);
    });

    test('without mine_routes the same: the mine is made and the line said', () => {
        const s = scene({ routes: false });
        const r = P.mineHere(s.bot, s.ctx, 'iron');
        assert.equal(r.made, true, JSON.stringify(r));
        assert.deepEqual(s.said, [LINE]);
        assert.ok(s.store.byName('mine_2', 'overworld'));
    });

    test('no other mine known: "mine_1"', () => {
        const s = scene({ far: false });
        const r = P.mineHere(s.bot, s.ctx, 'iron');
        assert.equal(r.made, true);
        assert.deepEqual(s.said, ['This tunnel is a mine now: "mine_1" at (30, -59, -99).']);
    });

    test('a bot in an open cave gets no mine (mineOre then refuses with undergroundNoMine), with or without mine_routes', () => {
        for (const routes of [true, false]) {
            const s = scene({ routes, tunnel: false, cave: true });
            const r = P.mineHere(s.bot, s.ctx, 'iron');
            assert.equal(r.made, false, String(routes));
            assert.deepEqual(s.said, []);
            assert.equal(s.store.list('overworld').length, 1, 'nothing saved');
        }
        assert.equal(T.TEXTS.undergroundNoMine, 'I am underground, not in a mine I know. A new mine starts from the surface: say "leave the mine" or "go to the surface" first.');
    });

    test('on the surface nothing is made', () => {
        const s = scene();
        s.ctx.whereAmI = () => ({ underground: false });
        assert.equal(P.mineHere(s.bot, s.ctx, 'iron').made, false);
    });
});
