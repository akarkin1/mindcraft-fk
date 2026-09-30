// T1, spec v0.1.4.9 part B through the functions of the mining pack (src/agent/packs/mining/index.js) on the fake
// bot of the mining pack: !rememberMine (B2), !rememberTunnel (B3), the work in a known mine (B4: the text of
// no_tunnel; without mine_routes the choice of v0.1.4.8) and !collectPassedOre (B6). The routes of the context are
// the real ones of the routes pack (bindRoutes, I4), the trail a list of steps.
//
// The world: grass at y 60; an open oak trapdoor at (31, 60, 2) over ladders facing south at (31, 41..59, 2); a room
// x 31..32, y 41..42, z 3..7 with a chest at (32, 41, 7) and a crafting table at (31, 41, 7); a tunnel east from the
// room at z 5, x 33..44; a second tunnel south from the chest at x 32, z 8..19. The bot walked in from the grass
// and stands at (34, 41, 5) in the east tunnel.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeMiningBot, makeClock, makeCtx, give, count, REGISTRY, v } from './mining_fake_bot.test.js';

const M = await loadSrc('src/agent/packs/mining/index.js');
const R = await loadSrc('src/agent/packs/routes/index.js');

let warn;
let log;
before(() => {
    warn = console.warn;
    log = console.log;
    console.warn = () => {};
    console.log = () => {};
});
after(() => {
    console.warn = warn;
    console.log = log;
});

const T = Object.freeze({ kind: 'trapdoor', name: 'oak_trapdoor', x: 31, y: 60, z: 2 });
const st = (x, y, z, extra = {}) => ({ x, y, z, on: 'stone', at: 'air', sky: false, t: 0, via: null, ...extra });

function mineWorld({ chest = true, furnace = false } = {}) {
    const world = makeWorld({ groundY: 60 });
    world.set(31, 60, 2, 'oak_trapdoor', { facing: 'south', half: 'top', open: true });
    world.fill(31, 41, 2, 31, 59, 2, 'ladder', { facing: 'south' });
    world.fill(31, 41, 3, 32, 42, 7, 'air');
    if (chest) world.set(32, 41, 7, 'chest', { facing: 'north' });
    world.set(31, 41, 7, 'crafting_table');
    if (furnace) world.set(31, 41, 6, 'furnace', { facing: 'east' });
    world.fill(33, 41, 5, 44, 42, 5, 'air');
    world.fill(32, 41, 8, 32, 42, 19, 'air');
    return world;
}

// the way in: 5 steps on the grass under the sky (the last over the trapdoor), through the trapdoor, down the
// ladder, through the room into the east tunnel
function wayIn(end = [[31, 41, 3], [31, 41, 4], [32, 41, 5], [33, 41, 5], [34, 41, 5]]) {
    const steps = [];
    for (const z of [6, 5, 4, 3]) steps.push(st(31, 61, z, { on: 'grass_block', sky: true }));
    steps.push(st(31, 61, 2, { on: 'oak_trapdoor', sky: true, via: { ...T } }));
    steps.push(st(31, 60, 2, { at: 'oak_trapdoor', via: { ...T } }));
    for (let y = 59; y >= 41; y--) steps.push(st(31, y, 2, { at: 'ladder', via: y === 59 ? { ...T } : null }));
    for (const [x, y, z] of end) steps.push(st(x, y, z));
    return steps;
}

// findBlocks as mineflayer has it, over the blocks that were set in the fake world
function addFindBlocks(bot, world) {
    bot.findBlocks = ({ matching, maxDistance = 16, count: n = 1, point } = {}) => {
        const c = point ?? bot.entity.position;
        const ids = Array.isArray(matching) ? matching : [matching];
        const test = typeof matching === 'function' ? matching : (b) => ids.includes(b.type);
        const out = [];
        for (const key of world.blocks.keys()) {
            const [x, y, z] = key.split(',').map(Number);
            const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y, z + 0.5 - c.z);
            if (d <= maxDistance && test(world.block(x, y, z))) out.push({ p: v(x, y, z), d });
        }
        return out.sort((a, b) => a.d - b.d).slice(0, n).map((e) => e.p);
    };
    bot.findBlock = (options) => {
        const [p] = bot.findBlocks({ ...options, count: 1 });
        return p ? bot.blockAt(p) : null;
    };
}

