// E3, spec v0.1.4.16 F5 (the play of 2026-11-11: three runs "I stopped because I got stuck" with no reason in the log):
// every stop of a trip names its reason in the text and the log. mineOreText and tunnelText take the step's text as the
// optional third part of the stop sentence: `I mined <n> <item> of <m>. I stopped because <STOP_REASONS[reason]>: <text>`;
// without a text the old line. finish of mineOre writes `Mining stop: <reason> at (x, y, z), step <step>: <text>` through
// logTo with the trip's last step and its text.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeMiningBot, makeClock, makeCtx, give } from './mining_fake_bot.test.js';

const T = await loadSrc('src/agent/packs/mining/texts.js');
const M = await loadSrc('src/agent/packs/mining/mining.js');

const MINE = { entrance: { x: 20, y: 64, z: -14 }, length: 37, level: 16 };

describe('F5: the stop sentence with and without the detail', () => {
    test('mineOreText: the detail after a colon; without it the line of M4', () => {
        assert.equal(T.mineOreText({ item: 'raw_iron', mined: 2, wanted: 8, reason: 'stuck', detail: 'I could not get to the end of the tunnel at (10, 16, 20).', mine: MINE }),
            'I mined 2 raw_iron of 8. I stopped because I got stuck: I could not get to the end of the tunnel at (10, 16, 20). The mine is at (20, 64, -14), its tunnel is 37 blocks long at level 16.');
        assert.equal(T.mineOreText({ item: 'raw_iron', mined: 2, wanted: 8, reason: 'stuck', mine: MINE }),
            'I mined 2 raw_iron of 8. I stopped because I got stuck. The mine is at (20, 64, -14), its tunnel is 37 blocks long at level 16.');
        assert.equal(T.mineOreText({ item: 'raw_iron', mined: 2, wanted: 8, reason: 'stuck', detail: '', mine: MINE }),
            'I mined 2 raw_iron of 8. I stopped because I got stuck. The mine is at (20, 64, -14), its tunnel is 37 blocks long at level 16.', 'an empty detail is none');
        assert.equal(T.mineOreText({ item: 'raw_iron', mined: 2, wanted: 8, reason: 'blocked', detail: 'I found no way around lava, water or a cave at (10, 16, 21).' }),
            'I mined 2 raw_iron of 8. I stopped because my way is blocked by lava, water or caves: I found no way around lava, water or a cave at (10, 16, 21).');
        assert.equal(T.mineOreText({ item: 'raw_iron', mined: 8, wanted: 8, reason: null, detail: 'ignored' }), 'I mined 8 raw_iron.', 'a done trip has no stop sentence');
        assert.equal(T.mineOreText({ item: 'raw_iron', mined: 2, wanted: 8, reason: 'time', detail: 'The time for going down is over.', extra: 'I am in the mine.' }),
            'I mined 2 raw_iron of 8. I stopped because the time for one trip is over: The time for going down is over. I am in the mine.', 'the texts module adds every detail it gets; the trip leaves it out for time and interrupted');
    });

    test('tunnelText: the detail the same way', () => {
        assert.equal(T.tunnelText({ steps: 2, length: 2, reason: 'stuck', detail: 'I could not step ahead to (1, 16, 3).' }),
            'I dug 2 steps of the tunnel, it is 2 blocks long now. I collected no ore, placed 0 torches and closed 0 holes. I stopped because I got stuck: I could not step ahead to (1, 16, 3).');
        assert.equal(T.tunnelText({ steps: 2, length: 2, reason: 'blocked' }),
            'I dug 2 steps of the tunnel, it is 2 blocks long now. I collected no ore, placed 0 torches and closed 0 holes. I stopped because my way is blocked by lava, water or caves.');
        assert.equal(T.tunnelText({ steps: 0, length: 0, reason: 'dig_failed', block: 'obsidian', at: { x: 1, y: 2, z: 3 }, detail: 'I could not dig the obsidian at (1, 2, 3).' }),
            'I dug 0 steps of the tunnel, it is 0 blocks long now. I collected no ore, placed 0 torches and closed 0 holes. I stopped because I could not dig the obsidian at (1, 2, 3).');
    });
});

