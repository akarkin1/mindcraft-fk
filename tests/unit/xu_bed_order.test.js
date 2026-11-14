// Spec v0.1.4.16 (part A, engineer E1), F6 the bed of !goToBed (R-8: by the trading hall the bot chose the villagers' beds).
// On the fake bot of the home pack: the bot's own bed (the place my_bed) first, a home's bed before a nearer stray bed, a
// bed by a lectern (a job site) or by a villager or in a trading hall is a villager's and never a candidate, with the text
// `The beds nearby are the villagers'; I found no bed of mine.` when no other bed stands within 32 blocks; `All beds nearby
// are taken.` only when a candidate bed was occupied; the foot of the bed the bot slept in is saved as my_bed.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeFakeBot, buildHouse, addMob } from './home_fake_bot.test.js';

const Z = await loadSrc('src/agent/packs/home/sleep.js');
const L = await loadSrc('src/agent/packs/home/sleep_logic.js');
const T = await loadSrc('src/agent/packs/home/texts.js');
const SURVEY = await loadSrc('src/agent/packs/survey/survey_logic.js');

const VILLAGERS = "The beds nearby are the villagers'; I found no bed of mine.";
const QUICK = { checkMs: 40, wait: () => new Promise(r => setTimeout(r, 2)) };

// A place store in memory: remember(name, x, y, z, dimension) and recall(name), as the PlaceStore.
function placeStore(initial = {}) {
    const places = new Map(Object.entries(initial));
    return {
        calls: [],
        remember(name, x, y, z, dimension) { this.calls.push([name, x, y, z, dimension]); places.set(name, { x, y, z, dimension }); },
        recall: name => places.get(name),
        list: () => [...places].map(([name, p]) => ({ name, ...p })),
    };
}

function scene({ botAt = [5.5, 64, 10.5], time = 13000, house = false, places = null, areas = null } = {}) {
    const world = makeWorld();
    const area = house ? buildHouse(world) : null;
    const bot = makeFakeBot({ world, pos: botAt });
    bot.time.timeOfDay = time;
    bot.sleepMs = 0;
    const ctx = { areas: areas ?? (area ? [area] : []), places, settings: {}, log: () => {}, now: () => Date.now() };
    return { world, area, bot, ctx };
}
const sleeps = bot => bot.calls.filter(c => c[0] === 'sleep').map(c => c.slice(1));

describe('F6: the order of the beds (orderBeds, pure)', () => {
    const bed = (x, z, extra = {}) => ({ x, y: 64, z, name: 'red_bed', part: 'head', facing: 'east', ...extra });

    test('the own bed first, then the beds of a home, then the rest, each nearest first; an excluded bed is left out', () => {
        const beds = [bed(2, 0), bed(11, 0, { home: true }), bed(40, 0, { home: true }), bed(20, 0, { excluded: 'job' }), bed(30, 0)];
        const myBed = { x: 29, y: 64, z: 0, dimension: 'overworld' }; // the foot of the head at (30, 64, 0) facing east
        const ordered = L.orderBeds(beds, { x: 0, y: 64, z: 0 }, { myBed, dimension: 'overworld' });
        assert.deepEqual(ordered.map(b => b.x), [30, 11, 40, 2]);
        assert.deepEqual(L.orderBeds(beds, { x: 0, y: 64, z: 0 }).map(b => b.x), [11, 40, 2, 30], 'without an own bed: the home beds, then the rest, the excluded one out');
        const plain = beds.map(({ home, excluded, ...b }) => b);
        assert.deepEqual(L.orderBeds(plain, { x: 0, y: 64, z: 0 }).map(b => b.x), [2, 11, 20, 30, 40], 'plain beds as in v0.1.4.6: by distance');
        assert.deepEqual(L.orderBeds(beds, { x: 0, y: 64, z: 0 }, { myBed: { ...myBed, dimension: 'the_nether' }, dimension: 'overworld' }).map(b => b.x), [11, 40, 2, 30],
            'a bed of another dimension is not the own bed');
    });

    test('bedFoot and isMyBed', () => {
        assert.deepEqual(L.bedFoot(bed(30, 0)), { x: 29, y: 64, z: 0 }, 'the head facing east: the foot is west of it');
        assert.deepEqual(L.bedFoot(bed(30, 0, { facing: 'north' })), { x: 30, y: 64, z: 1 });
        assert.deepEqual(L.bedFoot(bed(30, 0, { part: 'foot', facing: 'north' })), { x: 30, y: 64, z: 0 }, 'a foot is itself');
        assert.deepEqual(L.bedFoot({ x: 1, y: 2, z: 3 }), { x: 1, y: 2, z: 3 });
        assert.equal(L.bedFoot(null), null);
        assert.equal(L.isMyBed(bed(30, 0), { x: 29, y: 64, z: 0 }), true);
        assert.equal(L.isMyBed(bed(30, 0), { x: 29.7, y: 64, z: 0.2 }), true, 'a place with fractions names the block');
        assert.equal(L.isMyBed(bed(30, 0), { x: 30, y: 64, z: 0 }), false, 'the head is not the saved foot');
        assert.equal(L.isMyBed(bed(30, 0), null), false);
        assert.equal(L.MY_BED, 'my_bed');
    });

    test('the job sites are those of the survey (a copy, the home pack imports no other pack)', () => {
        assert.deepEqual([...L.JOB_SITE_NAMES], [...SURVEY.SEED_NAMES.jobs]);
        assert.deepEqual(L.BED_RULES, { jobRange: 8, villagerRange: 8 });
        assert.equal(T.TEXTS.villagersBeds, VILLAGERS);
    });
});

