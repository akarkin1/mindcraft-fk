// Spec v0.1.4.9 part B (engineer E2): the mine of the player on the fake bot of the mining pack
// (mining_fake_bot.test.js): rememberMine (B2), rememberTunnel (B3), mineOre in a known mine (B4),
// side branches (B5), the ore list and collectPassedOre (B6), ore_sense_range (B7), and every switch
// off as in v0.1.4.8. The routes pack is a fake on ctx.routes (I4): its walkRoute puts the bot at the
// end of the legs it was given.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeMiningBot, makeClock, makeCtx, give, count } from './mining_fake_bot.test.js';

const P = await loadSrc('src/agent/packs/mining/index.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

// The mine of the player in the fake world (ground y 63): the entrance outside at (0, 64, -3), a
// trapdoor at (0, 63, 0), ladders down to a room at y 50 (x -2..2, z -2..2, 3 high) with a chest, a
// crafting table and a furnace, a landing at y 34 (x 20..22, z -1..1) and a tunnel x 21, z 2..13 at
// y 34, 2 high, going south.
function mineWorld({ tunnelTo = 13 } = {}) {
    const w = makeWorld();
    w.fill(-2, 50, -2, 2, 52, 2, 'air');
    w.set(-2, 50, 2, 'chest').set(2, 50, 2, 'crafting_table').set(2, 50, -2, 'furnace');
    w.fill(0, 53, 0, 0, 62, 0, 'ladder', { facing: 'south' });
    w.fill(20, 34, -1, 22, 36, 1, 'air');
    w.fill(21, 34, 2, 21, 35, tunnelTo, 'air');
    return w;
}

const LEGS = [
    { kind: 'walk', from: { x: 0, y: 64, z: -3 }, to: { x: 0, y: 64, z: -1 } },
    { kind: 'door', kind2: 'trapdoor', name: 'oak_trapdoor', x: 0, y: 63, z: 0, from: { x: 0, y: 64, z: -1 }, to: { x: 0, y: 62, z: 0 } },
    { kind: 'ladder', x: 0, z: 0, top: 62, bottom: 50, face: 'south', entry: { x: 0, y: 64, z: -1 } },
    { kind: 'walk', from: { x: 0, y: 50, z: 0 }, to: { x: 2, y: 50, z: 0 } },
    { kind: 'walk', from: { x: 2, y: 50, z: 0 }, to: { x: 21, y: 34, z: 0 } },
    { kind: 'walk', from: { x: 21, y: 34, z: 0 }, to: { x: 21, y: 34, z: 13 } },
];

// The trail of a walk from outside down to the end of the tunnel.
function trailSteps() {
    const out = [{ x: 0, y: 64, z: -5, sky: true }, { x: 0, y: 64, z: -3, sky: true }, { x: 0, y: 64, z: -1, sky: false }];
    for (let y = 62; y >= 50; y--) {
        out.push({ x: 0, y, z: 0, sky: false });
    }
    out.push({ x: 1, y: 50, z: 0, sky: false }, { x: 2, y: 50, z: 0, sky: false });
    for (let k = 1; k <= 16; k++) {
        out.push({ x: 2 + k, y: 50 - k, z: 0, sky: false });
    }
    for (let z = 0; z <= 13; z++) {
        out.push({ x: 21, y: 34, z, sky: false });
    }
    return out;
}

const endOf = leg => leg.to ?? { x: leg.x, y: leg.bottom, z: leg.z };

// ctx.routes of the glue (I4) as a fake: walkRoute moves the bot to the end of its legs (or, with
// reverse, to the start of the first one) and notes the call; `fail` is returned instead.
function fakeRoutes(bot, { steps = trailSteps(), fail = null } = {}) {
    const calls = [];
    return {
        calls,
        trail: { list: () => steps },
        logic: { skyStart: s => s.map(x => x.sky === true).lastIndexOf(true), routeFromSteps: () => ({ legs: LEGS, from: null, to: null }) },
        async walkRoute(b, route, options = {}) {
            calls.push({ name: route.name, legs: route.legs.length, reverse: options.reverse === true });
            const r = typeof fail === 'function' ? fail(b) : fail;
            if (r) {
                return r;
            }
            const end = options.reverse ? route.legs[0].from ?? route.legs[0].entry : endOf(route.legs[route.legs.length - 1]);
            b.entity.position.x = end.x + 0.5;
            b.entity.position.y = end.y;
            b.entity.position.z = end.z + 0.5;
            return { ok: true, reason: null, text: '', leg: null, at: end };
        },
    };
}

function kit(bot, { pickaxe = 'stone_pickaxe' } = {}) {
    if (pickaxe) give(bot, pickaxe, 1);
    give(bot, 'cobblestone', 64);
    give(bot, 'torch', 16);
    give(bot, 'bread', 8);
}

async function scene({ pos = [21.5, 34, 13.5], world = mineWorld(), settings = { mine_routes: true }, routes = {}, gear = {} } = {}) {
    const bot = makeMiningBot({ world, pos });
    const clock = makeClock(bot);
    const ctx = await makeCtx(clock);
    ctx.settings = settings;
    ctx.routes = routes === null ? null : fakeRoutes(bot, routes);
    const stored = [];
    ctx.storage = {
        async storeItems(b, c, options) {
            stored.push(options);
            return { ok: true, reason: null, stored: { cobblestone: 3 }, left: {}, text: 'I stored 3 cobblestone in the chest at (-2, 50, 2).' };
        },
    };
    kit(bot, gear);
    return { world, bot, clock, ctx, stored, opts: { now: clock.now, wait: clock.wait } };
}

// A scene with the mine remembered at the end of the tunnel, the bot then put outside.
async function known(options = {}) {
    const s = await scene(options);
    const r = await P.rememberMine(s.bot, s.ctx, 'mine');
    assert.equal(r.ok, true, r.text);
    s.bot.entity.position.x = 0.5;
    s.bot.entity.position.y = 64;
    s.bot.entity.position.z = -6.5;
    return s;
}

const digs = bot => bot.calls.filter(c => c[0] === 'dig');
const feet = bot => ({ x: Math.floor(bot.entity.position.x), y: Math.floor(bot.entity.position.y + 0.01), z: Math.floor(bot.entity.position.z) });

describe('rememberMine (B2)', () => {
    test('at the end of the tunnel: the route, the room on the way, one tunnel of 12 at level 34; the text', async () => {
        const s = await scene();
        s.ctx.areas = [{ name: 'mining_area', type: 'mine', min: { x: -5, y: 20, z: -5 }, max: { x: 30, y: 62, z: 20 } }];
        const r = await P.rememberMine(s.bot, s.ctx, 'Mine');
        assert.equal(r.ok, true, r.text);
        assert.equal(r.text, 'I remember the mine "mine": the entrance at (0, 64, -3), the way in has 6 steps with 1 ladder and 1 trapdoor, the room at level 50 with a chest, a crafting table and a furnace, one tunnel at level 34, 12 blocks long, going south. It is in the area "mining_area".');
        const m = s.ctx.mines.byName('mine');
        assert.equal(m.source, 'player');
        assert.deepEqual(m.entrance, { x: 0, y: 64, z: -3 });
        assert.equal(m.level, 34);
        assert.deepEqual(m.route.map(l => l.kind), ['walk', 'door', 'ladder', 'walk', 'walk', 'walk']);
        assert.deepEqual(m.room, { center: { x: 1, y: 50, z: 0 }, chest: { x: -2, y: 50, z: 2 }, table: { x: 2, y: 50, z: 2 }, furnace: { x: 2, y: 50, z: -2 } });
        assert.deepEqual(m.tunnels, [{ start: { x: 21, y: 34, z: 2 }, dir: 'south', end: { x: 21, y: 34, z: 13 }, level: 34, length: 12, branches: [] }]);
        assert.equal(m.area, 'mining_area');
        assert.deepEqual(s.ctx.places.recall('mine'), { x: 0, y: 64, z: -3, dimension: 'overworld' });
        assert.equal(s.ctx.mines.get('iron'), null, 'not the mine of the bot for iron');
        assert.equal(digs(s.bot).length, 0);
    });

    test('said in the room: the room around the bot, no tunnel yet; a second time: replaced, the ore list kept', async () => {
        const s = await scene({ pos: [0.5, 50, 0.5] });
        const steps = trailSteps().slice(0, 16);
        s.ctx.routes = fakeRoutes(s.bot, { steps });
        const r = await P.rememberMine(s.bot, s.ctx, 'mine');
        assert.equal(r.ok, true, r.text);
        assert.match(r.text, /, the room at level 50 with a chest, a crafting table and a furnace, no tunnel yet: stand in a tunnel and say "dig here"\.$/);
        assert.deepEqual(r.mine.room.center, { x: 0, y: 50, z: 0 }, 'the feet of the bot');
        s.ctx.mines.addPassed('mine', { ore: 'coal', x: 5, y: 50, z: 0, reason: 'inventory' });
        const again = await P.rememberMine(s.bot, s.ctx, 'mine');
        assert.match(again.text, /^I know a mine "mine" already\. I replace it\. I remember the mine "mine": /);
        assert.equal(s.ctx.mines.list().length, 1);
        assert.equal(s.ctx.mines.byName('mine').passed.length, 1);
    });

    test('no trail (routes pack off), no step under open sky', async () => {
        const s = await scene({ routes: null });
        assert.deepEqual(await P.rememberMine(s.bot, s.ctx, 'mine'), { ok: false, reason: 'no_trail', text: 'I have no trail. The routes pack is off.', mine: null });
        s.ctx.routes = { trail: { list: () => [] } };
        assert.equal((await P.rememberMine(s.bot, s.ctx, 'mine')).reason, 'no_trail', 'no pure functions');
        s.ctx.routes = fakeRoutes(s.bot, { steps: trailSteps().map(p => ({ ...p, sky: false })) });
        const r = await P.rememberMine(s.bot, s.ctx, 'mine');
        assert.equal(r.reason, 'no_entrance');
        assert.equal(r.text, 'I have not been under open sky since I started. Walk with me from the entrance of the mine and tell me again.',
            'fix round F24 (item 4): 48 steps, the trail is not full');
        s.ctx.settings = { mine_routes: true, trail_max_steps: 48 };
        assert.equal((await P.rememberMine(s.bot, s.ctx, 'mine')).text,
            'I was not under open sky in my last 48 steps. Walk with me from the entrance of the mine and tell me again.', 'a full trail');
        assert.equal(s.ctx.mines.list().length, 0);
    });
});

describe('rememberTunnel (B3)', () => {
    test('in the tunnel: start, direction away from the room, end, length, level; the same start replaces it', async () => {
        const s = await known();
        s.bot.entity.position = { x: 21.5, y: 34, z: 7.5 };
        const r = await P.rememberTunnel(s.bot, s.ctx, '');
        assert.equal(r.ok, true, r.text);
        assert.equal(r.text, 'I measured the tunnel: it starts at (21, 34, 2), goes south, and ends at (21, 34, 13) after 12 blocks, at level 34. I dig on at its end when you ask for ore.');
        assert.equal(s.ctx.mines.byName('mine').tunnels.length, 1);
    });

    test('the yaw of the player away from the room is kept; a new start is a second tunnel', async () => {
        const s = await known();
        s.world.fill(22, 34, 7, 27, 35, 7, 'air'); // a side corridor to the east of the tunnel
        s.bot.entity.position = { x: 25.5, y: 34, z: 7.5 };
        const r = await P.rememberTunnel(s.bot, s.ctx, 'mine', { playerYaw: -Math.PI / 2 });
        assert.equal(r.text, 'I measured the tunnel: it starts at (22, 34, 7), goes east, and ends at (27, 34, 7) after 6 blocks, at level 34. I dig on at its end when you ask for ore.');
        assert.equal(s.ctx.mines.byName('mine').tunnels.length, 2);
    });

    test('F6: a stale yaw that looks back to the room is ignored; the tunnel goes on away from it', async () => {
        const s = await known();
        s.bot.entity.position = { x: 21.5, y: 34, z: 13.5 };
        const r = await P.rememberTunnel(s.bot, s.ctx, '', { playerYaw: 0 }); // yaw 0: north, to the landing and the room
        assert.equal(r.text, 'I measured the tunnel: it starts at (21, 34, 2), goes south, and ends at (21, 34, 13) after 12 blocks, at level 34. I dig on at its end when you ask for ore.');
        assert.equal(s.ctx.mines.byName('mine').tunnels.length, 1, 'no second tunnel into the landing');
    });

    test('F7: a room of 3 by 3 and a corridor of 3 are no tunnel; a corridor of 4 is one', async () => {
        const s = await known();
        s.world.fill(30, 40, 0, 32, 41, 2, 'air'); // a room of 3 x 3, 2 high
        s.world.fill(40, 40, 0, 40, 41, 3, 'air'); // a corridor of 4
        s.world.fill(44, 40, 0, 44, 41, 2, 'air'); // a corridor of 3
        // v0.1.4.11, W2 and I3: the text names the first check that failed (open sides at the feet, the width
        // ahead, the ceiling); a corridor of 3 fails on its length, which W2 does not name (the text of part W)
        const refused = (text) => ({ ok: false, reason: 'no_corridor', text });
        const cases = [
            [30, 0, 'a corner of the room', 'I stand in no tunnel: the way ahead at (31, 40, 0) is 3 wide. A tunnel is 1 or 2 wide and 2 high.'],
            [31, 0, 'the middle of a wall', 'I stand in no tunnel: it is open on 3 sides at (31, 40, 0). Stand in the tunnel and say "dig here".'],
            [31, 1, 'the middle of the room', 'I stand in no tunnel: it is open on 4 sides at (31, 40, 1). Stand in the tunnel and say "dig here".'],
            [44, 0, 'a corridor of 3', 'I stand in no tunnel: the corridor at (44, 40, 0) is only 3 long. A tunnel is 4 or more.'], // the lead's text, round 1
        ];
        for (const [x, z, what, text] of cases) {
            s.bot.entity.position = { x: x + 0.5, y: 40, z: z + 0.5 };
            const r = await P.rememberTunnel(s.bot, s.ctx, '', {});
            assert.deepEqual({ ok: r.ok, reason: r.reason, text: r.text }, refused(text), what);
        }
        assert.equal(s.ctx.mines.byName('mine').tunnels.length, 1, 'nothing saved');
        s.bot.entity.position = { x: 40.5, y: 40, z: 0.5 };
        const r = await P.rememberTunnel(s.bot, s.ctx, '', {});
        assert.equal(r.text, 'I measured the tunnel: it starts at (40, 40, 0), goes south, and ends at (40, 40, 3) after 4 blocks, at level 40. I dig on at its end when you ask for ore.');
        assert.equal(s.ctx.mines.byName('mine').tunnels.length, 2);
    });

    test('no corridor, no mine', async () => {
        const s = await known();
        s.world.fill(40, 34, 0, 40, 35, 0, 'air');
        s.bot.entity.position = { x: 40.5, y: 34, z: 0.5 };
        s.ctx.mines.byName('mine');
        const r = await P.rememberTunnel(s.bot, s.ctx, '');
        // v0.1.4.11: a pocket of 1 cell is a corridor too short (the lead's text, round 1)
        assert.deepEqual([r.reason, r.text], ['no_corridor', 'I stand in no tunnel: the corridor at (40, 34, 0) is only 1 long. A tunnel is 4 or more.']);
        const empty = await scene();
        const n = await P.rememberTunnel(empty.bot, empty.ctx, '');
        assert.deepEqual([n.reason, n.text], ['no_mine', 'I know no mine here. Tell me "this is the mine" first.']);
    });
});

describe('mineOre in a known mine (B4)', () => {
    test('the route in, the tunnel dug on at its end, the ore, the chest of the room, the route out; no new shaft', async () => {
        const s = await known();
        s.world.set(21, 34, 15, 'iron_ore').set(21, 35, 16, 'iron_ore');
        const r = await P.mineOre(s.bot, s.ctx, 'iron', 2, s.opts);
        assert.equal(r.ok, true, r.text);
        assert.equal(r.text, 'I mined 2 raw_iron. The mine is at (0, 64, -3), its tunnel is 13 blocks long at level 34. I also stored 3 cobblestone in the chest of the mine.');
        assert.equal(count(s.bot, 'raw_iron'), 2);
        assert.deepEqual(s.ctx.routes.calls, [{ name: 'mine', legs: 6, reverse: false }, { name: 'mine', legs: 3, reverse: true }], 'out from the room by the 3 legs before it (F24)');
        assert.deepEqual(s.stored[0].chest, { x: -2, y: 50, z: 2 });
        const m = s.ctx.mines.byName('mine');
        assert.deepEqual([m.tunnels[0].end, m.tunnels[0].length], [{ x: 21, y: 34, z: 14 }, 13], 'saved after the step');
        assert.equal(s.ctx.mines.list().length, 1, 'no new mine');
        assert.equal(s.bot.calls.some(c => c[0] === 'place' && c[4] === 'ladder'), false, 'no ladder placed');
        assert.deepEqual(feet(s.bot), { x: 0, y: 64, z: -3 }, 'up again at the entrance');
        assert.ok(digs(s.bot).every(c => c[2] === 34 || c[2] === 35), 'dug only in the tunnel');
    });

    test('a broken route: its text, reason no_path, nothing dug', async () => {
        const text = 'I could not follow the route "mine" at step 3 of 6, at (0, 62, 0). Show me the way again.';
        const s = await known({ routes: { fail: { ok: false, reason: 'no_path', text, leg: 2, at: { x: 0, y: 62, z: 0 } } } });
        const r = await P.mineOre(s.bot, s.ctx, 'iron', 2, s.opts);
        assert.deepEqual([r.ok, r.reason, r.text, r.mined], [false, 'no_path', text, 0]);
        assert.equal(digs(s.bot).length, 0);
    });

    test('stopped on the route: interrupted with the text of the route', async () => {
        const text = 'I was stopped on the route "mine" at step 3 of 6.';
        const s = await known({ routes: { fail: b => { b.interrupt_code = true; return { ok: false, reason: 'interrupted', text, leg: 2, at: null }; } } });
        const r = await P.mineOre(s.bot, s.ctx, 'iron', 2, s.opts);
        assert.deepEqual([r.reason, r.text], ['interrupted', text]);
        assert.equal(digs(s.bot).length, 0);
    });

    test('no tunnel for the ore: the text of the spec; with newMine it is not refused for that', async () => {
        const s = await known();
        const r = await P.mineOre(s.bot, s.ctx, 'diamond', 2, s.opts);
        assert.equal(r.reason, 'no_tunnel');
        assert.equal(r.text, 'Your mine "mine" has no tunnel where diamond is found (from -64 to 16). Its tunnel is at level 34. Show me a tunnel at that depth, or tell me to dig a new mine.');
        assert.equal(digs(s.bot).length, 0);
        assert.deepEqual(s.ctx.routes.calls, []);
        s.ctx.settings = { mine_routes: true, mining_max_minutes: 0.2 };
        const y = await P.mineOre(s.bot, s.ctx, 'diamond', 2, { ...s.opts, newMine: true });
        assert.notEqual(y.reason, 'no_tunnel', y.text);
    });

    test('goToMine and leaveMine walk the route of the mine of the player', async () => {
        const s = await known();
        const g = await P.goToMine(s.bot, s.ctx, '', s.opts);
        assert.deepEqual([g.ok, g.text], [true, 'I am in the mine "mine".']);
        assert.deepEqual(feet(s.bot), { x: 21, y: 34, z: 13 });
        const l = await P.leaveMine(s.bot, s.ctx, s.opts);
        assert.deepEqual([l.ok, l.text], [true, 'I am on the surface at (0, 64, -3).']);
        assert.equal(s.ctx.routes.calls[1].reverse, true);
    });

    test('prepareMiningTrip for the tunnel: no ladders and no chest', async () => {
        const s = await known();
        const said = [];
        s.ctx.say = t => said.push(t);
        const mine = s.ctx.mines.byName('mine');
        const r = await P.prepareMiningTrip(s.bot, s.ctx, 'iron', { ...s.opts, mine, level: 34, wayDownTo: 34, hasBase: true });
        assert.equal(r.ok, true, r.text);
        assert.equal(r.level, 34);
        assert.equal(r.missing.some(m => m.name === 'ladder' || m.name === 'chest'), false, JSON.stringify(r.missing));
    });
});

describe('every switch off is v0.1.4.8', () => {
    for (const [name, settings, routes] of [['mine_routes off', {}, {}], ['mine_routes on without ctx.routes', { mine_routes: true }, null]]) {
        test(`${name}: the mine of the player is not used, mineOre asks; no branch, no ore list`, async () => {
            const s = await known();
            s.ctx.settings = settings;
            s.ctx.routes = routes === null ? null : fakeRoutes(s.bot);
            const r = await P.mineOre(s.bot, s.ctx, 'iron', 2, s.opts);
            assert.equal(r.reason, 'ask', r.text);
            assert.match(r.text, /^I know no mine for iron\. I can dig a new one at /);
            assert.equal(digs(s.bot).length, 0);
            assert.equal(P.currentMine(s.bot, s.ctx), null, 'the mine of the player is not seen');
            assert.equal((await P.leaveMine(s.bot, s.ctx, s.opts)).text, 'I know no mine here.');
        });
    }

    test('digTunnel without the switch: the ore beside is not listed, the view of v0.1.4.7', async () => {
        const s = await known();
        s.ctx.settings = {};
        s.world.set(22, 34, 14, 'gold_ore');
        const mine = s.ctx.mines.byName('mine');
        s.bot.entity.position = { x: 21.5, y: 34, z: 13.5 };
        const r = await P.digTunnel(s.bot, s.ctx, 1, { ...s.opts, mine, tunnel: 0 });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(r.left, []);
        assert.deepEqual(s.ctx.mines.byName('mine').passed, []);
    });
});

describe('side branches (B5)', () => {
    test('a tunnel of 32: the first branch to the left at 4 blocks from the start, 1 wide and 2 high', async () => {
        const s = await known({ world: mineWorld({ tunnelTo: 33 }) });
        const mine = s.ctx.mines.byName('mine');
        mine.tunnels[0] = { ...mine.tunnels[0], end: { x: 21, y: 34, z: 33 }, length: 32 };
        s.ctx.mines.set(mine);
        s.world.set(24, 34, 6, 'iron_ore').set(25, 34, 6, 'iron_ore');
        const r = await P.mineOre(s.bot, s.ctx, 'iron', 2, s.opts);
        assert.equal(r.ok, true, r.text);
        for (const x of [22, 23]) {
            assert.ok(['air', 'torch'].includes(s.world.nameAt(x, 34, 6)), `feet ${x}: air or the torch of F31`);
            assert.equal(s.world.nameAt(x, 35, 6), 'air', `head ${x}`);
        }
        assert.deepEqual([s.world.nameAt(24, 34, 6), s.world.nameAt(25, 34, 6)], ['air', 'air'], 'the ore beyond step 2, taken as a vein');
        assert.equal(s.world.nameAt(22, 34, 5), 'stone', '1 wide');
        assert.equal(s.world.nameAt(22, 36, 6), 'stone', '2 high');
        assert.equal(s.world.nameAt(21, 34, 34), 'stone', 'the main tunnel waits for its branches');
        const b = s.ctx.mines.byName('mine').tunnels[0].branches[0];
        assert.deepEqual([b.at, b.side, b.start, b.end, b.length, b.done], [4, 'left', { x: 22, y: 34, z: 6 }, { x: 23, y: 34, z: 6 }, 2, false]);
    });

    test('a branch is done at 8 blocks and when it is blocked; then the next one', async () => {
        const s = await known({ world: mineWorld({ tunnelTo: 33 }) });
        const mine = s.ctx.mines.byName('mine');
        mine.tunnels[0] = { ...mine.tunnels[0], end: { x: 21, y: 34, z: 33 }, length: 32 };
        s.ctx.mines.set(mine);
        s.world.fill(20, 33, 5, 20, 36, 7, 'bedrock'); // the right branch at 4 meets bedrock at once
        s.world.set(20, 34, 10, 'iron_ore');
        s.ctx.settings = { mine_routes: true, mining_max_minutes: 10 };
        const r = await P.mineOre(s.bot, s.ctx, 'iron', 1, s.opts);
        assert.equal(r.ok, true, r.text);
        const branches = s.ctx.mines.byName('mine').tunnels[0].branches;
        assert.deepEqual(branches.slice(0, 2).map(b => [b.at, b.side, b.length, b.done]), [[4, 'left', 8, true], [4, 'right', 0, true]]);
        assert.deepEqual([branches[2].at, branches[2].side], [8, 'left']);
    });
});

describe('side branches of a mine of the bot (B5)', () => {
    test('with mine_routes the tunnel of 32 of a mine of the bot gets its first branch; without it the tunnel goes on', async () => {
        const make = async settings => {
            const s = await scene({ pos: [0.5, 64, 0.5], world: makeWorld(), settings: {} });
            give(s.bot, 'ladder', 64);
            give(s.bot, 'chest', 2);
            give(s.bot, 'iron_pickaxe', 1);
            const d = await P.descendToLevel(s.bot, s.ctx, 56, { ...s.opts, ore: 'coal' });
            assert.equal(d.ok, true, d.text);
            const b = await P.setupMineBase(s.bot, s.ctx, { ...s.opts, mine: d.mine });
            assert.equal(b.ok, true, b.text);
            const t = await P.digTunnel(s.bot, s.ctx, 32, { ...s.opts, mine: b.mine });
            assert.equal(t.mine.length, 32, t.text);
            await P.climbToSurface(s.bot, s.ctx, { ...s.opts, mine: t.mine });
            s.ctx.settings = settings;
            return s;
        };
        const on = await make({ mine_routes: true, mining_max_minutes: 3 });
        on.world.set(-3, 56, -6, 'coal_ore'); // in the first branch to the left (west) at 4 from the start (0, 56, -2)
        const r = await P.mineOre(on.bot, on.ctx, 'coal', 1, on.opts);
        assert.equal(r.ok, true, r.text);
        assert.ok(['air', 'torch'].includes(on.world.nameAt(-1, 56, -6)), 'air or the torch of F31');
        assert.equal(on.world.nameAt(-1, 57, -6), 'air');
        assert.deepEqual(on.ctx.mines.get('coal').tunnels[0].branches.map(b => [b.at, b.side]), [[4, 'left']]);
        assert.equal(on.ctx.mines.get('coal').length, 32, 'the main tunnel waits');
        const off = await make({ mining_max_minutes: 3 });
        const r2 = await P.mineOre(off.bot, off.ctx, 'coal', 1, off.opts);
        assert.notEqual(r2.reason, 'ask', r2.text);
        assert.equal(off.world.nameAt(-1, 56, -6), 'stone', 'no branch');
        assert.ok(off.ctx.mines.get('coal').length > 32, 'the main tunnel goes on');
        assert.deepEqual(off.ctx.mines.get('coal').tunnels, []);
    });
});

describe('digTunnel with options.line (B5)', () => {
    test('a line with at and side is a branch of the tunnel and saved; a bare line is dug and only returned', async () => {
        const s = await known();
        s.bot.entity.position = { x: 21.5, y: 34, z: 6.5 };
        const mine = s.ctx.mines.byName('mine');
        const r = await P.digTunnel(s.bot, s.ctx, 2, { ...s.opts, mine, tunnel: 0,
            line: { at: 4, side: 'left', start: { x: 22, y: 34, z: 6 }, dir: 'east', end: { x: 21, y: 34, z: 6 }, length: 0 } });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual([r.line.end, r.line.length], [{ x: 23, y: 34, z: 6 }, 2]);
        assert.deepEqual(s.ctx.mines.byName('mine').tunnels[0].branches.map(b => [b.at, b.side, b.length, b.done]), [[4, 'left', 2, false]]);
        const bare = await P.digTunnel(s.bot, s.ctx, 2, { ...s.opts, mine: s.ctx.mines.byName('mine'), line: { start: { x: 21, y: 34, z: 9 }, dir: 'west', end: { x: 21, y: 34, z: 9 }, length: 0 } });
        assert.equal(bare.ok, true, bare.text);
        assert.deepEqual([bare.line.end, bare.line.length], [{ x: 19, y: 34, z: 9 }, 2]);
        assert.equal(s.world.nameAt(19, 35, 9), 'air');
        assert.equal(s.ctx.mines.byName('mine').tunnels[0].branches.length, 1, 'the bare line is not saved');
        assert.match(bare.text, /^I dug 2 steps of the tunnel, it is 2 blocks long now\./);
    });
});

describe('the ore list and collectPassedOre (B6)', () => {
    test('gold beside the tunnel with a stone pickaxe: listed with the reason, said; with an iron pickaxe collected', async () => {
        const s = await known();
        s.world.set(22, 34, 14, 'gold_ore').set(22, 35, 14, 'gold_ore').set(21, 34, 15, 'iron_ore').set(21, 35, 16, 'iron_ore');
        const r = await P.mineOre(s.bot, s.ctx, 'iron', 2, s.opts);
        assert.equal(r.ok, true, r.text);
        assert.match(r.text, / I left 2 gold_ore behind: I need an iron pickaxe\.$/);
        const passed = s.ctx.mines.byName('mine').passed;
        assert.deepEqual(passed.map(e => [e.ore, e.x, e.y, e.z, e.reason]).sort(), [['gold', 22, 34, 14, 'pickaxe'], ['gold', 22, 35, 14, 'pickaxe']]);
        assert.ok(passed.every(e => typeof e.seen === 'string'));
        assert.equal(s.world.nameAt(22, 34, 14), 'gold_ore', 'not destroyed with the stone pickaxe');
        const none = await P.collectPassedOre(s.bot, s.ctx, 'coal', 8, s.opts);
        assert.deepEqual([none.reason, none.text], ['none', 'I passed no coal in the mine "mine".']);
        const weak = await P.collectPassedOre(s.bot, s.ctx, 'gold', 8, s.opts);
        assert.equal(weak.text, 'I collected 0 gold_ore that I had passed. 2 gold_ore stay: I need an iron pickaxe.');
        give(s.bot, 'iron_pickaxe', 1);
        s.ctx.routes.calls.length = 0;
        const c = await P.collectPassedOre(s.bot, s.ctx, 'gold', 8, s.opts);
        assert.deepEqual([c.ok, c.text, c.collected], [true, 'I collected 2 gold_ore that I had passed.', 2]);
        assert.equal(count(s.bot, 'raw_gold'), 2);
        assert.deepEqual(s.ctx.mines.byName('mine').passed, []);
        assert.deepEqual(s.ctx.routes.calls.map(x => x.reverse), [false, true], 'in and out again');
        assert.equal((await P.collectPassedOre(s.bot, s.ctx, 'mithril', 8, s.opts)).reason, 'unknown_ore');
    });

    test('gold in the wall beside the end of the tunnel is seen when the bot digs on there (W68)', async () => {
        const s = await known();
        s.world.set(22, 34, 13, 'gold_ore').set(22, 35, 13, 'gold_ore').set(21, 34, 15, 'iron_ore').set(21, 34, 16, 'iron_ore');
        const r = await P.mineOre(s.bot, s.ctx, 'iron', 2, s.opts);
        assert.equal(r.ok, true, r.text);
        assert.match(r.text, / I left 2 gold_ore behind: I need an iron pickaxe\.$/);
        assert.deepEqual(s.ctx.mines.byName('mine').passed.map(e => `${e.x},${e.y},${e.z}:${e.reason}`).sort(), ['22,34,13:pickaxe', '22,35,13:pickaxe']);
        const off = await known({ settings: {} });
        off.world.set(22, 34, 13, 'coal_ore');
        const mine = off.ctx.mines.byName('mine');
        off.bot.entity.position = { x: 21.5, y: 34, z: 13.5 };
        await P.digTunnel(off.bot, off.ctx, 1, { ...off.opts, mine, tunnel: 0 });
        assert.equal(off.world.nameAt(22, 34, 13), 'coal_ore', 'without mine_routes the end is not looked at (v0.1.4.8)');
    });

    test('stopped half way: the text says how many; an entry that is no ore any more leaves', async () => {
        const s = await known();
        const mine = s.ctx.mines.byName('mine');
        mine.passed = [{ ore: 'coal', x: 22, y: 34, z: 9, reason: 'inventory' }, { ore: 'coal', x: 20, y: 34, z: 11, reason: 'inventory' },
            { ore: 'coal', x: 22, y: 35, z: 4, reason: 'inventory' }];
        s.ctx.mines.set(mine);
        s.world.set(22, 34, 9, 'coal_ore').set(20, 34, 11, 'coal_ore'); // (22, 35, 4) is stone now
        s.bot.entity.position = { x: 21.5, y: 34, z: 13.5 };
        s.clock.onTick = () => {
            if (digs(s.bot).length >= 1) s.bot.interrupt_code = true;
        };
        const r = await P.collectPassedOre(s.bot, s.ctx, 'coal', 8, s.opts);
        assert.deepEqual([r.reason, r.text], ['interrupted', 'I was stopped after 1 of 3 coal_ore.']);
        assert.deepEqual(s.ctx.routes.calls, [], 'in the mine: no walk in or out');
        const left = s.ctx.mines.byName('mine').passed.map(e => `${e.x},${e.y},${e.z}`);
        assert.equal(left.includes('22,35,4'), false, 'no ore any more');
        assert.equal(left.length, 1);
    });

    test('lava beside and a vein bigger than 12 are listed by digTunnel', async () => {
        const s = await known();
        s.world.set(22, 34, 14, 'coal_ore').set(23, 34, 14, 'lava');
        for (let x = 20; x >= 5; x--) {
            s.world.set(x, 35, 14, 'coal_ore');
        }
        const mine = s.ctx.mines.byName('mine');
        s.bot.entity.position = { x: 21.5, y: 34, z: 13.5 };
        const r = await P.digTunnel(s.bot, s.ctx, 1, { ...s.opts, mine, tunnel: 0 });
        assert.equal(r.ok, true, r.text);
        const reasons = s.ctx.mines.byName('mine').passed.reduce((m, e) => ({ ...m, [e.reason]: (m[e.reason] ?? 0) + 1 }), {});
        assert.deepEqual(reasons, { lava: 1, vein: 4 }, JSON.stringify(reasons));
        assert.equal(s.world.nameAt(22, 34, 14), 'coal_ore', 'lava beside: left');
    });

    test('a full inventory: the ore stays with the reason inventory', async () => {
        const s = await known();
        s.world.set(22, 34, 14, 'coal_ore');
        for (let i = 0; i < 40; i++) {
            give(s.bot, 'oak_sapling', 1).count = 64;
            s.bot.inventory.list[s.bot.inventory.list.length - 1].name = `filler_${i}`;
        }
        const mine = s.ctx.mines.byName('mine');
        s.bot.entity.position = { x: 21.5, y: 34, z: 13.5 };
        const r = await P.digTunnel(s.bot, s.ctx, 1, { ...s.opts, mine, tunnel: 0 });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(s.ctx.mines.byName('mine').passed.map(e => e.reason), ['inventory']);
    });
});

describe('ore_sense_range (B7)', () => {
    async function senseScene(range) {
        const s = await known({ settings: { mine_routes: true, ore_sense_range: range } });
        s.world.set(23, 34, 14, 'iron_ore'); // 2 blocks inside the left wall of the first new step
        s.world.set(21, 34, 16, 'iron_ore'); // ahead, taken by the tunnel
        return s;
    }

    test('0: the ore inside the wall stays, the ore ahead is taken instead', async () => {
        const s = await senseScene(0);
        const r = await P.mineOre(s.bot, s.ctx, 'iron', 1, s.opts);
        assert.equal(r.ok, true, r.text);
        assert.equal(s.world.nameAt(23, 34, 14), 'iron_ore');
        assert.equal(s.world.nameAt(22, 34, 14), 'stone', 'no cut');
    });

    test('3: a side cut 1 wide and 2 high takes it, and the cut stays open', async () => {
        const s = await senseScene(3);
        const r = await P.mineOre(s.bot, s.ctx, 'iron', 1, s.opts);
        assert.equal(r.ok, true, r.text);
        assert.equal(s.world.nameAt(23, 34, 14), 'air');
        assert.equal(s.world.nameAt(22, 34, 14), 'air');
        assert.equal(s.world.nameAt(22, 35, 14), 'air');
        assert.equal(s.world.nameAt(21, 34, 16), 'iron_ore', 'one was enough');
    });

    test('3: an ore 2 under the floor is taken from the cell behind, the floor closed again', async () => {
        const s = await known({ settings: { mine_routes: true, ore_sense_range: 3 } });
        s.world.set(21, 32, 14, 'iron_ore');
        const r = await P.mineOre(s.bot, s.ctx, 'iron', 1, s.opts);
        assert.equal(r.ok, true, r.text);
        assert.equal(s.world.nameAt(21, 32, 14), 'air');
        assert.notEqual(s.world.nameAt(21, 33, 14), 'air', 'the floor is closed');
        assert.equal(s.bot.health, 20);
    });
});

describe('F24: the way out along the tunnel, its corners and branches', () => {
    // A tunnel that went 3 blocks to the side once: (21, 34, 2) south to z 8, east to x 24, south to z 14,
    // and a branch to the left (east) at 4 from the start, 2 blocks long, not done. The way in ends at
    // (21, 34, 0) in the landing.
    const CORNERS = [{ x: 21, y: 34, z: 2 }, { x: 21, y: 34, z: 8 }, { x: 24, y: 34, z: 8 }, { x: 24, y: 34, z: 14 }];
    async function bent({ pos = [23.5, 34, 6.5] } = {}) {
        const world = mineWorld({ tunnelTo: 8 });
        world.fill(21, 34, 8, 24, 35, 8, 'air').fill(24, 34, 8, 24, 35, 14, 'air').fill(22, 34, 6, 23, 35, 6, 'air');
        const s = await scene({ world, pos });
        s.ctx.mines.set({
            name: 'mine', source: 'player', ore: 'iron', entrance: { x: 0, y: 64, z: -3 }, level: 34, dimension: 'overworld',
            route: [...LEGS.slice(0, 4), { kind: 'walk', from: { x: 2, y: 50, z: 0 }, to: { x: 21, y: 34, z: 0 } }],
            room: { center: { x: 1, y: 50, z: 0 }, chest: { x: -2, y: 50, z: 2 }, table: null, furnace: null },
            tunnels: [{ start: CORNERS[0], dir: 'south', end: CORNERS[3], level: 34, length: 32, corners: CORNERS,
                branches: [{ at: 4, side: 'left', start: { x: 22, y: 34, z: 6 }, end: { x: 23, y: 34, z: 6 }, length: 2, done: false }] }],
        });
        return s;
    }
    const gotos = bot => bot.calls.filter(c => c[0] === 'goto').map(c => `${c[1]},${c[2]},${c[3]}`);

    test('the hops: from the branch to its junction, the corners back to the start, the end of the way in', () => {
        const mine = { route: [{ kind: 'walk', from: { x: 2, y: 50, z: 0 }, to: { x: 21, y: 34, z: 0 } }],
            tunnels: [{ start: CORNERS[0], dir: 'south', end: CORNERS[3], level: 34, length: 17, corners: CORNERS,
                branches: [{ at: 4, side: 'left', start: { x: 22, y: 34, z: 6 }, end: { x: 23, y: 34, z: 6 }, length: 2, done: false }] }] };
        const key = list => list.map(p => `${p.x},${p.y},${p.z}`);
        assert.deepEqual(key(P.wayBackHops(mine, { x: 23, y: 34, z: 6 })), ['21,34,6', '21,34,2', '21,34,0']);
        assert.deepEqual(key(P.wayBackHops(mine, { x: 24, y: 34, z: 14 })), ['24,34,8', '21,34,8', '21,34,2', '21,34,0']);
        assert.deepEqual(key(P.wayBackHops(mine, { x: 26, y: 34, z: 11 })), ['24,34,11', '24,34,8', '21,34,8', '21,34,2', '21,34,0'], 'from a side cut');
        assert.deepEqual(key(P.wayBackHops(mine, { x: 21, y: 34, z: 0 })), []);
        const back = P.wayBack(mine, { x: 24, y: 34, z: 14 });
        assert.deepEqual([key(back.hops), back.leg], [['24,34,8', '21,34,8', '21,34,2', '21,34,0'], 0], 'to the end of the way in');
        const roomMine = { ...mine, route: LEGS.slice(0, 4), room: { center: { x: 1, y: 50, z: 0 }, chest: { x: -2, y: 50, z: 2 }, table: null, furnace: null } };
        assert.deepEqual(P.wayBack(roomMine, { x: -1, y: 50, z: 2 }), { hops: [{ x: 0, y: 50, z: 0 }], leg: 2 }, 'from the room: the end of the nearest leg');
        assert.deepEqual(P.wayBack(roomMine, { x: 0, y: 55, z: 0 }), { hops: [], leg: 2 }, 'on the ladder: from there');
        // the fresh-checkout run of the fix of v0.1.4.9 (mine_known): the nearest leg from the room is the walk down to the
        // tunnel; its end lies below the room, so the hop is the cell of that leg nearest to the feet, at the room
        const descentMine = { ...roomMine, route: [...LEGS.slice(0, 4), { kind: 'walk', from: { x: 2, y: 50, z: 0 }, to: { x: 21, y: 34, z: 0 } }] };
        const fromRoom = P.wayBack(descentMine, { x: 1, y: 50, z: 2 });
        assert.equal(fromRoom.leg, 3, 'the nearest leg: the walk through the room');
        assert.equal(fromRoom.hops.length, 1);
        assert.ok(fromRoom.hops[0].y === 50 && fromRoom.hops[0].z === 0 && fromRoom.hops[0].x >= 0 && fromRoom.hops[0].x <= 2,
            `a cell of the walk through the room, never the foot of the descent: ${JSON.stringify(fromRoom.hops)}`);
        const fromChest = P.wayBack(descentMine, { x: -2, y: 50, z: 2 });
        assert.ok(fromChest.hops.every(h => h.y === 50), `from the chest the hops stay at the room level: ${JSON.stringify(fromChest.hops)}`);
    });

    test('a trip that ends in a branch: back along the branch and the corners to the route, then up', async () => {
        const s = await bent();
        const r = await P.leaveMine(s.bot, s.ctx, s.opts);
        assert.deepEqual([r.ok, r.text], [true, 'I am on the surface at (0, 64, -3).']);
        const g = gotos(s.bot);
        const order = ['21,34,6', '21,34,2', '21,34,0'].map(k => g.indexOf(k));
        assert.ok(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), JSON.stringify(g));
        assert.deepEqual(s.ctx.routes.calls.map(c => c.reverse), [true]);
    });

    test('a hop blocked by gravel of the mine is dug through; a block of a player is named, the bot stays, !leaveMine tries again', async () => {
        const s = await bent({ pos: [24.5, 34, 14.5] });
        s.world.set(24, 35, 10, 'gravel');
        s.bot.noPath = { has: k => (k === '24,34,8' && s.world.nameAt(24, 35, 10) !== 'air') || (k === '21,34,2' && s.world.nameAt(21, 34, 4) !== 'air') };
        s.world.set(21, 34, 4, 'oak_planks');
        const r = await P.leaveMine(s.bot, s.ctx, s.opts);
        assert.equal(s.world.nameAt(24, 35, 10), 'air', 'the gravel was dug');
        assert.deepEqual([r.ok, r.reason, r.text], [false, 'blocked', 'I could not get to the way out at (21, 34, 0): I was blocked at (21, 34, 4).']);
        assert.equal(s.world.nameAt(21, 34, 4), 'oak_planks', 'not dug');
        assert.equal(P.mineAt([s.ctx.mines.byName('mine')], s.bot.entity.position)?.tunnel, 0, 'it stays in the tunnel');
        assert.deepEqual(s.ctx.routes.calls, [], 'no route walked');
        s.world.set(21, 34, 4, 'air');
        const again = await P.leaveMine(s.bot, s.ctx, s.opts);
        assert.deepEqual([again.ok, again.text], [true, 'I am on the surface at (0, 64, -3).']);
    });

    test('mineOre ending blocked says so in its text; a stone outside the cells of the mine is not dug', async () => {
        const s = await bent({ pos: [21.5, 34, 7.5] });
        s.world.set(21, 34, 4, 'stone');
        s.bot.noPath = { has: k => k === '21,34,0' && s.world.nameAt(21, 34, 4) !== 'air' };
        s.ctx.mines.set({ ...s.ctx.mines.byName('mine'), route: [{ kind: 'walk', from: { x: 2, y: 50, z: 0 }, to: { x: 21, y: 34, z: 0 } }] });
        const mine = s.ctx.mines.byName('mine');
        mine.tunnels[0].corners = [{ x: 21, y: 34, z: 5 }, ...CORNERS.slice(1)]; // the cell (21, 34, 4) is not a cell of the mine now
        mine.tunnels[0].start = { x: 21, y: 34, z: 5 };
        s.ctx.mines.set(mine);
        s.world.set(25, 34, 6, 'iron_ore'); // on the way of the branch left not done
        s.ctx.storage = null; // nothing stored: the way out starts in the branch
        const r = await P.mineOre(s.bot, s.ctx, 'iron', 1, s.opts);
        assert.equal(r.mined, 1, r.text);
        assert.match(r.text, /^I mined 1 raw_iron\. The mine is at \(0, 64, -3\), its tunnel is 32 blocks long at level 34\. .*I could not get to the way out at \(21, 34, 0\): I was blocked at \(21, 34, 4\)\.$/);
        assert.equal(s.world.nameAt(21, 34, 4), 'stone');
        assert.equal(P.mineAt([s.ctx.mines.byName('mine')], s.bot.entity.position)?.tunnel, 0, 'it stays in the tunnel');
    });

    test('a branch left not done: the next trip walks in by the route and digs on at the end of that branch', async () => {
        const s = await bent({ pos: [0.5, 64, -6.5] });
        s.world.set(26, 34, 6, 'iron_ore');
        const r = await P.mineOre(s.bot, s.ctx, 'iron', 1, s.opts);
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(s.ctx.routes.calls.map(c => [c.reverse, c.legs]), [[false, 5], [true, 3]], 'in by the route; out from the room after storing');
        const b = s.ctx.mines.byName('mine').tunnels[0].branches[0];
        assert.deepEqual([b.at, b.side, b.start], [4, 'left', { x: 22, y: 34, z: 6 }], 'the same branch, not a new one');
        assert.ok(b.length > 2, `dug on: ${b.length}`);
        assert.equal(s.world.nameAt(26, 34, 6), 'air');
        assert.equal(s.ctx.mines.byName('mine').tunnels[0].branches.length, 1);
    });
});

