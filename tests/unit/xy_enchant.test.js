// Spec v0.1.4.16 section 8.3 (E7): the work of the enchanting pack (enchanting.js) on a fake bot with a fake enchanting
// window that behaves as the probe of 2026-11-13 found the window of 26.1 on the test server:
//   - the items are moved by their slot in the OPEN window (bag slots 9..44 are window slots 2..37); a bag slot number
//     moves whatever the window has there (the probe's first run moved nothing);
//   - at the open the costs are 0, 0, 0 with the enchantments -1 (mineflayer's 'ready' fires already then); the offers come
//     a moment after the item is in slot 0; an item the table cannot enchant keeps cost 0 / id -1;
//   - window.enchant(i) spends i + 1 levels and i + 1 lapis and gives the item the 26.1 component, the game's extras
//     included (offer 1, Unbreaking I, gave Efficiency I and Unbreaking I).
// The flow with the choice '' and !enchantTake, the take-back on 0 and after 60 s, the code-driven choice (a number, a
// name, a name the table does not offer), the level rule, the refusals, the lapis (the bag, ctx.stock.takeOrAsk, the pack's
// own asking copy with ctx.permits), the stop; and the glue (actions.js, agent.js).
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import minecraftData from 'minecraft-data';
import vec3 from 'vec3';
import { loadSrc, TEST_MC_VERSION } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { enchant, enchantTake, questionWaits } from '../../src/agent/packs/enchanting/enchanting.js';
import { TEXTS } from '../../src/agent/packs/enchanting/texts.js';

const { Vec3 } = vec3;
const REG = minecraftData(TEST_MC_VERSION);
const TABLE = new Vec3(3, 64, 0);
const PROBE_OFFERS = [
    { level: 8, expected: { enchant: 40, level: 1 } },
    { level: 13, expected: { enchant: 40, level: 2 } },
    { level: 30, expected: { enchant: 8, level: 4 } },
];
// What the game gives for each offer (offer 1 as the probe saw it; the others alike).
const PROBE_RESULTS = [
    [{ id: 8, level: 1 }, { id: 40, level: 1 }],
    [{ id: 40, level: 2 }],
    [{ id: 8, level: 4 }, { id: 40, level: 1 }],
];
const ZERO = () => [0, 1, 2].map(() => ({ level: 0, expected: { enchant: -1, level: -1 } }));
const OFFERS_LINE = 'The table offers for your diamond_pickaxe: 1) Unbreaking I (8 levels, 1 lapis), 2) Unbreaking II (13 levels, 2 lapis), 3) Efficiency IV (30 levels, 3 lapis). Say "take 1", "take 2", "take 3" or "none".';
const TOOK_BACK = 'I took the diamond_pickaxe back; say "enchant my pickaxe" again when you have chosen.';

const tick = () => new Promise((resolve) => setImmediate(resolve));

// An item of the bag: the 26.1 component as prismarine-item's `enchants` gives it (the raw component, [] without one).
function makeItem(name, count, slot, enchantments = null) {
    return { name, count, slot, type: REG.itemsByName[name]?.id ?? 0, enchantments,
        get enchants() { return this.enchantments ? { enchantments: this.enchantments } : []; } };
}

