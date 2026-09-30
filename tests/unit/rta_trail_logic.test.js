// Spec v0.1.4.9, part A (engineer E1): the rules of a step of the trail (I1), pure, with plain objects.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const L = await loadSrc('src/agent/packs/routes/trail_logic.js');

// A world of plain blocks: `blocks` maps "x,y,z" to { name, solid, skyLight, half }; air elsewhere.
function world(blocks = {}, { skyLight } = {}) {
    return (x, y, z) => blocks[`${x},${y},${z}`] ?? { name: 'air', solid: false, skyLight };
}
const stone = { name: 'stone', solid: true };

describe('when a step is made', () => {
    test('a new step when the feet cell differs from the last step (Math.floor of x, y, z)', () => {
        const get = world({ '0,63,0': { name: 'grass_block', solid: true } }, { skyLight: 15 });
        const s = L.nextStep(null, { pos: { x: 0.7, y: 64, z: 0.2 }, onGround: true, t: 5 }, get);
        assert.deepEqual(s, { x: 0, y: 64, z: 0, on: 'grass_block', at: 'air', sky: true, t: 5, via: null });
        assert.equal(L.nextStep(s, { pos: { x: 0.1, y: 64, z: 0.9 }, onGround: true, t: 6 }, get), null, 'the same cell: no step');
        const neg = L.nextStep(s, { pos: { x: -0.2, y: 64, z: -3.5 }, onGround: true, t: 7 }, get);
        assert.deepEqual([neg.x, neg.y, neg.z], [-1, 64, -4]);
    });

    test('nothing while the bot falls; a step on a ladder and in water', () => {
        const get = world({ '0,50,0': { name: 'ladder', solid: false }, '5,50,0': { name: 'water', solid: false } });
        assert.equal(L.nextStep(null, { pos: { x: 2.5, y: 60.4, z: 0.5 }, onGround: false }, get), null, 'a fall is not a step');
        assert.equal(L.nextStep(null, { pos: { x: 0.5, y: 50.3, z: 0.5 }, onGround: false }, get).at, 'ladder');
        assert.equal(L.nextStep(null, { pos: { x: 5.5, y: 50.3, z: 0.5 }, onGround: false }, get).at, 'water');
        assert.equal(L.nextStep(null, { pos: { x: 8.5, y: 50.3, z: 0.5 }, onGround: false, inWater: true }, get).x, 8);
        assert.equal(L.mayStep({ onGround: false, at: 'air' }), false);
    });

    test('nothing without a position or a reader', () => {
        assert.equal(L.nextStep(null, { pos: null, onGround: true }, world()), null);
        assert.equal(L.nextStep(null, { pos: { x: 1, y: 2, z: 3 }, onGround: true }, null), null);
    });
});

describe('open sky: the column of 64 blocks, never the sky light (fix round 2, F5)', () => {
    test('a stale sky light of 15 under a roof is no open sky; a sky light of 0 under the open sky is', () => {
        const roof = world({ '0,70,0': stone }, { skyLight: 15 });
        assert.equal(L.columnIsOpen(roof, { x: 0, y: 64, z: 0 }), false, 'a roof 6 above');
        assert.equal(L.nextStep(null, { pos: { x: 0.5, y: 64, z: 0.5 }, onGround: true }, roof).sky, false, 'under the roof, the light says 15');
        assert.equal(L.nextStep(null, { pos: { x: 0.5, y: 64, z: 0.5 }, onGround: true }, world({}, { skyLight: 0 })).sky, true, 'open, the light says 0');
        assert.equal(L.stepSky(world({}, { skyLight: 3 }), { x: 0, y: 64, z: 0 }, { name: 'air', skyLight: 3 }), true);
        assert.equal(L.isOpenSky, undefined, 'the light is not read at all');
    });

    test('the column looks exactly 64 blocks up; a block that is not loaded is air', () => {
        assert.equal(L.columnIsOpen(world({ '0,128,0': stone }), { x: 0, y: 64, z: 0 }), false, '64 above');
        assert.equal(L.columnIsOpen(world({ '0,129,0': stone }), { x: 0, y: 64, z: 0 }), true, '65 above');
        assert.equal(L.columnIsOpen(() => null, { x: 0, y: 64, z: 0 }), true);
    });

    test('a step inside a house (sky light 0 from a server without light, a roof) is not under the sky; outside it is', () => {
        const blocks = { '0,68,0': { name: 'oak_planks', solid: true } };
        const get = world(blocks, { skyLight: 0 });
        assert.equal(L.nextStep(null, { pos: { x: 0.5, y: 64, z: 0.5 }, onGround: true }, get).sky, false);
        assert.equal(L.nextStep(null, { pos: { x: 3.5, y: 64, z: 0.5 }, onGround: true }, get).sky, true);
    });
});

