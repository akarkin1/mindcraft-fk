// Spec v0.1.4.7 M2: src/agent/packs/mining/mine_logic.js -- the steps of a shaft, a staircase and a
// tunnel, veins, going back, what a trip needs, the entrance. These decide whether the bot lives.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const L = await loadSrc('src/agent/packs/mining/mine_logic.js');

// A world of names: every block is `fill` unless set; `null` marks a block that is not loaded.
function world(fill = 'stone') {
    const m = new Map();
    const w = {
        set(x, y, z, name) {
            m.set(`${x},${y},${z}`, name);
            return w;
        },
        get: (x, y, z) => (m.has(`${x},${y},${z}`) ? m.get(`${x},${y},${z}`) : fill),
        patch(list) {
            for (const p of list) {
                w.set(p.x, p.y, p.z, 'cobblestone');
            }
            return w;
        },
    };
    return w;
}
const keys = list => list.map(p => `${p.x},${p.y},${p.z}`).sort();
const slots = list => list.map(p => p.slot).sort();

describe('names and directions', () => {
    test('classify', () => {
        assert.equal(L.classify(null), 'unknown');
        assert.equal(L.classify(''), 'unknown');
        assert.equal(L.classify(undefined), 'unknown');
        for (const n of ['air', 'cave_air', 'void_air', 'ladder', 'torch', 'wall_torch']) {
            assert.equal(L.classify(n), 'air', n);
        }
        assert.equal(L.classify('lava'), 'lava');
        for (const n of ['water', 'bubble_column', 'kelp', 'seagrass']) {
            assert.equal(L.classify(n), 'water', n);
        }
        assert.equal(L.classify('bedrock'), 'unbreakable');
        assert.equal(L.classify('stone'), 'solid');
        assert.equal(L.classify('gravel'), 'solid');
        assert.equal(L.isFalling('gravel'), true);
        assert.equal(L.isFalling('red_concrete_powder'), true);
        assert.equal(L.isFalling('stone'), false);
        assert.equal(L.isFalling(null), false);
    });

    test('directions turn clockwise; offset and directionOf', () => {
        assert.equal(L.rightOf('north'), 'east');
        assert.equal(L.rightOf('west'), 'north');
        assert.equal(L.leftOf('north'), 'west');
        assert.equal(L.leftOf('east'), 'north');
        assert.equal(L.backOf('south'), 'north');
        assert.equal(L.rightOf('bogus'), 'east', 'unknown is north');
        assert.deepEqual(L.dirVector('east'), { x: 1, y: 0, z: 0 });
        assert.deepEqual(L.offset({ x: 1, y: 2, z: 3 }, 'south', 2, 1), { x: 1, y: 3, z: 5 });
        assert.deepEqual(L.offset({ x: 1, y: 2, z: 3 }, { x: 1, y: 1, z: 0 }, 2), { x: 3, y: 4, z: 3 });
        assert.equal(L.directionOf(3, 1), 'east');
        assert.equal(L.directionOf(-3, 1), 'west');
        assert.equal(L.directionOf(0, -2), 'north');
        assert.equal(L.directionOf(1, 5), 'south');
        assert.equal(L.directionOf(0, 0), null);
        assert.equal(L.directionOf('a', 0), null);
        assert.deepEqual(L.cellOf({ x: 1.5, y: -0.2, z: 2 }), { x: 1, y: -1, z: 2 });
        assert.equal(L.cellOf({ x: 1 }), null);
        assert.equal(L.sameCell({ x: 1.2, y: 2, z: 3.9 }, { x: 1, y: 2.5, z: 3 }), true);
        assert.equal(L.sameCell({ x: 1, y: 2, z: 3 }, null), false);
        assert.equal(L.isDirection('up'), false);
    });
});

