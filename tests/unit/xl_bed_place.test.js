// v0.1.4.14, fix round part 8 (P-24, SPEC 8.6, engineer E4): a bed lies on two level ground cells with air above them,
// each support with two solid neighbours at its level (no pillar), with a free cell to stand on behind its foot; the
// bot looks within 4 blocks and walks there; none: `I found no level ground for the bed within 4 blocks.`
// bedPlaces of src/agent/packs/home/bed_logic.js (pure) and placeBed of src/agent/packs/home/bed.js.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { give, makeWoodBot, makeWorld } from './wood_fake_bot.test.js';

const B = await loadSrc('src/agent/packs/home/bed_logic.js');
const BED = await loadSrc('src/agent/packs/home/bed.js');

const cells = (p) => [p.foot, p.head].map(c => [c.x, c.y, c.z]);
const level = (w, p) => [p.foot, p.head].every(c => w.getBlockName(c.x, c.y, c.z) === 'air' && w.getBlockName(c.x, c.y - 1, c.z) !== 'air');

describe('bedPlaces (pure)', () => {
    test('flat grass: a place beside the bot, placed from where it stands', () => {
        const w = createBlockWorld().flatGround(63);
        const places = B.bedPlaces(w.getBlockName, { x: 0.5, y: 64, z: 0.5 });
        assert.ok(places.length > 0);
        const best = places[0];
        assert.equal(best.near, true);
        assert.deepEqual(best.stand, { x: 0, y: 64, z: 0 });
        assert.ok(level(w, best));
    });

    test('on a cobblestone pillar 2 blocks above the ground (the owner\'s log at (-965, 66, 449)): the bed on the ground, not on the pillar', () => {
        const w = createBlockWorld().flatGround(63);
        w.fill(0, 64, 0, 0, 65, 0, 'cobblestone');
        const places = B.bedPlaces(w.getBlockName, { x: 0.5, y: 66, z: 0.5 });
        assert.ok(places.length > 0);
        assert.ok(places.every(p => p.foot.y === 64 && p.head.y === 64), JSON.stringify(places.slice(0, 3).map(cells)));
        assert.ok(places.every(p => !(p.foot.x === 0 && p.foot.z === 0) && !(p.head.x === 0 && p.head.z === 0)));
    });

    test('a 1 x 1 pillar top or a single block is no support (two solid neighbours at its level)', () => {
        const w = createBlockWorld().flatGround(50, 'stone', 'stone');
        w.fill(0, 51, 0, 0, 63, 0, 'stone');
        w.fill(1, 51, 0, 1, 63, 0, 'stone');
        assert.deepEqual(B.bedPlaces(w.getBlockName, { x: 0.5, y: 64, z: 0.5 }), [], 'two columns side by side: one neighbour each');
    });

    test('a slope: the bed lies along the level line, both cells on one level', () => {
        const w = createBlockWorld().flatGround(63);
        for (let x = 0; x <= 8; x++) w.fill(x, 64, -8, x, 63 + x, 8, 'dirt'); // one block up per block east
        const places = B.bedPlaces(w.getBlockName, { x: 3.5, y: 67, z: 0.5 });
        assert.ok(places.length > 0);
        for (const p of places) {
            assert.equal(p.foot.y, p.head.y);
            assert.equal(p.foot.x, p.head.x, 'along z');
            assert.ok(level(w, p));
        }
    });

    test('nothing level within 4 blocks: none, and the text of 8.11', () => {
        const w = createBlockWorld().flatGround(30, 'stone', 'stone');
        w.fill(0, 31, 0, 0, 63, 0, 'stone'); // a lone column of stone in a deep pit
        assert.deepEqual(B.bedPlaces(w.getBlockName, { x: 0.5, y: 64, z: 0.5 }), []);
        assert.equal(B.NO_BED_GROUND_TEXT, 'I found no level ground for the bed within 4 blocks.');
        assert.deepEqual(B.bedPlaces(null, { x: 0, y: 64, z: 0 }), []);
    });

    test('a free cell to stand on behind the foot is needed', () => {
        const w = createBlockWorld().flatGround(63);
        // a corridor 2 long between walls: no cell behind a foot inside it
        w.fill(-2, 64, -2, 3, 65, 2, 'stone');
        w.fill(0, 64, 0, 1, 65, 0, 'air');
        const places = B.bedPlaces(w.getBlockName, { x: 0.5, y: 64, z: 0.5 }, 1);
        assert.deepEqual(places, []);
    });
});

describe('placeBed', () => {
    test('on the pillar: the bot walks down to the stand of the nearest place and puts the bed on the ground', async () => {
        const world = makeWorld();
        world.fill(0, 64, 0, 0, 65, 0, 'cobblestone');
        const bot = makeWoodBot({ world, pos: [0.5, 66, 0.5] });
        give(bot, 'black_bed', 1);
        const r = await BED.placeBed(bot, {}, 'black_bed');
        assert.equal(r.ok, true, r.text);
        assert.equal(r.at.y, 64);
        assert.equal(world.nameAt(r.at.x, r.at.y, r.at.z), 'black_bed');
        assert.equal(r.text, `Placed black_bed at (${r.at.x}, 64, ${r.at.z}).`);
    });

    test('no level ground within 4 blocks: the text of 8.11, nothing placed', async () => {
        const world = makeWorld({ groundY: 30 });
        world.fill(0, 31, 0, 0, 63, 0, 'stone');
        const bot = makeWoodBot({ world, pos: [0.5, 64, 0.5] });
        give(bot, 'black_bed', 1);
        const r = await BED.placeBed(bot, {}, 'black_bed');
        assert.deepEqual(r, { ok: false, at: null, text: 'I found no level ground for the bed within 4 blocks.' });
        assert.equal(bot.calls.filter(c => c[0] === 'place').length, 0);
    });

    test('no bed in the bag', async () => {
        const bot = makeWoodBot({ world: makeWorld(), pos: [0.5, 64, 0.5] });
        assert.equal((await BED.placeBed(bot, {}, 'red_bed')).text, "Don't have any red_bed to place.");
    });
});
