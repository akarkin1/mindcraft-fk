// Spec v0.1.4.7 T1: src/agent/packs/wood/tree_logic.js (pure). findTrees decides whether the
// owner's house is safe when no area was saved, so it is tested with hard worlds.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { createBlockWorld } from '../helpers/block_world.js';

const T = await loadSrc('src/agent/packs/wood/tree_logic.js');

const G = 63; // grass of the flat ground; trunks start at 64
const flat = (options) => createBlockWorld(options).flatGround(G);
const key = (p) => `${p.x},${p.y},${p.z}`;

function column(w, x, y0, z, n, name = 'oak_log') {
    for (let y = y0; y < y0 + n; y++) w.set(x, y, z, name);
}

/** Leaves in a square layer of radius r around (x, y, z), only where there is air. */
function layer(w, x, y, z, r, name = 'oak_leaves') {
    for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
            if (w.isAir(x + dx, y, z + dz)) w.set(x + dx, y, z + dz, name);
        }
    }
}

/** A ball-ish crown: layers y-1..y+1 of radius r, the top layer of radius r-1. */
function crown(w, x, y, z, r = 2, name = 'oak_leaves') {
    layer(w, x, y - 1, z, r, name);
    layer(w, x, y, z, r, name);
    layer(w, x, y + 1, z, Math.max(1, r - 1), name);
}

function allLogs(trees) {
    return new Set(trees.flatMap(t => t.logs.map(key)));
}

describe('names of wood', () => {
    test('trunk logs: _log and _stem, not stripped, no mushroom, melon or pumpkin stems', () => {
        for (const n of ['oak_log', 'dark_oak_log', 'pale_oak_log', 'mangrove_log', 'crimson_stem', 'warped_stem', 'minecraft:birch_log']) {
            assert.equal(T.isTrunkLog(n), true, n);
        }
        for (const n of ['stripped_oak_log', 'stripped_crimson_stem', 'oak_wood', 'crimson_hyphae', 'mushroom_stem', 'melon_stem',
            'pumpkin_stem', 'attached_melon_stem', 'big_dripleaf_stem', 'oak_planks', 'oak_leaves', '', null, undefined, 7]) {
            assert.equal(T.isTrunkLog(n), false, String(n));
        }
    });

    test('woodKind, leaves, ground, worked wood', () => {
        assert.equal(T.woodKind('oak_log'), 'oak');
        assert.equal(T.woodKind('dark_oak_log'), 'dark_oak');
        assert.equal(T.woodKind('warped_stem'), 'warped');
        assert.equal(T.woodKind('stripped_oak_log'), null);
        assert.equal(T.woodKind('stone'), null);
        assert.equal(T.isLeaves('oak_leaves'), true);
        assert.equal(T.isLeaves('flowering_azalea_leaves'), true);
        assert.equal(T.isLeaves('nether_wart_block'), true);
        assert.equal(T.isLeaves('warped_wart_block'), true);
        assert.equal(T.isLeaves('red_mushroom_block'), false);
        assert.equal(T.isLeaves(null), false);
        for (const n of ['dirt', 'grass_block', 'podzol', 'coarse_dirt', 'rooted_dirt', 'mud', 'moss_block', 'mycelium']) {
            assert.equal(T.isGround(n), true, n);
        }
        assert.equal(T.isGround('stone'), false);
        assert.equal(T.isGround('oak_planks'), false);
        assert.equal(T.isWorkedWood('stripped_birch_log'), true);
        assert.equal(T.isWorkedWood('oak_wood'), true);
        assert.equal(T.isWorkedWood('stripped_warped_hyphae'), true);
        assert.equal(T.isWorkedWood('oak_log'), false);
        assert.equal(T.isWorkedWood(undefined), false);
    });

    test('items of a kind: log, planks, sapling', () => {
        assert.equal(T.logItemOf('oak'), 'oak_log');
        assert.equal(T.logItemOf('crimson'), 'crimson_stem');
        assert.equal(T.planksOf('dark_oak'), 'dark_oak_planks');
        assert.equal(T.saplingOf('oak'), 'oak_sapling');
        assert.equal(T.saplingOf('pale_oak'), 'pale_oak_sapling');
        assert.equal(T.saplingOf('mangrove'), 'mangrove_propagule');
        assert.equal(T.saplingOf('crimson'), 'crimson_fungus');
        assert.equal(T.saplingOf('warped'), 'warped_fungus');
        assert.equal(T.saplingOf('bamboo'), null);
        assert.equal(T.saplingOf(null), null);
    });

    test('normaliseWoodKind: empty is any, names of logs, planks and trees are understood', () => {
        assert.deepEqual(T.normaliseWoodKind(''), { kind: null, known: true });
        assert.deepEqual(T.normaliseWoodKind(undefined), { kind: null, known: true });
        assert.deepEqual(T.normaliseWoodKind('any'), { kind: null, known: true });
        for (const v of ['oak', 'oak_log', 'Oak_Logs', 'oak_wood', 'oak_planks', 'oak tree', ' minecraft:oak_log ']) {
            assert.deepEqual(T.normaliseWoodKind(v), { kind: 'oak', known: true }, v);
        }
        assert.deepEqual(T.normaliseWoodKind('dark oak'), { kind: 'dark_oak', known: true });
        assert.deepEqual(T.normaliseWoodKind('crimson_stem'), { kind: 'crimson', known: true });
        assert.deepEqual(T.normaliseWoodKind('mithril'), { kind: null, known: false });
        assert.deepEqual(T.normaliseWoodKind(42), { kind: null, known: false });
    });
});

