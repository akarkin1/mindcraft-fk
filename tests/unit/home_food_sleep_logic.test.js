// Spec v0.1.4.6 H4: the pure parts of sleep.js and food.js (sleep_logic.js, food_logic.js),
// the texts of the home pack (texts.js) and its settings (home_settings.js).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadSrc } from '../helpers/load.js';

const F = await loadSrc('src/agent/packs/home/food_logic.js');
const Z = await loadSrc('src/agent/packs/home/sleep_logic.js');
const T = await loadSrc('src/agent/packs/home/texts.js');
const H = await loadSrc('src/agent/packs/home/home_settings.js');

const require = createRequire(import.meta.url);
const FOOD_LIST = require('minecraft-data/minecraft-data/data/pc/1.21.8/foods.json');
const FOODS = Object.fromEntries(FOOD_LIST.map(f => [f.name, f]));
const item = (name, count = 1) => ({ name, count });

const SPEC_BANNED = ['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'chicken', 'golden_apple',
    'enchanted_golden_apple', 'chorus_fruit', 'suspicious_stew'];

// The defaults of mineflayer-auto-eat 3.3.6 (dist/index.js).
const PLUGIN_DEFAULTS = Object.freeze({
    priority: 'saturation', startAt: 16, eatingTimeout: 3000,
    bannedFood: ['pufferfish', 'spider_eye', 'poisonous_potato', 'rotten_flesh', 'chorus_fruit', 'chicken', 'suspicious_stew', 'golden_apple'],
    ignoreInventoryCheck: false, checkOnItemPickup: true, offhand: true, equipOldItem: true,
});

describe('food_logic: chooseFood', () => {
    test('BANNED_FOOD is the list of the spec', () => {
        assert.deepEqual([...F.BANNED_FOOD].sort(), [...SPEC_BANNED].sort());
    });

    test('the food with the most food points that is not banned', () => {
        const items = [item('bread', 2), item('rotten_flesh', 5), item('cooked_beef'), item('apple', 3), item('dirt', 64)];
        assert.equal(F.chooseFood(items, FOODS), 'cooked_beef');
        assert.equal(F.chooseFood([item('bread'), item('apple')], FOODS), 'bread');
    });

    test('banned food and things that are no food are never chosen', () => {
        assert.equal(F.chooseFood([item('rotten_flesh'), item('golden_apple'), item('enchanted_golden_apple'), item('chicken')], FOODS), null);
        assert.equal(F.chooseFood([item('dirt'), item('stick')], FOODS), null);
        assert.equal(F.chooseFood([item('bread', 0)], FOODS), null, 'count 0');
    });

    test('same food points: higher saturation, then the name', () => {
        assert.equal(F.chooseFood([item('cooked_porkchop'), item('cooked_beef')], FOODS), 'cooked_beef');
        assert.equal(F.chooseFood([item('cooked_chicken'), item('cooked_mutton')], FOODS), 'cooked_mutton', 'both 6, mutton has more saturation');
    });

    test('bad input: null', () => {
        assert.equal(F.chooseFood(null, FOODS), null);
        assert.equal(F.chooseFood([item('bread')], null), null);
        assert.equal(F.chooseFood([null, 5, item('bread')], FOODS), 'bread');
    });

    test('isEdibleFood', () => {
        assert.equal(F.isEdibleFood('bread', FOODS), true);
        assert.equal(F.isEdibleFood('spider_eye', FOODS), false);
        assert.equal(F.isEdibleFood('stone', FOODS), false);
        assert.equal(F.isEdibleFood('bread', null), false);
    });
});

