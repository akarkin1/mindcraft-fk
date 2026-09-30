// Spec v0.1.4.8 E2 (part E, engineer E5): the whole round of farmCycle (harvest, store, plant with a
// hoe, bone meal, fertilize, harvest again, the gate), the sources of bone meal and of compost items
// in their order, leaf_litter as compost item and block to pick, the composter of the farm, the texts
// with numbers and the next step, the ripe plants read again after a walk to a chest, the gate closed
// also when the work fails half way, and the result of a stopped cycle (I6).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { give, makeFakeBot, makeSim, makeWorld } from './home_fake_bot.test.js';
import { loadSrc } from '../helpers/load.js';

const F = await loadSrc('src/agent/packs/farming/farming.js');
const C = await loadSrc('src/agent/packs/farming/crop_logic.js');
const G = await loadSrc('src/agent/packs/farming/field_logic.js');
const T = await loadSrc('src/agent/packs/farming/texts.js');
const P = await loadSrc('src/agent/packs/farming/index.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

const SEED_OF = { wheat_seeds: 'wheat' };
const RIPE = { wheat: 7 };
const DROPS = { wheat: [['wheat', 1], ['wheat_seeds', 2]] };
// what the fake composter takes: the compost items of the spec, never seeds, crops or food
const COMPOST = new Set(['leaf_litter', 'oak_leaves', 'poppy', 'dandelion', 'oak_sapling']);

function add(bot, name, n = 1) {
    const it = bot.inventory.list.find(i => i.name === name);
    if (it) it.count += n;
    else give(bot, name, n);
}

function countOf(bot, name) {
    return bot.inventory.list.filter(i => i.name === name).reduce((s, i) => s + i.count, 0);
}

// The rules of the game the pack relies on: seeds on farmland, a hoe on grass, bone meal +3 age,
// the composter (every item raises the level), the drops of crops, flowers and leaf litter.
function installFarmSim(bot) {
    const world = bot.world;
    bot.readyComposters = [];
    bot.unequip = (dest) => {
        bot.calls.push(['unequip', dest]);
        bot.heldItem = null;
        return Promise.resolve();
    };
    bot.onActivate = (block) => {
        const p = block.position;
        const name = world.nameAt(p.x, p.y, p.z);
        const props = world.propsAt(p.x, p.y, p.z);
        const held = bot.heldItem && bot.heldItem.count > 0 ? bot.heldItem : null;
        const above = world.nameAt(p.x, p.y + 1, p.z);
        if (name === 'composter') {
            const level = props.level ?? 0;
            if (level === 8) {
                world.setProps(p.x, p.y, p.z, { level: 0 });
                add(bot, 'bone_meal', 1);
            } else if (held && level < 7) {
                bot.calls.push(['compost', held.name]);
                if (!COMPOST.has(held.name)) return;
                held.count--;
                world.setProps(p.x, p.y, p.z, { level: level + 1 });
                if (level + 1 === 7) bot.readyComposters.push(p);
            }
            return;
        }
        if (!held) return;
        if (SEED_OF[held.name] && name === 'farmland' && above === 'air') {
            world.set(p.x, p.y + 1, p.z, SEED_OF[held.name], { age: 0 });
            held.count--;
        } else if (held.name.endsWith('_hoe') && above === 'air' && ['grass_block', 'dirt'].includes(name)) {
            world.set(p.x, p.y, p.z, 'farmland', { moisture: 0 });
        } else if (held.name === 'bone_meal' && RIPE[name] !== undefined && (props.age ?? 0) < RIPE[name]) {
            world.setProps(p.x, p.y, p.z, { age: Math.min(RIPE[name], (props.age ?? 0) + 3) });
            held.count--;
        }
    };
    const baseDig = bot.dig;
    bot.dig = async (block) => {
        const p = block.position;
        const name = world.nameAt(p.x, p.y, p.z);
        const props = world.propsAt(p.x, p.y, p.z);
        await baseDig(block);
        if (RIPE[name] !== undefined) {
            if ((props.age ?? 0) >= RIPE[name]) for (const [item, n] of DROPS[name]) add(bot, item, n);
            else add(bot, 'wheat_seeds', 1);
        } else if (['poppy', 'dandelion'].includes(name)) {
            add(bot, name, 1);
        } else if (name === 'leaf_litter') {
            add(bot, 'leaf_litter', props.segment_amount ?? 1);
        }
        if (bot.onDig) bot.onDig(name, p);
    };
}

function sim(bot, extra = null) {
    return makeSim(bot, {
        onStep() {
            for (const p of bot.readyComposters.splice(0)) bot.world.setProps(p.x, p.y, p.z, { level: 8 });
            if (extra) extra();
        },
    });
}

/**
 * A fenced field on the grass: farmland at x 0..w-1, z 0..d-1 (ground() may give grass), crops from
 * ages(x, z) (null: none), a fence ring at y 64, a closed gate at (0, 64, d). The area is "farm".
 */
function farm({ w = 2, d = 5, ages = () => 7, ground = () => 'farmland', name = 'farm', composter = null, pos = null } = {}) {
    const world = makeWorld();
    for (let x = 0; x < w; x++) {
        for (let z = 0; z < d; z++) {
            const g = ground(x, z);
            world.set(x, 63, z, g, g === 'farmland' ? { moisture: 7 } : {});
            const age = g === 'farmland' ? ages(x, z) : null;
            if (age !== null && age !== undefined) world.set(x, 64, z, 'wheat', { age });
        }
    }
    const bot = makeFakeBot({ world, pos: pos ?? [0.5, 64, d + 3.5] });
    for (let x = -1; x <= w; x++) {
        for (let z = -1; z <= d; z++) {
            if (x !== -1 && x !== w && z !== -1 && z !== d) continue;
            if (x === 0 && z === d) {
                world.gate(0, 64, d, { facing: 'south' });
                continue;
            }
            world.set(x, 64, z, 'oak_fence');
            bot.blocked.add(`${x},64,${z}`);
        }
    }
    if (composter) world.set(composter.x, composter.y, composter.z, 'composter', { level: 0 });
    installFarmSim(bot);
    const area = {
        name, type: 'farm', dimension: 'overworld', source: 'scan',
        min: { x: -1, y: 62, z: -1 }, max: { x: w, y: 66, z: d }, entrances: [{ x: 0, y: 64, z: d, kind: 'gate' }],
    };
    return { world, bot, area, ctx: { areas: [area] } };
}

/** The chests of the owner (chests.json of the play test, in part): leaf_litter 104 at (11, 67, 53). */
function ownerChests(bot, holds = { leaf_litter: 104 }) {
    const calls = [];
    const chest = { x: 11, y: 67, z: 53, dimension: 'overworld', kind: 'chest', items: holds, free_slots: 14 };
    return {
        calls,
        chests: { list: () => [chest], update() {} },
        storage: {
            fetchItem(name, n = 1) {
                calls.push(['fetchItem', name, n]);
                const k = Math.min(holds[name] ?? 0, n);
                if (k > 0) {
                    add(bot, name, k);
                    holds[name] -= k;
                }
                return Promise.resolve({ ok: k > 0, taken: k, chests: k > 0 ? [{ x: 11, y: 67, z: 53 }] : [], text: '' });
            },
            storeItems(options) {
                calls.push(['storeItems', options]);
                const n = countOf(bot, 'wheat');
                for (const i of bot.inventory.list) if (i.name === 'wheat') i.count = 0;
                return Promise.resolve({ ok: true, stored: { wheat: n }, text: `I stored ${n} wheat in the chest at (11, 67, 53).` });
            },
        },
    };
}

const gateOpen = (world, d) => world.propsAt(0, 64, d).open === true;
const digs = bot => bot.calls.filter(c => c[0] === 'dig');

describe('farmCycle: the whole round (F1)', () => {
    test('harvest, store, bone meal from the leaf_litter of a known chest, fertilize, harvest again, the gate', async () => {
        const f = farm({ ages: (x, z) => (z === 0 ? 7 : 0), composter: { x: 4, y: 64, z: 7 } });
        const o = ownerChests(f.bot);
        Object.assign(f.ctx, { chests: o.chests, storage: o.storage });
        const s = sim(f.bot);
        const r = await F.farmCycle(f.bot, f.ctx, '', { now: s.now, wait: s.wait });
        assert.equal(r.ok, true, r.text);
        assert.equal(r.text, 'Farm "farm": I harvested 2 wheat and planted 2 again. I stored 2 wheat in the chest at (11, 67, 53). '
            + '10 plants are not ripe. I made 9 bone_meal from 64 leaf_litter of the chest at (11, 67, 53) and used them. '
            + '3 more plants got ripe and I harvested them. The gate is closed.');
        assert.deepEqual(o.calls.filter(c => c[0] === 'fetchItem'), [['fetchItem', 'leaf_litter', 64]]);
        assert.equal(r.madeBoneMeal, 9);
        assert.equal(r.fertilized, 9);
        assert.equal(r.harvested, 5);
        assert.equal(gateOpen(f.world, 5), false);
        assert.ok(f.bot.entity.position.z > 5, 'out of the field');
        assert.ok(!f.bot.calls.some(c => c[0] === 'compost' && !COMPOST.has(c[1])), 'never seeds, crops or food');
        assert.equal(digs(f.bot).filter(c => c[2] === 63).length, 0, 'nothing of the field ground was dug');
    });

    test('nothing to compost anywhere: the text of the spec with the next step', async () => {
        const f = farm({ ages: () => 3, composter: { x: 4, y: 64, z: 7 } });
        const o = ownerChests(f.bot, {});
        Object.assign(f.ctx, { chests: o.chests, storage: o.storage });
        const s = sim(f.bot);
        const r = await F.farmCycle(f.bot, f.ctx, '', { now: s.now, wait: s.wait });
        assert.equal(r.text, 'Farm "farm": I have nothing to compost and the chests I know have nothing. 10 plants are growing. Nothing to do now. '
            + 'The gate is closed.');
        assert.deepEqual(o.calls, [], 'no walk to a chest that holds nothing');
    });

    test('no composter at the farm or near the bot', async () => {
        const f = farm({ ages: () => 3 });
        const s = sim(f.bot);
        const r = await F.farmCycle(f.bot, f.ctx, '', { now: s.now, wait: s.wait });
        assert.equal(r.text, 'Farm "farm": I found no composter at the farm or within 32 blocks. 10 plants are growing. Nothing to do now. '
            + 'The gate is closed.');
    });

    test('bone meal: carried first; then the chests; the composter only for the rest', async () => {
        const f = farm({ w: 1, d: 2, ages: () => 4, composter: { x: 4, y: 64, z: 4 } });
        give(f.bot, 'bone_meal', 4);
        const o = ownerChests(f.bot, { bone_meal: 10, leaf_litter: 50 });
        Object.assign(f.ctx, { chests: o.chests, storage: o.storage });
        const s = sim(f.bot);
        const r = await F.farmCycle(f.bot, f.ctx, '', { now: s.now, wait: s.wait });
        assert.deepEqual(o.calls, [], 'the 4 carried are enough for 2 plants');
        assert.equal(r.text, 'Farm "farm": 2 plants are not ripe. I used 2 bone_meal. 2 more plants got ripe and I harvested them. The gate is closed.');

        const g = farm({ w: 1, d: 2, ages: () => 0, composter: { x: 4, y: 64, z: 4 } });
        const o2 = ownerChests(g.bot, { bone_meal: 10, leaf_litter: 50 });
        Object.assign(g.ctx, { chests: o2.chests, storage: o2.storage });
        const s2 = sim(g.bot);
        const r2 = await F.farmCycle(g.bot, g.ctx, '', { now: s2.now, wait: s2.wait });
        assert.deepEqual(o2.calls.map(c => c.slice(0, 2)), [['fetchItem', 'bone_meal']], 'bone meal of the chest before any compost');
        assert.equal(r2.text, 'Farm "farm": 2 plants are not ripe. I took 4 bone_meal from the chest at (11, 67, 53) and used them. '
            + '1 more plant got ripe and I harvested it. The gate is closed.');
    });

    test('compost items: carried first, then the chest, then leaf litter picked near the farm; never seeds, crops or food', async () => {
        const f = farm({ w: 1, d: 1, ages: () => 0, composter: { x: 3, y: 64, z: 3 } });
        for (const [name, n] of [['wheat_seeds', 40], ['wheat', 9], ['bread', 5], ['melon_slice', 4], ['pumpkin', 2], ['poppy', 3]]) give(f.bot, name, n);
        for (let x = 6; x <= 12; x++) f.world.set(x, 64, 10, 'leaf_litter', { segment_amount: 2 });
        const o = ownerChests(f.bot, { leaf_litter: 5 });
        Object.assign(f.ctx, { chests: o.chests, storage: o.storage });
        const s = sim(f.bot);
        const r = await F.farmCycle(f.bot, f.ctx, '', { now: s.now, wait: s.wait });
        const composted = f.bot.calls.filter(c => c[0] === 'compost').map(c => c[1]);
        assert.deepEqual(composted.slice(0, 3), ['poppy', 'poppy', 'poppy'], 'what it carries first');
        assert.deepEqual([...new Set(composted)], ['poppy', 'leaf_litter']);
        assert.ok(digs(f.bot).some(c => c[3] === 10), 'leaf litter was picked');
        assert.deepEqual(o.calls.filter(c => c[0] === 'fetchItem').map(c => c[1]), ['leaf_litter'],
            'the chest has no bone_meal, so only its leaf_litter is asked for');
        for (const [name, n] of [['wheat_seeds', 40], ['bread', 5], ['melon_slice', 4], ['pumpkin', 2]]) assert.ok(countOf(f.bot, name) >= n, name);
        assert.match(r.text, /I made \d+ bone_meal from \d+ leaf_litter, 3 poppy of my inventory, the chest at \(11, 67, 53\) and plants nearby and used/);
    });

    test('options.fertilize false: no bone meal step, the texts of v0.1.4.7', async () => {
        const f = farm({ ages: () => 3, composter: { x: 4, y: 64, z: 7 } });
        const o = ownerChests(f.bot);
        Object.assign(f.ctx, { chests: o.chests, storage: o.storage });
        const s = sim(f.bot);
        const r = await F.farmCycle(f.bot, f.ctx, '', { now: s.now, wait: s.wait, fertilize: false });
        assert.equal(r.text, 'Farm "farm": Nothing is ripe yet. 10 plants are growing. The gate is closed.');
        assert.deepEqual(o.calls, []);
    });

    test('a cycle takes at most 10 minutes', () => {
        assert.equal(F.FARM_LIMITS.cycleMs, 10 * 60000);
    });
});

describe('farmCycle: the hoe and the tilled blocks (F1, F7)', () => {
    test('grass in the field and no hoe: ctx.tools.ensureTool gets one from inventory and chests; the text names the tilled blocks', async () => {
        const f = farm({ w: 2, d: 2, ground: (x) => (x === 1 ? 'grass_block' : 'farmland'), ages: () => null });
        give(f.bot, 'wheat_seeds', 10);
        const asked = [];
        f.ctx.tools = {
            async ensureTool(bot, ctx, kind, material, options) {
                asked.push([kind, material, options?.collect]);
                give(bot, 'wooden_hoe', 1);
                return { ok: true, crafted: ['wooden_hoe'], text: 'I crafted a wooden_hoe.' };
            },
        };
        const s = sim(f.bot);
        const r = await F.farmCycle(f.bot, f.ctx, '', { now: s.now, wait: s.wait, fertilize: false });
        assert.deepEqual(asked, [['hoe', '', false]]);
        assert.equal(r.text, 'Farm "farm": I crafted a wooden_hoe. I tilled 2 blocks and planted 4 wheat_seeds. The gate is closed.');
    });

    test('no ground to till: no hoe is asked for', async () => {
        const f = farm({ w: 1, d: 2, ages: () => null });
        give(f.bot, 'wheat_seeds', 10);
        const asked = [];
        f.ctx.tools = { async ensureTool() { asked.push(1); return { ok: false }; } };
        const s = sim(f.bot);
        await F.farmCycle(f.bot, f.ctx, '', { now: s.now, wait: s.wait, fertilize: false });
        assert.deepEqual(asked, []);
    });
});

describe('farmCycle: the ripe plants are read again after a walk to a chest (F6)', () => {
    test('a plant that got ripe while the bot stored is harvested in the same cycle', async () => {
        const f = farm({ ages: (x, z) => (z === 0 ? 7 : 3) });
        const o = ownerChests(f.bot);
        const store = o.storage.storeItems;
        o.storage.storeItems = async (options) => {
            f.world.setProps(1, 64, 4, { age: 7 });
            return store(options);
        };
        Object.assign(f.ctx, { chests: o.chests, storage: o.storage });
        const s = sim(f.bot);
        const r = await F.farmCycle(f.bot, f.ctx, '', { now: s.now, wait: s.wait, fertilize: false });
        assert.equal(r.harvested, 3);
        assert.match(r.text, /^Farm "farm": I harvested 3 wheat and planted 3 again\./);
        assert.equal(f.world.propsAt(1, 64, 4).age, 0, 'harvested and planted again');
    });
});

describe('farmCycle: the gate and the stop', () => {
    test('an error half way while the bot stands in the field: out through the gate, the gate closed', async () => {
        const f = farm({ ages: () => 7 });
        const entity = f.bot.entity;
        let armed = false;
        let fired = false;
        Object.defineProperty(f.bot, 'entity', {
            configurable: true,
            get() {
                if (armed && !fired) {
                    fired = true;
                    throw new Error('the world went away');
                }
                return entity;
            },
        });
        f.bot.onDig = () => { armed = true; };
        const s = sim(f.bot);
        const r = await F.farmCycle(f.bot, f.ctx, '', { now: s.now, wait: s.wait });
        assert.equal(fired, true);
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'error');
        assert.ok(entity.position.z > 5, `out of the field: ${entity.position.z}`);
        assert.equal(gateOpen(f.world, 5), false);
    });

    test('stopped: interrupted, the text says what was done, an open gate within reach is closed without a walk (I6)', async () => {
        const f = farm({ w: 1, d: 5, ages: (x, z) => (z === 4 ? 7 : 3) });
        f.bot.onDig = () => {
            f.world.setProps(0, 64, 5, { open: true });
            f.bot.interrupt_code = true;
        };
        const s = sim(f.bot);
        const r = await F.farmCycle(f.bot, f.ctx, '', { now: s.now, wait: s.wait });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'interrupted');
        assert.equal(r.text, 'Farm "farm": I harvested 1 wheat and planted 0 again. 4 plants are not ripe yet. I was stopped before the end.');
        assert.equal(gateOpen(f.world, 5), false, 'closed from where the bot stands');
        const gotoAfter = f.bot.calls.slice(f.bot.calls.findIndex(c => c[0] === 'dig')).filter(c => c[0] === 'goto');
        assert.deepEqual(gotoAfter, [], 'no walk after the stop');
    });
});

