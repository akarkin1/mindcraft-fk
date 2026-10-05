// Tests from the spec (v0.1.4.13, section 6, T1): the wear rule of part P (SPEC 4.4, P2) at 11, 10 and 0 uses.
// Before each dig the pack reads the uses left of the tool in hand (maxDurability - durabilityUsed). At 10 or
// fewer: a replacement from the bag (a pickaxe that can mine the ore) is equipped, else one is crafted from carried
// material, with `My iron_pickaxe is nearly worn: 8 uses left. I made a new one.`; when nothing can be made:
// `My iron_pickaxe is nearly worn: 8 uses left. I have no iron for a new one. I stop the mining at 7 of 28 diamond.`
// The old pickaxe is kept in the bag, not thrown. The handoff: digBlock answers `{ ok: false, reason: 'worn', worn:
// { name, uses } }` without a replacement; the spare's text `... I take my spare one.` (beyond the spec).
// The bot is a fake mineflayer bot (tests/helpers/xt_bot.js): the test checks what it dug, equipped and tossed.
// A failing test is a finding.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { WEAR_LIMIT, digBlock, wornTool } from '../../src/agent/packs/mining/dig.js';
import { wornMadeText, wornSpareText, wornStopText } from '../../src/agent/packs/mining/texts.js';
import { replaceWornPickaxe } from '../../src/agent/packs/mining/mining.js';
import { oreOf } from '../../src/agent/packs/mining/index.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { makeFakeBot, makeItem, makeToolItem } from '../helpers/xt_bot.js';

const ORE_AT = { x: 1, y: 63, z: 0 };

function digWorld() {
    const world = createBlockWorld().flatGround(62, 'stone', 'stone');
    world.set(ORE_AT.x, ORE_AT.y, ORE_AT.z, 'iron_ore');
    return world;
}

/** A clock that never sleeps: the dig of the fake ends at once. */
const clock = { now: () => Date.now(), wait: async () => {}, sleep: async () => {} };

function botWith(held, others = []) {
    const items = [held, ...others].filter(Boolean);
    return makeFakeBot({ world: digWorld(), pos: { x: 0, y: 63, z: 0 }, items, held });
}

describe('SPEC 4.4 P2: the rule, 10 uses or fewer', () => {
    test('the limit is 10', () => {
        assert.equal(WEAR_LIMIT, 10);
    });

    test('11 uses: not worn', () => {
        assert.equal(wornTool(makeToolItem('iron_pickaxe', 11)), null);
    });

    test('10 uses: worn', () => {
        assert.deepEqual(wornTool(makeToolItem('iron_pickaxe', 10)), { name: 'iron_pickaxe', uses: 10 });
    });

    test('0 uses: worn', () => {
        assert.deepEqual(wornTool(makeToolItem('iron_pickaxe', 0)), { name: 'iron_pickaxe', uses: 0 });
    });

    test('the uses are maxDurability - durabilityUsed: a stone pickaxe at 10 is worn, at 11 not', () => {
        assert.deepEqual(wornTool(makeToolItem('stone_pickaxe', 10)), { name: 'stone_pickaxe', uses: 10 });
        assert.equal(wornTool(makeToolItem('stone_pickaxe', 11)), null);
    });
});

describe('SPEC 4.4 P2: the texts, word for word', () => {
    test('made: My iron_pickaxe is nearly worn: 8 uses left. I made a new one.', () => {
        assert.equal(wornMadeText('iron_pickaxe', 8), 'My iron_pickaxe is nearly worn: 8 uses left. I made a new one.');
        assert.equal(wornMadeText('iron_pickaxe', 10), 'My iron_pickaxe is nearly worn: 10 uses left. I made a new one.');
        assert.equal(wornMadeText('iron_pickaxe', 0), 'My iron_pickaxe is nearly worn: 0 uses left. I made a new one.');
    });

    test('nothing can be made: ... I have no iron for a new one. I stop the mining at 7 of 28 diamond.', () => {
        assert.equal(wornStopText('iron_pickaxe', 8, 7, 28, 'diamond'),
            'My iron_pickaxe is nearly worn: 8 uses left. I have no iron for a new one. I stop the mining at 7 of 28 diamond.');
        assert.equal(wornStopText('stone_pickaxe', 0, 2, 6, 'iron'),
            'My stone_pickaxe is nearly worn: 0 uses left. I have no stone for a new one. I stop the mining at 2 of 6 iron.');
    });

    test('the spare of the bag (the handoff): ... I take my spare one.', () => {
        assert.equal(wornSpareText('iron_pickaxe', 10), 'My iron_pickaxe is nearly worn: 10 uses left. I take my spare one.');
    });

    test('no text says the old stop text "nearly broken"', () => {
        for (const text of [wornMadeText('iron_pickaxe', 8), wornSpareText('iron_pickaxe', 8), wornStopText('iron_pickaxe', 8, 7, 28, 'diamond')])
            assert.doesNotMatch(text, /nearly broken/);
    });
});

