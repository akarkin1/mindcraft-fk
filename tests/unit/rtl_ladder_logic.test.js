// Spec v0.1.4.9 section 13, part L (engineer E3): src/agent/library/ladder_logic.js, pure. ladderColumnAt finds
// the column of ladders whose top or bottom lies within 2 blocks of the feet, with a trapdoor directly above
// its top; ladderWay says whether the follow needs it (down: the player 2 or more below and within 3 blocks of
// the column; up: 2 or more above); heightWay is the rule of goToPlayer (by the height only).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { assertCleanImport } from '../helpers/module_rules.js';
import { importsOf } from '../helpers/hygiene.js';

const L = await loadSrc('src/agent/library/ladder_logic.js');

// The shaft of the base: ladders facing south at (2, 41..59, -2), on stone; the room floor at y 40; an oak
// trapdoor at (2, 60, -2); grass at y 60 elsewhere, air above.
function shaft({ trapdoor = 'oak_trapdoor', from = 41, to = 59, facing = 'south', floor = 40, strings = false } = {}) {
    const cells = new Map();
    for (let y = from; y <= to; y++) cells.set(`2,${y},-2`, strings ? 'ladder' : { name: 'ladder', facing });
    if (trapdoor) cells.set(`2,${to + 1},-2`, { name: trapdoor, facing });
    return (x, y, z) => {
        const c = cells.get(`${x},${y},${z}`);
        if (c) return c;
        if (x === 2 && z === -2 && y > floor && y <= to + 1) return 'air';
        if (y > 60) return 'air';
        return y === 60 ? 'grass_block' : 'stone';
    };
}

const COLUMN = { x: 2, z: -2, top: 59, bottom: 41, facing: 'south', trapdoor: { x: 2, y: 60, z: -2, name: 'oak_trapdoor' } };

describe('ladderColumnAt', () => {
    test('from the floor beside the trapdoor: the column, with the trapdoor above its top', () => {
        assert.deepEqual(L.ladderColumnAt(shaft(), { x: 2, y: 61, z: -1 }), COLUMN);
        assert.deepEqual(L.ladderColumnAt(shaft(), { x: 2.5, y: 61, z: -0.5 }), COLUMN, 'a position of the bot is floored');
    });

    test('standing in the open trapdoor cell above the ladders (the stop of F14), and at the foot', () => {
        assert.deepEqual(L.ladderColumnAt(shaft(), { x: 2, y: 60, z: -2 }), COLUMN);
        assert.deepEqual(L.ladderColumnAt(shaft(), { x: 2, y: 41, z: -1 }), COLUMN);
        assert.deepEqual(L.ladderColumnAt(shaft(), { x: 4, y: 43, z: 0 }), COLUMN, '2 blocks away on both axes, 2 above the bottom');
    });

    test('without a trapdoor: trapdoor null', () => {
        assert.deepEqual(L.ladderColumnAt(shaft({ trapdoor: null }), { x: 2, y: 61, z: -1 }), { ...COLUMN, trapdoor: null });
    });

    test('out of reach: 3 blocks away, 3 above the top, or half way up a long column', () => {
        assert.equal(L.ladderColumnAt(shaft(), { x: 5, y: 61, z: -2 }), null);
        assert.equal(L.ladderColumnAt(shaft(), { x: 2, y: 62, z: -1 }), null);
        assert.equal(L.ladderColumnAt(shaft(), { x: 3, y: 50, z: -1 }), null);
        assert.deepEqual(L.ladderColumnAt(shaft(), { x: 2, y: 62, z: -1 }, { reach: 3 }), COLUMN, 'a larger reach');
    });

    test('a column of one ladder', () => {
        assert.deepEqual(L.ladderColumnAt(shaft({ from: 59, to: 59, floor: 58, trapdoor: null }), { x: 2, y: 60, z: -1 }),
            { x: 2, z: -2, top: 59, bottom: 59, facing: 'south', trapdoor: null });
    });

    test('a column that ends one block above the floor: the bottom is the free cell under it', () => {
        assert.equal(L.ladderColumnAt(shaft({ from: 42, floor: 40 }), { x: 2, y: 61, z: -1 }).bottom, 41);
        assert.equal(L.ladderColumnAt(shaft({ from: 43, floor: 40 }), { x: 2, y: 61, z: -1 }).bottom, 43, 'two free cells: the lowest ladder');
    });

    test('the facing: from the ladder blocks; without it, away from the wall', () => {
        assert.equal(L.ladderColumnAt(shaft({ facing: 'north' }), { x: 2, y: 61, z: -1 }).facing, 'north');
        const noFacing = (x, y, z) => {
            if (x === 2 && z === -2 && y >= 41 && y <= 59) return 'ladder';
            if (z === -3) return 'stone';
            return 'air';
        };
        assert.equal(L.ladderColumnAt(noFacing, { x: 2, y: 61, z: -1 }).facing, 'south');
    });

    test('the nearest of two columns; never throws', () => {
        const two = (x, y, z) => ((x === 0 || x === 3) && z === 0 && y >= 50 && y <= 60 ? { name: 'ladder', facing: 'east' } : (y <= 49 ? 'stone' : 'air'));
        assert.equal(L.ladderColumnAt(two, { x: 2, y: 61, z: 0 }).x, 3);
        assert.equal(L.ladderColumnAt(() => { throw new Error('x'); }, { x: 0, y: 0, z: 0 }), null);
        assert.equal(L.ladderColumnAt(null, { x: 0, y: 0, z: 0 }), null);
        assert.equal(L.ladderColumnAt(shaft(), null), null);
        assert.equal(L.ladderColumnAt(() => null, { x: 0, y: 0, z: 0 }), null, 'nothing loaded');
    });
});