describe('makeBoneMeal: the composter of the farm and the chests (F2)', () => {
    test('the composter in the saved farm 40 blocks away is used; no "no composter within 32 blocks"', async () => {
        const f = farm({ ages: () => 3, composter: { x: 1, y: 64, z: 7 }, pos: [0.5, 64, 45.5] });
        give(f.bot, 'oak_leaves', 7);
        const s = sim(f.bot);
        const r = await F.makeBoneMeal(f.bot, f.ctx, 1, { now: s.now, wait: s.wait });
        assert.equal(r.text, 'I made 1 bone_meal from 7 items.');
        assert.equal(r.made, 1);
    });

    test('the leaf_litter of a known chest is used when the bot carries nothing', async () => {
        const f = farm({ ages: () => 3, composter: { x: 4, y: 64, z: 7 } });
        const o = ownerChests(f.bot);
        Object.assign(f.ctx, { chests: o.chests, storage: o.storage });
        const s = sim(f.bot);
        const r = await F.makeBoneMeal(f.bot, f.ctx, 1, { now: s.now, wait: s.wait });
        assert.equal(r.text, 'I made 1 bone_meal from 7 items.');
        assert.equal(o.calls[0][0], 'fetchItem');
        assert.equal(o.calls[0][1], 'leaf_litter');
    });

    test('leaf litter on the ground is picked without shears; the texts speak of no shears', async () => {
        const f = farm({ ages: () => 3, composter: { x: 4, y: 64, z: 7 } });
        for (let x = 5; x <= 8; x++) f.world.set(x, 64, 9, 'leaf_litter', { segment_amount: 2 });
        const s = sim(f.bot);
        const r = await F.makeBoneMeal(f.bot, f.ctx, 1, { now: s.now, wait: s.wait });
        assert.equal(r.made, 1, r.text);
        assert.doesNotMatch(r.text, /shears/);
        const none = farm({ ages: () => 3, composter: { x: 4, y: 64, z: 7 } });
        const s2 = sim(none.bot);
        const r2 = await F.makeBoneMeal(none.bot, none.ctx, 1, { now: s2.now, wait: s2.wait });
        assert.equal(r2.text, 'I found nothing to compost. I do not use seeds for that.');
    });

    test('no composter near a known farm: the text names the farm', async () => {
        const f = farm({ ages: () => 3 });
        const r = await F.makeBoneMeal(f.bot, f.ctx, 1);
        assert.equal(r.text, 'I found no composter at the farm or within 32 blocks.');
        const bot = makeFakeBot({ pos: [60.5, 64, 60.5] });
        assert.equal((await F.makeBoneMeal(bot, {}, 1)).text, 'I found no composter within 32 blocks.');
    });
});