describe('fix round T1-3: no open sky on a ladder or in a shaft', () => {
    // a 1 x 1 shaft of ladders under open sky: stone around the column (5, 50..63, 5), sky light 15 inside it
    function shaft() {
        const blocks = {};
        for (let y = 50; y <= 63; y++) {
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) blocks[`${5 + dx},${y},${5 + dz}`] = stone;
            blocks[`5,${y},5`] = { name: 'ladder', solid: false, skyLight: 15 };
        }
        blocks['5,50,5'] = { name: 'air', solid: false, skyLight: 15 };
        blocks['5,49,5'] = stone;
        return world(blocks, { skyLight: 15 });
    }

    test('the ladder steps and the foot of the shaft are not under open sky; the grass beside it is', () => {
        const get = shaft();
        assert.equal(L.nextStep(null, { pos: { x: 5.5, y: 57.4, z: 5.5 }, onGround: false }, get).sky, false, 'on the ladder');
        assert.equal(L.nextStep(null, { pos: { x: 5.5, y: 50, z: 5.5 }, onGround: true }, get).sky, false, 'the foot, in the shaft');
        assert.equal(L.inShaft(get, { x: 5, y: 50, z: 5 }), true);
        assert.equal(L.openSides(get, { x: 5, y: 50, z: 5 }), 0);
        assert.equal(L.nextStep(null, { pos: { x: 8.5, y: 64, z: 5.5 }, onGround: true }, get).sky, true, 'on the grass');
    });

    test('two open sides at head height are enough: a trench, a corner', () => {
        const trench = world({ '0,65,1': stone, '0,65,-1': stone }, { skyLight: 15 });
        assert.equal(L.stepSky(trench, { x: 0, y: 64, z: 0 }, { name: 'air', skyLight: 15 }), true);
        const pit = world({ '0,65,1': stone, '0,65,-1': stone, '1,65,0': stone }, { skyLight: 15 });
        assert.equal(L.stepSky(pit, { x: 0, y: 64, z: 0 }, { name: 'air', skyLight: 15 }), false);
    });
});