describe('F24: the side step of digTunnel keeps the corners for the way back', () => {
    test('water ahead: 3 blocks to the side, the corners saved, the way back goes through the corner', async () => {
        const s = await known();
        s.world.set(21, 34, 14, 'water');
        const mine = s.ctx.mines.byName('mine');
        s.bot.entity.position = { x: 21.5, y: 34, z: 13.5 };
        const r = await P.digTunnel(s.bot, s.ctx, 3, { ...s.opts, mine, tunnel: 0 });
        assert.equal(r.ok, true, r.text);
        const t = s.ctx.mines.byName('mine').tunnels[0];
        assert.deepEqual(t.corners, [{ x: 21, y: 34, z: 2 }, { x: 21, y: 34, z: 13 }, { x: 18, y: 34, z: 13 }]);
        assert.deepEqual([t.end, t.length], [{ x: 18, y: 34, z: 13 }, 15]);
        const key = list => list.map(p => `${p.x},${p.y},${p.z}`);
        assert.deepEqual(key(P.wayBackHops(s.ctx.mines.byName('mine'), t.end)), ['21,34,13', '21,34,5', '21,34,2', '21,34,10', '21,34,13'], 'whole');
        assert.deepEqual(P.wayBack(s.ctx.mines.byName('mine'), t.end), { hops: [{ x: 21, y: 34, z: 13 }], leg: 5 },
            'this way in runs along the tunnel: the walk back ends at the corner, on the last leg');
    });
});

