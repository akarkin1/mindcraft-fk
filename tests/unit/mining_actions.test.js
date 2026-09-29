// Spec v0.1.4.7 M4: the executing modules of the mining pack (mining.js, ladder.js, dig.js) on a
// fake bot with a small physics (mining_fake_bot.test.js): the shaft with ladders, lava, water and
// caves, the moved shaft, the staircase, the room, the tunnel, storing, climbing, the whole trip.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeMiningBot, makeClock, makeCtx, give, count, v } from './mining_fake_bot.test.js';

const M = await loadSrc('src/agent/packs/mining/mining.js');
const D = await loadSrc('src/agent/packs/mining/dig.js');
const Ld = await loadSrc('src/agent/packs/mining/ladder.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

function kit(bot, { ladders = 64, torches = 16, cobble = 64, pickaxe = 'iron_pickaxe', chests = 2, food = 8 } = {}) {
    if (pickaxe) give(bot, pickaxe, 1);
    if (ladders) give(bot, 'ladder', ladders);
    if (cobble) give(bot, 'cobblestone', cobble);
    if (torches) give(bot, 'torch', torches);
    if (food) give(bot, 'bread', food);
    if (chests) give(bot, 'chest', chests);
}

async function scene({ pos = [0.5, 64, 0.5], world = makeWorld(), gear = {} } = {}) {
    const bot = makeMiningBot({ world, pos });
    const clock = makeClock(bot);
    const ctx = await makeCtx(clock);
    kit(bot, gear);
    return { world, bot, clock, ctx, opts: { now: clock.now, wait: clock.wait } };
}

const feet = bot => ({ x: Math.floor(bot.entity.position.x), y: Math.floor(bot.entity.position.y + 0.01), z: Math.floor(bot.entity.position.z) });

describe('descendToLevel: a new mine', () => {
    test('a shaft of 1 by 1 with ladders on one wall, a torch at the top, the mine saved and remembered', async () => {
        const { world, bot, ctx, opts } = await scene();
        const r = await M.descendToLevel(bot, ctx, 50, { ...opts, ore: 'iron' });
        assert.equal(r.ok, true, r.text);
        assert.equal(r.text, 'I went down to level 50 in the mine at (0, 64, 0): I dug 14 blocks, placed 14 ladders and closed 0 holes.');
        assert.deepEqual(feet(bot), { x: 0, y: 50, z: 0 });
        for (let y = 50; y <= 63; y++) {
            assert.equal(world.nameAt(0, y, 0), 'ladder', `ladder at ${y}`);
            assert.equal(world.propsAt(0, y, 0).facing, 'north');
        }
        assert.equal(world.nameAt(1, 64, 0), 'torch', 'the torch at the top');
        const mine = ctx.mines.get('iron');
        assert.deepEqual(mine.entrance, { x: 0, y: 64, z: 0 });
        assert.equal(mine.level, 50);
        assert.equal(mine.direction, 'north');
        assert.deepEqual(mine.route, [{ kind: 'ladder', x: 0, z: 0, top: 63, bottom: 50, face: 'north', entry: { x: 0, y: 64, z: 1 } }]);
        assert.deepEqual(ctx.places.recall('mine'), { x: 0, y: 64, z: 0, dimension: 'overworld' });
        assert.equal(r.ladders, 14);
        assert.equal(r.dug, 14);
        assert.equal(r.torches, 1);
    });

    test('lava and water beside the shaft and a cave under it are closed; the bot is unhurt', async () => {
        const world = makeWorld();
        world.set(1, 55, 0, 'lava').set(0, 57, -1, 'water').fill(-1, 44, -1, 1, 46, 1, 'cave_air');
        const { bot, ctx, opts } = await scene({ world });
        const r = await M.descendToLevel(bot, ctx, 40, { ...opts, ore: 'coal' });
        assert.equal(r.ok, true, r.text);
        assert.equal(world.nameAt(1, 55, 0), 'cobblestone');
        assert.equal(world.nameAt(0, 57, -1), 'cobblestone');
        assert.ok(r.patches >= 3, `patches ${r.patches}`);
        assert.match(r.text, /closed \d+ holes\.$/);
        assert.equal(bot.health, 20);
        for (let y = 40; y <= 63; y++) {
            assert.equal(world.nameAt(0, y, 0), 'ladder', `ladder at ${y}`);
        }
    });

    test('lava under the shaft: never dug, the shaft moves 3 blocks to the side', async () => {
        const world = makeWorld();
        world.set(0, 55, 0, 'lava');
        const { bot, ctx, opts } = await scene({ world });
        const r = await M.descendToLevel(bot, ctx, 50, { ...opts, ore: 'coal' });
        assert.equal(r.ok, true, r.text);
        assert.equal(world.nameAt(0, 55, 0), 'lava');
        const route = r.mine.route.map(l => l.kind);
        assert.deepEqual(route, ['ladder', 'walk', 'ladder']);
        assert.equal(r.mine.route[2].face, 'east');
        assert.deepEqual(feet(bot), { x: 3, y: 50, z: 0 });
        assert.equal(world.propsAt(3, 50, 0).facing, 'east');
        assert.ok(ctx.logs.some(l => /I move it 3 blocks east/.test(l)));
    });

    test('with 5 ladders the rest of the way is a staircase of 4 high steps', async () => {
        const { world, bot, ctx, opts } = await scene({ gear: { ladders: 5 } });
        const r = await M.descendToLevel(bot, ctx, 52, { ...opts, ore: 'coal' });
        assert.equal(r.ok, true, r.text);
        assert.equal(r.mine.shaft, 'stairs');
        assert.equal(r.ladders, 5);
        assert.equal(r.stairs, 7);
        assert.match(r.text, /made 7 steps of a staircase/);
        const last = r.mine.route[r.mine.route.length - 1];
        assert.equal(last.kind, 'stairs');
        assert.deepEqual(last.to, feet(bot));
        const step = last.to;
        for (let up = 0; up <= 3; up++) {
            assert.equal(world.nameAt(step.x, step.y + up, step.z), 'air', `open ${up} over the last step`);
        }
    });

    test('a block that is not loaded under the shaft: nothing is dug there', async () => {
        const world = makeWorld();
        world.unloaded = (x, y) => y === 57;
        const { bot, ctx, opts } = await scene({ world });
        const r = await M.descendToLevel(bot, ctx, 40, { ...opts, ore: 'coal' });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'unknown');
        assert.match(r.text, /^I cannot see the blocks under me\. I am at \(0, 59, 0\)/);
        assert.equal(world.nameAt(0, 58, 0), 'stone', 'the block over the unknown one stays');
    });

    test('stopped: the descent ends at once', async () => {
        const { bot, clock, ctx, opts } = await scene();
        clock.onTick = (t) => { if (t > clock.startedAt + 3000) bot.interrupt_code = true; };
        clock.startedAt = clock.now();
        const r = await M.descendToLevel(bot, ctx, 20, { ...opts, ore: 'coal' });
        assert.equal(r.reason, 'interrupted');
        assert.match(r.text, /^I stopped going down\./);
    });

    test('no place for an entrance near protected areas', async () => {
        const { bot, ctx, opts } = await scene();
        ctx.areas = [{ name: 'town', type: 'building', min: { x: -60, y: 0, z: -60 }, max: { x: 60, y: 100, z: 60 } }];
        const r = await M.descendToLevel(bot, ctx, 50, { ...opts, ore: 'coal' });
        assert.equal(r.reason, 'no_entrance');
        assert.equal(r.text, 'I found no place for a mine within 48 blocks that is at least 16 blocks from your house and the areas I protect.');
    });

    test('a house 5 blocks away: the entrance keeps 16 blocks from it (v0.1.4.8, E4)', async () => {
        const { bot, ctx, opts } = await scene();
        ctx.areas = [{ name: 'home', type: 'building', min: { x: 5, y: 63, z: -3 }, max: { x: 11, y: 68, z: 3 } }];
        const r = await M.descendToLevel(bot, ctx, 56, { ...opts, ore: 'coal' });
        assert.equal(r.ok, true, r.text);
        const e = r.mine.entrance;
        const gap = (v, lo, hi) => (v < lo ? lo - v : v > hi ? v - hi : 0);
        assert.ok(Math.hypot(gap(e.x + 0.5, 5, 12), gap(e.z + 0.5, -3, 4)) >= 16, JSON.stringify(e));
    });
});

