// Spec v0.1.4.8, part C (C1, C2, I7): src/agent/packs/home/food.js on a fake bot with a real slot
// inventory: the off-hand (slot 45), !eat, the food of the known chests, and hungerStep of the mode
// hunger (part A calls it every 2 s with state.now, state.idle, state.playerOrder and state.walk).
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { makeFakeBot, REGISTRY } from './home_fake_bot.test.js';

const F = await loadSrc('src/agent/packs/home/food.js');
const CI = await loadSrc('src/agent/packs/storage/chest_index.js');

const QUICK = { wait: () => new Promise(r => setTimeout(r, 1)) };
const ON = { home_pack: true };
const MIN = 60 * 1000;

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

// A fake bot whose inventory has the 46 slots of mineflayer: items() lists 9 to 44, not the off-hand 45.
function slotBot({ food = 20, health = 20, stacks = {}, pos = [0.5, 64, 0.5] } = {}) {
    const bot = makeFakeBot({ pos });
    bot.food = food;
    bot.health = health;
    const slots = new Array(46).fill(null);
    const put = (slot, name, count) => {
        slots[slot] = { name, count, slot, type: REGISTRY.itemsByName[name]?.id ?? 0 };
        return slots[slot];
    };
    for (const [slot, [name, count]] of Object.entries(stacks)) {
        put(Number(slot), name, count);
    }
    const clean = () => {
        for (let i = 0; i < slots.length; i++) {
            if (slots[i] && slots[i].count <= 0) slots[i] = null;
        }
    };
    bot.inventory = {
        slots,
        items() { clean(); return slots.slice(9, 45).filter(Boolean); },
        firstEmptyInventorySlot() {
            for (let i = 36; i <= 44; i++) if (!slots[i]) return i;
            for (let i = 9; i <= 35; i++) if (!slots[i]) return i;
            return null;
        },
    };
    bot.moveSlotItem = async (from, to) => {
        bot.calls.push(['move', from, to]);
        slots[to] = slots[from];
        if (slots[to]) slots[to].slot = to;
        slots[from] = null;
    };
    bot.equip = async (item, dest) => {
        bot.calls.push(['equip', item?.name, dest]);
        if (item.slot === 45) { // mineflayer moves it to the quick bar first
            const to = bot.inventory.firstEmptyInventorySlot();
            await bot.moveSlotItem(45, to);
        }
        bot.heldItem = item;
    };
    bot.put = put;
    return bot;
}

function chestIndex(chests) {
    const index = new CI.ChestIndex(null);
    for (const c of chests) index.update({ kind: 'chest', dimension: 'overworld', free_slots: 5, ...c });
    return index;
}

describe('I7: foodItems sees the off-hand', () => {
    test('the play test: "apple: 1" in the off-hand is food the bot carries', () => {
        const bot = slotBot({ stacks: { 45: ['apple', 1], 36: ['stone_pickaxe', 1] } });
        assert.deepEqual(bot.inventory.items().map(i => i.name), ['stone_pickaxe'], 'items() does not list slot 45');
        assert.deepEqual(F.foodItems(bot).map(i => [i.name, i.slot]), [['apple', 45]]);
    });

    test('banned food is left out, with { all: true } it is in the list; no food: []', () => {
        const bot = slotBot({ stacks: { 9: ['rotten_flesh', 4], 10: ['bread', 2], 45: ['spider_eye', 1] } });
        assert.deepEqual(F.foodItems(bot).map(i => i.name), ['bread']);
        assert.deepEqual(F.foodItems(bot, { all: true }).map(i => i.name).sort(), ['bread', 'rotten_flesh', 'spider_eye']);
        assert.deepEqual(F.foodItems(slotBot()), []);
        assert.deepEqual(F.foodItems(null), []);
    });

    test('a bot without slots (the fake of v0.1.4.6) and one whose items() lists slot 45 too: each stack once', () => {
        const plain = makeFakeBot();
        plain.inventory.list.push({ name: 'bread', count: 3 });
        assert.deepEqual(F.foodItems(plain).map(i => i.name), ['bread']);
        const bot = slotBot({ stacks: { 45: ['bread', 6] } });
        bot.inventory.items = () => bot.inventory.slots.filter(Boolean);
        assert.equal(F.foodItems(bot).length, 1);
    });
});

