// Spec v0.1.4.8 E1 (part E, engineer E5): storage. A chest counts as blocked only after an open
// failed (C4), chestsText with and without an item (C2), fetchItem answers from the index and opens
// at most 3 unknown chests within 16 blocks, and every walk and open is progress for unstuck (S15).
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
const LG = await loadSrc('src/agent/packs/storage/storage_logic.js');
const P = await loadSrc('src/agent/packs/storage/index.js');
const { ChestIndex } = await loadSrc('src/agent/packs/storage/chest_index.js');

const key = (x, y, z) => `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;

// ---- a small fake world, bot and window (like storage_actions.test.js) ----------------------

function makeItem(name, count, slot = null) {
    const entry = REGISTRY.itemsByName[name];
    assert.ok(entry, `unknown item ${name}`);
    return { name, count, type: entry.id, stackSize: entry.stackSize, slot };
}

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
        set(x, y, z, name, props = {}) {
            blocks.set(key(x, y, z), { name, props });
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
        container(x, y, z, items = []) {
            world.set(x, y, z, 'chest', { facing: 'north', type: 'single' });
            const slots = new Array(27).fill(null);
            items.forEach(([name, count], i) => { slots[i] = makeItem(name, count, i); });
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
            for (let d = dst[0]; d < dst[1]; d++) if (slots[d] && slots[d].type === type && slots[d].count < slots[d].stackSize) { target = d; break; }
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
    const bot = { world, calls: [], failOpen: new Set(), interrupt_code: false, registry: REGISTRY };
    bot.entity = { position: new Vec3(...pos), velocity: new Vec3(0, 0, 0), onGround: true, height: 1.8 };
    bot.game = { dimension: 'minecraft:overworld' };
    const slots = new Array(46).fill(null);
    items.forEach(([name, count], i) => { slots[9 + i] = makeItem(name, count, 9 + i); });
    bot.inventory = {
        inventoryStart: 9, inventoryEnd: 45, slots,
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
        const k = key(p.x, p.y, p.z);
        bot.calls.push(['open', p.x, p.y, p.z]);
        await Promise.resolve();
        if (bot.failOpen.has(k)) throw new Error('cannot open');
        const box = world.containers.get(k);
        const size = box.slots.length;
        const wslots = [...box.slots.map((it, i) => (it ? { ...it, slot: i } : null)), ...bot.inventory.slots.slice(9, 45).map((it, i) => (it ? { ...it, slot: size + i } : null))];
        return {
            slots: wslots, inventoryStart: size, inventoryEnd: size + 36,
            async deposit(type, metadata, count) {
                await Promise.resolve();
                move(wslots, type, count, [size, size + 36], [0, size]);
            },
            async withdraw(type, metadata, count) {
                await Promise.resolve();
                move(wslots, type, count, [0, size], [size, size + 36]);
            },
            close() {
                for (let i = 0; i < size; i++) box.slots[i] = wslots[i] ? { ...wslots[i], slot: i } : null;
                for (let i = 0; i < 36; i++) bot.inventory.slots[9 + i] = wslots[size + i] ? { ...wslots[size + i], slot: 9 + i } : null;
            },
        };
    };
    bot.transfer = async ({ window, itemType, count, sourceStart, sourceEnd, destStart, destEnd }) => {
        await Promise.resolve();
        move(window.slots, itemType, count, [sourceStart, sourceEnd], [destStart, destEnd]);
    };
    return bot;
}

let clockMs = 0;
const fastClock = () => ({ now: () => clockMs, wait: async (ms) => { clockMs += ms; await Promise.resolve(); } });
const makeCtx = () => ({ chests: new ChestIndex(null, { now: () => new Date(Date.UTC(2026, 8, 29)) }), settings: {}, logs: [], log(t) { this.logs.push(t); } });
const opens = bot => bot.calls.filter(c => c[0] === 'open').map(c => key(c[1], c[2], c[3]));

let cap;
beforeEach(() => {
    cap = captureConsole();
    clockMs = 0;
});
afterEach(() => {
    cap.restore();
});

// The chest index of the owner (chests.json of the play test), with wheat added for the example of the spec.
const OWNER_CHESTS = [
    { x: 11, y: 41, z: 44, dimension: 'overworld', kind: 'chest', items: {}, free_slots: 27 },
    {
        x: 11, y: 67, z: 53, dimension: 'overworld', kind: 'chest', free_slots: 14,
        items: {
            sand: 18, stone_sword: 1, white_banner: 1, coal: 39, wheat_seeds: 52, oak_slab: 5, oak_sapling: 5, lilac: 5, granite: 18, bone: 1,
            leaf_litter: 104, dirt: 27, oak_door: 2, cobblestone: 81, birch_log: 5, leather: 4, oak_log: 3, charcoal: 2, stick: 1, bone_meal: 1,
            granite_stairs: 12, feather: 2, wooden_axe: 1, wooden_shovel: 1, diorite: 18, copper_ingot: 23, rotten_flesh: 1, birch_sapling: 2,
            flint: 1, raw_copper: 52, bow: 1, ominous_bottle: 1, cobblestone_stairs: 22, spider_eye: 3, lapis_lazuli: 49, iron_ingot: 6,
            gravel: 56, white_wool: 1, wheat: 28,
        },
    },
];

function ownerIndex() {
    const index = new ChestIndex(null, { now: () => new Date(Date.UTC(2026, 8, 29)) });
    for (const c of OWNER_CHESTS) index.update(c);
    return index;
}

describe('a chest counts as blocked only after an open failed (C4)', () => {
    test('the chest at the fence of the farm: a fence above does not stop the open', async () => {
        const world = makeWorld();
        const box = world.container(-13, 63, 28);
        world.set(-13, 64, 28, 'oak_fence');
        const bot = makeBot(world, { pos: [-10.5, 64, 26.5], items: [['wheat', 12], ['dirt', 3]] });
        const ctx = makeCtx();
        const r = await S.storeItems(bot, ctx, fastClock());
        assert.equal(r.ok, true, r.text);
        assert.ok(box.slots.some(s => s?.name === 'wheat'));
        assert.ok(ctx.chests.get({ x: -13, y: 63, z: 28 }), 'in the index');
    });

    test('a solid block above: the open is tried all the same, and a chest that opens is used', async () => {
        const world = makeWorld();
        const box = world.container(3, 64, 0);
        world.set(3, 65, 0, 'stone');
        const bot = makeBot(world, { items: [['dirt', 5]] });
        const r = await S.storeItems(bot, makeCtx(), fastClock());
        assert.equal(r.text, 'I stored 5 dirt in the chest at (3, 64, 0).', cap.allText());
        assert.ok(box.slots.some(s => s?.name === 'dirt'));
    });

    test('a solid block above and the open fails: the warning says why; the result is unreachable', async () => {
        const world = makeWorld();
        world.container(3, 64, 0);
        world.set(3, 65, 0, 'stone');
        const bot = makeBot(world, { items: [['dirt', 5]] });
        bot.failOpen.add(key(3, 64, 0));
        const r = await S.storeItems(bot, makeCtx(), fastClock());
        assert.equal(r.reason, 'unreachable');
        assert.match(cap.allText(), /Storage pack: the container at \(3, 64, 0\) did not open, a solid block is above it/);
    });
});

describe('fetchItem answers from the index (E1)', () => {
    test('no known chest holds it: at most 3 chests it does not know, within 16 blocks, the nearest first', async () => {
        const world = makeWorld();
        for (const x of [2, 4, 6, 8, 10]) world.container(x, 64, 0, [['dirt', 1]]);
        world.container(20, 64, 0, [['bread', 9]]);
        world.container(-3, 64, 0, [['cobblestone', 5]]);
        const bot = makeBot(world);
        const ctx = makeCtx();
        ctx.chests.update({ x: -3, y: 64, z: 0, dimension: 'overworld', kind: 'chest', items: { cobblestone: 5 }, free_slots: 26 });
        const r = await S.fetchItem(bot, ctx, 'bread', 2, fastClock());
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'not_found');
        assert.equal(r.text, 'I know no chest with bread.');
        assert.deepEqual(opens(bot), ['2,64,0', '4,64,0', '6,64,0']);
    });

    test('found in one of the 3: taken from there', async () => {
        const world = makeWorld();
        world.container(2, 64, 0, [['dirt', 1]]);
        world.container(5, 64, 0, [['bread', 9]]);
        const bot = makeBot(world);
        const ctx = makeCtx();
        const r = await S.fetchItem(bot, ctx, 'bread', 2, fastClock());
        assert.equal(r.text, 'I took 2 bread from the chest at (5, 64, 0).');
    });

    test('every chest nearby is known: nothing is opened, the answer comes at once', async () => {
        const world = makeWorld();
        world.container(2, 64, 0, [['dirt', 1]]);
        const bot = makeBot(world);
        const ctx = makeCtx();
        ctx.chests.update({ x: 2, y: 64, z: 0, dimension: 'overworld', kind: 'chest', items: { dirt: 1 }, free_slots: 26 });
        const r = await S.fetchItem(bot, ctx, 'bread', 2, fastClock());
        assert.equal(r.text, 'I know no chest with bread.');
        assert.deepEqual(opens(bot), []);
        assert.equal(S.FETCH_LOOK_LIMIT, 3);
        assert.equal(S.FETCH_LOOK_RANGE, 16);
    });
});

describe('progress for unstuck (S15)', () => {
    test('every walk and every open notes progress "chest"', async () => {
        const world = makeWorld();
        world.container(3, 64, 0);
        const bot = makeBot(world, { items: [['dirt', 5]] });
        const noted = [];
        bot.modes = { noteProgress: (r) => noted.push(r) };
        await S.storeItems(bot, makeCtx(), fastClock());
        assert.ok(noted.length >= 4, JSON.stringify(noted));
        assert.ok(noted.every(r => r === 'chest'));
        const quiet = makeBot(world, { items: [['dirt', 5]] });
        quiet.modes = { noteProgress: () => { throw new Error('x'); } };
        const r = await S.storeItems(quiet, makeCtx(), fastClock());
        assert.equal(r.ok, true, 'a failing noteProgress changes nothing');
    });
});

describe('chestsText with and without an item (C2)', () => {
    test('an item: the example of the spec, and several chests', () => {
        const index = ownerIndex();
        assert.equal(S.chestsText(index, 'wheat'), 'wheat: 28 in the chest at (11, 67, 53). Total 28.');
        assert.equal(S.chestsText({ chests: index }, 'minecraft:Wheat', 'overworld'), 'wheat: 28 in the chest at (11, 67, 53). Total 28.');
        index.update({ x: -13, y: 63, z: 28, dimension: 'overworld', kind: 'chest', items: { wheat: 5 }, free_slots: 20 });
        assert.equal(S.chestsText(index, 'wheat'), 'wheat: 28 in the chest at (11, 67, 53), 5 in the chest at (-13, 63, 28). Total 33.');
        assert.equal(S.chestsText(index, 'bread'), 'I know no chest with bread.');
        assert.equal(S.chestsText(index, 'wheat', 'the_nether'), 'I know no chest with wheat.');
        assert.equal(S.chestsText({}, 'wheat'), 'I know no chest with wheat.');
    });

    test('without an item: up to 10 kinds per chest by count, then "and N more kinds"', () => {
        const text = S.chestsText(ownerIndex(), '');
        assert.equal(text, 'Chests I know in this world:\n'
            + '- (11, 41, 44): empty, 27 free slots\n'
            + '- (11, 67, 53): 104 leaf_litter, 81 cobblestone, 56 gravel, 52 raw_copper, 52 wheat_seeds, 49 lapis_lazuli, 39 coal, 28 wheat, '
            + '27 dirt, 23 copper_ingot and 29 more kinds, 14 free slots');
        assert.equal(T.CHEST_KINDS_MAX, 10);
    });

    test('the call of v0.1.4.7 (ctx, dimension) still lists the chests', () => {
        const ctx = { chests: ownerIndex() };
        assert.equal(S.chestsText(ctx, 'minecraft:overworld').split('\n').length, 3);
        assert.equal(S.chestsText(ctx, 'overworld').split('\n').length, 3);
        assert.equal(S.chestsText(ctx, 'the_nether'), 'I know no chests in this world.');
        assert.equal(S.chestsText(ctx).split('\n').length, 3);
        assert.equal(S.chestsText({ chests: { list() { throw new Error('x'); }, update() {} } }), 'I know no chests in this world.');
        assert.equal(S.chestsText(null, 'wheat'), 'I know no chest with wheat.');
    });

    test('itemChestsText, countsText with a limit, isDimensionName', () => {
        const c = (x, n) => ({ x, y: 64, z: 0, items: { wheat: n } });
        const many = Array.from({ length: 12 }, (_, i) => c(i, 1));
        assert.equal(T.itemChestsText('wheat', many), `wheat: ${Array.from({ length: 10 }, (_, i) => `1 in the chest at (${i}, 64, 0)`).join(', ')} and 2 more chests. Total 12.`);
        assert.equal(T.itemChestsText('wheat', [c(0, 0)]), 'I know no chest with wheat.');
        assert.equal(T.itemChestsText('wheat', null), 'I know no chest with wheat.');
        const counts = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10, k: 11 };
        assert.equal(T.countsText(counts), '11 k, 10 j, 9 i, 8 h, 7 g, 6 f and 5 more kinds', 'the default of 6 stays');
        assert.equal(T.countsText(counts, 10), '11 k, 10 j, 9 i, 8 h, 7 g, 6 f, 5 e, 4 d, 3 c, 2 b and 1 more kinds');
        assert.equal(LG.isDimensionName('minecraft:overworld'), true);
        assert.equal(LG.isDimensionName('the_end'), true);
        assert.equal(LG.isDimensionName('wheat'), false);
        assert.equal(LG.isDimensionName(3), false);
    });

    test('index.js exports the new names', () => {
        for (const name of ['itemChestsText', 'CHEST_KINDS_MAX', 'isDimensionName', 'DIMENSIONS', 'FETCH_LOOK_RANGE', 'FETCH_LOOK_LIMIT', 'chestsText']) {
            assert.ok(P[name] !== undefined, `index.js must export ${name}`);
        }
    });
});
