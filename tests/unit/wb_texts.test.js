// Spec v0.1.4.12, 4.4 (part B, engineer E4): the texts of the watching pack, word for word.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { importsOf } from '../helpers/hygiene.js';

const { TEXTS, DIR_WORDS } = await loadSrc('src/agent/packs/watch/texts.js');
const at = { x: 3, y: 64, z: -7 };

describe('texts.js', () => {
    test('pure: no imports', () => {
        assert.deepEqual(importsOf('src/agent/packs/watch/texts.js').static, []);
    });

    test('the direction words', () => {
        assert.deepEqual({ ...DIR_WORDS }, { east: 'eastwards', west: 'westwards', south: 'southwards', north: 'northwards' });
    });

    test('watched', () => {
        assert.equal(TEXTS.watched(4, 0), 'I watched you: 4 blocks placed, 0 broken.');
        assert.equal(TEXTS.watched(0, 6), 'I watched you: 0 blocks placed, 6 broken.');
        assert.equal(TEXTS.watched(1, 2), 'I watched you: 1 block placed, 2 broken.');
    });

    test('understood: line, fence, tunnel, and the two endings', () => {
        assert.equal(TEXTS.understood.line('oak_planks', 12, at, 'east', 7, 20),
            'I understood: a line of oak_planks 12 long from (3, 64, -7) eastwards; 7 oak_planks more, I carry 20.');
        assert.equal(TEXTS.understood.fence(7, 10, at, 'east', TEXTS.gateMiddle('south'), 30, 1, 12),
            'I understood: a fence 7 x 10 from (3, 64, -7) eastwards, the gate in the middle of the south side; 30 oak_fence and 1 oak_fence_gate more, I carry 12 oak_fence.');
        assert.equal(TEXTS.understood.fence(7, 10, at, 'north', TEXTS.gatePlaced, 26, 0, 12, 'oak_fence', 'oak_fence_gate'),
            'I understood: a fence 7 x 10 from (3, 64, -7) northwards, the gate where you placed it; 26 oak_fence more, I carry 12 oak_fence.');
        assert.equal(TEXTS.understood.fence(4, 4, at, 'west', TEXTS.gatePlaced, 0, 0, 3, 'birch_fence', 'birch_fence_gate'),
            'I understood: a fence 4 x 4 from (3, 64, -7) westwards, the gate where you placed it; 0 birch_fence more, I carry 3 birch_fence.');
        assert.equal(TEXTS.understood.tunnel(12, at, 'west', 9), 'I understood: a tunnel 12 long from (3, 64, -7) westwards, 2 high; 9 blocks more to dig.');
        assert.equal(TEXTS.sayYesBuild, ' Say yes to build it.');
        assert.equal(TEXTS.sayYesDig, ' Say yes to dig it.');
    });

    test('noPattern, nothingWatched, nothingToBuild', () => {
        assert.equal(TEXTS.noPattern(3, 'no_line'), 'I see no pattern in what you did: 3 blocks that lie on no line.');
        assert.equal(TEXTS.noPattern(1, 'too_few'), 'I see no pattern in what you did: 1 block.');
        assert.equal(TEXTS.noPattern(0, 'too_few'), 'I see no pattern in what you did: 0 blocks.');
        assert.equal(TEXTS.noPattern(4, 'no_size'), 'I see no pattern in what you did: a fence needs a size, say "7 by 10".');
        assert.equal(TEXTS.nothingWatched, 'I have watched nothing yet. Say "watch me" first.');
        assert.equal(TEXTS.nothingToBuild, 'I have no plan. Say "continue like this" first.');
    });

    test('built, short, stopped, refused', () => {
        assert.equal(TEXTS.built.line(7, 'oak_planks'), 'I built the line: 7 oak_planks.');
        assert.equal(TEXTS.built.fence(30, 1), 'I built the fence: 30 oak_fence and 1 gate. Say "this is the pen" to save it.');
        assert.equal(TEXTS.built.fence(26, 0, 'oak_fence'), 'I built the fence: 26 oak_fence. Say "this is the pen" to save it.');
        assert.equal(TEXTS.built.tunnel(9), 'I dug the tunnel: 9 blocks.');
        assert.equal(TEXTS.short('oak_fence', 30, 12), 'I have 12 oak_fence and need 30. I fetch the rest from the chest.');
        assert.equal(TEXTS.shortBuilt('oak_fence', 30, 12, 12, 30), 'I have 12 oak_fence and need 30. I found no more in the chests; I built 12 of 30.');
        assert.equal(TEXTS.stopped(12, 30), 'I stopped after 12 of 30.');
        assert.equal(TEXTS.refused(at, TEXTS.whyArea('pen')), 'I placed nothing at (3, 64, -7): it is inside the area "pen".');
        assert.equal(TEXTS.refusedDig(at, TEXTS.whyArea('home')), 'I dug nothing at (3, 64, -7): it is inside the area "home".');
    });

    test('at most 3 refusals, then "and N more"', () => {
        const r = (i) => TEXTS.refused({ x: i, y: 64, z: 0 }, TEXTS.whyArea('pen'));
        assert.equal(TEXTS.refusals([]), '');
        assert.equal(TEXTS.refusals([r(1)]), r(1));
        assert.equal(TEXTS.refusals([r(1), r(2), r(3)]), `${r(1)} ${r(2)} ${r(3)}`);
        assert.equal(TEXTS.refusals([r(1), r(2), r(3), r(4), r(5)]),
            'I placed nothing at (1, 64, 0): it is inside the area "pen". I placed nothing at (2, 64, 0): it is inside the area "pen". I placed nothing at (3, 64, 0): it is inside the area "pen", and 2 more.');
    });
});
