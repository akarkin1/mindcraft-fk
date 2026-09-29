// Test environment of the tester T1 (spec v0.1.4.8) for the real modes of src/agent/modes.js with the
// real ActionManager and the real skills.js: a fake mineflayer bot on a BlockWorld, with a fake path
// finder whose walks the test decides, and a fake agent with the fields that the modes read.
//
// Importing this file registers tests/helpers/mcdata_hooks.js (skills.js needs the minecraft data of
// src/utils/mcdata.js, which is only set at a real login). Call loadModes() once per test file.
//
// The mode objects of modes.js are shared by all agents of one process. Each new agent stands 1000
// blocks east of the last one, so what a mode remembers about a place does not carry over.
import { register } from 'node:module';
import minecraftData from 'minecraft-data';
import prismarineBlock from 'prismarine-block';
import { Vec3 } from 'vec3';
import { loadSrc } from './load.js';
import { makeTmpDir, removeTmpDir } from './tmp.js';
import { captureConsole } from './console_capture.js';
import { createBlockWorld } from './block_world.js';

register('./mcdata_hooks.js', import.meta.url);

export const REGISTRY = minecraftData('1.21.8');
const Block = prismarineBlock(REGISTRY);

/** All modes off: the profile turns on only the modes a test names. */
export const ALL_OFF = Object.freeze({ self_preservation: false, unstuck: false, cowardice: false, self_defense: false, hunting: false,
    item_collecting: false, torch_placing: false, elbow_room: false, idle_staring: false, cheat: false, hunger: false,
    creeper_safety: false, night_shelter: false, door_closing: false });

/**
 * Imports settings, mcdata, modes, action_manager and skills in an empty working folder, quietly.
 * @returns {Promise<{settingsModule, settings, modes, am, skills}>}
 */
export async function loadModes() {
    const cwd = process.cwd();
    const empty = makeTmpDir();
    const cap = captureConsole();
    process.chdir(empty);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        const mcdata = await loadSrc('src/utils/mcdata.js');
        mcdata.__setMcdataForTests(REGISTRY);
        const modes = await loadSrc('src/agent/modes.js');
        const am = await loadSrc('src/agent/action_manager.js');
        const skills = await loadSrc('src/agent/library/skills.js');
        return { settingsModule, settings: settingsModule.default, modes, am, skills };
    } finally {
        process.chdir(cwd);
        cap.restore();
        removeTmpDir(empty);
    }
}

function makeItem(name, count, slot) {
    const type = REGISTRY.itemsByName[name]?.id;
    if (type === undefined) throw new Error(`unknown item ${name}`);
    return { name, count, type, slot, metadata: 0, stackSize: REGISTRY.itemsByName[name].stackSize ?? 64 };
}

