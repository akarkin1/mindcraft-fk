// T1, spec v0.1.4.8 section 8 (part C) and the interfaces I7, I8: the home pack on a fake bot
// (tests/helpers/st_modes_env.js), tested from the spec and the handoff:
//   I7 / C1 food in slot 45 is found, eaten and moved back; !eat eats until 18, hurt until 20; the texts;
//      the food of the known chests (the owner's chest held only banned food);
//   C2 hungerStep: off with home_reflexes.hunger false; the text goes through ctx.say; a fetch only
//      through state.walk;
//   C3 creeperCheck on the real surroundings: the creeper above the bot at y 25 with rock between does
//      not count; the creeper 8 blocks away in the same tunnel counts; one behind rock does not;
//   C4 no home: nothing happens and the text; I8 / C5 the door service: tick() is synchronous and closes
//      what the bot opened and passed, closeNear(6) and its texts; C6 sleep by day, unstuck paused first.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { makeFakeBot, mobEntity } from '../helpers/st_modes_env.js';

const home = await loadSrc('src/agent/packs/home/index.js');

const LIMIT = { timeout: 20000 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SETTINGS = { home_pack: true };

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

function chestsOf(list) {
    return { list: () => list };
}

// ----------------------------------------------------------------------------------- I7, C1

describe('I7: food of the bot and of the chests', () => {
    test('foodItems: all food the bot carries, the off-hand included; banned food left out (handoff)', () => {
        const bot = makeFakeBot();
        bot.inventory.put('bread', 3, 12);
        bot.inventory.put('apple', 1, 45);
        bot.inventory.put('rotten_flesh', 5, 13);
        bot.inventory.put('cobblestone', 20, 14);
        assert.deepEqual(home.foodItems(bot).map((i) => i.name).sort(), ['apple', 'bread']);
        assert.deepEqual(home.foodItems(bot, { all: true }).map((i) => i.name).sort(), ['apple', 'bread', 'rotten_flesh']);
    });

    test('moveOffhandBack moves a food item of slot 45 into the inventory: { ok, moved, text }', LIMIT, async () => {
        const bot = makeFakeBot();
        bot.inventory.put('bread', 6, 45);
        const r = await home.moveOffhandBack(bot);
        assert.equal(r.ok, true);
        assert.equal(r.moved, 6);
        assert.equal(typeof r.text, 'string');
        assert.equal(bot.inventory.slots[45], null);
        assert.equal(bot.inventory.findInventoryItem('bread')?.count, 6);
    });

    test('moveOffhandBack leaves what is no food (a shield) in the off-hand', LIMIT, async () => {
        const bot = makeFakeBot();
        bot.inventory.put('shield', 1, 45);
        const r = await home.moveOffhandBack(bot);
        assert.equal(r.moved, 0);
        assert.equal(bot.inventory.slots[45]?.name, 'shield');
    });

    test('knownFood(ctx): [{ name, count, chest }] from the chest index, banned food left out', () => {
        const ctx = { chests: chestsOf([
            { x: 11, y: 67, z: 53, dimension: 'overworld', items: { apple: 5, rotten_flesh: 1, spider_eye: 3, cobblestone: 81 } },
            { x: 11, y: 41, z: 44, dimension: 'overworld', items: {} },
        ]) };
        assert.deepEqual(home.knownFood(ctx), [{ name: 'apple', count: 5, chest: { x: 11, y: 67, z: 53 } }]);
        assert.deepEqual(home.knownFood({}), [], 'without an index');
    });
});

describe('C1: !eat', () => {
    test('play test E1: 2 bread in slot 45, hurt: it eats them: "I ate 2 bread. Food 19 of 20, health 12 of 20."', LIMIT, async () => {
        const bot = makeFakeBot();
        bot.inventory.put('bread', 2, 45);
        bot.food = 9;
        bot.health = 12;
        const r = await home.eatBestFood(bot, { settings: SETTINGS, chests: chestsOf([]) });
        assert.equal(r.ok, true);
        assert.equal(r.text, 'I ate 2 bread. Food 19 of 20, health 12 of 20.');
    });

    test('not hurt: it eats until the food level is 18 or more', LIMIT, async () => {
        const bot = makeFakeBot();
        bot.inventory.put('bread', 10, 12);
        bot.food = 9;
        const r = await home.eatBestFood(bot, { settings: SETTINGS });
        assert.equal(r.text, 'I ate 2 bread. Food 19 of 20, health 20 of 20.');
    });

    test('hurt: it eats until 20 while it has food', LIMIT, async () => {
        const bot = makeFakeBot();
        bot.inventory.put('bread', 10, 12);
        bot.food = 9;
        bot.health = 15;
        const r = await home.eatBestFood(bot, { settings: SETTINGS });
        assert.equal(r.text, 'I ate 3 bread. Food 20 of 20, health 15 of 20.');
    });

    test('"I am not hungry. Food 19 of 20, health 20 of 20."', LIMIT, async () => {
        const bot = makeFakeBot();
        bot.inventory.put('bread', 10, 12);
        bot.food = 19;
        const r = await home.eatBestFood(bot, { settings: SETTINGS });
        assert.equal(r.text, 'I am not hungry. Food 19 of 20, health 20 of 20.');
        assert.ok(!bot.calls.some((c) => c[0] === 'consume'));
    });

    test('food 18, hurt: it eats (E4: !eat read only hunger, never health)', LIMIT, async () => {
        const bot = makeFakeBot();
        bot.inventory.put('bread', 10, 12);
        bot.food = 18;
        bot.health = 12;
        const r = await home.eatBestFood(bot, { settings: SETTINGS });
        assert.equal(r.text, 'I ate 1 bread. Food 20 of 20, health 12 of 20.');
    });

    test('no food: "I carry no food. The chest at (11, 67, 53) has 5 apple."', LIMIT, async () => {
        const bot = makeFakeBot({ pos: [12.5, 67, 52.5] });
        bot.food = 6;
        const r = await home.eatBestFood(bot, { settings: SETTINGS, chests: chestsOf([{ x: 11, y: 67, z: 53, dimension: 'overworld', items: { apple: 5, cobblestone: 81 } }]) });
        assert.equal(r.text, 'I carry no food. The chest at (11, 67, 53) has 5 apple.');
    });

    test('play test E3: no food and the chest holds only rotten flesh and spider eyes: "I carry no food and know no chest with food."', LIMIT, async () => {
        const bot = makeFakeBot({ pos: [12.5, 67, 52.5] });
        bot.food = 6;
        bot.inventory.put('rotten_flesh', 3, 12);
        const r = await home.eatBestFood(bot, { settings: SETTINGS, chests: chestsOf([{ x: 11, y: 67, z: 53, dimension: 'overworld', items: { rotten_flesh: 1, spider_eye: 3 } }]) });
        assert.equal(r.text, 'I carry no food and know no chest with food.');
        assert.ok(!bot.calls.some((c) => c[0] === 'consume'), 'the bot never eats banned food by itself');
    });
});

// ------------------------------------------------------------------------------------------ I6

describe('I6: a pack function of the home pack that was stopped', () => {
    // I6: "A pack function that was interrupted still returns { ok: false, reason: 'interrupted', text },
    // and text says what was done."
    // Finding T1-2 of round 1 (a stopped !eat had no reason and could say ok): corrected by the tech lead.
    test('!eat stopped after the first bread: { ok: false, reason: "interrupted", text } and the text names the bread', LIMIT, async () => {
        const bot = makeFakeBot();
        bot.inventory.put('bread', 3, 12);
        bot.food = 5;
        const consume = bot.consume;
        bot.consume = async () => { await consume(); bot.interrupt_code = true; }; // !stop comes during the first bite
        const r = await home.eatBestFood(bot, { settings: SETTINGS });
        assert.ok(r.text.includes('I ate 1 bread'), r.text);
        assert.equal(r.ok, false, 'ok');
        assert.equal(r.reason, 'interrupted', 'reason');
    });

    test('!closeDoor stopped: { ok: false, reason: "interrupted", text }', LIMIT, async () => {
        const w = createBlockWorld().flatGround(63);
        w.set(2, 64, 0, 'oak_door', { half: 'lower', open: true, facing: 'east' });
        w.set(0, 64, 3, 'oak_fence_gate', { open: true, facing: 'south' });
        const bot = makeFakeBot({ world: w, pos: [0.5, 64, 0.5] });
        bot.activateBlock = async (block) => {
            const p = block.position;
            const props = w.blockAt(p)._properties;
            w.set(p.x, p.y, p.z, block.name, { ...props, open: !props.open });
            bot.interrupt_code = true; // stopped after the first door
        };
        const r = await home.closeNear(bot, { settings: SETTINGS, areas: [], log() {} }, 6);
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'interrupted');
        assert.ok(r.text.includes('I closed oak_door at (2, 64, 0).'), r.text);
    });
});

