// Spec v0.1.4.12, 4.2 (part E): the step smelt of a plan (plan_logic.js: PLAN_COMMANDS, checkOf,
// missingSupplies, planPrompt) and ensureTool of the wood pack for iron tools with `smelting` on.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { fakeCraftRecipe, give, makeClock, makeWoodBot, makeWorld } from './wood_fake_bot.test.js';

const P = await loadSrc('src/agent/job/plan_logic.js');
const L = await loadSrc('src/agent/job/job_logic.js');
const K = await loadSrc('src/agent/packs/wood/tools.js');
const W = await loadSrc('src/agent/packs/wood/texts.js');
const SL = await loadSrc('src/agent/packs/storage/smelt_logic.js');

describe('the plan: the step smelt', () => {
    test('PLAN_COMMANDS keeps !smeltItem with the description of the spec', () => {
        const c = P.PLAN_COMMANDS.find(x => x.name === '!smeltItem');
        assert.equal(c.usage, '!smeltItem(item_name, num)');
        assert.equal(c.description, 'Smelt num of an item in a furnace: raw_iron to iron_ingot, raw_copper, raw_gold, sand to glass, logs to charcoal.');
        assert.deepEqual(c.params.map(p => p.type), ['string', 'int']);
        assert.ok(P.PLAN_COMMAND_NAMES.includes('!smeltItem'));
    });

    test('the job module has the same table of products as the storage pack', () => {
        assert.deepEqual(P.SMELT_PRODUCTS, SL.SMELT_PRODUCTS);
        for (const item of ['oak_log', 'stripped_cherry_wood', 'crimson_stem', 'warped_hyphae', 'minecraft:Raw_Gold', 'dirt', '', null]) {
            assert.equal(P.productOf(item), SL.productOf(item), String(item));
        }
    });

    test('checkOf: the product and the count, not the input', () => {
        assert.deepEqual(P.checkOf('!smeltItem', ['raw_iron', 3]), { item: 'iron_ingot', count: 3 });
        assert.deepEqual(P.checkOf('!smeltItem', ['sand', 8]), { item: 'glass', count: 8 });
        assert.deepEqual(P.checkOf('!smeltItem', ['oak_log', 2]), { item: 'charcoal', count: 2 });
        const [step] = P.parsePlan('!smeltItem("raw_iron", 3)', P.PLAN_COMMAND_NAMES);
        assert.deepEqual(step.check, { item: 'iron_ingot', count: 3 });
        assert.equal(P.stepDone(step, { raw_iron: 3 }, true), false, 'done when the ingots are there');
        assert.equal(P.stepDone(step, { iron_ingot: 3 }, false), true);
    });

    test('missingSupplies: iron_ingot is a supply that !smeltItem("raw_iron", n) makes', () => {
        assert.deepEqual(P.missingSupplies(null, { kind: 'no_item', item: 'iron_ingot' }, {}),
            [{ kind: 'no_item', item: 'iron_ingot', smelt: '!smeltItem("raw_iron", n)' }]);
        const job = L.jobOf('!craftRecipe', ['iron_pickaxe', 1]);
        assert.deepEqual(P.missingSupplies(job, { kind: 'no_pickaxe', item: 'iron_pickaxe' }, {}),
            [{ kind: 'no_pickaxe', item: 'iron_pickaxe' }, { kind: 'no_item', item: 'iron_ingot', smelt: '!smeltItem("raw_iron", 3)' }]);
        assert.deepEqual(P.missingSupplies(null, { kind: 'no_tool', item: 'iron_sword' }, {})[1].smelt, '!smeltItem("raw_iron", 2)');
        assert.deepEqual(P.missingSupplies(null, { kind: 'no_tool', item: 'stone_axe' }, {}), [{ kind: 'no_tool', item: 'stone_axe' }], 'no iron, no smelt');
    });

    test('the plan prompt lists !smeltItem and how the ingots are made', () => {
        const job = L.jobOf('!craftRecipe', ['iron_pickaxe', 1]);
        const prompt = P.planPrompt(job, { kind: 'no_pickaxe', item: 'iron_pickaxe', text: 'I need 3 iron_ingot for an iron_pickaxe and have none.' }, { coal: 4 });
        assert.ok(prompt.includes('!smeltItem(item_name, num): Smelt num of an item in a furnace: raw_iron to iron_ingot, raw_copper, raw_gold, sand to glass, logs to charcoal.'), prompt);
        assert.ok(prompt.includes('no_item (iron_ingot, made by !smeltItem("raw_iron", 3))'), prompt);
    });
});

