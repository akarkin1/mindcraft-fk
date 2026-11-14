// Spec v0.1.4.16, 8.2 (E6): the pure decisions of the breeding pack (breeding_logic.js) and its texts (texts.js): FEED, the
// species of a pen, the cap, the counts, the fence box and the stand ring outside it, the gates kept away from, the adults in
// reach, the new babies, and every text word for word.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const L = await loadSrc('src/agent/packs/breeding/breeding_logic.js');
const X = await loadSrc('src/agent/packs/breeding/texts.js');
const I = await loadSrc('src/agent/packs/breeding/index.js');
const P = await loadSrc('src/agent/world/stock_permits.js');
const FIELD = await loadSrc('src/agent/packs/farming/field_logic.js');

// A 5 x 5 pen: the ground at y 63 from x 0..4, z 0..4, the fence ring at y 64 on x -1..5, z -1..5, its gate at (2, 64, -1).
// The saved box holds the fence (scanPen): (-1, 62, -1) to (5, 66, 5).
const BOX = { min: { x: -1, y: 62, z: -1 }, max: { x: 5, y: 66, z: 5 } };
const INNER = { min: { x: 0, y: 62, z: 0 }, max: { x: 4, y: 66, z: 4 } };
const onRing = (x, z) => (x === -1 || x === 5 || z === -1 || z === 5) && x >= -1 && x <= 5 && z >= -1 && z <= 5;
const getBlock = (x, y, z) => {
    if (y < 63) return { name: 'stone' };
    if (y === 63) return { name: 'grass_block' };
    if (y === 64 && onRing(x, z)) return { name: x === 2 && z === -1 ? 'oak_fence_gate' : 'oak_fence' };
    return { name: 'air' };
};

const cow = (id, x, z, extra = {}) => ({ id, name: 'cow', type: 'animal', position: { x, y: 64, z }, metadata: {}, ...extra });

describe('the constants and FEED (8.2)', () => {
    test('the feed of each species, the preferred one first', () => {
        assert.deepEqual(L.FEED.cow, ['wheat']);
        assert.deepEqual(L.FEED.sheep, ['wheat']);
        assert.deepEqual(L.FEED.mooshroom, ['wheat']);
        assert.deepEqual(L.FEED.pig, ['carrot', 'potato', 'beetroot']);
        assert.deepEqual(L.FEED.chicken, ['wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds']);
        assert.deepEqual(L.FEED.rabbit, ['carrot', 'dandelion']);
        assert.ok(Object.isFrozen(L.FEED));
        assert.deepEqual(L.feedOf('minecraft:Cow'), ['wheat']);
        assert.equal(L.feedOf('horse'), null);
        assert.equal(L.feedOf(null), null);
    });

    test('the cap 12, the reach 3, the cooldown 300,000 checked every 15 s, two more rounds, 10 s for an animal to come', () => {
        assert.equal(L.PEN_CAP, 12);
        assert.equal(L.FEED_REACH, 3);
        assert.equal(L.BREED_COOLDOWN_MS, 300000);
        assert.equal(L.COOLDOWN_CHECK_MS, 15000);
        assert.equal(L.EXTRA_ROUNDS, 2);
        assert.equal(L.COME_WAIT_MS, 10000);
    });

    test('the species of a pen: the most animals, ties by name; the counts', () => {
        assert.equal(L.speciesOf({ animals: { sheep: 1, cow: 4 } }), 'cow');
        assert.equal(L.speciesOf({ animals: { sheep: 2, cow: 2 } }), 'cow');
        assert.equal(L.speciesOf({ animals: { 'minecraft:pig': 3 } }), 'pig');
        assert.equal(L.speciesOf({ animals: {} }), null);
        assert.equal(L.speciesOf(null), null);
        assert.equal(L.animalCount({ animals: { cow: 10, sheep: 2 } }), 12);
        assert.equal(L.animalCount(undefined), 0);
    });

    test('the count of the order, the feed needed (two per pair) and the low mark (two rounds)', () => {
        assert.equal(L.cleanCount(3), 3);
        assert.equal(L.cleanCount('4'), 4);
        assert.equal(L.cleanCount(0), 2);
        assert.equal(L.cleanCount(undefined), 2);
        assert.equal(L.cleanCount(2.7), 2);
        assert.equal(L.feedNeeded(3), 6);
        assert.equal(L.lowMark(3), 12);
        assert.equal(L.feedNeeded(), 4);
    });

    test('a baby: the metadata flag 16 (as mcdata.isHuntable reads it); the eyes 1.62 above the feet', () => {
        assert.equal(L.isBaby({ metadata: { 16: true } }), true);
        assert.equal(L.isBaby({ metadata: { 16: 1 } }), true);
        assert.equal(L.isBaby({ metadata: { 16: false } }), false);
        assert.equal(L.isBaby({ metadata: {} }), false);
        assert.equal(L.isBaby(null), false);
        assert.deepEqual(L.eyesOf({ x: 1, y: 64, z: 2 }), { x: 1, y: 65.62, z: 2 });
        assert.equal(L.eyesOf(null), null);
    });
});

