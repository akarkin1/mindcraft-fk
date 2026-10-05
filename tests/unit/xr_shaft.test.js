// The correction of 2026-10-04 (v0.1.4.13, the owner, no switch): down by a safe way, never a bare shaft. A walk that
// would be a shaft (!goToCoordinates, skills.goToPosition) and !digDown deeper than 3 blocks (skills.digDown) dig the
// shaft with a ladder on every block when the bag holds at least the depth + 2 ladders: `I dig down 20 blocks with
// ladders.`; with fewer they refuse and do not move: `I do not dig a shaft 20 blocks down without ladders: I have 6 and
// need 22. Bring me ladders or show me stairs.`; !digDown of 3 or fewer is unchanged. The bot is the fake of
// tests/helpers/xt_bot.js with a fall (a bot over a free cell drops into it, it holds on a ladder only at the bottom)
// and placeBlock; the test checks the world: every cell of the shaft holds a ladder on a solid wall.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import Vec3 from 'vec3';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { MC, makeFakeBot, makeItem, move } from '../helpers/xt_bot.js';

register('../helpers/mcdata_hooks.js', import.meta.url);

let skills;
let W;
let mcdata;
let workDir;
let originalCwd;
let cap;
before(async () => {
    originalCwd = process.cwd();
    workDir = makeTmpDir();
    process.chdir(workDir); // nothing may read a keys.json
    cap = captureConsole();
    try {
        mcdata = await loadSrc('src/utils/mcdata.js');
        skills = await loadSrc('src/agent/library/skills.js');
        W = await loadSrc('src/agent/library/way_logic.js');
    } finally {
        process.chdir(originalCwd);
    }
    mcdata.__setMcdataForTests(MC);
});
after(() => {
    mcdata.__setMcdataForTests?.(null);
    cap.restore();
    removeTmpDir(workDir);
});

const FROM = { x: 0, y: 64, z: 0 };
const FREE = new Set(['air', 'cave_air', 'void_air', 'ladder']);

/** The fake bot of xt_bot.js with a fall after each dig, placeBlock, a tool plugin and canHarvest. */
function shaftBot({ world = createBlockWorld().flatGround(63, 'stone', 'stone'), ladders = 0, paths = null } = {}) {
    const items = [makeItem('iron_pickaxe', 1, 36)];
    if (ladders > 0) items.push(makeItem('ladder', ladders, 37));
    const bot = makeFakeBot({ world, pos: FROM, items, held: items[0], paths });
    bot.calls.placed = [];
    const blockAt = bot.blockAt;
    bot.blockAt = (p) => {
        const b = blockAt(p);
        return b ? { ...b, canHarvest: () => true } : b;
    };
    bot.tool = { async equipForBlock() { bot.heldItem = items[0]; } };
    const fall = () => {
        const p = bot.entity.position;
        let y = Math.floor(p.y + 0.01);
        // a bot falls through free cells; a ladder holds it only where the cell below is solid (it slides down a column)
        while (FREE.has(world.get(Math.floor(p.x), y - 1, Math.floor(p.z)))) y--;
        bot.entity.position = new Vec3(p.x, y, p.z);
    };
    const dig = bot.dig;
    bot.dig = async (block) => {
        await dig(block);
        fall();
    };
    bot.placeBlock = async (ref, face) => {
        const at = ref.position.plus(face);
        const it = items.find((i) => i.name === 'ladder' && i.count > 0);
        if (!it || bot.heldItem?.name !== 'ladder') throw new Error('no ladder in hand');
        it.count -= 1;
        world.set(at.x, at.y, at.z, 'ladder');
        bot.calls.placed.push({ x: at.x, y: at.y, z: at.z, wall: { x: ref.position.x, y: ref.position.y, z: ref.position.z } });
    };
    bot.ladders = () => items.filter((i) => i.name === 'ladder').reduce((n, i) => n + i.count, 0);
    return bot;
}

/** Every cell of the column x=0, z=0 from y=top down to bottom holds a ladder on a solid wall. */
function laddered(bot, world, top, bottom) {
    const missing = [];
    for (let y = top; y >= bottom; y--) {
        if (world.get(0, y, 0) !== 'ladder') {
            missing.push(y);
            continue;
        }
        const p = bot.calls.placed.find((c) => c.x === 0 && c.y === y && c.z === 0);
        if (!p || world.get(p.wall.x, p.wall.y, p.wall.z) !== 'stone') missing.push(`${y} (wall)`);
    }
    return missing;
}

