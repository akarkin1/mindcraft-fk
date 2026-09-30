// Test helper of the home pack (spec v0.1.4.6 H): a block world in memory and a fake mineflayer bot
// on top of it, for the executing modules (doors.js, shelter.js, sleep.js, food.js, creeper.js).
// The file name ends in .test.js only because the owner of these tests may create no other files;
// run on its own it checks the fake itself (the tests below run only when this file is the main
// module, so importing it registers nothing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
const prismarineRegistry = require('prismarine-registry');

/** The real registry of 1.21.8: foods, blocks, items. Movements of the pathfinder need it. */
export const REGISTRY = prismarineRegistry('1.21.8');

const EMPTY_NAMES = new Set(['air', 'cave_air', 'void_air', 'water', 'lava', 'short_grass', 'tall_grass', 'fern', 'torch',
    'wall_torch', 'dandelion', 'poppy']);

export const v = (x, y, z) => new Vec3(x, y, z);
const key = (x, y, z) => `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;

/**
 * A block world. Default: grass at groundY, dirt 3 below it, stone deeper, air above.
 */
export function makeWorld({ groundY = 63 } = {}) {
    const blocks = new Map();
    const world = {
        groundY,
        blocks,
        unloaded: () => false,
        nameAt(x, y, z) {
            const k = key(x, y, z);
            if (blocks.has(k)) return blocks.get(k).name;
            if (y > groundY) return 'air';
            if (y === groundY) return 'grass_block';
            return y >= groundY - 3 ? 'dirt' : 'stone';
        },
        propsAt(x, y, z) {
            return blocks.get(key(x, y, z))?.props ?? {};
        },
        set(x, y, z, name, props = {}) {
            blocks.set(key(x, y, z), { name, props: { ...props } });
        },
        setProps(x, y, z, props) {
            const k = key(x, y, z);
            const cur = blocks.get(k) ?? { name: world.nameAt(x, y, z), props: {} };
            blocks.set(k, { name: cur.name, props: { ...cur.props, ...props } });
        },
        fill(x1, y1, z1, x2, y2, z2, name, props = {}) {
            for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
                for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
                    for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) world.set(x, y, z, name, props);
        },
        door(x, y, z, { name = 'oak_door', facing = 'south', open = false } = {}) {
            world.set(x, y, z, name, { facing, half: 'lower', hinge: 'left', open, powered: false });
            world.set(x, y + 1, z, name, { facing, half: 'upper', hinge: 'left', open, powered: false });
        },
        gate(x, y, z, { name = 'oak_fence_gate', facing = 'south', open = false } = {}) {
            world.set(x, y, z, name, { facing, in_wall: false, open, powered: false });
        },
        bed(x, y, z, { name = 'red_bed', facing = 'east', occupied = false } = {}) {
            const off = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[facing];
            world.set(x, y, z, name, { facing, part: 'foot', occupied });
            world.set(x + off[0], y, z + off[1], name, { facing, part: 'head', occupied });
        },
        isOpenable(name) {
            return /(_door|_fence_gate|_trapdoor)$/.test(name);
        },
        toggle(x, y, z) {
            const name = world.nameAt(x, y, z);
            const props = world.propsAt(x, y, z);
            const open = !(props.open === true);
            world.setProps(x, y, z, { open });
            if (name.endsWith('_door') && !name.endsWith('_trapdoor')) {
                const other = props.half === 'upper' ? y - 1 : y + 1;
                if (world.nameAt(x, other, z) === name) world.setProps(x, other, z, { open });
            }
        },
        block(x, y, z) {
            if (world.unloaded(x, y, z)) return null;
            const name = world.nameAt(x, y, z);
            const props = world.propsAt(x, y, z);
            const reg = REGISTRY.blocksByName[name];
            return {
                name,
                type: reg?.id ?? 0,
                position: v(Math.floor(x), Math.floor(y), Math.floor(z)),
                boundingBox: EMPTY_NAMES.has(name) ? 'empty' : 'block',
                diggable: name !== 'bedrock',
                _properties: { ...props },
                getProperties() { return { ...props }; },
            };
        },
    };
    return world;
}

/**
 * The house of the tests: walls of planks x, z 1..7, floor at y 63, roof at 68, door in the south
 * wall at (4, 64, 7). Its area box is (0, 63, 0) to (8, 69, 8), like a scan grown by one. The area is
 * of type `home` (v0.1.4.8, C4: only a home is a shelter); `type` gives another.
 */
export function buildHouse(world, { name = 'home', doorOpen = false, withDoor = true, type = 'home' } = {}) {
    world.fill(1, 63, 1, 7, 63, 7, 'oak_planks');
    world.fill(1, 68, 1, 7, 68, 7, 'oak_planks');
    for (let y = 64; y <= 67; y++) {
        for (let i = 1; i <= 7; i++) {
            world.set(i, y, 1, 'oak_planks');
            world.set(i, y, 7, 'oak_planks');
            world.set(1, y, i, 'oak_planks');
            world.set(7, y, i, 'oak_planks');
        }
    }
    if (withDoor) world.door(4, 64, 7, { facing: 'south', open: doorOpen });
    return {
        name, type, dimension: 'overworld', source: 'scan',
        min: { x: 0, y: 63, z: 0 }, max: { x: 8, y: 69, z: 8 },
        entrances: withDoor ? [{ x: 4, y: 64, z: 7, kind: 'door' }] : [],
    };
}

function goalTarget(bot, goal) {
    const pos = bot.entity.position;
    if (!goal) return null;
    if (goal.goal) {
        // GoalInvert: away from the inner goal's centre.
        const inner = goal.goal;
        const c = inner.entity ? inner.entity.position : v(inner.x + 0.5, inner.y ?? pos.y, inner.z + 0.5);
        const r = Math.sqrt(inner.rangeSq ?? 16) + 1;
        let dx = pos.x - c.x;
        let dz = pos.z - c.z;
        const len = Math.hypot(dx, dz) || 1;
        if (Math.hypot(dx, dz) === 0) dx = 1;
        dx /= len; dz /= len;
        return v(c.x + dx * r, pos.y, c.z + dz * r);
    }
    if (goal.entity) {
        const e = goal.entity.position;
        const r = Math.max(0, Math.sqrt(goal.rangeSq ?? 0) - 0.5);
        const dx = pos.x - e.x;
        const dz = pos.z - e.z;
        const len = Math.hypot(dx, dz) || 1;
        return v(e.x + dx / len * r, e.y, e.z + dz / len * r);
    }
    if (Number.isFinite(goal.x) && Number.isFinite(goal.z)) {
        const y = Number.isFinite(goal.y) ? goal.y : pos.y;
        return v(goal.x + 0.5, y, goal.z + 0.5);
    }
    return null;
}

function noPath() {
    const err = new Error('No path to the goal!');
    err.name = 'NoPath';
    return err;
}

/**
 * The default fake pathfinding: walk a straight line to the target of the goal. A closed door or
 * gate on the line is opened when the Movements may open doors, otherwise there is no path.
 * Cells in bot.blocked stop the walk with NoPath.
 */
export async function straightGoto(bot, goal) {
    const target = goalTarget(bot, goal);
    if (!target) return;
    const from = bot.entity.position.clone();
    const steps = Math.max(1, Math.ceil(from.distanceTo(target) / 0.25));
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const p = v(from.x + (target.x - from.x) * t, target.y, from.z + (target.z - from.z) * t);
        const k = key(p.x, p.y, p.z);
        if (bot.blocked.has(k)) throw noPath();
        const name = bot.world.nameAt(p.x, p.y, p.z);
        if (bot.world.isOpenable(name) && bot.world.propsAt(p.x, p.y, p.z).open !== true) {
            if (bot.pathfinder.movements?.canOpenDoors) {
                bot.calls.push(['pf_open', Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)]);
                bot.world.toggle(p.x, p.y, p.z);
            } else {
                throw noPath();
            }
        }
    }
    bot.entity.position = target.clone();
}

let nextEntityId = 100;

/**
 * The fake bot. Records its actions in bot.calls. Hooks: bot.gotoImpl(goal), bot.onActivate(block),
 * bot.activateDelayMs, bot.failActivations (number of activations that do nothing).
 */
export function makeFakeBot({ world = makeWorld(), pos = [0.5, 64, 0.5] } = {}) {
    const bot = new EventEmitter();
    bot.setMaxListeners(100);
    bot.world = world;
    bot.username = 'Bot';
    bot.calls = [];
    bot.blocked = new Set();
    bot.entity = { id: 1, name: 'player', type: 'player', position: v(...pos), velocity: v(0, 0, 0), onGround: true, height: 1.8, metadata: {} };
    bot.entities = { 1: bot.entity };
    bot.players = { Bot: { username: 'Bot', entity: bot.entity } };
    bot.game = { dimension: 'overworld', gameMode: 'survival' };
    bot.time = { timeOfDay: 6000 };
    bot.health = 20;
    bot.food = 20;
    bot.isRaining = false;
    bot.thunderState = 0;
    bot.isSleeping = false;
    bot.interrupt_code = false;
    bot.registry = REGISTRY;
    bot.heldItem = null;
    bot.activateDelayMs = 0;
    bot.failActivations = 0;
    bot.sleepMs = 20;
    bot.inventory = {
        list: [],
        items() { return this.list.filter(i => i.count > 0); },
    };
    bot.modes = { paused: [], pause(name) { this.paused.push(name); }, unpause() {} };

    bot.blockAt = (p) => world.block(p.x, p.y, p.z);
    bot.findBlocks = ({ matching, maxDistance = 16, count = 1, point = null }) => {
        const origin = (point ?? bot.entity.position).floored();
        const found = [];
        for (const k of world.blocks.keys()) {
            const [x, y, z] = k.split(',').map(Number);
            const p = v(x, y, z);
            if (p.distanceTo(origin) > maxDistance) continue;
            if (matching(world.block(x, y, z))) found.push(p);
        }
        found.sort((a, b) => a.distanceTo(origin) - b.distanceTo(origin));
        return found.slice(0, count);
    };
    bot.activateBlock = async (block) => {
        const p = block.position;
        bot.calls.push(['activate', p.x, p.y, p.z]);
        if (bot.onActivate) bot.onActivate(block);
        if (bot.failActivations > 0) {
            bot.failActivations--;
            return;
        }
        if (!world.isOpenable(world.nameAt(p.x, p.y, p.z))) return;
        if (bot.activateDelayMs > 0) setTimeout(() => world.toggle(p.x, p.y, p.z), bot.activateDelayMs);
        else world.toggle(p.x, p.y, p.z);
    };
    bot.lookAt = async () => {};
    bot.look = async () => {};
    bot.setControlState = () => {};
    bot.clearControlStates = () => { bot.calls.push(['clearControls']); };
    bot.gotoImpl = (goal) => straightGoto(bot, goal);
    bot.pathfinder = {
        movements: null,
        goal: null,
        setMovements(m) { this.movements = m; },
        setGoal(goal, dynamic = false) {
            this.goal = goal;
            bot.calls.push(['setGoal', goal, dynamic]);
            if (bot.onSetGoal) bot.onSetGoal(goal);
        },
        async goto(goal) {
            this.goal = goal;
            bot.calls.push(['goto', goal]);
            try {
                return await bot.gotoImpl(goal);
            } finally {
                this.goal = null;
            }
        },
        stop() { this.goal = null; },
        isMoving() { return false; },
        bestHarvestTool() { return null; },
    };
    bot.stopDigging = () => {};
    bot.fall = () => {
        for (let i = 0; i < 64; i++) {
            const p = bot.entity.position;
            const below = world.block(p.x, Math.floor(p.y) - 1, p.z);
            if (!below || below.boundingBox !== 'empty' || below.name === 'water') break;
            bot.entity.position = v(p.x, Math.floor(p.y) - 1, p.z);
        }
    };
    bot.dig = async (block) => {
        const p = block.position;
        bot.calls.push(['dig', p.x, p.y, p.z]);
        if (bot.digError) throw new Error(bot.digError);
        world.set(p.x, p.y, p.z, 'air');
        bot.fall();
    };
    bot.placeBlock = async (ref, face) => {
        const t = ref.position.plus(face);
        bot.calls.push(['place', t.x, t.y, t.z, bot.heldItem?.name]);
        if (!bot.heldItem || bot.heldItem.count <= 0) throw new Error('nothing in hand');
        world.set(t.x, t.y, t.z, bot.heldItem.name);
        bot.heldItem.count--;
    };
    bot.equip = async (item, dest) => {
        bot.calls.push(['equip', item?.name, dest]);
        bot.heldItem = item;
    };
    bot.consume = async () => {
        const it = bot.heldItem;
        if (!it || it.count <= 0) throw new Error('nothing to eat');
        if (bot.food >= 20) throw new Error('Food is full');
        bot.food = Math.min(20, bot.food + (REGISTRY.foodsByName[it.name]?.foodPoints ?? 0));
        it.count--;
        bot.calls.push(['consume', it.name]);
    };
    bot.sleep = async (block) => {
        bot.calls.push(['sleep', block.position.x, block.position.y, block.position.z]);
        if (bot.sleepError) throw new Error(bot.sleepError);
        const t = bot.time.timeOfDay;
        if (!(bot.isRaining && bot.thunderState > 0) && !(t >= 12541 && t <= 23458)) throw new Error("it's not night and it's not a thunderstorm");
        if (block.getProperties().occupied) throw new Error('the bed is occupied');
        bot.isSleeping = true;
        bot.sleepTimer = setTimeout(() => {
            bot.sleepTimer = null;
            if (!bot.isSleeping) return;
            bot.isSleeping = false;
            bot.emit('wake');
            // Like a server: the new time comes with a later packet (bot.timeLagMs).
            if (bot.nightPasses !== false) setTimeout(() => { bot.time.timeOfDay = 0; }, bot.timeLagMs ?? 0);
        }, bot.sleepMs);
    };
    bot.wake = async () => {
        bot.calls.push(['wake']);
        bot.isSleeping = false;
        // the night of a bot that got up does not pass any more; the file ends without waiting for it
        clearTimeout(bot.sleepTimer);
        bot.sleepTimer = null;
    };
    bot.attack = (entity) => {
        bot.calls.push(['attack', entity.id]);
        if (bot.onAttack) bot.onAttack(entity);
    };
    bot.pvp = { attack() { throw new Error('pvp must not be used'); }, stop() {} };
    return bot;
}

/** Adds a mob. Returns the entity. */
export function addMob(bot, name, pos, { type = 'hostile', metadata = {}, velocity = [0, 0, 0] } = {}) {
    const id = nextEntityId++;
    const entity = { id, name, type, position: v(...pos), velocity: v(...velocity), metadata: { ...metadata }, isValid: true, height: 1.7 };
    bot.entities[id] = entity;
    return entity;
}

/** Removes an entity like mineflayer does when it despawns. */
export function removeEntity(bot, entity) {
    entity.isValid = false;
    delete bot.entities[entity.id];
}

/** Adds another player. */
export function addPlayer(bot, username, pos) {
    const entity = addMob(bot, 'player', pos, { type: 'player' });
    entity.username = username;
    bot.players[username] = { username, entity };
    return entity;
}

/** Gives the bot items. */
export function give(bot, name, count = 1) {
    const item = { name, count, type: REGISTRY.itemsByName[name]?.id ?? 0 };
    bot.inventory.list.push(item);
    return item;
}

/**
 * A virtual clock with a simulation step: every wait moves the bot towards its pathfinder goal
 * and the creepers towards the bot. Use as options { now, wait } of the executing functions.
 */
export function makeSim(bot, { walk = 4.3, sprint = 5.6, creeperSpeed = 3.6, follow = 16, onStep = null } = {}) {
    const sim = {
        t: 1_000_000,
        steps: 0,
        now: () => sim.t,
        async wait(ms) {
            const dt = Math.max(ms, 1) / 1000;
            sim.t += Math.max(ms, 1);
            sim.steps++;
            const goal = bot.pathfinder.goal;
            const target = goalTarget(bot, goal);
            if (target) {
                const speed = bot.pathfinder.movements?.allowSprinting === false ? walk : sprint;
                const pos = bot.entity.position;
                const d = Math.hypot(target.x - pos.x, target.z - pos.z);
                const stepLen = Math.min(d, speed * dt);
                if (d > 1e-6) bot.entity.position = v(pos.x + (target.x - pos.x) / d * stepLen, pos.y, pos.z + (target.z - pos.z) / d * stepLen);
            }
            for (const e of Object.values(bot.entities)) {
                if (e.name !== 'creeper' || e.frozen) continue;
                const b = bot.entity.position;
                const d = Math.hypot(b.x - e.position.x, b.z - e.position.z);
                if (d <= follow && d > 2) {
                    const stepLen = Math.min(d - 2, creeperSpeed * dt);
                    e.position = v(e.position.x + (b.x - e.position.x) / d * stepLen, e.position.y, e.position.z + (b.z - e.position.z) / d * stepLen);
                }
            }
            if (onStep) onStep(sim);
            await Promise.resolve();
        },
    };
    return sim;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    test('fake world: doors toggle both halves, beds have two parts', () => {
        const world = makeWorld();
        world.door(0, 64, 0);
        world.toggle(0, 64, 0);
        assert.equal(world.propsAt(0, 65, 0).open, true);
        world.bed(5, 64, 5, { facing: 'east' });
        assert.equal(world.propsAt(6, 64, 5).part, 'head');
        assert.equal(world.block(0, 70, 0).boundingBox, 'empty');
        assert.equal(world.block(0, 63, 0).name, 'grass_block');
    });

    test('fake bot: straight goto opens doors only when the movements allow it', async () => {
        const world = makeWorld();
        world.door(0, 64, 2, { facing: 'south' });
        const bot = makeFakeBot({ world, pos: [0.5, 64, 0.5] });
        bot.pathfinder.setMovements({ canOpenDoors: false });
        await assert.rejects(bot.pathfinder.goto({ x: 0, y: 64, z: 4 }), { name: 'NoPath' });
        bot.pathfinder.setMovements({ canOpenDoors: true });
        await bot.pathfinder.goto({ x: 0, y: 64, z: 4 });
        assert.equal(Math.floor(bot.entity.position.z), 4);
        assert.equal(world.propsAt(0, 64, 2).open, true);
    });
}