async function scene({ world = makeWorld() } = {}) {
    const bot = makeMiningBot({ world, pos: [0.5, 64, 0.5] });
    const clock = makeClock(bot);
    const ctx = await makeCtx(clock);
    const said = [];
    ctx.say = t => said.push(t);
    ctx.storage = { async storeItems() { return { ok: true, reason: null, stored: {}, left: {}, text: 'I stored nothing.' }; } };
    give(bot, 'iron_pickaxe', 1);
    give(bot, 'ladder', 64);
    give(bot, 'cobblestone', 64);
    give(bot, 'torch', 16);
    give(bot, 'bread', 8);
    give(bot, 'chest', 2);
    return { world, bot, clock, ctx, said, opts: { now: clock.now, wait: clock.wait } };
}

describe('F5: the trip says why and logs it', () => {
    test('bedrock in the shaft: the chat line names the block and where, the log has the Mining stop line with the step and the position of the stop', async () => {
        const world = makeWorld();
        world.set(0, 58, 0, 'bedrock');
        const s = await scene({ world });
        const r = await M.mineOre(s.bot, s.ctx, 'coal', 3, { ...s.opts, newMine: true });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'dig_failed', r.text);
        assert.match(r.text, /^I mined 0 coal of 3\. I stopped because I could not dig the bedrock at \(0, 58, 0\)\. The mine is at \(0, 64, 0\), its tunnel is 0 blocks long at level 56\. I am at \(0, 59, 0\), on the way to level 56 in the mine at \(0, 64, 0\): I dug \d+ blocks, placed \d+ ladders and closed 0 holes\.$/);
        const stop = s.ctx.logs.find(t => t.startsWith('Mining stop:'));
        assert.equal(stop, 'Mining stop: dig_failed at (0, 59, 0), step descend: I could not dig the bedrock at (0, 58, 0).', s.ctx.logs.join(' | '));
        assert.ok(s.ctx.logs.indexOf(stop) < s.ctx.logs.length, 'logged');
    });

    test('a dig the server refuses: dig_failed, never "blocked by lava, water or caves"', async () => {
        const s = await scene();
        s.bot.digError = 'boom';
        const r = await M.mineOre(s.bot, s.ctx, 'coal', 3, { ...s.opts, newMine: true });
        assert.equal(r.reason, 'dig_failed', r.text);
        assert.match(r.text, /^I mined 0 coal of 3\. I stopped because I could not dig the grass_block at \(0, 63, 0\)\./);
        assert.doesNotMatch(r.text, /lava, water or caves/);
        assert.match(s.ctx.logs.find(t => t.startsWith('Mining stop:')), /^Mining stop: dig_failed at \(0, 64, 0\), step descend: I could not dig the grass_block at \(0, 63, 0\)\.$/);
    });

    test('the trip\'s own time: the reason alone, no detail; the log still names the step', async () => {
        const s = await scene();
        s.ctx.settings.mining_max_minutes = 0.01; // the deadline is over before the way down ends
        const r = await M.mineOre(s.bot, s.ctx, 'coal', 50, { ...s.opts, newMine: true });
        assert.equal(r.reason, 'time', r.text);
        assert.match(r.text, /^I mined 0 coal of 50\. I stopped because the time for one trip is over\. The mine is at \(0, 64, 0\)/);
        assert.match(s.ctx.logs.find(t => t.startsWith('Mining stop:')), /^Mining stop: time at \(0, \d+, 0\), step descend: the time for one trip is over$/);
    });

    test('a done trip logs no stop line', async () => {
        const world = makeWorld().set(1, 56, -5, 'coal_ore').set(1, 57, -5, 'coal_ore').set(-1, 56, -8, 'coal_ore');
        const s = await scene({ world });
        const r = await M.mineOre(s.bot, s.ctx, 'coal', 1, { ...s.opts, newMine: true });
        assert.equal(r.ok, true, r.text);
        assert.ok(!s.ctx.logs.some(t => t.startsWith('Mining stop:')), s.ctx.logs.filter(t => t.startsWith('Mining stop')).join(' | '));
    });
});
