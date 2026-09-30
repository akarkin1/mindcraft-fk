// Spec v0.1.4.7 S3: src/agent/packs/storage/storage.js (lookIntoChests, storeItems, fetchItem,
// chestsText) and bindStorage of index.js, on a fake bot with fake containers. The fake window
// works like mineflayer's: the container slots come first, then the 36 slots of the inventory, and
// bot.inventory is written back when the window closes.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';

const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
const REGISTRY = require('prismarine-registry')('1.21.8');

const S = await loadSrc('src/agent/packs/storage/storage.js');
const P = await loadSrc('src/agent/packs/storage/index.js');
const { ChestIndex } = await loadSrc('src/agent/packs/storage/chest_index.js');

const key = (x, y, z) => `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;

function makeItem(name, count, slot = null, usesLeft = null) {
    const entry = REGISTRY.itemsByName[name];
    assert.ok(entry, `unknown item ${name}`);
    const item = { name, count, type: entry.id, stackSize: entry.stackSize, slot };
    if (usesLeft !== null) {
        item.maxDurability = entry.maxDurability;
        item.durabilityUsed = entry.maxDurability - usesLeft;
    }
    return item;
}

function copyItem(item, slot) {
    return item ? { ...item, slot } : null;
}

// ---- the world -------------------------------------------------------------------------------

function makeWorld() {
    const blocks = new Map();
    const containers = new Map();
    const world = {
        blocks,
        containers,
        unloaded: new Set(),
        nameAt(x, y, z) {
            const k = key(x, y, z);
            if (blocks.has(k)) return blocks.get(k).name;
            return y <= 63 ? 'stone' : 'air';
        },
        set(x, y, z, name, props = {}) {
            blocks.set(key(x, y, z), { name, props });
        },
        block(x, y, z) {
            if (world.unloaded.has(key(x, y, z))) return null;
            const name = world.nameAt(x, y, z);
            const reg = REGISTRY.blocksByName[name];
            const props = blocks.get(key(x, y, z))?.props ?? {};
            return {
                name,
                type: reg?.id ?? 0,
                position: new Vec3(Math.floor(x), Math.floor(y), Math.floor(z)),
                boundingBox: name === 'air' ? 'empty' : 'block',
                transparent: reg?.transparent === true,
                getProperties() { return { ...props }; },
            };
        },
        // A container with its content: items is a list of [name, count]; one stack per slot.
        container(x, y, z, { kind = 'chest', size = 27, items = [], props = { facing: 'north', type: 'single' } } = {}) {
            world.set(x, y, z, kind, kind === 'barrel' ? { facing: 'up', open: false } : props);
            const slots = new Array(size).fill(null);
            items.forEach(([name, count], i) => { slots[i] = makeItem(name, count, i); });
            const box = { slots };
            containers.set(key(x, y, z), box);
            return box;
        },
        // A double chest facing north: the left half at (x, y, z), the right half at (x + 1, y, z).
        doubleChest(x, y, z, items = []) {
            const box = world.container(x, y, z, { size: 54, items, props: { facing: 'north', type: 'left' } });
            world.set(x + 1, y, z, 'chest', { facing: 'north', type: 'right' });
            containers.set(key(x + 1, y, z), box);
            return box;
        },
        fillWith(box, name, count = null) {
            for (let i = 0; i < box.slots.length; i++) {
                if (!box.slots[i]) box.slots[i] = makeItem(name, count ?? REGISTRY.itemsByName[name].stackSize, i);
            }
        },
    };
    return world;
}

// Moves up to `count` items of a type from the source range to the destination range, first onto
// stacks of the same item, then into empty slots, like mineflayer's transfer.
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
            if (target === null) {
                for (let d = dst[0]; d < dst[1]; d++) {
                    if (!slots[d]) { target = d; break; }
                }
            }
            if (target === null) throw new Error('destination full');
            if (!slots[target]) {
                slots[target] = { ...from, count: 0, slot: target };
            }
            const n = Math.min(left, from.count, slots[target].stackSize - slots[target].count);
            slots[target].count += n;
            from.count -= n;
            left -= n;
        }
        if (from.count === 0) slots[s] = null;
    }
    if (left > 0 && left === count) throw new Error(`Can't find item ${type}`);
}

// ---- the bot --------------------------------------------------------------------------------

