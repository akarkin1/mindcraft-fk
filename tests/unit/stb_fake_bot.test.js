// Test helper of part B (spec v0.1.4.8, section 6): a fake mineflayer bot for src/agent/library/skills.js
// and world.js, with an inventory of 46 slots like the one of mineflayer (9 to 44 the main inventory,
// 36 to 44 the hotbar, 45 the off-hand), dropped items on the ground and a path finder whose walk the
// test decides. Blocks come from tests/helpers/block_world.js as real prismarine blocks of 1.21.8, so
// the Movements of mineflayer-pathfinder can judge them.
// The file name ends in .test.js only because part B may create no other files; run on its own it
// checks the fake itself (the tests below run only when this file is the main module).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import minecraftData from 'minecraft-data';
import prismarineBlock from 'prismarine-block';
import { Vec3 } from 'vec3';
import { createBlockWorld } from '../helpers/block_world.js';

/** The real data of 1.21.8. */
export const registry = minecraftData('1.21.8');
const Block = prismarineBlock(registry);

export const OFFHAND = 45;
export const HOTBAR = 36;

/** An item stack like prismarine-item has it: name, count, type, slot. */
export function makeItem(name, count, slot = null) {
    const type = registry.itemsByName[name]?.id;
    assert.ok(type !== undefined, `unknown item ${name}`);
    return { name, count, type, slot, metadata: 0, stackSize: registry.itemsByName[name].stackSize ?? 64 };
}

/** The inventory window of the player: 46 slots. */
export function makeInventory() {
    const slots = new Array(46).fill(null);
    const inv = {
        slots,
        inventoryStart: 9,
        inventoryEnd: 45,
        // like prismarine-windows: slots 9 to 44 only, by name or by type
        findInventoryItem(item) {
            for (let i = 9; i < 45; i++) {
                const it = slots[i];
                if (it && (typeof item === 'number' ? it.type === item : it.name === item)) return it;
            }
            return null;
        },
        items() {
            return slots.slice(9, 45).filter(Boolean);
        },
        emptySlotCount() {
            return slots.slice(9, 45).filter((s) => s === null).length;
        },
        /** Puts a stack into a slot (default: the first empty slot of 9 to 44). */
        put(name, count, slot = null) {
            const at = slot ?? slots.findIndex((s, i) => i >= 9 && i < 45 && s === null);
            assert.ok(at >= 0, 'the inventory is full');
            slots[at] = makeItem(name, count, at);
            return slots[at];
        },
        /** Adds items like a pick-up: onto a stack of the same name in 9 to 44, else into an empty slot. */
        add(name, count) {
            const same = slots.find((s, i) => i >= 9 && i < 45 && s && s.name === name);
            if (same) same.count += count;
            else inv.put(name, count);
        },
        /** Takes count items of a slot away; an empty stack leaves. */
        take(slot, count) {
            const it = slots[slot];
            it.count -= count;
            if (it.count <= 0) slots[slot] = null;
        },
        move(from, to) {
            const a = slots[from];
            const b = slots[to];
            slots[to] = a ? { ...a, slot: to } : null;
            slots[from] = b ? { ...b, slot: from } : null;
        },
    };
    return inv;
}

let nextEntityId = 500;

/**
 * The fake bot.
 * @param {{world?: object, pos?: number[]}} [options] world: a BlockWorld (default: flat ground at 63)
 */
export function makeBot({ world = createBlockWorld().flatGround(63), pos = [0.5, 64, 0.5] } = {}) {
    const floorVec = (p) => new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    const calls = [];
    const inventory = makeInventory();
    const bot = {
        username: 'andy',
        registry,
        output: '',
        interrupt_code: false,
        world,
        calls,
        inventory,
        entity: { id: 1, name: 'player', type: 'player', position: new Vec3(...pos), height: 1.8 },
        entities: {},
        players: {},
        game: { dimension: 'overworld', gameMode: 'survival' },
        quickBarSlot: 0,
        food: 10,
        modes: { isOn: () => false, exists: () => false, pause() {}, unpause() {} },
        tool: { async equipForBlock() {} },
        on() {},
        once() {},
        removeListener() {},
        chat(msg) { calls.push(['chat', msg]); },
        get heldItem() { return inventory.slots[HOTBAR + bot.quickBarSlot]; },
        blockAt(p) {
            const v = floorVec(p);
            const name = world.get(v.x, v.y, v.z);
            if (name === null) return null;
            const block = Block.fromStateId(registry.blocksByName[name].defaultState, 0);
            block.position = v;
            return block;
        },
        findBlocks({ matching, maxDistance, count }) {
            calls.push(['findBlocks', maxDistance]);
            const me = bot.entity.position;
            const near = world.positionsOf(() => true)
                .map((p) => ({ p, d: Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z) }))
                .filter(({ d }) => d <= maxDistance)
                .sort((a, b) => a.d - b.d);
            const found = [];
            for (const { p } of near) {
                const block = bot.blockAt(p);
                if (block && (typeof matching === 'function' ? matching(block) : [].concat(matching).includes(block.type)))
                    found.push(new Vec3(p.x, p.y, p.z));
                if (found.length >= count) break;
            }
            return found;
        },
        nearestEntity(filter) {
            let best = null;
            for (const e of Object.values(bot.entities)) {
                if (!filter(e)) continue;
                if (!best || e.position.distanceTo(bot.entity.position) < best.position.distanceTo(bot.entity.position)) best = e;
            }
            return best;
        },
        // like mineflayer: a stack goes to the hotbar slot of the hand (swap)
        async equip(item, destination) {
            calls.push(['equip', item?.name, item?.slot, destination]);
            const dest = destination === 'hand' ? HOTBAR + bot.quickBarSlot : destination === 'off-hand' ? OFFHAND : null;
            if (dest !== null && item.slot !== dest) inventory.move(item.slot, dest);
        },
        async unequip() {},
        // like mineflayer: slots 9 to 44 only
        async toss(type, metadata, count) {
            let left = count;
            for (let i = 9; i < 45 && left > 0; i++) {
                const it = inventory.slots[i];
                if (!it || it.type !== type) continue;
                const n = Math.min(left, it.count);
                calls.push(['toss', it.name, n, i]);
                inventory.take(i, n);
                left -= n;
            }
            if (left > 0) throw new Error(`Can't find ${type} in slots [9 - 45], (item id: ${type})`);
        },
        async consume() {
            const it = bot.heldItem;
            if (!it) throw new Error('nothing in the hand');
            calls.push(['consume', it.name]);
            inventory.take(it.slot, 1);
        },
        async lookAt() {},
        clearControlStates() { calls.push(['clearControlStates']); },
        pathfinder: null,
    };
    bot.pathfinder = makePathfinder(bot);
    return bot;
}

