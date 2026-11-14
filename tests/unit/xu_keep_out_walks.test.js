// Spec v0.1.4.16 (part A, engineer E1), F10 the keep-out of every walk: makeMovements of the home pack (src/agent/packs/home/
// motion.js) gives the no_enter areas it is given a step cost of KEEP_OUT_COST (100) through applyKeepOut, digging or not, so
// no walk of the home, farming, wood or mining pack crosses a cave mouth the survey saved; applyKeepOut on a raw Movements of
// mineflayer-pathfinder does the same for the walks of skills.js; an area that holds the start of the walk is free (the bot
// can walk out); a pen or a farm without the flag is not a keep-out of a walk (the farming pack walks into its farm).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import pf from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeFakeBot } from './home_fake_bot.test.js';

const M = await loadSrc('src/agent/packs/home/motion.js');
const L = await loadSrc('src/agent/areas/keep_out_logic.js');

const caveMouth = (extra = {}) => ({ name: 'cave_mouth', type: 'building', kind: 'yard', dimension: 'overworld', flags: { no_enter: true },
    min: { x: 10, y: 60, z: 10 }, max: { x: 14, y: 66, z: 14 }, ...extra });
const block = (x, y, z, name = 'air') => ({ name, position: new Vec3(x, y, z) });

// the step cost of the movements for a block: the sum of exclusionAreasStep, as the path search reads it
function stepCost(movements, b) {
    return (movements.exclusionAreasStep ?? []).reduce((sum, fn) => sum + fn(b), 0);
}

describe('F10: makeMovements with a no_enter area', () => {
    test('a step inside the area costs 100 more, outside 0; with and without digging', () => {
        const bot = makeFakeBot({ world: makeWorld(), pos: [0.5, 64, 0.5] });
        for (const dig of [false, true]) {
            const m = M.makeMovements(bot, { dig, areas: [caveMouth()] });
            assert.equal(stepCost(m, block(12, 64, 12)), 100, `inside, dig ${dig}`);
            assert.equal(stepCost(m, block(10, 60, 10)), 100, 'the corner of the box');
            assert.equal(stepCost(m, block(15, 64, 12)), 0, 'beside it');
            assert.equal(stepCost(m, block(12, 67, 12)), 0, 'over it');
            assert.equal(m.canDig, dig);
        }
        assert.equal(L.KEEP_OUT_COST, 100);
    });

    test('an area without the flag gives no step cost (a pen, a farm, a home); the dig penalty of v0.1.4.6 stays', () => {
        const bot = makeFakeBot({ world: makeWorld(), pos: [0.5, 64, 0.5] });
        const pen = { ...caveMouth({ name: 'pen', type: 'pen', kind: 'pen' }), flags: undefined };
        const m = M.makeMovements(bot, { dig: true, areas: [pen, caveMouth({ name: 'home', type: 'home', flags: {} })] });
        assert.equal(stepCost(m, block(12, 64, 12)), 0);
        assert.ok(m.exclusionAreasBreak.some(fn => fn(block(12, 64, 12, 'stone')) === 100), 'digging in the areas is still dear');
        const none = M.makeMovements(bot, { dig: false });
        assert.equal(stepCost(none, block(12, 64, 12)), 0);
    });

    test('the area the bot stands in is free, so it can walk out; another dimension does not count', () => {
        const inside = makeFakeBot({ world: makeWorld(), pos: [12.5, 64, 12.5] });
        const m = M.makeMovements(inside, { areas: [caveMouth()] });
        assert.equal(stepCost(m, block(13, 64, 13)), 0, 'the bot is inside: free');
        const nether = makeFakeBot({ world: makeWorld(), pos: [0.5, 64, 0.5] });
        nether.game.dimension = 'the_nether';
        assert.equal(stepCost(M.makeMovements(nether, { areas: [caveMouth()] }), block(12, 64, 12)), 0, 'an area of the overworld');
        const prefixed = makeFakeBot({ world: makeWorld(), pos: [0.5, 64, 0.5] });
        prefixed.game.dimension = 'minecraft:overworld';
        assert.equal(stepCost(M.makeMovements(prefixed, { areas: [caveMouth()] }), block(12, 64, 12)), 100, 'the prefix of the game is no difference');
    });
});

describe('F10: applyKeepOut on a raw Movements', () => {
    test('a list of areas: the no_enter ones cost 100 a cell, the others nothing; the movements are returned', () => {
        const bot = makeFakeBot({ world: makeWorld(), pos: [0.5, 64, 0.5] });
        const m = new pf.Movements(bot);
        const before = m.exclusionAreasStep.length;
        assert.equal(M.applyKeepOut(m, [caveMouth(), { ...caveMouth({ name: 'farm', type: 'farm' }), flags: {} }], { from: { x: 0.5, y: 64, z: 0.5 } }), m);
        assert.equal(m.exclusionAreasStep.length, before + 1);
        assert.equal(stepCost(m, block(12, 64, 12)), 100);
        assert.equal(stepCost(m, block(20, 64, 20)), 0);
        assert.equal(stepCost(m, { name: 'air' }), 0, 'a block without a position');
    });

    test('a function pos => area (the view of a guard) works too; nothing without areas; never throws', () => {
        const bot = makeFakeBot({ world: makeWorld(), pos: [0.5, 64, 0.5] });
        const areaAt = (pos) => (pos.x >= 10 && pos.x <= 14 && pos.z >= 10 && pos.z <= 14 && pos.y >= 60 && pos.y <= 66 ? caveMouth() : null);
        const m = M.applyKeepOut(new pf.Movements(bot), areaAt, { from: { x: 0.5, y: 64, z: 0.5 } });
        assert.equal(stepCost(m, block(12, 64, 12)), 100);
        assert.equal(stepCost(m, block(2, 64, 2)), 0);
        const out = M.applyKeepOut(new pf.Movements(bot), areaAt, { from: { x: 12.5, y: 64, z: 12.5 } });
        assert.equal(stepCost(out, block(12, 64, 12)), 0, 'the bot starts inside: free');
        const empty = new pf.Movements(bot);
        const n = empty.exclusionAreasStep.length;
        M.applyKeepOut(empty, []);
        assert.equal(empty.exclusionAreasStep.length, n, 'no rule without a keep-out area');
        assert.equal(M.applyKeepOut(null, [caveMouth()]), null);
        assert.doesNotThrow(() => M.applyKeepOut(new pf.Movements(bot), () => { throw new Error('x'); }));
        const bare = {};
        M.applyKeepOut(bare, [caveMouth()]);
        assert.equal(stepCost(bare, block(12, 64, 12)), 100, 'a movements object without the list gets one');
    });

    test('the walk of the creeper procedure gets the areas (F1 and F10)', async () => {
        const K = await loadSrc('src/agent/packs/home/creeper.js');
        const { addMob, makeSim } = await import('./home_fake_bot.test.js');
        const bot = makeFakeBot({ world: makeWorld(), pos: [50.5, 64, 50.5] });
        addMob(bot, 'creeper', [50.5, 64, 53]);
        const sim = makeSim(bot);
        const cave = caveMouth({ min: { x: 48, y: 60, z: 60 }, max: { x: 52, y: 66, z: 64 } });
        await K.runCreeperProcedure(bot, { areas: [cave], settings: {}, log: () => {}, now: sim.now }, { now: sim.now, wait: sim.wait, maxMs: 2000 });
        assert.ok(bot.pathfinder.movements, 'movements were set');
        assert.equal(stepCost(bot.pathfinder.movements, block(50, 64, 62)), 100, 'the cave mouth costs 100 on the flee walk');
    });
});