function makeBot(world, { pos = [0.5, 64, 0.5], items = [] } = {}) {
    const bot = {};
    bot.world = world;
    bot.calls = [];
    bot.unreachable = new Set();
    bot.hangOpen = new Set();
    bot.failOpen = new Set();
    bot.windows = [];
    bot.entity = { position: new Vec3(...pos), velocity: new Vec3(0, 0, 0), onGround: true, height: 1.8 };
    bot.game = { dimension: 'minecraft:overworld' };
    bot.registry = REGISTRY;
    bot.interrupt_code = false;
    const slots = new Array(46).fill(null);
    items.forEach(([name, count, usesLeft = null], i) => { slots[9 + i] = makeItem(name, count, 9 + i, usesLeft); });
    bot.inventory = {
        inventoryStart: 9,
        inventoryEnd: 45,
        slots,
        items() { return this.slots.slice(9, 45).filter(Boolean); },
        emptySlotCount() { return this.slots.slice(9, 45).filter(s => !s).length; },
    };
    bot.blockAt = (p) => world.block(p.x, p.y, p.z);
    bot.findBlocks = ({ matching, maxDistance = 16, count = 1 }) => {
        const origin = bot.entity.position.floored();
        const found = [];
        for (const k of world.blocks.keys()) {
            const [x, y, z] = k.split(',').map(Number);
            const p = new Vec3(x, y, z);
            if (p.distanceTo(origin) > maxDistance) continue;
            if (matching(REGISTRY.blocksByName[world.nameAt(x, y, z)])) found.push(p);
        }
        found.sort((a, b) => a.distanceTo(origin) - b.distanceTo(origin));
        return found.slice(0, count);
    };
    bot.pathfinder = {
        setMovements(m) { this.movements = m; },
        setGoal() {},
        async goto(goal) {
            bot.calls.push(['goto', goal.x, goal.y, goal.z]);
            await Promise.resolve();
            if (bot.unreachable.has(key(goal.x, goal.y, goal.z))) {
                const err = new Error('No path to the goal!');
                err.name = 'NoPath';
                throw err;
            }
            bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 1.5);
        },
    };
    bot.clearControlStates = () => {};
    bot.openContainer = async (block) => {
        const p = block.position;
        const k = key(p.x, p.y, p.z);
        bot.calls.push(['open', p.x, p.y, p.z]);
        if (bot.hangOpen.has(k)) return new Promise(resolve => { bot.resolveLate = () => resolve(openWindow(bot, world.containers.get(k))); });
        await Promise.resolve();
        if (bot.failOpen.has(k)) throw new Error('cannot open');
        const box = world.containers.get(k);
        assert.ok(box, `no container at ${k}`);
        return openWindow(bot, box);
    };
    bot.transfer = async ({ window, itemType, count, sourceStart, sourceEnd, destStart, destEnd }) => {
        await Promise.resolve();
        bot.calls.push(['transfer', sourceStart]);
        move(window.slots, itemType, count, [sourceStart, sourceEnd], [destStart, destEnd]);
    };
    return bot;
}

function openWindow(bot, box) {
    const size = box.slots.length;
    const slots = [...box.slots.map((it, i) => copyItem(it, i)), ...bot.inventory.slots.slice(9, 45).map((it, i) => copyItem(it, size + i))];
    const window = {
        type: size === 54 ? 'minecraft:generic_9x6' : 'minecraft:generic_9x3',
        slots,
        inventoryStart: size,
        inventoryEnd: size + 36,
        closed: false,
        containerItems() { return slots.slice(0, size).filter(Boolean); },
        async deposit(type, metadata, count) {
            await Promise.resolve();
            bot.calls.push(['deposit', REGISTRY.items[type].name, count]);
            move(slots, type, count, [size, size + 36], [0, size]);
        },
        async withdraw(type, metadata, count) {
            await Promise.resolve();
            bot.calls.push(['withdraw', REGISTRY.items[type].name, count]);
            if (bot.inventory.emptySlotCount() === 0) throw new Error('Unable to withdraw, Bot inventory is full.');
            move(slots, type, count, [0, size], [size, size + 36]);
        },
        close() {
            window.closed = true;
            bot.calls.push(['close']);
            for (let i = 0; i < size; i++) box.slots[i] = copyItem(slots[i], i);
            for (let i = 0; i < 36; i++) bot.inventory.slots[9 + i] = copyItem(slots[size + i], 9 + i);
        },
    };
    bot.windows.push(window);
    return window;
}

// ---- helpers --------------------------------------------------------------------------------

function inventoryCounts(bot) {
    const out = {};
    for (const it of bot.inventory.items()) out[it.name] = (out[it.name] ?? 0) + it.count;
    return out;
}

function boxCounts(box) {
    const out = {};
    for (const it of box.slots) if (it) out[it.name] = (out[it.name] ?? 0) + it.count;
    return out;
}

let clockMs = 0;
const fastClock = () => ({ now: () => clockMs, wait: async (ms) => { clockMs += ms; await Promise.resolve(); } });

function makeCtx(extra = {}) {
    return { chests: new ChestIndex(null, { now: () => new Date(Date.UTC(2026, 8, 28)) }), settings: {}, logs: [], log(t) { this.logs.push(t); }, ...extra };
}

let cap;
beforeEach(() => {
    cap = captureConsole();
    clockMs = 0;
});
afterEach(() => {
    cap.restore();
});

const HAUL = [['stone_pickaxe', 1, 100], ['bread', 8], ['torch', 20], ['dirt', 20], ['wheat', 12]];

// ---- storeItems -----------------------------------------------------------------------------

