// Spec v0.1.4.6 G5 and Amendment 1 (part G) in src/agent/library/skills.js:
//   - collectBlock: a block that the area guard does not allow is no candidate; when every
//     candidate was refused for that reason, the output says so and the search range doubles once;
//   - without bot.areaGuard collectBlock is unchanged;
//   - useDoor without a position does not throw when no oak door is near (G6).
//
// The bot is a fake over a small block world (tests/helpers/block_world.js) with real blocks of
// prismarine-block for 1.21.8, so the real Movements of mineflayer-pathfinder can judge them. The
// real area store and area guard of part A are used.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import minecraftData from 'minecraft-data';
import prismarineBlock from 'prismarine-block';
import { Vec3 } from 'vec3';
import pf from 'mineflayer-pathfinder';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { register } from 'node:module';

// world.getNearestBlock needs the minecraft-data object of mcdata.js (see commands_places.test.js)
register('../helpers/mcdata_hooks.js', import.meta.url);
const mcdata = await loadSrc('src/utils/mcdata.js');
const skills = await loadSrc('src/agent/library/skills.js');
const AS = await loadSrc('src/agent/areas/area_store.js');
const AG = await loadSrc('src/agent/areas/area_guard.js');

const registry = minecraftData('1.21.8');
const Block = prismarineBlock(registry);
mcdata.__setMcdataForTests(registry);