const straightDown = (depth) => Array.from({ length: depth }, (_, i) => move(0, 63 - i, 0, [{ x: 0, y: 63 - i, z: 0 }]));

async function walk(bot, x, y, z, min = 1) {
    try {
        return await skills.goToPosition(bot, x, y, z, min);
    } catch (e) {
        return `[${e.message}]`;
    }
}

describe('!goToCoordinates 20 blocks down, straight down through rock', () => {
    test('30 ladders: "I dig down 20 blocks with ladders.", dug with a ladder on every block, the target reached', async () => {
        const world = createBlockWorld().flatGround(63, 'stone', 'stone');
        const bot = shaftBot({ world, ladders: 30, paths: () => ({ status: 'success', path: straightDown(20) }) });
        const result = await walk(bot, 0, 44, 0);
        assert.equal(result, true, bot.output);
        assert.ok(bot.output.includes('I dig down 20 blocks with ladders.'), bot.output);
        assert.equal(bot.entity.position.y, 44, 'the feet at the target');
        assert.deepEqual(laddered(bot, world, 63, 44), [], 'a ladder on a stone wall in every cell from 63 down to 44');
        assert.equal(bot.calls.dug.length, 20, 'one block dug per cell');
        assert.ok(bot.calls.dug.every((d) => d.x === 0 && d.z === 0), 'straight down');
        assert.equal(bot.ladders(), 10, '20 placed of 30');
        assert.deepEqual(bot.calls.walked, [], 'no destructive walk of the pathfinder');
    });

    test('6 ladders: the refusal with the numbers; nothing dug, nothing placed, the bot stays', async () => {
        const world = createBlockWorld().flatGround(63, 'stone', 'stone');
        const bot = shaftBot({ world, ladders: 6, paths: () => ({ status: 'success', path: straightDown(20) }) });
        const result = await walk(bot, 0, 44, 0);
        assert.equal(result, false);
        assert.ok(bot.output.includes('I do not dig a shaft 20 blocks down without ladders: I have 6 and need 22. Bring me ladders or show me stairs.'), bot.output);
        assert.ok(!bot.output.includes('dig down'), 'the old hint to "dig down" is gone');
        assert.deepEqual(bot.calls.dug, []);
        assert.deepEqual(bot.calls.placed, []);
        assert.deepEqual(bot.calls.walked, []);
        assert.equal(bot.entity.position.y, 64);
        assert.equal(bot.ladders(), 6);
    });

    test('21 ladders is one too few (20 + 2 = 22): refused', async () => {
        const bot = shaftBot({ ladders: 21, paths: () => ({ status: 'success', path: straightDown(20) }) });
        await walk(bot, 0, 44, 0);
        assert.ok(bot.output.includes('I have 21 and need 22.'), bot.output);
        assert.deepEqual(bot.calls.dug, []);
    });

    test('lava beside the shaft at y 55: the shaft stops before that block, says where and why; every dug block has its ladder', async () => {
        const world = createBlockWorld().flatGround(63, 'stone', 'stone');
        world.set(1, 55, 0, 'lava');
        const bot = shaftBot({ world, ladders: 30, paths: () => ({ status: 'success', path: straightDown(20) }) });
        const result = await walk(bot, 0, 44, 0);
        assert.equal(result, false);
        assert.ok(bot.output.includes('I dig down 20 blocks with ladders.'), bot.output);
        assert.ok(bot.output.includes('I stopped the shaft after 8 of 20 blocks at (0, 56, 0): lava is next to the shaft.'), bot.output);
        assert.equal(world.get(0, 55, 0), 'stone', 'the block beside the lava is not dug');
        assert.deepEqual(laddered(bot, world, 63, 56), []);
    });
});