describe('ladderWay', () => {
    const feetTop = { x: 2.5, y: 61, z: -0.5 };
    test('down: the player 2 or more below and within 3 blocks of the column', () => {
        assert.equal(L.ladderWay(COLUMN, feetTop, { x: 2.5, y: 41, z: -0.5 }), 'down');
        assert.equal(L.ladderWay(COLUMN, feetTop, { x: 4.5, y: 59, z: -0.5 }), 'down', '2 below, 2.2 from the column');
        assert.equal(L.ladderWay(COLUMN, feetTop, { x: 6.5, y: 41, z: -0.5 }), null, '4.3 from the column');
        assert.equal(L.ladderWay(COLUMN, feetTop, { x: 2.5, y: 60, z: -0.5 }), null, '1 below');
        assert.equal(L.ladderWay(COLUMN, { x: 2.5, y: 41, z: -0.5 }, { x: 2.5, y: 30, z: -0.5 }), null, 'the bot is at the bottom already');
    });

    test('up: the player 2 or more above', () => {
        assert.equal(L.ladderWay(COLUMN, { x: 2.5, y: 41, z: -0.5 }, { x: 2.5, y: 61, z: -0.5 }), 'up');
        assert.equal(L.ladderWay(COLUMN, { x: 2.5, y: 41, z: -0.5 }, { x: 20, y: 43, z: 20 }), 'up', 'the rule has no distance for up');
        assert.equal(L.ladderWay(COLUMN, { x: 2.5, y: 41, z: -0.5 }, { x: 2.5, y: 42.5, z: -0.5 }), null, '1.5 above');
        assert.equal(L.ladderWay(COLUMN, feetTop, { x: 2.5, y: 70, z: -0.5 }), null, 'the bot is above the column');
    });

    test('null for bad input', () => {
        assert.equal(L.ladderWay(null, feetTop, { x: 0, y: 0, z: 0 }), null);
        assert.equal(L.ladderWay(COLUMN, null, { x: 0, y: 0, z: 0 }), null);
        assert.equal(L.ladderWay(COLUMN, feetTop, undefined), null);
    });
});

describe('heightWay (goToPlayer), entryOf, ladderPlace, wallYaw', () => {
    test('heightWay: by the height only', () => {
        const feetTop = { x: 2.5, y: 61, z: -0.5 };
        assert.equal(L.heightWay(COLUMN, feetTop, { x: 30, y: 41, z: 30 }), 'down');
        assert.equal(L.heightWay(COLUMN, { x: 2.5, y: 41, z: -0.5 }, { x: 30, y: 61, z: 30 }), 'up');
        assert.equal(L.heightWay(COLUMN, feetTop, { x: 30, y: 60, z: 30 }), null);
        assert.equal(L.heightWay(null, feetTop, { x: 30, y: 41, z: 30 }), null);
    });

    test('entryOf: beside the top on the open side, at the height of the feet above the trapdoor', () => {
        assert.deepEqual(L.entryOf(COLUMN), { x: 2, y: 61, z: -1 });
        assert.deepEqual(L.entryOf({ ...COLUMN, facing: 'east' }), { x: 3, y: 61, z: -2 });
    });

    test('ladderPlace: the trapdoor, else the top ladder', () => {
        assert.equal(L.ladderPlace(COLUMN), '(2, 60, -2)');
        assert.equal(L.ladderPlace({ ...COLUMN, trapdoor: null }), '(2, 59, -2)');
    });

    test('wallYaw: looking at the wall, against the facing (yaw of mineflayer, atan2(-dx, -dz))', () => {
        const at = (facing, dx, dz) => assert.ok(Math.abs(Math.cos(L.wallYaw(facing)) - Math.cos(Math.atan2(-dx, -dz))) < 1e-9
            && Math.abs(Math.sin(L.wallYaw(facing)) - Math.sin(Math.atan2(-dx, -dz))) < 1e-9, facing);
        at('south', 0, -1);
        at('north', 0, 1);
        at('east', -1, 0);
        at('west', 1, 0);
    });
});

describe('the module', () => {
    test('is pure: no imports, no side effects', () => {
        assert.deepEqual(importsOf('src/agent/library/ladder_logic.js').static, []);
        assert.equal(importsOf('src/agent/library/ladder_logic.js').dynamic, 0);
        assertCleanImport('src/agent/library/ladder_logic.js');
    });
});