async function scene({ world = mineWorld(), steps = wayIn(), pos = [34.5, 41, 5.5], settings = {}, routes = true } = {}) {
    const bot = makeMiningBot({ world, pos });
    addFindBlocks(bot, world);
    bot.activateBlock = async (block) => { // a door, a gate or a trapdoor opens or closes
        const p = block.position;
        bot.calls.push(['activate', p.x, p.y, p.z]);
        world.set(p.x, p.y, p.z, world.nameAt(p.x, p.y, p.z), { ...world.propsAt(p.x, p.y, p.z), open: world.propsAt(p.x, p.y, p.z).open !== true });
    };
    bot.modes = { noteProgress() {}, pause() {}, unpause() {} };
    const clock = makeClock(bot);
    const ctx = await makeCtx(clock, { settings: { mining_pack: true, routes_pack: true, mine_routes: true, ore_sense_range: 0, ...settings } });
    if (routes) {
        const trail = { list: () => steps.map((s) => ({ ...s })), tick() {} };
        ctx.routes = R.bindRoutes(bot, ctx, new R.RouteStore(null, {}), trail);
    }
    return { world, bot, clock, ctx, steps };
}

const REMEMBERED = (legs) => `I remember the mine "mine": the entrance at (31, 61, 2), the way in has ${legs} steps with 1 ladder and 1 trapdoor, `
    + 'the room at level 41 with a chest and a crafting table, one tunnel at level 41, 12 blocks long, going east.';

// ------------------------------------------------------------------------------ B2

describe('B2: rememberMine', () => {
    test('the text of B2: the entrance (the last step under the sky), the way in, the room, the tunnel', async () => {
        const s = await scene();
        const r = await M.rememberMine(s.bot, s.ctx, 'mine');
        assert.equal(r.ok, true, r.text);
        const legs = r.mine.route.length;
        assert.equal(r.text, REMEMBERED(legs));
    });

    test('the saved mine: name, source player, entrance, level, ore iron, route with a ladder and a trapdoor, room, one tunnel, dimension', async () => {
        const s = await scene();
        await M.rememberMine(s.bot, s.ctx, 'mine');
        const m = s.ctx.mines.byName('mine', 'overworld');
        assert.ok(m, 'in the store by its name');
        assert.equal(m.source, 'player');
        assert.deepEqual({ ...m.entrance }, { x: 31, y: 61, z: 2 });
        assert.equal(m.level, 41, 'the feet of the bot');
        assert.equal(m.ore, 'iron');
        assert.equal(m.dimension, 'overworld');
        assert.equal(m.route.filter((l) => l.kind === 'ladder').length, 1);
        assert.equal(m.route.filter((l) => l.kind === 'door' && l.kind2 === 'trapdoor').length, 1);
        assert.deepEqual({ ...m.room.chest }, { x: 32, y: 41, z: 7 });
        assert.deepEqual({ ...m.room.table }, { x: 31, y: 41, z: 7 });
        assert.equal(m.room.furnace, null);
        assert.deepEqual({ ...m.room.center }, { x: 34, y: 41, z: 5 }, 'center: the feet of the bot');
        assert.equal(m.tunnels.length, 1);
        const t = m.tunnels[0];
        assert.deepEqual({ start: { ...t.start }, dir: t.dir, end: { ...t.end }, level: t.level, length: t.length },
            { start: { x: 33, y: 41, z: 5 }, dir: 'east', end: { x: 44, y: 41, z: 5 }, level: 41, length: 12 });
    });

    test('the place of the mine is remembered at the entrance (rememberPlace as today)', async () => {
        const s = await scene();
        await M.rememberMine(s.bot, s.ctx, 'mine');
        const p = s.ctx.places.recall('mine');
        assert.ok(p, 'the place "mine"');
        assert.deepEqual([p.x, p.y, p.z], [31, 61, 2]);
    });

    test('with a furnace: `with a chest, a crafting table and a furnace`', async () => {
        const s = await scene({ world: mineWorld({ furnace: true }) });
        const r = await M.rememberMine(s.bot, s.ctx, 'mine');
        assert.ok(r.text.includes('the room at level 41 with a chest, a crafting table and a furnace, one tunnel'), r.text);
    });

    test('without a chest: `no chest`', async () => {
        const s = await scene({ world: mineWorld({ chest: false }) });
        const r = await M.rememberMine(s.bot, s.ctx, 'mine');
        assert.ok(r.text.includes('no chest'), r.text);
    });

    test('no corridor of 4 open cells ahead: `no tunnel yet: stand in a tunnel and say "dig here"`', async () => {
        const s = await scene({ pos: [31.5, 41, 4.5], steps: wayIn([[31, 41, 3], [31, 41, 4]]) });
        const r = await M.rememberMine(s.bot, s.ctx, 'mine');
        assert.equal(r.ok, true, r.text);
        assert.ok(r.text.endsWith(', no tunnel yet: stand in a tunnel and say "dig here".'), r.text);
        assert.deepEqual(s.ctx.mines.byName('mine', 'overworld').tunnels, []);
    });

    test('the name existed: `I know a mine "mine" already. I replace it.` in front', async () => {
        const s = await scene();
        await M.rememberMine(s.bot, s.ctx, 'mine');
        const r = await M.rememberMine(s.bot, s.ctx, 'mine');
        assert.equal(r.text, `I know a mine "mine" already. I replace it. ${REMEMBERED(r.mine.route.length)}`);
        assert.equal(s.ctx.mines.list('overworld').length, 1);
    });

    test('the area of type mine that holds the bot is named (handoff: `It is in the area "deep".` at the end)', async () => {
        const s = await scene();
        s.ctx.areas = [{ name: 'deep', type: 'mine', min: { x: 30, y: 38, z: 0 }, max: { x: 46, y: 45, z: 10 }, dimension: 'overworld' }];
        const r = await M.rememberMine(s.bot, s.ctx, 'mine');
        assert.equal(r.text, `${REMEMBERED(r.mine.route.length)} It is in the area "deep".`);
    });

    test('an area of another type is not named', async () => {
        const s = await scene();
        s.ctx.areas = [{ name: 'home', type: 'home', min: { x: 30, y: 38, z: 0 }, max: { x: 46, y: 45, z: 10 }, dimension: 'overworld' }];
        const r = await M.rememberMine(s.bot, s.ctx, 'mine');
        assert.equal(r.text, REMEMBERED(r.mine.route.length));
    });

    test('no trail (the routes pack off): reason no_trail, `I have no trail. The routes pack is off.`', async () => {
        const s = await scene({ routes: false });
        const r = await M.rememberMine(s.bot, s.ctx, 'mine');
        assert.deepEqual({ ok: r.ok, reason: r.reason, text: r.text }, { ok: false, reason: 'no_trail', text: 'I have no trail. The routes pack is off.' });
        assert.equal(s.ctx.mines.list('overworld').length, 0);
    });

    test('no step under the open sky: reason no_entrance, the text with the number of steps', async () => {
        const steps = wayIn().filter((step) => !step.sky);
        const s = await scene({ steps });
        const r = await M.rememberMine(s.bot, s.ctx, 'mine');
        assert.deepEqual({ ok: r.ok, reason: r.reason, text: r.text }, { ok: false, reason: 'no_entrance',
            text: `I was not under open sky in my last ${steps.length} steps. Walk with me from the entrance of the mine and tell me again.` });
    });
});