// ------------------------------------------------------------------------------------------ C2

describe('C2: hungerStep', () => {
    test('home_reflexes.hunger false: nothing', LIMIT, async () => {
        const bot = makeFakeBot();
        bot.food = 2;
        const said = [];
        const r = await home.hungerStep(bot, { settings: { home_pack: true, home_reflexes: { hunger: false } }, say: (t) => said.push(t) }, { idle: true, now: 1 });
        assert.equal(r.action, 'none');
        assert.deepEqual(said, []);
    });

    test('the text goes to the chat and the history through ctx.say, without a call of the model', LIMIT, async () => {
        const bot = makeFakeBot();
        bot.food = 2;
        const said = [];
        const ctx = { settings: SETTINGS, say: (t) => said.push(t), chests: chestsOf([]), storage: { fetchItem: async () => ({ taken: 0 }) } };
        const state = { idle: true, now: 1000 };
        await home.hungerStep(bot, ctx, state);
        assert.deepEqual(said, ['I am starving. I have no food and know no chest with food.']);
        await home.hungerStep(bot, ctx, { ...state, now: 1000 + 60 * 1000 });
        assert.equal(said.length, 1, 'once per 2 minutes');
    });

    test('a fetch runs only through state.walk (the mode action of part A)', LIMIT, async () => {
        const bot = makeFakeBot({ pos: [12.5, 67, 52.5] });
        bot.food = 6;
        let fetched = 0;
        const ctx = { settings: SETTINGS, say() {}, log() {},
            chests: chestsOf([{ x: 11, y: 67, z: 53, dimension: 'overworld', items: { bread: 5 } }]),
            storage: { fetchItem: async (name, n) => { fetched++; bot.inventory.put(name, n); return { ok: true, taken: n, text: '' }; } } };
        const without = await home.hungerStep(bot, ctx, { idle: true, now: 1 });
        assert.equal(without.action, 'fetch');
        assert.equal(fetched, 0, 'no walk without state.walk');
        let walks = 0;
        await home.hungerStep(bot, ctx, { idle: true, now: 2, walk: async (fn) => { walks++; await fn(); return true; } });
        assert.equal(walks, 1);
        assert.equal(fetched, 1);
        assert.ok(bot.food > 6, 'it ate after the fetch');
    });
});

