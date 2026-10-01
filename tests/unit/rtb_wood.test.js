// Fix round of v0.1.4.9 (F24 item 2, engineer E2), from the play of the owner: !craftSupplies("torch", 32)
// answered "I could not craft oak_planks: I need 1 oak_log and have none." with 2 oak_log carried, and
// !craftSupplies("stick", 8) "I could not craft birch_planks: I need 1 birch_log" with birch planks and
// oak logs carried. The wood pack on its fake bot: any log the bot carries is used (oak first), the
// inventory is read again before each try of a step, and a failure names the item that is missing.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { count, fakeCraftRecipe, give, makeClock, makeWoodBot, makeWorld } from './wood_fake_bot.test.js';

const K = await loadSrc('src/agent/packs/wood/tools.js');
const L = await loadSrc('src/agent/packs/wood/tool_logic.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

function scene({ onWait = null } = {}) {
    const bot = makeWoodBot({ world: makeWorld(), pos: [0.5, 64, 0.5] });
    const clock = makeClock(t => onWait?.(t));
    const ctx = { areas: [], log: () => {}, now: clock.now, skills: { craftRecipe: fakeCraftRecipe(bot) } };
    return { bot, clock, ctx, opts: { now: clock.now, wait: clock.wait } };
}
const crafts = bot => bot.calls.filter(c => c[0] === 'craft').map(c => c[1]);

describe('craftSupplies: torches and sticks from the logs the bot carries', () => {
    test('2 oak logs and 9 coal: planks, sticks, 8 torches; 32 torches too', async () => {
        const s = scene();
        give(s.bot, 'oak_log', 2);
        give(s.bot, 'coal', 9);
        const r = await K.craftSupplies(s.bot, s.ctx, 'torch', 8, s.opts);
        assert.deepEqual([r.ok, r.text], [true, 'I made 8 torches.']);
        assert.deepEqual(crafts(s.bot), ['oak_planks', 'stick', 'torch']);
        const big = await K.craftSupplies(s.bot, s.ctx, 'torch', 24, s.opts);
        assert.deepEqual([big.ok, big.text], [true, 'I made 24 torches.']);
        assert.equal(count(s.bot, 'torch'), 32);
    });

    test('the inventory of the owner (coal 9, stick 1, oak_log 2, birch_planks 2): 32 torches, then 8 sticks', async () => {
        const s = scene();
        give(s.bot, 'coal', 9);
        give(s.bot, 'stick', 1);
        give(s.bot, 'oak_log', 2);
        give(s.bot, 'birch_planks', 2);
        const r = await K.craftSupplies(s.bot, s.ctx, 'torch', 32, s.opts);
        assert.deepEqual([r.ok, r.text], [true, 'I made 32 torches.']);
        const st = await K.craftSupplies(s.bot, s.ctx, 'stick', 8, s.opts);
        assert.deepEqual([st.ok, st.text], [true, 'I made 8 sticks.']);
    });

    test('birch planks and one oak log mixed: the oak log is made planks, the sticks take both kinds', async () => {
        const s = scene();
        give(s.bot, 'birch_planks', 5);
        give(s.bot, 'oak_log', 1);
        const plan = L.supplySteps('stick', 16, [{ name: 'birch_planks', count: 5 }, { name: 'oak_log', count: 1 }]);
        assert.deepEqual(plan.missing, [], 'before: 1 birch_log missing');
        assert.deepEqual(plan.steps.filter(x => x.action === 'craft').map(x => [x.item, x.times]), [['oak_planks', 1], ['stick', 4]]);
        const r = await K.craftSupplies(s.bot, s.ctx, 'stick', 16, s.opts);
        assert.deepEqual([r.ok, r.text], [true, 'I made 16 sticks.']);
        assert.equal(count(s.bot, 'oak_log'), 0);
        assert.equal(count(s.bot, 'birch_planks'), 1);
    });

    test('a planks step takes the logs the bot has now, oak first; a kind the player names stays', () => {
        const inv = [{ name: 'birch_log', count: 3 }, { name: 'oak_log', count: 1 }];
        assert.equal(L.logKindFor(inv, 1), 'oak');
        assert.equal(L.logKindFor(inv, 2), 'birch', 'one oak log is too few for 2: the kind with most logs');
        assert.equal(L.logKindFor(inv, 2, 'birch'), 'birch');
        assert.equal(L.logKindFor([], 1), null);
        const named = L.supplySteps('birch_planks', 4, [{ name: 'oak_log', count: 3 }]);
        assert.deepEqual(named.missing, [{ name: 'birch_log', count: 1 }]);
    });

    test('logs that are gone for a moment after a craft (the play of the owner): tried again, it works', async () => {
        let hidden = null;
        const s = scene({ onWait: t => {
            if (hidden && t >= hidden.until) {
                give(s.bot, 'oak_log', hidden.n);
                hidden = null;
            }
        } });
        give(s.bot, 'oak_log', 2);
        give(s.bot, 'coal', 9);
        const real = s.ctx.skills.craftRecipe;
        let first = true;
        s.ctx.skills.craftRecipe = async (b, item, n) => {
            if (first && item === 'oak_planks') {
                first = false;
                const n2 = count(s.bot, 'oak_log');
                s.bot.inventory.list = s.bot.inventory.list.filter(i => i.name !== 'oak_log');
                hidden = { n: n2, until: s.clock.now() + 1000 };
                throw new Error('window closed');
            }
            return real(b, item, n);
        };
        const r = await K.craftSupplies(s.bot, s.ctx, 'torch', 32, s.opts);
        assert.deepEqual([r.ok, r.text], [true, 'I made 32 torches.']);
    });

    test('nothing of any kind: the text names the missing item', async () => {
        const noWood = scene();
        give(noWood.bot, 'coal', 2);
        const r = await K.craftSupplies(noWood.bot, noWood.ctx, 'torch', 8, noWood.opts);
        assert.equal(r.ok, false);
        assert.match(r.text, /^I made 0 torches of 8\. I need 1 oak_log more and know no chest with oak_log\. I found no tree/);
        const noCoal = scene();
        give(noCoal.bot, 'oak_log', 2);
        const c = await K.craftSupplies(noCoal.bot, noCoal.ctx, 'torch', 8, noCoal.opts);
        assert.equal(c.text, 'I made 0 torches of 8. I need 2 coal more and know no chest with coal.');
        const gone = scene();
        give(gone.bot, 'stick', 2);
        give(gone.bot, 'coal', 2);
        gone.ctx.skills.craftRecipe = async () => {
            gone.bot.inventory.list = gone.bot.inventory.list.filter(i => i.name !== 'coal');
            return false;
        };
        const g = await K.craftSupplies(gone.bot, gone.ctx, 'torch', 8, gone.opts);
        assert.equal(g.text, 'I made 0 torches of 8. I need 2 coal more and know no chest with coal.', 'the real missing item after the try');
    });
});

// A known chest as the storage pack would see it: fetchItem takes from `holds`, the chest index lists it.
function withChest(s, holds) {
    const calls = [];
    s.ctx.chests = { list: () => [{ x: 3, y: 64, z: 0, kind: 'chest', items: { ...holds } }] };
    s.ctx.storage = {
        async fetchItem(bot, ctx, name, n) {
            calls.push([name, n]);
            const k = Math.min(holds[name] ?? 0, n);
            if (k > 0) {
                holds[name] -= k;
                give(bot, name, k);
            }
            return { ok: k > 0, taken: k };
        },
    };
    return calls;
}

describe('fix round F32: craftSupplies crafts what it can, fetches the rest, then names what is missing', () => {
    test('6 coal and 6 sticks carried, 19 logs and 1 coal in a known chest: 28 torches, the last coal named', async () => {
        const s = scene();
        give(s.bot, 'coal', 6);
        give(s.bot, 'stick', 6);
        const holds = { oak_log: 19, coal: 1 };
        const calls = withChest(s, holds);
        const r = await K.craftSupplies(s.bot, s.ctx, 'torch', 32, s.opts);
        assert.deepEqual([r.ok, r.reason, r.count, r.text], [false, 'missing', 28, 'I made 28 torches of 32. I need 1 coal more and know no chest with coal.']);
        assert.equal(count(s.bot, 'torch'), 28);
        assert.equal(crafts(s.bot)[0], 'torch', 'what the inventory gives first');
        assert.ok(calls.some(c => c[0] === 'coal') && calls.some(c => c[0] === 'oak_log'), JSON.stringify(calls));
        assert.equal(holds.coal, 0);
    });

    test('everything in the chest: 32 torches', async () => {
        const s = scene();
        withChest(s, { oak_log: 4, coal: 8 });
        const r = await K.craftSupplies(s.bot, s.ctx, 'torch', 32, s.opts);
        assert.deepEqual([r.ok, r.count, r.text], [true, 32, 'I made 32 torches.']);
    });

    test('nothing anywhere: the missing items named, and that no chest has them', async () => {
        const s = scene();
        withChest(s, {});
        const r = await K.craftSupplies(s.bot, s.ctx, 'torch', 32, s.opts);
        assert.equal(r.ok, false);
        assert.equal(r.text, 'I made 0 torches of 32. I need 8 coal and 1 oak_log more and know no chest with coal or oak_log.', 'no coal: no tree is cut');
        const some = scene();
        withChest(some, { coal: 3 });
        some.ctx.storage.fetchItem = async () => ({ ok: false, taken: 0 }); // a chest that the bot cannot reach
        give(some.bot, 'stick', 8);
        const t = await K.craftSupplies(some.bot, some.ctx, 'torch', 8, some.opts);
        assert.equal(t.text, 'I made 0 torches of 8. I need 2 coal more.', 'a known chest holds coal: no clause');
    });

    test('ensureTool gets cobblestone and logs from a known chest (the same fetch)', async () => {
        const s = scene();
        give(s.bot, 'wooden_pickaxe', 1);
        const calls = withChest(s, { cobblestone: 5, oak_log: 3 });
        const r = await K.ensureTool(s.bot, s.ctx, 'pickaxe', 'stone', s.opts);
        assert.deepEqual([r.ok, r.text], [true, 'I crafted a stone_pickaxe.']);
        assert.deepEqual(calls.map(c => c[0]).sort(), ['cobblestone', 'oak_log']);
    });
});

describe('fix round F32 on the real server (W83): no craft while a window is open; the grid is emptied', () => {
    // The fake of mineflayer: the fetch leaves the chest window open (bot.currentWindow); bot.craft then
    // clicks in that window: the ingredients of one craft go into the crafting grid (slots 1 to 4, not in
    // inventory.items()) and it throws "missing ingredient". closeWindow and putAway as mineflayer has them.
    function realWindows(s) {
        s.bot.inventory.slots = [];
        s.bot.closeWindow = () => {
            s.bot.currentWindow = null;
        };
        s.bot.putAway = async slot => {
            const item = s.bot.inventory.slots[slot];
            s.bot.inventory.slots[slot] = null;
            if (item) give(s.bot, item.name, item.count);
        };
        const real = s.ctx.skills.craftRecipe;
        s.ctx.skills.craftRecipe = async (b, item, n) => {
            if (b.currentWindow) {
                for (const [slot, name] of [[1, 'coal'], [2, 'stick']]) {
                    const have = b.inventory.list.find(i => i.name === name && i.count > 0);
                    if (have) {
                        have.count -= 1;
                        b.inventory.slots[slot] = { name, count: 1 };
                    }
                }
                b.inventory.list = b.inventory.list.filter(i => i.count > 0);
                throw new Error('missing ingredient');
            }
            return real(b, item, n);
        };
    }

    test('the chest of W83 (20 logs, 9 coal), nothing carried, the chest window left open by the fetch: 32 torches', async () => {
        const s = scene();
        realWindows(s);
        const holds = { oak_log: 20, coal: 9, bread: 12, leaf_litter: 64 };
        withChest(s, holds);
        const fetch = s.ctx.storage.fetchItem;
        s.ctx.storage.fetchItem = async (...a) => {
            const r = await fetch(...a);
            s.bot.currentWindow = { id: 3, type: 'minecraft:generic_9x3' };
            return r;
        };
        const r = await K.craftSupplies(s.bot, s.ctx, 'torch', 32, s.opts);
        assert.deepEqual([r.ok, r.text], [true, 'I made 32 torches.']);
        assert.equal(s.bot.currentWindow, null);
        assert.deepEqual([holds.coal, holds.oak_log], [1, 19]);
    });

    test('a craft that failed half way: the grid is emptied, and the next round makes what the inventory gives (24 of 6 coal, 6 sticks)', async () => {
        const s = scene();
        realWindows(s);
        give(s.bot, 'coal', 6);
        give(s.bot, 'stick', 6);
        withChest(s, {});
        s.bot.currentWindow = { id: 3 };
        const close = s.bot.closeWindow;
        let closes = 0;
        s.bot.closeWindow = w => {
            if (++closes === 1) return; // the first close is lost: the window stays for one try
            close(w);
        };
        const r = await K.craftSupplies(s.bot, s.ctx, 'torch', 32, s.opts);
        assert.equal(r.count, 24, r.text);
        assert.equal(r.text, 'I made 24 torches of 32. I need 2 coal and 1 oak_log more and know no chest with coal or oak_log.');
        assert.deepEqual(s.bot.inventory.slots.filter(Boolean), [], 'nothing left in the grid');
    });
});
