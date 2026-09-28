// Spec v0.1.4.7, section 7 "Night and work": underground the night reflex does not act. While the
// bot is more than 8 blocks under the surface, night_shelter waits. The surface is the highest block
// above the bot that is not air, up to the height limit of the world, as bot.world tells it for the
// column of the bot. The decision is two pure functions of src/agent/modes.js; the mode uses them
// while mining_pack is on (with it off, night_shelter is the one of v0.1.4.6).
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { vec } from '../helpers/block_world.js';

async function importQuietly() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        await loadSrc('src/agent/commands/index.js');
        const modes = await loadSrc('src/agent/modes.js');
        return { settingsModule, modes };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const M = await importQuietly();
const { depthUnderSurface, nightShelterWaits } = M.modes;

// A column of blocks: names by y, air elsewhere; `unloaded` y values give null.
const column = (blocks, unloaded = []) => (x, y) => (unloaded.includes(y) ? null : blocks[y] ?? 'air');

describe('depthUnderSurface(getBlockName, pos, top) and nightShelterWaits(depth)', () => {
    test('only air above: 0', () => {
        assert.equal(depthUnderSurface(column({}), { x: 0.5, y: 64, z: 0.5 }, 320), 0);
    });

    test('the highest block that is not air counts, not the first one above the head', () => {
        // a cave ceiling at y 40, stone up to the grass at y 63, the bot stands at y 30
        const blocks = { 40: 'stone', 50: 'stone', 62: 'dirt', 63: 'grass_block' };
        assert.equal(depthUnderSurface(column(blocks), { x: 0.5, y: 30, z: 0.5 }, 320), 33);
    });

    test('cave_air and void_air are air; a block that is not loaded counts as air', () => {
        assert.equal(depthUnderSurface(column({ 70: 'cave_air', 71: 'void_air' }), { x: 0, y: 64, z: 0 }, 320), 0);
        assert.equal(depthUnderSurface(column({ 70: 'stone' }, [70]), { x: 0, y: 64, z: 0 }, 320), 0);
    });

    test('the blocks at the feet and the head do not count; the position is floored', () => {
        assert.equal(depthUnderSurface(column({ 64: 'water', 65: 'water' }), { x: 0, y: 64.2, z: 0 }, 320), 0);
        assert.equal(depthUnderSurface(column({ 66: 'stone' }), { x: 0, y: 64.9, z: 0 }, 320), 2);
    });

    // Amendment 2, I4: leaves, logs and built blocks are no surface.
    test('under a tall tree: 0', () => {
        const tree = { 73: 'oak_leaves', 74: 'oak_leaves', 75: 'azalea_leaves' };
        for (let y = 64; y <= 72; y++) tree[y] = 'oak_log';
        assert.equal(depthUnderSurface(column(tree), { x: 0.5, y: 64, z: 0.5 }, 320), 0);
        assert.equal(depthUnderSurface(column({ 70: 'dark_oak_wood', 80: 'jungle_leaves' }), { x: 0.5, y: 64, z: 0.5 }, 320), 0);
    });

    test('under a high roof: 0', () => {
        const hall = { 75: 'oak_planks', 76: 'stone_bricks', 77: 'oak_stairs', 78: 'glass', 79: 'cobblestone_slab' };
        assert.equal(depthUnderSurface(column(hall), { x: 0.5, y: 64, z: 0.5 }, 320), 0);
        assert.equal(nightShelterWaits(depthUnderSurface(column(hall), { x: 0.5, y: 64, z: 0.5 }, 320)), false);
    });

    test('a house or a tree on the ground above a mine: the ground counts', () => {
        const blocks = { 40: 'stone', 62: 'dirt', 63: 'grass_block', 64: 'oak_planks', 70: 'oak_planks', 71: 'oak_log', 72: 'oak_leaves' };
        assert.equal(depthUnderSurface(column(blocks), { x: 0.5, y: 30, z: 0.5 }, 320), 33);
    });

    test('the height limit of the world: blocks at or above it are not read', () => {
        const read = [];
        depthUnderSurface((x, y, z) => { read.push(y); return 'air'; }, { x: 3.7, y: 100, z: -2.2 }, 320);
        assert.equal(Math.max(...read), 319);
        assert.equal(Math.min(...read), 102);
        const cols = new Set();
        depthUnderSurface((x, y, z) => { cols.add(`${x},${z}`); return null; }, { x: 3.7, y: 100, z: -2.2 }, 110);
        assert.deepEqual([...cols], ['3,-3'], 'the column of the bot');
    });

    test('more than 8 blocks: the reflex waits; 8 or less: it does not', () => {
        assert.equal(nightShelterWaits(0), false);
        assert.equal(nightShelterWaits(8), false);
        assert.equal(nightShelterWaits(9), true);
        const at = (depth) => nightShelterWaits(depthUnderSurface(column({ [60 + depth]: 'stone' }), { x: 0, y: 60, z: 0 }, 320));
        assert.equal(at(8), false);
        assert.equal(at(9), true);
    });
});

