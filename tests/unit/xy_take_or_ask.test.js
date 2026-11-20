// Spec v0.1.4.16, 8.1 (E6): the asking rule takeOrAsk (src/agent/packs/breeding/stock_logic.js) on a fake bot with a chest of
// the chest index, a fake fetchItem that moves the items into the bag, the real StockPermits in memory on a virtual clock:
// allowed takes; not allowed asks and a permit set during the wait takes; silence refuses; a "no" refuses at once; the low
// mark asks though allowed; the bag first; no chest; the 48 blocks; the nearest chest first; the purpose slot; the stop.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';

const S = await loadSrc('src/agent/packs/breeding/stock_logic.js');
const P = await loadSrc('src/agent/world/stock_permits.js');
const X = await loadSrc('src/agent/packs/breeding/texts.js');

const T0 = 5_000_000;

let cap;
beforeEach(() => {
    cap = captureConsole();
});
afterEach(() => cap.restore());

/**
 * The world of a test: the bot at (0.5, 64, 0.5) with a bag, the chests of the index ({x, y, z, items}), the clock and the
 * permits on it. `onWait(world)` runs at every wait (the owner's answer comes from there).
 */
function makeWorld({ bag = {}, chests = [{ x: 10, y: 64, z: 0, items: { wheat: 32 } }], onWait = null, permits = undefined } = {}) {
    const items = Object.entries(bag).map(([name, count]) => ({ name, count }));
    const w = {
        t: T0,
        waits: 0,
        said: [],
        logs: [],
        fetches: [],
        bot: {
            entity: { position: { x: 0.5, y: 64, z: 0.5 } }, game: { dimension: 'overworld' }, interrupt_code: false,
            inventory: { items: () => items.filter((i) => i.count > 0) },
        },
        chests,
    };
    w.clock = {
        now: () => w.t,
        async wait(ms) {
            w.waits++;
            w.t += Math.max(1, ms);
            if (onWait) onWait(w);
        },
    };
    w.permits = permits === undefined ? new P.StockPermits(null, { now: () => w.t }) : permits;
    const index = {
        find(item) {
            return w.chests.filter((c) => (c.items[item] ?? 0) > 0).map((c) => ({ ...c, items: { ...c.items } }))
                .sort((a, b) => b.items[item] - a.items[item]);
        },
    };
    w.ctx = {
        chests: index,
        permits: w.permits,
        storage: {
            async fetchItem(name, count) {
                w.fetches.push([name, count]);
                let taken = 0;
                const used = [];
                const near = [...w.chests].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
                for (const c of near) {
                    const n = Math.min(c.items[name] ?? 0, count - taken);
                    if (n <= 0) continue;
                    c.items[name] -= n;
                    taken += n;
                    used.push({ x: c.x, y: c.y, z: c.z });
                    if (taken >= count) break;
                }
                const have = items.find((i) => i.name === name);
                if (have) have.count += taken;
                else items.push({ name, count: taken });
                return { ok: taken >= count, reason: taken >= count ? null : 'no_more', taken, chests: used, text: `fetched ${taken}` };
            },
        },
        say: (text) => w.said.push(text),
        log: (text) => w.logs.push(text),
        now: () => w.t,
    };
    w.bagOf = (name) => items.filter((i) => i.name === name).reduce((s, i) => s + i.count, 0);
    return w;
}

const run = (w, item, count, options = {}) => S.takeOrAsk(w.bot, w.ctx, item, count, { now: w.clock.now, wait: w.clock.wait, ...options });

