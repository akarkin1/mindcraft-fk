// v0.1.4.14 (W122 "a fresh world", 4 of 15 runs): `Wood pack: crafting chest failed: Recipe requires craftingTable, but
// one was not supplied` with a crafting table in the bag and 8 planks. craftRecipe placed the table on the one cell of
// getNearestFreeSpace; on the forest floor that failed and bot.craft ran without a table. Now the cells around the bot
// are tried in turn (a flower or grass in the way is broken, a cell one block up or down a slope is fine), and when
// none takes the table the answer is `I could not place my crafting table here.` and false, never the library's text.
// The fake bot of stb_fake_bot.test.js (real 26.1 blocks), with placeBlock, recipesFor and craft of mineflayer faked.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { makeBot, registry } from './stb_fake_bot.test.js';

register('../helpers/mcdata_hooks.js', import.meta.url);

async function importModules() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        return { skills: await loadSrc('src/agent/library/skills.js'), mcdata: await loadSrc('src/utils/mcdata.js') };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}
const { skills, mcdata } = await importModules();

const NOT_PLACED = 'I could not place my crafting table here.\n';
const PLANKS = registry.itemsByName.oak_planks.id;
// the chest recipe as prismarine-recipe gives it: 8 planks in a ring
const CHEST_RECIPE = { result: { id: registry.itemsByName.chest.id, count: 1 }, inShape: [[{ id: PLANKS, count: 1 }, { id: PLANKS, count: 1 }, { id: PLANKS, count: 1 }],
    [{ id: PLANKS, count: 1 }, { id: -1, count: 0 }, { id: PLANKS, count: 1 }], [{ id: PLANKS, count: 1 }, { id: PLANKS, count: 1 }, { id: PLANKS, count: 1 }]], requiresTable: true };

// The forest floor: grass at y 63, the bot at (0, 64, 0); `cells` sets blocks around it; `takes(p)` decides whether the
// server accepts a placed table at p (bot.placeBlock of mineflayer: else it throws, as on a slope or with an entity in
// the way).
function forest({ cells = {}, takes = () => true } = {}) {
    const world = createBlockWorld().flatGround(63);
    for (const [k, name] of Object.entries(cells)) {
        const [x, y, z] = k.split(',').map(Number);
        world.set(x, y, z, name);
    }
    const bot = makeBot({ world, pos: [0.5, 64, 0.5] });
    bot.modes.isOn = () => false;
    bot.inventory.put('crafting_table', 1);
    bot.inventory.put('oak_planks', 8);
    bot.tried = [];
    bot.crafted = [];
    bot.armorManager = { equipAll() {} };
    bot.dig = async (block) => { world.set(block.position.x, block.position.y, block.position.z, 'air'); };
    bot.placeBlock = async (against, face) => {
        const p = against.position.plus(face);
        bot.tried.push(`${p.x},${p.y},${p.z}`);
        if (!takes(p)) throw new Error('No block has been placed : the block is still air');
        world.set(p.x, p.y, p.z, 'crafting_table');
    };
    bot.recipesFor = (id, meta, count, table) => (table ? [CHEST_RECIPE] : []);
    bot.craft = async (recipe, n, table) => {
        if (!table) throw new Error('Recipe requires craftingTable, but one was not supplied');
        bot.crafted.push({ n, table: `${table.position.x},${table.position.y},${table.position.z}` });
    };
    return { world, bot };
}

let cap;
beforeEach(() => {
    cap = captureConsole();
    mcdata.__setMcdataForTests(registry);
});
afterEach(() => {
    cap.restore();
    mcdata.__setMcdataForTests(null);
});

describe('craftRecipe places its crafting table on the forest floor (W122)', () => {
    test('the first cells refuse the table: the next one takes it, the chest is crafted at it', async () => {
        let refusals = 2;
        const { bot } = forest({ takes: () => refusals-- <= 0 });
        assert.equal(await skills.craftRecipe(bot, 'chest', 1), true);
        assert.ok(bot.tried.length >= 3, JSON.stringify(bot.tried));
        assert.equal(bot.crafted.length, 1);
        assert.equal(bot.crafted[0].table, bot.tried[bot.tried.length - 1], 'crafted at the table it placed');
        assert.ok(!bot.output.includes('Recipe requires'), bot.output);
    });

    test('flowers and grass around the bot: a cell with a flower takes the table (the flower is broken first)', async () => {
        const cells = {};
        for (let dx = -2; dx <= 2; dx++)
            for (let dz = -2; dz <= 2; dz++)
                if (dx || dz) cells[`${dx},64,${dz}`] = dx === 1 && dz === 0 ? 'poppy' : 'oak_leaves';
        const { world, bot } = forest({ cells });
        assert.equal(await skills.craftRecipe(bot, 'chest', 1), true, bot.output);
        assert.equal(world.get(1, 64, 0), 'crafting_table', 'on the cell of the poppy');
    });

    test('a slope: the bot\'s level is full, a cell one block up takes the table', async () => {
        const cells = {};
        for (let dx = -2; dx <= 2; dx++)
            for (let dz = -2; dz <= 2; dz++)
                if (dx || dz) { cells[`${dx},64,${dz}`] = 'dirt'; cells[`${dx},65,${dz}`] = 'air'; }
        const { world, bot } = forest({ cells });
        assert.equal(await skills.craftRecipe(bot, 'chest', 1), true, bot.output);
        assert.ok(bot.tried.length > 0 && bot.tried.every((k) => k.split(',')[1] === '65'), JSON.stringify(bot.tried));
        assert.equal(world.get(...bot.tried[bot.tried.length - 1].split(',').map(Number)), 'crafting_table');
    });

    test('no cell takes the table: "I could not place my crafting table here.", false, bot.craft never called', async () => {
        const { bot } = forest({ takes: () => false });
        assert.equal(await skills.craftRecipe(bot, 'chest', 1), false);
        assert.ok(bot.output.endsWith(NOT_PLACED), bot.output);
        assert.ok(!bot.output.includes('Recipe requires'), bot.output);
        assert.equal(bot.crafted.length, 0);
        assert.ok(bot.tried.length >= 2 && bot.tried.length <= 8, `${bot.tried.length} cells tried`);
    });

    test('no free cell at all (walled in by leaves and logs): the same answer, nothing tried', async () => {
        const cells = {};
        for (let dy = 0; dy <= 1; dy++)
            for (let dx = -2; dx <= 2; dx++)
                for (let dz = -2; dz <= 2; dz++)
                    if (dx || dz) cells[`${dx},${64 + dy},${dz}`] = dy ? 'oak_log' : 'oak_leaves';
        for (let dx = -2; dx <= 2; dx++)
            for (let dz = -2; dz <= 2; dz++)
                if (dx || dz) cells[`${dx},63,${dz}`] = 'water';
        const { bot } = forest({ cells });
        assert.equal(await skills.craftRecipe(bot, 'chest', 1), false);
        assert.ok(bot.output.endsWith(NOT_PLACED), bot.output);
        assert.deepEqual(bot.tried, []);
    });
});
