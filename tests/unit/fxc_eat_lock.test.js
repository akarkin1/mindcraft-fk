// v0.1.4.8, fix round, X10 and X12 (DEFECTS_WORLD_0148.md): one lock for eating.
//   X10: `!eat` beside the hunger reflex said "I could not eat: Consuming cancelled due to calling
//        bot.consume() again" while the bot ate. One lock for eating in the home pack (eat_lock.js): while
//        !eat runs, the reflex and auto-eat do not eat; when the reflex or auto-eat is eating as !eat
//        starts, !eat waits for it (at most 4 s) and then goes on; its text counts what the bot ate in all
//        since the command started. skills.consume (!consume) takes the same lock.
//   X12: `!consume` with full food threw "Error: Food is full"; it answers "I am not hungry. Food 20 of 20."
// The fake consume behaves like the one of mineflayer 4.33: a second call cancels the first one with the
// error of X10, and a full food level throws "Food is full".
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { makeFakeBot, give } from './home_fake_bot.test.js';
import { makeBot, registry } from './stb_fake_bot.test.js';

register('../helpers/mcdata_hooks.js', import.meta.url);
const mcdata = await loadSrc('src/utils/mcdata.js');
const skills = await loadSrc('src/agent/library/skills.js');
const L = await loadSrc('src/agent/packs/home/eat_lock.js');
const F = await loadSrc('src/agent/packs/home/food.js');
const H = await loadSrc('src/agent/packs/home/index.js');
mcdata.__setMcdataForTests(registry);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CANCELLED = 'Consuming cancelled due to calling bot.consume() again';
const HUNGER_ON = { settings: { home_pack: true }, now: () => Date.now() };

// bot.consume like mineflayer 4.33 (plugins/inventory.js): a running task is cancelled by the next call,
// a full food level throws, the bite ends after eatMs. The food points of bread: 5.
function mineflayerConsume(bot, eatMs = 40, { food = 'food', take = null } = {}) {
    let pending = null;
    bot.bites = [];
    const equip = bot.equip;
    bot.equip = async (item, dest) => {
        if (pending && item?.name !== bot.heldItem?.name) { // heldItemChanged: the bite ends, nothing is eaten
            const old = pending;
            pending = null;
            old.resolve();
        }
        return equip(item, dest);
    };
    bot.consume = async () => {
        if (pending) {
            const old = pending;
            pending = null;
            old.reject(new Error(CANCELLED));
        }
        if (bot[food] === 20) throw new Error('Food is full');
        const item = bot.heldItem;
        await new Promise((resolve, reject) => {
            const task = { resolve, reject };
            pending = task;
            setTimeout(() => {
                if (pending !== task) return;
                pending = null;
                if (!item || item.count <= 0) return reject(new Error('nothing in the hand'));
                if (take) take(item);
                else item.count -= 1;
                bot[food] = Math.min(20, bot[food] + 5);
                bot.bites.push(item.name);
                resolve();
            }, eatMs);
        });
    };
}

const breadOf = (bot) => bot.inventory.list.filter((i) => i.name === 'bread').reduce((n, i) => n + i.count, 0);

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

