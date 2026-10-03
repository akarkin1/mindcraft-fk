// Spec v0.1.4.12, 4.2 (part E): smeltItem of src/agent/packs/storage/smelt.js on a fake bot with a fake
// furnace window and a virtual clock. The fake furnace smelts one item per 10 s while it burns fuel (a unit
// of coal burns 80 s, of planks or logs 15 s), as the game does; the skill must read its output.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';

const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
const REG = require('prismarine-registry')('1.21.8');

const S = await loadSrc('src/agent/packs/storage/smelt.js');
const P = await loadSrc('src/agent/packs/storage/index.js');

const key = (x, y, z) => `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
const BURN = { coal: 80000, charcoal: 80000 };
const burnOf = (name) => BURN[name] ?? (/_(planks|log|wood)$/.test(name) ? 15000 : 0);
const PRODUCT = { raw_iron: 'iron_ingot', oak_log: 'charcoal', beef: 'cooked_beef' };

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

function item(name, count) {
    return { name, count, type: REG.itemsByName[name].id };
}

// The fake furnace: three slots and the burn state. `msPerItem` and `stuck` change how it works.
function makeFurnace(bot, pos, { msPerItem = 10000, stuck = false } = {}) {
    const f = {
        pos, input: null, fuel: null, output: null, burnLeft: 0, cook: 0, msPerItem, stuck, puts: [], closed: 0,
        tick(ms) {
            let left = ms;
            while (left > 0) {
                const step = Math.min(500, left);
                left -= step;
                if (f.stuck || !f.input) {
                    continue;
                }
                const product = PRODUCT[f.input.name];
                if (f.burnLeft <= 0 && f.fuel) {
                    f.burnLeft += burnOf(f.fuel.name);
                    f.fuel.count -= 1;
                    if (f.fuel.count === 0) f.fuel = null;
                }
                if (f.burnLeft <= 0) {
                    continue;
                }
                f.burnLeft -= step;
                f.cook += step;
                if (f.cook >= f.msPerItem) {
                    f.cook = 0;
                    f.input.count -= 1;
                    if (f.input.count === 0) f.input = null;
                    f.output = f.output ? { ...f.output, count: f.output.count + 1 } : item(product, 1);
                }
            }
        },
    };
    const move = (slot, name, n) => {
        bot.take(name, n);
        f[slot] = f[slot] ? { ...f[slot], count: f[slot].count + n } : item(name, n);
    };
    const back = (slot) => {
        const it = f[slot];
        f[slot] = null;
        if (it) bot.give(it.name, it.count);
        return it;
    };
    const nameOf = (type) => REG.items[type].name;
    f.window = {
        inputItem: () => (f.input ? { ...f.input } : null),
        fuelItem: () => (f.fuel ? { ...f.fuel } : null),
        outputItem: () => (f.output ? { ...f.output } : null),
        async putInput(type, meta, n) { f.puts.push(['input', nameOf(type), n]); move('input', nameOf(type), n); },
        async putFuel(type, meta, n) { f.puts.push(['fuel', nameOf(type), n]); move('fuel', nameOf(type), n); },
        async takeInput() { return back('input'); },
        async takeFuel() { return back('fuel'); },
        async takeOutput() { return back('output'); },
        close() { f.closed++; },
    };
    return f;
}

function makeBot({ pos = [0.5, 64, 0.5], items = {} } = {}) {
    const blocks = new Map();
    const furnaces = new Map();
    const inv = new Map(Object.entries(items));
    const bot = {
        entity: { position: new Vec3(...pos) },
        game: { dimension: 'overworld' },
        registry: REG,
        interrupt_code: false,
        heldItem: null,
        calls: [],
        inventory: { items: () => [...inv.entries()].filter(([, n]) => n > 0).map(([name, count], slot) => ({ ...item(name, count), slot: slot + 9 })) },
        give(name, n) { inv.set(name, (inv.get(name) ?? 0) + n); },
        take(name, n) {
            const have = inv.get(name) ?? 0;
            assert.ok(have >= n, `the bot has ${have} ${name}, not ${n}`);
            inv.set(name, have - n);
        },
        count: (name) => inv.get(name) ?? 0,
        nameAt(x, y, z) { return blocks.get(key(x, y, z)) ?? (y <= 63 ? 'stone' : 'air'); },
        set(x, y, z, name) { blocks.set(key(x, y, z), name); },
        blockAt(p) {
            const name = bot.nameAt(p.x, p.y, p.z);
            return { name, position: new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), boundingBox: name === 'air' ? 'empty' : 'block' };
        },
        findBlocks({ matching, maxDistance }) {
            const out = [];
            for (const [k, name] of blocks) {
                const [x, y, z] = k.split(',').map(Number);
                const p = new Vec3(x, y, z);
                if (matching({ name }) && p.distanceTo(bot.entity.position) <= maxDistance) out.push(p);
            }
            return out;
        },
        addFurnace(x, y, z, options) {
            bot.set(x, y, z, 'furnace');
            const f = makeFurnace(bot, { x, y, z }, options);
            furnaces.set(key(x, y, z), f);
            return f;
        },
        furnaceAt: (x, y, z) => furnaces.get(key(x, y, z)),
        async openFurnace(block) {
            bot.calls.push(['open', block.position.x, block.position.y, block.position.z]);
            const f = furnaces.get(key(block.position.x, block.position.y, block.position.z));
            if (!f) throw new Error('no furnace there');
            return f.window;
        },
    };
    return bot;
}

// The virtual clock: every wait advances the time and the furnaces.
function makeClock(bot, onWait = null) {
    let t = 1000000;
    return {
        now: () => t,
        async wait(ms) {
            t += ms;
            for (const f of bot._furnaces?.() ?? []) f.tick(ms);
            if (onWait) onWait(t);
        },
    };
}

function scene({ items = {}, furnace = [2, 64, 0], furnaceOptions = {}, areas = [], guard = null, onWait = null } = {}) {
    const bot = makeBot({ items });
    const furnaces = [];
    if (furnace) furnaces.push(bot.addFurnace(...furnace, furnaceOptions));
    bot._furnaces = () => furnaces.concat(bot._placed ?? []);
    if (guard) bot.areaGuard = guard;
    const clock = makeClock(bot, onWait ? (t) => onWait(t, bot, furnaces) : null);
    const lines = [];
    const placed = [];
    const ctx = {
        areas,
        log: (t) => lines.push(t),
        now: clock.now,
        skills: {
            async placeBlock(b, name, x, y, z) {
                placed.push([name, x, y, z]);
                b.take(name, 1);
                const f = b.addFurnace(x, y, z);
                b._placed = [...(b._placed ?? []), f];
                return true;
            },
        },
    };
    return { bot, ctx, clock, lines, placed, furnace: furnaces[0], opts: { now: clock.now, wait: clock.wait } };
}

describe('smeltItem: the furnace near the bot', () => {
    test('8 raw_iron with coal: 1 coal, the output read from the furnace, the text of the spec', async () => {
        const s = scene({ items: { raw_iron: 8, coal: 3 } });
        const r = await S.smeltItem(s.bot, s.ctx, 'raw_iron', 8, s.opts);
        assert.deepEqual(r, { ok: true, reason: null, text: 'I smelted 8 raw_iron into 8 iron_ingot in the furnace at (2, 64, 0) with 1 coal.',
            smelted: 8, fuel: { name: 'coal', count: 1 } });
        assert.equal(s.bot.count('iron_ingot'), 8);
        assert.equal(s.bot.count('raw_iron'), 0);
        assert.equal(s.bot.count('coal'), 2);
        assert.deepEqual([s.furnace.input, s.furnace.output], [null, null], 'the furnace is empty of the bot\'s items');
        assert.deepEqual(s.furnace.puts, [['input', 'raw_iron', 8], ['fuel', 'coal', 1]]);
        assert.equal(s.furnace.closed, 1);
        assert.deepEqual(s.lines, [r.text]);
    });

    test('a furnace that does not smelt: nothing is assumed, the input comes back', async () => {
        const s = scene({ items: { raw_iron: 3, coal: 1 }, furnaceOptions: { stuck: true } });
        const r = await S.smeltItem(s.bot, s.ctx, 'raw_iron', 3, s.opts);
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'stalled');
        assert.equal(r.smelted, 0);
        assert.equal(r.text, 'The furnace stopped after 0 of 3 raw_iron.');
        assert.equal(s.bot.count('raw_iron'), 3);
        assert.equal(s.bot.count('iron_ingot'), 0);
        assert.equal(s.bot.count('coal'), 1, 'the coal it put in comes back');
    });

    test('a stop takes what is done and leaves the furnace empty: I stopped after 3 of 8', async () => {
        const s = scene({ items: { raw_iron: 8, coal: 2 }, onWait: (t, bot, furnaces) => {
            if ((furnaces[0].output?.count ?? 0) + bot.count('iron_ingot') >= 3) bot.interrupt_code = true;
        } });
        const r = await S.smeltItem(s.bot, s.ctx, 'raw_iron', 8, s.opts);
        assert.equal(r.reason, 'interrupted');
        assert.equal(r.text, 'I stopped after 3 of 8 raw_iron.');
        assert.equal(r.smelted, 3);
        assert.equal(s.bot.count('iron_ingot'), 3);
        assert.equal(s.bot.count('raw_iron'), 5);
        assert.equal(s.bot.count('coal'), 1, 'the coal that burns is gone, the other stays with the bot');
        assert.deepEqual([s.furnace.input, s.furnace.fuel, s.furnace.output], [null, null, null]);
        assert.deepEqual(r.fuel, { name: 'coal', count: 1 });
    });

    test('the time limit: 12 s per item plus 10 s', async () => {
        const s = scene({ items: { raw_iron: 2, coal: 1 }, furnaceOptions: { msPerItem: 20000 } });
        const r = await S.smeltItem(s.bot, s.ctx, 'raw_iron', 2, { ...s.opts, stallMs: 60000 });
        assert.equal(r.reason, 'timeout');
        assert.equal(r.smelted, 1);
        assert.equal(r.text, 'I smelted 1 raw_iron into 1 iron_ingot in the furnace at (2, 64, 0) with 1 coal. I ran out of time after 1 of 2 raw_iron.');
        assert.ok(s.clock.now() - 1000000 <= 34000 + 2000, 'it stopped at the limit of 34 s');
        assert.equal(s.bot.count('raw_iron'), 1);
    });

    test('batches of at most 64: 70 raw_iron, 9 coal', async () => {
        const s = scene({ items: { raw_iron: 70, coal: 10 } });
        const r = await S.smeltItem(s.bot, s.ctx, 'raw_iron', 70, s.opts);
        assert.equal(r.ok, true, r.text);
        assert.equal(r.smelted, 70);
        assert.deepEqual(s.furnace.puts.filter(p => p[0] === 'input'), [['input', 'raw_iron', 64], ['input', 'raw_iron', 6]]);
        assert.ok(s.furnace.puts.every(p => p[2] <= 64));
        assert.deepEqual(r.fuel, { name: 'coal', count: 9 });
        assert.equal(s.bot.count('iron_ingot'), 70);
    });

    test('logs to charcoal: the logs to smelt are no fuel', async () => {
        const s = scene({ items: { oak_log: 7 } });
        const r = await S.smeltItem(s.bot, s.ctx, 'oak_log', 4, s.opts);
        assert.equal(r.ok, true, r.text);
        assert.equal(r.text, 'I smelted 4 oak_log into 4 charcoal in the furnace at (2, 64, 0) with 3 oak_log.');
        assert.equal(s.bot.count('charcoal'), 4);
        assert.equal(s.bot.count('oak_log'), 0);
        const t = scene({ items: { oak_log: 4 } });
        const r2 = await S.smeltItem(t.bot, t.ctx, 'oak_log', 4, t.opts);
        assert.equal(r2.reason, 'no_fuel');
        assert.equal(r2.text, 'I have no fuel: no coal, charcoal, planks or logs.');
    });

    test('planks when there is no coal; what lay in the output before is not counted', async () => {
        const s = scene({ items: { beef: 3, oak_planks: 5 } });
        s.furnace.output = item('cooked_beef', 2);
        const r = await S.smeltItem(s.bot, s.ctx, 'beef', 3, s.opts);
        assert.equal(r.text, 'I smelted 3 beef into 3 cooked_beef in the furnace at (2, 64, 0) with 2 oak_planks.');
        assert.equal(r.smelted, 3);
        assert.equal(s.bot.count('cooked_beef'), 5);
    });

    test('a furnace busy with another item is left alone', async () => {
        const s = scene({ items: { raw_iron: 3, coal: 1 } });
        s.furnace.input = item('beef', 5);
        const r = await S.smeltItem(s.bot, s.ctx, 'raw_iron', 3, s.opts);
        assert.equal(r.reason, 'busy');
        assert.equal(r.text, 'The furnace at (2, 64, 0) is busy with 5 beef.');
        assert.equal(s.furnace.input.count, 5);
        assert.equal(s.bot.count('raw_iron'), 3);
    });
});

describe('smeltItem: refusals before anything moves', () => {
    test('not smeltable, nothing carried, no fuel, no furnace', async () => {
        let s = scene({ items: { coal: 1 } });
        assert.deepEqual(await S.smeltItem(s.bot, s.ctx, 'raw_cobblestone', 3, s.opts),
            { ok: false, reason: 'not_smeltable', text: 'raw_cobblestone is not something a furnace changes.', smelted: 0, fuel: null });
        assert.equal((await S.smeltItem(s.bot, s.ctx, 'raw_iron', 3, s.opts)).text, 'I carry no raw_iron.');
        s = scene({ items: { raw_iron: 3, lava_bucket: 1, blaze_rod: 4 } });
        const noFuel = await S.smeltItem(s.bot, s.ctx, 'raw_iron', 3, s.opts);
        assert.deepEqual([noFuel.reason, noFuel.text], ['no_fuel', 'I have no fuel: no coal, charcoal, planks or logs.']);
        assert.equal(s.bot.count('lava_bucket'), 1);
        assert.deepEqual(s.bot.calls, [], 'no furnace opened');
        s = scene({ items: { raw_iron: 3, coal: 1 }, furnace: null });
        const none = await S.smeltItem(s.bot, s.ctx, 'raw_iron', 3, s.opts);
        assert.deepEqual([none.reason, none.text], ['no_furnace', 'I know no furnace within 16 blocks and carry none.']);
    });

    test('a furnace that the guard does not let the bot use is not used', async () => {
        const s = scene({ items: { raw_iron: 3, coal: 1 }, guard: { canUse: () => false, canPlace: () => true } });
        const r = await S.smeltItem(s.bot, s.ctx, 'raw_iron', 3, s.opts);
        assert.equal(r.reason, 'no_furnace');
        assert.deepEqual(s.bot.calls, []);
    });

    test('fewer carried than asked: what it carries, and it says so', async () => {
        const s = scene({ items: { raw_iron: 2, coal: 1 } });
        const r = await S.smeltItem(s.bot, s.ctx, 'raw_iron', 5, s.opts);
        assert.equal(r.reason, 'short');
        assert.equal(r.smelted, 2);
        assert.equal(r.text, 'I smelted 2 raw_iron into 2 iron_ingot in the furnace at (2, 64, 0) with 1 coal. I carried only 2 raw_iron.');
    });

    test('a stop before it starts: nothing smelted', async () => {
        const s = scene({ items: { raw_iron: 2, coal: 1 } });
        s.bot.interrupt_code = true;
        const r = await S.smeltItem(s.bot, s.ctx, 'raw_iron', 2, s.opts);
        assert.deepEqual([r.reason, r.text, r.smelted], ['interrupted', 'I stopped after 0 of 2 raw_iron.', 0]);
    });

    test('never throws: a furnace that throws', async () => {
        const s = scene({ items: { raw_iron: 2, coal: 1 } });
        s.furnace.window.putInput = async () => { throw new Error('the window closed'); };
        const r = await S.smeltItem(s.bot, s.ctx, 'raw_iron', 2, s.opts);
        assert.deepEqual([r.ok, r.reason, r.text], [false, 'error', 'I could not smelt raw_iron: the window closed']);
    });
});

describe('smeltItem: a furnace from the inventory', () => {
    const box = (name, kind, type, min, max) => ({ name, kind, type, dimension: 'overworld', min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] } });

    test('placed in the storage, not in the pen that is nearer', async () => {
        const areas = [box('pen', 'pen', 'pen', [-3, 60, -3], [1, 70, 3]), box('store', 'storage', 'building', [3, 60, -2], [7, 70, 2])];
        const s = scene({ items: { raw_iron: 1, coal: 1, furnace: 1 }, furnace: null, areas, guard: { canUse: () => true, canPlace: () => true } });
        const r = await S.smeltItem(s.bot, s.ctx, 'raw_iron', 1, s.opts);
        assert.equal(r.ok, true, r.text);
        assert.equal(s.placed.length, 1);
        const [, x, y, z] = s.placed[0];
        assert.equal(y, 64);
        assert.ok(x >= 3 && x <= 7 && z >= -2 && z <= 2, `placed at ${x} ${z}`);
        assert.equal(x, 3, 'the nearest cell of the storage');
        assert.equal(r.text, `I smelted 1 raw_iron into 1 iron_ingot in the furnace at (${x}, 64, ${z}) with 1 coal.`);
    });

    test('areas exist but no allowed cell within 8: nothing placed', async () => {
        const areas = [box('pen', 'pen', 'pen', [-3, 60, -3], [1, 70, 3]), box('far', 'storage', 'building', [30, 60, 30], [35, 70, 35])];
        const s = scene({ items: { raw_iron: 1, coal: 1, furnace: 1 }, furnace: null, areas });
        const r = await S.smeltItem(s.bot, s.ctx, 'raw_iron', 1, s.opts);
        assert.deepEqual([r.reason, r.text], ['no_furnace', 'I know no furnace within 16 blocks and carry none.']);
        assert.deepEqual(s.placed, []);
        assert.equal(s.bot.count('furnace'), 1);
    });

    test('the guard refuses every cell: nothing placed; without any area the nearest free cell', async () => {
        let s = scene({ items: { raw_iron: 1, coal: 1, furnace: 1 }, furnace: null, guard: { canUse: () => true, canPlace: () => false } });
        assert.equal((await S.smeltItem(s.bot, s.ctx, 'raw_iron', 1, s.opts)).reason, 'no_furnace');
        assert.deepEqual(s.placed, []);
        s = scene({ items: { raw_iron: 1, coal: 1, furnace: 1 }, furnace: null });
        const r = await S.smeltItem(s.bot, s.ctx, 'raw_iron', 1, s.opts);
        assert.equal(r.ok, true, r.text);
        const [, x, y, z] = s.placed[0];
        assert.equal(Math.hypot(x + 0.5 - 0.5, z + 0.5 - 0.5), 1, 'a cell next to the bot');
        assert.equal(y, 64);
    });
});

describe('bindStorage: ctx.storage.smeltItem', () => {
    test('both forms of the call reach the skill', async () => {
        const s = scene({ items: { raw_iron: 1, coal: 2 } });
        const ctx = { ...s.ctx };
        const bound = P.bindStorage(s.bot, ctx);
        const a = await bound.smeltItem('raw_iron', 1, s.opts);
        assert.equal(a.ok, true, a.text);
        s.bot.give('raw_iron', 1);
        const b = await bound.smeltItem(s.bot, ctx, 'raw_iron', 1, s.opts);
        assert.equal(b.ok, true, b.text);
        assert.equal(s.bot.count('iron_ingot'), 2);
    });
});
