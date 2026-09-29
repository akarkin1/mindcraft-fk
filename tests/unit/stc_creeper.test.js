// Spec v0.1.4.8, part C (C3): which creepers count. For the bot: |dy| <= 4 and (dBot <= 6 or in sight).
// For an area: a defended type (not mine), horizontally within 16 of the box, y between min.y - 3 and
// max.y + 3. Underground (ctx.whereAmI) with no creeper that counts for the bot: nothing happens.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeFakeBot, buildHouse, addMob } from './home_fake_bot.test.js';

const C = await loadSrc('src/agent/packs/home/creeper_logic.js');
const K = await loadSrc('src/agent/packs/home/creeper.js');

const p = (x, z, y = 64) => ({ x, y, z });
const box = (name, type, x1, y1, z1, x2, y2, z2) => ({ name, type, min: { x: x1, y: y1, z: z1 }, max: { x: x2, y: y2, z: z2 } });
const HOME = box('home', 'home', 0, 63, 0, 8, 69, 8);
// the saved mine of the play test: from the shaft at y 25 up to y 58, under the surface at y 64
const MINE = box('mining_area', 'mine', 20, 25, 20, 40, 58, 40);

function state(over = {}) {
    return { botPos: p(4.5, 12.5), creepers: [], areas: [HOME], fighting: false, canFight: false, tries: 0, fuseBurning: false, now: 1000, ...over };
}
const creeper = (pos, extra = {}) => ({ id: extra.id ?? 7, pos, fuse: false, ...extra });

describe('C3: countsForBot', () => {
    test('|dy| <= 4 and (dBot <= 6 or sight)', () => {
        assert.equal(C.countsForBot({ dBot: 3, dy: 4, sight: false }), true, 'close, 4 higher, not seen');
        assert.equal(C.countsForBot({ dBot: 6, dy: -4, sight: false }), true, '6 away, 4 lower');
        assert.equal(C.countsForBot({ dBot: 4.5, dy: 4.5, sight: true }), false, '4.5 higher');
        assert.equal(C.countsForBot({ dBot: 7, dy: 0, sight: false }), false, '7 away behind a wall');
        assert.equal(C.countsForBot({ dBot: 12, dy: 1, sight: true }), true, '12 away in sight');
        assert.equal(C.countsForBot({ dBot: 12, dy: 1 }), true, 'sight not measured: in sight (v0.1.4.7)');
        assert.equal(C.countsForBot({ dBot: 17, dy: 0, sight: true }), false, 'beyond the notice distance of 16');
        assert.equal(C.countsForBot(null), false);
    });
});

describe('C3: countsForArea', () => {
    test('a defended type only: home, building, pen, farm; never a mine', () => {
        for (const type of ['home', 'building', 'pen', 'farm']) {
            assert.equal(C.countsForArea({ ...HOME, type }, p(4, 20, 64)), true, type);
        }
        assert.equal(C.countsForArea({ ...HOME, type: 'mine' }, p(4, 20, 64)), false);
        assert.equal(C.countsForArea({ ...HOME, type: undefined }, p(4, 20, 64)), true, 'an area without a type is a building');
    });

    test('horizontally within 16 of the box', () => {
        assert.equal(C.countsForArea(HOME, p(4, 9 + 16)), true, '16 south of the box');
        assert.equal(C.countsForArea(HOME, p(4, 9 + 16.5)), false);
        assert.equal(C.countsForArea(HOME, p(4, 9 + 16, 71)), true, 'height does not add to the distance');
    });

    test('y between min.y - 3 and max.y + 3', () => {
        assert.equal(C.countsForArea(HOME, p(4, 12, 60)), true, 'min.y - 3');
        assert.equal(C.countsForArea(HOME, p(4, 12, 59.9)), false, 'below');
        assert.equal(C.countsForArea(HOME, p(4, 12, 72)), true, 'max.y + 3');
        assert.equal(C.countsForArea(HOME, p(4, 12, 72.1)), false, 'above');
        assert.equal(C.countsForArea(HOME, null), false);
    });
});

