// A fake mineflayer bot for the tests from the spec (v0.1.4.13, T1): the public API of mineflayer and of
// mineflayer-pathfinder as the library documents it (blockAt, dig, equip, toss, activateBlock, inventory, entities,
// players, pathfinder.getPathTo/goto/setGoal/setMovements), over a block world, with the item ids, durabilities and
// harvest tools of minecraft-data 1.21.8. Every call that changes the world is recorded, so a test checks what the
// bot did (dug, tossed, equipped, walked, opened), not what the code says. No timer stays open: every promise of the
// fake resolves at once.
import { createRequire } from 'node:module';
import Vec3 from 'vec3';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const minecraftData = require('minecraft-data');

export const VERSION = '1.21.8';
export const MC = minecraftData(VERSION);

/** An item of the inventory as mineflayer gives it: name, count, type (the id), maxDurability, durabilityUsed. */
export function makeItem(name, count = 1, slot = 36) {
    const row = MC.itemsByName[name];
    if (!row) throw new Error(`no item ${name} in minecraft-data ${VERSION}`);
    return { name, count, type: row.id, slot, stackSize: row.stackSize, maxDurability: row.maxDurability, durabilityUsed: 0, displayName: row.displayName };
}

/** A tool with `usesLeft` uses: maxDurability - durabilityUsed. */
export function makeToolItem(name, usesLeft, slot = 36) {
    const item = makeItem(name, 1, slot);
    item.durabilityUsed = item.maxDurability - usesLeft;
    return item;
}

/** A block as bot.blockAt gives it, from the block world. */
function blockOf(world, p) {
    const pos = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    const name = world.get(pos.x, pos.y, pos.z);
    if (name === null || name === undefined) return null;
    const row = MC.blocksByName[name] ?? MC.blocksByName.stone;
    const props = world._properties?.get?.(`${pos.x},${pos.y},${pos.z}`) ?? {};
    return {
        name,
        type: row.id,
        position: pos,
        hardness: row.hardness,
        diggable: row.diggable,
        boundingBox: row.boundingBox,
        harvestTools: row.harvestTools,
        material: row.material,
        transparent: row.transparent,
        stateId: row.defaultState,
        metadata: 0,
        _properties: props,
        getProperties: () => ({ ...props }),
    };
}

/**
 * bot.findBlocks of mineflayer over the blocks the world set explicitly: `matching` an id, a list of ids or a
 * test of the block; nearest first; `maxDistance` (default 16) and `count` (default 1).
 */
function findBlocksOf(world, bot, { matching, maxDistance = 16, count = 1, point = null } = {}) {
    if (!world) return [];
    const from = point ?? bot.entity.position;
    const test = (name, p) => {
        const row = MC.blocksByName[name];
        if (typeof matching === 'function') return matching(blockOf(world, p));
        if (Array.isArray(matching)) return !!row && matching.includes(row.id);
        return !!row && row.id === matching;
    };
    const found = [];
    for (const [k, name] of world._blocks) {
        const [x, y, z] = k.split(',').map(Number);
        const p = new Vec3(x, y, z);
        if (p.distanceTo(from) <= maxDistance && test(name, p)) found.push(p);
    }
    return found.sort((a, b) => a.distanceTo(from) - b.distanceTo(from)).slice(0, count);
}

/**
 * The fake bot.
 * @param {{world: object, pos?: {x,y,z}, items?: object[], held?: object|null, username?: string,
 *   entities?: object[], players?: object, paths?: (movements: object, goal: object) => {status: string, path: object[]}}} options
 *   paths: what pathfinder.getPathTo answers for the movements and the goal (the staged path of a test)
 */