/** An inventory of 46 slots like mineflayer's: 9 to 44 main, 36 to 44 hotbar, 45 the off-hand. */
export function makeInventory() {
    const slots = new Array(46).fill(null);
    const inv = {
        slots,
        inventoryStart: 9,
        inventoryEnd: 45,
        findInventoryItem(item) {
            for (let i = 9; i < 45; i++) {
                const it = slots[i];
                if (it && (typeof item === 'number' ? it.type === item : it.name === item)) return it;
            }
            return null;
        },
        items: () => slots.slice(9, 45).filter(Boolean),
        emptySlotCount: () => slots.slice(9, 45).filter((s) => s === null).length,
        firstEmptyInventorySlot() {
            for (let i = 9; i < 45; i++) if (slots[i] === null) return i;
            return null;
        },
        put(name, count, slot = null) {
            const at = slot ?? slots.findIndex((s, i) => i >= 9 && i < 45 && s === null);
            slots[at] = makeItem(name, count, at);
            return slots[at];
        },
        add(name, count) {
            const same = slots.find((s, i) => i >= 9 && i < 45 && s && s.name === name);
            if (same) same.count += count;
            else inv.put(name, count);
        },
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

let nextId = 1000;

/**
 * The fake bot. `bot.gotoImpl(goal)` decides every walk of the path finder (default: the bot stays
 * where it is). setGoal(null) rejects a running walk with GoalChanged.
 * @param {{world?: object, pos?: number[], realBlocks?: boolean}} [options]
 *   realBlocks: blockAt gives prismarine blocks of 1.21.8 (default state), for the Movements of the
 *   path finder and block.canHarvest; else plain objects { name, position, boundingBox }.
 */
export function makeFakeBot({ world = createBlockWorld().flatGround(63), pos = [0.5, 64, 0.5], realBlocks = false } = {}) {
    const listeners = {};
    const inventory = makeInventory();
    const calls = [];
    const bot = {
        username: 'andy',
        registry: REGISTRY,
        world,
        calls,
        entity: { id: 1, name: 'player', type: 'player', position: new Vec3(...pos), height: 1.8, metadata: {}, onGround: true,
            velocity: new Vec3(0, 0, 0) },
        entities: {},
        players: {},
        game: { dimension: 'overworld', gameMode: 'survival', minY: -64, height: 384 },
        time: { timeOfDay: 1000 },
        health: 20,
        food: 20,
        foodSaturation: 5,
        lastDamageTime: 0,
        lastDamageTaken: 0,
        output: '',
        interrupt_code: false,
        targetDigBlock: null,
        currentWindow: null,
        isSleeping: false,
        usingHeldItem: false,
        quickBarSlot: 0,
        inventory,
        controlState: {},
        get heldItem() { return inventory.slots[36 + bot.quickBarSlot]; },
        blockAt(p) {
            const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
            const name = world.get(x, y, z);
            if (name === null) return null;
            if (realBlocks) {
                const block = Block.fromStateId(REGISTRY.blocksByName[name].defaultState, 0);
                block.position = new Vec3(x, y, z);
                return block;
            }
            const air = ['air', 'cave_air', 'void_air'].includes(name);
            const props = world.blockAt({ x, y, z })?._properties ?? {};
            return { name, position: new Vec3(x, y, z), boundingBox: air ? 'empty' : 'block', transparent: air, _properties: props,
                getProperties: () => ({ ...props }) };
        },
        findBlocks({ matching, maxDistance = 16, count = 1 }) {
            const me = bot.entity.position;
            const found = [];
            for (const p of world.positionsOf(() => true)) {
                if (Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z) > maxDistance) continue;
                const block = bot.blockAt(p);
                const ids = typeof matching === 'function' ? null : [].concat(matching);
                const type = block ? (block.type ?? REGISTRY.blocksByName[block.name]?.id) : null;
                if (block && (ids ? ids.includes(type) : matching(block))) found.push(new Vec3(p.x, p.y, p.z));
            }
            found.sort((a, b) => a.distanceTo(me) - b.distanceTo(me));
            return found.slice(0, count);
        },
        nearestEntity(filter = () => true) {
            let best = null;
            for (const e of Object.values(bot.entities)) {
                if (!filter(e)) continue;
                if (!best || e.position.distanceTo(bot.entity.position) < best.position.distanceTo(bot.entity.position)) best = e;
            }
            return best;
        },
        on(event, fn) { (listeners[event] ??= []).push(fn); },
        once(event, fn) { (listeners[event] ??= []).push(fn); },
        removeListener(event, fn) { listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn); },
        emit(event, ...args) { for (const fn of listeners[event] ?? []) fn(...args); },
        chat(msg) { calls.push(['chat', msg]); },
        clearControlStates() {},
        setControlState() {},
        async lookAt() {},
        async look() {},
        stopDigging() {},
        collectBlock: { cancelTask() {} },
        pvp: { attack(e) { calls.push(['attack', e.name]); }, stop() {} },
        async equip(item, destination) {
            calls.push(['equip', item?.name, destination]);
            const dest = destination === 'hand' ? 36 + bot.quickBarSlot : destination === 'off-hand' ? 45 : null;
            if (dest !== null && item.slot !== dest) inventory.move(item.slot, dest);
        },
        async unequip() {},
        async consume() {
            const it = bot.heldItem;
            if (!it) throw new Error('nothing in the hand');
            calls.push(['consume', it.name]);
            inventory.take(it.slot, 1);
            bot.food = Math.min(20, bot.food + 5);
        },
        async moveSlotItem(from, to) { inventory.move(from, to); },
        tool: { async equipForBlock() {} },
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
            if (left > 0) throw new Error(`Can't find ${type} in slots [9 - 45]`);
        },
        async dig(block) {
            calls.push(['dig', block.name]);
            world.set(block.position.x, block.position.y, block.position.z, 'air');
        },
        async activateBlock(block) { calls.push(['activateBlock', block?.name]); },
        async closeWindow() {},
        modes: { isOn: () => false, exists: () => false, pause() {}, unpause() {}, noteProgress() {} },
        pathfinder: null,
    };
    bot.pathfinder = makePathfinder(bot);
    return bot;
}

