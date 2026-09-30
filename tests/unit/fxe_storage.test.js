// Fix round of v0.1.4.8, defect X8 (part E): !storeItems used at most the 12 nearest chests and then said
// "The chests are full now" while 12 more chests with free slots stood within 3 blocks (world test w32,
// part C). The limit is 27 containers within the range, the nearest first; "The chests are full now" is
// said only when every chest within the range was tried, otherwise the text names the number:
// "I tried the 27 nearest chests. I still carry ...". A fake bot with fake containers, like
// storage_actions.test.js.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';

const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
const REGISTRY = require('prismarine-registry')('1.21.8');

const S = await loadSrc('src/agent/packs/storage/storage.js');
const T = await loadSrc('src/agent/packs/storage/texts.js');
const { ChestIndex } = await loadSrc('src/agent/packs/storage/chest_index.js');

const key = (x, y, z) => `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;

function makeItem(name, count, slot = null) {
    const entry = REGISTRY.itemsByName[name];
    return { name, count, type: entry.id, stackSize: entry.stackSize, slot };
}

// A world of containers on stone (y 63 and below), air above.
function makeWorld() {
    const blocks = new Map();
    const containers = new Map();
    const world = {
        blocks,
        containers,
        nameAt(x, y, z) {
            const k = key(x, y, z);
            if (blocks.has(k)) return blocks.get(k).name;
            return y <= 63 ? 'stone' : 'air';
        },
        block(x, y, z) {
            const name = world.nameAt(x, y, z);
            const reg = REGISTRY.blocksByName[name];
            const props = blocks.get(key(x, y, z))?.props ?? {};
            return {
                name, type: reg?.id ?? 0, position: new Vec3(Math.floor(x), Math.floor(y), Math.floor(z)),
                boundingBox: name === 'air' ? 'empty' : 'block', transparent: reg?.transparent === true,
                getProperties() { return { ...props }; },
            };
        },
        // A single chest, full of stone but for `free` empty slots.
        chest(x, y, z, free = 27) {
            blocks.set(key(x, y, z), { name: 'chest', props: { facing: 'north', type: 'single' } });
            const slots = new Array(27).fill(null);
            for (let i = 0; i < 27 - free; i++) slots[i] = makeItem('stone', 64, i);
            const box = { slots };
            containers.set(key(x, y, z), box);
            return box;
        },
    };
    return world;
}

function move(slots, type, count, src, dst) {
    let left = count;
    for (let s = src[0]; s < src[1] && left > 0; s++) {
        const from = slots[s];
        if (!from || from.type !== type) continue;
        while (from.count > 0 && left > 0) {
            let target = null;
            for (let d = dst[0]; d < dst[1]; d++) {
                const it = slots[d];
                if (it && it.type === type && it.count < it.stackSize) { target = d; break; }
            }
            if (target === null) for (let d = dst[0]; d < dst[1]; d++) if (!slots[d]) { target = d; break; }
            if (target === null) throw new Error('destination full');
            if (!slots[target]) slots[target] = { ...from, count: 0, slot: target };
            const n = Math.min(left, from.count, slots[target].stackSize - slots[target].count);
            slots[target].count += n;
            from.count -= n;
            left -= n;
        }
        if (from.count === 0) slots[s] = null;
    }
}

function makeBot(world, { pos = [0.5, 64, 0.5], items = [] } = {}) {
    const bot = { world, calls: [], windows: [], interrupt_code: false, registry: REGISTRY };
    bot.entity = { position: new Vec3(...pos), velocity: new Vec3(0, 0, 0), onGround: true, height: 1.8 };
    bot.game = { dimension: 'minecraft:overworld' };
    const slots = new Array(46).fill(null);
    items.forEach(([name, count], i) => { slots[9 + i] = makeItem(name, count, 9 + i); });
    bot.inventory = { inventoryStart: 9, inventoryEnd: 45, slots, items() { return this.slots.slice(9, 45).filter(Boolean); } };
    bot.blockAt = (p) => world.block(p.x, p.y, p.z);
    bot.findBlocks = ({ matching, maxDistance = 16, count = 1 }) => {
        const origin = bot.entity.position.floored();
        const found = [];
        for (const k of world.blocks.keys()) {
            const [x, y, z] = k.split(',').map(Number);
            const p = new Vec3(x, y, z);
            if (p.distanceTo(origin) <= maxDistance && matching(REGISTRY.blocksByName[world.nameAt(x, y, z)])) found.push(p);
        }
        found.sort((a, b) => a.distanceTo(origin) - b.distanceTo(origin));
        return found.slice(0, count);
    };
    bot.pathfinder = {
        setMovements() {},
        setGoal() {},
        async goto(goal) {
            bot.calls.push(['goto', goal.x, goal.y, goal.z]);
            await Promise.resolve();
            bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 1.5);
        },
    };
    bot.clearControlStates = () => {};
    bot.openContainer = async (block) => {
        const p = block.position;
        bot.calls.push(['open', p.x, p.y, p.z]);
        await Promise.resolve();
        const box = world.containers.get(key(p.x, p.y, p.z));
        const size = box.slots.length;
        const wslots = [...box.slots.map((it, i) => (it ? { ...it, slot: i } : null)), ...bot.inventory.slots.slice(9, 45).map((it, i) => (it ? { ...it, slot: size + i } : null))];
        const window = {
            slots: wslots, inventoryStart: size, inventoryEnd: size + 36, closed: false,
            async deposit(type, metadata, count) { await Promise.resolve(); move(wslots, type, count, [size, size + 36], [0, size]); },
            async withdraw(type, metadata, count) { await Promise.resolve(); move(wslots, type, count, [0, size], [size, size + 36]); },
            close() {
                window.closed = true;
                for (let i = 0; i < size; i++) box.slots[i] = wslots[i] ? { ...wslots[i], slot: i } : null;
                for (let i = 0; i < 36; i++) bot.inventory.slots[9 + i] = wslots[size + i] ? { ...wslots[size + i], slot: 9 + i } : null;
            },
        };
        bot.windows.push(window);
        return window;
    };
    bot.transfer = async ({ window, itemType, count, sourceStart, sourceEnd, destStart, destEnd }) => {
        await Promise.resolve();
        move(window.slots, itemType, count, [sourceStart, sourceEnd], [destStart, destEnd]);
    };
    return bot;
}

const count = (bot, name) => bot.inventory.items().filter(i => i.name === name).reduce((s, i) => s + i.count, 0);
const boxCount = (box, name) => box.slots.filter(Boolean).filter(i => i.name === name).reduce((s, i) => s + i.count, 0);
const opened = (bot) => new Set(bot.calls.filter(c => c[0] === 'open').map(c => key(c[1], c[2], c[3])));

let clockMs = 0;
const fastClock = () => ({ now: () => clockMs, wait: async (ms) => { clockMs += ms; await Promise.resolve(); } });
const makeCtx = () => ({ chests: new ChestIndex(null, { now: () => new Date(Date.UTC(2026, 8, 30)) }), settings: {}, log() {} });

let cap;
beforeEach(() => { cap = captureConsole(); clockMs = 0; });
afterEach(() => { cap.restore(); });

describe('X8: storeItems uses up to 27 containers within the range, the nearest first', () => {
    test('the limit is 27 for storeItems; lookIntoChests keeps its 12', () => {
        assert.equal(S.STORE_LIMIT, 27);
        assert.equal(S.LOOK_LIMIT, 12);
    });

    test('w32 part C: 24 chests around the bot with one free slot each take all 24 stacks of dirt', async () => {
        const world = makeWorld();
        const boxes = [];
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (dx || dz) boxes.push(world.chest(dx, 64, dz, 1));
        const bot = makeBot(world, { items: new Array(24).fill(['dirt', 64]) });
        const res = await S.storeItems(bot, makeCtx(), fastClock());
        assert.equal(res.ok, true, res.text);
        assert.equal(res.text, 'I stored 1536 dirt in 24 chests.');
        assert.equal(count(bot, 'dirt'), 0);
        assert.ok(boxes.every(b => boxCount(b, 'dirt') === 64), 'every chest got one stack');
    });

    test('more than 27 containers, all full: the text names the 27 nearest it tried, the farther ones are never opened', async () => {
        const world = makeWorld();
        for (let x = 1; x <= 30; x++) world.chest(x, 64, 0, 0);
        const bot = makeBot(world, { items: [['dirt', 64]] });
        const res = await S.storeItems(bot, makeCtx(), fastClock());
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'full');
        assert.equal(res.text, 'I tried the 27 nearest chests. I still carry 64 dirt.');
        const seen = opened(bot);
        assert.equal(seen.size, 27);
        for (const x of [28, 29, 30]) assert.equal(seen.has(key(x, 64, 0)), false, `the chest at x ${x} is not one of the 27 nearest`);
    });

    test('some stored, the limit reached: "I stored ... I tried the 27 nearest chests. I still carry ..."', async () => {
        const world = makeWorld();
        for (let x = 1; x <= 29; x++) world.chest(x, 64, 0, x <= 2 ? 1 : 0);
        const bot = makeBot(world, { items: [['dirt', 64], ['dirt', 64], ['dirt', 64]] });
        const res = await S.storeItems(bot, makeCtx(), fastClock());
        assert.equal(res.reason, 'full');
        assert.equal(res.text, 'I stored 128 dirt in 2 chests. I tried the 27 nearest chests. I still carry 64 dirt.');
    });

    test('every container within the range tried and full: "The chests are full now" stays as before', async () => {
        const world = makeWorld();
        for (let x = 1; x <= 20; x++) world.chest(x, 64, 0, x === 1 ? 1 : 0);
        const bot = makeBot(world, { items: [['dirt', 64], ['dirt', 64]] });
        const res = await S.storeItems(bot, makeCtx(), fastClock());
        assert.equal(res.text, 'I stored 64 dirt in the chest at (1, 64, 0). The chests are full now, I still carry 64 dirt.');
        assert.equal(opened(bot).size, 20, 'all 20 were looked into');
        const none = makeWorld();
        for (let x = 1; x <= 5; x++) none.chest(x, 64, 0, 0);
        const bot2 = makeBot(none, { items: [['dirt', 12]] });
        assert.equal((await S.storeItems(bot2, makeCtx(), fastClock())).text, 'All chests nearby are full. I still carry 12 dirt.');
    });

    test('known chests of the index count among the 27 nearest; a known far chest does not push out a near one', async () => {
        const world = makeWorld();
        for (let x = 1; x <= 28; x++) world.chest(x, 64, 0, 0);
        const ctx = makeCtx();
        // the index knows the farthest chest as having room (an old reading); it is the 28th nearest
        ctx.chests.update({ x: 28, y: 64, z: 0, dimension: 'overworld', kind: 'chest', items: {}, free_slots: 27 });
        const bot = makeBot(world, { items: [['dirt', 64]] });
        const res = await S.storeItems(bot, ctx, fastClock());
        assert.equal(res.text, 'I tried the 27 nearest chests. I still carry 64 dirt.');
        assert.equal(opened(bot).has(key(28, 64, 0)), false);
    });

    test('storeText: the number of chests tried when the limit ended the search', () => {
        assert.equal(T.storeText({ stored: {}, left: { dirt: 768 }, chests: [], reason: 'full', tried: 27 }),
            'I tried the 27 nearest chests. I still carry 768 dirt.');
        assert.equal(T.storeText({ stored: { dirt: 768 }, left: { dirt: 768 }, chests: new Array(12).fill({ x: 0, y: 0, z: 0 }), reason: 'full', tried: 27 }),
            'I stored 768 dirt in 12 chests. I tried the 27 nearest chests. I still carry 768 dirt.');
        assert.equal(T.storeText({ stored: { dirt: 40 }, left: { dirt: 24 }, chests: [{ x: 1, y: 12, z: 5 }], reason: 'full' }),
            'I stored 40 dirt in the chest at (1, 12, 5). The chests are full now, I still carry 24 dirt.');
        assert.equal(T.storeText({ stored: {}, left: { dirt: 1 }, chests: [], reason: 'full', tried: null }), 'All chests nearby are full. I still carry 1 dirt.');
    });
});
