// Spec v0.1.4.8, part A, A7 and I2: where the ground is and how deep the bot is under it.
//   - src/agent/reflex/ground_logic.js (pure): the 8 columns around the bot, the ground of a column, the
//     median, fewer than 3 known columns, the depth, underground from more than 8 blocks;
//   - src/agent/reflex/where_am_i.js: { area, depth, underground } of a bot; an area of type mine is
//     always underground.
// The cases of the play test: the bottom of a ladder shaft under the house (R1), a tunnel, a tree, a roof.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';
import { vec } from '../helpers/block_world.js';

const G = await loadSrc('src/agent/reflex/ground_logic.js');
const W = await loadSrc('src/agent/reflex/where_am_i.js');

const TOP = 320; // the height limit of the overworld
const BOTTOM = -64;

// A world of flat ground: every column has `ground` at groundY and air above; `extra(x, y, z)` may give
// another name (or null for not loaded) first.
function world({ groundY = 63, ground = 'grass_block', below = 'stone', extra = () => undefined } = {}) {
    return (x, y, z) => {
        const special = extra(x, y, z);
        if (special !== undefined)
            return special;
        if (y > groundY)
            return 'air';
        return y === groundY ? ground : below;
    };
}

describe('isGroundName', () => {
    test('natural blocks are ground: stone, dirt, grass, sand, water, snow, ice', () => {
        for (const name of ['stone', 'dirt', 'grass_block', 'sand', 'water', 'lava', 'snow', 'ice', 'deepslate', 'minecraft:stone', 'moss_carpet', 'cactus'])
            assert.equal(G.isGroundName(name), true, name);
    });

    test('air, leaves, logs, built blocks and plants without collision are not', () => {
        for (const name of ['air', 'cave_air', 'void_air', 'oak_leaves', 'azalea_leaves', 'oak_log', 'stripped_birch_log', 'dark_oak_wood',
            'oak_planks', 'ladder', 'torch', 'glass', 'cobblestone', 'oak_fence', 'oak_door', 'white_bed', 'stone_bricks',
            'short_grass', 'tall_grass', 'poppy', 'red_tulip', 'oak_sapling', 'wheat', 'sugar_cane', 'vine', 'leaf_litter', 'kelp', 'seagrass',
            'bamboo', 'mangrove_roots', 'mushroom_stem', 'red_mushroom_block'])
            assert.equal(G.isGroundName(name), false, name);
    });

    test('no name: not ground', () => {
        for (const name of [null, undefined, '', 7])
            assert.equal(G.isGroundName(name), false, String(name));
    });
});

