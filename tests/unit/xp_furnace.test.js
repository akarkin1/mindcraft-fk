// Spec v0.1.4.13, 4.4 P4 (part P, engineer E3): when no furnace is within the range the guard allows and the bag
// holds one, the bot places it on a free solid cell within 3 blocks of itself in a saved area of kind storage,
// building or mine, or where it stands when it is underground in a mine it knows: `I placed my furnace at
// (16, -59, -99).` then the smelt text. `I know no furnace within 64 blocks and carry none.` only when both hold.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';

const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
const REG = require('prismarine-registry')('1.21.8');

const L = await loadSrc('src/agent/packs/storage/smelt_logic.js');
const S = await loadSrc('src/agent/packs/storage/smelt.js');
const T = await loadSrc('src/agent/packs/storage/texts.js');
const P = await loadSrc('src/agent/packs/storage/index.js');

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

const key = (x, y, z) => `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
const item = (name, count) => ({ name, count, type: REG.itemsByName[name].id });

// A furnace that smelts one raw_iron per 10 s while coal burns; enough for the texts.
function makeFurnace(bot) {
    const f = { input: null, fuel: null, output: null, burnLeft: 0, cook: 0 };
    f.tick = (ms) => {
        let left = ms;
        while (left > 0) {
            const step = Math.min(500, left);
            left -= step;
            if (!f.input) continue;
            if (f.burnLeft <= 0 && f.fuel) {
                f.burnLeft += 80000;
                f.fuel.count -= 1;
                if (f.fuel.count === 0) f.fuel = null;
            }
            if (f.burnLeft <= 0) continue;
            f.burnLeft -= step;
            f.cook += step;
            if (f.cook >= 10000) {
                f.cook = 0;
                f.input.count -= 1;
                if (f.input.count === 0) f.input = null;
                f.output = f.output ? { ...f.output, count: f.output.count + 1 } : item('iron_ingot', 1);
            }
        }
    };
    const move = (slot, name, n) => { bot.take(name, n); f[slot] = f[slot] ? { ...f[slot], count: f[slot].count + n } : item(name, n); };
    const back = (slot) => { const it = f[slot]; f[slot] = null; if (it) bot.give(it.name, it.count); return it; };
    f.window = {
        inputItem: () => (f.input ? { ...f.input } : null),
        fuelItem: () => (f.fuel ? { ...f.fuel } : null),
        outputItem: () => (f.output ? { ...f.output } : null),
        async putInput(type, meta, n) { move('input', REG.items[type].name, n); },
        async putFuel(type, meta, n) { move('fuel', REG.items[type].name, n); },
        async takeInput() { return back('input'); },
        async takeFuel() { return back('fuel'); },
        async takeOutput() { return back('output'); },
        close() {},
    };
    return f;
}

// The bot in a tunnel at y -59: stone all round, the tunnel cells air (2 high, from z -105 to -95 at x 16).
function scene({ items = {}, areas = [], whereAmI = null, mines = null, pos = [16.5, -59, -99.5], guard = null } = {}) {
    const blocks = new Map();
    const furnaces = new Map();
    const inv = new Map(Object.entries(items));
    const bot = {
        entity: { position: new Vec3(...pos) }, game: { dimension: 'overworld' }, registry: REG, interrupt_code: false, heldItem: null, calls: [],
        inventory: { items: () => [...inv.entries()].filter(([, n]) => n > 0).map(([name, count], slot) => ({ ...item(name, count), slot: slot + 9 })) },
        give(name, n) { inv.set(name, (inv.get(name) ?? 0) + n); },
        take(name, n) { inv.set(name, (inv.get(name) ?? 0) - n); },
        count: (name) => inv.get(name) ?? 0,
        nameAt(x, y, z) { return blocks.get(key(x, y, z)) ?? 'stone'; },
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
        async openFurnace(block) {
            const f = furnaces.get(key(block.position.x, block.position.y, block.position.z));
            if (!f) throw new Error('no furnace there');
            return f.window;
        },
    };
    for (let z = -105; z <= -95; z++) {
        bot.set(16, -59, z, 'air');
        bot.set(16, -58, z, 'air');
    }
    if (guard) bot.areaGuard = guard;
    let t = 1000000;
    const clock = { now: () => t, async wait(ms) { t += ms; for (const f of furnaces.values()) f.tick(ms); } };
    const placed = [];
    const ctx = {
        areas, log: () => {}, now: clock.now,
        whereAmI: whereAmI ? () => whereAmI : undefined,
        mines: mines ? { list: () => mines } : undefined,
        skills: {
            async placeBlock(b, name, x, y, z) {
                placed.push([name, x, y, z]);
                b.take(name, 1);
                b.set(x, y, z, 'furnace');
                furnaces.set(key(x, y, z), makeFurnace(b));
                return true;
            },
        },
    };
    return { bot, ctx, placed, opts: { now: clock.now, wait: clock.wait } };
}

describe('P4: the rule, pure', () => {
    test('inKnownMine: underground with the mine of whereAmI, or a mine of the store at the level of the bot', () => {
        const feet = { x: 16.5, y: -59, z: -99.5 };
        const deep = { name: 'deep', entrance: { x: 10, y: 64, z: -90 }, level: -59 };
        assert.equal(L.inKnownMine({ underground: true, mine: { name: 'deep' } }, null, feet), true);
        assert.equal(L.inKnownMine({ underground: true, mine: null }, [deep], feet), true);
        assert.equal(L.inKnownMine({ underground: true, mine: null }, [{ ...deep, level: -55 }], feet), false, 'another level');
        assert.equal(L.inKnownMine({ underground: true, mine: null }, [{ ...deep, entrance: { x: 100, y: 64, z: -90 } }], feet), false, 'too far');
        assert.equal(L.inKnownMine({ underground: false, mine: { name: 'deep' } }, [deep], feet), false, 'on the surface');
        assert.equal(L.inKnownMine(null, [deep], feet), false);
        assert.equal(L.inKnownMine({ underground: true }, null, feet), false, 'no mine known');
        assert.equal(L.FURNACE_PLACE_NEAR, 3);
    });

    test('chooseFurnaceSpot within 3 blocks: an allowed area, or anywhere in a mine; never in a pen', () => {
        const me = { x: 16.5, y: -59, z: -99.5 };
        const cells = [{ x: 16, y: -59, z: -96 }, { x: 16, y: -59, z: -97 }, { x: 16, y: -59, z: -103 }, { x: 16, y: -59, z: -94 }];
        const storage = { name: 'room', kind: 'storage', min: { x: 14, y: -60, z: -98 }, max: { x: 18, y: -56, z: -94 } };
        const pen = { name: 'pen', kind: 'pen', min: { x: 14, y: -60, z: -98 }, max: { x: 18, y: -56, z: -94 } };
        assert.deepEqual(L.chooseFurnaceSpot(cells, [storage], me, null, { range: 3 }), { x: 16, y: -59, z: -97 }, 'the nearest cell of the storage within 3');
        assert.deepEqual(L.chooseFurnaceSpot(cells, [storage], me, null, { range: 3, inMine: false }), cells[1]);
        assert.equal(L.chooseFurnaceSpot(cells, [{ ...storage, min: { x: 14, y: -60, z: -95 } }], me, null, { range: 3 }), null, 'the area starts 4.5 away');
        assert.ok([-97, -103].includes(L.chooseFurnaceSpot(cells, [{ ...storage, min: { x: 14, y: -60, z: -95 } }], me, null, { range: 3, inMine: true })?.z), 'in a mine: anywhere within 3');
        assert.deepEqual(L.chooseFurnaceSpot(cells, [pen], me, null, { range: 3, inMine: true }), { x: 16, y: -59, z: -103 }, 'never in the pen, even in a mine');
        assert.ok([-97, -103].includes(L.chooseFurnaceSpot(cells, [], me, null, { range: 3 })?.z), 'without areas the nearest, two at 3');
        assert.equal(L.cellAllowsFurnace({ x: 16, y: -59, z: -97 }, [{ ...storage, min: { x: 14, y: -60, z: -95 } }], { inMine: true }), true);
        assert.equal(L.cellAllowsFurnace({ x: 16, y: -59, z: -97 }, [pen], { inMine: true }), false);
    });

    test('the texts, word for word', () => {
        assert.equal(T.TEXTS.placedFurnace({ x: 16, y: -59, z: -99 }), 'I placed my furnace at (16, -59, -99).');
        assert.equal(T.TEXTS.noFurnace(64), 'I know no furnace within 64 blocks and carry none.');
        assert.equal(T.TEXTS.noFurnaceSpot(64, 3), 'I know no furnace within 64 blocks. I carry one but find no free cell for it within 3 blocks. Stand where I may build and tell me again.');
    });
});

describe('P4: smeltItem with the furnace in the bag', () => {
    test('underground in a known mine (whereAmI names it): placed within 3 blocks, the placed text then the smelt text', async () => {
        const s = scene({ items: { raw_iron: 3, coal: 1, furnace: 1 }, whereAmI: { underground: true, depth: 120, area: null, mine: { name: 'deep', tunnel: 0, level: -59 } } });
        const r = await S.smeltItem(s.bot, s.ctx, 'raw_iron', 3, s.opts);
        assert.equal(r.ok, true, r.text);
        assert.equal(s.placed.length, 1);
        const [, x, y, z] = s.placed[0];
        assert.ok(Math.hypot(x + 0.5 - 16.5, z + 0.5 + 99.5) <= 3, `within 3: ${x} ${z}`);
        assert.equal(y, -59);
        assert.equal(r.text, `I placed my furnace at (${x}, ${y}, ${z}). I smelted 3 raw_iron into 3 iron_ingot in the furnace at (${x}, ${y}, ${z}) with 1 coal.`);
        assert.equal(s.bot.count('furnace'), 0);
        assert.equal(s.bot.count('iron_ingot'), 3);
    });

    test('underground with a mine of the store at the level of the bot (no mine_routes): placed too', async () => {
        const s = scene({ items: { raw_iron: 1, coal: 1, furnace: 1 }, whereAmI: { underground: true, depth: 120, area: null, mine: null },
            mines: [{ name: 'deep', entrance: { x: 10, y: 64, z: -90 }, level: -59 }], areas: [{ name: 'home', kind: 'home', min: { x: 0, y: 60, z: 0 }, max: { x: 9, y: 70, z: 9 } }] });
        const r = await S.smeltItem(s.bot, s.ctx, 'raw_iron', 1, s.opts);
        assert.equal(r.ok, true, r.text);
        assert.equal(s.placed.length, 1);
        assert.match(r.text, /^I placed my furnace at \(16, -59, -(99|101)\)\. I smelted 1 raw_iron/);
    });

    test('on the surface with areas: only in a storage, building or mine area within 3 blocks; nothing: the carried-furnace text, not the old one', async () => {
        const storage = { name: 'room', kind: 'storage', min: { x: 14, y: -60, z: -98 }, max: { x: 18, y: -56, z: -94 } };
        let s = scene({ items: { raw_iron: 1, coal: 1, furnace: 1 }, areas: [storage], whereAmI: { underground: false, mine: null } });
        let r = await S.smeltItem(s.bot, s.ctx, 'raw_iron', 1, s.opts);
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(s.placed[0], ['furnace', 16, -59, -98], 'the nearest cell of the storage');
        const far = { ...storage, min: { x: 14, y: -60, z: -95 } };
        s = scene({ items: { raw_iron: 1, coal: 1, furnace: 1 }, areas: [far], whereAmI: { underground: false, mine: null } });
        r = await S.smeltItem(s.bot, s.ctx, 'raw_iron', 1, s.opts);
        assert.deepEqual([r.ok, r.reason, r.text], [false, 'no_spot', 'I know no furnace within 64 blocks. I carry one but find no free cell for it within 3 blocks. Stand where I may build and tell me again.']);
        assert.deepEqual(s.placed, []);
        assert.equal(s.bot.count('furnace'), 1, 'kept');
    });

    test('underground in no mine it knows, with areas elsewhere: nothing placed, the carried-furnace text', async () => {
        const s = scene({ items: { raw_iron: 1, coal: 1, furnace: 1 }, areas: [{ name: 'home', kind: 'home', min: { x: 0, y: 60, z: 0 }, max: { x: 9, y: 70, z: 9 } }],
            whereAmI: { underground: true, depth: 120, area: null, mine: null }, mines: [] });
        const r = await S.smeltItem(s.bot, s.ctx, 'raw_iron', 1, s.opts);
        assert.equal(r.reason, 'no_spot');
        assert.deepEqual(s.placed, []);
    });

    test('the old text only when both hold: no furnace within 64 blocks and none carried', async () => {
        const s = scene({ items: { raw_iron: 1, coal: 1 }, whereAmI: { underground: true, mine: { name: 'deep' } } });
        const r = await S.smeltItem(s.bot, s.ctx, 'raw_iron', 1, s.opts);
        assert.deepEqual([r.reason, r.text], ['no_furnace', 'I know no furnace within 64 blocks and carry none.']);
    });

    test('a furnace within 64 blocks is used, the one in the bag stays', async () => {
        const s = scene({ items: { raw_iron: 1, coal: 1, furnace: 1 }, whereAmI: { underground: true, mine: { name: 'deep' } } });
        await s.ctx.skills.placeBlock(s.bot, 'furnace', 16, -59, -97);
        s.bot.give('furnace', 1);
        s.placed.length = 0;
        const r = await S.smeltItem(s.bot, s.ctx, 'raw_iron', 1, s.opts);
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(s.placed, [], 'nothing placed');
        assert.equal(s.bot.count('furnace'), 1);
        assert.doesNotMatch(r.text ?? '', /I placed my furnace/);
    });

    test('the guard refuses every cell: nothing placed; the storage pack exports the new names', async () => {
        const s = scene({ items: { raw_iron: 1, coal: 1, furnace: 1 }, whereAmI: { underground: true, mine: { name: 'deep' } }, guard: { canUse: () => true, canPlace: () => false } });
        const r = await S.smeltItem(s.bot, s.ctx, 'raw_iron', 1, s.opts);
        assert.equal(r.reason, 'no_spot');
        assert.deepEqual(s.placed, []);
        assert.equal(typeof P.inKnownMine, 'function');
        assert.equal(P.FURNACE_PLACE_NEAR, 3);
        assert.equal(typeof P.bindStorage(s.bot, s.ctx).lookIntoChests, 'function', 'the supply step of the mining pack reaches it');
    });
});