describe('findTrees: plain trees', () => {
    test('one oak: base, kind, logs lowest first, height, leaves, thin, a place to stand', () => {
        const w = flat();
        w.tree({ x: 10, y: G, z: 3 });
        const trees = T.findTrees(w.getBlockName, { x: 0, y: 64, z: 3 });
        assert.equal(trees.length, 1);
        const t = trees[0];
        assert.deepEqual(t.base, { x: 10, y: 64, z: 3 });
        assert.equal(t.kind, 'oak');
        assert.deepEqual(t.logs, [64, 65, 66, 67, 68].map(y => ({ x: 10, y, z: 3 })));
        assert.equal(t.height, 5);
        assert.ok(t.leaves >= 4);
        assert.equal(t.thick, false);
        assert.equal(t.ground, 'dirt');
        assert.deepEqual(t.stand, { x: 9, y: 64, z: 3 }, 'the free place beside the trunk nearest to the origin');
        assert.ok(Math.abs(t.distance - 10) < 1e-9);
    });

    test('defaults: range 48, height 32, max 8', () => {
        assert.deepEqual({ ...T.TREE_DEFAULTS }, { range: 48, height: 32, max: 8 });
        const w = flat();
        w.tree({ x: 40, y: G, z: 0 });
        w.tree({ x: 0, y: G, z: 50 });
        const trees = T.findTrees(w.getBlockName, { x: 0, y: 64, z: 0 });
        assert.deepEqual(trees.map(t => t.base), [{ x: 40, y: 64, z: 0 }]);
    });

    test('nearest first, max, range, height, kind filter and exclude', () => {
        const w = flat();
        w.tree({ x: 20, y: G, z: 0 });
        w.tree({ x: 8, y: G, z: 0, log: 'birch_log', leaves: 'birch_leaves' });
        w.tree({ x: -14, y: G, z: 0 });
        w.tree({ x: 0, y: G + 20, z: 8, soil: 'grass_block' }); // on a hill, 20 blocks up
        const o = { x: 0, y: 64, z: 0 };
        const all = T.findTrees(w.getBlockName, o, { range: 30 });
        assert.deepEqual(all.map(t => t.base.x), [8, -14, 20, 0]);
        assert.deepEqual(T.findTrees(w.getBlockName, o, { range: 30, max: 2 }).map(t => t.base.x), [8, -14]);
        assert.deepEqual(T.findTrees(w.getBlockName, o, { range: 15 }).map(t => t.base.x), [8, -14]);
        assert.deepEqual(T.findTrees(w.getBlockName, o, { range: 30, height: 10 }).map(t => t.base.x), [8, -14, 20]);
        assert.deepEqual(T.findTrees(w.getBlockName, o, { range: 30, kind: 'birch' }).map(t => t.kind), ['birch']);
        assert.deepEqual(T.findTrees(w.getBlockName, o, { range: 30, kind: 'oak' }).map(t => t.base.x), [-14, 20, 0]);
        assert.deepEqual(T.findTrees(w.getBlockName, o, { range: 30, exclude: ['8,64,0'] }).map(t => t.base.x), [-14, 20, 0]);
        assert.deepEqual(T.findTrees(w.getBlockName, o, { range: 30, exclude: new Set(['8,64,0', '-14,64,0']) }).map(t => t.base.x), [20, 0]);
    });

    test('candidates: logs found by the bot lead to their trees, without a scan of the whole range', () => {
        const w = flat();
        w.tree({ x: 10, y: G, z: 3 });
        w.tree({ x: -10, y: G, z: 3 });
        let reads = 0;
        const get = (x, y, z) => { reads++; return w.get(x, y, z); };
        const trees = T.findTrees(get, { x: 0, y: 64, z: 3 }, { candidates: [{ x: 10, y: 67, z: 3 }, { x: 10, y: 65, z: 3 }, { x: 50, y: 50, z: 50 }] });
        assert.deepEqual(trees.map(t => t.base), [{ x: 10, y: 64, z: 3 }]);
        assert.ok(reads < 3000, `only the blocks around the candidate are read (${reads})`);
        assert.deepEqual(T.findTrees(get, { x: 0, y: 64, z: 3 }, { candidates: [{ x: 10, y: 66, z: 3 }], range: 5 }), [], 'the range still counts');
    });

    test('never throws: bad origin, a throwing reader, bad options', () => {
        const w = flat();
        w.tree({ x: 3, y: G, z: 3 });
        assert.deepEqual(T.findTrees(w.getBlockName, null), []);
        assert.deepEqual(T.findTrees(null, { x: 0, y: 64, z: 0 }), []);
        assert.deepEqual(T.findTrees(() => { throw new Error('boom'); }, { x: 0, y: 64, z: 0 }, { range: 4 }), []);
        const trees = T.findTrees(w.getBlockName, { x: 0.7, y: 64.2, z: 0.1 }, { range: 'x', height: -1, max: 0, candidates: 'no' });
        assert.equal(trees.length, 1, 'bad options fall back to the defaults');
    });
});