describe('food_logic: autoEatOptions', () => {
    test('keeps the defaults of the plugin and sets priority, startAt and the banned list', () => {
        const current = { ...PLUGIN_DEFAULTS, bannedFood: [...PLUGIN_DEFAULTS.bannedFood] };
        const opts = F.autoEatOptions(current);
        assert.equal(opts.priority, 'foodPoints');
        assert.equal(opts.startAt, 14);
        assert.equal(opts.eatingTimeout, 3000);
        assert.equal(opts.offhand, true);
        assert.equal(opts.equipOldItem, true);
        assert.equal(opts.checkOnItemPickup, true);
        assert.equal(opts.ignoreInventoryCheck, false);
        assert.deepEqual([...opts.bannedFood].sort(), [...SPEC_BANNED].sort());
        assert.deepEqual(current.bannedFood, PLUGIN_DEFAULTS.bannedFood, 'the current object is not changed');
        assert.equal(current.priority, 'saturation');
    });

    test('the incomplete object of the old code gets the missing defaults back', () => {
        const old = { priority: 'foodPoints', startAt: 14, bannedFood: ['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'chicken'] };
        const opts = F.autoEatOptions(old);
        assert.equal(opts.eatingTimeout, 3000);
        assert.equal(opts.equipOldItem, true);
        assert.equal(opts.checkOnItemPickup, true);
    });

    test('extra banned food of the current options is kept', () => {
        const opts = F.autoEatOptions({ ...PLUGIN_DEFAULTS, bannedFood: ['cookie'] });
        assert.ok(opts.bannedFood.includes('cookie'));
        assert.ok(opts.bannedFood.includes('enchanted_golden_apple'));
        assert.equal(new Set(opts.bannedFood).size, opts.bannedFood.length, 'no duplicates');
    });

    test('no current options: the plugin defaults', () => {
        for (const bad of [undefined, null, 'x', []]) {
            const opts = F.autoEatOptions(bad);
            assert.equal(opts.eatingTimeout, 3000);
            assert.equal(opts.priority, 'foodPoints');
            assert.equal(opts.startAt, 14);
        }
    });

    test('valid values of the current options are kept, invalid ones replaced', () => {
        const opts = F.autoEatOptions({ ...PLUGIN_DEFAULTS, eatingTimeout: 5000, offhand: false });
        assert.equal(opts.eatingTimeout, 5000);
        assert.equal(opts.offhand, false);
        const bad = F.autoEatOptions({ ...PLUGIN_DEFAULTS, eatingTimeout: -1, bannedFood: 'none' });
        assert.equal(bad.eatingTimeout, 3000);
        assert.deepEqual([...bad.bannedFood].sort(), [...SPEC_BANNED].sort());
    });
});

describe('sleep_logic', () => {
    test('isBedName: names ending with _bed; bedrock is no bed', () => {
        assert.equal(Z.isBedName('red_bed'), true);
        assert.equal(Z.isBedName('light_gray_bed'), true);
        assert.equal(Z.isBedName('bedrock'), false);
        assert.equal(Z.isBedName('bed'), false);
        assert.equal(Z.isBedName('flower_bed'), true, 'the rule of the spec is the ending');
        assert.equal(Z.isBedName(null), false);
    });

    test('sleepTimeState: now, soon (after sunset, before 12541), no', () => {
        assert.equal(Z.sleepTimeState({ timeOfDay: 6000 }), 'no');
        assert.equal(Z.sleepTimeState({ timeOfDay: 11999 }), 'no');
        assert.equal(Z.sleepTimeState({ timeOfDay: 12000 }), 'soon');
        assert.equal(Z.sleepTimeState({ timeOfDay: 12540 }), 'soon');
        assert.equal(Z.sleepTimeState({ timeOfDay: 12541 }), 'now');
        assert.equal(Z.sleepTimeState({ timeOfDay: 18000 }), 'now');
        assert.equal(Z.sleepTimeState({ timeOfDay: 23458 }), 'now');
        assert.equal(Z.sleepTimeState({ timeOfDay: 23459 }), 'no');
        assert.equal(Z.sleepTimeState({ timeOfDay: 6000, thunder: true }), 'now');
        assert.equal(Z.sleepTimeState({ timeOfDay: 'x' }), 'no');
        assert.equal(Z.sleepTimeState(null), 'no');
    });

    test('sleepErrorKind maps the errors of mineflayer', () => {
        assert.equal(Z.sleepErrorKind(new Error("it's not night and it's not a thunderstorm")), 'not_night');
        assert.equal(Z.sleepErrorKind(new Error('there are monsters nearby')), 'monsters');
        assert.equal(Z.sleepErrorKind(new Error('the bed is occupied')), 'occupied');
        assert.equal(Z.sleepErrorKind(new Error('the bed is too far')), 'too_far');
        assert.equal(Z.sleepErrorKind('there are monsters nearby'), 'monsters');
        assert.equal(Z.sleepErrorKind(new Error('cant click the bed')), 'error');
        assert.equal(Z.sleepErrorKind(null), 'error');
    });

    test('orderBeds: one entry per bed, the head part, nearest first', () => {
        const beds = [
            { x: 10, y: 64, z: 0, name: 'red_bed', part: 'foot', facing: 'east' },
            { x: 11, y: 64, z: 0, name: 'red_bed', part: 'head', facing: 'east' },
            { x: 2, y: 64, z: 0, name: 'blue_bed', part: 'head', facing: 'north' },
            { x: 2, y: 64, z: 1, name: 'blue_bed', part: 'foot', facing: 'north' },
            { x: 40, y: 64, z: 0, name: 'green_bed' },
            null,
            { x: 'a', y: 0, z: 0, name: 'x_bed' },
        ];
        const ordered = Z.orderBeds(beds, { x: 0, y: 64, z: 0 });
        assert.deepEqual(ordered.map(b => [b.x, b.z]), [[2, 0], [11, 0], [40, 0]]);
        assert.deepEqual(Z.orderBeds(null, { x: 0, y: 0, z: 0 }), []);
    });

    test('orderBeds keeps a lone foot part', () => {
        const ordered = Z.orderBeds([{ x: 5, y: 64, z: 5, name: 'red_bed', part: 'foot', facing: 'south' }], { x: 0, y: 64, z: 0 });
        assert.equal(ordered.length, 1);
    });
});

describe('texts', () => {
    test('fixed texts, word for word', () => {
        assert.equal(T.TEXTS.inShelterAlready, 'I am in the shelter already.');
        assert.equal(T.TEXTS.monstersAtDoor, 'I cannot get into the shelter. Monsters are at the door.');
        assert.equal(T.TEXTS.slept, 'I slept. It is morning.');
        assert.equal(T.TEXTS.notNight, 'I cannot sleep now, it is not night.');
        assert.equal(T.TEXTS.noBed, 'I found no bed nearby.');
        assert.equal(T.TEXTS.monstersNearBed, 'I cannot sleep, monsters are nearby.');
        assert.equal(T.TEXTS.bedsTaken, 'All beds nearby are taken.');
        assert.equal(T.TEXTS.notHungry, 'I am not hungry.');
        assert.equal(T.TEXTS.noFood, 'I have no food.');
        assert.equal(T.TEXTS.creeperHelp, 'A creeper keeps following me near the base. I stay away from the buildings. Can you help?');
        assert.equal(T.TEXTS.backedOff, 'I backed off from a creeper.');
        assert.equal(T.TEXTS.gettingDark, 'It is getting dark. I go to the shelter.');
    });

    test('texts with values', () => {
        assert.equal(T.shelterText('home'), 'I am in the shelter "home". The door is closed.');
        assert.equal(T.dugInText({ x: 12.7, y: 60, z: -3.2 }), 'I have no shelter. I dug in at (12, 60, -4) and closed the hole.');
        assert.equal(T.couldNotSleepText(new Error('cant click the bed')), 'I could not sleep: cant click the bed');
        assert.equal(T.couldNotSleepText('boom'), 'I could not sleep: boom');
        assert.equal(T.luredText('home'), 'I led a creeper away from "home" and lost it.');
        assert.equal(T.ateText({ bread: 2 }), 'I ate 2 bread.');
        assert.equal(T.ateText({ bread: 1, cooked_beef: 2 }), 'I ate 1 bread and 2 cooked_beef.');
        assert.equal(T.ateText({ a: 1, b: 1, c: 1 }), 'I ate 1 a, 1 b and 1 c.');
        assert.equal(T.ateText({}), 'I ate nothing.');
    });
});

describe('home_settings', () => {
    test('defaults when the keys are absent', () => {
        assert.deepEqual(H.readHomeSettings({}), {
            home_pack: false,
            reflexes: { door_closing: true, night_shelter: true, creeper_safety: true },
            creeper_fighting: false,
        });
        assert.deepEqual(H.readHomeSettings(undefined).reflexes, { door_closing: true, night_shelter: true, creeper_safety: true });
    });

    test('values of the settings are used, invalid ones count as the default', () => {
        const s = H.readHomeSettings({ home_pack: true, home_reflexes: { door_closing: false, night_shelter: 'no' }, creeper_fighting: true });
        assert.deepEqual(s, { home_pack: true, reflexes: { door_closing: false, night_shelter: true, creeper_safety: true }, creeper_fighting: true });
        assert.equal(H.readHomeSettings({ home_pack: 'yes', home_reflexes: [], creeper_fighting: 1 }).home_pack, false);
        assert.equal(H.readHomeSettings({ home_reflexes: null }).reflexes.creeper_safety, true);
    });

    test('reflexOn needs home_pack and the reflex', () => {
        assert.equal(H.reflexOn({ home_pack: true }, 'door_closing'), true);
        assert.equal(H.reflexOn({ home_pack: false }, 'door_closing'), false);
        assert.equal(H.reflexOn({ home_pack: true, home_reflexes: { creeper_safety: false } }, 'creeper_safety'), false);
        assert.equal(H.reflexOn({ home_pack: true }, 'dancing'), false);
        assert.deepEqual(Object.keys(H.HOME_REFLEX_DEFAULTS), ['door_closing', 'night_shelter', 'creeper_safety']);
    });
});
