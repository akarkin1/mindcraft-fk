// Spec v0.1.4.8, part C: C4 (the shelter is only a home; "The door is closed." only after the state of
// the door was read) and C6 (sleep pauses unstuck from its start; the text by day says when the night
// starts). The fake bot of home_fake_bot.test.js.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeFakeBot, buildHouse } from './home_fake_bot.test.js';

const S = await loadSrc('src/agent/packs/home/shelter.js');
const L = await loadSrc('src/agent/packs/home/shelter_logic.js');
const Z = await loadSrc('src/agent/packs/home/sleep.js');
const ZL = await loadSrc('src/agent/packs/home/sleep_logic.js');
const H = await loadSrc('src/agent/packs/home/index.js');

const FAST = { checkMs: 40 };
const QUICK = { checkMs: 40, wait: () => new Promise(r => setTimeout(r, 2)) };
const p = (x, z, y = 64) => ({ x, y, z });
const box = (name, type, x1, z1, x2, z2, y1 = 63, y2 = 69) => ({ name, type, dimension: 'overworld', min: { x: x1, y: y1, z: z1 }, max: { x: x2, y: y2, z: z2 }, entrances: [] });

describe('C4: chooseShelter takes only a home', () => {
    const home = box('home', 'home', 60, 60, 68, 68); // 78 blocks from the bot at (5, 5)
    // the play test: the mine (saved as building before, a mine now) and a pen of 1 x 3 x 1 were nearer
    const mine = box('mining_area', 'mine', 0, 0, 12, 12, 25, 58);
    const pen = box('pen', 'pen', 14, 0, 14, 2);
    const shed = box('shed', 'building', -10, -10, -4, -4);
    const farm = box('farm', 'farm', 20, 20, 30, 30);

    test('W48: mine, pen, building and farm nearer than the house: the house', () => {
        const r = L.chooseShelter({ areas: [mine, pen, shed, farm, home], home: null, botPos: p(5, 5), dimension: 'overworld' });
        assert.equal(r.kind, 'area');
        assert.equal(r.area.name, 'home');
    });

    test('1. the home area that holds the place home comes before a nearer home area', () => {
        const cabin = box('cabin', 'home', 0, 20, 8, 28);
        const r = L.chooseShelter({ areas: [cabin, home], home: { x: 64, y: 64, z: 64 }, botPos: p(4, 30), dimension: 'overworld' });
        assert.deepEqual({ name: r.area.name, why: r.why }, { name: 'home', why: 'contains_home' });
    });

    test('3. the place home when no home area is within 96 blocks; never another type', () => {
        const place = { x: 50, y: 64, z: 50, dimension: 'overworld' };
        const r = L.chooseShelter({ areas: [mine, pen, shed, farm], home: place, botPos: p(5, 5), dimension: 'overworld' });
        assert.deepEqual({ kind: r.kind, why: r.why }, { kind: 'place', why: 'home_place' });
        const far = L.chooseShelter({ areas: [box('home', 'home', 200, 200, 208, 208)], home: place, botPos: p(5, 5), dimension: 'overworld' });
        assert.equal(far.kind, 'place');
        const none = L.chooseShelter({ areas: [mine, pen, shed, farm], home: null, botPos: p(5, 5), dimension: 'overworld' });
        assert.deepEqual(none, { kind: 'emergency', why: 'nothing' }, 'no home: the kind that is no area and no place');
    });

    test('isShelterArea: home only; isBuildingArea: home and building', () => {
        assert.equal(L.isShelterArea(home), true);
        for (const a of [mine, pen, shed, farm, { ...home, type: undefined }]) {
            assert.equal(L.isShelterArea(a), false, a.type);
        }
        assert.deepEqual([home, shed, pen, mine].map(L.isBuildingArea), [true, true, false, false]);
    });
});