describe('storeItems', () => {
    test('stores by the keep plan and updates the index from the open chest', async () => {
        const world = makeWorld();
        const box = world.container(3, 64, 0);
        const bot = makeBot(world, { items: HAUL });
        const ctx = makeCtx();
        const res = await S.storeItems(bot, ctx, fastClock());
        assert.equal(res.text, 'I stored 20 dirt, 12 wheat in the chest at (3, 64, 0).');
        assert.equal(res.ok, true);
        assert.equal(res.reason, null);
        assert.deepEqual(res.stored, { dirt: 20, wheat: 12 });
        assert.deepEqual(res.left, {});
        assert.deepEqual(res.chests.map(c => [c.x, c.y, c.z]), [[3, 64, 0]]);
        assert.deepEqual(boxCounts(box), { dirt: 20, wheat: 12 });
        assert.deepEqual(inventoryCounts(bot), { stone_pickaxe: 1, bread: 8, torch: 20 });
        const indexed = ctx.chests.get({ x: 3, y: 64, z: 0 });
        assert.deepEqual(indexed.items, { dirt: 20, wheat: 12 });
        assert.equal(indexed.free_slots, 25);
        assert.equal(indexed.kind, 'chest');
        assert.equal(indexed.dimension, 'overworld');
        assert.ok(bot.windows.every(w => w.closed));
        assert.deepEqual(ctx.logs, [res.text]);
    });

    test('nothing to store: no walk, no chest', async () => {
        const world = makeWorld();
        world.container(3, 64, 0);
        const bot = makeBot(world, { items: [['stone_pickaxe', 1, 100], ['bread', 8], ['torch', 20]] });
        const res = await S.storeItems(bot, makeCtx(), fastClock());
        assert.deepEqual(res, { ok: true, reason: null, stored: {}, left: {}, chests: [], text: 'I have nothing to store. I keep my tools, food and torches.' });
        assert.deepEqual(bot.calls, []);
    });

    test('no chest nearby', async () => {
        const world = makeWorld();
        world.container(40, 64, 0);
        const bot = makeBot(world, { items: HAUL });
        const res = await S.storeItems(bot, makeCtx(), fastClock());
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'no_chest');
        assert.equal(res.text, 'I know no chest nearby. Place one or take me to one.');
        assert.deepEqual(res.left, { dirt: 20, wheat: 12 });
    });

    test('a chest that becomes full is left and the next one takes the rest', async () => {
        const world = makeWorld();
        const near = world.container(3, 64, 0);
        world.fillWith(near, 'stone');
        near.slots[26] = null;
        const far = world.container(-6, 64, 0);
        const bot = makeBot(world, { items: [['dirt', 64], ['dirt', 64], ['dirt', 10]] });
        const ctx = makeCtx();
        ctx.chests.update({ x: 3, y: 64, z: 0, dimension: 'overworld', kind: 'chest', items: { stone: 26 * 64 }, free_slots: 1 });
        ctx.chests.update({ x: -6, y: 64, z: 0, dimension: 'overworld', kind: 'chest', items: {}, free_slots: 27 });
        const res = await S.storeItems(bot, ctx, fastClock());
        assert.equal(res.text, 'I stored 138 dirt in 2 chests.');
        assert.equal(res.ok, true);
        assert.equal(boxCounts(near).dirt, 64);
        assert.equal(boxCounts(far).dirt, 74);
        assert.equal(ctx.chests.get({ x: 3, y: 64, z: 0 }).free_slots, 0);
        assert.equal(ctx.chests.get({ x: -6, y: 64, z: 0 }).free_slots, 25);
        assert.deepEqual(inventoryCounts(bot), {});
    });

    test('all chests full', async () => {
        const world = makeWorld();
        world.fillWith(world.container(3, 64, 0), 'stone');
        world.fillWith(world.container(0, 64, 5, { kind: 'barrel' }), 'sand');
        const bot = makeBot(world, { items: [['cobblestone', 64], ['cobblestone', 32], ['dirt', 12]] });
        const res = await S.storeItems(bot, makeCtx(), fastClock());
        assert.equal(res.text, 'All chests nearby are full. I still carry 64 cobblestone, 12 dirt.');
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'full');
        assert.deepEqual(res.stored, {});
    });

    test('partly: the chests are full now', async () => {
        const world = makeWorld();
        const box = world.container(1, 64, 5);
        world.fillWith(box, 'stone');
        box.slots[3] = null;
        box.slots[4] = makeItem('cobblestone', 40, 4);
        box.slots[5] = makeItem('cobblestone', 50, 5);
        const bot = makeBot(world, { items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64]] });
        const res = await S.storeItems(bot, makeCtx(), fastClock());
        assert.equal(res.text, 'I stored 102 cobblestone in the chest at (1, 64, 5). The chests are full now, I still carry 58 cobblestone.');
        assert.equal(res.reason, 'full');
        assert.deepEqual(res.left, { cobblestone: 58 });
        assert.equal(inventoryCounts(bot).cobblestone, 32 + 58);
    });

    test('a chest that holds the item is preferred; other things go to the nearest', async () => {
        const world = makeWorld();
        const near = world.container(2, 64, 0);
        const far = world.container(-8, 64, 0, { items: [['wheat', 5]] });
        const bot = makeBot(world, { items: [['wheat', 12], ['dirt', 20]] });
        const ctx = makeCtx();
        ctx.chests.update({ x: 2, y: 64, z: 0, dimension: 'overworld', kind: 'chest', items: {}, free_slots: 27 });
        ctx.chests.update({ x: -8, y: 64, z: 0, dimension: 'overworld', kind: 'chest', items: { wheat: 5 }, free_slots: 26 });
        const res = await S.storeItems(bot, ctx, fastClock());
        assert.equal(res.text, 'I stored 20 dirt, 12 wheat in 2 chests.');
        assert.deepEqual(boxCounts(near), { dirt: 20 });
        assert.deepEqual(boxCounts(far), { wheat: 17 });
    });

    test('a chest in the index that looks full is looked into again', async () => {
        const world = makeWorld();
        const box = world.container(3, 64, 0);
        const bot = makeBot(world, { items: [['dirt', 5]] });
        const ctx = makeCtx();
        ctx.chests.update({ x: 3, y: 64, z: 0, dimension: 'overworld', kind: 'chest', items: { stone: 64 * 27 }, free_slots: 0 });
        const res = await S.storeItems(bot, ctx, fastClock());
        assert.equal(res.ok, true);
        assert.deepEqual(boxCounts(box), { dirt: 5 });
        assert.deepEqual(ctx.chests.get({ x: 3, y: 64, z: 0 }).items, { dirt: 5 });
    });

    test('a double chest is one container with the key at the smaller x; a stale half is removed', async () => {
        const world = makeWorld();
        const box = world.doubleChest(3, 64, 0);
        const bot = makeBot(world, { items: [['dirt', 20]] });
        const ctx = makeCtx();
        ctx.chests.update({ x: 4, y: 64, z: 0, dimension: 'overworld', kind: 'chest', items: {}, free_slots: 27 });
        const res = await S.storeItems(bot, ctx, fastClock());
        assert.equal(res.text, 'I stored 20 dirt in the chest at (3, 64, 0).');
        assert.deepEqual(boxCounts(box), { dirt: 20 });
        assert.deepEqual(ctx.chests.list().map(c => [c.x, c.free_slots]), [[3, 53]]);
    });

    test('the other half of a double chest is found also when the properties point the other way', async () => {
        const world = makeWorld();
        const box = world.container(3, 64, 0, { size: 54, props: { facing: 'north', type: 'right' } });
        world.set(4, 64, 0, 'chest', { facing: 'north', type: 'left' });
        world.containers.set(key(4, 64, 0), box);
        const bot = makeBot(world, { items: [['dirt', 3]] });
        const ctx = makeCtx();
        const found = await S.lookIntoChests(bot, ctx, 16, fastClock());
        assert.deepEqual(found.map(c => [c.x, c.free_slots]), [[3, 54]]);
    });

    test('a chest of the index that is gone is removed', async () => {
        const world = makeWorld();
        world.container(3, 64, 0);
        const bot = makeBot(world, { items: [['dirt', 5]] });
        const ctx = makeCtx();
        ctx.chests.update({ x: 5, y: 64, z: 5, dimension: 'overworld', kind: 'chest', items: { dirt: 1 }, free_slots: 20 });
        const res = await S.storeItems(bot, ctx, fastClock());
        assert.equal(res.ok, true);
        assert.equal(ctx.chests.get({ x: 5, y: 64, z: 5 }), null);
    });

    test('an unreachable chest is skipped', async () => {
        const world = makeWorld();
        world.container(8, 64, 0);
        const bot = makeBot(world, { items: [['dirt', 20], ['wheat', 12]] });
        bot.unreachable.add(key(8, 64, 0));
        const res = await S.storeItems(bot, makeCtx(), fastClock());
        assert.equal(res.reason, 'unreachable');
        assert.equal(res.text, 'I could not get to a chest nearby or open it. I still carry 20 dirt, 12 wheat.');
    });

    test('a chest with a solid block above counts as blocked only after its open failed; glass does not block (v0.1.4.8, E1)', async () => {
        const world = makeWorld();
        world.container(3, 64, 0);
        world.set(3, 65, 0, 'stone');
        const glass = world.container(-3, 64, 0);
        world.set(-3, 65, 0, 'glass');
        const bot = makeBot(world, { items: [['dirt', 5]] });
        bot.failOpen.add(key(3, 64, 0));
        const res = await S.storeItems(bot, makeCtx(), fastClock());
        assert.equal(res.text, 'I stored 5 dirt in the chest at (-3, 64, 0).');
        assert.deepEqual(boxCounts(glass), { dirt: 5 });
        assert.ok(bot.calls.some(c => c[0] === 'open' && c[1] === 3), 'the open is tried');
        assert.match(cap.allText(), /a solid block is above it/);
    });

    test('a chest that does not open in time is given up; a late window is closed', async () => {
        const world = makeWorld();
        world.container(3, 64, 0);
        const bot = makeBot(world, { items: [['dirt', 5]] });
        bot.hangOpen.add(key(3, 64, 0));
        const res = await S.storeItems(bot, makeCtx(), fastClock());
        assert.equal(res.reason, 'unreachable');
        assert.ok(clockMs >= 5000);
        bot.resolveLate();
        await new Promise(resolve => setTimeout(resolve, 700));
        assert.equal(bot.windows.length, 1);
        assert.equal(bot.windows[0].closed, true);
    });

    test('a chest that fails to open is skipped and the next one is used', async () => {
        const world = makeWorld();
        world.container(2, 64, 0);
        const other = world.container(-5, 64, 0);
        const bot = makeBot(world, { items: [['dirt', 5]] });
        bot.failOpen.add(key(2, 64, 0));
        const res = await S.storeItems(bot, makeCtx(), fastClock());
        assert.equal(res.ok, true);
        assert.deepEqual(boxCounts(other), { dirt: 5 });
    });

    test('an error while depositing: the window is closed, the chest is left, the result says so', async () => {
        const world = makeWorld();
        world.container(3, 64, 0);
        const bot = makeBot(world, { items: [['dirt', 5]] });
        const open = bot.openContainer;
        bot.openContainer = async (block) => {
            const w = await open(block);
            w.deposit = async () => { await Promise.resolve(); throw new Error('server said no'); };
            return w;
        };
        const res = await S.storeItems(bot, makeCtx(), fastClock());
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'unreachable');
        assert.ok(bot.windows.every(w => w.closed));
    });

    test('interrupted before it starts', async () => {
        const world = makeWorld();
        world.container(3, 64, 0);
        const bot = makeBot(world, { items: [['dirt', 5]] });
        bot.interrupt_code = true;
        const res = await S.storeItems(bot, makeCtx(), fastClock());
        assert.equal(res.reason, 'interrupted');
        assert.equal(res.text, 'I was stopped before I stored anything.');
    });

    test('interrupted on the way', async () => {
        const world = makeWorld();
        world.container(8, 64, 0);
        const bot = makeBot(world, { items: [['dirt', 5]] });
        const ctx = makeCtx();
        ctx.chests.update({ x: 8, y: 64, z: 0, dimension: 'overworld', kind: 'chest', items: {}, free_slots: 27 });
        bot.pathfinder.goto = async () => { bot.interrupt_code = true; await Promise.resolve(); };
        const res = await S.storeItems(bot, ctx, fastClock());
        assert.equal(res.reason, 'interrupted');
    });

    test('the time limit ends the work', async () => {
        const world = makeWorld();
        world.container(8, 64, 0);
        const bot = makeBot(world, { items: [['dirt', 5]] });
        const ctx = makeCtx();
        ctx.chests.update({ x: 8, y: 64, z: 0, dimension: 'overworld', kind: 'chest', items: {}, free_slots: 27 });
        bot.pathfinder.goto = () => new Promise(() => {});
        const res = await S.storeItems(bot, ctx, { ...fastClock(), timeoutMs: 1000 });
        assert.equal(res.reason, 'timeout');
        assert.equal(res.text, 'I ran out of time before I stored anything. I still carry 5 dirt.');
    });

    test('the worse of two equal tools is stored by its slot', async () => {
        const world = makeWorld();
        const box = world.container(3, 64, 0);
        const bot = makeBot(world, { items: [['stone_pickaxe', 1, 100], ['stone_pickaxe', 1, 10], ['wooden_pickaxe', 1, 50], ['stone_pickaxe', 1, 60]] });
        const res = await S.storeItems(bot, makeCtx(), fastClock());
        assert.deepEqual(res.stored, { stone_pickaxe: 1, wooden_pickaxe: 1 });
        assert.ok(bot.calls.some(c => c[0] === 'transfer'));
        const stored = box.slots.find(s => s?.name === 'stone_pickaxe');
        assert.equal(stored.maxDurability - stored.durabilityUsed, 10);
        const kept = bot.inventory.items().filter(i => i.name === 'stone_pickaxe').map(i => i.maxDurability - i.durabilityUsed).sort((a, b) => a - b);
        assert.deepEqual(kept, [60, 100]);
    });

    test('without bot.transfer tools are deposited by their type', async () => {
        const world = makeWorld();
        const box = world.container(3, 64, 0);
        const bot = makeBot(world, { items: [['stone_axe', 1, 100], ['stone_axe', 1, 10]] });
        delete bot.transfer;
        const res = await S.storeItems(bot, makeCtx(), fastClock());
        assert.deepEqual(res.stored, { stone_axe: 1 });
        assert.equal(boxCounts(box).stone_axe, 1);
    });

    test('options.only, options.keep and the setting keep_items', async () => {
        const world = makeWorld();
        const box = world.container(3, 64, 0);
        const bot = makeBot(world, { items: [['wheat', 12], ['wheat_seeds', 40], ['dirt', 20], ['diamond', 3]] });
        const res = await S.storeItems(bot, makeCtx(), { ...fastClock(), only: ['wheat', 'wheat_seeds'], keep: { wheat_seeds: 32 } });
        assert.deepEqual(res.stored, { wheat: 12, wheat_seeds: 8 });
        const again = await S.storeItems(bot, makeCtx({ settings: { keep_items: { diamond: -1 } } }), fastClock());
        assert.deepEqual(again.stored, { dirt: 20, wheat_seeds: 32 });
        assert.deepEqual(boxCounts(box), { wheat: 12, wheat_seeds: 40, dirt: 20 });
        assert.deepEqual(inventoryCounts(bot), { diamond: 3 });
    });

    test('options.chest uses only that chest; a double chest by either half', async () => {
        const world = makeWorld();
        const near = world.container(2, 64, 0);
        const mine = world.doubleChest(-10, 64, 3);
        const bot = makeBot(world, { items: [['dirt', 5]] });
        const ctx = makeCtx();
        const res = await S.storeItems(bot, ctx, { ...fastClock(), chest: { x: -9, y: 64, z: 3 } });
        assert.equal(res.text, 'I stored 5 dirt in the chest at (-10, 64, 3).');
        assert.deepEqual(boxCounts(mine), { dirt: 5 });
        assert.deepEqual(boxCounts(near), {});
        assert.deepEqual(ctx.chests.list().map(c => c.x), [-10]);
    });

    test('options.chest that is not a container', async () => {
        const world = makeWorld();
        world.container(2, 64, 0);
        const bot = makeBot(world, { items: [['dirt', 5]] });
        const res = await S.storeItems(bot, makeCtx(), { ...fastClock(), chest: { x: 7, y: 64, z: 7 } });
        assert.equal(res.reason, 'no_chest');
    });

    test('without a chest index in ctx the chests nearby are used', async () => {
        const world = makeWorld();
        const box = world.container(3, 64, 0);
        const bot = makeBot(world, { items: [['dirt', 5]] });
        const res = await S.storeItems(bot, { settings: null }, fastClock());
        assert.equal(res.ok, true);
        assert.deepEqual(boxCounts(box), { dirt: 5 });
        const res2 = await S.storeItems(bot, undefined, fastClock());
        assert.equal(res2.text, 'I have nothing to store. I keep my tools, food and torches.');
    });

    test('never throws', async () => {
        const bot = makeBot(makeWorld(), { items: [['dirt', 5]] });
        bot.inventory.items = () => { throw new Error('broken inventory'); };
        const res = await S.storeItems(bot, makeCtx(), fastClock());
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'error');
        assert.equal(res.text, 'I could not store my things: broken inventory');
        const res2 = await S.storeItems(null, makeCtx(), fastClock());
        assert.equal(res2.ok, false);
    });
});