describe('shaftStep', () => {
    const feet = { x: 10, y: 60, z: 10 };
    const step = w => L.shaftStep(L.shaftView(w.get, feet));

    test('solid rock all around: dig', () => {
        const r = step(world());
        assert.equal(r.action, 'dig');
        assert.deepEqual(r.patch, []);
        assert.equal(r.falling, false);
    });

    test('the view has the block under the feet, the one under it and four beside each', () => {
        const w = world().set(10, 59, 10, 'dirt').set(10, 58, 10, 'granite').set(11, 59, 10, 'andesite').set(10, 58, 9, 'diorite');
        const v = L.shaftView(w.get, feet);
        assert.equal(v.dig, 'dirt');
        assert.equal(v.below, 'granite');
        assert.equal(v.digSides.east, 'andesite');
        assert.equal(v.belowSides.north, 'diorite');
        assert.deepEqual(Object.keys(v.digSides).sort(), ['east', 'north', 'south', 'west']);
    });

    test('lava beside the block to dig: patch that position, then dig', () => {
        const w = world().set(11, 59, 10, 'lava');
        const r = step(w);
        assert.equal(r.action, 'patch');
        assert.deepEqual(keys(r.patch), ['11,59,10']);
        assert.deepEqual(slots(r.patch), ['dig.east']);
        assert.equal(step(w.patch(r.patch)).action, 'dig');
    });

    test('water beside the block under it: patch', () => {
        const w = world().set(10, 58, 11, 'water');
        const r = step(w);
        assert.equal(r.action, 'patch');
        assert.deepEqual(slots(r.patch), ['below.south']);
    });

    test('lava on two sides and water on a third: all are patched, higher first', () => {
        const w = world().set(9, 59, 10, 'lava').set(10, 59, 11, 'lava').set(10, 58, 9, 'water');
        const r = step(w);
        assert.equal(r.action, 'patch');
        assert.deepEqual(keys(r.patch), ['10,58,9', '10,59,11', '9,59,10']);
        assert.equal(r.patch[r.patch.length - 1].y, 58, 'the lower block last: it is placed against the one above');
        assert.equal(step(w.patch(r.patch)).action, 'dig');
    });

    test('air beside: a small cave next to the shaft is closed too', () => {
        const r = step(world().set(10, 59, 9, 'cave_air'));
        assert.equal(r.action, 'patch');
        assert.deepEqual(slots(r.patch), ['dig.north']);
    });

    test('lava as the block to dig or under it: never dig', () => {
        assert.equal(step(world().set(10, 59, 10, 'lava')).action, 'lava');
        assert.equal(step(world().set(10, 58, 10, 'lava')).action, 'lava');
        assert.deepEqual(step(world().set(10, 58, 10, 'lava')).patch, []);
        assert.equal(step(world().set(10, 58, 10, 'lava').set(11, 59, 10, 'water')).action, 'lava', 'lava wins over patching');
    });

    test('a cave under the block to dig: cave, the hole to close is the block under it', () => {
        const r = step(world().set(10, 58, 10, 'air'));
        assert.equal(r.action, 'cave');
        assert.deepEqual(keys(r.patch), ['10,58,10']);
        const r2 = step(world().set(10, 59, 10, 'cave_air'));
        assert.equal(r2.action, 'cave', 'nothing under the feet');
        assert.deepEqual(slots(r2.patch), ['dig']);
    });

    test('a cave under it with lava beside the block to dig: cave first, the lava next', () => {
        const w = world().set(10, 58, 10, 'cave_air').set(10, 58, 11, 'cave_air').set(11, 59, 10, 'lava');
        const r = step(w);
        assert.equal(r.action, 'cave');
        w.patch(r.patch);
        const r2 = step(w);
        assert.equal(r2.action, 'patch');
        assert.deepEqual(slots(r2.patch), ['below.south', 'dig.east']);
        assert.equal(step(w.patch(r2.patch)).action, 'dig');
    });

    test('bedrock is the bottom; bedrock under the block to dig is a floor', () => {
        assert.equal(step(world().set(10, 59, 10, 'bedrock')).action, 'bottom');
        assert.equal(step(world().set(10, 58, 10, 'bedrock')).action, 'dig');
        assert.equal(step(world().set(10, 59, 10, 'barrier')).action, 'bottom');
    });

    test('gravel or sand to dig: dig and wait for falling blocks', () => {
        const r = step(world().set(10, 59, 10, 'gravel'));
        assert.equal(r.action, 'dig');
        assert.equal(r.falling, true);
        assert.equal(step(world().set(10, 59, 10, 'sand')).falling, true);
    });

    test('water as the block to dig or under it is closed first', () => {
        assert.deepEqual(slots(step(world().set(10, 59, 10, 'water')).patch), ['dig']);
        assert.deepEqual(slots(step(world().set(10, 58, 10, 'water')).patch), ['below']);
    });

    test('a block that is not loaded: nothing is dug, in every slot', () => {
        const positions = [[10, 59, 10], [10, 58, 10], [11, 59, 10], [9, 59, 10], [10, 59, 11], [10, 59, 9],
            [11, 58, 10], [9, 58, 10], [10, 58, 11], [10, 58, 9]];
        for (const [x, y, z] of positions) {
            const r = step(world().set(x, y, z, null));
            assert.equal(r.action, 'unknown', `${x},${y},${z}`);
            assert.deepEqual(r.patch, []);
        }
        assert.equal(L.shaftStep(L.shaftView(() => { throw new Error('boom'); }, feet)).action, 'unknown');
    });

    test('a hand-made view without origin works relative to the feet', () => {
        const r = L.shaftStep({ dig: 'stone', below: 'stone', digSides: { north: 'lava', east: 'stone', south: 'stone', west: 'stone' },
            belowSides: { north: 'stone', east: 'stone', south: 'stone', west: 'stone' } });
        assert.deepEqual(r.patch, [{ x: 0, y: -1, z: -1, slot: 'dig.north' }]);
        assert.equal(L.shaftStep(null).action, 'unknown');
    });
});