describe('findTrees: the owner\'s house is safe', () => {
    test('a house whose corner posts are oak logs, with a tree 3 blocks away: only the tree', () => {
        const w = flat();
        const house = w.house({ x: 0, y: G, z: 0, floor: null }); // posts stand on the grass
        w.tree({ x: 10, y: G, z: 3 });
        const res = T.inspectTrees(w.getBlockName, house.inside, { range: 20 });
        assert.deepEqual(res.trees.map(t => t.base), [{ x: 10, y: 64, z: 3 }]);
        const posts = res.rejected.filter(r => [0, 6].includes(r.base.x) && [0, 6].includes(r.base.z));
        assert.equal(posts.length, 4, 'all four posts were looked at');
        assert.ok(posts.every(r => r.reason === 'built'), JSON.stringify(posts));
        for (const p of w.positionsOf('oak_log').filter(p => p.x <= 6)) assert.ok(!allLogs(res.trees).has(key(p)));
    });

    test('a post of a house is no tree, also when leaves hang over the roof', () => {
        const w = flat();
        w.house({ x: 0, y: G, z: 0, floor: null });
        layer(w, 0, 67 + 1, 0, 2); // leaves on the roof around the post (0, 66, 0)
        w.set(-1, 66, 0, 'oak_leaves');
        w.set(0, 66, -1, 'oak_leaves');
        const res = T.inspectTrees(w.getBlockName, { x: 3, y: 64, z: 3 }, { range: 10 });
        assert.deepEqual(res.trees, []);
        assert.equal(res.rejected.find(r => r.base.x === 0 && r.base.z === 0)?.reason, 'built');
    });

    test('leaves of a tree hang over the roof of a log house: neither the house nor that tree is cut', () => {
        const w = flat();
        w.house({ x: 0, y: G, z: 0, floor: null, wall: 'oak_log', post: 'oak_log' });
        w.tree({ x: 8, y: G, z: 3, height: 4 }); // top at 67, the level of the roof
        layer(w, 5, 68, 3, 1); // the crown lies on the roof
        const res = T.inspectTrees(w.getBlockName, { x: 12, y: 64, z: 3 }, { range: 20 });
        assert.deepEqual(res.trees, []);
        assert.equal(res.rejected.find(r => r.base.x === 8)?.reason, 'built', 'its crown touches the roof');
        assert.equal(res.rejected.find(r => r.base.x !== 8)?.reason, 'several_trunks', 'the log walls stand on the grass in many places');

        const apart = flat();
        apart.house({ x: 0, y: G, z: 0, floor: null, wall: 'oak_log', post: 'oak_log' });
        apart.tree({ x: 10, y: G, z: 3, height: 4 });
        assert.deepEqual(T.findTrees(apart.getBlockName, { x: 12, y: 64, z: 3 }, { range: 20 }).map(t => t.base), [{ x: 10, y: 64, z: 3 }],
            'the same tree three blocks away is a tree');
    });

    test('a log house with a planted tree that touches its wall: the tree is left alone', () => {
        for (const [tx, tz, how] of [[7, 3, 'face'], [7, 7, 'corner']]) {
            const w = flat();
            w.house({ x: 0, y: G, z: 0, floor: null, wall: 'oak_log', post: 'oak_log' });
            w.tree({ x: tx, y: G, z: tz });
            const res = T.inspectTrees(w.getBlockName, { x: 12, y: 64, z: 12 }, { range: 20 });
            assert.deepEqual(res.trees, [], how);
            assert.ok(res.rejected.length >= 1, how);
        }
        const planks = flat();
        planks.house({ x: 0, y: G, z: 0, floor: null, post: null });
        planks.tree({ x: 7, y: G, z: 3 });
        const res = T.inspectTrees(planks.getBlockName, { x: 12, y: 64, z: 3 }, { range: 20 });
        assert.deepEqual(res.trees, []);
        assert.deepEqual(res.rejected.map(r => r.reason), ['built']);
    });

    test('a fallen trunk without leaves, and a stump', () => {
        const w = flat();
        for (let x = 5; x <= 9; x++) w.set(x, 64, 5, 'oak_log');
        w.set(3, 64, 12, 'birch_log');
        for (let x = 5; x <= 8; x++) w.set(x, 64, 12, 'birch_log');
        const res = T.inspectTrees(w.getBlockName, { x: 0, y: 64, z: 8 }, { range: 20 });
        assert.deepEqual(res.trees, []);
        assert.ok(res.rejected.some(r => r.reason === 'several_trunks'));
        assert.equal(res.rejected.find(r => r.base.x === 3)?.reason, 'no_leaves');
    });

    test('a trunk whose leaves were cut is no tree; 3 leaves are not enough; leaves must touch the top', () => {
        const bare = flat();
        const t = bare.tree({ x: 5, y: G, z: 5 });
        for (const p of t.leaves) bare.set(p.x, p.y, p.z, 'air');
        assert.deepEqual(T.inspectTrees(bare.getBlockName, { x: 0, y: 64, z: 0 }, { range: 10 }).rejected.map(r => r.reason), ['no_leaves']);

        const three = flat();
        column(three, 5, 64, 5, 5);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1]]) three.set(5 + dx, 68, 5 + dz, 'oak_leaves');
        assert.deepEqual(T.findTrees(three.getBlockName, { x: 0, y: 64, z: 0 }, { range: 10 }), []);
        three.set(5, 69, 5, 'oak_leaves');
        assert.equal(T.findTrees(three.getBlockName, { x: 0, y: 64, z: 0 }, { range: 10 }).length, 1, 'the fourth leaf makes it a tree');

        const loose = flat();
        column(loose, 5, 64, 5, 5);
        for (const [dx, dz] of [[2, 2], [-2, 2], [2, -2], [-2, -2]]) loose.set(5 + dx, 68, 5 + dz, 'oak_leaves');
        assert.deepEqual(T.inspectTrees(loose.getBlockName, { x: 0, y: 64, z: 0 }, { range: 10 }).rejected.map(r => r.reason), ['no_leaves'],
            'four leaves near the top, none touches it');
    });

    test('a stack of logs that a player put on the grass, or on planks', () => {
        const w = flat();
        column(w, 5, 64, 5, 3);
        w.set(9, 63, 9, 'oak_planks');
        column(w, 9, 64, 9, 3, 'spruce_log');
        const res = T.inspectTrees(w.getBlockName, { x: 0, y: 64, z: 0 }, { range: 20 });
        assert.deepEqual(res.trees, []);
        assert.deepEqual(res.rejected.map(r => r.reason), ['no_leaves'], 'the stack on planks has no base at all');
    });

    test('a huge mushroom is no tree', () => {
        const w = flat();
        w.set(5, 63, 5, 'mycelium');
        column(w, 5, 64, 5, 5, 'mushroom_stem');
        layer(w, 5, 69, 5, 2, 'red_mushroom_block');
        for (let y = 66; y <= 68; y++) for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) w.set(5 + dx, y, 5 + dz, 'red_mushroom_block');
        const res = T.inspectTrees(w.getBlockName, { x: 0, y: 64, z: 0 }, { range: 20 });
        assert.deepEqual(res, { trees: [], rejected: [] });
    });

    test('stripped logs and wood blocks are the work of a player', () => {
        const w = flat();
        w.tree({ x: 5, y: G, z: 5 });
        w.set(5, 65, 5, 'stripped_oak_log');
        const branchy = flat();
        branchy.tree({ x: 5, y: G, z: 5 });
        branchy.set(6, 64, 6, 'oak_wood');
        for (const world of [w, branchy]) {
            const res = T.inspectTrees(world.getBlockName, { x: 0, y: 64, z: 0 }, { range: 10 });
            assert.deepEqual(res.trees, []);
            assert.deepEqual(res.rejected.map(r => r.reason), ['worked_wood']);
        }
    });

    test('a torch on the trunk makes it a built thing', () => {
        const w = flat();
        w.tree({ x: 5, y: G, z: 5 });
        w.set(6, 65, 5, 'wall_torch');
        assert.deepEqual(T.inspectTrees(w.getBlockName, { x: 0, y: 64, z: 0 }, { range: 10 }).rejected.map(r => r.reason), ['built']);
    });

    test('a block beside the tree that is not loaded: the tree is left alone', () => {
        const w = flat({ loaded: { min: { x: -20, y: 0, z: -20 }, max: { x: 5, y: 100, z: 20 } } });
        w.tree({ x: 5, y: G, z: 5 });
        assert.deepEqual(T.inspectTrees(w.getBlockName, { x: 0, y: 64, z: 0 }, { range: 10 }).rejected.map(r => r.reason), ['unloaded']);
    });

    test('logs of two kinds in one cluster, two trunks joined by logs, a cluster too big for a tree', () => {
        const mixed = flat();
        mixed.tree({ x: 5, y: G, z: 5 });
        mixed.set(6, 67, 5, 'birch_log');
        assert.deepEqual(T.inspectTrees(mixed.getBlockName, { x: 0, y: 64, z: 0 }, { range: 10 }).rejected.map(r => r.reason), ['mixed_wood']);

        const joined = flat();
        joined.tree({ x: 5, y: G, z: 5 });
        joined.tree({ x: 9, y: G, z: 5 });
        joined.set(6, 68, 5, 'oak_log');
        joined.set(7, 68, 5, 'oak_log');
        joined.set(8, 68, 5, 'oak_log');
        const res = T.inspectTrees(joined.getBlockName, { x: 0, y: 64, z: 0 }, { range: 20 });
        assert.deepEqual(res.trees, []);
        assert.deepEqual(res.rejected.map(r => r.reason), ['several_trunks']);

        const big = flat();
        big.tree({ x: 5, y: G, z: 5 });
        for (let x = 6; x <= 30; x++) big.set(x, 68, 5, 'oak_log');
        assert.deepEqual(T.inspectTrees(big.getBlockName, { x: 0, y: 64, z: 0 }, { range: 10 }).rejected.map(r => r.reason), ['too_big']);
    });
});