// A fake bot in the block world. collectBlock.collect removes the block and records it.
function makeBot(world, at) {
    const collected = [];
    const floorVec = (p) => new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    const bot = {
        username: 'andy',
        registry,
        output: '',
        interrupt_code: false,
        entity: { position: new Vec3(at.x, at.y, at.z) },
        entities: {},
        game: { dimension: 'overworld', gameMode: 'survival' },
        heldItem: null,
        modes: { isOn: () => false, pause() {}, unpause() {} },
        tool: { async equipForBlock() {} },
        inventory: { findInventoryItem: () => null },
        on() {},
        once() {},
        blockAt(pos) {
            const p = floorVec(pos);
            const name = world.get(p.x, p.y, p.z);
            if (name === null) return null;
            const block = Block.fromStateId(registry.blocksByName[name].defaultState, 0);
            block.position = p;
            return block;
        },
        findBlocks({ matching, maxDistance, count }) {
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
        collectBlock: {
            async collect(block) {
                collected.push({ x: block.position.x, y: block.position.y, z: block.position.z });
                world.set(block.position.x, block.position.y, block.position.z, 'air');
            },
        },
        collected,
    };
    return bot;
}

let dir;
let cap;
beforeEach(() => {
    dir = makeTmpDir();
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

// A house of planks with posts of oak logs, protected as "home", and a tree at the given x.
function scene(treeX) {
    const world = createBlockWorld().flatGround(63);
    const house = world.house({ x: 0, y: 63, z: 0 });
    const tree = treeX === null ? null : world.tree({ x: treeX, y: 63, z: 3 });
    const store = new AS.AreaStore(path.join(dir, 'areas.json'));
    store.load();
    store.set({ name: 'home', type: 'building', min: house.min, max: house.max, source: 'manual' });
    const houseLogs = world.positionsOf('oak_log').filter((p) => p.x <= house.max.x);
    return { world, house, tree, store, houseLogs };
}

const inside = (house) => ({ x: house.inside.x + 0.5, y: house.inside.y, z: house.inside.z + 0.5 });
const MESSAGE = 'All oak_log blocks nearby belong to a protected area. I look for others farther away.';

describe('collectBlock with the area guard', () => {
    test('the logs of the house are no candidates: the logs of the tree are taken', async () => {
        const { world, house, store, houseLogs } = scene(20);
        const bot = makeBot(world, inside(house));
        AG.installAreaGuard(bot, { store, log() {} });
        assert.ok(houseLogs.length > 0);
        assert.equal(await skills.collectBlock(bot, 'oak_log', 2), true);
        assert.equal(bot.collected.length, 2);
        assert.ok(bot.collected.every((p) => p.x >= 20), JSON.stringify(bot.collected));
        assert.ok(houseLogs.every((p) => world.get(p.x, p.y, p.z) === 'oak_log'), 'every log of the house is still there');
        assert.ok(!bot.output.includes('protected area'), bot.output);
        assert.ok(bot.output.includes('Collected 2 oak_log.'));
    });

    test('every candidate within 64 blocks is refused: the text of the spec once, then the range is 128', async () => {
        const { world, house, store, houseLogs } = scene(100);
        const bot = makeBot(world, inside(house));
        AG.installAreaGuard(bot, { store, log() {} });
        assert.equal(await skills.collectBlock(bot, 'oak_log', 2), true);
        assert.equal(bot.output.split(MESSAGE).length - 1, 1, bot.output);
        assert.deepEqual(bot.collected.map((p) => p.x), [100, 100]);
        assert.ok(houseLogs.every((p) => world.get(p.x, p.y, p.z) === 'oak_log'));
    });

    test('nothing allowed even farther away: the text once, then as before', async () => {
        const { world, house, store } = scene(null);
        const bot = makeBot(world, inside(house));
        AG.installAreaGuard(bot, { store, log() {} });
        assert.equal(await skills.collectBlock(bot, 'oak_log', 1), false);
        assert.equal(bot.output, `${MESSAGE}\nNo oak_log nearby to collect.\nCollected 0 oak_log.\n`);
        assert.deepEqual(bot.collected, []);
    });

    test('a permit of the guard opens the area', async () => {
        const { world, house, store } = scene(null);
        const bot = makeBot(world, inside(house));
        const guard = AG.installAreaGuard(bot, { store, log() {} });
        guard.permit('home', 5); // the full guard of the agent (F2): bot.areaGuard has no permit
        assert.equal(await skills.collectBlock(bot, 'oak_log', 1), true);
        assert.equal(bot.collected.length, 1);
        assert.ok(!bot.output.includes('protected area'));
    });

    test('F4: the ground under the floor of the house is no candidate, the dirt outside is taken', async () => {
        // Found on the real server: from inside the closed house the nearest dirt was 2 blocks under
        // the floor, one block below the scanned box; the only way to it led through the floor.
        const world = createBlockWorld().flatGround(63);
        world.fill(-8, 60, -8, 14, 62, 14, 'dirt');
        const house = world.house({ x: 0, y: 63, z: 0 });
        const store = new AS.AreaStore(path.join(dir, 'areas.json'));
        store.load();
        const box = { min: { x: house.min.x - 1, y: house.min.y - 1, z: house.min.z - 1 }, max: { x: house.max.x + 1, y: house.max.y + 1, z: house.max.z + 1 } };
        store.set({ name: 'home', type: 'building', min: box.min, max: box.max, source: 'scan' });
        const bot = makeBot(world, inside(house));
        AG.installAreaGuard(bot, { store, log() {} });
        assert.equal(world.get(house.inside.x, 61, house.inside.z), 'dirt', 'dirt 2 blocks under the floor, below the box');
        assert.equal(await skills.collectBlock(bot, 'dirt', 3), true);
        assert.equal(bot.collected.length, 3);
        const underHouse = (p) => p.x >= box.min.x && p.x <= box.max.x && p.z >= box.min.z && p.z <= box.max.z;
        assert.equal(bot.collected.some(underHouse), false, JSON.stringify(bot.collected));
    });

    test('F4: without a guard the dirt under the floor is still the nearest (unchanged)', async () => {
        const world = createBlockWorld().flatGround(63);
        world.fill(-8, 60, -8, 14, 62, 14, 'dirt');
        const house = world.house({ x: 0, y: 63, z: 0 });
        const bot = makeBot(world, inside(house));
        assert.equal(await skills.collectBlock(bot, 'dirt', 1), true);
        assert.deepEqual(bot.collected, [{ x: house.inside.x, y: 62, z: house.inside.z }]);
    });

    test('without bot.areaGuard: unchanged, the nearest log is taken, also from the house', async () => {
        const { world, house, houseLogs } = scene(20);
        const bot = makeBot(world, inside(house));
        assert.equal(await skills.collectBlock(bot, 'oak_log', 1), true);
        assert.ok(houseLogs.some((p) => p.x === bot.collected[0].x && p.y === bot.collected[0].y && p.z === bot.collected[0].z), 'a log of the house');
        assert.equal(bot.output, 'Collected 1 oak_log.\n');
    });
});

describe('the guard and diagonal steps of the path finder', () => {
    // Found on the real server: walking around a protected house, the path finder planned a diagonal
    // step past the corner post; the bot could not slide past it and the path finder reset "stuck"
    // for ever. With the guard, such a step is left out.
    test('no diagonal step past the corner of a protected house; other diagonals as before', () => {
        const { world, house, store } = scene(null);
        const bot = makeBot(world, { x: house.max.x + 0.5, y: 64, z: house.max.z + 1.5 });
        AG.installAreaGuard(bot, { store, log() {} });
        bot.pathfinder = { bestHarvestTool: () => null }; // what Movements asks for a block it might break
        const guarded = new pf.Movements(bot);
        assert.equal(bot.areaGuard.protectMovements(guarded), true);
        const plain = new pf.Movements(bot);
        const node = { x: house.max.x, y: 64, z: house.max.z + 1, remainingBlocks: 0 }; // south of the corner post
        const dir = { x: 1, z: -1 }; // to the cell east of the post
        const a = [];
        plain.getMoveDiagonal(node, dir, a);
        assert.equal(a.length, 1, 'without the guard the path finder cuts the corner');
        const b = [];
        guarded.getMoveDiagonal(node, dir, b);
        assert.deepEqual(b, [], 'with the guard it does not');
        const open = [];
        guarded.getMoveDiagonal({ x: 20, y: 64, z: 20, remainingBlocks: 0 }, { x: 1, z: 1 }, open);
        assert.equal(open.length, 1, 'a diagonal in the open is allowed');
        // a tree trunk whose lowest log was taken: the next log hangs at the height of the head
        world.set(30, 65, 30, 'oak_log');
        const trunk = { x: 30, y: 64, z: 31, remainingBlocks: 0 };
        const c = [];
        plain.getMoveDiagonal(trunk, { x: 1, z: -1 }, c);
        assert.equal(c.length, 1, 'without the guard the path finder cuts past the log at head height');
        const d = [];
        guarded.getMoveDiagonal(trunk, { x: 1, z: -1 }, d);
        assert.deepEqual(d, [], 'with the guard it does not');
        const neighbors = guarded.getNeighbors(node);
        assert.ok(neighbors.some((n) => n.x === house.max.x + 1 && n.z === house.max.z + 1), 'the step east is still there');
        assert.equal(bot.areaGuard.protectMovements(guarded), true, 'a second call does not wrap again');
    });
});

describe('useDoor without a position (G6)', () => {
    test('no door near: the text, no TypeError', async () => {
        const world = createBlockWorld().flatGround(63);
        const bot = makeBot(world, { x: 0.5, y: 64, z: 0.5 });
        assert.equal(await skills.useDoor(bot), false);
        assert.ok(bot.output.includes('Could not find a door to use.'));
    });
});