describe('takeOrAsk: allowed, the bag, no chest', () => {
    test('allowed: takes the count from the chest and says the took-line, without a question', async () => {
        const w = makeWorld();
        w.permits.set('wheat', true);
        const r = await run(w, 'wheat', 8, { low: 16 });
        assert.deepEqual({ ok: r.ok, reason: r.reason, taken: r.taken, asked: r.asked }, { ok: true, reason: null, taken: 8, asked: false });
        assert.equal(r.text, 'I took 8 wheat from the chest at (10, 64, 0).');
        assert.deepEqual(w.said, ['I took 8 wheat from the chest at (10, 64, 0).']);
        assert.deepEqual(w.fetches, [['wheat', 8]]);
        assert.equal(w.bagOf('wheat'), 8);
        assert.deepEqual(r.chest, { x: 10, y: 64, z: 0 });
    });

    test('the item in the bag: nothing taken, nothing asked; part of it: only the rest is taken', async () => {
        const w = makeWorld({ bag: { wheat: 8 } });
        const r = await run(w, 'wheat', 8, { low: 16 });
        assert.deepEqual({ ok: r.ok, taken: r.taken, text: r.text, asked: r.asked }, { ok: true, taken: 0, text: '', asked: false });
        assert.deepEqual(w.fetches, []);
        assert.deepEqual(w.said, []);
        const some = makeWorld({ bag: { wheat: 3 } });
        some.permits.set('wheat', true);
        const r2 = await run(some, 'wheat', 8, { low: 16 });
        assert.deepEqual(some.fetches, [['wheat', 5]]);
        assert.equal(r2.text, 'I took 5 wheat from the chest at (10, 64, 0).');
        assert.equal(some.bagOf('wheat'), 8);
    });

    test('no chest with the item: the line of no stock, reason none, one log line; nothing asked', async () => {
        const w = makeWorld({ chests: [{ x: 3, y: 64, z: 0, items: { carrot: 5 } }] });
        const r = await run(w, 'wheat', 8);
        assert.deepEqual({ ok: r.ok, reason: r.reason, text: r.text }, { ok: false, reason: 'none', text: 'I have no wheat and the chests have none.' });
        assert.deepEqual(w.logs, ['I have no wheat and the chests have none.']);
        assert.deepEqual(w.said, []);
    });

    test('a chest farther than 48 blocks does not count; without the storage pack nothing can be taken', async () => {
        const far = makeWorld({ chests: [{ x: 60, y: 64, z: 0, items: { wheat: 64 } }] });
        far.permits.set('wheat', true);
        assert.equal((await run(far, 'wheat', 8)).reason, 'none');
        const noStorage = makeWorld();
        noStorage.permits.set('wheat', true);
        noStorage.ctx.storage = null;
        assert.equal((await run(noStorage, 'wheat', 8)).text, 'I have no wheat and the chests have none.');
    });

    test('the nearest chest of the index is the one the question names', async () => {
        const w = makeWorld({ chests: [{ x: 30, y: 64, z: 0, items: { wheat: 64 } }, { x: 4, y: 65, z: -3, items: { wheat: 20 } }], askMs: 1000 });
        const r = await run(w, 'wheat', 8, { low: 16, askMs: 1000 });
        assert.equal(w.said[0], 'May I take 8 wheat from the chest at (4, 65, -3) for the feeding? Say yes or no.');
        assert.equal(r.reason, 'no_permit');
    });
});