describe('the plan: !mineOre for the raw iron (W105)', () => {
    const NO_IRON = { kind: 'no_iron', item: 'iron_ingot', text: 'I have no iron for an iron_pickaxe: 3 iron_ingot or 3 raw_iron are needed. Say "mine 3 iron" first.' };
    const job = L.jobOf('!getTool', ['pickaxe', 'iron']);

    test('a plan command: usage, description, params; not a surface command', () => {
        const c = P.PLAN_COMMANDS.find(x => x.name === '!mineOre');
        assert.equal(c.usage, '!mineOre(ore, num)');
        assert.equal(c.description, 'Mine num of an ore in the known mine: iron, coal, copper, gold, diamond.');
        assert.deepEqual(c.params.map(p => [p.type, p.default]), [['string', undefined], ['int', 8]]);
        assert.ok(P.PLAN_COMMAND_NAMES.includes('!mineOre'));
        assert.equal(P.needsSurface('!mineOre("iron", 3)'), false);
        assert.ok(!P.SURFACE_COMMANDS.includes('!mineOre'));
        assert.equal(P.needsSurface('!fetchItem("coal", 2)'), true, 'the coal of the room: the way out first');
    });

    test('checkOf: the drop of the ore and the count', () => {
        assert.deepEqual(P.checkOf('!mineOre', ['iron', 3]), { item: 'raw_iron', count: 3 });
        assert.deepEqual(P.checkOf('!mineOre', ['copper', 5]), { item: 'raw_copper', count: 5 });
        assert.deepEqual(P.checkOf('!mineOre', ['gold', 2]), { item: 'raw_gold', count: 2 });
        assert.deepEqual(P.checkOf('!mineOre', ['coal', 8]), { item: 'coal', count: 8 });
        assert.deepEqual(P.checkOf('!mineOre', ['diamond', 1]), { item: 'diamond', count: 1 });
        assert.deepEqual(P.checkOf('!mineOre', ['emerald', 1]), { item: 'emerald', count: 1 });
        assert.deepEqual(P.checkOf('!mineOre', ['lapis', 4]), { item: 'lapis_lazuli', count: 4 });
    });

    test('the plan of W105 is parsed with its checks', () => {
        const steps = P.parsePlan('!mineOre("iron", 3)\n!fetchItem("coal", 2)\n!smeltItem("raw_iron", 3)\n!getTool("pickaxe", "iron")', P.PLAN_COMMAND_NAMES);
        assert.deepEqual(steps.map(x => [x.command, x.check]), [
            ['!mineOre("iron", 3)', { item: 'raw_iron', count: 3 }],
            ['!fetchItem("coal", 2)', { item: 'coal', count: 2 }],
            ['!smeltItem("raw_iron", 3)', { item: 'iron_ingot', count: 3 }],
            ['!getTool("pickaxe", "iron")', { item: 'iron_pickaxe', count: null }],
        ]);
        assert.deepEqual(P.parsePlan('!mineOre("iron")', P.PLAN_COMMAND_NAMES)[0].check, { item: 'raw_iron', count: 8 }, 'the default 8');
        assert.equal(P.stepDone(steps[0], { raw_iron: 3 }, false), true);
    });

    test('missingSupplies: no raw iron carried or in a chest: mine, the coal of the chest, smelt, the tool', () => {
        const chests = [{ x: 1, y: 64, z: 1, items: { coal: 8, cobblestone: 20 } }];
        assert.deepEqual(P.missingSupplies(job, NO_IRON, { stone_pickaxe: 1 }, { mining: true, chests }), [{
            kind: 'no_iron', item: 'iron_ingot', smelt: '!smeltItem("raw_iron", 3)',
            steps: ['!mineOre("iron", 3)', '!fetchItem("coal", 1)', '!smeltItem("raw_iron", 3)', '!getTool("pickaxe", "iron")'],
        }]);
        assert.deepEqual(P.missingSupplies(job, NO_IRON, { coal: 2 }, { mining: true, chests: [] })[0].steps,
            ['!mineOre("iron", 3)', '!smeltItem("raw_iron", 3)', '!getTool("pickaxe", "iron")'], 'it carries fuel');
        assert.equal(P.missingSupplies(job, NO_IRON, { raw_iron: 3 }, { mining: true })[0].steps, undefined, 'raw iron carried');
        assert.equal(P.missingSupplies(job, NO_IRON, {}, { mining: true, chests: [{ items: { raw_iron: 4 } }] })[0].steps, undefined, 'raw iron in a chest');
        assert.equal(P.missingSupplies(job, NO_IRON, {}, { mining: false })[0].steps, undefined, 'no mine: no mining step');
        assert.equal(P.missingSupplies(job, NO_IRON, {})[0].steps, undefined);
    });

    test('the prompt lists !mineOre only with the mining pack and a known mine, and gives the steps', () => {
        const on = P.planPrompt(job, NO_IRON, { stone_pickaxe: 1 }, P.PLAN_COMMANDS, { mining: true, chests: [{ x: 1, y: 64, z: 1, items: { coal: 8 } }] });
        assert.ok(on.includes('!mineOre(ore, num): Mine num of an ore in the known mine: iron, coal, copper, gold, diamond.'), on);
        assert.ok(on.includes('no_iron (iron_ingot, made by !smeltItem("raw_iron", 3); the steps: !mineOre("iron", 3), !fetchItem("coal", 1), !smeltItem("raw_iron", 3), !getTool("pickaxe", "iron"))'), on);
        const off = P.planPrompt(job, NO_IRON, { stone_pickaxe: 1 }, P.PLAN_COMMANDS, { mining: false });
        assert.ok(!off.includes('!mineOre'), off);
        assert.ok(!P.planPrompt(job, NO_IRON, {}, P.PLAN_COMMANDS).includes('!mineOre'));
        assert.ok(off.includes('!smeltItem(item_name, num)'));
    });
});