describe('the fence box and the stand ring (8.2: the ring one block outside the fence ring)', () => {
    test('a saved pen holds its fence: the fence box is the box; a box of the inside grows by one; without a reader the box', () => {
        assert.deepEqual(L.fenceBoxOf(getBlock, BOX), BOX);
        assert.deepEqual(L.fenceBoxOf(getBlock, INNER), { min: { x: -1, y: 62, z: -1 }, max: { x: 5, y: 66, z: 5 } });
        assert.deepEqual(L.fenceBoxOf(null, INNER), INNER);
        assert.equal(L.fenceBoxOf(getBlock, { min: { x: 1 } }), null);
        assert.equal(L.isFenceName('oak_fence'), true);
        assert.equal(L.isFenceName('minecraft:spruce_fence_gate'), true);
        assert.equal(L.isFenceName('cobblestone_wall'), true);
        assert.equal(L.isFenceName('oak_planks'), false);
    });

    test('the ring: 32 cells one block outside the fence, a walk around the pen (each cell a neighbour of the one before)', () => {
        const ring = L.standRing(BOX);
        assert.equal(ring.length, 32);
        for (const c of ring) {
            assert.ok(c.x >= -2 && c.x <= 6 && c.z >= -2 && c.z <= 6, JSON.stringify(c));
            assert.ok(c.x === -2 || c.x === 6 || c.z === -2 || c.z === 6, `${JSON.stringify(c)} is on the outer ring`);
            assert.ok(!L.insideBoxXZ(BOX, c), `${JSON.stringify(c)} is outside the fence`);
        }
        assert.deepEqual(ring[0], { x: -2, z: -2 });
        for (let i = 1; i < ring.length; i++) {
            assert.equal(Math.abs(ring[i].x - ring[i - 1].x) + Math.abs(ring[i].z - ring[i - 1].z), 1, `step ${i}`);
        }
        assert.equal(new Set(ring.map((c) => `${c.x},${c.z}`)).size, 32, 'no cell twice');
        assert.deepEqual(L.standRing(null), []);
    });

    test('never a gate cell or the cell before a gate', () => {
        const ring = L.withoutGateCells(L.standRing(BOX), [{ x: 2, y: 64, z: -1 }]);
        assert.equal(ring.length, 31);
        assert.ok(!ring.some((c) => c.x === 2 && c.z === -2), 'the cell before the gate');
        assert.ok(ring.some((c) => c.x === 1 && c.z === -2) && ring.some((c) => c.x === 3 && c.z === -2), 'its neighbours stay');
        assert.deepEqual(L.withoutGateCells(L.standRing(BOX), []), L.standRing(BOX));
        assert.deepEqual(L.gatesOf({ entrances: [{ x: 2, y: 64, z: -1, kind: 'gate' }, { x: 0, y: 64, z: 0, kind: 'door' }] }), [{ x: 2, y: 64, z: -1 }]);
        assert.deepEqual(L.gatesOf(null), []);
    });

    test('findGates is the copy of the farming pack\'s findGates (a pack never imports another one): the same answer on every grid', () => {
        const inner = { min: { x: 0, y: 62, z: 0 }, max: { x: 4, y: 66, z: 4 } };
        const grids = [
            getBlock,
            (x, y, z) => (y === 64 && onRing(x, z) ? { name: (x === 5 && z === 2) || (x === -1 && z === 4) ? 'spruce_fence_gate' : 'oak_fence' } : getBlock(x, y, z)),
            (x, y, z) => (y === 66 && x === 2 && z === 5 ? { name: 'birch_fence_gate' } : getBlock(x, y, z)),
            () => ({ name: 'air' }),
            () => { throw new Error('not loaded'); },
        ];
        for (const [i, get] of grids.entries()) {
            assert.deepEqual(L.findGates(get, inner), FIELD.findGates(get, inner), `grid ${i}`);
            assert.deepEqual(L.findGates(get, BOX), FIELD.findGates(get, BOX), `grid ${i}, the saved box`);
        }
        assert.deepEqual(L.findGates(getBlock, inner), [{ x: 2, y: 64, z: -1, kind: 'gate' }]);
        assert.deepEqual(L.findGates(null, inner), FIELD.findGates(null, inner));
        assert.deepEqual(L.findGates(getBlock, null), []);
        assert.equal(I.findGates, L.findGates);
    });

    test('the walk starts at the cell nearest to the bot and goes on around the ring', () => {
        const ring = L.standRing(BOX);
        const from = L.ringFrom(ring, { x: 2.5, z: 8.5 });
        assert.deepEqual(from[0], { x: 2, z: 6 });
        assert.equal(from.length, 32);
        assert.deepEqual(from[1], { x: 1, z: 6 });
        assert.deepEqual(L.ringFrom(ring, null), ring);
    });

    test('insideBox and insideBoxXZ', () => {
        assert.equal(L.insideBox(BOX, { x: 2.5, y: 64, z: 2.5 }), true);
        assert.equal(L.insideBox(BOX, { x: 2.5, y: 70, z: 2.5 }), false);
        assert.equal(L.insideBoxXZ(BOX, { x: -1.5, z: 2 }), false);
        assert.equal(L.insideBoxXZ(BOX, { x: -0.5, z: 2 }), true);
    });
});