describe('staircaseStep', () => {
    const feet = { x: 0, y: 30, z: 0 };
    // going east: the column ahead is x = 1; top y 32, upper 31, middle 30, lower 29, floor 28, ceiling 33
    const step = (w, dir = 'east') => L.staircaseStep(L.staircaseView(w.get, feet, dir));

    test('solid rock: dig; the slots are where they should be', () => {
        assert.equal(step(world()).action, 'dig');
        const s = L.staircaseSlots(feet, 'east');
        assert.deepEqual([s.top, s.upper, s.middle, s.lower, s.floor, s.ceiling], [{ x: 1, y: 32, z: 0 },
            { x: 1, y: 31, z: 0 }, { x: 1, y: 30, z: 0 }, { x: 1, y: 29, z: 0 }, { x: 1, y: 28, z: 0 }, { x: 1, y: 33, z: 0 }]);
        assert.deepEqual(s['top.left'], { x: 1, y: 32, z: -1 });
        assert.deepEqual(s['lower.left'], { x: 1, y: 29, z: -1 });
        assert.deepEqual(s['lower.right'], { x: 1, y: 29, z: 1 });
        assert.deepEqual(s['middle.ahead'], { x: 2, y: 30, z: 0 });
    });

    test('lava among the blocks to dig or as the floor: lava', () => {
        assert.equal(step(world().set(1, 32, 0, 'lava')).action, 'lava');
        assert.equal(step(world().set(1, 31, 0, 'lava')).action, 'lava');
        assert.equal(step(world().set(1, 29, 0, 'lava')).action, 'lava');
        assert.equal(step(world().set(1, 28, 0, 'lava')).action, 'lava');
    });

    test('the floor is air: cave with the floor to close', () => {
        const r = step(world().set(1, 28, 0, 'cave_air'));
        assert.equal(r.action, 'cave');
        assert.deepEqual(slots(r.patch), ['floor']);
    });

    test('lava beside, water over it, air ahead: patch them, then dig', () => {
        const w = world().set(1, 30, -1, 'lava').set(1, 33, 0, 'water').set(2, 29, 0, 'air');
        const r = step(w);
        assert.equal(r.action, 'patch');
        assert.deepEqual(slots(r.patch), ['ceiling', 'lower.ahead', 'middle.left']);
        assert.equal(r.patch[0].slot, 'ceiling', 'highest first');
        assert.equal(step(w.patch(r.patch)).action, 'dig');
    });

    test('water in a block to dig is closed; bedrock is the bottom; gravel over it falls', () => {
        assert.deepEqual(slots(step(world().set(1, 30, 0, 'water')).patch), ['middle']);
        assert.equal(step(world().set(1, 29, 0, 'bedrock')).action, 'bottom');
        assert.equal(step(world().set(1, 28, 0, 'bedrock')).action, 'dig');
        assert.equal(step(world().set(1, 33, 0, 'gravel')).falling, true);
        assert.equal(step(world().set(1, 32, 0, 'sand')).falling, true);
        assert.equal(step(world().set(1, 31, 0, 'sand')).falling, false, 'the top block holds it');
        assert.equal(step(world()).falling, false);
        assert.deepEqual(slots(step(world().set(1, 32, 1, 'lava')).patch), ['top.right']);
    });

    test('unknown blocks: nothing is dug', () => {
        assert.equal(step(world().set(1, 28, 1, null)).action, 'unknown');
        assert.equal(step(world().set(1, 33, 0, null)).action, 'unknown');
        assert.equal(L.staircaseStep(null).action, 'unknown');
    });

    test('other directions', () => {
        const r = step(world().set(0, 29, -2, 'lava'), 'north');
        assert.equal(r.action, 'patch');
        assert.deepEqual(slots(r.patch), ['lower.ahead']);
        const r2 = step(world().set(-1, 30, -1, 'water'), 'west');
        assert.deepEqual(slots(r2.patch), ['middle.right']);
    });
});