describe('groundLevelAround(getBlockName, pos, top)', () => {
    test('reads the 8 columns at (4,0) (-4,0) (0,4) (0,-4) (3,3) (3,-3) (-3,3) (-3,-3), not the column of the bot', () => {
        const read = new Set();
        G.groundLevelAround((x, y, z) => { read.add(`${x},${z}`); return y <= 63 ? 'stone' : 'air'; }, { x: 10.7, y: 64, z: -5.2 }, TOP);
        assert.deepEqual([...read].sort(), ['14,-6', '6,-6', '10,-2', '10,-10', '13,-3', '13,-9', '7,-3', '7,-9'].sort());
        assert.equal(G.GROUND_OFFSETS.length, 8);
    });

    test('the ground of a column is the highest ground block from top - 1 down', () => {
        const reads = [];
        const level = G.groundLevelAround((x, y, z) => { reads.push(y); return y <= 63 ? 'grass_block' : 'air'; }, { x: 0, y: 64, z: 0 }, TOP);
        assert.equal(level, 63);
        assert.equal(Math.max(...reads), TOP - 1);
    });

    // 8 columns: the ground of each by its index in GROUND_OFFSETS
    const byOffset = (levels) => (x, y, z) => {
        const i = G.GROUND_OFFSETS.findIndex(([dx, dz]) => dx === x && dz === z);
        return y <= levels[i] ? 'stone' : 'air';
    };

    test('the median of the known columns; with an even number the lower of the two middle ones', () => {
        assert.equal(G.groundLevelAround(byOffset([90, 61, 66, 63, 64, 65, 60, 62]), { x: 0.5, y: 64, z: 0.5 }, TOP), 63);
        assert.equal(G.groundLevelAround(byOffset([60, 60, 60, 60, 60, 70, 70, 70]), { x: 0.5, y: 64, z: 0.5 }, TOP), 60);
        // one column not loaded: 7 known, the middle one
        const seven = (x, y, z) => (x === 4 && z === 0 ? null : byOffset([0, 61, 62, 63, 64, 65, 66, 67])(x, y, z));
        assert.equal(G.groundLevelAround(seven, { x: 0.5, y: 64, z: 0.5 }, TOP), 64);
        // 4 known columns: the second lowest
        const four = (x, y, z) => (G.GROUND_OFFSETS.findIndex(([dx, dz]) => dx === x && dz === z) >= 4 ? null : byOffset([70, 50, 60, 80])(x, y, z));
        assert.equal(G.groundLevelAround(four, { x: 0.5, y: 64, z: 0.5 }, TOP), 60);
    });

    test('the foot of a cliff, 4 columns 30 blocks high and 4 on the level of the bot: on the surface', () => {
        const cliff = byOffset([93, 93, 93, 93, 63, 63, 63, 63]);
        assert.equal(G.depthUnderGround(cliff, { x: 0.5, y: 64, z: 0.5 }, TOP), 0);
        assert.equal(G.isUnderground(G.depthUnderGround(cliff, { x: 0.5, y: 64, z: 0.5 }, TOP)), false);
    });

    test('8 known columns: underground only when 5 of them have their ground more than 8 blocks deep', () => {
        const pos = { x: 0.5, y: 64, z: 0.5 }; // the depth of a column: its ground + 1 - 64
        const deep = 72; // depth 9
        assert.equal(G.isUnderground(G.depthUnderGround(byOffset([deep, deep, deep, deep, 63, 63, 63, 63]), pos, TOP)), false, '4 of 8');
        assert.equal(G.isUnderground(G.depthUnderGround(byOffset([deep, deep, deep, deep, deep, 63, 63, 63]), pos, TOP)), true, '5 of 8');
        assert.equal(G.isUnderground(G.depthUnderGround(byOffset([71, 71, 71, 71, 71, 90, 90, 90]), pos, TOP)), false, 'depth 8 is not more than 8');
    });

    test('a column that is not loaded is left out; with fewer than 3 known columns: null', () => {
        const loaded = (count) => (x, y, z) => {
            const i = G.GROUND_OFFSETS.findIndex(([dx, dz]) => dx === x && dz === z);
            return i < count ? (y <= 63 ? 'stone' : 'air') : null;
        };
        assert.equal(G.groundLevelAround(loaded(3), { x: 0, y: 64, z: 0 }, TOP), 63);
        assert.equal(G.groundLevelAround(loaded(2), { x: 0, y: 64, z: 0 }, TOP), null);
        assert.equal(G.groundLevelAround(loaded(0), { x: 0, y: 64, z: 0 }, TOP), null);
        // loaded above, a block not loaded before the ground: the column is not known
        const holes = (x, y, z) => (y === 100 ? null : y <= 63 ? 'stone' : 'air');
        assert.equal(G.groundLevelAround(holes, { x: 0, y: 64, z: 0 }, TOP), null);
    });

    test('a column without any ground down to the bottom is left out', () => {
        assert.equal(G.groundLevelAround(() => 'air', { x: 0, y: 64, z: 0 }, TOP), null);
        let lowest = Infinity;
        G.groundLevelAround((x, y) => { lowest = Math.min(lowest, y); return 'air'; }, { x: 0, y: 64, z: 0 }, TOP, BOTTOM);
        assert.equal(lowest, BOTTOM);
        lowest = Infinity;
        G.groundLevelAround((x, y) => { lowest = Math.min(lowest, y); return 'air'; }, { x: 0, y: 64, z: 0 }, 256);
        assert.equal(lowest, 256 - 384, 'by default 384 blocks below the top');
    });

    test('an error of getBlockName counts as not loaded; bad arguments give null', () => {
        assert.equal(G.groundLevelAround(() => { throw new Error('x'); }, { x: 0, y: 64, z: 0 }, TOP), null);
        assert.equal(G.groundLevelAround(null, { x: 0, y: 64, z: 0 }, TOP), null);
        assert.equal(G.groundLevelAround(world(), null, TOP), null);
        assert.equal(G.groundLevelAround(world(), { x: 0, y: 64, z: 0 }, NaN), null);
    });

    test('trees, leaves, roofs and plants above the ground are skipped', () => {
        const forest = world({ extra: (x, y) => (y >= 64 && y <= 70 ? 'oak_log' : y > 70 && y <= 74 ? 'oak_leaves' : y === 64 ? 'tall_grass' : undefined) });
        assert.equal(G.groundLevelAround(forest, { x: 0, y: 64, z: 0 }, TOP), 63);
        const hall = world({ extra: (x, y) => (y === 75 ? 'oak_planks' : y === 76 ? 'stone_bricks' : y === 70 ? 'glass' : undefined) });
        assert.equal(G.groundLevelAround(hall, { x: 0, y: 64, z: 0 }, TOP), 63);
    });
});

