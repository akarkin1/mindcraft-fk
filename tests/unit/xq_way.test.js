// v0.1.4.13 part Q (engineer E4), SPEC 4.6: the pure rules of src/agent/library/way_logic.js. Q7 the shaft rule on the
// three paths of the spec (straight down, stairs, a slope) and a ladder; Q5 the kit rule of giveToPlayer; Q2 the routes
// to the surface of goToSurface. Every text word for word.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const W = await loadSrc('src/agent/library/way_logic.js');

const FEET = { x: 0.5, y: 64, z: 0.5 };
const step = (x, y, z, breaks = false) => ({ x, y, z, toBreak: breaks ? [{ x, y, z }] : [] });
const straightDown = (n, breaks = true) => Array.from({ length: n }, (_, i) => step(0, 63 - i, 0, breaks));
const stairsDown = (n) => Array.from({ length: n }, (_, i) => step(i + 1, 63 - i, 0));
const slopeDown = (n) => Array.from({ length: n * 2 }, (_, i) => step(i + 1, 64 - Math.ceil((i + 1) / 2), 0, true));

describe('Q7: the shaft rule', () => {
    test('the text, word for word', () => {
        // the correction of 2026-10-04 (the owner): the refusal names the ladders; with them the shaft is dug with ladders
        assert.equal(W.noLaddersText(64, 0, 66), 'I do not dig a shaft 64 blocks down without ladders: I have 0 and need 66. Bring me ladders or show me stairs.');
        assert.equal(W.noLaddersText(20, 6, 22), 'I do not dig a shaft 20 blocks down without ladders: I have 6 and need 22. Bring me ladders or show me stairs.');
        assert.equal(W.ladderShaftText(20), 'I dig down 20 blocks with ladders.');
        assert.equal(W.laddersNeeded(20), 22);
    });

    test('the drop: whole blocks below the feet, 0 above', () => {
        assert.equal(W.dropOf(FEET, { x: 0, y: 44, z: 0 }), 20);
        assert.equal(W.dropOf({ x: 3.2, y: 63.99, z: 1 }, { x: 0, y: 60, z: 0 }), 4, 'the feet cell of a bot that stands a hair low');
        assert.equal(W.dropOf(FEET, { x: 0, y: 70, z: 0 }), 0);
        assert.equal(W.dropOf(null, { x: 0, y: 0, z: 0 }), 0);
    });

    test('path 1, straight down and destructive, 20 blocks: a shaft', () => {
        assert.equal(W.isShaftPath(FEET, { x: 0, y: 44, z: 0 }, straightDown(20)), true);
    });

    test('a shaft that wobbles within 1 block of the line is a shaft', () => {
        const path = straightDown(10).map((p, i) => ({ ...p, x: i % 2, z: -(i % 2) }));
        assert.equal(W.isShaftPath(FEET, { x: 0, y: 54, z: 0 }, path), true);
    });

    test('path 2, stairs 20 blocks down: no shaft', () => {
        assert.equal(W.isShaftPath(FEET, { x: 20, y: 44, z: 0 }, stairsDown(20)), false);
    });

    test('path 3, a slope dug on the way: no shaft (the steps leave the line)', () => {
        assert.equal(W.isShaftPath(FEET, { x: 40, y: 44, z: 0 }, slopeDown(20)), false);
    });

    test('a ladder straight down, nothing broken: no shaft', () => {
        assert.equal(W.isShaftPath(FEET, { x: 0, y: 44, z: 0 }, straightDown(20, false)), false);
    });

    test('3 blocks down is not more than 3: no shaft; 4 is', () => {
        assert.equal(W.isShaftPath(FEET, { x: 0, y: 61, z: 0 }, straightDown(3)), false);
        assert.equal(W.isShaftPath(FEET, { x: 0, y: 60, z: 0 }, straightDown(4)), true);
    });

    test('an empty path, or no path, is no shaft', () => {
        assert.equal(W.isShaftPath(FEET, { x: 0, y: 44, z: 0 }, []), false);
        assert.equal(W.isShaftPath(FEET, { x: 0, y: 44, z: 0 }, null), false);
    });
});