// ---- lookIntoChests -------------------------------------------------------------------------

describe('lookIntoChests', () => {
    test('opens every chest, trapped chest and barrel within range and updates the index', async () => {
        const world = makeWorld();
        world.container(3, 64, 0, { items: [['wheat', 12], ['wheat_seeds', 3]] });
        world.container(-4, 64, 2, { kind: 'trapped_chest', items: [['bread', 5]] });
        world.container(0, 64, -6, { kind: 'barrel', items: [['dirt', 64], ['dirt', 64]] });
        world.container(30, 64, 0, { items: [['diamond', 1]] });
        world.set(1, 64, 1, 'furnace');
        const bot = makeBot(world);
        const ctx = makeCtx();
        const chests = await S.lookIntoChests(bot, ctx, 16, fastClock());
        assert.deepEqual(chests.map(c => [c.x, c.kind]).sort(), [[-4, 'trapped_chest'], [0, 'barrel'], [3, 'chest']]);
        assert.deepEqual(ctx.chests.get({ x: 0, y: 64, z: -6 }).items, { dirt: 128 });
        assert.equal(ctx.chests.get({ x: 0, y: 64, z: -6 }).free_slots, 25);
        assert.equal(ctx.chests.size, 3);
        assert.deepEqual(bot.inventory.items(), []);
    });

    test('at most 12 containers, the nearest', async () => {
        const world = makeWorld();
        for (let i = 0; i < 14; i++) world.container(2 + i, 64, 3, { kind: 'barrel' });
        const bot = makeBot(world);
        const ctx = makeCtx();
        const chests = await S.lookIntoChests(bot, ctx, 32, fastClock());
        assert.equal(chests.length, 12);
        assert.equal(ctx.chests.get({ x: 15, y: 64, z: 3 }), null);
        assert.notEqual(ctx.chests.get({ x: 2, y: 64, z: 3 }), null);
    });

    test('the default range is 16 and unreachable chests are left out', async () => {
        const world = makeWorld();
        world.container(3, 64, 0);
        world.container(-8, 64, 0);
        world.container(20, 64, 0);
        const bot = makeBot(world);
        bot.unreachable.add(key(-8, 64, 0));
        const chests = await S.lookIntoChests(bot, makeCtx(), undefined, fastClock());
        assert.deepEqual(chests.map(c => c.x), [3]);
    });

    test('never throws; a chest in an unloaded place is not listed', async () => {
        assert.deepEqual(await S.lookIntoChests(null, makeCtx()), []);
        const world = makeWorld();
        world.container(3, 64, 0);
        world.unloaded.add(key(3, 64, 0));
        assert.deepEqual(await S.lookIntoChests(makeBot(world), makeCtx(), 16, fastClock()), []);
        const bot = makeBot(world);
        bot.findBlocks = () => { throw new Error('no world'); };
        assert.deepEqual(await S.lookIntoChests(bot, makeCtx(), 16, fastClock()), []);
    });
});

