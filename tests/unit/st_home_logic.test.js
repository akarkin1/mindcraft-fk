// T1, spec v0.1.4.8 section 8 (part C), the pure parts, tested from the spec and the handoff:
//   C1 food: auto-eat without the off-hand, the target of !eat, the texts of !eat word for word, the food
//      of the chests (banned food left out: the chest of the play test held only rotten flesh and spider eyes);
//   C2 every row of the table of the hunger reflex, and the rates of its texts;
//   C3 the rules for creepers, with the cases of the play test (the creeper on the surface above the bot
//      at y 25, the creeper 8 blocks away in the same tunnel), and "underground: nothing and no word";
//   C4 the shelter (never another type, W48); C5 the door service (DoorWatch) and its texts;
//   C6 the text by day. The setting home_reflexes.hunger defaults to true (section 2).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const food = await loadSrc('src/agent/packs/home/food_logic.js');
const texts = await loadSrc('src/agent/packs/home/texts.js');
const creeper = await loadSrc('src/agent/packs/home/creeper_logic.js');
const shelter = await loadSrc('src/agent/packs/home/shelter_logic.js');
const doorLogic = await loadSrc('src/agent/packs/home/door_logic.js');
const sleepLogic = await loadSrc('src/agent/packs/home/sleep_logic.js');
const homeSettings = await loadSrc('src/agent/packs/home/home_settings.js');

const MIN = 60 * 1000;

// ------------------------------------------------------------------------------------------ C1

describe('C1: food', () => {
    test('auto-eat keeps the food in the main hand: offhand false, also in AUTO_EAT_DEFAULTS', () => {
        assert.equal(food.AUTO_EAT_DEFAULTS.offhand, false);
        assert.equal(food.autoEatOptions({}).offhand, false);
        assert.equal(food.autoEatOptions({ offhand: true, priority: 'saturation' }).offhand, false, 'the defaults of the plugin had offhand true');
        assert.equal(food.autoEatOptions(undefined).offhand, false);
    });

    test('!eat eats until the food level is 18; with health below 20 until 20', () => {
        assert.equal(food.eatTarget(20), 18);
        assert.equal(food.eatTarget(19), 20);
        assert.equal(food.wantsFood(17, 20), true);
        assert.equal(food.wantsFood(18, 20), false);
        assert.equal(food.wantsFood(18, 12), true);
        assert.equal(food.wantsFood(19, 12), true);
        assert.equal(food.wantsFood(20, 12), false);
    });

    test('the texts of !eat, word for word', () => {
        assert.equal(texts.ateStatusText({ bread: 2 }, 19, 12), 'I ate 2 bread. Food 19 of 20, health 12 of 20.');
        assert.equal(texts.notHungryText(19, 20), 'I am not hungry. Food 19 of 20, health 20 of 20.');
        assert.equal(texts.noFoodText([{ name: 'apple', count: 5, chest: { x: 11, y: 67, z: 53 } }]),
            'I carry no food. The chest at (11, 67, 53) has 5 apple.');
        assert.equal(texts.noFoodText([]), 'I carry no food and know no chest with food.');
    });

    test('the food of the known chests, banned food left out (the owner\'s chest of the play test)', () => {
        const owner = { x: 11, y: 67, z: 53, items: { rotten_flesh: 1, spider_eye: 3, wheat_seeds: 52, cobblestone: 81 } };
        assert.deepEqual(food.listKnownFood([owner]), [], 'rotten flesh and spider eyes are no food to fetch');
        const withApples = { ...owner, items: { ...owner.items, apple: 5 } };
        assert.deepEqual(food.listKnownFood([withApples]), [{ name: 'apple', count: 5, chest: { x: 11, y: 67, z: 53 } }]);
    });

    test('with a position the nearest chest comes first', () => {
        const near = { x: 11, y: 67, z: 53, items: { bread: 1 } };
        const far = { x: 100, y: 67, z: 53, items: { bread: 30 } };
        const list = food.listKnownFood([far, near], { from: { x: 12, y: 67, z: 52 } });
        assert.deepEqual(list.map((k) => k.chest.x), [11, 100]);
    });
});

// ------------------------------------------------------------------------------------------ C2

