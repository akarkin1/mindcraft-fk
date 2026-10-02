// Spec v0.1.4.11 part M (engineer E2) on the fake bot of the mining pack (mining_fake_bot.test.js):
// I3 rememberTunnel (the bot's cell, then the player's cell with options.playerPos; 2 wide; the rock face;
// the first failed check of W2 named), PLAN 2.3 mineOre in a tunnel that is not saved, I4 mineOre from the
// room of a known mine with mine_from_inside (the shaft down from the floor cell, the child record, back in
// the room, !mines, !leaveMine from the bottom through the parent) and without it (W3). The routes pack is a
// fake on ctx.routes as in rtb_mine.test.js: its walkRoute puts the bot at the end of the legs it was given.
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

// The mine of the player of rtb_mine.test.js (ground y 63): the entrance at (0, 64, -3), a trapdoor at
// (0, 63, 0), ladders down to a room at y 50 (x -2..2, z -2..2, 3 high) with a chest, a crafting table and a
// furnace, a landing at y 34 (x 20..22, z -1..1) and a tunnel x 21, z 2..13 at y 34, 2 high, going south.
// Bedrock at y 20 and below (minY 20), so that a shaft for gold ends at level 25.
function mineWorld() {
    const w = makeWorld({ minY: 20 });
    w.fill(-2, 50, -2, 2, 52, 2, 'air');
    w.set(-2, 50, 2, 'chest').set(2, 50, 2, 'crafting_table').set(2, 50, -2, 'furnace');
    w.fill(0, 53, 0, 0, 62, 0, 'ladder', { facing: 'south' });
    w.fill(20, 34, -1, 22, 36, 1, 'air');
    w.fill(21, 34, 2, 21, 35, 13, 'air');
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

const MINE = () => ({
    name: 'mine', source: 'player', ore: 'iron', entrance: { x: 0, y: 64, z: -3 }, level: 34, dimension: 'overworld', route: LEGS,
    room: { center: { x: 1, y: 50, z: 0 }, chest: { x: -2, y: 50, z: 2 }, table: { x: 2, y: 50, z: 2 }, furnace: { x: 2, y: 50, z: -2 } },
    tunnels: [{ start: { x: 21, y: 34, z: 2 }, dir: 'south', end: { x: 21, y: 34, z: 13 }, level: 34, length: 12, branches: [] }], passed: [],
});

const endOf = leg => leg.to ?? { x: leg.x, y: leg.bottom, z: leg.z };

function fakeRoutes() {
    const calls = [];
    return {
        calls,
        trail: { list: () => [] },
        logic: { skyStart: () => -1, routeFromSteps: () => ({ legs: LEGS }) },
        async walkRoute(b, route, options = {}) {
            calls.push({ name: route.name, legs: route.legs.length, reverse: options.reverse === true });
            const end = options.reverse ? route.legs[0].from ?? route.legs[0].entry : endOf(route.legs[route.legs.length - 1]);
            b.entity.position.x = end.x + 0.5;
            b.entity.position.y = end.y;
            b.entity.position.z = end.z + 0.5;
            return { ok: true, reason: null, text: '', leg: null, at: end };
        },
    };
}

async function scene({ pos = [21.5, 34, 7.5], world = mineWorld(), settings = {} } = {}) {
    const bot = makeMiningBot({ world, pos });
    const clock = makeClock(bot);
    const ctx = await makeCtx(clock);
    ctx.settings = { mine_routes: true, ...settings };
    ctx.routes = fakeRoutes();
    ctx.whereAmI = () => ({ area: null, depth: 20, underground: true });
    const said = [];
    ctx.say = t => said.push(t);
    ctx.storage = { async storeItems() { return { ok: true, reason: null, stored: {}, left: {}, text: 'I stored nothing.' }; } };
    ctx.mines.set(MINE());
    give(bot, 'iron_pickaxe', 1);
    give(bot, 'stone_pickaxe', 1);
    give(bot, 'cobblestone', 64);
    give(bot, 'torch', 16);
    give(bot, 'bread', 8);
    give(bot, 'ladder', 64);
    give(bot, 'chest', 1);
    return { world, bot, clock, ctx, said, opts: { now: clock.now, wait: clock.wait } };
}

const feet = bot => ({ x: Math.floor(bot.entity.position.x), y: Math.floor(bot.entity.position.y + 0.01), z: Math.floor(bot.entity.position.z) });
const put = (bot, x, y, z) => {
    bot.entity.position.x = x + 0.5;
    bot.entity.position.y = y;
    bot.entity.position.z = z + 0.5;
};
const digs = bot => bot.calls.filter(c => c[0] === 'dig');

describe('I3: rememberTunnel where the bot or the player stands', () => {
    test('the bot in the room, the player in a tunnel: measured from where the player stands', async () => {
        const s = await scene({ pos: [0.5, 50, 0.5] });
        s.world.fill(3, 50, 0, 9, 51, 0, 'air'); // a tunnel east from the room
        const r = await P.rememberTunnel(s.bot, s.ctx, '', { playerPos: { x: 7.3, y: 50, z: 0.6 }, playerYaw: -Math.PI / 2 });
        assert.equal(r.ok, true, r.text);
        assert.equal(r.text, 'I measured the tunnel from where you stand: it starts at (3, 50, 0), goes east, and ends at (9, 50, 0) after 7 blocks, at level 50. I dig on at its end when you ask for ore.');
        assert.equal(s.ctx.mines.byName('mine').tunnels.length, 2);
    });

    test('the bot\'s cell first: a tunnel there is measured whatever the player\'s cell', async () => {
        const s = await scene();
        const r = await P.rememberTunnel(s.bot, s.ctx, '', { playerPos: { x: 0.5, y: 50, z: 0.5 } });
        assert.equal(r.text, 'I measured the tunnel: it starts at (21, 34, 2), goes south, and ends at (21, 34, 13) after 12 blocks, at level 34. I dig on at its end when you ask for ore.');
    });

    test('a tunnel 2 wide is accepted and its width said', async () => {
        const s = await scene();
        s.world.fill(22, 34, 2, 22, 35, 13, 'air'); // the tunnel is 2 wide now
        const r = await P.rememberTunnel(s.bot, s.ctx, '', {});
        assert.equal(r.ok, true, r.text);
        assert.equal(r.text, 'I measured the tunnel: it starts at (21, 34, 2), goes south, and ends at (21, 34, 13) after 12 blocks, at level 34, 2 wide. I dig on at its end when you ask for ore.');
        assert.deepEqual(s.ctx.mines.byName('mine').tunnels[0], { start: { x: 21, y: 34, z: 2 }, dir: 'south', end: { x: 21, y: 34, z: 13 }, level: 34, length: 12, branches: [] },
            'the record keeps its shape');
    });

    test('the bot at the rock face with a yaw towards the room: the tunnel goes on into the rock', async () => {
        const s = await scene({ pos: [21.5, 34, 13.5] });
        const r = await P.rememberTunnel(s.bot, s.ctx, '', { playerYaw: 0 });
        assert.match(r.text, /^I measured the tunnel: it starts at \(21, 34, 2\), goes south, and ends at \(21, 34, 13\) after 12 blocks/);
    });

    test('both cells fail: the text names the first failed check at the bot\'s cell (W2), nothing saved', async () => {
        const s = await scene({ pos: [0.5, 50, 0.5] });
        const r = await P.rememberTunnel(s.bot, s.ctx, '', { playerPos: { x: 30.5, y: 40, z: 30.5 } });
        assert.deepEqual([r.ok, r.reason], [false, 'no_corridor']);
        assert.equal(r.text, P.noCorridorText?.({ kind: 'open_sides', at: { x: 0, y: 50, z: 0 }, sides: 4 })
            ?? 'I stand in no tunnel: it is open on 4 sides at (0, 50, 0). Stand in the tunnel and say "dig here".');
        assert.match(r.text, /^I stand in no tunnel: it is open on 4 sides at \(0, 50, 0\)\./);
        s.world.set(21, 36, 7, 'air');
        const c = await P.rememberTunnel(s.bot, s.ctx, '', { playerPos: { x: 21.5, y: 34, z: 7.5 } });
        assert.equal(c.text, 'I stand in no tunnel: it is open on 4 sides at (0, 50, 0). Stand in the tunnel and say "dig here".', 'the player\'s cell has an open ceiling');
        assert.equal(s.ctx.mines.byName('mine').tunnels.length, 1);
    });
});

describe('PLAN 2.3: mineOre in a tunnel that is not saved', () => {
    test('measures and saves it first, says so, and digs on at its end', async () => {
        const s = await scene({ pos: [5.5, 50, 0.5] });
        s.world.fill(3, 50, 0, 9, 51, 0, 'air'); // a tunnel east from the room, not saved
        s.world.set(11, 50, 0, 'iron_ore');
        s.ctx.settings.mining_max_minutes = 5;
        const r = await P.mineOre(s.bot, s.ctx, 'iron', 1, s.opts);
        assert.equal(s.said[0], 'I measured the tunnel: it starts at (3, 50, 0), goes east, and ends at (9, 50, 0) after 7 blocks, at level 50. I dig on at its end when you ask for ore.');
        const tunnels = s.ctx.mines.byName('mine').tunnels;
        assert.equal(tunnels.length, 2, 'saved');
        assert.ok(tunnels[1].end.x >= 10, `dug on at its end: ${JSON.stringify(tunnels[1])}`);
        assert.equal(r.ok, true, r.text);
        assert.ok(digs(s.bot).every(c => c[2] === 50 || c[2] === 51), 'dug only in that tunnel');
    });

    test('in a saved tunnel or in the room: nothing measured', async () => {
        const s = await scene({ pos: [0.5, 50, 0.5] });
        await P.mineOre(s.bot, s.ctx, 'gold', 1, { ...s.opts, newMine: false });
        assert.equal(s.said.some(t => t.startsWith('I measured')), false);
        assert.equal(s.ctx.mines.byName('mine').tunnels.length, 1);
    });
});

describe('I4: mineOre from the room of a known mine (W3)', () => {
    test('mine_from_inside off: the text names the mine and the setting, nothing dug, nothing saved', async () => {
        const s = await scene({ pos: [1.5, 50, 1.5] });
        const r = await P.mineOre(s.bot, s.ctx, 'gold', 1, { ...s.opts, newMine: true });
        assert.deepEqual([r.ok, r.reason], [false, 'underground']);
        assert.equal(r.text, 'I am in the mine "mine". A new shaft from inside needs the setting mine_from_inside; say "leave the mine" first for a new mine from the surface.');
        assert.equal(digs(s.bot).length, 0);
        assert.equal(s.ctx.mines.list().length, 1);
    });

    test('underground in no known mine: the text of W3, with the switch on or off', async () => {
        for (const on of [false, true]) {
            const s = await scene({ pos: [40.5, 40, 40.5], settings: { mine_from_inside: on } });
            s.world.fill(40, 40, 40, 40, 41, 40, 'air');
            s.ctx.mines.remove('mine');
            const r = await P.mineOre(s.bot, s.ctx, 'gold', 1, { ...s.opts, newMine: true });
            assert.equal(r.text, 'I am underground, not in a mine I know. A new mine starts from the surface: say "leave the mine" or "go to the surface" first.', String(on));
            assert.equal(digs(s.bot).length, 0);
        }
    });

    test('mine_from_inside on: a shaft with ladders from the floor cell, the child mine, back in the room; !mines; !leaveMine from the bottom', async () => {
        const s = await scene({ pos: [1.5, 50, 1.5], settings: { mine_from_inside: true, mining_max_minutes: 10 } });
        s.world.set(1, 25, -4, 'gold_ore');
        const r = await P.mineOre(s.bot, s.ctx, 'gold', 1, { ...s.opts, newMine: true });
        assert.equal(s.said.find(t => t.startsWith('I dig a shaft')), 'I dig a shaft down from here to level 25 for gold.');
        const child = s.ctx.mines.atLevel(25);
        assert.ok(child, 'the child mine is saved');
        assert.equal(P.mineKey(child), 'bot:25');
        assert.equal(child.parent, 'mine');
        assert.equal(child.shaft, 'ladder');
        assert.deepEqual(child.entrance, { x: 1, y: 50, z: 1 }, 'the floor cell the bot stood on');
        assert.equal(child.route[0].kind, 'ladder');
        assert.deepEqual([child.route[0].x, child.route[0].z, child.route[0].top], [1, 1, 49]);
        for (let y = 26; y <= 49; y++) assert.equal(s.world.nameAt(1, y, 1), 'ladder', `a ladder at y ${y}`);
        assert.equal(r.ok, true, r.text);
        assert.equal(count(s.bot, 'raw_gold') >= 1, true);
        assert.equal(feet(s.bot).y, 50, `back in the room: ${JSON.stringify(feet(s.bot))}`);
        assert.equal(s.ctx.routes.calls.length, 0, 'the route of the parent was not walked');
        assert.equal(P.minesText(s.ctx, 'overworld'), 'I know 2 mines: "mine", entrance (0, 64, -3), 1 tunnel at level 34; bot:25 (from the mine "mine").');

        // !goToMine("gold") from the room: down the new shaft, though the parent has a tunnel (at 34, no gold there)
        const go = await P.goToMine(s.bot, s.ctx, 'gold', s.opts);
        assert.equal(go.ok, true, go.text);
        assert.equal(feet(s.bot).y, 25, `at the bottom of the shaft: ${JSON.stringify(feet(s.bot))}`);
        assert.equal(s.ctx.routes.calls.length, 0, 'from the room, not by the route of the parent');
        // !leaveMine from the bottom: up the shaft, then the way out of the parent
        put(s.bot, child.base.x, child.base.y, child.base.z);
        const out = await P.leaveMine(s.bot, s.ctx, s.opts);
        assert.equal(out.ok, true, out.text);
        assert.equal(feet(s.bot).y, 64, `on the surface: ${JSON.stringify(feet(s.bot))}`);
        assert.deepEqual(s.ctx.routes.calls.map(c => c.reverse), [true], 'the parent\'s route, backwards');

        // a second trip for gold from the surface: through the parent and down the shaft, no new shaft
        s.said.length = 0;
        const placed = s.bot.calls.filter(c => c[0] === 'place' && c[4] === 'ladder').length;
        s.world.set(child.end.x + (child.direction === 'east' ? 2 : 0), 25, child.end.z + (child.direction === 'north' ? -2 : 0), 'gold_ore');
        s.ctx.whereAmI = () => ({ area: null, depth: 0, underground: false });
        const again = await P.mineOre(s.bot, s.ctx, 'gold', 1, s.opts);
        assert.equal(s.said.some(t => t.startsWith('I dig a shaft')), false);
        assert.equal(s.bot.calls.filter(c => c[0] === 'place' && c[4] === 'ladder').length, placed, 'no new ladders');
        assert.equal(s.ctx.routes.calls[1]?.reverse, false, 'into the parent by its route');
        assert.equal(s.ctx.mines.list().length, 2);
        assert.equal(again.mine?.parent, 'mine', again.text);
        assert.equal(again.ok, true, again.text);
        assert.equal(feet(s.bot).y, 64, 'a trip that started on the surface ends there');
    });
});
