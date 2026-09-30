// Spec v0.1.4.7 T2: src/agent/packs/wood/wood.js (chopTrees) on the fake bot.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { count, dropItem, give, logsLeft, makeClock, makeWoodBot, makeWorld, pickup, plantTree, v } from './wood_fake_bot.test.js';

const W = await loadSrc('src/agent/packs/wood/wood.js');

function scene({ pos = [0.5, 64, 3.5], areas = [], onWait = null } = {}) {
    const world = makeWorld();
    const bot = makeWoodBot({ world, pos });
    const clock = makeClock(onWait ? (t) => onWait(t, bot, world) : null);
    const lines = [];
    const ctx = { areas, log: (t) => lines.push(t), now: clock.now };
    return { world, bot, ctx, clock, lines, opts: { now: clock.now, wait: clock.wait } };
}

const digs = (bot) => bot.calls.filter(c => c[0] === 'dig').map(c => `${c[1]},${c[2]},${c[3]}`);
const jumps = (bot) => bot.calls.filter(c => c[0] === 'control' && c[1] === 'jump' && c[2] === true).length;

describe('chopTrees: a tree', () => {
    test('cuts the whole tree, picks up the logs, plants a sapling where it stood', async () => {
        const { world, bot, ctx, opts, lines } = scene();
        const tree = plantTree(world, { x: 10, z: 3 });
        give(bot, 'oak_sapling', 1);
        const res = await W.chopTrees(bot, ctx, 4, '', opts);
        assert.equal(res.text, 'I cut 1 oak tree and got 5 oak_log. I planted 1 sapling.');
        assert.deepEqual({ ok: res.ok, logs: res.logs, trees: res.trees, saplings: res.saplings }, { ok: true, logs: 5, trees: 1, saplings: 1 });
        assert.deepEqual(logsLeft(world), []);
        assert.deepEqual(digs(bot), tree.trunk.map(p => `${p.x},${p.y},${p.z}`), 'only the logs, lowest first');
        assert.equal(world.nameAt(10, 64, 3), 'oak_sapling');
        assert.equal(count(bot, 'oak_log'), 5);
        assert.equal(lines[lines.length - 1], res.text);
        assert.equal(jumps(bot), 0, 'a small tree needs no pillar');
    });

    test('without a sapling it waits 10 seconds for leaves that decay, then says so', async () => {
        const { world, bot, ctx, opts, clock } = scene();
        plantTree(world, { x: 10, z: 3 });
        const t0 = clock.t;
        const res = await W.chopTrees(bot, ctx, 4, '', opts);
        assert.equal(res.text, 'I cut 1 oak tree and got 5 oak_log. I had no sapling to plant.');
        assert.ok(clock.t - t0 >= W.SAPLING_WAIT_MS, `waited ${clock.t - t0} ms`);
        assert.ok(clock.t - t0 < W.SAPLING_WAIT_MS + 5000);
        assert.equal(W.SAPLING_WAIT_MS, 10000);
    });

    test('a sapling that drops from decaying leaves is picked up and planted', async () => {
        let t1 = null;
        let dropped = false;
        const s = scene({
            onWait: (t, bot, world) => {
                if (t1 === null && logsLeft(world).length === 0) t1 = t;
                if (!dropped && t1 !== null && t - t1 > 3000) {
                    dropped = true;
                    dropItem(bot, 'oak_sapling', { x: 13, y: 66, z: 6 });
                }
            },
        });
        plantTree(s.world, { x: 10, z: 3 });
        const res = await W.chopTrees(s.bot, s.ctx, 4, '', s.opts);
        assert.ok(dropped);
        assert.equal(res.saplings, 1);
        assert.equal(s.world.nameAt(10, 64, 3), 'oak_sapling');
        assert.ok(s.clock.t - t1 < W.SAPLING_WAIT_MS, 'it stops waiting when it has the sapling');
    });

    test('drops that lie around the tree are picked up', async () => {
        const { world, bot, ctx, opts } = scene();
        plantTree(world, { x: 10, z: 3 });
        give(bot, 'oak_sapling', 1);
        dropItem(bot, 'apple', { x: 14, y: 64, z: 7 });
        await W.chopTrees(bot, ctx, 4, '', opts);
        assert.equal(count(bot, 'apple'), 1);
    });

    test('with an axe it holds the axe; by hand the text is the same', async () => {
        const a = scene();
        plantTree(a.world, { x: 10, z: 3 });
        give(a.bot, 'oak_sapling', 1);
        give(a.bot, 'stone_axe', 1);
        const withAxe = await W.chopTrees(a.bot, a.ctx, 4, '', a.opts);
        assert.ok(a.bot.calls.some(c => c[0] === 'equip' && c[1] === 'stone_axe'));
        const b = scene();
        plantTree(b.world, { x: 10, z: 3 });
        give(b.bot, 'oak_sapling', 1);
        const byHand = await W.chopTrees(b.bot, b.ctx, 4, '', b.opts);
        assert.ok(!b.bot.calls.some(c => c[0] === 'equip' && /_axe$/.test(c[1] ?? '')));
        assert.equal(withAxe.text, byHand.text);
    });
});