export function makeFakeBot(options = {}) {
    const world = options.world;
    const items = options.items ?? [];
    const calls = { dug: [], equipped: [], tossed: [], activated: [], walked: [], goals: [], chat: [], looked: 0 };
    const bot = new EventEmitter();
    bot.setMaxListeners(100);
    const start = options.pos ?? { x: 0, y: 64, z: 0 };
    Object.assign(bot, {
        calls,
        version: VERSION,
        registry: MC,
        username: options.username ?? 'claude',
        output: '',
        interrupt_code: false,
        health: 20,
        food: 20,
        game: { dimension: 'overworld', gameMode: 'survival', minY: -64, height: 384 },
        time: { timeOfDay: 1000, day: 1 },
        entity: { position: new Vec3(start.x + 0.5, start.y, start.z + 0.5), velocity: new Vec3(0, 0, 0), height: 1.8, yaw: 0, pitch: 0, onGround: true, id: 1, type: 'player', username: options.username ?? 'claude' },
        entities: {},
        players: options.players ?? {},
        heldItem: options.held ?? null,
        modes: { isOn: () => false, pause: () => {}, unpause: () => {}, unPauseAll: () => {}, flushBehaviorLog: () => '' },
        inventory: {
            items: () => items.filter((i) => i.count > 0),
            slots: [],
            emptySlotCount: () => 36 - items.length,
            count: (id) => items.filter((i) => i.type === id).reduce((s, i) => s + i.count, 0),
            findInventoryItem: (id) => items.find((i) => i.count > 0 && (i.type === id || i.name === id)) ?? null,
        },
        blockAt: (p) => (world ? blockOf(world, p) : null),
        async dig(block) {
            calls.dug.push({ x: block.position.x, y: block.position.y, z: block.position.z, with: bot.heldItem?.name ?? null });
            world.set(block.position.x, block.position.y, block.position.z, 'air');
            if (bot.heldItem?.maxDurability) bot.heldItem.durabilityUsed += 1;
        },
        canDigBlock: () => true,
        digTime: () => 50,
        stopDigging: () => {},
        async equip(item, destination = 'hand') {
            const it = typeof item === 'number' ? items.find((i) => i.type === item) : item;
            calls.equipped.push({ name: it?.name ?? null, destination });
            if (destination === 'hand' || !destination) bot.heldItem = it ?? null;
        },
        async unequip() { bot.heldItem = null; },
        async toss(type, metadata, count) {
            const it = items.find((i) => i.type === type);
            calls.tossed.push({ name: it?.name ?? type, count });
            if (it) it.count -= count ?? 1;
        },
        async tossStack(item) {
            calls.tossed.push({ name: item.name, count: item.count });
            item.count = 0;
        },
        async activateBlock(block) {
            calls.activated.push({ name: block.name, x: block.position.x, y: block.position.y, z: block.position.z });
        },
        async activateItem() {},
        async lookAt(point) {
            calls.looked += 1;
            bot.lookingAt = point ? new Vec3(Math.floor(point.x), Math.floor(point.y), Math.floor(point.z)) : null;
        },
        blockAtCursor: (maxDistance = 256) => {
            const p = bot.lookingAt;
            if (!p || p.distanceTo(bot.entity.position) > maxDistance) return null;
            return blockOf(world, p);
        },
        async look() {},
        setControlState: () => {},
        clearControlStates: () => {},
        chat: (text) => { calls.chat.push(text); },
        whisper: () => {},
        waitForTicks: async () => {},
        nearestEntity: (filter = () => true) => Object.values(bot.entities).filter((e) => e !== bot.entity && filter(e))
            .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0] ?? null,
        findBlocks: (opts = {}) => findBlocksOf(world, bot, opts),
        findBlock: (opts = {}) => {
            const at = findBlocksOf(world, bot, { ...opts, count: 1 })[0];
            return at ? blockOf(world, at) : null;
        },
        pathfinder: {
            thinkTimeout: 5000,
            tickTimeout: 40,
            movements: null,
            goal: null,
            isMoving: () => false,
            isMining: () => false,
            isBuilding: () => false,
            setMovements(m) { bot.pathfinder.movements = m; },
            setGoal(goal) {
                bot.pathfinder.goal = goal;
                if (goal) calls.goals.push(goal);
            },
            stop() { bot.pathfinder.goal = null; },
            getPathTo(movements, goal) {
                const answer = options.paths ? options.paths(movements, goal) : { status: 'noPath', path: [] };
                return { cost: answer.path?.length ?? 0, time: 1, visitedNodes: 1, generatedNodes: 1, ...answer };
            },
            async goto(goal) {
                calls.goals.push(goal);
                const answer = options.paths ? options.paths(bot.pathfinder.movements, goal) : { status: 'noPath', path: [] };
                if (answer.status !== 'success') throw Object.assign(new Error('No path to the goal!'), { name: 'NoPath' });
                const end = answer.path[answer.path.length - 1];
                calls.walked.push(answer.path.map((m) => ({ x: m.x, y: m.y, z: m.z })));
                for (const m of answer.path)
                    for (const b of m.toBreak ?? []) calls.dug.push({ x: b.x, y: b.y, z: b.z, with: 'path' });
                if (end) bot.entity.position = new Vec3(end.x + 0.5, end.y, end.z + 0.5);
            },
        },
    });
    for (const [i, e] of (options.entities ?? []).entries()) {
        const id = 100 + i;
        bot.entities[id] = { id, ...e, position: new Vec3(e.position.x, e.position.y, e.position.z) };
    }
    return bot;
}

/** A step of a staged path: the feet cell, the blocks it breaks. */
export function move(x, y, z, toBreak = []) {
    return Object.assign(new Vec3(x, y, z), { toBreak: toBreak.map((b) => new Vec3(b.x, b.y, b.z)), toPlace: [], remainingBlocks: 0, cost: 1, parkour: false });
}