describe('fix round F24, items 1, 3 and 4', () => {
    test('item 1: a dropped item is known by its name; the deprecated objectType is never read', async () => {
        const s = await scene({ pos: [0.5, 64, 0.5], world: makeWorld() });
        let warned = 0;
        const item = { id: 700, name: 'item', item: 'raw_iron', count: 1, position: { x: 2.5, y: 64, z: 0.5 } };
        Object.defineProperty(item, 'objectType', { get() { warned++; console.trace('Warning: entity.objectType is deprecated.'); return 'Item'; } });
        s.bot.entities[700] = item;
        assert.equal(P.isDroppedItem(item), true);
        assert.equal(P.isDroppedItem({ name: 'zombie' }), false);
        assert.equal(P.isDroppedItem({ displayName: 'Item' }), false, 'no name: no item');
        const out = [];
        const saved = { trace: console.trace, log: console.log, warn: console.warn, error: console.error };
        for (const k of Object.keys(saved)) console[k] = (...a) => out.push(a.join(' '));
        try {
            const r = await P.collectDrops(s.bot, { x: 0, y: 64, z: 0 }, { clock: s.clock, radius: 6 });
            assert.equal(r.ok, true);
        } finally {
            Object.assign(console, saved);
        }
        assert.equal(warned, 0, 'objectType read');
        assert.deepEqual(out, [], 'no console output');
        assert.equal(count(s.bot, 'raw_iron'), 1);
    });

    test('item 3: a trip in the mine of the player without torches asks for them first; without any it says the tunnel is dark', async () => {
        const s = await known();
        s.bot.inventory.list = s.bot.inventory.list.filter(i => i.name !== 'torch');
        s.world.set(21, 34, 15, 'iron_ore');
        const asked = [];
        const said = [];
        s.ctx.say = t => said.push(t);
        s.ctx.storage.fetchItem = async (b, c, name, n) => { asked.push(['fetch', name, n]); return { ok: false, taken: 0 }; };
        s.ctx.tools = { async craftSupplies(b, c, name, n) { asked.push(['craft', name, n, digs(s.bot).length]); return { ok: false, text: 'no' }; } };
        const r = await P.mineOre(s.bot, s.ctx, 'iron', 1, s.opts);
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(said, ['I get my supplies: 16 torches.']);
        assert.deepEqual(asked, [['fetch', 'torch', 16], ['craft', 'torch', 16, 0]], 'from the chests, then crafted, before any dig; no ladder, no chest');
        assert.match(r.text, / I had no torches, the tunnel is dark\.$/);
        const lit = await known();
        lit.world.set(21, 34, 15, 'iron_ore');
        const ok = await P.mineOre(lit.bot, lit.ctx, 'iron', 1, lit.opts);
        assert.doesNotMatch(ok.text, /tunnel is dark/);
    });

    test('item 4: goToMine with mine_routes takes the nearest mine with a tunnel, whatever the ore, and walks in by the route', async () => {
        const s = await known();
        const g = await P.goToMine(s.bot, s.ctx, 'coal', s.opts);
        assert.deepEqual([g.ok, g.text], [true, 'I am in the mine "mine".']);
        assert.deepEqual(s.ctx.routes.calls.map(c => c.reverse), [false]);
        assert.equal((await P.goToMine(s.bot, s.ctx, 'mithril', s.opts)).reason, 'unknown_ore');
        const off = await known({ settings: {} });
        const o = await P.goToMine(off.bot, off.ctx, 'coal', off.opts);
        assert.equal(o.text, 'I know no mine for coal. Tell me to mine coal and I make one.', 'without the switch as before');
    });
});