// ------------------------------------------------------------------------------ B3

describe('B3: rememberTunnel', () => {
    async function withMine(options = {}) {
        const s = await scene(options);
        await M.rememberMine(s.bot, s.ctx, 'mine');
        return s;
    }
    const moveTo = (s, x, y, z) => {
        s.bot.entity.position = v(x + 0.5, y, z + 0.5);
    };

    test('two directions, no yaw of the player: the longer one; the text of B3', async () => {
        const s = await withMine();
        moveTo(s, 32, 41, 12);
        const r = await M.rememberTunnel(s.bot, s.ctx, '', {});
        assert.equal(r.ok, true, r.text);
        assert.equal(r.text, 'I measured the tunnel: it starts at (32, 41, 8), goes south, and ends at (32, 41, 19) after 12 blocks, at level 41. I dig on at its end when you ask for ore.');
        assert.equal(r.mine?.name, 'mine');
        assert.equal(s.ctx.mines.byName('mine', 'overworld').tunnels.length, 2, 'a second tunnel');
    });

    test('the yaw of the player: the direction nearest to it (yaw 0 looks north)', async () => {
        const s = await withMine();
        moveTo(s, 32, 41, 12);
        const r = await M.rememberTunnel(s.bot, s.ctx, '', { playerYaw: 0 });
        assert.equal(r.text, 'I measured the tunnel: it starts at (32, 41, 19), goes north, and ends at (32, 41, 8) after 12 blocks, at level 41. I dig on at its end when you ask for ore.');
    });

    test('in the tunnel of the mine: mineAt finds the mine; a start within 2 of a known start replaces that tunnel', async () => {
        const s = await withMine();
        moveTo(s, 38, 41, 5);
        const r = await M.rememberTunnel(s.bot, s.ctx, '', { playerYaw: -Math.PI / 2 });
        assert.equal(r.ok, true, r.text);
        assert.equal(r.text, 'I measured the tunnel: it starts at (33, 41, 5), goes east, and ends at (44, 41, 5) after 12 blocks, at level 41. I dig on at its end when you ask for ore.');
        assert.equal(s.ctx.mines.byName('mine', 'overworld').tunnels.length, 1, 'replaced, not added');
    });

    test('no mine within 64: reason no_mine and its text', async () => {
        const s = await scene();
        moveTo(s, 32, 41, 12);
        const r = await M.rememberTunnel(s.bot, s.ctx, '', {});
        assert.deepEqual({ ok: r.ok, reason: r.reason, text: r.text }, { ok: false, reason: 'no_mine', text: 'I know no mine here. Tell me "this is the mine" first.' });
    });

    test('no corridor: reason no_corridor and its text', async () => {
        const s = await withMine();
        s.world.fill(40, 41, 20, 40, 42, 20, 'air'); // a pocket of 1 x 1 x 2 in the rock
        moveTo(s, 40, 41, 20);
        const r = await M.rememberTunnel(s.bot, s.ctx, '', {});
        assert.deepEqual({ ok: r.ok, reason: r.reason, text: r.text },
            { ok: false, reason: 'no_corridor', text: 'I stand in no tunnel. A tunnel is 1 wide and 2 high and open ahead of me.' });
    });
});