describe('C3: decide', () => {
    test('the play test: the bot at y 30 in the mine, creepers on the surface at y 64 above the mine: none', () => {
        const s = { botPos: p(30.5, 30.5, 30), areas: [MINE, HOME], creepers: [creeper(p(32, 28, 64), { id: 1 }), creeper(p(26, 36, 64), { id: 2 })] };
        assert.equal(C.decide(state(s)).step, 'none', 'without whereAmI: the mine is not defended, the creepers are 34 higher');
        const under = C.decide(state({ ...s, underground: true }));
        assert.deepEqual({ step: under.step, reason: under.reason, text: under.text }, { step: 'none', reason: 'underground', text: null });
    });

    test('underground: a creeper near the house does not count, one that counts for the bot does', () => {
        const nearHouse = creeper(p(4.5, 18, 64));
        assert.equal(C.decide(state({ botPos: p(4.5, 30, 50), creepers: [nearHouse], underground: true })).step, 'none');
        // W47: a creeper 8 blocks away in the same tunnel, in sight
        const tunnel = creeper(p(38.5, 30.5, 25), { sight: true });
        const d = C.decide(state({ botPos: p(30.5, 30.5, 25), areas: [MINE], creepers: [tunnel], underground: true }));
        assert.equal(d.step, 'run');
        const close = C.decide(state({ botPos: p(30.5, 30.5, 25), areas: [MINE], creepers: [creeper(p(34.5, 30.5, 25), { sight: false })], underground: true }));
        assert.equal(close.step, 'back_off', 'within 5 blocks, sight or not');
    });

    test('a creeper behind a wall 8 blocks away: none; in sight: it counts', () => {
        const hidden = creeper(p(50, 58), { sight: false });
        assert.equal(C.decide(state({ botPos: p(50, 50), areas: [], creepers: [hidden] })).step, 'none');
        assert.equal(C.decide(state({ botPos: p(50, 50), areas: [], creepers: [{ ...hidden, sight: true }] })).step, 'run');
    });

    test('a creeper 5 blocks below the bot counts for nobody away from areas', () => {
        assert.equal(C.decide(state({ botPos: p(50, 50), areas: [], creepers: [creeper(p(50, 53, 59), { sight: true })] })).step, 'none');
    });

    test('the height of the house decides: a creeper in a cave 5 blocks under the floor of the house does not count', () => {
        const cave = creeper(p(4.5, 20, 58), { sight: false });
        assert.equal(C.decide(state({ botPos: p(4.5, 40), creepers: [cave] })).step, 'none');
        const yard = creeper(p(4.5, 20, 64), { sight: false });
        assert.equal(C.decide(state({ botPos: p(4.5, 40), creepers: [yard] })).step, 'lure', 'at the height of the house');
    });

    test('a creeper near a mine (not defended) is no reason to lure', () => {
        const surfaceMine = box('quarry', 'mine', 0, 60, 0, 8, 70, 8);
        const d = C.decide(state({ botPos: p(4.5, 40), areas: [surfaceMine], creepers: [creeper(p(4.5, 18, 64), { sight: false })] }));
        assert.equal(d.step, 'none');
    });

    test('in the walls of a home or a building the bot stays', () => {
        for (const type of ['home', 'building']) {
            const d = C.decide(state({ areas: [{ ...HOME, type }], botPos: p(4.5, 4.5), creepers: [creeper(p(4.5, 11))] }));
            assert.equal(d.reason, 'in_shelter', type);
        }
    });
});