describe('via: the openable passed with a step', () => {
    const door = { name: 'oak_door', solid: true, half: 'lower' };
    const upper = { name: 'oak_door', solid: true, half: 'upper' };

    test('a door at the feet cell, the lower half for the upper half', () => {
        const get = world({ '4,64,7': door, '4,65,7': upper });
        assert.deepEqual(L.viaOf(get, { x: 4, y: 64, z: 7 }, { x: 4, y: 64, z: 8 }), { kind: 'door', name: 'oak_door', x: 4, y: 64, z: 7 });
        assert.deepEqual(L.viaOf(world({ '4,65,7': upper }), { x: 4, y: 65, z: 7 }, null), { kind: 'door', name: 'oak_door', x: 4, y: 64, z: 7 });
    });

    test('a door at the last cell, and at the cell between two steps two blocks apart', () => {
        const get = world({ '4,64,7': door });
        assert.equal(L.viaOf(get, { x: 4, y: 64, z: 6 }, { x: 4, y: 64, z: 7 }).kind, 'door', 'the last cell');
        assert.equal(L.viaOf(get, { x: 4, y: 64, z: 6 }, { x: 4, y: 64, z: 8 }).z, 7, 'between');
        assert.equal(L.viaOf(get, { x: 4, y: 64, z: 4 }, { x: 4, y: 64, z: 5 }), null, 'not passed');
        assert.deepEqual(L.cellBetween({ x: -1, y: 64, z: 0 }, { x: 1, y: 64, z: 0 }), { x: 0, y: 64, z: 0 });
    });

    test('fix round 2, F8: every cell on the line between two steps, up to 4', () => {
        const trap = { name: 'oak_trapdoor', solid: true };
        // from the floor west of the hole onto the ladder 2 below: the line passes the trapdoor at (2, 60, -2)
        assert.deepEqual(L.lineCells({ x: 1, y: 61, z: -2 }, { x: 2, y: 59, z: -2 }), [{ x: 1, y: 60, z: -2 }, { x: 2, y: 60, z: -2 }]);
        assert.deepEqual(L.viaOf(world({ '2,60,-2': trap }), { x: 2, y: 59, z: -2 }, { x: 1, y: 61, z: -2 }),
            { kind: 'trapdoor', name: 'oak_trapdoor', x: 2, y: 60, z: -2 });
        // up the column and out to the north in one look: the trapdoor is on the line
        assert.equal(L.viaOf(world({ '2,60,-2': trap }), { x: 2, y: 61, z: -3 }, { x: 2, y: 58, z: -2 })?.y, 60);
        // a door 3 cells back on a straight run of 5
        assert.equal(L.viaOf(world({ '4,64,7': { name: 'oak_door', half: 'lower' } }), { x: 4, y: 64, z: 5 }, { x: 4, y: 64, z: 10 })?.z, 7);
        assert.deepEqual(L.lineCells({ x: 0, y: 64, z: 0 }, { x: 10, y: 64, z: 0 }).map(c => c.x), [1, 2, 8, 9], 'the first 2 and the last 2');
        assert.deepEqual(L.lineCells({ x: 0, y: 64, z: 0 }, { x: 1, y: 64, z: 0 }), []);
    });

    test('a gate; iron doors are no openables', () => {
        assert.equal(L.viaOf(world({ '0,64,0': { name: 'oak_fence_gate' } }), { x: 0, y: 64, z: 0 }, null).kind, 'gate');
        assert.equal(L.viaOf(world({ '0,64,0': { name: 'iron_door', half: 'lower' } }), { x: 0, y: 64, z: 0 }, null), null);
    });

    test('a trapdoor also directly above or below the feet; a door above the feet does not count', () => {
        const trap = { name: 'oak_trapdoor', solid: true };
        assert.deepEqual(L.viaOf(world({ '2,60,-2': trap }), { x: 2, y: 59, z: -2 }, { x: 2, y: 58, z: -2 }),
            { kind: 'trapdoor', name: 'oak_trapdoor', x: 2, y: 60, z: -2 }, 'above');
        assert.equal(L.viaOf(world({ '2,60,-2': trap }), { x: 2, y: 61, z: -2 }, null).y, 60, 'below');
        assert.equal(L.viaOf(world({ '2,62,-2': trap }), { x: 2, y: 60, z: -2 }, null), null, 'two above');
        assert.equal(L.viaOf(world({ '2,61,-2': door }), { x: 2, y: 60, z: -2 }, null), null, 'a door above');
    });

    test('the step holds it', () => {
        const get = world({ '4,64,7': door, '4,63,6': stone });
        const s = L.nextStep({ x: 4, y: 64, z: 8 }, { pos: { x: 4.5, y: 64, z: 6.5 }, onGround: true, t: 1 }, get);
        assert.deepEqual(s.via, { kind: 'door', name: 'oak_door', x: 4, y: 64, z: 7 });
        assert.equal(s.on, 'stone');
    });
});

describe('jumps and the file', () => {
    test('a move of more than 16 blocks sideways or up is a jump; a fall is not', () => {
        assert.equal(L.isJump({ x: 0, y: 64, z: 0 }, { x: 16, y: 64, z: 0 }), false);
        assert.equal(L.isJump({ x: 0, y: 64, z: 0 }, { x: 17, y: 64, z: 0 }), true);
        assert.equal(L.isJump({ x: 0, y: 64, z: 0 }, { x: 0, y: 81, z: 0 }), true);
        assert.equal(L.isJump({ x: 0, y: 64, z: 0 }, { x: 0, y: 20, z: 0 }), false);
        assert.equal(L.isJump(null, { x: 0, y: 20, z: 0 }), false);
    });

    test('cleanStep keeps valid steps and leaves out broken ones', () => {
        assert.deepEqual(L.cleanStep({ x: 1.5, y: 64, z: -2.5, on: 'stone', at: 'air', sky: 1, t: 3, via: null }),
            { x: 1, y: 64, z: -3, on: 'stone', at: 'air', sky: false, t: 3, via: null });
        assert.equal(L.cleanStep({ x: 'a', y: 1, z: 2 }), null);
        assert.equal(L.cleanStep({ x: 1, y: 1, z: 2, via: { kind: 'window', x: 1, y: 1, z: 1 } }), null);
        assert.deepEqual(L.cleanStep({ x: 1, y: 1, z: 2, via: { kind: 'gate', name: 'oak_fence_gate', x: 1, y: 1, z: 3 } }).via,
            { kind: 'gate', name: 'oak_fence_gate', x: 1, y: 1, z: 3 });
    });

    test('the numbers of the trail', () => {
        assert.deepEqual({ ...L.TRAIL_RULES }, { maxSteps: 500, intervalMs: 100, lineCells: 4, saveMs: 5000, skyScan: 64, jump: 16 });
    });
});