describe('findTrees: shapes of natural trees', () => {
    test('a tree of 2 by 2 logs is one tree, found from any of its columns', () => {
        const w = flat();
        for (const [x, z] of [[10, 10], [11, 10], [10, 11], [11, 11]]) {
            w.set(x, G, z, 'dirt');
            column(w, x, 64, z, 8, 'dark_oak_log');
        }
        crown(w, 10, 71, 10, 3, 'dark_oak_leaves');
        const trees = T.findTrees(w.getBlockName, { x: 0, y: 64, z: 0 }, { range: 20 });
        assert.equal(trees.length, 1);
        const t = trees[0];
        assert.deepEqual(t.base, { x: 10, y: 64, z: 10 });
        assert.equal(t.thick, true);
        assert.equal(t.kind, 'dark_oak');
        assert.equal(t.logs.length, 32);
        assert.equal(t.height, 8);
        assert.ok(t.logs.every((p, i) => i === 0 || t.logs[i - 1].y <= p.y), 'lowest first');
        for (const c of [{ x: 11, y: 70, z: 11 }, { x: 10, y: 64, z: 11 }]) {
            assert.deepEqual(T.findTrees(w.getBlockName, { x: 0, y: 64, z: 0 }, { range: 20, candidates: [c] }).map(x => x.base), [{ x: 10, y: 64, z: 10 }]);
        }
    });

    test('an acacia with two branches and a big oak with branches: the branches belong to the tree', () => {
        const w = flat();
        column(w, 10, 64, 10, 4, 'acacia_log');
        for (const p of [[11, 68, 10], [12, 69, 10], [9, 68, 11], [8, 69, 12]]) w.set(...p, 'acacia_log');
        crown(w, 12, 70, 10, 2, 'acacia_leaves');
        crown(w, 8, 70, 12, 2, 'acacia_leaves');
        column(w, 30, 64, 10, 10);
        for (const p of [[31, 71, 10], [32, 72, 10], [33, 72, 10], [29, 71, 9], [28, 72, 8]]) w.set(...p, 'oak_log');
        crown(w, 33, 73, 10);
        crown(w, 28, 73, 8);
        crown(w, 30, 74, 10);
        const trees = T.findTrees(w.getBlockName, { x: 20, y: 64, z: 10 }, { range: 20 });
        assert.deepEqual(trees.map(t => [t.kind, t.logs.length]).sort(), [['acacia', 8], ['oak', 15]]);
        const acacia = trees.find(t => t.kind === 'acacia');
        assert.equal(acacia.height, 6);
        assert.ok(acacia.logs.some(p => p.x === 8 && p.y === 69 && p.z === 12));
    });

    test('two trees whose crowns touch are two trees', () => {
        const w = flat();
        w.tree({ x: 10, y: G, z: 10 });
        w.tree({ x: 14, y: G, z: 10 });
        const trees = T.findTrees(w.getBlockName, { x: 0, y: 64, z: 10 }, { range: 20 });
        assert.deepEqual(trees.map(t => t.base.x), [10, 14]);
        const a = new Set(trees[0].logs.map(key));
        assert.ok(trees[1].logs.every(p => !a.has(key(p))));
    });

    test('a mangrove on its roots and a crimson fungus on nylium are trees', () => {
        const w = flat();
        w.set(10, G, 10, 'mud');
        w.set(10, 64, 10, 'mangrove_roots');
        column(w, 10, 65, 10, 6, 'mangrove_log');
        crown(w, 10, 70, 10, 2, 'mangrove_leaves');
        w.set(20, G, 10, 'crimson_nylium');
        column(w, 20, 64, 10, 5, 'crimson_stem');
        crown(w, 20, 68, 10, 2, 'nether_wart_block');
        const trees = T.findTrees(w.getBlockName, { x: 15, y: 64, z: 10 }, { range: 20 });
        assert.deepEqual(trees.map(t => [t.kind, t.base.y, t.ground]).sort(), [['crimson', 64, 'crimson_nylium'], ['mangrove', 65, 'mangrove_roots']]);
    });

    test('no place to stand beside the trunk: stand is null', () => {
        const w = flat();
        w.tree({ x: 5, y: G, z: 5 });
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) column(w, 5 + dx, 64, 5 + dz, 3, 'stone');
        const trees = T.findTrees(w.getBlockName, { x: 0, y: 64, z: 0 }, { range: 10 });
        assert.equal(trees.length, 1);
        assert.equal(trees[0].stand, null);
    });

    test('the stand may be one block up or down on a slope', () => {
        const w = flat();
        w.tree({ x: 5, y: G, z: 5 });
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) w.set(5 + dx, 64, 5 + dz, 'dirt');
        assert.deepEqual(T.findTrees(w.getBlockName, { x: 0, y: 64, z: 5 }, { range: 10 })[0].stand, { x: 4, y: 65, z: 5 });
    });
});

