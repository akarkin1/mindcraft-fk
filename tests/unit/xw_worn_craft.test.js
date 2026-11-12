// E3, spec v0.1.4.16 F5 (the play of 2026-11-11: "I have no stone for a new one" with 65 cobblestone in the bag): the
// worn-pickaxe line. "I have no <material> for a new one." is said only when pickaxeToCraft found nothing to craft from;
// when the bag holds the material and the craft failed, the line names why (ensureTool's text): `My <name> is nearly
// worn: <uses> uses left. I could not make a new one: <reason>. I stop the mining at <mined> of <wanted> <ore>.`
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeMiningBot, makeClock, makeCtx, give, count } from './mining_fake_bot.test.js';

const T = await loadSrc('src/agent/packs/mining/texts.js');
const M = await loadSrc('src/agent/packs/mining/mining.js');
const P = await loadSrc('src/agent/packs/mining/ore_table.js');

async function scene() {
    const bot = makeMiningBot({ world: makeWorld(), pos: [0.5, 64, 0.5] });
    const clock = makeClock(bot);
    const ctx = await makeCtx(clock);
    const said = [];
    ctx.say = t => said.push(t);
    return { bot, clock, ctx, said };
}

const WORN = { name: 'iron_pickaxe', uses: 8 };
const COUNT = { mined: 7, wanted: 28 };

describe('F5: wornCraftFailedText, word for word', () => {
    test('the line of the spec', () => {
        assert.equal(T.wornCraftFailedText('stone_pickaxe', 3, 'I need 2 stick for a stone_pickaxe and have 0.', 0, 6, 'iron'),
            'My stone_pickaxe is nearly worn: 3 uses left. I could not make a new one: I need 2 stick for a stone_pickaxe and have 0. I stop the mining at 0 of 6 iron.');
        assert.equal(T.wornCraftFailedText('iron_pickaxe', 8, 'missing', 7, 28, P.oreOf('diamond')),
            'My iron_pickaxe is nearly worn: 8 uses left. I could not make a new one: missing. I stop the mining at 7 of 28 diamond.');
        assert.equal(T.wornCraftFailedText('iron_pickaxe', 8, '', 7, 28, 'diamond'),
            'My iron_pickaxe is nearly worn: 8 uses left. I could not make a new one: the craft failed. I stop the mining at 7 of 28 diamond.', 'no reason given');
    });
});

describe('F5: replaceWornPickaxe with material in the bag', () => {
    test('65 cobblestone and a failed craft: the line names the reason, never "no stone"', async () => {
        const s = await scene();
        give(s.bot, 'iron_pickaxe', 1, { used: 242 });
        give(s.bot, 'cobblestone', 65);
        const asked = [];
        s.ctx.tools = {
            async ensureTool(b, c, kind, material, options) {
                asked.push({ kind, material, options });
                return { ok: false, reason: 'missing', text: 'I need 2 stick for a stone_pickaxe and have 0.' };
            },
        };
        const r = await M.replaceWornPickaxe(s.bot, s.ctx, P.oreOf('iron'), WORN, COUNT);
        assert.equal(r.ok, false);
        assert.deepEqual(asked.map(a => [a.kind, a.material]), [['pickaxe', 'stone']], 'a stone pickaxe from the cobblestone');
        assert.equal(r.text, 'My iron_pickaxe is nearly worn: 8 uses left. I could not make a new one: I need 2 stick for a stone_pickaxe and have 0. I stop the mining at 7 of 28 iron.');
        assert.deepEqual(s.said, [r.text]);
        assert.doesNotMatch(r.text, /I have no stone/);
        assert.equal(count(s.bot, 'cobblestone'), 65, 'nothing taken');
    });

    test('the craft answers without a text: its reason; without tool skills: the missing skills', async () => {
        const s = await scene();
        give(s.bot, 'iron_pickaxe', 1, { used: 242 });
        give(s.bot, 'cobblestone', 10);
        s.ctx.tools = { async ensureTool() { return { ok: false, reason: 'interrupted', text: '' }; } };
        const r = await M.replaceWornPickaxe(s.bot, s.ctx, P.oreOf('iron'), WORN, COUNT);
        assert.equal(r.text, 'My iron_pickaxe is nearly worn: 8 uses left. I could not make a new one: interrupted. I stop the mining at 7 of 28 iron.');
        delete s.ctx.tools;
        const r2 = await M.replaceWornPickaxe(s.bot, s.ctx, P.oreOf('iron'), WORN, COUNT);
        assert.equal(r2.text, 'My iron_pickaxe is nearly worn: 8 uses left. I could not make a new one: I have no tool skills. I stop the mining at 7 of 28 iron.');
    });

    test('no material at all: the old line "I have no stone for a new one." (the material the new one would be made of)', async () => {
        const s = await scene();
        give(s.bot, 'iron_pickaxe', 1, { used: 242 });
        let asked = 0;
        s.ctx.tools = { async ensureTool() { asked++; return { ok: false, reason: 'missing', text: 'I need 3 cobblestone for a stone_pickaxe and have 0.' }; } };
        const r = await M.replaceWornPickaxe(s.bot, s.ctx, P.oreOf('iron'), WORN, COUNT);
        assert.equal(asked, 0, 'nothing to craft from: no craft asked');
        assert.equal(r.text, 'My iron_pickaxe is nearly worn: 8 uses left. I have no stone for a new one. I stop the mining at 7 of 28 iron.');
    });

    test('the craft succeeds: "I made a new one." as before', async () => {
        const s = await scene();
        give(s.bot, 'iron_pickaxe', 1, { used: 242 });
        give(s.bot, 'cobblestone', 10);
        give(s.bot, 'stick', 2);
        s.ctx.tools = {
            async ensureTool(b) {
                give(b, 'stone_pickaxe', 1);
                return { ok: true, reason: null, text: 'I crafted a stone_pickaxe.' };
            },
        };
        const r = await M.replaceWornPickaxe(s.bot, s.ctx, P.oreOf('iron'), WORN, COUNT);
        assert.equal(r.ok, true, r.text);
        assert.equal(r.text, 'My iron_pickaxe is nearly worn: 8 uses left. I made a new one.');
    });
});