// The fake bot: a bag of slots 9..44, the table at TABLE within reach, the window of the probe.
function makeBot({ level = 30, items = [['diamond_pickaxe', 1], ['lapis_lazuli', 16]], table = true, offers = PROBE_OFFERS,
    results = PROBE_RESULTS, noOffer = () => false, loseFirst = false, enchantHangs = false, lapisMoves = Infinity } = {}) {
    const bag = new Map(); // bag slot -> item
    let next = 36;
    for (const [name, count, enchantments] of items) bag.set(next++, makeItem(name, count, next - 1, enchantments ?? null));
    const calls = [];
    const bot = {
        calls,
        registry: REG,
        entity: { position: new Vec3(1.5, 64, 0.5) },
        game: { gameMode: 'survival', dimension: 'overworld' },
        experience: { level, points: 0 },
        interrupt_code: false,
        currentWindow: null,
        bag,
        inventory: { items: () => [...bag.values()].filter((i) => i.count > 0).sort((a, b) => a.slot - b.slot) },
        findBlocks: ({ matching, maxDistance }) => {
            const block = bot.blockAt(TABLE);
            return block && matching(block) && TABLE.distanceTo(bot.entity.position) <= maxDistance ? [TABLE] : [];
        },
        blockAt: (p) => (table && p.equals(TABLE) ? { name: 'enchanting_table', position: TABLE } : { name: 'air', position: p }),
        putAway: async (slot) => {
            calls.push(['putAway', slot]);
            const item = bot.currentWindow?.slots[slot];
            if (!item) throw new Error(`nothing in window slot ${slot}`);
            bot.currentWindow.slots[slot] = null;
            backToBag(item);
            if (slot === 0) bot.currentWindow.enchantments = ZERO();
        },
        closeWindow: (win) => {
            calls.push(['close']);
            for (const s of [0, 1]) {
                if (win.slots[s]) {
                    backToBag(win.slots[s]);
                    win.slots[s] = null;
                }
            }
            bot.currentWindow = null;
        },
    };
    function backToBag(item) {
        const same = [...bag.values()].find((i) => i.name === item.name && i.count > 0 && item.name === 'lapis_lazuli');
        if (same) {
            same.count += item.count;
            return;
        }
        let slot = 36;
        while (bag.has(slot) && bag.get(slot).count > 0) slot++;
        item.slot = slot;
        bag.set(slot, item);
    }
    let puts = 0;
    bot.openEnchantmentTable = async (block) => {
        calls.push(['open', block.name]);
        assert.equal(block.name, 'enchanting_table');
        const win = {
            id: 1, type: 'minecraft:enchantment', inventoryStart: 2, slots: [null, null],
            enchantments: ZERO(), // the costs 0 of the open (mineflayer's 'ready' has fired already)
            items: () => [...bag.values()].filter((i) => i.count > 0).map((i) => ({ ...i, slot: i.slot - 7, bagSlot: i.slot })),
            // as bot.moveSlotItem(item.slot, 0): whatever the WINDOW has at that slot
            async putTargetItem(item) {
                calls.push(['putTarget', item.name, item.slot]);
                const inBag = bag.get(item.slot + 7);
                if (!inBag || inBag.count <= 0) return;
                bag.delete(item.slot + 7);
                win.slots[0] = inBag;
                puts++;
                const first = puts === 1;
                setImmediate(() => {
                    if (win.slots[0] !== inBag) return;
                    if (loseFirst && first) return; // the probe's one window that never got its offers
                    win.enchantments = noOffer(inBag) ? ZERO() : offers.map((o) => ({ level: o.level, expected: { ...o.expected } }));
                });
            },
            // as bot.moveSlotItem(item.slot, 1): a stack put on lapis in the slot joins it (the game's left click), up to 64;
            // `lapisMoves`: the clicks the server takes (one that does not move anything after them)
            async putLapis(item) {
                calls.push(['putLapis', item.name, item.slot]);
                const inBag = bag.get(item.slot + 7);
                if (!inBag || lapisMoves <= 0) return;
                lapisMoves--;
                const there = win.slots[1];
                if (there && there.name === inBag.name) {
                    const moved = Math.min(inBag.count, 64 - there.count);
                    there.count += moved;
                    inBag.count -= moved;
                    if (inBag.count === 0) bag.delete(item.slot + 7);
                    return;
                }
                bag.delete(item.slot + 7);
                win.slots[1] = inBag;
            },
            async takeTargetItem() {
                calls.push(['takeTarget']);
                const item = win.slots[0];
                assert.ok(item);
                await bot.putAway(0);
                return item;
            },
            async enchant(choice) {
                calls.push(['enchant', choice]);
                assert.notEqual(win.enchantments[choice].level, -1);
                if (enchantHangs) return new Promise(() => {});
                const need = choice + 1;
                if (bot.experience.level < win.enchantments[choice].level || (win.slots[1]?.count ?? 0) < need) return new Promise(() => {});
                bot.experience.level -= need;
                win.slots[1].count -= need;
                if (win.slots[1].count === 0) win.slots[1] = null;
                win.slots[0].enchantments = results[choice].map((e) => ({ ...e }));
                win.enchantments = ZERO();
                await tick();
                return win.slots[0];
            },
        };
        bot.currentWindow = win;
        return win;
    };
    return bot;
}

const countIn = (bot, name) => [...bot.bag.values()].filter((i) => i.name === name).reduce((s, i) => s + i.count, 0);
const pickaxes = (bot) => [...bot.bag.values()].filter((i) => i.name === 'diamond_pickaxe' && i.count > 0);

// The context: the log and the said lines; `onSay` answers (the owner in the chat).
function makeCtx(extra = {}) {
    const ctx = { logs: [], said: [], log: (t) => ctx.logs.push(t), say: (t) => { ctx.said.push(t); ctx.onSay?.(t); }, ...extra };
    return ctx;
}

// A clock that moves by the waits; every wait yields a turn of the event loop (so a fake offer or an answer can come).
function fakeClock() {
    let t = 1000;
    return { now: () => t, wait: (ms) => new Promise((resolve) => setImmediate(() => { t += ms; resolve(); })) };
}

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => cap.restore());

