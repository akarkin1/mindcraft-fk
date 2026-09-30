// Spec v0.1.4.8, part B, B1 (P1, F4) in src/agent/library/skills.js:
//   - collectBlock asks the guard for every block (bot.areaGuard.refusal(pos, 'break')); a refused
//     block is no candidate; when every candidate is refused, the text of the refusal is the answer;
//   - the count in the result is what the inventory gained, not what was broken;
//   - breakBlockAt and placeBlock pass the reason of a refusal on to the output.
// Guards are fakes with the interface of the spec (section 4, I3). Without refusal() the guard of
// v0.1.4.7 (canBreak) works as before.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { makeBot, registry, HOTBAR } from './stb_fake_bot.test.js';

register('../helpers/mcdata_hooks.js', import.meta.url);
const mcdata = await loadSrc('src/utils/mcdata.js');
const skills = await loadSrc('src/agent/library/skills.js');
mcdata.__setMcdataForTests(registry);

const FENCE_TEXT = 'oak_fence is a block that players build with. I do not break it. The player can type the command !collectBlocks("oak_fence", 20) in the chat to do it.';
const AREA_TEXT = 'The oak_log at this place belongs to the area "home". I do not break it.';
const MESSAGE = 'All oak_log blocks nearby belong to a protected area. I look for others farther away.';

// What the fake collect puts into the inventory per broken block.
const DROPS = { oak_log: [['oak_log', 1]], iron_ore: [['raw_iron', 1]], oak_fence: [['oak_fence', 1]], tall_grass: [], stone: [['cobblestone', 1]] };