async function mineWithBase(world = makeWorld(), gear = {}) {
    const s = await scene({ world, gear });
    const d = await M.descendToLevel(s.bot, s.ctx, 56, { ...s.opts, ore: 'coal' });
    assert.equal(d.ok, true, d.text);
    const b = await M.setupMineBase(s.bot, s.ctx, { ...s.opts, mine: d.mine });
    assert.equal(b.ok, true, b.text);
    return { ...s, mine: b.mine, base: b };
}

describe('setupMineBase', () => {
    test('a room of 3 by 3 and 3 high in front of the shaft, a chest beside the shaft, a torch', async () => {
        const { world, mine, base } = await mineWithBase();
        assert.deepEqual(mine.base, { x: 0, y: 56, z: 0 });
        assert.deepEqual(mine.chest, { x: -1, y: 56, z: 0 });
        assert.equal(world.nameAt(-1, 56, 0), 'chest');
        assert.equal(world.nameAt(1, 56, 0), 'torch');
        for (let y = 56; y <= 58; y++) {
            for (let x = -1; x <= 1; x++) {
                for (let z = -2; z <= 0; z++) {
                    if (x === 0 && z === 0) continue;
                    if (y === 56 && (x === -1 || x === 1) && z === 0) continue;
                    assert.equal(world.nameAt(x, y, z), 'air', `${x},${y},${z}`);
                }
            }
        }
        assert.deepEqual(mine.end, { x: 0, y: 56, z: -2 });
        assert.equal(mine.length, 0);
        assert.match(base.text, /^I set up the base of the mine at \(0, 56, 0\): a room of 3 by 3 with a chest and a torch\. I dug 24 blocks and closed 0 holes\.$/);
    });

    test('lava beside the room is closed before a block is dug; not at the level: no base', async () => {
        const world = makeWorld();
        world.set(2, 57, -1, 'lava');
        const { mine, base } = await mineWithBase(world);
        assert.equal(world.nameAt(2, 57, -1), 'cobblestone');
        assert.equal(base.patches, 1);
        const s = await scene();
        const r = await M.setupMineBase(s.bot, s.ctx, { ...s.opts, mine });
        assert.equal(r.reason, 'not_at_level');
        const r2 = await M.setupMineBase(s.bot, s.ctx, s.opts);
        assert.equal(r2.reason, 'no_mine');
        assert.equal(r2.text, 'I know no mine here.');
    });
});

