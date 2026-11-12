// Spec v0.1.4.16 (part A, engineer E1), F11 the wood (Q-9: an iron axe lasted 150 logs): digAt of src/agent/packs/wood/wood.js
// swings the axe at trunk logs only; a leaves block (and every other block of a pillar) is dug with the bare hand
// (toolForBlock), so after 10 leaves the axe's durability is unchanged. On the wood fake bot.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { give, makeClock, makeWoodBot, makeWorld, plantTree } from './wood_fake_bot.test.js';

const W = await loadSrc('src/agent/packs/wood/wood.js');

// the fake bot with a durability on its tools: a dig with a tool in the hand wears it by one, as on the server
function scene({ pos = [0.5, 64, 0.5] } = {}) {
    const world = makeWorld();
    const bot = makeWoodBot({ world, pos });
    const dig = bot.dig;
    bot.dig = async (block, forceLook) => {
        if (bot.heldItem?.maxDurability) bot.heldItem.durabilityUsed = (bot.heldItem.durabilityUsed ?? 0) + 1;
        return dig(block, forceLook);
    };
    bot.unequip = async () => { bot.calls.push(['unequip']); bot.heldItem = null; };
    const clock = makeClock();
    return { world, bot, clock, run: { clock } };
}

describe('F11: toolForBlock', () => {
    test('the axe for a trunk log, the hand for leaves and everything else', () => {
        assert.equal(W.toolForBlock('oak_log'), 'axe');
        assert.equal(W.toolForBlock('dark_oak_log'), 'axe');
        assert.equal(W.toolForBlock('oak_leaves'), 'hand');
        assert.equal(W.toolForBlock('dirt'), 'hand');
        assert.equal(W.toolForBlock(null), 'hand');
    });
});

describe('F11: digAt', () => {
    test('after 10 leaves the durability of the axe is unchanged; a log wears it by one', async () => {
        const { world, bot, run } = scene();
        const axe = give(bot, 'iron_axe', 1);
        for (let i = 0; i < 10; i++) world.set(2, 65 + i, 0, 'oak_leaves');
        for (let i = 0; i < 10; i++) {
            assert.equal(await W.digAt(bot, { x: 2, y: 65 + i, z: 0 }, run, n => n.endsWith('_leaves')), true, `leaf ${i}`);
        }
        assert.equal(axe.durabilityUsed, 0, 'the axe never touched the leaves');
        assert.ok(!bot.calls.some(c => c[0] === 'dig' && false), 'dug');
        assert.equal(bot.calls.filter(c => c[0] === 'dig').length, 10);
        world.set(3, 64, 0, 'oak_log');
        assert.equal(await W.digAt(bot, { x: 3, y: 64, z: 0 }, run), true);
        assert.equal(axe.durabilityUsed, 1, 'the log is cut with the axe');
        assert.equal(bot.heldItem?.name, 'iron_axe');
    });

    test('the axe in the hand is put away before a leaves block (unequip, or another item without wear)', async () => {
        const { world, bot, run } = scene();
        const axe = give(bot, 'stone_axe', 1);
        world.set(2, 64, 0, 'oak_log');
        world.set(2, 65, 0, 'oak_leaves');
        await W.digAt(bot, { x: 2, y: 64, z: 0 }, run);
        assert.equal(bot.heldItem?.name, 'stone_axe', 'the axe for the log');
        await W.digAt(bot, { x: 2, y: 65, z: 0 }, run, n => n.endsWith('_leaves'));
        assert.notEqual(bot.heldItem?.name, 'stone_axe', 'not the axe for the leaves');
        assert.equal(axe.durabilityUsed, 1);
        const other = scene();
        delete other.bot.unequip; // a server without unequip: another item without wear goes into the hand
        const axe2 = give(other.bot, 'stone_axe', 1);
        give(other.bot, 'oak_sapling', 3);
        other.world.set(2, 64, 0, 'oak_log');
        other.world.set(2, 65, 0, 'oak_leaves');
        await W.digAt(other.bot, { x: 2, y: 64, z: 0 }, other.run);
        await W.digAt(other.bot, { x: 2, y: 65, z: 0 }, other.run, n => n.endsWith('_leaves'));
        assert.equal(other.bot.heldItem?.name, 'oak_sapling');
        assert.equal(axe2.durabilityUsed, 1);
    });

    test('chopTrees on a tall tree: the pillar through the leaves wears the axe by the logs only', async () => {
        const { world, bot, clock } = scene({ pos: [0.5, 64, 3.5] });
        const tree = plantTree(world, { x: 10, z: 3, height: 9 });
        const axe = give(bot, 'iron_axe', 1);
        give(bot, 'oak_sapling', 1);
        give(bot, 'dirt', 8);
        const res = await W.chopTrees(bot, { areas: [], log: () => {}, now: clock.now }, 4, '', { now: clock.now, wait: clock.wait });
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(res.logs, tree.trunk.length);
        const leavesDug = bot.calls.filter(c => c[0] === 'dig').length - tree.trunk.length;
        assert.ok(leavesDug >= 0);
        assert.ok(axe.durabilityUsed <= tree.trunk.length + (bot.calls.filter(c => c[0] === 'dig').length - leavesDug - tree.trunk.length),
            `the axe wore by ${axe.durabilityUsed} for ${tree.trunk.length} logs`);
        assert.equal(axe.durabilityUsed, tree.trunk.length + bot.calls.filter((c, i) => c[0] === 'dig' && false).length,
            'one use per log, none for a leaf or the dirt of the pillar');
    });
});
