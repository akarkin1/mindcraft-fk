// Tester T1 of v0.1.4.11 "Navigation and words", from the spec: the texts of W2 (the tunnel) and W3 (the new mine
// underground) word for word, I3 (the tunnel from the bot's cell, then the player's; 1 or 2 wide; the rock face
// measured backwards; the "no tunnel" checks in the order open sides, width ahead, ceiling) and I4 (the second level
// of a mine: the child record, chooseMine by level, !mines, !forgetMine).
//
// The world of the W2 examples: a room x 8..12, z 7..11 at level 30 (2 high), a tunnel x 10, z 2..6 going north from
// it, 2 high, rock around. So the tunnel "starts at (10, 30, 6), goes north, and ends at (10, 30, 2) after 5 blocks".
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeMiningBot, makeClock, makeCtx } from './mining_fake_bot.test.js';

const T = await loadSrc('src/agent/packs/mining/texts.js');
const L = await loadSrc('src/agent/packs/mining/mine_logic.js');
const P = await loadSrc('src/agent/packs/mining/index.js');
const O = await loadSrc('src/agent/packs/mining/ore_table.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

const ROOM_CENTER = { x: 10, y: 30, z: 9 };

function baseWorld() {
    const w = makeWorld();
    w.fill(8, 30, 7, 12, 31, 11, 'air'); // the room
    w.fill(10, 30, 2, 10, 31, 6, 'air'); // the tunnel north
    return w;
}
const reader = (w) => (x, y, z) => w.nameAt(x, y, z);

const W2 = {
    one: 'I measured the tunnel: it starts at (10, 30, 6), goes north, and ends at (10, 30, 2) after 5 blocks, at level 30. I dig on at its end when you ask for ore.',
    two: 'I measured the tunnel: it starts at (10, 30, 6), goes north, and ends at (10, 30, 2) after 5 blocks, at level 30, 2 wide. I dig on at its end when you ask for ore.',
    player: 'I measured the tunnel from where you stand: it starts at (10, 30, 6), goes north, and ends at (10, 30, 2) after 5 blocks, at level 30. I dig on at its end when you ask for ore.',
    open: 'I stand in no tunnel: it is open on 3 sides at (10, 30, 6). Stand in the tunnel and say "dig here".',
    wide: 'I stand in no tunnel: the way ahead at (10, 30, 5) is 3 wide. A tunnel is 1 or 2 wide and 2 high.',
    ceiling: 'I stand in no tunnel: the ceiling at (10, 32, 6) is open. A tunnel is 1 or 2 wide and 2 high.',
};

const TUNNEL = { start: { x: 10, y: 30, z: 6 }, dir: 'north', end: { x: 10, y: 30, z: 2 }, length: 5, level: 30 };

describe('W2: the tunnel texts, word for word', () => {
    test('measured, 1 wide', () => {
        assert.equal(T.rememberTunnelText({ ...TUNNEL, width: 1 }), W2.one);
        assert.equal(T.rememberTunnelText({ ...TUNNEL }), W2.one, 'without width: 1 wide');
    });

    test('measured, 2 wide', () => {
        assert.equal(T.rememberTunnelText({ ...TUNNEL, width: 2 }), W2.two);
    });

    test('measured from where the player stands: the first line with "from where you stand"', () => {
        assert.equal(T.rememberTunnelText({ ...TUNNEL, width: 1, fromPlayer: true }), W2.player);
    });

    test('measured from where the player stands, 2 wide: the second line with "from where you stand"', () => {
        assert.equal(T.rememberTunnelText({ ...TUNNEL, width: 2, fromPlayer: true }),
            'I measured the tunnel from where you stand: it starts at (10, 30, 6), goes north, and ends at (10, 30, 2) after 5 blocks, at level 30, 2 wide. I dig on at its end when you ask for ore.');
    });

    test('no tunnel: open sides, the width ahead, the ceiling', () => {
        assert.equal(T.noCorridorText({ kind: 'open_sides', at: { x: 10, y: 30, z: 6 }, sides: 3 }), W2.open);
        assert.equal(T.noCorridorText({ kind: 'wide', at: { x: 10, y: 30, z: 5 }, width: 3 }), W2.wide);
        assert.equal(T.noCorridorText({ kind: 'ceiling', at: { x: 10, y: 32, z: 6 } }), W2.ceiling);
    });
});

describe('W3: the new mine underground, word for word', () => {
    test('mine_from_inside on, inside a known mine', () => {
        assert.equal(T.shaftFromHereText(-58, 'diamond'), 'I dig a shaft down from here to level -58 for diamond.');
    });

    test('underground, no known mine here', () => {
        assert.equal(T.TEXTS.undergroundNoMine,
            'I am underground, not in a mine I know. A new mine starts from the surface: say "leave the mine" or "go to the surface" first.');
    });

    test('switch off, inside a known mine', () => {
        assert.equal(T.inMineText({ name: 'mine' }),
            'I am in the mine "mine". A new shaft from inside needs the setting mine_from_inside; say "leave the mine" first for a new mine from the surface.');
    });
});

describe('I3: measureTunnel and tunnelAt on the world of the W2 examples', () => {
    test('the bot in the middle of a 1-wide tunnel: start, end, direction away from the room, width 1', () => {
        const get = reader(baseWorld());
        const m = L.measureTunnel(get, { x: 10, y: 30, z: 4 }, 'north');
        assert.deepEqual({ start: m.start, end: m.end, length: m.length, level: m.level, dir: m.dir, width: m.width },
            { start: { x: 10, y: 30, z: 6 }, end: { x: 10, y: 30, z: 2 }, length: 5, level: 30, dir: 'north', width: 1 });
        const r = L.tunnelAt(get, { x: 10, y: 30, z: 4 }, { anchor: ROOM_CENTER });
        assert.equal(r.ok, true, JSON.stringify(r.cause));
        assert.equal(T.rememberTunnelText(r.tunnel), W2.one);
    });

    test('a corridor 2 wide is accepted, width 2', () => {
        const w = baseWorld();
        w.fill(11, 30, 2, 11, 31, 6, 'air');
        const get = reader(w);
        const m = L.measureTunnel(get, { x: 10, y: 30, z: 4 }, 'north');
        assert.equal(m.width, 2);
        const r = L.tunnelAt(get, { x: 10, y: 30, z: 4 }, { anchor: ROOM_CENTER });
        assert.equal(r.ok, true, JSON.stringify(r.cause));
        assert.equal(r.tunnel.width, 2);
        assert.equal(T.rememberTunnelText(r.tunnel), W2.two);
    });

    test('the bot at the rock face: the only open direction points at the room, measured backwards, dir away from the room', () => {
        const get = reader(baseWorld());
        const r = L.tunnelAt(get, { x: 10, y: 30, z: 2 }, { anchor: ROOM_CENTER });
        assert.equal(r.ok, true, JSON.stringify(r.cause));
        assert.equal(r.tunnel.dir, 'north');
        assert.deepEqual([r.tunnel.start, r.tunnel.end, r.tunnel.length], [{ x: 10, y: 30, z: 6 }, { x: 10, y: 30, z: 2 }, 5]);
    });

    test('the rock face with a stale yaw of the player towards the room: still away from the room', () => {
        const get = reader(baseWorld());
        // mineflayer yaw: 0 north, pi south
        const r = L.tunnelAt(get, { x: 10, y: 30, z: 2 }, { anchor: ROOM_CENTER, yaw: Math.PI });
        assert.equal(r.ok, true, JSON.stringify(r.cause));
        assert.equal(r.tunnel.dir, 'north');
    });

    test('no tunnel: open on 3 sides at the feet', () => {
        const get = reader(baseWorld());
        const r = L.tunnelAt(get, { x: 10, y: 30, z: 11 }, { anchor: ROOM_CENTER }); // the room's wall side
        assert.equal(r.ok, false);
        assert.equal(r.cause.kind, 'open_sides');
        assert.equal(T.noCorridorText(r.cause), 'I stand in no tunnel: it is open on 3 sides at (10, 30, 11). Stand in the tunnel and say "dig here".');
    });

    test('no tunnel: the way ahead is 3 wide (the W2 example cell)', () => {
        const w = baseWorld();
        w.fill(9, 30, 5, 11, 31, 5, 'air');
        const r = L.tunnelAt(reader(w), { x: 10, y: 30, z: 6 }, { anchor: ROOM_CENTER });
        assert.equal(r.ok, false);
        assert.equal(T.noCorridorText(r.cause), W2.wide);
    });

    test('no tunnel: the ceiling is open (the W2 example cell)', () => {
        const w = baseWorld();
        w.set(10, 32, 6, 'air');
        const r = L.tunnelAt(reader(w), { x: 10, y: 30, z: 6 }, { anchor: ROOM_CENTER });
        assert.equal(r.ok, false);
        assert.equal(T.noCorridorText(r.cause), W2.ceiling);
    });

    test('the order: the width ahead is named before the ceiling', () => {
        const w = baseWorld();
        w.fill(9, 30, 5, 11, 31, 5, 'air');
        w.set(10, 32, 6, 'air');
        const r = L.tunnelAt(reader(w), { x: 10, y: 30, z: 6 }, { anchor: ROOM_CENTER });
        assert.equal(r.cause?.kind, 'wide');
    });

    test('the order: the open sides are named before the width ahead and the ceiling', () => {
        const w = baseWorld();
        w.fill(9, 30, 6, 11, 31, 6, 'air'); // open on both sides at the feet
        w.fill(9, 30, 4, 11, 31, 4, 'air'); // 3 wide ahead
        w.set(10, 32, 6, 'air'); // the ceiling open
        const r = L.tunnelAt(reader(w), { x: 10, y: 30, z: 6 }, { anchor: ROOM_CENTER });
        assert.equal(r.cause?.kind, 'open_sides');
    });
});

describe('I3: rememberTunnel(bot, ctx, name, { playerPos, playerYaw })', () => {
    async function scene(pos) {
        const world = baseWorld();
        const bot = makeMiningBot({ world, pos });
        const clock = makeClock(bot);
        const ctx = await makeCtx(clock);
        ctx.mines.set({
            name: 'mine', source: 'player', ore: 'iron', entrance: { x: 10, y: 64, z: 9 }, level: 30, dimension: 'overworld',
            room: { center: ROOM_CENTER }, tunnels: [], passed: [],
        });
        return { world, bot, ctx };
    }

    test('the bot in the tunnel: measured at the bot\'s cell (line 1 of W2), saved in the mine', async () => {
        const s = await scene([10.5, 30, 4.5]);
        const r = await P.rememberTunnel(s.bot, s.ctx, '', {});
        assert.equal(r.ok, true, r.text);
        assert.equal(r.text, W2.one);
        const t = s.ctx.mines.byName('mine').tunnels;
        assert.equal(t.length, 1);
        assert.deepEqual([t[0].start, t[0].end, t[0].dir], [{ x: 10, y: 30, z: 6 }, { x: 10, y: 30, z: 2 }, 'north']);
    });

    test('the bot at the rock face: accepted where it stands', async () => {
        const s = await scene([10.5, 30, 2.5]);
        const r = await P.rememberTunnel(s.bot, s.ctx, '', {});
        assert.equal(r.text, W2.one);
    });

    test('the bot in the room, the player in the tunnel: measured from where the player stands (line 3 of W2)', async () => {
        const s = await scene([10.5, 30, 9.5]);
        const r = await P.rememberTunnel(s.bot, s.ctx, '', { playerPos: { x: 10.4, y: 30, z: 3.7 }, playerYaw: 0 });
        assert.equal(r.ok, true, r.text);
        assert.equal(r.text, W2.player);
    });

    test('the bot\'s cell first: with the bot in the tunnel the text has no "from where you stand"', async () => {
        const s = await scene([10.5, 30, 4.5]);
        const r = await P.rememberTunnel(s.bot, s.ctx, '', { playerPos: { x: 10.4, y: 30, z: 3.7 }, playerYaw: 0 });
        assert.equal(r.text, W2.one);
    });

    test('a failure is { ok: false, reason, text } with a W2 "no tunnel" line and nothing saved', async () => {
        const s = await scene([10.5, 30, 11.5]);
        const r = await P.rememberTunnel(s.bot, s.ctx, '', {});
        assert.equal(r.ok, false);
        assert.equal(typeof r.reason, 'string');
        assert.match(r.text, /^I stand in no tunnel: it is open on 3 sides at \(10, 30, 11\)\. Stand in the tunnel and say "dig here"\.$/);
        assert.equal(s.ctx.mines.byName('mine').tunnels.length, 0);
    });
});

describe('I4: the second level of a mine', () => {
    async function storeWith(childLevel, childOre) {
        const ctx = await makeCtx({ now: () => 1_000_000 });
        ctx.mines.set({
            name: 'mine', source: 'player', ore: 'iron', entrance: { x: 10, y: 64, z: 9 }, level: 30, dimension: 'overworld',
            room: { center: ROOM_CENTER },
            tunnels: [{ start: { x: 10, y: 30, z: 6 }, dir: 'north', end: { x: 10, y: 30, z: 2 }, level: 30, length: 5, branches: [] }],
            passed: [],
        });
        ctx.mines.set({
            source: 'bot', ore: childOre, entrance: { x: 10, y: 30, z: 9 }, level: childLevel, dimension: 'overworld', shaft: 'ladder',
            parent: 'mine', direction: 'east', end: { x: 18, y: childLevel, z: 9 },
            tunnels: [{ start: { x: 11, y: childLevel, z: 9 }, dir: 'east', end: { x: 18, y: childLevel, z: 9 }, level: childLevel, length: 8, branches: [] }],
            passed: [],
        });
        return ctx;
    }

    test('the child record keeps parent, entrance, shaft ladder and level; its id is bot:<level>', async () => {
        const ctx = await storeWith(-58, 'diamond');
        const child = ctx.mines.list('overworld').find((m) => m.parent);
        assert.ok(child, 'a mine with a parent');
        assert.equal(child.parent, 'mine');
        assert.deepEqual(child.entrance, { x: 10, y: 30, z: 9 });
        assert.equal(child.shaft, 'ladder');
        assert.equal(child.level, -58);
        assert.equal(P.mineId(child), 'bot:-58');
    });

    test('!mines lists a child under its parent: bot:-58 (from the mine "mine")', async () => {
        const ctx = await storeWith(-58, 'diamond');
        const text = P.minesText(ctx);
        assert.ok(text.includes('bot:-58 (from the mine "mine")'), text);
        assert.ok(text.indexOf('"mine"') < text.indexOf('bot:-58'), `the child after its parent: ${text}`);
    });

    test('!forgetMine of a parent forgets its children', async () => {
        const ctx = await storeWith(-58, 'diamond');
        const r = P.forgetMine(ctx, 'mine');
        assert.equal(r.ok, true, r.text);
        assert.equal(r.text, 'Forgot the mine "mine".');
        assert.deepEqual(ctx.mines.list('overworld'), []);
    });

    test('chooseMine prefers a child whose level fits the ore', async () => {
        const ctx = await storeWith(15, 'iron');
        const iron = O.oreOf('iron'); // best level 16: the child at 15 fits better than the parent at 30
        const r = P.chooseMine(ctx.mines, { x: 10, y: 30, z: 9 }, 'overworld', iron);
        assert.equal(r.mine?.parent, 'mine', `chose ${r.mine?.name ?? P.mineId(r.mine ?? {})}`);
    });

    test('chooseMine keeps the parent when its level fits the ore better', async () => {
        const ctx = await storeWith(15, 'iron');
        const coal = O.oreOf('coal'); // best level 96: the parent at 30 is nearer than the child at 15
        const r = P.chooseMine(ctx.mines, { x: 10, y: 30, z: 9 }, 'overworld', coal);
        assert.equal(r.mine?.name, 'mine');
    });
});