/**
 * A path finder whose goto calls bot.gotoImpl(goal) (default: arrive at once, at the goal of a
 * GoalNear or GoalBlock). setGoal(null) rejects a running goto with GoalChanged, like the real one.
 */
function makePathfinder(bot) {
    let reject = null;
    const pf = {
        movements: null,
        goal: null,
        moving: false,
        getPathTo: () => ({ status: 'success', path: [] }),
        setMovements(m) { pf.movements = m; },
        setGoal(goal) {
            bot.calls.push(['setGoal', goal === null ? null : goal.constructor?.name]);
            pf.goal = goal;
            if (goal === null && reject) {
                const err = new Error('The goal was changed before it could be completed!');
                err.name = 'GoalChanged';
                const r = reject;
                reject = null;
                setTimeout(() => r(err), 0);
            }
        },
        stop() { bot.calls.push(['stop']); },
        isMoving() { return pf.moving; },
        bestHarvestTool() { return null; },
        goto(goal) {
            bot.calls.push(['goto', goal?.constructor?.name]);
            pf.goal = goal;
            return new Promise((resolve, rej) => {
                reject = rej;
                Promise.resolve()
                    .then(() => (bot.gotoImpl ? bot.gotoImpl(goal) : arrive(bot, goal)))
                    .then(() => { if (reject === rej) { reject = null; resolve(); } },
                        (err) => { if (reject === rej) { reject = null; rej(err); } });
            });
        },
    };
    return pf;
}

/** Puts the bot at the goal of a GoalNear or GoalBlock at once. */
export function arrive(bot, goal) {
    if (goal && Number.isFinite(goal.x) && Number.isFinite(goal.z))
        bot.entity.position = new Vec3(goal.x + 0.5, Number.isFinite(goal.y) ? goal.y : bot.entity.position.y, goal.z + 0.5);
}

/** A walk that never ends by itself (ended only by setGoal(null)). */
export function neverArrive() {
    return new Promise(() => {});
}

/**
 * Drops an item on the ground. options.delayMs: the item cannot be picked up before; options.pickable
 * false: it is never picked up (like with a full inventory). While the bot stands within 1.5 blocks
 * after the delay, the item vanishes on the next check and the inventory gains it.
 */
export function dropItem(bot, name, count, at, { delayMs = 0, pickable = true } = {}) {
    const id = nextEntityId++;
    const since = Date.now();
    const entity = {
        id,
        name: 'item',
        type: 'object',
        position: new Vec3(...at),
        isValid: true,
        getDroppedItem: () => ({ name, count }),
    };
    bot.entities[id] = entity;
    const timer = setInterval(() => {
        if (!entity.isValid) return clearInterval(timer);
        if (!pickable || Date.now() - since < delayMs) return;
        if (entity.position.distanceTo(bot.entity.position) > 1.5) return;
        entity.isValid = false;
        delete bot.entities[id];
        bot.inventory.add(name, count);
        bot.calls.push(['collect', name, count]);
        clearInterval(timer);
    }, 50);
    timer.unref?.();
    return entity;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    test('fake inventory: 46 slots, findInventoryItem sees 9 to 44 only, like mineflayer', () => {
        const bot = makeBot();
        bot.inventory.put('bread', 6, OFFHAND);
        assert.equal(bot.inventory.slots.length, 46);
        assert.equal(bot.inventory.findInventoryItem('bread'), null);
        bot.inventory.put('bread', 2);
        assert.equal(bot.inventory.findInventoryItem('bread').slot, 9);
    });

    test('fake equip moves a stack of the off-hand into the hand', async () => {
        const bot = makeBot();
        const bread = bot.inventory.put('bread', 6, OFFHAND);
        await bot.equip(bread, 'hand');
        assert.equal(bot.heldItem.name, 'bread');
        assert.equal(bot.inventory.slots[OFFHAND], null);
    });

    test('fake path finder: setGoal(null) ends a walk with GoalChanged', async () => {
        const bot = makeBot();
        bot.gotoImpl = neverArrive;
        const walk = bot.pathfinder.goto({ x: 5, y: 64, z: 5 });
        bot.pathfinder.setGoal(null);
        await assert.rejects(walk, { name: 'GoalChanged' });
    });

    test('a dropped item vanishes into the inventory when the bot is near after the delay', async () => {
        const bot = makeBot();
        dropItem(bot, 'stick', 2, [1, 64, 0.5], { delayMs: 100 });
        await new Promise((r) => setTimeout(r, 300));
        assert.equal(bot.inventory.findInventoryItem('stick').count, 2);
        assert.deepEqual(Object.keys(bot.entities), []);
    });
}