describe('digTunnel', () => {
    test('straight, 1 wide and 2 high, a torch every 8 steps, lava and a cave below closed, the whole vein taken', async () => {
        const world = makeWorld();
        // base (0,56,0) north: the tunnel runs along x = 0 from z = -3 on
        world.set(-1, 56, -4, 'lava'); // left of step 2
        world.fill(0, 58, -6, 0, 60, -6, 'gravel'); // over step 4
        world.fill(-1, 53, -8, 1, 55, -8, 'cave_air'); // under step 6
        world.set(1, 56, -9, 'iron_ore').set(2, 56, -9, 'iron_ore').set(1, 57, -10, 'iron_ore'); // a vein right of step 7
        const s = await mineWithBase(world);
        const r = await M.digTunnel(s.bot, s.ctx, 10, { ...s.opts, mine: s.mine });
        assert.equal(r.ok, true, r.text);
        assert.equal(r.steps, 10);
        assert.equal(r.mine.length, 10);
        assert.deepEqual(r.mine.end, { x: 0, y: 56, z: -12 });
        assert.deepEqual(r.collected, { raw_iron: 3 });
        assert.equal(count(s.bot, 'raw_iron'), 3);
        for (let z = -3; z >= -12; z--) {
            assert.ok(['air', 'torch'].includes(world.nameAt(0, 56, z)), `floor cell ${z}: ${world.nameAt(0, 56, z)}`);
            assert.equal(world.nameAt(0, 57, z), 'air', `upper cell ${z}`);
        }
        assert.equal(world.nameAt(0, 56, -10), 'torch', 'the torch of step 8');
        assert.equal(world.nameAt(-1, 56, -4), 'cobblestone', 'the lava is closed');
        assert.equal(world.nameAt(0, 55, -8), 'cobblestone', 'the floor over the cave is closed');
        assert.equal(r.torches, 1);
        assert.match(r.text, /^I dug 10 steps of the tunnel, it is 10 blocks long now\. I collected 3 raw_iron, placed 1 torches and closed \d+ holes\.$/);
        const saved = s.ctx.mines.get('coal');
        assert.equal(saved.length, 10, 'the mine is saved');
    });

    test('ore under the floor of the tunnel: left when a cave is under it and the bot stands on it', async () => {
        const world = makeWorld();
        world.set(0, 55, -4, 'coal_ore').set(0, 54, -4, 'cave_air'); // under the cell of step 2, a cave under it
        const s = await mineWithBase(world);
        const r = await M.digTunnel(s.bot, s.ctx, 2, { ...s.opts, mine: s.mine });
        assert.equal(r.ok, true, r.text);
        assert.equal(world.nameAt(0, 55, -4), 'coal_ore', 'the bot does not dig away its floor over a cave');
        assert.equal(s.bot.entity.position.y, 56, 'the bot did not fall');
    });

    test('ore under the floor with rock under it is taken', async () => {
        const world = makeWorld();
        world.set(0, 55, -3, 'coal_ore');
        const s = await mineWithBase(world);
        const r = await M.digTunnel(s.bot, s.ctx, 2, { ...s.opts, mine: s.mine });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(r.collected, { coal: 1 });
        assert.deepEqual(feet(s.bot), { x: 0, y: 56, z: -4 }, 'out of the hole and on');
    });

    test('a cave ahead: the tunnel keeps its wall and goes on 3 blocks to the side', async () => {
        const world = makeWorld();
        world.fill(-1, 56, -6, 1, 58, -8, 'cave_air');
        const s = await mineWithBase(world);
        const r = await M.digTunnel(s.bot, s.ctx, 6, { ...s.opts, mine: s.mine });
        assert.equal(r.ok, true, r.text);
        assert.equal(world.nameAt(0, 56, -5), 'stone', 'the wall of the cave stays');
        assert.ok(r.mine.tunnel.length >= 3, JSON.stringify(r.mine.tunnel));
        assert.equal(r.mine.end.x, 3);
        const s2 = s.ctx.mines.get('coal');
        assert.equal(s2.end.x, 3);
        // the next call goes on from the end
        const r2 = await M.digTunnel(s.bot, s.ctx, 2, { ...s.opts, mine: s2 });
        assert.equal(r2.ok, true, r2.text);
        assert.equal(r2.mine.length, s2.length + 2);
    });

    test('stop reasons: no mine, no base, no pickaxe, shouldStop, protected area', async () => {
        const s = await mineWithBase();
        assert.equal((await M.digTunnel(s.bot, {}, 2, s.opts)).reason, 'no_mine');
        assert.equal((await M.digTunnel(s.bot, s.ctx, 2, { ...s.opts, mine: { ...s.mine, base: null } })).reason, 'no_base');
        const stop = await M.digTunnel(s.bot, s.ctx, 5, { ...s.opts, mine: s.mine, shouldStop: () => 'done' });
        assert.equal(stop.ok, true);
        assert.equal(stop.steps, 0);
        s.ctx.areas = [{ name: 'farm', type: 'farm', min: { x: -3, y: 50, z: -20 }, max: { x: 3, y: 60, z: -8 } }];
        const area = await M.digTunnel(s.bot, s.ctx, 10, { ...s.opts, mine: s.mine });
        assert.equal(area.reason, 'area');
        assert.match(area.text, /I stopped because my way would lead into a protected area\.$/);
        s.bot.inventory.list = s.bot.inventory.list.filter(i => !i.name.endsWith('_pickaxe'));
        s.bot.heldItem = null;
        const nopick = await M.digTunnel(s.bot, { ...s.ctx, areas: [] }, 2, { ...s.opts, mine: s.mine });
        assert.equal(nopick.reason, 'no_pickaxe');
    });
});