describe('!enchant with the choice "": the offers line, the wait, !enchantTake', () => {
    test('take 1: the line is said, the window waits, offer 1 is enchanted and the item and the rest of the lapis come back', async () => {
        const bot = makeBot();
        const ctx = makeCtx();
        const answers = [];
        ctx.onSay = (t) => { if (t === OFFERS_LINE) setImmediate(() => answers.push(enchantTake(bot, ctx, 1))); };
        const r = await enchant(bot, ctx, 'diamond_pickaxe', '', fakeClock());
        assert.deepEqual(ctx.said, [OFFERS_LINE]);
        assert.deepEqual(answers, [{ ok: true, reason: null, text: 'I take offer 1.' }]);
        assert.equal(r.text, 'I enchanted your diamond_pickaxe: Efficiency I, Unbreaking I (8 levels, 1 lapis).');
        assert.equal(r.ok, true);
        assert.deepEqual(r.enchantments, ['Efficiency I', 'Unbreaking I']);
        assert.equal(bot.experience.level, 29, 'offer 1 spends 1 level');
        assert.equal(countIn(bot, 'lapis_lazuli'), 15, 'one lapis spent, the rest back in the bag');
        assert.equal(pickaxes(bot).length, 1);
        assert.deepEqual(pickaxes(bot)[0].enchantments, PROBE_RESULTS[0]);
        assert.ok(bot.calls.some((c) => c[0] === 'close'), 'the window is closed');
        assert.equal(bot.currentWindow, null);
        assert.equal(questionWaits(bot), false);
    });

    test('the items are put by their slot in the open window (probe fact 1), the pickaxe first, then the lapis', async () => {
        const bot = makeBot({ items: [['lapis_lazuli', 16], ['diamond_pickaxe', 1]] }); // the probe's bag: lapis in 36, the pickaxe in 37
        const ctx = makeCtx();
        ctx.onSay = () => setImmediate(() => enchantTake(bot, ctx, 2));
        const r = await enchant(bot, ctx, 'diamond_pickaxe', '', fakeClock());
        const puts = bot.calls.filter((c) => c[0] === 'putTarget' || c[0] === 'putLapis');
        assert.deepEqual(puts.slice(0, 2), [['putTarget', 'diamond_pickaxe', 30], ['putLapis', 'lapis_lazuli', 29]], 'bag slots 37 and 36 are window slots 30 and 29');
        assert.equal(r.text, 'I enchanted your diamond_pickaxe: Unbreaking II (13 levels, 2 lapis).');
        assert.equal(bot.experience.level, 28);
        assert.equal(countIn(bot, 'lapis_lazuli'), 14);
    });

    test('take 0: the item and the lapis come back, nothing is spent', async () => {
        const bot = makeBot();
        const ctx = makeCtx();
        const answers = [];
        ctx.onSay = () => setImmediate(() => answers.push(enchantTake(bot, ctx, 0)));
        const r = await enchant(bot, ctx, 'diamond_pickaxe', '', fakeClock());
        assert.deepEqual(answers.map((a) => a.text), ['I take the item back.']);
        assert.equal(r.text, TOOK_BACK);
        assert.equal(r.reason, 'none');
        assert.equal(bot.experience.level, 30);
        assert.equal(countIn(bot, 'lapis_lazuli'), 16);
        assert.equal(pickaxes(bot).length, 1);
        assert.equal(pickaxes(bot)[0].enchantments, null);
        assert.ok(!bot.calls.some((c) => c[0] === 'enchant'));
        assert.ok(ctx.logs.some((l) => l === `Enchanting none at (1, 64, 0), step question: ${TOOK_BACK}`), ctx.logs.join('\n'));
    });

    test('no answer within 60 s: the item comes back', async () => {
        const bot = makeBot();
        const ctx = makeCtx();
        const clock = fakeClock();
        const t0 = clock.now();
        const r = await enchant(bot, ctx, 'diamond_pickaxe', '', clock);
        assert.equal(r.text, TOOK_BACK);
        assert.equal(r.reason, 'no_answer');
        assert.ok(clock.now() - t0 >= 60000 && clock.now() - t0 < 70000, `${clock.now() - t0} ms`);
        assert.equal(pickaxes(bot).length, 1);
        assert.equal(countIn(bot, 'lapis_lazuli'), 16);
        assert.equal(bot.currentWindow, null);
    });

    test('a level too low for the chosen offer: the level line, nothing spent, the item back', async () => {
        const bot = makeBot({ level: 12 });
        const ctx = makeCtx();
        ctx.onSay = () => setImmediate(() => enchantTake(bot, ctx, 3));
        const r = await enchant(bot, ctx, 'diamond_pickaxe', '', fakeClock());
        assert.equal(r.text, 'Level 12, offer 3 needs 30.');
        assert.equal(r.reason, 'low_level');
        assert.equal(bot.experience.level, 12);
        assert.equal(countIn(bot, 'lapis_lazuli'), 16);
        assert.equal(pickaxes(bot)[0].enchantments, null);
        assert.ok(!bot.calls.some((c) => c[0] === 'enchant'));
    });

    test('!enchantTake without a question; an answer that is no offer: the question still waits', async () => {
        const bot = makeBot();
        const ctx = makeCtx();
        assert.deepEqual(enchantTake(bot, ctx, 1), { ok: false, reason: 'no_question', text: TEXTS.noQuestion });
        const answers = [];
        ctx.onSay = () => setImmediate(() => {
            answers.push(enchantTake(bot, ctx, 7));
            answers.push(enchantTake(bot, ctx, 2));
            answers.push(enchantTake(bot, ctx, 3));
        });
        const r = await enchant(bot, ctx, 'diamond_pickaxe', '', fakeClock());
        assert.deepEqual(answers.map((a) => a.text), [TEXTS.badTake, 'I take offer 2.', TEXTS.noQuestion]);
        assert.equal(r.text, 'I enchanted your diamond_pickaxe: Unbreaking II (13 levels, 2 lapis).');
    });

    test('"stop" while the question waits: the item comes back, the reason is interrupted', async () => {
        const bot = makeBot();
        const ctx = makeCtx();
        ctx.onSay = () => setImmediate(() => { bot.interrupt_code = true; });
        const r = await enchant(bot, ctx, 'diamond_pickaxe', '', fakeClock());
        assert.equal(r.reason, 'interrupted');
        assert.equal(r.text, TOOK_BACK);
        assert.equal(pickaxes(bot).length, 1);
        assert.equal(countIn(bot, 'lapis_lazuli'), 16);
        assert.equal(questionWaits(bot), false);
    });
});