describe('X10: the lock for eating (eat_lock.js)', () => {
    test('tryEatLock: one holder at a time; a released lease frees the lock', () => {
        const bot = {};
        const a = L.tryEatLock(bot, 'reflex');
        assert.ok(a && a.held());
        assert.equal(L.eatLockOwner(bot), 'reflex');
        assert.equal(L.tryEatLock(bot, 'reflex'), null, 'held: no second lease');
        a.release();
        a.release(); // twice does no harm
        assert.equal(L.eatLockOwner(bot), null);
        assert.ok(L.tryEatLock(bot, 'reflex'));
    });

    test('tryEatLock refuses while auto-eat eats', () => {
        assert.equal(L.tryEatLock({ autoEat: { isEating: true } }), null);
    });

    test('acquireEatLock waits for the reflex, at most waitMs, then takes the lock over', async () => {
        const bot = {};
        const reflex = L.tryEatLock(bot, 'reflex');
        const t0 = Date.now();
        const cmd = await L.acquireEatLock(bot, 'command', { waitMs: 120 });
        const waited = Date.now() - t0;
        assert.ok(waited >= 100 && waited < 1000, `waited ${waited} ms`);
        assert.equal(L.eatLockOwner(bot), 'command');
        assert.equal(reflex.held(), false, 'the reflex lost the lock');
        reflex.release(); // the late release of the reflex does not free the lock of the command
        assert.equal(L.eatLockOwner(bot), 'command');
        cmd.release();
        assert.equal(L.eatLockOwner(bot), null);
    });

    test('acquireEatLock goes on as soon as the reflex releases', async () => {
        const bot = {};
        const reflex = L.tryEatLock(bot, 'reflex');
        setTimeout(() => reflex.release(), 60);
        const t0 = Date.now();
        const cmd = await L.acquireEatLock(bot, 'command', { waitMs: 4000 });
        assert.ok(Date.now() - t0 < 1000);
        assert.ok(cmd.held());
        cmd.release();
    });

    test('the default wait is 4 s (the decision of X10)', () => {
        assert.equal(L.EAT_LOCK_WAIT_MS, 4000);
        assert.equal(H.EAT_LOCK_WAIT_MS, 4000, 'exported by the home pack');
        assert.equal(typeof H.acquireEatLock, 'function');
    });

    test('a command pauses auto-eat, waits while it eats, and switches it on again; an auto-eat the owner switched off stays off', async () => {
        const bot = { autoEat: { disabled: false, isEating: true } };
        setTimeout(() => { bot.autoEat.isEating = false; }, 60);
        const t0 = Date.now();
        const lease = await L.acquireEatLock(bot, 'command');
        assert.ok(Date.now() - t0 >= 40, 'waited for auto-eat');
        assert.equal(bot.autoEat.disabled, true);
        lease.release();
        assert.equal(bot.autoEat.disabled, false);
        const off = { autoEat: { disabled: true, isEating: false } };
        const l2 = await L.acquireEatLock(off, 'command');
        l2.release();
        assert.equal(off.autoEat.disabled, true);
    });

    test('pauses of auto-eat nest', () => {
        const bot = { autoEat: { disabled: false } };
        const a = L.pauseAutoEat(bot);
        const b = L.pauseAutoEat(bot);
        a();
        assert.equal(bot.autoEat.disabled, true);
        b();
        assert.equal(bot.autoEat.disabled, false);
    });

    test('never throws', async () => {
        assert.equal(L.tryEatLock(null), null);
        assert.equal(L.eatLockOwner(undefined), null);
        const lease = await L.acquireEatLock(null);
        assert.equal(lease.held(), false);
        lease.release();
        assert.equal(typeof L.pauseAutoEat(null), 'function');
    });
});