// ------------------------------------------------------------------------------------------ C3

describe('C3: creeperCheck on the surroundings of the bot', () => {
    // Rock from y 20 to 63, grass on top at 64 ... the bot in a tunnel 1 x 2 along x at y 25 and 26.
    function tunnelWorld() {
        const w = createBlockWorld().flatGround(63, 'grass_block', 'stone');
        w.fill(-2, 25, 0, 14, 26, 0, 'air');
        return w;
    }
    function ctxOf(underground) {
        return { settings: SETTINGS, areas: [], now: () => Date.now(), log() {}, whereAmI: () => ({ area: null, depth: 38, underground }) };
    }

    test('play test: the bot at y 25 in the tunnel, a creeper on the surface above: no reaction', () => {
        const bot = makeFakeBot({ world: tunnelWorld(), pos: [0.5, 25, 0.5] });
        const creeper = mobEntity('creeper', [3.5, 44, 0.5]); // within 24 blocks, rock between
        bot.entities[creeper.id] = creeper;
        assert.equal(home.creeperCheck(bot, ctxOf(true)).step, 'none');
        assert.equal(home.creeperCheck(bot, ctxOf(false)).step, 'none', 'also when whereAmI says surface: 19 blocks higher');
    });

    test('play test W47: a creeper 8 blocks away in the same tunnel, in sight: the reflex reacts', () => {
        const bot = makeFakeBot({ world: tunnelWorld(), pos: [0.5, 25, 0.5] });
        const creeper = mobEntity('creeper', [8.5, 25, 0.5]);
        bot.entities[creeper.id] = creeper;
        assert.notEqual(home.creeperCheck(bot, ctxOf(true)).step, 'none');
    });

    test('a creeper 8 blocks away at the same height behind rock: no reaction', () => {
        const w = tunnelWorld();
        w.fill(4, 25, 0, 4, 26, 0, 'stone'); // the tunnel is closed between them
        const bot = makeFakeBot({ world: w, pos: [0.5, 25, 0.5] });
        const creeper = mobEntity('creeper', [8.5, 25, 0.5]);
        bot.entities[creeper.id] = creeper;
        assert.equal(home.creeperCheck(bot, ctxOf(true)).step, 'none');
    });

    test('a creeper 5 blocks away behind rock, at the same height: it counts (6 or less)', () => {
        const w = tunnelWorld();
        w.fill(3, 25, 0, 3, 26, 0, 'stone');
        const bot = makeFakeBot({ world: w, pos: [0.5, 25, 0.5] });
        const creeper = mobEntity('creeper', [5.5, 25, 0.5]);
        bot.entities[creeper.id] = creeper;
        assert.notEqual(home.creeperCheck(bot, ctxOf(true)).step, 'none');
    });
});