describe('chopPlan', () => {
    const tree = (over = {}) => ({ base: { x: 10, y: 64, z: 3 }, kind: 'oak', thick: false, stand: { x: 9, y: 64, z: 3 }, ...over });
    const logsUp = (n, x = 10, z = 3) => Array.from({ length: n }, (_, i) => ({ x, y: 64 + i, z }));

    test('a small tree is cut from the ground', () => {
        const plan = T.chopPlan(tree({ logs: logsUp(5) }));
        assert.equal(plan.pillar_blocks, 0);
        assert.deepEqual(plan.leftover, []);
        assert.deepEqual(plan.steps.map(s => [s.log.y, s.from]), [[64, 'ground'], [65, 'ground'], [66, 'ground'], [67, 'ground'], [68, 'ground']]);
        assert.ok(plan.steps.every(s => s.stand.x === 9 && s.pillar === 0));
    });

    test('a tall tree: ground, then a pillar in the place of the trunk, one block for each log above', () => {
        const plan = T.chopPlan(tree({ logs: logsUp(12) }));
        assert.equal(plan.pillar_blocks, 6);
        assert.deepEqual(plan.leftover, []);
        const ground = plan.steps.filter(s => s.from === 'ground').map(s => s.log.y);
        assert.deepEqual(ground, [64, 65, 66, 67, 68, 69]);
        const pillar = plan.steps.filter(s => s.from === 'pillar');
        assert.deepEqual(pillar.map(s => [s.log.y, s.pillar]), [[70, 1], [71, 2], [72, 3], [73, 4], [74, 5], [75, 6]]);
        assert.deepEqual(pillar[5].stand, { x: 10, y: 70, z: 3 });
    });

    test('logs above a pillar of 12 blocks are left over', () => {
        const plan = T.chopPlan(tree({ logs: logsUp(20) }));
        assert.equal(plan.pillar_blocks, 12);
        assert.deepEqual(plan.leftover.map(p => p.y), [82, 83]);
        assert.equal(plan.steps.length + plan.leftover.length, 20);
        assert.equal(T.MAX_PILLAR, 12);
    });

    test('without a place to stand the lowest logs are cut from the ground near the trunk, the rest from its place', () => {
        const plan = T.chopPlan(tree({ stand: null, logs: logsUp(8) }));
        assert.deepEqual(plan.steps.map(s => [s.log.y, s.from, s.pillar]), [
            [64, 'ground', 0], [65, 'ground', 0], [66, 'trunk', 0], [67, 'trunk', 0], [68, 'trunk', 0], [69, 'trunk', 0], [70, 'pillar', 1], [71, 'pillar', 2],
        ]);
        assert.equal(plan.steps[0].stand, null);
        assert.deepEqual(plan.steps[2].stand, { x: 10, y: 64, z: 3 });
    });

    test('a tree of 2 by 2 logs', () => {
        const logs = [];
        for (let y = 64; y < 72; y++) for (const [x, z] of [[10, 10], [11, 10], [10, 11], [11, 11]]) logs.push({ x, y, z });
        const plan = T.chopPlan({ base: { x: 10, y: 64, z: 10 }, thick: true, stand: { x: 9, y: 64, z: 10 }, logs });
        assert.equal(plan.steps.length, 32);
        assert.equal(plan.pillar_blocks, 2);
        assert.equal(plan.steps.filter(s => s.from === 'ground').length, 24);
        assert.ok(plan.steps.filter(s => s.from === 'pillar').every(s => s.stand.x === 10 && s.stand.z === 10));
    });

    test('a branch far from the trunk that no pillar reaches is left over; a shorter reach needs more pillar', () => {
        const logs = [...logsUp(4), { x: 16, y: 68, z: 3 }];
        const plan = T.chopPlan(tree({ stand: { x: 11, y: 64, z: 3 }, logs }));
        assert.deepEqual(plan.leftover, [{ x: 16, y: 68, z: 3 }]);
        const short = T.chopPlan(tree({ logs: logsUp(6) }), 3);
        assert.ok(short.pillar_blocks > 0);
        assert.equal(T.chopPlan(tree({ logs: logsUp(6) }), 'far').pillar_blocks, 0, 'a bad reach falls back to 4.5');
    });

    test('every log once; an empty or broken tree gives an empty plan', () => {
        const logs = [...logsUp(15), { x: 11, y: 75, z: 3 }, { x: 12, y: 76, z: 3 }];
        const plan = T.chopPlan(tree({ logs }));
        const seen = [...plan.steps.map(s => key(s.log)), ...plan.leftover.map(key)];
        assert.equal(new Set(seen).size, logs.length);
        assert.equal(seen.length, logs.length);
        assert.deepEqual(T.chopPlan(tree({ logs: [] })), { steps: [], pillar_blocks: 0, leftover: [] });
        assert.deepEqual(T.chopPlan(null), { steps: [], pillar_blocks: 0, leftover: [] });
        assert.deepEqual(T.chopPlan({ logs: [{ x: 1, y: 2, z: 3 }] }), { steps: [], pillar_blocks: 0, leftover: [] });
    });

    test('reach from an eye: the helper the executing code uses too', () => {
        const eye = T.eyeOf({ x: 9, y: 64, z: 3 });
        assert.deepEqual([eye.x, eye.z], [9.5, 3.5]);
        assert.ok(Math.abs(eye.y - 65.62) < 1e-9);
        assert.equal(T.EYE_HEIGHT, 1.62);
        assert.equal(T.DEFAULT_REACH, 4.5);
        assert.equal(T.eyeOf(null), null);
        assert.equal(T.inReach({ x: 9.5, y: 65.62, z: 3.5 }, { x: 10, y: 69, z: 3 }), true);
        assert.equal(T.inReach({ x: 9.5, y: 65.62, z: 3.5 }, { x: 10, y: 70, z: 3 }), false);
        assert.equal(T.inReach(null, { x: 10, y: 70, z: 3 }), false);
    });
});

