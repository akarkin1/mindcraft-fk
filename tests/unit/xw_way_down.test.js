// E3, spec v0.1.4.16 F5 (the play of 2026-11-11: "lava, water or caves block the way down" where the rock is solid): the
// way down (descendToLevel, digDown of mining.js) says `blocked` only for lava, water and a cave the shaft cannot get
// around, and names the block: `Lava, water or caves block the way down at (x, y, z): <block>, and I found no way around
// them.`; a dig that failed, timed out or met an unbreakable block is `dig_failed` with `I could not dig the <block> at
// (x, y, z).` (STOP_REASONS.dig_failed, its slots filled by stopReasonText). Bedrock within 4 blocks of the world's bottom
// is still the bottom of the world.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeMiningBot, makeClock, makeCtx, give } from './mining_fake_bot.test.js';

const T = await loadSrc('src/agent/packs/mining/texts.js');
const M = await loadSrc('src/agent/packs/mining/mining.js');

async function scene({ world = makeWorld() } = {}) {
    const bot = makeMiningBot({ world, pos: [0.5, 64, 0.5] });
    const clock = makeClock(bot);
    const ctx = await makeCtx(clock);
    const said = [];
    ctx.say = t => said.push(t);
    give(bot, 'iron_pickaxe', 1);
    give(bot, 'ladder', 64);
    give(bot, 'cobblestone', 64);
    give(bot, 'torch', 16);
    return { world, bot, clock, ctx, said, opts: { now: clock.now, wait: clock.wait } };
}

describe('F5: the texts of the way down, word for word', () => {
    test('STOP_REASONS.dig_failed and its slots', () => {
        assert.equal(T.STOP_REASONS.dig_failed, 'I could not dig the <block> at (x, y, z)');
        assert.equal(T.stopReasonText('dig_failed', { block: 'bedrock', at: { x: 10, y: 40, z: -3 } }), 'I could not dig the bedrock at (10, 40, -3)');
        assert.equal(T.stopReasonText('dig_failed', { block: 'bedrock' }), 'I could not dig the bedrock');
        assert.equal(T.stopReasonText('dig_failed'), 'I could not dig the block');
        assert.equal(T.stopReasonText('stuck'), 'I got stuck');
        assert.equal(T.stopReasonText('whatever'), T.STOP_REASONS.error);
        assert.equal(T.digFailedText('bedrock', { x: 10, y: 40, z: -3 }), 'I could not dig the bedrock at (10, 40, -3).');
        assert.equal(T.wayDownBlockedText({ x: 10, y: 40, z: -3 }, 'lava'), 'Lava, water or caves block the way down at (10, 40, -3): lava, and I found no way around them.');
        assert.equal(T.wayDownBlockedText({ x: 10, y: 40, z: -3 }, null), 'Lava, water or caves block the way down at (10, 40, -3): a block, and I found no way around them.');
    });

    test('mineOreText with dig_failed: one sentence, the block and the position; the same detail is not said twice', () => {
        const at = { x: 0, y: 58, z: 0 };
        assert.equal(T.mineOreText({ item: 'coal', mined: 0, wanted: 3, reason: 'dig_failed', block: 'bedrock', at, detail: 'I could not dig the bedrock at (0, 58, 0).' }),
            'I mined 0 coal of 3. I stopped because I could not dig the bedrock at (0, 58, 0).');
        assert.equal(T.mineOreText({ item: 'coal', mined: 0, wanted: 3, reason: 'blocked', block: 'lava', at, detail: 'Lava, water or caves block the way down at (0, 58, 0): lava, and I found no way around them.' }),
            'I mined 0 coal of 3. I stopped because my way is blocked by lava, water or caves: Lava, water or caves block the way down at (0, 58, 0): lava, and I found no way around them.');
    });
});

describe('F5: descendToLevel on the fake world', () => {
    test('bedrock placed in the shaft at y 58: dig_failed with the block and its position, the text', async () => {
        const world = makeWorld();
        world.set(0, 58, 0, 'bedrock');
        const s = await scene({ world });
        const r = await M.descendToLevel(s.bot, s.ctx, 50, { ...s.opts, ore: 'coal' });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'dig_failed', r.text);
        assert.equal(r.block, 'bedrock');
        assert.deepEqual(r.at, { x: 0, y: 58, z: 0 });
        assert.equal(r.detail, 'I could not dig the bedrock at (0, 58, 0).');
        assert.match(r.text, /^I could not dig the bedrock at \(0, 58, 0\)\. I am at \(0, 59, 0\), on the way to level 50 in the mine at \(0, 64, 0\): I dug \d+ blocks, placed \d+ ladders and closed 0 holes\.$/);
        assert.equal(r.rest, r.text.slice(r.detail.length + 1));
        assert.equal(world.nameAt(0, 58, 0), 'bedrock', 'not dug');
    });

    test('a dig that fails (the server refuses it): dig_failed with the block, not "blocked"', async () => {
        const s = await scene();
        s.bot.digError = 'boom';
        const r = await M.descendToLevel(s.bot, s.ctx, 50, { ...s.opts, ore: 'coal' });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'dig_failed', r.text);
        assert.equal(r.block, 'grass_block');
        assert.deepEqual(r.at, { x: 0, y: 63, z: 0 });
        assert.match(r.text, /^I could not dig the grass_block at \(0, 63, 0\)\. I am at \(0, 64, 0\)/);
        assert.doesNotMatch(r.text, /Lava, water or caves/);
    });

    test('a layer of lava under the whole region: blocked, the line names the lava and where', async () => {
        const world = makeWorld();
        world.fill(-40, 57, -40, 40, 57, 40, 'lava');
        const s = await scene({ world });
        const r = await M.descendToLevel(s.bot, s.ctx, 50, { ...s.opts, ore: 'coal' });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'blocked', r.text);
        assert.equal(r.block, 'lava');
        assert.equal(r.at?.y, 57, JSON.stringify(r.at));
        assert.match(r.detail, /^Lava, water or caves block the way down at \(-?\d+, 57, -?\d+\): lava, and I found no way around them\.$/);
        assert.ok(r.text.startsWith(r.detail), r.text);
    });

    test('bedrock at the bottom of the world is still the bottom', async () => {
        const world = makeWorld({ groundY: 63, minY: 57 }); // bedrock at 57, 4 blocks under the first stone
        const s = await scene({ world });
        const r = await M.descendToLevel(s.bot, s.ctx, 50, { ...s.opts, ore: 'coal' });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'bottom', r.text);
        assert.match(r.text, /^I reached the bottom of the world\. I am at \(0, 58, 0\)/);
    });
});