describe('fix round F31: the supplies stay with the bot, torches in the dug tunnel', () => {
    test('a trip with 16 torches: stored in the room chest is all but the supplies; the torches placed come from the 16', async () => {
        const s = await known();
        give(s.bot, 'ladder', 8);
        s.world.set(21, 34, 21, 'iron_ore');
        const chest = {};
        s.ctx.storage.storeItems = async (bot, ctx, options) => {
            // stores exactly what `keep` does not keep (-1 keeps all)
            const totals = {};
            for (const i of bot.inventory.items()) totals[i.name] = (totals[i.name] ?? 0) + i.count;
            for (const [name, n] of Object.entries(totals)) {
                const k = options.keep?.[name] === -1 ? n : Math.min(n, options.keep?.[name] ?? 0);
                if (n - k > 0) {
                    chest[name] = (chest[name] ?? 0) + n - k;
                    let rest = n - k;
                    for (const i of bot.inventory.list.filter(x => x.name === name)) {
                        const t = Math.min(i.count, rest);
                        i.count -= t;
                        rest -= t;
                    }
                    bot.inventory.list = bot.inventory.list.filter(x => x.count > 0);
                }
            }
            return { ok: true, reason: null, stored: {}, left: {}, text: 'I stored things.' };
        };
        const r = await P.mineOre(s.bot, s.ctx, 'iron', 1, s.opts);
        assert.equal(r.ok, true, r.text);
        const placed = s.bot.calls.filter(c => c[0] === 'place' && c[4] === 'torch').length;
        assert.ok(placed >= 1, 'a torch in the new part of the tunnel');
        assert.equal(count(s.bot, 'torch'), 16 - placed);
        assert.equal(count(s.bot, 'ladder'), 8);
        assert.equal(count(s.bot, 'stone_pickaxe'), 1);
        assert.equal(count(s.bot, 'bread'), 8);
        assert.equal(chest.torch, undefined);
        assert.equal(chest.ladder, undefined);
        assert.ok(count(s.bot, 'cobblestone') <= 32 && count(s.bot, 'cobblestone') > 0, 'fillers up to 32');
    });

    test('tripKeep: whatever `keep` says; the fillers together up to 32, cobblestone first', async () => {
        const s = await scene();
        give(s.bot, 'cobbled_deepslate', 40);
        give(s.bot, 'iron_pickaxe', 1);
        const keep = P.tripKeep(s.bot, { raw_iron: -1, torch: 2, cobblestone: 5 });
        assert.deepEqual([keep.torch, keep.ladder, keep.stone_pickaxe, keep.iron_pickaxe, keep.raw_iron, keep.chest, keep.bread],
            [-1, -1, -1, -1, -1, 1, 8]);
        assert.deepEqual([keep.cobblestone, keep.cobbled_deepslate], [32, undefined], '64 cobblestone: 32 of it, no deepslate');
    });

    const torchesAt = s => s.bot.calls.filter(c => c[0] === 'place' && c[4] === 'torch').map(c => c[3]);
    async function digOn(torchZ) {
        const s = await known();
        if (torchZ !== null) s.world.set(21, 34, torchZ, 'torch');
        s.bot.entity.position = { x: 21.5, y: 34, z: 13.5 };
        const r = await P.digTunnel(s.bot, s.ctx, 3, { ...s.opts, mine: s.ctx.mines.byName('mine'), tunnel: 0 });
        assert.equal(r.ok, true, r.text);
        return torchesAt(s);
    }

    test('torches from the last one: none in the tunnel of 12, at its 13th block; 8 behind at once; within 3 when due', async () => {
        assert.deepEqual(await digOn(null), [14], 'no torch in the last 8 cells: the first new block');
        assert.deepEqual(await digOn(6), [14], 'the last torch 8 cells behind the first new block');
        assert.deepEqual(await digOn(8), [16], '8 cells after the torch at z 8');
        assert.deepEqual(await digOn(12), [], 'the next is due at z 20');
        assert.equal(P.torchDue((x, y, z) => (z === 5 && y === 35 ? 'wall_torch' : 'air'), { x: 0, y: 34, z: 12 }, 'south'), false, 'a wall torch counts');
    });
});