// Amendment 2, I1: on the real server a log that is cut from the ground falls for about a second
// before it can be picked up. The drop of each dug log hangs where the log was and lands
// `fallMs` later at the foot of the trunk; the server picks up what touches the bot.
function slowDrops(fallMs, { landY = 64, tick = null } = {}) {
    const falling = [];
    const s = scene({
        onWait: (t, bot) => {
            for (const f of falling) {
                if (f.e.isValid && t >= f.lands && f.e.position.y !== f.y) f.e.position = v(f.e.position.x, f.y, f.e.position.z);
            }
            pickup(bot);
            if (tick) tick(t, bot);
        },
    });
    s.digAt = [];
    s.bot.dig = async (block) => {
        const p = block.position;
        const name = s.world.nameAt(p.x, p.y, p.z);
        s.bot.calls.push(['dig', p.x, p.y, p.z]);
        s.world.set(p.x, p.y, p.z, 'air');
        s.bot.fall();
        s.digAt.push(s.clock.t);
        const e = dropItem(s.bot, name, { x: p.x, y: p.y, z: p.z });
        e.position = v(p.x + 0.5, p.y, p.z + 0.5);
        falling.push({ e, lands: s.clock.t + fallMs, y: typeof landY === 'function' ? landY(p) : landY });
    };
    return s;
}

describe('chopTrees: the last log (Amendment 2, I1)', () => {
    test('a log that falls for 2 s after the cut is picked up and counted before the answer', async () => {
        const s = slowDrops(2000);
        plantTree(s.world, { x: 10, z: 3 });
        give(s.bot, 'oak_sapling', 1);
        const res = await W.chopTrees(s.bot, s.ctx, 5, '', s.opts);
        assert.equal(count(s.bot, 'oak_log'), 5);
        assert.equal(res.text, 'I cut 1 oak tree and got 5 oak_log. I planted 1 sapling.', 'not "4 oak_log", not "I found no more trees"');
        assert.equal(res.logs, 5);
        assert.deepEqual(Object.values(s.bot.entities).filter(e => e.name === 'item'), [], 'no log lies on the ground');
    });

    test('a log that is never picked up: the bot waits 5 seconds, not longer', async () => {
        // every drop stays in the crown, where the bot does not go
        const s = slowDrops(0, { landY: p => Math.max(p.y, 67) });
        plantTree(s.world, { x: 10, z: 3 });
        give(s.bot, 'oak_sapling', 1);
        const res = await W.chopTrees(s.bot, s.ctx, 2, '', s.opts);
        const waited = s.clock.t - s.digAt[s.digAt.length - 1];
        assert.equal(W.LOG_DROP_WAIT_MS, 5000);
        assert.ok(waited >= W.LOG_DROP_WAIT_MS, `waited ${waited} ms`);
        assert.ok(waited < W.LOG_DROP_WAIT_MS + 4000, `waited ${waited} ms`);
        assert.equal(res.trees, 1);
    });

    test('the count is read from an inventory that did not change for 500 ms', async () => {
        // the slots of the inventory show a pick-up 400 ms after the item left the ground
        const snap = (list) => list.map(i => ({ ...i }));
        const keyOf = (list) => JSON.stringify(list.map(i => [i.name, i.count]));
        let real = null;
        let shown = [];
        let lastKey = '';
        let changedAt = null;
        const s = slowDrops(0, {
            tick: (t) => {
                const k = keyOf(real());
                if (k !== lastKey) { lastKey = k; changedAt = t; }
                if (changedAt !== null && t - changedAt >= 400) { shown = snap(real()); changedAt = null; }
            },
        });
        real = s.bot.inventory.items.bind(s.bot.inventory);
        s.bot.inventory.items = () => shown;
        plantTree(s.world, { x: 10, z: 3 });
        plantTree(s.world, { x: 20, z: 3 });
        give(s.bot, 'oak_sapling', 1);
        shown = snap(real());
        lastKey = keyOf(real());
        const res = await W.chopTrees(s.bot, s.ctx, 5, '', s.opts);
        assert.deepEqual({ trees: res.trees, logs: res.logs }, { trees: 1, logs: 5 }, 'no second tree for a log that was on its way');
        assert.equal(logsLeft(s.world).length, 5);
    });
});