describe('C2: the table of the hunger reflex', () => {
    const KNOWN = [{ name: 'bread', count: 5, chest: { x: 11, y: 67, z: 53 } }];
    const input = (over) => ({ food: 20, health: 20, carries: false, known: [], idle: true, playerOrder: false, lastSaid: null, now: 10 * MIN, ...over });
    const decide = (over) => food.hungerDecision(input(over));

    test('row 1: carries food and food <= 14: eat', () => {
        assert.equal(decide({ carries: true, food: 14 }).action, 'eat');
        assert.equal(decide({ carries: true, food: 3 }).action, 'eat');
        assert.equal(decide({ carries: true, food: 15 }).action, 'none');
    });

    test('row 1: carries food, food <= 17 and health < 20: eat', () => {
        assert.equal(decide({ carries: true, food: 17, health: 19 }).action, 'eat');
        assert.equal(decide({ carries: true, food: 17, health: 20 }).action, 'none');
        assert.equal(decide({ carries: true, food: 18, health: 10 }).action, 'none');
    });

    test('row 2: carries none, food <= 10, idle, known not empty: fetch', () => {
        assert.equal(decide({ food: 10, known: KNOWN, idle: true }).action, 'fetch');
        assert.equal(decide({ food: 11, known: KNOWN, idle: true }).action, 'none');
    });

    test('row 3: carries none, food <= 10, not idle: say the text of hunger', () => {
        const r = decide({ food: 6, known: KNOWN, idle: false, playerOrder: true });
        assert.equal(r.action, 'say');
        assert.equal(r.text, 'I am hungry and carry no food. Food 6 of 20.');
    });

    test('row 3: carries none, food <= 10, nothing known: say the text of hunger', () => {
        const r = decide({ food: 10, known: [], idle: true });
        assert.equal(r.action, 'say');
        assert.equal(r.text, 'I am hungry and carry no food. Food 10 of 20.');
    });

    test('row 3: the text of hunger at most once per 5 minutes', () => {
        assert.equal(decide({ food: 6, lastSaid: { hungry: 10 * MIN - 4 * MIN } }).action, 'none');
        assert.equal(decide({ food: 6, lastSaid: { hungry: 10 * MIN - 5 * MIN } }).action, 'say');
    });

    test('row 4: carries none, food <= 3, no order of the player runs, known not empty: fetch, also when busy', () => {
        assert.equal(decide({ food: 3, known: KNOWN, idle: false, playerOrder: false }).action, 'fetch');
        assert.equal(decide({ food: 1, known: KNOWN, idle: true, playerOrder: false }).action, 'fetch');
    });

    test('row 4: food <= 3 while an order of the player runs: no fetch', () => {
        assert.notEqual(decide({ food: 3, known: KNOWN, idle: false, playerOrder: true }).action, 'fetch');
    });

    test('row 5: carries none, food <= 3, nothing known: say the text of starving', () => {
        const r = decide({ food: 3, known: [], idle: false });
        assert.equal(r.action, 'say');
        assert.equal(r.text, 'I am starving. I have no food and know no chest with food.');
    });

    test('row 5: the text of starving at most once per 2 minutes', () => {
        assert.equal(decide({ food: 2, lastSaid: { starving: 10 * MIN - 1.9 * MIN } }).action, 'none');
        assert.equal(decide({ food: 2, lastSaid: { starving: 10 * MIN - 2 * MIN } }).action, 'say');
    });

    test('the result is { action, text }', () => {
        const r = decide({ food: 3, known: [] });
        assert.ok('action' in r && 'text' in r);
    });

    test('section 2: home_reflexes.hunger is on by default with home_pack', () => {
        assert.equal(homeSettings.HOME_REFLEX_DEFAULTS.hunger, true);
        assert.equal(homeSettings.reflexOn({ home_pack: true }, 'hunger'), true);
        assert.equal(homeSettings.reflexOn({ home_pack: true, home_reflexes: { hunger: false } }, 'hunger'), false);
        assert.equal(homeSettings.reflexOn({ home_pack: false }, 'hunger'), false, 'part of home_pack');
    });
});

// ------------------------------------------------------------------------------------------ C3