describe('the mode night_shelter under the surface', () => {
    let cap;
    beforeEach(() => {
        cap = captureConsole();
    });
    afterEach(() => cap.restore());

    const ALL_OFF = { self_preservation: false, unstuck: false, cowardice: false, self_defense: false, hunting: false, item_collecting: false,
        torch_placing: false, elbow_room: false, idle_staring: false, cheat: false, creeper_safety: false, night_shelter: true, door_closing: false };

    // A night, no shelter, no order, no action: the decision of v0.1.4.6 is to go. As in glue_modes.test.js,
    // runAction records the mode action without running it.
    function makeAgent(blockName) {
        const bot = {
            username: 'andy', entity: { position: vec(0.5, 20, 0.5), height: 1.8 }, entities: {}, players: {},
            game: { dimension: 'overworld', gameMode: 'survival', minY: -64, height: 384 }, time: { timeOfDay: 14000 },
            health: 20, food: 20, output: '', interrupt_code: false, heldItem: null,
            inventory: { items: () => [], findInventoryItem: () => null, emptySlotCount: () => 30, slots: [] },
            findBlocks: () => [],
            blockAt: (p) => ({ name: blockName(p), position: p }),
            nearestEntity: () => null,
            on() {},
            once() {},
        };
        const agent = {
            name: 'andy', bot, shut_up: true, last_order: null, last_sender: null,
            isIdle: () => agent.actions.currentActionLabel === '',
            openChat() {},
            handleMessage() {},
            self_prompter: { isActive: () => false, stopLoop() {} },
            prompter: { getInitModes: () => ALL_OFF },
            actions: {
                currentActionLabel: '', resume_func: null, runs: [],
                async runAction(label) {
                    agent.actions.runs.push(label);
                    return { success: true, message: '', interrupted: true, timedout: false };
                },
            },
            homeContext: () => ({ areas: null, places: null, settings: {}, log() {}, now: () => Date.now(), skills: {}, world: {} }),
        };
        return agent;
    }

    // The mode objects are shared by all agents of the process, and night_shelter waits 60 seconds after
    // an attempt: each update runs 10 minutes of Date.now later than the one before.
    const realNow = Date.now;
    let offset = 0;
    async function update(settings, blockName) {
        M.settingsModule.setSettings({ language: 'en', home_pack: true, narrate_behavior: false, ...settings });
        offset += 10 * 60 * 1000;
        Date.now = () => realNow() + offset;
        try {
            const agent = makeAgent(blockName);
            M.modes.initModes(agent);
            assert.equal(agent.bot.modes.isOn('night_shelter'), true);
            await agent.bot.modes.update();
            await new Promise((resolve) => setTimeout(resolve, 5));
            return agent.actions.runs;
        } finally {
            Date.now = realNow;
        }
    }

    const deep = (p) => (p.y === 63 ? 'grass_block' : p.y > 21 && p.y < 63 ? 'stone' : 'air');
    const open = () => 'air';

    test('mining_pack on, 43 blocks under the grass: the reflex waits', async () => {
        assert.deepEqual(await update({ mining_pack: true }, deep), []);
    });

    test('mining_pack on, under the open sky: the reflex goes as before', async () => {
        assert.deepEqual(await update({ mining_pack: true }, open), ['mode:night_shelter']);
    });

    test('mining_pack on, under a tall tree or a high roof: the reflex goes (Amendment 2, I4)', async () => {
        const tree = (p) => (p.y >= 20 && p.y <= 34 ? 'oak_log' : p.y > 34 && p.y <= 38 ? 'oak_leaves' : 'air');
        assert.deepEqual(await update({ mining_pack: true }, tree), ['mode:night_shelter']);
        const roof = (p) => (p.y === 32 ? 'oak_planks' : p.y === 33 ? 'stone_bricks' : 'air');
        assert.deepEqual(await update({ mining_pack: true }, roof), ['mode:night_shelter']);
    });

    test('mining_pack off: the reflex of v0.1.4.6, also deep under the surface', async () => {
        assert.deepEqual(await update({ mining_pack: false }, deep), ['mode:night_shelter']);
    });
});
