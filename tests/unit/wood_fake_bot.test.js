// Test helper of the wood pack (spec v0.1.4.7 T): the fake bot of the home pack with what cutting
// trees and crafting needs: drops that fall and are picked up, a jump that lifts the bot, a
// pathfinder that stops beside a block, crafting by the recipes of minecraft-data 1.21.8, and a
// virtual clock. The file name ends in .test.js only because the owner of these tests may create
// no other files; the tests below run only when this file is the main module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { REGISTRY, makeFakeBot, makeWorld, v } from './home_fake_bot.test.js';

export { REGISTRY, makeWorld, v };

const key = (x, y, z) => `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
let nextId = 5000;
let nextSlot = 9;

function isEmpty(world, x, y, z) {
    const b = world.block(x, y, z);
    return !!b && b.boundingBox === 'empty' && b.name !== 'water' && b.name !== 'lava';
}

function isStandable(world, x, y, z) {
    const below = world.block(x, y - 1, z);
    return isEmpty(world, x, y, z) && isEmpty(world, x, y + 1, z) && !!below && below.boundingBox !== 'empty';
}

function noPath() {
    const err = new Error('No path to the goal!');
    err.name = 'NoPath';
    return err;
}

/** Gives the bot items; tools get a durability like prismarine-item. */
export function give(bot, name, count = 1, { used = 0 } = {}) {
    const reg = REGISTRY.itemsByName[name];
    const existing = bot.inventory.list.find(i => i.name === name && i.count > 0 && !reg?.maxDurability);
    if (existing && existing.count + count <= 64) {
        existing.count += count;
        return existing;
    }
    const item = { name, count, type: reg?.id ?? 0, slot: nextSlot++ };
    if (reg?.maxDurability) {
        item.maxDurability = reg.maxDurability;
        item.durabilityUsed = used;
    }
    bot.inventory.list.push(item);
    return item;
}

/** Count of an item in the inventory. */
export function count(bot, name) {
    return bot.inventory.list.filter(i => i.name === name).reduce((s, i) => s + i.count, 0);
}

function take(bot, name, n) {
    for (const item of bot.inventory.list) {
        if (item.name !== name) continue;
        const k = Math.min(item.count, n);
        item.count -= k;
        n -= k;
        if (n === 0) break;
    }
    bot.inventory.list = bot.inventory.list.filter(i => i.count > 0);
}

/** An item entity that falls down to the first block that is not empty. */
export function dropItem(bot, name, pos, n = 1) {
    let y = Math.floor(pos.y);
    while (y > -64 && isEmpty(bot.world, pos.x, y - 1, pos.z)) y--;
    const entity = {
        id: nextId++, name: 'item', type: 'object', isValid: true, height: 0.25,
        position: v(Math.floor(pos.x) + 0.5, y, Math.floor(pos.z) + 0.5),
        getDroppedItem: () => ({ name, count: n }),
    };
    bot.entities[entity.id] = entity;
    return entity;
}

/** Items within reach of the bot's body go into the inventory, as on a server. */
export function pickup(bot) {
    const p = bot.entity.position;
    for (const e of Object.values(bot.entities)) {
        if (e.name !== 'item') continue;
        const dx = e.position.x - p.x;
        const dz = e.position.z - p.z;
        const dy = e.position.y - p.y;
        if (Math.hypot(dx, dz) <= 1.6 && dy >= -1 && dy <= 2.3) {
            const d = e.getDroppedItem();
            give(bot, d.name, d.count);
            e.isValid = false;
            delete bot.entities[e.id];
        }
    }
}

// What a block drops when it is dug. Leaves drop nothing unless bot.leafDrop names it.
function dropOf(bot, name) {
    if (name.endsWith('_leaves')) return bot.leafDrop ?? null;
    if (name === 'stone') return /_pickaxe$/.test(bot.heldItem?.name ?? '') ? 'cobblestone' : null;
    if (name === 'grass_block') return 'dirt';
    if (['air', 'cave_air', 'water', 'lava'].includes(name)) return null;
    return name;
}

/**
 * The goto of the fake: GoalBlock needs a free standing place at the goal; GoalNear goes to the
 * free standing place within range that is nearest to the bot. Goals whose key is in
 * bot.unreachable, and places in bot.blocked, give NoPath.
 */
export async function nearGoto(bot, goal) {
    const g = { x: Math.floor(goal.x), y: Math.floor(goal.y), z: Math.floor(goal.z) };
    if (bot.unreachable?.has(key(g.x, g.y, g.z))) throw noPath();
    const world = bot.world;
    let cell = null;
    if (goal.rangeSq === undefined) {
        if (isStandable(world, g.x, g.y, g.z)) cell = g;
    } else {
        const r = Math.ceil(Math.sqrt(goal.rangeSq));
        let best = Infinity;
        const p = bot.entity.position;
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                for (let dz = -r; dz <= r; dz++) {
                    if (dx * dx + dy * dy + dz * dz > goal.rangeSq) continue;
                    const c = { x: g.x + dx, y: g.y + dy, z: g.z + dz };
                    if (bot.blocked.has(key(c.x, c.y, c.z)) || !isStandable(world, c.x, c.y, c.z)) continue;
                    const d = Math.hypot(c.x + 0.5 - p.x, c.y - p.y, c.z + 0.5 - p.z) + (dx * dx + dy * dy + dz * dz) * 1e-3;
                    if (d < best) { best = d; cell = c; }
                }
            }
        }
    }
    if (!cell || bot.blocked.has(key(cell.x, cell.y, cell.z))) throw noPath();
    bot.walks = (bot.walks ?? 0) + 1;
    bot.entity.position = v(cell.x + 0.5, cell.y, cell.z + 0.5);
    bot.entity.onGround = true;
    pickup(bot);
}

function ingredientsOf(recipe) {
    const ids = recipe.inShape ? recipe.inShape.flat() : recipe.ingredients;
    const need = new Map();
    for (const id of ids) {
        if (id === null || id === undefined) continue;
        const n = typeof id === 'object' ? id.id : id;
        need.set(n, (need.get(n) ?? 0) + 1);
    }
    return need;
}

/**
 * craftRecipe of the fake (ctx.skills.craftRecipe): the first recipe variant of minecraft-data
 * that the inventory satisfies; a recipe larger than 2 by 2 needs a crafting table in the
 * inventory or within 16 blocks. Records ['craft', name, times] in bot.calls.
 */
export function fakeCraftRecipe(bot) {
    return async (b, itemName, num = 1) => {
        const id = REGISTRY.itemsByName[itemName]?.id;
        const recipes = id === undefined ? null : REGISTRY.recipes[id];
        if (!recipes) return false;
        const tableNear = count(bot, 'crafting_table') > 0
            || [...bot.world.blocks.entries()].some(([k, blk]) => blk.name === 'crafting_table'
                && v(...k.split(',').map(Number)).distanceTo(bot.entity.position) <= 16);
        for (const r of recipes) {
            const big = r.inShape && (r.inShape.length > 2 || r.inShape.some(row => row.length > 2));
            if (big && !tableNear) continue;
            const need = ingredientsOf(r);
            let times = Infinity;
            for (const [nid, n] of need) {
                const name = REGISTRY.items[nid].name;
                times = Math.min(times, Math.floor(count(bot, name) / n));
            }
            if (!(times >= 1)) continue;
            const t = Math.min(times, num);
            for (const [nid, n] of need) take(bot, REGISTRY.items[nid].name, n * t);
            give(bot, itemName, r.result.count * t);
            bot.calls.push(['craft', itemName, t]);
            return true;
        }
        bot.calls.push(['craft_failed', itemName, num]);
        return false;
    };
}

/** A virtual clock; `onWait(t)` runs on every wait. */
export function makeClock(onWait = null) {
    const clock = {
        t: 1_000_000,
        now: () => clock.t,
        async wait(ms) {
            clock.t += Math.max(1, ms);
            if (onWait) onWait(clock.t);
            await Promise.resolve();
        },
    };
    return clock;
}

/**
 * The fake bot of the wood pack. bot.world is the world of the home fake (grass at 63, dirt,
 * stone below 60). Extras: bot.leafDrop (the item a dug leaf drops), bot.failPlace (number of
 * placements that do nothing), bot.unreachable (keys of goals without a path).
 */
export function makeWoodBot({ world = makeWorld(), pos = [0.5, 64, 0.5] } = {}) {
    const bot = makeFakeBot({ world, pos });
    bot.inventory.list = [];
    bot.unreachable = new Set();
    bot.failPlace = 0;
    bot.gotoImpl = (goal) => nearGoto(bot, goal);
    bot.inventory.items = function items() {
        return this.list.filter(i => i.count > 0);
    };
    const baseDig = bot.dig;
    bot.dig = async (block, forceLook) => {
        const p = block.position;
        const name = world.nameAt(p.x, p.y, p.z);
        await baseDig(block, forceLook);
        const drop = dropOf(bot, name);
        if (drop) dropItem(bot, drop, { x: p.x, y: p.y, z: p.z });
        pickup(bot);
    };
    bot.placeBlock = async (ref, face) => {
        const t = ref.position.plus(face);
        bot.calls.push(['place', t.x, t.y, t.z, bot.heldItem?.name]);
        if (!bot.heldItem || bot.heldItem.count <= 0) throw new Error('nothing in hand');
        if (bot.failPlace > 0) {
            bot.failPlace--;
            throw new Error('No block has been placed : the block is still air');
        }
        const p = bot.entity.position;
        const inside = Math.floor(p.x) === t.x && Math.floor(p.z) === t.z && p.y < t.y + 1 && p.y + 1.8 > t.y;
        if (inside && !bot.heldItem.name.endsWith('_sapling')) throw new Error('the bot stands there');
        world.set(t.x, t.y, t.z, bot.heldItem.name);
        bot.heldItem.count--;
        bot.inventory.list = bot.inventory.list.filter(i => i.count > 0);
    };
    bot.setControlState = (name, value) => {
        bot.calls.push(['control', name, value]);
        const p = bot.entity.position;
        if (name === 'jump' && value) {
            if (bot.noJump) return;
            bot.entity.position = v(p.x, Math.floor(p.y) + 1.25, p.z);
            bot.entity.onGround = false;
        } else if (name === 'jump' && !value) {
            let y = Math.floor(p.y);
            while (isEmpty(world, p.x, y - 1, p.z)) y--;
            bot.entity.position = v(p.x, y, p.z);
            bot.entity.onGround = true;
            pickup(bot);
        }
    };
    bot.fall = () => {
        const p = bot.entity.position;
        let y = Math.floor(p.y);
        while (y > -64 && isEmpty(world, p.x, y - 1, p.z)) y--;
        bot.entity.position = v(p.x, y, p.z);
    };
    return bot;
}

/** A tree of the home fake world: soil at y, logs from y+1, leaves around the top like BlockWorld.tree. */
export function plantTree(world, { x, y = 63, z, height = 5, log = 'oak_log', leaves = 'oak_leaves', soil = 'dirt' }) {
    world.set(x, y, z, soil);
    const trunk = [];
    for (let yy = y + 1; yy <= y + height; yy++) {
        world.set(x, yy, z, log);
        trunk.push({ x, y: yy, z });
    }
    const top = y + height;
    const leaf = (lx, ly, lz) => {
        if (world.nameAt(lx, ly, lz) === 'air') world.set(lx, ly, lz, leaves);
    };
    for (const ly of [top - 1, top]) {
        for (let dx = -2; dx <= 2; dx++) {
            for (let dz = -2; dz <= 2; dz++) {
                if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
                leaf(x + dx, ly, z + dz);
            }
        }
    }
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) leaf(x + dx, top + 1, z + dz);
    return { trunk, base: { x, y: y + 1, z } };
}

/** Names of all logs left in the world. */
export function logsLeft(world) {
    return [...world.blocks.entries()].filter(([, b]) => /_log$/.test(b.name)).map(([k]) => k);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    test('fake: dug logs drop and are picked up nearby; the jump lifts the bot', async () => {
        const world = makeWorld();
        const bot = makeWoodBot({ world, pos: [4.5, 64, 4.5] });
        world.set(5, 64, 4, 'oak_log');
        await bot.dig(world.block(5, 64, 4));
        assert.equal(count(bot, 'oak_log'), 1);
        give(bot, 'dirt', 2);
        await bot.equip(bot.inventory.list.find(i => i.name === 'dirt'), 'hand');
        bot.setControlState('jump', true);
        await bot.placeBlock(world.block(4, 63, 4), v(0, 1, 0));
        bot.setControlState('jump', false);
        assert.equal(Math.floor(bot.entity.position.y), 65);
        const craft = fakeCraftRecipe(bot);
        give(bot, 'oak_log', 1);
        assert.equal(await craft(bot, 'oak_planks', 2), true);
        assert.equal(count(bot, 'oak_planks'), 8);
    });
}