describe('I7: moveOffhandBack', () => {
    test('moves the food of slot 45 into the inventory and says so', async () => {
        const bot = slotBot({ stacks: { 45: ['bread', 6] } });
        const res = await F.moveOffhandBack(bot);
        assert.deepEqual(res, { ok: true, moved: 6, text: 'I moved 6 bread from my off-hand into my inventory.' });
        assert.equal(bot.inventory.slots[45], null);
        assert.equal(bot.inventory.slots[36].name, 'bread');
    });

    test('no food in the off-hand: nothing moves', async () => {
        const shield = slotBot({ stacks: { 45: ['shield', 1] } });
        assert.deepEqual(await F.moveOffhandBack(shield), { ok: true, moved: 0, text: 'My off-hand holds shield. That is no food, I leave it there.' });
        assert.equal(shield.inventory.slots[45].name, 'shield');
        assert.deepEqual(await F.moveOffhandBack(slotBot()), { ok: true, moved: 0, text: 'My off-hand is empty.' });
    });

    test('a full inventory: the food stays, nothing is dropped', async () => {
        const stacks = { 45: ['apple', 3] };
        for (let i = 9; i <= 44; i++) stacks[i] = ['cobblestone', 64];
        const bot = slotBot({ stacks });
        const res = await F.moveOffhandBack(bot);
        assert.deepEqual(res, { ok: false, moved: 0, text: 'My inventory is full. The apple stays in my off-hand.' });
        assert.equal(bot.calls.some(c => c[0] === 'move'), false);
    });

    test('the move is checked: a slot that stays full is no success', async () => {
        const bot = slotBot({ stacks: { 45: ['apple', 3] } });
        bot.moveSlotItem = async () => {};
        assert.deepEqual(await F.moveOffhandBack(bot), { ok: false, moved: 0, text: 'I could not move the apple out of my off-hand.' });
        assert.equal((await F.moveOffhandBack(null)).ok, true, 'no bot: nothing in the off-hand, no throw');
    });
});

describe('I7: knownFood', () => {
    test('the food of the chest index, banned food left out, the nearest chest first', () => {
        const index = chestIndex([
            { x: 11, y: 67, z: 53, items: { apple: 5, rotten_flesh: 20 } },
            { x: 2, y: 64, z: 2, items: { bread: 3, cobblestone: 64 } },
        ]);
        const known = F.knownFood({ chests: index }, { from: { x: 0, y: 64, z: 0 }, dimension: 'overworld' });
        assert.deepEqual(known, [
            { name: 'bread', count: 3, chest: { x: 2, y: 64, z: 2 } },
            { name: 'apple', count: 5, chest: { x: 11, y: 67, z: 53 } },
        ]);
        assert.deepEqual(F.knownFood({ chests: index }, { dimension: 'the_nether' }), []);
    });

    test('no chest index, a failing one: []', () => {
        assert.deepEqual(F.knownFood({}), []);
        assert.deepEqual(F.knownFood(null), []);
        assert.deepEqual(F.knownFood({ chests: { list() { throw new Error('disk'); } } }), []);
    });
});

describe('C1: !eat (eatBestFood)', () => {
    test('the play test: the apple in the off-hand is eaten', async () => {
        const bot = slotBot({ food: 10, stacks: { 45: ['apple', 1] } });
        const res = await F.eatBestFood(bot, {}, QUICK);
        assert.deepEqual(res, { ok: true, ate: 1, reason: null, text: 'I ate 1 apple. Food 14 of 20, health 20 of 20.' });
    });

    test('eats until 18; hurt, until 20 while it has food', async () => {
        const fed = slotBot({ food: 12, stacks: { 36: ['bread', 9] } });
        assert.equal((await F.eatBestFood(fed, {}, QUICK)).text, 'I ate 2 bread. Food 20 of 20, health 20 of 20.');
        const hurt = slotBot({ food: 17, health: 12, stacks: { 36: ['bread', 9] } });
        assert.equal((await F.eatBestFood(hurt, {}, QUICK)).text, 'I ate 1 bread. Food 20 of 20, health 12 of 20.');
        const little = slotBot({ food: 13, health: 12, stacks: { 36: ['cookie', 1] } });
        assert.equal((await F.eatBestFood(little, {}, QUICK)).text, 'I ate 1 cookie. Food 15 of 20, health 12 of 20.', 'until the food is used up');
    });

    test('not hungry: food 18 and unhurt, or food 20', async () => {
        assert.equal((await F.eatBestFood(slotBot({ food: 19, stacks: { 36: ['bread', 1] } }), {}, QUICK)).text,
            'I am not hungry. Food 19 of 20, health 20 of 20.');
        assert.equal((await F.eatBestFood(slotBot({ food: 20, health: 9, stacks: { 36: ['bread', 1] } }), {}, QUICK)).text,
            'I am not hungry. Food 20 of 20, health 9 of 20.');
    });

    test('no food: the known chest with food, or none', async () => {
        const index = chestIndex([{ x: 11, y: 67, z: 53, items: { apple: 5 } }]);
        const bot = slotBot({ food: 8, stacks: { 36: ['rotten_flesh', 3] } });
        assert.deepEqual(await F.eatBestFood(bot, { chests: index }, QUICK),
            { ok: false, ate: 0, reason: 'no_food', text: 'I carry no food. The chest at (11, 67, 53) has 5 apple.' });
        assert.equal((await F.eatBestFood(bot, { chests: chestIndex([{ x: 1, y: 64, z: 1, items: { spider_eye: 4 } }]) }, QUICK)).text,
            'I carry no food and know no chest with food.');
    });
});