describe('tunnelStep', () => {
    const feet = { x: 0, y: 16, z: 0 };
    // going north: ahead is z = -1 (lower y 16, upper y 17), left is x = -1, right is x = 1, beyond z = -2
    const step = (w, n = 1, dir = 'north') => L.tunnelStep(L.tunnelView(w.get, feet, dir, n));

    test('solid rock all around: dig, no ores, no torch', () => {
        const r = step(world());
        assert.deepEqual(r, { action: 'dig', patch: [], ores: [], torch: false, falling: false });
    });

    test('the slots of the view', () => {
        const s = L.tunnelSlots(feet, 'north');
        assert.deepEqual(s['ahead.lower'], { x: 0, y: 16, z: -1 });
        assert.deepEqual(s['ahead.upper'], { x: 0, y: 17, z: -1 });
        assert.deepEqual(s['left.upper'], { x: -1, y: 17, z: -1 });
        assert.deepEqual(s['right.lower'], { x: 1, y: 16, z: -1 });
        assert.deepEqual(s.above, { x: 0, y: 18, z: -1 });
        assert.deepEqual(s.below, { x: 0, y: 15, z: -1 });
        assert.deepEqual(s['beyond.lower'], { x: 0, y: 16, z: -2 });
        const e = L.tunnelSlots(feet, 'east');
        assert.deepEqual(e['right.lower'], { x: 1, y: 16, z: 1 }, 'the right of east is south');
        const v = L.tunnelView(world().set(1, 16, 1, 'dirt').get, feet, 'east', 3);
        assert.equal(v.right.lower, 'dirt');
        assert.equal(v.step, 3);
        assert.equal(v.dir, 'east');
    });

    test('lava, water or air around: patch those, then dig', () => {
        for (const [x, y, z, name, slot] of [[-1, 16, -1, 'lava', 'left.lower'], [1, 17, -1, 'water', 'right.upper'],
            [0, 18, -1, 'lava', 'above'], [0, 15, -1, 'cave_air', 'below'], [0, 16, -2, 'lava', 'beyond.lower'],
            [0, 17, -2, 'water', 'beyond.upper'], [-1, 17, -1, 'air', 'left.upper'], [1, 16, -1, 'lava', 'right.lower']]) {
            const w = world().set(x, y, z, name);
            const r = step(w);
            assert.equal(r.action, 'patch', slot);
            assert.deepEqual(slots(r.patch), [slot]);
            assert.equal(step(w.patch(r.patch)).action, 'dig', `${slot} closed`);
        }
    });

    test('lava on two sides', () => {
        const r = step(world().set(-1, 16, -1, 'lava').set(1, 16, -1, 'lava').set(1, 17, -1, 'lava'));
        assert.equal(r.action, 'patch');
        assert.deepEqual(slots(r.patch), ['left.lower', 'right.lower', 'right.upper']);
        assert.equal(r.patch[0].slot, 'right.upper', 'the upper block first');
    });

    test('water above and a cave below', () => {
        const w = world().set(0, 18, -1, 'water').set(0, 15, -1, 'cave_air').set(0, 14, -1, 'cave_air').set(0, 13, -1, 'cave_air');
        const r = step(w);
        assert.equal(r.action, 'patch');
        assert.deepEqual(r.patch.map(p => p.slot), ['above', 'below']);
        assert.equal(step(w.patch(r.patch)).action, 'dig');
    });

    test('a cave whose floor is 3 blocks under the tunnel: the floor ahead is closed', () => {
        const w = world();
        for (let y = 13; y <= 15; y++) {
            for (let x = -2; x <= 2; x++) {
                for (let z = -4; z <= -1; z++) {
                    w.set(x, y, z, 'cave_air');
                }
            }
        }
        const r = step(w);
        assert.equal(r.action, 'patch');
        assert.deepEqual(slots(r.patch), ['below']);
    });

    test('gravel above the tunnel: dig and wait for it to fall; gravel ahead too', () => {
        const r = step(world().set(0, 18, -1, 'gravel'));
        assert.equal(r.action, 'dig');
        assert.equal(r.falling, true);
        assert.equal(step(world().set(0, 17, -1, 'sand')).falling, true);
        assert.equal(step(world().set(0, 16, -1, 'gravel')).falling, false, 'the lower block has the upper one over it');
    });

    test('lava or water ahead: turn, with the block to close', () => {
        const r = step(world().set(0, 16, -1, 'lava'));
        assert.equal(r.action, 'turn');
        assert.deepEqual(slots(r.patch), ['ahead.lower']);
        const r2 = step(world().set(0, 17, -1, 'water').set(0, 16, -1, 'water'));
        assert.equal(r2.action, 'turn');
        assert.deepEqual(r2.patch.map(p => p.slot), ['ahead.upper', 'ahead.lower']);
    });

    test('air ahead with a cave behind it: close the opening and turn', () => {
        const w = world().set(0, 16, -1, 'cave_air').set(0, 16, -2, 'cave_air').set(0, 17, -2, 'cave_air');
        const r = step(w);
        assert.equal(r.action, 'turn');
        assert.deepEqual(slots(r.patch), ['ahead.lower']);
        const r2 = step(world().set(0, 17, -1, 'air').set(0, 18, -1, 'air'));
        assert.equal(r2.action, 'turn', 'air over the air ahead is a cave too');
        assert.deepEqual(slots(r2.patch), ['ahead.upper']);
        const r3 = step(world().set(0, 16, -1, 'air').set(0, 15, -1, 'air'));
        assert.equal(r3.action, 'turn', 'a pit ahead');
    });

    test('air behind the blocks ahead: a cave starts there, turn and leave the blocks ahead as its wall', () => {
        for (const y of [16, 17]) {
            const r = step(world().set(0, y, -2, 'cave_air'));
            assert.equal(r.action, 'turn', `beyond at y ${y}`);
            assert.deepEqual(r.patch, []);
        }
        const r = step(world().set(0, 16, -2, 'air').set(-1, 16, -1, 'lava'));
        assert.equal(r.action, 'turn', 'the cave wins over patching: nothing is dug');
    });

    test('a lone pocket of air ahead is no cave: the step goes on', () => {
        const r = step(world().set(0, 17, -1, 'air'));
        assert.equal(r.action, 'dig');
        const r2 = step(world().set(0, 17, -1, 'air').set(0, 16, -1, 'air'));
        assert.equal(r2.action, 'dig', 'two blocks of air ahead with rock around');
    });

    test('bedrock ahead: turn without patching', () => {
        const r = step(world().set(0, 16, -1, 'bedrock'));
        assert.equal(r.action, 'turn');
        assert.deepEqual(r.patch, []);
    });

    test('ore around and ahead: ores has the positions, the step digs', () => {
        const r = step(world().set(1, 16, -1, 'iron_ore').set(0, 17, -1, 'deepslate_iron_ore').set(0, 15, -1, 'coal_ore'));
        assert.equal(r.action, 'dig');
        assert.deepEqual(keys(r.ores), ['0,15,-1', '0,17,-1', '1,16,-1']);
        assert.deepEqual(slots(r.ores), ['ahead.upper', 'below', 'right.lower']);
    });

    test('ore that touches lava: the lava is patched, the ore is reported', () => {
        const r = step(world().set(-1, 16, -1, 'iron_ore').set(-1, 17, -1, 'lava'));
        assert.equal(r.action, 'patch');
        assert.deepEqual(slots(r.patch), ['left.upper']);
        assert.deepEqual(slots(r.ores), ['left.lower']);
    });

    test('a torch every 8 steps', () => {
        assert.equal(step(world(), 8).torch, true);
        assert.equal(step(world(), 16).torch, true);
        assert.equal(step(world(), 7).torch, false);
        assert.equal(step(world(), 0).torch, false);
        assert.equal(L.tunnelStep({ ...L.tunnelView(world().get, feet, 'north'), step: 'x' }).torch, false);
    });

    test('unknown blocks: nothing is dug', () => {
        for (const [x, y, z] of [[0, 16, -1], [0, 17, -1], [-1, 16, -1], [1, 17, -1], [0, 18, -1], [0, 15, -1], [0, 16, -2], [0, 17, -2]]) {
            const r = step(world().set(x, y, z, null));
            assert.equal(r.action, 'unknown', `${x},${y},${z}`);
            assert.deepEqual(r.ores, []);
        }
        assert.equal(L.tunnelStep(null).action, 'unknown');
    });

    test('other directions give the right positions', () => {
        const r = step(world().set(1, 16, 1, 'lava'), 1, 'east');
        assert.deepEqual(slots(r.patch), ['right.lower']);
        const r2 = step(world().set(-1, 16, -1, 'lava'), 1, 'west');
        assert.deepEqual(slots(r2.patch), ['right.lower'], 'the right of west is north');
    });
});