// ------------------------------------------------------------------------------ B4

describe('B4: mineOre in a known mine of the player without a fitting tunnel', () => {
    async function ready(settings = {}, routes = true) {
        const s = await scene({ settings, routes });
        s.ctx.mines.set({
            name: 'mine', source: 'player', ore: 'iron', entrance: { x: 31, y: 61, z: 2 }, level: 41, dimension: 'overworld',
            route: [{ kind: 'ladder', x: 31, z: 2, top: 59, bottom: 41, face: 'south', entry: { x: 31, y: 61, z: 3 } }],
            room: { center: { x: 32, y: 41, z: 5 }, chest: { x: 32, y: 41, z: 7 }, table: { x: 31, y: 41, z: 7 }, furnace: null },
            tunnels: [{ start: { x: 33, y: 25, z: 5 }, dir: 'east', end: { x: 44, y: 25, z: 5 }, level: 25, length: 12, branches: [] }], passed: [],
        });
        give(s.bot, 'iron_pickaxe', 1);
        give(s.bot, 'stone_pickaxe', 1);
        give(s.bot, 'torch', 32);
        give(s.bot, 'cobblestone', 64);
        give(s.bot, 'bread', 16);
        give(s.bot, 'ladder', 64);
        give(s.bot, 'chest', 1);
        return s;
    }

    test('diamond with mine_routes: reason no_tunnel, the text of B4 in the singular; nothing dug', async () => {
        const s = await ready();
        const r = await M.mineOre(s.bot, s.ctx, 'diamond', 1, { clock: s.clock, now: s.clock.now, wait: s.clock.wait });
        assert.equal(r.reason, 'no_tunnel', r.text);
        assert.equal(r.text, 'Your mine "mine" has no tunnel where diamond is found (from -64 to 16). Its tunnel is at level 25. Show me a tunnel at that depth, or tell me to dig a new mine.');
        assert.equal(s.bot.calls.filter((c) => c[0] === 'dig').length, 0);
    });

    test('two tunnels: `Its tunnels are at level ...`', async () => {
        const s = await ready();
        const m = s.ctx.mines.byName('mine', 'overworld');
        m.tunnels.push({ start: { x: 33, y: 25, z: 9 }, dir: 'east', end: { x: 44, y: 25, z: 9 }, level: 25, length: 12, branches: [] });
        s.ctx.mines.set(m);
        const r = await M.mineOre(s.bot, s.ctx, 'diamond', 1, { clock: s.clock, now: s.clock.now, wait: s.clock.wait });
        assert.equal(r.reason, 'no_tunnel', r.text);
        assert.ok(r.text.startsWith('Your mine "mine" has no tunnel where diamond is found (from -64 to 16). Its tunnels are at level 25'), r.text);
    });

    test('without mine_routes: the mine of the player is not chosen (v0.1.4.8: no mine of the bot for diamond)', async () => {
        const s = await ready({ mine_routes: false });
        const r = await M.mineOre(s.bot, s.ctx, 'diamond', 1, { clock: s.clock, now: s.clock.now, wait: s.clock.wait });
        assert.notEqual(r.reason, 'no_tunnel', r.text);
        assert.ok(!r.text.includes('Your mine'), r.text);
        assert.ok(r.text.startsWith('I know no mine for diamond.'), `the question of v0.1.4.8 (askMineText): ${r.text}`);
    });

    test('mine_routes on but no ctx.routes (routes pack off): as without mine_routes', async () => {
        const s = await ready({ routes_pack: false }, false);
        const r = await M.mineOre(s.bot, s.ctx, 'diamond', 1, { clock: s.clock, now: s.clock.now, wait: s.clock.wait });
        assert.notEqual(r.reason, 'no_tunnel', r.text);
        assert.ok(!r.text.includes('Your mine'), r.text);
        assert.ok(r.text.startsWith('I know no mine for diamond.'), `the question of v0.1.4.8 (askMineText): ${r.text}`);
    });
});