describe('depositAtBase', () => {
    test('stores at the chest of the mine with the keep plan; a full chest gets a second one beside it', async () => {
        const s = await mineWithBase();
        const calls = [];
        let full = true;
        s.ctx.storage = {
            async storeItems(bot, ctx, options) {
                calls.push(options);
                if (full) {
                    full = false;
                    return { ok: false, reason: 'full', stored: { cobblestone: 20 }, left: { dirt: 5 }, text: 'All chests nearby are full.' };
                }
                return { ok: true, reason: null, stored: { dirt: 5 }, left: {}, text: 'I stored 5 dirt in the chest at (-1, 56, -1).' };
            },
        };
        const r = await M.depositAtBase(s.bot, s.ctx, { ...s.opts, mine: s.mine, keep: { raw_iron: -1 } });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(calls[0], { chest: { x: -1, y: 56, z: 0 }, keep: { cobblestone: 32, chest: 1, raw_iron: -1 } });
        assert.deepEqual(calls[1].chest, { x: -1, y: 56, z: -1 });
        assert.equal(s.world.nameAt(-1, 56, -1), 'chest');
        assert.deepEqual(r.stored, { cobblestone: 20, dirt: 5 });
        assert.equal(r.text, 'At the base of the mine: I stored 5 dirt in the chest at (-1, 56, -1).');
    });

    test('without the storage skills or without a mine', async () => {
        const s = await mineWithBase();
        const r = await M.depositAtBase(s.bot, s.ctx, { ...s.opts, mine: s.mine });
        assert.equal(r.reason, 'no_storage');
        assert.equal(r.text, 'I cannot store things: I have no storage skills.');
        const r2 = await M.depositAtBase(s.bot, { ...s.ctx, mines: null }, s.opts);
        assert.equal(r2.reason, 'no_mine');
    });
});