describe('the logic (pure)', () => {
    test('chooseComposter: in the farm area or within 8 blocks of it first, else the nearest within 32 of the bot', () => {
        const farmBox = { min: { x: -13, y: 61, z: 23 }, max: { x: -6, y: 65, z: 34 } };
        const inFarm = { x: -10, y: 63, z: 30 };
        const near = { x: 0, y: 64, z: 30 };
        const atBot = { x: 20, y: 64, z: 20 };
        assert.deepEqual(G.chooseComposter([atBot, inFarm], farmBox, { x: 20.5, y: 64, z: 21.5 }), inFarm, 'the farm first, however far the bot');
        assert.deepEqual(G.chooseComposter([atBot, near], farmBox, { x: 20.5, y: 64, z: 21.5 }), near, '6.5 blocks from the farm');
        assert.deepEqual(G.chooseComposter([atBot, { x: 3, y: 64, z: 30 }], farmBox, { x: 20.5, y: 64, z: 21.5 }), atBot, '9.5 from the farm: not the farm one');
        assert.equal(G.chooseComposter([{ x: 60, y: 64, z: 60 }], null, { x: 20.5, y: 64, z: 21.5 }), null, 'beyond 32 blocks');
        assert.equal(G.chooseComposter([], farmBox, { x: 0, y: 64, z: 0 }), null);
        assert.equal(G.chooseComposter(null, null, null), null);
        assert.deepEqual(G.farmMiddle(farmBox), { x: -9, y: 62, z: 29 });
        assert.equal(G.farmMiddle(null), null);
        assert.equal(G.COMPOSTER_NEAR_FARM, 8);
        assert.equal(G.PICK_RANGE, 32);
    });

    test('leaf_litter is a compost item and a block to pick; never seeds, crops or food', () => {
        assert.equal(C.isCompostable('leaf_litter'), true);
        assert.equal(C.compostSource('leaf_litter', { segment_amount: 3 }, false), true, 'without shears');
        for (const name of ['melon_slice', 'pumpkin', 'sugar_cane', 'cactus', 'wheat', 'wheat_seeds', 'bread', 'carrot']) {
            assert.equal(C.isCompostable(name), false, name);
        }
        assert.equal(C.chooseCompostItem([{ name: 'melon_slice', count: 5 }, { name: 'pumpkin', count: 2 }]), null);
    });

    test('boneMealWant, compostInChests, chestsHold, compostSources', () => {
        assert.equal(C.boneMealWant(0), 0);
        assert.equal(C.boneMealWant(3), 6);
        assert.equal(C.boneMealWant(48), 16);
        assert.equal(C.boneMealWant(-2), 0);
        const owner = [{ items: { leaf_litter: 104, lilac: 5, oak_sapling: 5, birch_sapling: 2, wheat_seeds: 52, melon_slice: 3, bone_meal: 1 } },
            { items: { leaf_litter: 6 } }];
        assert.deepEqual(C.compostInChests(owner), [{ name: 'leaf_litter', count: 110 }, { name: 'lilac', count: 5 }, { name: 'oak_sapling', count: 5 },
            { name: 'birch_sapling', count: 2 }]);
        assert.deepEqual(C.compostInChests(null), []);
        assert.equal(C.chestsHold(owner, 'bone_meal'), true);
        assert.equal(C.chestsHold(owner, 'minecraft:bone_meal'), true);
        assert.equal(C.chestsHold(owner, 'bread'), false);
        assert.deepEqual(C.compostSources({ carried: 3, fetched: 64, picked: 10, used: 64 }), { carried: 3, chest: 61, picked: 0 });
        assert.deepEqual(C.compostSources({ carried: 0, fetched: 5, picked: 10, used: 12 }), { carried: 0, chest: 5, picked: 7 });
        assert.deepEqual(C.compostSources(null), { carried: 0, chest: 0, picked: 0 });
    });
});