describe('C3: which creepers count for the bot', () => {
    const counts = (dBot, dy, sight) => creeper.countsForBot({ dBot, dy, sight });

    test('|dy| <= 4 and dBot <= 6: counts, in sight or not', () => {
        assert.equal(counts(5, 0, false), true);
        assert.equal(counts(6, 4, false), true);
        assert.equal(counts(6, -4, false), true);
    });

    test('|dy| <= 4 and in sight: counts farther than 6', () => {
        assert.equal(counts(8, 0, true), true);
        assert.equal(counts(12, 3, true), true);
    });

    test('farther than 6 and not in sight: does not count', () => {
        assert.equal(counts(8, 0, false), false);
    });

    test('|dy| > 4: does not count, near or in sight', () => {
        assert.equal(counts(5, 5, true), false);
        assert.equal(counts(5, -5, true), false);
    });

    test('play test: a creeper at y 64 and the bot at y 25 with rock between them does not count', () => {
        assert.equal(counts(39.5, 39, false), false);
    });

    test('play test W47: a creeper 8 blocks away in the same tunnel, in sight, counts', () => {
        assert.equal(counts(8, 0, true), true);
    });
});

describe('C3: which creepers count for an area', () => {
    const home = { name: 'home', type: 'home', min: { x: 0, y: 66, z: 0 }, max: { x: 8, y: 71, z: 10 } };

    test('horizontal distance to the box 16 or less', () => {
        assert.equal(creeper.countsForArea(home, { x: 9 + 16, y: 67, z: 5 }), true);
        assert.equal(creeper.countsForArea(home, { x: 9 + 17, y: 67, z: 5 }), false);
    });

    test('y between min.y - 3 and max.y + 3', () => {
        assert.equal(creeper.countsForArea(home, { x: 12, y: 63, z: 5 }), true);
        assert.equal(creeper.countsForArea(home, { x: 12, y: 62.9, z: 5 }), false);
        assert.equal(creeper.countsForArea(home, { x: 12, y: 74, z: 5 }), true);
        assert.equal(creeper.countsForArea(home, { x: 12, y: 74.5, z: 5 }), false);
    });

    test('only a defended type: a mine does not count (the mine box of the play test ended under the surface)', () => {
        const mine = { name: 'mining_area', type: 'mine', min: { x: 6, y: 38, z: 36 }, max: { x: 12, y: 58, z: 49 } };
        assert.equal(creeper.countsForArea(mine, { x: 9, y: 58, z: 40 }), false);
    });
});

describe('C3: the reflex underground', () => {
    const bot = { x: 0.5, y: 25, z: 0.5 };
    const mine = { name: 'mining_area', type: 'mine', min: { x: -5, y: 20, z: -5 }, max: { x: 5, y: 60, z: 5 } };
    const house = { name: 'home', type: 'home', min: { x: -8, y: 64, z: -8 }, max: { x: 8, y: 70, z: 8 } };

    test('underground and no creeper counts for the bot: nothing happens and nothing is said', () => {
        const r = creeper.decide({ botPos: bot, underground: true, areas: [mine, house],
            creepers: [{ id: 1, pos: { x: 3, y: 64, z: 3 }, sight: false }] });
        assert.equal(r.step, 'none');
        assert.ok(!r.text, 'no text');
    });

    test('underground and a creeper 8 blocks away in the tunnel, in sight: the reflex reacts', () => {
        const r = creeper.decide({ botPos: bot, underground: true, areas: [mine, house],
            creepers: [{ id: 1, pos: { x: 8.5, y: 25, z: 0.5 }, sight: true }] });
        assert.notEqual(r.step, 'none');
    });
});

// ------------------------------------------------------------------------------------------ C4

