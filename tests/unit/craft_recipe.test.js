// Play test fix F1: skills.craftRecipe with an item that has no crafting recipe.
//
// !craftRecipe("farmland", 15) ended with "TypeError: Cannot read properties of null (reading
// 'length')": mc.getItemCraftingRecipes() returns null for an item without a recipe and for a
// name that is not an item. craftRecipe must give its friendly message and return false.
//
// src/utils/mcdata.js only gets its minecraft-data object on a real login; the hook in
// helpers/mcdata_hooks.js adds a test-only setter, so the real 1.21.8 data (or a small fake) is
// installed. The skills module is imported with an empty temp directory as working directory.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import minecraftData from 'minecraft-data';
import { loadSrc } from '../helpers/load.js';
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
const REAL_DATA = minecraftData('1.21.8');

const noRecipeMessage = (name) => `${name} is either not an item, or it does not have a crafting recipe!`;

// A bot that has nothing: recipesFor finds no recipe, so craftRecipe never reaches bot.craft.
function makeBot() {
    const bot = {
        username: 'andy',
        output: '',
        interrupt_code: false,
        entity: { position: { x: 0, y: 64, z: 0 } },
        recipesForCalls: [],
        recipesFor(...args) {
            bot.recipesForCalls.push(args);
            return [];
        },
        inventory: { items: () => [] },
        craft: async () => {
            throw new Error('bot.craft must not be called');
        },
    };
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

describe('getItemCraftingRecipes returns null (real 1.21.8 data)', () => {
    test('farmland has no crafting recipe, a made-up name is not an item', () => {
        assert.equal(mcdata.getItemCraftingRecipes('farmland'), null);
        assert.equal(mcdata.getItemCraftingRecipes('not_an_item_at_all'), null);
    });
});

describe('craftRecipe(bot, itemName, num) without a recipe', () => {
    test('farmland, 15 (the play test call): friendly message, returns false, no TypeError', async () => {
        const bot = makeBot();
        const result = await skills.craftRecipe(bot, 'farmland', 15);
        assert.equal(result, false);
        assert.equal(bot.output, noRecipeMessage('farmland') + '\n');
        assert.deepEqual(bot.recipesForCalls, [], 'stops before asking the bot for recipes');
    });

    test('a name that is not an item: friendly message, returns false', async () => {
        const bot = makeBot();
        const result = await skills.craftRecipe(bot, 'not_an_item_at_all');
        assert.equal(result, false);
        assert.equal(bot.output, noRecipeMessage('not_an_item_at_all') + '\n');
    });

    test('undefined as the name: friendly message, returns false', async () => {
        const bot = makeBot();
        const result = await skills.craftRecipe(bot, undefined);
        assert.equal(result, false);
        assert.equal(bot.output, noRecipeMessage('undefined') + '\n');
    });

    test('an item whose recipe list is empty keeps the old message', async () => {
        mcdata.__setMcdataForTests({
            itemsByName: { thing: { id: 1, name: 'thing' } },
            items: { 1: { id: 1, name: 'thing' } },
            recipes: { 1: [] },
        });
        const bot = makeBot();
        const result = await skills.craftRecipe(bot, 'thing');
        assert.equal(result, false);
        assert.equal(bot.output, noRecipeMessage('thing') + '\n');
    });
});

describe('craftRecipe(bot, itemName, num) with a recipe (second use of getItemCraftingRecipes)', () => {
    test('stick without resources: "You do not have the resources" with the ingredients, returns false', async () => {
        const bot = makeBot();
        const result = await skills.craftRecipe(bot, 'stick', 2);
        assert.equal(result, false);
        assert.match(bot.output, /^You do not have the resources to craft a stick\. It requires: \w+: \d+/);
        assert.ok(!bot.output.includes('is either not an item'), bot.output);
        assert.ok(bot.recipesForCalls.length >= 1, 'asked the bot for recipes');
    });
});