// ------------------------------------------------------------------------------------------ C4

describe('C4: no home', () => {
    test('goToShelter with no home at all: nothing happens, "I know no home. Tell me where home is."', LIMIT, async () => {
        const bot = makeFakeBot();
        bot.time.timeOfDay = 13000;
        const r = await home.goToShelter(bot, { settings: SETTINGS, areas: [
            { name: 'mining_area', type: 'mine', min: { x: -3, y: 40, z: -3 }, max: { x: 3, y: 63, z: 3 } },
            { name: 'pen', type: 'pen', min: { x: 5, y: 62, z: 5 }, max: { x: 9, y: 66, z: 9 } },
        ], places: null, log() {} });
        assert.equal(r.ok, false);
        assert.equal(r.text, 'I know no home. Tell me where home is.');
        assert.ok(!bot.calls.some((c) => c[0] === 'dig' || c[0] === 'goto'), 'the bot does not dig itself in and does not walk');
    });
});

// ---------------------------------------------------------------------------------------- I8, C5

describe('I8, C5: the door service', () => {
    function doorWorld() {
        const w = createBlockWorld().flatGround(63);
        w.set(2, 64, 0, 'oak_door', { half: 'lower', open: false, facing: 'east' });
        w.set(2, 65, 0, 'oak_door', { half: 'upper', open: false, facing: 'east' });
        return w;
    }
    function toggling(bot, w) {
        bot.activateBlock = async (block) => {
            const p = block.position;
            const props = w.blockAt(p)._properties;
            w.set(p.x, p.y, p.z, block.name, { ...props, open: !props.open });
        };
    }

    test('createDoorService(bot, ctx) gives { tick, stop, closeNear }; tick() is synchronous and returns nothing', () => {
        const bot = makeFakeBot({ world: doorWorld() });
        const service = home.createDoorService(bot, { settings: SETTINGS, areas: [] });
        assert.equal(typeof service.tick, 'function');
        assert.equal(typeof service.stop, 'function');
        assert.equal(typeof service.closeNear, 'function');
        assert.equal(service.tick(), undefined);
    });

    test('a door the bot opened and passed is closed when the bot is 2 blocks past it; the console line of the spec', LIMIT, async () => {
        const w = doorWorld();
        const bot = makeFakeBot({ world: w, pos: [0.5, 64, 0.5] });
        toggling(bot, w);
        let t = 100000;
        const service = home.createDoorService(bot, { settings: SETTINGS, areas: [] }, { now: () => t, scanMs: 0 });
        service.tick();
        const open = (v) => { w.set(2, 64, 0, 'oak_door', { half: 'lower', open: v, facing: 'east' }); };
        for (const [x, opened] of [[1.2, true], [2.5, true], [3.4, true], [4.8, true]]) {
            t += 300;
            bot.entity.position = new Vec3(x, 64, 0.5);
            if (opened) open(true);
            service.tick();
            await sleep(20);
        }
        const end = Date.now() + 3000;
        const LINE = 'Door service: closed oak_door at (2, 64, 0).';
        while ((w.blockAt({ x: 2, y: 64, z: 0 })._properties.open || !cap.allText().includes(LINE)) && Date.now() < end) {
            t += 300;
            service.tick();
            await sleep(50);
        }
        assert.equal(w.blockAt({ x: 2, y: 64, z: 0 })._properties.open, false, 'closed');
        assert.ok(cap.allText().includes('Door service: closed oak_door at (2, 64, 0).'), cap.allText());
        service.stop();
    });

    test('home_reflexes.door_closing false: tick() does nothing', LIMIT, async () => {
        const w = doorWorld();
        const bot = makeFakeBot({ world: w, pos: [0.5, 64, 0.5] });
        toggling(bot, w);
        let t = 100000;
        const service = home.createDoorService(bot, { settings: { home_pack: true, home_reflexes: { door_closing: false } }, areas: [] }, { now: () => t, scanMs: 0 });
        service.tick();
        w.set(2, 64, 0, 'oak_door', { half: 'lower', open: true, facing: 'east' });
        for (const x of [1.2, 2.5, 3.4, 4.8, 5.5]) {
            t += 300;
            bot.entity.position = new Vec3(x, 64, 0.5);
            service.tick();
            await sleep(20);
        }
        await sleep(200);
        assert.equal(w.blockAt({ x: 2, y: 64, z: 0 })._properties.open, true);
    });

    test('closeNear(6): "I closed oak_door at (x, y, z) and oak_fence_gate at (x, y, z)." then "All doors near me are closed."', LIMIT, async () => {
        const w = createBlockWorld().flatGround(63);
        w.set(2, 64, 0, 'oak_door', { half: 'lower', open: true, facing: 'east' });
        w.set(2, 65, 0, 'oak_door', { half: 'upper', open: true, facing: 'east' });
        w.set(0, 64, 3, 'oak_fence_gate', { open: true, facing: 'south' });
        w.set(9, 64, 0, 'birch_door', { half: 'lower', open: true, facing: 'east' }); // farther than 6
        const bot = makeFakeBot({ world: w, pos: [0.5, 64, 0.5] });
        toggling(bot, w);
        const service = home.createDoorService(bot, { settings: SETTINGS, areas: [], log() {} });
        const r = await service.closeNear(6);
        assert.equal(r.text, 'I closed oak_door at (2, 64, 0) and oak_fence_gate at (0, 64, 3).');
        assert.equal(w.blockAt({ x: 9, y: 64, z: 0 })._properties.open, true, 'the door 8.5 blocks away stays');
        const again = await service.closeNear(6);
        assert.equal(again.text, 'All doors near me are closed.');
    });
});