// ------------------------------------------------------------------------------ B6: collectPassedOre

describe('B6: collectPassedOre', () => {
    // coal in the north wall of the east tunnel at z 4, x 36..41, listed in the ore list
    async function passedScene(n = 4, extra = []) {
        const s = await scene();
        await M.rememberMine(s.bot, s.ctx, 'mine');
        for (let i = 0; i < n; i++) {
            s.world.set(36 + i, 41, 4, 'coal_ore');
            s.ctx.mines.addPassed('mine', { ore: 'coal_ore', x: 36 + i, y: 41, z: 4, reason: 'inventory', seen: '2026-09-30T10:00:00.000Z' });
        }
        for (const e of extra) s.ctx.mines.addPassed('mine', e);
        give(s.bot, 'stone_pickaxe', 1);
        give(s.bot, 'cobblestone', 16);
        return s;
    }
    const opts = (s) => ({ clock: s.clock, now: s.clock.now, wait: s.clock.wait });

    test('4 coal passed: `I collected 4 coal_ore that I had passed.`; the list is empty; the coal is in the inventory', async () => {
        const s = await passedScene(4);
        const r = await M.collectPassedOre(s.bot, s.ctx, 'coal', 8, opts(s));
        assert.equal(r.text, 'I collected 4 coal_ore that I had passed.');
        assert.equal(r.ok, true);
        assert.deepEqual(s.ctx.mines.byName('mine', 'overworld').passed, []);
        assert.equal(count(s.bot, 'coal'), 4);
    });

    test('no coal in the list: reason none, `I passed no coal in the mine "mine".`', async () => {
        const s = await passedScene(0);
        const r = await M.collectPassedOre(s.bot, s.ctx, 'coal', 8, opts(s));
        assert.deepEqual({ reason: r.reason, text: r.text }, { reason: 'none', text: 'I passed no coal in the mine "mine".' });
    });

    test('stopped after 2 of 6: reason interrupted, `I was stopped after 2 of 6 coal_ore.`', async () => {
        const s = await passedScene(6);
        const dig = s.bot.dig;
        let dug = 0;
        s.bot.dig = async (block) => {
            await dig(block);
            if (block.name === 'coal_ore' && ++dug === 2) s.bot.interrupt_code = true;
        };
        const r = await M.collectPassedOre(s.bot, s.ctx, 'coal', 8, opts(s));
        assert.deepEqual({ reason: r.reason, text: r.text }, { reason: 'interrupted', text: 'I was stopped after 2 of 6 coal_ore.' });
    });

    test('all ores with a stone pickaxe: `I collected 4 coal_ore that I had passed. 2 gold_ore stay: I need an iron pickaxe.`', async () => {
        const gold = [36, 37].map((x) => ({ ore: 'gold_ore', x, y: 42, z: 6, reason: 'pickaxe', seen: '2026-09-30T10:00:00.000Z' }));
        const s = await passedScene(4, gold);
        for (const e of gold) s.world.set(e.x, e.y, e.z, 'gold_ore');
        const r = await M.collectPassedOre(s.bot, s.ctx, '', 8, opts(s));
        assert.equal(r.text, 'I collected 4 coal_ore that I had passed. 2 gold_ore stay: I need an iron pickaxe.');
        assert.deepEqual(s.ctx.mines.byName('mine', 'overworld').passed.map((e) => e.x), [36, 37], 'the gold stays in the list');
        assert.equal(s.world.nameAt(36, 42, 6), 'gold_ore');
    });

    test('W68: with an iron pickaxe the gold is taken and the list is empty', async () => {
        const gold = [36, 37].map((x) => ({ ore: 'gold_ore', x, y: 42, z: 6, reason: 'pickaxe', seen: '2026-09-30T10:00:00.000Z' }));
        const s = await passedScene(0, gold);
        for (const e of gold) s.world.set(e.x, e.y, e.z, 'gold_ore');
        give(s.bot, 'iron_pickaxe', 1);
        const r = await M.collectPassedOre(s.bot, s.ctx, 'gold', 8, opts(s));
        assert.equal(r.text, 'I collected 2 gold_ore that I had passed.');
        assert.deepEqual(s.ctx.mines.byName('mine', 'overworld').passed, []);
        assert.equal(count(s.bot, 'raw_gold'), 2);
    });

    test('an entry that is no ore any more leaves the list', async () => {
        const s = await passedScene(2);
        s.world.set(36, 41, 4, 'stone');
        await M.collectPassedOre(s.bot, s.ctx, 'coal', 8, opts(s));
        assert.deepEqual(s.ctx.mines.byName('mine', 'overworld').passed, []);
    });
});