describe('!enchant with the choice in the order (the code\'s choice): no question', () => {
    test('a number takes that offer', async () => {
        const bot = makeBot();
        const ctx = makeCtx();
        const r = await enchant(bot, ctx, 'diamond_pickaxe', '3', fakeClock());
        assert.deepEqual(ctx.said, []);
        assert.equal(r.text, 'I enchanted your diamond_pickaxe: Efficiency IV, Unbreaking I (30 levels, 3 lapis).');
        assert.equal(bot.experience.level, 27);
        assert.equal(countIn(bot, 'lapis_lazuli'), 13);
    });

    test('a name takes the offer of that name: "unbreaking" is Unbreaking II, the higher of the two', async () => {
        const bot = makeBot();
        const ctx = makeCtx();
        const r = await enchant(bot, ctx, 'diamond_pickaxe', 'unbreaking', fakeClock());
        assert.deepEqual(ctx.said, []);
        assert.equal(r.text, 'I enchanted your diamond_pickaxe: Unbreaking II (13 levels, 2 lapis).');
        assert.equal(r.offer.index, 1);
    });

    test('"efficiency" matches Efficiency IV', async () => {
        const bot = makeBot();
        const r = await enchant(bot, makeCtx(), 'pickaxe', 'Efficiency', fakeClock());
        assert.equal(r.offer.index, 2);
        assert.equal(r.ok, true);
    });

    test('a name the table does not offer: the offers line with "; none of them is mending.", the item back, nothing said', async () => {
        const bot = makeBot();
        const ctx = makeCtx();
        const r = await enchant(bot, ctx, 'diamond_pickaxe', 'mending', fakeClock());
        assert.equal(r.text, 'The table offers for your diamond_pickaxe: 1) Unbreaking I (8 levels, 1 lapis), 2) Unbreaking II (13 levels, 2 lapis), 3) Efficiency IV (30 levels, 3 lapis); none of them is mending.');
        assert.equal(r.reason, 'not_offered');
        assert.deepEqual(ctx.said, []);
        assert.equal(pickaxes(bot)[0].enchantments, null);
        assert.equal(countIn(bot, 'lapis_lazuli'), 16);
        assert.equal(bot.experience.level, 30);
    });

    test('lapis in two stacks: the larger one goes on the table, so offer 3 has its 3 lapis', async () => {
        const bot = makeBot({ items: [['lapis_lazuli', 1], ['lapis_lazuli', 15], ['diamond_pickaxe', 1]] });
        const r = await enchant(bot, makeCtx(), 'diamond_pickaxe', '3', fakeClock());
        assert.deepEqual(bot.calls.find((c) => c[0] === 'putLapis'), ['putLapis', 'lapis_lazuli', 30], 'the stack of 15 in bag slot 37');
        assert.equal(r.ok, true, r.text);
        assert.equal(countIn(bot, 'lapis_lazuli'), 13);
    });

    // v0.1.4.16 fix round (review 12, DECISIONS V-12): the lapis slot holds the offer's lapis before window.enchant
    test('3 lapis split as 1 + 2 and offer 3: both stacks go into the lapis slot, the enchant is made', async () => {
        const bot = makeBot({ items: [['lapis_lazuli', 1], ['lapis_lazuli', 2], ['diamond_pickaxe', 1]] });
        const r = await enchant(bot, makeCtx(), 'diamond_pickaxe', '3', fakeClock());
        assert.deepEqual(bot.calls.filter((c) => c[0] === 'putLapis'), [['putLapis', 'lapis_lazuli', 30], ['putLapis', 'lapis_lazuli', 29]],
            'the stack of 2 (bag slot 37) first, then the stack of 1 (bag slot 36)');
        const putAt = bot.calls.findLastIndex((c) => c[0] === 'putLapis');
        assert.ok(putAt < bot.calls.findIndex((c) => c[0] === 'enchant'), 'both stacks are in before the enchant');
        assert.deepEqual(bot.calls.filter((c) => c[0] === 'enchant'), [['enchant', 2]]);
        assert.equal(r.ok, true, r.text);
        assert.equal(r.text, 'I enchanted your diamond_pickaxe: Efficiency IV, Unbreaking I (30 levels, 3 lapis).');
        assert.equal(countIn(bot, 'lapis_lazuli'), 0, 'the 3 lapis spent');
        assert.equal(bot.experience.level, 27);
    });

    test('a lapis slot that stays short of the offer: no enchant, the lapis line, the item and the lapis back', async () => {
        const bot = makeBot({ items: [['lapis_lazuli', 1], ['lapis_lazuli', 2], ['diamond_pickaxe', 1]], lapisMoves: 1 });
        const ctx = makeCtx();
        const r = await enchant(bot, ctx, 'diamond_pickaxe', '3', fakeClock());
        assert.ok(!bot.calls.some((c) => c[0] === 'enchant'), 'window.enchant is never called with too little lapis');
        assert.deepEqual([r.ok, r.reason, r.text], [false, 'no_lapis', 'Only 2 lapis are on the table; offer 3 needs 3.']);
        assert.ok(ctx.logs.includes(`Enchanting no_lapis at (1, 64, 0), step lapis: ${r.text}`), ctx.logs.join('\n'));
        assert.equal(pickaxes(bot).length, 1);
        assert.equal(pickaxes(bot)[0].enchantments, null);
        assert.equal(countIn(bot, 'lapis_lazuli'), 3, 'nothing spent');
        assert.equal(bot.experience.level, 30);
        assert.equal(bot.currentWindow, null);
    });

    test('a number that is no offer number: refused before anything moves', async () => {
        const bot = makeBot();
        const ctx = makeCtx();
        const r = await enchant(bot, ctx, 'diamond_pickaxe', '5', fakeClock());
        assert.equal(r.text, 'I take offer 1, 2 or 3, or an enchantment by its name, not "5".');
        assert.ok(!bot.calls.some((c) => c[0] === 'open'));
    });

    test('the enchanted item whose answer never comes: the failure line, the item back', async () => {
        const bot = makeBot({ enchantHangs: true });
        const r = await enchant(bot, makeCtx(), 'diamond_pickaxe', '1', fakeClock());
        assert.equal(r.text, 'I could not enchant the diamond_pickaxe: the table did not answer.');
        assert.equal(r.reason, 'error');
        assert.equal(pickaxes(bot).length, 1);
        assert.equal(bot.currentWindow, null);
    });
});