describe('climbToSurface and the way down again', () => {
    test('from the end of the tunnel up the ladders, and down again by sliding', async () => {
        const s = await mineWithBase();
        await M.digTunnel(s.bot, s.ctx, 3, { ...s.opts, mine: s.mine });
        const mine = s.ctx.mines.get('coal');
        const up = await M.climbToSurface(s.bot, s.ctx, { ...s.opts, mine });
        assert.equal(up.ok, true, up.text);
        assert.ok(s.bot.entity.position.y >= 64, `y ${s.bot.entity.position.y}`);
        assert.match(up.text, /^I am on the surface at \(0, 64, 1\)\.$/);
        const again = await M.climbToSurface(s.bot, s.ctx, { ...s.opts, mine });
        assert.equal(again.text, 'I am on the surface already.');
        const down = await M.descendToLevel(s.bot, s.ctx, 56, { ...s.opts, ore: 'coal' });
        assert.equal(down.ok, true, down.text);
        assert.equal(down.text, 'I went down to level 56 in the mine at (0, 64, 0).');
        assert.deepEqual(feet(s.bot), { x: 0, y: 56, z: 0 });
        const left = await M.leaveMine(s.bot, s.ctx, s.opts);
        assert.equal(left.ok, true, left.text);
    });

    test('up and down a moved shaft and a staircase', async () => {
        const world = makeWorld();
        world.set(0, 55, 0, 'lava');
        const s = await scene({ world, gear: { ladders: 8 } });
        const d = await M.descendToLevel(s.bot, s.ctx, 50, { ...s.opts, ore: 'coal' });
        assert.equal(d.ok, true, d.text);
        assert.deepEqual(d.mine.route.map(l => l.kind), ['ladder', 'walk', 'ladder', 'stairs']);
        const up = await M.climbToSurface(s.bot, s.ctx, { ...s.opts, mine: d.mine });
        assert.equal(up.ok, true, up.text);
        const down = await M.descendToLevel(s.bot, s.ctx, 50, { ...s.opts, mine: d.mine });
        assert.equal(down.ok, true, down.text);
        assert.deepEqual(feet(s.bot), d.mine.route[3].to);
    });

    test('no mine known', async () => {
        const s = await scene();
        const r = await M.climbToSurface(s.bot, s.ctx, s.opts);
        assert.equal(r.reason, 'no_mine');
        assert.equal(r.text, 'I know no mine here.');
    });
});

describe('mineOre, the whole trip', () => {
    test('coal: down, base, tunnel, the ore, stored, up with the ore', async () => {
        const world = makeWorld();
        world.set(1, 56, -5, 'coal_ore').set(1, 57, -5, 'coal_ore').set(-1, 56, -8, 'coal_ore');
        const s = await scene({ world });
        const stored = [];
        s.ctx.storage = {
            async storeItems(bot, ctx, options) {
                stored.push(options);
                return { ok: true, reason: null, stored: { cobblestone: 40 }, left: {}, text: 'I stored 40 cobblestone in the chest at (-1, 56, 0).' };
            },
        };
        const r = await M.mineOre(s.bot, s.ctx, 'coal', 3, { ...s.opts, newMine: true });
        assert.equal(r.ok, true, r.text);
        assert.equal(r.mined, 3);
        assert.match(r.text, /^I mined 3 coal\. The mine is at \(0, 64, 0\), its tunnel is \d+ blocks long at level 56\. I also stored 40 cobblestone in the chest of the mine\.$/);
        assert.ok(count(s.bot, 'coal') >= 3);
        assert.ok(s.bot.entity.position.y >= 64, 'on the surface');
        assert.deepEqual(stored[0].keep, { cobblestone: 32, chest: 1, coal: -1 });
        assert.ok(s.ctx.logs.some(l => /^I am ready for the trip to level 56\./.test(l)));
    });

    test('unknown ore, no pickaxe, a pickaxe too weak', async () => {
        const s = await scene({ gear: { pickaxe: null } });
        const yes = { ...s.opts, newMine: true };
        assert.equal((await M.mineOre(s.bot, s.ctx, 'mithril', 2, s.opts)).text,
            'I do not know the ore "mithril". I know coal, copper, iron, lapis, gold, redstone and diamond.');
        assert.equal((await M.mineOre(s.bot, s.ctx, 'coal', 2, yes)).text, 'I cannot mine coal. I need a stone pickaxe and have no pickaxe.');
        give(s.bot, 'stone_pickaxe', 1);
        assert.equal((await M.mineOre(s.bot, s.ctx, 'diamond', 2, yes)).text, 'I cannot mine diamond. I need an iron pickaxe and have a stone_pickaxe.');
    });

    test('the tools pack crafts the pickaxe; the time of a trip ends it on the surface', async () => {
        const s = await scene({ gear: { pickaxe: null } });
        const asked = [];
        s.ctx.tools = {
            async ensureTool(bot, ctx, kind, material, options) {
                asked.push([kind, material, options]);
                give(bot, `${material}_pickaxe`, 1);
                return { ok: true, text: 'I crafted a stone_pickaxe.' };
            },
            async craftSupplies() {
                return { ok: false, text: 'no' };
            },
        };
        s.ctx.settings = { mining_max_minutes: 0.5 };
        const r = await M.mineOre(s.bot, s.ctx, 'coal', 50, { ...s.opts, newMine: true });
        assert.deepEqual(asked[0].slice(0, 2), ['pickaxe', 'stone']);
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'time');
        assert.match(r.text, /^I mined 0 coal of 50\. I stopped because the time for one trip is over\. The mine is at \(0, 64, 0\)/);
        assert.ok(s.bot.entity.position.y >= 64, 'on the surface');
    });

    test('stopped in the tunnel: it stays and says so', async () => {
        const s = await scene();
        s.clock.onTick = () => {
            if (s.bot.calls.filter(c => c[0] === 'dig').length >= 45) s.bot.interrupt_code = true;
        };
        const r = await M.mineOre(s.bot, s.ctx, 'coal', 50, { ...s.opts, newMine: true });
        assert.equal(r.reason, 'interrupted');
        assert.match(r.text, /I stopped because you stopped me\./);
    });
});