describe('C4: goToShelter and isInShelter', () => {
    function scene({ botAt = [4.5, 64, 30.5], areas = null, withDoor = true, places = null } = {}) {
        const world = makeWorld();
        const house = buildHouse(world, { withDoor });
        const bot = makeFakeBot({ world, pos: botAt });
        const ctx = { areas: areas ?? [house], places, settings: {}, log: () => {}, now: () => Date.now() };
        return { world, house, bot, ctx };
    }

    test('in a building (not a home) the bot is not in its shelter', () => {
        const s = scene({ botAt: [4.5, 64, 4.5] });
        assert.equal(S.isInShelter(s.bot, s.ctx), true);
        s.ctx.areas = [{ ...s.house, type: 'building' }];
        assert.equal(S.isInShelter(s.bot, s.ctx), false);
    });

    test('W48 in the fake world: a mine and a pen nearer than the house, the bot goes into the house', async () => {
        const s = scene({ botAt: [4.5, 64, 30.5] });
        const mine = box('mine', 'mine', -2, 25, 10, 35, 25, 58);
        const pen = box('pen', 'pen', 6, 32, 6, 34);
        s.ctx.areas = [mine, pen, s.house];
        const res = await S.goToShelter(s.bot, s.ctx, FAST);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(res.where, 'home');
        assert.equal(L.isInsideArea(s.house, s.bot.entity.position), true);
    });

    test('only a mine and a pen, no place home: no home, nothing moves, nothing is dug', async () => {
        const s = scene({ areas: [box('mine', 'mine', -2, 25, 10, 35, 25, 58), box('pen', 'pen', 6, 32, 6, 34)] });
        const res = await S.goToShelter(s.bot, s.ctx, FAST);
        assert.deepEqual({ ok: res.ok, reason: res.reason, text: res.text }, { ok: false, reason: 'no_home', text: 'I know no home. Tell me where home is.' });
        assert.deepEqual(s.bot.calls.filter(c => ['goto', 'dig', 'activate'].includes(c[0])), []);
    });

    test('a home without any door: inside, and the text claims no door', async () => {
        const s = scene({ withDoor: false });
        const res = await S.goToShelter(s.bot, s.ctx, FAST);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(res.text, 'I am in the shelter "home".');
        assert.equal(res.text.includes('The door is closed.'), false);
    });

    test('through the door: "The door is closed." after the state was read closed', async () => {
        const s = scene();
        const res = await S.goToShelter(s.bot, s.ctx, FAST);
        assert.equal(res.text, 'I am in the shelter "home". The door is closed.');
        assert.equal(s.world.propsAt(4, 64, 7).open, false);
    });

    test('a door that somebody opens again and that does not close: the text says it is open', async () => {
        const s = scene();
        let inside = false;
        const inner = s.bot.gotoImpl;
        s.bot.gotoImpl = async (goal) => {
            await inner(goal);
            // the walk to the standing place: somebody opens the door behind the bot, and it sticks
            if (!inside && L.isInsideArea(s.house, s.bot.entity.position) && s.world.propsAt(4, 64, 7).open === false) {
                inside = true;
                s.world.toggle(4, 64, 7);
                s.bot.failActivations = 99;
            }
        };
        const res = await S.goToShelter(s.bot, s.ctx, FAST);
        assert.equal(res.text, 'I am in the shelter "home", but a door is still open.');
        assert.equal(res.reason, 'door_open');
    });

    test('an area without entrances whose door stays open: the text says so', async () => {
        const s = scene();
        s.ctx.areas = [{ ...s.house, entrances: [] }];
        s.bot.onActivate = () => { s.bot.failActivations = 99; };
        const res = await S.goToShelter(s.bot, s.ctx, FAST);
        assert.equal(res.text, 'I am in the shelter "home", but a door is still open.');
    });
});

describe('C6: sleep', () => {
    function scene({ time = 13000, botAt = [5.5, 64, 10.5] } = {}) {
        const world = makeWorld();
        const bot = makeFakeBot({ world, pos: botAt });
        bot.time.timeOfDay = time;
        bot.sleepMs = 0;
        const progress = [];
        bot.modes.noteProgress = (reason) => progress.push(reason);
        const ctx = { areas: [], places: null, settings: {}, log: () => {}, now: () => Date.now() };
        return { world, bot, ctx, progress };
    }

    test('unstuck is paused from the start: before the walk to the bed', async () => {
        const s = scene();
        s.world.bed(20, 64, 10, { facing: 'east' });
        let pausedAtWalk = null;
        const inner = s.bot.gotoImpl;
        s.bot.gotoImpl = async (goal) => {
            pausedAtWalk = pausedAtWalk ?? s.bot.modes.paused.includes('unstuck');
            await inner(goal);
        };
        const res = await Z.sleepInBed(s.bot, s.ctx, QUICK);
        assert.equal(res.text, 'I slept. It is morning.');
        assert.equal(pausedAtWalk, true);
    });

    test('the wait at the bed after sunset notes progress for unstuck', async () => {
        const s = scene({ time: 12300 });
        s.world.bed(8, 64, 10);
        let t = 0;
        const res = await Z.sleepInBed(s.bot, s.ctx, {
            now: () => t,
            wait: async (ms) => { t += ms; s.bot.time.timeOfDay += ms / 50; await new Promise(r => setTimeout(r, 1)); },
        });
        assert.equal(res.text, 'I slept. It is morning.');
        assert.ok(s.bot.modes.paused.includes('unstuck'));
        assert.ok(s.progress.filter(r => r === 'sleep').length >= 3, JSON.stringify(s.progress));
    });

    test('by day: when the night starts, in whole minutes, and unstuck paused all the same', async () => {
        const cases = [[0, 10], [1000, 9], [6000, 5], [11500, 1], [23600, 10]];
        for (const [time, minutes] of cases) {
            const s = scene({ time });
            s.world.bed(8, 64, 10);
            const res = await Z.sleepInBed(s.bot, s.ctx, QUICK);
            assert.equal(res.text, `I cannot sleep now, it is day. The night starts in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`, `time ${time}`);
            assert.equal(res.reason, 'not_night');
            assert.equal(s.bot.calls.filter(c => c[0] === 'goto').length, 0);
            assert.ok(s.bot.modes.paused.includes('unstuck'));
        }
    });

    test('minutesUntilNight', () => {
        assert.equal(ZL.minutesUntilNight(6000), 5);
        assert.equal(ZL.minutesUntilNight(12000), 0);
        assert.equal(ZL.minutesUntilNight(24000 + 6000), 5);
        assert.equal(ZL.minutesUntilNight('x'), null);
    });

    test('the night routine of the mode: the house, then the bed', async () => {
        const world = makeWorld();
        const house = buildHouse(world);
        world.bed(2, 64, 2, { facing: 'east' });
        const bot = makeFakeBot({ world, pos: [4.5, 64, 20.5] });
        bot.time.timeOfDay = 13000;
        bot.sleepMs = 0;
        const res = await H.nightShelterRoutine(bot, { areas: [house] }, QUICK);
        assert.equal(res.text, 'I am in the shelter "home". The door is closed. I slept. It is morning.');
        const building = await H.nightShelterRoutine(makeFakeBot({ world, pos: [4.5, 64, 20.5] }), { areas: [{ ...house, type: 'building' }] }, QUICK);
        assert.equal(building.reason, 'no_home', 'a building is no shelter');
    });
});
