// v0.1.4.13 part Q (engineer E4), SPEC 4.6 Q1: !mineOre from where the bot stands. The tunnel width of mine_logic.js
// (tunnelAt and measureTunnel take a tunnel up to 4 wide when its floor is level and its ceiling closed, with the option
// maxWidth; without it, or where the rule of v0.1.4.11 holds, everything is as before), the next free name and the text
// of here_logic.js, and mineHere of mine_player.js over a fake bot and a mine store in memory.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { assertImportRules } from '../helpers/module_rules.js';

const L = await loadSrc('src/agent/packs/mining/mine_logic.js');
const H = await loadSrc('src/agent/packs/mining/here_logic.js');
const P = await loadSrc('src/agent/packs/mining/index.js');

// open cells (feet and head) at y 30 in stone; `set` for single blocks
function world() {
    const open = new Map();
    const w = {
        open,
        set(x, y, z, name) {
            open.set(`${x},${y},${z}`, name);
            return w;
        },
        cell(x, y, z) {
            return w.set(x, y, z, 'air').set(x, y + 1, z, 'air');
        },
        room(x1, z1, x2, z2, y) {
            for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) w.cell(x, y, z);
            return w;
        },
        get: (x, y, z) => open.get(`${x},${y},${z}`) ?? 'stone',
    };
    return w;
}

// a tunnel going north at x 0, z -1 .. -10, widened to 3 (x -1..1) from z -3 to -8 by earlier mining
function widened() {
    return world().room(0, -1, 0, -10, 30).room(-1, -3, 1, -8, 30);
}

describe('Q1: a tunnel that earlier mining widened', () => {
    test('the rule of v0.1.4.11 refuses it; with maxWidth 4 it is a tunnel, its width the widest cell', () => {
        const w = widened();
        const feet = { x: 0, y: 30, z: -5 };
        assert.equal(L.tunnelAt(w.get, feet, { minCells: 4 }).cause.kind, 'open_sides');
        const r = L.tunnelAt(w.get, feet, { minCells: 4, maxWidth: 4, anchor: { x: 0, y: 30, z: 5 } });
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.deepEqual([r.tunnel.dir, r.tunnel.end, r.tunnel.width], ['north', { x: 0, y: 30, z: -10 }, 3]);
    });

    test('a widened cell with a step in its floor or an open ceiling is no tunnel', () => {
        const step = widened().set(1, 29, -5, 'air');
        assert.equal(L.tunnelAt(step.get, { x: 0, y: 30, z: -5 }, { minCells: 4, maxWidth: 4 }).ok, false);
        const roof = widened().set(-1, 32, -5, 'air');
        assert.equal(L.tunnelAt(roof.get, { x: 0, y: 30, z: -5 }, { minCells: 4, maxWidth: 4 }).ok, false);
    });

    test('a room is no widened tunnel: 4 wide and 5 long is shorter than twice its width', () => {
        const room = world().room(28, -96, 32, -93, -59);
        assert.equal(L.tunnelAt(room.get, { x: 30, y: -59, z: -95 }, { minCells: 4, maxWidth: 4 }).ok, false);
    });

    test('wider than 4 is no tunnel', () => {
        const hall = world().room(0, -1, 0, -10, 30).room(-2, -3, 2, -8, 30);
        assert.equal(L.tunnelAt(hall.get, { x: 0, y: 30, z: -5 }, { minCells: 4, maxWidth: 4 }).ok, false);
    });

    test('a tunnel 1 or 2 wide is measured as before with the option (the rule of v0.1.4.11 first)', () => {
        const two = world().room(0, 0, 4, 4, 30).room(2, -1, 3, -8, 30);
        const anchor = { x: 2, y: 30, z: 2 };
        assert.deepEqual(L.tunnelAt(two.get, { x: 3, y: 30, z: -4 }, { anchor, minCells: 4, maxWidth: 4 }),
            L.tunnelAt(two.get, { x: 3, y: 30, z: -4 }, { anchor, minCells: 4 }));
    });

    test('measureTunnel without the option is that of v0.1.4.11', () => {
        const w = widened();
        assert.equal(L.measureTunnel(w.get, { x: 0, y: 30, z: -2 }, 'north').width, 2);
        assert.equal(L.measureTunnel(w.get, { x: 0, y: 30, z: -2 }, 'north', { maxWidth: 4 }).width, 3);
    });
});

