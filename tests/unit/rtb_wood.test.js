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
        assert.deepEqual([r.ok, r.text], [true, 'I crafted 8 torch.']);
        assert.deepEqual(crafts(s.bot), ['oak_planks', 'stick', 'torch']);
        const big = await K.craftSupplies(s.bot, s.ctx, 'torch', 24, s.opts);
        assert.deepEqual([big.ok, big.text], [true, 'I crafted 24 torch.']);
        assert.equal(count(s.bot, 'torch'), 32);
    });

    test('the inventory of the owner (coal 9, stick 1, oak_log 2, birch_planks 2): 32 torches, then 8 sticks', async () => {
        const s = scene();
        give(s.bot, 'coal', 9);
        give(s.bot, 'stick', 1);
        give(s.bot, 'oak_log', 2);
        give(s.bot, 'birch_planks', 2);
        const r = await K.craftSupplies(s.bot, s.ctx, 'torch', 32, s.opts);
        assert.deepEqual([r.ok, r.text], [true, 'I crafted 32 torch.']);
        const st = await K.craftSupplies(s.bot, s.ctx, 'stick', 8, s.opts);
        assert.deepEqual([st.ok, st.text], [true, 'I crafted 8 stick.']);
    });

    test('birch planks and one oak log mixed: the oak log is made planks, the sticks take both kinds', async () => {
        const s = scene();
        give(s.bot, 'birch_planks', 5);
        give(s.bot, 'oak_log', 1);
        const plan = L.supplySteps('stick', 16, [{ name: 'birch_planks', count: 5 }, { name: 'oak_log', count: 1 }]);
        assert.deepEqual(plan.missing, [], 'before: 1 birch_log missing');
        assert.deepEqual(plan.steps.filter(x => x.action === 'craft').map(x => [x.item, x.times]), [['oak_planks', 1], ['stick', 4]]);
        const r = await K.craftSupplies(s.bot, s.ctx, 'stick', 16, s.opts);
        assert.deepEqual([r.ok, r.text], [true, 'I crafted 16 stick.']);
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
        assert.deepEqual([r.ok, r.text], [true, 'I crafted 32 torch.']);
    });

    test('nothing of any kind: the text names the missing item', async () => {
        const noWood = scene();
        give(noWood.bot, 'coal', 2);
        const r = await K.craftSupplies(noWood.bot, noWood.ctx, 'torch', 8, noWood.opts);
        assert.equal(r.ok, false);
        assert.match(r.text, /^I need 1 oak_log for 8 torch and have none\./);
        const noCoal = scene();
        give(noCoal.bot, 'oak_log', 2);
        const c = await K.craftSupplies(noCoal.bot, noCoal.ctx, 'torch', 8, noCoal.opts);
        assert.equal(c.text, 'I need 2 coal for 8 torch and have none.');
        const gone = scene();
        give(gone.bot, 'stick', 2);
        give(gone.bot, 'coal', 2);
        gone.ctx.skills.craftRecipe = async () => {
            gone.bot.inventory.list = gone.bot.inventory.list.filter(i => i.name !== 'coal');
            return false;
        };
        const g = await K.craftSupplies(gone.bot, gone.ctx, 'torch', 8, gone.opts);
        assert.equal(g.text, 'I could not craft torch: I need 2 coal and have none.', 'the real missing item at the last try');
    });
});