describe('the adults in reach and the new babies', () => {
    const eyes = { x: 2.5, y: 65.62, z: 6.5 }; // standing at (2, 6), the south ring

    test('within 3 blocks of the eyes, inside the box, not babies, not fed within the cooldown; the nearest first', () => {
        const entities = {
            1: cow(1, 1.5, 4.5), 2: cow(2, 3.5, 4.5), 3: cow(3, 2.5, 0.5), 4: cow(4, 2.5, 4.5, { metadata: { 16: true } }), 5: cow(5, 2.5, 7.5),
            6: { id: 6, name: 'sheep', type: 'animal', position: { x: 2.5, y: 64, z: 4.5 }, metadata: {} },
        };
        const near = L.adultsInReach(entities, BOX, 'cow', eyes);
        assert.deepEqual(near.map((e) => e.id), [1, 2], 'the far cow, the baby, the cow outside the pen and the sheep are left out');
        const fedAt = new Map([[1, 1000]]);
        assert.deepEqual(L.adultsInReach(entities, BOX, 'cow', eyes, { fedAt, now: 1000 + 60000 }).map((e) => e.id), [2], 'fed 1 minute ago');
        assert.deepEqual(L.adultsInReach(entities, BOX, 'cow', eyes, { fedAt, now: 1000 + 300000 }).map((e) => e.id), [1, 2], 'the cooldown is over');
        assert.deepEqual(L.adultsInReach(entities, BOX, 'cow', null), []);
        assert.deepEqual(L.animalsIn(entities, BOX, 'cow').map((e) => e.id), [1, 2, 3, 4]);
    });

    test('the new babies: of the species, in the box, with an id that was not there at the start', () => {
        const entities = { 1: cow(1, 1.5, 4.5), 7: cow(7, 2.5, 2.5, { metadata: { 16: true } }), 8: cow(8, 1.5, 1.5, { metadata: { 16: true } }), 9: cow(9, 9.5, 2.5, { metadata: { 16: true } }) };
        assert.deepEqual(L.newBabies(entities, BOX, 'cow', new Set([1, 7])).map((e) => e.id), [8]);
        assert.deepEqual(L.newBabies(entities, BOX, 'cow', new Set()).map((e) => e.id), [7, 8]);
    });

    test('the adults the pack may feed: only the animals of the start (a calf without its metadata yet looks adult), without the skipped', () => {
        const entities = { 1: cow(1, 1.5, 4.5), 2: cow(2, 3.5, 4.5), 3: cow(3, 2.5, 0.5), 10: cow(10, 2.5, 2.5) };
        const only = new Set([1, 2, 3]);
        assert.deepEqual(L.feedableAdults(entities, BOX, 'cow', { only }).map((e) => e.id), [1, 2, 3], 'the new animal 10 is left out');
        assert.deepEqual(L.feedableAdults(entities, BOX, 'cow', { only, skip: new Set([2]) }).map((e) => e.id), [1, 3]);
        assert.deepEqual(L.feedableAdults(entities, BOX, 'cow', { only, fedAt: new Map([[3, 0]]), now: 1000 }).map((e) => e.id), [1, 2]);
        assert.deepEqual(L.feedableAdults(entities, BOX, 'cow').map((e) => e.id), [1, 2, 3, 10], 'without only: every adult');
        assert.deepEqual(L.adultsInReach(entities, BOX, 'cow', { x: 2.5, y: 65.62, z: 6.5 }, { only, skip: new Set([1]) }).map((e) => e.id), [2]);
    });

    test('the stand cell nearest to an animal: the ring cell outside the fence closest to it', () => {
        const ring = L.standRing(BOX);
        assert.deepEqual(L.nearestRingCell(ring, { x: 3.5, z: 4.5 }), { x: 3, z: 6 });
        assert.deepEqual(L.nearestRingCell(ring, { x: 0.5, z: 2.5 }), { x: -2, z: 2 });
        assert.deepEqual(L.nearestRingCell(ring, { x: 0.5, z: 0.5 }), { x: 0, z: -2 }, 'a tie: the first of the ring');
        assert.deepEqual(L.nearestRingCell(ring, { x: 4.6, z: 2.5 }), { x: 6, z: 2 });
        assert.equal(L.nearestRingCell(ring, null), null);
        assert.equal(L.nearestRingCell([], { x: 1, z: 1 }), null);
    });

    test('the waits: the young counted every 15 s, the stop seen every 500 ms (the action manager kills after 10 s), 15 s for the young', () => {
        assert.equal(L.COOLDOWN_CHECK_MS, 15000);
        assert.equal(L.STOP_CHECK_MS, 500);
        assert.ok(L.STOP_CHECK_MS < 10000);
        assert.equal(L.BABY_WAIT_MS, 15000);
    });
});