describe('C4: the shelter', () => {
    const HOME_PLACE = { x: 12, y: 67, z: 52, dimension: 'overworld' };
    const house = { name: 'home', type: 'home', min: { x: 8, y: 66, z: 47 }, max: { x: 16, y: 71, z: 57 }, dimension: 'overworld' };
    const otherHouse = { name: 'cabin', type: 'home', min: { x: 60, y: 66, z: 60 }, max: { x: 66, y: 71, z: 66 }, dimension: 'overworld' };
    const mine = { name: 'mining_area', type: 'mine', min: { x: 6, y: 38, z: 36 }, max: { x: 12, y: 58, z: 49 }, dimension: 'overworld' };
    const pen = { name: 'pen', type: 'pen', min: { x: -12, y: 62, z: 40 }, max: { x: -8, y: 65, z: 50 }, dimension: 'overworld' };
    const building = { name: 'barn', type: 'building', min: { x: 0, y: 62, z: 0 }, max: { x: 5, y: 66, z: 5 }, dimension: 'overworld' };
    const choose = (areas, home, botPos) => shelter.chooseShelter({ areas, home, botPos, dimension: 'overworld' });

    test('1. the area of type home that holds the place home', () => {
        const r = choose([otherHouse, house], HOME_PLACE, { x: 62, y: 67, z: 62 });
        assert.equal(r.kind, 'area');
        assert.equal(r.area.name, 'home');
    });

    test('2. else the nearest area of type home within 96 blocks', () => {
        const r = choose([otherHouse], HOME_PLACE, { x: 10, y: 67, z: 10 });
        assert.equal(r.kind, 'area');
        assert.equal(r.area.name, 'cabin');
        assert.equal(choose([otherHouse], null, { x: -100, y: 67, z: -100 }).kind, 'emergency', 'farther than 96');
    });

    test('3. else the place home', () => {
        const r = choose([], HOME_PLACE, { x: 10, y: 67, z: 10 });
        assert.equal(r.kind, 'place');
    });

    test('never another type: W48, the mine and the pen are nearer than the house', () => {
        const r = choose([mine, pen, building, house], HOME_PLACE, { x: 9, y: 41, z: 44 });
        assert.equal(r.area?.name, 'home');
        assert.equal(choose([mine, pen, building], null, { x: 9, y: 41, z: 44 }).kind, 'emergency');
        assert.equal(choose([mine, pen, building], HOME_PLACE, { x: 9, y: 41, z: 44 }).kind, 'place');
    });

    test('the text with no home at all', () => {
        assert.equal(texts.TEXTS.noHome, 'I know no home. Tell me where home is.');
    });

    test('`The door is closed.` belongs to the text of a checked door only', () => {
        assert.equal(texts.shelterText('home'), 'I am in the shelter "home". The door is closed.');
        assert.ok(!texts.inShelterText('home').includes('The door is closed.'));
    });
});

// ------------------------------------------------------------------------------------------ C5