// ---- fetchItem ------------------------------------------------------------------------------

describe('fetchItem', () => {
    function known(ctx, x, y, z, items, free = 20) {
        ctx.chests.update({ x, y, z, dimension: 'overworld', kind: 'chest', items, free_slots: free });
    }

    test('takes the item from the nearest chest of the index', async () => {
        const world = makeWorld();
        const near = world.container(-3, 64, 0, { items: [['bread', 20]] });
        const far = world.container(10, 64, 0, { items: [['bread', 64]] });
        const bot = makeBot(world, { items: [['dirt', 1]] });
        const ctx = makeCtx();
        known(ctx, -3, 64, 0, { bread: 20 });
        known(ctx, 10, 64, 0, { bread: 64 });
        const res = await S.fetchItem(bot, ctx, 'bread', 5, fastClock());
        assert.deepEqual(res, { ok: true, reason: null, taken: 5, chests: [ctx.chests.get({ x: -3, y: 64, z: 0 })], text: 'I took 5 bread from the chest at (-3, 64, 0).' });
        assert.equal(inventoryCounts(bot).bread, 5);
        assert.equal(boxCounts(near).bread, 15);
        assert.equal(boxCounts(far).bread, 64);
        assert.equal(ctx.chests.get({ x: -3, y: 64, z: 0 }).items.bread, 15);
    });

    test('from several chests when one is not enough', async () => {
        const world = makeWorld();
        world.container(-3, 64, 0, { items: [['bread', 3]] });
        world.container(10, 64, 0, { items: [['bread', 64]] });
        const bot = makeBot(world);
        const ctx = makeCtx();
        known(ctx, -3, 64, 0, { bread: 3 });
        known(ctx, 10, 64, 0, { bread: 64 });
        const res = await S.fetchItem(bot, ctx, 'minecraft:Bread', 8, fastClock());
        assert.equal(res.text, 'I took 8 bread from 2 chests.');
        assert.equal(res.taken, 8);
        assert.equal(inventoryCounts(bot).bread, 8);
    });

    test('fetched less: there was no more', async () => {
        const world = makeWorld();
        world.container(-13, 64, 28, { items: [['bread', 3]] });
        const bot = makeBot(world, { pos: [-10.5, 64, 25.5] });
        const ctx = makeCtx();
        known(ctx, -13, 64, 28, { bread: 3 });
        const res = await S.fetchItem(bot, ctx, 'bread', 5, fastClock());
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'no_more');
        assert.equal(res.text, 'I took 3 bread from the chest at (-13, 64, 28). There was no more.');
    });

    test('without a chest in the index it looks into the chests it does not know within 16 blocks first (v0.1.4.8, E1)', async () => {
        const world = makeWorld();
        world.container(12, 64, 0, { items: [['bread', 7]] });
        world.container(3, 64, 0, { items: [['dirt', 7]] });
        const bot = makeBot(world);
        const ctx = makeCtx();
        const res = await S.fetchItem(bot, ctx, 'bread', 2, fastClock());
        assert.equal(res.text, 'I took 2 bread from the chest at (12, 64, 0).');
        assert.equal(ctx.chests.size, 2);
    });

    test('not found', async () => {
        const world = makeWorld();
        world.container(3, 64, 0, { items: [['dirt', 7]] });
        const bot = makeBot(world);
        const res = await S.fetchItem(bot, makeCtx(), 'bread', 1, fastClock());
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'not_found');
        assert.equal(res.taken, 0);
        assert.equal(res.text, 'I know no chest with bread.');
    });

    test('the index was wrong: the chest is updated and the text says so', async () => {
        const world = makeWorld();
        world.container(3, 64, 0, { items: [['dirt', 7]] });
        const bot = makeBot(world);
        const ctx = makeCtx();
        known(ctx, 3, 64, 0, { bread: 10 });
        const res = await S.fetchItem(bot, ctx, 'bread', 1, fastClock());
        assert.equal(res.text, 'I found no bread in the chests I know.');
        assert.deepEqual(ctx.chests.get({ x: 3, y: 64, z: 0 }).items, { dirt: 7 });
    });

    test('count -1 takes all there is', async () => {
        const world = makeWorld();
        world.container(3, 64, 0, { items: [['bread', 7], ['bread', 64]] });
        const bot = makeBot(world);
        const ctx = makeCtx();
        known(ctx, 3, 64, 0, { bread: 71 });
        const res = await S.fetchItem(bot, ctx, 'bread', -1, fastClock());
        assert.equal(res.ok, true);
        assert.equal(res.text, 'I took 71 bread from the chest at (3, 64, 0).');
    });

    test('a bad count means 1; a bad name is refused', async () => {
        const world = makeWorld();
        world.container(3, 64, 0, { items: [['bread', 7]] });
        const bot = makeBot(world);
        const ctx = makeCtx();
        known(ctx, 3, 64, 0, { bread: 7 });
        assert.equal((await S.fetchItem(bot, ctx, 'bread', 'x', fastClock())).taken, 1);
        assert.equal((await S.fetchItem(bot, ctx, 'bread', 0, fastClock())).taken, 1);
        const bad = await S.fetchItem(bot, ctx, '  ', 1, fastClock());
        assert.equal(bad.reason, 'bad_name');
        assert.equal(bad.text, 'Tell me which item to fetch.');
    });

    test('a full inventory', async () => {
        const world = makeWorld();
        world.container(3, 64, 0, { items: [['bread', 20]] });
        const bot = makeBot(world, { items: Array.from({ length: 36 }, () => ['dirt', 64]) });
        const ctx = makeCtx();
        known(ctx, 3, 64, 0, { bread: 20 });
        const res = await S.fetchItem(bot, ctx, 'bread', 5, fastClock());
        assert.equal(res.reason, 'inventory_full');
        assert.equal(res.text, 'My inventory is full, I took no bread.');
    });

    test('a nearly full inventory takes what fits', async () => {
        const world = makeWorld();
        world.container(3, 64, 0, { items: [['bread', 60]] });
        const items = Array.from({ length: 35 }, () => ['dirt', 64]);
        items.push(['bread', 60]);
        const bot = makeBot(world, { items });
        const ctx = makeCtx();
        known(ctx, 3, 64, 0, { bread: 60 });
        const res = await S.fetchItem(bot, ctx, 'bread', 10, fastClock());
        assert.equal(res.text, 'I took 4 bread from the chest at (3, 64, 0). My inventory is full.');
    });

    test('an unreachable chest; the next one is used', async () => {
        const world = makeWorld();
        world.container(8, 64, 0, { items: [['bread', 20]] });
        world.container(-9, 64, 0, { items: [['bread', 2]] });
        const bot = makeBot(world);
        bot.unreachable.add(key(8, 64, 0));
        const ctx = makeCtx();
        known(ctx, 8, 64, 0, { bread: 20 });
        known(ctx, -9, 64, 0, { bread: 2 });
        const res = await S.fetchItem(bot, ctx, 'bread', 5, fastClock());
        assert.equal(res.text, 'I took 2 bread from the chest at (-9, 64, 0). I could not get to the other chests with bread.');
        const none = await S.fetchItem(bot, ctx, 'bread', 5, fastClock());
        assert.equal(none.text, 'I could not get to the chest with bread at (8, 64, 0).');
    });

    test('interrupted, time, error', async () => {
        const world = makeWorld();
        world.container(8, 64, 0, { items: [['bread', 20]] });
        const bot = makeBot(world);
        const ctx = makeCtx();
        known(ctx, 8, 64, 0, { bread: 20 });
        bot.interrupt_code = true;
        assert.equal((await S.fetchItem(bot, ctx, 'bread', 5, fastClock())).text, 'I was stopped before I took any bread.');
        bot.interrupt_code = false;
        const goto = bot.pathfinder.goto;
        bot.pathfinder.goto = () => new Promise(() => {});
        const slow = await S.fetchItem(bot, ctx, 'bread', 5, { ...fastClock(), timeoutMs: 1000 });
        assert.equal(slow.reason, 'timeout');
        assert.equal(slow.text, 'I ran out of time before I took any bread.');
        bot.pathfinder.goto = goto;
        bot.blockAt = () => { throw new Error('boom'); };
        const broken = await S.fetchItem(bot, ctx, 'bread', 5, fastClock());
        assert.equal(broken.ok, false);
        assert.equal(broken.reason, 'error');
        assert.equal(broken.text, 'I could not take bread: boom');
    });
});