describe('pickTree', () => {
    const tree = (x, n, thick = false) => ({ base: { x, y: 64, z: 0 }, thick, stand: { x: x - 1, y: 64, z: 0 },
        logs: Array.from({ length: n }, (_, i) => ({ x, y: 64 + (thick ? Math.floor(i / 4) : i), z: 0 })), distance: x });

    test('a few logs: the small tree a little further away, not the giant next to the bot', () => {
        const giant = tree(10, 52, true);
        const small = tree(20, 5);
        assert.equal(T.pickTree([giant, small], 3, { x: 0, y: 64, z: 0 }), small);
        assert.equal(T.pickTree([giant, small], 60, { x: 0, y: 64, z: 0 }), giant, 'for many logs the big tree');
    });

    test('equal trees: the nearest; the distance of the tree without a position; nothing to pick', () => {
        const a = tree(10, 5);
        const b = tree(20, 5);
        assert.equal(T.pickTree([a, b], 8, { x: 0, y: 64, z: 0 }), a);
        assert.equal(T.pickTree([b, a], 8, { x: 30, y: 64, z: 0 }), b);
        assert.equal(T.pickTree([b, a], 8), a);
        assert.equal(T.pickTree([b, a], 'x'), a, 'a bad need is 1');
        assert.equal(T.pickTree([], 8), null);
        assert.equal(T.pickTree(null, 8), null);
        assert.equal(T.pickTree([{ base: null }, { base: { x: 1, y: 2, z: 3 }, logs: [] }], 8), null);
    });
});

