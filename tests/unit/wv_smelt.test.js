// Tester T1 of v0.1.4.12 "Understanding and watching", from the spec 4.2 (part E, smelting) and HANDOFF F1 of the
// decisions: chooseFuel (coal or charcoal 8 items each, then planks 1.5, then logs 1.5; the fewest units that cover the
// count; never lava buckets or blaze rods; none: null), the six texts of storage/texts.js word for word (noFurnace a
// function of the range it searched, 64 after F1), the early answers of smeltItem on a bare fake bot, and the no_iron
// answer of ensureTool for an iron tool with smelting on.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { fakeCraftRecipe, give, makeClock, makeWoodBot, makeWorld } from './wood_fake_bot.test.js';

const L = await loadSrc('src/agent/packs/storage/smelt_logic.js');
const T = await loadSrc('src/agent/packs/storage/texts.js');
const SM = await loadSrc('src/agent/packs/storage/smelt.js');
const K = await loadSrc('src/agent/packs/wood/tools.js');

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

const fuel = (inv, n) => {
    const f = L.chooseFuel(inv, n);
    return f && { name: f.name, count: f.count };
};

describe('4.2 chooseFuel: the order and the fewest units', () => {
    test('coal: 8 items each; 8 raw_iron take 1 coal, 9 take 2, 64 take 8', () => {
        assert.deepEqual(fuel({ coal: 10 }, 8), { name: 'coal', count: 1 });
        assert.deepEqual(fuel({ coal: 10 }, 9), { name: 'coal', count: 2 });
        assert.deepEqual(fuel({ coal: 10 }, 1), { name: 'coal', count: 1 });
        assert.deepEqual(fuel({ coal: 10 }, 64), { name: 'coal', count: 8 });
    });

    test('charcoal like coal', () => {
        assert.deepEqual(fuel({ charcoal: 3 }, 16), { name: 'charcoal', count: 2 });
    });

    test('planks: 1.5 items each; 3 items take 2 planks, 8 take 6', () => {
        assert.deepEqual(fuel({ oak_planks: 20 }, 3), { name: 'oak_planks', count: 2 });
        assert.deepEqual(fuel({ oak_planks: 20 }, 8), { name: 'oak_planks', count: 6 });
        assert.deepEqual(fuel({ birch_planks: 20 }, 1), { name: 'birch_planks', count: 1 });
    });

    test('logs: 1.5 items each; 3 items take 2 logs', () => {
        assert.deepEqual(fuel({ oak_log: 5 }, 3), { name: 'oak_log', count: 2 });
        assert.deepEqual(fuel({ spruce_log: 5 }, 6), { name: 'spruce_log', count: 4 });
    });

    test('coal before planks before logs', () => {
        assert.deepEqual(fuel({ oak_log: 64, oak_planks: 64, coal: 2 }, 8), { name: 'coal', count: 1 });
        assert.deepEqual(fuel({ oak_log: 64, oak_planks: 64 }, 8), { name: 'oak_planks', count: 6 });
        assert.deepEqual(fuel({ oak_log: 64 }, 8), { name: 'oak_log', count: 6 });
    });

    test('the inventory as a list of items works too', () => {
        assert.deepEqual(fuel([{ name: 'coal', count: 2 }, { name: 'raw_iron', count: 8 }], 8), { name: 'coal', count: 1 });
    });

    test('never lava buckets or blaze rods: alone they are no fuel', () => {
        assert.equal(L.chooseFuel({ lava_bucket: 5, blaze_rod: 10 }, 8), null);
        assert.notEqual(fuel({ lava_bucket: 5, blaze_rod: 10, oak_planks: 20 }, 8)?.name, 'lava_bucket');
        assert.equal(fuel({ lava_bucket: 5, blaze_rod: 10, oak_planks: 20 }, 8).name, 'oak_planks');
    });

    test('no fuel: null', () => {
        assert.equal(L.chooseFuel({}, 8), null);
        assert.equal(L.chooseFuel({ raw_iron: 8, cobblestone: 64 }, 8), null);
    });
});

