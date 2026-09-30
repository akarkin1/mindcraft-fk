// Spec v0.1.4.9 C1 (part C, engineer E3) in src/agent/library/skills.js: collectBlock takes an ore only
// when it is in sight (ore_sight_logic.js). ore_sense_range 0: a face in the open; 3: an open cell within
// 3 blocks. When every candidate is out of sight, the text of C1. Also without the mining pack. Other
// blocks as before. The setting is read from src/agent/settings.js (what the agent runs with), else from
// settings.js.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import prismarineBlock from 'prismarine-block';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { makeBot, registry, HOTBAR } from './stb_fake_bot.test.js';

register('../helpers/mcdata_hooks.js', import.meta.url);
const mcdata = await loadSrc('src/utils/mcdata.js');
const skills = await loadSrc('src/agent/library/skills.js');
const agentSettings = await loadSrc('src/agent/settings.js');
const fileSettings = (await loadSrc('settings.js')).default;
mcdata.__setMcdataForTests(registry);

const LONG = 'I see no iron_ore. I know that there is some within 16 blocks, but it is inside the rock. Tell me to mine iron and I get it from a mine.';
const SHORT = 'I see no iron_ore within 16 blocks.';

const DROPS = { iron_ore: [['raw_iron', 1]], deepslate_iron_ore: [['raw_iron', 1]], gravel: [['gravel', 1]] };

// Flat ground at y 63 (grass on dirt), air above; the bot stands at (0.5, 64, 0.5).
// Exposed: an ore in the grass layer at y 63, its top face in the air. Buried at y 58: 6 blocks under
// the air, out of sight also with range 3. At y 61: 3 blocks under the air, in sight only with range 3.
function scene(blocks, { pickaxe = 'stone_pickaxe' } = {}) {
    const world = createBlockWorld().flatGround(63);
    for (const [name, x, y, z] of blocks) world.set(x, y, z, name);
    const bot = makeBot({ world });
    if (pickaxe) bot.inventory.put(pickaxe, 1, HOTBAR);
    bot.broken = [];
    const breakIt = (block) => {
        const p = block.position;
        bot.broken.push(`${block.name}@${p.x},${p.y},${p.z}`);
        world.set(p.x, p.y, p.z, 'air');
        for (const [name, n] of DROPS[block.name] ?? []) bot.inventory.add(name, n);
    };
    bot.collectBlock = { async collect(block) { breakIt(block); } };
    bot.dig = async (block) => { breakIt(block); };
    return { world, bot };
}

const lines = (bot) => bot.output.trimEnd().split('\n');

let cap;
let savedFile;
beforeEach(() => {
    cap = captureConsole();
    savedFile = { ore_sense_range: fileSettings.ore_sense_range, mining_pack: fileSettings.mining_pack };
    agentSettings.setSettings({});
});
afterEach(() => {
    cap.restore();
    agentSettings.setSettings({});
    for (const [key, value] of Object.entries(savedFile)) {
        if (value === undefined) delete fileSettings[key];
        else fileSettings[key] = value;
    }
});