describe('the refusals and the window\'s states', () => {
    test('no table within 32 blocks', async () => {
        const bot = makeBot({ table: false });
        const ctx = makeCtx();
        const r = await enchant(bot, ctx, 'diamond_pickaxe', '', fakeClock());
        assert.deepEqual(r, { ok: false, reason: 'no_table', text: 'No enchanting table within 32 blocks.' });
        assert.deepEqual(ctx.logs, ['Enchanting no_table at (1, 64, 0), step table: No enchanting table within 32 blocks.']);
    });

    test('no such item in the bag', async () => {
        const bot = makeBot({ items: [['lapis_lazuli', 16], ['iron_axe', 1]] });
        const r = await enchant(bot, makeCtx(), 'diamond_pickaxe', '', fakeClock());
        assert.equal(r.text, 'I have no diamond_pickaxe.');
        assert.equal((await enchant(bot, makeCtx(), 'pickaxe', '', fakeClock())).text, 'I have no pickaxe.');
    });

    test('an item enchanted already: no offer (cost 0, id -1) after one re-put: the line, the item back', async () => {
        const bot = makeBot({ items: [['diamond_pickaxe', 1, [{ id: 8, level: 1 }]], ['lapis_lazuli', 16]], noOffer: (item) => item.enchantments !== null });
        const ctx = makeCtx();
        const r = await enchant(bot, ctx, 'diamond_pickaxe', '', fakeClock());
        assert.equal(r.text, 'The table offers nothing for this diamond_pickaxe.');
        assert.equal(r.reason, 'no_offer');
        assert.equal(bot.calls.filter((c) => c[0] === 'putTarget').length, 2, 'the item was put twice (probe fact 4)');
        assert.equal(pickaxes(bot).length, 1);
        assert.equal(countIn(bot, 'lapis_lazuli'), 16);
        assert.deepEqual(ctx.said, []);
    });

    test('a first put whose offers never come: the re-put brings them (probe fact 4)', async () => {
        const bot = makeBot({ loseFirst: true });
        const ctx = makeCtx();
        ctx.onSay = () => setImmediate(() => enchantTake(bot, ctx, 1));
        const r = await enchant(bot, ctx, 'diamond_pickaxe', '', fakeClock());
        assert.deepEqual(ctx.said, [OFFERS_LINE]);
        assert.equal(r.ok, true);
    });

    test('the kind "pickaxe": the unenchanted diamond pickaxe, not the enchanted netherite one', async () => {
        const bot = makeBot({ items: [['netherite_pickaxe', 1, [{ id: 8, level: 5 }]], ['iron_pickaxe', 1], ['diamond_pickaxe', 1], ['lapis_lazuli', 16]] });
        const r = await enchant(bot, makeCtx(), 'my pickaxe', '1', fakeClock());
        assert.equal(r.ok, true);
        assert.match(r.text, /^I enchanted your diamond_pickaxe: /);
    });

    test('the table out of reach: the walk fails, the line says where the table is', async () => {
        const bot = makeBot();
        bot.entity.position = new Vec3(20.5, 64, 0.5); // 17 blocks off, no pathfinder in the fake
        const r = await enchant(bot, makeCtx(), 'diamond_pickaxe', '1', { ...fakeClock(), rules: { walkMs: 1000 } });
        assert.equal(r.reason, 'unreachable');
        assert.equal(r.text, 'I cannot reach the enchanting table at (3, 64, 0).');
        assert.ok(!bot.calls.some((c) => c[0] === 'open'));
    });
});