describe('C5: the door service (DoorWatch)', () => {
    const door = (open, over = {}) => ({ x: 5, y: 64, z: 0, kind: 'door', open, name: 'oak_door', facing: 'east', inArea: false, gated: false, occupied: false, ...over });
    const at = (x) => ({ x, y: 64, z: 0.5 });

    // the watch after the look at the start
    function watchAfterStart() {
        const w = new doorLogic.DoorWatch();
        w.observe({ now: 0, botPos: at(0.5), moving: false, doors: [door(false)], players: [] });
        return w;
    }

    test('an openable that goes from closed to open within 3 blocks while the bot moves is closed when the bot is 2 blocks past it', () => {
        const w = watchAfterStart();
        assert.deepEqual(w.observe({ now: 6000, botPos: at(3.5), moving: true, doors: [door(true)], players: [] }), [], 'noted, not closed yet');
        assert.deepEqual(w.observe({ now: 6250, botPos: at(5.5), moving: true, doors: [door(true)], players: [] }), [], 'in the door');
        assert.deepEqual(w.observe({ now: 6500, botPos: at(6.6), moving: true, doors: [door(true)], players: [] }), [], '1.1 past');
        const out = w.observe({ now: 6750, botPos: at(7.6), moving: true, doors: [door(true)], players: [] });
        assert.equal(out.length, 1, '2 blocks past');
        assert.equal(out[0].name, 'oak_door');
    });

    test('an entity in the openable: not closed', () => {
        const w = watchAfterStart();
        w.observe({ now: 6000, botPos: at(4.5), moving: true, doors: [door(true)], players: [] });
        w.observe({ now: 6250, botPos: at(5.5), moving: true, doors: [door(true)], players: [] });
        assert.deepEqual(w.observe({ now: 6500, botPos: at(8), moving: true, doors: [door(true, { occupied: true })], players: [] }), []);
    });

    test('opened by a player near it while the bot stands still: not noted', () => {
        const w = watchAfterStart();
        w.observe({ now: 6000, botPos: at(3.5), moving: false, doors: [door(true)], players: [{ x: 6, y: 64, z: 0.5 }] });
        assert.deepEqual(w.observe({ now: 20000, botPos: at(9), moving: false, doors: [door(true)], players: [] }), []);
    });

    test('it tries up to 3 times', () => {
        const w = watchAfterStart();
        w.observe({ now: 6000, botPos: at(4.5), moving: true, doors: [door(true)], players: [] });
        w.observe({ now: 6250, botPos: at(5.5), moving: true, doors: [door(true)], players: [] });
        let now = 6500;
        let attempts = 0;
        for (let i = 0; i < 10; i++) {
            const out = w.observe({ now, botPos: at(8), moving: false, doors: [door(true)], players: [] });
            if (out.length > 0) {
                attempts++;
                w.attempt(out[0], false, now);
            }
            now += 1100;
        }
        assert.equal(attempts, 3);
    });

    test('a gate of a pen or a farm that the bot passed is closed, also when it was open before', () => {
        const gate = (open) => ({ x: 5, y: 64, z: 0, kind: 'gate', open, name: 'oak_fence_gate', facing: 'east', inArea: true, gated: true, occupied: false });
        const w = new doorLogic.DoorWatch();
        w.observe({ now: 0, botPos: at(20), moving: false, doors: [gate(true)], players: [{ x: 5.5, y: 64, z: 1 }] }); // open before, a player at it
        w.observe({ now: 10000, botPos: at(5.5), moving: true, doors: [gate(true)], players: [] });
        const out = w.observe({ now: 10500, botPos: at(8), moving: true, doors: [gate(true)], players: [] });
        assert.equal(out.length, 1);
        assert.equal(out[0].name, 'oak_fence_gate');
    });

    test('an open door of a house (not a pen or farm) that was open before the bot passed is not closed', () => {
        const w = new doorLogic.DoorWatch();
        w.observe({ now: 0, botPos: at(20), moving: false, doors: [door(true)], players: [] });
        w.observe({ now: 10000, botPos: at(5.5), moving: true, doors: [door(true)], players: [] });
        assert.deepEqual(w.observe({ now: 10500, botPos: at(8), moving: true, doors: [door(true)], players: [] }), []);
    });

    test('at the start: open openables of a saved area within 6 blocks are closed when no player is within 3 blocks', () => {
        const w = new doorLogic.DoorWatch();
        const out = w.observe({ now: 0, botPos: at(1.5), moving: false, doors: [door(true, { inArea: true })], players: [] });
        assert.equal(out.length, 1);
        const w2 = new doorLogic.DoorWatch();
        assert.deepEqual(w2.observe({ now: 0, botPos: at(1.5), moving: false, doors: [door(true, { inArea: true })], players: [{ x: 6, y: 64, z: 0.5 }] }), []);
        const w3 = new doorLogic.DoorWatch();
        assert.deepEqual(w3.observe({ now: 0, botPos: at(1.5), moving: false, doors: [door(true, { inArea: false })], players: [] }), [], 'not in a saved area');
    });

    test('the texts', () => {
        assert.equal(texts.doorClosedLog({ name: 'oak_door', x: 5, y: 64, z: 0 }), 'Door service: closed oak_door at (5, 64, 0).');
        assert.equal(texts.closeNearText({ closed: [{ name: 'oak_door', x: 1, y: 64, z: 2 }, { name: 'oak_fence_gate', x: 3, y: 64, z: 4 }] }),
            'I closed oak_door at (1, 64, 2) and oak_fence_gate at (3, 64, 4).');
        assert.equal(texts.closeNearText({ closed: [] }), 'All doors near me are closed.');
    });
});

// ------------------------------------------------------------------------------------------ C6

describe('C6: sleep by day', () => {
    test('the text by day, with the minutes until the night', () => {
        assert.equal(texts.dayText(5), 'I cannot sleep now, it is day. The night starts in about 5 minutes.');
        assert.equal(texts.dayText(1), 'I cannot sleep now, it is day. The night starts in about 1 minute.');
        assert.equal(sleepLogic.minutesUntilNight(6000), 5);
    });
});