describe('4.2 the texts, word for word', () => {
    test('smelted', () => {
        assert.equal(T.TEXTS.smelted(8, 'raw_iron', 'iron_ingot', { x: 400, y: 41, z: -2 }, 1, 'coal'),
            'I smelted 8 raw_iron into 8 iron_ingot in the furnace at (400, 41, -2) with 1 coal.');
    });

    test('noFuel', () => {
        assert.equal(T.TEXTS.noFuel, 'I have no fuel: no coal, charcoal, planks or logs.');
    });

    test('noFurnace: the range it searched (HANDOFF F1: within 64)', () => {
        assert.equal(T.TEXTS.noFurnace(16), 'I know no furnace within 16 blocks and carry none.');
        assert.equal(T.TEXTS.noFurnace(64), 'I know no furnace within 64 blocks and carry none.');
    });

    test('noItem', () => {
        assert.equal(T.TEXTS.noItem('raw_iron'), 'I carry no raw_iron.');
    });

    test('stopped', () => {
        assert.equal(T.TEXTS.stopped(3, 8, 'raw_iron'), 'I stopped after 3 of 8 raw_iron.');
    });

    test('notSmeltable', () => {
        assert.equal(T.TEXTS.notSmeltable('raw_cobblestone'), 'raw_cobblestone is not something a furnace changes.');
    });
});

// A bot with the given items, no furnace in the world, nothing that places one.
function bareBot(items) {
    return {
        username: 'Luna',
        entity: { position: { x: 0.5, y: 64, z: 0.5 } },
        inventory: { items: () => items.map(([name, count]) => ({ name, count })), slots: [] },
        findBlocks: () => [],
        blockAt: () => null,
        game: { dimension: 'overworld' },
    };
}

describe('4.2 smeltItem: the early answers', () => {
    const ctx = { areas: [], log: () => {} };

    test('not smeltable: reason not_smeltable and its text', async () => {
        const r = await SM.smeltItem(bareBot([['cobblestone', 8], ['coal', 1]]), ctx, 'raw_cobblestone', 8);
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'not_smeltable');
        assert.equal(r.text, 'raw_cobblestone is not something a furnace changes.');
    });

    test('nothing to smelt: reason no_item, "I carry no raw_iron."', async () => {
        const r = await SM.smeltItem(bareBot([['coal', 1]]), ctx, 'raw_iron', 8);
        assert.equal(r.reason, 'no_item');
        assert.equal(r.text, 'I carry no raw_iron.');
    });

    test('no fuel: reason no_fuel; lava buckets and blaze rods are no fuel', async () => {
        const r = await SM.smeltItem(bareBot([['raw_iron', 8], ['lava_bucket', 1], ['blaze_rod', 4]]), ctx, 'raw_iron', 8);
        assert.equal(r.reason, 'no_fuel');
        assert.equal(r.text, 'I have no fuel: no coal, charcoal, planks or logs.');
    });

    test('no furnace within 64 and none carried: reason no_furnace, the text names 64', async () => {
        const r = await SM.smeltItem(bareBot([['raw_iron', 8], ['coal', 1]]), ctx, 'raw_iron', 8);
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'no_furnace');
        assert.equal(r.text, 'I know no furnace within 64 blocks and carry none.');
        assert.equal(r.smelted, 0);
    });
});

describe('4.2 ensureTool of the wood pack: an iron tool without iron, smelting on', () => {
    function scene(smelting = true) {
        const world = makeWorld();
        const bot = makeWoodBot({ world, pos: [0.5, 64, 0.5] });
        const clock = makeClock();
        const ctx = { areas: [], log: () => {}, now: clock.now, settings: { smelting }, skills: { craftRecipe: fakeCraftRecipe(bot) } };
        return { bot, ctx, opts: { now: clock.now, wait: clock.wait } };
    }

    test('iron_pickaxe: reason no_iron with the text of the spec', async () => {
        const s = scene();
        give(s.bot, 'oak_log', 4);
        const r = await K.ensureTool(s.bot, s.ctx, 'pickaxe', 'iron', s.opts);
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'no_iron');
        assert.equal(r.text, 'I have no iron for an iron_pickaxe: 3 iron_ingot or 3 raw_iron are needed. Say "mine 3 iron" first.');
    });

    test('iron_axe, iron_sword, iron_shovel: no_iron too', async () => {
        for (const kind of ['axe', 'sword', 'shovel']) {
            const s = scene();
            const r = await K.ensureTool(s.bot, s.ctx, kind, 'iron', s.opts);
            assert.equal(r.reason, 'no_iron', kind);
            assert.match(r.text, new RegExp(`^I have no iron for an iron_${kind}: \\d iron_ingot or \\d raw_iron are needed\\. Say "mine \\d iron" first\\.$`), kind);
        }
    });
});
