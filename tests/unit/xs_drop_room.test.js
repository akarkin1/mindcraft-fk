// v0.1.4.15 round 1, the gate's finding G-1 on W118 full_bag (E4): a flint from the seeded gravel filled the bag a moment
// after mineVeins had found room for the first ore block of the vein beyond; its raw_iron lay on the second ore block where
// the full bag could not take it, and collectDrops with `dig: true` let the pathfinder dig the ceiling to stand in the item's
// cell. The next view read the hole as a gap it could not close, the tunnel went 3 blocks to the side through stone, and
// the bag filled with the 3 kept cobblestone: "My bag is full of things I keep for the mining. I stop the mining at 1 of 6
// iron." The rule: collectDrops never digs a way to a drop the bag cannot take (no free slot and no stack of its kind with
// room); the drop stays and is picked up when room is back.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeMiningBot, makeClock, give, v } from './mining_fake_bot.test.js';

const D = await loadSrc('src/agent/packs/mining/dig.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

// 36 full stacks of torches: no free slot, no stack with room
function fillBag(bot, stacks = 36) {
    for (let i = 0; i < stacks; i++) {
        give(bot, 'torch', 64);
    }
}

// The fake bot on the ground; a raw_iron item on a stone block 3 cells east, with stone over its head: the cell cannot be
// stood in without digging, and the fake picks nothing up from there (it picks up within 1.3 blocks only).
function scene() {
    const world = makeWorld();
    world.set(3, 64, 0, 'stone');
    world.set(3, 66, 0, 'stone');
    const bot = makeMiningBot({ world, pos: [0.5, 64, 0.5] });
    const clock = makeClock(bot);
    bot.entities[500] = { id: 500, name: 'item', item: 'raw_iron', count: 1, position: v(3.5, 65, 0.5) };
    // every walk of the pathfinder, with whether its movements may dig
    const walks = [];
    const goto = bot.pathfinder.goto.bind(bot.pathfinder);
    bot.pathfinder.goto = async function (goal) {
        walks.push(this.movements?.canDig === true);
        return goto(goal);
    };
    return { world, bot, clock, walks };
}

describe('roomForDrop: can the bag take a dropped item', () => {
    test('a free slot takes anything; a full bag takes only a kind with a stack that has room', () => {
        const bot = makeMiningBot({ world: makeWorld() });
        const drop = { id: 1, name: 'item', item: 'raw_iron', count: 1, position: v(0.5, 64, 0.5) };
        assert.equal(D.roomForDrop(bot, drop), true, 'an empty bag');
        fillBag(bot, 35);
        assert.equal(D.roomForDrop(bot, drop), true, 'one free slot');
        give(bot, 'raw_iron', 5);
        assert.equal(D.freeSlots(bot), 0);
        assert.equal(D.roomForDrop(bot, drop), true, 'full, but the raw_iron stack has room');
        assert.equal(D.roomForDrop(bot, { ...drop, item: 'flint' }), false, 'full, no flint stack');
        assert.equal(D.roomForDrop(bot, { ...drop, item: 'torch' }), false, 'full, every torch stack is full');
    });

    test('the item of the real entity (getDroppedItem) and of the fake (item); a drop of unknown kind fits only a free slot', () => {
        const bot = makeMiningBot({ world: makeWorld() });
        fillBag(bot, 35);
        give(bot, 'raw_iron', 5);
        const real = { id: 2, name: 'item', position: v(0.5, 64, 0.5), getDroppedItem: () => ({ name: 'raw_iron', count: 1 }) };
        assert.equal(D.roomForDrop(bot, real), true);
        assert.equal(D.roomForDrop(bot, { ...real, getDroppedItem: () => ({ name: 'gravel', count: 1 }) }), false);
        assert.equal(D.roomForDrop(bot, { ...real, getDroppedItem: () => { throw new Error('no metadata'); } }), false, 'a throwing entity: no room assumed');
        assert.equal(D.roomForDrop(bot, { id: 3, name: 'item', position: v(0.5, 64, 0.5) }), false, 'no kind, no free slot');
        const roomy = makeMiningBot({ world: makeWorld() });
        assert.equal(D.roomForDrop(roomy, { id: 3, name: 'item', position: v(0.5, 64, 0.5) }), true, 'no kind, a free slot');
        assert.equal(D.roomForDrop(null, real), false, 'no bot');
    });
});

describe('collectDrops with dig: true digs no way to a drop the bag cannot take', () => {
    test('the full bag of W118: the walk without digging is tried, the digging walk is not, the drop stays', async () => {
        const { bot, clock, walks } = scene();
        fillBag(bot);
        assert.equal(D.freeSlots(bot), 0);
        const r = await D.collectDrops(bot, { x: 0, y: 64, z: 0 }, { clock, radius: 6, timeoutMs: 20000, dig: true });
        assert.deepEqual(walks, [false], 'one walk, with movements that do not dig');
        assert.equal(r.ok, false, 'the drop is still there');
        assert.equal(r.visited, 1);
        assert.ok(bot.entities[500], 'the item lies where it was');
        assert.equal(bot.world.nameAt(3, 66, 0), 'stone', 'nothing dug');
    });

    test('with a free slot the digging walk follows the failed plain walk, as before', async () => {
        const { bot, clock, walks } = scene();
        fillBag(bot, 35);
        await D.collectDrops(bot, { x: 0, y: 64, z: 0 }, { clock, radius: 6, timeoutMs: 20000, dig: true });
        assert.deepEqual(walks, [false, true]);
    });

    test('with a full bag and a raw_iron stack with room the digging walk follows too', async () => {
        const { bot, clock, walks } = scene();
        fillBag(bot, 35);
        give(bot, 'raw_iron', 5);
        assert.equal(D.freeSlots(bot), 0);
        await D.collectDrops(bot, { x: 0, y: 64, z: 0 }, { clock, radius: 6, timeoutMs: 20000, dig: true });
        assert.deepEqual(walks, [false, true]);
    });

    test('without dig: true nothing changes: one plain walk, whatever the bag holds', async () => {
        const { bot, clock, walks } = scene();
        await D.collectDrops(bot, { x: 0, y: 64, z: 0 }, { clock, radius: 6, timeoutMs: 20000 });
        assert.deepEqual(walks, [false]);
    });

    test('a drop the bot can reach is picked up as before, full bag or not (the fake gives it when the bot stands by it)', async () => {
        const world = makeWorld();
        const bot = makeMiningBot({ world, pos: [0.5, 64, 0.5] });
        const clock = makeClock(bot);
        bot.entities[501] = { id: 501, name: 'item', item: 'raw_iron', count: 2, position: v(3.5, 64, 2.5) };
        const r = await D.collectDrops(bot, { x: 0, y: 64, z: 0 }, { clock, radius: 6, dig: true });
        assert.equal(r.ok, true);
        assert.equal(bot.inventory.items().find(i => i.name === 'raw_iron')?.count, 2);
    });
});
