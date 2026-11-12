// E3, spec v0.1.4.16 F5 (the play of 2026-11-11: a table craft broken by the reflex unstuck): skills.craftRecipe runs with
// the mode unstuck paused (bot.modes.pause('unstuck'), the call of pauseUnstuck of actions.js, which every pack command
// makes); the modes release the pause when the bot is idle again, as for a pack command. A bot without modes crafts as
// before. The skills module is imported with an empty temp directory as working directory (nothing may read a keys.json).
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import minecraftData from 'minecraft-data';
import { loadSrc, TEST_MC_VERSION } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

register('../helpers/mcdata_hooks.js', import.meta.url);

async function importModules() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const skills = await loadSrc('src/agent/library/skills.js');
        const mcdata = await loadSrc('src/utils/mcdata.js');
        return { skills, mcdata };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const { skills, mcdata } = await importModules();
const REAL_DATA = minecraftData(TEST_MC_VERSION);

// A bot that records what happens in order: the pause of the modes, the recipe lookup, the craft. With `craftable` the
// recipe lookup gives one recipe (sticks from 2 planks, in the shape prismarine-recipe gives: unshaped ingredients carry
// negative counts) and bot.craft succeeds.
function makeBot({ modes = true, craftable = false } = {}) {
    const planks = REAL_DATA.itemsByName.oak_planks.id;
    const slots = craftable ? [{ name: 'oak_planks', count: 4, type: planks }] : [];
    const bot = {
        username: 'andy',
        output: '',
        interrupt_code: false,
        entity: { position: { x: 0, y: 64, z: 0, distanceTo: () => 0 } },
        calls: [],
        recipesFor(id, meta, min, table) {
            bot.calls.push(['recipesFor', table]);
            return craftable && table === null ? [{ result: { id, count: 4 }, delta: [{ id: planks, count: -2 }], inShape: null, ingredients: [{ id: planks, count: -2 }] }] : [];
        },
        inventory: { items: () => slots.filter(i => i.count > 0), slots },
        craft: async () => { bot.calls.push(['craft']); slots[0].count -= 2; slots.push({ name: 'stick', count: 4, type: REAL_DATA.itemsByName.stick.id }); },
        armorManager: { equipAll() {} },
    };
    if (modes) {
        bot.modes = {
            pause(name) { bot.calls.push(['pause', name]); },
            unpause(name) { bot.calls.push(['unpause', name]); },
        };
    }
    return bot;
}

let cap;
beforeEach(() => {
    cap = captureConsole();
    mcdata.__setMcdataForTests(REAL_DATA);
});
afterEach(() => {
    cap.restore();
    mcdata.__setMcdataForTests(null);
});

describe('F5: the craft and the reflex unstuck', () => {
    test('craftRecipe pauses the mode unstuck first, before the recipe lookup, and never unpauses it itself (the idle release of the modes does)', async () => {
        const bot = makeBot();
        const ok = await skills.craftRecipe(bot, 'stick', 1);
        assert.equal(ok, false, 'no resources: the craft ends early');
        assert.deepEqual(bot.calls[0], ['pause', 'unstuck'], bot.calls.map(c => c.join(':')).join(' | '));
        assert.ok(bot.calls.some(c => c[0] === 'recipesFor'), 'the lookup came after the pause');
        assert.ok(!bot.calls.some(c => c[0] === 'unpause'), 'the release is the modes\' own, when the bot is idle');
    });

    test('a craft that runs: the pause comes before bot.craft', async () => {
        const bot = makeBot({ craftable: true });
        const ok = await skills.craftRecipe(bot, 'stick', 1);
        assert.equal(ok, true, bot.output);
        const pause = bot.calls.findIndex(c => c[0] === 'pause' && c[1] === 'unstuck');
        const craft = bot.calls.findIndex(c => c[0] === 'craft');
        assert.ok(pause >= 0 && craft > pause, bot.calls.map(c => c.join(':')).join(' | '));
    });

    test('a bot without modes crafts as before', async () => {
        const bot = makeBot({ modes: false });
        assert.equal(await skills.craftRecipe(bot, 'stick', 1), false);
        assert.ok(bot.calls.some(c => c[0] === 'recipesFor'));
    });
});