describe('prepareMiningTrip, goToMine, leaveMine', () => {
    test('missing ladders and torches: from chests, then crafted; what is still missing is said', async () => {
        const s = await scene({ gear: { ladders: 0, torches: 0, food: 0, chests: 0 } });
        const fetched = [];
        s.ctx.storage = {
            async fetchItem(bot, ctx, name, n) {
                fetched.push([name, n]);
                if (name === 'bread') {
                    give(bot, 'bread', 8);
                    return { ok: true, taken: 8 };
                }
                return { ok: false, taken: 0 };
            },
        };
        s.ctx.chests = { list: () => [{ items: { bread: 20, stone: 5 } }] };
        s.ctx.tools = {
            async craftSupplies(bot, ctx, item, n) {
                if (item === 'ladder') give(bot, 'ladder', 3);
                return { ok: item === 'ladder' };
            },
        };
        const r = await M.prepareMiningTrip(s.bot, s.ctx, 'iron', s.opts);
        assert.equal(r.ok, true);
        assert.equal(r.level, 16);
        assert.deepEqual(fetched.map(f => f[0]), ['ladder', 'torch', 'chest', 'bread']);
        assert.equal(r.text, 'I am ready for the trip to level 16. I have 3 ladders for 48 blocks, the rest of the way down is a staircase. I go without torches. I have no chest for the base.');
    });

    test('without storage and tools: it goes with what it carries', async () => {
        const s = await scene({ gear: { torches: 3 } });
        const r = await M.prepareMiningTrip(s.bot, s.ctx, 'coal', s.opts);
        assert.equal(r.text, 'I am ready for the trip to level 56. I know no chests and cannot craft, so I go with what I carry. I have only 3 torches.');
        assert.equal((await M.prepareMiningTrip(s.bot, s.ctx, 'x', s.opts)).reason, 'unknown_ore');
    });

    test('goToMine and leaveMine', async () => {
        const s = await scene();
        assert.equal((await M.goToMine(s.bot, s.ctx, 'mithril', s.opts)).reason, 'unknown_ore');
        assert.equal((await M.goToMine(s.bot, s.ctx, 'coal', s.opts)).text, 'I know no mine for coal. Tell me to mine coal and I make one.');
        assert.equal((await M.goToMine(s.bot, s.ctx, '', s.opts)).text, 'I know no mine here.');
        const d = await M.descendToLevel(s.bot, s.ctx, 56, { ...s.opts, ore: 'coal' });
        assert.equal(d.ok, true);
        await M.climbToSurface(s.bot, s.ctx, { ...s.opts, mine: d.mine });
        const g = await M.goToMine(s.bot, s.ctx, '', s.opts);
        assert.equal(g.ok, true, g.text);
        assert.match(g.text, /^I went down to level 56 in the mine at \(0, 64, 0\)\. I set up the base of the mine at/);
        const g2 = await M.goToMine(s.bot, s.ctx, 'coal_ore', s.opts);
        assert.equal(g2.ok, true, g2.text);
        const l = await M.leaveMine(s.bot, s.ctx, s.opts);
        assert.equal(l.ok, true, l.text);
        assert.ok(M.currentMine(s.bot, s.ctx));
        assert.equal(M.currentMine(s.bot, {}), null);
    });

    test('extendTunnel keeps the corners of the tunnel', () => {
        let c = M.extendTunnel([], { x: 0, y: 5, z: -2 });
        c = M.extendTunnel(c, { x: 0, y: 5, z: -3 });
        c = M.extendTunnel(c, { x: 0, y: 5, z: -4 });
        c = M.extendTunnel(c, { x: 3, y: 5, z: -4 });
        c = M.extendTunnel(c, { x: 3, y: 5, z: -5 });
        c = M.extendTunnel(c, { x: 3, y: 5, z: -5 });
        assert.deepEqual(c, [{ x: 0, y: 5, z: -2 }, { x: 0, y: 5, z: -4 }, { x: 3, y: 5, z: -4 }, { x: 3, y: 5, z: -5 }]);
    });
});