describe('the lapis (8.1)', () => {
    const CHEST = { x: 6, y: 64, z: 4, items: { lapis_lazuli: 32 } };
    // a chest index with one chest; fetchItem moves the lapis into the bag
    function stock(bot, chest = CHEST) {
        const fetched = [];
        return {
            fetched,
            chests: { find: (item) => ((chest.items[item] ?? 0) > 0 ? [{ ...chest, items: { ...chest.items } }] : []) },
            storage: {
                fetchItem: async (item, n) => {
                    fetched.push([item, n]);
                    chest.items[item] -= n;
                    bot.bag.set(44, makeItem(item, n, 44));
                    return { ok: true, reason: null, taken: n, chests: [{ x: chest.x, y: chest.y, z: chest.z }], text: '' };
                },
            },
        };
    }
    function permits(initial = {}) {
        const items = new Map(Object.entries(initial));
        return {
            entry: (item) => (items.has(item) ? { ...items.get(item) } : null),
            may: (item) => items.get(item)?.allowed === true,
            allowedAt: (item) => (items.get(item)?.allowed ? items.get(item).at : 0),
            set: (item, allowed, at) => items.set(item, { allowed, at }),
        };
    }

    test('3 in the bag: nothing is taken', async () => {
        const bot = makeBot({ items: [['diamond_pickaxe', 1], ['lapis_lazuli', 3]] });
        const s = stock(bot);
        const r = await enchant(bot, makeCtx({ ...s, permits: permits() }), 'diamond_pickaxe', '1', fakeClock());
        assert.equal(r.ok, true);
        assert.deepEqual(s.fetched, []);
    });

    test('ctx.stock.takeOrAsk of the breeding pack when it is there: lapis_lazuli, 3, low 6, the enchanting', async () => {
        const bot = makeBot({ items: [['diamond_pickaxe', 1]] });
        const asked = [];
        const ctx = makeCtx({ stock: { takeOrAsk: async (b, c, item, n, opts) => {
            asked.push([b === bot, c === ctx, item, n, opts.low, opts.purpose]);
            bot.bag.set(44, makeItem(item, n, 44));
            return { ok: true, reason: null, taken: n, text: 'I took 3 lapis_lazuli from the chest at (6, 64, 4).', asked: false };
        } } });
        const r = await enchant(bot, ctx, 'diamond_pickaxe', '1', fakeClock());
        assert.deepEqual(asked, [[true, true, 'lapis_lazuli', 3, 6, 'the enchanting']]);
        assert.equal(r.ok, true);
    });

    test('ctx.stock.takeOrAsk refuses: its line ends the order, no window', async () => {
        const bot = makeBot({ items: [['diamond_pickaxe', 1]] });
        const text = 'I take no lapis_lazuli without your word; say "you may take lapis_lazuli" when you want.';
        const ctx = makeCtx({ stock: { takeOrAsk: async () => ({ ok: false, reason: 'no_permit', taken: 0, text, asked: true }) } });
        const r = await enchant(bot, ctx, 'diamond_pickaxe', '', fakeClock());
        assert.deepEqual([r.ok, r.reason, r.text], [false, 'no_permit', text]);
        assert.ok(!bot.calls.some((c) => c[0] === 'open'));
    });

    describe('the pack\'s own copy (no breeding pack)', () => {
        test('allowed: takes 3 and says the took-line, no question', async () => {
            const bot = makeBot({ items: [['diamond_pickaxe', 1]] });
            const s = stock(bot);
            const ctx = makeCtx({ ...s, permits: permits({ lapis_lazuli: { allowed: true, at: 5 } }) });
            const r = await enchant(bot, ctx, 'diamond_pickaxe', '1', fakeClock());
            assert.deepEqual(s.fetched, [['lapis_lazuli', 3]]);
            assert.deepEqual(ctx.said, ['I took 3 lapis_lazuli from the chest at (6, 64, 4).']);
            assert.equal(r.text, 'I enchanted your diamond_pickaxe: Efficiency I, Unbreaking I (8 levels, 1 lapis).');
            assert.equal(countIn(bot, 'lapis_lazuli'), 2, '2 of the 3 taken are left (W135 3c)');
        });

        test('not allowed yet: the question; a permit set during the wait takes', async () => {
            const bot = makeBot({ items: [['diamond_pickaxe', 1]] });
            const s = stock(bot);
            const p = permits();
            const clock = fakeClock();
            const ctx = makeCtx({ ...s, permits: p });
            ctx.onSay = (t) => { if (t.startsWith('May I take')) setImmediate(() => p.set('lapis_lazuli', true, clock.now() + 1)); };
            const r = await enchant(bot, ctx, 'diamond_pickaxe', '1', clock);
            assert.deepEqual(ctx.said, [
                'May I take 3 lapis_lazuli from the chest at (6, 64, 4) for the enchanting? Say yes or no.',
                'I took 3 lapis_lazuli from the chest at (6, 64, 4).',
            ]);
            assert.equal(r.ok, true);
        });

        test('silence: no lapis taken, the no-permit line, no window', async () => {
            const bot = makeBot({ items: [['diamond_pickaxe', 1]] });
            const s = stock(bot);
            const clock = fakeClock();
            const t0 = clock.now();
            const ctx = makeCtx({ ...s, permits: permits() });
            const r = await enchant(bot, ctx, 'diamond_pickaxe', '', clock);
            assert.equal(r.reason, 'no_permit');
            assert.equal(r.text, 'I take no lapis_lazuli without your word; say "you may take lapis_lazuli" when you want.');
            assert.ok(clock.now() - t0 >= 60000);
            assert.deepEqual(s.fetched, []);
            assert.ok(!bot.calls.some((c) => c[0] === 'open'));
        });

        test('the owner says no: ends at once', async () => {
            const bot = makeBot({ items: [['diamond_pickaxe', 1]] });
            const s = stock(bot);
            const p = permits();
            const clock = fakeClock();
            const t0 = clock.now();
            const ctx = makeCtx({ ...s, permits: p });
            ctx.onSay = () => setImmediate(() => p.set('lapis_lazuli', false, clock.now() + 1));
            const r = await enchant(bot, ctx, 'diamond_pickaxe', '', clock);
            assert.equal(r.reason, 'no_permit');
            assert.ok(clock.now() - t0 < 10000, `${clock.now() - t0} ms`);
        });

        test('the stock is low (7 left, 3 to take): asks though allowed, with the low line', async () => {
            const bot = makeBot({ items: [['diamond_pickaxe', 1]] });
            const s = stock(bot, { x: 6, y: 64, z: 4, items: { lapis_lazuli: 7 } });
            const ctx = makeCtx({ ...s, permits: permits({ lapis_lazuli: { allowed: true, at: 5 } }) });
            const r = await enchant(bot, ctx, 'diamond_pickaxe', '', fakeClock());
            assert.equal(ctx.said[0], 'Only 7 lapis_lazuli are left in the chests; may I take 3 for the enchanting? Say yes or no.');
            assert.equal(r.reason, 'no_permit');
        });

        test('no chest with lapis: the no-stock line', async () => {
            const bot = makeBot({ items: [['diamond_pickaxe', 1]] });
            const r = await enchant(bot, makeCtx({ permits: permits() }), 'diamond_pickaxe', '', fakeClock());
            assert.equal(r.text, 'I have no lapis_lazuli and the chests have none.');
        });
    });
});