describe('chopTrees: the pillar', () => {
    test('a tall tree: a pillar of dirt in the place of the trunk, taken away at the end', async () => {
        const { world, bot, ctx, opts } = scene();
        plantTree(world, { x: 10, z: 3, height: 12 });
        give(bot, 'dirt', 10);
        const res = await W.chopTrees(bot, ctx, 8, '', opts);
        assert.equal(res.text, 'I cut 1 oak tree and got 12 oak_log. I had no sapling to plant.');
        assert.deepEqual(logsLeft(world), []);
        assert.equal(jumps(bot), 6);
        for (let y = 64; y <= 76; y++) assert.ok(['air', 'oak_leaves'].includes(world.nameAt(10, y, 3)), `nothing left at y ${y}`);
        assert.equal(count(bot, 'dirt'), 10, 'the dirt came back');
        assert.equal(Math.floor(bot.entity.position.y), 64);
    });

    test('without dirt the pillar is built of the logs it has cut', async () => {
        const { world, bot, ctx, opts } = scene();
        plantTree(world, { x: 10, z: 3, height: 12 });
        const res = await W.chopTrees(bot, ctx, 8, '', opts);
        assert.equal(res.logs, 12);
        assert.ok(bot.calls.some(c => c[0] === 'place' && c[4] === 'oak_log'));
        assert.equal(world.nameAt(10, 64, 3), 'air');
    });

    test('logs higher than a pillar of 12 blocks reaches are left and counted', async () => {
        const { world, bot, ctx, opts } = scene();
        plantTree(world, { x: 10, z: 3, height: 20 });
        give(bot, 'dirt', 20);
        const res = await W.chopTrees(bot, ctx, 8, '', opts);
        assert.equal(res.text, 'I cut 1 oak tree and got 18 oak_log. I had no sapling to plant. 2 logs were too high for me.');
        assert.equal(jumps(bot), 12);
        assert.equal(count(bot, 'dirt'), 20);
    });

    test('when the pillar does not work the rest is too high, and nothing is left standing', async () => {
        const { world, bot, ctx, opts } = scene();
        plantTree(world, { x: 10, z: 3, height: 12 });
        give(bot, 'dirt', 10);
        bot.failPlace = 100;
        const res = await W.chopTrees(bot, ctx, 4, '', opts);
        assert.equal(res.text, 'I cut 1 oak tree and got 6 oak_log. I had no sapling to plant. 6 logs were too high for me.');
        assert.equal(world.nameAt(10, 64, 3), 'air');
        assert.equal(count(bot, 'dirt'), 10);
    });

    test('a tree of 2 by 2 logs', async () => {
        const { world, bot, ctx, opts } = scene();
        for (const [x, z] of [[10, 10], [11, 10], [10, 11], [11, 11]]) {
            world.set(x, 63, z, 'dirt');
            for (let y = 64; y < 72; y++) world.set(x, y, z, 'dark_oak_log');
        }
        for (let y = 70; y <= 72; y++) for (let dx = -2; dx <= 3; dx++) for (let dz = -2; dz <= 3; dz++) {
            if (world.nameAt(10 + dx, y, 10 + dz) === 'air') world.set(10 + dx, y, 10 + dz, 'dark_oak_leaves');
        }
        give(bot, 'dirt', 5);
        give(bot, 'dark_oak_sapling', 1);
        const res = await W.chopTrees(bot, ctx, 8, '', opts);
        assert.equal(res.text, 'I cut 1 dark_oak tree and got 32 dark_oak_log. I planted 1 sapling.');
        assert.deepEqual(logsLeft(world), []);
        assert.equal(world.nameAt(10, 64, 10), 'dark_oak_sapling');
    });
});