describe('veinOrder', () => {
    test('a vein of 5 touching with faces and corners, nearest first', () => {
        const w = world().set(0, 0, 0, 'iron_ore').set(1, 0, 0, 'iron_ore').set(2, 1, 0, 'deepslate_iron_ore')
            .set(3, 2, 1, 'iron_ore').set(0, -1, 0, 'iron_ore').set(0, 5, 0, 'iron_ore').set(-1, 0, 0, 'coal_ore');
        const v = L.veinOrder({ x: 0, y: 0, z: 0 }, w.get);
        assert.deepEqual(v.map(p => `${p.x},${p.y},${p.z}`), ['0,0,0', '0,-1,0', '1,0,0', '2,1,0', '3,2,1'], 'ties in the order found');
        assert.equal(v[3].name, 'deepslate_iron_ore');
    });

    test('an ore block with lava beside it is left out, and not followed', () => {
        const w = world().set(0, 0, 0, 'iron_ore').set(1, 0, 0, 'iron_ore').set(2, 0, 0, 'iron_ore').set(1, 1, 0, 'lava');
        assert.deepEqual(L.veinOrder({ x: 0, y: 0, z: 0 }, w.get).map(p => p.x), [0]);
        w.set(0, 0, 1, 'lava');
        assert.deepEqual(L.veinOrder({ x: 0, y: 0, z: 0 }, w.get), [], 'the start itself touches lava');
        const w2 = world().set(0, 0, 0, 'iron_ore').set(1, 1, 1, 'lava');
        assert.equal(L.veinOrder({ x: 0, y: 0, z: 0 }, w2.get).length, 1, 'lava at a corner is not beside');
    });

    test('limit, a start that is no ore, unknown blocks', () => {
        const w = world();
        for (let x = 0; x < 20; x++) {
            w.set(x, 0, 0, 'coal_ore');
        }
        assert.equal(L.veinOrder({ x: 0, y: 0, z: 0 }, w.get).length, 12);
        assert.equal(L.veinOrder({ x: 0, y: 0, z: 0 }, w.get, 3).length, 3);
        assert.equal(L.veinOrder({ x: 0, y: 0, z: 0 }, w.get, 0).length, 12, 'a bad limit is 12');
        assert.deepEqual(L.veinOrder({ x: 50, y: 0, z: 0 }, w.get), []);
        assert.deepEqual(L.veinOrder(null, w.get), []);
        assert.deepEqual(L.veinOrder({ x: 0, y: 0, z: 0 }, null), []);
        const w2 = world().set(0, 0, 0, 'gold_ore').set(1, 0, 0, null);
        assert.equal(L.veinOrder({ x: 0.5, y: 0.2, z: 0.9 }, w2.get).length, 1);
    });
});

describe('shouldReturn', () => {
    const ok = { collected: 2, wanted: 8, health: 20, food: 20, hasFood: true, pickaxeUses: 100, spare: false, elapsedMs: 1000,
        returnMs: 30000, maxMs: 1800000, freeSlots: 20 };

    test('nothing holds: go on', () => {
        assert.deepEqual(L.shouldReturn(ok), { go: false, reason: null });
        assert.deepEqual(L.shouldReturn({}), { go: false, reason: null }, 'fields not given are no reason');
        assert.deepEqual(L.shouldReturn(null), { go: false, reason: null });
    });

    test('each reason', () => {
        assert.deepEqual(L.shouldReturn({ ...ok, freeSlots: 3 }), { go: true, reason: 'inventory_full' });
        assert.equal(L.shouldReturn({ ...ok, freeSlots: 4 }).go, false);
        assert.equal(L.shouldReturn({ freeSlots: 2 }).reason, 'inventory_full');
        assert.equal(L.shouldReturn({ ...ok, pickaxeUses: 9 }).reason, 'pickaxe');
        assert.equal(L.shouldReturn({ ...ok, pickaxeUses: 9, spare: true }).go, false, 'a second pickaxe');
        assert.equal(L.shouldReturn({ ...ok, pickaxeUses: 10 }).go, false);
        assert.equal(L.shouldReturn({ ...ok, pickaxeUses: null }).reason, 'pickaxe', 'no pickaxe at all');
        assert.equal(L.shouldReturn({ ...ok, health: 9.5 }).reason, 'health');
        assert.equal(L.shouldReturn({ ...ok, health: 10 }).go, false);
        assert.equal(L.shouldReturn({ ...ok, food: 5, hasFood: false }).reason, 'hungry');
        assert.equal(L.shouldReturn({ ...ok, food: 5, hasFood: true }).go, false, 'it eats');
        assert.equal(L.shouldReturn({ ...ok, elapsedMs: 1770000 }).reason, 'time');
        assert.equal(L.shouldReturn({ ...ok, elapsedMs: 1769999 }).go, false);
        assert.equal(L.shouldReturn({ ...ok, collected: 8 }).reason, 'done');
    });

    test('priorities: done, health, hungry, pickaxe, time, inventory full', () => {
        const all = { ...ok, collected: 8, health: 2, food: 0, hasFood: false, pickaxeUses: 1, elapsedMs: 2e6, freeSlots: 0 };
        assert.equal(L.shouldReturn(all).reason, 'done');
        assert.equal(L.shouldReturn({ ...all, collected: 0 }).reason, 'health');
        assert.equal(L.shouldReturn({ ...all, collected: 0, health: 20 }).reason, 'hungry');
        assert.equal(L.shouldReturn({ ...all, collected: 0, health: 20, food: 20 }).reason, 'pickaxe');
        assert.equal(L.shouldReturn({ ...all, collected: 0, health: 20, food: 20, pickaxeUses: 50 }).reason, 'time');
        assert.equal(L.shouldReturn({ ...all, collected: 0, health: 20, food: 20, pickaxeUses: 50, elapsedMs: 0 }).reason, 'inventory_full');
    });

    test('returnTimeMs grows with depth and tunnel', () => {
        assert.equal(L.returnTimeMs(0, 0), 15000);
        assert.equal(L.returnTimeMs(45, 20), 15000 + 27000 + 7000);
        assert.equal(L.returnTimeMs(-3, 'x'), 15000);
    });
});