// v0.1.4.11, fix round F28 (engineer E6): "this is the mine" as !rememberArea(name, "mine") saves an area of type mine
// around the tunnel and records the mine. The trip then digs on in that area (the guard lets the bot break its natural
// blocks); an area of another type there still stops it.
describe('mineOre in an area of type mine (F28)', () => {
    const box = { min: { x: 9, y: 30, z: 1 }, max: { x: 33, y: 42, z: 25 } };

    test('the tunnel is dug on inside the area of type mine', async () => {
        const s = await known();
        s.ctx.areas = [{ name: 'mine', type: 'mine', ...box }];
        s.world.set(21, 34, 15, 'iron_ore').set(21, 35, 16, 'iron_ore');
        const r = await P.mineOre(s.bot, s.ctx, 'iron', 2, s.opts);
        assert.equal(r.ok, true, r.text);
        assert.equal(count(s.bot, 'raw_iron'), 2);
    });

    test('an area of type building there stops the trip as before', async () => {
        const s = await known();
        s.ctx.areas = [{ name: 'store', type: 'building', ...box }];
        s.world.set(21, 34, 15, 'iron_ore').set(21, 35, 16, 'iron_ore');
        const r = await P.mineOre(s.bot, s.ctx, 'iron', 2, s.opts);
        assert.equal(r.reason, 'area', r.text);
        assert.equal(count(s.bot, 'raw_iron'), 0);
    });
});