describe('chopTrees: which trees', () => {
    test('whole trees until it has the count; more logs than asked are fine', async () => {
        const a = scene();
        plantTree(a.world, { x: 10, z: 3 });
        plantTree(a.world, { x: 20, z: 3 });
        give(a.bot, 'oak_sapling', 2);
        const res = await W.chopTrees(a.bot, a.ctx, 8, '', a.opts);
        assert.equal(res.text, 'I cut 2 oak trees and got 10 oak_log. I planted 2 saplings.');
        const b = scene();
        plantTree(b.world, { x: 10, z: 3 });
        plantTree(b.world, { x: 20, z: 3 });
        const one = await W.chopTrees(b.bot, b.ctx, 3, '', b.opts);
        assert.equal(one.trees, 1);
        assert.equal(logsLeft(b.world).length, 5);
    });

    test('for a few logs a small tree a little further away beats a tall one next to the bot', async () => {
        const { world, bot, ctx, opts } = scene();
        plantTree(world, { x: 6, z: 3, height: 12 });
        plantTree(world, { x: 14, z: 3 });
        give(bot, 'oak_sapling', 1);
        const res = await W.chopTrees(bot, ctx, 3, '', opts);
        assert.equal(res.logs, 5);
        assert.equal(world.nameAt(6, 64, 3), 'oak_log', 'the tall tree stands');
    });

    test('fewer trees than logs wanted: says there are no more', async () => {
        const { world, bot, ctx, opts } = scene();
        plantTree(world, { x: 10, z: 3 });
        give(bot, 'oak_sapling', 1);
        const res = await W.chopTrees(bot, ctx, 20, '', opts);
        assert.equal(res.text, 'I cut 1 oak tree and got 5 oak_log. I planted 1 sapling. I found no more trees within 48 blocks.');
    });

    test('a kind: only trees of that wood; an unknown kind is refused', async () => {
        const { world, bot, ctx, opts } = scene();
        plantTree(world, { x: 6, z: 3 });
        plantTree(world, { x: 14, z: 3, log: 'birch_log', leaves: 'birch_leaves' });
        give(bot, 'birch_sapling', 1);
        const res = await W.chopTrees(bot, ctx, 4, 'birch_log', opts);
        assert.equal(res.text, 'I cut 1 birch tree and got 5 birch_log. I planted 1 sapling.');
        assert.equal(logsLeft(world).length, 5, 'the oak stands');
        const bad = await W.chopTrees(bot, ctx, 4, 'mithril', opts);
        assert.equal(bad.ok, false);
        assert.match(bad.text, /^I do not know the wood "mithril"/);
    });

    test('a house with log posts and a tree 3 blocks away: only the tree is cut, the house is untouched', async () => {
        const { world, bot, ctx, opts } = scene({ pos: [3.5, 64, 12.5] });
        for (let y = 64; y <= 66; y++) {
            for (let i = 0; i <= 6; i++) {
                world.set(i, y, 0, 'oak_planks');
                world.set(i, y, 6, 'oak_planks');
                world.set(0, y, i, 'oak_planks');
                world.set(6, y, i, 'oak_planks');
            }
            for (const [x, z] of [[0, 0], [0, 6], [6, 0], [6, 6]]) world.set(x, y, z, 'oak_log');
        }
        world.fill(0, 67, 0, 6, 67, 6, 'oak_planks');
        const houseBefore = new Map([...world.blocks.entries()].map(([k, b]) => [k, b.name]));
        plantTree(world, { x: 10, z: 3 });
        give(bot, 'oak_sapling', 1);
        const res = await W.chopTrees(bot, ctx, 16, '', opts);
        assert.equal(res.trees, 1);
        for (const [k, name] of houseBefore) assert.equal(world.blocks.get(k)?.name, name, `house block ${k}`);
        assert.equal(logsLeft(world).length, 12, 'the posts stand');
        assert.match(res.text, /I found no more trees within 48 blocks\.$/);
    });

    test('a house of logs only and no tree: the text for no tree, nothing dug', async () => {
        const { world, bot, ctx, opts } = scene();
        for (let y = 64; y <= 66; y++) for (let i = 0; i <= 4; i++) {
            world.set(i, y, 0, 'oak_log');
            world.set(0, y, i, 'oak_log');
        }
        world.set(1, 65, 1, 'oak_leaves');
        const res = await W.chopTrees(bot, ctx, 8, '', opts);
        assert.equal(res.text, 'I found no tree within 48 blocks. Logs of buildings are not mine to take.');
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'no_tree');
        assert.deepEqual(digs(bot), []);
    });

    test('trees inside a protected area and within 2 blocks of one are left alone', async () => {
        const near = scene({ areas: [{ name: 'home', min: { x: 12, y: 60, z: 0 }, max: { x: 20, y: 80, z: 8 } }] });
        plantTree(near.world, { x: 10, z: 3 });
        const res = await W.chopTrees(near.bot, near.ctx, 4, '', near.opts);
        assert.equal(res.text, 'I found no tree within 48 blocks. Logs of buildings are not mine to take.');
        assert.deepEqual(digs(near.bot), []);
        const far = scene({ areas: () => [{ name: 'home', min: { x: 13, y: 60, z: 0 }, max: { x: 20, y: 80, z: 8 } }] });
        plantTree(far.world, { x: 10, z: 3 });
        assert.equal((await W.chopTrees(far.bot, far.ctx, 4, '', far.opts)).trees, 1, '3 blocks away is fine');
    });
});