describe('texts (E2)', () => {
    test('the example of the spec, sentence by sentence', () => {
        const m = { carried: 0, taken: 0, made: 3, compost: { leaf_litter: 21 }, sources: { carried: 0, chest: 21, picked: 0 },
            compostChests: [{ x: 11, y: 67, z: 53 }], used: 3 };
        const text = T.cycleText('farm', [
            T.harvestText({ byCrop: { wheat: 10 }, replanted: 10, unripe: 0 }), T.notRipeText(48), T.boneMealStepText(m), T.ripenedText(9), T.TEXTS.gateClosed,
        ]);
        assert.equal(text, 'Farm "farm": I harvested 10 wheat and planted 10 again. 48 plants are not ripe. I made 3 bone_meal from 21 leaf_litter '
            + 'of the chest at (11, 67, 53) and used them. 9 more plants got ripe and I harvested them. The gate is closed.');
        assert.equal(`${T.TEXTS.nothingToCompostCycle} ${T.growingText(48)}`,
            'I have nothing to compost and the chests I know have nothing. 48 plants are growing. Nothing to do now.');
    });

    test('the bone meal step in every form', () => {
        assert.equal(T.boneMealStepText({ carried: 4, used: 4 }), 'I used 4 bone_meal.');
        assert.equal(T.boneMealStepText({ taken: 4, takenFrom: [{ x: 1, y: 2, z: 3 }], used: 4 }), 'I took 4 bone_meal from the chest at (1, 2, 3) and used them.');
        assert.equal(T.boneMealStepText({ made: 1, compost: { poppy: 7 }, sources: { carried: 0, chest: 0, picked: 7 }, used: 1 }),
            'I made 1 bone_meal from 7 poppy that I picked nearby and used it.');
        assert.equal(T.boneMealStepText({ carried: 2, made: 2, compost: { oak_leaves: 14 }, sources: { carried: 14, chest: 0, picked: 0 }, used: 3 }),
            'I had 2 bone_meal, I made 2 bone_meal from 14 oak_leaves and used 3 of them.');
        assert.equal(T.boneMealStepText({ made: 1, compost: { leaf_litter: 7 }, sources: { carried: 0, chest: 7, picked: 0 },
            compostChests: [{ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }], used: 0 }), 'I made 1 bone_meal from 7 leaf_litter of 2 chests and used none of it.');
        assert.equal(T.boneMealStepText({}), '');
        assert.equal(T.ripenedText(1), '1 more plant got ripe and I harvested it.');
        assert.equal(T.ripenedText(0), 'No plant got ripe yet.');
        assert.equal(T.notRipeText(1), '1 plant is not ripe.');
        assert.equal(T.growingText(1), '1 plant is growing. Nothing to do now.');
        assert.equal(T.compostedText({ leaf_litter: 12 }, { x: 4, y: 64, z: 7 }, 4), 'I put 12 leaf_litter into the composter at (4, 64, 7), it is at level 4 of 7.');
    });

    test('plantText says how many blocks were tilled; the sentence about shears is gone', () => {
        assert.equal(T.plantText({ planted: 12, seed: 'wheat_seeds', tilled: 4 }), 'I tilled 4 blocks and planted 12 wheat_seeds.');
        assert.equal(T.plantText({ planted: 1, seed: 'wheat_seeds', tilled: 1 }), 'I tilled 1 block and planted 1 wheat_seeds.');
        assert.equal(T.plantText({ planted: 12, seed: 'wheat_seeds' }), 'I planted 12 wheat_seeds.');
        assert.equal(T.TEXTS.noShears, undefined);
        assert.ok(!Object.values(T.TEXTS).some(t => /shears/.test(t)));
        assert.equal(T.TEXTS.noComposterFarm, 'I found no composter at the farm or within 32 blocks.');
    });

    test('index.js exports the new names', () => {
        for (const name of ['chooseComposter', 'farmMiddle', 'boneMealWant', 'compostInChests', 'chestsHold', 'compostSources', 'boneMealStepText',
            'ripenedText', 'notRipeText', 'growingText', 'compostedText', 'COMPOSTER_NEAR_FARM', 'PICK_RANGE', 'farmCycle', 'makeBoneMeal']) {
            assert.ok(P[name] !== undefined, `index.js must export ${name}`);
        }
    });
});