function makePathfinder(bot) {
    let reject = null;
    const pf = {
        goal: null,
        movements: null,
        goals: [],
        setMovements(m) { pf.movements = m; },
        getPathTo() { return { status: 'success', path: [] }; },
        isMoving() { return false; },
        stop() { bot.calls.push(['pathfinder.stop']); },
        setGoal(goal) {
            pf.goals.push(goal);
            pf.goal = goal;
            if (goal === null && reject) {
                const err = new Error('The goal was changed before it could be completed!');
                err.name = 'GoalChanged';
                const r = reject;
                reject = null;
                setTimeout(() => r(err), 0);
            }
        },
        goto(goal) {
            bot.calls.push(['goto', goal?.constructor?.name]);
            pf.goal = goal;
            return new Promise((resolve, rej) => {
                reject = rej;
                Promise.resolve()
                    .then(() => (bot.gotoImpl ? bot.gotoImpl(goal) : undefined))
                    .then(() => { if (reject === rej) { reject = null; resolve(); } },
                        (err) => { if (reject === rej) { reject = null; rej(err); } });
            });
        },
    };
    return pf;
}

/** A walk that never ends by itself: only setGoal(null) ends it. */
export const hang = () => new Promise(() => {});

/** A walk that fails as the path finder does when there is no path. */
export const noPath = async () => {
    const err = new Error('No path to the goal!');
    err.name = 'NoPath';
    throw err;
};

/**
 * The fake agent with a real ActionManager, after initModes. `on`: the modes the profile turns on.
 * @param {object} M the result of loadModes()
 * @param {object} bot
 * @param {{on?: string[], homeContext?: Function, packContext?: Function}} [options]
 */
export function makeFakeAgent(M, bot, options = {}) {
    const on = options.on ?? [];
    const agent = {
        name: 'andy',
        bot,
        shut_up: true,
        last_order: null,
        last_sender: null,
        kills: [],
        messages: [],
        labels: [],
        cleanKill(msg) { agent.kills.push(msg); bot.interrupt_code = true; },
        requestInterrupt(by) { bot.interrupt_code = true; bot.pathfinder.stop(); },
        clearBotLogs() { bot.output = ''; bot.interrupt_code = false; },
        isIdle: () => !agent.actions.executing,
        openChat() {},
        handleMessage(role, message) { agent.messages.push(message); },
        self_prompter: { isActive: () => false, stopLoop() {} },
        history: { add() {} },
        prompter: { getInitModes: () => ({ ...ALL_OFF, ...Object.fromEntries(on.map((name) => [name, true])) }) },
        homeContext: options.homeContext ?? (() => ({ areas: [], places: null, settings: M.settings, log() {}, now: () => Date.now(), skills: {}, world: {} })),
    };
    if (options.packContext) agent.packContext = options.packContext;
    agent.actions = new M.am.ActionManager(agent);
    const run = agent.actions.runAction.bind(agent.actions);
    agent.actions.runAction = (label, fn, opts) => {
        agent.labels.push(label);
        return run(label, fn, opts);
    };
    M.modes.initModes(agent);
    return agent;
}

/** A new position far from the last one, so the shared mode objects forget the last agent. */
let base = 0;
export function freshPos(y = 64) {
    base += 1000;
    return [base + 0.5, y, 0.5];
}

/** A dropped item entity. */
export function itemEntity(name, at) {
    const id = nextId++;
    return { id, name: 'item', type: 'object', position: new Vec3(...at), height: 0.25, metadata: {}, isValid: true,
        getDroppedItem: () => ({ name, count: 1 }) };
}

/** A mob entity. */
export function mobEntity(name, at, type = 'hostile') {
    const id = nextId++;
    return { id, name, type, position: new Vec3(...at), height: 1.95, width: 0.6, metadata: {}, isValid: true };
}
