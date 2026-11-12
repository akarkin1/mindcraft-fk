// Spec v0.1.4.16 (part A, engineer E1), F10 the caves, as the owner corrected it on 2026-11-12: !collectBlocks never refuses
// or skips a block for a cave. inCave(bot, pos, ctx) of src/agent/library/skills.js only ORDERS the candidates: the blocks
// outside caves first, the ones in a cave last; when the next block to take is the first one in a cave the bot says once per
// command `The <type> is in a cave; I go carefully.` (ctx.say, that is agent.sayText, and the output) and collects it as any
// block. A block in a saved area or in a known mine is never in a cave, nor anything while the bot itself stands in one.
// On the fake bot of stb_fake_bot.test.js (real prismarine blocks of 26.1).
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { Vec3 } from 'vec3';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { makeBot, registry, HOTBAR } from './stb_fake_bot.test.js';

register('../helpers/mcdata_hooks.js', import.meta.url);
const mcdata = await loadSrc('src/utils/mcdata.js');
const skills = await loadSrc('src/agent/library/skills.js');
mcdata.__setMcdataForTests(registry);

const CAREFUL = 'The stone is in a cave; I go carefully.';
const OLD_REFUSAL = 'That is in a cave; I do not go there alone.';

// The ground: grass at 63, dirt below (natural rock for the cave rule). A pocket of air under the grass with a stone in its
// floor is a cave: the open cell over the stone has dirt and grass above it and no sky.
function scene({ blocks = [], pos = [0.5, 64, 0.5] } = {}) {
    const world = createBlockWorld().flatGround(63);
    for (const [name, x, y, z] of blocks) world.set(x, y, z, name);
    const bot = makeBot({ world, pos });
    bot.inventory.put('stone_pickaxe', 1, HOTBAR); // stone needs a pickaxe
    bot.broken = [];
    const breakIt = (block) => {
        const p = block.position;
        bot.broken.push(`${p.x},${p.y},${p.z}`);
        world.set(p.x, p.y, p.z, 'air');
        bot.inventory.add(block.name, 1); // the block itself, so the count reads "Collected N stone."
    };
    bot.collectBlock = { async collect(block) { breakIt(block); } };
    bot.dig = async (block) => { breakIt(block); };
    bot.said = [];
    bot.caveContext = { say: (text) => bot.said.push(text) };
    return { world, bot };
}

// a stone 4 blocks under the grass in a pocket of air (a cave), and a stone on the grass
const CAVE_STONE = ['stone', 0, 59, 0];
const CAVE_AIR = [['air', 0, 60, 0], ['air', 0, 61, 0], ['air', 1, 60, 0], ['air', 1, 61, 0]];
const SURFACE_STONE = ['stone', 8, 64, 0];

const lines = (bot) => bot.output.trimEnd().split('\n');

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

describe('F10: inCave', () => {
    test('a stone in the floor of a pocket under the rock is in a cave; one on the grass, one buried, one under a canopy is not', () => {
        const { bot, world } = scene({ blocks: [CAVE_STONE, ...CAVE_AIR, SURFACE_STONE, ['stone', 5, 50, 5]] });
        assert.equal(skills.inCave(bot, new Vec3(0, 59, 0)), true, 'the cave stone');
        assert.equal(skills.inCave(bot, new Vec3(0, 60, 0)), true, 'the open cell of the cave itself');
        assert.equal(skills.inCave(bot, new Vec3(8, 64, 0)), false, 'the stone on the grass: the sky above');
        assert.equal(skills.inCave(bot, new Vec3(5, 50, 5)), false, 'buried in the rock: no open cell beside it');
        world.set(8, 65, 0, 'air');
        world.fill(6, 68, -2, 10, 68, 2, 'oak_leaves');
        assert.equal(skills.inCave(bot, new Vec3(8, 64, 0)), false, 'leaves over it are no rock');
        world.set(8, 68, 0, 'oak_planks');
        assert.equal(skills.inCave(bot, new Vec3(8, 64, 0)), false, 'a built block over it is no rock');
        assert.equal(skills.inCave(bot, null), false);
        assert.equal(skills.inCave(null, new Vec3(0, 59, 0)), false);
    });

    test('never a cave: in a saved area, in a known mine, or while the bot stands in one', () => {
        const { bot } = scene({ blocks: [CAVE_STONE, ...CAVE_AIR] });
        const pos = new Vec3(0, 59, 0);
        assert.equal(skills.inCave(bot, pos, {}), true);
        bot.areaGuard = { areaAt: (p) => (p.y < 63 ? { name: 'basement', type: 'building' } : null), canBreak: () => true, inBuilding: () => false };
        assert.equal(skills.inCave(bot, pos, {}), false, 'the guard knows a saved area there');
        delete bot.areaGuard;
        assert.equal(skills.inCave(bot, pos, { areas: [{ name: 'cave_room', type: 'building', min: { x: -2, y: 58, z: -2 }, max: { x: 2, y: 62, z: 2 } }] }), false, 'an area of the context');
        assert.equal(skills.inCave(bot, pos, { areas: { list: () => [{ name: 'cave_room', type: 'building', min: { x: -2, y: 58, z: -2 }, max: { x: 2, y: 62, z: 2 } }] } }), false, 'a store');
        assert.equal(skills.inCave(bot, pos, { mines: { mineAt: (p) => (p.y < 63 ? { mine: { name: 'mine' } } : null) } }), false, 'the mine store answers mineAt');
        const mine = { name: 'mine' };
        assert.equal(skills.inCave(bot, pos, { mines: { list: () => [mine] }, mining: { mineAt: (mines, p) => (mines.includes(mine) && p.y < 63 ? { mine } : null) } }), false,
            "the mining pack's mineAt over the store's list");
        assert.equal(skills.inCave(bot, pos, { mines: { list: () => [mine] }, mining: { mineAt: () => null } }), true, 'no mine there: a cave');
        const inside = scene({ blocks: [CAVE_STONE, ...CAVE_AIR], pos: [0.5, 60, 0.5] }).bot;
        inside.areaGuard = { areaAt: (p) => (p.y === 60 && p.x === 0 ? { name: 'cellar', type: 'building' } : null), canBreak: () => true, inBuilding: () => false };
        assert.equal(skills.inCave(inside, pos, {}), false, 'the bot stands in a saved area: nothing is a cave');
        assert.equal(skills.inCave(bot, pos, { mines: { mineAt: () => { throw new Error('x'); } } }), true, 'a failing mine store: no mine');
    });
});