describe('takeOrAsk: the question and the owner\'s word', () => {
    test('not allowed: the question word for word; a permit set during the wait takes', async () => {
        let answered = false;
        const w = makeWorld({
            onWait(world) {
                if (!answered && world.t >= T0 + 5000) {
                    answered = true;
                    world.permits.set('wheat', true); // the owner's "yes", !allowTaking("wheat", true)
                }
            },
        });
        const r = await run(w, 'wheat', 8, { low: 16 });
        assert.equal(w.said[0], 'May I take 8 wheat from the chest at (10, 64, 0) for the feeding? Say yes or no.');
        assert.ok(w.logs.includes(w.said[0]), 'the question is logged');
        assert.deepEqual({ ok: r.ok, taken: r.taken, asked: r.asked }, { ok: true, taken: 8, asked: true });
        assert.equal(w.said[1], 'I took 8 wheat from the chest at (10, 64, 0).');
        assert.ok(w.t - T0 >= 5000 && w.t - T0 < 6000, `taken soon after the yes (${w.t - T0} ms)`);
        assert.equal(w.permits.may('wheat'), true, 'the yes is remembered');
    });

    test('silence: after 60 s the refusal word for word, reason no_permit, nothing taken, one log line', async () => {
        const w = makeWorld();
        const r = await run(w, 'wheat', 8, { low: 16 });
        assert.deepEqual({ ok: r.ok, reason: r.reason, taken: r.taken, asked: r.asked }, { ok: false, reason: 'no_permit', taken: 0, asked: true });
        assert.equal(r.text, 'I take no wheat without your word; say "you may take wheat" when you want.');
        assert.ok(w.t - T0 >= 60000 && w.t - T0 < 61000, `${w.t - T0} ms`);
        assert.deepEqual(w.fetches, []);
        assert.ok(w.logs.includes(r.text));
        assert.equal(S.STOCK_RULES.askMs, 60000);
    });

    test('a "no" during the wait refuses at once', async () => {
        const w = makeWorld({ onWait(world) { if (world.t >= T0 + 2000 && world.permits.entry('wheat') === null) world.permits.set('wheat', false); } });
        const r = await run(w, 'wheat', 8, { low: 16 });
        assert.equal(r.reason, 'no_permit');
        assert.ok(w.t - T0 < 3000, `${w.t - T0} ms`);
        assert.deepEqual(w.fetches, []);
    });

    test('a permit older than the question does not answer it', async () => {
        const w = makeWorld({ chests: [{ x: 10, y: 64, z: 0, items: { wheat: 10 } }] });
        w.permits.set('wheat', true); // allowed long ago, but the stock is low: the question needs a new word
        const r = await run(w, 'wheat', 8, { low: 16 });
        assert.equal(r.reason, 'no_permit');
        assert.equal(w.permits.may('wheat'), true, 'the old permit stays');
    });

    test('the low mark asks though allowed: the low question word for word; a new yes takes', async () => {
        let answered = false;
        const w = makeWorld({
            chests: [{ x: 10, y: 64, z: 0, items: { wheat: 10 } }],
            onWait(world) { if (!answered && world.t >= T0 + 1000) { answered = true; world.permits.set('wheat', true); } },
        });
        w.t = T0 - 100000;
        w.permits.set('wheat', true);
        w.t = T0;
        const r = await run(w, 'wheat', 8, { low: 16 });
        assert.equal(w.said[0], 'Only 10 wheat are left in the chests; may I take 8 for the feeding? Say yes or no.');
        assert.equal(r.ok, true);
        assert.equal(r.taken, 8);
        assert.equal(w.said[1], 'I took 8 wheat from the chest at (10, 64, 0).');
    });

    test('the stock after taking must stay above the low mark: at the mark it asks, above it takes', async () => {
        const at = makeWorld({ chests: [{ x: 10, y: 64, z: 0, items: { wheat: 24 } }] });
        at.permits.set('wheat', true);
        assert.equal((await run(at, 'wheat', 8, { low: 16, askMs: 0 })).reason, 'no_permit', '24 - 8 = 16 is not above 16');
        const above = makeWorld({ chests: [{ x: 10, y: 64, z: 0, items: { wheat: 25 } }] });
        above.permits.set('wheat', true);
        assert.equal((await run(above, 'wheat', 8, { low: 16 })).ok, true);
    });

    test('the purpose slot: the enchanting, the kill room', async () => {
        const w = makeWorld({ chests: [{ x: 10, y: 64, z: 0, items: { lapis_lazuli: 20 } }] });
        await run(w, 'lapis_lazuli', 3, { low: 6, purpose: X.PURPOSES.enchanting, askMs: 0 });
        assert.equal(w.said[0], 'May I take 3 lapis_lazuli from the chest at (10, 64, 0) for the enchanting? Say yes or no.');
        const k = makeWorld({ chests: [{ x: 10, y: 64, z: 0, items: { bread: 20 } }] });
        await run(k, 'bread', 4, { purpose: X.PURPOSES.killRoom, askMs: 0 });
        assert.equal(k.said[0], 'May I take 4 bread from the chest at (10, 64, 0) for the kill room? Say yes or no.');
    });

    test('a store with only may and allowedAt (the spec\'s interface) answers by allowedAt > the question', async () => {
        let at = 0;
        const plain = { may: () => at > 0, allowedAt: () => at };
        const w = makeWorld({ permits: plain, onWait(world) { if (at === 0 && world.t >= T0 + 1500) at = world.t; } });
        const r = await run(w, 'wheat', 8, { low: 16 });
        assert.equal(r.ok, true);
        assert.equal(r.taken, 8);
    });

    test('no store of permits: the refusal at once, no question (nothing could remember a yes)', async () => {
        const w = makeWorld({ permits: null });
        const r = await run(w, 'wheat', 8);
        assert.deepEqual({ reason: r.reason, asked: r.asked }, { reason: 'no_permit', asked: false });
        assert.deepEqual(w.said, []);
    });

    test('the owner\'s stop during the wait: interrupted at the next look, nothing taken', async () => {
        const w = makeWorld({ onWait(world) { if (world.t >= T0 + 3000) world.bot.interrupt_code = true; } });
        const r = await run(w, 'wheat', 8, { low: 16 });
        assert.equal(r.reason, 'interrupted');
        assert.ok(w.t - T0 < 4000);
        assert.deepEqual(w.fetches, []);
    });

    test('the waits of the question are at most 500 ms each', async () => {
        const steps = [];
        const w = makeWorld();
        const wait = async (ms) => { steps.push(ms); await w.clock.wait(ms); };
        await S.takeOrAsk(w.bot, w.ctx, 'wheat', 8, { low: 16, now: w.clock.now, wait });
        assert.ok(steps.length > 0 && steps.every((ms) => ms <= 500), `${Math.max(...steps)} ms`);
    });

    test('a bad item name: bad_name, nothing asked', async () => {
        const w = makeWorld();
        assert.equal((await run(w, '', 8)).reason, 'bad_name');
        assert.deepEqual(w.said, []);
    });
});