describe('X10: !eat beside the hunger reflex (eatBestFood and hungerStep)', () => {
    test('the reflex eats as !eat starts: !eat waits and its text counts all bread eaten, no "Consuming cancelled"', async () => {
        const bot = makeFakeBot();
        bot.food = 6;
        give(bot, 'bread', 5);
        mineflayerConsume(bot, 60);
        const reflex = F.hungerStep(bot, HUNGER_ON, { now: Date.now(), idle: false, playerOrder: false });
        await sleep(20); // the first bite of the reflex runs
        assert.equal(L.eatLockOwner(bot), 'reflex');
        assert.equal(breadOf(bot), 5, 'nothing eaten yet as the command starts');
        const cmd = await F.eatBestFood(bot, {}, {});
        await reflex;
        const eaten = 5 - breadOf(bot);
        assert.ok(eaten >= 3, `ate ${eaten}`);
        assert.equal(cmd.text, `I ate ${eaten} bread. Food 20 of 20, health 20 of 20.`);
        assert.equal(cmd.ok, true);
        assert.equal(cmd.ate, eaten);
        assert.equal(bot.food, 20);
        assert.equal(L.eatLockOwner(bot), null);
    });

    test('a slow reflex: after the wait !eat takes over, the reflex stops, !eat eats on; the text counts both', async () => {
        const bot = makeFakeBot();
        bot.food = 1;
        give(bot, 'bread', 6);
        bot.heldItem = give(bot, 'stone_sword', 1); // the reflex puts it back into the hand when it ends
        mineflayerConsume(bot, 150);
        const reflex = F.hungerStep(bot, HUNGER_ON, { now: Date.now(), idle: false, playerOrder: false });
        await sleep(200); // the reflex ate one bread and bites the second
        const atStart = breadOf(bot);
        assert.equal(atStart, 5);
        const cmd = await F.eatBestFood(bot, {}, { waitMs: 100 });
        const r = await reflex;
        const eaten = atStart - breadOf(bot); // since the command started
        assert.doesNotMatch(cmd.text, /could not eat/);
        assert.equal(bot.calls.filter((c) => c[0] === 'equip' && c[1] === 'stone_sword').length, 0, 'the reflex that lost the lock left the hand alone');
        assert.equal(cmd.text, `I ate ${eaten} bread. Food 20 of 20, health 20 of 20.`);
        assert.ok(bot.food >= 18);
        assert.equal(r.action, 'eat');
    });

    test('while !eat holds the lock the reflex does not eat', async () => {
        const bot = makeFakeBot();
        bot.food = 6;
        give(bot, 'bread', 5);
        mineflayerConsume(bot, 10);
        const lease = await L.acquireEatLock(bot, 'command');
        const r = await F.hungerStep(bot, HUNGER_ON, { now: Date.now(), idle: false, playerOrder: false });
        lease.release();
        assert.equal(r.action, 'eat');
        assert.equal(r.result.reason, 'busy');
        assert.deepEqual(bot.bites, []);
        assert.equal(bot.food, 6);
    });

    test('!eat with auto-eat eating: waits for it, pauses it while it eats, switches it on again', async () => {
        const bot = makeFakeBot();
        bot.food = 10;
        give(bot, 'bread', 3);
        mineflayerConsume(bot, 10);
        bot.autoEat = { disabled: false, isEating: true };
        const seen = [];
        const inner = bot.consume;
        bot.consume = async () => { seen.push(bot.autoEat.disabled); return inner(); };
        setTimeout(() => { bot.autoEat.isEating = false; }, 80);
        const res = await F.eatBestFood(bot, {}, {});
        assert.equal(res.text, 'I ate 2 bread. Food 20 of 20, health 20 of 20.');
        assert.deepEqual([...new Set(seen)], [true]);
        assert.equal(bot.autoEat.disabled, false);
    });

    test('the slot update of a bite ends the next bite early (real server: "I ate 5 bread" for 3): the text counts the bread that went', async () => {
        const bot = makeFakeBot();
        bot.food = 6;
        const loaf = give(bot, 'bread', 5);
        let pending = null;
        bot.consume = async () => {
            if (pending) { const old = pending; pending = null; old.reject(new Error(CANCELLED)); }
            if (bot.food === 20) throw new Error('Food is full');
            await new Promise((resolve, reject) => {
                const task = { resolve, reject };
                pending = task;
                setTimeout(() => {
                    if (pending !== task) return;
                    pending = null;
                    bot.food = Math.min(20, bot.food + 5); // the food level comes first ...
                    resolve();
                    setTimeout(() => { // ... the slot 30 ms later; mineflayer ends a running bite on it
                        loaf.count -= 1;
                        if (pending) { const next = pending; pending = null; next.resolve(); }
                    }, 30);
                }, 20);
            });
        };
        const res = await F.eatBestFood(bot, {}, {});
        assert.equal(5 - loaf.count, 3);
        assert.equal(res.text, 'I ate 3 bread. Food 20 of 20, health 20 of 20.');
        assert.equal(res.ate, 3);
    });

    test('food it picked up and ate counts', async () => {
        const bot = makeFakeBot();
        bot.food = 12;
        const loaf = { id: 900, name: 'item', type: 'object', position: bot.entity.position.offset(2, 0, 0), velocity: bot.entity.velocity, metadata: {}, isValid: true, getDroppedItem: () => ({ name: 'bread' }) };
        bot.entities[900] = loaf;
        const inner = bot.gotoImpl;
        bot.gotoImpl = async (goal) => { await inner(goal); if (bot.entities[900]) { delete bot.entities[900]; give(bot, 'bread', 1); } };
        mineflayerConsume(bot, 10);
        const res = await F.eatBestFood(bot, {}, {});
        assert.equal(res.text, 'I ate 1 bread. Food 17 of 20, health 20 of 20.');
    });

    test('the text of !eat when only the reflex ate during the wait: what it ate, not "I am not hungry"', async () => {
        const bot = makeFakeBot();
        bot.food = 14;
        give(bot, 'bread', 2);
        mineflayerConsume(bot, 30);
        const reflex = F.hungerStep(bot, HUNGER_ON, { now: Date.now(), idle: false, playerOrder: false });
        await sleep(5);
        const cmd = await F.eatBestFood(bot, {}, {});
        await reflex;
        assert.equal(cmd.text, 'I ate 1 bread. Food 19 of 20, health 20 of 20.');
    });
});