describe('depthUnderGround and isUnderground', () => {
    test('standing on the ground: 0; on a hill or a pillar: 0, never negative', () => {
        assert.equal(G.depthUnderGround(world(), { x: 0.5, y: 64, z: 0.5 }, TOP), 0);
        assert.equal(G.depthUnderGround(world(), { x: 0.5, y: 80, z: 0.5 }, TOP), 0);
    });

    test('in a hole: the ground + 1 minus the floored y of the feet', () => {
        assert.equal(G.depthUnderGround(world(), { x: 0.5, y: 60.9, z: 0.5 }, TOP), 4);
        assert.equal(G.depthUnderGround(world(), { x: 0.5, y: 55, z: 0.5 }, TOP), 9);
    });

    test('the ground is unknown: 0', () => {
        assert.equal(G.depthUnderGround(() => null, { x: 0, y: 20, z: 0 }, TOP), 0);
    });

    test('R1: at the bottom of a shaft of ladders under the house, 22 blocks deep: underground', () => {
        // house of planks on the grass at y 63, the shaft at x 8, z 48 with ladders, the room at y 41
        const base = world({ extra: (x, y, z) => {
            if (x === 8 && z === 48 && y <= 63 && y >= 41) return 'ladder';
            if (Math.abs(x - 8) <= 3 && Math.abs(z - 48) <= 3 && y >= 64 && y <= 68) return y === 68 ? 'oak_planks' : (Math.abs(x - 8) === 3 || Math.abs(z - 48) === 3 ? 'oak_planks' : 'air');
            return undefined;
        } });
        const depth = G.depthUnderGround(base, { x: 8.51, y: 41, z: 48.37 }, TOP);
        assert.equal(depth, 23);
        assert.equal(G.isUnderground(depth), true);
    });

    test('in a tunnel at y 25 under the grass at y 63: underground; under a high roof or a tree: not', () => {
        assert.equal(G.isUnderground(G.depthUnderGround(world(), { x: 0.5, y: 25, z: 0.5 }, TOP)), true);
        const roof = world({ extra: (x, y) => (y === 80 ? 'oak_planks' : undefined) });
        assert.equal(G.isUnderground(G.depthUnderGround(roof, { x: 0.5, y: 64, z: 0.5 }, TOP)), false);
    });

    test('isUnderground: more than 8 blocks', () => {
        assert.equal(G.isUnderground(8), false);
        assert.equal(G.isUnderground(8.5), true);
        assert.equal(G.isUnderground(9), true);
        assert.equal(G.isUnderground(0), false);
        assert.equal(G.isUnderground(NaN), false);
        assert.equal(G.isUnderground(undefined), false);
        // at the edge: 8 and 9 blocks under the ground
        assert.equal(G.isUnderground(G.depthUnderGround(world(), { x: 0, y: 56, z: 0 }, TOP)), false);
        assert.equal(G.isUnderground(G.depthUnderGround(world(), { x: 0, y: 55, z: 0 }, TOP)), true);
    });
});