describe('tripNeeds', () => {
    const inv = (...list) => list.map(([name, count, uses_left]) => ({ name, count, uses_left }));

    test('an empty inventory lacks everything; ladders are the depth plus 10 percent', () => {
        const r = L.tripNeeds('iron', 61, 16, []);
        assert.equal(r.depth, 45);
        assert.deepEqual(r.needs.find(n => n.name === 'ladder'), { name: 'ladder', count: 50 });
        assert.deepEqual(r.needs.find(n => n.name === 'pickaxe'), { name: 'pickaxe', material: 'stone', count: 1 });
        assert.deepEqual(r.missing.map(m => m.name).sort(), ['chest', 'cobblestone', 'food', 'ladder', 'pickaxe', 'torch']);
        assert.equal(r.missing.find(m => m.name === 'torch').count, 16);
        assert.equal(r.missing.find(m => m.name === 'cobblestone').count, 32);
        assert.equal(r.missing.find(m => m.name === 'food').count, 8);
        assert.equal(r.blocks, 45 + 24 + 64);
        assert.equal(r.pickaxe, null);
    });

    test('at least 8 ladders', () => {
        assert.equal(L.tripNeeds('coal', 61, 58, []).needs.find(n => n.name === 'ladder').count, 8);
        assert.equal(L.tripNeeds('coal', 61, 53, []).needs.find(n => n.name === 'ladder').count, 9);
    });

    test('a full inventory lacks nothing', () => {
        const r = L.tripNeeds('iron', 61, 16, inv(['iron_pickaxe', 1, 250], ['ladder', 64], ['torch', 20], ['cobblestone', 40],
            ['bread', 5], ['cooked_beef', 3], ['chest', 1]));
        assert.deepEqual(r.missing, []);
        assert.equal(r.pickaxe, 'iron_pickaxe');
    });

    test('food: from the food table of the game, or common foods', () => {
        const foods = { bread: { foodPoints: 5 }, rotten_flesh: { foodPoints: 4 } };
        const r = L.tripNeeds('iron', 61, 16, inv(['bread', 4], ['rotten_flesh', 10]), { foods });
        assert.equal(r.missing.find(m => m.name === 'food').count, 4, 'rotten flesh is no food for the bot');
        assert.equal(L.tripNeeds('iron', 61, 16, inv(['apple', 8])).missing.find(m => m.name === 'food'), undefined);
        assert.equal(L.tripNeeds('iron', 61, 16, inv(['apple', 8]), { foods: ['bread'] }).missing.find(m => m.name === 'food').count, 8);
    });

    test('a pickaxe too weak for the ore is missing; wooden is not enough for any trip', () => {
        const r = L.tripNeeds('diamond', 61, -59, inv(['stone_pickaxe', 1, 131]));
        assert.deepEqual(r.missing.find(m => m.name === 'pickaxe'), { name: 'pickaxe', material: 'iron', count: 1 });
        assert.equal(r.pickaxe, null);
        assert.equal(L.tripNeeds('coal', 61, 53, inv(['wooden_pickaxe', 1])).missing.find(m => m.name === 'pickaxe').material, 'stone');
    });

    test('a second pickaxe when the blocks are more than 80 percent of the uses left', () => {
        // 45 + 24 + 64 = 133 blocks; a stone pickaxe with 131 uses: 0.8 * 131 = 104.8
        const r = L.tripNeeds('iron', 61, 16, inv(['stone_pickaxe', 1, 131]));
        assert.equal(r.needs.find(n => n.name === 'pickaxe').count, 2);
        assert.deepEqual(r.missing.find(m => m.name === 'pickaxe'), { name: 'pickaxe', material: 'stone', count: 1, spare: true }, 'no sticks');
        const sticks = L.tripNeeds('iron', 61, 16, inv(['stone_pickaxe', 1, 131], ['stick', 2]));
        assert.equal(sticks.missing.find(m => m.name === 'pickaxe'), undefined, 'cobblestone comes with the trip');
        const log = L.tripNeeds('iron', 61, 16, inv(['stone_pickaxe', 1, 131], ['birch_log', 1]));
        assert.equal(log.missing.find(m => m.name === 'pickaxe'), undefined, 'a log gives planks and sticks');
        const noSticks = L.tripNeeds('gold', 61, -16, inv(['iron_pickaxe', 1, 100]));
        assert.deepEqual(noSticks.missing.find(m => m.name === 'pickaxe'), { name: 'pickaxe', material: 'iron', count: 1, spare: true });
        const withIron = L.tripNeeds('gold', 61, -16, inv(['iron_pickaxe', 1, 100], ['iron_ingot', 3], ['stick', 2]));
        assert.equal(withIron.missing.find(m => m.name === 'pickaxe'), undefined);
        const two = L.tripNeeds('gold', 61, -16, inv(['iron_pickaxe', 2, 100]));
        assert.equal(two.missing.find(m => m.name === 'pickaxe'), undefined, 'a stack of two');
        const planks = L.tripNeeds('gold', 61, -16, inv(['iron_pickaxe', 1, 100], ['iron_ingot', 3], ['oak_planks', 2]));
        assert.equal(planks.missing.find(m => m.name === 'pickaxe'), undefined);
        const fresh = L.tripNeeds('iron', 61, 16, inv(['iron_pickaxe', 1, 250]));
        assert.equal(fresh.needs.find(n => n.name === 'pickaxe').count, 1);
    });

    test('with a mine that exists: no ladders, no chest, fewer blocks', () => {
        const r = L.tripNeeds('iron', 61, 16, [], { shaftExists: true, tunnelLength: 10 });
        assert.equal(r.needs.find(n => n.name === 'ladder'), undefined);
        assert.equal(r.needs.find(n => n.name === 'chest'), undefined);
        assert.equal(r.blocks, 20);
    });

    test('pickaxes: uses and order', () => {
        assert.equal(L.pickaxeUses({ name: 'stone_pickaxe' }), 131);
        assert.equal(L.pickaxeUses({ name: 'stone_pickaxe', uses_left: 7 }), 7);
        assert.equal(L.pickaxeUses({ name: 'stick' }), null);
        const list = L.usablePickaxes(inv(['wooden_pickaxe', 1], ['stone_pickaxe', 1, 20], ['iron_pickaxe', 1, 5], ['stone_pickaxe', 1, 90]), 'stone');
        assert.deepEqual(list.map(p => `${p.name}:${p.uses}`), ['iron_pickaxe:5', 'stone_pickaxe:90', 'stone_pickaxe:20']);
        assert.deepEqual(L.usablePickaxes(null, 'stone'), []);
        assert.equal(L.tripNeeds('mithril', 61, 16, []).needs.find(n => n.name === 'pickaxe'), undefined);
        assert.equal(L.tripNeeds('iron', 'a', 16, []).depth, 0);
    });
});