describe('X10 and X12: skills.consume (!consume)', () => {
    function eater(food, name = 'bread', count = 3) {
        const bot = makeBot();
        bot.food = food;
        bot.inventory.put(name, count);
        mineflayerConsume(bot, 30, { take: (item) => bot.inventory.take(item.slot, 1) });
        return bot;
    }

    test('X12: with full food it answers "I am not hungry. Food 20 of 20." and throws nothing', async () => {
        const bot = eater(20);
        assert.equal(await skills.consume(bot, 'bread'), false);
        assert.equal(bot.output, 'I am not hungry. Food 20 of 20.\n');
        assert.equal(bot.inventory.findInventoryItem('bread').count, 3);
    });

    test('with food below 20 it eats: "Consumed bread.", true', async () => {
        const bot = eater(12);
        assert.equal(await skills.consume(bot, 'bread'), true);
        assert.equal(bot.output, 'Consumed bread.\n');
        assert.equal(bot.food, 17);
    });

    test('X10: it takes the lock of the home pack: it waits while the reflex eats, the reflex does not eat while it runs', async () => {
        const bot = eater(12);
        const reflex = L.tryEatLock(bot, 'reflex');
        setTimeout(() => reflex.release(), 80);
        const t0 = Date.now();
        let ownerDuring = null;
        const inner = bot.consume;
        bot.consume = async () => { ownerDuring = L.eatLockOwner(bot); return inner(); };
        assert.equal(await skills.consume(bot, 'bread'), true);
        assert.ok(Date.now() - t0 >= 60, 'waited for the reflex');
        assert.equal(ownerDuring, 'command');
        assert.equal(L.eatLockOwner(bot), null, 'released');
    });

    test('X10: auto-eat is paused while it eats and on again afterwards', async () => {
        const bot = eater(12);
        bot.autoEat = { disabled: false, isEating: false };
        let during = null;
        const inner = bot.consume;
        bot.consume = async () => { during = bot.autoEat.disabled; return inner(); };
        await skills.consume(bot, 'bread');
        assert.equal(during, true);
        assert.equal(bot.autoEat.disabled, false);
    });

    test('an error while eating is a text, not an exception, and the lock is released', async () => {
        const bot = eater(12);
        bot.consume = async () => { throw new Error(CANCELLED); };
        assert.equal(await skills.consume(bot, 'bread'), false);
        assert.equal(bot.output, `I could not eat the bread: ${CANCELLED}\n`);
        assert.equal(L.eatLockOwner(bot), null);
    });

    test('without the item: the text of v0.1.4.7', async () => {
        const bot = eater(12);
        assert.equal(await skills.consume(bot, 'apple'), false);
        assert.equal(bot.output, 'You do not have any apple to eat.\n');
    });
});