describe('the texts (8.1, 8.2), word for word', () => {
    test('the pen, the species, the cap, the feed', () => {
        assert.equal(X.unknownPenText('barn'), 'I know no pen "barn".');
        assert.equal(X.unknownSpeciesText('horse'), 'I do not know what the horses eat; I breed cows, sheep, pigs, chickens and rabbits.');
        assert.equal(X.unknownSpeciesText('fox'), 'I do not know what the foxes eat; I breed cows, sheep, pigs, chickens and rabbits.');
        assert.equal(X.penFullText('cow_pen', 12), 'The cow pen is full: 12 animals; I breed no more there.');
        assert.equal(X.noFeedText('wheat', 'cow'), 'I have no wheat for the cows.');
        assert.equal(X.noFeedText('wheat', 'sheep'), 'I have no wheat for the sheep.');
        assert.equal(X.noAnimalsText('cow_pen'), 'I see no animals in the cow pen.');
        assert.equal(X.noWayText('cow_pen'), 'I found no way around the cow pen.');
    });

    test('the pair line, the end line, the stop line; the young of each species', () => {
        assert.equal(X.fedText(2, 'cow', 'cow_pen'), 'I fed 2 cows in the cow pen.');
        assert.equal(X.endText(4, 'cow', 'cow_pen', 2), 'I fed 4 cows in the cow pen; 2 calves.');
        assert.equal(X.endText(2, 'cow', 'barn', 1), 'I fed 2 cows in the barn; 1 calf.');
        assert.equal(X.endText(1, 'sheep', 'sheep_pen', 0), 'I fed 1 sheep in the sheep pen; 0 lambs.');
        assert.equal(X.endText(2, 'pig', 'pig_pen', 1), 'I fed 2 pigs in the pig pen; 1 piglet.');
        assert.equal(X.endText(6, 'chicken', 'coop', 3), 'I fed 6 chickens in the coop; 3 chicks.');
        assert.equal(X.endText(2, 'rabbit', 'hutch', 2), 'I fed 2 rabbits in the hutch; 2 kits.');
        assert.equal(X.endText(2, 'mooshroom', 'pen', 1), 'I fed 2 mooshrooms in the pen; 1 calf.');
        assert.equal(X.stoppedText('cow_pen', 2, 'cow', 1), 'I stopped the feeding at the cow pen: 2 cows fed, 1 calf.');
        assert.equal(X.stoppedText('cow_pen', 1, 'cow', 0), 'I stopped the feeding at the cow pen: 1 cow fed, 0 calves.');
        assert.equal(X.youngWords('horse', 2), '2 young');
        assert.equal(X.speciesWords('cow', 1), 'cow');
        assert.equal(X.penWords('cow_pen'), 'the cow pen');
        assert.deepEqual([...X.BRED_SPECIES], ['cow', 'sheep', 'pig', 'chicken', 'rabbit']);
    });

    test('the asking rule (8.1): the took-line, the question, the low question, the refusal, no stock', () => {
        const chest = { x: 11, y: 67, z: 53 };
        assert.equal(X.tookText(8, 'wheat', chest), 'I took 8 wheat from the chest at (11, 67, 53).');
        assert.equal(X.askText(8, 'wheat', chest, X.PURPOSES.feeding), 'May I take 8 wheat from the chest at (11, 67, 53) for the feeding? Say yes or no.');
        assert.equal(X.askText(3, 'lapis_lazuli', chest, X.PURPOSES.enchanting), 'May I take 3 lapis_lazuli from the chest at (11, 67, 53) for the enchanting? Say yes or no.');
        assert.equal(X.askLowText(6, 8, 'wheat', X.PURPOSES.feeding), 'Only 6 wheat are left in the chests; may I take 8 for the feeding? Say yes or no.');
        assert.equal(X.askLowText(1, 3, 'lapis_lazuli', X.PURPOSES.killRoom), 'Only 1 lapis_lazuli is left in the chests; may I take 3 for the kill room? Say yes or no.');
        assert.equal(X.noPermitText('wheat'), 'I take no wheat without your word; say "you may take wheat" when you want.');
        assert.equal(P.noWordText('lapis_lazuli'), X.noPermitText('lapis_lazuli'), 'the copy of the store for actions.js is the same sentence');
        assert.equal(X.noStockText('wheat'), 'I have no wheat and the chests have none.');
        assert.deepEqual(X.PURPOSES, { feeding: 'the feeding', enchanting: 'the enchanting', killRoom: 'the kill room' });
        assert.equal(X.whereText({ x: -13.7, y: 63, z: 28.2 }), '(-14, 63, 28)');
    });
});

describe('the index of the pack', () => {
    test('re-exports the logic, the texts, takeOrAsk, breed and the store; the API is frozen', () => {
        assert.equal(I.FEED, L.FEED);
        assert.equal(I.standRing, L.standRing);
        assert.equal(I.endText, X.endText);
        assert.equal(typeof I.takeOrAsk, 'function');
        assert.equal(typeof I.breed, 'function');
        assert.equal(typeof I.StockPermits, 'function');
        assert.equal(I.PERMITS_FILE, 'permits.json');
        assert.deepEqual(Object.keys(I.BREEDING_API).sort(), ['breed', 'takeOrAsk']);
        assert.ok(Object.isFrozen(I.BREEDING_API));
        assert.equal(I.BREED_RULES.cap, 12);
        assert.deepEqual(I.STOCK_RULES, { chestRange: 48, askMs: 60000, pollMs: 500 });
    });
});