void REGISTRY;

// ------------------------------------------------------------------------------ B4..B7: a trip into the mine of the player

describe('B4 to B7: mineOre in the mine of the player (W67, W64, W68, W69 in small)', () => {
    // the base as above; an open trapdoor lets the bot pass (the fake world counts an open trapdoor as not solid)
    function tripWorld({ open = false } = {}) {
        const world = mineWorld();
        world.set(31, 60, 2, 'oak_trapdoor', { facing: 'south', half: 'top', open });
        const solid = world.solid;
        world.solid = (x, y, z) => {
            if (world.nameAt(x, y, z).endsWith('_trapdoor') && world.propsAt(x, y, z).open === true) return false;
            return solid(x, y, z);
        };
        return world;
    }
    // the way in: the last step under the sky beside the trapdoor, then straight onto the ladder below it (the
    // one shape of a trail recorded going down whose legs come in the order walked, see T1-5)
    function wayBeside() {
        const steps = [];
        for (const z of [6, 5, 4, 3]) steps.push(st(31, 61, z, { on: 'grass_block', sky: true }));
        for (let y = 59; y >= 41; y--) steps.push(st(31, y, 2, { at: 'ladder', via: y === 59 ? { ...T } : null }));
        for (const [x, y, z] of [[31, 41, 3], [31, 41, 4], [32, 41, 5], [33, 41, 5], [34, 41, 5]]) steps.push(st(x, y, z));
        return steps;
    }
    async function trip({ world = tripWorld(), settings = {}, pickaxe = 'stone_pickaxe', steps = wayBeside() } = {}) {
        const s = await scene({ world, settings, steps });
        await M.rememberMine(s.bot, s.ctx, 'mine');
        s.bot.entity.position = v(31.5, 61, 6.5); // back on the grass, 4 blocks from the entrance
        give(s.bot, pickaxe, 1);
        give(s.bot, 'torch', 32);
        give(s.bot, 'cobblestone', 64);
        give(s.bot, 'bread', 16);
        give(s.bot, 'chest', 1);
        s.bot.calls.length = 0;
        return s;
    }
    const opts = (s) => ({ clock: s.clock, now: s.clock.now, wait: s.clock.wait });
    const digsAt = (s) => s.bot.calls.filter((c) => c[0] === 'dig').map((c) => ({ x: c[1], y: c[2], z: c[3], name: c[4] }));
    const tunnelOf = (s) => s.ctx.mines.byName('mine', 'overworld').tunnels[0];

    test('W67: along the route, on at the end of the tunnel, 2 raw_iron, the tunnel longer than 12, no new entrance, nothing dug on the way', { timeout: 60000 }, async () => {
        const world = tripWorld();
        world.set(46, 41, 5, 'iron_ore');
        world.set(47, 42, 5, 'iron_ore');
        const s = await trip({ world });
        const r = await M.mineOre(s.bot, s.ctx, 'iron', 2, opts(s));
        assert.equal(r.ok, true, r.text);
        assert.ok(count(s.bot, 'raw_iron') >= 2, `raw_iron ${count(s.bot, 'raw_iron')}: ${r.text}`);
        assert.ok(tunnelOf(s).length > 12, JSON.stringify(tunnelOf(s)));
        assert.ok(tunnelOf(s).end.x > 44);
        assert.equal(s.ctx.mines.list('overworld').length, 1, 'no new mine');
        const onTheWay = digsAt(s).filter((d) => !(d.x > 44 && d.z >= 4 && d.z <= 6));
        assert.deepEqual(onTheWay, [], 'nothing dug outside the tunnel extension');
        assert.ok(s.bot.entity.position.y >= 60, `the bot came up: ${JSON.stringify(s.bot.entity.position)}`);
    });

    test('W67 with the trail as a climb down records it (a step in the cell of the open trapdoor)', { timeout: 60000 }, async () => {
        // FINDING T1-5 (see rt_route_logic.test.js): the ladder leg comes before the trapdoor leg; the trip ends at
        // the foot of the ladder with `I could not follow the route "mine" at step 2 of 3`.
        const world = tripWorld();
        world.set(46, 41, 5, 'iron_ore');
        world.set(47, 42, 5, 'iron_ore');
        const steps = wayBeside();
        steps.splice(4, 0, st(31, 60, 2, { at: 'oak_trapdoor', via: { ...T } }));
        const s = await trip({ world, steps });
        const r = await M.mineOre(s.bot, s.ctx, 'iron', 2, opts(s));
        assert.equal(r.ok, true, r.text);
        assert.ok(count(s.bot, 'raw_iron') >= 2);
    });

    test('W67 with the way in starting on the closed trapdoor (the last step under the sky of B2)', { timeout: 60000 }, async () => {
        // FINDING T1-4 (see rt_route_logic.test.js): the ladder leg's entry is inside the ground at (31, 60, 1); the
        // trip ends with `I could not follow the route "mine" at step 3 of 4, at (31, 60, 2)`.
        const world = tripWorld();
        world.set(46, 41, 5, 'iron_ore');
        world.set(47, 42, 5, 'iron_ore');
        const s = await trip({ world, steps: wayIn() });
        const r = await M.mineOre(s.bot, s.ctx, 'iron', 2, opts(s));
        assert.equal(r.ok, true, r.text);
        assert.ok(count(s.bot, 'raw_iron') >= 2);
    });

    test('B4, W64: the ladder removed: the text of I3, reason no_path, nothing dug', { timeout: 60000 }, async () => {
        const world = tripWorld();
        world.fill(31, 41, 2, 31, 59, 2, 'air');
        const s = await trip({ world });
        const r = await M.mineOre(s.bot, s.ctx, 'iron', 2, opts(s));
        assert.equal(r.reason, 'no_path', r.text);
        assert.match(r.text, /^I could not follow the route "mine" at step \d+ of \d+, at \(-?\d+, -?\d+, -?\d+\)\. Show me the way again\.$/);
        assert.deepEqual(digsAt(s), []);
        assert.ok(s.bot.entity.position.y >= 60, 'the bot did not fall down the shaft');
    });

    test('W68: gold beside the tunnel end with a stone pickaxe: listed with reason pickaxe, said in the text', { timeout: 60000 }, async () => {
        const world = tripWorld();
        world.set(46, 41, 5, 'iron_ore');
        world.set(47, 41, 5, 'iron_ore');
        world.set(45, 41, 4, 'gold_ore'); // in the north wall of the first new cell
        const s = await trip({ world });
        const r = await M.mineOre(s.bot, s.ctx, 'iron', 2, opts(s));
        assert.equal(r.ok, true, r.text);
        const passed = s.ctx.mines.byName('mine', 'overworld').passed;
        assert.deepEqual(passed.map((e) => [e.x, e.y, e.z, e.reason]), [[45, 41, 4, 'pickaxe']], JSON.stringify(passed));
        assert.equal(world.nameAt(45, 41, 4), 'gold_ore', 'the gold stays in the wall');
        assert.ok(r.text.includes('I left 1 gold_ore behind: I need an iron pickaxe.'), r.text);
    });

    test('W73, B5: a tunnel of 32: the first branch to the left at 4 blocks from the start, 1 wide and 2 high', { timeout: 60000 }, async () => {
        const world = tripWorld();
        world.fill(45, 41, 5, 64, 42, 5, 'air'); // the east tunnel is 32 long: x 33..64
        world.set(37, 41, 1, 'iron_ore'); // in the way of the branch to the left (north of an east tunnel)
        world.set(37, 41, 0, 'iron_ore');
        const s = await trip({ world });
        assert.equal(tunnelOf(s).length, 32, JSON.stringify(tunnelOf(s)));
        const r = await M.mineOre(s.bot, s.ctx, 'iron', 2, opts(s));
        assert.equal(r.ok, true, r.text);
        for (const [x, y, z] of [[37, 41, 4], [37, 42, 4], [37, 41, 3], [37, 42, 3], [37, 41, 2], [37, 42, 2]]) {
            assert.equal(world.nameAt(x, y, z), 'air', `the branch at (${x}, ${y}, ${z})`);
        }
        assert.equal(world.nameAt(36, 41, 3), 'stone', '1 wide');
        assert.equal(world.nameAt(37, 43, 3), 'stone', '2 high');
        assert.equal(world.nameAt(37, 41, 6), 'stone', 'the right side comes later');
        assert.equal(world.nameAt(65, 41, 5), 'stone', 'the main tunnel is not dug on while its branches are not done');
        const branch = tunnelOf(s).branches[0];
        assert.deepEqual({ at: branch?.at, side: branch?.side }, { at: 4, side: 'left' }, JSON.stringify(tunnelOf(s).branches));
    });

    test('W69: an iron ore 2 blocks inside the wall: left with ore_sense_range 0, taken with 3', { timeout: 60000 }, async () => {
        for (const [range, taken] of [[0, false], [3, true]]) {
            const world = tripWorld();
            world.set(46, 41, 5, 'iron_ore'); // ahead
            world.set(46, 41, 3, 'iron_ore'); // 2 blocks inside the north wall of the cell (46, 41, 5)
            const s = await trip({ world, settings: { ore_sense_range: range } });
            const r = await M.mineOre(s.bot, s.ctx, 'iron', taken ? 2 : 1, opts(s));
            assert.equal(r.ok, true, `${range}: ${r.text}`);
            assert.equal(world.nameAt(46, 41, 3) !== 'iron_ore', taken, `ore_sense_range ${range}: ${world.nameAt(46, 41, 3)}`);
        }
    });
});