describe('treeNearAreas and treeKey', () => {
    const t = { base: { x: 10, y: 64, z: 10 }, logs: [{ x: 10, y: 64, z: 10 }, { x: 10, y: 65, z: 10 }, { x: 11, y: 66, z: 10 }] };

    test('inside an area and within 2 blocks of one; the margin can be changed', () => {
        assert.equal(T.treeNearAreas(t, [{ min: { x: 0, y: 60, z: 0 }, max: { x: 20, y: 80, z: 20 } }]), true);
        assert.equal(T.treeNearAreas(t, [{ min: { x: 0, y: 60, z: 0 }, max: { x: 7, y: 80, z: 20 } }]), false, '3 blocks away');
        assert.equal(T.treeNearAreas(t, [{ min: { x: 0, y: 60, z: 0 }, max: { x: 8, y: 80, z: 20 } }]), true, '2 blocks away');
        assert.equal(T.treeNearAreas(t, [{ min: { x: 13, y: 60, z: 0 }, max: { x: 20, y: 80, z: 20 } }]), true, 'a branch 2 blocks away');
        assert.equal(T.treeNearAreas(t, [{ min: { x: 0, y: 60, z: 0 }, max: { x: 7, y: 80, z: 20 } }], 3), true);
        assert.equal(T.treeNearAreas(t, []), false);
        assert.equal(T.treeNearAreas(t, null), false);
        assert.equal(T.treeNearAreas(t, [{ name: 'broken' }]), false);
        assert.equal(T.treeNearAreas(null, [{ min: { x: 0, y: 60, z: 0 }, max: { x: 20, y: 80, z: 20 } }]), false);
    });

    test('treeKey', () => {
        assert.equal(T.treeKey(t), '10,64,10');
        assert.equal(T.treeKey(null), null);
    });
});