describe('Q1: the name and the texts', () => {
    test('the next free name', () => {
        assert.equal(H.nextMineName([]), 'mine 1');
        assert.equal(H.nextMineName(['mine']), 'mine 2', 'a mine called "mine" is the first');
        assert.equal(H.nextMineName(['mine', 'mine_2', 'deep']), 'mine 3', 'as the store keeps the names');
        assert.equal(H.nextMineName(['mine 1']), 'mine 2');
    });

    test('the text of Q1, word for word', () => {
        assert.equal(H.madeMineText('mine 2', { start: { x: 30, y: -59, z: -100 }, dir: 'north', length: 4 }),
            'I made the mine "mine 2" here and measured the tunnel: it starts at (30, -59, -100), goes north, 4 blocks. I dig on at its end.');
    });

    test('a mine of the player without a route has its way in unknown; the text of its way out', () => {
        assert.equal(H.wayInUnknown({ source: 'player', route: [] }), true);
        assert.equal(H.wayInUnknown({ source: 'player', route: [{ kind: 'walk' }] }), false);
        assert.equal(H.wayInUnknown({ source: 'player', route: [], parent: 'mine' }), false);
        assert.equal(H.wayInUnknown({ source: 'bot', route: [] }), false);
        assert.equal(H.noWayOutText('the mine "mine_2"'), 'I do not know the way out of the mine "mine_2". I stay here; say "follow me" and I come with you.');
    });

    test('here_logic.js is pure', () => {
        assertImportRules('src/agent/packs/mining/here_logic.js', { allowBuiltins: [], allowedRelative: [] });
    });
});

describe('Q1: mineHere over a fake bot', () => {
    // the bot at y -59 in a tunnel going north (x 30, z -97 .. -100), a crafting table in the room south of it
    function scene({ underground = true, routes = true, tunnel = true, store = new P.MineStore(null) } = {}) {
        const w = world();
        if (tunnel) w.room(30, -97, 30, -100, -59);
        w.room(28, -96, 32, -93, -59).set(29, -59, -94, 'crafting_table');
        w.cell(40, -59, -90); // a pocket in the rock, 1 cell
        const said = [];
        const bot = {
            entity: { position: { x: 30.5, y: -59, z: -98.5 } },
            game: { dimension: 'overworld' },
            blockAt: (p) => ({ name: w.get(p.x, p.y, p.z), boundingBox: ['air', 'cave_air'].includes(w.get(p.x, p.y, p.z)) ? 'empty' : 'block' }),
        };
        const ctx = {
            mines: store, settings: { mine_routes: routes }, routes: routes ? {} : null,
            whereAmI: () => ({ underground }), say: (t) => said.push(t),
        };
        return { bot, ctx, said, store };
    }

    test('underground in no mine it knows: the mine "mine 1" with the room and the tunnel, the text', () => {
        const s = scene();
        const r = P.mineHere(s.bot, s.ctx, 'iron');
        assert.equal(r.made, true, JSON.stringify(r));
        assert.deepEqual(s.said, ['I made the mine "mine 1" here and measured the tunnel: it starts at (30, -59, -97), goes north, 4 blocks. I dig on at its end.']);
        const mine = s.store.byName('mine 1', 'overworld');
        assert.deepEqual([mine.source, mine.level, mine.route, mine.room.table], ['player', -59, [], { x: 29, y: -59, z: -94 }]);
        assert.deepEqual(mine.tunnels.map(t => [t.start, t.dir, t.end]), [[{ x: 30, y: -59, z: -97 }, 'north', { x: 30, y: -59, z: -100 }]]);
        assert.equal(H.wayInUnknown(mine), true);
    });

    test('nothing made: on the surface, without mine_routes, in open rock, in a known mine', () => {
        assert.equal(P.mineHere(scene({ underground: false }).bot, scene({ underground: false }).ctx, 'iron').made, false);
        const off = scene({ routes: false });
        assert.equal(P.mineHere(off.bot, off.ctx, 'iron').made, false);
        const rock = scene({ tunnel: false });
        rock.bot.entity.position = { x: 40.5, y: -59, z: -89.5 };
        assert.equal(P.mineHere(rock.bot, rock.ctx, 'iron').made, false);
        const s = scene();
        P.mineHere(s.bot, s.ctx, 'iron');
        const again = P.mineHere(s.bot, s.ctx, 'iron');
        assert.deepEqual([again.made, s.said.length], [false, 1], 'in the mine made before');
    });
});