// ------------------------------------------------------------------------------ B2 with a trail recorded by the recorder of I1

describe('B2 and I1 together: the way in recorded in a shaft of ladders under a trapdoor (the base of W65)', () => {
    // Minecraft's sky light: 15 in a cell whose column up to the sky holds only blocks that let light through
    // (filterLight 0: air, ladders, trapdoors); the rooms under the rock get 0 here (the recorder then checks the
    // column, which is closed). Trapdoors and ladders do not stop light (registry: filterLight 0).
    function withSkyLight(bot, world) {
        const blockAt = bot.blockAt;
        const clear = (name) => (REGISTRY.blocksByName[name]?.filterLight ?? 15) === 0;
        bot.blockAt = (p) => {
            const b = blockAt(p);
            if (!b) return b;
            let open = true;
            for (let y = Math.floor(p.y) + 1; y <= 100 && open; y++) open = clear(world.nameAt(p.x, y, p.z));
            b.skyLight = open ? 15 : 0;
            return b;
        };
    }

    test('the way in holds the ladder and the trapdoor; the entrance is at the surface (section 1, W65)', async () => {
        // FINDING T1-3 (B2 with I1, high): the sky light is 15 all the way down a shaft of ladders under a trapdoor
        // (ladders and trapdoors let light through), so every ladder step of the trail has `sky` true and
        // skyStart gives the foot of the ladder: the entrance is at (31, 41, 2) and the way in has no ladder. The
        // mine of the owner (a ladder with a trapdoor) is remembered without its way down.
        const world = mineWorld();
        const s = await scene({ world, steps: [] });
        withSkyLight(s.bot, world);
        const TR = await loadSrc('src/agent/packs/routes/trail.js');
        const trail = TR.createTrail(s.bot, {}, { file: null, now: s.clock.now });
        const at = (x, y, z, onGround = true) => {
            s.bot.entity.position = v(x + 0.5, y, z + 0.5);
            s.bot.entity.onGround = onGround;
            trail.tick();
        };
        for (const z of [6, 5, 4, 3]) at(31, 61, z);
        world.set(31, 60, 2, 'oak_trapdoor', { facing: 'south', half: 'top', open: true });
        for (let y = 59; y >= 42; y--) at(31, y, 2, false);
        for (const [x, y, z] of [[31, 41, 2], [31, 41, 3], [31, 41, 4], [32, 41, 5], [33, 41, 5], [34, 41, 5]]) at(x, y, z);
        s.ctx.routes = R.bindRoutes(s.bot, s.ctx, new R.RouteStore(null, {}), trail);
        assert.ok(trail.list().filter((st) => st.at === 'ladder').every((st) => st.sky === true), 'by the rule of I1 the ladder steps are under open sky');
        const r = await M.rememberMine(s.bot, s.ctx, 'mine');
        assert.equal(r.ok, true, r.text);
        const m = s.ctx.mines.byName('mine', 'overworld');
        assert.ok(m.entrance.y >= 60, `the entrance ${JSON.stringify(m.entrance)}: ${r.text}`);
        assert.equal(m.route.filter((l) => l.kind === 'ladder').length, 1, `${JSON.stringify(m.route)}: ${r.text}`);
    });
});