// ---- lookIntoChest and recordContainer ---------------------------------------------------------

describe('one chest', () => {
    test('lookIntoChest opens one container and updates the index', async () => {
        const world = makeWorld();
        world.container(3, 64, 0, { items: [['bread', 20]] });
        const bot = makeBot(world);
        const ctx = makeCtx();
        const res = await S.lookIntoChest(bot, ctx, { x: 3, y: 64, z: 0 }, fastClock());
        assert.equal(res.ok, true);
        assert.deepEqual(res.chest.items, { bread: 20 });
        assert.equal((await S.lookIntoChest(bot, ctx, { x: 9, y: 64, z: 9 }, fastClock())).ok, false);
        assert.equal((await S.lookIntoChest(bot, ctx, null, fastClock())).ok, false);
    });

    test('recordContainer updates the index from a window that is open', async () => {
        const world = makeWorld();
        world.doubleChest(3, 64, 0, [['wheat', 12]]);
        const bot = makeBot(world);
        const ctx = makeCtx();
        const window = await bot.openContainer(bot.blockAt({ x: 4, y: 64, z: 0 }));
        const chest = S.recordContainer(bot, ctx, bot.blockAt({ x: 4, y: 64, z: 0 }), window);
        assert.deepEqual([chest.x, chest.items, chest.free_slots], [3, { wheat: 12 }, 53]);
        assert.equal(S.recordContainer(bot, ctx, bot.blockAt({ x: 0, y: 70, z: 0 }), window), null);
        assert.equal(S.recordContainer(bot, {}, bot.blockAt({ x: 4, y: 64, z: 0 }), window), null);
    });
});