describe('C1: ore_sense_range 0, the mining pack off', () => {
    test('an exposed ore and one inside the rock: the exposed one is taken, then the short text (W70)', async () => {
        const { world, bot } = scene([['iron_ore', 3, 63, 0], ['iron_ore', 6, 58, 0]]);
        agentSettings.setSettings({ ore_sense_range: 0, mining_pack: false });
        assert.equal(await skills.collectBlock(bot, 'iron_ore', 2), true);
        assert.deepEqual(bot.broken, ['iron_ore@3,63,0']);
        assert.equal(world.get(6, 58, 0), 'iron_ore', 'the ore inside the rock stays');
        assert.deepEqual(lines(bot), [SHORT, 'I broke 1 iron_ore and got 1 raw_iron.']);
    });

    test('only ore inside the rock: nothing is dug, the short text is the whole answer, false', async () => {
        const { bot } = scene([['iron_ore', 6, 58, 0], ['iron_ore', 6, 57, 0]]);
        assert.equal(await skills.collectBlock(bot, 'iron_ore', 1), false);
        assert.deepEqual(bot.broken, []);
        assert.equal(bot.output, `${SHORT}\n`);
    });

    test('the rule holds without any setting (ore_sense_range absent is 0)', async () => {
        const { bot } = scene([['iron_ore', 2, 61, 0]]);
        delete fileSettings.ore_sense_range;
        assert.equal(await skills.collectBlock(bot, 'iron_ore', 1), false);
        assert.equal(bot.output, `${SHORT}\n`);
    });

    test('no ore at all: the texts of v0.1.4.8', async () => {
        const { bot } = scene([]);
        assert.equal(await skills.collectBlock(bot, 'iron_ore', 1), false);
        assert.equal(bot.output, 'No iron_ore nearby to collect.\nCollected 0 iron_ore.\n');
    });

    test('a block that is no ore is taken inside the rock as before', async () => {
        const { bot } = scene([['gravel', 6, 58, 0]], { pickaxe: null });
        assert.equal(await skills.collectBlock(bot, 'gravel', 1), true);
        assert.deepEqual(bot.broken, ['gravel@6,58,0']);
        assert.equal(bot.output, 'Collected 1 gravel.\n');
    });

    test('a vein: the ore under the dug one is in sight once the first is dug', async () => {
        const { bot } = scene([['iron_ore', 3, 63, 0], ['iron_ore', 3, 62, 0], ['iron_ore', 3, 61, 0]]);
        assert.equal(await skills.collectBlock(bot, 'iron_ore', 3), true);
        assert.deepEqual(bot.broken, ['iron_ore@3,63,0', 'iron_ore@3,62,0', 'iron_ore@3,61,0']);
        assert.equal(bot.output, 'I broke 3 iron_ore and got 3 raw_iron.\n');
    });

    test('a cell dug in this call is open also before the world shows it (the block update comes late)', async () => {
        const { world, bot } = scene([['iron_ore', 3, 63, 0], ['iron_ore', 3, 62, 0]]);
        const listeners = [];
        bot.on = (event, fn) => { if (event === 'blockUpdate') listeners.push(fn); };
        bot.removeListener = () => {};
        let first = true;
        bot.collectBlock.collect = async (block) => {
            const p = block.position;
            bot.broken.push(`${p.x},${p.y},${p.z}`);
            bot.inventory.add('raw_iron', 1);
            if (first) { // the server says the ore broke, the local world still has a block there
                first = false;
                const old = bot.blockAt(p);
                world.set(p.x, p.y, p.z, 'stone');
                for (const fn of listeners) fn(old, bot.blockAt(p));
                return;
            }
            world.set(p.x, p.y, p.z, 'air');
        };
        assert.equal(await skills.collectBlock(bot, 'iron_ore', 2), true);
        assert.deepEqual(bot.broken, ['3,63,0', '3,62,0']);
    });

    test('a position-less block of the palette check of findBlocks is not refused, and not counted as out of sight', async () => {
        const Block = prismarineBlock(registry);
        const { bot } = scene([]);
        const find = bot.findBlocks;
        const palette = [];
        bot.findBlocks = (options) => {
            palette.push(options.matching(Block.fromStateId(registry.blocksByName.iron_ore.defaultState, 0)));
            return find(options);
        };
        assert.equal(await skills.collectBlock(bot, 'iron_ore', 1), false);
        assert.ok(palette.length > 0 && palette.every((ok) => ok === true), JSON.stringify(palette));
        assert.equal(bot.output, 'No iron_ore nearby to collect.\nCollected 0 iron_ore.\n');
    });

    test('the refusal of the guard comes before the text of the sight', async () => {
        const { bot } = scene([['iron_ore', 3, 63, 0], ['iron_ore', 6, 58, 0]]);
        const text = 'The iron_ore at this place belongs to the area "home". I do not break it.';
        bot.areaGuard = { canBreak: () => true, canPlace: () => true, inBuilding: () => false, refusal: () => ({ reason: 'area', area: 'home', text }) };
        assert.equal(await skills.collectBlock(bot, 'iron_ore', 1), false);
        assert.deepEqual(bot.broken, []);
        assert.equal(lines(bot).at(-1), text);
        assert.ok(!bot.output.includes('I see no'), bot.output);
    });
});

