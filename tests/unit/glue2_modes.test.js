// Spec v0.1.4.7, section 7 "Night and work": underground the night reflex does not act.
//
// v0.1.4.8, A7 (a correction): the column of the bot cannot tell a shaft from open sky, so the two pure
// functions of v0.1.4.7 in src/agent/modes.js (depthUnderSurface, nightShelterWaits) are replaced by
// src/agent/reflex/ground_logic.js, which reads the 8 columns around the bot (tests in
// sta_ground.test.js). night_shelter waits while the bot is underground, with or without mining_pack,
// and it does nothing without a home (C4), so the agent of this file knows the place "home".
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

describe('v0.1.4.8: the depth check of v0.1.4.7 is gone from modes.js', () => {
    test('depthUnderSurface and nightShelterWaits are no exports any more', () => {
        assert.equal('depthUnderSurface' in M.modes, false);
        assert.equal('nightShelterWaits' in M.modes, false);
        assert.equal(typeof M.modes.initModes, 'function');
    });
});

describe('the mode night_shelter under the ground', () => {
    let cap;
    beforeEach(() => {
        cap = captureConsole();
    });
    afterEach(() => cap.restore());

    const ALL_OFF = { self_preservation: false, unstuck: false, cowardice: false, self_defense: false, hunting: false, item_collecting: false,
        torch_placing: false, elbow_room: false, idle_staring: false, cheat: false, creeper_safety: false, night_shelter: true, door_closing: false,
        hunger: false };
    const PLACES = { recall: (name) => (name === 'home' ? { x: 100, y: 64, z: 100, dimension: 'overworld' } : null) };

    // A night, the place "home" far away, no order, no action: the decision of v0.1.4.6 is to go. As in
    // glue_modes.test.js, runAction records the mode action without running it.
    function makeAgent(blockName, guard = undefined) {
        const bot = {
            username: 'andy', entity: { position: vec(0.5, 20, 0.5), height: 1.8 }, entities: {}, players: {},
            game: { dimension: 'overworld', gameMode: 'survival', minY: -64, height: 384 }, time: { timeOfDay: 14000 },
            health: 20, food: 20, output: '', interrupt_code: false, heldItem: null,
            inventory: { items: () => [], findInventoryItem: () => null, emptySlotCount: () => 30, slots: [] },
            findBlocks: () => [],
            blockAt: (p) => ({ name: blockName(p), position: p }),
            nearestEntity: () => null,
            areaGuard: guard,
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
            homeContext: () => ({ areas: null, places: PLACES, settings: {}, log() {}, now: () => Date.now(), skills: {}, world: {} }),
        };
        return agent;
    }

    // The mode objects are shared by all agents of the process, and night_shelter waits 60 seconds after
    // an attempt: each update runs 10 minutes of Date.now later than the one before.
    const realNow = Date.now;
    let offset = 0;
    async function update(settings, blockName, guard) {
        M.settingsModule.setSettings({ language: 'en', home_pack: true, narrate_behavior: false, ...settings });
        offset += 10 * 60 * 1000;
        Date.now = () => realNow() + offset;
        try {
            const agent = makeAgent(blockName, guard);
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
    const open = (p) => (p.y <= 19 ? 'grass_block' : 'air');
    // a shaft of ladders at the column of the bot, rock around it up to the grass at y 63
    const shaft = (p) => (p.x === 0 && p.z === 0 ? (p.y < 64 ? 'ladder' : 'air') : deep(p));

    test('mining_pack on, 43 blocks under the grass: the reflex waits', async () => {
        assert.deepEqual(await update({ mining_pack: true }, deep), []);
    });

    test('mining_pack off, 43 blocks under the grass: the reflex waits too (A7)', async () => {
        assert.deepEqual(await update({ mining_pack: false }, deep), []);
    });

    test('in a shaft of ladders under the grass: the reflex waits (R1)', async () => {
        assert.deepEqual(await update({}, shaft), []);
    });

    test('on the ground under the open sky: the reflex goes as before', async () => {
        assert.deepEqual(await update({ mining_pack: true }, open), ['mode:night_shelter']);
        assert.deepEqual(await update({ mining_pack: false }, open), ['mode:night_shelter']);
    });

    test('under a tall tree or a high roof: the reflex goes (Amendment 2, I4)', async () => {
        const tree = (p) => (p.y <= 19 ? 'grass_block' : p.y <= 34 ? 'oak_log' : p.y <= 38 ? 'oak_leaves' : 'air');
        assert.deepEqual(await update({ mining_pack: true }, tree), ['mode:night_shelter']);
        const roof = (p) => (p.y <= 19 ? 'grass_block' : p.y === 32 ? 'oak_planks' : p.y === 33 ? 'stone_bricks' : 'air');
        assert.deepEqual(await update({ mining_pack: true }, roof), ['mode:night_shelter']);
    });

    test('inside an area of type mine, also on the surface: the reflex waits', async () => {
        const guard = { areaAt: () => ({ name: 'mine', type: 'mine' }) };
        assert.deepEqual(await update({}, open, guard), []);
        const home = { areaAt: () => ({ name: 'home', type: 'home' }) };
        assert.deepEqual(await update({}, open, home), ['mode:night_shelter']);
    });
});