// ---- the glue: actions.js (the commands), agent.js (the loading and the blocked commands)

async function importQuietly() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const c = captureConsole();
    process.chdir(emptyDir);
    try {
        return {
            settingsModule: await loadSrc('src/agent/settings.js'),
            index: await loadSrc('src/agent/commands/index.js'),
            actions: await loadSrc('src/agent/commands/actions.js'),
            agent: await loadSrc('src/agent/agent.js'),
        };
    } finally {
        process.chdir(originalCwd);
        c.restore();
        removeTmpDir(emptyDir);
    }
}
const M = await importQuietly();
const T = await loadSrc('tests/routing/commands.js');
const PACK = await loadSrc('src/agent/packs/enchanting/index.js');
const command = (name) => M.actions.actionsList.find((c) => c.name === name);

function fakeAgent(pack, { interrupted = false } = {}) {
    const agent = {
        name: 'andy', bot: { username: 'andy' }, work_packs: { enchanting: pack }, runs: [], running_commands: [],
        packContext: () => ({ marker: 'ctx' }),
        actions: {
            async runAction(label, fn, options) {
                agent.runs.push({ label, options });
                await fn();
                return { success: true, message: 'Action output:\nlog', interrupted, timedout: false };
            },
        },
    };
    return agent;
}

describe('the glue: the two commands in actions.js', () => {
    test('names, docs, parameters as the spec has them', () => {
        for (const entry of T.SPEC_COMMANDS.filter((c) => c.part === 'enchanting')) {
            const cmd = command(entry.name);
            assert.ok(cmd, entry.name);
            assert.equal(cmd.description, entry.description);
            assert.deepEqual(Object.keys(cmd.params), entry.params.map((p) => p.name));
            for (const p of entry.params) {
                assert.equal(cmd.params[p.name].type, p.type);
                assert.equal(cmd.params[p.name].default, p.default);
            }
        }
        assert.equal(command('!enchant').description,
            'Enchant an item at the enchanting table with the bot\'s lapis: choice "" asks you which offer, else a number 1 to 3 or an enchantment name takes that offer.');
        assert.equal(command('!enchantTake').description, 'Answer the bot\'s enchanting question: 1, 2 or 3 take that offer, 0 takes the item back.');
        assert.deepEqual(T.PART_COMMANDS.enchanting, ['!enchant', '!enchantTake']);
    });

    test('the switch off: the pack-off text, nothing runs', async () => {
        M.settingsModule.setSettings({ enchanting: false });
        const calls = [];
        const pack = { enchant: async () => calls.push('enchant'), enchantTake: () => calls.push('take') };
        assert.equal(await command('!enchant').perform(fakeAgent(pack), 'pickaxe', ''), 'The enchanting pack is off.');
        assert.equal(await command('!enchantTake').perform(fakeAgent(pack), 1), 'The enchanting pack is off.');
        assert.deepEqual(calls, []);
    });

    test('!enchant runs as the pack action action:enchant with (bot, ctx, item, choice), the text word for word', async () => {
        M.settingsModule.setSettings({ enchanting: true });
        const calls = [];
        const pack = { enchant: async (...args) => { calls.push(args); return { ok: true, reason: null, text: 'enchant text' }; } };
        const agent = fakeAgent(pack);
        assert.equal(await command('!enchant').perform(agent, 'diamond_pickaxe', 'unbreaking'), 'enchant text');
        assert.deepEqual(agent.runs.map((r) => r.label), ['action:enchant']);
        assert.equal(calls[0][0], agent.bot);
        assert.equal(calls[0][1].marker, 'ctx');
        assert.deepEqual(calls[0].slice(2), ['diamond_pickaxe', 'unbreaking']);
    });

    test('!enchantTake is plain: no action (the running !enchant goes on), the answer of the pack', async () => {
        M.settingsModule.setSettings({ enchanting: true });
        const calls = [];
        const pack = { enchantTake: (...args) => { calls.push(args); return { ok: true, reason: null, text: 'I take offer 2.' }; } };
        const agent = fakeAgent(pack);
        assert.equal(await command('!enchantTake').perform(agent, 2), 'I take offer 2.');
        assert.deepEqual(agent.runs, [], 'no runAction: it stops no running action');
        assert.equal(calls[0][0], agent.bot);
        assert.equal(calls[0][2], 2);
    });

    test('the real pack: !enchantTake while no question waits', async () => {
        M.settingsModule.setSettings({ enchanting: true });
        assert.equal(await command('!enchantTake').perform(fakeAgent(PACK), 1), 'There is no enchanting question to answer.');
    });

    test('the pack not loaded: the could-not-load text', async () => {
        M.settingsModule.setSettings({ enchanting: true });
        assert.equal(await command('!enchant').perform(fakeAgent(undefined), 'pickaxe', ''), 'The enchanting pack could not be loaded.');
    });

    test('the parser: n is 0 to 3', () => {
        assert.match(String(M.index.parseCommandMessage?.('!enchantTake(4)') ?? ''), /must be an element of \[0, 3\]/);
    });
});