describe('!digDown', () => {
    test('10 blocks with 12 ladders: dug with a ladder on every block, true', async () => {
        const world = createBlockWorld().flatGround(63, 'stone', 'stone');
        const bot = shaftBot({ world, ladders: 12 });
        const r = await skills.digDown(bot, 10);
        assert.equal(r, true, bot.output);
        assert.ok(bot.output.includes('I dig down 10 blocks with ladders.'), bot.output);
        assert.equal(bot.entity.position.y, 54);
        assert.deepEqual(laddered(bot, world, 63, 54), []);
        assert.equal(bot.ladders(), 2);
    });

    test('10 blocks with 11 ladders: the refusal, nothing dug, false', async () => {
        const bot = shaftBot({ ladders: 11 });
        const r = await skills.digDown(bot, 10);
        assert.equal(r, false);
        assert.ok(bot.output.includes('I do not dig a shaft 10 blocks down without ladders: I have 11 and need 12. Bring me ladders or show me stairs.'), bot.output);
        assert.deepEqual(bot.calls.dug, []);
        assert.equal(bot.entity.position.y, 64);
    });

    test('4 blocks without ladders: refused (more than 3)', async () => {
        const bot = shaftBot({ ladders: 0 });
        assert.equal(await skills.digDown(bot, 4), false);
        assert.ok(bot.output.includes('I have 0 and need 6.'), bot.output);
        assert.deepEqual(bot.calls.dug, []);
    });

    test('3 blocks without ladders: unchanged, dug as before, no ladder', async () => {
        const world = createBlockWorld().flatGround(63, 'stone', 'stone');
        const bot = shaftBot({ world, ladders: 0 });
        const r = await skills.digDown(bot, 3);
        assert.equal(r, true, bot.output);
        assert.ok(bot.output.includes('Dug down 3 blocks.'), bot.output);
        assert.ok(!bot.output.includes('ladders'), bot.output);
        assert.deepEqual(bot.calls.dug.map((d) => d.y), [63, 62, 61]);
        assert.deepEqual(bot.calls.placed, []);
    });

    test('3 blocks with ladders in the bag: unchanged too, no ladder used', async () => {
        const bot = shaftBot({ ladders: 20 });
        assert.equal(await skills.digDown(bot, 3), true);
        assert.deepEqual(bot.calls.placed, []);
        assert.equal(bot.ladders(), 20);
    });
});

describe('shaftStep (pure)', () => {
    const reader = (world) => (x, y, z) => {
        const name = world.get(x, y, z);
        return name === null ? null : { name, solid: !['air', 'cave_air', 'lava', 'water', 'ladder'].includes(name) };
    };

    test('rock below: dig the cell below the feet, its wall north first', () => {
        const world = createBlockWorld().flatGround(63, 'stone', 'stone');
        const s = W.shaftStep(reader(world), { x: 0.5, y: 64, z: 0.5 });
        assert.equal(s.action, 'dig');
        assert.equal(s.dig, true);
        assert.deepEqual(s.cells, [{ x: 0, y: 63, z: 0, wall: 'north' }]);
    });

    test('the wall of the ladder above is kept while it is solid', () => {
        const world = createBlockWorld().flatGround(63, 'stone', 'stone');
        assert.equal(W.shaftStep(reader(world), FROM, 'east').cells[0].wall, 'east');
        world.set(1, 63, 0, 'air');
        assert.equal(W.shaftStep(reader(world), FROM, 'east').cells[0].wall, 'north');
    });

    test('a hole of 2 below the block: the bot falls into it, 3 cells get ladders', () => {
        const world = createBlockWorld().flatGround(63, 'stone', 'stone');
        world.set(0, 62, 0, 'air').set(0, 61, 0, 'cave_air');
        const s = W.shaftStep(reader(world), FROM);
        assert.equal(s.action, 'dig');
        assert.deepEqual(s.cells.map((c) => c.y), [63, 62, 61]);
    });

    test('a drop of 3 or more below the block, lava or water beside or below, no wall: stop', () => {
        const rock = () => createBlockWorld().flatGround(63, 'stone', 'stone');
        assert.equal(W.shaftStep(reader(rock().fill(0, 60, 0, 0, 62, 0, 'air')), FROM).reason, 'drop');
        assert.equal(W.shaftStep(reader(rock().set(0, 62, 0, 'lava')), FROM).reason, 'lava');
        assert.equal(W.shaftStep(reader(rock().set(0, 63, 1, 'water')), FROM).reason, 'water');
        const open = rock();
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) open.set(dx, 63, dz, 'air');
        assert.equal(W.shaftStep(reader(open), FROM).reason, 'no_wall');
        assert.equal(W.shaftStep(() => null, FROM).reason, 'end');
    });

    test('the texts, word for word', () => {
        assert.equal(W.ladderShaftText(20), 'I dig down 20 blocks with ladders.');
        assert.equal(W.noLaddersText(20, 6, 22), 'I do not dig a shaft 20 blocks down without ladders: I have 6 and need 22. Bring me ladders or show me stairs.');
        assert.equal(W.laddersNeeded(20), 22);
        assert.equal(W.shaftStoppedText(7, 20, { x: 3, y: 56, z: -2 }, 'lava'), 'I stopped the shaft after 7 of 20 blocks at (3, 56, -2): lava is next to the shaft.');
    });
});