// ---- chestsText and bindStorage ------------------------------------------------------------------

describe('chestsText', () => {
    test('lists the chests of the index', () => {
        const ctx = makeCtx();
        assert.equal(S.chestsText(ctx, 'overworld'), 'I know no chests in this world.');
        ctx.chests.update({ x: -13, y: 63, z: 28, dimension: 'overworld', kind: 'chest', items: { wheat: 12, wheat_seeds: 3 }, free_slots: 4 });
        ctx.chests.update({ x: 0, y: 40, z: 0, dimension: 'the_nether', kind: 'chest', items: {}, free_slots: 27 });
        assert.equal(S.chestsText(ctx, 'minecraft:overworld'), 'Chests I know in this world:\n- (-13, 63, 28): 12 wheat, 3 wheat_seeds, 4 free slots');
        assert.equal(S.chestsText(ctx).split('\n').length, 3);
        assert.equal(S.chestsText({}, 'overworld'), 'I know no chests in this world.');
        assert.equal(S.chestsText({ chests: { list() { throw new Error('x'); } } }), 'I know no chests in this world.');
    });
});

describe('bindStorage', () => {
    test('the functions of ctx.storage are bound to the bot and read the context when they run', async () => {
        const world = makeWorld();
        const box = world.container(3, 64, 0, { items: [['bread', 20]] });
        const bot = makeBot(world, { items: [['dirt', 5]] });
        let ctx = null;
        const storage = P.bindStorage(bot, () => ctx);
        ctx = makeCtx();
        const stored = await storage.storeItems(fastClock());
        assert.equal(stored.ok, true);
        const fetched = await storage.fetchItem('bread', 2, fastClock());
        assert.equal(fetched.taken, 2);
        assert.deepEqual(boxCounts(box), { bread: 18, dirt: 5 });
    });

    test('also takes the bot and ctx in front, and a plain ctx object', async () => {
        const world = makeWorld();
        world.container(3, 64, 0, { items: [['bread', 20]] });
        const bot = makeBot(world);
        const ctx = makeCtx();
        const storage = P.bindStorage(bot, ctx);
        const fetched = await storage.fetchItem(bot, ctx, 'bread', 3, fastClock());
        assert.equal(fetched.taken, 3);
        const stored = await storage.storeItems(bot, ctx, fastClock());
        assert.equal(stored.text, 'I have nothing to store. I keep my tools, food and torches.');
        const broken = P.bindStorage(bot, () => { throw new Error('no ctx'); });
        const res = await broken.fetchItem('bread', 1, fastClock());
        assert.equal(res.taken, 1, 'without a context the chests nearby are looked into');
    });
});