// ---------------------------------------------------------------- the hunger reflex

function reflexScene({ food = 20, health = 20, stacks = {}, chests = null, settings = ON } = {}) {
    const bot = slotBot({ food, health, stacks });
    const said = [];
    const fetched = [];
    const ctx = { settings, log: () => {}, now: () => Date.now(), say: t => said.push(t) };
    if (chests) {
        ctx.chests = chestIndex(chests);
        ctx.storage = {
            async fetchItem(name, count) {
                fetched.push([name, count]);
                const free = bot.inventory.firstEmptyInventorySlot();
                bot.put(free, name, count);
                return { ok: true, taken: count, reason: null, text: `I took ${count} ${name}.` };
            },
        };
    }
    const walks = [];
    const state = { now: 100 * MIN, idle: true, playerOrder: false, walk: async (fn) => { walks.push(fn); await fn(); return true; } };
    return { bot, ctx, said, fetched, walks, state };
}

describe('C2: hungerStep, the switches', () => {
    test('home_pack off, or home_reflexes.hunger false: nothing at all', async () => {
        for (const settings of [{}, { home_pack: false }, { home_pack: true, home_reflexes: { hunger: false } }]) {
            const s = reflexScene({ food: 2, settings, chests: [{ x: 1, y: 64, z: 1, items: { bread: 9 } }] });
            const res = await F.hungerStep(s.bot, s.ctx, s.state);
            assert.equal(res.action, 'none', JSON.stringify(settings));
            assert.equal(res.reason, 'off');
            assert.deepEqual([s.said, s.fetched, s.walks.length], [[], [], 0]);
        }
    });

    test('never throws', async () => {
        assert.equal((await F.hungerStep(null, { settings: ON }, {})).action, 'none');
        assert.equal((await F.hungerStep({ food: 5 }, { settings: ON, get storage() { throw new Error('x'); } }, null)).action, 'none');
    });
});

describe('C2: hungerStep, eat', () => {
    test('carries food at 12: eats beside the action, no walk, the item of the hand comes back', async () => {
        const s = reflexScene({ food: 12, stacks: { 36: ['iron_pickaxe', 1], 37: ['bread', 5] } });
        s.bot.heldItem = s.bot.inventory.slots[36];
        s.state.idle = false;
        const res = await F.hungerStep(s.bot, s.ctx, s.state);
        assert.equal(res.action, 'eat');
        assert.equal(res.result.ate, 2);
        assert.ok(s.bot.food >= 18);
        assert.equal(s.bot.heldItem.name, 'iron_pickaxe');
        assert.equal(s.walks.length, 0);
        assert.equal(s.bot.calls.some(c => c[0] === 'goto'), false);
        assert.deepEqual(s.said, [], 'eating says nothing');
    });

    test('food 16 and hurt: eats up to 20', async () => {
        const s = reflexScene({ food: 16, health: 11, stacks: { 36: ['bread', 5] } });
        await F.hungerStep(s.bot, s.ctx, s.state);
        assert.equal(s.bot.food, 20);
    });

    test('food in the off-hand counts as carried', async () => {
        const s = reflexScene({ food: 10, stacks: { 45: ['bread', 5] } });
        const res = await F.hungerStep(s.bot, s.ctx, s.state);
        assert.equal(res.action, 'eat');
        assert.ok(s.bot.food >= 18);
    });

    test('auto-eat is eating, or the bot digs (not starving): this step waits', async () => {
        const s = reflexScene({ food: 12, stacks: { 36: ['bread', 5] } });
        s.bot.autoEat = { isEating: true, disabled: false };
        assert.equal((await F.hungerStep(s.bot, s.ctx, s.state)).result.reason, 'auto_eat');
        const d = reflexScene({ food: 12, stacks: { 36: ['bread', 5] } });
        d.bot.targetDigBlock = { name: 'stone' };
        assert.equal((await F.hungerStep(d.bot, d.ctx, d.state)).result.reason, 'busy');
        assert.equal(d.bot.food, 12);
    });
});

