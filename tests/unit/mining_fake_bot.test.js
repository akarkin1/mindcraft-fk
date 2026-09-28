// Test helper of the mining pack (spec v0.1.4.7 M): a deep block world in memory and a fake
// mineflayer bot with a small physics: it walks with the controls, falls, slides down ladders at
// 0.15 blocks a tick, climbs a ladder when it walks against the wall, jumps. A fake clock moves the
// physics on in 50 ms ticks. The file name ends in .test.js only because the owner of these tests
// may create no other files; run on its own it checks the fake itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
const prismarineRegistry = require('prismarine-registry');

/** The real registry of 1.21.8. */
export const REGISTRY = prismarineRegistry('1.21.8');
export const v = (x, y, z) => new Vec3(x, y, z);
const key = (x, y, z) => `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;

const DROPS = { stone: 'cobblestone', grass_block: 'dirt', deepslate: 'cobbled_deepslate', iron_ore: 'raw_iron', deepslate_iron_ore: 'raw_iron',
    coal_ore: 'coal', gold_ore: 'raw_gold', diamond_ore: 'diamond', ladder: 'ladder', torch: 'torch', chest: 'chest' };
const FALLING = new Set(['gravel', 'sand']);
const REPLACEABLE = new Set(['air', 'cave_air', 'void_air', 'water', 'lava', 'short_grass']);

/**
 * A deep world: grass at groundY, 3 of dirt, stone down to minY + 1, bedrock at minY, air above.
 */
export function makeWorld({ groundY = 63, minY = -64 } = {}) {
    const blocks = new Map();
    const world = {
        groundY,
        minY,
        blocks,
        unloaded: () => false,
        nameAt(x, y, z) {
            const k = key(x, y, z);
            if (blocks.has(k)) return blocks.get(k).name;
            if (y > groundY) return 'air';
            if (y === groundY) return 'grass_block';
            if (y <= minY) return 'bedrock';
            return y >= groundY - 3 ? 'dirt' : 'stone';
        },
        propsAt(x, y, z) {
            return blocks.get(key(x, y, z))?.props ?? {};
        },
        set(x, y, z, name, props = {}) {
            blocks.set(key(x, y, z), { name, props: { ...props } });
            return world;
        },
        fill(x1, y1, z1, x2, y2, z2, name, props = {}) {
            for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
                for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
                    for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) world.set(x, y, z, name, props);
            return world;
        },
        solid(x, y, z) {
            const name = world.nameAt(x, y, z);
            const reg = REGISTRY.blocksByName[name];
            return name !== 'ladder' && (reg?.boundingBox ?? 'block') === 'block';
        },
        block(x, y, z) {
            if (world.unloaded(Math.floor(x), Math.floor(y), Math.floor(z))) return null;
            const name = world.nameAt(x, y, z);
            const props = world.propsAt(x, y, z);
            const reg = REGISTRY.blocksByName[name];
            return {
                name,
                type: reg?.id ?? 0,
                position: v(Math.floor(x), Math.floor(y), Math.floor(z)),
                boundingBox: reg?.boundingBox ?? 'block',
                diggable: reg ? reg.diggable !== false && name !== 'bedrock' : true,
                _properties: { ...props },
                getProperties() { return { ...props }; },
            };
        },
    };
    return world;
}

let nextId = 100;

function makeItem(name, count, slot, used = 0) {
    const reg = REGISTRY.itemsByName[name];
    const item = { name, count, type: reg?.id ?? 0, slot, stackSize: reg?.stackSize ?? 64 };
    if (reg?.maxDurability) {
        item.maxDurability = reg.maxDurability;
        item.durabilityUsed = used;
    }
    return item;
}

/** Gives items; tools can come used. Returns the item. */
export function give(bot, name, count = 1, { used = 0 } = {}) {
    const stack = bot.inventory.list.find(i => i.name === name && i.count > 0 && !i.maxDurability && i.count < i.stackSize);
    if (stack) {
        stack.count += count;
        return stack;
    }
    const slot = 9 + bot.inventory.list.length;
    const item = makeItem(name, count, slot, used);
    bot.inventory.list.push(item);
    return item;
}

export function count(bot, name) {
    return bot.inventory.list.filter(i => i.name === name).reduce((s, i) => s + i.count, 0);
}

// the box of the bot: 0.6 wide, 1.8 high
function boxHits(world, x, y, z) {
    for (const dx of [-0.299, 0.299]) {
        for (const dz of [-0.299, 0.299]) {
            for (const dy of [0.001, 0.9, 1.799]) {
                if (world.solid(Math.floor(x + dx), Math.floor(y + dy), Math.floor(z + dz))) return true;
            }
        }
    }
    return false;
}

function supported(world, x, y, z) {
    if (Math.abs(y - Math.round(y)) > 0.01) return false;
    for (const dx of [-0.299, 0.299]) {
        for (const dz of [-0.299, 0.299]) {
            if (world.solid(Math.floor(x + dx), Math.round(y) - 1, Math.floor(z + dz))) return true;
        }
    }
    return false;
}

/** One tick of 50 ms of the physics of the fake bot. */
export function tick(bot) {
    const e = bot.entity;
    const w = bot.world;
    const c = bot.controls;
    let collided = false;
    if (c.forward) {
        const speed = c.sneak ? 0.06 : 0.2;
        const dx = -Math.sin(bot.yaw) * speed;
        const dz = -Math.cos(bot.yaw) * speed;
        if (dx !== 0) {
            if (!boxHits(w, e.position.x + dx, e.position.y, e.position.z)) e.position.x += dx;
            else collided = true;
        }
        if (dz !== 0) {
            if (!boxHits(w, e.position.x, e.position.y, e.position.z + dz)) e.position.z += dz;
            else collided = true;
        }
    }
    e.isCollidedHorizontally = collided;
    const onLadder = w.nameAt(e.position.x, e.position.y, e.position.z) === 'ladder';
    let vy = e.velocity.y;
    if (onLadder && collided) vy = 0.2;
    else if (c.jump && e.onGround) vy = 0.42;
    else vy = onLadder ? Math.max(vy - 0.08, c.sneak ? 0 : -0.15) : Math.max(vy - 0.08, -3.9);
    let y = e.position.y + vy;
    if (vy < 0) {
        const floorY = Math.floor(e.position.y) - (Math.abs(e.position.y - Math.round(e.position.y)) < 0.01 ? 1 : 0);
        for (let fy = Math.floor(e.position.y - 0.001); fy >= Math.floor(y); fy--) {
            if ([-0.299, 0.299].some(dx => [-0.299, 0.299].some(dz => w.solid(Math.floor(e.position.x + dx), fy, Math.floor(e.position.z + dz))))) {
                y = Math.max(y, fy + 1);
                break;
            }
        }
        void floorY;
    } else if (vy > 0 && boxHits(w, e.position.x, y, e.position.z)) {
        y = e.position.y;
        vy = 0;
    }
    if (vy < 0 && Math.abs(y - Math.round(y)) < 0.001 && supported(w, e.position.x, Math.round(y), e.position.z)) {
        y = Math.round(y);
        vy = 0;
    }
    e.position.y = y;
    e.velocity.y = vy;
    e.onGround = supported(w, e.position.x, e.position.y, e.position.z) && vy <= 0;
    if (e.onGround) e.velocity.y = 0;
    // pick up items nearby
    for (const ent of Object.values(bot.entities)) {
        if (ent?.name === 'item' && Math.hypot(ent.position.x - e.position.x, ent.position.z - e.position.z) < 1.3
            && ent.position.y >= e.position.y - 0.5 && ent.position.y <= e.position.y + 2.3) {
            give(bot, ent.item, ent.count ?? 1);
            delete bot.entities[ent.id];
        }
    }
}

/** A fake clock: `wait` moves the physics of the bot on, one tick per 50 ms. */
export function makeClock(bot, { start = 1_000_000 } = {}) {
    let t = start;
    const clock = {
        now: () => t,
        async wait(ms) {
            const before = t;
            t += Math.max(1, ms);
            const ticks = Math.floor(t / 50) - Math.floor(before / 50);
            for (let i = 0; i < ticks; i++) {
                if (bot) tick(bot);
                if (clock.onTick) clock.onTick(t);
            }
            await new Promise(r => setImmediate(r));
        },
        advance(ms) {
            t += ms;
        },
    };
    return clock;
}

function standable(world, p) {
    return !world.solid(p.x, p.y, p.z) && !world.solid(p.x, p.y + 1, p.z) && world.solid(p.x, p.y - 1, p.z);
}

function noPath() {
    const err = new Error('No path to the goal!');
    err.name = 'NoPath';
    return err;
}

/**
 * The fake bot. Records its actions in bot.calls. bot.noPath (a Set of keys or true) makes goto fail.
 */
export function makeMiningBot({ world = makeWorld(), pos = [0.5, 64, 0.5] } = {}) {
    const bot = new EventEmitter();
    bot.setMaxListeners(100);
    bot.world = world;
    bot.username = 'Bot';
    bot.calls = [];
    bot.noPath = null;
    bot.entity = { id: 1, name: 'player', type: 'player', position: v(...pos), velocity: v(0, 0, 0), onGround: true, height: 1.8 };
    bot.entities = { 1: bot.entity };
    bot.game = { dimension: 'overworld', gameMode: 'survival', minY: world.minY };
    bot.health = 20;
    bot.food = 20;
    bot.interrupt_code = false;
    bot.registry = REGISTRY;
    bot.heldItem = null;
    bot.yaw = 0;
    bot.pitch = 0;
    bot.controls = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false };
    bot.inventory = {
        list: [],
        items() { return this.list.filter(i => i.count > 0); },
        emptySlotCount() { return Math.max(0, 36 - this.items().length); },
    };
    bot.blockAt = (p) => world.block(p.x, p.y, p.z);
    bot.setControlState = (k, val) => { bot.controls[k] = Boolean(val); };
    bot.clearControlStates = () => { for (const k of Object.keys(bot.controls)) bot.controls[k] = false; };
    bot.look = async (yaw, pitch) => { bot.yaw = yaw; bot.pitch = pitch; };
    bot.lookAt = async (p) => {
        const dx = p.x - bot.entity.position.x;
        const dz = p.z - bot.entity.position.z;
        if (dx !== 0 || dz !== 0) bot.yaw = Math.atan2(-dx, -dz);
    };
    bot.digTime = () => 500;
    bot.stopDigging = () => {};
    bot.dig = async (block) => {
        const p = block.position;
        bot.calls.push(['dig', p.x, p.y, p.z, block.name]);
        if (bot.digError) throw new Error(bot.digError);
        const name = world.nameAt(p.x, p.y, p.z);
        world.set(p.x, p.y, p.z, 'air');
        const drop = DROPS[name] ?? name;
        if (bot.dropsAsEntities && /ore$/.test(name)) {
            const id = nextId++;
            bot.entities[id] = { id, name: 'item', item: drop, count: 1, position: v(p.x + 0.5, p.y, p.z + 0.5) };
        } else if (drop !== 'air' && REGISTRY.itemsByName[drop]) {
            give(bot, drop, 1);
        }
        if (bot.heldItem?.maxDurability) bot.heldItem.durabilityUsed = (bot.heldItem.durabilityUsed ?? 0) + 1;
        // gravel and sand fall into the hole
        let y = p.y + 1;
        while (FALLING.has(world.nameAt(p.x, y, p.z))) {
            world.set(p.x, y - 1, p.z, world.nameAt(p.x, y, p.z));
            world.set(p.x, y, p.z, 'air');
            y++;
        }
    };
    bot.placeBlock = async (ref, face) => {
        const t = ref.position.plus(face);
        const item = bot.heldItem;
        bot.calls.push(['place', t.x, t.y, t.z, item?.name]);
        if (bot.placeError) throw new Error(bot.placeError);
        if (!item || item.count <= 0) throw new Error('nothing in hand');
        if (!REPLACEABLE.has(world.nameAt(t.x, t.y, t.z))) throw new Error('not replaceable');
        const e = bot.entity.position;
        const inBot = Math.abs(t.x + 0.5 - e.x) < 0.8 && Math.abs(t.z + 0.5 - e.z) < 0.8 && t.y >= Math.floor(e.y) - 0 && t.y <= Math.floor(e.y + 1.79);
        if (item.name === 'ladder') {
            // the ladder takes 3/16 of the cell at the wall; the server refuses it when the bot is in it
            const facing = face.x === 1 ? 'east' : face.x === -1 ? 'west' : face.z === 1 ? 'south' : 'north';
            const along = (e.x - (t.x + 0.5)) * face.x + (e.z - (t.z + 0.5)) * face.z;
            if (inBot && Math.floor(e.x) === t.x && Math.floor(e.z) === t.z && along < -0.0125) throw new Error('entity in the way');
            world.set(t.x, t.y, t.z, 'ladder', { facing });
        } else if (item.name === 'torch') {
            world.set(t.x, t.y, t.z, face.y === 1 ? 'torch' : 'wall_torch');
        } else {
            if (inBot && Math.abs(t.x + 0.5 - e.x) < 0.8 && Math.abs(t.z + 0.5 - e.z) < 0.8 && Math.floor(e.x) === t.x && Math.floor(e.z) === t.z) {
                throw new Error('entity in the way');
            }
            world.set(t.x, t.y, t.z, item.name);
        }
        item.count--;
    };
    bot.equip = async (item) => {
        bot.calls.push(['equip', item?.name]);
        if (!item || item.count <= 0) throw new Error('no item');
        bot.heldItem = item;
    };
    bot.consume = async () => {
        const it = bot.heldItem;
        if (!it || it.count <= 0) throw new Error('nothing to eat');
        bot.food = Math.min(20, bot.food + (REGISTRY.foodsByName[it.name]?.foodPoints ?? 0));
        it.count--;
        bot.calls.push(['consume', it.name]);
    };
    bot.pathfinder = {
        movements: null,
        goal: null,
        setMovements(m) { this.movements = m; },
        setGoal(goal) { this.goal = goal; },
        async goto(goal) {
            bot.calls.push(['goto', goal?.x, goal?.y, goal?.z]);
            const target = { x: goal.x, y: goal.y, z: goal.z };
            if (bot.noPath === true || bot.noPath?.has?.(key(target.x, target.y, target.z))) throw noPath();
            const range = Math.sqrt(goal.rangeSq ?? 0);
            const cells = [target];
            for (let r = 1; r <= Math.floor(range); r++) {
                for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
                    for (const dy of [0, -1, 1]) cells.push({ x: target.x + dx, y: target.y + dy, z: target.z + dz });
                }
            }
            const cell = cells.find(c => standable(world, c));
            if (!cell) throw noPath();
            bot.entity.position = v(cell.x + 0.5, cell.y, cell.z + 0.5);
            bot.entity.velocity = v(0, 0, 0);
            bot.entity.onGround = true;
        },
        stop() { this.goal = null; },
        bestHarvestTool() { return null; },
    };
    return bot;
}

/** A pack context with an in-memory mine store. */
export async function makeCtx(clock, extra = {}) {
    const { MineStore } = await import(pathToFileURL(require.resolve('../../src/agent/packs/mining/mine_store.js')).href);
    const logs = [];
    const places = new Map();
    return {
        mines: new MineStore(null, { now: () => new Date(clock.now()) }),
        areas: [],
        places: { remember(name, x, y, z, dimension) { places.set(name, { x, y, z, dimension }); }, recall: n => places.get(n) },
        settings: {},
        log: t => logs.push(t),
        logs,
        now: clock.now,
        ...extra,
    };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    test('the fake bot falls, stands, climbs a ladder against the wall and slides down', async () => {
        const world = makeWorld();
        const bot = makeMiningBot({ world, pos: [0.5, 64, 0.5] });
        const clock = makeClock(bot);
        world.fill(0, 50, 0, 0, 63, 0, 'ladder', { facing: 'north' });
        await clock.wait(6000);
        assert.equal(bot.entity.position.y, 50, 'slid to the bottom');
        bot.yaw = Math.PI;
        bot.setControlState('forward', true);
        await clock.wait(6000);
        assert.ok(bot.entity.position.y >= 64, `climbed out, y ${bot.entity.position.y}`);
    });
}