describe('chopTrees: stops and failures', () => {
    test('an interrupt stops it', async () => {
        const { world, bot, ctx, opts } = scene();
        plantTree(world, { x: 10, z: 3, height: 8 });
        const dig = bot.dig;
        bot.dig = async (block, look) => {
            await dig(block, look);
            bot.interrupt_code = true;
        };
        const res = await W.chopTrees(bot, ctx, 8, '', opts);
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'interrupted');
        // v0.1.4.8, I6: what was cut and what was picked up
        assert.equal(res.text, 'I cut 1 oak_log and picked up 1. I was stopped.');
        assert.equal(digs(bot).length, 1);
    });

    test('an interrupt before any tree', async () => {
        const { world, bot, ctx, opts } = scene();
        plantTree(world, { x: 10, z: 3 });
        bot.interrupt_code = true;
        const res = await W.chopTrees(bot, ctx, 8, '', opts);
        assert.equal(res.text, 'I stopped before I cut a tree.');
    });

    test('trees it cannot reach', async () => {
        const { world, bot, ctx, opts } = scene();
        plantTree(world, { x: 10, z: 3 });
        bot.gotoImpl = async () => { const e = new Error('no path'); e.name = 'NoPath'; throw e; };
        const res = await W.chopTrees(bot, ctx, 8, '', opts);
        assert.deepEqual({ ok: res.ok, reason: res.reason, text: res.text }, { ok: false, reason: 'unreachable', text: 'I could not reach the trees I found.' });
    });

    test('the time limit ends it after the tree it started', async () => {
        const { world, bot, ctx, opts } = scene();
        plantTree(world, { x: 10, z: 3 });
        plantTree(world, { x: 20, z: 3 });
        const res = await W.chopTrees(bot, ctx, 8, '', { ...opts, timeoutMs: 1 });
        assert.equal(res.text, 'I cut 1 oak tree and got 5 oak_log. I had no sapling to plant. The time for cutting trees was over.');
    });

    test('without findBlocks it scans the range itself; a broken bot gives a text, never a throw', async () => {
        const { world, bot, ctx, opts } = scene();
        plantTree(world, { x: 6, z: 3 });
        give(bot, 'oak_sapling', 1);
        bot.findBlocks = () => { throw new Error('no world'); };
        const res = await W.chopTrees(bot, ctx, 4, '', { ...opts, range: 10 });
        assert.equal(res.trees, 1);
        const broken = await W.chopTrees({ get entity() { throw new Error('gone'); } }, ctx, 4, '', opts);
        assert.equal(broken.ok, false);
        assert.match(broken.text, /^I could not cut trees: /);
    });
});