function scene({ smelting = true, storage = null, chests = null } = {}) {
    const world = makeWorld();
    const bot = makeWoodBot({ world, pos: [0.5, 64, 0.5] });
    const clock = makeClock();
    const lines = [];
    const ctx = { areas: [], log: (t) => lines.push(t), now: clock.now, settings: { smelting }, skills: { craftRecipe: fakeCraftRecipe(bot) } };
    if (storage) ctx.storage = storage;
    if (chests) ctx.chests = chests;
    return { world, bot, ctx, clock, lines, opts: { now: clock.now, wait: clock.wait } };
}

describe('ensureTool: an iron tool with smelting on', () => {
    test('without any iron: no_iron with the text of the spec, the counts per tool', async () => {
        const s = scene();
        give(s.bot, 'oak_log', 4);
        const r = await K.ensureTool(s.bot, s.ctx, 'pickaxe', 'iron', s.opts);
        assert.deepEqual(r, { ok: false, reason: 'no_iron', tool: null, crafted: [],
            text: 'I have no iron for an iron_pickaxe: 3 iron_ingot or 3 raw_iron are needed. Say "mine 3 iron" first.' });
        for (const [kind, n] of [['axe', 3], ['sword', 2], ['shovel', 1], ['hoe', 2]]) {
            const t = await K.ensureTool(s.bot, s.ctx, kind, 'iron', s.opts);
            assert.equal(t.reason, 'no_iron', kind);
            assert.equal(t.text, `I have no iron for an iron_${kind}: ${n} iron_ingot or ${n} raw_iron are needed. Say "mine ${n} iron" first.`);
        }
        assert.equal((await K.ensureTool(s.bot, s.ctx, 'iron_pickaxe', '', s.opts)).reason, 'no_iron', 'the full name');
        assert.equal(W.noIronText('iron_pickaxe', 3), 'I have no iron for an iron_pickaxe: 3 iron_ingot or 3 raw_iron are needed. Say "mine 3 iron" first.');
    });

    test('with raw iron: it smelts through ctx.storage.smeltItem, then crafts', async () => {
        const calls = [];
        const s = scene();
        s.ctx.storage = {
            async smeltItem(bot, ctx, item, n) {
                calls.push([item, n]);
                give(bot, 'iron_ingot', n);
                bot.inventory.items().find(i => i.name === 'raw_iron').count -= n;
                return { ok: true, reason: null, text: `I smelted ${n} raw_iron into ${n} iron_ingot in the furnace at (2, 64, 0) with 1 coal.`, smelted: n };
            },
            async fetchItem() { return { ok: false, taken: 0, text: '' }; },
        };
        give(s.bot, 'raw_iron', 4);
        give(s.bot, 'iron_ingot', 1);
        give(s.bot, 'oak_log', 2);
        const r = await K.ensureTool(s.bot, s.ctx, 'pickaxe', 'iron', s.opts);
        assert.deepEqual(calls, [['raw_iron', 2]], 'only what the ingots lack');
        assert.equal(r.ok, true, r.text);
        assert.equal(r.text, 'I smelted 2 raw_iron into 2 iron_ingot in the furnace at (2, 64, 0) with 1 coal. I crafted an iron_pickaxe.');
    });

    test('raw iron in a known chest: fetched, then smelted', async () => {
        const order = [];
        const s = scene({ chests: { list: () => [{ x: 1, y: 64, z: 1, items: { raw_iron: 5 } }] } });
        s.ctx.storage = {
            async fetchItem(bot, ctx, name, n) {
                order.push(['fetch', name, n]);
                if (name !== 'raw_iron') return { ok: false, taken: 0, text: `I know no chest with ${name}.` };
                give(bot, name, n);
                return { ok: true, taken: n, text: '' };
            },
            async smeltItem(bot, ctx, item, n) { order.push(['smelt', item, n]); return { ok: false, reason: 'no_fuel', text: 'I have no fuel: no coal, charcoal, planks or logs.', smelted: 0 }; },
        };
        const r = await K.ensureTool(s.bot, s.ctx, 'sword', 'iron', s.opts);
        assert.deepEqual(order.slice(0, 2), [['fetch', 'raw_iron', 2], ['smelt', 'raw_iron', 2]]);
        assert.equal(r.ok, false);
        assert.ok(r.text.startsWith('I have no fuel: no coal, charcoal, planks or logs. I need 2 iron_ingot for an iron_sword'), r.text);
    });

    test('the binding may be absent: no smelt, the craft says what it lacks', async () => {
        const s = scene();
        give(s.bot, 'raw_iron', 3);
        const r = await K.ensureTool(s.bot, s.ctx, 'pickaxe', 'iron', s.opts);
        assert.equal(r.text, 'I need 3 iron_ingot for an iron_pickaxe and have none.');
    });

    test('smelting off: as before, no smelt and no no_iron', async () => {
        const calls = [];
        const s = scene({ smelting: false });
        s.ctx.storage = { async smeltItem(...a) { calls.push(a); return {}; }, async fetchItem() { return { ok: false, taken: 0 }; } };
        give(s.bot, 'raw_iron', 3);
        const r = await K.ensureTool(s.bot, s.ctx, 'pickaxe', 'iron', s.opts);
        assert.equal(r.text, 'I need 3 iron_ingot for an iron_pickaxe and have none.');
        assert.deepEqual(calls, []);
        const t = scene({ smelting: false });
        assert.equal((await K.ensureTool(t.bot, t.ctx, 'pickaxe', 'iron', t.opts)).reason, 'missing');
    });
});