describe('C1: the mining pack on', () => {
    test('an ore of the pack inside the rock within 16 blocks: the long text', async () => {
        const { bot } = scene([['iron_ore', 6, 58, 0]]);
        agentSettings.setSettings({ mining_pack: true });
        assert.equal(await skills.collectBlock(bot, 'iron_ore', 1), false);
        assert.equal(bot.output, `${LONG}\n`);
    });

    test('a deepslate ore: the ore of the pack is iron', async () => {
        const { bot } = scene([['deepslate_iron_ore', 6, 58, 0]]);
        agentSettings.setSettings({ mining_pack: true });
        assert.equal(await skills.collectBlock(bot, 'iron_ore', 1), false);
        assert.equal(bot.output, `${LONG}\n`);
    });

    test('inside the rock only farther than 16 blocks: the short text (the long one would claim 16 blocks)', async () => {
        const { bot } = scene([['iron_ore', 20, 58, 0]]);
        agentSettings.setSettings({ mining_pack: true });
        assert.equal(await skills.collectBlock(bot, 'iron_ore', 1), false);
        assert.equal(bot.output, `${SHORT}\n`);
    });

    test('an ore the mining pack does not mine: the short text', async () => {
        const { bot } = scene([['emerald_ore', 6, 58, 0]], { pickaxe: 'iron_pickaxe' });
        agentSettings.setSettings({ mining_pack: true });
        assert.equal(await skills.collectBlock(bot, 'emerald_ore', 1), false);
        assert.equal(bot.output, 'I see no emerald_ore within 16 blocks.\n');
    });

    test('the file settings.js is read when the agent settings lack the key', async () => {
        const { bot } = scene([['iron_ore', 6, 58, 0]]);
        fileSettings.mining_pack = true;
        assert.equal(await skills.collectBlock(bot, 'iron_ore', 1), false);
        assert.equal(bot.output, `${LONG}\n`);
    });
});

describe('C1: ore_sense_range 3', () => {
    test('an ore 3 blocks under the air is taken; one 6 blocks under stays', async () => {
        const { world, bot } = scene([['iron_ore', 2, 61, 0], ['iron_ore', 6, 58, 0]]);
        agentSettings.setSettings({ ore_sense_range: 3 });
        assert.equal(await skills.collectBlock(bot, 'iron_ore', 2), true);
        assert.deepEqual(bot.broken, ['iron_ore@2,61,0']);
        assert.equal(world.get(6, 58, 0), 'iron_ore');
        assert.deepEqual(lines(bot), [SHORT, 'I broke 1 iron_ore and got 1 raw_iron.']);
    });

    test('the same ore with 0 stays', async () => {
        const { bot } = scene([['iron_ore', 2, 61, 0]]);
        agentSettings.setSettings({ ore_sense_range: 0 });
        assert.equal(await skills.collectBlock(bot, 'iron_ore', 1), false);
        assert.deepEqual(bot.broken, []);
    });

    test('the agent settings win over settings.js; settings.js counts when they lack the key', async () => {
        fileSettings.ore_sense_range = 0;
        agentSettings.setSettings({ ore_sense_range: 3 });
        const a = scene([['iron_ore', 2, 61, 0]]);
        assert.equal(await skills.collectBlock(a.bot, 'iron_ore', 1), true);
        fileSettings.ore_sense_range = 3;
        agentSettings.setSettings({ ore_sense_range: 0 });
        const b = scene([['iron_ore', 2, 61, 0]]);
        assert.equal(await skills.collectBlock(b.bot, 'iron_ore', 1), false);
        agentSettings.setSettings({});
        const c = scene([['iron_ore', 2, 61, 0]]);
        assert.equal(await skills.collectBlock(c.bot, 'iron_ore', 1), true);
    });
});