describe('C2: hungerStep, fetch', () => {
    const CHESTS = [{ x: 3, y: 64, z: 3, items: { bread: 20, cooked_beef: 2, rotten_flesh: 30 } }];

    test('idle, food 8, no food carried, beef and bread known: fetches the best food through state.walk and eats', async () => {
        const s = reflexScene({ food: 8, chests: CHESTS });
        const res = await F.hungerStep(s.bot, s.ctx, s.state);
        assert.equal(res.action, 'fetch');
        assert.equal(s.walks.length, 1, 'the fetch ran as the mode action');
        assert.deepEqual(s.fetched, [['cooked_beef', 2]], 'the most food points; not more than the chests hold');
        assert.ok(s.bot.food >= 18, `food ${s.bot.food}`);
        assert.equal(res.result.taken, 2);
    });

    test('food 2, busy without an order of the player: fetches too; with an order of the player: the text of hunger', async () => {
        const busy = reflexScene({ food: 2, chests: CHESTS });
        busy.state.idle = false;
        assert.equal((await F.hungerStep(busy.bot, busy.ctx, busy.state)).action, 'fetch');
        assert.equal(busy.fetched.length, 1);
        const ordered = reflexScene({ food: 2, chests: CHESTS });
        Object.assign(ordered.state, { idle: false, playerOrder: true });
        await F.hungerStep(ordered.bot, ordered.ctx, ordered.state);
        assert.deepEqual(ordered.said, ['I am hungry and carry no food. Food 2 of 20.']);
        assert.equal(ordered.fetched.length, 0);
    });

    test('without state.walk nothing is fetched; a walk refused by a higher mode runs nothing', async () => {
        const s = reflexScene({ food: 8, chests: CHESTS });
        delete s.state.walk;
        const res = await F.hungerStep(s.bot, s.ctx, s.state);
        assert.equal(res.result.reason, 'no_walk');
        assert.equal(s.fetched.length, 0);
        const r = reflexScene({ food: 8, chests: CHESTS });
        r.state.walk = async () => false;
        assert.equal((await F.hungerStep(r.bot, r.ctx, r.state)).result.reason, 'busy');
        assert.equal(r.fetched.length, 0);
    });

    test('a fetch that brings nothing: no new fetch for 60 s, the text of hunger instead', async () => {
        const s = reflexScene({ food: 8, chests: CHESTS });
        s.ctx.storage.fetchItem = async (name, count) => {
            s.fetched.push([name, count]);
            return { ok: false, taken: 0, reason: 'unreachable', text: 'I could not reach the chest at (3, 64, 3).' };
        };
        await F.hungerStep(s.bot, s.ctx, s.state);
        assert.equal(s.fetched.length, 1);
        s.state.now += 30 * 1000;
        const second = await F.hungerStep(s.bot, s.ctx, s.state);
        assert.equal(second.action, 'say');
        assert.deepEqual(s.said, ['I am hungry and carry no food. Food 8 of 20.']);
        s.state.now += 31 * 1000;
        assert.equal((await F.hungerStep(s.bot, s.ctx, s.state)).action, 'fetch', 'after 60 s it tries again');
    });

    test('without the storage pack (no ctx.storage) the chests are not used', async () => {
        const s = reflexScene({ food: 8, chests: CHESTS });
        delete s.ctx.storage;
        assert.equal((await F.hungerStep(s.bot, s.ctx, s.state)).action, 'say');
    });
});

describe('C2: hungerStep, the texts go to ctx.say without a call of the model', () => {
    test('hungry: once per 5 minutes', async () => {
        const s = reflexScene({ food: 9 });
        s.state.idle = false;
        await F.hungerStep(s.bot, s.ctx, s.state);
        s.state.now += 4 * MIN;
        await F.hungerStep(s.bot, s.ctx, s.state);
        assert.deepEqual(s.said, ['I am hungry and carry no food. Food 9 of 20.']);
        s.state.now += MIN;
        await F.hungerStep(s.bot, s.ctx, s.state);
        assert.equal(s.said.length, 2);
    });

    test('starving: once per 2 minutes', async () => {
        const s = reflexScene({ food: 1 });
        await F.hungerStep(s.bot, s.ctx, s.state);
        s.state.now += 60 * 1000;
        await F.hungerStep(s.bot, s.ctx, s.state);
        s.state.now += 61 * 1000;
        await F.hungerStep(s.bot, s.ctx, s.state);
        assert.deepEqual(s.said, ['I am starving. I have no food and know no chest with food.', 'I am starving. I have no food and know no chest with food.']);
    });

    test('without ctx.say: into the behaviour log of the modes and to the console', async () => {
        const s = reflexScene({ food: 1 });
        delete s.ctx.say;
        s.bot.modes.behavior_log = '';
        await F.hungerStep(s.bot, s.ctx, s.state);
        assert.equal(s.bot.modes.behavior_log, 'I am starving. I have no food and know no chest with food.\n');
        assert.ok(cap.allText().includes('I am starving.'));
    });

    test('fed: nothing', async () => {
        const s = reflexScene({ food: 15 });
        const res = await F.hungerStep(s.bot, s.ctx, s.state);
        assert.deepEqual({ action: res.action, said: s.said }, { action: 'none', said: [] });
    });
});