describe('C3: lineOfSight', () => {
    const solidAt = (blocks) => (x, y, z) => blocks.has(`${x},${y},${z}`);

    test('free air: true; a solid block on the line: false', () => {
        assert.equal(C.lineOfSight({ x: 0.5, y: 65.6, z: 0.5 }, { x: 10.5, y: 64.8, z: 0.5 }, solidAt(new Set())), true);
        assert.equal(C.lineOfSight({ x: 0.5, y: 65.6, z: 0.5 }, { x: 10.5, y: 64.8, z: 0.5 }, solidAt(new Set(['5,65,0']))), false);
        assert.equal(C.lineOfSight({ x: 0.5, y: 65.6, z: 0.5 }, { x: 10.5, y: 64.8, z: 0.5 }, solidAt(new Set(['5,66,0', '5,63,0']))), true,
            'blocks above and below the line');
    });

    test('diagonal lines pass every block they cross', () => {
        const from = { x: 0.5, y: 65.5, z: 0.5 };
        const to = { x: 6.5, y: 65.5, z: 6.5 };
        assert.equal(C.lineOfSight(from, to, solidAt(new Set(['3,65,3']))), false);
        assert.equal(C.lineOfSight(from, to, solidAt(new Set(['3,65,5', '5,65,3']))), true, 'next to the line');
        assert.equal(C.lineOfSight({ x: 0.5, y: 30.6, z: 0.5 }, { x: 0.5, y: 64.8, z: 0.5 }, solidAt(new Set(['0,50,0']))), false, 'rock above the bot');
    });

    test('the blocks of both ends do not count; an unloaded block blocks; bad input: false', () => {
        assert.equal(C.lineOfSight({ x: 0.5, y: 65.6, z: 0.5 }, { x: 3.5, y: 64.8, z: 0.5 }, (x) => x === 0 || x === 3), true);
        assert.equal(C.lineOfSight({ x: 0.5, y: 65.6, z: 0.5 }, { x: 3.5, y: 64.8, z: 0.5 }, () => null), false);
        assert.equal(C.lineOfSight(null, { x: 1, y: 1, z: 1 }, () => false), false);
        assert.equal(C.lineOfSight({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, null), false);
        assert.equal(C.lineOfSight({ x: 0.5, y: 65.6, z: 0.5 }, { x: 0.6, y: 65.1, z: 0.6 }, () => true), true, 'the same block');
    });
});

describe('C3: the context (creeper.js)', () => {
    function scene({ botAt = [4.5, 64, 30.5], creeperAt = [4.5, 64, 38.5], house = true } = {}) {
        const world = makeWorld();
        const area = house ? buildHouse(world) : null;
        const bot = makeFakeBot({ world, pos: botAt });
        const c = creeperAt ? addMob(bot, 'creeper', creeperAt) : null;
        const ctx = { areas: area ? [area] : [], settings: { home_pack: true }, log: () => {}, now: () => 1_000_000 };
        return { world, bot, creeper: c, ctx };
    }

    test('readCreepers gives dBot, dy and sight', () => {
        const s = scene({ creeperAt: [4.5, 66, 38.5] });
        const [c] = K.readCreepers(s.bot, 24);
        assert.equal(c.dy, 2);
        assert.ok(Math.abs(c.dBot - Math.hypot(8, 2)) < 1e-9);
        assert.equal(c.sight, true);
        s.world.fill(0, 64, 34, 9, 68, 34, 'stone');
        assert.equal(K.readCreepers(s.bot, 24)[0].sight, false, 'a wall of stone between');
    });

    test('creeperCheck: a creeper 8 blocks away behind a wall does not count, in sight it does', () => {
        const s = scene({ house: false, botAt: [50.5, 64, 50.5], creeperAt: [50.5, 64, 58.5] });
        assert.equal(K.creeperCheck(s.bot, s.ctx).step, 'run');
        s.world.fill(45, 64, 54, 55, 68, 54, 'stone');
        assert.equal(K.creeperCheck(s.bot, s.ctx).step, 'none');
    });

    test('creeperCheck with ctx.whereAmI: underground, a creeper near the house does not count; without whereAmI the surface', () => {
        const s = scene({ botAt: [4.5, 64, 30.5], creeperAt: [4.5, 64, 14.5] });
        s.world.fill(0, 64, 22, 9, 68, 22, 'stone'); // no sight, 16 away from the bot
        assert.equal(K.creeperCheck(s.bot, s.ctx).step, 'lure', 'on the surface the house is defended');
        const under = K.creeperCheck(s.bot, { ...s.ctx, whereAmI: () => ({ area: null, depth: 20, underground: true }) });
        assert.deepEqual({ step: under.step, reason: under.reason }, { step: 'none', reason: 'underground' });
        const broken = K.creeperCheck(s.bot, { ...s.ctx, whereAmI: () => { throw new Error('x'); } });
        assert.equal(broken.step, 'lure', 'a failing whereAmI: the surface');
    });
});