describe('whereAmI(bot) of where_am_i.js', () => {
    function makeBot(read, { pos = vec(0.5, 30, 0.5), guard, game = { minY: -64, height: 384 } } = {}) {
        const bot = { entity: { position: pos }, game, reads: 0, areaGuard: guard };
        bot.blockAt = (p) => {
            bot.reads++;
            const name = read(p.x, p.y, p.z);
            return name === null ? null : { name, position: p };
        };
        return bot;
    }

    test('deep under the ground: underground, the depth, no area', () => {
        const where = W.whereAmI(makeBot(world()), 1000);
        assert.deepEqual(where, { area: null, depth: 34, underground: true });
    });

    test('on the surface: not underground', () => {
        assert.deepEqual(W.whereAmI(makeBot(world(), { pos: vec(0.5, 64, 0.5) }), 1000), { area: null, depth: 0, underground: false });
    });

    test('inside an area of type mine: underground also on the surface; other types: by the depth', () => {
        const mine = { areaAt: () => ({ name: 'mining_area', type: 'mine', box: {} }) };
        assert.deepEqual(W.whereAmI(makeBot(world(), { pos: vec(0.5, 64, 0.5), guard: mine }), 1000),
            { area: { name: 'mining_area', type: 'mine' }, depth: 0, underground: true });
        const farm = { areaAt: () => ({ name: 'farm', type: 'farm' }) };
        assert.equal(W.whereAmI(makeBot(world(), { pos: vec(0.5, 64, 0.5), guard: farm }), 1000).underground, false);
    });

    test('the guard is asked with the position of the bot; an error or no guard: no area', () => {
        const asked = [];
        const guard = { areaAt: (p) => { asked.push(p); return null; } };
        const pos = vec(3.5, 64, 7.5);
        W.whereAmI(makeBot(world(), { pos, guard }), 1000);
        assert.deepEqual(asked, [pos]);
        assert.equal(W.areaAt({ areaGuard: { areaAt: () => { throw new Error('x'); } } }, pos), null);
        assert.equal(W.areaAt({}, pos), null);
        assert.equal(W.areaAt({ areaGuard: {} }, pos), null, 'a guard of v0.1.4.7 without areaAt');
    });

    test('the depth of the same block position is read once per second', () => {
        const bot = makeBot(world());
        W.depthOfBot(bot, 5000);
        const reads = bot.reads;
        assert.ok(reads > 0);
        W.depthOfBot(bot, 5900);
        assert.equal(bot.reads, reads, 'from the cache');
        W.depthOfBot(bot, 6000);
        assert.ok(bot.reads > reads, 'read again after a second');
        const again = bot.reads;
        bot.entity.position = vec(0.5, 29, 0.5);
        assert.equal(W.depthOfBot(bot, 6100), 35);
        assert.ok(bot.reads > again, 'another block position');
    });

    test('the world of the bot: from minY + height down to minY', () => {
        const ys = [];
        const bot = makeBot((x, y) => { ys.push(y); return 'air'; }, { game: { minY: 0, height: 256 } });
        W.depthOfBot(bot, 1);
        assert.equal(Math.max(...ys), 255);
        assert.equal(Math.min(...ys), 0);
    });

    test('never throws: no bot, no entity, a broken world', () => {
        assert.deepEqual(W.whereAmI(null), { area: null, depth: 0, underground: false });
        assert.deepEqual(W.whereAmI({}), { area: null, depth: 0, underground: false });
        const broken = { entity: { position: vec(0, 30, 0) }, blockAt: () => { throw new Error('no world'); } };
        assert.deepEqual(W.whereAmI(broken), { area: null, depth: 0, underground: false });
        assert.equal(W.blockNameReader({ blockAt: () => ({}) })(0, 0, 0), null);
    });
});

describe('module rules', () => {
    test('ground_logic.js imports only area_scan.js and is importable without output or files', () => {
        assertImportRules('src/agent/reflex/ground_logic.js', { allowBuiltins: [], allowedRelative: ['area_scan.js'] });
        assertCleanImport('src/agent/reflex/ground_logic.js');
    });

    test('where_am_i.js imports ground_logic.js and vec3 only and is importable without output or files', () => {
        assertCleanImport('src/agent/reflex/where_am_i.js');
    });
});