// ------------------------------------------------------------------------------------------ C6

describe('C6: sleep', () => {
    test('by day: "I cannot sleep now, it is day. The night starts in about 5 minutes."; unstuck is paused from the start', LIMIT, async () => {
        const bot = makeFakeBot();
        const paused = [];
        bot.modes = { pause: (n) => paused.push(n), noteProgress() {}, isOn: () => false, exists: () => false };
        bot.time.timeOfDay = 6000;
        const r = await home.sleepInBed(bot, { settings: SETTINGS, areas: [] });
        assert.equal(r.ok, false);
        assert.equal(r.text, 'I cannot sleep now, it is day. The night starts in about 5 minutes.');
        assert.ok(paused.includes('unstuck'));
    });

    test('the walk to the bed and the wait there happen with unstuck paused (S15)', LIMIT, async () => {
        const w = createBlockWorld().flatGround(63);
        w.set(3, 64, 0, 'red_bed', { part: 'head', facing: 'east', occupied: false });
        const bot = makeFakeBot({ world: w });
        const order = [];
        bot.modes = { pause: (n) => order.push(`pause ${n}`), noteProgress() {}, isOn: () => false, exists: () => false };
        bot.gotoImpl = async () => { order.push('walk'); bot.entity.position = new Vec3(2.5, 64, 0.5); };
        bot.time.timeOfDay = 12200; // after sunset, before the bed can be used
        const sleeping = home.sleepInBed(bot, { settings: SETTINGS, areas: [] }, { wait: () => new Promise((r) => setTimeout(r, 5)), now: (() => { let t = 0; return () => (t += 1000); })() });
        const r = await sleeping;
        assert.equal(order[0], 'pause unstuck', JSON.stringify(order));
        assert.ok(order.indexOf('walk') > 0, 'the walk to the bed comes after the pause');
        assert.equal(typeof r.text, 'string');
    });
});