describe('SPEC 4.4 P2: before each dig, at 11, 10 and 0 uses', () => {
    test('11 uses and no other pickaxe: the dig is done with the pickaxe in hand', async () => {
        // (with a fresher pickaxe in the bag the old rule "the best tool" may take that one: not the wear rule)
        const held = makeToolItem('iron_pickaxe', 11);
        const bot = botWith(held);
        const r = await digBlock(bot, ORE_AT, { clock });
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.notEqual(r.reason, 'worn');
        assert.equal(bot.calls.dug.length, 1);
        assert.equal(bot.calls.dug[0].with, 'iron_pickaxe');
    });

    test('10 uses with a pickaxe of the bag that mines the ore: that one is equipped, the dig is done, the old one kept', async () => {
        const held = makeToolItem('iron_pickaxe', 10);
        const spare = makeToolItem('stone_pickaxe', 100, 37);
        const bot = botWith(held, [spare]);
        const r = await digBlock(bot, ORE_AT, { clock });
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.ok(bot.calls.equipped.some((e) => e.name === 'stone_pickaxe'), JSON.stringify(bot.calls.equipped));
        assert.equal(bot.calls.dug.length, 1);
        assert.equal(bot.calls.dug[0].with, 'stone_pickaxe');
        assert.deepEqual(bot.calls.tossed, [], 'the old pickaxe is not thrown');
        assert.ok(bot.inventory.items().includes(held), 'the old pickaxe stays in the bag');
    });

    test('10 uses and only a pickaxe that cannot mine the ore: not dug, worn', async () => {
        const held = makeToolItem('iron_pickaxe', 10);
        const bot = botWith(held, [makeToolItem('wooden_pickaxe', 59, 37)]);
        const r = await digBlock(bot, ORE_AT, { clock });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'worn');
        assert.deepEqual(r.worn, { name: 'iron_pickaxe', uses: 10 });
        assert.equal(bot.calls.dug.length, 0, 'the dig is not done');
    });

    test('10 uses and no other pickaxe: not dug, worn', async () => {
        const bot = botWith(makeToolItem('iron_pickaxe', 10));
        const r = await digBlock(bot, ORE_AT, { clock });
        assert.equal(r.reason, 'worn');
        assert.deepEqual(r.worn, { name: 'iron_pickaxe', uses: 10 });
        assert.equal(bot.calls.dug.length, 0);
        assert.deepEqual(bot.calls.tossed, []);
    });

    test('0 uses and no other pickaxe: not dug, worn', async () => {
        const bot = botWith(makeToolItem('iron_pickaxe', 0));
        const r = await digBlock(bot, ORE_AT, { clock });
        assert.equal(r.reason, 'worn');
        assert.deepEqual(r.worn, { name: 'iron_pickaxe', uses: 0 });
        assert.equal(bot.calls.dug.length, 0);
    });
});

describe('SPEC 4.4 P2: the replacement and its texts', () => {
    const DIAMOND = oreOf('diamond');

    function ctxWith(ensureTool) {
        const said = [];
        const asked = [];
        return {
            said,
            asked,
            say: (text) => said.push(text),
            tools: {
                ensureTool: async (...args) => {
                    asked.push(args);
                    return ensureTool(...args);
                },
            },
        };
    }

    test('crafted from carried material: I made a new one., the old pickaxe kept', async () => {
        const held = makeToolItem('iron_pickaxe', 8);
        const bot = makeFakeBot({ world: digWorld(), pos: { x: 0, y: 63, z: 0 }, items: [held, makeItem('iron_ingot', 3, 37), makeItem('stick', 2, 38)], held });
        const ctx = ctxWith(async () => {
            const made = makeToolItem('iron_pickaxe', 250, 39);
            bot.inventory.items = ((items) => () => [...items, made])(bot.inventory.items());
            return { ok: true, reason: null, text: 'I crafted an iron_pickaxe.' };
        });
        const r = await replaceWornPickaxe(bot, ctx, DIAMOND, { name: 'iron_pickaxe', uses: 8 }, { mined: 7, wanted: 28 });
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.ok(ctx.asked.length >= 1, 'a pickaxe was made through ensureTool');
        assert.ok(ctx.said.includes('My iron_pickaxe is nearly worn: 8 uses left. I made a new one.'), JSON.stringify(ctx.said));
        assert.deepEqual(bot.calls.tossed, [], 'the old pickaxe is not thrown');
    });

    test('nothing can be made: the stop text with the count, and no "nearly broken" before it', async () => {
        const held = makeToolItem('iron_pickaxe', 8);
        const bot = makeFakeBot({ world: digWorld(), pos: { x: 0, y: 63, z: 0 }, items: [held], held });
        const ctx = ctxWith(async () => ({ ok: false, reason: 'no_material', text: 'I have no iron_ingot.' }));
        const r = await replaceWornPickaxe(bot, ctx, DIAMOND, { name: 'iron_pickaxe', uses: 8 }, { mined: 7, wanted: 28 });
        assert.equal(r.ok, false);
        const stop = 'My iron_pickaxe is nearly worn: 8 uses left. I have no iron for a new one. I stop the mining at 7 of 28 diamond.';
        assert.ok(r.text === stop || ctx.said.includes(stop), `${r.text} | ${JSON.stringify(ctx.said)}`);
        assert.ok(!ctx.said.some((t) => /nearly broken/.test(t)), JSON.stringify(ctx.said));
        assert.deepEqual(bot.calls.tossed, []);
    });
});