function scene(blocks, { pos = [0.5, 64, 0.5] } = {}) {
    const world = createBlockWorld().flatGround(63);
    for (const [name, x, y, z] of blocks) world.set(x, y, z, name);
    const bot = makeBot({ world, pos });
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

// A guard with the interface of I3: refusal(pos, action) -> null | { reason, area, text }
function fakeGuard(world, decide) {
    const asked = [];
    return {
        asked,
        canBreak() { throw new Error('canBreak must not be used when refusal() exists'); },
        canPlace() { return true; },
        inBuilding() { return false; },
        refusal(pos, action) {
            asked.push([pos.x, pos.y, pos.z, action]);
            return decide(world.get(pos.x, pos.y, pos.z), pos, action);
        },
    };
}

const lines = (bot) => bot.output.trimEnd().split('\n');
const searchRanges = (bot) => bot.calls.filter((c) => c[0] === 'findBlocks').map((c) => c[1]);

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

describe('B1: the count is what the inventory gained', () => {
    test('3 oak_log broken and gained: "Collected 3 oak_log.", true', async () => {
        const { bot } = scene([['oak_log', 3, 64, 0], ['oak_log', 3, 65, 0], ['oak_log', 3, 66, 0]]);
        assert.equal(await skills.collectBlock(bot, 'oak_log', 3), true);
        assert.equal(bot.output, 'Collected 3 oak_log.\n');
        assert.equal(bot.inventory.findInventoryItem('oak_log').count, 3);
    });

    test('tall_grass broken by hand drops nothing: the text of the spec, false', async () => {
        const grass = [];
        for (let x = 2; x < 7; x++) grass.push(['tall_grass', x, 64, 2], ['tall_grass', x, 64, -2]);
        const { bot } = scene(grass);
        assert.equal(await skills.collectBlock(bot, 'tall_grass', 10), false);
        assert.equal(bot.broken.length, 10);
        assert.equal(lines(bot).at(-1), 'I broke 10 tall_grass and got nothing. tall_grass drops nothing without shears.');
        assert.ok(!bot.output.includes('Collected'), bot.output);
    });

    test('with shears in the inventory there is no sentence about shears', async () => {
        const { bot } = scene([['tall_grass', 2, 64, 2], ['tall_grass', 3, 64, 2]]);
        bot.inventory.put('shears', 1);
        assert.equal(await skills.collectBlock(bot, 'tall_grass', 2), false);
        assert.equal(lines(bot).at(-1), 'I broke 2 tall_grass and got nothing.');
    });

    test('an ore gives another item: "I broke 2 iron_ore and got 2 raw_iron.", true', async () => {
        const { bot } = scene([['iron_ore', 2, 63, 0], ['iron_ore', 3, 63, 0]]);
        bot.inventory.put('stone_pickaxe', 1, HOTBAR);
        assert.equal(await skills.collectBlock(bot, 'iron_ore', 2), true);
        assert.equal(bot.output, 'I broke 2 iron_ore and got 2 raw_iron.\n');
    });

    test('cobblestone from stone: the gained name is the asked one, "Collected 2 cobblestone."', async () => {
        const { bot } = scene([['stone', 2, 63, 0], ['stone', 3, 63, 0]]);
        bot.inventory.put('wooden_pickaxe', 1, HOTBAR);
        assert.equal(await skills.collectBlock(bot, 'cobblestone', 2), true);
        assert.equal(bot.output, 'Collected 2 cobblestone.\n');
    });

    test('the drop reaches the inventory a moment after the block broke: it is still counted', async () => {
        const { world, bot } = scene([['oak_log', 3, 64, 0]]);
        bot.collectBlock = {
            async collect(block) {
                world.set(block.position.x, block.position.y, block.position.z, 'air');
                setTimeout(() => bot.inventory.add('oak_log', 1), 200);
            },
        };
        assert.equal(await skills.collectBlock(bot, 'oak_log', 1), true);
        assert.equal(bot.output, 'Collected 1 oak_log.\n');
    });

    test('nothing to collect: the texts of v0.1.4.7', async () => {
        const { bot } = scene([]);
        assert.equal(await skills.collectBlock(bot, 'oak_log', 2), false);
        assert.equal(bot.output, 'No oak_log nearby to collect.\nCollected 0 oak_log.\n');
    });
});

describe('B1: collectBlock asks the guard for every block', () => {
    const fences = [['oak_fence', 2, 64, 0], ['oak_fence', 3, 64, 0], ['oak_fence', 4, 64, 0], ['oak_fence', 5, 64, 0]];

    test('built blocks refused: no fence is broken, the text of the refusal is the whole answer, no wider search', async () => {
        const { world, bot } = scene(fences);
        const guard = fakeGuard(world, (name) => (name === 'oak_fence' ? { reason: 'built_block', area: null, text: FENCE_TEXT } : null));
        bot.areaGuard = guard;
        assert.equal(await skills.collectBlock(bot, 'oak_fence', 20), false);
        assert.deepEqual(bot.broken, []);
        assert.equal(bot.output, `${FENCE_TEXT}\n`);
        assert.deepEqual(searchRanges(bot), [64], 'a wider search does not help for built blocks');
        assert.ok(guard.asked.length >= 4 && guard.asked.every((a) => a[3] === 'break'), JSON.stringify(guard.asked));
    });

    test('a fence the guard allows (placed by the bot) is taken, the others stand', async () => {
        const { world, bot } = scene(fences);
        bot.areaGuard = fakeGuard(world, (name, pos) => (name === 'oak_fence' && pos.x !== 4 ? { reason: 'built_block', area: null, text: FENCE_TEXT } : null));
        assert.equal(await skills.collectBlock(bot, 'oak_fence', 3), true);
        assert.deepEqual(bot.broken, ['oak_fence@4,64,0']);
        assert.equal(bot.output, `${FENCE_TEXT}\nCollected 1 oak_fence.\n`);
    });

    test('refused by an area: the text of v0.1.4.6 once, the range doubles, then the text of the refusal', async () => {
        const { world, bot } = scene([['oak_log', 2, 64, 0], ['oak_log', 2, 65, 0]]);
        bot.areaGuard = fakeGuard(world, (name) => (name === 'oak_log' ? { reason: 'area', area: 'home', text: AREA_TEXT } : null));
        assert.equal(await skills.collectBlock(bot, 'oak_log', 1), false);
        assert.equal(bot.output, `${MESSAGE}\n${AREA_TEXT}\n`);
        assert.deepEqual(searchRanges(bot), [64, 128]);
        assert.deepEqual(bot.broken, []);
    });

    test('a refusal without a text: a short text of its own, no claim about players or areas', async () => {
        const { world, bot } = scene(fences.slice(0, 1));
        bot.areaGuard = fakeGuard(world, () => ({ reason: 'built_block', area: null, text: '' }));
        assert.equal(await skills.collectBlock(bot, 'oak_fence', 1), false);
        assert.equal(bot.output, 'I may not break the oak_fence nearby.\n');
    });

    test('a guard whose refusal() throws allows the block (bot.dig is guarded as well)', async () => {
        const { world, bot } = scene([['oak_log', 2, 64, 0]]);
        bot.areaGuard = fakeGuard(world, () => { throw new Error('broken guard'); });
        assert.equal(await skills.collectBlock(bot, 'oak_log', 1), true);
        assert.deepEqual(bot.broken, ['oak_log@2,64,0']);
    });

    test('the guard of v0.1.4.7 (canBreak, no refusal): unchanged texts', async () => {
        const { bot } = scene([['oak_log', 2, 64, 0]]);
        bot.areaGuard = { canBreak: () => false, canPlace: () => true, inBuilding: () => false };
        assert.equal(await skills.collectBlock(bot, 'oak_log', 1), false);
        assert.equal(bot.output, `${MESSAGE}\nNo oak_log nearby to collect.\nCollected 0 oak_log.\n`);
    });
});

describe('B1: breakBlockAt and placeBlock pass the reason on', () => {
    function protectedError(text) {
        const err = new Error(text);
        err.name = 'ProtectedAreaError';
        return err;
    }

    test('breakBlockAt: a refused block is not dug, the text of the refusal is in the output', async () => {
        const { world, bot } = scene([['oak_fence', 2, 64, 0]]);
        bot.areaGuard = fakeGuard(world, (name) => (name === 'oak_fence' ? { reason: 'built_block', area: null, text: FENCE_TEXT } : null));
        assert.equal(await skills.breakBlockAt(bot, 2, 64, 0), false);
        assert.deepEqual(bot.broken, []);
        assert.equal(bot.output, `${FENCE_TEXT}\n`);
    });

    test('breakBlockAt: an allowed block is dug as before', async () => {
        const { world, bot } = scene([['oak_planks', 2, 64, 0]]);
        bot.areaGuard = fakeGuard(world, () => null);
        assert.equal(await skills.breakBlockAt(bot, 2, 64, 0), true);
        assert.deepEqual(bot.broken, ['oak_planks@2,64,0']);
    });

    test('breakBlockAt: a refusal of the wrapped bot.dig becomes its text and false, not an exception', async () => {
        const { bot } = scene([['oak_planks', 2, 64, 0]]);
        bot.dig = async () => { throw protectedError('The block at (2, 64, 0) belongs to the protected area "home". I do not break or place blocks there.'); };
        assert.equal(await skills.breakBlockAt(bot, 2, 64, 0), false);
        assert.equal(bot.output, 'The block at (2, 64, 0) belongs to the protected area "home". I do not break or place blocks there.\n');
    });

    test('breakBlockAt: other errors of bot.dig are thrown as before', async () => {
        const { bot } = scene([['oak_planks', 2, 64, 0]]);
        bot.dig = async () => { throw new Error('dig failed'); };
        await assert.rejects(skills.breakBlockAt(bot, 2, 64, 0), /dig failed/);
    });

    test('placeBlock: a refused place is not tried, the text of the refusal is in the output', async () => {
        const { world, bot } = scene([]);
        bot.inventory.put('oak_planks', 4);
        const guard = fakeGuard(world, (name, pos, action) => (action === 'place' ? { reason: 'area', area: 'home', text: 'I do not place blocks in the area "home".' } : null));
        bot.areaGuard = guard;
        bot.placeBlock = async () => { throw new Error('bot.placeBlock must not be called'); };
        assert.equal(await skills.placeBlock(bot, 'oak_planks', 3, 64, 0), false);
        assert.equal(bot.output, 'I do not place blocks in the area "home".\n');
        assert.deepEqual(guard.asked, [[3, 64, 0, 'place']]);
    });

    test('placeBlock: a refusal of the wrapped bot.placeBlock names the reason before "Failed to place"', async () => {
        const { bot } = scene([]);
        bot.inventory.put('oak_planks', 4);
        bot.placeBlock = async () => { throw protectedError('The block at (3, 64, 0) belongs to the protected area "home". I do not break or place blocks there.'); };
        assert.equal(await skills.placeBlock(bot, 'oak_planks', 3, 64, 0), false);
        assert.deepEqual(lines(bot), [
            'The block at (3, 64, 0) belongs to the protected area "home". I do not break or place blocks there.',
            'Failed to place oak_planks at (3, 64, 0).',
        ]);
    });
});
