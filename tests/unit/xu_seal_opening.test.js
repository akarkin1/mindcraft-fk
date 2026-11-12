// Spec v0.1.4.16 (part A, engineer E1), F10 `!sealOpening(x, y, z)` of the mining pack (src/agent/packs/mining/mining.js): the
// bot walks within reach of the cell, finds the open cells of the opening's face connected to the cell within a 3 x 3 (at most
// 9) and places filler into each; the texts word for word: `I sealed the opening at (x, y, z) with N cobblestone.`, `I have
// no stone to seal it.`, `I cannot reach (x, y, z).`. On the fake bot of the mining pack. Also the beyond cells of digTunnel
// (mine_logic's tunnelStep patches them now): a cave one block behind the end of the tunnel gets a wall of cobblestone.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeMiningBot, makeClock, makeCtx, give, count } from './mining_fake_bot.test.js';

const M = await loadSrc('src/agent/packs/mining/mining.js');
const P = await loadSrc('src/agent/packs/mining/index.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

// A room in the stone at y 40 (x -2..2, z 0..3, 3 high) with a wall to the north at z -1 and a cave behind it (z -2..-6).
// `hole` opens the wall: a list of [x, y] of the wall cells at z -1 that are air.
async function scene({ hole = [], pos = [0.5, 40, 1.5], cobble = 64 } = {}) {
    const world = makeWorld();
    world.fill(-2, 40, 0, 2, 42, 3, 'cave_air');
    world.fill(-3, 40, -6, 3, 43, -2, 'cave_air'); // the cave
    for (const [x, y] of hole) world.set(x, y, -1, 'cave_air');
    const bot = makeMiningBot({ world, pos });
    const clock = makeClock(bot);
    const ctx = await makeCtx(clock);
    if (cobble) give(bot, 'cobblestone', cobble);
    return { world, bot, clock, ctx, opts: { now: clock.now, wait: clock.wait } };
}
const FULL = [[-1, 40], [0, 40], [1, 40], [-1, 41], [0, 41], [1, 41], [-1, 42], [0, 42], [1, 42]];

describe('F10: openingCells', () => {
    test('the 3 x 3 of the face around the cell, in the plane the bot looks through; connected open cells only', async () => {
        const { bot } = await scene({ hole: FULL });
        const cells = M.openingCells(bot, { x: 0, y: 41, z: -1 });
        assert.equal(cells.length, 9);
        assert.deepEqual(cells[0], { x: 0, y: 41, z: -1 }, 'the cell first');
        assert.ok(cells.every(c => c.z === -1), 'the plane of the wall');
        const corner = await scene({ hole: [[-1, 40], [0, 40], [1, 40], [1, 41], [1, 42]] }); // an L of 5 cells
        assert.equal(M.openingCells(corner.bot, { x: 0, y: 40, z: -1 }).length, 4, 'the 3 x 3 is centred on the cell: y 39 to 41, (1, 42) is outside it');
        assert.equal(M.openingCells(corner.bot, { x: 0, y: 41, z: -1 }).length, 0, 'a solid cell');
        assert.equal(M.openingCells(corner.bot, { x: 1, y: 41, z: -1 }).length, 4, 'from the middle of the L: (-1, 40) is outside its 3 x 3');
        const apart = await scene({ hole: [[0, 41], [-1, 40], [1, 42]] }); // the corners touch the cell only by their edges: not connected
        assert.equal(M.openingCells(apart.bot, { x: 0, y: 41, z: -1 }).length, 1);
        assert.deepEqual(M.openingCells(apart.bot, { x: 0, y: 41, z: 5 }), [], 'a solid cell: no opening');
    });

    test('a hole in the floor lies flat, also one step away from the feet', async () => {
        const { bot, world } = await scene({ pos: [0.5, 40, 2.5] });
        world.fill(-1, 39, 1, 1, 39, 3, 'cave_air'); // 3 x 3 of the floor open, under the bot
        world.fill(-1, 36, 1, 1, 38, 3, 'cave_air'); // the cave below
        const cells = M.openingCells(bot, { x: 0, y: 39, z: 2 });
        assert.equal(cells.length, 9);
        assert.ok(cells.every(c => c.y === 39), JSON.stringify(cells));
        bot.entity.position.set(0.5, 40, 0.5); // the feet one block south of the hole's edge, one block higher
        const aside = M.openingCells(bot, { x: 0, y: 39, z: 1 });
        assert.equal(aside.length, 6, 'the 3 x 3 around (0, 39, 1): its row at z 0 is the solid floor');
        assert.ok(aside.every(c => c.y === 39), 'a cell one step away and one below is a cell of the floor');
    });
});

describe('F10: sealOpening', () => {
    test('a 3 x 3 opening into the cave: 9 cobblestone placed, the text', async () => {
        const { bot, ctx, opts, world } = await scene({ hole: FULL });
        const r = await M.sealOpening(bot, ctx, 0, 41, -1, opts);
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.equal(r.text, 'I sealed the opening at (0, 41, -1) with 9 cobblestone.');
        assert.equal(r.placed, 9);
        for (const [x, y] of FULL) assert.equal(world.nameAt(x, y, -1), 'cobblestone', `${x},${y}`);
        assert.equal(count(bot, 'cobblestone'), 55);
        assert.ok(ctx.logs.some(t => t.startsWith('Seal: 9 open cells of the opening at (0, 41, -1)')), ctx.logs.join('\n'));
        assert.equal(bot.calls.filter(c => c[0] === 'goto').length, 0, 'within reach already: no walk');
    });

    test('the filler of the bag names itself; a smaller opening counts its cells; nothing open: 0', async () => {
        const s = await scene({ hole: [[0, 40], [0, 41]], cobble: 0 });
        give(s.bot, 'cobbled_deepslate', 10);
        const r = await M.sealOpening(s.bot, s.ctx, 0, 41, -1, s.opts);
        assert.equal(r.text, 'I sealed the opening at (0, 41, -1) with 2 cobbled_deepslate.');
        assert.equal(s.world.nameAt(0, 40, -1), 'cobbled_deepslate');
        const closed = await M.sealOpening(s.bot, s.ctx, 0, 41, -1, s.opts);
        assert.equal(closed.text, 'I sealed the opening at (0, 41, -1) with 0 cobbled_deepslate.', 'nothing open any more');
    });

    test('no stone in the bag: the text, nothing placed, no walk', async () => {
        const { bot, ctx, opts, world } = await scene({ hole: FULL, cobble: 0 });
        const r = await M.sealOpening(bot, ctx, 0, 41, -1, opts);
        assert.deepEqual({ ok: r.ok, reason: r.reason, text: r.text }, { ok: false, reason: 'no_block', text: 'I have no stone to seal it.' });
        assert.equal(world.nameAt(0, 41, -1), 'cave_air');
        assert.equal(bot.calls.filter(c => c[0] === 'place').length, 0);
    });

    test('out of reach with no way there: the text with the position', async () => {
        const { bot, ctx, opts } = await scene({ hole: FULL, pos: [0.5, 64, 20.5] });
        bot.noPath = true;
        const r = await M.sealOpening(bot, ctx, 0, 41, -1, opts);
        assert.deepEqual({ ok: r.ok, reason: r.reason, text: r.text }, { ok: false, reason: 'no_path', text: 'I cannot reach (0, 41, -1).' });
        const bad = await M.sealOpening(bot, ctx, 'x', 41, -1, opts);
        assert.equal(bad.text, 'I cannot reach (x, 41, -1).');
    });

    test('the bot walks within 3 blocks of the cell first; an interrupt stops it', async () => {
        const { bot, ctx, opts, world } = await scene({ hole: FULL, pos: [0.5, 40, 3.5] });
        world.fill(-2, 40, 4, 2, 42, 8, 'cave_air'); // a longer room
        bot.entity.position.set(0.5, 40, 7.5);
        const r = await M.sealOpening(bot, ctx, 0, 41, -1, opts);
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.ok(bot.calls.some(c => c[0] === 'goto'), 'walked first');
        assert.ok(bot.entity.position.distanceTo({ x: 0.5, y: 41, z: -0.5 }) <= 3.6, 'within reach');
        const stopped = await scene({ hole: FULL });
        stopped.bot.interrupt_code = true;
        const s = await M.sealOpening(stopped.bot, stopped.ctx, 0, 41, -1, stopped.opts);
        assert.equal(s.ok, false);
        assert.ok(['interrupted', 'no_path'].includes(s.reason), s.reason);
    });

    test('the pack exports sealOpening, openingCells and SEAL_RULES', () => {
        assert.equal(typeof P.sealOpening, 'function');
        assert.equal(typeof P.openingCells, 'function');
        assert.deepEqual(P.SEAL_RULES, { side: 3, walkRange: 3 });
    });
});

describe('F10: the beyond cells of digTunnel', () => {
    // the mine of mining_actions: base (0, 56, 0), the tunnel north along x = 0 from z -3; a cave one block beyond the end
    async function mineWithBase(world) {
        const bot = makeMiningBot({ world, pos: [0.5, 56, 0.5] });
        const clock = makeClock(bot);
        const ctx = await makeCtx(clock);
        give(bot, 'iron_pickaxe', 1);
        give(bot, 'torch', 16);
        world.fill(-2, 56, -3, 2, 58, 2, 'cave_air'); // the room
        const mine = { name: 'coal', ore: 'coal', entrance: { x: 0, y: 64, z: 0 }, level: 56, direction: 'north', route: [], dimension: 'overworld',
            base: { x: 0, y: 56, z: 0 }, end: { x: 0, y: 56, z: -3 }, length: 0, tunnel: [{ x: 0, y: 56, z: -3 }] };
        ctx.mines.set(mine);
        return { bot, clock, ctx, mine: ctx.mines.get('coal'), opts: { now: clock.now, wait: clock.wait } };
    }

    test('with stone in the bag the cave beyond the wall is walled off with cobblestone, then the tunnel steps aside', async () => {
        const world = makeWorld();
        world.fill(-1, 56, -6, 1, 58, -8, 'cave_air'); // the cave: the wall of the tunnel is at z -5, the cave at z -6
        const s = await mineWithBase(world);
        give(s.bot, 'cobblestone', 32);
        const r = await M.digTunnel(s.bot, s.ctx, 6, { ...s.opts, mine: s.mine });
        assert.equal(r.ok, true, r.text);
        assert.equal(world.nameAt(0, 56, -5), 'stone', 'the wall of the cave stays');
        assert.equal(world.nameAt(0, 56, -6), 'cobblestone', 'the beyond cell is patched');
        assert.equal(world.nameAt(0, 57, -6), 'cobblestone');
        assert.ok(r.patches >= 2, `patches ${r.patches}`);
    });

    test('without stone the wall stays as it is and the log says so', async () => {
        const world = makeWorld();
        world.fill(-1, 56, -6, 1, 58, -8, 'cave_air');
        world.set(0, 56, -4, 'obsidian').set(0, 57, -4, 'obsidian'); // the step before the wall drops no filler (stone would drop cobblestone)
        const s = await mineWithBase(world);
        // without stone the side step beside the room cannot be patched either, so the tunnel ends blocked: the point here is
        // the wall and the log line
        const r = await M.digTunnel(s.bot, s.ctx, 6, { ...s.opts, mine: s.mine });
        assert.equal(world.nameAt(0, 56, -5), 'stone', `the wall stays (${r.reason}: ${r.text})`);
        assert.equal(world.nameAt(0, 56, -6), 'cave_air', 'nothing to patch with');
        assert.equal(world.nameAt(0, 57, -6), 'cave_air');
        assert.ok(s.ctx.logs.some(t => t.startsWith('I have no stone to close the opening at (0, 57, -6)')), s.ctx.logs.join('\n'));
    });
});