describe('F10: collectBlock with blocks in a cave', () => {
    test('the stone outside the cave first, then the one in the cave with the line once; both collected, nothing refused', async () => {
        const { bot } = scene({ blocks: [CAVE_STONE, ...CAVE_AIR, SURFACE_STONE] });
        assert.equal(await skills.collectBlock(bot, 'stone', 2), true);
        assert.deepEqual(bot.broken, ['8,64,0', '0,59,0'], 'the surface stone (8 blocks away) before the cave stone (4 blocks away)');
        assert.deepEqual(lines(bot), [CAREFUL, 'Collected 2 stone.']);
        assert.deepEqual(bot.said, [CAREFUL], 'said once through ctx.say');
        assert.ok(!bot.output.includes(OLD_REFUSAL));
    });

    test('only cave stones within range: the line once, every one collected', async () => {
        const { bot } = scene({ blocks: [CAVE_STONE, ...CAVE_AIR, ['stone', 1, 59, 0]] });
        assert.equal(await skills.collectBlock(bot, 'stone', 2), true);
        assert.equal(bot.broken.length, 2);
        assert.deepEqual(lines(bot), [CAREFUL, 'Collected 2 stone.']);
        assert.equal(bot.said.length, 1, 'once per command');
        assert.equal(bot.output.split(CAREFUL).length - 1, 1);
    });

    test('a surface stone only: no line; the cave stone in a saved area or a known mine: no line either', async () => {
        const plain = scene({ blocks: [SURFACE_STONE] });
        assert.equal(await skills.collectBlock(plain.bot, 'stone', 1), true);
        assert.deepEqual(lines(plain.bot), ['Collected 1 stone.']);
        assert.deepEqual(plain.bot.said, []);
        const area = scene({ blocks: [CAVE_STONE, ...CAVE_AIR] });
        area.bot.areaGuard = { areaAt: (p) => (p.y < 63 ? { name: 'basement', type: 'building' } : null), canBreak: () => true, inBuilding: () => false };
        assert.equal(await skills.collectBlock(area.bot, 'stone', 1), true);
        assert.deepEqual(lines(area.bot), ['Collected 1 stone.'], 'a saved area is no cave');
        const mine = scene({ blocks: [CAVE_STONE, ...CAVE_AIR] });
        mine.bot.caveContext = { say: (t) => mine.bot.said.push(t), mines: { mineAt: (p) => (p.y < 63 ? { mine: {} } : null) } };
        assert.equal(await skills.collectBlock(mine.bot, 'stone', 1), true);
        assert.deepEqual(lines(mine.bot), ['Collected 1 stone.'], 'a known mine is no cave');
        assert.deepEqual(mine.bot.said, []);
    });

    test('without a context (no !collectBlocks of the glue) the rule still orders and says the line into the output', async () => {
        const { bot } = scene({ blocks: [CAVE_STONE, ...CAVE_AIR, SURFACE_STONE] });
        delete bot.caveContext;
        assert.equal(await skills.collectBlock(bot, 'stone', 2), true);
        assert.deepEqual(bot.broken, ['8,64,0', '0,59,0']);
        assert.deepEqual(lines(bot), [CAREFUL, 'Collected 2 stone.']);
    });

    test('the texts and the signature', () => {
        assert.equal(skills.caveCarefulText('stone'), CAREFUL);
        assert.equal(skills.caveCarefulText('iron_ore'), 'The iron_ore is in a cave; I go carefully.');
        assert.equal(skills.collectBlock.length, 2, 'the signature of collectBlock stays: the context travels as bot.caveContext');
    });
});