describe('the glue: agent.js', () => {
    const fake = () => Object.assign(Object.create(M.agent.Agent.prototype), { name: 'andy', bot: { username: 'andy' } });
    test('_loadWorkPacks: the enchanting pack with its switch only', async () => {
        M.settingsModule.setSettings({ world_memory: true, enchanting: false });
        assert.equal((await fake()._loadWorkPacks()).enchanting, undefined);
        M.settingsModule.setSettings({ world_memory: true, enchanting: true });
        const packs = await fake()._loadWorkPacks();
        assert.equal(packs.enchanting.enchant, PACK.enchant, 'the real pack');
        assert.ok(packs.storage, 'the storage pack for the lapis of the chests');
    });
    test('_loadWorkPacks: a pack that fails to load: one warning, its commands stay hidden', async () => {
        M.settingsModule.setSettings({ world_memory: true, enchanting: true });
        const packs = await fake()._loadWorkPacks({ enchanting: () => Promise.reject(new Error('broken')) });
        assert.equal(packs.enchanting, undefined);
        assert.ok(cap.of('warn').some((r) => /^Could not load the enchanting pack, its commands stay hidden:/.test(r.text)));
    });
    test('the two commands are blocked while the switch is off or the pack failed', () => {
        const src = fs.readFileSync(repoPath('src/agent/agent.js'), 'utf8');
        assert.ok(src.includes("if (!settings.enchanting || !this.work_packs?.enchanting)\n            this.blocked_actions.push('!enchant', '!enchantTake');"));
    });
});