describe('F6: sleepInBed on the fake bot', () => {
    test('the own bed first: the saved place my_bed wins over a nearer bed', async () => {
        const places = placeStore({ my_bed: { x: 14, y: 64, z: 10, dimension: 'overworld' } }); // the foot of the bed at 14..15
        const { bot, ctx, world } = scene({ places });
        world.bed(7, 64, 10, { facing: 'east' }); // 1.5 blocks from the bot
        world.bed(14, 64, 10, { facing: 'east' }); // the own bed, 8.5 blocks away
        const res = await Z.sleepInBed(bot, ctx, QUICK);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.deepEqual(sleeps(bot)[0], [15, 64, 10], 'the head of the own bed');
        const { beds } = Z.candidateBeds(bot, ctx, 32);
        assert.deepEqual(beds.map(b => b.x), [15, 8]);
    });

    test('the bed the bot slept in becomes my_bed (its foot); a later sleep in another bed moves it', async () => {
        const places = placeStore();
        const { bot, ctx, world } = scene({ places });
        world.bed(8, 64, 10, { facing: 'east' }); // foot (8, 64, 10), head (9, 64, 10)
        assert.equal((await Z.sleepInBed(bot, ctx, QUICK)).ok, true);
        assert.deepEqual(places.recall('my_bed'), { x: 8, y: 64, z: 10, dimension: 'overworld' });
        assert.deepEqual(places.calls[0], ['my_bed', 8, 64, 10, 'overworld']);
        const other = scene({ places, botAt: [20.5, 64, 10.5] });
        other.world.bed(22, 64, 10, { facing: 'north' }); // foot (22, 64, 10), head (22, 64, 9)
        assert.equal((await Z.sleepInBed(other.bot, other.ctx, QUICK)).ok, true);
        assert.deepEqual(places.recall('my_bed'), { x: 22, y: 64, z: 10, dimension: 'overworld' }, 'moved to the new bed');
    });

    test('a MemoryBank as the places (rememberPlace, recallPlaceInfo) works too', async () => {
        const saved = {};
        const bank = {
            rememberPlace(name, x, y, z, dimension) { saved[name] = { x, y, z, dimension }; return true; },
            recallPlaceInfo: name => saved[name],
            getJson: () => Object.fromEntries(Object.entries(saved).map(([n, p]) => [n, [p.x, p.y, p.z]])),
        };
        const { bot, ctx, world } = scene({ places: bank });
        world.bed(8, 64, 10, { facing: 'east' });
        assert.equal((await Z.sleepInBed(bot, ctx, QUICK)).ok, true);
        assert.deepEqual(saved.my_bed, { x: 8, y: 64, z: 10, dimension: 'overworld' });
    });

    test("a home's bed before a nearer stray bed", async () => {
        const { bot, ctx, world } = scene({ house: true, botAt: [4.5, 64, 10.5] });
        world.bed(2, 64, 2, { facing: 'east' }); // inside the house (the area of type home)
        world.bed(5, 64, 11, { facing: 'east' }); // right beside the bot, in the open
        const { beds } = Z.candidateBeds(bot, ctx, 32);
        assert.deepEqual(beds.map(b => [b.x, b.z, b.home]), [[3, 2, true], [6, 11, false]]);
        const res = await Z.sleepInBed(bot, ctx, QUICK);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.deepEqual(sleeps(bot)[0], [3, 64, 2], "the home's bed, through the door");
    });

    test("a shelter the owner saved counts as a home; the survey's other shelters do not", async () => {
        const owner = { name: 'cabin', type: 'home', source: 'player', dimension: 'overworld', min: { x: 20, y: 63, z: 20 }, max: { x: 26, y: 69, z: 26 }, entrances: [] };
        const survey = { name: 'house_2', type: 'building', under: 'house', source: 'survey', dimension: 'overworld', min: { x: 20, y: 63, z: 20 }, max: { x: 26, y: 69, z: 26 }, entrances: [] };
        const a = scene({ areas: [owner], botAt: [10.5, 64, 10.5] });
        a.world.bed(22, 64, 22, { facing: 'east' });
        a.world.bed(12, 64, 10, { facing: 'east' });
        assert.deepEqual(Z.candidateBeds(a.bot, a.ctx, 32).beds.map(b => b.x), [23, 13], "the owner's home first");
        const b = scene({ areas: [survey], botAt: [10.5, 64, 10.5] });
        b.world.bed(22, 64, 22, { facing: 'east' });
        b.world.bed(12, 64, 10, { facing: 'east' });
        assert.deepEqual(Z.candidateBeds(b.bot, b.ctx, 32).beds.map(b => b.x), [13, 23], "a basement of the survey is no home: by distance");
    });

    test('a bed by a lectern is excluded, with the new text when it is the only one', async () => {
        const { bot, ctx, world } = scene();
        world.bed(8, 64, 10, { facing: 'east' });
        world.set(12, 64, 10, 'lectern'); // 3 blocks from the head
        const res = await Z.sleepInBed(bot, ctx, QUICK);
        assert.deepEqual({ ok: res.ok, reason: res.reason, text: res.text }, { ok: false, reason: 'villagers', text: VILLAGERS });
        assert.equal(sleeps(bot).length, 0, 'never tried');
        assert.deepEqual(Z.candidateBeds(bot, ctx, 32), { beds: [], excluded: 1 });
        world.bed(8, 64, 22, { facing: 'east' }); // 12 blocks from the lectern
        const next = await Z.sleepInBed(bot, ctx, QUICK);
        assert.equal(next.ok, true, JSON.stringify(next));
        assert.deepEqual(sleeps(bot)[0], [9, 64, 22], 'the bed away from the job site');
    });

    test('a bed by a villager is excluded; every job site of the survey counts', async () => {
        const { bot, ctx, world } = scene();
        world.bed(8, 64, 10, { facing: 'east' });
        addMob(bot, 'villager', [12.5, 64, 12.5], { type: 'passive' });
        assert.equal((await Z.sleepInBed(bot, ctx, QUICK)).text, VILLAGERS);
        for (const job of ['composter', 'smoker', 'barrel', 'cauldron']) {
            const s = scene();
            s.world.bed(8, 64, 10, { facing: 'east' });
            s.world.set(8, 64, 17, job); // 7 blocks from the head
            assert.equal((await Z.sleepInBed(s.bot, s.ctx, QUICK)).text, VILLAGERS, job);
        }
        const far = scene();
        far.world.bed(8, 64, 10, { facing: 'east' });
        far.world.set(9, 64, 19, 'lectern'); // 9 blocks from the head
        assert.equal((await Z.sleepInBed(far.bot, far.ctx, QUICK)).ok, true, 'a job site 9 blocks away does not count');
    });

    test('a bed inside a trading hall area or by a trading hall place is excluded', async () => {
        const hall = { name: 'trading_hall', type: 'building', dimension: 'overworld', min: { x: 6, y: 63, z: 8, }, max: { x: 12, y: 69, z: 14 }, entrances: [] };
        const a = scene({ areas: [hall] });
        a.world.bed(8, 64, 10, { facing: 'east' });
        assert.equal((await Z.sleepInBed(a.bot, a.ctx, QUICK)).text, VILLAGERS);
        const b = scene({ places: placeStore({ trading_hall: { x: 10, y: 64, z: 12, dimension: 'overworld' } }) });
        b.world.bed(8, 64, 10, { facing: 'east' });
        assert.equal((await Z.sleepInBed(b.bot, b.ctx, QUICK)).text, VILLAGERS);
    });

    // SPEC F6 corrected (T4's W126 run of 2026-11-14: at night `!goToBed` answered the villagers' text and the bot never slept:
    // the house's bed, inside the survey's home "house", is 7.3 blocks from the trading hall's lectern). The box of a trading
    // hall counts for every bed; the rules of nearness (a job site, a villager, a trading hall place within 8 blocks) only for a
    // bed that is not my_bed and lies in no home and no shelter the owner saved.
    const HALL = { name: 'trading_hall', type: 'building', kind: 'trading_hall', source: 'survey', dimension: 'overworld', min: { x: 0, y: 63, z: 9 }, max: { x: 8, y: 69, z: 15 }, entrances: [] };

    test('the W126 layout: the home\'s bed 7.3 blocks from the hall\'s lectern is the bot\'s; it sleeps there', async () => {
        const { bot, ctx, world, area } = scene({ house: true, botAt: [4.5, 64, 10.5] });
        ctx.areas = [area, HALL];
        world.bed(2, 64, 2, { facing: 'east' }); // inside the house (the area of type home), head (3, 64, 2)
        world.set(5, 64, 9, 'lectern'); // in the trading hall, 7.3 blocks from the head
        const { beds, excluded } = Z.candidateBeds(bot, ctx, 32);
        assert.equal(excluded, 0, 'the home\'s bed is no villager\'s');
        assert.deepEqual(beds.map(b => [b.x, b.z, b.home]), [[3, 2, true]]);
        const res = await Z.sleepInBed(bot, ctx, QUICK);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.deepEqual(sleeps(bot)[0], [3, 64, 2]);
    });

    test('a stray bed and a village house\'s bed by the same lectern stay the villagers\'', async () => {
        const village = { name: 'house_2', type: 'building', source: 'survey', dimension: 'overworld', min: { x: 9, y: 63, z: 14 }, max: { x: 14, y: 69, z: 19 }, entrances: [] };
        const { bot, ctx, world, area } = scene({ house: true, botAt: [4.5, 64, 10.5] });
        ctx.areas = [area, HALL, village];
        world.bed(2, 64, 2, { facing: 'east' }); // the home's bed
        world.bed(10, 64, 10, { facing: 'east' }); // a stray bed in the open, 6 blocks from the lectern
        world.bed(9, 64, 14, { facing: 'east' }); // a bed of the village house, its head 7.1 blocks from the lectern
        world.set(5, 64, 9, 'lectern');
        const { beds, excluded } = Z.candidateBeds(bot, ctx, 32);
        assert.deepEqual(beds.map(b => [b.x, b.z]), [[3, 2]], 'only the home\'s bed');
        assert.equal(excluded, 2);
        const alone = scene({ botAt: [4.5, 64, 10.5], areas: [HALL, village] });
        alone.world.bed(10, 64, 10, { facing: 'east' });
        alone.world.bed(9, 64, 14, { facing: 'east' });
        alone.world.set(5, 64, 9, 'lectern');
        assert.equal((await Z.sleepInBed(alone.bot, alone.ctx, QUICK)).text, VILLAGERS, 'without the home: the villagers\' text as before');
    });

    test('my_bed by a villager is the bot\'s: it sleeps there; inside a trading hall\'s box it stays the villagers\'', async () => {
        const places = placeStore({ my_bed: { x: 8, y: 64, z: 10, dimension: 'overworld' } }); // the foot of the bed at 8..9
        const { bot, ctx, world } = scene({ places });
        world.bed(8, 64, 10, { facing: 'east' });
        addMob(bot, 'villager', [12.5, 64, 12.5], { type: 'passive' });
        const res = await Z.sleepInBed(bot, ctx, QUICK);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.deepEqual(sleeps(bot)[0], [9, 64, 10]);
        const hall = { ...HALL, min: { x: 6, y: 63, z: 8 }, max: { x: 12, y: 69, z: 14 } };
        const inHall = scene({ places, areas: [hall] });
        inHall.world.bed(8, 64, 10, { facing: 'east' });
        assert.equal((await Z.sleepInBed(inHall.bot, inHall.ctx, QUICK)).text, VILLAGERS, 'the box of the hall counts for my_bed too');
    });

    test('the taken text only for a candidate bed', async () => {
        // an occupied bed by a lectern and nothing else: the villagers' text, not the taken text
        const a = scene();
        a.world.bed(8, 64, 10, { facing: 'east', occupied: true });
        a.world.set(12, 64, 10, 'lectern');
        assert.equal((await Z.sleepInBed(a.bot, a.ctx, QUICK)).text, VILLAGERS);
        // an occupied candidate bed and an excluded one: the taken text
        const b = scene();
        b.world.bed(8, 64, 10, { facing: 'east', occupied: true });
        b.world.bed(8, 64, 24, { facing: 'east' });
        b.world.set(12, 64, 24, 'lectern');
        assert.equal((await Z.sleepInBed(b.bot, b.ctx, QUICK)).text, 'All beds nearby are taken.');
        // no bed at all: the old text
        assert.equal((await Z.sleepInBed(scene().bot, scene().ctx, QUICK)).text, 'I found no bed nearby.');
    });
});