describe('protected areas, the room and the entrance', () => {
    const house = { min: { x: 10, y: 60, z: 0 }, max: { x: 16, y: 65, z: 6 } };

    test('shaftAllowed keeps 8 blocks horizontally', () => {
        assert.equal(L.shaftAllowed({ x: 25, z: 3 }, [house]), true, 'the centre 25.5 is 8.5 from the side of the box at 17');
        assert.equal(L.shaftAllowed({ x: 24, z: 3 }, [house]), false, '7.5 from it');
        assert.equal(L.shaftAllowed({ x: 3, z: 3 }, [house]), false);
        assert.equal(L.shaftAllowed({ x: 13, z: 3 }, []), true);
        assert.equal(L.shaftAllowed({ x: 13, z: 3 }, [{ bogus: 1 }]), true);
    });

    test('tunnelAllowed: under an area only 16 below its lowest block', () => {
        assert.equal(L.tunnelAllowed({ x: 13, y: 44, z: 3 }, [house]), true);
        assert.equal(L.tunnelAllowed({ x: 13, y: 45, z: 3 }, [house]), false);
        assert.equal(L.tunnelAllowed({ x: 40, y: 60, z: 3 }, [house]), true);
    });

    test('roomPlan: 3 x 3 x 3 around the shaft, towards the direction', () => {
        const p = L.roomPlan({ x: 0, y: 16, z: 0 }, 'north');
        assert.equal(p.all.length, 27);
        assert.equal(p.cells.length, 24);
        assert.ok(p.cells.every(c => !(c.x === 0 && c.z === 0)));
        const xs = new Set(p.all.map(c => c.x));
        const zs = new Set(p.all.map(c => c.z));
        const ys = new Set(p.all.map(c => c.y));
        assert.deepEqual([...xs].sort((a, b) => a - b), [-1, 0, 1]);
        assert.deepEqual([...zs].sort((a, b) => a - b), [-2, -1, 0]);
        assert.deepEqual([...ys].sort((a, b) => a - b), [16, 17, 18]);
        assert.equal(p.cells[0].y, 18, 'top layer first');
        assert.deepEqual(p.chest, { x: -1, y: 16, z: 0 });
        assert.deepEqual(p.chest2, { x: -1, y: 16, z: -1 });
        assert.deepEqual(p.torch, { x: 1, y: 16, z: 0 });
        assert.deepEqual(p.front, { x: 0, y: 16, z: -2 });
    });

    test('chooseDirection leads away from an area', () => {
        const area = { min: { x: 30, y: 60, z: -5 }, max: { x: 40, y: 70, z: 5 } };
        assert.equal(L.chooseDirection({ x: 20, z: 0 }, 50, [area]), 'west');
        assert.equal(L.chooseDirection({ x: 20, z: 0 }, 50, []), 'north');
        assert.equal(L.chooseDirection({ x: 20, z: 0 }, 50, [], { prefer: 'south' }), 'south');
        assert.equal(L.chooseDirection({ x: 20, z: 0 }, 40, [area]), 'west', 'deep enough to pass under it, still away first');
        assert.deepEqual(L.mineDirections({ x: 20, z: 0 }, 40, [area]), ['west', 'north', 'east', 'south']);
        assert.deepEqual(L.mineDirections({ x: 20, z: 0 }, 50, [area]), ['west', 'north', 'south']);
        const around = [{ min: { x: 0, y: 40, z: -30 }, max: { x: 40, y: 70, z: -12 } }, { min: { x: 0, y: 40, z: 12 }, max: { x: 40, y: 70, z: 30 } },
            { min: { x: 28, y: 40, z: -12 }, max: { x: 40, y: 70, z: 12 } }, { min: { x: 0, y: 40, z: -12 }, max: { x: 12, y: 70, z: 12 } }];
        assert.equal(L.chooseDirection({ x: 20, z: 0 }, 50, around), null);
    });

    test('chooseEntrance: flat ground, no area: where the bot stands', () => {
        const ground = () => ({ y: 60, name: 'grass_block' });
        const e = L.chooseEntrance({ bot: { x: 5.5, y: 61, z: 5.5 }, level: 16, areas: [], ground });
        assert.deepEqual(e, { x: 5, y: 61, z: 5, dir: 'north' });
    });

    test('chooseEntrance: a house 5 blocks from the bot: at least 8 blocks from it', () => {
        const ground = () => ({ y: 60, name: 'grass_block' });
        const bot = { x: 21.5, y: 61, z: 3.5 };
        const e = L.chooseEntrance({ bot, level: 16, areas: [house], ground });
        assert.ok(e);
        assert.ok(L.shaftAllowed(e, [house]));
        const back = L.offset(e, L.backOf(e.dir));
        assert.ok(L.shaftAllowed(back, [house]), 'the place behind the shaft too');
        assert.ok(Math.hypot(e.x - 21, e.z - 3) <= 48);
        assert.ok(e.x - 16 >= 8, `x ${e.x}`);
        assert.deepEqual(e, { x: 25, y: 61, z: 3, dir: 'south' }, 'east first, but the place behind the shaft would be 7.5 from the house');
        const shallow = L.chooseEntrance({ bot, level: 50, areas: [house], ground });
        assert.notEqual(shallow.dir, 'west', 'at level 50 the tunnel may not lead under the house');
    });

    test('chooseEntrance: water, lava, gravel and unknown ground are no place; nothing within range', () => {
        const water = () => ({ y: 60, name: 'water' });
        assert.equal(L.chooseEntrance({ bot: { x: 0, y: 61, z: 0 }, level: 16, ground: water, range: 3 }), null);
        const mixed = (x, z) => (x === 2 && z === 0 ? { y: 60, name: 'stone' } : x === 2 && z === 1 ? { y: 60, name: 'dirt' } : null);
        assert.deepEqual(L.chooseEntrance({ bot: { x: 0, y: 61, z: 0 }, level: 16, ground: mixed, range: 5 }), { x: 2, y: 61, z: 0, dir: 'north' },
            'the ladders hang on the wall south of the shaft, where the bot can stand');
        const mixed2 = (x, z) => (x === 2 && z === 0 ? { y: 60, name: 'stone' } : x === 1 && z === 0 ? { y: 60, name: 'dirt' } : null);
        assert.deepEqual(L.chooseEntrance({ bot: { x: 0, y: 61, z: 0 }, level: 16, ground: mixed2, range: 5 }), { x: 1, y: 61, z: 0, dir: 'west' },
            'another direction when the place behind the first one is no ground');
        const gravel = () => ({ y: 60, name: 'gravel' });
        assert.equal(L.chooseEntrance({ bot: { x: 0, y: 61, z: 0 }, level: 16, ground: gravel, range: 2 }), null);
        const boom = () => { throw new Error('x'); };
        assert.equal(L.chooseEntrance({ bot: { x: 0, y: 61, z: 0 }, level: 16, ground: boom, range: 2 }), null);
        assert.equal(L.chooseEntrance({ bot: null, level: 16, ground: water }), null);
        assert.equal(L.chooseEntrance({ bot: { x: 0, y: 61, z: 0 }, level: 'a', ground: water }), null);
    });

    test('chooseEntrance: a place where feet or head are not free is skipped; a step in the ground too', () => {
        const ground = (x, z) => ({ y: x === 0 && z === 1 ? 61 : 60, name: 'grass_block' });
        const free = (x, y, z) => !(x === 0 && z === 0);
        const e = L.chooseEntrance({ bot: { x: 0, y: 61, z: 0 }, level: 16, ground, free, range: 4 });
        assert.ok(e);
        assert.ok(!(e.x === 0 && e.z === 0));
        const back = L.offset(e, L.backOf(e.dir));
        assert.ok(!(back.x === 0 && back.z === 1), 'the place behind has the same height');
    });

    test('chooseEntrance keeps 4 blocks from the columns of other mines', () => {
        const ground = () => ({ y: 60, name: 'grass_block' });
        const e = L.chooseEntrance({ bot: { x: 0, y: 61, z: 0 }, level: 16, ground, avoid: [{ x: 0, z: 0 }, null, { x: 'a' }] });
        assert.ok(Math.hypot(e.x, e.z) >= 4);
        const back = L.offset(e, L.backOf(e.dir));
        assert.ok(Math.hypot(back.x, back.z) >= 4);
    });

    test('faceNeighbours', () => {
        assert.equal(L.faceNeighbours({ x: 0, y: 0, z: 0 }).length, 6);
        assert.equal(L.posKey({ x: 1, y: 2, z: 3 }), '1,2,3');
    });
});