describe('Q5: the kit rule', () => {
    test('the text, word for word', () => {
        assert.equal(W.KIT_TEXT, 'That is a lot. Say "put my stuff in the chest" and I put it in the nearest chest.');
    });

    test('more than 8 of one kind is a kit; 8 is not', () => {
        assert.equal(W.isKit(9), true);
        assert.equal(W.isKit(64), true);
        assert.equal(W.isKit(8), false);
        assert.equal(W.isKit(1), false);
    });

    test('more than 3 kinds is a kit; 3 is not', () => {
        assert.equal(W.isKit(1, 4), true);
        assert.equal(W.isKit(1, 3), false);
    });

    test('the kinds given within the last minute and this one', () => {
        const now = 100000;
        const given = [{ item: 'iron_helmet', at: now - 5000 }, { item: 'iron_boots', at: now - 10000 }, { item: 'iron_sword', at: now - 70000 }];
        assert.equal(W.kindsGiven(given, 'iron_chestplate', now), 3, 'the sword is older than a minute');
        assert.equal(W.kindsGiven(given, 'iron_boots', now), 2, 'the same kind again');
        assert.equal(W.kindsGiven([...given, { item: 'iron_leggings', at: now - 1000 }], 'iron_chestplate', now), 4);
        assert.equal(W.kindsGiven(null, 'bread', now), 1);
    });
});

describe('Q2: the routes to the surface', () => {
    // the route of the owner's world: from the basement up the ladder into the house
    const up = { name: 'basement_to_surface', from: { x: 13, y: 59, z: 51 }, to: { x: 12, y: 67, z: 52 }, legs: [{ kind: 'ladder' }] };
    const down = { name: 'basement', from: { x: 13, y: 66, z: 51 }, to: { x: 12, y: 59, z: 51 }, legs: [{ kind: 'ladder' }] };
    const surface = (p) => p.y >= 66;

    test('the text, word for word', () => {
        assert.equal(W.routeText('basement_to_surface'), 'I take the route "basement_to_surface".');
    });

    test('from the basement: the route up, and the route down walked back', () => {
        const r = W.surfaceRoutes([up, down], { x: 13.5, y: 59, z: 51.5 }, surface); // nearest start first
        assert.deepEqual(r.map(x => [x.route.name, x.reverse]), [['basement_to_surface', false], ['basement', true]]);
    });

    test('a start more than 8 blocks away, an end that is lower, an end not at the surface: none', () => {
        assert.deepEqual(W.surfaceRoutes([up], { x: 30, y: 59, z: 51 }, surface), []);
        assert.deepEqual(W.surfaceRoutes([up], { x: 12, y: 67, z: 52 }, surface), [], 'in the house already');
        assert.deepEqual(W.surfaceRoutes([up], { x: 13, y: 59, z: 51 }, () => false), []);
        assert.deepEqual(W.surfaceRoutes([{ ...up, legs: [] }], { x: 13, y: 59, z: 51 }, surface), [], 'a route without legs');
    });

    test('never throws', () => {
        assert.deepEqual(W.surfaceRoutes(null, { x: 0, y: 0, z: 0 }, surface), []);
        assert.deepEqual(W.surfaceRoutes([up], null, surface), []);
        assert.deepEqual(W.surfaceRoutes([up], { x: 13, y: 59, z: 51 }, () => { throw new Error('x'); }), []);
    });
});

describe('way_logic.js is pure', () => {
    test('it imports nothing and loads without output or files', () => {
        assertImportRules('src/agent/library/way_logic.js', { allowBuiltins: [], allowedRelative: [] });
        assertCleanImport('src/agent/library/way_logic.js');
    });
});