describe('dig.js and ladder.js', () => {
    test('logicName: not loaded, water, waterlogged, blocks without a box, ladders', () => {
        assert.equal(D.logicName(null), null);
        assert.equal(D.logicName({ name: 'water', boundingBox: 'empty' }), 'water');
        assert.equal(D.logicName({ name: 'kelp', boundingBox: 'empty' }), 'water');
        assert.equal(D.logicName({ name: 'oak_stairs', boundingBox: 'block', getProperties: () => ({ waterlogged: true }) }), 'water');
        assert.equal(D.logicName({ name: 'short_grass', boundingBox: 'empty' }), 'air');
        assert.equal(D.logicName({ name: 'cave_air', boundingBox: 'empty' }), 'cave_air');
        assert.equal(D.logicName({ name: 'ladder', boundingBox: 'block' }), 'ladder');
        assert.equal(D.logicName({ name: 'lava', boundingBox: 'empty' }), 'lava');
        assert.equal(D.isFree({ name: 'torch', boundingBox: 'empty' }), true);
        assert.equal(D.isSolid({ name: 'ladder', boundingBox: 'block' }), false);
    });

    test('digBlock: liquids, bedrock and protected blocks are not dug; digClear digs falling gravel again', async () => {
        const world = makeWorld();
        world.set(3, 63, 0, 'lava').set(4, 63, 0, 'bedrock').fill(5, 60, 0, 5, 62, 0, 'gravel').set(5, 59, 0, 'stone');
        const { bot, clock } = await scene({ world });
        assert.equal((await D.digBlock(bot, { x: 3, y: 63, z: 0 }, { clock })).reason, 'liquid');
        assert.equal((await D.digBlock(bot, { x: 4, y: 63, z: 0 }, { clock })).reason, 'unbreakable');
        assert.equal((await D.digBlock(bot, { x: 0, y: 70, z: 0 }, { clock })).dug, 0, 'air counts as dug');
        bot.areaGuard = { canBreak: () => false, canPlace: () => false };
        assert.equal((await D.digBlock(bot, { x: 1, y: 63, z: 0 }, { clock })).reason, 'protected');
        assert.equal((await D.placeInto(bot, { x: 1, y: 64, z: 0 }, 'cobblestone', { clock })).reason, 'protected');
        delete bot.areaGuard;
        world.unloaded = (x, y) => y === 80;
        assert.equal((await D.digBlock(bot, { x: 0, y: 80, z: 0 }, { clock })).reason, 'unknown');
        const r = await D.digClear(bot, { x: 5, y: 59, z: 0 }, { clock });
        assert.equal(r.ok, true);
        assert.equal(r.dug, 4, 'the stone and three gravel');
        assert.equal(world.nameAt(5, 59, 0), 'air');
        bot.digError = 'boom';
        world.set(6, 59, 0, 'stone');
        assert.equal((await D.digBlock(bot, { x: 6, y: 59, z: 0 }, { clock })).reason, 'failed');
    });

    test('placeInto and patchAll: against a hidden face, no block, no reference, the space of the bot', async () => {
        const world = makeWorld();
        world.fill(-1, 64, -1, 1, 70, 1, 'air').set(2, 63, 0, 'lava');
        const { bot, clock } = await scene({ world, gear: { cobble: 0 } });
        assert.equal((await D.patchAll(bot, [{ x: 2, y: 63, z: 0 }], { clock })).reason, 'no_block');
        give(bot, 'cobblestone', 5);
        const r = await D.patchAll(bot, [{ x: 2, y: 63, z: 0 }, { x: 1, y: 63, z: 0 }], { clock });
        assert.equal(r.ok, true);
        assert.equal(r.placed, 1, 'the grass was solid already');
        assert.equal(world.nameAt(2, 63, 0), 'cobblestone');
        assert.equal((await D.placeInto(bot, { x: 0, y: 64, z: 0 }, 'cobblestone', { clock })).reason, 'in_the_way');
        assert.equal((await D.placeInto(bot, { x: 0, y: 75, z: 0 }, 'cobblestone', { clock })).reason, 'no_reference');
        assert.equal((await D.placeInto(bot, { x: 1, y: 64, z: 0 }, 'dirt', { clock })).reason, 'no_item');
        assert.equal(D.fillerOf(bot), 'cobblestone');
        assert.equal(D.fillerCount(bot), 4);
    });

    test('collectDrops walks to what dropped; placeTorch; equipPickaxe takes the best', async () => {
        const { bot, clock } = await scene();
        bot.entities[500] = { id: 500, name: 'item', item: 'raw_iron', count: 2, position: v(3.5, 64, 2.5) };
        const r = await D.collectDrops(bot, { x: 0, y: 64, z: 0 }, { clock, radius: 6 });
        assert.equal(r.ok, true);
        assert.equal(count(bot, 'raw_iron'), 2);
        const t = await D.placeTorch(bot, { x: 5, y: 64, z: 5 }, { clock });
        assert.equal(t.ok, true);
        assert.equal((await D.placeTorch(bot, { x: 5, y: 64, z: 5 }, { clock })).reason, 'no_place');
        give(bot, 'stone_pickaxe', 1);
        give(bot, 'diamond_pickaxe', 1, { used: 1500 });
        const best = await D.equipPickaxe(bot, 'stone');
        assert.equal(best.name, 'diamond_pickaxe');
        assert.equal(D.usesLeftOf(best), 61);
        assert.equal(D.usesLeftOf({ name: 'iron_pickaxe' }), 250);
        assert.equal(D.usesLeftOf({ name: 'stick' }), null);
        assert.equal(D.freeSlots(bot), 36 - bot.inventory.items().length);
        assert.equal(await D.equipPickaxe({ inventory: { items: () => [] } }), null);
    });

    test('placeLadder: no wall, no ladder, placed before, and a bot too near the wall moves first', async () => {
        const world = makeWorld();
        world.fill(0, 60, 0, 0, 63, 0, 'air');
        const { bot, clock } = await scene({ world, pos: [0.5, 60, 0.5], gear: { ladders: 0 } });
        assert.equal((await Ld.placeLadder(bot, { x: 0, y: 60, z: 0 }, 'north', { clock })).reason, 'no_item');
        give(bot, 'ladder', 4);
        world.set(0, 61, 1, 'air');
        assert.equal((await Ld.placeLadder(bot, { x: 0, y: 61, z: 0 }, 'north', { clock })).reason, 'no_wall');
        bot.entity.position = v(0.5, 60, 0.7);
        const r = await Ld.placeLadder(bot, { x: 0, y: 60, z: 0 }, 'north', { clock });
        assert.equal(r.ok, true, r.reason);
        assert.ok(bot.entity.position.z < 0.5, `moved from the wall: ${bot.entity.position.z}`);
        assert.equal((await Ld.placeLadder(bot, { x: 0, y: 60, z: 0 }, 'north', { clock })).reason, 'placed_before');
        assert.ok(Ld.yawOf('north') === 0);
        assert.ok(Math.abs(Math.abs(Ld.yawOf('south')) - Math.PI) < 1e-9);
        assert.deepEqual(Ld.stairCells({ from: { x: 0, y: 5, z: 0 }, to: { x: 0, y: 3, z: -2 }, dir: 'north' }),
            [{ x: 0, y: 5, z: 0 }, { x: 0, y: 4, z: -1 }, { x: 0, y: 3, z: -2 }]);
    });

    test('race ends on an interrupt and on the time limit', async () => {
        const { bot, clock } = await scene();
        const never = new Promise(() => {});
        assert.equal((await D.race(bot, never, 200, clock)).timeout, true);
        bot.interrupt_code = true;
        assert.equal((await D.race(bot, never, 200, clock)).interrupted, true);
        assert.equal((await D.race(bot, Promise.reject(new Error('x')), 200, clock)).ok, false);
    });
});
